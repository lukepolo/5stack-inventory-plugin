/**
 * The lazy edge of the 3D viewer.
 *
 * viewer3d.ts and the chain behind it — both glove compositors, charm physics
 * and liquid, the sticker shader, the StatTrak/nametag/charm anchor tables —
 * are ~400kB of the bundle, and none of it is reachable until a stage actually
 * mounts a model. Importing it straight from App.vue put all of that in front
 * of first paint for every user, including the ones who only ever look at the
 * grid. Everything routed through here is already awaited at each call site, so
 * the module can arrive late without any of them changing shape.
 *
 * NOT here, deliberately:
 *  - `hasModel` / `hasModelSync` — asked while browsing, so they stay eager in
 *    ./modelAvailability. See the note there.
 *  - `INCOMPLETE` — a comparison, not a call. ./viewerSentinel.
 * Both exist so the common paths never touch this file at all.
 *
 * three is NOT prefetched with the chunk: viewer3d imports it lazily itself and
 * always has, and first mount is still where that cost lands.
 */
import type * as Viewer3d from "./viewer3d";

let loaded: typeof Viewer3d | null = null;
let loading: Promise<typeof Viewer3d> | null = null;

/** The viewer module, fetching its chunk on first ask. Repeat calls share the
 *  one import. */
export function viewer3d(): Promise<typeof Viewer3d> {
  if (!loading) loading = import("./viewer3d").then((m) => (loaded = m));
  return loading;
}

/**
 * Warm the chunk once the app is idle.
 *
 * Without this the split just moves the wait: viewer3d is what imports three,
 * so a cold first open would fetch this chunk and only THEN start on three's
 * 190kB — two round trips where there used to be one. Idle time after first
 * paint is free, and by the time anyone clicks a model the import is resolved.
 * Skipped under Save-Data or on a 2g estimate, where the grid's own card art is
 * the better use of the connection.
 */
export function prefetchViewer3d(): void {
  if (loading || typeof window === "undefined") return;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || (conn?.effectiveType ?? "").includes("2g")) return;
  // A failure here is not an error surface: the real import is still ahead of
  // whoever actually needs the viewer, and it will report its own problem.
  const warm = () => void viewer3d().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 1500);
}

export const mountViewer: typeof Viewer3d.mountViewer = (...args) => viewer3d().then((m) => m.mountViewer(...args));

export const snapshotModel: typeof Viewer3d.snapshotModel = (...args) => viewer3d().then((m) => m.snapshotModel(...args));

/** Forces the load, which is free in practice: both callers bake immediately
 *  after, and a bake needs the module regardless. */
export const viewersIdle: typeof Viewer3d.viewersIdle = () => viewer3d().then((m) => m.viewersIdle());

/** Sync — it feeds the dev HUD's per-frame readout. No viewer module means no
 *  viewers, no builds and no settle window, which is what these numbers say. */
const NO_VIEWERS: ReturnType<typeof Viewer3d.viewerStats> = {
  live: 0,
  building: 0,
  queued: 0,
  lane: null,
  settling: false,
};
export const viewerStats: typeof Viewer3d.viewerStats = () => (loaded ? loaded.viewerStats() : NO_VIEWERS);
