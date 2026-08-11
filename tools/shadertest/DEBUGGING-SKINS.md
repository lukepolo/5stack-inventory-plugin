# Debugging a skin that renders wrong

A playbook, written after a long session that took Glock-18 | AXIA from
green-and-gold to matching the in-game render, and moved Deagle | Blaze and
AK-47 | Aphrodite a long way. Most of the time in that session was NOT spent
fixing shader math — it was spent on false leads, bad measurements and debugging
the debugging. This documents the order of operations that actually worked so
the next one is faster.

**Keep this file current.** Every time you learn something — a new trap, a
measurement that lied, a combo you decompiled — add it here and to the relevant
memory. The catalogue at the bottom is the highest-value part of the document
and it should keep growing.

**Companion documents**, for subsystems with enough of their own detail to
warrant one:

- `GLOVES-GEN2.md` — `csgo_customglove.vfx`'s second parameter generation
  (`g_tSubstrate` / `g_tSurface`, 22 finishes). Renders; colours still wrong.
  Carries its own ruled-out table and the open leads, in priority order.
- `CHARM-PHYSICS.md` — charm softbody / swing.
- `BUTANE-BUDDY.md` — the one charm on `csgo_simple_liquid.vfx`. Renders but does
  not match the reference; carries its own ruled-out table, the open leads in
  priority order, and a note on why transcribing more shader terms stopped
  converging.

---

## The single most important rule

**Get ground truth. Do not infer shader math.**

Everything in this codebase that was "reasoned out" from how the render looked
turned out wrong, sometimes twice, and each wrong guess cost hours and usually
broke a skin that was previously fine. Everything transcribed from a decompiled
combo was right the first time.

Before changing a line of GLSL, go get the shader. The recipe is in the
`cs2-shader-decompile` memory and it is fully automated — Claude can run it
end to end, cluster access included, in a couple of minutes.

Combos already mined (re-dump these rather than rediscovering):

| combo | features | use for |
|---|---|---|
| 1529 | style 8 + CASE_HARDENING + OVERRIDE_NORMAL + PEARLESCENCE_MASK + SEPARATE_CHANNEL_INPUTS | AXIA, gunsmith case hardening |
| 1447 | style 7 + CASE_HARDENING + SEPARATE_CHANNEL_INPUTS | Heat Treated, patina |
| 293  | style 5 + SEPARATE_CHANNEL_INPUTS | Blaze, spray/airbrush projection |
| weapon 192 | S_GLITTER + S_ENABLE_SFX_MASK (the RUNTIME weapon shader, a different 27MB .vcs) | glitter, pearlescence, iridescence |
| weapon 33 | S_ENABLE_ADJUSTMENTS + S_TINT_MASK (same 27MB .vcs) | the CHARM pattern grade, and which texels it touches |

Saved decompiles live in `tools/shadertest/groundtruth/`.

`csgo_weapon_vulkan_50_ps.vcs` is not in the dedicated-server install — the
game-server pod's `shaders_vulkan_dir.vpk` does not list it. Use the full CS2
tree the extraction mounts (`/cs2-game/game/csgo/`), where it is archive 1,
offset 80904864, length 27333852. Its 12 features are S_ENABLE_ADJUSTMENTS(1),
S_MODE_TOOLS_VIS(2), S_ALPHA_TEST(4), S_TRANSLUCENT(8), S_ADDITIVE_BLEND(16),
S_TINT_MASK(32), S_GLITTER(64), S_ENABLE_SFX_MASK(128), S_SELF_ILLUM(256),
S_STICKERS(512), S_MODE_DEPTH(1024), S_OPAQUE_REFRACT(2048) — add the
multipliers to get a combo id.

> **A combo tells you the math for ITS feature set.** A skin with extra features
> routes a different value into the same slot. This bit us: combo 1529 has no
> `S_METALNESS_TEXTURE`, so its `g_flPaintMetalness` genuinely is the paint
> metalness — but AXIA's real combo has one, and using the scalar stripped the
> artist's per-texel metalness and turned a black grip light grey. Always check
> whether the skin enables features your combo lacks.

---

## Step 1 — identify the skin exactly

Don't work from the market name. Get the real parameters:

```js
// backend/, ESM script against @ianlucas/cs2-lib
const i = CS2Economy.getById(id);
// name, model, index, legacy, paintMaterial, image
```

You need: **model key** (which GLB), **paintMaterial** (the vcompmat path),
**legacy** (which body — legacy vs HD unwrap), and the **official image** name
so you can pull the reference render:

    https://inventory.5stack.gg/images/<image>.webp

The craft URL id is the cs2-lib item id: `/apps/inventory/craft/<id>`.

## Step 2 — read the material chain before touching code

```
vcompmat  (per-skin, loose variables)  ->  template vmat  (compiled, shared)
```

Fetch both from `https://inventory.5stack.gg/paints/materials/<file>.json` and dump every
named parameter. A large share of "shader bugs" are actually **the loader
resolving the wrong value**, and you can see that here in seconds without
rendering anything.

Then dump the resolved `PaintDef` in the browser and compare it against what the
material says — that catches loader bugs immediately:

```js
const pc = await import('/@fs/<abs path>/src/paintComposite.ts');
JSON.stringify(await pc.loadPaintDef('/materials/<file>.vcompmat.json'))
```

## Step 3 — reproduce in the rig, not in the app

`npx vite --config tools/shadertest/vite.config.ts --port 52xx` then:

- `runOne(model, pm, wear, seed, size, legacyPaint, debug)` — the composited
  **atlas** (UV space). Fast, good for "is the pattern even right".
- `runViewer(model, pm, wear, seed, opts)` — the **real 3D render** through
  `mountViewer`. This is what you judge appearance on.
- `debug` modes: 2 = pattern.rgb as sampled, 3 = pattern.a, 4 = masks.rgb.

**Judge appearance on `runViewer`, never on the atlas.** An atlas that looks
blotchy is often correct once the model's UVs scale it down.

## Step 4 — bisect the pipeline with stage probes

When a skin is the wrong colour, don't theorise about which term is at fault —
**print the terms**. Add a temporary debug mode that returns a value early:

```glsl
if (uMode == 5) { outColor = vec4(someTerm, 1.0); return; }
```

Then walk it forward: `pattern` -> `chBase` -> `patCol` -> `cPaint` ->
`finalPaint` -> `outColor`. The first stage that disagrees with expectation is
where the bug is. This is how Aphrodite's whole-gun overlay multiply was found
after three wrong theories.

Add the mode to BOTH `PaintDef`'s `debug?:` union and `rig.ts`'s, or the call
silently type-errors.

---

## Measurement discipline

More time was lost to bad measurements than to bad shader math. All of these
produced confidently wrong conclusions in one session:

**Snapshots are transparent-backed.** `.convert("RGB")` turns the background
BLACK and poisons every statistic. Filter on alpha: `p[3] > 200`.

**Percentile, never min/max.** UV gutters hold garbage. The position map's raw
min/max read ±14 while its real body range is ~[0,1] — that bad reading sent me
"normalising" by 1/36 and rendering the gun as a single texel. Use p01/p99.

**Never compare values across differently-encoded render targets.** The albedo
RT is sRGB, the debug RT and the rough/metal RT are linear. Comparing a number
from one against a number from the other is meaningless. Compare within one
target, or convert explicitly.

**A "should be impossible" reading means the shader isn't running.** If a probe
returns all zeros — especially something like `float(someBool)` which can only
be 0.0 or 1.0 — do not debug the logic. **Check the console first.** Then prove
the shader is live with a constant:

```glsl
if (uMode == 5) { outColor = vec4(1.0, 0.0, 1.0, 1.0); return; }  // magenta
```

Not magenta? The shader failed to compile and nothing you measured was real.

**Reload is asynchronous.** `location.reload()` followed immediately by an
`import()` in the same call runs against the OLD module. Reload in one tool
call, measure in the next.

---

## Verification

**Run the fixture suite after every change** (`batch.html`, ~3 min). It is not
optional — several "obviously safe" changes regressed a different skin, and the
suite caught all of them:

- a blanket style-8 rule flattened P90 | Tangled to bare grey
- preferring skin-authored masks everywhere dropped Autumn Thicket under the
  grey floor
- applying the address mode in paint-UV space wrecked AWP | Fade (sat 47.9 -> 18.6)

**Narrow every change to what the evidence covers.** The pattern that worked
repeatedly: find the rule in one combo, apply it gated to exactly that style +
feature set, re-run the suite, and widen only if a second combo supports it.
Style 7 and style 8 in particular are NOT interchangeable — conflating them
returned Heat Treated to the green-and-magenta failure twice.

**Know what the suite cannot catch.** Its checks are statistical (grey
detection, wear response, seed response). They will not catch a wrong
projection, a wrong offset, or subtly wrong colour. For those, compare against
the CDN reference visually and numerically — e.g. mean RGB over a colour-masked
region:

```py
blue = [p for p in px if p[2] > 90 and p[2] > p[0] + 40 and p[2] >= p[1]]
```

That is how AXIA's blue was confirmed: (22,103,140) -> (40,150,201) against the
reference's (44,153,193).

**Lock in wins with a fixture.** Add to `fixtures.ts` with a note explaining
what is load-bearing and what breaks if it regresses. Say explicitly when the
fixture is only a collapse-guard and the skin needs visual judgement.

---

## Trap catalogue

Grow this list.

**Comments claiming "CONFIRMED from the decompile" may be lying.** Several were
fabricated. `oilRub` cited a 0.23 grunge scale that appears ZERO times in either
combo. Grep the ground truth before trusting any such comment — including ones
written in an earlier pass of the same session.

**`F_*` static combos come from the TEMPLATE, not the vcompmat.** Bare `F_*`
loose integers are per-mutator plumbing, almost always 0. Aphrodite's
`F_OVERLAY_MASK = 0` beat the template's `8`, turning a masked 66% multiply
overlay into a whole-gun multiply. Exception: an `F_*` the skin exposes in its
editor UI (`m_bExposeExternally`) IS a real authored override.

**Key features off the FLAG, never off texture presence.** These materials ship
placeholder textures for features that are switched off — `g_bUseOverlay`,
`g_bUseNormalMap`, `g_bUsePearlescenceMask`.

**A "slider" value that equals the midpoint of its own bounds was never
touched** — it is a seed envelope, not an authored value. Anything off-midpoint
is authored. This is how case hardening's ramp offset is resolved.

**The composite shader is AT the 16-sampler limit.** A 17th makes EVERY skin
render pure black with only a console line. Share a unit between mutually
exclusive features (`g_tSurface` shares `tPaintNormal`; case hardening requires
style 0/7/8 so they can never both be live). See `glsl-sampler-unit-limit`.

**`smoothstep(hi, lo, x)` is undefined behaviour** — the spec requires
`edge0 < edge1`. Write `1.0 - smoothstep(lo, hi, x)`. Note Valve's own decompiled
GLSL contains the descending form and drivers evaluate it as
`clamp((x-e0)/(e1-e0))`, so it is equivalent in practice — but don't rely on it.

**`g_flColorBrightness` is applied TWICE, with a clamp between and after.**
CONFIRMED (combo 293, style5.glsl:444-445): `b = mix(brightness, 1, chip);
col = clamp(clamp(base*b, 0,1) * b, 0,1)`. We were doing one unclamped multiply,
which left Deagle | Blaze's flames a muddy dark red — the gold flame bodies sit
near 0.12 linear and one ×3 only reaches ~0.36 (dim), where the double-with-clamp
reaches 1.0 (bright orange = actual fire). It lives in the SHARED albedo path so
it touches every style, but for the ~all skins where brightness is 1 it is just
clamp(cPaint), a no-op (cPaint is already a convex mix of in-gamut colours). All
14 fixtures still pass.

**Projected styles (2, 5) must composite at 4096, not 2048.** The flame/spray
graphic is high-frequency and the triplanar projection undersamples it at 2048 —
Deagle | Blaze's crisp fire tongues averaged into a muddy dark-red blur (mean
flame measured 240/78/5 vs a per-pixel target ~255/140/36; the bright yellow
highlights that read as "fire" simply weren't sampled — maxG 130 at 2048 vs 229
at 4096). GROUND TRUTH: skinport serves the GAME's own baked albedo at 4096
(cdn.skinport.com/3d-viewer/textures/<id>/material0_color_...png — the exact
paint in the deagle's UV, invaluable for a per-pixel compare), and the game's
native g_tPosition is only 1024 (extraction verified), so the resolution that
matters is the ATLAS, not the input map. Fix: MAX_COMPOSITE_SIZE_PROJECTED=4096.
Cost is ~3.3s build for the deagle (one-off, cached); scoped to styles 2/5 so it
does not tax the other seven. To reverse-engineer any skin against the real
game render, pull skinport's baked color+metal textures (they apply pre-baked
maps to a mesh, they do NOT composite at runtime) and the base weapon
color/ORM from the cluster (/cs2-models/models/<key>_*_orm_*.png — the deagle's
chrome base is grey 83/82/81, metalness 0.94).

**Not everything is baked.** Glitter, pearlescence and iridescence are RUNTIME
weapon-material effects (`src/paintSfx.ts`), not compositor ones. The compositor
owes them only the SFX mask, written into the rough/metal map. If an effect is
view-dependent it cannot live in the composite.

**Styles 2 and 5 are PROJECTED.** They do not sample the pattern in paint-UV
space at all — they build the coordinate from `g_tPosition` via a triplanar
projection. Any reasoning that assumes paint-UV sampling is wrong for them.

**The triplanar plane blend needs the SMOOTH geometric normal, not `g_tSurface`.**
The projection blends three planes by the surface normal
(`mix(mix(A,B,blend.y·|n.y|⁷), C, blend.z·|n.z|⁷)`). Feeding it `g_tSurface` —
which Valve's shader does — shreds the artwork into VERTICAL STRIPES (the
"stretched" look on Deagle | Blaze): g_tSurface carries the weapon's fine surface
detail, and `pow(|n|,7)` turns small detail wobble into hard plane flips, so the
pattern switches projection planes texel to texel. FIX: use the geometric normal,
`normalize(cross(dFdx(sprPos), dFdy(sprPos)))` — the blurred object-space
position's gradient IS the surface normal in paint-UV space, and it is smooth, so
the plane choice is stable. Blaze's flames then curl and match the game's baked
albedo; 14/14 fixtures pass.

**`g_tSurface` is NOT broken, and canvas readback will lie to you about it.** I
"measured" it as 94% empty with length-√3 vectors and nearly changed the
extractor over it. Both readings were false: its alpha is 0 everywhere and a 2D
canvas PREMULTIPLIES on readback, so `getImageData` returns black for every
texel. Read it back through WebGL (render it and `readRenderTargetPixels`) or
with PIL — done that way it is 99.9% covered and `|s*2-1|` p50 = 1.000, a
perfectly valid unit normal map. The extraction is fine; no re-extract or version
bump was needed. GENERAL RULE: any input map whose alpha is 0 (surface, masks…)
cannot be measured through a canvas — use WebGL or PIL.

How the stripe bug was actually pinned: the flat map matched the game on colour
and distribution, but the flame SHAPES differed (ours striped, game curly).
Cropping our flat composite next to skinport's baked albedo (sRGB, V-flipped to
align) made it obvious. Judge projected skins on the FLAT MAP first — a wrong
projection is unmistakable there and pointless to chase on the 3D model.

**`g_vSprayBlend` is a float2, and the compiled reflection's `.y`/`.z` are NOT
its `.y`/`.z`.** This one nearly cost a regression. The decompiled GLSL mixes on
`g_vSprayBiasBlend.y` and `.z`, which reads like "use material components 1 and
2". It is not. The compiled `g_vSprayBiasBlend` is a CPU-side Expression
(csgo_customweapon.slang:645):
`float3(g_bBiasSpray||0, g_vSprayBlend.x, g_vSprayBlend.y)`, and `g_vSprayBlend`
is declared `float2` (slang:689). So shader `.y`/`.z` = material `.x`/`.y`, i.e.
the parse `[v[0], v[1]]` is CORRECT. Reading `[v[1], v[2]]` "to match the GLSL"
is wrong — the material stores a padded vec4 but only `.x`/`.y` are real, and the
`.z` padding merely happens to be 0 on Blaze so the mistake renders plausibly.
GENERAL TRAP: SPIRV-Cross shows you the *compiled* uniform, not the
material→uniform binding. When a `g_v*` name in the GLSL differs from the
material param name (here Blend vs BiasBlend), find the `Expression(...)` in the
.slang before assuming component order — the compiled `.slang` (find via
[[cs2-shader-decompile]]) is the ground truth, the reflection alone is not.

**A green extraction run proves nothing about completeness.** v2 stamped
successfully, exited 0, and silently dropped `g_tPosition` from all 89 weapons
because the copy loop only accepted `.png` and that map is `.exr`. Check the
per-weapon `meta.json`, not the exit code.

**The `.exr` position map loads UPSIDE-DOWN, and `flipY` cannot fix it.**
EXRLoader returns a `DataTexture`, and WebGL's `UNPACK_FLIP_Y_WEBGL` does not
apply to typed-array uploads, so `t.flipY = false` (or true) is a no-op — the
rows have to be swapped in the data by hand. Every `.png` composite input comes
in the OTHER orientation (TextureLoader honours flipY), so the position map was
sampled vertically mirrored while all the masks/AO/surface were upright: each
texel got some unrelated UV island's object-space position and the projected
styles (2, 5) painted their artwork nowhere near where it belonged. Deagle |
Blaze put its gold band across the middle of the slide instead of the muzzle;
the fix moved it to a solid-orange muzzle with flames licking back, matching the
in-game render. How it was PINNED (the method that finally worked after a lot of
flailing on lit renders): load the weapon GLB, and for a sample of vertices look
the position map up at that vertex's paint UV and correlate the three channels
against the vertex's real object-space position. Best |correlation| over all
channel/axis pairs was 0.09 as-loaded (i.e. no relationship at all) and 0.995
with V flipped; the control (surface.png, ordinary TextureLoader) was 0.75 vs
0.24, i.e. already upright. Correlate against ground-truth geometry — do NOT try
to read a projection off a shaded 3D render, the lighting and sRGB-on-write
corrupt every value (an emissiveMap hack to force it unlit still left it
unreadable).

**A pattern that recolours TOO MUCH is a missing mask, not wrong math.**
Charms grade their albedo through `csgo_weapon.vfx`'s hue/saturation/brightness/
contrast block, and 53 of the 82 corrected keychain materials end that block
with `mix(albedo, graded, g_tTintMask.r)` — the mask is the whole answer to
"which part of this charm is the pattern for". We had the grade transcribed
correctly and no mask at all, so every pattern swept the entire charm: Lil'
Vino's wine, bottle, cork and label all moved together. Two things made it hard
to see. The grade already had a *plausible* region limiter in it — the
`pow(hsvSaturation, 0.125)` fade that leaves near-grey texels alone — so the
render looked deliberate rather than broken. And most of the masked charms were
not grading at all, because the extractor's dynamic-expression regex only
matched VRF's inline `m_value = #[ … ]` and silently dropped the 45 materials
whose bytecode was long enough to wrap onto its own line. Two bugs, one
symptom-free until you compare against the game. When an authored mask exists,
prefer it over any inferred limiter — and check the vmat's `F_*` flags for
maskings you have not modelled (`g_bMaskRoughnessAdjustmentsByTintMask` lerps
each roughness KNOB toward identity, not the result).

### "It renders blank" can mean the shader is not csgo_weapon at all

Charm | Butane Buddy (id 14312, `kc_db_lighter`) rendered as a featureless pale
teal blob with everything present on the mount — GLB, colour, normal, ORM,
`.phys.json` all 200 — and the lighter half of the same model rendering fine.
The body is on **`csgo_simple_liquid.vfx`**, which we did not implement, so the
glTF fallback showed the authored albedo: the EMPTY glass. Every red pixel of
the icon comes from `g_vLiquidColor` and `g_flLiquidLevelHeight`, not a texture.

**Survey the shader before assuming the pipeline.** One range-GET per model over
the GLB's first 128KB answers it for the whole catalog in a minute, because VRF
writes the source vmat into `material.extras.vmat`:

```sh
curl -s -r 0-131071 "$HOST/models/$stem.glb" -o /tmp/c.bin
strings -a /tmp/c.bin | grep -o '"ShaderName":"[a-z0-9_]*\.vfx"' | sort -u
```

Across the 81 `kc_*` charms: 58 `csgo_weapon.vfx`, **1** `csgo_simple_liquid.vfx`,
22 that 404 because they are the shared-blank community charms. A shader with
one user still has to be implemented if it IS the item.

Three traps this turned up, all worth checking on any new shader:

- **The vertex program is not optional.** `csgo_simple_liquid`'s level test
  compares two dot products against varyings whose meaning is unguessable from
  the pixel shader — `input_3` is the model's up axis, `input_4` is world
  gravity, `input_1` is the liquid centre already transformed. Decompile the
  `_vs.vcs` too; it is small and fast.
- **VRF's glTF export can destroy a channel the shader reads.** Source 2 normal
  maps store X and Y and rebuild Z, leaving BLUE free — this shader reads
  `g_tNormalA.z` for edge softness and bubble density. VRF reconstructs a
  standard RGB normal map, so the exported blue is the rebuilt Z: measured
  median 254/255. Measure the channel before transcribing anything that reads
  it. Here both uses collapsed to constants, which is a real answer, not a
  shortcut.
- **Evaluate the noise before implementing it.** The wobble is eight
  `exp(sin(dot()))` octaves scaled by `wobbleScale * agitation²` — and both
  shipped materials leave that product at 1e-4/1e-2, bounding the whole term at
  a 0.008 ripple on a body 1.2 units across. It is a constant. The bound is
  re-checked at extract time so a future material with real agitation is caught.

Also: params on a non-`csgo_weapon` shader can still be **seed-driven**, and
`HONOURED` in `charmMaterial.ts` gates whether the pattern rail believes it.
Butane Buddy drives `g_flLiquidColorHueShift = lerp(0, 320, seed)` and
`g_flLiquidLevelHeight = lerp(0.45, 0.8, frac(seed*100))` — a full hue sweep and
a cycling fill — and reported as pattern-inert until both names were listed.
Its dynamic params also reference render attribute `0x4B002DCA`, the charm's
live motion, which `vfx_decode` drops loudly; the authored constants are the
at-rest values and the right ones for a viewer.

Decompiles: `groundtruth/liquid_outer_combo12.glsl` (S_OPAQUE_REFRACT +
S_USE_TEST_VALUES), `liquid_inner_combo8.glsl`, `liquid_vs_combo4.glsl`. The
program is `shaders/vfx/csgo_simple_liquid_vulkan_50_ps.vcs`, archive 1, offset
73492960, length 753297 — in the FULL tree at `/cs2-game/game/csgo/`, not the
dedicated-server pack, same as `csgo_weapon`. Only 5 features, 24 combos.

### Don't run a 30-minute extraction to change one number

`ONLY_STEPS=` scopes the run and the fast steps are seconds, not minutes:

```sh
ONLY_STEPS=charm-models   ./scripts/extract-models.sh   # ~1s, all charm params
ONLY_STEPS=charm-anchors  ./scripts/extract-models.sh   # ~5s
```

A full run is ~30 minutes and is almost never what you want while iterating. The
paint chain is only needed when a NEW TEXTURE has to be pulled — parameter
changes land through `charm-models` alone.

Scoped runs are safe as of 2026-08-05, and were not before: the paint chain
pruned against whatever the current run happened to reference, so a two-step run
deleted every texture the skipped steps would have named — the live mount went
from ~16,800 textures to 262 and every skin rendered white. A scoped run now
prunes nothing and does not stamp `extract-version.json`, so the mount stays
honestly stale until a full run happens.

### Use csgoskins.gg's 3D viewer as reference — and read its shader

**https://csgoskins.gg/items/<item-slug>** renders the same items in a real-time
3D viewer in the browser. It is the best reference we have short of the game:

- **It is a moving, lit, orbitable render**, so it answers questions a flat icon
  cannot — is this surface glossy, does it have bubbles, does the liquid move
  when nothing else does, how sharp is that waterline.
- **Its own shaders are readable.** It is WebGL, so the GLSL is in the page. When
  our render disagrees with theirs, diffing against a working browser
  implementation is far cheaper than re-deriving from a .vcs decompile — and it
  shows which of Valve's terms are worth approximating at all in WebGL.
- Compare like for like: their canvas is sRGB output, so decode before taking any
  ratio (see below).

Butane Buddy's whole "why is ours flat" answer came out of this comparison:
theirs has hard speculars on the glass, a metallic casing and visible bubbles,
ours had none — which pointed straight at a roughness input we were not feeding.

### Never compare a derived LINEAR value against a screenshot

This cost a whole session's worth of wrong conclusions on Butane Buddy. The
liquid tint `lqC` works out to linear `(1.585, 0.161, 0.377)` — ratios G/R 0.10,
B/R 0.24. Measured off the render it read G/R 0.46, B/R 0.70, so the tint looked
badly wrong and a whole "40% of the pixel is untinted specular" theory got built
on it, along with a specular energy-limit to fix it.

sRGB-encode the derived value first and the discrepancy vanishes: 0.161 -> 0.44,
0.377 -> 0.65, i.e. **G/R 0.44, B/R 0.65** against the measured 0.46 / 0.70. The
tint was right the whole time. The energy fix moved the ratios by 2% because
there was nothing to fix, and it was reverted.

**Decode both sides to linear before taking any ratio**, including the reference
icon's — it is an sRGB PNG too. Doing that here turns "our liquid is wildly
magenta" into "our liquid has ~2.7x too much blue in linear", which is a
different and much smaller problem.

### Probes: three traps in one session

- A probe that references a variable OUT OF SCOPE fails to COMPILE, three logs
  it and keeps drawing with a fallback, and you read meaningless pixels. Put
  probe values on the struct you already pass around, and read the console after
  every probe change.
- Probe output goes through lighting AND tone mapping AND the sRGB encode, so it
  is only ever QUALITATIVE — sign, presence of a split, saturation at 0 or 1.
- A CDP-driven tab is `document.hidden`, so `requestAnimationFrame` fires once
  and never again. Anything animated looks frozen and the render loop appears
  dead. Check `document.hidden` before concluding a per-frame feature is broken.

---

## Worked example: the shape of a good session

Glock-18 | AXIA, green-and-gold -> correct:

1. Looked up the item: style 8, case hardening, `gsch_axia_glock`.
2. Read the vcompmat: ramp offset **pinned** at 1 (min == max), not seed-varied.
3. Surveyed all 24 materials declaring that param to prove the midpoint rule.
4. Fixed the offset -> blue, but the whole gun was blue.
5. Decompiled combo 1529 -> `mix(pattern, rampAvg, masks.g)`: the ramp is gated
   by masks.g. Fixed -> slide correct, but white chrome.
6. Same combo -> pattern colorspace splits by style. Fixed -> dark steel.
7. User said "not sparkly, not blue enough" — both real bugs: an inverted
   `reflect()` and the case-hardening metalness applied outside `masks.r`.
8. Fixture added, suite green, memory updated.

Note the shape: every step was a measurement or a decompile, never a guess, and
each one was verified against the suite before the next.

---

## Stickers: the dual-purpose alpha, and the constants that were "unreadable"

Settled 2026-08-10 (the "stickers are faded/transparent" bug). Ground truth is
`groundtruth/sticker.glsl` (`csgo_weapon_sticker_vulkan_50_ps.vcs`, VCS 71,
archive 1 offset 80769456 length 112181 in the FULL tree — static combo 0
carries every finish, the features are all dynamic bools).

**`g_tSticker0.a` is NOT coverage.** Bytes 0–20 are the antialiased coverage
ramp; 20–255 encode the wear-erosion ORDER. Display alpha is
`saturate(a * 12.75)` (sticker.glsl:420) and the wear remap
`saturate((a-0.078431)*1.0851)` (:703) eats the RAW byte. Draw the texture with
its raw alpha and every sticker interior renders at its wear-order value —
"almost transparent". The icon fallback and `g_tPatch0` have ORDINARY alpha, so
the expansion is licensed per-load (`artKind` from `/api/catalog/sticker-art` +
which bitmap actually loaded), never inferred from "art exists".

**The engine-global albedo-levels ARE in the .vcs.** The docblock claim that
`g_v*AlbedoLevels` were unreadable was wrong — they are `__Expression__`
variables in the pixel shader's own variable table, DynExp-decoded (VfxEval in
VRF) under `float3(-A.x, -1.4427*log(max(1e-4,1-A.y)), 2-A.z)`:
`g_vAlbedoLevels` (.045,.4,1.15)→(0.045, 0.737, 0.85) — agreeing with
paintComposite's independently-decoded OV_LEVELS, which validates the rule —
`g_vHoloAlbedoLevels` (.05,.35,1.15)→(0.05, 0.62149, 0.85),
`g_vMetallicAlbedoLevels` (.45,.4,1.08)→(0.45, 0.737, 0.92),
`g_vDarkMetallicAlbedoLevels` (.1,.4,1.08)→(0.1, 0.737, 0.92),
`g_fColorBoostFactor` = 64-1. With those, the `stkFoil` stand-in died and the
real refit (sticker.glsl:548-623, :660-664) went in.

**The variable table also carries the per-material DEFAULTS, and two are not
false:** `g_bAutomaticPBRColorFittingSticker0` and `g_bClampSpectrumVSticker0`
default TRUE, `g_fWearScratchesSticker0` defaults 1 (at the old 0 default the
scratch term is `1-min(0,tex)=1`, dead), `g_vWearBiasSticker0` defaults (1,1).
A boolParam that reads absent-as-false silently un-refits every sticker that
doesn't author the flag — which is most of them.

**three.js chunk-order trap:** `metalnessmap_fragment` runs BEFORE
`normal_fragment_maps`. A value set in the normal-maps injection and consumed
in the metalness injection is consumed at its initializer — the old foil term
was dead code from day one. Write `metalnessFactor` at the END of the
normal-maps injection instead; `lights_physical_fragment` is the real consumer
and runs later.

**Canvas round-trips corrupt low-alpha art.** A 2D canvas premultiplies its
backing store; with coverage alphas ≤20 the un-premultiplied readback quantises
RGB to ~alpha_byte levels — grey, banded ink. Decode with
`createImageBitmap(blob, {premultiplyAlpha:"none"})`, keep the canvas only for
alpha reads (alpha survives exactly), and remember three IGNORES
`texture.flipY` for ImageBitmap uploads — bake `imageOrientation:"flipY"` at
creation or everything renders upside down.
