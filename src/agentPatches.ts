/**
 * Patches on agents.
 *
 * CS2 does not project a patch onto a character or hang it off an attachment
 * bone. `csgo_character.vfx` stamps it into the body's BASE COLOUR in UV space:
 * the material declares up to three slots, each a UV centre, a size, a rotation
 * and a squash, and the shader composites `g_tPatch<n>` over the albedo there.
 * So this is a texture composite, not a decal — the same shape as
 * gloveComposite.ts, and nothing to do with the projected-sticker machinery in
 * viewer3d.ts.
 *
 * THE PLACEMENT DATA IS ALREADY ON THE MOUNT. Every agent GLB carries its source
 * vmat under `material.extras.vmat`, which GLTFLoader copies to
 * `material.userData.vmat` — verified reading back `ShaderName` through three.
 * So no extraction work is needed to know where a patch goes; only the patch ART
 * is missing (see resolveArt below).
 *
 * Surveyed across all 63 agents on 2026-07-30: every one declares exactly THREE
 * slots per material (`g_bEnablePatch0..2`), and some declare them on more than
 * one material — gendarmerie on upperbody AND trousers, the diver on three. A
 * slot with `g_flPatch<n>Scale == 0` is a dead declaration, not a position, so
 * the real count is 3 to 5 depending on the model.
 */
import type * as ThreeNS from "three";

type Three = typeof ThreeNS;

/** One place a patch can go, read off the model's own material. */
export interface PatchSlot {
  /** Material the slot belongs to — the composite rewrites that map alone. */
  material: string;
  /** 0..2 within the material. */
  index: number;
  /** UV centre, already resolved from the offset (see readPatchSlots). */
  center: [number, number];
  /** Half-extent in UV, x and y. */
  half: [number, number];
  /** A negative authored squash mirrors the patch across its own y. */
  mirror: boolean;
  /** Radians, about the slot's centre. */
  rotation: number;
  /**
   * `g_flPatch<n>BackingScale`. 0 means the slot draws the art alone; otherwise
   * it is the size RATIO between the art and its stitched backing, and which of
   * the two keeps the slot's own footprint depends on which side of 1 it falls.
   * See applyAgentPatches.
   */
  backingScale: number;
  /**
   * The MODEL ships this slot filled: a unit insignia (the gendarmerie's crest,
   * a team stitch), not a player patch. Those slots are already painted into the
   * body texture we load, so a player patch must not be dropped on top of one.
   */
  builtIn: boolean;
}

/**
 * UV half-size for a slot of scale 1, i.e. `half = PATCH_UV / scale`.
 *
 * DECODED, not inferred (2026-08-03). Ground truth is
 * `tools/shadertest/groundtruth/character_patches.glsl`, `csgo_character` VCS 71
 * static combo 65536 (`S_PATCHES=1`, cid 65536). The shader builds the lookup as
 *
 *     d  = (uv - 0.5) - g_vPatch<n>Offset
 *     sc = d * abs(g_flPatch<n>Scale)
 *     p  = rotate(sc.x, sc.y * g_flPatch<n>Squash, rotation) + 0.5
 *     miss unless p is inside [0,1] on both axes
 *
 * so the footprint is `|d| <= 0.5 / scale` — the 0.5 below. That much the
 * earlier guess had right; three things around it were wrong, see readPatchSlots.
 */
const PATCH_UV = 0.5;

interface VmatExtras {
  ShaderName?: string;
  IntParams?: Record<string, number | string>;
  FloatParams?: Record<string, number | string>;
  VectorParams?: Record<string, (number | string)[]>;
  TextureParams?: Record<string, string>;
}

const NUM = (v: unknown, dflt = 0) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
};

/**
 * The patch positions this model offers, in the order the GLB declares them.
 *
 * ORDER IS THE GLB'S, deliberately, not alphabetical: the export lists an
 * agent's materials in authoring order, which puts the upper body before the
 * trousers. Sorting by name would put the gendarmerie's first patch on its leg.
 *
 * Inventory slot N therefore fills position N. That is the mapping by decision,
 * not by discovery: nothing in the econ schema or the material pairs a patch
 * slot with a position — the schema's slots are a flat 0..4 and the positions
 * are the model's — so the only ordering either side agrees on is the order each
 * lists them in. It is stable across mounts and re-extracts, which is what
 * actually matters: a patch must not move because the viewer reopened.
 */
export function readPatchSlots(root: ThreeNS.Object3D, flipV = true): PatchSlot[] {
  const slots: PatchSlot[] = [];
  const seen = new Set<string>();
  root.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const vmat = (m.userData as { vmat?: VmatExtras } | undefined)?.vmat;
      if (!vmat || !NUM(vmat.IntParams?.F_PATCHES)) continue;
      for (let i = 0; i < 3; i++) {
        const scale = NUM(vmat.FloatParams?.[`g_flPatch${i}Scale`]);
        // A zero scale is a slot the artist never placed. It also carries a zero
        // offset, so honouring it would stack patches at the UV origin.
        if (!(scale > 0)) continue;
        const off = vmat.VectorParams?.[`g_vPatch${i}Offset`] ?? [];
        const squash = NUM(vmat.FloatParams?.[`g_flPatch${i}Squash`], 1) || 1;
        // abs(), matching the shader: a negative SCALE is just a scale.
        const halfX = PATCH_UV / Math.abs(scale);
        slots.push({
          material: m.name,
          index: i,
          // Offsets run -0.45..0.34 across every agent — signed displacements
          // from the middle of the map, which is what the shader's
          // `(uv - 0.5) - offset` makes them.
          //
          // V IS NOT FLIPPED by default — the shader adds the offset in both
          // axes and we take it literally. See PATCH_FLIP_V in viewer3d.ts for
          // why the flip was tried, why tm_professional_varf3 cannot tell the
          // two apart, and which agent can.
          center: [0.5 + NUM(off[0]), flipV ? 0.5 - NUM(off[1]) : 0.5 + NUM(off[1])],
          // SQUASH DIVIDES, it does not multiply. The shader applies it to the
          // sampling coordinate (`sc.y * squash`), so a squash above 1 makes the
          // patch sample faster in y and therefore cover LESS of the map. The
          // first pass had this multiplying, which stretched every non-square
          // slot the wrong way. Sign is kept: a negative squash mirrors y, which
          // is why there is no separate flip flag any more.
          half: [halfX, halfX / Math.abs(squash)],
          mirror: squash < 0,
          rotation: NUM(vmat.FloatParams?.[`g_flPatch${i}Rotation`]),
          backingScale: NUM(vmat.FloatParams?.[`g_flPatch${i}BackingScale`]),
          builtIn: !!NUM(vmat.IntParams?.[`g_bEnablePatch${i}`]),
        });
      }
    }
  });
  return slots;
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
 * Stamp up to three patches over one material's base colour.
 *
 * Four samplers, so nowhere near the 16-unit ceiling that has made weapon skins
 * render black before — three slots is all a material declares.
 */
const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uBase, uP0, uP1, uP2, uB0, uB1, uB2;
uniform vec4 uRect[3];   // centre.xy, ART half.xy
uniform vec2 uBackHalf[3];
uniform vec2 uRot[3];    // cos, sin
uniform vec3 uOn;        // 0/1 per slot
uniform vec3 uMirror;    // negative squash
uniform vec3 uHasBack;
uniform float uBoxes;    // debug: paint each slot's footprint instead of its art

/**
 * The patch's own uv for this texel, or a miss.
 *
 * ext is the footprint, so this is the shader's rotate(d * scale, rot) + 0.5
 * with the scale expressed as an extent — the two are the same map, and an
 * extent survives the squash and backing rules without every caller
 * re-deriving them.
 */
// "ext", not "half": half is a RESERVED WORD in GLSL ES and the compile fails
// with "Illegal use of reserved word", which surfaces as the whole material
// rendering black rather than as anything patch-shaped.
bool slotUv(vec2 uv, vec2 centre, vec2 ext, vec2 cs, float mirror, out vec2 p) {
  vec2 d = (uv - centre) / ext;
  if (mirror > 0.5) d.y = -d.y;
  // R(theta) exactly as the decompile writes it:
  //   (x*cos - y*sin, x*sin + y*cos)
  vec2 r = vec2(d.x * cs.x - d.y * cs.y, d.x * cs.y + d.y * cs.x);
  if (abs(r.x) > 1.0 || abs(r.y) > 1.0) return false;
  p = r * 0.5 + 0.5;
  return true;
}

/**
 * One slot, art over its stitched backing.
 *
 * The shader draws BOTH at the same centre and rotation but different extents,
 * then mix(backing.rgb, art.rgb, art.a) with max() of the two alphas — so the
 * backing shows wherever the art is transparent and the pair composites into the
 * body as one sprite. A slot with no backing scale is just the art.
 */
vec4 slot(sampler2D art, sampler2D back, vec2 uv, vec4 rect, vec2 backExt, vec2 cs, float mirror, float hasBack) {
  vec2 p;
  vec4 out4 = vec4(0.0);
  if (slotUv(uv, rect.xy, rect.zw, cs, mirror, p)) out4 = texture(art, p);
  if (hasBack > 0.5) {
    vec4 b = vec4(0.0);
    if (slotUv(uv, rect.xy, backExt, cs, mirror, p)) b = texture(back, p);
    out4 = vec4(mix(b.rgb, out4.rgb, out4.a), max(out4.a, b.a));
  }
  return out4;
}

/**
 * Debug: the slot's own footprint as a flat colour, with a darker frame.
 *
 * The question "is this patch in the wrong place, the wrong size, or just ugly
 * art" cannot be answered from a lit render of the art itself — a patch whose
 * icon has an opaque background looks exactly like a patch that is too big.
 * Painting the footprint separates the two in one look.
 */
vec4 box(vec2 uv, vec4 rect, vec2 cs, float mirror, vec3 tint) {
  vec2 d = (uv - rect.xy) / rect.zw;
  if (mirror > 0.5) d.y = -d.y;
  vec2 r = vec2(d.x * cs.x - d.y * cs.y, d.x * cs.y + d.y * cs.x);
  float m = max(abs(r.x), abs(r.y));
  if (m > 1.0) return vec4(0.0);
  // Frame the outer 12% so adjacent or overlapping slots stay distinguishable.
  return vec4(m > 0.88 ? tint * 0.35 : tint, 1.0);
}

void main() {
  vec3 col = texture(uBase, vUv).rgb;
  // Unrolled: a sampler cannot be indexed by a non-constant in GLSL ES 3.00.
  if (uBoxes > 0.5) {
    if (uOn.x > 0.5) { vec4 t = box(vUv, uRect[0], uRot[0], uMirror.x, vec3(1.0, 0.15, 0.15)); col = mix(col, t.rgb, t.a); }
    if (uOn.y > 0.5) { vec4 t = box(vUv, uRect[1], uRot[1], uMirror.y, vec3(0.15, 1.0, 0.25)); col = mix(col, t.rgb, t.a); }
    if (uOn.z > 0.5) { vec4 t = box(vUv, uRect[2], uRot[2], uMirror.z, vec3(0.2, 0.45, 1.0)); col = mix(col, t.rgb, t.a); }
    fragColor = vec4(col, 1.0);
    return;
  }
  if (uOn.x > 0.5) { vec4 t = slot(uP0, uB0, vUv, uRect[0], uBackHalf[0], uRot[0], uMirror.x, uHasBack.x); col = mix(col, t.rgb, t.a); }
  if (uOn.y > 0.5) { vec4 t = slot(uP1, uB1, vUv, uRect[1], uBackHalf[1], uRot[1], uMirror.y, uHasBack.y); col = mix(col, t.rgb, t.a); }
  if (uOn.z > 0.5) { vec4 t = slot(uP2, uB2, vUv, uRect[2], uBackHalf[2], uRot[2], uMirror.z, uHasBack.z); col = mix(col, t.rgb, t.a); }
  fragColor = vec4(col, 1.0);
}`;

/** A patch's art and, when the mount has it, its stitched fabric backing. */
export interface PatchArt {
  art: ThreeNS.Texture;
  backing: ThreeNS.Texture | null;
}

export interface PatchApplication {
  /** How many of the requested patches actually landed. */
  placed: number;
  dispose: () => void;
}

/**
 * Composite the given patch textures onto the agent, in slot order.
 *
 * `arts` is slot-aligned and may be sparse; a null entry leaves that position
 * bare. Extra entries beyond the model's positions are DROPPED and reported via
 * `placed` — the craft form offers five slots and most agents declare three, and
 * silently rendering four of five would be worse than saying so.
 */
/** Stand-in for an empty slot in box mode, where the art is never sampled. */
let blankArt: ThreeNS.Texture = null as unknown as ThreeNS.Texture;

export function applyAgentPatches(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  root: ThreeNS.Object3D,
  slots: PatchSlot[],
  arts: (PatchArt | null)[],
  /** Paint each slot's footprint instead of its art — see the `box` helper. */
  boxes = false,
): PatchApplication {
  const targets: ThreeNS.WebGLRenderTarget[] = [];
  if (!blankArt) {
    blankArt = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blankArt.needsUpdate = true;
  }
  // Group by material: one composite pass rewrites one map, however many of its
  // three slots are filled.
  const byMaterial = new Map<string, { slot: PatchSlot; art: PatchArt }[]>();
  let placed = 0;
  slots.forEach((slot, i) => {
    const art = arts[i];
    if (art) placed++;
    // In box mode EVERY slot is drawn, filled or not — the whole point is to see
    // the positions a model offers, including the ones nothing is equipped in.
    if (!art && !boxes) return;
    const list = byMaterial.get(slot.material) ?? [];
    list.push({ slot, art: art ?? { art: blankArt, backing: null } });
    byMaterial.set(slot.material, list);
  });
  if ((globalThis as { __item3dDebug?: boolean }).__item3dDebug) {
    for (const s of slots) {
      const i = slots.indexOf(s);
      console.log(
        `[patch slot ${i}] ${s.material}#${s.index} centre=${s.center.map((v) => v.toFixed(3)).join(",")}` +
          ` half=${s.half.map((v) => v.toFixed(4)).join(",")} rot=${s.rotation.toFixed(2)} mirror=${s.mirror}` +
          ` back=${s.backingScale} builtIn=${s.builtIn} art=${arts[i] ? "y" : "-"} backTex=${arts[i]?.backing ? "y" : "-"}`,
      );
    }
  }
  if (!byMaterial.size) return { placed: 0, dispose: () => {} };

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geom);
  scene.add(quad);
  const prevTarget = renderer.getRenderTarget();
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;

  // THE GLTF SCENE'S MATERIALS ARE SHARED. `SkeletonUtils.clone()` copies the
  // graph but hands every clone the SAME material instances, so writing the
  // composited map onto one would put this viewer's patches on every other
  // viewer of the agent — and on the next mount, which reads the same cached
  // scene. Each patched material is cloned instead, exactly as the weapon paint
  // path does. Keyed on the original's uuid so meshes sharing a material still
  // share its clone rather than compositing it twice.
  const clones = new Map<string, ThreeNS.MeshStandardMaterial>();
  // Every material this swapped, so dispose() can put the originals back. A
  // re-apply (setPatches) is dispose-then-apply, and without the restore the
  // second pass would composite on top of the first one's output — patches would
  // accumulate instead of replacing.
  const restore: { mesh: ThreeNS.Mesh; slotIdx: number; original: ThreeNS.MeshStandardMaterial }[] = [];
  root.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as ThreeNS.MeshStandardMaterial[];
    mats.forEach((m, slotIdx) => {
      const list = m && byMaterial.get(m.name);
      if (!list || !m.map) return;
      const already = clones.get(m.uuid);
      if (already) {
        restore.push({ mesh, slotIdx, original: m });
        if (Array.isArray(mesh.material)) mesh.material[slotIdx] = already;
        else mesh.material = already;
        return;
      }
      const src = m.map;
      const w = (src.image as { width?: number } | undefined)?.width ?? 2048;
      const h = (src.image as { height?: number } | undefined)?.height ?? w;
      const rt = new THREE.WebGLRenderTarget(w, h, {
        colorSpace: THREE.SRGBColorSpace,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
      });
      // Match the source's addressing, or a patch near a seam samples the wrong
      // edge — the render target's own default is ClampToEdge.
      rt.texture.wrapS = src.wrapS;
      rt.texture.wrapT = src.wrapT;
      rt.texture.flipY = src.flipY;
      targets.push(rt);

      const rect: ThreeNS.Vector4[] = [];
      const backHalf: ThreeNS.Vector2[] = [];
      const rot: ThreeNS.Vector2[] = [];
      const on = new THREE.Vector3();
      const mirror = new THREE.Vector3();
      const hasBack = new THREE.Vector3();
      const tex: (ThreeNS.Texture | null)[] = [null, null, null];
      const back: (ThreeNS.Texture | null)[] = [null, null, null];
      for (let i = 0; i < 3; i++) {
        const hit = list[i];
        // ART AND BACKING SHARE A CENTRE AND DIFFER ONLY IN EXTENT, and which of
        // the two keeps the slot's own footprint flips at BackingScale == 1:
        // below it the art stays put and the backing shrinks by the ratio, above
        // it the backing stays put and the ART shrinks by it. That asymmetry is
        // the shader's, not a simplification — it is how one number can mean
        // both "give this patch a wide border" and "shrink this patch inside its
        // border".
        const bs = Math.abs(hit?.slot.backingScale ?? 0);
        const shrinkArt = bs >= 1 ? bs : 1;
        const backScale = bs > 0 && bs < 1 ? bs : 1;
        rect.push(
          hit
            ? new THREE.Vector4(hit.slot.center[0], hit.slot.center[1], hit.slot.half[0] / shrinkArt, hit.slot.half[1] / shrinkArt)
            : new THREE.Vector4(),
        );
        backHalf.push(hit ? new THREE.Vector2(hit.slot.half[0] * backScale, hit.slot.half[1] * backScale) : new THREE.Vector2(1, 1));
        rot.push(hit ? new THREE.Vector2(Math.cos(hit.slot.rotation), Math.sin(hit.slot.rotation)) : new THREE.Vector2(1, 0));
        on.setComponent(i, hit ? 1 : 0);
        mirror.setComponent(i, hit?.slot.mirror ? 1 : 0);
        hasBack.setComponent(i, hit != null && bs > 0 && hit.art.backing != null ? 1 : 0);
        tex[i] = hit?.art.art ?? null;
        back[i] = hit?.art.backing ?? null;
      }
      const mat = new THREE.RawShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uBase: { value: src },
          uP0: { value: tex[0] ?? blank },
          uP1: { value: tex[1] ?? blank },
          uP2: { value: tex[2] ?? blank },
          uB0: { value: back[0] ?? blank },
          uB1: { value: back[1] ?? blank },
          uB2: { value: back[2] ?? blank },
          uRect: { value: rect },
          uBackHalf: { value: backHalf },
          uRot: { value: rot },
          uOn: { value: on },
          uMirror: { value: mirror },
          uHasBack: { value: hasBack },
          uBoxes: { value: boxes ? 1 : 0 },
        },
      });
      quad.material = mat;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      mat.dispose();
      // The ORIGINAL material and its map belong to the cached glTF and are
      // left exactly as they were; only this clone points at the composite.
      const patched = m.clone();
      patched.map = rt.texture;
      patched.needsUpdate = true;
      clones.set(m.uuid, patched);
      restore.push({ mesh, slotIdx, original: m });
      if (Array.isArray(mesh.material)) mesh.material[slotIdx] = patched;
      else mesh.material = patched;
      if ((globalThis as { __item3dDebug?: boolean }).__item3dDebug) {
        console.log(`[patch composite] ${m.name} ${w}x${h} slots=${list.length}`);
      }
    });
  });

  renderer.setRenderTarget(prevTarget);
  geom.dispose();
  blank.dispose();
  return {
    placed,
    dispose: () => {
      for (const r of restore) {
        if (Array.isArray(r.mesh.material)) r.mesh.material[r.slotIdx] = r.original;
        else r.mesh.material = r.original;
      }
      targets.forEach((t) => t.dispose());
      // The clones are this viewer's own; the materials they were cloned FROM
      // stay in the glTF cache untouched.
      clones.forEach((m) => m.dispose());
    },
  };
}
