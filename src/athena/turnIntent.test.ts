import { describe, expect, it } from "vitest";
import { createGenericGroup } from "../domain/cards";
import type { FieldState, GameEvent } from "../domain/types";
import { AmbientGameplayEngine } from "../echo/ambientEngine";
import {
  addPlannedAction,
  expireTurnIntent,
  setAvailableLandPlays,
  updatePlannedAction,
} from "../echo/preTurnPlanner";
import { fieldWith, testCard, tracked, withCounters } from "../test/factories";
import { createForecastEnvironment } from "./eventForecast";
import { createAthenaPendingTriggerQueue } from "./triggerQueue";
import {
  AthenaTurnIntentEngine,
  createBasicLandIdentity,
  reconcileAthenaTurnIntentWithCanonicalAction,
} from "./turnIntent";

const timestamp = "2026-08-14T18:00:00.000Z";

function planningField(field: FieldState): FieldState {
  const transition = new AmbientGameplayEngine(field.ambient).requestTransition(
    {
      targetMode: "preTurnPreparation",
      reason: "manual",
      timestamp,
    },
  );
  if (!transition.ok) throw new Error("Could not enter pre-turn preparation.");
  return { ...field, ambient: transition.state };
}

function queueFor(field: FieldState) {
  const environment = createForecastEnvironment(field);
  return createAthenaPendingTriggerQueue({
    canonicalSessionId: environment.context.sessionId,
    participantId: environment.context.localParticipantId,
    timestamp,
  });
}

function plannedField(
  field: FieldState,
  action: Parameters<typeof addPlannedAction>[1],
  availableLandPlays = 0,
): FieldState {
  let planner = addPlannedAction(field.preTurnPlanner, action, timestamp);
  if (availableLandPlays > 0) {
    planner = setAvailableLandPlays(
      planner,
      availableLandPlays,
      timestamp,
      "pre-turn-survey",
    );
  }
  return new AthenaTurnIntentEngine().revalidate(
    { ...planningField(field), preTurnPlanner: planner },
    timestamp,
  );
}

function itemFor(field: FieldState, actionId: string) {
  const item = field.activeTurnActionStrip.items.find(
    (entry) => entry.sourceActionId === actionId,
  );
  if (!item) throw new Error(`Missing prepared action ${actionId}.`);
  return item;
}

function card(name: string, typeLine: string, oracleText = "") {
  return testCard({ name, typeLine, oracleText });
}

describe("ATHENA-10 turn intent and prepared action engine", () => {
  it("keeps Available Land Plays independent and speculative", () => {
    const base = planningField(fieldWith([]));
    const one = setAvailableLandPlays(base.preTurnPlanner, 1, timestamp);
    const two = setAvailableLandPlays(one, 2, timestamp);

    expect(two.availableLandPlays).toMatchObject({
      planned: 2,
      remaining: 2,
      confirmed: 0,
    });
    expect(base.groups).toHaveLength(0);
    expect(two.actions).toHaveLength(0);
  });

  it("revalidates excess named land actions after a mid-turn land-plan change", () => {
    const engine = new AthenaTurnIntentEngine();
    const base = planningField(fieldWith([]));
    let planner = addPlannedAction(
      base.preTurnPlanner,
      {
        id: "first-land",
        type: "land-play",
        title: "Forest",
      },
      timestamp,
    );
    planner = addPlannedAction(
      planner,
      {
        id: "second-land",
        type: "land-play",
        title: "Mountain",
      },
      timestamp,
    );
    let field = engine.revalidate(
      { ...base, preTurnPlanner: planner },
      timestamp,
    );
    expect(itemFor(field, "first-land").validity).toBe("ready");
    expect(itemFor(field, "second-land").validity).toBe("ready");

    planner = setAvailableLandPlays(field.preTurnPlanner, 1, timestamp);
    field = engine.revalidate({ ...field, preTurnPlanner: planner }, timestamp);
    expect(itemFor(field, "first-land").validity).toBe("ready");
    expect(itemFor(field, "second-land").validity).toBe("invalidated");

    planner = setAvailableLandPlays(field.preTurnPlanner, 2, timestamp);
    field = engine.revalidate({ ...field, preTurnPlanner: planner }, timestamp);
    expect(itemFor(field, "second-land").validity).toBe("ready");
    expect(field.groups).toHaveLength(0);
  });

  it("expires unperformed turn actions and rejects a restored plan in another session", () => {
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([]), {
      id: "session-land",
      type: "land-play",
      title: "Forest",
    });
    const expired = expireTurnIntent(field.preTurnPlanner, timestamp);
    expect(expired.actions[0]).toMatchObject({
      status: "cancelled",
      cancelled: true,
    });
    const stale = engine.revalidate(
      {
        ...field,
        session: { ...field.session, id: "different-session" },
      },
      timestamp,
    );
    expect(itemFor(stale, "session-land").validity).toBe("stale");
    expect(stale.groups).toHaveLength(0);
  });

  it.each(["Plains", "Island", "Swamp", "Mountain", "Forest"])(
    "prepares and confirms basic land %s through one canonical event",
    (name) => {
      const engine = new AthenaTurnIntentEngine();
      let field = plannedField(
        fieldWith([]),
        {
          id: `play-${name.toLowerCase()}`,
          type: "land-play",
          title: name,
          land: { primary: name },
        },
        1,
      );
      field = engine.revalidate(field, timestamp);
      expect(field.groups).toHaveLength(0);

      const result = engine.execute({
        field,
        item: itemFor(field, `play-${name.toLowerCase()}`),
        queue: queueFor(field),
        channel: "tap",
        timestamp,
      });

      expect(result.status).toBe("committed");
      expect(result.canonicalEvents[0].type).toBe("land-entered");
      expect(result.field.groups.some((group) => group.label === name)).toBe(
        true,
      );
      expect(result.field.preTurnPlanner.availableLandPlays.remaining).toBe(0);
      expect(result.directBattlefieldMutation).toBe(false);
    },
  );

  it("reuses a known nonbasic identity and never commits before confirmation", () => {
    const commandTower = card(
      "Command Tower",
      "Land",
      "{T}: Add one mana of any color in your commander's color identity.",
    );
    const engine = new AthenaTurnIntentEngine();
    const field = engine.revalidate(
      plannedField(
        { ...fieldWith([]), recentCards: [commandTower] },
        {
          id: "command-tower",
          type: "land-play",
          title: "Command Tower",
          relatedCardId: commandTower.cardId,
          land: { primary: "Command Tower" },
        },
        1,
      ),
      timestamp,
    );

    expect(field.groups).toHaveLength(0);
    const result = engine.execute({
      field,
      item: itemFor(field, "command-tower"),
      queue: queueFor(field),
      channel: "tap",
      timestamp,
    });
    expect(result.field.groups[0].identity?.cardId).toBe(commandTower.cardId);
  });

  it("requires minimum missing card information instead of inventing identity", () => {
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([]), {
      id: "unknown-cast",
      type: "spell-sequence",
      title: "Unknown Graveyard Card",
      execution: { originZone: "graveyard" },
    });
    const item = itemFor(field, "unknown-cast");

    expect(engine.eligibility(field, item).validity).toBe(
      "manual-action-required",
    );
    expect(field.groups).toHaveLength(0);
  });

  it("casts a known planned permanent without requiring digital hand tracking", () => {
    const solRing = card("Sol Ring", "Artifact", "{T}: Add {C}{C}.");
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([]), {
      id: "cast-sol-ring",
      type: "spell-sequence",
      title: "Cast Sol Ring",
      cardSnapshot: solRing,
      execution: {
        support: "local",
        eventCategory: "permanent-entered",
        destinationZone: "battlefield",
      },
    });
    const result = engine.execute({
      field,
      item: itemFor(field, "cast-sol-ring"),
      queue: queueFor(field),
      channel: "tap",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(result.field.groups[0].identity?.cardId).toBe(solRing.cardId);
    expect(result.field.preTurnPlanner.actions[0].status).toBe("completed");
  });

  it("reuses a known exile object for an explicitly planned zone-origin action", () => {
    const impulseCard = tracked(card("Known Exile Card", "Artifact"));
    const exiled = { ...impulseCard, zone: "exile" as const };
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([exiled]), {
      id: "cast-from-exile",
      type: "spell-sequence",
      title: "Cast Known Exile Card",
      relatedCardId: exiled.identity?.cardId,
      relatedGroupId: exiled.id,
      execution: {
        support: "local",
        eventCategory: "permanent-entered",
        originZone: "exile",
        destinationZone: "battlefield",
      },
    });
    const result = engine.execute({
      field,
      item: itemFor(field, "cast-from-exile"),
      queue: queueFor(field),
      channel: "tap",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(
      result.field.groups.find((group) => group.id === exiled.id)?.zone,
    ).toBe("battlefield");
    expect(result.canonicalEvents[0]).toMatchObject({
      zoneOrigin: "exile",
      zoneDestination: "battlefield",
    });
  });

  it("distinguishes explicit and low-confidence inferred intent", () => {
    const engine = new AthenaTurnIntentEngine();
    const explicit = plannedField(fieldWith([]), {
      id: "explicit-land",
      type: "land-play",
      title: "Forest",
      confidence: "explicit",
    });
    const inferred = plannedField(fieldWith([]), {
      id: "inferred-land",
      type: "land-play",
      title: "Forest",
      confidence: "inferred-low-confidence",
    });

    expect(
      engine.eligibility(explicit, itemFor(explicit, "explicit-land")).validity,
    ).toBe("ready");
    expect(
      engine.eligibility(inferred, itemFor(inferred, "inferred-land")).validity,
    ).toBe("awaiting-confirmation");
  });

  it("waits for target, quantity, mode, ordering, authority, and manual actions", () => {
    const source = tracked(card("Utility Mage", "Creature - Wizard"));
    const cases = [
      ["target", "awaiting-target"],
      ["quantity", "awaiting-quantity"],
      ["mode", "awaiting-mode"],
      ["order", "awaiting-order"],
      ["authority", "authority-required"],
      ["manual-resolution", "manual-action-required"],
    ] as const;

    for (const [requirement, expected] of cases) {
      const engine = new AthenaTurnIntentEngine();
      const field = plannedField(fieldWith([source]), {
        id: `ability-${requirement}`,
        type: "activated-ability",
        title: "Activate Utility Mage",
        relatedGroupId: source.id,
        execution: {
          support: requirement === "authority" ? "authority" : "local",
          eventCategory: "permanent-tapped",
          quantity: requirement === "quantity" ? 0 : 1,
          requirements: [requirement],
        },
      });
      expect(
        engine.eligibility(field, itemFor(field, `ability-${requirement}`))
          .validity,
      ).toBe(expected);
    }
  });

  it("revalidates an activated ability after Depower, source removal, or transform", () => {
    const front = card("Front Mage", "Creature - Wizard");
    const source = tracked(front);
    const engine = new AthenaTurnIntentEngine();
    const initial = plannedField(fieldWith([source]), {
      id: "activate-front",
      type: "activated-ability",
      title: "Activate Front Mage",
      relatedGroupId: source.id,
      execution: {
        support: "local",
        eventCategory: "permanent-tapped",
      },
    });
    expect(itemFor(initial, "activate-front").validity).toBe("ready");

    const depowered = engine.revalidate({
      ...initial,
      groups: initial.groups.map((group) =>
        group.id === source.id
          ? { ...group, depowerMode: "all", abilitiesActive: false }
          : group,
      ),
    });
    expect(itemFor(depowered, "activate-front").validity).toBe("invalidated");

    const transformed = engine.revalidate({
      ...initial,
      groups: initial.groups.map((group) =>
        group.id === source.id
          ? {
              ...group,
              identity: card("Back Mage", "Creature - Wizard"),
              statuses: { ...group.statuses, transformed: true },
            }
          : group,
      ),
    });
    expect(itemFor(transformed, "activate-front").validity).toBe("invalidated");

    const removed = engine.revalidate({ ...initial, groups: [] });
    expect(itemFor(removed, "activate-front").validity).toBe("invalidated");
  });

  it("blocks Not Tracked abilities while preserving physical prepared interaction", () => {
    const source = {
      ...tracked(card("Untracked Relic", "Artifact")),
      trackingEnabled: false,
    };
    const engine = new AthenaTurnIntentEngine();
    let field = plannedField(fieldWith([source]), {
      id: "untracked-ability",
      type: "activated-ability",
      title: "Activate Untracked Relic",
      relatedGroupId: source.id,
      execution: { support: "local", eventCategory: "permanent-tapped" },
    });
    field = {
      ...field,
      preTurnPlanner: addPlannedAction(
        field.preTurnPlanner,
        {
          id: "untracked-sacrifice",
          type: "sacrifice",
          title: "Sacrifice Untracked Relic",
          relatedGroupId: source.id,
          execution: {
            support: "local",
            eventCategory: "permanent-sacrificed",
          },
        },
        timestamp,
      ),
    };
    field = engine.revalidate(field, timestamp);

    expect(itemFor(field, "untracked-ability").validity).toBe("invalidated");
    expect(itemFor(field, "untracked-sacrifice").validity).toBe("ready");
  });

  it("sacrifices an exact grouped Treasure quantity through canonical events", () => {
    const treasures = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 10,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([treasures]), {
      id: "sac-three",
      type: "sacrifice",
      title: "Sac Treasure x3",
      relatedGroupId: treasures.id,
      quantity: 3,
      execution: {
        support: "local",
        eventCategory: "permanent-sacrificed",
        quantity: 3,
        destinationZone: "graveyard",
      },
    });
    const result = engine.execute({
      field,
      item: itemFor(field, "sac-three"),
      queue: queueFor(field),
      channel: "tap",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(result.canonicalEvents[0]).toMatchObject({
      type: "permanent-sacrificed",
      quantity: 3,
    });
    expect(
      result.field.groups.find((group) => group.id === treasures.id)?.quantity,
    ).toBe(7);
  });

  it("runs prepared landfall through replacements, triggers, and bookkeeping", () => {
    const hydra = withCounters(
      tracked(
        card(
          "Mossborn Hydra",
          "Creature - Plant Hydra",
          "Landfall - Whenever a land you control enters, double the number of +1/+1 counters on this creature.",
        ),
      ),
      { "+1/+1": 1 },
    );
    const season = tracked(
      card(
        "Doubling Season",
        "Enchantment",
        "If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.",
      ),
    );
    const lands = Array.from({ length: 8 }, (_, index) =>
      createGenericGroup({ kind: "Land", label: `Land ${index + 1}` }),
    );
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(
      fieldWith([hydra, season, ...lands]),
      {
        id: "forest-landfall",
        type: "land-play",
        title: "Forest",
        land: { primary: "Forest" },
      },
      2,
    );
    const result = engine.execute({
      field,
      item: itemFor(field, "forest-landfall"),
      queue: queueFor(field),
      channel: "tap",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect({
      validity: result.pipeline?.validity,
      triggers: result.pipeline?.generatedTriggerIds,
      autoStop: result.pipeline?.autoResolution?.stoppedBecause,
      autoResults: result.pipeline?.autoResolution?.results.map((entry) => ({
        status: entry.status,
        reason: entry.failureReason,
      })),
    }).toMatchObject({ validity: "committed", triggers: [expect.any(String)] });
    expect(
      result.field.groups.filter((group) =>
        group.characteristics.cardTypes.includes("Land"),
      ),
    ).toHaveLength(9);
    expect(
      result.field.groups.find((group) => group.id === hydra.id)?.counters[
        "+1/+1"
      ],
    ).toBe(3);
    expect(result.field.preTurnPlanner.availableLandPlays.remaining).toBe(1);
    expect(result.tutorialEvents).toContain("automatic-bookkeeping-completed");
  });

  it("prevents voice confirmation without the enrolled speaker and matches verified speech", () => {
    const engine = new AthenaTurnIntentEngine();
    const field = plannedField(fieldWith([]), {
      id: "voice-forest",
      type: "land-play",
      title: "Play Forest",
      land: { primary: "Forest" },
    });
    const item = itemFor(field, "voice-forest");

    expect(
      engine.matchVoice({
        field,
        intentKind: "play-land",
        transcript: "play forest",
        speakerVerified: false,
      }).accepted,
    ).toBe(false);
    const match = engine.matchVoice({
      field,
      intentKind: "play-land",
      transcript: "play forest",
      speakerVerified: true,
    });
    expect(match.itemId).toBe(item.id);
    const blocked = engine.execute({
      field,
      item,
      queue: queueFor(field),
      channel: "voice",
      speakerVerified: false,
      timestamp,
    });
    expect(blocked.status).toBe("invalid");
    expect(blocked.canonicalEvents).toHaveLength(0);
  });

  it("turns a verified basic-land phrase into an exact generic-slot card identity", () => {
    const engine = new AthenaTurnIntentEngine();
    const base = planningField(fieldWith([]));
    const planner = setAvailableLandPlays(base.preTurnPlanner, 1, timestamp);
    const field = engine.revalidate(
      { ...base, preTurnPlanner: planner },
      timestamp,
    );
    const item = field.activeTurnActionStrip.items.find(
      (entry) =>
        entry.kind === "play-planned-land" && entry.sourceActionId === null,
    );
    if (!item) throw new Error("Missing generic land slot.");
    const result = engine.execute({
      field,
      item,
      queue: queueFor(field),
      channel: "voice",
      speakerVerified: true,
      recognizedText: "Play Forest",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(result.field.groups[0].identity?.cardId).toBe("basic-land:forest");
    expect(result.field.groups[0].label).toBe("Forest");
  });

  it("reconciles voice/tap retries, undo-shaped state, and redo without duplication", () => {
    const engine = new AthenaTurnIntentEngine();
    const before = plannedField(
      fieldWith([]),
      {
        id: "race-forest",
        type: "land-play",
        title: "Forest",
        land: { primary: "Forest" },
      },
      1,
    );
    const item = itemFor(before, "race-forest");
    const first = engine.execute({
      field: before,
      item,
      queue: queueFor(before),
      channel: "tap",
      timestamp,
    });
    const retry = engine.execute({
      field: first.field,
      item,
      queue: queueFor(first.field),
      channel: "voice",
      speakerVerified: true,
      timestamp,
    });

    expect(
      first.field.groups.filter((group) => group.label === "Forest"),
    ).toHaveLength(1);
    expect(retry.status).toBe("duplicate");
    expect(retry.canonicalEvents).toHaveLength(0);
    expect(before.groups).toHaveLength(0);
    expect(first.field.preTurnPlanner.availableLandPlays.confirmed).toBe(1);
  });

  it("treats unexpected land divergence as normal and preserves unrelated intent", () => {
    let field = plannedField(
      fieldWith([]),
      {
        id: "planned-forest",
        type: "land-play",
        title: "Forest",
        land: { primary: "Forest" },
      },
      1,
    );
    field = {
      ...field,
      preTurnPlanner: addPlannedAction(
        field.preTurnPlanner,
        {
          id: "planned-combat",
          type: "planned-attack",
          title: "Combat",
        },
        timestamp,
      ),
    };
    const event: GameEvent = {
      id: "unexpected-mountain",
      type: "land-entered",
      sourceId: null,
      controller: "you",
      owner: "you",
      quantity: 1,
      batchId: "unexpected-mountain",
      groupIds: [],
      zoneDestination: "battlefield",
      metadata: { label: "Mountain", confirmed: true },
    };
    const reconciled = reconcileAthenaTurnIntentWithCanonicalAction(
      field,
      event,
      timestamp,
    );

    expect(
      reconciled.preTurnPlanner.actions.find(
        (action) => action.id === "planned-forest",
      )?.status,
    ).toBe("diverged");
    expect(
      reconciled.preTurnPlanner.actions.find(
        (action) => action.id === "planned-combat",
      )?.status,
    ).toBe("planned");
    expect(reconciled.preTurnPlanner.availableLandPlays.remaining).toBe(0);
  });

  it("revalidates only affected source actions while unrelated lands stay ready", () => {
    const source = tracked(card("Ability Source", "Creature - Wizard"));
    const engine = new AthenaTurnIntentEngine();
    let field = plannedField(fieldWith([source]), {
      id: "source-ability",
      type: "activated-ability",
      title: "Activate Ability Source",
      relatedGroupId: source.id,
      execution: { support: "local", eventCategory: "permanent-tapped" },
    });
    field = {
      ...field,
      preTurnPlanner: addPlannedAction(
        field.preTurnPlanner,
        {
          id: "unrelated-land",
          type: "land-play",
          title: "Forest",
        },
        timestamp,
      ),
    };
    const next = engine.revalidate({ ...field, groups: [] }, timestamp);

    expect(itemFor(next, "source-ability").validity).toBe("invalidated");
    expect(itemFor(next, "unrelated-land").validity).toBe("ready");
  });

  it("updates action requirements mid-turn without restarting the plan", () => {
    const source = tracked(card("Modal Source", "Creature - Wizard"));
    let field = plannedField(fieldWith([source]), {
      id: "modal-action",
      type: "activated-ability",
      title: "Activate Modal Source",
      relatedGroupId: source.id,
      execution: {
        support: "local",
        eventCategory: "permanent-tapped",
        requirements: ["mode"],
      },
    });
    const turnId = field.preTurnPlanner.turnId;
    const planner = updatePlannedAction(
      field.preTurnPlanner,
      "modal-action",
      {
        execution: {
          ...field.preTurnPlanner.actions[0].execution,
          mode: "first",
          requirements: [],
        },
      },
      timestamp,
    );
    field = new AthenaTurnIntentEngine().revalidate(
      { ...field, preTurnPlanner: planner },
      timestamp,
    );

    expect(field.preTurnPlanner.turnId).toBe(turnId);
    expect(itemFor(field, "modal-action").validity).toBe("ready");
  });

  it("uses portable basic-land models without browser state", () => {
    const forest = createBasicLandIdentity("Play Forest");
    expect(forest).toMatchObject({
      name: "Forest",
      typeLine: "Basic Land - Forest",
      colorIdentity: ["G"],
    });
    expect(createBasicLandIdentity("Unknown Land")).toBeNull();
  });

  it("prepares twenty actions beside a thousand-token group without expanding it", () => {
    const treasures = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 1_000,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    const base = planningField(fieldWith([treasures]));
    let planner = base.preTurnPlanner;
    for (let index = 0; index < 20; index += 1) {
      planner = addPlannedAction(
        planner,
        {
          id: `large-plan-${index}`,
          type: "land-play",
          title: index % 2 === 0 ? "Forest" : "Mountain",
          order: index,
        },
        timestamp,
      );
    }
    const field = new AthenaTurnIntentEngine().revalidate(
      { ...base, preTurnPlanner: planner },
      timestamp,
    );

    expect(field.preTurnPlanner.actions).toHaveLength(20);
    expect(
      field.activeTurnActionStrip.items.filter(
        (item) => item.sourceActionId !== null,
      ),
    ).toHaveLength(20);
    expect(field.groups).toHaveLength(1);
    expect(field.groups[0].quantity).toBe(1_000);
  });
});
