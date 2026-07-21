export const AMBIENT_GAMEPLAY_STATE_VERSION = 1;

export const AMBIENT_GAMEPLAY_MODES = [
  "passive",
  "preTurnPreparation",
  "activeTurn",
  "combat",
  "resolution",
  "recovery",
  "postTurn",
] as const;

export type AmbientGameplayMode = (typeof AMBIENT_GAMEPLAY_MODES)[number];
export type AmbientStableMode = "passive" | "preTurnPreparation" | "activeTurn";
export type AmbientFocusedMode = "combat" | "resolution" | "postTurn";

export type AmbientTransitionReason =
  | "manual"
  | "turn-owner-changed"
  | "phase-changed"
  | "focused-action"
  | "combat-started"
  | "combat-cancelled"
  | "combat-finalized"
  | "resolution-complete"
  | "workflow-cancelled"
  | "workflow-failed"
  | "recovery"
  | "session-reset"
  | "session-complete"
  | "navigation-interrupted"
  | "app-backgrounded"
  | "app-foregrounded"
  | "persistence-restore";

export type AmbientObservedController = "you" | "opponent" | "unknown";

export type AmbientObservedPhase =
  | "unknown"
  | "beginning"
  | "precombatMain"
  | "combat"
  | "postcombatMain"
  | "ending";

export type AmbientFocusedAction =
  | "none"
  | "fieldActivation"
  | "combatDeclaration"
  | "manualCorrection"
  | "rulesResolution";

export interface AmbientObservedTurn {
  activeController: AmbientObservedController;
  phase: AmbientObservedPhase;
  updatedAt: string;
}

export interface AmbientModeContext {
  originMode: AmbientGameplayMode | null;
  lastStableMode: AmbientStableMode;
  focusedAction: AmbientFocusedAction;
  pendingEventIds: string[];
  recoveryReason: string | null;
  observedTurn: AmbientObservedTurn | null;
  temporary: Record<string, string | number | boolean | null>;
  sessionId: string | null;
}

export interface AmbientTransitionRecord {
  id: string;
  from: AmbientGameplayMode;
  to: AmbientGameplayMode;
  reason: AmbientTransitionReason;
  requestedAt: string;
  accepted: boolean;
  message: string;
}

export interface AmbientGameplayState {
  version: typeof AMBIENT_GAMEPLAY_STATE_VERSION;
  currentMode: AmbientGameplayMode;
  previousMode: AmbientGameplayMode | null;
  requestedMode: AmbientGameplayMode | null;
  transitionReason: AmbientTransitionReason;
  transitionTimestamp: string;
  context: AmbientModeContext;
  lastTransition: AmbientTransitionRecord | null;
  invalidTransitionCount: number;
}

export interface AmbientTransitionRequest {
  targetMode: AmbientGameplayMode;
  reason: AmbientTransitionReason;
  timestamp?: string;
  context?: Partial<AmbientModeContext>;
}

export interface AmbientTransitionResult {
  ok: boolean;
  state: AmbientGameplayState;
  transition: AmbientTransitionRecord;
}

export interface AmbientModeHooks {
  onEnter?: (
    mode: AmbientGameplayMode,
    transition: AmbientTransitionRecord,
    state: AmbientGameplayState,
  ) => void;
  onExit?: (
    mode: AmbientGameplayMode,
    transition: AmbientTransitionRecord,
    state: AmbientGameplayState,
  ) => void;
  onInvalidTransition?: (
    transition: AmbientTransitionRecord,
    state: AmbientGameplayState,
  ) => void;
}

export type AmbientModeListener = (
  state: AmbientGameplayState,
  transition: AmbientTransitionRecord,
) => void;

export type AmbientSessionEvent =
  | {
      type: "turn-owner-changed";
      activeController: AmbientObservedController;
      timestamp?: string;
    }
  | {
      type: "phase-changed";
      phase: AmbientObservedPhase;
      activeController?: AmbientObservedController;
      timestamp?: string;
    };

export type AmbientLifecycleEvent =
  | { type: "navigation-interrupted"; timestamp?: string }
  | { type: "app-backgrounded"; timestamp?: string }
  | { type: "app-foregrounded"; timestamp?: string };

export interface AmbientGameplayDiagnostics {
  currentMode: AmbientGameplayMode;
  previousMode: AmbientGameplayMode | null;
  lastStableMode: AmbientStableMode;
  originMode: AmbientGameplayMode | null;
  requestedMode: AmbientGameplayMode | null;
  transitionReason: AmbientTransitionReason;
  invalidTransitionCount: number;
  lastTransition: AmbientTransitionRecord | null;
  listenerCount: number;
  sessionId: string | null;
}
