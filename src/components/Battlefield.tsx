import {
  Apple,
  ChevronDown,
  ChevronUp,
  Coins,
  LayoutList,
  Package,
  Search,
  Shield,
  SlidersHorizontal,
  Sword,
} from "lucide-react";
import { useMemo, useState } from "react";
import { referenceSectionCount } from "../dev/referenceMode";
import type { PermanentGroup } from "../domain/types";
import { useFieldStore } from "../state/useFieldStore";
import { PermanentCard } from "./PermanentCard";

type SortMode = "type" | "order";

export function Battlefield() {
  const groups = useFieldStore((state) => state.field.groups);
  const reorderGroups = useFieldStore((state) => state.reorderGroups);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("type");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    creatures: false,
    other: false,
    attachments: false,
    tokens: false,
  });

  const sections = useMemo(() => {
    const battlefield = groups.filter((group) => group.zone === "battlefield");
    const attachments = battlefield.filter((group) => group.attachedTo);
    const resourceGroups = battlefield.filter(
      (group) =>
        group.isGeneric &&
        !group.attachedTo &&
        !group.characteristics.isCreature &&
        !group.characteristics.cardTypes.includes("Land"),
    );
    return {
      creatures: sortGroups(
        battlefield.filter((group) => group.characteristics.isCreature),
        sortMode,
      ),
      other: sortGroups(
        battlefield.filter(
          (group) =>
            !group.characteristics.isCreature &&
            !group.attachedTo &&
            !group.isGeneric,
        ),
        "order",
      ),
      attachments: sortGroups(attachments, "order"),
      tokens: sortGroups(resourceGroups, "order"),
      all: battlefield,
    };
  }, [groups, sortMode]);

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
        count={sections.creatures.reduce(
          (sum, group) => sum + group.quantity,
          0,
        )}
        groups={sections.creatures}
        collapsed={collapsed.creatures}
        controls={
          <div className="section-tools" aria-label="Creature layout controls">
            <button
              type="button"
              onClick={() =>
                setSortMode((mode) => (mode === "type" ? "order" : "type"))
              }
            >
              Group by: {sortMode}
            </button>
            <button type="button" aria-label="Sort creature groups">
              <SlidersHorizontal />
            </button>
            <button type="button" aria-label="Creature layout view">
              <LayoutList />
            </button>
          </div>
        }
        onToggle={() =>
          setCollapsed((state) => ({ ...state, creatures: !state.creatures }))
        }
        onDragStart={setDraggedId}
        onDropOn={dropOn}
      />
      <BattlefieldSection
        id="other"
        title="Other Permanents"
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
      <AttachmentSection
        groups={sections.attachments}
        parents={sections.all}
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
      <TokenInventory
        groups={sections.tokens}
        collapsed={collapsed.tokens}
        onToggle={() =>
          setCollapsed((state) => ({ ...state, tokens: !state.tokens }))
        }
      />
    </main>
  );
}

function BattlefieldSection({
  id,
  title,
  count,
  groups,
  compact = false,
  collapsed,
  controls,
  onToggle,
  onDragStart,
  onDropOn,
}: {
  id: string;
  title: string;
  count: number;
  groups: PermanentGroup[];
  compact?: boolean;
  collapsed: boolean;
  controls?: React.ReactNode;
  onToggle: () => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
}) {
  if (groups.length === 0 && id !== "creatures") return null;
  const visualCount = referenceSectionCount(id, count);
  return (
    <section
      className={`battlefield-section ${id}-section`}
      aria-labelledby={`${id}-heading`}
      data-testid={`${id}-section`}
    >
      <div className="section-heading">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed}>
          <strong id={`${id}-heading`}>
            {title} <span>({visualCount})</span>
          </strong>
        </button>
        {controls}
        <button
          type="button"
          className="collapse-button"
          onClick={onToggle}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
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
              variant={compact ? "permanent" : "creature"}
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

function AttachmentSection({
  groups,
  parents,
  collapsed,
  onToggle,
  onDragStart,
  onDropOn,
}: {
  groups: PermanentGroup[];
  parents: PermanentGroup[];
  collapsed: boolean;
  onToggle: () => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
}) {
  if (groups.length === 0) return null;
  const clusters = clusterAttachments(groups, parents);
  return (
    <section
      className="battlefield-section attachments-section"
      aria-labelledby="attachments-heading"
      data-testid="attachments-section"
    >
      <div className="section-heading">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed}>
          <strong id="attachments-heading">Attachments</strong>
        </button>
        <button
          type="button"
          className="collapse-button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand attachments" : "Collapse attachments"}
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
      {!collapsed && (
        <div className="attachment-clusters">
          {clusters.map((cluster) => (
            <div className="attachment-cluster" key={cluster.parentId}>
              <span className="attachment-connector" aria-hidden="true" />
              <div className="attachment-card-row" role="list">
                {cluster.groups.map((group) => (
                  <PermanentCard
                    key={group.id}
                    group={group}
                    compact
                    variant="attachment"
                    onDragStart={onDragStart}
                    onDropOn={onDropOn}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TokenInventory({
  groups,
  collapsed,
  onToggle,
}: {
  groups: PermanentGroup[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section
      className="token-inventory"
      aria-labelledby="token-heading"
      data-testid="token-section"
    >
      <div className="section-heading">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed}>
          <strong id="token-heading">Generics &amp; Tokens</strong>
        </button>
        <button
          type="button"
          className="collapse-button"
          onClick={onToggle}
          aria-label={
            collapsed
              ? "Expand generics and tokens"
              : "Collapse generics and tokens"
          }
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
      {!collapsed && (
        <div className="token-chip-row">
          {groups.slice(0, 14).map((group) => (
            <button
              type="button"
              className="inventory-chip"
              key={group.id}
              aria-label={`${group.label}: ${group.quantity}`}
            >
              <span className="inventory-icon" aria-hidden="true">
                {resourceIcon(group)}
              </span>
              <span className="inventory-label">{splitLabel(group.label)}</span>
              <strong>x{group.quantity}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function sortGroups(groups: PermanentGroup[], sortMode: SortMode) {
  return groups.slice().sort((a, b) => {
    if (sortMode === "type") {
      const typeA = a.characteristics.cardTypes.join(" ") || "Object";
      const typeB = b.characteristics.cardTypes.join(" ") || "Object";
      const typeCompare = typeA.localeCompare(typeB);
      if (typeCompare !== 0) return typeCompare;
    }
    return a.order - b.order;
  });
}

function clusterAttachments(
  groups: PermanentGroup[],
  parents: PermanentGroup[],
): Array<{ parentId: string; groups: PermanentGroup[] }> {
  const parentOrder = new Map(
    parents.map((parent, index) => [parent.id, index]),
  );
  const clusters = new Map<string, PermanentGroup[]>();
  for (const group of groups) {
    const key = group.attachedTo ?? "loose";
    clusters.set(key, [...(clusters.get(key) ?? []), group]);
  }
  return [...clusters.entries()]
    .sort(
      ([a], [b]) =>
        (parentOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (parentOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([parentId, clusterGroups]) => ({
      parentId,
      groups: clusterGroups.sort((a, b) => a.order - b.order),
    }));
}

function resourceIcon(group: PermanentGroup) {
  const subtype = group.characteristics.subtypes.join(" ").toLowerCase();
  if (subtype.includes("treasure")) return <Coins />;
  if (subtype.includes("clue")) return <Search />;
  if (subtype.includes("food")) return <Apple />;
  if (subtype.includes("equipment")) return <Sword />;
  if (group.characteristics.cardTypes.includes("Artifact")) return <Shield />;
  return <Package />;
}

function splitLabel(label: string) {
  if (label.toLowerCase().includes("token")) {
    const [first, ...rest] = label.split(" ");
    return (
      <>
        <span>{first}</span>
        <span>{rest.join(" ")}</span>
      </>
    );
  }
  return <span>{label}</span>;
}
