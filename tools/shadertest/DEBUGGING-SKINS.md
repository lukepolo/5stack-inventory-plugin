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

    https://cdn.cstrike.app/images/<image>.webp

The craft URL id is the cs2-lib item id: `/apps/inventory/craft/<id>`.

## Step 2 — read the material chain before touching code

```
vcompmat  (per-skin, loose variables)  ->  template vmat  (compiled, shared)
```

Fetch both from `https://cdn.cstrike.app/materials/<file>.json` and dump every
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

**Not everything is baked.** Glitter, pearlescence and iridescence are RUNTIME
weapon-material effects (`src/paintSfx.ts`), not compositor ones. The compositor
owes them only the SFX mask, written into the rough/metal map. If an effect is
view-dependent it cannot live in the composite.

**Styles 2 and 5 are PROJECTED.** They do not sample the pattern in paint-UV
space at all — they build the coordinate from `g_tPosition` via a triplanar
projection. Any reasoning that assumes paint-UV sampling is wrong for them.

**A green extraction run proves nothing about completeness.** v2 stamped
successfully, exited 0, and silently dropped `g_tPosition` from all 89 weapons
because the copy loop only accepted `.png` and that map is `.exr`. Check the
per-weapon `meta.json`, not the exit code.

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
