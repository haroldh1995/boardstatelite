import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";

export const ACTIVE_TURN_ACTION_STRIP_VERSION = 1;

export type ActiveTurnActionKind =
  | "begin-turn"
  | "draw"
  | "play-planned-land"
  | "cast-planned-spell"
  | "activate-planned-ability"
  | "move-to-combat"
  | "declare-planned-attack"
  | "resolve-planned-trigger"
  | "hold-priority-reminder"
  | "end-combat"
  | "second-main-reminder"
  | "end-turn"
  | "pass-priority";

export type ActiveTurnActionStatus =
  | "pending"
  | "current"
  | "completed"
  | "skipped"
  | "cancelled"
  | "deferred"
  | "blocked";

export type ActiveTurnActionStripVisibility =
  | "hidden"
  | "preview"
  | "primary"
  | "combat"
  | "suspended"
  | "recovery"
  | "archived";

export type ActiveTurnActionSource =
  | "planner"
  | "turn-context"
  | "phase-context"
  | "reminder";

export interface ActiveTurnActionStripItem {
  id: string;
  key: string;
  kind: ActiveTurnActionKind;
  label: string;
  detail: string;
  source: ActiveTurnActionSource;
  sourceActionId: string | null;
  intentKind: AmbientIntentKind;
  intent: AmbientIntentInput;
  order: number;
  status: ActiveTurnActionStatus;
  requiredMode: AmbientGameplayMode | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
  deferredAt: string | null;
  blockedReason: string | null;
}

export interface ActiveTurnActionStripState {
  version: typeof ACTIVE_TURN_ACTION_STRIP_VERSION;
  sessionId: string | null;
  visibility: ActiveTurnActionStripVisibility;
  expanded: boolean;
  completedCollapsed: boolean;
  generatedAt: string | null;
  updatedAt: string;
  items: ActiveTurnActionStripItem[];
  clearedCompletedItemKeys: string[];
  lastPipelineEventId: string | null;
  lastFailureReason: string | null;
}

export interface ActiveTurnActionStripDiagnostics {
  version: typeof ACTIVE_TURN_ACTION_STRIP_VERSION;
  sessionId: string | null;
  visibility: ActiveTurnActionStripVisibility;
  itemCount: number;
  currentItemId: string | null;
  pendingCount: number;
  completedCount: number;
  blockedCount: number;
  lastPipelineEventId: string | null;
  lastFailureReason: string | null;
}
