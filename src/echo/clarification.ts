import { makeId } from "../domain/cards";
import type { FieldState } from "../domain/types";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type { AmbientConfidenceAssessment } from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntent,
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import {
  createBattlefieldContext,
  resolveEchoEntity,
} from "./entityResolution";
import type {
  EchoEntityResolutionCandidate,
  EchoEntityResolutionRequest,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";
import {
  ECHO_CLARIFICATION_VERSION,
  type EchoClarificationAnswer,
  type EchoClarificationDecision,
  type EchoClarificationDecisionAction,
  type EchoClarificationDecisionInput,
  type EchoClarificationDiagnostics,
  type EchoClarificationIssue,
  type EchoClarificationPrompt,
  type EchoClarificationPreservedContext,
  type EchoClarificationSession,
  type EchoClarificationSessionStatus,
  type EchoClarificationSettings,
  type EchoClarificationState,
  type EchoClarificationType,
  type EchoConfirmationSensitivity,
} from "./clarificationTypes";

const DEFAULT_CLARIFICATION_TIMEOUT_MS = 12000;
const MAX_SESSION_COUNT = 12;

const TARGET_REQUIRED_INTENTS = new Set<AmbientIntentKind>([
  "attack",
  "block",
  "destroy-permanent",
  "sacrifice-permanent",
  "tap",
  "untap",
  "add-counters",
  "remove-counters",
  "return-permanent",
  "exile-permanent",
  "equip",
  "attach",
  "transform-permanent",
]);

const QUANTITY_REQUIRED_INTENTS = new Set<AmbientIntentKind>([
  "create-token",
  "add-counters",
  "remove-counters",
  "draw-cards",
  "discard-cards",
  "modify-life",
  "modify-commander-damage",
  "surveil",
  "mill-cards",
]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: -1,
};

export function createDefaultClarificationSettings(
  input: Partial<EchoClarificationSettings> = {},
): EchoClarificationSettings {
  return {
    ...input,
    version: ECHO_CLARIFICATION_VERSION,
    enabled: input.enabled ?? true,
    confirmationSensitivity: input.confirmationSensitivity ?? "balanced",
    automaticExecutionThreshold: input.automaticExecutionThreshold ?? 0.86,
    quickConfirmationThreshold: input.quickConfirmationThreshold ?? 0.62,
    clarificationTimeoutMs:
      input.clarificationTimeoutMs ?? DEFAULT_CLARIFICATION_TIMEOUT_MS,
    voiceConfirmationEnabled: input.voiceConfirmationEnabled ?? false,
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: input.developerDiagnosticsEnabled ?? false,
    lastResetAt: input.lastResetAt ?? null,
  };
}

export function normalizeClarificationSettings(
  value: unknown,
): EchoClarificationSettings {
  const defaults = createDefaultClarificationSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoClarificationSettings>;
  const sensitivity = normalizeSensitivity(candidate.confirmationSensitivity);
  const thresholds = thresholdsForSensitivity(sensitivity);
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    confirmationSensitivity: sensitivity,
    automaticExecutionThreshold: clampFraction(
      candidate.automaticExecutionThreshold,
      thresholds.automaticExecutionThreshold,
    ),
    quickConfirmationThreshold: clampFraction(
      candidate.quickConfirmationThreshold,
      thresholds.quickConfirmationThreshold,
    ),
    clarificationTimeoutMs: clampNumber(
      candidate.clarificationTimeoutMs,
      3000,
      60000,
      defaults.clarificationTimeoutMs,
    ),
    voiceConfirmationEnabled: Boolean(candidate.voiceConfirmationEnabled),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    developerDiagnosticsEnabled: Boolean(candidate.developerDiagnosticsEnabled),
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultClarificationState(
  input: Partial<EchoClarificationState> = {},
): EchoClarificationState {
  const diagnostics = input.diagnostics ?? createClarificationDiagnostics(null);
  return {
    version: ECHO_CLARIFICATION_VERSION,
    activeSessionId: null,
    sessions: [],
    lastResolvedSessionId: null,
    lastCancelledSessionId: null,
    lastTimedOutSessionId: null,
    pendingPrompt: null,
    ...input,
    diagnostics: {
      ...createClarificationDiagnostics(null),
      ...diagnostics,
      directBattlefieldMutation: false,
    },
  };
}

export function normalizeClarificationState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoClarificationSettings;
  } = {},
): EchoClarificationState {
  const settings = normalizeClarificationSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultClarificationState({
      diagnostics: createClarificationDiagnostics({
        timeoutMs: settings.clarificationTimeoutMs,
      }),
    });
  }
  const candidate = value as Partial<EchoClarificationState>;
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions
        .map((session) =>
          normalizeClarificationSession(session, {
            timestamp: options.fallbackTimestamp,
            settings,
          }),
        )
        .filter((session): session is EchoClarificationSession =>
          Boolean(session),
        )
        .slice(-MAX_SESSION_COUNT)
    : [];
  const activeSession = sessions.find(
    (session) =>
      session.id === candidate.activeSessionId &&
      session.status === "awaiting-response" &&
      (!session.expiresAt ||
        !options.fallbackTimestamp ||
        session.expiresAt > options.fallbackTimestamp),
  );
  const safeSessions = sessions.map((session) => {
    if (
      session.id !== activeSession?.id &&
      session.status === "awaiting-response"
    ) {
      return {
        ...session,
        status: "recovered" as const,
        recoveryReason:
          "Clarification session was restored without active workflow.",
      };
    }
    return session;
  });
  return createDefaultClarificationState({
    activeSessionId: activeSession?.id ?? null,
    sessions: safeSessions,
    lastResolvedSessionId:
      typeof candidate.lastResolvedSessionId === "string"
        ? candidate.lastResolvedSessionId
        : null,
    lastCancelledSessionId:
      typeof candidate.lastCancelledSessionId === "string"
        ? candidate.lastCancelledSessionId
        : null,
    lastTimedOutSessionId:
      typeof candidate.lastTimedOutSessionId === "string"
        ? candidate.lastTimedOutSessionId
        : null,
    pendingPrompt: activeSession?.prompt ?? null,
    diagnostics: createClarificationDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeSessionId: activeSession?.id ?? null,
      timeoutMs: settings.clarificationTimeoutMs,
    }),
  });
}

export function decideClarificationForIntent(
  input: EchoClarificationDecisionInput,
): EchoClarificationDecision {
  const settings = normalizeClarificationSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const confidence = normalizeDecisionConfidence(input, timestamp);
  const entityResults =
    input.entityResults ?? resolveIntentEntityTexts(input.field, input.intent);
  const issues = collectClarificationIssues({
    ...input,
    entityResults,
    confidence,
    timestamp,
  });

  if (issues.length) {
    if (!settings.enabled) {
      return createDecision({
        action: "deferred",
        reason: "Clarification is disabled; uncertain action was deferred.",
        confidence,
        issues,
        input,
        timestamp,
        settings,
      });
    }
    return createDecision({
      action: "clarified",
      reason: issues[0].question,
      confidence,
      issues,
      input,
      timestamp,
      settings,
    });
  }

  const score = confidence.score ?? 0;
  if (confidence.level === "unknown" || score < 0.15) {
    return createDecision({
      action: "rejected",
      reason: "Confidence is too low to clarify safely.",
      confidence,
      issues: [],
      input,
      timestamp,
      settings,
    });
  }
  if (confidence.level === "low") {
    return createDecision({
      action: "clarified",
      reason: "Low confidence requires one clarification before continuing.",
      confidence,
      issues: [
        createIssue({
          type: "multiple-legal-interpretations",
          question: "Which action?",
        }),
      ],
      input,
      timestamp,
      settings,
    });
  }
  if (
    confidence.level === "medium" ||
    score < settings.automaticExecutionThreshold
  ) {
    return createDecision({
      action: "confirmation-required",
      reason: "Medium confidence requires quick confirmation.",
      confidence,
      issues: [
        createIssue({
          type: "medium-confidence-confirmation",
          question: `Confirm ${actionPhrase(input.intent.kind)}?`,
        }),
      ],
      input,
      timestamp,
      settings,
    });
  }
  return createDecision({
    action: "accepted",
    reason: "Clarification not required.",
    confidence,
    issues: [],
    input,
    timestamp,
    settings,
  });
}

export function applyClarificationAnswer(
  session: EchoClarificationSession,
  input: {
    field: FieldState;
    text: string;
    timestamp?: string;
    settings?: EchoClarificationSettings;
  },
): EchoClarificationSession {
  const settings = normalizeClarificationSettings(input.settings);
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (session.status !== "awaiting-response" && session.status !== "pending") {
    return normalizeClarificationSession(session, { timestamp, settings })!;
  }
  if (session.expiresAt && timestamp >= session.expiresAt) {
    return timeoutClarificationSession(session, {
      timestamp,
      settings,
    });
  }
  const issue = session.issues.find(
    (entry) => entry.id === session.currentIssueId && !entry.resolved,
  );
  if (!issue) {
    return completeSession(session, timestamp, settings);
  }
  const answer = resolveAnswer(issue, {
    field: input.field,
    text: input.text,
    timestamp,
  });
  const updatedIssues = session.issues.map((entry) =>
    entry.id === issue.id && answer.accepted
      ? {
          ...entry,
          resolved: true,
          resolution: answerToResolution(answer, issue),
        }
      : entry,
  );
  const nextIntent = answer.accepted
    ? applyIssueResolutionToIntent(
        session.resumedIntent ?? session.preservedContext.intent,
        issue,
        answer,
      )
    : session.resumedIntent;
  const nextIssue = updatedIssues.find(
    (entry) => !entry.resolved && entry.required,
  );
  if (!answer.accepted) {
    return {
      ...session,
      status: "awaiting-response",
      updatedAt: timestamp,
      answers: [...session.answers, answer],
      recoveryReason: answer.message,
    };
  }
  if (nextIssue) {
    return {
      ...session,
      status: "awaiting-response",
      updatedAt: timestamp,
      currentIssueId: nextIssue.id,
      issues: updatedIssues,
      prompt: createPrompt(nextIssue, timestamp, settings),
      answers: [...session.answers, answer],
      resumedIntent: nextIntent,
      recoveryReason: null,
    };
  }
  return {
    ...session,
    status:
      issue.type === "medium-confidence-confirmation"
        ? "confirmed"
        : "resolved",
    updatedAt: timestamp,
    currentIssueId: null,
    issues: updatedIssues,
    prompt: null,
    answers: [...session.answers, answer],
    resumedIntent: nextIntent,
    resumePipelineStage: "confidence-assignment",
    recoveryReason: null,
  };
}

export function startClarificationSession(
  state: EchoClarificationState,
  decision: EchoClarificationDecision,
): EchoClarificationState {
  if (!decision.session) {
    return {
      ...state,
      diagnostics: createClarificationDiagnostics({
        ...state.diagnostics,
        lastAction: decision.action,
      }),
    };
  }
  const sessions = [
    ...state.sessions.filter((session) => session.id !== decision.session!.id),
    decision.session,
  ].slice(-MAX_SESSION_COUNT);
  return createDefaultClarificationState({
    ...state,
    activeSessionId: decision.session.id,
    sessions,
    pendingPrompt: decision.prompt,
    diagnostics: createClarificationDiagnostics({
      activeSessionId: decision.session.id,
      lastSessionId: decision.session.id,
      lastAction: decision.action,
      pendingIssueCount: decision.issues.length,
      resolvedIssueCount: 0,
      lastPrompt: decision.prompt?.question ?? null,
      timeoutMs: state.diagnostics.timeoutMs,
    }),
  });
}

export function updateClarificationSession(
  state: EchoClarificationState,
  session: EchoClarificationSession,
): EchoClarificationState {
  const sessions = [
    ...state.sessions.filter((entry) => entry.id !== session.id),
    session,
  ].slice(-MAX_SESSION_COUNT);
  const terminal = isTerminalStatus(session.status);
  return createDefaultClarificationState({
    ...state,
    activeSessionId: terminal ? null : session.id,
    sessions,
    lastResolvedSessionId:
      session.status === "resolved" || session.status === "confirmed"
        ? session.id
        : state.lastResolvedSessionId,
    lastCancelledSessionId:
      session.status === "cancelled"
        ? session.id
        : state.lastCancelledSessionId,
    lastTimedOutSessionId:
      session.status === "timed-out" ? session.id : state.lastTimedOutSessionId,
    pendingPrompt: terminal ? null : session.prompt,
    diagnostics: createClarificationDiagnostics({
      activeSessionId: terminal ? null : session.id,
      lastSessionId: session.id,
      lastAction: statusToAction(session.status),
      pendingIssueCount: session.issues.filter((issue) => !issue.resolved)
        .length,
      resolvedIssueCount: session.issues.filter((issue) => issue.resolved)
        .length,
      lastPrompt: session.prompt?.question ?? null,
      lastError: session.recoveryReason,
      timeoutMs: state.diagnostics.timeoutMs,
    }),
  });
}

export function cancelClarificationSession(
  session: EchoClarificationSession,
  options: {
    timestamp?: string;
    reason?: string;
    settings?: EchoClarificationSettings;
  } = {},
): EchoClarificationSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...normalizeClarificationSession(session, {
      timestamp,
      settings: normalizeClarificationSettings(options.settings),
    })!,
    status: "cancelled",
    updatedAt: timestamp,
    currentIssueId: null,
    prompt: null,
    recoveryReason: options.reason ?? "Clarification cancelled.",
    resumePipelineStage: null,
  };
}

export function timeoutClarificationSession(
  session: EchoClarificationSession,
  options: {
    timestamp?: string;
    settings?: EchoClarificationSettings;
  } = {},
): EchoClarificationSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...normalizeClarificationSession(session, {
      timestamp,
      settings: normalizeClarificationSettings(options.settings),
    })!,
    status: "timed-out",
    updatedAt: timestamp,
    currentIssueId: null,
    prompt: null,
    recoveryReason: "Clarification timed out.",
    resumePipelineStage: null,
  };
}

export function recoverClarificationSession(
  session: EchoClarificationSession,
  options: {
    timestamp?: string;
    reason?: string;
    settings?: EchoClarificationSettings;
  } = {},
): EchoClarificationSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    ...normalizeClarificationSession(session, {
      timestamp,
      settings: normalizeClarificationSettings(options.settings),
    })!,
    status: "recovered",
    updatedAt: timestamp,
    currentIssueId: null,
    prompt: null,
    recoveryReason:
      options.reason ?? "Clarification recovered to a safe paused state.",
    resumePipelineStage: null,
  };
}

export function createClarificationAwarePipelineRequest(input: {
  field: FieldState;
  intent: AmbientIntentInput | AmbientIntent;
  transcript?: string | null;
  entityResults?: EchoEntityResolutionResult[];
  settings?: EchoClarificationSettings;
  timestamp?: string;
}): {
  decision: EchoClarificationDecision;
  intent: AmbientIntentInput | AmbientIntent | null;
  shouldProcess: boolean;
} {
  const decision = decideClarificationForIntent(input);
  return {
    decision,
    intent:
      decision.action === "accepted" || decision.shouldResumePipeline
        ? (decision.resumedIntent ?? input.intent)
        : null,
    shouldProcess:
      decision.action === "accepted" || decision.shouldResumePipeline,
  };
}

function createDecision(input: {
  action: EchoClarificationDecisionAction;
  reason: string;
  confidence: AmbientConfidenceAssessment;
  issues: EchoClarificationIssue[];
  input: EchoClarificationDecisionInput;
  timestamp: string;
  settings: EchoClarificationSettings;
}): EchoClarificationDecision {
  const prompt =
    input.action === "clarified" || input.action === "confirmation-required"
      ? createPrompt(input.issues[0], input.timestamp, input.settings)
      : null;
  const session =
    prompt && input.issues.length
      ? createSession({
          input: input.input,
          confidence: input.confidence,
          issues: input.issues,
          prompt,
          timestamp: input.timestamp,
          settings: input.settings,
          status: "awaiting-response",
        })
      : null;
  return {
    version: ECHO_CLARIFICATION_VERSION,
    action: input.action,
    reason: input.reason,
    confidence: input.confidence,
    issues: input.issues,
    prompt,
    session,
    resumedIntent:
      input.action === "accepted"
        ? input.input.intent
        : (session?.resumedIntent ?? null),
    shouldResumePipeline: input.action === "accepted",
    directBattlefieldMutation: false,
  };
}

function createSession(input: {
  input: EchoClarificationDecisionInput;
  confidence: AmbientConfidenceAssessment;
  issues: EchoClarificationIssue[];
  prompt: EchoClarificationPrompt;
  timestamp: string;
  settings: EchoClarificationSettings;
  status: EchoClarificationSessionStatus;
}): EchoClarificationSession {
  const activeWindow = input.input.field.contextualListening.windows.find(
    (window) =>
      window.id === input.input.field.contextualListening.activeWindowId,
  );
  return {
    version: ECHO_CLARIFICATION_VERSION,
    id: makeId("echo-clarification"),
    status: input.status,
    intentId:
      typeof input.input.intent.id === "string" ? input.input.intent.id : null,
    intentKind: input.input.intent.kind,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    expiresAt: addMilliseconds(
      input.timestamp,
      input.settings.clarificationTimeoutMs,
    ),
    currentIssueId: input.issues[0]?.id ?? null,
    issues: structuredClone(input.issues),
    prompt: input.prompt,
    answers: [],
    preservedContext: {
      originalTranscript: input.input.transcript ?? null,
      intent: structuredClone(input.input.intent),
      entityResults: structuredClone(input.input.entityResults ?? []),
      confidence: input.confidence,
      activeWindowId: activeWindow?.id ?? null,
      activeWindowKind: activeWindow?.kind ?? null,
      ambientMode: input.input.field.ambient.currentMode,
      plannerActionIds: input.input.field.preTurnPlanner.actions.map(
        (action) => action.id,
      ),
      actionStripItemIds: input.input.field.activeTurnActionStrip.items.map(
        (item) => item.id,
      ),
      pipelineStage: input.input.pipelineStage ?? "entity-resolution",
      battlefieldContext: createBattlefieldContext(input.input.field, {
        timestamp: input.timestamp,
      }),
    },
    resumedIntent: structuredClone(input.input.intent),
    resumePipelineStage: null,
    recoveryReason: null,
    directBattlefieldMutation: false,
  };
}

function collectClarificationIssues(
  input: EchoClarificationDecisionInput & {
    entityResults: EchoEntityResolutionResult[];
    confidence: AmbientConfidenceAssessment;
    timestamp: string;
  },
): EchoClarificationIssue[] {
  const issues: EchoClarificationIssue[] = [];
  for (const result of input.entityResults) {
    if (result.status === "resolved") continue;
    const ambiguity = result.ambiguities[0];
    const type = clarificationTypeFromEntityResult(result);
    issues.push(
      createIssue({
        type,
        question: questionForEntityResult(result, type),
        entityText: result.text,
        role: roleFromResult(input.intent, result),
        candidates: clarificationCandidates(result.candidates),
      }),
    );
    if (!ambiguity && result.status === "missing") break;
  }
  const payload = input.intent.payload ?? {};
  const quantity =
    numericPayload(payload.quantity) ?? numericPayload(payload.amount);
  if (QUANTITY_REQUIRED_INTENTS.has(input.intent.kind) && quantity === null) {
    issues.push(
      createIssue({
        type: "missing-quantity",
        question: "How many?",
      }),
    );
  }
  if (
    TARGET_REQUIRED_INTENTS.has(input.intent.kind) &&
    !(
      input.intent.entities?.length ||
      input.entityResults.length ||
      input.entityResults.some((result) => result.status === "resolved")
    )
  ) {
    const text =
      typeof payload.primaryObjectText === "string"
        ? payload.primaryObjectText
        : null;
    issues.push(
      createIssue({
        type: isPronoun(text) ? "ambiguous-pronoun" : "missing-target",
        question: targetQuestion(input.intent.kind, text),
        entityText: text,
        role: "target",
      }),
    );
  }
  const playerText =
    typeof payload.player === "string"
      ? payload.player
      : typeof payload.targetObjectText === "string"
        ? payload.targetObjectText
        : null;
  if (
    playerText &&
    normalizeText(playerText).includes("opponent") &&
    input.field.opponentValues.numberOfOpponents > 1
  ) {
    issues.push(
      createIssue({
        type: "ambiguous-player-reference",
        question: "Which opponent?",
      }),
    );
  }
  return dedupeIssues(issues);
}

function resolveIntentEntityTexts(
  field: FieldState,
  intent: AmbientIntentInput | AmbientIntent,
): EchoEntityResolutionResult[] {
  const payload = intent.payload ?? {};
  const texts = [
    payload.primaryObjectText,
    payload.primaryObjectLabel,
    payload.targetObjectText,
    payload.targetObjectLabel,
    payload.counterName,
    payload.tokenName,
  ].filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
  return texts.map((text) =>
    resolveEchoEntity({
      field,
      intent: intent as AmbientIntent,
      text,
      role: text === payload.counterName ? "counter" : "target",
    }),
  );
}

function createIssue(input: {
  type: EchoClarificationType;
  question: string;
  entityText?: string | null;
  role?: EchoEntityResolutionRequest["role"] | null;
  candidates?: EchoEntityResolutionCandidate[];
}): EchoClarificationIssue {
  return {
    id: makeId("echo-clarification-issue"),
    type: input.type,
    question: input.question,
    entityText: input.entityText ?? null,
    role: input.role ?? null,
    candidates: input.candidates ?? [],
    required: true,
    resolved: false,
    resolution: null,
  };
}

function createPrompt(
  issue: EchoClarificationIssue | undefined,
  timestamp: string,
  settings: EchoClarificationSettings,
): EchoClarificationPrompt | null {
  if (!issue) return null;
  return {
    id: makeId("echo-clarification-prompt"),
    issueId: issue.id,
    type: issue.type,
    question: issue.question,
    candidateLabels: issue.candidates.map((candidate) => candidate.label),
    concise: true,
    ariaLive: "polite",
    createdAt: timestamp,
    expiresAt: addMilliseconds(timestamp, settings.clarificationTimeoutMs),
    accessibilityAnnouncement: issue.question,
  };
}

function resolveAnswer(
  issue: EchoClarificationIssue,
  input: { field: FieldState; text: string; timestamp: string },
): EchoClarificationAnswer {
  const normalizedText = normalizeText(input.text);
  if (issue.type === "medium-confidence-confirmation") {
    const accepted = isAffirmative(normalizedText);
    return createAnswer(issue, input, {
      accepted: accepted || isNegative(normalizedText),
      confirmationAccepted: accepted,
      message: accepted ? "Confirmed." : "Confirmation declined.",
    });
  }
  if (issue.type === "missing-quantity") {
    const quantity = parseQuantity(normalizedText);
    return createAnswer(issue, input, {
      accepted: quantity !== null && quantity >= 0,
      quantity,
      message:
        quantity !== null
          ? "Quantity clarified."
          : "Quantity was not understood.",
    });
  }
  if (issue.type === "ambiguous-player-reference") {
    const quantity = parseQuantity(normalizedText);
    return createAnswer(issue, input, {
      accepted:
        normalizedText.includes("opponent") ||
        (quantity !== null && quantity > 0),
      entity: { kind: "player", owner: "opponent", role: "target" },
      message: "Opponent clarified.",
    });
  }
  const candidate = chooseCandidateFromAnswer(issue.candidates, normalizedText);
  if (candidate?.entity) {
    return createAnswer(issue, input, {
      accepted: true,
      entity: candidate.entity,
      candidateId: candidate.id,
      message: `${candidate.label} clarified.`,
    });
  }
  if (
    issue.entityText ||
    issue.type === "missing-target" ||
    issue.type === "unknown-card-reference"
  ) {
    const result = resolveEchoEntity({
      field: input.field,
      text: input.text,
      role: issue.role ?? "target",
    });
    if (result.status === "resolved" && result.selected?.entity) {
      return createAnswer(issue, input, {
        accepted: true,
        entity: result.selected.entity,
        candidateId: result.selected.id,
        message: `${result.selected.label} clarified.`,
      });
    }
  }
  return createAnswer(issue, input, {
    accepted: false,
    message: "Clarification answer did not resolve the issue.",
  });
}

function createAnswer(
  issue: EchoClarificationIssue,
  input: { text: string; timestamp: string },
  result: {
    accepted: boolean;
    entity?: AmbientEntityReference | null;
    candidateId?: string | null;
    quantity?: number | null;
    confirmationAccepted?: boolean;
    message: string;
  },
): EchoClarificationAnswer {
  return {
    id: makeId("echo-clarification-answer"),
    issueId: issue.id,
    receivedAt: input.timestamp,
    text: input.text,
    normalizedText: normalizeText(input.text),
    accepted: result.accepted && result.confirmationAccepted !== false,
    resolvedCandidateId: result.candidateId ?? null,
    resolvedEntity: result.entity ?? null,
    quantity: result.quantity ?? null,
    message: result.message,
  };
}

function answerToResolution(
  answer: EchoClarificationAnswer,
  issue: EchoClarificationIssue,
): EchoClarificationIssue["resolution"] {
  if (answer.resolvedEntity) {
    return {
      kind: "entity",
      entity: answer.resolvedEntity,
      candidateId: answer.resolvedCandidateId ?? "",
      label:
        issue.candidates.find(
          (candidate) => candidate.id === answer.resolvedCandidateId,
        )?.label ?? answer.text,
    };
  }
  if (answer.quantity !== null) {
    return { kind: "quantity", quantity: answer.quantity };
  }
  if (issue.type === "medium-confidence-confirmation") {
    return { kind: "confirmation", accepted: answer.accepted };
  }
  return { kind: "text", value: answer.text };
}

function applyIssueResolutionToIntent(
  intent: AmbientIntentInput | AmbientIntent,
  issue: EchoClarificationIssue,
  answer: EchoClarificationAnswer,
): AmbientIntentInput | AmbientIntent {
  const payload = { ...(intent.payload ?? {}) };
  const entities = [...(intent.entities ?? [])];
  if (answer.resolvedEntity) {
    entities.push(answer.resolvedEntity);
  }
  if (answer.quantity !== null) {
    payload.quantity = answer.quantity;
    payload.amount = answer.quantity;
  }
  if (issue.type === "medium-confidence-confirmation") {
    payload.confirmed = answer.accepted;
  }
  const source = intent.source ?? "system";
  return {
    ...intent,
    entities: dedupeEntityReferences(entities),
    payload,
    confidence: normalizeAmbientConfidence("high", {
      source,
      timestamp: answer.receivedAt,
      contextValid: true,
      rulesValid: true,
      warningCount: 0,
    }),
  };
}

function completeSession(
  session: EchoClarificationSession,
  timestamp: string,
  settings: EchoClarificationSettings,
): EchoClarificationSession {
  const normalized = normalizeClarificationSession(session, {
    timestamp,
    settings,
  })!;
  return {
    ...normalized,
    status: "resolved",
    updatedAt: timestamp,
    currentIssueId: null,
    prompt: null,
    resumePipelineStage: "confidence-assignment",
  };
}

function normalizeClarificationSession(
  value: unknown,
  options: {
    timestamp?: string;
    settings?: EchoClarificationSettings;
  },
): EchoClarificationSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoClarificationSession>;
  if (!candidate.intentKind) return null;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const settings = normalizeClarificationSettings(options.settings);
  const issues = Array.isArray(candidate.issues)
    ? candidate.issues
        .map(normalizeIssue)
        .filter((issue): issue is EchoClarificationIssue => Boolean(issue))
    : [];
  const status = normalizeSessionStatus(candidate.status);
  const activeIssue =
    issues.find(
      (issue) => issue.id === candidate.currentIssueId && !issue.resolved,
    ) ?? issues.find((issue) => !issue.resolved);
  const prompt =
    status === "awaiting-response"
      ? normalizePrompt(candidate.prompt, activeIssue, timestamp, settings)
      : null;
  return {
    version: ECHO_CLARIFICATION_VERSION,
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-clarification"),
    status,
    intentId:
      typeof candidate.intentId === "string" ? candidate.intentId : null,
    intentKind: candidate.intentKind,
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    expiresAt:
      typeof candidate.expiresAt === "string"
        ? candidate.expiresAt
        : addMilliseconds(timestamp, settings.clarificationTimeoutMs),
    currentIssueId: activeIssue?.id ?? null,
    issues,
    prompt,
    answers: Array.isArray(candidate.answers)
      ? candidate.answers
          .map(normalizeAnswer)
          .filter((answer): answer is EchoClarificationAnswer =>
            Boolean(answer),
          )
      : [],
    preservedContext: normalizePreservedContext(candidate.preservedContext),
    resumedIntent:
      candidate.resumedIntent && typeof candidate.resumedIntent === "object"
        ? structuredClone(candidate.resumedIntent)
        : null,
    resumePipelineStage: candidate.resumePipelineStage ?? null,
    recoveryReason:
      typeof candidate.recoveryReason === "string"
        ? candidate.recoveryReason
        : null,
    directBattlefieldMutation: false,
  };
}

function normalizePreservedContext(
  value: unknown,
): EchoClarificationPreservedContext {
  if (!value || typeof value !== "object") {
    const field = createFallbackFieldShape();
    const confidence = normalizeAmbientConfidence("unknown", {
      source: "system",
      timestamp: new Date().toISOString(),
    });
    return {
      originalTranscript: null,
      intent: { kind: "custom", source: "system" },
      entityResults: [],
      confidence,
      activeWindowId: null,
      activeWindowKind: null,
      ambientMode: "passive",
      plannerActionIds: [],
      actionStripItemIds: [],
      pipelineStage: "entity-resolution",
      battlefieldContext: createBattlefieldContext(field),
    };
  }
  const candidate = value as Partial<EchoClarificationPreservedContext>;
  return {
    originalTranscript:
      typeof candidate.originalTranscript === "string"
        ? candidate.originalTranscript
        : null,
    intent:
      candidate.intent && typeof candidate.intent === "object"
        ? structuredClone(candidate.intent)
        : { kind: "custom", source: "system" },
    entityResults: Array.isArray(candidate.entityResults)
      ? structuredClone(candidate.entityResults)
      : [],
    confidence:
      candidate.confidence && typeof candidate.confidence === "object"
        ? candidate.confidence
        : normalizeAmbientConfidence("unknown", {
            source: "system",
            timestamp: new Date().toISOString(),
          }),
    activeWindowId:
      typeof candidate.activeWindowId === "string"
        ? candidate.activeWindowId
        : null,
    activeWindowKind: candidate.activeWindowKind ?? null,
    ambientMode: candidate.ambientMode ?? "passive",
    plannerActionIds: Array.isArray(candidate.plannerActionIds)
      ? candidate.plannerActionIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    actionStripItemIds: Array.isArray(candidate.actionStripItemIds)
      ? candidate.actionStripItemIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    pipelineStage: candidate.pipelineStage ?? "entity-resolution",
    battlefieldContext:
      candidate.battlefieldContext &&
      typeof candidate.battlefieldContext === "object"
        ? candidate.battlefieldContext
        : createBattlefieldContext(createFallbackFieldShape()),
  };
}

function normalizeIssue(value: unknown): EchoClarificationIssue | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoClarificationIssue>;
  if (!candidate.type || typeof candidate.question !== "string") return null;
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-clarification-issue"),
    type: candidate.type,
    question: candidate.question.slice(0, 120),
    entityText:
      typeof candidate.entityText === "string" ? candidate.entityText : null,
    role: candidate.role ?? null,
    candidates: Array.isArray(candidate.candidates)
      ? structuredClone(candidate.candidates).slice(0, 8)
      : [],
    required: candidate.required !== false,
    resolved: Boolean(candidate.resolved),
    resolution: candidate.resolution ?? null,
  };
}

function normalizePrompt(
  value: unknown,
  issue: EchoClarificationIssue | undefined,
  timestamp: string,
  settings: EchoClarificationSettings,
): EchoClarificationPrompt | null {
  if (!value || typeof value !== "object") {
    return createPrompt(issue, timestamp, settings);
  }
  const candidate = value as Partial<EchoClarificationPrompt>;
  if (!candidate.question || !issue)
    return createPrompt(issue, timestamp, settings);
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-clarification-prompt"),
    issueId: issue.id,
    type: issue.type,
    question: candidate.question.slice(0, 120),
    candidateLabels: Array.isArray(candidate.candidateLabels)
      ? candidate.candidateLabels.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : issue.candidates.map((entry) => entry.label),
    concise: true,
    ariaLive: candidate.ariaLive === "assertive" ? "assertive" : "polite",
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    expiresAt:
      typeof candidate.expiresAt === "string"
        ? candidate.expiresAt
        : addMilliseconds(timestamp, settings.clarificationTimeoutMs),
    accessibilityAnnouncement:
      typeof candidate.accessibilityAnnouncement === "string"
        ? candidate.accessibilityAnnouncement
        : candidate.question,
  };
}

function normalizeAnswer(value: unknown): EchoClarificationAnswer | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoClarificationAnswer>;
  if (typeof candidate.text !== "string") return null;
  return {
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("echo-clarification-answer"),
    issueId:
      typeof candidate.issueId === "string"
        ? candidate.issueId
        : makeId("echo-clarification-issue"),
    receivedAt:
      typeof candidate.receivedAt === "string"
        ? candidate.receivedAt
        : new Date().toISOString(),
    text: candidate.text.slice(0, 160),
    normalizedText: normalizeText(candidate.normalizedText ?? candidate.text),
    accepted: Boolean(candidate.accepted),
    resolvedCandidateId:
      typeof candidate.resolvedCandidateId === "string"
        ? candidate.resolvedCandidateId
        : null,
    resolvedEntity: candidate.resolvedEntity ?? null,
    quantity:
      typeof candidate.quantity === "number" ? candidate.quantity : null,
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}

function createClarificationDiagnostics(
  input: Partial<EchoClarificationDiagnostics> | null,
): EchoClarificationDiagnostics {
  return {
    version: ECHO_CLARIFICATION_VERSION,
    activeSessionId: input?.activeSessionId ?? null,
    lastSessionId: input?.lastSessionId ?? null,
    lastAction: input?.lastAction ?? null,
    pendingIssueCount: input?.pendingIssueCount ?? 0,
    resolvedIssueCount: input?.resolvedIssueCount ?? 0,
    lastPrompt: input?.lastPrompt ?? null,
    lastError: input?.lastError ?? null,
    timeoutMs: input?.timeoutMs ?? DEFAULT_CLARIFICATION_TIMEOUT_MS,
    directBattlefieldMutation: false,
  };
}

function normalizeDecisionConfidence(
  input: EchoClarificationDecisionInput,
  timestamp: string,
): AmbientConfidenceAssessment {
  if (input.confidence) return input.confidence;
  return normalizeAmbientConfidence(input.intent.confidence, {
    source: input.intent.source,
    timestamp,
    contextValid: true,
    rulesValid: true,
    warningCount: 0,
  });
}

function clarificationTypeFromEntityResult(
  result: EchoEntityResolutionResult,
): EchoClarificationType {
  const first = result.ambiguities[0]?.type;
  if (first === "multiple-token-stacks") return "multiple-token-stacks";
  if (first === "multiple-battlefield-objects") {
    return result.candidates
      .slice(0, 2)
      .every(
        (candidate, index, candidates) =>
          index === 0 ||
          candidate.normalizedLabel === candidates[0].normalizedLabel,
      )
      ? "similar-permanent-names"
      : "multiple-battlefield-objects";
  }
  if (first === "multiple-players") return "ambiguous-player-reference";
  if (result.status === "missing") return "unknown-card-reference";
  return "multiple-legal-interpretations";
}

function questionForEntityResult(
  result: EchoEntityResolutionResult,
  type: EchoClarificationType,
): string {
  if (type === "multiple-token-stacks") {
    const token = result.candidates[0]?.label ?? result.text;
    return `Which ${token} token?`;
  }
  if (type === "ambiguous-player-reference") return "Which opponent?";
  if (type === "similar-permanent-names") {
    return `Which ${result.candidates[0]?.label ?? result.text}?`;
  }
  if (type === "unknown-card-reference") return `Which ${result.text}?`;
  return `Which ${result.text}?`;
}

function targetQuestion(kind: AmbientIntentKind, text: string | null): string {
  if (text && isPronoun(text)) return "Which permanent?";
  if (kind === "add-counters" || kind === "remove-counters") {
    return "Which target?";
  }
  if (kind === "equip") return "Equip to which creature?";
  if (kind === "attach") return "Attach to which permanent?";
  return "Which permanent?";
}

function roleFromResult(
  intent: AmbientIntentInput | AmbientIntent,
  result: EchoEntityResolutionResult,
): EchoClarificationIssue["role"] {
  const payload = intent.payload ?? {};
  if (result.text === payload.counterName) return "counter";
  if (intent.kind === "equip" || intent.kind === "attach") return "target";
  return "target";
}

function chooseCandidateFromAnswer(
  candidates: EchoEntityResolutionCandidate[],
  normalizedText: string,
): EchoEntityResolutionCandidate | null {
  const ordinal = parseQuantity(normalizedText);
  if (ordinal !== null && ordinal !== 0) {
    const index = ordinal < 0 ? candidates.length - 1 : ordinal - 1;
    return candidates[index] ?? null;
  }
  const matches = candidates.filter((candidate) => {
    const label = normalizeText(candidate.label);
    return (
      label === normalizedText ||
      label.includes(normalizedText) ||
      normalizedText.includes(label) ||
      candidate.normalizedLabel.includes(normalizedText)
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

function clarificationCandidates(
  candidates: EchoEntityResolutionCandidate[],
): EchoEntityResolutionCandidate[] {
  const byKey = new Map<string, EchoEntityResolutionCandidate>();
  for (const candidate of candidates) {
    const key =
      candidate.groupId ??
      candidate.cardId ??
      `${candidate.kind}:${candidate.normalizedLabel}`;
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].slice(0, 6);
}

function dedupeIssues(
  issues: EchoClarificationIssue[],
): EchoClarificationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.entityText ?? ""}:${issue.question}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEntityReferences(
  references: AmbientEntityReference[],
): AmbientEntityReference[] {
  const seen = new Set<string>();
  const deduped: AmbientEntityReference[] = [];
  for (const reference of references) {
    const key = JSON.stringify(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}

function actionPhrase(kind: AmbientIntentKind): string {
  return kind.replace(/-/g, " ");
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['`]/g, "")
    .replace(/[^a-zA-Z0-9+/-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function numericPayload(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseQuantity(value: string): number | null {
  const normalized = normalizeText(value);
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  return NUMBER_WORDS[normalized] ?? null;
}

function isPronoun(value: string | null): boolean {
  if (!value) return false;
  return ["it", "that", "this", "them", "those", "one"].includes(
    normalizeText(value),
  );
}

function isAffirmative(value: string): boolean {
  return ["yes", "yeah", "yep", "correct", "confirm", "do it"].includes(value);
}

function isNegative(value: string): boolean {
  return ["no", "nope", "cancel", "wrong", "stop"].includes(value);
}

function normalizeSensitivity(value: unknown): EchoConfirmationSensitivity {
  return value === "conservative" ||
    value === "balanced" ||
    value === "streamlined"
    ? value
    : "balanced";
}

function thresholdsForSensitivity(
  sensitivity: EchoConfirmationSensitivity,
): Pick<
  EchoClarificationSettings,
  "automaticExecutionThreshold" | "quickConfirmationThreshold"
> {
  if (sensitivity === "conservative") {
    return {
      automaticExecutionThreshold: 0.92,
      quickConfirmationThreshold: 0.72,
    };
  }
  if (sensitivity === "streamlined") {
    return {
      automaticExecutionThreshold: 0.8,
      quickConfirmationThreshold: 0.56,
    };
  }
  return {
    automaticExecutionThreshold: 0.86,
    quickConfirmationThreshold: 0.62,
  };
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function clampFraction(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

function normalizeSessionStatus(
  value: unknown,
): EchoClarificationSessionStatus {
  return value === "pending" ||
    value === "awaiting-response" ||
    value === "resolved" ||
    value === "confirmed" ||
    value === "cancelled" ||
    value === "timed-out" ||
    value === "recovered" ||
    value === "rejected" ||
    value === "deferred"
    ? value
    : "recovered";
}

function isTerminalStatus(status: EchoClarificationSessionStatus): boolean {
  return (
    status === "resolved" ||
    status === "confirmed" ||
    status === "cancelled" ||
    status === "timed-out" ||
    status === "recovered" ||
    status === "rejected" ||
    status === "deferred"
  );
}

function statusToAction(
  status: EchoClarificationSessionStatus,
): EchoClarificationDecisionAction {
  if (status === "resolved" || status === "confirmed") return "accepted";
  if (status === "rejected") return "rejected";
  if (status === "deferred") return "deferred";
  return "clarified";
}

function createFallbackFieldShape(): FieldState {
  return {
    id: "clarification-fallback-field",
    schemaVersion: 1,
    session: { id: "clarification-fallback-session" },
    ambient: { currentMode: "passive" },
    contextualListening: { activeWindowId: null, windows: [] },
    preTurnPlanner: { actions: [] },
    activeTurnActionStrip: { items: [] },
    groups: [],
  } as unknown as FieldState;
}
