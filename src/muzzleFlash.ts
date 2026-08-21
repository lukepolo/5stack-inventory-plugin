// Muzzle flash and smoke for the first-person fire action.
//
// Built from CS2's own particle textures, decompiled from the VPK alongside the
// animations and served from /anims/fx/:
//
//   muzzleflash1     materials/effects/      the orange burst
//   muzzleflash2     materials/effects/      the white-hot core
//   smokesprites0001 materials/particle/     a grey puff
//
// The game composes these through its particle system (.vpcf), which is a whole
// authoring format and not worth reading back for this. What an inspect needs is
// the LOOK: a burst and a core for two or three frames, a point-light spike, and
// a couple of smoke puffs that drift off the muzzle and thin out. That is what
// this is.
//
// WORLD SPACE, NOT A CHILD OF THE MUZZLE BONE. `wpnTip` lives in the glove
// skeleton's inch space under a 0.0254 root, so a sprite parented there would
// have to be sized in inches and would inherit the barrel's roll. Sized in
// metres at the scene root and moved to the bone's world position every frame,
// it follows the recoil and nothing else.
import { viewmodelAssetUrl } from "./viewmodelClip";

type Three = typeof import("three");
type Obj = import("three").Object3D;

export interface MuzzleFlash {
  /** One shot. Safe to call again before the last one is done. */
  fire: () => void;
  /** Advance the effect. Cheap when idle: a couple of branches. */
  update: (dt: number) => void;
  dispose: () => void;
}

/** How long the flash itself lives — two to four frames, as in game. */
const FLASH_LIFE = 0.07;
/** The light outlasts the sprite a touch so the glow reads on the hands. */
const LIGHT_LIFE = 0.1;
const SMOKE_LIFE = 0.9;
/** Two puffs a shot; six lets three shots overlap before a puff is reused. */
const SMOKE_POOL = 6;

export function buildMuzzleFlash(
  THREE: Three,
  scene: Obj,
  /** The muzzle — the clip's `wpnTip`. */
  tip: Obj,
  /** Somewhere back along the barrel — the clip's `wpn` — for the direction. */
  barrel: Obj | null,
  /** Which way is up in this rig, for the smoke to rise along. */
  up: import("three").Vector3,
): MuzzleFlash {
  const loader = new THREE.TextureLoader();
  const tex = (name: string) => {
    const t = loader.load(viewmodelAssetUrl(`fx/${name}.png`));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const burstTex = tex("muzzleflash1");
  const coreTex = tex("muzzleflash2");
  const smokeTex = tex("smokesprites0001");

  const sprite = (map: import("three").Texture, extra: ConstructorParameters<Three["SpriteMaterial"]>[0]) =>
    new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, ...extra }));

  /**
   * THE BLACK BOX, and why an additive sprite can still draw one.
   *
   * The textures carry no usable alpha — measured, not assumed:
   *
   *   muzzleflash1   alpha = 255 on EVERY texel; the flash is in RGB, on black
   *   muzzleflash2   alpha ~= 3 where the core is brightest, i.e. inverted
   *
   * They are authored for an additive particle, where black adds nothing and
   * alpha is never read. And the COLOUR is fine: additive blending does exactly
   * that, which is why the flash looks right against anything the scene itself
   * drew — a rig that renders this on an opaque background shows no box at all.
   *
   * THE BOX IS IN THE ALPHA CHANNEL, which is why it survived being "additive".
   * Our canvas is TRANSPARENT — the purple behind the viewer is the page, not
   * the scene — and `blendFunc(SRC_ALPHA, ONE)` is one function for all four
   * channels, so the alpha channel accumulates too. With the texture's alpha at
   * 1 across the whole quad, every texel of the black surround writes coverage
   * into a canvas that was transparent there: RGB 0, alpha 1, which the browser
   * composites over the page as a solid black square. Render the same sprite
   * over an OPAQUE background and there is no box at all, which is exactly why
   * this went round twice — see tools/shadertest/flash.html, where it does not
   * reproduce, and fpv.html, where it does.
   *
   * WRITE TO `diffuseColor`, NOT `gl_FragColor`. The first attempt at this
   * patched `gl_FragColor.a` at the `<alphatest_fragment>` line — but three's
   * sprite shader only assigns `gl_FragColor` later, in `<opaque_fragment>`,
   * which overwrote it. It typechecked, it shipped, and it changed nothing.
   */
  const alphaFromLuma = (m: import("three").SpriteMaterial) => {
    /**
     * COLOUR AND COVERAGE, BLENDED SEPARATELY.
     *
     * `AdditiveBlending` is `blendFunc(SRC_ALPHA, ONE)` — ONE function for both
     * channels — so gating the alpha would also scale the colour by it and the
     * flash would lose most of its glow. What this wants is the particle's
     * bargain: add the colour whole, claim coverage only where there is light.
     *
     *   colour  ONE, ONE            the flash adds as authored
     *   alpha   ONE, ONE  × luma    the black surround adds nothing
     *
     * With the colour term no longer multiplied by alpha, `material.opacity`
     * would stop fading the flash out — so the shader applies it to RGB too,
     * which is the fade the update loop is driving.
     */
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquationAlpha = THREE.AddEquation;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.onBeforeCompile = (shader) => {
      const marker = "#include <alphamap_fragment>";
      if (!shader.fragmentShader.includes(marker)) {
        // Loud, because a silent miss here is invisible until someone reports
        // the box again months later.
        console.warn("[muzzleFlash] sprite shader has no <alphamap_fragment> — alpha gate not applied");
        return;
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        marker,
        `${marker}
	diffuseColor.rgb *= opacity;
	diffuseColor.a *= clamp(max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) * 1.35, 0.0, 1.0);`,
      );
    };
    return m;
  };

  const burst = sprite(burstTex, { color: 0xffc58a });
  const core = sprite(coreTex, { color: 0xffe9c4 });
  alphaFromLuma(burst.material);
  alphaFromLuma(core.material);
  const light = new THREE.PointLight(0xffa552, 0, 2.0, 2);
  for (const o of [burst, core]) {
    o.visible = false;
    o.renderOrder = 1000;
    scene.add(o);
  }
  scene.add(light);

  interface Puff {
    sprite: import("three").Sprite;
    age: number;
    vel: import("three").Vector3;
    spin: number;
  }
  const puffs: Puff[] = [];
  for (let i = 0; i < SMOKE_POOL; i++) {
    const s = sprite(smokeTex, { blending: THREE.NormalBlending, color: 0xcfd2d6, opacity: 0 });
    s.visible = false;
    s.renderOrder = 999;
    scene.add(s);
    puffs.push({ sprite: s, age: Infinity, vel: new THREE.Vector3(), spin: 0 });
  }

  const tipPos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let flashAge = Infinity;

  const readTip = () => {
    tip.updateMatrixWorld(true);
    tipPos.setFromMatrixPosition(tip.matrixWorld);
    if (barrel) {
      barrel.updateMatrixWorld(true);
      dir.copy(tipPos).sub(tmp.setFromMatrixPosition(barrel.matrixWorld)).normalize();
    } else dir.set(0, 0, 1);
  };

  const fire = () => {
    readTip();
    flashAge = 0;
    // A little variation per shot — the game's flash is never the same twice.
    const k = 0.85 + Math.random() * 0.4;
    burst.scale.setScalar(0.26 * k);
    burst.material.rotation = Math.random() * Math.PI * 2;
    core.scale.setScalar(0.14 * k);
    core.material.rotation = Math.random() * Math.PI * 2;
    burst.position.copy(tipPos).addScaledVector(dir, 0.03);
    core.position.copy(tipPos).addScaledVector(dir, 0.01);
    burst.visible = core.visible = true;
    light.position.copy(tipPos).addScaledVector(dir, 0.05);
    light.intensity = 4;
    for (let n = 0; n < 2; n++) {
      // Reuse the oldest puff; unused ones sit at age Infinity and go first.
      const p = puffs.reduce((a, b) => (a.age >= b.age ? a : b));
      p.age = 0;
      p.sprite.position.copy(tipPos).addScaledVector(dir, 0.06 + n * 0.04);
      p.vel
        .copy(dir)
        .multiplyScalar(0.55 + Math.random() * 0.25)
        .addScaledVector(up, 0.2 + Math.random() * 0.1);
      p.vel.x += (Math.random() - 0.5) * 0.1;
      p.vel.y += (Math.random() - 0.5) * 0.1;
      p.vel.z += (Math.random() - 0.5) * 0.1;
      p.spin = (Math.random() - 0.5) * 1.5;
      p.sprite.material.rotation = Math.random() * Math.PI * 2;
      p.sprite.scale.setScalar(0.12);
      p.sprite.material.opacity = 0;
      p.sprite.visible = true;
    }
  };

  const update = (dt: number) => {
    if (flashAge < LIGHT_LIFE) {
      flashAge += dt;
      readTip();
      const f = Math.max(0, 1 - flashAge / FLASH_LIFE);
      burst.material.opacity = f;
      core.material.opacity = f * f;
      burst.position.copy(tipPos).addScaledVector(dir, 0.03);
      core.position.copy(tipPos).addScaledVector(dir, 0.01);
      if (f <= 0) burst.visible = core.visible = false;
      light.intensity = 4 * Math.max(0, 1 - flashAge / LIGHT_LIFE);
      light.position.copy(tipPos).addScaledVector(dir, 0.05);
    }
    for (const p of puffs) {
      if (p.age >= SMOKE_LIFE) {
        if (p.sprite.visible) p.sprite.visible = false;
        continue;
      }
      p.age += dt;
      const u = Math.min(1, p.age / SMOKE_LIFE);
      p.sprite.position.addScaledVector(p.vel, dt);
      // Drag: the puff leaves the muzzle fast and hangs.
      p.vel.multiplyScalar(Math.pow(0.15, dt));
      p.sprite.scale.setScalar(0.12 + u * 0.35);
      // In fast, out slow.
      p.sprite.material.opacity = 0.55 * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
      p.sprite.material.rotation += p.spin * dt;
    }
  };

  const dispose = () => {
    for (const o of [burst, core, light, ...puffs.map((p) => p.sprite)]) o.removeFromParent();
    for (const m of [burst.material, core.material, ...puffs.map((p) => p.sprite.material)]) m.dispose();
    burstTex.dispose();
    coreTex.dispose();
    smokeTex.dispose();
  };

  return { fire, update, dispose };
}
