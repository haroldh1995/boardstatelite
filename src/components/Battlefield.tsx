import {
  ChevronDown,
  ChevronUp,
  Layers,
  Package,
  Paperclip,
  PawPrint,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { PermanentGroup } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";
import { PermanentCard } from "./PermanentCard";

export function Battlefield() {
  const groups = useFieldStore((state) => state.field.groups);
  const reorderGroups = useFieldStore((state) => state.reorderGroups);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    creatures: false,
    other: false,
    attachments: true,
    tokens: false,
  });

  const sections = useMemo(() => {
    const battlefield = groups.filter((group) => group.zone === "battlefield");
    return {
      creatures: battlefield.filter(
        (group) => group.characteristics.isCreature,
      ),
      other: battlefield.filter(
        (group) =>
          !group.characteristics.isCreature &&
          !group.attachedTo &&
          !group.isGeneric,
      ),
      attachments: battlefield.filter(
        (group) => group.attachedTo || group.attachments.length > 0,
      ),
      tokens: battlefield.filter(
        (group) => group.characteristics.isToken || group.isGeneric,
      ),
    };
  }, [groups]);

  function dropOn(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const sorted = groups.slice().sort((a, b) => a.order - b.order);
    const from = sorted.findIndex((group) => group.id === draggedId);
    const to = sorted.findIndex((group) => group.id === targetId);
    if (from < 0 || to < 0) return;
    reorderGroups(draggedId, to > from ? 1 : -1);
    setDraggedId(null);
  }

  return (
    <main className="battlefield" aria-label="Organized battlefield">
      <BattlefieldSection
        id="creatures"
        title="Creatures"
        icon={<PawPrint />}
        count={sections.creatures.reduce(
          (sum, group) => sum + group.quantity,
          0,
        )}
        groups={sections.creatures}
        collapsed={collapsed.creatures}
        onToggle={() =>
          setCollapsed((state) => ({ ...state, creatures: !state.creatures }))
        }
        onDragStart={setDraggedId}
        onDropOn={dropOn}
      />
      <BattlefieldSection
        id="other"
        title="Other Permanents"
        icon={<Layers />}
        count={sections.other.reduce((sum, group) => sum + group.quantity, 0)}
        groups={sections.other}
        compact
        collapsed={collapsed.other}
        onToggle={() =>
          setCollapsed((state) => ({ ...state, other: !state.other }))
        }
        onDragStart={setDraggedId}
        onDropOn={dropOn}
      />
      <BattlefieldSection
        id="attachments"
        title="Attachments"
        icon={<Paperclip />}
        count={sections.attachments.reduce(
          (sum, group) => sum + group.quantity,
          0,
        )}
        groups={sections.attachments}
        compact
        collapsed={collapsed.attachments || sections.attachments.length === 0}
        onToggle={() =>
          setCollapsed((state) => ({
            ...state,
            attachments: !state.attachments,
          }))
        }
        onDragStart={setDraggedId}
        onDropOn={dropOn}
      />
      <TokenInventory groups={sections.tokens} />
    </main>
  );
}

function BattlefieldSection({
  id,
  title,
  icon,
  count,
  groups,
  compact = false,
  collapsed,
  onToggle,
  onDragStart,
  onDropOn,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  count: number;
  groups: PermanentGroup[];
  compact?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
}) {
  if (groups.length === 0 && id !== "creatures") return null;
  return (
    <section className="battlefield-section" aria-labelledby={`${id}-heading`}>
      <button
        type="button"
        className="section-heading"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true">{icon}</span>
        <strong id={`${id}-heading`}>
          {title} <small>({count})</small>
        </strong>
        {collapsed ? <ChevronDown /> : <ChevronUp />}
      </button>
      {!collapsed && (
        <div
          className={compact ? "card-lane compact-lane" : "card-lane"}
          role="list"
        >
          {groups.map((group) => (
            <PermanentCard
              key={group.id}
              group={group}
              compact={compact}
              onDragStart={onDragStart}
              onDropOn={onDropOn}
            />
          ))}
          {groups.length === 0 && (
            <p className="empty-section">
              Add tracked cards or generic placeholders to begin.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function TokenInventory({ groups }: { groups: PermanentGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="token-inventory" aria-labelledby="token-heading">
      <div className="section-heading static-heading">
        <Package aria-hidden="true" />
        <strong id="token-heading">Generics & Tokens</strong>
      </div>
      <div className="token-chip-row">
        {groups.slice(0, 14).map((group) => (
          <button type="button" className="inventory-chip" key={group.id}>
            <span>{group.label}</span>
            <strong>x{group.quantity}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
