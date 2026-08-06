import type {
  FieldState,
  GameEventType,
  Owner,
  ResolutionResult,
} from "../domain/types";
import type { AmbientConfidenceAssessment } from "./ambientConfidenceTypes";
import type {
  AmbientCanonicalEvent,
  AmbientIntentInput,
  AmbientPipelineResult,
} from "./ambientEventTypes";
import type { AmbientGameplayMode } from "./ambientTypes";
import type { EchoClarificationDecision } from "./clarificationTypes";
import type { EchoListeningWindow } from "./contextualListeningTypes";
import type { EchoEntityResolutionResult } from "./entityResolutionTypes";

export const ECHO_COMBAT_RESOLUTION_VERSION = 1;

export type EchoCombatResolutionSessionStatus =
  | "idle"
  | "resolving"
  | "awaitingClarification"
  | "previewReady"
  | "committing"
  | "committed"
  | "cancelled"
  | "recovered"
  | "failed";

export type EchoCombatResolutionTrigger =
  | "manual-resolution"
  | "action-strip"
  | "voice-resolution"
  | "recovery"
  | "system";

export type EchoCombatResolutionOutcomeStatus =
  | "staged"
  | "pendingClarification"
  | "previewReady"
  | "committed"
  | "skipped"
  | "cancelled"
  | "rejected"
  | "recovered";

export type EchoCombatResolutionOutcomeKind =
  | "attacker-survived"
  | "attacker-died"
  | "attacker-exiled"
  | "attacker-returned-to-hand"
  | "attacker-damage-marked"
  | "attacker-tapped"
  | "attacker-untapped"
  | "combat-damage-to-player"
  | "commander-damage-to-you"
  | "opponent-damage-reported"
  | "combat-note"
  | "combat-cleanup";

export interface EchoCombatResolutionSettings {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  enabled: boolean;
  previewRequiresConfirmation: boolean;
  allowMultipleOutcomes: boolean;
  clearCombatStatusesOnCommit: boolean;
  recordOpponentDamageAsUntracked: boolean;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  developerDiagnosticsEnabled: boolean;
  calculatesDamage: false;
  predictsBlockers: false;
  predictsOutcomes: false;
  aiStrategyRecommendations: false;
  lastResetAt: string | null;
}

export interface EchoCombatResolutionEntity {
  groupId: string | null;
  objectIds: string[];
  label: string | null;
  sourceText: string | null;
  owner: Owner | null;
  entityResult: EchoEntityResolutionResult | null;
}

export interface EchoCombatResolutionOutcome {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  id: string;
  order: number;
  kind: EchoCombatResolutionOutcomeKind;
  status: EchoCombatResolutionOutcomeStatus;
  originalTranscript: string;
  normalizedTranscript: string;
  quantity: number;
  target: EchoCombatResolutionEntity | null;
  defenderLabel: string | null;
  generatedEventType: GameEventType | null;
  note: string | null;
  confidence: AmbientConfidenceAssessment;
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
  directBattlefieldMutation: false;
  calculatesDamage: false;
  predictsBlockers: false;
  predictsOutcomes: false;
}

export interface EchoCombatResolutionClarificationRequest {
  id: string;
  outcomeId: string | null;
  type: "target" | "defender" | "quantity" | "confirmation";
  question: string;
  candidateLabels: string[];
  frameworkDecision: EchoClarificationDecision | null;
  createdAt: string;
}

export interface EchoCombatResolutionPreview {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  outcomes: EchoCombatResolutionOutcome[];
  summary: string[];
  confirmedOutcomeCount: number;
  pendingClarificationCount: number;
  rejectedOutcomeCount: number;
  lowConfidenceOutcomeCount: number;
  clarificationRequests: EchoCombatResolutionClarificationRequest[];
  confidence: AmbientConfidenceAssessment;
  calculatesDamage: false;
  predictsBlockers: false;
  predictsOutcomes: false;
  directBattlefieldMutation: false;
}

export interface EchoCombatResolutionSession {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  id: string;
  fieldSessionId: string | null;
  status: EchoCombatResolutionSessionStatus;
  trigger: EchoCombatResolutionTrigger;
  ambientMode: AmbientGameplayMode;
  listeningWindowId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  transcript: string[];
  normalizedTranscript: string[];
  outcomes: EchoCombatResolutionOutcome[];
  preview: EchoCombatResolutionPreview | null;
  currentClarificationId: string | null;
  pipelineEventId: string | null;
  recoveryReason: string | null;
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
}

export interface EchoCombatResolutionDiagnostics {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  activeSessionId: string | null;
  lastSessionId: string | null;
  lastStatus: EchoCombatResolutionSessionStatus | null;
  lastPreviewId: string | null;
  lastPipelineEventId: string | null;
  lastError: string | null;
  stagedOutcomeCount: number;
  clarificationCount: number;
  untrackedOpponentDamageCount: number;
  calculatesDamage: false;
  predictsBlockers: false;
  predictsOutcomes: false;
  directBattlefieldMutation: false;
}

export interface EchoCombatResolutionState {
  version: typeof ECHO_COMBAT_RESOLUTION_VERSION;
  activeSessionId: string | null;
  sessions: EchoCombatResolutionSession[];
  lastPreviewId: string | null;
  lastCommittedSessionId: string | null;
  lastCancelledSessionId: string | null;
  diagnostics: EchoCombatResolutionDiagnostics;
}

export interface EchoCombatResolutionInput {
  field: FieldState;
  transcript: string;
  session?: EchoCombatResolutionSession | null;
  timestamp?: string;
  settings?: EchoCombatResolutionSettings;
}

export interface EchoCombatResolutionPreviewInput {
  field: FieldState;
  session: EchoCombatResolutionSession;
  timestamp?: string;
  settings?: EchoCombatResolutionSettings;
}

export interface EchoCombatResolutionPublishInput {
  field: FieldState;
  session: EchoCombatResolutionSession;
  preview?: EchoCombatResolutionPreview | null;
  timestamp?: string;
  approval?: "automatic" | "manual" | "confirmation-required";
}

export interface EchoCombatResolutionResult {
  state: EchoCombatResolutionState;
  session: EchoCombatResolutionSession;
  window: EchoListeningWindow | null;
  preview: EchoCombatResolutionPreview | null;
  intent: AmbientIntentInput | null;
  pipelineResult: AmbientPipelineResult | null;
  event: AmbientCanonicalEvent | null;
  resolutionResult: ResolutionResult | null;
}
