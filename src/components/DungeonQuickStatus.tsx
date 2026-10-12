import { Castle, Flag } from "lucide-react";
import { dungeonPlayers } from "../domain/dungeonPlayers";
import { dungeonRoom } from "../domain/dungeonCatalog";
import { useFieldStore } from "../state/useFieldStore";
export function DungeonQuickStatus() {
  const field = useFieldStore((state) => state.field);
  const open = useFieldStore((state) => state.openModal);
  const local = field.multiplayer.registry.localParticipantId;
  const run = field.externalGameState.dungeons.players[local]?.active;
  const holder = field.externalGameState.initiativeHolderId;
  const pending = field.externalGameState.dungeons.requests.length;
  if (!run && !holder && !pending) return null;
  return (
    <div className="dungeon-quick-status">
      {(run || pending > 0) && (
        <button
          className="quiet-action"
          aria-label={`Dungeon: ${run ? dungeonRoom(run.dungeonId, run.currentRoomId)?.name : "Venture pending"}`}
          onClick={() => open({ kind: "dungeons" })}
        >
          <Castle />
          {run
            ? dungeonRoom(run.dungeonId, run.currentRoomId)?.name
            : "Venture"}
          {pending > 0 ? ` / ${pending} pending` : ""}
        </button>
      )}
      {holder && (
        <button
          className="quiet-action"
          onClick={() =>
            open({ kind: "dungeons", payload: { playerId: holder } })
          }
        >
          <Flag /> Initiative:{" "}
          {dungeonPlayers(field).find((entry) => entry.id === holder)?.name ??
            "Player"}
        </button>
      )}
    </div>
  );
}
