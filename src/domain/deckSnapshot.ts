import type { CardIdentity } from "./types";
import { normalizeCardSearchText } from "./cardSearch";
import type { EchoDeckSnapshotCard } from "../echo/entityResolutionTypes";

export interface DeckCardSnapshot extends EchoDeckSnapshotCard {
  quantity: number;
  isCommander: boolean;
  identity: CardIdentity;
}
export interface SessionDeckSnapshot {
  version: 1;
  deckId: string;
  name: string;
  source: "deck-nexus";
  revision: string | null;
  capturedAt: string;
  cards: DeckCardSnapshot[];
}

/** Validates the normalized contract, not a Nexus database/transport representation. */
export function normalizeDeckSnapshot(
  value: unknown,
): SessionDeckSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Partial<SessionDeckSnapshot>;
  if (
    !deck.deckId ||
    typeof deck.deckId !== "string" ||
    typeof deck.name !== "string" ||
    !Array.isArray(deck.cards)
  )
    return null;
  const cards: DeckCardSnapshot[] = [];
  for (const raw of deck.cards) {
    if (!raw || typeof raw !== "object") continue;
    const card = (raw.identity ?? raw) as Partial<CardIdentity>;
    if (typeof card.name !== "string" || !card.name.trim()) continue;
    const strings = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const stat = (value: unknown) =>
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : null;
    const identity: CardIdentity = {
      cardId:
        text(card.cardId) || `deck-card:${normalizeCardSearchText(card.name)}`,
      oracleId: text(card.oracleId) || undefined,
      name: card.name.trim(),
      manaCost: text(card.manaCost),
      manaValue: Number.isFinite(card.manaValue) ? Number(card.manaValue) : 0,
      typeLine: text(card.typeLine),
      oracleText: text(card.oracleText),
      imageUrl: text(card.imageUrl),
      imageSmall: text(card.imageSmall),
      imageArt: text(card.imageArt),
      colors: strings(card.colors),
      colorIdentity: strings(card.colorIdentity),
      keywords: strings(card.keywords),
      power: stat(card.power),
      toughness: stat(card.toughness),
      loyalty: stat(card.loyalty),
      defense: stat(card.defense),
      isToken: card.isToken === true,
      cardFaces: Array.isArray(card.cardFaces)
        ? card.cardFaces
            .filter((face) => face && typeof face.name === "string")
            .map((face) => ({
              name: face.name,
              typeLine: text(face.typeLine),
              oracleText: text(face.oracleText),
              manaCost: text(face.manaCost),
              imageUrl: text(face.imageUrl),
              imageSmall: text(face.imageSmall),
              power: stat(face.power),
              toughness: stat(face.toughness),
              loyalty: stat(face.loyalty),
              defense: stat(face.defense),
            }))
        : [],
      supportStatus: "quantity-tracking-only",
      setCode: text(card.setCode),
      rarity: text(card.rarity),
      artist: text(card.artist),
    };
    cards.push({
      ...identity,
      identity,
      quantity: Math.max(
        1,
        Math.min(999, Math.trunc(Number(raw.quantity) || 1)),
      ),
      isCommander: raw.isCommander === true,
    });
  }
  return {
    version: 1,
    source: "deck-nexus",
    deckId: deck.deckId,
    name: deck.name,
    revision: typeof deck.revision === "string" ? deck.revision : null,
    capturedAt:
      typeof deck.capturedAt === "string"
        ? deck.capturedAt
        : new Date().toISOString(),
    cards,
  };
}

export function sameCard(a: CardIdentity, b: CardIdentity): boolean {
  return (
    a.cardId === b.cardId ||
    Boolean(a.oracleId && a.oracleId === b.oracleId) ||
    normalizeCardSearchText(a.name) === normalizeCardSearchText(b.name)
  );
}

export function deckContains(
  deck: SessionDeckSnapshot | null | undefined,
  card: CardIdentity,
): boolean {
  return Boolean(deck?.cards.some((entry) => sameCard(entry.identity, card)));
}

export function corroborateDeckIdentity(
  score: number,
  card: CardIdentity,
  deck: SessionDeckSnapshot | null | undefined,
): number {
  // Presence is corroboration, never proof; absence cannot penalize physical evidence.
  return deckContains(deck, card)
    ? Math.max(score, Math.min(0.98, score + (1 - score) * 0.35))
    : score;
}

export function preferredCardIdentity(
  currentCanonical: CardIdentity | null,
  stored: DeckCardSnapshot,
): CardIdentity {
  return currentCanonical ?? stored.identity;
}
