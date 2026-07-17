# Paint compositor test rig

Runs the **real** compositor (`src/paintComposite.ts`) and the real paint-definition
loader against real CDN assets in a real browser, then reads the resulting albedo
back off the GPU as pixels.

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
- **Contrast gap: P90 | Desert Halftone.** Partly closed. Restoring `noPaint`
  (see below) took it from 26.6% relative contrast / 2.4% dark pixels to
  30.2% / 6.6%, against a reference of 40.3% / 13.1%. The sights and muzzle
  brake are now correctly bare metal instead of camo-painted.

  Remaining: with `noPaint` restored, a large mechanical panel on the P90 body
  renders as bare grey where the reference shows camo. The mask is binary
  (61% at 0, 32% at 1) so no threshold separates that panel from the genuine
  hardware, and the weapon materials are FrontSide, so it is not a backface
  artifact. Most likely the extracted mask marks interior shell faces that our
  render is showing but Valve's is not.

  Hypotheses tested against the rig and REJECTED by measurement — do not retry
  without new evidence:
  1. reversed-edge `smoothstep` UB in `paintEdgeLayers` — byte-identical output
     (fixed anyway, it was genuinely undefined behaviour);
  2. pattern read as sRGB rather than raw — 28.6% / 2.7%, barely moved;
  3. halftone alpha modulating the selection (`pm *= pattern.a`) — 25.3% / 1.5%,
     worse;
  4. pattern scale wrong — swept 1x to 6x, contrast flat at 26-29% throughout;
  5. **triplanar projection.** Valve's workshop docs say the pattern is "applied
     via triplanar mapping" and the template ships an unused `g_tPosition`, so
     this looked strong. Baked a UV->object-position map from the GLB and
     sampled the pattern triplanar across five scales: 14.3-14.9% albedo
     contrast versus 16.9% for plain UV. No better.

  Bisecting the pipeline with debug taps showed contrast is already flat at
  `cPaint` (15.7%) before grunge, levels and wear — so the ceiling is the
  paint-by-number mix, not anything downstream. Alternative mixes were also
  measured: normalised weighted sum 15.4%, hard argmax 19.8%, sharpened
  channels ~20%. None reach the ~28-30% the reference implies, which suggests
  the remaining difference is in the *lighting* contrast of Valve's render
  rather than the albedo.

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
