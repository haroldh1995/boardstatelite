import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  actionStripKindLabel,
  sortActionStripItems,
} from "../echo/activeTurnActionStrip";
import type {
  ActiveTurnActionStatus,
  ActiveTurnActionStripItem,
} from "../echo/activeTurnActionStripTypes";
import { useFieldStore } from "../state/useFieldStore";

export function ActiveTurnActionStrip() {
  const strip = useFieldStore((state) => state.field.activeTurnActionStrip);
  const runItem = useFieldStore((state) => state.actionStripSelectItem);
  const setStatus = useFieldStore((state) => state.actionStripSetItemStatus);
  const reorder = useFieldStore((state) => state.actionStripReorderItem);
  const clearCompleted = useFieldStore(
    (state) => state.actionStripClearCompleted,
  );
  const setExpanded = useFieldStore((state) => state.actionStripSetExpanded);
  const setCompletedCollapsed = useFieldStore(
    (state) => state.actionStripSetCompletedCollapsed,
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const sorted = useMemo(
    () => sortActionStripItems(strip.items),
    [strip.items],
  );
  const visibleItems = strip.completedCollapsed
    ? sorted.filter((item) => !isTerminal(item.status))
    : sorted;
  const current = sorted.find((item) => item.status === "current") ?? null;

  if (strip.visibility === "hidden" || strip.items.length === 0) return null;

  function dropOn(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const from = sorted.findIndex((item) => item.id === draggedId);
    const to = sorted.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const direction = to > from ? 1 : -1;
    for (let step = 0; step < Math.abs(to - from); step += 1) {
      reorder(draggedId, direction);
    }
    setDraggedId(null);
  }

  return (
    <section
      className={`action-strip action-strip-${strip.visibility}`}
      aria-label="Active turn action strip"
    >
      <div className="action-strip-header">
        <div>
          <strong>{headerTitle(strip.visibility)}</strong>
          <span>{headerCopy(strip.visibility)}</span>
        </div>
        <button
          type="button"
          aria-label={
            strip.expanded ? "Collapse action strip" : "Expand action strip"
          }
          onClick={() => setExpanded(!strip.expanded)}
        >
          {strip.expanded ? <ChevronUp /> : <ChevronDown />}
        </button>
      </div>
      {strip.lastFailureReason && (
        <p className="action-strip-warning" role="status">
          {strip.lastFailureReason}
        </p>
      )}
      {strip.expanded && (
        <>
          {current && (
            <button
              type="button"
              className="action-strip-current"
              disabled={!canRunItem(current, strip.visibility)}
              onClick={() => runItem(current.id)}
            >
              <span>{current.label}</span>
              <small>
                {current.detail || actionStripKindLabel(current.kind)}
              </small>
            </button>
          )}
          <div className="action-strip-toolbar">
            <button
              type="button"
              onClick={() => setCompletedCollapsed(!strip.completedCollapsed)}
            >
              {strip.completedCollapsed ? "Show completed" : "Hide completed"}
            </button>
            <button type="button" onClick={clearCompleted}>
              Clear completed
            </button>
          </div>
          <div className="action-strip-list" role="list">
            {visibleItems.map((item, index) => (
              <ActionStripItemCard
                key={item.id}
                item={item}
                index={index}
                total={visibleItems.length}
                disabled={!canRunItem(item, strip.visibility)}
                onRun={runItem}
                onStatus={setStatus}
                onMove={reorder}
                onDragStart={setDraggedId}
                onDropOn={dropOn}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ActionStripItemCard({
  item,
  index,
  total,
  disabled,
  onRun,
  onStatus,
  onMove,
  onDragStart,
  onDropOn,
}: {
  item: ActiveTurnActionStripItem;
  index: number;
  total: number;
  disabled: boolean;
  onRun: (itemId: string) => void;
  onStatus: (itemId: string, status: ActiveTurnActionStatus) => void;
  onMove: (itemId: string, direction: -1 | 1) => void;
  onDragStart: (itemId: string) => void;
  onDropOn: (itemId: string) => void;
}) {
  const terminal = isTerminal(item.status);
  return (
    <article
      className={`action-strip-item action-strip-item-${item.status}`}
      role="listitem"
      aria-label={`${item.label}, ${item.status}`}
      draggable
      onDragStart={() => onDragStart(item.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDropOn(item.id)}
    >
      <button
        type="button"
        className="action-strip-main-action"
        disabled={disabled || terminal}
        onClick={() => onRun(item.id)}
      >
        <span>{item.label}</span>
        <small>{item.detail || actionStripKindLabel(item.kind)}</small>
      </button>
      <div className="action-strip-item-controls">
        <button
          type="button"
          aria-label={`Move ${item.label} earlier`}
          disabled={index === 0}
          onClick={() => onMove(item.id, -1)}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          aria-label={`Move ${item.label} later`}
          disabled={index === total - 1}
          onClick={() => onMove(item.id, 1)}
        >
          <ArrowDown />
        </button>
        {terminal || item.status === "deferred" ? (
          <button
            type="button"
            aria-label={`Return ${item.label} to pending`}
            onClick={() => onStatus(item.id, "pending")}
          >
            <RotateCcw />
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label={`Complete ${item.label}`}
              disabled={disabled}
              onClick={() => onRun(item.id)}
            >
              <Check />
            </button>
            <button
              type="button"
              aria-label={`Defer ${item.label}`}
              onClick={() => onStatus(item.id, "deferred")}
            >
              <Clock3 />
            </button>
            <button
              type="button"
              aria-label={`Skip ${item.label}`}
              onClick={() => onStatus(item.id, "skipped")}
            >
              <SkipForward />
            </button>
            <button
              type="button"
              aria-label={`Cancel ${item.label}`}
              onClick={() => onStatus(item.id, "cancelled")}
            >
              <Ban />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function headerTitle(visibility: string): string {
  if (visibility === "preview") return "Prepared Turn";
  if (visibility === "combat") return "Combat Actions";
  if (visibility === "suspended") return "Resolving";
  if (visibility === "recovery") return "Action Recovery";
  if (visibility === "archived") return "Turn Archived";
  return "Active Turn";
}

function headerCopy(visibility: string): string {
  if (visibility === "preview") return "Preview your next turn sequence.";
  if (visibility === "combat") return "Confirm combat steps one at a time.";
  if (visibility === "suspended") return "Actions pause during resolution.";
  if (visibility === "recovery") return "Review or skip interrupted actions.";
  if (visibility === "archived") return "Completed actions are preserved.";
  return "Confirm prepared actions without automatic execution.";
}

function canRunItem(
  item: ActiveTurnActionStripItem,
  visibility: string,
): boolean {
  if (visibility === "suspended" || visibility === "recovery") return false;
  if (visibility === "preview" && item.kind !== "begin-turn") return false;
  if (item.status === "blocked" || item.status === "deferred") return false;
  return !isTerminal(item.status);
}

function isTerminal(status: ActiveTurnActionStatus): boolean {
  return (
    status === "completed" || status === "skipped" || status === "cancelled"
  );
}
