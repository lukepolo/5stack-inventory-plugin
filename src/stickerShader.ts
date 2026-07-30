/**
 * csgo_weapon_sticker.vfx — wear, glitter, holographic and gold.
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
 *   The wear chain. Every term comes from the decompile and needs no constant we
 *   do not have: the authored scratch mask, the alpha-driven erosion, the
 *   roughness kick and the paper-backing recolour. This replaces a 2-octave
 *   value-noise approximation that was flagged as one in its own docblock.
 *
 * WHAT IS APPROXIMATE, AND FLAGGED RATHER THAN HIDDEN
 *   Valve runs both effect colours through an "albedo levels" PBR refit
 *   (g_vAlbedoLevels / g_vHoloAlbedoLevels / g_vMetallicAlbedoLevels). Those are
 *   ENGINE-WIDE constants living in the renderer's global cbuffer, not in any
 *   material, so they are not in the archive anywhere we can read them. The
 *   structure of both effects is exact — the spectrum lookup and its view-angle
 *   shift, the two-octave flake normals, the sin/threshold sparkle — and the
 *   refit is omitted. Expect the effects to read slightly brighter or flatter
 *   than the game, never differently shaped. Do not "fix" that by eye; find the
 *   constants first.
 *
 *   The FOIL RESPONSE (`stkFoil`, which lowers roughness and raises metalness
 *   where the sfx mask is set) is likewise not in the decompile — Valve gets it
 *   for free from that same refit. It is here because without it an effect
 *   finish is only ever a colour swap: holographic stickers read as flat print,
 *   which is not what they are. It is a PBR-plausible stand-in for a missing
 *   term, not a transcription, and it is the first thing to delete if the real
 *   constants turn up.
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

/** Does this sticker need the patch at all? A plain sticker at wear 0 with no
 *  authored surface does not, and skipping it keeps those sharing one program. */
export function needsStickerShader(sfx: StickerSfx | null, wear: number): boolean {
  if (!sfx) return false;
  return wear > 0 || sfx.glitter || sfx.holo || sfx.metallic || sfx.paperBacking || !!sfx.normalRoughness;
}

const GLSL = /* glsl */ `
uniform sampler2D uScratchTex, uSfxMaskTex, uHoloTex, uGlitterTex, uNormRoughTex;
uniform bool uHasScratch, uHasSfxMask, uHasHolo, uHasGlitter, uHasNormRough;
uniform bool uPaperBacking, uMetallic, uPreserveRough, uClampSpectrumV;
uniform float uWear, uWearScratches, uSfxColorBoost, uGlitterScale;
uniform vec2 uWearBias;
uniform vec3 uColorTint;

const vec3 STK_LUMA = vec3(0.2125, 0.7154, 0.0721);

/**
 * Valve's 2-channel normal decode, shared by the sticker normal and the glitter
 * flake sheet. 1.00392163 is 256/255 — the encode is not quite symmetric.
 */
vec3 stkDecodeNormal(vec4 t) {
  float nx = (t.x + t.y) - 1.00392163;
  float ny = t.x - t.y;
  return normalize(vec3(nx, ny, (1.0 - abs(nx)) - abs(ny)));
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
 * sticker loses its outline first and its middle last.
 */
const WEAR_GLSL = /* glsl */ `
{
  float stkWear = uWear;
  if (stkWear > 0.0) {
    float rawA = diffuseColor.a;
    float sTex = uHasScratch ? texture2D(uScratchTex, vMapUv).x : 1.0;
    float s = 1.0 - min(uWearScratches, sTex);
    float scratch = mix(s, s * 0.5, stkWear);
    // Paper backing widens the cutoff to a flat 0.5; everything else derives it
    // from the material's own bias, with an asymmetry on the sign of Y.
    float bias = uPaperBacking
      ? 0.5
      : ((uWearBias.y * (uWearBias.y > 0.0 ? 0.5 : 0.25)) + 0.5) * 0.5;
    float aRemap = clamp((rawA - 0.078431375) * 1.0851064, 0.0, 1.0);
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
  opts: { point?: boolean; wrap?: boolean } = {},
): Promise<ThreeNS.Texture | null> {
  const key = `${url}|${opts.point ? "p" : "l"}|${opts.wrap ? "w" : "c"}`;
  let cached = textureCache.get(key);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(resolve(url))
      .then((t) => {
        t.colorSpace = THREE.NoColorSpace; // masks and normals, never colour
        t.flipY = false;
        if (opts.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
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
 * Patch a sticker decal material with the real wear and effect shading.
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
): Promise<void> {
  if (!needsStickerShader(sfx, wear)) return;
  const s = sfx!;
  const [scratchTex, sfxMaskTex, holoTex, glitterTex, normRoughTex] = await Promise.all([
    s.scratches ? loadTex(THREE, s.scratches, resolveUrl) : null,
    s.sfxMask ? loadTex(THREE, s.sfxMask, resolveUrl) : null,
    s.holoSpectrum ? loadTex(THREE, s.holoSpectrum, resolveUrl) : null,
    s.glitterNormal ? loadTex(THREE, s.glitterNormal, resolveUrl, { point: true, wrap: true }) : null,
    s.normalRoughness ? loadTex(THREE, s.normalRoughness, resolveUrl) : null,
  ]);
  // An effect with no mask is not an effect — the mask is what says WHICH texels
  // take it, and without one the shader would apply it to the whole sticker.
  const hasGlitter = s.glitter && !!glitterTex && !!sfxMaskTex;
  const hasHolo = s.holo && !!holoTex && !!sfxMaskTex;

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
      uWear: { value: wear },
      uWearScratches: { value: s.wearScratches },
      uSfxColorBoost: { value: s.sfxColorBoost },
      uGlitterScale: { value: s.glitterScale },
      uWearBias: { value: new THREE.Vector2(s.wearBias[0], s.wearBias[1]) },
      uColorTint: { value: new THREE.Vector3(...s.colorTint) },
    });

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLSL}\nfloat stkRoughKick;\nvec3 stkGlint;\nfloat stkFoil;`)
      // After map_fragment so diffuseColor holds the sticker art (rgb AND the
      // alpha the wear chain erodes), and before the lighting includes that
      // consume roughness.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         stkRoughKick = 0.0;
         stkGlint = vec3(0.0);
         stkFoil = 0.0;
         ${WEAR_GLSL}`,
      )
      // The sticker's own authored roughness, which the decal material used to
      // stand in for with a flat 0.55. It rides in .z of the same texture that
      // carries the normal — one sample, two channels, Valve's packing.
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         if (uHasNormRough) roughnessFactor = texture2D(uNormRoughTex, vMapUv).z;
         roughnessFactor = mix(roughnessFactor, 0.8, stkRoughKick);`,
      )
      // Normals are resolved by here, which both effects need for the view term.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         // Valve's 2-channel encode, so it cannot be bound as three's normalMap
         // (which expects ordinary tangent-space RGB) — it has to be decoded
         // here. Scaled by the art's alpha exactly as the decompile does, so the
         // relief fades out with the sticker rather than floating past its edge.
         if (uHasNormRough) {
           vec3 sn = stkDecodeNormal(texture2D(uNormRoughTex, vMapUv));
           sn.y = -sn.y;
           normal = normalize(normal + sn * diffuseColor.a * 2.0);
         }
         if (uHasSfxMask) {
           vec4 sfxM = texture2D(uSfxMaskTex, vMapUv);
           vec3 V = normalize(vViewPosition);
           if (uHasHolo && sfxM.x > 0.0) {
             // The spectrum is a rainbow RAMP and the mask's G/B are where this
             // texel sits in it. The view term SHIFTS along U, which is the
             // whole effect: turn the sticker and the band sweeps.
             //
             // Valve adds dot(V,N) + dot(V,lightDir); with no scene light vector
             // to hand here the view term alone carries the sweep. Flagged.
             float shift = dot(V, normal);
             vec2 suv = vec2(sfxM.y + shift, sfxM.z);
             if (uClampSpectrumV) suv.y = clamp(suv.y, 0.0, 1.0);
             vec3 spectrum = texture2D(uHoloTex, suv).xyz * uSfxColorBoost;
             diffuseColor.rgb = mix(diffuseColor.rgb, spectrum, sfxM.x);
             stkFoil = max(stkFoil, sfxM.x);
           }
           if (uHasGlitter) {
             // 1 - mask.a is the glitter gate: the alpha channel MASKS OUT, the
             // opposite sense to the holo gate in .x. Straight from the decompile.
             float gate = 1.0 - sfxM.w;
             if (gate > 0.0) {
               // Two octaves at 2.5*scale, the second offset by half a tile, so
               // the flake field does not visibly tile across a 512px sticker.
               vec2 g0 = vMapUv * (2.5 * uGlitterScale);
               vec2 g1 = (vec2(0.5) + vMapUv) * (2.5 * uGlitterScale);
               vec4 t0 = texture2D(uGlitterTex, g0);
               vec3 f0 = stkDecodeNormal(t0);
               vec3 f1 = stkDecodeNormal(texture2D(uGlitterTex, g1));
               vec2 fw = max(abs(dFdx(g0)), abs(dFdy(g0)));
               float amp = 0.04 * gate * clamp(1.0 - min(fw.x, fw.y) * 40.0, 0.0, 1.0);
               vec3 pn = normalize(normal + (f0 * f0.z) * amp);
               vec3 sp = max(stkSparkle(reflect(V, pn)) * t0.w,
                             stkSparkle(reflect(V, normalize(normal + f1 * amp))));
               stkGlint = sp * gate * uSfxColorBoost;
               stkFoil = max(stkFoil, gate * 0.6);
               normal = pn;
             }
           }
         }`,
      )
      // Gold is a TINT plus metal, not a colour replacement — the art keeps its
      // own shape and picks up the metallic response.
      // An effect finish is FOIL, and foil is a specular surface — swapping the
      // albedo for a spectrum colour makes it colourful, not reflective, which
      // is why holo stickers read as flat print. The mask says which texels are
      // foil; those get a metal response and a smooth one, so they catch the
      // environment and swing as the camera moves. Gated on the mask so the
      // paper parts of the same sticker stay paper.
      //
      // Reached for after the albedo work above, which is where stkFoil is set.
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
         if (uMetallic) {
           metalnessFactor = max(metalnessFactor, 0.85);
           diffuseColor.rgb *= uColorTint;
         }
         if (stkFoil > 0.0) {
           metalnessFactor = max(metalnessFactor, stkFoil * 0.9);
           roughnessFactor = min(roughnessFactor, mix(roughnessFactor, 0.12, stkFoil));
         }`,
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
  // changes the generated source, and two materials that differ only by one of
  // them must not share a program. See the docblock.
  mat.customProgramCacheKey = () =>
    `stickerSfx:${+hasGlitter}${+hasHolo}${+s.metallic}${+s.paperBacking}${+s.preserveRoughness}` +
    `${+s.clampSpectrumV}${+!!scratchTex}${+!!sfxMaskTex}${+!!normRoughTex}`;
  mat.needsUpdate = true;
}
