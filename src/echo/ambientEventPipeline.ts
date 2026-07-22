import { makeId } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type {
  FieldState,
  HistoryEntry,
  ResolutionResult,
} from "../domain/types";
import { localParticipantId } from "../sharedSession";
import { serializeStable } from "../utils/stableSerialization";
import {
  AMBIENT_EVENT_PIPELINE_VERSION,
  AMBIENT_EVENT_SERIALIZATION_VERSION,
  type AmbientApprovalRequest,
  type AmbientCanonicalEvent,
  type AmbientContextValidationResult,
  type AmbientEntityReference,
  type AmbientIntent,
  type AmbientIntentInput,
  type AmbientPipelineDiagnostics,
  type AmbientPipelineRequest,
  type AmbientPipelineResult,
  type AmbientPipelineStageName,
  type AmbientPipelineStageRecord,
  type AmbientPreview,
  type AmbientResolvedEntity,
  type AmbientRuleValidationResult,
  type AmbientSynchronizationRecord,
} from "./ambientEventTypes";
import { normalizeAmbientGameplayState } from "./ambientEngine";
import {
  ambientConfidenceDecisionEngine,
  assessAmbientConfidence,
  createAmbientCorrectionRequest,
  decideAmbientApprovalWithConfidence,
  isAmbientPreviewExpired,
  normalizeAmbientConfidence,
  transitionAmbientPreview,
} from "./ambientConfidence";
import type {
  AmbientConfidenceDecision,
  AmbientFeedbackNotice,
} from "./ambientConfidenceTypes";

const PIPELINE_STAGES: AmbientPipelineStageName[] = [
  "intent-created",
  "entity-resolution",
  "context-validation",
  "rule-validation",
  "confidence-assignment",
  "action-preview",
  "approval-decision",
  "canonical-event-creation",
  "battlefield-mutation",
  "undo-snapshot",
  "history-recording",
  "synchronization",
  "completion",
];

const NUMBER_PAYLOAD_KEYS = new Set([
  "amount",
  "quantity",
  "delta",
  "life",
  "commanderDamage",
]);

export class AmbientEventPipeline {
  private readonly processedIntentIds = new Set<string>();
  private active = false;
  private diagnosticsState: AmbientPipelineDiagnostics = {
    version: AMBIENT_EVENT_PIPELINE_VERSION,
    lastIntentId: null,
    lastEventId: null,
    lastStatus: null,
    lastError: null,
    processedIntentCount: 0,
    active: false,
  };

  process(request: AmbientPipelineRequest): AmbientPipelineResult {
    const timestamp = request.timestamp ?? new Date().toISOString();
    const stages: AmbientPipelineStageRecord[] = [];
    const fail = (
      message: string,
      stage: AmbientPipelineStageName,
      intentId: string | null,
    ): AmbientPipelineResult => {
      recordStage(stages, stage, "failed", message, timestamp);
      this.diagnosticsState = {
        ...this.diagnosticsState,
        lastIntentId: intentId,
        lastEventId: null,
        lastStatus: "failed",
        lastError: message,
        active: false,
      };
      this.active = false;
      return {
        status: "failed",
        field: request.field,
        event: null,
        historyEntry: null,
        undo: null,
        preview: null,
        correction: null,
        feedback: [],
        stages: completeRemainingStages(stages, stage, timestamp),
        diagnostics: this.getDiagnostics(),
      };
    };

    if (this.active) {
      return fail(
        "Ambient Event Pipeline is already processing an intent.",
        "intent-created",
        null,
      );
    }

    this.active = true;
    this.diagnosticsState = { ...this.diagnosticsState, active: true };

    try {
      const intent = createAmbientIntent(request.intent, timestamp);
      if (this.processedIntentIds.has(intent.id)) {
        return fail(
          `Ambient intent ${intent.id} was already processed.`,
          "intent-created",
          intent.id,
        );
      }
      this.processedIntentIds.add(intent.id);
      recordStage(
        stages,
        "intent-created",
        "passed",
        `Intent ${intent.kind} accepted.`,
        timestamp,
      );

      const resolvedEntities = request.resolver
        ? request.resolver(request.field, intent)
        : resolveAmbientEntities(request.field, intent);
      recordStage(
        stages,
        "entity-resolution",
        resolvedEntities.some((entity) => entity.status !== "resolved")
          ? "failed"
          : "passed",
        summarizeEntityResolution(resolvedEntities),
        timestamp,
      );
      if (resolvedEntities.some((entity) => entity.status !== "resolved")) {
        recordStage(
          stages,
          "context-validation",
          "failed",
          "One or more Ambient entities could not be resolved.",
          timestamp,
        );
      }

      const contextValidation = request.contextValidator
        ? request.contextValidator({
            field: request.field,
            intent,
            resolvedEntities,
          })
        : validateAmbientContext({
            field: request.field,
            intent,
            resolvedEntities,
          });
      if (!resolvedEntities.some((entity) => entity.status !== "resolved")) {
        recordStage(
          stages,
          "context-validation",
          contextValidation.ok ? "passed" : "failed",
          validationMessage(
            contextValidation.errors,
            contextValidation.warnings,
          ),
          timestamp,
        );
      }

      const ruleValidation = request.ruleValidator
        ? request.ruleValidator({
            field: request.field,
            intent,
            resolvedEntities,
          })
        : validateAmbientRules({
            field: request.field,
            intent,
            resolvedEntities,
          });
      recordStage(
        stages,
        "rule-validation",
        ruleValidation.ok ? "passed" : "failed",
        validationMessage(ruleValidation.errors, ruleValidation.warnings),
        timestamp,
      );
      const confidence = assignAmbientConfidence(intent, {
        timestamp,
        contextValid: contextValidation.ok,
        rulesValid: ruleValidation.ok,
        warningCount:
          contextValidation.warnings.length + ruleValidation.warnings.length,
      });
      const intentWithConfidence = { ...intent, confidence };
      recordStage(
        stages,
        "confidence-assignment",
        "passed",
        `Confidence assigned as ${confidence.level}.`,
        timestamp,
      );

      const decision = ambientConfidenceDecisionEngine.decide({
        confidence,
        mode: contextValidation.mode,
        intentKind: intentWithConfidence.kind,
        source: intentWithConfidence.source,
        contextValidation,
        ruleValidation,
        entityResolutionOk: resolvedEntities.every(
          (entity) => entity.status === "resolved",
        ),
        requiresPreview: intentWithConfidence.requiresPreview,
        timestamp,
      });

      if (decision.rejectionRequired) {
        return this.rejectFromDecision(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          decision,
          timestamp,
        );
      }

      if (decision.correctionRequired) {
        return this.correctionFromDecision(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          decision,
          timestamp,
        );
      }

      if (decision.recoveryRequired) {
        return this.recoveryFromApproval(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          null,
          decision.feedback,
          decision.reason,
          timestamp,
        );
      }

      const preview =
        decision.previewRequired ||
        decision.confirmationRequired ||
        request.approval?.method === "manual" ||
        request.approval?.method === "confirmation-required"
          ? createAmbientPreview({
              field: request.field,
              intent: intentWithConfidence,
              resolvedEntities,
              previewBuilder: request.previewBuilder,
              timestamp,
            })
          : null;
      recordStage(
        stages,
        "action-preview",
        preview ? "passed" : "skipped",
        preview ? "Ambient action preview created." : "Preview not required.",
        timestamp,
      );

      const approvalDecision = decideAmbientApproval(
        request.approval,
        Boolean(preview),
        decision,
        preview,
        timestamp,
      );
      recordStage(
        stages,
        "approval-decision",
        approvalDecision === "approved" ? "passed" : "skipped",
        `Approval decision: ${approvalDecision}.`,
        timestamp,
      );

      if (approvalDecision === "preview-required" && preview) {
        this.diagnosticsState = {
          ...this.diagnosticsState,
          lastIntentId: intentWithConfidence.id,
          lastEventId: null,
          lastStatus: "preview",
          lastError: null,
          processedIntentCount: this.processedIntentIds.size,
          active: false,
        };
        this.active = false;
        return {
          status: "preview",
          field: request.field,
          event: null,
          historyEntry: null,
          undo: null,
          preview,
          correction: null,
          feedback: decision.feedback,
          stages: completeRemainingStages(
            stages,
            "approval-decision",
            timestamp,
          ),
          diagnostics: this.getDiagnostics(),
        };
      }

      if (approvalDecision === "cancelled") {
        return this.cancelFromApproval(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          preview,
          decision.feedback,
          "Ambient intent was cancelled before mutation.",
          timestamp,
        );
      }

      if (approvalDecision === "recovery-required") {
        return this.recoveryFromApproval(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          preview,
          decision.feedback,
          request.approval?.reason ?? "Ambient intent requires recovery.",
          timestamp,
        );
      }

      const baseEvent = createCanonicalAmbientEvent({
        field: request.field,
        intent: intentWithConfidence,
        resolvedEntities,
        timestamp,
        status: "completed",
        summary: [],
        changedGroupIds: [],
        generatedGameEventIds: [],
        error: null,
        historyReference: null,
        undoReference: null,
      });
      recordStage(
        stages,
        "canonical-event-creation",
        "passed",
        `Canonical event ${baseEvent.id} created.`,
        timestamp,
      );

      if (!request.mutation) {
        return this.rejectFromDecision(
          request.field,
          stages,
          intentWithConfidence,
          resolvedEntities,
          {
            ...decision,
            path: "action-rejection",
            mutationAllowed: false,
            rejectionRequired: true,
            reason: "No Ambient battlefield mutation handler was provided.",
          },
          timestamp,
        );
      }

      const committedPreview = preview
        ? transitionAmbientPreview(preview, "committed", {
            timestamp,
            reason: "Ambient preview committed to battlefield mutation.",
          })
        : null;
      const before = structuredClone(request.field);
      const mutationResult = request.mutation({
        field: structuredClone(request.field),
        intent: intentWithConfidence,
        resolvedEntities,
        preview: committedPreview,
      });
      const after = normalizeField(extractField(mutationResult));
      const mutationSummary = extractSummary(
        mutationResult,
        intentWithConfidence,
      );
      const changedGroupIds = extractChangedGroupIds(
        mutationResult,
        before,
        after,
      );
      const generatedEvents = extractGeneratedEvents(mutationResult);
      recordStage(
        stages,
        "battlefield-mutation",
        "passed",
        "Battlefield mutation completed through the Ambient Event Pipeline.",
        timestamp,
      );

      const historyEntry = createAmbientHistoryEntry({
        label: `Ambient ${intentWithConfidence.kind}`,
        before,
        after,
        summary: mutationSummary,
        timestamp,
      });
      recordStage(
        stages,
        "undo-snapshot",
        "passed",
        `Undo snapshot ${historyEntry.id} created.`,
        timestamp,
      );
      recordStage(
        stages,
        "history-recording",
        "passed",
        "History entry prepared for the existing undo stack.",
        timestamp,
      );

      const synchronization = createAmbientSynchronizationRecord(
        after,
        timestamp,
      );
      recordStage(
        stages,
        "synchronization",
        "passed",
        "Synchronization metadata prepared for local-only session.",
        timestamp,
      );

      const event: AmbientCanonicalEvent = {
        ...baseEvent,
        result: {
          status: "completed",
          summary: mutationSummary,
          changedGroupIds,
          generatedGameEventIds: generatedEvents.map((event) => event.id),
          error: null,
        },
        undoReference: historyEntry.id,
        historyReference: historyEntry.id,
        synchronization,
      };

      recordStage(
        stages,
        "completion",
        "passed",
        "Ambient intent completed.",
        timestamp,
      );

      this.diagnosticsState = {
        ...this.diagnosticsState,
        lastIntentId: intentWithConfidence.id,
        lastEventId: event.id,
        lastStatus: "completed",
        lastError: null,
        processedIntentCount: this.processedIntentIds.size,
        active: false,
      };
      this.active = false;
      return {
        status: "completed",
        field: after,
        event,
        historyEntry,
        undo: { before, after, historyEntryId: historyEntry.id },
        preview: committedPreview,
        correction: null,
        feedback: decision.feedback,
        stages,
        diagnostics: this.getDiagnostics(),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected Ambient Event Pipeline failure.";
      return fail(message, "completion", null);
    }
  }

  resetDiagnostics(): void {
    this.processedIntentIds.clear();
    this.active = false;
    this.diagnosticsState = {
      version: AMBIENT_EVENT_PIPELINE_VERSION,
      lastIntentId: null,
      lastEventId: null,
      lastStatus: null,
      lastError: null,
      processedIntentCount: 0,
      active: false,
    };
  }

  getDiagnostics(): AmbientPipelineDiagnostics {
    return { ...this.diagnosticsState, active: this.active };
  }

  private rejectFromDecision(
    field: FieldState,
    stages: AmbientPipelineStageRecord[],
    intent: AmbientIntent,
    resolvedEntities: AmbientResolvedEntity[],
    decision: AmbientConfidenceDecision,
    timestamp: string,
  ): AmbientPipelineResult {
    const event = createCanonicalAmbientEvent({
      field,
      intent,
      resolvedEntities,
      timestamp,
      status: "rejected",
      summary: [decision.reason],
      changedGroupIds: [],
      generatedGameEventIds: [],
      error: decision.reason,
      historyReference: null,
      undoReference: null,
    });
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastIntentId: intent.id,
      lastEventId: event.id,
      lastStatus: "rejected",
      lastError: decision.reason,
      processedIntentCount: this.processedIntentIds.size,
      active: false,
    };
    this.active = false;
    return {
      status: "rejected",
      field,
      event,
      historyEntry: null,
      undo: null,
      preview: null,
      correction: null,
      feedback: decision.feedback,
      stages: completeRemainingStages(
        stages,
        lastRecordedStage(stages),
        timestamp,
      ),
      diagnostics: this.getDiagnostics(),
    };
  }

  private correctionFromDecision(
    field: FieldState,
    stages: AmbientPipelineStageRecord[],
    intent: AmbientIntent,
    resolvedEntities: AmbientResolvedEntity[],
    decision: AmbientConfidenceDecision,
    timestamp: string,
  ): AmbientPipelineResult {
    const correction = createAmbientCorrectionRequest({
      type: "retry",
      intentId: intent.id,
      reason: decision.reason,
      timestamp,
    });
    const event = createCanonicalAmbientEvent({
      field,
      intent,
      resolvedEntities,
      timestamp,
      status: "correction-required",
      summary: [decision.reason],
      changedGroupIds: [],
      generatedGameEventIds: [],
      error: null,
      historyReference: null,
      undoReference: null,
    });
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastIntentId: intent.id,
      lastEventId: event.id,
      lastStatus: "correction-required",
      lastError: null,
      processedIntentCount: this.processedIntentIds.size,
      active: false,
    };
    this.active = false;
    return {
      status: "correction-required",
      field,
      event,
      historyEntry: null,
      undo: null,
      preview: null,
      correction,
      feedback: decision.feedback,
      stages: completeRemainingStages(
        stages,
        lastRecordedStage(stages),
        timestamp,
      ),
      diagnostics: this.getDiagnostics(),
    };
  }

  private cancelFromApproval(
    field: FieldState,
    stages: AmbientPipelineStageRecord[],
    intent: AmbientIntent,
    resolvedEntities: AmbientResolvedEntity[],
    preview: AmbientPreview | null,
    feedback: AmbientFeedbackNotice[],
    message: string,
    timestamp: string,
  ): AmbientPipelineResult {
    const cancelledPreview = preview
      ? transitionAmbientPreview(preview, "cancelled", {
          timestamp,
          reason: message,
        })
      : null;
    const event = createCanonicalAmbientEvent({
      field,
      intent,
      resolvedEntities,
      timestamp,
      status: "cancelled",
      summary: [message],
      changedGroupIds: [],
      generatedGameEventIds: [],
      error: null,
      historyReference: null,
      undoReference: null,
    });
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastIntentId: intent.id,
      lastEventId: event.id,
      lastStatus: "cancelled",
      lastError: null,
      processedIntentCount: this.processedIntentIds.size,
      active: false,
    };
    this.active = false;
    return {
      status: "cancelled",
      field,
      event,
      historyEntry: null,
      undo: null,
      preview: cancelledPreview,
      correction: null,
      feedback,
      stages: completeRemainingStages(
        stages,
        lastRecordedStage(stages),
        timestamp,
      ),
      diagnostics: this.getDiagnostics(),
    };
  }

  private recoveryFromApproval(
    field: FieldState,
    stages: AmbientPipelineStageRecord[],
    intent: AmbientIntent,
    resolvedEntities: AmbientResolvedEntity[],
    preview: AmbientPreview | null,
    feedback: AmbientFeedbackNotice[],
    message: string,
    timestamp: string,
  ): AmbientPipelineResult {
    const recoveryField = createRecoveryField(field, message, timestamp);
    const event = createCanonicalAmbientEvent({
      field: recoveryField,
      intent,
      resolvedEntities,
      timestamp,
      status: "recovery-required",
      summary: [message],
      changedGroupIds: [],
      generatedGameEventIds: [],
      error: message,
      historyReference: null,
      undoReference: null,
    });
    this.diagnosticsState = {
      ...this.diagnosticsState,
      lastIntentId: intent.id,
      lastEventId: event.id,
      lastStatus: "recovery-required",
      lastError: message,
      processedIntentCount: this.processedIntentIds.size,
      active: false,
    };
    this.active = false;
    return {
      status: "recovery-required",
      field: recoveryField,
      event,
      historyEntry: null,
      undo: null,
      preview,
      correction: null,
      feedback,
      stages: completeRemainingStages(
        stages,
        lastRecordedStage(stages),
        timestamp,
      ),
      diagnostics: this.getDiagnostics(),
    };
  }
}

export const ambientEventPipeline = new AmbientEventPipeline();

export function createAmbientIntent(
  input: AmbientIntent | AmbientIntentInput,
  fallbackTimestamp = new Date().toISOString(),
): AmbientIntent {
  return {
    id: typeof input.id === "string" && input.id ? input.id : makeId("intent"),
    kind: input.kind,
    source: input.source,
    createdAt:
      typeof input.createdAt === "string" ? input.createdAt : fallbackTimestamp,
    actor: input.actor === "opponent" ? "opponent" : "you",
    entities: Array.isArray(input.entities)
      ? input.entities.map(normalizeEntityReference)
      : [],
    payload: normalizePayload(input.payload),
    confidence: normalizeAmbientConfidence(input.confidence, {
      source: input.source,
      timestamp: fallbackTimestamp,
      contextValid: false,
      rulesValid: false,
      warningCount: 0,
    }),
    requiredMode: input.requiredMode ?? null,
    requiresPreview: Boolean(input.requiresPreview),
    correlationId:
      typeof input.correlationId === "string" ? input.correlationId : null,
  };
}

export function resolveAmbientEntities(
  field: FieldState,
  intent: AmbientIntent,
): AmbientResolvedEntity[] {
  return intent.entities.map((reference) => {
    if (reference.kind === "group" || reference.kind === "object") {
      const group =
        reference.kind === "group"
          ? field.groups.find((entry) => entry.id === reference.id)
          : field.groups.find((entry) =>
              (entry.session?.objectIds ?? [entry.id]).includes(reference.id),
            );
      if (!group) {
        return unresolvedEntity(reference, "Battlefield object was not found.");
      }
      return {
        reference,
        status: "resolved",
        groupId: group.id,
        objectIds: [...(group.session?.objectIds ?? [group.id])],
        label: group.label,
        owner: group.owner,
        zone: group.zone,
        message: null,
      };
    }
    if (reference.kind === "session") {
      return reference.id === field.session.id
        ? {
            reference,
            status: "resolved",
            groupId: null,
            objectIds: [],
            label: field.session.id,
            owner: null,
            zone: null,
            message: null,
          }
        : unresolvedEntity(reference, "Session reference does not match.");
    }
    if (reference.kind === "player") {
      return {
        reference,
        status: "resolved",
        groupId: null,
        objectIds: [],
        label: reference.owner,
        owner: reference.owner,
        zone: null,
        message: null,
      };
    }
    if (reference.kind === "counter") {
      return reference.name.trim()
        ? {
            reference,
            status: "resolved",
            groupId: null,
            objectIds: [],
            label: reference.name.trim(),
            owner: null,
            zone: null,
            message: null,
          }
        : unresolvedEntity(reference, "Counter name is empty.");
    }
    return {
      reference,
      status: "resolved",
      groupId: null,
      objectIds: [],
      label: "key" in reference ? String(reference.key) : reference.zone,
      owner: null,
      zone: "zone" in reference ? reference.zone : null,
      message: null,
    };
  });
}

export function validateAmbientContext(input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
}): AmbientContextValidationResult {
  const ambient = normalizeAmbientGameplayState(input.field.ambient, {
    fallbackTimestamp: input.field.updatedAt,
    sessionId: input.field.session.id,
    allowFocusedMode: true,
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.field.session.id) errors.push("Session ID is missing.");
  if (
    input.intent.requiredMode &&
    ambient.currentMode !== input.intent.requiredMode
  ) {
    errors.push(
      `Intent requires ${input.intent.requiredMode}, but current mode is ${ambient.currentMode}.`,
    );
  }
  if (input.resolvedEntities.some((entity) => entity.status !== "resolved")) {
    errors.push("Resolved entity set contains unresolved references.");
  }
  if (input.intent.actor !== "you") {
    warnings.push(
      "Opponent-originated Ambient intents are local helper metadata only.",
    );
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    mode: ambient.currentMode,
  };
}

export function validateAmbientRules(input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
}): AmbientRuleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entity of input.resolvedEntities) {
    const key = serializeStable(entity.reference);
    if (seen.has(key))
      errors.push("Ambient intent contains duplicate entity references.");
    seen.add(key);
  }
  for (const key of NUMBER_PAYLOAD_KEYS) {
    const value = input.intent.payload[key];
    if (typeof value === "number" && value < 0) {
      errors.push(`Payload value ${key} cannot be negative.`);
    }
  }
  if (
    (input.intent.kind === "tap" ||
      input.intent.kind === "untap" ||
      input.intent.kind === "destroy-permanent" ||
      input.intent.kind === "sacrifice-permanent" ||
      input.intent.kind === "exile-permanent") &&
    !input.resolvedEntities.some((entity) => entity.groupId)
  ) {
    errors.push(
      "Permanent-changing Ambient intents require a battlefield object.",
    );
  }
  if (input.intent.kind === "modify-life") {
    const amount = input.intent.payload.amount ?? input.intent.payload.delta;
    if (typeof amount !== "number") {
      errors.push("Life modification intents require a numeric amount.");
    }
  }
  if (!input.field.groups.every((group) => group.id)) {
    errors.push("Battlefield contains a corrupted object identifier.");
  }
  if (input.intent.confidence.level === "unknown") {
    warnings.push("Ambient intent confidence is unknown.");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assignAmbientConfidence(
  intent: AmbientIntent,
  options: {
    timestamp: string;
    contextValid: boolean;
    rulesValid: boolean;
    warningCount: number;
  },
) {
  return assessAmbientConfidence(intent, options);
}

export function createAmbientPreview(input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
  previewBuilder?: (previewInput: {
    field: FieldState;
    intent: AmbientIntent;
    resolvedEntities: AmbientResolvedEntity[];
  }) => AmbientPreview;
  timestamp: string;
}): AmbientPreview {
  if (input.previewBuilder) {
    return normalizeAmbientPreview(
      input.previewBuilder({
        field: input.field,
        intent: input.intent,
        resolvedEntities: input.resolvedEntities,
      }),
      input.timestamp,
    );
  }
  return normalizeAmbientPreview(
    {
      id: makeId("ambient-preview"),
      intentId: input.intent.id,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      expiresAt: null,
      status: "created",
      lifecycle: [
        {
          status: "created",
          timestamp: input.timestamp,
          reason: "Ambient preview created.",
        },
      ],
      summary: [`Preview prepared for ${input.intent.kind}.`],
      resolvedEntities: input.resolvedEntities.map((entity) => ({
        ...entity,
        objectIds: [...entity.objectIds],
      })),
      requiresApproval: true,
    },
    input.timestamp,
  );
}

function normalizeAmbientPreview(
  preview: AmbientPreview,
  timestamp: string,
): AmbientPreview {
  const status = preview.status ?? "created";
  return {
    id: preview.id,
    intentId: preview.intentId,
    createdAt: preview.createdAt,
    updatedAt: preview.updatedAt ?? timestamp,
    expiresAt: preview.expiresAt ?? null,
    status,
    lifecycle: Array.isArray(preview.lifecycle)
      ? preview.lifecycle.map((entry) => ({ ...entry }))
      : [{ status, timestamp, reason: "Ambient preview normalized." }],
    summary: [...preview.summary],
    resolvedEntities: preview.resolvedEntities.map((entity) => ({
      ...entity,
      objectIds: [...entity.objectIds],
    })),
    requiresApproval: Boolean(preview.requiresApproval),
  };
}

export function decideAmbientApproval(
  approval: AmbientApprovalRequest | undefined,
  hasPreview: boolean,
  decision: AmbientConfidenceDecision,
  preview: AmbientPreview | null,
  timestamp: string,
) {
  return decideAmbientApprovalWithConfidence({
    approval,
    decision,
    hasPreview,
    previewExpired: preview
      ? isAmbientPreviewExpired(preview, timestamp)
      : false,
  });
}

export function createCanonicalAmbientEvent(input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
  timestamp: string;
  status: AmbientCanonicalEvent["result"]["status"];
  summary: string[];
  changedGroupIds: string[];
  generatedGameEventIds: string[];
  error: string | null;
  undoReference: string | null;
  historyReference: string | null;
}): AmbientCanonicalEvent {
  const participantId = localParticipantId(input.field.session);
  return {
    id: makeId("ambient-event"),
    pipelineVersion: AMBIENT_EVENT_PIPELINE_VERSION,
    serializationVersion: AMBIENT_EVENT_SERIALIZATION_VERSION,
    timestamp: input.timestamp,
    source: input.intent.source,
    mode: input.field.ambient.currentMode,
    sessionId: input.field.session.id,
    participantId,
    intent: structuredClone(input.intent),
    resolvedEntities: input.resolvedEntities.map((entity) => ({
      ...entity,
      objectIds: [...entity.objectIds],
    })),
    confidence: input.intent.confidence,
    result: {
      status: input.status,
      summary: [...input.summary],
      changedGroupIds: [...input.changedGroupIds],
      generatedGameEventIds: [...input.generatedGameEventIds],
      error: input.error,
    },
    undoReference: input.undoReference,
    historyReference: input.historyReference,
    synchronization: createAmbientSynchronizationRecord(
      input.field,
      input.timestamp,
    ),
    replay: {
      compatible: true,
      markerId: makeId("ambient-replay"),
      description: `${input.intent.kind} from ${input.intent.source}`,
    },
  };
}

export function createAmbientHistoryEntry(input: {
  label: string;
  before: FieldState;
  after: FieldState;
  summary: string[];
  timestamp: string;
}): HistoryEntry {
  return {
    id: makeId("history"),
    label: input.label,
    before: input.before,
    after: input.after,
    summary: [...input.summary],
    createdAt: input.timestamp,
  };
}

export function createAmbientSynchronizationRecord(
  field: FieldState,
  timestamp: string,
): AmbientSynchronizationRecord {
  void timestamp;
  return {
    status:
      field.session.status === "connected" ||
      field.session.status === "readyForSharing"
        ? "queued"
        : "local-only",
    sessionId: field.session.id,
    authority: field.session.currentSessionAuthority,
    synchronizationVersion: field.session.synchronizationVersion,
    publishedAt: null,
    reason:
      field.session.status === "localOnly"
        ? "Local-only Lite session; no shared authority is connected."
        : "Shared-session synchronization hook prepared.",
  };
}

export function serializeAmbientCanonicalEvent(
  event: AmbientCanonicalEvent,
): string {
  return serializeStable(event);
}

function recordStage(
  stages: AmbientPipelineStageRecord[],
  stage: AmbientPipelineStageName,
  status: AmbientPipelineStageRecord["status"],
  message: string,
  timestamp: string,
): void {
  stages.push({ stage, status, message, timestamp });
}

function completeRemainingStages(
  stages: AmbientPipelineStageRecord[],
  currentStage: AmbientPipelineStageName,
  timestamp: string,
): AmbientPipelineStageRecord[] {
  const currentIndex = PIPELINE_STAGES.indexOf(currentStage);
  const recorded = new Set(stages.map((stage) => stage.stage));
  for (const stage of PIPELINE_STAGES.slice(currentIndex + 1)) {
    if (!recorded.has(stage)) {
      recordStage(stages, stage, "skipped", "Stage skipped.", timestamp);
    }
  }
  return stages;
}

function lastRecordedStage(
  stages: AmbientPipelineStageRecord[],
): AmbientPipelineStageName {
  return stages.at(-1)?.stage ?? "intent-created";
}

function validationMessage(errors: string[], warnings: string[]): string {
  if (errors.length) return errors.join(" ");
  if (warnings.length) return warnings.join(" ");
  return "Validation passed.";
}

function summarizeEntityResolution(entities: AmbientResolvedEntity[]): string {
  if (!entities.length) return "No entities required.";
  const missing = entities.filter(
    (entity) => entity.status !== "resolved",
  ).length;
  return missing
    ? `${missing} Ambient entity reference(s) could not be resolved.`
    : `${entities.length} Ambient entity reference(s) resolved.`;
}

function normalizeEntityReference(
  reference: AmbientEntityReference,
): AmbientEntityReference {
  if (reference.kind === "counter") {
    return { ...reference, name: reference.name.trim().slice(0, 80) };
  }
  return structuredClone(reference);
}

function normalizePayload(
  value: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([, entry]) =>
          entry === null ||
          ["string", "number", "boolean"].includes(typeof entry),
      )
      .map(([key, entry]) => [
        key.slice(0, 80),
        typeof entry === "string" ? entry.slice(0, 240) : entry,
      ]),
  ) as Record<string, string | number | boolean | null>;
}

function unresolvedEntity(
  reference: AmbientEntityReference,
  message: string,
): AmbientResolvedEntity {
  return {
    reference,
    status: "missing",
    groupId: null,
    objectIds: [],
    label: "id" in reference ? reference.id : reference.kind,
    owner: "owner" in reference ? reference.owner : null,
    zone: "zone" in reference ? reference.zone : null,
    message,
  };
}

function extractField(result: FieldState | ResolutionResult): FieldState {
  return "field" in result ? result.field : result;
}

function extractSummary(
  result: FieldState | ResolutionResult,
  intent: AmbientIntent,
): string[] {
  if ("summary" in result && Array.isArray(result.summary)) {
    return [...result.summary];
  }
  return [`Ambient ${intent.kind} completed.`];
}

function extractChangedGroupIds(
  result: FieldState | ResolutionResult,
  before: FieldState,
  after: FieldState,
): string[] {
  if ("changedGroupIds" in result) return [...result.changedGroupIds];
  const beforeById = new Map(before.groups.map((group) => [group.id, group]));
  return after.groups
    .filter(
      (group) =>
        serializeStable(beforeById.get(group.id) ?? null) !==
        serializeStable(group),
    )
    .map((group) => group.id);
}

function createRecoveryField(
  field: FieldState,
  reason: string,
  timestamp: string,
): FieldState {
  return {
    ...field,
    ambient: {
      ...field.ambient,
      currentMode: "recovery",
      previousMode: field.ambient.currentMode,
      requestedMode: "recovery",
      transitionReason: "workflow-failed",
      transitionTimestamp: timestamp,
      context: {
        ...field.ambient.context,
        originMode: field.ambient.currentMode,
        recoveryReason: reason.slice(0, 240),
        focusedAction: "none",
        pendingEventIds: [],
        temporary: {},
      },
      lastTransition: {
        id: makeId("ambient-transition"),
        from: field.ambient.currentMode,
        to: "recovery",
        reason: "workflow-failed",
        requestedAt: timestamp,
        accepted: true,
        message: reason.slice(0, 240),
      },
    },
  };
}

function extractGeneratedEvents(result: FieldState | ResolutionResult) {
  return "events" in result ? [...result.events] : [];
}
