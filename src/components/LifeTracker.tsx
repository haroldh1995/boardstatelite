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
import { useEffect, useRef, useState } from "react";
import { useFieldStore } from "../state/useFieldStore";

export function LifeTracker() {
  const player = useFieldStore((state) => state.field.player);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const openModal = useFieldStore((state) => state.openModal);
  const undo = useFieldStore((state) => state.undo);
  const redo = useFieldStore((state) => state.redo);
  const [increment, setIncrement] = useState(1);
  const [expanded, setExpanded] = useState(false);

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
          onClick={() => openModal({ kind: "playerCounters" })}
        />
        <PlayerCounter
          icon={<Zap />}
          label="Energy"
          value={player.counters.energy}
          onClick={() => openModal({ kind: "playerCounters" })}
        />
      </div>

      <HoldButton
        label={`Lose ${increment} life`}
        className="life-adjust"
        onStep={() => adjustLife(-increment, "loss")}
      >
        <Minus />
      </HoldButton>

      <button
        type="button"
        className="life-total"
        onClick={() => openModal({ kind: "life" })}
        aria-label={`${player.life} tap to set life total`}
      >
        <strong>{player.life}</strong>
        <span>Tap to set life total</span>
      </button>

      <HoldButton
        label={`Gain ${increment} life`}
        className="life-adjust"
        onStep={() => adjustLife(increment, "gain")}
      >
        <Plus />
      </HoldButton>

      <div className="counter-column counter-column-right">
        <PlayerCounter
          icon={<Shield />}
          label="CMD Damage"
          value={player.counters.commanderDamage}
          onClick={() => openModal({ kind: "playerCounters" })}
        />
        <PlayerCounter
          icon={<Sparkles />}
          label="Experience"
          value={player.counters.experience}
          onClick={() => openModal({ kind: "playerCounters" })}
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="player-counter"
      aria-label={`${label}: ${value}. Open player counters`}
      onClick={onClick}
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

function HoldButton({
  label,
  className,
  onStep,
  children,
}: {
  label: string;
  className: string;
  onStep: () => void;
  children: React.ReactNode;
}) {
  const intervalRef = useRef<number | null>(null);
  const delayRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      if (delayRef.current) window.clearTimeout(delayRef.current);
    },
    [],
  );

  function start() {
    onStep();
    delayRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(onStep, 120);
    }, 420);
  }

  function stop() {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (delayRef.current) window.clearTimeout(delayRef.current);
    intervalRef.current = null;
    delayRef.current = null;
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {children}
    </button>
  );
}
