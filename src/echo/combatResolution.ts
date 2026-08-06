import { makeId, recalculateStats, withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type {
  FieldState,
  GameEvent,
  GameEventType,
  ResolutionResult,
  ResolutionStep,
  Zone,
} from "../domain/types";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type { AmbientGameplayMode } from "./ambientTypes";
import {
  ambientEventPipeline,
  createAmbientPreview,
} from "./ambientEventPipeline";
import type {
  AmbientEntityReference,
  AmbientFieldMutation,
  AmbientIntentInput,
} from "./ambientEventTypes";
import {
  decideClarificationForIntent,
  normalizeClarificationSettings,
} from "./clarification";
import {
  activateListeningWindow,
  getActiveListeningWindow,
} from "./contextualListening";
import {
  createBattlefieldContext,
  resolveEchoEntity,
} from "./entityResolution";
import type { EchoEntityKind } from "./entityResolutionTypes";
import {
  ECHO_COMBAT_RESOLUTION_VERSION,
  type EchoCombatResolutionClarificationRequest,
  type EchoCombatResolutionDiagnostics,
  type EchoCombatResolutionEntity,
  type EchoCombatResolutionInput,
  type EchoCombatResolutionOutcome,
  type EchoCombatResolutionOutcomeKind,
  type EchoCombatResolutionOutcomeStatus,
  type EchoCombatResolutionPreview,
  type EchoCombatResolutionPreviewInput,
  type EchoCombatResolutionPublishInput,
  type EchoCombatResolutionResult,
  type EchoCombatResolutionSession,
  type EchoCombatResolutionSessionStatus,
  type EchoCombatResolutionSettings,
  type EchoCombatResolutionState,
  type EchoCombatResolutionTrigger,
} from "./combatResolutionTypes";

const MAX_COMBAT_RESOLUTION_SESSIONS = 8;
const DEFAULT_CONFIDENCE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const TARGET_EXPECTED_KINDS: EchoEntityKind[] = [
  "commander",
  "creature",
  "token",
  "tokenStack",
  "permanent",
];

const NUMBER_WORDS = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["a", 1],
  ["an", 1],
  ["single", 1],
  ["two", 2],
  ["both", 2],
  ["couple", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
]);

const COMPLETION_PHRASES = new Set([
  "thats it",
  "that is it",
  "done",
  "all done",
  "combat done",
  "combat is done",
  "resolution done",
  "finish combat",
]);

export function createDefaultCombatResolutionSettings(
  input: Partial<EchoCombatResolutionSettings> = {},
): EchoCombatResolutionSettings {
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    enabled: input.enabled ?? true,
    previewRequiresConfirmation: input.previewRequiresConfirmation ?? true,
    allowMultipleOutcomes: input.allowMultipleOutcomes ?? true,
    clearCombatStatusesOnCommit: input.clearCombatStatusesOnCommit ?? false,
    recordOpponentDamageAsUntracked:
      input.recordOpponentDamageAsUntracked ?? true,
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: input.developerDiagnosticsEnabled ?? false,
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    aiStrategyRecommendations: false,
    lastResetAt:
      typeof input.lastResetAt === "string" ? input.lastResetAt : null,
  };
}

export function normalizeCombatResolutionSettings(
  value: unknown,
): EchoCombatResolutionSettings {
  const defaults = createDefaultCombatResolutionSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoCombatResolutionSettings>;
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    previewRequiresConfirmation:
      candidate.previewRequiresConfirmation === undefined
        ? defaults.previewRequiresConfirmation
        : Boolean(candidate.previewRequiresConfirmation),
    allowMultipleOutcomes:
      candidate.allowMultipleOutcomes === undefined
        ? defaults.allowMultipleOutcomes
        : Boolean(candidate.allowMultipleOutcomes),
    clearCombatStatusesOnCommit:
      candidate.clearCombatStatusesOnCommit === undefined
        ? defaults.clearCombatStatusesOnCommit
        : Boolean(candidate.clearCombatStatusesOnCommit),
    recordOpponentDamageAsUntracked:
      candidate.recordOpponentDamageAsUntracked === undefined
        ? defaults.recordOpponentDamageAsUntracked
        : Boolean(candidate.recordOpponentDamageAsUntracked),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: Boolean(candidate.developerDiagnosticsEnabled),
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    aiStrategyRecommendations: false,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultCombatResolutionState(
  input: Partial<EchoCombatResolutionState> = {},
): EchoCombatResolutionState {
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    activeSessionId: null,
    sessions: [],
    lastPreviewId: null,
    lastCommittedSessionId: null,
    lastCancelledSessionId: null,
    ...input,
    diagnostics: createCombatResolutionDiagnostics({
      ...input.diagnostics,
      activeSessionId: input.activeSessionId ?? null,
      lastPreviewId: input.lastPreviewId ?? null,
    }),
  };
}

export function normalizeCombatResolutionState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoCombatResolutionSettings;
    knownGroupIds?: string[];
    allowActiveSession?: boolean;
  } = {},
): EchoCombatResolutionState {
  normalizeCombatResolutionSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultCombatResolutionState({
      diagnostics: createCombatResolutionDiagnostics(null),
    });
  }
  const candidate = value as Partial<EchoCombatResolutionState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((session) =>
          normalizeCombatResolutionSession(session, {
            timestamp: options.fallbackTimestamp,
            knownGroupIds,
          }),
        )
        .filter((session): session is EchoCombatResolutionSession =>
          Boolean(session),
        )
        .slice(-MAX_COMBAT_RESOLUTION_SESSIONS)
    : [];
  const activeSession =
    options.allowActiveSession && typeof candidate.activeSessionId === "string"
      ? (sessions.find(
          (session) =>
            session.id === candidate.activeSessionId &&
            !isTerminalSessionStatus(session.status),
        ) ?? null)
      : null;
  const safeSessions = sessions.map((session) => {
    if (activeSession?.id === session.id) return session;
    return isTerminalSessionStatus(session.status)
      ? session
      : recoverCombatResolutionSession(session, {
          timestamp: options.fallbackTimestamp,
          reason: "Combat resolution session restored without active workflow.",
        });
  });
  return createDefaultCombatResolutionState({
    activeSessionId: activeSession?.id ?? null,
    sessions: safeSessions,
    lastPreviewId:
      typeof candidate.lastPreviewId === "string"
        ? candidate.lastPreviewId
        : null,
    lastCommittedSessionId:
      typeof candidate.lastCommittedSessionId === "string"
        ? candidate.lastCommittedSessionId
        : null,
    lastCancelledSessionId:
      typeof candidate.lastCancelledSessionId === "string"
        ? candidate.lastCancelledSessionId
        : null,
    diagnostics: createCombatResolutionDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeSessionId: activeSession?.id ?? null,
      lastPreviewId:
        typeof candidate.lastPreviewId === "string"
          ? candidate.lastPreviewId
          : null,
      directBattlefieldMutation: false,
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
    }),
  });
}

export function startCombatResolutionSession(
  field: FieldState,
  options: {
    timestamp?: string;
    trigger?: EchoCombatResolutionTrigger;
    settings?: EchoCombatResolutionSettings;
  } = {},
): EchoCombatResolutionResult {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatResolutionSettings(options.settings);
  const contextualListening = activateListeningWindow(
    field.contextualListening,
    "combatResolution",
    {
      timestamp,
      source:
        options.trigger === "action-strip"
          ? "action-strip"
          : options.trigger === "manual-resolution"
            ? "phase"
            : "explicit-command",
      ambientMode: "resolution",
      reason: "Combat resolution session started.",
    },
  );
  const activeWindow = getActiveListeningWindow(contextualListening);
  const session: EchoCombatResolutionSession = {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id: makeId("echo-combat-resolution"),
    fieldSessionId: field.session.id,
    status: settings.enabled ? "resolving" : "failed",
    trigger: options.trigger ?? "voice-resolution",
    ambientMode: field.ambient.currentMode,
    listeningWindowId: activeWindow?.id ?? makeId("listening-window"),
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    transcript: [],
    normalizedTranscript: [],
    outcomes: [],
    preview: null,
    currentClarificationId: null,
    pipelineEventId: null,
    recoveryReason: settings.enabled
      ? null
      : "Combat resolution workflow is disabled.",
    accessibilityAnnouncement: settings.enabled
      ? "Combat resolution started."
      : "Combat resolution workflow unavailable.",
    directBattlefieldMutation: false,
  };
  return {
    state: upsertCombatResolutionSession(field.combatResolution, session),
    session,
    window: activeWindow,
    preview: null,
    intent: null,
    pipelineResult: null,
    event: null,
    resolutionResult: null,
  };
}

export function captureCombatResolutionTranscript(
  input: EchoCombatResolutionInput,
): EchoCombatResolutionResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatResolutionSettings(input.settings);
  const currentSession =
    input.session ??
    activeCombatResolutionSession(input.field.combatResolution) ??
    startCombatResolutionSession(input.field, {
      timestamp,
      settings,
    }).session;
  if (!settings.enabled) {
    const failed = failCombatResolutionSession(
      currentSession,
      "Combat resolution workflow is disabled.",
      timestamp,
    );
    return resultForSession(input.field, failed, null, null, null);
  }
  const normalizedTranscript = normalizeResolutionText(input.transcript);
  if (isCompletionPhrase(normalizedTranscript)) {
    const preview = createCombatResolutionPreview({
      field: input.field,
      session: currentSession,
      timestamp,
      settings,
    });
    const completed = {
      ...currentSession,
      status: preview.clarificationRequests.length
        ? "awaitingClarification"
        : "previewReady",
      updatedAt: timestamp,
      completedAt: timestamp,
      preview,
      currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
      accessibilityAnnouncement:
        preview.summary[0] ?? "Combat resolution preview ready.",
    } satisfies EchoCombatResolutionSession;
    return resultForSession(
      input.field,
      completed,
      preview,
      createCombatResolutionIntent(completed, preview, timestamp),
      null,
    );
  }
  const fragments = resolutionFragments(input.transcript);
  const parsedOutcomes = fragments.flatMap((fragment, index) =>
    parseCombatResolutionOutcome({
      field: input.field,
      fragment,
      timestamp,
      order: currentSession.outcomes.length + index,
      settings,
    }),
  );
  const sessionWithTranscript = appendCombatResolutionTranscript(
    currentSession,
    input.transcript,
    timestamp,
  );
  const outcomes = settings.allowMultipleOutcomes
    ? [...sessionWithTranscript.outcomes, ...parsedOutcomes]
    : [...sessionWithTranscript.outcomes, ...parsedOutcomes.slice(0, 1)];
  const nextSession: EchoCombatResolutionSession = {
    ...sessionWithTranscript,
    status: parsedOutcomes.some((outcome) => outcome.clarificationRequired)
      ? "awaitingClarification"
      : "previewReady",
    outcomes,
    updatedAt: timestamp,
  };
  const preview = createCombatResolutionPreview({
    field: input.field,
    session: nextSession,
    timestamp,
    settings,
  });
  const sessionWithPreview: EchoCombatResolutionSession = {
    ...nextSession,
    status: preview.clarificationRequests.length
      ? "awaitingClarification"
      : "previewReady",
    preview,
    currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
    accessibilityAnnouncement:
      preview.summary[0] ?? "Combat resolution preview ready.",
  };
  return resultForSession(
    input.field,
    sessionWithPreview,
    preview,
    createCombatResolutionIntent(sessionWithPreview, preview, timestamp),
    null,
  );
}

export function createCombatResolutionPreview(
  input: EchoCombatResolutionPreviewInput,
): EchoCombatResolutionPreview {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatResolutionSettings(input.settings);
  const context = createBattlefieldContext(input.field, { timestamp });
  const knownGroupIds = new Set(input.field.groups.map((group) => group.id));
  const outcomes = input.session.outcomes.map((outcome) =>
    normalizeCombatResolutionOutcome(outcome, {
      timestamp,
      knownGroupIds,
    }),
  );
  const clarificationRequests = outcomes.flatMap((outcome) =>
    clarificationRequestsForOutcome({
      field: input.field,
      outcome,
      timestamp,
      settings,
      candidateLabels: context.battlefield.map((entry) => entry.label),
    }),
  );
  const confirmedOutcomeCount = outcomes.filter(
    (outcome) =>
      outcome.status !== "skipped" &&
      outcome.status !== "rejected" &&
      !outcome.clarificationRequired,
  ).length;
  const rejectedOutcomeCount = outcomes.filter(
    (outcome) => outcome.status === "rejected",
  ).length;
  const lowConfidenceOutcomeCount = outcomes.filter(
    (outcome) =>
      outcome.confidence.level === "low" ||
      outcome.confidence.level === "unknown",
  ).length;
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id: input.session.preview?.id ?? makeId("echo-combat-resolution-preview"),
    sessionId: input.session.id,
    createdAt: input.session.preview?.createdAt ?? timestamp,
    updatedAt: timestamp,
    outcomes,
    summary: summarizeCombatResolutionPreview(outcomes),
    confirmedOutcomeCount,
    pendingClarificationCount: clarificationRequests.length,
    rejectedOutcomeCount,
    lowConfidenceOutcomeCount,
    clarificationRequests,
    confidence: previewConfidence(outcomes, timestamp),
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    directBattlefieldMutation: false,
  };
}

export function publishCombatResolutionToPipeline(
  input: EchoCombatResolutionPublishInput,
): EchoCombatResolutionResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const preview =
    input.preview ??
    input.session.preview ??
    createCombatResolutionPreview({
      field: input.field,
      session: input.session,
      timestamp,
      settings: input.field.settings.voice.combatResolution,
    });
  const intent = createCombatResolutionIntent(
    input.session,
    preview,
    timestamp,
  );
  if (preview.clarificationRequests.length) {
    const pendingSession: EchoCombatResolutionSession = {
      ...input.session,
      status: "awaitingClarification",
      preview,
      updatedAt: timestamp,
      currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
      accessibilityAnnouncement:
        preview.clarificationRequests[0]?.question ??
        "Combat resolution needs clarification.",
    };
    return resultForSession(input.field, pendingSession, preview, intent, null);
  }
  const committingSession: EchoCombatResolutionSession = {
    ...input.session,
    status: "committing",
    preview,
    updatedAt: timestamp,
  };
  const currentField = normalizeField({
    ...input.field,
    combatResolution: upsertCombatResolutionSession(
      input.field.combatResolution,
      committingSession,
    ),
  });
  let resolutionResult: ResolutionResult | null = null;
  const mutation: AmbientFieldMutation = ({ field }) => {
    resolutionResult = applyCombatResolutionPreviewToField({
      field,
      preview,
      timestamp,
      settings: input.field.settings.voice.combatResolution,
    });
    return resolutionResult;
  };
  const pipelineResult = ambientEventPipeline.process({
    field: currentField,
    intent,
    mutation,
    approval: {
      method: input.approval ?? "automatic",
      decision: "approved",
      reason: "Combat resolution preview confirmed.",
    },
    previewBuilder: ({ intent: previewIntent, resolvedEntities }) =>
      createAmbientPreview({
        field: currentField,
        intent: previewIntent,
        resolvedEntities,
        timestamp,
      }),
    timestamp,
  });
  const committed = pipelineResult.status === "completed";
  const committedOutcomes = preview.outcomes.map((outcome) =>
    outcome.status === "skipped" || outcome.status === "rejected"
      ? outcome
      : {
          ...outcome,
          status: committed ? ("committed" as const) : ("recovered" as const),
        },
  );
  const committedSession: EchoCombatResolutionSession = {
    ...input.session,
    status: committed ? "committed" : "failed",
    updatedAt: timestamp,
    completedAt: committed ? timestamp : null,
    outcomes: committedOutcomes,
    preview: {
      ...preview,
      outcomes: committedOutcomes,
      updatedAt: timestamp,
    },
    currentClarificationId: null,
    pipelineEventId: pipelineResult.event?.id ?? null,
    recoveryReason: committed
      ? null
      : "Combat resolution could not be published.",
    accessibilityAnnouncement: committed
      ? "Combat resolution committed."
      : "Combat resolution failed safely.",
  };
  return {
    state: upsertCombatResolutionSession(
      committed
        ? pipelineResult.field.combatResolution
        : input.field.combatResolution,
      committedSession,
    ),
    session: committedSession,
    window: null,
    preview: committedSession.preview,
    intent,
    pipelineResult,
    event: pipelineResult.event,
    resolutionResult,
  };
}

export function applyCombatResolutionPreviewToField(input: {
  field: FieldState;
  preview: EchoCombatResolutionPreview;
  timestamp?: string;
  settings?: EchoCombatResolutionSettings;
}): ResolutionResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeCombatResolutionSettings(input.settings);
  const before = input.field;
  let next = structuredClone(input.field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();

  for (const outcome of input.preview.outcomes) {
    if (
      outcome.status === "skipped" ||
      outcome.status === "rejected" ||
      outcome.clarificationRequired
    ) {
      continue;
    }
    next = applyCombatOutcome(next, outcome, details, events, changedGroupIds);
  }
  if (
    settings.clearCombatStatusesOnCommit ||
    input.preview.outcomes.some((outcome) => outcome.kind === "combat-cleanup")
  ) {
    next = clearCombatStatuses(next, details, events, changedGroupIds);
  }
  return finalizeCombatResolutionResult(before, next, {
    summary: input.preview.summary,
    details,
    events,
    changedGroupIds,
    timestamp,
  });
}

export function cancelCombatResolutionSession(
  session: EchoCombatResolutionSession,
  options: { timestamp?: string; reason?: string } = {},
): EchoCombatResolutionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "cancelled",
    updatedAt: timestamp,
    completedAt: timestamp,
    currentClarificationId: null,
    recoveryReason: options.reason ?? "Combat resolution session cancelled.",
    accessibilityAnnouncement: "Combat resolution session cancelled.",
  };
}

export function recoverCombatResolutionSession(
  session: EchoCombatResolutionSession,
  options: { timestamp?: string; reason?: string } = {},
): EchoCombatResolutionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "recovered",
    updatedAt: timestamp,
    currentClarificationId: null,
    recoveryReason:
      options.reason ?? "Combat resolution session recovered safely.",
    accessibilityAnnouncement: "Combat resolution session recovered.",
  };
}

export function getCombatResolutionDiagnostics(
  state: EchoCombatResolutionState,
): EchoCombatResolutionDiagnostics {
  return createCombatResolutionDiagnostics({
    ...state.diagnostics,
    activeSessionId: state.activeSessionId,
    lastPreviewId: state.lastPreviewId,
    stagedOutcomeCount:
      state.sessions.find((session) => session.id === state.activeSessionId)
        ?.outcomes.length ?? 0,
  });
}

function parseCombatResolutionOutcome(input: {
  field: FieldState;
  fragment: { original: string; normalized: string };
  timestamp: string;
  order: number;
  settings: EchoCombatResolutionSettings;
}): EchoCombatResolutionOutcome[] {
  const parsed = parseOutcomeCore(input.fragment.normalized);
  if (!parsed) {
    return [
      createOutcome({
        kind: "combat-note",
        order: input.order,
        originalTranscript: input.fragment.original,
        normalizedTranscript: input.fragment.normalized,
        quantity: 1,
        targetText: null,
        defenderLabel: null,
        generatedEventType: "battlefield-note-created",
        note: input.fragment.original,
        confidenceLevel: "medium",
        timestamp: input.timestamp,
        field: input.field,
      }),
    ];
  }
  return [
    createOutcome({
      ...parsed,
      order: input.order,
      originalTranscript: input.fragment.original,
      normalizedTranscript: input.fragment.normalized,
      timestamp: input.timestamp,
      field: input.field,
    }),
  ];
}

function createOutcome(input: {
  kind: EchoCombatResolutionOutcomeKind;
  order: number;
  originalTranscript: string;
  normalizedTranscript: string;
  quantity: number;
  targetText: string | null;
  defenderLabel: string | null;
  generatedEventType: GameEventType | null;
  note: string | null;
  confidenceLevel: AmbientConfidenceLevel;
  timestamp: string;
  field: FieldState;
}): EchoCombatResolutionOutcome {
  const target = input.targetText
    ? resolveCombatResolutionTarget(
        input.field,
        input.targetText,
        input.timestamp,
      )
    : null;
  const requiresTarget = outcomeRequiresTarget(input.kind);
  const missingTarget = requiresTarget && !target?.groupId;
  const computedConfidence = confidence(
    input.confidenceLevel,
    input.timestamp,
    [
      target?.groupId
        ? "Combat outcome target resolved from the current battlefield."
        : missingTarget
          ? "Combat outcome target requires clarification."
          : "Combat outcome does not require a battlefield target.",
    ],
  );
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id: makeId("echo-combat-outcome"),
    order: input.order,
    kind: input.kind,
    status: missingTarget ? "pendingClarification" : "staged",
    originalTranscript: input.originalTranscript,
    normalizedTranscript: input.normalizedTranscript,
    quantity: Math.max(0, Math.trunc(input.quantity)),
    target,
    defenderLabel: input.defenderLabel,
    generatedEventType: input.generatedEventType,
    note: input.note,
    confidence: missingTarget
      ? confidence("low", input.timestamp)
      : computedConfidence,
    clarificationRequired: missingTarget,
    clarificationQuestion: missingTarget ? "Which combat object?" : null,
    directBattlefieldMutation: false,
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
  };
}

function parseOutcomeCore(text: string): {
  kind: EchoCombatResolutionOutcomeKind;
  quantity: number;
  targetText: string | null;
  defenderLabel: string | null;
  generatedEventType: GameEventType | null;
  note: string | null;
  confidenceLevel: AmbientConfidenceLevel;
} | null {
  if (
    text === "clean up combat" ||
    text === "clear combat" ||
    text === "end combat" ||
    text === "combat over"
  ) {
    return {
      kind: "combat-cleanup",
      quantity: 1,
      targetText: null,
      defenderLabel: null,
      generatedEventType: "battlefield-note-created",
      note: "Combat cleanup reported.",
      confidenceLevel: "high",
    };
  }
  const commanderDamage = text.match(
    /^(?:take|took|mark|record)\s+(\d+|[a-z]+)\s+commander\s+damage$/,
  );
  if (commanderDamage) {
    return {
      kind: "commander-damage-to-you",
      quantity: extractQuantity(commanderDamage[1]) ?? 1,
      targetText: null,
      defenderLabel: "you",
      generatedEventType: "damage-dealt",
      note: "Commander combat damage reported against you.",
      confidenceLevel: "high",
    };
  }
  const markedDamage = text.match(
    /^(.+?)\s+(?:takes|took|has|marked?|mark)\s+(\d+|[a-z]+)\s+damage$/,
  );
  if (markedDamage) {
    return {
      kind: "attacker-damage-marked",
      quantity: extractQuantity(markedDamage[2]) ?? 1,
      targetText: cleanTargetText(markedDamage[1]),
      defenderLabel: null,
      generatedEventType: "damage-dealt",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const damageToPlayer = text.match(
    /^(?:(.+?)\s+)?(?:deals?|dealt|hits?|hit|does|did)?\s*(\d+|[a-z]+)\s+(?:combat\s+)?damage\s+(?:to|at|into)\s+(.+)$/,
  );
  if (damageToPlayer) {
    return {
      kind: "opponent-damage-reported",
      quantity: extractQuantity(damageToPlayer[2]) ?? 1,
      targetText: damageToPlayer[1] ? cleanTargetText(damageToPlayer[1]) : null,
      defenderLabel: titleCase(cleanTargetText(damageToPlayer[3])),
      generatedEventType: "damage-dealt",
      note: "Opponent damage is reported but opponent life is not tracked in Lite.",
      confidenceLevel: "medium",
    };
  }
  const died =
    text.match(/^(.+?)\s+(?:dies|died|is dead|goes to graveyard)$/) ??
    text.match(/^(?:destroy|kill|killed)\s+(.+)$/);
  if (died) {
    return {
      kind: "attacker-died",
      quantity: 1,
      targetText: cleanTargetText(died[1]),
      defenderLabel: null,
      generatedEventType: "permanent-died",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const exiled =
    text.match(/^(.+?)\s+(?:is\s+)?exiled$/) ??
    text.match(/^(?:exile|exiled)\s+(.+)$/);
  if (exiled) {
    return {
      kind: "attacker-exiled",
      quantity: 1,
      targetText: cleanTargetText(exiled[1]),
      defenderLabel: null,
      generatedEventType: "permanent-exiled",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const hand =
    text.match(/^(.+?)\s+(?:returns?|returned|bounced?)\s+to\s+hand$/) ??
    text.match(/^(?:return|bounce)\s+(.+?)\s+to\s+hand$/);
  if (hand) {
    return {
      kind: "attacker-returned-to-hand",
      quantity: 1,
      targetText: cleanTargetText(hand[1]),
      defenderLabel: null,
      generatedEventType: "permanent-returned-to-hand",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const survived = text.match(/^(.+?)\s+(?:survives|survived|lives|lived)$/);
  if (survived) {
    return {
      kind: "attacker-survived",
      quantity: 1,
      targetText: cleanTargetText(survived[1]),
      defenderLabel: null,
      generatedEventType: "battlefield-note-created",
      note: "Combat survival reported.",
      confidenceLevel: "medium",
    };
  }
  const tapped =
    text.match(/^(?:tap|tapped)\s+(.+)$/) ??
    text.match(/^(.+?)\s+(?:is\s+)?tapped$/);
  if (tapped) {
    return {
      kind: "attacker-tapped",
      quantity: 1,
      targetText: cleanTargetText(tapped[1]),
      defenderLabel: null,
      generatedEventType: "permanent-tapped",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const untapped =
    text.match(/^(?:untap|untapped)\s+(.+)$/) ??
    text.match(/^(.+?)\s+(?:is\s+)?untapped$/);
  if (untapped) {
    return {
      kind: "attacker-untapped",
      quantity: 1,
      targetText: cleanTargetText(untapped[1]),
      defenderLabel: null,
      generatedEventType: "permanent-untapped",
      note: null,
      confidenceLevel: "medium",
    };
  }
  const blocked = text.match(/^(.+?)\s+(?:was\s+)?blocked$/);
  if (blocked) {
    return {
      kind: "combat-note",
      quantity: 1,
      targetText: cleanTargetText(blocked[1]),
      defenderLabel: null,
      generatedEventType: "battlefield-note-created",
      note: "Blocker information recorded for manual resolution.",
      confidenceLevel: "medium",
    };
  }
  return null;
}

function applyCombatOutcome(
  field: FieldState,
  outcome: EchoCombatResolutionOutcome,
  details: ResolutionStep[],
  events: GameEvent[],
  changedGroupIds: Set<string>,
): FieldState {
  if (outcome.kind === "commander-damage-to-you") {
    const beforeLife = field.player.life;
    const next = {
      ...field,
      player: {
        ...field.player,
        life: Math.max(0, field.player.life - outcome.quantity),
        counters: {
          ...field.player.counters,
          commanderDamage:
            field.player.counters.commanderDamage + outcome.quantity,
        },
      },
    };
    details.push(
      step(
        "Commander combat damage reported",
        `Recorded ${outcome.quantity} commander damage and adjusted life from ${beforeLife} to ${next.player.life}.`,
        "damage-dealt",
      ),
    );
    events.push(
      createCombatResolutionEvent("damage-dealt", null, outcome.quantity, [], {
        commanderDamage: true,
        combatDamage: true,
      }),
    );
    return next;
  }
  if (
    outcome.kind === "opponent-damage-reported" ||
    outcome.kind === "combat-damage-to-player"
  ) {
    details.push(
      step(
        "Opponent combat damage reported",
        `${outcome.quantity} damage to ${outcome.defenderLabel ?? "an opponent"} was recorded as untracked opponent damage.`,
        "damage-dealt",
      ),
    );
    events.push(
      createCombatResolutionEvent(
        "damage-dealt",
        outcome.target?.groupId ?? null,
        outcome.quantity,
        outcome.target?.groupId ? [outcome.target.groupId] : [],
        {
          combatDamage: true,
          opponentDamageUntracked: true,
          defenderLabel: outcome.defenderLabel ?? "opponent",
        },
      ),
    );
    return field;
  }
  if (outcome.kind === "combat-cleanup") {
    return field;
  }
  const groupId = outcome.target?.groupId;
  if (!groupId) {
    details.push(
      step(
        "Combat outcome not applied",
        outcome.clarificationQuestion ?? "Combat outcome needs clarification.",
      ),
    );
    return field;
  }
  const group = field.groups.find((entry) => entry.id === groupId);
  if (!group) {
    details.push(
      step(
        "Combat object missing",
        `${outcome.target?.label ?? "Combat object"} is no longer available.`,
      ),
    );
    return field;
  }
  if (
    outcome.kind === "attacker-died" ||
    outcome.kind === "attacker-exiled" ||
    outcome.kind === "attacker-returned-to-hand"
  ) {
    const destination = destinationForOutcome(outcome.kind);
    const groups = field.groups.map((entry) =>
      entry.id === groupId
        ? withStackKey({
            ...entry,
            zone: destination,
            statuses: {
              ...entry.statuses,
              attacking: false,
              blocking: false,
            },
          })
        : entry,
    );
    changedGroupIds.add(groupId);
    details.push(
      step(
        "Combat permanent moved",
        `${group.label} ${movementDescription(outcome.kind)}.`,
        outcome.generatedEventType ?? "battlefield-note-created",
      ),
    );
    events.push(
      createCombatResolutionEvent(
        outcome.generatedEventType ?? "battlefield-note-created",
        groupId,
        outcome.quantity,
        [groupId],
        {
          zoneOrigin: group.zone,
          zoneDestination: destination,
          combatOutcome: outcome.kind,
        },
      ),
    );
    return { ...field, groups };
  }
  if (outcome.kind === "attacker-damage-marked") {
    const groups = field.groups.map((entry) =>
      entry.id === groupId
        ? withStackKey(
            recalculateStats({
              ...entry,
              statuses: { ...entry.statuses, damaged: true },
              pt: {
                ...entry.pt,
                damage: Math.max(0, entry.pt.damage + outcome.quantity),
              },
            }),
          )
        : entry,
    );
    changedGroupIds.add(groupId);
    details.push(
      step(
        "Combat damage marked",
        `${group.label} has ${outcome.quantity} combat damage marked.`,
        "damage-dealt",
      ),
    );
    events.push(
      createCombatResolutionEvent(
        "damage-dealt",
        groupId,
        outcome.quantity,
        [groupId],
        {
          combatDamage: true,
        },
      ),
    );
    return { ...field, groups };
  }
  if (
    outcome.kind === "attacker-tapped" ||
    outcome.kind === "attacker-untapped"
  ) {
    const tapped = outcome.kind === "attacker-tapped";
    const groups = field.groups.map((entry) =>
      entry.id === groupId
        ? withStackKey(
            recalculateStats({
              ...entry,
              statuses: { ...entry.statuses, tapped },
            }),
          )
        : entry,
    );
    changedGroupIds.add(groupId);
    details.push(
      step(
        tapped ? "Combat permanent tapped" : "Combat permanent untapped",
        `${group.label} ${tapped ? "tapped" : "untapped"}.`,
        tapped ? "permanent-tapped" : "permanent-untapped",
      ),
    );
    events.push(
      createCombatResolutionEvent(
        tapped ? "permanent-tapped" : "permanent-untapped",
        groupId,
        outcome.quantity,
        [groupId],
        { combatOutcome: outcome.kind },
      ),
    );
    return { ...field, groups };
  }
  details.push(
    step(
      outcome.kind === "attacker-survived"
        ? "Combat survival reported"
        : "Combat note recorded",
      outcome.note ?? `${group.label} combat result recorded.`,
      "battlefield-note-created",
    ),
  );
  events.push(
    createCombatResolutionEvent(
      "battlefield-note-created",
      groupId,
      outcome.quantity,
      [groupId],
      {
        combatOutcome: outcome.kind,
        note: outcome.note ?? "",
      },
    ),
  );
  return field;
}

function clearCombatStatuses(
  field: FieldState,
  details: ResolutionStep[],
  events: GameEvent[],
  changedGroupIds: Set<string>,
): FieldState {
  const affected = field.groups.filter(
    (group) => group.statuses.attacking || group.statuses.blocking,
  );
  if (!affected.length) return field;
  const affectedIds = affected.map((group) => group.id);
  const groups = field.groups.map((group) => {
    if (!affectedIds.includes(group.id)) return group;
    changedGroupIds.add(group.id);
    return withStackKey({
      ...group,
      statuses: { ...group.statuses, attacking: false, blocking: false },
    });
  });
  details.push(
    step(
      "Combat statuses cleared",
      `${affected.length} battlefield group(s) cleared from combat.`,
      "battlefield-note-created",
    ),
  );
  events.push(
    createCombatResolutionEvent(
      "battlefield-note-created",
      null,
      affected.length,
      affectedIds,
      { combatCleanup: true },
    ),
  );
  return { ...field, groups };
}

function createCombatResolutionIntent(
  session: EchoCombatResolutionSession,
  preview: EchoCombatResolutionPreview,
  timestamp: string,
): AmbientIntentInput {
  const entities: AmbientEntityReference[] = [];
  const seenGroupIds = new Set<string>();
  for (const outcome of preview.outcomes) {
    if (outcome.target?.groupId && !seenGroupIds.has(outcome.target.groupId)) {
      seenGroupIds.add(outcome.target.groupId);
      entities.push({
        kind: "group",
        id: outcome.target.groupId,
        role: "target",
      });
    }
  }
  if (
    preview.outcomes.some(
      (outcome) => outcome.kind === "commander-damage-to-you",
    )
  ) {
    entities.push({ kind: "player", owner: "you", role: "target" });
  }
  return {
    id: makeId("combat-resolution-intent"),
    kind: "custom",
    source: "combat-preview",
    actor: "you",
    createdAt: timestamp,
    entities,
    payload: {
      combatResolutionSessionId: session.id,
      combatResolutionPreviewId: preview.id,
      outcomeCount: preview.outcomes.length,
      summary: preview.summary.join(" "),
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
      originalTranscript: session.transcript.join(" "),
    },
    confidence: preview.confidence,
    requiredMode: null,
    requiresPreview: true,
    correlationId: session.id,
  };
}

function clarificationRequestsForOutcome(input: {
  field: FieldState;
  outcome: EchoCombatResolutionOutcome;
  timestamp: string;
  settings: EchoCombatResolutionSettings;
  candidateLabels: string[];
}): EchoCombatResolutionClarificationRequest[] {
  if (!input.outcome.clarificationRequired) return [];
  const intent = createCombatResolutionIntent(
    {
      version: ECHO_COMBAT_RESOLUTION_VERSION,
      id: "combat-resolution-clarification-session",
      fieldSessionId: input.field.session.id,
      status: "resolving",
      trigger: "system",
      ambientMode: input.field.ambient.currentMode,
      listeningWindowId: null,
      startedAt: input.timestamp,
      updatedAt: input.timestamp,
      completedAt: null,
      transcript: [input.outcome.originalTranscript],
      normalizedTranscript: [input.outcome.normalizedTranscript],
      outcomes: [input.outcome],
      preview: null,
      currentClarificationId: null,
      pipelineEventId: null,
      recoveryReason: null,
      accessibilityAnnouncement: "",
      directBattlefieldMutation: false,
    },
    {
      version: ECHO_COMBAT_RESOLUTION_VERSION,
      id: "combat-resolution-clarification-preview",
      sessionId: "combat-resolution-clarification-session",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      outcomes: [input.outcome],
      summary: summarizeCombatResolutionPreview([input.outcome]),
      confirmedOutcomeCount: 0,
      pendingClarificationCount: 1,
      rejectedOutcomeCount: 0,
      lowConfidenceOutcomeCount: 1,
      clarificationRequests: [],
      confidence: input.outcome.confidence,
      calculatesDamage: false,
      predictsBlockers: false,
      predictsOutcomes: false,
      directBattlefieldMutation: false,
    },
    input.timestamp,
  );
  const decision = decideClarificationForIntent({
    field: input.field,
    intent,
    entityResults: input.outcome.target?.entityResult
      ? [input.outcome.target.entityResult]
      : [],
    transcript: input.outcome.originalTranscript,
    timestamp: input.timestamp,
    settings: normalizeClarificationSettings(
      input.field.settings.voice.clarification,
    ),
  });
  return [
    {
      id: makeId("echo-combat-resolution-clarification"),
      outcomeId: input.outcome.id,
      type: "target",
      question:
        decision.prompt?.question ??
        input.outcome.clarificationQuestion ??
        "Which combat object?",
      candidateLabels: decision.prompt?.candidateLabels.length
        ? decision.prompt.candidateLabels
        : (input.outcome.target?.entityResult?.candidates.map(
            (candidate) => candidate.label,
          ) ?? input.candidateLabels),
      frameworkDecision: decision,
      createdAt: input.timestamp,
    },
  ];
}

function resolveCombatResolutionTarget(
  field: FieldState,
  text: string,
  timestamp: string,
): EchoCombatResolutionEntity {
  const result = resolveEchoEntity({
    field,
    text,
    expectedKinds: TARGET_EXPECTED_KINDS,
    timestamp,
  });
  return {
    groupId: result.selected?.groupId ?? null,
    objectIds: result.selected?.objectIds ?? [],
    label: result.selected?.label ?? (text ? titleCase(text) : null),
    sourceText: text,
    owner: result.selected?.owner ?? null,
    entityResult: result,
  };
}

function resultForSession(
  field: FieldState,
  session: EchoCombatResolutionSession,
  preview: EchoCombatResolutionPreview | null,
  intent: AmbientIntentInput | null,
  resolutionResult: ResolutionResult | null,
): EchoCombatResolutionResult {
  return {
    state: upsertCombatResolutionSession(field.combatResolution, session),
    session,
    window: null,
    preview,
    intent,
    pipelineResult: null,
    event: null,
    resolutionResult,
  };
}

function upsertCombatResolutionSession(
  state: EchoCombatResolutionState,
  session: EchoCombatResolutionSession,
): EchoCombatResolutionState {
  const terminal = isTerminalSessionStatus(session.status);
  const sessions = [
    ...state.sessions.filter((entry) => entry.id !== session.id),
    session,
  ].slice(-MAX_COMBAT_RESOLUTION_SESSIONS);
  return createDefaultCombatResolutionState({
    ...state,
    activeSessionId: terminal ? null : session.id,
    sessions,
    lastPreviewId: session.preview?.id ?? state.lastPreviewId,
    lastCommittedSessionId:
      session.status === "committed"
        ? session.id
        : state.lastCommittedSessionId,
    lastCancelledSessionId:
      session.status === "cancelled"
        ? session.id
        : state.lastCancelledSessionId,
    diagnostics: createCombatResolutionDiagnostics({
      activeSessionId: terminal ? null : session.id,
      lastSessionId: session.id,
      lastStatus: session.status,
      lastPreviewId: session.preview?.id ?? state.lastPreviewId,
      lastPipelineEventId: session.pipelineEventId,
      lastError: session.recoveryReason,
      stagedOutcomeCount: session.outcomes.length,
      clarificationCount: session.preview?.clarificationRequests.length ?? 0,
      untrackedOpponentDamageCount: session.outcomes.filter(
        (outcome) => outcome.kind === "opponent-damage-reported",
      ).length,
    }),
  });
}

function activeCombatResolutionSession(
  state: EchoCombatResolutionState,
): EchoCombatResolutionSession | null {
  if (!state.activeSessionId) return null;
  return (
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    null
  );
}

function appendCombatResolutionTranscript(
  session: EchoCombatResolutionSession,
  transcript: string,
  timestamp: string,
): EchoCombatResolutionSession {
  return {
    ...session,
    updatedAt: timestamp,
    transcript: [...session.transcript, transcript].slice(-20),
    normalizedTranscript: [
      ...session.normalizedTranscript,
      normalizeResolutionText(transcript),
    ].slice(-20),
  };
}

function failCombatResolutionSession(
  session: EchoCombatResolutionSession,
  reason: string,
  timestamp: string,
): EchoCombatResolutionSession {
  return {
    ...session,
    status: "failed",
    updatedAt: timestamp,
    recoveryReason: reason,
    accessibilityAnnouncement: reason,
  };
}

function normalizeCombatResolutionSession(
  value: unknown,
  options: { timestamp?: string; knownGroupIds: Set<string> },
): EchoCombatResolutionSession | null {
  if (!value || typeof value !== "object") return null;
  const timestamp = options.timestamp ?? DEFAULT_CONFIDENCE_TIMESTAMP;
  const candidate = value as Partial<EchoCombatResolutionSession>;
  const outcomes = Array.isArray(candidate.outcomes)
    ? candidate.outcomes
        .map((outcome) =>
          normalizeCombatResolutionOutcome(outcome, {
            timestamp,
            knownGroupIds: options.knownGroupIds,
          }),
        )
        .filter(Boolean)
    : [];
  const status = normalizeSessionStatus(candidate.status);
  const session: EchoCombatResolutionSession = {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-combat-resolution"),
    fieldSessionId:
      typeof candidate.fieldSessionId === "string"
        ? candidate.fieldSessionId
        : null,
    status,
    trigger: normalizeTrigger(candidate.trigger),
    ambientMode: normalizeAmbientMode(candidate.ambientMode),
    listeningWindowId:
      typeof candidate.listeningWindowId === "string"
        ? candidate.listeningWindowId
        : null,
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    completedAt:
      typeof candidate.completedAt === "string" ? candidate.completedAt : null,
    transcript: Array.isArray(candidate.transcript)
      ? candidate.transcript.map(sanitizeText).filter(Boolean).slice(-20)
      : [],
    normalizedTranscript: Array.isArray(candidate.normalizedTranscript)
      ? candidate.normalizedTranscript
          .map(normalizeResolutionText)
          .filter(Boolean)
          .slice(-20)
      : [],
    outcomes,
    preview: null,
    currentClarificationId:
      typeof candidate.currentClarificationId === "string"
        ? candidate.currentClarificationId
        : null,
    pipelineEventId:
      typeof candidate.pipelineEventId === "string"
        ? candidate.pipelineEventId
        : null,
    recoveryReason:
      typeof candidate.recoveryReason === "string"
        ? sanitizeText(candidate.recoveryReason)
        : null,
    accessibilityAnnouncement:
      typeof candidate.accessibilityAnnouncement === "string"
        ? sanitizeText(candidate.accessibilityAnnouncement)
        : "",
    directBattlefieldMutation: false,
  };
  const preview = normalizeCombatResolutionPreview(candidate.preview, {
    timestamp,
    session,
    knownGroupIds: options.knownGroupIds,
  });
  return { ...session, preview };
}

function normalizeCombatResolutionPreview(
  value: unknown,
  options: {
    timestamp: string;
    session: EchoCombatResolutionSession;
    knownGroupIds: Set<string>;
  },
): EchoCombatResolutionPreview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatResolutionPreview>;
  const outcomes = Array.isArray(candidate.outcomes)
    ? candidate.outcomes.map((outcome) =>
        normalizeCombatResolutionOutcome(outcome, {
          timestamp: options.timestamp,
          knownGroupIds: options.knownGroupIds,
        }),
      )
    : options.session.outcomes;
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-combat-resolution-preview"),
    sessionId: options.session.id,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.timestamp,
    outcomes,
    summary: Array.isArray(candidate.summary)
      ? candidate.summary.map(sanitizeText).filter(Boolean)
      : summarizeCombatResolutionPreview(outcomes),
    confirmedOutcomeCount:
      typeof candidate.confirmedOutcomeCount === "number"
        ? Math.max(0, Math.trunc(candidate.confirmedOutcomeCount))
        : outcomes.filter((outcome) => !outcome.clarificationRequired).length,
    pendingClarificationCount:
      typeof candidate.pendingClarificationCount === "number"
        ? Math.max(0, Math.trunc(candidate.pendingClarificationCount))
        : outcomes.filter((outcome) => outcome.clarificationRequired).length,
    rejectedOutcomeCount:
      typeof candidate.rejectedOutcomeCount === "number"
        ? Math.max(0, Math.trunc(candidate.rejectedOutcomeCount))
        : outcomes.filter((outcome) => outcome.status === "rejected").length,
    lowConfidenceOutcomeCount:
      typeof candidate.lowConfidenceOutcomeCount === "number"
        ? Math.max(0, Math.trunc(candidate.lowConfidenceOutcomeCount))
        : outcomes.filter(
            (outcome) =>
              outcome.confidence.level === "low" ||
              outcome.confidence.level === "unknown",
          ).length,
    clarificationRequests: [],
    confidence: previewConfidence(outcomes, options.timestamp),
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    directBattlefieldMutation: false,
  };
}

function normalizeCombatResolutionOutcome(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string> },
): EchoCombatResolutionOutcome {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<EchoCombatResolutionOutcome>)
      : {};
  const target = normalizeEntity(candidate.target, options.knownGroupIds);
  const kind = normalizeOutcomeKind(candidate.kind);
  const requiresTarget = outcomeRequiresTarget(kind);
  const missingTarget = requiresTarget && !target?.groupId;
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-combat-outcome"),
    order:
      typeof candidate.order === "number" && Number.isFinite(candidate.order)
        ? Math.max(0, Math.trunc(candidate.order))
        : 0,
    kind,
    status: normalizeOutcomeStatus(
      missingTarget ? "pendingClarification" : candidate.status,
    ),
    originalTranscript: sanitizeText(candidate.originalTranscript),
    normalizedTranscript: normalizeResolutionText(
      candidate.normalizedTranscript,
    ),
    quantity:
      typeof candidate.quantity === "number" &&
      Number.isFinite(candidate.quantity)
        ? Math.max(0, Math.trunc(candidate.quantity))
        : 1,
    target,
    defenderLabel:
      typeof candidate.defenderLabel === "string"
        ? sanitizeText(candidate.defenderLabel)
        : null,
    generatedEventType: normalizeEventType(candidate.generatedEventType),
    note:
      typeof candidate.note === "string" ? sanitizeText(candidate.note) : null,
    confidence: normalizeAmbientConfidence(candidate.confidence, {
      source: "combat-preview",
      timestamp: options.timestamp,
      contextValid: !missingTarget,
      rulesValid: true,
      warningCount: missingTarget ? 1 : 0,
    }),
    clarificationRequired:
      missingTarget || Boolean(candidate.clarificationRequired),
    clarificationQuestion:
      missingTarget || candidate.clarificationRequired
        ? sanitizeText(candidate.clarificationQuestion) ||
          "Which combat object?"
        : null,
    directBattlefieldMutation: false,
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
  };
}

function normalizeEntity(
  value: unknown,
  knownGroupIds: Set<string>,
): EchoCombatResolutionEntity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoCombatResolutionEntity>;
  const groupId =
    typeof candidate.groupId === "string" &&
    knownGroupIds.has(candidate.groupId)
      ? candidate.groupId
      : null;
  return {
    groupId,
    objectIds: Array.isArray(candidate.objectIds)
      ? candidate.objectIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    label:
      typeof candidate.label === "string"
        ? sanitizeText(candidate.label)
        : null,
    sourceText:
      typeof candidate.sourceText === "string"
        ? sanitizeText(candidate.sourceText)
        : null,
    owner:
      candidate.owner === "you" || candidate.owner === "opponent"
        ? candidate.owner
        : null,
    entityResult: candidate.entityResult ?? null,
  };
}

function finalizeCombatResolutionResult(
  before: FieldState,
  after: FieldState,
  input: {
    summary: string[];
    details: ResolutionStep[];
    events: GameEvent[];
    changedGroupIds: Iterable<string>;
    timestamp: string;
  },
): ResolutionResult {
  return {
    field: normalizeField(after),
    title: "Combat Resolution",
    summary: input.summary.length
      ? input.summary
      : ["Combat resolution reported."],
    details: input.details,
    events: input.events,
    changedGroupIds: [...input.changedGroupIds],
    loopDetected: false,
    accessibilityAnnouncements: input.summary,
    rendering: {
      source: "lite-helper",
      authorityLabel: "Local Helper Engine",
      rulesVersion: null,
      validationStatus: "valid",
      animationMode: before.settings.reducedMotion
        ? "reduced-motion"
        : "animated",
      warnings: [],
      unsupportedInteractions: [],
      judgeNotes: [],
      replayMarkers: [
        {
          id: makeId("combat-resolution-replay"),
          timestamp: input.timestamp,
          label: "Combat resolution reported",
          description:
            "Player-reported combat outcomes were processed through Echo.",
        },
      ],
    },
  };
}

function createCombatResolutionEvent(
  type: GameEventType,
  sourceId: string | null,
  quantity: number,
  groupIds: string[],
  metadata: Record<string, string | number | boolean>,
): GameEvent {
  return {
    id: makeId("event"),
    type,
    sourceId,
    controller: "you",
    owner: "you",
    quantity,
    batchId: makeId("batch"),
    groupIds,
    combatDamage: Boolean(metadata.combatDamage),
    commanderDamage: Boolean(metadata.commanderDamage),
    metadata,
  };
}

function createCombatResolutionDiagnostics(
  input: Partial<EchoCombatResolutionDiagnostics> | null,
): EchoCombatResolutionDiagnostics {
  return {
    version: ECHO_COMBAT_RESOLUTION_VERSION,
    activeSessionId:
      typeof input?.activeSessionId === "string" ? input.activeSessionId : null,
    lastSessionId:
      typeof input?.lastSessionId === "string" ? input.lastSessionId : null,
    lastStatus: input?.lastStatus ?? null,
    lastPreviewId:
      typeof input?.lastPreviewId === "string" ? input.lastPreviewId : null,
    lastPipelineEventId:
      typeof input?.lastPipelineEventId === "string"
        ? input.lastPipelineEventId
        : null,
    lastError: typeof input?.lastError === "string" ? input.lastError : null,
    stagedOutcomeCount:
      typeof input?.stagedOutcomeCount === "number"
        ? Math.max(0, Math.trunc(input.stagedOutcomeCount))
        : 0,
    clarificationCount:
      typeof input?.clarificationCount === "number"
        ? Math.max(0, Math.trunc(input.clarificationCount))
        : 0,
    untrackedOpponentDamageCount:
      typeof input?.untrackedOpponentDamageCount === "number"
        ? Math.max(0, Math.trunc(input.untrackedOpponentDamageCount))
        : 0,
    calculatesDamage: false,
    predictsBlockers: false,
    predictsOutcomes: false,
    directBattlefieldMutation: false,
  };
}

function summarizeCombatResolutionPreview(
  outcomes: EchoCombatResolutionOutcome[],
): string[] {
  if (!outcomes.length) return ["No combat outcomes staged."];
  return outcomes
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(summarizeOutcome);
}

function summarizeOutcome(outcome: EchoCombatResolutionOutcome): string {
  const target = outcome.target?.label ?? "selected combat object";
  if (outcome.kind === "attacker-survived") return `${target} survived combat.`;
  if (outcome.kind === "attacker-died") return `${target} died in combat.`;
  if (outcome.kind === "attacker-exiled") return `${target} was exiled.`;
  if (outcome.kind === "attacker-returned-to-hand")
    return `${target} returned to hand.`;
  if (outcome.kind === "attacker-damage-marked")
    return `Mark ${outcome.quantity} combat damage on ${target}.`;
  if (outcome.kind === "attacker-tapped") return `Tap ${target}.`;
  if (outcome.kind === "attacker-untapped") return `Untap ${target}.`;
  if (outcome.kind === "commander-damage-to-you")
    return `Record ${outcome.quantity} commander damage to you.`;
  if (outcome.kind === "opponent-damage-reported")
    return `Record ${outcome.quantity} untracked combat damage to ${outcome.defenderLabel ?? "an opponent"}.`;
  if (outcome.kind === "combat-cleanup") return "Clear combat status markers.";
  return outcome.note ?? "Record combat note.";
}

function previewConfidence(
  outcomes: EchoCombatResolutionOutcome[],
  timestamp: string,
): AmbientConfidenceAssessment {
  if (!outcomes.length) return confidence("low", timestamp);
  if (outcomes.some((outcome) => outcome.clarificationRequired)) {
    return confidence("low", timestamp, [
      "One or more combat outcomes need clarification.",
    ]);
  }
  if (
    outcomes.some(
      (outcome) =>
        outcome.confidence.level === "low" ||
        outcome.confidence.level === "unknown",
    )
  ) {
    return confidence("medium", timestamp, [
      "Combat resolution contains low-confidence reported outcomes.",
    ]);
  }
  return confidence("high", timestamp, [
    "Combat resolution preview contains reported outcomes only.",
  ]);
}

function confidence(
  level: AmbientConfidenceLevel,
  timestamp: string,
  reasons?: string[],
): AmbientConfidenceAssessment {
  return normalizeAmbientConfidence(
    {
      level,
      reasons,
    },
    {
      source: "combat-preview",
      timestamp,
      contextValid: level !== "low" && level !== "unknown",
      rulesValid: true,
      warningCount: level === "low" || level === "unknown" ? 1 : 0,
    },
  );
}

function resolutionFragments(transcript: string): Array<{
  original: string;
  normalized: string;
}> {
  return transcript
    .replace(
      /\band\s+(?=(?:.+?\s+(?:dies|died|survives|survived|takes|took|is dead|is exiled|returned|returns|blocked)|(?:take|took|mark|record|tap|untap|exile|return|bounce|destroy|kill|clear|end|combat)))/gi,
      ". ",
    )
    .split(/[,.]+|\bthen\b/gi)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((original) => ({
      original,
      normalized: normalizeResolutionText(original),
    }))
    .filter((entry) => entry.normalized);
}

function normalizeResolutionText(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9+/ -]/g, " ")
        .replace(/\bmy\b/g, "")
        .replace(/\bthe\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function cleanTargetText(text: string): string {
  return normalizeResolutionText(text)
    .replace(/\b(?:attacker|creature|token|commander)\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractQuantity(text: string): number | null {
  const normalized = normalizeResolutionText(text);
  if (!normalized) return null;
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS.get(normalized) ?? null;
}

function isCompletionPhrase(text: string): boolean {
  return COMPLETION_PHRASES.has(text);
}

function outcomeRequiresTarget(kind: EchoCombatResolutionOutcomeKind): boolean {
  return (
    kind === "attacker-survived" ||
    kind === "attacker-died" ||
    kind === "attacker-exiled" ||
    kind === "attacker-returned-to-hand" ||
    kind === "attacker-damage-marked" ||
    kind === "attacker-tapped" ||
    kind === "attacker-untapped"
  );
}

function destinationForOutcome(
  kind: EchoCombatResolutionOutcomeKind,
): Extract<Zone, "graveyard" | "exile" | "hand"> {
  if (kind === "attacker-exiled") return "exile";
  if (kind === "attacker-returned-to-hand") return "hand";
  return "graveyard";
}

function movementDescription(kind: EchoCombatResolutionOutcomeKind): string {
  if (kind === "attacker-exiled") return "was exiled";
  if (kind === "attacker-returned-to-hand") return "returned to hand";
  return "died";
}

function step(
  label: string,
  detail: string,
  eventType?: GameEventType,
): ResolutionStep {
  return {
    id: makeId("step"),
    label,
    detail,
    eventType,
  };
}

function isTerminalSessionStatus(
  status: EchoCombatResolutionSessionStatus,
): boolean {
  return (
    status === "committed" ||
    status === "cancelled" ||
    status === "recovered" ||
    status === "failed"
  );
}

function normalizeSessionStatus(
  value: unknown,
): EchoCombatResolutionSessionStatus {
  return value === "resolving" ||
    value === "awaitingClarification" ||
    value === "previewReady" ||
    value === "committing" ||
    value === "committed" ||
    value === "cancelled" ||
    value === "recovered" ||
    value === "failed"
    ? value
    : "idle";
}

function normalizeOutcomeStatus(
  value: unknown,
): EchoCombatResolutionOutcomeStatus {
  return value === "pendingClarification" ||
    value === "previewReady" ||
    value === "committed" ||
    value === "skipped" ||
    value === "cancelled" ||
    value === "rejected" ||
    value === "recovered"
    ? value
    : "staged";
}

function normalizeOutcomeKind(value: unknown): EchoCombatResolutionOutcomeKind {
  return value === "attacker-survived" ||
    value === "attacker-died" ||
    value === "attacker-exiled" ||
    value === "attacker-returned-to-hand" ||
    value === "attacker-damage-marked" ||
    value === "attacker-tapped" ||
    value === "attacker-untapped" ||
    value === "combat-damage-to-player" ||
    value === "commander-damage-to-you" ||
    value === "opponent-damage-reported" ||
    value === "combat-cleanup"
    ? value
    : "combat-note";
}

function normalizeTrigger(value: unknown): EchoCombatResolutionTrigger {
  return value === "manual-resolution" ||
    value === "action-strip" ||
    value === "voice-resolution" ||
    value === "recovery"
    ? value
    : "system";
}

function normalizeAmbientMode(value: unknown): AmbientGameplayMode {
  return value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
    ? value
    : "passive";
}

function normalizeEventType(value: unknown): GameEventType | null {
  return value === "permanent-entered" ||
    value === "creature-entered" ||
    value === "token-created" ||
    value === "counter-placed" ||
    value === "counter-removed" ||
    value === "life-gained" ||
    value === "life-lost" ||
    value === "damage-dealt" ||
    value === "land-entered" ||
    value === "spell-cast" ||
    value === "permanent-died" ||
    value === "permanent-sacrificed" ||
    value === "permanent-exiled" ||
    value === "permanent-returned-to-hand" ||
    value === "permanent-returned-to-battlefield" ||
    value === "permanent-transformed" ||
    value === "permanent-tapped" ||
    value === "permanent-untapped" ||
    value === "trigger-announced" ||
    value === "reminder-created" ||
    value === "battlefield-note-created"
    ? value
    : null;
}

function sanitizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240)
    : "";
}
