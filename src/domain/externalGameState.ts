import { makeId } from "./cards";

export const EXTERNAL_GAME_STATE_VERSION = 1;

export interface ExternalSourceObject {
  id: string;
  kind:
    | "emblem"
    | "dungeon"
    | "plane"
    | "phenomenon"
    | "scheme"
    | "ongoing-scheme"
    | "custom";
  name: string;
  imageUrl: string | null;
  public: boolean;
  active: boolean;
  sourceCardName: string | null;
}

export interface DungeonProgressState {
  dungeonId: string | null;
  dungeonName: string | null;
  currentRoomId: string | null;
  currentRoomName: string | null;
  visitedRoomIds: string[];
  completed: boolean;
}

export interface PlanechaseState {
  enabled: boolean;
  currentPlaneId: string | null;
  planarRollsThisTurn: number;
  lastResult: "chaos" | "planeswalk" | "blank" | null;
  history: Array<{
    id: string;
    result: "chaos" | "planeswalk" | "blank";
    at: string;
  }>;
}

export interface ArchenemyState {
  enabled: boolean;
  archenemyParticipantId: string | null;
  currentSchemeId: string | null;
  ongoingSchemeIds: string[];
  schemeDeckRemaining: number | null;
}

export interface ExternalGameState {
  version: typeof EXTERNAL_GAME_STATE_VERSION;
  sources: ExternalSourceObject[];
  initiativeHolderId: string | null;
  monarchHolderId: string | null;
  dayNight: "off" | "day" | "night";
  citysBlessingParticipantIds: string[];
  dungeon: DungeonProgressState;
  planechase: PlanechaseState;
  archenemy: ArchenemyState;
  updatedAt: string;
}

export function createDefaultExternalGameState(
  timestamp = new Date().toISOString(),
): ExternalGameState {
  return {
    version: EXTERNAL_GAME_STATE_VERSION,
    sources: [],
    initiativeHolderId: null,
    monarchHolderId: null,
    dayNight: "off",
    citysBlessingParticipantIds: [],
    dungeon: {
      dungeonId: null,
      dungeonName: null,
      currentRoomId: null,
      currentRoomName: null,
      visitedRoomIds: [],
      completed: false,
    },
    planechase: {
      enabled: false,
      currentPlaneId: null,
      planarRollsThisTurn: 0,
      lastResult: null,
      history: [],
    },
    archenemy: {
      enabled: false,
      archenemyParticipantId: null,
      currentSchemeId: null,
      ongoingSchemeIds: [],
      schemeDeckRemaining: null,
    },
    updatedAt: timestamp,
  };
}

export function normalizeExternalGameState(
  value: unknown,
  timestamp = new Date().toISOString(),
): ExternalGameState {
  const defaults = createDefaultExternalGameState(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<ExternalGameState>;
  return {
    ...defaults,
    ...candidate,
    version: EXTERNAL_GAME_STATE_VERSION,
    sources: Array.isArray(candidate.sources)
      ? candidate.sources.slice(-80)
      : [],
    citysBlessingParticipantIds: Array.isArray(
      candidate.citysBlessingParticipantIds,
    )
      ? [...new Set(candidate.citysBlessingParticipantIds)]
      : [],
    dungeon: { ...defaults.dungeon, ...candidate.dungeon },
    planechase: {
      ...defaults.planechase,
      ...candidate.planechase,
      history: Array.isArray(candidate.planechase?.history)
        ? candidate.planechase.history.slice(-40)
        : [],
    },
    archenemy: { ...defaults.archenemy, ...candidate.archenemy },
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
  };
}

export function addExternalSource(
  state: ExternalGameState,
  input: Omit<ExternalSourceObject, "id" | "active"> & { id?: string },
  timestamp = new Date().toISOString(),
): ExternalGameState {
  const source: ExternalSourceObject = {
    ...input,
    id: input.id ?? makeId("external-source"),
    active: true,
  };
  return {
    ...state,
    sources: [
      ...state.sources.filter((entry) => entry.id !== source.id),
      source,
    ],
    updatedAt: timestamp,
  };
}

export function removeExternalSource(
  state: ExternalGameState,
  id: string,
  timestamp = new Date().toISOString(),
): ExternalGameState {
  return {
    ...state,
    sources: state.sources.filter((entry) => entry.id !== id),
    planechase:
      state.planechase.currentPlaneId === id
        ? { ...state.planechase, currentPlaneId: null }
        : state.planechase,
    archenemy: {
      ...state.archenemy,
      currentSchemeId:
        state.archenemy.currentSchemeId === id
          ? null
          : state.archenemy.currentSchemeId,
      ongoingSchemeIds: state.archenemy.ongoingSchemeIds.filter(
        (entry) => entry !== id,
      ),
    },
    updatedAt: timestamp,
  };
}

export function progressDungeon(
  state: ExternalGameState,
  input: {
    dungeonId: string;
    dungeonName: string;
    roomId: string;
    roomName: string;
    completed?: boolean;
  },
  timestamp = new Date().toISOString(),
): ExternalGameState {
  const sameDungeon = state.dungeon.dungeonId === input.dungeonId;
  return {
    ...state,
    dungeon: {
      dungeonId: input.dungeonId,
      dungeonName: input.dungeonName,
      currentRoomId: input.roomId,
      currentRoomName: input.roomName,
      visitedRoomIds: [
        ...(sameDungeon ? state.dungeon.visitedRoomIds : []),
        input.roomId,
      ].filter((id, index, values) => values.indexOf(id) === index),
      completed: input.completed === true,
    },
    updatedAt: timestamp,
  };
}

export function setCurrentPlane(
  state: ExternalGameState,
  source: Omit<ExternalSourceObject, "id" | "active" | "kind"> & {
    id?: string;
  },
  timestamp = new Date().toISOString(),
): ExternalGameState {
  const next = addExternalSource(
    state,
    { ...source, kind: "plane", id: source.id ?? makeId("plane") },
    timestamp,
  );
  const plane = next.sources.at(-1);
  if (!plane) return state;
  return {
    ...next,
    planechase: { ...next.planechase, enabled: true, currentPlaneId: plane.id },
  };
}

export function recordPlanarDieResult(
  state: ExternalGameState,
  result: "chaos" | "planeswalk" | "blank",
  timestamp = new Date().toISOString(),
): ExternalGameState {
  return {
    ...state,
    planechase: {
      ...state.planechase,
      enabled: true,
      planarRollsThisTurn: state.planechase.planarRollsThisTurn + 1,
      lastResult: result,
      history: [
        ...state.planechase.history,
        { id: makeId("planar-roll"), result, at: timestamp },
      ].slice(-40),
    },
    updatedAt: timestamp,
  };
}

export function setCurrentScheme(
  state: ExternalGameState,
  source: Omit<ExternalSourceObject, "id" | "active" | "kind"> & {
    id?: string;
    ongoing?: boolean;
  },
  timestamp = new Date().toISOString(),
): ExternalGameState {
  const kind = source.ongoing ? "ongoing-scheme" : "scheme";
  const next = addExternalSource(
    state,
    { ...source, kind, id: source.id ?? makeId("scheme") },
    timestamp,
  );
  const scheme = next.sources.at(-1);
  if (!scheme) return state;
  return {
    ...next,
    archenemy: {
      ...next.archenemy,
      enabled: true,
      currentSchemeId: scheme.id,
      ongoingSchemeIds: source.ongoing
        ? [...new Set([...next.archenemy.ongoingSchemeIds, scheme.id])]
        : next.archenemy.ongoingSchemeIds,
    },
  };
}
