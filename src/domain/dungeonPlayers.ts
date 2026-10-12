import type { FieldState } from "./types";
export function dungeonPlayers(
  field: FieldState,
): Array<{ id: string; name: string }> {
  const local = field.multiplayer.registry.localParticipantId;
  const values = [
    { id: local, name: "You" },
    ...field.multiplayer.registry.participants
      .filter((entry) => entry.id !== local)
      .map((entry) => ({ id: entry.id, name: entry.label })),
    ...field.externalGameState.tablePlayers,
  ];
  return values.filter(
    (entry, index) =>
      values.findIndex((other) => other.id === entry.id) === index,
  );
}
