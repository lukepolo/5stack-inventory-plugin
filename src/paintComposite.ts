// CS2 paint compositing — a WebGL port of Valve's csgo_customweapon.vfx.
//
// CS2 does NOT shade skins live: it composites the paint into textures in the
// weapon's paint-UV space (albedo + roughness/metalness), then the weapon
// renders as ordinary PBR with those maps. We do the same: one offscreen
// fullscreen pass per output, math transcribed from the shader itself
// (GameTracking-CS2 csgo_customweapon.slang, decompiled variant + the
// Source1 ancestor which carries every per-style branch) and the seed
// pipeline from cs_custom_weapon_visualsdata_processor.cpp.
//
// Pixel-perfection notes, all sourced (do not "fix" without re-checking):
// - wear blend  = smoothstep(0.58-soft, 0.68+soft, (noPaint + wear*cavity)
//                 * (wearAmt*6+1) * durability)   [CS2 decompile]
// - grunge      = mix(1, grunge, pow(1-cavity,4)*0.25 + 0.75*wearAmt)
// - worn paint albedo drifts toward a normalized "levels" color as wearAmt
//   rises (paint dulls before it strips)          [CS2 decompile]
// - seed order  = patternX, patternY, patternRot, wearScale(1.6-1.8),
//                 wearX(0-1), wearY(0-1), wearRot(0-360), then grunge same —
//                 via Valve's CUniformRandomStream, NOT a generic PRNG
// - transforms quantized to 2 decimals (%.2f / floor((x+.005)*100)/100)
// - pattern & wear & grunge scale all multiply weaponLength/36 for
//   spray/anodized-air styles, uvScale for everything else
import { API_ORIGIN } from "./api";

type THREE = typeof import("three");

// ---- CDN plumbing --------------------------------------------------------------
// All paint-chain data lives on cdn.cstrike.app (mirrored under /paints).
const PAINT_CDN = "https://cdn.cstrike.app";
const PAINT_SELF = `${API_ORIGIN}/paints`;

// The mirror is optional: when /paints is unpopulated EVERY asset would probe
// it, 404, and only then fetch the CDN — two round-trips each, a slower first
// paint, and a console so full of red that real errors hide in it. Give up on
// the mirror after a few consecutive misses and go straight to the CDN for the
// rest of the session. A few misses rather than one so a single absent file
// can't disable a mirror that is otherwise fine.
const MIRROR_GIVE_UP_AFTER = 3;
let mirrorMisses = 0;
const mirrorWorthTrying = () => mirrorMisses < MIRROR_GIVE_UP_AFTER;
function noteMirror(hit: boolean) {
  if (hit) {
    mirrorMisses = 0;
    return;
  }
  mirrorMisses++;
  if (mirrorMisses === MIRROR_GIVE_UP_AFTER) {
    console.info(`[paint] /paints mirror looks empty — serving from ${PAINT_CDN} for this session`);
  }
}
/** True once the mirror has been written off, so callers can report it. */
export const paintMirrorDisabled = () => !mirrorWorthTrying();

export async function paintFetch(path: string): Promise<Response> {
  if (mirrorWorthTrying()) {
    try {
      const res = await fetch(PAINT_SELF + path);
      noteMirror(res.ok);
      if (res.ok) return res;
    } catch {
      noteMirror(false); // self-host unreachable
    }
  }
  return fetch(PAINT_CDN + path);
}

export async function paintTextureUrl(path: string): Promise<string> {
  if (mirrorWorthTrying()) {
    try {
      const head = await fetch(PAINT_SELF + path, { method: "HEAD" });
      const ok = head.ok && !(head.headers.get("content-type") ?? "").includes("text/html");
      noteMirror(ok);
      if (ok) return PAINT_SELF + path;
    } catch {
      noteMirror(false);
    }
  }
  return PAINT_CDN + path;
}

// ---- Paint definition ----------------------------------------------------------
// paintMaterial -> vcompmat.json (loose runtime textures + seed ranges)
//               -> vmat.json (csgo_customweapon params).
export interface PaintDef {
  style: number; // F_PAINT_STYLE, CS2 0-based: 0 solid .. 8 gunsmith
  /** F_SPRAYPAINT_HALFTONE: pattern channels are thresholded against the dot
   *  screen in pattern.a instead of used as smooth mix weights. */
  halftone: boolean;
  // Textures (CDN paths). ao/baseColor/baseRM are the *defaults* baked into
  // the paint's vmat — per-weapon composite inputs override them when the
  // model extraction provides them.
  pattern?: string;
  normal?: string;
  wearMask?: string;
  overlay?: string;
  overlayMask?: string;
  overlayBlendMode: number;
  overlayMaskMode: number;
  overlayStrength: number;
  overlayBrightness: number;
  overlayScale: number;
  overlayRot: number;
  overlayOffset: number[];
  overlayUsesPatternUv: boolean;
  overlayUsesUniqueUv: boolean;
  grunge?: string;
  masks?: string;
  ao?: string;
  baseColor?: string;
  baseRM?: string;
  paintRoughnessTex?: string; // F_ROUGHNESS_TEXTURE (per-paint map)
  paintMetalnessTex?: string; // F_METALNESS_TEXTURE
  // Scalars / palettes (linear RGB, straight from the compiled vmat).
  colors: [number, number, number][];
  durability: [number, number, number, number];
  roughPerColor: [number, number, number, number] | null;
  metalPerColor: [number, number, number, number] | null;
  roughness: number;
  metalness: number;
  wearSoftness: number;
  colorBrightness: number;
  pearlescent: number;
  patternScale: number;
  ignoreWeaponSizeScale: boolean;
  weaponLength: number;
  uvScale: number;
  // Seed envelopes (from the vcompmat loose-variable bounds).
  offsetX: [number, number];
  offsetY: [number, number];
  rotation: [number, number];
}

const paintCache = new Map<string, Promise<PaintDef | null>>();
export function loadPaintDef(paintMaterial: string): Promise<PaintDef | null> {
  let cached = paintCache.get(paintMaterial);
  if (!cached) {
    cached = fetchPaintDef(paintMaterial);
    paintCache.set(paintMaterial, cached);
  }
  return cached;
}

async function fetchPaintDef(paintMaterial: string): Promise<PaintDef | null> {
  try {
    const comp = await (await paintFetch(paintMaterial)).json();
    // Newer "composite" paints reference a shared TEMPLATE vmat and inject the
    // skin-specific textures as loose variables carrying runtime resource
    // paths — those win over the template's generic params.
    let vmatPath: string | undefined;
    const loose = new Map<string, string>();
    // The template is SHARED across many skins, so anything only read from it is
    // the same for all of them. The per-skin values live here as loose variables
    // and must win — not just textures. Reading colours from the template alone
    // rendered every composite paint with the [0.5,0.5,0.5] fallback (a white
    // gun), and reported the template's F_OVERLAY_* rather than the skin's, so
    // overlays were being composited through the wrong branch entirely.
    const looseVal = new Map<string, Record<string, unknown>>();
    const ranges = new Map<string, { x: [number, number]; y: [number, number] }>();
    const walk = (o: unknown) => {
      if (!o) return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (typeof o === "object") {
        const rec = o as Record<string, unknown>;
        if (!vmatPath && typeof rec.m_strSpecificContainerMaterial === "string") {
          vmatPath = rec.m_strSpecificContainerMaterial;
        }
        if (
          typeof rec.m_strName === "string" &&
          typeof rec.m_strTextureRuntimeResourcePath === "string" &&
          !loose.has(rec.m_strName)
        ) {
          loose.set(rec.m_strName, rec.m_strTextureRuntimeResourcePath);
        }
        if (typeof rec.m_strName === "string" && !looseVal.has(rec.m_strName)) {
          looseVal.set(rec.m_strName, rec);
        }
        if (typeof rec.m_strName === "string" && rec.m_flValueFloatX_Min != null && !ranges.has(rec.m_strName)) {
          ranges.set(rec.m_strName, {
            x: [Number(rec.m_flValueFloatX_Min), Number(rec.m_flValueFloatX_Max ?? 0)],
            y: [Number(rec.m_flValueFloatY_Min ?? 0), Number(rec.m_flValueFloatY_Max ?? 0)],
          });
        }
        Object.values(rec).forEach(walk);
      }
    };
    walk(comp);

    // m_cValueColor4 is 0-255 sRGB; every colour downstream (and the template's
    // m_vectorParams) is linear 0-1, so convert rather than just scaling.
    const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const looseNum = (n: string, key: string): number | undefined => {
      const v = looseVal.get(n)?.[key];
      return v == null || v === "" ? undefined : Number(v);
    };
    const looseColor = (n: string): number[] | undefined => {
      const c = looseVal.get(n)?.m_cValueColor4;
      if (!Array.isArray(c)) return undefined;
      return c.slice(0, 3).map((x) => srgbToLinear(Number(x) / 255));
    };

    let tex = (_n: string): string | undefined => undefined;
    let flt = (_n: string, d: number): number => d;
    let int = (_n: string, d: number): number => d;
    let vec = (_n: string): number[] | undefined => undefined;
    if (vmatPath) {
      const vmat = (await (await paintFetch(vmatPath)).json()) as {
        m_textureParams?: { m_name: string; m_pValue: string }[];
        m_floatParams?: { m_name: string; m_flValue: string }[];
        m_intParams?: { m_name: string; m_nValue: string }[];
        m_vectorParams?: { m_name: string; m_value: string[] }[];
      };
      tex = (n) => vmat.m_textureParams?.find((t) => t.m_name === n)?.m_pValue;
      flt = (n, d) => {
        const v = vmat.m_floatParams?.find((f) => f.m_name === n)?.m_flValue;
        return v != null ? Number(v) : d;
      };
      int = (n, d) => {
        const v = vmat.m_intParams?.find((f) => f.m_name === n)?.m_nValue;
        return v != null ? Number(v) : d;
      };
      vec = (n) => vmat.m_vectorParams?.find((x) => x.m_name === n)?.m_value?.map(Number);
    }
    // Skin-specific value beats template value beats caller default. Booleans
    // ride m_bValueBoolean and are read through int() as 0/1 by the callers.
    const tmplFlt = flt;
    const tmplInt = int;
    const tmplVec = vec;
    flt = (n, d) => looseNum(n, "m_flValueFloatX") ?? tmplFlt(n, d);
    int = (n, d) => {
      // Every scalar in this JSON is a STRING ("1", not 1) — including booleans,
      // so a typeof check silently falls through to the template.
      const b = looseVal.get(n)?.m_bValueBoolean;
      if (b != null && b !== "") return b === "0" || b === "false" || b === false ? 0 : 1;
      return looseNum(n, "m_nValueIntX") ?? tmplInt(n, d);
    };
    vec = (n) => {
      const c = looseColor(n);
      if (c) return c;
      const x = looseNum(n, "m_flValueFloatX");
      if (x !== undefined) {
        return [x, looseNum(n, "m_flValueFloatY") ?? 0, looseNum(n, "m_flValueFloatZ") ?? 0, looseNum(n, "m_flValueFloatW") ?? 0];
      }
      return tmplVec(n);
    };
    // BOTH colour sources are sRGB and BOTH need converting — they just differ in
    // range. The vcompmat's m_cValueColor4 is sRGB 0-255 (handled by
    // looseColor). A compiled vmat's m_vectorParams g_vColorN is sRGB 0-1, NOT
    // linear: AK-47 | Safari Mesh stores [0.4275, 0.4118, 0.3294], and x255 is
    // (109,105,84) — which is the official render's mean colour (109,105,80).
    // Consuming it as linear produced (175,172,155): too bright and, because
    // sRGB->linear is non-uniform across channels, too grey. That was the
    // "correct pattern but washed out" symptom on every older-style paint that
    // carries its palette in a dedicated vmat rather than as loose variables.
    const paletteColor = (n: string): [number, number, number] | null => {
      const lc = looseColor(n); // m_cValueColor4 — already converted to linear
      if (lc) return [lc[0], lc[1], lc[2]];
      const t = tmplVec(n);
      if (!t) return null;
      return [srgbToLinear(t[0]), srgbToLinear(t[1]), srgbToLinear(t[2])];
    };
    const colors: [number, number, number][] = [];
    for (const cn of ["g_vColor0", "g_vColor1", "g_vColor2", "g_vColor3"]) {
      const v = paletteColor(cn);
      if (v) colors.push(v);
    }
    const vec4 = (n: string): [number, number, number, number] | null => {
      const v = vec(n);
      return v ? [v[0], v[1], v[2], v[3] ?? v[2]] : null;
    };
    // Deliberately bypasses vec(): that prefers the loose value, and for this
    // one param the loose and compiled forms mean opposite things.
    const durability = (): [number, number, number, number] => {
      const lv = looseVal.get("g_vPaintDurability");
      if (lv?.m_flValueFloatX != null) {
        const inv = (k: string) => 1 - Number(lv[k] ?? 0);
        return [inv("m_flValueFloatX"), inv("m_flValueFloatY"), inv("m_flValueFloatZ"), inv("m_flValueFloatW")];
      }
      const t = tmplVec("g_vPaintDurability");
      return t ? [t[0], t[1], t[2], t[3] ?? t[2]] : [1, 1, 1, 1];
    };
    const t = (n: string) => loose.get(n) ?? tex(n);
    return {
      style: int("F_PAINT_STYLE", 0),
      halftone: int("F_SPRAYPAINT_HALFTONE", 0) !== 0,
      pattern: t("g_tPattern"),
      normal: t("g_tNormal"),
      wearMask: t("g_tWear"),
      grunge: t("g_tGrunge"),
      // Paint-by-number materials name their mask atlas g_tPaintByNumberMasks in
      // the vcompmat, and their vmat's g_tMasks is a generic default. Reading
      // g_tMasks first meant those skins coloured against a stand-in mask.
    masks: loose.get("g_tPaintByNumberMasks") ?? t("g_tMasks"),
      // Overlay layer: a second artwork pass composited over the paint. ~10% of
      // finishes use it and ~4% have NO pattern at all, so without this they
      // render as flat white. Declarations below are all from the shader's own
      // FEATURES block; see the blend note in the fragment source.
      // g_bUseOverlay decides whether the overlay runs at all. The vcompmat
      // ships a g_tOverlay placeholder even when it is OFF, so keying off the
      // texture's presence applied a disabled overlay at full strength.
      //
      // MEASURED on FAMAS | Byproduct (g_bUseOverlay = 0, g_tOverlay = a 1x1
      // pixel of 0.733 grey with alpha 1): F_OVERLAY_MASK 0 makes gate = 1 over
      // the whole weapon and F_OVERLAY_BLEND_MODE 0 is a straight replace, so
      // oa = 1*1*1 and cPaint = mix(cPaint, grey, 1) — every pixel of paint
      // overwritten with flat grey. The GPU read back mean (100,100,95) at
      // saturation 5. This is why skins rendered grey no matter what the
      // palette, the wear or the pattern said.
      overlay: int("g_bUseOverlay", 1) !== 0 ? (loose.get("g_tOverlay") ?? t("g_tOverlay")) : undefined,
      overlayMask: loose.get("g_tOverlayMask") ?? t("g_tOverlayMask"),
      overlayBlendMode: int("F_OVERLAY_BLEND_MODE", 0),
      overlayMaskMode: int("F_OVERLAY_MASK", 0),
      overlayStrength: flt("g_fOverlayStrength", 1),
      overlayBrightness: flt("g_fOverlayBrightness", 1),
      overlayScale: flt("g_flOverlayTexCoordScale", 1),
      overlayRot: flt("g_flOverlayTexCoordRotation", 0),
      overlayOffset: vec("g_vOverlayTexCoordOffset") ?? [0, 0],
      overlayUsesPatternUv: int("g_bOverlayUsesPatternUVs", 0) !== 0 || int("g_bOverlayUsesUniqueUVs", 0) !== 0,
      overlayUsesUniqueUv: int("g_bOverlayUsesUniqueUVs", 0) !== 0,
      ao: t("g_tAmbientOcclusion"),
      baseColor: t("g_tColor"),
      baseRM: t("g_tMetalness"),
      // g_bUseRoughness / g_bUseMetalness decide whether the TEXTURE is used at
      // all; g_bUseRoughnessByColor selects the per-colour vector instead. The
      // vcompmat lists a texture either way, so taking it unconditionally let a
      // placeholder win: P90 | Desert Halftone sets g_bUseRoughness = 0 and
      // per-colour roughness (0.30, 0.38, 0.47, 0.52), but g_tPaintRoughness
      // pointed at a 1x1 pixel of 0.502 that the shader then applied over the
      // whole weapon (`if (uHasRoughTex) roughPaint = texture(...)` overrides
      // the per-colour mix).
      paintRoughnessTex: int("g_bUseRoughness", 0) !== 0 ? loose.get("g_tPaintRoughness") : undefined,
      paintMetalnessTex: int("g_bUseMetalness", 0) !== 0 ? loose.get("g_tPaintMetalness") : undefined,
      colors,
      // g_vPaintDurability is stored in TWO different conventions and mixing
      // them silently kills wear. The compiled vmat holds Expression(1-authored)
      // — already shader-ready. The vcompmat's loose copy holds the AUTHORED
      // value, so it needs inverting. Feeding the authored value straight
      // through makes dur collapse to 0, and `blend *= dur` then zeroes the
      // whole wear-through term: the wear slider moves and the paint never
      // strips. Measured on P90 | Desert Halftone (authored [0,0,0,0.2]):
      // as-authored -> dur 0.000, inverted -> dur 1.000.
      durability: durability(),
      roughPerColor: vec4("g_vPaintRoughness"),
      metalPerColor: vec4("g_vPaintMetalness"),
      roughness: flt("g_flPaintRoughness", 0.6),
      metalness: flt("g_flPaintMetalness", 0),
      wearSoftness: flt("g_fWearSoftness", 0),
      colorBrightness: flt("g_flColorBrightness", 1),
      pearlescent: flt("g_flPearlescentScale", 0),
      patternScale: flt("g_flPatternTexCoordScale", 1),
      ignoreWeaponSizeScale: int("g_bIgnoreWeaponSizeScale", 0) !== 0,
      weaponLength: flt("g_flWeaponLength1", 36),
      uvScale: flt("g_flUvScale1", 1),
      offsetX: (ranges.get("g_vPatternTexCoordOffset")?.x ?? [flt2(vec("g_vPatternTexCoordOffset"), 0), flt2(vec("g_vPatternTexCoordOffset"), 0)]) as [number, number],
      offsetY: (ranges.get("g_vPatternTexCoordOffset")?.y ?? [flt2(vec("g_vPatternTexCoordOffset"), 1), flt2(vec("g_vPatternTexCoordOffset"), 1)]) as [number, number],
      rotation: (ranges.get("g_flPatternTexCoordRotation")?.x ?? [flt("g_flPatternTexCoordRotation", 0), flt("g_flPatternTexCoordRotation", 0)]) as [number, number],
    };
  } catch {
    return null;
  }
}
const flt2 = (v: number[] | undefined, i: number) => (v ? (v[i] ?? 0) : 0);

// ---- Per-weapon composite inputs ----------------------------------------------
// Extracted from the game VPK next to the model (scripts/extract-models.sh):
// /models/<key>.inputs/meta.json + webp/png textures. Optional — the paint's
// generic defaults are used when absent (worn areas then reveal generic
// gunmetal instead of the weapon's true base texture).
// Channel packing depends on F_SEPARATE_CHANNEL_INPUTS in the weapon's
// composite_inputs vmat. Ground truth, csgo_composite_inputs.slang:
//   S_SEPARATE_CHANNEL_INPUTS == 1  ("Separate Channels", the HD/CS2 bodies)
//     g_tAmbientOcclusion: Channel(R, Cavity) Channel(G, AO) Channel(A, NoPaint)
//   S_SEPARATE_CHANNEL_INPUTS == 0  ("Pre-packed Source1 Input", legacy bodies)
//     g_tAmbientOcclusion: Channel(RGBA, AmbientOcclusion) — the Source1 pack,
//     whose B is cavity and A is noPaint.
// So cavity moves between B and R. Reading the wrong one is not subtle: the HD
// cavity texture's B is 0.000 across the ENTIRE map (measured), which zeroes the
// wear-through signal — the weapon never strips at any float.
export interface WeaponInputs {
  ao?: string; // separateChannels ? R=cavity G=ao A=noPaint : Source1 pack (B=cavity A=noPaint)
  masks?: string; // paint-by-number RGB
  color?: string; // base weapon albedo (paint-UV space)
  metalness?: string; // R=roughness G=metalness
  mag?: string; // translucent-magazine UV mask (white = mag texel)
  weaponLength?: number;
  uvScale?: number;
  separateChannels?: boolean;
}
const weaponInputsCache = new Map<string, Promise<WeaponInputs | null>>();
// Every asset path here degrades silently to a fallback, which is right for
// rendering and terrible for debugging: a missing base-colour texture and a
// broken wear curve produce the same "why is my gun black" symptom. Record what
// failed so it can be reported instead of guessed at.
export interface CompositeDiag {
  model: string;
  missing: string[];
  failedTextures: string[];
}
const diagByModel = new Map<string, CompositeDiag>();
function noteMissing(model: string, what: string) {
  const d = diagByModel.get(model) ?? { model, missing: [], failedTextures: [] };
  if (!d.missing.includes(what)) d.missing.push(what);
  diagByModel.set(model, d);
}
const failedUrls = new Set<string>();
const warnedModels = new Set<string>();
/** What fell back to a default for this weapon, if anything. */
export const compositeDiagnostics = (model: string): CompositeDiag | null => diagByModel.get(model) ?? null;
export const allCompositeDiagnostics = () => [...diagByModel.values()];

// Every weapon ships TWO composite_inputs sets, and they are not interchangeable:
//
//   legacy  materials/models/weapons/customization/<class>_<key>/…
//           layer_name_1 -> v_models/<key>.vmat, i.e. authored against the
//           LEGACY body's unwrap. P90: uvScale 0.537, weaponLength 19.637.
//   hd      weapons/models/<key>/materials/composite_inputs/…
//           the CS2-native body. P90: uvScale 0.678, weaponLength 20.381,
//           F_SEPARATE_CHANNEL_INPUTS=1.
//
// Different unwraps, MEASURED: legacy ao.a and HD ao.a agree on only 55% of
// texels, which is chance for their coverages (0.322 / 0.316). Feeding one set
// to the other body scatters noPaint/masks/baseColour into unrelated places —
// bare-metal texels land in the middle of painted panels, and the hardware that
// should stay bare gets painted.
//
// viewer3d picks body_hd vs body_legacy per finish (cs2-lib `item.legacy`), so
// the input set has to be picked the same way. This used to be keyed on model
// alone, which meant every CS2-native finish rendered the HD body against
// legacy inputs.
export function loadWeaponInputs(model: string, legacy = false): Promise<WeaponInputs | null> {
  const dir = legacy ? `${model}.inputs` : `${model}.inputs.hd`;
  let cached = weaponInputsCache.get(dir);
  if (!cached) {
    cached = (async () => {
      const load = async (d: string): Promise<WeaponInputs | null> => {
        const res = await fetch(`${API_ORIGIN}/models/${encodeURIComponent(d)}/meta.json`);
        if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) return null;
        const meta = (await res.json()) as WeaponInputs & { textures?: Record<string, string> };
        const base = `${API_ORIGIN}/models/${encodeURIComponent(d)}/`;
        const rel = (p?: string) => (p ? base + p : undefined);
        return {
          ao: rel(meta.textures?.ao),
          masks: rel(meta.textures?.masks),
          color: rel(meta.textures?.color),
          metalness: rel(meta.textures?.metalness),
          mag: rel(meta.textures?.mag),
          weaponLength: meta.weaponLength,
          uvScale: meta.uvScale,
          separateChannels: !!meta.separateChannels,
        };
      };
      try {
        const got = await load(dir);
        if (got) return got;
        // An extraction that predates the HD bundles only has <key>.inputs.
        // Falling back keeps those weapons rendering as they did rather than
        // dropping to generic defaults — but it IS the mismatched set, so say so.
        if (!legacy) {
          const fallback = await load(`${model}.inputs`);
          if (fallback) {
            noteMissing(model, "inputs.hd (HD body rendering against LEGACY inputs — re-run model extraction)");
            return fallback;
          }
        }
        // No composite inputs on the mount at all: worn areas fall back to a
        // generic grey and the weapon's real base colour never shows.
        noteMissing(model, "inputs/meta.json (run model extraction)");
        return null;
      } catch {
        return null;
      }
    })();
    weaponInputsCache.set(dir, cached);
  }
  return cached;
}

// ---- Valve's CUniformRandomStream (vstdlib ran1) --------------------------------
// The seed → pattern placement pipeline must match the game bit-for-bit or
// Case Hardened / Fade / Marble Fade seeds render the wrong pattern.
const NTAB = 32;
const IA = 16807;
const IM = 2147483647;
const IQ = 127773;
const IR = 2836;
const NDIV = 1 + (IM - 1) / NTAB;
const AM = 1.0 / IM;
const RNMX = 1.0 - 1.2e-7;

class UniformRandomStream {
  private idum: number;
  private iy = 0;
  private iv = new Array<number>(NTAB);
  constructor(seed: number) {
    this.idum = seed < 0 ? seed : -seed;
  }
  private next(): number {
    let j: number, k: number;
    if (this.idum <= 0 || !this.iy) {
      this.idum = -this.idum < 1 ? 1 : -this.idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = Math.trunc(this.idum / IQ);
        this.idum = Math.trunc(IA * (this.idum - k * IQ) - IR * k);
        if (this.idum < 0) this.idum += IM;
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0];
    }
    k = Math.trunc(this.idum / IQ);
    this.idum = Math.trunc(IA * (this.idum - k * IQ) - IR * k);
    if (this.idum < 0) this.idum += IM;
    j = Math.trunc(this.iy / NDIV) & (NTAB - 1);
    this.iy = this.iv[j];
    this.iv[j] = this.idum;
    return this.iy;
  }
  randomFloat(low = 0, high = 1): number {
    let fl = AM * this.next();
    if (fl > RNMX) fl = RNMX;
    return fl * (high - low) + low;
  }
}

interface SeededVisuals {
  patternOffsetX: number;
  patternOffsetY: number;
  patternRot: number;
  wearScale: number;
  wearOffsetX: number;
  wearOffsetY: number;
  wearRot: number;
  grungeScale: number;
  grungeOffsetX: number;
  grungeOffsetY: number;
  grungeRot: number;
}
// Exact call order from CCSWeaponVisualsDataProcessor::SetVisualsData.
export function seededVisuals(def: PaintDef, seed: number): SeededVisuals {
  const rs = new UniformRandomStream(seed);
  return {
    patternOffsetX: rs.randomFloat(def.offsetX[0], def.offsetX[1]),
    patternOffsetY: rs.randomFloat(def.offsetY[0], def.offsetY[1]),
    patternRot: rs.randomFloat(def.rotation[0], def.rotation[1]),
    wearScale: rs.randomFloat(1.6, 1.8),
    wearOffsetX: rs.randomFloat(0, 1),
    wearOffsetY: rs.randomFloat(0, 1),
    wearRot: rs.randomFloat(0, 360),
    grungeScale: rs.randomFloat(1.6, 1.8),
    grungeOffsetX: rs.randomFloat(0, 1),
    grungeOffsetY: rs.randomFloat(0, 1),
    grungeRot: rs.randomFloat(0, 360),
  };
}

// Valve's texcoord transform, exactly as baked by the vmat Expression:
// rotate about (0.5, 0.5), scale, then offset; every input quantized to two
// decimals first (the game writes them through "%.2f").
const q2 = (x: number) => Math.floor((x + 0.005) * 100) / 100;
function texXform(rotDeg: number, scale: number, offX: number, offY: number): [number[], number[]] {
  const r = q2(rotDeg);
  const s = q2(scale) || 1;
  const ox = q2(offX);
  const oy = q2(offY);
  const rad = (r * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const v6 = 0.5 / s;
  const v7 = Math.cos(-rad);
  const v8 = Math.sin(-rad);
  const v9 = v6 * v7 - v6 * v8;
  const v10 = v9 * v8 + v6 * v7;
  return [
    [c * s, -sn * s, 0, s * c * v9 + s * -sn * v10 + (ox - 0.5)],
    [sn * s, c * s, 0, s * sn * v9 + s * c * v10 + (oy - 0.5)],
  ];
}

// ---- The compositing shader -----------------------------------------------------
const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Styles (CS2 0-based): 0 solid, 1 hydrographic, 2 spraypaint, 3 anodized,
// 4 anodized multi, 5 anodized airbrushed, 6 custom, 7 patina, 8 gunsmith.
const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

uniform sampler2D tPattern, tWear, tGrunge, tMasks, tAO, tBaseColor, tBaseRM, tMagMask;
uniform sampler2D tOverlay, tOverlayMask;
uniform bool uHasOverlay;
uniform int uOverlayBlend, uOverlayMaskMode;
uniform float uOverlayStrength, uOverlayBrightness;
uniform vec4 uOvX0, uOvX1;
uniform int uOverlayUv; // 0 = mesh uv, 1 = pattern uv, 2 = the overlay's own xform
uniform sampler2D tPaintRough, tPaintMetal;
uniform bool uHasRoughTex, uHasMetalTex;
uniform vec4 uPatX0, uPatX1, uWearX0, uWearX1, uGrgX0, uGrgX1;
uniform vec3 uC0, uC1, uC2, uC3;
// Masks are per-weapon composite inputs. When they're absent the sampler falls
// back to black, and black means "no paint here" to every mask-gated branch —
// so a weapon with no extracted inputs strips to bare metal at ANY float. Treat
// a missing mask as "paint covers this" instead of "paint covers nothing".
uniform bool uHasMasks;
// Same trap as the masks. Cavity drives wear-through, and a real cavity map is
// near 0 across flat surfaces with only crevices high — so wear eats edges
// first, as it should. The fallback texture was a flat 0.5, i.e. "every pixel
// is a deep crevice", which sent the WHOLE weapon past the 0.58 smoothstep at
// once somewhere around 0.45 float: clean at low wear, solid black above it.
// Without a real map, bias low so wear stays subtle and localised to whatever
// the wear texture says, instead of stripping everything.
uniform bool uHasAo;
// Same trap once more: with no weapon inputs, baseRM is the paint's GENERIC
// rough/metal map, and worn areas are driven toward it. Pushing metalness to a
// stand-in value turns worn paint into a mirror, which with no bright
// environment reads as pure black — at wear 0 it never shows because the mix
// weight is 0. Keep the paint's own rough/metal when we have no real map.
uniform bool uHasBaseRM;
const float CAVITY_NO_MAP = 0.2;
uniform vec4 uDurability, uRoughPerColor, uMetalPerColor;
uniform bool uPerColorRough, uPerColorMetal;
uniform float uPaintRough, uPaintMetal;
uniform float uWearAmt, uWearSoft, uColorBrightness;
uniform int uStyle, uMode; // uMode: 0 = albedo, 1 = rough/metal
uniform bool uHalftone; // F_SPRAYPAINT_HALFTONE
uniform bool uHasMag;    // translucent-mag UV mask present
// F_SEPARATE_CHANNEL_INPUTS from the weapon's composite_inputs vmat: selects
// which channel of tAO carries cavity (R when separate, B when pre-packed).
uniform bool uSeparateChannels;

vec2 xf(vec2 uv, vec4 r0, vec4 r1) { return vec2(dot(uv, r0.xy) + r0.w, dot(uv, r1.xy) + r1.w); }
float maxc(vec3 v) { return max(v.x, max(v.y, v.z)); }
float mix4(vec4 v, vec3 m) { return mix(mix(mix(v.x, v.y, m.r), v.z, m.g), v.w, m.b); }

void main() {
  vec4 ao4 = texture(tAO, vUv);       // sRGB-decoded rgb; alpha stays linear
  // MEASURED: with no weapon inputs the CDN hands back a 1x1 placeholder whose
  // every channel — alpha included — is 0.502. noPaint is read from that alpha
  // and means "this area has no paint", so a flat 0.5 claims half of every
  // surface is already bare. It sits right under the 0.58 threshold before wear
  // multiplies it, so the whole weapon strips at once: 100% at every float.
  // Absent a real map, noPaint must be 0 (paint covers everything) and cavity
  // low, so wear comes only from the wear texture.
  // Cavity is B, not R. MEASURED against the extracted p90 inputs: R is a soft
  // AO bake (mean 0.36-0.60) and reading it as cavity pushed the wear signal
  // over the 0.58 threshold almost immediately — 6% of painted area already
  // stripped at Factory New, and pinned at ~35% from wear 0.25 all the way to
  // 0.9, so the wear slider did nothing across most of its range. B is the real
  // cavity map (mean 0.09, near-zero on flats with only crevices bright, which
  // is what the note below describes) and yields 0.2% stripped at Factory New
  // rising smoothly to 27% at Battle-Scarred.
  // Cavity channel is packing-dependent — see WeaponInputs.separateChannels.
  // Separate-channel (HD) maps put cavity in R and leave B at 0; pre-packed
  // Source1 (legacy) maps put it in B.
  float cavity = uHasAo ? (uSeparateChannels ? ao4.r : ao4.b) : CAVITY_NO_MAP;
  float flAo = uHasAo ? ao4.g : 1.0;
  // noPaint = the AO map's alpha: the parts that take no paint (sights, muzzle
  // brake, trigger, rails), which stay bare metal at every float.
  //
  // This was briefly pinned to 0.0 on the reasoning that a real paint mask
  // would concentrate on INWARD-facing geometry, and this one does the
  // opposite (alpha>0.5 covers 38.2% of outward-facing texels vs 21.2% of
  // inward). That inference was backwards: unpainted hardware is exterior and
  // visible, so an outward bias is evidence FOR the mask, not against it.
  // Pinning it to 0 painted the sights and muzzle brake in the skin's camo and
  // cost most of the weapon's tonal range — P90 | Desert Halftone measured 26.6%
  // relative contrast with 2.4% dark pixels against a reference of 40.3% / 13.1%;
  // restoring the mask brings that to 30.2% / 6.6%.
  //
  // ao.a was ALSO briefly gated by base metalness — ao.a * smoothstep(0.5, 0.8,
  // baseRM.g) — on the theory that it over-marks, covering body the game paints
  // as well as true hardware. That gate is now removed, and it was the cause of
  // "the black metal parts render as camo".
  //
  // Why it was wrong, MEASURED on the P90's real inputs: the gate keys on
  // METALNESS, but a weapon's unpainted hardware is largely POLYMER — sight
  // towers, barrel shroud, rails. Median baseRM.g *inside* the ao.a region is
  // 0.000. So the gate discarded 29.1 of the 32.2 percentage points the mask
  // marks, leaving noPaint at 1.8% coverage: every polymer part took paint, and
  // the only texels that survived were the high-metalness printed serial
  // markings, which then floated on the camo as bare grey glyphs.
  //
  // Removing it, measured through runViewer against the CDN reference
  // (relative contrast / dark-pixel share, reference = 41.3% / 15.4%):
  //   gated   30.2% / 4.3%   mean luma 113.6
  //   ungated 33.8% / 8.5%   mean luma 106.7   (reference mean 105.3)
  // and all 9 fixtures still pass. The earlier in-game sweep that chose 0.5
  // was run while the HD body was being fed LEGACY composite inputs (see
  // loadWeaponInputs), so it was tuning a gate to compensate for a mismatched
  // mask — with the correct inputs the gate is not needed.
  //
  // The translucent mag is handled separately below: its texels render the
  // PAINT seen through smoked plastic, i.e. slightly darkened — not the opaque
  // interior detail, and not bare.
  vec4 masks = texture(tMasks, vUv);
  float noPaint = uHasAo ? ao4.a : 0.0;
  float magT = uHasMag ? texture(tMagMask, vUv).r : 0.0;
  float wearTex = texture(tWear, xf(vUv, uWearX0, uWearX1)).r;
  vec4 grungeRaw = texture(tGrunge, xf(vUv, uGrgX0, uGrgX1));
  vec2 patUv = xf(vUv, uPatX0, uPatX1);
  vec4 pattern = texture(tPattern, patUv);

  float dur = mix4(uDurability, masks.rgb);

  // Wear-through signal (CS:GO structure + CS2 durability/softness).
  float blend = noPaint + wearTex * cavity;
  blend *= uWearAmt * 6.0 + 1.0;

  if (uStyle == 1 || uStyle == 4 || uStyle == 6 || uStyle == 8) {
    float cuttable = 1.0;
    if (uStyle == 1 || uStyle == 4) cuttable = 1.0 - clamp(masks.g + masks.b, 0.0, 1.0);
    // mid-alpha bands in the pattern cut through immediately
    blend += smoothstep(0.5, 0.6, pattern.a) * smoothstep(1.0, 0.9, pattern.a);
    if (uStyle == 4) {
      pattern.a = clamp(pattern.a * 2.0, 0.0, 1.0);
    } else if (uStyle == 8) {
      blend *= max(1.0 - cuttable, smoothstep(0.0, 0.5, pattern.a));
      pattern.a = mix(pattern.a, clamp(pattern.a * 2.0, 0.0, 1.0), masks.r);
    } else {
      blend *= max(1.0 - cuttable, smoothstep(0.0, 0.5, pattern.a)); // indestructible paint
    }
  }

  // Spray/hydrographic paint wears off in layers.
  vec3 paintEdgeLayers = vec3(1.0);
  if (uStyle == 1 || uStyle == 2) {
    vec3 spread = vec3(0.06) * uWearAmt;
    spread.y *= 2.0;
    spread.z *= 3.0;
    // These are DESCENDING ramps: full paint below the threshold, gone above it.
    // They were written as smoothstep(hi, lo, x) — which is undefined behaviour,
    // the GLSL spec requires edge0 < edge1 — so the GPU was free to return
    // anything, and whatever it returned multiplies into pm below and mutes
    // the paint-by-number selection. Symptom on P90 | Desert Halftone: the
    // composite collapsed toward the middle palette entries, giving 16%
    // relative contrast and ZERO dark pixels where the reference render has 40%
    // and 13%. Written as 1 - smoothstep(lo, hi, x), which is the same curve
    // and is defined.
    paintEdgeLayers.x = 1.0 - smoothstep(0.56 - spread.x, 0.58, blend);
    paintEdgeLayers.y = 1.0 - smoothstep(0.54 - spread.y, 0.56 - spread.x, blend);
    paintEdgeLayers.z = 1.0 - smoothstep(0.52 - spread.z, 0.54 - spread.y, blend);
  }

  blend *= dur;
  float soft = uWearSoft * dur;
  float preBlend = blend;

  if (uStyle == 7) {
    // Antiqued: paint everywhere the mask says metal, regardless of float.
    blend = 1.0 - step(noPaint, 0.996) * masks.r;
  } else if (uStyle == 8) {
    blend = mix(smoothstep(0.58 - soft, 0.68 + soft, blend), blend, masks.r);
    blend = mix(blend, 1.0 - step(preBlend, 0.996), masks.r);
  } else {
    blend = smoothstep(0.58 - soft, 0.68 + soft, blend);
  }

  // Anodized family: chipped edges expose bare metal, paint region = masks.r.
  float anoEdges = 0.0;
  if (uStyle == 3 || uStyle == 4 || uStyle == 5) {
    anoEdges = smoothstep(0.0, 0.01, blend);
    // masks.r is the paint region. Absent, it reads as 0 = "no paint anywhere"
    // and strips the whole weapon at any float, so treat missing as covered.
    blend = clamp(1.0 + blend - (uHasMasks ? masks.r : 1.0), 0.0, 1.0);
  }

  // Grunge shows in cavities and grows with wear (alpha rides along for the
  // roughness boost).
  vec4 grunge = mix(vec4(1.0), grungeRaw, pow(1.0 - cavity, 4.0) * 0.25 + 0.75 * uWearAmt);

  // ---- Rough/metal output ------------------------------------------------------
  if (uMode == 1) {
    float roughPaint = uPerColorRough ? mix4(uRoughPerColor, masks.rgb) : uPaintRough;
    if (uHasRoughTex) roughPaint = texture(tPaintRough, patUv).r;
    float metalPaint = uPerColorMetal ? mix4(uMetalPerColor, masks.rgb) : uPaintMetal;
    if (uHasMetalTex) metalPaint = texture(tPaintMetal, patUv).r;
    if (uStyle == 3 || uStyle == 4 || uStyle == 5) {
      // anodized dye is metallic; chipped edges are bare rough aluminum
      metalPaint = max(metalPaint, 1.0 - anoEdges * 0.15);
      roughPaint = mix(roughPaint, 0.4, anoEdges);
    }
    if (uStyle == 7) metalPaint = max(metalPaint, masks.r);
    if (uStyle == 8) metalPaint = max(metalPaint, masks.r * (1.0 - blend));
    vec4 baseRM = texture(tBaseRM, vUv);
    float wornRough = uHasBaseRM ? baseRM.r : 0.75; // bare metal is fairly rough
    float wornMetal = uHasBaseRM ? baseRM.g : metalPaint;
    float rough = mix(min(1.0, roughPaint + (1.0 - grunge.a) * uWearAmt * uWearAmt * 0.5), wornRough, blend);
    float metal = mix(metalPaint, wornMetal, blend);
    outColor = vec4(0.0, rough, metal, 1.0);
    return;
  }

  // ---- Albedo output -------------------------------------------------------------
  vec3 cPaint = uC0;

  if (uStyle == 0) {
    cPaint = mix(cPaint, uC1, masks.r);
    cPaint = mix(cPaint, uC2, masks.g);
    cPaint = mix(cPaint, uC3, masks.b);
  } else if (uStyle == 1 || uStyle == 4 || uStyle == 2 || uStyle == 5) {
    vec3 pm = pattern.rgb;
    // F_SPRAYPAINT_HALFTONE: the pattern's alpha is a halftone dot SCREEN and
    // the colour channels are compared against it, print-style, rather than
    // used as smooth mix weights. This is what produces the crisp posterised
    // camo with dot-dithered edges. Without it the raw channels (which never
    // reach 0 or 1 on these skins) blend every palette entry toward the
    // middle: P90 | Desert Halftone measured 16.4% relative contrast with 0%
    // dark pixels vs its reference's dotted stripes; thresholding against
    // 1-alpha measures 25.2% / 11.1%, matching the official look. Verified
    // against the raw pattern texture offline before shipping — the earlier
    // multiplicative guess (pm *= a) measured WORSE than baseline.
    if (uStyle == 2 && uHalftone) {
      // Full-strength threshold on purpose: softening it (swept at 0.65/0.4
      // against the in-game capture) loses the stripe contrast the reference
      // has. The dots are REAL — Valve's own renders show them.
      pm = clamp((pm - (1.0 - pattern.a) + 0.05) / 0.1, 0.0, 1.0);
    }
    if (uStyle == 2) pm *= paintEdgeLayers; // spray wears in layers
    cPaint = mix(mix(mix(uC0, uC1, pm.r), uC2, pm.g), uC3, pm.b);
    if (uStyle != 2) {
      cPaint = mix(cPaint, uC2, masks.g);
      cPaint = mix(cPaint, uC3, masks.b);
    }
  } else if (uStyle == 6) {
    cPaint = pattern.rgb;
  } else if (uStyle == 7 || uStyle == 8) {
    float flGrunge = grungeRaw.r * grungeRaw.g * grungeRaw.b;
    float patinaBlend = smoothstep(0.1, 0.2, wearTex * flAo * cavity * cavity * uWearAmt);
    float oilRub = smoothstep(0.0, 0.15, clamp(cavity * flAo - uWearAmt * 0.1, 0.0, 1.0) - flGrunge + 0.08);
    vec3 cPatina = mix(uC1, uC2, uWearAmt);
    vec3 cOilRub = mix(uC1, uC3, sqrt(uWearAmt));
    cPatina = mix(cOilRub, cPatina, oilRub) * pattern.rgb;
    float patternLum = dot(pattern.rgb, vec3(0.3, 0.59, 0.11));
    cPatina = mix(cPatina, uC0 * patternLum, patinaBlend);
    cPaint = uStyle == 7 ? cPatina : mix(pattern.rgb, cPatina, masks.r);
  }

  // ---- Overlay layer -----------------------------------------------------------
  // CONFIRMED from the shader's FEATURES block: F_OVERLAY_MASK is a 0..8 mask
  // SOURCE selector (not a bitfield), the overlay has its own UV interpolator
  // with three sources, g_tOverlay is RGBA read as sRGB while g_tOverlayMask is
  // single-channel read RAW, and overlay durability folds into wear.
  //
  // NOT CONFIRMED: the blend functions themselves. GameTracking only ships one
  // compiled variant of this shader and it is a no-overlay compile, so modes
  // "Color" (1) and "Layer" (4) have no published math. Normal/Multiply/Add are
  // implemented as their standard definitions.
  //
  // Mode 1 was first read literally as the W3C "color" blend (source hue+chroma
  // over backdrop luminance). That is wrong in the direction that matters:
  // these overlays are near-greyscale silhouette art (branch_silhouettes,
  // scratches, grain), so taking chroma FROM the source stripped the paint's
  // colour — Five-SeveN | Autumn Thicket rendered pale grey-blue instead of its
  // real brown-with-black-branches. Inverted to W3C "luminosity": the overlay
  // supplies light/dark, the paint keeps its hue. Still INFERRED, and still the
  // one worth checking against a real .vcs decompile, but it now matches the
  // reference art instead of contradicting it.
  if (uHasOverlay) {
    vec2 ovUv = uOverlayUv == 2 ? xf(vUv, uOvX0, uOvX1) : (uOverlayUv == 1 ? patUv : vUv);
    vec4 ov = texture(tOverlay, ovUv);
    float gate;
    if (uOverlayMaskMode == 0)      gate = 1.0;
    else if (uOverlayMaskMode == 1) gate = (1.0 - masks.r) * (1.0 - masks.g) * (1.0 - masks.b);
    else if (uOverlayMaskMode == 2) gate = masks.r;
    else if (uOverlayMaskMode == 3) gate = masks.g;
    else if (uOverlayMaskMode == 4) gate = masks.b;
    else if (uOverlayMaskMode == 5) gate = max(masks.r, max(masks.g, masks.b));
    else if (uOverlayMaskMode == 6) gate = 1.0 - noPaint;
    else if (uOverlayMaskMode == 7) gate = pattern.a;
    else                            gate = texture(tOverlayMask, ovUv).r;
    float oa = clamp(gate * ov.a * uOverlayStrength, 0.0, 1.0);
    vec3 src = ov.rgb * uOverlayBrightness;
    vec3 blended;
    if (uOverlayBlend == 2) blended = cPaint * src;
    else if (uOverlayBlend == 3) blended = cPaint + src;
    else if (uOverlayBlend == 1) {
      // W3C "luminosity": keep the paint's colour, take the overlay's light/dark.
      float lumB = dot(cPaint, vec3(0.3, 0.59, 0.11));
      float lumS = dot(src, vec3(0.3, 0.59, 0.11));
      blended = clamp(cPaint + (lumS - lumB), 0.0, 1.0);
    } else blended = src;
    cPaint = mix(cPaint, blended, oa);
  }

  if (anoEdges > 0.0) {
    cPaint = mix(cPaint, vec3(0.05), anoEdges);
    grunge.rgb = mix(grunge.rgb, vec3(1.0), anoEdges);
  }

  vec3 cRaw = cPaint * uColorBrightness;
  vec3 colG = cRaw * grunge.rgb;

  // CS2 "albedo levels": worn paint drifts toward a normalized, luminance-
  // clamped version of itself — dulls before it strips.
  float metalHint = uPerColorMetal ? mix4(uMetalPerColor, masks.rgb) : uPaintMetal;
  vec3 nrm = normalize(max(vec3(0.0003), colG));
  vec3 lvl = mix(vec3(0.045, 1.32193, 1.0), vec3(0.08, 1.32193, 1.0), metalHint);
  vec3 adj = nrm * mix(min(lvl.x, dot(cRaw, vec3(0.2125, 0.7154, 0.0721))), lvl.z,
                       clamp(pow(maxc(colG), lvl.y), 0.0, 1.0)) / maxc(nrm);
  vec3 finalPaint = mix(colG, adj, uWearAmt);

  vec3 base = texture(tBaseColor, vUv).rgb;
  // Linear out — the albedo RT is SRGB8 so the GPU encodes on write.
  // Translucent magazine: the paint shows THROUGH the smoked plastic, so the
  // whole result darkens slightly there rather than exposing interior detail.
  outColor = vec4(mix(finalPaint, base, blend) * mix(vec3(1.0), vec3(0.72, 0.70, 0.68), magT), 1.0);
}
`;

// ---- Texture loading ------------------------------------------------------------
// One shared cache across composites; colorSpace flags follow the shader's
// SrgbRead() declarations so the GPU linearizes exactly what the game does.
const texCache = new Map<string, Promise<import("three").Texture | null>>();
function loadTex(THREE: THREE, url: string, opts: { srgb: boolean; wrap: boolean }): Promise<import("three").Texture | null> {
  const key = `${url}|${opts.srgb ? "s" : "l"}|${opts.wrap ? "w" : "c"}`;
  let cached = texCache.get(key);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(url)
      .then((t) => {
        t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = opts.wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.flipY = false;
        return t;
      })
      .catch(() => {
        failedUrls.add(url);
        return null;
      });
    texCache.set(key, cached);
  }
  return cached;
}

function fallbackTex(THREE: THREE, rgba: [number, number, number, number], srgb: boolean) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface CompositeResult {
  albedo: import("three").Texture;
  rm: import("three").Texture; // G = roughness, B = metalness (three's packing)
  release: () => void;
}

// Composited (albedo, rough/metal) pairs are expensive (two 2k RTs) and are
// GPU resources OWNED BY ONE GL CONTEXT — they can only be reused by the
// renderer that produced them, so the refcounted LRU is keyed per renderer.
// (Each viewer mount builds its own renderer; several can be live at once.)
// A 2k composite is two RGBA render targets with mipmaps — roughly 45MB of GPU
// memory for the pair. Desktop absorbs that; a phone holding a few of them
// alongside the GLB and env map runs into the per-tab ceiling and gets the tab
// killed. Halving to 1k quarters the cost, and at phone screen sizes the
// detail difference isn't visible anyway.
const MAX_COMPOSITE_SIZE =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches ? 1024 : 2048;

type CacheEntry = { result: Omit<CompositeResult, "release">; refs: number; dispose: () => void };
type RendererCache = Map<string, CacheEntry>;
const compositeCaches = new WeakMap<import("three").WebGLRenderer, RendererCache>();
const COMPOSITE_CACHE_MAX = 4;

function cacheFor(renderer: import("three").WebGLRenderer): RendererCache {
  let cache = compositeCaches.get(renderer);
  if (!cache) {
    cache = new Map();
    compositeCaches.set(renderer, cache);
  }
  return cache;
}

function evictIfNeeded(cache: RendererCache) {
  while (cache.size > COMPOSITE_CACHE_MAX) {
    let victim: string | null = null;
    for (const [k, v] of cache) {
      if (v.refs <= 0) {
        victim = k;
        break;
      }
    }
    if (!victim) return; // everything is in use
    cache.get(victim)!.dispose();
    cache.delete(victim);
  }
}

/** Dispose every composite this renderer owns. Call on viewer teardown — the
 *  entries are GPU resources tied to a context that is about to die, and
 *  evictIfNeeded only ever frees what's over the cache limit, so without this
 *  up to COMPOSITE_CACHE_MAX render-target pairs stay resident until GC. */
export function dropCompositeCache(renderer: import("three").WebGLRenderer) {
  const cache = compositeCaches.get(renderer);
  if (!cache) return;
  for (const entry of cache.values()) entry.dispose();
  cache.clear();
  compositeCaches.delete(renderer);
}

let quadGeom: import("three").BufferGeometry | null = null;
let quadMat: import("three").RawShaderMaterial | null = null;

export async function compositePaint(
  three: THREE,
  renderer: import("three").WebGLRenderer,
  def: PaintDef,
  opts: { wear: number; seed: number; weapon?: WeaponInputs | null; model?: string },
): Promise<CompositeResult | null> {
  const THREE = three;
  const wear = Math.min(Math.max(opts.wear, 0), 1);
  const seed = Math.max(0, Math.trunc(opts.seed));
  const wkey = opts.weapon ? (opts.weapon.color ?? "w") : "";
  const key = `${def.pattern ?? "-"}|${def.overlay ?? "-"}|${def.style}|${wear.toFixed(4)}|${seed}|${wkey}`;
  const cache = cacheFor(renderer);
  const hit = cache.get(key);
  if (hit) {
    hit.refs++;
    // refresh LRU order
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit.result, release: makeRelease(cache, key) };
  }

  // Per-style pattern colorspace: mask styles read linear; custom paint jobs,
  // patina and gunsmith read the pattern as color (sRGB).
  const patternIsColor = def.style === 6 || def.style === 7 || def.style === 8;
  const urlOf = async (p?: string) => (p ? await paintTextureUrl(p) : null);
  const magUrl = opts.weapon?.mag;
  const [patternUrl, wearUrl, grungeUrl, masksUrl, aoUrl, colorUrl, rmUrl, roughTexUrl, metalTexUrl, overlayUrl, overlayMaskUrl] = await Promise.all([
    urlOf(def.pattern),
    urlOf(def.wearMask),
    urlOf(def.grunge),
    opts.weapon?.masks ?? urlOf(def.masks),
    opts.weapon?.ao ?? urlOf(def.ao),
    opts.weapon?.color ?? urlOf(def.baseColor),
    opts.weapon?.metalness ?? urlOf(def.baseRM),
    urlOf(def.paintRoughnessTex),
    urlOf(def.paintMetalnessTex),
    urlOf(def.overlay),
    urlOf(def.overlayMask),
  ]);
  const magTex = magUrl ? await loadTex(THREE, magUrl, { srgb: false, wrap: false }) : null;
  const [pattern, wearT, grunge, masks, ao, baseColor, baseRM, roughTex, metalTex, overlayTex, overlayMaskTex] = await Promise.all([
    patternUrl ? loadTex(THREE, patternUrl, { srgb: patternIsColor, wrap: true }) : null,
    wearUrl ? loadTex(THREE, wearUrl, { srgb: false, wrap: true }) : null,
    grungeUrl ? loadTex(THREE, grungeUrl, { srgb: true, wrap: true }) : null,
    masksUrl ? loadTex(THREE, masksUrl, { srgb: false, wrap: false }) : null,
    aoUrl ? loadTex(THREE, aoUrl, { srgb: true, wrap: false }) : null,
    colorUrl ? loadTex(THREE, colorUrl, { srgb: true, wrap: false }) : null,
    rmUrl ? loadTex(THREE, rmUrl, { srgb: false, wrap: false }) : null,
    roughTexUrl ? loadTex(THREE, roughTexUrl, { srgb: false, wrap: true }) : null,
    metalTexUrl ? loadTex(THREE, metalTexUrl, { srgb: false, wrap: true }) : null,
    // g_tOverlay declares SrgbRead(true); g_tOverlayMask declares SrgbRead(false).
    overlayUrl ? loadTex(THREE, overlayUrl, { srgb: true, wrap: true }) : null,
    overlayMaskUrl ? loadTex(THREE, overlayMaskUrl, { srgb: false, wrap: true }) : null,
  ]);

  // Solid-style paints legitimately have no pattern; anything else without
  // one has nothing to composite.
  if (!pattern && !overlayTex && def.style !== 0 && !def.colors.length) return null;

  const sv = seededVisuals(def, seed);
  // Spray/anodized-air scale by weapon length; everything else by uvScale.
  const weaponLength = opts.weapon?.weaponLength ?? def.weaponLength;
  const uvScale = opts.weapon?.uvScale ?? def.uvScale;
  const sizeScale = def.ignoreWeaponSizeScale ? 1 : def.style === 2 || def.style === 5 ? weaponLength / 36 : uvScale;
  // Pattern scale does NOT take the weaponLength/36 multiply that wear and
  // grunge take. Verified against an in-game capture of P90 | Desert Halftone:
  // with the multiply (x0.545 for the P90) the stripes rendered ~1.8x too
  // coarse; neutralising it (2.75 repeats, the vmat's own patternScale) matches
  // the in-game stripe density, and x3.37 (the divide-instead hypothesis) is
  // visibly too fine. Wear/grunge keep sizeScale — their response verified
  // separately across the wear sweep.
  const patSizeScale = def.ignoreWeaponSizeScale ? 1 : def.style === 2 || def.style === 5 ? 1 : uvScale;
  const patX = texXform(sv.patternRot, def.patternScale * patSizeScale, sv.patternOffsetX, sv.patternOffsetY);
  const wearX = texXform(sv.wearRot, sv.wearScale * sizeScale, sv.wearOffsetX, sv.wearOffsetY);
  const grgX = texXform(sv.grungeRot, sv.grungeScale * sizeScale, sv.grungeOffsetX, sv.grungeOffsetY);

  const imgW = (t: import("three").Texture | null) => (t?.image as { width?: number } | undefined)?.width ?? 0;
  const size = Math.min(Math.max(imgW(pattern), imgW(baseColor), 1024), MAX_COMPOSITE_SIZE);

  quadGeom ??= (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    return g;
  })();
  quadMat ??= new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tPattern: { value: null },
      tWear: { value: null },
      tGrunge: { value: null },
      tMasks: { value: null },
      tAO: { value: null },
      tBaseColor: { value: null },
      tBaseRM: { value: null },
      tPaintRough: { value: null },
      tPaintMetal: { value: null },
      uHasRoughTex: { value: false },
      uHasMetalTex: { value: false },
      uPatX0: { value: new THREE.Vector4() },
      uPatX1: { value: new THREE.Vector4() },
      uWearX0: { value: new THREE.Vector4() },
      uWearX1: { value: new THREE.Vector4() },
      uGrgX0: { value: new THREE.Vector4() },
      uGrgX1: { value: new THREE.Vector4() },
      uHasMasks: { value: true },
      uHasAo: { value: true },
      uHasBaseRM: { value: true },
      tOverlay: { value: null as unknown as import("three").Texture },
      tOverlayMask: { value: null as unknown as import("three").Texture },
      uHasOverlay: { value: false },
      uOverlayBlend: { value: 0 },
      uOverlayMaskMode: { value: 0 },
      uOverlayStrength: { value: 1 },
      uOverlayBrightness: { value: 1 },
      uOverlayUv: { value: 0 },
      uOvX0: { value: new THREE.Vector4(1, 0, 0, 0) },
      uOvX1: { value: new THREE.Vector4(0, 1, 0, 0) },
      uC0: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uC1: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uC2: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uC3: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uDurability: { value: new THREE.Vector4(1, 1, 1, 1) },
      uRoughPerColor: { value: new THREE.Vector4() },
      uMetalPerColor: { value: new THREE.Vector4() },
      uPerColorRough: { value: false },
      uPerColorMetal: { value: false },
      uPaintRough: { value: 0.6 },
      uPaintMetal: { value: 0 },
      uWearAmt: { value: 0 },
      uWearSoft: { value: 0 },
      uColorBrightness: { value: 1 },
      uStyle: { value: 0 },
      uHalftone: { value: false },
      tMagMask: { value: null as unknown as import("three").Texture },
      uHasMag: { value: false },
      uSeparateChannels: { value: false },
      uMode: { value: 0 },
    },
  });

  const u = quadMat.uniforms;
  const white = fallbackTex(THREE, [255, 255, 255, 255], false);
  const black = fallbackTex(THREE, [0, 0, 0, 255], false);
  // Shader defaults: cavity 0.5, ao 1, noPaint 0 / rough 0.5, metal 0.
  const aoDefault = fallbackTex(THREE, [188, 255, 128, 0], true);
  const rmDefault = fallbackTex(THREE, [128, 0, 0, 255], false);
  const grayDefault = fallbackTex(THREE, [110, 110, 112, 255], true);
  // Name every fallback. `pattern` missing turns a skin white; `baseColor`
  // missing means worn metal is a flat grey that is nothing like the weapon.
  // Both read as "the wear maths is broken" if you can't see which one it was.
  const modelKey = (opts as { model?: string }).model ?? "(unknown)";
  // Overlay-only finishes legitimately have no pattern — saying "renders white"
  // for those sends you hunting a texture that was never meant to exist.
  if (!pattern && !overlayTex) noteMissing(modelKey, "pattern (skin renders untextured/white)");
  if (overlayTex) noteMissing(modelKey, `overlay finish (blend mode ${def.overlayBlendMode}, mask mode ${def.overlayMaskMode})`);
  if (!opts.weapon?.ao) noteMissing(modelKey, "weapon ao/cavity (using the generic map — wear will be uniform)");
  if (!masks) noteMissing(modelKey, "masks");
  if (!opts.weapon?.color) noteMissing(modelKey, "weapon baseColor (worn areas show a generic surface)");
  if (!baseRM) noteMissing(modelKey, "baseRM");
  const diag = diagByModel.get(modelKey);
  if (diag?.missing.length && !warnedModels.has(modelKey)) {
    warnedModels.add(modelKey);
    diag.failedTextures = [...failedUrls];
    console.warn(`[paint] ${modelKey}: compositing with defaults — ${diag.missing.join(", ")}`);
  }
  u.tPattern.value = pattern ?? white;
  u.tWear.value = wearT ?? black;
  u.tGrunge.value = grunge ?? white;
  u.tMasks.value = masks ?? black;
  u.uHasMasks.value = !!masks;
  // NOT `!!ao`: with no weapon inputs the paint's GENERIC ao texture loads in
  // its place, so a texture always exists. What matters is whether it is this
  // WEAPON's cavity map — the generic one is roughly uniform, and a uniform
  // cavity means every pixel wears at the same instant instead of edges first.
  u.uHasAo.value = !!opts.weapon?.ao;
  u.uHasBaseRM.value = !!opts.weapon?.metalness;
  u.tOverlay.value = overlayTex ?? white;
  u.tOverlayMask.value = overlayMaskTex ?? white;
  u.uHasOverlay.value = !!overlayTex;
  u.uOverlayBlend.value = def.overlayBlendMode;
  u.uOverlayMaskMode.value = def.overlayMaskMode;
  u.uOverlayStrength.value = def.overlayStrength;
  u.uOverlayBrightness.value = def.overlayBrightness;
  u.uOverlayUv.value = def.overlayUsesUniqueUv ? 2 : def.overlayUsesPatternUv ? 1 : 0;
  {
    // Overlay placement is authored per-skin, not seeded — the seed pipeline
    // has no overlay concept, so this uses the vmat constants directly.
    const ovX = texXform(def.overlayRot, def.overlayScale * sizeScale, def.overlayOffset[0] ?? 0, def.overlayOffset[1] ?? 0);
    u.uOvX0.value.fromArray(ovX[0]);
    u.uOvX1.value.fromArray(ovX[1]);
  }
  u.tAO.value = ao ?? aoDefault;
  u.tBaseColor.value = baseColor ?? grayDefault;
  u.tBaseRM.value = baseRM ?? rmDefault;
  u.tPaintRough.value = roughTex ?? white;
  u.tPaintMetal.value = metalTex ?? white;
  u.uHasRoughTex.value = !!roughTex;
  u.uHasMetalTex.value = !!metalTex;
  u.uPatX0.value.fromArray(patX[0]);
  u.uPatX1.value.fromArray(patX[1]);
  u.uWearX0.value.fromArray(wearX[0]);
  u.uWearX1.value.fromArray(wearX[1]);
  u.uGrgX0.value.fromArray(grgX[0]);
  u.uGrgX1.value.fromArray(grgX[1]);
  const cols = def.colors;
  u.uC0.value.fromArray(cols[0] ?? [0.5, 0.5, 0.5]);
  u.uC1.value.fromArray(cols[1] ?? cols[0] ?? [0.5, 0.5, 0.5]);
  u.uC2.value.fromArray(cols[2] ?? cols[0] ?? [0.5, 0.5, 0.5]);
  u.uC3.value.fromArray(cols[3] ?? cols[0] ?? [0.5, 0.5, 0.5]);
  u.uDurability.value.fromArray(def.durability);
  u.uPerColorRough.value = !!def.roughPerColor;
  if (def.roughPerColor) u.uRoughPerColor.value.fromArray(def.roughPerColor);
  u.uPerColorMetal.value = !!def.metalPerColor;
  if (def.metalPerColor) u.uMetalPerColor.value.fromArray(def.metalPerColor);
  u.uPaintRough.value = def.roughness;
  u.uPaintMetal.value = def.metalness;
  u.uWearAmt.value = wear;
  u.uWearSoft.value = def.wearSoftness;
  u.uColorBrightness.value = def.colorBrightness;
  u.uStyle.value = def.style;
  u.uHalftone.value = def.halftone;
  u.tMagMask.value = magTex ?? black;
  u.uHasMag.value = !!magTex;
  // Only meaningful alongside a real weapon ao map; the generic fallback is a
  // Source1-style pack.
  u.uSeparateChannels.value = !!opts.weapon?.ao && !!opts.weapon?.separateChannels;

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(quadGeom, quadMat));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const makeRT = (srgb: boolean) => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    rt.texture.flipY = false;
    // Paint UV = TEXCOORD_0: CS2's composite output REPLACES g_tColor in the
    // weapon material, which binds its textures with texCoord 0 (verified in
    // the GLB json). TEXCOORD_1 is the STICKER uv set — sampling paint
    // through it scatters the pattern into patchwork.
    rt.texture.channel = 0;
    // Some faces carry UVs outside [0,1] (mirrored second side) — clamping
    // would smear edge texels into streaks.
    rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
    return rt;
  };
  const prevRT = renderer.getRenderTarget();
  const albedoRT = makeRT(true);
  u.uMode.value = 0;
  renderer.setRenderTarget(albedoRT);
  renderer.render(scene, camera);
  const rmRT = makeRT(false);
  u.uMode.value = 1;
  renderer.setRenderTarget(rmRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevRT);

  const dispose = () => {
    albedoRT.dispose();
    rmRT.dispose();
    for (const t of [white, black, aoDefault, rmDefault, grayDefault]) t.dispose();
  };
  const entry: CacheEntry = { result: { albedo: albedoRT.texture, rm: rmRT.texture }, refs: 1, dispose };
  cache.set(key, entry);
  evictIfNeeded(cache);
  return { ...entry.result, release: makeRelease(cache, key) };
}

function makeRelease(cache: RendererCache, key: string) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = cache.get(key);
    if (entry) {
      entry.refs--;
      evictIfNeeded(cache);
    }
  };
}
