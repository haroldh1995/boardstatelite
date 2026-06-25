import { List, PlusCircle } from "lucide-react";
import { useRef } from "react";
import { useFieldStore } from "../state/useFieldStore";

export function BottomDock() {
  const activateField = useFieldStore((state) => state.activateField);
  const openModal = useFieldStore((state) => state.openModal);
  const holdRef = useRef<number | null>(null);

  function startHold() {
    holdRef.current = window.setTimeout(
      () => openModal({ kind: "transformAll" }),
      640,
    );
  }

  function endHold() {
    if (holdRef.current) window.clearTimeout(holdRef.current);
    holdRef.current = null;
  }

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
      <button
        type="button"
        className="activate-button"
        onClick={activateField}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
      >
        <span className="activate-sigil" aria-hidden="true" />
        <strong>ACTIVATE FIELD</strong>
        <small>Tap to resolve • Hold to Transform All</small>
      </button>
      <button
        type="button"
        className="dock-side-button"
        onClick={() => openModal({ kind: "settings" })}
      >
        <List />
        <span>Tools</span>
      </button>
    </nav>
  );
}
