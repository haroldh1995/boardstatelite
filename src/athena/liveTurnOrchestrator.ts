import type { FieldState, GameEvent } from "../domain/types";
import { synchronizeActionStripWithPlanner } from "../echo/activeTurnActionStrip";
import type {
  ActiveTurnActionKind,
  ActiveTurnActionStripItem,
  ActiveTurnActionStripState,
} from "../echo/activeTurnActionStripTypes";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import type { AthenaDecisionRequest } from "./decisionEngineTypes";
import type { AthenaPendingTriggerQueueSnapshot } from "./triggerQueueTypes";
import {
  ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION,
  ATHENA_LIVE_TURN_SCHEMA_VERSION,
  type AthenaLiveTurnBlocker,
  type AthenaLiveTurnCheckpoint,
  type AthenaLiveTurnDiagnostics,
  type AthenaLiveTurnEndResult,
  type AthenaLiveTurnLifecycle,
  type AthenaLiveTurnOrchestrationResult,
  type AthenaLiveTurnOrchestratorState,
  type AthenaLiveTurnPhase,
  type AthenaLiveTurnReconcileOptions,
  type AthenaLiveTurnTutorialEvent,
  type AthenaLiveTurnWorkToken,
} from "./liveTurnOrchestratorTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const MAX_HISTORY_IDS = 400;
const MAX_CHECKPOINTS = 24;
const TERMINAL_DECISION_STATUSES = new Set([
  "answered",
  "declined",
  "cancelled",
  "stale",
  "invalidated",
]);
const TERMINAL_TRIGGER_STATES = new Set([
  "resolved",
  "declined",
  "stale",
  "invalidated",
  "cancelled",
]);

export function createDefaultAthenaLiveTurnState(
  input: Partial<AthenaLiveTurnOrchestratorState> = {},
): AthenaLiveTurnOrchestratorState {
  return {
    schemaVersion: ATHENA_LIVE_TURN_SCHEMA_VERSION,
    version: ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION,
    sessionId: nullableString(input.sessionId),
    participantId: nullableString(input.participantId),
    turnId: nullableString(input.turnId),
    lifecycle: normalizeLifecycle(input.lifecycle),
    previousLifecycle: input.previousLifecycle
      ? normalizeLifecycle(input.previousLifecycle)
      : null,
    phase: normalizePhase(input.phase),
    sequenceVersion: integer(input.sequenceVersion, 0, Number.MAX_SAFE_INTEGER),
    generation: integer(input.generation, 0, Number.MAX_SAFE_INTEGER),
    canonicalStateFingerprint: nullableString(input.canonicalStateFingerprint),
    currentActionId: nullableString(input.currentActionId),
    currentPreparedActionId: nullableString(input.currentPreparedActionId),
    currentActionKind: normalizeActionKind(input.currentActionKind),
    blockingDecisionId: nullableString(input.blockingDecisionId),
    pendingTriggerIds: stringArray(input.pendingTriggerIds, MAX_HISTORY_IDS),
    authorityRequiredIds: stringArray(
      input.authorityRequiredIds,
      MAX_HISTORY_IDS,
    ),
    manualInterventionIds: stringArray(
      input.manualInterventionIds,
      MAX_HISTORY_IDS,
    ),
    failedProcessingIds: stringArray(
      input.failedProcessingIds,
      MAX_HISTORY_IDS,
    ),
    completedPreparedActionIds: stringArray(
      input.completedPreparedActionIds,
      MAX_HISTORY_IDS,
    ),
    processedCanonicalEventIds: stringArray(
      input.processedCanonicalEventIds,
      MAX_HISTORY_IDS,
    ),
    unexpectedCanonicalEventIds: stringArray(
      input.unexpectedCanonicalEventIds,
      MAX_HISTORY_IDS,
    ),
    confirmationReceiptIds: stringArray(
      input.confirmationReceiptIds,
      MAX_HISTORY_IDS,
    ),
    blockers: normalizeBlockers(input.blockers),
    checkpoints: normalizeCheckpoints(input.checkpoints),
    inFlightWork: normalizeWorkToken(input.inFlightWork),
    startedAt: nullableString(input.startedAt),
    lastActionAt: nullableString(input.lastActionAt),
    endRequestedAt: nullableString(input.endRequestedAt),
    completedAt: nullableString(input.completedAt),
    interruptedAt: nullableString(input.interruptedAt),
    recoveredAt: nullableString(input.recoveredAt),
    updatedAt: nullableString(input.updatedAt) ?? DEFAULT_TIMESTAMP,
    semanticSummary: sanitizeText(input.semanticSummary),
    semanticEvents: normalizeTutorialEvents(input.semanticEvents),
    directBattlefieldMutation: false,
    rulesAuthorityTransferred: false,
    diagnostics: normalizeDiagnostics(input.diagnostics),
  };
}

export function normalizeAthenaLiveTurnState(
  value: unknown,
  options: {
    timestamp?: string;
    sessionId?: string | null;
    participantId?: string | null;
    turnId?: string | null;
    recoverTransientWork?: boolean;
  } = {},
): AthenaLiveTurnOrchestratorState {
  const timestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AthenaLiveTurnOrchestratorState>)
      : {};
  const sessionId = options.sessionId ?? nullableString(candidate.sessionId);
  const participantId =
    options.participantId ?? nullableString(candidate.participantId);
  const turnId = options.turnId ?? nullableString(candidate.turnId);
  const sessionMismatch =
    Boolean(candidate.sessionId) && candidate.sessionId !== sessionId;
  const participantMismatch =
    Boolean(candidate.participantId) &&
    candidate.participantId !== participantId;
  const turnMismatch = Boolean(candidate.turnId) && candidate.turnId !== turnId;
  if (sessionMismatch || participantMismatch || turnMismatch) {
    return createDefaultAthenaLiveTurnState({
      sessionId,
      participantId,
      turnId,
      updatedAt: timestamp,
      lifecycle: "recovering",
      recoveredAt: timestamp,
      semanticSummary:
        "Live turn state was reset for the current session and turn.",
      semanticEvents: ["live-turn-recovered"],
      diagnostics: {
        ...normalizeDiagnostics(candidate.diagnostics),
        recoveryCount:
          normalizeDiagnostics(candidate.diagnostics).recoveryCount + 1,
      },
    });
  }
  let normalized = createDefaultAthenaLiveTurnState({
    ...candidate,
    sessionId,
    participantId,
    turnId,
    updatedAt: nullableString(candidate.updatedAt) ?? timestamp,
  });
  if (
    options.recoverTransientWork !== false &&
    (normalized.inFlightWork ||
      normalized.lifecycle === "processing-action" ||
      normalized.lifecycle === "processing-consequences")
  ) {
    normalized = transitionState(normalized, "recovering", timestamp, {
      summary: "Interrupted live turn work is ready for safe recovery.",
      events: ["live-turn-recovered"],
      inFlightWork: null,
      recoveredAt: timestamp,
      diagnostics: {
        ...normalized.diagnostics,
        recoveryCount: normalized.diagnostics.recoveryCount + 1,
      },
    });
  }
  return normalized;
}

export function coordinateAthenaLiveTurnField(
  field: FieldState,
  options: AthenaLiveTurnReconcileOptions = {},
): FieldState {
  const timestamp = options.timestamp ?? field.updatedAt;
  const dependencyStrip = reconcileActionDependencies(
    field.activeTurnActionStrip,
    field,
    timestamp,
  );
  const coordinatedField =
    dependencyStrip === field.activeTurnActionStrip
      ? field
      : { ...field, activeTurnActionStrip: dependencyStrip };
  const result = reconcileAthenaLiveTurn(coordinatedField, options);
  return {
    ...coordinatedField,
    athena: { ...coordinatedField.athena, liveTurn: result.state },
  };
}

export function reconcileAthenaLiveTurn(
  field: FieldState,
  options: AthenaLiveTurnReconcileOptions = {},
): AthenaLiveTurnOrchestrationResult {
  const started = monotonicNowMs();
  const timestamp = options.timestamp ?? field.updatedAt;
  let state = normalizeAthenaLiveTurnState(field.athena.liveTurn, {
    timestamp,
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    turnId: field.preTurnPlanner.turnId,
    recoverTransientWork: false,
  });
  const signal = options.signal ?? "reconcile";
  const queueState = queueTracking(options.queue, state);
  const completedPreparedActionIds = boundedUnique([
    ...state.completedPreparedActionIds,
    ...field.preTurnPlanner.actions
      .filter((action) => action.status === "completed")
      .map((action) => action.prepared.preparedActionId),
    ...(options.preparedActionId && signal === "action-completed"
      ? [options.preparedActionId]
      : []),
  ]);
  const processedCanonicalEventIds = boundedUnique([
    ...state.processedCanonicalEventIds,
    ...(options.canonicalEvents ?? []).map((event) => event.id),
  ]);
  const unexpectedCanonicalEventIds = boundedUnique([
    ...state.unexpectedCanonicalEventIds,
    ...(signal === "unexpected-action"
      ? (options.canonicalEvents ?? []).map((event) => event.id)
      : []),
  ]);
  const confirmationReceiptIds = boundedUnique([
    ...state.confirmationReceiptIds,
    ...(options.confirmationReceiptId ? [options.confirmationReceiptId] : []),
  ]);
  const duplicateConfirmation = Boolean(
    options.confirmationReceiptId &&
    state.confirmationReceiptIds.includes(options.confirmationReceiptId),
  );
  const activeDecision = activeRequiredDecision(field);
  const focused = focusedAction(field.activeTurnActionStrip.items);
  const phase = phaseForField(field, state, signal);
  const blockers = buildBlockers(
    activeDecision,
    queueState,
    options.failureId ?? null,
    options.failureReason ?? null,
  );
  const blockingDecisionId = activeDecision?.id ?? null;
  const lifecycle = lifecycleForField({
    field,
    state,
    signal,
    phase,
    blockers,
    activeDecision,
  });
  const events = tutorialEventsForTransition(
    state,
    lifecycle,
    focused,
    blockingDecisionId,
    signal,
  );
  const startedAt =
    state.startedAt ?? (isActiveLifecycle(lifecycle) ? timestamp : null);
  const completedAt = lifecycle === "completed" ? timestamp : null;
  const canonicalStateFingerprint = liveTurnFingerprint(field);
  const meaningfulChange =
    lifecycle !== state.lifecycle ||
    phase !== state.phase ||
    focused?.id !== state.currentActionId ||
    blockingDecisionId !== state.blockingDecisionId ||
    canonicalStateFingerprint !== state.canonicalStateFingerprint ||
    signal !== "reconcile" ||
    !sameStrings(queueState.pendingTriggerIds, state.pendingTriggerIds) ||
    !sameStrings(
      blockers.map((entry) => entry.id),
      state.blockers.map((entry) => entry.id),
    );
  const diagnostics = updateDiagnostics({
    state,
    lifecycle,
    signal,
    focused,
    blockingDecisionId,
    queueCount: queueState.pendingTriggerIds.length,
    blockerCount: blockers.length,
    meaningfulChange,
    duplicateConfirmation,
  });
  if (
    options.failureId &&
    !queueState.failedProcessingIds.includes(options.failureId)
  ) {
    queueState.failedProcessingIds = boundedUnique([
      ...queueState.failedProcessingIds,
      options.failureId,
    ]);
  }
  const summary = semanticSummaryForState(
    lifecycle,
    focused,
    blockers,
    options.failureReason ?? null,
  );
  state = createDefaultAthenaLiveTurnState({
    ...state,
    sessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    turnId: field.preTurnPlanner.turnId,
    previousLifecycle:
      lifecycle === state.lifecycle ? state.previousLifecycle : state.lifecycle,
    lifecycle,
    phase,
    sequenceVersion: meaningfulChange
      ? state.sequenceVersion + 1
      : state.sequenceVersion,
    canonicalStateFingerprint,
    currentActionId: focused?.id ?? null,
    currentPreparedActionId: focused?.preparedActionId ?? null,
    currentActionKind: focused?.kind ?? null,
    blockingDecisionId,
    pendingTriggerIds: queueState.pendingTriggerIds,
    authorityRequiredIds: queueState.authorityRequiredIds,
    manualInterventionIds: queueState.manualInterventionIds,
    failedProcessingIds: queueState.failedProcessingIds,
    completedPreparedActionIds,
    processedCanonicalEventIds,
    unexpectedCanonicalEventIds,
    confirmationReceiptIds,
    blockers,
    checkpoints: meaningfulChange
      ? appendCheckpoint(state, {
          lifecycle,
          phase,
          focused,
          blockingDecisionId,
          canonicalEventIds: (options.canonicalEvents ?? []).map(
            (event) => event.id,
          ),
          timestamp,
          reason: signal,
        })
      : state.checkpoints,
    inFlightWork:
      lifecycle === "processing-action" ||
      lifecycle === "processing-consequences"
        ? state.inFlightWork
        : null,
    startedAt,
    lastActionAt:
      signal === "action-completed" || signal === "unexpected-action"
        ? timestamp
        : state.lastActionAt,
    endRequestedAt:
      signal === "end-turn-requested" ? timestamp : state.endRequestedAt,
    completedAt,
    interruptedAt: signal === "interrupted" ? timestamp : state.interruptedAt,
    recoveredAt: signal === "recover" ? timestamp : state.recoveredAt,
    updatedAt: meaningfulChange ? timestamp : state.updatedAt,
    semanticSummary: summary,
    semanticEvents: events,
    diagnostics,
  });
  const duration = Math.max(0, monotonicNowMs() - started);
  state = {
    ...state,
    diagnostics: {
      ...state.diagnostics,
      lastTransitionDurationMs: duration,
      maximumTransitionDurationMs: Math.max(
        state.diagnostics.maximumTransitionDurationMs,
        duration,
      ),
      maximumCheckpointCount: Math.max(
        state.diagnostics.maximumCheckpointCount,
        state.checkpoints.length,
      ),
    },
  };
  return {
    state,
    selectedActionId: focused?.id ?? null,
    selectedPreparedActionId: focused?.preparedActionId ?? null,
    blockers,
    canEndTurn: blockers.length === 0,
    didAdvance: meaningfulChange,
    staleWorkRejected: false,
    semanticDescription: summary,
    tutorialEvents: events,
  };
}

export function requestAthenaLiveTurnEnd(
  field: FieldState,
  timestamp = field.updatedAt,
): AthenaLiveTurnEndResult {
  const result = reconcileAthenaLiveTurn(field, {
    signal: "end-turn-requested",
    timestamp,
  });
  const allowed = result.blockers.length === 0;
  return {
    allowed,
    state: result.state,
    blockers: result.blockers,
    semanticDescription: allowed
      ? "Turn bookkeeping is reconciled. End turn is ready."
      : result.blockers[0].semanticDescription,
  };
}

export function beginAthenaLiveTurnWork(
  state: AthenaLiveTurnOrchestratorState,
  input: {
    actionId?: string | null;
    timestamp?: string;
  } = {},
): { state: AthenaLiveTurnOrchestratorState; token: AthenaLiveTurnWorkToken } {
  const timestamp = input.timestamp ?? state.updatedAt;
  const generation = state.generation + 1;
  const token: AthenaLiveTurnWorkToken = {
    id: stableId(
      "turn-work",
      `${state.sessionId}:${state.turnId}:${input.actionId}:${generation}`,
    ),
    sessionId: state.sessionId ?? "",
    turnId: state.turnId ?? "",
    actionId: input.actionId ?? null,
    generation,
    createdAt: timestamp,
  };
  return {
    token,
    state: transitionState(state, "processing-action", timestamp, {
      generation,
      inFlightWork: token,
      currentActionId: input.actionId ?? state.currentActionId,
      summary: "Confirmed action is entering the canonical pipeline.",
      events: ["action-processing-started"],
    }),
  };
}

export function completeAthenaLiveTurnWork(
  state: AthenaLiveTurnOrchestratorState,
  token: AthenaLiveTurnWorkToken,
  timestamp = state.updatedAt,
): {
  state: AthenaLiveTurnOrchestratorState;
  accepted: boolean;
  stale: boolean;
} {
  const accepted =
    state.inFlightWork?.id === token.id &&
    state.generation === token.generation &&
    state.sessionId === token.sessionId &&
    state.turnId === token.turnId;
  if (!accepted) {
    return {
      accepted: false,
      stale: true,
      state: {
        ...state,
        diagnostics: {
          ...state.diagnostics,
          staleWorkRejections: state.diagnostics.staleWorkRejections + 1,
        },
      },
    };
  }
  return {
    accepted: true,
    stale: false,
    state: transitionState(state, "processing-consequences", timestamp, {
      inFlightWork: null,
      summary: "Canonical action committed. Consequences are processing.",
      events: ["automatic-sequencing-completed"],
    }),
  };
}

export function recordAthenaLiveTurnPipeline(
  field: FieldState,
  input: {
    queue: AthenaPendingTriggerQueueSnapshot;
    canonicalEvents?: GameEvent[];
    actionId?: string | null;
    preparedActionId?: string | null;
    actionKind?: ActiveTurnActionKind | null;
    confirmationReceiptId?: string | null;
    unexpected?: boolean;
    timestamp?: string;
  },
): FieldState {
  return coordinateAthenaLiveTurnField(field, {
    signal: input.unexpected ? "unexpected-action" : "action-completed",
    queue: input.queue,
    canonicalEvents: input.canonicalEvents,
    actionId: input.actionId,
    preparedActionId: input.preparedActionId,
    actionKind: input.actionKind,
    confirmationReceiptId: input.confirmationReceiptId,
    timestamp: input.timestamp ?? field.updatedAt,
  });
}

export function getAthenaLiveTurnDiagnostics(
  state: AthenaLiveTurnOrchestratorState,
): AthenaLiveTurnDiagnostics {
  return { ...state.diagnostics };
}

function reconcileActionDependencies(
  strip: ActiveTurnActionStripState,
  field: FieldState,
  timestamp: string,
): ActiveTurnActionStripState {
  const hasCanonicalBlocker =
    Boolean(activeRequiredDecision(field)) ||
    field.athena.liveTurn.pendingTriggerIds.length > 0 ||
    field.athena.liveTurn.authorityRequiredIds.length > 0 ||
    field.athena.liveTurn.manualInterventionIds.length > 0 ||
    field.athena.liveTurn.failedProcessingIds.length > 0;
  const actionsById = new Map(
    field.preTurnPlanner.actions.map((action) => [action.id, action]),
  );
  let changed = false;
  const items = strip.items.map((item) => {
    if (
      item.kind === "end-turn" &&
      item.status === "blocked" &&
      !hasCanonicalBlocker
    ) {
      changed = true;
      return {
        ...item,
        status: "pending" as const,
        blockedReason: null,
        updatedAt: timestamp,
      };
    }
    if (!item.sourceActionId) return item;
    const action = actionsById.get(item.sourceActionId);
    if (!action || action.status !== "planned") return item;
    const missing = action.dependencyIds.filter(
      (id) => actionsById.get(id)?.status !== "completed",
    );
    const dependencyBlock = item.blockedReason?.startsWith("dependency:");
    if (missing.length > 0) {
      const reason = `dependency:${missing.join(",")}`;
      if (item.status === "blocked" && item.blockedReason === reason)
        return item;
      changed = true;
      return {
        ...item,
        status: "blocked" as const,
        blockedReason: reason,
        updatedAt: timestamp,
      };
    }
    if (item.status === "blocked" && dependencyBlock) {
      changed = true;
      return {
        ...item,
        status: "pending" as const,
        blockedReason: null,
        updatedAt: timestamp,
      };
    }
    return item;
  });
  if (!changed) return strip;
  return synchronizeActionStripWithPlanner(
    { ...strip, items, updatedAt: timestamp, lastFailureReason: null },
    {
      planner: field.preTurnPlanner,
      ambientMode: field.ambient.currentMode,
      timestamp,
      sessionId: field.session.id,
    },
  );
}

function focusedAction(
  items: ActiveTurnActionStripItem[],
): ActiveTurnActionStripItem | null {
  return (
    items.find((item) => item.status === "current") ??
    [...items]
      .sort((left, right) => left.order - right.order)
      .find(
        (item) =>
          item.status === "pending" &&
          (item.validity === "ready" ||
            item.validity === "awaiting-confirmation"),
      ) ??
    null
  );
}

function activeRequiredDecision(
  field: FieldState,
): AthenaDecisionRequest | null {
  const queue = field.athena.decisions;
  const preferred = queue.requests.find(
    (request) => request.id === queue.activeDecisionId,
  );
  if (
    preferred &&
    preferred.required &&
    !TERMINAL_DECISION_STATUSES.has(preferred.status)
  ) {
    return preferred;
  }
  return (
    queue.requests.find(
      (request) =>
        request.required && !TERMINAL_DECISION_STATUSES.has(request.status),
    ) ?? null
  );
}

function queueTracking(
  snapshot: AthenaPendingTriggerQueueSnapshot | null | undefined,
  state: AthenaLiveTurnOrchestratorState,
): {
  pendingTriggerIds: string[];
  authorityRequiredIds: string[];
  manualInterventionIds: string[];
  failedProcessingIds: string[];
} {
  if (!snapshot) {
    return {
      pendingTriggerIds: [...state.pendingTriggerIds],
      authorityRequiredIds: [...state.authorityRequiredIds],
      manualInterventionIds: [...state.manualInterventionIds],
      failedProcessingIds: [...state.failedProcessingIds],
    };
  }
  const pending = snapshot.entries.filter(
    (entry) => !TERMINAL_TRIGGER_STATES.has(entry.queueState),
  );
  return {
    pendingTriggerIds: pending.map((entry) => entry.id),
    authorityRequiredIds: pending
      .filter((entry) => entry.queueState === "authority-required")
      .map((entry) => entry.id),
    manualInterventionIds: pending
      .filter(
        (entry) =>
          entry.queueState === "manual-resolution-required" ||
          entry.queueState === "unsupported",
      )
      .map((entry) => entry.id),
    failedProcessingIds: pending
      .filter((entry) => entry.queueState === "failed-safe")
      .map((entry) => entry.id),
  };
}

function buildBlockers(
  decision: AthenaDecisionRequest | null,
  queue: ReturnType<typeof queueTracking>,
  failureId: string | null,
  failureReason: string | null,
): AthenaLiveTurnBlocker[] {
  const output: AthenaLiveTurnBlocker[] = [];
  if (decision) {
    const authority = decision.status === "authority-required";
    const manual =
      decision.status === "manual-required" ||
      decision.type === "manual-result" ||
      decision.type === "unsupported-rules-choice";
    output.push({
      id: `decision:${decision.id}`,
      kind: authority ? "authority" : manual ? "manual-result" : "decision",
      sourceId: decision.id,
      required: true,
      label: authority
        ? "BoardState required"
        : manual
          ? "Manual result required"
          : "Decision required",
      semanticDescription: decision.semanticPrompt,
    });
  }
  for (const id of queue.pendingTriggerIds) {
    if (
      queue.authorityRequiredIds.includes(id) ||
      queue.manualInterventionIds.includes(id) ||
      queue.failedProcessingIds.includes(id)
    ) {
      continue;
    }
    output.push({
      id: `trigger:${id}`,
      kind: "pending-trigger",
      sourceId: id,
      required: true,
      label: "Pending bookkeeping",
      semanticDescription: "Required trigger bookkeeping remains pending.",
    });
  }
  for (const id of queue.authorityRequiredIds) {
    output.push({
      id: `authority:${id}`,
      kind: "authority",
      sourceId: id,
      required: true,
      label: "BoardState required",
      semanticDescription: "BoardState authority is required to continue.",
    });
  }
  for (const id of queue.manualInterventionIds) {
    output.push({
      id: `manual:${id}`,
      kind: "manual-result",
      sourceId: id,
      required: true,
      label: "Manual result required",
      semanticDescription:
        "Report the physical result before completing the turn.",
    });
  }
  for (const id of boundedUnique([
    ...queue.failedProcessingIds,
    ...(failureId ? [failureId] : []),
  ])) {
    output.push({
      id: `failure:${id}`,
      kind: "processing-failure",
      sourceId: id,
      required: true,
      label: "Bookkeeping needs attention",
      semanticDescription:
        failureReason ?? "Automatic processing paused safely.",
    });
  }
  return dedupeById(output);
}

function lifecycleForField(input: {
  field: FieldState;
  state: AthenaLiveTurnOrchestratorState;
  signal: NonNullable<AthenaLiveTurnReconcileOptions["signal"]>;
  phase: AthenaLiveTurnPhase;
  blockers: AthenaLiveTurnBlocker[];
  activeDecision: AthenaDecisionRequest | null;
}): AthenaLiveTurnLifecycle {
  const { field, state, signal, blockers, activeDecision } = input;
  if (signal === "interrupted") return "interrupted";
  if (signal === "recover") return "recovering";
  if (signal === "action-started") return "processing-action";
  if (signal === "consequences-processing") return "processing-consequences";
  if (activeDecision) return "awaiting-decision";
  if (blockers.some((entry) => entry.kind === "authority"))
    return "authority-required";
  if (
    blockers.some(
      (entry) =>
        entry.kind === "manual-result" || entry.kind === "processing-failure",
    )
  ) {
    return "manual-intervention-required";
  }
  if (field.ambient.currentMode === "postTurn" || signal === "turn-completed")
    return "completed";
  if (field.ambient.currentMode === "preTurnPreparation")
    return field.preTurnPlanner.status === "planning"
      ? "ready-to-begin"
      : "pre-turn-preparation";
  if (field.ambient.currentMode === "combat") return "combat-active";
  if (signal === "combat-started") return "combat-preparation";
  if (signal === "combat-completed") return "combat-reconciliation";
  if (signal === "end-step-started") return "end-step";
  if (signal === "end-turn-requested")
    return blockers.length === 0 ? "ready-to-end" : "turn-reconciliation";
  if (input.phase === "postcombat-main") return "second-main";
  if (field.ambient.currentMode === "resolution")
    return "processing-consequences";
  if (field.ambient.currentMode === "recovery") return "recovering";
  if (field.ambient.currentMode === "activeTurn") {
    if (!state.startedAt || signal === "turn-started") return "turn-active";
    return "ready-for-next-action";
  }
  return "pre-turn-preparation";
}

function phaseForField(
  field: FieldState,
  state: AthenaLiveTurnOrchestratorState,
  signal: NonNullable<AthenaLiveTurnReconcileOptions["signal"]>,
): AthenaLiveTurnPhase {
  const observed = field.ambient.context.observedTurn?.phase;
  if (observed === "beginning") return "beginning";
  if (observed === "precombatMain") return "precombat-main";
  if (observed === "combat") return "combat";
  if (observed === "postcombatMain") return "postcombat-main";
  if (observed === "ending") return "ending";
  if (signal === "combat-started" || field.ambient.currentMode === "combat")
    return "combat";
  if (signal === "combat-completed") return "postcombat-main";
  if (signal === "end-step-started" || signal === "end-turn-requested")
    return "ending";
  if (field.ambient.currentMode === "postTurn") return "ending";
  if (
    field.ambient.currentMode === "activeTurn" &&
    (state.phase === "combat" ||
      state.lifecycle === "combat-active" ||
      state.lifecycle === "combat-reconciliation")
  ) {
    return "postcombat-main";
  }
  if (field.ambient.currentMode === "activeTurn") return "precombat-main";
  return state.phase;
}

function tutorialEventsForTransition(
  state: AthenaLiveTurnOrchestratorState,
  lifecycle: AthenaLiveTurnLifecycle,
  focused: ActiveTurnActionStripItem | null,
  blockingDecisionId: string | null,
  signal: NonNullable<AthenaLiveTurnReconcileOptions["signal"]>,
): AthenaLiveTurnTutorialEvent[] {
  const events: AthenaLiveTurnTutorialEvent[] = [];
  if (!state.startedAt && isActiveLifecycle(lifecycle))
    events.push("live-turn-started");
  if (focused?.id && focused.id !== state.currentActionId)
    events.push("next-action-focused");
  if (signal === "action-started") events.push("action-processing-started");
  if (signal === "action-completed")
    events.push("automatic-sequencing-completed");
  if (blockingDecisionId && !state.blockingDecisionId)
    events.push("decision-paused");
  if (!blockingDecisionId && state.blockingDecisionId)
    events.push("decision-resumed");
  if (lifecycle === "combat-active" && state.lifecycle !== "combat-active")
    events.push("combat-handoff-started");
  if (signal === "combat-completed") events.push("combat-reconciled");
  if (lifecycle === "second-main" && state.lifecycle !== "second-main")
    events.push("second-main-started");
  if (lifecycle === "end-step" && state.lifecycle !== "end-step")
    events.push("end-step-started");
  if (lifecycle === "turn-reconciliation")
    events.push("turn-reconciliation-started");
  if (lifecycle === "completed" && state.lifecycle !== "completed")
    events.push("live-turn-completed");
  if (signal === "recover") events.push("live-turn-recovered");
  return [...new Set(events)];
}

function updateDiagnostics(input: {
  state: AthenaLiveTurnOrchestratorState;
  lifecycle: AthenaLiveTurnLifecycle;
  signal: NonNullable<AthenaLiveTurnReconcileOptions["signal"]>;
  focused: ActiveTurnActionStripItem | null;
  blockingDecisionId: string | null;
  queueCount: number;
  blockerCount: number;
  meaningfulChange: boolean;
  duplicateConfirmation: boolean;
}): AthenaLiveTurnDiagnostics {
  const next = { ...input.state.diagnostics };
  if (!input.state.startedAt && isActiveLifecycle(input.lifecycle))
    next.turnsStarted += 1;
  if (input.lifecycle === "completed" && input.state.lifecycle !== "completed")
    next.turnsCompleted += 1;
  if (input.focused?.id && input.focused.id !== input.state.currentActionId)
    next.actionsFocused += 1;
  if (input.signal === "action-completed" && !input.duplicateConfirmation) {
    next.preparedActionsProcessed += 1;
    next.automaticSequences += 1;
  }
  if (input.duplicateConfirmation) next.duplicateActionPreventions += 1;
  if (input.signal === "unexpected-action")
    next.unexpectedActionsProcessed += 1;
  if (input.blockingDecisionId && !input.state.blockingDecisionId)
    next.decisionPauses += 1;
  if (!input.blockingDecisionId && input.state.blockingDecisionId)
    next.decisionResumes += 1;
  if (
    input.lifecycle === "combat-active" &&
    input.state.lifecycle !== "combat-active"
  )
    next.combatHandoffs += 1;
  if (input.signal === "combat-completed") next.combatReconciliations += 1;
  if (
    input.lifecycle === "second-main" &&
    input.state.lifecycle !== "second-main"
  )
    next.secondMainTransitions += 1;
  if (input.signal === "end-turn-requested") next.endTurnRequests += 1;
  if (input.signal === "end-turn-requested" && input.blockerCount > 0)
    next.endTurnBlocks += 1;
  if (input.signal === "recover") next.recoveryCount += 1;
  if (input.meaningfulChange) next.incrementalRevalidations += 1;
  next.maximumPendingTriggerCount = Math.max(
    next.maximumPendingTriggerCount,
    input.queueCount,
  );
  return next;
}

function semanticSummaryForState(
  lifecycle: AthenaLiveTurnLifecycle,
  focused: ActiveTurnActionStripItem | null,
  blockers: AthenaLiveTurnBlocker[],
  failureReason: string | null,
): string {
  if (failureReason) return sanitizeText(failureReason);
  if (blockers.length > 0) return blockers[0].semanticDescription;
  if (lifecycle === "ready-to-begin") return "Prepared turn is ready.";
  if (lifecycle === "turn-active") return "Turn started.";
  if (lifecycle === "processing-action") return "Action is processing.";
  if (lifecycle === "processing-consequences")
    return "Automatic bookkeeping is processing.";
  if (lifecycle === "combat-active") return "Combat controls are active.";
  if (lifecycle === "combat-reconciliation")
    return "Combat results are reconciling.";
  if (lifecycle === "second-main") return "Second main actions are ready.";
  if (lifecycle === "end-step") return "End step bookkeeping is processing.";
  if (lifecycle === "ready-to-end") return "Turn is ready to end.";
  if (lifecycle === "completed") return "Turn completed.";
  if (lifecycle === "recovering") return "Turn workflow recovered safely.";
  if (focused) return `Next action. ${focused.label}.`;
  return "Live turn is synchronized.";
}

function liveTurnFingerprint(field: FieldState): string {
  return stableId(
    "live-turn-state",
    serializeStable({
      sessionId: field.session.id,
      turnId: field.preTurnPlanner.turnId,
      intentVersion: field.preTurnPlanner.intentVersion,
      ambientMode: field.ambient.currentMode,
      phase: field.ambient.context.observedTurn?.phase ?? "unknown",
      actionItems: field.activeTurnActionStrip.items.map((item) => [
        item.id,
        item.status,
        item.validity,
        item.confirmationReceiptId,
      ]),
      decisions: field.athena.decisions.requests.map((request) => [
        request.id,
        request.status,
        request.updatedAt,
      ]),
    }),
  );
}

function appendCheckpoint(
  state: AthenaLiveTurnOrchestratorState,
  input: {
    lifecycle: AthenaLiveTurnLifecycle;
    phase: AthenaLiveTurnPhase;
    focused: ActiveTurnActionStripItem | null;
    blockingDecisionId: string | null;
    canonicalEventIds: string[];
    timestamp: string;
    reason: string;
  },
): AthenaLiveTurnCheckpoint[] {
  const checkpoint: AthenaLiveTurnCheckpoint = {
    id: stableId(
      "turn-checkpoint",
      `${state.sessionId}:${state.turnId}:${state.sequenceVersion + 1}:${input.reason}`,
    ),
    lifecycle: input.lifecycle,
    phase: input.phase,
    currentActionId: input.focused?.id ?? null,
    currentPreparedActionId: input.focused?.preparedActionId ?? null,
    blockingDecisionId: input.blockingDecisionId,
    canonicalEventIds: boundedUnique(input.canonicalEventIds),
    createdAt: input.timestamp,
    reason: sanitizeText(input.reason),
  };
  return [...state.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
}

function transitionState(
  state: AthenaLiveTurnOrchestratorState,
  lifecycle: AthenaLiveTurnLifecycle,
  timestamp: string,
  update: Partial<AthenaLiveTurnOrchestratorState> & {
    summary?: string;
    events?: AthenaLiveTurnTutorialEvent[];
  } = {},
): AthenaLiveTurnOrchestratorState {
  return createDefaultAthenaLiveTurnState({
    ...state,
    ...update,
    lifecycle,
    previousLifecycle:
      lifecycle === state.lifecycle ? state.previousLifecycle : state.lifecycle,
    sequenceVersion: state.sequenceVersion + 1,
    updatedAt: timestamp,
    semanticSummary: update.summary ?? state.semanticSummary,
    semanticEvents: update.events ?? [],
  });
}

function normalizeDiagnostics(value: unknown): AthenaLiveTurnDiagnostics {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AthenaLiveTurnDiagnostics>)
      : {};
  return {
    version: ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION,
    turnsStarted: integer(candidate.turnsStarted, 0, Number.MAX_SAFE_INTEGER),
    turnsCompleted: integer(
      candidate.turnsCompleted,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    actionsFocused: integer(
      candidate.actionsFocused,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    preparedActionsProcessed: integer(
      candidate.preparedActionsProcessed,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    unexpectedActionsProcessed: integer(
      candidate.unexpectedActionsProcessed,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    automaticSequences: integer(
      candidate.automaticSequences,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    decisionPauses: integer(
      candidate.decisionPauses,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    decisionResumes: integer(
      candidate.decisionResumes,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    combatHandoffs: integer(
      candidate.combatHandoffs,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    combatReconciliations: integer(
      candidate.combatReconciliations,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    secondMainTransitions: integer(
      candidate.secondMainTransitions,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    endTurnRequests: integer(
      candidate.endTurnRequests,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    endTurnBlocks: integer(candidate.endTurnBlocks, 0, Number.MAX_SAFE_INTEGER),
    recoveryCount: integer(candidate.recoveryCount, 0, Number.MAX_SAFE_INTEGER),
    staleWorkRejections: integer(
      candidate.staleWorkRejections,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    duplicateActionPreventions: integer(
      candidate.duplicateActionPreventions,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    incrementalRevalidations: integer(
      candidate.incrementalRevalidations,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    fullPlanRebuilds: integer(
      candidate.fullPlanRebuilds,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    maximumPendingTriggerCount: integer(
      candidate.maximumPendingTriggerCount,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    maximumCheckpointCount: integer(
      candidate.maximumCheckpointCount,
      0,
      MAX_CHECKPOINTS,
    ),
    lastTransitionDurationMs: numberValue(candidate.lastTransitionDurationMs),
    maximumTransitionDurationMs: numberValue(
      candidate.maximumTransitionDurationMs,
    ),
    lastError: nullableString(candidate.lastError),
    productionVisible: false,
  };
}

function normalizeBlockers(value: unknown): AthenaLiveTurnBlocker[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<AthenaLiveTurnBlocker>;
      const id = nullableString(candidate.id);
      if (!id) return null;
      const kind =
        candidate.kind === "decision" ||
        candidate.kind === "pending-trigger" ||
        candidate.kind === "authority" ||
        candidate.kind === "manual-result" ||
        candidate.kind === "processing-failure" ||
        candidate.kind === "combat-reconciliation"
          ? candidate.kind
          : "processing-failure";
      return {
        id,
        kind,
        sourceId: nullableString(candidate.sourceId),
        required: candidate.required !== false,
        label: sanitizeText(candidate.label),
        semanticDescription: sanitizeText(candidate.semanticDescription),
      } satisfies AthenaLiveTurnBlocker;
    })
    .filter((entry): entry is AthenaLiveTurnBlocker => Boolean(entry))
    .slice(0, 200);
}

function normalizeCheckpoints(value: unknown): AthenaLiveTurnCheckpoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<AthenaLiveTurnCheckpoint>;
      const id = nullableString(candidate.id);
      if (!id) return null;
      return {
        id,
        lifecycle: normalizeLifecycle(candidate.lifecycle),
        phase: normalizePhase(candidate.phase),
        currentActionId: nullableString(candidate.currentActionId),
        currentPreparedActionId: nullableString(
          candidate.currentPreparedActionId,
        ),
        blockingDecisionId: nullableString(candidate.blockingDecisionId),
        canonicalEventIds: stringArray(candidate.canonicalEventIds, 100),
        createdAt: nullableString(candidate.createdAt) ?? DEFAULT_TIMESTAMP,
        reason: sanitizeText(candidate.reason),
      } satisfies AthenaLiveTurnCheckpoint;
    })
    .filter((entry): entry is AthenaLiveTurnCheckpoint => Boolean(entry))
    .slice(-MAX_CHECKPOINTS);
}

function normalizeWorkToken(value: unknown): AthenaLiveTurnWorkToken | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AthenaLiveTurnWorkToken>;
  const id = nullableString(candidate.id);
  const sessionId = nullableString(candidate.sessionId);
  const turnId = nullableString(candidate.turnId);
  if (!id || sessionId === null || turnId === null) return null;
  return {
    id,
    sessionId,
    turnId,
    actionId: nullableString(candidate.actionId),
    generation: integer(candidate.generation, 0, Number.MAX_SAFE_INTEGER),
    createdAt: nullableString(candidate.createdAt) ?? DEFAULT_TIMESTAMP,
  };
}

function normalizeTutorialEvents(
  value: unknown,
): AthenaLiveTurnTutorialEvent[] {
  if (!Array.isArray(value)) return [];
  const allowed: AthenaLiveTurnTutorialEvent[] = [
    "live-turn-started",
    "next-action-focused",
    "action-processing-started",
    "automatic-sequencing-completed",
    "decision-paused",
    "decision-resumed",
    "combat-handoff-started",
    "combat-reconciled",
    "second-main-started",
    "end-step-started",
    "turn-reconciliation-started",
    "live-turn-completed",
    "live-turn-recovered",
  ];
  return [...new Set(value.filter((entry) => allowed.includes(entry)))];
}

function normalizeLifecycle(value: unknown): AthenaLiveTurnLifecycle {
  const allowed: AthenaLiveTurnLifecycle[] = [
    "pre-turn-preparation",
    "ready-to-begin",
    "turn-active",
    "processing-action",
    "processing-consequences",
    "awaiting-decision",
    "ready-for-next-action",
    "combat-preparation",
    "combat-active",
    "combat-reconciliation",
    "second-main",
    "end-step",
    "turn-reconciliation",
    "ready-to-end",
    "completed",
    "interrupted",
    "recovering",
    "authority-required",
    "manual-intervention-required",
  ];
  return allowed.includes(value as AthenaLiveTurnLifecycle)
    ? (value as AthenaLiveTurnLifecycle)
    : "pre-turn-preparation";
}

function normalizePhase(value: unknown): AthenaLiveTurnPhase {
  return value === "beginning" ||
    value === "precombat-main" ||
    value === "combat" ||
    value === "postcombat-main" ||
    value === "ending"
    ? value
    : "unknown";
}

function normalizeActionKind(value: unknown): ActiveTurnActionKind | null {
  const allowed: ActiveTurnActionKind[] = [
    "begin-turn",
    "draw",
    "play-planned-land",
    "cast-planned-spell",
    "activate-planned-ability",
    "sacrifice-planned-permanent",
    "move-planned-card",
    "move-to-combat",
    "declare-planned-attack",
    "resolve-planned-trigger",
    "hold-priority-reminder",
    "end-combat",
    "second-main-reminder",
    "end-turn",
    "pass-priority",
  ];
  return allowed.includes(value as ActiveTurnActionKind)
    ? (value as ActiveTurnActionKind)
    : null;
}

function isActiveLifecycle(value: AthenaLiveTurnLifecycle): boolean {
  return ![
    "pre-turn-preparation",
    "ready-to-begin",
    "completed",
    "interrupted",
    "recovering",
  ].includes(value);
}

function boundedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].slice(-MAX_HISTORY_IDS);
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((entry) => [entry.id, entry])).values()];
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function sanitizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300)
    : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 300)
    : null;
}

function stringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((entry): entry is string =>
            Boolean(nullableString(entry)),
          ),
        ),
      ]
        .map((entry) => entry.slice(0, 300))
        .slice(-max)
    : [];
}

function integer(value: unknown, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.max(min, Math.min(max, Math.trunc(numeric)))
    : min;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}
