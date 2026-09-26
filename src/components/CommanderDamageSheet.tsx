import { AlertTriangle, Minus, Plus, Shield, UserPlus } from "lucide-react";
import { useState } from "react";
import { useFieldStore } from "../state/useFieldStore";
import { HoldAdjustButton } from "./HoldAdjustButton";

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
          <article
            key={entry.id}
            className={
              entry.damage >= 21
                ? "commander-damage-row lethal-threshold"
                : "commander-damage-row"
            }
          >
            <span className="commander-avatar" aria-hidden="true">
              {entry.imageUrl ? (
                <img src={entry.imageUrl} alt="" />
              ) : (
                <Shield />
              )}
            </span>
            <span className="commander-damage-copy">
              <small>{entry.playerLabel}</small>
              <strong>{entry.commanderLabel}</strong>
              {entry.damage >= 21 && (
                <em>
                  <AlertTriangle /> 21 threshold reached
                </em>
              )}
            </span>
            <div
              className="direct-adjust"
              aria-label={`${entry.commanderLabel} damage ${entry.damage}`}
            >
              <HoldAdjustButton
                label={`Decrease damage from ${entry.commanderLabel}`}
                step={-1}
                onCommit={(delta) => adjust(entry.id, delta, "damage-only")}
              >
                <Minus />
              </HoldAdjustButton>
              <strong>{entry.damage}</strong>
              <HoldAdjustButton
                label={`Increase damage from ${entry.commanderLabel}`}
                step={1}
                onCommit={(delta) => adjust(entry.id, delta, mode)}
              >
                <Plus />
              </HoldAdjustButton>
            </div>
          </article>
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
