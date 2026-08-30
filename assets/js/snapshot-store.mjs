import { prepareSnapshot } from "./data-freshness.mjs";
import { parseSignalPayload, validateSignalPayload } from "./signal-schema.mjs";

const STORAGE_KEY = "starpulse.lastKnownGoodSignalPayload";

export function saveLastKnownGood(data, storage = globalThis.localStorage, now = Date.now()) {
  validateSignalPayload(data);
  prepareSnapshot(structuredClone(data), { fallback: true, now });
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadLastKnownGood(storage = globalThis.localStorage, now = Date.now()) {
  const stored = storage?.getItem(STORAGE_KEY);
  if (!stored) return undefined;
  try {
    return prepareSnapshot(parseSignalPayload(stored), { fallback: true, now });
  } catch (error) {
    storage.removeItem(STORAGE_KEY);
    throw error;
  }
}
