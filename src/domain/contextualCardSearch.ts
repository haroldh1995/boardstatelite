import {
  createDefaultCardSearchFilters,
  normalizeCardSearchText,
  rankCardSearchResults,
  scoreCardSearchResult,
  type CardSearchRequest,
} from "./cardSearch";
import {
  deckContains,
  sameCard,
  type SessionDeckSnapshot,
} from "./deckSnapshot";
import type { CardIdentity } from "./types";
import { parseCharacteristics } from "./cards";

export type CardSearchContext =
  | "add-permanent"
  | "effect-source"
  | "identify"
  | "commander"
  | "external-state"
  | "general";
export interface ContextualCardSearchRequest extends CardSearchRequest {
  scope?: "my-deck" | "all-cards";
  context?: CardSearchContext;
  deck?: SessionDeckSnapshot | null;
  recentCards?: readonly CardIdentity[];
}

export function matchesSearchFilters(
  card: CardIdentity,
  request: CardSearchRequest,
): boolean {
  const f = request.filters ?? createDefaultCardSearchFilters();
  const c = parseCharacteristics(card.typeLine, card);
  const includes = (text: string, needle: string) =>
    !needle.trim() ||
    normalizeCardSearchText(text).includes(normalizeCardSearchText(needle));
  const numeric = (actual: string | null, expression: string) => {
    if (!expression) return true;
    const match = expression.match(/^(<=|>=|<|>|=)?\s*(-?\d+)$/);
    if (!match) return actual === expression;
    const a = Number(actual),
      b = Number(match[2]);
    if (actual === null || !Number.isFinite(a)) return false;
    return match[1] === "<="
      ? a <= b
      : match[1] === ">="
        ? a >= b
        : match[1] === "<"
          ? a < b
          : match[1] === ">"
            ? a > b
            : a === b;
  };
  return (
    includes(card.name, f.cardName) &&
    includes(card.oracleText, f.oracleText) &&
    f.cardTypes.every((type) => c.cardTypes.includes(type)) &&
    f.supertypes.every((type) => c.supertypes.includes(type)) &&
    includes(c.subtypes.join(" "), f.subtype) &&
    f.colors.every((color) =>
      color === "C" ? card.colors.length === 0 : card.colors.includes(color),
    ) &&
    f.colorIdentity.every((color) =>
      color === "C"
        ? card.colorIdentity.length === 0
        : card.colorIdentity.includes(color),
    ) &&
    (!f.commanderColorIdentity.length ||
      card.colorIdentity.every((color) =>
        f.commanderColorIdentity.includes(color),
      )) &&
    (f.manaValue === null ||
      (f.manaValueOperator === "at-most"
        ? card.manaValue <= f.manaValue
        : f.manaValueOperator === "at-least"
          ? card.manaValue >= f.manaValue
          : card.manaValue === f.manaValue)) &&
    includes(card.manaCost, f.manaCost) &&
    numeric(card.power, f.power) &&
    numeric(card.toughness, f.toughness) &&
    f.keywords.every((keyword) =>
      card.keywords.some(
        (entry) =>
          normalizeCardSearchText(entry) === normalizeCardSearchText(keyword),
      ),
    ) &&
    includes(card.rarity ?? "", f.rarity) &&
    includes(card.setCode ?? "", f.set) &&
    includes(card.artist ?? "", f.artist)
  );
}

export function rankContextualCards(
  request: ContextualCardSearchRequest,
  cards: readonly CardIdentity[],
): CardIdentity[] {
  const base = rankCardSearchResults(
    request,
    cards.filter((card) => matchesSearchFilters(card, request)),
  );
  const query = normalizeCardSearchText(request.query);
  const score = (card: CardIdentity) => {
    const relevance = scoreCardSearchResult(request, card);
    const exact = query && normalizeCardSearchText(card.name) === query;
    // Exact identity is an ordering tier, not a boost that accumulated context can beat.
    const deckBoost =
      relevance > 100 && deckContains(request.deck, card) ? 700 : 0;
    const recentBoost =
      relevance > 100 &&
      request.recentCards?.some((entry) => sameCard(entry, card))
        ? 80
        : 0;
    const c = parseCharacteristics(card.typeLine, card);
    const permanent = c.cardTypes.some((type) =>
      [
        "Creature",
        "Land",
        "Artifact",
        "Enchantment",
        "Planeswalker",
        "Battle",
      ].includes(type),
    );
    const contextBoost =
      request.context === "commander"
        ? c.isLegendary && c.isCreature
          ? 180
          : 0
        : ["add-permanent", "effect-source", "identify"].includes(
              request.context ?? "",
            ) && permanent
          ? 120
          : 0;
    return (
      (exact ? 1_000_000 : 0) +
      relevance +
      deckBoost +
      recentBoost +
      contextBoost
    );
  };
  return base.sort((a, b) => score(b) - score(a));
}

export function localSearchCandidates(
  request: ContextualCardSearchRequest,
): CardIdentity[] {
  const cards = [
    ...(request.deck?.cards.map((entry) => entry.identity) ?? []),
    ...(request.recentCards ?? []),
  ];
  return rankContextualCards(
    request,
    cards.filter(
      (card) =>
        !request.query.trim() ||
        scoreCardSearchResult({ ...request, filters: undefined }, card) > 100,
    ),
  );
}
