/**
 * A charm's own materials: dressing the shared blank, and the seed-driven
 * shading correction the game applies on top.
 *
 * This used to live inside buildViewer, which was fine while a charm only ever
 * existed as something hanging off a weapon. It cannot stay there now that a
 * charm can BE the mounted model: the attached path and the standalone path have
 * to dress the mesh identically, and the way to guarantee that is one
 * implementation rather than two that look the same today.
 *
 * `THREE` is threaded in as a parameter rather than imported, matching the rest
 * of the viewer: three is dynamically imported once (see loadThree) so it never
 * lands in the main bundle, and a static import here would undo that.
 */
import type * as ThreeNS from "three";
import {
  parseCharmLiquid,
  patchCharmLiquidShader,
  resolveCharmLiquid,
  setCharmLiquidUniforms,
  type ResolvedLiquid,
} from "./charmLiquid";
import { paintTextureUrl } from "./paintComposite";

type Three = typeof ThreeNS;

/** Per-material shading correction — see tuneCharmShading and the backend's
 *  charm-shading.json. Absent for every material that needs none. */
export interface CharmShading {
  metalness?: number;
  roughness?: number;
  roughnessOffset?: number;
  /**
   * `/textures/…webp` — WHICH TEXELS the pattern grade applies to.
   *
   * `g_tTintMask`, on 53 of the 82 corrected materials. Without it the grade
   * covers the whole charm, which is wrong for most of them: a pattern that
   * should sweep the shell of a charm was sweeping its face and its metal too.
   * See CHARM_ADJUST_GLSL for the blend the game ends on.
   */
  tintMask?: string;
  /** The roughness adjust is faded by the mask as well — see charmTune. */
  maskRoughness?: boolean;
  /** Seed-driven shader params as decoded expression trees — see evalVfx. */
  dynamic?: Record<string, VfxNode>;
  /**
   * `csgo_simple_liquid.vfx`'s params, when this material is on that shader.
   *
   * Two materials, both Charm | Butane Buddy's. Untyped here and validated in
   * charmLiquid's parseCharmLiquid, which is the module that knows the shape.
   */
  liquid?: Record<string, unknown>;
}
export type VfxNode = number | { f: string; a: VfxNode[] };

/**
 * Evaluate a decoded Source 2 dynamic expression for one charm pattern.
 *
 * `t` is the pattern normalised to [0,1]: CS2 hands the shader
 * `$KeychainSeed` already scaled, and 1..100000 is the range the game uses.
 * Verified against the published Semi-Precious colour ramp — its
 * `lerp(-140, 10, seed)` puts pattern 25000 at hue 172 (teal), matching the
 * community pattern guide band for band.
 */
export function evalVfx(node: VfxNode, t: number): number[] {
  if (typeof node === "number") return [node];
  const a = node.a.map((n) => evalVfx(n, t));
  const s = (i: number) => a[i][0];
  switch (node.f) {
    case "seed": return [t];
    case "neg": return [-s(0)];
    case "+": return [s(0) + s(1)];
    case "-": return [s(0) - s(1)];
    case "*": return [s(0) * s(1)];
    case "/": return [s(1) === 0 ? 0 : s(0) / s(1)];
    case "%": return [s(1) === 0 ? 0 : s(0) % s(1)];
    case "lerp": return [s(0) + (s(1) - s(0)) * s(2)];
    case "frac": return [s(0) - Math.floor(s(0))];
    case "floor": return [Math.floor(s(0))];
    case "saturate": return [Math.min(1, Math.max(0, s(0)))];
    case "clamp": return [Math.min(s(2), Math.max(s(1), s(0)))];
    case "min": return [Math.min(s(0), s(1))];
    case "max": return [Math.max(s(0), s(1))];
    case "abs": return [Math.abs(s(0))];
    case "sqrt": return [Math.sqrt(Math.max(0, s(0)))];
    case "pow": return [Math.pow(s(0), s(1))];
    case "sin": return [Math.sin(s(0))];
    case "cos": return [Math.cos(s(0))];
    case "step": return [s(1) >= s(0) ? 1 : 0];
    // Comparisons are 1.0/0.0 and get MULTIPLIED, not branched on — Source 2
    // compiles `a * (seed <= 0.5) + b * (seed > 0.5)` rather than an if. Charm |
    // That's Bananas splits its ramp at the halfway pattern this way.
    case "==": return [s(0) === s(1) ? 1 : 0];
    case "!=": return [s(0) !== s(1) ? 1 : 0];
    case ">": return [s(0) > s(1) ? 1 : 0];
    case ">=": return [s(0) >= s(1) ? 1 : 0];
    case "<": return [s(0) < s(1) ? 1 : 0];
    case "<=": return [s(0) <= s(1) ? 1 : 0];
    case "&&": return [s(0) && s(1) ? 1 : 0];
    case "||": return [s(0) || s(1) ? 1 : 0];
    case "!": return [s(0) ? 0 : 1];
    case "float2": return [s(0), s(1)];
    case "float3": return [s(0), s(1), s(2)];
    case "float4": return [s(0), s(1), s(2), s(3)];
    // Anything else is a function no charm on this build uses. Returning the
    // first argument keeps a future material rendering rather than blank.
    default: return a[0] ?? [0];
  }
}

/** Does this expression tree actually read the pattern? */
function hasSeedLeaf(node: VfxNode): boolean {
  if (typeof node === "number") return false;
  return node.f === "seed" || node.a.some(hasSeedLeaf);
}

/**
 * Does this material's look VARY with the pattern?
 *
 * Not the same question as "does it have dynamic params": a dynamic expression
 * can be a constant folded by the compiler, and a material can carry a static
 * metalness/roughness correction while ignoring the seed entirely. Only a
 * `$KeychainSeed` leaf makes the pattern matter, which is what the pattern rail
 * needs to know before it offers to browse a space that has nothing in it.
 */
export function seedDrivenShading(tune?: CharmShading): boolean {
  const dyn = tune?.dynamic;
  return !!dyn && Object.entries(dyn).some(([name, node]) => HONOURED.has(name) && hasSeedLeaf(node));
}

/**
 * The params charmTune actually honours.
 *
 * A material can drive glitter, iridescence, a liquid level or a detail-texture
 * rotation from the pattern, and this renderer implements none of those — so a
 * charm whose pattern only touches them renders IDENTICALLY at every value, and
 * a rail over it is a control that provably does nothing. Whether the game shows
 * a difference is a separate question from whether we can, and this one is ours.
 */
const HONOURED = new Set([
  "g_fHueShift",
  "g_fSaturation",
  "g_fBrightness",
  "g_fContrast",
  "g_vMetalnessRemapRange",
  "g_fTextureRoughnessContrast",
  "g_fTextureRoughnessBrightness",
  // csgo_simple_liquid's two seed-driven params, which is the whole of Charm |
  // Butane Buddy's pattern space: a full hue sweep on the butane and a fill
  // level that cycles. Listing them is what lets the rail offer that space —
  // until they were here the one charm with a liquid reported as pattern-inert.
  "g_flLiquidColorHueShift",
  "g_flLiquidLevelHeight",
]);

/**
 * The shading map's key for a material path.
 *
 * charm-shading.json is keyed by the vmat stem the econ schema names; the
 * extracted file carries the CDN's `_<8hex>` suffix on top. Shared so the rail
 * and the renderer cannot drift on the derivation — they did not before only
 * because there was exactly one caller.
 */
export function charmMaterialName(material: string): string {
  return material
    .split("/")
    .pop()!
    .replace(/\.vmat\.json$/i, "")
    .replace(/_[0-9a-f]{8}$/i, "");
}

/*
 * There was a charmSeedAffects() here that answered "does this charm's pattern
 * do anything" from the econ spec alone. It is gone deliberately.
 *
 * For a charm that owns its model it could only GUESS — matching the shading
 * map's keys against the model stem — and a guess that misses reads as "this
 * charm looks the same at every pattern", which is a confident lie about a
 * charm the renderer is re-shading perfectly well. Charm | Glitter Bomb was
 * exactly that.
 *
 * The question is now answered where the evidence is: PatternRail's resolve(),
 * against the material the MOUNTED MODEL reports it tuned. See it for the order
 * of authority and for why an unsettled charm stays draggable.
 */
/** The colour knobs csgo_weapon.vfx grades with — see charmAdjustSrgb. */
export interface CharmAdjust {
  /** `g_fHueShift`, in RADIANS: the shader's cos/sin take them that way. */
  hueRad: number;
  sat: number;
  contrast: number;
  bright: number;
}

interface CharmTune extends CharmAdjust {
  /** `g_fTextureRoughnessContrast` / `Brightness`, UNFOLDED — the shader applies
   *  `((r - 0.5) * contrast + 0.5) * brightness`. Kept as the two knobs rather
   *  than the affine pair the map ships because a mask lerps each toward 1. */
  roughContrast: number;
  roughBright: number;
  metalness?: number;
  /** True when any colour knob is off identity at THIS pattern. */
  graded: boolean;
  /** Present only on a `csgo_simple_liquid` material — see charmLiquid.ts. */
  liquid?: ResolvedLiquid;
}

/**
 * Resolve a material's shading at one pattern.
 *
 * Split out of tuneCharmShading so the pattern rail can ask what a seed looks
 * like without a renderer, a model, or a GL context — which is the whole reason
 * the rail can paint 100000 patterns instantly instead of rendering a hundred.
 */
function charmTune(tune: CharmShading, seed: number): CharmTune {
  // CS2 hands the shader the pattern normalised over its 1..100000 range.
  const t = Math.min(1, Math.max(0, seed / 100000));
  const dyn = tune.dynamic ?? {};
  const one = (name: string, dflt: number) => (dyn[name] ? evalVfx(dyn[name], t)[0] : dflt);
  const hueDeg = one("g_fHueShift", 0);
  const sat = one("g_fSaturation", 1);
  const bright = one("g_fBrightness", 1);
  const contrast = one("g_fContrast", 1);
  // Seed-driven params OVERRIDE the material's baked constants — the baked
  // value is just whatever pattern the artist authored against.
  let metalness = tune.metalness;
  if (dyn.g_vMetalnessRemapRange) {
    const range = evalVfx(dyn.g_vMetalnessRemapRange, t);
    if (range.length >= 2) metalness = range[1];
  }
  // Roughness. The map ships the two knobs already folded into `scale`/`offset`
  // (scale = c*b, offset = b*0.5*(1-c)), which is exact — but only at full mask.
  // Where the mask fades the adjust the game lerps each KNOB toward 1, so unfold
  // it back: b = scale + 2*offset, c = scale/b, both exactly recoverable.
  let roughContrast = 1;
  let roughBright = 1;
  if (tune.roughness !== undefined || tune.roughnessOffset !== undefined) {
    const scale = tune.roughness ?? 1;
    const offset = tune.roughnessOffset ?? 0;
    const b = scale + 2 * offset;
    if (Math.abs(b) > 1e-6) {
      roughBright = b;
      roughContrast = scale / b;
    }
  }
  if (dyn.g_fTextureRoughnessContrast || dyn.g_fTextureRoughnessBrightness) {
    roughContrast = one("g_fTextureRoughnessContrast", 1);
    roughBright = one("g_fTextureRoughnessBrightness", 1);
  }
  // The liquid resolves against the SAME seed-driven map — `one` is exactly the
  // evaluator its two params need, so the pattern reaches the butane's hue and
  // fill level by the same route it reaches everything else's colour.
  const liq = parseCharmLiquid(tune.liquid);
  return {
    hueRad: (hueDeg * Math.PI) / 180,
    sat,
    contrast,
    bright,
    roughContrast,
    roughBright,
    metalness,
    graded: hueDeg !== 0 || sat !== 1 || bright !== 1 || contrast !== 1,
    ...(liq ? { liquid: resolveCharmLiquid(liq, one) } : {}),
  };
}

/** What a pattern grades to, for callers with no renderer. See charmTune. */
export function charmSeedAdjust(tune: CharmShading, seed: number): CharmAdjust {
  const { hueRad, sat, contrast, bright } = charmTune(tune, seed);
  return { hueRad, sat, contrast, bright };
}

/**
 * The liquid at one pattern, for the same callers — null on any other material.
 *
 * Exists so the pattern rail can ask "what colour is this pattern" of a charm
 * whose colour is not in its albedo. See liquidSwatch.
 */
export function charmSeedLiquid(tune: CharmShading, seed: number): ResolvedLiquid | null {
  return charmTune(tune, seed).liquid ?? null;
}

const LUM = [0.2125, 0.7154, 0.0721] as const;
/** 1/sqrt(3) — the normalised RGB grey axis the hue rotation turns about. */
const GREY_AXIS = 0.57735027;

/**
 * csCharmAdjust, in JS, over sRGB bytes — the same grade the shader applies.
 *
 * Transcribed from CHARM_ADJUST_GLSL below rather than approximated with a CSS
 * hue-rotate filter, because the two disagree exactly where it matters: CSS
 * rotates every pixel equally, while the game fades the rotation out on
 * near-grey pixels by `pow(hsvSaturation, 0.125)`. That fade is the shader's own
 * near-grey fallback, so a rail drawn without it would promise colours on chrome
 * the render never shows.
 *
 * `mask`, when given, is the authored answer to the same question and outranks
 * that fallback: an RGBA tile of the material's `g_tTintMask` at the same size,
 * read on .r, blended exactly as the shader blends it. Without one every texel
 * grades, which is what the game does for a material with no mask.
 *
 * Mutates RGBA in place. The GLSL's sRGB encode/decode wrapper is deliberately
 * absent: canvas bytes are already sRGB, which is the space the game grades in.
 * Both clamps ARE explicit: the contrast one feeds the rest of the math, and the
 * final one feeds the mask blend — leaving either to Uint8ClampedArray would
 * clamp after the mix instead of before it, which is a different colour.
 */
export function charmAdjustSrgb(px: Uint8ClampedArray, adj: CharmAdjust, mask?: Uint8ClampedArray | null): void {
  const ca = Math.cos(adj.hueRad);
  const sa = Math.sin(adj.hueRad);
  const k = GREY_AXIS;
  for (let i = 0; i < px.length; i += 4) {
    // Contrast about mid-grey, then brightness.
    const r = Math.min(1, Math.max(0, (0.5 + (px[i] / 255 - 0.5) * adj.contrast) * adj.bright));
    const g = Math.min(1, Math.max(0, (0.5 + (px[i + 1] / 255 - 0.5) * adj.contrast) * adj.bright));
    const b = Math.min(1, Math.max(0, (0.5 + (px[i + 2] / 255 - 0.5) * adj.contrast) * adj.bright));
    const mx = Math.max(r, g, b);
    const hsvSat = mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
    // Rodrigues about the grey axis. cross(K, c) collapses to k * (b-g, r-b, g-r)
    // because every component of K is the same.
    const axial = k * (r + g + b) * k * (1 - ca);
    const rotR = r * ca + k * (b - g) * sa + axial;
    const rotG = g * ca + k * (r - b) * sa + axial;
    const rotB = b * ca + k * (g - r) * sa + axial;
    const fade = Math.pow(hsvSat, 0.125);
    const lum = r * LUM[0] + g * LUM[1] + b * LUM[2];
    const hueR = lum + (rotR - lum) * fade;
    const hueG = lum + (rotG - lum) * fade;
    const hueB = lum + (rotB - lum) * fade;
    const hueLum = hueR * LUM[0] + hueG * LUM[1] + hueB * LUM[2];
    // The mask blends against the ORIGINAL texel, not the contrasted one — the
    // shader's mix takes the untouched albedo as its first argument, so contrast
    // and brightness are masked off with everything else.
    const m = mask && mask.length === px.length ? mask[i] / 255 : 1;
    const outR = hueLum + (hueR - hueLum) * adj.sat;
    const outG = hueLum + (hueG - hueLum) * adj.sat;
    const outB = hueLum + (hueB - hueLum) * adj.sat;
    px[i] = px[i] + (255 * Math.min(1, Math.max(0, outR)) - px[i]) * m;
    px[i + 1] = px[i + 1] + (255 * Math.min(1, Math.max(0, outG)) - px[i + 1]) * m;
    px[i + 2] = px[i + 2] + (255 * Math.min(1, Math.max(0, outB)) - px[i + 2]) * m;
  }
}

/**
 * csgo_weapon.vfx's colour adjustment, transcribed from the decompiled shader
 * rather than reinvented — see tools/shadertest/groundtruth/weapon_tintmask.glsl,
 * which is static combo 33 (S_ENABLE_ADJUSTMENTS + S_TINT_MASK) of
 * csgo_weapon_vulkan_50_ps.vcs.
 *
 * Order matters and is not the obvious one: CONTRAST and BRIGHTNESS first, then
 * the hue rotation, then saturation. The hue rotation is Rodrigues about the
 * RGB grey axis — not an HSV round trip — and it is faded out on near-grey
 * pixels by `pow(hsvSaturation, 0.125)`.
 *
 * THEN THE WHOLE THING IS MASKED. The shader's last step is
 * `mix(albedo, graded, g_tTintMask.r)`, and 53 of the 82 charm materials bind a
 * mask — so the grade is not a property of the material, it is a property of
 * each texel. Missing that made every pattern recolour the entire charm: Lil'
 * Vino's wine changed hue and so did the bottle, the cork and the label.
 * The near-grey fade above is the fallback for materials with no mask, not the
 * mechanism; it was doing a job it was never meant to do alone.
 *
 * Applied in sRGB: the game grades the texture as authored, so the linear
 * sample three hands us has to be encoded, adjusted and decoded again.
 * Verified against Valve's own ramp — Semi-Precious at pattern 25000 lands on
 * hue 172 (teal), matching the published pattern guide band for band.
 */
const charmAdjustGlsl = (hasMapUv: boolean) => `
uniform vec2 uRoughAdjust;
uniform vec4 uColorAdjust;
uniform vec2 uCharmMask;
uniform sampler2D uTintMask;
float csCharmMask() {
  ${
    // `vMapUv` is only declared when the material HAS a map, and a charm
    // material without one has no albedo for a mask to be in register with
    // either — so that case grades whole rather than failing to compile.
    hasMapUv ? "return uCharmMask.x > 0.5 ? texture2D( uTintMask, vMapUv ).r : 1.0;" : "return 1.0;"
  }
}
vec3 csToSrgb( vec3 c ) {
  c = max( c, vec3( 0.0 ) );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
vec3 csToLinear( vec3 c ) {
  c = max( c, vec3( 0.0 ) );
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
vec3 csCharmAdjust( vec3 linear ) {
  const vec3 W = vec3( 0.2125, 0.7154, 0.0721 );
  vec3 c = csToSrgb( linear );
  vec3 authored = c;
  c = clamp( mix( vec3( 0.5 ), c, uColorAdjust.z ) * uColorAdjust.w, 0.0, 1.0 );
  float mx = max( c.r, max( c.g, c.b ) );
  float hsvSat = mx == 0.0 ? 0.0 : ( mx - min( c.r, min( c.g, c.b ) ) ) / mx;
  const vec3 K = vec3( 0.57735027 );
  float ca = cos( uColorAdjust.x ), sa = sin( uColorAdjust.x );
  vec3 rot = c * ca + cross( K, c ) * sa + K * dot( K, c ) * ( 1.0 - ca );
  vec3 hued = mix( vec3( dot( c, W ) ), rot, pow( hsvSat, 0.125 ) );
  vec3 outC = clamp( mix( vec3( dot( hued, W ) ), hued, uColorAdjust.y ), 0.0, 1.0 );
  return csToLinear( mix( authored, outC, csCharmMask() ) );
}`;

/**
 * Correct the raw texture channels to what csgo_weapon.vfx actually renders.
 *
 * The decompiler bakes the metalness/roughness channels straight into the GLB,
 * and the game does not use them straight: each material declares a metalness
 * remap range and an affine roughness adjust. Charm | Sasquatch authors its
 * eyes at metalness 1 while declaring a range of [0, 0.5] — so we rendered
 * chrome mirrors where the game shows dull white.
 *
 * Matched on MATERIAL NAME, which the decompiler sets to the vmat stem. That
 * matters because the clasp is a separate material shared across a whole
 * collection: keyed by charm instead, one charm's tuning would land on
 * everyone's chain.
 *
 * SAFE TO RE-RUN on an already-tuned model, which is what makes scrubbing a
 * pattern live possible: the second call finds the material this mesh already
 * owns and writes the new numbers into the very Vector2/Vector4 the uniforms
 * are bound to. No clone, no program recompile, no `needsUpdate` — so dragging
 * the rail recolours at frame rate instead of rebuilding the charm per tick.
 *
 * `masks` is the tint masks already loaded — see loadCharmTintMasks, which the
 * caller awaits first. Kept out of here so this stays SYNCHRONOUS: it is called
 * per tick of a pattern drag, and a mask does not change with the pattern.
 */

export function tuneCharmShading(
  THREE: Three,
  model: ThreeNS.Object3D,
  shading: Record<string, CharmShading>,
  seed: number,
  masks?: Map<string, ThreeNS.Texture> | null,
) {
  if (!shading || !Object.keys(shading).length) return;
  model.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mat = mesh.material as ThreeNS.MeshStandardMaterial;
    const tune = mat && shading[mat.name];
    if (!tune) return;
    const v = charmTune(tune, seed);
    // Already ours? Then the uniforms are live objects and a re-shade is three
    // assignments. Identity-checked against THIS mesh's current material rather
    // than a boolean flag: the model comes out of a shared LRU, so a stale flag
    // on a re-cloned mesh would have us writing into a Vector4 no program reads.
    if (mesh.userData.charmTuned === mat) {
      (mat.userData.colorAdjust as ThreeNS.Vector4).set(v.hueRad, v.sat, v.contrast, v.bright);
      (mat.userData.roughAdjust as ThreeNS.Vector2).set(v.roughContrast, v.roughBright);
      if (v.metalness !== undefined) mat.metalness = v.metalness;
      // Same deal for the liquid: its hue and fill level are seed-driven, so a
      // rail drag has to reach them without rebuilding the program.
      if (v.liquid) setCharmLiquidUniforms(THREE, mat, v.liquid);
      return;
    }
    // Clone whenever the shading is SEED-DRIVEN, even where this particular
    // pattern happens to land on identity. Deciding per seed instead would mean
    // a scrub that starts on an identity pattern owns nothing, and the first
    // drag past it would have to swap the material mid-gesture — a program
    // recompile and a visible hitch, exactly where the motion should be smooth.
    // A material the seed cannot touch still takes the old early exit, so an
    // untouched charm keeps sharing the cached material and its program.
    const seedDriven = seedDrivenShading(tune);
    if (
      !seedDriven &&
      !v.liquid &&
      v.roughContrast === 1 &&
      v.roughBright === 1 &&
      !v.graded &&
      v.metalness === undefined
    )
      return;
    // CLONED, not mutated in place: the gltf comes out of a shared LRU and the
    // tuning is seed-dependent, so two viewers showing the same charm at
    // different patterns would otherwise overwrite each other's colour. (It
    // was safe to mutate in place while every correction was a constant.)
    const owned = mat.clone();
    owned.name = mat.name;
    mesh.material = owned;
    mesh.userData.charmTuned = owned;
    // Does THIS material's look move with the pattern? Recorded on the material
    // because a charm can own several and they need not agree: Butane Buddy's
    // outer shell is seed-driven while its inner liquid volume is static, and
    // charmAlbedoTile has to hand the rail the one that varies or the rail
    // declares the whole charm inert. Written even when false — the absence of
    // the flag would otherwise be indistinguishable from an untuned material.
    owned.userData.charmSeedDriven = seedDriven;
    if (v.metalness !== undefined) owned.metalness = v.metalness;
    // Roughness rides the uniform whole — `roughness` stays 1 — because the
    // game's adjust is `((r - 0.5) * contrast + 0.5) * brightness` and neither
    // knob is a plain multiplier three can carry. One uniform, so every tuned
    // charm still shares one program.
    owned.roughness = 1;
    owned.userData.roughAdjust = new THREE.Vector2(v.roughContrast, v.roughBright);
    owned.userData.colorAdjust = new THREE.Vector4(v.hueRad, v.sat, v.contrast, v.bright);
    // The sampler is declared and BOUND on every tuned charm, masked or not —
    // a 1x1 white stands in where there is no mask. Branching the source
    // instead would compile a second program and cost a hitch mid-scrub, and
    // one extra texture unit is nothing on a material with four.
    // A material is on csgo_weapon OR csgo_simple_liquid, never both, so the
    // liquid's `g_tLiquidMask` rides this same slot rather than costing a second
    // sampler — see loadCharmTintMasks, which loads whichever one the material
    // names under exactly the same two rules (the albedo's flipY, NoColorSpace).
    const mask = masks?.get(mat.name) ?? null;
    owned.userData.tintMask = mask ?? whiteTexture(THREE);
    owned.userData.charmMask = new THREE.Vector2(mask ? 1 : 0, mask && tune.maskRoughness ? 1 : 0);
    // Bound before the uniforms are seeded: setCharmLiquidUniforms reads whether
    // a roughness map is present to decide between it and the constant.
    const lqRough = masks?.get(`${mat.name}\u0000rough`) ?? null;
    owned.userData.lqRough = lqRough ?? whiteTexture(THREE);
    owned.userData.lqRoughBound = !!lqRough;
    if (v.liquid) setCharmLiquidUniforms(THREE, owned, v.liquid);
    owned.onBeforeCompile = (shader) => {
      shader.uniforms.uRoughAdjust = { value: owned.userData.roughAdjust };
      shader.uniforms.uColorAdjust = { value: owned.userData.colorAdjust };
      shader.uniforms.uCharmMask = { value: owned.userData.charmMask };
      shader.uniforms.uTintMask = { value: owned.userData.tintMask };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `${charmAdjustGlsl(!!owned.map)}\nvoid main() {`)
        // Three materials fade the roughness adjust by the mask too, and the
        // game fades each KNOB toward identity rather than the result — which
        // is why the pair arrives unfolded. See charmTune.
        .replace(
          "#include <roughnessmap_fragment>",
          [
            "#include <roughnessmap_fragment>",
            "\tfloat csRoughMask = uCharmMask.y > 0.5 ? csCharmMask() : 1.0;",
            "\tfloat csRoughC = mix( 1.0, uRoughAdjust.x, csRoughMask );",
            "\tfloat csRoughB = mix( 1.0, uRoughAdjust.y, csRoughMask );",
            "\troughnessFactor = clamp( ( ( roughnessFactor - 0.5 ) * csRoughC + 0.5 ) * csRoughB, 0.0, 1.0 );",
          ].join("\n"),
        )
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n\tdiffuseColor.rgb = csCharmAdjust( diffuseColor.rgb );",
        );
      // AFTER the block above, never before: both inject at `void main() {`, so
      // whichever runs last sits closest to it — and the liquid calls
      // csCharmMask(), which GLSL requires to be declared first.
      if (v.liquid) patchCharmLiquidShader(shader, owned);
    };
    owned.needsUpdate = true;
  });
}

/**
 * The stand-in bound where a material has no tint mask.
 *
 * One per three module, not per material: it exists only so the sampler is
 * never left unbound (which is undefined behaviour, and in practice a black
 * charm), and `uCharmMask.x` is what actually decides whether it is read.
 */
let white: ThreeNS.DataTexture | null = null;
function whiteTexture(THREE: Three): ThreeNS.DataTexture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}

/**
 * Load the tint masks a model's materials name, before anything is tuned.
 *
 * Separate from tuneCharmShading because that has to stay synchronous — it runs
 * per tick of a pattern drag — and because a mask is per MATERIAL, so a model
 * whose body and clasp are both masked loads two, and one whose two meshes
 * share a material loads one.
 *
 * A mask that fails to load comes back absent rather than throwing: the charm
 * then grades whole, which is what it did before any of this existed, and is a
 * far better outcome than a charm that does not render.
 */
export async function loadCharmTintMasks(
  THREE: Three,
  loadTexture: (url: string) => Promise<ThreeNS.Texture>,
  model: ThreeNS.Object3D,
  shading: Record<string, CharmShading>,
): Promise<Map<string, ThreeNS.Texture>> {
  const out = new Map<string, ThreeNS.Texture>();
  if (!shading || !Object.keys(shading).length) return out;
  const wanted = new Map<string, { path: string; flipY: boolean }>();
  const wantedRough = new Map<string, { path: string; flipY: boolean }>();
  model.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mat = mesh.material as ThreeNS.MeshStandardMaterial;
    const name = mat?.name;
    const tune = name ? shading[name] : null;
    // A csgo_weapon material names a tint mask; a csgo_simple_liquid one names
    // `g_tLiquidMask`. Different shaders, but the same kind of texture with the
    // same two requirements, and no material is ever on both — so they load
    // together and land in one map keyed by material.
    const liquidMask = tune?.liquid?.mask;
    const url = tune?.tintMask ?? (typeof liquidMask === "string" ? liquidMask : null);
    // The liquid's ROUGHNESS rides along on the same trip: it is the same kind of
    // texture with the same two rules, and fetching it separately would mean a
    // second async pass the tune has to wait on. Keyed apart so one material can
    // legitimately want both.
    const rough = tune?.liquid?.roughMap;
    if (typeof rough === "string" && name) {
      wantedRough.set(name, { path: rough, flipY: mat.map?.flipY ?? true });
    }
    // The ALBEDO's orientation, carried along, because the mask has to be read
    // in the same one — see the flipY note below.
    if (url && name) wanted.set(name, { path: url, flipY: mat.map?.flipY ?? true });
  });
  await Promise.all(
    [...wanted].map(async ([name, { path, flipY }]) => {
      const tex = await loadTexture(paintTextureUrl(path)).catch(() => null);
      if (!tex) return;
      // MATCH THE ALBEDO'S FLIP. A charm's art reaches us two ways and they do
      // not agree: the 23 blank-mesh charms fetch theirs as a texture file
      // (TextureLoader, flipY true), while the other 58 carry theirs inside the
      // GLB (GLTFLoader, flipY FALSE — glTF's UV origin is top-left). The mask
      // always arrives by the first route, so on a model-owning charm it was
      // sampled upside down: Charm | Lil' Squatch tinted its fur and face and
      // left the shorts the mask actually covers alone.
      //
      // Set on the CACHED texture, not a clone, so the second mount of a charm
      // re-uploads nothing. That is safe while a mask belongs to one KIND of
      // charm — the four sam_* materials share one and are all model-owning. A
      // mask shared across both kinds would need the clone.
      if (tex.flipY !== flipY) {
        tex.flipY = flipY;
        tex.needsUpdate = true;
      }
      // A MASK, not a picture: the shared loader marks everything sRGB, which
      // three honours by uploading as SRGB8_ALPHA8 and having the GPU decode on
      // every sample. That would pull each midtone down — a half-strength mask
      // edge would read as a quarter — so it has to be raw. Re-flagged only when
      // it actually changed, because that is a re-upload of a 1024² texture.
      if (tex.colorSpace !== THREE.NoColorSpace) {
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
      }
      out.set(name, tex);
    }),
  );
  await Promise.all(
    [...wantedRough].map(async ([name, { path, flipY }]) => {
      const tex = await loadTexture(paintTextureUrl(path)).catch(() => null);
      if (!tex) return;
      if (tex.flipY !== flipY) {
        tex.flipY = flipY;
        tex.needsUpdate = true;
      }
      // Raw, like the masks: this is a roughness map, and letting the shared
      // loader mark it sRGB would have the GPU decode every sample.
      if (tex.colorSpace !== THREE.NoColorSpace) {
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
      }
      out.set(`${name}\u0000rough`, tex);
    }),
  );
  return out;
}

/** A material's tint mask as a fetchable URL, for callers with no renderer. */
export function charmTintMaskUrl(tune?: CharmShading | null): string | null {
  return tune?.tintMask ? paintTextureUrl(tune.tintMask) : null;
}

/**
 * Put a charm's own material on the shared blank mesh.
 *
 * The blank carries a placeholder material — every community charm would
 * otherwise look identical — and the charm's identity is entirely in the
 * `keychain_material` the econ schema names: colour, normal, roughness and AO.
 * Those are ordinary extracted textures, so this is a straight rebuild of the
 * mesh's material from the vmat's own texture list.
 *
 * Returns false when it could not dress the mesh, which the caller treats as
 * "do not render this charm in 3D at all": an undressed blank is the same grey
 * shape for every community charm, so the flat art carries more information.
 */
interface TexParam {
  m_name?: string;
  m_pValue?: string;
}

const materialParamsCache = new Map<string, Promise<TexParam[] | null>>();

/**
 * A charm material's texture list, fetched once per material per session.
 *
 * Cached because two things want it now — the mesh dressing below and the
 * pattern rail, which needs the colour texture to know what the grade is
 * operating on. A failed fetch is evicted rather than remembered: a charm that
 * lost a race with a restarting backend must not stay undressed for the rest
 * of the session.
 */
function charmMaterialParams(material: string): Promise<TexParam[] | null> {
  let p = materialParamsCache.get(material);
  if (!p) {
    // paintTextureUrl is really "paint asset URL" — it prefixes /paints and
    // stamps the extraction version, which materials need exactly as textures do.
    p = fetch(paintTextureUrl(material))
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => (doc as { m_textureParams?: TexParam[] } | null)?.m_textureParams ?? null)
      .catch(() => null);
    materialParamsCache.set(material, p);
    void p.then((v) => {
      if (!v) materialParamsCache.delete(material);
    });
  }
  return p;
}

function pickTexture(params: TexParam[], ...names: string[]): string | null {
  for (const n of names) {
    const hit = params.find((t) => t.m_name === n)?.m_pValue;
    if (typeof hit === "string" && hit.startsWith("/textures/")) return hit;
  }
  return null;
}

/**
 * A charm's authored colour texture — what the seed grade actually operates on.
 *
 * The grade runs at `#include <map_fragment>`, i.e. on the albedo BEFORE any
 * lighting, so this unlit texture is the correct input to predict a pattern's
 * colour from. Grading the charm's lit catalog art instead would be doubly
 * wrong: it is already lit, and it is already graded at whatever pattern the
 * artist happened to author against — a pattern we do not record anywhere.
 */
export async function charmColorTextureUrl(material: string): Promise<string | null> {
  const params = await charmMaterialParams(material);
  if (!params) return null;
  const path = pickTexture(params, "g_tColor", "g_tColorTexture");
  return path ? paintTextureUrl(path) : null;
}

export async function dressCharm(
  THREE: Three,
  loadTexture: (url: string) => Promise<ThreeNS.Texture>,
  model: ThreeNS.Object3D,
  material: string,
): Promise<boolean> {
  const params = await charmMaterialParams(material);
  if (!params) return false;
  const pick = (...names: string[]) => pickTexture(params, ...names);
  const load = async (path: string | null) => {
    if (!path) return null;
    const tex = await loadTexture(paintTextureUrl(path)).catch(() => null);
    return tex;
  };
  // `g_tMetalness` is where csgo_weapon.vfx binds the ROUGHNESS texture on a
  // charm — the extracted file is literally named *_roughness_texture — so it
  // feeds roughnessMap and metalness stays 0. Checked against the real
  // material rather than assumed from the slot name.
  const [color, normal, rough, ao] = await Promise.all([
    load(pick("g_tColor", "g_tColorTexture")),
    load(pick("g_tNormal", "g_tNormalMap")),
    load(pick("g_tMetalness", "g_tRoughness", "g_tRoughnessTexture")),
    load(pick("g_tAmbientOcclusion")),
  ]);
  if (!color) return false; // nothing recognisable to dress it with
  color.colorSpace = THREE.SRGBColorSpace;
  model.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    // The chain/clasp is part of the same model and keeps its own metal look;
    // only the charm body wears the charm's material.
    //
    // Matched on a WORD, not a substring: three flattens the asset path into
    // the mesh name, so the charm body arrives as
    // `weaponskeychainsworkshop_blank` — which contains "chain", inside
    // "keychains". A bare /chain/ therefore skipped every charm body ever, and
    // each one kept the blank's placeholder material: Lil' Goop rendered solid
    // black and Sasquatch's eyes came out chrome, because that placeholder is
    // metalness 1.
    if (/(^|[^a-z])(chain|clasp|ring)([^a-z]|$)/i.test(mesh.name)) return;
    const mat = new THREE.MeshStandardMaterial({
      map: color,
      normalMap: normal ?? null,
      roughnessMap: rough ?? null,
      aoMap: ao ?? null,
      roughness: rough ? 1 : 0.6,
      metalness: 0,
    });
    // Named after the vmat it was built from, so tuneCharmShading can find it
    // the same way it finds a material the decompiler wrote.
    mat.name = charmMaterialName(material);
    (mesh.material as ThreeNS.Material)?.dispose?.();
    mesh.material = mat;
  });
  return true;
}
