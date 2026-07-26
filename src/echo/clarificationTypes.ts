import type { FieldState } from "../domain/types";
import type { AmbientConfidenceAssessment } from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntent,
  AmbientIntentInput,
  AmbientIntentKind,
  AmbientPipelineStageName,
} from "./ambientEventTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";
import type {
  EchoBattlefieldContext,
  EchoEntityResolutionCandidate,
  EchoEntityResolutionResult,
} from "./entityResolutionTypes";

export const ECHO_CLARIFICATION_VERSION = 1;

export type EchoClarificationDecisionAction =
  | "accepted"
  | "clarified"
  | "confirmation-required"
  | "rejected"
  | "deferred";

export type EchoClarificationType =
  | "multiple-battlefield-objects"
  | "multiple-token-stacks"
  | "similar-permanent-names"
  | "missing-quantity"
  | "missing-target"
  | "unknown-card-reference"
  | "ambiguous-pronoun"
  | "ambiguous-player-reference"
  | "multiple-legal-interpretations"
  | "medium-confidence-confirmation";

export type EchoClarificationSessionStatus =
  | "pending"
  | "awaiting-response"
  | "resolved"
  | "confirmed"
  | "cancelled"
  | "timed-out"
  | "recovered"
  | "rejected"
  | "deferred";

export type EchoConfirmationSensitivity =
  | "conservative"
  | "balanced"
  | "streamlined";

export interface EchoClarificationSettings {
  version: typeof ECHO_CLARIFICATION_VERSION;
  enabled: boolean;
  confirmationSensitivity: EchoConfirmationSensitivity;
  automaticExecutionThreshold: number;
  quickConfirmationThreshold: number;
  clarificationTimeoutMs: number;
  voiceConfirmationEnabled: boolean;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  developerDiagnosticsEnabled: boolean;
  lastResetAt: string | null;
}

export interface EchoClarificationIssue {
  id: string;
  type: EchoClarificationType;
  question: string;
  entityText: string | null;
  role:
    | "source"
    | "target"
    | "attachment"
    | "host"
    | "counter"
    | "origin"
    | "destination"
    | "session"
    | "scale"
    | null;
  candidates: EchoEntityResolutionCandidate[];
  required: boolean;
  resolved: boolean;
  resolution:
    | {
        kind: "entity";
        entity: AmbientEntityReference;
        candidateId: string;
        label: string;
      }
    | {
        kind: "quantity";
        quantity: number;
      }
    | {
        kind: "confirmation";
        accepted: boolean;
      }
    | {
        kind: "text";
        value: string;
      }
    | null;
}

export interface EchoClarificationPrompt {
  id: string;
  issueId: string;
  type: EchoClarificationType;
  question: string;
  candidateLabels: string[];
  concise: true;
  ariaLive: "polite" | "assertive";
  createdAt: string;
  expiresAt: string | null;
  accessibilityAnnouncement: string;
}

export interface EchoClarificationPreservedContext {
  originalTranscript: string | null;
  intent: AmbientIntentInput | AmbientIntent;
  entityResults: EchoEntityResolutionResult[];
  confidence: AmbientConfidenceAssessment;
  activeWindowId: string | null;
  activeWindowKind: EchoListeningWindowKind | null;
  ambientMode: FieldState["ambient"]["currentMode"];
  plannerActionIds: string[];
  actionStripItemIds: string[];
  pipelineStage: AmbientPipelineStageName;
  battlefieldContext: EchoBattlefieldContext;
}

export interface EchoClarificationAnswer {
  id: string;
  issueId: string;
  receivedAt: string;
  text: string;
  normalizedText: string;
  accepted: boolean;
  resolvedCandidateId: string | null;
  resolvedEntity: AmbientEntityReference | null;
  quantity: number | null;
  message: string;
}

export interface EchoClarificationSession {
  version: typeof ECHO_CLARIFICATION_VERSION;
  id: string;
  status: EchoClarificationSessionStatus;
  intentId: string | null;
  intentKind: AmbientIntentKind;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  currentIssueId: string | null;
  issues: EchoClarificationIssue[];
  prompt: EchoClarificationPrompt | null;
  answers: EchoClarificationAnswer[];
  preservedContext: EchoClarificationPreservedContext;
  resumedIntent: AmbientIntentInput | AmbientIntent | null;
  resumePipelineStage: AmbientPipelineStageName | null;
  recoveryReason: string | null;
  directBattlefieldMutation: false;
}

export interface EchoClarificationDecision {
  version: typeof ECHO_CLARIFICATION_VERSION;
  action: EchoClarificationDecisionAction;
  reason: string;
  confidence: AmbientConfidenceAssessment;
  issues: EchoClarificationIssue[];
  prompt: EchoClarificationPrompt | null;
  session: EchoClarificationSession | null;
  resumedIntent: AmbientIntentInput | AmbientIntent | null;
  shouldResumePipeline: boolean;
  directBattlefieldMutation: false;
}

export interface EchoClarificationDiagnostics {
  version: typeof ECHO_CLARIFICATION_VERSION;
  activeSessionId: string | null;
  lastSessionId: string | null;
  lastAction: EchoClarificationDecisionAction | null;
  pendingIssueCount: number;
  resolvedIssueCount: number;
  lastPrompt: string | null;
  lastError: string | null;
  timeoutMs: number;
  directBattlefieldMutation: false;
}

export interface EchoClarificationState {
  version: typeof ECHO_CLARIFICATION_VERSION;
  activeSessionId: string | null;
  sessions: EchoClarificationSession[];
  lastResolvedSessionId: string | null;
  lastCancelledSessionId: string | null;
  lastTimedOutSessionId: string | null;
  pendingPrompt: EchoClarificationPrompt | null;
  diagnostics: EchoClarificationDiagnostics;
}

export interface EchoClarificationDecisionInput {
  field: FieldState;
  intent: AmbientIntentInput | AmbientIntent;
  transcript?: string | null;
  entityResults?: EchoEntityResolutionResult[];
  confidence?: AmbientConfidenceAssessment;
  pipelineStage?: AmbientPipelineStageName;
  settings?: EchoClarificationSettings;
  timestamp?: string;
}
