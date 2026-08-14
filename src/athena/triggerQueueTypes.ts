import type { GameEvent } from "../domain/types";
import type { AthenaEventCategory } from "./dependencyGraphTypes";
import type {
  AthenaEffectChoiceRequirementKind,
  AthenaEffectRelationshipCategory,
  AthenaEffectRelationshipState,
} from "./effectRelationshipMapperTypes";
import type {
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import type {
  AthenaReplacementProcessingOptions,
  AthenaReplacementProcessingResult,
} from "./replacementEffectTypes";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaSupportFindingStatus,
} from "./types";

export const ATHENA_TRIGGER_INSTANCE_VERSION = 1;
export const ATHENA_PENDING_TRIGGER_QUEUE_VERSION = 1;
export const ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION = 1;
export const ATHENA_TRIGGER_MAX_SAFE_MULTIPLICITY = Number.MAX_SAFE_INTEGER;

export type AthenaTriggerGenerationValidity =
  | "accepted"
  | "ignored"
  | "invalid"
  | "stale"
  | "cancelled"
  | "authority-required"
  | "manual-resolution-required";

export type AthenaTriggerQueueState =
  | "pending"
  | "ready"
  | "auto-resolvable"
  | "awaiting-choice"
  | "awaiting-target"
  | "awaiting-quantity"
  | "awaiting-mode"
  | "awaiting-selection"
  | "awaiting-order"
  | "optional-decision-required"
  | "authority-required"
  | "manual-resolution-required"
  | "resolving"
  | "resolved"
  | "declined"
  | "failed-safe"
  | "stale"
  | "invalidated"
  | "cancelled"
  | "unsupported";

export type AthenaTriggerMultiplicity =
  | "per-object"
  | "per-event"
  | "single"
  | "unknown";

export type AthenaTriggerRequirementKind =
  | AthenaEffectChoiceRequirementKind
  | "ordering";

export interface AthenaTriggerRequirement {
  id: string;
  kind: AthenaTriggerRequirementKind;
  prompt: string;
  sourceGroupId: string | null;
  candidateGroupIds: string[];
  eventCategories: AthenaEventCategory[];
  status: "unresolved" | "satisfied" | "declined";
  requiredBeforeResolution: true;
}

export interface AthenaTriggerSourceSnapshot {
  stableIdentity: string;
  sourceGroupId: string | null;
  objectIds: string[];
  label: string;
  controllerId: string | null;
  ownerId: string | null;
  abilityDefinitionId: string;
  sourceDefinitionId: string;
  relationshipId: string;
  relationshipVersion: number;
  relationshipCategory: AthenaEffectRelationshipCategory;
  relationshipState: AthenaEffectRelationshipState;
  currentCardFace: string | null;
  transformationState: "current-face" | "transformed";
  trackingEnabled: boolean;
  depowerMode: string;
}

export interface AthenaTriggerEventLineage {
  originalEventId: string;
  finalEventId: string;
  replacementResultId: string;
  replacementApplicationIds: string[];
  replacementRelationshipIds: string[];
  canonicalResultReference: string | null;
  batchId: string;
}

export interface AthenaTriggerOrderingMetadata {
  eventSequence: number;
  generationSequence: number;
  sameEventGroupId: string;
  controllerId: string | null;
  userOrderingRequired: boolean;
  authorityOrderingRequired: boolean;
  authoritativeOrder: number | null;
}

export interface AthenaTriggerInstance {
  version: typeof ATHENA_TRIGGER_INSTANCE_VERSION;
  id: string;
  canonicalSessionId: string;
  participantId: string;
  controllerId: string | null;
  source: AthenaTriggerSourceSnapshot;
  causingEvent: AthenaForecastInput;
  eventLineage: AthenaTriggerEventLineage;
  observedEventCategory: AthenaEventCategory;
  triggerCategory: AthenaEffectRelationshipCategory;
  triggerTiming: "after-final-event";
  multiplicityMode: AthenaTriggerMultiplicity;
  logicalMultiplicity: number | null;
  grouped: boolean;
  groupingKey: string;
  optional: boolean;
  requirements: AthenaTriggerRequirement[];
  knownValues: Record<string, string | number | boolean | null>;
  generatedEventCategories: AthenaEventCategory[];
  affectedGroupIds: string[];
  supportStatus: string | null;
  support: AthenaSupportFindingStatus | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  queueState: AthenaTriggerQueueState;
  ordering: AthenaTriggerOrderingMetadata;
  semanticDescription: string;
  createdAt: string;
  updatedAt: string;
  resolutionReference: string | null;
  diagnosticMetadata: Record<string, string | number | boolean | null>;
  committedStateReadOnly: true;
  directBattlefieldMutation: false;
}

export interface AthenaTriggerEventFacet {
  id: string;
  eventCategory: AthenaEventCategory;
  quantity: number;
  logicalEventCount: number;
  structural: boolean;
  reason: "final-event" | "entry-facet" | "token-facet";
}

export interface AthenaSkippedTriggerRelationship {
  id: string;
  relationshipId: string;
  sourceGroupId: string | null;
  eventCategory: AthenaEventCategory;
  reason:
    | "disabled"
    | "not-tracked"
    | "depowered"
    | "temporarily-inactive"
    | "duplicate-definition"
    | "invalid-multiplicity"
    | "stale-relationship";
}

export interface AthenaTriggerGenerationDiagnostics {
  version: typeof ATHENA_TRIGGER_INSTANCE_VERSION;
  processingDurationMs: number;
  confirmedEventProcessed: boolean;
  finalEventProcessed: boolean;
  relationshipEvaluationCount: number;
  triggerInstanceCount: number;
  groupedTriggerCount: number;
  logicalTriggerMultiplicity: number;
  readyTriggerCount: number;
  choiceRequiredCount: number;
  targetRequiredCount: number;
  optionalDecisionCount: number;
  authorityRequiredCount: number;
  manualResolutionCount: number;
  unsupportedTriggerCount: number;
  duplicatePreventionCount: number;
  staleGenerationRejected: boolean;
  lastTriggerGenerationError: string | null;
  productionVisible: false;
  directBattlefieldMutation: false;
}

export interface AthenaTriggerGenerationResult {
  version: typeof ATHENA_TRIGGER_INSTANCE_VERSION;
  id: string;
  generationKey: string;
  createdAt: string;
  validity: AthenaTriggerGenerationValidity;
  reason: string;
  replacementResultId: string;
  originalEvent: AthenaForecastInput;
  finalEvent: AthenaForecastInput | null;
  eventFacets: AthenaTriggerEventFacet[];
  triggerInstances: AthenaTriggerInstance[];
  skippedRelationships: AthenaSkippedTriggerRelationship[];
  orderingRequirement:
    | "none"
    | "user-ordering-may-be-required"
    | "authority-required";
  warnings: string[];
  semanticDescriptions: string[];
  diagnostics: AthenaTriggerGenerationDiagnostics;
  committedStateReadOnly: true;
  previewStateIsolated: true;
  canonicalStateMutated: false;
  directBattlefieldMutation: false;
}

export interface AthenaTriggerGenerationCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: string | null;
}

export interface AthenaTriggerGenerationOptions {
  timestamp?: string;
  cancellation?: AthenaTriggerGenerationCancellationSignal;
  authoritativeTriggers?: AthenaAuthoritativeTriggerRecord[];
}

export interface AthenaAuthoritativeTriggerRecord {
  id: string;
  relationshipId: string;
  sourceGroupId: string | null;
  sourceLabel: string;
  abilityDefinitionId: string;
  controllerId: string | null;
  observedEventCategory: AthenaEventCategory;
  logicalMultiplicity: number;
  optional: boolean;
  queueState: AthenaTriggerQueueState;
  generatedEventCategories: AthenaEventCategory[];
  requirements: AthenaTriggerRequirement[];
  order: number;
}

export interface AthenaPendingTriggerQueueDiagnostics {
  version: typeof ATHENA_PENDING_TRIGGER_QUEUE_VERSION;
  confirmedEventsProcessed: number;
  finalEventsProcessed: number;
  triggerRelationshipsEvaluated: number;
  triggerInstancesGenerated: number;
  groupedTriggerCount: number;
  logicalTriggerMultiplicity: number;
  readyTriggerCount: number;
  choiceRequiredCount: number;
  targetRequiredCount: number;
  optionalDecisionCount: number;
  authorityRequiredCount: number;
  manualResolutionCount: number;
  unsupportedTriggerCount: number;
  duplicateTriggerPreventionCount: number;
  staleGenerationRejectionCount: number;
  queueReconciliationCount: number;
  queueReconciliationFailureCount: number;
  averageGenerationDurationMs: number;
  maximumGenerationDurationMs: number;
  maximumQueueSize: number;
  maximumLogicalTriggerMultiplicity: number;
  persistenceRestoreCount: number;
  invalidRestoredTriggerCount: number;
  lastTriggerGenerationError: string | null;
  productionVisible: false;
}

export interface AthenaPendingTriggerQueueSummary {
  totalEntries: number;
  pendingEntries: number;
  logicalPendingMultiplicity: number | null;
  readyEntries: number;
  inputRequiredEntries: number;
  authorityRequiredEntries: number;
  manualResolutionEntries: number;
  unsupportedEntries: number;
  resolvedEntries: number;
  cancelledEntries: number;
  compactLabel: string;
  semanticDescription: string;
}

export interface AthenaPendingTriggerQueueSnapshot {
  schemaVersion: typeof ATHENA_PENDING_TRIGGER_QUEUE_SCHEMA_VERSION;
  version: typeof ATHENA_PENDING_TRIGGER_QUEUE_VERSION;
  canonicalSessionId: string;
  participantId: string;
  createdAt: string;
  updatedAt: string;
  entries: AthenaTriggerInstance[];
  processedGenerationKeys: string[];
  summary: AthenaPendingTriggerQueueSummary;
  diagnostics: AthenaPendingTriggerQueueDiagnostics;
  derivedFromCanonicalEventHistory: true;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
  directBattlefieldMutation: false;
}

export interface AthenaPendingTriggerQueueRestoreResult {
  snapshot: AthenaPendingTriggerQueueSnapshot;
  restoredEntryCount: number;
  invalidEntryCount: number;
  warnings: string[];
}

export interface AthenaConfirmedEventProcessingOptions extends AthenaTriggerGenerationOptions {
  replacement?: AthenaReplacementProcessingOptions;
}

export interface AthenaConfirmedEventProcessingResult {
  replacement: AthenaReplacementProcessingResult;
  generation: AthenaTriggerGenerationResult;
  queue: AthenaPendingTriggerQueueSnapshot;
}

export interface AthenaGameEventTriggerAdapterInput {
  environment: AthenaForecastEnvironment;
  event: GameEvent;
  eventSource?: AthenaForecastInput["eventSource"];
  authoritySource?: AthenaAuthoritySource;
  timestamp?: string;
  canonicalResultReference?: string | null;
}

export interface AthenaGameEventBatchProcessingResult {
  results: AthenaConfirmedEventProcessingResult[];
  queue: AthenaPendingTriggerQueueSnapshot;
}
