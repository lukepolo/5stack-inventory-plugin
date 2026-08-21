// Photograph the muzzle flash, because "it has a black box around it" needs a
// picture and not a theory.
//
// The flash was reported broken twice and reasoned about twice: the first fix
// derived the sprite's alpha from its luminance in `onBeforeCompile`, and it
// changed nothing on screen — because it wrote to `gl_FragColor` at a point in
// three's sprite shader where `gl_FragColor` has not been assigned yet, and
// `<opaque_fragment>` overwrites it one line later. A no-op that typechecks is
// indistinguishable from a fix that did not work, and that is exactly the kind
// of thing this rig exists to catch (see README).
//
// So: the REAL `buildMuzzleFlash`, on a dark ground, rendered four ways —
// plain, through the viewer's bloom composer, and the two blend modes on the
// bare texture as a control — and the material state printed alongside. What
// comes back is a picture of what the GPU did.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildMuzzleFlash } from "../../src/muzzleFlash";
import { viewmodelAssetUrl } from "../../src/viewmodelClip";

const W = 320;
const H = 240;
const el = document.getElementById("out")!;
const line = (t: string, cls = "") => {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = t;
  el.appendChild(d);
};
const shot = (canvas: HTMLCanvasElement, label: string) => {
  line(label, "dim");
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/png");
  img.style.cssText = "display:block;width:640px";
  el.appendChild(img);
};

/** A lit-ish ground so an OPAQUE black texel is obvious against it. */
function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a1240);
  // A big quad behind the flash: anything that draws black over it shows up as
  // a hole in a purple field, which is precisely the reported symptom.
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({ color: 0x5a2a80 }),
  );
  back.position.set(0, 0, -1);
  scene.add(back);
  return scene;
}

const camera = new THREE.PerspectiveCamera(50, W / H, 0.01, 100);
camera.position.set(0, 0, 1.2);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.75;

/** The muzzle: a bone-shaped stand-in at the origin, with a barrel behind it. */
function rig(scene: THREE.Scene) {
  const tip = new THREE.Object3D();
  tip.position.set(0, 0, 0);
  const barrel = new THREE.Object3D();
  barrel.position.set(0, 0, -0.4);
  scene.add(tip, barrel);
  scene.updateMatrixWorld(true);
  return { tip, barrel };
}

async function run() {
  line(`fx url: ${viewmodelAssetUrl("fx/muzzleflash1.png")}`, "dim");

  // Textures first — a sprite whose map has not arrived samples the renderer's
  // 1x1 default and draws BLACK, which would frame this whole investigation
  // around the wrong thing.
  const preload = ["muzzleflash1", "muzzleflash2", "smokesprites0001"].map(
    (n) =>
      new Promise<string>((res) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => res(`${n} ok ${img.width}x${img.height}`);
        img.onerror = () => res(`${n} FAILED TO LOAD`);
        img.src = viewmodelAssetUrl(`fx/${n}.png`);
      }),
  );
  for (const r of await Promise.all(preload)) line(r, /FAILED/.test(r) ? "fail" : "pass");

  for (const withBloom of [false, true]) {
    const scene = makeScene();
    const { tip, barrel } = rig(scene);
    const flash = buildMuzzleFlash(THREE, scene, tip, barrel, new THREE.Vector3(0, 1, 0));
    // WAIT FOR THE MAPS. A Sprite whose texture has not arrived samples the
    // renderer's 1x1 empty texture, which is transparent black — it renders as
    // nothing, and photographing that is how you conclude "the flash does not
    // draw" when the truth is "the flash was not loaded yet".
    await new Promise((r) => setTimeout(r, 2500));

    // Report what the material ACTUALLY carries — the additive-blending
    // assumption has never been checked against the object.
    scene.traverse((o) => {
      const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
      if (!(o as THREE.Sprite).isSprite || !m) return;
      line(
        `  sprite blending=${m.blending} (Additive=${THREE.AdditiveBlending}, Normal=${THREE.NormalBlending})` +
          ` transparent=${m.transparent} depthWrite=${m.depthWrite} opacity=${m.opacity}` +
          ` map=${m.map?.image ? `${m.map.image.width}x${m.map.image.height}` : "NO IMAGE"}`,
        m.blending === THREE.AdditiveBlending ? "dim" : "warn",
      );
    });

    let composer: EffectComposer | null = null;
    if (withBloom) {
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.6, 0.9);
      const cm = bloom.compositeMaterial as THREE.ShaderMaterial;
      cm.fragmentShader = cm.fragmentShader.replace(
        "vec4 texel = texture2D( tDiffuse, vUv );",
        "vec4 texel = texture2D( tDiffuse, vUv );float flLength = length(texel.rgb);" +
          "float flFactor = clamp(flLength * 10.0, 0.0, 1.0);texel.a = mix(0.0, texel.a, flFactor);",
      );
      cm.blending = THREE.AdditiveBlending;
      cm.depthTest = false;
      cm.depthWrite = false;
      cm.transparent = true;
      cm.needsUpdate = true;
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }

    flash.fire();
    // Two frames in: the burst is still near full and the smoke has moved
    // enough to be its own shape rather than sitting on top of it.
    flash.update(0.016);
    flash.update(0.016);
    if (composer) composer.render();
    else renderer.render(scene, camera);
    shot(renderer.domElement, withBloom ? "flash — through the bloom composer" : "flash — plain render");
    flash.dispose();
  }

  // CONTROLS: the bare texture, both ways, so the picture above can be read.
  for (const [label, blending] of [
    ["control — muzzleflash1, AdditiveBlending", THREE.AdditiveBlending],
    ["control — muzzleflash1, NormalBlending", THREE.NormalBlending],
  ] as const) {
    const scene = makeScene();
    const tex = new THREE.TextureLoader().load(viewmodelAssetUrl("fx/muzzleflash1.png"));
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending, transparent: true, depthWrite: false }));
    s.scale.setScalar(0.5);
    scene.add(s);
    await new Promise((r) => setTimeout(r, 2500));
    renderer.render(scene, camera);
    shot(renderer.domElement, label);
  }
  line("done", "pass");
}

void run().catch((e) => line(`ERROR ${(e as Error).message}`, "fail"));
