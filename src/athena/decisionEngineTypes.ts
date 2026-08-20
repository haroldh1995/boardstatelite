import type { Zone } from "../domain/types";
import type { AthenaPendingTriggerQueueSnapshot } from "./triggerQueueTypes";
import type { AthenaTriggerResolutionDecision } from "./triggerResolutionTypes";
import type { AthenaForecastInput } from "./eventForecastTypes";
import type { AthenaAuthoritySource } from "./types";

export const ATHENA_DECISION_ENGINE_VERSION = 1;
export const ATHENA_DECISION_QUEUE_SCHEMA_VERSION = 1;

export type AthenaDecisionType =
  | "target-selection"
  | "multi-target-selection"
  | "mode-selection"
  | "multi-mode-selection"
  | "optional-effect"
  | "quantity"
  | "x-value"
  | "distribution"
  | "color-selection"
  | "card-type-selection"
  | "creature-type-selection"
  | "counter-type-selection"
  | "object-selection"
  | "card-selection"
  | "zone-card-selection"
  | "trigger-order"
  | "replacement-order"
  | "optional-replacement"
  | "yes-no"
  | "manual-confirmation"
  | "manual-result"
  | "unsupported-rules-choice";

export type AthenaDecisionStatus =
  | "pending"
  | "active"
  | "minimized"
  | "answered"
  | "declined"
  | "cancelled"
  | "stale"
  | "invalidated"
  | "authority-required"
  | "manual-required";

export type AthenaDecisionCandidateKind =
  | "battlefield-object"
  | "zone-card"
  | "opponent-placeholder"
  | "untracked-card"
  | "mode"
  | "color"
  | "card-type"
  | "creature-type"
  | "counter-type"
  | "trigger"
  | "replacement"
  | "generic-option";

export interface AthenaDecisionCandidate {
  id: string;
  label: string;
  semanticLabel: string;
  kind: AthenaDecisionCandidateKind;
  groupId: string | null;
  cardId: string | null;
  zone: Zone | null;
  eligible: boolean;
  known: boolean;
  reason: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AthenaTargetConstraints {
  controller: "you" | "opponent" | "any";
  zones: Zone[];
  cardTypes: string[];
  excludedCardTypes: string[];
  subtypes: string[];
  colors: string[];
  tokenStatus: "any" | "token" | "nontoken";
  distinct: boolean;
  sourceExcluded: boolean;
  authorityExhaustive: boolean;
  allowOpponentPlaceholder: boolean;
  allowUntrackedZoneCard: boolean;
}

export interface AthenaDecisionConstraints {
  minimumSelections: number;
  maximumSelections: number;
  exactSelections: number | null;
  quantityMinimum: number | null;
  quantityMaximum: number | null;
  quantityTotal: number | null;
  allowRepeatedOptions: boolean;
  required: boolean;
  dismissible: boolean;
  target: AthenaTargetConstraints | null;
}

export interface AthenaDecisionAnswer {
  decisionId: string;
  responseId: string;
  selectedOptionIds: string[];
  targetGroupIds: string[];
  selectedGroupIds: string[];
  quantity: number | null;
  mode: string | null;
  modes: string[];
  accepted: boolean | null;
  distribution: Record<string, number>;
  color: string | null;
  cardType: string | null;
  creatureType: string | null;
  counterType: string | null;
  orderIds: string[];
  manualResult: AthenaManualDecisionResult | null;
  channel: "touch" | "voice" | "prepared" | "boardstate" | "restore";
  answeredAt: string;
}

export interface AthenaManualDecisionResult {
  eventCategory: string;
  quantity: number;
  targetGroupIds: string[];
  counterType: string | null;
  tokenName: string | null;
  tokenPower: number | null;
  tokenToughness: number | null;
  tokenCardTypes: string[];
  tokenSubtypes: string[];
  tokenColors: string[];
  tokenTapped: boolean;
  tokenAttacking: boolean;
  originZone: Zone | null;
  destinationZone: Zone | null;
}

export interface AthenaDecisionValidationResult {
  valid: boolean;
  stale: boolean;
  reason: string;
  reasonCodes: string[];
  normalizedAnswer: AthenaDecisionAnswer | null;
}

export type AthenaDecisionContinuation =
  | {
      kind: "trigger-resolution";
      step: number;
      triggerId: string;
      queue: AthenaPendingTriggerQueueSnapshot;
      collectedDecision: AthenaTriggerResolutionDecision;
    }
  | {
      kind: "prepared-action";
      step: number;
      preparedActionId: string;
      collectedDecision: AthenaTriggerResolutionDecision;
    }
  | {
      kind: "replacement-processing";
      step: number;
      eventId: string;
      replacementResultId: string;
      relationshipIds: string[];
      event: AthenaForecastInput;
      queue: AthenaPendingTriggerQueueSnapshot;
      optionalDecisions: Record<string, boolean>;
      selectedOrder: string[];
    }
  | {
      kind: "manual-result";
      step: number;
      sourceEventId: string;
    }
  | {
      kind: "none";
      step: number;
    };

export interface AthenaDecisionRequest {
  version: typeof ATHENA_DECISION_ENGINE_VERSION;
  id: string;
  sessionId: string;
  participantId: string;
  sourceEventId: string | null;
  sourceObjectId: string | null;
  triggerId: string | null;
  preparedActionId: string | null;
  type: AthenaDecisionType;
  prompt: string;
  semanticPrompt: string;
  candidates: AthenaDecisionCandidate[];
  constraints: AthenaDecisionConstraints;
  defaultValue: string | number | boolean | null;
  authoritySource: AthenaAuthoritySource;
  authorityRequired: boolean;
  forecastReference: string | null;
  stateFingerprint: string;
  stateVersion: string;
  continuation: AthenaDecisionContinuation;
  status: AthenaDecisionStatus;
  answer: AthenaDecisionAnswer | null;
  validation: AthenaDecisionValidationResult | null;
  reasonCodes: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  prepared: boolean;
  required: boolean;
  semanticProgress: string;
  directBattlefieldMutation: false;
}

export interface AthenaDecisionPreference {
  key: string;
  decisionType: AthenaDecisionType;
  sourceDefinitionId: string | null;
  answer: "accept" | "decline";
  scope: "turn" | "session";
  turnId: string | null;
  createdAt: string;
}

export interface AthenaDecisionDiagnostics {
  version: typeof ATHENA_DECISION_ENGINE_VERSION;
  requestsCreated: number;
  decisionsAnswered: number;
  decisionsCancelled: number;
  decisionsInvalidated: number;
  preparedChoicesReused: number;
  preparedChoicesRerequested: number;
  targetDecisions: number;
  modeDecisions: number;
  optionalDecisions: number;
  xDecisions: number;
  quantityDecisions: number;
  distributionDecisions: number;
  triggerOrderDecisions: number;
  replacementOrderDecisions: number;
  manualResultFallbacks: number;
  boardStateEscalations: number;
  voiceResponses: number;
  touchResponses: number;
  duplicateResponsePreventions: number;
  staleResponseRejections: number;
  averageDecisionOpenDurationMs: number;
  averageResponseToResolutionDurationMs: number;
  candidateGenerationDurationMs: number;
  lastDecisionError: string | null;
  productionVisible: false;
}

export interface AthenaDecisionQueueState {
  schemaVersion: typeof ATHENA_DECISION_QUEUE_SCHEMA_VERSION;
  version: typeof ATHENA_DECISION_ENGINE_VERSION;
  sessionId: string | null;
  participantId: string | null;
  activeDecisionId: string | null;
  requests: AthenaDecisionRequest[];
  committedResponseIds: string[];
  preferences: AthenaDecisionPreference[];
  diagnostics: AthenaDecisionDiagnostics;
  updatedAt: string;
}

export interface AthenaDecisionResponseResult {
  accepted: boolean;
  duplicatePrevented: boolean;
  request: AthenaDecisionRequest;
  queue: AthenaDecisionQueueState;
  validation: AthenaDecisionValidationResult;
  continuation: AthenaDecisionContinuation;
  semanticDescription: string;
}

export interface AthenaDecisionVoiceInput {
  decisionId: string;
  transcript: string;
  speakerVerified: boolean;
  responseId?: string;
  timestamp?: string;
}
