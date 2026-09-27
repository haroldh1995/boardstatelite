import { Minimize2, Minus, Plus, Shield } from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { summarizeTurnMemory } from "../turn";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { TurnContextBar } from "./TurnContextBar";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";

export function FullScreenLife() {
  const field = useFieldStore((state) => state.field);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const updateSettings = useFieldStore((state) => state.updateSettings);
  const openModal = useFieldStore((state) => state.openModal);
  const lifeAdjustment = useGroupedNumericAdjustment({
    value: field.player.life,
    minimum: 0,
    onCommit: (delta) => adjustLife(delta, delta >= 0 ? "gain" : "loss"),
  });
  const land = getLandPlayTurnStatus(field.preTurnPlanner);
  const memory = summarizeTurnMemory(field.turnContext);
  return (
    <main className="full-screen-life" aria-label="Full-screen life mode">
      <div className="full-life-toolbar">
        <TurnContextBar minimal />
        <button
          type="button"
          className="icon-button"
          onClick={() => updateSettings({ fullScreenLife: false })}
          aria-label="Return to battlefield"
        >
          <Minimize2 />
        </button>
      </div>
      <div className="full-life-center">
        <span className="full-life-label">Life</span>
        <strong>{lifeAdjustment.displayedValue}</strong>
        <span className="life-transaction-delta" aria-live="polite">
          {lifeAdjustment.displayedDelta === 0
            ? ""
            : `${lifeAdjustment.displayedDelta > 0 ? "+" : ""}${lifeAdjustment.displayedDelta}`}
        </span>
        <div className="full-life-adjusters">
          <HoldAdjustButton
            label="Lose life. Press and hold for continuous adjustment."
            step={-1}
            onStep={lifeAdjustment.adjust}
          >
            <Minus />
          </HoldAdjustButton>
          <HoldAdjustButton
            label="Gain life. Press and hold for continuous adjustment."
            step={1}
            onStep={lifeAdjustment.adjust}
          >
            <Plus />
          </HoldAdjustButton>
        </div>
      </div>
      <div className="full-life-attention">
        <button type="button" onClick={() => openModal({ kind: "landPlay" })}>
          Land {land.complete ? "OK" : `${land.marked}/${land.expected}`}
        </button>
        <button type="button" onClick={() => openModal({ kind: "turnMemory" })}>
          {memory.compactLabel}
        </button>
        <button
          type="button"
          onClick={() => openModal({ kind: "commanderDamage" })}
        >
          <Shield aria-hidden="true" /> Commander Damage
        </button>
      </div>
    </main>
  );
}
