import { describe, expect, it } from "vitest";
import {
  createGenericGroup,
  createTokenGroup,
  mergeCompatibleStacks,
  splitGroupForQuantity,
  withStackKey,
} from "../domain/cards";
import { setTrackingEnabled, transformCreatures } from "../domain/engine";
import { normalizeField, sanitizeImportedField } from "../domain/field";
import type { CustomEffect, FieldState } from "../domain/types";
import { createAmbientIntent } from "../echo";
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
  buildAthenaDependencyGraph,
  buildAthenaDependencyGraphFromContext,
  buildAthenaEffectRelationshipMap,
  buildAthenaEffectRelationshipMapFromContext,
  createAthenaAwarenessContext,
  createAthenaEffectRelationshipQueryApi,
  updateAthenaEffectRelationshipMap,
} from "./index";

const timestamp = "2026-08-03T00:00:00.000Z";

function build(field: FieldState) {
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
  return {
    context,
    graph,
    relationshipMap,
    query: createAthenaEffectRelationshipQueryApi(relationshipMap, graph),
  };
}

describe("Athena trigger source and effect relationship mapper", () => {
  it("maps supported trigger sources without mutating committed battlefield state", () => {
    const field = normalizeField(
      fieldWith([
        tracked(animPakal()),
        tracked(catharsCrusade()),
        tracked(rampagingBaloths()),
      ]),
    );
    const before = structuredClone(field);
    const { relationshipMap, query } = build(field);

    expect(relationshipMap).toMatchObject({
      version: 1,
      fieldId: field.id,
      sessionId: field.session.id,
      committedStateReadOnly: true,
      derivedFromCanonicalState: true,
      directBattlefieldMutation: false,
      duplicateBattlefieldState: false,
    });
    expect(query.getTriggersObservingEvent("attack-declared")).toContainEqual(
      expect.objectContaining({
        category: "triggered-ability",
        source: expect.objectContaining({
          battlefieldObjectGroupId: field.groups[0].id,
          abilityIdentifier: "anim-pakal",
        }),
        generatedEventCategories: expect.arrayContaining([
          "counter-placed",
          "creature-entered",
          "token-created",
        ]),
      }),
    );
    expect(query.getTriggersObservingEvent("creature-entered")).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          battlefieldObjectGroupId: field.groups[1].id,
        }),
        generatedEventCategories: expect.arrayContaining(["counter-placed"]),
      }),
    );
    expect(query.getTriggersObservingEvent("land-entered")).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({
          battlefieldObjectGroupId: field.groups[2].id,
        }),
        generatedEventCategories: expect.arrayContaining([
          "creature-entered",
          "token-created",
        ]),
      }),
    );
    expect(field).toEqual(before);
  });

  it("keeps replacement effects separate from triggered and static effects", () => {
    const field = normalizeField(
      fieldWith([tracked(doublingSeason()), tracked(catharsCrusade())]),
    );
    const { relationshipMap, query } = build(field);
    const tokenReplacements =
      query.getReplacementEffectsModifyingEvent("token-created");
    const counterReplacements =
      query.getReplacementEffectsModifyingEvent("counter-placed");

    expect(tokenReplacements).toContainEqual(
      expect.objectContaining({
        category: "replacement-effect",
        modifiesEvent: true,
        source: expect.objectContaining({
          battlefieldObjectGroupId: field.groups[0].id,
        }),
        observedEvents: expect.arrayContaining([
          expect.objectContaining({ eventCategory: "token-created" }),
        ]),
      }),
    );
    expect(counterReplacements).toContainEqual(
      expect.objectContaining({
        category: "replacement-effect",
        modifiesEvent: true,
        observedEvents: expect.arrayContaining([
          expect.objectContaining({ eventCategory: "counter-placed" }),
        ]),
      }),
    );
    expect(
      relationshipMap.relationships.filter(
        (relationship) => relationship.category === "replacement-effect",
      ),
    ).toHaveLength(1);
    expect(query.getTriggersObservingEvent("token-created")).not.toContainEqual(
      expect.objectContaining({ category: "replacement-effect" }),
    );
  });

  it("maps static readers, affected object sets, and invalidation-ready values", () => {
    const artifactReader = tracked(
      testCard({
        name: "Artifact Reader",
        typeLine: "Creature - Construct",
        oracleText: "Artifact Reader gets +1/+1 for each artifact you control.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const equipmentReader = tracked(
      testCard({
        name: "Armory Reader",
        typeLine: "Creature - Soldier",
        oracleText: "Armory Reader gets +1/+1 for each Equipment you control.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const field = normalizeField(
      fieldWith([artifactReader, equipmentReader, tracked(catharsCrusade())]),
    );
    const { query } = build(field);

    expect(query.getStaticEffectsReadingValue("artifacts")).toContainEqual(
      expect.objectContaining({
        category: "static-effect",
        relevantTotals: expect.arrayContaining(["artifacts"]),
        state: "partially-supported",
      }),
    );
    expect(query.getStaticEffectsReadingValue("equipment")).toContainEqual(
      expect.objectContaining({
        relevantTotals: expect.arrayContaining(["equipment"]),
        affectedObjectSet: expect.objectContaining({
          kind: "this-object",
        }),
      }),
    );
  });

  it("represents generated follow-up event categories without executing cascades", () => {
    const field = normalizeField(
      fieldWith([
        tracked(catharsCrusade()),
        tracked(rampagingBaloths()),
        tracked(doublingSeason()),
      ]),
    );
    const { query } = build(field);
    const creatureFollowUps =
      query.getFollowUpEventsForEvent("creature-entered");
    const landFollowUps = query.getFollowUpEventsForEvent("land-entered");

    expect(creatureFollowUps).toContainEqual(
      expect.objectContaining({ category: "counter-placed" }),
    );
    expect(landFollowUps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "token-created" }),
        expect.objectContaining({ category: "creature-entered" }),
      ]),
    );
  });

  it("maps life modification triggers and custom background automation", () => {
    const source = tracked(
      testCard({
        name: "Custom Source",
        typeLine: "Enchantment",
        oracleText: "Custom source.",
        supportStatus: "partially-automated",
      }),
    );
    const customEffect: CustomEffect & { sourceGroupId: string } = {
      id: "custom-counters",
      name: "Custom Counters",
      enabled: true,
      sourceGroupId: source.id,
      trigger: "activate-field",
      action: {
        kind: "add-counters",
        counter: "+1/+1",
        target: "selected",
        amount: { type: "fixed", value: 1 },
      },
    };
    const field = normalizeField(
      fieldWith([
        tracked(
          testCard({
            name: "Soul Warden",
            typeLine: "Creature - Human Cleric",
            oracleText:
              "Whenever another creature enters the battlefield, you gain 1 life.",
            power: "1",
            toughness: "1",
          }),
        ),
        source,
      ]),
    );
    field.customEffects = [customEffect];
    const { query } = build(field);

    expect(query.getTriggersObservingEvent("creature-entered")).toContainEqual(
      expect.objectContaining({
        category: "triggered-ability",
        generatedEventCategories: expect.arrayContaining(["life-gained"]),
      }),
    );
    expect(query.getTriggersObservingEvent("trigger-announced")).toContainEqual(
      expect.objectContaining({
        category: "background-watcher",
        source: expect.objectContaining({
          battlefieldObjectGroupId: source.id,
        }),
        requiredChoices: expect.arrayContaining([
          expect.objectContaining({ kind: "target" }),
        ]),
      }),
    );
  });

  it("keeps Not Tracked and Depower relationship states distinct", () => {
    const crusade = tracked(catharsCrusade());
    const season = tracked(doublingSeason());
    const field = normalizeField(
      fieldWith([
        withStackKey({ ...crusade, trackingEnabled: false }),
        withStackKey({
          ...season,
          abilitiesActive: false,
          depowerMode: "all",
          statuses: { ...season.statuses, depowered: true },
        }),
      ]),
    );
    const { query } = build(field);
    const disabled = query.getDisabledRelationships();

    expect(disabled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            battlefieldObjectGroupId: crusade.id,
          }),
          state: "tracking-disabled",
        }),
        expect.objectContaining({
          source: expect.objectContaining({
            battlefieldObjectGroupId: season.id,
          }),
          state: "depowered",
        }),
      ]),
    );
  });

  it("keeps generic placeholders as effect recipients without source mappings", () => {
    const generic = createGenericGroup({
      kind: "Creature",
      label: "Generic creature",
      quantity: 2,
      power: 2,
      toughness: 2,
    });
    const field = normalizeField(
      fieldWith([generic, tracked(catharsCrusade())]),
    );
    const { query } = build(field);

    expect(query.getRelationshipsAffectingPermanent(generic.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            battlefieldObjectGroupId: field.groups[1].id,
          }),
        }),
      ]),
    );
    expect(query.getRelationshipsOriginatingFromPermanent(generic.id)).toEqual(
      [],
    );
  });

  it("preserves source identity across transformation and stack operations", () => {
    const anim = tracked(animPakal());
    const transformed = transformCreatures(
      normalizeField(fieldWith([anim])),
      testCard({
        name: "Transformed Fixture",
        typeLine: "Creature - Construct",
        oracleText: "Whenever a creature enters, put a +1/+1 counter on it.",
        power: "2",
        toughness: "2",
        supportStatus: "partially-automated",
      }),
      "all",
      [],
      false,
    ).field;
    const token = createTokenGroup({
      name: "Soldier",
      quantity: 4,
      power: 1,
      toughness: 1,
      subtypes: ["Soldier"],
    });
    const split = splitGroupForQuantity([token], token.id, 2);
    const merged = mergeCompatibleStacks([
      token,
      createTokenGroup({
        name: "Soldier",
        quantity: 2,
        power: 1,
        toughness: 1,
        subtypes: ["Soldier"],
      }),
    ]);
    const transformedRelationships =
      build(transformed).relationshipMap.relationships;

    expect(transformed.groups[0].id).toBe(anim.id);
    expect(transformedRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            battlefieldObjectGroupId: anim.id,
            transformationState: "transformed",
          }),
        }),
      ]),
    );
    expect(
      build(normalizeField(fieldWith(split.groups))).relationshipMap.fieldId,
    ).toBeDefined();
    expect(
      build(normalizeField(fieldWith(merged))).relationshipMap.fieldId,
    ).toBeDefined();
  });

  it("represents unsupported and authority-required effects honestly", () => {
    const unsupported = tracked(
      testCard({
        name: "Unsupported Fixture",
        typeLine: "Creature - Wizard",
        oracleText: "Whenever a player casts their second spell, do a loop.",
        supportStatus: "unsupported",
        power: "2",
        toughness: "2",
      }),
    );
    const field = normalizeField(fieldWith([unsupported]));
    const { query } = build(field);

    expect(query.getUnsupportedRelationships()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "unsupported-effect",
          source: expect.objectContaining({
            battlefieldObjectGroupId: unsupported.id,
          }),
          support: "unsupported-effect",
          requiresAuthority: true,
        }),
      ]),
    );
    expect(query.getAuthorityRequiredRelationships()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            battlefieldObjectGroupId: unsupported.id,
          }),
        }),
      ]),
    );
  });

  it("supports Echo event relationship queries without executing gameplay", () => {
    const field = normalizeField(
      fieldWith([tracked(catharsCrusade()), tracked(doublingSeason())]),
    );
    const { relationshipMap, query } = build(field);
    const before = structuredClone(field);
    const intent = createAmbientIntent(
      {
        id: "athena-effect-echo-intent",
        kind: "create-token",
        source: "voice-command",
        confidence: "high",
      },
      timestamp,
    );
    const relationships = query.getRelationshipsForEchoIntent(intent);

    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "triggered-ability" }),
        expect.objectContaining({ category: "replacement-effect" }),
      ]),
    );
    expect(
      relationshipMap.diagnostics.generatedEventRelationshipCount,
    ).toBeGreaterThan(0);
    expect(field).toEqual(before);
  });

  it("keeps incremental rebuilds equivalent to full relationship mapping", () => {
    const field = normalizeField(
      fieldWith([tracked(catharsCrusade()), tracked(doublingSeason())]),
    );
    const relationshipMap = buildAthenaEffectRelationshipMap(field, {
      timestamp,
    });
    const stopped = setTrackingEnabled(
      field,
      field.groups[0].id,
      false,
      "all",
      1,
    ).field;
    const updated = updateAthenaEffectRelationshipMap(
      relationshipMap,
      stopped,
      {
        kind: "tracking-toggled",
        groupIds: [field.groups[0].id],
      },
      { timestamp },
    );
    const full = buildAthenaEffectRelationshipMap(stopped, { timestamp });

    expect(updated.equivalentToFullRebuild).toBe(true);
    expect(updated.relationshipMap.fingerprint).toBe(full.fingerprint);
    expect(updated.invalidation.previewInvalidated).toBe(true);
    expect(
      updated.relationshipMap.diagnostics.incrementalUpdateDurationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it("restores equivalent mappings after import and context-based graph creation", () => {
    const field = normalizeField(
      fieldWith([tracked(animPakal()), tracked(rampagingBaloths())]),
    );
    const imported = sanitizeImportedField(JSON.parse(JSON.stringify(field)));
    const importMap = buildAthenaEffectRelationshipMap(imported ?? field, {
      timestamp,
    });
    const context = createAthenaAwarenessContext(field, { timestamp });
    const graph = buildAthenaDependencyGraph(field, { timestamp });
    const contextMap = buildAthenaEffectRelationshipMapFromContext(
      context,
      graph,
      { timestamp },
    );

    expect(importMap.fingerprint).toBe(contextMap.fingerprint);
    expect(
      contextMap.relationships.map((relationship) => relationship.id),
    ).toEqual(importMap.relationships.map((relationship) => relationship.id));
  });

  it("scales to large token-heavy Commander battlefields", () => {
    const groups = Array.from({ length: 50 }, (_, index) =>
      tracked(
        testCard({
          name: `Commander Reader ${index}`,
          typeLine: "Creature - Construct",
          oracleText:
            "Commander Reader gets +1/+1 for each artifact you control.",
          power: "1",
          toughness: "1",
          supportStatus: "partially-automated",
        }),
      ),
    );
    groups.push(
      createGenericGroup({
        kind: "Token",
        label: "Treasure",
        quantity: 5000,
        cardTypes: ["Artifact"],
        subtypes: ["Treasure"],
        token: true,
      }),
    );
    const field = normalizeField(fieldWith(groups));
    const started = performance.now();
    const relationshipMap = buildAthenaEffectRelationshipMap(field, {
      timestamp,
    });
    const duration = performance.now() - started;

    expect(relationshipMap.diagnostics.relationshipCount).toBeGreaterThan(50);
    expect(relationshipMap.diagnostics.staticCount).toBeGreaterThan(50);
    expect(duration).toBeLessThan(3000);
  });
});
