import { describe, expect, it } from "vitest";
import { createCardGroup, createGenericGroup } from "./cards";
import { normalizeField, sanitizeImportedField } from "./field";
import type { CardIdentity, FieldState } from "./types";
import { buildAthenaDerivedBattlefieldState } from "../athena/derivedState";
import { buildAthenaDependencyGraph } from "../athena/dependencyGraph";
import { applyAthenaCanonicalConsequenceEvent } from "../athena/triggerResolution";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "../athena/eventForecast";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { fieldWith, testCard, tracked } from "../test/factories";
import type { AthenaStaticEffectDefinition } from "./staticEffects";
import type { RelevantTotalKey } from "./types";
import {
  applyAuthoritativeZoneCategoryTotals,
  applyDeckSnapshotZoneContext,
  applyZoneCompositionCorrection,
  getZoneCategoryOptions,
  getZoneCompositionSnapshot,
  manualZoneColorOptions,
  reconcileUnknownZoneGroupIdentity,
  reconcileZoneGroupFromDeckSnapshot,
  setActiveCommanderIdentity,
  zoneCategoryRelevantTotals,
} from "./zoneComposition";

const timestamp = "2026-08-14T12:00:00.000Z";

function multitypeCard(overrides: Partial<CardIdentity> = {}): CardIdentity {
  return testCard({
    cardId: "known-dragon",
    name: "Known Dragon",
    typeLine: "Legendary Artifact Creature - Dragon",
    oracleText: "",
    colors: ["R", "G"],
    colorIdentity: ["B", "R", "G"],
    power: "5",
    toughness: "5",
    ...overrides,
  });
}

function zoneField(
  zone: "graveyard" | "exile",
  groups: FieldState["groups"],
): FieldState {
  return normalizeField(fieldWith(groups.map((group) => ({ ...group, zone }))));
}

function zoneReaderDefinition(
  id: string,
  cardName: string,
  total: RelevantTotalKey,
): AthenaStaticEffectDefinition {
  return {
    version: 1,
    id,
    abilityId: `${id}-ability`,
    cardNames: [cardName.toLowerCase()],
    category: "characteristic-defining-effect",
    operation: "set-base",
    target: {
      kind: "self",
      tokenState: "any",
      cardType: null,
      subtype: null,
      color: null,
    },
    power: {
      fixed: 0,
      terms: [{ source: "relevant-total", total, multiplier: 1 }],
    },
    toughness: {
      fixed: 0,
      terms: [{ source: "relevant-total", total, multiplier: 1 }],
    },
    reads: [total],
    dependsOnDefinitionIds: [],
    support: "fully-automated",
  };
}

describe("ATHENA-09 categorical zone composition", () => {
  it("classifies overlapping card types, characteristics, colors, and subtypes without changing physical count", () => {
    const card = multitypeCard();
    let field = zoneField("graveyard", [createCardGroup(card, 1, "graveyard")]);
    field = setActiveCommanderIdentity(
      field,
      card,
      "canonical-card",
      timestamp,
    );

    const snapshot = getZoneCompositionSnapshot(field, "graveyard");

    expect(snapshot.physicalTotal).toBe(1);
    expect(snapshot.categoryTotals).toMatchObject({
      creature: 1,
      artifact: 1,
      legendary: 1,
      commander: 1,
      historic: 1,
      red: 1,
      green: 1,
      multicolor: 1,
      nontoken: 1,
      "subtype:dragon": 1,
    });
    expect(
      Object.values(snapshot.categoryTotals).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
    ).toBeGreaterThan(snapshot.physicalTotal);
  });

  it("keeps unknown color information separate from known colorless cards", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard card",
      zone: "graveyard",
    });
    const colorless = createCardGroup(
      multitypeCard({
        cardId: "colorless-card",
        name: "Colorless Card",
        typeLine: "Artifact",
        colors: [],
        colorIdentity: [],
      }),
      1,
      "graveyard",
    );
    const snapshot = getZoneCompositionSnapshot(
      zoneField("graveyard", [unknown, colorless]),
      "graveyard",
    );

    expect(snapshot.physicalTotal).toBe(2);
    expect(snapshot.unaccountedPhysicalCards).toBe(1);
    expect(snapshot.categoryTotals.colorless).toBe(1);
    expect(
      snapshot.categories.find((entry) => entry.key === "colorless")?.exact,
    ).toBe(false);
  });

  it("accepts overlapping exact category corrections and rejects negative or impossible values", () => {
    const base = zoneField("graveyard", [
      createGenericGroup({
        kind: "Custom",
        label: "Unknown graveyard cards",
        zone: "graveyard",
        quantity: 10,
      }),
    ]);
    const corrected = applyZoneCompositionCorrection(base, {
      zone: "graveyard",
      categoryTotals: {
        creature: 6,
        artifact: 4,
        black: 7,
        red: 5,
      },
      timestamp,
    });

    expect(corrected.ok).toBe(true);
    const snapshot = getZoneCompositionSnapshot(corrected.field, "graveyard");
    expect(snapshot.physicalTotal).toBe(10);
    expect(snapshot.categoryTotals).toMatchObject({
      creature: 6,
      artifact: 4,
      black: 7,
      red: 5,
    });
    expect(
      Object.values(snapshot.categoryTotals).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
    ).toBeGreaterThan(10);
    expect(
      applyZoneCompositionCorrection(base, {
        zone: "graveyard",
        categoryTotals: { creature: -1 },
      }).ok,
    ).toBe(false);
    expect(
      applyZoneCompositionCorrection(base, {
        zone: "graveyard",
        categoryTotals: { creature: 11 },
      }).ok,
    ).toBe(false);
  });

  it("clamps each overlapping manual membership independently when the physical total is lowered", () => {
    const initial = applyZoneCompositionCorrection(
      zoneField("graveyard", [
        createGenericGroup({
          kind: "Custom",
          zone: "graveyard",
          quantity: 10,
        }),
      ]),
      {
        zone: "graveyard",
        categoryTotals: { creature: 6, artifact: 4, black: 7 },
        timestamp,
      },
    );
    const lowered = applyZoneCompositionCorrection(initial.field, {
      zone: "graveyard",
      physicalTotal: 5,
      timestamp,
    });

    expect(lowered.ok).toBe(true);
    expect(
      getZoneCompositionSnapshot(lowered.field, "graveyard"),
    ).toMatchObject({
      physicalTotal: 5,
      categoryTotals: { creature: 5, artifact: 4, black: 5 },
    });
  });

  it("tracks unaccounted physical cards independently from category memberships", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown exile cards",
      zone: "exile",
      quantity: 4,
    });
    const field = zoneField("exile", [unknown]);
    const categoryOnly = applyZoneCompositionCorrection(field, {
      zone: "exile",
      categoryTotals: { creature: 2, red: 2, artifact: 1 },
      timestamp,
    });
    expect(
      getZoneCompositionSnapshot(categoryOnly.field, "exile"),
    ).toMatchObject({
      physicalTotal: 4,
      unaccountedPhysicalCards: 4,
    });

    const accounted = applyZoneCompositionCorrection(categoryOnly.field, {
      zone: "exile",
      manuallyAccountedPhysicalCards: 2,
      timestamp,
    });
    expect(getZoneCompositionSnapshot(accounted.field, "exile")).toMatchObject({
      physicalTotal: 4,
      accountedPhysicalCards: 2,
      unaccountedPhysicalCards: 2,
    });
  });

  it("does not infer untouched categories when manually accounted cards remain unidentified", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard cards",
      zone: "graveyard",
      quantity: 2,
    });
    const corrected = applyZoneCompositionCorrection(
      zoneField("graveyard", [unknown]),
      {
        zone: "graveyard",
        categoryTotals: { creature: 2 },
        manuallyAccountedPhysicalCards: 2,
        timestamp,
      },
    );
    const snapshot = getZoneCompositionSnapshot(corrected.field, "graveyard");

    expect(snapshot.unaccountedPhysicalCards).toBe(0);
    expect(snapshot.completelyAccounted).toBe(false);
    expect(
      snapshot.categories.find((category) => category.key === "creature"),
    ).toMatchObject({ value: 2, exact: true });
    expect(
      snapshot.categories.find((category) => category.key === "red"),
    ).toMatchObject({ value: 0, exact: false });
  });

  it("invalidates exact manual categories for unknown zone movement but preserves them for known movement", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      zone: "graveyard",
      quantity: 2,
    });
    const corrected = applyZoneCompositionCorrection(
      zoneField("graveyard", [unknown]),
      {
        zone: "graveyard",
        categoryTotals: { creature: 2 },
        timestamp,
      },
    );
    const unknownArrival = normalizeField({
      ...corrected.field,
      groups: [
        ...corrected.field.groups,
        createGenericGroup({ kind: "Custom", zone: "graveyard" }),
      ],
    });
    const knownArrival = normalizeField({
      ...corrected.field,
      groups: [
        ...corrected.field.groups,
        createCardGroup(
          testCard({
            name: "Known Arrival",
            typeLine: "Creature - Human",
            oracleText: "",
          }),
          1,
          "graveyard",
        ),
      ],
    });

    expect(
      getZoneCompositionSnapshot(unknownArrival, "graveyard").categories.find(
        (category) => category.key === "creature",
      ),
    ).toMatchObject({ value: 2, exact: false });
    expect(
      getZoneCompositionSnapshot(knownArrival, "graveyard").categories.find(
        (category) => category.key === "creature",
      ),
    ).toMatchObject({ value: 3, exact: true });
  });

  it.each([
    [["G"], ["green", "colorless"]],
    [
      ["B", "R"],
      ["black", "red", "colorless"],
    ],
    [
      ["W", "U", "B", "R", "G"],
      ["white", "blue", "black", "red", "green", "colorless"],
    ],
  ])("locks manual colors to commander identity %o", (identity, expected) => {
    const field = setActiveCommanderIdentity(
      fieldWith([]),
      multitypeCard({ colorIdentity: identity }),
      "canonical-card",
      timestamp,
    );
    expect(manualZoneColorOptions(field)).toEqual(expected);
  });

  it("updates commander color options without deleting existing composition", () => {
    let field = setActiveCommanderIdentity(
      zoneField("graveyard", [
        createGenericGroup({
          kind: "Custom",
          zone: "graveyard",
          quantity: 3,
        }),
      ]),
      multitypeCard({ colorIdentity: ["G"] }),
      "canonical-card",
      timestamp,
    );
    const correction = applyZoneCompositionCorrection(field, {
      zone: "graveyard",
      categoryTotals: { green: 2 },
      timestamp,
    });
    field = setActiveCommanderIdentity(
      correction.field,
      multitypeCard({ cardId: "new-commander", colorIdentity: ["U", "B"] }),
      "canonical-card",
      timestamp,
    );

    expect(manualZoneColorOptions(field)).toEqual([
      "blue",
      "black",
      "colorless",
    ]);
    expect(
      getZoneCompositionSnapshot(field, "graveyard").categoryTotals.green,
    ).toBe(2);
  });

  it("keeps deck-prioritized quick controls inside commander colors plus colorless", () => {
    const field = setActiveCommanderIdentity(
      fieldWith([]),
      multitypeCard({ colorIdentity: ["B", "R", "G"] }),
      "canonical-card",
      timestamp,
    );
    const options = getZoneCategoryOptions(field, "graveyard", [
      {
        cardId: "off-identity-card",
        name: "Unusual White Card",
        typeLine: "Creature - Human",
        colors: ["W"],
        colorIdentity: ["W"],
      },
    ]);
    const displayed = [...options.prioritized, ...options.additional];

    expect(options.manualColors).toEqual([
      "black",
      "red",
      "green",
      "colorless",
    ]);
    expect(displayed).not.toContain("white");
    expect(displayed).not.toContain("blue");
    expect(displayed).toContain("colorless");
  });

  it("reconciles an unknown card identity without creating a zone-entry event or increasing physical count", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard card",
      zone: "graveyard",
    });
    const initial = applyZoneCompositionCorrection(
      zoneField("graveyard", [unknown]),
      {
        zone: "graveyard",
        categoryTotals: { creature: 1, artifact: 1, red: 1, green: 1 },
        timestamp,
      },
    );
    const reconciled = reconcileUnknownZoneGroupIdentity(initial.field, {
      groupId: unknown.id,
      card: multitypeCard(),
      source: "scryfall-reconciliation",
      timestamp,
    });
    const snapshot = getZoneCompositionSnapshot(reconciled.field, "graveyard");

    expect(reconciled.ok).toBe(true);
    expect(reconciled.gameplayEventsGenerated).toBe(false);
    expect(reconciled.triggerInstancesGenerated).toBe(0);
    expect(snapshot.physicalTotal).toBe(1);
    expect(snapshot.knownPhysicalCards).toBe(1);
    expect(snapshot.unaccountedPhysicalCards).toBe(0);
    expect(snapshot.categoryTotals).toMatchObject({
      creature: 1,
      artifact: 1,
      legendary: 1,
      red: 1,
      green: 1,
      multicolor: 1,
      "subtype:dragon": 1,
    });
  });

  it("uses the established deck snapshot shape to identify an unknown zone card and commander colors", () => {
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown exile card",
      zone: "exile",
    });
    const deckSnapshot = [
      {
        cardId: "jund-commander",
        name: "Jund Commander",
        typeLine: "Legendary Creature - Human",
        colors: ["B", "R", "G"],
        colorIdentity: ["B", "R", "G"],
        isCommander: true,
      },
      {
        cardId: "deck-dragon",
        name: "Deck Dragon",
        typeLine: "Artifact Creature - Dragon",
        colors: ["R", "G"],
        colorIdentity: ["R", "G"],
      },
    ];
    let field = applyDeckSnapshotZoneContext(
      zoneField("exile", [unknown]),
      deckSnapshot,
      timestamp,
    );
    const reconciled = reconcileZoneGroupFromDeckSnapshot(field, {
      groupId: unknown.id,
      cardId: "deck-dragon",
      deckSnapshot,
      timestamp,
    });
    field = reconciled.field;

    expect(manualZoneColorOptions(field)).toEqual([
      "black",
      "red",
      "green",
      "colorless",
    ]);
    expect(
      getZoneCompositionSnapshot(field, "exile").categoryTotals,
    ).toMatchObject({
      creature: 1,
      artifact: 1,
      red: 1,
      green: 1,
      multicolor: 1,
      "subtype:dragon": 1,
    });
  });

  it("removes all known memberships when a card leaves graveyard or exile", () => {
    for (const zone of ["graveyard", "exile"] as const) {
      const group = createCardGroup(multitypeCard(), 1, zone);
      const field = zoneField(zone, [group]);
      expect(
        getZoneCompositionSnapshot(field, zone).categoryTotals.creature,
      ).toBe(1);
      const moved = normalizeField({
        ...field,
        groups: field.groups.map((entry) =>
          entry.id === group.id ? { ...entry, zone: "hand" as const } : entry,
        ),
      });
      const snapshot = getZoneCompositionSnapshot(moved, zone);
      expect(snapshot.physicalTotal).toBe(0);
      expect(snapshot.categoryTotals.creature).toBe(0);
      expect(snapshot.categoryTotals.artifact).toBe(0);
      expect(snapshot.categoryTotals.legendary).toBe(0);
      expect(snapshot.categoryTotals.red).toBe(0);
    }
  });

  it("classifies only the final canonical destination selected before commit", () => {
    const source = tracked(multitypeCard());
    const field = normalizeField(fieldWith([source]));
    const environment = createForecastEnvironment(field);
    const finalEvent = createAthenaForecastInput(
      {
        eventId: "final-destination-exile",
        eventCategory: "permanent-exiled",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp,
        subjectGroupIds: [source.id],
        quantity: 1,
        zoneOrigin: "battlefield",
        zoneDestination: "exile",
        metadata: { confirmed: true },
      },
      environment,
    );
    const committed = applyAthenaCanonicalConsequenceEvent(
      field,
      finalEvent,
      "final-destination",
    );

    expect(committed.valid).toBe(true);
    expect(
      getZoneCompositionSnapshot(committed.field, "graveyard").physicalTotal,
    ).toBe(0);
    expect(
      getZoneCompositionSnapshot(committed.field, "exile").categoryTotals
        .creature,
    ).toBe(1);
  });

  it("uses exact graveyard creature composition in ATHENA-07 and rejects partial assumptions", () => {
    const reader = tracked(
      testCard({
        name: "Boneyard Wurm",
        typeLine: "Creature - Wurm",
        oracleText:
          "Boneyard Wurm's power and toughness are each equal to the number of creature cards in your graveyard.",
        power: "*",
        toughness: "*",
      }),
    );
    const knownCreatures = createCardGroup(
      testCard({
        name: "Graveyard Creature",
        typeLine: "Creature - Elf",
        oracleText: "",
      }),
      7,
      "graveyard",
    );
    const knownLands = createCardGroup(
      testCard({ name: "Graveyard Land", typeLine: "Land", oracleText: "" }),
      4,
      "graveyard",
    );
    const unknown = createGenericGroup({
      kind: "Custom",
      label: "Unknown graveyard cards",
      zone: "graveyard",
      quantity: 4,
    });
    const field = normalizeField(
      fieldWith([reader, knownCreatures, knownLands, unknown]),
    );
    const partial = buildAthenaDerivedBattlefieldState(field);
    expect(
      partial.objects.find((entry) => entry.groupId === reader.id),
    ).toMatchObject({
      validity: "manual-resolution-required",
      currentPower: null,
    });

    const corrected = applyZoneCompositionCorrection(field, {
      zone: "graveyard",
      categoryTotals: { creature: 8 },
      timestamp,
    });
    const derived = buildAthenaDerivedBattlefieldState(corrected.field);
    expect(
      getZoneCompositionSnapshot(corrected.field, "graveyard"),
    ).toMatchObject({
      physicalTotal: 15,
      unaccountedPhysicalCards: 4,
    });
    expect(
      derived.objects.find((entry) => entry.groupId === reader.id),
    ).toMatchObject({
      validity: "valid",
      currentPower: 8,
      currentToughness: 8,
    });
    expect(corrected.gameplayEventsGenerated).toBe(false);
    expect(corrected.replacementEffectsApplied).toBe(false);
    expect(corrected.consequenceEventsGenerated).toBe(0);
  });

  it("uses exact exile categories and materializes requested subtype dependencies only", () => {
    const reader = tracked(
      testCard({
        name: "Exile Archivist",
        typeLine: "Creature - Wizard",
        oracleText: "",
        power: "*",
        toughness: "*",
      }),
    );
    const artifact = createCardGroup(
      testCard({
        name: "Exiled Relic",
        typeLine: "Artifact",
        oracleText: "",
      }),
      3,
      "exile",
    );
    const field = normalizeField(fieldWith([reader, artifact]));
    const exileDefinition = zoneReaderDefinition(
      "exile-artifact-reader",
      "Exile Archivist",
      "exile.artifact",
    );
    const zombieDefinition = zoneReaderDefinition(
      "graveyard-zombie-reader",
      "Exile Archivist",
      "graveyard.subtype:zombie",
    );
    const derived = buildAthenaDerivedBattlefieldState(field, {
      definitions: [exileDefinition],
      timestamp,
    });
    const graph = buildAthenaDependencyGraph(field, {
      staticDefinitions: [zombieDefinition],
      timestamp,
    });

    expect(
      derived.objects.find((entry) => entry.groupId === reader.id),
    ).toMatchObject({
      validity: "valid",
      currentPower: 3,
      currentToughness: 3,
    });
    expect(
      graph.nodes.find(
        (node) => node.relevantTotal === "graveyard.subtype:zombie",
      ),
    ).toMatchObject({ quantity: 0, support: "fully-understood-consequence" });
    expect(
      graph.nodes.some(
        (node) => node.relevantTotal === "graveyard.subtype:goblin",
      ),
    ).toBe(false);
  });

  it("gives BoardState authoritative category totals precedence", () => {
    const field = applyAuthoritativeZoneCategoryTotals(
      zoneField("graveyard", [
        createGenericGroup({
          kind: "Custom",
          zone: "graveyard",
          quantity: 5,
        }),
      ]),
      {
        zone: "graveyard",
        totals: { creature: 4 },
        reference: "boardstate-result-1",
        timestamp,
      },
    );
    const category = getZoneCompositionSnapshot(
      field,
      "graveyard",
    ).categories.find((entry) => entry.key === "creature");
    expect(category).toMatchObject({
      value: 4,
      exact: true,
      authoritySource: "boardstate-authority",
      authorityReference: "boardstate-result-1",
    });
    expect(
      applyZoneCompositionCorrection(field, {
        zone: "graveyard",
        categoryTotals: { creature: 3 },
      }).ok,
    ).toBe(false);
  });

  it("persists categorical composition through save/import and BoardState serialization", () => {
    const corrected = applyZoneCompositionCorrection(
      zoneField("exile", [
        createGenericGroup({ kind: "Custom", zone: "exile", quantity: 6 }),
      ]),
      {
        zone: "exile",
        categoryTotals: { artifact: 4, blue: 2 },
        manuallyAccountedPhysicalCards: 3,
        timestamp,
      },
    );
    const restored = sanitizeImportedField(
      JSON.parse(JSON.stringify(corrected.field)),
    );
    expect(restored).not.toBeNull();
    expect(getZoneCompositionSnapshot(restored!, "exile")).toMatchObject({
      physicalTotal: 6,
      manuallyAccountedPhysicalCards: 3,
      unaccountedPhysicalCards: 3,
      categoryTotals: { artifact: 4, blue: 2 },
    });
    const adapter = createLiteFieldSnapshot(restored!);
    expect(adapter.zoneCompositions.exile.manualMemberships).toMatchObject({
      artifact: 4,
      blue: 2,
    });
    expect(adapter.relevantTotals["exile.artifact"]).toBe(4);
  });

  it("loads legacy saves without categorical state nondestructively", () => {
    const legacy: Partial<FieldState> = { ...fieldWith([]) };
    delete legacy.zoneCompositions;

    const restored = sanitizeImportedField(legacy);

    expect(restored).not.toBeNull();
    expect(restored?.zoneCompositions.graveyard.manualMemberships).toEqual({});
    expect(restored?.zoneCompositions.exile.manualMemberships).toEqual({});
  });

  it("materializes useful dynamic subtypes without creating unrelated subtype fields", () => {
    const dragon = createCardGroup(multitypeCard(), 2, "graveyard");
    const field = zoneField("graveyard", [dragon]);
    const snapshot = getZoneCompositionSnapshot(field, "graveyard");
    const options = getZoneCategoryOptions(field, "graveyard");

    expect(snapshot.dynamicSubtypeKeys).toContain("subtype:dragon");
    expect(snapshot.dynamicSubtypeKeys).not.toContain("subtype:zombie");
    expect(options.prioritized).toContain("subtype:dragon");
    expect(zoneCategoryRelevantTotals(field)["graveyard.subtype:dragon"]).toBe(
      2,
    );
    expect(
      zoneCategoryRelevantTotals(field)["graveyard.subtype:zombie"],
    ).toBeUndefined();
  });

  it("keeps very large known zone stacks grouped and exact", () => {
    const stack = createCardGroup(multitypeCard(), 250_000, "exile");
    const field = zoneField("exile", [stack]);
    const snapshot = getZoneCompositionSnapshot(field, "exile");

    expect(field.groups).toHaveLength(1);
    expect(snapshot.physicalTotal).toBe(250_000);
    expect(snapshot.categoryTotals.creature).toBe(250_000);
    expect(snapshot.categoryTotals.artifact).toBe(250_000);
    expect(snapshot.categoryTotals.red).toBe(250_000);
  });
});
