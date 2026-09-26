import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultField } from "../domain/field";
import { useFieldStore } from "./useFieldStore";

describe("next-generation store integration", () => {
  beforeEach(() => {
    useFieldStore.setState({
      field: createDefaultField(),
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });
  });

  it("groups a held life delta into one canonical undo transaction", () => {
    useFieldStore.getState().adjustLife(-5, "loss");
    const state = useFieldStore.getState();
    expect(state.field.player.life).toBe(35);
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
  });

  it("starts a turn and resets land and once-per-turn state", () => {
    useFieldStore.getState().startTurn();
    useFieldStore.getState().adjustLandPlayMark(1);
    expect(
      useFieldStore.getState().field.preTurnPlanner.availableLandPlays
        .confirmed,
    ).toBe(1);
    useFieldStore.getState().endTurn();
    useFieldStore.getState().startTurn();
    const field = useFieldStore.getState().field;
    expect(field.turnContext.status).toBe("active");
    expect(field.preTurnPlanner.availableLandPlays.confirmed).toBe(0);
  });

  it("records commander combat damage and life as one transaction", () => {
    useFieldStore.getState().addCommanderDamageSource("Alex", "Partner One");
    const id = useFieldStore.getState().field.commanderDamage.entries[0].id;
    const historyBefore = useFieldStore.getState().undoStack.length;
    useFieldStore.getState().adjustCommanderDamage(id, 5, "combat");
    const state = useFieldStore.getState();
    expect(state.field.commanderDamage.entries[0].damage).toBe(5);
    expect(state.field.player.life).toBe(35);
    expect(state.undoStack).toHaveLength(historyBefore + 1);
    state.undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(
      useFieldStore.getState().field.commanderDamage.entries[0].damage,
    ).toBe(0);
  });

  it("supports commander-damage-only correction without changing life", () => {
    useFieldStore.getState().addCommanderDamageSource("Alex", "Commander");
    const id = useFieldStore.getState().field.commanderDamage.entries[0].id;
    useFieldStore.getState().adjustCommanderDamage(id, 7, "damage-only");
    const field = useFieldStore.getState().field;
    expect(field.commanderDamage.entries[0].damage).toBe(7);
    expect(field.player.life).toBe(40);
  });

  it("keeps Options and User Tools as separate surfaces", () => {
    useFieldStore.getState().openModal({ kind: "settings" });
    expect(useFieldStore.getState().modal?.kind).toBe("settings");
    useFieldStore.getState().openModal({ kind: "userTools" });
    expect(useFieldStore.getState().modal?.kind).toBe("userTools");
  });

  it("expires until-end-of-turn manual effects at the end-turn boundary", () => {
    useFieldStore.getState().addManualStaticEffect({
      source: {
        kind: "custom-table-effect",
        id: null,
        label: "Temporary table effect",
        controller: "shared",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 1, toughness: 1 },
      duration: "until-end-of-turn",
    });
    useFieldStore.getState().startTurn();
    expect(useFieldStore.getState().field.manualEffects.effects).toHaveLength(
      1,
    );
    useFieldStore.getState().endTurn();
    expect(useFieldStore.getState().field.manualEffects.effects).toHaveLength(
      0,
    );
  });

  it("persists first-class day/night and City's Blessing corrections", () => {
    const participantId =
      useFieldStore.getState().field.multiplayer.registry.localParticipantId;
    useFieldStore.getState().setDayNight("night");
    useFieldStore.getState().setCitysBlessing(participantId, true);
    const external = useFieldStore.getState().field.externalGameState;
    expect(external.dayNight).toBe("night");
    expect(external.citysBlessingParticipantIds).toContain(participantId);
  });
});
