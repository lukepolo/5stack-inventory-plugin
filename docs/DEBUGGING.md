# Debugging the viewer: methods and tools

How the fixes in [CHANGELOG.md](../CHANGELOG.md) were found, and how to find the
next one. It covers placement (StatTrak, name tags, stickers), texture spaces,
sticker effects, cards, the extraction and 3D load time. For a **paint/skin that renders
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
| `models/keychain-anchors.json` | every gun's and the C4's attachments with their parent bone, parsed (the Dual Berettas' `keychain`, `stattrak` and `nametag` hang off `weapon_r`) | `curl` |
| `anims/<stem>.<action>.json` | one first-person clip: `source` (the `.vnmclip_c` it was decoded from), duration, the arm tracks, the weapon's own `prop` tracks and the sound cues | `curl … \| jq .source`; a `_default_*` folder means the weapon fell back to its family's generic clip |
| `anims/index.json` | which actions each weapon has a clip for; first person offers a button only for these | `curl` |
| [`pak01_dir.txt`](https://github.com/SteamDatabase/GameTracking-CS2/blob/master/game/csgo/pak01_dir.txt) (SteamDatabase) | every file in the game's main VPK, by path | `grep`; finds a clip folder without a CS2 install (the C4's is `animation/anims/viewmodel/equipment/c4/`) |
| `models/<key>.inputs[.hd]/meta.json` | a weapon's composite inputs; `textures2048` names the 2048 copies of the ones over 2048 (v39+, HD guns only) | `curl` |
| `models/**/*.{glb,json}.gz` | gzip copies the servers send instead (v39+); deleted at the start of every extraction, rewritten by its last step | `curl -H 'Accept-Encoding: gzip' -I` |
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
| `dualside` | the Dual Berettas laid out parallel instead of in the icon's tent (the layout the viewer had before 2026-10-21) |
| `notwist` | first-person arms without the forearm twist solver, to tell whether the solver is what is wringing an arm |
| `fpvfov` | first-person field of view in degrees (default 54, CS2's viewmodel_fov 68 converted); a wide one finds what is just off screen |
| `perf` | per-frame timing HUD |
| `inspectanim` | the idle inspect motion (also gates the holo drift) |
| `compositelog` | every composite store lookup: generation, stem, `HIT`/`MISS`, uploads (not in the HUD) |
| `prefetchlog` | every prefetch warm (`start`, `ready`, `missing`), every file a loader took from it (`HIT`, `loader waits for`), and `window.__prefetch.stats()`; see [§4.16](#416-opening-an-item-in-3d-is-slow) |
| `noprefetch` | turns prefetching off, for timing a cold open against a warm one |
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
It also keeps its own in-memory composite store (uploads and reads), so the
store can be exercised end to end without touching a real one; see
[§4.13](#413-checking-the-composite-store).
`drive.mjs` runs a JSON list of steps (JS to run, wait, screenshot) and prints
console errors. Saves don't work (there's no session), except item edits and
card uploads, which the mock keeps. Cards go through the backend's own
`cardStore.ts`, so they're stored and served as the real backend would.
`CARDS_DIR=<dir>` keeps them between runs (as `inst-<id>.png|.webp`), and
`MOCK_CARD_FORMATS=png` plays a backend from before WebP cards
(`refuse-webp`: one that advertises WebP but refuses it); see
[§4.6](#46-a-card-is-wrong-or-stale).

Two switches on the mock matter for anything about load time:

- `MOCK_CARDS=stub` answers every card with a placeholder, so the card backfill
  never runs. Without it, every card-less item is baked on load, and each bake
  pulls the same GLB and composite into the viewer's caches that the open you
  are timing would have fetched.
- The mock always keeps the paint composites it is sent (in memory, checked
  like the backend checks them), so the first open of a skin stores it and the
  next browser session gets a store HIT. Anything it does not hold is a 404,
  i.e. a MISS; `MOCK_COMPOSITES=keep` instead reads those through from the dev
  backend's store, for timing a HIT on skins someone opened against the dev
  mount.

### 3.7 Data tools

- `node tools/glb-info.mjs <file|url> --uv` shows the bone chain, UV ranges per
  set, and how many vertices fall outside [0,1].
- `node tools/knife-anchors.mjs <knife-attachments.json|url> [--dry-run]`
  regenerates the knife StatTrak anchors from game data and checks the knife name
  tags against it.
- `CHUNKS=App-,viewer3d- npx vite build --config tools/bundle-report.config.ts --outDir /tmp/inv-report`
  prints what is in each named chunk and what loads with it ([§4.15](#415-the-first-load-is-heavy-or-something-downloads-before-it-is-needed)).
- `python3 tools/hdr-half.py <in.hdr> <out.hdr>` halves a Radiance HDRI in
  linear light. It is how `src/assets/venice_sunset_512.hdr` was made.
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

**Which file a card is.** The key still ends in `.png`, but that is only its
name: a card is stored as `<stem>.webp` or `<stem>.png`, and
`/api/renders/<key>` (and nginx's `/renders/`) answers with the WebP if there
is one, the PNG otherwise, each under its own Content-Type
(`backend/src/cardStore.ts`). Check what you're getting with
`curl -sI https://inventory.5stack.gg/api/renders/<key> | grep -i content-type`.
Anything that looks a card up by its key must go through `findCard`/`readCard`;
a `stat` on the bare key misses every WebP card.

How a card becomes WebP depends on who baked it:

- Chrome and Firefox encode it themselves at quality 0.9 (`src/cardEncode.ts`),
  checked by its magic bytes.
- Safari can't: WebKit's `toBlob("image/webp")` silently hands back a PNG. It
  uploads the PNG and the backend transcodes it with `cwebp -q 90 -sharp_yuv`.
  A backend without `cwebp` (a bare dev run) stores the PNG.
- A client only sends WebP when `/api/catalog` lists it in `cardFormats`. An
  older backend doesn't, and 400s anything but a PNG, so it keeps getting PNGs.
  If a WebP is refused anyway, the PNG follows and WebP is off for the session.

Cards stored before this stay PNGs and keep being served; they become WebP when
they're next baked (the next extraction re-keys them all). The quality was
picked by measuring 16 bakes against their PNGs (the table is in
`cardStore.ts`); re-run that before changing it. To test a pairing locally, run
`tools/standalone` with `MOCK_CARD_FORMATS` ([§3.6](#36-the-real-ui-locally-toolsstandalone))
and watch the mock's `card <id>: got … stored …` lines.

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
   `png_alpha_range` in the stattrak-art step). For per-pixel work over whole
   images use Node instead (typed arrays, zlib on a thread pool):
   `scripts/lighten-assets.mjs` has an 8-bit PNG decoder and encoder.
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

### 4.12 An asset re-downloads on every load, or a stale one sticks

The rules are in [CACHING.md](CACHING.md); this is how to tell which one broke.

1. **Read the headers the browser got**, with the URL the client really asked
   for (DevTools → Network → copy as cURL, or build it: `?v=` is the catalog's
   `assetVersion`):
   `curl -sI -H 'Accept-Encoding: gzip' '<url>' | grep -i -e cache-control -e etag -e content-encoding -e content-type -e cf-cache`.
   No `?v=` on a mount URL means the caller skipped `withAssetVersion`; a
   `content-type: application/octet-stream` on a `.glb` means the answer came
   from a server without these types.
2. **Find out which server answered.** nginx sends `server: nginx` and no
   `vary: Origin`; the backend sends `vary: Origin, …` (from @fastify/cors).
   Behind Cloudflare both are hidden, so ask the pods directly with
   `kubectl -n 5stack exec deploy/inventory-frontend -- wget -qSO /dev/null 'http://127.0.0.1/models/ak47.glb'`.
3. **Reproduce it locally** before changing a server. `nginx.conf` runs as is
   in `docker run --rm -p 127.0.0.1:8811:80 -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" -v <tree>:/cs2-models:ro --add-host inventory-backend:host-gateway nginx:alpine`
   against a few real files downloaded into `<tree>/models/…`;
   `nginx -t` in the same image validates it. The backend runs locally with
   `MODELS_DIR`, `PAINTS_DIR`, … pointed at the same tree (it needs a Postgres;
   a throwaway `postgres:16-alpine` container does), and `scripts/serve.mjs`
   takes the same variables. Running the same `curl` list against all three is
   how they were checked against each other.
4. **Check the decoded bytes, not just the headers.** `curl --compressed` the
   file and compare its hash with the file on disk; a gzip body under the wrong
   type or a stale `.gz` "loads" fine and is wrong.

`npm run check:assets` covers the shared Node logic (ETags, 304s, `.gz`
freshness, ranges, HEAD).

### 4.13 Checking the composite store

The composite store fills as people open skins in 3D: the first viewer of a
skin composites it and uploads the pair, and every later viewer and card bake
of that skin loads the pair instead of the weapon's composite inputs. Card
bakes read the store but never write it, and the upload route only accepts a
skin the uploader owns. `EXTRACT_VERSION` is in the composite generation, so a
new extraction starts an empty store.

- `?compositelog=1` logs every lookup, upload and refusal (`[composite] …`).
  A `key drift` line means `compositeKey` and `compositeStem` disagree, and
  nothing will ever hit. Only the stem and kind count: Safari's canvas can't
  encode WebP and sends a PNG under the `.webp` name, and the backend names
  the file by its bytes (transcoding to WebP when ImageMagick is there), so a
  different extension is expected.
- Open a skin twice with `?compositelog=1`: the second open (and a card bake)
  must log `HIT` for the stem the first one stored.
- Locally, against the mock: build with `VITE_INVENTORY_API`, start
  `mock-server.mjs` with an inventory that has the items you care about, and
  open them in 3D. The mock rejects any upload whose filename is not the
  backend's stem, and `GET /__mock/composites` lists what landed.
- To prove a stored pair is bit-identical to a fresh render, open the skin with
  `?compositeverify=1` ([§4.9](#49-it-works-in-chrome-but-not-in-safari)
  explains why that matters for Safari).

### 4.14 Making an asset smaller without changing what renders

`scripts/lighten-assets.mjs` (steps `inputs-2048` and `precompress`, v39) adds
lighter copies beside the originals and never replaces one: the installed plugin
shares the mount and is an older client. Before adding another such copy, measure
it the way these were:

1. **Compare the render targets, not screenshots.** A throwaway rig page
   (`tools/shadertest/zz-*.ts`, §3.4) composites the same skin twice and passes
   `reference` to `compositePaint`, whose callback receives the raw `albedoRT` and
   `rmRT`. Read both with `readRenderTargetPixels` and report mean and max
   absolute difference and the share of pixels more than 2 levels off, for the
   albedo and for roughness (G) and metalness (B) separately. Run it in Chrome
   AND WebKit (Safari decodes the inputs in JS, `src/rawPng.ts`).
2. **Pick skins that exercise the inputs.** Legacy finishes, knives and Dopplers
   use bundles that are all 2048 or smaller, so they only prove the harness
   (exactly 0). The 4096 inputs are on HD gun bodies: case hardening (Five-SeveN
   | Heat Treated), gunsmith style 8 (Glock-18 | AXIA), custom paints, and a
   projected style at cap 2048 (`maxSize`).
3. **Then the whole viewer.** Render `mount.html` against a local models dir
   with and without the copies (`MODELS_DIR`, see `tools/shadertest/vite.config.ts`)
   and diff the PNGs.

Results on 2026-10-21. 2048 copies at cap 2048 (and 1024): every skin within 2
levels, 0% of pixels over 2, mean under 0.12 in every channel, in both
browsers. The full viewer differed in 11 (Chrome) and 3 (WebKit) of 2.8M pixels,
specular sparkles on bare metal. The copies match a numpy reference within 1
level and keep the RGB under zero alpha: 83% of the AK-47's `color.png` has
alpha 0 and colour underneath.

Two candidates were measured and REJECTED:

- **The grunge texture** (`gun_grunge_psd_f3419fed_ca3c5c93.webp`, 7.5MB,
  shared by every paint). Lossy WebP keeps its alpha lossless, and that alpha
  is most of the file: q98 saves only 31% and moved AK-47 | Case Hardened's
  metalness by up to 14 levels (1.7% of pixels over 2). A 1024 copy saves 64% and
  moved up to 29% of pixels by more than 2. It stays lossless at 2048.
- **EXT_meshopt_compression for the GLBs.** Lossless is possible (no
  quantisation, no filters, index sequences rather than triangles, so not even a
  triangle's indices rotate): 15 models came back identical through three's
  decoder, every attribute, index, skin and animation track. But it only
  repacks the float bytes gzip already packs: 8 models were 8.12MB as `.gz` and
  7.95MB as meshopt + gzip, 2% less, for a second copy of every GLB and a
  decoder in the client. Its usual 5-10x comes from quantising, which moves
  vertices.

### 4.15 The first load is heavy, or something downloads before it is needed

Measure what each phase downloads before moving any code.

1. **Network per phase, in the standalone mock** ([§3.6](#36-the-real-ui-locally-toolsstandalone)).
   Record every request with its encoded and decoded size between steps: load,
   open the inventory, open one item in 3D. CDP's `Network` events are the
   reliable source; `performance.getEntriesByType("resource")` caps at 250
   entries unless the page calls `performance.setResourceTimingBufferSize`
   first. `Network.emulateNetworkConditions` throttles the same run. Three
   things skew the numbers:
   - The mock serves files uncompressed, so its transfer size is the raw size.
     Compare against the gzip column Vite prints for production.
   - Missing cards are baked in the browser, which pulls in all of three,
     the HDRI and the GLBs as soon as the inventory opens. Run the flow once to
     fill the mock's card store, then measure a second, fresh-profile run.
   - `vue.js` (about 170kB) is the mock's stand-in for the panel's Vue. It is
     not part of the plugin.
2. **What is in a chunk, and why**: `tools/bundle-report.config.ts` lists each
   named chunk's modules, largest first, with what loads with the chunk and
   what it can load later.
3. **Bound a split before doing it.** In a throwaway config, a `resolveId` hook
   can send the UI's imports of a module to a stub that exports the same names.
   The boot chunk's size with the stub is the most that a real split can save.
   This is how the 2026-10-21 split was chosen: the paint, glove, charm and pet
   pipelines were about a third of the App chunk (75kB of 228kB gzipped).
4. **The trap is shared modules.** A module lives in exactly one chunk. When
   the boot chunk imports one small function from a heavy module, such as
   `loadPaintDef` from `paintComposite.ts`, the whole module lands in a chunk
   that the boot chunk imports statically. It downloads at load, even if every
   other importer is lazy. `defineAsyncComponent` fixes this cheaply when a
   component is the only static importer: the pattern rails, `ItemSpecs` and
   `PetControls` took charm liquid, charm material and pet material with them.
   App.vue's own imports of the paint and glove definition loaders still keep
   `paintComposite` and `gloveComposite` (about 150kB, 51kB gzipped) in the boot
   graph. Moving them out would mean splitting each file into a definition
   half and a GPU half, about 1,100 lines of upstream code.
5. **A smaller asset that feeds a renderer**: compare renders, not files. Card
   bakes (`mount.html`, default `still=1`) are deterministic. Two identical runs
   differ by exactly 0, so any difference is the change. Live renders of
   animated items are not deterministic: a live glove differed from itself on
   58% of its pixels. Serve the candidate through a temporary `?zz…=` override
   and diff over the drawn pixels: mean absolute difference, 99th percentile,
   and the share of pixels more than 2 levels off. For the studio HDRI the
   threshold was a mean under 0.25, a 99th percentile of at most 1, and under
   0.1% of pixels over 2.

   Watch for anything sized from its input. `PMREMGenerator` builds its cube
   at the source width / 4, so a 512-wide HDRI prefilters at 128 instead of
   256 and shifts every roughness level. Used as is, the half-size file failed
   on the glove (6.9% of pixels over 2). Widened back to 1024 before the
   prefilter, it passed on all four items (mean 0.06 or less, 99th percentile 1,
   0.02% of pixels over 2). Check WebKit too (`shoot-webkit.mjs`). It gave the
   same numbers.

### 4.16 Opening an item in 3D is slow

A cold open is almost all network, and it is a chain: the GLB, then the
textures its JSON names, then the paint chain and the composite store lookup,
and on a store MISS the composite's sources (the weapon's `.inputs[.hd]`,
10-40MB, plus the paint's own textures). `?perf=1` puts the mount's per-stage
milliseconds and its MB over the wire in the HUD.

`src/prefetch.ts` starts that chain before the click: on a tile hover, on the
Edit / View in 3D press, and for the equipped items once the page is idle (not
on phones; its header says what each one fetches). The bytes go into `src/prefetchStore.ts`
and the loaders take them from there through four hooks (`prefetchedFetch`,
`prefetchedUrl`, `prefetchedUrlSync`, `settlePrefetched`); nothing depends on
the HTTP cache. **Prefetch log** (`prefetchlog`) shows every `start`, `ready` and `missing`, and
on the loader side every `HIT`, `loader waits for` and `in use`;
`window.__prefetch.stats()` has the totals. **No prefetch** (`noprefetch`) is the baseline.

**Timing an open.** Run tools/standalone with `MOCK_CARDS=stub` (§3.6), click
Edit from a page script, then poll the new canvas every frame until it has lit
pixels. Two traps:

- Use a real GPU (`--use-angle=metal` on macOS). Under SwiftShader the
  composite alone takes ~20s and buries every network effect.
- Proxied to the dev mount, the same cold open varies 2-3x between runs (one
  AK-47 took 8.7-13.1s). For before/after numbers, serve the assets from memory
  through one paced link of fixed bandwidth and round trip instead. The table
  below came from a copy of the mock doing that at 100 Mbit/s and 30ms
  (median of 3, click to first frame, composite store MISS):

| Item | Bytes | No prefetch | Press only | Hover 1.5s, then Edit | Hover 8s |
| --- | --- | --- | --- | --- | --- |
| Bayonet \| Doppler | 15MB | 2.02s | 1.85s | 0.71s | 0.70s |
| AK-47 \| Redline (legacy body, 3 stickers) | 31MB | 3.65s | 2.63s¹ | 1.63s | 1.57s |
| AK-47 \| Predator (HD body, projected) | 76MB | 8.44s | 7.36s | 6.00s | 4.50s |

¹ Partly the idle warm of the equipped AK-47 | First Class, which shares the
legacy body's GLB and textures. A hover never fetches the composite inputs, so
the Predator's 36MB of them are still downloaded after the click. A build
without the prefetch code at all opens in the same time as the "No prefetch"
column (2.01s and 8.46s), so the hooks cost nothing when nothing is warmed.
With the card backfill left on, the bakes take what the idle warm fetched:
the page loaded 116.8MB with prefetch and 116.8MB without.

The same items once their composite is in the store (`MOCK_COMPOSITES=keep`,
median of 2), where an open needs no inputs at all:

| Item | Bytes | No prefetch | Press only | Hover 1.5s, then Edit | Hover 8s |
| --- | --- | --- | --- | --- | --- |
| Bayonet \| Doppler | 3MB | 0.48s | 0.33s | 0.26s | 0.25s |
| AK-47 \| Redline | 15MB | 1.38s | 0.50s¹ | 0.48s | 0.49s |
| AK-47 \| Predator | 53MB | 3.92s | 3.48s | 2.09s | 1.26s |

In WebKit (Playwright, same lab link) the Bayonet's store-miss open went from
2.05-2.13s to 0.78-0.86s after an 8s hover, with masks.png served from the
store through the raw PNG path (§4.9) and the Doppler painted.

**Checking "never downloads twice".** Count requests per URL in CDP's Network
domain during hover and open. The one duplicate this found: a finish drawn
through Valve's combo shader loads its pattern twice, once for the combo and
once for the port, with different sampler settings, so the texture cache misses
and the second `<img>` load relied on the browser's image cache to pair it with
the first by URL. A blob: URL for the first and the real URL for the second
broke the pairing (1MB extra on AK-47 | Predator). The store now hands every
load of a taken file the same blob: URL for a minute.

**The politeness rules**, one at a time: Save-Data and 2g by overriding
`navigator.connection` before the page loads (CDP
`Page.addScriptToEvaluateOnNewDocument`); a hidden tab by overriding
`document.hidden` and dispatching `visibilitychange`; the concurrency cap and
the yield to a building viewer by sampling `window.__prefetch.stats()`
(`activeBackground`, `peakBackground`, `viewerBusy`) every 50ms.

### 4.17 First person: the wrong clip, the wrong buttons, or an attachment off the gun

**Which clip played.** Every action is one file, `anims/<stem>.<action>.json`,
and its `source` names the game clip it came from. The extractor finds a
weapon's folder from its family (`rifle/rifle_<stem>`, `pistol/pistol_<stem>`,
`knife/knife_<stem>`) or the `FOLDER` table in
`scripts/extract-viewmodel-anims.mjs`, and falls back to the family's
`_default_*` folder. That fallback is silent and wrong: the C4 sat under
`_default_rifle` and was held like a rifle, with a rifle's reload and shot,
until `c4: "equipment/c4"` went in the table. To check every weapon at once,
run the extractor's own `folderFor` over `pak01_dir.txt` (§2) and list the
ones that land on a `_default_*` folder; today only the C4 did (the default CT
knife's real folder is `_default_knife`). A re-run deletes the action files a
weapon no longer has, so the C4's old reload and shot go too.

**Which buttons show.** First person offers Fire, Reload, Inspect and Deploy
only where `anims/index.json` lists the action, less what `CANNOT` in
`src/viewmodelClip.ts` rules out: the C4 neither fires nor reloads, and the
Zeus fires but recharges. Knives have no fire or reload clip, so they get
neither. The edit view decides "held" from `craftHolding`, the sticky toggle
AND an item that can be held; an agent opened after a rifle used to inherit
the rifle's buttons.

**Rare inspects.** `lookat02_*` and `lookat03_*` are extracted as `inspect2`
and `inspect3`. Pressing Inspect during an inspect steps to the weapon's next
one (`requestFpvAction`); a weapon with only the plain inspect keeps the old
rule, where an inspect never interrupts itself. These have them:

| Weapon | Extra inspects |
| --- | --- |
| AK-47 | `inspect3` |
| Desert Eagle | `inspect2` |
| C4, Butterfly Knife | `inspect2`, `inspect3` |
| Survival (`canis`), Paracord (`cord`), Classic (`css`), Falchion, Nomad (`outdoor`), Skeleton, Stiletto, Ursus, Talon (`widowmaker`) | `inspect2` |

They appear after the first-person animation step (`viewmodel-anims`) has
run and `CLIP_SCHEMA` in `src/viewmodelClip.ts` has been bumped, so browsers
fetch the new clips instead of their cached ones.

**What moves the weapon's parts.** A gun's magazine, bolt and trigger come from
its GLB's own `reload`, `shoot` and `draw` clips (`PART_CLIP`). Knives and
dual-wield rigs take the viewmodel clip's `prop` tracks instead (`fpvProps`):
a knife has no part clips, and the Dual Berettas' pistols are carried into the
hands by `weapon_hand_l`/`weapon_hand_r`, which only the prop tracks pose. Before
that, both pistols stayed at bind, 20 inches apart and out of frame, and showed
only during a reload or a shot. A dual rig's GLB clips keep only their scale
tracks (the magazine hidden for the swap), so two clips never average on one
bone. Turning off frustum culling was tried first and changed nothing.

**Attachments on a held weapon.** Everything is placed once against the weapon
at mount (see the gotcha "The weapon never moves"), and each kind has its own
bridge from the item view's pose to the held one:

| Attachment | How it reaches the held weapon |
| --- | --- |
| stickers | cut against skinned twins of the meshes (`weaponMeshes`) |
| charm | its icon-pose anchor through `charmPoseFix` |
| StatTrak module, name tag | `liveFrames`: bakePose's attachment frames, measured off the live skeleton (`moduleFrames`); without them `placeAttachedModule` fell back to `anchor.pos` and the C4's label hung in the air |
| a dual rig's stickers and charm hook | `followDualParts`: each takes its pistol's motion since the twins, every frame |

To check a module, compare `window.__mount.probeNameplate()` in the item view
and held (`mount.html?…&nametag=x` with and without `arms=`). Matching `flat`
and `gapMm` mean it sits on the body the same way; on 2026-10-21 the C4, AK-47,
Deagle and Karambit matched exactly. A plate riding a bone (the Butterfly's)
reports bone-local numbers, so check that one by eye.

**Driving it.** `drive.mjs` with steps that call
`window.__mount.setFpvAction("inspect")` and take a shot every second shows a
clip frame by frame. `&fpvfov=95` widens the view to find something just off
screen; `&nameplateprobe=1` draws the plate's anchor.

**Known and left alone:** on a few inspects (the AWP's) bare upper arm shows
beside an agent's sleeve. The sleeve is weighted almost entirely to
`arm_lower_*_TWIST1` and the skin across the upper-arm bones, so the two part
company at a hard bend. Fading the skin to match the sleeve, and cutting it
beyond the sleeve's end, changed nothing visible.

## 5. Gotchas

- **Disk.** Headless Chrome profiles are large; use the runners in this repo,
  which delete theirs.
- **`npm i --no-save playwright` rewrites `yarn.lock`.** Put it back
  (`git checkout yarn.lock`) before committing.
- **A prefetched file loads from a `blob:` URL.** In devtools it shows as a
  blob: request; the real URL was fetched earlier by src/prefetchStore.ts, at
  low priority unless a press asked for it.
- **The weapon never moves, first person included.** Stickers are cut in world
  space and the charm's pivot, cord and collision grid are world-space, all
  measured once at mount. First person moves the arms, the eye and the lamps
  by the inverse of the clip's `wpn` placement (`syncFpvSeat`), and the held
  weapon stays skinned at BIND, so the placement code reads skinned twins of
  its meshes (`weaponMeshes`) and the charm's icon-pose anchor goes through
  `charmPoseFix`. `window.__mount` on mount.html is the live handle, so
  drive.mjs can call `setFpvAction("reload")` between shots.
- **The Dual Berettas show the icon's tent**, live and on the card, as the
  game's inspect and Apply Sticker screens do. `?dualside=1` brings back the
  synthesised parallel layout.
- **Glove cards turn the right hand over.** `tools_preview_pose` shows the
  right glove's palm; `backOfRightHand` gives `arm_lower_R` a half turn about
  the hand's own axis before the bake. Card bakes only: the live viewer plays
  `inspect_loop`.
- **A debug switch has to be in the registry.** `debugFlag` stores `?name=1`
  but answers from `src/devFlags.ts`, so a name missing there reads its
  default however the URL is set. `dualside` shipped that way for an hour.
- **An attached charm's gravity is the camera's down**, not world −Y. Anything
  physical on a charm (cloth, liquid) must use `charmGravity`'s axis.
- **Safari's canvas can't encode WebP.** `toBlob(cb, "image/webp")` returns a
  PNG without an error. Check an encode by its magic bytes (`RIFF….WEBP`).
- **Alpha is data in the composite inputs.** `masks.png` alpha is unused and 0,
  `ao.png` alpha is noPaint. Any loader for them must keep RGB under alpha 0,
  which Safari's image path does not do for a fully transparent file; go
  through `loadRawPngTexture` (src/rawPng.ts).
- **A `.gz` beside a mount file is sent instead of it**, and nginx never checks
  that the two still match. The extraction deletes every `.gz` before its first
  step and `precompress` writes them back last. Anything else that rewrites a
  file under `/models` must delete that file's `.gz`.
- **Composite inputs come in two sizes** from v39. At a cap of 2048 or less the
  compositor reads the `textures2048` copies, so when chasing an input texel,
  look at the `.2048.png` too.
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
- **The default live rig never touches the studio HDRI.** CS2 lights by its own
  painted sky, so a live `mount.html` shot tests the HDRI only with `&env=studio`
  (or another studio rig). A still (`still=1`, the default) always uses the
  bake rig, and the bake rig is Studio.
- **Nothing 3D loads at startup.** `viewer3d`, three and GLTFLoader are fetched
  together by the first `viewer3d()` call (`src/viewer3dLazy.ts`), which is a 3D
  view or a card bake. Code that wants them earlier has to call
  `prefetchViewer3d()` on a real signal of intent.
- **In-game screenshots are not orthographic.** Compare ratios and sides, never
  absolute pixel positions.
- **A `.gz` beside a mount file is what gzip clients get.** nginx never checks
  that it matches the file; if an asset looks stale only in some clients,
  compare the `.gz` with its original.
