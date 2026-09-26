import {
  CircleHelp,
  Coins,
  Dices,
  Orbit,
  ScanLine,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useFieldStore } from "../state/useFieldStore";

export function UserToolsSheet() {
  const openModal = useFieldStore((state) => state.openModal);
  return (
    <div className="user-tools-sheet">
      <h2 id="modal-title">User Tools</h2>
      <p className="sheet-intro">
        Manual tools for the physical game. These record what you tell Lite;
        they do not ask Athena for permission.
      </p>
      <div className="user-tool-grid">
        <ToolButton
          icon={<Sparkles />}
          title="Static Effects"
          detail="Add and manage continuous effects."
          onClick={() => openModal({ kind: "staticEffects" })}
        />
        <ToolButton
          icon={<Orbit />}
          title="External Game State"
          detail="Emblems, dungeons, Planechase, and Archenemy."
          onClick={() => openModal({ kind: "externalGameState" })}
        />
        <ToolButton
          icon={<Dices />}
          title="Dice"
          detail="Roll standard or custom dice."
          onClick={() =>
            openModal({ kind: "randomizer", payload: { mode: "dice" } })
          }
        />
        <ToolButton
          icon={<Coins />}
          title="Coin"
          detail="Flip one or more coins."
          onClick={() =>
            openModal({ kind: "randomizer", payload: { mode: "coin" } })
          }
        />
        <ToolButton
          icon={<Wrench />}
          title="Battlefield Correction"
          detail="Catch Lite up without creating game events."
          onClick={() => openModal({ kind: "catchUp" })}
        />
        <ToolButton
          icon={<ScanLine />}
          title="Plan Next Turn"
          detail="Prepare land plays and actions."
          onClick={() => openModal({ kind: "planner" })}
        />
        <ToolButton
          icon={<CircleHelp />}
          title="Turn Memory"
          detail="Review pending and possible missed triggers."
          onClick={() => openModal({ kind: "turnMemory" })}
        />
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="user-tool" onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
  );
}
