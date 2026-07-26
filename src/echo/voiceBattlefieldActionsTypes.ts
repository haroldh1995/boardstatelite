import type {
  CounterName,
  FieldState,
  GameEvent,
  Owner,
  Zone,
} from "../domain/types";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type {
  AmbientCanonicalEvent,
  AmbientIntentInput,
  AmbientIntentKind,
  AmbientPipelineResult,
} from "./ambientEventTypes";
import type { EchoClarificationDecision } from "./clarificationTypes";
import type {
  EchoBattlefieldContext,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";

export const ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION = 1;

export type EchoVoiceBattlefieldActionSessionStatus =
  | "idle"
  | "staging"
  | "awaitingClarification"
  | "previewReady"
  | "committing"
  | "committed"
  | "cancelled"
  | "recovered"
  | "failed";

export type EchoVoiceBattlefieldActionStatus =
  | "staged"
  | "pendingClarification"
  | "previewReady"
  | "committed"
  | "skipped"
  | "cancelled"
  | "rejected"
  | "recovered";

export type EchoVoiceBattlefieldActionKind =
  | "life-gain"
  | "life-loss"
  | "commander-damage"
  | "counter-add"
  | "counter-remove"
  | "token-create"
  | "token-remove"
  | "permanent-create"
  | "permanent-remove"
  | "permanent-destroy"
  | "permanent-sacrifice"
  | "permanent-exile"
  | "return-to-battlefield"
  | "return-to-hand"
  | "tap"
  | "untap"
  | "trigger-announcement"
  | "reminder"
  | "battlefield-note"
  | "draw-cards"
  | "discard-cards";

export type EchoVoiceBattlefieldActionRevisionKind =
  | "replace-quantity"
  | "remove-action"
  | "cancel-session";

export interface EchoVoiceBattlefieldActionSettings {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  enabled: boolean;
  previewRequiresConfirmation: boolean;
  allowMultipleActions: boolean;
  triggerRecognitionEnabled: boolean;
  defaultTokenPower: number;
  defaultTokenToughness: number;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  developerDiagnosticsEnabled: boolean;
  lastResetAt: string | null;
}

export interface EchoVoiceBattlefieldActionEntity {
  groupId: string | null;
  objectIds: string[];
  label: string | null;
  sourceText: string | null;
  owner: Owner | null;
  zone: Zone | null;
  entityResult: EchoEntityResolutionResult | null;
}

export interface EchoVoiceBattlefieldAction {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  id: string;
  order: number;
  kind: EchoVoiceBattlefieldActionKind;
  status: EchoVoiceBattlefieldActionStatus;
  intentKind: AmbientIntentKind;
  originalTranscript: string;
  normalizedTranscript: string;
  quantity: number;
  counterName: CounterName | null;
  tokenName: string | null;
  tokenPower: number | null;
  tokenToughness: number | null;
  zoneOrigin: Zone | null;
  zoneDestination: Zone | null;
  target: EchoVoiceBattlefieldActionEntity | null;
  triggerName: string | null;
  note: string | null;
  confidence: AmbientConfidenceAssessment;
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
  generatedEventType: GameEvent["type"] | null;
  directBattlefieldMutation: false;
}

export interface EchoVoiceBattlefieldClarificationRequest {
  id: string;
  actionId: string | null;
  type:
    | "target"
    | "quantity"
    | "counter"
    | "token"
    | "trigger"
    | "confirmation";
  question: string;
  candidateLabels: string[];
  frameworkDecision: EchoClarificationDecision | null;
  createdAt: string;
}

export interface EchoVoiceBattlefieldPreview {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  actions: EchoVoiceBattlefieldAction[];
  summary: string[];
  confirmedActionCount: number;
  pendingClarificationCount: number;
  rejectedActionCount: number;
  lowConfidenceActionCount: number;
  clarificationRequests: EchoVoiceBattlefieldClarificationRequest[];
  confidence: AmbientConfidenceAssessment;
  directBattlefieldMutation: false;
}

export interface EchoVoiceBattlefieldActionSession {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  id: string;
  fieldSessionId: string | null;
  status: EchoVoiceBattlefieldActionSessionStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  transcript: string[];
  normalizedTranscript: string[];
  actions: EchoVoiceBattlefieldAction[];
  preview: EchoVoiceBattlefieldPreview | null;
  currentClarificationId: string | null;
  pipelineEventIds: string[];
  recoveryReason: string | null;
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
}

export interface EchoVoiceBattlefieldActionDiagnostics {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  activeSessionId: string | null;
  lastSessionId: string | null;
  lastStatus: EchoVoiceBattlefieldActionSessionStatus | null;
  lastPreviewId: string | null;
  lastPipelineEventId: string | null;
  lastError: string | null;
  stagedActionCount: number;
  clarificationCount: number;
  triggerEventCount: number;
  directBattlefieldMutation: false;
}

export interface EchoVoiceBattlefieldActionState {
  version: typeof ECHO_VOICE_BATTLEFIELD_ACTIONS_VERSION;
  activeSessionId: string | null;
  sessions: EchoVoiceBattlefieldActionSession[];
  lastPreviewId: string | null;
  lastCommittedSessionId: string | null;
  lastCancelledSessionId: string | null;
  diagnostics: EchoVoiceBattlefieldActionDiagnostics;
}

export interface EchoVoiceBattlefieldCaptureInput {
  field: FieldState;
  transcript: string;
  session?: EchoVoiceBattlefieldActionSession | null;
  timestamp?: string;
  settings?: EchoVoiceBattlefieldActionSettings;
}

export interface EchoVoiceBattlefieldRevisionInput {
  field: FieldState;
  session: EchoVoiceBattlefieldActionSession;
  transcript: string;
  timestamp?: string;
  settings?: EchoVoiceBattlefieldActionSettings;
}

export interface EchoVoiceBattlefieldPublishInput {
  field: FieldState;
  session: EchoVoiceBattlefieldActionSession;
  preview?: EchoVoiceBattlefieldPreview | null;
  timestamp?: string;
  approval?: "automatic" | "manual" | "confirmation-required";
}

export interface EchoVoiceBattlefieldPreviewInput {
  field: FieldState;
  session: EchoVoiceBattlefieldActionSession;
  timestamp?: string;
  settings?: EchoVoiceBattlefieldActionSettings;
  context?: EchoBattlefieldContext;
}

export interface EchoVoiceBattlefieldResult {
  state: EchoVoiceBattlefieldActionState;
  session: EchoVoiceBattlefieldActionSession;
  preview: EchoVoiceBattlefieldPreview | null;
  intents: AmbientIntentInput[];
  pipelineResults: AmbientPipelineResult[];
  events: AmbientCanonicalEvent[];
}

export interface EchoVoiceBattlefieldActionApplyInput {
  field: FieldState;
  action: EchoVoiceBattlefieldAction;
  timestamp: string;
}

export interface EchoVoiceBattlefieldConfidenceReason {
  source:
    | "grammar"
    | "entity-resolution"
    | "trigger-recognition"
    | "quantity"
    | "context"
    | "clarification";
  message: string;
  level: AmbientConfidenceLevel;
}
