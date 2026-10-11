import type { PermanentGroup } from "./types";

export interface BattlefieldCount {
  key: string;
  label: string;
  count: number;
  groupIds: string[];
}
export interface BattlefieldIndex {
  groups: readonly PermanentGroup[];
  counts: Record<string, BattlefieldCount>;
}

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

/** Fresh derivation, including stack quantities. No persisted aggregate can override it. */
export function deriveBattlefieldIndex(
  groups: readonly PermanentGroup[],
): BattlefieldIndex {
  const battlefield = groups.filter(
    (group) => group.zone === "battlefield" && group.quantity > 0,
  );
  const counts: Record<string, BattlefieldCount> = {};
  const add = (
    key: string,
    label: string,
    group: PermanentGroup,
    amount = group.quantity,
  ) => {
    const entry =
      counts[key] ?? (counts[key] = { key, label, count: 0, groupIds: [] });
    entry.count += amount;
    entry.groupIds.push(group.id);
  };
  for (const group of battlefield) {
    const c = group.characteristics;
    add("all", "Permanents", group);
    for (const type of new Set(c.cardTypes)) add(`type:${type}`, type, group);
    for (const type of new Set(c.subtypes)) {
      add(`subtype:${type}`, type, group);
      if (c.isToken) add(`token:${type}`, type, group);
      if (c.cardTypes.includes("Creature"))
        add(`creature:${type}`, type, group);
    }
    for (const type of new Set(c.supertypes))
      add(`supertype:${type}`, type, group);
    for (const color of new Set(c.colors))
      add(`color:${color}`, COLOR_LABELS[color] ?? color, group);
    if (!c.colors.length)
      add(
        group.identity ? "color:colorless" : "color:unknown",
        group.identity ? "Colorless" : "Unspecified colors",
        group,
      );
    add(
      c.isToken ? "tokens" : "nontokens",
      c.isToken ? "Tokens" : "Nontokens",
      group,
    );
    add(
      group.statuses.tapped ? "tapped" : "untapped",
      group.statuses.tapped ? "Tapped" : "Untapped",
      group,
    );
    add(
      `controller:${group.controller}`,
      group.controller === "you"
        ? "Controlled by you"
        : "Controlled by opponent",
      group,
    );
    if (
      group.statuses.modified ||
      group.attachedTo ||
      group.attachments.length ||
      Object.values(group.counters).some((n) => n > 0)
    )
      add("modified", "Modified", group);
    if (c.cardTypes.includes("Land"))
      add(
        c.supertypes.includes("Basic") ? "basic" : "nonbasic",
        c.supertypes.includes("Basic") ? "Basic lands" : "Nonbasic lands",
        group,
      );
    for (const [name, value] of Object.entries(group.counters))
      if (value > 0)
        add(`counter:${name}`, name, group, value * group.quantity);
  }
  return { groups: battlefield, counts };
}

export function battlefieldIndex(
  groups: readonly PermanentGroup[],
): BattlefieldIndex {
  // Legacy resolution transactions may mutate a working array before committing it.
  // Derive afresh until every producer guarantees immutable array identity.
  return deriveBattlefieldIndex(groups);
}
