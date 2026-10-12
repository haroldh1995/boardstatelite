import { useState } from "react";
import { Check, WandSparkles } from "lucide-react";
import { dungeonRoom } from "../domain/dungeonCatalog";
import type { DungeonRoomResolution } from "../domain/dungeons";
import { dungeonPlayers } from "../domain/dungeonPlayers";
import { useFieldStore } from "../state/useFieldStore";

export function DungeonRoomEffect({
  playerId,
  resolution,
}: {
  playerId: string;
  resolution: DungeonRoomResolution;
}) {
  const field = useFieldStore((state) => state.field);
  const resolve = useFieldStore((state) => state.resolveDungeonEffect);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const room = dungeonRoom(resolution.dungeonId, resolution.roomId);
  if (!room) return null;
  const local = field.multiplayer.registry.localParticipantId;
  const effect = room.effect;
  const creatures = field.groups.filter(
    (entry) => entry.zone === "battlefield" && entry.characteristics.isCreature,
  );
  const requiresCreature = effect.kind === "counters";
  const requiresPlayer =
    effect.kind === "life" && effect.audience === "target-player";
  const applyAvailable =
    effect.kind !== "manual" &&
    (effect.kind !== "token" || playerId === local) &&
    (effect.kind !== "life" ||
      effect.audience === "each-player" ||
      effect.audience === "target-player" ||
      playerId === local);
  return (
    <article className="dungeon-room-effect">
      <h4>{room.name}</h4>
      <p>{room.text}</p>
      {requiresCreature && (
        <label>
          Target Creature
          <select
            aria-label={`Target for ${room.name}`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose creature</option>
            {creatures.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {entry.quantity > 1 ? " (one from stack)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {requiresPlayer && (
        <label>
          Target Player
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose player</option>
            {dungeonPlayers(field).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {effect.kind === "life" &&
        (effect.audience === "each-player" ||
          effect.audience === "opponents-and-you") && (
          <small>
            Other players account for their life changes at the table.
          </small>
        )}
      <div className="dungeon-effect-actions">
        {applyAvailable && (
          <button
            className="primary-action"
            disabled={(requiresCreature || requiresPlayer) && !target}
            onClick={() =>
              setError(resolve(playerId, resolution.id, "apply", target))
            }
          >
            <WandSparkles /> Apply Effect
          </button>
        )}
        <button
          onClick={() => setError(resolve(playerId, resolution.id, "manual"))}
        >
          <Check /> Resolved at Table
        </button>
        <button
          className="quiet-action"
          onClick={() =>
            setError(resolve(playerId, resolution.id, "countered"))
          }
        >
          Countered / No Effect
        </button>
      </div>
      {error && <p role="status">{error}</p>}
    </article>
  );
}
