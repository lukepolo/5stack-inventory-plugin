/**
 * Does a 3D model exist for this item — answerable WITHOUT loading the viewer.
 *
 * This block used to live in viewer3d.ts, which is the problem: `hasModel` is
 * asked on paths that have nothing to do with rendering. Opening a slot's
 * context menu probes it, and the card-art backfill probes it once per item in
 * the inventory. Leaving it in viewer3d meant browsing the grid dragged the
 * whole ~400kB viewer chain (both glove compositors, charm physics, the sticker
 * shader, the anchor tables) across the wire, which is exactly what
 * ./viewer3dLazy exists to avoid. It is a HEAD request and two Maps; it belongs
 * on the light side of that line.
 *
 * `hasModelSync` staying eager also keeps the peek-before-await optimisation in
 * App.vue honest — see the comments at the craft modal and the focus stage. A
 * version that answered "don't know" until some chunk arrived would take the
 * synchronous cache-hit path away on every single open, and the 2D-still blink
 * those comments describe would come straight back.
 */
import { getAssetOrigin, withAssetVersion } from "./api";
import { isQuadModel } from "./viewerModel";

// Encoded per PATH SEGMENT, not whole: shared models live in subdirectories
// (extra/stattrak_module), and encodeURIComponent on the whole key turns the
// separator into %2F and 404s.
//
// Version-stamped for exactly the reason the paint materials are: an extraction
// rewrites these files in place under unchanged names, so the URL cannot
// self-version and the server only marks a response immutable once `v` is
// present. Without the stamp the models mount — the largest in the pipeline, an
// AK's GLB alone pulling ~65MB of 4096-square textures — revalidated hourly in
// production and re-downloaded outright in dev.
export const modelUrlFor = (model: string) =>
  withAssetVersion(`${getAssetOrigin()}/models/${model.split("/").map(encodeURIComponent).join("/")}.glb`);

// HEAD-check whether a .glb exists for this weapon model; results are cached
// for the session so grids/toggles can query freely.
const availability = new Map<string, Promise<boolean>>();
// The same answers, already settled. `hasModel` can only ever be awaited, and
// awaiting yields to the renderer even on a cache hit — which is why the craft
// modal painted its 2D still first and then swapped to 3D a frame later, on
// every open, for a model it already knew about. Callers that must decide
// before first paint peek here and fall back to the promise on a real miss.
const settled = new Map<string, boolean>();
/** Resolved availability, or null if not yet known. Never triggers a fetch. */
export function hasModelSync(model: string): boolean | null {
  if (isQuadModel(model)) return true;
  return settled.has(model) ? settled.get(model)! : null;
}
export function hasModel(model: string): Promise<boolean> {
  // Generated meshes never touch the mount, so probing for one is a guaranteed
  // 404 that would read as "this item has no 3D form".
  if (isQuadModel(model)) return Promise.resolve(true);
  let cached = availability.get(model);
  if (!cached) {
    cached = fetch(modelUrlFor(model), { method: "HEAD" })
      .then((res) => res.ok && !(res.headers.get("content-type") ?? "").includes("text/html"))
      .catch(() => false)
      .then((ok) => {
        settled.set(model, ok);
        return ok;
      });
    availability.set(model, cached);
  }
  return cached;
}
