import type { GameEvent } from "../domain/types";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import { createAthenaEffectRelationshipQueryApi } from "./effectRelationshipMapper";
import type {
  AthenaEffectChoiceRequirementDescriptor,
  AthenaMappedEffectRelationship,
} from "./effectRelationshipMapperTypes";
import {
  createAthenaForecastInputFromGameEvent,
  createForecastEnvironment,
} from "./eventForecast";
import type {
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import { processAthenaReplacementEffects } from "./replacementEffect";
import type { AthenaReplacementProcessingResult } from "./replacementEffectTypes";
import {
  ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION,
  ATHENA_PENDING_TRIGGER_QUEUE_VERSION,
  ATHENA_TRIGGER_INSTANCE_VERSION,
  ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY,
  type AthenaAuthoritativeTriggerRecord,
  type AthenaConfirmedEventProcessingOptions,
  type AthenaConfirmedEventProcessingResult,
  type AthenaGameEventBatchProcessingResult,
  type AthenaGameEventTriggerAdapterInput,
  type AthenaPendingTriggerQueueDiagnostics,
  type AthenaPendingTriggerQueueRestoreResult,
  type AthenaPendingTriggerQueueSnapshot,
  type AthenaPendingTriggerQueueSummary,
  type AthenaSkippedTriggerRelationship,
  type AthenaTriggerEventFacet,
  type AthenaTriggerGenerationDiagnostics,
  type AthenaTriggerGenerationOptions,
  type AthenaTriggerGenerationResult,
  type AthenaTriggerInstance,
  type AthenaTriggerMultiplicity,
  type AthenaTriggerQueueState,
  type AthenaTriggerRequirement,
} from "./triggerQueueTypes";
import type { AthenaAuthoritySource } from "./types";

const TERMINAL_QUEUE_STATES = new Set<AthenaTriggerQueueState>([
  "resolved",
  "declined",
  "invalidated",
  "cancelled",
]);

const INELIGIBLE_EVENT_SOURCES = new Set<AthenaForecastInput["eventSource"]>([
  "echo-planned",
  "planner",
  "action-strip",
  "correction-only",
  "preview-only",
  "unknown",
]);

const ACTIVE_RELATIONSHIP_STATES = new Set([
  "enabled",
  "partially-supported",
  "authority-required",
  "awaiting-authority",
  "awaiting-manual-resolution",
  "unsupported",
]);

const QUEUE_STATES = new Set<AthenaTriggerQueueState>([
  "pending",
  "ready",
  "auto-resolvable",
  "awaiting-choice",
  "awaiting-target",
  "awaiting-quantity",
  "awaiting-mode",
  "awaiting-selection",
  "awaiting-order",
  "optional-decision-required",
  "authority-required",
  "manual-resolution-required",
  "resolving",
  "resolved",
  "declined",
  "failed-safe",
  "stale",
  "invalidated",
  "cancelled",
  "unsupported",
]);

export function generateAthenaTriggerInstances(
  environment: AthenaForecastEnvironment,
  replacement: AthenaReplacementProcessingResult,
  options: AthenaTriggerGenerationOptions = {},
): AthenaTriggerGenerationResult {
  const started = monotonicNowMs();
  const timestamp = options.timestamp ?? replacement.updatedAt;
  const generationKey = triggerGenerationKey(replacement, environment);
  const id = `athena-trigger-generation:${normalizeIdPart(replacement.originalEvent.eventId)}:${stableHash(generationKey)}`;
  const base = {
    id,
    generationKey,
    createdAt: timestamp,
    replacementResultId: replacement.id,
    originalEvent: copyForecastInput(replacement.originalEvent),
  };

  if (options.cancellation?.cancelled) {
    return terminalGenerationResult(base, {
      validity: "cancelled",
      reason:
        options.cancellation.reason ?? "Trigger generation was cancelled.",
      replacement,
      started,
      stale: false,
    });
  }

  if (replacement.validity === "bypassed" || isCorrectionOnly(replacement)) {
    return terminalGenerationResult(base, {
      validity: "ignored",
      reason: "Correction Only does not generate gameplay triggers.",
      replacement,
      started,
      stale: false,
    });
  }

  if (replacement.validity !== "resolved" || !replacement.finalEvent) {
    const validity = generationValidityForReplacement(replacement);
    return terminalGenerationResult(base, {
      validity,
      reason: `Trigger generation requires a resolved ATHENA-05 final event; replacement status is ${replacement.validity}.`,
      replacement,
      started,
      stale: replacement.validity === "stale",
    });
  }

  const finalEvent = replacement.finalEvent;
  const boundaryError = validateConfirmedFinalEvent(finalEvent, environment);
  if (boundaryError) {
    return terminalGenerationResult(base, {
      validity: boundaryError.stale ? "stale" : "ignored",
      reason: boundaryError.message,
      replacement,
      started,
      stale: boundaryError.stale,
    });
  }

  if (
    finalEvent.authoritySource === "boardstate-authoritative-result" &&
    options.authoritativeTriggers &&
    options.authoritativeTriggers.length > 0
  ) {
    return authoritativeGenerationResult(
      environment,
      replacement,
      options.authoritativeTriggers,
      base,
      started,
    );
  }

  const query = createAthenaEffectRelationshipQueryApi(
    environment.relationshipMap,
    environment.graph,
  );
  const facets = eventFacets(finalEvent);
  const selected = new Map<
    string,
    {
      relationship: AthenaMappedEffectRelationship;
      facet: AthenaTriggerEventFacet;
    }
  >();
  const skipped: AthenaSkippedTriggerRelationship[] = [];
  let evaluated = 0;
  let duplicatePreventionCount = 0;

  for (const facet of facets) {
    for (const relationship of query.getTriggersObservingEvent(
      facet.eventCategory,
    )) {
      evaluated += 1;
      const inactiveReason = inactiveRelationshipReason(relationship);
      if (inactiveReason) {
        skipped.push(
          skippedRelationship(
            relationship,
            facet.eventCategory,
            inactiveReason,
          ),
        );
        continue;
      }
      const identity = relationshipDefinitionIdentity(relationship);
      const existing = selected.get(identity);
      if (existing) {
        duplicatePreventionCount += 1;
        const preferred = preferredFacet(finalEvent, existing.facet, facet);
        if (preferred === existing.facet) {
          skipped.push(
            skippedRelationship(
              relationship,
              facet.eventCategory,
              "duplicate-definition",
            ),
          );
          continue;
        }
        skipped.push(
          skippedRelationship(
            existing.relationship,
            existing.facet.eventCategory,
            "duplicate-definition",
          ),
        );
      }
      selected.set(identity, { relationship, facet });
    }
  }

  const instances: AthenaTriggerInstance[] = [];
  const warnings: string[] = [];
  let generationSequence = 0;
  for (const candidate of [...selected.values()].sort(compareCandidates)) {
    generationSequence += 1;
    const built = buildTriggerInstance({
      environment,
      replacement,
      relationship: candidate.relationship,
      facet: candidate.facet,
      generationSequence,
      timestamp,
    });
    instances.push(built.instance);
    if (built.warning) warnings.push(built.warning);
  }

  const ordered = instances.sort(compareTriggerInstances);
  const orderingRequirement = orderingRequirementForInstances(ordered);
  const diagnostics = generationDiagnostics({
    duration: monotonicNowMs() - started,
    confirmed: true,
    final: true,
    evaluated,
    instances: ordered,
    duplicatePreventionCount,
    stale: false,
    error: null,
  });
  const semanticDescriptions = ordered.map(
    (instance) => instance.semanticDescription,
  );

  return {
    version: ATHENA_TRIGGER_INSTANCE_VERSION,
    ...base,
    validity: "accepted",
    reason:
      ordered.length === 0
        ? "The confirmed final event produced no active supported trigger instances."
        : "Concrete pending trigger instances were generated from the confirmed final event.",
    finalEvent: copyForecastInput(finalEvent),
    eventFacets: facets,
    triggerInstances: ordered,
    skippedRelationships: uniqueById(skipped),
    orderingRequirement,
    warnings: uniqueStrings(warnings),
    semanticDescriptions,
    diagnostics,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    canonicalStateMutated: false,
    directBattlefieldMutation: false,
  };
}

export class AthenaTriggerGenerationCancellationController {
  private readonly state = {
    cancelled: false,
    reason: null as string | null,
  };
  readonly signal = this.state;

  cancel(reason = "Trigger generation was cancelled."): void {
    this.state.cancelled = true;
    this.state.reason = reason;
  }
}

export class AthenaPendingTriggerQueue {
  private canonicalSessionId: string;
  private participantId: string;
  private createdAt: string;
  private updatedAt: string;
  private entries = new Map<string, AthenaTriggerInstance>();
  private processedGenerationKeys = new Set<string>();
  private diagnostics: AthenaPendingTriggerQueueDiagnostics;
  private totalGenerationDurationMs = 0;

  constructor(input: {
    canonicalSessionId: string;
    participantId: string;
    timestamp: string;
    snapshot?: AthenaPendingTriggerQueueSnapshot;
  }) {
    this.canonicalSessionId = input.canonicalSessionId;
    this.participantId = input.participantId;
    this.createdAt = input.timestamp;
    this.updatedAt = input.timestamp;
    this.diagnostics = emptyQueueDiagnostics();
    if (input.snapshot) this.loadSnapshot(input.snapshot);
  }

  addGeneration(result: AthenaTriggerGenerationResult): number {
    return this.applyGeneration(result, false);
  }

  reconcileGeneration(result: AthenaTriggerGenerationResult): number {
    this.diagnostics.queueReconciliationCount += 1;
    try {
      return this.applyGeneration(result, true);
    } catch (error) {
      this.diagnostics.queueReconciliationFailureCount += 1;
      this.diagnostics.lastTriggerGenerationError = errorMessage(error);
      return 0;
    }
  }

  get(id: string): AthenaTriggerInstance | null {
    const entry = this.entries.get(id);
    return entry ? copyTriggerInstance(entry) : null;
  }

  getEntries(): AthenaTriggerInstance[] {
    return [...this.entries.values()]
      .sort(compareTriggerInstances)
      .map(copyTriggerInstance);
  }

  applyUserOrder(ids: string[], timestamp: string): boolean {
    const orderedIds = [...new Set(ids)];
    if (orderedIds.length === 0) return false;
    const entries = orderedIds.map((id) => this.entries.get(id) ?? null);
    if (entries.some((entry) => !entry)) return false;
    const groupIds = new Set(
      entries.map((entry) => entry!.ordering.sameEventGroupId),
    );
    if (groupIds.size !== 1) return false;
    const sameGroupEntries = [...this.entries.values()].filter(
      (entry) =>
        entry.ordering.sameEventGroupId ===
          entries[0]!.ordering.sameEventGroupId &&
        !TERMINAL_QUEUE_STATES.has(entry.queueState),
    );
    if (
      sameGroupEntries.length !== orderedIds.length ||
      sameGroupEntries.some((entry) => !orderedIds.includes(entry.id))
    ) {
      return false;
    }
    orderedIds.forEach((id, index) => {
      const entry = this.entries.get(id)!;
      this.entries.set(id, {
        ...entry,
        ordering: {
          ...entry.ordering,
          userOrderingRequired: false,
          authoritativeOrder: index,
        },
        updatedAt: timestamp,
      });
    });
    this.updatedAt = timestamp;
    return true;
  }

  getNextPending(): AthenaTriggerInstance | null {
    return (
      this.getEntries().find(
        (entry) => !TERMINAL_QUEUE_STATES.has(entry.queueState),
      ) ?? null
    );
  }

  transition(
    id: string,
    state: AthenaTriggerQueueState,
    timestamp: string,
    resolutionReference: string | null = null,
  ): boolean {
    const current = this.entries.get(id);
    if (!current || !validQueueTransition(current.queueState, state))
      return false;
    this.entries.set(id, {
      ...current,
      queueState: state,
      updatedAt: timestamp,
      resolutionReference,
    });
    this.updatedAt = timestamp;
    this.refreshStateDiagnostics();
    return true;
  }

  replaceFromSnapshot(snapshot: AthenaPendingTriggerQueueSnapshot): boolean {
    if (
      snapshot.schemaVersion !== ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION ||
      snapshot.version !== ATHENA_PENDING_TRIGGER_QUEUE_VERSION ||
      snapshot.canonicalSessionId !== this.canonicalSessionId ||
      snapshot.participantId !== this.participantId
    ) {
      return false;
    }
    this.loadSnapshot(snapshot);
    return true;
  }

  markAwaitingChoice(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-choice", timestamp);
  }

  markAwaitingTarget(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-target", timestamp);
  }

  markReady(id: string, timestamp: string): boolean {
    return this.transition(id, "ready", timestamp);
  }

  markAutoResolvable(id: string, timestamp: string): boolean {
    return this.transition(id, "auto-resolvable", timestamp);
  }

  markAwaitingQuantity(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-quantity", timestamp);
  }

  markAwaitingMode(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-mode", timestamp);
  }

  markAwaitingSelection(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-selection", timestamp);
  }

  markAwaitingOrder(id: string, timestamp: string): boolean {
    return this.transition(id, "awaiting-order", timestamp);
  }

  markFailedSafe(id: string, timestamp: string): boolean {
    return this.transition(id, "failed-safe", timestamp);
  }

  markStale(id: string, timestamp: string): boolean {
    return this.transition(id, "stale", timestamp);
  }

  markAuthorityRequired(id: string, timestamp: string): boolean {
    return this.transition(id, "authority-required", timestamp);
  }

  markManualResolutionRequired(id: string, timestamp: string): boolean {
    return this.transition(id, "manual-resolution-required", timestamp);
  }

  markResolved(
    id: string,
    timestamp: string,
    resolutionReference: string,
  ): boolean {
    return this.transition(id, "resolved", timestamp, resolutionReference);
  }

  markDeclined(id: string, timestamp: string): boolean {
    const current = this.entries.get(id);
    if (!current?.optional) return false;
    return this.transition(id, "declined", timestamp);
  }

  cancelByCausingEvent(eventId: string, timestamp: string): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (
        entry.eventLineage.finalEventId !== eventId &&
        entry.eventLineage.originalEventId !== eventId
      ) {
        continue;
      }
      if (TERMINAL_QUEUE_STATES.has(entry.queueState)) continue;
      this.entries.set(id, {
        ...entry,
        queueState: "cancelled",
        updatedAt: timestamp,
      });
      count += 1;
    }
    if (count > 0) {
      this.updatedAt = timestamp;
      this.refreshStateDiagnostics();
    }
    return count;
  }

  invalidateByCausingEvent(eventId: string, timestamp: string): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.eventLineage.finalEventId !== eventId) continue;
      if (TERMINAL_QUEUE_STATES.has(entry.queueState)) continue;
      this.entries.set(id, {
        ...entry,
        queueState: "invalidated",
        updatedAt: timestamp,
      });
      count += 1;
    }
    if (count > 0) {
      this.updatedAt = timestamp;
      this.refreshStateDiagnostics();
    }
    return count;
  }

  removeInvalid(id: string): boolean {
    const entry = this.entries.get(id);
    if (
      !entry ||
      (entry.queueState !== "invalidated" &&
        entry.queueState !== "cancelled" &&
        entry.queueState !== "unsupported")
    ) {
      return false;
    }
    const removed = this.entries.delete(id);
    if (removed) this.refreshStateDiagnostics();
    return removed;
  }

  reconcileCanonicalEvents(
    validEventIds: readonly string[],
    timestamp: string,
  ): number {
    this.diagnostics.queueReconciliationCount += 1;
    const valid = new Set(validEventIds);
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (
        valid.has(entry.eventLineage.finalEventId) ||
        TERMINAL_QUEUE_STATES.has(entry.queueState)
      ) {
        continue;
      }
      this.entries.set(id, {
        ...entry,
        queueState: "cancelled",
        updatedAt: timestamp,
      });
      count += 1;
    }
    this.updatedAt = timestamp;
    this.refreshStateDiagnostics();
    return count;
  }

  reconcileAuthoritativeGeneration(
    result: AthenaTriggerGenerationResult,
  ): number {
    if (
      result.originalEvent.authoritySource !== "boardstate-authoritative-result"
    ) {
      this.diagnostics.queueReconciliationFailureCount += 1;
      return 0;
    }
    const eventId = result.finalEvent?.eventId;
    if (!eventId) return 0;
    for (const [id, entry] of this.entries) {
      if (
        entry.eventLineage.finalEventId === eventId &&
        entry.authoritySource !== "boardstate-authoritative-result" &&
        !TERMINAL_QUEUE_STATES.has(entry.queueState)
      ) {
        this.entries.set(id, {
          ...entry,
          queueState: "invalidated",
          updatedAt: result.createdAt,
        });
      }
    }
    return this.reconcileGeneration(result);
  }

  getSummary(): AthenaPendingTriggerQueueSummary {
    return summarizeQueue([...this.entries.values()]);
  }

  getDiagnostics(): AthenaPendingTriggerQueueDiagnostics {
    return { ...this.diagnostics };
  }

  toSnapshot(): AthenaPendingTriggerQueueSnapshot {
    return {
      schemaVersion: ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION,
      version: ATHENA_PENDING_TRIGGER_QUEUE_VERSION,
      canonicalSessionId: this.canonicalSessionId,
      participantId: this.participantId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      entries: this.getEntries(),
      processedGenerationKeys: [...this.processedGenerationKeys].sort((a, b) =>
        a.localeCompare(b),
      ),
      summary: this.getSummary(),
      diagnostics: this.getDiagnostics(),
      derivedFromCanonicalEventHistory: true,
      duplicateEventHistory: false,
      duplicateUndoStack: false,
      directBattlefieldMutation: false,
    };
  }

  private applyGeneration(
    result: AthenaTriggerGenerationResult,
    restoreCancelled: boolean,
  ): number {
    if (result.validity !== "accepted" || !result.finalEvent) {
      if (result.validity === "stale") {
        this.diagnostics.staleGenerationRejectionCount += 1;
      }
      if (result.diagnostics.lastTriggerGenerationError) {
        this.diagnostics.lastTriggerGenerationError =
          result.diagnostics.lastTriggerGenerationError;
      }
      return 0;
    }
    if (
      result.finalEvent.canonicalSessionId !== this.canonicalSessionId ||
      result.finalEvent.participantId !== this.participantId
    ) {
      this.diagnostics.queueReconciliationFailureCount += 1;
      this.diagnostics.lastTriggerGenerationError =
        "Trigger generation belongs to a different canonical session or participant.";
      return 0;
    }
    let added = 0;
    for (const incoming of result.triggerInstances) {
      const existing = this.entries.get(incoming.id);
      if (existing) {
        this.diagnostics.duplicateTriggerPreventionCount += 1;
        if (
          restoreCancelled &&
          (existing.queueState === "cancelled" ||
            existing.queueState === "invalidated")
        ) {
          this.entries.set(incoming.id, copyTriggerInstance(incoming));
        }
        continue;
      }
      this.entries.set(incoming.id, copyTriggerInstance(incoming));
      added += 1;
    }
    this.processedGenerationKeys.add(result.generationKey);
    this.updatedAt = result.createdAt;
    this.diagnostics.confirmedEventsProcessed += result.diagnostics
      .confirmedEventProcessed
      ? 1
      : 0;
    this.diagnostics.finalEventsProcessed += result.diagnostics
      .finalEventProcessed
      ? 1
      : 0;
    this.diagnostics.triggerRelationshipsEvaluated +=
      result.diagnostics.relationshipEvaluationCount;
    this.diagnostics.triggerInstancesGenerated += added;
    this.diagnostics.groupedTriggerCount += result.triggerInstances.filter(
      (entry) => entry.grouped,
    ).length;
    this.diagnostics.logicalTriggerMultiplicity +=
      result.triggerInstances.reduce(
        (sum, entry) => safeDiagnosticSum(sum, entry.logicalMultiplicity ?? 0),
        0,
      );
    this.diagnostics.staleGenerationRejectionCount += result.diagnostics
      .staleGenerationRejected
      ? 1
      : 0;
    this.totalGenerationDurationMs += result.diagnostics.processingDurationMs;
    const generationCount = this.diagnostics.confirmedEventsProcessed;
    this.diagnostics.averageGenerationDurationMs =
      generationCount === 0
        ? 0
        : this.totalGenerationDurationMs / generationCount;
    this.diagnostics.maximumGenerationDurationMs = Math.max(
      this.diagnostics.maximumGenerationDurationMs,
      result.diagnostics.processingDurationMs,
    );
    this.diagnostics.maximumQueueSize = Math.max(
      this.diagnostics.maximumQueueSize,
      this.entries.size,
    );
    this.diagnostics.maximumLogicalTriggerMultiplicity = Math.max(
      this.diagnostics.maximumLogicalTriggerMultiplicity,
      ...result.triggerInstances.map((entry) => entry.logicalMultiplicity ?? 0),
    );
    this.diagnostics.lastTriggerGenerationError =
      result.diagnostics.lastTriggerGenerationError;
    this.refreshStateDiagnostics();
    return added;
  }

  private loadSnapshot(snapshot: AthenaPendingTriggerQueueSnapshot): void {
    if (
      snapshot.schemaVersion !== ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION ||
      snapshot.version !== ATHENA_PENDING_TRIGGER_QUEUE_VERSION ||
      snapshot.canonicalSessionId !== this.canonicalSessionId ||
      snapshot.participantId !== this.participantId
    ) {
      return;
    }
    this.createdAt = snapshot.createdAt;
    this.updatedAt = snapshot.updatedAt;
    this.entries = new Map(
      snapshot.entries.map((entry) => [entry.id, copyTriggerInstance(entry)]),
    );
    this.processedGenerationKeys = new Set(snapshot.processedGenerationKeys);
    this.diagnostics = {
      ...snapshot.diagnostics,
      persistenceRestoreCount: snapshot.diagnostics.persistenceRestoreCount + 1,
    };
    this.refreshStateDiagnostics();
  }

  private refreshStateDiagnostics(): void {
    const entries = [...this.entries.values()];
    this.diagnostics.readyTriggerCount = entries.filter(
      (entry) =>
        entry.queueState === "ready" || entry.queueState === "auto-resolvable",
    ).length;
    this.diagnostics.choiceRequiredCount = entries.filter((entry) =>
      [
        "awaiting-choice",
        "awaiting-quantity",
        "awaiting-mode",
        "awaiting-selection",
        "awaiting-order",
        "optional-decision-required",
      ].includes(entry.queueState),
    ).length;
    this.diagnostics.targetRequiredCount = entries.filter(
      (entry) => entry.queueState === "awaiting-target",
    ).length;
    this.diagnostics.optionalDecisionCount = entries.filter(
      (entry) => entry.queueState === "optional-decision-required",
    ).length;
    this.diagnostics.authorityRequiredCount = entries.filter(
      (entry) => entry.queueState === "authority-required",
    ).length;
    this.diagnostics.manualResolutionCount = entries.filter(
      (entry) => entry.queueState === "manual-resolution-required",
    ).length;
    this.diagnostics.unsupportedTriggerCount = entries.filter(
      (entry) => entry.queueState === "unsupported",
    ).length;
  }
}

export function createAthenaPendingTriggerQueue(input: {
  canonicalSessionId: string;
  participantId: string;
  timestamp: string;
}): AthenaPendingTriggerQueue {
  return new AthenaPendingTriggerQueue(input);
}

export function processConfirmedAthenaEvent(
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
  queue: AthenaPendingTriggerQueue,
  options: AthenaConfirmedEventProcessingOptions = {},
): AthenaConfirmedEventProcessingResult {
  const replacement = processAthenaReplacementEffects(
    environment,
    event,
    options.replacement,
  );
  const generation = generateAthenaTriggerInstances(
    environment,
    replacement,
    options,
  );
  queue.addGeneration(generation);
  return { replacement, generation, queue: queue.toSnapshot() };
}

export function processAthenaGameEvent(
  adapter: AthenaGameEventTriggerAdapterInput,
  queue: AthenaPendingTriggerQueue,
  options: AthenaConfirmedEventProcessingOptions = {},
): AthenaConfirmedEventProcessingResult {
  const input = createAthenaForecastInputFromGameEvent({
    ...adapter.environment,
    event: adapter.event,
    eventSource: adapter.eventSource,
    authoritySource: adapter.authoritySource,
    timestamp: adapter.timestamp,
    canonicalResultReference: adapter.canonicalResultReference,
  });
  return processConfirmedAthenaEvent(
    adapter.environment,
    input,
    queue,
    options,
  );
}

export function processAthenaGameEventBatch(input: {
  environment: AthenaForecastEnvironment;
  events: GameEvent[];
  queue: AthenaPendingTriggerQueue;
  eventSource?: AthenaForecastInput["eventSource"];
  authoritySource?: AthenaAuthoritySource;
  timestamp?: string;
  canonicalResultReference?: string | null;
  options?: AthenaConfirmedEventProcessingOptions;
}): AthenaGameEventBatchProcessingResult {
  const results = input.events.map((event) =>
    processAthenaGameEvent(
      {
        environment: input.environment,
        event,
        eventSource: input.eventSource,
        authoritySource: input.authoritySource,
        timestamp: input.timestamp,
        canonicalResultReference: input.canonicalResultReference,
      },
      input.queue,
      input.options,
    ),
  );
  return { results, queue: input.queue.toSnapshot() };
}

export function serializeAthenaPendingTriggerQueue(
  queue: AthenaPendingTriggerQueue | AthenaPendingTriggerQueueSnapshot,
): string {
  const snapshot =
    queue instanceof AthenaPendingTriggerQueue ? queue.toSnapshot() : queue;
  return serializeStable(snapshot);
}

export function restoreAthenaPendingTriggerQueue(input: {
  serialized: string | null | undefined;
  canonicalSessionId: string;
  participantId: string;
  timestamp: string;
}): AthenaPendingTriggerQueueRestoreResult {
  const warnings: string[] = [];
  let candidate: unknown;
  try {
    candidate = input.serialized ? JSON.parse(input.serialized) : null;
  } catch {
    candidate = null;
    warnings.push("Pending trigger data was corrupt and was discarded.");
  }
  const validSnapshot = normalizeQueueSnapshot(candidate, input, warnings);
  const queue = new AthenaPendingTriggerQueue({
    canonicalSessionId: input.canonicalSessionId,
    participantId: input.participantId,
    timestamp: input.timestamp,
    snapshot: validSnapshot.snapshot,
  });
  const snapshot = queue.toSnapshot();
  snapshot.diagnostics.invalidRestoredTriggerCount +=
    validSnapshot.invalidEntryCount;
  return {
    snapshot,
    restoredEntryCount: snapshot.entries.length,
    invalidEntryCount: validSnapshot.invalidEntryCount,
    warnings,
  };
}

export function createAthenaTriggerQueueForField(
  field: Parameters<typeof createForecastEnvironment>[0],
): {
  environment: AthenaForecastEnvironment;
  queue: AthenaPendingTriggerQueue;
} {
  const environment = createForecastEnvironment(field);
  return {
    environment,
    queue: createAthenaPendingTriggerQueue({
      canonicalSessionId: environment.context.sessionId,
      participantId: environment.context.localParticipantId,
      timestamp: field.updatedAt,
    }),
  };
}

function buildTriggerInstance(input: {
  environment: AthenaForecastEnvironment;
  replacement: AthenaReplacementProcessingResult;
  relationship: AthenaMappedEffectRelationship;
  facet: AthenaTriggerEventFacet;
  generationSequence: number;
  timestamp: string;
}): { instance: AthenaTriggerInstance; warning: string | null } {
  const sourceObject = input.relationship.source.battlefieldObjectGroupId
    ? (input.environment.context.battlefield.find(
        (object) =>
          object.groupId === input.relationship.source.battlefieldObjectGroupId,
      ) ?? null)
    : null;
  const sourceQuantity = Math.max(1, sourceObject?.quantity ?? 1);
  const multiplicityMode = triggerMultiplicity(input.relationship);
  const occurrenceCount =
    multiplicityMode === "per-object"
      ? input.facet.quantity
      : multiplicityMode === "per-event"
        ? input.facet.logicalEventCount
        : multiplicityMode === "single"
          ? 1
          : input.facet.quantity === 1
            ? 1
            : null;
  const baseProduct =
    occurrenceCount === null
      ? null
      : safeMultiply(occurrenceCount, sourceQuantity);
  const additionalTriggerFactor = travelingChocoboTriggerFactor(
    input.environment,
    input.replacement.finalEvent!,
  );
  const product =
    baseProduct === null
      ? null
      : safeMultiply(baseProduct, additionalTriggerFactor);
  const multiplicityKnown = product !== null;
  const logicalMultiplicity = product;
  const requirements = requirementsForRelationship(
    input.relationship,
    input.facet.eventCategory,
    multiplicityKnown,
  );
  const queueState = initialQueueState(
    input.relationship,
    requirements,
    multiplicityKnown,
  );
  const relationshipIdentity = relationshipDefinitionIdentity(
    input.relationship,
  );
  const groupingKey = stableHash(
    serializeStable({
      relationshipIdentity,
      controller: input.relationship.source.controller,
      event: input.replacement.finalEvent?.eventId,
      facet: input.facet.eventCategory,
      requirements: requirements.map((requirement) => requirement.kind),
      authority: input.relationship.authoritySource,
      generated: input.relationship.generatedEventCategories,
    }),
  );
  const eventId =
    input.replacement.finalEvent?.eventId ?? "missing-final-event";
  const triggerId = `athena-trigger:${normalizeIdPart(eventId)}:${normalizeIdPart(relationshipIdentity)}:${stableHash(groupingKey)}`;
  const sourceLabel =
    input.relationship.source.currentCardFace ??
    textMetadata(input.relationship.relationshipMetadata.customName) ??
    input.relationship.source.abilityIdentifier;
  const countText =
    multiplicityKnown && logicalMultiplicity !== null && logicalMultiplicity > 1
      ? ` triggered ${logicalMultiplicity} times`
      : multiplicityKnown
        ? " triggered"
        : " triggered; its multiplicity requires manual resolution";
  return {
    instance: {
      version: ATHENA_TRIGGER_INSTANCE_VERSION,
      id: triggerId,
      canonicalSessionId:
        input.replacement.finalEvent?.canonicalSessionId ?? "",
      participantId: input.replacement.finalEvent?.participantId ?? "",
      controllerId: input.relationship.source.controller,
      source: {
        stableIdentity: input.relationship.source.stableIdentity,
        sourceGroupId: input.relationship.source.battlefieldObjectGroupId,
        objectIds: [...input.relationship.source.objectIds],
        label: sourceLabel,
        controllerId: input.relationship.source.controller,
        ownerId: input.relationship.source.owner,
        abilityDefinitionId: input.relationship.source.abilityIdentifier,
        sourceDefinitionId: input.relationship.source.definitionIdentifier,
        relationshipId: input.relationship.id,
        relationshipVersion: input.relationship.version,
        relationshipCategory: input.relationship.category,
        relationshipState: input.relationship.state,
        currentCardFace: input.relationship.source.currentCardFace,
        transformationState: input.relationship.source.transformationState,
        trackingEnabled: input.relationship.source.trackingEnabled,
        depowerMode: input.relationship.source.depowerMode,
      },
      causingEvent: copyForecastInput(input.replacement.finalEvent!),
      eventLineage: eventLineage(input.replacement),
      observedEventCategory: input.facet.eventCategory,
      triggerCategory: input.relationship.category,
      triggerTiming: "after-final-event",
      multiplicityMode,
      logicalMultiplicity,
      grouped: (logicalMultiplicity ?? 0) > 1 || sourceQuantity > 1,
      groupingKey,
      optional: input.relationship.optional,
      requirements,
      knownValues: {
        finalEventQuantity: input.facet.quantity,
        logicalEventCount: input.facet.logicalEventCount,
        sourceQuantity,
        additionalTriggerFactor,
        multiplicityKnown,
        replacementStepCount: input.replacement.steps.length,
        resolutionDefinitionId:
          textMetadata(
            input.relationship.relationshipMetadata.resolutionDefinitionId,
          ) ?? textMetadata(input.relationship.relationshipMetadata.helper),
        resolutionDefinitionVersion:
          typeof input.relationship.relationshipMetadata
            .resolutionDefinitionVersion === "number"
            ? input.relationship.relationshipMetadata
                .resolutionDefinitionVersion
            : null,
      },
      generatedEventCategories: [
        ...input.relationship.generatedEventCategories,
      ],
      affectedGroupIds: [...input.relationship.targetGroupIds],
      supportStatus: input.relationship.supportStatus,
      support: input.relationship.support,
      authoritySource: input.relationship.authoritySource,
      authorityPrecedence: input.relationship.authorityPrecedence,
      queueState,
      ordering: {
        eventSequence: input.replacement.finalEvent?.sequence ?? 0,
        generationSequence: input.generationSequence,
        sameEventGroupId: `athena-trigger-group:${normalizeIdPart(eventId)}`,
        controllerId: input.relationship.source.controller,
        userOrderingRequired: Boolean(
          input.relationship.relationshipMetadata.requiresTriggerOrder,
        ),
        authorityOrderingRequired: input.relationship.requiresAuthority,
        authoritativeOrder: null,
      },
      semanticDescription: `${sourceLabel}${countText} because ${input.facet.quantity} ${eventLabel(input.facet.eventCategory, input.facet.quantity)} occurred.`,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      resolutionReference: null,
      diagnosticMetadata: {
        multiplicityKnown,
        sourceQuantity,
        facetStructural: input.facet.structural,
        relationshipMapFingerprint:
          input.environment.relationshipMap.fingerprint,
      },
      committedStateReadOnly: true,
      directBattlefieldMutation: false,
    },
    warning: multiplicityKnown
      ? null
      : `${sourceLabel} trigger multiplicity requires BoardState authority or manual resolution.`,
  };
}

function travelingChocoboTriggerFactor(
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
): number {
  const enteringBird =
    event.knownCharacteristics?.subtypes.some(
      (subtype) => subtype.toLowerCase() === "bird",
    ) === true &&
    [
      "creature-entered",
      "permanent-entered",
      "token-created",
      "token-entered",
      "permanent-returned-to-battlefield",
    ].includes(event.eventCategory);
  const enteringLand =
    event.eventCategory === "land-entered" ||
    (event.knownCharacteristics?.cardTypes.some(
      (type) => type.toLowerCase() === "land",
    ) === true &&
      ["permanent-entered", "permanent-returned-to-battlefield"].includes(
        event.eventCategory,
      ));
  if (!enteringBird && !enteringLand) return 1;
  const additional = environment.context.battlefield.reduce(
    (sum, object) =>
      object.canBeEffectSource &&
      (object.identityName ?? object.label)
        .toLowerCase()
        .includes("traveling chocobo")
        ? sum + object.quantity
        : sum,
    0,
  );
  return additional >= Number.MAX_SAFE_INTEGER ? 1 : additional + 1;
}

function authoritativeGenerationResult(
  environment: AthenaForecastEnvironment,
  replacement: AthenaReplacementProcessingResult,
  records: AthenaAuthoritativeTriggerRecord[],
  base: {
    id: string;
    generationKey: string;
    createdAt: string;
    replacementResultId: string;
    originalEvent: AthenaForecastInput;
  },
  started: number,
): AthenaTriggerGenerationResult {
  const finalEvent = replacement.finalEvent!;
  const facets = eventFacets(finalEvent);
  const instances = uniqueById(
    records
      .filter(
        (record) =>
          Number.isSafeInteger(record.logicalMultiplicity) &&
          record.logicalMultiplicity > 0,
      )
      .map((record, index): AthenaTriggerInstance => {
        const relationship = environment.relationshipMap.relationships.find(
          (entry) => entry.id === record.relationshipId,
        );
        const id = `athena-trigger:authority:${normalizeIdPart(finalEvent.eventId)}:${normalizeIdPart(record.id)}`;
        return {
          version: ATHENA_TRIGGER_INSTANCE_VERSION,
          id,
          canonicalSessionId: finalEvent.canonicalSessionId,
          participantId: finalEvent.participantId,
          controllerId: record.controllerId,
          source: {
            stableIdentity:
              relationship?.source.stableIdentity ??
              `${finalEvent.canonicalSessionId}:${record.sourceGroupId ?? record.id}:${record.abilityDefinitionId}`,
            sourceGroupId: record.sourceGroupId,
            objectIds: [...(relationship?.source.objectIds ?? [])],
            label: record.sourceLabel,
            controllerId: record.controllerId,
            ownerId: relationship?.source.owner ?? null,
            abilityDefinitionId: record.abilityDefinitionId,
            sourceDefinitionId:
              relationship?.source.definitionIdentifier ??
              record.relationshipId,
            relationshipId: record.relationshipId,
            relationshipVersion: relationship?.version ?? 1,
            relationshipCategory: relationship?.category ?? "triggered-ability",
            relationshipState: relationship?.state ?? "enabled",
            currentCardFace:
              relationship?.source.currentCardFace ?? record.sourceLabel,
            transformationState:
              relationship?.source.transformationState ?? "current-face",
            trackingEnabled: relationship?.source.trackingEnabled ?? true,
            depowerMode: relationship?.source.depowerMode ?? "none",
          },
          causingEvent: copyForecastInput(finalEvent),
          eventLineage: eventLineage(replacement),
          observedEventCategory: record.observedEventCategory,
          triggerCategory: relationship?.category ?? "triggered-ability",
          triggerTiming: "after-final-event",
          multiplicityMode: "unknown",
          logicalMultiplicity: record.logicalMultiplicity,
          grouped: record.logicalMultiplicity > 1,
          groupingKey: stableHash(`${finalEvent.eventId}:${record.id}`),
          optional: record.optional,
          requirements: record.requirements.map(copyRequirement),
          knownValues: {
            finalEventQuantity: finalEvent.quantity,
            authorityProvided: true,
          },
          generatedEventCategories: [...record.generatedEventCategories],
          affectedGroupIds: [...(relationship?.targetGroupIds ?? [])],
          supportStatus: relationship?.supportStatus ?? "automated",
          support: relationship?.support ?? "fully-understood-consequence",
          authoritySource: "boardstate-authoritative-result",
          authorityPrecedence: 6,
          queueState: record.queueState,
          ordering: {
            eventSequence: finalEvent.sequence,
            generationSequence: index + 1,
            sameEventGroupId: `athena-trigger-group:${normalizeIdPart(finalEvent.eventId)}`,
            controllerId: record.controllerId,
            userOrderingRequired: false,
            authorityOrderingRequired: false,
            authoritativeOrder: record.order,
          },
          semanticDescription: `${record.sourceLabel} generated ${record.logicalMultiplicity} authoritative pending trigger${record.logicalMultiplicity === 1 ? "" : "s"}.`,
          createdAt: base.createdAt,
          updatedAt: base.createdAt,
          resolutionReference: null,
          diagnosticMetadata: { authorityProvided: true },
          committedStateReadOnly: true,
          directBattlefieldMutation: false,
        };
      }),
  ).sort(compareTriggerInstances);
  const diagnostics = generationDiagnostics({
    duration: monotonicNowMs() - started,
    confirmed: true,
    final: true,
    evaluated: records.length,
    instances,
    duplicatePreventionCount: records.length - instances.length,
    stale: false,
    error: null,
  });
  return {
    version: ATHENA_TRIGGER_INSTANCE_VERSION,
    ...base,
    validity: "accepted",
    reason:
      "BoardState authoritative trigger data superseded local generation.",
    finalEvent: copyForecastInput(finalEvent),
    eventFacets: facets,
    triggerInstances: instances,
    skippedRelationships: [],
    orderingRequirement: "none",
    warnings: [],
    semanticDescriptions: instances.map((entry) => entry.semanticDescription),
    diagnostics,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    canonicalStateMutated: false,
    directBattlefieldMutation: false,
  };
}

function eventFacets(event: AthenaForecastInput): AthenaTriggerEventFacet[] {
  const facets = new Map<string, AthenaTriggerEventFacet>();
  const add = (
    eventCategory: AthenaTriggerEventFacet["eventCategory"],
    structural: boolean,
    reason: AthenaTriggerEventFacet["reason"],
  ): void => {
    if (facets.has(eventCategory)) return;
    facets.set(eventCategory, {
      id: `athena-trigger-facet:${normalizeIdPart(event.eventId)}:${eventCategory}`,
      eventCategory,
      quantity: event.quantity,
      logicalEventCount: logicalEventCountForEvent(event),
      structural,
      reason,
    });
  };
  const isCreature =
    event.knownCharacteristics?.isCreature === true ||
    event.knownCharacteristics?.cardTypes.some(
      (type) => type.toLowerCase() === "creature",
    ) === true;
  const isToken =
    event.knownCharacteristics?.isToken === true ||
    event.eventCategory === "token-created" ||
    event.eventCategory === "token-entered";
  const isLand =
    event.knownCharacteristics?.cardTypes.some(
      (type) => type.toLowerCase() === "land",
    ) === true || event.eventCategory === "land-entered";
  add(event.eventCategory, false, "final-event");
  if (event.eventCategory === "token-created") {
    add("token-entered", true, "token-facet");
  }
  if (
    event.eventCategory === "permanent-entered" ||
    event.eventCategory === "permanent-returned-to-battlefield" ||
    event.eventCategory === "token-created" ||
    event.eventCategory === "token-entered"
  ) {
    if (isCreature) add("creature-entered", true, "entry-facet");
    if (isLand) add("land-entered", true, "entry-facet");
    if (isToken) add("token-entered", true, "token-facet");
  }
  if (
    event.eventCategory === "creature-entered" ||
    event.eventCategory === "land-entered" ||
    event.eventCategory === "token-entered" ||
    event.eventCategory === "token-created" ||
    event.eventCategory === "permanent-returned-to-battlefield"
  ) {
    add("permanent-entered", true, "entry-facet");
  }
  return [...facets.values()].sort(
    (a, b) =>
      facetPriority(event, a) - facetPriority(event, b) ||
      a.eventCategory.localeCompare(b.eventCategory),
  );
}

function logicalEventCountForEvent(event: AthenaForecastInput): number {
  const candidate = event.metadata.logicalEventCount;
  return typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate > 0
    ? candidate
    : 1;
}

function requirementsForRelationship(
  relationship: AthenaMappedEffectRelationship,
  eventCategory: AthenaTriggerEventFacet["eventCategory"],
  multiplicityKnown: boolean,
): AthenaTriggerRequirement[] {
  const requirements = relationship.requiredChoices.map((choice) =>
    requirementFromChoice(choice, relationship.id),
  );
  if (
    relationship.optional &&
    !requirements.some(
      (requirement) => requirement.kind === "optional-decision",
    )
  ) {
    requirements.push({
      id: `athena-trigger-requirement:optional:${normalizeIdPart(relationship.id)}`,
      kind: "optional-decision",
      prompt: `Use ${relationship.source.currentCardFace ?? "this optional effect"}?`,
      sourceGroupId: relationship.source.battlefieldObjectGroupId,
      candidateGroupIds: [],
      eventCategories: [eventCategory],
      status: "unresolved",
      requiredBeforeResolution: true,
    });
  }
  if (!multiplicityKnown) {
    requirements.push({
      id: `athena-trigger-requirement:multiplicity:${normalizeIdPart(relationship.id)}`,
      kind: relationship.requiresAuthority ? "authority" : "manual-resolution",
      prompt: "Confirm the number of trigger occurrences.",
      sourceGroupId: relationship.source.battlefieldObjectGroupId,
      candidateGroupIds: [],
      eventCategories: [eventCategory],
      status: "unresolved",
      requiredBeforeResolution: true,
    });
  }
  return uniqueById(requirements);
}

function requirementFromChoice(
  choice: AthenaEffectChoiceRequirementDescriptor,
  relationshipId: string,
): AthenaTriggerRequirement {
  return {
    id: `athena-trigger-requirement:${normalizeIdPart(relationshipId)}:${normalizeIdPart(choice.id)}`,
    kind: choice.kind,
    prompt: choice.prompt,
    sourceGroupId: choice.sourceGroupId,
    candidateGroupIds: [...choice.candidateGroupIds],
    eventCategories: [...choice.eventCategories],
    status: "unresolved",
    requiredBeforeResolution: true,
  };
}

function initialQueueState(
  relationship: AthenaMappedEffectRelationship,
  requirements: AthenaTriggerRequirement[],
  multiplicityKnown: boolean,
): AthenaTriggerQueueState {
  if (relationship.support === "unsupported-effect") return "unsupported";
  if (
    relationship.requiresAuthority ||
    relationship.state === "authority-required"
  ) {
    return "authority-required";
  }
  if (
    relationship.requiresManualResolution ||
    relationship.state === "awaiting-manual-resolution" ||
    relationship.state === "partially-supported" ||
    !multiplicityKnown
  ) {
    return "manual-resolution-required";
  }
  if (
    requirements.some((requirement) => requirement.kind === "optional-decision")
  ) {
    return "optional-decision-required";
  }
  if (
    requirements.some(
      (requirement) =>
        requirement.kind === "target" || requirement.kind === "player",
    )
  ) {
    return "awaiting-target";
  }
  if (
    requirements.some(
      (requirement) =>
        requirement.kind === "quantity" ||
        requirement.kind === "opponent-value",
    )
  ) {
    return "awaiting-quantity";
  }
  if (requirements.some((requirement) => requirement.kind === "mode")) {
    return "awaiting-mode";
  }
  if (requirements.length > 0) return "awaiting-choice";
  return "ready";
}

function validateConfirmedFinalEvent(
  event: AthenaForecastInput,
  environment: AthenaForecastEnvironment,
): { message: string; stale: boolean } | null {
  if (INELIGIBLE_EVENT_SOURCES.has(event.eventSource)) {
    return {
      message: `${event.eventSource} events cannot generate live pending triggers.`,
      stale: false,
    };
  }
  if (!authorityMatchesConfirmedSource(event)) {
    return {
      message: "Event authority does not establish a confirmed gameplay event.",
      stale: false,
    };
  }
  if (
    event.eventSource === "echo-reported" &&
    event.metadata.confirmed !== true
  ) {
    return {
      message: "Echo reports must be confirmed before trigger generation.",
      stale: false,
    };
  }
  if (
    event.metadata.cancelled === true ||
    event.metadata.rejected === true ||
    event.metadata.invalidated === true ||
    event.metadata.stale === true ||
    event.metadata.confirmed === false
  ) {
    return {
      message:
        "Cancelled, rejected, invalidated, stale, or unconfirmed events cannot generate triggers.",
      stale: event.metadata.stale === true,
    };
  }
  if (
    event.canonicalSessionId !== environment.context.sessionId ||
    event.participantId !== environment.context.localParticipantId ||
    event.awarenessContextVersion !== environment.context.version ||
    event.dependencyGraphVersion !== environment.graph.version ||
    event.dependencyGraphFingerprint !== environment.graph.fingerprint ||
    event.relationshipMapVersion !== environment.relationshipMap.version ||
    event.relationshipMapFingerprint !== environment.relationshipMap.fingerprint
  ) {
    return {
      message:
        "Trigger generation rejected stale session or Athena version metadata.",
      stale: true,
    };
  }
  if (
    !Number.isSafeInteger(event.quantity) ||
    event.quantity <= 0 ||
    event.quantity > ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY
  ) {
    return {
      message:
        "Trigger generation requires a positive safely representable event quantity.",
      stale: false,
    };
  }
  return null;
}

function isCorrectionOnly(
  replacement: AthenaReplacementProcessingResult,
): boolean {
  return (
    replacement.originalEvent.eventSource === "correction-only" ||
    replacement.originalEvent.authoritySource === "correction-only" ||
    replacement.finalEvent?.eventSource === "correction-only" ||
    replacement.finalEvent?.authoritySource === "correction-only"
  );
}

function triggerMultiplicity(
  relationship: AthenaMappedEffectRelationship,
): AthenaTriggerMultiplicity {
  const configured = relationship.relationshipMetadata.triggerMultiplicity;
  if (
    configured === "per-object" ||
    configured === "per-event" ||
    configured === "single"
  ) {
    return configured;
  }
  const helper = relationship.relationshipMetadata.helper;
  if (
    helper === "cathars-crusade" ||
    helper === "life-on-creature-entry" ||
    helper === "impact-tremors" ||
    helper === "rampaging-baloths"
  ) {
    return "per-object";
  }
  if (helper === "anim-pakal") return "per-event";
  return "unknown";
}

function inactiveRelationshipReason(
  relationship: AthenaMappedEffectRelationship,
): AthenaSkippedTriggerRelationship["reason"] | null {
  if (
    relationship.state === "tracking-disabled" ||
    !relationship.source.trackingEnabled ||
    relationship.disabledReason === "not-tracked"
  ) {
    return "not-tracked";
  }
  if (
    relationship.state === "depowered" ||
    relationship.disabledReason === "depowered"
  ) {
    return "depowered";
  }
  if (relationship.state === "temporarily-inactive") {
    return "temporarily-inactive";
  }
  if (
    !ACTIVE_RELATIONSHIP_STATES.has(relationship.state) ||
    (!relationship.enabled &&
      !relationship.requiresAuthority &&
      !relationship.requiresManualResolution &&
      relationship.state !== "unsupported")
  ) {
    return "disabled";
  }
  return null;
}

function eventLineage(
  replacement: AthenaReplacementProcessingResult,
): AthenaTriggerInstance["eventLineage"] {
  return {
    originalEventId: replacement.originalEvent.eventId,
    finalEventId: replacement.finalEvent?.eventId ?? "",
    replacementResultId: replacement.id,
    replacementApplicationIds: [...replacement.appliedApplicationIds],
    replacementRelationshipIds: [...replacement.appliedRelationshipIds],
    canonicalResultReference:
      replacement.canonicalEventReference ??
      replacement.finalEvent?.canonicalResultReference ??
      null,
    batchId:
      replacement.finalEvent?.batchId ?? replacement.originalEvent.batchId,
  };
}

function triggerGenerationKey(
  replacement: AthenaReplacementProcessingResult,
  environment: AthenaForecastEnvironment,
): string {
  return stableHash(
    serializeStable({
      version: ATHENA_TRIGGER_INSTANCE_VERSION,
      replacementResultId: replacement.id,
      originalEventId: replacement.originalEvent.eventId,
      finalEventId: replacement.finalEvent?.eventId ?? null,
      finalEventCategory: replacement.finalEvent?.eventCategory ?? null,
      finalEventQuantity: replacement.finalEvent?.quantity ?? null,
      replacementApplications: replacement.appliedApplicationIds,
      sessionId: environment.context.sessionId,
      contextVersion: environment.context.version,
      graphFingerprint: environment.graph.fingerprint,
      relationshipMapFingerprint: environment.relationshipMap.fingerprint,
    }),
  );
}

function terminalGenerationResult(
  base: {
    id: string;
    generationKey: string;
    createdAt: string;
    replacementResultId: string;
    originalEvent: AthenaForecastInput;
  },
  input: {
    validity: AthenaTriggerGenerationResult["validity"];
    reason: string;
    replacement: AthenaReplacementProcessingResult;
    started: number;
    stale: boolean;
  },
): AthenaTriggerGenerationResult {
  return {
    version: ATHENA_TRIGGER_INSTANCE_VERSION,
    ...base,
    validity: input.validity,
    reason: input.reason,
    finalEvent: input.replacement.finalEvent
      ? copyForecastInput(input.replacement.finalEvent)
      : null,
    eventFacets: [],
    triggerInstances: [],
    skippedRelationships: [],
    orderingRequirement: "none",
    warnings: [input.reason],
    semanticDescriptions: [input.reason],
    diagnostics: generationDiagnostics({
      duration: monotonicNowMs() - input.started,
      confirmed: false,
      final: false,
      evaluated: 0,
      instances: [],
      duplicatePreventionCount: 0,
      stale: input.stale,
      error: input.validity === "invalid" ? input.reason : null,
    }),
    committedStateReadOnly: true,
    previewStateIsolated: true,
    canonicalStateMutated: false,
    directBattlefieldMutation: false,
  };
}

function generationValidityForReplacement(
  replacement: AthenaReplacementProcessingResult,
): AthenaTriggerGenerationResult["validity"] {
  if (replacement.validity === "cancelled") return "cancelled";
  if (replacement.validity === "stale") return "stale";
  if (replacement.validity === "authority-required") {
    return "authority-required";
  }
  if (
    replacement.validity === "manual-required" ||
    replacement.validity === "unresolved" ||
    replacement.validity === "loop-detected" ||
    replacement.validity === "overflow"
  ) {
    return "manual-resolution-required";
  }
  return "invalid";
}

function generationDiagnostics(input: {
  duration: number;
  confirmed: boolean;
  final: boolean;
  evaluated: number;
  instances: AthenaTriggerInstance[];
  duplicatePreventionCount: number;
  stale: boolean;
  error: string | null;
}): AthenaTriggerGenerationDiagnostics {
  return {
    version: ATHENA_TRIGGER_INSTANCE_VERSION,
    processingDurationMs: input.duration,
    confirmedEventProcessed: input.confirmed,
    finalEventProcessed: input.final,
    relationshipEvaluationCount: input.evaluated,
    triggerInstanceCount: input.instances.length,
    groupedTriggerCount: input.instances.filter((entry) => entry.grouped)
      .length,
    logicalTriggerMultiplicity: input.instances.reduce(
      (sum, entry) => safeDiagnosticSum(sum, entry.logicalMultiplicity ?? 0),
      0,
    ),
    readyTriggerCount: input.instances.filter(
      (entry) => entry.queueState === "ready",
    ).length,
    choiceRequiredCount: input.instances.filter((entry) =>
      [
        "awaiting-choice",
        "awaiting-quantity",
        "awaiting-mode",
        "awaiting-selection",
        "awaiting-order",
        "optional-decision-required",
      ].includes(entry.queueState),
    ).length,
    targetRequiredCount: input.instances.filter(
      (entry) => entry.queueState === "awaiting-target",
    ).length,
    optionalDecisionCount: input.instances.filter(
      (entry) => entry.queueState === "optional-decision-required",
    ).length,
    authorityRequiredCount: input.instances.filter(
      (entry) => entry.queueState === "authority-required",
    ).length,
    manualResolutionCount: input.instances.filter(
      (entry) => entry.queueState === "manual-resolution-required",
    ).length,
    unsupportedTriggerCount: input.instances.filter(
      (entry) => entry.queueState === "unsupported",
    ).length,
    duplicatePreventionCount: input.duplicatePreventionCount,
    staleGenerationRejected: input.stale,
    lastTriggerGenerationError: input.error,
    productionVisible: false,
    directBattlefieldMutation: false,
  };
}

function summarizeQueue(
  entries: AthenaTriggerInstance[],
): AthenaPendingTriggerQueueSummary {
  const pending = entries.filter(
    (entry) => !TERMINAL_QUEUE_STATES.has(entry.queueState),
  );
  const knownLogicalMultiplicity = pending.reduce(
    (sum, entry) => safeDiagnosticSum(sum, entry.logicalMultiplicity ?? 0),
    0,
  );
  const logicalPendingMultiplicity = pending.some(
    (entry) => entry.logicalMultiplicity === null,
  )
    ? null
    : knownLogicalMultiplicity;
  const inputRequired = pending.filter((entry) =>
    [
      "awaiting-choice",
      "awaiting-target",
      "awaiting-quantity",
      "awaiting-mode",
      "awaiting-selection",
      "awaiting-order",
      "optional-decision-required",
    ].includes(entry.queueState),
  );
  const compactLabel =
    pending.length === 0
      ? "No Triggers Pending"
      : logicalPendingMultiplicity === null
        ? `${pending.length} Trigger Group${pending.length === 1 ? "" : "s"} Pending`
        : `${logicalPendingMultiplicity} Trigger${logicalPendingMultiplicity === 1 ? "" : "s"} Pending`;
  return {
    totalEntries: entries.length,
    pendingEntries: pending.length,
    logicalPendingMultiplicity,
    readyEntries: pending.filter((entry) =>
      ["ready", "auto-resolvable"].includes(entry.queueState),
    ).length,
    inputRequiredEntries: inputRequired.length,
    authorityRequiredEntries: pending.filter(
      (entry) => entry.queueState === "authority-required",
    ).length,
    manualResolutionEntries: pending.filter(
      (entry) => entry.queueState === "manual-resolution-required",
    ).length,
    unsupportedEntries: pending.filter(
      (entry) => entry.queueState === "unsupported",
    ).length,
    resolvedEntries: entries.filter((entry) => entry.queueState === "resolved")
      .length,
    cancelledEntries: entries.filter((entry) =>
      ["cancelled", "invalidated"].includes(entry.queueState),
    ).length,
    compactLabel,
    semanticDescription:
      inputRequired.length > 0
        ? `${compactLabel}. ${inputRequired.length} need input.`
        : compactLabel,
  };
}

function normalizeQueueSnapshot(
  candidate: unknown,
  input: {
    canonicalSessionId: string;
    participantId: string;
    timestamp: string;
  },
  warnings: string[],
): { snapshot: AthenaPendingTriggerQueueSnapshot; invalidEntryCount: number } {
  const empty = new AthenaPendingTriggerQueue({ ...input }).toSnapshot();
  if (!isRecord(candidate)) return { snapshot: empty, invalidEntryCount: 0 };
  if (
    candidate.schemaVersion !== ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION ||
    candidate.version !== ATHENA_PENDING_TRIGGER_QUEUE_VERSION ||
    candidate.canonicalSessionId !== input.canonicalSessionId ||
    candidate.participantId !== input.participantId
  ) {
    warnings.push(
      "Pending trigger data was incompatible with the current session and was discarded.",
    );
    return { snapshot: empty, invalidEntryCount: 0 };
  }
  const rawEntries = Array.isArray(candidate.entries) ? candidate.entries : [];
  const entries = rawEntries
    .filter((entry): entry is AthenaTriggerInstance =>
      isValidRestoredTrigger(entry, input),
    )
    .map(copyTriggerInstance);
  const invalidEntryCount = rawEntries.length - entries.length;
  if (invalidEntryCount > 0) {
    warnings.push(
      `${invalidEntryCount} invalid pending trigger entr${invalidEntryCount === 1 ? "y was" : "ies were"} discarded.`,
    );
  }
  const processedGenerationKeys = Array.isArray(
    candidate.processedGenerationKeys,
  )
    ? candidate.processedGenerationKeys.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const diagnostics = isRecord(candidate.diagnostics)
    ? normalizeQueueDiagnostics(candidate.diagnostics)
    : empty.diagnostics;
  return {
    snapshot: {
      ...empty,
      createdAt: stringOr(candidate.createdAt, input.timestamp),
      updatedAt: stringOr(candidate.updatedAt, input.timestamp),
      entries: uniqueById(entries),
      processedGenerationKeys: uniqueStrings(processedGenerationKeys),
      summary: summarizeQueue(entries),
      diagnostics,
    },
    invalidEntryCount,
  };
}

function isValidRestoredTrigger(
  value: unknown,
  input: { canonicalSessionId: string; participantId: string },
): value is AthenaTriggerInstance {
  if (!isRecord(value)) return false;
  return (
    value.version === ATHENA_TRIGGER_INSTANCE_VERSION &&
    typeof value.id === "string" &&
    value.canonicalSessionId === input.canonicalSessionId &&
    value.participantId === input.participantId &&
    (value.logicalMultiplicity === null ||
      (typeof value.logicalMultiplicity === "number" &&
        Number.isSafeInteger(value.logicalMultiplicity) &&
        value.logicalMultiplicity > 0)) &&
    typeof value.queueState === "string" &&
    QUEUE_STATES.has(value.queueState as AthenaTriggerQueueState) &&
    isRecord(value.source) &&
    typeof value.source.stableIdentity === "string" &&
    typeof value.source.label === "string" &&
    Array.isArray(value.source.objectIds) &&
    isRecord(value.causingEvent) &&
    typeof value.causingEvent.eventId === "string" &&
    Array.isArray(value.causingEvent.subjectGroupIds) &&
    Array.isArray(value.causingEvent.subjectObjectIds) &&
    isRecord(value.causingEvent.relevantTotalImplications) &&
    isRecord(value.causingEvent.metadata) &&
    isRecord(value.eventLineage) &&
    typeof value.eventLineage.originalEventId === "string" &&
    typeof value.eventLineage.finalEventId === "string" &&
    Array.isArray(value.eventLineage.replacementApplicationIds) &&
    Array.isArray(value.eventLineage.replacementRelationshipIds) &&
    Array.isArray(value.requirements) &&
    Array.isArray(value.generatedEventCategories) &&
    Array.isArray(value.affectedGroupIds) &&
    isRecord(value.knownValues) &&
    isRecord(value.ordering) &&
    isRecord(value.diagnosticMetadata) &&
    value.directBattlefieldMutation === false
  );
}

function normalizeQueueDiagnostics(
  value: Record<string, unknown>,
): AthenaPendingTriggerQueueDiagnostics {
  const empty = emptyQueueDiagnostics();
  const result = { ...empty };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    if (key === "productionVisible") continue;
    const candidate = value[key];
    if (typeof result[key] === "number" && typeof candidate === "number") {
      (result[key] as number) = Number.isFinite(candidate)
        ? Math.max(0, candidate)
        : 0;
    }
  }
  result.lastTriggerGenerationError =
    typeof value.lastTriggerGenerationError === "string"
      ? value.lastTriggerGenerationError
      : null;
  return result;
}

function emptyQueueDiagnostics(): AthenaPendingTriggerQueueDiagnostics {
  return {
    version: ATHENA_PENDING_TRIGGER_QUEUE_VERSION,
    confirmedEventsProcessed: 0,
    finalEventsProcessed: 0,
    triggerRelationshipsEvaluated: 0,
    triggerInstancesGenerated: 0,
    groupedTriggerCount: 0,
    logicalTriggerMultiplicity: 0,
    readyTriggerCount: 0,
    choiceRequiredCount: 0,
    targetRequiredCount: 0,
    optionalDecisionCount: 0,
    authorityRequiredCount: 0,
    manualResolutionCount: 0,
    unsupportedTriggerCount: 0,
    duplicateTriggerPreventionCount: 0,
    staleGenerationRejectionCount: 0,
    queueReconciliationCount: 0,
    queueReconciliationFailureCount: 0,
    averageGenerationDurationMs: 0,
    maximumGenerationDurationMs: 0,
    maximumQueueSize: 0,
    maximumLogicalTriggerMultiplicity: 0,
    persistenceRestoreCount: 0,
    invalidRestoredTriggerCount: 0,
    lastTriggerGenerationError: null,
    productionVisible: false,
  };
}

function validQueueTransition(
  from: AthenaTriggerQueueState,
  to: AthenaTriggerQueueState,
): boolean {
  if (from === to) return true;
  if (TERMINAL_QUEUE_STATES.has(from)) return false;
  if (to === "invalidated" || to === "cancelled") return true;
  if (to === "resolving") {
    return from === "ready" || from === "auto-resolvable";
  }
  if (to === "resolved") {
    return (
      from === "resolving" || from === "ready" || from === "auto-resolvable"
    );
  }
  if (to === "declined") return from === "optional-decision-required";
  return to !== "pending";
}

function relationshipDefinitionIdentity(
  relationship: AthenaMappedEffectRelationship,
): string {
  return [
    relationship.source.stableIdentity,
    relationship.source.definitionIdentifier,
    relationship.source.abilityIdentifier,
    relationship.version,
  ].join(":");
}

function authorityMatchesConfirmedSource(event: AthenaForecastInput): boolean {
  if (event.authoritySource === "boardstate-authoritative-result") {
    return (
      event.eventSource === "boardstate-result" ||
      event.eventSource === "canonical-event"
    );
  }
  if (event.eventSource === "canonical-event") {
    return event.authoritySource === "confirmed-canonical-session-result";
  }
  if (event.eventSource === "manual-report") {
    return event.authoritySource === "confirmed-user-report";
  }
  if (event.eventSource === "lite-helper") {
    return event.authoritySource === "lite-local-helper-result";
  }
  if (event.eventSource === "echo-reported") {
    return event.authoritySource === "project-echo-voice-report";
  }
  if (event.eventSource === "imported-event") {
    return event.authoritySource === "imported-canonical-event";
  }
  return false;
}

function preferredFacet(
  event: AthenaForecastInput,
  a: AthenaTriggerEventFacet,
  b: AthenaTriggerEventFacet,
): AthenaTriggerEventFacet {
  return facetPriority(event, a) <= facetPriority(event, b) ? a : b;
}

function facetPriority(
  event: AthenaForecastInput,
  facet: AthenaTriggerEventFacet,
): number {
  if (facet.eventCategory === event.eventCategory) return 0;
  if (facet.eventCategory === "creature-entered") return 1;
  if (facet.eventCategory === "land-entered") return 2;
  if (facet.eventCategory === "token-entered") return 3;
  if (facet.eventCategory === "permanent-entered") return 4;
  return 5;
}

function compareCandidates(
  a: {
    relationship: AthenaMappedEffectRelationship;
    facet: AthenaTriggerEventFacet;
  },
  b: {
    relationship: AthenaMappedEffectRelationship;
    facet: AthenaTriggerEventFacet;
  },
): number {
  return (
    (a.relationship.source.controller ?? "").localeCompare(
      b.relationship.source.controller ?? "",
    ) ||
    a.relationship.source.stableIdentity.localeCompare(
      b.relationship.source.stableIdentity,
    ) ||
    a.relationship.id.localeCompare(b.relationship.id) ||
    a.facet.eventCategory.localeCompare(b.facet.eventCategory)
  );
}

function compareTriggerInstances(
  a: AthenaTriggerInstance,
  b: AthenaTriggerInstance,
): number {
  return (
    a.ordering.eventSequence - b.ordering.eventSequence ||
    (a.ordering.authoritativeOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.ordering.authoritativeOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.ordering.generationSequence - b.ordering.generationSequence ||
    a.id.localeCompare(b.id)
  );
}

function orderingRequirementForInstances(
  entries: AthenaTriggerInstance[],
): AthenaTriggerGenerationResult["orderingRequirement"] {
  if (entries.some((entry) => entry.ordering.authorityOrderingRequired)) {
    return "authority-required";
  }
  const controllers = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.controllerId ?? "unknown";
    controllers.set(key, (controllers.get(key) ?? 0) + 1);
  }
  return [...controllers.values()].some((count) => count > 1)
    ? "user-ordering-may-be-required"
    : "none";
}

function skippedRelationship(
  relationship: AthenaMappedEffectRelationship,
  eventCategory: AthenaTriggerEventFacet["eventCategory"],
  reason: AthenaSkippedTriggerRelationship["reason"],
): AthenaSkippedTriggerRelationship {
  return {
    id: `athena-skipped-trigger:${normalizeIdPart(relationship.id)}:${eventCategory}:${reason}`,
    relationshipId: relationship.id,
    sourceGroupId: relationship.source.battlefieldObjectGroupId,
    eventCategory,
    reason,
  };
}

function safeMultiply(a: number, b: number): number | null {
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a <= 0 ||
    b <= 0
  ) {
    return null;
  }
  if (a > Math.floor(ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY / b)) return null;
  return a * b;
}

function safeDiagnosticSum(a: number, b: number): number {
  if (a >= ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY - b) {
    return ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY;
  }
  return a + b;
}

function eventLabel(event: string, quantity: number): string {
  const label = event.replace(/-/g, " ");
  return quantity === 1 ? label : `${label} events`;
}

function textMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function copyForecastInput(event: AthenaForecastInput): AthenaForecastInput {
  return {
    ...event,
    subjectGroupIds: [...event.subjectGroupIds],
    subjectObjectIds: [...event.subjectObjectIds],
    knownCharacteristics: event.knownCharacteristics
      ? {
          ...event.knownCharacteristics,
          cardTypes: [...event.knownCharacteristics.cardTypes],
          supertypes: [...event.knownCharacteristics.supertypes],
          subtypes: [...event.knownCharacteristics.subtypes],
          colors: [...event.knownCharacteristics.colors],
          knownFields: [...event.knownCharacteristics.knownFields],
        }
      : null,
    tokenDefinition: event.tokenDefinition
      ? {
          ...event.tokenDefinition,
          characteristics: {
            ...event.tokenDefinition.characteristics,
            cardTypes: [...event.tokenDefinition.characteristics.cardTypes],
            supertypes: [...event.tokenDefinition.characteristics.supertypes],
            subtypes: [...event.tokenDefinition.characteristics.subtypes],
            colors: [...event.tokenDefinition.characteristics.colors],
            knownFields: [...event.tokenDefinition.characteristics.knownFields],
          },
        }
      : null,
    relevantTotalImplications: { ...event.relevantTotalImplications },
    confidence: event.confidence ? { ...event.confidence } : null,
    metadata: { ...event.metadata },
  };
}

function copyTriggerInstance(
  entry: AthenaTriggerInstance,
): AthenaTriggerInstance {
  return {
    ...entry,
    source: { ...entry.source, objectIds: [...entry.source.objectIds] },
    causingEvent: copyForecastInput(entry.causingEvent),
    eventLineage: {
      ...entry.eventLineage,
      replacementApplicationIds: [
        ...entry.eventLineage.replacementApplicationIds,
      ],
      replacementRelationshipIds: [
        ...entry.eventLineage.replacementRelationshipIds,
      ],
    },
    requirements: entry.requirements.map(copyRequirement),
    knownValues: { ...entry.knownValues },
    generatedEventCategories: [...entry.generatedEventCategories],
    affectedGroupIds: [...entry.affectedGroupIds],
    ordering: { ...entry.ordering },
    diagnosticMetadata: { ...entry.diagnosticMetadata },
  };
}

function copyRequirement(
  requirement: AthenaTriggerRequirement,
): AthenaTriggerRequirement {
  return {
    ...requirement,
    candidateGroupIds: [...requirement.candidateGroupIds],
    eventCategories: [...requirement.eventCategories],
  };
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  const unique = new Map<string, T>();
  for (const value of values)
    if (!unique.has(value.id)) unique.set(value.id, value);
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
