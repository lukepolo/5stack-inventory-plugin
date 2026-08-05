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

// ---- Charm placement surfaces (KeychainMarkup) ------------------------------
//
// The sticker markup's counterpart for charms, out of the same DATA block and
// written by the same extraction step. Each entry is one authored QUAD the game
// will let a charm hang from.
//
// THE ONE THING THAT MATTERS: the corners are already in GLB space. Verified
// against every weapon's GLB POSITION bounds — 32/32 fit as-is and 1/32 fits
// with `base` added — so unlike the keychain ATTACHMENT (bone-relative, needs
// base folded in; see the two-space note on offsetToWorld in viewer3d.ts) this
// needs no transform, no `cal` and no pose to be used directly.
//
// WHY NOT cs2-lib 9's `keychainPosition{X,Y,Z}{Min,Max}` — and it is not because
// they are wrong. Measured against ours on all 34 weapons that have both: 20 are
// identical to the decimal and 14 differ by at most 0.561" (galilar), always in
// the direction of cs2-lib being looser, because it folds the moving-part quads
// (slide, bolt, pump, charge handle) into the same box as the body's. As a
// CLAMP its box is fine.
//
// The reason to read the block ourselves is that a box cannot do the job. A
// charm has to sit ON a surface, and only the quads say where the surfaces are —
// an axis-aligned box around them includes plenty of empty air, which is exactly
// how a charm ends up floating beside the weapon instead of flush against it.

export interface CharmQuad {
  /** "body_hd" | "body_legacy" — the same body-variant key sticker slots use. */
  mesh: string;
  /**
   * The bone that MOVES this surface, not the frame it is written in.
   *
   * `weapon_offset` is the static body and covers 1,915 of the 2,141 quads. The
   * rest ride a slide, bolt, magazine, silencer or pump and travel with the
   * animation — a consumer that can't follow a bone should prefer the
   * weapon_offset quads rather than pin a charm to a part that slides away.
   *
   * `elite` (Dual Berettas) has NO weapon_offset at all — its quads are on
   * `weapon_r`/`weapon_l`, which is exactly the data its missing charm anchor
   * needed.
   */
  bone: string;
  /** 4 corners x XYZ, flat. GLB space. */
  corners: number[];
}

const KEYCHAIN_MARKUP_FILE = path.join(MODELS_DIR, "keychain-markup.json");
type CharmMarkup = Record<string, CharmQuad[]>;
let keychainCache: { mtimeMs: number; markup: CharmMarkup } | null = null;
let keychainInflight: Promise<CharmMarkup> | null = null;

/** Whole quads or nothing — a truncated one would describe a surface that isn't
 *  there, and a consumer would snap a charm onto it. */
function validateCharm(raw: unknown): CharmQuad[] {
  if (!Array.isArray(raw)) return [];
  const out: CharmQuad[] = [];
  for (const item of raw) {
    const e = item as Record<string, unknown>;
    const corners = Array.isArray(e.corners) ? (e.corners as unknown[]).map(Number) : null;
    if (!corners || corners.length !== 12 || corners.some((v) => !Number.isFinite(v))) continue;
    out.push({
      mesh: String(e.mesh ?? "body_hd"),
      bone: String(e.bone ?? "weapon_offset"),
      corners,
    });
  }
  return out;
}

async function loadCharm(): Promise<CharmMarkup> {
  const { mtimeMs } = await stat(KEYCHAIN_MARKUP_FILE);
  if (keychainCache && keychainCache.mtimeMs === mtimeMs) return keychainCache.markup;
  if (keychainInflight) return keychainInflight;
  keychainInflight = (async () => {
    try {
      const doc = JSON.parse(await readFile(KEYCHAIN_MARKUP_FILE, "utf8")) as Record<string, unknown>;
      const markup: CharmMarkup = {};
      for (const [model, quads] of Object.entries(doc)) markup[model] = validateCharm(quads);
      keychainCache = { mtimeMs, markup };
      return markup;
    } finally {
      keychainInflight = null;
    }
  })();
  return keychainInflight;
}

/** Charm surfaces for a weapon model key, or [] when unavailable. Never throws.
 *  Empty is the honest answer for a knife (charms don't go on knives) and for a
 *  mount extracted before v23 — callers keep whatever placement they had. */
export async function getCharmMarkup(model: string): Promise<CharmQuad[]> {
  try {
    return (await loadCharm())[model] ?? [];
  } catch {
    return [];
  }
}

/**
 * Axis-aligned bounds of a weapon's charm surfaces, per body variant.
 *
 * Restricted to ONE bone (default the static body) precisely because that is
 * what cs2-lib gets wrong — corners from different bones are in different
 * frames and their union is not a box in any of them.
 */
export function charmBounds(
  quads: CharmQuad[],
  mesh = "body_hd",
  bone = "weapon_offset",
): { x: [number, number]; y: [number, number]; z: [number, number] } | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const q of quads) {
    if (q.mesh !== mesh || q.bone !== bone) continue;
    for (let i = 0; i < 12; i += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], q.corners[i + a]);
        hi[a] = Math.max(hi[a], q.corners[i + a]);
      }
    }
    any = true;
  }
  if (!any) return null;
  return { x: [lo[0], hi[0]], y: [lo[1], hi[1]], z: [lo[2], hi[2]] };
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
  /**
   * `csgo_simple_liquid.vfx`'s params, when this material is on that shader.
   *
   * Two materials on this build, both Charm | Butane Buddy's — an inner liquid
   * volume and an outer glass shell. Worth its own channel despite that count
   * because the shader IS the charm: its albedo is the empty glass, so without
   * these the charm renders as a featureless pale blob.
   *
   * Passed through verbatim, like `dynamic` and for the same reason. Only the
   * shape is checked here — a param the renderer cannot honour is its business,
   * and a param this file filtered out would be invisible to diagnose.
   */
  liquid?: Record<string, unknown>;
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
      if (e.liquid && typeof e.liquid === "object" && !Array.isArray(e.liquid)) {
        const liquid = { ...(e.liquid as Record<string, unknown>) };
        // Path-checked like tintMask above, and for the same reason: this one
        // field becomes a fetch URL in the client. Dropping just the mask leaves
        // the rest of the liquid renderable — ungated, which is visibly wrong but
        // far better than no liquid at all.
        if (typeof liquid.mask === "string" && !liquid.mask.startsWith("/textures/")) delete liquid.mask;
        out.liquid = liquid;
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
