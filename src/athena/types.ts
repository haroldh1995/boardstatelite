import type {
  FieldState,
  GameEvent,
  GameEventType,
  Owner,
  PermanentGroup,
  RelevantTotalKey,
  ResolutionResult,
  SupportStatus,
  Zone,
} from "../domain/types";
import type { AmbientIntent } from "../echo/ambientEventTypes";
import type {
  AmbientGameplayMode,
  AmbientObservedController,
  AmbientObservedPhase,
} from "../echo/ambientTypes";
import type { EchoListeningWindowKind } from "../echo/contextualListeningTypes";
import type { SessionAuthority } from "../sharedSession/types";

export const ATHENA_FOUNDATION_VERSION = 1;
export const ATHENA_CONTEXT_VERSION = 1;
export const ATHENA_PREVIEW_VERSION = 1;
export const ATHENA_COMPATIBILITY_VERSION = "0.1.0";

export type AthenaAuthoritySource =
  | "boardstate-authoritative-result"
  | "confirmed-canonical-session-result"
  | "confirmed-user-report"
  | "lite-local-helper-result"
  | "project-echo-voice-report"
  | "project-echo-planned-action"
  | "correction-only"
  | "imported-canonical-event"
  | "lite-preview"
  | "unknown";

export type AthenaAuthorityPrecedence = 1 | 2 | 3 | 4 | 5 | 6;

export interface AthenaAuthorityComparison {
  winner: AthenaAuthoritySource;
  loser: AthenaAuthoritySource;
  tied: boolean;
  winningPrecedence: AthenaAuthorityPrecedence;
  losingPrecedence: AthenaAuthorityPrecedence;
}

export type AthenaSupportFindingStatus =
  | "fully-understood-consequence"
  | "partially-understood-consequence"
  | "missing-choice"
  | "missing-opponent-value"
  | "unsupported-effect"
  | "authority-required"
  | "manual-resolution-required";

export type AthenaPreviewStatus =
  | "created"
  | "calculating"
  | "ready"
  | "awaiting-choice"
  | "awaiting-confirmation"
  | "invalidated"
  | "accepted"
  | "rejected"
  | "committed"
  | "cancelled"
  | "expired";

export interface AthenaPreviewLifecycleRecord {
  status: AthenaPreviewStatus;
  reason: string;
  timestamp: string;
}

export interface AthenaPreviewState {
  version: typeof ATHENA_PREVIEW_VERSION;
  id: string;
  status: AthenaPreviewStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  fieldId: string;
  sessionId: string;
  fieldFingerprint: string;
  pendingEventId: string | null;
  pendingRulesResultTitle: string | null;
  affectedGroupIds: string[];
  requiredChoices: AthenaChoiceRequirement[];
  unsupportedFindings: AthenaSupportFinding[];
  summary: string[];
  lifecycle: AthenaPreviewLifecycleRecord[];
  committedStateMutated: false;
  directBattlefieldMutation: false;
}

export interface AthenaChoiceRequirement {
  id: string;
  kind:
    | "object-choice"
    | "quantity-choice"
    | "player-choice"
    | "replacement-choice"
    | "trigger-order-choice"
    | "manual-resolution";
  prompt: string;
  sourceGroupId: string | null;
  candidateGroupIds: string[];
  requiredBeforeCommit: boolean;
}

export interface AthenaSupportFinding {
  id: string;
  status: AthenaSupportFindingStatus;
  groupId: string | null;
  objectIds: string[];
  label: string;
  supportStatus: SupportStatus | null;
  authorityRequired: boolean;
  manualResolutionRequired: boolean;
  message: string;
}

export type AthenaSourceUnavailableReason =
  | "not-tracked"
  | "depowered"
  | "generic-placeholder"
  | "quantity-only"
  | "unsupported-effect"
  | "zone-not-battlefield"
  | "missing-identity"
  | null;

export interface AthenaBattlefieldObject {
  groupId: string;
  sessionId: string;
  primaryObjectId: string;
  objectIds: string[];
  stackKey: string;
  label: string;
  quantity: number;
  zone: Zone;
  owner: Owner;
  controller: Owner;
  ownerParticipantId: string;
  controllerParticipantId: string;
  identityName: string | null;
  cardId: string | null;
  oracleId: string | null;
  oracleText: string | null;
  originalCardId: string | null;
  supportStatus: SupportStatus | null;
  isGeneric: boolean;
  isToken: boolean;
  isCommander: boolean;
  isCreature: boolean;
  isAttachment: boolean;
  trackingEnabled: boolean;
  abilitiesActive: boolean;
  depowerMode: PermanentGroup["depowerMode"];
  sourceUnavailableReason: AthenaSourceUnavailableReason;
  canBeEffectSource: boolean;
  canBeEffectRecipient: boolean;
  counters: Record<string, number>;
  statuses: PermanentGroup["statuses"];
  attachments: string[];
  attachedTo: string | null;
  basePower: number | null;
  baseToughness: number | null;
  currentPower: number | null;
  currentToughness: number | null;
  cardTypes: string[];
  supertypes: string[];
  subtypes: string[];
  lineage: {
    transformed: boolean;
    originalName: string | null;
    originalCardId: string | null;
    objectIds: string[];
  };
}

export interface AthenaAttachmentLink {
  attachmentGroupId: string;
  hostGroupId: string;
  attachmentObjectIds: string[];
  hostObjectIds: string[];
}

export interface AthenaCounterSummary {
  groupId: string;
  objectIds: string[];
  counters: Record<string, number>;
}

export interface AthenaZoneQuantitySnapshot {
  zone: Zone;
  quantity: number;
  groupCount: number;
}

export interface AthenaRelevantTotalSnapshot {
  key: RelevantTotalKey;
  value: number;
}

export type AthenaRelationshipKind =
  | "event-watcher"
  | "replacement-effect"
  | "static-total-reader"
  | "token-production"
  | "counter-placement"
  | "trigger-cascade"
  | "attachment-modifier"
  | "total-contributor"
  | "tracking-disabled"
  | "depowered-source"
  | "transformed-lineage"
  | "stack-lineage"
  | "authority-supersedes-preview";

export interface AthenaRelationship {
  id: string;
  kind: AthenaRelationshipKind;
  sourceGroupId: string | null;
  sourceObjectIds: string[];
  targetGroupIds: string[];
  targetObjectIds: string[];
  eventTypes: GameEventType[];
  relevantTotals: RelevantTotalKey[];
  support: AthenaSupportFindingStatus;
  authoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  sourceAvailable: boolean;
  unsupportedReason: string | null;
  description: string;
}

export interface AthenaPendingEventContext {
  id: string;
  type: GameEventType;
  sourceId: string | null;
  quantity: number;
  batchId: string;
  groupIds: string[];
}

export interface AthenaPendingRulesResultContext {
  title: string;
  source: AthenaAuthoritySource;
  validationStatus:
    | NonNullable<ResolutionResult["rendering"]>["validationStatus"]
    | null;
  eventIds: string[];
  changedGroupIds: string[];
  unsupportedInteractions: string[];
}

export interface AthenaActiveHelperDefinition {
  id: string;
  sourceGroupId: string;
  label: string;
  eventTypes: GameEventType[];
  produces:
    | "tokens"
    | "counters"
    | "life-change"
    | "replacement"
    | "static-total"
    | "custom"
    | "unknown";
  supportStatus: SupportStatus;
}

export interface AthenaAwarenessContext {
  version: typeof ATHENA_CONTEXT_VERSION;
  compatibilityVersion: typeof ATHENA_COMPATIBILITY_VERSION;
  createdAt: string;
  fieldId: string;
  sessionId: string;
  localParticipantId: string;
  currentRulesAuthority: SessionAuthority;
  currentSessionAuthority: SessionAuthority;
  currentAuthoritySource: AthenaAuthoritySource;
  authorityPrecedence: AthenaAuthorityPrecedence;
  boardStateAuthorityAvailable: boolean;
  mode: FieldState["mode"]["currentMode"];
  ambientMode: AmbientGameplayMode;
  currentPhase: AmbientObservedPhase | null;
  currentTurn: AmbientObservedController | null;
  currentPlayer: AmbientObservedController | null;
  currentListeningWindowId: string | null;
  currentListeningWindowKind: EchoListeningWindowKind | null;
  currentPlannerActionIds: string[];
  currentActionStripItemIds: string[];
  currentCombatSessionId: string | null;
  currentGameplaySessionId: string | null;
  battlefield: AthenaBattlefieldObject[];
  genericObjectGroupIds: string[];
  tokenStackGroupIds: string[];
  attachmentLinks: AthenaAttachmentLink[];
  counterSummaries: AthenaCounterSummary[];
  relevantTotals: AthenaRelevantTotalSnapshot[];
  zoneQuantities: AthenaZoneQuantitySnapshot[];
  trackingDisabledGroupIds: string[];
  depoweredGroupIds: string[];
  currentStaticModifiers: AthenaRelationship[];
  currentReplacementEffects: AthenaRelationship[];
  currentEventWatchers: AthenaRelationship[];
  activeHelperDefinitions: AthenaActiveHelperDefinition[];
  supportedCardStatus: Record<SupportStatus, number>;
  supportFindings: AthenaSupportFinding[];
  relationships: AthenaRelationship[];
  pendingEvent: AthenaPendingEventContext | null;
  pendingRulesResult: AthenaPendingRulesResultContext | null;
  recentCanonicalEventIds: string[];
  recentEchoIntentId: string | null;
  undoBoundaryId: string | null;
  committedStateReadOnly: true;
  previewStateIsolated: true;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
}

export interface AthenaDiagnostics {
  version: typeof ATHENA_FOUNDATION_VERSION;
  enabled: boolean;
  currentContextVersion: typeof ATHENA_CONTEXT_VERSION;
  currentAuthoritySource: AthenaAuthoritySource;
  currentAuthorityPrecedence: AthenaAuthorityPrecedence;
  dependencyCount: number;
  supportedRelationshipCount: number;
  unsupportedRelationshipCount: number;
  pendingPreviewStatus: AthenaPreviewStatus | null;
  lastAnalysisDurationMs: number;
  lastInvalidationReason: string | null;
  lastError: string | null;
  currentIntegrationSource:
    | "manual"
    | "project-echo"
    | "rules-result"
    | "boardstate-authority"
    | "lite-helper"
    | "unknown";
  developerDiagnosticsAvailable: boolean;
  localOnly: true;
  boardStateAuthorityConnected: false;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
  rulesAuthorityTransferred: false;
}

export interface AthenaState {
  version: typeof ATHENA_FOUNDATION_VERSION;
  activePreview: AthenaPreviewState | null;
  recentPreviewIds: string[];
  lastContext: {
    version: typeof ATHENA_CONTEXT_VERSION;
    fieldId: string;
    sessionId: string;
    fingerprint: string;
    createdAt: string;
    dependencyCount: number;
    unsupportedRelationshipCount: number;
    authoritySource: AthenaAuthoritySource;
  } | null;
  diagnostics: AthenaDiagnostics;
}

export interface AthenaSettings {
  version: typeof ATHENA_FOUNDATION_VERSION;
  enabled: boolean;
  awarenessContextEnabled: boolean;
  previewMetadataPersistence: "none" | "metadata-only";
  maxRelationships: number;
  maxRecentHistory: number;
  developerDiagnosticsEnabled: boolean;
  accessibilityAnnouncementsPrepared: true;
  localizationReady: true;
  localOnly: true;
  boardStateAuthorityConnected: false;
  directBattlefieldMutation: false;
  duplicateBattlefieldState: false;
  duplicateEventHistory: false;
  duplicateUndoStack: false;
  rulesAuthorityTransferred: false;
  lastResetAt: string | null;
}

export interface AthenaAwarenessContextOptions {
  timestamp?: string;
  authoritySource?: AthenaAuthoritySource;
  pendingEvent?: GameEvent | null;
  pendingRulesResult?: ResolutionResult | null;
  recentCanonicalEventIds?: string[];
  recentEchoIntent?: AmbientIntent | null;
  undoBoundaryId?: string | null;
  maxRelationships?: number;
}

export interface AthenaPreviewInput {
  timestamp?: string;
  expiresAt?: string | null;
  summary?: string[];
  requiredChoices?: AthenaChoiceRequirement[];
  unsupportedFindings?: AthenaSupportFinding[];
  affectedGroupIds?: string[];
}
