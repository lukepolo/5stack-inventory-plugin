import { createHash, timingSafeEqual } from "node:crypto";

// Hashed first so timingSafeEqual gets equal lengths and the key's length doesn't leak either.
export function sameServerKey(given: unknown, key: string | null): boolean {
  if (!key || typeof given !== "string") {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(key));
}
