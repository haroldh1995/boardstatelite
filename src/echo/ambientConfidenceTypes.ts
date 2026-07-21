import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientContextValidationResult,
  AmbientIntentKind,
  AmbientIntentSource,
  AmbientRuleValidationResult,
} from "./ambientEventTypes";

export const AMBIENT_CONFIDENCE_FRAMEWORK_VERSION = 1;

export type AmbientConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface AmbientConfidenceAssessment {
  version: typeof AMBIENT_CONFIDENCE_FRAMEWORK_VERSION;
  level: AmbientConfidenceLevel;
  source: AmbientIntentSource;
  assessedAt: string;
  score: number | null;
  reasons: string[];
  validation: {
    contextValid: boolean;
    rulesValid: boolean;
    warningCount: number;
  };
}

export type AmbientConfidenceInput =
  | AmbientConfidenceLevel
  | Partial<AmbientConfidenceAssessment>;

export type AmbientExecutionPath =
  | "immediate-execution"
  | "preview-before-commit"
  | "user-confirmation"
  | "correction-workflow"
  | "recovery-mode"
  | "action-rejection";

export interface AmbientFeedbackNotice {
  id: string;
  severity: "info" | "warning" | "error";
  channel: "internal" | "toast" | "inline" | "preview" | "recovery";
  message: string;
  createdAt: string;
}

export interface AmbientConfidenceDecision {
  path: AmbientExecutionPath;
  confidence: AmbientConfidenceAssessment;
  approvalMethod:
    | "automatic"
    | "manual"
    | "undo-window"
    | "confirmation-required"
    | "recovery-required";
  mutationAllowed: boolean;
  previewRequired: boolean;
  confirmationRequired: boolean;
  correctionRequired: boolean;
  recoveryRequired: boolean;
  rejectionRequired: boolean;
  reason: string;
  feedback: AmbientFeedbackNotice[];
}

export type AmbientCorrectionType =
  | "not-me"
  | "wrong-card"
  | "wrong-quantity"
  | "wrong-target"
  | "wrong-player"
  | "ignore-phrase"
  | "cancel-action"
  | "retry";

export type AmbientCorrectionStatus =
  | "pending"
  | "applied"
  | "cancelled"
  | "discarded";

export interface AmbientCorrectionRequest {
  id: string;
  type: AmbientCorrectionType;
  intentId: string;
  status: AmbientCorrectionStatus;
  reason: string;
  createdAt: string;
  payload: Record<string, string | number | boolean | null>;
}

export type AmbientPreviewStatus =
  | "created"
  | "updated"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "committed"
  | "discarded";

export interface AmbientConfidenceDecisionInput {
  confidence: AmbientConfidenceAssessment;
  mode: AmbientGameplayMode;
  intentKind: AmbientIntentKind;
  source: AmbientIntentSource;
  contextValidation: AmbientContextValidationResult;
  ruleValidation: AmbientRuleValidationResult;
  entityResolutionOk: boolean;
  requiresPreview: boolean;
  timestamp: string;
}

export interface AmbientPreviewLifecycleRecord {
  status: AmbientPreviewStatus;
  timestamp: string;
  reason: string;
}
