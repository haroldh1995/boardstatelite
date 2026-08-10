// @vitest-environment node

import { describe, expect, it } from "vitest";
import { withStackKey } from "../domain/cards";
import { normalizeField } from "../domain/field";
import type { FieldState, GameEvent } from "../domain/types";
import {
  catharsCrusade,
  doublingSeason,
  fieldWith,
  genericCreature,
  rampagingBaloths,
  testCard,
  tracked,
} from "../test/factories";
import {
  AthenaPendingTriggerQueue,
  AthenaTriggerGenerationCancellationController,
  createAthenaForecastInput,
  createAthenaPendingTriggerQueue,
  createForecastEnvironment,
  generateAthenaTriggerInstances,
  processAthenaGameEvent,
  processAthenaGameEventBatch,
  processAthenaReplacementEffects,
  processConfirmedAthenaEvent,
  restoreAthenaPendingTriggerQueue,
  serializeAthenaPendingTriggerQueue,
  type AthenaAuthoritativeTriggerRecord,
  type AthenaForecastEnvironment,
  type AthenaForecastInput,
  type AthenaForecastInputDraft,
  type AthenaMappedEffectRelationship,
  type AthenaTriggerQueueState,
} from "./index";

const timestamp = "2026-08-09T12:00:00.000Z";

function soulWarden(name = "Soul Warden", optional = false) {
  return tracked(
    testCard({
      name,
      typeLine: "Creature - Human Cleric",
      oracleText: optional
        ? "Whenever another creature enters the battlefield, you may gain 1 life."
        : "Whenever another creature enters the battlefield, you gain 1 life.",
      power: "1",
      toughness: "1",
    }),
  );
}

function environment(field: FieldState): AthenaForecastEnvironment {
  return createForecastEnvironment(normalizeField(field));
}

function confirmedEvent(
  env: AthenaForecastEnvironment,
  draft: AthenaForecastInputDraft,
): AthenaForecastInput {
  return createAthenaForecastInput(
    {
      timestamp,
      eventSource: "manual-report",
      authoritySource: "confirmed-user-report",
      metadata: { confirmed: true },
      ...draft,
    },
    env,
  );
}

function creatureEvent(
  env: AthenaForecastEnvironment,
  quantity: number,
  extra: Partial<AthenaForecastInputDraft> = {},
): AthenaForecastInput {
  return confirmedEvent(env, {
    eventId: `creatures-${quantity}`,
    eventCategory: "creature-entered",
    quantity,
    knownCharacteristics: {
      cardTypes: ["Creature"],
      isCreature: true,
      isToken: false,
    },
    ...extra,
  });
}

function tokenEvent(
  env: AthenaForecastEnvironment,
  quantity: number,
  extra: Partial<AthenaForecastInputDraft> = {},
): AthenaForecastInput {
  return confirmedEvent(env, {
    eventId: `tokens-${quantity}`,
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

function queueFor(env: AthenaForecastEnvironment): AthenaPendingTriggerQueue {
  return createAthenaPendingTriggerQueue({
    canonicalSessionId: env.context.sessionId,
    participantId: env.context.localParticipantId,
    timestamp,
  });
}

function replaceRelationship(
  env: AthenaForecastEnvironment,
  sourceName: string,
  update: (
    relationship: AthenaMappedEffectRelationship,
  ) => AthenaMappedEffectRelationship,
): AthenaForecastEnvironment {
  const relationships = env.relationshipMap.relationships.map((relationship) =>
    relationship.source.currentCardFace === sourceName &&
    relationship.category === "triggered-ability"
      ? update(relationship)
      : relationship,
  );
  return {
    ...env,
    relationshipMap: {
      ...env.relationshipMap,
      relationships,
    },
  };
}

describe("Athena trigger generation and pending trigger queue", () => {
  it("uses ATHENA-05 final token quantity and generates grouped ready triggers without mutation", () => {
    const field = normalizeField(
      fieldWith([
        tracked(doublingSeason()),
        soulWarden(),
        tracked(catharsCrusade()),
      ]),
    );
    const before = structuredClone(field);
    const env = environment(field);
    const input = tokenEvent(env, 3);
    const replacement = processAthenaReplacementEffects(env, input);
    const result = generateAthenaTriggerInstances(env, replacement);

    expect(replacement.finalEvent?.quantity).toBe(6);
    expect(result.validity).toBe("accepted");
    expect(result.triggerInstances).toHaveLength(2);
    expect(result.triggerInstances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ label: "Soul Warden" }),
          logicalMultiplicity: 6,
          grouped: true,
          queueState: "ready",
        }),
        expect.objectContaining({
          source: expect.objectContaining({ label: "Cathars' Crusade" }),
          logicalMultiplicity: 6,
          queueState: "ready",
        }),
      ]),
    );
    expect(result.triggerInstances[0].eventLineage).toMatchObject({
      originalEventId: "tokens-3",
      replacementApplicationIds: expect.arrayContaining([
        expect.stringContaining("doubling-season"),
      ]),
    });
    expect(result.directBattlefieldMutation).toBe(false);
    expect(field).toEqual(before);
  });

  it.each([
    ["preview-only", "lite-preview"],
    ["planner", "project-echo-planned-action"],
    ["action-strip", "project-echo-planned-action"],
    ["echo-planned", "project-echo-planned-action"],
  ] as const)(
    "rejects %s events at the domain boundary",
    (source, authority) => {
      const env = environment(fieldWith([soulWarden()]));
      const input = createAthenaForecastInput(
        {
          eventId: `ineligible-${source}`,
          eventCategory: "creature-entered",
          eventSource: source,
          authoritySource: authority,
          quantity: 1,
          timestamp,
          knownCharacteristics: { cardTypes: ["Creature"], isCreature: true },
        },
        env,
      );
      const replacement = processAthenaReplacementEffects(env, input);
      const result = generateAthenaTriggerInstances(env, replacement);

      expect(result.validity).toBe("ignored");
      expect(result.triggerInstances).toEqual([]);
    },
  );

  it("rejects unconfirmed and cancelled Echo reports", () => {
    const env = environment(fieldWith([soulWarden()]));
    const invalidReports: Array<
      Record<string, string | number | boolean | null>
    > = [{ confirmed: false }, { confirmed: true, cancelled: true }];
    for (const metadata of invalidReports) {
      const input = createAthenaForecastInput(
        {
          eventId: `echo-${Object.keys(metadata).join("-")}`,
          eventCategory: "creature-entered",
          eventSource: "echo-reported",
          authoritySource: "project-echo-voice-report",
          quantity: 1,
          timestamp,
          metadata,
        },
        env,
      );
      const result = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, input),
      );
      expect(result.triggerInstances).toEqual([]);
    }
  });

  it("cancels obsolete generation without partially updating the queue", () => {
    const env = environment(fieldWith([soulWarden()]));
    const replacement = processAthenaReplacementEffects(
      env,
      creatureEvent(env, 1),
    );
    const cancellation = new AthenaTriggerGenerationCancellationController();
    cancellation.cancel("The confirmed event was superseded.");
    const result = generateAthenaTriggerInstances(env, replacement, {
      cancellation: cancellation.signal,
    });
    const queue = queueFor(env);

    expect(result.validity).toBe("cancelled");
    expect(result.triggerInstances).toEqual([]);
    expect(queue.addGeneration(result)).toBe(0);
    expect(queue.getEntries()).toEqual([]);
  });

  it("enforces Correction Only across replacement and trigger generation", () => {
    const env = environment(
      fieldWith([
        tracked(doublingSeason()),
        soulWarden(),
        tracked(catharsCrusade()),
      ]),
    );
    const input = tokenEvent(env, 3, {
      eventSource: "correction-only",
      authoritySource: "correction-only",
    });
    const replacement = processAthenaReplacementEffects(env, input);
    const result = generateAthenaTriggerInstances(env, replacement);

    expect(replacement).toMatchObject({
      validity: "bypassed",
      finalEvent: { quantity: 3 },
      steps: [],
    });
    expect(result.validity).toBe("ignored");
    expect(result.triggerInstances).toEqual([]);
  });

  it.each([
    [1, 1],
    [6, 6],
    [100, 100],
    [1_000, 1_000],
  ])(
    "creates one grouped Soul Warden entry for %i logical triggers",
    (quantity, expected) => {
      const env = environment(fieldWith([soulWarden()]));
      const result = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, creatureEvent(env, quantity)),
      );

      expect(result.triggerInstances).toHaveLength(1);
      expect(result.triggerInstances[0]).toMatchObject({
        logicalMultiplicity: expected,
        grouped: quantity > 1,
        queueState: "ready",
      });
    },
  );

  it("multiplies event occurrences by a grouped source quantity without UI fan-out", () => {
    const env = environment(fieldWith([tracked(soulWarden().identity!, 3)]));
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 4)),
    );

    expect(result.triggerInstances).toHaveLength(1);
    expect(result.triggerInstances[0]).toMatchObject({
      logicalMultiplicity: 12,
      grouped: true,
      knownValues: { sourceQuantity: 3, finalEventQuantity: 4 },
    });
  });

  it("generates all active observers through indexed relationship lookup", () => {
    const env = environment(
      fieldWith([
        soulWarden(),
        tracked(catharsCrusade()),
        tracked(
          testCard({
            name: "Impact Tremors",
            typeLine: "Enchantment",
            oracleText:
              "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
          }),
        ),
      ]),
    );
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 4)),
    );

    expect(
      result.triggerInstances.map((entry) => entry.source.label).sort(),
    ).toEqual(["Cathars' Crusade", "Impact Tremors", "Soul Warden"]);
    expect(
      result.triggerInstances.every((entry) => entry.logicalMultiplicity === 4),
    ).toBe(true);
  });

  it("generates deterministic landfall trigger groups and prevents replay duplicates", () => {
    const field = fieldWith([
      tracked(rampagingBaloths()),
      tracked(
        testCard({
          name: "Landfall One",
          typeLine: "Enchantment",
          oracleText:
            "Landfall - Whenever a land enters the battlefield under your control, create a 1/1 green Insect creature token.",
        }),
      ),
      tracked(
        testCard({
          name: "Landfall Two",
          typeLine: "Enchantment",
          oracleText:
            "Landfall - Whenever a land enters the battlefield under your control, you gain 1 life.",
        }),
      ),
    ]);
    const env = environment(field);
    const event = confirmedEvent(env, {
      eventId: "forest-entered",
      eventCategory: "land-entered",
      quantity: 1,
      knownCharacteristics: { cardTypes: ["Land"], isToken: false },
    });
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, event),
    );
    const queue = queueFor(env);

    expect(generation.triggerInstances).toHaveLength(3);
    expect(queue.addGeneration(generation)).toBe(3);
    expect(queue.addGeneration(generation)).toBe(0);
    expect(queue.getEntries()).toHaveLength(3);
    expect(queue.getDiagnostics().duplicateTriggerPreventionCount).toBe(3);
  });

  it.each(["not-tracked", "depowered"] as const)(
    "does not generate triggers from a %s source but keeps it in awareness state",
    (mode) => {
      const source = soulWarden();
      const disabled = withStackKey({
        ...source,
        trackingEnabled:
          mode === "not-tracked" ? false : source.trackingEnabled,
        abilitiesActive: mode === "depowered" ? false : source.abilitiesActive,
        depowerMode: mode === "depowered" ? "all" : source.depowerMode,
        statuses: {
          ...source.statuses,
          depowered: mode === "depowered",
        },
      });
      const env = environment(fieldWith([disabled]));
      const result = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, creatureEvent(env, 1)),
      );

      expect(result.triggerInstances).toEqual([]);
      expect(env.context.battlefield).toHaveLength(1);
      expect(env.context.battlefield[0].canBeEffectRecipient).toBe(true);
    },
  );

  it("keeps optional triggers optional while mandatory triggers become ready", () => {
    const env = environment(
      fieldWith([soulWarden(), soulWarden("Soul's Attendant", true)]),
    );
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );
    const states = Object.fromEntries(
      result.triggerInstances.map((entry) => [
        entry.source.label,
        entry.queueState,
      ]),
    );

    expect(states["Soul Warden"]).toBe("ready");
    expect(states["Soul's Attendant"]).toBe("optional-decision-required");
    expect(
      result.triggerInstances.find(
        (entry) => entry.source.label === "Soul's Attendant",
      )?.requirements,
    ).toContainEqual(expect.objectContaining({ kind: "optional-decision" }));
  });

  it.each([
    ["target", "awaiting-target"],
    ["quantity", "awaiting-quantity"],
    ["mode", "awaiting-mode"],
    ["object", "awaiting-choice"],
  ] as const)("prepares %s requirements without guessing", (kind, state) => {
    const base = environment(fieldWith([soulWarden()]));
    const env = replaceRelationship(base, "Soul Warden", (relationship) => ({
      ...relationship,
      requiredChoices: [
        {
          id: `choice-${kind}`,
          kind,
          prompt: `Choose ${kind}`,
          sourceGroupId: relationship.source.battlefieldObjectGroupId,
          candidateGroupIds: [],
          relevantTotals: [],
          eventCategories: ["creature-entered"],
          requiredBeforeCommit: true,
        },
      ],
    }));
    const event = creatureEvent(env, 1);
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, event),
    );

    expect(result.triggerInstances[0].queueState).toBe(state);
    expect(result.triggerInstances[0].requirements[0].kind).toBe(kind);
  });

  it("marks unknown large multiplicity for manual resolution instead of guessing", () => {
    const base = environment(fieldWith([soulWarden()]));
    const env = replaceRelationship(base, "Soul Warden", (relationship) => ({
      ...relationship,
      relationshipMetadata: { helper: "custom-unknown" },
    }));
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 5)),
    );

    expect(result.triggerInstances[0]).toMatchObject({
      logicalMultiplicity: null,
      queueState: "manual-resolution-required",
      knownValues: { multiplicityKnown: false },
    });
  });

  it("does not invent trigger abilities for generic placeholders", () => {
    const env = environment(fieldWith([genericCreature()]));
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );

    expect(result.triggerInstances).toEqual([]);
  });

  it("routes valid structured custom automation through the same trigger queue", () => {
    const field = fieldWith([genericCreature()]);
    field.customEffects = [
      {
        id: "custom-life-entry",
        name: "Custom entry life",
        enabled: true,
        trigger: "creature-entered",
        action: {
          kind: "life",
          mode: "gain",
          amount: { type: "fixed", value: 1 },
        },
      },
    ];
    const env = environment(field);
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );

    expect(result.triggerInstances).toHaveLength(1);
    expect(result.triggerInstances[0]).toMatchObject({
      source: { label: "Custom entry life" },
      queueState: "manual-resolution-required",
      generatedEventCategories: ["life-gained"],
    });
  });

  it.each([
    ["permanent-died", "Whenever a creature dies, you gain 1 life."],
    [
      "counter-placed",
      "Whenever one or more counters are placed on a permanent, you gain 1 life.",
    ],
    [
      "counter-removed",
      "Whenever a counter is removed from a permanent, you gain 1 life.",
    ],
    [
      "life-gained",
      "Whenever you gain life, create a 1/1 white Soldier creature token.",
    ],
    [
      "life-lost",
      "Whenever you lose life, create a 1/1 white Soldier creature token.",
    ],
    ["attack-declared", "Whenever you attack, you gain 1 life."],
  ] as const)(
    "generates pending instances for confirmed %s events",
    (category, oracleText) => {
      const observer = tracked(
        testCard({
          name: `Observer ${category}`,
          typeLine: "Enchantment",
          oracleText,
        }),
      );
      const env = environment(fieldWith([observer]));
      const event = confirmedEvent(env, {
        eventId: `confirmed-${category}`,
        eventCategory: category,
        quantity: 1,
      });
      const result = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, event),
      );

      expect(result.triggerInstances).toHaveLength(1);
      expect(result.triggerInstances[0].observedEventCategory).toBe(category);
      expect(result.triggerInstances[0].queueState).not.toBe("resolved");
    },
  );

  it("does not treat transformation as battlefield entry", () => {
    const env = environment(fieldWith([soulWarden()]));
    const event = confirmedEvent(env, {
      eventId: "transform-source",
      eventCategory: "permanent-transformed",
      quantity: 1,
      subjectGroupIds: [env.context.battlefield[0].groupId],
    });
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, event),
    );

    expect(result.eventFacets.map((facet) => facet.eventCategory)).toEqual([
      "permanent-transformed",
    ]);
    expect(result.triggerInstances).toEqual([]);
  });

  it("keeps generated trigger snapshots after the live source leaves", () => {
    const env = environment(fieldWith([soulWarden()]));
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );
    const queue = queueFor(env);
    queue.addGeneration(generation);
    const sourceId = generation.triggerInstances[0].source.sourceGroupId;

    const emptyEnvironment = environment(fieldWith([]));
    expect(emptyEnvironment.context.battlefield).toEqual([]);
    expect(queue.getEntries()[0].source.sourceGroupId).toBe(sourceId);
    expect(queue.getEntries()[0].source.label).toBe("Soul Warden");
  });

  it("provides explicit queue transitions while READY remains unresolved", () => {
    const env = environment(fieldWith([soulWarden()]));
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );
    const queue = queueFor(env);
    queue.addGeneration(generation);
    const id = generation.triggerInstances[0].id;

    expect(queue.getNextPending()?.queueState).toBe("ready");
    expect(queue.getSummary()).toMatchObject({
      compactLabel: "1 Trigger Pending",
      readyEntries: 1,
      resolvedEntries: 0,
    });
    expect(queue.markResolved(id, timestamp, "resolution-1")).toBe(true);
    expect(queue.get(id)?.queueState).toBe("resolved");
    expect(queue.getSummary().pendingEntries).toBe(0);
  });

  it("cancels triggers on undo and restores the same identity on redo", () => {
    const env = environment(fieldWith([soulWarden()]));
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 2)),
    );
    const queue = queueFor(env);
    queue.addGeneration(generation);
    const id = queue.getEntries()[0].id;

    expect(queue.cancelByCausingEvent("creatures-2", timestamp)).toBe(1);
    expect(queue.get(id)?.queueState).toBe("cancelled");
    expect(queue.reconcileGeneration(generation)).toBe(0);
    expect(queue.get(id)?.queueState).toBe("ready");
    expect(queue.getEntries()).toHaveLength(1);
  });

  it("reconciles missing canonical events without orphaning pending triggers", () => {
    const env = environment(fieldWith([soulWarden()]));
    const queue = queueFor(env);
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );
    queue.addGeneration(generation);

    expect(queue.reconcileCanonicalEvents([], timestamp)).toBe(1);
    expect(queue.getEntries()[0].queueState).toBe("cancelled");
  });

  it("serializes and restores platform-neutral pending state without duplication", () => {
    const env = environment(fieldWith([soulWarden()]));
    const queue = queueFor(env);
    const generation = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 3)),
    );
    queue.addGeneration(generation);
    const serialized = serializeAthenaPendingTriggerQueue(queue);
    const restored = restoreAthenaPendingTriggerQueue({
      serialized,
      canonicalSessionId: env.context.sessionId,
      participantId: env.context.localParticipantId,
      timestamp,
    });
    const restoredQueue = new AthenaPendingTriggerQueue({
      canonicalSessionId: env.context.sessionId,
      participantId: env.context.localParticipantId,
      timestamp,
      snapshot: restored.snapshot,
    });

    expect(restored.invalidEntryCount).toBe(0);
    expect(restored.snapshot.entries).toEqual(queue.toSnapshot().entries);
    expect(restoredQueue.addGeneration(generation)).toBe(0);
    expect(restoredQueue.getEntries()).toHaveLength(1);
  });

  it("discards corrupt, incompatible, and invalid restored entries safely", () => {
    const env = environment(fieldWith([soulWarden()]));
    const corrupt = restoreAthenaPendingTriggerQueue({
      serialized: "{not-json",
      canonicalSessionId: env.context.sessionId,
      participantId: env.context.localParticipantId,
      timestamp,
    });
    expect(corrupt.snapshot.entries).toEqual([]);
    expect(corrupt.warnings).not.toEqual([]);

    const queue = queueFor(env);
    const snapshot = queue.toSnapshot();
    const invalid = restoreAthenaPendingTriggerQueue({
      serialized: JSON.stringify({ ...snapshot, entries: [{ id: "bad" }] }),
      canonicalSessionId: env.context.sessionId,
      participantId: env.context.localParticipantId,
      timestamp,
    });
    expect(invalid.invalidEntryCount).toBe(1);
    expect(invalid.snapshot.entries).toEqual([]);
  });

  it("accepts BoardState authoritative trigger records over local derivation", () => {
    const env = environment(fieldWith([soulWarden()]));
    const original = createAthenaForecastInput(
      {
        eventId: "authority-entry",
        eventCategory: "creature-entered",
        eventSource: "boardstate-result",
        authoritySource: "boardstate-authoritative-result",
        quantity: 2,
        timestamp,
      },
      env,
    );
    const replacement = processAthenaReplacementEffects(env, original, {
      authoritativeFinalEvent: original,
    });
    const relationship = env.relationshipMap.relationships.find(
      (entry) =>
        entry.source.currentCardFace === "Soul Warden" &&
        entry.category === "triggered-ability",
    )!;
    const authoritative: AthenaAuthoritativeTriggerRecord = {
      id: "boardstate-trigger-1",
      relationshipId: relationship.id,
      sourceGroupId: relationship.source.battlefieldObjectGroupId,
      sourceLabel: "Soul Warden",
      abilityDefinitionId: relationship.source.abilityIdentifier,
      controllerId: relationship.source.controller,
      observedEventCategory: "creature-entered",
      logicalMultiplicity: 2,
      optional: false,
      queueState: "ready",
      generatedEventCategories: ["life-gained"],
      requirements: [],
      order: 1,
    };
    const result = generateAthenaTriggerInstances(env, replacement, {
      authoritativeTriggers: [authoritative],
    });

    expect(result.triggerInstances).toHaveLength(1);
    expect(result.triggerInstances[0]).toMatchObject({
      authoritySource: "boardstate-authoritative-result",
      authorityPrecedence: 6,
      logicalMultiplicity: 2,
      ordering: { authoritativeOrder: 1 },
    });
  });

  it("runs confirmed GameEvents, Activate Field-style batches, and Echo reports through one queue", () => {
    const env = environment(fieldWith([tracked(rampagingBaloths())]));
    const queue = queueFor(env);
    const landEvent: GameEvent = {
      id: "canonical-land",
      type: "land-entered",
      sourceId: null,
      controller: "you",
      owner: "you",
      quantity: 1,
      batchId: "activate-field-batch",
      groupIds: [],
      characteristics: { cardTypes: ["Land"] },
      metadata: { confirmed: true, integrationSource: "activate-field" },
    };
    const first = processAthenaGameEvent(
      { environment: env, event: landEvent },
      queue,
    );
    expect(first.generation.triggerInstances).toHaveLength(1);

    const batch = processAthenaGameEventBatch({
      environment: env,
      events: [{ ...landEvent, id: "canonical-land-2" }],
      queue,
      canonicalResultReference: "activate-field-result",
    });
    expect(batch.queue.entries).toHaveLength(2);

    const echo = confirmedEvent(env, {
      eventId: "echo-land",
      eventCategory: "land-entered",
      eventSource: "echo-reported",
      authoritySource: "project-echo-voice-report",
      quantity: 1,
      metadata: { confirmed: true },
    });
    const echoResult = processConfirmedAthenaEvent(env, echo, queue);
    expect(echoResult.generation.triggerInstances).toHaveLength(1);
    expect(queue.getEntries()).toHaveLength(3);
  });

  it("rejects stale Athena versions before queue insertion", () => {
    const env = environment(fieldWith([soulWarden()]));
    const input = creatureEvent(env, 1);
    const replacement = processAthenaReplacementEffects(env, input);
    const staleEnvironment: AthenaForecastEnvironment = {
      ...env,
      graph: { ...env.graph, fingerprint: "new-graph" },
    };
    const result = generateAthenaTriggerInstances(
      staleEnvironment,
      replacement,
    );

    expect(result.validity).toBe("stale");
    expect(result.diagnostics.staleGenerationRejected).toBe(true);
    expect(result.triggerInstances).toEqual([]);
  });

  it("marks authority, manual, unsupported, and partially supported states honestly", () => {
    const expected: Array<
      [Partial<AthenaMappedEffectRelationship>, AthenaTriggerQueueState]
    > = [
      [
        { requiresAuthority: true, state: "authority-required" },
        "authority-required",
      ],
      [
        { requiresManualResolution: true, state: "awaiting-manual-resolution" },
        "manual-resolution-required",
      ],
      [{ support: "unsupported-effect", state: "unsupported" }, "unsupported"],
      [{ state: "partially-supported" }, "manual-resolution-required"],
    ];
    for (const [update, state] of expected) {
      const base = environment(fieldWith([soulWarden()]));
      const env = replaceRelationship(base, "Soul Warden", (relationship) => ({
        ...relationship,
        ...update,
      }));
      const result = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, creatureEvent(env, 1)),
      );
      expect(result.triggerInstances[0].queueState).toBe(state);
    }
  });

  it("does not recursively resolve generated events", () => {
    const env = environment(
      fieldWith([soulWarden(), tracked(catharsCrusade())]),
    );
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 2)),
    );

    expect(result.triggerInstances).toHaveLength(2);
    expect(
      result.triggerInstances.flatMap(
        (entry) => entry.generatedEventCategories,
      ),
    ).toEqual(expect.arrayContaining(["life-gained", "counter-placed"]));
    expect(
      result.triggerInstances.every((entry) => entry.queueState === "ready"),
    ).toBe(true);
  });

  it("remains deterministic and efficient for long grouped event streams", () => {
    const observers = Array.from({ length: 25 }, (_, index) =>
      soulWarden(`Soul Warden ${index}`),
    );
    const env = environment(fieldWith(observers));
    const queue = queueFor(env);
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const event = creatureEvent(env, 1_000, { eventId: `stream-${index}` });
      const generation = generateAthenaTriggerInstances(
        env,
        processAthenaReplacementEffects(env, event),
      );
      queue.addGeneration(generation);
    }
    const duration = performance.now() - started;

    expect(queue.getEntries()).toHaveLength(2_500);
    expect(queue.getSummary().logicalPendingMultiplicity).toBe(2_500_000);
    expect(queue.getDiagnostics().maximumLogicalTriggerMultiplicity).toBe(
      1_000,
    );
    expect(duration).toBeLessThan(5_000);
  });

  it("contains no browser globals or UI references in trigger domain models", () => {
    const env = environment(fieldWith([soulWarden()]));
    const result = generateAthenaTriggerInstances(
      env,
      processAthenaReplacementEffects(env, creatureEvent(env, 1)),
    );
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /HTMLElement|localStorage|sessionStorage|indexedDB|CSSStyle|DOMEvent|document|navigator/,
    );
    expect(result.directBattlefieldMutation).toBe(false);
    expect(result.canonicalStateMutated).toBe(false);
  });
});
