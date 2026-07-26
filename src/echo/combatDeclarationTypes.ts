import type { FieldState, Owner, PermanentGroup } from "../domain/types";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type {
  AmbientCanonicalEvent,
  AmbientIntentInput,
  AmbientPipelineResult,
} from "./ambientEventTypes";
import type { AmbientGameplayMode } from "./ambientTypes";
import type { EchoClarificationDecision } from "./clarificationTypes";
import type { EchoListeningWindow } from "./contextualListeningTypes";
import type {
  EchoBattlefieldContext,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";

export const ECHO_COMBAT_DECLARATION_VERSION = 1;

export type EchoCombatDeclarationSessionStatus =
  | "idle"
  | "declaring"
  | "awaitingClarification"
  | "previewReady"
  | "committed"
  | "cancelled"
  | "recovered"
  | "failed";

export type EchoCombatDeclarationTrigger =
  | "manual-combat"
  | "action-strip"
  | "voice-combat"
  | "voice-attack"
  | "recovery"
  | "system";

export type EchoCombatDeclarationCompletionReason =
  | "natural-timeout"
  | "explicit-done"
  | "preview-confirmed"
  | "manual-completion"
  | "recovery-completion";

export type EchoCombatGroupReferenceKind =
  | "specific"
  | "commander"
  | "everything"
  | "everythingElse"
  | "creatureType"
  | "tokens"
  | "untappedCreatures"
  | "flyers"
  | "nickname";

export interface EchoCombatDeclarationSettings {
  version: typeof ECHO_COMBAT_DECLARATION_VERSION;
  enabled: boolean;
  requireDefendingPlayer: boolean;
  defaultDefenderPolicy: "clarify" | "single-opponent-only";
  previewRequiresConfirmation: boolean;
  allowGroupDeclarations: boolean;
  allowEverythingElse: boolean;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  developerDiagnosticsEnabled: boolean;
  lastResetAt: string | null;
}

export interface EchoCombatDefenderReference {
  id: string;
  label: string;
  normalizedLabel: string;
  owner: Extract<Owner, "opponent">;
  participantId: string | null;
  sourceText: string;
  confidence: AmbientConfidenceAssessment;
}

export interface EchoCombatAttackerReference {
  id: string;
  groupId: string;
  objectIds: string[];
  label: string;
  normalizedLabel: string;
  requestedQuantity: number;
  availableQuantity: number;
  referenceKind: EchoCombatGroupReferenceKind;
  sourceText: string;
  confidence: AmbientConfidenceAssessment;
  entityResult: EchoEntityResolutionResult | null;
}

export interface EchoCombatAttackAssignment {
  id: string;
  order: number;
  attacker: EchoCombatAttackerReference;
  defender: EchoCombatDefenderReference | null;
  originalTranscript: string;
  normalizedTranscript: string;
  confidence: AmbientConfidenceAssessment;
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
}

export interface EchoCombatClarificationRequest {
  id: string;
  assignmentId: string | null;
  type:
    | "attacker"
    | "defender"
    | "quantity"
    | "confirmation"
    | "empty-declaration";
  question: string;
  candidateLabels: string[];
  frameworkDecision: EchoClarificationDecision | null;
  createdAt: string;
}

export interface EchoCombatPreview {
  version: typeof ECHO_COMBAT_DECLARATION_VERSION;
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  assignments: EchoCombatAttackAssignment[];
  remainingCreatureGroupIds: string[];
  summary: string[];
  confidence: AmbientConfidenceAssessment;
  clarificationRequests: EchoCombatClarificationRequest[];
  calculatesDamage: false;
  predictsBlockers: false;
  predictsOutcomes: false;
  directBattlefieldMutation: false;
}

export interface EchoCombatDeclarationSession {
  version: typeof ECHO_COMBAT_DECLARATION_VERSION;
  id: string;
  fieldSessionId: string | null;
  status: EchoCombatDeclarationSessionStatus;
  trigger: EchoCombatDeclarationTrigger;
  ambientMode: AmbientGameplayMode;
  listeningWindowId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  transcript: string[];
  normalizedTranscript: string[];
  assignments: EchoCombatAttackAssignment[];
  pendingClarificationRequests: EchoCombatClarificationRequest[];
  preview: EchoCombatPreview | null;
  currentClarificationId: string | null;
  pipelineEventId: string | null;
  recoveryReason: string | null;
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
}

export interface EchoCombatDeclarationDiagnostics {
  version: typeof ECHO_COMBAT_DECLARATION_VERSION;
  activeSessionId: string | null;
  lastSessionId: string | null;
  lastStatus: EchoCombatDeclarationSessionStatus | null;
  lastPreviewId: string | null;
  lastPipelineEventId: string | null;
  lastError: string | null;
  assignmentCount: number;
  clarificationCount: number;
  directBattlefieldMutation: false;
}

export interface EchoCombatDeclarationState {
  version: typeof ECHO_COMBAT_DECLARATION_VERSION;
  activeSessionId: string | null;
  sessions: EchoCombatDeclarationSession[];
  lastPreviewId: string | null;
  lastCommittedSessionId: string | null;
  lastCancelledSessionId: string | null;
  diagnostics: EchoCombatDeclarationDiagnostics;
}

export interface EchoCombatDeclarationInput {
  field: FieldState;
  transcript: string;
  session?: EchoCombatDeclarationSession | null;
  timestamp?: string;
  settings?: EchoCombatDeclarationSettings;
}

export interface EchoCombatDeclarationResult {
  state: EchoCombatDeclarationState;
  session: EchoCombatDeclarationSession;
  window: EchoListeningWindow | null;
  preview: EchoCombatPreview | null;
  intent: AmbientIntentInput | null;
  pipelineResult: AmbientPipelineResult | null;
  event: AmbientCanonicalEvent | null;
}

export type EchoCombatDeclarationFieldMutation = (
  field: FieldState,
  preview: EchoCombatPreview,
  eventId: string | null,
  timestamp: string,
) => FieldState;

export type EchoCombatEligibleGroup = Pick<
  PermanentGroup,
  | "id"
  | "label"
  | "quantity"
  | "characteristics"
  | "statuses"
  | "zone"
  | "controller"
  | "owner"
  | "session"
  | "identity"
  | "counters"
>;

export interface EchoCombatDeclarationPublishInput {
  field: FieldState;
  session: EchoCombatDeclarationSession;
  preview?: EchoCombatPreview | null;
  timestamp?: string;
  approval?: "automatic" | "manual" | "confirmation-required";
}

export interface EchoCombatDeclarationPreviewInput {
  field: FieldState;
  session: EchoCombatDeclarationSession;
  timestamp?: string;
  settings?: EchoCombatDeclarationSettings;
  context?: EchoBattlefieldContext;
}

export interface EchoCombatDeclarationLifecycleInput {
  timestamp?: string;
  reason?: string;
  settings?: EchoCombatDeclarationSettings;
}

export interface EchoCombatDeclarationSummaryInput {
  assignments: EchoCombatAttackAssignment[];
  remainingCreatureGroupIds: string[];
}

export type EchoCombatDeclarationConfidenceSource =
  | "speaker"
  | "grammar"
  | "entity-resolution"
  | "defender"
  | "group-reference"
  | "clarification";

export interface EchoCombatDeclarationConfidenceReason {
  source: EchoCombatDeclarationConfidenceSource;
  message: string;
  level: AmbientConfidenceLevel;
}
