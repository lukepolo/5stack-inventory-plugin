# Gloves, substrate/surface generation — state and open problem

Read `DEBUGGING-SKINS.md` first; this is a companion for one specific subsystem.

`csgo_customglove.vfx` carries **two parameter generations** and a finish uses one
or the other. 73 finishes use the older `g_tDetail` / `g_tLayerMask` set, handled
by `src/gloveComposite.ts` (done, matches the game). 22 use the
`g_tSubstrate` / `g_tSurface` / `g_tLayerId` set, handled by
`src/gloveCompositeModern.ts`. That one rendered with the wrong colours for a
long time; this document is the record of closing that gap.

`src/viewer3d.ts` tries the legacy loader and falls through to the modern one.
Each answers `null` for the other's materials, so the routing is by which
parameters a finish actually carries.

---

## Working right now

- All 22 substrate/surface finishes composite and render (they used to fail
  closed to flat 2D art, because a paintable glove's base mesh is a near-black
  placeholder).
- Pose and framing match the reference sites: both hands flat, side by side,
  backs to the viewer, each legible.
- The legacy 73 are unaffected — verified every round.
- **Colour.** Closed 2026-07-30 against
  <https://csgoskins.gg/items/sport-gloves-ultra-violent>. Six bugs, below.

---

## What the colour gap actually was

Six separate bugs, all found by transcribing `groundtruth/customglove_tint.glsl`
line by line rather than tuning constants. In descending order of effect:

**1. The pattern is a TINT, not a decal.** This was the whole hue problem. The
shader has two pattern branches, chosen by `g_bPatternPaintLayer`:

- `== 0` — `g_tPattern.rgb` **replaces the palette colour** (`_21709`) that then
  gets pushed into the fabric by `tintPush`. The weave survives underneath and
  the hue comes out of tintPush's saturation rebuild.
- `!= 0` — the pattern really is painted over the tinted albedo, as a decal.

We only had the second, applied to the final blended albedo. Ultra Violent takes
the first, and is the case that proves the distinction: none of its eight palette
slots is magenta, and its gradient is only a pale lilac `(169,110,205)`, yet the
glove is vividly magenta in game. That magenta is `tintPush` taking the lilac's
*hue direction*, rebuilding it fully saturated as `(0.805, 0, 1.0)`, and mixing
it in at `k ≈ 0.47`. Drawing the gradient literally gives you the pale lilac and
erases the mesh weave — which is exactly what we were rendering.

The branch is selected per finish by `F_PATTERN_PAINT` (→ `g_bPatternPaintLayer`)
with `F_PATTERN` → `g_bPattern`. Both are 1 on the *shared*
`glove_compositor.vmat`, so they are runtime bools there and the finish's own
vmat picks. 12 of the 22 take the paint-layer branch (flames, pinstripes, the
dragons, Racer 80); the gradient finishes take the tint branch.

**2. AO read the wrong channel — this is the "everything is a bit dark" one.**
`g_tObjectProperties` is `(ao, height, high-touch)`. The shader multiplies by
`_19374.x`; we used `.y`. On `sporty_glove_ao` those means are **0.909 vs
0.506**, so the whole glove's ambient term was roughly halved. Only `.z`
(high-touch, feeding the wear term) was right.

**3. Three of the five colour-adjust matrices were silently identity.** The
matrix name is not the param name. Only four artist stems exist across all 22
finishes — `Surface`, `Substrate`, `Burnishing`, `DamageBevel` — for five shader
matrices. `g_mDamageColorAdjust` is fed by `DamageBevel*`, and the surface and
substrate *burnishing* matrices **share one `Burnishing*` set** (only their
roughness params are per-family). Deriving the stem from the matrix name found
nothing for damage and both burnishing grades, including a
`g_fBurnishingColorBrightness` of 2.312 — the largest number in the material.

**4. The tint amount and the tint mask are different quantities.** The albedo
alpha is the *mask*: how much of the tinted colour replaces the raw colour. The
*amount* fed into `tintPush` is the palette's own alpha (`_14615` / `_6651`).
Passing the mask for both undertinted everything by about half here (alpha mean
0.58). The substrate additionally rides `g_fSubstrateCompositeColorTranslucency`,
which was not applied at all.

**5. `g_fPatternPaintRespectsTintMask` lives in `m_intParams`,** despite the
`g_f`. We read only `m_floatParams`, so it took its default of 0 on all 22
finishes while every material sets it. Valve does not sort params by prefix —
read both maps.

**6. The tint palette's 9-tap kernel stepped by the wrong texel.** It is
`1/textureSize(g_tTintId)` (1024), not `1/compositeSize` (2048). At half a texel
all nine taps hit the same texel, every texel reads as region-interior and the
edge-blur kernel never runs.

Burnishing is now implemented too (it was the handoff's third lead): it grades
the **raw** albedo through the `Burnishing` matrix and replaces the tinted colour
by a `g_v*BurnishingMinMax` ramp on the wear/touch term, also pushing AO to 1.
It is zero at factory new by construction, so it was never the missing vibrance.

---

## Ruled out — do not re-check these

Each cost real time. The evidence is recorded so it is not repeated.

| Suspected | Verdict |
|---|---|
| Missing albedo-levels refit (the fix that transformed the legacy gloves) | **Not applicable.** Combo 5 never references `g_vTextileAlbedoLevels`. |
| Textures not extracted | **Present.** All 38 params resolve; 24 unique files, all on the mount. No extractor work needed. |
| Pattern gated by its alpha | **No.** Pattern alpha is 254–255 throughout. |
| Colour-adjust matrices missing | **Was a real bug, now fixed** — for surface and substrate they are a mild *de*saturation (0.535 → 0.479), so they were never the vibrance. The three that were still identity afterwards mattered more; see #3. |
| Palette used raw instead of sRGB-decoded | **Was a real bug, now fixed** — worth roughly 2× saturation per slot. |
| `input_1.xy` is a second vertex UV set, so the pattern lands in the wrong place | **No.** The VS builds it from UV0 by the standard `g_vPatternTexCoord{Center,Scale,Offset}` transform, exactly as `g_fDamageUvScale` builds `input_4.xy`. The faked transform in the composite is the right shape; `input_1.zw` is the parallax vector a baked composite cannot have. Do not spend a session dumping the VS for this. |
| The two hands disagree, so a sampler is clamping | **No.** They diverged because the pattern was being painted literally instead of tinting; a slot whose gradient sample differs between the hands then reads as a different colour rather than a different shade of the same hue. Fixing #1 resolved it. The RTs were already `RepeatWrapping`. |

---

## Gotchas that cost the most time

**Use combo 5, not combo 1.** Only 6 of 8 static combos exist, and the missing
two are the tell: `S_TINT_ID` never appears without `S_BACKWARDS_COMPATIBILITY`,
so the tint palette belongs exclusively to this generation. Combo 1 compiles it
out — `g_tTintId` is sampled zero times there — and porting it yields a
correctly-lit, completely colourless glove. Ground truth is
`groundtruth/customglove_tint.glsl`. Also note `S_BACKWARDS_COMPATIBILITY=1`
selects the substrate/surface set, not the older-looking one.

**Do not detect the generation by `m_shaderName`.** A finish vmat names
`csgo_customglove_preview.vfx` while the shared `glove_compositor.vmat` it pairs
with names `csgo_customglove.vfx`. The preview vfx is a forward renderer (shadow
buffers, SSAO, BRDF LUT), not a compositor — do not try to port it. Detect on
`g_tSubstrate1` being present.

**Two normal encodings in one shader.** Layer normals
(`g_tSubstrateNormal*`, `g_tSurfaceNormal*`) use `.w`/`.y`; the object normal
(`g_tNormal`) uses `.x`/`.y`. Both through
`nx = (a+b) - 1.00392163, ny = a - b`. Using one swizzle for both drove the
composite normal to a mean of (52, 28, 127) — near fully sideways.

**Roughness is not in the properties map.** The normal texture's other two
channels are not spare: `.x` is roughness, `.z` anisotropy (the shader reads
`_13192.xz`). Properties is `(ao, metalness, cloth, height)`, consistent with its
source files being named `*_ao_*`.

**Colour-adjust matrices are not in the material file.** `g_m*ColorAdjust*` is
`VariableSource=__Expression__`, `VfxType=Float4x4` — the shader builds it from
four artist floats (`ColorTint`, `ColorBrightness`, `ColorContrast`,
`ColorSaturation`). Searching `m_vectorParams` for a 16-float entry finds nothing
and falling back to identity silently discards every layer's grade. Built
CPU-side in `colourAdjustMatrix()`. **Its composition order is inferred**, not
decoded — borrowed from the `csgo_weapon` grade in `charmMaterial.ts`. The DynExp
bytecode would need VRF's function table. If a finish grades visibly wrong, this
is the thing to question.

**Backticks inside GLSL template literals** terminate the literal and produce a
syntax error several lines later. Happened five times this thread, and once more
in the session that closed the colour gap. Do not write markdown-style
`code spans` in shader comments.

**Some min/max pairs are authored inverted.** Tech Gradient's
`g_vSubstrateGrimeMinMax3` is `(0.965, 0.937)`. `smoothstep(a, b, x)` with
`a >= b` is undefined in GLSL and renders differently per driver, so these go
through a guarded `ramp()` rather than `smoothstep` directly. Valve's own shader
calls `smoothstep` raw.

**A param's `g_f` / `g_b` prefix does not tell you which map it is in.** See #5
above. Read `m_intParams` and `m_floatParams` as one namespace.

**Enumerate a GLB's animation clips before writing any geometry code.** Three
attempts to space the hands apart (by material name, by mesh position, by vertex
position) all failed because in `icon_pose` the fingers interleave — no gap, and
the widest axis is finger length, so splitting on it cuts each glove across the
knuckles. The actual fix was one line: the GLB ships `tools_preview_pose`,
`inspect_loop` and `icon_pose`, and we were picking the 64px-inventory-tile one.

---

## How to verify

Shadertest rig, port 5199:

    npx vite --config tools/shadertest/vite.config.ts

- `item3d.html?flat&pm=/materials/glove_sport_tech_gradient_bright_bfbaa94e.vcompmat.json`
  — sources, the eight resolve targets and the three composite outputs as 2D
  images **with mean RGB printed**.
- `item3d.html?gloves` — the 3D suite. The
  `Sport | Tech Gradient (gen 2)` row is deliberately in there: a routing
  regression shows as that one row going black while the legacy rows still pass.

Check **one finish from each pattern branch**, not just one finish. The two are
independent code paths and a change that fixes one can leave the other drawing
nothing. `glove_sport_tech_gradient_bright_bfbaa94e` is the tint branch;
`glove_sport_flames_orange_cb8a3676` is the paint-layer branch and should show
orange flames sitting on a near-black glove.

The flat view's header line now prints `respectsTintMask`, so a param that has
silently defaulted is visible without instrumenting the shader.

**Look at the flat maps and their means before judging a lit render.** Every
wrong turn on both generations came from squinting at a 200px thumbnail and
guessing which of albedo / normal / roughness was off — they are
indistinguishable that way.

**Always compare against a legacy glove as a control.** It goes through an
identical readback path and is verified correct, so its numbers calibrate yours.
Its composite normal reads (121, 128, 245); anything far from that is a decode
bug, not a display artefact. A single number in isolation proves nothing.

---

## Method note

The colour work stalled for a long time because the approach was to paraphrase a
2000-line shader and then tune individual terms when the output looked wrong.
That reliably produces right-structure/wrong-colour and it is slow.

What finally worked, in one pass: read `groundtruth/customglove_tint.glsl`
straight through for the albedo path, following the SSA temporaries by grep
(`_21709` → `_12736`/`_10562` → `_16614`/`_16615` → `_19314`), and check every
transcribed line against the real material JSON. Five of the six bugs above are
things the decompile states outright and the port had guessed at; none needed a
render to find, and none would have been found by adjusting a constant. Fetch the
material and the textures and *measure* them — `g_tObjectProperties`'s channel
means settled #2 in one command.
