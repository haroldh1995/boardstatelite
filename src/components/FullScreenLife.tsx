import { Minus, Plus, Shield, Settings, Wrench, Layers } from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { summarizeTurnMemory } from "../turn";
import { HoldAdjustButton } from "./HoldAdjustButton";
import { TurnContextBar } from "./TurnContextBar";
import { useGroupedNumericAdjustment } from "./useGroupedNumericAdjustment";
import { BattlefieldLandCount } from "./BattlefieldLandCount";
import { QuickUndo } from "./QuickUndo";
import { GameplayReminderBanner } from "./GameplayReminderBanner";

export function FullScreenLife() {
  const field = useFieldStore((state) => state.field);
  const adjustLife = useFieldStore((state) => state.adjustLife);
  const startTurn = useFieldStore((state) => state.startTurn);
  const endTurn = useFieldStore((state) => state.endTurn);
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
          onClick={() => openModal({ kind: "userTools" })}
          aria-label="User Tools"
        >
          <Wrench />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => openModal({ kind: "settings" })}
          aria-label="Options"
        >
          <Settings />
        </button>
      </div>
      <div className="full-life-center">
        <span className="full-life-label">Life</span>
        <strong
          style={{
            fontSize:
              String(lifeAdjustment.displayedValue).length > 3
                ? "4.5rem"
                : undefined,
          }}
        >
          {lifeAdjustment.displayedValue}
        </strong>
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
      <div className="full-life-resources">
        <BattlefieldLandCount />
        <button
          type="button"
          className="quiet-action"
          onClick={() => openModal({ kind: "playerCounters" })}
        >
          <Layers aria-hidden="true" /> Player Counters
          {field.player.counters.poison > 0
            ? ` / Poison ${field.player.counters.poison}`
            : ""}
        </button>
        {!memory.complete && (
          <button
            type="button"
            className="quiet-action"
            onClick={() => openModal({ kind: "turnMemory" })}
          >
            Review {memory.pending + memory.possibleMissed}
          </button>
        )}
        <QuickUndo />
      </div>
      <GameplayReminderBanner />
      <div className="full-life-attention">
        <button type="button" onClick={() => openModal({ kind: "landPlay" })}>
          Land {land.marked}/{land.expected}
          {land.complete ? " ✓" : ""}
        </button>
        <button
          type="button"
          onClick={field.turnContext.status === "active" ? endTurn : startTurn}
        >
          {field.turnContext.status === "active" ? "End Turn" : "Start Turn"}
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
