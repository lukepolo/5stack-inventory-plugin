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
  /** F_CASE_HARDENING — Case Hardened, Heat Treated, Blue Gem. Changes what
   *  g_tPattern MEANS: it stops being albedo and becomes the lookup coordinate
   *  into g_tCaseHardeningColorRamp, which supplies all the colour. Read the
   *  pattern of one of these as colour and you render the raw data texture:
   *  Deagle | Heat Treated came out green-and-magenta, which is literally what
   *  its pattern.rgb contains. Requires style 0, 7 or 8 (FeatureRule). */
  caseHardening: boolean;
  /** Whether the paint's normal map should actually be bound. Keyed off the
   *  FLAG, never off the texture's presence — these materials ship a real
   *  g_tNormal even when it is switched off. */
  useNormalMap: boolean;
  caseHardeningRamp?: string;
  chPatternInfluence: number;
  chGeometricInfluence: number;
  chRampOffset: number;
  /** g_nColorAdjustmentMode: when 1, colour brightness applies everywhere
   *  rather than only inside the paint mask. */
  colorAdjustmentMode: number;
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
  /** g_fOverlayDurability — folds into the wear curve: an overlay can make the
   *  paint under it wear faster or slower, and in "Layer" mode erodes itself. */
  overlayDurability: number;
  overlayScale: number;
  overlayRot: number;
  overlayOffset: number[];
  overlayUsesPatternUv: boolean;
  overlayUsesUniqueUv: boolean;
  grunge?: string;
  masks?: string;
  /** True when `masks` came from the skin's own g_tPaintByNumberMasks rather
   *  than a template default. A skin-authored mask is drawn against THIS
   *  finish's artwork and must beat the weapon's generic extracted mask —
   *  see the pick in compositePaint. 269 of 1479 materials ship one. */
  masksSkinSpecific: boolean;
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
  /** g_vSprayBlend / g_bBiasSpray — the projected styles (2, 5) only. The pair
   *  (material .x, .y — g_vSprayBlend is a float2) weights the triplanar mix via
   *  the CPU-packed g_vSprayBiasBlend: [0] scales the A->B mix by |n.y|^7, [1]
   *  scales the ->C mix by |n.z|^7. The bias re-applies an sRGB encode to the
   *  surface normal before unpacking, which pushes every component positive so
   *  the spray reads as coming from one direction (an airbrush) rather than
   *  symmetrically from both sides. */
  sprayBlend: [number, number];
  biasSpray: boolean;
  /** g_nPatternTextureHorizontal/VerticalSampling — Source 2
   *  RsTextureAddressMode_t (0 wrap, 1 mirror, 2 clamp, 4 mirror-once). Sampler
   *  STATE: declared in the .slang but never read in its body, which is why a
   *  pure shader-math port misses it. Only meaningful for the PROJECTED styles,
   *  where the coordinate leaves [0,1] by design — applying it to paint-UV
   *  sampling regressed AWP | Fade badly (sat 47.9 -> 18.6). 19 catalog
   *  materials set one, and they are almost all Fades plus Deagle | Blaze. */
  patternAddrH: number;
  patternAddrV: number;
  /** F_PEARLESCENCE_MASK / g_tPearlescenceMask and friends. The composite does
   *  NOT shade glitter or pearlescence — those are runtime weapon-shader effects.
   *  What it must do is write the SFX MASK that gates them into the rough/metal
   *  map, which the weapon shader reads back. */
  pearlMask?: string;
  pearlMaskPatternUv: boolean;
  pearlOnMetallicOnly: boolean;
  /** Glitter — a RUNTIME weapon-material effect, not a composite one. These are
   *  read here only so viewer3d can hand them to the shading material; the
   *  compositor itself never uses them (they are not even in its constant
   *  buffer). g_tGlitterNormal is a shared sheet from the paint TEMPLATE, RG =
   *  a 2-channel normal and A = the flake mask, sampled with a POINT sampler. */
  glitterNormal?: string;
  glitterIntensity: number;
  glitterScale: number;
  glitterRainbowBalance: number;
  glitterRainbowSpread: number;
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
      // F_* STATIC COMBOS ARE THE TEMPLATE'S, not the skin's — unless the skin
      // exposes one in its editor UI (m_bExposeExternally), which is how a real
      // authored override presents.
      //
      // A vcompmat also carries BARE F_* integers, and they are per-mutator
      // plumbing that is almost always 0 — not a value anyone chose. Letting
      // them win inverted features the skin obviously uses. MEASURED on AK-47 |
      // Aphrodite: it sets g_bUseOverlay=1, g_bUseOverlayMask=1 and ships a real
      // g_tOverlayMask, yet its bare loose vars say F_OVERLAY_TEXTURE=0 and
      // F_OVERLAY_MASK=0 while the compiled template says 1 and 8 (Dedicated).
      // Taking the 0 turned mask mode into "None" — gate = 1 over the entire
      // weapon — so a 66%-strength MULTIPLY overlay meant to sit inside a small
      // mask was multiplied across the whole gun. That is what dragged its white
      // marble down to olive-brown (measured: cPaint 0.82/0.69/0.57 of patCol,
      // a warm-biased darkening no other term in the path can produce).
      //
      // F_OVERLAY_BLEND_MODE is the counter-example that proves the rule: it IS
      // exposed (m_bExposeExternally, with a friendly value list) and its 2
      // (Multiply) is a genuine authored choice that must still win.
      const lv = looseVal.get(n);
      const exposed = lv?.m_bExposeExternally != null && lv.m_bExposeExternally !== "";
      if (n.startsWith("F_") && !exposed) return tmplInt(n, d);
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
    // An exposed vcompmat slider that was never dragged stores the MIDPOINT of
    // its own declared bounds — that is the material editor's "untouched"
    // signature, and it is exactly how a SEED-VARIED envelope presents. Any
    // other stored value is an authored constant and must be used literally.
    //
    // MEASURED over all 24 materials in the catalog that declare
    // g_flCaseHardeningRampOffset, and the split is clean:
    //   4 have min == max (0 or 1)     — pinned, not a slider at all
    //  16 sit exactly on their midpoint — Heat Treated, Case Hardened, ...
    //   4 sit off it                    — three unrelated skins all storing
    //                                     0.266 over bounds [0,1] (a copied
    //                                     constant, not a coincidence) plus
    //                                     AK-47 | Aphrodite's 0.500949
    // Reading every one of them as a seed envelope is what made Glock | AXIA
    // render green-and-gold: its offset is PINNED at 1, and its ramp's blue
    // lives only in the v=1 row (sampled: (17,129,180) there, (177,182,0) at
    // v=0.5). Same failure on Aphrodite, whose pastels are the v>=0.5 rows.
    const authoredOrSeeded = (name: string, seeded: number): number => {
      const lv = looseVal.get(name);
      const raw = lv?.m_flValueFloatX;
      if (raw == null || raw === "") return seeded;
      const v = Number(raw);
      const lo = lv?.m_flValueFloatX_Min;
      const hi = lv?.m_flValueFloatX_Max;
      if (lo == null || hi == null || lo === "" || hi === "") return v;
      const min = Number(lo);
      const max = Number(hi);
      if (min === max) return v; // pinned by its own bounds
      // Untouched slider => seed envelope; we don't know the draw order yet.
      return Math.abs(v - (min + max) / 2) < 1e-4 ? seeded : v;
    };
    const t = (n: string) => loose.get(n) ?? tex(n);
    return {
      style: int("F_PAINT_STYLE", 0),
      halftone: int("F_SPRAYPAINT_HALFTONE", 0) !== 0,
      // Defaults are the SHADER's own (csgo_customweapon.slang), not the paint
      // templates': PatternInfluence 0.5, GeometricInfluence 1, RampOffset 0.
      // None of the three declares a Range(), so they are not clamped.
      caseHardening: int("F_CASE_HARDENING", 0) !== 0,
      // The shader has NO g_bUseNormalMap — the runtime gate is the static
      // combo F_OVERRIDE_NORMAL; g_bUseNormalMap is the vcompmat's authoring
      // switch that decides whether the compositor compiles that combo in. So
      // the skin's switch wins where it exists, template feature otherwise,
      // which is this loader's normal precedence.
      //
      // MEASURED over sampled materials that declare the switch: 10 have it ON
      // with a real normal, 2 OFF with the flat placeholder — and 9 have it
      // OFF while still shipping a REAL normal map
      // (custom_template_pattern_normal). Binding on texture-presence, as
      // viewer3d did, bump-maps all 9 of those against geometry CS2 shades
      // flat. Same trap as the g_bUseOverlay placeholder — see the rig README.
      useNormalMap: looseVal.has("g_bUseNormalMap")
        ? int("g_bUseNormalMap", 0) !== 0
        : int("F_OVERRIDE_NORMAL", 0) !== 0,
      caseHardeningRamp: t("g_tCaseHardeningColorRamp"),
      chPatternInfluence: flt("g_flCaseHardeningPatternInfluence", 0.5),
      chGeometricInfluence: flt("g_flCaseHardeningGeometricInfluence", 1),
      // NOT read from the material, deliberately. This is the Blue Gem knob:
      // the ramp offset picks which row of the ramp — which colour family —
      // a given item lands on, and on Case Hardened it is SEED-VARIED, which
      // is why two Case Hardened AKs of the same float look nothing alike.
      //
      // The vcompmat's stored 0.5 is the material editor's SLIDER POSITION,
      // not the applied value: it is exactly the midpoint of its own declared
      // bounds (0..1), as is PatternInfluence (0.315 of 0.2..0.43). The
      // params that are genuinely fixed carry m_bExposedVariableIsFixedRange
      // — GeometricInfluence and PatternTexCoordScale do, these two do not,
      // which is the same shape this loader already treats as a seed envelope
      // for g_vPatternTexCoordOffset and g_flPatternTexCoordRotation.
      //
      // Taking 0.5 literally samples the ramp's washed-out middle rows.
      // MEASURED against the official Heat Treated render, hue histogram over
      // 8 buckets (ours -> reference): at 0.5, blue 10.5 -> 23.9 and magenta
      // 12.4 -> 3.8, i.e. the two dominant colours inverted. At 0, blue 21.3,
      // magenta 3.3, grey 49.5 vs 51.1 — every bucket lands. 0 is also the
      // shader's own declared default (no Default() in the .slang).
      //
      // So: pin to the neutral default until the seed DRAW ORDER is known.
      // That order lives in cs_custom_weapon_visualsdata_processor.cpp, not in
      // the shader, so the decompile cannot supply it — see seededVisuals for
      // the sequence this would have to slot into. Until then every seed of a
      // case-hardened skin renders as the same (correct-family) gun.
      //
      // ...but that reasoning only holds for the ones that ARE seed-varied.
      // authoredOrSeeded tells the two apart by the midpoint signature, so a
      // skin with a genuinely fixed offset now gets its real value.
      chRampOffset: authoredOrSeeded("g_flCaseHardeningRampOffset", 0),
      colorAdjustmentMode: int("g_nColorAdjustmentMode", 0),
      pattern: t("g_tPattern"),
      normal: t("g_tNormal"),
      wearMask: t("g_tWear"),
      grunge: t("g_tGrunge"),
      // Paint-by-number materials name their mask atlas g_tPaintByNumberMasks in
      // the vcompmat, and their vmat's g_tMasks is a generic default. Reading
      // g_tMasks first meant those skins coloured against a stand-in mask.
    masks: loose.get("g_tPaintByNumberMasks") ?? t("g_tMasks"),
      masksSkinSpecific: loose.has("g_tPaintByNumberMasks"),
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
      overlayDurability: flt("g_fOverlayDurability", 0),
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
      // g_vSprayBlend is a float2 (csgo_customweapon.slang:689, Default2(1,1)).
      // The shader mixes on g_vSprayBiasBlend.y/.z, but those are NOT this vec's
      // .y/.z — a CPU-side Expression packs them (slang:645):
      //   g_vSprayBiasBlend = float3(g_bBiasSpray||0, g_vSprayBlend.x, g_vSprayBlend.y)
      // so shader .y/.z = material .x/.y. Hence [.x, .y] here. (Reading [.y,.z]
      // is wrong: the material stores a padded vec4 but only .x/.y are real, and
      // .z is padding that merely happens to be 0 for Blaze.)
      sprayBlend: ((v) => [v?.[0] ?? 1, v?.[1] ?? 1])(vec("g_vSprayBlend")) as [number, number],
      biasSpray: int("g_bBiasSpray", 0) !== 0,
      patternAddrH: int("g_nPatternTextureHorizontalSampling", 0),
      patternAddrV: int("g_nPatternTextureVerticalSampling", 0),
      // Keyed off the FLAG, never the texture's presence — same trap as
      // g_bUseOverlay, these materials ship a placeholder mask regardless.
      pearlMask: int("g_bUsePearlescenceMask", 0) !== 0 ? t("g_tPearlescenceMask") : undefined,
      pearlMaskPatternUv: int("g_bPearlescenceMaskUsesPatternUVs", 0) !== 0,
      pearlOnMetallicOnly: int("g_bPearlescentOnMetallicOnly", 0) !== 0,
      glitterNormal: t("g_tGlitterNormal"),
      glitterIntensity: flt("g_fGlitterIntensity", 0),
      glitterScale: flt("g_fGlitterScale", 0),
      glitterRainbowBalance: flt("g_fGlitterRainbowBalance", 0),
      glitterRainbowSpread: flt("g_fGlitterRainbowSpread", 0),
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
  /** g_tPosition — per-texel OBJECT-SPACE position in paint-UV space, and
   *  g_tSurface — the matching object-space normal. Only the PROJECTED paint
   *  styles (2 Spraypaint, 5 Anodized Airbrushed) use them: those build the
   *  pattern coordinate from a triplanar projection of the position rather than
   *  sampling paint UV at all. Extraction v3+ only, and `position` arrives as
   *  .exr (RGBA16161616F), not .png — always take the filename from meta.json. */
  position?: string;
  surface?: string;
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
          position: rel(meta.textures?.position),
          surface: rel(meta.textures?.surface),
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
uniform float uOverlayStrength, uOverlayBrightness, uOverlayDurability;
uniform vec4 uOvX0, uOvX1;
uniform int uOverlayUv; // 0 = mesh uv, 1 = pattern uv, 2 = the overlay's own xform
uniform sampler2D tPaintRough, tPaintMetal;
uniform bool uHasRoughTex, uHasMetalTex;
// Case hardening (F_CASE_HARDENING). tCaseRamp is the 2D colour LUT that
// supplies every colour these finishes have; tPaintNormal is the paint's own
// g_tNormal, sampled here ONLY as a curvature signal for the geometric term
// (most case-hardened skins ship the flat 1x1 default, which makes the edge
// factor a constant — that is correct, not a missing texture).
//
// Encoding caveat: the shader declares g_tNormal as HemiOctIsoRoughness_RG_B
// (ATI2N), so ITS .x/.y are hemi-octahedral coords, whereas the CDN hands us
// an already-decoded RGB tangent-space map (verified: |rgb*2-1| = 1.000 +/-
// 0.001). Identical for the flat default every shipped case-hardened skin
// uses, so it does not bite today — but a case-hardened skin WITH a real
// normal would need the RG re-encoded to match Valve's edge term.
uniform sampler2D tCaseRamp, tPaintNormal;
uniform sampler2D tPearlMask;
uniform bool uHasPearlMask, uPearlPatternUv, uPearlOnMetallicOnly;
uniform bool uCaseHardening;
uniform float uChPat, uChGeo, uChRampOff;
uniform int uColorAdjustMode;
uniform vec4 uPatX0, uPatX1, uWearX0, uWearX1, uGrgX0, uGrgX1;
// ---- Projected styles (2 Spraypaint, 5 Anodized Airbrushed) --------------------
// These do NOT sample the pattern in paint-UV space. CONFIRMED from combo 293:
// the varying every other style uses as the pattern UV is never read, and the
// coordinate is built in the fragment shader from g_tPosition — a per-texel
// OBJECT-SPACE position map — through a triplanar projection weighted by the
// object-space normal in g_tSurface.
//
// Sampling paint UV instead smears an airbrushed graphic across the unwrap,
// which is why Desert Eagle | Blaze had flames on its grip.
// tSurface shares tPaintNormal's sampler unit. SAFE, and not a hack: the
// .slang's FeatureRule requires F_CASE_HARDENING to be style 0, 7 or 8, so the
// paint normal is never bound while a PROJECTED style (2, 5) needs the surface
// normal — the two can never both be live. Sharing matters because a fragment
// shader gets only MAX_TEXTURE_IMAGE_UNITS(16) samplers, and adding position,
// surface and the pearlescence mask as three NEW units hit 17: the program then
// fails VALIDATE_STATUS and every skin renders black.
uniform sampler2D tPosition;
uniform bool uHasPosition, uHasSurface, uBiasSpray;
uniform vec2 uSprayBlend;
// Per-axis 1.0 where the address mode is mirror-once (4): mirror about 0 then
// clamp. The clamp half is the sampler's ClampToEdge, the mirror half is abs().
uniform vec2 uPatMirrorOnce;
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
// Valve's 17-tap Poisson disk, transcribed verbatim from combo 293's _2997.
// The taps are averaged at 1/17 each (0.0588235296…), i.e. an unweighted BLUR of
// the position map — not a gradient. Scaled by 0.2 at the call site, giving an
// effective radius of ~0.00083 UV (~1.7 texels at 2k).
const vec2 POS_BLUR[17] = vec2[17](
  vec2(-0.00107234, -0.00400203), vec2( 0.00195312, -0.00338291),
  vec2( 0.00400203, -0.00107234), vec2(-0.00071490, -0.00266802),
  vec2( 0.00097656, -0.00169146), vec2( 0.00266802, -0.00071490),
  vec2(-0.00338291, -0.00195312), vec2(-0.00169146, -0.00097656),
  vec2( 0.00000000,  0.00000000), vec2( 0.00169146,  0.00097656),
  vec2( 0.00338291,  0.00195312), vec2(-0.00266802,  0.00071490),
  vec2(-0.00097656,  0.00169146), vec2( 0.00071490,  0.00266802),
  vec2(-0.00400203,  0.00107234), vec2(-0.00195312,  0.00338291),
  vec2( 0.00107234,  0.00400202)
);

/** The blurred object-space position, times 2 — Valve's _11428. */
vec3 sprayPos() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 17; i++) acc += texture(tPosition, vUv + POS_BLUR[i] * 0.2) * (1.0 / 17.0);
  vec3 p = acc.xyz * 2.0;
  // F_SPRAYPAINT_HALFTONE flips Z before every pattern sample.
  if (uHalftone) p.z = -p.z;
  return p;
}

/** g_bBiasSpray re-applies the sRGB ENCODE to the packed normal before
 *  unpacking it. srgbEncode(c) >= c, so every component is pushed positive and
 *  the negative half is compressed — with pow(abs(n), 7) weights that means only
 *  strongly +Y/+Z faces pick up their plane, i.e. the spray comes from one
 *  direction. */
vec3 sprayNormal() {
  // Without a surface map the sign is unrecoverable, but the weights use
  // abs(), so a flat +Z normal simply falls back to the base plane.
  if (!uHasSurface) return vec3(0.0, 0.0, 1.0);
  vec3 s = texture(tPaintNormal, vUv).xyz;
  if (uBiasSpray) {
    s = mix(1.055 * pow(max(s, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, s * 12.92,
            vec3(lessThanEqual(s, vec3(0.0031308))));
  }
  return normalize(s * 2.0 - 1.0);
}

/** The three planar projections, blended by the object-space normal.
 *  CONFIRMED (combo 293): plane A projects along X from pos.yz, B along Y from
 *  pos.xz, C along Z from pos.yx — note C's axes are SWAPPED, it is .yx not .xy.
 *  All three go through the same seeded pattern xform, so the seed still moves
 *  the artwork; it just moves it in position space. */
vec4 sprayTriplanar(vec3 p, vec3 n, vec4 x0, vec4 x1) {
  vec4 A = texture(tPattern, mix(xf(p.yz, x0, x1), abs(xf(p.yz, x0, x1)), uPatMirrorOnce));
  vec4 B = texture(tPattern, mix(xf(p.xz, x0, x1), abs(xf(p.xz, x0, x1)), uPatMirrorOnce));
  vec4 C = texture(tPattern, mix(xf(p.yx, x0, x1), abs(xf(p.yx, x0, x1)), uPatMirrorOnce));
  return mix(mix(A, B, vec4(uSprayBlend.x * pow(abs(n.y), 7.0))),
             C, vec4(uSprayBlend.y * pow(abs(n.z), 7.0)));
}

/** One tap of the case-hardening ramp for a given pattern.r. Valve averages
 *  five of these — see the call site. */
vec4 chRampAt(float geo, float rampV, float pr) {
  return texture(tCaseRamp, vec2(mix(geo * 2.0, geo + pr, uChPat), rampV));
}
float maxc(vec3 v) { return max(v.x, max(v.y, v.z)); }
float mix4(vec4 v, vec3 m) { return mix(mix(mix(v.x, v.y, m.r), v.z, m.g), v.w, m.b); }

// Valve's "albedo levels" renormalisation, shared by overlay blend modes 1-3.
// g_vAlbedoLevels is a shader Expression CONSTANT, not a material parameter:
//   float3(-(-.045), -1.4427*log(max(.0001, 1-.4)), 2-1.15) = (0.045, 0.737, 0.85)
// The same decode turns g_vPaintAlbedoLevels into (0.045, 1.32193, 1.0) and
// g_vMetallicPaintAlbedoLevels into (0.08, 1.32193, 1.0) — the two literals the
// wear path below already uses. That agreement is what validates the decode.
const vec3 OV_LEVELS = vec3(0.045, 0.737, 0.85);
const vec3 LUMA709 = vec3(0.2125, 0.7154, 0.0721);
const float OV_COLOR_BOOST = 63.0; // g_fColorBoostFactor, Expression(64-1)
vec3 ovLevels(vec3 c, float maxTerm, float lumaBase) {
  vec3 n = normalize(max(vec3(0.0003), c)) * 1.06;
  vec3 hi = max((n * OV_LEVELS.x * 1.732) / vec3(length(n)) / vec3(dot(n, LUMA709)),
                n * mix(OV_LEVELS.x, OV_LEVELS.z, clamp(pow(maxTerm, OV_LEVELS.y), 0.0, 1.0)));
  return mix(vec3(OV_LEVELS.x), hi, vec3(pow(smoothstep(0.0003, OV_LEVELS.x, lumaBase), 0.5)));
}

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
  float cavityRaw = uHasAo ? (uSeparateChannels ? ao4.r : ao4.b) : CAVITY_NO_MAP;
  // CONFIRMED (combos 293, 1447 and 1529 all use _4306 = pow(ao.x,1.5)*0.96 as
  // THE cavity for the whole shader — wear curve, grunge blend, patina gate,
  // grime term). We were applying this form only locally inside the
  // case-hardening block and feeding raw ao.r everywhere else, which made
  // cavity ~2.5x too large (0.18 vs 0.073 measured on the ak47) and so
  // over-stripped paint at every float.
  float cavity = uSeparateChannels ? pow(cavityRaw, 1.5) * 0.96 : cavityRaw;
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
  // patUv is still needed even on the projected styles: the overlay can be told
  // to ride the pattern UV (uOverlayUv == 1), and the paint rough/metal textures
  // sample through it.
  vec2 patUv = xf(vUv, uPatX0, uPatX1);
  bool projected = (uStyle == 2 || uStyle == 5) && uHasPosition;
  vec3 sprP = sprayPos();
  // Object-space normal for the triplanar plane blend, derived from the position
  // map's own screen-space gradient (dFdx/dFdy of the blurred object-space
  // position IS the surface normal, in paint-UV space).
  //
  // We do NOT use g_tSurface here even though Valve's shader does: our EXTRACTED
  // g_tSurface is broken — 94% of it is empty/black and the ~6% with data decodes
  // to length-√3 vectors, not unit normals (measured on the deagle). Feeding that
  // to the plane blend returns a near-constant normal, so the triplanar collapses
  // to a single plane (A) and the flame graphic smears into VERTICAL STRIPES
  // instead of curling — the "stretched" look. The position gradient is a clean,
  // per-weapon-correct normal we already trust, and it makes Deagle | Blaze's
  // flames match the game's baked albedo. (Proper fix is upstream: re-extract
  // g_tSurface correctly — see the extractor. This is the robust shader-side
  // workaround until then. Seams between UV islands get a bad gradient, but the
  // artwork lands inside islands so it does not show.)
  vec3 sprN = normalize(cross(dFdx(sprP), dFdy(sprP)));
  vec4 pattern = projected
    ? sprayTriplanar(sprP, sprN, uPatX0, uPatX1)
    : texture(tPattern, patUv);

  // ---- Overlay sample + mask gate ----------------------------------------------
  // Sampled HERE, above the wear curve, because the wear curve depends on it:
  // g_fOverlayDurability is mixed in by the overlay's own masked alpha, so the
  // paint under an overlay wears at a different rate. Blending happens later.
  //
  // Gates CONFIRMED from three decompiled combos — 576 (style 0), 577 (style 1,
  // the only one carrying mode 7) and 582 (style 6, the only one carrying mode
  // 8). Each is an ORDERED priority split, not the bare channel read this had.
  vec2 ovUv = uOverlayUv == 2 ? xf(vUv, uOvX0, uOvX1) : (uOverlayUv == 1 ? patUv : vUv);
  vec4 ov = texture(tOverlay, ovUv);
  float ovGate;
  if (uOverlayMaskMode == 1)      ovGate = 1.0 - maxc(masks.rgb);
  else if (uOverlayMaskMode == 2) ovGate = masks.r * (1.0 - max(masks.g, masks.b));
  else if (uOverlayMaskMode == 3) ovGate = masks.g * (1.0 - masks.b);
  else if (uOverlayMaskMode == 4) ovGate = masks.b;
  else if (uOverlayMaskMode == 5) ovGate = maxc(masks.rgb);
  // 7 "Pattern" is NOT pattern.a — it is a masks split, same family as 1-5.
  else if (uOverlayMaskMode == 7) ovGate = 1.0 - max(masks.g, masks.b);
  // 8 "Dedicated" samples its mask at the BASE uv, never the overlay's.
  else if (uOverlayMaskMode == 8) ovGate = texture(tOverlayMask, vUv).r;
  // 0 "None" and 6 "Paint" have no case in ANY combo: both leave alpha alone.
  // 6 previously used 1 - noPaint, which masked the overlay off hardware it is
  // supposed to cover.
  else                            ovGate = 1.0;
  // Valve keeps these two separate and they are not interchangeable: the wear
  // curve uses the masked alpha PRE-strength, the blend uses it POST-strength.
  float ovA = uHasOverlay ? ov.a * ovGate : 0.0;
  float oa = clamp(ovA * uOverlayStrength, 0.0, 1.0);

  // ---- Case hardening ----------------------------------------------------------
  // CONFIRMED, transcribed from the decompiled S_CASE_HARDENING=1 combos of
  // csgo_customweapon_vulkan_50_ps.vcs (VcsVersion 71). Identical in the plain
  // combo (S_PAINT_STYLE=7, id 1159) and the one matching Heat Treated's full
  // feature set (+SEPARATE_CHANNEL_INPUTS/ROUGHNESS_TEXTURE/PEARLESCENCE_MASK/
  // OVERLAY_TEXTURE, id 2131), so none of the surrounding features perturb it.
  //
  // The colour comes ENTIRELY from the ramp. g_vColor0..3 on these skins are
  // near-greyscale on purpose (Heat Treated: white, white, 208/201/191,
  // 85/86/87) — they tint the ramp, they do not carry the blue/gold.
  //
  // The geometric term reads cavity as pow(cavity, 1.5) * 0.96, which is the
  // SEPARATE_CHANNEL_INPUTS form of cavity in Valve's shader. This used to be
  // applied LOCALLY here, because the shared cavity was the raw channel — but
  // the decompile shows _4306 = pow(ao.x,1.5)*0.96 is the cavity for the whole
  // shader, so it is now applied once at the source and this block just uses it.
  // Applying it twice (which this line did briefly) squares the exponent and
  // collapses geo, which drags rampU into the wrong column of the ramp. Only
  // bites GeometricInfluence > 0 — AXIA is 0 and was unaffected, Aphrodite is 1.
  vec4 chRamp = vec4(1.0);
  vec3 chBase = pattern.rgb; // ramp gated by masks.g; pattern albedo elsewhere
  if (uCaseHardening) {
    float chCavity = cavity;
    // min(n, 1-n) is distance-from-extreme per channel, turned into "how close
    // to an edge" by a DESCENDING ramp. Written as smoothstep(0.85, 0.20, x)
    // this was undefined behaviour — the GLSL spec requires edge0 < edge1, so
    // the GPU was free to return anything. Same trap this file already fixed
    // once in paintEdgeLayers.
    //
    // Valve's own decompiled combo 1529 emits the descending form too, and in
    // practice every driver evaluates it as clamp((x-e0)/(e1-e0)) — which is
    // EXACTLY this ascending rewrite (both give 0.562 at x=0.498, hence the
    // 1.124 the old comment quoted). So this is a well-defined no-op, kept
    // because relying on UB is not worth the risk.
    vec4 nrm = texture(tPaintNormal, vUv);
    vec4 edges = vec4(1.0) - smoothstep(vec4(0.20), vec4(0.85), min(nrm, vec4(1.0) - nrm));
    float geo = mix(0.5, pow(chCavity, 0.85), uChGeo)
              * mix(1.0, flAo * (min(edges.x, edges.y) * 2.0), uChGeo);
    // pattern.r drives the colour progression, pattern.g the ramp row.
    float rampV = max(pattern.g * uChPat, (1.0 - flAo) * 0.2 * uChGeo) + uChRampOff;
    // CONFIRMED (combo 1529): the ramp is a 5-TAP AVERAGE — the centre plus the
    // four diagonal neighbours at +/-1/2048 in pattern UV, each fed through the
    // ramp and averaged. It supersamples the lookup, which matters because
    // pattern.r -> rampU is a nonlinear indirection that aliases badly on a
    // single tap. We were taking one tap.
    // STYLE 8 ONLY, and the gate matters. Combo 1529 (style 8) averages FIVE
    // ramp taps — centre plus four diagonal neighbours at +/-1/2048 in pattern
    // UV — which supersamples a lookup that aliases badly, because pattern.r ->
    // rampU is a nonlinear indirection. Combo 1447 (style 7) takes ONE tap.
    const float T = 0.00048828125; // 1/2048, Valve's literal tap offset
    chRamp = uStyle == 8
      ? (chRampAt(geo, rampV, pattern.r)
       + chRampAt(geo, rampV, texture(tPattern, patUv + vec2(T, T)).r)
       + chRampAt(geo, rampV, texture(tPattern, patUv + vec2(-T, -T)).r)
       + chRampAt(geo, rampV, texture(tPattern, patUv + vec2(-T, T)).r)
       + chRampAt(geo, rampV, texture(tPattern, patUv + vec2(T, -T)).r)) * 0.2
      : chRampAt(geo, rampV, pattern.r);
    // CONFIRMED (combo 1529, _6449 = mix(pattern, rampAvg, masks.g)): on style 8
    // the ramp does NOT colour the whole weapon — it applies only where masks.g,
    // and everywhere else the paint's own albedo texture shows through. That is
    // why Glock | AXIA was blue end to end: its masks.g is just the frame
    // panels, and the slide is meant to keep the pattern's own steel (which then
    // reads as polished metal via the masks.r branch in the rough/metal pass).
    //
    // Style 7 has NO such mix — combo 1447 uses the ramp everywhere. Applying it
    // there regressed Deagle | Heat Treated to the exact green-and-magenta
    // failure this file was built to fix: its masks.g is ~0, so the whole gun
    // fell through to the raw data texture.
    chBase = uStyle == 8 ? mix(pattern.rgb, chRamp.rgb, masks.g) : chRamp.rgb;
  }

  float dur = mix4(uDurability, masks.rgb);

  // Wear-through signal (CS:GO structure + CS2 durability/softness).
  // CONFIRMED, and the remap is GENERIC — combo 293 (style 5) and combo 1529
  // (style 8) carry the identical expression, so this is not a style-8 quirk:
  //   wearTex * mix(smoothstep(0, 0.72, pow(cav, 1.3)),
  //                 smoothstep(0, 0.40, cav), pow(wear, 1.2))
  // We multiplied wearTex by RAW cavity. At Factory New pow(wear,1.2) is 0.027,
  // so this is essentially smoothstep(0, 0.72, pow(cav,1.3)) — which for the
  // ak47's cavity of 0.073 is 0.005, against our 0.18. We were stripping ~35x
  // too hard at FN, which is what dragged the AK-47's factory wood-and-metal
  // through AK-47 | Aphrodite's marble.
  float cavWear = mix(smoothstep(0.0, 0.72, pow(cavity, 1.3)),
                      smoothstep(0.0, 0.40, cavity),
                      pow(uWearAmt, 1.2));
  // The min(noPaint, 1 - masks.r) clamp is style-8 ONLY — combo 293 uses plain
  // noPaint, so this must not be applied to the projected styles.
  float blend = (uStyle == 8 ? min(noPaint, 1.0 - masks.r) : noPaint) + wearTex * cavWear;
  blend *= uWearAmt * 6.0 + 1.0;
  // Paint under an overlay wears at its own rate. CONFIRMED: the factor is
  // mixed in by the PRE-strength masked alpha, and sits between the wear
  // multiplier and the durability multiply.
  float ovWearRaw = wearTex * cavity * (uWearAmt * 6.0 + 1.0) * uOverlayDurability;
  if (uHasOverlay) blend *= mix(1.0, uOverlayDurability, ovA);

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
    // CONFIRMED (combo 1529):
    //   bool bBare = masks.r > 0.99;
    //   blend = mix(smoothstep(0.58 - soft, 0.68 + soft, raw), raw, float(bBare));
    // Two things were wrong here. The masks.r weight is a HARD > 0.99 test, not
    // a smooth lerp; and the follow-up line
    //   blend = mix(blend, 1.0 - step(preBlend, 0.996), masks.r);
    // does not exist in Valve's shader at all — it was invented, and it is what
    // forced the masks.r zone to read as painted. My earlier
    // max(smoothstep(...), masks.r) was equally invented: it produced a
    // roughly-right black slide but by sending blend to 1, which drives
    // metalness to the weapon's baseRM (0.07 on the glock) and rendered
    // polished steel as flat grey dielectric. Metalness is handled by the
    // masks.r branch in the rough/metal pass instead.
    blend = mix(smoothstep(0.58 - soft, 0.68 + soft, blend), blend, float(masks.r > 0.99));
  } else {
    blend = smoothstep(0.58 - soft, 0.68 + soft, blend);
  }

  // The overlay's own wear-through, on the same curve but WITHOUT noPaint and
  // WITHOUT the durability multiply — it describes the overlay eroding, not the
  // paint. Drives two things: mask mode 0 lets the overlay pull the paint's
  // wear forward, and blend mode 4 "Layer" fades the overlay out by it.
  float ovWear = smoothstep(0.58 - soft, 0.68 + soft, ovWearRaw);
  if (uHasOverlay && uOverlayMaskMode == 0) {
    blend = max(0.0, mix(blend, min(blend, ovWear), oa));
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

  // ---- Debug output ------------------------------------------------------------
  // uMode 2 emits the pattern EXACTLY as sampled through the seeded UV
  // transform, before any palette, mask or wear stage touches it. It exists to
  // answer one question that no downstream statistic can: did the seed actually
  // move the pattern? A low-contrast skin whose composite barely changes
  // between seeds looks identical to a skin whose pattern never moved at all,
  // and only this output tells the two apart.
  if (uMode == 2) {
    outColor = vec4(pattern.rgb, 1.0);
    return;
  }
  if (uMode == 3) {
    outColor = vec4(vec3(pattern.a), 1.0);
    return;
  }
  if (uMode == 4) {
    outColor = vec4(masks.rgb, 1.0);
    return;
  }

  // ---- SFX mask ------------------------------------------------------------
  // Computed for BOTH outputs so a debug probe and the real write can never
  // disagree. See the write in the rough/metal branch for the derivation.
  float sfx;
  if (uHasPearlMask) {
    float t = (1.0 - blend) * texture(tPearlMask, uPearlPatternUv ? patUv : vUv).r;
    sfx = uPearlPatternUv ? t : t * t;
  } else {
    sfx = 1.0 - noPaint;
  }
  if (uPearlOnMetallicOnly) sfx *= masks.r;

  // ---- Rough/metal output ------------------------------------------------------
  if (uMode == 1) {
    float roughPaint = uPerColorRough ? mix4(uRoughPerColor, masks.rgb) : uPaintRough;
    if (uHasRoughTex) roughPaint = texture(tPaintRough, patUv).r;
    float metalPaint = uPerColorMetal ? mix4(uMetalPerColor, masks.rgb) : uPaintMetal;
    float chMetal = 0.0;
    bool hasChMetal = false;
    if (uHasMetalTex) metalPaint = texture(tPaintMetal, patUv).r;
    if (uStyle == 3 || uStyle == 4 || uStyle == 5) {
      // anodized dye is metallic; chipped edges are bare rough aluminum
      metalPaint = max(metalPaint, 1.0 - anoEdges * 0.15);
      roughPaint = mix(roughPaint, 0.4, anoEdges);
    }
    if (uStyle == 7) metalPaint = max(metalPaint, masks.r);
    if (uStyle == 8) metalPaint = max(metalPaint, masks.r * (1.0 - blend));
    if (uCaseHardening) {
      // CONFIRMED: the ramp's ALPHA is the metalness for these finishes, dulled
      // by grunge as wear rises and driven to 1 wherever patina takes over.
      // Without this a case-hardened gun renders with the paint's flat
      // roughness and loses the polished-steel read the ramp colours imply.
      // Same two terms as the albedo path, which carried the same fabricated
      // formulas. Kept in sync deliberately — Valve computes each once and
      // feeds both outputs, so a divergence here is always a bug.
      float chGrungeLum = dot(grunge.rgb, vec3(0.2125, 0.7154, 0.0721));
      float chGrunge = clamp(grungeRaw.r * grungeRaw.g * grungeRaw.b, 0.0, 1.0);
      float chGrimeX = clamp(pow(cavity, 1.5) * 11.52 * flAo - uWearAmt * chGrunge * 2.0, 0.0, 1.0);
      float chOil = 1.0 - (1.0 - smoothstep(0.0, max(1e-5, 0.5 * uWearAmt), chGrimeX)) * uWearAmt;
      float chPatina = smoothstep(0.2, 0.6,
          (wearTex * flAo) * (wearTex * smoothstep(0.2, 0.3, cavity)) * uWearAmt);
      // CONFIRMED: the metalness base is mix(1.0, chAlpha, masks.g), NOT the raw
      // ramp alpha — where masks.g is 0 (the whole bare-metal zone) Valve's
      // value is exactly 1.0.
      float chAlpha = uStyle == 8 ? mix(pattern.a, chRamp.a, masks.g) : chRamp.a;
      chMetal = mix(mix(1.0, chAlpha, masks.g) * mix(1.0, sqrt(max(chOil * grunge.a * chGrungeLum, 0.0)), uWearAmt), 1.0, chPatina);
      hasChMetal = true;
    }
    vec4 baseRM = texture(tBaseRM, vUv);
    float wornRough = uHasBaseRM ? baseRM.r : 0.75; // bare metal is fairly rough
    float wornMetal = uHasBaseRM ? baseRM.g : metalPaint;
    float rough = mix(min(1.0, roughPaint + (1.0 - grunge.a) * uWearAmt * uWearAmt * 0.5), wornRough, blend);
    // CONFIRMED (combo 1529): the case-hardening metalness is selected by
    // masks.r: mix(mix(paintMetal, baseRM.y, blend), chMetal, masks.r).
    // OUTSIDE masks.r it is the paint's OWN metalness, not the ramp's.
    //
    // We were applying chMetal everywhere, which drove Glock | AXIA's blue frame
    // (masks.g, so masks.r = 0) to metalness ~1 because its ramp alpha is 255.
    // A fully metallic surface has no diffuse, so the frame rendered dark and
    // desaturated: measured (22,103,140) against the official render's
    // (44,153,193). The frame is a dielectric glitter paint, not polished metal.
    // metalPaint, NOT the uPaintMetal scalar: combo 1529 carries no
    // S_METALNESS_TEXTURE so its g_flPaintMetalness IS the paint metalness, but
    // AXIA's real combo has one, and metalPaint already folds it in. Using the
    // scalar (0) stripped the artist's per-texel metalness and turned the grip
    // and magazine floorplate from black polymer into light grey.
    float metal = hasChMetal
      ? mix(mix(metalPaint, wornMetal, blend), chMetal, masks.r)
      : mix(metalPaint, wornMetal, blend);
    // ---- SFX mask -----------------------------------------------------------
    // CONFIRMED (combo 1529 lines 119-144, and the weapon shader reads it back
    // as g_tMetalness.z). The composite does NOT shade glitter, pearlescence or
    // iridescence — all three are RUNTIME weapon-shader effects, and their
    // uniforms (g_fGlitterIntensity, g_flPearlescentScale, ...) are not even in
    // this shader's constant buffer. What the composite owes them is this gate.
    //
    //   sfx = (1 - blend) * pearlMask(patternUV or meshUV)
    //   ...SQUARED in the mesh-UV branch only — the asymmetry is real, verified
    //   line by line, not a transcription slip.
    //   if (g_bPearlescentOnMetallicOnly) sfx *= masks.r
    // With no mask the ch7 default is plain paint coverage, 1 - noPaint.
    //
    // Valve writes it to .z and sRGB-encodes the whole rgb on the way out
    // because THEIR rough/metal target is sRGB-formatted. Ours is linear
    // (makeRT(false)) and three reads .g/.b for roughness/metalness, so we put
    // it in the free .r and skip the encode — copying that 1/12.92 scale would
    // crush the mask.
    outColor = vec4(sfx, rough, metal, 1.0);
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
    // The decompile calls the texture this modulates _17842, and it is the
    // pattern ONLY when case hardening is off — otherwise it is the ramp,
    // pre-scaled by colour brightness. Everything else here is shared.
    vec3 patCol = uCaseHardening
      ? mix(chBase, chBase * uColorBrightness, max(masks.r, float(uColorAdjustMode)))
      : pattern.rgb;
    float flGrunge = clamp(grungeRaw.r * grungeRaw.g * grungeRaw.b, 0.0, 1.0);
    // CONFIRMED (combos 1529 and 1447, where _6896/_5609/_8353 are byte-identical
    // — so this is shared by styles 7 and 8):
    //   _6896 = smoothstep(0.5*wear, 0.0, clamp(pow(cav,1.5)*11.52*flAo
    //                                          - wear*grunge*2.0, 0, 1)) * wear
    //   _5609 = 1 - _6896          <- what our oilRub stands for
    //
    // The old line here was fabricated, and its comment claimed the 0.23 was
    // "CONFIRMED from the same decompile". It is not: 0.23, +0.08 and the
    // -wear*0.1 term appear ZERO times in either combo (grepped). Four errors
    // in one expression — an ascending smoothstep where Valve's descends, fixed
    // edges where Valve's edge0 tracks wear, a missing 11.52x cavity
    // amplification, and critically a missing trailing multiply by wearAmt.
    //
    // That last one is the whole AK-47 | Aphrodite bug. Valve HARD-CAPS the
    // grime at wearAmt, so at Factory New (0.05) brown can contribute at most
    // 5%. Ours was unbounded on [0,1] and measured mean 0.60 / p10 0.04 — i.e.
    // ~40% brown across the gun and near-total brown in the darkest decile,
    // which is exactly the olive/brown cast over what should be white marble.
    float grimeX = clamp(pow(cavity, 1.5) * 11.52 * flAo - uWearAmt * flGrunge * 2.0, 0.0, 1.0);
    // Valve's descending smoothstep(0.5*wear, 0, x), written ascending so it is
    // defined; max() guards the degenerate edge pair at wear 0.
    float grime = (1.0 - smoothstep(0.0, max(1e-5, 0.5 * uWearAmt), grimeX)) * uWearAmt;
    float oilRub = 1.0 - grime;
    // CONFIRMED: wearTex is SQUARED (not cavity), the cavity term is a hard
    // smoothstep(0.2, 0.3) gate, and the outer edges are 0.2/0.6 — this read
    // smoothstep(0.1, 0.2, wearTex*flAo*cavity*cavity*wear).
    float patinaBlend = smoothstep(0.2, 0.6,
        (wearTex * flAo) * (wearTex * smoothstep(0.2, 0.3, cavity)) * uWearAmt);
    vec3 cPatina = mix(uC1, uC2, uWearAmt);
    vec3 cOilRub = mix(uC1, uC3, sqrt(uWearAmt));
    cPatina = mix(cOilRub, cPatina, oilRub) * patCol;
    // Rec.709 luma, per the decompile — this was Rec.601 weights.
    float patternLum = dot(patCol, vec3(0.2125, 0.7154, 0.0721));
    cPatina = mix(cPatina, uC0 * patternLum, patinaBlend);
    cPaint = uStyle == 7 ? cPatina : mix(patCol, cPatina, masks.r);
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
    // ov / ovUv / oa are computed above the wear curve — see the overlay
    // sample block, which the wear curve depends on.
    // "Layer" erodes the overlay itself as the surface wears.
    if (uOverlayBlend == 4) oa *= clamp(1.0 - ovWear, 0.0, 1.0);
    vec3 src = ov.rgb * uOverlayBrightness;
    vec3 blended;
    if (uOverlayBlend == 1) {
      // "Color" is NOT a W3C colour/luminosity blend — that was the standing
      // guess and it is wrong. It is a MULTIPLY fed through ovLevels, differing
      // from mode 2 only in that the two scalar terms are taken from the paint
      // rather than from the product.
      blended = ovLevels(src * cPaint, maxc(cPaint), dot(clamp(cPaint, 0.0, 1.0), LUMA709));
    } else if (uOverlayBlend == 2) {
      vec3 prod = cPaint * src;
      blended = ovLevels(prod, maxc(prod), dot(clamp(prod, 0.0, 1.0), LUMA709));
    } else if (uOverlayBlend == 3) {
      // Add carries an extra colour-boost term the other modes do not.
      vec3 sum = cPaint + src;
      float lum = dot(clamp(sum * 2.0, 0.0, 1.0), LUMA709);
      vec3 n = normalize(max(vec3(0.0003), sum)) * 1.06;
      vec3 hi = max((n * OV_LEVELS.x * 1.732) / vec3(length(n)) / vec3(dot(n, LUMA709)),
                    n * mix(OV_LEVELS.x, OV_LEVELS.z, clamp(pow(maxc(sum) * 2.0, OV_LEVELS.y), 0.0, 1.0)));
      hi = mix(hi, min(vec3(OV_LEVELS.z), hi + vec3(lum) * 2.0), 1.0 / OV_COLOR_BOOST);
      blended = mix(vec3(OV_LEVELS.x), hi, vec3(pow(smoothstep(0.0003, OV_LEVELS.x, lum), 0.5)));
    } else {
      // 0 "Normal" and 4 "Layer" are the SAME straight lerp here; Layer differs
      // only in the alpha erosion applied above.
      blended = src;
    }
    cPaint = mix(cPaint, blended, oa);
  }

  if (anoEdges > 0.0) {
    cPaint = mix(cPaint, vec3(0.05), anoEdges);
    grunge.rgb = mix(grunge.rgb, vec3(1.0), anoEdges);
  }

  // g_flColorBrightness is applied TWICE with a clamp between and after, NOT
  // once. CONFIRMED (combo 293, style5.glsl:444-445):
  //   b   = mix(g_flColorBrightness, 1.0, chip);   // chip -> 1 on anodized edges
  //   col = clamp(clamp(base * b, 0,1) * b, 0,1);
  // Applying it once left Deagle | Blaze's flames a muddy dark red: the gold
  // flame bodies sit near cPaint 0.12 linear, and one x3 only reaches ~0.36
  // (dim orange) where the double-with-clamp reaches 1.0 (bright orange), which
  // is the difference between "smudge" and "fire". For the ~everything-else
  // skins where g_flColorBrightness is 1 this is clamp(cPaint) — a no-op, since
  // cPaint is already a convex mix of in-gamut palette colours.
  float bright = mix(uColorBrightness, 1.0, anoEdges);
  vec3 cRaw = clamp(clamp(cPaint * bright, 0.0, 1.0) * bright, 0.0, 1.0);
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

/** g_tPosition ships as RGBA16161616F, which the extractor hands us as .exr —
 *  TextureLoader cannot read it. Loaded through three's EXRLoader and sampled
 *  linear/clamped, matching Valve's g_sTrilinearClamp. Kept in the same cache so
 *  one weapon's position map is fetched once per session.
 *
 *  ROW ORDER: EXRLoader hands back a DataTexture whose rows run the OPPOSITE way
 *  to what TextureLoader produces for the .png inputs, and three IGNORES `flipY`
 *  on a DataTexture (UNPACK_FLIP_Y_WEBGL does not apply to typed-array uploads),
 *  so the flag alone cannot fix it — the rows have to be swapped by hand.
 *
 *  MEASURED, against the deagle GLB (sample every vertex's paint UV, look the
 *  position map up there, correlate with that vertex's real object-space
 *  position). Best |correlation| over all channel/axis pairs:
 *      position.exr as-is    0.09   (i.e. NO relationship — pure garbage)
 *      position.exr V-flipped 0.995
 *  and the control, surface.png down the ordinary TextureLoader path, is the
 *  other way round: 0.746 as-is, 0.244 flipped. So the .png inputs are already
 *  oriented correctly and only the EXR is inverted.
 *
 *  This silently wrecked BOTH projected styles (2 spraypaint, 5 anodized
 *  airbrushed) on every weapon: they build the pattern coordinate from this map,
 *  so a vertical flip hands each texel some other island's position and the
 *  artwork lands nowhere near where it belongs. Deagle | Blaze put its gold band
 *  across the middle of the slide instead of the muzzle. */
function loadExr(THREE: THREE, url: string): Promise<import("three").Texture | null> {
  const key = `${url}|exr`;
  let cached = texCache.get(key);
  if (!cached) {
    cached = import("three/examples/jsm/loaders/EXRLoader.js")
      .then((m) => new m.EXRLoader().loadAsync(url))
      .then((t) => {
        // Swap rows in place: EXRLoader's DataTexture is upside-down relative to
        // the .png inputs and three ignores flipY on a DataTexture. See the
        // block comment above for the measurement that pins this.
        const img = t.image as { width: number; height: number; data: { [i: number]: number; length: number; subarray?: unknown } };
        const data = img.data;
        const rowLen = (data.length / (img.width * img.height)) * img.width;
        for (let y = 0; y < (img.height >> 1); y++) {
          const top = y * rowLen;
          const bot = (img.height - 1 - y) * rowLen;
          for (let i = 0; i < rowLen; i++) {
            const s = data[top + i];
            data[top + i] = data[bot + i];
            data[bot + i] = s;
          }
        }
        t.colorSpace = THREE.NoColorSpace; // position data, never colour
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.flipY = false;
        t.needsUpdate = true;
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
/** Source 2 RsTextureAddressMode_t -> three wrap constant. Mirror-once (4) has
 *  no three equivalent; ClampToEdge plus an abs() on the coordinate reproduces
 *  it, and the shader does the abs() half. Border (3) is unused by any paint. */
function wrapForAddr(THREE: THREE, addr: number) {
  if (addr === 1) return THREE.MirroredRepeatWrapping;
  if (addr === 2 || addr === 4) return THREE.ClampToEdgeWrapping;
  return THREE.RepeatWrapping;
}

function loadTex(
  THREE: THREE,
  url: string,
  opts: { srgb: boolean; wrap: boolean; addr?: [number, number] },
): Promise<import("three").Texture | null> {
  // Address mode is part of the key: paints share pattern textures and disagree.
  const akey = opts.addr ? `a${opts.addr[0]}_${opts.addr[1]}` : "";
  const key = `${url}|${opts.srgb ? "s" : "l"}|${opts.wrap ? "w" : "c"}${akey}`;
  let cached = texCache.get(key);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(url)
      .then((t) => {
        t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (opts.addr) {
          t.wrapS = wrapForAddr(THREE, opts.addr[0]);
          t.wrapT = wrapForAddr(THREE, opts.addr[1]);
        } else {
          t.wrapS = t.wrapT = opts.wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        }
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
  /** Only present when opts.debug was set — see compositePaint. Test rig only. */
  debug?: import("three").Texture;
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
const COARSE_POINTER = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
const MAX_COMPOSITE_SIZE = COARSE_POINTER ? 1024 : 2048;
// Projected styles (2 spraypaint, 5 anodized airbrushed) build the pattern from a
// triplanar projection of the 1024 position map. The flame/spray graphic is
// high-frequency, and at 2048 the projection undersamples it — Deagle | Blaze's
// crisp fire tongues smear into a muddy red blur. The GAME composites these at
// 4096 (matching its 4096 color/metalness inputs; the position map is natively
// 1024 for the game too, so resolution here is the atlas, not the input). Match
// it on desktop; coarse-pointer devices stay at 1024 for memory.
const MAX_COMPOSITE_SIZE_PROJECTED = COARSE_POINTER ? 1024 : 4096;

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
  opts: {
    wear: number; seed: number; weapon?: WeaponInputs | null; model?: string;
    /** Test-rig only: also render a debug pass (2 = pattern.rgb as sampled
     *  through the seeded UV transform, 3 = pattern.a) into `result.debug`.
     *  Part of the cache key so a debug render never satisfies a normal one. */
    debug?: 2 | 3 | 4;
  },
): Promise<CompositeResult | null> {
  const THREE = three;
  const wear = Math.min(Math.max(opts.wear, 0), 1);
  const seed = Math.max(0, Math.trunc(opts.seed));
  const wkey = opts.weapon ? (opts.weapon.color ?? "w") : "";
  const key = `${def.pattern ?? "-"}|${def.overlay ?? "-"}|${def.style}|${wear.toFixed(4)}|${seed}|${wkey}|d${opts.debug ?? 0}|${def.caseHardening ? `ch${def.caseHardeningRamp ?? "-"}${def.chRampOffset}` : ""}|a${def.patternAddrH}_${def.patternAddrV}`;
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
  //
  // Case hardening is the exception inside those styles: g_tPattern declares
  // SrgbRead(false) there because it is a lookup coordinate, not a colour.
  // Decoding it as sRGB bends the ramp lookup and shifts every colour band.
  // Whether g_tPattern is ARTWORK (sRGB) or a data texture (linear).
  //
  // Case hardening splits by style, because the two styles use the pattern
  // differently. On style 8 the pattern IS the albedo wherever masks.g is 0
  // (combo 1529), so it must decode as sRGB — read linear it is far too bright,
  // and Glock | AXIA's slide rendered as white chrome instead of dark steel.
  // On style 7 the ramp supplies every pixel (combo 1447 has no such mix) and
  // the pattern is purely a lookup coordinate, so it stays LINEAR — decoding it
  // as colour bends the ramp lookup, and Deagle | Heat Treated is measured
  // against the linear form.
  const patternIsColor =
    def.style === 6 || def.style === 8 || (def.style === 7 && !def.caseHardening);
  const urlOf = async (p?: string) => (p ? await paintTextureUrl(p) : null);
  const magUrl = opts.weapon?.mag;
  const [patternUrl, wearUrl, grungeUrl, masksUrl, aoUrl, colorUrl, rmUrl, roughTexUrl, metalTexUrl, overlayUrl, overlayMaskUrl, caseRampUrl, paintNormalUrl, pearlMaskUrl] = await Promise.all([
    urlOf(def.pattern),
    urlOf(def.wearMask),
    urlOf(def.grunge),
    // A CASE-HARDENED skin that authors its own mask WINS over the weapon's
    // extracted one. The weapon mask is generic (which parts of this gun are
    // metal/polymer/grip); a g_tPaintByNumberMasks is drawn for THIS finish and
    // says which parts the finish leaves factory — which is what the style-8
    // zone branch keys off. With the generic mask, Glock | AXIA's black slide
    // and floorplate came out blue along with everything else.
    //
    // Scoped tightly (case hardening AND style 8) rather than applied to every
    // skin-authored mask — 269 of 1479 materials ship one — because widening it
    // moves skins that were measured against the weapon mask:
    //   - all skin-authored masks: Five-SeveN | Autumn Thicket (style 0) fell
    //     from sat 9.8 to 6.7, under the rig's grey floor.
    //   - case hardening alone: Deagle | Heat Treated (style 7) drifted
    //     12.5 -> 13.6 for no established reason.
    // Style 8 + case hardening is exactly the set this is evidenced for.
    (def.masksSkinSpecific && def.caseHardening && def.style === 8 ? await urlOf(def.masks) : null) ??
      opts.weapon?.masks ??
      (await urlOf(def.masks)),
    opts.weapon?.ao ?? urlOf(def.ao),
    opts.weapon?.color ?? urlOf(def.baseColor),
    opts.weapon?.metalness ?? urlOf(def.baseRM),
    urlOf(def.paintRoughnessTex),
    urlOf(def.paintMetalnessTex),
    urlOf(def.overlay),
    urlOf(def.overlayMask),
    urlOf(def.caseHardening ? def.caseHardeningRamp : undefined),
    urlOf(def.caseHardening ? def.normal : undefined),
    urlOf(def.pearlMask),
  ]);
  const magTex = magUrl ? await loadTex(THREE, magUrl, { srgb: false, wrap: false }) : null;
  // Projected styles only — no point fetching a 1MB EXR for the other seven.
  const wantsProjection = def.style === 2 || def.style === 5;
  const posTex = wantsProjection && opts.weapon?.position ? await loadExr(THREE, opts.weapon.position) : null;
  const surfTex =
    wantsProjection && opts.weapon?.surface
      ? await loadTex(THREE, opts.weapon.surface, { srgb: false, wrap: false })
      : null;
  const [pattern, wearT, grunge, masks, ao, baseColor, baseRM, roughTex, metalTex, overlayTex, overlayMaskTex, caseRampTex, paintNormalTex, pearlMaskTex] = await Promise.all([
    // Address mode applies ONLY to the projected styles — see PaintDef.
    patternUrl
      ? loadTex(THREE, patternUrl, {
          srgb: patternIsColor,
          wrap: true,
          addr: wantsProjection ? [def.patternAddrH, def.patternAddrV] : undefined,
        })
      : null,
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
    // g_tCaseHardeningColorRamp declares SrgbRead(true) and samples through
    // g_sTrilinearClamp — the clamp matters, the ramp must not wrap.
    caseRampUrl ? loadTex(THREE, caseRampUrl, { srgb: true, wrap: false }) : null,
    paintNormalUrl ? loadTex(THREE, paintNormalUrl, { srgb: false, wrap: true }) : null,
    // g_tPearlescenceMask declares SrgbRead(false) and samples g_sTrilinearWrap.
    pearlMaskUrl ? loadTex(THREE, pearlMaskUrl, { srgb: false, wrap: true }) : null,
  ]);

  // Solid-style paints legitimately have no pattern; anything else without
  // one has nothing to composite.
  if (!pattern && !overlayTex && def.style !== 0 && !def.colors.length) return null;

  const sv = seededVisuals(def, seed);
  // Spray/anodized-air scale by weapon length; everything else by uvScale.
  const weaponLength = opts.weapon?.weaponLength ?? def.weaponLength;
  const uvScale = opts.weapon?.uvScale ?? def.uvScale;
  const sizeScale = def.ignoreWeaponSizeScale ? 1 : def.style === 2 || def.style === 5 ? weaponLength / 36 : uvScale;
  // CONFIRMED from Valve's own source — cs_custom_weapon_visualsdata_processor
  // .cpp builds all three transforms from ONE scale:
  //   flWeaponSizeScale = (spray || ano_air) ? (ignore ? 1 : weaponLength/36)
  //                                          : (ignore ? 1 : uvScale);
  //   flPatternScale = visualsData.flPatternScale * flWeaponSizeScale;
  //   flWearScale    = ... * flWeaponSizeScale;
  //   flGrungeScale  = ... * flWeaponSizeScale;
  // so the pattern takes exactly the same size scale as wear and grunge.
  //
  // This used to be special-cased to 1 for styles 2/5, tuned against an in-game
  // P90 | Desert Halftone capture. That measurement was taken while style 2 was
  // sampling in PAINT-UV space — the wrong space entirely — so it was
  // compensating for the missing projection, and it does not survive the move to
  // position space. Valve's single scale is now used for all three.
  const patSizeScale = sizeScale;
  // The position map is NORMALISED to ~[0,1]: measured over the deagle's body
  // texels, x 0.44-0.56, y 0.02-0.93, z 0.22-0.77 at the 1st/99th percentile.
  // (Raw min/max look like +/-14 because the UV gutters hold garbage — always
  // percentile these, never min/max.) The shader doubles it, so plane A spans
  // u = p.y - 0.3 in [-0.3, 1.56] at scale 1. NO extra normalisation is needed;
  // an earlier 1/36 guess here drove the whole gun into one texel.
  //
  // What IS needed is the pattern sampler's ADDRESS MODE, which finally makes
  // sense in this space: Deagle | Blaze sets horizontal=2 (clamp), so u<0 pins
  // to the flame sheet's solid gold band and u>1 to its solid green band (which
  // the palette maps to black) — gold muzzle, flames on the slide, black frame.
  // Wrapping instead tiles the flames onto the grip.
  const patX = texXform(sv.patternRot, def.patternScale * patSizeScale, sv.patternOffsetX, sv.patternOffsetY);
  const wearX = texXform(sv.wearRot, sv.wearScale * sizeScale, sv.wearOffsetX, sv.wearOffsetY);
  const grgX = texXform(sv.grungeRot, sv.grungeScale * sizeScale, sv.grungeOffsetX, sv.grungeOffsetY);

  const imgW = (t: import("three").Texture | null) => (t?.image as { width?: number } | undefined)?.width ?? 0;
  const sizeCap = wantsProjection ? MAX_COMPOSITE_SIZE_PROJECTED : MAX_COMPOSITE_SIZE;
  const size = Math.min(Math.max(imgW(pattern), imgW(baseColor), 1024), sizeCap);

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
      uOverlayDurability: { value: 0 },
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
      tPosition: { value: null },
      uHasPosition: { value: false },
      uHasSurface: { value: false },
      uBiasSpray: { value: false },
      uSprayBlend: { value: new THREE.Vector2(1, 1) },
      uPatMirrorOnce: { value: new THREE.Vector2() },
      tPearlMask: { value: null },
      uHasPearlMask: { value: false },
      uPearlPatternUv: { value: false },
      uPearlOnMetallicOnly: { value: false },
      uSeparateChannels: { value: false },
      tCaseRamp: { value: null as unknown as import("three").Texture },
      tPaintNormal: { value: null as unknown as import("three").Texture },
      uCaseHardening: { value: false },
      uChPat: { value: 0.5 },
      uChGeo: { value: 1 },
      uChRampOff: { value: 0 },
      uColorAdjustMode: { value: 0 },
      uMode: { value: 0 },
    },
  });

  const u = quadMat.uniforms;
  const white = fallbackTex(THREE, [255, 255, 255, 255], false);
  const black = fallbackTex(THREE, [0, 0, 0, 255], false);
  // Shader defaults: cavity 0.5, ao 1, noPaint 0 / rough 0.5, metal 0.
  const aoDefault = fallbackTex(THREE, [188, 255, 128, 0], true);
  const rmDefault = fallbackTex(THREE, [128, 0, 0, 255], false);
  // Valve's own default_normal is a 1x1 (128,128,255,0) — matching it exactly
  // keeps the case-hardening edge term at the constant the shader produces.
  const flatNormal = fallbackTex(THREE, [128, 128, 255, 0], false);
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
  u.uOverlayDurability.value = def.overlayDurability;
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
  u.tPosition.value = posTex ?? black;
  // Shares the tPaintNormal unit — see the uniform declaration.
  if (surfTex) u.tPaintNormal.value = surfTex;
  u.uHasPosition.value = !!posTex;
  u.uHasSurface.value = !!surfTex;
  u.uBiasSpray.value = def.biasSpray;
  u.uSprayBlend.value.fromArray(def.sprayBlend);
  u.uPatMirrorOnce.value.set(def.patternAddrH === 4 ? 1 : 0, def.patternAddrV === 4 ? 1 : 0);
  u.tPearlMask.value = pearlMaskTex ?? black;
  u.uHasPearlMask.value = !!pearlMaskTex;
  u.uPearlPatternUv.value = def.pearlMaskPatternUv;
  u.uPearlOnMetallicOnly.value = def.pearlOnMetallicOnly;
  // Only meaningful alongside a real weapon ao map; the generic fallback is a
  // Source1-style pack.
  u.uSeparateChannels.value = !!opts.weapon?.ao && !!opts.weapon?.separateChannels;
  // The ramp IS the colour on these finishes, so a missing one is not a
  // degraded render, it is the wrong render — fall back to no case hardening
  // and say so rather than sampling white and silently producing greyscale.
  if (def.caseHardening && !caseRampTex) noteMissing(modelKey, "caseHardening colour ramp (skin renders greyscale)");
  u.uCaseHardening.value = def.caseHardening && !!caseRampTex;
  u.tCaseRamp.value = caseRampTex ?? white;
  // Flat default normal => the edge term is a constant, matching the shader.
  u.tPaintNormal.value = paintNormalTex ?? flatNormal;
  u.uChPat.value = def.chPatternInfluence;
  u.uChGeo.value = def.chGeometricInfluence;
  u.uChRampOff.value = def.chRampOffset;
  u.uColorAdjustMode.value = def.colorAdjustmentMode;

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
  let debugRT: import("three").WebGLRenderTarget | null = null;
  if (opts.debug) {
    debugRT = makeRT(true);
    u.uMode.value = opts.debug;
    renderer.setRenderTarget(debugRT);
    renderer.render(scene, camera);
    u.uMode.value = 0;
  }
  renderer.setRenderTarget(prevRT);

  const dispose = () => {
    albedoRT.dispose();
    rmRT.dispose();
    debugRT?.dispose();
    for (const t of [white, black, aoDefault, rmDefault, grayDefault]) t.dispose();
  };
  const entry: CacheEntry = {
    result: { albedo: albedoRT.texture, rm: rmRT.texture, debug: debugRT?.texture },
    refs: 1,
    dispose,
  };
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
