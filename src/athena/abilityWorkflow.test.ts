import { beforeEach, describe, expect, it } from "vitest";
import { cardAbilities, abilityAvailability } from "../domain/abilityMetadata";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createNewGame } from "../domain/sessionLifecycle";
import { createCardGroup } from "../domain/cards";
import { animPakal, testCard, genericCreature } from "../test/factories";
import { useFieldStore } from "../state/useFieldStore";
import { compileAbilityInstructions } from "./abilityInstructions";
import { workflowRequirements } from "./abilityWorkflow";
import type { AbilityChoice } from "./abilityWorkflowTypes";
import { createPublicGameplaySnapshot } from "../sharedSession/serializer";

function fixture(text: string, typeLine = "Artifact", quantity = 1) {
  const group = createCardGroup(
    testCard({ name: "Test Source", typeLine, oracleText: text }),
    quantity,
  );
  const field = createDefaultField();
  field.groups = [group, genericCreature(2)];
  useFieldStore.setState({ field, undoStack: [], redoStack: [], modal: null });
  return group;
}
function begin(text: string) {
  const group = fixture(text);
  useFieldStore.getState().beginAbility(group.id, cardAbilities(group)[0].id);
  return {
    id: useFieldStore.getState().field.turnContext.triggerMemory.at(-1)!.id,
    group,
  };
}
const store = () => useFieldStore.getState();
const workflow = (id: string) =>
  store().field.turnContext.triggerMemory.find((item) => item.id === id)!
    .workflow!;
const choose = (id: string, key: string, choice: AbilityChoice) =>
  store().setAbilityChoice(id, key, choice);
beforeEach(() =>
  useFieldStore.setState({
    field: createDefaultField(),
    undoStack: [],
    redoStack: [],
    modal: null,
  }),
);

describe("shared explicit ability workflow", () => {
  it("never shares private selections or duplicates a restored resolved action", () => {
    const { id } = begin("{T}: You gain 3 life.");
    choose(id, "selection.9", { external: "Private hidden card" });
    expect(
      JSON.stringify(createPublicGameplaySnapshot(store().field)),
    ).not.toContain("Private hidden card");
    expect(
      JSON.stringify(createPublicGameplaySnapshot(store().field)),
    ).not.toContain("workflow");
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().advanceAbility(id)).toBeNull();
    useFieldStore.setState({
      field: sanitizeImportedField(JSON.parse(JSON.stringify(store().field)))!,
    });
    expect(store().advanceAbility(id)).not.toBeNull();
    expect(store().field.player.life).toBe(43);
  });
  it("separates paid tap cost from life resolution and restores both with Undo", () => {
    const { id, group } = begin("{T}: You gain 3 life.");
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.player.life).toBe(40);
    expect(
      store().field.groups.find((entry) => entry.id === group.id)!.statuses
        .tapped,
    ).toBe(true);
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.player.life).toBe(43);
    expect(
      store().field.groups.filter((entry) => entry.characteristics.isToken),
    ).toHaveLength(0);
    store().undo();
    expect(store().field.player.life).toBe(40);
    expect(workflow(id).stage).toBe("resolution");
    store().undo();
    expect(store().field.groups[0].statuses.tapped).toBe(false);
    store().redo();
    expect(workflow(id).costsCommitted).toBe(true);
  });
  it("cancelled effects do not refund sacrifices", () => {
    const { id } = begin("Sacrifice another creature: You gain 3 life.");
    const creature = store().field.groups[1];
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "selection.0", { ids: [creature.id] });
    expect(store().advanceAbility(id)).toBeNull();
    const battlefield = store()
      .field.groups.filter((entry) => entry.zone === "battlefield")
      .reduce((sum, entry) => sum + entry.quantity, 0);
    store().advanceAbility(id, "cancel");
    expect(store().field.player.life).toBe(40);
    expect(
      store()
        .field.groups.filter((entry) => entry.zone === "battlefield")
        .reduce((sum, entry) => sum + entry.quantity, 0),
    ).toBe(battlefield);
  });
  it.each([
    "{T}: Put a +1/+1 counter on each creature you control.",
    "Whenever a creature dies, put a +1/+1 counter on each creature you control.",
  ])("uses the same deterministic resolution for %s", (text) => {
    const { id } = begin(text);
    if (workflow(id).stage === "selection")
      expect(store().advanceAbility(id)).toBeNull();
    expect(workflowRequirements(store().field, workflow(id))).toEqual([]);
    expect(store().advanceAbility(id)).toBeNull();
    expect(
      store().field.groups.find((group) => group.characteristics.isCreature)!
        .counters["+1/+1"],
    ).toBe(1);
    expect(store().advanceAbility(id)).not.toBeNull();
  });
  it("excludes the source from each other creature", () => {
    const group = fixture(
      "{T}: Put two +1/+1 counters on each other creature you control.",
      "Creature",
    );
    store().beginAbility(group.id, cardAbilities(group)[0].id);
    const id = store().field.turnContext.triggerMemory.at(-1)!.id;
    store().advanceAbility(id);
    store().advanceAbility(id);
    expect(
      store().field.groups.find((entry) => entry.id === group.id)!.counters[
        "+1/+1"
      ],
    ).toBeUndefined();
    expect(
      store().field.groups.find((entry) => entry.id !== group.id)!.counters[
        "+1/+1"
      ],
    ).toBe(2);
  });
  it("gathers activation targets before paying costs and reuses them at resolution", () => {
    const { id } = begin("{T}: Put a +1/+1 counter on target creature.");
    expect(store().advanceAbility(id)).not.toBeNull();
    const creature = store().field.groups[1];
    choose(id, "targets.0", { ids: [creature.id] });
    expect(store().advanceAbility(id)).toBeNull();
    expect(workflowRequirements(store().field, workflow(id))).toEqual([]);
    expect(store().advanceAbility(id)).toBeNull();
    expect(
      store()
        .field.groups.filter((entry) => entry.counters["+1/+1"] === 1)
        .reduce((sum, entry) => sum + entry.quantity, 0),
    ).toBe(1);
  });
  it("permits zero up-to targets without inventing a selection", () => {
    const { id } = begin(
      "Whenever a creature dies, put a +1/+1 counter on up to two target creatures.",
    );
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "resolution.0", { ids: [] });
    expect(store().advanceAbility(id)).toBeNull();
    expect(
      store().field.groups.every((entry) => !entry.counters["+1/+1"]),
    ).toBe(true);
  });
  it("requires a complete counter distribution", () => {
    const { id } = begin(
      "Whenever a creature dies, distribute three +1/+1 counters among one, two, or three target creatures.",
    );
    const creature = store().field.groups[1];
    choose(id, "resolution.0", {
      ids: [creature.id],
      distribution: { [creature.id]: 2 },
    });
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "resolution.0", {
      ids: [creature.id],
      distribution: { [creature.id]: 3 },
    });
    expect(store().advanceAbility(id)).toBeNull();
  });
  it("declining an optional sacrifice skips dependent draw", () => {
    const { id } = begin(
      "Whenever a creature dies, you may sacrifice a creature. If you do, draw a card.",
    );
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "resolution.0", { accepted: false });
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.groups.some((entry) => entry.zone === "hand")).toBe(
      false,
    );
  });
  it("accepted optional sacrifice requires an object before dependent draw", () => {
    const { id } = begin(
      "Whenever a creature dies, you may sacrifice a creature. If you do, draw a card.",
    );
    choose(id, "resolution.0", { accepted: true });
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "resolution.0.0", { ids: [store().field.groups[1].id] });
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.groups.some((entry) => entry.zone === "hand")).toBe(
      true,
    );
  });
  it("does not conflate reflexive triggers or unknown conditions with unconditional effects", () => {
    for (const text of [
      "Sacrifice a creature. When you do, draw a card.",
      "You gain 3 life unless an opponent pays 1 life.",
      "Reveal hidden information.",
    ])
      expect(compileAbilityInstructions(text)[0].kind).toBe("manual");
  });
  it("counter removal cost uses source, bounds state and cleans zero", () => {
    const { id, group } = begin(
      "Remove three +1/+1 counters from this creature: You gain 1 life.",
    );
    expect(store().advanceAbility(id)).not.toBeNull();
    store().applyCounters(group.id, "+1/+1", 3, "all", 1, "correction");
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.groups[0].counters["+1/+1"]).toBeUndefined();
    expect(store().field.player.life).toBe(40);
  });
  it("mana payment is explicit, not a fabricated pool", () => {
    const { id } = begin("{2}, {T}: You gain 1 life.");
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "selection.0", { accepted: true });
    expect(store().advanceAbility(id)).toBeNull();
  });
  it("external targets remain references and never create permanents", () => {
    const { id } = begin("{T}: Destroy target artifact an opponent controls.");
    choose(id, "targets.0", { external: "Opponent's Sol Ring" });
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().advanceAbility(id)).not.toBeNull();
    expect(store().field.groups).toHaveLength(2);
    expect(store().advanceAbility(id, "manual")).toBeNull();
  });
  it("splits token and life outcomes", () => {
    const { id } = begin(
      "Whenever a creature dies, create a Treasure token. You gain 1 life.",
    );
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.player.life).toBe(41);
    expect(
      store().field.groups.find((group) => group.label === "Treasure")
        ?.quantity,
    ).toBe(1);
  });
  it("preserves the verified Anim Pakal sequence", () => {
    const group = createCardGroup(animPakal());
    store().field.groups.push(group);
    store().beginAbility(group.id, cardAbilities(group)[0].id);
    const id = store().field.turnContext.triggerMemory.at(-1)!.id;
    expect(store().advanceAbility(id)).toBeNull();
    expect(
      store().field.groups.find((entry) => entry.label === "Gnome")?.quantity,
    ).toBe(1);
  });
  it("survives restore during selection and between activation and resolution", () => {
    const { id } = begin("{2}: You gain 3 life.");
    choose(id, "selection.0", { accepted: true });
    store().importField(JSON.parse(store().exportField()));
    expect(workflow(id).choices["selection.0"].accepted).toBe(true);
    expect(store().advanceAbility(id)).toBeNull();
    const restored = sanitizeImportedField(
      JSON.parse(JSON.stringify(store().field)),
    )!;
    useFieldStore.setState({ field: restored });
    expect(workflow(id).stage).toBe("resolution");
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.player.life).toBe(43);
  });
  it("keeps pending work across turn boundaries, clears it on New Game", () => {
    const { id } = begin("{T}: You gain 3 life.");
    store().advanceAbility(id);
    store().startTurn();
    store().endTurn();
    store().startTurn();
    expect(workflow(id).stage).toBe("resolution");
    expect(createNewGame(store().field).turnContext.triggerMemory).toEqual([]);
  });
});

describe("ability identity and restrictions", () => {
  it("recalculates granted abilities when their source leaves or is disabled", () => {
    const source = fixture(
      'Creatures you control have "{T}: You gain 1 life."',
    );
    const recipient = createCardGroup(
      testCard({ name: "Recipient", typeLine: "Creature", oracleText: "" }),
    );
    store().field.groups.push(recipient);
    expect(cardAbilities(recipient, store().field)).toHaveLength(1);
    source.depowerMode = "all";
    expect(cardAbilities(recipient, store().field)).toHaveLength(0);
    source.depowerMode = "none";
    source.zone = "graveyard";
    expect(cardAbilities(recipient, store().field)).toHaveLength(0);
  });
  it("shares loyalty usage on one permanent but not another copy", () => {
    const source = fixture(
      "+1: You gain 1 life.\n-1: You gain 2 life.",
      "Planeswalker",
    );
    const copy = { ...source, id: "other-planeswalker" };
    store().field.groups.push(copy);
    store().beginAbility(source.id, cardAbilities(source)[0].id);
    expect(
      store().advanceAbility(
        store().field.turnContext.triggerMemory.at(-1)!.id,
      ),
    ).toBeNull();
    expect(
      abilityAvailability(
        store().field,
        store().field.groups[0],
        cardAbilities(source)[1],
      ).available,
    ).toBe(false);
    expect(
      abilityAvailability(store().field, copy, cardAbilities(copy)[0])
        .available,
    ).toBe(true);
  });
  it("asks for modal decisions, then resolves only the selected mode", () => {
    const { id } = begin(
      "{T}: Choose one —\n• You gain 3 life.\n• Create a Treasure token.",
    );
    expect(store().advanceAbility(id)).not.toBeNull();
    choose(id, "targets.0", { modes: [0] });
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().advanceAbility(id)).toBeNull();
    expect(store().field.player.life).toBe(43);
    expect(
      store().field.groups.some((group) => group.label === "Treasure"),
    ).toBe(false);
  });
  it("discards the selected hand card as a cost without resolving the effect", () => {
    const { id } = begin("Discard a card: You gain 2 life.");
    const hand = createCardGroup(
      testCard({ name: "Chosen Card", typeLine: "Sorcery", oracleText: "" }),
    );
    hand.zone = "hand";
    store().field.groups.push(hand);
    choose(id, "selection.0", { ids: [hand.id] });
    expect(store().advanceAbility(id)).toBeNull();
    expect(
      store().field.groups.find((group) => group.id === hand.id)?.zone,
    ).toBe("graveyard");
    expect(store().field.player.life).toBe(40);
    expect(store().advanceAbility(id, "cancel")).toBeNull();
    expect(
      store().field.groups.find((group) => group.id === hand.id)?.zone,
    ).toBe("graveyard");
  });
  it("filters malformed imported timeline entries without affecting gameplay", () => {
    const field = createDefaultField();
    field.activity = [null] as unknown as typeof field.activity;
    expect(normalizeField(field).activity).toEqual([]);
    expect(normalizeField(field).player.life).toBe(40);
  });
  it.each(["Artifact", "Creature", "Enchantment", "Land", "Planeswalker"])(
    "recognizes %s abilities without confusing triggers",
    (type) => {
      const group = fixture(
        '{T}: You gain 1 life.\nWhenever a creature dies, you gain 1 life.\nCreatures you control have "{T}: Add {G}."',
        type,
      );
      expect(
        cardAbilities(group).filter((ability) => ability.kind === "activated"),
      ).toHaveLength(1);
    },
  );
  it("recognizes an ability-word-prefixed triggered ability", () => {
    const group = fixture(
      "Landfall — Whenever a land enters under your control, you gain 1 life.",
    );
    const abilities = cardAbilities(group);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].kind).toBe("triggered");
    expect(abilities[0].effect).toBe("you gain 1 life.");
  });
  it("sorcery restriction is advisory and not once per turn", () => {
    const group = fixture("{1}: You gain 1 life. Activate only as a sorcery.");
    const ability = cardAbilities(group)[0];
    expect(ability.limit).toBeNull();
    expect(
      abilityAvailability(store().field, group, ability).advisories,
    ).toContain("Activate only as a sorcery - verify timing.");
  });
  it("recalculates counter-cost availability from canonical counters", () => {
    const group = fixture(
      "Remove three +1/+1 counters from this creature: You gain 3 life.",
      "Creature",
    );
    const ability = cardAbilities(group)[0];
    expect(abilityAvailability(store().field, group, ability).available).toBe(
      false,
    );
    group.counters["+1/+1"] = 3;
    expect(abilityAvailability(store().field, group, ability).available).toBe(
      true,
    );
  });
  it("tracks one use per instance without disabling unrelated abilities", () => {
    const { id, group } = begin(
      "{T}: You gain 1 life. Activate only once each turn.\n{1}: You gain 2 life.",
    );
    store().advanceAbility(id);
    const updated = store().field.groups.find(
      (entry) => entry.id === group.id,
    )!;
    expect(
      abilityAvailability(store().field, updated, cardAbilities(updated)[0])
        .available,
    ).toBe(false);
    expect(
      abilityAvailability(store().field, updated, cardAbilities(updated)[1])
        .available,
    ).toBe(true);
  });
  it("preserves per-copy identity through normalization", () => {
    const group = fixture(
      "{0}: You gain 1 life. Activate only once each turn.",
      "Artifact",
      2,
    );
    store().beginAbility(group.id, cardAbilities(group)[0].id);
    const id = store().field.turnContext.triggerMemory.at(-1)!.id;
    choose(id, "selection.0", { accepted: true });
    store().advanceAbility(id);
    const field = normalizeField(store().field);
    const copies = field.groups.filter((entry) => entry.label === group.label);
    expect(copies).toHaveLength(2);
    expect(
      copies
        .map(
          (copy) =>
            abilityAvailability(field, copy, cardAbilities(copy)[0]).available,
        )
        .sort(),
    ).toEqual([false, true]);
  });
  it("does not reset once per game at turn boundaries or duplicate Start Turn", () => {
    const { id, group } = begin(
      "{0}: You gain 1 life. Activate only once each game.",
    );
    choose(id, "selection.0", { accepted: true });
    store().advanceAbility(id);
    store().startTurn();
    const turn = store().field.turnContext.turnId;
    store().startTurn();
    expect(store().field.turnContext.turnId).toBe(turn);
    store().endTurn();
    store().startTurn();
    expect(
      abilityAvailability(
        store().field,
        store().field.groups[0],
        cardAbilities(group)[0],
      ).available,
    ).toBe(false);
    store().correctAbilityUsage(group.id, cardAbilities(group)[0].id);
    expect(
      abilityAvailability(
        store().field,
        store().field.groups[0],
        cardAbilities(group)[0],
      ).available,
    ).toBe(true);
  });
});
