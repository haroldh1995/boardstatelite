// @vitest-environment node

import { describe, expect, it } from "vitest";
import { withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, PermanentGroup } from "../domain/types";
import {
  catharsCrusade,
  doublingSeason,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
} from "../test/factories";
import {
  ATHENA_REPLACEMENT_CHAIN_VERSION,
  ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY,
  AthenaReplacementCancellationController,
  AthenaReplacementEffectEngine,
  createAthenaAwarenessContext,
  createAthenaForecastInput,
  createForecastEnvironment,
  forecastAthenaEvent,
  invalidateAthenaReplacementResult,
  processAthenaReplacementEffects,
  rankAthenaAuthoritySource,
  type AthenaForecastEnvironment,
  type AthenaForecastInput,
  type AthenaForecastInputDraft,
  type AthenaReplacementDefinition,
  type AthenaReplacementModification,
} from "./index";

const timestamp = "2026-08-09T12:00:00.000Z";

function environment(field: FieldState): AthenaForecastEnvironment {
  return createForecastEnvironment(normalizeField(field));
}

function event(
  env: AthenaForecastEnvironment,
  draft: AthenaForecastInputDraft,
): AthenaForecastInput {
  return createAthenaForecastInput(
    {
      timestamp,
      eventSource: "manual-report",
      authoritySource: "confirmed-user-report",
      ...draft,
    },
    env,
  );
}

function tokenEvent(
  env: AthenaForecastEnvironment,
  quantity: number,
  extra: Partial<AthenaForecastInputDraft> = {},
): AthenaForecastInput {
  return event(env, {
    eventId: `create-${quantity}-tokens`,
    eventCategory: "token-created",
    quantity,
    knownCharacteristics: {
      cardTypes: ["Artifact", "Creature"],
      subtypes: ["Gnome"],
      isCreature: true,
      isToken: true,
    },
    ...extra,
  });
}

function customDefinition(
  id: string,
  modification: AthenaReplacementModification,
  input: Partial<AthenaReplacementDefinition> = {},
): AthenaReplacementDefinition {
  return {
    version: ATHENA_REPLACEMENT_CHAIN_VERSION,
    id: `definition:${id}`,
    relationshipId: `relationship:${id}`,
    sourceGroupId: null,
    sourceObjectIds: [],
    sourceLabel: id,
    sourceQuantity: 1,
    eventCategories: ["token-created"],
    modification,
    scope: {
      kind: "controlled-tokens",
      counterTypes: [],
      permanentTypes: [],
      controllerMode: "local-participant",
    },
    enabled: true,
    optional: false,
    commutative: modification.category === "quantity-multiplier",
    appliesOncePerEvent: true,
    order: null,
    supportStatus: "fully-automated",
    support: "fully-understood-consequence",
    authoritySource: "lite-local-helper-result",
    authorityPrecedence: rankAthenaAuthoritySource("lite-local-helper-result"),
    requiresAuthority: false,
    requiresManualResolution: false,
    definitionVersion: 1,
    metadata: { custom: true },
    ...input,
  };
}

function disabledSeason(mode: "not-tracked" | "depowered"): PermanentGroup {
  const season = tracked(doublingSeason());
  if (mode === "not-tracked") {
    return withStackKey({ ...season, trackingEnabled: false });
  }
  return withStackKey({
    ...season,
    abilitiesActive: false,
    depowerMode: "all",
    statuses: { ...season.statuses, depowered: true },
  });
}

describe("Athena replacement effect and event modification engine", () => {
  it.each([
    [1, 2],
    [3, 6],
    [1_000_000, 2_000_000],
  ])("applies one token multiplier to %i as %i", (base, expected) => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = tokenEvent(env, base);
    const before = structuredClone(env.context.battlefield);
    const result = processAthenaReplacementEffects(env, input);

    expect(result).toMatchObject({
      validity: "resolved",
      originalEvent: { quantity: base },
      currentModifiedEvent: { quantity: expected },
      finalEvent: { quantity: expected },
      committedStateReadOnly: true,
      directBattlefieldMutation: false,
      canonicalStateMutated: false,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      quantityBefore: base,
      quantityAfter: expected,
      modificationCategory: "quantity-multiplier",
    });
    expect(env.context.battlefield).toEqual(before);
  });

  it("applies multiple commutative token multipliers in deterministic order", () => {
    const anointed = tracked(
      testCard({
        name: "Anointed Procession",
        typeLine: "Enchantment",
        oracleText:
          "If an effect would create tokens under your control, it creates twice that many instead.",
      }),
    );
    const env = environment(fieldWith([tracked(doublingSeason()), anointed]));
    const input = tokenEvent(env, 3);
    const first = processAthenaReplacementEffects(env, input);
    const second = processAthenaReplacementEffects(env, input);

    expect(first.finalEvent?.quantity).toBe(12);
    expect(first.steps.map((step) => step.quantityAfter)).toEqual([6, 12]);
    expect(second.steps).toEqual(first.steps);
    expect(second.id).toBe(first.id);
    expect(first.requiredChoices).toEqual([]);
  });

  it("supports the structured Parallel Lives and Mondrak token definitions", () => {
    const parallel = tracked(
      testCard({
        name: "Parallel Lives",
        typeLine: "Enchantment",
        oracleText: "Supported token replacement fixture.",
      }),
    );
    const mondrak = tracked(
      testCard({
        name: "Mondrak, Glory Dominus",
        typeLine: "Legendary Creature - Phyrexian Horror",
        oracleText: "Supported token replacement fixture.",
        power: "4",
        toughness: "4",
      }),
    );
    const env = environment(fieldWith([parallel, mondrak]));
    const result = processAthenaReplacementEffects(env, tokenEvent(env, 2));

    expect(result.finalEvent?.quantity).toBe(8);
    expect(result.steps.map((step) => step.sourceLabel).sort()).toEqual([
      "Mondrak, Glory Dominus",
      "Parallel Lives",
    ]);
  });

  it.each(["not-tracked", "depowered"] as const)(
    "excludes a %s replacement source without removing the permanent",
    (mode) => {
      const env = environment(fieldWith([disabledSeason(mode)]));
      const result = processAthenaReplacementEffects(env, tokenEvent(env, 5));

      expect(result.finalEvent?.quantity).toBe(5);
      expect(result.steps).toEqual([]);
      expect(result.excludedReplacements).toContainEqual(
        expect.objectContaining({
          sourceLabel: "Doubling Season",
          reason: mode === "not-tracked" ? "not-tracked" : "depowered",
        }),
      );
      expect(env.context.battlefield).toHaveLength(1);
    },
  );

  it("applies tracking and Depower safeguards to custom replacement sources", () => {
    const source = tracked(
      testCard({
        name: "Custom Source",
        typeLine: "Enchantment",
        oracleText: "User-defined supported automation fixture.",
      }),
    );
    const depowered = withStackKey({
      ...source,
      abilitiesActive: false,
      depowerMode: "all",
      statuses: { ...source.statuses, depowered: true },
    });
    const env = environment(fieldWith([depowered]));
    const result = processAthenaReplacementEffects(env, tokenEvent(env, 2), {
      customDefinitions: [
        customDefinition(
          "Custom Source",
          { category: "quantity-multiplier", factor: 2 },
          { sourceGroupId: depowered.id },
        ),
      ],
    });

    expect(result.finalEvent?.quantity).toBe(2);
    expect(result.excludedReplacements).toContainEqual(
      expect.objectContaining({ reason: "depowered" }),
    );
  });

  it("applies supported counter multipliers to permanent counters", () => {
    const target = genericCreature();
    const env = environment(fieldWith([tracked(doublingSeason()), target]));

    for (const counterType of ["+1/+1", "Shield", "Loyalty"]) {
      const input = event(env, {
        eventId: `counter-${counterType}`,
        eventCategory: "counter-placed",
        quantity: 1,
        counterType,
        subjectGroupIds: [target.id],
        metadata: { targetKind: "permanent" },
      });
      expect(
        processAthenaReplacementEffects(env, input).finalEvent?.quantity,
      ).toBe(2);
    }
  });

  it("does not apply permanent counter replacement logic to player counters", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = event(env, {
      eventId: "player-energy",
      eventCategory: "counter-placed",
      quantity: 1,
      counterType: "Energy",
      metadata: { targetKind: "player" },
    });
    const result = processAthenaReplacementEffects(env, input);

    expect(result.finalEvent?.quantity).toBe(1);
    expect(result.steps).toEqual([]);
    expect(result.excludedReplacements).toContainEqual(
      expect.objectContaining({ reason: "scope-mismatch" }),
    );
  });

  it("centrally bypasses replacements for Correction Only", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = event(env, {
      eventId: "counter-correction",
      eventCategory: "counter-placed",
      eventSource: "correction-only",
      authoritySource: "correction-only",
      quantity: 1,
      counterType: "+1/+1",
      metadata: { targetKind: "permanent" },
    });
    const processing = processAthenaReplacementEffects(env, input);
    const forecast = forecastAthenaEvent(env, input);

    expect(processing).toMatchObject({
      validity: "bypassed",
      finalEvent: { quantity: 1 },
      steps: [],
    });
    expect(forecast.replacementRelationships).toEqual([]);
    expect(forecast.triggerRelationships).toEqual([]);
  });

  it("uses the final quantity for trigger multiplicity and static totals", () => {
    const reader = tracked(
      testCard({
        name: "Artifact Reader",
        typeLine: "Creature - Construct",
        oracleText: "Artifact Reader gets +1/+1 for each artifact you control.",
        power: "1",
        toughness: "1",
        supportStatus: "partially-automated",
      }),
    );
    const env = environment(
      fieldWith([tracked(doublingSeason()), tracked(catharsCrusade()), reader]),
    );
    const input = tokenEvent(env, 3);
    const result = forecastAthenaEvent(env, input);

    expect(result.replacementProcessing?.finalEvent?.quantity).toBe(6);
    expect(result.triggerRelationships).toContainEqual(
      expect.objectContaining({
        sourceLabel: "Cathars' Crusade",
        instanceCount: 6,
      }),
    );
    expect(result.relevantTotalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "tokens", forecastDelta: 6 }),
        expect.objectContaining({ key: "artifacts", forecastDelta: 6 }),
      ]),
    );
    expect(result.staticDependencies).toContainEqual(
      expect.objectContaining({
        sourceLabel: "Artifact Reader",
        observedDelta: 6,
      }),
    );
  });

  it("keeps large token results grouped and never allocates per-token objects", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const result = forecastAthenaEvent(env, tokenEvent(env, 100));

    expect(result.potentialTokenChanges).toContainEqual(
      expect.objectContaining({ kind: "token-group", quantity: 200 }),
    );
    expect(result.replacementProcessing?.steps).toHaveLength(1);
    expect(
      JSON.stringify(result).match(/replacement-step/g)?.length,
    ).toBeLessThan(20);
  });

  it("supports validated custom multipliers and explicit additive ordering", () => {
    const env = environment(fieldWith([]));
    const input = tokenEvent(env, 3);
    const triple = customDefinition("Triple", {
      category: "quantity-multiplier",
      factor: 3,
    });
    const addOne = customDefinition(
      "Add One",
      { category: "quantity-additive", amount: 1 },
      { commutative: false, order: 1 },
    );
    const double = customDefinition(
      "Double",
      { category: "quantity-multiplier", factor: 2 },
      { order: 2 },
    );

    expect(
      processAthenaReplacementEffects(env, input, {
        customDefinitions: [triple],
      }).finalEvent?.quantity,
    ).toBe(9);
    const ordered = processAthenaReplacementEffects(env, input, {
      customDefinitions: [double, addOne],
    });
    expect(ordered.finalEvent?.quantity).toBe(8);
    expect(ordered.steps.map((step) => step.sourceLabel)).toEqual([
      "Add One",
      "Double",
    ]);
  });

  it("supports structured setters, entry state, destinations, and event substitution", () => {
    const env = environment(fieldWith([]));
    const input = tokenEvent(env, 3);
    const setter = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition("Prevent Tokens", {
          category: "quantity-setter",
          quantity: 0,
        }),
      ],
    });
    const entering = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition("Enter Tapped", {
          category: "entry-state",
          tapped: true,
          counterType: "+1/+1",
          counterQuantity: 1,
        }),
      ],
    });
    const destination = processAthenaReplacementEffects(
      env,
      event(env, {
        eventId: "dies-to-exile",
        eventCategory: "permanent-died",
        quantity: 1,
        zoneOrigin: "battlefield",
        zoneDestination: "graveyard",
      }),
      {
        customDefinitions: [
          customDefinition(
            "Exile Instead",
            { category: "destination-replacement", destination: "exile" },
            {
              eventCategories: ["permanent-died"],
              scope: {
                kind: "all-personal-events",
                counterTypes: [],
                permanentTypes: [],
                controllerMode: "local-participant",
              },
            },
          ),
        ],
      },
    );
    const substituted = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition("Substitute", {
          category: "event-substitution",
          eventCategory: "permanent-entered",
        }),
      ],
    });

    expect(setter.finalEvent?.quantity).toBe(0);
    const preventedForecast = forecastAthenaEvent(env, setter.finalEvent!);
    expect(preventedForecast.triggerRelationships).toEqual([]);
    expect(preventedForecast.canonicalStateMutated).toBe(false);
    expect(entering.finalEvent?.metadata).toMatchObject({
      entersTapped: true,
      entryCounterType: "+1/+1",
      entryCounterQuantity: 1,
    });
    expect(destination.finalEvent?.zoneDestination).toBe("exile");
    expect(substituted.finalEvent?.eventCategory).toBe("permanent-entered");
  });

  it("keeps optional and authority-required replacements unresolved", () => {
    const env = environment(fieldWith([]));
    const input = tokenEvent(env, 2);
    const optional = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition(
          "Optional Double",
          { category: "quantity-multiplier", factor: 2 },
          { optional: true },
        ),
      ],
    });
    const authority = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition(
          "Authority Double",
          { category: "quantity-multiplier", factor: 2 },
          { requiresAuthority: true, support: "authority-required" },
        ),
      ],
    });

    expect(optional).toMatchObject({
      validity: "unresolved",
      finalEvent: null,
    });
    expect(optional.requiredChoices).toContainEqual(
      expect.objectContaining({ kind: "optional-decision" }),
    );
    expect(authority).toMatchObject({
      validity: "authority-required",
      finalEvent: null,
    });
  });

  it("refuses to guess non-commutative replacement ordering", () => {
    const env = environment(fieldWith([]));
    const input = tokenEvent(env, 3);
    const result = processAthenaReplacementEffects(env, input, {
      customDefinitions: [
        customDefinition("Double", {
          category: "quantity-multiplier",
          factor: 2,
        }),
        customDefinition("Add One", {
          category: "quantity-additive",
          amount: 1,
        }),
      ],
    });

    expect(result).toMatchObject({
      validity: "manual-required",
      finalEvent: null,
      steps: [],
    });
    expect(result.requiredChoices).toContainEqual(
      expect.objectContaining({ kind: "replacement-order" }),
    );
  });

  it("rejects invalid custom definitions without partial processing", () => {
    const env = environment(fieldWith([]));
    const result = processAthenaReplacementEffects(env, tokenEvent(env, 2), {
      customDefinitions: [
        customDefinition("Invalid", {
          category: "quantity-multiplier",
          factor: -2,
        }),
      ],
    });

    expect(result.validity).toBe("manual-required");
    expect(result.finalEvent).toBeNull();
    expect(result.steps).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "unsupported-modifier" }),
    );
  });

  it("preserves stable event lineage and prevents duplicate application", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = tokenEvent(env, 3);
    const first = processAthenaReplacementEffects(env, input);
    const duplicate = processAthenaReplacementEffects(env, input, {
      previouslyAppliedApplicationIds: first.appliedApplicationIds,
    });

    expect(first.originalEvent.eventId).toBe("create-3-tokens");
    expect(first.steps[0]).toMatchObject({
      previousEventId: "create-3-tokens",
      resultingEventId: "create-3-tokens:r1",
    });
    expect(duplicate.finalEvent?.quantity).toBe(3);
    expect(duplicate.steps).toEqual([]);
    expect(duplicate.warnings).toContainEqual(
      expect.objectContaining({ code: "duplicate-prevented" }),
    );
  });

  it("accepts a BoardState authoritative final event over local prediction", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = event(env, {
      eventId: "authoritative-token-event",
      eventCategory: "token-created",
      eventSource: "boardstate-result",
      authoritySource: "boardstate-authoritative-result",
      quantity: 3,
      metadata: { localPredictedQuantity: 6 },
    });
    const authoritative = { ...input, quantity: 7 };
    const result = processAthenaReplacementEffects(env, input, {
      authoritativeFinalEvent: authoritative,
    });

    expect(result).toMatchObject({
      validity: "resolved",
      authoritySource: "boardstate-authoritative-result",
      authorityFinalEventAccepted: true,
      finalEvent: { quantity: 7 },
    });
    expect(result.steps).toEqual([]);
    expect(result.diagnostics.localAuthorityDiscrepancyCount).toBe(1);
  });

  it("handles overflow and repeated-state replacement loops safely", () => {
    const env = environment(fieldWith([]));
    const overflow = processAthenaReplacementEffects(
      env,
      tokenEvent(env, ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY),
      {
        customDefinitions: [
          customDefinition("Double", {
            category: "quantity-multiplier",
            factor: 2,
          }),
        ],
      },
    );
    const loop = processAthenaReplacementEffects(env, tokenEvent(env, 2), {
      customDefinitions: [
        customDefinition("No Change", {
          category: "quantity-multiplier",
          factor: 1,
        }),
      ],
    });
    const bounded = processAthenaReplacementEffects(env, tokenEvent(env, 2), {
      customDefinitions: [
        customDefinition(
          "Many Sources",
          { category: "quantity-multiplier", factor: 2 },
          { sourceQuantity: 1_000_000 },
        ),
      ],
    });

    expect(overflow).toMatchObject({ validity: "overflow", finalEvent: null });
    expect(loop).toMatchObject({
      validity: "loop-detected",
      finalEvent: null,
    });
    expect(bounded).toMatchObject({
      validity: "authority-required",
      finalEvent: null,
      steps: [],
    });
  });

  it("rejects unsafe input quantities instead of truncating them", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const unsafe = event(env, {
      eventId: "unsafe-quantity",
      eventCategory: "token-created",
      quantity: Number.MAX_VALUE,
    });
    const result = processAthenaReplacementEffects(env, unsafe);

    expect(unsafe.quantity).toBe(0);
    expect(result).toMatchObject({ validity: "invalid", finalEvent: null });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "invalid-quantity" }),
    );
  });

  it("updates replacement relationships after transformation without false entry", () => {
    const season = tracked(doublingSeason());
    const transformed = withStackKey({
      ...season,
      identity: testCard({
        name: "Quiet Back Face",
        typeLine: "Enchantment",
        oracleText: "No replacement ability.",
      }),
      originalIdentity: season.identity,
      label: "Quiet Back Face",
      statuses: { ...season.statuses, transformed: true },
    });
    const transformedEnv = environment(fieldWith([transformed]));
    const originalEnv = environment(fieldWith([season]));

    expect(
      processAthenaReplacementEffects(
        transformedEnv,
        tokenEvent(transformedEnv, 3),
      ).finalEvent?.quantity,
    ).toBe(3);
    expect(
      processAthenaReplacementEffects(originalEnv, tokenEvent(originalEnv, 3))
        .finalEvent?.quantity,
    ).toBe(6);
  });

  it("supports cancellation, invalidation, caching, diagnostics, and cleanup", () => {
    const env = environment(fieldWith([tracked(doublingSeason())]));
    const input = tokenEvent(env, 4);
    const cancellation = new AthenaReplacementCancellationController();
    cancellation.cancel("Input was corrected.");
    expect(
      processAthenaReplacementEffects(env, input, {
        cancellation: cancellation.signal,
      }).validity,
    ).toBe("cancelled");

    const engine = new AthenaReplacementEffectEngine({
      maxCacheEntries: 2,
      maxResultRecords: 2,
    });
    const first = engine.process(env, input);
    const second = engine.process(env, input);
    expect(second.diagnostics.cacheHit).toBe(true);
    const invalidated = engine.invalidate({
      relationshipIds: first.appliedRelationshipIds,
      reason: "Replacement source changed.",
      timestamp,
    });
    expect(invalidated[0]?.validity).toBe("stale");
    expect(
      invalidateAthenaReplacementResult(first, {
        groupIds: [first.steps[0].sourceGroupId ?? ""],
        reason: "Source removed.",
        timestamp,
      }).validity,
    ).toBe("stale");
    expect(engine.getDiagnostics()).toMatchObject({
      replacementAnalysisCount: 2,
      cacheHitCount: 1,
      productionVisible: false,
    });
    engine.dispose();
    expect(engine.getResult(first.id)).toBeNull();
  });

  it("keeps the shared models serializable and free of browser state", () => {
    const field = fieldWith([tracked(doublingSeason())]);
    const env = environment(field);
    const before = structuredClone(field);
    const result = processAthenaReplacementEffects(env, tokenEvent(env, 3));
    const serialized = JSON.stringify(result);

    expect(createAthenaAwarenessContext(field, { timestamp }).sessionId).toBe(
      env.context.sessionId,
    );
    expect(serialized).not.toMatch(
      /HTMLElement|localStorage|sessionStorage|indexedDB|document|navigator/,
    );
    expect(result).not.toHaveProperty("field");
    expect(field).toEqual(before);
  });

  it("processes a large source set in bounded time and bounded memory shape", () => {
    const sources = Array.from({ length: 32 }, (_, index) =>
      tracked(
        testCard({
          name: `Unrelated Enchantment ${index}`,
          typeLine: "Enchantment",
          oracleText: "No supported replacement ability.",
        }),
      ),
    );
    const env = environment(fieldWith([tracked(doublingSeason()), ...sources]));
    const started = Date.now();
    let result = processAthenaReplacementEffects(env, tokenEvent(env, 100_000));
    for (let index = 0; index < 100; index += 1) {
      result = processAthenaReplacementEffects(
        env,
        tokenEvent(env, 100_000, { eventId: `rapid-${index}` }),
      );
    }

    expect(result.finalEvent?.quantity).toBe(200_000);
    expect(result.steps).toHaveLength(1);
    expect(result.applicableDefinitions).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
