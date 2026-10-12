import { useState } from "react";
import { Flag, Plus, Castle } from "lucide-react";
import { DUNGEONS, dungeonById, dungeonRoom } from "../domain/dungeonCatalog";
import { availableDungeonRooms, type VentureKind } from "../domain/dungeons";
import { dungeonPlayers } from "../domain/dungeonPlayers";
import { useFieldStore } from "../state/useFieldStore";
import { DungeonMap } from "./DungeonMap";
import { DungeonRoomEffect } from "./DungeonRoomEffect";

export function DungeonSheet({
  initialPlayerId,
}: {
  initialPlayerId?: string;
}) {
  const field = useFieldStore((state) => state.field);
  const actions = useFieldStore();
  const local = field.multiplayer.registry.localParticipantId;
  const [playerId, setPlayerId] = useState(initialPlayerId ?? local);
  const [name, setName] = useState("");
  const [selection, setSelection] = useState(DUNGEONS[0].id);
  const [correctionDungeon, setCorrectionDungeon] = useState(DUNGEONS[0].id);
  const [correctionRoom, setCorrectionRoom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const players = dungeonPlayers(field);
  const state = field.externalGameState.dungeons;
  const player = state.players[playerId];
  const run = player?.active ?? null;
  const request = state.requests.find((entry) => entry.playerId === playerId);
  const activeDungeon = dungeonById(run?.dungeonId);
  const atFinal =
    run && dungeonRoom(run.dungeonId, run.currentRoomId)?.next.length === 0;
  const choosing = !run || Boolean(atFinal && request);
  const options = DUNGEONS.filter((entry) =>
    request?.kind === "undercity" ? entry.undercity : !entry.undercity,
  );
  const selected =
    options.find((entry) => entry.id === selection) ?? options[0];
  const dungeon = choosing ? selected : (activeDungeon ?? selected);
  const available = request
    ? choosing
      ? [dungeon.rooms[0].id]
      : availableDungeonRooms(state, playerId)
    : [];
  const venture = (kind: VentureKind) =>
    actions.requestDungeonVenture(playerId, kind);
  return (
    <div className="dungeon-sheet">
      <h2 id="modal-title">Dungeons &amp; Initiative</h2>
      <label>
        Player
        <select
          aria-label="Dungeon player"
          value={playerId}
          onChange={(event) => {
            setPlayerId(event.target.value);
            setError(null);
          }}
        >
          {players.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="initiative-panel">
        <p role="status">
          <Flag /> Initiative:{" "}
          <strong>
            {players.find(
              (entry) =>
                entry.id === field.externalGameState.initiativeHolderId,
            )?.name ?? "No holder"}
          </strong>
        </p>
        <button
          className="primary-action"
          onClick={() => actions.takeInitiative(playerId)}
        >
          Take Initiative
        </button>
        <details>
          <summary>Assign / Correct Holder</summary>
          <select
            aria-label="Initiative holder"
            value={field.externalGameState.initiativeHolderId ?? ""}
            onChange={(event) =>
              actions.setExternalHolder(
                "initiative",
                event.target.value || null,
              )
            }
          >
            <option value="">No holder</option>
            {players.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </details>
      </div>
      {field.turnContext.status === "active" &&
        playerId === local &&
        field.turnContext.step === "untap" && (
          <button onClick={() => actions.observeUpkeep(local)}>
            Begin Upkeep
          </button>
        )}
      <div className="dungeon-venture-actions">
        <button onClick={() => venture("dungeon")}>
          <Castle /> Venture into Dungeon
        </button>
        <button onClick={() => venture("undercity")}>
          Venture into Undercity
        </button>
      </div>
      <p role="status" className="dungeon-position">
        {run
          ? `Current room: ${dungeonRoom(run.dungeonId, run.currentRoomId)?.name}`
          : "No active dungeon"}
        {request
          ? ` / ${state.requests.filter((entry) => entry.playerId === playerId).length} venture pending`
          : ""}
      </p>
      {request && (
        <button
          className="quiet-action"
          onClick={() =>
            actions.resolveTurnTrigger(
              `dungeon-request:${request.id}`,
              "resolved",
            )
          }
        >
          Already Resolved at Table
        </button>
      )}
      {choosing && (
        <label>
          Dungeon
          <select
            aria-label="Choose dungeon"
            value={dungeon.id}
            onChange={(event) => setSelection(event.target.value)}
          >
            {options.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <h3 className="dungeon-map-title">{dungeon.name}</h3>
      <DungeonMap
        dungeon={dungeon}
        run={run?.dungeonId === dungeon.id ? run : null}
        available={available}
        onEnter={(roomId) => {
          setError(
            actions.moveDungeon({
              playerId,
              dungeonId: dungeon.id,
              roomId,
              kind: request?.kind ?? "dungeon",
              requestId: request?.id,
            }),
          );
        }}
      />
      {error && <p role="alert">{error}</p>}
      {player?.effects.some((entry) => entry.status === "pending") && (
        <section className="dungeon-pending">
          <h3>Room Abilities</h3>
          {player.effects
            .filter((entry) => entry.status === "pending")
            .map((entry) => (
              <DungeonRoomEffect
                key={entry.id}
                playerId={playerId}
                resolution={entry}
              />
            ))}
        </section>
      )}
      <details className="dungeon-history">
        <summary>Journey / Completed ({player?.completed.length ?? 0})</summary>
        {[...(player?.completed ?? []), ...(run ? [run] : [])].map(
          (journey) => (
            <section key={journey.id}>
              <h4>
                {dungeonById(journey.dungeonId)?.name}{" "}
                {journey.completedAt ? "/ Completed" : "/ In progress"}
              </h4>
              <ol>
                {journey.visits.map((visit) => (
                  <li key={visit.id}>
                    {dungeonRoom(journey.dungeonId, visit.roomId)?.name}
                    {visit.correction ? " (correction)" : ""}
                  </li>
                ))}
              </ol>
            </section>
          ),
        )}
      </details>
      <details className="dungeon-correction">
        <summary>Correct Position</summary>
        <label>
          Dungeon
          <select
            aria-label="Correct dungeon"
            value={correctionDungeon}
            onChange={(event) => {
              setCorrectionDungeon(event.target.value);
              setCorrectionRoom("");
            }}
          >
            {DUNGEONS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Room
          <select
            aria-label="Correct room"
            value={correctionRoom}
            onChange={(event) => setCorrectionRoom(event.target.value)}
          >
            <option value="">Choose room</option>
            {dungeonById(correctionDungeon)?.rooms.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!correctionRoom}
          onClick={() =>
            setError(
              actions.moveDungeon({
                playerId,
                dungeonId: correctionDungeon,
                roomId: correctionRoom,
                kind: "dungeon",
                correction: true,
              }),
            )
          }
        >
          Correct Room Only
        </button>
        {run && (
          <>
            <button
              onClick={() => actions.clearDungeonPosition(playerId, false)}
            >
              Clear Active Dungeon
            </button>
            <button
              onClick={() => actions.clearDungeonPosition(playerId, true)}
            >
              Record Already Completed
            </button>
          </>
        )}
      </details>
      <details>
        <summary>Add Table Player</summary>
        <form
          className="tracker-save-row"
          onSubmit={(event) => {
            event.preventDefault();
            const id = actions.addDungeonPlayer(name);
            if (id) {
              setPlayerId(id);
              setName("");
            }
          }}
        >
          <label>
            Player Name
            <input
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim()}
            aria-label="Add table player"
          >
            <Plus />
          </button>
        </form>
      </details>
    </div>
  );
}
