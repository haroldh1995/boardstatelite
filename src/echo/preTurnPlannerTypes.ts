import type { CardIdentity, GameEventType, Owner, Zone } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";

export const PRE_TURN_PLANNER_VERSION = 2;
export const PRE_TURN_PLANNER_ACTION_STRIP_VERSION = 2;

export type PreTurnPlannerActionType =
  | "land-play"
  | "spell-sequence"
  | "mana-use"
  | "planned-attack"
  | "blocker-reminder"
  | "token-creation"
  | "counter-placement"
  | "sacrifice"
  | "activated-ability"
  | "zone-movement"
  | "trigger-reminder"
  | "end-step-reminder"
  | "hold-up-interaction"
  | "priority-reminder"
  | "note";

export type PreTurnPlannerActionStatus =
  | "planned"
  | "completed"
  | "skipped"
  | "cancelled"
  | "invalidated"
  | "diverged";

export type TurnIntentConfidence =
  | "explicit"
  | "inferred-high-confidence"
  | "inferred-low-confidence";

export type TurnIntentSource =
  | "pre-turn-survey"
  | "manual-planner"
  | "echo-voice"
  | "card-selection"
  | "scryfall"
  | "known-card-state"
  | "boardstate-session"
  | "previous-intent";

export type PreparedActionValidity =
  | "prepared"
  | "ready"
  | "awaiting-confirmation"
  | "awaiting-target"
  | "awaiting-quantity"
  | "awaiting-mode"
  | "awaiting-selection"
  | "awaiting-order"
  | "authority-required"
  | "manual-action-required"
  | "unsupported"
  | "invalidated"
  | "diverged"
  | "stale";

export type PreparedActionRequirement =
  | "confirmation"
  | "target"
  | "quantity"
  | "mode"
  | "selection"
  | "order"
  | "authority"
  | "manual-resolution";

export interface PlannedTokenDefinition {
  name: string;
  power: number;
  toughness: number;
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  tapped: boolean;
  attacking: boolean;
}

export interface PlannedActionExecution {
  support: "local" | "manual" | "authority" | "unsupported";
  eventCategory: GameEventType | null;
  quantity: number;
  counterType: string | null;
  originZone: Zone | null;
  destinationZone: Zone | null;
  targetGroupIds: string[];
  mode: string | null;
  requirements: PreparedActionRequirement[];
  token: PlannedTokenDefinition | null;
}

export interface PreparedActionMetadata {
  preparedActionId: string;
  validity: PreparedActionValidity;
  confidence: TurnIntentConfidence;
  intentSource: TurnIntentSource;
  canonicalStateFingerprint: string | null;
  forecastReference: string | null;
  expectedReplacementReferences: string[];
  expectedTriggerSummary: string[];
  expectedBookkeeping: string[];
  reasonCodes: string[];
  authorityRequired: boolean;
  manualActionRequired: boolean;
  confirmedAt: string | null;
  confirmationReceiptId: string | null;
  canonicalEventIds: string[];
  sourceFaceCardId: string | null;
}

export type PreTurnPlannerAvailability =
  | "available"
  | "primary"
  | "read-only"
  | "minimized"
  | "unavailable"
  | "recovery";

export type PreTurnPlannerLifecycleStatus = "empty" | "planning" | "archived";

export interface PlannedManaUse {
  generic: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  notes: string;
}

export interface PlannedLandOptions {
  primary: string | null;
  alternatives: string[];
  condition: string;
  intentionallyHeld: boolean;
  futureFetchTarget: string | null;
}

export interface PlannedAction {
  id: string;
  type: PreTurnPlannerActionType;
  title: string;
  relatedCardId: string | null;
  relatedGroupId: string | null;
  relatedPlayer: Owner | null;
  order: number;
  dependencyIds: string[];
  notes: string;
  reminders: string[];
  status: PreTurnPlannerActionStatus;
  skipped: boolean;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
  quantity: number;
  cardSnapshot: CardIdentity | null;
  land: PlannedLandOptions | null;
  mana: PlannedManaUse | null;
  execution: PlannedActionExecution;
  prepared: PreparedActionMetadata;
  actionStrip: {
    intentKind: AmbientIntentKind;
    readyForActionStrip: boolean;
    requiresPreview: boolean;
  };
}

export interface PlannedActionInput {
  id?: string;
  type: PreTurnPlannerActionType;
  title?: string;
  relatedCardId?: string | null;
  relatedGroupId?: string | null;
  relatedPlayer?: Owner | null;
  order?: number;
  dependencyIds?: string[];
  notes?: string;
  reminders?: string[];
  status?: PreTurnPlannerActionStatus;
  quantity?: number;
  cardSnapshot?: CardIdentity | null;
  land?: Partial<PlannedLandOptions> | null;
  mana?: Partial<PlannedManaUse> | null;
  execution?: Partial<PlannedActionExecution> | null;
  confidence?: TurnIntentConfidence;
  intentSource?: TurnIntentSource;
}

export interface PlannedActionUpdate extends Partial<
  Omit<PlannedActionInput, "id">
> {
  completedAt?: string | null;
  skippedAt?: string | null;
  cancelledAt?: string | null;
}

export interface PreTurnPlannerActionStripItem {
  id: string;
  order: number;
  label: string;
  status: PreTurnPlannerActionStatus;
  sourceActionId: string;
  intent: AmbientIntentInput;
}

export interface PreTurnPlannerState {
  version: typeof PRE_TURN_PLANNER_VERSION;
  sessionId: string | null;
  participantId: string | null;
  status: PreTurnPlannerLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  turnId: string;
  intentVersion: number;
  canonicalSessionVersion: string | null;
  privateToParticipant: true;
  availableLandPlays: {
    planned: number;
    remaining: number;
    confirmed: number;
    updatedAt: string;
    source: TurnIntentSource;
  };
  actions: PlannedAction[];
  collapsedGroups: Record<PreTurnPlannerActionType | "completed", boolean>;
  lifecycle: {
    lastAmbientMode: AmbientGameplayMode;
    availability: PreTurnPlannerAvailability;
    readOnly: boolean;
    lastResetAt: string | null;
    lastArchivedAt: string | null;
    recoveryReason: string | null;
  };
  actionStrip: {
    version: typeof PRE_TURN_PLANNER_ACTION_STRIP_VERSION;
    preparedActionIds: string[];
    generatedAt: string | null;
  };
}

export interface PreTurnPlannerDiagnostics {
  version: typeof PRE_TURN_PLANNER_VERSION;
  sessionId: string | null;
  status: PreTurnPlannerLifecycleStatus;
  availability: PreTurnPlannerAvailability;
  actionCount: number;
  activeActionCount: number;
  completedActionCount: number;
  cancelledActionCount: number;
  readOnly: boolean;
  availableLandPlays: number;
  preparedActionCount: number;
  invalidatedActionCount: number;
  divergedActionCount: number;
}
