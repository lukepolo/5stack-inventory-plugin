# Charm | Butane Buddy — liquid charm handover

**Status: renders, refraction landed, still does not fully match.** The structure
is right (level, waterline, colour direction, gloss), and as of 2026-08-05 the
cube refraction and the liquid's own hard specular are implemented — the first
change in this effort that is measurably visible (mean |Δ| 62.6/px over the
charm's silhouette, max 297, against an identical-camera baseline).

**The thing that unblocked it was deleting a wrong belief, not adding a term.**
This file used to say refraction needed "a scene buffer the viewer does not
render". It does not: the game refracts against a CUBEMAP. Four rounds of
chasing smaller terms happened downstream of that one sentence. §5 and §6 have
been rewritten; the old "metallic casing is a dropped channel" lead was also
wrong and is retired below.

Item: cs2-lib id **14312**, model stem `kc_db_lighter`, craft URL
`/apps/inventory/craft/14312`.

## 0. The reference, and how to read it — do this FIRST

<https://csgoskins.gg/items/charm-butane-buddy>. Their viewer is an INDEPENDENT
port of the same Valve shader, and it has already answered more open questions
here than any amount of re-reading the decompile.

**A plain `curl` gets the page; a headless Chrome gets a Cloudflare challenge.**
Do not try to get around the challenge — you do not need to. Everything is in the
server-rendered HTML and two public bundles:

```sh
curl -s https://csgoskins.gg/items/charm-butane-buddy -o /tmp/cs.html
# the whole material description, inline, as JSON:
grep -o 'const viewerData = .*' /tmp/cs.html
# their renderer, named in a meta tag:
grep -o '<meta name="skin-viewer-script"[^>]*>' /tmp/cs.html
```

Two artifacts came out of it, both saved:

- **`groundtruth/csgoskins_simple_liquid.glsl`** — their port of the fragment and
  vertex halves, with the temporaries NAMED. Valve's own decompile
  (`liquid_outer_combo12.glsl`) stays authoritative for the maths; this is
  authoritative for nothing, but it is a second opinion from someone who shipped
  a version that looks right, and it is far easier to read.
- **Their resolved params.** `viewerData.static.materials[].material` is the vmat
  as they parsed it. Diffed against our `charm-shading.json`: **87 of 90 agree
  exactly.** The three that differ are all seed-driven and all confirm our
  expression maths — theirs are resolved at the preview seed, ours are the
  pre-resolve constants:

  | param | theirs (resolved) | ours (authored) | check |
  |---|---|---|---|
  | `g_flLiquidColorHueShift` | 0.0032 | 180 | `lerp(0, 320, 1/100000)` = 0.0032 ✓ |
  | `g_flLiquidLevelHeight` | 0.45035 | 0.761 | `lerp(0.45, 0.8, frac(1e-5·100))` = 0.45035 ✓ |
  | `g_flTestAgitation` | 0.375 | 0.0 | the attribute we cannot decode |

  That is a free, camera-independent validation of the entire extraction chain,
  and it is repeatable for any item they carry.

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
codepier exec --deployment inventory-backend -- bash -c \
  'cd /app && OUT_DIR=/cs2-models ONLY_STEPS=charm-models ./scripts/extract-models.sh'
```

**`OUT_DIR=/cs2-models` IS REQUIRED and its absence is silent.** Without it the
script writes to `$WORK` and tars the result up, reports every step as a success,
and the live mount is untouched — the params simply never appear in
`charm-shading.json` and the client falls back to its defaults, which for a new
param means "authored 0", which means "the term does nothing". That reads exactly
like a shader bug. Always confirm the mount afterwards:

```sh
codepier exec --deployment inventory-backend -- \
  python3 -c "import json;d=json.load(open('/cs2-models/models/charm-shading.json'));print(d['kc_db_lighter']['liquid'])"
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

**Probes**: `item3d.html?…&lqprobe=N` (`liquidProbe.mode` in `charmLiquid.ts`).
1 = sign of `d`, 2 = height, 3 = coverage, 4 = up axis, 6 = vdg, 7 = thickness,
8 = view dir, 10 = `lqC`, 20 = specular killed, 21 = bubble coverage,
**30 = the cube-refract term alone, 31 = the specular alone, 32 = refracted
direction, 33 = refraction roughness, 34 = sun alignment (green = the specular
can fire, red = it never will)**. **99 = stash only** — no probe GLSL, but
populates `globalThis.__lqMats` / `__lqTick` so you can read live uniforms out of
a render that is still honest.

The URL parameter is new. The mode is read when the shader is PATCHED, so it has
to be set before anything mounts — which is why setting it from a console handle
after the fact never worked, and why these probes went unused for as long as they
did.

**Probe 34 is the one that earns its keep.** A specular that renders black has two
completely different causes — the lobe is off-camera, or the sun is on the wrong
side — and they are the same picture. It was the second: three's
`directionalLights[].direction` points TOWARD the light, Source's sun vector is
the direction light TRAVELS. Probe 34 rendered the charm solid red, which is not
"narrow", it is "unreachable at any angle". One negation fixed it. Guessing would
have been a coin flip.

**Headless renders without the Chrome extension.** The rig is plain vite plus a
page, so a ~60-line CDP driver over `node`'s built-in `WebSocket` is enough to
load `item3d.html`, wait, and pull the `<img>` back as a PNG. Chrome needs
`--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`
or there is no WebGL context and every render comes back blank.

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
- **Cube refraction + the liquid's own specular** (2026-08-05, `CHARM_LIQUID_REFRACT`
  in charmLiquid.ts, injected at `<lights_fragment_end>`). Params extracted in §3e
  (`glassRefraction`, `liquidRefraction`, `surfaceRefraction`, `refractRoughMul`,
  `cubeTransparency`, `cubeLiquidTransparency`, `cubeBrightness`, plus reflectance /
  specular strengths / transmissive / emissive, extracted but not yet consumed).
  Verified against an identical-camera baseline: mean |Δ| **62.6** per pixel over
  the silhouette, max 297, mean sRGB 167,128,143 → 177,136,149.

  Two deliberate deviations, documented at the code: no AABB parallax correction
  (RoomEnvironment is one infinite probe), and three's lights in three's units.

  The **energy-limit ratio IS implemented** (three's `irradiance + iblIrradiance`
  standing in for Valve's probe irradiance, the env sample for its average), and
  **it is inert here — measured, not assumed.** Adding it changed exactly 4
  pixels: under RoomEnvironment the local irradiance is already >= the env
  radiance, so `min(ratio, 1.0)` is 1.0 across the whole charm. Kept because it is
  in the ground truth and would bite in a darker environment; do NOT expect it to
  do anything in this one, and do not re-try it as a fix for brightness — that
  hypothesis was tested and was wrong.
- **The mask gate.** `csLiquidSample` used to read the mask only when `uLqD.w > 0.5`
  — and `uLqD.w` is the live AGITATION, not a "mask is bound" flag. `csCharmMask()`
  self-gates on `uCharmMask.x`, so the test was both redundant and wrong: every
  frame before the first `tickCharmLiquid` flooded the whole material.

---

## 5. What is NOT working

1. **Bubbles — four real bugs fixed, still not visible. The remaining gap is NOT
   in `csLiquidBubbles`; read this before touching it.**

   Fixed, all four genuine and all verified by measurement:
   - `a^18` instead of `a^9` (`pow(a,9)` was fed `agitationBase = a*a + 0.01`)
   - the resting agitation never reached a still render (`tickCharmLiquid` needs a
     live loop, so bakes and previews used the authored `0.0`; `0^9` is 0)
   - the cell frequency was OUTSIDE `fract()` — no lattice frequency at all
   - **the lattice was not GRAVITY-ALIGNED.** The shader builds a screen-space
     frame from gravity — `x = dot(offset, cross(viewGravityDir2D, vec3(0,0,1)))`,
     `y = dot(offset, viewGravityDir2D)` — so the layers' scroll runs along the
     gravity axis and the bubbles RISE. Ours used raw view x/y, so they scrolled
     along screen-up regardless of which way was down, which reads as drifting
     sideways across the liquid the moment the charm tips or the camera orbits.
   - **`input_11.y * 0.25` was missing.** Their port opens with
     `#define input_11 vec4(1.0)` — they hit the same absent COLOR_0 we do (our
     GLB carries POSITION/TEXCOORD_0/NORMAL/TANGENT/JOINTS_0/WEIGHTS_0 and no
     vertex colour) and answer it with a constant. It dominates at rest because
     `agitationBubbles` is a ninth power: `mix(0.1,0.4,0.040)` = 0.112 versus
     `mix(0.1,0.4,0.290)` = 0.187.

   Coverage of the vessel went **0.78% -> 2.69%** (peak 38 -> 74). At their fresh
   agitation of 0.9 it reaches **7.25%** (peak 119).

   **And the lit render still barely moves** — 32 changed pixels at 0.7, and the
   2540 at 0.9 are the WATERLINE rippling harder, not bubbles appearing. The
   arithmetic says why, and it says the same about their shader:

   ```
   lqBub.a at a full disc = cover * size          = 0.084
     colour path: mix(1, tint*4, 0.084)           <= 8% shift
     normal path: |disp| ~ r^3*a*size = 0.017,
                  x bubbleStrength 10             = 0.168 on a unit normal
   ```

   Both consumption paths are inherently weak, and theirs computes the identical
   products (`_19498 = (cover) * flBubbleAlpha`, mixed by
   `saturate(opacity * _19498 * front)`). **The procedural bubbles are a subtle
   effect in the game too** — this was the file's original conclusion and it
   survived everything since.

   **They ARE visible now, and the remaining complaint is that they are too
   faint.** That is consistent with everything above: both consumption paths are
   weak BY DESIGN and ours already computes the same products theirs does. The
   one amplifier they have and we do not is **BLOOM** (`enableBloom: 'auto'` in
   their options) — a post pass would turn the small bright specular dots the
   perturbed normals produce into visible glowing bubbles. It is a renderer
   feature rather than a shader fix.

   **UPDATE: bloom shipped, so this is now a testable claim rather than a plan.**
   See "Bloom is ON by default" below — UnrealBloomPass at strength 0.05,
   threshold 0.18. The prediction to check is specific: the bubbles should read as
   glowing rather than merely present, and turning bloom off with `?bloom=0`
   should visibly kill them again. Nobody has looked yet. Do NOT write more shader
   code for the bubbles until someone has, because if bloom already closed it then
   the per-fragment jitter below is the only real gap left, and if it did not then
   the weakness is somewhere neither this note nor the bloom section predicted.

   Lighting presets (`src/viewerEnvironments.ts`) give the check a sharper tool
   than bloom alone: the **Dark** rig strips the fill light, which is exactly the
   condition under which a faint specular dot either survives as a glow or
   disappears. Compare Dark against Studio on this charm before touching the
   shader.

   Separately still missing, a minor one: their base coordinate adds
   `(normal.xy - 0.5) * 0.25`, a per-fragment jitter that breaks up the lattice.

   **The other visible mottling is `g_tNormalA`'s surface detail lit by the
   environment**, not bubbles: it appears on the FEET and on the GLASS ABOVE THE
   WATERLINE, where liquid coverage is zero. `g_tColorA` was checked and ruled out
   too — at 4x contrast over the vessel's UV region it is nearly flat teal.

   **Do not re-try:** scaling the lattice into inches (x39.37). csgoskins fold a
   `meterToInchMultiplier` into their liquid matrix and divide by 0.0254 again,
   which invites it — but their world is metres like ours and the conversions
   cancel against an inch-scaled centre term. Measured: 90 cells across the charm,
   disc radius **0.06px**, sub-pixel and unsamplable.

   | | cells across | cell | disc radius |
   |---|---|---|---|
   | GLB units (correct) | 2.3 | 87px | 2.2px |
   | x39.37 to inches | 90 | 2.2px | 0.06px |

2. **Liquid still reads pink, the icon reads deep red — and it is a SATURATION
   error, not a hue one.** Measured on the deepest liquid (top 12% of opaque
   pixels by chroma, per-channel median, linear ratios):

   | | sRGB | G/R | B/R |
   |---|---|---|---|
   | icon (Valve) | (146, 27, 41) | 0.038 | 0.077 |
   | ours, before refraction | (152, 40, 73) | 0.068 | 0.212 |
   | ours, after refraction | (209, 71, 89) | 0.099 | 0.157 |

   The refraction **halved the blue excess** (2.75x -> 2.04x) and pushed green the
   other way (1.8x -> 2.6x). Both ratios sitting high means our liquid carries too
   much white, i.e. it is desaturated rather than mis-hued — consistent with §7's
   finding that no hue rotation fits. Most of that error PREDATES the refraction.

   Do not read the brightness column as an error on its own: absolute level rides
   envMapIntensity and the key light rather than Valve's exposure (deviation 3 in
   §4), so only the ratios are comparable.

   These numbers are NOT comparable to the older table further down this file,
   which sampled a broader region and reported the icon at (217,81,95). Same
   picture, different pixels. Compare within a method, never across two.

   **The error splits in two, and one half is not the liquid shader at all.**
   Rendering with three's specular killed (`lqprobe=20`, same method):

   | | sRGB | G/R | B/R |
   |---|---|---|---|
   | icon | (146, 27, 41) | 0.038 | 0.077 |
   | ours | (209, 71, 89) | 0.099 | 0.157 |
   | ours, specular killed | **(139, 34, 63)** | **0.062** | 0.193 |

   Brightness lands within 5% of the icon and the green error halves the moment
   the specular is removed — so **most of the excess light and nearly all of the
   green is three's GGX specular against RoomEnvironment**, not anything in
   csgo_simple_liquid. That is the environment/exposure hypothesis §6 has carried
   untested since it was written, now measured. It is NOT a licence to kill the
   specular (the game has one); it says the remaining work is env calibration.

   What is left after that is a **blue excess of ~2.5x in the diffuse path** —
   the pale teal glass albedo still reading through under the liquid. Note the
   specular was partly masking it (B/R 0.157 with, 0.193 without), which is why
   §7's old "killing specular fixes blue not at all" entry is consistent with
   this and not a contradiction.

### Two hypotheses tested and killed this round — do not re-run them

- **"The desaturation stand-in is now redundant, since the refraction it stood in
  for is implemented."** Plausible, and wrong: removing it moved G/R 0.099 ->
  0.127 and B/R 0.157 -> 0.162, both AWAY from the icon. The game multiplies its
  raw albedo (`_14120 = albedo * mix(1, liquidColour, cover*mask)`) with no
  desaturation anywhere, so ours is not transcription — but it is still earning
  its place empirically. Keep it.
- **"The skipped energy-limit ratio explains the brightness."** Implemented it;
  it changed 4 pixels. See §4.
3. **The specular fires, but weakly.** Probe 31 shows it on the feet and the lid
   seam and nowhere else at the default camera. That may be correct — it is a
   40/roughness lobe with a 400/roughness core, i.e. deliberately tiny — but it
   has not been checked against a camera where the reference clearly shows one.

### Retired leads — both were wrong, do not restart them

- **"Metallic casing needs the dropped-channel treatment the roughness got" was
  RIGHT, and this file twice said otherwise.** It is `g_tColorA`'s **ALPHA**.
  The shader declares no metalness *texture*, which is what made "this shader has
  no metalness" look true — but the decompile does the textbook split off
  `g_tColorA.w`:

  ```glsl
  _18392 = _22452.w                                     // g_tColorA alpha
  _24253 = mix(vec3(g_flReflectance), albedo, _18392)   // specular colour
  ...    = mix(albedo * (1.0 - _18392), cubeRefract, …) // diffuse killed by it
  ```

  VRF's glTF export writes the albedo RGB-only, so the polished case and the hinge
  pin arrived as flat matte plastic. Extraction **v27** pulls `g_tColorA` onto the
  chain as `liquid.metalMap` and the client reads `.a` into `metalnessFactor`.
  Measured on the extracted texture: alpha is a clean binary mask, median 0
  (the glass) / p90 254 (the metal), matching the case and hinge shapes exactly.

  **It is NOT bound as the material's `map`.** three multiplies `diffuseColor.a`
  by the map's alpha, so reusing it would render every metal texel transparent in
  a snapshot — and our card bakes are RGBA.

  That is the FOURTH channel VRF dropped on this one charm (roughness, the
  bubbles' gate, the sharpness constant, metalness). Assume any "this shader has
  no X input" conclusion is wrong until the source .vtex_c has been checked.
- ~~"Refraction and the specular need a scene buffer we do not render."~~
  `liquid_outer_combo12.glsl:707` samples `g_tEnvironmentMap`, a **cubemap array**,
  and `:1462` builds the specular from the light constants. An environment and one
  directional light is the whole requirement, and the viewer has had both since it
  was written. This sentence cost four rounds.

---

## 6. Where the remaining difference actually is

**Do not compare silhouettes against the ICON.** The icon and our render are at
different camera angles, and that alone is enough to make "theirs is a dark block,
ours is a white flap" unreadable — the two pictures may simply be showing
different faces of the same rigid casing. An earlier draft of this section
asserted the icon showed a CLOSED lid against our open one; that was eyeballed
across two mismatched cameras and is **not** established. Do not act on it.

What IS established about the casing, measured off the GLB:

| prim | material | real bounds (indexed verts, not the accessor's) |
|---|---|---|
| 1 | `kc_db_lighter_02` | x[−0.528..0.299] y[−0.040..0.901] z[−1.346..−0.091] |
| 2 | `kc_db_lighter` | x[−0.612..0.612] y[0.100..1.224] z[−1.887..−0.374] |

Disjoint index subsets of one shared POSITION accessor — prim 1 takes verts
0..490, prim 2 takes 491..1303, **zero overlap**. §1 and §7 are both correct. The
casing is rigid, 100% weighted to joint3, and drawn at bind, so nothing in our
code is moving it.

The right reference for anything shape-related is therefore the **csgoskins 3D
view or the game**, where the camera can be matched and the same model is being
drawn. The icon is fine for colour (measure inside a region, sRGB both sides) and
useless for silhouette.

**SETTLED: the whole colour error was the LIGHT'S COLOUR TEMPERATURE.** Not the
liquid shader, not the desaturation stand-in, not the refraction.

csgoskins' lighting rig, decoded from their bundle's scenery table (their default,
and each scenery overrides `toneMappingExposure` between 0.65 and 1.2):

```js
hdriName: 'venice_sunset_1k.hdr',  environmentRotation: (0, 3.8, 0),
environmentIntensity: 0.8,
sunColor: (1, 0.8, 0.7),  sunIntensity: 6,  spotLightIntensity: 3
```

Ours: `RoomEnvironment` at `environmentIntensity` 1.05, a **white** 1.15 key, a
0.35 rim, 0.12 ambient. Setting the key to their warm `(1, 0.8, 0.7)` and the
environment to 0.8 closes it exactly, measured against their own render (not the
icon):

| | G/R | B/R |
|---|---|---|
| csgoskins render | 0.074 | 0.113 |
| ours, white key | 0.106 | 0.142 |
| **ours, warm key** | **0.075** | **0.113** |

**APPLIED** — `viewer3d.ts` key light is `0xffccb3`, `environmentIntensity` 0.8,
plus **the overhead spot we did not have at all**.

Their full rig, decoded from the bundle:

| | theirs | ours now |
|---|---|---|
| environment | `venice_sunset_1k.hdr`, rot (0, 3.8, 0), intensity 0.8 | RoomEnvironment @ 0.8 |
| sun | DirectionalLight, colour (1, 0.8, 0.7), **intensity 6**, pos (−0.6, 0.6, −0.2) | 0xffccb3 @ 1.15 |
| **spot** | SpotLight, colour (1, 0.7, 0.7), **intensity 3**, pos (0.04, clamp(r·1.2, 0.5, 2), 0), angle 0.8, penumbra 0.3 | same shape, decay 0 @ 1.2 |
| exposure | `env.toneMappingExposure \|\| 0.75` | 1.0 |
| bloom | `enableBloom: 'auto'` | none |

**Their intensities do not transfer, and copying one is an instructive mistake.**
three's spot is inverse-square, so an intensity only means anything against a
scene scale. Theirs sits 0.5–2 units above the item in units that are not metres;
ours are, and a 5cm charm puts the spot 3cm away, where their `3` lands at
`3/0.03²` ≈ 3300x. It blew the top of the charm to flat white and looked exactly
like a shader bug. `decay: 0` makes the intensity scale-invariant so one number
serves a charm and a rifle; everything else about the light is theirs.

The spot is what gives a small glossy object its bright crown — a directional
light alone is a flat wash. Verified not to disturb weapons (AK-47 unchanged).

**The HDRI is in.** `src/assets/venice_sunset_1k.hdr` (CC0, Poly Haven, 1.4MB,
bundled via a Vite `?url` import, with `RoomEnvironment` kept as the fallback if
the fetch fails — it ships as a federated remote and loads from the panel's
origin). `scene.environmentRotation` (0, 3.8, 0), theirs.

**It is what makes metal read as metal.** Recovering the metalness from
`g_tColorA.a` did not make the lighter case look like steel — a metalness map
only says how much of the environment a surface mirrors, and `RoomEnvironment` is
a flat neutral box, so correct chrome still came out flat grey. With a sky and a
ground to reflect, the case goes dark and contrasty and the ring picks up a blue
sky tint, both like the reference.

**Bloom is ON by default**, at a deliberately tiny strength, behind the `bloom` dev flag with live
sliders for strength / radius / threshold in the dev HUD (they are read per frame,
so dragging one moves the model). Their exposure (0.75) IS applied globally.

**Settings: strength 0.05, radius 0.30, threshold 0.18** — and the strength being
almost nothing is the point. The first attempt used csgoskins' own 1.2 / 1 / 0.06
and destroyed bright skins: a Glock's slide went solid white with the whole upper
receiver lost. The shape that works is theirs (a LOW threshold, so everything
blooms a little and reads as the material being luminous) at a hundredth of their
amplitude.

Verified on Glock-18 | Water Elemental, the case that broke it: **0.00% near-white
pixels** and a mean within 0.02 of bloom-off, i.e. the effect lives entirely on
genuinely bright pixels. Corner alpha 0 on charm, rifle and pistol — the composite
patch is doing its job.

The three sliders are capped at the range that turned out to matter (strength
0-0.5 in 0.01 steps); the original 0-2 at 0.05 put every useful value in one notch
against the left edge. `viewer3d.ts` builds an
`EffectComposer` per viewer, lazily, disposed with it — RenderPass + UnrealBloomPass
+ OutputPass. `?bloom=0` turns it off; `?bloomstrength=`, `?bloomradius=`,
`?bloomthreshold=` tune it without a rebuild.

Three things worth knowing, all learned the hard way:

- **A HALF-FLOAT target is required.** The composer's default is LDR, so the scene
  clamps at 1.0 before the bright-pass sees it and every highlight becomes the
  same white. csgoskins switch to `type: 1016` exactly when bloom is on.
- **Their strength/radius/threshold (1.2 / 1 / 0.06) DO NOT TRANSFER.** three
  forces `NoToneMapping` when rendering into a render target, so the bright-pass
  sees LINEAR HDR — 0.06 there is nearly black, a lit mid-grey surface (~0.2
  linear) sails past it, and the additive composite washes the render to white.
  Tried it; it is unmistakable. A threshold near 1.0 means "brighter than white",
  which is the useful gate.
- **ALPHA. Transcribe their composite patch or every card bake gets a grey haze.**
  UnrealBloomPass composites additively across the whole frame, including the
  transparent background. They rewrite the composite material to derive alpha from
  the bloom's own luminance:
  `texel.a = mix(0.0, texel.a, clamp(length(texel.rgb) * 10.0, 0.0, 1.0))`
  with additive blending, `transparent: true`, no depth. Verified after: corner
  pixels alpha 0, 86.7% of the frame fully transparent.

### A measurement error worth not repeating

The liquid ratios were tuned for several rounds against `ref_liquid.png`, cropped
from their **gallery** render (`galleries/v4/charm-butane-buddy/inspecting.png`).
That is a first-person shot in a DARK GARAGE — a different scenery entry with its
own HDRI, its own `toneMappingExposure` and its own sun. It is not the default
`venice_sunset` viewer we are now replicating, so its ratios were never the right
target for our studio render, and "we overshot to 0.025/0.050 against their
0.074/0.113" mostly measures that mismatch.

Their scenery table has ~8 entries and they all differ. **Match a reference to the
rig that produced it**, or the numbers are theatre. The gallery shot is still good
for the things that do not depend on the scene — silhouette, which parts are
metal, whether bubbles are visible at all.

The rig is also still calibrated against Valve's official CDN renders (AK-47 |
Safari Mesh @0.265 -> (109,105,80); FAMAS | Byproduct @0.408 -> (109,101,79)) and
those targets are recorded at the code. It now answers to both references —
re-check both if it is ever re-tuned.

### And the waterline was 4.2x too soft, for the same reason the bubbles were dead

`SHARP_SCALE` was a constant 0.2, from `mix(1.0, 0.2, pow(b, 1.5))` with
`b = g_tNormalA.z` measured as **1.0**. That measurement was taken on the exported
normal map's BLUE channel — which VRF had rebuilt as the octahedral Z. Extraction
v24 established that the authored channel is the ROUGHNESS, living in ALPHA at
p10 0.15 / median 0.33 / p90 0.56, **and this constant was never revisited**. At
the real median the term is 0.848, not 0.2.

It is a texture, so it is per-fragment now (`csLiquidSample` takes the roughness).
The waterline went from a soft vertical gradient to the hard boundary the
reference has.

**That is three separate bugs from one wrong belief** — "g_tNormalA.z is 1.0". It
killed the bubbles (§5.1), softened the waterline, and was recorded in §9 below as
*verified by measurement*. When a foundational reading changes, grep for every
constant derived from it.

Still-open structural candidate, unchanged and still uninvestigated:

- **Their agitation may be far higher than anything we feed.** Every invisible
  term scales on agitation, some to the FOURTH power (`(a²+0.01)²` — measured
  surface motion: a=0.4 → 2px, 0.7 → 7px, 1.0 → 30px). One wrong global would
  suppress wobble, bubbles and displacement simultaneously.

**Recommended order:** (a) **calibrate the environment** — it is now the measured
top error, it is one or two constants in `getSharedGL`, and it affects every item
the viewer renders rather than just this charm (which is a reason to be careful,
not a reason to skip it: change it and re-run the skin sweep); (b) the residual
~2.5x blue in the diffuse path; (c) a camera-matched reference, which needs a
human — csgoskins is behind a Cloudflare human-verification challenge and cannot
be captured programmatically; (d) agitation; (e) only then more terms.

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
- **A glTF accessor's min/max describes the POOL, not the primitive.** All three
  prims here share one POSITION accessor, so reading `accessor.min/max` reports
  identical bounds and identical vertex counts for every one of them — which
  reads as "these are two coincident passes over the same body" and directly
  contradicts §1 and §7. They are not: walk the indices each prim actually
  references and the bounds separate cleanly. Cost a detour; would have cost a
  whole round if acted on.
- **A backtick in a GLSL comment terminates the TS template literal.** Already in
  this file's history and it happened again, in `CHARM_LIQUID_REFRACT`, costing a
  round: the symptom is not a shader error, it is the rig rendering a completely
  BLANK page — vite fails the transform and the module never loads. `npm run
  typecheck` names it instantly (`TS1005: ',' expected`). Typecheck before
  concluding anything from an empty rig page.
- **Baseline against the same camera, and prove the change is what you think it
  is.** Swapping one file to its `HEAD` version and re-rendering is worth the two
  minutes: the sticker-rotation flip in this same session was confirmed as
  *exactly* a negation because `HEAD(-45)` came back pixel-identical to
  `NEW(+45)`. "It looks different" would not have distinguished a sign flip from a
  sign flip plus an accidental offset.
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
