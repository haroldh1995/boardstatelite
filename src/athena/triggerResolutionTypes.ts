import type { FieldState, GameEvent, PermanentGroup } from "../domain/types";
import type { AthenaResolutionAction } from "../domain/triggerResolutionDefinitions";
import type { AthenaForecastInput } from "./eventForecastTypes";
import type { AthenaReplacementProcessingResult } from "./replacementEffectTypes";
import type {
  AthenaPendingTriggerQueueSnapshot,
  AthenaTriggerInstance,
} from "./triggerQueueTypes";
import type { AthenaAuthoritySource } from "./types";

export const ATHENA_TRIGGER_RESOLUTION_VERSION = 1;

export type AthenaTriggerResolutionEligibilityStatus =
  | "auto-resolvable"
  | "ready-for-confirmation"
  | "awaiting-optional-decision"
  | "awaiting-target"
  | "awaiting-quantity"
  | "awaiting-mode"
  | "awaiting-selection"
  | "awaiting-order"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported"
  | "stale"
  | "invalid";

export type AthenaTriggerResolutionStatus =
  | "resolved"
  | "declined"
  | "input-required"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported"
  | "stale"
  | "invalid"
  | "failed-safe"
  | "cancelled";

export interface AthenaTriggerResolutionDecision {
  optionalAccepted?: boolean;
  targetGroupIds?: string[];
  quantity?: number;
  mode?: string;
  selectedGroupIds?: string[];
  orderingConfirmed?: boolean;
}

export interface AthenaTriggerResolutionEligibility {
  version: typeof ATHENA_TRIGGER_RESOLUTION_VERSION;
  triggerInstanceId: string;
  status: AthenaTriggerResolutionEligibilityStatus;
  reason: string;
  definitionId: string | null;
  missingRequirements: string[];
  selectedTargetGroupIds: string[];
  resolutionAuthority: AthenaAuthoritySource;
  deterministic: boolean;
  canMutateCanonicalState: false;
  semanticDescription: string;
}

export interface AthenaCanonicalEventCommitResult {
  event: GameEvent;
  field: FieldState;
  changedGroupIds: string[];
  generatedGroupIds: string[];
  valid: boolean;
  reason: string;
}

export interface AthenaTriggerResolutionEventRecord {
  id: string;
  action: AthenaResolutionAction;
  proposedEvent: AthenaForecastInput;
  replacement: AthenaReplacementProcessingResult;
  finalEvent: AthenaForecastInput | null;
  canonicalEvent: GameEvent | null;
  changedGroupIds: string[];
  logicalEventCount: number;
  quantityPerLogicalEvent: number;
}

export interface AthenaTriggerResolutionResult {
  version: typeof ATHENA_TRIGGER_RESOLUTION_VERSION;
  id: string;
  triggerInstanceId: string;
  triggerGroupId: string;
  sourceObjectId: string | null;
  sourceLabel: string;
  abilityDefinitionId: string;
  causingEventLineage: AthenaTriggerInstance["eventLineage"];
  resolutionAuthority: AthenaAuthoritySource;
  status: AthenaTriggerResolutionStatus;
  eligibility: AthenaTriggerResolutionEligibility;
  logicalMultiplicity: number;
  resolutionQuantity: number;
  decisions: AthenaTriggerResolutionDecision;
  generatedProposedEvents: AthenaForecastInput[];
  generatedFinalEvents: AthenaForecastInput[];
  eventRecords: AthenaTriggerResolutionEventRecord[];
  canonicalEventIds: string[];
  childTriggerIds: string[];
  replacementResultIds: string[];
  resultingField: FieldState;
  queue: AthenaPendingTriggerQueueSnapshot;
  explanationReasonCodes: string[];
  semanticDescription: string;
  accessibilityDescription: string;
  failureReason: string | null;
  manualRequirement: string | null;
  authorityRequirement: string | null;
  createdAt: string;
  completedAt: string;
  canonicalStateMutated: boolean;
  directBattlefieldMutation: false;
  atomic: true;
}

export interface AthenaTriggerResolutionCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: string | null;
}

export interface AthenaTriggerResolutionOptions {
  timestamp?: string;
  decision?: AthenaTriggerResolutionDecision;
  cancellation?: AthenaTriggerResolutionCancellationSignal;
  requireConfirmation?: boolean;
  authoritativeFinalEvents?: AthenaForecastInput[];
}

export interface AthenaAutoResolutionBudget {
  maximumTriggers: number;
  maximumGeneratedEvents: number;
  maximumCascadeDepth: number;
  maximumDurationMs: number;
  maximumRepeatedPattern: number;
  maximumQueueGrowth: number;
}

export interface AthenaTriggerResolutionDiagnostics {
  version: typeof ATHENA_TRIGGER_RESOLUTION_VERSION;
  triggerResolutionAttempts: number;
  autoResolvedTriggers: number;
  userInputRequiredTriggers: number;
  authorityRequiredTriggers: number;
  manualResolutionTriggers: number;
  failedSafeResolutions: number;
  generatedConsequenceEvents: number;
  replacementProcessedConsequenceEvents: number;
  groupedTriggerResolutions: number;
  logicalTriggerResolutions: number;
  duplicateResolutionPreventionCount: number;
  autoResolutionCycles: number;
  maximumAutoResolutionDepth: number;
  safetyBudgetPauses: number;
  potentialLoopDetections: number;
  averageResolutionDurationMs: number;
  maximumResolutionDurationMs: number;
  queueSizeBefore: number;
  queueSizeAfter: number;
  staleResolutionRejectionCount: number;
  authorityReconciliationCount: number;
  undoReconciliationCount: number;
  restoreReconciliationCount: number;
  lastResolutionError: string | null;
  productionVisible: false;
}

export type AthenaAutoResolutionStopReason =
  | "queue-empty"
  | "input-required"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported"
  | "safety-budget"
  | "potential-repeating-interaction"
  | "cancelled"
  | "failed-safe";

export interface AthenaAutoResolutionCycleResult {
  version: typeof ATHENA_TRIGGER_RESOLUTION_VERSION;
  field: FieldState;
  queue: AthenaPendingTriggerQueueSnapshot;
  results: AthenaTriggerResolutionResult[];
  processedTriggerIds: string[];
  generatedCanonicalEvents: GameEvent[];
  changedGroups: PermanentGroup[];
  stoppedBecause: AthenaAutoResolutionStopReason;
  pausedForSafety: boolean;
  potentialRepeatingInteraction: boolean;
  diagnostics: AthenaTriggerResolutionDiagnostics;
  semanticDescription: string;
  directBattlefieldMutation: false;
}

export interface AthenaConfirmedConsequencePipelineResult {
  version: typeof ATHENA_TRIGGER_RESOLUTION_VERSION;
  originalField: FieldState;
  resultingField: FieldState;
  proposedEvent: AthenaForecastInput;
  rootReplacement: AthenaReplacementProcessingResult;
  rootCanonicalEvent: GameEvent | null;
  generatedTriggerIds: string[];
  autoResolution: AthenaAutoResolutionCycleResult | null;
  queue: AthenaPendingTriggerQueueSnapshot;
  validity:
    | "committed"
    | "correction-bypassed"
    | "unresolved"
    | "invalid"
    | "failed-safe";
  reason: string;
  atomic: true;
  directBattlefieldMutation: false;
}
