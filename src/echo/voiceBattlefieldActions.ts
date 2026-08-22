import { makeId } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type {
  CounterName,
  FieldState,
  GameEvent,
  GameEventType,
  ResolutionResult,
  ResolutionStep,
  Zone,
} from "../domain/types";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "../athena/eventForecast";
import { createAthenaPendingTriggerQueue } from "../athena/triggerQueue";
import { processAthenaConfirmedEventWithBookkeeping } from "../athena/triggerResolution";
import { withNextAthenaTriggerDecision } from "../athena/decisionEngine";
import { recordAthenaLiveTurnPipeline } from "../athena/liveTurnOrchestrator";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import {
  ambientEventPipeline,
  createAmbientPreview,
} from "./ambientEventPipeline";
import type {
  AmbientEntityReference,
  AmbientFieldMutation,
  AmbientIntentInput,
  AmbientPipelineResult,
} from "./ambientEventTypes";
import {
  decideClarificationForIntent,
  normalizeClarificationSettings,
} from "./clarification";
import {
  createBattlefieldContext,
  resolveEchoEntity,
} from "./entityResolution";
import type { EchoEntityKind } from "./entityResolutionTypes";
import {
  ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
  type EchoVoiceBattlefieldAction,
  type EchoVoiceBattlefieldActionApplyInput,
  type EchoVoiceBattlefieldActionDiagnostics,
  type EchoVoiceBattlefieldActionEntity,
  type EchoVoiceBattlefieldActionKind,
  type EchoVoiceBattlefieldActionSession,
  type EchoVoiceBattlefieldActionSessionStatus,
  type EchoVoiceBattlefieldActionSettings,
  type EchoVoiceBattlefieldActionState,
  type EchoVoiceBattlefieldCaptureInput,
  type EchoVoiceBattlefieldClarificationRequest,
  type EchoVoiceBattlefieldPreview,
  type EchoVoiceBattlefieldPreviewInput,
  type EchoVoiceBattlefieldPublishInput,
  type EchoVoiceBattlefieldResult,
  type EchoVoiceBattlefieldRevisionInput,
} from "./voiceBattlefieldActionsTypes";

const MAX_VOICE_BATTLEFIELD_SESSIONS = 8;
const DEFAULT_CONFIDENCE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const TARGET_EXPECTED_KINDS: EchoEntityKind[] = [
  "card",
  "commander",
  "creature",
  "token",
  "tokenStack",
  "permanent",
  "land",
  "artifact",
  "enchantment",
  "planeswalker",
  "battle",
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

const KNOWN_TRIGGER_NAMES = [
  "landfall",
  "anim pakal",
  "cathars crusade",
  "soul warden",
  "warleaders call",
  "warleader call",
  "commander",
];

export function createDefaultVoiceBattlefieldActionSettings(
  input: Partial<EchoVoiceBattlefieldActionSettings> = {},
): EchoVoiceBattlefieldActionSettings {
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    enabled: input.enabled ?? true,
    previewRequiresConfirmation: input.previewRequiresConfirmation ?? true,
    allowMultipleActions: input.allowMultipleActions ?? true,
    triggerRecognitionEnabled: input.triggerRecognitionEnabled ?? true,
    defaultTokenPower: clampCount(input.defaultTokenPower, 0, 99, 1),
    defaultTokenToughness: clampCount(input.defaultTokenToughness, 0, 99, 1),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: input.developerDiagnosticsEnabled ?? false,
    lastResetAt: input.lastResetAt ?? null,
  };
}

export function normalizeVoiceBattlefieldActionSettings(
  value: unknown,
): EchoVoiceBattlefieldActionSettings {
  const defaults = createDefaultVoiceBattlefieldActionSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoVoiceBattlefieldActionSettings>;
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
    allowMultipleActions:
      candidate.allowMultipleActions === undefined
        ? defaults.allowMultipleActions
        : Boolean(candidate.allowMultipleActions),
    triggerRecognitionEnabled:
      candidate.triggerRecognitionEnabled === undefined
        ? defaults.triggerRecognitionEnabled
        : Boolean(candidate.triggerRecognitionEnabled),
    defaultTokenPower: clampCount(
      candidate.defaultTokenPower,
      0,
      99,
      defaults.defaultTokenPower,
    ),
    defaultTokenToughness: clampCount(
      candidate.defaultTokenToughness,
      0,
      99,
      defaults.defaultTokenToughness,
    ),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: Boolean(candidate.developerDiagnosticsEnabled),
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultVoiceBattlefieldActionState(
  input: Partial<EchoVoiceBattlefieldActionState> = {},
): EchoVoiceBattlefieldActionState {
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    activeSessionId: null,
    sessions: [],
    lastPreviewId: null,
    lastCommittedSessionId: null,
    lastCancelledSessionId: null,
    ...input,
    diagnostics: createVoiceBattlefieldDiagnostics({
      ...input.diagnostics,
      activeSessionId: input.activeSessionId ?? null,
      lastPreviewId: input.lastPreviewId ?? null,
    }),
  };
}

export function normalizeVoiceBattlefieldActionState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoVoiceBattlefieldActionSettings;
    knownGroupIds?: string[];
    allowActiveSession?: boolean;
  } = {},
): EchoVoiceBattlefieldActionState {
  normalizeVoiceBattlefieldActionSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultVoiceBattlefieldActionState({
      diagnostics: createVoiceBattlefieldDiagnostics(null),
    });
  }
  const candidate = value as Partial<EchoVoiceBattlefieldActionState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((session) =>
          normalizeVoiceBattlefieldSession(session, {
            timestamp: options.fallbackTimestamp,
            knownGroupIds,
          }),
        )
        .filter((session): session is EchoVoiceBattlefieldActionSession =>
          Boolean(session),
        )
        .slice(-MAX_VOICE_BATTLEFIELD_SESSIONS)
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
      : recoverVoiceBattlefieldActionSession(session, {
          timestamp: options.fallbackTimestamp,
          reason:
            "Voice battlefield action session restored without active workflow.",
        });
  });
  return createDefaultVoiceBattlefieldActionState({
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
    diagnostics: createVoiceBattlefieldDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeSessionId: activeSession?.id ?? null,
      lastPreviewId:
        typeof candidate.lastPreviewId === "string"
          ? candidate.lastPreviewId
          : null,
      directBattlefieldMutation: false,
    }),
  });
}

export function startVoiceBattlefieldActionSession(
  field: FieldState,
  options: {
    timestamp?: string;
    settings?: EchoVoiceBattlefieldActionSettings;
  } = {},
): EchoVoiceBattlefieldResult {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeVoiceBattlefieldActionSettings(options.settings);
  const session: EchoVoiceBattlefieldActionSession = {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id: makeId("echo-battlefield-actions"),
    fieldSessionId: field.session.id,
    status: settings.enabled ? "staging" : "failed",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    transcript: [],
    normalizedTranscript: [],
    actions: [],
    preview: null,
    currentClarificationId: null,
    pipelineEventIds: [],
    recoveryReason: settings.enabled
      ? null
      : "Voice battlefield action framework is disabled.",
    accessibilityAnnouncement: settings.enabled
      ? "Voice battlefield action staging started."
      : "Voice battlefield action framework unavailable.",
    directBattlefieldMutation: false,
  };
  return {
    state: upsertVoiceBattlefieldSession(
      field.voiceBattlefieldActions,
      session,
    ),
    session,
    preview: null,
    intents: [],
    pipelineResults: [],
    events: [],
  };
}

export function captureVoiceBattlefieldActionTranscript(
  input: EchoVoiceBattlefieldCaptureInput,
): EchoVoiceBattlefieldResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeVoiceBattlefieldActionSettings(input.settings);
  const currentSession =
    input.session ??
    activeVoiceBattlefieldSession(input.field.voiceBattlefieldActions) ??
    startVoiceBattlefieldActionSession(input.field, {
      timestamp,
      settings,
    }).session;
  if (!settings.enabled) {
    const failed = failVoiceBattlefieldSession(
      currentSession,
      "Voice battlefield action framework is disabled.",
      timestamp,
    );
    return resultForVoiceBattlefieldSession(input.field, failed, null, []);
  }
  const fragments = actionFragments(input.transcript);
  const parsedActions = fragments.flatMap((fragment, index) =>
    parseVoiceBattlefieldAction({
      field: input.field,
      fragment,
      timestamp,
      order: currentSession.actions.length + index,
      settings,
    }),
  );
  const sessionWithTranscript = appendVoiceBattlefieldTranscript(
    currentSession,
    input.transcript,
    timestamp,
  );
  const nextSession: EchoVoiceBattlefieldActionSession = {
    ...sessionWithTranscript,
    status: parsedActions.some((action) => action.clarificationRequired)
      ? "awaitingClarification"
      : "previewReady",
    actions: settings.allowMultipleActions
      ? [...sessionWithTranscript.actions, ...parsedActions]
      : [...sessionWithTranscript.actions, ...parsedActions.slice(0, 1)],
    updatedAt: timestamp,
  };
  const preview = createVoiceBattlefieldActionPreview({
    field: input.field,
    session: nextSession,
    timestamp,
    settings,
  });
  const sessionWithPreview: EchoVoiceBattlefieldActionSession = {
    ...nextSession,
    status: preview.clarificationRequests.length
      ? "awaitingClarification"
      : "previewReady",
    preview,
    currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
    accessibilityAnnouncement:
      preview.summary[0] ?? "Voice battlefield action preview ready.",
  };
  return resultForVoiceBattlefieldSession(
    input.field,
    sessionWithPreview,
    preview,
    preview.actions.map((action) =>
      createVoiceBattlefieldIntent(
        action,
        sessionWithPreview,
        timestamp,
        input.field,
      ),
    ),
  );
}

export function reviseVoiceBattlefieldActions(
  input: EchoVoiceBattlefieldRevisionInput,
): EchoVoiceBattlefieldActionSession {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeVoiceBattlefieldActionSettings(input.settings);
  const normalized = normalizeActionText(input.transcript);
  if (/\b(cancel|nevermind|never mind|stop)\b/.test(normalized)) {
    return cancelVoiceBattlefieldActionSession(input.session, {
      timestamp,
      reason: "Voice battlefield action session cancelled by correction.",
    });
  }
  const quantity = extractQuantity(normalized) ?? 1;
  const targetText = stripRevisionWords(normalized);
  const targetAction = findRevisionTarget(input.session.actions, targetText);
  const skipRequested =
    /\b(remove|skip|not)\b/.test(normalized) ||
    (/\bno\b/.test(normalized) && !/\bonly\b/.test(normalized));
  const actions =
    targetAction && skipRequested
      ? input.session.actions.map((action) =>
          action.id === targetAction.id
            ? {
                ...action,
                status: "skipped" as const,
                updatedAt: timestamp,
              }
            : action,
        )
      : input.session.actions.map((action) =>
          action.id === targetAction?.id
            ? {
                ...action,
                quantity,
                status: "staged" as const,
                confidence: voiceBattlefieldConfidence({
                  level: "medium",
                  score: 0.72,
                  timestamp,
                  reasons: ["Staged action quantity was corrected."],
                }),
              }
            : action,
        );
  const revised: EchoVoiceBattlefieldActionSession = {
    ...appendVoiceBattlefieldTranscript(
      input.session,
      input.transcript,
      timestamp,
    ),
    actions,
    status: "previewReady",
    updatedAt: timestamp,
  };
  const preview = createVoiceBattlefieldActionPreview({
    field: input.field,
    session: revised,
    timestamp,
    settings,
  });
  return {
    ...revised,
    preview,
    currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
    status: preview.clarificationRequests.length
      ? "awaitingClarification"
      : "previewReady",
    accessibilityAnnouncement: "Voice battlefield action staging updated.",
  };
}

export function createVoiceBattlefieldActionPreview(
  input: EchoVoiceBattlefieldPreviewInput,
): EchoVoiceBattlefieldPreview {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeVoiceBattlefieldActionSettings(input.settings);
  const context =
    input.context ?? createBattlefieldContext(input.field, { timestamp });
  const actions = input.session.actions.map((action) =>
    normalizeVoiceBattlefieldAction(action, {
      timestamp,
      knownGroupIds: new Set(input.field.groups.map((group) => group.id)),
    }),
  );
  const clarificationRequests = actions.flatMap((action) =>
    clarificationRequestsForVoiceAction({
      field: input.field,
      action,
      timestamp,
      settings,
      context,
    }),
  );
  const confirmedActionCount = actions.filter(
    (action) =>
      action.status !== "skipped" &&
      action.status !== "rejected" &&
      !action.clarificationRequired,
  ).length;
  const pendingClarificationCount = clarificationRequests.length;
  const rejectedActionCount = actions.filter(
    (action) => action.status === "rejected",
  ).length;
  const lowConfidenceActionCount = actions.filter(
    (action) =>
      action.confidence.level === "low" ||
      action.confidence.level === "unknown",
  ).length;
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id: input.session.preview?.id ?? makeId("echo-battlefield-preview"),
    sessionId: input.session.id,
    createdAt: input.session.preview?.createdAt ?? timestamp,
    updatedAt: timestamp,
    actions,
    summary: summarizeVoiceBattlefieldPreview(actions),
    confirmedActionCount,
    pendingClarificationCount,
    rejectedActionCount,
    lowConfidenceActionCount,
    clarificationRequests,
    confidence: previewConfidence(actions, timestamp),
    directBattlefieldMutation: false,
  };
}

export function publishVoiceBattlefieldActionsToPipeline(
  input: EchoVoiceBattlefieldPublishInput,
): EchoVoiceBattlefieldResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const preview =
    input.preview ??
    input.session.preview ??
    createVoiceBattlefieldActionPreview({
      field: input.field,
      session: input.session,
      timestamp,
      settings: input.field.settings.voice.battlefieldActions,
    });
  const intents = preview.actions.map((action) =>
    createVoiceBattlefieldIntent(action, input.session, timestamp, input.field),
  );
  if (preview.clarificationRequests.length) {
    const pendingSession: EchoVoiceBattlefieldActionSession = {
      ...input.session,
      status: "awaitingClarification",
      preview,
      updatedAt: timestamp,
      currentClarificationId: preview.clarificationRequests[0]?.id ?? null,
      accessibilityAnnouncement:
        preview.clarificationRequests[0]?.question ??
        "Voice battlefield action needs clarification.",
    };
    return {
      state: upsertVoiceBattlefieldSession(
        input.field.voiceBattlefieldActions,
        pendingSession,
      ),
      session: pendingSession,
      preview,
      intents,
      pipelineResults: [],
      events: [],
    };
  }
  if (
    (input.approval ?? "automatic") === "automatic" &&
    input.speakerVerified !== true
  ) {
    const rejectedSession: EchoVoiceBattlefieldActionSession = {
      ...input.session,
      status: "failed",
      preview,
      updatedAt: timestamp,
      completedAt: null,
      currentClarificationId: null,
      recoveryReason:
        "Speaker verification is required for automatic voice gameplay actions.",
      accessibilityAnnouncement:
        "Voice action not applied. Speaker verification is required.",
    };
    return resultForVoiceBattlefieldSession(
      input.field,
      rejectedSession,
      preview,
      intents,
    );
  }

  let currentField = normalizeField({
    ...input.field,
    voiceBattlefieldActions: upsertVoiceBattlefieldSession(
      input.field.voiceBattlefieldActions,
      {
        ...input.session,
        status: "committing",
        preview,
        updatedAt: timestamp,
      },
    ),
  });
  const pipelineResults: AmbientPipelineResult[] = [];
  const events = [];

  for (const action of preview.actions) {
    if (action.status === "skipped" || action.status === "rejected") continue;
    const intent = createVoiceBattlefieldIntent(
      action,
      input.session,
      timestamp,
      currentField,
    );
    const mutation: AmbientFieldMutation = ({ field }) => {
      const result = applyVoiceBattlefieldActionToField({
        field,
        action,
        timestamp,
        speakerVerified: input.speakerVerified,
      });
      if (result.title === "Voice Action Not Applied") {
        throw new Error(result.summary[0] ?? "Voice action was not applied.");
      }
      return result;
    };
    const pipelineResult = ambientEventPipeline.process({
      field: currentField,
      intent,
      mutation,
      approval: {
        method: input.approval ?? "automatic",
        decision: "approved",
        reason: "Voice battlefield action preview confirmed.",
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
    pipelineResults.push(pipelineResult);
    if (pipelineResult.event) events.push(pipelineResult.event);
    if (pipelineResult.status === "completed") {
      currentField = pipelineResult.field;
    }
  }

  const committed = pipelineResults.every(
    (result) => result.status === "completed",
  );
  const committedActions = preview.actions.map((action) =>
    action.status === "skipped" || action.status === "rejected"
      ? action
      : {
          ...action,
          status: committed ? ("committed" as const) : action.status,
        },
  );
  const committedSession: EchoVoiceBattlefieldActionSession = {
    ...input.session,
    status: committed ? "committed" : "failed",
    updatedAt: timestamp,
    completedAt: committed ? timestamp : null,
    actions: committedActions,
    preview: {
      ...preview,
      actions: committedActions,
      updatedAt: timestamp,
    },
    currentClarificationId: null,
    pipelineEventIds: events.map((event) => event.id),
    recoveryReason: committed
      ? null
      : "One or more voice battlefield actions failed safely.",
    accessibilityAnnouncement: committed
      ? "Voice battlefield actions committed."
      : "Voice battlefield action failed safely.",
  };
  return {
    state: upsertVoiceBattlefieldSession(
      currentField.voiceBattlefieldActions,
      committedSession,
    ),
    session: committedSession,
    preview: committedSession.preview,
    intents,
    pipelineResults,
    events,
  };
}

export function applyVoiceBattlefieldActionToField(
  input: EchoVoiceBattlefieldActionApplyInput,
): ResolutionResult {
  const action = normalizeVoiceBattlefieldAction(input.action, {
    timestamp: input.timestamp,
    knownGroupIds: new Set(input.field.groups.map((group) => group.id)),
  });
  if (action.clarificationRequired || action.status === "rejected") {
    return finalizeVoiceResult(input.field, input.field, {
      title: "Voice Action Not Applied",
      summary: [
        action.clarificationQuestion ?? "Action requires clarification.",
      ],
      details: [],
      events: [],
      changedGroupIds: [],
    });
  }
  const athenaResult = applySupportedVoiceActionThroughAthena(
    input.field,
    action,
    input.timestamp,
    input.speakerVerified,
  );
  if (athenaResult) return athenaResult;
  if (action.kind === "token-remove" || action.kind === "permanent-remove") {
    return finalizeVoiceResult(input.field, input.field, {
      title: "Voice Action Not Applied",
      summary: [
        action.clarificationQuestion ??
          "Choose how the permanent left, or use Correction Only for the current battlefield.",
      ],
      details: [],
      events: [],
      changedGroupIds: [],
    });
  }

  const before = input.field;
  let next = structuredClone(input.field);
  const details: ResolutionStep[] = [];
  const events: GameEvent[] = [];
  const changedGroupIds = new Set<string>();

  if (action.kind === "trigger-announcement") {
    details.push(
      step(
        "Trigger announced",
        `${action.triggerName ?? action.note ?? "Trigger"} was announced for manual resolution.`,
        "trigger-announced",
      ),
    );
    events.push(
      createVoiceEvent(
        "trigger-announced",
        action.target?.groupId ?? null,
        1,
        action.target?.groupId ? [action.target.groupId] : [],
        {
          triggerName: action.triggerName ?? "Trigger",
          manualResolutionRequired: true,
        },
      ),
    );
  } else if (action.kind === "reminder" || action.kind === "battlefield-note") {
    const type =
      action.kind === "reminder"
        ? "reminder-created"
        : "battlefield-note-created";
    details.push(
      step(
        action.kind === "reminder"
          ? "Reminder recorded"
          : "Battlefield note recorded",
        action.note ?? "Manual note recorded.",
        type,
      ),
    );
    events.push(
      createVoiceEvent(
        type,
        action.target?.groupId ?? null,
        1,
        action.target?.groupId ? [action.target.groupId] : [],
        {
          note: action.note ?? "",
        },
      ),
    );
  }

  return finalizeVoiceResult(before, next, {
    title: "Voice Battlefield Action",
    summary: summarizeAction(action),
    details,
    events,
    changedGroupIds: [...changedGroupIds],
  });
}

function applySupportedVoiceActionThroughAthena(
  field: FieldState,
  action: EchoVoiceBattlefieldAction,
  timestamp: string,
  speakerVerified = false,
): ResolutionResult | null {
  const category = athenaCategoryForVoiceAction(action);
  if (!category) return null;
  const targetGroups =
    (action.kind === "tap" || action.kind === "untap") &&
    action.note === "everything"
      ? field.groups.filter(
          (group) => group.zone === "battlefield" && group.controller === "you",
        )
      : action.target?.groupId
        ? field.groups.filter((group) => group.id === action.target?.groupId)
        : [];
  const target = targetGroups[0] ?? null;
  if (
    (category === "counter-placed" ||
      category === "counter-removed" ||
      category === "permanent-tapped" ||
      category === "permanent-untapped" ||
      category === "permanent-died" ||
      category === "permanent-sacrificed" ||
      category === "permanent-exiled" ||
      category === "permanent-returned-to-hand" ||
      category === "permanent-returned-to-battlefield") &&
    !target
  ) {
    return finalizeVoiceResult(field, field, {
      title: "Voice Action Not Applied",
      summary: [
        action.clarificationQuestion ??
          "Choose the battlefield object for this action.",
      ],
      details: [],
      events: [],
      changedGroupIds: [],
    });
  }
  const environment = createForecastEnvironment(field);
  const tokenDefinition =
    category === "token-created"
      ? {
          id: `echo-token:${normalizeActionText(action.tokenName ?? "Token")}`,
          name: action.tokenName ?? "Token",
          power: action.tokenPower ?? 1,
          toughness: action.tokenToughness ?? 1,
          characteristics: voiceTokenCharacteristics(
            action.tokenName ?? "Token",
          ),
        }
      : null;
  const event = createAthenaForecastInput(
    {
      eventId: `echo-action:${action.id}`,
      eventCategory: category,
      eventSource: "echo-reported",
      authoritySource: "project-echo-voice-report",
      timestamp,
      quantity: action.quantity,
      sourceObjectId: target?.id ?? null,
      subjectGroupIds: targetGroups.map((group) => group.id),
      knownCharacteristics:
        tokenDefinition?.characteristics ?? target?.characteristics ?? null,
      counterType: action.counterName,
      tokenDefinition,
      zoneOrigin: target?.zone ?? action.zoneOrigin,
      zoneDestination: voiceDestination(category),
      metadata: {
        confirmed: true,
        canonicalEvent: true,
        hypothetical: false,
        label: target?.label ?? action.tokenName ?? action.kind,
        targetQuantity:
          category === "counter-placed" || category === "counter-removed"
            ? (target?.quantity ?? null)
            : null,
        echoVoiceBattlefieldActionId: action.id,
        commanderDamage: action.kind === "commander-damage",
      },
      lifeDelta:
        action.kind === "commander-damage" ? -action.quantity : undefined,
      commanderDamageDelta:
        action.kind === "commander-damage" ? action.quantity : undefined,
      confidence: {
        level: action.confidence.level === "low" ? "medium" : "high",
        score: action.confidence.score,
        speakerVerified: speakerVerified ? true : null,
      },
    },
    environment,
  );
  const queue = createAthenaPendingTriggerQueue({
    canonicalSessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    timestamp,
  });
  const pipeline = processAthenaConfirmedEventWithBookkeeping({
    field,
    event,
    queue,
    timestamp,
  });
  if (pipeline.validity !== "committed" || !pipeline.rootCanonicalEvent) {
    if (pipeline.validity === "duplicate") {
      return finalizeVoiceResult(field, field, {
        title: "Voice Action Already Applied",
        summary: [pipeline.reason],
        details: [],
        events: [],
        changedGroupIds: [],
      });
    }
    return finalizeVoiceResult(field, field, {
      title: "Voice Action Not Applied",
      summary: [pipeline.reason],
      details: [],
      events: [],
      changedGroupIds: [],
    });
  }
  const canonicalEvents = [
    pipeline.rootCanonicalEvent,
    ...(pipeline.autoResolution?.generatedCanonicalEvents ?? []),
  ];
  const withDecision = withNextAthenaTriggerDecision(
    pipeline.resultingField,
    pipeline.queue,
    timestamp,
  );
  const coordinated = recordAthenaLiveTurnPipeline(withDecision, {
    queue: pipeline.queue,
    canonicalEvents,
    unexpected: true,
    timestamp,
  });
  return finalizeVoiceResult(field, coordinated, {
    title: "Voice Action Applied",
    summary: [voiceAthenaSummary(field, coordinated, action)],
    details: [],
    events: canonicalEvents,
    changedGroupIds: uniqueStringValues(
      canonicalEvents.flatMap((entry) => entry.groupIds),
    ),
  });
}

function athenaCategoryForVoiceAction(
  action: EchoVoiceBattlefieldAction,
): GameEventType | null {
  if (action.kind === "life-gain") return "life-gained";
  if (action.kind === "life-loss") return "life-lost";
  if (action.kind === "commander-damage") return "damage-dealt";
  if (action.kind === "counter-add") return "counter-placed";
  if (action.kind === "counter-remove") return "counter-removed";
  if (action.kind === "token-create") return "token-created";
  if (action.kind === "permanent-create") return "permanent-entered";
  if (action.kind === "permanent-destroy") return "permanent-died";
  if (action.kind === "permanent-sacrifice") return "permanent-sacrificed";
  if (action.kind === "permanent-exile") return "permanent-exiled";
  if (action.kind === "return-to-hand") return "permanent-returned-to-hand";
  if (action.kind === "return-to-battlefield")
    return "permanent-returned-to-battlefield";
  if (action.kind === "tap") return "permanent-tapped";
  if (action.kind === "untap") return "permanent-untapped";
  if (action.kind === "draw-cards") return "cards-drawn";
  if (action.kind === "discard-cards") return "cards-discarded";
  return null;
}

function voiceDestination(category: GameEventType): Zone | null {
  if (category === "permanent-died" || category === "permanent-sacrificed")
    return "graveyard";
  if (category === "permanent-exiled") return "exile";
  if (category === "permanent-returned-to-hand") return "hand";
  if (category === "permanent-returned-to-battlefield") return "battlefield";
  if (category === "permanent-entered") return "battlefield";
  if (category === "cards-drawn") return "hand";
  if (category === "cards-discarded") return "graveyard";
  return null;
}

function voiceAthenaSummary(
  before: FieldState,
  after: FieldState,
  action: EchoVoiceBattlefieldAction,
): string {
  if (action.kind === "life-gain")
    return `Life gain: ${before.player.life} to ${after.player.life}.`;
  if (action.kind === "life-loss")
    return `Life loss: ${before.player.life} to ${after.player.life}.`;
  return summarizeAction(action)[0];
}

function voiceTokenCharacteristics(name: string) {
  const normalized = normalizeActionText(name);
  const artifactOnly = new Set([
    "blood",
    "clue",
    "food",
    "map",
    "powerstone",
    "treasure",
  ]).has(normalized);
  return {
    cardTypes: artifactOnly ? ["Artifact"] : ["Creature"],
    supertypes: [],
    subtypes: [name],
    colors: [],
    manaValue: 0,
    isToken: true,
    isCreature: !artifactOnly,
    isLegendary: false,
    knownFields: [
      "cardTypes" as const,
      "supertypes" as const,
      "subtypes" as const,
      "colors" as const,
      "manaValue" as const,
      "isToken" as const,
      "isCreature" as const,
      "isLegendary" as const,
    ],
  };
}

function uniqueStringValues(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function cancelVoiceBattlefieldActionSession(
  session: EchoVoiceBattlefieldActionSession,
  options: { timestamp?: string; reason?: string } = {},
): EchoVoiceBattlefieldActionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "cancelled",
    updatedAt: timestamp,
    completedAt: timestamp,
    currentClarificationId: null,
    recoveryReason:
      options.reason ?? "Voice battlefield action session cancelled.",
    accessibilityAnnouncement: "Voice battlefield action session cancelled.",
  };
}

export function recoverVoiceBattlefieldActionSession(
  session: EchoVoiceBattlefieldActionSession,
  options: { timestamp?: string; reason?: string } = {},
): EchoVoiceBattlefieldActionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...session,
    status: "recovered",
    updatedAt: timestamp,
    currentClarificationId: null,
    recoveryReason:
      options.reason ?? "Voice battlefield action session recovered safely.",
    accessibilityAnnouncement: "Voice battlefield action session recovered.",
  };
}

export function getVoiceBattlefieldActionDiagnostics(
  state: EchoVoiceBattlefieldActionState,
): EchoVoiceBattlefieldActionDiagnostics {
  return createVoiceBattlefieldDiagnostics({
    ...state.diagnostics,
    activeSessionId: state.activeSessionId,
    lastPreviewId: state.lastPreviewId,
    stagedActionCount:
      state.sessions.find((session) => session.id === state.activeSessionId)
        ?.actions.length ?? 0,
  });
}

function parseVoiceBattlefieldAction(input: {
  field: FieldState;
  fragment: { original: string; normalized: string };
  timestamp: string;
  order: number;
  settings: EchoVoiceBattlefieldActionSettings;
}): EchoVoiceBattlefieldAction[] {
  const text = input.fragment.normalized;
  if (!text) return [];

  const commanderDamage = text.match(
    /\b(?:take|took|deal|dealt|mark|record)?\s*(\d+|[a-z]+)\s+commander\s+damage\b/,
  );
  if (commanderDamage) {
    return [
      createVoiceAction(input, {
        kind: "commander-damage",
        intentKind: "modify-commander-damage",
        quantity: extractQuantity(text) ?? 1,
        generatedEventType: "damage-dealt",
      }),
    ];
  }

  const lifeGain = text.match(
    /\b(?:gain|gained|gaining)\s+(\d+|[a-z]+)\s+life\b/,
  );
  if (lifeGain) {
    return [
      createVoiceAction(input, {
        kind: "life-gain",
        intentKind: "modify-life",
        quantity: extractQuantity(text) ?? 1,
        generatedEventType: "life-gained",
      }),
    ];
  }
  const lifeLoss = text.match(
    /\b(?:lose|lost|pay|paid|take|took)\s+(\d+|[a-z]+)(?:\s+life|\s+damage)?\b/,
  );
  if (lifeLoss) {
    return [
      createVoiceAction(input, {
        kind: "life-loss",
        intentKind: "modify-life",
        quantity: extractQuantity(text) ?? 1,
        generatedEventType: "life-lost",
      }),
    ];
  }

  const counter = parseCounterAction(text);
  if (counter) {
    const target = counter.targetText
      ? resolveActionTarget(input.field, counter.targetText, input.timestamp)
      : resolveCounterCarrier(
          input.field,
          counter.counterName,
          input.timestamp,
        );
    return [
      createVoiceAction(input, {
        kind: counter.mode === "add" ? "counter-add" : "counter-remove",
        intentKind: counter.mode === "add" ? "add-counters" : "remove-counters",
        quantity: counter.quantity,
        counterName: counter.counterName,
        target,
        generatedEventType:
          counter.mode === "add" ? "counter-placed" : "counter-removed",
      }),
    ];
  }

  const tokenCreate = text.match(
    /\b(?:create|make)\s+(\d+|[a-z]+)\s+(.+?)(?:\s+tokens?)?$/,
  );
  if (tokenCreate) {
    const tokenName = cleanObjectText(tokenCreate[2]);
    return [
      createVoiceAction(input, {
        kind: "token-create",
        intentKind: "create-token",
        quantity: extractQuantity(text) ?? 1,
        tokenName: titleCase(singularize(tokenName)),
        generatedEventType: "token-created",
      }),
    ];
  }

  const tokenRemove = text.match(
    /\b(remove|sacrifice|sac|exile|destroy)\s+(\d+|[a-z]+)?\s*(.+?)(?:\s+tokens?)?$/,
  );
  if (
    tokenRemove &&
    /\b(token|treasure|soldier|clue|food|blood|map)\b/.test(text)
  ) {
    const operation = tokenRemove[1];
    const targetText = cleanObjectText(tokenRemove[3]);
    const target = resolveActionTarget(
      input.field,
      targetText,
      input.timestamp,
    );
    const kind =
      operation === "sacrifice" || operation === "sac"
        ? "permanent-sacrifice"
        : operation === "destroy"
          ? "permanent-destroy"
          : operation === "exile"
            ? "permanent-exile"
            : "token-remove";
    return [
      createVoiceAction(input, {
        kind,
        intentKind:
          kind === "permanent-sacrifice"
            ? "sacrifice-permanent"
            : kind === "permanent-destroy"
              ? "destroy-permanent"
              : kind === "permanent-exile"
                ? "exile-permanent"
                : "custom",
        quantity: extractQuantity(text) ?? 1,
        target,
        zoneOrigin: "battlefield",
        zoneDestination:
          kind === "permanent-exile"
            ? "exile"
            : kind === "token-remove"
              ? null
              : "graveyard",
        generatedEventType:
          kind === "permanent-sacrifice"
            ? "permanent-sacrificed"
            : kind === "permanent-destroy"
              ? "permanent-died"
              : kind === "permanent-exile"
                ? "permanent-exiled"
                : null,
        clarificationQuestion:
          kind === "token-remove"
            ? "Did the tokens die, get sacrificed, get exiled, or should Lite only correct the quantity?"
            : null,
      }),
    ];
  }

  const tap = text.match(/^(tap|untap)\s+(.+)$/);
  if (tap) {
    const targetText = cleanObjectText(tap[2]);
    const target =
      targetText === "everything" || targetText === "all"
        ? null
        : resolveActionTarget(input.field, targetText, input.timestamp);
    return [
      createVoiceAction(input, {
        kind: tap[1] === "tap" ? "tap" : "untap",
        intentKind: tap[1] === "tap" ? "tap" : "untap",
        quantity: 1,
        target,
        note:
          targetText === "everything" || targetText === "all"
            ? "everything"
            : null,
        generatedEventType:
          tap[1] === "tap" ? "permanent-tapped" : "permanent-untapped",
      }),
    ];
  }

  const zone = parseZoneAction(text);
  if (zone) {
    const target = zone.targetText
      ? resolveActionTarget(input.field, zone.targetText, input.timestamp)
      : null;
    return [
      createVoiceAction(input, {
        kind: zone.kind,
        intentKind: zone.intentKind,
        quantity: extractQuantity(text) ?? 1,
        target,
        zoneOrigin: zone.origin,
        zoneDestination: zone.destination,
        generatedEventType: zone.eventType,
        clarificationQuestion:
          zone.kind === "permanent-remove"
            ? "Did it die, get sacrificed, get exiled, return to hand, or should Lite only correct the battlefield?"
            : null,
      }),
    ];
  }

  const permanentEntry = text.match(
    /^(.+?)\s+(?:enters|entered|comes in|came in)$/,
  );
  if (permanentEntry) {
    const targetText = cleanObjectText(permanentEntry[1]);
    const target = resolveActionTarget(
      input.field,
      targetText,
      input.timestamp,
    );
    return [
      createVoiceAction(input, {
        kind: "permanent-create",
        intentKind: "custom",
        quantity: 1,
        target,
        note: titleCase(targetText),
        generatedEventType: "permanent-entered",
      }),
    ];
  }

  if (input.settings.triggerRecognitionEnabled && isTriggerAnnouncement(text)) {
    const targetText = text.replace(/\b(triggers?|triggered)\b/g, "").trim();
    const target = targetText
      ? resolveActionTarget(input.field, targetText, input.timestamp)
      : null;
    return [
      createVoiceAction(input, {
        kind: "trigger-announcement",
        intentKind: "custom",
        quantity: 1,
        target,
        triggerName: titleCase(targetText || text),
        note: titleCase(text),
        generatedEventType: "trigger-announced",
      }),
    ];
  }

  const draw = text.match(/\b(?:draw|drew)\s+(\d+|[a-z]+)\b/);
  if (draw) {
    return [
      createVoiceAction(input, {
        kind: "draw-cards",
        intentKind: "draw-cards",
        quantity: extractQuantity(text) ?? 1,
        generatedEventType: null,
      }),
    ];
  }
  const discard = text.match(/\b(?:discard|discarded)\s+(\d+|[a-z]+)\b/);
  if (discard) {
    return [
      createVoiceAction(input, {
        kind: "discard-cards",
        intentKind: "discard-cards",
        quantity: extractQuantity(text) ?? 1,
        generatedEventType: null,
      }),
    ];
  }

  if (/^(reminder|remember)\b/.test(text)) {
    return [
      createVoiceAction(input, {
        kind: "reminder",
        intentKind: "custom",
        quantity: 1,
        note: input.fragment.original,
        generatedEventType: "reminder-created",
      }),
    ];
  }
  if (/^(note|mark)\b/.test(text)) {
    return [
      createVoiceAction(input, {
        kind: "battlefield-note",
        intentKind: "custom",
        quantity: 1,
        note: input.fragment.original,
        generatedEventType: "battlefield-note-created",
      }),
    ];
  }

  return [
    createVoiceAction(input, {
      kind: "battlefield-note",
      intentKind: "custom",
      quantity: 1,
      note: input.fragment.original,
      generatedEventType: "battlefield-note-created",
      confidenceLevel: "low",
      clarificationQuestion: "What action?",
    }),
  ];
}

function createVoiceAction(
  input: {
    field: FieldState;
    fragment: { original: string; normalized: string };
    timestamp: string;
    order: number;
  },
  action: Partial<EchoVoiceBattlefieldAction> & {
    kind: EchoVoiceBattlefieldActionKind;
    intentKind: EchoVoiceBattlefieldAction["intentKind"];
    confidenceLevel?: AmbientConfidenceLevel;
  },
): EchoVoiceBattlefieldAction {
  const targetMissing =
    actionRequiresTarget(action.kind) &&
    !action.target?.groupId &&
    action.note !== "everything";
  const targetAmbiguous = action.target?.entityResult?.status === "ambiguous";
  const clarificationQuestion =
    action.clarificationQuestion ??
    (targetAmbiguous
      ? `Which ${titleCase(action.target?.sourceText ?? "permanent")}?`
      : targetMissing
        ? targetQuestionForKind(action.kind)
        : null);
  const confidenceLevel =
    action.confidenceLevel ??
    (targetMissing || targetAmbiguous ? "low" : "high");
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id: makeId("echo-battlefield-action"),
    order: input.order,
    kind: action.kind,
    status:
      targetMissing || targetAmbiguous
        ? "pendingClarification"
        : (action.status ?? "staged"),
    intentKind: action.intentKind,
    originalTranscript: input.fragment.original,
    normalizedTranscript: input.fragment.normalized,
    quantity: clampCount(action.quantity, 0, 999, 1),
    counterName: action.counterName ?? null,
    tokenName: action.tokenName ?? null,
    tokenPower: action.tokenPower ?? null,
    tokenToughness: action.tokenToughness ?? null,
    zoneOrigin: action.zoneOrigin ?? null,
    zoneDestination: action.zoneDestination ?? null,
    target: action.target ?? null,
    triggerName: action.triggerName ?? null,
    note: action.note ?? null,
    confidence: voiceBattlefieldConfidence({
      level: confidenceLevel,
      score: confidenceLevel === "high" ? 0.91 : 0.34,
      timestamp: input.timestamp,
      reasons: [
        confidenceLevel === "high"
          ? "Voice battlefield action recognized and staged."
          : "Voice battlefield action requires clarification.",
      ],
    }),
    clarificationRequired: Boolean(clarificationQuestion),
    clarificationQuestion,
    generatedEventType: action.generatedEventType ?? null,
    directBattlefieldMutation: false,
  };
}

function resolveActionTarget(
  field: FieldState,
  text: string,
  timestamp: string,
): EchoVoiceBattlefieldActionEntity {
  const entityResult = resolveEchoEntity({
    field,
    text,
    expectedKinds: TARGET_EXPECTED_KINDS,
    role: "target",
    timestamp,
    settings: field.settings.voice.entityResolution,
  });
  const group = entityResult.selected?.groupId
    ? field.groups.find((entry) => entry.id === entityResult.selected?.groupId)
    : null;
  return {
    groupId: group?.id ?? null,
    objectIds: group?.session?.objectIds ?? (group ? [group.id] : []),
    label: group?.label ?? entityResult.selected?.label ?? null,
    sourceText: text,
    owner: group?.owner ?? entityResult.selected?.owner ?? null,
    zone: group?.zone ?? entityResult.selected?.zone ?? null,
    entityResult,
  };
}

function resolveCounterCarrier(
  field: FieldState,
  counterName: string,
  timestamp: string,
): EchoVoiceBattlefieldActionEntity | null {
  const carriers = field.groups.filter(
    (group) => (group.counters[counterName] ?? 0) > 0,
  );
  if (carriers.length === 1) {
    const group = carriers[0];
    return {
      groupId: group.id,
      objectIds: group.session?.objectIds ?? [group.id],
      label: group.label,
      sourceText: counterName,
      owner: group.owner,
      zone: group.zone,
      entityResult: null,
    };
  }
  if (carriers.length > 1) {
    return {
      groupId: null,
      objectIds: [],
      label: null,
      sourceText: counterName,
      owner: null,
      zone: null,
      entityResult: {
        version: 1,
        status: "ambiguous",
        text: counterName,
        normalizedText: normalizeActionText(counterName),
        selected: null,
        candidates: carriers.map((group, index) => ({
          id: `counter-carrier:${group.id}`,
          kind: "permanent",
          label: group.label,
          normalizedLabel: normalizeActionText(group.label),
          priority: "battlefield",
          priorityRank: index,
          score: 0.75,
          confidenceLevel: "medium",
          entity: { kind: "group", id: group.id, role: "target" },
          groupId: group.id,
          objectIds: group.session?.objectIds ?? [group.id],
          owner: group.owner,
          controller: group.controller,
          zone: group.zone,
          cardId: group.identity?.cardId ?? null,
          source: "battlefield",
          relationshipIds: [],
          relationshipSummary: [],
          metadata: {},
        })),
        ambiguities: [
          {
            type: "multiple-battlefield-objects",
            message: "Multiple permanents have that counter.",
            candidates: carriers.map((group) => group.label),
          },
        ],
        confidence: {
          level: "low",
          score: 0.34,
          reasons: ["Multiple possible counter carriers."],
        },
        resolvedEntities: [],
        context: createBattlefieldContext(field, { timestamp }),
        diagnostics: {
          version: 1,
          status: "ambiguous",
          lastResolvedAt: timestamp,
          lastText: counterName,
          lastSelectedId: null,
          candidateCount: carriers.length,
          ambiguityCount: 1,
          scryfallFallbackAttempted: false,
          scryfallFallbackReason: null,
          cacheSize: 0,
          directBattlefieldMutation: false,
        },
        accessibilityAnnouncement: "Counter target needs clarification.",
        directBattlefieldMutation: false,
      },
    };
  }
  return null;
}

function createVoiceBattlefieldIntent(
  action: EchoVoiceBattlefieldAction,
  session: EchoVoiceBattlefieldActionSession,
  timestamp: string,
  field?: FieldState,
): AmbientIntentInput {
  const entities: AmbientEntityReference[] = [];
  if (action.target?.groupId) {
    entities.push({
      kind: "group",
      id: action.target.groupId,
      role:
        action.intentKind === "tap" || action.intentKind === "untap"
          ? "source"
          : "target",
    });
  }
  if (
    field &&
    (action.intentKind === "tap" || action.intentKind === "untap") &&
    action.note === "everything"
  ) {
    const existingGroupIds = new Set(
      entities
        .filter((entity) => entity.kind === "group")
        .map((entity) => entity.id),
    );
    for (const group of field.groups) {
      if (
        group.owner === "you" &&
        group.zone === "battlefield" &&
        !existingGroupIds.has(group.id)
      ) {
        existingGroupIds.add(group.id);
        entities.push({
          kind: "group",
          id: group.id,
          role: "source",
        });
      }
    }
  }
  if (action.counterName) {
    entities.push({
      kind: "counter",
      name: action.counterName,
      role: "counter",
    });
  }
  if (
    action.kind === "life-gain" ||
    action.kind === "life-loss" ||
    action.kind === "commander-damage"
  ) {
    entities.push({ kind: "player", owner: "you", role: "target" });
  }
  if (action.zoneOrigin)
    entities.push({ kind: "zone", zone: action.zoneOrigin, role: "origin" });
  if (action.zoneDestination)
    entities.push({
      kind: "zone",
      zone: action.zoneDestination,
      role: "destination",
    });
  return {
    id: makeId("voice-battlefield-intent"),
    kind: action.intentKind,
    source: "voice-command",
    actor: "you",
    createdAt: timestamp,
    entities,
    payload: {
      voiceBattlefieldSessionId: session.id,
      voiceBattlefieldActionId: action.id,
      actionKind: action.kind,
      quantity: action.quantity,
      amount:
        action.kind === "life-gain" || action.kind === "life-loss"
          ? action.quantity
          : null,
      delta:
        action.kind === "life-gain"
          ? action.quantity
          : action.kind === "life-loss"
            ? action.quantity
            : null,
      commanderDamage:
        action.kind === "commander-damage" ? action.quantity : null,
      counterName: action.counterName,
      tokenName: action.tokenName,
      targetLabel: action.target?.label,
      triggerName: action.triggerName,
      note: action.note,
      originalTranscript: action.originalTranscript,
    },
    confidence: action.confidence,
    requiredMode: null,
    requiresPreview: true,
    correlationId: session.id,
  };
}

function clarificationRequestsForVoiceAction(input: {
  field: FieldState;
  action: EchoVoiceBattlefieldAction;
  timestamp: string;
  settings: EchoVoiceBattlefieldActionSettings;
  context: ReturnType<typeof createBattlefieldContext>;
}): EchoVoiceBattlefieldClarificationRequest[] {
  if (!input.action.clarificationRequired) return [];
  const entityResult = input.action.target?.entityResult ?? null;
  const decision = decideClarificationForIntent({
    field: input.field,
    intent: createVoiceBattlefieldIntent(
      input.action,
      {
        version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
        id: "clarification-session",
        fieldSessionId: input.field.session.id,
        status: "staging",
        startedAt: input.timestamp,
        updatedAt: input.timestamp,
        completedAt: null,
        transcript: [input.action.originalTranscript],
        normalizedTranscript: [input.action.normalizedTranscript],
        actions: [input.action],
        preview: null,
        currentClarificationId: null,
        pipelineEventIds: [],
        recoveryReason: null,
        accessibilityAnnouncement: "",
        directBattlefieldMutation: false,
      },
      input.timestamp,
    ),
    entityResults: entityResult ? [entityResult] : [],
    transcript: input.action.originalTranscript,
    timestamp: input.timestamp,
    settings: normalizeClarificationSettings(
      input.field.settings.voice.clarification,
    ),
  });
  const candidateLabels =
    decision.prompt?.candidateLabels ??
    entityResult?.candidates.map((candidate) => candidate.label) ??
    input.context.battlefield.map((entry) => entry.label);
  return [
    {
      id: makeId("echo-battlefield-clarification"),
      actionId: input.action.id,
      type:
        input.action.counterName && !input.action.target?.groupId
          ? "target"
          : "target",
      question:
        input.action.clarificationQuestion ??
        decision.prompt?.question ??
        "Which target?",
      candidateLabels: candidateLabels.slice(0, 8),
      frameworkDecision: decision,
      createdAt: input.timestamp,
    },
  ];
}

function finalizeVoiceResult(
  before: FieldState,
  after: FieldState,
  input: {
    title: string;
    summary: string[];
    details: ResolutionStep[];
    events: GameEvent[];
    changedGroupIds: Iterable<string>;
  },
): ResolutionResult {
  return {
    field: normalizeField(after),
    title: input.title,
    summary: input.summary,
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
      replayMarkers: [],
    },
  };
}

function parseCounterAction(text: string): {
  mode: "add" | "remove";
  quantity: number;
  counterName: CounterName;
  targetText: string | null;
} | null {
  const add = text.match(
    /\b(?:put|add)\s+((?:\d+|[a-z]+)\s+)?(.+?\s+counters?)\s+(?:on|to)\s+(.+)$/,
  );
  if (add) {
    return {
      mode: "add",
      quantity: extractQuantity(add[1] ?? "") ?? 1,
      counterName: normalizeCounterName(add[2]),
      targetText: cleanObjectText(add[3]),
    };
  }
  const remove = text.match(
    /\b(?:remove|take off)\s+((?:\d+|[a-z]+)\s+)?(.+?\s+counters?)(?:\s+(?:from|off)\s+(.+))?$/,
  );
  if (remove) {
    return {
      mode: "remove",
      quantity: extractQuantity(remove[1] ?? "") ?? 1,
      counterName: normalizeCounterName(remove[2]),
      targetText: remove[3] ? cleanObjectText(remove[3]) : null,
    };
  }
  return null;
}

function parseZoneAction(text: string): {
  kind: EchoVoiceBattlefieldActionKind;
  intentKind: EchoVoiceBattlefieldAction["intentKind"];
  targetText: string | null;
  origin: Zone | null;
  destination: Zone | null;
  eventType: GameEventType;
} | null {
  const exile = text.match(/^(?:exile)\s+(.+)$/);
  if (exile) {
    return {
      kind: "permanent-exile",
      intentKind: "exile-permanent",
      targetText: cleanObjectText(exile[1]),
      origin: "battlefield",
      destination: "exile",
      eventType: "permanent-exiled",
    };
  }
  const sacrifice = text.match(/^(?:sacrifice|sac)\s+(.+)$/);
  if (sacrifice) {
    return {
      kind: "permanent-sacrifice",
      intentKind: "sacrifice-permanent",
      targetText: cleanObjectText(sacrifice[1]),
      origin: "battlefield",
      destination: "graveyard",
      eventType: "permanent-sacrificed",
    };
  }
  const destroy = text.match(/^(?:destroy|dies|died|kill)\s+(.+)$/);
  if (destroy) {
    return {
      kind: "permanent-destroy",
      intentKind: "destroy-permanent",
      targetText: cleanObjectText(destroy[1]),
      origin: "battlefield",
      destination: "graveyard",
      eventType: "permanent-died",
    };
  }
  const hand = text.match(
    /^(?:return|bounce)\s+(.+?)\s+(?:to hand|to my hand|back to hand)$/,
  );
  if (hand) {
    return {
      kind: "return-to-hand",
      intentKind: "return-permanent",
      targetText: cleanObjectText(hand[1]),
      origin: "battlefield",
      destination: "hand",
      eventType: "permanent-returned-to-hand",
    };
  }
  const battlefield = text.match(
    /^(?:return)\s+(.+?)\s+(?:to battlefield|to the battlefield)$/,
  );
  if (battlefield) {
    return {
      kind: "return-to-battlefield",
      intentKind: "return-permanent",
      targetText: cleanObjectText(battlefield[1]),
      origin: null,
      destination: "battlefield",
      eventType: "permanent-returned-to-battlefield",
    };
  }
  const remove = text.match(/^(?:remove)\s+(.+)$/);
  if (remove) {
    return {
      kind: "permanent-remove",
      intentKind: "custom",
      targetText: cleanObjectText(remove[1]),
      origin: "battlefield",
      destination: null,
      eventType: "permanent-died",
    };
  }
  return null;
}

function createVoiceEvent(
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
    metadata,
  };
}

function resultForVoiceBattlefieldSession(
  field: FieldState,
  session: EchoVoiceBattlefieldActionSession,
  preview: EchoVoiceBattlefieldPreview | null,
  intents: AmbientIntentInput[],
): EchoVoiceBattlefieldResult {
  return {
    state: upsertVoiceBattlefieldSession(
      field.voiceBattlefieldActions,
      session,
    ),
    session,
    preview,
    intents,
    pipelineResults: [],
    events: [],
  };
}

function upsertVoiceBattlefieldSession(
  state: EchoVoiceBattlefieldActionState,
  session: EchoVoiceBattlefieldActionSession,
): EchoVoiceBattlefieldActionState {
  const terminal = isTerminalSessionStatus(session.status);
  const sessions = [
    ...state.sessions.filter((entry) => entry.id !== session.id),
    session,
  ].slice(-MAX_VOICE_BATTLEFIELD_SESSIONS);
  return createDefaultVoiceBattlefieldActionState({
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
    diagnostics: createVoiceBattlefieldDiagnostics({
      activeSessionId: terminal ? null : session.id,
      lastSessionId: session.id,
      lastStatus: session.status,
      lastPreviewId: session.preview?.id ?? state.lastPreviewId,
      lastPipelineEventId: session.pipelineEventIds.at(-1) ?? null,
      lastError: session.recoveryReason,
      stagedActionCount: session.actions.length,
      clarificationCount: session.preview?.clarificationRequests.length ?? 0,
      triggerEventCount: session.actions.filter(
        (action) => action.kind === "trigger-announcement",
      ).length,
    }),
  });
}

function activeVoiceBattlefieldSession(
  state: EchoVoiceBattlefieldActionState,
): EchoVoiceBattlefieldActionSession | null {
  if (!state.activeSessionId) return null;
  return (
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    null
  );
}

function appendVoiceBattlefieldTranscript(
  session: EchoVoiceBattlefieldActionSession,
  transcript: string,
  timestamp: string,
): EchoVoiceBattlefieldActionSession {
  return {
    ...session,
    updatedAt: timestamp,
    transcript: [...session.transcript, transcript].slice(-20),
    normalizedTranscript: [
      ...session.normalizedTranscript,
      normalizeActionText(transcript),
    ].slice(-20),
  };
}

function failVoiceBattlefieldSession(
  session: EchoVoiceBattlefieldActionSession,
  reason: string,
  timestamp: string,
): EchoVoiceBattlefieldActionSession {
  return {
    ...session,
    status: "failed",
    updatedAt: timestamp,
    recoveryReason: reason,
    accessibilityAnnouncement: reason,
  };
}

function actionFragments(transcript: string): Array<{
  original: string;
  normalized: string;
}> {
  return transcript
    .replace(
      /\band\s+(?=(?:put|add|remove|create|make|gain|gained|lose|lost|tap|untap|sacrifice|sac|destroy|exile|return|draw|discard|landfall|anim|cathars|soul|warleader|my commander))/gi,
      ". ",
    )
    .split(/[,.]+|\bthen\b/gi)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((original) => ({
      original,
      normalized: normalizeActionText(original),
    }))
    .filter((entry) => entry.normalized);
}

function summarizeVoiceBattlefieldPreview(
  actions: EchoVoiceBattlefieldAction[],
): string[] {
  if (!actions.length) return ["No voice battlefield actions staged."];
  return actions.map((action) => summarizeAction(action)[0]);
}

function summarizeAction(action: EchoVoiceBattlefieldAction): string[] {
  const target = action.target?.label ? ` ${action.target.label}` : "";
  if (action.kind === "life-gain") return [`Gain ${action.quantity} life.`];
  if (action.kind === "life-loss") return [`Lose ${action.quantity} life.`];
  if (action.kind === "commander-damage")
    return [`Record ${action.quantity} commander damage.`];
  if (action.kind === "counter-add")
    return [
      `Add ${action.quantity} ${action.counterName} counter(s) to${target}.`,
    ];
  if (action.kind === "counter-remove")
    return [
      `Remove ${action.quantity} ${action.counterName} counter(s) from${target}.`,
    ];
  if (action.kind === "token-create")
    return [`Create ${action.quantity} ${action.tokenName} token(s).`];
  if (action.kind === "token-remove")
    return [`Remove ${action.quantity}${target} token(s).`];
  if (action.kind === "tap") return [`Tap${target || " selected permanents"}.`];
  if (action.kind === "untap")
    return [`Untap${action.note === "everything" ? " everything" : target}.`];
  if (action.kind === "trigger-announcement")
    return [
      `Announce ${action.triggerName ?? "trigger"} for manual resolution.`,
    ];
  if (action.kind === "return-to-hand") return [`Return${target} to hand.`];
  if (action.kind === "return-to-battlefield")
    return [`Return${target} to the battlefield.`];
  if (action.kind === "permanent-exile") return [`Exile${target}.`];
  if (action.kind === "permanent-sacrifice") return [`Sacrifice${target}.`];
  if (action.kind === "permanent-destroy") return [`Destroy${target}.`];
  if (action.kind === "permanent-create")
    return [`${action.target?.label ?? action.note ?? "Permanent"} enters.`];
  if (action.kind === "draw-cards") return [`Draw ${action.quantity} card(s).`];
  if (action.kind === "discard-cards")
    return [`Discard ${action.quantity} card(s).`];
  return [action.note ?? "Battlefield note recorded."];
}

function previewConfidence(
  actions: EchoVoiceBattlefieldAction[],
  timestamp: string,
): AmbientConfidenceAssessment {
  if (!actions.length) {
    return voiceBattlefieldConfidence({
      level: "low",
      score: 0.2,
      timestamp,
      reasons: ["No gameplay actions were recognized."],
    });
  }
  const hasLow = actions.some(
    (action) =>
      action.clarificationRequired ||
      action.confidence.level === "low" ||
      action.confidence.level === "unknown",
  );
  return voiceBattlefieldConfidence({
    level: hasLow ? "low" : "high",
    score: hasLow ? 0.38 : 0.92,
    timestamp,
    reasons: [
      hasLow
        ? "One or more voice battlefield actions need clarification."
        : "Voice battlefield actions are ready for preview confirmation.",
    ],
  });
}

function voiceBattlefieldConfidence(input: {
  level: AmbientConfidenceLevel;
  score: number | null;
  timestamp: string;
  reasons: string[];
}): AmbientConfidenceAssessment {
  return normalizeAmbientConfidence(
    {
      level: input.level,
      score: input.score,
      reasons: input.reasons,
      source: "voice-command",
      assessedAt: input.timestamp || DEFAULT_CONFIDENCE_TIMESTAMP,
      validation: {
        contextValid: true,
        rulesValid: true,
        warningCount: input.level === "high" ? 0 : 1,
      },
    },
    {
      source: "voice-command",
      timestamp: input.timestamp || DEFAULT_CONFIDENCE_TIMESTAMP,
    },
  );
}

function normalizeVoiceBattlefieldSession(
  value: unknown,
  options: { timestamp?: string; knownGroupIds: Set<string> },
): EchoVoiceBattlefieldActionSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoVoiceBattlefieldActionSession>;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.map((action, index) =>
        normalizeVoiceBattlefieldAction(
          {
            ...(action as Partial<EchoVoiceBattlefieldAction>),
            order:
              typeof (action as Partial<EchoVoiceBattlefieldAction>).order ===
              "number"
                ? (action as Partial<EchoVoiceBattlefieldAction>).order
                : index,
          },
          { timestamp, knownGroupIds: options.knownGroupIds },
        ),
      )
    : [];
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-battlefield-actions"),
    fieldSessionId:
      typeof candidate.fieldSessionId === "string"
        ? candidate.fieldSessionId
        : null,
    status: normalizeSessionStatus(candidate.status),
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    completedAt:
      typeof candidate.completedAt === "string" ? candidate.completedAt : null,
    transcript: Array.isArray(candidate.transcript)
      ? candidate.transcript
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-20)
      : [],
    normalizedTranscript: Array.isArray(candidate.normalizedTranscript)
      ? candidate.normalizedTranscript
          .filter((entry): entry is string => typeof entry === "string")
          .map(normalizeActionText)
          .slice(-20)
      : [],
    actions,
    preview: normalizePreview(candidate.preview, {
      timestamp,
      knownGroupIds: options.knownGroupIds,
    }),
    currentClarificationId:
      typeof candidate.currentClarificationId === "string"
        ? candidate.currentClarificationId
        : null,
    pipelineEventIds: Array.isArray(candidate.pipelineEventIds)
      ? candidate.pipelineEventIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    recoveryReason:
      typeof candidate.recoveryReason === "string"
        ? candidate.recoveryReason
        : null,
    accessibilityAnnouncement:
      typeof candidate.accessibilityAnnouncement === "string"
        ? candidate.accessibilityAnnouncement
        : "",
    directBattlefieldMutation: false,
  };
}

function normalizeVoiceBattlefieldAction(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string> },
): EchoVoiceBattlefieldAction {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<EchoVoiceBattlefieldAction>)
      : {};
  const target = normalizeActionEntity(candidate.target, options.knownGroupIds);
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-battlefield-action"),
    order:
      typeof candidate.order === "number" && Number.isFinite(candidate.order)
        ? candidate.order
        : 0,
    kind: normalizeActionKind(candidate.kind),
    status: normalizeActionStatus(candidate.status),
    intentKind: candidate.intentKind ?? "custom",
    originalTranscript:
      typeof candidate.originalTranscript === "string"
        ? candidate.originalTranscript.slice(0, 240)
        : "",
    normalizedTranscript:
      typeof candidate.normalizedTranscript === "string"
        ? normalizeActionText(candidate.normalizedTranscript)
        : "",
    quantity: clampCount(candidate.quantity, 0, 999, 1),
    counterName:
      typeof candidate.counterName === "string"
        ? normalizeCounterName(candidate.counterName)
        : null,
    tokenName:
      typeof candidate.tokenName === "string"
        ? candidate.tokenName.slice(0, 80)
        : null,
    tokenPower:
      typeof candidate.tokenPower === "number" &&
      Number.isFinite(candidate.tokenPower)
        ? candidate.tokenPower
        : null,
    tokenToughness:
      typeof candidate.tokenToughness === "number" &&
      Number.isFinite(candidate.tokenToughness)
        ? candidate.tokenToughness
        : null,
    zoneOrigin: normalizeZone(candidate.zoneOrigin),
    zoneDestination: normalizeZone(candidate.zoneDestination),
    target,
    triggerName:
      typeof candidate.triggerName === "string"
        ? candidate.triggerName.slice(0, 120)
        : null,
    note:
      typeof candidate.note === "string" ? candidate.note.slice(0, 240) : null,
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "low", {
      source: "voice-command",
      timestamp: options.timestamp,
    }),
    clarificationRequired: Boolean(candidate.clarificationRequired),
    clarificationQuestion:
      typeof candidate.clarificationQuestion === "string"
        ? candidate.clarificationQuestion.slice(0, 120)
        : null,
    generatedEventType: normalizeGameEventType(candidate.generatedEventType),
    directBattlefieldMutation: false,
  };
}

function normalizeActionEntity(
  value: unknown,
  knownGroupIds: Set<string>,
): EchoVoiceBattlefieldActionEntity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoVoiceBattlefieldActionEntity>;
  const groupId =
    typeof candidate.groupId === "string" &&
    (!knownGroupIds.size || knownGroupIds.has(candidate.groupId))
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
        ? candidate.label.slice(0, 120)
        : null,
    sourceText:
      typeof candidate.sourceText === "string"
        ? candidate.sourceText.slice(0, 120)
        : null,
    owner:
      candidate.owner === "opponent"
        ? "opponent"
        : candidate.owner === "you"
          ? "you"
          : null,
    zone: normalizeZone(candidate.zone),
    entityResult: null,
  };
}

function normalizePreview(
  value: unknown,
  options: { timestamp: string; knownGroupIds: Set<string> },
): EchoVoiceBattlefieldPreview | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoVoiceBattlefieldPreview>;
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.map((action) =>
        normalizeVoiceBattlefieldAction(action, options),
      )
    : [];
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-battlefield-preview"),
    sessionId:
      typeof candidate.sessionId === "string" ? candidate.sessionId : "",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.timestamp,
    actions,
    summary: Array.isArray(candidate.summary)
      ? candidate.summary.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : summarizeVoiceBattlefieldPreview(actions),
    confirmedActionCount: clampCount(candidate.confirmedActionCount, 0, 999, 0),
    pendingClarificationCount: clampCount(
      candidate.pendingClarificationCount,
      0,
      999,
      0,
    ),
    rejectedActionCount: clampCount(candidate.rejectedActionCount, 0, 999, 0),
    lowConfidenceActionCount: clampCount(
      candidate.lowConfidenceActionCount,
      0,
      999,
      0,
    ),
    clarificationRequests: [],
    confidence: normalizeAmbientConfidence(candidate.confidence ?? "low", {
      source: "voice-command",
      timestamp: options.timestamp,
    }),
    directBattlefieldMutation: false,
  };
}

function createVoiceBattlefieldDiagnostics(
  input: Partial<EchoVoiceBattlefieldActionDiagnostics> | null | undefined,
): EchoVoiceBattlefieldActionDiagnostics {
  return {
    version: ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION,
    activeSessionId: input?.activeSessionId ?? null,
    lastSessionId: input?.lastSessionId ?? null,
    lastStatus: input?.lastStatus ?? null,
    lastPreviewId: input?.lastPreviewId ?? null,
    lastPipelineEventId: input?.lastPipelineEventId ?? null,
    lastError: input?.lastError ?? null,
    stagedActionCount: input?.stagedActionCount ?? 0,
    clarificationCount: input?.clarificationCount ?? 0,
    triggerEventCount: input?.triggerEventCount ?? 0,
    directBattlefieldMutation: false,
  };
}

function normalizeSessionStatus(
  value: unknown,
): EchoVoiceBattlefieldActionSessionStatus {
  return value === "idle" ||
    value === "staging" ||
    value === "awaitingClarification" ||
    value === "previewReady" ||
    value === "committing" ||
    value === "committed" ||
    value === "cancelled" ||
    value === "recovered" ||
    value === "failed"
    ? value
    : "recovered";
}

function normalizeActionKind(value: unknown): EchoVoiceBattlefieldActionKind {
  return value === "life-gain" ||
    value === "life-loss" ||
    value === "commander-damage" ||
    value === "counter-add" ||
    value === "counter-remove" ||
    value === "token-create" ||
    value === "token-remove" ||
    value === "permanent-create" ||
    value === "permanent-remove" ||
    value === "permanent-destroy" ||
    value === "permanent-sacrifice" ||
    value === "permanent-exile" ||
    value === "return-to-battlefield" ||
    value === "return-to-hand" ||
    value === "tap" ||
    value === "untap" ||
    value === "trigger-announcement" ||
    value === "reminder" ||
    value === "battlefield-note" ||
    value === "draw-cards" ||
    value === "discard-cards"
    ? value
    : "battlefield-note";
}

function normalizeActionStatus(
  value: unknown,
): EchoVoiceBattlefieldAction["status"] {
  return value === "staged" ||
    value === "pendingClarification" ||
    value === "previewReady" ||
    value === "committed" ||
    value === "skipped" ||
    value === "cancelled" ||
    value === "rejected" ||
    value === "recovered"
    ? value
    : "recovered";
}

function normalizeZone(value: unknown): Zone | null {
  return value === "battlefield" ||
    value === "hand" ||
    value === "graveyard" ||
    value === "exile" ||
    value === "library" ||
    value === "command"
    ? value
    : null;
}

function normalizeGameEventType(value: unknown): GameEventType | null {
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
    value === "cards-drawn" ||
    value === "cards-discarded" ||
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

function isTerminalSessionStatus(
  status: EchoVoiceBattlefieldActionSessionStatus,
): boolean {
  return (
    status === "committed" ||
    status === "cancelled" ||
    status === "recovered" ||
    status === "failed"
  );
}

function actionRequiresTarget(kind: EchoVoiceBattlefieldActionKind): boolean {
  return (
    kind === "counter-add" ||
    kind === "counter-remove" ||
    kind === "token-remove" ||
    kind === "permanent-remove" ||
    kind === "permanent-destroy" ||
    kind === "permanent-sacrifice" ||
    kind === "permanent-exile" ||
    kind === "return-to-hand" ||
    kind === "return-to-battlefield" ||
    kind === "tap" ||
    kind === "untap"
  );
}

function targetQuestionForKind(kind: EchoVoiceBattlefieldActionKind): string {
  if (kind === "counter-add" || kind === "counter-remove")
    return "Which permanent?";
  if (kind === "token-remove") return "Which token?";
  if (kind === "tap" || kind === "untap") return "Which permanent?";
  return "Which object?";
}

function normalizeCounterName(value: string): CounterName {
  const text = normalizeActionText(value)
    .replace(/\bcounters?\b/g, "")
    .replace(/\bplus one plus one\b/g, "+1/+1")
    .trim();
  if (text.includes("+1/+1") || text.includes("1/1")) return "+1/+1";
  if (text.includes("-1/-1")) return "-1/-1";
  if (text.includes("shield")) return "Shield";
  if (text.includes("stun")) return "Stun";
  if (text.includes("loyalty")) return "Loyalty";
  if (text.includes("charge")) return "Charge";
  if (text.includes("poison")) return "Poison";
  if (text.includes("experience")) return "Experience";
  return titleCase(text || "Counter");
}

function isTriggerAnnouncement(text: string): boolean {
  return (
    /\btriggers?\b/.test(text) ||
    KNOWN_TRIGGER_NAMES.some(
      (trigger) => text === trigger || text.includes(`${trigger} trigger`),
    )
  );
}

function extractQuantity(text: string): number | null {
  const digit = text.match(/\b(\d{1,3})\b/);
  if (digit) return Number.parseInt(digit[1], 10);
  for (const [word, value] of NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

function stripRevisionWords(text: string): string {
  return text
    .replace(/\b(no|actually|only|instead|remove|skip|not|that)\b/g, "")
    .trim();
}

function findRevisionTarget(
  actions: EchoVoiceBattlefieldAction[],
  text: string,
): EchoVoiceBattlefieldAction | null {
  if (!actions.length) return null;
  const normalized = normalizeActionText(text);
  return (
    [...actions].reverse().find((action) => {
      const haystack = normalizeActionText(
        [
          action.tokenName,
          action.counterName,
          action.target?.label,
          action.triggerName,
          action.note,
          action.kind,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return normalized ? haystack.includes(normalized) : true;
    }) ??
    actions.at(-1) ??
    null
  );
}

function cleanObjectText(value: string): string {
  return value
    .replace(/^(my|the|that|this)\s+/, "")
    .replace(/\b(tokens?|permanents?|cards?)$/g, "")
    .trim();
}

function singularize(value: string): string {
  return value
    .replace(
      /\b(all|both|the|my|two|three|four|five|six|seven|eight|nine|ten)\b/g,
      "",
    )
    .replace(/\b\d+\b/g, "")
    .trim()
    .replace(/ies$/g, "y")
    .replace(/s$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeActionText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/['`]/g, "")
    .replace(/[^a-zA-Z0-9+/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function clampCount(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}
