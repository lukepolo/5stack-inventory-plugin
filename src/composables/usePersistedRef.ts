// A ref that remembers itself in localStorage.
//
// This was eleven hand-written `watch(x, v => localStorage.setItem(k, ...))`
// pairs with their reads scattered away from their writes, in three encodings
// and — for the two booleans — two different default polarities (`=== "1"`
// defaults false, `!== "0"` defaults true). Reading a call site meant finding
// both halves before you knew what a missing key did.
//
// Every key this app owns is namespaced `cs2inv.`; pass the full key.
import { ref, watch, type Ref } from "vue";

export interface Codec<T> {
  read: (raw: string) => T | undefined;
  write: (v: T) => string;
}

/**
 * localStorage throws in Safari private mode and when the quota is full, and a
 * remembered card size is never worth taking the screen down for.
 */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the preference just doesn't persist */
  }
}

export function usePersistedRef<T>(key: string, fallback: T, codec: Codec<T>): Ref<T> {
  const raw = safeGet(key);
  const stored = raw == null ? undefined : codec.read(raw);
  const state = ref(stored === undefined ? fallback : stored) as Ref<T>;
  watch(state, (v) => safeSet(key, codec.write(v)));
  return state;
}

/** Plain string, with no validation — see `usePersistedEnum` when the set is closed. */
export const usePersistedString = (key: string, fallback: string) =>
  usePersistedRef<string>(key, fallback, { read: (r) => r, write: (v) => v });

/**
 * A string from a known set. An unrecognised stored value falls back rather than
 * being trusted — a renamed option used to survive in storage and drive the UI
 * into a state no control could reach.
 */
export const usePersistedEnum = <T extends string>(key: string, allowed: readonly T[], fallback: T) =>
  usePersistedRef<T>(key, fallback, {
    read: (r) => (allowed.includes(r as T) ? (r as T) : undefined),
    write: (v) => v,
  });

/** Non-finite and (deliberately) zero fall back — every number stored here is a pixel size. */
export const usePersistedNumber = (key: string, fallback: number) =>
  usePersistedRef<number>(key, fallback, {
    read: (r) => (Number(r) || undefined),
    write: (v) => String(v),
  });

/** `"1"`/`"0"`, and the DEFAULT is explicit rather than implied by the comparison. */
export const usePersistedBool = (key: string, fallback: boolean) =>
  usePersistedRef<boolean>(key, fallback, {
    read: (r) => (r === "1" ? true : r === "0" ? false : undefined),
    write: (v) => (v ? "1" : "0"),
  });
