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

// Types we render in 3D (see supports3d in src/itemVisuals.ts). Their flat icon
// is only ever a placeholder while the real render bakes, so if the archive is
// missing one it is a cosmetic delay — not a blank card. Everything else has NO
// second source, so a miss there is a permanently empty tile. The extractor
// reports the two separately; don't collapse them.
const RENDERED_IN_3D = new Set(["weapon", "melee"]);

const icons = [];
const seen = new Set();
for (const item of CS2Economy.itemsAsArray) {
  const image = item.image;
  if (typeof image !== "string" || !image.startsWith("/images/")) continue;
  if (seen.has(image)) continue;
  seen.add(image);
  const file = image.slice("/images/".length);
  icons.push({
    // Exact filename to write under <mount>/images/.
    out: file,
    // Game asset name to look for, hash suffix removed.
    stem: file.replace(/\.webp$/, "").replace(/_[0-9a-f]{8}$/, ""),
    type: item.type ?? "unknown",
    placeholderOnly: RENDERED_IN_3D.has(item.type),
  });
}

// Types whose paint chain is actually COMPOSITED. Only these fetch a
// paintMaterial: viewer3d passes one for the weapon being rendered, and the
// skin-test suite covers weapon/knife/glove. Stickers and patches are drawn as
// decals from their flat `image`, never from a paint material — see
// StickerPlacement in viewer3d.ts, which carries an image and nothing else.
//
// This filter is worth a lot. cs2-lib lists 12,044 paint materials but only
// 1,479 belong to these types; following the other 10,565 dragged in 6,245
// textures nothing ever requests — 76% of the texture work, and the paint step
// was 71% of the whole extraction.
const COMPOSITED_TYPES = new Set(["weapon", "melee", "glove"]);

// Paint materials. `paintMaterial` is "/materials/<stem>_<hash8>.vcompmat.json"
// (a few are .vmat.json) — same hash-suffix rule as the icons, so the stem is
// again the game asset's own name. These are only the ENTRY POINTS: each one
// pulls in a template vmat, shared includes and textures by reference, and the
// extractor follows those transitively.
const paints = [];
const seenPaint = new Set();
for (const item of CS2Economy.itemsAsArray) {
  const pm = item.paintMaterial;
  if (typeof pm !== "string" || !pm.startsWith("/materials/")) continue;
  if (!COMPOSITED_TYPES.has(item.type)) continue;
  if (seenPaint.has(pm)) continue;
  seenPaint.add(pm);
  const file = pm.slice("/materials/".length);
  const m = /^(.*?)\.(vcompmat|vmat)\.json$/.exec(file);
  if (!m) continue;
  paints.push({
    out: file,
    stem: m[1].replace(/_[0-9a-f]{8}$/, ""),
    kind: m[2],
  });
}

process.stdout.write(JSON.stringify({ version: 2, icons, paints }));
