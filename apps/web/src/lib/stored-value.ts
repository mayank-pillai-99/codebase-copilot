'use client';

import { useSyncExternalStore } from 'react';

/**
 * Small UI preferences (a collapsed sidebar, an open chat panel) kept in browser storage.
 * Values also live in memory, so they still work for this page when storage is refused
 * (private browsing, blocked site data).
 */
export type StorageArea = 'local' | 'session';

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function storage(area: StorageArea): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(area: StorageArea, key: string): string | null {
  const id = `${area}:${key}`;
  if (memory.has(id)) return memory.get(id) ?? null;
  try {
    return storage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(area: StorageArea, key: string, value: string | null) {
  memory.set(`${area}:${key}`, value);
  try {
    const store = storage(area);
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Kept in memory only.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** A stored value, re-rendering when it changes; null during server rendering. */
export function useStoredValue(area: StorageArea, key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(area, key),
    () => null,
  );
}
