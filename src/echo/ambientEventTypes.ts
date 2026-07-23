import type {
  FieldState,
  GameEvent,
  HistoryEntry,
  Owner,
  RelevantTotalKey,
  ResolutionResult,
  Zone,
} from "../domain/types";
import type { AmbientGameplayMode, AmbientGameplayState } from "./ambientTypes";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceInput,
  AmbientCorrectionRequest,
  AmbientFeedbackNotice,
  AmbientPreviewLifecycleRecord,
  AmbientPreviewStatus,
} from "./ambientConfidenceTypes";

export const AMBIENT_EVENT_PIPELINE_VERSION = 1;
export const AMBIENT_EVENT_SERIALIZATION_VERSION = 1;

export type AmbientPipelineStageName =
  | "intent-created"
  | "entity-resolution"
  | "context-validation"
  | "rule-validation"
  | "confidence-assignment"
  | "action-preview"
  | "approval-decision"
  | "canonical-event-creation"
  | "battlefield-mutation"
  | "undo-snapshot"
  | "history-recording"
  | "synchronization"
  | "completion";

export type AmbientPipelineStageStatus =
  | "pending"
  | "passed"
  | "skipped"
  | "failed";

export interface AmbientPipelineStageRecord {
  stage: AmbientPipelineStageName;
  status: AmbientPipelineStageStatus;
  message: string;
  timestamp: string;
}

export type AmbientIntentKind =
  | "play-land"
  | "cast-spell"
  | "attack"
  | "block"
  | "create-token"
  | "destroy-permanent"
  | "sacrifice-permanent"
  | "tap"
  | "untap"
  | "add-counters"
  | "remove-counters"
  | "add-mana"
  | "end-turn"
  | "pass-priority"
  | "draw-cards"
  | "discard-cards"
  | "return-permanent"
  | "exile-permanent"
  | "modify-life"
  | "modify-commander-damage"
  | "counter-spell"
  | "hold-priority"
  | "activate-ability"
  | "equip"
  | "attach"
  | "transform-permanent"
  | "explore"
  | "surveil"
  | "mill-cards"
  | "manual-correction"
  | "custom";

export type AmbientIntentSource =
  | "manual"
  | "turn-planner"
  | "voice-command"
  | "ai-recommendation"
  | "combat-preview"
  | "contextual-listening"
  | "user-correction"
  | "system";

export type AmbientApprovalMethod =
  | "automatic"
  | "manual"
  | "undo-window"
  | "confirmation-required"
  | "recovery-required";

export type AmbientApprovalDecision =
  | "approved"
  | "preview-required"
  | "cancelled"
  | "recovery-required";

export interface AmbientApprovalRequest {
  method: AmbientApprovalMethod;
  decision?: AmbientApprovalDecision;
  reason?: string;
}

export type AmbientEntityReference =
  | {
      kind: "group";
      id: string;
      role?: "source" | "target" | "attachment" | "host";
    }
  | { kind: "player"; owner: Owner; role?: "source" | "target" }
  | { kind: "counter"; name: string; role?: "counter" }
  | { kind: "zone"; zone: Zone; role?: "origin" | "destination" }
  | { kind: "session"; id: string; role?: "session" }
  | { kind: "total"; key: RelevantTotalKey; role?: "scale" }
  | { kind: "object"; id: string; role?: "source" | "target" };

export interface AmbientResolvedEntity {
  reference: AmbientEntityReference;
  status: "resolved" | "missing" | "invalid";
  groupId: string | null;
  objectIds: string[];
  label: string;
  owner: Owner | null;
  zone: Zone | null;
  message: string | null;
}

export interface AmbientIntent {
  id: string;
  kind: AmbientIntentKind;
  source: AmbientIntentSource;
  createdAt: string;
  actor: Owner;
  entities: AmbientEntityReference[];
  payload: Record<string, string | number | boolean | null>;
  confidence: AmbientConfidenceAssessment;
  requiredMode: AmbientGameplayMode | null;
  requiresPreview: boolean;
  correlationId: string | null;
}

export type AmbientIntentInput = Partial<
  Omit<
    AmbientIntent,
    "id" | "createdAt" | "payload" | "entities" | "confidence"
  >
> & {
  id?: string;
  kind: AmbientIntentKind;
  source: AmbientIntentSource;
  createdAt?: string;
  entities?: AmbientEntityReference[];
  payload?: Record<string, unknown>;
  confidence?: AmbientConfidenceInput;
};

export interface AmbientContextValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  mode: AmbientGameplayState["currentMode"];
}

export interface AmbientRuleValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface AmbientPreview {
  id: string;
  intentId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  status: AmbientPreviewStatus;
  lifecycle: AmbientPreviewLifecycleRecord[];
  summary: string[];
  resolvedEntities: AmbientResolvedEntity[];
  requiresApproval: boolean;
}

export interface AmbientCanonicalEvent {
  id: string;
  pipelineVersion: typeof AMBIENT_EVENT_PIPELINE_VERSION;
  serializationVersion: typeof AMBIENT_EVENT_SERIALIZATION_VERSION;
  timestamp: string;
  source: AmbientIntentSource;
  mode: AmbientGameplayMode;
  sessionId: string;
  participantId: string;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
  confidence: AmbientConfidenceAssessment;
  result: {
    status:
      | "completed"
      | "preview"
      | "cancelled"
      | "failed"
      | "rejected"
      | "correction-required"
      | "recovery-required";
    summary: string[];
    changedGroupIds: string[];
    generatedGameEventIds: string[];
    error: string | null;
  };
  undoReference: string | null;
  historyReference: string | null;
  synchronization: AmbientSynchronizationRecord;
  replay: {
    compatible: boolean;
    markerId: string;
    description: string;
  };
}

export interface AmbientSynchronizationRecord {
  status: "local-only" | "unavailable" | "queued";
  sessionId: string;
  authority: FieldState["session"]["currentSessionAuthority"];
  synchronizationVersion: number;
  publishedAt: string | null;
  reason: string;
}

export interface AmbientFieldMutationInput {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
  preview: AmbientPreview | null;
}

export type AmbientFieldMutation = (
  input: AmbientFieldMutationInput,
) => FieldState | ResolutionResult;

export type AmbientEntityResolver = (
  field: FieldState,
  intent: AmbientIntent,
) => AmbientResolvedEntity[];

export type AmbientContextValidator = (input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
}) => AmbientContextValidationResult;

export type AmbientRuleValidator = (input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
}) => AmbientRuleValidationResult;

export type AmbientPreviewBuilder = (input: {
  field: FieldState;
  intent: AmbientIntent;
  resolvedEntities: AmbientResolvedEntity[];
}) => AmbientPreview;

export interface AmbientPipelineRequest {
  field: FieldState;
  intent: AmbientIntent | AmbientIntentInput;
  mutation?: AmbientFieldMutation;
  approval?: AmbientApprovalRequest;
  resolver?: AmbientEntityResolver;
  contextValidator?: AmbientContextValidator;
  ruleValidator?: AmbientRuleValidator;
  previewBuilder?: AmbientPreviewBuilder;
  timestamp?: string;
}

export type AmbientPipelineResult =
  | {
      status: "completed";
      field: FieldState;
      event: AmbientCanonicalEvent;
      historyEntry: HistoryEntry;
      undo: { before: FieldState; after: FieldState; historyEntryId: string };
      preview: AmbientPreview | null;
      correction: null;
      feedback: AmbientFeedbackNotice[];
      stages: AmbientPipelineStageRecord[];
      diagnostics: AmbientPipelineDiagnostics;
    }
  | {
      status: "preview";
      field: FieldState;
      event: null;
      historyEntry: null;
      undo: null;
      preview: AmbientPreview;
      correction: null;
      feedback: AmbientFeedbackNotice[];
      stages: AmbientPipelineStageRecord[];
      diagnostics: AmbientPipelineDiagnostics;
    }
  | {
      status:
        | "cancelled"
        | "recovery-required"
        | "failed"
        | "rejected"
        | "correction-required";
      field: FieldState;
      event: AmbientCanonicalEvent | null;
      historyEntry: null;
      undo: null;
      preview: AmbientPreview | null;
      correction: AmbientCorrectionRequest | null;
      feedback: AmbientFeedbackNotice[];
      stages: AmbientPipelineStageRecord[];
      diagnostics: AmbientPipelineDiagnostics;
    };

export interface AmbientPipelineDiagnostics {
  version: typeof AMBIENT_EVENT_PIPELINE_VERSION;
  lastIntentId: string | null;
  lastEventId: string | null;
  lastStatus: AmbientPipelineResult["status"] | null;
  lastError: string | null;
  processedIntentCount: number;
  active: boolean;
}

export interface AmbientCommitInput {
  event: AmbientCanonicalEvent;
  historyEntry: HistoryEntry;
  generatedEvents: GameEvent[];
}
