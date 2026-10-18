import {
  List,
  PlusCircle,
  TreePine,
  Focus,
  ArrowLeftRight,
} from "lucide-react";
import { useRef } from "react";
import { useFieldStore } from "../state/useFieldStore";
import { usePressLifetime } from "./usePressLifetime";

export function BottomDock() {
  const abilityFocus = useFieldStore((state) => state.abilityFocus);
  const setAbilityFocus = useFieldStore((state) => state.setAbilityFocus);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const openModal = useFieldStore((state) => state.openModal);
  const holdRef = useRef<number | null>(null);
  const holdFiredRef = useRef(false);

  function startHold() {
    holdFiredRef.current = false;
    holdRef.current = window.setTimeout(() => {
      holdFiredRef.current = true;
      openModal({ kind: "transformAll" });
    }, 640);
  }

  function endHold() {
    if (holdRef.current) window.clearTimeout(holdRef.current);
    holdRef.current = null;
  }

  const press = usePressLifetime(startHold, endHold);

  return (
    <nav className="bottom-dock" aria-label="Primary controls">
      <button
        type="button"
        className="dock-side-button"
        onClick={() => openModal({ kind: "add" })}
      >
        <PlusCircle />
        <span>Add</span>
      </button>
      <div className="activation-mode-control">
        <button
          type="button"
          className={`activate-button${abilityFocus ? " ability-focus-mode" : ""}`}
          onClick={() => {
            if (holdFiredRef.current || swiped.current) {
              holdFiredRef.current = false;
              swiped.current = false;
              return;
            }
            openModal({ kind: abilityFocus ? "turnMemory" : "fieldAbilities" });
          }}
          {...press}
          onPointerDown={(event) => {
            swiped.current = false;
            swipe.current = event.isPrimary
              ? { x: event.clientX, y: event.clientY }
              : null;
            press.onPointerDown(event);
          }}
          onPointerMove={(event) => {
            const origin = swipe.current;
            if (!origin) return;
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if (Math.abs(dy) > 20) {
              swipe.current = null;
              endHold();
              return;
            }
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 2) {
              swiped.current = true;
              swipe.current = null;
              endHold();
              setAbilityFocus(!abilityFocus);
            }
          }}
          onPointerLeave={press.onPointerCancel}
        >
          <span className="activate-sigil" aria-hidden="true">
            {abilityFocus ? <Focus /> : <TreePine />}
          </span>
          <span className="activate-copy">
            <strong>{abilityFocus ? "ABILITY FOCUS" : "ACTIVATE FIELD"}</strong>
            <small>
              {abilityFocus
                ? "SHOW ACTIVATED ABILITIES"
                : "TRIGGERED ABILITIES"}
            </small>
          </span>
        </button>
        <button
          className="activation-mode-switch"
          aria-label={
            abilityFocus
              ? "Switch to Activate Field"
              : "Switch to Ability Focus"
          }
          title="Switch activation mode"
          onClick={() => setAbilityFocus(!abilityFocus)}
        >
          <ArrowLeftRight size={16} />
        </button>
      </div>
      <button
        type="button"
        className="dock-side-button"
        onClick={() => openModal({ kind: "userTools" })}
      >
        <List />
        <span>User Tools</span>
      </button>
    </nav>
  );
}
