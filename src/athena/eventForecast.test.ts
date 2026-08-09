// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createGenericGroup, withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState } from "../domain/types";
import {
  addPlannedAction,
  createAmbientIntent,
  createDefaultPreTurnPlannerState,
  createDefaultActiveTurnActionStripState,
  synchronizeActionStripWithPlanner,
} from "../echo";
import {
  animPakal,
  catharsCrusade,
  doublingSeason,
  fieldWith,
  rampagingBaloths,
  testCard,
  tracked,
} from "../test/factories";
import {
  AthenaEventForecastEngine,
  buildAthenaDependencyGraphFromContext,
  buildAthenaEffectRelationshipMapFromContext,
  createAthenaAwarenessContext,
  createAthenaForecastCancellationController,
  createAthenaForecastInputFromActionStripItem,
  createAthenaForecastInputFromEchoIntent,
  createAthenaForecastInputFromGameEvent,
  createAthenaForecastInputFromPlannerAction,
  forecastAthenaEvent,
  getAthenaRelevantTotalsForSubject,
  invalidateAthenaForecast,
  type AthenaEventForecastResult,
  type AthenaForecastEnvironment,
  type AthenaForecastInputDraft,
} from "./index";

const timestamp = "2026-08-09T12:00:00.000Z";

function environment(field: FieldState): AthenaForecastEnvironment {
  const context = createAthenaAwarenessContext(field, { timestamp });
  const graph = buildAthenaDependencyGraphFromContext(context, {
    field,
    timestamp,
  });
  const relationshipMap = buildAthenaEffectRelationshipMapFromContext(
    context,
    graph,
    { timestamp },
  );
  return { context, graph, relationshipMap };
}

function forecast(
  field: FieldState,
  input: AthenaForecastInputDraft,
): AthenaEventForecastResult {
  return forecastAthenaEvent(environment(field), {
    timestamp,
    eventSource: "preview-only",
    authoritySource: "lite-preview",
    ...input,
  });
}

function soulWarden() {
  return tracked(
    testCard({
      name: "Soul Warden",
      typeLine: "Creature - Human Cleric",
      oracleText:
        "Whenever another creature enters the battlefield, you gain 1 life.",
      power: "1",
      toughness: "1",
    }),
  );
}

function artifactReader() {
  return tracked(
    testCard({
      name: "Artifact Reader",
      typeLine: "Creature - Construct",
      oracleText: "Artifact Reader gets +1/+1 for each artifact you control.",
      power: "1",
      toughness: "1",
      supportStatus: "partially-automated",
    }),
  );
}

describe("Athena event forecast and consequence preview engine", () => {
  it("forecasts direct creature-entry consequences and supported observers without mutation", () => {
    const field = normalizeField(
      fieldWith([
        tracked(animPakal()),
        tracked(catharsCrusade()),
        soulWarden(),
      ]),
    );
    const before = structuredClone(field);
    const result = forecast(field, {
      eventId: "creature-enters",
      eventCategory: "creature-entered",
      quantity: 1,
      knownCharacteristics: {
        cardTypes: ["Creature"],
        isCreature: true,
        isToken: false,
      },
    });

    expect(result.validity).toBe("valid");
    expect(result.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "creatures", forecastDelta: 1 }),
        expect.objectContaining({
          key: "nontokenPermanents",
          forecastDelta: 1,
        }),
      ]),
    );
    expect(result.triggerRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceLabel: "Cathars' Crusade" }),
        expect.objectContaining({ sourceLabel: "Soul Warden" }),
      ]),
    );
    expect(result.potentialGeneratedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "counter-placed" }),
        expect.objectContaining({ category: "life-gained" }),
      ]),
    );
    expect(result.directBattlefieldMutation).toBe(false);
    expect(result.canonicalStateMutated).toBe(false);
    expect(field).toEqual(before);
  });

  it("discovers token and counter replacements without treating base quantity as final", () => {
    const field = normalizeField(
      fieldWith([
        tracked(doublingSeason()),
        tracked(catharsCrusade()),
        soulWarden(),
      ]),
    );
    const before = structuredClone(field);
    const result = forecast(field, {
      eventId: "create-three-creatures",
      eventCategory: "token-created",
      quantity: 3,
      knownCharacteristics: {
        cardTypes: ["Artifact", "Creature"],
        subtypes: ["Gnome"],
        isCreature: true,
        isToken: true,
      },
    });

    expect(result.replacementRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventCategory: "token-created",
          modificationCategory: "token-multiplier",
          applied: false,
        }),
        expect.objectContaining({
          eventCategory: "counter-placed",
          applied: false,
        }),
      ]),
    );
    expect(result.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "tokens",
          baseDelta: 3,
          forecastDelta: null,
          provisional: true,
          certainty: "replacement-dependent",
        }),
      ]),
    );
    expect(result.potentialGeneratedEvents).toContainEqual(
      expect.objectContaining({
        category: "token-entered",
        certainty: "replacement-dependent",
        replacementDependent: true,
      }),
    );
    expect(result.triggerRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Cathars' Crusade",
          instanceCount: null,
          certainty: "replacement-dependent",
        }),
        expect.objectContaining({ sourceLabel: "Soul Warden" }),
      ]),
    );
    expect(field).toEqual(before);
  });

  it("represents overlapping token replacements and requires ordering without applying them", () => {
    const anointed = tracked(
      testCard({
        name: "Anointed Procession",
        typeLine: "Enchantment",
        oracleText:
          "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.",
      }),
    );
    const field = normalizeField(
      fieldWith([tracked(doublingSeason()), anointed]),
    );
    const result = forecast(field, {
      eventId: "overlapping-replacements",
      eventCategory: "token-created",
      quantity: 2,
      knownCharacteristics: { isToken: true, cardTypes: ["Artifact"] },
    });

    expect(result.replacementRelationships).toHaveLength(2);
    expect(result.replacementRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ overlapping: true, applied: false }),
      ]),
    );
    expect(result.requiredChoices).toContainEqual(
      expect.objectContaining({ kind: "replacement-order" }),
    );
    expect(result.relevantTotalChanges).toContainEqual(
      expect.objectContaining({
        key: "tokens",
        baseDelta: 2,
        forecastValue: null,
      }),
    );
  });

  it("forecasts overlapping artifact token totals once and invalidates static readers", () => {
    const treasures = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 2,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const equipment = tracked(
      testCard({
        name: "Fixture Equipment",
        typeLine: "Artifact - Equipment",
        oracleText: "Equipped creature gets +1/+1.",
      }),
    );
    const field = normalizeField(
      fieldWith([artifactReader(), treasures, equipment]),
    );
    const before = structuredClone(field);
    const result = forecast(field, {
      eventId: "create-three-treasures",
      eventCategory: "token-created",
      quantity: 3,
      knownCharacteristics: {
        cardTypes: ["Artifact"],
        subtypes: ["Treasure"],
        isCreature: false,
        isToken: true,
      },
    });

    expect(result.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "artifacts", forecastDelta: 3 }),
        expect.objectContaining({ key: "tokens", forecastDelta: 3 }),
        expect.objectContaining({
          key: "treasureTokens",
          forecastDelta: 3,
        }),
      ]),
    );
    expect(
      result.relevantTotalChanges.filter(
        (change) => change.key === "artifacts",
      ),
    ).toHaveLength(1);
    expect(result.staticDependencies).toContainEqual(
      expect.objectContaining({
        sourceLabel: "Artifact Reader",
        relevantTotal: "artifacts",
        currentObservedValue: 3,
        forecastObservedValue: 6,
        committed: false,
      }),
    );
    expect(field).toEqual(before);
  });

  it("exposes a bounded landfall consequence path without resolving it", () => {
    const field = normalizeField(
      fieldWith([
        tracked(rampagingBaloths()),
        soulWarden(),
        tracked(catharsCrusade()),
      ]),
    );
    const result = forecast(field, {
      eventId: "landfall-path",
      eventCategory: "land-entered",
      quantity: 1,
      knownCharacteristics: {
        cardTypes: ["Land"],
        isToken: false,
      },
    });

    const baloths = result.triggerRelationships.find(
      (relationship) => relationship.sourceLabel === "Rampaging Baloths",
    );
    expect(baloths?.generatedEventCategories).toEqual(
      expect.arrayContaining(["token-created", "creature-entered"]),
    );
    expect(result.triggerRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceLabel: "Soul Warden", depth: 2 }),
        expect.objectContaining({ sourceLabel: "Cathars' Crusade", depth: 2 }),
      ]),
    );
    expect(result.forecastDepth).toBe(2);
    expect(
      result.directConsequences.every(
        (entry) => entry.delta !== 0 || entry.kind !== "counter",
      ),
    ).toBe(true);
  });

  it("uses the graph total classifier for lands, equipment, and grouped token types", () => {
    expect(
      getAthenaRelevantTotalsForSubject({
        zone: "battlefield",
        cardTypes: ["Land"],
        subtypes: ["Forest"],
        supertypes: ["Basic"],
        isToken: false,
      }),
    ).toEqual(
      expect.arrayContaining([
        "lands",
        "basicLands",
        "forests",
        "nontokenPermanents",
      ]),
    );
    expect(
      getAthenaRelevantTotalsForSubject({
        zone: "battlefield",
        cardTypes: ["Artifact", "Creature"],
        subtypes: ["Equipment", "Treasure"],
        supertypes: ["Legendary"],
        isToken: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "artifacts",
        "creatures",
        "equipment",
        "legendaryPermanents",
        "tokens",
        "treasureTokens",
      ]),
    );
  });

  it("forecasts land and equipment entry totals from known characteristics", () => {
    const field = normalizeField(fieldWith([]));
    const land = forecast(field, {
      eventId: "land-enters",
      eventCategory: "land-entered",
      quantity: 1,
      knownCharacteristics: {
        cardTypes: ["Land"],
        supertypes: [],
        subtypes: ["Gate"],
        isToken: false,
      },
    });
    const equipment = forecast(field, {
      eventId: "equipment-enters",
      eventCategory: "permanent-entered",
      quantity: 1,
      knownCharacteristics: {
        cardTypes: ["Artifact"],
        subtypes: ["Equipment"],
        isToken: false,
      },
    });

    expect(land.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "lands", forecastDelta: 1 }),
        expect.objectContaining({ key: "nonbasicLands", forecastDelta: 1 }),
        expect.objectContaining({ key: "gates", forecastDelta: 1 }),
      ]),
    );
    expect(equipment.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "artifacts", forecastDelta: 1 }),
        expect.objectContaining({ key: "equipment", forecastDelta: 1 }),
      ]),
    );
  });

  it("does not infer nonbasic or nontoken totals from an unspecified land", () => {
    const result = forecast(normalizeField(fieldWith([])), {
      eventId: "unspecified-land",
      eventCategory: "land-entered",
      quantity: 1,
    });

    expect(result.relevantTotalChanges).toContainEqual(
      expect.objectContaining({ key: "lands", forecastDelta: 1 }),
    );
    expect(
      result.relevantTotalChanges.some(
        (change) =>
          change.key === "nonbasicLands" || change.key === "nontokenPermanents",
      ),
    ).toBe(false);
    expect(result.requiredChoices).toContainEqual(
      expect.objectContaining({
        kind: "object",
        requiredBeforeAccurateForecast: true,
      }),
    );
  });

  it("forecasts leaves, zone changes, counters, and life without applying them", () => {
    const treasure = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 5,
      power: 0,
      toughness: 0,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
    });
    const field = normalizeField(fieldWith([treasure]));
    const before = structuredClone(field);
    const leaving = forecast(field, {
      eventId: "two-treasures-leave",
      eventCategory: "token-removed",
      quantity: 2,
      subjectGroupIds: [treasure.id],
      zoneOrigin: "battlefield",
      zoneDestination: "exile",
    });
    const counters = forecast(field, {
      eventId: "counters-added",
      eventCategory: "counter-placed",
      quantity: 3,
      subjectGroupIds: [treasure.id],
      counterType: "+1/+1",
    });
    const life = forecast(field, {
      eventId: "life-lost",
      eventCategory: "life-lost",
      quantity: 4,
      lifeDelta: -4,
    });

    expect(leaving.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "artifacts", forecastDelta: -2 }),
        expect.objectContaining({ key: "tokens", forecastDelta: -2 }),
        expect.objectContaining({ key: "cardsInExile", forecastDelta: 2 }),
      ]),
    );
    expect(leaving.potentialStackImplications).toContainEqual(
      expect.objectContaining({ requiresFutureSplit: true, quantity: 2 }),
    );
    expect(counters.potentialCounterChanges).toContainEqual(
      expect.objectContaining({ counterType: "+1/+1", delta: 3 }),
    );
    expect(life.potentialLifeChanges).toContainEqual(
      expect.objectContaining({ delta: -4 }),
    );
    expect(field).toEqual(before);
  });

  it("represents known trigger multiplicity and safely leaves unknown multiplicity unresolved", () => {
    const unknownMultiplicity = tracked(
      testCard({
        name: "Unknown Multiplicity Watcher",
        typeLine: "Creature - Wizard",
        oracleText:
          "Whenever creatures enter the battlefield under your control, draw a card.",
        power: "2",
        toughness: "2",
        supportStatus: "partially-automated",
      }),
    );
    const field = normalizeField(
      fieldWith([tracked(catharsCrusade()), soulWarden(), unknownMultiplicity]),
    );
    const result = forecast(field, {
      eventId: "three-creatures-enter",
      eventCategory: "creature-entered",
      quantity: 3,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });

    expect(result.triggerRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Cathars' Crusade",
          multiplicity: "per-object",
          instanceCount: 3,
        }),
        expect.objectContaining({
          sourceLabel: "Soul Warden",
          instanceCount: 3,
        }),
        expect.objectContaining({
          sourceLabel: "Unknown Multiplicity Watcher",
          multiplicity: "unknown",
          instanceCount: null,
          certainty: "manual-resolution-dependent",
          requiresManualResolution: true,
        }),
      ]),
    );
    expect(result.manualResolutionRelationshipIds).not.toEqual([]);
  });

  it("discovers structured death, counter-placement, and life-gain observers", () => {
    const deathWatcher = tracked(
      testCard({
        name: "Death Watcher",
        typeLine: "Creature - Cleric",
        oracleText: "Whenever another creature dies, draw a card.",
        power: "2",
        toughness: "2",
        supportStatus: "partially-automated",
      }),
    );
    const counterWatcher = tracked(
      testCard({
        name: "Counter Watcher",
        typeLine: "Creature - Wizard",
        oracleText:
          "Whenever one or more counters are put on Counter Watcher, draw a card.",
        power: "2",
        toughness: "2",
        supportStatus: "partially-automated",
      }),
    );
    const lifeWatcher = tracked(
      testCard({
        name: "Life Watcher",
        typeLine: "Enchantment",
        oracleText: "Whenever you gain life, draw a card.",
        supportStatus: "partially-automated",
      }),
    );
    const field = normalizeField(
      fieldWith([deathWatcher, counterWatcher, lifeWatcher]),
    );
    const death = forecast(field, {
      eventId: "death-observer",
      eventCategory: "permanent-died",
      quantity: 1,
    });
    const counters = forecast(field, {
      eventId: "counter-observer",
      eventCategory: "counter-placed",
      quantity: 4,
      counterType: "+1/+1",
    });
    const life = forecast(field, {
      eventId: "life-observer",
      eventCategory: "life-gained",
      quantity: 2,
    });

    expect(death.triggerRelationships).toContainEqual(
      expect.objectContaining({ sourceLabel: "Death Watcher" }),
    );
    expect(counters.triggerRelationships).toContainEqual(
      expect.objectContaining({
        sourceLabel: "Counter Watcher",
        multiplicity: "per-event",
        instanceCount: 1,
      }),
    );
    expect(life.triggerRelationships).toContainEqual(
      expect.objectContaining({ sourceLabel: "Life Watcher" }),
    );
  });

  it("keeps optional and choice-dependent follow-up events unresolved", () => {
    const optionalSource = tracked(
      testCard({
        name: "Optional Token Source",
        typeLine: "Enchantment",
        oracleText:
          "Whenever a creature enters the battlefield, you may create a 4/4 Beast creature token.",
        supportStatus: "partially-automated",
      }),
    );
    const field = normalizeField(fieldWith([optionalSource]));
    const result = forecast(field, {
      eventId: "optional-creature-entry",
      eventCategory: "creature-entered",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });

    expect(result.triggerRelationships).toContainEqual(
      expect.objectContaining({
        sourceLabel: "Optional Token Source",
        optional: true,
        certainty: "choice-dependent",
      }),
    );
    expect(result.requiredChoices).toContainEqual(
      expect.objectContaining({ kind: "optional-decision" }),
    );
    expect(result.potentialGeneratedEvents).toContainEqual(
      expect.objectContaining({
        category: "token-created",
        optional: true,
      }),
    );
  });

  it("excludes Not Tracked and depowered sources while retaining recipients and totals", () => {
    const crusade = tracked(catharsCrusade());
    const season = tracked(doublingSeason());
    const generic = createGenericGroup({
      kind: "Creature",
      label: "Generic creature",
      quantity: 2,
      power: 2,
      toughness: 2,
    });
    const field = normalizeField(
      fieldWith([
        withStackKey({ ...crusade, trackingEnabled: false }),
        withStackKey({
          ...season,
          abilitiesActive: false,
          depowerMode: "all",
          statuses: { ...season.statuses, depowered: true },
        }),
        generic,
      ]),
    );
    const result = forecast(field, {
      eventId: "generic-entry",
      eventCategory: "creature-entered",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });

    expect(result.triggerRelationships).toEqual([]);
    expect(result.replacementRelationships).toEqual([]);
    expect(environment(field).context.relevantTotals).toContainEqual(
      expect.objectContaining({ key: "creatures", value: 2 }),
    );
  });

  it("forecasts transformation characteristic changes without false entry events", () => {
    const source = tracked(
      testCard({
        name: "Transform Fixture",
        typeLine: "Artifact Creature - Construct",
        oracleText: "Transform Fixture.",
        power: "2",
        toughness: "2",
      }),
    );
    const field = normalizeField(fieldWith([source]));
    const result = forecast(field, {
      eventId: "transform-fixture",
      eventCategory: "permanent-transformed",
      quantity: 1,
      subjectGroupIds: [source.id],
      knownCharacteristics: {
        cardTypes: ["Enchantment"],
        isCreature: false,
        isToken: false,
      },
    });

    expect(result.potentialCharacteristicChanges).toContainEqual(
      expect.objectContaining({ kind: "transformation", delta: 0 }),
    );
    expect(result.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "artifacts", forecastDelta: -1 }),
        expect.objectContaining({ key: "creatures", forecastDelta: -1 }),
        expect.objectContaining({ key: "enchantments", forecastDelta: 1 }),
      ]),
    );
    expect(
      result.triggerRelationships.some(
        (entry) => entry.observedEvent === "creature-entered",
      ),
    ).toBe(false);
  });

  it("keeps large token forecasts grouped", () => {
    const field = normalizeField(fieldWith([]));
    const result = forecast(field, {
      eventId: "hundred-soldiers",
      eventCategory: "token-created",
      quantity: 100,
      knownCharacteristics: {
        cardTypes: ["Creature"],
        subtypes: ["Soldier"],
        isCreature: true,
        isToken: true,
      },
    });

    expect(result.potentialTokenChanges).toHaveLength(1);
    expect(result.potentialTokenChanges[0]).toEqual(
      expect.objectContaining({ quantity: 100, grouped: true }),
    );
    expect(result.potentialGeneratedEvents).toContainEqual(
      expect.objectContaining({
        category: "token-entered",
        certainty: "deterministic",
        replacementDependent: false,
      }),
    );
    expect(result.directConsequences.length).toBeLessThan(12);
  });

  it("adapts Echo intents, planner actions, and Action Strip items without committing", () => {
    const field = normalizeField(fieldWith([tracked(rampagingBaloths())]));
    const env = environment(field);
    const intent = createAmbientIntent(
      {
        id: "echo-play-land",
        kind: "play-land",
        source: "voice-command",
        payload: { quantity: 1 },
        confidence: "high",
      },
      timestamp,
    );
    const echoInput = createAthenaForecastInputFromEchoIntent({
      ...env,
      intent,
      options: { knownCharacteristics: { cardTypes: ["Land"] } },
    });
    const planner = addPlannedAction(
      createDefaultPreTurnPlannerState({
        timestamp,
        sessionId: field.session.id,
      }),
      { id: "planned-land", type: "land-play", title: "Play a Forest" },
      timestamp,
    );
    const plannerInput = createAthenaForecastInputFromPlannerAction({
      ...env,
      action: planner.actions[0],
      options: { knownCharacteristics: { cardTypes: ["Land"] } },
    });
    const strip = synchronizeActionStripWithPlanner(
      createDefaultActiveTurnActionStripState({
        timestamp,
        sessionId: field.session.id,
      }),
      { planner, ambientMode: "activeTurn", timestamp },
    );
    const stripInput = createAthenaForecastInputFromActionStripItem({
      ...env,
      item: strip.items.find((item) => item.sourceActionId === "planned-land")!,
      options: { knownCharacteristics: { cardTypes: ["Land"] } },
    });
    const canonicalInput = createAthenaForecastInputFromGameEvent({
      ...env,
      event: {
        id: "canonical-land-event",
        type: "land-entered",
        sourceId: null,
        controller: "you",
        owner: "you",
        quantity: 1,
        batchId: "canonical-land-batch",
        groupIds: [],
        characteristics: {
          cardTypes: ["Land"],
          subtypes: ["Forest"],
        },
        metadata: {},
      },
      authoritySource: "boardstate-authoritative-result",
      canonicalResultReference: "rules-result-1",
      timestamp,
    });

    expect(echoInput).toMatchObject({
      eventCategory: "land-entered",
      eventSource: "echo-reported",
      echoIntentReference: intent.id,
    });
    expect(plannerInput).toMatchObject({
      eventCategory: "land-entered",
      eventSource: "planner",
      plannerReference: "planned-land",
    });
    expect(stripInput).toMatchObject({
      eventCategory: "land-entered",
      eventSource: "action-strip",
      actionStripReference: expect.any(String),
    });
    expect(canonicalInput).toMatchObject({
      eventCategory: "land-entered",
      eventSource: "boardstate-result",
      authoritySource: "boardstate-authoritative-result",
      canonicalResultReference: "rules-result-1",
    });
    expect(forecastAthenaEvent(env, echoInput).canonicalStateMutated).toBe(
      false,
    );
  });

  it("keeps cast events distinct from battlefield entry", () => {
    const field = normalizeField(fieldWith([soulWarden()]));
    const result = forecast(field, {
      eventId: "cast-creature",
      eventCategory: "spell-cast",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });

    expect(result.relevantTotalChanges).toEqual([]);
    expect(result.triggerRelationships).toEqual([]);
    expect(result.potentialGeneratedEvents).toEqual([]);
  });

  it("does not forecast gameplay triggers for Correction Only events", () => {
    const field = normalizeField(
      fieldWith([tracked(catharsCrusade()), tracked(doublingSeason())]),
    );
    const result = forecastAthenaEvent(environment(field), {
      eventId: "correction-entry",
      eventCategory: "creature-entered",
      eventSource: "correction-only",
      authoritySource: "correction-only",
      quantity: 1,
      timestamp,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });

    expect(result.relevantTotalChanges).not.toEqual([]);
    expect(result.triggerRelationships).toEqual([]);
    expect(result.replacementRelationships).toEqual([]);
    expect(result.potentialGeneratedEvents).toEqual([]);
  });

  it("preserves authoritative total implications and never elevates Lite previews", () => {
    const field = normalizeField(fieldWith([]));
    const authoritative = forecastAthenaEvent(environment(field), {
      eventId: "authority-land",
      eventCategory: "land-entered",
      eventSource: "boardstate-result",
      authoritySource: "boardstate-authoritative-result",
      quantity: 1,
      timestamp,
      knownCharacteristics: { cardTypes: ["Land"] },
      relevantTotalImplications: { lands: 2 },
      canonicalResultReference: "boardstate-result-1",
    });
    const preview = forecast(field, {
      eventId: "preview-land",
      eventCategory: "land-entered",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Land"] },
    });

    expect(authoritative).toMatchObject({
      authoritySource: "boardstate-authoritative-result",
      authorityPrecedence: 1,
    });
    expect(authoritative.relevantTotalChanges).toContainEqual(
      expect.objectContaining({ key: "lands", forecastDelta: 2 }),
    );
    expect(preview).toMatchObject({
      authoritySource: "lite-preview",
      authorityPrecedence: 5,
    });
  });

  it("keeps referenced unsupported effects explicit and non-authoritative", () => {
    const unsupported = tracked(
      testCard({
        name: "Unsupported Source",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever a player casts their second spell, do a loop.",
        power: "2",
        toughness: "2",
        supportStatus: "unsupported",
      }),
    );
    const field = normalizeField(fieldWith([unsupported]));
    const result = forecast(field, {
      eventId: "unsupported-source-event",
      eventCategory: "trigger-announced",
      quantity: 1,
      subjectGroupIds: [unsupported.id],
      sourceObjectId: unsupported.session?.objectIds[0] ?? unsupported.id,
    });

    expect(result.unsupportedRelationshipIds.length).toBeGreaterThan(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "unsupported-effect" }),
    );
    expect(result.authoritySource).toBe("lite-preview");
  });

  it("invalidates stale forecasts after graph, Echo, and session-affecting changes", () => {
    const field = normalizeField(fieldWith([tracked(catharsCrusade())]));
    const env = environment(field);
    const result = forecastAthenaEvent(env, {
      eventId: "stale-creature",
      eventCategory: "creature-entered",
      quantity: 1,
      timestamp,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });
    const unaffected = invalidateAthenaForecast(result, {
      change: { kind: "counter-changed", groupIds: ["unrelated"] },
      timestamp,
    });
    const stale = invalidateAthenaForecast(result, {
      change: {
        kind: "tracking-toggled",
        groupIds: [field.groups[0].id],
      },
      timestamp,
    });

    expect(unaffected).toBe(result);
    expect(stale.validity).toBe("stale");
    expect(stale.diagnostics.staleResultRejected).toBe(true);
  });

  it("cancels safely and rejects an older rapid correction forecast", () => {
    const field = normalizeField(fieldWith([]));
    const env = environment(field);
    const cancellation = createAthenaForecastCancellationController();
    cancellation.cancel("User corrected the quantity.");
    const cancelled = forecastAthenaEvent(
      env,
      {
        eventId: "cancelled-tokens",
        eventCategory: "token-created",
        quantity: 5,
        timestamp,
      },
      { cancellation: cancellation.signal },
    );
    const engine = new AthenaEventForecastEngine();
    const first = engine.forecast(
      field,
      {
        eventId: "rapid-token-input",
        eventCategory: "token-created",
        eventSource: "echo-reported",
        echoIntentReference: "echo-session-1",
        quantity: 5,
        timestamp,
      },
      { environment: env },
    );
    const second = engine.forecast(
      field,
      {
        eventId: "rapid-token-input",
        eventCategory: "token-created",
        eventSource: "echo-reported",
        echoIntentReference: "echo-session-1",
        quantity: 3,
        timestamp,
      },
      { environment: env },
    );

    expect(cancelled.validity).toBe("cancelled");
    expect(cancelled.directConsequences).toEqual([]);
    expect(engine.getForecast(first.id)?.validity).toBe("stale");
    expect(second.validity).toBe("valid");
    expect(engine.getDiagnostics()).toMatchObject({
      staleResultRejectionCount: 1,
      productionVisible: false,
    });
  });

  it("uses discardable derived caching and deterministic identities", () => {
    const field = normalizeField(fieldWith([tracked(catharsCrusade())]));
    const env = environment(field);
    const engine = new AthenaEventForecastEngine();
    const draft: AthenaForecastInputDraft = {
      eventId: "cached-entry",
      eventCategory: "creature-entered",
      quantity: 1,
      timestamp,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    };
    const first = engine.forecast(field, draft, { environment: env });
    const second = engine.forecast(field, draft, { environment: env });

    expect(second.id).toBe(first.id);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.diagnostics.cacheHit).toBe(true);
    expect(engine.getDiagnostics()).toMatchObject({
      cacheHitCount: 1,
      cacheMissCount: 1,
    });
    engine.clearDerivedCache();
    expect(engine.forecast(field, draft, { environment: env }).validity).toBe(
      "valid",
    );
    engine.clearInactiveForecasts();
    engine.dispose();
    expect(engine.getForecast(first.id)).toBeNull();
    expect(engine.getDiagnostics().activeForecastCount).toBe(0);
  });

  it("keeps depth zero to the input and direct structural forecast only", () => {
    const field = normalizeField(
      fieldWith([tracked(rampagingBaloths()), soulWarden()]),
    );
    const result = forecastAthenaEvent(
      environment(field),
      {
        eventId: "depth-zero-land",
        eventCategory: "land-entered",
        quantity: 1,
        timestamp,
        knownCharacteristics: { cardTypes: ["Land"] },
      },
      { maxDepth: 0 },
    );

    expect(result.directConsequences.length).toBeGreaterThan(0);
    expect(result.triggerRelationships).toEqual([]);
    expect(result.replacementRelationships).toEqual([]);
    expect(result.staticDependencies).toEqual([]);
    expect(result.potentialGeneratedEvents).toEqual([]);
  });

  it("serializes as platform-neutral data without committed field state", () => {
    const field = normalizeField(fieldWith([tracked(catharsCrusade())]));
    const result = forecast(field, {
      eventId: "portable-serialization",
      eventCategory: "creature-entered",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
    });
    const serialized = JSON.stringify(result);
    const restored = JSON.parse(serialized) as AthenaEventForecastResult;

    expect(restored).toMatchObject({
      id: result.id,
      committedResultShape: false,
      directBattlefieldMutation: false,
      canonicalStateMutated: false,
    });
    expect("field" in restored).toBe(false);
    expect(serialized).not.toContain("HTMLElement");
  });

  it("returns structured unresolved results for invalid quantities and stale versions", () => {
    const field = normalizeField(fieldWith([]));
    const env = environment(field);
    const unsupported = forecastAthenaEvent(env, {
      eventId: "unsupported-event",
      eventCategory:
        "not-an-event" as AthenaForecastInputDraft["eventCategory"],
      quantity: 1,
      timestamp,
    });
    const invalid = forecastAthenaEvent(env, {
      eventId: "invalid-quantity",
      eventCategory: "token-created",
      quantity: -2,
      timestamp,
    });
    const stale = forecastAthenaEvent(env, {
      eventId: "stale-version",
      eventCategory: "land-entered",
      quantity: 1,
      timestamp,
      dependencyGraphVersion: 99,
    });
    const reusableInput = createAthenaForecastInputFromGameEvent({
      ...env,
      event: {
        id: "fingerprint-input",
        type: "land-entered",
        sourceId: null,
        controller: "you",
        owner: "you",
        quantity: 1,
        batchId: "fingerprint-batch",
        groupIds: [],
        characteristics: { cardTypes: ["Land"] },
        metadata: {},
      },
      timestamp,
    });
    const changedField = normalizeField(
      fieldWith([
        createGenericGroup({
          kind: "Creature",
          label: "Changed battlefield",
          quantity: 1,
        }),
      ]),
    );
    const fingerprintStale = forecastAthenaEvent(
      environment(changedField),
      reusableInput,
    );

    expect(unsupported).toMatchObject({
      validity: "invalid",
      directConsequences: [],
      canonicalStateMutated: false,
    });
    expect(invalid).toMatchObject({
      validity: "unresolved",
      canonicalStateMutated: false,
      directBattlefieldMutation: false,
    });
    expect(invalid.requiredChoices).toContainEqual(
      expect.objectContaining({ kind: "quantity" }),
    );
    expect(stale.validity).toBe("stale");
    expect(stale.warnings).toContainEqual(
      expect.objectContaining({ code: "stale-version" }),
    );
    expect(fingerprintStale).toMatchObject({
      validity: "stale",
      diagnostics: { staleResultRejected: true },
    });
  });

  it("scales across grouped quantities and many relationships without recursion", () => {
    const groups = Array.from({ length: 80 }, (_, index) =>
      tracked(
        testCard({
          name: `Artifact Reader ${index}`,
          typeLine: "Creature - Construct",
          oracleText: `Artifact Reader ${index} gets +1/+1 for each artifact you control.`,
          power: "1",
          toughness: "1",
          supportStatus: "partially-automated",
        }),
      ),
    );
    const field = normalizeField(fieldWith(groups));
    const started = performance.now();
    const result = forecast(field, {
      eventId: "large-grouped-forecast",
      eventCategory: "token-created",
      quantity: 10_000,
      knownCharacteristics: {
        cardTypes: ["Artifact"],
        subtypes: ["Treasure"],
        isToken: true,
      },
    });
    const duration = performance.now() - started;

    expect(result.staticDependencies.length).toBe(80);
    expect(result.potentialTokenChanges).toHaveLength(1);
    expect(result.forecastDepth).toBe(2);
    expect(duration).toBeLessThan(4000);
  });
});
