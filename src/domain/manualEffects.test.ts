import { describe, expect, it } from "vitest";
import { genericCreature, testCard, tracked } from "../test/factories";
import { createDefaultField, normalizeField } from "./field";
import {
  activeManualStaticDefinitions,
  applyManualPowerToughnessEffects,
  createManualStaticEffect,
  manualKeywordState,
} from "./manualEffects";

describe("manual static effects", () => {
  it("links a source to a deterministic P/T effect and recalculates derived state", () => {
    const source = tracked(
      testCard({
        name: "Source Card",
        typeLine: "Enchantment",
        oracleText: "",
      }),
    );
    const creature = genericCreature();
    const effect = createManualStaticEffect({
      source: {
        kind: "permanent",
        id: source.id,
        label: source.label,
        controller: "you",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 2, toughness: 1 },
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [source, creature],
      manualEffects: { version: 1, effects: [effect] },
    });
    const derived = applyManualPowerToughnessEffects(field).groups.find(
      (group) => group.id === creature.id,
    );
    expect(derived?.pt.currentPower).toBe(4);
    expect(derived?.pt.currentToughness).toBe(3);
  });

  it("suspends source-dependent effects when the source leaves", () => {
    const source = tracked(
      testCard({
        name: "Source Card",
        typeLine: "Enchantment",
        oracleText: "",
      }),
    );
    const effect = createManualStaticEffect({
      source: {
        kind: "permanent",
        id: source.id,
        label: source.label,
        controller: "you",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 1, toughness: 1 },
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [{ ...source, zone: "graveyard" }],
      manualEffects: { version: 1, effects: [effect] },
    });
    expect(activeManualStaticDefinitions(field)).toEqual([]);
  });

  it("represents keyword grants and removal without rewriting printed identity", () => {
    const source = tracked(
      testCard({ name: "Source", typeLine: "Enchantment", oracleText: "" }),
    );
    const creature = genericCreature();
    const grant = createManualStaticEffect({
      source: {
        kind: "permanent",
        id: source.id,
        label: source.label,
        controller: "you",
      },
      target: "controlled-creatures",
      modification: { kind: "grant-keyword", keyword: "Flying" },
    });
    const remove = createManualStaticEffect({
      source: {
        kind: "permanent",
        id: source.id,
        label: source.label,
        controller: "you",
      },
      target: "selected-creature",
      targetGroupId: creature.id,
      modification: { kind: "remove-keyword", keyword: "Flying" },
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [source, creature],
      manualEffects: { version: 1, effects: [grant, remove] },
    });
    expect(manualKeywordState(field, creature)).toEqual({
      granted: [],
      removed: ["Flying"],
    });
    expect(creature.identity).toBeNull();
  });

  it("applies custom table effects without inventing a battlefield source", () => {
    const creature = genericCreature();
    const effect = createManualStaticEffect({
      source: {
        kind: "custom-table-effect",
        id: null,
        label: "Commander variant bonus",
        controller: "shared",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 1, toughness: 2 },
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [creature],
      manualEffects: { version: 1, effects: [effect] },
    });
    const derived = applyManualPowerToughnessEffects(field).groups[0];
    expect(derived.pt.currentPower).toBe(3);
    expect(derived.pt.currentToughness).toBe(4);
    expect(field.groups).toHaveLength(1);
  });

  it("suspends effects while a source card is not tracked", () => {
    const source = {
      ...tracked(
        testCard({ name: "Source", typeLine: "Enchantment", oracleText: "" }),
      ),
      trackingEnabled: false,
    };
    const creature = genericCreature();
    const effect = createManualStaticEffect({
      source: {
        kind: "permanent",
        id: source.id,
        label: source.label,
        controller: "you",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 3, toughness: 3 },
    });
    const field = normalizeField({
      ...createDefaultField(),
      groups: [source, creature],
      manualEffects: { version: 1, effects: [effect] },
    });
    const derived = applyManualPowerToughnessEffects(field).groups.find(
      (group) => group.id === creature.id,
    );
    expect(derived?.pt.currentPower).toBe(2);
  });

  it("activates and suspends effects with first-class external sources", () => {
    const creature = genericCreature();
    const effect = createManualStaticEffect({
      source: {
        kind: "emblem",
        id: "emblem-1",
        label: "Elspeth emblem",
        controller: "you",
      },
      target: "controlled-creatures",
      modification: { kind: "power-toughness", power: 2, toughness: 2 },
    });
    const active = normalizeField({
      ...createDefaultField(),
      groups: [creature],
      externalGameState: {
        ...createDefaultField().externalGameState,
        sources: [
          {
            id: "emblem-1",
            kind: "emblem",
            name: "Elspeth emblem",
            imageUrl: null,
            public: true,
            active: true,
            sourceCardName: "Elspeth",
          },
        ],
      },
      manualEffects: { version: 1, effects: [effect] },
    });
    expect(
      applyManualPowerToughnessEffects(active).groups[0].pt.currentPower,
    ).toBe(4);
    const inactive = normalizeField({
      ...active,
      externalGameState: { ...active.externalGameState, sources: [] },
    });
    expect(
      applyManualPowerToughnessEffects(inactive).groups[0].pt.currentPower,
    ).toBe(2);
  });
});
