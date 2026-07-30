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
import { paintTextureUrl } from "./paintComposite";

type Three = typeof ThreeNS;

/** Per-material shading correction — see tuneCharmShading and the backend's
 *  charm-shading.json. Absent for every material that needs none. */
export interface CharmShading {
  metalness?: number;
  roughness?: number;
  roughnessOffset?: number;
  /** Seed-driven shader params as decoded expression trees — see evalVfx. */
  dynamic?: Record<string, VfxNode>;
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
    case "float2": return [s(0), s(1)];
    case "float3": return [s(0), s(1), s(2)];
    case "float4": return [s(0), s(1), s(2), s(3)];
    // Anything else is a function no charm on this build uses. Returning the
    // first argument keeps a future material rendering rather than blank.
    default: return a[0] ?? [0];
  }
}

/**
 * csgo_weapon.vfx's colour adjustment, transcribed from the decompiled shader
 * (static combo 225 of csgo_weapon_vulkan_50_ps.vcs) rather than reinvented.
 *
 * Order matters and is not the obvious one: CONTRAST and BRIGHTNESS first, then
 * the hue rotation, then saturation. The hue rotation is Rodrigues about the
 * RGB grey axis — not an HSV round trip — and it is faded out on near-grey
 * pixels by `pow(hsvSaturation, 0.125)`, which is what stops the metal parts of
 * a charm smearing colour as the pattern sweeps.
 *
 * Applied in sRGB: the game grades the texture as authored, so the linear
 * sample three hands us has to be encoded, adjusted and decoded again.
 * Verified against Valve's own ramp — Semi-Precious at pattern 25000 lands on
 * hue 172 (teal), matching the published pattern guide band for band.
 */
const CHARM_ADJUST_GLSL = `
uniform vec2 uRoughAdjust;
uniform vec4 uColorAdjust;
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
  c = clamp( mix( vec3( 0.5 ), c, uColorAdjust.z ) * uColorAdjust.w, 0.0, 1.0 );
  float mx = max( c.r, max( c.g, c.b ) );
  float hsvSat = mx == 0.0 ? 0.0 : ( mx - min( c.r, min( c.g, c.b ) ) ) / mx;
  const vec3 K = vec3( 0.57735027 );
  float ca = cos( uColorAdjust.x ), sa = sin( uColorAdjust.x );
  vec3 rot = c * ca + cross( K, c ) * sa + K * dot( K, c ) * ( 1.0 - ca );
  vec3 hued = mix( vec3( dot( c, W ) ), rot, pow( hsvSat, 0.125 ) );
  vec3 outC = clamp( mix( vec3( dot( hued, W ) ), hued, uColorAdjust.y ), 0.0, 1.0 );
  return csToLinear( outC );
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
 */
export function tuneCharmShading(
  THREE: Three,
  model: ThreeNS.Object3D,
  shading: Record<string, CharmShading>,
  seed: number,
) {
  if (!shading || !Object.keys(shading).length) return;
  // CS2 hands the shader the pattern normalised over its 1..100000 range.
  const t = Math.min(1, Math.max(0, seed / 100000));
  model.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mat = mesh.material as ThreeNS.MeshStandardMaterial;
    let tune = mat && shading[mat.name];
    if (!tune) return;
    // Seed-driven params OVERRIDE the material's baked constants — the baked
    // value is just whatever pattern the artist authored against.
    const dyn = tune.dynamic ?? {};
    const one = (name: string, dflt: number) =>
      dyn[name] ? evalVfx(dyn[name], t)[0] : dflt;
    const hueDeg = one("g_fHueShift", 0);
    const saturation = one("g_fSaturation", 1);
    const brightness = one("g_fBrightness", 1);
    const contrast = one("g_fContrast", 1);
    if (dyn.g_vMetalnessRemapRange) {
      const range = evalVfx(dyn.g_vMetalnessRemapRange, t);
      if (range.length >= 2) tune = { ...tune, metalness: range[1] };
    }
    // Roughness: the game's own adjust is affine, and a seed-driven contrast
    // folds into it the same way the baked one does.
    let scale = tune.roughness ?? 1;
    let offset = tune.roughnessOffset ?? 0;
    if (dyn.g_fTextureRoughnessContrast || dyn.g_fTextureRoughnessBrightness) {
      const rc = one("g_fTextureRoughnessContrast", 1);
      const rb = one("g_fTextureRoughnessBrightness", 1);
      scale = rc * rb;
      offset = rb * 0.5 * (1 - rc);
    }
    const grades = hueDeg !== 0 || saturation !== 1 || brightness !== 1 || contrast !== 1;
    if (scale === 1 && offset === 0 && !grades && tune.metalness === undefined) return;
    // CLONED, not mutated in place — and only now that something is actually
    // being applied, so an untouched charm keeps sharing the cached material
    // and its compiled program. The gltf comes out of a shared LRU and the
    // tuning is seed-dependent, so two viewers showing the same charm at
    // different patterns would otherwise overwrite each other's colour. (It
    // was safe to mutate in place while every correction was a constant.)
    const owned = mat.clone();
    owned.name = mat.name;
    mesh.material = owned;
    if (tune.metalness !== undefined) owned.metalness = tune.metalness;
    // `roughness` is a plain multiplier on the map, so the scale rides there;
    // the offset has no equivalent knob and needs the one line of shader. Both
    // go through the uniform so every tuned charm still shares one program.
    owned.roughness = 1;
    owned.userData.roughAdjust = new THREE.Vector2(scale, offset);
    owned.userData.colorAdjust = new THREE.Vector4(
      (hueDeg * Math.PI) / 180, // the shader's cos/sin take RADIANS
      saturation,
      contrast,
      brightness,
    );
    owned.onBeforeCompile = (shader) => {
      shader.uniforms.uRoughAdjust = { value: owned.userData.roughAdjust };
      shader.uniforms.uColorAdjust = { value: owned.userData.colorAdjust };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `${CHARM_ADJUST_GLSL}\nvoid main() {`)
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n\troughnessFactor = clamp( roughnessFactor * uRoughAdjust.x + uRoughAdjust.y, 0.0, 1.0 );",
        )
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n\tdiffuseColor.rgb = csCharmAdjust( diffuseColor.rgb );",
        );
    };
    owned.needsUpdate = true;
  });
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
export async function dressCharm(
  THREE: Three,
  loadTexture: (url: string) => Promise<ThreeNS.Texture>,
  model: ThreeNS.Object3D,
  material: string,
): Promise<boolean> {
  // paintTextureUrl is really "paint asset URL" — it prefixes /paints and
  // stamps the extraction version, which materials need exactly as textures do.
  const doc = await fetch(paintTextureUrl(material))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const params = (doc as { m_textureParams?: { m_name?: string; m_pValue?: string }[] } | null)?.m_textureParams;
  if (!params) return false;
  const pick = (...names: string[]) => {
    for (const n of names) {
      const hit = params.find((t) => t.m_name === n)?.m_pValue;
      if (typeof hit === "string" && hit.startsWith("/textures/")) return hit;
    }
    return null;
  };
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
    mat.name = material.split("/").pop()!.replace(/\.vmat\.json$/i, "").replace(/_[0-9a-f]{8}$/i, "");
    (mesh.material as ThreeNS.Material)?.dispose?.();
    mesh.material = mat;
  });
  return true;
}
