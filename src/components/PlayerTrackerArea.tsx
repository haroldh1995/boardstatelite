import { SlidersHorizontal } from "lucide-react";
import {
  playerCounterValue,
  trackerDefinitions,
} from "../domain/playerTrackers";
import { useFieldStore } from "../state/useFieldStore";
import { NumericAdjuster } from "./NumericAdjuster";

export function PlayerTrackerControls({ all = false }: { all?: boolean }) {
  const preferences = useFieldStore(
    (state) => state.field.settings.playerTrackers,
  );
  const counters = useFieldStore((state) => state.field.player.counters);
  const adjust = useFieldStore((state) => state.adjustPlayerTracker);
  const definitions = trackerDefinitions(preferences);
  const ids = all ? definitions.map((entry) => entry.id) : preferences.visible;
  const controls = ids.map((id) => {
    const definition = definitions.find((entry) => entry.id === id);
    return definition ? (
      <NumericAdjuster
        key={id}
        label={definition.name}
        value={playerCounterValue(counters, id)}
        onCommit={(delta) => adjust(id, delta)}
      />
    ) : null;
  });
  return (
    <>
      <div className="player-tracker-grid">
        {all ? controls : controls.slice(0, 3)}
      </div>
      {!all && controls.length > 3 && (
        <details className="more-player-trackers">
          <summary>More Counters ({controls.length - 3})</summary>
          <div className="player-tracker-grid">{controls.slice(3)}</div>
        </details>
      )}
    </>
  );
}
export function PlayerTrackerArea() {
  const openModal = useFieldStore((state) => state.openModal);
  return (
    <section
      className="player-tracker-area"
      aria-label="Life screen player counters"
    >
      <div className="player-tracker-heading">
        <span>Player Counters</span>
        <button
          className="icon-button"
          title="Customize player counters"
          aria-label="Customize player counters"
          onClick={() => openModal({ kind: "trackerLayout" })}
        >
          <SlidersHorizontal />
        </button>
      </div>
      <PlayerTrackerControls />
    </section>
  );
}
