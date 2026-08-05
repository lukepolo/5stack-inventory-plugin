# Charm | Butane Buddy — liquid charm handover

**Status: renders, does not match.** The structure is right (level, waterline,
colour direction, gloss). The *character* of the reference render — hard
speculars, visible bubbles, a metallic casing — is not there. Four consecutive
attempts to close that by transcribing more shader terms each produced a
correct-but-invisible change. **Read "Why it is not converging" before adding a
fifth.**

Item: cs2-lib id **14312**, model stem `kc_db_lighter`, craft URL
`/apps/inventory/craft/14312`.
Reference: <https://csgoskins.gg/items/charm-butane-buddy> (real-time 3D, and its
own WebGL shaders are readable in the page — diff against those, it is cheaper
than another .vcs decompile).

---

## 1. What this charm is

The ONLY charm in the catalog on `csgo_simple_liquid.vfx` (surveyed all 81 `kc_*`
GLBs: 58 `csgo_weapon.vfx`, 1 liquid, 22 are shared-blank community charms that
404 by design). Its albedo is the EMPTY glass — pale teal — so every red pixel
comes from shader params, not texture.

Three prims over one vertex pool, **disjoint index subsets, not copies**:

| prim | material | z range | what it is |
|---|---|---|---|
| 0 | `kc_db_chain` (csgo_weapon) | −0.54 … +0.12 | the ring |
| 1 | `kc_db_lighter_02` (liquid) | −1.35 … −0.09 | the LIGHTER CASING (asymmetric in x) |
| 2 | `kc_db_lighter` (liquid, `F_OPAQUE_REFRACT`) | −1.89 … −0.37 | the VESSEL (sphere + feet) |

Both liquid materials are real surfaces. Hiding the non-refracting one deletes
the lid — do not try it.

**The pattern is real**: `g_flLiquidColorHueShift = lerp(0, 320, seed)` (full hue
sweep) and `g_flLiquidLevelHeight = lerp(0.45, 0.8, frac(seed*100))` (fill
level). Both are in `HONOURED` in `charmMaterial.ts` or the rail calls the charm
pattern-inert and hides the whole craft panel.

---

## 2. Ground truth

Decompiles in `tools/shadertest/groundtruth/`:
`liquid_outer_combo12.glsl` (S_OPAQUE_REFRACT + S_USE_TEST_VALUES),
`liquid_inner_combo8.glsl`, `liquid_vs_combo4.glsl`.

The program is `shaders/vfx/csgo_simple_liquid_vulkan_50_ps.vcs`, **archive 1,
offset 73492960, length 753297**, VCS 71, in the FULL tree at
`/cs2-game/game/csgo/` (not the dedicated-server pack). Only 5 features, 24
combos: S_FOAM(1) S_NO_LIQUID(2) S_OPAQUE_REFRACT(4) S_USE_TEST_VALUES(8)
S_MODE_TOOLS_VIS(16). Vertex program: archive 1, offset 74248112, length 31998.

**Decompile the vertex program too.** The varyings are unguessable from the pixel
shader, and the level test is meaningless without them: `input_0` = objectPos −
centreOffset, `input_1` = centre × boneTransform, `input_3` = model +Z in world,
`input_4` = gravity (world), `input_2` = wrapped time.

Source assets (pak01, for channels the glTF export drops):
`kc_db_lighter_normal_png_4b485ec8.vtex_c` archive 293 offset 69564288 len 4616174;
mask `..._mask_png_3437f46d.vtex_c` archive 293 offset 67813280 len 1750998;
vmats `kc_db_lighter.vmat_c` archive 293 offset 66485360 len 4947 and
`_02.vmat_c` offset 66490320 len 4739.

---

## 3. Tooling — use these, they are fast now

**Scoped extraction (2 seconds, not 30 minutes):**

```sh
ONLY_STEPS=charm-models ./scripts/extract-models.sh   # ~1s, ALL charm params
```

Only touch the paint chain when a NEW TEXTURE must be pulled; parameter changes
land through `charm-models` alone. Safe as of 2026-08-05 via one `PARTIAL_RUN`
flag: a scoped run does **not** prune (it cannot know what the skipped steps
would have referenced — that is what took the live mount from ~16,800 textures to
262 and rendered every skin white) and does **not** stamp `extract-version.json`.

**Rig** (`npx vite --config tools/shadertest/vite.config.ts --port 5241`):

```js
const t = await resolveViewerModel({ type:'keychain', image:'/images/kc_db_lighter_d10214d2.webp' });
const h = await mountViewer(host, t.model, { kind:t.kind, charmSpec:t.charm, seed:1, still:true, frame:'fit' });
const blob = await h.snapshot();
```

`item3d.html?image=…` mounts it and **logs the camera** (`camPos`, `target`) —
use that instead of trying to read view vectors out of pixels.

**Probes**: `liquidProbe.mode` in `charmLiquid.ts`. 1 = sign of `d`, 2 = height,
3 = coverage, 4 = up axis, 6 = vdg, 7 = thickness, 8 = view dir, 10 = `lqC`,
20 = specular killed, 21 = bubble coverage. **99 = stash only** — no probe GLSL,
but populates `globalThis.__lqMats` / `__lqTick` so you can read live uniforms
out of a render that is still honest.

---

## 4. Implemented and verified

- **Level / waterline.** Vessel spans −0.587…+0.926 around the liquid centre,
  surface at +0.0206 → 40% submerged (reference ~45%). Coverage measured 0.10
  above the line, 0.96 below.
- **Colour direction.** Glass matches the icon closely (linear G/R 1.14 vs 1.15).
  Liquid after dropping the glass tint under it: sRGB (208,73,109) vs icon
  (217,81,95); linear B/R 0.242 vs 0.168 (was 0.458).
- **Wobble** (`csLiquidWobble`) — eight `exp(sin(dot()))` octaves, screen-aligned
  frame, model-scale corrected. Verified: waterline profile differs at t=0/1.7/3.4.
- **Gloss** — `GLASS_ROUGHNESS`, and `liquid.roughMap` from extraction v24.
- **Animation** (`tickCharmLiquid`) — surface stays level while the charm tips
  (rest orientation calibrated out; 25° tilt → 24.88° counter-rotation), plus a
  resting agitation of 0.55 so it moves without the sway.

---

## 5. What is NOT working

1. **Bubbles are invisible.** They compute — 42% of the vessel has non-zero
   coverage — but `lqBub.a` peaks ~0.18 and the normal displacement works out to
   a fraction of a pixel. `g_flBubbleStrength` (10.0) is now wired to the NORMAL
   (it is not a colour term — that was a real bug), and it still does not read.
2. **Metallic casing.** Theirs is brass/steel with hard speculars, ours is flat
   white. **This is the largest single visual difference and it has never been
   attempted.** `kc_db_lighter_02` has no metalness input; it likely needs the
   same dropped-channel treatment the roughness got.
3. **Colour ~1.4× heavy in blue** (linear), bounded by the missing refraction.
4. **No refraction at all** — `F_OPAQUE_REFRACT`, the cube-refract terms and the
   liquid's own specular add are unimplemented; they need a scene buffer the
   viewer does not render.

---

## 6. Why it is not converging — read this first

Four rounds (roughness, bubbles, resting agitation, bubbleStrength) were each
correctly transcribed, each verified by measurement, and each visually
negligible. That pattern says the assumption "transcribe every term and it will
converge" is **wrong**. Two structural candidates, neither investigated:

- **Their agitation may be far higher than anything we feed.** Every invisible
  term scales on agitation, some to the FOURTH power (`(a²+0.01)²` — measured
  surface motion: a=0.4 → 2px, 0.7 → 7px, 1.0 → 30px). One wrong global would
  suppress wobble, bubbles and displacement simultaneously — exactly the symptom.
- **Their environment/lighting may be doing most of the work.** Their glass has
  hard speculars and real reflections; ours has a soft sheen. That is an
  IBL/exposure difference, not a shader-term difference, and no amount of
  transcribing liquid terms will close it. Compare envMapIntensity and the
  environment against theirs BEFORE adding another term.

**Recommended order:** (a) metallic casing — biggest visible win, never tried;
(b) environment/exposure comparison against csgoskins; (c) only then more liquid
terms.

---

## 7. Ruled out — do not re-try

- **`inspect` pose clip** — does not close the lighter's lid, and breaks the
  level test (it measures on the bind pose while the mesh draws posed).
- **`kc_db_lighter_inspect.vmdl_c`** — the only charm of 62 with a second model,
  and it is NOT a closed-lid or animated variant: identical node poses, 32 bytes
  different, same single-keyframe clip.
- **Two coincident liquid passes** — the prims are disjoint parts (§1).
- **Measuring the level along world up** — this viewer does not hang a charm with
  its model axis on world up. World up gives a VERTICAL waterline; world up
  rescaled floods it. The model's own +Z is the only frame that works.
- **A hue difference explaining the colour** — 15° matches blue and overshoots
  green. It is not a pattern mismatch.
- **Specular energy-limiting** — moved the ratios 2%; its justification came from
  a linear-vs-sRGB error (below). Reverted.

---

## 8. Measurement traps that cost this session the most

- **Never compare a derived LINEAR value against a screenshot.** `lqC` works out
  to linear (1.585, 0.161, 0.377) → G/R 0.10; measured off the render it read
  0.46. sRGB-encode the derived value first and they agree. This produced a whole
  wrong theory and a wrong fix. Decode BOTH sides — the reference icon is an sRGB
  PNG too.
- **A probe referencing an out-of-scope variable fails to COMPILE**, three logs
  it and keeps drawing with a fallback, and you read garbage. Check the console
  after every probe change.
- **A CDP-driven tab is `document.hidden`** → rAF fires once. Anything animated
  looks frozen and the render loop appears dead.
- **Measure inside the region that matters.** The roughness channel was written
  off as constant because it was measured globally; inside the liquid mask the
  authored data is obvious. Same mistake gated the bubbles.
- **VRF rearranges channels.** Its glTF export writes RGB only, and its own vtex
  decode rebuilds blue as the octahedral Z. `g_tNormalA.z` in the shader is the
  ROUGHNESS; in our decode that data lives in ALPHA (p10 0.15, median 0.33, p90
  0.56). Extraction v24 pulls it as `liquid.roughMap`; the client samples `.a`.

---

## 9. Files

`src/charmLiquid.ts` (shader, tick, probes) · `src/charmMaterial.ts` (tune,
mask/rough loading) · `src/viewer3d.ts` (`stepCharmIdle`, `stepCharmLiquid`,
`charmAlbedoTile`) · `src/components/PatternRail.vue` (liquid swatch) ·
`scripts/extract-models.sh` §3e (params, roughMap, bubble params) ·
`backend/src/stickerMarkup.ts` (passthrough).

Related: `DEBUGGING-SKINS.md` (the general playbook), `CHARM-PHYSICS.md`.
