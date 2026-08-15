import {
  createCardGroup,
  createGenericGroup,
  createTokenGroup,
  mergeCompatibleStacks,
  recalculateStats,
  splitGroupForQuantity,
  withStackKey,
} from "../domain/cards";
import { calculateTotals } from "../domain/field";
import {
  ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
  getAthenaTriggerResolutionDefinition,
  type AthenaResolutionAction,
  type AthenaResolutionQuantity,
  type AthenaTriggerResolutionDefinition,
} from "../domain/triggerResolutionDefinitions";
import type {
  CustomEffect,
  FieldState,
  GameEvent,
  ValueExpression,
} from "../domain/types";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import { applyAthenaDerivedStateToField } from "./derivedState";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";
import type {
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import { processAthenaReplacementEffects } from "./replacementEffect";
import {
  AthenaPendingTriggerQueue,
  generateAthenaTriggerInstances,
} from "./triggerQueue";
import type {
  AthenaPendingTriggerQueueSnapshot,
  AthenaTriggerInstance,
  AthenaTriggerQueueState,
} from "./triggerQueueTypes";
import {
  ATHENA_TRIGGER_RESOLUTION_VERSION,
  type AthenaAutoResolutionBudget,
  type AthenaAutoResolutionCycleResult,
  type AthenaAutoResolutionStopReason,
  type AthenaCanonicalEventCommitResult,
  type AthenaConfirmedConsequencePipelineResult,
  type AthenaTriggerResolutionDecision,
  type AthenaTriggerResolutionDiagnostics,
  type AthenaTriggerResolutionEligibility,
  type AthenaTriggerResolutionEligibilityStatus,
  type AthenaTriggerResolutionEventRecord,
  type AthenaTriggerResolutionOptions,
  type AthenaTriggerResolutionResult,
  type AthenaTriggerResolutionStatus,
} from "./triggerResolutionTypes";

export const DEFAULT_ATHENA_AUTO_RESOLUTION_BUDGET: AthenaAutoResolutionBudget =
  Object.freeze({
    maximumTriggers: 32,
    maximumGeneratedEvents: 128,
    maximumCascadeDepth: 4,
    maximumDurationMs: 250,
    maximumRepeatedPattern: 3,
    maximumQueueGrowth: 256,
  });

interface ResolvedDefinition {
  definition: AthenaTriggerResolutionDefinition;
  custom: boolean;
}

interface ProposedActionEvent {
  action: AthenaResolutionAction;
  event: AthenaForecastInput;
  logicalEventCount: number;
  quantityPerLogicalEvent: number;
}

export class AthenaTriggerResolutionCancellationController {
  private readonly state = {
    cancelled: false,
    reason: null as string | null,
  };

  readonly signal = this.state;

  cancel(reason = "Trigger resolution was cancelled."): void {
    this.state.cancelled = true;
    this.state.reason = reason;
  }
}

export function evaluateAthenaTriggerResolutionEligibility(
  trigger: AthenaTriggerInstance,
  field: FieldState,
  decision: AthenaTriggerResolutionDecision = {},
  options: { requireConfirmation?: boolean } = {},
): AthenaTriggerResolutionEligibility {
  const environment = createForecastEnvironment(field);
  const resolvedDefinition = definitionForTrigger(trigger, field);
  const definition = resolvedDefinition?.definition ?? null;
  const definitionId = definition?.id ?? null;
  const result = (
    status: AthenaTriggerResolutionEligibilityStatus,
    reason: string,
    missingRequirements: string[] = [],
  ): AthenaTriggerResolutionEligibility => ({
    version: ATHENA_TRIGGER_RESOLUTION_VERSION,
    triggerInstanceId: trigger.id,
    status,
    reason,
    definitionId,
    missingRequirements,
    selectedTargetGroupIds: uniqueStrings([
      ...(decision.targetGroupIds ?? []),
      ...(decision.selectedGroupIds ?? []),
    ]),
    resolutionAuthority:
      trigger.authoritySource === "boardstate-authoritative-result"
        ? "boardstate-authoritative-result"
        : "lite-local-helper-result",
    deterministic:
      status === "auto-resolvable" || status === "ready-for-confirmation",
    canMutateCanonicalState: false,
    semanticDescription: reason,
  });

  if (
    trigger.canonicalSessionId !== environment.context.sessionId ||
    trigger.participantId !== environment.context.localParticipantId
  ) {
    return result("stale", "The trigger belongs to an obsolete session.");
  }
  if (
    !trigger.eventLineage.finalEventId ||
    !trigger.eventLineage.originalEventId ||
    trigger.causingEvent.metadata.stale === true ||
    trigger.causingEvent.metadata.invalidated === true
  ) {
    return result("stale", "The trigger no longer has valid event lineage.");
  }
  if (
    trigger.queueState === "resolved" ||
    trigger.queueState === "declined" ||
    trigger.queueState === "cancelled" ||
    trigger.queueState === "invalidated" ||
    trigger.resolutionReference
  ) {
    return result(
      "invalid",
      "This trigger is terminal and cannot produce another consequence.",
    );
  }
  if (trigger.queueState === "stale") {
    return result("stale", "The pending trigger is stale.");
  }
  if (trigger.ordering.authorityOrderingRequired) {
    return result(
      "authority-required",
      "BoardState authority is required to order this trigger.",
      ["ordering"],
    );
  }
  if (
    trigger.ordering.userOrderingRequired &&
    decision.orderingConfirmed !== true
  ) {
    return result(
      "awaiting-order",
      "Choose the trigger order before resolution.",
      ["ordering"],
    );
  }
  if (trigger.authoritySource === "boardstate-authoritative-result") {
    return result(
      "authority-required",
      "BoardState must commit its authoritative trigger result.",
    );
  }
  if (!definition) {
    if (trigger.queueState === "authority-required") {
      return result(
        "authority-required",
        "BoardState authority is required for this trigger.",
      );
    }
    if (trigger.queueState === "unsupported") {
      return result("unsupported", "This trigger is not supported locally.");
    }
    return result(
      "manual-resolution-required",
      "This trigger has no validated structured resolution definition.",
    );
  }
  if (definition.requiresAuthority) {
    return result(
      "authority-required",
      "BoardState authority is required for this structured resolution.",
    );
  }
  if (definition.requiresManualResolution || !definition.locallySupported) {
    return result(
      "manual-resolution-required",
      "Resolve this interaction physically and report the result.",
    );
  }
  if (
    !definition.observedEvents.includes(trigger.observedEventCategory) ||
    !Number.isSafeInteger(trigger.logicalMultiplicity) ||
    (trigger.logicalMultiplicity ?? 0) <= 0
  ) {
    return result(
      "invalid",
      "The structured definition does not match this trigger occurrence.",
    );
  }
  if (trigger.optional && decision.optionalAccepted === undefined) {
    return result(
      "awaiting-optional-decision",
      "Choose whether to use this optional effect.",
      ["optional-decision"],
    );
  }
  if (trigger.optional && decision.optionalAccepted === false) {
    return result(
      "ready-for-confirmation",
      "The optional trigger is ready to be declined.",
    );
  }

  const unresolvedKinds = trigger.requirements
    .filter((requirement) => requirement.status === "unresolved")
    .map((requirement) => requirement.kind);
  if (
    unresolvedKinds.some((kind) => kind === "target" || kind === "player") &&
    (decision.targetGroupIds?.length ?? 0) === 0
  ) {
    return result("awaiting-target", "Choose a target.", ["target"]);
  }
  if (
    unresolvedKinds.some(
      (kind) => kind === "quantity" || kind === "opponent-value",
    ) &&
    decision.quantity === undefined
  ) {
    return result("awaiting-quantity", "Choose a quantity.", ["quantity"]);
  }
  if (unresolvedKinds.includes("mode") && !decision.mode) {
    return result("awaiting-mode", "Choose a mode.", ["mode"]);
  }
  if (
    unresolvedKinds.includes("object") &&
    (decision.selectedGroupIds?.length ?? 0) === 0
  ) {
    return result("awaiting-selection", "Choose the required permanent.", [
      "selection",
    ]);
  }
  if (unresolvedKinds.includes("authority")) {
    return result(
      "authority-required",
      "BoardState authority is required for a resolution choice.",
    );
  }
  if (unresolvedKinds.includes("manual-resolution")) {
    return result(
      "manual-resolution-required",
      "This trigger requires manual resolution.",
    );
  }
  if (
    definition.actions.some(
      (action) =>
        action.quantity.kind === "current-source-counters" ||
        action.quantity.kind === "current-source-counters-to-add",
    ) &&
    (trigger.logicalMultiplicity ?? 0) > 1
  ) {
    return result(
      "manual-resolution-required",
      "Grouped dynamic resolutions require separate event ordering.",
    );
  }
  const suppliedTargets = uniqueStrings([
    ...(decision.targetGroupIds ?? []),
    ...(decision.selectedGroupIds ?? []),
  ]);
  if (
    suppliedTargets.some(
      (groupId) =>
        !field.groups.some(
          (group) => group.id === groupId && group.zone === "battlefield",
        ),
    )
  ) {
    return result("invalid", "A selected target is no longer available.");
  }
  if (
    decision.quantity !== undefined &&
    (!Number.isSafeInteger(decision.quantity) || decision.quantity < 0)
  ) {
    return result("invalid", "The selected quantity is invalid.");
  }
  return result(
    options.requireConfirmation ? "ready-for-confirmation" : "auto-resolvable",
    options.requireConfirmation
      ? "This deterministic trigger is ready for confirmation."
      : "All supported resolution requirements are known.",
  );
}

export function resolveAthenaPendingTrigger(
  field: FieldState,
  queue: AthenaPendingTriggerQueue,
  triggerId: string,
  options: AthenaTriggerResolutionOptions = {},
): AthenaTriggerResolutionResult {
  const started = monotonicNowMs();
  const timestamp = options.timestamp ?? field.updatedAt;
  const trigger = queue.get(triggerId);
  if (!trigger) {
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger: null,
      timestamp,
      status: "invalid",
      eligibility: invalidEligibility(triggerId, "The trigger was not found."),
      reason: "The trigger was not found.",
    });
  }
  if (options.cancellation?.cancelled) {
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: "cancelled",
      eligibility: invalidEligibility(
        trigger.id,
        options.cancellation.reason ?? "Trigger resolution was cancelled.",
      ),
      reason:
        options.cancellation.reason ?? "Trigger resolution was cancelled.",
    });
  }
  const decision = copyDecision(options.decision ?? {});
  const eligibility = evaluateAthenaTriggerResolutionEligibility(
    trigger,
    field,
    decision,
    { requireConfirmation: options.requireConfirmation },
  );
  if (
    trigger.optional &&
    decision.optionalAccepted === false &&
    eligibility.status === "ready-for-confirmation"
  ) {
    const transactionQueue = queueTransaction(queue);
    transactionQueue.markDeclined(trigger.id, timestamp);
    queue.replaceFromSnapshot(transactionQueue.toSnapshot());
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: "declined",
      eligibility,
      reason: `${trigger.source.label} was declined.`,
    });
  }
  if (
    eligibility.status !== "auto-resolvable" &&
    eligibility.status !== "ready-for-confirmation"
  ) {
    transitionForEligibility(queue, trigger.id, eligibility.status, timestamp);
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: statusForEligibility(eligibility.status),
      eligibility,
      reason: eligibility.reason,
    });
  }

  const resolvedDefinition = definitionForTrigger(trigger, field);
  if (!resolvedDefinition) {
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: "manual-resolution-required",
      eligibility,
      reason: "A structured resolution definition is unavailable.",
    });
  }

  const transactionQueue = queueTransaction(queue);
  if (trigger.optional) transactionQueue.markReady(trigger.id, timestamp);
  else transactionQueue.markAutoResolvable(trigger.id, timestamp);
  if (!transactionQueue.transition(trigger.id, "resolving", timestamp)) {
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: "invalid",
      eligibility,
      reason: "The trigger could not enter the resolving state.",
    });
  }

  const resolutionId = `athena-resolution:${normalizeId(trigger.id)}`;
  let working = field;
  const records: AthenaTriggerResolutionEventRecord[] = [];
  const childTriggerIds: string[] = [];
  try {
    for (
      let actionIndex = 0;
      actionIndex < resolvedDefinition.definition.actions.length;
      actionIndex += 1
    ) {
      if (options.cancellation?.cancelled) {
        throw new Error(
          options.cancellation.reason ?? "Trigger resolution was cancelled.",
        );
      }
      const environment = createForecastEnvironment(working);
      const proposed = proposedEventForAction({
        action: resolvedDefinition.definition.actions[actionIndex],
        actionIndex,
        trigger,
        field: working,
        environment,
        decision,
        resolutionId,
        timestamp,
      });
      const replacement = processAthenaReplacementEffects(
        environment,
        proposed.event,
        {
          timestamp,
          authoritativeFinalEvent:
            options.authoritativeFinalEvents?.[actionIndex],
        },
      );
      if (replacement.validity !== "resolved" || !replacement.finalEvent) {
        throw new Error(
          replacement.warnings[0]?.message ??
            `Replacement processing ended as ${replacement.validity}.`,
        );
      }
      const commit = applyAthenaCanonicalConsequenceEvent(
        working,
        replacement.finalEvent,
        resolutionId,
      );
      if (!commit.valid) throw new Error(commit.reason);
      const generation = generateAthenaTriggerInstances(
        environment,
        replacement,
        { timestamp },
      );
      transactionQueue.addGeneration(generation);
      childTriggerIds.push(
        ...generation.triggerInstances.map((instance) => instance.id),
      );
      working = commit.field;
      records.push({
        id: `${resolutionId}:event:${actionIndex}`,
        action: copyAction(proposed.action),
        proposedEvent: proposed.event,
        replacement,
        finalEvent: replacement.finalEvent,
        canonicalEvent: commit.event,
        changedGroupIds: [...commit.changedGroupIds],
        logicalEventCount: proposed.logicalEventCount,
        quantityPerLogicalEvent: proposed.quantityPerLogicalEvent,
      });
    }
    working = applyAthenaDerivedStateToField(working, {
      timestamp,
    }).field;
    if (!transactionQueue.markResolved(trigger.id, timestamp, resolutionId)) {
      throw new Error("The trigger could not be marked resolved atomically.");
    }
    if (!queue.replaceFromSnapshot(transactionQueue.toSnapshot())) {
      throw new Error("The pending trigger queue changed during resolution.");
    }
    const quantity = records.reduce(
      (sum, record) => sum + (record.finalEvent?.quantity ?? 0),
      0,
    );
    const semantic = semanticResolutionDescription(
      trigger,
      records,
      trigger.logicalMultiplicity ?? 1,
    );
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      id: resolutionId,
      triggerInstanceId: trigger.id,
      triggerGroupId: trigger.groupingKey,
      sourceObjectId: trigger.source.sourceGroupId,
      sourceLabel: trigger.source.label,
      abilityDefinitionId: trigger.source.abilityDefinitionId,
      causingEventLineage: copyLineage(trigger),
      resolutionAuthority: "lite-local-helper-result",
      status: "resolved",
      eligibility,
      logicalMultiplicity: trigger.logicalMultiplicity ?? 1,
      resolutionQuantity: quantity,
      decisions: decision,
      generatedProposedEvents: records.map((record) => record.proposedEvent),
      generatedFinalEvents: records.flatMap((record) =>
        record.finalEvent ? [record.finalEvent] : [],
      ),
      eventRecords: records,
      canonicalEventIds: records.flatMap((record) =>
        record.canonicalEvent ? [record.canonicalEvent.id] : [],
      ),
      childTriggerIds: uniqueStrings(childTriggerIds),
      replacementResultIds: records.map((record) => record.replacement.id),
      resultingField: working,
      queue: queue.toSnapshot(),
      explanationReasonCodes: [
        "structured-resolution",
        "canonical-event-commit",
        "replacement-before-trigger",
      ],
      semanticDescription: semantic,
      accessibilityDescription: semantic,
      failureReason: null,
      manualRequirement: null,
      authorityRequirement: null,
      createdAt: timestamp,
      completedAt: timestamp,
      canonicalStateMutated: true,
      directBattlefieldMutation: false,
      atomic: true,
    };
  } catch (error) {
    const reason = errorMessage(error);
    const failedQueue = queueTransaction(queue);
    failedQueue.markFailedSafe(trigger.id, timestamp);
    queue.replaceFromSnapshot(failedQueue.toSnapshot());
    return terminalResolutionResult({
      field,
      queue: queue.toSnapshot(),
      trigger,
      timestamp,
      status: "failed-safe",
      eligibility,
      reason,
    });
  } finally {
    void started;
  }
}

export class AthenaTriggerResolutionCoordinator {
  private diagnostics = emptyDiagnostics();
  private totalDurationMs = 0;

  process(input: {
    field: FieldState;
    queue: AthenaPendingTriggerQueue;
    timestamp?: string;
    decisions?: Record<string, AthenaTriggerResolutionDecision>;
    budget?: Partial<AthenaAutoResolutionBudget>;
    cancellation?: AthenaTriggerResolutionOptions["cancellation"];
  }): AthenaAutoResolutionCycleResult {
    const started = monotonicNowMs();
    const timestamp = input.timestamp ?? input.field.updatedAt;
    const budget = normalizeBudget(input.budget);
    const initialSize = input.queue.getEntries().length;
    let working = input.field;
    const results: AthenaTriggerResolutionResult[] = [];
    const patterns = new Map<string, number>();
    let eventCount = 0;
    let stop: AthenaAutoResolutionStopReason = "queue-empty";
    let pausedForSafety = false;
    let potentialRepeatingInteraction = false;

    this.diagnostics.autoResolutionCycles += 1;
    this.diagnostics.queueSizeBefore = initialSize;
    while (true) {
      if (input.cancellation?.cancelled) {
        stop = "cancelled";
        break;
      }
      if (
        results.length >= budget.maximumTriggers ||
        eventCount >= budget.maximumGeneratedEvents ||
        monotonicNowMs() - started >= budget.maximumDurationMs ||
        input.queue.getEntries().length - initialSize >=
          budget.maximumQueueGrowth
      ) {
        stop = "safety-budget";
        pausedForSafety = true;
        this.diagnostics.safetyBudgetPauses += 1;
        break;
      }
      const candidates = input.queue
        .getEntries()
        .filter((entry) => !isTerminalQueueState(entry.queueState));
      if (candidates.length === 0) {
        stop = "queue-empty";
        break;
      }
      let selected: AthenaTriggerInstance | null = null;
      let selectedEligibility: AthenaTriggerResolutionEligibility | null = null;
      for (const candidate of candidates) {
        const eligibility = evaluateAthenaTriggerResolutionEligibility(
          candidate,
          working,
          input.decisions?.[candidate.id] ?? {},
        );
        if (eligibility.status === "auto-resolvable") {
          selected = candidate;
          selectedEligibility = eligibility;
          break;
        }
        selectedEligibility ??= eligibility;
      }
      if (!selected) {
        stop = stopReasonForEligibility(selectedEligibility?.status);
        if (selectedEligibility) {
          this.recordEligibility(selectedEligibility);
        }
        break;
      }
      const depth = numericMetadata(
        selected.causingEvent.metadata.cascadeDepth,
      );
      if ((depth ?? 0) >= budget.maximumCascadeDepth) {
        stop = "safety-budget";
        pausedForSafety = true;
        this.diagnostics.safetyBudgetPauses += 1;
        break;
      }
      const pattern = resolutionPattern(selected);
      const repeated = (patterns.get(pattern) ?? 0) + 1;
      patterns.set(pattern, repeated);
      if (repeated > budget.maximumRepeatedPattern) {
        stop = "potential-repeating-interaction";
        pausedForSafety = true;
        potentialRepeatingInteraction = true;
        this.diagnostics.potentialLoopDetections += 1;
        break;
      }
      this.diagnostics.triggerResolutionAttempts += 1;
      const result = resolveAthenaPendingTrigger(
        working,
        input.queue,
        selected.id,
        {
          timestamp,
          decision: input.decisions?.[selected.id],
          cancellation: input.cancellation,
        },
      );
      results.push(result);
      if (result.status !== "resolved") {
        stop = result.status === "failed-safe" ? "failed-safe" : "unsupported";
        this.recordResult(result);
        break;
      }
      working = result.resultingField;
      eventCount += result.canonicalEventIds.length;
      this.recordResult(result);
      this.diagnostics.maximumAutoResolutionDepth = Math.max(
        this.diagnostics.maximumAutoResolutionDepth,
        (depth ?? 0) + 1,
      );
    }

    const duration = monotonicNowMs() - started;
    this.totalDurationMs += duration;
    const cycles = this.diagnostics.autoResolutionCycles;
    this.diagnostics.averageResolutionDurationMs =
      cycles === 0 ? 0 : this.totalDurationMs / cycles;
    this.diagnostics.maximumResolutionDurationMs = Math.max(
      this.diagnostics.maximumResolutionDurationMs,
      duration,
    );
    this.diagnostics.queueSizeAfter = input.queue.getEntries().length;
    const changedIds = new Set(
      results.flatMap((result) =>
        result.eventRecords.flatMap((record) => record.changedGroupIds),
      ),
    );
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      field: working,
      queue: input.queue.toSnapshot(),
      results,
      processedTriggerIds: results.map((result) => result.triggerInstanceId),
      generatedCanonicalEvents: results.flatMap((result) =>
        result.eventRecords.flatMap((record) =>
          record.canonicalEvent ? [record.canonicalEvent] : [],
        ),
      ),
      changedGroups: working.groups.filter((group) => changedIds.has(group.id)),
      stoppedBecause: stop,
      pausedForSafety,
      potentialRepeatingInteraction,
      diagnostics: this.getDiagnostics(),
      semanticDescription: cycleDescription(results, stop),
      directBattlefieldMutation: false,
    };
  }

  getDiagnostics(): AthenaTriggerResolutionDiagnostics {
    return { ...this.diagnostics };
  }

  resetDiagnostics(): void {
    this.diagnostics = emptyDiagnostics();
    this.totalDurationMs = 0;
  }

  private recordEligibility(
    eligibility: AthenaTriggerResolutionEligibility,
  ): void {
    if (eligibility.status.startsWith("awaiting-")) {
      this.diagnostics.userInputRequiredTriggers += 1;
    }
    if (eligibility.status === "authority-required") {
      this.diagnostics.authorityRequiredTriggers += 1;
    }
    if (eligibility.status === "manual-resolution-required") {
      this.diagnostics.manualResolutionTriggers += 1;
    }
    if (eligibility.status === "stale") {
      this.diagnostics.staleResolutionRejectionCount += 1;
    }
  }

  private recordResult(result: AthenaTriggerResolutionResult): void {
    if (result.status === "resolved") {
      this.diagnostics.autoResolvedTriggers += 1;
      this.diagnostics.generatedConsequenceEvents +=
        result.canonicalEventIds.length;
      this.diagnostics.replacementProcessedConsequenceEvents +=
        result.replacementResultIds.length;
      this.diagnostics.logicalTriggerResolutions += result.logicalMultiplicity;
      if (result.logicalMultiplicity > 1) {
        this.diagnostics.groupedTriggerResolutions += 1;
      }
    } else if (result.status === "failed-safe") {
      this.diagnostics.failedSafeResolutions += 1;
      this.diagnostics.lastResolutionError = result.failureReason;
    }
  }
}

export const athenaTriggerResolutionCoordinator =
  new AthenaTriggerResolutionCoordinator();

export function processAthenaPendingTriggers(
  input: Parameters<AthenaTriggerResolutionCoordinator["process"]>[0],
): AthenaAutoResolutionCycleResult {
  return athenaTriggerResolutionCoordinator.process(input);
}

export function processAthenaConfirmedEventWithBookkeeping(input: {
  field: FieldState;
  event: AthenaForecastInput;
  queue: AthenaPendingTriggerQueue;
  timestamp?: string;
  decisions?: Record<string, AthenaTriggerResolutionDecision>;
  budget?: Partial<AthenaAutoResolutionBudget>;
  cancellation?: AthenaTriggerResolutionOptions["cancellation"];
}): AthenaConfirmedConsequencePipelineResult {
  const timestamp = input.timestamp ?? input.event.timestamp;
  const environment = createForecastEnvironment(input.field);
  const replacement = processAthenaReplacementEffects(
    environment,
    input.event,
    { timestamp, cancellation: input.cancellation },
  );
  if (replacement.validity === "bypassed") {
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      originalField: input.field,
      resultingField: input.field,
      proposedEvent: input.event,
      rootReplacement: replacement,
      rootCanonicalEvent: null,
      generatedTriggerIds: [],
      autoResolution: null,
      queue: input.queue.toSnapshot(),
      validity: "correction-bypassed",
      reason:
        "Correction Only remains outside replacement, trigger, and consequence processing.",
      atomic: true,
      directBattlefieldMutation: false,
    };
  }
  if (replacement.validity !== "resolved" || !replacement.finalEvent) {
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      originalField: input.field,
      resultingField: input.field,
      proposedEvent: input.event,
      rootReplacement: replacement,
      rootCanonicalEvent: null,
      generatedTriggerIds: [],
      autoResolution: null,
      queue: input.queue.toSnapshot(),
      validity: replacement.validity === "invalid" ? "invalid" : "unresolved",
      reason:
        replacement.warnings[0]?.message ??
        "Root replacement processing ended as " + replacement.validity + ".",
      atomic: true,
      directBattlefieldMutation: false,
    };
  }
  const generation = generateAthenaTriggerInstances(environment, replacement, {
    timestamp,
  });
  const transactionQueue = queueTransaction(input.queue);
  transactionQueue.addGeneration(generation);
  const rootCommit = applyAthenaCanonicalConsequenceEvent(
    input.field,
    replacement.finalEvent,
    "athena-root:" + normalizeId(replacement.finalEvent.eventId),
  );
  if (!rootCommit.valid) {
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      originalField: input.field,
      resultingField: input.field,
      proposedEvent: input.event,
      rootReplacement: replacement,
      rootCanonicalEvent: null,
      generatedTriggerIds: [],
      autoResolution: null,
      queue: input.queue.toSnapshot(),
      validity: "failed-safe",
      reason: rootCommit.reason,
      atomic: true,
      directBattlefieldMutation: false,
    };
  }
  if (!input.queue.replaceFromSnapshot(transactionQueue.toSnapshot())) {
    return {
      version: ATHENA_TRIGGER_RESOLUTION_VERSION,
      originalField: input.field,
      resultingField: input.field,
      proposedEvent: input.event,
      rootReplacement: replacement,
      rootCanonicalEvent: null,
      generatedTriggerIds: [],
      autoResolution: null,
      queue: input.queue.toSnapshot(),
      validity: "failed-safe",
      reason: "The pending trigger queue changed before the root commit.",
      atomic: true,
      directBattlefieldMutation: false,
    };
  }
  const autoResolution = processAthenaPendingTriggers({
    field: rootCommit.field,
    queue: input.queue,
    timestamp,
    decisions: input.decisions,
    budget: input.budget,
    cancellation: input.cancellation,
  });
  return {
    version: ATHENA_TRIGGER_RESOLUTION_VERSION,
    originalField: input.field,
    resultingField: autoResolution.field,
    proposedEvent: input.event,
    rootReplacement: replacement,
    rootCanonicalEvent: rootCommit.event,
    generatedTriggerIds: generation.triggerInstances.map(
      (trigger) => trigger.id,
    ),
    autoResolution,
    queue: input.queue.toSnapshot(),
    validity: "committed",
    reason: "The confirmed event and deterministic consequences committed.",
    atomic: true,
    directBattlefieldMutation: false,
  };
}

export function applyAthenaCanonicalConsequenceEvent(
  field: FieldState,
  event: AthenaForecastInput,
  resolutionId: string,
): AthenaCanonicalEventCommitResult {
  const fail = (reason: string): AthenaCanonicalEventCommitResult => ({
    event: gameEventFromForecast(event, resolutionId),
    field,
    changedGroupIds: [],
    generatedGroupIds: [],
    valid: false,
    reason,
  });
  if (
    event.canonicalSessionId !== field.session.id ||
    event.authoritySource === "correction-only" ||
    event.eventSource === "correction-only" ||
    !Number.isSafeInteger(event.quantity) ||
    event.quantity <= 0
  ) {
    return fail("The consequence event is invalid for the canonical session.");
  }
  let working: FieldState = {
    ...field,
    player: {
      ...field.player,
      counters: {
        ...field.player.counters,
        custom: { ...field.player.counters.custom },
      },
      statuses: { ...field.player.statuses },
    },
    groups: [...field.groups],
    updatedAt: event.timestamp,
  };
  const changed = new Set<string>();
  const generated = new Set<string>();

  if (
    event.eventCategory === "land-entered" ||
    event.eventCategory === "permanent-entered" ||
    event.eventCategory === "creature-entered"
  ) {
    const destination = event.zoneDestination ?? "battlefield";
    const existingIds = [...new Set(event.subjectGroupIds)];
    if (existingIds.length > 0) {
      if (existingIds.length !== 1) {
        return fail("Prepared permanent entry supports one grouped subject.");
      }
      const existing = working.groups.find(
        (group) => group.id === existingIds[0],
      );
      if (!existing || existing.zone === "battlefield") {
        return fail("The prepared card is no longer in its expected zone.");
      }
      const quantity = Math.min(existing.quantity, event.quantity);
      const split = splitGroupForQuantity(
        working.groups,
        existing.id,
        quantity,
      );
      if (!split.targetId) return fail("The prepared card could not be moved.");
      working.groups = split.groups.map((group) =>
        group.id === split.targetId
          ? applyEntryState(
              withStackKey({ ...group, zone: destination }),
              event,
            )
          : group,
      );
      changed.add(split.targetId);
    } else {
      let group = event.permanentDefinition
        ? createCardGroup(
            event.permanentDefinition,
            event.quantity,
            destination,
          )
        : createGenericGroup({
            kind: genericKindForEntry(event),
            label:
              typeof event.metadata.label === "string"
                ? event.metadata.label
                : event.eventCategory === "land-entered"
                  ? "Generic Land"
                  : "Generic Permanent",
            quantity: event.quantity,
            zone: destination,
            cardTypes: event.knownCharacteristics?.cardTypes,
            subtypes: event.knownCharacteristics?.subtypes,
            token: event.knownCharacteristics?.isToken,
          });
      group = applyEntryState(
        withStackKey({
          ...group,
          id: `athena-group:${stableHash(`${resolutionId}:${event.eventId}:permanent`)}`,
          order: event.sequence,
        }),
        event,
      );
      const beforeIds = new Set(working.groups.map((entry) => entry.id));
      working.groups = mergeCompatibleStacks([...working.groups, group]);
      const retained = working.groups.find(
        (entry) => entry.stackKey === group.stackKey,
      );
      if (!retained)
        return fail("The prepared permanent could not be created.");
      changed.add(retained.id);
      if (!beforeIds.has(retained.id)) generated.add(retained.id);
    }
  } else if (event.eventCategory === "spell-cast") {
    // Casting is a canonical event even when Lite does not model the stack.
  } else if (event.eventCategory === "life-gained") {
    if (working.player.life > Number.MAX_SAFE_INTEGER - event.quantity) {
      return fail("Life total overflow was prevented.");
    }
    working.player.life += event.quantity;
  } else if (event.eventCategory === "life-lost") {
    working.player.life = Math.max(0, working.player.life - event.quantity);
  } else if (
    event.eventCategory === "counter-placed" ||
    event.eventCategory === "counter-removed"
  ) {
    if (!event.counterType || event.subjectGroupIds.length === 0) {
      return fail("Counter consequences require a counter type and recipient.");
    }
    const targetIds = new Set(event.subjectGroupIds);
    let targetCount = 0;
    working.groups = working.groups.map((group) => {
      if (!targetIds.has(group.id) || group.zone !== "battlefield")
        return group;
      targetCount += 1;
      const current = group.counters[event.counterType!] ?? 0;
      const next =
        event.eventCategory === "counter-placed"
          ? safeAdd(current, event.quantity)
          : Math.max(0, current - event.quantity);
      if (next === null) return group;
      changed.add(group.id);
      return withStackKey(
        recalculateStats({
          ...group,
          counters: { ...group.counters, [event.counterType!]: next },
        }),
      );
    });
    if (targetCount !== targetIds.size) {
      return fail("A counter recipient is no longer on the battlefield.");
    }
  } else if (event.eventCategory === "token-created") {
    const token = event.tokenDefinition;
    if (
      !token ||
      token.power === null ||
      token.toughness === null ||
      !Number.isSafeInteger(token.power) ||
      !Number.isSafeInteger(token.toughness)
    ) {
      return fail("Token consequences require a complete token definition.");
    }
    let group = createTokenGroup({
      name: token.name,
      quantity: event.quantity,
      power: token.power,
      toughness: token.toughness,
      subtypes: [...token.characteristics.subtypes],
      colors: [...token.characteristics.colors],
      tapped: event.metadata.tapped === true,
      attacking: event.metadata.attacking === true,
      oracleText:
        typeof event.metadata.oracleText === "string"
          ? event.metadata.oracleText
          : "",
    });
    const cardTypes = uniqueStrings([
      ...token.characteristics.cardTypes,
      "Creature",
    ]);
    const groupId = `athena-group:${stableHash(`${resolutionId}:${event.eventId}:${token.id}`)}`;
    group = withStackKey({
      ...group,
      id: groupId,
      order: event.sequence,
      characteristics: {
        ...group.characteristics,
        cardTypes,
        supertypes: [...token.characteristics.supertypes],
        colors: [...token.characteristics.colors],
        isCreature: true,
        isLegendary: token.characteristics.isLegendary,
        isToken: true,
      },
      identity: group.identity
        ? {
            ...group.identity,
            cardId: token.id,
            typeLine:
              `${cardTypes.join(" ")} - ${token.characteristics.subtypes.join(" ")}`.trim(),
          }
        : null,
    });
    const beforeIds = new Set(working.groups.map((entry) => entry.id));
    working.groups = mergeCompatibleStacks([...working.groups, group]);
    const retained = working.groups.find(
      (entry) => entry.stackKey === group.stackKey,
    );
    if (retained) {
      changed.add(retained.id);
      if (!beforeIds.has(retained.id)) generated.add(retained.id);
    }
  } else if (
    event.eventCategory === "permanent-died" ||
    event.eventCategory === "permanent-sacrificed" ||
    event.eventCategory === "permanent-exiled" ||
    event.eventCategory === "permanent-returned-to-hand" ||
    event.eventCategory === "permanent-returned-to-battlefield"
  ) {
    if (!event.zoneDestination || event.subjectGroupIds.length === 0) {
      return fail(
        "Zone movement consequences require a final destination and subject.",
      );
    }
    const targetIds = [...new Set(event.subjectGroupIds)];
    if (
      targetIds.some((id) => !working.groups.some((group) => group.id === id))
    ) {
      return fail("A zone movement subject is no longer available.");
    }
    for (const targetId of targetIds) {
      const current = working.groups.find((group) => group.id === targetId);
      if (!current)
        return fail("A zone movement subject is no longer available.");
      const quantity =
        targetIds.length === 1
          ? Math.min(current.quantity, event.quantity)
          : current.quantity;
      const split = splitGroupForQuantity(working.groups, current.id, quantity);
      if (!split.targetId)
        return fail("The zone movement could not be prepared.");
      working.groups = split.groups.map((group) =>
        group.id === split.targetId
          ? withStackKey({
              ...group,
              zone: event.zoneDestination!,
              statuses: {
                ...group.statuses,
                attacking: false,
                blocking: false,
              },
            })
          : group,
      );
      changed.add(split.targetId);
    }
  } else if (
    event.eventCategory === "permanent-tapped" ||
    event.eventCategory === "permanent-untapped"
  ) {
    if (event.subjectGroupIds.length === 0) {
      return fail("Tap and untap consequences require a permanent.");
    }
    const targets = new Set(event.subjectGroupIds);
    let found = 0;
    working.groups = working.groups.map((group) => {
      if (!targets.has(group.id) || group.zone !== "battlefield") return group;
      found += 1;
      changed.add(group.id);
      return withStackKey({
        ...group,
        statuses: {
          ...group.statuses,
          tapped: event.eventCategory === "permanent-tapped",
        },
      });
    });
    if (found !== targets.size) {
      return fail("A tap or untap subject is no longer available.");
    }
  } else {
    return fail(
      `The ${event.eventCategory} consequence is not supported by the local canonical committer.`,
    );
  }

  const canonicalEvent = {
    ...gameEventFromForecast(event, resolutionId),
    groupIds:
      event.subjectGroupIds.length > 0
        ? [...event.subjectGroupIds]
        : [...generated, ...changed],
  };
  return {
    event: canonicalEvent,
    field: working,
    changedGroupIds: [...changed].sort((a, b) => a.localeCompare(b)),
    generatedGroupIds: [...generated].sort((a, b) => a.localeCompare(b)),
    valid: true,
    reason: "Consequence committed through the canonical event boundary.",
  };
}

function proposedEventForAction(input: {
  action: AthenaResolutionAction;
  actionIndex: number;
  trigger: AthenaTriggerInstance;
  field: FieldState;
  environment: AthenaForecastEnvironment;
  decision: AthenaTriggerResolutionDecision;
  resolutionId: string;
  timestamp: string;
}): ProposedActionEvent {
  if (input.action.kind === "opponent-result") {
    throw new Error("Opponent-side results require manual resolution in Lite.");
  }
  const logicalMultiplicity = input.trigger.logicalMultiplicity ?? 1;
  const quantityPerLogicalEvent = resolveQuantity(
    input.action.quantity,
    input.trigger,
    input.field,
    input.decision,
  );
  const quantity = safeMultiply(quantityPerLogicalEvent, logicalMultiplicity);
  if (quantity === null || quantity <= 0) {
    throw new Error("The consequence quantity is invalid or overflows safely.");
  }
  const targetGroupIds = targetGroupIdsForAction(
    input.action,
    input.trigger,
    input.field,
    input.decision,
  );
  const cascadeDepth =
    numericMetadata(input.trigger.causingEvent.metadata.cascadeDepth) ?? 0;
  const common = {
    eventId: `${input.resolutionId}:event:${input.actionIndex}`,
    eventCategory: input.action.eventCategory,
    eventSource: "lite-helper" as const,
    authoritySource: "lite-local-helper-result" as const,
    timestamp: input.timestamp,
    sequence:
      input.trigger.ordering.eventSequence * 1000 +
      input.trigger.ordering.generationSequence * 10 +
      input.actionIndex,
    batchId: input.resolutionId,
    sourceObjectId: input.trigger.source.sourceGroupId,
    subjectGroupIds: targetGroupIds,
    quantity,
    metadata: {
      confirmed: true,
      canonicalEvent: true,
      causingTriggerId: input.trigger.id,
      resolutionId: input.resolutionId,
      logicalEventCount: logicalMultiplicity,
      quantityPerLogicalEvent,
      cascadeDepth: cascadeDepth + 1,
      resolutionDefinitionId:
        textValue(input.trigger.knownValues.resolutionDefinitionId) ??
        input.trigger.source.abilityDefinitionId,
    },
  };
  if (input.action.kind === "gain-life" || input.action.kind === "lose-life") {
    return {
      action: copyAction(input.action),
      event: createAthenaForecastInput(
        {
          ...common,
          lifeDelta: input.action.kind === "gain-life" ? quantity : -quantity,
        },
        input.environment,
      ),
      logicalEventCount: logicalMultiplicity,
      quantityPerLogicalEvent,
    };
  }
  if (
    input.action.kind === "add-counter" ||
    input.action.kind === "remove-counter"
  ) {
    return {
      action: copyAction(input.action),
      event: createAthenaForecastInput(
        {
          ...common,
          counterType: input.action.counterType,
        },
        input.environment,
      ),
      logicalEventCount: logicalMultiplicity,
      quantityPerLogicalEvent,
    };
  }
  const tokenAction = input.action as Extract<
    AthenaResolutionAction,
    { kind: "create-token" }
  >;
  const token = tokenForAction(tokenAction, input.trigger, input.field);
  return {
    action: copyAction(input.action),
    event: createAthenaForecastInput(
      {
        ...common,
        knownCharacteristics: token.characteristics,
        tokenDefinition: token,
        metadata: {
          ...common.metadata,
          tapped: tokenAction.token.tapped,
          attacking: tokenAction.token.attacking,
          oracleText: token.oracleText,
        },
      },
      input.environment,
    ),
    logicalEventCount: logicalMultiplicity,
    quantityPerLogicalEvent,
  };
}

function tokenForAction(
  action: Extract<AthenaResolutionAction, { kind: "create-token" }>,
  trigger: AthenaTriggerInstance,
  field: FieldState,
): AthenaForecastInput["tokenDefinition"] & { oracleText: string } {
  const threshold = action.token.copySourceWhenLandThresholdAtLeast;
  if (threshold !== null && calculateTotals(field.groups).lands >= threshold) {
    const source = trigger.source.sourceGroupId
      ? field.groups.find((group) => group.id === trigger.source.sourceGroupId)
      : null;
    if (!source?.identity || !source.characteristics.isCreature) {
      throw new Error("The token-copy source is unavailable at resolution.");
    }
    return {
      id: `token-copy:${source.identity.cardId}`,
      name: source.identity.name,
      power: source.pt.basePower,
      toughness: source.pt.baseToughness,
      characteristics: {
        cardTypes: [...source.characteristics.cardTypes],
        supertypes: source.characteristics.supertypes.filter(
          (type) => type !== "Legendary",
        ),
        subtypes: [...source.characteristics.subtypes],
        colors: [...source.characteristics.colors],
        manaValue: source.characteristics.manaValue,
        isToken: true,
        isCreature: source.characteristics.isCreature,
        isLegendary: false,
        knownFields: [
          "cardTypes",
          "supertypes",
          "subtypes",
          "colors",
          "manaValue",
          "isToken",
          "isCreature",
          "isLegendary",
        ],
      },
      oracleText: source.identity.oracleText,
    };
  }
  return {
    id: `token:${normalizeId(action.token.name)}:${action.token.power}/${action.token.toughness}`,
    name: action.token.name,
    power: action.token.power,
    toughness: action.token.toughness,
    characteristics: {
      cardTypes: [...action.token.cardTypes],
      supertypes: [],
      subtypes: [...action.token.subtypes],
      colors: [...action.token.colors],
      manaValue: 0,
      isToken: true,
      isCreature: action.token.cardTypes.includes("Creature"),
      isLegendary: false,
      knownFields: [
        "cardTypes",
        "supertypes",
        "subtypes",
        "colors",
        "manaValue",
        "isToken",
        "isCreature",
        "isLegendary",
      ],
    },
    oracleText: "",
  };
}

function definitionForTrigger(
  trigger: AthenaTriggerInstance,
  field: FieldState,
): ResolvedDefinition | null {
  const definitionId = textValue(trigger.knownValues.resolutionDefinitionId);
  const known = getAthenaTriggerResolutionDefinition(
    definitionId,
    trigger.source.label,
  );
  if (known) return { definition: known, custom: false };
  const custom = customDefinitionForTrigger(trigger, field);
  return custom ? { definition: custom, custom: true } : null;
}

function customDefinitionForTrigger(
  trigger: AthenaTriggerInstance,
  field: FieldState,
): AthenaTriggerResolutionDefinition | null {
  const candidateId = [
    trigger.source.sourceDefinitionId,
    trigger.source.abilityDefinitionId,
  ]
    .map((value) => value.match(/custom:([^:]+)/)?.[1] ?? null)
    .find(Boolean);
  if (!candidateId) return null;
  const effect = field.customEffects.find(
    (entry) => entry.id === candidateId && entry.enabled,
  );
  if (!effect) return null;
  const action = customAction(effect, field);
  if (!action) return null;
  return {
    id: `custom:${effect.id}`,
    version: ATHENA_TRIGGER_RESOLUTION_DEFINITION_VERSION,
    labels: [effect.name],
    observedEvents: [trigger.observedEventCategory],
    mandatory: true,
    locallySupported: true,
    requiresAuthority: false,
    requiresManualResolution:
      effect.action.kind === "add-counters" &&
      effect.action.target === "selected",
    actions: [action],
    semanticLabel: effect.name,
  };
}

function customAction(
  effect: CustomEffect,
  field: FieldState,
): AthenaResolutionAction | null {
  const amount = resolveValueExpression(effect.action.amount, field);
  if (amount === null || amount <= 0) return null;
  const quantity: AthenaResolutionQuantity = {
    kind: "fixed-per-trigger",
    value: amount,
  };
  if (effect.action.kind === "life") {
    return {
      id: `custom:${effect.id}:life`,
      kind: effect.action.mode === "gain" ? "gain-life" : "lose-life",
      target: "player-controller",
      quantity,
      eventCategory:
        effect.action.mode === "gain" ? "life-gained" : "life-lost",
    };
  }
  if (effect.action.kind === "add-counters") {
    return {
      id: `custom:${effect.id}:counter`,
      kind: "add-counter",
      target:
        effect.action.target === "all-creatures"
          ? "all-controlled-creatures"
          : "selected",
      counterType: effect.action.counter,
      quantity,
      eventCategory: "counter-placed",
    };
  }
  return {
    id: `custom:${effect.id}:token`,
    kind: "create-token",
    target: "player-controller",
    quantity,
    token: {
      name: effect.action.name,
      power: effect.action.power,
      toughness: effect.action.toughness,
      cardTypes: [...effect.action.cardTypes],
      subtypes: [...effect.action.subtypes],
      colors: [],
      tapped: false,
      attacking: false,
      copySourceWhenLandThresholdAtLeast: null,
    },
    eventCategory: "token-created",
  };
}

function resolveValueExpression(
  expression: ValueExpression,
  field: FieldState,
): number | null {
  if (expression.type === "fixed") return safePositive(expression.value);
  if (expression.type === "total") {
    const total = calculateTotals(field.groups)[expression.key];
    return safePositive(total);
  }
  if (expression.type === "counter-total") {
    return safePositive(
      field.groups.reduce(
        (sum, group) => sum + (group.counters[expression.counter] ?? 0),
        0,
      ),
    );
  }
  const value = field.opponentValues[expression.key];
  return typeof value === "number" ? safePositive(value) : null;
}

function resolveQuantity(
  quantity: AthenaResolutionQuantity,
  trigger: AthenaTriggerInstance,
  field: FieldState,
  decision: AthenaTriggerResolutionDecision,
): number {
  if (quantity.kind === "fixed-per-trigger") return quantity.value;
  if (quantity.kind === "logical-multiplicity") {
    return trigger.logicalMultiplicity ?? 0;
  }
  if (quantity.kind === "player-choice") {
    const selected = decision.quantity;
    if (
      selected === undefined ||
      selected < quantity.minimum ||
      (quantity.maximum !== null && selected > quantity.maximum)
    ) {
      throw new Error("The selected quantity is outside its supported range.");
    }
    return selected;
  }
  const source = trigger.source.sourceGroupId
    ? field.groups.find((group) => group.id === trigger.source.sourceGroupId)
    : null;
  if (!source) {
    throw new Error(
      "Current source information is required for this resolution.",
    );
  }
  return source.counters[quantity.counterType] ?? 0;
}

function targetGroupIdsForAction(
  action: AthenaResolutionAction,
  trigger: AthenaTriggerInstance,
  field: FieldState,
  decision: AthenaTriggerResolutionDecision,
): string[] {
  if (action.target === "player-controller") return [];
  if (action.target === "source") {
    if (!trigger.source.sourceGroupId) {
      throw new Error("The source object is required for this resolution.");
    }
    return [trigger.source.sourceGroupId];
  }
  if (action.target === "selected") {
    const selected = uniqueStrings([
      ...(decision.targetGroupIds ?? []),
      ...(decision.selectedGroupIds ?? []),
    ]);
    if (selected.length === 0) {
      throw new Error("A selected permanent is required.");
    }
    return selected;
  }
  return field.groups
    .filter(
      (group) =>
        group.zone === "battlefield" &&
        group.controller === "you" &&
        group.characteristics.isCreature,
    )
    .map((group) => group.id)
    .sort((a, b) => a.localeCompare(b));
}

function gameEventFromForecast(
  event: AthenaForecastInput,
  resolutionId: string,
): GameEvent {
  return {
    id: `canonical:${event.eventId}`,
    type: event.eventCategory as GameEvent["type"],
    sourceId: event.sourceObjectId,
    controller: "you",
    owner: "you",
    quantity: event.quantity,
    batchId: event.batchId,
    groupIds: [...event.subjectGroupIds],
    characteristics: event.knownCharacteristics
      ? {
          cardTypes: [...event.knownCharacteristics.cardTypes],
          supertypes: [...event.knownCharacteristics.supertypes],
          subtypes: [...event.knownCharacteristics.subtypes],
          colors: [...event.knownCharacteristics.colors],
          manaValue: event.knownCharacteristics.manaValue ?? 0,
          isToken: event.knownCharacteristics.isToken,
          isCreature: event.knownCharacteristics.isCreature,
          isLegendary: event.knownCharacteristics.isLegendary,
        }
      : undefined,
    token:
      event.eventCategory === "token-created" ||
      event.knownCharacteristics?.isToken === true,
    metadata: gameEventMetadata({
      ...event.metadata,
      counterType: event.counterType,
      canonicalResultReference: event.canonicalResultReference,
      resolutionId,
    }),
    zoneOrigin: event.zoneOrigin ?? undefined,
    zoneDestination: event.zoneDestination ?? undefined,
  };
}

function applyEntryState(
  group: FieldState["groups"][number],
  event: AthenaForecastInput,
): FieldState["groups"][number] {
  const counterType =
    typeof event.metadata.entryCounterType === "string"
      ? event.metadata.entryCounterType
      : null;
  const counterQuantity =
    typeof event.metadata.entryCounterQuantity === "number" &&
    Number.isSafeInteger(event.metadata.entryCounterQuantity) &&
    event.metadata.entryCounterQuantity > 0
      ? event.metadata.entryCounterQuantity
      : 0;
  const counters = { ...group.counters };
  if (counterType && counterQuantity > 0) {
    counters[counterType] = (counters[counterType] ?? 0) + counterQuantity;
  }
  return withStackKey(
    recalculateStats({
      ...group,
      counters,
      statuses: {
        ...group.statuses,
        tapped: event.metadata.entersTapped === true,
        transformed: event.metadata.entersTransformed === true,
      },
    }),
  );
}

function genericKindForEntry(
  event: AthenaForecastInput,
): Parameters<typeof createGenericGroup>[0]["kind"] {
  const types = event.knownCharacteristics?.cardTypes ?? [];
  if (event.eventCategory === "land-entered" || types.includes("Land")) {
    return "Land";
  }
  if (types.includes("Creature")) return "Creature";
  if (types.includes("Equipment")) return "Equipment";
  if (types.includes("Artifact")) return "Artifact";
  if (types.includes("Enchantment")) return "Enchantment";
  return "Noncreature permanent";
}

function transitionForEligibility(
  queue: AthenaPendingTriggerQueue,
  triggerId: string,
  status: AthenaTriggerResolutionEligibilityStatus,
  timestamp: string,
): void {
  const state: Partial<
    Record<AthenaTriggerResolutionEligibilityStatus, AthenaTriggerQueueState>
  > = {
    "auto-resolvable": "auto-resolvable",
    "ready-for-confirmation": "ready",
    "awaiting-optional-decision": "optional-decision-required",
    "awaiting-target": "awaiting-target",
    "awaiting-quantity": "awaiting-quantity",
    "awaiting-mode": "awaiting-mode",
    "awaiting-selection": "awaiting-selection",
    "awaiting-order": "awaiting-order",
    "authority-required": "authority-required",
    "manual-resolution-required": "manual-resolution-required",
    unsupported: "unsupported",
    stale: "stale",
    invalid: "failed-safe",
  };
  const next = state[status];
  if (next) queue.transition(triggerId, next, timestamp);
}

function terminalResolutionResult(input: {
  field: FieldState;
  queue: AthenaPendingTriggerQueueSnapshot;
  trigger: AthenaTriggerInstance | null;
  timestamp: string;
  status: AthenaTriggerResolutionStatus;
  eligibility: AthenaTriggerResolutionEligibility;
  reason: string;
}): AthenaTriggerResolutionResult {
  const triggerId = input.trigger?.id ?? input.eligibility.triggerInstanceId;
  return {
    version: ATHENA_TRIGGER_RESOLUTION_VERSION,
    id: `athena-resolution:${normalizeId(triggerId)}:${input.status}`,
    triggerInstanceId: triggerId,
    triggerGroupId: input.trigger?.groupingKey ?? "missing-trigger",
    sourceObjectId: input.trigger?.source.sourceGroupId ?? null,
    sourceLabel: input.trigger?.source.label ?? "Unknown trigger",
    abilityDefinitionId: input.trigger?.source.abilityDefinitionId ?? "unknown",
    causingEventLineage: input.trigger
      ? copyLineage(input.trigger)
      : {
          originalEventId: "unknown",
          finalEventId: "unknown",
          replacementResultId: "unknown",
          replacementApplicationIds: [],
          replacementRelationshipIds: [],
          canonicalResultReference: null,
          batchId: "unknown",
        },
    resolutionAuthority: input.eligibility.resolutionAuthority,
    status: input.status,
    eligibility: input.eligibility,
    logicalMultiplicity: input.trigger?.logicalMultiplicity ?? 0,
    resolutionQuantity: 0,
    decisions: {},
    generatedProposedEvents: [],
    generatedFinalEvents: [],
    eventRecords: [],
    canonicalEventIds: [],
    childTriggerIds: [],
    replacementResultIds: [],
    resultingField: input.field,
    queue: input.queue,
    explanationReasonCodes: [input.status],
    semanticDescription: input.reason,
    accessibilityDescription: input.reason,
    failureReason: input.status === "failed-safe" ? input.reason : null,
    manualRequirement:
      input.status === "manual-resolution-required" ? input.reason : null,
    authorityRequirement:
      input.status === "authority-required" ? input.reason : null,
    createdAt: input.timestamp,
    completedAt: input.timestamp,
    canonicalStateMutated: false,
    directBattlefieldMutation: false,
    atomic: true,
  };
}

function invalidEligibility(
  triggerId: string,
  reason: string,
): AthenaTriggerResolutionEligibility {
  return {
    version: ATHENA_TRIGGER_RESOLUTION_VERSION,
    triggerInstanceId: triggerId,
    status: "invalid",
    reason,
    definitionId: null,
    missingRequirements: [],
    selectedTargetGroupIds: [],
    resolutionAuthority: "lite-local-helper-result",
    deterministic: false,
    canMutateCanonicalState: false,
    semanticDescription: reason,
  };
}

function statusForEligibility(
  status: AthenaTriggerResolutionEligibilityStatus,
): AthenaTriggerResolutionStatus {
  if (status.startsWith("awaiting-")) return "input-required";
  if (status === "authority-required") return "authority-required";
  if (status === "manual-resolution-required") {
    return "manual-resolution-required";
  }
  if (status === "unsupported") return "unsupported";
  if (status === "stale") return "stale";
  return "invalid";
}

function stopReasonForEligibility(
  status: AthenaTriggerResolutionEligibilityStatus | undefined,
): AthenaAutoResolutionStopReason {
  if (!status) return "queue-empty";
  if (status.startsWith("awaiting-")) return "input-required";
  if (status === "authority-required") return "authority-required";
  if (status === "manual-resolution-required") {
    return "manual-resolution-required";
  }
  return "unsupported";
}

function normalizeBudget(
  input: Partial<AthenaAutoResolutionBudget> | undefined,
): AthenaAutoResolutionBudget {
  const defaults = DEFAULT_ATHENA_AUTO_RESOLUTION_BUDGET;
  return {
    maximumTriggers: boundedPositive(
      input?.maximumTriggers,
      defaults.maximumTriggers,
    ),
    maximumGeneratedEvents: boundedPositive(
      input?.maximumGeneratedEvents,
      defaults.maximumGeneratedEvents,
    ),
    maximumCascadeDepth: boundedPositive(
      input?.maximumCascadeDepth,
      defaults.maximumCascadeDepth,
    ),
    maximumDurationMs: boundedPositive(
      input?.maximumDurationMs,
      defaults.maximumDurationMs,
    ),
    maximumRepeatedPattern: boundedPositive(
      input?.maximumRepeatedPattern,
      defaults.maximumRepeatedPattern,
    ),
    maximumQueueGrowth: boundedPositive(
      input?.maximumQueueGrowth,
      defaults.maximumQueueGrowth,
    ),
  };
}

function emptyDiagnostics(): AthenaTriggerResolutionDiagnostics {
  return {
    version: ATHENA_TRIGGER_RESOLUTION_VERSION,
    triggerResolutionAttempts: 0,
    autoResolvedTriggers: 0,
    userInputRequiredTriggers: 0,
    authorityRequiredTriggers: 0,
    manualResolutionTriggers: 0,
    failedSafeResolutions: 0,
    generatedConsequenceEvents: 0,
    replacementProcessedConsequenceEvents: 0,
    groupedTriggerResolutions: 0,
    logicalTriggerResolutions: 0,
    duplicateResolutionPreventionCount: 0,
    autoResolutionCycles: 0,
    maximumAutoResolutionDepth: 0,
    safetyBudgetPauses: 0,
    potentialLoopDetections: 0,
    averageResolutionDurationMs: 0,
    maximumResolutionDurationMs: 0,
    queueSizeBefore: 0,
    queueSizeAfter: 0,
    staleResolutionRejectionCount: 0,
    authorityReconciliationCount: 0,
    undoReconciliationCount: 0,
    restoreReconciliationCount: 0,
    lastResolutionError: null,
    productionVisible: false,
  };
}

function semanticResolutionDescription(
  trigger: AthenaTriggerInstance,
  records: AthenaTriggerResolutionEventRecord[],
  multiplicity: number,
): string {
  const life = records
    .filter(
      (record) =>
        record.finalEvent?.eventCategory === "life-gained" ||
        record.finalEvent?.eventCategory === "life-lost",
    )
    .reduce((sum, record) => sum + (record.finalEvent?.quantity ?? 0), 0);
  if (life > 0) {
    return `${trigger.source.label} resolved ${multiplicity} trigger${multiplicity === 1 ? "" : "s"}. You ${records[0]?.finalEvent?.eventCategory === "life-lost" ? "lost" : "gained"} ${life} life.`;
  }
  const counters = records
    .filter((record) => record.finalEvent?.eventCategory === "counter-placed")
    .reduce((sum, record) => sum + (record.finalEvent?.quantity ?? 0), 0);
  if (counters > 0) {
    return `${trigger.source.label} resolved. ${counters} counter${counters === 1 ? " was" : "s were"} applied to each affected permanent.`;
  }
  const tokens = records
    .filter((record) => record.finalEvent?.eventCategory === "token-created")
    .reduce((sum, record) => sum + (record.finalEvent?.quantity ?? 0), 0);
  if (tokens > 0) {
    return `${trigger.source.label} resolved and created ${tokens} token${tokens === 1 ? "" : "s"}.`;
  }
  return `${trigger.source.label} resolved.`;
}

function cycleDescription(
  results: AthenaTriggerResolutionResult[],
  stop: AthenaAutoResolutionStopReason,
): string {
  if (stop === "potential-repeating-interaction") {
    return "Automatic resolution paused for a potential repeating interaction.";
  }
  if (stop === "safety-budget") {
    return "Automatic resolution paused for safety.";
  }
  if (results.length === 0) {
    return `No deterministic trigger resolved; processing stopped for ${stop.replace(/-/g, " ")}.`;
  }
  return `${results.length} supported trigger${results.length === 1 ? " was" : "s were"} processed; ${stop.replace(/-/g, " ")}.`;
}

function queueTransaction(
  queue: AthenaPendingTriggerQueue,
): AthenaPendingTriggerQueue {
  const snapshot = queue.toSnapshot();
  return new AthenaPendingTriggerQueue({
    canonicalSessionId: snapshot.canonicalSessionId,
    participantId: snapshot.participantId,
    timestamp: snapshot.updatedAt,
    snapshot,
  });
}

function copyDecision(
  decision: AthenaTriggerResolutionDecision,
): AthenaTriggerResolutionDecision {
  return {
    ...decision,
    targetGroupIds: decision.targetGroupIds
      ? [...decision.targetGroupIds]
      : undefined,
    selectedGroupIds: decision.selectedGroupIds
      ? [...decision.selectedGroupIds]
      : undefined,
  };
}

function copyLineage(
  trigger: AthenaTriggerInstance,
): AthenaTriggerInstance["eventLineage"] {
  return {
    ...trigger.eventLineage,
    replacementApplicationIds: [
      ...trigger.eventLineage.replacementApplicationIds,
    ],
    replacementRelationshipIds: [
      ...trigger.eventLineage.replacementRelationshipIds,
    ],
  };
}

function copyAction(action: AthenaResolutionAction): AthenaResolutionAction {
  return {
    ...action,
    quantity: { ...action.quantity },
    ...(action.kind === "create-token"
      ? {
          token: {
            ...action.token,
            cardTypes: [...action.token.cardTypes],
            subtypes: [...action.token.subtypes],
            colors: [...action.token.colors],
          },
        }
      : {}),
  } as AthenaResolutionAction;
}

function resolutionPattern(trigger: AthenaTriggerInstance): string {
  return serializeStable({
    definition:
      trigger.knownValues.resolutionDefinitionId ??
      trigger.source.abilityDefinitionId,
    observed: trigger.observedEventCategory,
    generated: trigger.generatedEventCategories,
  });
}

function isTerminalQueueState(state: AthenaTriggerQueueState): boolean {
  return [
    "resolved",
    "declined",
    "invalidated",
    "cancelled",
    "failed-safe",
    "stale",
    "unsupported",
  ].includes(state);
}

function resolveValue(value: unknown): string | number | boolean | null {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
    ? value
    : null;
}

function gameEventMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = resolveValue(value);
    if (normalized !== null) result[key] = normalized;
  }
  return result;
}

function safeAdd(a: number, b: number): number | null {
  return Number.isSafeInteger(a) &&
    Number.isSafeInteger(b) &&
    a >= 0 &&
    b >= 0 &&
    a <= Number.MAX_SAFE_INTEGER - b
    ? a + b
    : null;
}

function safeMultiply(a: number, b: number): number | null {
  return Number.isSafeInteger(a) &&
    Number.isSafeInteger(b) &&
    a > 0 &&
    b > 0 &&
    a <= Math.floor(Number.MAX_SAFE_INTEGER / b)
    ? a * b
    : null;
}

function safePositive(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function numericMetadata(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
