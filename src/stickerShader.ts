/**
 * csgo_weapon_sticker.vfx — alpha, wear, tint/PBR refit, glitter, holographic
 * and gold.
 *
 * Transcribed from the decompiled shader (VCS 71,
 * csgo_weapon_sticker_vulkan_50_ps.vcs static combo 0 — the whole feature set is
 * DYNAMIC bools, so one combo carries every finish). The dump is kept beside
 * this file's sibling ground truths at tools/shadertest/groundtruth/sticker.glsl;
 * symbols there are numbered, and every constant below is named after the
 * uniform it came from so the two can be diffed by eye.
 *
 * Modelled on paintSfx.ts rather than paintComposite.ts, and for the same
 * reason: glitter and holo are VIEW-DEPENDENT — they change as the camera moves
 * — so they cannot be baked into a texture the way the paint styles are. This is
 * an onBeforeCompile patch on the decal's MeshStandardMaterial that keeps
 * three's PBR/IBL and adds the effect on top.
 *
 * WHAT IS EXACT
 *   - The ×12.75 alpha expansion (sticker.glsl:420). The art's alpha channel is
 *     DUAL-PURPOSE: bytes 0-20 are the antialiased coverage ramp, 20-255 the
 *     wear-erosion order. Display uses saturate(a*12.75); the wear remap eats
 *     the RAW byte. Without the expansion a sticker interior renders at its
 *     wear-order value — the "half-transparent sticker" bug.
 *   - The wear chain, every term from the decompile.
 *   - The albedo-levels PBR refit (sticker.glsl:548-623) and its holo and
 *     glitter variants. The engine-global level vectors are no longer missing:
 *     they were decoded from this .vcs's own variable table (see STK_LEVELS
 *     below), which also retired the `stkFoil` metal/rough stand-in the earlier
 *     revision carried — the refit is where foil really comes from.
 *   - Self-illum (sticker.glsl:625-628), riding .w of the normal/rough texture.
 *
 * WHAT IS APPROXIMATE, AND FLAGGED RATHER THAN HIDDEN
 *   - Wear runs before the tint/holo work here, where the game runs it after
 *     (sticker.glsl:688 vs :548): only the scratch RGB darkening of worn effect
 *     stickers differs, never the shape of the erosion.
 *   - The holo view term: Valve adds dot(V,N) + dot(V,lightDir)
 *     (sticker.glsl:647). The light half is a constant here, STK_HOLO_LIGHT,
 *     calibrated on a lenticular sticker in the game's inspect view.
 *   - The glitter sparkle reflects about normal+flake rather than the full
 *     tangent-frame flake normal (sticker.glsl:495) — no tangent basis in a
 *     three chunk. Structure and constants are otherwise the decompile's.
 */
import type * as ThreeNS from "three";

type Three = typeof ThreeNS;

/** The `sfx` half of /api/catalog/sticker-art. Mirrors StickerSfx in the backend. */
export interface StickerSfx {
  scratches: string | null;
  sfxMask: string | null;
  holoSpectrum: string | null;
  glitterNormal: string | null;
  normalRoughness: string | null;
  backing: string | null;
  glitter: boolean;
  holo: boolean;
  metallic: boolean;
  paperBacking: boolean;
  pbrFit: boolean;
  legacyTint: boolean;
  preserveRoughness: boolean;
  clampSpectrumV: boolean;
  selfIllum: boolean;
  wear: number;
  wearScratches: number;
  colorBoost: number;
  sfxColorBoost: number;
  tintSaturate: number;
  glitterScale: number;
  colorTint: [number, number, number];
  wearBias: [number, number];
}

/** Extra knobs for applyStickerSfx that are about the ART, not the material. */
/**
 * Per-material uniforms the live 3D viewer writes every frame to make holo and
 * lenticular stickers follow the camera and the light. `uHoloLive` 0 (the
 * default, and every baked card) keeps the fixed formula; see the holo branch.
 * Eye and light are VIEW-space; the eye is a point, the light a direction.
 */
export interface StickerHoloLive {
  uHoloLive: { value: number };
  uHoloEye: { value: ThreeNS.Vector3 };
  uHoloLight: { value: ThreeNS.Vector3 };
  uHoloGlint: { value: ThreeNS.Vector3 };
  uHoloBias: { value: number };
  uHoloShine: { value: number };
}

export interface StickerSfxOpts {
  /**
   * True only when the map really is g_tSticker0 — the game texture whose
   * alpha is the coverage-ramp/wear-order dual channel. The icon fallback and
   * patch albedos carry ORDINARY alpha, and expanding those would hard-clip
   * their soft edges. The caller knows which bitmap it loaded; we do not.
   */
  expandAlpha?: boolean;
}

/**
 * Old-backend fallback: no material doc at all means "plain sticker" — the
 * expansion can still apply (the flags all read off), nothing else does.
 * pbrFit is deliberately false here even though the shader's own default is
 * true: with no doc we do not know this is a sticker material.
 */
const PLAIN_SFX: StickerSfx = {
  scratches: null, sfxMask: null, holoSpectrum: null, glitterNormal: null,
  normalRoughness: null, backing: null,
  glitter: false, holo: false, metallic: false, paperBacking: false,
  pbrFit: false, legacyTint: false, preserveRoughness: false,
  clampSpectrumV: true, selfIllum: false,
  wear: 0, wearScratches: 1, colorBoost: 1, sfxColorBoost: 1,
  tintSaturate: 1, glitterScale: 1, colorTint: [1, 1, 1], wearBias: [1, 1],
};

/** Does this sticker need the patch at all? Real g_tSticker0 art always does
 *  (the alpha expansion), as does any effect finish, wear, or the PBR refit —
 *  which defaults ON in the shader's variable table, so in practice every
 *  sticker with a material doc patches. They still share one program: the
 *  cache key is the flag bits, not the material. */
export function needsStickerShader(sfx: StickerSfx | null, wear: number, expandAlpha = false): boolean {
  if (expandAlpha) return true;
  if (!sfx) return false;
  return (
    wear > 0 || sfx.glitter || sfx.holo || sfx.metallic || sfx.paperBacking ||
    sfx.pbrFit || sfx.selfIllum || !!sfx.normalRoughness
  );
}

const GLSL = /* glsl */ `
uniform sampler2D uScratchTex, uSfxMaskTex, uHoloTex, uGlitterTex, uNormRoughTex;
uniform bool uHasScratch, uHasSfxMask, uHasHolo, uHasGlitter, uHasNormRough;
uniform bool uPaperBacking, uMetallic, uPreserveRough, uClampSpectrumV;
uniform vec4 uStkArtUv;
uniform float uHoloLive, uHoloBias, uHoloShine;
uniform vec3 uHoloEye, uHoloLight, uHoloGlint;
uniform bool uExpandAlpha, uPbrFit, uLegacyTint, uSelfIllum;
uniform float uWear, uWearScratches, uSfxColorBoost, uGlitterScale, uColorBoost, uTintSaturate;
uniform vec2 uWearBias;
uniform vec3 uColorTint;

const vec3 STK_LUMA = vec3(0.2125, 0.7154, 0.0721);

/**
 * Valve's engine-global "albedo levels", decoded 2026-08-10 from this .vcs's
 * own variable table (VariableSource=__Expression__) under the same rule that
 * recovered the glove textile levels:
 *   float3(-A.x, -1.4427*log(max(.0001, 1-A.y)), 2-A.z)
 *   g_vAlbedoLevels             A=(-.045,.40,1.15) -> (0.045, 0.737,   0.85)
 *   g_vHoloAlbedoLevels         A=(-.05, .35,1.15) -> (0.05,  0.62149, 0.85)
 *   g_vMetallicAlbedoLevels     A=(-.45, .40,1.08) -> (0.45,  0.737,   0.92)
 *   g_vDarkMetallicAlbedoLevels A=(-.10, .40,1.08) -> (0.1,   0.737,   0.92)
 * The first agrees with OV_LEVELS in paintComposite.ts, decoded independently
 * from the weapon shader — that agreement is what validates the decode.
 * g_fColorBoostFactor is authored as "64-1" in the same table.
 */
const vec3 STK_LEVELS = vec3(0.045, 0.737, 0.85);
const vec3 STK_HOLO_LEVELS = vec3(0.05, 0.62149, 0.85);
const vec3 STK_METAL_LEVELS = vec3(0.45, 0.737, 0.92);
const vec3 STK_DARK_METAL_LEVELS = vec3(0.1, 0.737, 0.92);
const float STK_BOOST_FACTOR = 63.0;
/**
 * dot(V, lightDir) of the game's holo view term (sticker.glsl:647), as a
 * constant. We have no scene light vector here, and without the term the
 * spectrum is read a fixed distance off the frame the game shows — invisible on
 * a rainbow foil, wrong on a LENTICULAR sticker, whose "spectrum" is a set of
 * frames: Econometer's needle reads FORCE head-on in the inspect view, which is
 * where 0.6 puts it (0.5 swings it toward BUY, 0.7 toward ECO).
 */
const float STK_HOLO_LIGHT = 0.6;

float stkMaxc(vec3 v) { return max(v.x, max(v.y, v.z)); }

/** smoothstep with edge0 > edge1 — the decompile leans on HLSL's formula,
 *  which simply inverts the ramp; GLSL calls that case undefined, so spell
 *  the formula out. */
float stkSmoothInv(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * The sticker normal and the glitter flake sheet, as they reach US: an ordinary
 * RGB tangent-space normal map. The game stores them hemi-octahedral in RG
 * (decoded in the shader with (r+g)-256/255, r-g), but the extractor's
 * Source2Viewer decodes on export ("auto" decode flags, TextureCodec.HemiOctRB):
 * it writes n*0.5+0.5 to RGB and moves the roughness that sat in B into ALPHA.
 * Measured: blue equals the reconstructed z on every one checked. Running the
 * game's hemi-oct decode over already-decoded RGB bent the normals hard enough
 * on steep bevels to face away from the camera (the spikes on Bolt Charge
 * (Foil)'s tip).
 */
vec3 stkDecodeNormal(vec4 t) {
  return normalize(t.xyz * 2.0 - 1.0);
}

/**
 * The albedo-levels refit body. sticker.glsl:518 (glitter), :570-576 and
 * :586-592 (base albedo) and :663-664 (holo) are all this one shape with
 * different level vectors and boost terms:
 *
 *   n   = normalize(max(3e-4, cShape)) * 1.06
 *   hi  = max((n*lo*1.732)/|n|/dot(n,LUMA), n * mix(L.x, L.z, sat(pow(maxTerm, L.y))))
 *   hi  = mix(hi, min(L.z, hi + ext), extAmount)          // boost headroom
 *   out = mix(vec3(lo), hi, pow(smoothstep(3e-4, lo, luma), 0.5))
 *
 * This is ovLevels() from paintComposite.ts with the levels parameterised —
 * the two should be kept diffable.
 */
vec3 stkLevelsFit(vec3 cShape, vec3 L, float lo, float maxTerm, float luma, float ext, float extAmount) {
  vec3 n = normalize(max(vec3(0.0003), cShape)) * 1.06;
  vec3 hi = max((n * lo * 1.732) / vec3(length(n)) / vec3(dot(n, STK_LUMA)),
                n * mix(L.x, L.z, clamp(pow(maxTerm, L.y), 0.0, 1.0)));
  hi = mix(hi, min(vec3(L.z), hi + vec3(ext)), vec3(extAmount));
  return mix(vec3(lo), hi, vec3(pow(smoothstep(0.0003, lo, luma), 0.5)));
}

/**
 * The base-albedo refit, sticker.glsl:570-576 (legacy) / :586-592. The level
 * set slides from paper to metallic with the metal accumulator, and dark
 * colours get the DARK metallic set — that smoothstep runs high-to-low.
 * cShape feeds the hue-preserving normalise; cLevel feeds the luma/max terms
 * (the two differ only on the non-legacy path, where the tint shapes but the
 * raw art levels).
 */
vec3 stkRefitFull(vec3 cShape, vec3 cLevel, float m) {
  float luma = dot(clamp(cLevel * uColorBoost, 0.0, 1.0), STK_LUMA);
  vec3 L = mix(STK_LEVELS,
               mix(STK_METAL_LEVELS, STK_DARK_METAL_LEVELS, vec3(stkSmoothInv(0.55, 0.0156, luma))),
               vec3(m));
  float lo = mix(STK_LEVELS.x, STK_DARK_METAL_LEVELS.x, m);
  return stkLevelsFit(cShape, L, lo, stkMaxc(cLevel) * uColorBoost, luma,
                      luma, max(0.0, uColorBoost - 1.0) / STK_BOOST_FACTOR);
}

/**
 * The sparkle lobe. sin(R*12) thresholded at 0.99 and multiplied back up by
 * 1/(1-0.99) — a very tight highlight, which is what makes glitter read as
 * discrete flakes rather than a sheen.
 */
vec3 stkSparkle(vec3 R) {
  vec3 s = sin(R * 12.0);
  vec3 hi = max(vec3(0.0), s - vec3(0.99)) * 100.0;
  return vec3(pow(dot(clamp(-s, 0.0, 1.0), STK_LUMA), 4.0))
       + vec3(dot(clamp(vec3(0.15) - s, 0.0, 1.0), STK_LUMA) * 0.25)
       + (hi + pow(hi.yzx, vec3(4.0))) * 4.0 * 0.75;
}
`;

/**
 * The wear chain, verbatim from the decompile.
 *
 *   scratch  = mix(s, s*0.5, wear)     where s = 1 - min(wearScratches, tex.r)
 *   edge     = saturate(wear - pow(remap(alpha), biasX^2))
 *   cutoff   = saturate(edge*(1+bias) - bias)
 *   alpha   *= smoothstep(cutoff, cutoff+0.1, scratch)
 *   rgb      = mix(rgb, rgb*scratch, wear*0.3)
 *
 * The alpha remap (a - 0.0784) * 1.0851 is the inverse of the *12.75 expansion
 * the shader applies to the art's alpha a few lines earlier: 1/12.75 = 0.0784.
 * So wear eats the sticker from its SOFT EDGES inward, which is why a worn
 * sticker loses its outline first and its middle last. The remap reads the
 * RAW texel (stkRawA, sticker.glsl:703) — the erosion multiply lands on the
 * EXPANDED alpha (sticker.glsl:731).
 */
/**
 * The UV every effect texture is read at — the GAME's texture space, not the
 * decal's.
 *
 * The decal's map is not the game's texture: loadStickerTexture crops the art
 * to its ink, re-squares it and flips it upright for upload. The mask, relief,
 * scratches and spectrum are the game's own files, full-size and unflipped, so
 * reading them at the map's UV put every effect upside down and shifted by the
 * crop. On a rainbow foil that is invisible; on a lenticular, whose mask draws
 * the moving needle into a precise window, it tore the artwork apart. The map
 * records its crop (stkArtUv: left, top, width, height of the source) and this
 * walks back through it. With no crop recorded the uniform is the identity.
 */
const STK_UV = /* glsl */ `stkUv = uStkArtUv.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * uStkArtUv.zw;`;

const WEAR_GLSL = /* glsl */ `
{
  float stkWear = uWear;
  if (stkWear > 0.0) {
    float sTex = uHasScratch ? texture2D(uScratchTex, stkUv).x : 1.0;
    float s = 1.0 - min(uWearScratches, sTex);
    float scratch = mix(s, s * 0.5, stkWear);
    // Paper backing widens the cutoff to a flat 0.5; everything else derives it
    // from the material's own bias, with an asymmetry on the sign of Y.
    float bias = uPaperBacking
      ? 0.5
      : ((uWearBias.y * (uWearBias.y > 0.0 ? 0.5 : 0.25)) + 0.5) * 0.5;
    float aRemap = clamp((stkRawA - 0.078431375) * 1.0851064, 0.0, 1.0);
    float edge = clamp(stkWear - pow(aRemap, uWearBias.x * uWearBias.x), 0.0, 1.0);
    if (uPaperBacking) {
      // Under the ink is PAPER, and it greys as it scuffs before the ink goes.
      float t = clamp(edge * 2.0, 0.0, 1.0) + uWearBias.y * stkWear;
      diffuseColor.rgb = mix(vec3(mix(0.7, 0.2 + 0.4 * scratch, stkWear)),
                             diffuseColor.rgb,
                             smoothstep(t, t + 0.1, scratch));
    }
    float cutoff = clamp(edge * (1.0 + bias) - bias, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * scratch, stkWear * 0.3);
    diffuseColor.a *= smoothstep(cutoff, cutoff + 0.1, scratch);
    // Scuffed vinyl goes matte. Metallic and preserve-roughness finishes opt out.
    if (!(uMetallic || uPreserveRough)) {
      stkRoughKick = step(scratch, smoothstep(0.0, 0.35, stkWear));
    }
  }
}
`;

const textureCache = new Map<string, Promise<ThreeNS.Texture | null>>();

/**
 * `point` is for the flake sheet and the same rule paintSfx documents applies:
 * it is a normal map of discrete flakes, and filtering averages neighbouring
 * flake normals into mush. Valve samples it through g_sPoint.
 */
function loadTex(
  THREE: Three,
  url: string,
  resolve: (p: string) => string,
  opts: { point?: boolean; wrap?: boolean; wrapU?: boolean } = {},
): Promise<ThreeNS.Texture | null> {
  const key = `${url}|${opts.point ? "p" : "l"}|${opts.wrap ? "w" : opts.wrapU ? "u" : "c"}`;
  let cached = textureCache.get(key);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(resolve(url))
      .then((t) => {
        t.colorSpace = THREE.NoColorSpace; // masks and normals, never colour
        t.flipY = false;
        if (opts.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        else if (opts.wrapU) t.wrapS = THREE.RepeatWrapping;
        if (opts.point) {
          t.minFilter = t.magFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
        }
        return t;
      })
      .catch(() => null);
    textureCache.set(key, cached);
  }
  return cached;
}

/**
 * Draw a weapon decal through its weapon's STICKER MASK.
 *
 * csgo_weapon's g_tStickerWepInputs (R = TextureStickerMask, G = cavity). The
 * game draws every sticker through R — white where a sticker may show, black on
 * hardware, seams and whatever is modelled over the sticker band.
 *
 * IN UV0, the weapon's main texture space — NOT the TEXCOORD_1 stickers are
 * placed in. Measured, not assumed: drawn over the real masks, the UV0 islands
 * of the C4 and the AK-47 match the mask's white shapes exactly (cut-outs and
 * all) and the UV1 layout matches nothing. Sampling it at UV1 chopped stickers
 * into blocks. Sampled at `uvBody`, the body UV0 the decal cutter carries per
 * vertex (-1 where a mesh has none, read as unmasked); a geometry without that
 * attribute must not get this patch.
 *
 * G is left alone: it sits at ~0.5 across the C4, so it is a signed cavity term,
 * not a multiplier, and how the game applies it is not known yet.
 *
 * Layered over applyStickerSfx rather than folded into it: that patch is skipped
 * for a plain sticker, and the mask applies to every sticker. Before
 * alphatest_fragment, which no other patch touches, so it composes with either.
 */
export function applyStickerMask(mat: ThreeNS.MeshStandardMaterial, mask: ThreeNS.Texture): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uWepMask = { value: mask };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 uvBody;\nvarying vec2 vUvBody;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvUvBody = uvBody;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uWepMask;\nvarying vec2 vUvBody;")
      .replace(
        "#include <alphatest_fragment>",
        "if (vUvBody.x >= 0.0) diffuseColor.a *= texture2D( uWepMask, vUvBody ).r;\n#include <alphatest_fragment>",
      );
  };
  // Its own program: a masked decal and an unmasked one must not share one.
  mat.customProgramCacheKey = () => `${prevKey()}|wepMask`;
  mat.needsUpdate = true;
}

/**
 * Patch a sticker decal material with the real alpha, wear and effect shading.
 *
 * Two mechanics carried over from the wear approximation this replaces, both
 * hard-won:
 *   - The patch goes on the MATERIAL, not the bitmap. loadStickerTexture caches
 *     by URL, so two slots wearing the same sticker at different wear would
 *     otherwise fight over one texture.
 *   - customProgramCacheKey MUST exist or three hands back an already-compiled
 *     UNPATCHED program. It now carries the flag bits too: a glitter sticker and
 *     a plain one at the same wear are different programs, and keying on wear
 *     alone would have let the first one compiled win for both.
 */
export async function applyStickerSfx(
  THREE: Three,
  mat: ThreeNS.MeshStandardMaterial,
  sfx: StickerSfx | null,
  wear: number,
  resolveUrl: (path: string) => string,
  opts: StickerSfxOpts = {},
): Promise<void> {
  const expandAlpha = !!opts.expandAlpha;
  if (!needsStickerShader(sfx, wear, expandAlpha)) return;
  const s = sfx ?? PLAIN_SFX;
  const [scratchTex, sfxMaskTex, holoTex, glitterTex, normRoughTex] = await Promise.all([
    s.scratches ? loadTex(THREE, s.scratches, resolveUrl) : null,
    s.sfxMask ? loadTex(THREE, s.sfxMask, resolveUrl) : null,
    // The game's sampler is g_sAnisoClampV (or plain aniso): U WRAPS. The view
    // term pushes U well past 1 — head-on it is about 1.6 — so a clamped U
    // pinned every holo sticker to the spectrum's last column, which on a
    // lenticular is the black that buried its artwork. V clamps in the shader
    // when the material says so; leaving it to wrap here too is the
    // unclamped case.
    s.holoSpectrum ? loadTex(THREE, s.holoSpectrum, resolveUrl, s.clampSpectrumV ? { wrapU: true } : { wrap: true }) : null,
    s.glitterNormal ? loadTex(THREE, s.glitterNormal, resolveUrl, { point: true, wrap: true }) : null,
    s.normalRoughness ? loadTex(THREE, s.normalRoughness, resolveUrl) : null,
  ]);
  // An effect with no mask is not an effect — the mask is what says WHICH texels
  // take it, and without one the shader would apply it to the whole sticker.
  const hasGlitter = s.glitter && !!glitterTex && !!sfxMaskTex;
  const hasHolo = s.holo && !!holoTex && !!sfxMaskTex;
  // The live viewer's handle on the holo view term — see StickerHoloLive.
  // Created here rather than in onBeforeCompile so the viewer can drive it
  // before the program even exists, and shared BY REFERENCE with the shader:
  // writing `.value` each frame is the whole update.
  const live: StickerHoloLive | null = hasHolo
    ? {
        uHoloLive: { value: 0 },
        uHoloEye: { value: new THREE.Vector3(0, 0, 1) },
        uHoloLight: { value: new THREE.Vector3(0, 0, 1) },
        uHoloGlint: { value: new THREE.Vector3(0, 0, 1) },
        uHoloBias: { value: 0 },
        uHoloShine: { value: 0 },
      }
    : null;
  mat.userData.stkHolo = live;
  // Where the decal's map sits inside the game's texture — see STK_UV below.
  const crop = (mat.map?.userData as { stkArtUv?: number[] } | undefined)?.stkArtUv;
  const artUv: [number, number, number, number] =
    crop?.length === 4 ? [crop[0], crop[1], crop[2], crop[3]] : [0, 1, 1, -1];

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uScratchTex: { value: scratchTex },
      uSfxMaskTex: { value: sfxMaskTex },
      uHoloTex: { value: holoTex },
      uGlitterTex: { value: glitterTex },
      uNormRoughTex: { value: normRoughTex },
      uHasScratch: { value: !!scratchTex },
      uHasSfxMask: { value: !!sfxMaskTex },
      uHasHolo: { value: hasHolo },
      uHasGlitter: { value: hasGlitter },
      uHasNormRough: { value: !!normRoughTex },
      uPaperBacking: { value: s.paperBacking },
      uMetallic: { value: s.metallic },
      uPreserveRough: { value: s.preserveRoughness },
      uClampSpectrumV: { value: s.clampSpectrumV },
      uExpandAlpha: { value: expandAlpha },
      uPbrFit: { value: s.pbrFit },
      uLegacyTint: { value: s.legacyTint },
      uSelfIllum: { value: s.selfIllum },
      uWear: { value: wear },
      uWearScratches: { value: s.wearScratches },
      uSfxColorBoost: { value: s.sfxColorBoost },
      uGlitterScale: { value: s.glitterScale },
      uColorBoost: { value: s.colorBoost },
      // INVERTED against the decompile, on the game's own evidence. Read as
      // written, g_flTintSaturateSticker0 is how far a METAL sticker's art is
      // replaced by its tint, and nearly every sticker sets it to 1 — so every
      // foil would be a flat grey and every gold with a white tint white. The
      // game's own icons say the opposite, five for five: ESL One Cologne 2014
      // (Gold) (white tint, 1) is gold, OpTic Gaming (Gold) (gold tint, 0.04)
      // is solid gold not green, Astralis and qikert (Foil) (grey tint, 1) and
      // MOUZ (Holo) (metal, 1) keep their red. All five match 1 - value. The
      // grey foil was reported against the viewer, where hovering a foil
      // sticker (its glow is the raw art) brought the colour back.
      uTintSaturate: { value: 1 - s.tintSaturate },
      uWearBias: { value: new THREE.Vector2(s.wearBias[0], s.wearBias[1]) },
      uColorTint: { value: new THREE.Vector3(...s.colorTint) },
      uStkArtUv: { value: new THREE.Vector4(...artUv) },
      ...(live ?? {
        uHoloLive: { value: 0 },
        uHoloEye: { value: new THREE.Vector3(0, 0, 1) },
        uHoloLight: { value: new THREE.Vector3(0, 0, 1) },
        uHoloGlint: { value: new THREE.Vector3(0, 0, 1) },
        uHoloBias: { value: 0 },
        uHoloShine: { value: 0 },
      }),
    });

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLSL}\nfloat stkRoughKick;\nvec3 stkGlint;\nvec3 stkEmissive;\nfloat stkMetal;\nfloat stkRawA;\nfloat stkExpandedA;\nvec2 stkUv;`,
      )
      // After map_fragment so diffuseColor holds the sticker art (rgb AND the
      // alpha the wear chain erodes), and before the lighting includes that
      // consume roughness.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         ${STK_UV}
         stkRoughKick = 0.0;
         stkGlint = vec3(0.0);
         stkEmissive = vec3(0.0);
         stkMetal = uMetallic ? 1.0 : 0.0;
         stkRawA = diffuseColor.a;
         // sticker.glsl:420 — saturate(a * 12.75). Bytes 0-20 of the art's
         // alpha are the coverage ramp; everything above encodes wear order and
         // must still DISPLAY as opaque. The raw byte stays in stkRawA for the
         // wear remap. Gated: icon-fallback art has ordinary alpha, and
         // expanding that would hard-clip its soft edges.
         if (uExpandAlpha) diffuseColor.a = clamp(stkRawA * 12.75, 0.0, 1.0);
         stkExpandedA = diffuseColor.a;
         ${WEAR_GLSL}`,
      )
      // The sticker's own authored roughness, which the decal material used to
      // stand in for with a flat 0.55. It rides in .z of the same texture that
      // carries the normal — one sample, two channels, Valve's packing.
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         // ALPHA, not blue: the extractor moved the game's roughness channel
         // there when it decoded the normal (see stkDecodeNormal). Blue is the
         // reconstructed normal z, ~1 everywhere, which made every sticker
         // fully rough — foil and gold that should mirror the light came out
         // matte.
         if (uHasNormRough) roughnessFactor = texture2D(uNormRoughTex, stkUv).w;
         roughnessFactor = mix(roughnessFactor, 0.8, stkRoughKick);`,
      )
      // Normals are resolved by here, which the effects need for the view term.
      // The whole finish chain lives in this injection, in the decompile's
      // order: glitter -> tint/PBR refit -> self-illum -> holo -> metalness
      // (sticker.glsl:472/548/625/635/939). metalnessFactor is written here
      // rather than in metalnessmap_fragment because THAT chunk runs BEFORE
      // this one — the earlier revision's foil term was set here and consumed
      // there, i.e. never; lights_physical_fragment, the real consumer, runs
      // after.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         // Valve's 2-channel encode, so it cannot be bound as three's normalMap
         // (which expects ordinary tangent-space RGB) — it has to be decoded
         // here. Scaled by the EXPANDED, pre-wear alpha exactly as the
         // decompile does (sticker.glsl:465), so the relief fades out with the
         // sticker rather than floating past its edge.
         if (uHasNormRough) {
           vec3 sn = stkDecodeNormal(texture2D(uNormRoughTex, stkUv));
           sn.y = -sn.y;
           normal = normalize(normal + sn * stkExpandedA * 2.0);
           // Never let the relief tip the normal away from the surface: a
           // grazing normal is where the specular term blows up into the white
           // flares bloom then spreads.
           float stkFace = dot(normal, nonPerturbedNormal);
           if (stkFace < 0.3) normal = normalize(normal + nonPerturbedNormal * (0.3 - stkFace) * 2.0);
         }
         // The art BEFORE any finish work: the glitter modulation colour reads
         // it (sticker.glsl:516 refits the raw sample, not the tinted one).
         vec3 stkArt = diffuseColor.rgb;
         // The viewer is ORTHOGRAPHIC, so this branch is the live path — the
         // same guard three.js puts on its own materials. Under a parallel
         // projection the eye ray is the view axis, and normalize(vViewPosition)
         // would make the holo band sweep with SCREEN POSITION rather than with
         // the surface's angle. Correctly guarded, V is constant across the
         // surface, so the band no longer sweeps as the weapon turns — that is
         // the projection, not a regression.
         vec3 stkV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
         if (uHasGlitter) {
           // 1 - mask.a is the glitter gate: the alpha channel MASKS OUT, the
           // opposite sense to the holo gate in .x. Straight from the decompile.
           float gate = 1.0 - texture2D(uSfxMaskTex, stkUv).w;
           if (gate > 0.0) {
             // Two octaves at 2.5*scale, the second offset by half a tile, so
             // the flake field does not visibly tile across a 512px sticker.
             vec2 g0 = stkUv * (2.5 * uGlitterScale);
             vec2 g1 = (vec2(0.5) + stkUv) * (2.5 * uGlitterScale);
             vec4 t0 = texture2D(uGlitterTex, g0);
             vec3 f0 = stkDecodeNormal(t0);
             vec4 t1 = texture2D(uGlitterTex, g1);
             vec3 f1 = stkDecodeNormal(t1);
             vec2 fw = max(abs(dFdx(g0)), abs(dFdy(g0)));
             float amp = 0.04 * gate * clamp(1.0 - min(fw.x, fw.y) * 40.0, 0.0, 1.0);
             vec3 pn = normalize(normal + (f0 * f0.z) * amp);
             // Each octave scaled by its own flake alpha (sticker.glsl:528).
             vec3 sp = max(stkSparkle(reflect(stkV, pn)) * t0.w,
                           stkSparkle(reflect(stkV, normalize(normal + f1 * amp))) * t1.w);
             // The sparkle is TINTED by the sticker's own albedo, refit when
             // the PBR fit is on — white glitter on white ink, red on red.
             vec3 stkMod = uPbrFit
               ? stkLevelsFit(stkArt, STK_LEVELS, STK_LEVELS.x, stkMaxc(stkArt),
                              dot(clamp(stkArt, 0.0, 1.0), STK_LUMA), 0.0, 0.0)
               : stkArt;
             stkGlint = sp * gate * uSfxColorBoost * stkMod;
             stkMetal = max(stkMetal, gate * 0.5);
             normal = pn;
           }
         }
         // Base-albedo tint + PBR colour refit, sticker.glsl:548-623. The
         // refit path (pbrFit, the shader's DEFAULT) folds the metallic tint
         // in by the metal accumulator; the legacy metallic path is a plain
         // saturate-tint-boost. Plain paper stickers with pbrFit off keep
         // their art untouched (:620).
         if (uPbrFit) {
           vec3 tintM = mix(vec3(1.0), uColorTint, stkMetal);
           float tsat = mix(0.0, uTintSaturate, stkMetal);
           if (uLegacyTint) {
             vec3 c = clamp(mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, STK_LUMA)), tsat) * tintM, 0.0, 1.0);
             diffuseColor.rgb = stkRefitFull(c, c, stkMetal);
           } else {
             vec3 shape = mix(tintM * diffuseColor.rgb, tintM, tsat);
             diffuseColor.rgb = stkRefitFull(shape, diffuseColor.rgb, stkMetal);
           }
         } else if (uMetallic) {
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, STK_LUMA)), uTintSaturate) * uColorTint;
           if (uLegacyTint) diffuseColor.rgb *= uColorBoost;
         }
         // Self-illum rides .w of the normal/rough texture and reads the
         // POST-refit, PRE-holo albedo (sticker.glsl:625-628). Caveat: on a
         // texture the extractor decoded as hemi-oct (see stkDecodeNormal)
         // .w now holds the roughness, and the game's own .w did not survive
         // the export. Not scaled by
         // alpha here: the game's mix(0, emissive, alpha) at :941 is exactly
         // what the alpha blend applies to outgoingLight already.
         if (uSelfIllum && uHasNormRough) {
           stkEmissive = diffuseColor.rgb * texture2D(uNormRoughTex, stkUv).w * 2.0;
         }
         if (uHasHolo) {
           vec4 sfxM = texture2D(uSfxMaskTex, stkUv);
           if (sfxM.x > 0.0) {
             // The spectrum is a rainbow RAMP and the mask's G/B are where this
             // texel sits in it. The view term SHIFTS along U, which is the
             // whole effect: turn the sticker and the band sweeps.
             //
             // The game's term, sticker.glsl:647: dot(V,N) + dot(V,L), where
             // N is the GEOMETRIC normal (the interpolated vertex normal,
             // _24347 — not the normal-mapped one) and V points from the
             // surface to the camera. So the frame a lenticular shows, and
             // where a holo's rainbow sits, depend on the camera angle alone,
             // and a flat sticker shows one coherent frame. Reading the
             // normal-mapped normal here made frames flicker texel by texel.
             //
             // LIVE (the 3D viewer, uHoloLive = 1): V from a virtual eye at an
             // inspect-like distance, and L a light fixed to the camera, as the
             // game's inspect light is fixed while the weapon turns. Nothing
             // moves unless the camera does. uHoloBias keeps the head-on frame
             // where the game's inspect view shows it.
             //
             // STILL (baked cards): the parallel view and the calibrated
             // constant STK_HOLO_LIGHT, so a card never depends on a light.
             vec3 holoV = uHoloLive > 0.5 ? normalize(uHoloEye + vViewPosition) : stkV;
             float shift = uHoloLive > 0.5
               ? dot(holoV, nonPerturbedNormal) + dot(holoV, uHoloLight) + uHoloBias
               : dot(stkV, nonPerturbedNormal) + STK_HOLO_LIGHT;
             vec2 suv = vec2(sfxM.y + shift, sfxM.z);
             if (uClampSpectrumV) suv.y = clamp(suv.y, 0.0, 1.0);
             vec3 spectrum = texture2D(uHoloTex, suv).xyz;
             // The holo refit (sticker.glsl:660-664): the spectrum goes through
             // the same albedo-levels fit under its own level vector, with the
             // sfx boost feeding both the luma term and the headroom extension.
             float sluma = dot(clamp(spectrum * uSfxColorBoost, 0.0, 1.0), STK_LUMA);
             vec3 refit = stkLevelsFit(spectrum, STK_HOLO_LEVELS, STK_HOLO_LEVELS.x,
                                       stkMaxc(spectrum) * uSfxColorBoost, sluma,
                                       sluma * uSfxColorBoost,
                                       max(0.0, uSfxColorBoost - 1.0) / STK_BOOST_FACTOR);
             diffuseColor.rgb = mix(diffuseColor.rgb, refit, sfxM.x);
             // Foil texels carry the refit colour, not a metal response —
             // the accumulator is knocked OUT where the holo mask is set
             // (sticker.glsl:669).
             stkMetal *= (1.0 - sfxM.x);
             if (uHoloLive > 0.5) {
               // A little SHINE the game gets from its bloom and close inspect
               // light: a small glint in the foil's own colour off a light that
               // wanders near the view axis, and a slightly glossier surface.
               // Kept faint — stronger, with a sliding sheen band on top, it
               // washed the artwork out under the rainbow, which the game does
               // not do. Live viewer only.
               vec3 hh = normalize(uHoloGlint + holoV);
               float nh = max(dot(normal, hh), 0.0);
               stkEmissive += refit * pow(nh, 64.0) * 0.6 * uHoloShine * sfxM.x;
               roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.35), 0.5 * sfxM.x * uHoloShine);
             }
           }
         }
         metalnessFactor = max(metalnessFactor, stkMetal);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += stkEmissive;`,
      )
      // Lit, not emissive: the sparkle is scaled by accumulated diffuse so a
      // glitter sticker goes dark in shadow the way real flake does. Same
      // treatment paintSfx gives the weapon glitter.
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 lit = reflectedLight.indirectDiffuse + reflectedLight.directDiffuse;
           outgoingLight += lit * stkGlint;
         }
         #include <opaque_fragment>`,
      );
  };
  // Wear is a UNIFORM, so it does not belong in the key — but every flag below
  // changes the program's behaviour, and two materials that differ on one of
  // them must not share a compiled program's uniforms. See the docblock.
  mat.customProgramCacheKey = () =>
    `stickerSfx:${+hasGlitter}${+hasHolo}${+s.metallic}${+s.paperBacking}${+s.preserveRoughness}` +
    `${+s.clampSpectrumV}${+!!scratchTex}${+!!sfxMaskTex}${+!!normRoughTex}` +
    `${+expandAlpha}${+s.pbrFit}${+s.legacyTint}${+s.selfIllum}`;
  mat.needsUpdate = true;
}
