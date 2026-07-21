import { makeId } from "../domain/cards";
import type {
  AmbientApprovalRequest,
  AmbientIntent,
  AmbientPreview,
} from "./ambientEventTypes";
import {
  AMBIENT_CONFIDENCE_FRAMEWORK_VERSION,
  type AmbientConfidenceAssessment,
  type AmbientConfidenceDecision,
  type AmbientConfidenceDecisionInput,
  type AmbientConfidenceInput,
  type AmbientConfidenceLevel,
  type AmbientCorrectionRequest,
  type AmbientCorrectionType,
  type AmbientFeedbackNotice,
  type AmbientPreviewLifecycleRecord,
  type AmbientPreviewStatus,
} from "./ambientConfidenceTypes";

export function normalizeAmbientConfidence(
  value: AmbientConfidenceInput | undefined,
  options: {
    source: AmbientIntent["source"];
    timestamp: string;
    contextValid?: boolean;
    rulesValid?: boolean;
    warningCount?: number;
  },
): AmbientConfidenceAssessment {
  const level = normalizeConfidenceLevel(
    typeof value === "string" ? value : value?.level,
  );
  const reasons =
    value && typeof value === "object" && Array.isArray(value.reasons)
      ? value.reasons
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.slice(0, 240))
      : defaultConfidenceReasons(level);
  const score =
    value &&
    typeof value === "object" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score)
      ? Math.min(1, Math.max(0, value.score))
      : scoreForConfidence(level);

  return {
    version: AMBIENT_CONFIDENCE_FRAMEWORK_VERSION,
    level,
    source:
      value && typeof value === "object" && value.source
        ? value.source
        : options.source,
    assessedAt:
      value && typeof value === "object" && typeof value.assessedAt === "string"
        ? value.assessedAt
        : options.timestamp,
    score,
    reasons,
    validation: {
      contextValid:
        value && typeof value === "object" && value.validation
          ? Boolean(value.validation.contextValid)
          : Boolean(options.contextValid),
      rulesValid:
        value && typeof value === "object" && value.validation
          ? Boolean(value.validation.rulesValid)
          : Boolean(options.rulesValid),
      warningCount: normalizeWarningCount(
        value && typeof value === "object" && value.validation
          ? value.validation.warningCount
          : options.warningCount,
      ),
    },
  };
}

export function assessAmbientConfidence(
  intent: AmbientIntent,
  options: {
    timestamp: string;
    contextValid: boolean;
    rulesValid: boolean;
    warningCount: number;
  },
): AmbientConfidenceAssessment {
  const assessment = normalizeAmbientConfidence(intent.confidence, {
    source: intent.source,
    timestamp: options.timestamp,
    contextValid: options.contextValid,
    rulesValid: options.rulesValid,
    warningCount: options.warningCount,
  });
  return {
    ...assessment,
    assessedAt: options.timestamp,
    validation: {
      contextValid: options.contextValid,
      rulesValid: options.rulesValid,
      warningCount: options.warningCount,
    },
  };
}

export class AmbientConfidenceDecisionEngine {
  decide(input: AmbientConfidenceDecisionInput): AmbientConfidenceDecision {
    const feedback = createBaseFeedback(input);
    if (!input.entityResolutionOk || !input.contextValidation.ok) {
      return createDecision({
        path: "recovery-mode",
        confidence: input.confidence,
        approvalMethod: "recovery-required",
        reason:
          input.contextValidation.errors.join(" ") ||
          "Ambient action requires recovery before it can continue.",
        feedback,
      });
    }

    if (!input.ruleValidation.ok) {
      return createDecision({
        path: "action-rejection",
        confidence: input.confidence,
        approvalMethod: "manual",
        reason:
          input.ruleValidation.errors.join(" ") ||
          "Ambient action failed safety validation.",
        feedback,
      });
    }

    if (input.confidence.level === "unknown") {
      return createDecision({
        path: "action-rejection",
        confidence: input.confidence,
        approvalMethod: "manual",
        reason: "Unknown confidence cannot mutate battlefield state.",
        feedback,
      });
    }

    if (input.confidence.level === "low") {
      return createDecision({
        path: "correction-workflow",
        confidence: input.confidence,
        approvalMethod: "manual",
        reason: "Low confidence requires correction before execution.",
        feedback,
      });
    }

    if (input.confidence.level === "medium" || input.requiresPreview) {
      return createDecision({
        path: "preview-before-commit",
        confidence: input.confidence,
        approvalMethod: "manual",
        reason: "Ambient action requires preview before commit.",
        feedback,
      });
    }

    return createDecision({
      path: "immediate-execution",
      confidence: input.confidence,
      approvalMethod: "automatic",
      reason: "High confidence action may execute immediately.",
      feedback,
    });
  }
}

export const ambientConfidenceDecisionEngine =
  new AmbientConfidenceDecisionEngine();

export function createAmbientCorrectionRequest(input: {
  type: AmbientCorrectionType;
  intentId: string;
  reason: string;
  timestamp: string;
  payload?: Record<string, string | number | boolean | null>;
}): AmbientCorrectionRequest {
  return {
    id: makeId("ambient-correction"),
    type: input.type,
    intentId: input.intentId,
    status: "pending",
    reason: input.reason.slice(0, 240),
    createdAt: input.timestamp,
    payload: input.payload ? { ...input.payload } : {},
  };
}

export function routeAmbientCorrection(input: {
  decision: AmbientConfidenceDecision;
  intentId: string;
  timestamp: string;
  reason?: string;
}): AmbientCorrectionRequest | null {
  if (!input.decision.correctionRequired) return null;
  return createAmbientCorrectionRequest({
    type: "retry",
    intentId: input.intentId,
    reason:
      input.reason ??
      input.decision.reason ??
      "Ambient action requires correction.",
    timestamp: input.timestamp,
  });
}

export function transitionAmbientPreview(
  preview: AmbientPreview,
  status: AmbientPreviewStatus,
  options: { timestamp: string; reason: string },
): AmbientPreview {
  const lifecycleRecord: AmbientPreviewLifecycleRecord = {
    status,
    timestamp: options.timestamp,
    reason: options.reason,
  };
  return {
    ...preview,
    status,
    updatedAt: options.timestamp,
    lifecycle: [...preview.lifecycle, lifecycleRecord],
  };
}

export function isAmbientPreviewExpired(
  preview: AmbientPreview,
  timestamp = new Date().toISOString(),
): boolean {
  return Boolean(preview.expiresAt && preview.expiresAt <= timestamp);
}

export function decideAmbientApprovalWithConfidence(input: {
  decision: AmbientConfidenceDecision;
  approval: AmbientApprovalRequest | undefined;
  hasPreview: boolean;
  previewExpired: boolean;
}): "approved" | "preview-required" | "cancelled" | "recovery-required" {
  if (input.previewExpired) return "recovery-required";
  if (input.approval?.decision) return input.approval.decision;
  if (input.decision.rejectionRequired || input.decision.correctionRequired) {
    return "cancelled";
  }
  if (input.decision.recoveryRequired) return "recovery-required";
  if (input.decision.previewRequired || input.decision.confirmationRequired) {
    return input.approval?.method === "automatic"
      ? "approved"
      : "preview-required";
  }
  if (input.approval?.method === "recovery-required")
    return "recovery-required";
  if (input.approval?.method === "manual" && input.hasPreview) {
    return "preview-required";
  }
  return "approved";
}

function normalizeConfidenceLevel(value: unknown): AmbientConfidenceLevel {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "unknown";
}

function scoreForConfidence(level: AmbientConfidenceLevel): number | null {
  if (level === "high") return 0.95;
  if (level === "medium") return 0.65;
  if (level === "low") return 0.25;
  return null;
}

function normalizeWarningCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function defaultConfidenceReasons(level: AmbientConfidenceLevel): string[] {
  if (level === "unknown") return ["No confidence assessment was supplied."];
  return [`${level} confidence supplied by Ambient intent source.`];
}

function createBaseFeedback(
  input: AmbientConfidenceDecisionInput,
): AmbientFeedbackNotice[] {
  const notices: AmbientFeedbackNotice[] = [];
  for (const warning of [
    ...input.contextValidation.warnings,
    ...input.ruleValidation.warnings,
  ]) {
    notices.push({
      id: makeId("ambient-feedback"),
      severity: "warning",
      channel: "internal",
      message: warning,
      createdAt: input.timestamp,
    });
  }
  return notices;
}

function createDecision(input: {
  path: AmbientConfidenceDecision["path"];
  confidence: AmbientConfidenceAssessment;
  approvalMethod: AmbientConfidenceDecision["approvalMethod"];
  reason: string;
  feedback: AmbientFeedbackNotice[];
}): AmbientConfidenceDecision {
  const previewRequired =
    input.path === "preview-before-commit" ||
    input.path === "user-confirmation";
  return {
    path: input.path,
    confidence: input.confidence,
    approvalMethod: input.approvalMethod,
    mutationAllowed: input.path === "immediate-execution",
    previewRequired,
    confirmationRequired: input.path === "user-confirmation",
    correctionRequired: input.path === "correction-workflow",
    recoveryRequired: input.path === "recovery-mode",
    rejectionRequired: input.path === "action-rejection",
    reason: input.reason.slice(0, 240),
    feedback: input.feedback,
  };
}
