import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultField } from "../domain/field";
import {
  configureFieldPersistencePort,
  getFieldPersistencePort,
} from "../platform/persistence";
import {
  configureKeyValueStorage,
  getKeyValueStorage,
} from "../platform/storage";
import { loadLastField, saveField } from "./db";

const originalPersistence = getFieldPersistencePort();
const originalStorage = getKeyValueStorage();
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  configureKeyValueStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  });
});
afterEach(() => {
  configureFieldPersistencePort(originalPersistence);
  configureKeyValueStorage(originalStorage);
});

it("restores the newest session while an older durable write is pending", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved: string[] = [];
  configureFieldPersistencePort({
    ...originalPersistence,
    saveField: async (record) => {
      if (saved.length === 0) await blocked;
      saved.push(record.id);
    },
  });
  const previous = createDefaultField();
  const fresh = createDefaultField();
  const first = saveField(previous);
  const second = saveField(fresh);
  expect((await loadLastField())?.id).toBe(fresh.id);
  release();
  await Promise.all([first, second]);
  expect(saved).toEqual([previous.id, fresh.id]);
  expect((await loadLastField())?.groups).toEqual([]);
});

it("saves durably when the synchronous fallback is full", async () => {
  const save = vi.fn(async () => {});
  configureFieldPersistencePort({ ...originalPersistence, saveField: save });
  configureKeyValueStorage({
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  });
  await saveField(createDefaultField());
  expect(save).toHaveBeenCalledTimes(1);
});

it("cannot restore an obsolete fallback after a quota failure", async () => {
  const field = createDefaultField();
  values.set("baord-state-lite:last-field-fallback", JSON.stringify(field));
  const newer = { ...field, player: { ...field.player, life: 27 } };
  configureKeyValueStorage({
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: () => {
      throw new Error("Full");
    },
  });
  configureFieldPersistencePort({
    ...originalPersistence,
    saveField: async () => {},
    getLatestField: async () => ({
      id: newer.id,
      updatedAt: newer.updatedAt,
      field: newer,
    }),
  });
  await saveField(newer);
  expect((await loadLastField())?.player.life).toBe(27);
});

it("can recover from durable storage when key-value reads are prohibited", async () => {
  const field = createDefaultField();
  configureKeyValueStorage({
    getItem: () => {
      throw new Error("Disabled");
    },
    setItem: () => {},
    removeItem: () => {},
  });
  configureFieldPersistencePort({
    ...originalPersistence,
    getLatestField: async () => ({
      id: field.id,
      updatedAt: field.updatedAt,
      field,
    }),
  });
  expect((await loadLastField())?.id).toBe(field.id);
});

it("does not crash first run when both fallback and durable storage are unavailable", async () => {
  values.set("baord-state-lite:last-field-fallback", "{damaged");
  configureFieldPersistencePort({
    ...originalPersistence,
    getLatestField: async () => {
      throw new Error("Unavailable");
    },
  });
  await expect(loadLastField()).resolves.toBeNull();
});
