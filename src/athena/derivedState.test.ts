import { describe, expect, it } from "vitest";
import {
  createTokenGroup,
  mergeCompatibleStacks,
  recalculateStats,
  splitGroupForQuantity,
  withStackKey,
} from "../domain/cards";
import { applyCounters, setTrackingEnabled } from "../domain/engine";
import { calculateTotals, normalizeField } from "../domain/field";
import type { PermanentGroup, RelevantTotalKey } from "../domain/types";
import type { AthenaStaticEffectDefinition } from "../domain/staticEffects";
import {
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import {
  AthenaDerivedStateEngine,
  applyAthenaDerivedStateToField,
  buildAthenaDerivedBattlefieldState,
  createAthenaDerivedStateQueryApi,
  previewAthenaDerivedState,
  updateAthenaDerivedBattlefieldState,
} from "./derivedState";

const timestamp = "2026-08-13T12:00:00.000Z";

function creature(
  name: string,
  power = "2",
  toughness = "2",
  manaCost = "",
): PermanentGroup {
  return tracked(
    testCard({
      name,
      typeLine: "Creature - Human",
      oracleText: "",
      manaCost,
      power,
      toughness,
    }),
  );
}

function permanent(
  name: string,
  typeLine: string,
  manaCost = "",
): PermanentGroup {
  return tracked(testCard({ name, typeLine, oracleText: "", manaCost }));
}

function definition(input: {
  id: string;
  cardName: string;
  total?: RelevantTotalKey;
  operation?: "add" | "set-base";
  power?: number;
  toughness?: number;
  dependsOnDefinitionIds?: string[];
}): AthenaStaticEffectDefinition {
  const total = input.total ?? null;
  return {
    version: 1,
    id: input.id,
    abilityId: `${input.id}-ability`,
    cardNames: [input.cardName.toLowerCase()],
    category:
      input.operation === "set-base"
        ? "characteristic-defining-effect"
        : total
          ? "scaling-effect"
          : "continuous-effect",
    operation: input.operation ?? "add",
    target: {
      kind: "self",
      tokenState: "any",
      cardType: null,
      subtype: null,
      color: null,
    },
    power: {
      fixed: input.power ?? 0,
      terms: total ? [{ source: "relevant-total", total, multiplier: 1 }] : [],
    },
    toughness: {
      fixed: input.toughness ?? 0,
      terms: total ? [{ source: "relevant-total", total, multiplier: 1 }] : [],
    },
    reads: total ? [total] : [],
    dependsOnDefinitionIds: input.dependsOnDefinitionIds ?? [],
    support: "fully-automated",
  };
}

function derivedObject(field: ReturnType<typeof fieldWith>, groupId: string) {
  return buildAthenaDerivedBattlefieldState(field, { timestamp }).objects.find(
    (entry) => entry.groupId === groupId,
  );
}

describe("Athena derived battlefield state", () => {
  it("combines base values, counters, and temporary modifiers deterministically", () => {
    const base = creature("Test Creature");
    const modified = withStackKey(
      recalculateStats({
        ...base,
        counters: { "+1/+1": 2, "-1/-1": 1 },
        pt: {
          ...base.pt,
          basePower: 5,
          baseToughness: 5,
          temporaryPower: 1,
          temporaryToughness: -1,
        },
      }),
    );
    const field = fieldWith([modified]);
    const first = buildAthenaDerivedBattlefieldState(field, { timestamp });
    const second = buildAthenaDerivedBattlefieldState(field, { timestamp });
    const object = first.objects[0];

    expect(object).toMatchObject({
      basePower: 5,
      baseToughness: 5,
      counterPower: 1,
      counterToughness: 1,
      currentPower: 7,
      currentToughness: 5,
      validity: "valid",
      directBattlefieldMutation: false,
    });
    expect(first.objects).toEqual(second.objects);
    expect(modified.pt.basePower).toBe(5);
  });

  it("applies supported anthems automatically to recipients, including placeholders", () => {
    const anthem = permanent("Glorious Anthem", "Enchantment");
    const real = creature("Real Creature");
    const placeholder = genericCreature();
    const field = fieldWith([anthem, real, placeholder]);
    const applied = applyAthenaDerivedStateToField(field, { timestamp });

    expect(
      applied.field.groups.find((group) => group.id === real.id)?.pt,
    ).toMatchObject({
      currentPower: 3,
      currentToughness: 3,
      staticPower: 1,
      staticToughness: 1,
    });
    expect(
      applied.field.groups.find((group) => group.id === placeholder.id)?.pt,
    ).toMatchObject({ currentPower: 3, currentToughness: 3 });
    expect(
      applied.state.objects.find((object) => object.groupId === placeholder.id)
        ?.appliedSourceRelationshipIds,
    ).toHaveLength(1);
  });

  it("respects self exclusion, token filters, subtypes, colors, and stacked sources", () => {
    const chieftain = permanent(
      "Goblin Chieftain",
      "Creature - Goblin Warrior",
    );
    chieftain.identity!.power = "2";
    chieftain.identity!.toughness = "2";
    chieftain.pt = { ...chieftain.pt, basePower: 2, baseToughness: 2 };
    const goblin = tracked(
      testCard({
        name: "Goblin Recruit",
        typeLine: "Creature - Goblin",
        oracleText: "",
        power: "1",
        toughness: "1",
      }),
    );
    const tokenAnthem = permanent("Intangible Virtue", "Enchantment", "{1}{W}");
    const token = createTokenGroup({
      name: "Goblin Token",
      quantity: 100,
      power: 1,
      toughness: 1,
      subtypes: ["Goblin"],
    });
    const field = fieldWith([chieftain, goblin, tokenAnthem, token]);
    const state = buildAthenaDerivedBattlefieldState(field, { timestamp });

    expect(
      state.objects.find((object) => object.groupId === chieftain.id)
        ?.currentPower,
    ).toBe(2);
    expect(
      state.objects.find((object) => object.groupId === goblin.id)
        ?.currentPower,
    ).toBe(2);
    expect(
      state.objects.find((object) => object.groupId === token.id),
    ).toMatchObject({
      currentPower: 3,
      currentToughness: 3,
      quantity: 100,
      grouped: true,
    });
    expect(state.objects).toHaveLength(3);
  });

  it("removes and restores continuous effects immediately with tracking", () => {
    const anthem = permanent("Glorious Anthem", "Enchantment");
    const recipient = genericCreature();
    const active = fieldWith([anthem, recipient]);
    const stopped = setTrackingEnabled(
      active,
      anthem.id,
      false,
      "all",
      1,
    ).field;
    const resumed = setTrackingEnabled(
      stopped,
      anthem.id,
      true,
      "all",
      1,
    ).field;

    expect(derivedObject(active, recipient.id)?.currentPower).toBe(3);
    expect(derivedObject(stopped, recipient.id)?.currentPower).toBe(2);
    expect(derivedObject(resumed, recipient.id)?.currentPower).toBe(3);
    expect(calculateTotals(stopped.groups).enchantments).toBe(1);
  });

  it("keeps Depower independent and ability-specific", () => {
    const anthem = permanent("Glorious Anthem", "Enchantment");
    const recipient = genericCreature();
    const disabledAll = fieldWith([
      { ...anthem, depowerMode: "all", abilitiesActive: false },
      recipient,
    ]);
    const triggeredOnly = fieldWith([
      { ...anthem, depowerMode: "triggered", abilitiesActive: false },
      recipient,
    ]);
    const selected = fieldWith([
      {
        ...anthem,
        depowerMode: "selected",
        disabledAbilities: ["controlled-creatures-plus-one"],
      },
      recipient,
    ]);

    expect(derivedObject(disabledAll, recipient.id)?.currentPower).toBe(2);
    expect(derivedObject(triggeredOnly, recipient.id)?.currentPower).toBe(3);
    expect(derivedObject(selected, recipient.id)?.currentPower).toBe(2);
  });

  it("recalculates attachment bonuses for attach, detach, and reattach", () => {
    const first = genericCreature();
    const second = {
      ...genericCreature(),
      id: "second-creature",
      label: "Second",
    };
    const equipment = {
      ...permanent("Bonesplitter", "Artifact - Equipment"),
      attachedTo: first.id,
    };
    const attached = fieldWith([first, second, equipment]);
    const reattached = fieldWith([
      first,
      second,
      { ...equipment, attachedTo: second.id },
    ]);
    const detached = fieldWith([
      first,
      second,
      { ...equipment, attachedTo: null },
    ]);

    expect(derivedObject(attached, first.id)?.currentPower).toBe(4);
    expect(derivedObject(attached, first.id)?.currentToughness).toBe(2);
    expect(derivedObject(reattached, first.id)?.currentPower).toBe(2);
    expect(derivedObject(reattached, second.id)?.currentPower).toBe(4);
    expect(derivedObject(detached, second.id)?.currentPower).toBe(2);
  });

  it("combines counters, Equipment, and an anthem through the required correction path", () => {
    const host = withStackKey(
      recalculateStats({
        ...genericCreature(),
        counters: { "+1/+1": 2 },
      }),
    );
    const anthem = permanent("Glorious Anthem", "Enchantment");
    const equipment = {
      ...permanent("Bonesplitter", "Artifact - Equipment"),
      attachedTo: host.id,
    };
    const initial = fieldWith([host, anthem, equipment]);
    expect(derivedObject(initial, host.id)).toMatchObject({
      currentPower: 7,
      currentToughness: 5,
    });

    const detached = fieldWith([
      host,
      anthem,
      { ...equipment, attachedTo: null },
    ]);
    expect(derivedObject(detached, host.id)).toMatchObject({
      currentPower: 5,
      currentToughness: 5,
    });

    const stopped = setTrackingEnabled(
      detached,
      anthem.id,
      false,
      "all",
      1,
    ).field;
    expect(derivedObject(stopped, host.id)).toMatchObject({
      currentPower: 4,
      currentToughness: 4,
    });

    const corrected = applyCounters(
      stopped,
      host.id,
      "+1/+1",
      1,
      "all",
      1,
      "correction",
    );
    expect(derivedObject(corrected.field, host.id)).toMatchObject({
      currentPower: 5,
      currentToughness: 5,
    });
    expect(corrected.events).toHaveLength(0);
  });

  it("changes current static relationships on transformation without treating it as entry", () => {
    const anthem = permanent("Glorious Anthem", "Enchantment");
    const recipient = genericCreature();
    const front = fieldWith([anthem, recipient]);
    const backIdentity = testCard({
      name: "Quiet Back Face",
      typeLine: "Enchantment",
      oracleText: "",
    });
    const transformed = fieldWith([
      {
        ...anthem,
        identity: backIdentity,
        characteristics: {
          ...anthem.characteristics,
          cardTypes: ["Enchantment"],
        },
        statuses: { ...anthem.statuses, transformed: true },
      },
      recipient,
    ]);
    const restored = fieldWith([anthem, recipient]);

    expect(derivedObject(front, recipient.id)?.currentPower).toBe(3);
    expect(derivedObject(transformed, recipient.id)?.currentPower).toBe(2);
    expect(derivedObject(restored, recipient.id)?.currentPower).toBe(3);
    expect(transformed.groups).toHaveLength(2);
  });

  it("uses exact grouped totals for characteristic-defining values", () => {
    const reader = permanent(
      "Darksteel Juggernaut",
      "Artifact Creature - Juggernaut",
    );
    reader.identity!.power = "*";
    reader.identity!.toughness = "*";
    reader.pt = {
      ...reader.pt,
      printedPower: null,
      printedToughness: null,
      basePower: null,
      baseToughness: null,
    };
    const treasures = createTokenGroup({
      name: "Treasure",
      quantity: 1000,
      power: 0,
      toughness: 0,
      subtypes: ["Treasure"],
    });
    treasures.characteristics.cardTypes = ["Artifact"];
    treasures.characteristics.isCreature = false;
    const equipment = permanent("Equipment", "Artifact - Equipment");
    const field = fieldWith([reader, treasures, equipment]);
    const state = buildAthenaDerivedBattlefieldState(field, { timestamp });
    const object = state.objects.find((entry) => entry.groupId === reader.id);

    expect(state.relevantTotals.artifacts).toBe(1002);
    expect(object).toMatchObject({
      characteristicPower: 1002,
      characteristicToughness: 1002,
      currentPower: 1002,
      currentToughness: 1002,
    });
    expect(state.objects).toHaveLength(1);
  });

  it("supports devotion and overlapping total contributions without double counting", () => {
    const primalcrux = creature("Primalcrux", "*", "*", "{G}{G}{G}{G}{G}{G}");
    primalcrux.pt = {
      ...primalcrux.pt,
      printedPower: null,
      printedToughness: null,
      basePower: null,
      baseToughness: null,
    };
    const hybrid = creature("Hybrid", "1", "1", "{G/U}{G}");
    hybrid.characteristics.cardTypes = ["Artifact", "Creature"];
    hybrid.characteristics.isToken = true;
    const field = fieldWith([primalcrux, hybrid]);
    const state = buildAthenaDerivedBattlefieldState(field, { timestamp });

    expect(state.relevantTotals.devotionGreen).toBe(8);
    expect(state.relevantTotals.devotionBlue).toBe(1);
    expect(state.relevantTotals.artifacts).toBe(1);
    expect(state.relevantTotals.creatures).toBe(2);
    expect(state.relevantTotals.tokens).toBe(1);
    expect(
      state.objects.find((entry) => entry.groupId === primalcrux.id)
        ?.currentPower,
    ).toBe(8);
  });

  it("preserves a manual base override when it conflicts with a characteristic definition", () => {
    const reader = creature("Artifact Reader", "0", "0");
    reader.pt = { ...reader.pt, basePower: 5, baseToughness: 5 };
    const custom = definition({
      id: "artifact-reader",
      cardName: "Artifact Reader",
      total: "artifacts",
      operation: "set-base",
    });
    const field = fieldWith([reader, permanent("Rock", "Artifact")]);
    const state = buildAthenaDerivedBattlefieldState(field, {
      timestamp,
      definitions: [custom],
    });

    expect(state.objects[0]).toMatchObject({
      currentPower: 5,
      currentToughness: 5,
      validity: "manual-resolution-required",
    });
    expect(state.objects[0].reasonCodes).toContain("base-override-preserved");
  });

  it("restores printed values to the normal derived calculation path", () => {
    const printed = creature("Printed Creature", "2", "3");
    const overridden = withStackKey(
      recalculateStats({
        ...printed,
        pt: { ...printed.pt, basePower: 5, baseToughness: 6 },
      }),
    );
    const restored = withStackKey(
      recalculateStats({
        ...overridden,
        pt: {
          ...overridden.pt,
          basePower: overridden.pt.printedPower,
          baseToughness: overridden.pt.printedToughness,
        },
      }),
    );

    expect(derivedObject(fieldWith([overridden]), overridden.id)).toMatchObject(
      { currentPower: 5, currentToughness: 6 },
    );
    expect(derivedObject(fieldWith([restored]), restored.id)).toMatchObject({
      currentPower: 2,
      currentToughness: 3,
    });
  });

  it("reads established battlefield and zone totals through one static model", () => {
    const totals: RelevantTotalKey[] = [
      "equipment",
      "lands",
      "creatures",
      "tokens",
      "cardsInHand",
      "cardsInGraveyard",
      "cardsInExile",
    ];
    const readers = totals.map((total) =>
      creature(`${total} Reader`, "0", "0"),
    );
    const definitions = totals.map((total) =>
      definition({
        id: `${total}-reader`,
        cardName: `${total} Reader`,
        total,
        operation: "set-base",
      }),
    );
    const equipment = permanent("Equipment Stack", "Artifact - Equipment");
    equipment.quantity = 3;
    const lands = permanent("Forest Stack", "Basic Land - Forest");
    lands.quantity = 4;
    const tokens = createTokenGroup({
      name: "Soldier",
      quantity: 5,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const hand = {
      ...permanent("Hand Cards", "Sorcery"),
      zone: "hand" as const,
      quantity: 6,
    };
    const graveyard = {
      ...permanent("Graveyard Cards", "Instant"),
      zone: "graveyard" as const,
      quantity: 7,
    };
    const exile = {
      ...permanent("Exiled Cards", "Artifact"),
      zone: "exile" as const,
      quantity: 8,
    };
    const state = buildAthenaDerivedBattlefieldState(
      fieldWith([...readers, equipment, lands, tokens, hand, graveyard, exile]),
      { timestamp, definitions },
    );

    for (const [index, total] of totals.entries()) {
      expect(
        state.objects.find((object) => object.groupId === readers[index].id)
          ?.currentPower,
      ).toBe(state.relevantTotals[total]);
    }
  });

  it("keeps source tracking and Depower independent from recipient tracking", () => {
    const host = { ...genericCreature(), trackingEnabled: false };
    const equipment = {
      ...permanent("Bonesplitter", "Artifact - Equipment"),
      attachedTo: host.id,
    };
    const notTracked = { ...equipment, trackingEnabled: false };
    const depowered = {
      ...equipment,
      abilitiesActive: false,
      depowerMode: "all" as const,
    };

    expect(
      derivedObject(fieldWith([host, equipment]), host.id)?.currentPower,
    ).toBe(4);
    expect(
      derivedObject(fieldWith([host, notTracked]), host.id)?.currentPower,
    ).toBe(2);
    expect(
      derivedObject(fieldWith([host, depowered]), host.id)?.currentPower,
    ).toBe(2);
  });

  it("rebuilds separate split stacks and removes stale entries after merge", () => {
    const stack = createTokenGroup({
      name: "Soldier",
      quantity: 3,
      power: 2,
      toughness: 2,
      subtypes: ["Soldier"],
    });
    const split = splitGroupForQuantity([stack], stack.id, 1);
    const divergent = split.groups.map((group) =>
      group.id === split.targetId
        ? withStackKey(recalculateStats({ ...group, counters: { "+1/+1": 1 } }))
        : withStackKey(recalculateStats(group)),
    );
    const splitField = fieldWith(divergent);
    const splitState = buildAthenaDerivedBattlefieldState(splitField, {
      timestamp,
    });

    expect(splitState.objects).toHaveLength(2);
    expect(
      splitState.objects.find((object) => object.groupId === split.targetId)
        ?.currentPower,
    ).toBe(3);

    const compatible = divergent.map((group) =>
      withStackKey(recalculateStats({ ...group, counters: {} })),
    );
    const mergedField = fieldWith(mergeCompatibleStacks(compatible));
    const update = updateAthenaDerivedBattlefieldState(
      splitState,
      mergedField,
      {
        timestamp,
        change: { kind: "stack-merge", groupIds: [stack.id] },
      },
    );

    expect(update.state.objects).toHaveLength(1);
    expect(update.state.objects[0].quantity).toBe(3);
    expect(update.staleGroupIdsRemoved).toContain(split.targetId);
  });

  it("updates correction-only counter state without generating derived side effects", () => {
    const recipient = genericCreature();
    const field = fieldWith([
      permanent("Glorious Anthem", "Enchantment"),
      recipient,
    ]);
    const corrected = applyCounters(
      field,
      recipient.id,
      "+1/+1",
      1,
      "all",
      1,
      "correction",
    );
    const applied = applyAthenaDerivedStateToField(corrected.field, {
      timestamp,
    });
    const updated = applied.field.groups.find(
      (group) => group.id === recipient.id,
    );

    expect(updated?.pt.currentPower).toBe(4);
    expect(updated?.pt.currentToughness).toBe(4);
    expect(corrected.events).toHaveLength(0);
  });

  it("keeps planner and Action Strip style previews hypothetical", () => {
    const reader = permanent(
      "Darksteel Juggernaut",
      "Artifact Creature - Juggernaut",
    );
    reader.pt = {
      ...reader.pt,
      basePower: null,
      baseToughness: null,
      printedPower: null,
      printedToughness: null,
    };
    const artifact = permanent("Rock", "Artifact");
    const field = fieldWith([reader, artifact]);
    const before = structuredClone(field);
    const preview = previewAthenaDerivedState(
      field,
      {
        source: "planner",
        relevantTotalDeltas: { artifacts: 5 },
      },
      { timestamp },
    );

    expect(preview.current.objects[0].currentPower).toBe(2);
    expect(preview.preview.objects[0].currentPower).toBe(7);
    expect(preview.changedGroupIds).toEqual([reader.id]);
    expect(preview.committedFieldMutated).toBe(false);
    expect(field).toEqual(before);
  });

  it("produces equivalent incremental and full rebuild results with scoped dirty nodes", () => {
    const artifactReader = creature("Artifact Reader", "0", "0");
    const landReader = creature("Land Reader", "0", "0");
    const definitions = [
      definition({
        id: "artifact-reader",
        cardName: "Artifact Reader",
        total: "artifacts",
        operation: "set-base",
      }),
      definition({
        id: "land-reader",
        cardName: "Land Reader",
        total: "lands",
        operation: "set-base",
      }),
    ];
    const field = fieldWith([
      artifactReader,
      landReader,
      permanent("Rock", "Artifact"),
    ]);
    const previous = buildAthenaDerivedBattlefieldState(field, {
      timestamp,
      definitions,
    });
    const nextField = fieldWith([
      ...field.groups,
      permanent("Second Rock", "Artifact"),
    ]);
    const update = updateAthenaDerivedBattlefieldState(previous, nextField, {
      timestamp,
      definitions,
      change: {
        kind: "relevant-total-changed",
        relevantTotals: ["artifacts"],
      },
    });

    expect(update.equivalentToFullRebuild).toBe(true);
    expect(update.changedGroupIds).toContain(artifactReader.id);
    expect(update.changedGroupIds).not.toContain(landReader.id);
  });

  it("detects static dependency cycles without looping", () => {
    const source = creature("Cycle Source");
    const first = definition({
      id: "cycle-a",
      cardName: "Cycle Source",
      power: 1,
      dependsOnDefinitionIds: ["cycle-b"],
    });
    const second = definition({
      id: "cycle-b",
      cardName: "Cycle Source",
      toughness: 1,
      dependsOnDefinitionIds: ["cycle-a"],
    });
    const state = buildAthenaDerivedBattlefieldState(fieldWith([source]), {
      timestamp,
      definitions: [first, second],
    });

    expect(state.cycleDefinitionIds).toEqual(["cycle-a", "cycle-b"]);
    expect(state.diagnostics.cycleDetectionCount).toBe(2);
    expect(state.objects[0].validity).toBe("authority-required");
  });

  it("rejects corrupt and overflowing static values without changing canonical state", () => {
    const source = creature("Overflow Source");
    source.quantity = 2;
    const invalid = definition({
      id: "overflow-source",
      cardName: "Overflow Source",
      power: Number.MAX_SAFE_INTEGER,
    });
    const field = fieldWith([source]);
    const before = structuredClone(field);
    const state = buildAthenaDerivedBattlefieldState(field, {
      timestamp,
      definitions: [invalid],
    });

    expect(state.objects[0].validity).toBe("manual-resolution-required");
    expect(state.objects[0].reasonCodes).toContain("static-value-overflow");
    expect(field).toEqual(before);
  });

  it("reports unstructured static relationships without executing Oracle text", () => {
    const unknown = tracked(
      testCard({
        name: "Unknown Scaling Creature",
        typeLine: "Creature",
        oracleText:
          "Unknown Scaling Creature's power is equal to the number of artifacts you control.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const state = buildAthenaDerivedBattlefieldState(
      fieldWith([unknown, permanent("Rock", "Artifact")]),
      { timestamp },
    );
    const object = state.objects.find((entry) => entry.groupId === unknown.id)!;

    expect(object.currentPower).toBe(1);
    expect(object.validity).toBe("unsupported");
    expect(object.reasonCodes).toContain("unsupported-static-relationship");
  });

  it("uses authoritative derived values without relabeling local helpers", () => {
    const recipient = genericCreature();
    const local = buildAthenaDerivedBattlefieldState(fieldWith([recipient]), {
      timestamp,
    });
    const authoritative = buildAthenaDerivedBattlefieldState(
      fieldWith([recipient]),
      {
        timestamp,
        authoritativeValues: [
          {
            groupId: recipient.id,
            currentPower: 9,
            currentToughness: 11,
            sourceReference: "boardstate-result",
          },
        ],
      },
    );

    expect(local.objects[0].authoritySource).toBe("lite-local-helper-result");
    expect(authoritative.objects[0]).toMatchObject({
      currentPower: 9,
      currentToughness: 11,
      authoritySource: "boardstate-authoritative-result",
    });
    expect(authoritative.diagnostics.authorityOverrideCount).toBe(1);
  });

  it("rejects stale and cancelled work without applying it", () => {
    const field = fieldWith([genericCreature()]);
    const stale = applyAthenaDerivedStateToField(field, {
      timestamp,
      expectedCanonicalFingerprint: "obsolete",
    });
    const cancelled = buildAthenaDerivedBattlefieldState(field, {
      timestamp,
      cancellation: { cancelled: true, reason: "Superseded." },
    });

    expect(stale.applied).toBe(false);
    expect(stale.field).toBe(field);
    expect(stale.state.validity).toBe("stale");
    expect(cancelled.validity).toBe("cancelled");
  });

  it("exposes defensive query results and discardable caching", () => {
    const recipient = genericCreature();
    const field = normalizeField(
      fieldWith([permanent("Glorious Anthem", "Enchantment"), recipient]),
    );
    const engine = new AthenaDerivedStateEngine();
    const state = engine.build(field, { timestamp });
    engine.build(field, { timestamp });
    const query = createAthenaDerivedStateQueryApi(state);
    const object = query.getObject(recipient.id)!;
    object.reasonCodes.push("mutated-copy");

    expect(query.getCurrentPowerToughness(recipient.id)).toEqual({
      power: 3,
      toughness: 3,
    });
    expect(query.getObject(recipient.id)?.reasonCodes).not.toContain(
      "mutated-copy",
    );
    expect(engine.getDiagnostics()).toMatchObject({
      buildCount: 1,
      cacheHitCount: 1,
      cacheMissCount: 1,
      cacheSize: 1,
    });

    engine.build(
      {
        ...field,
        player: { ...field.player, life: field.player.life - 1 },
      },
      { timestamp },
    );
    expect(engine.getDiagnostics()).toMatchObject({
      buildCount: 1,
      cacheHitCount: 2,
      cacheSize: 1,
    });

    for (let index = 0; index < 70; index += 1) {
      engine.build({ ...field, id: `field-${index}` }, { timestamp });
    }
    expect(engine.getDiagnostics().cacheSize).toBeLessThanOrEqual(64);
    engine.discard();
    expect(engine.getDiagnostics().cacheSize).toBe(0);
  });

  it("handles a large grouped battlefield without per-token derived allocation", () => {
    const groups = Array.from({ length: 40 }, (_, index) =>
      creature(`Creature ${index}`),
    );
    const treasures = createTokenGroup({
      name: "Treasure",
      quantity: 999_999,
      power: 0,
      toughness: 0,
      subtypes: ["Treasure"],
    });
    treasures.characteristics.cardTypes = ["Artifact"];
    treasures.characteristics.isCreature = false;
    const started = performance.now();
    const state = buildAthenaDerivedBattlefieldState(
      fieldWith([
        permanent("Glorious Anthem", "Enchantment"),
        ...groups,
        treasures,
      ]),
      { timestamp },
    );

    expect(state.objects).toHaveLength(40);
    expect(state.relevantTotals.artifacts).toBe(999_999);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
