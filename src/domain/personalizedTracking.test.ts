import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultField, sanitizeImportedField } from "./field";
import { createCardGroup } from "./cards";
import { testCard } from "../test/factories";
import { useFieldStore } from "../state/useFieldStore";
import {
  defaultPlayerTrackers,
  normalizePlayerTrackers,
  playerCounterValue,
} from "./playerTrackers";
import { DUNGEONS } from "./dungeonCatalog";
import { createPublicGameplaySnapshot } from "../sharedSession/serializer";
import { parseMagicCommand } from "../echo/magicCommandGrammar";
import { createAthenaAwarenessContext } from "../athena/foundation";

const store = () => useFieldStore.getState();
const local = () => store().field.multiplayer.registry.localParticipantId;
beforeEach(() =>
  useFieldStore.setState({
    field: createDefaultField(),
    hydrated: true,
    startupVisible: false,
    modal: null,
    lastResult: null,
    undoStack: [],
    redoStack: [],
  }),
);
describe("personalized counters", () => {
  it("loads defaults and normalizes layouts without exposing permanent counters", () => {
    expect(store().field.settings.playerTrackers).toEqual(
      defaultPlayerTrackers(),
    );
    expect(
      normalizePlayerTrackers({
        visible: ["poison", "+1/+1", "poison", "ticket"],
      }).visible,
    ).toEqual(["poison", "ticket"]);
  });
  it("hide, reorder, rename and presets never touch values or gameplay history", () => {
    store().adjustPlayerTracker("poison", 6);
    const before = store().field;
    store().updateSettings({
      playerTrackers: {
        visible: ["custom-quest", "ticket"],
        custom: [{ id: "custom-quest", name: "Quest" }],
        presets: [
          { id: "saved", name: "Mine", trackers: ["poison", "custom-quest"] },
        ],
      },
    });
    expect(store().field.player).toBe(before.player);
    expect(store().field.groups).toBe(before.groups);
    expect(store().undoStack).toHaveLength(1);
    store().adjustPlayerTracker("custom-quest", 4);
    store().adjustPlayerTracker("ticket", 3);
    const preferences = store().field.settings.playerTrackers;
    store().updateSettings({
      playerTrackers: {
        ...preferences,
        visible: preferences.presets[0].trackers,
        custom: [{ id: "custom-quest", name: "Progress" }],
      },
    });
    expect(
      playerCounterValue(store().field.player.counters, "custom-quest"),
    ).toBe(4);
    expect(store().field.player.counters.poison).toBe(6);
    store().undo();
    expect(playerCounterValue(store().field.player.counters, "ticket")).toBe(0);
    expect(store().field.settings.playerTrackers.custom[0].name).toBe(
      "Progress",
    );
    store().redo();
    expect(playerCounterValue(store().field.player.counters, "ticket")).toBe(3);
    expect(
      sanitizeImportedField(JSON.parse(JSON.stringify(store().field)))?.settings
        .playerTrackers,
    ).toEqual(store().field.settings.playerTrackers);
    const saved = store().field.settings.playerTrackers;
    store().resetField();
    expect(store().field.settings.playerTrackers).toEqual(saved);
    expect(store().field.player.counters.poison).toBe(0);
    expect(store().field.player.counters.custom).toEqual({});
  });
  it("bounds custom counters and preserves values through presentation changes", () => {
    store().adjustPlayerTracker("acorn", 4);
    store().adjustPlayerTracker("acorn", -9);
    expect(playerCounterValue(store().field.player.counters, "acorn")).toBe(0);
    store().adjustPlayerTracker("energy", 3);
    const before = store().field;
    const history = store().undoStack.length;
    store().setLifePresentation(true);
    store().setLifePresentation(false);
    expect(store().field).toBe(before);
    expect(store().undoStack).toHaveLength(history);
  });
});
describe("dungeon gameplay integration", () => {
  const enter = (index: number, roomId: string, correction = false) =>
    store().moveDungeon({
      playerId: local(),
      dungeonId: DUNGEONS[index].id,
      roomId,
      kind: index === 3 ? "undercity" : "dungeon",
      correction,
    });
  const pending = () =>
    store().field.externalGameState.dungeons.players[local()].effects.at(-1)!;
  it("life rooms use Athena without creating fake tokens and undo atomically", () => {
    expect(enter(1, "portal")).toBeNull();
    const id = pending().id;
    expect(store().resolveDungeonEffect(local(), id, "apply")).toBeNull();
    expect(store().field.player.life).toBe(41);
    expect(store().field.groups).toHaveLength(0);
    store().undo();
    expect(store().field.player.life).toBe(40);
    expect(pending().status).toBe("pending");
    store().redo();
    expect(store().field.player.life).toBe(41);
    store().resolveDungeonEffect(local(), id, "apply");
    expect(store().field.player.life).toBe(41);
  });
  it("creates verified tokens and leaves unsupported instructions manual", () => {
    enter(0, "entrance");
    const first = pending();
    expect(store().resolveDungeonEffect(local(), first.id, "apply")).toMatch(
      /table/,
    );
    expect(store().field.groups).toHaveLength(0);
    store().resolveDungeonEffect(local(), first.id, "manual");
    enter(0, "tunnels");
    store().resolveDungeonEffect(local(), pending().id, "apply");
    expect(store().field.groups[0].characteristics).toMatchObject({
      isToken: true,
      isCreature: false,
      subtypes: ["Treasure"],
    });
  });
  it("targeted counters change one creature in a stack through the canonical pipeline", () => {
    const group = createCardGroup(
      testCard({
        name: "Bear",
        typeLine: "Creature - Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
      }),
      3,
    );
    useFieldStore.setState({ field: { ...store().field, groups: [group] } });
    enter(3, "entrance");
    enter(3, "forge");
    expect(
      store().resolveDungeonEffect(local(), pending().id, "apply"),
    ).toMatch(/Choose/);
    expect(
      store().resolveDungeonEffect(local(), pending().id, "apply", group.id),
    ).toBeNull();
    const groups = store().field.groups;
    expect(
      groups.find((entry) => entry.counters["+1/+1"] === 2)?.quantity,
    ).toBe(1);
    expect(groups.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(3);
  });
  it("correction neither creates room effects nor gameplay triggers", () => {
    enter(3, "throne", true);
    expect(
      store().field.externalGameState.dungeons.players[local()].effects,
    ).toHaveLength(0);
    expect(store().field.turnContext.triggerMemory).toHaveLength(0);
    expect(store().field.groups).toHaveLength(0);
    store().undo();
    store().redo();
    expect(store().field.groups).toHaveLength(0);
  });
  it.each([
    [1, "lost", "graveyard", "Skeleton", 2, 1, 1, ""],
    [2, "oubliette", "cradle", "The Atropal", 1, 4, 4, "Deathtouch"],
    [3, "stash", "catacombs", "Skeleton", 1, 4, 1, "Menace"],
  ] as const)(
    "preserves token characteristics for dungeon %s",
    (index, previous, room, name, quantity, power, toughness, keyword) => {
      enter(index, previous, true);
      enter(index, room);
      expect(
        store().resolveDungeonEffect(local(), pending().id, "apply"),
      ).toBeNull();
      const token = store().field.groups[0];
      expect(token.label).toBe(name);
      expect(token.quantity).toBe(quantity);
      expect(token.pt.currentPower).toBe(power);
      expect(token.pt.currentToughness).toBe(toughness);
      expect(token.characteristics.colors).toEqual(["B"]);
      expect(token.identity?.oracleText).toContain(keyword);
      if (name === "The Atropal")
        expect(token.characteristics.isLegendary).toBe(true);
    },
  );
  it("life loss and targeted life changes never create battlefield objects", () => {
    enter(2, "entry");
    store().resolveDungeonEffect(local(), pending().id, "apply");
    expect(store().field.player.life).toBe(39);
    enter(3, "forge", true);
    enter(3, "trap");
    expect(
      store().resolveDungeonEffect(local(), pending().id, "apply"),
    ).toMatch(/Choose/);
    store().resolveDungeonEffect(local(), pending().id, "apply", local());
    expect(store().field.player.life).toBe(34);
    expect(store().field.groups).toHaveLength(0);
    store().undo();
    expect(store().field.player.life).toBe(39);
  });
  it("initiative ownership, pending ventures and per-player progress survive loss and restore", () => {
    enter(0, "entrance");
    const run =
      store().field.externalGameState.dungeons.players[local()].active;
    const opponent = store().addDungeonPlayer("Alex");
    store().takeInitiative(opponent, "take1");
    store().takeInitiative(opponent, "take1");
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(1);
    store().moveDungeon({
      playerId: opponent,
      dungeonId: DUNGEONS[3].id,
      roomId: "entrance",
      kind: "undercity",
      requestId: "take1",
    });
    store().takeInitiative(local(), "take2");
    expect(
      store().field.externalGameState.dungeons.players[local()].active,
    ).toEqual(run);
    expect(
      store().field.externalGameState.dungeons.players[opponent].active
        ?.dungeonId,
    ).toBe(DUNGEONS[3].id);
    store().undo();
    expect(store().field.externalGameState.initiativeHolderId).toBe(opponent);
    store().redo();
    expect(store().field.externalGameState.initiativeHolderId).toBe(local());
    const restored = sanitizeImportedField(
      JSON.parse(JSON.stringify(store().field)),
    )!;
    expect(restored.externalGameState.dungeons).toEqual(
      store().field.externalGameState.dungeons,
    );
    expect(JSON.stringify(createPublicGameplaySnapshot(restored))).toContain(
      DUNGEONS[3].id,
    );
    expect(
      createAthenaAwarenessContext(restored).dungeonContext.players[local()]
        .active,
    ).toEqual(run);
    store().resetField();
    expect(store().field.externalGameState.dungeons.players).toEqual({});
    expect(store().field.externalGameState.dungeons.requests).toEqual([]);
    expect(store().field.externalGameState.initiativeHolderId).toBeNull();
    expect(store().undoStack).toHaveLength(0);
  });
  it("upkeep detection is turn-aware, idempotent, and phase correction creates nothing", () => {
    store().setExternalHolder("initiative", local());
    store().startTurn();
    store().setTurnPhase("precombat-main");
    store().setTurnPhase("beginning");
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(0);
    store().observeUpkeep(local());
    store().observeUpkeep(local());
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(1);
    store().endTurn();
    store().startTurn();
    store().observeUpkeep(local());
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(2);
  });
  it("migrates legacy rooms as corrections and excludes unrecognized imported private fields", () => {
    const legacy = JSON.parse(JSON.stringify(store().field));
    delete legacy.externalGameState.dungeons;
    legacy.externalGameState.dungeon = {
      dungeonName: "Undercity",
      currentRoomName: "Forge",
      completed: false,
    };
    const migrated = sanitizeImportedField(legacy)!;
    expect(
      migrated.externalGameState.dungeons.players[local()].active
        ?.currentRoomId,
    ).toBe("forge");
    expect(
      migrated.externalGameState.dungeons.players[local()].effects,
    ).toEqual([]);
    const raw = JSON.parse(JSON.stringify(migrated));
    raw.externalGameState.dungeons.players[local()].active.privateDeck =
      "PRIVATE-DECK-SENTINEL";
    raw.externalGameState.tablePlayers = [
      { id: "opponent", name: "Alex", privateDeck: "PRIVATE-DECK-SENTINEL" },
    ];
    const restored = sanitizeImportedField(raw)!;
    expect(
      JSON.stringify(createPublicGameplaySnapshot(restored)),
    ).not.toContain("PRIVATE-DECK-SENTINEL");
  });
  it("Echo uncertainty stays a proposal; an accepted intent uses the existing history", () => {
    const uncertain = store().processAmbientIntent({
      id: "heard-venture",
      kind: "custom",
      source: "voice-command",
      confidence: "low",
      requiresPreview: true,
      payload: { action: "take-initiative" },
    });
    expect(uncertain.status).not.toBe("completed");
    expect(store().field.externalGameState.initiativeHolderId).toBeNull();
    expect(store().field.externalGameState.dungeons.requests).toEqual([]);
    const accepted = store().processAmbientIntent({
      id: "accepted-venture",
      kind: "custom",
      source: "manual",
      confidence: "high",
      payload: { action: "take-initiative" },
    });
    expect(accepted.status).toBe("completed");
    expect(store().field.externalGameState.initiativeHolderId).toBe(local());
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(1);
    store().undo();
    expect(store().field.externalGameState.initiativeHolderId).toBeNull();
    store().redo();
    expect(store().field.externalGameState.dungeons.requests).toHaveLength(1);
  });
  it.each([
    "Take the initiative",
    "Venture into the dungeon",
    "Venture into Undercity",
  ])(
    "extends Echo grammar without mutating on recognition: %s",
    (transcript) => {
      const before = store().field;
      const result = parseMagicCommand({ transcript, field: before });
      expect(result.intent?.kind).toBe("custom");
      expect(result.action).toMatch(/initiative|venture/);
      expect(store().field).toBe(before);
    },
  );
});
