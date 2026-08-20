import { describe, expect, it } from "vitest";
import { createGenericGroup } from "../domain/cards";
import { calculateTotals } from "../domain/field";
import type { AthenaTriggerResolutionDefinition } from "../domain/triggerResolutionDefinitions";
import type { FieldState, PermanentGroup } from "../domain/types";
import {
  catharsCrusade,
  animPakal,
  doublingSeason,
  fieldWith,
  genericCreature,
  testCard,
  tracked,
  withCounters,
} from "../test/factories";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "./eventForecast";
import {
  AthenaPendingTriggerQueue,
  createAthenaPendingTriggerQueue,
  processConfirmedAthenaEvent,
} from "./triggerQueue";
import type {
  AthenaTriggerInstance,
  AthenaTriggerQueueState,
} from "./triggerQueueTypes";
import {
  applyAthenaCanonicalConsequenceEvent,
  athenaResolutionActionsForDecision,
  evaluateAthenaTriggerResolutionEligibility,
  processAthenaPendingTriggers,
  processAthenaConfirmedEventWithBookkeeping,
  resolveAthenaPendingTrigger,
} from "./triggerResolution";

const timestamp = "2026-08-14T12:00:00.000Z";

function soulWarden(name = "Soul Warden", optional = false) {
  return testCard({
    name,
    typeLine: "Creature - Human Cleric",
    oracleText: optional
      ? "Whenever another creature enters, you may gain 1 life."
      : "Whenever another creature enters, you gain 1 life.",
    power: "1",
    toughness: "1",
  });
}

function mossbornHydra() {
  return testCard({
    name: "Mossborn Hydra",
    typeLine: "Creature - Plant Hydra",
    oracleText:
      "Landfall - Whenever a land you control enters, double the number of +1/+1 counters on this creature.",
    power: "0",
    toughness: "0",
  });
}

function scuteSwarm() {
  return testCard({
    name: "Scute Swarm",
    typeLine: "Creature - Insect",
    oracleText:
      "Landfall - Whenever a land you control enters, create a 1/1 green Insect creature token. If you control six or more lands, create a token that's a copy of this creature instead.",
    power: "1",
    toughness: "1",
  });
}

function travelingChocobo() {
  return testCard({
    name: "Traveling Chocobo",
    typeLine: "Creature - Bird",
    oracleText:
      "If a land or Bird you control entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
    power: "3",
    toughness: "2",
  });
}

function land(name: string): PermanentGroup {
  return createGenericGroup({
    kind: "Land",
    label: name,
    cardTypes: ["Land"],
  });
}

function canonicalEvent(
  field: FieldState,
  input: {
    eventId: string;
    eventCategory:
      | "creature-entered"
      | "land-entered"
      | "token-created"
      | "counter-placed";
    quantity: number;
    groupIds?: string[];
    counterType?: string;
    token?: boolean;
  },
) {
  const environment = createForecastEnvironment(field);
  return createAthenaForecastInput(
    {
      eventId: input.eventId,
      eventCategory: input.eventCategory,
      eventSource: "canonical-event",
      authoritySource: "confirmed-canonical-session-result",
      timestamp,
      quantity: input.quantity,
      subjectGroupIds: input.groupIds ?? [],
      counterType: input.counterType,
      knownCharacteristics:
        input.eventCategory === "creature-entered" || input.token
          ? {
              cardTypes: ["Creature"],
              subtypes: input.token ? ["Soldier"] : [],
              colors: [],
              supertypes: [],
              manaValue: 0,
              isToken: Boolean(input.token),
              isCreature: true,
              isLegendary: false,
            }
          : input.eventCategory === "land-entered"
            ? { cardTypes: ["Land"], isCreature: false, isToken: false }
            : null,
      metadata: { confirmed: true },
    },
    environment,
  );
}

function queueFor(field: FieldState): AthenaPendingTriggerQueue {
  const environment = createForecastEnvironment(field);
  return createAthenaPendingTriggerQueue({
    canonicalSessionId: environment.context.sessionId,
    participantId: environment.context.localParticipantId,
    timestamp,
  });
}

function generate(
  field: FieldState,
  event: ReturnType<typeof canonicalEvent>,
  queue = queueFor(field),
) {
  return {
    queue,
    result: processConfirmedAthenaEvent(
      createForecastEnvironment(field),
      event,
      queue,
      { timestamp },
    ),
  };
}

function stateOf(
  trigger: AthenaTriggerInstance,
  queueState: AthenaTriggerQueueState,
  requirements = trigger.requirements,
): AthenaTriggerInstance {
  return { ...trigger, queueState, requirements };
}

describe("ATHENA-08 trigger resolution eligibility", () => {
  it("classifies deterministic, optional, target, quantity, mode, order, authority, stale, and invalid triggers", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const event = canonicalEvent(field, {
      eventId: "eligibility-entry",
      eventCategory: "creature-entered",
      quantity: 1,
    });
    const { queue } = generate(field, event);
    const trigger = queue.getEntries()[0];
    expect(
      evaluateAthenaTriggerResolutionEligibility(trigger, field).status,
    ).toBe("auto-resolvable");
    expect(
      evaluateAthenaTriggerResolutionEligibility(
        { ...trigger, optional: true },
        field,
      ).status,
    ).toBe("awaiting-optional-decision");
    const requirement = trigger.requirements[0] ?? {
      id: "requirement",
      kind: "target" as const,
      prompt: "Choose target",
      sourceGroupId: trigger.source.sourceGroupId,
      candidateGroupIds: [],
      eventCategories: ["creature-entered" as const],
      status: "unresolved" as const,
      requiredBeforeResolution: true as const,
    };
    for (const [kind, expected] of [
      ["target", "awaiting-target"],
      ["quantity", "awaiting-quantity"],
      ["mode", "awaiting-mode"],
      ["object", "awaiting-selection"],
    ] as const) {
      const candidate = stateOf(trigger, "ready", [{ ...requirement, kind }]);
      expect(
        evaluateAthenaTriggerResolutionEligibility(candidate, field).status,
      ).toBe(expected);
    }
    const externalTarget = stateOf(trigger, "ready", [
      { ...requirement, kind: "target" },
    ]);
    expect(
      evaluateAthenaTriggerResolutionEligibility(externalTarget, field, {
        selectedOptionIds: ["opponent-placeholder:target"],
      }).status,
    ).toBe("manual-resolution-required");
    expect(
      evaluateAthenaTriggerResolutionEligibility(externalTarget, field, {
        selectedOptionIds: ["untracked:graveyard:creature"],
      }).status,
    ).toBe("manual-resolution-required");
    expect(
      evaluateAthenaTriggerResolutionEligibility(
        {
          ...trigger,
          ordering: { ...trigger.ordering, userOrderingRequired: true },
        },
        field,
      ).status,
    ).toBe("awaiting-order");
    expect(
      evaluateAthenaTriggerResolutionEligibility(
        {
          ...trigger,
          ordering: { ...trigger.ordering, authorityOrderingRequired: true },
        },
        field,
      ).status,
    ).toBe("authority-required");
    expect(
      evaluateAthenaTriggerResolutionEligibility(
        { ...trigger, canonicalSessionId: "stale" },
        field,
      ).status,
    ).toBe("stale");
    expect(
      evaluateAthenaTriggerResolutionEligibility(
        { ...trigger, queueState: "resolved" },
        field,
      ).status,
    ).toBe("invalid");
  });

  it("applies one structured trigger-order response to the shared pending queue", () => {
    const field = fieldWith([tracked(soulWarden()), tracked(catharsCrusade())]);
    const generated = generate(
      field,
      canonicalEvent(field, {
        eventId: "ordered-entry",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const snapshot = generated.queue.toSnapshot();
    expect(snapshot.entries).toHaveLength(2);
    const sameEventGroupId = snapshot.entries[0].ordering.sameEventGroupId;
    const pending = new AthenaPendingTriggerQueue({
      canonicalSessionId: snapshot.canonicalSessionId,
      participantId: snapshot.participantId,
      timestamp,
      snapshot: {
        ...snapshot,
        entries: snapshot.entries.map((entry) => ({
          ...entry,
          ordering: {
            ...entry.ordering,
            sameEventGroupId,
            userOrderingRequired: true,
            authoritativeOrder: null,
          },
        })),
      },
    });
    const selected = snapshot.entries.map((entry) => entry.id).reverse();
    expect(pending.applyUserOrder(selected, timestamp)).toBe(true);
    expect(pending.getEntries().map((entry) => entry.id)).toEqual(selected);
    expect(
      pending
        .getEntries()
        .every((entry) => !entry.ordering.userOrderingRequired),
    ).toBe(true);
  });
});

describe("ATHENA-08 automatic bookkeeping", () => {
  it.each([1, 6, 100])(
    "resolves Soul Warden x%i through one grouped life event",
    (quantity) => {
      const field = fieldWith([tracked(soulWarden())]);
      const { queue } = generate(
        field,
        canonicalEvent(field, {
          eventId: `soul-${quantity}`,
          eventCategory: "creature-entered",
          quantity,
        }),
      );
      expect(queue.getEntries()).toHaveLength(1);
      expect(queue.getEntries()[0].logicalMultiplicity).toBe(quantity);
      const resolved = processAthenaPendingTriggers({
        field,
        queue,
        timestamp,
      });
      expect(resolved.field.player.life).toBe(40 + quantity);
      expect(resolved.results[0].status).toBe("resolved");
      expect(resolved.results[0].canonicalEventIds).toHaveLength(1);
      expect(resolved.results[0].eventRecords[0].logicalEventCount).toBe(
        quantity,
      );
      expect(queue.getEntries()[0].queueState).toBe("resolved");
    },
  );

  it("does not resolve the same trigger twice", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "idempotent-soul",
        eventCategory: "creature-entered",
        quantity: 2,
      }),
    );
    const triggerId = queue.getEntries()[0].id;
    const first = resolveAthenaPendingTrigger(field, queue, triggerId, {
      timestamp,
    });
    const second = resolveAthenaPendingTrigger(
      first.resultingField,
      queue,
      triggerId,
      { timestamp },
    );
    expect(first.resultingField.player.life).toBe(42);
    expect(second.status).toBe("invalid");
    expect(second.resultingField.player.life).toBe(42);
  });

  it("keeps optional triggers pending until accepted or declined", () => {
    const field = fieldWith([tracked(soulWarden("Soul's Attendant", true))]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "optional-entry",
        eventCategory: "creature-entered",
        quantity: 3,
      }),
    );
    const triggerId = queue.getEntries()[0].id;
    expect(
      resolveAthenaPendingTrigger(field, queue, triggerId, { timestamp })
        .status,
    ).toBe("input-required");
    const accepted = resolveAthenaPendingTrigger(field, queue, triggerId, {
      timestamp,
      decision: { optionalAccepted: true },
    });
    expect(accepted.status).toBe("resolved");
    expect(accepted.resultingField.player.life).toBe(43);

    const second = generate(
      field,
      canonicalEvent(field, {
        eventId: "optional-decline",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const declined = resolveAthenaPendingTrigger(
      field,
      second.queue,
      second.queue.getEntries()[0].id,
      { timestamp, decision: { optionalAccepted: false } },
    );
    expect(declined.status).toBe("declined");
    expect(declined.resultingField.player.life).toBe(40);
  });

  it("declines only an optional branch and preserves later mandatory bookkeeping", () => {
    const definition: AthenaTriggerResolutionDefinition = {
      id: "optional-life-then-token",
      version: 1,
      labels: ["Optional life then token"],
      observedEvents: ["creature-entered"],
      mandatory: true,
      locallySupported: true,
      requiresAuthority: false,
      requiresManualResolution: false,
      optionalActionIds: ["optional-life"],
      actions: [
        {
          id: "optional-life",
          kind: "gain-life",
          target: "player-controller",
          quantity: { kind: "fixed-per-trigger", value: 3 },
          eventCategory: "life-gained",
        },
        {
          id: "mandatory-token",
          kind: "create-token",
          target: "player-controller",
          quantity: { kind: "fixed-per-trigger", value: 1 },
          token: {
            name: "Soldier",
            power: 1,
            toughness: 1,
            cardTypes: ["Creature"],
            subtypes: ["Soldier"],
            colors: ["white"],
            tapped: false,
            attacking: false,
            copySourceWhenLandThresholdAtLeast: null,
          },
          eventCategory: "token-created",
        },
      ],
      semanticLabel: "Optional life then token",
    };

    expect(
      athenaResolutionActionsForDecision(definition, {
        optionalAccepted: false,
      }).map((action) => action.id),
    ).toEqual(["mandatory-token"]);
    expect(
      athenaResolutionActionsForDecision(definition, {
        optionalAccepted: true,
      }).map((action) => action.id),
    ).toEqual(["optional-life", "mandatory-token"]);
  });

  it("resolves validated custom automation through the shared engine", () => {
    const field: FieldState = {
      ...fieldWith([]),
      customEffects: [
        {
          id: "custom-life-entry",
          name: "Creature welcome",
          enabled: true,
          trigger: "creature-entered",
          action: {
            kind: "life",
            mode: "gain",
            amount: { type: "fixed", value: 2 },
          },
        },
      ],
    };
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "custom-entry",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    expect(queue.getEntries()).toHaveLength(1);
    const resolved = resolveAthenaPendingTrigger(
      field,
      queue,
      queue.getEntries()[0].id,
      { timestamp },
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.resultingField.player.life).toBe(42);
  });

  it("resumes selected-target custom automation from one structured decision", () => {
    const target = { ...genericCreature(), label: "Decision Target" };
    const field: FieldState = {
      ...fieldWith([target]),
      customEffects: [
        {
          id: "custom-target-counter",
          name: "Choose counter recipient",
          enabled: true,
          trigger: "creature-entered",
          action: {
            kind: "add-counters",
            counter: "+1/+1",
            target: "selected",
            amount: { type: "fixed", value: 1 },
          },
        },
      ],
    };
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "custom-target-entry",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const trigger = queue.getEntries()[0];
    expect(
      evaluateAthenaTriggerResolutionEligibility(trigger, field).status,
    ).toBe("awaiting-target");
    const resolved = resolveAthenaPendingTrigger(field, queue, trigger.id, {
      timestamp,
      decision: { targetGroupIds: [target.id] },
    });
    expect(resolved.status).toBe("resolved");
    expect(
      resolved.resultingField.groups.find((group) => group.id === target.id)
        ?.counters["+1/+1"],
    ).toBe(1);
  });

  it("commits a structured counter distribution as separate replacement-aware events", () => {
    const targets = [
      genericCreature(),
      genericCreature(),
      genericCreature(),
    ].map((group, index) => ({ ...group, label: `Distribution ${index + 1}` }));
    const field: FieldState = {
      ...fieldWith(targets),
      customEffects: [
        {
          id: "custom-distribution-counter",
          name: "Distribute counters",
          enabled: true,
          trigger: "creature-entered",
          action: {
            kind: "add-counters",
            counter: "+1/+1",
            target: "selected",
            amount: { type: "fixed", value: 6 },
          },
        },
      ],
    };
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "distribution-entry",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const resolved = resolveAthenaPendingTrigger(
      field,
      queue,
      queue.getEntries()[0].id,
      {
        timestamp,
        decision: {
          distribution: {
            [targets[0].id]: 3,
            [targets[1].id]: 2,
            [targets[2].id]: 1,
          },
        },
      },
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.eventRecords).toHaveLength(3);
    expect(
      targets.map(
        (target) =>
          resolved.resultingField.groups.find((group) => group.id === target.id)
            ?.counters["+1/+1"],
      ),
    ).toEqual([3, 2, 1]);
  });

  it("preserves a generated Soul Warden trigger after its source leaves", () => {
    const source = tracked(soulWarden());
    const field = fieldWith([source]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "source-leaves",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const withoutSource = { ...field, groups: [] };
    const result = resolveAthenaPendingTrigger(
      withoutSource,
      queue,
      queue.getEntries()[0].id,
      { timestamp },
    );
    expect(result.status).toBe("resolved");
    expect(result.resultingField.player.life).toBe(41);
    expect(result.sourceLabel).toBe("Soul Warden");
  });
});

describe("ATHENA-08 replacement and derived-state integration", () => {
  it("resolves Doubling Season, Soul Warden, and Cathars' Crusade in the required order", () => {
    const soul = tracked(soulWarden());
    const crusade = tracked(catharsCrusade());
    const doubling = tracked(doublingSeason());
    const existing = genericCreature();
    const field = fieldWith([soul, crusade, doubling, existing]);
    const environment = createForecastEnvironment(field);
    const event = createAthenaForecastInput(
      {
        eventId: "scenario-a-tokens",
        eventCategory: "token-created",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp,
        quantity: 3,
        knownCharacteristics: {
          cardTypes: ["Creature"],
          subtypes: ["Soldier"],
          colors: ["W"],
          supertypes: [],
          manaValue: 0,
          isToken: true,
          isCreature: true,
          isLegendary: false,
        },
        tokenDefinition: {
          id: "token:soldier:1/1",
          name: "Soldier",
          power: 1,
          toughness: 1,
          characteristics: {
            cardTypes: ["Creature"],
            subtypes: ["Soldier"],
            colors: ["W"],
            supertypes: [],
            manaValue: 0,
            isToken: true,
            isCreature: true,
            isLegendary: false,
            knownFields: [
              "cardTypes",
              "supertypes",
              "subtypes",
              "colors",
              "manaValue",
              "isToken",
              "isCreature",
              "isLegendary",
            ],
          },
        },
        metadata: { confirmed: true },
      },
      environment,
    );
    const queue = queueFor(field);
    const processed = processConfirmedAthenaEvent(environment, event, queue, {
      timestamp,
    });
    expect(processed.replacement.finalEvent?.quantity).toBe(6);
    expect(
      processed.generation.triggerInstances.map((entry) => [
        entry.source.label,
        entry.logicalMultiplicity,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["Soul Warden", 6],
        ["Cathars' Crusade", 6],
      ]),
    );
    const committedRoot = applyAthenaCanonicalConsequenceEvent(
      field,
      processed.replacement.finalEvent!,
      "root-scenario-a",
    );
    expect(committedRoot.valid).toBe(true);
    const cycle = processAthenaPendingTriggers({
      field: committedRoot.field,
      queue,
      timestamp,
    });
    expect(cycle.field.player.life).toBe(46);
    const soldiers = cycle.field.groups.find(
      (group) => group.label === "Soldier",
    );
    expect(soldiers?.quantity).toBe(6);
    for (const creature of cycle.field.groups.filter(
      (group) => group.characteristics.isCreature,
    )) {
      expect(creature.counters["+1/+1"]).toBe(12);
    }
    expect(cycle.results.every((result) => result.status === "resolved")).toBe(
      true,
    );
    expect(cycle.results.flatMap((result) => result.childTriggerIds)).toEqual(
      [],
    );
  });

  it("routes Mossborn Hydra counters through Doubling Season and derived P/T", () => {
    const hydra = withCounters(tracked(mossbornHydra()), { "+1/+1": 1 });
    const field = fieldWith([hydra, tracked(doublingSeason())]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "mossborn-landfall",
        eventCategory: "land-entered",
        quantity: 1,
      }),
    );
    const cycle = processAthenaPendingTriggers({ field, queue, timestamp });
    const resolved = cycle.field.groups.find((group) => group.id === hydra.id)!;
    expect(resolved.counters["+1/+1"]).toBe(3);
    expect(resolved.pt.currentPower).toBe(3);
    expect(cycle.results[0].replacementResultIds).toHaveLength(1);
  });

  it("resolves Anim Pakal counters before reading the token quantity", () => {
    const anim = tracked(animPakal());
    const field = fieldWith([
      anim,
      tracked(doublingSeason()),
      tracked(soulWarden()),
      tracked(catharsCrusade()),
    ]);
    const environment = createForecastEnvironment(field);
    const attack = createAthenaForecastInput(
      {
        eventId: "anim-attack",
        eventCategory: "attack-declared",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp,
        quantity: 1,
        subjectGroupIds: [anim.id],
        metadata: { confirmed: true, nonGnomeAttacker: true },
      },
      environment,
    );
    const queue = queueFor(field);
    processConfirmedAthenaEvent(environment, attack, queue, { timestamp });
    const cycle = processAthenaPendingTriggers({ field, queue, timestamp });
    const resolvedAnim = cycle.field.groups.find(
      (group) => group.id === anim.id,
    )!;
    const gnomes = cycle.field.groups.find((group) => group.label === "Gnome");
    expect(resolvedAnim.counters["+1/+1"]).toBe(10);
    expect(gnomes?.quantity).toBe(4);
    expect(gnomes?.statuses.tapped).toBe(true);
    expect(gnomes?.statuses.attacking).toBe(true);
    expect(cycle.field.player.life).toBe(44);
  });

  it("offers one confirmed-event pipeline for replacement, commit, triggers, and bookkeeping", () => {
    const field = fieldWith([tracked(soulWarden()), tracked(doublingSeason())]);
    const environment = createForecastEnvironment(field);
    const event = createAthenaForecastInput(
      {
        eventId: "shared-pipeline-token",
        eventCategory: "token-created",
        eventSource: "echo-reported",
        authoritySource: "project-echo-voice-report",
        timestamp,
        quantity: 2,
        knownCharacteristics: {
          cardTypes: ["Creature"],
          subtypes: ["Gnome"],
          isToken: true,
          isCreature: true,
        },
        tokenDefinition: {
          id: "token:gnome:1/1",
          name: "Gnome",
          power: 1,
          toughness: 1,
          characteristics: {
            cardTypes: ["Creature"],
            supertypes: [],
            subtypes: ["Gnome"],
            colors: [],
            manaValue: 0,
            isToken: true,
            isCreature: true,
            isLegendary: false,
            knownFields: [
              "cardTypes",
              "supertypes",
              "subtypes",
              "colors",
              "manaValue",
              "isToken",
              "isCreature",
              "isLegendary",
            ],
          },
        },
        metadata: { confirmed: true },
      },
      environment,
    );
    const queue = queueFor(field);
    const result = processAthenaConfirmedEventWithBookkeeping({
      field,
      event,
      queue,
      timestamp,
    });
    expect(result.validity).toBe("committed");
    expect(result.rootReplacement.finalEvent?.quantity).toBe(4);
    expect(result.resultingField.player.life).toBe(44);
    expect(
      result.resultingField.groups.find((group) => group.label === "Gnome")
        ?.quantity,
    ).toBe(4);
  });

  it("creates Scute Swarm copies at six lands and keeps token stacks grouped", () => {
    const scute = tracked(scuteSwarm());
    const field = fieldWith([
      scute,
      ...Array.from({ length: 6 }, (_, index) => land(`Land ${index}`)),
    ]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "scute-landfall",
        eventCategory: "land-entered",
        quantity: 1,
      }),
    );
    const cycle = processAthenaPendingTriggers({ field, queue, timestamp });
    const copies = cycle.field.groups.filter(
      (group) => group.characteristics.isToken && group.label === "Scute Swarm",
    );
    expect(copies).toHaveLength(1);
    expect(copies[0].quantity).toBe(1);
  });

  it("applies Traveling Chocobo's supported additional-trigger rule", () => {
    const field = fieldWith([
      tracked(soulWarden()),
      tracked(travelingChocobo()),
    ]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "bird-entry",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const trigger = queue
      .getEntries()
      .find((entry) => entry.source.label === "Soul Warden");
    expect(trigger?.logicalMultiplicity).toBe(1);

    const environment = createForecastEnvironment(field);
    const bird = createAthenaForecastInput(
      {
        eventId: "actual-bird-entry",
        eventCategory: "creature-entered",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp,
        quantity: 1,
        knownCharacteristics: {
          cardTypes: ["Creature"],
          subtypes: ["Bird"],
          isCreature: true,
          isToken: false,
        },
        metadata: { confirmed: true },
      },
      environment,
    );
    const birdQueue = queueFor(field);
    processConfirmedAthenaEvent(environment, bird, birdQueue, { timestamp });
    expect(
      birdQueue
        .getEntries()
        .find((entry) => entry.source.label === "Soul Warden")
        ?.logicalMultiplicity,
    ).toBe(2);
  });
});

describe("ATHENA-08 boundaries and safety", () => {
  it("Correction Only produces no replacement, trigger, or resolution consequences", () => {
    const creature = genericCreature();
    const field = fieldWith([
      creature,
      tracked(doublingSeason()),
      tracked(soulWarden()),
    ]);
    const environment = createForecastEnvironment(field);
    const correction = createAthenaForecastInput(
      {
        eventId: "counter-correction",
        eventCategory: "counter-placed",
        eventSource: "correction-only",
        authoritySource: "correction-only",
        timestamp,
        quantity: 5,
        subjectGroupIds: [creature.id],
        counterType: "+1/+1",
        metadata: { correctionOnly: true },
      },
      environment,
    );
    const queue = queueFor(field);
    const processing = processConfirmedAthenaEvent(
      environment,
      correction,
      queue,
      { timestamp },
    );
    expect(processing.replacement.validity).toBe("bypassed");
    expect(processing.generation.triggerInstances).toEqual([]);
    expect(
      processAthenaPendingTriggers({ field, queue, timestamp }).results,
    ).toEqual([]);
  });

  it("pauses repeated deterministic patterns without corrupting the queue", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const queue = queueFor(field);
    for (let index = 0; index < 5; index += 1) {
      generate(
        field,
        canonicalEvent(field, {
          eventId: `repeat-${index}`,
          eventCategory: "creature-entered",
          quantity: 1,
        }),
        queue,
      );
    }
    const cycle = processAthenaPendingTriggers({
      field,
      queue,
      timestamp,
      budget: { maximumRepeatedPattern: 2 },
    });
    expect(cycle.potentialRepeatingInteraction).toBe(true);
    expect(cycle.stoppedBecause).toBe("potential-repeating-interaction");
    expect(cycle.field.player.life).toBe(42);
    expect(
      queue.getEntries().filter((entry) => entry.queueState === "ready"),
    ).toHaveLength(3);
  });

  it("stops at explicit event and queue budgets", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const queue = queueFor(field);
    for (let index = 0; index < 4; index += 1) {
      generate(
        field,
        canonicalEvent(field, {
          eventId: `budget-${index}`,
          eventCategory: "creature-entered",
          quantity: 1,
        }),
        queue,
      );
    }
    const cycle = processAthenaPendingTriggers({
      field,
      queue,
      timestamp,
      budget: { maximumTriggers: 1 },
    });
    expect(cycle.pausedForSafety).toBe(true);
    expect(cycle.processedTriggerIds).toHaveLength(1);
    expect(cycle.field.player.life).toBe(41);
  });

  it("handles very large grouped quantities without one-object allocation", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const { queue } = generate(
      field,
      canonicalEvent(field, {
        eventId: "thousand-entry",
        eventCategory: "creature-entered",
        quantity: 1000,
      }),
    );
    const cycle = processAthenaPendingTriggers({ field, queue, timestamp });
    expect(cycle.field.player.life).toBe(1040);
    expect(cycle.results).toHaveLength(1);
    expect(cycle.generatedCanonicalEvents).toHaveLength(1);
  });

  it("restores an interrupted resolving trigger into a recoverable queue state", () => {
    const field = fieldWith([tracked(soulWarden())]);
    const generated = generate(
      field,
      canonicalEvent(field, {
        eventId: "interrupted",
        eventCategory: "creature-entered",
        quantity: 1,
      }),
    );
    const snapshot = generated.queue.toSnapshot();
    snapshot.entries[0] = stateOf(snapshot.entries[0], "resolving");
    const restored = new AthenaPendingTriggerQueue({
      canonicalSessionId: snapshot.canonicalSessionId,
      participantId: snapshot.participantId,
      timestamp,
      snapshot,
    });
    const result = resolveAthenaPendingTrigger(
      field,
      restored,
      snapshot.entries[0].id,
      { timestamp },
    );
    expect(result.status).toBe("resolved");
    expect(result.resultingField.player.life).toBe(41);
  });

  it("keeps canonical and derived totals exact after grouped token commits", () => {
    const field = fieldWith([]);
    const environment = createForecastEnvironment(field);
    const tokenEvent = createAthenaForecastInput(
      {
        eventId: "large-token-event",
        eventCategory: "token-created",
        eventSource: "lite-helper",
        authoritySource: "lite-local-helper-result",
        timestamp,
        quantity: 1000,
        knownCharacteristics: {
          cardTypes: ["Artifact", "Creature"],
          subtypes: ["Treasure"],
          isToken: true,
          isCreature: true,
        },
        tokenDefinition: {
          id: "token:treasure-creature",
          name: "Treasure Creature",
          power: 1,
          toughness: 1,
          characteristics: {
            cardTypes: ["Artifact", "Creature"],
            supertypes: [],
            subtypes: ["Treasure"],
            colors: [],
            manaValue: 0,
            isToken: true,
            isCreature: true,
            isLegendary: false,
            knownFields: [
              "cardTypes",
              "supertypes",
              "subtypes",
              "colors",
              "manaValue",
              "isToken",
              "isCreature",
              "isLegendary",
            ],
          },
        },
        metadata: { confirmed: true },
      },
      environment,
    );
    const committed = applyAthenaCanonicalConsequenceEvent(
      field,
      tokenEvent,
      "large-token-resolution",
    );
    expect(committed.field.groups).toHaveLength(1);
    expect(committed.field.groups[0].quantity).toBe(1000);
    expect(calculateTotals(committed.field.groups).artifacts).toBe(1000);
    expect(calculateTotals(committed.field.groups).tokens).toBe(1000);
  });
});
