import type {
  FieldState,
  PermanentGroup,
  RelevantTotalKey,
} from "../domain/types";
import type { AthenaStaticEffectDefinition } from "../domain/staticEffects";
import type {
  AthenaEventCategory,
  AthenaGraphChange,
} from "./dependencyGraphTypes";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaSupportFindingStatus,
} from "./types";

export const ATHENA_DERIVED_STATE_VERSION = 1;
export const ATHENA_DERIVED_STATE_CACHE_VERSION = 1;
export const ATHENA_DERIVED_STATE_CACHE_LIMIT = 64;
export const ATHENA_DERIVED_MAX_SAFE_VALUE = Number.MAX_SAFE_INTEGER;

export type AthenaDerivedStateValidity =
  | "valid"
  | "stale"
  | "cancelled"
  | "authority-required"
  | "manual-resolution-required"
  | "unsupported"
  | "invalid";

export type AthenaDerivedContributionKind =
  | "base"
  | "characteristic-defining"
  | "counter"
  | "static"
  | "attachment"
  | "temporary"
  | "authority";

export interface AthenaDerivedContribution {
  id: string;
  kind: AthenaDerivedContributionKind;
  sourceGroupId: string | null;
  definitionId: string | null;
  relationshipId: string | null;
  power: number;
  toughness: number;
  description: string;
  authoritySource: AthenaAuthoritySource;
  support: AthenaSupportFindingStatus;
}

export interface AthenaDerivedObjectState {
  version: typeof ATHENA_DERIVED_STATE_VERSION;
  groupId: string;
  objectIds: string[];
  quantity: number;
  basePower: number | null;
  baseToughness: number | null;
  characteristicPower: number | null;
  characteristicToughness: number | null;
  currentPower: number | null;
  currentToughness: number | null;
  counterPower: number;
  counterToughness: number;
  staticPower: number;
  staticToughness: number;
  attachmentPower: number;
  attachmentToughness: number;
  temporaryPower: number;
  temporaryToughness: number;
  appliedSourceRelationshipIds: string[];
  disabledSourceRelationshipIds: string[];
  contributions: AthenaDerivedContribution[];
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  support: AthenaSupportFindingStatus;
  validity: AthenaDerivedStateValidity;
  calculationVersion: typeof ATHENA_DERIVED_STATE_VERSION;
  dependencyVersion: number;
  relationshipMapVersion: number;
  canonicalFingerprint: string;
  reasonCodes: string[];
  semanticDescription: string;
  grouped: boolean;
  directBattlefieldMutation: false;
}

export interface AthenaDerivedStateDiagnostics {
  version: typeof ATHENA_DERIVED_STATE_VERSION;
  staticRelationshipCount: number;
  activeStaticRelationshipCount: number;
  disabledStaticRelationshipCount: number;
  derivedObjectCount: number;
  incrementalRecalculationCount: number;
  fullRebuildCount: number;
  averageRecalculationDurationMs: number;
  maximumRecalculationDurationMs: number;
  dirtyNodeCount: number;
  averageDirtyNodeCount: number;
  maximumDirtyNodeCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  staleResultRejectionCount: number;
  authorityOverrideCount: number;
  unsupportedStaticCalculationCount: number;
  manualResolutionCount: number;
  cycleDetectionCount: number;
  stackGroupCalculationCount: number;
  lastRecalculationReason: string;
  lastDerivedStateError: string | null;
  recalculatedGroupIds: string[];
  productionVisible: false;
  directBattlefieldMutation: false;
}

export interface AthenaDerivedBattlefieldState {
  version: typeof ATHENA_DERIVED_STATE_VERSION;
  cacheVersion: typeof ATHENA_DERIVED_STATE_CACHE_VERSION;
  fieldId: string;
  sessionId: string;
  createdAt: string;
  canonicalFingerprint: string;
  awarenessContextVersion: number;
  dependencyGraphVersion: number;
  relationshipMapVersion: number;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  validity: AthenaDerivedStateValidity;
  objects: AthenaDerivedObjectState[];
  relevantTotals: Record<RelevantTotalKey, number>;
  dirtyGroupIds: string[];
  invalidatedRelationshipIds: string[];
  unsupportedDefinitionIds: string[];
  authorityRequiredDefinitionIds: string[];
  cycleDefinitionIds: string[];
  warnings: string[];
  diagnostics: AthenaDerivedStateDiagnostics;
  committedStateReadOnly: true;
  derivedFromCanonicalState: true;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
}

export interface AthenaAuthoritativeDerivedValue {
  groupId: string;
  currentPower: number | null;
  currentToughness: number | null;
  sourceReference: string | null;
}

export interface AthenaDerivedCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: string | null;
}

export interface AthenaDerivedStateBuildOptions {
  timestamp?: string;
  reason?: string;
  definitions?: readonly AthenaStaticEffectDefinition[];
  authoritativeValues?: readonly AthenaAuthoritativeDerivedValue[];
  expectedCanonicalFingerprint?: string;
  relevantTotalOverrides?: Partial<Record<RelevantTotalKey, number>>;
  cancellation?: AthenaDerivedCancellationSignal;
}

export interface AthenaDerivedStateUpdateOptions extends AthenaDerivedStateBuildOptions {
  change: AthenaGraphChange;
}

export interface AthenaDerivedStateUpdateResult {
  state: AthenaDerivedBattlefieldState;
  equivalentToFullRebuild: boolean;
  changedGroupIds: string[];
  staleGroupIdsRemoved: string[];
}

export interface AthenaDerivedStateQueryApi {
  getObject(groupId: string): AthenaDerivedObjectState | null;
  getCurrentPowerToughness(groupId: string): {
    power: number | null;
    toughness: number | null;
  } | null;
  getContributions(groupId: string): AthenaDerivedContribution[];
  getObjectsDependingOnTotal(
    total: RelevantTotalKey,
  ): AthenaDerivedObjectState[];
  getObjectsAffectedBySource(groupId: string): AthenaDerivedObjectState[];
  getUnsupportedObjects(): AthenaDerivedObjectState[];
  getSemanticDescription(groupId: string): string | null;
}

export interface AthenaDerivedPreviewRequest {
  relevantTotalDeltas: Partial<Record<RelevantTotalKey, number>>;
  source: "planner" | "action-strip" | "athena-forecast" | "manual-preview";
  eventCategories?: AthenaEventCategory[];
}

export interface AthenaDerivedPreviewResult {
  source: AthenaDerivedPreviewRequest["source"];
  current: AthenaDerivedBattlefieldState;
  preview: AthenaDerivedBattlefieldState;
  changedGroupIds: string[];
  committedFieldMutated: false;
}

export interface AthenaDerivedFieldApplicationResult {
  field: FieldState;
  state: AthenaDerivedBattlefieldState;
  applied: boolean;
}

export interface AthenaDerivedCanonicalGroupView {
  group: PermanentGroup;
  staticPower: number;
  staticToughness: number;
}
