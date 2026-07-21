// Glitter, pearlescence — the two skin effects CS2 does NOT bake.
//
// The compositor writes textures; these are view-dependent and live in the
// weapon's RENDER material. That split is Valve's, not a shortcut: decompiling
// csgo_weapon_vulkan_50_ps (combo 192 = S_GLITTER + S_ENABLE_SFX_MASK) shows
// g_fGlitterIntensity, g_fGlitterScale and g_flPearlescentScale are not even in
// the compositor's constant buffer. What the compositor owes them is a single
// gate — the SFX MASK — which it writes into the composited rough/metal map and
// this shader reads back.
//
//   Valve:  sfx = g_tMetalness.z   (their rough/metal packing)
//   Ours:   sfx = rm.r             (three reads .g rough / .b metal, .r is free)
//
// Everything below is transcribed from that decompile, symbols resolved. The
// one thing NOT taken from it is the tangent frame: Valve builds the sparkle in
// world space from the mesh tangent + bitangent, and our GLBs are not guaranteed
// to carry tangents, so the flake perturbation is applied to three's view-space
// shading normal instead. The flake sheet is isotropic noise, so the character
// of the effect survives; what shifts is exactly which flakes catch the light as
// the camera moves. Flagged rather than hidden.
import type { PaintDef } from "./paintComposite";
import { paintTextureUrl } from "./paintComposite";

type THREE = typeof import("three");

/** True when this paint has anything for us to shade. Cheap enough to call per
 *  material; both effects are hard-gated on their scale being non-zero, exactly
 *  as the decompile does (`if (g_flPearlescentScale != 0.0)` / `if (_3433 != 0.0)`). */
export function hasPaintSfx(def: PaintDef): boolean {
  return def.pearlescent !== 0 || def.glitterIntensity > 0;
}

const glitterTexCache = new Map<string, Promise<import("three").Texture | null>>();

/** The shared flake sheet. MUST be point-sampled with no mips: it is a normal
 *  map of discrete flakes, and any filtering averages neighbouring flake normals
 *  into mush — Valve samples it through g_sPoint for exactly this reason. */
function loadGlitterNormal(THREE: THREE, url: string): Promise<import("three").Texture | null> {
  let cached = glitterTexCache.get(url);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(paintTextureUrl(url))
      .then((t) => {
        t.colorSpace = THREE.NoColorSpace; // packed normal + mask, never colour
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.flipY = false;
        return t;
      })
      .catch(() => null);
    glitterTexCache.set(url, cached);
  }
  return cached;
}

const COMMON = /* glsl */ `
uniform sampler2D uGlitterTex;
uniform sampler2D uSfxMap;
uniform float uGlitterIntensity, uGlitterScale, uGlitterBalance, uGlitterSpread;
uniform float uPearlScale, uUvScale1;
uniform bool uHasGlitter;

const vec3 SFX_LUMA = vec3(0.2125, 0.7154, 0.0721);
// 1/sqrt(3) — the grey axis. Pearlescence is a hue rotation about it.
const vec3 SFX_GREY = vec3(0.57735);

// Shared by both effects. Written by the compositor into rm.r; see the header.
float sfxMask(vec2 uv) { return texture2D(uSfxMap, uv).r; }

/** Rodrigues rotation of a colour about the grey axis — CONFIRMED, and note it
 *  mixes from LUMA, so a fully desaturated pixel pearlesces to grey, never to a
 *  hue. pow(sat, 0.125) makes even faintly saturated pixels take it almost
 *  fully. */
vec3 sfxPearlescent(vec3 albedo, float nDotV, float sfx) {
  float ang = uPearlScale * (1.0 - nDotV) * sfx;
  float c = cos(ang), s = sin(ang);
  float mx = max(albedo.r, max(albedo.g, albedo.b));
  float mn = min(albedo.r, min(albedo.g, albedo.b));
  float sat = mx == 0.0 ? 0.0 : (mx - mn) / mx;
  vec3 rot = albedo * c + cross(SFX_GREY, albedo) * s + SFX_GREY * dot(SFX_GREY, albedo) * (1.0 - c);
  return mix(vec3(dot(albedo, SFX_LUMA)), rot, pow(sat, 0.125));
}

/** Valve's 2-channel flake normal decode, identical in form to the weapon
 *  normal decode a few lines above it in the same shader. */
vec3 sfxFlake(vec2 guv, out float flakeMask) {
  vec4 g = texture2D(uGlitterTex, guv);
  float nx = (g.x + g.y) - 1.00392163;
  float ny = g.x - g.y;
  vec3 n = normalize(vec3(nx, ny, (1.0 - abs(nx)) - abs(ny)));
  flakeMask = g.w;
  return n * n.z;
}

/** The sparkle colour. Rainbow balance crossfades a white lobe (+1) against a
 *  rainbow lobe (-1..0); spread both lowers the sine frequency 12 -> 5.6, making
 *  wider colour bands, and drops the highlight threshold 0.99 -> 0.80, making
 *  more pixels catch. */
vec3 sfxSparkle(vec3 R) {
  vec3 s = sin(R * mix(12.0, 5.6, uGlitterSpread));
  vec3 ns = -s;
  float thr = mix(0.99, 0.80, uGlitterSpread);
  float inv = 1.0 / (1.0 - thr);
  vec3 hi = max(vec3(0.0), s - vec3(thr)) * inv;
  float bal = uGlitterBalance;
  vec3 white = vec3(pow(dot(clamp(ns, 0.0, 1.0), SFX_LUMA), 4.0))
             + vec3(dot(clamp(vec3(0.15) - s, 0.0, 1.0), SFX_LUMA) * max(0.0, bal));
  vec3 rainbow = (hi + pow(hi.yzx + max(vec3(0.0), ns - vec3(thr)) * inv * max(0.0, -bal),
                           vec3(4.0 - 3.5 * max(0.0, uGlitterSpread)))) * 4.0 * max(0.0, 1.0 - bal);
  return white + rainbow;
}
`;

/**
 * Patch a painted weapon material with glitter + pearlescence.
 * `sfxMap` is the composited rough/metal texture — the same one already bound as
 * roughnessMap/metalnessMap; we read its .r for the mask.
 */
export async function applyPaintSfx(
  three: THREE,
  mat: import("three").MeshStandardMaterial,
  def: PaintDef,
  sfxMap: import("three").Texture,
  uvScale1: number,
): Promise<void> {
  const THREE = three;
  if (!hasPaintSfx(def)) return;
  const glitterTex =
    def.glitterIntensity > 0 && def.glitterNormal ? await loadGlitterNormal(THREE, def.glitterNormal) : null;
  const hasGlitter = !!glitterTex && def.glitterIntensity > 0;
  if (!hasGlitter && def.pearlescent === 0) return;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlitterTex = { value: glitterTex };
    shader.uniforms.uSfxMap = { value: sfxMap };
    shader.uniforms.uGlitterIntensity = { value: def.glitterIntensity };
    shader.uniforms.uGlitterScale = { value: def.glitterScale };
    shader.uniforms.uGlitterBalance = { value: def.glitterRainbowBalance };
    shader.uniforms.uGlitterSpread = { value: def.glitterRainbowSpread };
    shader.uniforms.uPearlScale = { value: def.pearlescent };
    shader.uniforms.uUvScale1 = { value: uvScale1 };
    shader.uniforms.uHasGlitter = { value: hasGlitter };

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\nvec3 vSfxSparkle;\nfloat vSfxK;`)
      // Albedo: pearlescent hue rotation, then glitter's brighten-where-dark.
      // Both need the mask and the view angle, so this is the first point where
      // everything is available.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         vSfxSparkle = vec3(0.0);
         vSfxK = 0.0;
         {
           float sfx = sfxMask(vMapUv);
           vec3 V = normalize(vViewPosition);
           float nDotV = clamp(dot(V, normal), 0.0, 1.0);
           if (uHasGlitter) {
             float gate = sfx * min(1.0, uGlitterIntensity);
             if (gate > 0.0) {
               // 1.75 is the constant on the normal path; Valve swaps it for 2.5
               // behind a global int we did not trace. Treated as a tunable.
               vec2 guv = vMapUv * (1.75 * uGlitterScale * uUvScale1);
               vec2 fw = max(abs(dFdx(guv)), abs(dFdy(guv)));
               float flakeMask;
               vec3 flake = sfxFlake(guv, flakeMask);
               // Valve perturbs in tangent space; we perturb the view-space
               // shading normal — see the header note.
               vec3 pn = normalize(normal + flake * (0.04 * gate * clamp(1.0 - min(fw.x, fw.y) * 40.0, 0.0, 1.0)));
               vSfxK = gate * flakeMask * abs(1.0 - flake.z);
               // reflect(V, N) with V pointing surface->camera, exactly as the
               // decompile does. Passing -V here inverts which flakes catch the
               // light and flattens the sparkle into noise.
               vSfxSparkle = sfxSparkle(reflect(V, pn)) * flakeMask * nDotV * uGlitterIntensity * sfx;
               normal = pn;
             }
           }
         }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         roughnessFactor *= 1.0 - vSfxK * 0.25;`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
         metalnessFactor = max(metalnessFactor, vSfxK * 0.5);`,
      )
      // Runs after normals, so nDotV is available for the Fresnel term.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         {
           float sfx = sfxMask(vMapUv);
           if (uPearlScale != 0.0) {
             float nDotV = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
             diffuseColor.rgb = sfxPearlescent(diffuseColor.rgb, nDotV, sfx);
           }
           if (vSfxK > 0.0) {
             // Brighten only where the paint is dark, so flakes read on black.
             diffuseColor.rgb *= mix(1.0 + vSfxK * 2.5, 1.0,
                                     smoothstep(0.0, 0.8, dot(diffuseColor.rgb, SFX_LUMA)));
           }
         }`,
      )
      // Valve adds the sparkle scaled by accumulated DIFFUSE irradiance, so it
      // is lit rather than emissive — it goes dark in shadow like real flake.
      .replace(
        "#include <opaque_fragment>",
        `{
           vec3 sfxLit = reflectedLight.indirectDiffuse + reflectedLight.directDiffuse;
           vec3 spark = vSfxSparkle * 0.05 + vSfxSparkle * (normalize(max(vec3(3e-4), diffuseColor.rgb)) * 1.06) * 0.95;
           outgoingLight += sfxLit * spark;
         }
         #include <opaque_fragment>`,
      );
  };
  // Without this three can hand back an already-compiled UNPATCHED program.
  mat.customProgramCacheKey = () =>
    `paintSfx:${def.glitterIntensity}:${def.glitterScale}:${def.glitterRainbowBalance}:${def.glitterRainbowSpread}:${def.pearlescent}:${hasGlitter ? 1 : 0}`;
  mat.needsUpdate = true;
}
