import type {
  CardIdentity,
  CounterName,
  FieldState,
  RelevantTotalKey,
  Zone,
} from "../domain/types";
import type {
  CategoricalZone,
  ZoneCategoryKey,
} from "../domain/zoneCompositionTypes";

export const ATHENA_RECONCILIATION_VERSION = 1;
export const ATHENA_RECONCILIATION_SCHEMA_VERSION = 1;

export type AthenaReconciliationSource =
  | "manual-correction"
  | "catch-me-up"
  | "echo-correction"
  | "app-resume"
  | "session-restore"
  | "sync-update"
  | "boardstate-authority"
  | "failed-action"
  | "invalid-prepared-action"
  | "impossible-state"
  | "import"
  | "undo-redo"
  | "snapshot-comparison"
  | "post-combat";

export type AthenaReconciliationLevel =
  | "quick-correction"
  | "battlefield-reconciliation"
  | "catch-me-up"
  | "missed-real-game-action";

export type AthenaReconciliationConfidence =
  | "exact"
  | "derived"
  | "partial"
  | "authority-confirmed";

export type AthenaReconciliationStatus =
  | "draft"
  | "applying"
  | "completed"
  | "no-change"
  | "clarification-required"
  | "authority-required"
  | "manual-required"
  | "rejected"
  | "failed"
  | "cancelled";

export type AthenaReconciliationRepair =
  | {
      id: string;
      kind: "set-life";
      value: number;
    }
  | {
      id: string;
      kind: "set-player-counter";
      counter: "poison" | "energy" | "experience" | "rad" | "commanderDamage";
      value: number;
    }
  | {
      id: string;
      kind: "set-relevant-total";
      key: RelevantTotalKey;
      value: number;
    }
  | {
      id: string;
      kind: "set-group-quantity";
      groupId: string;
      value: number;
    }
  | {
      id: string;
      kind: "set-status";
      groupId: string;
      status: keyof FieldState["groups"][number]["statuses"];
      value: boolean;
    }
  | {
      id: string;
      kind: "set-counter";
      groupId: string;
      counter: CounterName;
      value: number;
      quantity?: number;
    }
  | {
      id: string;
      kind: "set-base-power-toughness";
      groupId: string;
      power: number | null;
      toughness: number | null;
    }
  | {
      id: string;
      kind: "set-attachment";
      attachmentId: string;
      attachedTo: string | null;
    }
  | {
      id: string;
      kind: "set-current-face";
      groupId: string;
      identity: CardIdentity;
      transformed: boolean;
      restoreAbilities?: boolean;
    }
  | {
      id: string;
      kind: "replace-identity";
      groupId: string;
      identity: CardIdentity;
      quantity?: number;
    }
  | {
      id: string;
      kind: "add-card-already-present";
      identity: CardIdentity;
      quantity: number;
      zone: Zone;
    }
  | {
      id: string;
      kind: "add-generic-already-present";
      label: string;
      quantity: number;
      cardTypes: string[];
      subtypes: string[];
      token: boolean;
      power: number | null;
      toughness: number | null;
      zone: Zone;
    }
  | {
      id: string;
      kind: "remove-object-representation";
      groupId: string;
    }
  | {
      id: string;
      kind: "set-zone-composition";
      zone: CategoricalZone;
      physicalTotal?: number;
      manuallyAccountedPhysicalCards?: number;
      categoryTotals?: Partial<Record<ZoneCategoryKey, number>>;
    };

export interface AthenaReconciliationRequest {
  id: string;
  sessionId: string;
  participantId: string;
  turnId: string | null;
  source: AthenaReconciliationSource;
  level: AthenaReconciliationLevel;
  confidence: AthenaReconciliationConfidence;
  canonicalStateVersion: string;
  localStateVersion: string;
  correctionOnly: true;
  atomic: boolean;
  repairs: AthenaReconciliationRepair[];
  relatedSnapshotIds: string[];
  relatedCanonicalEventIds: string[];
  createdAt: string;
  provenance: string;
}

export interface AthenaReconciliationDiscrepancy {
  id: string;
  repairId: string;
  kind: AthenaReconciliationRepair["kind"];
  targetId: string | null;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  confidence: AthenaReconciliationConfidence;
  semanticDescription: string;
}

export interface AthenaReconciliationRecord {
  id: string;
  sessionId: string;
  participantId: string;
  turnId: string | null;
  source: AthenaReconciliationSource;
  level: AthenaReconciliationLevel;
  confidence: AthenaReconciliationConfidence;
  status: AthenaReconciliationStatus;
  canonicalStateVersion: string;
  localStateVersion: string;
  discrepancyCount: number;
  repairIds: string[];
  rejectedRepairIds: string[];
  relatedSnapshotIds: string[];
  relatedCanonicalEventIds: string[];
  unknownHistory: boolean;
  correctionOnly: true;
  gameplayEventsGenerated: 0;
  replacementEffectsApplied: false;
  triggersGenerated: 0;
  semanticSummary: string;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  provenance: string;
}

export interface AthenaReconciliationDiagnostics {
  version: typeof ATHENA_RECONCILIATION_VERSION;
  reconciliationsStarted: number;
  reconciliationsCompleted: number;
  quickCorrections: number;
  catchMeUpSessions: number;
  batchCorrections: number;
  identityCorrections: number;
  zoneCorrections: number;
  tokenCorrections: number;
  counterCorrections: number;
  lifeCorrections: number;
  commanderDamageCorrections: number;
  voiceCorrections: number;
  missedRealGameActionsProcessed: number;
  correctionsWithoutTriggers: number;
  preparedActionsInvalidated: number;
  decisionsInvalidated: number;
  authorityReconciliations: number;
  syncConflicts: number;
  appResumeReconciliations: number;
  recoveryFailures: number;
  averageReconciliationDurationMs: number;
  averageFieldsCorrected: number;
  maximumReconciliationDurationMs: number;
  lastReconciliationError: string | null;
  productionVisible: false;
}

export interface AthenaReconciliationState {
  schemaVersion: typeof ATHENA_RECONCILIATION_SCHEMA_VERSION;
  version: typeof ATHENA_RECONCILIATION_VERSION;
  active: AthenaReconciliationRecord | null;
  recent: AthenaReconciliationRecord[];
  lastBackgroundedAt: string | null;
  lastResumedAt: string | null;
  catchUpSuggested: boolean;
  updatedAt: string;
  diagnostics: AthenaReconciliationDiagnostics;
}

export interface AthenaReconciliationResult {
  ok: boolean;
  status: AthenaReconciliationStatus;
  field: FieldState;
  state: AthenaReconciliationState;
  record: AthenaReconciliationRecord;
  discrepancies: AthenaReconciliationDiscrepancy[];
  appliedRepairIds: string[];
  rejectedRepairIds: string[];
  generatedGameEvents: [];
  semanticDescription: string;
  accessibilityDescription: string;
  failureReason: string | null;
}

export type AthenaCorrectionVoiceDisposition =
  | "correction"
  | "catch-me-up"
  | "real-game-action"
  | "clarification-required"
  | "unrecognized";

export interface AthenaStructuredCorrectionIntent {
  id: string;
  disposition: AthenaCorrectionVoiceDisposition;
  source: "echo-structured-intent";
  transcript: string;
  repairs: AthenaReconciliationRepair[];
  semanticPrompt: string | null;
  correctionOnly: boolean;
  speakerVerified: boolean;
  createdAt: string;
}
