/**
 * csgo_customglove.vfx — the SUBSTRATE/SURFACE input generation.
 *
 * A sibling of gloveComposite.ts, which handles the other one. Same .vfx, same
 * compositor, but the two parameter generations share almost no inputs, so one
 * file trying to be both would be a mess of branches. 73 finishes use the older
 * g_tDetail/g_tLayerMask set (gloveComposite.ts); 22 use this one.
 *
 * Transcribed from the decompiled shader, VCS 71,
 * csgo_customglove_vulkan_50_ps.vcs **static combo 5**, kept at
 * tools/shadertest/groundtruth/customglove_tint.glsl.
 *
 * COMBO 5, NOT COMBO 1. Only 6 of the 8 combos exist and the two missing ones
 * are the tell: S_TINT_ID never appears without S_BACKWARDS_COMPATIBILITY, so
 * the tint palette belongs exclusively to this generation. Combo 1 compiles it
 * out — g_tTintId is sampled zero times there — and porting that one yields a
 * correctly-lit, completely colourless glove. Note also that
 * S_BACKWARDS_COMPATIBILITY=1 selects THIS set, not the older-looking one.
 *
 * DETECTING THE GENERATION. Not by m_shaderName: a finish vmat names
 * csgo_customglove_preview.vfx (a forward renderer — shadow buffers, SSAO, BRDF
 * LUT — not a compositor) while the SHARED glove_compositor.vmat it pairs with
 * names csgo_customglove.vfx. Detect on g_tSubstrate1 being present instead.
 *
 * WHY MULTI-PASS
 * --------------
 * 30-odd distinct textures against WebGL2's guaranteed 16 units — the limit that
 * has already made every weapon skin render black once in this codebase.
 *
 * The split is exact here rather than an approximation, because the shader
 * itself accumulates each per-layer family as a plain weighted sum before doing
 * any shading:
 *
 *     sub = t1*w1 + t2*w2 + t3*w3 + t4*w4
 *
 * so collapsing a family to one RT cannot change the result. Eight resolve
 * passes (5 samplers each) reduce substrate / surface / their normals and
 * properties / damage / grime to one RT apiece; the shading pass then needs 14.
 *
 * The per-layer mat4 colour adjusts blend by the SAME weights, per column, so
 * they are blended in the shading pass rather than resolved.
 *
 * WHAT IS EXACT
 *   The 4-way layer weights, the tint palette (9-tap kernel, slot selection,
 *   premultiplied accumulation), the per-layer UV sets, the blended colour
 *   adjusts, the tint-push curve, the properties channel split and the
 *   2-channel normal decode. All read straight off the decompile.
 *
 * WHAT IS APPROXIMATE
 *   1. PARALLAX on the pattern lookup. The shader offsets the pattern UV by a
 *      view-dependent vector (input_1.zw). A baked composite has no view, so it
 *      is dropped. Affects only finishes with g_bPatternPaintEmboss.
 *   2. Damage bevel and burnishing are applied as scalar modulation rather than
 *      the full per-layer chains. Shape right, edge detail not — the same
 *      compromise the legacy file documents for its wear chain.
 *   3. The second (mip-biased) substrate accumulation chain is folded into the
 *      first; g_fSubstratePatternMipBias is not applied.
 *   4. THE PATTERN NUMBER's placement. WHAT it rolls — pattern rotation and
 *      offset, the four layer offsets, damage and grime — with which ranges and
 *      in which order is read off each finish and exact (gloveRolls). How the
 *      vertex shader turns those values into UVs is not in the decompile, so
 *      the transform order is Source's convention rather than a transcription.
 *      And one composite serves both hands, rolled the way the game rolls the
 *      hand seeded by the pattern itself: the other hand draws from
 *      g_nRandomSeedAlt, which the game derives in code.
 *
 * Verify with tools/shadertest/item3d.html?flat&pm=<vcompmat>. Look at the flat
 * maps and their printed means BEFORE judging a lit render — every wrong turn on
 * the legacy compositor came from squinting at a 200px thumbnail.
 */
import type * as ThreeNS from "three";
import { paintFetch, paintTextureUrl, UniformRandomStream } from "./paintComposite";

type Three = typeof ThreeNS;

const LAYERS = [1, 2, 3, 4] as const;

/** The per-layer texture families, each collapsed to one RT by a resolve pass. */
const FAMILIES = [
  "g_tSubstrate",
  "g_tSubstrateNormal",
  "g_tSubstrateProperties",
  "g_tSurface",
  "g_tSurfaceNormal",
  "g_tSurfaceProperties",
  "g_tDamage",
  "g_tGrime",
] as const;
type Family = (typeof FAMILIES)[number];

/** Singleton inputs, sampled directly by the shading pass. */
const SINGLES = ["g_tLayerId", "g_tTintId", "g_tPattern", "g_tPatternProperties", "g_tObjectProperties", "g_tNormal"] as const;

export interface GloveModernDef {
  tex: Record<string, string>;
  /** Per-layer scalars, layer 1..4. Missing layers inherit layer 1. */
  layer: Record<string, [number, number, number, number]>;
  scalar: Record<string, number>;
  vec: Record<string, number[]>;
  /** g_mSurfaceColorAdjust1..4 etc, each 16 floats in column-major order. */
  mat: Record<string, number[][]>;
  /** g_vId1Color..g_vId8Color. */
  idColor: number[][];
  /** g_bId1Pattern..g_bId8Pattern — which palette slots the pattern paints. */
  idPattern: boolean[];
  pattern: boolean;
  /** g_bPatternPaintLayer (F_PATTERN_PAINT). Picks which of the shader's two
   *  pattern branches runs — see the header. */
  patternPaintLayer: boolean;
  patternEmboss: boolean;
  patternRespectsTintMask: boolean;
  tintId: boolean;
  /** What the pattern number rolls, in the game's draw order — see gloveRolls.
   *  Empty when the finish was reached without its vcompmat. */
  rolls: GloveRoll[];
}

/** One RANDOM_ROLL entry: a loose variable and the range each component is
 *  drawn from (one for `.x`, two for `.xy`). */
export interface GloveRoll {
  name: string;
  bounds: [number, number][];
}

/**
 * The pattern number's draws, off the vcompmat's RANDOM_ROLL mutators.
 *
 * Every one of the 22 finishes declares two sets. One is seeded by
 * econ_instance.g_nRandomSeed — the item's pattern — and runs on the hand whose
 * seed_offset attribute is not 1. The other hand rolls from g_nRandomSeedAlt,
 * which the game derives in code this data does not show, so only the first is
 * reproducible and only it is read.
 *
 * ITS ORDER VARIES BY FINISH: half roll the four layer offsets first, half the
 * pattern first. Same stream, different positions, so it is read off each
 * finish rather than written down once.
 *
 * Bounds come off instance_params' loose variables. A flat range still takes a
 * draw — the stream position is what keeps every later entry where the game
 * has it.
 *
 * The older 73 roll the same way, from the _shared_paint_generic include rather
 * than their own file — so gloveComposite passes `[include, finish]`, and a
 * variable the finish declares again (Crimson Web pins its rotation at 25.2)
 * replaces the include's, as the walk sets it last.
 */
export function gloveRolls(comp: unknown): GloveRoll[] {
  const vars = new Map<string, Record<string, unknown>>();
  const mutators: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.m_strAlias === "instance_params") {
      for (const v of (o.m_vecLooseVariables as Record<string, unknown>[] | undefined) ?? []) {
        if (typeof v?.m_strName === "string") vars.set(v.m_strName, v);
      }
    }
    if (o.m_nMutatorCommandType === "COMP_MAT_PROPERTY_MUTATOR_RANDOM_ROLL_INPUT_VARIABLES") mutators.push(o);
    Object.values(o).forEach(walk);
  };
  walk(comp);
  const seeded = mutators.filter(
    (m) =>
      m.m_strRandomRollInputVars_SeedInputVar === "econ_instance.g_nRandomSeed" &&
      Array.isArray(m.m_vecRandomRollInputVars_InputVarsToRoll),
  );
  const list = (m: Record<string, unknown>) => (m.m_vecRandomRollInputVars_InputVarsToRoll as unknown[]).map(String);
  // The hand's own roll is the one gated on seed_offset NOT being 1. The
  // longest list is the fallback: the conditional per-layer re-rolls beside it
  // carry one or two entries each.
  const main =
    seeded.find((m) =>
      ((m.m_vecConditions as Record<string, unknown>[] | undefined) ?? []).some(
        (c) =>
          c.m_strMutatorConditionContainerName === "material_seed" &&
          c.m_strMutatorConditionContainerVarName === "seed_offset" &&
          c.m_bPassWhenTrue === "0",
      ),
    ) ?? seeded.sort((a, b) => list(b).length - list(a).length)[0];
  if (!main) return [];
  return list(main).map((entry) => {
    // "instance_params.g_vUvOffset1.xy"
    const [, name = "", comps = "x"] = entry.split(".");
    const v = vars.get(name);
    const bounds = [...comps].map((c): [number, number] => {
      const k = c.toUpperCase();
      const val = NUM(v?.[`m_flValueFloat${k}`], 0);
      const lo = v?.[`m_flValueFloat${k}_Min`];
      const hi = v?.[`m_flValueFloat${k}_Max`];
      return lo == null || lo === "" || hi == null || hi === "" ? [val, val] : [NUM(lo, val), NUM(hi, val)];
    });
    return { name, bounds };
  });
}

/** The values a pattern rolls, by variable name, drawn in the finish's order. */
export function gloveRolled(def: { rolls: GloveRoll[] }, seed: number): Map<string, number[]> {
  const rs = new UniformRandomStream(seed);
  return new Map(def.rolls.map((r) => [r.name, r.bounds.map(([lo, hi]) => rs.randomFloat(lo, hi))]));
}

/** Does the pattern change anything on this finish at all? */
export function gloveSeedMoves(def: { rolls: GloveRoll[] }): boolean {
  return def.rolls.some((r) => r.bounds.some(([lo, hi]) => lo !== hi));
}

/**
 * Where this finish's maps sit — the pattern artwork, the four fabric layers,
 * damage and grime.
 *
 * Without a pattern, the finish's own authored values. With one, what the game
 * rolls for it, which REPLACES them: the texture generator copies the finish's
 * keys and then instance_params' over the top, so a rolled offset is absolute,
 * not added to the authored one. (That is also why the authored placement is
 * never what an actual item looks like — every real item has a pattern.)
 */
export interface GlovePlacement {
  /** Degrees. */
  patternRot: number;
  patternOffset: [number, number];
  /** Layers 1..4. */
  uvOffset: [number, number][];
  damageRot: number;
  damageOffset: [number, number];
  grimeRot: number;
  grimeOffset: [number, number];
}
export function glovePlacement(def: GloveModernDef, seed?: number | null): GlovePlacement {
  const rolled = seed != null && def.rolls.length ? gloveRolled(def, seed) : null;
  const vec2 = (name: string): [number, number] => {
    const v = rolled?.get(name) ?? def.vec[name];
    return [v?.[0] ?? 0, v?.[1] ?? 0];
  };
  const deg = (name: string) => rolled?.get(name)?.[0] ?? def.scalar[name] ?? 0;
  return {
    patternRot: deg("g_fPatternTexCoordRotation"),
    patternOffset: vec2("g_vPatternTexCoordOffset"),
    uvOffset: LAYERS.map((i) => vec2(`g_vUvOffset${i}`)),
    damageRot: deg("g_fDamageTexCoordRotation"),
    damageOffset: vec2("g_vDamageTexCoordOffset"),
    grimeRot: deg("g_fGrimeTexCoordRotation"),
    grimeOffset: vec2("g_vGrimeTexCoordOffset"),
  };
}

/**
 * Defaults off the shader's variable table (shaderdump `vars` mode), not
 * guessed. Most finishes set only a handful of these, so the defaults ARE the
 * look for everything else — and a "multipliers default to 1" heuristic is
 * wrong here exactly as it was for the legacy set.
 */
const MODERN_DEFAULTS: Record<string, number> = {
  g_fSubstrateCompositeColorTranslucency: 0,
  g_fDamageUvScale: 1,
  g_fDamageHeightBlendSoftness: 0.1,
  g_fDamageBevelBlendSoftness: 0.1,
  g_fDamageBevelEmboss: 0,
  g_fDamageBevelRoughnessBrightness: 1,
  g_fDamageBevelAnisotropy: 0,
  g_fDamageBevelMetalness: 0,
  g_fDamageBevelCloth: 0,
  g_fBurnishingMetalness: 0,
  g_fBurnishingCloth: 0,
  g_fBurnishingNormalScale: 1,
  g_fSurfaceBurnishingRoughnessBrightness: 1,
  g_fSubstrateBurnishingRoughnessBrightness: 1,
  g_fGrimeUvScale: 1,
  g_fGrimeTranslucency: 0,
  g_fGrimeRoughnessBrightness: 1,
  g_fBurnishingGrime: 0,
};

const WHOLE_DEFAULTS: Record<string, number> = {
  g_fWearProgress: 0,
  g_fPatternTranslucencyThreshold: 0.5,
  g_fSubstratePatternMipBias: 0,
  g_fPatternTexCoordRotation: 0,
  g_fDamageTexCoordRotation: 0,
  g_fGrimeTexCoordRotation: 0,
  g_fPatternNormalDistortion: 0,
  g_fPuffyPaintNormalSoftness: 1,
  g_fPatternPaintRespectsTintMask: 0,
};

/**
 * Build one layer's colour-adjust matrix from its four artist params.
 *
 * The shader receives this as a ready-made mat4 — it is an Expression constant
 * (`VariableSource=__Expression__`, `VfxType=Float4x4`) whose DynExp bytecode
 * takes exactly g_v<stem>ColorTint, g_f<stem>ColorBrightness, ...Contrast and
 * ...Saturation. Those four inputs are confirmed from the variable table; the
 * COMPOSITION ORDER below is Valve's own, taken from the sibling csgo_weapon
 * grade already transcribed in charmMaterial.ts: contrast about mid-grey, then
 * brightness, then saturation toward luma. (The bytecode itself is not decoded
 * — the function IDs would need VRF's table — so if a finish ever grades
 * visibly wrong, this order is the thing to question.)
 *
 * Returned column-major for Matrix4.fromArray, applied as vec4(rgb,1) * M to
 * match the shader.
 */
function colourAdjustMatrix(tint: number[], brightness: number, contrast: number, saturation: number): number[] {
  const W = [0.2125, 0.7154, 0.0721];
  // Linear part: saturation toward luma, then brightness and tint scale.
  // Offset: contrast pivots about 0.5, so it contributes a constant term.
  const s = saturation;
  const m: number[][] = [];
  for (let r = 0; r < 3; r++) {
    const row = [0, 0, 0];
    for (let c = 0; c < 3; c++) row[c] = (r === c ? s : 0) + (1 - s) * W[c];
    // brightness, contrast gain and per-channel tint all scale the linear part
    for (let c = 0; c < 3; c++) row[c] *= contrast * brightness * (tint[c] ?? 1);
    m.push(row);
  }
  // Contrast about mid-grey leaves a constant lift, itself scaled by brightness
  // and tint.
  const lift = [0, 1, 2].map((c) => 0.5 * (1 - contrast) * brightness * (tint[c] ?? 1));
  // Column-major for Matrix4.fromArray. GLSL's `v * M` is dot(v, column_j) for
  // output j, so column j holds the coefficients that PRODUCE channel j, and
  // its .w is that channel's offset — not the other way round. Writing this
  // transposed still yields a plausible grade (it is symmetric when saturation
  // is 1), which is exactly why it needs stating.
  return [
    m[0][0], m[0][1], m[0][2], lift[0],
    m[1][0], m[1][1], m[1][2], lift[1],
    m[2][0], m[2][1], m[2][2], lift[2],
    0, 0, 0, 1,
  ];
}

const NUM = (v: unknown, dflt: number) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
};
const BOOL = (v: unknown) => NUM(v, 0) !== 0;

/**
 * Resolve a glove finish to the substrate/surface parameter set, or null if it
 * belongs to the other generation.
 */
export async function loadGloveModernDef(material: string): Promise<GloveModernDef | null> {
  // Same vcompmat indirection as the legacy path, and the same two shapes. The
  // 22 finishes on this generation are precisely the ones that use the second:
  // a "paint_compositor" container holding a SHARED compositor material, with
  // the finish's own vmat as a LOOSE VARIABLE on the "paint" container.
  let path = material;
  let rolls: GloveRoll[] = [];
  if (/\.vcompmat\.json$/i.test(path)) {
    const comp = (await paintFetch(path)
      .then((r) => r.json())
      .catch(() => null)) as unknown;
    rolls = gloveRolls(comp);
    let specific: string | null = null;
    let loose: string | null = null;
    const walk = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.m_strAlias === "paint") {
        if (typeof o.m_strSpecificContainerMaterial === "string") specific ??= o.m_strSpecificContainerMaterial;
        for (const v of (o.m_vecLooseVariables as Record<string, unknown>[] | undefined) ?? []) {
          if (typeof v?.m_strResourceMaterial === "string") loose ??= v.m_strResourceMaterial;
        }
      }
      Object.values(o).forEach(walk);
    };
    walk(comp);
    // The LOOSE variable first here, unlike the legacy loader: on this shape the
    // specific container is the shared compositor template, which carries the
    // plumbing but none of this finish's colours.
    const found = loose ?? specific;
    if (!found) return null;
    path = found;
  }
  const doc = (await paintFetch(path)
    .then((r) => r.json())
    .catch(() => null)) as {
    m_textureParams?: { m_name?: string; m_pValue?: string }[];
    m_floatParams?: { m_name?: string; m_flValue?: unknown }[];
    m_intParams?: { m_name?: string; m_nValue?: unknown }[];
    m_vectorParams?: { m_name?: string; m_value?: unknown[] }[];
  } | null;
  if (!doc) return null;

  const tex: Record<string, string> = {};
  for (const t of doc.m_textureParams ?? []) {
    if (t.m_name && typeof t.m_pValue === "string" && t.m_pValue.startsWith("/textures/")) tex[t.m_name] = t.m_pValue;
  }
  // The discriminator. Not m_shaderName — see the header.
  if (!tex.g_tSubstrate1 || !tex.g_tLayerId) return null;

  const floatParams = new Map((doc.m_floatParams ?? []).map((p) => [p.m_name ?? "", p.m_flValue]));
  const ints = new Map((doc.m_intParams ?? []).map((p) => [p.m_name ?? "", p.m_nValue]));
  const vecs = new Map((doc.m_vectorParams ?? []).map((p) => [p.m_name ?? "", p.m_value]));
  // Valve does NOT sort params by their g_f / g_b prefix into m_floatParams /
  // m_intParams — g_fPatternPaintRespectsTintMask is an int on all 22 of these
  // finishes despite the g_f. Reading only one map silently takes the default,
  // which is how that one read as 0 everywhere while every material sets it.
  const floats = { get: (k: string) => floatParams.get(k) ?? ints.get(k) };

  const vec: Record<string, number[]> = {};
  for (const [k, v] of vecs) if (Array.isArray(v)) vec[k] = v.map((x) => NUM(x, 0));

  // Per-layer scalars are named <base>1..<base>4. A layer the material does not
  // define falls back to layer 1 rather than to the global default — an unused
  // layer carries weight 0, so its value never shows, but a DEFINED layer that
  // simply omits one param should track its siblings.
  const layer: Record<string, [number, number, number, number]> = {};
  for (const base of Object.keys(MODERN_DEFAULTS)) {
    const first = NUM(floats.get(`${base}1`), MODERN_DEFAULTS[base] ?? 0);
    layer[base] = LAYERS.map((i) => NUM(floats.get(`${base}${i}`), first)) as [number, number, number, number];
  }
  // Per-layer vec2 min/max ranges, flattened to two 4-vectors (mins, maxes).
  for (const base of ["g_vDamageMinMax", "g_vSurfaceBurnishingMinMax", "g_vSubstrateBurnishingMinMax", "g_vSurfaceGrimeMinMax", "g_vSubstrateGrimeMinMax"]) {
    const get = (i: number, c: number) => {
      const v = vec[`${base}${i}`] ?? vec[`${base}1`];
      return v?.[c] ?? (c === 0 ? 0 : 1);
    };
    layer[`${base}_min`] = LAYERS.map((i) => get(i, 0)) as [number, number, number, number];
    layer[`${base}_max`] = LAYERS.map((i) => get(i, 1)) as [number, number, number, number];
  }
  // Per-layer UV scales.
  layer.uvScaleX = LAYERS.map((i) => vec[`g_vUvScale${i}`]?.[0] ?? 1) as [number, number, number, number];
  layer.uvScaleY = LAYERS.map((i) => vec[`g_vUvScale${i}`]?.[1] ?? 1) as [number, number, number, number];

  const scalar: Record<string, number> = {};
  for (const [k, d] of Object.entries(WHOLE_DEFAULTS)) scalar[k] = NUM(floats.get(k), d);

  // The blended colour adjusts. Each is a mat4 the shader builds column-wise
  // from the four per-layer matrices weighted by the layer weights.
  //
  // THE MATRIX NAME IS NOT THE PARAM NAME. Only four artist stems exist across
  // all 22 finishes — Surface, Substrate, Burnishing, DamageBevel — while the
  // shader declares five matrices. g_mDamageColorAdjust is fed by DamageBevel*,
  // and the surface and substrate BURNISHING matrices share one Burnishing* set
  // (only their roughness params are per-family). Deriving the stem from the
  // matrix name found nothing for three of the five, so damage and both
  // burnishing grades were identity on every finish — including a
  // g_fBurnishingColorBrightness of 2.312, the largest number in the material.
  const mat: Record<string, number[][]> = {};
  const ADJUST_STEMS: Record<string, string[]> = {
    g_mSurfaceColorAdjust: ["Surface"],
    g_mSubstrateColorAdjust: ["Substrate"],
    g_mDamageColorAdjust: ["DamageBevel", "Damage"],
    g_mSurfaceBurnishingColorAdjust: ["SurfaceBurnishing", "Burnishing"],
    g_mSubstrateBurnishingColorAdjust: ["SubstrateBurnishing", "Burnishing"],
  };
  for (const [base, candidates] of Object.entries(ADJUST_STEMS)) {
    // NOT read from the material — it does not contain them. g_m*ColorAdjust*
    // is VariableSource=__Expression__, VfxType=Float4x4 in the .vcs variable
    // table: the shader BUILDS it at compile time from four artist params, the
    // same mechanism as the legacy generation's albedo levels. Looking for a
    // 16-float param and falling back to identity, as this used to, silently
    // discarded every layer's grade — which is most of "it renders but the
    // colour is flat".
    const stem =
      candidates.find((s) =>
        LAYERS.some(
          (i) =>
            floats.get(`g_f${s}ColorBrightness${i}`) !== undefined ||
            floats.get(`g_f${s}ColorContrast${i}`) !== undefined ||
            floats.get(`g_f${s}ColorSaturation${i}`) !== undefined ||
            vec[`g_v${s}ColorTint${i}`] !== undefined,
        ),
      ) ?? candidates[candidates.length - 1];
    mat[base] = LAYERS.map((i) => {
      const f = (suffix: string, d: number) => NUM(floats.get(`g_f${stem}Color${suffix}${i}`), NUM(floats.get(`g_f${stem}Color${suffix}1`), d));
      const tintRaw = vec[`g_v${stem}ColorTint${i}`] ?? vec[`g_v${stem}ColorTint1`] ?? [1, 1, 1, 0];
      return colourAdjustMatrix(tintRaw, f("Brightness", 1), f("Contrast", 1), f("Saturation", 1));
    });
  }

  // The palette is authored in sRGB and MUST be decoded — every texture around
  // it already is (SRGB_READ / loadTex), so leaving these encoded mixes two
  // colour spaces in one blend.
  //
  // This is the vibrance. Decoding roughly doubles each slot's saturation
  // (0.73 -> 0.94 on the cyan, 0.51 -> 0.80 on the yellow) and is the difference
  // between the reference's strong yellow piping and the olive we were drawing.
  // The symptom to recognise: structure and region layout exactly right, every
  // colour a pale wash of what it should be. The legacy generation's palette
  // needed the same decode.
  //
  // ALPHA IS NOT A COLOUR — it is the slot's weight in the premultiplied
  // accumulation, so it stays linear.
  const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const idColor = Array.from({ length: 8 }, (_, i) => {
    const v = vec[`g_vId${i + 1}Color`];
    const raw = v && v.length >= 4 ? v.slice(0, 4) : [1, 1, 1, 1];
    return [srgbToLinear(raw[0]), srgbToLinear(raw[1]), srgbToLinear(raw[2]), raw[3]];
  });
  const idPattern = Array.from({ length: 8 }, (_, i) => BOOL(ints.get(`g_bId${i + 1}Pattern`)));

  return {
    tex,
    layer,
    scalar,
    vec,
    mat,
    idColor,
    idPattern,
    pattern: BOOL(ints.get("F_PATTERN")) || BOOL(ints.get("g_bPattern")),
    // The shared glove_compositor.vmat compiles BOTH pattern branches in
    // (F_PATTERN and F_PATTERN_PAINT are 1 on it), so the finish's own flags
    // pick between them at runtime as g_bPattern / g_bPatternPaintLayer.
    patternPaintLayer: BOOL(ints.get("F_PATTERN_PAINT")) || BOOL(ints.get("g_bPatternPaintLayer")),
    patternEmboss: BOOL(ints.get("g_bPatternPaintEmboss")),
    patternRespectsTintMask: NUM(floats.get("g_fPatternPaintRespectsTintMask"), 0) !== 0,
    tintId: BOOL(ints.get("F_TINT_ID")) && !!tex.g_tTintId,
    rolls,
  };
}

/**
 * One live material per pass shader, shared by every glove composite — both
 * generations.
 *
 * Each pass used to make its own material and dispose it after drawing, and
 * three frees a compiled program the moment no material holds it. So EVERY
 * composite recompiled all of the glove's shaders: 60-100ms of main thread per
 * repaint, measured, which is the hitch in the glove animation while scrubbing
 * patterns (each hovered pattern is a composite). The weapon compositor never
 * had it — it keeps its one material (quadMat in paintComposite); this is the
 * same thing, per shader.
 *
 * Values are copied INTO the kept uniforms rather than the object swapped: three
 * binds a program's uniform list to the material's own object when it compiles.
 * Every caller passes the full set for its shader, so nothing stale survives.
 */
const passMats = new Map<string, Map<string, ThreeNS.RawShaderMaterial>>();
export function passMaterial(
  THREE: Three,
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, ThreeNS.IUniform>,
): ThreeNS.RawShaderMaterial {
  let byFrag = passMats.get(vertexShader);
  if (!byFrag) passMats.set(vertexShader, (byFrag = new Map()));
  const kept = byFrag.get(fragmentShader);
  if (!kept) {
    const mat = new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms,
    });
    byFrag.set(fragmentShader, mat);
    return mat;
  }
  for (const k in uniforms) {
    if (kept.uniforms[k]) kept.uniforms[k].value = uniforms[k].value;
    else kept.uniforms[k] = uniforms[k];
  }
  return kept;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Resolve pass. Collapse one family of four per-layer textures into one by the
 * plain weighted sum the shader itself performs, each layer at its own UV scale.
 * Five samplers.
 */
const RESOLVE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uId, uT1, uT2, uT3, uT4;
uniform vec4 uScaleX, uScaleY;
// Per-layer offsets and one rotation (cos, sin) for the whole family: the
// fabric layers each have their own g_vUvOffset<n>, damage and grime one
// rotation and offset apiece. All of them are what the pattern number rolls.
// Rotation is about the origin — on a repeating map that differs from turning
// about the centre by a translation, which the offset is anyway.
uniform vec4 uOffX, uOffY;
uniform vec2 uRot;
vec2 at(vec2 s, float sx, float sy, float ox, float oy) {
  return mat2(uRot.x, uRot.y, -uRot.y, uRot.x) * (s * vec2(sx, sy)) + vec2(ox, oy);
}
void main() {
  // Plain [0,1]. The sources are authored in that range and REPEAT, which is how
  // two hands get different layouts out of one atlas — the composite reproduces
  // that by being a [0,1] texture that also repeats. (The render target must
  // have RepeatWrapping set or the u<0 hand smears; see gloveComposite.ts.)
  vec2 src = vUv;
  vec4 id = texture(uId, src);
  float sum = id.x + id.y + id.z;
  float rest = max(0.0, 1.0 - sum);
  vec4 w = vec4(id.x, id.y, id.z, rest) / (sum + rest);
  fragColor =
      texture(uT1, at(src, uScaleX.x, uScaleY.x, uOffX.x, uOffY.x)) * w.x
    + texture(uT2, at(src, uScaleX.y, uScaleY.y, uOffX.y, uOffY.y)) * w.y
    + texture(uT3, at(src, uScaleX.z, uScaleY.z, uOffX.z, uOffY.z)) * w.z
    + texture(uT4, at(src, uScaleX.w, uScaleY.w, uOffX.w, uOffY.w)) * w.w;
}`;

/**
 * Shading pass. Fourteen samplers, three output modes.
 *
 * uMode: 0 albedo, 1 rough/metal/cloth, 2 normal.
 */
const SHADE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uId, uTintId, uPattern, uPatternProps, uObjProps, uNormal;
uniform sampler2D uSub, uSubN, uSubP, uSurf, uSurfN, uSurfP, uDamage, uGrime;

uniform mat4 uSurfAdj[4], uSubAdj[4], uDmgAdj[4], uSurfBurnAdj[4], uSubBurnAdj[4];
uniform vec4 uIdColor[8];
uniform float uIdPattern[8];
uniform vec4 uDamageMin, uDamageMax;
uniform vec4 uSurfBurnMin, uSurfBurnMax, uSubBurnMin, uSubBurnMax;
uniform vec4 uDmgBevelMetal, uDmgBevelCloth, uDmgBevelRough;
uniform vec4 uBurnMetal, uBurnCloth, uGrimeTranslucency, uSubTranslucency;
uniform vec4 uPatternXform;      // scale.xy, offset.xy
uniform vec2 uPatternCenter;
uniform vec2 uPatternRot;        // cos, sin of g_fPatternTexCoordRotation
uniform float uWear, uPatternThreshold;
uniform bool uHasPattern, uEmboss, uRespectsTintMask, uHasTint, uPatternPaintLayer;
uniform int uMode;

const vec3 LUMA709 = vec3(0.2125, 0.7154, 0.0721);
const vec3 LUMA_NTSC = vec3(0.30, 0.59, 0.11);
const float GREY = 0.577;

vec4 layerWeights(vec2 uv) {
  vec4 id = texture(uId, uv);
  float sum = id.x + id.y + id.z;
  float rest = max(0.0, 1.0 - sum);
  return vec4(id.x, id.y, id.z, rest) / (sum + rest);
}

float blend4(vec4 v, vec4 w) { return dot(v, w); }

/**
 * smoothstep with the edges guarded. The shader calls smoothstep raw, but some
 * of these min/max pairs are authored INVERTED — Tech Gradient's
 * g_vSubstrateGrimeMinMax3 is (0.965, 0.937) — and smoothstep(a, b, x) with
 * a >= b is undefined in GLSL, so it renders differently per driver.
 */
float ramp(float lo, float hi, float x) {
  return hi > lo ? smoothstep(lo, hi, x) : step(lo, x);
}

mat4 blendAdj(mat4 m[4], vec4 w) {
  return mat4(
    m[0][0] * w.x + m[1][0] * w.y + m[2][0] * w.z + m[3][0] * w.w,
    m[0][1] * w.x + m[1][1] * w.y + m[2][1] * w.z + m[3][1] * w.w,
    m[0][2] * w.x + m[1][2] * w.y + m[2][2] * w.z + m[3][2] * w.w,
    m[0][3] * w.x + m[1][3] * w.y + m[2][3] * w.z + m[3][3] * w.w);
}

/**
 * The tint palette. A 3x3 POINT-sampled neighbourhood on g_tTintId, slot
 * selected by ceil(r*7) — eight slots, and note it is ceil and *7, unlike the
 * legacy generation's floor(a*8).
 *
 * Weights: a run of three matching taps vertically or horizontally means the
 * texel is interior to a colour region and takes the hard weight; otherwise it
 * is an edge and takes the blur kernel. Accumulation is PREMULTIPLIED and then
 * unpremultiplied, so a slot with alpha 0 contributes nothing rather than
 * dragging the result toward black.
 *
 * The t2 appearing in BOTH kernel terms is Valve's own quirk — it reads like a
 * typo for t1 — and is transcribed as-is rather than "fixed".
 */
vec4 tintColour(vec2 uv, out float weights[8]) {
  // ONE TINT-ID TEXEL, not one composite texel. The shader takes the step from
  // textureSize(g_tTintId) — these masks are 1024 while we composite at 2048, so
  // a 1/size step samples the same texel nine times, every texel reads as
  // interior and the edge kernel never runs.
  vec2 texel = vec2(1.0) / vec2(textureSize(uTintId, 0));
  int idx[9];
  for (int t = 0; t < 9; t++) {
    vec2 o = vec2(float(t % 3) - 1.0, float(t / 3) - 1.0) * texel;
    idx[t] = int(ceil(texture(uTintId, uv + o).x * 7.0));
  }
  vec4 acc = vec4(0.0);
  for (int s = 0; s < 8; s++) {
    float h[9];
    for (int t = 0; t < 9; t++) h[t] = idx[t] == s ? 1.0 : 0.0;
    float w;
    if (h[4] == h[1] && h[4] == h[7]) w = h[4];
    else if (h[4] == h[3] && h[4] == h[5]) w = h[4];
    else w = 0.03125 * (h[0] + h[2] + h[6] + h[8])
           + 0.09375 * (h[2] + h[3] + h[5] + h[7])
           + 0.5 * h[4];
    weights[s] = w;
    acc += vec4(uIdColor[s].rgb * uIdColor[s].a, uIdColor[s].a) * w;
  }
  if (acc.w > 0.0) return vec4(acc.rgb / acc.w, acc.w);
  return vec4(1.0, 1.0, 1.0, acc.w);
}

/**
 * Push a base colour toward the tint's hue.
 *
 * Same family as the legacy generation's saturation push: take the tint's
 * direction off the grey axis, build a fully saturated version of that hue,
 * renormalise to preserve luminance, and mix in by an amount that rises as the
 * tint darkens. gloss biases the brightness clamp — a metallic layer is
 * allowed a much narrower range than a matte one.
 *
 * normalize() is guarded: a near-grey tint collapses the direction to zero and
 * resolves to magenta, which showed up as pink rims on neutral edges in the
 * legacy port. Valve's own lum > 0 test does not cover that case.
 */
vec3 tintPush(vec3 base, vec4 tint, float gloss, float amount) {
  float maxc = max(tint.r, max(tint.g, tint.b));
  float chroma = maxc - min(tint.r, min(tint.g, tint.b));
  float sat = maxc == 0.0 ? 0.0 : chroma / maxc;
  float lum = dot(tint.rgb, LUMA709);
  if (lum <= 0.0) return base;
  float baseLum = max(dot(base, LUMA_NTSC), 0.001);
  vec3 dir = normalize(tint.rgb) - vec3(GREY);
  if (length(dir) < 1e-5) {
    return base * mix(1.0, clamp(1.0 + 4.0 * (lum - 0.5),
                                 mix(0.03, 0.134, gloss) / baseLum,
                                 mix(0.90, 0.98, gloss) / baseLum), amount);
  }
  vec3 hueCol = clamp(normalize(dir) * 2.0 + vec3(1.0), 0.0, 1.0);
  float hueLum = dot(hueCol, LUMA709);
  vec3 scaled = base * mix(1.0, clamp(1.0 + 4.0 * (lum - 0.5),
                                      mix(0.03, 0.134, gloss) / baseLum,
                                      mix(0.90, 0.98, gloss) / baseLum), amount);
  float k = clamp(sat * pow(abs(dot(dir, vec3(GREY))), 0.2), 0.0, 1.0) * amount;
  return mix(scaled, hueCol * (lum / max(hueLum, 1e-4)), k);
}

/**
 * Valve's 2-channel normal encode.
 *
 * Packed in .w/.y here — ALPHA and GREEN, the DXT5nm layout — NOT the .x/.y the
 * legacy generation's maps use. Getting this wrong is not subtle but it is
 * easy to miss: the composite still produces a normal-looking map, just biased,
 * and the flat view's mean was 73,56,216 against the ~128,128,255 a mostly-flat
 * surface should give. That mean is how it was caught.
 *
 * The two channels the normal does NOT use are not spare — see below.
 */
vec3 decodeNormalPair(float a, float b) {
  float nx = (a + b) - 1.00392163;
  float ny = a - b;
  return normalize(vec3(nx, ny, (1.0 - abs(nx)) - abs(ny)));
}
/** LAYER normals (g_tSubstrateNormal*, g_tSurfaceNormal*) — ALPHA and GREEN. */
vec3 decodeLayerNormal(vec4 t) { return decodeNormalPair(t.w, t.y); }
/** The OBJECT normal (g_tNormal) — RED and GREEN. Different map, different
 *  encode, same shader. Using the layer swizzle here drove the composite normal
 *  to a mean of (52, 28, 127) — near fully sideways — against the (121, 128,
 *  245) the legacy compositor produces through the identical readback path.
 *  That side-by-side is what identified it; neither number means anything
 *  alone. */
vec3 decodeObjectNormal(vec4 t) { return decodeNormalPair(t.x, t.y); }

void main() {
  vec2 uv = vUv;
  vec4 w = layerWeights(uv);

  float tw[8];
  vec4 tint = uHasTint ? tintColour(uv, tw) : vec4(1.0, 1.0, 1.0, 1.0);
  if (!uHasTint) for (int i = 0; i < 8; i++) tw[i] = 0.0;

  vec4 surf = texture(uSurf, uv);
  vec4 sub = texture(uSub, uv);
  vec4 surfP = texture(uSurfP, uv);
  vec4 subP = texture(uSubP, uv);
  vec4 obj = texture(uObjProps, uv);

  // Channel split. NOT what the slot-declaration names suggest at first read:
  // ROUGHNESS DOES NOT LIVE IN THE PROPERTIES MAP. The normal texture is a
  // 2-channel encode in .w/.y, and its other two channels are used, not spare —
  // .x carries roughness and .z anisotropy. The shader reads them as
  // _13192.xz. Properties is (ao, metalness, cloth, height), which matches its
  // source files being named *_ao_*.
  //
  // The tell that this was wrong: SubstrateProperties resolved to a mean of
  // (226, 0, 0). Reading .x as roughness gave 0.89 everywhere — a uniformly
  // matte glove — while .g and .b being exactly zero says this finish simply has
  // no metal and no cloth, which is true of neoprene.
  vec4 subNraw = texture(uSubN, uv);
  vec4 surfNraw = texture(uSurfN, uv);
  float surfRough = surfNraw.x, surfMetal = surfP.y;
  float surfCloth = surfP.z * (1.0 - surfMetal);
  float subRough  = subNraw.x,  subMetal  = subP.y;
  float subCloth  = subP.z * (1.0 - subMetal);
  float surfAo = surfP.x, subAo = subP.x;

  // ---- pattern ------------------------------------------------------------
  // The shader offsets this lookup by a view-dependent parallax vector which a
  // baked composite cannot have; see the header.
  //
  // Scale from the ORIGIN, then offset — the convention the fabric layers
  // (RESOLVE_FRAG) and the weapon compositor's texXform both use. Scaling
  // about g_vPatternTexCoordCenter instead slid every pattern by
  // (0.5 - 0.5 x scale): a quarter of the artwork sideways on Specialist
  // Gloves | Blackbook (scale 1.5), so pattern #30 showed the signature tag
  // where the game shows the dripping hand. Measured against an in-game #30:
  // with this, AIK, the Q, the hand and the arrow land where the game puts
  // them. The vertex shader that builds this UV is not in the decompile;
  // rotation turns about the centre (unverified — Blackbook rolls none).
  vec2 patUv = mat2(uPatternRot.x, uPatternRot.y, -uPatternRot.y, uPatternRot.x) * (uv * uPatternXform.xy - uPatternCenter)
             + uPatternCenter + uPatternXform.zw;
  vec4 pat = uHasPattern ? texture(uPattern, patUv) : vec4(0.0);
  if (uHasPattern && uEmboss) {
    pat.w = smoothstep(uPatternThreshold, uPatternThreshold + 0.04, pat.w);
  }
  // Only the palette slots flagged g_bId<n>Pattern take the pattern, weighted by
  // how much of this texel each of those slots owns.
  float patSlots = 0.0;
  if (uHasPattern) for (int i = 0; i < 8; i++) patSlots += uIdPattern[i] * tw[i];
  float patAmt = clamp(patSlots * pat.w, 0.0, 1.0);

  // THE PATTERN IS A TINT, NOT A DECAL — on the branch every Sport/Specialist
  // gradient finish takes (g_bPatternPaintLayer == 0). It replaces the palette
  // colour that gets pushed into the fabric, so the weave survives underneath
  // and the hue comes out of tintPush's saturation boost rather than off the
  // texture. Ultra Violent is the case that proves it: nothing in its eight
  // palette slots is magenta and its gradient is only a pale lilac
  // (169,110,205), yet the glove is vividly magenta in game — that is tintPush
  // taking the lilac's HUE and rebuilding it fully saturated. Painting the
  // gradient straight onto the albedo, as this did, draws the pale lilac
  // literally and flattens the mesh weave away.
  vec4 surfTint = tint, subTint = tint;
  if (uHasPattern && !uPatternPaintLayer) {
    float noTint = float(tint.w == 0.0);
    float surfT = (tint.w > 0.0 ? clamp(pat.w / tint.w, 0.0, 1.0) : noTint) * patAmt;
    float subT  = max(noTint, pat.w) * patAmt;
    float a = max(tint.w, pat.w * patAmt);
    surfTint = vec4(mix(tint.rgb, pat.rgb, surfT), a);
    subTint  = vec4(mix(tint.rgb, pat.rgb, subT),  a);
  }

  // Tint MASK lives in the albedo's alpha and only decides how much of the
  // tinted colour replaces the raw one. g_fPatternPaintRespectsTintMask=0 lets
  // the pattern force tinting on where the mask says no.
  float surfMask = uRespectsTintMask ? surf.w : max(surf.w, patAmt);
  float subMask  = uRespectsTintMask ? sub.w  : max(sub.w,  patAmt);
  // The tint AMOUNT inside tintPush is the palette's own alpha, NOT that mask.
  // Passing the mask for both (0.58 mean here) undertinted everything by half.
  // The substrate additionally rides g_fSubstrateCompositeColorTranslucency,
  // which was not applied at all.
  float surfAmt = surfTint.w;
  float subAmt  = subTint.w * blend4(uSubTranslucency, w);

  vec3 surfAdj = (vec4(surf.rgb, 1.0) * blendAdj(uSurfAdj, w)).xyz;
  vec3 subAdj  = (vec4(sub.rgb,  1.0) * blendAdj(uSubAdj,  w)).xyz;

  vec3 surfCol = mix(surf.rgb, tintPush(surfAdj, surfTint, surfMetal, surfAmt), surfMask);
  vec3 subCol  = mix(sub.rgb,  tintPush(subAdj,  subTint,  subMetal,  subAmt),  subMask);

  // Wear drives both burnishing and damage. obj.z is the high-touch mask; the
  // height term is the shader's own (a layer only wears where it is proud),
  // where this used to substitute the ambient occlusion.
  float touch = clamp((uWear - 1.0) + obj.z, 0.0, 1.0) * (max(surfP.w, subP.w) + uWear);

  // Burnishing — the polished sheen on rubbed-back areas, and the largest
  // numbers in the material (brightness 2.312 against 1.0 for the other
  // grades). It grades the RAW albedo, not the tinted one, and replaces the
  // tinted colour by its own min/max ramp. Zero at factory new by construction:
  // touch needs wear before saturate((wear-1)+obj.z) leaves 0.
  vec3 surfBurn = (vec4(surf.rgb, 1.0) * blendAdj(uSurfBurnAdj, w)).xyz;
  vec3 subBurn  = (vec4(sub.rgb,  1.0) * blendAdj(uSubBurnAdj,  w)).xyz;
  float surfBurnAmt = ramp(blend4(uSurfBurnMin, w), blend4(uSurfBurnMax, w), touch);
  float subBurnAmt  = ramp(blend4(uSubBurnMin,  w), blend4(uSubBurnMax,  w), touch);
  surfCol = mix(surfCol, surfBurn, surfBurnAmt);
  subCol  = mix(subCol,  subBurn,  subBurnAmt);

  // The other branch: the pattern really is painted over, as a decal on top of
  // the tinted colour. Flames, pinstripes, the dragons and Racer 80 take this.
  if (uHasPattern && uPatternPaintLayer) {
    surfCol = mix(surfCol, pat.rgb, patAmt * (uRespectsTintMask ? surfMask : 1.0));
    subCol  = mix(subCol,  pat.rgb, patAmt * (uRespectsTintMask ? subMask  : 1.0));
  }

  // Surface sits over substrate by the surface layer's height.
  float cover = clamp(surfP.w, 0.0, 1.0);
  vec3 albedo = mix(subCol, surfCol, cover);
  float rough = mix(subRough, surfRough, cover);
  float metal = mix(subMetal, surfMetal, cover);
  float cloth = mix(subCloth, surfCloth, cover);
  // Layer AO times the object-level occlusion, which is g_tObjectProperties.RED
  // (_19374.x in the decompile). Not .y — the three channels of this map are
  // (ao, height, high-touch mask), and .y here means 0.506 where .x means 0.909,
  // so reading .y halved the ambient term over the whole glove and read as a
  // uniformly dark render with otherwise correct hues. Burnished areas are
  // polished back to unoccluded.
  float ao = clamp(mix(subAo, surfAo, cover) * obj.x, 0.0, 1.0);
  ao = mix(ao, 1.0, max(surfBurnAmt, subBurnAmt));

  // Damage carries the height field the bevel would key off.
  float dmg = texture(uDamage, uv).x;
  float grime = texture(uGrime, uv).x;
  float dmgLo = blend4(uDamageMin, w), dmgHi = blend4(uDamageMax, w);
  float wearAmt = ramp(dmgLo, dmgHi, touch * dmg);
  vec3 dmgCol = (vec4(albedo, 1.0) * blendAdj(uDmgAdj, w)).xyz;
  albedo = mix(albedo, tintPush(dmgCol, surfTint, metal, surfAmt), wearAmt);
  rough = mix(rough, rough * blend4(uDmgBevelRough, w), wearAmt);
  metal = mix(metal, blend4(uDmgBevelMetal, w), wearAmt);
  cloth = mix(cloth, blend4(uDmgBevelCloth, w), wearAmt);

  // Grime darkens and roughens by its own per-layer translucency.
  float grimeAmt = grime * blend4(uGrimeTranslucency, w);
  albedo = mix(albedo, albedo * 0.6, grimeAmt);
  rough = mix(rough, 1.0, grimeAmt * 0.5);

  if (uMode == 0) {
    fragColor = vec4(albedo, 1.0);
  } else if (uMode == 1) {
    // (ao, roughness, metalness) — three reads aoMap from .r, roughnessMap from
    // .g and metalnessMap from .b, and the legacy compositor already packs it
    // this way, so one binding serves both generations.
    //
    // CLOTH IS DROPPED HERE. Valve carries it as a fourth surface term feeding a
    // sheen lobe; three's standard material has no such channel, so honouring it
    // would need an onBeforeCompile patch in the style of paintSfx.ts. Matte
    // fabric finishes therefore read slightly harder than the game.
    fragColor = vec4(ao, clamp(rough, 0.0, 1.0), clamp(metal, 0.0, 1.0), 1.0);
  } else {
    vec3 base = decodeObjectNormal(texture(uNormal, uv));
    vec3 sn = decodeLayerNormal(subNraw);
    vec3 fn = decodeLayerNormal(surfNraw);
    // XY-sum composition keeping the base normal's z, matching the legacy port.
    vec3 det = mix(sn, fn, cover);
    vec3 n = normalize(vec3(base.xy + det.xy, base.z));
    fragColor = vec4(n * 0.5 + 0.5, 1.0);
  }
}`;

export interface GloveModernComposite {
  albedo: ThreeNS.Texture;
  rm: ThreeNS.Texture;
  normal: ThreeNS.Texture;
  /** The eight resolve targets, for tools/shadertest's flat-map view — the
   *  boundary between "the composite maths is wrong" and "its inputs were". */
  debug: Record<string, ThreeNS.Texture>;
  /** A texture this finish NAMES failed to load — see GloveComposite. A missing
   *  g_tTintId is exactly this: the glove still composites, as its bare
   *  untinted gradient. */
  incomplete: boolean;
  dispose: () => void;
}

const texCache = new Map<string, Promise<ThreeNS.Texture | null>>();

/**
 * Which inputs the shader sRGB-DECODES on read, off the .vcs variable table
 * (SrgbRead) rather than assumed. Masks, normals and the packed properties maps
 * are raw data; the albedos and the pattern are authored as colour.
 */
const SRGB_READ = new Set([
  ...LAYERS.map((i) => `g_tSubstrate${i}`),
  ...LAYERS.map((i) => `g_tSurface${i}`),
  "g_tPattern",
]);

function loadTex(THREE: Three, path: string, srgb: boolean): Promise<ThreeNS.Texture | null> {
  const key = `${path}|${srgb ? "s" : "l"}`;
  let hit = texCache.get(key);
  if (!hit) {
    hit = new THREE.TextureLoader()
      .loadAsync(paintTextureUrl(path))
      .then((t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = false;
        return t;
      })
      .catch(() => null);
    texCache.set(key, hit);
  }
  return hit;
}

/**
 * Composite one substrate/surface glove finish into albedo + rough/metal/cloth
 * + normal. Eight resolve passes, then three shading passes.
 */
export async function compositeGloveModern(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  def: GloveModernDef,
  /** `seed` is the item's pattern. Absent, the finish's authored placement. */
  opts: { wear: number; size?: number; seed?: number | null },
): Promise<GloveModernComposite | null> {
  const size = opts.size ?? 2048;
  const place = glovePlacement(def, opts.seed);
  const rad = (deg: number) => (deg * Math.PI) / 180;

  const names = [...SINGLES, ...FAMILIES.flatMap((f) => LAYERS.map((i) => `${f}${i}`))];
  const loaded = new Map<string, ThreeNS.Texture | null>();
  await Promise.all(
    names.map(async (n) => {
      if (def.tex[n]) loaded.set(n, await loadTex(THREE, def.tex[n], SRGB_READ.has(n)));
    }),
  );
  const layerId = loaded.get("g_tLayerId");
  if (!layerId) return null;
  const incomplete = names.some((n) => !!def.tex[n] && !loaded.get(n));

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geom);
  scene.add(quad);

  const targets: ThreeNS.WebGLRenderTarget[] = [];
  const makeRT = (srgb = false) => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    // REPEAT, matching how the sources are addressed. A render target defaults
    // to ClampToEdge, which smears the u=0 edge across the whole negative-u
    // hand — the "one glove is untextured" bug from the legacy port.
    rt.texture.wrapS = THREE.RepeatWrapping;
    rt.texture.wrapT = THREE.RepeatWrapping;
    targets.push(rt);
    return rt;
  };
  const prevTarget = renderer.getRenderTarget();
  const runPass = (mat: ThreeNS.ShaderMaterial, rt: ThreeNS.WebGLRenderTarget) => {
    quad.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  };

  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const v4 = (k: string) => {
    const a = def.layer[k] ?? [0, 0, 0, 0];
    return new THREE.Vector4(a[0], a[1], a[2], a[3]);
  };

  // ---- resolve the eight per-layer families ---------------------------------
  // The fabric families ride each layer's own offset; damage and grime one
  // rotation and offset for all four of their layers.
  const famPlace = (fam: Family): { offX: number[]; offY: number[]; rot: number } => {
    if (fam === "g_tDamage" || fam === "g_tGrime") {
      const [ox, oy] = fam === "g_tDamage" ? place.damageOffset : place.grimeOffset;
      return { offX: [ox, ox, ox, ox], offY: [oy, oy, oy, oy], rot: fam === "g_tDamage" ? place.damageRot : place.grimeRot };
    }
    return { offX: place.uvOffset.map((o) => o[0]), offY: place.uvOffset.map((o) => o[1]), rot: 0 };
  };
  const resolved: Record<string, ThreeNS.Texture> = {};
  for (const fam of FAMILIES) {
    const rt = makeRT();
    const fp = famPlace(fam);
    const mat = passMaterial(THREE, VERT, RESOLVE_FRAG, {
      uId: { value: layerId },
      uT1: { value: loaded.get(`${fam}1`) ?? blank },
      uT2: { value: loaded.get(`${fam}2`) ?? loaded.get(`${fam}1`) ?? blank },
      uT3: { value: loaded.get(`${fam}3`) ?? loaded.get(`${fam}1`) ?? blank },
      uT4: { value: loaded.get(`${fam}4`) ?? loaded.get(`${fam}1`) ?? blank },
      // Damage and grime carry their own per-layer scale; everything else
      // rides the shared g_vUvScale<n>.
      uScaleX: {
        value: fam === "g_tDamage" ? v4("g_fDamageUvScale") : fam === "g_tGrime" ? v4("g_fGrimeUvScale") : v4("uvScaleX"),
      },
      uScaleY: {
        value: fam === "g_tDamage" ? v4("g_fDamageUvScale") : fam === "g_tGrime" ? v4("g_fGrimeUvScale") : v4("uvScaleY"),
      },
      uOffX: { value: new THREE.Vector4(fp.offX[0], fp.offX[1], fp.offX[2], fp.offX[3]) },
      uOffY: { value: new THREE.Vector4(fp.offY[0], fp.offY[1], fp.offY[2], fp.offY[3]) },
      uRot: { value: new THREE.Vector2(Math.cos(rad(fp.rot)), Math.sin(rad(fp.rot))) },
    });
    runPass(mat, rt);
    resolved[fam] = rt.texture;
  }

  // ---- shade ----------------------------------------------------------------
  const toMat4 = (rows: number[]) => new THREE.Matrix4().fromArray(rows);
  const adj = (base: string) => def.mat[base].map(toMat4);

  const shadeUniforms = () => ({
    uId: { value: layerId },
    uTintId: { value: loaded.get("g_tTintId") ?? blank },
    uPattern: { value: loaded.get("g_tPattern") ?? blank },
    uPatternProps: { value: loaded.get("g_tPatternProperties") ?? blank },
    uObjProps: { value: loaded.get("g_tObjectProperties") ?? blank },
    uNormal: { value: loaded.get("g_tNormal") ?? blank },
    uSub: { value: resolved.g_tSubstrate },
    uSubN: { value: resolved.g_tSubstrateNormal },
    uSubP: { value: resolved.g_tSubstrateProperties },
    uSurf: { value: resolved.g_tSurface },
    uSurfN: { value: resolved.g_tSurfaceNormal },
    uSurfP: { value: resolved.g_tSurfaceProperties },
    uDamage: { value: resolved.g_tDamage },
    uGrime: { value: resolved.g_tGrime },
    uSurfAdj: { value: adj("g_mSurfaceColorAdjust") },
    uSubAdj: { value: adj("g_mSubstrateColorAdjust") },
    uDmgAdj: { value: adj("g_mDamageColorAdjust") },
    uSurfBurnAdj: { value: adj("g_mSurfaceBurnishingColorAdjust") },
    uSubBurnAdj: { value: adj("g_mSubstrateBurnishingColorAdjust") },
    uIdColor: { value: def.idColor.map((c) => new THREE.Vector4(c[0], c[1], c[2], c[3])) },
    // Numbers, not booleans: the shader takes these as float[8] the way the
    // decompile does, so they multiply the slot weights directly.
    uIdPattern: { value: def.idPattern.map((b) => (b ? 1 : 0)) },
    uDamageMin: { value: v4("g_vDamageMinMax_min") },
    uDamageMax: { value: v4("g_vDamageMinMax_max") },
    uSurfBurnMin: { value: v4("g_vSurfaceBurnishingMinMax_min") },
    uSurfBurnMax: { value: v4("g_vSurfaceBurnishingMinMax_max") },
    uSubBurnMin: { value: v4("g_vSubstrateBurnishingMinMax_min") },
    uSubBurnMax: { value: v4("g_vSubstrateBurnishingMinMax_max") },
    uDmgBevelMetal: { value: v4("g_fDamageBevelMetalness") },
    uDmgBevelCloth: { value: v4("g_fDamageBevelCloth") },
    uDmgBevelRough: { value: v4("g_fDamageBevelRoughnessBrightness") },
    uBurnMetal: { value: v4("g_fBurnishingMetalness") },
    uBurnCloth: { value: v4("g_fBurnishingCloth") },
    uGrimeTranslucency: { value: v4("g_fGrimeTranslucency") },
    uSubTranslucency: { value: v4("g_fSubstrateCompositeColorTranslucency") },
    uPatternXform: {
      value: new THREE.Vector4(
        def.vec.g_vPatternTexCoordScale?.[0] ?? 1,
        def.vec.g_vPatternTexCoordScale?.[1] ?? 1,
        place.patternOffset[0],
        place.patternOffset[1],
      ),
    },
    uPatternRot: { value: new THREE.Vector2(Math.cos(rad(place.patternRot)), Math.sin(rad(place.patternRot))) },
    uPatternCenter: {
      value: new THREE.Vector2(def.vec.g_vPatternTexCoordCenter?.[0] ?? 0.5, def.vec.g_vPatternTexCoordCenter?.[1] ?? 0.5),
    },
    uWear: { value: opts.wear },
    uPatternThreshold: { value: def.scalar.g_fPatternTranslucencyThreshold },
    uHasPattern: { value: def.pattern && !!loaded.get("g_tPattern") },
    uPatternPaintLayer: { value: def.patternPaintLayer },
    uEmboss: { value: def.patternEmboss },
    uRespectsTintMask: { value: def.patternRespectsTintMask },
    uHasTint: { value: def.tintId },
    uMode: { value: 0 },
  });

  const out: ThreeNS.Texture[] = [];
  for (const mode of [0, 1, 2]) {
    const rt = makeRT(mode === 0);
    const u = shadeUniforms();
    u.uMode.value = mode;
    const mat = passMaterial(THREE, VERT, SHADE_FRAG, u);
    runPass(mat, rt);
    out.push(rt.texture);
  }

  renderer.setRenderTarget(prevTarget);
  quad.geometry.dispose();
  blank.dispose();

  return {
    albedo: out[0],
    rm: out[1],
    normal: out[2],
    debug: resolved,
    incomplete,
    dispose: () => targets.forEach((t) => t.dispose()),
  };
}
