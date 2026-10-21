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
 * NOTHING here runs at load. The app used to warm this chunk at idle
 * (prefetchViewer3d, called from App.vue's onMounted), which put ~220kB in
 * front of every visitor who only browses the grid, and still left three for
 * the first open. Now the first ask fetches BOTH at once — see viewer3d() —
 * so the open costs one round trip rather than two, without the idle warm.
 */
import type * as Viewer3d from "./viewer3d";

let loaded: typeof Viewer3d | null = null;
let loading: Promise<typeof Viewer3d> | null = null;

/**
 * The viewer module, fetching its chunk on first ask. Repeat calls share the
 * one import.
 *
 * three (and GLTFLoader, the other large addon) are asked for in the same
 * breath. viewer3d imports them lazily itself, so on their own they would only
 * start once this chunk had arrived and run: two round trips, with the larger
 * download second. Fired here they come down alongside it, and viewer3d's own
 * import() then resolves from the module map. A failure is not reported here:
 * the viewer's own import repeats it and surfaces it.
 */
export function viewer3d(): Promise<typeof Viewer3d> {
  if (!loading) {
    void import("three").catch(() => {});
    void import("three/examples/jsm/loaders/GLTFLoader.js").catch(() => {});
    loading = import("./viewer3d").then((m) => (loaded = m));
  }
  return loading;
}

/**
 * Warm the chunk (and three with it) once the app is idle.
 *
 * Not called at load any more (see the top of this file). Kept for a caller
 * with a real signal that a 3D view is about to open, such as a pointer
 * resting on an item. Skipped under Save-Data or on a 2g estimate, where the
 * grid's own card art is the better use of the connection.
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
