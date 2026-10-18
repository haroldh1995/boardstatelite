import { Check, Clock3, Sparkles } from "lucide-react";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { summarizeTurnMemory } from "../turn";
import { useFieldStore } from "../state/useFieldStore";
import { QuickUndo } from "./QuickUndo";

export function TurnContextBar({ minimal = false }: { minimal?: boolean }) {
  const field = useFieldStore((state) => state.field);
  const startTurn = useFieldStore((state) => state.startTurn);
  const endTurn = useFieldStore((state) => state.endTurn);
  const openModal = useFieldStore((state) => state.openModal);
  const memory = summarizeTurnMemory(field.turnContext);
  const land = getLandPlayTurnStatus(field.preTurnPlanner);
  const active = field.turnContext.status === "active";
  return (
    <section
      className={minimal ? "turn-context minimal" : "turn-context"}
      aria-label={active ? "Your turn" : "Between turns"}
    >
      <span>
        {active ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
        {active ? `Turn ${field.turnContext.turnNumber}` : "Between turns"}
      </span>
      <button
        className="turn-memory-button"
        onClick={() => openModal({ kind: "turnMemory" })}
        aria-label={`Turn Memory. ${memory.pending} pending and ${memory.possibleMissed} possible missed.`}
      >
        {memory.complete ? (
          <Check aria-hidden="true" />
        ) : (
          <Sparkles aria-hidden="true" />
        )}
        <span>{memory.compactLabel}</span>
      </button>
      {active && (
        <button
          className={land.complete ? "turn-land complete" : "turn-land"}
          onClick={() => openModal({ kind: "landPlay" })}
          aria-label={land.accessibilityLabel}
        >
          Land {land.marked}/{land.expected}
          {land.complete ? " ✓" : ""}
        </button>
      )}
      {!minimal && (
        <div className="turn-end-actions">
          <QuickUndo />
          <button
            className="end-turn-button"
            onClick={active ? endTurn : startTurn}
          >
            {active ? "End Turn" : "Start Turn"}
          </button>
        </div>
      )}
    </section>
  );
}
