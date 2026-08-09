export interface KeyValueStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryStorage = new Map<string, string>();

export const memoryKeyValueStorage: KeyValueStoragePort = {
  getItem(key) {
    return memoryStorage.get(key) ?? null;
  },
  setItem(key, value) {
    memoryStorage.set(key, value);
  },
  removeItem(key) {
    memoryStorage.delete(key);
  },
};

let activeKeyValueStorage: KeyValueStoragePort = createDefaultStorage();

export function configureKeyValueStorage(storage: KeyValueStoragePort): void {
  activeKeyValueStorage = storage;
}

export function resetKeyValueStorage(): void {
  activeKeyValueStorage = createDefaultStorage();
}

export function getKeyValueStorage(): KeyValueStoragePort {
  return activeKeyValueStorage;
}

function createDefaultStorage(): KeyValueStoragePort {
  try {
    const browserStorage = globalThis.localStorage;
    if (!browserStorage) return memoryKeyValueStorage;
    return {
      getItem: (key) => browserStorage.getItem(key),
      setItem: (key, value) => browserStorage.setItem(key, value),
      removeItem: (key) => browserStorage.removeItem(key),
    };
  } catch {
    return memoryKeyValueStorage;
  }
}
