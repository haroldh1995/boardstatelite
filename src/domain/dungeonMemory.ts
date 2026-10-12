import type { FieldState } from "./types";
import { dungeonById, dungeonRoom } from "./dungeonCatalog";
import type { TriggerMemoryItem } from "../turn/types";
import { dungeonPlayers } from "./dungeonPlayers";

export function dungeonMemoryPlayer(
  field: FieldState,
  memoryId: string,
): string | undefined {
  const state = field.externalGameState.dungeons;
  return (
    state.requests.find(
      (request) => `dungeon-request:${request.id}` === memoryId,
    )?.playerId ??
    Object.entries(state.players).find(([, player]) =>
      player.effects.some((effect) => `dungeon-room:${effect.id}` === memoryId),
    )?.[0]
  );
}

export function withDungeonMemory(field: FieldState): FieldState {
  const state = field.externalGameState.dungeons;
  const names = dungeonPlayers(field);
  const name = (id: string) =>
    names.find((player) => player.id === id)?.name ?? "Player";
  const items: TriggerMemoryItem[] = state.requests.map((request) => ({
    id: `dungeon-request:${request.id}`,
    sourceId: null,
    sourceLabel: `${name(request.playerId)} / ${request.reason === "venture" ? "Dungeon" : "Initiative"}`,
    label:
      "Venture into " +
      (request.kind === "undercity" ? "Undercity" : "the dungeon"),
    optional: false,
    oncePerTurnKey: null,
    status: "pending",
    observedAt: request.at,
    resolvedAt: null,
    public: true,
  }));
  for (const [playerId, player] of Object.entries(state.players))
    for (const effect of player.effects.filter(
      (entry) => entry.status === "pending",
    )) {
      const room = dungeonRoom(effect.dungeonId, effect.roomId);
      items.push({
        id: `dungeon-room:${effect.id}`,
        sourceId: effect.dungeonId,
        sourceLabel: `${name(playerId)} / ${dungeonById(effect.dungeonId)?.name ?? "Dungeon"}`,
        label: `${room?.name}: ${room?.text}`,
        optional: false,
        oncePerTurnKey: null,
        status: "pending",
        observedAt: effect.at,
        resolvedAt: null,
        public: true,
      });
    }
  return {
    ...field,
    turnContext: {
      ...field.turnContext,
      triggerMemory: [
        ...field.turnContext.triggerMemory.filter(
          (entry) => !entry.id.startsWith("dungeon-"),
        ),
        ...items.map((item) =>
          field.turnContext.triggerMemory.find(
            (previous) => previous.id === item.id,
          )?.status === "possible-missed"
            ? { ...item, status: "possible-missed" as const }
            : item,
        ),
      ],
    },
  };
}
