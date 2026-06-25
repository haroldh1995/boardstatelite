import { describe, expect, it } from "vitest";
import { createGenericGroup } from "./cards";
import {
  activateField,
  applyCounters,
  replaceGenericIdentity,
  resolveLandEntry,
  transformCreatures,
} from "./engine";
import { calculateTotals } from "./field";
import {
  animPakal,
  catharsCrusade,
  doublingSeason,
  fieldWith,
  genericCreature,
  rampagingBaloths,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";

describe("field resolver", () => {
  it("resolves Anim Pakal plus Cathars Crusade as one undoable activation", () => {
    const anim = withCounters(tracked(animPakal()), { "+1/+1": 5 });
    const crusade = tracked(catharsCrusade());
    const generic = genericCreature(2);
    const result = activateField(fieldWith([anim, crusade, generic]));

    const animAfter = result.field.groups.find((group) =>
      group.identity?.name.includes("Anim Pakal"),
    );
    const genericAfter = result.field.groups.find(
      (group) => group.label === "Generic creature",
    );
    const gnomes = result.field.groups.find((group) => group.label === "Gnome");

    expect(result.title).toBe("Field Activated");
    expect(gnomes?.quantity).toBe(6);
    expect(gnomes?.statuses.tapped).toBe(true);
    expect(gnomes?.statuses.attacking).toBe(true);
    expect(gnomes?.counters["+1/+1"]).toBe(6);
    expect(gnomes?.pt.currentPower).toBe(7);
    expect(gnomes?.pt.currentToughness).toBe(7);
    expect(animAfter?.counters["+1/+1"]).toBe(12);
    expect(animAfter?.pt.currentPower).toBe(13);
    expect(animAfter?.pt.currentToughness).toBe(14);
    expect(genericAfter?.counters["+1/+1"]).toBe(6);
    expect(result.summary.join(" ")).toContain("Cathars' Crusade");
  });

  it("applies Doubling Season to game-action counters but not correction-only counters", () => {
    const permanent = genericCreature();
    const field = fieldWith([tracked(doublingSeason()), permanent]);
    const gameAction = applyCounters(
      field,
      permanent.id,
      "+1/+1",
      1,
      "all",
      1,
      "game-action",
    );
    const corrected = applyCounters(
      field,
      permanent.id,
      "+1/+1",
      1,
      "all",
      1,
      "correction",
    );

    expect(
      gameAction.field.groups.find((group) => group.id === permanent.id)
        ?.counters["+1/+1"],
    ).toBe(2);
    expect(
      corrected.field.groups.find((group) => group.id === permanent.id)
        ?.counters["+1/+1"],
    ).toBe(1);
  });

  it("splits a stack when counters apply to only one object", () => {
    const stack = genericCreature(3);
    const result = applyCounters(
      fieldWith([stack]),
      stack.id,
      "Shield",
      1,
      "one",
      1,
      "correction",
    );
    const shielded = result.field.groups.find(
      (group) => group.counters.Shield === 1,
    );
    const untouched = result.field.groups.find(
      (group) => !group.counters.Shield,
    );

    expect(shielded?.quantity).toBe(1);
    expect(untouched?.quantity).toBe(2);
  });

  it("derives overlapping totals without losing categories", () => {
    const equipment = createGenericGroup({
      kind: "Equipment",
      label: "Generic Equipment",
      quantity: 3,
      token: false,
    });
    const totals = calculateTotals([equipment]);

    expect(totals.artifacts).toBe(3);
    expect(totals.equipment).toBe(3);
    expect(totals.nontokenPermanents).toBe(3);
  });

  it("resolves landfall background events and supports correction-only land changes", () => {
    const field = fieldWith([tracked(rampagingBaloths())]);
    const oneAtATime = resolveLandEntry(field, 2, "one-at-a-time");
    const correction = resolveLandEntry(field, 2, "correction");

    expect(
      oneAtATime.field.groups.find((group) => group.label === "Beast")
        ?.quantity,
    ).toBe(2);
    expect(
      correction.field.groups.find((group) => group.label === "Beast"),
    ).toBeUndefined();
  });

  it("preserves placeholder state during replacement without retroactive triggers", () => {
    const placeholder = withCounters(
      {
        ...genericCreature(2),
        statuses: {
          ...genericCreature().statuses,
          tapped: true,
          depowered: true,
        },
        depowerMode: "all",
      },
      { "+1/+1": 3, Shield: 1 },
    );
    const replacement = testCard({
      name: "Llanowar Elves",
      typeLine: "Creature - Elf Druid",
      oracleText: "{T}: Add {G}.",
      power: "1",
      toughness: "1",
    });
    const result = replaceGenericIdentity(
      fieldWith([placeholder]),
      placeholder.id,
      replacement,
      "one",
      1,
    );
    const replaced = result.field.groups.find(
      (group) => group.identity?.name === "Llanowar Elves",
    );
    const remaining = result.field.groups.find((group) => group.isGeneric);

    expect(replaced?.quantity).toBe(1);
    expect(replaced?.counters["+1/+1"]).toBe(3);
    expect(replaced?.statuses.tapped).toBe(true);
    expect(replaced?.statuses.depowered).toBe(true);
    expect(replaced?.depowerMode).toBe("all");
    expect(remaining?.quantity).toBe(1);
    expect(result.events).toHaveLength(0);
  });

  it("transforms all creatures without enter-the-battlefield events and can preserve depower state", () => {
    const generic = {
      ...genericCreature(),
      statuses: {
        ...genericCreature().statuses,
        tapped: true,
        depowered: true,
      },
      depowerMode: "all" as const,
    };
    const target = testCard({
      name: "Colossal Dreadmaw",
      typeLine: "Creature - Dinosaur",
      oracleText: "Trample",
      power: "6",
      toughness: "6",
    });
    const result = transformCreatures(
      fieldWith([generic]),
      target,
      "all",
      [],
      false,
    );
    const transformed = result.field.groups[0];

    expect(transformed.identity?.name).toBe("Colossal Dreadmaw");
    expect(transformed.statuses.tapped).toBe(true);
    expect(transformed.statuses.depowered).toBe(true);
    expect(transformed.depowerMode).toBe("all");
    expect(transformed.statuses.transformed).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});
