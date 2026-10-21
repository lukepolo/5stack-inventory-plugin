# Debugging the viewer: methods and tools

How the fixes in [CHANGELOG.md](../CHANGELOG.md) were found, and how to find the
next one. It covers placement (StatTrak, name tags, stickers), texture spaces,
sticker effects, cards and the extraction. For a **paint/skin that renders
wrong**, start with
[tools/shadertest/DEBUGGING-SKINS.md](../tools/shadertest/DEBUGGING-SKINS.md)
instead; the rig itself is described in
[tools/shadertest/README.md](../tools/shadertest/README.md).

The one rule underneath everything here: **measure against ground truth, don't
reason your way to an answer.** Every bug below survived at least one
self-consistent theory. What settled each one was reading the real file, rendering
the real viewer, or comparing a ratio against an in-game screenshot.

## 1. The loop

| You changed | To see it | Notes |
| --- | --- | --- |
| `src/**` (frontend) | the codepier swap rebuilds in ~6s; reload `/apps/inventory` | the ⚙ dialog shows the build time; an open tab keeps its old bundle until it is reloaded |
| `backend/**` | `node --watch` restarts the API in the swap | a synced edit can miss the watcher: `codepier exec --deployment inventory-backend -- touch /app/backend/src/server.ts` |
| `scripts/extract-models.sh` | ⚙ → **3D Models → Run extraction** | a full run, ~25 min; `models/extract-version.json` says what ran and for how long |
| anything that changes a stored card | ⚙ → **Asset Cache → Clear renders** | cards are baked once and kept |

Before you push, run `npm run check` and make sure no temporary code is left (see
[§3.4](#34-temporary-code-and-pages)).

## 2. Where the truth is

Everything below is served by the backend, so it's reachable with plain `curl`
from your machine (`https://inventory.5stack.gg/...`).

| Source | What it holds | Read it with |
| --- | --- | --- |
| `models/<key>.glb` | the model: bone chain with bind translation/rotation, meshes and their UV sets, and per material `extras.vmat` (shader, int/float/vector/texture params) | `node tools/glb-info.mjs <url> [--uv] [--vmat=<name>]` |
| `models/attachments/<key>.vmdl` | text dump of a gun's or the C4's vmdl: every attachment (`nametag`, `keychain`, `stattrak`, …) with parent bone, relative origin and angles, plus the bone list | `curl`, then read the `_class = "Attachment"` blocks |
| `models/knife-attachments.json` (+ `attachments/knives/*.vmdl`) | the same for all 22 knives, parsed (pipeline v36+) | `node tools/knife-anchors.mjs <url> --dry-run` |
| `models/sticker-masks.json`, `models/<key>.stickermask.{hd,legacy}.webp` | where a sticker may show, per body (R channel, UV0) | open the webp; the R channel is the mask |
| `models/stattrak-art.json`, `models/stattrak/knife_digits_color.webp` | the knife digit atlas with its real alpha cut-out | the alpha channel is the scratch shape |
| `models/extract-version.json` | pipeline version, CS2 build, per-step durations | `curl` |
| `paints/materials/<name>.vmat.json` | a sticker's, charm's or paint's compiled material (`m_shaderName`, `m_intParams`, `m_floatParams`, `m_textureParams`, dynamic expressions) | `curl` + `python3 -m json.tool` |
| `paints/textures/<name>.webp` | the textures those materials name | download and inspect channel by channel |
| `/api/catalog/sticker-bounds/<model>` | sticker slots **per body** (`mesh: body_hd/body_legacy`, offset, scale), bounds, masks, charm quads | `curl` |
| `/api/catalog/sticker-art?image=/images/….webp` | the sticker's real art and its effect doc (holo, glitter, masks, spectrum…) | `curl` |
| `tools/shadertest/groundtruth/*.glsl` | Valve's decompiled shaders (`sticker.glsl`, gloves, liquid…) | read; the TS ports cite their line numbers |
| `backend/src/catalog.ts` | item ids, names, images, paint materials (cs2-lib) | `node --experimental-strip-types -e 'const c = await import("./backend/src/catalog.ts"); console.log(c.getItem(222))'` |
| in-game screenshots | the final judge | compare **ratios**, not pixels; see [§4.1](#41-an-attached-part-is-in-the-wrong-place-or-at-the-wrong-angle) |

If the truth you need isn't in any of these, **get it extracted**
([§4.8](#48-the-data-you-need-isnt-on-the-mount)) rather than fitting numbers to
screenshots. Fitting got the knife StatTrak to "close" twice; the dumped
attachment data showed why it was still wrong.

## 3. Tools

### 3.1 The rig and `mount.html`

The rig serves the real viewer from source and proxies assets to a backend:

```bash
ASSET_HOST=https://inventory.5stack.gg npx vite --config tools/shadertest/vite.config.ts --host 127.0.0.1
```

`tools/shadertest/mount.html` mounts **any item with any options from the URL**:
paint, legacy body, stickers with offsets, StatTrak, name tag, view angles, timed
shots, live or card path, and a `plain` twin for diffing. Its header lists every
parameter. Examples:

```
mount.html?model=knife_flip&stattrak=12345&nametag=Blue%20Gjem&va=0,3.1416&plain=1
mount.html?model=ak47&legacy=1&pm=/materials/cu_ak47_cobra_3f79be43.vcompmat.json&st=/images/a.webp,/images/b.webp&xy=0,0;0.03,0.09&stickerlog=1
mount.html?model=glock&st=/images/lenticular_econometer_7f262dec.webp&still=0&t=0,1.5,3
```

### 3.2 `shoot.mjs`: collect what the GPU drew

```bash
node tools/shadertest/shoot.mjs '<rig url>' out/prefix_ --wait 120000 [--log '\[sticker\]']
```

It runs headless Chrome (with the WebGL flags it needs) and saves every
`#out img` as `<prefix><data-id>.png`. It stops as soon as the page appends
`#done`, prints console lines matching `--log`, and **deletes its Chrome profile
on exit**. Earlier runners didn't, and a day of runs filled the disk (8.8 GB of
profiles).

### 3.2a `shoot-webkit.mjs`: the same, in Safari's engine

```bash
npm i --no-save playwright && npx playwright install webkit   # once
node tools/shadertest/shoot-webkit.mjs '<rig url>' out/prefix_ [--log regex] [--headed]
```

Same contract as `shoot.mjs`, but in headless WebKit through Playwright, which is
kept out of `package.json` on purpose. It also lists failed requests and HTTP
errors. Use it whenever a report comes from Safari or an iPhone and the Chrome
runners can't reproduce it (see 4.9).

### 3.2b `drag.mjs`: move the camera after load

```bash
node tools/shadertest/drag.mjs '<mount.html …&still=0&interactive=1&t=0,60>' out/orb_ \
  --drags '0,120;0,120;0,120' --after 300,3000 [--browser webkit]
```

`ve`/`va` place the camera before the first frame, so anything that settles on
its first frames (charm cloth, liquid) has already adapted to that view. This
mounts a live viewer, drags with the real mouse, and screenshots each step at
each `--after` delay. Same Playwright setup as 3.2a.

### 3.3 Reading renders

- **Diff to find the feature.** Shoot with `plain=1`. The bounding box of
  `|with − plain|` is exactly where the StatTrak plate, name tag or sticker drew,
  so you can crop to it automatically. That's how 22 knives were checked at once.
- **Contact sheets.** Paste the crops into one image (Pillow) to compare a
  variant across every model, front and back (`va=0,3.1416`).
- **Diff two frames** of a live shot (`still=0&t=…`), amplified ×4, to see what
  an animation changes. This is how the holo bands were confirmed to move.
- **Measure, don't squint.** Count bright pixels, 99th-percentile luminance, or
  bbox areas when the question is "did anything happen". A glint that "should be
  visible" measured as 0 pixels until the light geometry was fixed.

### 3.4 Temporary code and pages

Fast experiments need throwaway code. Keep it findable:

- One-off rig pages go in `tools/shadertest/zz-*.ts`/`.html`. Copy `mount.ts`
  and add what you need; delete them before committing.
- Experiments inside `src/` are gated on a URL parameter (for example
  `new URLSearchParams(location.search).get("zzknife")`) and marked with a
  `/*ZZ_TMP*/` comment. Before every commit:
  `grep -n ZZ_TMP src/*.ts` must print nothing.
- A temporary measurement can write to a global (`globalThis.__zzKnife = […]`),
  and a rig page can print it into `#out`, so `shoot.mjs` shows it.

### 3.5 Viewer debug switches

They're read from the query string (`?name=1`) and from the dev-flags HUD; the
registry is `src/devFlags.ts`.

| Switch | Shows |
| --- | --- |
| `stickerlog` | every sticker build: the UV1 it asked for, the anchor, triangles cut, or `REBUILD ABORTED … no surface for uv1 …` |
| `uvdecal` | on by default: stickers cut out of TEXCOORD_1, as the game does; off falls back to the old projection |
| `nameplateprobe` | boxes at the name plate's placed and raw anchor positions, plus its measured seating |
| `charmmap` | paints the model's authored charm surfaces on the weapon |
| `charmquads` | on by default: the authored charm surfaces seat the default charm and bound a drag |
| `pivotdot` | a dot at the point an orbit drag rotates around |
| `perf` | per-frame timing HUD |
| `inspectanim` | the idle inspect motion (also gates the holo drift) |
| `globalThis.__stDebug = true` (in a rig) | StatTrak placement and readout clearance, logged as `[st]` / `[st-clear]` |

**Live vs card path.** `still: true` (cards, bakes) and the live viewer differ:
the live one runs a render loop with inspect idle motion and holo/lenticular
animation. A bug in one may not exist in the other, so test the path the user
saw.

### 3.6 The real UI, locally: `tools/standalone`

For anything in the app around the viewer (craft sheet, editor, filters), run
the real UI against a fake inventory:

```bash
VITE_INVENTORY_API=http://127.0.0.1:8787 npx vite build --outDir /tmp/inv-dist --emptyOutDir
ASSET_HOST=https://inventory.5stack.gg MOCK_INVENTORY=tools/standalone/inventory.example.json \
  node --experimental-strip-types tools/standalone/mock-server.mjs /tmp/inv-dist
node tools/standalone/drive.mjs http://127.0.0.1:8787/ tools/standalone/steps.example.json out/ 1400 900
```

`mock-server.mjs` answers the signed-in endpoints itself and the knife/glove
catalog from your working tree's `catalog.ts`; everything else is proxied.
`drive.mjs` runs a JSON list of steps (JS to run, wait, screenshot) and prints
console errors. Saves don't work (there's no session), and a "saving it failed"
notice for card renders is expected.

### 3.7 Data tools

- `node tools/glb-info.mjs <file|url> --uv` shows the bone chain, UV ranges per
  set, and how many vertices fall outside [0,1].
- `node tools/knife-anchors.mjs <knife-attachments.json|url> [--dry-run]`
  regenerates the knife StatTrak anchors from game data and checks the knife name
  tags against it.
- **Offline simulation.** Before changing GLSL, re-implement the formula in a
  few lines of Python against the real textures and sweep the free variable.
  The lenticular fix started with a 30-line simulation that showed the needle
  sweeping ECO → FORCE → BUY as the view term changes.

## 4. Methods by problem

### 4.1 An attached part is in the wrong place or at the wrong angle

StatTrak modules, name plates and charms hang off **attachments** in the model.

**Spaces.** Model space is Source inches: X forward, Y left, Z up. The GLB root
node swizzles to glTF as `glb = (srcY, srcZ, srcX) × 0.0254`. An attachment's
origin and angles are **relative to its parent bone**, and bones are relative to
their parents. Knife models stand blade-up, so a missing bone offset along Z
moves a knife counter *along the blade*.

**The anchor files.** `src/stattrakAnchors.json` and `src/nametagAnchors.json`
use one convention, which `placeAttachedModule` in `src/viewer3d.ts` relies on:

- `bone`: the parent bone, whose pose the module follows (a folding knife's
  counter rides its blade).
- `src`: the bone's bind position plus the **unrotated** relative origin; the
  viewer applies the bone's bind rotation as `R(src − bonePos) + bonePos`.
- `angles`: the relative QAngle.

`tools/knife-anchors.mjs` documents and implements it.

**Rotation.** A Source QAngle `[pitch, yaw, roll]` is `Rz(yaw)·Ry(pitch)·Rx(roll)`.
In the module's glTF basis that is a three.js `Euler(pitch, yaw, roll, "YXZ")`:
`placeAttachedModule(…, sourceAngles = true)`. It's proven on all 22 knife
StatTrak plates (coplanar with the blade, facing outward), the C4 name tag and the
knife name tags. Gun StatTrak anchors are unrotated, so no convention mattered
there. Gun name tags still use upstream's surface search.

**Bones turned at bind.** The Shadow Daggers' `weapon_r` stands at 90°.
`PoseBones.bind` (from the skin's inverse bind matrices) supplies that rotation.

**Measure placement with raycasts**, in temporary code after the module is placed:

- Take the plate's thinnest bbox axis as its normal; its dot product with the
  surface normal under it says whether it's coplanar.
- Its dot product with the camera direction says which side of the item it's on.
- Rays from in front of the plate at its centre and inset corners give the gap
  to the surface, or how deeply it's buried.

`seatKnifePlate` and `seatPlateOnSurface` turned those measurements into the
seating that ships.

**Compare with the game by ratios.** In-game shots have perspective and a
different camera. Measure a position as a fraction along a feature (for example,
"the digits run from 45% to 63% of the way from tip to pivot") and check the
digit order and which edge they're near. The Flip knife's fix was verified that
way: 41–62% in ours against 45–63% in game.

### 4.2 A texture is read in the wrong place

Most "layers are offset" or "upside down" bugs are texture-space mismatches.
Check, for every texture involved:

- **Flip.** glTF textures use `flipY = false`. three **ignores `flipY` on
  `ImageBitmap`**, so bitmaps are flipped at decode (`imageOrientation: "flipY"`);
  a `CanvasTexture` defaults to `flipY = true`.
- **Crop.** `loadStickerTexture` crops sticker art to its ink, re-squares and
  flips it. The game's effect textures (holo mask, spectrum, normal/roughness,
  scratches) are uncropped, so `stickerShader.ts` reads them through the crop it
  records (`stkArtUv`, the `STK_UV` line).
- **Wrap.** Game samplers wrap. Legacy bodies tile UV0 far outside [0,1] (the
  legacy AK runs v −4…3.4; check with `glb-info --uv`). The holo spectrum's U is
  pushed past 1 by the view term. A clamped sampler reads the border in both
  cases.
- **Premultiplication.** A 2D canvas stores premultiplied colour, so texels with
  alpha 0 come back black. Take an alpha cut through `alphaAsMask` and keep the
  colour from an opaque source; decode with `premultiplyAlpha: "none"` where it
  matters.
- **Test with something asymmetric.** A rainbow holo hides a flip; Econometer's
  needle doesn't.

### 4.3 A shader effect doesn't match the game

1. Read the decompile in `tools/shadertest/groundtruth/` and transcribe it term
   by term. The ports cite line numbers, and approximations are listed in the
   file header (see `stickerShader.ts`).
2. Simulate offline with the real textures ([§3.7](#37-data-tools)) to know what
   the correct output looks like before debugging the GPU.
3. For an engine constant the decompile can't give you (a light direction, a
   level vector), **calibrate it on one in-game screenshot and document it**:
   `STK_HOLO_LIGHT = 0.6` puts Econometer's needle on FORCE head-on, as in game.
4. Anything time- or camera-dependent belongs to the live viewer only
   (`uHoloLive`, driven by `stepStickerHolo` in the render loop). Cards stay
   deterministic.

### 4.4 A sticker is missing or cut

1. `?stickerlog=1` (with `shoot.mjs --log '\[sticker\]'`) tells you whether the
   build failed (`no surface for uv1 …`) or cut fine.
2. Slots are per body. `sticker-bounds` lists `body_hd` and `body_legacy`
   anchors, and **the legacy body only loads with a legacy paint**: testing
   "legacy" with no paint silently renders the HD body.
3. Look at the UV1 islands around the anchor. On the legacy AK the handguard
   slot's anchor sits 0.002 outside its island, in a `sticker_gaps` strip;
   `uv1ToSurface` now searches within the sticker's own footprint.
4. Render with `&nomask=1` to tell mask problems from placement problems.

### 4.5 A material parameter seems ignored

- Valve doesn't always file params by their prefix. Eight finishes keep the
  float `g_flPatternTexCoordScale` in `m_intParams`, so the loader reads both
  lists.
- Feature switches can live on `F_` combos rather than `g_b` params: older
  gloves turn their print on with `F_PATTERN`, not `g_bPattern`. A switch can
  also gate a different texture binding (`g_bOverrideDefaultMasks`, AWP |
  LongDog).
- Dynamic params are bytecode expressions over the pattern (`evalVfx` in
  `charmMaterial.ts`). `PINNED_TO_PREVIEW` lists any we deliberately evaluate at
  pattern 1; it's empty now.

### 4.5a The decompile and the game disagree

The decompile is the best source we have, but its variable names can be wrong.
`g_flTintSaturateSticker0`, read as decompiled, turned every foil sticker grey;
the game's own icons for five metal stickers (two golds, two foils, one metal
holo) all matched the opposite reading, so the shader uses `1 - value`. When
in doubt, check the item's icon on the mount (`/images/<name>.webp`) — it is a
render the game made.

Placement conventions are the same kind of trap. The Gen2 glove pattern was
scaled about its centre, which looked reasonable and was wrong by a quarter of
the artwork; scaling from the origin, as the fabric layers and the weapon
compositor already did, matched an in-game screenshot of the same pattern
number exactly. Compare one specific pattern number against the game before
trusting a transform.

Read which *inputs* a term uses, not just its shape. The holo/lenticular view
term `dot(V,N) + dot(V,L)` takes the GEOMETRIC normal (`_24347`, the
interpolated vertex normal), not the normal-mapped one. Feeding it the bumpy
per-pixel normal made lenticular frames flicker texel by texel; amplifying it
and drifting the light made stickers animate on their own, which the game never
does.

Check what the EXTRACTOR did to a texture before decoding it the game's way.
Source2Viewer's default (`--texture_decode_flags auto`) unpacks some formats on
export: a hemi-octahedral normal map (`HemiOctIsoRoughness_RG_B`) comes out as a
plain RGB normal with its roughness moved from blue to alpha. The sticker shader
ran the game's hemi-oct decode over it and read roughness from blue (the
rebuilt z, ~1), so every sticker was fully matte and deep relief spiked. The
test: if blue equals `sqrt(1 - x² - y²) * 0.5 + 0.5` from red and green, the
texture was already decoded.

### 4.6 A card is wrong or stale

Cards are baked once and kept, under a filename made of the instance id, wear,
pattern, StatTrak flag, pet coat/stage, `card_look` (a fingerprint of the
stickers and charm, computed by the backend's `cardLook` and sent with every
inventory row) and the extraction version. Anything the card draws that is not
in that name will NOT re-bake when it changes. The viewer reports a failed paint
(`paintFailed`), and the bake returns null and is retried. A frame with under 2%
lit pixels (`BLANK_BAKE_LIT`) is refused. Anything already stored needs **Clear
renders**. Card and composite keys include `EXTRACT_VERSION`, and the
composite generation also hashes `VALVE_RUNTIME_REV` and `INPUT_DECODE_REV`;
bump one to force a re-bake after a change that alters stored art. A bad
picture that the client did not flag as failed (the Safari Doppler cards) is
already stored under the current key, so it needs **Clear renders** as well.

### 4.7 Something stutters

Time the operation (`performance.now()` around it, or the `perf` HUD) before
optimising. Glove repaints took 60–100 ms because three frees a compiled program
once nothing holds its material, so a material made per pass recompiled every
time. Keeping one live material per pass and refilling its uniforms brought it to
about 1 ms.

### 4.8 The data you need isn't on the mount

Add an extraction step to `scripts/extract-models.sh`:

1. An `if step_if "<id>"; then … fi` block, the id in the `STEPS=(…)` array (the
   order is the panel's list), and a label in `AdminConsole.vue` and
   `src/locales/en.json`.
2. Bump `EXTRACT_VERSION` and write a `# vNN` note saying what and why. The bump
   is also the "your mount is behind" signal and re-keys every card.
3. Pull from the archive with the VRF CLI already in the script:
   - `-d -f <paths> -e vmdl_c` writes **text** vmdl with attachments and bones.
   - `-d -f <file>.vtex_c` writes a PNG **with alpha**; the glTF export drops it.
   - Encode with `cwebp -exact -lossless` (keeps RGB under alpha 0). Keep raw
     dumps on the mount so a parser fix doesn't need another run.
4. The node has `python3` but no imaging library. Read PNGs with `zlib` (see
   `png_alpha_range` in the stattrak-art step).
5. Test the step's Python locally before shipping. Pull the heredoc into a file,
   then run its functions on a downloaded sample (the C4's attachment dump, a
   generated RGBA PNG). `bash -n scripts/extract-models.sh` checks the shell.

### 4.9 It works in Chrome but not in Safari

Every runner above is Chrome. When the user's screen disagrees with a Chrome
render of the same item, rule out the data first, then the browser:

1. Same build, same assets, same item in `mount.html` under Chrome. If that is
   right, the assets and the item data are not the problem.
2. The shared composite store (`/api/composites/<gen>/<stem>…`) for that stem.
   Nothing stored means the bad picture is made on the user's machine.
3. `shoot-webkit.mjs` on the same URL. If WebKit reproduces it, swap things
   between a failing and a working model until one difference explains it.

The Safari Doppler bug went exactly this way. The Bayonet and Flip Knife use the
same Doppler material, and in WebKit the Flip painted while the Bayonet came out
bare. Their composite inputs differed in one way: the Bayonet's `masks.png` has
alpha 0 on every texel, the Flip's on all but a handful. A 30-line page that
uploads each file to a WebGL texture and reads it back showed WebKit returns
all zeros for a fully transparent image, with
`UNPACK_PREMULTIPLY_ALPHA_WEBGL` off, while Chrome returns the stored bytes.
`createImageBitmap({premultiplyAlpha: "none"})` was worse in WebKit, not
better. `src/rawPng.ts` now probes for the behaviour once with a 1×1 PNG and,
where it is present, decodes the input PNGs itself. Its output was checked
byte-for-byte against Pillow on every input of four knives.

To check a texture this way, upload it to WebGL with the same `pixelStorei`
settings three uses, read it back through a framebuffer and compare channel
means between `webkit` and `chromium` in Playwright. `getImageData` on a 2D
canvas can't tell you, because 2D canvases are premultiplied in every browser.

### 4.10 It only goes wrong after the camera moves

The Butane Buddy flooded when the user turned the view over the gun, and shots
with `ve` at the same angle looked fine. Two separate faults, found in order:

1. Shots at `ve=0…1.3` (static camera) flooded from 0.5 up. The back-wall term
   (`s.back`, `g_flLiquidBackOffset` × `sat(vdg)²`) reached past the whole
   vessel. It is now capped by an exact ray test: a texel counts as liquid only
   if its view ray meets the surface plane inside the vessel.
2. That fixed static shots, but a live drag (`drag.mjs`) still tilted the fill
   and then flooded it. Cause: an attached charm hangs along the **camera's**
   down (`charmGravity`, the game's inspect: the gun turns, gravity doesn't),
   while the liquid measured height along world +Y on the un-skinned bind pose.
   Once the cloth swung the ball, the two disagreed. The liquid now takes the
   same gravity (`stepCharmLiquid` passes the camera's up) and measures height
   in world space on the skinned vessel (`vLqRw`, `vLqHeight`).

Two lessons: test motion with motion, and when one system already models a
physical quantity (here gravity, in the cloth), make the others read it from
there rather than keep their own. The world-space height first flooded the
ball because the charm's ~4cm scale lives in its bones, not `modelMatrix`;
read the scale off a skinned vector.

### 4.11 Sticker scratch wear looks wrong

Ask for in-game shots of ONE weapon with several stickers at a handful of
sticker wears (0, 0.15, 0.5, 0.85, 1 worked), then render the same item at the
same wears with `mount.html?…&st=…&xy=…&sw=<wear>` and crop each sticker into a
grid beside the game's. Compare what survives, not brightness.

What decides it, from `groundtruth/sticker.glsl`: the shader takes
`g_flSticker0Wear` as is (no curve on the GPU side), and the ART'S ALPHA is a
wear-order map. Bytes 0-20 are the coverage ramp; above that, the higher the
byte the later it wears, so outlines (255) survive even at 1.0. Per sticker,
`g_vWearBiasSticker0` and `g_fWearScratchesSticker0` shape it. Holo and
lenticular layers only recolour (`sticker.glsl` ~640-680); the wear still reads
the art's alpha. The 2026-10-21 check against an AK-47 with five stickers
matched at every wear, the Econometer (Lenticular) window included.

Zoom before calling a difference. At 200px crops of a phone-sized screenshot,
the Econometer's window looked cleared at 0.85 and its band looked scratched at
0.15. At 3x on the same frames the window is kept (as its alpha of 255 says)
and the "scratch" was the handguard seam. Measure mean colours inside the
sticker against bare paint beside it.

A flat simulation of `WEAR_GLSL` in Python is a quick cross-check, but load the
scratch map as its R channel BEFORE resizing: its alpha is 0, Pillow
premultiplies RGBA on resize, and the scratches silently become all zero. That
made a correct shader look like it under-wore.

## 5. Gotchas

- **Disk.** Headless Chrome profiles are large; use the runners in this repo,
  which delete theirs.
- **An attached charm's gravity is the camera's down**, not world −Y. Anything
  physical on a charm (cloth, liquid) must use `charmGravity`'s axis.
- **Alpha is data in the composite inputs.** `masks.png` alpha is unused and 0,
  `ao.png` alpha is noPaint. Any loader for them must keep RGB under alpha 0,
  which Safari's image path does not do for a fully transparent file; go
  through `loadRawPngTexture` (src/rawPng.ts).
- **Headless WebGL** needs `--use-angle=swiftshader --enable-unsafe-swiftshader`;
  without them every render is blank and looks like a shader bug.
- **The live path needs an on-screen host.** An off-screen host can be treated
  as hidden; `mount.html` places live viewers on screen.
- **Wait for the composite.** Painted items need seconds before the snapshot
  (`settle` in `mount.html`); an early shot shows an unpainted model.
- **Sticker decals live in the scene, not under the weapon object.** Anything
  that walks `object` to find them finds nothing; use the `liveMesh` slot map.
  The live holo animation silently did nothing until this was found by logging
  how many holo materials it saw.
- **Scripted clicks are not user gestures.** Audio `play()` is refused in
  headless Chrome unless it runs with `--autoplay-policy=no-user-gesture-required`
  (`drive.mjs` passes it); without it every preview reads "Preview unavailable".
- **`src/viewer3d.ts.tmp.12606.f232a5218f7d` is an upstream file**, committed by
  accident upstream. Leave it alone so merges stay clean.
- **`BAKE_ENVIRONMENT`** in `src/viewerEnvironments.ts` must stay `"studio"` in
  commits; switch it only for local bake experiments.
- **In-game screenshots are not orthographic.** Compare ratios and sides, never
  absolute pixel positions.
