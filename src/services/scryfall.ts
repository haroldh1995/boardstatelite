import { supportStatusForCard } from "../domain/cards";
import {
  buildCardSearchPlan,
  createDefaultCardSearchFilters,
  deduplicateCardSearchResults,
  hasActiveCardSearchFilters,
  hasSufficientCardSearchResults,
  rankCardSearchResults,
  type CardSearchFilters,
  type CardSearchRequest,
} from "../domain/cardSearch";
import type { CardFaceIdentity, CardIdentity } from "../domain/types";
import {
  fetchJson,
  isNetworkOnline,
  type PortableJsonResponse,
} from "../platform/network";
import { monotonicNowMs, sleepMs } from "../platform/runtime";
import { cacheCard, cacheSearch, getCachedCard, getCachedSearch } from "./db";

const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_CARDS_URL = "https://api.scryfall.com/cards";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SCRYFALL_REQUEST_SPACING_MS = 110;
const pendingSearches = new Map<string, Promise<CardIdentity[]>>();
let lastScryfallRequestAt = Number.NEGATIVE_INFINITY;
let scryfallRequestQueue = Promise.resolve();

export interface ScryfallSearchPage {
  cards: CardIdentity[];
  nextPage: string | null;
  fromCache: boolean;
}

export interface ScryfallSearchOptions {
  signal?: AbortSignal;
  pageUrl?: string | null;
  filters?: CardSearchFilters;
  ignoredConceptIds?: readonly string[];
}

export async function searchScryfall(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<CardIdentity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const key = trimmed.toLowerCase();
  const pending = pendingSearches.get(key);
  if (pending) return pending;

  const request = searchScryfallPage(trimmed, options)
    .then((page) => page.cards)
    .finally(() => {
      pendingSearches.delete(key);
    });

  pendingSearches.set(key, request);
  return request;
}

export async function searchScryfallPage(
  query: string,
  options: ScryfallSearchOptions = {},
): Promise<ScryfallSearchPage> {
  const trimmed = query.trim();
  const filters = options.filters ?? createDefaultCardSearchFilters();
  if (!trimmed && !hasActiveCardSearchFilters(filters)) {
    return { cards: [], nextPage: null, fromCache: false };
  }
  const request: CardSearchRequest = {
    query: trimmed,
    filters,
    ignoredConceptIds: options.ignoredConceptIds,
  };
  const cacheKey = searchCacheKey(request);
  const cached = !options.pageUrl
    ? await getCachedSearch(cacheKey, CACHE_TTL_MS)
    : null;
  if (!isNetworkOnline()) {
    return {
      cards: cached ? rankCardSearchResults(request, cached) : [],
      nextPage: null,
      fromCache: true,
    };
  }
  if (options.pageUrl) {
    const page = await fetchSearchPage(options.pageUrl, options.signal);
    return {
      cards: rankCardSearchResults(request, page.cards),
      nextPage: page.nextPage,
      fromCache: false,
    };
  }

  const merged: CardIdentity[] = [];
  let nextPage: string | null = null;
  for (const stage of buildCardSearchPlan(request)) {
    if (options.signal?.aborted) break;
    const page = await fetchSearchPage(searchUrl(stage.query), options.signal);
    if (!nextPage && page.cards.length > 0) nextPage = page.nextPage;
    merged.push(...page.cards);
    const candidates = rankCardSearchResults(
      request,
      deduplicateCardSearchResults(merged),
    );
    if (hasSufficientCardSearchResults(request, candidates)) break;
  }
  const cards = rankCardSearchResults(
    request,
    deduplicateCardSearchResults(merged.length > 0 ? merged : (cached ?? [])),
  );
  if (cards.length > 0) {
    await cacheSearch(cacheKey, cards);
    await Promise.all(cards.slice(0, 12).map(cacheCard));
  }
  return { cards, nextPage, fromCache: merged.length === 0 && Boolean(cached) };
}

export function rankScryfallResults(
  query: string,
  cards: readonly CardIdentity[],
  filters: CardSearchFilters = createDefaultCardSearchFilters(),
  ignoredConceptIds: readonly string[] = [],
): CardIdentity[] {
  return rankCardSearchResults({ query, filters, ignoredConceptIds }, cards);
}

export async function fetchScryfallCard(
  cardId: string,
): Promise<CardIdentity | null> {
  const cached = await getCachedCard(cardId);
  if (cached) return cached;
  if (!isNetworkOnline()) return null;

  try {
    const response = await fetchScryfallJson(
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
    setName: stringValue(raw.set_name),
    collectorNumber: stringValue(raw.collector_number),
    rarity: stringValue(raw.rarity),
    artist: stringValue(raw.artist),
    releasedAt: stringValue(raw.released_at),
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

function searchUrl(providerQuery: string): string {
  const params = new URLSearchParams({
    q: providerQuery,
    unique: "prints",
    order: "name",
    include_extras: "true",
  });
  return `${SCRYFALL_SEARCH_URL}?${params.toString()}`;
}

async function fetchSearchPage(
  url: string,
  signal?: AbortSignal,
): Promise<{ cards: CardIdentity[]; nextPage: string | null }> {
  try {
    const response = await fetchScryfallJson(url, {
      signal,
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
    });
    if (!response.ok) return { cards: [], nextPage: null };
    const payload = (await response.json()) as {
      data?: unknown[];
      has_more?: boolean;
      next_page?: string;
    };
    return {
      cards: (payload.data ?? [])
        .map((entry) => mapScryfallCard(entry as Record<string, unknown>))
        .filter((card) => card.name),
      nextPage:
        payload.has_more && typeof payload.next_page === "string"
          ? payload.next_page
          : null,
    };
  } catch {
    return { cards: [], nextPage: null };
  }
}

function fetchScryfallJson(
  url: string,
  init?: RequestInit,
): Promise<PortableJsonResponse> {
  const request = scryfallRequestQueue.then(async () => {
    const wait = Math.max(
      0,
      SCRYFALL_REQUEST_SPACING_MS - (monotonicNowMs() - lastScryfallRequestAt),
    );
    if (wait > 0) await sleepMs(wait);
    if (init?.signal?.aborted) {
      return { ok: false, status: 0, json: async () => null };
    }
    lastScryfallRequestAt = monotonicNowMs();
    return fetchJson(url, init);
  });
  scryfallRequestQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

function searchCacheKey(request: CardSearchRequest): string {
  return JSON.stringify({
    query: request.query.trim().toLowerCase(),
    filters: request.filters,
    ignoredConceptIds: [...(request.ignoredConceptIds ?? [])].sort(),
  });
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
