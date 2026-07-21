import { makeId } from "../domain/cards";
import {
  AMBIENT_GAMEPLAY_MODES,
  AMBIENT_GAMEPLAY_STATE_VERSION,
  type AmbientGameplayDiagnostics,
  type AmbientGameplayMode,
  type AmbientGameplayState,
  type AmbientLifecycleEvent,
  type AmbientModeContext,
  type AmbientModeHooks,
  type AmbientModeListener,
  type AmbientObservedController,
  type AmbientObservedPhase,
  type AmbientSessionEvent,
  type AmbientStableMode,
  type AmbientTransitionReason,
  type AmbientTransitionRecord,
  type AmbientTransitionRequest,
  type AmbientTransitionResult,
} from "./ambientTypes";

const STABLE_MODES = new Set<AmbientGameplayMode>([
  "passive",
  "preTurnPreparation",
  "activeTurn",
]);

const RESTORABLE_MODES = new Set<AmbientGameplayMode>([
  "passive",
  "preTurnPreparation",
  "activeTurn",
]);

const VALID_TRANSITIONS: Record<AmbientGameplayMode, AmbientGameplayMode[]> = {
  passive: ["preTurnPreparation", "activeTurn", "recovery"],
  preTurnPreparation: ["passive", "activeTurn", "recovery"],
  activeTurn: ["combat", "resolution", "postTurn", "passive", "recovery"],
  combat: ["activeTurn", "resolution", "recovery"],
  resolution: [
    "passive",
    "preTurnPreparation",
    "activeTurn",
    "combat",
    "recovery",
  ],
  recovery: ["passive", "preTurnPreparation", "activeTurn"],
  postTurn: ["passive", "preTurnPreparation", "recovery"],
};

export function createDefaultAmbientGameplayState(
  options: { timestamp?: string; sessionId?: string | null } = {},
): AmbientGameplayState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    version: AMBIENT_GAMEPLAY_STATE_VERSION,
    currentMode: "passive",
    previousMode: null,
    requestedMode: null,
    transitionReason: "session-reset",
    transitionTimestamp: timestamp,
    context: createDefaultAmbientContext(timestamp, options.sessionId ?? null),
    lastTransition: null,
    invalidTransitionCount: 0,
  };
}

export function normalizeAmbientGameplayState(
  value: unknown,
  options: { fallbackTimestamp: string; sessionId?: string | null },
): AmbientGameplayState {
  const defaults = createDefaultAmbientGameplayState({
    timestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? null,
  });
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<AmbientGameplayState>;
  const currentMode = normalizeMode(candidate.currentMode);
  const safeMode =
    currentMode && RESTORABLE_MODES.has(currentMode)
      ? currentMode
      : defaults.currentMode;
  const context = normalizeContext(candidate.context, {
    fallbackTimestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? null,
    safeMode,
  });

  return {
    ...defaults,
    version: AMBIENT_GAMEPLAY_STATE_VERSION,
    currentMode: safeMode,
    previousMode: normalizeMode(candidate.previousMode),
    requestedMode: null,
    transitionReason: normalizeReason(candidate.transitionReason),
    transitionTimestamp:
      typeof candidate.transitionTimestamp === "string"
        ? candidate.transitionTimestamp
        : options.fallbackTimestamp,
    context,
    lastTransition: normalizeTransition(candidate.lastTransition),
    invalidTransitionCount: Number.isFinite(candidate.invalidTransitionCount)
      ? Math.max(0, Math.trunc(candidate.invalidTransitionCount ?? 0))
      : 0,
  };
}

export class AmbientGameplayEngine {
  private state: AmbientGameplayState;
  private readonly hooks: AmbientModeHooks;
  private readonly listeners = new Set<AmbientModeListener>();

  constructor(
    initialState: AmbientGameplayState = createDefaultAmbientGameplayState(),
    hooks: AmbientModeHooks = {},
  ) {
    this.state = normalizeAmbientGameplayState(initialState, {
      fallbackTimestamp: initialState.transitionTimestamp,
      sessionId: initialState.context.sessionId,
    });
    this.hooks = hooks;
  }

  getState(): AmbientGameplayState {
    return structuredClone(this.state);
  }

  getMode(): AmbientGameplayMode {
    return this.state.currentMode;
  }

  getContext(): AmbientModeContext {
    return structuredClone(this.state.context);
  }

  getValidTransitions(
    from: AmbientGameplayMode = this.state.currentMode,
  ): AmbientGameplayMode[] {
    return [...VALID_TRANSITIONS[from]];
  }

  validateTransition(
    targetMode: AmbientGameplayMode,
    from: AmbientGameplayMode = this.state.currentMode,
  ): boolean {
    return VALID_TRANSITIONS[from].includes(targetMode);
  }

  requestTransition(
    request: AmbientTransitionRequest,
  ): AmbientTransitionResult {
    const timestamp = request.timestamp ?? new Date().toISOString();
    const targetMode = normalizeMode(request.targetMode);
    if (!targetMode) {
      return this.rejectTransition(
        this.state.currentMode,
        "recovery",
        request.reason,
        timestamp,
        "Unknown Ambient Gameplay mode.",
      );
    }

    if (targetMode === this.state.currentMode) {
      const transition = createTransition({
        from: this.state.currentMode,
        to: targetMode,
        reason: request.reason,
        timestamp,
        accepted: true,
        message: "Ambient Gameplay mode is already active.",
      });
      this.state = {
        ...this.state,
        requestedMode: targetMode,
        transitionReason: request.reason,
        transitionTimestamp: timestamp,
        context: mergeContext(this.state.context, request.context),
        lastTransition: transition,
      };
      this.notify(transition);
      return { ok: true, state: this.getState(), transition };
    }

    if (!this.validateTransition(targetMode)) {
      return this.rejectTransition(
        this.state.currentMode,
        targetMode,
        request.reason,
        timestamp,
        `Invalid Ambient Gameplay transition from ${this.state.currentMode} to ${targetMode}.`,
      );
    }

    return this.acceptTransition(targetMode, request.reason, timestamp, {
      patch: request.context,
    });
  }

  enterRecovery(
    recoveryReason: string,
    timestamp = new Date().toISOString(),
  ): AmbientTransitionResult {
    return this.requestTransition({
      targetMode: "recovery",
      reason: "workflow-failed",
      timestamp,
      context: {
        originMode: this.state.currentMode,
        recoveryReason,
      },
    });
  }

  cancelFocusedWorkflow(
    reason = "Focused Ambient Gameplay workflow cancelled.",
    timestamp = new Date().toISOString(),
  ): AmbientTransitionResult {
    if (this.state.currentMode === "combat") {
      return this.requestTransition({
        targetMode: "activeTurn",
        reason: "combat-cancelled",
        timestamp,
        context: clearFocusedContext(this.state.context),
      });
    }
    if (this.state.currentMode === "resolution") {
      return this.returnToPriorStable("workflow-cancelled", timestamp);
    }
    if (this.state.currentMode === "recovery") {
      return this.returnToPriorStable("recovery", timestamp);
    }
    if (this.state.currentMode === "postTurn") {
      return this.requestTransition({
        targetMode: "passive",
        reason: "workflow-cancelled",
        timestamp,
        context: clearFocusedContext(this.state.context),
      });
    }
    return this.enterRecovery(reason, timestamp);
  }

  returnToPriorStable(
    reason: AmbientTransitionReason = "recovery",
    timestamp = new Date().toISOString(),
  ): AmbientTransitionResult {
    const target = stableFallback(this.state.context);
    return this.requestTransition({
      targetMode: target,
      reason,
      timestamp,
      context: clearFocusedContext(this.state.context),
    });
  }

  resetForNewSession(
    sessionId: string | null,
    timestamp = new Date().toISOString(),
  ): AmbientGameplayState {
    this.state = createDefaultAmbientGameplayState({ timestamp, sessionId });
    const transition = createTransition({
      from: "passive",
      to: "passive",
      reason: "session-reset",
      timestamp,
      accepted: true,
      message: "Ambient Gameplay reset for a new session.",
    });
    this.state = { ...this.state, lastTransition: transition };
    this.notify(transition);
    return this.getState();
  }

  resetAfterSessionCompletion(
    timestamp = new Date().toISOString(),
  ): AmbientGameplayState {
    const from = this.state.currentMode;
    const sessionId = this.state.context.sessionId;
    this.state = createDefaultAmbientGameplayState({ timestamp, sessionId });
    const transition = createTransition({
      from,
      to: "passive",
      reason: "session-complete",
      timestamp,
      accepted: true,
      message: "Ambient Gameplay reset after session completion.",
    });
    this.state = { ...this.state, lastTransition: transition };
    this.notify(transition);
    return this.getState();
  }

  restore(
    value: unknown,
    options: { fallbackTimestamp: string; sessionId?: string | null },
  ): AmbientGameplayState {
    this.state = normalizeAmbientGameplayState(value, options);
    return this.getState();
  }

  handleSessionEvent(
    event: AmbientSessionEvent,
  ): AmbientTransitionResult | null {
    const timestamp = event.timestamp ?? new Date().toISOString();
    if (event.type === "turn-owner-changed") {
      this.updateObservedTurn(event.activeController, "unknown", timestamp);
      if (event.activeController === "you") {
        return this.requestTransition({
          targetMode: "activeTurn",
          reason: "turn-owner-changed",
          timestamp,
        });
      }
      if (event.activeController === "opponent") {
        return this.requestTransition({
          targetMode: "passive",
          reason: "turn-owner-changed",
          timestamp,
        });
      }
      return null;
    }

    const activeController =
      event.activeController ??
      this.state.context.observedTurn?.activeController ??
      "unknown";
    this.updateObservedTurn(activeController, event.phase, timestamp);

    if (activeController !== "you") {
      if (this.state.currentMode !== "passive") {
        return this.requestTransition({
          targetMode: "passive",
          reason: "phase-changed",
          timestamp,
        });
      }
      return null;
    }

    if (event.phase === "combat" && this.state.currentMode !== "combat") {
      return this.requestTransition({
        targetMode: "combat",
        reason: "phase-changed",
        timestamp,
        context: {
          originMode: this.state.currentMode,
          focusedAction: "combatDeclaration",
        },
      });
    }
    if (event.phase !== "combat" && this.state.currentMode === "combat") {
      return this.requestTransition({
        targetMode: "activeTurn",
        reason: "phase-changed",
        timestamp,
        context: clearFocusedContext(this.state.context),
      });
    }
    if (event.phase === "ending" && this.state.currentMode === "activeTurn") {
      return this.requestTransition({
        targetMode: "postTurn",
        reason: "phase-changed",
        timestamp,
      });
    }
    return null;
  }

  handleLifecycleEvent(
    event: AmbientLifecycleEvent,
  ): AmbientTransitionResult | null {
    const timestamp = event.timestamp ?? new Date().toISOString();
    if (
      event.type === "navigation-interrupted" ||
      event.type === "app-backgrounded"
    ) {
      if (this.state.currentMode === "combat") {
        return this.requestTransition({
          targetMode: "recovery",
          reason:
            event.type === "app-backgrounded"
              ? "app-backgrounded"
              : "navigation-interrupted",
          timestamp,
          context: {
            originMode: this.state.currentMode,
            recoveryReason:
              event.type === "app-backgrounded"
                ? "Application backgrounded during a focused Ambient Gameplay workflow."
                : "Navigation interrupted a focused Ambient Gameplay workflow.",
          },
        });
      }
      if (this.state.currentMode === "resolution") {
        return this.requestTransition({
          targetMode: "recovery",
          reason:
            event.type === "app-backgrounded"
              ? "app-backgrounded"
              : "navigation-interrupted",
          timestamp,
          context: {
            originMode: this.state.currentMode,
            recoveryReason:
              event.type === "app-backgrounded"
                ? "Application backgrounded during resolution."
                : "Navigation interrupted resolution.",
          },
        });
      }
    }
    if (
      event.type === "app-foregrounded" &&
      this.state.currentMode === "recovery"
    ) {
      return this.returnToPriorStable("app-foregrounded", timestamp);
    }
    return null;
  }

  updateContext(patch: Partial<AmbientModeContext>): AmbientGameplayState {
    this.state = {
      ...this.state,
      context: mergeContext(this.state.context, patch),
    };
    return this.getState();
  }

  clearTemporaryContext(): AmbientGameplayState {
    this.state = {
      ...this.state,
      context: clearFocusedContext(this.state.context),
    };
    return this.getState();
  }

  subscribe(listener: AmbientModeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDiagnostics(): AmbientGameplayDiagnostics {
    return {
      currentMode: this.state.currentMode,
      previousMode: this.state.previousMode,
      lastStableMode: this.state.context.lastStableMode,
      originMode: this.state.context.originMode,
      requestedMode: this.state.requestedMode,
      transitionReason: this.state.transitionReason,
      invalidTransitionCount: this.state.invalidTransitionCount,
      lastTransition: this.state.lastTransition
        ? { ...this.state.lastTransition }
        : null,
      listenerCount: this.listeners.size,
      sessionId: this.state.context.sessionId,
    };
  }

  private acceptTransition(
    targetMode: AmbientGameplayMode,
    reason: AmbientTransitionReason,
    timestamp: string,
    options: { patch?: Partial<AmbientModeContext> } = {},
  ): AmbientTransitionResult {
    const from = this.state.currentMode;
    const transition = createTransition({
      from,
      to: targetMode,
      reason,
      timestamp,
      accepted: true,
      message: `Ambient Gameplay transitioned from ${from} to ${targetMode}.`,
    });
    const nextContext = contextForTransition(
      this.state.context,
      from,
      targetMode,
      options.patch,
    );
    const nextState: AmbientGameplayState = {
      ...this.state,
      currentMode: targetMode,
      previousMode: from,
      requestedMode: targetMode,
      transitionReason: reason,
      transitionTimestamp: timestamp,
      context: nextContext,
      lastTransition: transition,
    };
    this.hooks.onExit?.(from, transition, structuredClone(nextState));
    this.state = nextState;
    this.hooks.onEnter?.(targetMode, transition, this.getState());
    this.notify(transition);
    return { ok: true, state: this.getState(), transition };
  }

  private rejectTransition(
    from: AmbientGameplayMode,
    to: AmbientGameplayMode,
    reason: AmbientTransitionReason,
    timestamp: string,
    message: string,
  ): AmbientTransitionResult {
    const transition = createTransition({
      from,
      to,
      reason,
      timestamp,
      accepted: false,
      message,
    });
    this.state = {
      ...this.state,
      requestedMode: to,
      transitionReason: reason,
      transitionTimestamp: timestamp,
      lastTransition: transition,
      invalidTransitionCount: this.state.invalidTransitionCount + 1,
    };
    this.hooks.onInvalidTransition?.(transition, this.getState());
    this.notify(transition);
    return { ok: false, state: this.getState(), transition };
  }

  private notify(transition: AmbientTransitionRecord): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot, transition);
    }
  }

  private updateObservedTurn(
    activeController: AmbientObservedController,
    phase: AmbientObservedPhase,
    timestamp: string,
  ): void {
    this.state = {
      ...this.state,
      context: {
        ...this.state.context,
        observedTurn: {
          activeController,
          phase,
          updatedAt: timestamp,
        },
      },
    };
  }
}

export const ambientGameplayEngine = new AmbientGameplayEngine();

function createDefaultAmbientContext(
  timestamp: string,
  sessionId: string | null,
): AmbientModeContext {
  void timestamp;
  return {
    originMode: null,
    lastStableMode: "passive",
    focusedAction: "none",
    pendingEventIds: [],
    recoveryReason: null,
    observedTurn: null,
    temporary: {},
    sessionId,
  };
}

function contextForTransition(
  context: AmbientModeContext,
  from: AmbientGameplayMode,
  to: AmbientGameplayMode,
  patch?: Partial<AmbientModeContext>,
): AmbientModeContext {
  const merged = mergeContext(context, patch);
  const lastStableMode = STABLE_MODES.has(to)
    ? (to as AmbientStableMode)
    : STABLE_MODES.has(from)
      ? (from as AmbientStableMode)
      : merged.lastStableMode;

  if (to === "recovery") {
    return {
      ...merged,
      originMode: merged.originMode ?? from,
      lastStableMode,
      focusedAction: "none",
      pendingEventIds: [],
      temporary: {},
    };
  }

  if (STABLE_MODES.has(to)) {
    return {
      ...clearFocusedContext(merged),
      lastStableMode: to as AmbientStableMode,
    };
  }

  if (to === "combat") {
    return {
      ...merged,
      originMode: merged.originMode ?? from,
      lastStableMode,
      focusedAction:
        merged.focusedAction === "none"
          ? "combatDeclaration"
          : merged.focusedAction,
    };
  }

  if (to === "resolution") {
    return {
      ...merged,
      originMode: merged.originMode ?? from,
      lastStableMode,
      focusedAction:
        merged.focusedAction === "none"
          ? "rulesResolution"
          : merged.focusedAction,
    };
  }

  return {
    ...merged,
    lastStableMode,
  };
}

function clearFocusedContext(context: AmbientModeContext): AmbientModeContext {
  return {
    ...context,
    originMode: null,
    focusedAction: "none",
    pendingEventIds: [],
    recoveryReason: null,
    temporary: {},
  };
}

function stableFallback(context: AmbientModeContext): AmbientStableMode {
  const origin = context.originMode;
  if (origin && STABLE_MODES.has(origin)) return origin as AmbientStableMode;
  return context.lastStableMode;
}

function mergeContext(
  context: AmbientModeContext,
  patch: Partial<AmbientModeContext> | undefined,
): AmbientModeContext {
  if (!patch) return structuredClone(context);
  return {
    ...context,
    ...patch,
    pendingEventIds: patch.pendingEventIds
      ? [...patch.pendingEventIds]
      : [...context.pendingEventIds],
    temporary: patch.temporary
      ? { ...patch.temporary }
      : { ...context.temporary },
    observedTurn:
      patch.observedTurn === undefined
        ? context.observedTurn
          ? { ...context.observedTurn }
          : null
        : patch.observedTurn
          ? { ...patch.observedTurn }
          : null,
  };
}

function createTransition(input: {
  from: AmbientGameplayMode;
  to: AmbientGameplayMode;
  reason: AmbientTransitionReason;
  timestamp: string;
  accepted: boolean;
  message: string;
}): AmbientTransitionRecord {
  return {
    id: makeId("ambient-transition"),
    from: input.from,
    to: input.to,
    reason: input.reason,
    requestedAt: input.timestamp,
    accepted: input.accepted,
    message: input.message,
  };
}

function normalizeContext(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    sessionId: string | null;
    safeMode: AmbientGameplayMode;
  },
): AmbientModeContext {
  const defaults = createDefaultAmbientContext(
    options.fallbackTimestamp,
    options.sessionId,
  );
  if (!value || typeof value !== "object") {
    return {
      ...defaults,
      lastStableMode: stableModeOrPassive(options.safeMode),
    };
  }
  const candidate = value as Partial<AmbientModeContext>;
  const lastStableMode = normalizeStableMode(candidate.lastStableMode);
  return {
    originMode: normalizeMode(candidate.originMode),
    lastStableMode: lastStableMode ?? stableModeOrPassive(options.safeMode),
    focusedAction: normalizeFocusedAction(candidate.focusedAction),
    pendingEventIds: Array.isArray(candidate.pendingEventIds)
      ? candidate.pendingEventIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    recoveryReason:
      typeof candidate.recoveryReason === "string"
        ? candidate.recoveryReason.slice(0, 240)
        : null,
    observedTurn: normalizeObservedTurn(
      candidate.observedTurn,
      options.fallbackTimestamp,
    ),
    temporary: normalizeTemporary(candidate.temporary),
    sessionId:
      typeof candidate.sessionId === "string"
        ? candidate.sessionId
        : options.sessionId,
  };
}

function normalizeTransition(value: unknown): AmbientTransitionRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AmbientTransitionRecord>;
  const from = normalizeMode(candidate.from);
  const to = normalizeMode(candidate.to);
  const reason = normalizeReason(candidate.reason);
  if (!from || !to || typeof candidate.requestedAt !== "string") return null;
  return {
    id: typeof candidate.id === "string" ? candidate.id : makeId("ambient"),
    from,
    to,
    reason,
    requestedAt: candidate.requestedAt,
    accepted: Boolean(candidate.accepted),
    message:
      typeof candidate.message === "string"
        ? candidate.message.slice(0, 240)
        : "",
  };
}

function normalizeObservedTurn(value: unknown, fallbackTimestamp: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    activeController?: unknown;
    phase?: unknown;
    updatedAt?: unknown;
  };
  return {
    activeController: normalizeObservedController(candidate.activeController),
    phase: normalizeObservedPhase(candidate.phase),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : fallbackTimestamp,
  };
}

function normalizeTemporary(
  value: unknown,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([, entry]) =>
          entry === null ||
          ["string", "number", "boolean"].includes(typeof entry),
      )
      .map(([key, entry]) => [
        key.slice(0, 80),
        entry as string | number | boolean | null,
      ]),
  );
}

function normalizeMode(value: unknown): AmbientGameplayMode | null {
  return typeof value === "string" &&
    AMBIENT_GAMEPLAY_MODES.includes(value as AmbientGameplayMode)
    ? (value as AmbientGameplayMode)
    : null;
}

function normalizeStableMode(value: unknown): AmbientStableMode | null {
  const mode = normalizeMode(value);
  return mode && STABLE_MODES.has(mode) ? (mode as AmbientStableMode) : null;
}

function stableModeOrPassive(mode: AmbientGameplayMode): AmbientStableMode {
  return STABLE_MODES.has(mode) ? (mode as AmbientStableMode) : "passive";
}

function normalizeReason(value: unknown): AmbientTransitionReason {
  const reasons: AmbientTransitionReason[] = [
    "manual",
    "turn-owner-changed",
    "phase-changed",
    "focused-action",
    "combat-started",
    "combat-cancelled",
    "combat-finalized",
    "resolution-complete",
    "workflow-cancelled",
    "workflow-failed",
    "recovery",
    "session-reset",
    "session-complete",
    "navigation-interrupted",
    "app-backgrounded",
    "app-foregrounded",
    "persistence-restore",
  ];
  return typeof value === "string" &&
    reasons.includes(value as AmbientTransitionReason)
    ? (value as AmbientTransitionReason)
    : "persistence-restore";
}

function normalizeFocusedAction(
  value: unknown,
): AmbientModeContext["focusedAction"] {
  if (
    value === "fieldActivation" ||
    value === "combatDeclaration" ||
    value === "manualCorrection" ||
    value === "rulesResolution"
  ) {
    return value;
  }
  return "none";
}

function normalizeObservedController(
  value: unknown,
): AmbientObservedController {
  return value === "you" || value === "opponent" ? value : "unknown";
}

function normalizeObservedPhase(value: unknown): AmbientObservedPhase {
  if (
    value === "beginning" ||
    value === "precombatMain" ||
    value === "combat" ||
    value === "postcombatMain" ||
    value === "ending"
  ) {
    return value;
  }
  return "unknown";
}
