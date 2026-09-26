import { describe, expect, it } from "vitest";
import {
  addExternalSource,
  createDefaultExternalGameState,
  normalizeExternalGameState,
  progressDungeon,
  recordPlanarDieResult,
  removeExternalSource,
  setCurrentPlane,
  setCurrentScheme,
} from "./externalGameState";

describe("external game state", () => {
  it("persists emblem identity outside battlefield permanents", () => {
    const state = addExternalSource(createDefaultExternalGameState(), {
      kind: "emblem",
      name: "Chandra Emblem",
      imageUrl: null,
      public: true,
      sourceCardName: "Chandra",
    });
    const restored = normalizeExternalGameState(
      JSON.parse(JSON.stringify(state)),
    );
    expect(restored.sources[0].kind).toBe("emblem");
  });

  it("tracks dungeon branches and progression", () => {
    let state = progressDungeon(createDefaultExternalGameState(), {
      dungeonId: "undercity",
      dungeonName: "Undercity",
      roomId: "entrance",
      roomName: "Secret Entrance",
    });
    state = progressDungeon(state, {
      dungeonId: "undercity",
      dungeonName: "Undercity",
      roomId: "forge",
      roomName: "Forge",
    });
    expect(state.dungeon.visitedRoomIds).toEqual(["entrance", "forge"]);
    expect(state.dungeon.currentRoomName).toBe("Forge");
  });

  it("switches Planechase sources and records planar die results", () => {
    let state = setCurrentPlane(createDefaultExternalGameState(), {
      name: "The Aether Flues",
      imageUrl: null,
      public: true,
      sourceCardName: null,
    });
    const planeId = state.planechase.currentPlaneId;
    state = recordPlanarDieResult(state, "chaos");
    expect(state.planechase.lastResult).toBe("chaos");
    state = removeExternalSource(state, planeId!);
    expect(state.planechase.currentPlaneId).toBeNull();
  });

  it("tracks ongoing Archenemy schemes independently", () => {
    const state = setCurrentScheme(createDefaultExternalGameState(), {
      name: "My Undead Horde Awakens",
      imageUrl: null,
      public: true,
      sourceCardName: null,
      ongoing: true,
    });
    expect(state.archenemy.ongoingSchemeIds).toContain(
      state.archenemy.currentSchemeId,
    );
  });
});
