import { describe, expect, it } from "vitest";
import {
  addCommanderDamageEntry,
  adjustCommanderDamageEntry,
  createDefaultCommanderDamageState,
  totalCommanderDamage,
} from "./commanderDamage";

describe("commander damage", () => {
  it("keeps damage per individual commander including partners", () => {
    let state = addCommanderDamageEntry(createDefaultCommanderDamageState(), {
      playerLabel: "Alex",
      commanderLabel: "Partner One",
    });
    state = addCommanderDamageEntry(state, {
      playerLabel: "Alex",
      commanderLabel: "Partner Two",
    });
    state = adjustCommanderDamageEntry(state, state.entries[0].id, 5);
    expect(state.entries.map((entry) => entry.damage)).toEqual([5, 0]);
    expect(totalCommanderDamage(state)).toBe(5);
  });

  it("never falls below zero", () => {
    let state = addCommanderDamageEntry(createDefaultCommanderDamageState(), {
      playerLabel: "Alex",
      commanderLabel: "Commander",
    });
    state = adjustCommanderDamageEntry(state, state.entries[0].id, -10);
    expect(state.entries[0].damage).toBe(0);
  });
});
