/**
 * csgo_customglove.vfx — the glove paint compositor.
 *
 * A SIBLING of paintComposite.ts, not an extension of it. Gloves are composited
 * by a different shader with a different parameter namespace: four material
 * layers blended by a mask, each with its own textile (detail), grunge, detail
 * normal and damage normal, plus per-layer curvature / damage / roughness
 * scalars. Sharing code with the weapon compositor would mean one file trying to
 * be two shaders.
 *
 * Transcribed from the decompiled shader (VCS 71,
 * csgo_customglove_vulkan_50_ps.vcs static combo 0 — 6 combos total, so one
 * dump covers the ordinary case). Kept at
 * tools/shadertest/groundtruth/customglove.glsl.
 *
 * WHY MULTI-PASS
 * --------------
 * The shader samples 21 distinct textures. WebGL2 guarantees only 16 texture
 * units, and this codebase has already been bitten by that — a 17th sampler in
 * the weapon compositor made every skin render black with a single console line.
 *
 * So the four-layer blend is split out. Every per-layer TEXTURE in the original
 * is resolved by the same nested mix over the layer mask:
 *
 *     blend4(a,b,c,d) = mix(mix(mix(a, b, mask.r), c, mask.g), d, mask.b)
 *
 * which means each family can be collapsed to one texture in its own pass
 * without changing the result. Four resolve passes (5 samplers each) reduce
 * detail / grunge / detailNormal / damageNormal to one RT apiece; the shading
 * pass then needs 9. The per-layer SCALARS stay inline — they are cheap and
 * blend by the same mask, which the shading pass still has.
 *
 * WHAT IS EXACT
 *   The layer blend, the detail black-point remap, the curvature power, the
 *   detail roughness contrast/brightness curve, the 2-channel normal decode and
 *   the grunge luma. All read straight off the decompile.
 *
 *   The albedo levels refit — see albedoLevels below. Its constants ARE
 *   recoverable: they are Expression constants in the .vcs variable table, not
 *   engine state, and decoding them is what took gloves from flat tan to their
 *   actual finish colour.
 *
 * COLOUR — TWO PATHS, BOTH IMPLEMENTED
 *   This is where a glove's colour actually lives, and neither path is obvious:
 *
 *   1. PALETTE ACCUMULATION. The layer mask's RGB are the layer weights every
 *      scalar blends by — but its ALPHA is a colour INDEX. floor(a*8) picks one
 *      of eight g_vColorTint slots, and a 9-tap kernel accumulates fractional
 *      weight per slot so region boundaries are soft rather than stair-stepped.
 *      The blur is not a detail to skip; it IS the colour. Result is sRGB.
 *
 *   2. PATTERN PALETTE, which most finishes take (g_bPattern). The pattern's RGB
 *      blends FOUR palette entries chosen by g_vPatternPaletteIndices. Modes 1/3
 *      print over everything; 0/2 REPLACE one palette slot, and that slot's
 *      accumulated weight is the coverage — which is why paletteColour has to
 *      hand its weights back out.
 *
 *   Then a LUMINANCE RETARGET: the palette gives the hue, the detail texture
 *   gives the value, and the colour is renormalised so its luma matches. That is
 *   the glove's equivalent of the weapon compositor's "albedo levels", and
 *   without it the palette renders flat.
 *
 * STILL APPROXIMATE — the surface, not the colour
 *   1. The NORMAL blend is a guess: `n + detailNormal*0.7 + damageNormal*damage`,
 *      and g_fDetailNormalContrast (1.6 on Jade, per layer) is not applied at
 *      all. This is why a glove reads flatter than the game — the leather grain
 *      and the shading around studs live here. Next thing to fix.
 *   2. The wear chain skips the 4-tap damage-edge search, so high floats read
 *      softer than the game. Shape right, edge detail not.
 *   3. The resolve pass uses layer 1's g_fDetailScale for the whole family. On
 *      the finishes measured they agree closely (2.0-2.8), so this is cheap and
 *      near-exact — but it IS a consequence of the multi-pass split, since a
 *      per-texel scale cannot be resolved ahead of the blend.
 */
import type * as ThreeNS from "three";
import { paintFetch, paintTextureUrl } from "./paintComposite";

type Three = typeof ThreeNS;

/** One glove finish, as the shader wants it. Per-layer values are 4-vectors in
 *  layer order so the GLSL can blend them with the same mask it blends textures. */
export interface GlovePaintDef {
  /** Texture paths under /textures, by shader param name. */
  tex: Record<string, string>;
  /** Per-layer scalars, layer 1..4. Missing layers inherit layer 1. */
  layer: Record<string, [number, number, number, number]>;
  /** Whole-material scalars. */
  scalar: Record<string, number>;
  /** Whole-material vectors (colour tints, texcoord transforms). */
  vec: Record<string, number[]>;
  cloth: boolean;
  anisoGloss: boolean;
  pattern: boolean;
  patternMode: number;
  patternReplaceIndex: number;
}

/**
 * Per-parameter defaults, straight off the shader's variable table.
 *
 * Dumped with the shaderdump harness (`vars` mode) rather than guessed — most
 * glove finishes set only a handful of these, so the defaults ARE the look for
 * everything else. Jade, for instance, defines none of them.
 */
const GLOVE_DEFAULTS: Record<string, number> = {
  g_fDetailScale: 4,
  g_fDetailBlackPoint: 0.047,
  g_fDetailRoughnessContrast: 0,
  g_fDetailRoughnessBrightness: 1,
  g_fDetailNormalContrast: 1,
  g_fDetailMetalness: 0,
  g_fDetailCloth: 0,
  g_fDetailGrunge: 0,
  g_fCurvaturePower: 1,
  g_fCurvatureWearBoost: 0,
  g_fGrungeMax: 1,
  g_fGrungeRoughnessBrightness: 0.8,
  g_fDamageRoughnessContrast: 0,
  g_fDamageRoughnessBrightness: 1,
  g_fDamageMetalness: 0,
  g_fDamageBleaching: 0,
  g_fDamageBrightness: 0,
  g_fDamageSaturation: 0,
  g_fDamageCloth: 0,
  g_fDamageEdgeRoughness: 0.8,
  g_fDamageEdgeMetalness: 0,
  g_fDamageNormalEdgeWidth: 0,
  g_fWearBleaching: 0.25,
  g_fGrimeSaturation: 0,
  g_fGrimeBrightness: 0,
};

/** Whole-material scalars, same source as GLOVE_DEFAULTS above. */
const MATERIAL_DEFAULTS: Record<string, number> = {
  g_fColorMaskBlur: 2,
  g_fPaintThickness: 1,
  g_fPaintDurability: 0.5,
  g_fPaintShadowPower: 0,
  g_fPatternRoughnessBrightness: 1,
  g_fPatternMetalness: 0,
  g_fPatternDetailInfluence: 0,
  g_flSheenScale: 0.667,
};

const NUM = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Read a glove finish from the mount.
 *
 * The glove paint vmat is SELF-CONTAINED — unlike a weapon, whose vcompmat
 * points at a template and whose inputs come from a per-weapon `.inputs` bundle,
 * a glove's material names all 21 textures itself, including the layer mask and
 * the surface map. So there is no second fetch and no bundle to match.
 */
export async function loadGlovePaintDef(material: string): Promise<GlovePaintDef | null> {
  // cs2-lib gives a glove finish its VCOMPMAT, the composite document — the same
  // indirection weapons have. Resolve it to the actual paint vmat.
  //
  // There are TWO shapes in the archive and the second is easy to miss:
  //
  //   1459 finishes  container aliased "paint", material in
  //                  m_strSpecificContainerMaterial
  //     22 finishes  container aliased "paint_compositor" holds a SHARED
  //                  compositor material, and the finish's own vmat is a LOOSE
  //                  VARIABLE (m_strResourceMaterial) on the "paint" container
  //
  // Handling only the first left those 22 resolving to null, which means no
  // composite, which means the raw base mesh — and a paintable glove's base is
  // near-black. That was "Sport Gloves | Ultra Violent renders black". Take
  // whichever is present rather than special-casing either.
  let path = material;
  if (/\.vcompmat\.json$/i.test(path)) {
    const comp = (await paintFetch(path)
      .then((r) => r.json())
      .catch(() => null)) as unknown;
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
    const found = specific ?? loose;
    if (!found) return null;
    path = found;
  }
  const doc = (await paintFetch(path)
    .then((r) => r.json())
    .catch(() => null)) as {
    m_shaderName?: string;
    m_textureParams?: { m_name?: string; m_pValue?: string }[];
    m_floatParams?: { m_name?: string; m_flValue?: unknown }[];
    m_intParams?: { m_name?: string; m_nValue?: unknown }[];
    m_vectorParams?: { m_name?: string; m_value?: unknown[] }[];
  } | null;
  // Legacy input generation ONLY — see groundtruth/customglove.glsl.
  //
  // csgo_customglove.vfx carries TWO parameter generations, picked by the
  // S_BACKWARDS_COMPATIBILITY static combo, and 22 finishes use the other one:
  // g_tSubstrate1..4 + g_tSurface1..4 (each with its own Normal/Properties),
  // g_tLayerId, g_tDamage/g_tGrime, g_tObjectProperties, g_tTintId. Only
  // g_tNormal and g_tPattern overlap with the set below. Mapping those names
  // onto ours would render something plausible and wrong, which is worse than
  // rendering nothing — so they answer null and the caller falls back to 2D.
  //
  // Porting it is a separate job, and the groundwork is done:
  // groundtruth/customglove_tint.glsl is the right combo (5 — BACKWARDS_
  // COMPATIBILITY + TINT_ID; NOT combo 1, which compiles the tint palette out
  // entirely and would give a colourless glove). Their textures are already on
  // the mount, so it is pure client-side work. See memory glove-compositor-shape
  // for the decoded layer-weight and tint-palette maths.
  //
  // Note the finish vmat names csgo_customglove_preview.vfx as its shader while
  // the SHARED glove_compositor.vmat it pairs with names csgo_customglove.vfx —
  // the preview vfx is a forward renderer, not a compositor. Detect the
  // generation by its parameters, not by m_shaderName.
  if (!doc || doc.m_shaderName !== "csgo_customglove.vfx") return null;
  if (doc.m_textureParams?.some((t) => t.m_name === "g_tSubstrate1")) return null;

  const tex: Record<string, string> = {};
  for (const t of doc.m_textureParams ?? []) {
    if (t.m_name && typeof t.m_pValue === "string" && t.m_pValue.startsWith("/textures/")) tex[t.m_name] = t.m_pValue;
  }
  const floats = new Map((doc.m_floatParams ?? []).map((p) => [p.m_name ?? "", p.m_flValue]));
  const ints = new Map((doc.m_intParams ?? []).map((p) => [p.m_name ?? "", p.m_nValue]));

  // Per-layer params are named <base>1..<base>4. Layers a material does not
  // define fall back to layer 1, which is what an unused layer resolves to
  // anyway — its mask channel is zero.
  const LAYERED = [
    "g_fDetailScale", "g_fDetailBlackPoint", "g_fDetailBlackPointCompensation",
    "g_fDetailRoughnessContrast", "g_fDetailRoughnessBrightness", "g_fDetailMetalness",
    "g_fDetailCloth", "g_fDetailNormalContrast", "g_fDetailGrunge",
    "g_fDamageRoughnessContrast", "g_fDamageRoughnessBrightness", "g_fDamageSaturation",
    "g_fDamageBrightness", "g_fDamageMetalness", "g_fDamageCloth", "g_fDamageBleaching",
    "g_fCurvaturePower", "g_fCurvatureWearBoost", "g_fDamageNormalEdgeWidth",
    "g_fDamageEdgeRoughness", "g_fDamageEdgeMetalness", "g_fGrungeMax",
    "g_fGrungeRoughnessBrightness", "g_fWearBleaching", "g_fGrimeSaturation", "g_fGrimeBrightness",
  ];
  const layer: Record<string, [number, number, number, number]> = {};
  // g_fDetailBlackPointCompensation is VariableSource=__Expression__ — the
  // shader computes it, so its stored default (0) is meaningless. It exists to
  // remap the detail texture into [blackPoint, 1], which makes it 1 - blackPoint.
  const bpDerived = (i: number) => 1 - NUM(floats.get(`g_fDetailBlackPoint${i}`), GLOVE_DEFAULTS.g_fDetailBlackPoint);
  for (const base of LAYERED) {
    // REAL defaults, read from the shader's own variable table (FloatDefs in
    // VariableDescriptions), not guessed. A "multipliers default to 1" heuristic
    // is WRONG here and expensively so: most of these default to 0, and the ones
    // that don't are not 1 either. Getting DetailScale wrong (4, not 1) made the
    // weave four times too large to read as grain; getting
    // DetailRoughnessContrast wrong (0, not 1) turned leather into glossy
    // plastic. Anything absent here falls back to 0, which is the common case.
    if (base === "g_fDetailBlackPointCompensation") {
      layer[base] = [1, 2, 3, 4].map((i) => NUM(floats.get(`${base}${i}`), bpDerived(i))) as [number, number, number, number];
      continue;
    }
    const first = NUM(floats.get(`${base}1`), GLOVE_DEFAULTS[base] ?? 0);
    layer[base] = [1, 2, 3, 4].map((i) => NUM(floats.get(`${base}${i}`), first)) as [number, number, number, number];
  }

  const scalar: Record<string, number> = {};
  for (const k of ["g_fColorMaskBlur", "g_fPaintThickness", "g_fPaintDurability", "g_fPaintShadowPower",
                   "g_fPatternRoughnessBrightness", "g_fPatternMetalness", "g_fPatternDetailInfluence",
                   "g_flSheenScale"]) {
    scalar[k] = NUM(floats.get(k), MATERIAL_DEFAULTS[k] ?? 0);
  }
  const vec: Record<string, number[]> = {};
  for (const v of doc.m_vectorParams ?? []) {
    if (v.m_name && Array.isArray(v.m_value)) vec[v.m_name] = v.m_value.map((x) => NUM(x, 0));
  }
  return {
    tex,
    layer,
    scalar,
    vec,
    cloth: NUM(ints.get("F_CLOTH_SHADING"), 0) === 1,
    anisoGloss: NUM(ints.get("F_ANISOTROPIC_GLOSS"), 0) === 1,
    pattern: NUM(ints.get("g_bPattern"), 0) === 1,
    patternMode: NUM(ints.get("g_nPatternMode"), 0),
    patternReplaceIndex: NUM(ints.get("g_nPatternReplaceIndex"), 0),
  };
}

// NO explicit #version and NO `uv` attribute — three prepends the directive for
// GLSL3, and a second one is a compile error that renders black with only a
// console line. Same shape paintComposite.ts uses, for the same reason.
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
 * Resolve pass: collapse one family of four per-layer textures into one, using
 * the same nested mix the original applies inline. Five samplers.
 */
const RESOLVE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMask, uT1, uT2, uT3, uT4;
uniform vec2 uScale;      // detail families are sampled at g_fDetailScale
uniform bool uScaled;
uniform vec4 uGrungeXform0, uGrungeXform1;
uniform bool uGrunged;
void main() {
  // Plain [0,1]. The source textures are authored in that range and REPEAT, so
  // the mesh's u of -0.3 wraps to 0.7 — which is exactly how two hands get
  // different layouts out of one atlas. The composite only has to reproduce that
  // addressing, which it does by being a [0,1] texture that also repeats.
  vec2 src = vUv;
  vec3 m = texture(uMask, src).rgb;
  vec2 uv = uScaled ? src * uScale : src;
  if (uGrunged) uv = vec2(dot(src, uGrungeXform0.xy) + uGrungeXform0.w,
                          dot(src, uGrungeXform1.xy) + uGrungeXform1.w);
  vec4 a = texture(uT1, uv), b = texture(uT2, uv), c = texture(uT3, uv), d = texture(uT4, uv);
  fragColor = mix(mix(mix(a, b, m.r), c, m.g), d, m.b);
}`;

/**
 * Shading pass. Nine samplers, three output modes.
 *
 * Per-layer SCALARS arrive as vec4s and blend with the same mask, exactly as
 * the decompile does — `mix(mix(mix(x.x, x.y, m.r), x.z, m.g), x.w, m.b)`.
 */
const SHADE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMask, uSurface, uNormal, uNoise, uPattern;
uniform sampler2D uDetail, uGrunge, uDetailNormal, uDamageNormal;
uniform int uMode;          // 0 albedo, 1 rough/metal(+ao in .r), 2 normal
uniform float uWear;
uniform bool uCloth;
uniform vec4 uCurvaturePower, uCurvatureWearBoost, uDetailBlackPoint, uDetailBlackPointComp;
uniform vec4 uDetailRoughContrast, uDetailRoughBright, uDetailMetalness;
uniform vec4 uDamageBleaching, uDamageBrightness, uDamageSaturation, uDamageMetalness;
uniform vec4 uGrungeMax, uDetailGrunge, uGrimeSaturation, uGrimeBrightness;
uniform vec3 uTint[8];
uniform float uColorMaskBlur;
uniform bool uHasPatternFlag;
uniform int uPatternMode, uPatternReplaceIndex;
uniform ivec4 uPatternPaletteIdx;
uniform vec4 uDamageLevelsA, uDamageLevelsB;   // .xy per layer 1/2 and 3/4
uniform float uPatternMetalness, uPatternRoughBright;
uniform float uPaintThickness;
uniform vec4 uDetailNormalContrast;
uniform vec4 uPatternRotXform0, uPatternRotXform1;
uniform vec4 uPatternXform0, uPatternXform1;

const vec3 LUMA = vec3(0.2125, 0.7154, 0.0721);

/**
 * Valve's "albedo levels" renormalisation — the term that was missing, and the
 * reason gloves came out flat tan instead of their finish colour.
 *
 * g_vTextileAlbedoLevels is an Expression CONSTANT: the material never sets it,
 * the shader computes it from literals at compile time. Decoded from the .vcs
 * variable table's DynExp bytecode with the same rule paintComposite.ts
 * documents — float3(A, -1.4427*log(max(1e-4, 1-B)), 2-C):
 *
 *   g_vTextileAlbedoLevels          (0.045, 0.6, 1.00) -> (0.045, 1.32193, 1.00)
 *   g_vMetallicTextileAlbedoLevels  (0.08,  0.6, 1.08) -> (0.08,  1.32193, 0.92)
 *
 * The first is IDENTICAL to g_vPaintAlbedoLevels, which the weapon compositor
 * derived independently — that agreement is what validates the decode.
 */
const vec3 TEXTILE_LEVELS = vec3(0.045, 1.32193, 1.0);
const vec3 METALLIC_TEXTILE_LEVELS = vec3(0.08, 1.32193, 0.92);

vec3 albedoLevels(vec3 c, vec3 L) {
  vec3 n = normalize(max(vec3(0.0003), c)) * 1.06;
  float lumaBase = dot(clamp(c, 0.0, 1.0), LUMA);
  float maxTerm = max(c.x, max(c.y, c.z));
  vec3 hi = max((n * L.x * 1.732) / vec3(length(n)) / vec3(dot(n, LUMA)),
                n * mix(L.x, L.z, clamp(pow(maxTerm, L.y), 0.0, 1.0)));
  return mix(vec3(L.x), hi, vec3(pow(smoothstep(0.0003, L.x, lumaBase), 0.5)));
}

float blend4(vec4 v, vec3 m) { return mix(mix(mix(v.x, v.y, m.r), v.z, m.g), v.w, m.b); }
/**
 * THE COLOUR. Not a per-layer tint — a PALETTE.
 *
 * The layer mask's RGB are the layer weights every scalar blends by, but its
 * ALPHA is a colour index: floor(a * 8) picks one of eight g_vColorTint slots.
 * A 9-tap kernel accumulates fractional weight per slot, which is what gives
 * soft boundaries between colour regions instead of hard stair-stepping — so
 * the blur is not a detail to skip, it IS how the colour is built.
 *
 * Kernel weights and the 1/1024 tap offset are read straight off the decompile.
 */
const vec3 TAPS[9] = vec3[](
  vec3( 0.0,  0.0, 0.31972790),
  vec3(-1.0, -1.0, 0.05102041),
  vec3(-1.0,  0.0, 0.11904762),
  vec3(-1.0,  1.0, 0.05102041),
  vec3( 0.0, -1.0, 0.11904762),
  vec3( 0.0,  1.0, 0.11904762),
  vec3( 1.0, -1.0, 0.05102041),
  vec3( 1.0,  0.0, 0.11904762),
  vec3( 1.0,  1.0, 0.05102041)
);

/** The tints are authored in sRGB; everything downstream is linear. */
vec3 srgbToLinear(vec3 c) {
  return mix(c * 0.07739938, pow(c * 0.94786733 + vec3(0.05213270), vec3(2.4)),
             step(vec3(0.04045), c));
}

float gPaletteW[8];

/** Accumulate the palette weights AND the colour. The weights are needed twice:
 *  once for the colour, once because a pattern in mode 0/2 REPLACES one palette
 *  slot and its weight is how much of the glove the pattern covers. */
vec3 paletteColour(vec2 uv) {
  for (int i = 0; i < 8; i++) gPaletteW[i] = 0.0;
  for (int t = 0; t < 9; t++) {
    float a = texture(uMask, uv + TAPS[t].xy * 0.0009765625 * uColorMaskBlur).w;
    int slot = int(floor(a * 8.0));
    for (int i = 0; i < 8; i++) if (i == slot) gPaletteW[i] += TAPS[t].z;
  }
  vec3 c = vec3(0.0);
  for (int i = 0; i < 8; i++) c += uTint[i] * gPaletteW[i];
  return srgbToLinear(c);
}

float paletteWeight(int idx) {
  for (int i = 0; i < 8; i++) if (i == idx) return gPaletteW[i];
  return 0.0;
}

/** Four palette entries blended by the pattern's RGB — the second colour path,
 *  and the one most finishes actually take. */
vec3 patternPalette(vec3 pat) {
  vec3 a = uTint[uPatternPaletteIdx.x - 1];
  vec3 b = uTint[uPatternPaletteIdx.y - 1];
  vec3 c = uTint[uPatternPaletteIdx.z - 1];
  vec3 d = uTint[uPatternPaletteIdx.w - 1];
  return mix(mix(mix(a, b, vec3(pat.x)), c, vec3(pat.y)), d, vec3(pat.z));
}

/** Valve's 2-channel normal decode — identical to the weapon and sticker ones. */
vec3 decodeNormal(vec2 t) {
  float nx = (t.x + t.y) - 1.00392163;
  float ny = t.x - t.y;
  return normalize(vec3(nx, ny, (1.0 - abs(nx)) - abs(ny)));
}

void main() {
  // See the resolve pass — plain [0,1], repeating like its sources.
  vec2 src = vUv;
  vec3 m = texture(uMask, src).rgb;
  vec4 surface = texture(uSurface, src);
  // The resolve RTs are already in this bake's own [0,1] space.
  vec4 detail = texture(uDetail, vUv);
  vec4 grunge = texture(uGrunge, vUv);

  // CURVATURE drives where wear lands: creases and raised seams give first.
  float curvature = pow(max(surface.x, 0.0), blend4(uCurvaturePower, m));
  float wear = clamp(uWear * (1.0 + blend4(uCurvatureWearBoost, m) * (1.0 - curvature)), 0.0, 1.0);

  // Detail black point, verbatim: bp + detail.xy * compensation.
  float bp = blend4(uDetailBlackPoint, m);
  float bpc = blend4(uDetailBlackPointComp, m);
  vec2 dRemap = vec2(bp) + detail.xy * bpc;

  // Detail roughness: (contrast * ((1-d.w)^2 * 0.85 - 0.35) + 0.5) * brightness.
  float inv = 1.0 - detail.w;
  float rough = clamp((blend4(uDetailRoughContrast, m) * ((inv * inv) * 0.85 - 0.35) + 0.5)
                      * blend4(uDetailRoughBright, m), 0.0, 1.0);

  // BASE COLOUR: the textile's own value, tinted per layer, then the pattern
  // where the finish has one (a printed glove) replaces it.
  // ---- COLOUR, both paths ----------------------------------------------------
  vec3 baseColour = paletteColour(src);

  // Pattern UV: the material's own 2x3 transform. _23217 in the dump.
  vec2 patUv = vec2(dot(src, uPatternXform0.xy) + uPatternXform0.w,
                    dot(src, uPatternXform1.xy) + uPatternXform1.w);

  vec4 pat = texture(uPattern, patUv);

  // How much of the glove the pattern covers. Modes 1 and 3 print over
  // everything; 0 and 2 REPLACE one palette slot, so its accumulated weight is
  // the coverage — which is why the weights had to come out of paletteColour.
  float patCoverage = 0.0;
  vec3 patColour = vec3(0.0);
  float patPaintCoverage = 0.0;
  if (uHasPatternFlag) {
    patCoverage = (uPatternMode == 1 || uPatternMode == 3)
      ? 1.0
      : paletteWeight(uPatternReplaceIndex);
    // Mode < 2 blends four palette entries by the pattern RGB; 2 and 3 use the
    // pattern texture as literal colour.
    patColour = uPatternMode < 2 ? srgbToLinear(patternPalette(pat.xyz))
                                 : srgbToLinear(pat.xyz);
    if (uPatternMode < 2) patPaintCoverage = clamp(pat.x + pat.y + pat.z, 0.0, 1.0) * patCoverage;
  }

  // ---- WEAR ------------------------------------------------------------------
  // curvature * surface.w, boosted where the surface curves, gated by grunge.w.
  float wearTerm = clamp(curvature * surface.w * grunge.w
                         + blend4(uCurvatureWearBoost, m) * curvature, 0.0, 1.0);
  vec2 dl = mix(mix(mix(uDamageLevelsA.xy, uDamageLevelsA.zw, m.r), uDamageLevelsB.xy, m.g), uDamageLevelsB.zw, m.b);
  float damage = smoothstep(dl.x, dl.y, wearTerm * uWear);
  // How much the PATTERN has worn back to the textile underneath. Runs ahead of
  // damage (4x the wear) and is gated by the detail's own z channel.
  float patWorn = clamp(damage + clamp(smoothstep(dl.x, dl.y, wearTerm * uWear * 4.0), 0.0, 1.0)
                                 * (1.0 - damage) * detail.z, 0.0, 1.0);

  vec3 colour = uHasPatternFlag
    ? mix(baseColour, mix(patColour, baseColour, vec3(patWorn)), vec3(patCoverage))
    : baseColour;

  // ---- LUMINANCE RETARGET ----------------------------------------------------
  // This is the glove equivalent of the weapon's "albedo levels": the palette
  // gives the HUE, the detail texture gives the VALUE, and the colour is
  // renormalised so its luma matches. Without it the palette renders flat.
  float lumaTarget = clamp(mix(dRemap.y, dRemap.x, patWorn), 0.0, 1.0);
  vec3 brightened = max(colour, colour * (1.0 + curvature * 0.5));
  vec3 n = normalize(max(brightened, vec3(0.001)));
  float nl = max(dot(n, LUMA), 0.0001);
  vec3 albedo = clamp(n * min(lumaTarget / nl, 3.0 * lumaTarget * max(brightened.x, max(brightened.y, brightened.z))), 0.0, 1.0);

  // Grime darkens and desaturates on top of everything.
  float grungeLuma2 = dot(grunge.rgb, LUMA);
  float grime = clamp(blend4(uDetailGrunge, m) * (1.0 - grungeLuma2), 0.0, blend4(uGrungeMax, m));
  albedo = mix(albedo, mix(vec3(dot(albedo, LUMA)), albedo, blend4(uGrimeSaturation, m))
                       * blend4(uGrimeBrightness, m), grime);
  // Damage bleaches toward the textile's own worn value.
  albedo = mix(albedo, mix(albedo, vec3(dot(albedo, LUMA)), blend4(uDamageBleaching, m))
                       * (1.0 + blend4(uDamageBrightness, m)), damage);

  // ---- SATURATION PUSH (_11286 in the ground truth) ---------------------------
  // The last thing the shader does to colour, and the difference between a dull
  // teal and the lustrous one CS2 shows.
  //
  // It is NOT a rainbow/iridescence despite looking like one: it takes the
  // colour's direction away from the grey axis (0.577 = 1/sqrt(3)), builds a
  // fully-saturated version of that same hue, renormalises it to preserve
  // luminance, and mixes it in by an amount that RISES AS THE COLOUR DARKENS
  // (pow(1-luma, 3.5)). So dark colours get pulled toward pure hue instead of
  // toward mud — which is why leaving it out made every finish read washed out
  // exactly where it should be richest.
  {
    float halfLuma = dot(albedo, LUMA) * 0.5;
    float lum = dot(colour, LUMA);
    float amt = pow(max(1.0 - lum, 0.0), 3.5) * 0.3
              + length(albedo - vec3(halfLuma)) * 0.15
              + 0.05;
    if (amt > 0.0) {
      const vec3 GREY_AXIS = vec3(0.57700002);
      vec3 dir = normalize(albedo * dot(albedo, LUMA)) - GREY_AXIS;
      // GUARD: a near-grey colour sits ON the grey axis, so dir collapses to
      // zero and normalize(dir) is undefined — in practice it resolves to
      // magenta, which is what put pink rims on the neutral edges of the glove.
      // Valve's own '_6982 > 0' gate does not cover this.
      float dirLen = length(dir);
      vec3 pure = dirLen > 1e-4 ? clamp((dir / dirLen) * 2.0 + 1.0, 0.0, 1.0) : albedo;
      vec3 boosted = pure * (halfLuma / max(dot(pure, LUMA), 1e-4));
      albedo = mix(albedo, boosted,
                   clamp(amt * pow(abs(dot(dir, GREY_AXIS)), 0.2), 0.0, 1.0));
    }
  }
  // SIMPLIFIED: the shader computes this twice from two upstream colours (one
  // grimed, one not) and blends them by g_tNoise weighted by pow(surface.y, 8).
  // That is a per-texel variation in how grimy the push looks; one evaluation
  // gets the hue and the strength right and loses only that mottling.

  if (uMode == 0) {
    // THE REFIT. Without it the textile's raw value is what reaches the screen,
    // which is a flat mid-grey however the finish is tinted — Valve never shows
    // that value directly. Metallic finishes fit against their own levels, so
    // the two are blended by the layer's metalness exactly as the shader does.
    float metalForFit = mix(blend4(uDetailMetalness, m), blend4(uDamageMetalness, m), damage);
    vec3 L = mix(TEXTILE_LEVELS, METALLIC_TEXTILE_LEVELS, clamp(metalForFit, 0.0, 1.0));
    fragColor = vec4(albedoLevels(albedo, L), 1.0);
  } else if (uMode == 1) {
    // .r AO (surface.y is the baked occlusion), .g roughness, .b metalness —
    // the packing three reads as roughnessMap.g / metalnessMap.b.
    // The pattern is PAINT — it has its own metalness and overrides the
    // textile's wherever it covers. This is what stopped Snakebite's leather
    // inheriting the studs' metal and rendering as one silver mass.
    float metal = mix(blend4(uDetailMetalness, m), blend4(uDamageMetalness, m), damage);
    if (uHasPatternFlag) metal = mix(metal, uPatternMetalness, patCoverage * (1.0 - patWorn));
    float ao = surface.y;
    // Cloth reads matte; the flag is the material's own F_CLOTH_SHADING.
    float r = uCloth ? max(rough, 0.55) : rough;
    if (uHasPatternFlag) r *= mix(1.0, uPatternRoughBright, patPaintCoverage * (1.0 - patWorn));
    fragColor = vec4(ao, clamp(r, 0.0, 1.0), clamp(metal, 0.0, 1.0), 1.0);
  } else {
    // NORMAL — three separate contributions, and getting this wrong is what made
    // gloves read as flat plastic with a dead emblem.
    vec3 n = decodeNormal(texture(uNormal, src).xy);
    vec3 dn = decodeNormal(texture(uDetailNormal, vUv).xy);
    vec3 dam = decodeNormal(texture(uDamageNormal, vUv).xy);

    // 1. Detail vs damage normal, then scaled by the material's own CONTRAST.
    //    This is the leather grain, and skipping the contrast (1.6 on Jade) is
    //    most of why the surface looked smooth.
    vec3 surf = mix(dn, dam, damage);
    vec2 detailXY = surf.xy * blend4(uDetailNormalContrast, m);

    // 2. The PATTERN'S OWN RELIEF. A 4-tap diagonal search across the print,
    //    weighted by paint thickness, turns the printed artwork into geometry —
    //    this is what makes the studs and the snake emblem read as RAISED
    //    rather than as a flat decal. Absent entirely before.
    vec2 patN = vec2(0.0);
    if (uHasPatternFlag && uPatternMode < 2) {
      float step = 0.0009765625 * uPaintThickness;
      const vec2 DIAG[4] = vec2[](vec2(-1.0), vec2(-1.0, 1.0), vec2(1.0), vec2(1.0, -1.0));
      for (int i = 0; i < 4; i++) {
        vec3 t = texture(uPattern, patUv + DIAG[i] * step * 2.0).xyz;
        float lo = min(min(t.x, t.z - min(t.x, t.y)), t.y - t.x);
        patN -= DIAG[i] * (1.0 - (t.x + t.y + t.z) * uPaintThickness)
                        * clamp(1.0 - damage, 0.0, 1.0) * patCoverage
                        * (1.0 - lo) * 0.5;
      }
      // The print's own rotation, and the left hand mirrors it.
      patN = vec2(dot(patN, uPatternRotXform0.xy), dot(patN, uPatternRotXform1.xy));
    }

    // 3. Compose by SUMMING XY and keeping the base normal's Z — not a 3D
    //    average. The sum is what preserves fine detail; averaging flattens it,
    //    which is exactly what the old 'normalize(n + dn*0.7)' did.
    vec3 outN = normalize(vec3(n.xy + detailXY + patN, n.z));
    outN.y = -outN.y;
    fragColor = vec4(normalize(outN) * 0.5 + 0.5, 1.0);
  }
}`;

export interface GloveComposite {
  albedo: ThreeNS.Texture;
  rm: ThreeNS.Texture;
  normal: ThreeNS.Texture;
  /** The four resolve targets, for tools/shadertest's flat-map view. Looking at
   *  these is how you tell "the composite maths is wrong" from "its inputs
   *  were" — they are the boundary between the two. */
  debug: { detail: ThreeNS.Texture; grunge: ThreeNS.Texture; detailNormal: ThreeNS.Texture; damageNormal: ThreeNS.Texture };
  dispose: () => void;
}

const texCache = new Map<string, Promise<ThreeNS.Texture | null>>();
/**
 * Which inputs the shader sRGB-DECODES on read.
 *
 * Read off the .vcs variable table (`SrgbRead`), not assumed: masks, normals,
 * the surface map and the detail/textile maps are raw data and must stay raw,
 * but the grunge and noise maps are authored as colour and Valve decodes them.
 * Reading those raw makes them ~2x too bright, which shifts every grime and
 * wear term that multiplies through them.
 */
const SRGB_READ = new Set(["g_tGrunge1", "g_tGrunge2", "g_tGrunge3", "g_tGrunge4", "g_tNoise"]);

function loadTex(THREE: Three, path: string, srgb = false): Promise<ThreeNS.Texture | null> {
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
 * Composite one glove finish into albedo + rough/metal + normal.
 *
 * Seven passes: four resolves collapsing the per-layer texture families, then
 * three shading passes (one per output). See the header for why it is not one.
 */
export async function compositeGlove(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  def: GlovePaintDef,
  opts: { wear: number; size?: number },
): Promise<GloveComposite | null> {
  const size = opts.size ?? 2048;
  const need = (n: string) => def.tex[n];
  if (!need("g_tLayerMask") || !need("g_tSurface")) return null;

  const names = [
    "g_tLayerMask", "g_tSurface", "g_tNormal", "g_tNoise", "g_tPattern",
    ...[1, 2, 3, 4].flatMap((i) => [`g_tDetail${i}`, `g_tGrunge${i}`, `g_tDetailNormal${i}`, `g_tDamageNormal${i}`]),
  ];
  const loaded = new Map<string, ThreeNS.Texture | null>();
  await Promise.all(
    names.map(async (n) => {
      if (def.tex[n]) loaded.set(n, await loadTex(THREE, def.tex[n], SRGB_READ.has(n)));
    }),
  );
  const mask = loaded.get("g_tLayerMask");
  const surface = loaded.get("g_tSurface");
  if (!mask || !surface) return null;

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // One oversized triangle rather than a quad: no seam down the diagonal, and
  // it is what the weapon compositor already uses.
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geom);
  scene.add(quad);
  const targets: ThreeNS.WebGLRenderTarget[] = [];
  const makeRT = (srgb: boolean) => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    // REPEAT, matching how the source textures are addressed. A render target
    // defaults to ClampToEdge, which smeared the u=0 edge across the whole hand
    // whose coordinates are negative — that was the "one glove is untextured"
    // bug, and neither mirroring nor a second bake was ever the answer.
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
    mat.dispose();
  };

  const xform = (name: string, dflt: number[]) => {
    const v = def.vec[name] ?? dflt;
    return new THREE.Vector4(v[0] ?? dflt[0], v[1] ?? dflt[1], v[2] ?? dflt[2], v[3] ?? dflt[3]);
  };

  // ---- 1..4: resolve the per-layer families -----------------------------------
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  blank.needsUpdate = true;
  const resolve = (prefix: string, scaled: boolean, grunged = false) => {
    const rt = makeRT(false);
    const mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: RESOLVE_FRAG,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMask: { value: mask },
        uT1: { value: loaded.get(`${prefix}1`) ?? blank },
        uT2: { value: loaded.get(`${prefix}2`) ?? loaded.get(`${prefix}1`) ?? blank },
        uT3: { value: loaded.get(`${prefix}3`) ?? loaded.get(`${prefix}1`) ?? blank },
        uT4: { value: loaded.get(`${prefix}4`) ?? loaded.get(`${prefix}1`) ?? blank },
        // One scale for the whole family: the original samples every detail
        // family at the same g_fDetailScale, blended by the mask. Using layer
        // 1's is the approximation the resolve split forces — a per-texel scale
        // cannot be resolved ahead of the blend.
        uScale: { value: new THREE.Vector2(def.layer.g_fDetailScale[0] || 1, def.layer.g_fDetailScale[0] || 1) },
        uScaled: { value: scaled },
        uGrunged: { value: grunged },
        uGrungeXform0: { value: xform("g_vGrungeTexCoordXform0", [1, 0, 0, 0]) },
        uGrungeXform1: { value: xform("g_vGrungeTexCoordXform1", [0, 1, 0, 0]) },
      },
    });
    runPass(mat, rt);
    return rt.texture;
  };
  const detail = resolve("g_tDetail", true);
  const grunge = resolve("g_tGrunge", false, true);
  const detailNormal = resolve("g_tDetailNormal", true);
  const damageNormal = resolve("g_tDamageNormal", true);

  // ---- 5..7: shade ------------------------------------------------------------
  const v4 = (k: string) => new THREE.Vector4(...def.layer[k]);
  // EIGHT, not four — the palette the mask's alpha indexes into.
  const tints = Array.from({ length: 8 }, (_, i) => {
    const t = def.vec[`g_vColorTint${i + 1}`] ?? [1, 1, 1];
    return new THREE.Vector3(t[0] ?? 1, t[1] ?? 1, t[2] ?? 1);
  });
  // 1-based in the schema; the shader subtracts one. Defaulted so a material
  // with no indices still addresses real slots rather than reading out of range.
  const pi = def.vec.g_vPatternPaletteIndices ?? [1, 2, 3, 4];
  const paletteIdx = new THREE.Vector4(
    Math.min(8, Math.max(1, pi[0] ?? 1)),
    Math.min(8, Math.max(1, pi[1] ?? 2)),
    Math.min(8, Math.max(1, pi[2] ?? 3)),
    Math.min(8, Math.max(1, pi[3] ?? 4)),
  );
  // Damage levels are a vec2 PER LAYER; packed two layers to a vec4 so the
  // shader can blend them with the same mask as everything else.
  const dmgLevels = (from: number) => {
    const a = def.vec[`g_vDamageLevels${from + 1}`] ?? [0, 1];
    const b = def.vec[`g_vDamageLevels${from + 2}`] ?? a;
    return new THREE.Vector4(a[0] ?? 0, a[1] ?? 1, b[0] ?? 0, b[1] ?? 1);
  };
  const shade = (mode: number, srgb: boolean) => {
    const rt = makeRT(srgb);
    const mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SHADE_FRAG,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMask: { value: mask },
        uSurface: { value: surface },
        uNormal: { value: loaded.get("g_tNormal") ?? blank },
        uNoise: { value: loaded.get("g_tNoise") ?? blank },
        uPattern: { value: loaded.get("g_tPattern") ?? blank },
        uDetail: { value: detail },
        uGrunge: { value: grunge },
        uDetailNormal: { value: detailNormal },
        uDamageNormal: { value: damageNormal },
        uMode: { value: mode },
        uWear: { value: opts.wear },
        uCloth: { value: def.cloth },
        uCurvaturePower: { value: v4("g_fCurvaturePower") },
        uCurvatureWearBoost: { value: v4("g_fCurvatureWearBoost") },
        uDetailBlackPoint: { value: v4("g_fDetailBlackPoint") },
        uDetailBlackPointComp: { value: v4("g_fDetailBlackPointCompensation") },
        uDetailRoughContrast: { value: v4("g_fDetailRoughnessContrast") },
        uDetailRoughBright: { value: v4("g_fDetailRoughnessBrightness") },
        uDetailMetalness: { value: v4("g_fDetailMetalness") },
        uDamageBleaching: { value: v4("g_fDamageBleaching") },
        uDamageBrightness: { value: v4("g_fDamageBrightness") },
        uDamageSaturation: { value: v4("g_fDamageSaturation") },
        uDamageMetalness: { value: v4("g_fDamageMetalness") },
        uGrungeMax: { value: v4("g_fGrungeMax") },
        uDetailGrunge: { value: v4("g_fDetailGrunge") },
        uGrimeSaturation: { value: v4("g_fGrimeSaturation") },
        uGrimeBrightness: { value: v4("g_fGrimeBrightness") },
        uTint: { value: tints },
        // 0 would collapse the 9 taps onto one texel — a hard-edged palette.
        uColorMaskBlur: { value: def.scalar.g_fColorMaskBlur || 1 },
        uHasPatternFlag: { value: def.pattern && !!loaded.get("g_tPattern") },
        uPatternMode: { value: def.patternMode },
        uPatternReplaceIndex: { value: def.patternReplaceIndex },
        uPatternPaletteIdx: { value: paletteIdx },
        uPatternMetalness: { value: def.scalar.g_fPatternMetalness },
        uPatternRoughBright: { value: def.scalar.g_fPatternRoughnessBrightness || 1 },
        uPaintThickness: { value: def.scalar.g_fPaintThickness },
        uDetailNormalContrast: { value: v4("g_fDetailNormalContrast") },
        uPatternRotXform0: { value: xform("g_vPatternTexRotationXform0", [1, 0, 0, 0]) },
        uPatternRotXform1: { value: xform("g_vPatternTexRotationXform1", [0, 1, 0, 0]) },
        uPatternXform0: { value: xform("g_vPatternTexCoordXform0", [1, 0, 0, 0]) },
        uPatternXform1: { value: xform("g_vPatternTexCoordXform1", [0, 1, 0, 0]) },
        uDamageLevelsA: { value: dmgLevels(0) },
        uDamageLevelsB: { value: dmgLevels(2) },
      },
    });
    runPass(mat, rt);
    return rt.texture;
  };
  const albedo = shade(0, true);
  const rm = shade(1, false);
  const normal = shade(2, false);

  renderer.setRenderTarget(prevTarget);
  quad.geometry.dispose();
  return {
    albedo,
    rm,
    normal,
    debug: { detail, grunge, detailNormal, damageNormal },
    dispose: () => {
      targets.forEach((t) => t.dispose());
      blank.dispose();
    },
  };
}
