import type {
  FieldState,
  GameEventType,
  RelevantTotalKey,
  SupportStatus,
  Zone,
} from "../domain/types";
import type { AmbientIntentKind } from "../echo/ambientEventTypes";
import type { AthenaStaticEffectDefinition } from "../domain/staticEffects";
import type {
  AthenaAuthorityPrecedence,
  AthenaAuthoritySource,
  AthenaSourceUnavailableReason,
  AthenaSupportFindingStatus,
} from "./types";

export const ATHENA_DEPENDENCY_GRAPH_VERSION = 1;
export const ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION = 1;

export type AthenaEventCategory =
  | GameEventType
  | "token-entered"
  | "token-removed"
  | "zone-changed"
  | "attack-declared"
  | "combat-damage"
  | "combat-completed";

export const ATHENA_EVENT_CATEGORIES: readonly AthenaEventCategory[] = [
  "permanent-entered",
  "creature-entered",
  "token-created",
  "token-entered",
  "land-entered",
  "counter-placed",
  "counter-removed",
  "life-gained",
  "life-lost",
  "damage-dealt",
  "combat-damage",
  "permanent-died",
  "permanent-sacrificed",
  "permanent-exiled",
  "permanent-returned-to-hand",
  "permanent-returned-to-battlefield",
  "permanent-transformed",
  "permanent-tapped",
  "permanent-untapped",
  "spell-cast",
  "attack-declared",
  "combat-completed",
  "token-removed",
  "zone-changed",
  "trigger-announced",
  "reminder-created",
  "battlefield-note-created",
];

export type AthenaGraphNodeType =
  | "battlefield-object"
  | "player-state"
  | "relevant-total"
  | "zone"
  | "event-category"
  | "effect-definition"
  | "token-definition"
  | "counter-definition"
  | "authority-marker";

export type AthenaGraphRelationshipType =
  | "observes"
  | "modifies"
  | "reads"
  | "contributes-to"
  | "affects"
  | "creates"
  | "places-counters-on"
  | "attached-to"
  | "derived-from"
  | "controls"
  | "owns"
  | "invalidates"
  | "requires-choice"
  | "requires-authority";

export type AthenaGraphDisabledReason =
  | Exclude<AthenaSourceUnavailableReason, null>
  | "missing-host"
  | "stale-reference"
  | "support-boundary"
  | "authority-required"
  | "manual-resolution-required"
  | "cache-mismatch"
  | "not-applicable"
  | "none";

export type AthenaGraphBuildReason =
  | "initial-load"
  | "full-rebuild"
  | "incremental-update"
  | "migration"
  | "import"
  | "reload"
  | "cache-discarded"
  | "version-change"
  | "diagnostics"
  | "test";

export type AthenaGraphUpdateKind =
  | "card-added"
  | "card-removed"
  | "generic-added"
  | "generic-removed"
  | "token-quantity-changed"
  | "counter-changed"
  | "relevant-total-changed"
  | "attachment-added"
  | "attachment-removed"
  | "tracking-toggled"
  | "depower-changed"
  | "transformed"
  | "stack-split"
  | "stack-merge"
  | "controller-changed"
  | "owner-changed"
  | "zone-changed"
  | "effect-definition-changed"
  | "authority-result-received"
  | "undo"
  | "redo"
  | "import"
  | "reload"
  | "echo-staged-intent-changed"
  | "preview-invalidation"
  | "full-rebuild";

export interface AthenaGraphChange {
  kind: AthenaGraphUpdateKind;
  groupIds?: string[];
  objectIds?: string[];
  nodeIds?: string[];
  relationshipIds?: string[];
  eventCategories?: AthenaEventCategory[];
  relevantTotals?: RelevantTotalKey[];
  zones?: Zone[];
  reason?: string;
  timestamp?: string;
}

export interface AthenaGraphNode {
  id: string;
  type: AthenaGraphNodeType;
  label: string;
  fieldId: string;
  sessionId: string;
  groupId: string | null;
  objectIds: string[];
  relevantTotal: RelevantTotalKey | null;
  zone: Zone | null;
  eventCategory: AthenaEventCategory | null;
  effectKind: string | null;
  quantity: number;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus | null;
  enabled: boolean;
  disabledReason: AthenaGraphDisabledReason;
  fingerprint: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AthenaGraphRelationship {
  id: string;
  type: AthenaGraphRelationshipType;
  from: string;
  to: string;
  label: string;
  fieldId: string;
  sessionId: string;
  sourceGroupId: string | null;
  targetGroupIds: string[];
  sourceObjectIds: string[];
  targetObjectIds: string[];
  eventCategories: AthenaEventCategory[];
  relevantTotals: RelevantTotalKey[];
  quantity: number;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  supportStatus: SupportStatus | null;
  support: AthenaSupportFindingStatus | null;
  enabled: boolean;
  disabledReason: AthenaGraphDisabledReason;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
  definitionVersion: number;
  invalidatesNodeIds: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface AthenaGraphIndexes {
  nodeIdsByType: Record<AthenaGraphNodeType, string[]>;
  relationshipIdsByType: Record<AthenaGraphRelationshipType, string[]>;
  relationshipsBySource: Record<string, string[]>;
  relationshipsByTarget: Record<string, string[]>;
  relationshipsByGroupId: Record<string, string[]>;
  observersByEvent: Record<string, string[]>;
  modifiersByEvent: Record<string, string[]>;
  readersByTotal: Record<string, string[]>;
  contributorsByTotal: Record<string, string[]>;
  attachmentsByHost: Record<string, string[]>;
  disabledByReason: Record<string, string[]>;
  unsupportedRelationshipIds: string[];
  authorityRequiredRelationshipIds: string[];
}

export interface AthenaGraphInvalidationResult {
  changedNodeIds: string[];
  affectedNodeIds: string[];
  relationshipIds: string[];
  previewInvalidated: boolean;
  reasons: string[];
  staleReferenceIds: string[];
  durationMs: number;
  directBattlefieldMutation: false;
}

export interface AthenaGraphDiagnostics {
  graphVersion: typeof ATHENA_DEPENDENCY_GRAPH_VERSION;
  cacheVersion: typeof ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION;
  nodeCount: number;
  relationshipCount: number;
  activeRelationshipCount: number;
  disabledRelationshipCount: number;
  unsupportedRelationshipCount: number;
  authorityRequiredRelationshipCount: number;
  fullRebuildDurationMs: number;
  incrementalUpdateDurationMs: number;
  lastInvalidationSet: string[];
  staleReferenceCount: number;
  cycleCount: number;
  lastRebuildReason: AthenaGraphBuildReason;
  lastError: string | null;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
}

export interface AthenaDependencyGraph {
  version: typeof ATHENA_DEPENDENCY_GRAPH_VERSION;
  cacheVersion: typeof ATHENA_DEPENDENCY_GRAPH_CACHE_VERSION;
  fieldId: string;
  sessionId: string;
  contextVersion: number;
  createdAt: string;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  fingerprint: string;
  nodes: AthenaGraphNode[];
  relationships: AthenaGraphRelationship[];
  indexes: AthenaGraphIndexes;
  diagnostics: AthenaGraphDiagnostics;
  committedStateReadOnly: true;
  derivedFromCanonicalState: true;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
}

export interface AthenaGraphBuildOptions {
  timestamp?: string;
  authoritySource?: AthenaAuthoritySource;
  reason?: AthenaGraphBuildReason;
  maxRelationships?: number;
  staticDefinitions?: readonly AthenaStaticEffectDefinition[];
}

export interface AthenaGraphUpdateResult {
  graph: AthenaDependencyGraph;
  invalidation: AthenaGraphInvalidationResult;
  equivalentToFullRebuild: boolean;
}

export interface AthenaEchoDependencyQueryResult {
  intentId: string;
  intentKind: AmbientIntentKind;
  eventCategories: AthenaEventCategory[];
  relevantTotals: RelevantTotalKey[];
  observers: AthenaGraphRelationship[];
  modifiers: AthenaGraphRelationship[];
  staticReaders: AthenaGraphRelationship[];
  contributors: AthenaGraphRelationship[];
  disabledRelationships: AthenaGraphRelationship[];
  unsupportedRelationships: AthenaGraphRelationship[];
  authorityRequiredRelationships: AthenaGraphRelationship[];
}

export interface AthenaGraphQueryApi {
  getNode(id: string): AthenaGraphNode | null;
  getRelationship(id: string): AthenaGraphRelationship | null;
  getObserversForEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaGraphRelationship[];
  getModifiersForEvent(
    eventCategory: AthenaEventCategory,
  ): AthenaGraphRelationship[];
  getStaticReadersForTotal(total: RelevantTotalKey): AthenaGraphRelationship[];
  getContributorsToTotal(total: RelevantTotalKey): AthenaGraphRelationship[];
  getEffectsAffectingObject(groupId: string): AthenaGraphRelationship[];
  getTargetsAffectedBySource(groupId: string): AthenaGraphRelationship[];
  getTokenDefinitionsCreatedBySource(
    groupId: string,
  ): AthenaGraphRelationship[];
  getCounterRelationshipsFromSource(groupId: string): AthenaGraphRelationship[];
  getAttachmentsForObject(groupId: string): AthenaGraphRelationship[];
  getDependentNodes(nodeId: string): AthenaGraphNode[];
  getInvalidationForChange(
    change: AthenaGraphChange,
  ): AthenaGraphInvalidationResult;
  getRelationshipsDisabledByTracking(): AthenaGraphRelationship[];
  getRelationshipsDisabledByDepower(): AthenaGraphRelationship[];
  getUnsupportedRelationships(): AthenaGraphRelationship[];
  getAuthorityRequiredRelationships(): AthenaGraphRelationship[];
  getRelationshipsForObject(groupId: string): AthenaGraphRelationship[];
  getRelationshipsForEventSource(sourceId: string): AthenaGraphRelationship[];
  getDependenciesForEchoIntent(
    intent: Pick<
      import("../echo/ambientEventTypes").AmbientIntent,
      "id" | "kind" | "entities"
    >,
  ): AthenaEchoDependencyQueryResult;
}

export interface AthenaGraphContextInput {
  field: FieldState;
  options?: AthenaGraphBuildOptions;
}

/** Minimal characteristic view accepted by Athena's shared total classifier. */
export interface AthenaRelevantTotalSubject {
  zone: Zone;
  cardTypes: string[];
  subtypes: string[];
  supertypes: string[];
  colors?: string[];
  isToken: boolean;
  identityKnown?: boolean;
  isCommander?: boolean;
  manaCost?: string;
}
