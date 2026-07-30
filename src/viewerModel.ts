/**
 * What to hand mountViewer for a given catalog item.
 *
 * The viewer takes a model KEY and a kind; it has never known how to get either
 * from an item, and every mount site derived the key itself — always as
 * `item.model`, which is why nothing but weapons and knives could ever show 3D.
 * Most types don't work that way:
 *
 *   weapon / melee   `item.model` is a bare slug ("ak47"), top-level on the mount
 *   glove            same, once the glove meshes are extracted under their key
 *   agent            `item.model` is ALREADY the full archive path
 *                    ("agents/models/tm_leet/tm_leet_variantg") — modelUrlFor
 *                    encodes segments individually, so it resolves unchanged
 *   keychain         no `model` at all: the econ schema decides, and 23 of 82
 *                    charms are a SHARED blank mesh plus their own material, so
 *                    the answer has to come from the backend
 *   sticker / patch  no mesh in the game either — drawn on a generated quad,
 *                    addressed by a sentinel key the viewer intercepts
 *
 * Putting that in one place is what lets the mount sites stay identical: they
 * await this and pass the result straight through. It lives here rather than in
 * itemVisuals.ts because it has to talk to the backend, and that file is
 * deliberately pure.
 */
import { API_ORIGIN } from "./api";
import type { CharmShading } from "./charmMaterial";
import type { ViewerKind } from "./viewer3d";

/** Model keys the viewer generates rather than loads. See buildViewer. */
export const QUAD_MODELS = { sticker: "__sticker", patch: "__patch" } as const;
export const isQuadModel = (model: string) =>
  model === QUAD_MODELS.sticker || model === QUAD_MODELS.patch;

/** What a charm needs beyond its mesh — see dressCharm / tuneCharmShading. */
export interface CharmSpec {
  material: string | null;
  shading: Record<string, CharmShading>;
}

export interface ViewerTarget {
  model: string;
  kind: ViewerKind;
  /** Present only for kind "charm". Pass straight through to ViewerOpts. */
  charm?: CharmSpec;
}

type ResolvableItem = {
  type?: string | null;
  model?: string | null;
  image?: string | null;
  paintMaterial?: string | null;
} | null | undefined;

// Charm lookups are per-image and stable for the life of the page, and the
// loadout can ask for the same charm from several surfaces at once.
const charmCache = new Map<string, Promise<(CharmSpec & { model: string }) | null>>();

function charmSpecFor(image: string): Promise<(CharmSpec & { model: string }) | null> {
  let cached = charmCache.get(image);
  if (!cached) {
    cached = fetch(`${API_ORIGIN}/api/catalog/charm-model?image=${encodeURIComponent(image)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((answer: { charm?: { model?: string; material?: string } | null; shading?: Record<string, CharmShading> } | null) => {
        // Same fallback the viewer's own loadCharmModel uses: on an older mount,
        // or a backend between restarts, the image stem is right for every charm
        // that owns a model of its own name. Losing all of them because one
        // lookup failed is the worse trade.
        const named = image.split("/").pop()?.replace(/\.webp$/i, "").replace(/_[0-9a-f]{8}$/i, "") ?? "";
        const model = answer?.charm?.model ?? (/^kc_/.test(named) ? named : null);
        if (!model) return null;
        return { model, material: answer?.charm?.material ?? null, shading: answer?.shading ?? {} };
      });
    charmCache.set(image, cached);
  }
  return cached;
}

/**
 * The answer when it needs no network round trip.
 *
 * Split out because the craft modal's open path is deliberately synchronous on
 * a cache hit — awaiting anything there means the 2D still paints for a frame
 * before 3D replaces it, and the 2D/3D pill blinks. Every kind but a charm can
 * answer from the item alone, so only a charm should ever pay for the await.
 *
 * `undefined` means "ask resolveViewerModel"; `null` means "no 3D form".
 */
export function resolveViewerModelSync(item: ResolvableItem): ViewerTarget | null | undefined {
  const type = item?.type;
  if (!type) return null;
  switch (type) {
    case "weapon":
    case "melee":
      // Knives are "melee" to cs2-lib but render on the weapon path — the
      // presentation difference is decided from the model name, not the kind.
      return item?.model ? { model: item.model, kind: "weapon" } : null;
    case "glove":
      return item?.model ? { model: item.model, kind: "glove" } : null;
    case "agent":
      return item?.model ? { model: item.model, kind: "agent" } : null;
    case "keychain":
      return item?.image ? undefined : null;
    // Neither has a mesh in the game — a sticker is composited into the
    // weapon's texture, a patch enables a slot in the character shader — so both
    // mount a generated quad (buildDecalQuad) dressed with their own art and the
    // real csgo_weapon_sticker material. The key is a sentinel the viewer
    // intercepts before it ever reaches the mount.
    case "sticker":
      return { model: QUAD_MODELS.sticker, kind: "sticker" };
    case "patch":
      return { model: QUAD_MODELS.patch, kind: "patch" };
    default:
      return null;
  }
}

/**
 * Resolve an item to a viewer target, or null when it has no 3D form.
 *
 * Null is a real answer — music kits, graffiti and cases have nothing to show —
 * and callers must treat it as "stay on the flat image" rather than an error.
 * A non-null answer is NOT a promise the asset is on the mount: the viewer's own
 * HEAD probe (hasModel) is still the authority on that, because extraction is
 * incremental and any individual model can be missing.
 */
export async function resolveViewerModel(item: ResolvableItem): Promise<ViewerTarget | null> {
  const sync = resolveViewerModelSync(item);
  if (sync !== undefined) return sync;
  const spec = await charmSpecFor(item!.image!);
  return spec
    ? { model: spec.model, kind: "charm", charm: { material: spec.material, shading: spec.shading } }
    : null;
}
