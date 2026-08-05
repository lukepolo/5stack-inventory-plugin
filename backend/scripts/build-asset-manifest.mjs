#!/usr/bin/env node
// Emits the asset filenames the UI needs — econ icons and paint materials — as
// JSON on stdout, for scripts/extract-models.sh steps 4 and 5 to resolve
// against the game archive.
//
// We serve item artwork ourselves (no third-party CDN), but the FILENAMES still
// have to be cs2-lib's: `item.image` is what the catalog hands the frontend, so
// whatever we write has to answer to that exact path or the <img> 404s.
//
// cs2-lib names every asset `<game-asset-stem>_<hash8>.webp`, where the hash is
// its own content hash — not something we can recompute. We don't need to:
// stripping the suffix leaves the game asset's own name, which IS resolvable
// against the archive. So this script only has to say "cs2-lib wants THIS file,
// and it comes from an asset whose name starts THIS way"; the extractor owns
// the matching rules (wear tiers, tints, case, sticker id suffixes), because
// only it has the archive listing to match against.
//
// Run from the backend dir (needs its node_modules for cs2-lib):
//   node scripts/build-icon-manifest.mjs > icons.json
import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/translations/english";

CS2Economy.load({ items: CS2_ITEMS, language: english });

// ---- cs2-lib 8.x / 9.x field names ------------------------------------------
//
// v9 renamed every field this script reads (`image` -> `imagePath`,
// `paintMaterial` -> `materialPath`, `index` -> `variantIndex`, `stickerId` ->
// `displayedStickerId`). Read BOTH, because the failure mode of reading one is
// catastrophic and completely silent: on the wrong version every access is
// `undefined`, the loops below skip every item, and this emits a valid, EMPTY
// manifest. The extractor then believes the catalogue wants 262 textures,
// stages exactly those, and — on the second such run, since the prune keeps one
// generation — deletes the other ~16,500 off the live mount. Skins render white
// and nothing anywhere reports an error.
//
// That is exactly what happened on 2026-08-05: package.json moved to ^9.0.0 and
// the deployed tree installed it, while this file (missed because the rename was
// believed to be catalog.ts-only) still asked for the 8.x names.
const imagePathOf = (i) => i.imagePath ?? i.image;
const materialPathOf = (i) => i.materialPath ?? i.paintMaterial;
const variantIndexOf = (i) => i.variantIndex ?? i.index;
const displayedStickerIdOf = (i) => i.displayedStickerId ?? i.stickerId;

// Types we render in 3D (see supports3d in src/itemVisuals.ts). Their flat icon
// is only ever a placeholder while the real render bakes, so if the archive is
// missing one it is a cosmetic delay — not a blank card. Everything else has NO
// second source, so a miss there is a permanently empty tile. The extractor
// reports the two separately; don't collapse them.
// NOT widened when gloves/agents/charms gained 3D views: this set means "the
// icon is a placeholder while a card bakes", and those types render 3D ON DEMAND
// only — their grid card IS the flat icon. Marking them here would downgrade a
// permanently blank tile to a "cosmetic delay" in the extractor's report, which
// is the opposite of true. Add a type here when it starts baking cards, not when
// it starts rendering.
const RENDERED_IN_3D = new Set(["weapon", "melee"]);

// ---- sticker kit id, the ONLY thing that tells two same-named decals apart ---
//
// A stem is not unique for decals. The archive files sticker art by EVENT
// (`.../stickers/emskatowice2014/ibuypower_png.vtex_c` vs
// `.../stickers/cologne2014/ibuypower_png.vtex_c` vs `.../stickers/dhw2014/...`)
// and cs2-lib keeps only the basename, so a stem-only match collapses all three
// onto whichever the extractor indexed first. Measured on this catalogue: 16,992
// of 26,878 icons share a stem with at least one other item, and 13,163 archive
// assets are unreachable — every iBUYPOWER Katowice 2014 rendered as the Cologne
// one, and so did most of the tournament sticker set.
//
// `index` on a sticker/patch/graffiti IS the game's sticker_kit id, and that kit
// names the folder (`sticker_material`/`patch_material`). The extractor reads
// items_game.txt and turns the id into a directory; here we only have to say
// which kit each file belongs to.
//
// Sticker SLABS (keychains) have their own index in the keychain namespace, but
// carry `stickerId` — their art sits in the sticker's own event folder under a
// `_1355_37` name — so they borrow the kit through that.
const kitOfItem = new Map(CS2Economy.itemsAsArray.map((i) => [i.id, variantIndexOf(i)]));
const DECAL_KIT_TYPES = new Set(["sticker", "patch", "graffiti"]);
function kitOf(item) {
  if (DECAL_KIT_TYPES.has(item.type)) return variantIndexOf(item);
  const slabOf = displayedStickerIdOf(item);
  if (item.type === "keychain" && slabOf != null) return kitOfItem.get(slabOf);
  return undefined;
}

const icons = [];
const seen = new Set();
for (const item of CS2Economy.itemsAsArray) {
  const image = imagePathOf(item);
  if (typeof image !== "string" || !image.startsWith("/images/")) continue;
  if (seen.has(image)) continue;
  seen.add(image);
  const file = image.slice("/images/".length);
  const kit = kitOf(item);
  icons.push({
    // Exact filename to write under <mount>/images/.
    out: file,
    // Game asset name to look for, hash suffix removed.
    stem: file.replace(/\.webp$/, "").replace(/_[0-9a-f]{8}$/, ""),
    type: item.type ?? "unknown",
    placeholderOnly: RENDERED_IN_3D.has(item.type),
    ...(kit != null ? { kit } : {}),
  });
}

// Types whose paint chain is actually COMPOSITED. Only these fetch a
// paintMaterial: viewer3d passes one for the weapon being rendered, and the
// skin-test suite covers weapon/knife/glove.
//
// This filter is worth a lot. cs2-lib lists 12,044 paint materials but only
// 1,479 belong to these types; following the other 10,565 dragged in 6,245
// textures nothing ever requests — 76% of the texture work, and the paint step
// was 71% of the whole extraction.
const COMPOSITED_TYPES = new Set(["weapon", "melee", "glove"]);

// Stickers and patches ride the same pipe but are NOT composited: the extractor
// follows one texture out of their material and stops (see the sticker branch in
// the graph walk), so the cost is ~3.2k textures rather than the 6,245 the full
// chain would drag in.
//
// Why bother at all, when a sticker already has a flat `image`? Because that
// image is the INVENTORY ICON, not the sticker: measured on Dystopian Gaze, the
// icon is 512x384 with the art inset 11.5% at the sides, flush to the top and
// 11.2% clear of the bottom, while the sticker's own material declares a 512x512
// texture. Drawing the icon as a decal therefore squashed the art and hung it
// above its own anchor. `g_tSticker0` is what the game actually draws.
const DECAL_TYPES = new Set(["sticker", "patch"]);

// Paint materials. `paintMaterial` is "/materials/<stem>_<hash8>.vcompmat.json"
// (a few are .vmat.json) — same hash-suffix rule as the icons, so the stem is
// again the game asset's own name. These are only the ENTRY POINTS: each one
// pulls in a template vmat, shared includes and textures by reference, and the
// extractor follows those transitively.
const paints = [];
const seenPaint = new Set();
for (const item of CS2Economy.itemsAsArray) {
  const pm = materialPathOf(item);
  if (typeof pm !== "string" || !pm.startsWith("/materials/")) continue;
  const decal = DECAL_TYPES.has(item.type);
  if (!decal && !COMPOSITED_TYPES.has(item.type)) continue;
  if (seenPaint.has(pm)) continue;
  seenPaint.add(pm);
  const file = pm.slice("/materials/".length);
  const m = /^(.*?)\.(vcompmat|vmat)\.json$/.exec(file);
  if (!m) continue;
  const kit = kitOf(item);
  paints.push({
    out: file,
    stem: m[1].replace(/_[0-9a-f]{8}$/, ""),
    kind: m[2],
    // Follow one texture, not the whole chain. The extractor reads this.
    ...(decal ? { decal: true } : {}),
    // Same collision as the icons, and worse: the sticker's vmat is what the
    // viewer actually DRAWS on a weapon, so a stem-only match put the wrong
    // event's art on the gun as well as on the tile.
    ...(kit != null ? { kit } : {}),
  });
}

// FAIL LOUDLY on an empty manifest rather than emitting one.
//
// extract-models.sh treats a non-zero exit here as "could not build the
// manifest" and SKIPS the icon and paint steps entirely — no staging, no swap,
// no prune — which leaves the live assets exactly as they were. An empty
// manifest that exits 0 does the opposite, and destroys them. There is no
// catalogue in which zero icons or zero paints is a real answer.
if (!icons.length || !paints.length) {
  process.stderr.write(
    `refusing to emit an empty manifest: ${icons.length} icons, ${paints.length} paints ` +
      `from ${CS2Economy.itemsAsArray.length} items. Check the cs2-lib field names above ` +
      `against the installed version.\n`,
  );
  process.exit(1);
}

process.stdout.write(JSON.stringify({ version: 4, icons, paints }));
