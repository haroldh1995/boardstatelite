import type { FieldState, PermanentGroup, Zone } from "../domain/types";
import { getZoneCompositionSnapshot } from "../domain/zoneComposition";
import { serializeStable } from "../utils/stableSerialization";
import type { PlannedAction } from "../echo/preTurnPlannerTypes";
import type {
  AthenaDecisionAnswer,
  AthenaDecisionCandidate,
  AthenaDecisionConstraints,
  AthenaDecisionContinuation,
  AthenaDecisionDiagnostics,
  AthenaDecisionQueueState,
  AthenaDecisionRequest,
  AthenaDecisionResponseResult,
  AthenaDecisionStatus,
  AthenaDecisionType,
  AthenaDecisionValidationResult,
  AthenaDecisionVoiceInput,
  AthenaTargetConstraints,
} from "./decisionEngineTypes";
import {
  ATHENA_DECISION_ENGINE_VERSION,
  ATHENA_DECISION_QUEUE_SCHEMA_VERSION,
} from "./decisionEngineTypes";
import type { AthenaTriggerResolutionEligibility } from "./triggerResolutionTypes";
import type { AthenaReplacementProcessingResult } from "./replacementEffectTypes";
import type { AthenaForecastInput } from "./eventForecastTypes";
import { ATHENA_EVENT_CATEGORIES } from "./dependencyGraphTypes";
import type {
  AthenaPendingTriggerQueueSnapshot,
  AthenaTriggerInstance,
} from "./triggerQueueTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
export const ATHENA_DECISION_MAX_CANDIDATES = 500;
const TERMINAL_STATUSES = new Set<AthenaDecisionStatus>([
  "answered",
  "declined",
  "cancelled",
  "stale",
  "invalidated",
]);
const MAGIC_COLORS = ["White", "Blue", "Black", "Red", "Green"];
const CARD_TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Kindred",
  "Land",
  "Planeswalker",
  "Sorcery",
];

export interface AthenaDecisionRequestInput {
  id?: string;
  sessionId: string;
  participantId: string;
  type: AthenaDecisionType;
  prompt: string;
  sourceEventId?: string | null;
  sourceObjectId?: string | null;
  triggerId?: string | null;
  preparedActionId?: string | null;
  candidates?: AthenaDecisionCandidate[];
  constraints?: Partial<AthenaDecisionConstraints>;
  targetConstraints?: Partial<AthenaTargetConstraints> | null;
  defaultValue?: string | number | boolean | null;
  authoritySource?: AthenaDecisionRequest["authoritySource"];
  authorityRequired?: boolean;
  forecastReference?: string | null;
  stateFingerprint: string;
  stateVersion?: string;
  continuation?: AthenaDecisionContinuation;
  reasonCodes?: string[];
  timestamp?: string;
  prepared?: boolean;
}

export function createDefaultAthenaDecisionQueue(
  input: Partial<AthenaDecisionQueueState> = {},
): AthenaDecisionQueueState {
  return {
    schemaVersion: ATHENA_DECISION_QUEUE_SCHEMA_VERSION,
    version: ATHENA_DECISION_ENGINE_VERSION,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    participantId:
      typeof input.participantId === "string" ? input.participantId : null,
    activeDecisionId:
      typeof input.activeDecisionId === "string"
        ? input.activeDecisionId
        : null,
    requests: Array.isArray(input.requests)
      ? input.requests.map(copyRequest).slice(-80)
      : [],
    committedResponseIds: uniqueStrings(input.committedResponseIds).slice(-160),
    preferences: Array.isArray(input.preferences)
      ? input.preferences.map((preference) => ({ ...preference })).slice(-40)
      : [],
    diagnostics: normalizeDiagnostics(input.diagnostics),
    updatedAt:
      typeof input.updatedAt === "string" ? input.updatedAt : DEFAULT_TIMESTAMP,
  };
}

export function normalizeAthenaDecisionQueue(
  value: unknown,
  options: {
    sessionId?: string | null;
    participantId?: string | null;
    timestamp?: string;
  } = {},
): AthenaDecisionQueueState {
  const timestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
  if (!value || typeof value !== "object") {
    return createDefaultAthenaDecisionQueue({
      sessionId: options.sessionId ?? null,
      participantId: options.participantId ?? null,
      updatedAt: timestamp,
    });
  }
  const candidate = value as Partial<AthenaDecisionQueueState>;
  const sessionId = options.sessionId ?? candidate.sessionId ?? null;
  const participantId =
    options.participantId ?? candidate.participantId ?? null;
  const requests = Array.isArray(candidate.requests)
    ? candidate.requests
        .filter(isDecisionRequest)
        .map(copyRequest)
        .map((request) => {
          if (
            (sessionId && request.sessionId !== sessionId) ||
            (participantId && request.participantId !== participantId)
          ) {
            return {
              ...request,
              status: "stale" as const,
              updatedAt: timestamp,
              reasonCodes: uniqueStrings([
                ...request.reasonCodes,
                "session-replaced",
              ]),
            };
          }
          return request.status === "active"
            ? { ...request, status: "pending" as const }
            : request;
        })
        .slice(-80)
    : [];
  const requestedActive =
    typeof candidate.activeDecisionId === "string"
      ? (requests.find(
          (request) =>
            request.id === candidate.activeDecisionId &&
            !TERMINAL_STATUSES.has(request.status),
        )?.id ?? null)
      : null;
  const activeDecisionId =
    requestedActive ??
    requests.find((request) => !TERMINAL_STATUSES.has(request.status))?.id ??
    null;
  return createDefaultAthenaDecisionQueue({
    ...candidate,
    sessionId,
    participantId,
    requests: requests.map((request) => ({
      ...request,
      status:
        request.id === activeDecisionId && request.status === "pending"
          ? "active"
          : request.status,
    })),
    activeDecisionId,
    updatedAt: timestamp,
  });
}

export function createAthenaDecisionRequest(
  input: AthenaDecisionRequestInput,
): AthenaDecisionRequest {
  const timestamp = input.timestamp ?? DEFAULT_TIMESTAMP;
  const target = input.targetConstraints
    ? normalizeTargetConstraints(input.targetConstraints)
    : input.constraints?.target
      ? normalizeTargetConstraints(input.constraints.target)
      : null;
  const constraints = normalizeConstraints({
    ...input.constraints,
    target,
  });
  const allCandidates = uniqueCandidates(input.candidates ?? []);
  const candidates = allCandidates.slice(0, ATHENA_DECISION_MAX_CANDIDATES);
  const continuation = input.continuation ?? { kind: "none", step: 0 };
  const id =
    input.id ??
    `athena-decision:${stableHash(
      serializeStable({
        sessionId: input.sessionId,
        type: input.type,
        sourceEventId: input.sourceEventId ?? null,
        triggerId: input.triggerId ?? null,
        preparedActionId: input.preparedActionId ?? null,
        prompt: input.prompt,
        candidateIds: (input.candidates ?? []).map((candidate) => candidate.id),
        continuationKind: continuation.kind,
        continuationStep: continuation.step,
      }),
    )}`;
  return {
    version: ATHENA_DECISION_ENGINE_VERSION,
    id,
    sessionId: input.sessionId,
    participantId: input.participantId,
    sourceEventId: input.sourceEventId ?? null,
    sourceObjectId: input.sourceObjectId ?? null,
    triggerId: input.triggerId ?? null,
    preparedActionId: input.preparedActionId ?? null,
    type: input.type,
    prompt: input.prompt.trim() || "Provide the required choice.",
    semanticPrompt: input.prompt.trim() || "Provide the required choice.",
    candidates,
    constraints,
    defaultValue: input.defaultValue ?? null,
    authoritySource: input.authoritySource ?? "lite-local-helper-result",
    authorityRequired: Boolean(input.authorityRequired),
    forecastReference: input.forecastReference ?? null,
    stateFingerprint: input.stateFingerprint,
    stateVersion: input.stateVersion ?? input.stateFingerprint,
    continuation,
    status: input.authorityRequired ? "authority-required" : "pending",
    answer: null,
    validation: null,
    reasonCodes: uniqueStrings([
      ...(input.reasonCodes ?? []),
      ...(allCandidates.length > candidates.length
        ? ["candidate-list-bounded"]
        : []),
    ]),
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
    prepared: Boolean(input.prepared),
    required: constraints.required,
    semanticProgress: progressLabel(input.type, constraints, 0),
    directBattlefieldMutation: false,
  };
}

export function enqueueAthenaDecision(
  queueValue: AthenaDecisionQueueState,
  request: AthenaDecisionRequest,
  timestamp = request.createdAt,
): AthenaDecisionQueueState {
  const queue = normalizeAthenaDecisionQueue(queueValue, {
    sessionId: request.sessionId,
    participantId: request.participantId,
    timestamp,
  });
  const existing = queue.requests.find((entry) => entry.id === request.id);
  if (existing) {
    return {
      ...queue,
      activeDecisionId:
        queue.activeDecisionId ??
        (!TERMINAL_STATUSES.has(existing.status) ? existing.id : null),
      updatedAt: timestamp,
    };
  }
  const activeDecisionId =
    queue.activeDecisionId ??
    (TERMINAL_STATUSES.has(request.status) ? null : request.id);
  return {
    ...queue,
    requests: [
      ...queue.requests.map((entry) =>
        entry.id === activeDecisionId && entry.status === "pending"
          ? { ...entry, status: "active" as const }
          : entry,
      ),
      {
        ...request,
        status:
          request.id === activeDecisionId && request.status === "pending"
            ? "active"
            : request.status,
      },
    ].slice(-80),
    activeDecisionId,
    diagnostics: recordCreated(queue.diagnostics, request.type),
    updatedAt: timestamp,
  };
}

export function activeAthenaDecision(
  queue: AthenaDecisionQueueState,
): AthenaDecisionRequest | null {
  return (
    queue.requests.find((request) => request.id === queue.activeDecisionId) ??
    queue.requests.find((request) => !TERMINAL_STATUSES.has(request.status)) ??
    null
  );
}

export function buildAthenaDecisionCandidates(
  field: FieldState,
  constraintsValue: Partial<AthenaTargetConstraints>,
  options: {
    sourceGroupId?: string | null;
    zones?: Zone[];
  } = {},
): AthenaDecisionCandidate[] {
  const constraints = normalizeTargetConstraints({
    ...constraintsValue,
    zones: options.zones ?? constraintsValue.zones,
  });
  const sourceGroupId = options.sourceGroupId ?? null;
  const candidates = field.groups
    .filter((group) => constraints.zones.includes(group.zone))
    .filter((group) => groupMatchesTarget(group, constraints, sourceGroupId))
    .map(groupCandidate);

  if (
    constraints.allowOpponentPlaceholder &&
    (constraints.controller === "opponent" || constraints.controller === "any")
  ) {
    candidates.push({
      id: "opponent-placeholder:target",
      label: opponentPlaceholderLabel(constraints),
      semanticLabel: `${opponentPlaceholderLabel(constraints)}. Manual opponent target.`,
      kind: "opponent-placeholder",
      groupId: null,
      cardId: null,
      zone: constraints.zones[0] ?? "battlefield",
      eligible: true,
      known: false,
      reason:
        "Lite does not require the opponent battlefield to be reconstructed.",
      metadata: { controller: "opponent" },
    });
  }

  for (const zone of constraints.zones) {
    if (
      (zone !== "graveyard" && zone !== "exile") ||
      !constraints.allowUntrackedZoneCard
    ) {
      continue;
    }
    const snapshot = getZoneCompositionSnapshot(field, zone);
    const category = constraints.cardTypes[0]?.toLowerCase();
    const categoryValue = category
      ? (snapshot.categoryTotals[
          category as keyof typeof snapshot.categoryTotals
        ] ?? 0)
      : snapshot.physicalTotal;
    const knownEligible = candidates
      .filter((candidate) => candidate.zone === zone && candidate.known)
      .reduce(
        (sum, candidate) => sum + Number(candidate.metadata.quantity ?? 1),
        0,
      );
    if (
      snapshot.unaccountedPhysicalCards > 0 ||
      categoryValue > knownEligible
    ) {
      const label = `Other / Untracked ${constraints.cardTypes[0] ?? "Card"}`;
      candidates.push({
        id: `untracked:${zone}:${normalizeLabel(constraints.cardTypes[0] ?? "card")}`,
        label,
        semanticLabel: `${label} in ${zone}. Identification may be required.`,
        kind: "untracked-card",
        groupId: null,
        cardId: null,
        zone,
        eligible: true,
        known: false,
        reason:
          "Zone composition indicates that an eligible untracked card may exist.",
        metadata: {
          unaccountedPhysicalCards: snapshot.unaccountedPhysicalCards,
          categoryValue,
        },
      });
    }
  }
  return uniqueCandidates(candidates).slice(0, ATHENA_DECISION_MAX_CANDIDATES);
}

export function createAthenaTriggerDecisionRequest(input: {
  field: FieldState;
  trigger: AthenaTriggerInstance;
  eligibility: AthenaTriggerResolutionEligibility;
  queue: AthenaPendingTriggerQueueSnapshot;
  collectedDecision?: import("./triggerResolutionTypes").AthenaTriggerResolutionDecision;
  timestamp?: string;
}): AthenaDecisionRequest | null {
  const { field, trigger, eligibility, queue } = input;
  const timestamp = input.timestamp ?? field.updatedAt;
  const type = decisionTypeForEligibility(eligibility.status);
  if (!type) return null;
  const unresolved = trigger.requirements.filter(
    (requirement) => requirement.status === "unresolved",
  );
  const candidateIds = uniqueStrings(
    unresolved.flatMap((requirement) => requirement.candidateGroupIds),
  );
  const targetConstraints = targetConstraintsForTrigger(trigger, type);
  let candidates =
    type === "target-selection" ||
    type === "multi-target-selection" ||
    type === "object-selection"
      ? buildAthenaDecisionCandidates(field, targetConstraints, {
          sourceGroupId: trigger.source.sourceGroupId,
        })
      : [];
  if (candidateIds.length > 0) {
    candidates = candidates.filter(
      (candidate) =>
        candidate.groupId === null || candidateIds.includes(candidate.groupId),
    );
  }
  if (type === "mode-selection") {
    candidates = optionCandidates(
      delimitedKnownValue(trigger.knownValues.modeOptions),
      "mode",
    );
  }
  if (type === "trigger-order") {
    candidates = queue.entries
      .filter(
        (entry) =>
          entry.ordering.sameEventGroupId ===
            trigger.ordering.sameEventGroupId &&
          !["resolved", "declined", "cancelled", "invalidated"].includes(
            entry.queueState,
          ),
      )
      .map((entry) => ({
        id: entry.id,
        label: entry.source.label,
        semanticLabel: `${entry.source.label} trigger.`,
        kind: "trigger" as const,
        groupId: entry.source.sourceGroupId,
        cardId: null,
        zone: null,
        eligible: true,
        known: true,
        reason: null,
        metadata: { multiplicity: entry.logicalMultiplicity ?? 0 },
      }));
  }
  const minimum = integerKnownValue(trigger.knownValues.minimumSelections) ?? 1;
  const maximum =
    integerKnownValue(trigger.knownValues.maximumSelections) ?? minimum;
  return createAthenaDecisionRequest({
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    type,
    prompt: eligibility.reason,
    sourceEventId: trigger.eventLineage.finalEventId,
    sourceObjectId: trigger.source.sourceGroupId,
    triggerId: trigger.id,
    candidates,
    targetConstraints,
    constraints: {
      minimumSelections: minimum,
      maximumSelections: Math.max(minimum, maximum),
      exactSelections: minimum === maximum ? minimum : null,
      quantityMinimum:
        integerKnownValue(trigger.knownValues.minimumQuantity) ?? 0,
      quantityMaximum: integerKnownValue(trigger.knownValues.maximumQuantity),
      required: true,
      dismissible: type === "optional-effect",
    },
    stateFingerprint: athenaDecisionStateFingerprint(field),
    stateVersion: field.updatedAt,
    authoritySource: trigger.authoritySource,
    authorityRequired: eligibility.status === "authority-required",
    continuation: {
      kind: "trigger-resolution",
      step: 0,
      triggerId: trigger.id,
      queue,
      collectedDecision: { ...(input.collectedDecision ?? {}) },
    },
    reasonCodes: [eligibility.status, ...eligibility.missingRequirements],
    timestamp,
  });
}

export function createAthenaPreparedChoiceRequest(input: {
  field: FieldState;
  action: PlannedAction;
  timestamp?: string;
}): AthenaDecisionRequest | null {
  const requirement = input.action.execution.requirements.find((entry) => {
    if (entry === "target")
      return input.action.execution.targetGroupIds.length === 0;
    if (entry === "quantity") return input.action.execution.quantity <= 0;
    if (entry === "mode") return !input.action.execution.mode;
    return entry === "selection" || entry === "order";
  });
  if (!requirement) return null;
  const type: AthenaDecisionType =
    requirement === "target"
      ? "target-selection"
      : requirement === "quantity"
        ? "quantity"
        : requirement === "mode"
          ? "mode-selection"
          : requirement === "order"
            ? "trigger-order"
            : "object-selection";
  const targetConstraints = normalizeTargetConstraints({
    controller: "you",
    zones: ["battlefield"],
  });
  return createAthenaDecisionRequest({
    sessionId: input.field.session.id,
    participantId: input.field.multiplayer.registry.localParticipantId,
    type,
    prompt:
      type === "target-selection"
        ? "Choose the prepared target."
        : `Choose ${requirement}.`,
    preparedActionId: input.action.prepared.preparedActionId,
    candidates:
      type === "target-selection"
        ? buildAthenaDecisionCandidates(input.field, targetConstraints)
        : [],
    targetConstraints,
    constraints: { required: true, dismissible: false },
    stateFingerprint: athenaDecisionStateFingerprint(input.field),
    stateVersion: input.field.updatedAt,
    continuation: {
      kind: "prepared-action",
      step: 0,
      preparedActionId: input.action.prepared.preparedActionId,
      collectedDecision: {
        targetGroupIds: [...input.action.execution.targetGroupIds],
        quantity: input.action.execution.quantity,
        mode: input.action.execution.mode ?? undefined,
      },
    },
    timestamp: input.timestamp ?? input.field.updatedAt,
    prepared: true,
  });
}

export function createAthenaReplacementDecisionRequest(input: {
  field: FieldState;
  event: AthenaForecastInput;
  replacement: AthenaReplacementProcessingResult;
  queue: AthenaPendingTriggerQueueSnapshot;
  optionalDecisions?: Record<string, boolean>;
  selectedOrder?: string[];
  timestamp?: string;
}): AthenaDecisionRequest | null {
  const choice = input.replacement.requiredChoices[0];
  if (!choice) return null;
  const type: AthenaDecisionType =
    choice.kind === "replacement-order"
      ? "replacement-order"
      : choice.kind === "optional-decision"
        ? "optional-replacement"
        : "unsupported-rules-choice";
  const definitions = new Map(
    input.replacement.applicableDefinitions.map((definition) => [
      definition.relationshipId,
      definition,
    ]),
  );
  const candidates: AthenaDecisionCandidate[] = choice.relationshipIds.map(
    (relationshipId) => {
      const definition = definitions.get(relationshipId);
      return {
        id: relationshipId,
        label: definition?.sourceLabel ?? "Replacement effect",
        semanticLabel: `${definition?.sourceLabel ?? "Replacement effect"}.`,
        kind: "replacement",
        groupId: definition?.sourceGroupId ?? null,
        cardId: null,
        zone: null,
        eligible: true,
        known: Boolean(definition),
        reason: null,
        metadata: {
          category: definition?.modification.category ?? "unknown",
        },
      };
    },
  );
  return createAthenaDecisionRequest({
    sessionId: input.field.session.id,
    participantId: input.field.multiplayer.registry.localParticipantId,
    type,
    prompt:
      type === "replacement-order"
        ? "Choose replacement order."
        : type === "optional-replacement"
          ? "Use this replacement effect?"
          : choice.prompt,
    sourceEventId: input.event.eventId,
    candidates,
    constraints: {
      exactSelections: type === "replacement-order" ? candidates.length : null,
      minimumSelections: type === "replacement-order" ? candidates.length : 0,
      maximumSelections: type === "replacement-order" ? candidates.length : 1,
      required: true,
      dismissible: false,
    },
    stateFingerprint: athenaDecisionStateFingerprint(input.field),
    stateVersion: input.field.updatedAt,
    authoritySource: input.replacement.authoritySource,
    continuation: {
      kind: "replacement-processing",
      step: 0,
      eventId: input.event.eventId,
      replacementResultId: input.replacement.id,
      relationshipIds: [...choice.relationshipIds],
      event: input.event,
      queue: input.queue,
      optionalDecisions: { ...(input.optionalDecisions ?? {}) },
      selectedOrder: [...(input.selectedOrder ?? [])],
    },
    reasonCodes: [choice.kind, input.replacement.validity],
    timestamp: input.timestamp ?? input.field.updatedAt,
  });
}

export function validateAthenaDecisionAnswer(
  request: AthenaDecisionRequest,
  answerValue: Partial<AthenaDecisionAnswer>,
  field: FieldState,
  timestamp = field.updatedAt,
): AthenaDecisionValidationResult {
  if (
    request.sessionId !== field.session.id ||
    request.participantId !== field.multiplayer.registry.localParticipantId
  ) {
    return invalidValidation(
      "The decision belongs to an obsolete session.",
      ["session-mismatch"],
      true,
    );
  }
  if (TERMINAL_STATUSES.has(request.status)) {
    return invalidValidation("The decision is already complete.", [
      "terminal-decision",
    ]);
  }
  if (request.authorityRequired) {
    return invalidValidation("BoardState authority is required.", [
      "authority-required",
    ]);
  }
  const answer = normalizeAnswer(
    request.id,
    answerValue,
    timestamp,
    request.constraints.allowRepeatedOptions,
  );
  const candidateIds = new Set(
    request.candidates
      .filter((candidate) => candidate.eligible)
      .map((candidate) => candidate.id),
  );
  const selectedIds = uniqueStrings([
    ...answer.selectedOptionIds,
    ...answer.targetGroupIds,
    ...answer.selectedGroupIds,
  ]);
  if (
    selectedIds.some(
      (id) =>
        !candidateIds.has(id) &&
        !request.candidates.some(
          (candidate) => candidate.groupId === id && candidate.eligible,
        ),
    )
  ) {
    return invalidValidation(
      "A selected option is no longer available.",
      ["invalid-option"],
      true,
    );
  }
  const currentCandidates = request.constraints.target
    ? buildAthenaDecisionCandidates(field, request.constraints.target, {
        sourceGroupId: request.sourceObjectId,
      })
    : request.candidates;
  const currentGroupIds = new Set(
    currentCandidates.flatMap((candidate) =>
      candidate.groupId ? [candidate.groupId] : [],
    ),
  );
  if (
    answer.targetGroupIds.some((id) => !currentGroupIds.has(id)) ||
    answer.selectedGroupIds.some((id) => !currentGroupIds.has(id))
  ) {
    return invalidValidation(
      "The selected target is no longer eligible.",
      ["stale-target"],
      true,
    );
  }

  const selectionCount =
    answer.targetGroupIds.length > 0
      ? answer.targetGroupIds.length
      : answer.selectedGroupIds.length > 0
        ? answer.selectedGroupIds.length
        : answer.selectedOptionIds.length;
  if (decisionNeedsSelections(request.type)) {
    const minimum = request.constraints.minimumSelections;
    const maximum = request.constraints.maximumSelections;
    if (selectionCount < minimum || selectionCount > maximum) {
      return invalidValidation(
        `Choose between ${minimum} and ${maximum} option${maximum === 1 ? "" : "s"}.`,
        ["selection-count"],
      );
    }
    if (
      request.constraints.target?.distinct &&
      selectionCount !== selectedIds.length
    ) {
      return invalidValidation("Selections must be distinct.", [
        "distinct-selection-required",
      ]);
    }
    if (
      !request.constraints.allowRepeatedOptions &&
      selectionCount !== selectedIds.length
    ) {
      return invalidValidation("Options cannot be selected more than once.", [
        "repeated-selection-not-allowed",
      ]);
    }
  }
  if (
    request.type === "optional-effect" ||
    request.type === "optional-replacement" ||
    request.type === "yes-no"
  ) {
    if (answer.accepted === null) {
      return invalidValidation("Choose yes or no.", ["missing-decision"]);
    }
  }
  if (request.type === "quantity" || request.type === "x-value") {
    if (answer.quantity === null || !Number.isSafeInteger(answer.quantity)) {
      return invalidValidation("Choose a whole-number quantity.", [
        "invalid-quantity",
      ]);
    }
    const minimum = request.constraints.quantityMinimum ?? 0;
    const maximum = request.constraints.quantityMaximum;
    if (
      answer.quantity < minimum ||
      (maximum !== null && answer.quantity > maximum)
    ) {
      return invalidValidation(
        maximum === null
          ? `Choose ${minimum} or more.`
          : `Choose between ${minimum} and ${maximum}.`,
        ["quantity-out-of-range"],
      );
    }
  }
  if (request.type === "distribution") {
    const allowed = new Set(
      request.candidates.flatMap((candidate) => [
        candidate.id,
        ...(candidate.groupId ? [candidate.groupId] : []),
      ]),
    );
    if (Object.keys(answer.distribution).some((id) => !allowed.has(id))) {
      return invalidValidation(
        "A distribution target is not eligible.",
        ["invalid-distribution-target"],
        true,
      );
    }
    const values = Object.values(answer.distribution);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      return invalidValidation("Distribution values must be whole numbers.", [
        "invalid-distribution",
      ]);
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    if (
      request.constraints.quantityTotal !== null &&
      total !== request.constraints.quantityTotal
    ) {
      return invalidValidation(
        `Distribute exactly ${request.constraints.quantityTotal}.`,
        ["distribution-total"],
      );
    }
  }
  if (request.type === "manual-result") {
    const manual = answer.manualResult;
    if (
      !manual ||
      !ATHENA_EVENT_CATEGORIES.includes(
        manual.eventCategory as (typeof ATHENA_EVENT_CATEGORIES)[number],
      ) ||
      !Number.isSafeInteger(manual.quantity) ||
      manual.quantity <= 0
    ) {
      return invalidValidation("Report a supported structured result.", [
        "invalid-manual-result",
      ]);
    }
    if (
      manual.targetGroupIds.some(
        (groupId) => !field.groups.some((group) => group.id === groupId),
      )
    ) {
      return invalidValidation(
        "A manual-result target is no longer available.",
        ["stale-target"],
        true,
      );
    }
    if (
      [
        "counter-placed",
        "counter-removed",
        "permanent-died",
        "permanent-exiled",
        "permanent-returned-to-hand",
      ].includes(manual.eventCategory) &&
      manual.targetGroupIds.length === 0
    ) {
      return invalidValidation("This result requires a known target.", [
        "missing-target",
      ]);
    }
    if (
      manual.eventCategory === "token-created" &&
      (!manual.tokenName ||
        !Number.isSafeInteger(manual.tokenPower) ||
        !Number.isSafeInteger(manual.tokenToughness))
    ) {
      return invalidValidation(
        "Token results require a name and power/toughness.",
        ["incomplete-token-definition"],
      );
    }
  }
  return {
    valid: true,
    stale: false,
    reason: "Decision response is valid.",
    reasonCodes: ["validated-current-state"],
    normalizedAnswer: answer,
  };
}

export function answerAthenaDecision(
  queueValue: AthenaDecisionQueueState,
  decisionId: string,
  answer: Partial<AthenaDecisionAnswer>,
  field: FieldState,
  timestamp = field.updatedAt,
): AthenaDecisionResponseResult {
  const queue = normalizeAthenaDecisionQueue(queueValue, {
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    timestamp,
  });
  const request = queue.requests.find((entry) => entry.id === decisionId);
  if (!request) {
    const missing = createAthenaDecisionRequest({
      id: decisionId,
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      type: "manual-confirmation",
      prompt: "Decision is unavailable.",
      stateFingerprint: athenaDecisionStateFingerprint(field),
      timestamp,
    });
    const validation = invalidValidation("The decision was not found.", [
      "missing-decision",
    ]);
    return {
      accepted: false,
      duplicatePrevented: false,
      request: missing,
      queue,
      validation,
      continuation: missing.continuation,
      semanticDescription: validation.reason,
    };
  }
  const responseId =
    answer.responseId ??
    `athena-decision-response:${stableHash(
      serializeStable({ decisionId, answer }),
    )}`;
  if (
    queue.committedResponseIds.includes(responseId) ||
    request.answer !== null ||
    request.status === "answered" ||
    request.status === "declined"
  ) {
    const validation = invalidValidation(
      "This decision was already answered.",
      ["duplicate-response-prevented"],
    );
    return {
      accepted: false,
      duplicatePrevented: true,
      request,
      queue: {
        ...queue,
        diagnostics: {
          ...queue.diagnostics,
          duplicateResponsePreventions:
            queue.diagnostics.duplicateResponsePreventions + 1,
        },
      },
      validation,
      continuation: request.continuation,
      semanticDescription: validation.reason,
    };
  }
  const validation = validateAthenaDecisionAnswer(
    request,
    { ...answer, responseId },
    field,
    timestamp,
  );
  if (!validation.valid || !validation.normalizedAnswer) {
    const recoverableStale =
      validation.stale && !validation.reasonCodes.includes("session-mismatch");
    const refreshedCandidates =
      recoverableStale && request.constraints.target
        ? buildAthenaDecisionCandidates(field, request.constraints.target, {
            sourceGroupId: request.sourceObjectId,
          })
        : request.candidates;
    const invalidated: AthenaDecisionRequest = {
      ...request,
      status: recoverableStale
        ? "active"
        : validation.stale
          ? "stale"
          : request.status,
      candidates: refreshedCandidates,
      validation,
      updatedAt: timestamp,
      reasonCodes: uniqueStrings([
        ...request.reasonCodes,
        ...validation.reasonCodes,
      ]),
    };
    return {
      accepted: false,
      duplicatePrevented: false,
      request: invalidated,
      queue: {
        ...queue,
        requests: queue.requests.map((entry) =>
          entry.id === decisionId ? invalidated : entry,
        ),
        activeDecisionId:
          validation.stale && !recoverableStale
            ? nextPendingId(queue, decisionId)
            : decisionId,
        diagnostics: {
          ...queue.diagnostics,
          staleResponseRejections:
            queue.diagnostics.staleResponseRejections +
            (validation.stale ? 1 : 0),
          lastDecisionError: validation.reason,
        },
        updatedAt: timestamp,
      },
      validation,
      continuation: request.continuation,
      semanticDescription: validation.reason,
    };
  }
  const normalizedAnswer = validation.normalizedAnswer;
  const declined =
    (request.type === "optional-effect" ||
      request.type === "optional-replacement" ||
      request.type === "yes-no") &&
    normalizedAnswer.accepted === false;
  const completed: AthenaDecisionRequest = {
    ...request,
    status: declined ? "declined" : "answered",
    answer: normalizedAnswer,
    validation,
    updatedAt: timestamp,
    resolvedAt: timestamp,
    semanticProgress: declined ? "Declined" : "Choice recorded",
  };
  const nextId = nextPendingId(queue, decisionId);
  const requests = queue.requests.map((entry) =>
    entry.id === decisionId
      ? completed
      : entry.id === nextId && entry.status === "pending"
        ? { ...entry, status: "active" as const }
        : entry,
  );
  const diagnostics = {
    ...queue.diagnostics,
    decisionsAnswered: queue.diagnostics.decisionsAnswered + 1,
    voiceResponses:
      queue.diagnostics.voiceResponses +
      (normalizedAnswer.channel === "voice" ? 1 : 0),
    touchResponses:
      queue.diagnostics.touchResponses +
      (normalizedAnswer.channel === "touch" ? 1 : 0),
    lastDecisionError: null,
  };
  return {
    accepted: true,
    duplicatePrevented: false,
    request: completed,
    queue: {
      ...queue,
      requests,
      activeDecisionId: nextId,
      committedResponseIds: uniqueStrings([
        ...queue.committedResponseIds,
        responseId,
      ]).slice(-160),
      diagnostics,
      updatedAt: timestamp,
    },
    validation,
    continuation: request.continuation,
    semanticDescription: declined
      ? `${request.prompt} Declined.`
      : `${request.prompt} Choice recorded.`,
  };
}

export function answerAthenaDecisionFromVoice(
  queue: AthenaDecisionQueueState,
  field: FieldState,
  input: AthenaDecisionVoiceInput,
): AthenaDecisionResponseResult | null {
  const request = queue.requests.find((entry) => entry.id === input.decisionId);
  if (!request || !input.speakerVerified) return null;
  const text = input.transcript.trim().toLowerCase();
  const timestamp = input.timestamp ?? field.updatedAt;
  const answer: Partial<AthenaDecisionAnswer> = {
    responseId:
      input.responseId ??
      `athena-voice-response:${stableHash(`${input.decisionId}:${text}`)}`,
    channel: "voice",
    answeredAt: timestamp,
  };
  if (
    request.type === "optional-effect" ||
    request.type === "optional-replacement" ||
    request.type === "yes-no"
  ) {
    if (/^(yes|yeah|yep|accept|use it|do it)$/.test(text))
      answer.accepted = true;
    else if (/^(no|nope|decline|skip|don't|do not)$/.test(text))
      answer.accepted = false;
    else return null;
  } else if (request.type === "quantity" || request.type === "x-value") {
    const quantity = parseSpokenInteger(text);
    if (quantity === null) return null;
    answer.quantity = quantity;
  } else {
    const candidate = request.candidates.find(
      (entry) =>
        entry.eligible &&
        (normalizeLabel(entry.label) === normalizeLabel(text) ||
          normalizeLabel(text).includes(normalizeLabel(entry.label))),
    );
    if (!candidate) return null;
    answer.selectedOptionIds = [candidate.id];
    if (candidate.groupId) {
      answer.targetGroupIds = [candidate.groupId];
      answer.selectedGroupIds = [candidate.groupId];
    }
    if (request.type === "mode-selection") answer.mode = candidate.label;
    if (request.type === "color-selection") answer.color = candidate.label;
    if (request.type === "card-type-selection")
      answer.cardType = candidate.label;
    if (request.type === "creature-type-selection")
      answer.creatureType = candidate.label;
    if (request.type === "counter-type-selection")
      answer.counterType = candidate.label;
  }
  return answerAthenaDecision(queue, request.id, answer, field, timestamp);
}

export function revalidateAthenaDecisions(
  field: FieldState,
  timestamp = field.updatedAt,
): FieldState {
  const normalized = normalizeAthenaDecisionQueue(field.athena.decisions, {
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    timestamp,
  });
  const requests = normalized.requests.map((request) => {
    if (TERMINAL_STATUSES.has(request.status) || !request.constraints.target) {
      return request;
    }
    const candidates = buildAthenaDecisionCandidates(
      field,
      request.constraints.target,
      { sourceGroupId: request.sourceObjectId },
    );
    const priorSpecial = request.candidates.filter(
      (candidate) =>
        candidate.kind !== "battlefield-object" &&
        candidate.kind !== "zone-card",
    );
    return {
      ...request,
      candidates: uniqueCandidates([...candidates, ...priorSpecial]).slice(
        0,
        ATHENA_DECISION_MAX_CANDIDATES,
      ),
      stateFingerprint: athenaDecisionStateFingerprint(field),
      stateVersion: field.updatedAt,
      updatedAt: timestamp,
    };
  });
  return {
    ...field,
    athena: {
      ...field.athena,
      decisions: normalizeAthenaDecisionQueue(
        { ...normalized, requests, updatedAt: timestamp },
        {
          sessionId: field.session.id,
          participantId: field.multiplayer.registry.localParticipantId,
          timestamp,
        },
      ),
    },
  };
}

export function cancelAthenaDecision(
  queue: AthenaDecisionQueueState,
  decisionId: string,
  timestamp: string,
): AthenaDecisionQueueState {
  const request = queue.requests.find((entry) => entry.id === decisionId);
  if (!request || request.required || !request.constraints.dismissible)
    return queue;
  const nextId = nextPendingId(queue, decisionId);
  return {
    ...queue,
    activeDecisionId: nextId,
    requests: queue.requests.map((entry) =>
      entry.id === decisionId
        ? { ...entry, status: "cancelled" as const, updatedAt: timestamp }
        : entry.id === nextId && entry.status === "pending"
          ? { ...entry, status: "active" as const }
          : entry,
    ),
    diagnostics: {
      ...queue.diagnostics,
      decisionsCancelled: queue.diagnostics.decisionsCancelled + 1,
    },
    updatedAt: timestamp,
  };
}

export function setAthenaOptionalDecisionPreference(
  queue: AthenaDecisionQueueState,
  input: {
    key: string;
    decisionType: "optional-effect" | "optional-replacement";
    sourceDefinitionId?: string | null;
    answer: "accept" | "decline";
    scope: "turn" | "session";
    turnId?: string | null;
    timestamp: string;
  },
): AthenaDecisionQueueState {
  const preference = {
    key: input.key,
    decisionType: input.decisionType,
    sourceDefinitionId: input.sourceDefinitionId ?? null,
    answer: input.answer,
    scope: input.scope,
    turnId: input.turnId ?? null,
    createdAt: input.timestamp,
  } as const;
  return {
    ...queue,
    preferences: [
      ...queue.preferences.filter((entry) => entry.key !== input.key),
      preference,
    ].slice(-40),
    updatedAt: input.timestamp,
  };
}

export function clearAthenaDecisionPreference(
  queue: AthenaDecisionQueueState,
  key: string,
  timestamp: string,
): AthenaDecisionQueueState {
  return {
    ...queue,
    preferences: queue.preferences.filter((entry) => entry.key !== key),
    updatedAt: timestamp,
  };
}

export function athenaOptionalPreferenceAnswer(
  queue: AthenaDecisionQueueState,
  key: string,
  turnId: string | null,
): boolean | null {
  const preference = [...queue.preferences]
    .reverse()
    .find(
      (entry) =>
        entry.key === key &&
        (entry.scope === "session" || entry.turnId === turnId),
    );
  if (!preference) return null;
  return preference.answer === "accept";
}

export function answerToTriggerResolutionDecision(
  request: AthenaDecisionRequest,
): import("./triggerResolutionTypes").AthenaTriggerResolutionDecision {
  const prior =
    request.continuation.kind === "trigger-resolution" ||
    request.continuation.kind === "prepared-action"
      ? request.continuation.collectedDecision
      : {};
  const answer = request.answer;
  if (!answer) return { ...prior };
  return {
    ...prior,
    optionalAccepted: answer.accepted ?? prior.optionalAccepted,
    targetGroupIds:
      answer.targetGroupIds.length > 0
        ? [...answer.targetGroupIds]
        : prior.targetGroupIds,
    selectedGroupIds:
      answer.selectedGroupIds.length > 0
        ? [...answer.selectedGroupIds]
        : prior.selectedGroupIds,
    quantity: answer.quantity ?? prior.quantity,
    mode: answer.mode ?? prior.mode,
    selectedOptionIds: [...answer.selectedOptionIds],
    modes: [...answer.modes],
    distribution: { ...answer.distribution },
    color: answer.color ?? undefined,
    cardType: answer.cardType ?? undefined,
    creatureType: answer.creatureType ?? undefined,
    counterType: answer.counterType ?? undefined,
    orderIds: [...answer.orderIds],
    orderingConfirmed:
      answer.orderIds.length > 0 || prior.orderingConfirmed === true,
  };
}

export function athenaDecisionStateFingerprint(field: FieldState): string {
  return stableHash(
    serializeStable({
      sessionId: field.session.id,
      groups: field.groups.map((group) => ({
        id: group.id,
        zone: group.zone,
        quantity: group.quantity,
        controller: group.controller,
        cardTypes: group.characteristics.cardTypes,
        subtypes: group.characteristics.subtypes,
        colors: group.characteristics.colors,
        transformed: group.statuses.transformed,
        depowered: group.statuses.depowered,
        trackingEnabled: group.trackingEnabled,
      })),
      zoneCompositions: field.zoneCompositions,
    }),
  );
}

export function colorDecisionCandidates(): AthenaDecisionCandidate[] {
  return optionCandidates(MAGIC_COLORS, "color");
}

export function cardTypeDecisionCandidates(): AthenaDecisionCandidate[] {
  return optionCandidates(CARD_TYPES, "card-type");
}

export function creatureTypeDecisionCandidates(
  field: FieldState,
  deckSubtypes: string[] = [],
  recent: string[] = [],
): AthenaDecisionCandidate[] {
  const battlefield = field.groups.flatMap((group) =>
    group.characteristics.isCreature ? group.characteristics.subtypes : [],
  );
  return optionCandidates(
    uniqueStrings([...recent, ...battlefield, ...deckSubtypes]),
    "creature-type",
  );
}

export function counterTypeDecisionCandidates(
  field: FieldState,
  targetGroupIds: string[] = [],
): AthenaDecisionCandidate[] {
  const targetSet = new Set(targetGroupIds);
  const names = field.groups
    .filter((group) => targetSet.size === 0 || targetSet.has(group.id))
    .flatMap((group) => Object.keys(group.counters));
  return optionCandidates(
    uniqueStrings(["+1/+1", "Shield", "Stun", ...names]),
    "counter-type",
  );
}

function normalizeConstraints(
  value: Partial<AthenaDecisionConstraints>,
): AthenaDecisionConstraints {
  const exact = nullableInteger(value.exactSelections);
  const minimum = Math.max(0, integer(value.minimumSelections, exact ?? 1));
  const maximum = Math.max(
    minimum,
    integer(value.maximumSelections, exact ?? minimum),
  );
  return {
    minimumSelections: exact ?? minimum,
    maximumSelections: exact ?? maximum,
    exactSelections: exact,
    quantityMinimum: nullableInteger(value.quantityMinimum),
    quantityMaximum: nullableInteger(value.quantityMaximum),
    quantityTotal: nullableInteger(value.quantityTotal),
    allowRepeatedOptions: Boolean(value.allowRepeatedOptions),
    required: value.required !== false,
    dismissible: Boolean(value.dismissible),
    target: value.target ? normalizeTargetConstraints(value.target) : null,
  };
}

function normalizeTargetConstraints(
  value: Partial<AthenaTargetConstraints>,
): AthenaTargetConstraints {
  return {
    controller:
      value.controller === "opponent" || value.controller === "any"
        ? value.controller
        : "you",
    zones:
      Array.isArray(value.zones) && value.zones.length > 0
        ? uniqueZones(value.zones)
        : ["battlefield"],
    cardTypes: uniqueStrings(value.cardTypes),
    excludedCardTypes: uniqueStrings(value.excludedCardTypes),
    subtypes: uniqueStrings(value.subtypes),
    colors: uniqueStrings(value.colors),
    tokenStatus:
      value.tokenStatus === "token" || value.tokenStatus === "nontoken"
        ? value.tokenStatus
        : "any",
    distinct: value.distinct !== false,
    sourceExcluded: Boolean(value.sourceExcluded),
    authorityExhaustive: Boolean(value.authorityExhaustive),
    allowOpponentPlaceholder: Boolean(value.allowOpponentPlaceholder),
    allowUntrackedZoneCard: Boolean(value.allowUntrackedZoneCard),
  };
}

function targetConstraintsForTrigger(
  trigger: AthenaTriggerInstance,
  type: AthenaDecisionType,
): AthenaTargetConstraints {
  const prompt = trigger.requirements
    .map((requirement) => requirement.prompt)
    .join(" ")
    .toLowerCase();
  const creature = prompt.includes("creature");
  return normalizeTargetConstraints({
    controller: prompt.includes("opponent") ? "opponent" : "you",
    zones: prompt.includes("graveyard")
      ? ["graveyard"]
      : prompt.includes("exile")
        ? ["exile"]
        : ["battlefield"],
    cardTypes: creature ? ["Creature"] : [],
    allowOpponentPlaceholder: prompt.includes("opponent"),
    allowUntrackedZoneCard:
      prompt.includes("graveyard") || prompt.includes("exile"),
    sourceExcluded: prompt.includes("another") || prompt.includes("other"),
    distinct: type === "multi-target-selection",
  });
}

function groupMatchesTarget(
  group: PermanentGroup,
  constraints: AthenaTargetConstraints,
  sourceGroupId: string | null,
): boolean {
  if (constraints.sourceExcluded && group.id === sourceGroupId) return false;
  if (constraints.controller === "you" && group.controller !== "you")
    return false;
  if (constraints.controller === "opponent" && group.controller !== "opponent")
    return false;
  const types = group.characteristics.cardTypes.map((type) =>
    type.toLowerCase(),
  );
  if (
    constraints.cardTypes.length > 0 &&
    !constraints.cardTypes.every((type) => types.includes(type.toLowerCase()))
  ) {
    return false;
  }
  if (
    constraints.excludedCardTypes.some((type) =>
      types.includes(type.toLowerCase()),
    )
  ) {
    return false;
  }
  const subtypes = group.characteristics.subtypes.map((type) =>
    type.toLowerCase(),
  );
  if (
    constraints.subtypes.length > 0 &&
    !constraints.subtypes.some((type) => subtypes.includes(type.toLowerCase()))
  ) {
    return false;
  }
  const colors = group.characteristics.colors.map((color) =>
    color.toLowerCase(),
  );
  if (
    constraints.colors.length > 0 &&
    !constraints.colors.some((color) => colors.includes(color.toLowerCase()))
  ) {
    return false;
  }
  if (constraints.tokenStatus === "token" && !group.characteristics.isToken)
    return false;
  if (constraints.tokenStatus === "nontoken" && group.characteristics.isToken)
    return false;
  return true;
}

function groupCandidate(group: PermanentGroup): AthenaDecisionCandidate {
  return {
    id: group.id,
    label: group.label,
    semanticLabel: `${group.label}. Eligible target.`,
    kind:
      group.zone === "graveyard" || group.zone === "exile"
        ? "zone-card"
        : "battlefield-object",
    groupId: group.id,
    cardId: group.identity?.cardId ?? null,
    zone: group.zone,
    eligible: true,
    known: Boolean(group.identity) || !group.isGeneric,
    reason: null,
    metadata: {
      quantity: group.quantity,
      creature: group.characteristics.isCreature,
      token: group.characteristics.isToken,
    },
  };
}

function decisionTypeForEligibility(
  status: AthenaTriggerResolutionEligibility["status"],
): AthenaDecisionType | null {
  if (status === "awaiting-optional-decision") return "optional-effect";
  if (status === "awaiting-target") return "target-selection";
  if (status === "awaiting-quantity") return "quantity";
  if (status === "awaiting-mode") return "mode-selection";
  if (status === "awaiting-selection") return "object-selection";
  if (status === "awaiting-order") return "trigger-order";
  if (status === "authority-required") return "unsupported-rules-choice";
  if (status === "manual-resolution-required" || status === "unsupported")
    return "manual-result";
  return null;
}

function normalizeAnswer(
  decisionId: string,
  input: Partial<AthenaDecisionAnswer>,
  timestamp: string,
  allowRepeatedOptions = false,
): AthenaDecisionAnswer {
  return {
    decisionId,
    responseId:
      input.responseId ??
      `athena-decision-response:${stableHash(
        serializeStable({ decisionId, input, timestamp }),
      )}`,
    selectedOptionIds: allowRepeatedOptions
      ? stringList(input.selectedOptionIds)
      : uniqueStrings(input.selectedOptionIds),
    targetGroupIds: uniqueStrings(input.targetGroupIds),
    selectedGroupIds: uniqueStrings(input.selectedGroupIds),
    quantity: nullableInteger(input.quantity),
    mode: typeof input.mode === "string" ? input.mode : null,
    modes: allowRepeatedOptions
      ? stringList(input.modes)
      : uniqueStrings(input.modes),
    accepted: typeof input.accepted === "boolean" ? input.accepted : null,
    distribution: normalizeDistribution(input.distribution),
    color: typeof input.color === "string" ? input.color : null,
    cardType: typeof input.cardType === "string" ? input.cardType : null,
    creatureType:
      typeof input.creatureType === "string" ? input.creatureType : null,
    counterType:
      typeof input.counterType === "string" ? input.counterType : null,
    orderIds: uniqueStrings(input.orderIds),
    manualResult: input.manualResult
      ? copyManualResult(input.manualResult)
      : null,
    channel:
      input.channel === "voice" ||
      input.channel === "prepared" ||
      input.channel === "boardstate" ||
      input.channel === "restore"
        ? input.channel
        : "touch",
    answeredAt:
      typeof input.answeredAt === "string" ? input.answeredAt : timestamp,
  };
}

function optionCandidates(
  labels: string[],
  kind: AthenaDecisionCandidate["kind"],
): AthenaDecisionCandidate[] {
  return uniqueStrings(labels)
    .filter(Boolean)
    .map((label) => ({
      id: `${kind}:${normalizeLabel(label)}`,
      label,
      semanticLabel: label,
      kind,
      groupId: null,
      cardId: null,
      zone: null,
      eligible: true,
      known: true,
      reason: null,
      metadata: {},
    }));
}

function recordCreated(
  diagnostics: AthenaDecisionDiagnostics,
  type: AthenaDecisionType,
): AthenaDecisionDiagnostics {
  return {
    ...diagnostics,
    requestsCreated: diagnostics.requestsCreated + 1,
    targetDecisions:
      diagnostics.targetDecisions +
      (type === "target-selection" || type === "multi-target-selection"
        ? 1
        : 0),
    modeDecisions:
      diagnostics.modeDecisions +
      (type === "mode-selection" || type === "multi-mode-selection" ? 1 : 0),
    optionalDecisions:
      diagnostics.optionalDecisions +
      (type === "optional-effect" || type === "optional-replacement" ? 1 : 0),
    xDecisions: diagnostics.xDecisions + (type === "x-value" ? 1 : 0),
    quantityDecisions:
      diagnostics.quantityDecisions + (type === "quantity" ? 1 : 0),
    distributionDecisions:
      diagnostics.distributionDecisions + (type === "distribution" ? 1 : 0),
    triggerOrderDecisions:
      diagnostics.triggerOrderDecisions + (type === "trigger-order" ? 1 : 0),
    replacementOrderDecisions:
      diagnostics.replacementOrderDecisions +
      (type === "replacement-order" ? 1 : 0),
    manualResultFallbacks:
      diagnostics.manualResultFallbacks + (type === "manual-result" ? 1 : 0),
    boardStateEscalations:
      diagnostics.boardStateEscalations +
      (type === "unsupported-rules-choice" ? 1 : 0),
  };
}

function normalizeDiagnostics(
  value: Partial<AthenaDecisionDiagnostics> | undefined,
): AthenaDecisionDiagnostics {
  const count = (key: keyof AthenaDecisionDiagnostics) =>
    Math.max(0, integer(value?.[key], 0));
  return {
    version: ATHENA_DECISION_ENGINE_VERSION,
    requestsCreated: count("requestsCreated"),
    decisionsAnswered: count("decisionsAnswered"),
    decisionsCancelled: count("decisionsCancelled"),
    decisionsInvalidated: count("decisionsInvalidated"),
    preparedChoicesReused: count("preparedChoicesReused"),
    preparedChoicesRerequested: count("preparedChoicesRerequested"),
    targetDecisions: count("targetDecisions"),
    modeDecisions: count("modeDecisions"),
    optionalDecisions: count("optionalDecisions"),
    xDecisions: count("xDecisions"),
    quantityDecisions: count("quantityDecisions"),
    distributionDecisions: count("distributionDecisions"),
    triggerOrderDecisions: count("triggerOrderDecisions"),
    replacementOrderDecisions: count("replacementOrderDecisions"),
    manualResultFallbacks: count("manualResultFallbacks"),
    boardStateEscalations: count("boardStateEscalations"),
    voiceResponses: count("voiceResponses"),
    touchResponses: count("touchResponses"),
    duplicateResponsePreventions: count("duplicateResponsePreventions"),
    staleResponseRejections: count("staleResponseRejections"),
    averageDecisionOpenDurationMs: count("averageDecisionOpenDurationMs"),
    averageResponseToResolutionDurationMs: count(
      "averageResponseToResolutionDurationMs",
    ),
    candidateGenerationDurationMs: count("candidateGenerationDurationMs"),
    lastDecisionError:
      typeof value?.lastDecisionError === "string"
        ? value.lastDecisionError
        : null,
    productionVisible: false,
  };
}

function isDecisionRequest(value: unknown): value is AthenaDecisionRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AthenaDecisionRequest>;
  return (
    candidate.version === ATHENA_DECISION_ENGINE_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.participantId === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.prompt === "string" &&
    Boolean(candidate.continuation)
  );
}

function copyRequest(request: AthenaDecisionRequest): AthenaDecisionRequest {
  return {
    ...request,
    candidates: request.candidates.map((candidate) => ({
      ...candidate,
      metadata: { ...candidate.metadata },
    })),
    constraints: {
      ...request.constraints,
      target: request.constraints.target
        ? {
            ...request.constraints.target,
            zones: [...request.constraints.target.zones],
            cardTypes: [...request.constraints.target.cardTypes],
            excludedCardTypes: [
              ...request.constraints.target.excludedCardTypes,
            ],
            subtypes: [...request.constraints.target.subtypes],
            colors: [...request.constraints.target.colors],
          }
        : null,
    },
    continuation: structuredCloneContinuation(request.continuation),
    answer: request.answer
      ? {
          ...request.answer,
          selectedOptionIds: [...request.answer.selectedOptionIds],
          targetGroupIds: [...request.answer.targetGroupIds],
          selectedGroupIds: [...request.answer.selectedGroupIds],
          modes: [...request.answer.modes],
          distribution: { ...request.answer.distribution },
          orderIds: [...request.answer.orderIds],
          manualResult: request.answer.manualResult
            ? copyManualResult(request.answer.manualResult)
            : null,
        }
      : null,
    validation: request.validation
      ? {
          ...request.validation,
          reasonCodes: [...request.validation.reasonCodes],
          normalizedAnswer: request.validation.normalizedAnswer
            ? normalizeAnswer(
                request.id,
                request.validation.normalizedAnswer,
                request.validation.normalizedAnswer.answeredAt,
                request.constraints.allowRepeatedOptions,
              )
            : null,
        }
      : null,
    reasonCodes: [...request.reasonCodes],
  };
}

function structuredCloneContinuation(
  continuation: AthenaDecisionContinuation,
): AthenaDecisionContinuation {
  if (continuation.kind === "trigger-resolution") {
    return JSON.parse(
      JSON.stringify(continuation),
    ) as AthenaDecisionContinuation;
  }
  if (continuation.kind === "prepared-action") {
    return {
      ...continuation,
      collectedDecision: { ...continuation.collectedDecision },
    };
  }
  if (continuation.kind === "replacement-processing") {
    return JSON.parse(
      JSON.stringify(continuation),
    ) as AthenaDecisionContinuation;
  }
  return { ...continuation };
}

function invalidValidation(
  reason: string,
  reasonCodes: string[],
  stale = false,
): AthenaDecisionValidationResult {
  return { valid: false, stale, reason, reasonCodes, normalizedAnswer: null };
}

function decisionNeedsSelections(type: AthenaDecisionType): boolean {
  return [
    "target-selection",
    "multi-target-selection",
    "mode-selection",
    "multi-mode-selection",
    "color-selection",
    "card-type-selection",
    "creature-type-selection",
    "counter-type-selection",
    "object-selection",
    "card-selection",
    "zone-card-selection",
    "trigger-order",
    "replacement-order",
  ].includes(type);
}

function nextPendingId(
  queue: AthenaDecisionQueueState,
  excludingId: string,
): string | null {
  return (
    queue.requests.find(
      (request) =>
        request.id !== excludingId && !TERMINAL_STATUSES.has(request.status),
    )?.id ?? null
  );
}

function progressLabel(
  type: AthenaDecisionType,
  constraints: AthenaDecisionConstraints,
  selected: number,
): string {
  if (
    type === "multi-target-selection" ||
    type === "multi-mode-selection" ||
    constraints.maximumSelections > 1
  ) {
    return `${selected} of ${constraints.maximumSelections} selected.`;
  }
  return "Awaiting one choice.";
}

function uniqueCandidates(
  candidates: AthenaDecisionCandidate[],
): AthenaDecisionCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.id || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ];
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function uniqueZones(values: Zone[]): Zone[] {
  return [...new Set(values)];
}

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function integerKnownValue(value: unknown): number | null {
  return nullableInteger(value);
}

function delimitedKnownValue(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function normalizeDistribution(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([, quantity]) =>
          typeof quantity === "number" && Number.isFinite(quantity),
      )
      .map(([key, quantity]) => [key, Math.trunc(quantity as number)]),
  );
}

function copyManualResult(
  value: NonNullable<AthenaDecisionAnswer["manualResult"]>,
): NonNullable<AthenaDecisionAnswer["manualResult"]> {
  return {
    ...value,
    targetGroupIds: [...value.targetGroupIds],
    tokenCardTypes: [...value.tokenCardTypes],
    tokenSubtypes: [...value.tokenSubtypes],
    tokenColors: [...value.tokenColors],
  };
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function opponentPlaceholderLabel(
  constraints: AthenaTargetConstraints,
): string {
  if (constraints.cardTypes.includes("Creature")) return "Opponent Creature";
  if (constraints.cardTypes.length > 0)
    return `Opponent ${constraints.cardTypes[0]}`;
  return "Opponent Permanent";
}

function parseSpokenInteger(value: string): number | null {
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  const numbers: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  return numbers[value] ?? null;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
