import { describe, expect, it } from "vitest";
import { DUNGEONS } from "./dungeonCatalog";
import {
  defaultDungeons,
  enterDungeonRoom,
  requestVenture,
  requestInitiativeUpkeep,
  resolveDungeonRoom,
  normalizeDungeons,
} from "./dungeons";

const at = "2026-10-11T12:00:00Z";
describe("verified dungeon catalog", () => {
  it.each([
    [0, "5c446a7f-0301-4343-b0df-146cf2db605b", 7, "entrance", "temple"],
    [1, "30d0398c-bf5a-4b30-936f-afdb5a109b4b", 9, "portal", "lair"],
    [2, "d2ea2605-0ca0-4782-851d-e706bd0114e4", 5, "entry", "cradle"],
    [3, "36b61021-72f0-4c22-a41d-9b2f093d7ca8", 9, "entrance", "throne"],
  ] as const)(
    "validates identity and connected topology for catalog %s",
    (index, id, count, entry, final) => {
      const dungeon = DUNGEONS[index];
      expect(dungeon.id).toBe(id);
      expect(dungeon.rooms).toHaveLength(count);
      expect(dungeon.rooms[0].id).toBe(entry);
      expect(dungeon.rooms.at(-1)?.id).toBe(final);
      const reached = new Set<string>();
      const walk = (roomId: string) => {
        if (reached.has(roomId)) return;
        reached.add(roomId);
        const room = dungeon.rooms.find((r) => r.id === roomId)!;
        expect(room.text.length).toBeGreaterThan(4);
        for (const next of room.next) {
          expect(
            dungeon.rooms.some((r) => r.id === next && r.row > room.row),
          ).toBe(true);
          walk(next);
        }
      };
      walk(entry);
      expect(reached.size).toBe(count);
    },
  );
  it("uses the printed branches, including the short Tomb route", () => {
    expect(DUNGEONS[0].rooms.map((r) => r.next)).toEqual([
      ["goblin", "tunnels"],
      ["storeroom", "pool"],
      ["pool", "fungi"],
      ["temple"],
      ["temple"],
      ["temple"],
      [],
    ]);
    expect(DUNGEONS[1].rooms.map((r) => r.next)).toEqual([
      ["level"],
      ["bazaar", "caverns"],
      ["lost"],
      ["lost"],
      ["runestone", "graveyard"],
      ["mines"],
      ["mines"],
      ["lair"],
      [],
    ]);
    expect(DUNGEONS[2].rooms.map((r) => r.next)).toEqual([
      ["veils", "oubliette"],
      ["sandfall"],
      ["cradle"],
      ["cradle"],
      [],
    ]);
    expect(DUNGEONS[3].rooms.map((r) => r.next)).toEqual([
      ["forge", "well"],
      ["trap", "arena"],
      ["arena", "stash"],
      ["archives"],
      ["archives", "catacombs"],
      ["catacombs"],
      ["throne"],
      ["throne"],
      [],
    ]);
    expect(DUNGEONS[3].rooms[1].text).toBe(
      "Put two +1/+1 counters on target creature.",
    );
    expect(DUNGEONS[2].rooms.at(-1)?.effect).toMatchObject({
      name: "The Atropal",
      legendary: true,
      keywords: ["Deathtouch"],
    });
  });
});
describe("dungeon lifecycle", () => {
  const move = (
    state = defaultDungeons(),
    dungeon = DUNGEONS[0],
    roomId = dungeon.rooms[0].id,
    correction = false,
    playerId = "you",
    id = `${playerId}:${dungeon.id}:${roomId}`,
  ) =>
    enterDungeonRoom(state, {
      id,
      playerId,
      dungeonId: dungeon.id,
      roomId,
      kind: dungeon.undercity ? "undercity" : "dungeon",
      at,
      correction,
    });
  it("restricts new entries but both venture instructions advance an existing dungeon", () => {
    expect(
      enterDungeonRoom(defaultDungeons(), {
        id: "invalid",
        playerId: "you",
        dungeonId: DUNGEONS[3].id,
        roomId: "entrance",
        kind: "dungeon",
        at,
      }).changed,
    ).toBe(false);
    const started = move().state;
    const advanced = enterDungeonRoom(started, {
      id: "advance",
      playerId: "you",
      dungeonId: DUNGEONS[0].id,
      roomId: "tunnels",
      kind: "undercity",
      at,
    });
    expect(advanced.changed).toBe(true);
    expect(move(started, DUNGEONS[1]).changed).toBe(false);
    expect(move(started, DUNGEONS[0], "temple").changed).toBe(false);
  });
  it("corrections move freely without creating room abilities", () => {
    const result = move(defaultDungeons(), DUNGEONS[3], "throne", true);
    expect(result.state.players.you.effects).toHaveLength(0);
    expect(result.state.players.you.active?.visits[0].correction).toBe(true);
  });
  it.each(DUNGEONS)(
    "completes $name only once room abilities leave the stack",
    (dungeon) => {
      let state = defaultDungeons();
      let room = dungeon.rooms[0];
      while (true) {
        state = move(state, dungeon, room.id).state;
        if (!room.next.length) break;
        room = dungeon.rooms.find((r) => r.id === room.next[0])!;
      }
      expect(state.players.you.completed).toHaveLength(0);
      expect(state.players.you.active).not.toBeNull();
      for (const effect of [...state.players.you.effects].reverse())
        state = resolveDungeonRoom(state, "you", effect.id, "manual", at);
      expect(state.players.you.active).toBeNull();
      expect(state.players.you.completed).toHaveLength(1);
      const repeat = move(
        state,
        dungeon,
        dungeon.rooms[0].id,
        false,
        "you",
        "second-run",
      );
      expect(repeat.changed).toBe(true);
      expect(repeat.state.players.you.completed).toHaveLength(1);
    },
  );
  it("venturing from a pending final room completes the old run without losing its ability", () => {
    let state = defaultDungeons();
    for (const room of ["entrance", "goblin", "storeroom", "temple"])
      state = move(state, DUNGEONS[0], room).state;
    const next = move(state, DUNGEONS[1]);
    expect(next.changed).toBe(true);
    expect(next.state.players.you.completed).toHaveLength(1);
    expect(
      next.state.players.you.effects.filter(
        (effect) =>
          effect.dungeonId === DUNGEONS[0].id && effect.status === "pending",
      ),
    ).toHaveLength(4);
  });
  it("separates players and rejects replayed event/request IDs", () => {
    let state = move().state;
    state = move(state, DUNGEONS[3], "entrance", false, "opponent").state;
    expect(state.players.you.active?.dungeonId).toBe(DUNGEONS[0].id);
    expect(state.players.opponent.active?.dungeonId).toBe(DUNGEONS[3].id);
    expect(move(state).changed).toBe(false);
    state = requestVenture(state, {
      id: "request",
      playerId: "you",
      kind: "undercity",
      reason: "initiative",
      at,
    });
    const input = {
      id: "room",
      playerId: "you",
      dungeonId: DUNGEONS[0].id,
      roomId: "tunnels",
      kind: "dungeon" as const,
      requestId: "request",
      at,
    };
    const next = enterDungeonRoom(state, input).state;
    expect(enterDungeonRoom(next, { ...input, id: "replay" }).changed).toBe(
      false,
    );
    expect(normalizeDungeons(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("recognizes only the initiative holder's upkeep, once per turn", () => {
    const state = requestInitiativeUpkeep(
      defaultDungeons(),
      "you",
      "opponent",
      "turn1",
      at,
    );
    expect(state.requests).toHaveLength(0);
    const first = requestInitiativeUpkeep(
      state,
      "opponent",
      "opponent",
      "turn1",
      at,
    );
    expect(first.requests).toHaveLength(1);
    expect(
      requestInitiativeUpkeep(first, "opponent", "opponent", "turn1", at),
    ).toBe(first);
    expect(
      requestInitiativeUpkeep(first, "opponent", "opponent", "turn2", at)
        .requests,
    ).toHaveLength(2);
  });
  it("rejects unsafe player keys and malformed restored records", () => {
    expect(
      move(defaultDungeons(), DUNGEONS[0], "entrance", false, "toString")
        .changed,
    ).toBe(false);
    const state = normalizeDungeons({
      players: {
        you: {
          active: {
            id: "run",
            dungeonId: DUNGEONS[0].id,
            currentRoomId: "entrance",
            visits: [null, { roomId: "unknown" }],
          },
          effects: [null],
          completed: [null],
        },
      },
      requests: [{ playerId: "you", kind: "dungeon" }],
      eventIds: [null, "one", "one"],
    });
    expect(state.players.you.active?.visits).toEqual([]);
    expect(state.players.you.effects).toEqual([]);
    expect(state.requests).toEqual([]);
    expect(state.eventIds).toEqual(["one"]);
  });
});
