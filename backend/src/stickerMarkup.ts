// Per-weapon STICKER SLOT positions, straight from the compiled model.
//
// CS2 does not project stickers as 3D decals — it composites them in the
// weapon's TEXCOORD_1 UV space through a mask (csgo_weapon.slang:
// `g_vSticker0Offset < Range2(-0.5,-0.5, 0.5,0.5) >`, and no projector matrix
// anywhere in the shader). Every slot has a hand-authored UV anchor, so the
// silhouette heuristic the viewer used before could never line up: it was
// inventing a position in the wrong space entirely.
//
// The anchors live in the vmdl_c's DATA block at `m_modelInfo.m_keyValueText`.
// ValveResourceFormat parses that but ModelExtract re-emits only a whitelist of
// keys, and StickerMarkup isn't on it — which is why our own extraction pass
// (which DID recover the keychain attachment) came up empty here.
//
// This used to be read from cs2-lib's CDN, which publishes the whole parsed
// model KV as JSON. That third party is gone, so extract-models.sh §3d now
// recovers it from the game archive itself — `-b DATA` prints the vmdl_c's DATA
// block verbatim, sidestepping the ModelExtract whitelist — and writes one
// aggregate `sticker-markup.json` keyed by cs2-lib model key.
//
// Aggregate rather than a file per weapon because it is 51 KB for all 35
// stickerable weapons, and because it matches the charm-anchors sidecar next to
// it. Knives are absent from it by design: they have no sticker slots at all.
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const MODELS_DIR = process.env.MODELS_DIR ?? "/cs2-models/models";

export interface StickerSlot {
  /** The game's own slot index — this is what the protobuf `slot` field wants. */
  index: number;
  /** "body_hd" | "body_legacy" — must match the body the finish renders on. */
  mesh: string;
  /** UV anchor, centred on 0 (add 0.5 to land in TEXCOORD_1 space). */
  offset: [number, number];
  /** UV magnification: the sticker spans 1/scale UV units. */
  scale: number;
  /** In-plane rotation. Radians (values top out ~0.19, meaningless as degrees). */
  rotation: number;
  /** Autograph / Team1 / Team2 / Map — souvenir tagging, NOT an ordering. */
  special?: string;
  /**
   * The authored region this slot may be placed on: flat triangle soup (x,y per
   * vertex, 3 vertices per triangle) in the same space as `offset`.
   *
   * This is the only ground truth for where a sticker is ALLOWED to sit.
   * cs2-lib's per-weapon bounds are a rectangle drawn around it and they
   * overshoot badly — measured on the M4A1-S, the box runs to u +1.007 where the
   * real region ends at +0.467. A drag clamped to the box therefore lands on a
   * UV that is nowhere on the unwrap, and the sticker stops dead with no way for
   * the user to know why.
   *
   * Absent on mounts extracted before v12.
   */
  region?: number[];
}

const FILE = path.join(MODELS_DIR, "sticker-markup.json");

type Markup = Record<string, StickerSlot[]>;
// Keyed on mtime rather than a clock: the file only changes when an extraction
// runs, and picking that up immediately is the difference between a re-run
// fixing placement and it appearing not to.
let cache: { mtimeMs: number; markup: Markup } | null = null;
let inflight: Promise<Markup> | null = null;

/** Drop anything malformed rather than trusting the file wholesale — a
 *  truncated write would otherwise surface as NaN offsets, which the viewer
 *  renders as a sticker parked at the origin instead of not at all. */
function validate(raw: unknown): StickerSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: StickerSlot[] = [];
  for (const item of raw) {
    const e = item as Record<string, unknown>;
    const off = Array.isArray(e.offset) ? (e.offset as unknown[]).map(Number) : null;
    const index = Number(e.index);
    const scale = Number(e.scale);
    if (!off || off.length !== 2 || off.some((v) => !Number.isFinite(v))) continue;
    if (!Number.isFinite(index) || !Number.isFinite(scale)) continue;
    // Whole triangles or nothing: a truncated region would quietly shrink where
    // a sticker may go, which is indistinguishable from the weapon simply having
    // a smaller sticker area.
    const region = Array.isArray(e.region) ? (e.region as unknown[]).map(Number) : null;
    const usable = region && region.length >= 6 && region.length % 6 === 0 && region.every((v) => Number.isFinite(v));
    out.push({
      index,
      mesh: String(e.mesh ?? "body_hd"),
      offset: [off[0], off[1]],
      scale,
      rotation: Number(e.rotation) || 0,
      special: e.special ? String(e.special) : undefined,
      ...(usable ? { region: region as number[] } : {}),
    });
  }
  return out;
}

async function load(): Promise<Markup> {
  const { mtimeMs } = await stat(FILE);
  if (cache && cache.mtimeMs === mtimeMs) return cache.markup;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const doc = JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>;
      const markup: Markup = {};
      for (const [model, slots] of Object.entries(doc)) markup[model] = validate(slots);
      cache = { mtimeMs, markup };
      return markup;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Slot markup for a weapon model key, or [] when unavailable. Never throws.
 *  Empty is the honest answer for a knife (no sticker slots exist) and for a
 *  mount that predates extract-models.sh v5 — callers fall back to bounds. */
export async function getStickerMarkup(model: string): Promise<StickerSlot[]> {
  try {
    return (await load())[model] ?? [];
  } catch {
    return [];
  }
}

/** How many sticker slots this weapon really has — 4, 5 or 6, never a fixed 5. */
export function slotCount(slots: StickerSlot[], mesh = "body_hd"): number {
  return slots.filter((s) => s.mesh === mesh).length;
}

/**
 * Which model and material a charm is, from the econ schema — see the
 * charm-models step in extract-models.sh.
 *
 * A charm is NOT one model per charm: the community collections are a shared
 * blank mesh wearing their own material (23 of 82 on the current build). The
 * viewer therefore cannot guess the model from the item's image name, which is
 * why those charms rendered as flat art.
 *
 * Keyed by the same stem the item's image carries (kc_missinglink_slime), so a
 * caller with only a placement's image can resolve it.
 */
export interface CharmModel {
  /** The keychain definition index, for cross-checking against cs2-lib. */
  index: number;
  /** GLB name under /models, without the extension. */
  model: string;
  /** `/materials/<file>.vmat.json` when the model is a shared blank whose
   *  material IS the charm. Absent when the model carries its own. */
  material?: string;
}

/**
 * How the game shades a charm material, keyed by material stem.
 *
 * The decompiled GLB holds the raw texture channels; csgo_weapon.vfx rewrites
 * them per material before use, and rendering the raw values is visibly wrong —
 * Sasquatch's eyes are authored metalness 1 against a declared remap range of
 * [0, 0.5], so they came out as chrome mirrors instead of dull white.
 *
 * Keyed by MATERIAL, not by charm: the clasp is one material shared across a
 * collection, and charm-keyed params would put one charm's tuning on every
 * chain. Only materials that need a correction appear — see the charm-models
 * step in extract-models.sh.
 */
export interface CharmShading {
  /** Scale for the metalness channel — `g_vMetalnessRemapRange`'s upper bound. */
  metalness?: number;
  /** Affine adjust on roughness: `roughness * scale + offset`, from
   *  `g_fTextureRoughnessBrightness` / `Contrast`. */
  roughness?: number;
  roughnessOffset?: number;
  /**
   * `/textures/<file>.webp` — WHICH TEXELS the pattern grade applies to.
   *
   * `F_TINT_MASK` + `g_tTintMask`, set by 53 of the 82 corrected materials. The
   * game ends the grade with `mix(albedo, graded, mask.r)`, so a charm whose
   * pattern should only sweep its shell keeps its face, metal and trim as
   * authored. Absent means the whole material grades, which is also what the
   * game does without the flag.
   *
   * Delivered HERE rather than in the material JSON because only 23 charms have
   * a material file to fetch; the other 58 keep their textures inside the GLB,
   * and this map — keyed by material stem — is the only thing that reaches them.
   */
  tintMask?: string;
  /** `g_bMaskRoughnessAdjustmentsByTintMask`: the roughness adjust is lerped
   *  toward identity by the mask too. Three materials. */
  maskRoughness?: boolean;
  /**
   * SEED-DRIVEN params, as decoded expression trees keyed by shader param name.
   *
   * A charm's pattern drives real shader params on 36 of the 89 keychain
   * materials — Semi-Precious is `g_fHueShift = lerp(0, -160, $KeychainSeed)`.
   * Nodes are `{ f: "lerp" | "frac" | "+" | ... , a: [...] }` with plain numbers
   * as leaves and `{ f: "seed" }` for the pattern itself; see the charm-models
   * step in extract-models.sh.
   *
   * Passed through verbatim rather than interpreted here: the renderer is the
   * only thing that knows which params it can honour.
   */
  dynamic?: Record<string, unknown>;
}

const CHARM_FILE = path.join(MODELS_DIR, "charm-models.json");
const SHADING_FILE = path.join(MODELS_DIR, "charm-shading.json");
let charmCache: { mtimeMs: number; map: Record<string, CharmModel> } | null = null;
let shadingCache: { mtimeMs: number; map: Record<string, CharmShading> } | null = null;

/** Per-material charm shading, or {} on a mount that predates v16. */
export async function getCharmShading(): Promise<Record<string, CharmShading>> {
  try {
    const { mtimeMs } = await stat(SHADING_FILE);
    if (shadingCache && shadingCache.mtimeMs === mtimeMs) return shadingCache.map;
    const doc = JSON.parse(await readFile(SHADING_FILE, "utf8")) as Record<string, unknown>;
    const map: Record<string, CharmShading> = {};
    for (const [stem, raw] of Object.entries(doc)) {
      const e = raw as Record<string, unknown>;
      const out: CharmShading = {};
      // A NaN here would reach three as a material property and render the charm
      // black, which is far harder to trace back than a dropped correction.
      for (const key of ["metalness", "roughness", "roughnessOffset"] as const) {
        const v = Number(e[key]);
        if (Number.isFinite(v)) out[key] = v;
      }
      // Path-checked like the patch materials are: this becomes a fetch URL in
      // the client, and the one thing worth refusing is a value that is not a
      // texture we wrote.
      if (typeof e.tintMask === "string" && e.tintMask.startsWith("/textures/")) out.tintMask = e.tintMask;
      if (e.maskRoughness === true) out.maskRoughness = true;
      if (e.dynamic && typeof e.dynamic === "object" && !Array.isArray(e.dynamic)) {
        out.dynamic = e.dynamic as Record<string, unknown>;
      }
      if (Object.keys(out).length) map[stem] = out;
    }
    shadingCache = { mtimeMs, map };
    return map;
  } catch {
    return {};
  }
}

const PATCH_FILE = path.join(MODELS_DIR, "patch-materials.json");
let patchCache: { mtimeMs: number; map: Record<string, string> } | null = null;

/**
 * Kit index -> patch material path, or {} on a mount without the step.
 *
 * The one place a patch's material is knowable. cs2-lib gives a patch no
 * `paintMaterial` — 0 of 112 — so this file, written from the econ schema's
 * `patch_material`, is what lets stickerMaterialFor answer for a patch at all.
 */
export async function getPatchMaterials(): Promise<Record<string, string>> {
  try {
    const { mtimeMs } = await stat(PATCH_FILE);
    if (patchCache && patchCache.mtimeMs === mtimeMs) return patchCache.map;
    const doc = JSON.parse(await readFile(PATCH_FILE, "utf8")) as Record<string, unknown>;
    const map: Record<string, string> = {};
    for (const [index, raw] of Object.entries(doc)) {
      if (typeof raw === "string" && raw.startsWith("/materials/")) map[index] = raw;
    }
    patchCache = { mtimeMs, map };
    return map;
  } catch {
    return {};
  }
}

/** Charm model map, or {} when the mount predates the charm-models step. */
export async function getCharmModels(): Promise<Record<string, CharmModel>> {
  try {
    const { mtimeMs } = await stat(CHARM_FILE);
    if (charmCache && charmCache.mtimeMs === mtimeMs) return charmCache.map;
    const doc = JSON.parse(await readFile(CHARM_FILE, "utf8")) as Record<string, unknown>;
    const map: Record<string, CharmModel> = {};
    for (const [name, raw] of Object.entries(doc)) {
      const e = raw as Record<string, unknown>;
      const model = typeof e.model === "string" ? e.model : null;
      if (!model || !/^[\w.-]+$/.test(model)) continue;
      map[name] = {
        index: Number(e.index) || 0,
        model,
        ...(typeof e.material === "string" && e.material.startsWith("/materials/")
          ? { material: e.material }
          : {}),
      };
    }
    charmCache = { mtimeMs, map };
    return map;
  } catch {
    return {};
  }
}
