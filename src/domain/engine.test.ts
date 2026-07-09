import { describe, expect, it } from "vitest";
import { createGenericGroup } from "./cards";
import {
  activateField,
  applyCounters,
  replaceGenericIdentity,
  resolveLandEntry,
  restoreTransformations,
  setTrackingEnabled,
  transformCreatures,
} from "./engine";
import {
  calculateTotals,
  createDefaultField,
  sanitizeImportedField,
} from "./field";
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

  it("stops and resumes tracking a real card without removing it from totals", () => {
    const anim = tracked(animPakal());
    const stopped = setTrackingEnabled(
      fieldWith([anim]),
      anim.id,
      false,
      "all",
      1,
    );
    const stoppedAnim = stopped.field.groups.find((group) =>
      group.identity?.name.includes("Anim Pakal"),
    );
    const ignored = activateField(stopped.field);
    const resumed = setTrackingEnabled(
      stopped.field,
      stoppedAnim?.id ?? anim.id,
      true,
      "all",
      1,
    );
    const activeAgain = activateField(resumed.field);

    expect(stoppedAnim?.trackingEnabled).toBe(false);
    expect(stoppedAnim?.counters).toEqual({});
    expect(calculateTotals(stopped.field.groups).creatures).toBe(1);
    expect(
      ignored.field.groups.find((group) => group.label === "Gnome"),
    ).toBeUndefined();
    expect(ignored.summary.join(" ")).toContain(
      "No supported active abilities resolved",
    );
    expect(
      resumed.field.groups.find((group) =>
        group.identity?.name.includes("Anim Pakal"),
      )?.trackingEnabled,
    ).toBe(true);
    expect(
      activeAgain.field.groups.find((group) => group.label === "Gnome")
        ?.quantity,
    ).toBe(1);
  });

  it("keeps a not-tracked creature as an eligible recipient for tracked effects", () => {
    const anim = tracked(animPakal());
    const crusade = tracked(catharsCrusade());
    const bear = tracked(
      testCard({
        name: "Runeclaw Bear",
        typeLine: "Creature - Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
      }),
    );
    const stoppedBear = setTrackingEnabled(
      fieldWith([bear]),
      bear.id,
      false,
      "all",
      1,
    ).field.groups[0];

    const result = activateField(fieldWith([anim, crusade, stoppedBear]));
    const bearAfter = result.field.groups.find(
      (group) => group.identity?.name === "Runeclaw Bear",
    );

    expect(bearAfter?.trackingEnabled).toBe(false);
    expect(bearAfter?.counters["+1/+1"]).toBe(1);
    expect(bearAfter?.pt.currentPower).toBe(3);
    expect(bearAfter?.pt.currentToughness).toBe(3);
  });

  it("ignores a not-tracked Cathars Crusade while preserving its enchantment total", () => {
    const anim = tracked(animPakal());
    const crusade = tracked(catharsCrusade());
    const stoppedCrusade = setTrackingEnabled(
      fieldWith([crusade]),
      crusade.id,
      false,
      "all",
      1,
    ).field.groups[0];

    const result = activateField(fieldWith([anim, stoppedCrusade]));
    const gnomes = result.field.groups.find((group) => group.label === "Gnome");

    expect(gnomes?.quantity).toBe(1);
    expect(gnomes?.counters["+1/+1"]).toBeUndefined();
    expect(calculateTotals(result.field.groups).enchantments).toBe(1);
  });

  it("ignores a not-tracked Doubling Season replacement effect", () => {
    const season = tracked(doublingSeason());
    const stoppedSeason = setTrackingEnabled(
      fieldWith([season]),
      season.id,
      false,
      "all",
      1,
    ).field.groups[0];
    const creature = genericCreature();

    const counters = applyCounters(
      fieldWith([stoppedSeason, creature]),
      creature.id,
      "+1/+1",
      1,
      "all",
      1,
      "game-action",
    );
    const activation = activateField(
      fieldWith([tracked(animPakal()), stoppedSeason]),
    );

    expect(
      counters.field.groups.find((group) => group.id === creature.id)?.counters[
        "+1/+1"
      ],
    ).toBe(1);
    expect(
      activation.field.groups.find((group) => group.label === "Gnome")
        ?.quantity,
    ).toBe(1);
    expect(calculateTotals(activation.field.groups).enchantments).toBe(1);
  });

  it("filters not-tracked landfall sources from background watchers", () => {
    const baloths = tracked(rampagingBaloths());
    const stoppedBaloths = setTrackingEnabled(
      fieldWith([baloths]),
      baloths.id,
      false,
      "all",
      1,
    ).field.groups[0];
    const ignored = resolveLandEntry(
      fieldWith([stoppedBaloths]),
      2,
      "one-at-a-time",
    );
    const active = resolveLandEntry(
      fieldWith([tracked(rampagingBaloths())]),
      2,
      "one-at-a-time",
    );

    expect(
      ignored.field.groups.find((group) => group.label === "Beast"),
    ).toBeUndefined();
    expect(
      active.field.groups.find((group) => group.label === "Beast")?.quantity,
    ).toBe(2);
  });

  it("splits and merges stacks when tracking changes for part of a stack", () => {
    const scute = tracked(
      testCard({
        name: "Scute Swarm",
        typeLine: "Creature - Insect",
        oracleText: "Landfall",
        power: "1",
        toughness: "1",
      }),
      8,
    );
    const stopped = setTrackingEnabled(
      fieldWith([scute]),
      scute.id,
      false,
      "custom",
      3,
    );
    const stoppedGroup = stopped.field.groups.find(
      (group) => group.trackingEnabled === false,
    );
    const trackedGroup = stopped.field.groups.find(
      (group) => group.trackingEnabled !== false,
    );
    const resumed = setTrackingEnabled(
      stopped.field,
      stoppedGroup?.id ?? "",
      true,
      "all",
      1,
    );

    expect(stoppedGroup?.quantity).toBe(3);
    expect(trackedGroup?.quantity).toBe(5);
    expect(resumed.field.groups).toHaveLength(1);
    expect(resumed.field.groups[0].quantity).toBe(8);
    expect(resumed.field.groups[0].trackingEnabled).toBe(true);
  });

  it("preserves tracking state through transform and restore", () => {
    const anim = tracked(animPakal());
    const stopped = setTrackingEnabled(
      fieldWith([anim]),
      anim.id,
      false,
      "all",
      1,
    );
    const target = testCard({
      name: "Colossal Dreadmaw",
      typeLine: "Creature - Dinosaur",
      oracleText: "Trample",
      power: "6",
      toughness: "6",
    });
    const transformed = transformCreatures(
      stopped.field,
      target,
      "all",
      [],
      false,
    );
    const restored = restoreTransformations(transformed.field);

    expect(transformed.field.groups[0].trackingEnabled).toBe(false);
    expect(transformed.field.groups[0].identity?.name).toBe(
      "Colossal Dreadmaw",
    );
    expect(restored.field.groups[0].trackingEnabled).toBe(false);
    expect(restored.field.groups[0].identity?.name).toContain("Anim Pakal");
  });

  it("keeps not-tracked separate from depower state", () => {
    const anim = tracked(animPakal());
    const depowered = {
      ...anim,
      abilitiesActive: false,
      depowerMode: "all" as const,
      statuses: { ...anim.statuses, depowered: true },
    };
    const stopped = setTrackingEnabled(
      fieldWith([depowered]),
      depowered.id,
      false,
      "all",
      1,
    ).field.groups[0];
    const resumed = setTrackingEnabled(
      fieldWith([stopped]),
      stopped.id,
      true,
      "all",
      1,
    ).field.groups[0];

    expect(stopped.trackingEnabled).toBe(false);
    expect(stopped.depowerMode).toBe("all");
    expect(stopped.abilitiesActive).toBe(false);
    expect(resumed.trackingEnabled).toBe(true);
    expect(resumed.depowerMode).toBe("all");
    expect(resumed.abilitiesActive).toBe(false);
  });

  it("migrates and persists explicit tracking state safely", () => {
    const anim = tracked(animPakal());
    const savedWithoutTracking = {
      ...createDefaultField(),
      groups: [{ ...anim, trackingEnabled: undefined }],
    };
    const migrated = sanitizeImportedField(savedWithoutTracking);
    const stopped = setTrackingEnabled(
      fieldWith([anim]),
      anim.id,
      false,
      "all",
      1,
    );
    const reloaded = sanitizeImportedField(
      JSON.parse(JSON.stringify(stopped.field)),
    );
    const corrupted = sanitizeImportedField({
      ...stopped.field,
      groups: [{ ...stopped.field.groups[0], trackingEnabled: "nope" }],
    });

    expect(migrated?.groups[0].trackingEnabled).toBe(true);
    expect(reloaded?.groups[0].trackingEnabled).toBe(false);
    expect(corrupted?.groups[0].trackingEnabled).toBe(true);
  });
});
