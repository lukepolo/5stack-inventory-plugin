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

Saved decompiles live in `tools/shadertest/groundtruth/`.

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
