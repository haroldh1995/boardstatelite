import type { Owner } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";

export const PRE_TURN_PLANNER_VERSION = 1;
export const PRE_TURN_PLANNER_ACTION_STRIP_VERSION = 1;

export type PreTurnPlannerActionType =
  | "land-play"
  | "spell-sequence"
  | "mana-use"
  | "planned-attack"
  | "blocker-reminder"
  | "token-creation"
  | "counter-placement"
  | "trigger-reminder"
  | "end-step-reminder"
  | "hold-up-interaction"
  | "priority-reminder"
  | "note";

export type PreTurnPlannerActionStatus =
  | "planned"
  | "completed"
  | "skipped"
  | "cancelled";

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
  land: PlannedLandOptions | null;
  mana: PlannedManaUse | null;
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
  land?: Partial<PlannedLandOptions> | null;
  mana?: Partial<PlannedManaUse> | null;
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
  status: PreTurnPlannerLifecycleStatus;
  createdAt: string;
  updatedAt: string;
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
}
