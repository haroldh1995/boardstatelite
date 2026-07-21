import { describe, expect, it, vi } from "vitest";
import { activateField } from "../domain/engine";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import {
  animPakal,
  catharsCrusade,
  fieldWith,
  tracked,
} from "../test/factories";
import {
  AmbientGameplayEngine,
  createDefaultAmbientGameplayState,
  normalizeAmbientGameplayState,
} from "./ambientEngine";
import { createLiteFieldSnapshot } from "../rulesAdapter";

describe("Ambient Gameplay engine", () => {
  it("initializes in passive mode with no active focused workflow", () => {
    const engine = new AmbientGameplayEngine();

    expect(engine.getMode()).toBe("passive");
    expect(engine.getContext()).toMatchObject({
      lastStableMode: "passive",
      focusedAction: "none",
      originMode: null,
      recoveryReason: null,
    });
    expect(engine.getDiagnostics()).toMatchObject({
      currentMode: "passive",
      invalidTransitionCount: 0,
    });
  });

  it("accepts the full expected Ambient Gameplay transition path", () => {
    const engine = new AmbientGameplayEngine();
    const sequence = [
      "preTurnPreparation",
      "activeTurn",
      "combat",
      "resolution",
      "activeTurn",
      "postTurn",
      "passive",
    ] as const;

    for (const targetMode of sequence) {
      const result = engine.requestTransition({
        targetMode,
        reason: "manual",
        timestamp: `2026-07-20T00:00:0${sequence.indexOf(targetMode)}.000Z`,
      });

      expect(result.ok).toBe(true);
      expect(result.state.currentMode).toBe(targetMode);
    }
  });

  it("supports skipping preparation and rejects unsafe direct focused transitions", () => {
    const onInvalidTransition = vi.fn();
    const engine = new AmbientGameplayEngine(undefined, {
      onInvalidTransition,
    });

    expect(
      engine.requestTransition({
        targetMode: "activeTurn",
        reason: "manual",
      }).ok,
    ).toBe(true);
    expect(
      engine.requestTransition({
        targetMode: "postTurn",
        reason: "manual",
      }).ok,
    ).toBe(true);
    expect(
      engine.requestTransition({
        targetMode: "combat",
        reason: "manual",
      }).ok,
    ).toBe(false);
    expect(engine.getMode()).toBe("postTurn");
    expect(engine.getDiagnostics().invalidTransitionCount).toBe(1);
    expect(onInvalidTransition).toHaveBeenCalledTimes(1);
  });

  it("fires entry and exit hooks without mutating unrelated state", () => {
    const entered: string[] = [];
    const exited: string[] = [];
    const engine = new AmbientGameplayEngine(undefined, {
      onEnter: (mode) => entered.push(mode),
      onExit: (mode) => exited.push(mode),
    });

    const result = engine.requestTransition({
      targetMode: "preTurnPreparation",
      reason: "manual",
    });

    expect(result.ok).toBe(true);
    expect(entered).toEqual(["preTurnPreparation"]);
    expect(exited).toEqual(["passive"]);
  });

  it("tracks origin and previous modes across focused workflows", () => {
    const engine = new AmbientGameplayEngine();

    engine.requestTransition({ targetMode: "activeTurn", reason: "manual" });
    engine.requestTransition({ targetMode: "combat", reason: "manual" });
    expect(engine.getState()).toMatchObject({
      currentMode: "combat",
      previousMode: "activeTurn",
      context: {
        originMode: "activeTurn",
        lastStableMode: "activeTurn",
        focusedAction: "combatDeclaration",
      },
    });

    engine.requestTransition({ targetMode: "resolution", reason: "manual" });
    expect(engine.getContext()).toMatchObject({
      originMode: "activeTurn",
      lastStableMode: "activeTurn",
    });

    engine.returnToPriorStable();
    expect(engine.getState()).toMatchObject({
      currentMode: "activeTurn",
      context: {
        originMode: null,
        focusedAction: "none",
        pendingEventIds: [],
      },
    });
  });

  it("recovers and cancels focused workflows deterministically", () => {
    const engine = new AmbientGameplayEngine();

    engine.requestTransition({ targetMode: "activeTurn", reason: "manual" });
    engine.requestTransition({ targetMode: "combat", reason: "manual" });
    engine.enterRecovery("Lost combat declaration context.");

    expect(engine.getState()).toMatchObject({
      currentMode: "recovery",
      context: {
        originMode: "combat",
        recoveryReason: "Lost combat declaration context.",
      },
    });

    engine.returnToPriorStable();
    expect(engine.getMode()).toBe("activeTurn");

    engine.requestTransition({ targetMode: "combat", reason: "manual" });
    engine.cancelFocusedWorkflow();
    expect(engine.getMode()).toBe("activeTurn");
  });

  it("resets for new and completed sessions without retaining focused context", () => {
    const engine = new AmbientGameplayEngine();

    engine.requestTransition({ targetMode: "activeTurn", reason: "manual" });
    engine.requestTransition({ targetMode: "combat", reason: "manual" });
    engine.resetForNewSession("session-2", "2026-07-20T01:00:00.000Z");

    expect(engine.getState()).toMatchObject({
      currentMode: "passive",
      transitionReason: "session-reset",
      context: { sessionId: "session-2", originMode: null },
    });

    engine.requestTransition({ targetMode: "activeTurn", reason: "manual" });
    engine.resetAfterSessionCompletion("2026-07-20T02:00:00.000Z");

    expect(engine.getState()).toMatchObject({
      currentMode: "passive",
      transitionReason: "session-reset",
      lastTransition: {
        from: "activeTurn",
        to: "passive",
        reason: "session-complete",
      },
    });
  });

  it("restores only safe stable persisted modes and falls back from stale focused modes", () => {
    const activeState = createDefaultAmbientGameplayState({
      timestamp: "2026-07-20T00:00:00.000Z",
      sessionId: "session-1",
    });
    const restored = normalizeAmbientGameplayState(
      {
        ...activeState,
        currentMode: "activeTurn",
        context: {
          ...activeState.context,
          lastStableMode: "activeTurn",
          temporary: { preserved: true, omitted: { bad: true }, nil: null },
        },
      },
      {
        fallbackTimestamp: "2026-07-20T03:00:00.000Z",
        sessionId: "session-1",
      },
    );

    expect(restored.currentMode).toBe("activeTurn");
    expect(restored.context.temporary).toEqual({ nil: null, preserved: true });

    const stale = normalizeAmbientGameplayState(
      {
        ...activeState,
        currentMode: "resolution",
        context: { ...activeState.context, originMode: "activeTurn" },
      },
      {
        fallbackTimestamp: "2026-07-20T03:00:00.000Z",
        sessionId: "session-1",
      },
    );

    expect(stale.currentMode).toBe("passive");
    expect(
      normalizeAmbientGameplayState(
        { currentMode: "unknown" },
        {
          fallbackTimestamp: "2026-07-20T03:00:00.000Z",
          sessionId: "session-1",
        },
      ).currentMode,
    ).toBe("passive");
  });

  it("responds conservatively to turn owner and phase events", () => {
    const engine = new AmbientGameplayEngine();

    engine.handleSessionEvent({
      type: "turn-owner-changed",
      activeController: "you",
    });
    expect(engine.getMode()).toBe("activeTurn");

    engine.handleSessionEvent({
      type: "phase-changed",
      activeController: "you",
      phase: "combat",
    });
    expect(engine.getMode()).toBe("combat");

    engine.handleSessionEvent({
      type: "phase-changed",
      activeController: "you",
      phase: "postcombatMain",
    });
    expect(engine.getMode()).toBe("activeTurn");

    engine.handleSessionEvent({
      type: "phase-changed",
      activeController: "you",
      phase: "ending",
    });
    expect(engine.getMode()).toBe("postTurn");

    engine.handleSessionEvent({
      type: "turn-owner-changed",
      activeController: "opponent",
    });
    expect(engine.getMode()).toBe("passive");
  });

  it("routes interrupted focused modes through recovery and foreground restoration", () => {
    const engine = new AmbientGameplayEngine();

    engine.requestTransition({ targetMode: "activeTurn", reason: "manual" });
    engine.requestTransition({ targetMode: "combat", reason: "manual" });
    engine.handleLifecycleEvent({ type: "app-backgrounded" });

    expect(engine.getMode()).toBe("recovery");
    expect(engine.getContext().recoveryReason).toContain("backgrounded");

    engine.handleLifecycleEvent({ type: "app-foregrounded" });
    expect(engine.getMode()).toBe("activeTurn");
  });

  it("cleans temporary context and listener subscriptions", () => {
    const engine = new AmbientGameplayEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    engine.updateContext({
      pendingEventIds: ["event-1"],
      temporary: { pending: true },
    });
    expect(engine.getContext().pendingEventIds).toEqual(["event-1"]);

    engine.requestTransition({
      targetMode: "activeTurn",
      reason: "manual",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getContext()).toMatchObject({
      pendingEventIds: [],
      temporary: {},
      lastStableMode: "activeTurn",
    });

    unsubscribe();
    engine.requestTransition({ targetMode: "postTurn", reason: "manual" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getDiagnostics().listenerCount).toBe(0);
  });

  it("persists through field normalization without changing Lite helper behavior", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(catharsCrusade())]),
    );
    const activeField = normalizeField({
      ...field,
      ambient: {
        ...field.ambient,
        currentMode: "activeTurn",
        context: { ...field.ambient.context, lastStableMode: "activeTurn" },
      },
    });

    expect(activeField.ambient.currentMode).toBe("activeTurn");

    const result = activateField(activeField);
    expect(result.title).toBe("Field Activated");
    expect(result.field.ambient.currentMode).toBe("activeTurn");
  });

  it("migrates legacy saves and canonical snapshots with Ambient Gameplay state", () => {
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.ambient;

    const imported = sanitizeImportedField(legacy);
    expect(imported?.ambient).toMatchObject({
      currentMode: "passive",
      context: { sessionId: imported?.session.id },
    });

    const snapshot = createLiteFieldSnapshot(imported!);
    expect(snapshot.ambient.currentMode).toBe("passive");
    expect(snapshot.ambient.context.sessionId).toBe(imported!.session.id);
  });
});
