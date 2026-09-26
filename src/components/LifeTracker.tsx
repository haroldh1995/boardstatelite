import {
  BatteryCharging,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crown,
  Minus,
  Maximize2,
  Plus,
  Radiation,
  Shield,
  Skull,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useFieldStore } from "../state/useFieldStore";
import { HoldAdjustButton } from "./HoldAdjustButton";

export function LifeTracker() {
  const player = useFieldStore((state) => state.field.player);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const openModal = useFieldStore((state) => state.openModal);
  const undo = useFieldStore((state) => state.undo);
  const redo = useFieldStore((state) => state.redo);
  const updateSettings = useFieldStore((state) => state.updateSettings);
  const [increment, setIncrement] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [pendingDelta, setPendingDelta] = useState(0);

  return (
    <section
      className="life-panel"
      aria-label="Personal life tracker"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        const timeout = window.setTimeout(
          () => openModal({ kind: "playerCounters" }),
          520,
        );
        const clear = () => window.clearTimeout(timeout);
        event.currentTarget.addEventListener("pointerup", clear, {
          once: true,
        });
        event.currentTarget.addEventListener("pointerleave", clear, {
          once: true,
        });
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
        onPreview={setPendingDelta}
        onCommit={(delta) => adjustLife(delta, "loss")}
      >
        <Minus />
      </HoldAdjustButton>

      <button
        type="button"
        className="life-total"
        onClick={() => openModal({ kind: "life" })}
        aria-label={`${Math.max(0, player.life + pendingDelta)} tap to set life total`}
      >
        <strong>{Math.max(0, player.life + pendingDelta)}</strong>
        <span>
          {pendingDelta === 0
            ? "Tap to set life total"
            : `${pendingDelta > 0 ? "+" : ""}${pendingDelta}`}
        </span>
      </button>

      <button
        type="button"
        className="life-fullscreen"
        aria-label="Open full-screen life"
        onClick={() => updateSettings({ fullScreenLife: true })}
      >
        <Maximize2 />
      </button>

      <HoldAdjustButton
        label={`Gain ${increment} life`}
        className="life-adjust"
        step={increment}
        onPreview={setPendingDelta}
        onCommit={(delta) => adjustLife(delta, "gain")}
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
        <button type="button" onClick={undo}>
          Undo
        </button>
        <button type="button" onClick={redo}>
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
