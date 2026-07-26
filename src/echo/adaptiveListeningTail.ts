import type { FieldState } from "../domain/types";
import { makeId } from "../domain/cards";
import {
  AmbientEventPipeline,
  ambientEventPipeline,
} from "./ambientEventPipeline";
import type { AmbientPipelineResult } from "./ambientEventTypes";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import { getActiveListeningWindow } from "./contextualListening";
import { recognizeMagicCommandInWindow } from "./contextualListening";
import { createEntityResolutionAmbientResolver } from "./entityResolution";
import type {
  EchoListeningWindow,
  EchoWindowedMagicCommandResult,
} from "./contextualListeningTypes";
import { ECHO_CONTEXTUAL_LISTENING_VERSION } from "./contextualListeningTypes";
import {
  createDefaultMagicCommandGrammarSettings,
  magicCommandResultToAmbientIntent,
  normalizeMagicCommandGrammarSettings,
} from "./magicCommandGrammar";
import { ECHO_MAGIC_COMMAND_GRAMMAR_VERSION } from "./magicCommandGrammarTypes";
import type { EchoMagicCommandGrammarSettings } from "./magicCommandGrammarTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";
import type {
  EchoAdaptiveCommandBoundaryReason,
  EchoAdaptiveListeningCaptureInput,
  EchoAdaptiveListeningCaptureResult,
  EchoAdaptiveListeningCommand,
  EchoAdaptiveListeningCommandStatus,
  EchoAdaptiveListeningFeedbackState,
  EchoAdaptiveListeningFinalization,
  EchoAdaptiveListeningFinalizationReason,
  EchoAdaptiveListeningSegmentStatus,
  EchoAdaptiveListeningSession,
  EchoAdaptiveListeningTailDiagnostics,
  EchoAdaptiveListeningTailSettings,
  EchoAdaptiveListeningTailState,
  EchoAdaptiveListeningTailStatus,
  EchoAdaptiveListeningTailSensitivity,
  EchoAdaptiveListeningTranscriptSegment,
} from "./adaptiveListeningTailTypes";
import { ECHO_ADAPTIVE_LISTENING_TAIL_VERSION } from "./adaptiveListeningTailTypes";

const DEFAULT_TAIL_DURATION_MS = 3_000;
const DEFAULT_SESSION_TIMEOUT_MS = 30_000;
const MIN_TAIL_DURATION_MS = 1_000;
const MAX_TAIL_DURATION_MS = 9_000;
const MIN_SESSION_TIMEOUT_MS = 8_000;
const MAX_SESSION_TIMEOUT_MS = 90_000;
const MAX_SESSIONS_TO_RESTORE = 6;
const MAX_SEGMENTS_PER_SESSION = 48;
const MAX_COMMANDS_PER_SESSION = 24;
const TERMINAL_SESSION_STATUSES = new Set<EchoAdaptiveListeningTailStatus>([
  "finalized",
  "cancelled",
  "interrupted",
  "failed",
]);
const EXPLICIT_FINALIZATION_INTENTS = new Set(["end-turn", "pass-priority"]);
const COMMAND_START_WORDS = [
  "play",
  "drop",
  "cast",
  "attack",
  "swing",
  "block",
  "create",
  "make",
  "put",
  "add",
  "remove",
  "draw",
  "discard",
  "tap",
  "untap",
  "sacrifice",
  "sac",
  "destroy",
  "kill",
  "exile",
  "return",
  "bounce",
  "pass",
  "end",
  "hold",
  "activate",
  "equip",
  "attach",
  "transform",
  "flip",
  "explore",
  "surveil",
  "mill",
] as const;

export function createDefaultAdaptiveListeningTailSettings(
  overrides: Partial<EchoAdaptiveListeningTailSettings> = {},
): EchoAdaptiveListeningTailSettings {
  return normalizeAdaptiveListeningTailSettings({
    version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
    enabled: false,
    tailDurationMs: DEFAULT_TAIL_DURATION_MS,
    sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
    sensitivity: "balanced",
    automaticFinalization: true,
    duplicateSuppressionEnabled: true,
    accessibilityAnnouncementsPrepared: true,
    adjustableTimeoutsPrepared: true,
    lastResetAt: null,
    ...overrides,
  });
}

export function normalizeAdaptiveListeningTailSettings(
  value: unknown,
): EchoAdaptiveListeningTailSettings {
  const defaults: EchoAdaptiveListeningTailSettings = {
    version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
    enabled: false,
    tailDurationMs: DEFAULT_TAIL_DURATION_MS,
    sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
    sensitivity: "balanced",
    automaticFinalization: true,
    duplicateSuppressionEnabled: true,
    accessibilityAnnouncementsPrepared: true,
    adjustableTimeoutsPrepared: true,
    lastResetAt: null,
  };
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoAdaptiveListeningTailSettings>;
  return {
    ...defaults,
    enabled: Boolean(candidate.enabled),
    tailDurationMs: clampMilliseconds(
      candidate.tailDurationMs,
      DEFAULT_TAIL_DURATION_MS,
      MIN_TAIL_DURATION_MS,
      MAX_TAIL_DURATION_MS,
    ),
    sessionTimeoutMs: clampMilliseconds(
      candidate.sessionTimeoutMs,
      DEFAULT_SESSION_TIMEOUT_MS,
      MIN_SESSION_TIMEOUT_MS,
      MAX_SESSION_TIMEOUT_MS,
    ),
    sensitivity: normalizeSensitivity(candidate.sensitivity),
    automaticFinalization:
      typeof candidate.automaticFinalization === "boolean"
        ? candidate.automaticFinalization
        : true,
    duplicateSuppressionEnabled:
      typeof candidate.duplicateSuppressionEnabled === "boolean"
        ? candidate.duplicateSuppressionEnabled
        : true,
    accessibilityAnnouncementsPrepared: true,
    adjustableTimeoutsPrepared: true,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultAdaptiveListeningTailState(
  options: { timestamp?: string } = {},
): EchoAdaptiveListeningTailState {
  return withDiagnostics(
    {
      version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
      activeSessionId: null,
      sessions: [],
      lastFinalizedSessionId: null,
      lastCancelledSessionId: null,
      duplicateSuppressionCount: 0,
      feedback: createFeedback("hidden", options.timestamp ?? null),
      diagnostics: createDiagnostics({
        state: null,
        settings: createDefaultAdaptiveListeningTailSettings(),
        timersActive: false,
      }),
    },
    createDefaultAdaptiveListeningTailSettings(),
  );
}

export function normalizeAdaptiveListeningTailState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    settings?: EchoAdaptiveListeningTailSettings;
    sessionId?: string | null;
    preserveActiveSession?: boolean;
  },
): EchoAdaptiveListeningTailState {
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const defaults = createDefaultAdaptiveListeningTailState({
    timestamp: options.fallbackTimestamp,
  });
  if (!value || typeof value !== "object") {
    return withDiagnostics(defaults, settings);
  }
  const candidate = value as Partial<EchoAdaptiveListeningTailState>;
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((entry) =>
          normalizeAdaptiveListeningSession(entry, {
            fallbackTimestamp: options.fallbackTimestamp,
            sessionId: options.sessionId ?? null,
            settings,
          }),
        )
        .filter((entry): entry is EchoAdaptiveListeningSession =>
          Boolean(entry),
        )
    : [];
  const safeSessions = pruneSessions(
    sessions.map((session) =>
      !options.preserveActiveSession && isUnsafeRestoredStatus(session.status)
        ? finalizeSession(session, {
            reason: "application-lifecycle",
            timestamp: options.fallbackTimestamp,
          })
        : session,
    ),
  );
  const activeSessionId =
    typeof candidate.activeSessionId === "string" &&
    safeSessions.some(
      (entry) =>
        entry.id === candidate.activeSessionId &&
        !TERMINAL_SESSION_STATUSES.has(entry.status),
    )
      ? candidate.activeSessionId
      : null;

  return withDiagnostics(
    {
      ...defaults,
      activeSessionId,
      sessions: safeSessions,
      lastFinalizedSessionId: sanitizeNullableText(
        candidate.lastFinalizedSessionId,
      ),
      lastCancelledSessionId: sanitizeNullableText(
        candidate.lastCancelledSessionId,
      ),
      duplicateSuppressionCount: clampCount(
        candidate.duplicateSuppressionCount,
        0,
        0,
        100_000,
      ),
      feedback: normalizeFeedback(
        candidate.feedback,
        options.fallbackTimestamp,
      ),
    },
    settings,
  );
}

export function startAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    field: FieldState;
    window?: EchoListeningWindow | null;
    settings?: EchoAdaptiveListeningTailSettings;
    timestamp?: string;
  },
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const normalized = normalizeAdaptiveListeningTailState(state, {
    fallbackTimestamp: timestamp,
    sessionId: options.field.session.id,
    settings,
    preserveActiveSession: true,
  });
  const active = getActiveAdaptiveListeningSession(normalized);
  if (active && !TERMINAL_SESSION_STATUSES.has(active.status)) {
    return withDiagnostics(
      {
        ...normalized,
        feedback: createFeedback("listening", timestamp),
      },
      settings,
    );
  }
  const window =
    options.window ??
    getActiveListeningWindow(options.field.contextualListening);
  const session: EchoAdaptiveListeningSession = {
    version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
    id: makeId("adaptive-listening-session"),
    sessionId: options.field.session.id,
    status: "capturing",
    ambientMode: options.field.ambient.currentMode,
    windowId: window?.id ?? null,
    windowKind: window?.kind ?? null,
    startedAt: timestamp,
    updatedAt: timestamp,
    lastRelevantSpeechAt: null,
    finalizeAfter: null,
    hardExpiresAt: addMilliseconds(timestamp, settings.sessionTimeoutMs),
    transcriptSegments: [],
    commands: [],
    duplicateFingerprints: [],
    finalization: null,
    lastError: null,
  };
  return withDiagnostics(
    {
      ...normalized,
      activeSessionId: session.id,
      sessions: pruneSessions([...normalized.sessions, session]),
      feedback: createFeedback("listening", timestamp),
    },
    settings,
  );
}

export function captureAdaptiveListeningTranscript(
  state: EchoAdaptiveListeningTailState,
  input: EchoAdaptiveListeningCaptureInput,
): EchoAdaptiveListeningCaptureResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(input.settings);
  const field = input.field;
  const window =
    input.windowState === null
      ? null
      : getActiveListeningWindow(
          input.windowState ?? field.contextualListening,
        );
  let nextState = startAdaptiveListeningSession(state, {
    field,
    window,
    settings,
    timestamp,
  });
  let session = getActiveAdaptiveListeningSession(nextState);
  if (!session) {
    nextState = withDiagnostics(
      {
        ...nextState,
        feedback: createFeedback("failed", timestamp),
      },
      settings,
    );
    return {
      state: nextState,
      acceptedCommands: [],
      duplicateCommands: [],
      rejectedSegments: [],
      finalization: null,
    };
  }

  if (!settings.enabled) {
    const failed = {
      ...session,
      status: "failed" as const,
      updatedAt: timestamp,
      lastError: "Adaptive listening tail is disabled.",
    };
    nextState = replaceSession(nextState, failed, {
      activeSessionId: null,
      feedback: createFeedback("failed", timestamp),
      settings,
    });
    return {
      state: nextState,
      acceptedCommands: [],
      duplicateCommands: [],
      rejectedSegments: [],
      finalization: null,
    };
  }

  const grammarSettings = normalizeMagicCommandGrammarSettings(
    input.grammarSettings ??
      createDefaultMagicCommandGrammarSettings({
        enabled: true,
        requireVerifiedSpeaker: true,
      }),
  );
  const fragments = splitTranscriptIntoCommandPhrases(input.transcript);
  const acceptedCommands: EchoAdaptiveListeningCommand[] = [];
  const duplicateCommands: EchoAdaptiveListeningCommand[] = [];
  const rejectedSegments: EchoAdaptiveListeningTranscriptSegment[] = [];
  const segments: EchoAdaptiveListeningTranscriptSegment[] = [];
  let explicitFinalization = false;
  let commandIndex = session.commands.length;
  const fingerprints = new Set(session.duplicateFingerprints);
  const priorCommandPhrases = new Set(
    session.commands.map((command) => command.normalizedTranscript),
  );

  for (const fragment of fragments) {
    const result = safelyRecognizeWindowedCommand({
      transcript: fragment.transcript,
      field,
      speakerVerification: input.speakerVerification,
      settings: grammarSettings,
      timestamp,
      window,
    });
    const fingerprint = fingerprintForWindowedResult(result);
    const duplicate =
      settings.duplicateSuppressionEnabled &&
      (fingerprints.has(fingerprint) ||
        priorCommandPhrases.has(fragment.normalizedTranscript));
    const commandStatus = commandStatusForResult(result, duplicate);
    const command =
      result.accepted || duplicate
        ? createCommand({
            result,
            fragment,
            timestamp,
            order: commandIndex,
            fingerprint,
            status: commandStatus,
          })
        : null;
    if (command) {
      commandIndex += 1;
      if (duplicate) {
        duplicateCommands.push(command);
      } else {
        fingerprints.add(fingerprint);
        priorCommandPhrases.add(command.normalizedTranscript);
        acceptedCommands.push(command);
      }
    }
    const segment = createSegment({
      result,
      fragment,
      command,
      timestamp,
      duplicate,
    });
    segments.push(segment);
    if (!command || command.status === "rejected") {
      rejectedSegments.push(segment);
    }
    if (
      !duplicate &&
      result.accepted &&
      result.grammar.intentKind &&
      EXPLICIT_FINALIZATION_INTENTS.has(result.grammar.intentKind)
    ) {
      explicitFinalization = true;
    }
  }

  session = {
    ...session,
    status: acceptedCommands.length > 0 ? "waitingForTail" : "capturing",
    updatedAt: timestamp,
    lastRelevantSpeechAt:
      acceptedCommands.length > 0 ? timestamp : session.lastRelevantSpeechAt,
    finalizeAfter:
      acceptedCommands.length > 0
        ? addMilliseconds(timestamp, tailDurationForSettings(settings, window))
        : session.finalizeAfter,
    transcriptSegments: pruneSegments([
      ...session.transcriptSegments,
      ...segments,
    ]),
    commands: pruneCommands([...session.commands, ...acceptedCommands]),
    duplicateFingerprints: [...fingerprints].slice(-MAX_COMMANDS_PER_SESSION),
    lastError:
      rejectedSegments.at(-1)?.status === "failed"
        ? "Magic command parser failed during adaptive listening."
        : null,
  };
  nextState = replaceSession(nextState, session, {
    activeSessionId: session.id,
    feedback: createFeedback(
      acceptedCommands.length > 0 ? "waitingForAdditionalInput" : "recognizing",
      timestamp,
    ),
    duplicateIncrement: duplicateCommands.length,
    settings,
  });

  if (explicitFinalization && settings.automaticFinalization) {
    nextState = finalizeAdaptiveListeningSession(nextState, {
      reason: "explicit-command",
      timestamp,
      settings,
    }).state;
  } else {
    nextState = finalizeExpiredAdaptiveListeningSession(nextState, {
      timestamp,
      settings,
    });
  }

  const finalSession = getSessionById(nextState, session.id);
  return {
    state: nextState,
    acceptedCommands,
    duplicateCommands,
    rejectedSegments,
    finalization: finalSession?.finalization ?? null,
  };
}

export function finalizeExpiredAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    timestamp?: string;
    settings?: EchoAdaptiveListeningTailSettings;
  } = {},
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const active = getActiveAdaptiveListeningSession(state);
  if (!active || TERMINAL_SESSION_STATUSES.has(active.status)) {
    return withDiagnostics(state, settings);
  }
  if (active.hardExpiresAt && timestamp >= active.hardExpiresAt) {
    return finalizeAdaptiveListeningSession(state, {
      timestamp,
      reason: "session-timeout",
      settings,
    }).state;
  }
  if (
    settings.automaticFinalization &&
    active.finalizeAfter &&
    timestamp >= active.finalizeAfter
  ) {
    return finalizeAdaptiveListeningSession(state, {
      timestamp,
      reason: "natural-timeout",
      settings,
    }).state;
  }
  return withDiagnostics(state, settings);
}

export function finalizeAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    timestamp?: string;
    reason?: EchoAdaptiveListeningFinalizationReason;
    settings?: EchoAdaptiveListeningTailSettings;
  } = {},
): {
  state: EchoAdaptiveListeningTailState;
  finalization: EchoAdaptiveListeningFinalization | null;
} {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const active = getActiveAdaptiveListeningSession(state);
  if (!active) {
    return { state: withDiagnostics(state, settings), finalization: null };
  }
  const final = finalizeSession(active, {
    timestamp,
    reason: options.reason ?? "natural-timeout",
  });
  const nextState = replaceSession(state, final, {
    activeSessionId: null,
    lastFinalizedSessionId: final.id,
    feedback: createFeedback("complete", timestamp),
    settings,
  });
  return { state: nextState, finalization: final.finalization };
}

export function cancelAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    timestamp?: string;
    reason?: EchoAdaptiveListeningFinalizationReason;
    settings?: EchoAdaptiveListeningTailSettings;
  } = {},
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const active = getActiveAdaptiveListeningSession(state);
  if (!active) return withDiagnostics(state, settings);
  const cancelled: EchoAdaptiveListeningSession = {
    ...active,
    status: "cancelled",
    updatedAt: timestamp,
    finalization: {
      reason: options.reason ?? "manual-cancellation",
      finalizedAt: timestamp,
      commandCount: 0,
      publishedIntentIds: [],
      accessibilityAnnouncement: "Adaptive listening session cancelled.",
    },
  };
  return replaceSession(state, cancelled, {
    activeSessionId: null,
    lastCancelledSessionId: active.id,
    feedback: createFeedback("cancelled", timestamp),
    settings,
  });
}

export function interruptAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    timestamp?: string;
    reason?: EchoAdaptiveListeningFinalizationReason;
    error?: string;
    settings?: EchoAdaptiveListeningTailSettings;
  } = {},
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const active = getActiveAdaptiveListeningSession(state);
  if (!active) return withDiagnostics(state, settings);
  const interrupted: EchoAdaptiveListeningSession = {
    ...active,
    status: "interrupted",
    updatedAt: timestamp,
    finalization: {
      reason: options.reason ?? "session-interruption",
      finalizedAt: timestamp,
      commandCount: 0,
      publishedIntentIds: [],
      accessibilityAnnouncement: "Adaptive listening session interrupted.",
    },
    lastError: options.error ?? null,
  };
  return replaceSession(state, interrupted, {
    activeSessionId: null,
    feedback: createFeedback(options.error ? "failed" : "cancelled", timestamp),
    settings,
  });
}

export function recoverAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
  options: {
    field: FieldState;
    timestamp?: string;
    settings?: EchoAdaptiveListeningTailSettings;
  },
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const interrupted = [...state.sessions]
    .reverse()
    .find((session) => session.status === "interrupted");
  if (!interrupted) {
    return startAdaptiveListeningSession(state, {
      field: options.field,
      settings: options.settings,
      timestamp,
    });
  }
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const recovered: EchoAdaptiveListeningSession = {
    ...interrupted,
    status: "recovered",
    updatedAt: timestamp,
    lastError: null,
  };
  return replaceSession(state, recovered, {
    activeSessionId: null,
    feedback: createFeedback("complete", timestamp),
    settings,
  });
}

export function syncAdaptiveListeningTailWithAmbientMode(
  state: EchoAdaptiveListeningTailState,
  options: {
    ambientMode: FieldState["ambient"]["currentMode"];
    timestamp?: string;
    settings?: EchoAdaptiveListeningTailSettings;
  },
): EchoAdaptiveListeningTailState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeAdaptiveListeningTailSettings(options.settings);
  const active = getActiveAdaptiveListeningSession(state);
  if (!active) return withDiagnostics(state, settings);
  if (options.ambientMode === "recovery") {
    return interruptAdaptiveListeningSession(state, {
      timestamp,
      reason: "recovery",
      settings,
    });
  }
  if (active.ambientMode !== options.ambientMode) {
    return finalizeAdaptiveListeningSession(state, {
      timestamp,
      reason: "ambient-mode-transition",
      settings,
    }).state;
  }
  return withDiagnostics(state, settings);
}

export function publishAdaptiveListeningFinalizationToPipeline(input: {
  field: FieldState;
  finalization: EchoAdaptiveListeningFinalization | null;
  session: EchoAdaptiveListeningSession | null;
  pipeline?: AmbientEventPipeline;
  timestamp?: string;
}): AmbientPipelineResult[] {
  if (!input.finalization || !input.session) return [];
  const pipeline = input.pipeline ?? ambientEventPipeline;
  return input.session.commands
    .filter((command) =>
      input.finalization!.publishedIntentIds.includes(command.intent?.id ?? ""),
    )
    .map((command) =>
      pipeline.process({
        field: input.field,
        intent: command.intent!,
        approval: { method: "manual" },
        resolver: createEntityResolutionAmbientResolver({
          settings: input.field.settings.voice.entityResolution,
        }),
        timestamp: input.timestamp ?? input.finalization!.finalizedAt,
      }),
    );
}

export function getActiveAdaptiveListeningSession(
  state: EchoAdaptiveListeningTailState,
): EchoAdaptiveListeningSession | null {
  if (!state.activeSessionId) return null;
  return getSessionById(state, state.activeSessionId);
}

export function getAdaptiveListeningTailDiagnostics(
  state: EchoAdaptiveListeningTailState,
  settings?: EchoAdaptiveListeningTailSettings,
  options: { timersActive?: boolean } = {},
): EchoAdaptiveListeningTailDiagnostics {
  return createDiagnostics({
    state,
    settings: normalizeAdaptiveListeningTailSettings(settings),
    timersActive: Boolean(options.timersActive),
  });
}

export class EchoAdaptiveListeningTailManager {
  private state: EchoAdaptiveListeningTailState;
  private settings: EchoAdaptiveListeningTailSettings;
  private listeners = new Set<
    (state: EchoAdaptiveListeningTailState) => void
  >();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private context: {
    field: FieldState;
    speakerVerification: EchoSpeakerVerificationResult | null;
    grammarSettings: EchoMagicCommandGrammarSettings;
  } | null = null;
  private readonly onFinalize:
    | ((
        finalization: EchoAdaptiveListeningFinalization,
        state: EchoAdaptiveListeningTailState,
      ) => void)
    | null;

  constructor(
    state: unknown = undefined,
    settings: unknown = undefined,
    options: {
      timestamp?: string;
      sessionId?: string | null;
      onFinalize?: (
        finalization: EchoAdaptiveListeningFinalization,
        state: EchoAdaptiveListeningTailState,
      ) => void;
    } = {},
  ) {
    this.settings = normalizeAdaptiveListeningTailSettings(settings);
    this.state = normalizeAdaptiveListeningTailState(state, {
      fallbackTimestamp: options.timestamp ?? new Date().toISOString(),
      sessionId: options.sessionId ?? null,
      settings: this.settings,
    });
    this.onFinalize = options.onFinalize ?? null;
  }

  hydrate(
    state: unknown,
    settings: unknown,
    options: { timestamp?: string; sessionId?: string | null } = {},
  ): EchoAdaptiveListeningTailState {
    this.clearTimer();
    this.settings = normalizeAdaptiveListeningTailSettings(settings);
    this.state = normalizeAdaptiveListeningTailState(state, {
      fallbackTimestamp: options.timestamp ?? new Date().toISOString(),
      sessionId: options.sessionId ?? null,
      settings: this.settings,
    });
    this.emit();
    return this.getState();
  }

  getState(): EchoAdaptiveListeningTailState {
    return structuredClone(this.state);
  }

  getSettings(): EchoAdaptiveListeningTailSettings {
    return { ...this.settings };
  }

  updateSettings(
    settings: Partial<EchoAdaptiveListeningTailSettings>,
  ): EchoAdaptiveListeningTailSettings {
    this.settings = normalizeAdaptiveListeningTailSettings({
      ...this.settings,
      ...settings,
    });
    this.scheduleTimer();
    this.emit();
    return this.getSettings();
  }

  subscribe(
    listener: (state: EchoAdaptiveListeningTailState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(input: {
    field: FieldState;
    speakerVerification?: EchoSpeakerVerificationResult | null;
    grammarSettings?: EchoMagicCommandGrammarSettings;
    timestamp?: string;
  }): EchoAdaptiveListeningTailState {
    this.context = {
      field: input.field,
      speakerVerification: input.speakerVerification ?? null,
      grammarSettings:
        input.grammarSettings ??
        createDefaultMagicCommandGrammarSettings({ enabled: true }),
    };
    this.state = startAdaptiveListeningSession(this.state, {
      field: input.field,
      settings: this.settings,
      timestamp: input.timestamp,
    });
    this.scheduleTimer();
    this.emit();
    return this.getState();
  }

  capture(input: {
    transcript: string;
    field?: FieldState;
    speakerVerification?: EchoSpeakerVerificationResult | null;
    grammarSettings?: EchoMagicCommandGrammarSettings;
    timestamp?: string;
  }): EchoAdaptiveListeningCaptureResult {
    const field = input.field ?? this.context?.field;
    if (!field) {
      this.state = withDiagnostics(
        {
          ...this.state,
          feedback: createFeedback("failed", input.timestamp ?? null),
        },
        this.settings,
      );
      this.emit();
      return {
        state: this.getState(),
        acceptedCommands: [],
        duplicateCommands: [],
        rejectedSegments: [],
        finalization: null,
      };
    }
    this.context = {
      field,
      speakerVerification:
        input.speakerVerification ?? this.context?.speakerVerification ?? null,
      grammarSettings:
        input.grammarSettings ??
        this.context?.grammarSettings ??
        createDefaultMagicCommandGrammarSettings({ enabled: true }),
    };
    const result = captureAdaptiveListeningTranscript(this.state, {
      transcript: input.transcript,
      field,
      speakerVerification: this.context.speakerVerification,
      settings: this.settings,
      grammarSettings: this.context.grammarSettings,
      timestamp: input.timestamp,
    });
    this.state = result.state;
    if (result.finalization) {
      this.clearTimer();
      this.onFinalize?.(result.finalization, this.getState());
    } else {
      this.scheduleTimer();
    }
    this.emit();
    return { ...result, state: this.getState() };
  }

  finalize(
    reason: EchoAdaptiveListeningFinalizationReason = "natural-timeout",
    timestamp = new Date().toISOString(),
  ): EchoAdaptiveListeningFinalization | null {
    const result = finalizeAdaptiveListeningSession(this.state, {
      reason,
      timestamp,
      settings: this.settings,
    });
    this.state = result.state;
    this.clearTimer();
    if (result.finalization) {
      this.onFinalize?.(result.finalization, this.getState());
    }
    this.emit();
    return result.finalization;
  }

  expire(timestamp = new Date().toISOString()): EchoAdaptiveListeningTailState {
    const activeSessionId = this.state.activeSessionId;
    this.state = finalizeExpiredAdaptiveListeningSession(this.state, {
      timestamp,
      settings: this.settings,
    });
    const finalizedSession = activeSessionId
      ? getSessionById(this.state, activeSessionId)
      : null;
    if (!getActiveAdaptiveListeningSession(this.state)) {
      this.clearTimer();
      if (finalizedSession?.finalization) {
        this.onFinalize?.(finalizedSession.finalization, this.getState());
      }
    } else {
      this.scheduleTimer();
    }
    this.emit();
    return this.getState();
  }

  cancel(timestamp = new Date().toISOString()): EchoAdaptiveListeningTailState {
    this.state = cancelAdaptiveListeningSession(this.state, {
      timestamp,
      settings: this.settings,
    });
    this.clearTimer();
    this.emit();
    return this.getState();
  }

  interrupt(
    reason: EchoAdaptiveListeningFinalizationReason = "session-interruption",
    timestamp = new Date().toISOString(),
  ): EchoAdaptiveListeningTailState {
    this.state = interruptAdaptiveListeningSession(this.state, {
      timestamp,
      reason,
      settings: this.settings,
    });
    this.clearTimer();
    this.emit();
    return this.getState();
  }

  diagnostics(): EchoAdaptiveListeningTailDiagnostics {
    return getAdaptiveListeningTailDiagnostics(this.state, this.settings, {
      timersActive: Boolean(this.timer),
    });
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
    this.context = null;
  }

  private scheduleTimer(): void {
    this.clearTimer();
    const active = getActiveAdaptiveListeningSession(this.state);
    if (
      !active ||
      !this.settings.automaticFinalization ||
      !active.finalizeAfter
    ) {
      return;
    }
    const delay = Math.max(
      0,
      new Date(active.finalizeAfter).getTime() - Date.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.expire(new Date().toISOString());
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const echoAdaptiveListeningTailManager =
  new EchoAdaptiveListeningTailManager();

function safelyRecognizeWindowedCommand(input: {
  transcript: string;
  field: FieldState;
  speakerVerification: EchoSpeakerVerificationResult | null;
  settings: EchoMagicCommandGrammarSettings;
  timestamp: string;
  window: EchoListeningWindow | null;
}): EchoWindowedMagicCommandResult {
  try {
    return recognizeMagicCommandInWindow({
      transcript: input.transcript,
      field: input.field,
      speakerVerification: input.speakerVerification,
      settings: input.settings,
      timestamp: input.timestamp,
      window: input.window,
    });
  } catch (error) {
    return createParserFailureWindowedResult(input, error);
  }
}

function createParserFailureWindowedResult(
  input: {
    speakerVerification: EchoSpeakerVerificationResult | null;
    settings: EchoMagicCommandGrammarSettings;
    timestamp: string;
    window: EchoListeningWindow | null;
  },
  error: unknown,
): EchoWindowedMagicCommandResult {
  const message =
    error instanceof Error ? error.message : "Magic command parser failed.";
  const confidence = normalizeAmbientConfidence(
    {
      level: "unknown",
      source: "voice-command",
      assessedAt: input.timestamp,
      score: null,
      reasons: [message],
      validation: {
        contextValid: false,
        rulesValid: false,
        warningCount: 1,
      },
    },
    {
      source: "voice-command",
      timestamp: input.timestamp,
      contextValid: false,
      rulesValid: false,
      warningCount: 1,
    },
  );
  return {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    status: "rejected",
    windowId: input.window?.id ?? null,
    windowKind: input.window?.kind ?? null,
    grammar: {
      version: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
      resultId: makeId("magic-command"),
      status: "rejected",
      action: null,
      intentKind: null,
      intent: null,
      originalPhrase: "",
      normalizedPhrase: "",
      interpretedPhrase: "",
      quantity: null,
      primaryObject: null,
      secondaryObject: null,
      targetObject: null,
      ambiguities: [],
      errors: [message],
      confidence,
      requiredMode: null,
      speakerVerification: {
        required: input.settings.requireVerifiedSpeaker,
        accepted: Boolean(input.speakerVerification?.verified),
        decision: input.speakerVerification?.decision ?? null,
        score: input.speakerVerification?.score ?? null,
      },
      recovery: {
        correctionTypes: ["retry"],
        message,
      },
      accessibilityAnnouncement: "Adaptive listening could not parse speech.",
      diagnostics: {
        locale: input.settings.locale,
        grammarEnabled: input.settings.enabled,
        parserVersion: ECHO_MAGIC_COMMAND_GRAMMAR_VERSION,
        directBattlefieldMutation: false,
      },
    },
    accepted: false,
    confidence,
    confidenceAdjustment: {
      level: "unknown",
      scoreDelta: 0,
      reasons: [message],
    },
    vocabulary: {
      allowedIntentKinds: input.window?.allowedIntentKinds ?? [],
      matchedIntentKind: null,
      restricted: Boolean(input.window),
    },
    entityPrioritySignals: [],
    recovery: {
      required: true,
      reason: message,
    },
    accessibilityAnnouncement: "Adaptive listening could not parse speech.",
    directBattlefieldMutation: false,
  };
}

function createCommand(input: {
  result: EchoWindowedMagicCommandResult;
  fragment: SplitTranscriptFragment;
  timestamp: string;
  order: number;
  fingerprint: string;
  status: EchoAdaptiveListeningCommandStatus;
}): EchoAdaptiveListeningCommand {
  const intent = magicCommandResultToAmbientIntent(input.result.grammar);
  return {
    id: makeId("adaptive-command"),
    order: input.order,
    receivedAt: input.timestamp,
    transcript: input.fragment.transcript,
    normalizedTranscript: input.fragment.normalizedTranscript,
    boundaryReason: input.fragment.boundaryReason,
    windowedResult: input.result,
    intent,
    duplicateFingerprint: input.fingerprint,
    status: input.status,
  };
}

function createSegment(input: {
  result: EchoWindowedMagicCommandResult;
  fragment: SplitTranscriptFragment;
  command: EchoAdaptiveListeningCommand | null;
  timestamp: string;
  duplicate: boolean;
}): EchoAdaptiveListeningTranscriptSegment {
  return {
    id: makeId("adaptive-segment"),
    receivedAt: input.timestamp,
    transcript: input.fragment.transcript,
    normalizedTranscript: input.fragment.normalizedTranscript,
    status: segmentStatusForResult(input.result, input.duplicate),
    boundaryReason: input.fragment.boundaryReason,
    commandIds: input.command ? [input.command.id] : [],
    grammarResultId: input.result.grammar.resultId,
    windowKind: input.result.windowKind,
    duplicate: input.duplicate,
  };
}

function finalizeSession(
  session: EchoAdaptiveListeningSession,
  options: {
    timestamp: string;
    reason: EchoAdaptiveListeningFinalizationReason;
  },
): EchoAdaptiveListeningSession {
  const publishedIntentIds = session.commands
    .filter((command) => command.status === "captured" && command.intent)
    .map((command) => command.intent!.id ?? command.id);
  const finalization: EchoAdaptiveListeningFinalization = {
    reason: options.reason,
    finalizedAt: options.timestamp,
    commandCount: publishedIntentIds.length,
    publishedIntentIds,
    accessibilityAnnouncement:
      publishedIntentIds.length === 1
        ? "One voice command captured."
        : `${publishedIntentIds.length} voice commands captured in order.`,
  };
  return {
    ...session,
    status: "finalized",
    updatedAt: options.timestamp,
    commands: session.commands.map((command) =>
      command.status === "captured" && command.intent
        ? { ...command, status: "published" as const }
        : command,
    ),
    finalization,
  };
}

function splitTranscriptIntoCommandPhrases(
  transcript: string,
): SplitTranscriptFragment[] {
  const sanitized = sanitizeTranscript(transcript);
  if (!sanitized) return [];
  const withCommandBoundaries = sanitized.replace(
    new RegExp(
      `\\s+and\\s+(?=(?:i\\s+will\\s+|i\\s+am\\s+going\\s+to\\s+|i\\s+am\\s+gonna\\s+|i\\s+)?(?:${COMMAND_START_WORDS.join(
        "|",
      )})\\b)`,
      "giu",
    ),
    " | ",
  );
  return withCommandBoundaries
    .replace(/\bthen\b/giu, "|")
    .replace(/\bnext\b/giu, "|")
    .split(/[|,.;!?]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => ({
      transcript: entry,
      normalizedTranscript: normalizeTranscript(entry),
      boundaryReason: index === 0 ? "grammar-completion" : "intent-transition",
    }));
}

interface SplitTranscriptFragment {
  transcript: string;
  normalizedTranscript: string;
  boundaryReason: EchoAdaptiveCommandBoundaryReason;
}

function fingerprintForWindowedResult(
  result: EchoWindowedMagicCommandResult,
): string {
  const grammar = result.grammar;
  const object =
    grammar.primaryObject?.selectedMatch?.normalizedLabel ??
    grammar.primaryObject?.normalizedText ??
    "";
  const target =
    grammar.targetObject?.selectedMatch?.normalizedLabel ??
    grammar.targetObject?.normalizedText ??
    "";
  return [
    grammar.intentKind ?? "unknown",
    object,
    target,
    grammar.quantity ?? "",
  ].join("|");
}

function commandStatusForResult(
  result: EchoWindowedMagicCommandResult,
  duplicate: boolean,
): EchoAdaptiveListeningCommandStatus {
  if (duplicate) return "duplicate";
  return result.accepted ? "captured" : "rejected";
}

function segmentStatusForResult(
  result: EchoWindowedMagicCommandResult,
  duplicate: boolean,
): EchoAdaptiveListeningSegmentStatus {
  if (duplicate) return "duplicate";
  if (result.accepted) return "recognized";
  if (result.status === "incomplete") return "incomplete";
  if (result.status === "unknown") return "unknown";
  if (result.status === "rejected" || result.status === "window-mismatch") {
    return "rejected";
  }
  if (result.status === "ambiguous") return "recognized";
  return "irrelevant";
}

function tailDurationForSettings(
  settings: EchoAdaptiveListeningTailSettings,
  window: EchoListeningWindow | null,
): number {
  const base =
    settings.sensitivity === "strict"
      ? settings.tailDurationMs * 0.75
      : settings.sensitivity === "extended"
        ? settings.tailDurationMs * 1.35
        : settings.tailDurationMs;
  const windowMultiplier =
    window?.kind === "combatDeclaration" || window?.kind === "combatResolution"
      ? 1.2
      : window?.kind === "endTurn"
        ? 0.7
        : 1;
  return clampMilliseconds(
    Math.round(base * windowMultiplier),
    DEFAULT_TAIL_DURATION_MS,
    MIN_TAIL_DURATION_MS,
    MAX_TAIL_DURATION_MS,
  );
}

function replaceSession(
  state: EchoAdaptiveListeningTailState,
  session: EchoAdaptiveListeningSession,
  options: {
    activeSessionId?: string | null;
    lastFinalizedSessionId?: string | null;
    lastCancelledSessionId?: string | null;
    duplicateIncrement?: number;
    feedback?: EchoAdaptiveListeningTailState["feedback"];
    settings: EchoAdaptiveListeningTailSettings;
  },
): EchoAdaptiveListeningTailState {
  return withDiagnostics(
    {
      ...state,
      activeSessionId:
        options.activeSessionId === undefined
          ? state.activeSessionId
          : options.activeSessionId,
      lastFinalizedSessionId:
        options.lastFinalizedSessionId ?? state.lastFinalizedSessionId,
      lastCancelledSessionId:
        options.lastCancelledSessionId ?? state.lastCancelledSessionId,
      duplicateSuppressionCount:
        state.duplicateSuppressionCount + (options.duplicateIncrement ?? 0),
      feedback: options.feedback ?? state.feedback,
      sessions: pruneSessions(
        state.sessions.some((entry) => entry.id === session.id)
          ? state.sessions.map((entry) =>
              entry.id === session.id ? session : entry,
            )
          : [...state.sessions, session],
      ),
    },
    options.settings,
  );
}

function withDiagnostics(
  state: EchoAdaptiveListeningTailState,
  settings: EchoAdaptiveListeningTailSettings,
): EchoAdaptiveListeningTailState {
  return {
    ...state,
    sessions: pruneSessions(state.sessions),
    diagnostics: createDiagnostics({ state, settings, timersActive: false }),
  };
}

function createDiagnostics(input: {
  state: EchoAdaptiveListeningTailState | null;
  settings: EchoAdaptiveListeningTailSettings;
  timersActive: boolean;
}): EchoAdaptiveListeningTailDiagnostics {
  const active = input.state
    ? getActiveAdaptiveListeningSession(input.state)
    : null;
  const latest = input.state?.sessions.at(-1) ?? null;
  const session = active ?? latest;
  const duplicateCount =
    input.state?.duplicateSuppressionCount ??
    latest?.commands.filter((command) => command.status === "duplicate")
      .length ??
    0;
  return {
    version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
    activeSessionId: active?.id ?? null,
    status: active?.status ?? latest?.status ?? "idle",
    activeWindowKind: active?.windowKind ?? latest?.windowKind ?? null,
    capturedCommandCount:
      session?.commands.filter(
        (command) =>
          command.status === "captured" || command.status === "published",
      ).length ?? 0,
    duplicateSuppressionCount: duplicateCount,
    lastFinalizationReason: latest?.finalization?.reason ?? null,
    lastError: active?.lastError ?? latest?.lastError ?? null,
    tailDurationMs: input.settings.tailDurationMs,
    sessionTimeoutMs: input.settings.sessionTimeoutMs,
    automaticFinalization: input.settings.automaticFinalization,
    timersActive: input.timersActive,
    directBattlefieldMutation: false,
  };
}

function createFeedback(
  current: EchoAdaptiveListeningFeedbackState,
  timestamp: string | null,
): EchoAdaptiveListeningTailState["feedback"] {
  return {
    current,
    label: feedbackLabel(current),
    ariaLive:
      current === "failed"
        ? "assertive"
        : current === "hidden"
          ? "off"
          : "polite",
    updatedAt: timestamp,
  };
}

function feedbackLabel(current: EchoAdaptiveListeningFeedbackState): string {
  switch (current) {
    case "listening":
      return "Listening...";
    case "recognizing":
      return "Recognizing...";
    case "waitingForAdditionalInput":
      return "Waiting for additional input...";
    case "processing":
      return "Processing...";
    case "complete":
      return "Complete.";
    case "cancelled":
      return "Cancelled.";
    case "failed":
      return "Listening failed.";
    default:
      return "Voice session inactive.";
  }
}

function normalizeAdaptiveListeningSession(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    sessionId: string | null;
    settings: EchoAdaptiveListeningTailSettings;
  },
): EchoAdaptiveListeningSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAdaptiveListeningSession>;
  const id =
    typeof candidate.id === "string"
      ? candidate.id
      : makeId("adaptive-listening-session");
  const startedAt =
    typeof candidate.startedAt === "string"
      ? candidate.startedAt
      : options.fallbackTimestamp;
  const updatedAt =
    typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : options.fallbackTimestamp;
  const commands = Array.isArray(candidate.commands)
    ? candidate.commands
        .map((entry, index) =>
          normalizeAdaptiveCommand(entry, {
            fallbackTimestamp: updatedAt,
            order: index,
          }),
        )
        .filter((entry): entry is EchoAdaptiveListeningCommand =>
          Boolean(entry),
        )
    : [];
  const segments = Array.isArray(candidate.transcriptSegments)
    ? candidate.transcriptSegments
        .map((entry) => normalizeSegment(entry, updatedAt))
        .filter((entry): entry is EchoAdaptiveListeningTranscriptSegment =>
          Boolean(entry),
        )
    : [];
  return {
    version: ECHO_ADAPTIVE_LISTENING_TAIL_VERSION,
    id,
    sessionId:
      typeof candidate.sessionId === "string"
        ? candidate.sessionId
        : options.sessionId,
    status: normalizeTailStatus(candidate.status),
    ambientMode: normalizeAmbientMode(candidate.ambientMode),
    windowId: sanitizeNullableText(candidate.windowId),
    windowKind: normalizeWindowKind(candidate.windowKind),
    startedAt,
    updatedAt,
    lastRelevantSpeechAt: sanitizeNullableText(candidate.lastRelevantSpeechAt),
    finalizeAfter: sanitizeNullableText(candidate.finalizeAfter),
    hardExpiresAt:
      typeof candidate.hardExpiresAt === "string"
        ? candidate.hardExpiresAt
        : addMilliseconds(startedAt, options.settings.sessionTimeoutMs),
    transcriptSegments: pruneSegments(segments),
    commands: pruneCommands(commands),
    duplicateFingerprints: normalizeStringList(candidate.duplicateFingerprints),
    finalization: normalizeFinalization(candidate.finalization),
    lastError: sanitizeNullableText(candidate.lastError),
  };
}

function normalizeAdaptiveCommand(
  value: unknown,
  options: { fallbackTimestamp: string; order: number },
): EchoAdaptiveListeningCommand | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAdaptiveListeningCommand>;
  if (!candidate.windowedResult) return null;
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("adaptive-command"),
    order: clampCount(candidate.order, options.order, 0, 1_000),
    receivedAt:
      typeof candidate.receivedAt === "string"
        ? candidate.receivedAt
        : options.fallbackTimestamp,
    transcript: sanitizeTranscript(candidate.transcript),
    normalizedTranscript: normalizeTranscript(candidate.normalizedTranscript),
    boundaryReason: normalizeBoundaryReason(candidate.boundaryReason),
    windowedResult: candidate.windowedResult,
    intent: candidate.intent ?? null,
    duplicateFingerprint: sanitizeTranscript(candidate.duplicateFingerprint),
    status: normalizeCommandStatus(candidate.status),
  };
}

function normalizeSegment(
  value: unknown,
  fallbackTimestamp: string,
): EchoAdaptiveListeningTranscriptSegment | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAdaptiveListeningTranscriptSegment>;
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("adaptive-segment"),
    receivedAt:
      typeof candidate.receivedAt === "string"
        ? candidate.receivedAt
        : fallbackTimestamp,
    transcript: sanitizeTranscript(candidate.transcript),
    normalizedTranscript: normalizeTranscript(candidate.normalizedTranscript),
    status: normalizeSegmentStatus(candidate.status),
    boundaryReason: normalizeBoundaryReason(candidate.boundaryReason),
    commandIds: normalizeStringList(candidate.commandIds),
    grammarResultId: sanitizeNullableText(candidate.grammarResultId),
    windowKind: normalizeWindowKind(candidate.windowKind),
    duplicate: Boolean(candidate.duplicate),
  };
}

function normalizeFinalization(
  value: unknown,
): EchoAdaptiveListeningFinalization | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoAdaptiveListeningFinalization>;
  const reason = normalizeFinalizationReason(candidate.reason);
  const finalizedAt = sanitizeNullableText(candidate.finalizedAt);
  if (!finalizedAt) return null;
  return {
    reason,
    finalizedAt,
    commandCount: clampCount(candidate.commandCount, 0, 0, 1_000),
    publishedIntentIds: normalizeStringList(candidate.publishedIntentIds),
    accessibilityAnnouncement: sanitizeTranscript(
      candidate.accessibilityAnnouncement,
    ),
  };
}

function normalizeFeedback(
  value: unknown,
  fallbackTimestamp: string,
): EchoAdaptiveListeningTailState["feedback"] {
  if (!value || typeof value !== "object") {
    return createFeedback("hidden", fallbackTimestamp);
  }
  const candidate = value as Partial<
    EchoAdaptiveListeningTailState["feedback"]
  >;
  const current = normalizeFeedbackState(candidate.current);
  return {
    current,
    label: feedbackLabel(current),
    ariaLive:
      candidate.ariaLive === "assertive" ||
      candidate.ariaLive === "polite" ||
      candidate.ariaLive === "off"
        ? candidate.ariaLive
        : current === "hidden"
          ? "off"
          : "polite",
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : fallbackTimestamp,
  };
}

function getSessionById(
  state: EchoAdaptiveListeningTailState,
  id: string,
): EchoAdaptiveListeningSession | null {
  return state.sessions.find((session) => session.id === id) ?? null;
}

function pruneSessions(
  sessions: EchoAdaptiveListeningSession[],
): EchoAdaptiveListeningSession[] {
  return sessions
    .slice()
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-MAX_SESSIONS_TO_RESTORE);
}

function pruneSegments(
  segments: EchoAdaptiveListeningTranscriptSegment[],
): EchoAdaptiveListeningTranscriptSegment[] {
  return segments.slice(-MAX_SEGMENTS_PER_SESSION);
}

function pruneCommands(
  commands: EchoAdaptiveListeningCommand[],
): EchoAdaptiveListeningCommand[] {
  return commands
    .slice()
    .sort((left, right) => left.order - right.order)
    .slice(-MAX_COMMANDS_PER_SESSION);
}

function isUnsafeRestoredStatus(
  status: EchoAdaptiveListeningTailStatus,
): boolean {
  return (
    status === "capturing" ||
    status === "waitingForTail" ||
    status === "finalizing"
  );
}

function normalizeSensitivity(
  value: unknown,
): EchoAdaptiveListeningTailSensitivity {
  return value === "strict" || value === "extended" || value === "balanced"
    ? value
    : "balanced";
}

function normalizeTailStatus(value: unknown): EchoAdaptiveListeningTailStatus {
  const statuses: EchoAdaptiveListeningTailStatus[] = [
    "idle",
    "capturing",
    "waitingForTail",
    "finalizing",
    "finalized",
    "cancelled",
    "interrupted",
    "recovered",
    "failed",
  ];
  return statuses.includes(value as EchoAdaptiveListeningTailStatus)
    ? (value as EchoAdaptiveListeningTailStatus)
    : "idle";
}

function normalizeFeedbackState(
  value: unknown,
): EchoAdaptiveListeningFeedbackState {
  const states: EchoAdaptiveListeningFeedbackState[] = [
    "hidden",
    "listening",
    "recognizing",
    "waitingForAdditionalInput",
    "processing",
    "complete",
    "cancelled",
    "failed",
  ];
  return states.includes(value as EchoAdaptiveListeningFeedbackState)
    ? (value as EchoAdaptiveListeningFeedbackState)
    : "hidden";
}

function normalizeSegmentStatus(
  value: unknown,
): EchoAdaptiveListeningSegmentStatus {
  const statuses: EchoAdaptiveListeningSegmentStatus[] = [
    "recognized",
    "duplicate",
    "irrelevant",
    "rejected",
    "incomplete",
    "unknown",
    "failed",
  ];
  return statuses.includes(value as EchoAdaptiveListeningSegmentStatus)
    ? (value as EchoAdaptiveListeningSegmentStatus)
    : "unknown";
}

function normalizeCommandStatus(
  value: unknown,
): EchoAdaptiveListeningCommandStatus {
  const statuses: EchoAdaptiveListeningCommandStatus[] = [
    "captured",
    "duplicate",
    "rejected",
    "published",
  ];
  return statuses.includes(value as EchoAdaptiveListeningCommandStatus)
    ? (value as EchoAdaptiveListeningCommandStatus)
    : "captured";
}

function normalizeBoundaryReason(
  value: unknown,
): EchoAdaptiveCommandBoundaryReason {
  const reasons: EchoAdaptiveCommandBoundaryReason[] = [
    "grammar-completion",
    "pause",
    "intent-transition",
    "window-transition",
    "speaker-inactivity",
    "manual-fragment",
  ];
  return reasons.includes(value as EchoAdaptiveCommandBoundaryReason)
    ? (value as EchoAdaptiveCommandBoundaryReason)
    : "grammar-completion";
}

function normalizeFinalizationReason(
  value: unknown,
): EchoAdaptiveListeningFinalizationReason {
  const reasons: EchoAdaptiveListeningFinalizationReason[] = [
    "natural-timeout",
    "explicit-command",
    "manual-cancellation",
    "ambient-mode-transition",
    "recovery",
    "session-interruption",
    "application-lifecycle",
    "session-timeout",
    "parser-failure",
  ];
  return reasons.includes(value as EchoAdaptiveListeningFinalizationReason)
    ? (value as EchoAdaptiveListeningFinalizationReason)
    : "natural-timeout";
}

function normalizeAmbientMode(
  value: unknown,
): EchoAdaptiveListeningSession["ambientMode"] {
  return value === "passive" ||
    value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
    ? value
    : "passive";
}

function normalizeWindowKind(
  value: unknown,
): EchoAdaptiveListeningSession["windowKind"] {
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

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function sanitizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function sanitizeTranscript(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim().slice(0, 280)
    : "";
}

function normalizeTranscript(value: unknown): string {
  return sanitizeTranscript(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+/'-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function clampMilliseconds(
  value: unknown,
  fallback: number,
  min = MIN_TAIL_DURATION_MS,
  max = MAX_TAIL_DURATION_MS,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function clampCount(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}
