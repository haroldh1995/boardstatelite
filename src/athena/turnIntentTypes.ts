import type { FieldState, GameEvent } from "../domain/types";
import type { AmbientIntentKind } from "../echo/ambientEventTypes";
import type { ActiveTurnActionStripItem } from "../echo/activeTurnActionStripTypes";
import type {
  PlannedAction,
  PreparedActionValidity,
} from "../echo/preTurnPlannerTypes";
import type { AthenaEventForecastResult } from "./eventForecastTypes";
import type { AthenaPendingTriggerQueue } from "./triggerQueue";
import type { AthenaConfirmedConsequencePipelineResult } from "./triggerResolutionTypes";

export const ATHENA_TURN_INTENT_VERSION = 1;

export type AthenaPreparedActionConfirmationChannel =
  | "tap"
  | "voice"
  | "card-interaction"
  | "sync-replay";

export type AthenaPreparedActionExecutionStatus =
  | "committed"
  | "duplicate"
  | "awaiting-input"
  | "authority-required"
  | "manual-action-required"
  | "unsupported"
  | "stale"
  | "invalid"
  | "failed-safe"
  | "combat-handoff"
  | "turn-transition";

export interface AthenaPreparedActionEligibility {
  version: typeof ATHENA_TURN_INTENT_VERSION;
  preparedActionId: string;
  plannedActionId: string | null;
  validity: PreparedActionValidity;
  executable: boolean;
  reasonCodes: string[];
  reason: string;
  action: PlannedAction | null;
  forecast: AthenaEventForecastResult | null;
}

export interface AthenaPreparedActionExecutionResult {
  version: typeof ATHENA_TURN_INTENT_VERSION;
  status: AthenaPreparedActionExecutionStatus;
  preparedActionId: string;
  plannedActionId: string | null;
  confirmationReceiptId: string;
  field: FieldState;
  canonicalEvents: GameEvent[];
  canonicalEventIds: string[];
  pipeline: AthenaConfirmedConsequencePipelineResult | null;
  semanticDescription: string;
  accessibilityDescription: string;
  reason: string;
  duplicatePrevented: boolean;
  directBattlefieldMutation: false;
  tutorialEvents: AthenaTurnIntentTutorialEvent[];
}

export type AthenaTurnIntentTutorialEvent =
  | "pre-turn-planner-opened"
  | "intent-added"
  | "prepared-action-created"
  | "prepared-action-confirmed"
  | "plan-changed"
  | "voice-action-confirmed"
  | "automatic-bookkeeping-completed"
  | "combat-started"
  | "turn-ended";

export interface AthenaPreparedActionExecutionInput {
  field: FieldState;
  item: ActiveTurnActionStripItem;
  queue: AthenaPendingTriggerQueue;
  channel: AthenaPreparedActionConfirmationChannel;
  timestamp?: string;
  speakerVerified?: boolean | null;
  recognizedText?: string | null;
}

export interface AthenaPreparedVoiceMatchInput {
  field: FieldState;
  intentKind: AmbientIntentKind;
  transcript: string;
  speakerVerified: boolean;
}

export interface AthenaPreparedVoiceMatchResult {
  itemId: string | null;
  preparedActionId: string | null;
  accepted: boolean;
  reason: string;
}

export interface AthenaTurnIntentDiagnostics {
  version: typeof ATHENA_TURN_INTENT_VERSION;
  turnIntentsCreated: number;
  preparedActionsCreated: number;
  preparedActionsConfirmed: number;
  preparedActionsCancelled: number;
  preparedActionsInvalidated: number;
  preparedActionsDiverged: number;
  voiceConfirmations: number;
  tapConfirmations: number;
  duplicateConfirmationPreventions: number;
  forecastReuseCount: number;
  forecastInvalidationCount: number;
  planRevalidationCount: number;
  midTurnUpdates: number;
  availableLandPlayUpdates: number;
  unexpectedActionsDuringPlan: number;
  staleActionRejections: number;
  authorityRejections: number;
  averageConfirmationToCommitMs: number;
  maximumProcessingDurationMs: number;
  lastPlanError: string | null;
  productionVisible: false;
}
