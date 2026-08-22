import { beforeEach, describe, expect, it } from "vitest";
import {
  createGenericGroup,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import { calculateTotals, normalizeField } from "../domain/field";
import {
  addPlannedAction,
  setAvailableLandPlays,
} from "../echo/preTurnPlanner";
import { AmbientGameplayEngine } from "../echo/ambientEngine";
import { useFieldStore } from "../state/useFieldStore";
import {
  catharsCrusade,
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
import { revalidateAthenaTurnIntent } from "./turnIntent";
import { AthenaTurnIntentEngine } from "./turnIntent";
import { createAthenaPendingTriggerQueue } from "./triggerQueue";
import { activeAthenaDecision } from "./decisionEngine";

const timestamp = "2026-08-22T12:00:00.000Z";

describe("ATHENA-15 final gameplay integration", () => {
  beforeEach(() => {
    useFieldStore.setState({
      field: fieldWith([]),
      undoStack: [],
      redoStack: [],
      lastResult: null,
      modal: null,
    });
  });

  it("routes a manual counter game action through replacement, canonical commit, and undo", () => {
    const creature = genericCreature(3);
    useFieldStore.setState({
      field: fieldWith([tracked(doublingSeason()), creature]),
    });

    useFieldStore
      .getState()
      .applyCounters(creature.id, "+1/+1", 1, "one", 1, "game-action");

    const current = useFieldStore.getState();
    const affected = current.field.groups.find(
      (group) =>
        group.label === creature.label && group.counters["+1/+1"] === 2,
    );
    const unaffected = current.field.groups.find(
      (group) => group.label === creature.label && !group.counters["+1/+1"],
    );
    expect(affected).toMatchObject({ quantity: 1 });
    expect(unaffected).toMatchObject({ quantity: 2 });
    expect(
      current.field.athena.liveTurn.processedCanonicalEventIds.some((id) =>
        id.startsWith("canonical:manual-canonical-event"),
      ),
    ).toBe(true);
    expect(current.undoStack).toHaveLength(1);

    current.undo();
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.id === creature.id),
    ).toMatchObject({ quantity: 3, counters: {} });
    useFieldStore.getState().redo();
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.counters["+1/+1"] === 2),
    ).toMatchObject({ quantity: 1 });
  });

  it("routes an unplanned land through landfall bookkeeping and planner divergence", () => {
    const hydra = withCounters(
      tracked(
        testCard({
          name: "Mossborn Hydra",
          typeLine: "Creature - Plant Hydra",
          oracleText:
            "Landfall - Whenever a land you control enters, double the number of +1/+1 counters on this creature.",
          power: "0",
          toughness: "0",
        }),
      ),
      { "+1/+1": 1 },
    );
    const lands = createGenericGroup({ kind: "Land", quantity: 8 });
    let field = fieldWith([hydra, tracked(doublingSeason()), lands]);
    let planner = addPlannedAction(
      field.preTurnPlanner,
      {
        id: "planned-forest",
        type: "land-play",
        title: "Forest",
        land: { primary: "Forest" },
      },
      timestamp,
    );
    planner = addPlannedAction(
      planner,
      { id: "planned-combat", type: "planned-attack", title: "Combat" },
      timestamp,
    );
    planner = setAvailableLandPlays(planner, 1, timestamp);
    field = revalidateAthenaTurnIntent(
      normalizeField({ ...field, preTurnPlanner: planner }),
      timestamp,
    );
    useFieldStore.setState({ field });

    useFieldStore.getState().setRelevantTotal("lands", 9, "one-at-a-time");

    const current = useFieldStore.getState().field;
    const resolvedHydra = current.groups.find((group) => group.id === hydra.id);
    expect(calculateTotals(current.groups).lands).toBe(9);
    expect(resolvedHydra?.counters["+1/+1"]).toBe(3);
    expect(resolvedHydra?.pt.currentPower).toBe(3);
    expect(
      current.preTurnPlanner.actions.find(
        (action) => action.id === "planned-forest",
      )?.status,
    ).toBe("diverged");
    expect(
      current.preTurnPlanner.actions.find(
        (action) => action.id === "planned-combat",
      )?.status,
    ).toBe("planned");
    expect(current.preTurnPlanner.availableLandPlays.remaining).toBe(0);
  });

  it("keeps exact editors on Correction Only with no gameplay lineage", () => {
    useFieldStore.setState({
      field: fieldWith([
        tracked(
          testCard({
            name: "Life Observer",
            typeLine: "Enchantment",
            oracleText: "Whenever you gain life, create a token.",
          }),
        ),
      ]),
    });

    useFieldStore.getState().setLifeExact(28);
    useFieldStore.getState().setPlayerCounter("commanderDamage", 6);

    const current = useFieldStore.getState();
    expect(current.field.player.life).toBe(28);
    expect(current.field.player.counters.commanderDamage).toBe(6);
    expect(current.field.athena.liveTurn.processedCanonicalEventIds).toEqual(
      [],
    );
    expect(
      current.field.athena.reconciliation.recent.map((record) => [
        record.level,
        record.gameplayEventsGenerated,
        record.triggersGenerated,
      ]),
    ).toEqual([
      ["quick-correction", 0, 0],
      ["quick-correction", 0, 0],
    ]);
    expect(current.field.groups).toHaveLength(1);

    current.undo();
    expect(useFieldStore.getState().field.player.life).toBe(28);
    expect(useFieldStore.getState().field.player.counters.commanderDamage).toBe(
      0,
    );
  });

  it("does not treat unrelated damage events as damage to the local player", () => {
    const field = fieldWith([]);
    useFieldStore.setState({ field });
    const event = createAthenaForecastInput(
      {
        eventId: "opponent-damage",
        eventCategory: "damage-dealt",
        eventSource: "canonical-event",
        authoritySource: "confirmed-canonical-session-result",
        timestamp,
        quantity: 7,
        metadata: { confirmed: true, recipient: "opponent" },
      },
      createForecastEnvironment(field),
    );

    const result = useFieldStore.getState().processConfirmedAthenaEvent(event);

    expect(result.validity).toBe("committed");
    expect(useFieldStore.getState().field.player.life).toBe(40);
  });

  it("resolves the token, life, and counter cascade exactly once", () => {
    const soulWarden = tracked(
      testCard({
        name: "Soul Warden",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you gain 1 life.",
        power: "1",
        toughness: "1",
      }),
    );
    const field = fieldWith([
      soulWarden,
      tracked(catharsCrusade()),
      tracked(doublingSeason()),
    ]);
    useFieldStore.setState({ field });
    const event = creatureTokenEvent(field, "final-cascade", 3);

    const first = useFieldStore.getState().processConfirmedAthenaEvent(event);
    expect(first.validity).toBe("committed");
    const committed = useFieldStore.getState().field;
    expect(committed.player.life).toBe(46);
    expect(
      committed.groups.find((group) => group.label === "Soldier")?.quantity,
    ).toBe(6);
    for (const creature of committed.groups.filter(
      (group) => group.characteristics.isCreature,
    )) {
      expect(creature.counters["+1/+1"]).toBe(12);
    }

    const retry = useFieldStore.getState().processConfirmedAthenaEvent(event);
    expect(retry.validity, retry.reason).toBe("duplicate");
    expect(useFieldStore.getState().field.player.life).toBe(46);
    expect(useFieldStore.getState().undoStack).toHaveLength(1);

    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(
      useFieldStore
        .getState()
        .field.groups.some((group) => group.label === "Soldier"),
    ).toBe(false);
    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.player.life).toBe(46);
  });

  it("keeps Not Tracked replacement effects inactive without retroactive work", () => {
    const season = {
      ...tracked(doublingSeason()),
      trackingEnabled: false,
    };
    const field = fieldWith([season]);
    useFieldStore.setState({ field });

    useFieldStore
      .getState()
      .processConfirmedAthenaEvent(
        creatureTokenEvent(field, "untracked-tokens", 3),
      );
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Soldier")?.quantity,
    ).toBe(3);

    const seasonId = useFieldStore
      .getState()
      .field.groups.find(
        (group) => group.identity?.name === "Doubling Season",
      )!.id;
    useFieldStore.getState().setTrackingEnabled(seasonId, true, "all", 1);
    const resumed = useFieldStore.getState().field;
    useFieldStore
      .getState()
      .processConfirmedAthenaEvent(
        creatureTokenEvent(resumed, "resumed-tokens", 3),
      );
    expect(
      useFieldStore
        .getState()
        .field.groups.find((group) => group.label === "Soldier")?.quantity,
    ).toBe(9);
  });

  it("carries a prepared action directly into one persisted contextual decision", () => {
    const attendant = tracked(
      testCard({
        name: "Soul's Attendant",
        typeLine: "Creature - Human Cleric",
        oracleText: "Whenever another creature enters, you may gain 1 life.",
        power: "1",
        toughness: "1",
      }),
    );
    const bear = testCard({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      oracleText: "",
      power: "2",
      toughness: "2",
    });
    let field = fieldWith([attendant]);
    const transition = new AmbientGameplayEngine(
      field.ambient,
    ).requestTransition({
      targetMode: "preTurnPreparation",
      reason: "manual",
      timestamp,
    });
    if (!transition.ok) throw new Error("Could not enter planning mode.");
    field = { ...field, ambient: transition.state, recentCards: [bear] };
    const planner = addPlannedAction(
      field.preTurnPlanner,
      {
        id: "cast-bear",
        type: "spell-sequence",
        title: "Runeclaw Bear",
        relatedCardId: bear.cardId,
      },
      timestamp,
    );
    const engine = new AthenaTurnIntentEngine();
    field = engine.revalidate({ ...field, preTurnPlanner: planner }, timestamp);
    const item = field.activeTurnActionStrip.items.find(
      (entry) => entry.sourceActionId === "cast-bear",
    );
    if (!item) throw new Error("Prepared Bear action was not available.");
    const queue = createAthenaPendingTriggerQueue({
      canonicalSessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      timestamp,
    });

    const result = engine.execute({
      field,
      item,
      queue,
      channel: "tap",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(result.field.player.life).toBe(40);
    expect(
      result.field.groups.some((group) => group.identity?.name === bear.name),
    ).toBe(true);
    const decision = activeAthenaDecision(result.field.athena.decisions);
    expect(decision).toMatchObject({
      type: "optional-effect",
      preparedActionId: null,
      status: "active",
    });
    expect(decision?.continuation.kind).toBe("trigger-resolution");
    expect(
      result.field.athena.decisions.requests.filter(
        (request) => request.status === "active",
      ),
    ).toHaveLength(1);
  });

  it("replaces part of a generic stack through reconciliation without a false entry", () => {
    const baseGeneric = genericCreature(3);
    const generic = withStackKey(
      recalculateStats({
        ...baseGeneric,
        counters: { Shield: 2 },
        pt: {
          ...baseGeneric.pt,
          basePower: 5,
          baseToughness: 6,
        },
      }),
    );
    const actual = testCard({
      name: "Soul Warden",
      typeLine: "Creature - Human Cleric",
      oracleText: "Whenever another creature enters, you gain 1 life.",
      power: "1",
      toughness: "1",
    });
    useFieldStore.setState({ field: fieldWith([generic]) });

    useFieldStore.getState().replaceGeneric(generic.id, actual, "one", 1);

    const field = useFieldStore.getState().field;
    expect(
      field.groups.find((group) => group.identity?.cardId === actual.cardId),
    ).toMatchObject({
      quantity: 1,
      counters: { Shield: 2 },
      pt: { basePower: 5, baseToughness: 6 },
    });
    expect(field.groups.find((group) => group.isGeneric)).toMatchObject({
      quantity: 2,
    });
    expect(field.athena.liveTurn.processedCanonicalEventIds).toEqual([]);
    expect(field.athena.reconciliation.recent.at(-1)).toMatchObject({
      source: "manual-correction",
      correctionOnly: true,
      gameplayEventsGenerated: 0,
    });
  });

  it("runs Transform All and status edits as current-state reconciliation", () => {
    const creature = withCounters(
      withStackKey({
        ...tracked(
          testCard({
            name: "Original Creature",
            typeLine: "Creature - Human",
            oracleText: "",
            power: "2",
            toughness: "2",
          }),
        ),
        quantity: 2,
      }),
      { "+1/+1": 3 },
    );
    const transformed = testCard({
      name: "Transformed Creature",
      typeLine: "Creature - Shapeshifter",
      oracleText: "",
      power: "4",
      toughness: "4",
    });
    useFieldStore.setState({ field: fieldWith([creature]) });

    useFieldStore.getState().transformCreatures(transformed, "all", [], false);
    const transformedField = useFieldStore.getState().field;
    expect(transformedField.groups[0]).toMatchObject({
      id: creature.id,
      quantity: 2,
      label: "Transformed Creature",
      counters: { "+1/+1": 3 },
      statuses: { transformed: true },
    });
    expect(transformedField.athena.liveTurn.processedCanonicalEventIds).toEqual(
      [],
    );

    useFieldStore.getState().toggleStatus(creature.id, "tapped", true);
    expect(useFieldStore.getState().field.groups[0].statuses.tapped).toBe(true);
    expect(
      useFieldStore
        .getState()
        .field.athena.reconciliation.recent.every(
          (record) =>
            record.correctionOnly && record.gameplayEventsGenerated === 0,
        ),
    ).toBe(true);

    useFieldStore.getState().restoreTransformations();
    expect(useFieldStore.getState().field.groups[0]).toMatchObject({
      id: creature.id,
      quantity: 2,
      label: creature.label,
      counters: { "+1/+1": 3 },
      statuses: { transformed: false, tapped: true },
    });
  });
});

function creatureTokenEvent(
  field: ReturnType<typeof fieldWith>,
  eventId: string,
  quantity: number,
) {
  return createAthenaForecastInput(
    {
      eventId,
      eventCategory: "token-created",
      eventSource: "canonical-event",
      authoritySource: "confirmed-canonical-session-result",
      timestamp,
      quantity,
      knownCharacteristics: {
        cardTypes: ["Creature"],
        subtypes: ["Soldier"],
        isToken: true,
        isCreature: true,
      },
      tokenDefinition: {
        id: "token:soldier:1/1",
        name: "Soldier",
        power: 1,
        toughness: 1,
        characteristics: {
          cardTypes: ["Creature"],
          supertypes: [],
          subtypes: ["Soldier"],
          colors: ["W"],
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
    createForecastEnvironment(field),
  );
}
