/**
 * `csgo_simple_liquid.vfx` — the shader that fills a charm with liquid.
 *
 * One charm in the catalog is on it: **Charm | Butane Buddy** (`kc_db_lighter`),
 * as two materials sharing one vertex pool — an inner liquid volume
 * (`kc_db_lighter_02`) and an outer glass shell (`kc_db_lighter`, the one with
 * `F_OPAQUE_REFRACT`). It is worth a module for one charm because the shader IS
 * the charm: the authored albedo is the EMPTY glass, pale teal, and every red
 * pixel of the official icon comes from `g_vLiquidColor` filling to
 * `g_flLiquidLevelHeight`. Rendered through the plain glTF material the charm
 * was a featureless blob, which read as a missing texture and was not one.
 *
 * TRANSCRIBED, NOT INFERRED. Ground truth is the decompiled static combo 12
 * (S_OPAQUE_REFRACT + S_USE_TEST_VALUES) saved at
 * `tools/shadertest/groundtruth/liquid_outer_combo12.glsl`, its inner sibling
 * combo 8, and the vertex program `liquid_vs_combo4.glsl` — which is what pins
 * down the varyings, and without it the level test is unguessable. See
 * `tools/shadertest/DEBUGGING-SKINS.md` for why nothing here is reasoned out.
 *
 * The pattern matters on this charm, which is the other reason it earns the
 * work. Two params are seed-driven:
 *   `g_flLiquidColorHueShift = lerp(0, 320, seed)`               a full hue sweep
 *   `g_flLiquidLevelHeight   = lerp(0.45, 0.8, frac(seed * 100))` the fill level
 * so its 100000 patterns are a real space, and we were rendering all of them as
 * the same blank.
 */
import type * as ThreeNS from "three";

type Three = typeof ThreeNS;

/** `charm-shading.json`'s `liquid` bag — see extract-models.sh §3e. */
export interface CharmLiquid {
  levelHeight: number;
  levelDelta: number;
  up: [number, number, number];
  down: [number, number, number];
  side: [number, number, number];
  center: [number, number, number];
  color: [number, number, number];
  hueShift: number;
  brightness: number;
  innerGlow: number;
  surfaceTension: number;
  sharpness: number;
  waterLine: number;
  brightenEmpty: number;
  fresnelThickness: number;
  backOffset: number;
  backFade: number;
  backShape: number;
  roughness: number;
  maskMin: number;
  maskMax: number;
  wobbleScale: number;
  wobbleSpeed: number;
  wobbleWavelength: number;
  bubbleScale: number;
  bubbleDepthFalloff: number;
  bubblesMin: number;
  bubblesMax: number;
  bubbleSpeed: number;
  bubbleSpaceScale: number;
  bubbleOpacity: number;
  bubbleStrength: number;
  agitation: number;
  gravity: [number, number, number];
  bubbleColorInner: [number, number, number];
  bubbleColorOuter: [number, number, number];
  /** Index of refraction per region — glass, the volume, and the surface itself. */
  glassRefraction: number;
  liquidRefraction: number;
  surfaceRefraction: number;
  refractRoughMul: number;
  cubeTransparency: number;
  cubeLiquidTransparency: number;
  cubeBrightness: number;
  reflectance: number;
  specularStrength: number;
  surfaceSpecularStrength: number;
  transmissive: number;
  emissive: number;
  opaqueRefract: boolean;
  mask?: string;
  roughMap?: string;
  /** The albedo, kept for its ALPHA: csgo_simple_liquid's metalness. */
  metalMap?: string;
}

const vec3 = (v: unknown, dflt: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [v[0] as number, v[1] as number, v[2] as number]
    : dflt;

const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);

/**
 * Validate the backend's param bag.
 *
 * Every field defaulted, because a NaN reaching a uniform renders the charm
 * black — the same trap the shading map's numeric fields document — and a
 * liquid that is subtly wrong is far easier to diagnose than one that is not
 * there. `null` means "this material is not on the liquid shader".
 */
export function parseCharmLiquid(raw: unknown): CharmLiquid | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    levelHeight: num(e.levelHeight, 0),
    levelDelta: num(e.levelDelta, 0),
    up: vec3(e.up, [0, 0, 0]),
    down: vec3(e.down, [0, 0, 0]),
    side: vec3(e.side, [0, 0, 0]),
    center: vec3(e.center, [0, 0, 0]),
    color: vec3(e.color, [1, 1, 1]),
    hueShift: num(e.hueShift, 0),
    brightness: num(e.brightness, 1),
    innerGlow: num(e.innerGlow, 0),
    surfaceTension: num(e.surfaceTension, 0),
    sharpness: num(e.sharpness, 0),
    waterLine: num(e.waterLine, 0),
    brightenEmpty: num(e.brightenEmpty, 0),
    fresnelThickness: num(e.fresnelThickness, 0),
    backOffset: num(e.backOffset, 0),
    backFade: num(e.backFade, 0),
    backShape: num(e.backShape, 0),
    roughness: num(e.roughness, 0.5),
    maskMin: num(e.maskMin, 0),
    maskMax: num(e.maskMax, 1),
    wobbleScale: num(e.wobbleScale, 0),
    wobbleSpeed: num(e.wobbleSpeed, 0),
    wobbleWavelength: num(e.wobbleWavelength, 0),
    bubbleScale: num(e.bubbleScale, 0.3),
    bubbleDepthFalloff: num(e.bubbleDepthFalloff, 1),
    bubblesMin: num(e.bubblesMin, 0.1),
    bubblesMax: num(e.bubblesMax, 0.4),
    bubbleSpeed: num(e.bubbleSpeed, 1),
    bubbleSpaceScale: num(e.bubbleSpaceScale, 1.5),
    bubbleOpacity: num(e.bubbleOpacity, 1),
    bubbleStrength: num(e.bubbleStrength, 10),
    bubbleColorInner: vec3(e.bubbleColorInner, [0, 0, 0]),
    bubbleColorOuter: vec3(e.bubbleColorOuter, [1, 1, 1]),
    agitation: num(e.agitation, 0),
    gravity: vec3(e.gravity, [0, 0, -1]),
    // Refraction. The defaults are AIR — ior 1, no cube contribution — so a mount
    // extracted before these shipped renders exactly as it did before rather than
    // bending light through a value nobody authored.
    glassRefraction: num(e.glassRefraction, 1),
    liquidRefraction: num(e.liquidRefraction, 1),
    surfaceRefraction: num(e.surfaceRefraction, 1),
    refractRoughMul: num(e.refractRoughMul, 1),
    cubeTransparency: num(e.cubeTransparency, 0),
    cubeLiquidTransparency: num(e.cubeLiquidTransparency, 0),
    cubeBrightness: num(e.cubeBrightness, 0),
    reflectance: num(e.reflectance, 0),
    specularStrength: num(e.specularStrength, 0),
    surfaceSpecularStrength: num(e.surfaceSpecularStrength, 0),
    transmissive: num(e.transmissive, 0),
    emissive: num(e.emissive, 0),
    opaqueRefract: e.opaqueRefract === true,
    ...(typeof e.mask === "string" ? { mask: e.mask } : {}),
    ...(typeof e.roughMap === "string" ? { roughMap: e.roughMap } : {}),
    ...(typeof e.metalMap === "string" ? { metalMap: e.metalMap } : {}),
  };
}

/** What the liquid looks like at one pattern — the uniform payload. */
export interface ResolvedLiquid {
  /** World up, i.e. `-gravity`, in the VIEWER's axes. See sourceToViewer. */
  up: [number, number, number];
  levelUp: [number, number, number];
  levelDown: [number, number, number];
  levelSide: [number, number, number];
  center: [number, number, number];
  color: [number, number, number];
  /** levelHeight, TIME (wrapped, written per frame), hue in RADIANS, brightness. */
  a: [number, number, number, number];
  /** surfaceTension, sharpness (already through the normal-map collapse), waterLine, fresnelThickness. */
  b: [number, number, number, number];
  /** backOffset, backFade, backShape, brightenEmpty. */
  c: [number, number, number, number];
  /** innerGlow, liquid roughness, wobbleSpeed, LIVE agitation (written per frame). */
  d: [number, number, number, number];
  /** wobbleScale, wobbleWavelength. */
  w: [number, number];
  /** bubbleScale, bubbleDepthFalloff, bubblesMin, bubblesMax. */
  f: [number, number, number, number];
  /** bubbleSpeed, bubbleSpaceScale, bubbleStrength. */
  g: [number, number, number];
  /** bubble opacity, unused. */
  bub: [number, number, number];
  bubOut: [number, number, number];
  /** maskMin, maskMax. */
  mask: [number, number];
  /** glassRefraction, liquidRefraction, surfaceRefraction, refractRoughnessMultiplier. */
  r: [number, number, number, number];
  /** cubeTransparency, cubeLiquidTransparency, cubeBrightness, specularStrength. */
  s: [number, number, number, number];
  /** `F_OPAQUE_REFRACT` — this is the GLASS pass, not the inner volume. */
  opaqueRefract: boolean;
  /** The material's AUTHORED at-rest agitation; live motion adds to it. */
  agitation: number;
}

/**
 * Source's world axes are Z-up; the viewer's are Y-up.
 *
 * `g_vTestGravityDir` is a WORLD vector — the vertex program passes it through
 * untransformed — so it has to be reframed, unlike everything else here, which
 * is object-space and rides the model matrix. Both of Butane Buddy's materials
 * author `(0, 0, -1)`, which comes out `(0, -1, 0)`: straight down, the same
 * direction the charm's own verlet/cloth solver falls in (see GRAVITY in
 * viewer3d.ts). A material authoring a deliberate tilt would map too.
 *
 * The MESH is not reframed and must not be: VRF exported this GLB in Source
 * axes (its long, hanging axis is local Z, spanning -1.89..-0.09), which is why
 * the object-up the level test needs is local `(0,0,1)` in the vertex patch.
 */
function sourceToViewer([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, z, -y];
}

/**
 * `_23988` — the shader's per-texel edge-softness channel, which we cannot read.
 *
 * The game samples `g_tNormalA.z`: a Source 2 normal map stores only X and Y and
 * rebuilds Z in the shader, leaving BLUE free to carry something else. VRF's
 * glTF exporter reconstructs a standard RGB normal map, so the exported PNG's
 * blue channel is the rebuilt Z — measured on kc_db_lighter's: median 254 of
 * 255, p10 245. It is 1.0 everywhere and the authored channel is gone.
 *
 * Both places the shader reads it collapse cleanly at 1.0, which is why this is
 * a constant and not an approximation:
 *   `_4095 = sharpness * mask * mix(1.0, 0.2, pow(b, 1.5))`  ->  × 0.2
 *   `_5580 = 4.0 * (1.0 - b)`                                ->  0, so all four
 *          bubble layers are EXACTLY zero and the bubble path is dead code.
 */
/**
 * Stage probe — set from the rig, never on in the app. See DEBUGGING-SKINS.md.
 *
 *   1  sign of `d`: RED above the surface, BLUE submerged. Answers "is the
 *      level in the right place" separately from "is the coverage math right",
 *      which is the split that matters when the body renders uniformly flooded.
 *   2  `vLqHeight` as a grey ramp over ±1 object unit.
 *   3  coverage.
 *   4  the object-space up axis;  5  |vLqHeight|;  6  vdg;  7  thickness;
 *   8  the view vector;  9  world up.
 *
 *  30  the CUBE-REFRACT term alone — everything else in the lighting blanked. Use
 *      this before concluding the refraction "does nothing": at the authored
 *      brightness it is a modest add on top of a lit surface, and the question of
 *      whether it is present is separate from whether it is strong enough.
 *  31  the liquid's own specular alone. The tight 400/roughness lobe is a few
 *      pixels wide by design, so on a still render it can be entirely off-screen
 *      — orbit before deciding it is zero.
 *  32  the refracted direction as colour;  33  the refraction roughness.
 *
 * Any non-zero mode also stashes the live materials on `globalThis.__lqMats` and
 * counts ticks on `__lqTick` / `__lqFound`. Use 99 for that alone — it injects no
 * probe GLSL, so the render stays honest while you read uniforms out of it. That
 * is what showed `tickCharmLiquid` was reaching the right materials but running
 * once, because a CDP-driven tab is `document.hidden` and rAF never fires.
 */
export const liquidProbe = { mode: 0 };

/**
 * The GLASS's base roughness, until the authored channel is extracted.
 *
 * The decompile is unambiguous: `_13387 = vec2(_23988)` and `_23988 =
 * g_tNormalA.z` — the normal map's spare channel IS the roughness, not the
 * "edge softness" this file first assumed. Our liquid materials carry no
 * roughness input at all (the vmat binds only g_tColorA / g_tLiquidMask /
 * g_tNormalA), so three falls back to the glTF default of 1.0 and renders the
 * vessel DEAD MATTE — no speculars, no reflections, none of the gloss the
 * reference render is mostly made of.
 *
 * The data exists but we cannot reach it yet: VRF's glTF exporter writes RGB
 * only, and its own vtex decode rebuilds blue as the octahedral Z. Measured on
 * the source kc_db_lighter_normal .vtex_c, the only spare channel still carrying
 * signal is ALPHA — p10 0.15, median 0.33, p90 0.56, which is exactly the range
 * a glass roughness map would occupy. Extracting it is the real fix; this
 * constant is its median so the vessel is glossy in the meantime.
 */
const GLASS_ROUGHNESS = 0.33;

/**
 * The agitation a charm that is just hanging there actually has.
 *
 * NOT a guess: csgoskins' port of this shader runs
 * `mix(0.9, 0.7, saturate(pow((time - 5) / 10, 2)))` — sloshing at 0.9 on load,
 * settled to 0.7 about fifteen seconds later. Their decay is keyed to page load,
 * which for a charm that can be mounted and dismissed in a grid would restart the
 * slosh on every open; settling straight to their settled value is the honest
 * version of a charm that has been hanging there a while.
 *
 * Seeded into the uniform AND used as the tick's floor, because those are two
 * different code paths and only one of them runs in a still render — see the note
 * at the `d` vector in resolveCharmLiquid.
 */
export const REST_AGITATION = 0.7;

// The waterline's sharpness scale USED to be a constant here:
//
//   const NORMAL_B = 1.0;
//   const SHARP_SCALE = 1.0 + (0.2 - 1.0) * Math.pow(NORMAL_B, 1.5);   // = 0.2
//
// The shader's term is mix(1.0, 0.2, pow(b, 1.5)) with b = g_tNormalA.z, and
// b was measured as 1.0 — off the exported normal map's BLUE channel, which VRF
// had rebuilt as the octahedral Z. Extraction v24 established that the authored
// channel is the ROUGHNESS and that it survives in ALPHA (p10 0.15, median 0.33,
// p90 0.56); the constant was never revisited.
//
// At the real median that term is mix(1, 0.2, 0.33^1.5) = 0.848, not 0.2 — so the
// waterline was being softened 4.2x too far, which is exactly the difference
// between our smooth gradient and the sharp jagged meniscus a correct render has.
// It is a TEXTURE, so it belongs per-fragment: see csLiquidSample.

/**
 * Resolve the liquid at one pattern.
 *
 * `dyn` is the same seed-driven expression map the rest of the charm shading
 * uses; the two params it can carry here override the material's baked
 * constants, exactly as they do on csgo_weapon — the baked value is only
 * whatever pattern the artist authored against. Butane Buddy's baked hue is
 * 180, and its icon is red, because `lerp(0, 320, seed)` puts the low patterns
 * back at the authored colour.
 */
export function resolveCharmLiquid(
  liq: CharmLiquid,
  evalParam: (name: string, dflt: number) => number,
): ResolvedLiquid {
  const levelHeight = evalParam("g_flLiquidLevelHeight", liq.levelHeight);
  // DEGREES, uploaded as radians — the convention g_fHueShift established on
  // csgo_weapon (see charmMaterial's CHARM_ADJUST_GLSL), and the only reading
  // under which this charm's `lerp(0, 320, seed)` is a hue ramp rather than 51
  // meaningless turns.
  const hueDeg = evalParam("g_flLiquidColorHueShift", liq.hueShift);
  return {
    up: sourceToViewer([-liq.gravity[0], -liq.gravity[1], -liq.gravity[2]]),
    levelUp: liq.up,
    levelDown: liq.down,
    levelSide: liq.side,
    center: liq.center,
    color: liq.color,
    a: [levelHeight, 0, (hueDeg * Math.PI) / 180, liq.brightness],
    b: [liq.surfaceTension, liq.sharpness, liq.waterLine, liq.fresnelThickness],
    c: [liq.backOffset, liq.backFade, liq.backShape, liq.brightenEmpty],
    // THE FLOOR IS APPLIED HERE, not only in tickCharmLiquid.
    //
    // The tick is what normally raises agitation to REST_AGITATION, and it only
    // runs on a live render loop — so a STILL render (every card bake, every rig
    // snapshot, the craft preview) kept the material's authored value, which on
    // this vessel is 0.0 because the real one rides a render attribute the
    // decompiler drops. Bubble size goes as a^9, so 0.0 meant no bubbles at all
    // in exactly the renders anyone looks at closely.
    d: [liq.innerGlow, liq.roughness, liq.wobbleSpeed, Math.max(liq.agitation, REST_AGITATION)],
    w: [liq.wobbleScale, liq.wobbleWavelength],
    f: [liq.bubbleScale, liq.bubbleDepthFalloff, liq.bubblesMin, liq.bubblesMax],
    g: [liq.bubbleSpeed, liq.bubbleSpaceScale, liq.bubbleStrength],
    bub: liq.bubbleColorInner,
    bubOut: liq.bubbleColorOuter,
    mask: [liq.maskMin, liq.maskMax],
    r: [liq.glassRefraction, liq.liquidRefraction, liq.surfaceRefraction, liq.refractRoughMul],
    // The surface's own specular strength rides with the liquid's — the shader
    // picks between them by the same surface mask the ior does.
    s: [liq.cubeTransparency, liq.cubeLiquidTransparency, liq.cubeBrightness,
        Math.max(liq.specularStrength, liq.surfaceSpecularStrength)],
    opaqueRefract: liq.opaqueRefract,
    agitation: liq.agitation,
  };
}

/**
 * What COLOUR this pattern makes the liquid — the pattern rail's swatch.
 *
 * The rail's usual method cannot answer for a liquid charm. It grades the
 * ALBEDO through the csgo_weapon hue knobs, and a liquid charm's albedo is the
 * empty glass: on Butane Buddy that is a flat pale teal at every pattern, so a
 * rail drawn that way would promise one dead colour across a space that really
 * sweeps the whole hue circle. The colour is `g_vLiquidColor`, and the pattern
 * moves it through `g_flLiquidColorHueShift`.
 *
 * Same Rodrigues rotation about the grey axis as the shader (csLiquidColor),
 * including the `pow(hsvSaturation, 0.125)` near-grey fade — but returned as
 * sRGB bytes, because a swatch is something you look at. Brightness is applied
 * and then clamped: it is 2.0 here, so the linear colour genuinely leaves the
 * displayable range and the clamp is the monitor's, not an approximation.
 */
export function liquidSwatch(lq: ResolvedLiquid): [number, number, number] {
  const K = 0.57735027;
  const W = [0.2125, 0.7154, 0.0721] as const;
  const b = lq.a[3];
  const c = [lq.color[0] * b, lq.color[1] * b, lq.color[2] * b];
  const mx = Math.max(c[0], c[1], c[2]);
  const hsvSat = mx === 0 ? 0 : (mx - Math.min(c[0], c[1], c[2])) / mx;
  const ca = Math.cos(lq.a[2]);
  const sa = Math.sin(lq.a[2]);
  // cross(K, c) collapses to K * (b-g, r-b, g-r) because every component of the
  // axis is the same — the identical simplification charmAdjustSrgb makes.
  const axial = K * (c[0] + c[1] + c[2]) * K * (1 - ca);
  const rot = [
    c[0] * ca + K * (c[2] - c[1]) * sa + axial,
    c[1] * ca + K * (c[0] - c[2]) * sa + axial,
    c[2] * ca + K * (c[1] - c[0]) * sa + axial,
  ];
  const lum = c[0] * W[0] + c[1] * W[1] + c[2] * W[2];
  const fade = Math.pow(hsvSat, 0.125);
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const lin = Math.min(1, Math.max(0, lum + (rot[i] - lum) * fade));
    const srgb = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
    out[i] = Math.round(Math.min(1, Math.max(0, srgb)) * 255);
  }
  return out;
}


/**
 * The vertex half: everything the level test needs that only the vertex knows.
 *
 * Injected after `#include <skinning_vertex>`, where three's `boneMat*`,
 * `bindMatrix` and `skinWeight` are all still in scope. The liquid centre and
 * the object's up axis are skinned by hand with the SAME weights the vertex
 * used, because this mesh is a four-joint cloth chain and the body swings on
 * it: transforming them by `modelMatrix` alone would leave the surface behind
 * while the charm moved, which is the one thing a liquid must not do.
 */
export const CHARM_LIQUID_VERTEX_PARS = `
uniform vec3 uLqCenter;
uniform vec3 uLqUp;
uniform vec3 uLqUpObj;
varying vec3 vLqWorld;
varying vec3 vLqObj;
varying float vLqHeight;
varying float vLqUpright;
varying vec3 vLqDiag;
varying vec3 vLqViewOff;`;

export const CHARM_LIQUID_VERTEX = `
	vec3 lqCenter = uLqCenter;
	// Source's model up. The GLB was exported in Source axes — see sourceToViewer.
	vec3 lqUp = vec3( 0.0, 0.0, 1.0 );
	#ifdef USE_SKINNING
		vec4 lqC4 = bindMatrix * vec4( lqCenter, 1.0 );
		vec4 lqCs = boneMatX * lqC4 * skinWeight.x + boneMatY * lqC4 * skinWeight.y
		          + boneMatZ * lqC4 * skinWeight.z + boneMatW * lqC4 * skinWeight.w;
		lqCenter = ( bindMatrixInverse * lqCs ).xyz;
		// w = 0: a direction, so the bones' translations must not reach it.
		vec4 lqU4 = bindMatrix * vec4( lqUp, 0.0 );
		vec4 lqUs = boneMatX * lqU4 * skinWeight.x + boneMatY * lqU4 * skinWeight.y
		          + boneMatZ * lqU4 * skinWeight.z + boneMatW * lqU4 * skinWeight.w;
		lqUp = ( bindMatrixInverse * lqUs ).xyz;
	#endif
	// OBJECT space and deliberately un-skinned, matching the vertex program's
	// vPositionOs - g_flLiquidCenterOffset. It is only ever used as a radius
	// for the back-wall thickness, where the bind pose is the right shape.
	vLqObj = position - uLqCenter;
	vLqWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	// THE LEVEL TEST IS IN OBJECT UNITS, and that is not a detail.
	//
	// Every constant it compares against — the three MinMidMax triples, the
	// centre offset, the surface tension, the back offset — is authored in the
	// MODEL's own units, where this charm's body is ~1.2 across. The game can
	// measure the fragment's height in world space because there the model sits
	// at its authored scale; our viewer scales a charm to about 4cm (~0.022x),
	// so a world-space height put every fragment ~0.45 BELOW a surface sitting
	// at 0.465. The whole body read as submerged, with no waterline anywhere —
	// a charm uniformly flooded with its liquid colour.
	//
	// So bring WORLD UP into object space instead. v * mat3(M) is
	// transpose(mat3(M)) * v; for a rotation-and-uniform-scale model matrix that
	// is the inverse rotation times the scale, and normalize drops the scale.
	// THE VESSEL'S OWN AXIS, not a world axis brought into object space.
	//
	// Deriving it as transpose(mat3(modelMatrix)) * worldUp was wrong twice over:
	// it assumes the viewer orients this GLB a particular way, and probe 1 showed
	// the result — a VERTICAL red/blue split across the body, i.e. the height was
	// being measured along a sideways axis. The game's vertex program takes the
	// model's own +Z (vec4(0,0,1,0) * boneTransform), and that is the axis the
	// level constants were authored against.
	//
	// How the liquid responds to the charm TILTING is a separate mechanism and
	// already modelled: upright picks between the Up/Side/Down triples below.
	// THE VESSEL'S OWN AXIS, on the BIND pose, in MODEL units.
	//
	// Not world up, and that is the counter-intuitive part. The level constants
	// are authored along the model's +Z, and this viewer does NOT hang a charm
	// with its model axis aligned to world up — measuring along world up put the
	// waterline VERTICAL across the body (probe 1), and scaling a world-space
	// height back into model units flooded it instead. The model's own axis is
	// the only frame the authored numbers mean anything in.
	//
	// Bind pose deliberately: transformed follows the cloth solver, which
	// hangs the charm SETTLED rather than at bind, and the vessel is one rigid
	// ball whose level is a property of its own geometry. How the liquid should
	// answer the charm TILTING is the Up/Side/Down triples' job, below.
	// Along the EFFECTIVE up, expressed in object space and calibrated so a charm
	// at rest reads exactly the model's own +Z — see tickCharmLiquid. That is what
	// makes the surface stay level while the charm swings instead of tipping with
	// it, which is the whole of the liquid's animation.
	vLqHeight = dot( position - uLqCenter, uLqUpObj );
	vLqUpright = dot( uLqUpObj, vec3( 0.0, 0.0, 1.0 ) );
	// The wobble's frame is SCREEN-ALIGNED in the game (it works in view space),
	// so carry the offset from the liquid centre into view space — but divide the
	// model scale back out, or the noise frequency stretches by ~35x on a charm
	// scaled to 4cm and reads as no waves at all.
	vLqViewOff = ( mat3( viewMatrix ) * mat3( modelMatrix ) * ( position - uLqCenter ) )
		/ max( length( mat3( modelMatrix )[ 0 ] ), 1e-6 );
	vLqDiag = vec3( vLqHeight );`;

/**
 * The fragment half.
 *
 * Reads `csCharmMask()` for `g_tLiquidMask` — the charm materials already carry
 * one masking sampler and a material is never on both shaders, so the liquid
 * mask rides the same slot rather than costing a second texture unit. Both
 * masks have the same two requirements (the albedo's flipY, and NoColorSpace),
 * which is the other reason they share a loader.
 *
 * The refraction and the liquid's own specular are NOT here — they are at
 * <lights_fragment_end>, in CHARM_LIQUID_REFRACT, because they need the scene's
 * environment and its direct lights. They used to be described in this comment as
 * unimplementable without "a scene buffer we do not render", which was simply
 * wrong and cost this charm four rounds of chasing smaller terms: the game
 * refracts against a CUBEMAP, not the framebuffer. See the note over
 * CHARM_LIQUID_REFRACT.
 */
export const CHARM_LIQUID_GLSL = `
uniform vec3 uLqUp;
uniform vec3 uLqUpObj;
uniform vec3 uLqLevelUp;
uniform vec3 uLqLevelDown;
uniform vec3 uLqLevelSide;
uniform vec3 uLqColor;
uniform vec4 uLqA;
uniform vec4 uLqB;
uniform vec4 uLqC;
uniform vec4 uLqD;
uniform vec2 uLqMask;
uniform vec2 uLqW;
uniform vec3 uLqE;
uniform sampler2D uLqRough;
uniform sampler2D uLqMetal;
uniform vec4 uLqF;
uniform vec3 uLqG;
uniform vec3 uLqBubIn;
uniform vec3 uLqBubOut;
uniform vec4 uLqR;
uniform vec4 uLqS;
varying vec3 vLqViewOff;
varying vec3 vLqWorld;
varying vec3 vLqObj;
varying float vLqHeight;
varying float vLqUpright;
varying vec3 vLqDiag;

/**
 * _23968 / _3143 — the WOBBLE, transcribed.
 *
 * Eight exp(sin(dot())) octaves in a screen-aligned frame. It was shipped as a
 * constant while agitation was the material's authored at-rest value, where
 * wobbleScale * agit^2 really is ~1e-4 and the whole term collapses to its
 * offset. That stopped being true the moment tickCharmLiquid started driving
 * agitation from the charm's motion: at agit 1 the noise scales by ~0.45, which
 * is the surface actually moving. Without this there are no waves at all — the
 * one thing a liquid is supposed to do.
 *
 * uLqW = (wobbleScale, wobbleWavelength). uLqD.w carries live agitation and
 * uLqA.y the time base, both written per frame.
 */
float csLiquidWobble( float agit, float upright, float fres, float alongUp ) {
	// _12833: the shader quantises speed with floor(speed * 200) and drives
	// every octave from it, so the phases stay commensurate.
	float tw = ( 3.0 * uLqA.y ) * floor( uLqD.z * 200.0 );
	float band = mix( 0.5, 1.0, abs( upright ) );
	float freq = ( uLqW.y * band ) * mix( 0.2, 0.6, agit );
	float pA = tw * 0.104, pB = tw * -0.104;
	float damp = 1.0 - alongUp;
	vec2 c = vLqViewOff.xy;
	float n =
		( agit * exp( sin( dot( vec2( -1.24211, 1.142074 ) * freq, c ) + tw * 0.034 ) - 1.0 ) ) * 0.125
		+ exp( sin( dot( vec2( 2.82110, 2.920740 ) * freq, c ) + tw * 0.044 ) - 1.0 ) * 0.3333333
		+ ( agit * exp( sin( dot( vec2( -3.24211, -3.642074 ) * freq, c ) + tw * 0.024 ) - 1.0 ) ) * 0.1111111
		+ ( agit * exp( sin( dot( vec2( 3.74211, -3.642074 ) * freq, c ) + tw * 0.029 ) - 1.0 ) ) * 0.1111111;
	n *= exp( ( sin( dot( vec2( -8.74211, 13.642074 ) * freq, c ) + pA ) * damp ) * 0.14 );
	n *= exp( ( sin( dot( vec2( 13.74211, 14.642074 ) * freq, c ) + pB ) * damp ) * 0.13 );
	n *= exp( ( sin( dot( vec2( -23.742109, -13.642074 ) * freq, c ) + pA ) * damp ) * 0.10 );
	n *= exp( ( sin( dot( vec2( 31.742109, -20.642075 ) * freq, c ) + pB ) * damp ) * 0.08 );
	return ( n * uLqW.x * agit * agit * band * 15.0 * ( 1.5 - fres ) ) - ( agit * 0.25 );
}

/**
 * The BUBBLES — four scrolling layers, transcribed.
 *
 * Written off early as "exactly zero" because their density is
 * _5580 = 4 * (1 - g_tNormalA.z) and that channel measured a flat 255. It was
 * the wrong channel: .z is the ROUGHNESS (see GLASS_ROUGHNESS), VRF had
 * rebuilt blue as the octahedral Z, and the authored data is in alpha. At the
 * real roughness (median 0.33) the density is ~2.7 and the bubbles are very much
 * there — they are visible in the reference render.
 *
 * Each layer is a scrolling lattice of discs whose radius is the depth-faded
 * bubble size; 1/size scales the cell so a bigger bubble covers more of it.
 * Returns coverage in .a and the inner/outer tint in .rgb.
 */
/**
 * TWO AGITATION CURVES, and feeding the wrong one here is why the bubbles were
 * invisible for this charm's entire history.
 *
 * The shader derives two separate quantities from the live agitation a:
 *   agitationBase    = a * a + 0.01     drives the WOBBLE
 *   agitationBubbles = pow( a, 9.0 )    drives the bubble SIZE, and only this
 *
 * The agit parameter here must therefore be the RAW agitation. It used to be
 * handed agitationBase — already squared — which this function then raised to
 * the ninth, i.e. a^18. At a resting 0.55 that is (0.3125)^9 = 6e-5 against the
 * 0.7^9 = 0.040 a settled charm should have: **660x too small**, which rounds to
 * nothing at every stage downstream. The four layers, the tint and the normal
 * displacement were all correct and all multiplied by ~zero.
 *
 * Confirmed against csgoskins.gg's independent port of the same Valve shader
 * (groundtruth/csgoskins_simple_liquid.glsl), which names the two explicitly.
 */
vec4 csLiquidBubbles( float agit, float depth, float rough, out vec2 disp ) {
	// THE + 0.25 IS NOT OPTIONAL, and leaving it out is why the bubbles were
	// still invisible after three other real fixes.
	//
	// The shader's term is mix(min, max, agitationBubbles + input_11.y * 0.25),
	// where input_11 is a vertex COLOUR. Our GLB has no COLOR_0 at all (it carries
	// POSITION/TEXCOORD_0/NORMAL/TANGENT/JOINTS_0/WEIGHTS_0), so it read as absent
	// and the term vanished. csgoskins hit the same missing attribute and answer it
	// explicitly — their port opens with a #define of input_11 to vec4(1.0) — so
	// this a constant +0.25, not a per-vertex value we are failing to supply.
	//
	// It dominates at rest, because agitationBubbles is a NINTH power:
	//   without:  mix(0.1, 0.4, 0.040)        = 0.112 -> size 0.050 -> disc 2.2px
	//   with:     mix(0.1, 0.4, 0.040 + 0.25) = 0.187 -> size 0.084 -> disc 3.7px
	// i.e. 2.8x the covered area. Not clamped — the shader lets mix() extrapolate
	// past the max at high agitation and so do we.
	float size = ( 1.5 * uLqF.x * mix( uLqF.z, uLqF.w, pow( agit, 9.0 ) + 0.25 ) )
		/ ( 1.0 + abs( depth ) * uLqF.y );
	float density = 4.0 * ( 1.0 - rough );
	disp = vec2( 0.0 );
	if ( density <= 0.0 || size <= 0.0 ) return vec4( 0.0 );
	float inv = 1.0 / max( size, 0.001 );
	float tw = ( 3.0 * uLqA.y ) * floor( uLqD.z * 200.0 );
	float t = tw * 0.005 * uLqG.x;
	// THE LATTICE IS GRAVITY-ALIGNED, and using raw view x/y is why the bubbles
	// drift ACROSS the liquid instead of rising through it.
	//
	// The shader builds a screen-space frame out of gravity and projects onto it:
	//     viewGravityDir2D = normalize(vec3(gravityInView.xy, 0.0))
	//     x = dot(offset, cross(viewGravityDir2D, vec3(0,0,1)))   perpendicular
	//     y = dot(offset, viewGravityDir2D)                       along gravity
	// so the layers' scroll (dir is roughly (0.1, 1.0)) runs along the gravity
	// axis and the bubbles travel up. Ours scrolled along view +Y no matter which
	// way was down, which reads as sideways drift the moment the charm tips or the
	// camera orbits.
	//
	// SCALE: the offset stays in GLB units. The frequency is fixed in the shader
	// (sc * cell = 0.6 * 1.74 on the first layer), so the coordinate's scale sets
	// how many cells land on the charm, and the disc in each has radius size —
	// 0.05 of a half-cell:
	//
	//   GLB units (this)          2.3 cells across   cell 87px   disc r = 2.2px
	//   x39.37 into inches        90  cells across   cell 2.2px  disc r = 0.06px
	//
	// The inch conversion was tried because csgoskins fold a meterToInchMultiplier
	// into their liquid matrix and then divide by 0.0254 again. It is SUB-PIXEL —
	// the discs stop being sampled at all. Their world is metres like ours and the
	// two conversions cancel against a centre term that is itself inch-scaled.
	vec3 lqGView = normalize( ( viewMatrix * vec4( -uLqUp, 0.0 ) ).xyz );
	vec2 lqGy = normalize( lqGView.xy + vec2( 1e-5, 0.0 ) );
	vec2 lqGx = vec2( lqGy.y, -lqGy.x );
	vec2 base = vec2( dot( vLqViewOff.xy, lqGx ), dot( vLqViewOff.xy, lqGy ) ) * uLqG.y;
	// The shader wobbles each layer's phase with two sines of the base coords so
	// the lattices never line up into a visible grid.
	float sy = sin( base.y ) * 0.25 + sin( base.y * 23.1984 ) * 0.02;
	float sx = sin( base.x * 1.294 ) * 0.25 + sin( base.x * 18.1984 ) * 0.04;
	vec3 tint = vec3( 0.0 );
	float cover = 0.0;
	for ( int i = 0; i < 4; i++ ) {
		vec2 off = i == 0 ? vec2( 0.2 - sy, 0.356 + sx )
			: i == 1 ? vec2( -0.2 + sy, -0.56 - sx )
			: i == 2 ? vec2( 0.35 - sy * 0.5, 0.6 - sx * 0.5 )
			: vec2( -0.42 + sy * 0.5, -0.76 + sx * 0.5 );
		float sc = i == 0 ? 0.6 : i == 1 ? 0.55 : i == 2 ? 0.5 : 0.45;
		float cell = i == 0 ? 1.74 : i == 1 ? 2.74 : i == 2 ? 4.74 : 5.34;
		vec2 dir = i == 0 ? vec2( 0.1, 1.0 ) : i == 1 ? vec2( -0.1, 1.0 )
			: i == 2 ? vec2( 0.13, 1.0 ) : vec2( -0.14, 1.0 );
		float spd = i == 0 ? 0.25 : i == 1 ? 0.3 : i == 2 ? 0.35 : 0.4;
		// THE CELL FREQUENCY GOES INSIDE fract(), and having it outside is why
		// there were never any bubbles.
		//
		//   theirs:  ((fract( X * 1.74 ) * 2.0) - 1.0) * inv
		//   ours:    ((fract( X ) * 1.74  * 2.0) - 1.0) * inv     <- wrong
		//
		// Inside, it is the lattice FREQUENCY and the cell coordinate lands in
		// [-1, 1) so length() is a clean radius. Outside, the lattice has no
		// frequency at all and the coordinate runs [-1, 2.48) — asymmetric, so
		// most of every cell sits beyond the disc test and the few texels that
		// survive form a thin band rather than a bubble.
		vec2 p = ( fract( ( ( ( base + off ) * sc ) + dir * t * spd ) * cell ) * 2.0 - 1.0 ) * inv;
		float r = length( p );
		float a = clamp( density * ( 1.0 - r ), 0.0, 1.0 );
		cover += a;
		// _20855 * _14443 and friends: the per-layer offset, weighted by its own
		// coverage. This is what bends the normal — see the bubbleStrength note.
		disp += p * r * r * a;
		tint += mix( uLqBubIn, uLqBubOut, vec3( length( p * r * r ) ) ) * a;
	}
	disp *= size;
	return vec4( tint, cover * size );
}

/** Signed distance ABOVE the liquid surface, plus the terms everything reuses. */
struct LqSample {
	float d;        // _5526 — positive above the surface, negative submerged
	float mask;     // _22843
	float sharp;    // _4095
	float fres;     // _13948
	float ndv;      // _16978
	float ndv2;     // _19871
	float back;     // _5854 — the volume's thickness along the view ray
	float vdg;      // _8828 — dot(viewDir, gravity): >0 when looking DOWN at it
	vec3 viewDir;   // _10145 — camera -> fragment
	float depth;    // _3921 - _11687 — how far UNDER the surface, before the meniscus
};

LqSample csLiquidSample( vec3 N, float rough ) {
	LqSample s;
	vec3 up = uLqUp;
	// THE VIEWER IS ORTHOGRAPHIC — see the settled note on viewer3d's projection.
	// Under ortho every fragment shares one view direction, and
	// normalize(worldPos - cameraPosition) is not it: cameraPosition is a bare
	// standoff, so that vector fans out and probe 6 read vdg ~ +0.8 across the
	// whole body, i.e. the shader believed it was looking straight DOWN at a
	// charm being rendered in profile. That pinned the back-wall thickness, which
	// pinned coverage at 1, which is why the body rendered uniformly flooded.
	//
	// Taken from three rather than re-derived: this is exactly the branch its own
	// lighting uses (geometryViewDir in lights_fragment_begin).
	vec3 lqViewV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
	// View space -> world: v * viewMatrix is transpose(viewMatrix) * v, the
	// inverse rotation. Negated because the game's _10145 points camera -> fragment.
	vec3 Vd = -normalize( ( vec4( lqViewV, 0.0 ) * viewMatrix ).xyz );
	s.fres = clamp( 1.0 - dot( -Vd, N ), 0.0, 1.0 );
	s.ndv = 1.0 - s.fres;
	s.ndv2 = s.ndv * s.ndv;
	// _22843. csCharmMask SELF-GATES on uCharmMask.x — the "a mask is bound" flag,
	// see charmMaterial's whiteTexture note — so calling it unconditionally is
	// safe, and the test that used to sit here was reading uLqD.w, which is the
	// live AGITATION. That made the mask switch itself off whenever the charm was
	// calm enough (below 0.55 it never is once tickCharmLiquid has run, but the
	// material's own authored value is 0.0 on the vessel, so every frame before
	// the first tick flooded the whole material). The refraction below gates on
	// this mask, so a wrong one is no longer a subtle error.
	s.mask = clamp( ( csCharmMask() - uLqMask.x ) / ( uLqMask.y + 0.001 ), 0.0, 1.0 );
	// _4095 = sharpness * mask * mix(1.0, 0.2, pow(b, 1.5)), b being the normal
	// map's spare channel — the ROUGHNESS. Per-fragment, not the constant it was.
	s.sharp = uLqB.y * s.mask * mix( 1.0, 0.2, pow( clamp( rough, 0.0, 1.0 ), 1.5 ) );

	// WHERE THE SURFACE SITS. The three MinMidMax triples are the level scalar
	// at fill 0 / 0.5 / 1, and the shader picks between them by how upright the
	// charm hangs — so a charm swinging on its cord slides between them instead
	// of snapping. upright is +1 hanging straight, -1 inverted, 0 on its side.
	float upright = vLqUpright;
	vec3 mmm = mix(
		mix( uLqLevelDown, uLqLevelSide, clamp( upright + 1.0, 0.0, 1.0 ) ),
		uLqLevelUp, clamp( upright, 0.0, 1.0 ) );
	// g_flLiquidLevelHeightDelta scales this by a vertex attribute. It is 0 on
	// both of this charm's materials, so the game's expression reduces to the
	// level itself and no COLOR_0 is read — which is just as well, since a charm
	// GLB is not guaranteed to carry a usable one.
	float fill = uLqA.x;
	float levelC = mix( mix( mmm.x, mmm.y, clamp( fill * 2.0, 0.0, 1.0 ) ),
	                    mmm.z, clamp( ( fill - 0.5 ) * 2.0, 0.0, 1.0 ) );
	// Both in OBJECT units, the space the level constants are authored in — see
	// the vertex half, where vLqHeight is measured. The surface is the level
	// scalar; the fragment's height is already relative to the liquid centre.
	float surfH = levelC;
	float fragH = vLqHeight;

	// The meniscus — liquid climbing the glass where you see it nearly edge-on.
	// length( N * up ) is componentwise, not a dot: transcribed as written.
	float alongUp = length( N * up );
	float tension = ( s.fres * mix( 0.25, 1.0, alongUp ) + pow( s.fres, 5.0 ) * 0.8 ) * uLqB.x;

	// _3921. The bubble nudge is dropped with it — see NORMAL_B, where the
	// four bubble layers are exactly zero on the assets we can extract.
	float vdg = dot( Vd, -up );
	s.vdg = vdg;
	s.viewDir = Vd;
	float lqAgit = uLqD.w * uLqD.w + 0.01;
	float surfEff = surfH + csLiquidWobble( lqAgit, upright, s.fres, alongUp ) + abs( vdg ) * -0.05;
	// The shader adds 1.5 * min(0.3, saturate(1 - abs(gravity.z))) * (fresnel - 0.2),
	// a lean that only bites when gravity is off the world Z axis. Ours is
	// exactly -Z, so the saturate is 0 and the whole term with it.
	s.d = fragH - ( surfEff + tension );
	// The inner glow falls off with this, NOT with s.d: the shader divides by
	// 1 + max(_3921 - _11687, 0), which is the raw surface-to-fragment gap with
	// the meniscus left out.
	s.depth = surfEff - fragH;

	// The BACK wall, so the fill reads as a body of liquid rather than a flat
	// cut across the silhouette. backShape picks cylinder (0) or sphere (1) by
	// scaling the object-space radius' own up axis before measuring it.
	vec3 r = vec3( vLqObj.xy, vLqObj.z * uLqC.z );
	s.back = 1.5 * uLqC.x * pow( clamp( vdg, 0.0, 1.0 ), 2.0 ) * s.ndv * length( r );
	return s;
}

/** _21055 — how much of this texel the liquid covers, before the mask. */
float csLiquidCoverage( LqSample s, out float waterline, out float front, out float back ) {
	waterline = ( 1.0 - clamp( abs( s.d - 0.05 ) * s.ndv2 * s.sharp, 0.0, 1.0 ) ) * s.ndv2 * uLqB.z;
	front = 1.0 - clamp( s.d * s.sharp * 0.25, 0.0, 1.0 );
	float far = 1.0 - clamp( ( s.d - s.back ) * s.sharp * 0.125, 0.0, 1.0 );
	float fade = 1.0 - clamp( clamp( s.d / max( s.back, 1e-5 ), 0.0, 1.0 ) * uLqC.y * 0.5, 0.0, 1.0 );
	back = far * fade;
	return clamp( waterline + front + back, 0.0, 1.0 );
}

/**
 * The liquid's own colour, hue-rotated about the RGB grey axis.
 *
 * The same Rodrigues rotation and the same pow(hsvSaturation, 0.125) near-grey
 * fade as csgo_weapon's grade — but with no contrast, brightness or saturation
 * stage around it, and NO sRGB round trip: this operates on a linear uniform
 * that ends up multiplying a linear albedo, so it stays linear throughout.
 */
vec3 csLiquidColor( float waterline ) {
	const vec3 W = vec3( 0.2125, 0.7154, 0.0721 );
	const vec3 K = vec3( 0.57735027 );
	vec3 c = uLqColor * uLqA.w * clamp( 1.0 - waterline, 0.0, 1.0 );
	float mx = max( c.r, max( c.g, c.b ) );
	float hsvSat = mx == 0.0 ? 0.0 : ( mx - min( c.r, min( c.g, c.b ) ) ) / mx;
	float ca = cos( uLqA.z ), sa = sin( uLqA.z );
	vec3 rot = c * ca + cross( K, c ) * sa + K * dot( K, c ) * ( 1.0 - ca );
	return mix( vec3( dot( c, W ) ), rot, pow( hsvSat, 0.125 ) );
}`;

/**
 * Drive the liquid from the charm's MOTION — the animation.
 *
 * CS2 does this through render attribute `0x4B002DCA`, which feeds
 * `g_vTestGravityDir` and `g_flTestAgitation` from the charm's live movement.
 * vfx_decode drops that attribute (it is not `$KeychainSeed`), so the authored
 * constants are all the material can tell us — but the SIGNAL is something we
 * already have: the charm swings on the cloth solver, and this reads its
 * rotation straight off the object.
 *
 * Two effects, both the game's:
 *
 *  · the surface stays LEVEL while the charm tips. `g_vTestGravityDir` is a
 *    world vector, so in the model's own frame it rotates as the charm does.
 *  · it AGITATES with the motion, which drives the wobble amplitude.
 *
 * CALIBRATED TO REST. The authored level constants are written along the model's
 * +Z, and this viewer does not hang a charm with +Z on world up — so the naive
 * "world up in object space" is not (0,0,1) at rest and tilts the waterline on a
 * charm that is not moving at all. The rest orientation is captured on first
 * tick and divided out, which keeps the settled render exactly as measured while
 * letting any deviation from it tilt the surface.
 */
/** Reused across frames — this runs in the render loop. */
let scratchQuat: ThreeNS.Quaternion;

export function tickCharmLiquid(
  THREE: Three,
  model: ThreeNS.Object3D,
  worldUp: ThreeNS.Vector3,
  dt: number,
): void {
  scratchQuat ??= new THREE.Quaternion();
  const ud = model.userData as Record<string, unknown>;
  // Collect the liquid materials FIRST, and do not cache a negative.
  //
  // A charm's GLB loads async and its materials are tuned when it lands, but the
  // render loop is already running — so the first few ticks legitimately find
  // nothing. Caching that answer pinned the liquid to "no animation" forever,
  // which looked exactly like the feature not working.
  //
  // Re-walking is cheap enough to do unconditionally: a charm is ~6 nodes, and
  // the walk allocates nothing and exits before the quaternion work below for
  // the 81 charms that have no liquid at all.
  const mats: ThreeNS.MeshStandardMaterial[] = [];
  model.traverse((n) => {
    const m = (n as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial | undefined;
    if (m?.userData?.lqUpObj) mats.push(m);
  });
  if (liquidProbe.mode) {
    const g = globalThis as { __lqTick?: number; __lqFound?: number };
    g.__lqTick = (g.__lqTick ?? 0) + 1;
    g.__lqFound = mats.length;
  }
  if (!mats.length) return;
  const q = model.getWorldQuaternion(scratchQuat);
  let rest = ud.lqRestQuat as ThreeNS.Quaternion | undefined;
  if (!rest) {
    rest = q.clone();
    ud.lqRestQuat = rest;
  }
  // World up carried into the CURRENT object frame, then through the fixed
  // rotation that took the REST frame's answer onto the model's +Z.
  const cur = worldUp.clone().applyQuaternion(q.clone().invert());
  const ref = worldUp.clone().applyQuaternion(rest.clone().invert()).normalize();
  const cal = ud.lqCal as ThreeNS.Quaternion | undefined
    ?? (ud.lqCal = new THREE.Quaternion().setFromUnitVectors(ref, new THREE.Vector3(0, 0, 1)));
  const upObj = cur.applyQuaternion(cal as ThreeNS.Quaternion).normalize();

  // Angular speed as the agitation signal — the physical analogue of what the
  // game feeds, and it needs no hook into the solver's internals. Decays rather
  // than tracking instantaneously so a charm that stops still sloshes for a beat.
  const prev = ud.lqPrevQuat as ThreeNS.Quaternion | undefined;
  let spin = 0;
  if (prev && dt > 0) {
    // Angle between successive orientations; 2*acos|dot| is the quaternion metric.
    const d = Math.min(1, Math.abs(prev.dot(q)));
    spin = (2 * Math.acos(d)) / dt;
  }
  (ud.lqPrevQuat as ThreeNS.Quaternion | undefined)?.copy(q) ?? (ud.lqPrevQuat = q.clone());
  // MAPPING SPIN -> AGITATION, and the divisor is not arbitrary.
  //
  // The shader scales its wobble by `agit^2` where `agit = agitation^2 + 0.01` —
  // a FOURTH power of the input. Measured on the render: agitation 0.4 moves the
  // surface 2px, 0.7 moves it 7px, 1.0 moves it 30px. Anything below ~0.7 is
  // invisible, so a conservative mapping renders the whole feature dead.
  //
  // CS2's own scale for attribute 0x4B002DCA is not decodable (vfx_decode drops
  // it), so there is no ground truth to match here — only the requirement that a
  // swinging charm visibly sloshes. 0.3 rad/s maps a typical sway peak (~0.23)
  // onto ~0.75, which lands in the range that reads.
  // A RESTING FLOOR, because the reference render's liquid moves while the charm
  // does not. The game's live agitation is plainly not zero at rest, and leaning
  // on our own idle sway to supply it was the wrong shape — the sway exists to
  // look like a hanging charm, not to be the liquid's only power source.
  //
  // 0.7 IS NOT A GUESS ANYMORE. csgoskins' port of this shader drives agitation
  // as `mix(0.9, 0.7, saturate(pow((time - 5) / 10, 2)))` — it starts sloshing at
  // 0.9 and settles to 0.7 about fifteen seconds after load. The material's own
  // authored g_flTestAgitation is 0.375 on the vessel, but that is the static
  // fallback behind a render-attribute expression the decompiler drops, and it is
  // plainly not what a rendered charm uses.
  //
  // The value matters far more than "some sloshing" suggests, because the bubble
  // size goes as a^9: 0.55 gives 0.005 and 0.7 gives 0.040, an eightfold
  // difference in a term that was already rounding to nothing. See csLiquidBubbles.
  //
  // Their 0.9 -> 0.7 decay is not reproduced: it is keyed to page load, which for
  // a charm that can be mounted, dismissed and re-mounted in a grid would restart
  // the slosh every time. Settling straight to their settled value is the honest
  // version of a charm that has been hanging there.
  const decayed = Math.max(
    REST_AGITATION,
    ((ud.lqAgit as number) ?? 0) * Math.max(0, 1 - dt * 2.5),
    Math.min(1, spin / 0.3),
  );
  ud.lqAgit = decayed;
  const elapsed = ((ud.lqClock as number | undefined) ?? 0) + dt;
  ud.lqClock = elapsed;

  for (const mat of mats) {
    const u = mat.userData as Record<string, unknown>;
    (u.lqUpObj as ThreeNS.Vector3).copy(upObj);
    // Live agitation feeds csLiquidWobble's amplitude — this is what turns the
    // transcribed noise from a flat constant into a moving surface.
    const d4 = u.lqD as ThreeNS.Vector4 | undefined;
    if (d4) d4.w = Math.min(1, ((u.lqAgitBase as number | undefined) ?? 0) + decayed);
    // The shader's own clock: `fract((t) * 0.005) * 200` keeps it bounded so the
    // sin() phases never lose precision on a viewer left open for hours.
    const a4 = u.lqA as ThreeNS.Vector4 | undefined;
    if (a4) a4.y = (elapsed * 0.005) % 1.0 * 200.0;
  }
}

/**
 * Bind one material's liquid uniforms, or refresh them in place.
 *
 * Live Vector objects for the same reason the colour grade uses them: two of
 * these params are seed-driven, so dragging the pattern rail re-resolves the
 * liquid every tick and must not recompile a program to do it.
 */
export function setCharmLiquidUniforms(
  THREE: Three,
  mat: ThreeNS.MeshStandardMaterial,
  lq: ResolvedLiquid,
): void {
  const u = mat.userData as Record<string, unknown>;
  const v3 = (key: string, v: [number, number, number]) => {
    const cur = u[key] as ThreeNS.Vector3 | undefined;
    if (cur) cur.set(v[0], v[1], v[2]);
    else u[key] = new THREE.Vector3(v[0], v[1], v[2]);
  };
  const v4 = (key: string, v: [number, number, number, number]) => {
    const cur = u[key] as ThreeNS.Vector4 | undefined;
    if (cur) cur.set(v[0], v[1], v[2], v[3]);
    else u[key] = new THREE.Vector4(v[0], v[1], v[2], v[3]);
  };
  v3("lqUp", lq.up);
  // Rest value; tickCharmLiquid rewrites it in place every frame the charm moves.
  if (!u.lqUpObj) u.lqUpObj = new THREE.Vector3(0, 0, 1);
  u.lqAgitBase = lq.agitation;
  v3("lqLevelUp", lq.levelUp);
  v3("lqLevelDown", lq.levelDown);
  v3("lqLevelSide", lq.levelSide);
  v3("lqCenter", lq.center);
  v3("lqColor", lq.color);
  v4("lqA", lq.a);
  v4("lqB", lq.b);
  v4("lqC", lq.c);
  v4("lqD", lq.d);
  v4("lqF", lq.f);
  v4("lqR", lq.r);
  v4("lqS", lq.s);
  v3("lqBubIn", lq.bub);
  v3("lqBubOut", lq.bubOut);
  v3("lqG", lq.g);
  const e = u.lqE as ThreeNS.Vector3 | undefined;
  const hasRough = u.lqRough && (u.lqRough as { isTexture?: boolean }).isTexture && u.lqRoughBound === true;
  // .z gates the metalness: the fallback texture is white, so an unbound map
  // would otherwise read alpha 1.0 and render the whole charm as chrome.
  const hasMetal = u.lqMetal && (u.lqMetal as { isTexture?: boolean }).isTexture && u.lqMetalBound === true;
  if (e) e.set(GLASS_ROUGHNESS, hasRough ? 1 : 0, hasMetal ? 1 : 0);
  else u.lqE = new THREE.Vector3(GLASS_ROUGHNESS, hasRough ? 1 : 0, hasMetal ? 1 : 0);
  const w = u.lqW as ThreeNS.Vector2 | undefined;
  if (w) w.set(lq.w[0], lq.w[1]);
  else u.lqW = new THREE.Vector2(lq.w[0], lq.w[1]);
  const m = u.lqMask as ThreeNS.Vector2 | undefined;
  if (m) m.set(lq.mask[0], lq.mask[1]);
  else u.lqMask = new THREE.Vector2(lq.mask[0], lq.mask[1]);
}

/**
 * Inject the liquid into a compiled MeshStandardMaterial.
 *
 * The albedo step lands after `<normal_fragment_maps>` rather than at
 * `<map_fragment>` where the charm grade goes: the level test needs the FINAL
 * world normal, and three only has that once the normal map has been applied.
 * `diffuseColor` is still in scope there and nothing has lit it yet.
 */
export function patchCharmLiquidShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> },
  mat: ThreeNS.MeshStandardMaterial,
): void {
  const u = mat.userData as Record<string, unknown>;
  if (liquidProbe.mode) {
    const g = globalThis as { __lqMats?: unknown[] };
    (g.__lqMats ??= []).push(mat);
  }
  shader.uniforms.uLqCenter = { value: u.lqCenter };
  shader.uniforms.uLqUp = { value: u.lqUp };
  shader.uniforms.uLqUpObj = { value: u.lqUpObj };
  shader.uniforms.uLqLevelUp = { value: u.lqLevelUp };
  shader.uniforms.uLqLevelDown = { value: u.lqLevelDown };
  shader.uniforms.uLqLevelSide = { value: u.lqLevelSide };
  shader.uniforms.uLqColor = { value: u.lqColor };
  shader.uniforms.uLqA = { value: u.lqA };
  shader.uniforms.uLqB = { value: u.lqB };
  shader.uniforms.uLqC = { value: u.lqC };
  shader.uniforms.uLqD = { value: u.lqD };
  shader.uniforms.uLqMask = { value: u.lqMask };
  shader.uniforms.uLqW = { value: u.lqW };
  shader.uniforms.uLqE = { value: u.lqE };
  shader.uniforms.uLqRough = { value: u.lqRough };
  shader.uniforms.uLqMetal = { value: u.lqMetal };
  shader.uniforms.uLqF = { value: u.lqF };
  shader.uniforms.uLqG = { value: u.lqG };
  shader.uniforms.uLqR = { value: u.lqR };
  shader.uniforms.uLqS = { value: u.lqS };
  shader.uniforms.uLqBubIn = { value: u.lqBubIn };
  shader.uniforms.uLqBubOut = { value: u.lqBubOut };

  shader.vertexShader = shader.vertexShader
    .replace("void main() {", `${CHARM_LIQUID_VERTEX_PARS}\nvoid main() {`)
    .replace("#include <skinning_vertex>", `#include <skinning_vertex>\n${CHARM_LIQUID_VERTEX}`);

  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", `${CHARM_LIQUID_GLSL}\nvoid main() {`)
    .replace(
      "#include <normal_fragment_maps>",
      [
        "#include <normal_fragment_maps>",
        "\tfloat lqSpecKill = 1.0;",
        // HOISTED FOR THE REFRACTION, which runs at <lights_fragment_end> — it
        // needs the scene's environment and the direct lights, and neither exists
        // this early. Everything the refraction reads is computed here anyway;
        // recomputing the sample down there would double the cost of the most
        // expensive part of the shader for no new information.
        //
        // Names carry the decompile's temporary alongside them so the transcription
        // below can be checked against liquid_outer_combo12.glsl line by line.
        "\tfloat lqRefrCover = 0.0;              // _21055",
        "\tfloat lqRefrMask = 0.0;               // _22843",
        "\tfloat lqRefrSurf = 0.0;               // _9387",
        "\tfloat lqRefrRough = 1.0;              // _23988",
        "\tfloat lqRefrFres = 0.0;               // _13948",
        "\tvec3 lqRefrN = vec3( 0.0, 0.0, 1.0 ); // _14278, WORLD",
        "\tvec3 lqRefrV = vec3( 0.0, 0.0, -1.0 );// _23996, WORLD, camera -> fragment",
        "\tvec3 lqRefrAlb = vec3( 0.0 );         // _8673",
        "\tfloat lqBubA = 0.0;                   // bubble coverage, for probe 21",
        "\tvec3 lqBubRGB = vec3( 0.0 );          // bubble tint, for probe 22",
        "\t{",
        // three's `normal` is VIEW space by here; the whole liquid works in
        // world, where gravity and the level are.
        "\t\tvec3 lqN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );",
        // Sampled BEFORE csLiquidSample: the waterline sharpness reads it too.
        "\t\tfloat lqRoughS = uLqE.y > 0.5 ? texture2D( uLqRough, vMapUv ).a : uLqE.x;",
        "\t\tLqSample lqS = csLiquidSample( lqN, lqRoughS );",
        "\t\tfloat lqWater, lqFront, lqBack;",
        "\t\tfloat lqCover = csLiquidCoverage( lqS, lqWater, lqFront, lqBack );",
        "\t\tfloat lqA = clamp( lqCover * lqS.mask, 0.0, 1.0 );",
        "\t\tvec3 lqC = csLiquidColor( lqWater );",
        ...(liquidProbe.mode === 20 ? ["\t\tlqSpecKill = 1.0 - lqA;"] : []),
        // THE GLASS'S OWN COLOUR MUST NOT SURVIVE UNDER THE LIQUID.
        //
        // We approximate the submerged body as `glassAlbedo * liquidColour`, but
        // in game that region is dominated by light REFRACTED through the
        // coloured volume (F_OPAQUE_REFRACT, g_flCubeRefractLiquidTransparency
        // 1.02) — the glass's surface tint is not in that path. Multiplying kept
        // the albedo's teal, which is heavy in BLUE, and that is measurably the
        // whole remaining error: with specular removed the liquid still read
        // linear B/R 0.37 against the reference's 0.168, while G was already
        // slightly too low, so no hue rotation can fix both (checked: 15deg
        // matches blue and overshoots green).
        //
        // Desaturating the albedo toward its own luminance under the liquid is
        // the bounded stand-in: it keeps the shading (which is what the albedo
        // legitimately carries here) and drops the surface tint (which the
        // refracted path would not carry).
        "\t\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2125, 0.7154, 0.0721 ) ) ), lqA );",
        // The glass itself darkens where the view grazes it, gated by the mask —
        // `_14119`, and the reason the empty half is not simply the raw albedo.
        "\t\tfloat lqEdge = clamp( 2.0 * ( lqS.fres - uLqB.w ), 0.0, 1.0 );",
        "\t\tdiffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.2 ), lqEdge * lqS.mask );",
        // Bubbles ride INSIDE the liquid: brighten toward their own colour where
        // they cover, exactly as the shader's `mix(1, bubbleTint*4, opacity*cover)`.
        "\t\tfloat lqAgitF = uLqD.w * uLqD.w + 0.01;",
        "\t\tvec2 lqDisp;",
        // uLqD.w (RAW agitation), NOT lqAgitF (which is already a*a + 0.01) —
        // see the two-curve note over csLiquidBubbles.
        "\t\tvec4 lqBub = csLiquidBubbles( uLqD.w, lqS.depth, lqRoughS, lqDisp );",
        // BUBBLES ARE A NORMAL PERTURBATION, and that is why they were invisible.
        //
        // g_flBubbleStrength (10.0) appears nowhere near the colour: the shader
        // spends it bending the shading normal by the accumulated bubble offset,
        // in the CAMERA's right/up plane. They read as little lens-like bumps
        // catching the light — the glossy dots in the reference render — not as
        // patches of brightness. Tinting the albedo alone (the secondary
        // _4789 path, kept below) moves the pixel ~5% and looks like nothing.
        "\t\tvec3 lqCamR = normalize( vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] ) );",
        "\t\tnormal = normalize( normal + ( ( lqCamR * lqDisp.y + cross( lqCamR, lqS.viewDir ) * lqDisp.x ) * uLqG.z * lqA ) );",
        "\t\tlqBubA = lqBub.a;",
        "\t\tlqBubRGB = lqBub.rgb;",
        "\t\tvec3 lqCB = lqC * mix( vec3( 1.0 ), lqBub.rgb * 4.0, clamp( lqBub.a, 0.0, 1.0 ) );",
        "\t\tdiffuseColor.rgb *= mix( vec3( 1.0 ), lqCB, lqA );",
        // Inner glow: brightest right at the surface, where the denominator is 1.
        "\t\tfloat lqDepth = 1.0 + max( lqS.depth, 0.0 );",
        "\t\tdiffuseColor.rgb += lqC * uLqA.w * pow( lqS.ndv, 3.0 ) * lqA / lqDepth * uLqD.x;",
        // And the empty half is lifted, so glass above the line reads as air.
        "\t\tdiffuseColor.rgb *= 1.0 + uLqC.w * lqS.mask * clamp( 1.0 - lqCover, 0.0, 1.0 );",
        // Hand the refraction everything it needs. `_8673` is the albedo at
        // exactly this point — after the empty-area lift and before the roughness
        // overrides — which is what the cube-refract tints itself by.
        "\t\tlqRefrCover = lqCover;",
        "\t\tlqRefrMask = lqS.mask;",
        // _9387 = saturate((back - front) * mask): where you see through the far
        // wall but not the near one, i.e. the liquid's own SURFACE. It picks the
        // third index of refraction. Note the sign is the opposite way round from
        // lqInside below, which is a different term despite the similar shape.
        "\t\tlqRefrSurf = clamp( ( lqBack - lqFront ) * lqS.mask, 0.0, 1.0 );",
        "\t\tlqRefrRough = lqRoughS;",
        "\t\tlqRefrFres = lqS.fres;",
        "\t\tlqRefrV = lqS.viewDir;",
        "\t\tlqRefrAlb = diffuseColor.rgb;",
        // _14278 — the refraction normal leans toward the BUBBLE-perturbed normal
        // inside the liquid and stays geometric outside it. `normal` has already
        // been bent above, so read it back out of view space rather than
        // recomputing the displacement.
        "\t\tvec3 lqNbub = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );",
        "\t\tlqRefrN = normalize( mix( lqN, mix( lqN, lqNbub, vec3( 0.75 ) ), vec3( lqCover ) ) );",
        // Roughness follows the liquid inside the body, and goes broad at the
        // waterline — the 0.09 offset is the shader's, not a copy of the 0.05 above.
        ...(liquidProbe.mode === 1
          ? ["\t\tdiffuseColor.rgb = lqS.d > 0.0 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 0.2, 1.0 );"]
          : liquidProbe.mode === 2
            ? ["\t\tdiffuseColor.rgb = vec3( clamp( vLqHeight * 0.5 + 0.5, 0.0, 1.0 ) );"]
            : liquidProbe.mode === 3
              ? ["\t\tdiffuseColor.rgb = vec3( lqCover );"]
              : liquidProbe.mode === 6
                ? ["\t\tdiffuseColor.rgb = vec3( clamp( lqS.vdg, 0.0, 1.0 ), clamp( -lqS.vdg, 0.0, 1.0 ), 0.0 );"]
                : liquidProbe.mode === 8
                  ? ["\t\tdiffuseColor.rgb = lqS.viewDir * 0.5 + 0.5;"]
                  : liquidProbe.mode === 9
                    ? ["\t\tdiffuseColor.rgb = uLqUp * 0.5 + 0.5;"]
                    : liquidProbe.mode === 7
                  ? ["\t\tdiffuseColor.rgb = vec3( clamp( lqS.back, 0.0, 1.0 ), clamp( lqS.back - 1.0, 0.0, 1.0 ), 0.0 );"]
                  // 21 was DOCUMENTED AND NEVER IMPLEMENTED. Selecting it silently
                  // rendered the charm normally, so every "bubble coverage"
                  // measurement taken through it was really measuring the lit
                  // render's brightness — including one that reported the bubbles
                  // as fixed when they were not. A probe that does nothing is worse
                  // than no probe: it answers.
                  : []),
        // The vessel's own surface, before the liquid and waterline overrides
        // below take it toward g_flLiquidRoughness and the meniscus.
        // The AUTHORED glass roughness, out of the normal map's alpha — see the
        // roughMap note in extract-models.sh. uLqE.y is 1 when one is bound;
        // without it the constant stands in so the vessel is never matte.
        // METALNESS, from the albedo's ALPHA — the channel VRF's glTF export drops.
        //
        // The decompile does the textbook split off g_tColorA.w:
        //   _18392 = g_tColorA.w
        //   _24253 = mix(vec3(g_flReflectance), albedo, _18392)   specular colour
        //   ...    = mix(albedo * (1.0 - _18392), cubeRefract, …) diffuse killed
        //
        // three's PhysicalMaterial does exactly this given metalnessFactor, so it
        // is one assignment rather than a transcription. It is the difference
        // between the polished lighter case and hinge pin reading as chrome, and
        // reading as the flat matte plastic they did — the shader declares no
        // metalness TEXTURE, which is what made "this shader has no metalness"
        // look true for so long.
        "\t\tif ( uLqE.z > 0.5 ) metalnessFactor = texture2D( uLqMetal, vMapUv ).a;",
        "\t\troughnessFactor = min( roughnessFactor, lqRoughS );",
        "\t\tfloat lqInside = clamp( ( lqFront - lqBack ) * 2.0, 0.0, 1.0 );",
        "\t\troughnessFactor = mix( roughnessFactor, clamp( uLqD.y, 0.0, 1.0 ), lqInside );",
        "\t\tfloat lqWater2 = ( 1.0 - clamp( abs( lqS.d - 0.09 ) * lqS.ndv2 * lqS.sharp, 0.0, 1.0 ) )",
        "\t\t\t* lqS.ndv2 * uLqB.z;",
        "\t\troughnessFactor = mix( roughnessFactor, 0.75, clamp( lqWater2 * 2.0, 0.0, 1.0 ) );",
        "\t}",
      ].join("\n"),
    )
    .replace(
      "#include <lights_fragment_end>",
      [
        "#include <lights_fragment_end>",
        "\treflectedLight.directSpecular *= lqSpecKill;",
        "\treflectedLight.indirectSpecular *= lqSpecKill;",
        CHARM_LIQUID_REFRACT.replace("LQ_REFRACT_PROBE", refractProbe()),
      ].join("\n"),
    );
}

/**
 * Probe GLSL for the refraction stage, or nothing.
 *
 * Each mode blanks the rest of the lighting and shows one term alone, which is
 * the only way to tell "the refraction is wrong" from "the refraction is fine and
 * something else is drowning it". Kept as a function rather than inlined so a
 * mode that references an out-of-scope name is a TypeScript-adjacent mistake in
 * one place instead of a silent shader-compile failure — see DEBUGGING-SKINS.md:
 * three logs the failure once and keeps drawing with the previous program, so a
 * broken probe reads as garbage data rather than as a broken probe.
 */
function refractProbe(): string {
  const term =
    liquidProbe.mode === 30
      ? "lqCube * clamp( lqTrans * lqRefrMask, 0.0, 1.0 )"
      : liquidProbe.mode === 31
        ? "lqSpecOut"
        : liquidProbe.mode === 32
          ? "normalize( lqDir ) * 0.5 + 0.5"
          : liquidProbe.mode === 33
            ? "vec3( lqRRough )"
            : // GREEN where the refracted ray points at the light (the specular
              // can fire), RED where it points away (it never will). A fully red
              // charm means the lobe is not merely narrow, it is on the wrong
              // side — which is the one thing a black probe 31 cannot tell you.
              liquidProbe.mode === 34
              ? "vec3( clamp( -lqSunDot, 0.0, 1.0 ), clamp( lqSunDot, 0.0, 1.0 ), 0.0 )"
              // 21/22 live here rather than with the albedo probes because these
              // blank the lighting. Read against a lit surface, a coverage map is
              // coverage x lighting x reflections, which is unreadable — and that
              // is how "100% coverage" got reported off a probe that was in fact
              // showing the ordinary render.
              : liquidProbe.mode === 21
                ? "vec3( clamp( lqBubA, 0.0, 1.0 ) )"
                : liquidProbe.mode === 22
                  ? "lqBubRGB"
                  : null;
  if (!term) return "";
  return [
    "\t\treflectedLight.directDiffuse = vec3( 0.0 );",
    "\t\treflectedLight.indirectDiffuse = vec3( 0.0 );",
    "\t\treflectedLight.directSpecular = vec3( 0.0 );",
    "\t\treflectedLight.indirectSpecular = vec3( 0.0 );",
    `\t\ttotalEmissiveRadiance = ${term};`,
  ].join("\n");
}

/**
 * CUBE REFRACTION AND THE LIQUID'S OWN SPECULAR — the missing character.
 *
 * This file and the handover doc both had these filed as blocked on "a scene
 * colour buffer the viewer does not render". They are not, and that wrong note is
 * most of why four rounds of transcribing other terms each landed a correct and
 * invisible change: the two terms that carry the reference render's HARD
 * SPECULARS and REFLECTIONS were the ones nobody attempted.
 *
 * The decompile is explicit. liquid_outer_combo12.glsl:707 samples the refracted
 * ray out of `g_tEnvironmentMap` — a CUBEMAP ARRAY — and :1462 builds a
 * `refract()`-based sun highlight out of the light constants. A prefiltered
 * environment and one directional light is the whole requirement, and viewer3d
 * has had both since it was written (getSharedGL PMREMs RoomEnvironment; the
 * scene carries a key light).
 *
 * This is also the "metallic casing". `csgo_simple_liquid` declares no metalness
 * texture at all — g_tColorA, g_tNormalA, g_tLiquidMask, g_tDroplets and nothing
 * else — so the brass read on kc_db_lighter_02 was never a dropped channel
 * waiting to be recovered. It is this reflection.
 *
 * THREE DELIBERATE DEVIATIONS, all because the game's frame constants have no
 * counterpart here:
 *
 *  · No parallax correction. The game intersects the refracted ray against each
 *    env probe's AABB (`abs(min(_11253.x, ...))`) and blends toward the raw
 *    direction as roughness rises. RoomEnvironment is a single infinite probe
 *    with no box, so the raw direction is all there is — which is what the game
 *    itself converges to at roughness 1.
 *  · No energy-limit ratio. `min(luminance(irradiance) / dot(...), max(...))` in
 *    :735 clamps the env against the diffuse the same pixel already received.
 *    Both sides of that come from Valve's lighting buffers; 1.0 stands in.
 *  · Lights are three's, in three's units. The absolute brightness of both terms
 *    therefore rides envMapIntensity and the key light rather than the game's
 *    exposure, so treat `g_flCubeRefractBrightness` as authored-relative.
 *
 * Guarded on ENVMAP_TYPE_CUBE_UV: without a prefiltered environment there is no
 * `textureCubeUV` to call, and the charm renders exactly as it did before rather
 * than failing to compile.
 */
const CHARM_LIQUID_REFRACT = `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	{
		// _11859 — one index of refraction per region: the glass, the volume
		// behind it, and the liquid's own surface.
		float lqIor = mix( mix( uLqR.x, uLqR.y, lqRefrCover ), uLqR.z, lqRefrSurf );
		// _11823 / _7431. refract() returns exactly 0 under total internal
		// reflection, and the game leans on that: the length IS the blend weight,
		// so a grazing fragment falls back to the reflection on its own.
		vec3 lqRefracted = refract( lqRefrV, lqRefrN, lqIor );
		vec3 lqDir = mix( reflect( lqRefrV, lqRefrN ), lqRefracted, length( lqRefracted ) );
		// _23698. The shader writes dot(vec2(r), vec2(0.5)), which is just r.
		float lqRRough = mix( 0.1, 1.0, clamp( lqRefrRough * uLqR.w, 0.0, 1.0 ) );
		vec3 lqEnv = textureCubeUV( envMap, envMapRotation * normalize( lqDir ), lqRRough ).rgb * envMapIntensity;
		// _18406 — how transparent this region is, glass vs liquid.
		float lqTrans = mix( uLqS.x, uLqS.y, lqRefrCover );
		// _19791's tint: the albedo, darkened where the view grazes, fading to
		// white as transparency passes 1 (it is 1.02 on the liquid, so the
		// submerged half is very nearly untinted — which is exactly the reason the
		// glass's own teal must not survive under the liquid, see above).
		vec3 lqTint = mix( lqRefrAlb * mix( 1.25, 0.75, lqRefrFres ), vec3( 1.0 ), clamp( lqTrans - 1.0, 0.0, 1.0 ) );
		// ENERGY LIMIT. The game scales the refracted env by the ratio of the
		// irradiance this pixel actually received to the environment's own average
		// radiance, so a bright cubemap cannot dump light into a dim spot:
		//   min( luminance(probeIrradiance) / dot(vec4(refractDir,1), envAverage),
		//        max(rough * a + b, 1.0) )
		// Both of the game's operands come from Valve's lighting buffers. three's
		// own irradiance stands in for the numerator and the env sample we just
		// took for the denominator, which preserves the SHAPE of the clamp — env
		// brighter than the local light gets scaled down, never up.
		//
		// This was skipped in the first pass and it mattered: without it the liquid
		// measured sRGB (209,71,89) against the icon's (146,27,41) — brighter AND
		// more desaturated on both ratios, which is the signature of unbounded
		// white being added. The upper bound is 1.0 rather than the game's
		// roughness expression, whose two constants are per-view.
		const vec3 LQ_LUMA = vec3( 0.2125, 0.7154, 0.0721 );
		float lqEnergy = min( dot( irradiance + iblIrradiance, LQ_LUMA ) / max( dot( lqEnv, LQ_LUMA ), 1e-4 ), 1.0 );
		vec3 lqCube = lqTint * lqEnv * uLqS.z * lqEnergy;
		// _7811 — added, gated by transparency x mask, exactly where the game adds
		// it: alongside the emissive, not into the diffuse.
		totalEmissiveRadiance += lqCube * clamp( lqTrans * lqRefrMask, 0.0, 1.0 );

		// Hoisted so a probe can isolate them — the terms live inside the light
		// guard, and a probe cannot reach into a preprocessor branch. lqSunDot is
		// here for one specific question: this specular only fires when the
		// refracted ray points AT the light, so "it renders black" has two very
		// different causes (the lobe is off-camera, or the sun is on the wrong
		// side) and they are indistinguishable in a screenshot.
		vec3 lqSpecOut = vec3( 0.0 );
		float lqSunDot = 0.0;
		#if NUM_DIR_LIGHTS > 0
			// :1462 — THE HARD SPECULAR. Not a BRDF lobe: it is the refracted view
			// ray pointed at the sun, raised to 40/roughness, plus a second lobe at
			// 400/roughness scaled by 4. That inner lobe is the tight glint the
			// reference has on the casing and the vessel and we never did — three's
			// own specular is far too broad to stand in for it.
			//
			// TWO conversions, and the second was settled by measurement.
			//
			// three keeps light directions in VIEW space, so rotate to world the
			// same way the view vector is (v * viewMatrix).
			//
			// Then NEGATE. three's directionalLights[].direction points from the
			// surface TOWARD the light; Source's sun vector is the direction light
			// TRAVELS. (No backticks in this comment on purpose — one inside a GLSL
			// comment terminates the TS template literal, see DEBUGGING-SKINS.md.)
			// Without
			// the flip, probe 34 renders the charm SOLID RED — the refracted ray
			// points away from the light over the entire model, at every angle, so
			// the lobe is not narrow, it is unreachable. Guessing between the two
			// conventions would have been a coin flip; the probe exists precisely
			// because "renders black" is the same picture either way.
			vec3 lqSun = -normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz );
			float lqSpecRough = lqRefrRough + 0.2;
			vec3 lqSpecDir = normalize( refract( lqRefrV, lqRefrN, mix( lqIor, 1.0, 0.5 ) ) );
			lqSunDot = dot( lqSpecDir, lqSun );
			float lqLobe = pow( clamp( lqSunDot, 0.0, 1.0 ), 40.0 / lqSpecRough );
			vec3 lqSpec = lqRefrAlb * ( pow( directionalLights[ 0 ].color, vec3( 2.0 ) )
				* ( ( ( lqLobe + pow( lqLobe, 400.0 / lqSpecRough ) * 4.0 ) * lqRefrMask ) * 4.0 ) );
			lqSpecOut = lqSpec * lqTrans * 2.0 * uLqS.z * lqRefrMask;
			totalEmissiveRadiance += lqSpecOut;
		#endif
LQ_REFRACT_PROBE
	}
#endif
`;
