import { Check, ChevronRight, Clock3, Sparkles } from "lucide-react";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { quickPhaseLabel, summarizeTurnMemory } from "../turn";
import type { TurnQuickPhase } from "../turn/types";
import { useFieldStore } from "../state/useFieldStore";

const PHASES: Array<{ value: TurnQuickPhase; label: string }> = [
  { value: "beginning", label: "Start" },
  { value: "precombat-main", label: "Main" },
  { value: "combat", label: "Combat" },
  { value: "postcombat-main", label: "Main 2" },
  { value: "ending", label: "End" },
];

export function TurnContextBar({ minimal = false }: { minimal?: boolean }) {
  const context = useFieldStore((state) => state.field.turnContext);
  const planner = useFieldStore((state) => state.field.preTurnPlanner);
  const startTurn = useFieldStore((state) => state.startTurn);
  const endTurn = useFieldStore((state) => state.endTurn);
  const setTurnPhase = useFieldStore((state) => state.setTurnPhase);
  const advance = useFieldStore((state) => state.advanceTurnPhase);
  const openModal = useFieldStore((state) => state.openModal);
  const memory = summarizeTurnMemory(context);
  const land = getLandPlayTurnStatus(planner);

  if (context.status === "between-turns") {
    return (
      <section
        className="turn-context between-turns"
        aria-label="Between turns"
      >
        <span>
          <Clock3 aria-hidden="true" /> Between turns
        </span>
        {memory.possibleMissed > 0 && (
          <button
            type="button"
            className="turn-review-button"
            onClick={() => openModal({ kind: "turnMemory" })}
          >
            Review {memory.possibleMissed} possible missed
          </button>
        )}
        <button type="button" className="primary-action" onClick={startTurn}>
          Start Turn
        </button>
      </section>
    );
  }

  return (
    <section className={minimal ? "turn-context minimal" : "turn-context"}>
      <button
        type="button"
        className="turn-memory-button"
        onClick={() => openModal({ kind: "turnMemory" })}
        aria-label={`${memory.compactLabel}. ${memory.pending} pending triggers and ${memory.possibleMissed} possible missed triggers.`}
      >
        {memory.complete ? (
          <Check aria-hidden="true" />
        ) : (
          <Sparkles aria-hidden="true" />
        )}
        <span>{memory.compactLabel}</span>
      </button>
      {minimal ? (
        <button type="button" className="phase-advance" onClick={advance}>
          {quickPhaseLabel(context.quickPhase)}{" "}
          <ChevronRight aria-hidden="true" />
        </button>
      ) : (
        <div className="phase-segments" aria-label="Turn phase">
          {PHASES.map((phase) => (
            <button
              type="button"
              key={phase.value}
              className={context.quickPhase === phase.value ? "selected" : ""}
              aria-pressed={context.quickPhase === phase.value}
              onClick={() => setTurnPhase(phase.value)}
            >
              {phase.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={land.complete ? "turn-land complete" : "turn-land"}
        onClick={() => openModal({ kind: "landPlay" })}
        aria-label={land.accessibilityLabel}
      >
        Land {land.complete ? "OK" : `${land.marked}/${land.expected}`}
      </button>
      {!minimal && (
        <button type="button" className="end-turn-button" onClick={endTurn}>
          End Turn
        </button>
      )}
    </section>
  );
}
