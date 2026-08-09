import Dexie, { type Table } from "dexie";
import type { CardIdentity, FieldState } from "../domain/types";

export interface CachedSearchRecord {
  query: string;
  cachedAt: number;
  cards: CardIdentity[];
}

export interface CachedCardRecord {
  cardId: string;
  cachedAt: number;
  card: CardIdentity;
}

export interface SavedFieldRecord {
  id: string;
  updatedAt: string;
  field: FieldState;
}

export interface FieldPersistencePort {
  saveField(record: SavedFieldRecord): Promise<void>;
  getField(id: string): Promise<SavedFieldRecord | null>;
  getLatestField(): Promise<SavedFieldRecord | null>;
  listFields(): Promise<SavedFieldRecord[]>;
  deleteField(id: string): Promise<void>;
  cacheSearch(record: CachedSearchRecord): Promise<void>;
  getCachedSearch(query: string): Promise<CachedSearchRecord | null>;
  cacheCard(record: CachedCardRecord): Promise<void>;
  getCachedCard(cardId: string): Promise<CachedCardRecord | null>;
  clearCaches(): Promise<void>;
}

class BaordStateLiteDb extends Dexie {
  fields!: Table<SavedFieldRecord, string>;
  searchCache!: Table<CachedSearchRecord, string>;
  cardCache!: Table<CachedCardRecord, string>;

  constructor() {
    super("baord-state-lite");
    this.version(1).stores({
      fields: "id, updatedAt",
      searchCache: "query, cachedAt",
      cardCache: "cardId, cachedAt",
    });
  }
}

const db = new BaordStateLiteDb();

let activeFieldPersistence: FieldPersistencePort =
  createDexieFieldPersistencePort();

export function configureFieldPersistencePort(
  port: FieldPersistencePort,
): void {
  activeFieldPersistence = port;
}

export function resetFieldPersistencePort(): void {
  activeFieldPersistence = createDexieFieldPersistencePort();
}

export function getFieldPersistencePort(): FieldPersistencePort {
  return activeFieldPersistence;
}

function createDexieFieldPersistencePort(): FieldPersistencePort {
  return {
    async saveField(record) {
      await db.fields.put(record);
    },
    async getField(id) {
      return (await db.fields.get(id)) ?? null;
    },
    async getLatestField() {
      return (await db.fields.orderBy("updatedAt").last()) ?? null;
    },
    async listFields() {
      return db.fields.orderBy("updatedAt").reverse().toArray();
    },
    async deleteField(id) {
      await db.fields.delete(id);
    },
    async cacheSearch(record) {
      await db.searchCache.put(record);
    },
    async getCachedSearch(query) {
      return (await db.searchCache.get(query)) ?? null;
    },
    async cacheCard(record) {
      await db.cardCache.put(record);
    },
    async getCachedCard(cardId) {
      return (await db.cardCache.get(cardId)) ?? null;
    },
    async clearCaches() {
      await db.searchCache.clear();
      await db.cardCache.clear();
    },
  };
}
