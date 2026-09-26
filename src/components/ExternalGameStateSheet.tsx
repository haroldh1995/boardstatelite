import { Castle, Crown, DoorOpen, Orbit, Shield, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ExternalSourceObject } from "../domain/externalGameState";
import { useFieldStore } from "../state/useFieldStore";

export function ExternalGameStateSheet() {
  const state = useFieldStore((store) => store.field.externalGameState);
  const localParticipantId = useFieldStore(
    (store) => store.field.multiplayer.registry.localParticipantId,
  );
  const addSource = useFieldStore((store) => store.addExternalSource);
  const removeSource = useFieldStore((store) => store.removeExternalSource);
  const setHolder = useFieldStore((store) => store.setExternalHolder);
  const setDayNight = useFieldStore((store) => store.setDayNight);
  const setCitysBlessing = useFieldStore((store) => store.setCitysBlessing);
  const setArchenemyParticipant = useFieldStore(
    (store) => store.setArchenemyParticipant,
  );
  const progressDungeon = useFieldStore((store) => store.progressDungeon);
  const setPlane = useFieldStore((store) => store.setPlane);
  const setScheme = useFieldStore((store) => store.setScheme);
  const rollPlanarDie = useFieldStore((store) => store.rollPlanarDie);
  const [sourceKind, setSourceKind] =
    useState<ExternalSourceObject["kind"]>("emblem");
  const [name, setName] = useState("");
  const [dungeonName, setDungeonName] = useState("Undercity");
  const [roomName, setRoomName] = useState("Secret Entrance");

  return (
    <div className="external-state-sheet">
      <h2 id="modal-title">External Game State</h2>
      <div className="external-state-quick">
        <button
          type="button"
          className={
            state.initiativeHolderId === localParticipantId ? "selected" : ""
          }
          onClick={() =>
            setHolder(
              "initiative",
              state.initiativeHolderId === localParticipantId
                ? null
                : localParticipantId,
            )
          }
        >
          <Shield /> Initiative
        </button>
        <button
          type="button"
          className={
            state.monarchHolderId === localParticipantId ? "selected" : ""
          }
          onClick={() =>
            setHolder(
              "monarch",
              state.monarchHolderId === localParticipantId
                ? null
                : localParticipantId,
            )
          }
        >
          <Crown /> Monarch
        </button>
      </div>
      <section>
        <h3>Table State</h3>
        <label>
          Day / Night
          <select
            value={state.dayNight}
            onChange={(event) =>
              setDayNight(event.target.value as "off" | "day" | "night")
            }
          >
            <option value="off">Not active</option>
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </label>
        <button
          type="button"
          className={
            state.citysBlessingParticipantIds.includes(localParticipantId)
              ? "selected"
              : ""
          }
          onClick={() =>
            setCitysBlessing(
              localParticipantId,
              !state.citysBlessingParticipantIds.includes(localParticipantId),
            )
          }
        >
          City's Blessing
        </button>
      </section>
      <section>
        <h3>Dungeons &amp; Initiative</h3>
        <div className="numeric-pair">
          <label>
            Dungeon
            <input
              value={dungeonName}
              onChange={(event) => setDungeonName(event.target.value)}
            />
          </label>
          <label>
            Room
            <input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() =>
            progressDungeon({
              dungeonId: dungeonName.toLowerCase().replaceAll(" ", "-"),
              dungeonName,
              roomId: roomName.toLowerCase().replaceAll(" ", "-"),
              roomName,
            })
          }
        >
          <DoorOpen /> Record Room
        </button>
        {state.dungeon.currentRoomName && (
          <p className="external-current">
            {state.dungeon.dungeonName}: {state.dungeon.currentRoomName}
          </p>
        )}
      </section>
      <section>
        <h3>Planechase</h3>
        <label>
          Current Plane
          <input
            placeholder="Plane name"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                setPlane(event.currentTarget.value.trim());
                event.currentTarget.value = "";
              }
            }}
          />
        </label>
        <button type="button" onClick={rollPlanarDie}>
          <Orbit /> Roll Planar Die
        </button>
        {state.planechase.lastResult && (
          <strong className="randomizer-inline-result">
            {state.planechase.lastResult === "blank"
              ? "Blank"
              : state.planechase.lastResult === "chaos"
                ? "Chaos"
                : "Planeswalk"}
          </strong>
        )}
      </section>
      <section>
        <h3>Archenemy</h3>
        <button
          type="button"
          className={
            state.archenemy.archenemyParticipantId === localParticipantId
              ? "selected"
              : ""
          }
          onClick={() =>
            setArchenemyParticipant(
              state.archenemy.archenemyParticipantId === localParticipantId
                ? null
                : localParticipantId,
            )
          }
        >
          <Shield /> I am the Archenemy
        </button>
        <label>
          Scheme
          <input
            placeholder="Scheme name"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                setScheme(event.currentTarget.value.trim(), false);
                event.currentTarget.value = "";
              }
            }}
          />
        </label>
        <label>
          Ongoing Scheme
          <input
            placeholder="Ongoing scheme name"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                setScheme(event.currentTarget.value.trim(), true);
                event.currentTarget.value = "";
              }
            }}
          />
        </label>
      </section>
      <section>
        <h3>Add External Source</h3>
        <label>
          Type
          <select
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(event.target.value as ExternalSourceObject["kind"])
            }
          >
            <option value="emblem">Emblem</option>
            <option value="phenomenon">Phenomenon</option>
            <option value="custom">Custom Table Effect</option>
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={!name.trim()}
          onClick={() => {
            addSource({
              kind: sourceKind,
              name: name.trim(),
              imageUrl: null,
              public: true,
              sourceCardName: null,
            });
            setName("");
          }}
        >
          <Castle /> Add Source
        </button>
      </section>
      <div className="external-source-list">
        {state.sources.map((source) => (
          <article key={source.id}>
            <span>
              <strong>{source.name}</strong>
              <small>{source.kind.replaceAll("-", " ")}</small>
            </span>
            <button
              type="button"
              className="icon-button danger-action"
              onClick={() => removeSource(source.id)}
              aria-label={`Remove ${source.name}`}
            >
              <Trash2 />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
