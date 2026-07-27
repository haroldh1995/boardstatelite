import { makeId } from "../domain/cards";
import type { FieldState } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import {
  ECHO_PERSONAL_GAMEPLAY_VERSION,
  type EchoPersonalGameplayContextSignal,
  type EchoPersonalGameplayDiagnostics,
  type EchoPersonalGameplayInteractionSignal,
  type EchoPersonalGameplayObservation,
  type EchoPersonalGameplayObservationStatus,
  type EchoPersonalGameplayPreferences,
  type EchoPersonalGameplayPreference,
  type EchoPersonalGameplaySettings,
  type EchoPersonalGameplayState,
  type EchoPredictiveWorkflowPreparation,
  type EchoPredictiveWorkflowTarget,
  type EchoSmartSuggestion,
  type EchoSmartSuggestionKind,
  type EchoSmartSuggestionStatus,
} from "./personalGameplayTypes";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const NORMALIZATION_LIMIT = 120;
const STRATEGY_TERMS = [
  "best play",
  "best attack",
  "optimal",
  "win rate",
  "mulligan",
  "deck optimization",
  "should attack",
  "opponent tendency",
  "line of play",
];

export function createDefaultPersonalGameplaySettings(
  input: Partial<EchoPersonalGameplaySettings> = {},
): EchoPersonalGameplaySettings {
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    enabled: input.enabled ?? true,
    smartSuggestionsEnabled: input.smartSuggestionsEnabled ?? true,
    adaptiveInterfaceEnabled: input.adaptiveInterfaceEnabled ?? true,
    predictiveIntentAssistanceEnabled:
      input.predictiveIntentAssistanceEnabled ?? true,
    automaticLearningEnabled: input.automaticLearningEnabled ?? true,
    learningSensitivity: normalizeLearningSensitivity(
      input.learningSensitivity,
    ),
    minimumObservations: clampInteger(input.minimumObservations, 2, 20, 3),
    maxObservationRecords: clampInteger(
      input.maxObservationRecords,
      10,
      1000,
      160,
    ),
    maxSuggestions: clampInteger(input.maxSuggestions, 1, 12, 4),
    suggestionTtlMs: clampInteger(
      input.suggestionTtlMs,
      10_000,
      600_000,
      90_000,
    ),
    resumeWindowMs: clampInteger(
      input.resumeWindowMs,
      30_000,
      3_600_000,
      600_000,
    ),
    importExportPrepared: true,
    privacyControlsPrepared: true,
    localOnly: true,
    rawAudioRetained: false,
    transcriptsRetained: false,
    strategicAnalysisEnabled: false,
    deckOptimizationEnabled: false,
    gameplayAutomationEnabled: false,
    lastResetAt:
      typeof input.lastResetAt === "string" ? input.lastResetAt : null,
  };
}

export function normalizePersonalGameplaySettings(
  value: unknown,
): EchoPersonalGameplaySettings {
  const defaults = createDefaultPersonalGameplaySettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoPersonalGameplaySettings>;
  return {
    ...defaults,
    enabled:
      candidate.enabled === undefined
        ? defaults.enabled
        : Boolean(candidate.enabled),
    smartSuggestionsEnabled:
      candidate.smartSuggestionsEnabled === undefined
        ? defaults.smartSuggestionsEnabled
        : Boolean(candidate.smartSuggestionsEnabled),
    adaptiveInterfaceEnabled:
      candidate.adaptiveInterfaceEnabled === undefined
        ? defaults.adaptiveInterfaceEnabled
        : Boolean(candidate.adaptiveInterfaceEnabled),
    predictiveIntentAssistanceEnabled:
      candidate.predictiveIntentAssistanceEnabled === undefined
        ? defaults.predictiveIntentAssistanceEnabled
        : Boolean(candidate.predictiveIntentAssistanceEnabled),
    automaticLearningEnabled:
      candidate.automaticLearningEnabled === undefined
        ? defaults.automaticLearningEnabled
        : Boolean(candidate.automaticLearningEnabled),
    learningSensitivity: normalizeLearningSensitivity(
      candidate.learningSensitivity,
    ),
    minimumObservations: clampInteger(
      candidate.minimumObservations,
      2,
      20,
      defaults.minimumObservations,
    ),
    maxObservationRecords: clampInteger(
      candidate.maxObservationRecords,
      10,
      1000,
      defaults.maxObservationRecords,
    ),
    maxSuggestions: clampInteger(
      candidate.maxSuggestions,
      1,
      12,
      defaults.maxSuggestions,
    ),
    suggestionTtlMs: clampInteger(
      candidate.suggestionTtlMs,
      10_000,
      600_000,
      defaults.suggestionTtlMs,
    ),
    resumeWindowMs: clampInteger(
      candidate.resumeWindowMs,
      30_000,
      3_600_000,
      defaults.resumeWindowMs,
    ),
    importExportPrepared: true,
    privacyControlsPrepared: true,
    localOnly: true,
    rawAudioRetained: false,
    transcriptsRetained: false,
    strategicAnalysisEnabled: false,
    deckOptimizationEnabled: false,
    gameplayAutomationEnabled: false,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultPersonalGameplayState(
  input: Partial<EchoPersonalGameplayState> = {},
): EchoPersonalGameplayState {
  const preferences = normalizePersonalGameplayPreferences(input.preferences);
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    observations: [],
    suggestions: [],
    interruptedWorkflow: null,
    ...input,
    preferences,
    diagnostics: createPersonalGameplayDiagnostics({
      ...(input.diagnostics ?? {}),
      activeObservationCount:
        input.diagnostics?.activeObservationCount ??
        countObservations(input.observations ?? [], "active"),
      candidateObservationCount:
        input.diagnostics?.candidateObservationCount ??
        countObservations(input.observations ?? [], "candidate"),
      availableSuggestionCount:
        input.diagnostics?.availableSuggestionCount ??
        countSuggestions(input.suggestions ?? [], "available"),
    }),
  };
}

export function normalizePersonalGameplayState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoPersonalGameplaySettings;
    sessionId?: string | null;
    knownSuggestionIds?: string[];
  } = {},
): EchoPersonalGameplayState {
  const settings = normalizePersonalGameplaySettings(options.settings);
  const timestamp = options.fallbackTimestamp ?? DEFAULT_TIMESTAMP;
  if (!value || typeof value !== "object") {
    return createDefaultPersonalGameplayState();
  }
  const candidate = value as Partial<EchoPersonalGameplayState>;
  const observations = Array.isArray(candidate.observations)
    ? candidate.observations
        .map((entry) => normalizeObservation(entry, timestamp))
        .filter((entry): entry is EchoPersonalGameplayObservation =>
          Boolean(entry),
        )
        .slice(0, settings.maxObservationRecords)
    : [];
  const suggestions = Array.isArray(candidate.suggestions)
    ? candidate.suggestions
        .map((entry) => normalizeSuggestion(entry, timestamp))
        .filter((entry): entry is EchoSmartSuggestion => Boolean(entry))
        .slice(0, settings.maxSuggestions)
    : [];
  const interruptedWorkflow = normalizeInterruptedWorkflow(
    candidate.interruptedWorkflow,
    timestamp,
  );
  return createDefaultPersonalGameplayState({
    observations,
    suggestions,
    interruptedWorkflow,
    preferences: normalizePersonalGameplayPreferences(candidate.preferences),
    diagnostics: createPersonalGameplayDiagnostics({
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      activeObservationCount: countObservations(observations, "active"),
      candidateObservationCount: countObservations(observations, "candidate"),
      availableSuggestionCount: countSuggestions(suggestions, "available"),
      dismissedSuggestionCount: countSuggestions(suggestions, "dismissed"),
      acceptedSuggestionCount: countSuggestions(suggestions, "accepted"),
      rawAudioRetained: false,
      transcriptsRetained: false,
      strategicAnalysisEnabled: false,
      deckOptimizationEnabled: false,
      gameplayAutomationEnabled: false,
      directBattlefieldMutation: false,
    }),
  });
}

export function observePersonalGameplaySignal(
  state: EchoPersonalGameplayState,
  signal: EchoPersonalGameplayInteractionSignal,
  options: {
    settings?: EchoPersonalGameplaySettings;
    field?: FieldState;
    timestamp?: string;
  } = {},
): {
  state: EchoPersonalGameplayState;
  observation: EchoPersonalGameplayObservation | null;
  suggestions: EchoSmartSuggestion[];
  preparation: EchoPredictiveWorkflowPreparation;
} {
  const settings = normalizePersonalGameplaySettings(options.settings);
  const timestamp =
    options.timestamp ?? signal.timestamp ?? new Date().toISOString();
  const normalized = normalizePersonalGameplayState(state, {
    settings,
    fallbackTimestamp: timestamp,
    sessionId: options.field?.session.id ?? signal.context?.sessionId ?? null,
  });
  const label = sanitizeLabel(signal.label);
  const normalizedLabel = normalizePersonalGameplayText(label);
  if (
    !settings.enabled ||
    !settings.automaticLearningEnabled ||
    !normalizedLabel ||
    isStrategicLabel(normalizedLabel)
  ) {
    const preparation = createNoopPreparation(
      "interfaceShortcut",
      "Personal gameplay signal ignored safely.",
    );
    return {
      state: withDiagnostics(normalized, {
        lastDecision: "ignored",
        lastReason:
          "Signal ignored because personalization is disabled, empty, or strategic.",
      }),
      observation: null,
      suggestions: [],
      preparation,
    };
  }

  const context = normalizeContextSignal(signal.context, options.field);
  const key = observationKey(signal.kind, normalizedLabel, context);
  const existing = normalized.observations.find((entry) => entry.key === key);
  const observationCount = (existing?.observationCount ?? 0) + 1;
  const successfulCount =
    (existing?.successfulCount ?? 0) +
    (isSuccessfulOutcome(signal.outcome) ? 1 : 0);
  const correctionCount =
    (existing?.correctionCount ?? 0) + (signal.outcome === "corrected" ? 1 : 0);
  const dismissalCount =
    (existing?.dismissalCount ?? 0) + (signal.outcome === "dismissed" ? 1 : 0);
  const interruptionCount =
    (existing?.interruptionCount ?? 0) +
    (signal.outcome === "interrupted" ? 1 : 0);
  const status = observationStatusForSignal(
    settings,
    successfulCount,
    interruptionCount,
    signal,
  );
  const observation: EchoPersonalGameplayObservation = {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id: existing?.id ?? makeId("echo-personal-gameplay"),
    key,
    kind: signal.kind,
    source: signal.source,
    label,
    normalizedLabel,
    context,
    status,
    firstObservedAt: existing?.firstObservedAt ?? timestamp,
    lastObservedAt: timestamp,
    observationCount,
    successfulCount,
    correctionCount,
    dismissalCount,
    interruptionCount,
    averageDurationMs: averageDuration(
      existing?.averageDurationMs ?? null,
      existing?.observationCount ?? 0,
      signal.durationMs ?? null,
    ),
    confidenceBoost:
      status === "active"
        ? Math.min(0.24, 0.04 + successfulCount * boostStep(settings))
        : 0,
    userEditable: true,
    localOnly: true,
    strategicRecommendation: false,
  };

  const observations = [
    observation,
    ...normalized.observations.filter((entry) => entry.key !== key),
  ].slice(0, settings.maxObservationRecords);
  const preferences = adaptPreferences(
    normalized.preferences,
    observation,
    settings,
    timestamp,
  );
  const interruptedWorkflow =
    signal.outcome === "interrupted" && context.workflow
      ? {
          id: makeId("echo-interrupted-workflow"),
          workflow: context.workflow,
          interruptedAt: timestamp,
          expiresAt: addMilliseconds(timestamp, settings.resumeWindowMs),
          reason: `${label} was interrupted.`,
          resumeSessionId: context.sessionId,
          localOnly: true as const,
          strategicRecommendation: false as const,
        }
      : normalized.interruptedWorkflow;
  const baseState = createDefaultPersonalGameplayState({
    ...normalized,
    observations,
    preferences,
    interruptedWorkflow,
    diagnostics: createPersonalGameplayDiagnostics({
      ...normalized.diagnostics,
      activeObservationCount: countObservations(observations, "active"),
      candidateObservationCount: countObservations(observations, "candidate"),
      lastObservedAt: timestamp,
      lastDecision: status === "active" ? "activated" : "observed",
      lastReason:
        status === "active"
          ? "Repeated non-strategic interaction pattern activated."
          : "Non-strategic interaction pattern observed.",
    }),
  });
  const preparation = preparePredictiveIntentAssistance(options.field, {
    signal,
    observation,
    settings,
    timestamp,
  });
  const withSuggestions = generatePersonalGameplaySuggestions(baseState, {
    field: options.field,
    signal,
    observation,
    preparation,
    settings,
    timestamp,
  });
  return {
    state: withSuggestions,
    observation,
    suggestions: withSuggestions.suggestions.filter(
      (entry) => entry.status === "available",
    ),
    preparation,
  };
}

export function generatePersonalGameplaySuggestions(
  state: EchoPersonalGameplayState,
  options: {
    field?: FieldState;
    signal?: EchoPersonalGameplayInteractionSignal;
    observation?: EchoPersonalGameplayObservation | null;
    preparation?: EchoPredictiveWorkflowPreparation;
    settings?: EchoPersonalGameplaySettings;
    timestamp?: string;
  } = {},
): EchoPersonalGameplayState {
  const settings = normalizePersonalGameplaySettings(options.settings);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizePersonalGameplayState(state, {
    settings,
    fallbackTimestamp: timestamp,
    sessionId: options.field?.session.id ?? null,
  });
  if (
    !settings.enabled ||
    !settings.smartSuggestionsEnabled ||
    !options.preparation ||
    options.preparation.status !== "prepared" ||
    options.observation?.status !== "active"
  ) {
    return pruneExpiredSuggestions(normalized, timestamp);
  }
  const suggestion = suggestionFromPreparation(
    options.preparation,
    options.observation,
    settings,
    timestamp,
  );
  if (!suggestion) return pruneExpiredSuggestions(normalized, timestamp);
  const existing = normalized.suggestions.find(
    (entry) =>
      entry.kind === suggestion.kind &&
      entry.preparation.workflow === suggestion.preparation.workflow &&
      entry.status === "available",
  );
  const suggestions = [
    existing
      ? {
          ...existing,
          updatedAt: timestamp,
          expiresAt: suggestion.expiresAt,
          priority: Math.max(existing.priority, suggestion.priority),
        }
      : suggestion,
    ...normalized.suggestions.filter((entry) => entry.id !== existing?.id),
  ]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, settings.maxSuggestions);
  return createDefaultPersonalGameplayState({
    ...normalized,
    suggestions,
    diagnostics: createPersonalGameplayDiagnostics({
      ...normalized.diagnostics,
      availableSuggestionCount: countSuggestions(suggestions, "available"),
      dismissedSuggestionCount: countSuggestions(suggestions, "dismissed"),
      acceptedSuggestionCount: countSuggestions(suggestions, "accepted"),
      lastSuggestionAt: timestamp,
      lastDecision: "suggested",
      lastReason: "Prepared a non-blocking smart suggestion.",
    }),
  });
}

export function preparePredictiveIntentAssistance(
  field: FieldState | undefined,
  input: {
    signal?: EchoPersonalGameplayInteractionSignal;
    observation?: EchoPersonalGameplayObservation | null;
    settings?: EchoPersonalGameplaySettings;
    timestamp?: string;
  } = {},
): EchoPredictiveWorkflowPreparation {
  const settings = normalizePersonalGameplaySettings(input.settings);
  if (!settings.enabled || !settings.predictiveIntentAssistanceEnabled) {
    return createNoopPreparation(
      "interfaceShortcut",
      "Predictive intent assistance is disabled.",
    );
  }
  const timestamp = input.timestamp ?? new Date().toISOString();
  const signalText = normalizePersonalGameplayText(input.signal?.label ?? "");
  const workflow =
    input.observation?.context.workflow ??
    input.signal?.context?.workflow ??
    workflowFromText(signalText, field?.ambient.currentMode ?? null);
  if (!workflow) {
    return createNoopPreparation(
      "interfaceShortcut",
      "No relevant workflow preparation was needed.",
    );
  }
  const nextPlannerAction = field?.preTurnPlanner.actions.find(
    (action) => action.status === "planned",
  );
  const nextActionStripItem = field?.activeTurnActionStrip.items.find(
    (item) => item.status === "current" || item.status === "pending",
  );
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id: makeId("echo-workflow-prep"),
    status: "prepared",
    workflow,
    suggestedAmbientMode: ambientModeForWorkflow(workflow),
    suggestedListeningWindow: listeningWindowForWorkflow(workflow),
    suggestedPlannerActionId:
      workflow === "plannerStep" ? (nextPlannerAction?.id ?? null) : null,
    suggestedActionStripItemId:
      workflow === "actionStrip" ? (nextActionStripItem?.id ?? null) : null,
    resumeSessionId:
      workflow === "voiceSessionResume"
        ? (field?.personalGameplay.interruptedWorkflow?.resumeSessionId ?? null)
        : null,
    reason: reasonForWorkflow(workflow, timestamp),
    requiresUserAction: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

export function acceptPersonalGameplaySuggestion(
  state: EchoPersonalGameplayState,
  suggestionId: string,
  options: {
    timestamp?: string;
    settings?: EchoPersonalGameplaySettings;
  } = {},
): EchoPersonalGameplayState {
  return updateSuggestionStatus(state, suggestionId, "accepted", options);
}

export function dismissPersonalGameplaySuggestion(
  state: EchoPersonalGameplayState,
  suggestionId: string,
  options: {
    timestamp?: string;
    settings?: EchoPersonalGameplaySettings;
  } = {},
): EchoPersonalGameplayState {
  return updateSuggestionStatus(state, suggestionId, "dismissed", options);
}

export function resetPersonalGameplayState(
  options: {
    timestamp?: string;
    settings?: EchoPersonalGameplaySettings;
  } = {},
): EchoPersonalGameplayState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return createDefaultPersonalGameplayState({
    diagnostics: createPersonalGameplayDiagnostics({
      lastResetAt: timestamp,
      lastDecision: "reset",
      lastReason: "Personal gameplay personalization reset.",
    }),
  });
}

export function activePersonalGameplaySuggestions(
  state: EchoPersonalGameplayState,
  options: {
    timestamp?: string;
    settings?: EchoPersonalGameplaySettings;
  } = {},
): EchoSmartSuggestion[] {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return pruneExpiredSuggestions(
    normalizePersonalGameplayState(state, {
      settings: options.settings,
      fallbackTimestamp: timestamp,
    }),
    timestamp,
  ).suggestions.filter((entry) => entry.status === "available");
}

export function normalizePersonalGameplayText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9+/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NORMALIZATION_LIMIT);
}

export function personalGameplaySignalForCommit(
  field: FieldState,
  label: string,
  summary: string[] = [],
  timestamp = new Date().toISOString(),
): EchoPersonalGameplayInteractionSignal {
  const normalized = normalizePersonalGameplayText(
    [label, ...summary].join(" "),
  );
  const workflow = workflowFromCommitLabel(label, normalized);
  return {
    kind: kindFromCommitLabel(label, normalized),
    source: sourceFromCommitLabel(label),
    outcome: "completed",
    label,
    context: {
      ambientMode: field.ambient.currentMode,
      listeningWindow:
        field.contextualListening.windows.find(
          (window) => window.id === field.contextualListening.activeWindowId,
        )?.kind ?? null,
      workflow,
      sourceSurface: surfaceFromCommitLabel(label),
      actionKind: label,
      sessionId: field.session.id,
    },
    timestamp,
  };
}

function updateSuggestionStatus(
  state: EchoPersonalGameplayState,
  suggestionId: string,
  status: "accepted" | "dismissed",
  options: {
    timestamp?: string;
    settings?: EchoPersonalGameplaySettings;
  },
): EchoPersonalGameplayState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizePersonalGameplayState(state, {
    settings: options.settings,
    fallbackTimestamp: timestamp,
  });
  const suggestions = normalized.suggestions.map((entry) =>
    entry.id === suggestionId
      ? {
          ...entry,
          status,
          updatedAt: timestamp,
          acceptedAt: status === "accepted" ? timestamp : entry.acceptedAt,
          dismissedAt: status === "dismissed" ? timestamp : entry.dismissedAt,
        }
      : entry,
  );
  return createDefaultPersonalGameplayState({
    ...normalized,
    suggestions,
    diagnostics: createPersonalGameplayDiagnostics({
      ...normalized.diagnostics,
      availableSuggestionCount: countSuggestions(suggestions, "available"),
      dismissedSuggestionCount: countSuggestions(suggestions, "dismissed"),
      acceptedSuggestionCount: countSuggestions(suggestions, "accepted"),
      lastDecision: status,
      lastReason:
        status === "accepted"
          ? "Smart suggestion accepted by the player."
          : "Smart suggestion dismissed by the player.",
    }),
  });
}

function suggestionFromPreparation(
  preparation: EchoPredictiveWorkflowPreparation,
  observation: EchoPersonalGameplayObservation,
  settings: EchoPersonalGameplaySettings,
  timestamp: string,
): EchoSmartSuggestion | null {
  const kind = suggestionKindForWorkflow(preparation.workflow);
  if (!kind) return null;
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id: makeId("echo-smart-suggestion"),
    kind,
    status: "available",
    message: messageForSuggestion(kind),
    detail: preparation.reason,
    priority: Math.round(50 + observation.confidenceBoost * 100),
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: addMilliseconds(timestamp, settings.suggestionTtlMs),
    dismissedAt: null,
    acceptedAt: null,
    sourceObservationIds: [observation.id],
    preparation,
    requiresUserAction: true,
    nonBlocking: true,
    dismissible: true,
    localOnly: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function messageForSuggestion(kind: EchoSmartSuggestionKind): string {
  if (kind === "prepare-combat-declaration") return "Ready to report combat?";
  if (kind === "prepare-combat-resolution")
    return "Ready to report combat results?";
  if (kind === "prepare-listening-window")
    return "Prepare the relevant listening window?";
  if (kind === "continue-planner-step")
    return "Continue with the next planned step?";
  if (kind === "resume-workflow") return "Resume the previous workflow?";
  if (kind === "confirmation-preference")
    return "Use your usual confirmation flow?";
  return "Use a frequent interface shortcut?";
}

function suggestionKindForWorkflow(
  workflow: EchoPredictiveWorkflowTarget,
): EchoSmartSuggestionKind | null {
  if (workflow === "combatDeclaration") return "prepare-combat-declaration";
  if (workflow === "combatResolution") return "prepare-combat-resolution";
  if (workflow === "listeningWindow") return "prepare-listening-window";
  if (workflow === "plannerStep") return "continue-planner-step";
  if (workflow === "voiceSessionResume") return "resume-workflow";
  if (workflow === "confirmationPreference") return "confirmation-preference";
  if (workflow === "interfaceShortcut") return "interface-shortcut";
  if (workflow === "actionStrip") return "continue-planner-step";
  return null;
}

function workflowFromText(
  text: string,
  ambientMode: AmbientGameplayMode | null,
): EchoPredictiveWorkflowTarget | null {
  if (text.includes("combat")) {
    if (text.includes("resolution") || text.includes("damage")) {
      return "combatResolution";
    }
    return "combatDeclaration";
  }
  if (text.includes("land") || text.includes("spell") || text.includes("token"))
    return "listeningWindow";
  if (text.includes("planner") || text.includes("planned"))
    return "plannerStep";
  if (text.includes("confirm") || text.includes("preview"))
    return "confirmationPreference";
  if (ambientMode === "combat") return "combatDeclaration";
  if (ambientMode === "preTurnPreparation") return "plannerStep";
  if (ambientMode === "activeTurn") return "actionStrip";
  return null;
}

function workflowFromCommitLabel(
  label: string,
  normalized: string,
): EchoPredictiveWorkflowTarget | null {
  if (/action strip/i.test(label)) return "actionStrip";
  if (/planner/i.test(label)) return "plannerStep";
  if (/voice/i.test(label) && normalized.includes("combat"))
    return "combatDeclaration";
  if (/activate field/i.test(label)) return "listeningWindow";
  if (/settings/i.test(label)) return "interfaceShortcut";
  return workflowFromText(normalized, null);
}

function kindFromCommitLabel(
  label: string,
  normalized: string,
): EchoPersonalGameplayInteractionSignal["kind"] {
  if (/planner/i.test(label)) return "planner-action";
  if (/action strip/i.test(label)) return "action-strip";
  if (/settings|voice/i.test(label)) return "screen-access";
  if (normalized.includes("confirmation") || normalized.includes("preview"))
    return "confirmation-behavior";
  if (normalized.includes("reminder")) return "reminder-usage";
  return "interface-flow";
}

function sourceFromCommitLabel(
  label: string,
): EchoPersonalGameplayInteractionSignal["source"] {
  if (/planner/i.test(label)) return "planner";
  if (/action strip/i.test(label)) return "action-strip";
  if (/voice/i.test(label)) return "voice-framework";
  if (/ambient/i.test(label)) return "ambient-engine";
  if (/settings/i.test(label)) return "settings";
  return "manual-ui";
}

function surfaceFromCommitLabel(label: string): string {
  if (/planner/i.test(label)) return "planner";
  if (/action strip/i.test(label)) return "action-strip";
  if (/voice/i.test(label)) return "voice";
  if (/settings/i.test(label)) return "settings";
  if (/activate field/i.test(label)) return "battlefield";
  return "field";
}

function ambientModeForWorkflow(
  workflow: EchoPredictiveWorkflowTarget,
): AmbientGameplayMode | null {
  if (workflow === "combatDeclaration" || workflow === "combatResolution")
    return "combat";
  if (workflow === "plannerStep") return "preTurnPreparation";
  if (workflow === "actionStrip") return "activeTurn";
  return null;
}

function listeningWindowForWorkflow(
  workflow: EchoPredictiveWorkflowTarget,
): EchoListeningWindowKind | null {
  if (workflow === "combatDeclaration") return "combatDeclaration";
  if (workflow === "combatResolution") return "combatResolution";
  if (workflow === "plannerStep") return "generalGameplay";
  if (workflow === "actionStrip") return "generalGameplay";
  if (workflow === "listeningWindow") return "generalGameplay";
  return null;
}

function reasonForWorkflow(
  workflow: EchoPredictiveWorkflowTarget,
  timestamp: string,
): string {
  if (workflow === "combatDeclaration")
    return "Prepared combat declaration workflow without declaring attackers.";
  if (workflow === "combatResolution")
    return "Prepared combat result reporting without calculating outcomes.";
  if (workflow === "plannerStep")
    return "Prepared the next planner step without executing it.";
  if (workflow === "actionStrip")
    return "Prepared Action Strip context without completing any item.";
  if (workflow === "voiceSessionResume")
    return "Prepared interrupted workflow resume prompt.";
  if (workflow === "confirmationPreference")
    return "Prepared familiar confirmation behavior for user approval.";
  return `Prepared interface context at ${timestamp}.`;
}

function createNoopPreparation(
  workflow: EchoPredictiveWorkflowTarget,
  reason: string,
): EchoPredictiveWorkflowPreparation {
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id: makeId("echo-workflow-prep"),
    status: "not-needed",
    workflow,
    suggestedAmbientMode: null,
    suggestedListeningWindow: null,
    suggestedPlannerActionId: null,
    suggestedActionStripItemId: null,
    resumeSessionId: null,
    reason,
    requiresUserAction: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function pruneExpiredSuggestions(
  state: EchoPersonalGameplayState,
  timestamp: string,
): EchoPersonalGameplayState {
  const now = Date.parse(timestamp);
  const suggestions = state.suggestions.map((entry) =>
    entry.status === "available" && Date.parse(entry.expiresAt) <= now
      ? { ...entry, status: "expired" as const, updatedAt: timestamp }
      : entry,
  );
  return createDefaultPersonalGameplayState({
    ...state,
    suggestions,
    diagnostics: createPersonalGameplayDiagnostics({
      ...state.diagnostics,
      availableSuggestionCount: countSuggestions(suggestions, "available"),
      dismissedSuggestionCount: countSuggestions(suggestions, "dismissed"),
      acceptedSuggestionCount: countSuggestions(suggestions, "accepted"),
    }),
  });
}

function adaptPreferences(
  preferences: EchoPersonalGameplayPreferences,
  observation: EchoPersonalGameplayObservation,
  settings: EchoPersonalGameplaySettings,
  timestamp: string,
): EchoPersonalGameplayPreferences {
  if (!settings.adaptiveInterfaceEnabled || observation.status !== "active") {
    return preferences;
  }
  const text = observation.normalizedLabel;
  return {
    ...preferences,
    confirmationPath:
      observation.kind === "confirmation-behavior"
        ? updatePreference(
            preferences.confirmationPath,
            text.includes("preview")
              ? "preview"
              : text.includes("confirm")
                ? "confirmation"
                : "balanced",
            timestamp,
          )
        : preferences.confirmationPath,
    listeningTailDurationMs:
      observation.kind === "listening-duration" && observation.averageDurationMs
        ? updatePreference(
            preferences.listeningTailDurationMs,
            clampInteger(observation.averageDurationMs, 1000, 9000, 3000),
            timestamp,
          )
        : preferences.listeningTailDurationMs,
    clarificationStyle:
      observation.kind === "correction-pattern"
        ? updatePreference(preferences.clarificationStyle, "concise", timestamp)
        : preferences.clarificationStyle,
    previewVisibility:
      observation.kind === "confirmation-behavior" && text.includes("preview")
        ? updatePreference(preferences.previewVisibility, "expanded", timestamp)
        : preferences.previewVisibility,
    actionStripPresentation:
      observation.kind === "action-strip"
        ? updatePreference(
            preferences.actionStripPresentation,
            "expanded",
            timestamp,
          )
        : preferences.actionStripPresentation,
    plannerPresentation:
      observation.kind === "planner-action"
        ? updatePreference(
            preferences.plannerPresentation,
            "expanded",
            timestamp,
          )
        : preferences.plannerPresentation,
  };
}

function updatePreference<T extends string | number>(
  preference: EchoPersonalGameplayPreference<T>,
  value: T,
  timestamp: string,
): EchoPersonalGameplayPreference<T> {
  return {
    ...preference,
    value,
    observationCount: preference.observationCount + 1,
    updatedAt: timestamp,
    userEditable: true,
  };
}

function normalizePersonalGameplayPreferences(
  value: unknown,
): EchoPersonalGameplayPreferences {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<EchoPersonalGameplayPreferences>)
      : {};
  return {
    confirmationPath: normalizePreference(
      candidate.confirmationPath,
      "balanced",
      normalizeConfirmationPath,
    ),
    listeningTailDurationMs: normalizePreference(
      candidate.listeningTailDurationMs,
      3000,
      (entry) => clampInteger(entry, 1000, 9000, 3000),
    ),
    clarificationStyle: normalizePreference(
      candidate.clarificationStyle,
      "concise",
      normalizeClarificationStyle,
    ),
    previewVisibility: normalizePreference(
      candidate.previewVisibility,
      "compact",
      normalizeCompactExpanded,
    ),
    actionStripPresentation: normalizePreference(
      candidate.actionStripPresentation,
      "compact",
      normalizeCompactExpanded,
    ),
    plannerPresentation: normalizePreference(
      candidate.plannerPresentation,
      "compact",
      normalizeCompactExpanded,
    ),
  };
}

function normalizePreference<T extends string | number>(
  value: unknown,
  defaultValue: T,
  normalizeValue: (value: unknown) => T,
): EchoPersonalGameplayPreference<T> {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<EchoPersonalGameplayPreference<T>>)
      : {};
  return {
    value: normalizeValue(candidate.value),
    defaultValue,
    observationCount: clampInteger(candidate.observationCount, 0, 99999, 0),
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    userEditable: true,
  };
}

function normalizeObservation(
  value: unknown,
  timestamp: string,
): EchoPersonalGameplayObservation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoPersonalGameplayObservation>;
  const label = sanitizeLabel(candidate.label ?? "");
  const normalizedLabel = normalizePersonalGameplayText(
    candidate.normalizedLabel || label,
  );
  if (!normalizedLabel || isStrategicLabel(normalizedLabel)) return null;
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-personal-gameplay"),
    key:
      typeof candidate.key === "string" && candidate.key
        ? candidate.key
        : observationKey(
            normalizeInteractionKind(candidate.kind),
            normalizedLabel,
            normalizeContextSignal(candidate.context),
          ),
    kind: normalizeInteractionKind(candidate.kind),
    source: normalizeInteractionSource(candidate.source),
    label,
    normalizedLabel,
    context: normalizeContextSignal(candidate.context),
    status: normalizeObservationStatus(candidate.status),
    firstObservedAt:
      typeof candidate.firstObservedAt === "string"
        ? candidate.firstObservedAt
        : timestamp,
    lastObservedAt:
      typeof candidate.lastObservedAt === "string"
        ? candidate.lastObservedAt
        : timestamp,
    observationCount: clampInteger(candidate.observationCount, 0, 99999, 0),
    successfulCount: clampInteger(candidate.successfulCount, 0, 99999, 0),
    correctionCount: clampInteger(candidate.correctionCount, 0, 99999, 0),
    dismissalCount: clampInteger(candidate.dismissalCount, 0, 99999, 0),
    interruptionCount: clampInteger(candidate.interruptionCount, 0, 99999, 0),
    averageDurationMs:
      typeof candidate.averageDurationMs === "number" &&
      Number.isFinite(candidate.averageDurationMs)
        ? clampInteger(candidate.averageDurationMs, 0, 3_600_000, 0)
        : null,
    confidenceBoost: clampFraction(candidate.confidenceBoost, 0),
    userEditable: true,
    localOnly: true,
    strategicRecommendation: false,
  };
}

function normalizeSuggestion(
  value: unknown,
  timestamp: string,
): EchoSmartSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoSmartSuggestion>;
  const preparation = normalizePreparation(candidate.preparation);
  const message = sanitizeLabel(candidate.message ?? "");
  if (!message) return null;
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-smart-suggestion"),
    kind: normalizeSuggestionKind(candidate.kind),
    status: normalizeSuggestionStatus(candidate.status),
    message,
    detail: sanitizeLabel(candidate.detail ?? preparation.reason),
    priority: clampInteger(candidate.priority, 0, 100, 50),
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
    expiresAt:
      typeof candidate.expiresAt === "string"
        ? candidate.expiresAt
        : addMilliseconds(timestamp, 90_000),
    dismissedAt:
      typeof candidate.dismissedAt === "string" ? candidate.dismissedAt : null,
    acceptedAt:
      typeof candidate.acceptedAt === "string" ? candidate.acceptedAt : null,
    sourceObservationIds: Array.isArray(candidate.sourceObservationIds)
      ? candidate.sourceObservationIds.filter(isString).slice(0, 10)
      : [],
    preparation,
    requiresUserAction: true,
    nonBlocking: true,
    dismissible: true,
    localOnly: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function normalizePreparation(
  value: unknown,
): EchoPredictiveWorkflowPreparation {
  if (!value || typeof value !== "object") {
    return createNoopPreparation(
      "interfaceShortcut",
      "Preparation metadata was unavailable.",
    );
  }
  const candidate = value as Partial<EchoPredictiveWorkflowPreparation>;
  const workflow = normalizeWorkflow(candidate.workflow);
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-workflow-prep"),
    status:
      candidate.status === "prepared" || candidate.status === "unavailable"
        ? candidate.status
        : "not-needed",
    workflow,
    suggestedAmbientMode: normalizeAmbientMode(candidate.suggestedAmbientMode),
    suggestedListeningWindow: normalizeListeningWindow(
      candidate.suggestedListeningWindow,
    ),
    suggestedPlannerActionId:
      typeof candidate.suggestedPlannerActionId === "string"
        ? candidate.suggestedPlannerActionId
        : null,
    suggestedActionStripItemId:
      typeof candidate.suggestedActionStripItemId === "string"
        ? candidate.suggestedActionStripItemId
        : null,
    resumeSessionId:
      typeof candidate.resumeSessionId === "string"
        ? candidate.resumeSessionId
        : null,
    reason: sanitizeLabel(candidate.reason ?? "Workflow prepared."),
    requiresUserAction: true,
    directBattlefieldMutation: false,
    gameplayAutomation: false,
    strategicRecommendation: false,
  };
}

function normalizeInterruptedWorkflow(
  value: unknown,
  timestamp: string,
): EchoPersonalGameplayState["interruptedWorkflow"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<
    NonNullable<EchoPersonalGameplayState["interruptedWorkflow"]>
  >;
  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : makeId("echo-interrupted-workflow"),
    workflow: normalizeWorkflow(candidate.workflow),
    interruptedAt:
      typeof candidate.interruptedAt === "string"
        ? candidate.interruptedAt
        : timestamp,
    expiresAt:
      typeof candidate.expiresAt === "string"
        ? candidate.expiresAt
        : addMilliseconds(timestamp, 600_000),
    reason: sanitizeLabel(candidate.reason ?? "Workflow interrupted."),
    resumeSessionId:
      typeof candidate.resumeSessionId === "string"
        ? candidate.resumeSessionId
        : null,
    localOnly: true,
    strategicRecommendation: false,
  };
}

function normalizeContextSignal(
  value?: Partial<EchoPersonalGameplayContextSignal>,
  field?: FieldState,
): EchoPersonalGameplayContextSignal {
  return {
    ambientMode:
      normalizeAmbientMode(value?.ambientMode) ??
      field?.ambient.currentMode ??
      null,
    listeningWindow:
      normalizeListeningWindow(value?.listeningWindow) ??
      field?.contextualListening.windows.find(
        (window) => window.id === field.contextualListening.activeWindowId,
      )?.kind ??
      null,
    workflow: value?.workflow ? normalizeWorkflow(value.workflow) : null,
    sourceSurface:
      typeof value?.sourceSurface === "string"
        ? sanitizeLabel(value.sourceSurface)
        : null,
    actionKind:
      typeof value?.actionKind === "string"
        ? sanitizeLabel(value.actionKind)
        : null,
    sessionId:
      typeof value?.sessionId === "string"
        ? value.sessionId
        : (field?.session.id ?? null),
  };
}

function createPersonalGameplayDiagnostics(
  input: Partial<EchoPersonalGameplayDiagnostics>,
): EchoPersonalGameplayDiagnostics {
  return {
    version: ECHO_PERSONAL_GAMEPLAY_VERSION,
    activeObservationCount: input.activeObservationCount ?? 0,
    candidateObservationCount: input.candidateObservationCount ?? 0,
    availableSuggestionCount: input.availableSuggestionCount ?? 0,
    dismissedSuggestionCount: input.dismissedSuggestionCount ?? 0,
    acceptedSuggestionCount: input.acceptedSuggestionCount ?? 0,
    lastObservedAt: input.lastObservedAt ?? null,
    lastSuggestionAt: input.lastSuggestionAt ?? null,
    lastResetAt: input.lastResetAt ?? null,
    lastDecision: input.lastDecision ?? null,
    lastReason: input.lastReason ?? null,
    localOnly: true,
    rawAudioRetained: false,
    transcriptsRetained: false,
    strategicAnalysisEnabled: false,
    deckOptimizationEnabled: false,
    gameplayAutomationEnabled: false,
    directBattlefieldMutation: false,
  };
}

function withDiagnostics(
  state: EchoPersonalGameplayState,
  patch: Partial<EchoPersonalGameplayDiagnostics>,
): EchoPersonalGameplayState {
  return {
    ...state,
    diagnostics: createPersonalGameplayDiagnostics({
      ...state.diagnostics,
      ...patch,
    }),
  };
}

function observationStatus(
  settings: EchoPersonalGameplaySettings,
  successfulCount: number,
): EchoPersonalGameplayObservationStatus {
  return successfulCount >= requiredObservationCount(settings)
    ? "active"
    : "candidate";
}

function observationStatusForSignal(
  settings: EchoPersonalGameplaySettings,
  successfulCount: number,
  interruptionCount: number,
  signal: EchoPersonalGameplayInteractionSignal,
): EchoPersonalGameplayObservationStatus {
  if (
    signal.kind === "workflow-interruption" &&
    signal.outcome === "interrupted"
  ) {
    return interruptionCount >= requiredObservationCount(settings)
      ? "active"
      : "candidate";
  }
  return observationStatus(settings, successfulCount);
}

function requiredObservationCount(
  settings: EchoPersonalGameplaySettings,
): number {
  if (settings.learningSensitivity === "conservative") {
    return settings.minimumObservations + 1;
  }
  if (settings.learningSensitivity === "adaptive") {
    return Math.max(2, settings.minimumObservations - 1);
  }
  return settings.minimumObservations;
}

function isSuccessfulOutcome(
  outcome: EchoPersonalGameplayInteractionSignal["outcome"],
): boolean {
  return (
    outcome === "completed" ||
    outcome === "confirmed" ||
    outcome === "corrected"
  );
}

function averageDuration(
  currentAverage: number | null,
  currentCount: number,
  nextDuration: number | null,
): number | null {
  if (typeof nextDuration !== "number" || !Number.isFinite(nextDuration)) {
    return currentAverage;
  }
  if (currentAverage === null || currentCount <= 0) {
    return Math.max(0, Math.round(nextDuration));
  }
  return Math.round(
    (currentAverage * currentCount + nextDuration) / (currentCount + 1),
  );
}

function observationKey(
  kind: EchoPersonalGameplayInteractionSignal["kind"],
  normalizedLabel: string,
  context: EchoPersonalGameplayContextSignal,
): string {
  return [
    kind,
    normalizedLabel,
    context.workflow ?? "none",
    context.sourceSurface ?? "field",
  ].join(":");
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const base = Date.parse(timestamp);
  return new Date(
    Number.isFinite(base) ? base + milliseconds : Date.now() + milliseconds,
  ).toISOString();
}

function countObservations(
  observations: EchoPersonalGameplayObservation[],
  status: EchoPersonalGameplayObservationStatus,
): number {
  return observations.filter((entry) => entry.status === status).length;
}

function countSuggestions(
  suggestions: EchoSmartSuggestion[],
  status: EchoSmartSuggestionStatus,
): number {
  return suggestions.filter((entry) => entry.status === status).length;
}

function isStrategicLabel(normalizedLabel: string): boolean {
  return STRATEGY_TERMS.some((term) => normalizedLabel.includes(term));
}

function sanitizeLabel(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[<>{}`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160)
    : "";
}

function normalizeLearningSensitivity(
  value: unknown,
): EchoPersonalGameplaySettings["learningSensitivity"] {
  return value === "conservative" || value === "adaptive" ? value : "balanced";
}

function normalizeInteractionKind(
  value: unknown,
): EchoPersonalGameplayInteractionSignal["kind"] {
  return value === "voice-phrase" ||
    value === "correction-pattern" ||
    value === "screen-access" ||
    value === "reminder-usage" ||
    value === "confirmation-behavior" ||
    value === "listening-duration" ||
    value === "gameplay-shortcut" ||
    value === "workflow-interruption" ||
    value === "planner-action" ||
    value === "action-strip" ||
    value === "ambient-mode"
    ? value
    : "interface-flow";
}

function normalizeInteractionSource(
  value: unknown,
): EchoPersonalGameplayInteractionSignal["source"] {
  return value === "voice-framework" ||
    value === "planner" ||
    value === "action-strip" ||
    value === "ambient-engine" ||
    value === "lifecycle" ||
    value === "settings" ||
    value === "system"
    ? value
    : "manual-ui";
}

function normalizeObservationStatus(
  value: unknown,
): EchoPersonalGameplayObservationStatus {
  return value === "active" || value === "disabled" ? value : "candidate";
}

function normalizeSuggestionKind(value: unknown): EchoSmartSuggestionKind {
  return value === "prepare-combat-declaration" ||
    value === "prepare-combat-resolution" ||
    value === "prepare-listening-window" ||
    value === "continue-planner-step" ||
    value === "resume-workflow" ||
    value === "confirmation-preference"
    ? value
    : "interface-shortcut";
}

function normalizeSuggestionStatus(value: unknown): EchoSmartSuggestionStatus {
  return value === "accepted" || value === "dismissed" || value === "expired"
    ? value
    : "available";
}

function normalizeWorkflow(value: unknown): EchoPredictiveWorkflowTarget {
  return value === "combatDeclaration" ||
    value === "combatResolution" ||
    value === "listeningWindow" ||
    value === "plannerStep" ||
    value === "actionStrip" ||
    value === "voiceSessionResume" ||
    value === "confirmationPreference"
    ? value
    : "interfaceShortcut";
}

function normalizeAmbientMode(value: unknown): AmbientGameplayMode | null {
  return value === "passive" ||
    value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
    ? value
    : null;
}

function normalizeListeningWindow(
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

function normalizeConfirmationPath(
  value: unknown,
): EchoPersonalGameplayPreferences["confirmationPath"]["value"] {
  return value === "immediate" ||
    value === "preview" ||
    value === "confirmation"
    ? value
    : "balanced";
}

function normalizeClarificationStyle(
  value: unknown,
): EchoPersonalGameplayPreferences["clarificationStyle"]["value"] {
  return value === "guided" || value === "manual" ? value : "concise";
}

function normalizeCompactExpanded(value: unknown): "compact" | "expanded" {
  return value === "expanded" ? "expanded" : "compact";
}

function boostStep(settings: EchoPersonalGameplaySettings): number {
  if (settings.learningSensitivity === "conservative") return 0.02;
  if (settings.learningSensitivity === "adaptive") return 0.045;
  return 0.032;
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

function clampFraction(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.5, Math.max(0, value))
    : fallback;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
