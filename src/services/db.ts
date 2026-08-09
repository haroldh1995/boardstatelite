import type { CardIdentity, FieldState } from "../domain/types";
import { getFieldPersistencePort } from "../platform/persistence";
import { nowMs } from "../platform/runtime";
import { getKeyValueStorage } from "../platform/storage";

export async function saveField(field: FieldState): Promise<void> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  try {
    await persistence.saveField({
      id: field.id,
      updatedAt: field.updatedAt,
      field,
    });
    storage.setItem("baord-state-lite:last-field-id", field.id);
  } catch {
    storage.setItem(
      "baord-state-lite:last-field-fallback",
      JSON.stringify(field),
    );
  }
}

export async function loadLastField(): Promise<FieldState | null> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  try {
    const lastId = storage.getItem("baord-state-lite:last-field-id");
    if (lastId) {
      const record = await persistence.getField(lastId);
      if (record?.field) return record.field;
    }
    const latest = await persistence.getLatestField();
    if (latest?.field) return latest.field;
  } catch {
    const fallback = storage.getItem("baord-state-lite:last-field-fallback");
    if (fallback) {
      return JSON.parse(fallback) as FieldState;
    }
  }
  return null;
}

export async function listFields(): Promise<FieldState[]> {
  try {
    const records = await getFieldPersistencePort().listFields();
    return records.map((record) => record.field);
  } catch {
    return [];
  }
}

export async function deleteField(id: string): Promise<void> {
  await getFieldPersistencePort().deleteField(id);
}

export async function cacheSearch(
  query: string,
  cards: CardIdentity[],
): Promise<void> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  const cachedAt = nowMs();
  try {
    await persistence.cacheSearch({
      query: query.toLowerCase(),
      cachedAt,
      cards,
    });
  } catch {
    storage.setItem(
      `baord-state-lite:search:${query.toLowerCase()}`,
      JSON.stringify({ cachedAt, cards }),
    );
  }
}

export async function getCachedSearch(
  query: string,
  maxAgeMs: number,
): Promise<CardIdentity[] | null> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  const key = query.toLowerCase();
  try {
    const cached = await persistence.getCachedSearch(key);
    if (cached && nowMs() - cached.cachedAt <= maxAgeMs) return cached.cards;
  } catch {
    const fallback = storage.getItem(`baord-state-lite:search:${key}`);
    if (fallback) {
      const parsed = JSON.parse(fallback) as {
        cachedAt: number;
        cards: CardIdentity[];
      };
      if (nowMs() - parsed.cachedAt <= maxAgeMs) return parsed.cards;
    }
  }
  return null;
}

export async function cacheCard(card: CardIdentity): Promise<void> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  const cachedAt = nowMs();
  try {
    await persistence.cacheCard({ cardId: card.cardId, cachedAt, card });
  } catch {
    storage.setItem(
      `baord-state-lite:card:${card.cardId}`,
      JSON.stringify({ cachedAt, card }),
    );
  }
}

export async function getCachedCard(
  cardId: string,
): Promise<CardIdentity | null> {
  const storage = getKeyValueStorage();
  const persistence = getFieldPersistencePort();
  try {
    const cached = await persistence.getCachedCard(cardId);
    if (cached?.card) return cached.card;
  } catch {
    const fallback = storage.getItem(`baord-state-lite:card:${cardId}`);
    if (fallback) {
      return (JSON.parse(fallback) as { card: CardIdentity }).card;
    }
  }
  return null;
}

export async function clearCaches(): Promise<void> {
  await getFieldPersistencePort().clearCaches();
}
