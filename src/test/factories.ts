import {
  createCardGroup,
  createGenericGroup,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import { createDefaultField } from "../domain/field";
import type { CardIdentity, FieldState, PermanentGroup } from "../domain/types";

export function testCard(
  input: Partial<CardIdentity> &
    Pick<CardIdentity, "name" | "typeLine" | "oracleText">,
): CardIdentity {
  return {
    cardId:
      input.cardId ?? `test-${input.name.toLowerCase().replace(/\W+/g, "-")}`,
    name: input.name,
    manaCost: input.manaCost ?? "",
    manaValue: input.manaValue ?? 0,
    typeLine: input.typeLine,
    oracleText: input.oracleText,
    imageUrl: input.imageUrl ?? "",
    imageSmall: input.imageSmall ?? "",
    imageArt: input.imageArt ?? "",
    colors: input.colors ?? [],
    colorIdentity: input.colorIdentity ?? [],
    keywords: input.keywords ?? [],
    power: input.power ?? null,
    toughness: input.toughness ?? null,
    loyalty: input.loyalty ?? null,
    defense: input.defense ?? null,
    isToken: input.isToken ?? false,
    cardFaces: input.cardFaces ?? [],
    supportStatus: input.supportStatus ?? "fully-automated",
  };
}

export function animPakal(): CardIdentity {
  return testCard({
    name: "Anim Pakal, Thousandth Moon",
    typeLine: "Legendary Creature - Human Soldier",
    oracleText:
      "Whenever you attack with one or more non-Gnome creatures, put a +1/+1 counter on Anim Pakal, then create X 1/1 colorless Gnome artifact creature tokens that are tapped and attacking, where X is the number of +1/+1 counters on Anim Pakal.",
    power: "1",
    toughness: "2",
  });
}

export function catharsCrusade(): CardIdentity {
  return testCard({
    name: "Cathars' Crusade",
    typeLine: "Enchantment",
    oracleText:
      "Whenever a creature enters the battlefield under your control, put a +1/+1 counter on each creature you control.",
  });
}

export function doublingSeason(): CardIdentity {
  return testCard({
    name: "Doubling Season",
    typeLine: "Enchantment",
    oracleText:
      "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead. If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.",
  });
}

export function rampagingBaloths(): CardIdentity {
  return testCard({
    name: "Rampaging Baloths",
    typeLine: "Creature - Beast",
    oracleText:
      "Landfall - Whenever a land enters the battlefield under your control, create a 4/4 green Beast creature token.",
    power: "6",
    toughness: "6",
  });
}

export function fieldWith(groups: PermanentGroup[]): FieldState {
  return {
    ...createDefaultField(),
    groups,
  };
}

export function tracked(card: CardIdentity, quantity = 1): PermanentGroup {
  return createCardGroup(card, quantity);
}

export function genericCreature(quantity = 1): PermanentGroup {
  return createGenericGroup({
    kind: "Creature",
    label: "Generic creature",
    quantity,
    power: 2,
    toughness: 2,
  });
}

export function withCounters(
  group: PermanentGroup,
  counters: Record<string, number>,
): PermanentGroup {
  return withStackKey(recalculateStats({ ...group, counters }));
}
