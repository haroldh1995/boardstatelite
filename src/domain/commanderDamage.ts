import { makeId } from "./cards";

export const COMMANDER_DAMAGE_VERSION = 1;

export interface CommanderDamageEntry {
  id: string;
  participantId: string | null;
  playerLabel: string;
  commanderCardId: string | null;
  commanderLabel: string;
  imageUrl: string | null;
  damage: number;
  public: true;
}

export interface CommanderDamageState {
  version: typeof COMMANDER_DAMAGE_VERSION;
  entries: CommanderDamageEntry[];
}

export function createDefaultCommanderDamageState(): CommanderDamageState {
  return { version: COMMANDER_DAMAGE_VERSION, entries: [] };
}

export function normalizeCommanderDamageState(
  value: unknown,
): CommanderDamageState {
  if (!value || typeof value !== "object") {
    return createDefaultCommanderDamageState();
  }
  const candidate = value as Partial<CommanderDamageState>;
  return {
    version: COMMANDER_DAMAGE_VERSION,
    entries: Array.isArray(candidate.entries)
      ? candidate.entries
          .filter((entry): entry is CommanderDamageEntry =>
            Boolean(entry && typeof entry.id === "string"),
          )
          .map((entry) => ({
            ...entry,
            damage: Math.min(999, Math.max(0, Math.trunc(entry.damage))),
            public: true as const,
          }))
          .slice(-24)
      : [],
  };
}

export function addCommanderDamageEntry(
  state: CommanderDamageState,
  input: {
    playerLabel: string;
    commanderLabel: string;
    participantId?: string | null;
    commanderCardId?: string | null;
    imageUrl?: string | null;
  },
): CommanderDamageState {
  return {
    ...state,
    entries: [
      ...state.entries,
      {
        id: makeId("commander-damage"),
        participantId: input.participantId ?? null,
        playerLabel: input.playerLabel.trim() || "Opponent",
        commanderCardId: input.commanderCardId ?? null,
        commanderLabel: input.commanderLabel.trim() || "Commander",
        imageUrl: input.imageUrl ?? null,
        damage: 0,
        public: true as const,
      },
    ].slice(-24),
  };
}

export function adjustCommanderDamageEntry(
  state: CommanderDamageState,
  id: string,
  delta: number,
): CommanderDamageState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            damage: Math.min(
              999,
              Math.max(0, entry.damage + Math.trunc(delta)),
            ),
          }
        : entry,
    ),
  };
}

export function totalCommanderDamage(state: CommanderDamageState): number {
  return state.entries.reduce((sum, entry) => sum + entry.damage, 0);
}
