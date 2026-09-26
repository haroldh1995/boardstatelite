import { Check, Eye, X } from "lucide-react";
import { getLandPlayTurnStatus } from "../echo/preTurnPlanner";
import { quickPhaseLabel, summarizeTurnMemory } from "../turn";
import { useFieldStore } from "../state/useFieldStore";

export function TurnMemorySheet() {
  const field = useFieldStore((state) => state.field);
  const resolveTrigger = useFieldStore((state) => state.resolveTurnTrigger);
  const openModal = useFieldStore((state) => state.openModal);
  const memory = summarizeTurnMemory(field.turnContext);
  const land = getLandPlayTurnStatus(field.preTurnPlanner);
  return (
    <div className="turn-memory-sheet">
      <h2 id="modal-title">Turn Memory</h2>
      <div className="turn-memory-summary">
        <strong>{memory.compactLabel}</strong>
        <span>{quickPhaseLabel(field.turnContext.quickPhase)}</span>
        <span>{land.complete ? "Land accounted" : "Land not marked"}</span>
        <span>
          {field.turnContext.combatAccounted
            ? "Combat accounted"
            : "Combat not marked"}
        </span>
      </div>
      <div className="trigger-memory-list">
        {field.turnContext.triggerMemory.length === 0 && (
          <p className="empty-copy">Nothing needs attention.</p>
        )}
        {field.turnContext.triggerMemory.map((trigger) => (
          <article
            key={trigger.id}
            className={`trigger-memory ${trigger.status}`}
          >
            <span>
              <strong>{trigger.label}</strong>
              <small>
                {trigger.sourceLabel} · {trigger.status.replaceAll("-", " ")}
              </small>
            </span>
            {(trigger.status === "pending" ||
              trigger.status === "possible-missed") && (
              <div>
                <button
                  type="button"
                  onClick={() => resolveTrigger(trigger.id, "resolved")}
                >
                  <Check /> Resolved
                </button>
                {trigger.optional && trigger.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => resolveTrigger(trigger.id, "declined")}
                  >
                    <X /> Declined
                  </button>
                )}
                {trigger.status === "pending" && (
                  <button
                    type="button"
                    onClick={() =>
                      resolveTrigger(trigger.id, "possible-missed")
                    }
                  >
                    <Eye /> Review
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {!land.complete && (
        <button type="button" onClick={() => openModal({ kind: "landPlay" })}>
          Mark Land Play
        </button>
      )}
    </div>
  );
}
