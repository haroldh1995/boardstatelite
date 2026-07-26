import type { CardIdentity, FieldState, Owner, Zone } from "../domain/types";
import type { AmbientConfidenceLevel } from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientIntent,
  AmbientIntentKind,
} from "./ambientEventTypes";
import type { EchoListeningWindowKind } from "./contextualListeningTypes";

export const ECHO_ENTITY_RESOLUTION_VERSION = 1;
export const ECHO_ENTITY_RESOLUTION_CACHE_LIMIT = 250;

export type EchoEntityKind =
  | "card"
  | "commander"
  | "creature"
  | "token"
  | "tokenStack"
  | "player"
  | "opponent"
  | "permanent"
  | "land"
  | "artifact"
  | "enchantment"
  | "planeswalker"
  | "battle"
  | "counter"
  | "mana"
  | "zone"
  | "trigger"
  | "reminder";

export type EchoEntityResolutionPriority =
  | "battlefield"
  | "tracked"
  | "planner"
  | "actionStrip"
  | "recent"
  | "deckSnapshot"
  | "localCache"
  | "scryfall"
  | "fuzzy";

export type EchoEntityResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "missing"
  | "rejected";

export interface EchoEntityResolutionSettings {
  version: typeof ECHO_ENTITY_RESOLUTION_VERSION;
  diagnosticsEnabled: boolean;
  cacheManagementPrepared: true;
  resolutionResetPrepared: true;
  localCacheSize: number;
  scryfallFallbackEnabled: boolean;
  fuzzySearchEnabled: boolean;
  lastResetAt: string | null;
}

export interface EchoDeckSnapshotCard {
  cardId: string;
  name: string;
  typeLine?: string;
  oracleText?: string;
  isCommander?: boolean;
  quantity?: number;
}

export interface EchoEntityRelationship {
  id: string;
  kind:
    | "attachment"
    | "attached-to"
    | "counter-on"
    | "commander-owned-by"
    | "token-stack"
    | "planner-reference"
    | "action-strip-reference";
  sourceId: string;
  targetId: string | null;
  label: string;
}

export interface EchoEntityResolutionCandidate {
  id: string;
  kind: EchoEntityKind;
  label: string;
  normalizedLabel: string;
  priority: EchoEntityResolutionPriority;
  priorityRank: number;
  score: number;
  confidenceLevel: AmbientConfidenceLevel;
  entity: AmbientEntityReference | null;
  groupId: string | null;
  objectIds: string[];
  owner: Owner | null;
  controller: Owner | null;
  zone: Zone | null;
  cardId: string | null;
  source:
    | "battlefield"
    | "planner"
    | "action-strip"
    | "recent"
    | "deck-snapshot"
    | "local-cache"
    | "scryfall"
    | "fuzzy";
  relationshipIds: string[];
  relationshipSummary: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface EchoEntityResolutionAmbiguity {
  type:
    | "multiple-battlefield-objects"
    | "multiple-token-stacks"
    | "multiple-players"
    | "low-confidence"
    | "missing-entity"
    | "external-lookup-needed";
  message: string;
  candidates: string[];
}

export interface EchoBattlefieldContextEntity {
  groupId: string;
  objectIds: string[];
  label: string;
  normalizedLabel: string;
  owner: Owner;
  controller: Owner;
  zone: Zone;
  quantity: number;
  cardId: string | null;
  isCommanderCandidate: boolean;
  isToken: boolean;
  isGeneric: boolean;
  cardTypes: string[];
  subtypes: string[];
  supertypes: string[];
  counters: Record<string, number>;
  attachedTo: string | null;
  attachments: string[];
  trackingEnabled: boolean;
}

export interface EchoBattlefieldContext {
  version: typeof ECHO_ENTITY_RESOLUTION_VERSION;
  createdAt: string;
  fieldId: string;
  sessionId: string;
  ambientMode: FieldState["ambient"]["currentMode"];
  currentPhase: string | null;
  currentTurn: string | null;
  activeWindowKind: EchoListeningWindowKind | null;
  battlefield: EchoBattlefieldContextEntity[];
  plannerReferences: EchoContextReference[];
  actionStripReferences: EchoContextReference[];
  recentReferences: EchoContextReference[];
  relationships: EchoEntityRelationship[];
  diagnostics: {
    battlefieldObjectCount: number;
    plannerReferenceCount: number;
    actionStripReferenceCount: number;
    recentReferenceCount: number;
    relationshipCount: number;
    directBattlefieldMutation: false;
  };
}

export interface EchoContextReference {
  id: string;
  source: "planner" | "action-strip" | "recent" | "field-recent";
  label: string;
  normalizedLabel: string;
  groupId: string | null;
  cardId: string | null;
  intentKind: AmbientIntentKind | null;
  order: number;
}

export interface EchoEntityResolutionRequest {
  text: string;
  field: FieldState;
  intent?: AmbientIntent | null;
  role?:
    | "source"
    | "target"
    | "attachment"
    | "host"
    | "counter"
    | "origin"
    | "destination"
    | "session"
    | "scale";
  expectedKinds?: EchoEntityKind[];
  timestamp?: string;
  recentEntityIds?: string[];
  deckSnapshot?: EchoDeckSnapshotCard[];
  cachedCards?: CardIdentity[];
  settings?: EchoEntityResolutionSettings;
}

export interface EchoEntityResolutionFallbackRequest extends EchoEntityResolutionRequest {
  scryfallSearch?: (query: string) => Promise<CardIdentity[]>;
}

export interface EchoEntityResolutionResult {
  version: typeof ECHO_ENTITY_RESOLUTION_VERSION;
  status: EchoEntityResolutionStatus;
  text: string;
  normalizedText: string;
  selected: EchoEntityResolutionCandidate | null;
  candidates: EchoEntityResolutionCandidate[];
  ambiguities: EchoEntityResolutionAmbiguity[];
  confidence: {
    level: AmbientConfidenceLevel;
    score: number | null;
    reasons: string[];
  };
  resolvedEntities: AmbientEntityReference[];
  context: EchoBattlefieldContext;
  diagnostics: EchoEntityResolutionDiagnostics;
  accessibilityAnnouncement: string;
  directBattlefieldMutation: false;
}

export interface EchoEntityResolutionDiagnostics {
  version: typeof ECHO_ENTITY_RESOLUTION_VERSION;
  status: EchoEntityResolutionStatus | null;
  lastResolvedAt: string | null;
  lastText: string | null;
  lastSelectedId: string | null;
  candidateCount: number;
  ambiguityCount: number;
  scryfallFallbackAttempted: boolean;
  scryfallFallbackReason: string | null;
  cacheSize: number;
  directBattlefieldMutation: false;
}

export interface EchoRecentlyResolvedEntity {
  id: string;
  label: string;
  normalizedLabel: string;
  kind: EchoEntityKind;
  groupId: string | null;
  cardId: string | null;
  lastResolvedAt: string;
  count: number;
}

export interface EchoEntityResolutionState {
  version: typeof ECHO_ENTITY_RESOLUTION_VERSION;
  recentlyResolved: EchoRecentlyResolvedEntity[];
  frequentlyReferenced: Record<string, number>;
  localCache: EchoEntityResolutionCandidate[];
  diagnostics: EchoEntityResolutionDiagnostics;
}
