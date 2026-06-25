import Dexie, { type Table } from "dexie";
import type { CardIdentity, FieldState } from "../domain/types";

interface CachedSearch {
  query: string;
  cachedAt: number;
  cards: CardIdentity[];
}

interface CachedCard {
  cardId: string;
  cachedAt: number;
  card: CardIdentity;
}

interface SavedFieldRecord {
  id: string;
  updatedAt: string;
  field: FieldState;
}

class BaordStateLiteDb extends Dexie {
  fields!: Table<SavedFieldRecord, string>;
  searchCache!: Table<CachedSearch, string>;
  cardCache!: Table<CachedCard, string>;

  constructor() {
    super("baord-state-lite");
    this.version(1).stores({
      fields: "id, updatedAt",
      searchCache: "query, cachedAt",
      cardCache: "cardId, cachedAt",
    });
  }
}

export const db = new BaordStateLiteDb();

export async function saveField(field: FieldState): Promise<void> {
  try {
    await db.fields.put({ id: field.id, updatedAt: field.updatedAt, field });
    localStorage.setItem("baord-state-lite:last-field-id", field.id);
  } catch {
    localStorage.setItem(
      "baord-state-lite:last-field-fallback",
      JSON.stringify(field),
    );
  }
}

export async function loadLastField(): Promise<FieldState | null> {
  try {
    const lastId = localStorage.getItem("baord-state-lite:last-field-id");
    if (lastId) {
      const record = await db.fields.get(lastId);
      if (record?.field) return record.field;
    }
    const latest = await db.fields.orderBy("updatedAt").last();
    if (latest?.field) return latest.field;
  } catch {
    const fallback = localStorage.getItem(
      "baord-state-lite:last-field-fallback",
    );
    if (fallback) {
      return JSON.parse(fallback) as FieldState;
    }
  }
  return null;
}

export async function listFields(): Promise<FieldState[]> {
  try {
    const records = await db.fields.orderBy("updatedAt").reverse().toArray();
    return records.map((record) => record.field);
  } catch {
    return [];
  }
}

export async function deleteField(id: string): Promise<void> {
  await db.fields.delete(id);
}

export async function cacheSearch(
  query: string,
  cards: CardIdentity[],
): Promise<void> {
  try {
    await db.searchCache.put({
      query: query.toLowerCase(),
      cachedAt: Date.now(),
      cards,
    });
  } catch {
    localStorage.setItem(
      `baord-state-lite:search:${query.toLowerCase()}`,
      JSON.stringify({ cachedAt: Date.now(), cards }),
    );
  }
}

export async function getCachedSearch(
  query: string,
  maxAgeMs: number,
): Promise<CardIdentity[] | null> {
  const key = query.toLowerCase();
  try {
    const cached = await db.searchCache.get(key);
    if (cached && Date.now() - cached.cachedAt <= maxAgeMs) return cached.cards;
  } catch {
    const fallback = localStorage.getItem(`baord-state-lite:search:${key}`);
    if (fallback) {
      const parsed = JSON.parse(fallback) as {
        cachedAt: number;
        cards: CardIdentity[];
      };
      if (Date.now() - parsed.cachedAt <= maxAgeMs) return parsed.cards;
    }
  }
  return null;
}

export async function cacheCard(card: CardIdentity): Promise<void> {
  try {
    await db.cardCache.put({ cardId: card.cardId, cachedAt: Date.now(), card });
  } catch {
    localStorage.setItem(
      `baord-state-lite:card:${card.cardId}`,
      JSON.stringify({ cachedAt: Date.now(), card }),
    );
  }
}

export async function getCachedCard(
  cardId: string,
): Promise<CardIdentity | null> {
  try {
    const cached = await db.cardCache.get(cardId);
    if (cached?.card) return cached.card;
  } catch {
    const fallback = localStorage.getItem(`baord-state-lite:card:${cardId}`);
    if (fallback) {
      return (JSON.parse(fallback) as { card: CardIdentity }).card;
    }
  }
  return null;
}

export async function clearCaches(): Promise<void> {
  await db.searchCache.clear();
  await db.cardCache.clear();
}
