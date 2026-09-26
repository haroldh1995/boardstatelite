import { describe, expect, it } from "vitest";
import {
  advanceTurnPhase,
  createDefaultTurnContext,
  endTurn,
  enqueueTriggerMemory,
  resolveTriggerMemory,
  setTurnPhase,
  startTurn,
  summarizeTurnMemory,
} from "./turnContext";

describe("Turn Context", () => {
  it("uses explicit Start Turn as the reset boundary", () => {
    let state = startTurn(createDefaultTurnContext());
    state = enqueueTriggerMemory(state, {
      sourceId: "card",
      sourceLabel: "Card",
      label: "First trigger",
      optional: false,
      oncePerTurnKey: "card:first",
      public: true,
    });
    state = endTurn(state);
    expect(state.status).toBe("between-turns");
    const next = startTurn(state);
    expect(next.status).toBe("active");
    expect(next.turnNumber).toBe(2);
    expect(next.oncePerTurnKeys).toEqual([]);
    expect(next.triggerMemory).toEqual([]);
  });

  it("does not duplicate once-per-turn opportunities", () => {
    const state = startTurn(createDefaultTurnContext());
    const once = enqueueTriggerMemory(state, {
      sourceId: "card",
      sourceLabel: "Card",
      label: "Once each turn",
      optional: true,
      oncePerTurnKey: "card:once",
      public: true,
    });
    const duplicate = enqueueTriggerMemory(once, {
      sourceId: "card",
      sourceLabel: "Card",
      label: "Once each turn",
      optional: true,
      oncePerTurnKey: "card:once",
      public: true,
    });
    expect(duplicate.triggerMemory).toHaveLength(1);
  });

  it("marks unresolved triggers as possible missed at the turn boundary", () => {
    let state = startTurn(createDefaultTurnContext());
    state = enqueueTriggerMemory(state, {
      sourceId: "source-1",
      sourceLabel: "Source",
      label: "Whenever a creature enters",
      optional: false,
      oncePerTurnKey: null,
      public: true,
    });
    const ended = endTurn(state);
    expect(ended.triggerMemory[0].status).toBe("possible-missed");
    expect(summarizeTurnMemory(ended).possibleMissed).toBe(1);
  });

  it("tracks pending, resolved, declined, and possible missed triggers", () => {
    let state = enqueueTriggerMemory(startTurn(createDefaultTurnContext()), {
      sourceId: null,
      sourceLabel: "Table effect",
      label: "Optional trigger",
      optional: true,
      oncePerTurnKey: null,
      public: true,
    });
    expect(summarizeTurnMemory(state).pending).toBe(1);
    state = resolveTriggerMemory(state, state.triggerMemory[0].id, "declined");
    expect(summarizeTurnMemory(state).declined).toBe(1);
  });

  it("phase correction changes context without manufacturing trigger memory", () => {
    const state = startTurn(createDefaultTurnContext());
    const corrected = setTurnPhase(state, "postcombat-main");
    expect(corrected.quickPhase).toBe("postcombat-main");
    expect(corrected.triggerMemory).toEqual([]);
    expect(advanceTurnPhase(corrected).quickPhase).toBe("ending");
  });
});
