import { DUNGEONS, dungeonById, dungeonRoom } from "./dungeonCatalog";

export type VentureKind = "dungeon" | "undercity";
export interface DungeonVisit {
  id: string;
  roomId: string;
  at: string;
  correction: boolean;
}
export interface DungeonRun {
  id: string;
  dungeonId: string;
  currentRoomId: string;
  visits: DungeonVisit[];
  completedAt: string | null;
  corrected: boolean;
}
export interface DungeonRoomResolution {
  id: string;
  runId: string;
  dungeonId: string;
  roomId: string;
  status: "pending" | "applied" | "manual" | "countered";
  at: string;
}
export interface PlayerDungeonState {
  active: DungeonRun | null;
  completed: DungeonRun[];
  effects: DungeonRoomResolution[];
}
export interface VentureRequest {
  id: string;
  playerId: string;
  kind: VentureKind;
  reason: "initiative" | "upkeep" | "venture";
  at: string;
}
export interface DungeonState {
  version: 1;
  players: Record<string, PlayerDungeonState>;
  requests: VentureRequest[];
  eventIds: string[];
  upkeepKeys: string[];
}
export const emptyDungeonPlayer = (): PlayerDungeonState => ({
  active: null,
  completed: [],
  effects: [],
});
export const defaultDungeons = (): DungeonState => ({
  version: 1,
  players: {},
  requests: [],
  eventIds: [],
  upkeepKeys: [],
});
export function normalizeDungeons(value: unknown): DungeonState {
  if (!value || typeof value !== "object") return defaultDungeons();
  const input = value as Partial<DungeonState>;
  const players: DungeonState["players"] = {};
  for (const [id, player] of Object.entries(input.players ?? {})) {
    if (!player || !safePlayerId(id)) continue;
    const validRun = (
      run: DungeonRun | null | undefined,
    ): DungeonRun | null => {
      if (
        !run ||
        typeof run.id !== "string" ||
        !dungeonRoom(run.dungeonId, run.currentRoomId) ||
        !Array.isArray(run.visits)
      )
        return null;
      return {
        id: run.id,
        dungeonId: dungeonById(run.dungeonId)!.id,
        currentRoomId: run.currentRoomId,
        completedAt:
          typeof run.completedAt === "string" ? run.completedAt : null,
        corrected: run.corrected === true,
        visits: run.visits
          .filter(
            (visit) =>
              visit &&
              typeof visit.id === "string" &&
              typeof visit.at === "string" &&
              dungeonRoom(run.dungeonId, visit.roomId),
          )
          .map((visit) => ({
            id: visit.id,
            roomId: visit.roomId,
            at: visit.at,
            correction: visit.correction === true,
          })),
      };
    };
    players[id] = {
      active: validRun(player.active),
      completed: Array.isArray(player.completed)
        ? player.completed
            .map(validRun)
            .filter((run): run is DungeonRun => run !== null)
        : [],
      effects: Array.isArray(player.effects)
        ? player.effects
            .filter(
              (effect) =>
                effect &&
                typeof effect.id === "string" &&
                typeof effect.runId === "string" &&
                typeof effect.at === "string" &&
                dungeonRoom(effect.dungeonId, effect.roomId) &&
                ["pending", "applied", "manual", "countered"].includes(
                  effect.status,
                ),
            )
            .map((effect) => ({
              id: effect.id,
              runId: effect.runId,
              dungeonId: dungeonById(effect.dungeonId)!.id,
              roomId: effect.roomId,
              status: effect.status,
              at: effect.at,
            }))
        : [],
    };
  }
  return {
    version: 1,
    players,
    requests: Array.isArray(input.requests)
      ? input.requests
          .filter(
            (r) =>
              r &&
              typeof r.id === "string" &&
              typeof r.at === "string" &&
              safePlayerId(r.playerId) &&
              ["initiative", "upkeep", "venture"].includes(r.reason) &&
              ["dungeon", "undercity"].includes(r.kind),
          )
          .map((request) => ({
            id: request.id,
            playerId: request.playerId,
            kind: request.kind,
            reason: request.reason,
            at: request.at,
          }))
      : [],
    eventIds: Array.isArray(input.eventIds)
      ? [...new Set(input.eventIds.filter((id) => typeof id === "string"))]
      : [],
    upkeepKeys: Array.isArray(input.upkeepKeys)
      ? [...new Set(input.upkeepKeys.filter((id) => typeof id === "string"))]
      : [],
  };
}
function safePlayerId(id: string) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id !== "prototype" &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, id)
  );
}
export function availableDungeonRooms(
  state: DungeonState,
  playerId: string,
): string[] {
  const run = state.players[playerId]?.active;
  return run ? (dungeonRoom(run.dungeonId, run.currentRoomId)?.next ?? []) : [];
}
export function requestVenture(
  state: DungeonState,
  request: VentureRequest,
): DungeonState {
  if (!safePlayerId(request.playerId) || state.eventIds.includes(request.id))
    return state;
  return {
    ...state,
    requests: [...state.requests, request],
    eventIds: [...state.eventIds, request.id],
  };
}
export function requestInitiativeUpkeep(
  state: DungeonState,
  playerId: string,
  holderId: string | null,
  turnId: string,
  at: string,
): DungeonState {
  const key = `${turnId}:${playerId}`;
  if (playerId !== holderId || state.upkeepKeys.includes(key)) return state;
  const next = requestVenture(state, {
    id: `initiative-upkeep:${key}`,
    playerId,
    kind: "undercity",
    reason: "upkeep",
    at,
  });
  return { ...next, upkeepKeys: [...next.upkeepKeys, key] };
}
export interface DungeonMove {
  id: string;
  playerId: string;
  dungeonId: string;
  roomId: string;
  kind: VentureKind;
  at: string;
  correction?: boolean;
  requestId?: string;
}
export type DungeonTransition = {
  state: DungeonState;
  error: string | null;
  changed: boolean;
};
export function enterDungeonRoom(
  state: DungeonState,
  move: DungeonMove,
): DungeonTransition {
  const reject = (error: string | null): DungeonTransition => ({
    state,
    error,
    changed: false,
  });
  if (state.eventIds.includes(move.id)) return reject(null);
  if (!safePlayerId(move.playerId)) return reject("Choose a player.");
  const dungeon = dungeonById(move.dungeonId);
  const room = dungeon?.rooms.find((entry) => entry.id === move.roomId);
  if (!dungeon || !room) return reject("Choose a known dungeon room.");
  const request = move.requestId
    ? state.requests.find(
        (entry) =>
          entry.id === move.requestId && entry.playerId === move.playerId,
      )
    : null;
  if (move.requestId && !request)
    return reject("This venture has already been recorded.");
  const kind = request?.kind ?? move.kind;
  const player = state.players[move.playerId] ?? emptyDungeonPlayer();
  let active = player.active;
  let completed = player.completed;
  if (!move.correction) {
    const current =
      active && dungeonRoom(active.dungeonId, active.currentRoomId);
    if (active && current && current.next.length > 0) {
      if (active.dungeonId !== dungeon.id || !current.next.includes(room.id))
        return reject("Choose a connected next room, or use Correct Position.");
    } else {
      if (
        room.id !== dungeon.rooms[0].id ||
        (dungeon.undercity && kind !== "undercity") ||
        (!dungeon.undercity && kind === "undercity")
      )
        return reject("Choose an entry room for this venture instruction.");
      // CR 701.49c: venturing from the bottom room completes that run even with a room ability pending.
      if (active)
        completed = [...completed, { ...active, completedAt: move.at }];
      active = null;
    }
  } else if (active?.dungeonId !== dungeon.id) active = null;
  const visit: DungeonVisit = {
    id: move.id,
    roomId: room.id,
    at: move.at,
    correction: move.correction === true,
  };
  const run: DungeonRun = {
    id: active?.id ?? `run:${move.id}`,
    dungeonId: dungeon.id,
    currentRoomId: room.id,
    visits: [...(active?.visits ?? []), visit],
    completedAt: null,
    corrected: move.correction === true || active?.corrected === true,
  };
  return {
    changed: true,
    error: null,
    state: {
      ...state,
      eventIds: [...state.eventIds, move.id],
      requests: state.requests.filter((entry) => entry.id !== move.requestId),
      players: {
        ...state.players,
        [move.playerId]: {
          active: run,
          completed,
          effects: move.correction
            ? player.effects
            : [
                ...player.effects,
                {
                  id: move.id,
                  runId: run.id,
                  dungeonId: dungeon.id,
                  roomId: room.id,
                  status: "pending",
                  at: move.at,
                },
              ],
        },
      },
    },
  };
}
export function resolveDungeonRoom(
  state: DungeonState,
  playerId: string,
  effectId: string,
  status: Exclude<DungeonRoomResolution["status"], "pending">,
  at: string,
): DungeonState {
  const player = state.players[playerId];
  const effect = player?.effects.find(
    (entry) => entry.id === effectId && entry.status === "pending",
  );
  if (!player || !effect) return state;
  const effects = player.effects.map((entry) =>
    entry.id === effectId ? { ...entry, status } : entry,
  );
  const active = player.active;
  const complete =
    active &&
    dungeonRoom(active.dungeonId, active.currentRoomId)?.next.length === 0 &&
    !effects.some(
      (entry) => entry.runId === active.id && entry.status === "pending",
    );
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        effects,
        active: complete ? null : active,
        completed: complete
          ? [...player.completed, { ...active, completedAt: at }]
          : player.completed,
      },
    },
  };
}
export function acknowledgeVenture(
  state: DungeonState,
  id: string,
): DungeonState {
  return {
    ...state,
    requests: state.requests.filter((request) => request.id !== id),
  };
}
export function migrateLegacyDungeon(
  state: DungeonState,
  legacy:
    | {
        dungeonName?: string | null;
        currentRoomName?: string | null;
        completed?: boolean;
        visitedRoomIds?: string[];
      }
    | undefined,
  playerId: string,
): DungeonState {
  if (!legacy || Object.keys(state.players).length) return state;
  const dungeon = DUNGEONS.find((entry) => entry.name === legacy.dungeonName);
  const room = dungeon?.rooms.find(
    (entry) => entry.name === legacy.currentRoomName,
  );
  if (!dungeon || !room) return state;
  const migrated = enterDungeonRoom(state, {
    id: "legacy-dungeon",
    playerId,
    dungeonId: dungeon.id,
    roomId: room.id,
    kind: "dungeon",
    at: "",
    correction: true,
  }).state;
  const player = migrated.players[playerId];
  if (!legacy.completed || !player?.active) return migrated;
  return {
    ...migrated,
    players: {
      ...migrated.players,
      [playerId]: {
        ...player,
        active: null,
        completed: [{ ...player.active, completedAt: "legacy" }],
      },
    },
  };
}
