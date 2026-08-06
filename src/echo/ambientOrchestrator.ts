import { makeId } from "../domain/cards";
import type { FieldState } from "../domain/types";
import {
  createAmbientIntent,
  createAmbientPreview,
  resolveAmbientEntities,
} from "./ambientEventPipeline";
import type {
  AmbientIntent,
  AmbientIntentInput,
  AmbientPipelineResult,
} from "./ambientEventTypes";
import type {
  AmbientGameplayMode,
  AmbientObservedController,
  AmbientObservedPhase,
} from "./ambientTypes";
import { decideClarificationForIntent } from "./clarification";
import {
  getActiveListeningWindow,
  recognizeMagicCommandInWindow,
} from "./contextualListening";
import {
  createBattlefieldContext,
  resolveEchoEntity,
} from "./entityResolution";
import { magicCommandResultToAmbientIntent } from "./magicCommandGrammar";
import { preparePredictiveIntentAssistance } from "./personalGameplay";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import type {
  EchoEntityKind,
  EchoEntityResolutionRequest,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";
import type {
  EchoMagicCommandGrammarResult,
  EchoMagicCommandObject,
  EchoMagicCommandObjectKind,
} from "./magicCommandGrammarTypes";
import type { EchoPredictiveWorkflowTarget } from "./personalGameplayTypes";
import {
  ECHO_AMBIENT_ORCHESTRATOR_VERSION,
  type EchoAmbientOrchestrationRequest,
  type EchoAmbientOrchestrationResult,
  type EchoAmbientOrchestratorEvent,
  type EchoAmbientOrchestratorEventKind,
  type EchoAmbientOrchestratorResource,
  type EchoAmbientOrchestratorSession,
  type EchoAmbientOrchestratorSessionStatus,
  type EchoAmbientOrchestratorSettings,
  type EchoAmbientOrchestratorSource,
  type EchoAmbientOrchestratorStageName,
  type EchoAmbientOrchestratorStageRecord,
  type EchoAmbientOrchestratorStageStatus,
  type EchoAmbientOrchestratorState,
  type EchoAmbientOrchestratorSubsystem,
  type EchoAmbientOrchestratorWorkflow,
  type EchoAmbientResourceOwnership,
  type EchoAmbientSharedContext,
  type EchoAmbientSystemHealth,
} from "./ambientOrchestratorTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const ACTIVE_SESSION_STATUSES: EchoAmbientOrchestratorSessionStatus[] = [
  "listening",
  "clarifying",
  "previewing",
  "awaitingConfirmation",
  "publishing",
  "recovering",
  "paused",
];

const RESOURCE_NAMES: EchoAmbientOrchestratorResource[] = [
  "voice-session",
  "microphone",
  "listening-window",
  "clarification",
  "gameplay-staging",
  "combat-declaration",
  "combat-resolution",
  "confirmation",
  "pipeline",
  "ui-focus",
];

export function createDefaultAmbientOrchestratorSettings(
  input: Partial<EchoAmbientOrchestratorSettings> = {},
): EchoAmbientOrchestratorSettings {
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    enabled: input.enabled ?? true,
    ambientGameplayEnabled: input.ambientGameplayEnabled ?? true,
    workflowRecoveryEnabled: input.workflowRecoveryEnabled ?? true,
    sessionRestorationEnabled: input.sessionRestorationEnabled ?? true,
    smartCoordinationEnabled: input.smartCoordinationEnabled ?? true,
    maxRecentSessions: clampInteger(input.maxRecentSessions, 1, 50, 12),
    maxRecentMutations: clampInteger(input.maxRecentMutations, 0, 100, 24),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: Boolean(input.developerDiagnosticsEnabled),
    localOnly: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    aiStrategyRecommendations: false,
    rulesAuthorityTransferred: false,
    lastResetAt:
      typeof input.lastResetAt === "string" ? input.lastResetAt : null,
  };
}

export function normalizeAmbientOrchestratorSettings(
  value: unknown,
): EchoAmbientOrchestratorSettings {
  const defaults = createDefaultAmbientOrchestratorSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoAmbientOrchestratorSettings>;
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    ambientGameplayEnabled:
      candidate.ambientGameplayEnabled === undefined
        ? defaults.ambientGameplayEnabled
        : Boolean(candidate.ambientGameplayEnabled),
    workflowRecoveryEnabled:
      candidate.workflowRecoveryEnabled === undefined
        ? defaults.workflowRecoveryEnabled
        : Boolean(candidate.workflowRecoveryEnabled),
    sessionRestorationEnabled:
      candidate.sessionRestorationEnabled === undefined
        ? defaults.sessionRestorationEnabled
        : Boolean(candidate.sessionRestorationEnabled),
    smartCoordinationEnabled:
      candidate.smartCoordinationEnabled === undefined
        ? defaults.smartCoordinationEnabled
        : Boolean(candidate.smartCoordinationEnabled),
    maxRecentSessions: clampInteger(
      candidate.maxRecentSessions,
      1,
      50,
      defaults.maxRecentSessions,
    ),
    maxRecentMutations: clampInteger(
      candidate.maxRecentMutations,
      0,
      100,
      defaults.maxRecentMutations,
    ),
    developerDiagnosticsEnabled: Boolean(candidate.developerDiagnosticsEnabled),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    localOnly: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    aiStrategyRecommendations: false,
    rulesAuthorityTransferred: false,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultAmbientOrchestratorState(
  input: Partial<EchoAmbientOrchestratorState> = {},
): EchoAmbientOrchestratorState {
  const timestamp = input.health?.checkedAt ?? new Date().toISOString();
  const resourceOwners = normalizeResourceOwners(input.resourceOwners);
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const activeSessionId =
    typeof input.activeSessionId === "string" ? input.activeSessionId : null;
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    activeSessionId,
    sessions,
    sharedContext: input.sharedContext ?? null,
    resourceOwners,
    recentMutationIds: Array.isArray(input.recentMutationIds)
      ? input.recentMutationIds.filter(isString).slice(0, 24)
      : [],
    recentVoiceSessionIds: Array.isArray(input.recentVoiceSessionIds)
      ? input.recentVoiceSessionIds.filter(isString).slice(0, 24)
      : [],
    health: createSystemHealth({
      ...(input.health ?? {}),
      checkedAt: timestamp,
      activeSessionCount: activeSession ? 1 : 0,
      resourceOwnershipValid:
        input.health?.resourceOwnershipValid ??
        resourceOwners.every((entry) => entry.status !== "conflict"),
    }),
    diagnostics: createDiagnostics({
      ...(input.diagnostics ?? {}),
      status: activeSession?.status ?? input.diagnostics?.status ?? "idle",
      activeSessionId,
      lastSessionId:
        input.diagnostics?.lastSessionId ?? sessions[0]?.id ?? activeSessionId,
      activeSubsystemCount:
        input.diagnostics?.activeSubsystemCount ??
        countActiveSubsystems(input.sharedContext ?? null),
      resourceConflictCount:
        input.diagnostics?.resourceConflictCount ??
        resourceOwners.filter((entry) => entry.status === "conflict").length,
    }),
  };
}

export function normalizeAmbientOrchestratorState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoAmbientOrchestratorSettings;
    field?: FieldState;
    allowActiveSession?: boolean;
  } = {},
): EchoAmbientOrchestratorState {
  const timestamp = options.fallbackTimestamp ?? DEFAULT_TIMESTAMP;
  const settings = normalizeAmbientOrchestratorSettings(options.settings);
  if (!value || typeof value !== "object") {
    const base = createDefaultAmbientOrchestratorState();
    return options.field
      ? refreshAmbientOrchestratorContext(base, options.field, {
          timestamp,
          settings,
        })
      : base;
  }
  const candidate = value as Partial<EchoAmbientOrchestratorState>;
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((entry) =>
          normalizeOrchestratorSession(entry, timestamp, {
            allowActiveSession:
              options.allowActiveSession !== false &&
              settings.sessionRestorationEnabled,
          }),
        )
        .filter((entry): entry is EchoAmbientOrchestratorSession =>
          Boolean(entry),
        )
        .slice(0, settings.maxRecentSessions)
    : [];
  const activeSessionId = resolveActiveSessionId(
    typeof candidate.activeSessionId === "string"
      ? candidate.activeSessionId
      : null,
    sessions,
  );
  const resourceOwners = normalizeResourceOwners(
    candidate.resourceOwners,
    activeSessionId,
    timestamp,
  );
  const recentMutationIds = Array.isArray(candidate.recentMutationIds)
    ? candidate.recentMutationIds
        .filter(isString)
        .slice(0, settings.maxRecentMutations)
    : [];
  const recentVoiceSessionIds = Array.isArray(candidate.recentVoiceSessionIds)
    ? candidate.recentVoiceSessionIds
        .filter(isString)
        .slice(0, settings.maxRecentSessions)
    : [];
  const base = createDefaultAmbientOrchestratorState({
    activeSessionId,
    sessions,
    resourceOwners,
    recentMutationIds,
    recentVoiceSessionIds,
    sharedContext: normalizeSharedContext(candidate.sharedContext, timestamp),
    health: createSystemHealth({
      ...(candidate.health && typeof candidate.health === "object"
        ? candidate.health
        : {}),
      checkedAt: timestamp,
    }),
    diagnostics: createDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeSessionId,
      lastSessionId: sessions[0]?.id ?? null,
      resourceConflictCount: resourceOwners.filter(
        (entry) => entry.status === "conflict",
      ).length,
      recentMutationCount: recentMutationIds.length,
    }),
  });
  return options.field
    ? refreshAmbientOrchestratorContext(base, options.field, {
        timestamp,
        settings,
      })
    : base;
}

export function createAmbientOrchestratorSharedContext(
  field: FieldState,
  state: EchoAmbientOrchestratorState = createDefaultAmbientOrchestratorState(),
  options: { timestamp?: string } = {},
): EchoAmbientSharedContext {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const activeWindow = getActiveListeningWindow(field.contextualListening);
  const plannerStep = field.preTurnPlanner.actions.find(
    (action) => action.status === "planned",
  );
  const actionStripStep = field.activeTurnActionStrip.items.find(
    (item) => item.status === "current" || item.status === "pending",
  );
  const activeCombatSession = field.combatDeclaration.sessions.find(
    (session) => session.id === field.combatDeclaration.activeSessionId,
  );
  const activeCombatResolutionSession = field.combatResolution.sessions.find(
    (session) => session.id === field.combatResolution.activeSessionId,
  );
  const activeGameplaySession = field.voiceBattlefieldActions.sessions.find(
    (session) => session.id === field.voiceBattlefieldActions.activeSessionId,
  );
  const pendingClarification = field.clarification.pendingPrompt
    ? field.clarification.activeSessionId
    : null;
  const pendingPreviewIds = uniqueStrings([
    ...state.sessions.flatMap((session) => session.pendingPreviewIds),
    ...(activeCombatSession?.preview ? [activeCombatSession.preview.id] : []),
    ...(activeCombatResolutionSession?.preview
      ? [activeCombatResolutionSession.preview.id]
      : []),
    ...(activeGameplaySession?.preview
      ? [activeGameplaySession.preview.id]
      : []),
  ]).slice(0, 12);
  const recentVoiceSessionIds = uniqueStrings([
    ...state.recentVoiceSessionIds,
    ...(field.adaptiveListeningTail.lastFinalizedSessionId
      ? [field.adaptiveListeningTail.lastFinalizedSessionId]
      : []),
    ...(field.adaptiveListeningTail.activeSessionId
      ? [field.adaptiveListeningTail.activeSessionId]
      : []),
  ]).slice(0, 12);
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    createdAt: timestamp,
    fieldId: field.id,
    sessionId: field.session.id,
    currentPhase: field.ambient.context.observedTurn?.phase ?? null,
    currentTurn: field.ambient.context.observedTurn?.activeController ?? null,
    currentPlayer:
      field.ambient.context.observedTurn?.activeController ?? "unknown",
    currentListeningWindowId: activeWindow?.id ?? null,
    currentListeningWindowKind: activeWindow?.kind ?? null,
    currentAmbientMode: field.ambient.currentMode,
    currentPlannerStepId: plannerStep?.id ?? null,
    currentActionStripItemId: actionStripStep?.id ?? null,
    currentCombatSessionId: activeCombatSession?.id ?? null,
    currentCombatResolutionSessionId: activeCombatResolutionSession?.id ?? null,
    currentGameplaySessionId: activeGameplaySession?.id ?? null,
    pendingClarificationId: pendingClarification,
    pendingPreviewIds,
    pendingConfirmationIds: state.sessions.flatMap(
      (session) => session.pendingConfirmationIds,
    ),
    recentMutationIds: state.recentMutationIds.slice(0, 24),
    recentVoiceSessionIds,
    battlefieldContext: createBattlefieldContext(field, { timestamp }),
    localOnly: true,
    directBattlefieldMutation: false,
  };
}

export function refreshAmbientOrchestratorContext(
  state: EchoAmbientOrchestratorState,
  field: FieldState,
  options: {
    timestamp?: string;
    settings?: EchoAmbientOrchestratorSettings;
  } = {},
): EchoAmbientOrchestratorState {
  const settings = normalizeAmbientOrchestratorSettings(options.settings);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = createDefaultAmbientOrchestratorState(state);
  const sharedContext = createAmbientOrchestratorSharedContext(
    field,
    normalized,
    { timestamp },
  );
  const health = evaluateAmbientOrchestratorHealth({
    ...normalized,
    sharedContext,
  });
  return createDefaultAmbientOrchestratorState({
    ...normalized,
    sessions: normalized.sessions.slice(0, settings.maxRecentSessions),
    recentMutationIds: normalized.recentMutationIds.slice(
      0,
      settings.maxRecentMutations,
    ),
    sharedContext,
    health,
    diagnostics: createDiagnostics({
      ...normalized.diagnostics,
      status: normalized.activeSessionId
        ? getSessionStatus(normalized.sessions, normalized.activeSessionId)
        : "idle",
      activeSessionId: normalized.activeSessionId,
      activeSubsystemCount: health.activeSubsystems.length,
      resourceConflictCount: normalized.resourceOwners.filter(
        (entry) => entry.status === "conflict",
      ).length,
      recentMutationCount: normalized.recentMutationIds.length,
    }),
  });
}

export function coordinateAmbientOrchestratorEvent(
  state: EchoAmbientOrchestratorState,
  field: FieldState,
  event: EchoAmbientOrchestratorEvent,
  options: {
    settings?: EchoAmbientOrchestratorSettings;
  } = {},
): EchoAmbientOrchestratorState {
  const settings = normalizeAmbientOrchestratorSettings(options.settings);
  const timestamp = event.timestamp ?? new Date().toISOString();
  const normalized = normalizeAmbientOrchestratorState(state, {
    field,
    settings,
    fallbackTimestamp: timestamp,
    allowActiveSession: true,
  });
  if (!settings.enabled) {
    return withDiagnostics(normalized, {
      status: "paused",
      lastEventKind: event.kind,
      lastError: "Ambient Gameplay Orchestrator is disabled.",
    });
  }
  const session = sessionForEvent(normalized, field, event, timestamp);
  const nextSession = applyOrchestratorEventToSession(
    session,
    event,
    timestamp,
  );
  const sessions = [
    nextSession,
    ...normalized.sessions.filter((entry) => entry.id !== nextSession.id),
  ].slice(0, settings.maxRecentSessions);
  const activeSessionId = ACTIVE_SESSION_STATUSES.includes(nextSession.status)
    ? nextSession.id
    : null;
  const recentMutationIds = uniqueStrings([
    ...(event.pipelineEventId ? [event.pipelineEventId] : []),
    ...normalized.recentMutationIds,
  ]).slice(0, settings.maxRecentMutations);
  const recentVoiceSessionIds = uniqueStrings([
    ...(nextSession.source === "voice" ? [nextSession.id] : []),
    ...normalized.recentVoiceSessionIds,
  ]).slice(0, settings.maxRecentSessions);
  const resourceOwners = reconcileResourceOwners({
    sessions,
    activeSessionId,
    timestamp,
  });
  const next = createDefaultAmbientOrchestratorState({
    ...normalized,
    activeSessionId,
    sessions,
    resourceOwners,
    recentMutationIds,
    recentVoiceSessionIds,
    diagnostics: createDiagnostics({
      ...normalized.diagnostics,
      status: nextSession.status,
      activeSessionId,
      lastSessionId: nextSession.id,
      lastWorkflow: nextSession.workflow,
      lastEventKind: event.kind,
      lastPipelineEventId:
        event.pipelineEventId ?? normalized.diagnostics.lastPipelineEventId,
      lastError: nextSession.recoveryReason,
      recentMutationCount: recentMutationIds.length,
      resourceConflictCount: resourceOwners.filter(
        (entry) => entry.status === "conflict",
      ).length,
    }),
  });
  return refreshAmbientOrchestratorContext(next, field, {
    timestamp,
    settings,
  });
}

export function orchestrateAmbientTranscript(
  request: EchoAmbientOrchestrationRequest,
): EchoAmbientOrchestrationResult {
  const settings = normalizeAmbientOrchestratorSettings(request.settings);
  const timestamp = request.timestamp ?? new Date().toISOString();
  const startingState = normalizeAmbientOrchestratorState(
    request.field.ambientOrchestrator,
    {
      field: request.field,
      settings,
      fallbackTimestamp: timestamp,
      allowActiveSession: true,
    },
  );
  const transcript = sanitizeText(request.transcript ?? "");
  const stageRecords: EchoAmbientOrchestratorStageRecord[] = [];
  const pushStage = (
    stage: EchoAmbientOrchestratorStageName,
    status: EchoAmbientOrchestratorStageStatus,
    message: string,
  ) => stageRecords.push({ stage, status, message, timestamp });

  if (!settings.enabled || !settings.ambientGameplayEnabled) {
    pushStage("session-created", "blocked", "Orchestrator is disabled.");
    const sharedContext = createAmbientOrchestratorSharedContext(
      request.field,
      startingState,
      { timestamp },
    );
    return createOrchestrationResult({
      state: withDiagnostics(startingState, {
        status: "paused",
        lastError: "Ambient Gameplay Orchestrator is disabled.",
      }),
      session: null,
      status: "paused",
      workflow: null,
      sharedContext,
      speakerVerification: request.speakerVerification ?? null,
      stageRecords,
      accessibilityAnnouncement: "Ambient Gameplay Orchestrator is paused.",
    });
  }

  const activeWindow = getActiveListeningWindow(
    request.field.contextualListening,
  );
  const grammar = transcript
    ? recognizeMagicCommandInWindow({
        transcript,
        field: request.field,
        speakerVerification: request.speakerVerification ?? null,
        window: activeWindow,
        settings: request.field.settings.voice.grammar,
        timestamp,
      })
    : null;
  const intentInput =
    request.intent ??
    (grammar ? magicCommandResultToAmbientIntent(grammar.grammar) : null);
  const intent = intentInput
    ? createAmbientIntent(intentInput, timestamp)
    : null;
  const workflow = workflowForIntentOrTranscript(intent, transcript);
  const session = createOrchestratorSession({
    field: request.field,
    timestamp,
    workflow,
    source: transcript ? "voice" : "system",
    transcript,
  });
  pushStage("session-created", "passed", "Orchestration session created.");
  if (request.speakerVerification) {
    pushStage(
      "verified-speaker",
      request.speakerVerification.verified ? "passed" : "blocked",
      request.speakerVerification.verified
        ? "Speaker verification accepted."
        : "Speaker verification rejected or uncertain.",
    );
  } else {
    pushStage(
      "verified-speaker",
      "skipped",
      "No speaker verification result was provided.",
    );
  }
  if (grammar) {
    pushStage(
      "grammar",
      grammar.accepted ? "passed" : "blocked",
      grammar.grammar.accessibilityAnnouncement,
    );
  } else {
    pushStage("grammar", "skipped", "No transcript was provided.");
  }
  pushStage("context", "passed", "Shared gameplay context refreshed.");

  const entityResults = intent
    ? resolveOrchestratedEntities(
        request.field,
        intent,
        grammar?.grammar ?? null,
        timestamp,
      )
    : [];
  if (intent) {
    pushStage(
      "entity-resolution",
      entityResults.every((entry) => entry.status === "resolved")
        ? "passed"
        : entityResults.some((entry) => entry.status === "ambiguous")
          ? "blocked"
          : "skipped",
      entityResults.length
        ? "Entity resolution completed through shared battlefield context."
        : "No extra entity resolution was required.",
    );
  } else {
    pushStage("entity-resolution", "skipped", "No intent reached resolution.");
  }
  const confidence = grammar?.confidence ?? intent?.confidence ?? null;
  pushStage(
    "confidence",
    confidence && confidence.level !== "unknown" ? "passed" : "skipped",
    confidence
      ? `Confidence assessed as ${confidence.level}.`
      : "No confidence assessment was available.",
  );
  const clarification =
    intent && confidence
      ? decideClarificationForIntent({
          field: request.field,
          intent,
          transcript: transcript || null,
          entityResults,
          confidence,
          pipelineStage: "entity-resolution",
          settings: request.field.settings.voice.clarification,
          timestamp,
        })
      : null;
  if (clarification) {
    pushStage(
      "clarification",
      clarification.action === "accepted" ? "passed" : "blocked",
      clarification.reason,
    );
  } else {
    pushStage("clarification", "skipped", "Clarification was not required.");
  }
  const resolvedEntities = intent
    ? resolveAmbientEntities(request.field, intent)
    : [];
  const ambientPreview =
    intent && (!clarification || clarification.action !== "clarified")
      ? createAmbientPreview({
          field: request.field,
          intent,
          resolvedEntities,
          timestamp,
        })
      : null;
  if (ambientPreview) {
    pushStage(
      "gameplay-preview",
      "passed",
      "Gameplay preview prepared without mutating the battlefield.",
    );
  } else {
    pushStage("gameplay-preview", "skipped", "No preview was created.");
  }
  const needsConfirmation =
    clarification?.action === "confirmation-required" ||
    Boolean(ambientPreview?.requiresApproval);
  pushStage(
    "confirmation",
    needsConfirmation ? "blocked" : "skipped",
    needsConfirmation
      ? "User confirmation is required before publishing."
      : "No confirmation was needed.",
  );
  pushStage(
    "pipeline",
    "skipped",
    "No battlefield mutation was published by orchestration.",
  );
  pushStage(
    "undo-availability",
    "skipped",
    "Undo remains available only after Canonical Ambient Event Pipeline commit.",
  );
  const predictivePreparation = settings.smartCoordinationEnabled
    ? preparePredictiveIntentAssistance(request.field, {
        signal: transcript
          ? {
              kind: "voice-phrase",
              source: "voice-framework",
              outcome: "completed",
              label: transcript,
              context: {
                ambientMode: request.field.ambient.currentMode,
                listeningWindow: activeWindow?.kind ?? null,
                workflow: workflowToPersonalGameplayWorkflow(workflow),
                sessionId: request.field.session.id,
              },
              timestamp,
            }
          : undefined,
        settings: request.field.settings.personalGameplay,
        timestamp,
      })
    : null;
  pushStage(
    "smart-suggestions",
    predictivePreparation?.status === "prepared" ? "passed" : "skipped",
    predictivePreparation?.reason ?? "Smart coordination was not needed.",
  );
  const status = deriveResultStatus({
    grammar: grammar?.status ?? null,
    clarification,
    ambientPreview,
  });
  pushStage(
    "session-completion",
    status === "completed" ? "passed" : "pending",
    status === "completed"
      ? "Orchestration completed without publishing gameplay."
      : "Orchestration is waiting for the next safe user action.",
  );
  const completedSession: EchoAmbientOrchestratorSession = {
    ...session,
    status,
    updatedAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    clarificationSessionId: clarification?.session?.id ?? null,
    pendingPreviewIds: ambientPreview ? [ambientPreview.id] : [],
    pendingConfirmationIds: needsConfirmation
      ? [clarification?.session?.id ?? ambientPreview?.id ?? session.id]
      : [],
    intentIds: intent ? [intent.id] : [],
    stages: stageRecords,
  };
  const resourceOwners = reconcileResourceOwners({
    sessions: [completedSession, ...startingState.sessions],
    activeSessionId: ACTIVE_SESSION_STATUSES.includes(status)
      ? completedSession.id
      : null,
    timestamp,
  });
  const nextState = refreshAmbientOrchestratorContext(
    createDefaultAmbientOrchestratorState({
      ...startingState,
      activeSessionId: ACTIVE_SESSION_STATUSES.includes(status)
        ? completedSession.id
        : null,
      sessions: [completedSession, ...startingState.sessions].slice(
        0,
        settings.maxRecentSessions,
      ),
      resourceOwners,
      recentVoiceSessionIds: uniqueStrings([
        completedSession.id,
        ...startingState.recentVoiceSessionIds,
      ]).slice(0, settings.maxRecentSessions),
      diagnostics: createDiagnostics({
        ...startingState.diagnostics,
        status,
        activeSessionId: ACTIVE_SESSION_STATUSES.includes(status)
          ? completedSession.id
          : null,
        lastSessionId: completedSession.id,
        lastWorkflow: completedSession.workflow,
        lastEventKind: "transcript-received",
        activeSubsystemCount: countActiveSubsystems(
          startingState.sharedContext,
        ),
        resourceConflictCount: resourceOwners.filter(
          (entry) => entry.status === "conflict",
        ).length,
      }),
    }),
    request.field,
    { timestamp, settings },
  );
  return createOrchestrationResult({
    state: nextState,
    session: completedSession,
    status,
    workflow,
    sharedContext:
      nextState.sharedContext ??
      createAmbientOrchestratorSharedContext(request.field, nextState, {
        timestamp,
      }),
    speakerVerification: request.speakerVerification ?? null,
    grammar: grammar?.grammar ?? null,
    entityResults,
    confidence,
    clarification,
    ambientPreview,
    predictivePreparation,
    stageRecords,
    accessibilityAnnouncement: announcementForStatus(status, workflow),
  });
}

export function recordAmbientPipelineCompletion(
  state: EchoAmbientOrchestratorState,
  field: FieldState,
  input: {
    result: AmbientPipelineResult;
    timestamp?: string;
    settings?: EchoAmbientOrchestratorSettings;
  },
): EchoAmbientOrchestratorState {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const pipelineEventId =
    input.result.status === "completed" ? input.result.event.id : null;
  return coordinateAmbientOrchestratorEvent(
    state,
    field,
    {
      kind:
        input.result.status === "completed"
          ? "publish-completed"
          : "workflow-recovered",
      pipelineEventId,
      recoveryReason:
        input.result.status === "completed"
          ? null
          : `Pipeline ended with ${input.result.status}.`,
      timestamp,
    },
    { settings: input.settings },
  );
}

export function resetAmbientOrchestratorState(
  options: { timestamp?: string } = {},
): EchoAmbientOrchestratorState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return createDefaultAmbientOrchestratorState({
    health: createSystemHealth({
      checkedAt: timestamp,
      lastIssue: null,
    }),
    diagnostics: createDiagnostics({
      status: "idle",
      lastEventKind: "context-refreshed",
      lastError: null,
    }),
  });
}

export function evaluateAmbientOrchestratorHealth(
  state: EchoAmbientOrchestratorState,
  options: { timestamp?: string } = {},
): EchoAmbientSystemHealth {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const activeSessions = state.sessions.filter((session) =>
    ACTIVE_SESSION_STATUSES.includes(session.status),
  );
  const activeSessionIds = new Set(activeSessions.map((session) => session.id));
  const conflicts = state.resourceOwners.filter(
    (entry) =>
      entry.status === "conflict" ||
      (entry.ownerSessionId && !activeSessionIds.has(entry.ownerSessionId)),
  );
  const activeSubsystems = activeSubsystemsForState(state);
  const sessionConsistent =
    activeSessions.length <= 1 &&
    (!state.activeSessionId || activeSessionIds.has(state.activeSessionId));
  const resourceOwnershipValid = conflicts.length === 0;
  const pipelineConsistent = state.sessions.every(
    (session) =>
      session.status !== "publishing" || session.pipelineEventIds.length > 0,
  );
  const lifecycleValid = state.sessions.every((session) =>
    isValidLifecycleStatus(session.status),
  );
  return createSystemHealth({
    activeSubsystems,
    activeSessionCount: activeSessions.length,
    sessionConsistent,
    pipelineConsistent,
    resourceOwnershipValid,
    lifecycleValid,
    unexpectedFailureCount:
      state.health.unexpectedFailureCount +
      (sessionConsistent &&
      resourceOwnershipValid &&
      pipelineConsistent &&
      lifecycleValid
        ? 0
        : 1),
    lastIssue: !sessionConsistent
      ? "Multiple active orchestration sessions detected."
      : !resourceOwnershipValid
        ? "Resource ownership conflict detected."
        : !pipelineConsistent
          ? "Publishing session is missing pipeline metadata."
          : !lifecycleValid
            ? "Invalid orchestration lifecycle status detected."
            : null,
    checkedAt: timestamp,
  });
}

function createOrchestrationResult(
  input: Partial<EchoAmbientOrchestrationResult> & {
    state: EchoAmbientOrchestratorState;
    sharedContext: EchoAmbientSharedContext;
    status: EchoAmbientOrchestratorSessionStatus;
    stageRecords: EchoAmbientOrchestratorStageRecord[];
    accessibilityAnnouncement: string;
  },
): EchoAmbientOrchestrationResult {
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    state: input.state,
    session: input.session ?? null,
    status: input.status,
    workflow: input.workflow ?? null,
    sharedContext: input.sharedContext,
    speakerVerification: input.speakerVerification ?? null,
    grammar: input.grammar ?? null,
    entityResults: input.entityResults ?? [],
    confidence: input.confidence ?? null,
    clarification: input.clarification ?? null,
    ambientPreview: input.ambientPreview ?? null,
    combatPreview: input.combatPreview ?? null,
    combatResolutionPreview: input.combatResolutionPreview ?? null,
    gameplayPreview: input.gameplayPreview ?? null,
    predictivePreparation: input.predictivePreparation ?? null,
    pipelineResult: input.pipelineResult ?? null,
    event: input.event ?? null,
    stageRecords: input.stageRecords,
    accessibilityAnnouncement: input.accessibilityAnnouncement,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
    aiStrategyRecommendations: false,
  };
}

function createOrchestratorSession(input: {
  field: FieldState;
  timestamp: string;
  workflow: EchoAmbientOrchestratorWorkflow;
  source: EchoAmbientOrchestratorSource;
  transcript?: string | null;
}): EchoAmbientOrchestratorSession {
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    id: makeId("echo-orchestrator-session"),
    fieldSessionId: input.field.session.id,
    status: "listening",
    workflow: input.workflow,
    source: input.source,
    startedAt: input.timestamp,
    updatedAt: input.timestamp,
    completedAt: null,
    interruptedAt: null,
    recoveryReason: null,
    listeningSessionId: input.field.adaptiveListeningTail.activeSessionId,
    clarificationSessionId: input.field.clarification.activeSessionId,
    combatSessionId: input.field.combatDeclaration.activeSessionId,
    combatResolutionSessionId: input.field.combatResolution.activeSessionId,
    gameplaySessionId: input.field.voiceBattlefieldActions.activeSessionId,
    pendingPreviewIds: [],
    pendingConfirmationIds: [],
    intentIds: [],
    pipelineEventIds: [],
    transcripts: input.transcript ? [input.transcript] : [],
    stages: [],
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function normalizeOrchestratorSession(
  value: unknown,
  timestamp: string,
  options: { allowActiveSession: boolean },
): EchoAmbientOrchestratorSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAmbientOrchestratorSession>;
  const status = normalizeSessionStatus(candidate.status);
  const unsafeActive =
    !options.allowActiveSession && ACTIVE_SESSION_STATUSES.includes(status);
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-orchestrator-session"),
    fieldSessionId:
      typeof candidate.fieldSessionId === "string"
        ? candidate.fieldSessionId
        : null,
    status: unsafeActive ? "interrupted" : status,
    workflow: normalizeWorkflow(candidate.workflow),
    source: normalizeSource(candidate.source),
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    completedAt:
      typeof candidate.completedAt === "string" ? candidate.completedAt : null,
    interruptedAt: unsafeActive
      ? timestamp
      : typeof candidate.interruptedAt === "string"
        ? candidate.interruptedAt
        : null,
    recoveryReason: unsafeActive
      ? "Unsafe active orchestration session was restored as interrupted."
      : typeof candidate.recoveryReason === "string"
        ? sanitizeText(candidate.recoveryReason)
        : null,
    listeningSessionId:
      typeof candidate.listeningSessionId === "string"
        ? candidate.listeningSessionId
        : null,
    clarificationSessionId:
      typeof candidate.clarificationSessionId === "string"
        ? candidate.clarificationSessionId
        : null,
    combatSessionId:
      typeof candidate.combatSessionId === "string"
        ? candidate.combatSessionId
        : null,
    combatResolutionSessionId:
      typeof candidate.combatResolutionSessionId === "string"
        ? candidate.combatResolutionSessionId
        : null,
    gameplaySessionId:
      typeof candidate.gameplaySessionId === "string"
        ? candidate.gameplaySessionId
        : null,
    pendingPreviewIds: Array.isArray(candidate.pendingPreviewIds)
      ? candidate.pendingPreviewIds.filter(isString).slice(0, 20)
      : [],
    pendingConfirmationIds: Array.isArray(candidate.pendingConfirmationIds)
      ? candidate.pendingConfirmationIds.filter(isString).slice(0, 20)
      : [],
    intentIds: Array.isArray(candidate.intentIds)
      ? candidate.intentIds.filter(isString).slice(0, 50)
      : [],
    pipelineEventIds: Array.isArray(candidate.pipelineEventIds)
      ? candidate.pipelineEventIds.filter(isString).slice(0, 50)
      : [],
    transcripts: Array.isArray(candidate.transcripts)
      ? candidate.transcripts.map(sanitizeText).filter(Boolean).slice(0, 20)
      : [],
    stages: Array.isArray(candidate.stages)
      ? candidate.stages.map((entry) => normalizeStage(entry, timestamp))
      : [],
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function applyOrchestratorEventToSession(
  session: EchoAmbientOrchestratorSession,
  event: EchoAmbientOrchestratorEvent,
  timestamp: string,
): EchoAmbientOrchestratorSession {
  const status = statusForEvent(event.kind);
  return {
    ...session,
    status,
    updatedAt: timestamp,
    completedAt:
      status === "completed" ||
      status === "cancelled" ||
      status === "interrupted"
        ? timestamp
        : session.completedAt,
    interruptedAt: status === "interrupted" ? timestamp : session.interruptedAt,
    recoveryReason:
      event.recoveryReason ??
      (status === "recovering" || status === "interrupted"
        ? "Workflow recovery was requested."
        : session.recoveryReason),
    pendingPreviewIds: uniqueStrings([
      ...(event.previewId ? [event.previewId] : []),
      ...session.pendingPreviewIds,
    ]),
    pendingConfirmationIds: uniqueStrings([
      ...(event.confirmationId ? [event.confirmationId] : []),
      ...session.pendingConfirmationIds,
    ]),
    pipelineEventIds: uniqueStrings([
      ...(event.pipelineEventId ? [event.pipelineEventId] : []),
      ...session.pipelineEventIds,
    ]),
    intentIds: uniqueStrings([
      ...intentIdsFromEvent(event),
      ...session.intentIds,
    ]),
    transcripts: uniqueStrings([
      ...(event.transcript ? [sanitizeText(event.transcript)] : []),
      ...session.transcripts,
    ]),
    stages: [...session.stages, stageForEvent(event.kind, status, timestamp)],
  };
}

function sessionForEvent(
  state: EchoAmbientOrchestratorState,
  field: FieldState,
  event: EchoAmbientOrchestratorEvent,
  timestamp: string,
): EchoAmbientOrchestratorSession {
  const eventSessionId =
    typeof event.sessionId === "string"
      ? event.sessionId
      : state.activeSessionId;
  const existing = state.sessions.find(
    (session) => session.id === eventSessionId,
  );
  if (existing) return existing;
  return createOrchestratorSession({
    field,
    timestamp,
    workflow:
      event.workflow ??
      workflowForIntentOrTranscript(
        event.intent ?? null,
        event.transcript ?? "",
      ),
    source: event.source ?? "system",
    transcript: event.transcript,
  });
}

function resolveOrchestratedEntities(
  field: FieldState,
  intent: AmbientIntent,
  grammar: EchoMagicCommandGrammarResult | null,
  timestamp: string,
): EchoEntityResolutionResult[] {
  const objectTexts = uniqueObjects([
    grammar?.primaryObject,
    grammar?.secondaryObject,
    grammar?.targetObject,
  ]);
  return objectTexts
    .filter((object) => object.text.trim())
    .map((object) =>
      resolveEchoEntity({
        field,
        intent,
        text: object.text,
        role: roleForMagicObject(object),
        expectedKinds: expectedKindsForMagicObject(object.kind),
        settings: field.settings.voice.entityResolution,
        timestamp,
      }),
    );
}

function reconcileResourceOwners(input: {
  sessions: EchoAmbientOrchestratorSession[];
  activeSessionId: string | null;
  timestamp: string;
}): EchoAmbientResourceOwnership[] {
  const activeSessions = input.sessions.filter((session) =>
    ACTIVE_SESSION_STATUSES.includes(session.status),
  );
  const ownerSessionId = input.activeSessionId;
  const conflict = activeSessions.length > 1;
  return RESOURCE_NAMES.map((resource) => ({
    resource,
    ownerSessionId: ownerSessionId,
    acquiredAt: ownerSessionId ? input.timestamp : null,
    status: conflict ? "conflict" : ownerSessionId ? "owned" : "available",
    reason: conflict
      ? "Multiple active sessions attempted to own the same resource."
      : ownerSessionId
        ? "Resource owned by the active orchestration session."
        : "Resource available.",
  }));
}

function normalizeResourceOwners(
  value: unknown,
  activeSessionId: string | null = null,
  timestamp: string | null = null,
): EchoAmbientResourceOwnership[] {
  const byResource = new Map<
    EchoAmbientOrchestratorResource,
    EchoAmbientResourceOwnership
  >();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Partial<EchoAmbientResourceOwnership>;
      const resource = normalizeResource(candidate.resource);
      byResource.set(resource, {
        resource,
        ownerSessionId:
          typeof candidate.ownerSessionId === "string"
            ? candidate.ownerSessionId
            : null,
        acquiredAt:
          typeof candidate.acquiredAt === "string"
            ? candidate.acquiredAt
            : null,
        status:
          candidate.status === "owned" || candidate.status === "conflict"
            ? candidate.status
            : "available",
        reason: sanitizeText(candidate.reason ?? "Resource normalized."),
      });
    }
  }
  return RESOURCE_NAMES.map(
    (resource) =>
      byResource.get(resource) ?? {
        resource,
        ownerSessionId: activeSessionId,
        acquiredAt: activeSessionId ? timestamp : null,
        status: activeSessionId ? "owned" : "available",
        reason: activeSessionId
          ? "Resource restored for active orchestration session."
          : "Resource available.",
      },
  );
}

function createDiagnostics(
  input: Partial<EchoAmbientOrchestratorState["diagnostics"]>,
): EchoAmbientOrchestratorState["diagnostics"] {
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    status: input.status ?? "idle",
    activeSessionId: input.activeSessionId ?? null,
    lastSessionId: input.lastSessionId ?? null,
    lastWorkflow: input.lastWorkflow ?? null,
    lastEventKind: input.lastEventKind ?? null,
    lastPipelineEventId: input.lastPipelineEventId ?? null,
    lastError: input.lastError ?? null,
    activeSubsystemCount: input.activeSubsystemCount ?? 0,
    resourceConflictCount: input.resourceConflictCount ?? 0,
    recentMutationCount: input.recentMutationCount ?? 0,
    sessionRestorationPrepared: true,
    workflowRecoveryPrepared: true,
    localOnly: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    aiStrategyRecommendations: false,
    rulesAuthorityTransferred: false,
  };
}

function createSystemHealth(
  input: Partial<EchoAmbientSystemHealth>,
): EchoAmbientSystemHealth {
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    activeSubsystems: Array.isArray(input.activeSubsystems)
      ? input.activeSubsystems.filter(isSubsystem)
      : [],
    activeSessionCount: clampInteger(input.activeSessionCount, 0, 99, 0),
    sessionConsistent: input.sessionConsistent ?? true,
    pipelineConsistent: input.pipelineConsistent ?? true,
    resourceOwnershipValid: input.resourceOwnershipValid ?? true,
    lifecycleValid: input.lifecycleValid ?? true,
    unexpectedFailureCount: clampInteger(
      input.unexpectedFailureCount,
      0,
      99999,
      0,
    ),
    lastIssue: typeof input.lastIssue === "string" ? input.lastIssue : null,
    checkedAt:
      typeof input.checkedAt === "string" ? input.checkedAt : DEFAULT_TIMESTAMP,
    directBattlefieldMutation: false,
  };
}

function normalizeSharedContext(
  value: unknown,
  timestamp: string,
): EchoAmbientSharedContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAmbientSharedContext>;
  if (
    typeof candidate.fieldId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    !candidate.battlefieldContext
  ) {
    return null;
  }
  return {
    version: ECHO_AMBIENT_ORCHESTRATOR_VERSION,
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    fieldId: candidate.fieldId,
    sessionId: candidate.sessionId,
    currentPhase: normalizeObservedPhase(candidate.currentPhase),
    currentTurn: normalizeObservedController(candidate.currentTurn),
    currentPlayer: normalizeObservedController(candidate.currentPlayer),
    currentListeningWindowId:
      typeof candidate.currentListeningWindowId === "string"
        ? candidate.currentListeningWindowId
        : null,
    currentListeningWindowKind: normalizeListeningWindowKind(
      candidate.currentListeningWindowKind,
    ),
    currentAmbientMode: normalizeAmbientMode(candidate.currentAmbientMode),
    currentPlannerStepId:
      typeof candidate.currentPlannerStepId === "string"
        ? candidate.currentPlannerStepId
        : null,
    currentActionStripItemId:
      typeof candidate.currentActionStripItemId === "string"
        ? candidate.currentActionStripItemId
        : null,
    currentCombatSessionId:
      typeof candidate.currentCombatSessionId === "string"
        ? candidate.currentCombatSessionId
        : null,
    currentCombatResolutionSessionId:
      typeof candidate.currentCombatResolutionSessionId === "string"
        ? candidate.currentCombatResolutionSessionId
        : null,
    currentGameplaySessionId:
      typeof candidate.currentGameplaySessionId === "string"
        ? candidate.currentGameplaySessionId
        : null,
    pendingClarificationId:
      typeof candidate.pendingClarificationId === "string"
        ? candidate.pendingClarificationId
        : null,
    pendingPreviewIds: Array.isArray(candidate.pendingPreviewIds)
      ? candidate.pendingPreviewIds.filter(isString).slice(0, 20)
      : [],
    pendingConfirmationIds: Array.isArray(candidate.pendingConfirmationIds)
      ? candidate.pendingConfirmationIds.filter(isString).slice(0, 20)
      : [],
    recentMutationIds: Array.isArray(candidate.recentMutationIds)
      ? candidate.recentMutationIds.filter(isString).slice(0, 24)
      : [],
    recentVoiceSessionIds: Array.isArray(candidate.recentVoiceSessionIds)
      ? candidate.recentVoiceSessionIds.filter(isString).slice(0, 24)
      : [],
    battlefieldContext: candidate.battlefieldContext,
    localOnly: true,
    directBattlefieldMutation: false,
  };
}

function withDiagnostics(
  state: EchoAmbientOrchestratorState,
  patch: Partial<EchoAmbientOrchestratorState["diagnostics"]>,
): EchoAmbientOrchestratorState {
  return {
    ...state,
    diagnostics: createDiagnostics({
      ...state.diagnostics,
      ...patch,
    }),
  };
}

function workflowForIntentOrTranscript(
  intent: AmbientIntent | AmbientIntentInput | null,
  transcript: string,
): EchoAmbientOrchestratorWorkflow {
  if (intent) return workflowForIntentKind(intent.kind);
  const text = transcript.toLowerCase();
  if (text.includes("combat") || text.includes("attack")) {
    if (text.includes("damage") || text.includes("result"))
      return "combatResolution";
    return "combatDeclaration";
  }
  if (text.includes("forest") || text.includes("land")) return "landPlay";
  if (text.includes("cast")) return "spellCast";
  if (text.includes("trigger")) return "trigger";
  if (text.includes("end") || text.includes("pass")) return "endTurn";
  return "interface";
}

function workflowForIntentKind(
  kind: AmbientIntent["kind"],
): EchoAmbientOrchestratorWorkflow {
  if (kind === "play-land") return "landPlay";
  if (kind === "cast-spell" || kind === "activate-ability") return "spellCast";
  if (kind === "attack" || kind === "block") return "combatDeclaration";
  if (kind === "end-turn") return "endTurn";
  if (kind === "pass-priority") return "endStep";
  if (kind === "custom") return "interface";
  return "battlefieldAction";
}

function workflowToPersonalGameplayWorkflow(
  workflow: EchoAmbientOrchestratorWorkflow,
): EchoPredictiveWorkflowTarget {
  if (workflow === "combatDeclaration") return "combatDeclaration";
  if (workflow === "combatResolution") return "combatResolution";
  if (workflow === "planner") return "plannerStep";
  if (workflow === "battlefieldAction") return "listeningWindow";
  return "interfaceShortcut";
}

function deriveResultStatus(input: {
  grammar: string | null;
  clarification: EchoAmbientOrchestrationResult["clarification"];
  ambientPreview: EchoAmbientOrchestrationResult["ambientPreview"];
}): EchoAmbientOrchestratorSessionStatus {
  if (input.grammar === "rejected" || input.grammar === "unknown")
    return "recovering";
  if (input.clarification?.action === "clarified") return "clarifying";
  if (input.clarification?.action === "confirmation-required")
    return "awaitingConfirmation";
  if (input.ambientPreview?.requiresApproval) return "awaitingConfirmation";
  return "completed";
}

function announcementForStatus(
  status: EchoAmbientOrchestratorSessionStatus,
  workflow: EchoAmbientOrchestratorWorkflow,
): string {
  if (status === "clarifying") return "Clarification is needed.";
  if (status === "awaitingConfirmation")
    return "Preview prepared. Confirmation is required.";
  if (status === "recovering") return "Workflow recovery is available.";
  if (status === "completed")
    return `Ambient ${workflow} coordination completed.`;
  return "Ambient Gameplay Orchestrator updated.";
}

function roleForMagicObject(
  object: EchoMagicCommandObject,
): NonNullable<EchoEntityResolutionRequest["role"]> {
  if (object.kind === "counter") return "counter";
  if (object.kind === "zone") return "destination";
  return "target";
}

function expectedKindsForMagicObject(
  kind: EchoMagicCommandObjectKind,
): EchoEntityKind[] {
  if (kind === "commander") return ["commander", "creature", "permanent"];
  if (kind === "token") return ["token", "tokenStack"];
  if (kind === "player") return ["player", "opponent"];
  if (kind === "counter") return ["counter"];
  if (kind === "land") return ["land", "card", "permanent"];
  if (kind === "card") return ["card", "permanent"];
  if (kind === "battlefield-object") return ["permanent", "creature"];
  return [];
}

function uniqueObjects(
  objects: Array<EchoMagicCommandObject | null | undefined>,
): EchoMagicCommandObject[] {
  const seen = new Set<string>();
  const output: EchoMagicCommandObject[] = [];
  for (const object of objects) {
    if (!object) continue;
    const key = `${object.kind}:${object.normalizedText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(object);
  }
  return output;
}

function resolveActiveSessionId(
  activeSessionId: string | null,
  sessions: EchoAmbientOrchestratorSession[],
): string | null {
  const active = activeSessionId
    ? sessions.find(
        (session) =>
          session.id === activeSessionId &&
          ACTIVE_SESSION_STATUSES.includes(session.status),
      )
    : null;
  return active?.id ?? null;
}

function getSessionStatus(
  sessions: EchoAmbientOrchestratorSession[],
  sessionId: string,
): EchoAmbientOrchestratorSessionStatus {
  return sessions.find((session) => session.id === sessionId)?.status ?? "idle";
}

function statusForEvent(
  eventKind: EchoAmbientOrchestratorEventKind,
): EchoAmbientOrchestratorSessionStatus {
  if (eventKind === "workflow-started" || eventKind === "transcript-received")
    return "listening";
  if (eventKind === "clarification-requested") return "clarifying";
  if (eventKind === "preview-created") return "previewing";
  if (eventKind === "confirmation-requested") return "awaitingConfirmation";
  if (eventKind === "publish-started") return "publishing";
  if (eventKind === "workflow-cancelled") return "cancelled";
  if (eventKind === "workflow-interrupted") return "interrupted";
  if (eventKind === "workflow-recovered") return "recovering";
  if (eventKind === "session-restored") return "paused";
  return "completed";
}

function stageForEvent(
  kind: EchoAmbientOrchestratorEventKind,
  status: EchoAmbientOrchestratorSessionStatus,
  timestamp: string,
): EchoAmbientOrchestratorStageRecord {
  const stage =
    kind === "clarification-requested"
      ? "clarification"
      : kind === "preview-created"
        ? "gameplay-preview"
        : kind === "confirmation-requested"
          ? "confirmation"
          : kind === "publish-started" || kind === "publish-completed"
            ? "pipeline"
            : kind === "workflow-recovered" || kind === "workflow-interrupted"
              ? "recovery"
              : "session-completion";
  return {
    stage,
    status:
      status === "recovering" || status === "interrupted"
        ? "blocked"
        : "passed",
    message: `Orchestrator event ${kind} moved session to ${status}.`,
    timestamp,
  };
}

function intentIdsFromEvent(event: EchoAmbientOrchestratorEvent): string[] {
  const intent = event.intent;
  if (!intent || typeof intent !== "object") return [];
  return typeof intent.id === "string" && intent.id ? [intent.id] : [];
}

function activeSubsystemsForState(
  state: EchoAmbientOrchestratorState,
): EchoAmbientOrchestratorSubsystem[] {
  const context = state.sharedContext;
  const subsystems: EchoAmbientOrchestratorSubsystem[] = ["ambient-engine"];
  if (context?.currentListeningWindowId)
    subsystems.push("contextual-listening");
  if (context?.recentVoiceSessionIds.length) {
    subsystems.push("listening-lifecycle", "adaptive-listening-tail");
  }
  if (context?.pendingClarificationId) subsystems.push("clarification");
  if (context?.currentCombatSessionId) subsystems.push("combat-declaration");
  if (context?.currentCombatResolutionSessionId)
    subsystems.push("combat-resolution");
  if (context?.currentGameplaySessionId)
    subsystems.push("voice-battlefield-actions");
  if (context?.currentPlannerStepId) subsystems.push("pre-turn-planner");
  if (context?.currentActionStripItemId) subsystems.push("action-strip");
  if (state.diagnostics.lastWorkflow) subsystems.push("personal-gameplay");
  return uniqueStrings(subsystems) as EchoAmbientOrchestratorSubsystem[];
}

function countActiveSubsystems(
  context: EchoAmbientSharedContext | null,
): number {
  if (!context) return 0;
  return [
    context.currentListeningWindowId,
    context.currentPlannerStepId,
    context.currentActionStripItemId,
    context.currentCombatSessionId,
    context.currentCombatResolutionSessionId,
    context.currentGameplaySessionId,
    context.pendingClarificationId,
  ].filter(Boolean).length;
}

function isValidLifecycleStatus(
  value: EchoAmbientOrchestratorSessionStatus,
): boolean {
  return [
    "idle",
    "listening",
    "clarifying",
    "previewing",
    "awaitingConfirmation",
    "publishing",
    "recovering",
    "paused",
    "cancelled",
    "completed",
    "interrupted",
  ].includes(value);
}

function normalizeSessionStatus(
  value: unknown,
): EchoAmbientOrchestratorSessionStatus {
  return isValidLifecycleStatus(value as EchoAmbientOrchestratorSessionStatus)
    ? (value as EchoAmbientOrchestratorSessionStatus)
    : "idle";
}

function normalizeWorkflow(value: unknown): EchoAmbientOrchestratorWorkflow {
  return value === "planner" ||
    value === "landPlay" ||
    value === "spellCast" ||
    value === "trigger" ||
    value === "combatDeclaration" ||
    value === "combatResolution" ||
    value === "battlefieldAction" ||
    value === "secondMain" ||
    value === "endStep" ||
    value === "endTurn"
    ? value
    : "interface";
}

function normalizeSource(value: unknown): EchoAmbientOrchestratorSource {
  return value === "voice" ||
    value === "planner" ||
    value === "action-strip" ||
    value === "battlefield" ||
    value === "ambient-engine" ||
    value === "recovery" ||
    value === "settings"
    ? value
    : "system";
}

function normalizeResource(value: unknown): EchoAmbientOrchestratorResource {
  return RESOURCE_NAMES.includes(value as EchoAmbientOrchestratorResource)
    ? (value as EchoAmbientOrchestratorResource)
    : "voice-session";
}

function normalizeStage(
  value: unknown,
  timestamp: string,
): EchoAmbientOrchestratorStageRecord {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<EchoAmbientOrchestratorStageRecord>)
      : {};
  return {
    stage: normalizeStageName(candidate.stage),
    status: normalizeStageStatus(candidate.status),
    message: sanitizeText(candidate.message ?? "Stage normalized."),
    timestamp:
      typeof candidate.timestamp === "string" ? candidate.timestamp : timestamp,
  };
}

function normalizeStageName(value: unknown): EchoAmbientOrchestratorStageName {
  return value === "verified-speaker" ||
    value === "grammar" ||
    value === "context" ||
    value === "entity-resolution" ||
    value === "confidence" ||
    value === "clarification" ||
    value === "gameplay-preview" ||
    value === "confirmation" ||
    value === "pipeline" ||
    value === "undo-availability" ||
    value === "smart-suggestions" ||
    value === "session-completion" ||
    value === "recovery"
    ? value
    : "session-created";
}

function normalizeStageStatus(
  value: unknown,
): EchoAmbientOrchestratorStageStatus {
  return value === "passed" ||
    value === "skipped" ||
    value === "blocked" ||
    value === "failed"
    ? value
    : "pending";
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

function normalizeObservedPhase(value: unknown): AmbientObservedPhase | null {
  return value === "beginning" ||
    value === "precombatMain" ||
    value === "combat" ||
    value === "postcombatMain" ||
    value === "ending"
    ? value
    : value === "unknown"
      ? "unknown"
      : null;
}

function normalizeObservedController(
  value: unknown,
): AmbientObservedController | null {
  return value === "you" || value === "opponent" || value === "unknown"
    ? value
    : null;
}

function normalizeListeningWindowKind(
  value: unknown,
): EchoListeningWindowKind | null {
  return value === "generalGameplay" ||
    value === "landPlay" ||
    value === "spellCasting" ||
    value === "activatedAbility" ||
    value === "triggerResolution" ||
    value === "counterModification" ||
    value === "tokenCreation" ||
    value === "tokenRemoval" ||
    value === "lifeAdjustment" ||
    value === "commanderDamage" ||
    value === "combatPreparation" ||
    value === "combatDeclaration" ||
    value === "combatResolution" ||
    value === "endStep" ||
    value === "endTurn"
    ? value
    : null;
}

function isSubsystem(
  value: unknown,
): value is EchoAmbientOrchestratorSubsystem {
  return (
    value === "ambient-engine" ||
    value === "listening-lifecycle" ||
    value === "speaker-verification" ||
    value === "magic-grammar" ||
    value === "contextual-listening" ||
    value === "adaptive-listening-tail" ||
    value === "entity-resolution" ||
    value === "clarification" ||
    value === "combat-declaration" ||
    value === "combat-resolution" ||
    value === "voice-battlefield-actions" ||
    value === "pre-turn-planner" ||
    value === "action-strip" ||
    value === "personal-gameplay"
  );
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function sanitizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220)
    : "";
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, Math.round(numeric)))
    : fallback;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
