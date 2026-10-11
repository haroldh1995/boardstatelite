import {
  BatteryCharging,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crown,
  Minus,
  Plus,
  Radiation,
  Shield,
  Skull,
  Sparkles,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { usePressLifetime } from "./usePressLifetime";
import { useFieldStore } from "../state/useFieldStore";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";

export function LifeTracker() {
  const player = useFieldStore((state) => state.field.player);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const openModal = useFieldStore((state) => state.openModal);
  const undo = useFieldStore((state) => state.undo);
  const redo = useFieldStore((state) => state.redo);
  const [increment, setIncrement] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const holdTimeout = useRef<number | null>(null);
  const press = usePressLifetime(
    () => {
      holdTimeout.current = window.setTimeout(
        () => openModal({ kind: "playerCounters" }),
        520,
      );
    },
    () => {
      if (holdTimeout.current !== null)
        window.clearTimeout(holdTimeout.current);
      holdTimeout.current = null;
    },
  );
  const lifeAdjustment = useGroupedNumericAdjustment({
    value: player.life,
    minimum: 0,
    onCommit: (delta) => adjustLife(delta, delta >= 0 ? "gain" : "loss"),
  });

  return (
    <section
      className="life-panel"
      aria-label="Personal life tracker"
      onContextMenu={(event) => event.preventDefault()}
      {...press}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        press.onPointerDown(event);
      }}
    >
      <div className="counter-column counter-column-left">
        <PlayerCounter
          icon={<Skull />}
          label="Poison"
          value={player.counters.poison}
          onOpen={() => openModal({ kind: "playerCounters" })}
        />
        <PlayerCounter
          icon={<Zap />}
          label="Energy"
          value={player.counters.energy}
          onOpen={() => openModal({ kind: "playerCounters" })}
        />
      </div>

      <HoldAdjustButton
        label={`Lose ${increment} life`}
        className="life-adjust"
        step={-increment}
        onStep={lifeAdjustment.adjust}
      >
        <Minus />
      </HoldAdjustButton>

      <button
        type="button"
        className="life-total"
        onClick={() => openModal({ kind: "life" })}
        aria-label={`${lifeAdjustment.displayedValue} tap to set life total`}
      >
        <strong>{lifeAdjustment.displayedValue}</strong>
        <span>
          {lifeAdjustment.displayedDelta === 0
            ? "Tap to set life total"
            : `${lifeAdjustment.displayedDelta > 0 ? "+" : ""}${lifeAdjustment.displayedDelta}`}
        </span>
      </button>

      <HoldAdjustButton
        label={`Gain ${increment} life`}
        className="life-adjust"
        step={increment}
        onStep={lifeAdjustment.adjust}
      >
        <Plus />
      </HoldAdjustButton>

      <div className="counter-column counter-column-right">
        <PlayerCounter
          icon={<Shield />}
          label="CMD Damage"
          value={player.counters.commanderDamage}
          onOpen={() => openModal({ kind: "commanderDamage" })}
        />
        <PlayerCounter
          icon={<Sparkles />}
          label="Experience"
          value={player.counters.experience}
          onOpen={() => openModal({ kind: "playerCounters" })}
        />
      </div>

      <button
        type="button"
        className="life-expand"
        aria-label={
          expanded ? "Collapse life controls" : "Expand life controls"
        }
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronUp /> : <ChevronDown />}
      </button>

      <div
        className={expanded ? "quick-row expanded" : "quick-row"}
        aria-label="Life quick controls"
      >
        {[1, 5, 10].map((value) => (
          <button
            type="button"
            key={value}
            className={value === increment ? "selected" : ""}
            onClick={() => setIncrement(value)}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            lifeAdjustment.finish();
            undo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => {
            lifeAdjustment.finish();
            redo();
          }}
        >
          Redo
        </button>
        <span className="status-flags" aria-label="Player status flags">
          {player.statuses.monarch && <Crown aria-label="Monarch" />}
          {player.counters.rad > 0 && <Radiation aria-label="Rad counters" />}
          <BatteryCharging aria-label="Energy tracking enabled" />
        </span>
      </div>
    </section>
  );
}

function PlayerCounter({
  icon,
  label,
  value,
  onOpen,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="player-counter"
      aria-label={`${label}: ${value}. Tap to edit`}
      onClick={onOpen}
    >
      <span aria-hidden="true">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <ChevronRight aria-hidden="true" className="counter-chevron" />
    </button>
  );
}
