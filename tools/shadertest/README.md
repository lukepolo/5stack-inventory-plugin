# Paint compositor test rig

Runs the **real** compositor (`src/paintComposite.ts`) and the real paint-definition
loader against real CDN assets in a real browser, then reads the resulting albedo
back off the GPU as pixels.

> **Chasing a skin that renders wrong? Read [DEBUGGING-SKINS.md](DEBUGGING-SKINS.md)
> first.** This README covers the rig; that one covers the method — where to get
> ground-truth shader math instead of guessing, how to bisect the pipeline, the
> measurement mistakes that produce confidently wrong answers, and a catalogue of
> traps in the material format. Keep it updated as you learn more.

## Why this exists

Skins rendered grey for a long time and every "fix" appeared to change nothing.
The reason it took so long: the bug was verified against a *reimplementation* of
the shader (a Python port) rather than the shipped GLSL. A separate model of the
shader only ever proves itself self-consistent. It cannot see:

- a bug in the GLSL itself
- a uniform wired to the wrong value
- a **feature flag that is ignored**, so a placeholder texture gets applied

That last one was the actual bug. `FAMAS | Byproduct` sets `g_bUseOverlay = 0`
but still ships a `g_tOverlay` placeholder — a 1×1 pixel of 0.733 grey with
alpha 1. The code keyed off the texture's presence instead of the flag, and with
`F_OVERLAY_MASK = 0` (gate = 1 everywhere) and `F_OVERLAY_BLEND_MODE = 0`
(straight replace) the result was `cPaint = mix(cPaint, grey, 1.0)` — every pixel
of paint discarded on the very last step. Palette, wear, pattern and cavity were
all correct and all thrown away.

The rig found it on the first run because it reads what the GPU actually produced.

## Running it

```bash
npx vite --config tools/shadertest/vite.config.ts
```

Then open one of:

| page | what it does |
|---|---|
| `http://localhost:5199/batch.html` | runs every fixture + a wear sweep, prints a PASS/FAIL table |
| `http://localhost:5199/?model=famas&pm=/materials/<file>.vcompmat.json&wear=0.4&seed=821` | one skin, full resolved detail as JSON |

Vite proxies `/materials`, `/textures` (→ `cdn.cstrike.app`) and `/models`,
`/paints`, `/api` (→ `inventory.5stack.gg`), so there is **no auth, no deploy and
no cache** in the loop. Edit `src/paintComposite.ts`, reload the page, see the
new GPU output.

Both pages set `window.__done` when finished and expose results on
`window.__result` (single) or `window.__results` (batch), so a driver can poll
and read them without scraping the DOM.

## Reading the output

```
PASS  P90 | Desert Halftone   style=2 overlay=false albedo=[46,30,15] sat=30.2 wear[32,30,27,24,21]
```

- **style** — resolved `F_PAINT_STYLE`. Catches template-resolution regressions.
- **overlay** — whether `g_bUseOverlay` let the overlay through.
- **albedo** — mean RGB read back off the GPU from the composited atlas.
- **sat** — mean per-pixel `max(channel) - min(channel)`. **This is the key
  number.** A composited skin that reads as flat grey is what a
  disabled-but-applied overlay, a fallback palette, or a dropped pattern all
  collapse to. Real skins sit well above the threshold.
- **wear[...]** — mean brightness across float `0 → 0.95`. A flat row means the
  wear chain (durability / cavity / noPaint) is broken again.

Note the albedo is an **unlit atlas**; the `ref` CDN images are **lit renders**.
Compare hue and chroma, never absolute brightness.

## Capturing images

Numbers tell you whether a composite is grey. Only an image tells you the
pattern is the *right* pattern.

```js
const rig = await import('/rig.ts');

// the composited albedo atlas (UV space)
const r = await rig.runOne('ak47', '/materials/sp_mesh_tan_a6d0e8e8.vcompmat.json', 0.265, 624);
await fetch('/__snap', {method:'POST', body: JSON.stringify({name:'safari_atlas', png:r.png})});

// the REAL 3D render, through mountViewer()
const v = await rig.runViewer('ak47', '/materials/sp_mesh_tan_a6d0e8e8.vcompmat.json', 0.265, 624);
await fetch('/__snap', {method:'POST', body: JSON.stringify({name:'safari_3d', png:v.png})});
```

Files land in `tools/shadertest/snapshots/`. The dev server also proxies
`/images/<ref>.webp` from the CDN, so the official render can be pulled through
the same origin and saved next to ours for a side-by-side.

**Compare like with like.** The albedo atlas is UV space — a pattern that looks
blotchy in the atlas is often correct once the model's UVs scale it down.
Judging an atlas against a marketing render will send you chasing bugs that are
not there. Use `runViewer` for anything about how the gun *looks*.

`runViewer` uses `ViewerHandle.snapshot()` rather than reading the canvas: the
renderer runs with `preserveDrawingBuffer` off, so a canvas read outside the draw
call returns blank.

## Adding a fixture

Append to `fixtures.ts`. Get the fields from the inventory API:

```js
await fetch('https://inventory.5stack.gg/api/inventory', {credentials:'include'})
  .then(r=>r.json())
  .then(a=>a.filter(i=>i.item?.paintMaterial).map(i=>
    ({id:i.id, name:i.item.name, model:i.item.model, pm:i.item.paintMaterial,
      wear:i.wear, seed:i.seed, img:i.item.image})));
```

Escape hatches, so the checks stay meaningful instead of being loosened globally:

- `lowChroma: true` — genuinely muted skin, exempt from the grey threshold.
- `paletteFallbackOk: true` — style takes colour from the pattern and carries no
  `g_vColor` palette (style 6), so `[0.5,0.5,0.5]` is correct there.

Prefer adding a fixture with a `note` explaining the trap over relaxing a check.

## Known open issues

All fixtures currently pass. Remaining smaller gaps:

- Rendered weapons sit at roughly **0.8x the reference brightness** (AK Safari
  86 vs 109, FAMAS 91 vs 109). Hue and chroma match; this is only exposure, and
  Valve's marketing renders use their own lighting, so chasing exact parity risks
  over-fitting to two samples.
- `F_OVERLAY_BLEND_MODE` 1 ("Color") and 4 ("Layer") are still **inferred** — the
  shipped shader variant carries no overlay compile. Modes 0/2/3 are standard
  definitions. Any skin leaning on 1 or 4 is unverified.
- `noPaint` is pinned to `0.0`, which makes `F_OVERLAY_MASK = 6` (`gate =
  1 - noPaint`) degenerate to 1. `M249 | Sage Camo` uses mode 6 and matches its
  reference anyway (sat 9.5 vs 10.3), so this is latent rather than broken —
  but a skin that genuinely needs mode 6 to gate would expose it.
- **P90 | Desert Halftone — closed to the residuals.** Two mechanisms:
  `noPaint = ao.a` gated by base metalness (paints the receiver panel and
  magazine block Valve paints, keeps metal hardware bare), and
  **F_SPRAYPAINT_HALFTONE**: the pattern's alpha is a halftone dot SCREEN and
  the colour channels are thresholded against `1 - alpha`, print-style, instead
  of being used as smooth mix weights. That is what produces the reference's
  crisp posterised camo with dot-dithered edges. Rendered result went from
  25.7% relative contrast / 2.2% dark pixels to **33.8% / 6.7%** against the
  reference's 40.3% / 13.1%.

  The threshold direction was chosen by measurement, not taste: `ch vs a`
  measured 21.5%/3.9%, `ch vs 1-a` 25.2%/11.1% on the raw atlas; the earlier
  multiplicative guess (`pm *= a`) was WORSE than baseline. Skins whose
  template does not set F_SPRAYPAINT_HALFTONE (FAMAS, Safari Mesh — also
  style 2) are unaffected, and the suite confirms it.

  Two further corrections calibrated against an IN-GAME capture
  (`snapshots/p90_ingame_ref.png`):
  - **spray pattern scale does not take the weaponLength/36 multiply** that
    wear and grunge take. With it, P90 stripes rendered ~1.8x too coarse (huge
    dots); the vmat's own patternScale (2.75 repeats) matches in-game, and the
    divide-instead hypothesis (x3.37) is visibly too fine. Wear/grunge keep
    their weapon-length scaling — their response is verified by the sweep.
  - the hardware metal gate is smoothstep(0.5, 0.8) on baseRM.g, swept at
    0.05/0.5/0.7 against the in-game shot: 0.5 paints the partial-metal
    fittings the game paints while keeping strong metal and the printed
    serial markings bare (faint versions of those markings are visible in
    Valve's own icon).

  **The translucent magazine, and why the "grey panel" kept coming back:**
  the P90 ships a separate `weapon_smg_p90_mag.glb` sharing the body's texture
  atlas; 61% of its texels sit inside ao.a. Rendering those texels as opaque
  base colour shows the mag's interior (rounds/spring/follower drum) — the
  bright grey "panel with a circle". Rendering them BARE is also wrong: against
  the in-game capture the mag reads as paint seen through smoked plastic. The
  shipped model: paint everything ao.a marks except strong metal
  (`smoothstep(0.5, 0.8)` on baseRM.g), then darken mag texels by ~0.7 via a
  per-weapon `mag.png` UV mask baked at extraction from the mag GLB
  (`TRANSLUCENT_MAGS` in scripts/extract-models.sh — P90 only; an opaque
  painted mag like the AK's must NOT be smoked). The stdlib rasterizer in the
  script was validated at 94.7% IoU against a PIL reference. Until an
  extraction re-run ships mag.png, the viewer degrades gracefully (no smoke).

  **CLOSED 2026-07-19, and the two conclusions above were WRONG.** Both the
  "sight towers take paint" residual and the metalness gate that produced it
  are gone. What was actually happening:

  1. **The gate keyed on the wrong signal.** Unpainted weapon hardware is
     largely POLYMER, not metal — median `baseRM.g` *inside* the ao.a region is
     **0.000** on the P90. `smoothstep(0.5, 0.8)` on it discarded 29.1 of the
     32.2 percentage points ao.a marks, leaving noPaint at 1.8% coverage. Every
     polymer part took paint, and the only texels that survived were the
     high-metalness printed serial markings, which floated on the camo as bare
     grey glyphs. `noPaint = ao.a`, ungated, is correct.
  2. **The gate was tuned against a mismatched mask.** Desert Halftone is
     `legacy=false`, so it renders body_hd — but `loadWeaponInputs` was keyed on
     model alone and always served the LEGACY (`customization/smg_p90`) bundle.
     The two sets are authored against different unwraps: their noPaint masks
     agree on only **55%** of texels, chance for their coverages. The in-game
     sweep that picked 0.5 was compensating a gate for a mask in the wrong
     place. See `loadWeaponInputs` and extract-models.sh §3b — both bundles are
     extracted now and picked by the same flag that picks the body.

  The sights/barrel were never separate-material geometry: `p90.glb` has two
  meshes (body_legacy, body_hd), each ONE primitive with ONE material. There is
  nothing to recover from the model — the game separates paintable regions
  purely by texture mask. It was shader/texture work all along.

  Measured through `runViewer` against the CDN reference (relative contrast /
  dark-pixel share; reference 41.3% / 15.4%):

  | | contrast | dark | mean luma |
  |---|---|---|---|
  | gated + legacy inputs (shipped before) | 30.2% | 5.2% | 111.1 |
  | gated + HD inputs | 30.2% | 4.3% | 113.6 |
  | **ungated + HD inputs (now)** | **33.8%** | **8.5%** | **106.7** |
  | reference | 41.3% | 15.4% | 105.3 |

  **Do not judge this one on the numbers alone.** Ungated + LEGACY inputs scores
  34.6% / 8.3% — the best contrast of any variant — and is visibly the worst
  render of the set: misplaced bare-metal texels smeared across the stock and
  receiver, which is exactly what inflates its contrast. Snapshots
  `p90_gate0_LEGACYinputs.png` vs `p90_gate_0.png` show it immediately.

  RESIDUAL: overall tone still sits slightly flatter than Valve's lit render,
  and dark-pixel share is still short of the reference (8.5% vs 15.4%).

## Measuring contrast against a reference

Mean colour can match perfectly while the skin still looks wrong — that is what
"missing its dark spots" is. Capture both and compare spread, not just mean:

```js
const rig = await import('/rig.ts');
const v = await rig.runViewer('p90', pm, 0.11, 637);   // our 3D render
// pull the official render through the same origin
const ref = await fetch('/images/<ref>.webp').then(r => r.blob());
```

Then, over gun pixels only (alpha > threshold, luma > 40):
`relative contrast = stddev(luma) / mean(luma)` and
`dark fraction = share of pixels below 60% of mean luma`.

Compare the ATLAS to a reference only after converting it: the albedo blit reads
back **linear**, references are **sRGB**. An early version of this comparison
concluded the composite had "0% dark pixels" purely because of that mismatch.

## Gotchas that cost real time

- **A better contrast score can be a worse render.** Artifacts have contrast
  too. Every metric here is a regression tripwire, not a target to maximise —
  when a change moves them, look at the snapshot before believing it.
- **Source2Viewer-CLI's `-f` is a path PREFIX match, not a substring match.**
  `-f "materials/composite_inputs/"` matches zero entries; the real paths start
  `weapons/models/`. A wrong filter here is silent (it just extracts nothing),
  which is the same failure that left every weapon on generic inputs for months.

- **Verify what is deployed before debugging behaviour.** Shader source survives
  minification as a string literal, so `grep -c 'ao4.b' app.js` against the live
  bundle answers "is my fix live?" in one command.
- **Pillow's `resize()` on RGBA is premultiplied.** These textures carry *data* in
  alpha, not opacity, so resizing an RGBA array silently crushes RGB toward black
  wherever alpha is low. Resize each channel separately.
- **`performance.getEntriesByType('resource')` caps at 250 entries** and the cap
  resets on navigation, so app chunks evict the asset loads you care about. Call
  `setResourceTimingBufferSize` *after* load, then re-trigger.
- **The AO map's channel meanings are not what the old comments claimed.** Cavity
  is **B** (mean 0.220 across all 34 weapons, near-zero on flats), not R (0.538,
  a soft AO bake). Verified by wear response: B gives 0–5% stripped at Minimal
  Wear and ~57% at Battle-Scarred; A would strip 8–55% at Minimal Wear.
- **The vcompmat ships placeholder textures for disabled features.** Always gate
  on the boolean (`g_bUseOverlay`, `g_bUseRoughness`, `g_bUseMetalness`), never on
  whether a texture path exists.
- **Loose vs compiled conventions differ.** `g_vPaintDurability` is stored as
  `1 - authored` in the compiled vmat but *authored* in the vcompmat's loose
  variables. Mixing them made `dur = 0`, which zeroes wear-through entirely.
- **Palette values are sRGB in BOTH sources, in different ranges.** The
  vcompmat's `m_cValueColor4` is sRGB 0-255; a compiled vmat's `g_vColorN` is
  sRGB **0-1**, not linear. Safari Mesh stores `[0.4275, 0.4118, 0.3294]`, which
  is `(109,105,84)` — the reference render's exact mean. Consuming it as linear
  gave `(175,172,155)`: too bright and, because sRGB->linear is non-uniform per
  channel, too grey. Symptom is "right pattern, washed out".
- **Do not tune lighting against a suspected shader bug.** The viewer's lights
  were first cut ~1.8x to chase that wash. The wash was the palette bug; once it
  was fixed the scene was under-lit and had to be put back. Fix the data first,
  then calibrate exposure.
- **Judge "wear does nothing" by pixels, not mean brightness.** When a weapon's
  bare metal is about as bright as its paint, stripping barely moves the mean.
  The suite compares 8x8 luma thumbprints across the wear sweep for this reason —
  a mean-based check reported M249 | Sage Camo as broken when it was fine.
