import { AlertTriangle, Minus, Plus, Shield, UserPlus } from "lucide-react";
import { useState } from "react";
import type { CommanderDamageEntry } from "../domain/commanderDamage";
import { useFieldStore } from "../state/useFieldStore";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";

export function CommanderDamageSheet() {
  const state = useFieldStore((store) => store.field.commanderDamage);
  const addSource = useFieldStore((store) => store.addCommanderDamageSource);
  const adjust = useFieldStore((store) => store.adjustCommanderDamage);
  const [playerLabel, setPlayerLabel] = useState("Opponent");
  const [commanderLabel, setCommanderLabel] = useState("Commander");
  const [mode, setMode] = useState<"combat" | "damage-only">("combat");
  return (
    <div className="commander-damage-sheet">
      <h2 id="modal-title">Commander Damage</h2>
      <div className="segmented">
        <button
          type="button"
          className={mode === "combat" ? "selected" : ""}
          onClick={() => setMode("combat")}
        >
          Record Combat Damage
        </button>
        <button
          type="button"
          className={mode === "damage-only" ? "selected" : ""}
          onClick={() => setMode("damage-only")}
        >
          Commander Damage Only
        </button>
      </div>
      <p className="sheet-intro">
        {mode === "combat"
          ? "New commander combat damage changes both commander damage and life in one transaction."
          : "Correction changes commander damage history without changing life."}
      </p>
      <div className="commander-damage-list">
        {state.entries.map((entry) => (
          <CommanderDamageRow
            key={entry.id}
            entry={entry}
            mode={mode}
            onAdjust={adjust}
          />
        ))}
      </div>
      <section className="add-commander-source">
        <h3>Add Commander</h3>
        <div className="numeric-pair">
          <label>
            Player
            <input
              value={playerLabel}
              onChange={(event) => setPlayerLabel(event.target.value)}
            />
          </label>
          <label>
            Commander
            <input
              value={commanderLabel}
              onChange={(event) => setCommanderLabel(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => addSource(playerLabel, commanderLabel)}
        >
          <UserPlus /> Add Commander
        </button>
      </section>
    </div>
  );
}

function CommanderDamageRow({
  entry,
  mode,
  onAdjust,
}: {
  entry: CommanderDamageEntry;
  mode: "combat" | "damage-only";
  onAdjust: (id: string, delta: number, mode: "combat" | "damage-only") => void;
}) {
  const adjustment = useGroupedNumericAdjustment({
    value: entry.damage,
    minimum: 0,
    maximum: 999,
    onCommit: (delta) =>
      onAdjust(entry.id, delta, delta > 0 ? mode : "damage-only"),
  });
  return (
    <article
      className={
        adjustment.displayedValue >= 21
          ? "commander-damage-row lethal-threshold"
          : "commander-damage-row"
      }
    >
      <span className="commander-avatar" aria-hidden="true">
        {entry.imageUrl ? <img src={entry.imageUrl} alt="" /> : <Shield />}
      </span>
      <span className="commander-damage-copy">
        <small>{entry.playerLabel}</small>
        <strong>{entry.commanderLabel}</strong>
        {adjustment.displayedValue >= 21 && (
          <em>
            <AlertTriangle /> 21 threshold reached
          </em>
        )}
      </span>
      <div
        className="direct-adjust"
        aria-label={`${entry.commanderLabel} damage ${adjustment.displayedValue}`}
      >
        <HoldAdjustButton
          label={`Decrease damage from ${entry.commanderLabel}`}
          step={-1}
          onStep={adjustment.adjust}
        >
          <Minus />
        </HoldAdjustButton>
        <strong>{adjustment.displayedValue}</strong>
        <HoldAdjustButton
          label={`Increase damage from ${entry.commanderLabel}`}
          step={1}
          onStep={adjustment.adjust}
        >
          <Plus />
        </HoldAdjustButton>
      </div>
      <span className="life-transaction-delta" aria-live="polite">
        {adjustment.displayedDelta === 0
          ? ""
          : `${adjustment.displayedDelta > 0 ? "+" : ""}${adjustment.displayedDelta}`}
      </span>
    </article>
  );
}
