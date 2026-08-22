import type {
  CardIdentity,
  Characteristics,
  GameEvent,
  RelevantTotalKey,
  Zone,
} from "../domain/types";
import type { AmbientIntent } from "../echo/ambientEventTypes";
import type { PlannedAction } from "../echo/preTurnPlannerTypes";
import type { ActiveTurnActionStripItem } from "../echo/activeTurnActionStripTypes";
import type {
  AthenaDependencyGraph,
  AthenaEventCategory,
  AthenaGraphChange,
} from "./dependencyGraphTypes";
import type {
  AthenaEffectChoiceRequirementKind,
  AthenaEffectRelationshipCategory,
  AthenaEffectRelationshipMap,
  AthenaEffectRelationshipState,
} from "./effectRelationshipMapperTypes";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaAwarenessContext,
} from "./types";
import type { AthenaReplacementProcessingResult } from "./replacementEffectTypes";
import type { AthenaCardEntryDescriptor } from "./cardIdentificationTypes";

export const ATHENA_EVENT_FORECAST_VERSION = 2;
export const ATHENA_EVENT_FORECAST_CACHE_VERSION = 2;
export const ATHENA_EVENT_FORECAST_DEFAULT_DEPTH = 2;
export const ATHENA_EVENT_FORECAST_MAX_DEPTH = 2;

export type AthenaForecastInputSource =
  | "boardstate-result"
  | "canonical-event"
  | "manual-report"
  | "lite-helper"
  | "echo-planned"
  | "echo-reported"
  | "planner"
  | "action-strip"
  | "correction-only"
  | "imported-event"
  | "preview-only"
  | "unknown";

export type AthenaForecastValidity =
  | "valid"
  | "stale"
  | "cancelled"
  | "invalid"
  | "unresolved";

export type AthenaForecastCertainty =
  | "deterministic"
  | "conditional"
  | "optional"
  | "choice-dependent"
  | "replacement-dependent"
  | "authority-dependent"
  | "manual-resolution-dependent"
  | "unsupported";

export type AthenaForecastClassification =
  | "confirmed-input"
  | "forecasted-consequence"
  | "potential-follow-up"
  | "optional"
  | "choice-required"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported";

export type AthenaForecastReasonCode =
  | "input-event"
  | "known-characteristics"
  | "canonical-contribution-relationship"
  | "explicit-total-implication"
  | "grouped-quantity"
  | "zone-transition"
  | "counter-change"
  | "life-change"
  | "commander-damage-change"
  | "transformation"
  | "trigger-observed"
  | "replacement-discovered"
  | "replacement-applied"
  | "replacement-unresolved"
  | "static-dependency-invalidated"
  | "generated-event"
  | "optional-effect"
  | "choice-missing"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported-effect"
  | "tracking-disabled"
  | "depowered"
  | "not-applicable"
  | "missing-object"
  | "invalid-event"
  | "invalid-quantity"
  | "stale-version"
  | "cancelled"
  | "bounded-depth"
  | "authoritative-input"
  | "preview-only";

export interface AthenaForecastKnownCharacteristics {
  cardTypes: string[];
  supertypes: string[];
  subtypes: string[];
  colors: string[];
  manaValue: number | null;
  isToken: boolean;
  isCreature: boolean;
  isLegendary: boolean;
  knownFields: AthenaForecastCharacteristicField[];
}

export type AthenaForecastCharacteristicField =
  | "cardTypes"
  | "supertypes"
  | "subtypes"
  | "colors"
  | "manaValue"
  | "isToken"
  | "isCreature"
  | "isLegendary";

export interface AthenaForecastTokenDefinitionReference {
  id: string;
  name: string;
  power: number | null;
  toughness: number | null;
  characteristics: AthenaForecastKnownCharacteristics;
}

export interface AthenaForecastConfidence {
  level: "high" | "medium" | "low" | "unknown";
  score: number | null;
  speakerVerified: boolean | null;
}

export interface AthenaForecastInput {
  version: typeof ATHENA_EVENT_FORECAST_VERSION;
  id: string;
  canonicalSessionId: string;
  participantId: string;
  eventId: string;
  eventCategory: AthenaEventCategory;
  eventSource: AthenaForecastInputSource;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  sequence: number;
  batchId: string;
  timestamp: string;
  sourceObjectId: string | null;
  subjectGroupIds: string[];
  subjectObjectIds: string[];
  quantity: number;
  knownCharacteristics: AthenaForecastKnownCharacteristics | null;
  zoneOrigin: Zone | null;
  zoneDestination: Zone | null;
  counterType: string | null;
  tokenDefinition: AthenaForecastTokenDefinitionReference | null;
  permanentDefinition: CardIdentity | null;
  cardEntry: AthenaCardEntryDescriptor | null;
  lifeDelta: number | null;
  commanderDamageDelta: number | null;
  relevantTotalImplications: Partial<Record<RelevantTotalKey, number>>;
  confidence: AthenaForecastConfidence | null;
  echoIntentReference: string | null;
  plannerReference: string | null;
  actionStripReference: string | null;
  canonicalResultReference: string | null;
  awarenessContextVersion: number;
  awarenessContextFingerprint: string;
  dependencyGraphVersion: number;
  dependencyGraphFingerprint: string;
  relationshipMapVersion: number;
  relationshipMapFingerprint: string;
  metadata: Record<string, string | number | boolean | null>;
}

export type AthenaForecastInputDraft = Partial<
  Omit<
    AthenaForecastInput,
    | "version"
    | "authorityPrecedence"
    | "knownCharacteristics"
    | "tokenDefinition"
    | "permanentDefinition"
    | "cardEntry"
    | "relevantTotalImplications"
    | "metadata"
  >
> & {
  eventCategory: AthenaEventCategory;
  eventId: string;
  knownCharacteristics?:
    | Partial<Characteristics>
    | AthenaForecastKnownCharacteristics
    | null;
  tokenDefinition?: Partial<AthenaForecastTokenDefinitionReference> | null;
  permanentDefinition?: CardIdentity | null;
  cardEntry?: AthenaCardEntryDescriptor | null;
  relevantTotalImplications?: Partial<Record<RelevantTotalKey, number>>;
  metadata?: Record<string, string | number | boolean | null>;
};

export interface AthenaForecastRelevantTotalChange {
  id: string;
  key: RelevantTotalKey;
  currentValue: number;
  baseDelta: number;
  forecastDelta: number | null;
  forecastValue: number | null;
  quantityAware: true;
  provisional: boolean;
  certainty: AthenaForecastCertainty;
  reasonCodes: AthenaForecastReasonCode[];
}

export interface AthenaForecastDirectConsequence {
  id: string;
  kind:
    | "battlefield-quantity"
    | "relevant-total"
    | "token-group"
    | "counter"
    | "life"
    | "commander-damage"
    | "zone"
    | "transformation"
    | "stack-implication";
  classification: "forecasted-consequence";
  certainty: AthenaForecastCertainty;
  description: string;
  quantity: number;
  groupIds: string[];
  objectIds: string[];
  relevantTotal: RelevantTotalKey | null;
  currentValue: number | null;
  forecastValue: number | null;
  delta: number | null;
  counterType: string | null;
  zoneOrigin: Zone | null;
  zoneDestination: Zone | null;
  grouped: boolean;
  requiresFutureSplit: boolean;
  reasonCodes: AthenaForecastReasonCode[];
}

export interface AthenaForecastRelationshipFinding {
  id: string;
  relationshipId: string;
  category: AthenaEffectRelationshipCategory;
  state: AthenaEffectRelationshipState;
  classification: AthenaForecastClassification;
  certainty: AthenaForecastCertainty;
  sourceGroupId: string | null;
  sourceLabel: string;
  observedEvent: AthenaEventCategory;
  depth: number;
  instanceCount: number | null;
  multiplicity: "per-object" | "per-event" | "single" | "unknown";
  optional: boolean;
  requiresChoice: boolean;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  generatedEventCategories: AthenaEventCategory[];
  affectedGroupIds: string[];
  reasonCodes: AthenaForecastReasonCode[];
  description: string;
}

export interface AthenaForecastReplacementFinding {
  id: string;
  relationshipId: string;
  sourceGroupId: string | null;
  sourceLabel: string;
  eventCategory: AthenaEventCategory;
  modificationCategory: string;
  certainty: AthenaForecastCertainty;
  optional: boolean;
  overlapping: boolean;
  orderingMayMatter: boolean;
  applied: boolean;
  quantityBefore: number | null;
  quantityAfter: number | null;
  replacementStepId: string | null;
  requiresAuthority: boolean;
  reasonCodes: AthenaForecastReasonCode[];
  description: string;
}

export interface AthenaForecastStaticDependency {
  id: string;
  relationshipIds: string[];
  sourceGroupId: string | null;
  sourceLabel: string;
  relevantTotal: RelevantTotalKey;
  currentObservedValue: number;
  forecastObservedValue: number | null;
  observedDelta: number | null;
  characteristic: "power" | "toughness" | "power-and-toughness" | "unknown";
  recalculationRequired: true;
  committed: false;
  certainty: AthenaForecastCertainty;
  reasonCodes: AthenaForecastReasonCode[];
  description: string;
}

export interface AthenaForecastGeneratedEvent {
  id: string;
  category: AthenaEventCategory;
  sourceRelationshipId: string | null;
  parentEventCategory: AthenaEventCategory;
  depth: number;
  path: AthenaEventCategory[];
  quantity: number | null;
  certainty: AthenaForecastCertainty;
  classification: "potential-follow-up";
  optional: boolean;
  requiresChoice: boolean;
  replacementDependent: boolean;
  bounded: true;
  description: string;
  reasonCodes: AthenaForecastReasonCode[];
}

export interface AthenaForecastChoiceRequirement {
  id: string;
  kind:
    | AthenaEffectChoiceRequirementKind
    | "counter-type"
    | "token-definition"
    | "zone"
    | "replacement-order";
  prompt: string;
  sourceRelationshipId: string | null;
  sourceGroupId: string | null;
  candidateGroupIds: string[];
  eventCategories: AthenaEventCategory[];
  requiredBeforeAccurateForecast: boolean;
  requiredBeforeCommit: boolean;
}

export interface AthenaForecastWarning {
  id: string;
  code: AthenaForecastReasonCode;
  message: string;
  relationshipId: string | null;
  groupId: string | null;
}

export interface AthenaForecastVersionSnapshot {
  awarenessContextVersion: number;
  awarenessContextFingerprint: string;
  dependencyGraphVersion: number;
  dependencyGraphFingerprint: string;
  relationshipMapVersion: number;
  relationshipMapFingerprint: string;
}

export interface AthenaForecastLifecycleRecord {
  validity: AthenaForecastValidity;
  reason: string;
  timestamp: string;
}

export interface AthenaEventForecastDiagnostics {
  forecastVersion: typeof ATHENA_EVENT_FORECAST_VERSION;
  cacheVersion: typeof ATHENA_EVENT_FORECAST_CACHE_VERSION;
  analysisDurationMs: number;
  directConsequenceCount: number;
  triggerRelationshipCount: number;
  replacementRelationshipCount: number;
  staticInvalidationCount: number;
  generatedEventCount: number;
  choiceRequirementCount: number;
  authorityRequiredCount: number;
  unsupportedConsequenceCount: number;
  forecastDepth: number;
  cacheHit: boolean;
  cancelled: boolean;
  staleResultRejected: boolean;
  lastForecastError: string | null;
  productionVisible: false;
  directBattlefieldMutation: false;
}

export interface AthenaEventForecastResult {
  version: typeof ATHENA_EVENT_FORECAST_VERSION;
  id: string;
  cacheKey: string;
  createdAt: string;
  updatedAt: string;
  validity: AthenaForecastValidity;
  input: AthenaForecastInput;
  versions: AthenaForecastVersionSnapshot;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  confirmedInput: {
    classification: "confirmed-input";
    eventCategory: AthenaEventCategory;
    quantity: number;
    description: string;
  };
  directConsequences: AthenaForecastDirectConsequence[];
  relevantTotalChanges: AthenaForecastRelevantTotalChange[];
  triggerRelationships: AthenaForecastRelationshipFinding[];
  replacementRelationships: AthenaForecastReplacementFinding[];
  replacementProcessing: AthenaReplacementProcessingResult | null;
  staticDependencies: AthenaForecastStaticDependency[];
  potentialGeneratedEvents: AthenaForecastGeneratedEvent[];
  potentialCharacteristicChanges: AthenaForecastDirectConsequence[];
  potentialCounterChanges: AthenaForecastDirectConsequence[];
  potentialTokenChanges: AthenaForecastDirectConsequence[];
  potentialLifeChanges: AthenaForecastDirectConsequence[];
  potentialCommanderDamageChanges: AthenaForecastDirectConsequence[];
  potentialZoneChanges: AthenaForecastDirectConsequence[];
  potentialStackImplications: AthenaForecastDirectConsequence[];
  requiredChoices: AthenaForecastChoiceRequirement[];
  optionalRelationshipIds: string[];
  manualResolutionRelationshipIds: string[];
  authorityRequiredRelationshipIds: string[];
  unsupportedRelationshipIds: string[];
  warnings: AthenaForecastWarning[];
  semanticDescriptions: string[];
  forecastDepth: number;
  lifecycle: AthenaForecastLifecycleRecord[];
  diagnostics: AthenaEventForecastDiagnostics;
  committedStateReadOnly: true;
  previewStateIsolated: true;
  committedResultShape: false;
  directBattlefieldMutation: false;
  canonicalStateMutated: false;
}

export interface AthenaForecastCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: string | null;
}

export interface AthenaForecastEnvironment {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
}

export interface AthenaForecastOptions {
  maxDepth?: number;
  cancellation?: AthenaForecastCancellationSignal;
  timestamp?: string;
  cacheHit?: boolean;
}

export interface AthenaForecastEngineOptions {
  maxCacheEntries?: number;
  maxForecastRecords?: number;
  maxDepth?: number;
}

export interface AthenaForecastEngineDiagnostics {
  version: typeof ATHENA_EVENT_FORECAST_VERSION;
  forecastCount: number;
  activeForecastCount: number;
  invalidatedForecastCount: number;
  averageAnalysisDurationMs: number;
  maximumAnalysisDurationMs: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cancellationCount: number;
  staleResultRejectionCount: number;
  lastForecastError: string | null;
  productionVisible: false;
}

export interface AthenaForecastInvalidationInput {
  change: AthenaGraphChange;
  timestamp?: string;
  currentVersions?: Partial<AthenaForecastVersionSnapshot>;
}

export interface AthenaForecastAdapterOptions {
  timestamp?: string;
  authoritySource?: AthenaAuthoritySource;
  knownCharacteristics?: Partial<Characteristics> | null;
  quantity?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AthenaEchoForecastAdapterInput {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
  intent: AmbientIntent;
  options?: AthenaForecastAdapterOptions;
}

export interface AthenaGameEventForecastAdapterInput {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
  event: GameEvent;
  eventSource?: AthenaForecastInputSource;
  authoritySource?: AthenaAuthoritySource;
  timestamp?: string;
  canonicalResultReference?: string | null;
}

export interface AthenaPlannerForecastAdapterInput {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
  action: PlannedAction;
  options?: AthenaForecastAdapterOptions;
}

export interface AthenaActionStripForecastAdapterInput {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
  item: ActiveTurnActionStripItem;
  options?: AthenaForecastAdapterOptions;
}
