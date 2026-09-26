import { Minimize2, Minus, Plus, Shield } from "lucide-react";
import { useState } from "react";
import { useFieldStore } from "../state/useFieldStore";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { summarizeTurnMemory } from "../turn";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { TurnContextBar } from "./TurnContextBar";

export function FullScreenLife() {
  const field = useFieldStore((state) => state.field);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const updateSettings = useFieldStore((state) => state.updateSettings);
  const openModal = useFieldStore((state) => state.openModal);
  const [pendingDelta, setPendingDelta] = useState(0);
  const land = getLandPlayTurnStatus(field.preTurnPlanner);
  const memory = summarizeTurnMemory(field.turnContext);
  const displayedLife = Math.max(0, field.player.life + pendingDelta);
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
        <strong>{displayedLife}</strong>
        <span className="life-transaction-delta" aria-live="polite">
          {pendingDelta === 0
            ? ""
            : `${pendingDelta > 0 ? "+" : ""}${pendingDelta}`}
        </span>
        <div className="full-life-adjusters">
          <HoldAdjustButton
            label="Lose life. Press and hold for continuous adjustment."
            step={-1}
            onPreview={setPendingDelta}
            onCommit={(delta) => adjustLife(delta, "loss")}
          >
            <Minus />
          </HoldAdjustButton>
          <HoldAdjustButton
            label="Gain life. Press and hold for continuous adjustment."
            step={1}
            onPreview={setPendingDelta}
            onCommit={(delta) => adjustLife(delta, "gain")}
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
