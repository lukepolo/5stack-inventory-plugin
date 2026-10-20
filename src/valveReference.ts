// Valve's own skin compositor, run in WebGL2 — both as the production
// compositor and as the test oracle the hand port is checked against.
//
// Every static combo of csgo_customweapon.vfx's pixel shader that a catalog
// finish uses is decompiled (SPIR-V -> GLSL, via ValveResourceFormat) into
// ./valveCombos/. This module turns one into a WebGL2 program and binds it the
// way the game would.
//
// Why run Valve's shader rather than port it: the wear curve is not one curve.
// Each combo is a specialised variant with its own constants — legacy inputs
// take cavity from ao.R raw and strip on smoothstep(0.58, 0.68); HD inputs take
// pow(R, 1.5) * 0.96 through a remap and strip on 0.56/0.74; hydrographic,
// spray and anodized HD combos strip in two layers; legacy and HD gunsmith use
// different patina formulas. A hand port that re-derives ~60 variants drifts —
// the parity panel measured 110 of 144 sampled finishes visibly off before this
// existed. Running the decompiled combo makes the math correct by construction,
// so what is left to get right is the inputs.
//
// Two modes:
//  - "runtime" (compositePaint): writes our render-target layout — albedo, and
//    rough/metal packed (sfx, rough, metal) LINEAR — via a small epilogue
//    appended after Valve's main(), which also keeps the smoked-magazine tint.
//    Valve's body is never edited.
//  - "oracle" (the Valve parity panel): Valve's raw outputs into sRGB targets,
//    exactly as the game writes them.
//
// Binding is independent of the hand port's interpretations:
//  - uniform VALUES come from the material's raw authored params (PaintDef.params)
//    put through Valve's own bind-time Expressions (1-x, SrgbGammaToLinear,
//    the albedo-levels encode...), read from the shader's variable table;
//  - texture COLOUR SPACE and SAMPLER state come from the combo's own
//    declarations (SrgbRead per variant, g_sTrilinearClamp / Wrap / the
//    pattern's dynamic address mode).
// Shared with the port: the seed -> transform pipeline (verified bit-exact
// separately) and which URL is which texture.
//
// Regenerating the combos: tools/valve-combos/README.md.
// Type-only on purpose: paintComposite imports this module, and a value import
// back would make the pair a cycle whose evaluation order decides whether
// VALVE_RUNTIME_REV exists yet.
import type { PaintDef, WeaponInputs } from "./paintComposite";

type THREE = typeof import("three");
type Texture = import("three").Texture;

export interface ComboMeta {
  id: number;
  state: string[];
  /** Texture name -> SrgbRead, for the variant THIS combo binds. */
  srgb: Record<string, boolean>;
  /** Non-texture variables: shader defaults and Valve's CPU-side Expression. */
  vars: Record<string, { f: number[]; i: number[]; type: string; expr: string }>;
}

const GLSL = import.meta.glob("./valveCombos/*.glsl", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const META = import.meta.glob("./valveCombos/*.json", { import: "default" }) as Record<string, () => Promise<ComboMeta>>;
const comboPath = (id: number, ext: string) => `./valveCombos/c${String(id).padStart(5, "0")}.${ext}`;

/**
 * The static combo of csgo_customweapon_vulkan_50_ps.vcs this finish compiles
 * to. Multipliers are the program's own (StaticComboArray, VCS 72):
 *   S_PAINT_STYLE x1, S_OVERRIDE_NORMAL x9, S_USE_ALL_MASKS x18,
 *   S_ROUGHNESS_TEXTURE x36, S_PEARLESCENCE_MASK x72, S_METALNESS_TEXTURE x144,
 *   S_SEPARATE_CHANNEL_INPUTS x288, S_OVERLAY_TEXTURE x576, S_CASE_HARDENING
 *   x1152, S_CASE_HARDENING_TRILINEAR x2304, S_PATINA_AGE x4608.
 * Every feature but the input packing comes from the material's F_* values
 * AFTER its own SET_VALUE mutators ran (PaintDef.params) — the values the game
 * compiles with. S_SEPARATE_CHANNEL_INPUTS is the weapon's, not the paint's.
 */
export function valveComboId(def: PaintDef, weapon: WeaponInputs | null | undefined): number {
  const f = (n: string) => (def.params[n]?.[0] ? 1 : 0);
  return (
    def.style +
    9 * f("F_OVERRIDE_NORMAL") +
    18 * f("F_USE_ALL_MASKS") +
    36 * f("F_ROUGHNESS_TEXTURE") +
    72 * f("F_PEARLESCENCE_MASK") +
    144 * f("F_METALNESS_TEXTURE") +
    288 * (weapon?.ao && weapon.separateChannels ? 1 : 0) +
    576 * f("F_OVERLAY_TEXTURE") +
    1152 * f("F_CASE_HARDENING") +
    2304 * f("F_CASE_HARDENING_TRILINEAR") +
    4608 * f("F_PATINA_AGE")
  );
}

export async function loadValveCombo(id: number): Promise<{ glsl: string; meta: ComboMeta } | null> {
  const g = GLSL[comboPath(id, "glsl")];
  const m = META[comboPath(id, "json")];
  if (!g || !m) return null;
  const [glsl, meta] = await Promise.all([g(), m()]);
  return { glsl, meta };
}

interface Converted {
  frag: string;
  /** Uniform declarations hoisted out of the _Globals_ block. */
  members: { type: string; name: string }[];
  textures: string[];
  /** Which Valve sampler each texture is read through. */
  samplerOf: Record<string, string>;
}

/**
 * Vulkan GLSL 460 (SPIRV-Cross, as VRF emits it) -> GLSL ES 3.00.
 *
 * Mechanical only: the _Globals_ uniform block is hoisted into plain uniforms,
 * separate texture/sampler objects become combined sampler2Ds (the sampler's
 * STATE moves onto the three Texture instead — see samplerOf), and the
 * `layout(location)` qualifiers ES does not allow on fragment inputs go.
 * Nothing in the body is touched.
 */
export function toWebGL2(src: string): Converted {
  let s = src.replace(/^#version .*$/m, "");
  const members: Converted["members"] = [];
  s = s.replace(
    /struct (_\d+)\s*\{([\s\S]*?)\};\s*layout\([^)]*\)\s*uniform \1 _Globals_;/,
    (_all, _n, body: string) => {
      for (const line of body.split(";")) {
        const m = line.trim().match(/^(\w+)\s+(\w+)(\[\d+\])?$/);
        if (m) members.push({ type: m[1], name: m[2] + (m[3] ?? "") });
      }
      return members.map((m) => `uniform ${m.type} ${m.name};`).join("\n");
    },
  );
  s = s.replace(/_Globals_\./g, "");
  const textures: string[] = [];
  s = s.replace(/layout\([^)]*\)\s*uniform texture2D (\w+);/g, (_a, n: string) => {
    textures.push(n);
    return `uniform sampler2D ${n};`;
  });
  s = s.replace(/layout\([^)]*\)\s*uniform sampler \w+;\n?/g, "");
  const samplerOf: Record<string, string> = {};
  s = s.replace(/sampler2D\((\w+),\s*(\w+)\)/g, (_a, t: string, smp: string) => {
    samplerOf[t] ??= smp;
    return t;
  });
  s = s.replace(/layout\(location = \d+\)\s*in /g, "in ");
  const head = [
    "precision highp float;",
    "precision highp int;",
    "precision highp sampler2D;",
    "#define saturate(x) clamp((x), 0.0, 1.0)",
  ].join("\n");
  return { frag: `${head}\n${s}`, members, textures, samplerOf };
}

// Runtime epilogue, appended after Valve's (renamed) main. Valve's rough/metal
// pass pre-LINEARISES (rough, metal, sfx) because the game's target is sRGB and
// encodes on write; ours is a linear target three reads as G = roughness,
// B = metalness, with the SFX mask in R (see paintSfx / the port's output). So
// undo the linearisation exactly and repack. The albedo pass keeps the
// translucent-magazine darkening the port has always applied: the paint seen
// through smoked plastic, not interior detail.
const RUNTIME_EPILOGUE = /* glsl */ `
uniform sampler2D tMagMask;
uniform bool uHasMag;
vec3 valveLinToSrgb(vec3 v) {
  return mix(1.055 * pow(max(v, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, v * 12.92,
             vec3(lessThanEqual(v, vec3(0.0031308))));
}
void main() {
  valveMain();
  if (bRoughnessMode != 0) {
    vec3 x = valveLinToSrgb(output_0.xyz);
    output_0 = vec4(x.z, x.x, x.y, 1.0);
  } else if (uHasMag) {
    output_0.rgb *= mix(vec3(1.0), vec3(0.72, 0.70, 0.68), texture(tMagMask, input_1.xy).r);
  }
}
`;
/** Folded into the composite store's generation so a change here (or a
 *  regenerated combo set) re-bakes every stored composite. Bump on either. */
// "+masks": the fork's g_bOverrideDefaultMasks binding (paintComposite) changes
// what stored composites contain without touching either shader source, so it
// has to move the generation itself — and under a name an upstream bump can
// never collide with. "+intparams" for the same reason: reading a float param
// filed under m_intParams (paintComposite's flt) changed the composites of every
// finish that does it.
export const VALVE_RUNTIME_REV = `vcs72-r4+masks+intparams ${RUNTIME_EPILOGUE}`;

// The vertex stage, written by hand: Valve's VS is four affine transforms of
// the mesh UV (decompiled, csgo_customweapon_vulkan_50_vs.vcs — every combo is
// dot(uv, X0.xy) + X0.w), which is exactly the port's xf().
const VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform vec4 uPat0, uPat1, uWear0, uWear1, uGrg0, uGrg1, uOv0, uOv1;
uniform int uOvMode;
out vec4 input_1;
out vec4 input_2;
out vec2 input_3;
vec2 xf(vec2 uv, vec4 a, vec4 b) { return vec2(dot(uv, a.xy) + a.w, dot(uv, b.xy) + b.w); }
void main() {
  vec2 uv = position.xy * 0.5 + 0.5;
  vec2 p = xf(uv, uPat0, uPat1);
  input_1 = vec4(uv, p);
  input_2 = vec4(xf(uv, uWear0, uWear1), xf(uv, uGrg0, uGrg1));
  input_3 = uOvMode == 2 ? xf(uv, uOv0, uOv1) : (uOvMode == 1 ? p : uv);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Valve's albedo-levels encode, float3(-v.x, -1.4427*log(max(1e-4, 1-v.y)), 2-v.z). */
const levels = (v: number[]) => [-v[0], -1.4427 * Math.log(Math.max(1e-4, 1 - v[1])), 2 - v[2]];

// FEAT[n] in the variable table indexes the FEATURES program's list (VCS 72).
const FEATURE_NAMES = [
  "F_ROUGHNESS_MODE", "F_OVERRIDE_NORMAL", "F_USE_ALL_MASKS", "F_ROUGHNESS_TEXTURE",
  "F_PEARLESCENCE_MASK", "F_ROUGHNESS_PER_COLOR", "F_METALNESS_TEXTURE", "F_PAINT_STYLE",
  "F_OVERLAY_TEXTURE", "F_OVERLAY_BLEND_MODE", "F_OVERLAY_MASK", "F_SEPARATE_CHANNEL_INPUTS",
  "F_SPRAYPAINT_HALFTONE", "F_CASE_HARDENING", "F_CASE_HARDENING_TRILINEAR", "F_PATINA_AGE",
];

export interface ValveRefNotes {
  /** Uniforms neither the material nor the shader defaults could supply. */
  unbound: string[];
  /** Expressions this runner does not know how to evaluate (value used raw). */
  unevaluated: string[];
  /** Textures the combo samples that we had nothing for. */
  missingTextures: string[];
}

/** What building a Valve composite needs — compositePaint resolves all of it. */
export interface ValveInputs {
  THREE: THREE;
  def: PaintDef;
  wear: number;
  xforms: Record<"pattern" | "wear" | "grunge" | "overlay", [number[], number[]]>;
  /** The seeded pattern transform with an extra rotation — Valve's halftone
   *  screens are the pattern xform rotated by g_flHalftoneRotationOffsetA/B/C. */
  patternXformRotated: (extraDeg: number) => [number[], number[]];
  /** By role: pattern, wear, grunge, masks, ao, color, rm, paintRough,
   *  paintMetal, overlay, overlayMask, caseRamp, paintNormal, pearlMask,
   *  surface, position — plus `tex:<shader name>` for every texture the
   *  material names, for samplers no role covers. */
  urls: Record<string, string | null>;
  loadTex: (url: string, opts: { srgb: boolean; wrap: boolean; addr?: [number, number] }) => Promise<Texture | null>;
  /** g_tPosition ships as EXR, which loadTex cannot read. */
  loadExr: (url: string) => Promise<Texture | null>;
  /** Runtime mode only: the translucent-magazine mask, if this weapon has one. */
  magTex?: Texture | null;
  /** Params the vcompmat rolls from the seed beyond the standard eleven
   *  (SeededVisuals.extra) — they win over the authored value. */
  seeded: Record<string, number[]>;
}

/**
 * Resolve one uniform the way the game would: the authored param (or the
 * shader's default), then Valve's Expression on top.
 */
function uniformValue(name: string, meta: ComboMeta, inp: ValveInputs, pass: 0 | 1, notes: ValveRefNotes): number[] | null {
  const { def } = inp;
  const v = meta.vars[name];
  const raw = (n: string): number[] | null => {
    const p = def.params[n];
    if (p?.length) return p;
    const d = meta.vars[n];
    if (!d) return null;
    return d.type.startsWith("Int") || d.type === "Bool" ? d.i : d.f;
  };
  // Inputs this runner owns outright.
  switch (name) {
    case "bRoughnessMode":
      return [pass];
    case "g_flWearAmount":
      return [inp.wear];
    case "g_vPatternTexCoordXform0":
      return inp.xforms.pattern[0];
    case "g_vPatternTexCoordXform1":
      return inp.xforms.pattern[1];
    // Seeded when the vcompmat rolls it; otherwise the loader's resolution
    // (authored value vs the midpoint-means-seeded heuristic, which still
    // covers skins that roll only the standard eleven).
    case "g_flCaseHardeningRampOffset":
      return inp.seeded[name] ?? [def.chRampOffset];
  }
  if (inp.seeded[name]) return inp.seeded[name];
  const half = name.match(/^g_vPatternTexCoordXformHalftone([ABC])([01])$/);
  if (half) {
    const off = raw(`g_flHalftoneRotationOffset${half[1]}`)?.[0] ?? 0;
    return inp.patternXformRotated(off)[Number(half[2])];
  }
  // SPIRV-Cross names a member it could not resolve _mN; every one in the
  // bundled set is declared and never read.
  if (/^_m\d+$/.test(name)) return null;
  if (!v) {
    notes.unbound.push(name);
    return null;
  }
  const expr = v.expr.trim();
  if (!expr) return raw(name);
  let m: RegExpMatchArray | null;
  if ((m = expr.match(/^FEAT\[(\d+)\]$/))) {
    // params carries the F_* values after the vcompmat's own mutators ran —
    // the values the game compiles with. The PaintDef fields are the fallback
    // for a chain that names none.
    const f = FEATURE_NAMES[Number(m[1])];
    const p = def.params[f]?.[0];
    if (p != null) return [p];
    if (f === "F_SPRAYPAINT_HALFTONE") return [def.halftone ? 1 : 0];
    if (f === "F_OVERLAY_BLEND_MODE") return [def.overlayBlendMode];
    if (f === "F_OVERLAY_MASK") return [def.overlayMaskMode];
    return [0];
  }
  if ((m = expr.match(/^SrgbGammaToLinear\((\w+)\)$/))) return (raw(m[1]) ?? []).map(srgbToLinear);
  if ((m = expr.match(/^1-(\w+)$/))) return (raw(m[1]) ?? []).map((x) => 1 - x);
  if (expr.includes("-1.4427*log")) {
    // Either a constant — float3(-float3(a,b,c).x, ...) — or a param's own levels.
    const lit = expr.match(/float3\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
    if (lit) return levels([Number(lit[1]), Number(lit[2]), Number(lit[3])]);
    return levels(raw(name) ?? [0, 0, 1]);
  }
  if ((m = expr.match(/^(\d+)-(\d+)$/))) return [Number(m[1]) - Number(m[2])];
  if (name === "g_vSprayBiasBlend") {
    const b = raw("g_bBiasSpray")?.[0] ? 1 : 0;
    const blend = raw("g_vSprayBlend") ?? [1, 1];
    return [b, blend[0] ?? 1, blend[1] ?? 1];
  }
  notes.unevaluated.push(`${name} = ${expr.split("\n")[0]}`);
  return raw(name);
}

function uniformOf(THREE: THREE, type: string, v: number[]): { value: unknown } | null {
  switch (type) {
    case "float":
      return { value: v[0] ?? 0 };
    case "int":
    case "bool":
      return { value: Math.trunc(v[0] ?? 0) };
    case "vec2":
      return { value: new THREE.Vector2(v[0] ?? 0, v[1] ?? 0) };
    case "vec3":
      return { value: new THREE.Vector3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) };
    case "vec4":
      return { value: new THREE.Vector4(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0) };
  }
  return null;
}

/** Which resolved URL feeds each Valve texture name. */
const TEXTURE_SOURCE: Record<string, string> = {
  g_tAmbientOcclusion: "ao",
  g_tMasks: "masks",
  g_tWear: "wear",
  g_tPattern: "pattern",
  g_tGrunge: "grunge",
  g_tMetalness: "rm",
  g_tColor: "color",
  g_tNormal: "paintNormal",
  g_tPaintRoughness: "paintRough",
  g_tPaintMetalness: "paintMetal",
  g_tPearlescenceMask: "pearlMask",
  g_tOverlay: "overlay",
  g_tOverlayMask: "overlayMask",
  g_tCaseHardeningColorRamp: "caseRamp",
  g_tSurface: "surface",
  g_tPosition: "position",
};

export interface ValveMaterials {
  comboId: number;
  /** Pass 0 = albedo, pass 1 = rough/metal. */
  albedo: import("three").RawShaderMaterial;
  rm: import("three").RawShaderMaterial;
  notes: ValveRefNotes;
  /** Call once rendered. Material ownership only — input textures belong to
   *  the shared cache. */
  dispose: () => void;
}

const programCache = new Map<string, Converted>();

/** Build Valve's two passes for a finish. See the module comment for modes. */
export async function buildValveMaterials(
  inp: ValveInputs,
  combo: { glsl: string; meta: ComboMeta },
  mode: "runtime" | "oracle",
): Promise<ValveMaterials> {
  const { THREE, def } = inp;
  const notes: ValveRefNotes = { unbound: [], unevaluated: [], missingTextures: [] };
  const key = `${mode}|${combo.meta.id}`;
  let conv = programCache.get(key);
  if (!conv) {
    conv = toWebGL2(combo.glsl);
    if (mode === "runtime") {
      conv = { ...conv, frag: conv.frag.replace(/\bvoid main\(\)/, "void valveMain()") + RUNTIME_EPILOGUE };
    }
    programCache.set(key, conv);
  }
  const owned: Texture[] = [];
  const fallback = (rgba: [number, number, number, number]) => {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
    t.needsUpdate = true;
    owned.push(t);
    return t;
  };

  const textures: Record<string, { value: unknown }> = {};
  await Promise.all(
    conv.textures.map(async (t) => {
      const smp = conv!.samplerOf[t] ?? "g_sTrilinearWrap";
      const srgb = combo.meta.srgb[t] ?? false;
      // Wrap/wrap is what loadTex already does with no address mode, and
      // leaving it unset keeps the cache key identical to the port's own load —
      // otherwise every pattern would be fetched and decoded twice.
      const addr: [number, number] | undefined =
        smp === "AddressU_dynamic_AddressV_dynamic" && (def.patternAddrH || def.patternAddrV)
          ? [def.patternAddrH, def.patternAddrV]
          : undefined;
      // A role we resolve wins (it carries the loader's choices — the weapon's
      // extracted inputs, which mask). Otherwise the material's own texture of
      // that name: the combo only samples what its mutated features switched
      // on, and the game binds whatever the material names for it.
      const role = TEXTURE_SOURCE[t];
      const url = (role ? inp.urls[role] : null) ?? inp.urls[`tex:${t}`] ?? null;
      let tex: Texture | null = null;
      if (url) {
        tex = t === "g_tPosition" ? await inp.loadExr(url) : await inp.loadTex(url, { srgb, wrap: smp !== "g_sTrilinearClamp", addr });
      }
      if (!tex) {
        // Named so a finish leaning on one is visible in the parity panel. The
        // glitter sheet's alpha only ever gates a dead branch (w < 0).
        if (t !== "g_tGlitterNormal") notes.missingTextures.push(t);
        tex =
          t === "g_tNormal" || t === "g_tSurface" ? fallback([128, 128, 255, 255])
          : t === "g_tGlitterNormal" ? fallback([128, 128, 0, 0])
          : t === "g_tAmbientOcclusion" ? fallback([255, 255, 255, 0])
          : fallback([0, 0, 0, 255]);
      }
      textures[t] = { value: tex };
    }),
  );

  const material = (pass: 0 | 1) => {
    const u: Record<string, { value: unknown }> = { ...textures };
    for (const m of conv!.members) {
      const v = uniformValue(m.name, combo.meta, inp, pass, notes);
      const uv = v ? uniformOf(THREE, m.type, v) : null;
      if (uv) u[m.name] = uv;
    }
    const X = (a: number[]) => ({ value: new THREE.Vector4().fromArray(a) });
    u.uPat0 = X(inp.xforms.pattern[0]);
    u.uPat1 = X(inp.xforms.pattern[1]);
    u.uWear0 = X(inp.xforms.wear[0]);
    u.uWear1 = X(inp.xforms.wear[1]);
    u.uGrg0 = X(inp.xforms.grunge[0]);
    u.uGrg1 = X(inp.xforms.grunge[1]);
    u.uOv0 = X(inp.xforms.overlay[0]);
    u.uOv1 = X(inp.xforms.overlay[1]);
    u.uOvMode = { value: def.overlayUsesUniqueUv ? 2 : def.overlayUsesPatternUv ? 1 : 0 };
    if (mode === "runtime") {
      u.tMagMask = { value: inp.magTex ?? fallback([0, 0, 0, 255]) };
      u.uHasMag = { value: !!inp.magTex };
    }
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: conv!.frag,
      uniforms: u,
      depthTest: false,
      depthWrite: false,
    });
  };
  const albedo = material(0);
  const rm = material(1);
  notes.unbound = [...new Set(notes.unbound)];
  notes.unevaluated = [...new Set(notes.unevaluated)];
  // three deletes a GL program the moment no material uses it, so disposing
  // these after every composite would recompile the combo on the next one —
  // and these are big shaders. The FIRST pair built for a combo is kept as an
  // anchor that holds the program; later pairs share it and dispose freely.
  // The anchor drops its texture references once it has rendered, so it does
  // not pin one finish's textures in memory for the rest of the session.
  const anchored = !anchors.has(key);
  if (anchored) anchors.set(key, [albedo, rm]);
  return {
    comboId: combo.meta.id,
    albedo,
    rm,
    notes,
    dispose: () => {
      if (anchored) {
        for (const m of [albedo, rm]) {
          for (const u of Object.values(m.uniforms)) if ((u.value as Texture | null)?.isTexture) u.value = null;
        }
      } else {
        albedo.dispose();
        rm.dispose();
      }
      for (const t of owned) t.dispose();
    },
  };
}
const anchors = new Map<string, import("three").RawShaderMaterial[]>();

/** Whether three managed to link a material's program. A combo that fails to
 *  compile logs once and renders nothing — the caller falls back on this. */
export function programFailed(renderer: import("three").WebGLRenderer, mat: import("three").Material): boolean {
  const prog = (renderer.properties.get(mat) as { currentProgram?: { diagnostics?: { runnable: boolean } } }).currentProgram;
  return !prog || prog.diagnostics?.runnable === false;
}

export interface ValveRefResult {
  comboId: number;
  albedoRT: import("three").WebGLRenderTarget;
  rmRT: import("three").WebGLRenderTarget;
  notes: ValveRefNotes;
  dispose: () => void;
}

/**
 * ORACLE: render Valve's composite into two fresh targets laid out like the
 * game's — albedo and rough/metal, BOTH sRGB-formatted (Valve's rough/metal
 * pass pre-linearises its output for exactly that reason, so the stored bytes
 * are the raw values).
 */
export async function renderValveReference(
  ctx: ValveInputs & {
    renderer: import("three").WebGLRenderer;
    quad: import("three").BufferGeometry;
    makeRT: (srgb: boolean) => import("three").WebGLRenderTarget;
  },
  combo: { glsl: string; meta: ComboMeta },
): Promise<ValveRefResult> {
  const { THREE, renderer } = ctx;
  const mats = await buildValveMaterials(ctx, combo, "oracle");
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(ctx.quad);
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const albedoRT = ctx.makeRT(true);
  const rmRT = ctx.makeRT(true);
  for (const [mat, rt] of [[mats.albedo, albedoRT], [mats.rm, rmRT]] as const) {
    mesh.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(null);
  return {
    comboId: mats.comboId,
    albedoRT,
    rmRT,
    notes: mats.notes,
    dispose: () => {
      albedoRT.dispose();
      rmRT.dispose();
      mats.dispose();
    },
  };
}
