import { useMemo, useState } from "react";
import { deriveBattlefieldIndex } from "../domain/battlefieldIndex";
import { useFieldStore } from "../state/useFieldStore";

const COUNT_LABELS: Record<string, string> = {
  basic: "Basic lands",
  nonbasic: "Nonbasic lands",
  tokens: "Tokens",
  nontokens: "Nontokens",
  tapped: "Tapped",
  untapped: "Untapped",
  modified: "Modified",
};

export function BattlefieldCountsSheet() {
  const groups = useFieldStore((state) => state.field.groups);
  const openModal = useFieldStore((state) => state.openModal);
  const snapshot = useMemo(() => deriveBattlefieldIndex(groups), [groups]);
  const [selected, setSelected] = useState<string | null>(null);
  const sections = [
    {
      title: "Battlefield",
      keys: [
        "type:Land",
        "basic",
        "nonbasic",
        "type:Creature",
        "tokens",
        "nontokens",
        "type:Artifact",
        "type:Enchantment",
        "type:Planeswalker",
        "type:Battle",
        "tapped",
        "untapped",
        "modified",
      ],
    },
    ...[
      ["Creature Types", "creature:"],
      ["Colors", "color:"],
      ["Supertypes", "supertype:"],
      ["Counters", "counter:"],
      ["Controllers", "controller:"],
    ].map(([title, prefix]) => ({
      title,
      keys: Object.keys(snapshot.counts)
        .filter((key) => key.startsWith(prefix))
        .sort(),
    })),
  ];
  const selectedCount = selected ? snapshot.counts[selected] : null;
  return (
    <div className="battlefield-counts">
      <h2 id="modal-title">Battlefield Counts</h2>
      {sections
        .filter((section) => section.keys.length)
        .map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <div className="count-inspection-grid">
              {section.keys.map((key) => {
                const count = snapshot.counts[key];
                const fallback = COUNT_LABELS[key] ?? key.replace("type:", "");
                return (
                  <button
                    type="button"
                    key={key}
                    disabled={!count}
                    aria-label={`${count?.label ?? fallback} ${count?.count ?? 0}`}
                    aria-expanded={selected === key}
                    onClick={() => setSelected(selected === key ? null : key)}
                  >
                    <span>{count?.label ?? fallback}</span>
                    <strong>{count?.count ?? 0}</strong>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      {selectedCount && (
        <section aria-label={`${selectedCount.label} contributors`}>
          <h3>{selectedCount.label}</h3>
          {snapshot.groups
            .filter((group) => selectedCount.groupIds.includes(group.id))
            .map((group) => (
              <button
                className="count-contributor"
                type="button"
                key={group.id}
                aria-label={`${group.label} ${group.quantity}`}
                onClick={() =>
                  openModal({ kind: "managePermanent", groupId: group.id })
                }
              >
                {group.label}
                <strong>{group.quantity}</strong>
              </button>
            ))}
        </section>
      )}
      <button
        type="button"
        className="quiet-action"
        onClick={() => openModal({ kind: "catchUp" })}
      >
        Catch Me Up
      </button>
    </div>
  );
}
