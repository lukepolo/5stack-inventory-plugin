// Bake a CS2 vanity scene into a viewer environment.
//
// `scripts/extract-map-envs.mjs` pulls each `<map>_vanity.vpk` out as a glTF
// world plus the scene's own `csgo_item_previewmodel` marker — the point the
// game displays an item at. This stands a cube camera on that exact spot,
// renders the scene around it, and folds the six faces into one equirectangular
// panorama: the same shape as the HDRI the viewer already lights everything
// with, so nothing downstream has to learn a new kind of environment.
//
// WHY BAKE AT ALL, rather than ship the scene. The worlds run 8-318MB with
// their textures; the panorama is under a megabyte and costs one texture fetch.
// The weapon is a hand-sized object turning on the spot in the middle of the
// frame, so what the scene actually contributes is light, reflections and a
// backdrop — none of which need parallax, and all of which a panorama carries.
//
// UNLIT BY DEFAULT. Source 2 bakes its lighting into lightmaps that the glTF
// export does not carry, so lighting this scene ourselves would mean inventing a
// sun for a room that already has one baked into nothing we can see. Drawing the
// albedo flat is closer to the truth than a guessed key light, and for a
// backdrop it reads correctly — it is what the map looks like in even light.
//
//   node tools/shadertest/shoot.mjs 'http://localhost:5199/envbake.html?map=de_mirage' out/env --wait 60000
//
// ?map=    which scene (must be in ./envsrc/<map>.glb — see the README)
// ?at=     capture point "x,y,z" in metres, Y-up. Defaults to the index entry.
// ?size=   cube face size (default 1024)
// ?out=    panorama width (default 4096; height is half)
// ?lit=1   light it with a hemisphere + sun instead of drawing albedo flat
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const q = new URLSearchParams(location.search);
const MAP = q.get("map") ?? "de_mirage";
const FACE = Number(q.get("size") ?? 1024);
const OUT_W = Number(q.get("out") ?? 4096);
const LIT = q.get("lit") === "1";

const el = document.getElementById("out")!;
const line = (t: string, cls = "") => {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = t;
  el.appendChild(d);
};

/** The capture points the extractor measured, keyed by map. */
type Entry = {
  map: string;
  label: string;
  capture: [number, number, number];
  sh?: number[];
  sky?: string;
  /** The camera CS2 frames a weapon with in this scene — see the extractor. */
  plate?: { name: string; at: number[]; dir: number[]; fov: number; dofCrisp: number; dofBlurry: number };
};

/**
 * The sky, from the scene's own spherical harmonics.
 *
 * CS2's sky textures are BC6H cubes that this toolchain cannot decode, but
 * every one of them carries `CUBEMAP_RADIANCE_SH` in its header: nine L2
 * coefficients per channel, in HDR, precomputed by Valve. Evaluated per
 * direction that is a smooth gradient of exactly the right colours — which is
 * what a sky contributes to a scene of this kind, and infinitely better than
 * the blown white dome a world export leaves behind.
 *
 * SOURCE SPACE. The coefficients are authored in the game's Z-up frame while
 * the export is Y-up under `world = (y, z, x)`, so a direction has to go back
 * the other way — `src = (z, x, y)` — before the basis is evaluated.
 */
function skyDome(sh: number[]) {
  const coeff = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(sh[i], sh[i + 9], sh[i + 18]));
  return new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { c: { value: coeff } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 c[9];
        void main() {
          vec3 d = normalize(vDir);
          vec3 s = normalize(vec3(d.z, d.x, d.y));   // back to the game's Z-up
          vec3 col =
              c[0] * 0.282095
            + c[1] * 0.488603 * s.y
            + c[2] * 0.488603 * s.z
            + c[3] * 0.488603 * s.x
            + c[4] * 1.092548 * s.x * s.y
            + c[5] * 1.092548 * s.y * s.z
            + c[6] * 0.315392 * (3.0 * s.z * s.z - 1.0)
            + c[7] * 1.092548 * s.x * s.z
            + c[8] * 0.546274 * (s.x * s.x - s.y * s.y);
          // The coefficients are radiance, so they run past 1. Tonemap the way
          // the viewer does rather than clipping to a flat white band.
          col = max(col, vec3(0.0));
          col = col / (col + vec3(1.0)) * 1.35;
          gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
        }`,
    }),
  );
}

async function run() {
  const index: Entry[] = await fetch("./envsrc/index.json").then((r) => r.json());
  const entry = index.find((e) => e.map === MAP);
  const at = q.get("at")?.split(",").map(Number) ?? entry?.capture;
  if (!at || at.length !== 3) throw new Error(`no capture point for ${MAP}`);
  line(`${MAP} — capture ${at.map((n) => n.toFixed(2)).join(", ")}${LIT ? " (lit)" : " (flat albedo)"}`, "dim");

  // ON THE PAGE, AND READ OFF THE CANVAS. `readRenderTargetPixels` returns
  // black in this headless rig — even the clear colour — while `toDataURL` on a
  // canvas that has actually been drawn to works, which is the path the other
  // rig pages already use. So everything renders to the default framebuffer and
  // is read back as an image, and no step depends on reading a render target.
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(FACE, FACE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The lightmap is HDR: a sunlit wall in it runs well past 1, and with no
  // tonemapper those pixels clamp to the same flat white the unlit bake had.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = Number(q.get("exp") ?? 1.1);
  renderer.domElement.style.cssText = "position:fixed;left:-4000px;top:0";
  document.body.appendChild(renderer.domElement);
  const shot = (label: string, w: number, h: number, mime = "image/png", q2 = 0.92) => {
    line(label, "pass");
    const img = document.createElement("img");
    img.src = renderer.domElement.toDataURL(mime, q2);
    img.style.cssText = `display:block;width:100%;max-width:${Math.min(w, 1400)}px`;
    el.appendChild(img);
    void h;
  };

  /**
   * THE GAME'S OWN LIGHT, finally.
   *
   * Source 2 bakes its global illumination — sun, sky, bounce, shadows — into
   * an HDR lightmap (`lightmaps/irradiance.vtex_c`, BC6H, which the CLI CAN
   * decode; only cube textures throw). The world export carries the matching
   * UVs in TEXCOORD_1. Albedo × irradiance is the difference between a scene
   * that looks like CS2 and the flat evenly-lit albedo drawn before, which
   * looked like nothing so much as a CS:GO-era map.
   */
  const irradiance = await new EXRLoader()
    .loadAsync(`./envsrc/${MAP}/lightmaps/irradiance.exr`)
    .catch(() => null);
  if (irradiance) {
    irradiance.channel = 1;
    irradiance.colorSpace = THREE.LinearSRGBColorSpace;
    irradiance.flipY = false;
    // A DataTexture cannot flip on upload, so `?lmflip=1` flips the pixel rows
    // themselves — the cheap way to test whether the lightmap's origin
    // disagrees with the UV set's.
    if (q.get("lmflip") === "1") {
      const img = irradiance.image as { data: Float32Array | Uint16Array; width: number; height: number };
      const row = img.width * 4;
      const tmp = new (img.data.constructor as new (n: number) => typeof img.data)(row);
      for (let y = 0; y < img.height >> 1; y++) {
        const a = y * row;
        const b = (img.height - 1 - y) * row;
        tmp.set(img.data.subarray(a, a + row));
        img.data.copyWithin(a, b, b + row);
        img.data.set(tmp, b);
      }
      irradiance.needsUpdate = true;
      line("lightmap rows flipped", "warn");
    }
  }
  /** `?lmdebug=1` draws ONLY the lightmap — white albedo — so its UV mapping
   *  can be judged without the colour maps confusing it. */
  const LM_DEBUG = q.get("lmdebug") === "1";
  line(irradiance ? "lightmap: irradiance.exr" : "lightmap: NONE — flat albedo", irradiance ? "pass" : "warn");

  const scene = new THREE.Scene();
  // A non-black clear, so "nothing rendered" and "the readback is broken" stop
  // looking the same: a black picture with a coloured ground means geometry;
  // a black picture with no ground means the render target.
  scene.background = new THREE.Color(0x2a1240);
  const t0 = performance.now();
  const gltf = await new GLTFLoader().loadAsync(`./envsrc/${MAP}/world.glb`);
  line(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`, "dim");

  /**
   * DOES THIS TEXTURE ACTUALLY HAVE HOLES IN IT?
   *
   * The export declares every material OPAQUE, so the cloud cards, the dust
   * sheets and the steam plumes all render as white solids — and no rule based
   * on NAMES can separate them from real scenery, because `dust_arch_small` is
   * an arch and `skybox_dust_hotel01` is a building. The texture itself is not
   * ambiguous: a card is mostly transparent and an arch is not. Each unique map
   * is drawn once into a 32x32 canvas and asked.
   */
  const cutoutCache = new Map<THREE.Texture, boolean>();
  /**
   * CUT OUT, OR FADED OUT — they need opposite treatment.
   *
   * A leaf mask is near-binary: a pixel is leaf or it is sky. Alpha-testing it
   * keeps the leaf crisp, which is right. A dust or steam sheet is the other
   * kind: smooth alpha all the way across, meant to be BLENDED. Alpha-testing
   * that turns every pixel above the threshold into solid white, which is what
   * has been draping white sheets across these scenes — the haze arrives as
   * opaque geometry.
   *
   * The texture says which it is: count how much of it sits in the middle of
   * the alpha range. Leaves have almost none there; haze is almost all of it.
   */
  const softCache = new Map<THREE.Texture, boolean>();
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = 32;
  const sctx = scratch.getContext("2d", { willReadFrequently: true })!;
  const isCutout = (tex: THREE.Texture | null | undefined) => {
    if (!tex?.image) return false;
    const hit = cutoutCache.get(tex);
    if (hit !== undefined) return hit;
    let holes = false;
    try {
      sctx.clearRect(0, 0, 32, 32);
      sctx.drawImage(tex.image as CanvasImageSource, 0, 0, 32, 32);
      const d = sctx.getImageData(0, 0, 32, 32).data;
      let clear = 0;
      let soft = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 250) clear++;
        // Neither opaque nor absent: the middle of the range is what separates
        // a HAZE sheet from a LEAF.
        if (d[i] > 25 && d[i] < 230) soft++;
      }
      holes = clear / 1024 > 0.05;
      softCache.set(tex, soft / 1024 > 0.22);
    } catch {
      /* a texture that cannot be read is treated as solid */
    }
    cutoutCache.set(tex, holes);
    return holes;
  };

  /**
   * A GIANT WHITE SURFACE IS NOT SCENERY.
   *
   * What survives the two rules above is a handful of fog and haze sheets whose
   * texture is opaque and almost pure white — the engine draws them additively
   * or not at all, the export says "solid white plane", and they read as snowy
   * hills wrapped round the horizon. Nothing in a map is both that big and that
   * white, so the pair of facts together is the test.
   */
  const flatCache = new Map<THREE.Texture, boolean>();
  const isFlat = (tex: THREE.Texture | null | undefined) => {
    if (!tex?.image) return false;
    const hit = flatCache.get(tex);
    if (hit !== undefined) return hit;
    let flat = false;
    try {
      sctx.clearRect(0, 0, 32, 32);
      sctx.drawImage(tex.image as CanvasImageSource, 0, 0, 32, 32);
      const d = sctx.getImageData(0, 0, 32, 32).data;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += l;
        sq += l * l;
      }
      const mean = sum / 1024;
      // Standard deviation in 0..255. Brick and sand sit well above 12; a shell
      // painted one colour sits near zero.
      flat = Math.sqrt(Math.max(0, sq / 1024 - mean * mean)) < 6;
    } catch {
      /* unreadable textures are left alone */
    }
    flatCache.set(tex, flat);
    return flat;
  };

  let meshes = 0;
  let dropped = 0;
  let cutouts = 0;
  let hazes = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    // BOTH SIDES. A room is modelled to be seen from inside, but plenty of a
    // map's geometry is single-sided shells meant to be viewed from one
    // direction only — from a point in the middle of the room, half of it would
    // otherwise be missing.
    // KEEP THE SHAPE. Wrapping a single material in an array to map over it
    // leaves the mesh with a one-element material ARRAY, and three only draws
    // an array of materials against geometry GROUPS — which these meshes do not
    // have. Every mesh then renders NOTHING while reporting itself visible with
    // a correct bounding sphere, and a wireframe probe in the same spot draws
    // fine. Convert one material at a time and put back what was there.
    const convert = (mat: THREE.Material) => {
    // NO FRUSTUM CULLING. These world nodes are exported as one mesh per
    // material with geometry spread across the whole map, and three culls on a
    // bounding SPHERE — a sphere around a scattered node sits nowhere near the
    // geometry it covers, so a camera standing inside the room gets the whole
    // world culled away. Drawing everything is fine for a one-off bake.
    m.frustumCulled = false;
      const src = mat as THREE.MeshStandardMaterial;
      if (LIT) {
        src.side = THREE.DoubleSide;
        return src;
      }
      // TRANSPARENCY THE EXPORT DROPPED. Mirage's vanity sky is twelve
      // kilometre-wide cloud cards on `nuke_clouds_001`, whose texture is a
      // `_trans_` map with a real alpha channel — and the glTF declares the
      // material OPAQUE. Rendered as written they are white sheets wrapped
      // round the scene, which is what "the sky bakes out blown white" was.
      // The engine knows these are cutouts from the material type; the export
      // does not carry it, so the filename is what is left to go on.
      // THE MATERIAL'S NAME, not the texture's URL: GLTFLoader decodes to an
      // ImageBitmap when the browser has `createImageBitmap`, and an
      // ImageBitmap has no `src` — so keying on the file path silently matched
      // nothing at all. glTF material names survive the export intact
      // (`nuke_clouds_001`, `steam_001`, `glass01`), and they are what the
      // engine's own material types are named after.
      const cutout = isCutout(src.map);
      if (cutout) cutouts++;
      const soft = cutout && (softCache.get(src.map!) ?? false);
      if (soft) hazes++;
      const hasLmUv = !!m.geometry.getAttribute("uv1");
      return new THREE.MeshBasicMaterial({
        map: src.map ?? null,
        // LIT BY THE GAME'S OWN BAKE — albedo × HDR irradiance on TEXCOORD_1,
        // which is the engine's own shading model for static geometry. Meshes
        // without the UV set (overlay decals, some props) keep flat albedo
        // dimmed toward the lightmap's mean so they sit in the same exposure
        // instead of glowing against it.
        lightMap: irradiance && hasLmUv ? irradiance : null,
        lightMapIntensity: 1,
        color: irradiance && !hasLmUv ? 0x9e9e9e : src.map ? 0xffffff : src.color ?? 0xffffff,
        ...(LM_DEBUG ? { map: null, color: hasLmUv ? 0xffffff : 0x220000 } : {}),
        side: THREE.DoubleSide,
        transparent: src.transparent || cutout,
        // Haze blends; leaves are tested. See `softCache`.
        alphaTest: soft ? 0 : cutout ? 0.35 : src.alphaTest,
        // Haze is thin: at full strength a stack of these still washes the
        // scene out, and in game they are barely there.
        opacity: soft ? 0.35 : 1,
        depthWrite: !cutout,
      });
    };
    // UNTEXTURED GEOMETRY IS NOT SCENERY. What is left after the maps are
    // resolved is glass panes, fog volumes and clip brushes — all of which the
    // engine draws as something other than a white solid, and none of which a
    // panorama wants. Dropping them costs nothing and takes the white shapes
    // out of the middle of the scene.
    const first = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (!first?.map) {
      m.visible = false;
      dropped++;
      return;
    }
    // A HUGE SURFACE WITH NO DETAIL IN IT IS A SHELL, NOT A BUILDING.
    //
    // What survives the no-texture rule is the sky shells and haze sheets: a
    // kilometre across, and painted with a texture that is one flat colour.
    // Office's is black, Mirage's is white, and either way it sits between the
    // camera and the sky that the scene's own harmonics are drawing — so the
    // panorama comes out with a solid lid on it.
    //
    // Flatness is the test rather than brightness, because "big and dark" is
    // also a description of a night map's buildings. A real texture — brick,
    // sand, concrete — has variance; a shell has none.
    m.geometry.computeBoundingSphere();
    const spanM = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld).radius;
    if (spanM > 80 && isFlat(first.map)) {
      m.visible = false;
      dropped++;
      return;
    }
    m.material = Array.isArray(m.material) ? m.material.map(convert) : convert(m.material);
  });
  // EVERY node visible, and count what was not. A mesh can be visible while an
  // ancestor is not — three skips the whole branch — and the per-mesh count
  // below would still say 201/201.
  let hidden = 0;
  gltf.scene.traverse((o) => {
    if (!o.visible) hidden++;
    o.visible = true;
  });
  if (entry?.sh && q.get("nosky") !== "1") {
    const dome = skyDome(entry.sh);
    dome.position.set(at[0], at[1], at[2]);
    scene.add(dome);
    line(`sky ${entry.sky} from 27 harmonics`, "pass");
  } else {
    line(`no sky harmonics for this scene`, "warn");
  }
  scene.add(gltf.scene);
  scene.updateMatrixWorld(true);
  line(`nodes that were hidden: ${hidden}`, hidden ? "warn" : "dim");
  // WHERE THE SCENE ACTUALLY IS. The marker comes out of the entity lump in
  // Source's Z-up inches and is converted on the way here; the glTF export has
  // its own idea of both. If the two disagree the camera ends up outside the
  // world (or inside a wall) and every face renders black — which is a much
  // harder thing to diagnose from a black picture than from these two lines.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  line(`${meshes} meshes — ${dropped} dropped (no texture), ${cutouts} cutouts of which ${hazes} blended as haze`, "dim");
  // WHAT THE MESHES ACTUALLY ARE. A scene that renders black has either no
  // material, a black one, or nothing visible — and those look identical from
  // the outside.
  {
    const sample: string[] = [];
    let withMap = 0;
    let visible = 0;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.visible) visible++;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshBasicMaterial;
      if (mat?.map) withMap++;
      if (sample.length < 3) {
        const p = new THREE.Vector3();
        m.getWorldPosition(p);
        sample.push(
          `${m.name || "(unnamed)"} ${mat?.type} map=${mat?.map ? "y" : "n"} ` +
            `color=#${mat?.color?.getHexString?.() ?? "?"} at ${p.toArray().map((n) => n.toFixed(0)).join(",")}`,
        );
      }
    });
    // WHERE THE GEOMETRY REALLY IS. The node sits at the origin but its
    // geometry does not, and the two are related by the node's matrix — so the
    // only number worth trusting is the bounding sphere pushed through it.
    {
      const first = gltf.scene.getObjectByProperty("isMesh", true) as THREE.Mesh;
      first.geometry.computeBoundingSphere();
      const world = first.geometry.boundingSphere!.clone().applyMatrix4(first.matrixWorld);
      const e = first.matrixWorld.elements.map((n) => +n.toFixed(3));
      line(`first mesh world sphere r=${world.radius.toFixed(0)} at ${world.center.toArray().map((n) => n.toFixed(0)).join(",")}`, "dim");
      line(`  matrixWorld ${e.slice(0, 4)} / ${e.slice(4, 8)} / ${e.slice(8, 12)} / ${e.slice(12)}`, "dim");
    }
    const g0 = (gltf.scene.getObjectByProperty("isMesh", true) as THREE.Mesh)?.geometry;
    g0?.computeBoundingSphere();
    line(
      `visible ${visible}/${meshes}, with a colour map ${withMap}, ` +
        `first sphere r=${g0?.boundingSphere?.radius?.toFixed(1)} at ${g0?.boundingSphere?.center.toArray().map((n) => n.toFixed(0)).join(",")}`,
      withMap ? "dim" : "fail",
    );
    for (const t of sample) line("  " + t, "dim");
    // THE BIGGEST THINGS IN THE SCENE, by their own world-space sphere. A sky
    // shell or a fog volume dwarfs the room it surrounds, so whatever paints
    // over everything shows up at the top of this list.
    const big: { r: number; name: string; mat: string }[] = [];
    gltf.scene.traverse((o) => {
      const m3 = o as THREE.Mesh;
      if (!m3.isMesh) return;
      m3.geometry.computeBoundingSphere();
      const w = m3.geometry.boundingSphere!.clone().applyMatrix4(m3.matrixWorld);
      const mm = (Array.isArray(m3.material) ? m3.material[0] : m3.material) as THREE.Material;
      big.push({ r: w.radius, name: m3.name, mat: mm?.name ?? "?" });
    });
    big.sort((a, b) => b.r - a.r);
    for (const b of big.slice(0, 6)) line(`  r=${b.r.toFixed(0)}m  mat=${b.mat}  (${b.name})`, "dim");
  }
  line(
    `bounds ${box.min.toArray().map((n) => n.toFixed(1)).join(",")} .. ` +
      `${box.max.toArray().map((n) => n.toFixed(1)).join(",")}  ` +
      `size ${size.toArray().map((n) => n.toFixed(1)).join(",")}  centre ${mid.toArray().map((n) => n.toFixed(1)).join(",")}`,
    "dim",
  );
  const inside = box.containsPoint(new THREE.Vector3(at[0], at[1], at[2]));
  line(`capture point is ${inside ? "INSIDE" : "OUTSIDE"} the world bounds`, inside ? "pass" : "fail");

  if (LIT) {
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x50423a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2df, 2.4);
    sun.position.set(-40, 60, 20);
    scene.add(sun);
  }

  /**
   * THE PLATE — the backdrop, rendered as a PICTURE.
   *
   * The panorama is the right shape for lighting and the wrong one for a
   * backdrop: the viewer only ever shows a ~42° slice of it, so a 4096-wide
   * equirect hands about 480 pixels to a 1400-pixel pane and the wall behind
   * the weapon comes out soft and blocky. A plate is that same view rendered
   * directly at the pane's own resolution, from the camera the GAME frames a
   * weapon with in this scene — position, angles and vertical FOV straight out
   * of `[PR#]cam_weapon_*_zoom`.
   *
   * Wider than the game's FOV on purpose: the viewer's backdrop is fixed while
   * the model turns, and a plate shot exactly at the camera's own angle has
   * nothing in reserve when the pane is wider than 16:9.
   */
  if (q.get("plate") === "1") {
    const cam = entry?.plate;
    const eye = new THREE.Vector3(...(cam?.at ?? at));
    const W = Number(q.get("pw") ?? 2560);
    const H = Math.round(W / (16 / 9));

    /**
     * WHICH WAY TO LOOK, MEASURED.
     *
     * The game's own `cam_weapon_*_zoom` is framed for an ITEM at 35 degrees,
     * often a metre from a wall — reproduced as a backdrop it is a close-up of
     * plaster, which is what "zoomed in and in weird positions" was. The scene
     * itself can answer the question instead: cast a ray every few degrees and
     * keep the direction with the most room in front of it.
     *
     * Openness alone would pick the emptiest corner, so the score is mean
     * distance × the spread of distances — a view with something near AND
     * something far has depth in it, which is what makes a backdrop read as a
     * place rather than a wall.
     */
    const ray = new THREE.Raycaster();
    ray.far = 120;
    const probe = (yaw: number) => {
      let sum = 0;
      let near = 1e9;
      let far = 0;
      let hits = 0;
      // A fan around the candidate direction, so a single gap between two
      // crates cannot win on one lucky ray.
      for (const dy of [-14, -7, 0, 7, 14]) {
        for (const pitch of [-6, 0, 6]) {
          const a = ((yaw + dy) * Math.PI) / 180;
          const p = (pitch * Math.PI) / 180;
          ray.set(eye, new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)));
          const hit = ray.intersectObject(gltf.scene, true)[0];
          const d = hit ? hit.distance : ray.far;
          sum += d;
          near = Math.min(near, d);
          far = Math.max(far, d);
          hits++;
        }
      }
      const mean = sum / hits;
      // A wall inside arm's reach disqualifies the direction outright.
      if (near < 1.6) return { yaw, score: 0, mean, near };
      return { yaw, score: mean * (1 + Math.min(far - near, 40) / 40), mean, near };
    };
    const scored = Array.from({ length: 48 }, (_, i) => probe(i * 7.5)).sort((a, b) => b.score - a.score);
    const best = scored[0];
    line(
      `best yaw ${best.yaw.toFixed(0)}° — mean ${best.mean.toFixed(1)}m, nearest ${best.near.toFixed(1)}m` +
        `  (worst was ${scored[scored.length - 1].mean.toFixed(1)}m)`,
      best.score > 0 ? "pass" : "fail",
    );

    // PULL BACK, as far as the room allows. Standing on the item marker puts
    // the camera in the middle of a small diorama; a couple of metres back
    // turns a close-up into a shot of a room. Never further than the wall
    // behind, hence the second cast.
    const a = (best.yaw * Math.PI) / 180;
    const fwd = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    ray.set(eye, fwd.clone().negate());
    const room = ray.intersectObject(gltf.scene, true)[0]?.distance ?? 5;
    const back = Math.max(0, Math.min(2.6, room - 0.8));
    eye.addScaledVector(fwd, -back);
    line(`pulled back ${back.toFixed(1)}m (wall behind at ${room.toFixed(1)}m)`, "dim");

    // 55°, not the game's 35: a backdrop wants context around the weapon, and
    // the weapon itself is drawn by the viewer, not by this.
    const persp = new THREE.PerspectiveCamera(55, W / H, 0.05, 5000);
    persp.position.copy(eye);
    persp.lookAt(eye.clone().addScaledVector(fwd, 10));
    renderer.setSize(W, H, false);
    renderer.render(scene, persp);
    line(`plate ${W}x${H} at 55° (scene camera was ${cam?.name ?? "none"})`, "pass");
    shot("plate", W, H, "image/jpeg", 0.9);
    line("done", "pass");
    return;
  }

  // A PLAIN VIEW FIRST, when asked. Bisecting a black panorama means knowing
  // whether the scene draws at all before blaming the cube or the projection.
  if (q.get("view") === "1") {
    const persp = new THREE.PerspectiveCamera(75, 2, 0.5, 20000);
    persp.position.set(at[0], at[1], at[2]);
    // NOT at the scene centre: the capture point is near it, and a degenerate
    // lookAt renders nothing — which reads exactly like a scene that failed.
    // AT THE GEOMETRY, not at an axis. The world box is polluted by a stray
    // node, so "look at the centre" aims into empty space; the first mesh's own
    // world-space sphere is a point the scene demonstrably occupies.
    const first = gltf.scene.getObjectByProperty("isMesh", true) as THREE.Mesh;
    first.geometry.computeBoundingSphere();
    const target = first.geometry.boundingSphere!.clone().applyMatrix4(first.matrixWorld).center;
    persp.lookAt(target);
    // A KNOWN OBJECT, to tell "the scene does not draw" from "nothing draws".
    // Wireframe so it cannot be mistaken for map geometry, and sized to the
    // room in metres.
    if (q.get("probe") === "1") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true }),
      );
      box.position.copy(target);
      scene.add(box);
      line(`probe box at ${target.toArray().map((n) => n.toFixed(1)).join(",")}`, "warn");
    }
    renderer.setSize(1024, 512, false);
    renderer.render(scene, persp);
    shot("plain view from the capture point", 1024, 512);
    line("done", "pass");
    return;
  }

  // The cube, from the marker.
  const cubeRT = new THREE.WebGLCubeRenderTarget(FACE, { generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.05, 500, cubeRT);
  cam.position.set(at[0], at[1], at[2]);
  scene.add(cam);
  cam.update(renderer, scene);

  // Cube → equirect, on the GPU. One full-screen triangle whose fragment shader
  // turns each pixel's lat/long into a direction and samples the cube.
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { tCube: { value: cubeRT.texture } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `
        varying vec2 vUv;
        uniform samplerCube tCube;
        void main() {
          // u across = longitude, v up = latitude. -pi..pi and -pi/2..pi/2.
          float lon = (vUv.x - 0.5) * 6.28318530718;
          float lat = (vUv.y - 0.5) * 3.14159265359;
          vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
          gl_FragColor = textureCube(tCube, dir);
        }`,
    }),
  );
  const flat = new THREE.Scene();
  flat.add(quad);
  const flatCam = new THREE.Camera();

  // Straight to the canvas at panorama size — see the note on the renderer for
  // why nothing here reads a render target back.
  renderer.setSize(OUT_W, OUT_W / 2, false);
  renderer.render(flat, flatCam);

  shot(`panorama ${OUT_W}x${OUT_W / 2}`, OUT_W, OUT_W / 2, "image/jpeg", 0.86);
  line("done", "pass");
}

void run().catch((e) => line(`ERROR ${(e as Error).message}`, "fail"));
