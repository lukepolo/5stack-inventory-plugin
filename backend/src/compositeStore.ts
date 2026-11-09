/**
 * The backend half of the composite store's NAMING.
 *
 * src/compositeStore.ts (the client) names a stored composite after the tuple it
 * is a pure function of: (model, body variant, paint material, wear, seed) and
 * the device's resolution cap. The upload route re-derives that name from the
 * identity it verified (compositeStem below).
 *
 * Deliberately free of Postgres and file I/O, the same split share.ts
 * makes: main.ts owns both. That is also what lets
 * tools/standalone/mock-server.mjs import this file and check uploads with the
 * backend's own code.
 */
import path from "node:path";

// ---- Naming --------------------------------------------------------------------
// MUST agree with compositeKey() in src/compositeStore.ts.
//
// Unlike renderKeyForRow, a disagreement here is harmless: the backend derives
// the name from the identity it verified, so a drift means clients simply never
// hit the cache. It can never serve one skin's pixels under another's name.
// The POST response echoes the derived name so a mismatch shows up in the
// client console instead of silently costing every hit.
export const safeSeg = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

/** Wear exactly as compositeKey writes it: clamped to [0, 1], four places. A
 *  missing wear is 0, because that is what the viewer composites for it
 *  (`opts.wear ?? 0`). */
export const compositeWear = (wear: unknown): string =>
  Math.min(Math.max(Number(wear ?? 0) || 0, 0), 1).toFixed(4);
/** Seed exactly as compositeKey writes it; missing reads as 0, as in the viewer. */
export const compositeSeed = (seed: unknown): number => Math.max(0, Math.trunc(Number(seed ?? 0) || 0));

export interface CompositeIdentityKey {
  model: string;
  legacy: boolean;
  material: string;
  wear: number;
  seed: number;
}

/** Everything in the name but the cap, which is the CLIENT's to pick (it
 *  depends on the finish's style and the device; see compositeSizeCap in
 *  src/paintComposite.ts). */
export function compositeStemBase(id: CompositeIdentityKey): string {
  return [
    safeSeg(id.model),
    id.legacy ? "legacy" : "hd",
    // Both extensions the paint chain uses; leaving ".vcompmat.json" in the
    // middle of an image filename is just confusing to look at on the mount.
    safeSeg(id.material.replace(/\.(vcompmat|vmat)\.json$/i, "")),
    compositeWear(id.wear),
    compositeSeed(id.seed),
  ].join("__");
}

export function compositeStem(id: CompositeIdentityKey & { cap: number }): string {
  return `${compositeStemBase(id)}__c${id.cap}`;
}

/**
 * A generation is ONE directory name under the composites root, never a path.
 *
 * The first character must be alphanumeric, which is the whole point: the old
 * `^[\w.-]{1,64}$` accepted `..` (dots are in that class), and every route
 * joins the generation straight onto the root. That made `..` mean the shared
 * asset mount itself — readable through the GET route, writable through the
 * upload, and, worst of the three, pruneComposites would then delete every
 * sibling generation and LRU-delete files directly out of /cs2-models, i.e.
 * extracted game textures.
 */
const GEN_RE = /^[A-Za-z0-9][\w.-]{0,63}$/;

/**
 * The directory a generation is stored in, or null if the name is malformed or
 * would land outside the root (checked again after resolution, on purpose).
 *
 * The client derives the generation from public inputs, so the server adds a
 * random salt it never hands out: nothing uploaded before this instance first
 * stored that generation, or by an older build, is ever read from it.
 */
export function compositeDirIn(root: string, gen: string, salt: string): string | null {
  if (!GEN_RE.test(gen) || !/^[0-9a-f]{32}$/.test(salt)) {
    return null;
  }
  const base = path.resolve(root);
  const dir = path.resolve(base, `${gen}.s${salt}`);
  return dir.startsWith(base + path.sep) ? dir : null;
}

