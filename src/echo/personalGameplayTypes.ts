import type { AmbientGameplayMode } from "./ambientTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";

export const ECHO_PERSONAL_GAMEPLAY_VERSION = 1;

export type EchoPersonalGameplayLearningSensitivity =
  | "conservative"
  | "balanced"
  | "adaptive";

export type EchoPersonalGameplayObservationStatus =
  | "candidate"
  | "active"
  | "disabled";

export type EchoPersonalGameplayInteractionKind =
  | "interface-flow"
  | "voice-phrase"
  | "correction-pattern"
  | "screen-access"
  | "reminder-usage"
  | "confirmation-behavior"
  | "listening-duration"
  | "gameplay-shortcut"
  | "workflow-interruption"
  | "planner-action"
  | "action-strip"
  | "ambient-mode";

export type EchoPersonalGameplayInteractionSource =
  | "manual-ui"
  | "voice-framework"
  | "planner"
  | "action-strip"
  | "ambient-engine"
  | "lifecycle"
  | "settings"
  | "system";

export type EchoPersonalGameplayInteractionOutcome =
  | "completed"
  | "confirmed"
  | "corrected"
  | "dismissed"
  | "cancelled"
  | "interrupted";

export type EchoPredictiveWorkflowTarget =
  | "combatDeclaration"
  | "combatResolution"
  | "listeningWindow"
  | "plannerStep"
  | "actionStrip"
  | "voiceSessionResume"
  | "confirmationPreference"
  | "interfaceShortcut";

export type EchoSmartSuggestionKind =
  | "prepare-combat-declaration"
  | "prepare-combat-resolution"
  | "prepare-listening-window"
  | "continue-planner-step"
  | "resume-workflow"
  | "interface-shortcut"
  | "confirmation-preference";

export type EchoSmartSuggestionStatus =
  | "available"
  | "accepted"
  | "dismissed"
  | "expired";

export type EchoPersonalGameplayPreferencePath =
  | "balanced"
  | "immediate"
  | "preview"
  | "confirmation";

export type EchoPersonalGameplayClarificationStyle =
  | "concise"
  | "guided"
  | "manual";

export interface EchoPersonalGameplaySettings {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  enabled: boolean;
  smartSuggestionsEnabled: boolean;
  adaptiveInterfaceEnabled: boolean;
  predictiveIntentAssistanceEnabled: boolean;
  automaticLearningEnabled: boolean;
  learningSensitivity: EchoPersonalGameplayLearningSensitivity;
  minimumObservations: number;
  maxObservationRecords: number;
  maxSuggestions: number;
  suggestionTtlMs: number;
  resumeWindowMs: number;
  importExportPrepared: true;
  privacyControlsPrepared: true;
  localOnly: true;
  rawAudioRetained: false;
  transcriptsRetained: false;
  strategicAnalysisEnabled: false;
  deckOptimizationEnabled: false;
  gameplayAutomationEnabled: false;
  lastResetAt: string | null;
}

export interface EchoPersonalGameplayContextSignal {
  ambientMode: AmbientGameplayMode | null;
  listeningWindow: EchoListeningWindowKind | null;
  workflow: EchoPredictiveWorkflowTarget | null;
  sourceSurface: string | null;
  actionKind: string | null;
  sessionId: string | null;
}

export interface EchoPersonalGameplayInteractionSignal {
  kind: EchoPersonalGameplayInteractionKind;
  source: EchoPersonalGameplayInteractionSource;
  outcome: EchoPersonalGameplayInteractionOutcome;
  label: string;
  context?: Partial<EchoPersonalGameplayContextSignal>;
  durationMs?: number | null;
  timestamp?: string;
}

export interface EchoPersonalGameplayObservation {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  id: string;
  key: string;
  kind: EchoPersonalGameplayInteractionKind;
  source: EchoPersonalGameplayInteractionSource;
  label: string;
  normalizedLabel: string;
  context: EchoPersonalGameplayContextSignal;
  status: EchoPersonalGameplayObservationStatus;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  successfulCount: number;
  correctionCount: number;
  dismissalCount: number;
  interruptionCount: number;
  averageDurationMs: number | null;
  confidenceBoost: number;
  userEditable: true;
  localOnly: true;
  strategicRecommendation: false;
}

export interface EchoPredictiveWorkflowPreparation {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  id: string;
  status: "prepared" | "unavailable" | "not-needed";
  workflow: EchoPredictiveWorkflowTarget;
  suggestedAmbientMode: AmbientGameplayMode | null;
  suggestedListeningWindow: EchoListeningWindowKind | null;
  suggestedPlannerActionId: string | null;
  suggestedActionStripItemId: string | null;
  resumeSessionId: string | null;
  reason: string;
  requiresUserAction: true;
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  strategicRecommendation: false;
}

export interface EchoSmartSuggestion {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  id: string;
  kind: EchoSmartSuggestionKind;
  status: EchoSmartSuggestionStatus;
  message: string;
  detail: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  dismissedAt: string | null;
  acceptedAt: string | null;
  sourceObservationIds: string[];
  preparation: EchoPredictiveWorkflowPreparation;
  requiresUserAction: true;
  nonBlocking: true;
  dismissible: true;
  localOnly: true;
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  strategicRecommendation: false;
}

export interface EchoPersonalGameplayPreference<T extends string | number> {
  value: T;
  defaultValue: T;
  observationCount: number;
  updatedAt: string | null;
  userEditable: true;
}

export interface EchoPersonalGameplayPreferences {
  confirmationPath: EchoPersonalGameplayPreference<EchoPersonalGameplayPreferencePath>;
  listeningTailDurationMs: EchoPersonalGameplayPreference<number>;
  clarificationStyle: EchoPersonalGameplayPreference<EchoPersonalGameplayClarificationStyle>;
  previewVisibility: EchoPersonalGameplayPreference<"compact" | "expanded">;
  actionStripPresentation: EchoPersonalGameplayPreference<
    "compact" | "expanded"
  >;
  plannerPresentation: EchoPersonalGameplayPreference<"compact" | "expanded">;
}

export interface EchoPersonalGameplayInterruptedWorkflow {
  id: string;
  workflow: EchoPredictiveWorkflowTarget;
  interruptedAt: string;
  expiresAt: string;
  reason: string;
  resumeSessionId: string | null;
  localOnly: true;
  strategicRecommendation: false;
}

export interface EchoPersonalGameplayDiagnostics {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  activeObservationCount: number;
  candidateObservationCount: number;
  availableSuggestionCount: number;
  dismissedSuggestionCount: number;
  acceptedSuggestionCount: number;
  lastObservedAt: string | null;
  lastSuggestionAt: string | null;
  lastResetAt: string | null;
  lastDecision:
    | "ignored"
    | "observed"
    | "activated"
    | "suggested"
    | "accepted"
    | "dismissed"
    | "reset"
    | null;
  lastReason: string | null;
  localOnly: true;
  rawAudioRetained: false;
  transcriptsRetained: false;
  strategicAnalysisEnabled: false;
  deckOptimizationEnabled: false;
  gameplayAutomationEnabled: false;
  directBattlefieldMutation: false;
}

export interface EchoPersonalGameplayState {
  version: typeof ECHO_PERSONAL_GAMEPLAY_VERSION;
  observations: EchoPersonalGameplayObservation[];
  suggestions: EchoSmartSuggestion[];
  preferences: EchoPersonalGameplayPreferences;
  interruptedWorkflow: EchoPersonalGameplayInterruptedWorkflow | null;
  diagnostics: EchoPersonalGameplayDiagnostics;
}
