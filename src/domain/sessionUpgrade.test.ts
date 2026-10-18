import { beforeEach, describe, expect, it } from "vitest";
import { testCard } from "../test/factories";
import { createCardGroup, createGenericGroup } from "./cards";
import {
  calculateTotals,
  createDefaultField,
  sanitizeImportedField,
} from "./field";
import { deriveBattlefieldIndex } from "./battlefieldIndex";
import { availablePermanentActions } from "./availableActions";
import {
  normalizeDeckSnapshot,
  corroborateDeckIdentity,
  preferredCardIdentity,
} from "./deckSnapshot";
import {
  localSearchCandidates,
  rankContextualCards,
} from "./contextualCardSearch";
import { createDefaultCardSearchFilters } from "./cardSearch";
import { createNewGame } from "./sessionLifecycle";
import { useFieldStore } from "../state/useFieldStore";
import { createPublicGameplaySnapshot } from "../sharedSession/serializer";
import { corroborateArgusWithDeck } from "../argus/argus";
import type { ArgusObservation } from "../argus/types";

const forest = testCard({
  cardId: "forest",
  name: "Forest",
  typeLine: "Basic Land - Forest",
  oracleText: "{T}: Add {G}.",
});
const ring = testCard({
  cardId: "ring",
  name: "Sol Ring",
  typeLine: "Artifact",
  oracleText: "{T}: Add {C}{C}.",
});
const deck = normalizeDeckSnapshot({
  deckId: "deck-one",
  name: "My Deck",
  cards: [{ ...ring, quantity: 1, isCommander: true }],
})!;

beforeEach(() =>
  useFieldStore.setState({
    field: createDefaultField(),
    hydrated: true,
    fullScreenLife: false,
    startupVisible: false,
    modal: null,
    lastResult: null,
    undoStack: [],
    redoStack: [],
  }),
);

describe("fresh battlefield intelligence", () => {
  it("classifies Basic by supertype, counts stacks and references exact contributors", () => {
    const basic = createCardGroup(forest, 5);
    const nonbasic = createCardGroup(
      testCard({
        name: "Nonbasic Forest",
        typeLine: "Land - Forest",
        oracleText: "",
      }),
      3,
    );
    const token = createGenericGroup({
      kind: "Creature",
      quantity: 4,
      label: "Goblins",
      token: true,
    });
    token.characteristics.subtypes = ["Goblin"];
    token.statuses.tapped = true;
    token.counters.Charge = 2;
    const groups = [basic, nonbasic, token];
    const index = deriveBattlefieldIndex(groups);
    expect(index.counts["type:Land"].count).toBe(8);
    expect(index.counts.basic.count).toBe(5);
    expect(index.counts.nonbasic.count).toBe(3);
    expect(index.counts["creature:Goblin"].groupIds).toEqual([token.id]);
    expect(index.counts["counter:Charge"].count).toBe(8);
    expect(index.counts.tapped.count).toBe(4);
    expect(calculateTotals(groups).lands).toBe(8);
    expect(
      deriveBattlefieldIndex(groups.filter((g) => g.id !== nonbasic.id)).counts[
        "type:Land"
      ].count,
    ).toBe(5);
    token.characteristics.cardTypes = ["Artifact"];
    expect(
      deriveBattlefieldIndex(groups).counts["type:Creature"],
    ).toBeUndefined();
  });
  it("starts empty and separates a land leaving from a land play", () => {
    expect(createDefaultField().groups).toEqual([]);
    useFieldStore.getState().addCard(forest, 2);
    useFieldStore.getState().startTurn();
    useFieldStore.getState().adjustLandPlayMark(1);
    const id = useFieldStore.getState().field.groups[0].id;
    useFieldStore.getState().removeGroup(id, 1);
    expect(calculateTotals(useFieldStore.getState().field.groups).lands).toBe(
      1,
    );
    expect(
      useFieldStore.getState().field.preTurnPlanner.availableLandPlays
        .confirmed,
    ).toBe(1);
    useFieldStore.getState().endTurn();
    useFieldStore.getState().startTurn();
    expect(
      useFieldStore.getState().field.preTurnPlanner.availableLandPlays
        .confirmed,
    ).toBe(0);
    expect(calculateTotals(useFieldStore.getState().field.groups).lands).toBe(
      1,
    );
  });
});

describe("session boundaries", () => {
  it("clears game/turn/deck/history while preserving persistent configuration", () => {
    useFieldStore.getState().updateSettings({
      gameplayReminders: true,
      fullScreenLife: true,
      reducedMotion: true,
    });
    useFieldStore.getState().addCard(forest, 8);
    useFieldStore.getState().selectSessionDeck(deck);
    useFieldStore.getState().rememberCard(ring);
    useFieldStore.getState().startTurn();
    useFieldStore.getState().adjustLandPlayMark(1);
    useFieldStore.getState().adjustLife(-12, "loss");
    const previous = useFieldStore.getState().field;
    useFieldStore.getState().resetField();
    const state = useFieldStore.getState();
    expect(state.field.session.id).not.toBe(previous.session.id);
    expect(state.field.player.life).toBe(40);
    expect(state.field.groups).toEqual([]);
    expect(state.field.sessionDeck).toBeNull();
    expect(state.field.recentCards).toEqual([]);
    expect(state.field.settings).toEqual(previous.settings);
    expect(state.field.hub.profile.id).toBe(previous.hub.profile.id);
    expect(state.fullScreenLife).toBe(false);
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.field.turnContext.status).toBe("between-turns");
    expect(state.field.preTurnPlanner.availableLandPlays.confirmed).toBe(0);
    expect(state.field.manualEffects.effects).toEqual([]);
    expect(state.field.argus.observations).toEqual([]);
    expect(state.field.randomizer.history).toEqual([]);
    expect(sanitizeImportedField(state.field)?.groups).toEqual([]);
  });
  it("presentation and deck changes leave canonical gameplay and undo untouched", () => {
    useFieldStore.getState().addCard(ring);
    const before = useFieldStore.getState();
    useFieldStore.getState().setLifePresentation(true);
    expect(useFieldStore.getState().field).toBe(before.field);
    expect(useFieldStore.getState().undoStack).toBe(before.undoStack);
    useFieldStore.getState().selectSessionDeck(deck);
    expect(useFieldStore.getState().field.groups).toEqual(before.field.groups);
    useFieldStore.getState().selectSessionDeck(null);
    expect(useFieldStore.getState().field.groups).toEqual(before.field.groups);
  });
  it("a fresh session clears resources and external game state without deleting learning", () => {
    const previous = createDefaultField();
    previous.player.counters.poison = 7;
    previous.externalGameState.monarchHolderId = "me";
    previous.recentCards = [ring];
    const fresh = createNewGame(previous);
    expect(fresh.player.counters.poison).toBe(0);
    expect(fresh.externalGameState.monarchHolderId).toBeNull();
    expect(fresh.recentCards).toEqual([]);
    expect(fresh.settings.voice).toBe(previous.settings.voice);
  });
});

describe("available tap actions", () => {
  it("activates only one permanent in a stack", () => {
    useFieldStore.getState().addCard(ring, 3);
    const group = useFieldStore.getState().field.groups[0];
    useFieldStore
      .getState()
      .recordTapAbility(group.id, availablePermanentActions(group)[0].id);
    const pending = useFieldStore
      .getState()
      .field.turnContext.triggerMemory.find((item) => item.workflow)!;
    expect(useFieldStore.getState().advanceAbility(pending.id)).toBeNull();
    const groups = useFieldStore.getState().field.groups;
    expect(
      groups
        .filter((entry) => entry.statuses.tapped)
        .reduce((sum, entry) => sum + entry.quantity, 0),
    ).toBe(1);
    expect(
      groups
        .filter((entry) => !entry.statuses.tapped)
        .reduce((sum, entry) => sum + entry.quantity, 0),
    ).toBe(2);
    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.groups).toHaveLength(1);
    expect(useFieldStore.getState().field.groups[0].quantity).toBe(3);
  });
  it("offers one affordance with multiple actions and recalculates after changes", () => {
    const group = createCardGroup(
      testCard({
        ...ring,
        oracleText: "{T}: Add {C}{C}.\n{T}: You gain 3 life.",
      }),
    );
    expect(availablePermanentActions(group)).toHaveLength(2);
    group.statuses.summoningSick = true;
    expect(availablePermanentActions(group)).toHaveLength(2);
    group.statuses.tapped = true;
    expect(availablePermanentActions(group)).toEqual([]);
    group.statuses.tapped = false;
    group.identity = testCard({ ...ring, oracleText: "Flying" });
    expect(availablePermanentActions(group)).toEqual([]);
    group.identity = ring;
    group.depowerMode = "all";
    expect(availablePermanentActions(group)).toEqual([]);
  });
  it("separates committed tapping from undoable life resolution without fake tokens", () => {
    useFieldStore.getState().addCard(
      testCard({
        name: "Life source",
        typeLine: "Artifact",
        oracleText: "{T}: You gain 3 life.",
      }),
    );
    const group = useFieldStore.getState().field.groups[0];
    const action = availablePermanentActions(group)[0];
    const history = useFieldStore.getState().undoStack.length;
    useFieldStore.getState().recordTapAbility(group.id, action.id);
    const pending = useFieldStore
      .getState()
      .field.turnContext.triggerMemory.find((item) => item.workflow)!;
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(useFieldStore.getState().advanceAbility(pending.id)).toBeNull();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(useFieldStore.getState().field.groups[0].statuses.tapped).toBe(true);
    expect(useFieldStore.getState().advanceAbility(pending.id)).toBeNull();
    const state = useFieldStore.getState();
    expect(state.field.player.life).toBe(43);
    expect(state.field.groups).toHaveLength(1);
    expect(state.field.groups[0].statuses.tapped).toBe(true);
    expect(state.undoStack.length).toBe(history + 3);
    state.undo();
    expect(useFieldStore.getState().field.player.life).toBe(40);
    expect(useFieldStore.getState().field.groups[0].statuses.tapped).toBe(true);
    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.groups[0].statuses.tapped).toBe(
      false,
    );
  });
});

describe("deck corroboration and search", () => {
  it("boosts presence, never penalizes absence, and keeps canonical metadata", () => {
    expect(corroborateDeckIdentity(0.7, ring, deck)).toBeGreaterThan(0.7);
    expect(corroborateDeckIdentity(0.7, forest, deck)).toBe(0.7);
    expect(corroborateDeckIdentity(1, ring, deck)).toBe(1);
    const canonical = { ...ring, oracleText: "Current Oracle" };
    expect(preferredCardIdentity(canonical, deck.cards[0])).toBe(canonical);
  });
  it("preserves a changed deck association across gameplay undo and redo", () => {
    useFieldStore.getState().addCard(ring);
    useFieldStore.getState().selectSessionDeck(deck);
    useFieldStore.getState().undo();
    expect(useFieldStore.getState().field.groups).toEqual([]);
    expect(useFieldStore.getState().field.sessionDeck?.deckId).toBe(
      deck.deckId,
    );
    useFieldStore.getState().redo();
    expect(useFieldStore.getState().field.groups).toHaveLength(1);
    expect(useFieldStore.getState().field.sessionDeck?.deckId).toBe(
      deck.deckId,
    );
  });
  it("never exposes a selected deck through the public gameplay projection", () => {
    const field = { ...createDefaultField(), sessionDeck: deck };
    expect(JSON.stringify(createPublicGameplaySnapshot(field))).not.toContain(
      "My Deck",
    );
    expect(sanitizeImportedField(field)?.sessionDeck?.cards[0].name).toBe(
      "Sol Ring",
    );
  });
  it("boosts relevant local candidates without overpowering exact matches or advanced filters", () => {
    const other = testCard({ ...ring, name: "Sol", cardId: "sol" });
    expect(
      rankContextualCards({ query: "Sol", deck, recentCards: [ring] }, [
        ring,
        other,
      ])[0],
    ).toBe(other);
    expect(localSearchCandidates({ query: "sol rng", deck })[0]?.name).toBe(
      "Sol Ring",
    );
    expect(
      localSearchCandidates({
        query: "",
        deck,
        filters: { ...createDefaultCardSearchFilters(), cardTypes: ["Land"] },
      }),
    ).toEqual([]);
  });
  it("corroborates ARGUS and Echo evidence without turning observations into facts", () => {
    const observation: ArgusObservation = {
      id: "seen",
      sessionId: "session",
      kind: "identity",
      confidence: "uncertain",
      sources: ["camera", "echo"],
      objects: [
        {
          observationObjectId: "one",
          matchedGroupId: null,
          identity: ring,
          label: ring.name,
          location: null,
          statuses: {},
          confidence: "uncertain",
        },
      ],
      capturedAt: "now",
      status: "unresolved",
      canonicalEventId: null,
      note: "",
    };
    const result = corroborateArgusWithDeck(observation, deck);
    expect(result.confidence).toBe("probable");
    expect(result.canonicalEventId).toBeNull();
    expect(result.status).toBe("unresolved");
    expect(
      corroborateArgusWithDeck(
        {
          ...observation,
          objects: [{ ...observation.objects[0], identity: forest }],
        },
        deck,
      ).confidence,
    ).toBe("uncertain");
  });
});
