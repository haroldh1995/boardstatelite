import { Undo2 } from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";
export function QuickUndo() {
  const label = useFieldStore((state) => state.undoStack.at(-1)?.label);
  const undo = useFieldStore((state) => state.undo);
  return (
    <button
      type="button"
      className="quick-undo icon-button"
      title={label ? `Undo: ${label}` : "Undo"}
      aria-label={label ? `Undo: ${label}` : "Undo latest adjustment"}
      onClick={undo}
    >
      <Undo2 />
    </button>
  );
}
