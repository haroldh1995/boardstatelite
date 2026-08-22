import { supportStatusForCard } from "../domain/cards";
import type { CardFaceIdentity, CardIdentity } from "../domain/types";
import { fetchJson, isNetworkOnline } from "../platform/network";
import { cacheCard, cacheSearch, getCachedCard, getCachedSearch } from "./db";

const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_CARDS_URL = "https://api.scryfall.com/cards";
const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const pendingSearches = new Map<string, Promise<CardIdentity[]>>();

export interface ScryfallSearchPage {
  cards: CardIdentity[];
  nextPage: string | null;
  fromCache: boolean;
}

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

  if (!isNetworkOnline()) {
    return cached ?? [];
  }

  const params = new URLSearchParams({
    q: trimmed,
    unique: "prints",
    order: "name",
    include_extras: "true",
  });

  const request = fetchJson(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
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
      const ranked = rankScryfallResults(trimmed, cards);
      await cacheSearch(trimmed, ranked);
      await Promise.all(ranked.slice(0, 12).map(cacheCard));
      return ranked;
    })
    .catch(() => cached ?? [])
    .finally(() => {
      pendingSearches.delete(key);
    });

  pendingSearches.set(key, request);
  return request;
}

export async function searchScryfallPage(
  query: string,
  options: { signal?: AbortSignal; pageUrl?: string | null } = {},
): Promise<ScryfallSearchPage> {
  const trimmed = query.trim();
  if (!trimmed) return { cards: [], nextPage: null, fromCache: false };
  if (!options.pageUrl) {
    const cached = await getCachedSearch(trimmed, CACHE_TTL_MS);
    if (cached?.length && !isNetworkOnline()) {
      return {
        cards: rankScryfallResults(trimmed, cached),
        nextPage: null,
        fromCache: true,
      };
    }
  }
  if (!isNetworkOnline()) {
    return { cards: [], nextPage: null, fromCache: true };
  }
  const url = options.pageUrl ?? searchUrl(trimmed);
  try {
    const [response, namedCard] = await Promise.all([
      fetchJson(url, {
        signal: options.signal,
        headers: { Accept: "application/json" },
      }),
      options.pageUrl || trimmed.includes(":")
        ? Promise.resolve(null)
        : fetchNamedCandidate(trimmed, options.signal),
    ]);
    if (!response.ok) return { cards: [], nextPage: null, fromCache: false };
    const payload = (await response.json()) as {
      data?: unknown[];
      has_more?: boolean;
      next_page?: string;
    };
    const cards = rankScryfallResults(
      trimmed,
      [
        ...(namedCard ? [namedCard] : []),
        ...(payload.data ?? [])
          .map((entry) => mapScryfallCard(entry as Record<string, unknown>))
          .filter((card) => card.name),
      ].filter(
        (card, index, entries) =>
          entries.findIndex((entry) => entry.cardId === card.cardId) === index,
      ),
    );
    if (!options.pageUrl) {
      await cacheSearch(trimmed, cards);
      await Promise.all(cards.slice(0, 12).map(cacheCard));
    }
    return {
      cards,
      nextPage:
        payload.has_more && typeof payload.next_page === "string"
          ? payload.next_page
          : null,
      fromCache: false,
    };
  } catch {
    return { cards: [], nextPage: null, fromCache: false };
  }
}

async function fetchNamedCandidate(
  query: string,
  signal?: AbortSignal,
): Promise<CardIdentity | null> {
  const params = new URLSearchParams({ fuzzy: query });
  try {
    const response = await fetchJson(
      `${SCRYFALL_NAMED_URL}?${params.toString()}`,
      { signal, headers: { Accept: "application/json" } },
    );
    if (!response.ok) return null;
    const card = mapScryfallCard(
      (await response.json()) as Record<string, unknown>,
    );
    return card.cardId && card.name ? card : null;
  } catch {
    return null;
  }
}

export function rankScryfallResults(
  query: string,
  cards: readonly CardIdentity[],
): CardIdentity[] {
  const normalized = normalizeSearchText(query);
  return cards
    .map((card, index) => ({ card, index, rank: rankCard(card, normalized) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.card);
}

export async function fetchScryfallCard(
  cardId: string,
): Promise<CardIdentity | null> {
  const cached = await getCachedCard(cardId);
  if (cached) return cached;
  if (!isNetworkOnline()) return null;

  try {
    const response = await fetchJson(
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
    flavorText:
      stringValue(firstFace?.flavor_text) || stringValue(raw.flavor_text),
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

function searchUrl(query: string): string {
  const params = new URLSearchParams({
    q: scryfallQuery(query),
    unique: "prints",
    order: "name",
    include_extras: "true",
  });
  return `${SCRYFALL_SEARCH_URL}?${params.toString()}`;
}

function scryfallQuery(query: string): string {
  if (query.includes(":")) return query;
  const escaped = query.replace(/["\\]/g, " ").trim();
  if (!escaped) return query;
  const quoted = `"${escaped}"`;
  return `(name:${quoted} or oracle:${quoted} or flavor:${quoted})`;
}

function rankCard(card: CardIdentity, query: string): number {
  if (!query) return 8;
  const name = normalizeSearchText(card.name);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  const oracle = normalizeSearchText(card.oracleText);
  if (oracle.includes(query)) return 3;
  if (
    card.keywords.some((keyword) =>
      normalizeSearchText(keyword).includes(query),
    )
  ) {
    return 4;
  }
  if (normalizeSearchText(card.flavorText ?? "").includes(query)) return 5;
  const metadata = normalizeSearchText(
    `${card.typeLine} ${card.setCode ?? ""} ${card.collectorNumber ?? ""}`,
  );
  return metadata.includes(query) ? 6 : 7;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
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
