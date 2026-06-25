import { Grip, RotateCcw, ShieldOff } from "lucide-react";
import { useRef, useState } from "react";
import type { PermanentGroup, SupportStatus } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";

interface PermanentCardProps {
  group: PermanentGroup;
  compact?: boolean;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
}

export function PermanentCard({
  group,
  compact = false,
  onDragStart,
  onDropOn,
}: PermanentCardProps) {
  const openModal = useFieldStore((state) => state.openModal);
  const removeGroup = useFieldStore((state) => state.removeGroup);
  const [gesture, setGesture] = useState<"idle" | "waiting" | "hold">("idle");
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  const priorityCounters = Object.entries(group.counters)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => priority(a) - priority(b));
  const visibleCounters = priorityCounters.slice(0, 3);
  const hiddenCounters = Math.max(
    0,
    priorityCounters.length - visibleCounters.length,
  );
  const support = supportLabel(group.identity?.supportStatus, group.isGeneric);
  const image = group.identity?.imageUrl || group.identity?.imageSmall;

  function pointerDown() {
    setGesture("hold");
    holdTimerRef.current = window.setTimeout(() => {
      openModal({ kind: "managePermanent", groupId: group.id });
      setGesture("idle");
    }, 560);
  }

  function pointerUp() {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    if (gesture !== "hold") return;
    tapCountRef.current += 1;
    setGesture("waiting");
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(
      () => {
        const taps = tapCountRef.current;
        tapCountRef.current = 0;
        setGesture("idle");
        if (group.isGeneric && taps >= 3) {
          openModal({ kind: "replaceGeneric", groupId: group.id });
          return;
        }
        if (taps >= 2) {
          if (group.quantity > 1)
            openModal({ kind: "removeStack", groupId: group.id });
          else removeGroup(group.id, 1);
          return;
        }
        openModal({
          kind: "preview",
          groupId: group.id,
          card: group.identity ?? undefined,
        });
      },
      group.isGeneric ? 280 : 220,
    );
  }

  return (
    <article
      className={[
        "permanent-card",
        compact ? "compact-card" : "",
        group.statuses.tapped ? "is-tapped" : "",
        group.statuses.depowered ? "is-depowered" : "",
        gesture === "waiting" ? "gesture-waiting" : "",
      ].join(" ")}
      draggable
      onDragStart={() => onDragStart(group.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDropOn(group.id)}
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
      onPointerCancel={() => setGesture("idle")}
      aria-label={`${group.label}, stack size ${group.quantity}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter")
          openModal({ kind: "managePermanent", groupId: group.id });
        if (event.key === "Delete") removeGroup(group.id, 1);
      }}
    >
      <div className="card-image-frame">
        {image ? (
          <img src={image} alt={`${group.label} card`} loading="lazy" />
        ) : (
          <div className="generic-silhouette" aria-label="Generic placeholder">
            <span>{group.characteristics.cardTypes[0] ?? "Object"}</span>
            {group.isGeneric && <small>Triple-tap to identify</small>}
          </div>
        )}
        <span className="quantity-badge">x{group.quantity}</span>
        {group.statuses.depowered && (
          <span className="depower-badge" aria-label="Abilities disabled">
            <ShieldOff />
          </span>
        )}
        {group.statuses.transformed && (
          <span className="transform-badge" aria-label="Transformed">
            <RotateCcw />
          </span>
        )}
      </div>
      <div className="card-caption">
        <strong>{group.label}</strong>
        <small>{support}</small>
      </div>
      <button
        type="button"
        className="counter-stack"
        aria-label={`Counters on ${group.label}`}
        onClick={(event) => {
          event.stopPropagation();
          openModal({
            kind: "managePermanent",
            groupId: group.id,
            payload: { panel: "counters" },
          });
        }}
      >
        {visibleCounters.map(([name, count]) => (
          <span key={name}>
            {name} x{count}
          </span>
        ))}
        {hiddenCounters > 0 && <span>+{hiddenCounters} more</span>}
      </button>
      {group.characteristics.isCreature && (
        <span className="pt-badge">
          {group.pt.currentPower ?? "-"} / {group.pt.currentToughness ?? "-"}
        </span>
      )}
      <span className="drag-handle" aria-hidden="true">
        <Grip />
      </span>
    </article>
  );
}

function priority(counter: string): number {
  if (counter === "+1/+1") return 0;
  if (counter === "Shield") return 1;
  if (counter === "Stun") return 2;
  return 3;
}

function supportLabel(status: SupportStatus | undefined, generic: boolean) {
  if (generic) return "No active abilities";
  if (status === "fully-automated") return "Fully automated";
  if (status === "partially-automated") return "Partially automated";
  if (status === "quantity-tracking-only") return "Quantity tracking only";
  return "Unsupported";
}
