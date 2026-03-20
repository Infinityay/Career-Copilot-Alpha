import { createJSONStorage, type StateStorage } from "zustand/middleware";

export type BrowserStorageKind = "local" | "session";

const LEGACY_BRAND_SEGMENTS = ["career", "copilot"] as const;
const LEGACY_BRAND_PREFIX = LEGACY_BRAND_SEGMENTS.join("-");

export function legacyStorageKey(...parts: string[]) {
  return [LEGACY_BRAND_PREFIX, ...parts].join("-");
}

function getBrowserStorage(kind: BrowserStorageKind): Storage | undefined {
  const storage = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  return typeof storage === "undefined" ? undefined : storage;
}

function normalizeLegacyKeys(legacyKeys: string | string[]): string[] {
  return Array.isArray(legacyKeys) ? legacyKeys : [legacyKeys];
}

export function readStorageWithLegacyFallback(
  kind: BrowserStorageKind,
  currentKey: string,
  legacyKeys: string | string[]
): string | null {
  const storage = getBrowserStorage(kind);
  if (!storage) {
    return null;
  }

  const keys = [currentKey, ...normalizeLegacyKeys(legacyKeys).filter((key) => key !== currentKey)];
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value == null) {
      continue;
    }

    if (key !== currentKey) {
      storage.setItem(currentKey, value);
    }
    return value;
  }

  return null;
}

export function removeStorageKeys(kind: BrowserStorageKind, keys: string[]) {
  const storage = getBrowserStorage(kind);
  if (!storage) {
    return;
  }

  keys.forEach((key) => storage.removeItem(key));
}

export function createMigratingJSONStorage(
  kind: BrowserStorageKind,
  currentKey: string,
  legacyKeys: string | string[]
) {
  const normalizedLegacyKeys = normalizeLegacyKeys(legacyKeys).filter((key) => key !== currentKey);

  return createJSONStorage((): StateStorage => ({
    getItem: () => readStorageWithLegacyFallback(kind, currentKey, normalizedLegacyKeys),
    setItem: (_name, value) => {
      const storage = getBrowserStorage(kind);
      storage?.setItem(currentKey, value);
    },
    removeItem: () => {
      removeStorageKeys(kind, [currentKey, ...normalizedLegacyKeys]);
    },
  }));
}
