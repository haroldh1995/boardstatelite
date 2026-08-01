import type { FieldState } from "../domain/types";
import type { AmbientConfidenceAssessment } from "./ambientConfidenceTypes";
import type {
  AmbientCanonicalEvent,
  AmbientIntent,
  AmbientIntentInput,
  AmbientPipelineResult,
  AmbientPipelineStageName,
  AmbientPreview,
} from "./ambientEventTypes";
import type {
  AmbientGameplayMode,
  AmbientObservedController,
  AmbientObservedPhase,
} from "./ambientTypes";
import type { EchoClarificationDecision } from "./clarificationTypes";
import type { EchoCombatPreview } from "./combatDeclarationTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import type {
  EchoBattlefieldContext,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";
import type { EchoMagicCommandGrammarResult } from "./magicCommandGrammarTypes";
import type { EchoPredictiveWorkflowPreparation } from "./personalGameplayTypes";
import type { EchoSpeakerVerificationResult } from "./speakerVerificationTypes";
import type { EchoVoiceBattlefieldPreview } from "./voiceBattlefieldActionsTypes";

export const ECHO_AMBIENT_ORCHESTRATOR_VERSION = 1;

export type EchoAmbientOrchestratorSessionStatus =
  | "idle"
  | "listening"
  | "clarifying"
  | "previewing"
  | "awaitingConfirmation"
  | "publishing"
  | "recovering"
  | "paused"
  | "cancelled"
  | "completed"
  | "interrupted";

export type EchoAmbientOrchestratorWorkflow =
  | "planner"
  | "landPlay"
  | "spellCast"
  | "trigger"
  | "combatDeclaration"
  | "combatResolution"
  | "battlefieldAction"
  | "secondMain"
  | "endStep"
  | "endTurn"
  | "interface";

export type EchoAmbientOrchestratorSource =
  | "voice"
  | "planner"
  | "action-strip"
  | "battlefield"
  | "ambient-engine"
  | "recovery"
  | "settings"
  | "system";

export type EchoAmbientOrchestratorStageName =
  | "session-created"
  | "verified-speaker"
  | "grammar"
  | "context"
  | "entity-resolution"
  | "confidence"
  | "clarification"
  | "gameplay-preview"
  | "confirmation"
  | "pipeline"
  | "undo-availability"
  | "smart-suggestions"
  | "session-completion"
  | "recovery";

export type EchoAmbientOrchestratorStageStatus =
  | "pending"
  | "passed"
  | "skipped"
  | "blocked"
  | "failed";

export type EchoAmbientOrchestratorResource =
  | "voice-session"
  | "microphone"
  | "listening-window"
  | "clarification"
  | "gameplay-staging"
  | "combat-declaration"
  | "confirmation"
  | "pipeline"
  | "ui-focus";

export type EchoAmbientOrchestratorSubsystem =
  | "ambient-engine"
  | "listening-lifecycle"
  | "speaker-verification"
  | "magic-grammar"
  | "contextual-listening"
  | "adaptive-listening-tail"
  | "entity-resolution"
  | "clarification"
  | "combat-declaration"
  | "voice-battlefield-actions"
  | "pre-turn-planner"
  | "action-strip"
  | "personal-gameplay";

export type EchoAmbientOrchestratorEventKind =
  | "workflow-started"
  | "transcript-received"
  | "clarification-requested"
  | "preview-created"
  | "confirmation-requested"
  | "publish-started"
  | "publish-completed"
  | "workflow-completed"
  | "workflow-cancelled"
  | "workflow-interrupted"
  | "workflow-recovered"
  | "session-restored"
  | "context-refreshed";

export interface EchoAmbientOrchestratorSettings {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  enabled: boolean;
  ambientGameplayEnabled: boolean;
  workflowRecoveryEnabled: boolean;
  sessionRestorationEnabled: boolean;
  smartCoordinationEnabled: boolean;
  maxRecentSessions: number;
  maxRecentMutations: number;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  developerDiagnosticsEnabled: boolean;
  localOnly: true;
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  aiStrategyRecommendations: false;
  rulesAuthorityTransferred: false;
  lastResetAt: string | null;
}

export interface EchoAmbientOrchestratorStageRecord {
  stage: EchoAmbientOrchestratorStageName;
  status: EchoAmbientOrchestratorStageStatus;
  message: string;
  timestamp: string;
}

export interface EchoAmbientResourceOwnership {
  resource: EchoAmbientOrchestratorResource;
  ownerSessionId: string | null;
  acquiredAt: string | null;
  status: "available" | "owned" | "conflict";
  reason: string;
}

export interface EchoAmbientOrchestratorSession {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  id: string;
  fieldSessionId: string | null;
  status: EchoAmbientOrchestratorSessionStatus;
  workflow: EchoAmbientOrchestratorWorkflow;
  source: EchoAmbientOrchestratorSource;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  interruptedAt: string | null;
  recoveryReason: string | null;
  listeningSessionId: string | null;
  clarificationSessionId: string | null;
  combatSessionId: string | null;
  gameplaySessionId: string | null;
  pendingPreviewIds: string[];
  pendingConfirmationIds: string[];
  intentIds: string[];
  pipelineEventIds: string[];
  transcripts: string[];
  stages: EchoAmbientOrchestratorStageRecord[];
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  strategicRecommendation: false;
}

export interface EchoAmbientSharedContext {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  createdAt: string;
  fieldId: string;
  sessionId: string;
  currentPhase: AmbientObservedPhase | null;
  currentTurn: AmbientObservedController | null;
  currentPlayer: AmbientObservedController | null;
  currentListeningWindowId: string | null;
  currentListeningWindowKind: EchoListeningWindowKind | null;
  currentAmbientMode: AmbientGameplayMode;
  currentPlannerStepId: string | null;
  currentActionStripItemId: string | null;
  currentCombatSessionId: string | null;
  currentGameplaySessionId: string | null;
  pendingClarificationId: string | null;
  pendingPreviewIds: string[];
  pendingConfirmationIds: string[];
  recentMutationIds: string[];
  recentVoiceSessionIds: string[];
  battlefieldContext: EchoBattlefieldContext;
  localOnly: true;
  directBattlefieldMutation: false;
}

export interface EchoAmbientSystemHealth {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  activeSubsystems: EchoAmbientOrchestratorSubsystem[];
  activeSessionCount: number;
  sessionConsistent: boolean;
  pipelineConsistent: boolean;
  resourceOwnershipValid: boolean;
  lifecycleValid: boolean;
  unexpectedFailureCount: number;
  lastIssue: string | null;
  checkedAt: string;
  directBattlefieldMutation: false;
}

export interface EchoAmbientOrchestratorDiagnostics {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  status: EchoAmbientOrchestratorSessionStatus;
  activeSessionId: string | null;
  lastSessionId: string | null;
  lastWorkflow: EchoAmbientOrchestratorWorkflow | null;
  lastEventKind: EchoAmbientOrchestratorEventKind | null;
  lastPipelineEventId: string | null;
  lastError: string | null;
  activeSubsystemCount: number;
  resourceConflictCount: number;
  recentMutationCount: number;
  sessionRestorationPrepared: boolean;
  workflowRecoveryPrepared: boolean;
  localOnly: true;
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  aiStrategyRecommendations: false;
  rulesAuthorityTransferred: false;
}

export interface EchoAmbientOrchestratorState {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  activeSessionId: string | null;
  sessions: EchoAmbientOrchestratorSession[];
  sharedContext: EchoAmbientSharedContext | null;
  resourceOwners: EchoAmbientResourceOwnership[];
  recentMutationIds: string[];
  recentVoiceSessionIds: string[];
  health: EchoAmbientSystemHealth;
  diagnostics: EchoAmbientOrchestratorDiagnostics;
}

export interface EchoAmbientOrchestratorEvent {
  kind: EchoAmbientOrchestratorEventKind;
  workflow?: EchoAmbientOrchestratorWorkflow;
  source?: EchoAmbientOrchestratorSource;
  sessionId?: string | null;
  transcript?: string | null;
  intent?: AmbientIntent | AmbientIntentInput | null;
  stage?: AmbientPipelineStageName | null;
  previewId?: string | null;
  confirmationId?: string | null;
  pipelineEventId?: string | null;
  recoveryReason?: string | null;
  timestamp?: string;
}

export interface EchoAmbientOrchestrationRequest {
  field: FieldState;
  transcript?: string | null;
  intent?: AmbientIntentInput | null;
  speakerVerification?: EchoSpeakerVerificationResult | null;
  timestamp?: string;
  settings?: EchoAmbientOrchestratorSettings;
}

export interface EchoAmbientOrchestrationResult {
  version: typeof ECHO_AMBIENT_ORCHESTRATOR_VERSION;
  state: EchoAmbientOrchestratorState;
  session: EchoAmbientOrchestratorSession | null;
  status: EchoAmbientOrchestratorSessionStatus;
  workflow: EchoAmbientOrchestratorWorkflow | null;
  sharedContext: EchoAmbientSharedContext;
  speakerVerification: EchoSpeakerVerificationResult | null;
  grammar: EchoMagicCommandGrammarResult | null;
  entityResults: EchoEntityResolutionResult[];
  confidence: AmbientConfidenceAssessment | null;
  clarification: EchoClarificationDecision | null;
  ambientPreview: AmbientPreview | null;
  combatPreview: EchoCombatPreview | null;
  gameplayPreview: EchoVoiceBattlefieldPreview | null;
  predictivePreparation: EchoPredictiveWorkflowPreparation | null;
  pipelineResult: AmbientPipelineResult | null;
  event: AmbientCanonicalEvent | null;
  stageRecords: EchoAmbientOrchestratorStageRecord[];
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
  gameplayAutomation: false;
  strategicRecommendation: false;
  aiStrategyRecommendations: false;
}
