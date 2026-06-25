import { supportStatusForCard } from "../domain/cards";
import type { CardFaceIdentity, CardIdentity } from "../domain/types";
import { cacheCard, cacheSearch, getCachedCard, getCachedSearch } from "./db";

const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_CARDS_URL = "https://api.scryfall.com/cards";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const pendingSearches = new Map<string, Promise<CardIdentity[]>>();

export async function searchScryfall(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<CardIdentity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cached = await getCachedSearch(trimmed, CACHE_TTL_MS);
  if (cached?.length) return cached;

  const key = trimmed.toLowerCase();
  const pending = pendingSearches.get(key);
  if (pending) return pending;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return cached ?? [];
  }

  const params = new URLSearchParams({
    q: trimmed.includes(":") ? trimmed : trimmed,
    unique: "prints",
    order: "name",
    include_extras: "true",
  });

  const request = fetch(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
    signal: options.signal,
    headers: {
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      if (!response.ok) return cached ?? [];
      const payload = (await response.json()) as { data?: unknown[] };
      const cards = (payload.data ?? [])
        .map((entry) => mapScryfallCard(entry as Record<string, unknown>))
        .filter((card) => card.name);
      await cacheSearch(trimmed, cards);
      await Promise.all(cards.slice(0, 12).map(cacheCard));
      return cards;
    })
    .catch(() => cached ?? [])
    .finally(() => {
      pendingSearches.delete(key);
    });

  pendingSearches.set(key, request);
  return request;
}

export async function fetchScryfallCard(
  cardId: string,
): Promise<CardIdentity | null> {
  const cached = await getCachedCard(cardId);
  if (cached) return cached;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  try {
    const response = await fetch(
      `${SCRYFALL_CARDS_URL}/${encodeURIComponent(cardId)}`,
    );
    if (!response.ok) return null;
    const card = mapScryfallCard(
      (await response.json()) as Record<string, unknown>,
    );
    await cacheCard(card);
    return card;
  } catch {
    return null;
  }
}

export function mapScryfallCard(raw: Record<string, unknown>): CardIdentity {
  const faces = Array.isArray(raw.card_faces)
    ? (raw.card_faces as Record<string, unknown>[])
    : [];
  const firstFace = faces[0];
  const faceImageUris = imageUris(firstFace?.image_uris);
  const cardImageUris = imageUris(raw.image_uris);
  const typeLine =
    stringValue(firstFace?.type_line) || stringValue(raw.type_line);
  const oracleText =
    stringValue(firstFace?.oracle_text) || stringValue(raw.oracle_text);
  const name = stringValue(firstFace?.name) || stringValue(raw.name);
  const colors = stringArray(firstFace?.colors).length
    ? stringArray(firstFace?.colors)
    : stringArray(raw.colors);
  const identity: CardIdentity = {
    cardId: stringValue(raw.id),
    oracleId: stringValue(raw.oracle_id),
    name,
    manaCost: stringValue(firstFace?.mana_cost) || stringValue(raw.mana_cost),
    manaValue: numberValue(raw.cmc),
    typeLine,
    oracleText,
    imageArt: cardImageUris.art_crop || faceImageUris.art_crop,
    imageUrl: cardImageUris.normal || faceImageUris.normal,
    imageSmall: cardImageUris.small || faceImageUris.small,
    scryfallUri: stringValue(raw.scryfall_uri),
    setCode: stringValue(raw.set),
    collectorNumber: stringValue(raw.collector_number),
    colors,
    colorIdentity: stringArray(raw.color_identity),
    keywords: stringArray(raw.keywords),
    power: statValue(firstFace?.power ?? raw.power),
    toughness: statValue(firstFace?.toughness ?? raw.toughness),
    loyalty: statValue(firstFace?.loyalty ?? raw.loyalty),
    defense: statValue(firstFace?.defense ?? raw.defense),
    isToken: typeLine.includes("Token") || stringValue(raw.layout) === "token",
    cardFaces: faces.map(mapFace),
    supportStatus: supportStatusForCard(name, oracleText),
  };
  return identity;
}

function mapFace(face: Record<string, unknown>): CardFaceIdentity {
  const uris = imageUris(face.image_uris);
  return {
    name: stringValue(face.name),
    typeLine: stringValue(face.type_line),
    oracleText: stringValue(face.oracle_text),
    manaCost: stringValue(face.mana_cost),
    imageUrl: uris.normal,
    imageSmall: uris.small,
    power: statValue(face.power),
    toughness: statValue(face.toughness),
    loyalty: statValue(face.loyalty),
    defense: statValue(face.defense),
  };
}

function imageUris(value: unknown): {
  normal: string;
  small: string;
  art_crop: string;
} {
  if (!value || typeof value !== "object") {
    return { normal: "", small: "", art_crop: "" };
  }
  const map = value as Record<string, unknown>;
  return {
    normal: stringValue(map.normal),
    small: stringValue(map.small),
    art_crop: stringValue(map.art_crop),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numberValue(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function statValue(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}
