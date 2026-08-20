import type { Characteristics, SupportStatus, Zone } from "../domain/types";
import type { AthenaEventCategory } from "./dependencyGraphTypes";
import type {
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaSupportFindingStatus,
} from "./types";

export const ATHENA_REPLACEMENT_CHAIN_VERSION = 1;
export const ATHENA_REPLACEMENT_CACHE_VERSION = 1;
export const ATHENA_REPLACEMENT_MAX_CHAIN_LENGTH = 64;
export const ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY = 9_007_199_254_740_991;

export type AthenaReplacementValidity =
  | "resolved"
  | "bypassed"
  | "unresolved"
  | "authority-required"
  | "manual-required"
  | "cancelled"
  | "stale"
  | "invalid"
  | "loop-detected"
  | "overflow";

export type AthenaReplacementModificationCategory =
  | "quantity-multiplier"
  | "quantity-additive"
  | "quantity-setter"
  | "entry-state"
  | "destination-replacement"
  | "event-substitution";

export type AthenaReplacementScopeKind =
  | "controlled-tokens"
  | "controlled-permanents"
  | "specific-counter-types"
  | "specific-permanent-types"
  | "all-personal-events";

export type AthenaReplacementModification =
  | {
      category: "quantity-multiplier";
      factor: number;
    }
  | {
      category: "quantity-additive";
      amount: number;
    }
  | {
      category: "quantity-setter";
      quantity: number;
    }
  | {
      category: "entry-state";
      tapped?: boolean;
      transformed?: boolean;
      counterType?: string;
      counterQuantity?: number;
      characteristicPatch?: Partial<Characteristics>;
    }
  | {
      category: "destination-replacement";
      destination: Zone;
    }
  | {
      category: "event-substitution";
      eventCategory: AthenaEventCategory;
    };

export interface AthenaReplacementScope {
  kind: AthenaReplacementScopeKind;
  counterTypes: string[];
  permanentTypes: string[];
  controllerMode: "source-controller" | "local-participant" | "any";
}

export interface AthenaReplacementDefinition {
  version: typeof ATHENA_REPLACEMENT_CHAIN_VERSION;
  id: string;
  relationshipId: string;
  sourceGroupId: string | null;
  sourceObjectIds: string[];
  sourceLabel: string;
  sourceQuantity: number;
  eventCategories: AthenaEventCategory[];
  modification: AthenaReplacementModification;
  scope: AthenaReplacementScope;
  enabled: boolean;
  optional: boolean;
  commutative: boolean;
  appliesOncePerEvent: boolean;
  order: number | null;
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  definitionVersion: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AthenaReplacementApplication {
  id: string;
  applicationId: string;
  definitionId: string;
  relationshipId: string;
  sourceGroupId: string | null;
  sourceLabel: string;
  sourceInstance: number;
  modificationCategory: AthenaReplacementModificationCategory;
  previousEventId: string;
  resultingEventId: string;
  quantityBefore: number;
  quantityAfter: number;
  eventCategoryBefore: AthenaEventCategory;
  eventCategoryAfter: AthenaEventCategory;
  zoneBefore: Zone | null;
  zoneAfter: Zone | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus | null;
  explanation: string;
  remainingApplicationIds: string[];
  applied: true;
}

export interface AthenaExcludedReplacement {
  id: string;
  relationshipId: string;
  sourceGroupId: string | null;
  sourceLabel: string;
  reason:
    | "disabled"
    | "not-tracked"
    | "depowered"
    | "source-missing"
    | "scope-mismatch"
    | "event-mismatch"
    | "unsupported"
    | "manual-required"
    | "authority-required"
    | "duplicate"
    | "invalid-definition";
  explanation: string;
}

export interface AthenaReplacementChoiceRequirement {
  id: string;
  kind: "replacement-order" | "optional-decision" | "scope";
  prompt: string;
  relationshipIds: string[];
  sourceGroupIds: string[];
  requiredBeforeFinalEvent: true;
}

export interface AthenaReplacementWarning {
  id: string;
  code:
    | "invalid-event"
    | "invalid-quantity"
    | "overflow"
    | "unresolved-order"
    | "unsupported-modifier"
    | "authority-required"
    | "manual-required"
    | "duplicate-prevented"
    | "loop-detected"
    | "stale-version"
    | "cancelled"
    | "authority-discrepancy";
  message: string;
  relationshipId: string | null;
  sourceGroupId: string | null;
}

export interface AthenaReplacementVersionSnapshot {
  awarenessContextVersion: number;
  awarenessContextFingerprint: string;
  dependencyGraphVersion: number;
  dependencyGraphFingerprint: string;
  relationshipMapVersion: number;
  relationshipMapFingerprint: string;
}

export interface AthenaReplacementDiagnostics {
  chainVersion: typeof ATHENA_REPLACEMENT_CHAIN_VERSION;
  cacheVersion: typeof ATHENA_REPLACEMENT_CACHE_VERSION;
  processingDurationMs: number;
  applicableReplacementCount: number;
  appliedReplacementCount: number;
  tokenMultiplierCount: number;
  counterMultiplierCount: number;
  additiveModifierCount: number;
  destinationReplacementCount: number;
  eventSubstitutionCount: number;
  unresolvedReplacementCount: number;
  authorityRequiredReplacementCount: number;
  duplicatePreventionCount: number;
  loopDetectionCount: number;
  chainLength: number;
  cacheHit: boolean;
  staleChainRejected: boolean;
  localAuthorityDiscrepancyCount: number;
  lastReplacementError: string | null;
  productionVisible: false;
  directBattlefieldMutation: false;
}

export interface AthenaReplacementProcessingResult {
  version: typeof ATHENA_REPLACEMENT_CHAIN_VERSION;
  id: string;
  cacheKey: string;
  createdAt: string;
  updatedAt: string;
  validity: AthenaReplacementValidity;
  originalEvent: AthenaForecastInput;
  currentModifiedEvent: AthenaForecastInput;
  finalEvent: AthenaForecastInput | null;
  applicableDefinitions: AthenaReplacementDefinition[];
  excludedReplacements: AthenaExcludedReplacement[];
  appliedRelationshipIds: string[];
  appliedApplicationIds: string[];
  replacementOrder: string[];
  steps: AthenaReplacementApplication[];
  requiredChoices: AthenaReplacementChoiceRequirement[];
  warnings: AthenaReplacementWarning[];
  semanticDescriptions: string[];
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  authorityFinalEventAccepted: boolean;
  versions: AthenaReplacementVersionSnapshot;
  forecastReference: string | null;
  canonicalEventReference: string | null;
  diagnostics: AthenaReplacementDiagnostics;
  committedStateReadOnly: true;
  previewStateIsolated: true;
  directBattlefieldMutation: false;
  canonicalStateMutated: false;
}

export interface AthenaReplacementCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: string | null;
}

export interface AthenaReplacementProcessingOptions {
  timestamp?: string;
  cancellation?: AthenaReplacementCancellationSignal;
  customDefinitions?: AthenaReplacementDefinition[];
  authoritativeFinalEvent?: AthenaForecastInput | null;
  previouslyAppliedApplicationIds?: string[];
  forecastReference?: string | null;
  cacheHit?: boolean;
  selectedReplacementOrder?: string[];
  optionalReplacementDecisions?: Record<string, boolean>;
}

export interface AthenaReplacementEngineOptions {
  maxCacheEntries?: number;
  maxResultRecords?: number;
}

export interface AthenaReplacementEngineDiagnostics {
  version: typeof ATHENA_REPLACEMENT_CHAIN_VERSION;
  replacementAnalysisCount: number;
  appliedReplacementCount: number;
  tokenMultiplierCount: number;
  counterMultiplierCount: number;
  additiveModifierCount: number;
  destinationReplacementCount: number;
  eventSubstitutionCount: number;
  unresolvedReplacementCount: number;
  authorityRequiredReplacementCount: number;
  duplicatePreventionCount: number;
  loopDetectionCount: number;
  averageChainLength: number;
  maximumChainLength: number;
  averageProcessingDurationMs: number;
  maximumProcessingDurationMs: number;
  cacheHitCount: number;
  cacheMissCount: number;
  staleChainRejectionCount: number;
  localAuthorityDiscrepancyCount: number;
  lastReplacementError: string | null;
  productionVisible: false;
}

export interface AthenaReplacementInvalidationInput {
  currentVersions?: Partial<AthenaReplacementVersionSnapshot>;
  relationshipIds?: string[];
  groupIds?: string[];
  reason: string;
  timestamp?: string;
}

export interface AthenaReplacementEngineRequest {
  environment: AthenaForecastEnvironment;
  event: AthenaForecastInput;
  options?: AthenaReplacementProcessingOptions;
}
