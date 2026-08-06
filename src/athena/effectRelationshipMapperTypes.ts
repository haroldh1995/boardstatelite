import type { RelevantTotalKey, SupportStatus, Zone } from "../domain/types";
import type { AmbientIntentKind } from "../echo/ambientEventTypes";
import type {
  AthenaDependencyGraph,
  AthenaEventCategory,
  AthenaGraphChange,
  AthenaGraphInvalidationResult,
} from "./dependencyGraphTypes";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaSourceUnavailableReason,
  AthenaSupportFindingStatus,
} from "./types";

export const ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION = 1;

export type AthenaEffectRelationshipCategory =
  | "triggered-ability"
  | "replacement-effect"
  | "static-effect"
  | "continuous-effect"
  | "scaling-effect"
  | "characteristic-defining-effect"
  | "token-creation"
  | "counter-placement"
  | "life-modification"
  | "relevant-total-reader"
  | "background-watcher"
  | "custom-supported-automation"
  | "authority-required"
  | "unsupported-effect";

export type AthenaEffectRelationshipState =
  | "enabled"
  | "disabled"
  | "tracking-disabled"
  | "depowered"
  | "unsupported"
  | "authority-required"
  | "partially-supported"
  | "temporarily-inactive"
  | "invalidated"
  | "awaiting-rebuild"
  | "awaiting-authority"
  | "awaiting-manual-resolution";

export type AthenaEffectTargetSetKind =
  | "this-object"
  | "all-battlefield"
  | "all-creatures"
  | "controlled-creatures"
  | "artifacts"
  | "equipment"
  | "tokens"
  | "token-groups"
  | "subtype"
  | "commander"
  | "player"
  | "opponent"
  | "relevant-total"
  | "zone-quantity"
  | "custom"
  | "none";

export type AthenaEffectChoiceRequirementKind =
  | "object"
  | "target"
  | "quantity"
  | "player"
  | "mode"
  | "optional-decision"
  | "opponent-value"
  | "manual-resolution"
  | "authority";

export type AthenaEffectModificationCategory =
  | "token-multiplier"
  | "counter-multiplier"
  | "enter-battlefield-replacement"
  | "event-modifier"
  | "unknown";

export interface AthenaEffectSourceDescriptor {
  id: string;
  stableIdentity: string;
  battlefieldObjectGroupId: string | null;
  objectIds: string[];
  controller: string | null;
  owner: string | null;
  abilityIdentifier: string;
  definitionIdentifier: string;
  supportLevel: SupportStatus | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  enabled: boolean;
  trackingEnabled: boolean;
  depowerMode: string;
  transformationState: "current-face" | "transformed";
  currentCardFace: string | null;
  graphNodeId: string;
}

export interface AthenaTriggerConditionDescriptor {
  id: string;
  eventCategory: AthenaEventCategory;
  description: string;
  optional: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AthenaEffectTargetSetDescriptor {
  kind: AthenaEffectTargetSetKind;
  label: string;
  groupIds: string[];
  objectIds: string[];
  relevantTotals: RelevantTotalKey[];
  zones: Zone[];
  subtype: string | null;
  includesSource: boolean;
  requiresChoice: boolean;
}

export interface AthenaGeneratedEventDescriptor {
  id: string;
  category: AthenaEventCategory;
  sourceRelationshipId: string;
  label: string;
  optional: boolean;
  requiresChoice: boolean;
}

export interface AthenaEffectChoiceRequirementDescriptor {
  id: string;
  kind: AthenaEffectChoiceRequirementKind;
  prompt: string;
  sourceGroupId: string | null;
  candidateGroupIds: string[];
  relevantTotals: RelevantTotalKey[];
  eventCategories: AthenaEventCategory[];
  requiredBeforeCommit: boolean;
}

export interface AthenaMappedEffectRelationship {
  id: string;
  version: typeof ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION;
  category: AthenaEffectRelationshipCategory;
  state: AthenaEffectRelationshipState;
  source: AthenaEffectSourceDescriptor;
  observedEvents: AthenaTriggerConditionDescriptor[];
  triggerCondition: AthenaTriggerConditionDescriptor | null;
  affectedObjectSet: AthenaEffectTargetSetDescriptor;
  generatedEventCategories: AthenaEventCategory[];
  generatedEvents: AthenaGeneratedEventDescriptor[];
  requiredChoices: AthenaEffectChoiceRequirementDescriptor[];
  optional: boolean;
  modifiesEvent: boolean;
  modificationCategory: AthenaEffectModificationCategory | null;
  relevantTotals: RelevantTotalKey[];
  targetGroupIds: string[];
  graphNodeIds: string[];
  graphRelationshipIds: string[];
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  enabled: boolean;
  disabledReason: AthenaSourceUnavailableReason | string | null;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  relationshipMetadata: Record<string, string | number | boolean | null>;
}

export interface AthenaEffectRelationshipIndexes {
  relationshipIdsByCategory: Record<AthenaEffectRelationshipCategory, string[]>;
  relationshipsBySourceGroupId: Record<string, string[]>;
  relationshipsByAffectedGroupId: Record<string, string[]>;
  triggersByEvent: Record<string, string[]>;
  replacementsByEvent: Record<string, string[]>;
  staticReadersByTotal: Record<string, string[]>;
  followUpEventsByEvent: Record<string, string[]>;
  disabledRelationshipIds: string[];
  unsupportedRelationshipIds: string[];
  authorityRequiredRelationshipIds: string[];
  choiceRequiredRelationshipIds: string[];
}

export interface AthenaEffectRelationshipDiagnostics {
  mapperVersion: typeof ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION;
  relationshipCount: number;
  triggerCount: number;
  replacementCount: number;
  staticCount: number;
  disabledRelationshipCount: number;
  unsupportedRelationshipCount: number;
  authorityRequiredRelationshipCount: number;
  generatedEventRelationshipCount: number;
  averageRebuildDurationMs: number;
  fullRebuildDurationMs: number;
  incrementalUpdateDurationMs: number;
  relationshipRebuildReason: string;
  lastMapperError: string | null;
  productionVisible: false;
  directBattlefieldMutation: false;
}

export interface AthenaEffectRelationshipMap {
  version: typeof ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION;
  fieldId: string;
  sessionId: string;
  contextVersion: number;
  graphVersion: AthenaDependencyGraph["version"];
  createdAt: string;
  fingerprint: string;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  relationships: AthenaMappedEffectRelationship[];
  indexes: AthenaEffectRelationshipIndexes;
  diagnostics: AthenaEffectRelationshipDiagnostics;
  committedStateReadOnly: true;
  derivedFromCanonicalState: true;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
}

export interface AthenaEffectRelationshipBuildOptions {
  timestamp?: string;
  reason?: string;
}

export interface AthenaEffectRelationshipUpdateResult {
  relationshipMap: AthenaEffectRelationshipMap;
  invalidation: AthenaGraphInvalidationResult;
  equivalentToFullRebuild: boolean;
}

export interface AthenaEffectRelationshipQueryApi {
  getRelationship(id: string): AthenaMappedEffectRelationship | null;
  getTriggersObservingEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaMappedEffectRelationship[];
  getReplacementEffectsModifyingEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaMappedEffectRelationship[];
  getStaticEffectsReadingValue(
    total: RelevantTotalKey,
  ): AthenaMappedEffectRelationship[];
  getRelationshipsOriginatingFromPermanent(
    groupId: string,
  ): AthenaMappedEffectRelationship[];
  getRelationshipsAffectingPermanent(
    groupId: string,
  ): AthenaMappedEffectRelationship[];
  getDisabledRelationships(): AthenaMappedEffectRelationship[];
  getAuthorityRequiredRelationships(): AthenaMappedEffectRelationship[];
  getUnsupportedRelationships(): AthenaMappedEffectRelationship[];
  getFollowUpEventsForEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaGeneratedEventDescriptor[];
  getRequiredChoicesForEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaEffectChoiceRequirementDescriptor[];
  getRelationshipsForEchoIntent(input: {
    id: string;
    kind: AmbientIntentKind;
  }): AthenaMappedEffectRelationship[];
  getInvalidationForChange(
    graphChange: AthenaGraphChange,
  ): AthenaGraphInvalidationResult;
}
