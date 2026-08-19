import { readFileSync, createReadStream, createWriteStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { LogController } from "fastify";
// Type-only, so node's type stripping erases it — "pg" is CJS and has no such
// runtime export to import.
import type { PoolClient } from "pg";
import { pool } from "./db.ts";
import { getIdentity } from "./identity.ts";
import { buildInspectLink, type InspectSticker } from "./inspect.ts";
import {
  getStickerMarkup,
  slotCount,
  getCharmMarkup,
  charmBounds,
  getCharmModels,
  getCharmShading,
  getPatchMaterials,
} from "./stickerMarkup.ts";
import { patchSlotsFor, warmPatchSlots } from "./agentPatchSlots.ts";
import {
  itemDescription,
  itemTitle,
  parseShareTarget,
  pngPixelSize,
  renderUnfurl,
  requestOrigin,
  truncate,
  type ItemFacts,
  type ShareTarget,
} from "./share.ts";
import {
  pickPrice,
  priceTargetKey,
  quoteItem,
  wearTierSql,
  PRICE_FEED_BASE,
  PRICE_PROVIDERS,
  PRICE_SOURCES,
  PRICE_WINDOWS,
  DEFAULT_PRICE_SOURCE,
  DEFAULT_WINDOW,
  providerUrl,
  type PriceSource,
  type PricePoint,
  type PriceWindow,
  type Quote,
} from "./prices.ts";
import {
  getWeapons,
  getDefaults,
  getWeaponSkins,
  getAgents,
  getKnives,
  getGloves,
  getMusicKits,
  getCollectibles,
  getCollections,
  getCollection,
  searchAttachments,
  type AttachKind,
  type AttachQuery,
  type AttachSort,
  getGraffiti,
  getItemsByIds,
  getItem,
  getItemIdByName,
  catalogSummary,
  priceGroupId,
  wearTierIndex,
  wearTierOf,
  parseSteamMarketName,
  isOwnable,
  slotForItem,
  isBaseWeapon,
  getStickerBounds,
  validateCraftAttrs,
  itemStoresWear,
  itemStoresSeed,
  STICKER_LIMITS,
  truncateToPrecision,
  normStickerRotation,
  getRenderTestCatalog,
  stickerMaterialFor,
} from "./catalog.ts";

// Per-request in/out logging drowns out everything the app actually says
// (two lines per request, and the SPA polls). Errors and explicit app.log.*
// calls still come through; set LOG_REQUESTS=1 to get the firehose back.
const app = Fastify({
  logger: true,
  // logController replaces the top-level disableRequestLogging, which is
  // deprecated in fastify 5 and removed in 6. It must be a LogController
  // instance, not a plain options object.
  logController: new LogController({
    disableRequestLogging: !process.env.LOG_REQUESTS,
  }),
});

// Self-provision the inventory schema on boot (idempotent) so a fresh deploy
// needs no manual migrate step.
async function applySchema() {
  const sql = readFileSync(
    fileURLToPath(new URL("./schema.sql", import.meta.url)),
    "utf8",
  );
  await pool.query(sql);
}

/**
 * Null the float and pattern off rows that cannot have either.
 *
 * Not in schema.sql because the answer lives in cs2-lib, not in Postgres: only
 * the economy knows that a Service Medal has no float and a Music Kit has no
 * pattern. Everything else here is a `CREATE ... IF NOT EXISTS`; this is the
 * one migration that needs the catalog loaded, so it runs next to them instead.
 *
 * The rows exist because the craft form posts all four scalars for every item
 * and its neutral defaults are wear 0 / seed 1 — so every agent, music kit,
 * graffiti, patch and pin ever crafted stored a float of 0, which reads as
 * Factory New to anything that sorts or renders on the column. validateCraftAttrs
 * drops them at the door now; this is the collection already on disk.
 *
 * Idempotent and cheap: after the first pass it matches nothing, and this table
 * only ever holds the panel's own users' inventories.
 */
async function dropImpossibleScalars() {
  // `col` is one of two literals below, never anything from a request — the
  // parameterised half is the id list.
  const columns = [
    ["wear", itemStoresWear],
    ["seed", itemStoresSeed],
  ] as const;
  for (const [col, stores] of columns) {
    // Ask the TABLE which items it actually holds a value for, then judge those
    // — 12.7k of the 27k catalog can hold a float, and shipping that list to
    // Postgres on every boot to filter against is a 90KB parameter for a table
    // that holds a handful of distinct ids.
    const { rows } = await pool.query<{ item_id: number }>(
      `SELECT DISTINCT item_id FROM inventory.owned_items WHERE ${col} IS NOT NULL`,
    );
    const impossible = rows.map((r) => r.item_id).filter((id) => !stores(id));
    if (!impossible.length) continue;
    const res = await pool.query(
      `UPDATE inventory.owned_items SET ${col} = NULL WHERE item_id = ANY($1::int[])`,
      [impossible],
    );
    app.log.info(
      `[schema] cleared ${res.rowCount} impossible ${col} value(s) across ${impossible.length} item(s)`,
    );
  }
}

const TEAMS = new Set(["CT", "T"]);

// ---- Catalog (CS2 item data; no auth needed, it's public reference data) ----

app.get("/api/catalog", async () => {
  // assetVersion rides along here because the client needs it before it can
  // request a single paint file, and this is the one call it always makes first.
  // `patchSlots` is how many patches the agent's MODEL can actually carry (3-5,
  // read from its own materials). The craft form offers five because that is
  // what the inventory schema stores; without this it let you fill all five and
  // the viewer silently dropped the overflow. Null when the model is not on the
  // mount — the client must read that as "unknown, do not restrict".
  const agents = await Promise.all(
    getAgents().map(async (a) => ({ ...a, patchSlots: a.model ? await patchSlotsFor(a.model) : null })),
  );
  return {
    weapons: getWeapons(),
    agents,
    defaults: getDefaults(),
    assetVersion: await assetVersion(),
    assetOrigin: await assetOrigin(),
    // The client builds card URLs itself, so it needs the same version the
    // upload path keys them on — see renderKeyForRow. It rides here for the
    // same reason assetVersion does: this is the one call that always lands
    // before anything asks for a card.
    renderVersion: await renderVersion(),
  };
});

// Paint-chain files and econ icons are extracted from the instance's own CS2
// install onto the shared hostPath mount (scripts/extract-models.sh) and
// served straight off it — see serveAssetDir below. Nothing is fetched at
// request time, from anywhere.
// Rendered item cards (client snapshots of the painted 3D model) live on the
// same mount; nginx serves /renders/* statically. Upload is 5stack-session
// authed — no extra keys.
const RENDERS_DIR = process.env.RENDERS_DIR ?? "/cs2-models/renders";
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
// Key is derived SERVER-SIDE from the caller's own instance row — a client
// can never write another user's render slot (or an arbitrary path).
export function renderKeyForRow(
  row: { id: number | string; wear: number | string | null; seed: number | string | null; stattrak: boolean | null },
  version: number,
) {
  // The version suffix is the EXTRACTION PIPELINE version — EXTRACT_VERSION in
  // scripts/extract-models.sh, as stamped into extract-version.json by the last
  // successful run. It used to be a hand-written "-v7" that lived only here, and
  // the history of that is the argument against it: v2 compositor/legacy-body,
  // v3 content-crop, v4 paint+lighting, v5 crop aspect cap, v6 noPaint /
  // composite-input bundle, v7 StatTrak module — seven bumps, each remembered by
  // hand, each one a chance to forget and serve stale art forever.
  //
  // Riding the extraction version instead means a re-extract invalidates every
  // card by itself, which is the same self-invalidating property the composite
  // store gets from hashing its shader (see COMPOSITES_DIR). New textures on the
  // mount genuinely do change what a card should look like, so "re-extracted"
  // and "re-bake" are the same event. Superseded files are swept by
  // pruneRenders() rather than left to rot.
  //
  // A render-pipeline change with no extraction behind it still needs a manual
  // nudge — bump EXTRACT_VERSION, which is one number for both.
  //
  // The rest of the key covers id+wear+seed+stattrak. Deliberately NOT the kill
  // count: the 2D module renders a blank display, so the card is identical at 0
  // kills and 4000, and keying on the count would re-bake every card on every
  // kill. Must match renderKeyFor in src/api.ts.
  const st = row.stattrak ? "-st" : "";
  return `inst-${row.id}-${Number(row.wear ?? 0).toFixed(4)}-${Number(row.seed ?? 0)}${st}-v${version}.png`;
}

/** The version cards are keyed on right now: what the mount says it is, or 0
 *  for a mount nothing has ever been extracted onto. Read per call — this runs
 *  on card upload and after an extraction, neither of them hot. */
async function renderVersion(): Promise<number> {
  return (await readExtractVersion()) ?? 0;
}

/**
 * Delete card bakes that are not of the current version.
 *
 * The counterpart to the version suffix above: without this, every extraction
 * would leave a full generation of superseded PNGs behind and the mount would
 * grow without bound. Renders are cheap to rebuild (the client re-bakes on the
 * first miss), so unlike the composite store there is nothing to be gained by
 * ageing them out by LRU — anything that isn't current is already unreachable.
 */
async function pruneRenders(): Promise<number> {
  const current = await renderVersion();
  // An unstamped mount means the version is unknown, not zero-and-everything-
  // is-stale. Deleting the whole cache on that reading would be the worst
  // possible response to a read failure.
  if (!current) return 0;
  const suffix = `-v${current}.png`;
  let removed = 0;
  for (const name of await fs.readdir(RENDERS_DIR).catch(() => [])) {
    if (!name.startsWith("inst-") || !name.endsWith(".png") || name.endsWith(suffix)) continue;
    await fs.rm(path.join(RENDERS_DIR, name), { force: true }).catch(() => {});
    removed++;
  }
  return removed;
}
// The size check below allows 3MB, but Fastify's 1MB default would have
// rejected anything over 1MB before the handler saw it — so that ceiling was
// never real. Card PNGs are ~100KB, which is why it never surfaced.
app.post<{ Params: { id: string } }>("/api/render/:id", { bodyLimit: 3_000_000 }, async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "not signed in" });
  }
  const body = request.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 3_000_000 || !/^\x89PNG/.test(body.subarray(0, 4).toString("latin1"))) {
    return reply.status(400).send({ error: "bad render" });
  }
  const { rows } = await pool.query(
    // stattrak is part of the render key (the card draws the module), so it has
    // to be selected here — without it the stored name loses the -st marker
    // that the client's read URL carries, and every ST card 404s.
    `SELECT id, wear, seed, stattrak FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
    [Number(request.params.id), identity.steamId],
  );
  if (!rows[0]) {
    return reply.status(403).send({ error: "not your item" });
  }
  try {
    await fs.mkdir(RENDERS_DIR, { recursive: true });
    await fs.writeFile(path.join(RENDERS_DIR, renderKeyForRow(rows[0], await renderVersion())), body);
    return { ok: true };
  } catch {
    return reply.status(500).send({ error: "render store unavailable" });
  }
});

// ---- Shared paint composites -------------------------------------------------
// The two textures the client's compositor produces (albedo + rough/metal) are a
// pure function of (model, body variant, paint material, wear, seed) — nothing
// about them is per-user. Building them costs ~38MB of composite-input downloads
// per weapon (an AK's color.png alone is 20.4MB), so the first client to render a
// given skin uploads the result and every client after that skips the inputs
// entirely. See src/compositeStore.ts for the client half.
//
// Storage is generational: `<dir>/<shaderHash-assetVersion>/<stem>.<kind>.<ext>`.
// The generation is DERIVED from the shader source, so a compositor fix
// invalidates every stored bake by itself — the opposite of renderKeyForRow's
// hand-bumped "-v7", which is a version suffix nobody remembers to bump.
const COMPOSITES_DIR = process.env.COMPOSITES_DIR ?? "/cs2-models/composites";
/**
 * A generation is ONE directory name under the composites root, never a path.
 *
 * The first character must be alphanumeric, which is the whole point: the old
 * `^[\w.-]{1,64}$` accepted `..` (dots are in that class), and every route below
 * joins the generation straight onto the root. That made `..` mean the shared
 * asset mount itself — readable through the GET route, writable through the
 * upload, and, worst of the three, pruneComposites would then delete every
 * sibling generation and LRU-delete files directly out of /cs2-models, i.e.
 * extracted game textures.
 */
const GEN_RE = /^[A-Za-z0-9][\w.-]{0,63}$/;
/**
 * Resolved directory for a generation, or null if the name is malformed or
 * would land outside the root. Belt and braces on purpose: the regex alone is
 * what failed here, so the containment is also checked after resolution, and
 * every caller must go through this rather than path.join the raw parameter.
 */
function compositeDir(gen: string): string | null {
  if (!GEN_RE.test(gen)) return null;
  const root = path.resolve(COMPOSITES_DIR);
  const dir = path.resolve(root, gen);
  return dir.startsWith(root + path.sep) ? dir : null;
}
// A generous default: composites are a few MB each and the mount is a node disk,
// but an unbounded cache on a busy instance would eventually eat the partition
// the game install lives on.
const COMPOSITE_CACHE_BYTES = Number(process.env.COMPOSITE_CACHE_BYTES ?? 20 * 1024 * 1024 * 1024);
// A lossless 4096 projected style is the worst case; 48MB leaves headroom over
// the largest PNG that can legitimately arrive.
const COMPOSITE_MAX_BYTES = 48 * 1024 * 1024;

const PAINTS_DIR = process.env.PAINTS_DIR ?? "/cs2-models/paints";
const IMAGES_DIR = process.env.IMAGES_DIR ?? "/cs2-models/images";
const MODELS_DIR = process.env.MODELS_DIR ?? "/cs2-models/models";
const MUSIC_DIR = process.env.MUSIC_DIR ?? "/cs2-models/music";
const ASSET_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  // Music kit menu themes. Both containers, because the extractor probes what
  // Source2Viewer actually wrote rather than assuming mp3 — the format follows
  // the codec inside the .vsnd_c.
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/**
 * One `bytes=` range against a known size, or null when none was asked for and
 * false when the one asked for cannot be met.
 *
 * The distinction matters: an unsatisfiable range is a 416, and answering it
 * with the whole file instead hands a media element bytes from an offset it did
 * not ask about, which it decodes as noise.
 */
function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null | false {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  // `bytes=-500` means the LAST 500 bytes. Media elements use the suffix form
  // to read a trailing index, so reading it as "0 to 500" serves the header
  // where the tail was asked for.
  let start = rawStart === "" ? size - Number(rawEnd) : Number(rawStart);
  let end = rawStart === "" ? size - 1 : rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (size === 0 || start > end || start >= size) return false;
  return { start, end };
}
// Static asset mounts, populated ONLY by our own extractor from the instance's
// own CS2 install (scripts/extract-models.sh). A miss is a 404 and stays a
// 404: there is no upstream to fall back to by design, so an unpopulated or
// out-of-date mount shows up as a visible error instead of silently serving
// someone else's copy. nginx serves these directly; these routes only back its
// static-miss fallback (frontend/backend pods can land on different nodes).
function serveAssetDir(routePrefix: string, dir: string) {
  app.get<{ Params: { "*": string } }>(`${routePrefix}/*`, async (request, reply) => {
    const rel = request.params["*"] ?? "";
    const type = ASSET_TYPES[path.extname(rel).toLowerCase()];
    if (!type || rel.includes("..") || rel.includes("\\") || !/^[\w\-./ %()]+$/.test(rel)) {
      return reply.status(404).send({ error: "not found" });
    }
    reply.header("Access-Control-Allow-Origin", "*");
    // On EVERY reply, not just ranged ones: a browser only attempts a range
    // request after an ordinary response told it ranges are available, so an
    // <audio> element that never sees this header treats the track as
    // unseekable and downloads all 3.5MB before the first note.
    reply.header("Accept-Ranges", "bytes");
    const file = path.join(dir, rel);
    // Two very different lifetimes behind one route:
    //
    //  - TEXTURES and ICONS carry a content hash in the filename, so a given
    //    URL never changes meaning. Cache them hard.
    //  - MATERIAL JSON does NOT: the filename comes from cs2-lib and is fixed,
    //    while the content (and the texture names it points at) is rewritten
    //    by every extraction. Caching those for a day meant a browser kept a
    //    material referencing textures the new run had renamed — every one
    //    404'd and the skin rendered white long after the mount was correct.
    //  - MUSIC is the material case again: `valve_cs2_01.mp3` is a name the
    //    extractor reuses every run, so it is NOT self-versioning either, and
    //    treating it as immutable on filename alone would pin a browser to one
    //    CS2 build's audio forever.
    //
    // So both are only immutable once the client has stamped the extraction
    // version on them (see withAssetVersion). Unversioned requests still
    // revalidate, which keeps old clients and hand-typed URLs correct.
    const versioned = (request.query as { v?: string } | undefined)?.v != null;
    const selfVersioning = type !== "application/json" && !type.startsWith("audio/");
    const cacheControl = selfVersioning || versioned ? "public, max-age=31536000, immutable" : "no-cache";
    reply.header("Cache-Control", cacheControl);
    try {
      // Only stat when a range was actually asked for: the icon and texture
      // routes are hot and pay nothing for a feature they never use.
      if (request.headers.range) {
        const { size } = await fs.stat(file);
        const range = parseByteRange(request.headers.range, size);
        if (range === false) {
          return reply.code(416).header("Content-Range", `bytes */${size}`).send();
        }
        if (range) {
          reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
          reply.header("Content-Length", range.end - range.start + 1);
          return reply.code(206).type(type).send(createReadStream(file, { start: range.start, end: range.end }));
        }
      }
      const buf = await fs.readFile(file);
      return reply.type(type).send(buf);
    } catch {
      return reply.status(404).send({ error: "not extracted" });
    }
  });
}
serveAssetDir("/paints", PAINTS_DIR);
serveAssetDir("/images", IMAGES_DIR);
// Models were the one mount-backed tree with no static-miss fallback: nginx
// ended its /models/ block in `=404`. That was survivable while the tree was 36
// weapons written in one early step, but agents mirror their whole archive path
// and are written in place over a long run — so "the frontend pod can't see a
// GLB the backend pod can" becomes a visible, model-shaped hole rather than a
// brief blank. Same contract as the others: our own extractor is the only
// writer, and a genuine miss stays a 404.
serveAssetDir("/models", MODELS_DIR);
// Music kit audio. Registered here for the same cross-node reason as the rest —
// nginx's /music/ block ends in `try_files $uri @backend` — and it is the one
// mount whose clients seek, which is why serveAssetDir learned byte ranges.
serveAssetDir("/music", MUSIC_DIR);

// Serve renders directly too — nginx falls back here when its mount copy
// misses (e.g. frontend/backend pods on different nodes).
// Registered under BOTH paths: /api/renders/* is the canonical client path
// (the /api ingress provably reaches this pod — uploads use it); bare
// /renders/* backs nginx's static-miss fallback.
for (const route of ["/api/renders/:key", "/renders/:key"]) {
  app.get<{ Params: { key: string } }>(route, async (request, reply) => {
  const key = request.params.key;
  if (!/^[\w.-]+\.png$/.test(key)) {
    return reply.status(404).send({ error: "not found" });
  }
  try {
    const buf = await fs.readFile(path.join(RENDERS_DIR, key));
    // CORS comes from @fastify/cors (echoed origin + allow-credentials). A
    // manual `*` here overrides that echo, and browsers reject `*` on
    // credentialed fetches — the client's "already baked?" HEAD check then
    // fails every load and cards re-bake despite the render being served.
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.type("image/png").send(buf);
  } catch {
    return reply.status(404).send({ error: "not found" });
  }
  });
}

// ---- Share cards (what a pasted link unfurls to) ----------------------------
//
// A shared craft or loadout link shows a picture in Discord, and that picture is
// a render the OWNER'S BROWSER already baked — never one made on demand.
//
// That constraint is the design. This pod has no GL context and no headless
// browser, so rendering here is not on the table; and even if it were, a crawler
// must never be able to start a 40-second composite by following a link, because
// a chat client fanning five unfurl fetches at a skin nobody has rendered is the
// cheapest denial of service in the building. So these routes only ever SERVE
// what is already on the mount: the card bake the client uploads through POST
// /api/render/:id, or failing that the flat econ icon that ships with every
// finish. A skin nobody has opened in 3D unfurls with its Steam icon and the
// right words — a card, not a stall.
//
// The INCOMPLETE sentinel is inherited rather than re-checked: a white
// mid-extraction snapshot is refused by the client before it is ever uploaded
// (snapshotModelNow in src/viewer3d.ts), so everything in RENDERS_DIR has
// already passed that gate. Nothing here writes to that directory, so nothing
// here can weaken it.
//
// The public URL of a card is /api/share/image with the link's own state in the
// query, and it stays that URL whatever it resolves to. That is deliberate: the
// first person to paste a link may only get the flat icon, and when the owner's
// client bakes the render later the SAME url starts answering with it, so the
// unfurl improves on its own. The cache lifetime carries that (see below) —
// there is nothing to invalidate, because there is nothing keyed on the answer.

/**
 * The one item a loadout card shows, in preference order.
 *
 * A loadout is 20-odd slots and an unfurl is one picture, so something has to
 * choose. The knife leads because it is the piece a CS2 loadout is judged by and
 * the one people spend on; rifles next (the gun the sender is most likely
 * showing off), then SMGs/heavies, then pistols. Gloves and the agent sit below
 * the guns — they render as a pair of hands and a person, which read as a
 * different kind of picture entirely — and the slots with no model at all
 * (music kit, graffiti) come last so they are only ever a last resort.
 *
 * Within this order a slot whose render is already baked wins over one that is
 * not, so a shared loadout shows a real render whenever the owner has ever
 * looked at one of these items in 3D.
 *
 * This is a THIRD list of slot names (SLOT_RE and schema.sql's boot DELETE are
 * the other two) and deliberately not enforced against them: those two must
 * agree or a restart wipes people's equips, while a slot missing from this one
 * merely ranks last in a beauty contest. Nothing here can lose a row.
 */
const SHARE_HERO_SLOTS = [
  "knife", "r1", "r2", "r3", "r4", "r5",
  "m1", "m2", "m3", "m4", "m5",
  "sp", "p1", "p2", "p3", "p4",
  "gloves", "agent", "zeus", "c4",
  "collectible", "graffiti", "musickit",
];

/** An item a card can be written about: the catalog scalars, plus the owned row
 *  behind them when there is one (a draft has none — nothing owns it yet). */
type ShareFacts = ItemFacts & { instanceId: number | null };

/** Where a card's picture comes from: a file on the mount, or the first-party
 *  CDN for a box whose own extraction has not run yet. */
interface ShareArt {
  file?: string;
  url?: string;
  type: string;
  /** True for the owner's real 3D bake, false for the flat econ icon. Decides
   *  the cache lifetime and nothing else. */
  baked: boolean;
}

/**
 * The owner's baked card for one row, if it is already on the mount.
 *
 * Keyed through renderKeyForRow — the SAME server-side derivation the upload
 * path uses, so this cannot be pointed at another user's slot by anything in the
 * request. The key is never handed out: the file is served as bytes rather than
 * redirected to /renders/<key>, because that filename spells `inst-<row id>` and
 * a Location header would put the owner's row handle in a public response, which
 * is exactly what withoutInstanceHandle exists to prevent one level down.
 */
async function bakedShareRender(facts: ShareFacts, version: number): Promise<string | null> {
  if (facts.instanceId == null) return null;
  const file = path.join(
    RENDERS_DIR,
    renderKeyForRow({ id: facts.instanceId, wear: facts.wear, seed: facts.seed, stattrak: facts.stattrak }, version),
  );
  return (await fs.stat(file).then((s) => s.isFile(), () => false)) ? file : null;
}

/** The econ icon's path on the mount, or null if the catalog's value is not the
 *  shape this mount serves. Validated like serveAssetDir even though the string
 *  comes from cs2-lib rather than the request — the ITEM ID does come from the
 *  request, and one exported path with a `..` in it would be enough. */
function econIconFile(image: string | null | undefined): string | null {
  if (!image || !image.startsWith("/images/")) return null;
  const rel = image.slice("/images/".length);
  if (rel.includes("..") || rel.includes("\\") || !/^[\w\-./ %()]+\.webp$/.test(rel)) return null;
  return path.join(IMAGES_DIR, rel);
}

/**
 * The best picture we HAVE for an item — bake, then icon, then the CDN.
 *
 * Never the picture we could make: see the header. The icon fallback is what
 * makes "never bake cold" a feature rather than a hole — every finish in the
 * economy ships one, so a craft link for a skin nobody has rendered still
 * unfurls with the artwork Steam itself shows.
 *
 * That icon goes out as WEBP, which every crawler worth the name reads
 * (Discord, Slack and Twitter cards all do). Transcoding is not an option
 * anyway: there is no image encoder in this pod, and the choice is a webp or no
 * picture at all.
 */
async function shareArtFor(facts: ShareFacts | null, version: number): Promise<ShareArt | null> {
  if (!facts) return null;
  const baked = await bakedShareRender(facts, version);
  if (baked) return { file: baked, type: "image/png", baked: true };
  const image = getItem(facts.itemId)?.image ?? null;
  const icon = econIconFile(image);
  if (icon && (await fs.stat(icon).then((s) => s.isFile(), () => false))) {
    return { file: icon, type: "image/webp", baked: false };
  }
  // A deployment whose own extraction has never run has no icons either, and a
  // link that unfurls blank on a fresh install reads as the feature being
  // broken. assetOrigin() is the same first-party mirror the client falls back
  // to in that state, and it stops answering the moment a local extraction
  // completes — see its own note on why that is not "silently using someone
  // else's assets".
  const origin = await assetOrigin();
  return origin && image ? { url: `${origin}${image}`, type: "image/webp", baked: false } : null;
}

/**
 * The equipped-only rule, and why the share routes need one.
 *
 * /api/loadout/:steamId is public by design — an equipped loadout is already
 * public, because /api/equipped/v5 hands the same items to any game server that
 * asks with no credential at all. What a player merely OWNS is not, and the
 * README is explicit that an owned-item list would need a decision before it got
 * a route. An image endpoint that answered for any instance id would be that
 * route in pictures, reachable by counting.
 *
 * So a row answers only while it is equipped in the live loadout — precisely the
 * set /api/loadout/:steamId already discloses. Anything else reads as unknown
 * and unfurls as the plain app card, WITHOUT even the item's icon: the icon
 * would name the skin, and "instance 41,207 is a Redline" is the disclosure this
 * whole rule exists to withhold. That costs nothing real, because an item link
 * is owner-only by design — the share menu says so in as many words, and the
 * portable form of a craft is the /craft link, which needs no row at all.
 */
async function equippedShareFacts(instanceId: number): Promise<ShareFacts | null> {
  const { rows } = await pool.query<{
    id: string; item_id: number; wear: number | null; seed: number | null; stattrak: boolean; nametag: string | null;
  }>(
    `SELECT i.id, i.item_id, i.wear, i.seed, i.stattrak, i.nametag
       FROM inventory.owned_items i
      WHERE i.id = $1
        AND EXISTS (SELECT 1 FROM inventory.loadout l WHERE l.item_instance_id = i.id)`,
    [instanceId],
  );
  const row = rows[0];
  return row
    ? {
        instanceId: Number(row.id),
        itemId: Number(row.item_id),
        wear: row.wear == null ? null : Number(row.wear),
        seed: row.seed == null ? null : Number(row.seed),
        stattrak: !!row.stattrak,
        nametag: row.nametag,
      }
    : null;
}

/** The hero of a public loadout: highest-ranked slot with a bake, else the
 *  highest-ranked slot at all. Reads the same rows /api/loadout/:steamId serves
 *  and returns none of the handles — only the scalars a card is written from. */
async function loadoutShareFacts(
  steamId: string,
  team: "CT" | "T" | null,
  version: number,
): Promise<ShareFacts | null> {
  const { rows } = await pool.query<{
    team: string; slot: string; id: string | null; item_id: number | null;
    wear: number | null; seed: number | null; stattrak: boolean | null; nametag: string | null;
  }>(
    `SELECT l.team, l.slot, i.id,
            COALESCE(i.item_id, l.item_id) AS item_id,
            COALESCE(i.wear, l.wear) AS wear,
            COALESCE(i.seed, l.seed) AS seed,
            COALESCE(i.stattrak, l.stattrak) AS stattrak,
            COALESCE(i.nametag, l.nametag) AS nametag
       FROM inventory.loadout l
       LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
      WHERE l.steam_id = $1`,
    [steamId],
  );
  // An absent `team` means CT, not "either": App.vue's viewQuery omits the key
  // when it matches DEFAULT_TEAM, so the commonest loadout link in existence
  // carries no team at all and must not land on the T side by row order.
  const wanted = team ?? "CT";
  const ordered = rows
    .filter((r) => r.item_id != null)
    .map((r) => {
      const slot = SHARE_HERO_SLOTS.indexOf(r.slot);
      return { r, rank: (r.team === wanted ? 0 : 1000) + (slot < 0 ? 999 : slot) };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ r }) => ({
      instanceId: r.id == null ? null : Number(r.id),
      itemId: Number(r.item_id),
      wear: r.wear == null ? null : Number(r.wear),
      seed: r.seed == null ? null : Number(r.seed),
      stattrak: !!r.stattrak,
      nametag: r.nametag,
    }));
  for (const facts of ordered) {
    if (await bakedShareRender(facts, version)) return facts;
  }
  return ordered[0] ?? null;
}

async function shareFactsFor(target: ShareTarget, version: number): Promise<ShareFacts | null> {
  switch (target.kind) {
    case "draft": {
      // No row and no bake by definition — a draft is a link, not an item
      // anybody owns yet. It resolves to the finish's icon, which is why the
      // craft link that carries a full sticker layout still unfurls with the
      // skin on it.
      //
      // The defaults matter as much as the values: encodeDraft OMITS anything
      // sitting at its default, so an absent wear or seed is not "unknown", it
      // is the editor's neutral pair — which is why decodeDraft restores
      // DEFAULT_WEAR and seed 1 on the way back in. Without the same restoration
      // here the commonest craft link in existence (a finish nobody has dragged
      // a slider on) unfurls with no float, no pattern and no wear bracket. The
      // floor is the finish's own minimum where it has one: 1,683 of the 2,106
      // finishes are narrower than 0..1, and a card claiming a Factory New
      // 0.0000 Blaze describes an item that cannot exist.
      const skin = getItem(target.skinId);
      return {
        instanceId: null,
        itemId: target.skinId,
        wear: target.wear ?? skin?.wearMin ?? 0,
        seed: target.seed ?? 1,
        stattrak: target.stattrak,
        nametag: target.nametag,
      };
    }
    case "instance":
      return equippedShareFacts(target.instanceId);
    case "player":
      return loadoutShareFacts(target.steamId, target.team, version);
    default:
      return null;
  }
}

/** Title and blurb for a target, once its facts are known. */
function shareText(target: ShareTarget, facts: ShareFacts | null): { title: string; description: string } {
  const name = facts ? itemTitle(facts) : null;
  const specs = facts ? itemDescription(facts) : "";
  if (target.kind === "player") {
    // Nothing here knows the player's NAME — identity lives in the panel, and
    // this endpoint is unauthenticated. The panel's own unfurl middleware does
    // know it, which is why /api/share/meta hands back the parts separately: it
    // can put the person in the title and keep the item in the line below.
    return {
      title: name ?? "CS2 loadout",
      description: truncate(["Equipped CS2 loadout", specs].filter(Boolean).join(" · ")),
    };
  }
  if (name) {
    return { title: name, description: truncate(specs || "CS2 skin on 5Stack") };
  }
  return {
    title: "5Stack Inventory",
    description: "Craft, equip and inspect CS2 skins — rendered with the game's own shaders.",
  };
}

/**
 * The canonical query for a card's IMAGE — the state, and nothing else.
 *
 * Rebuilt from the parsed target rather than forwarded from the request so the
 * image URL is stable and cacheable: two links to the same craft that differ
 * only in which screen they were copied from (`?from=`, `?sort=`, a stale `?d=2`)
 * must not fan out into two cache entries of the identical picture. The keys
 * dropped here are the ones the picture cannot depend on — the renderer never
 * sees them.
 */
function shareImageQuery(target: ShareTarget): URLSearchParams {
  const params = new URLSearchParams();
  switch (target.kind) {
    case "draft":
      params.set("path", `/craft/${target.skinId}`);
      if (target.wear != null) params.set("wear", String(target.wear));
      if (target.seed != null) params.set("seed", String(target.seed));
      if (target.stattrak) params.set("st", "1");
      if (target.nametag) params.set("name", target.nametag);
      break;
    case "instance":
      params.set("path", `/items/${target.instanceId}`);
      break;
    case "player":
      params.set("path", "/");
      params.set("player", target.steamId);
      if (target.team) params.set("team", target.team);
      break;
    default:
      params.set("path", "/");
  }
  return params;
}

/**
 * The link's own query as it arrived, minus the `path` key these routes add.
 *
 * Used only for the HUMAN destination, and it has to be the whole thing: the
 * placement of five stickers and a charm lives in `s0..s4`/`charm`, so a
 * redirect that kept only the canonical keys would hand the recipient the same
 * gun with the stickers slid back to their defaults — a link that looks like it
 * worked. Bounded because it is reflected into a crawler-facing page: escaping
 * makes it safe, a cap makes it small.
 */
function forwardedShareQuery(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k === "path" || params.size >= 32) continue;
    if (v) params.set(k, v.slice(0, 256));
  }
  return params;
}

/** First value wins, so a repeated `?player=` cannot smuggle an array into a
 *  parser that expects a string. Mirrors the client router's flatten(). */
function flatQuery(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === "string") out[k] = first;
  }
  return out;
}

/**
 * Where a human who clicks a share link should land: the plugin's page in the
 * PANEL, which is a different origin from this one and one the backend cannot
 * derive. The panel is only ever reached in-cluster here (FIVESTACK_AUTH_URL),
 * and the plugin's public domain is a sibling of the panel's rather than a
 * suffix of it, so there is nothing to infer it from — it has to be configured,
 * as FIVESTACK_PANEL_URL. Null when it is not, so callers can fall back to a URL
 * they can prove; the card still unfurls either way, because the tags need no
 * panel at all.
 *
 * Deliberately not learned from traffic the way resolveInvsimUrl learns this
 * pod's own URL. The only header that would carry it is `Origin`, which any page
 * on the internet can set on a credentialed request — remembering one would turn
 * a share link into an open redirect to wherever the last attacker pointed it.
 *
 * The base is `/apps/<slug>` with the slug from 5stack-plugin.json, which is the
 * contract the host implements (see the routing section of the README).
 */
function panelShareUrl(pluginPath: string, query: URLSearchParams): string | null {
  const panel = (process.env.FIVESTACK_PANEL_URL ?? "").replace(/\/+$/, "");
  if (!panel) return null;
  const search = query.toString();
  return `${panel}/apps/inventory${pluginPath === "/" ? "" : pluginPath}${search ? `?${search}` : ""}`;
}

/** The plugin-relative path a target came from — the human link's other half. */
function sharePluginPath(target: ShareTarget): string {
  switch (target.kind) {
    case "draft":
      return `/craft/${target.skinId}`;
    case "instance":
      return `/items/${target.instanceId}`;
    default:
      return "/";
  }
}

/** PNG dimensions without reading the file: 24 bytes off the front. Only the
 *  bakes are PNGs, so an icon simply has no dimensions to declare. */
async function pngSizeOf(file: string): Promise<{ width: number; height: number } | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, "r");
    const head = Buffer.alloc(24);
    const { bytesRead } = await handle.read(head, 0, 24, 0);
    return pngPixelSize(head.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Everything the three routes below need, derived once — so the picture, the
 *  words and the tags cannot disagree about what a link is. */
async function resolveShare(query: Record<string, string>) {
  const target = parseShareTarget(query.path ?? "/", query);
  const version = await renderVersion();
  const facts = await shareFactsFor(target, version);
  const art = await shareArtFor(facts, version);
  return { target, art, ...shareText(target, facts) };
}

// The card image. Public and unauthenticated because a crawler has no session —
// that is the whole point of an unfurl — and because everything it can answer
// with is either already public (an equipped loadout) or catalog artwork.
app.get("/api/share/image", async (request, reply) => {
  const { art } = await resolveShare(flatQuery(request.query));
  if (!art) return reply.status(404).send({ error: "no share image" });
  // A bake is final for its key, so it caches for a day. The icon fallback is
  // NOT final — it is standing in for a render that may land minutes later, and
  // an unfurl cached for a day would keep showing the flat icon long after the
  // real thing existed. Ten minutes is enough to absorb the burst of fetches one
  // paste produces and short enough that the next paste gets the render.
  reply.header("Cache-Control", art.baked ? "public, max-age=86400" : "public, max-age=600");
  if (art.url) return reply.redirect(art.url, 302);
  try {
    return reply.type(art.type).send(await fs.readFile(art.file as string));
  } catch {
    return reply.status(404).send({ error: "no share image" });
  }
});

// The same answer as JSON, for a host that renders its own tags. The panel's
// link shims (web/server/middleware/*-unfurl.ts) sniff the crawler UA and
// answer at the pasted URL itself; when one lands for /apps/inventory/* this is
// the call it makes — one request, no database access, no idea what a render key
// is. Title and description arrive separately from the image for the same
// reason: the panel knows the player's name and this endpoint does not.
app.get("/api/share/meta", async (request, reply) => {
  const query = flatQuery(request.query);
  const { target, art, title, description } = await resolveShare(query);
  const origin = requestOrigin(request);
  const size = art?.file && art.type === "image/png" ? await pngSizeOf(art.file) : null;
  reply.header("Cache-Control", "public, max-age=300");
  return {
    kind: target.kind,
    title,
    description,
    image: art ? `${origin}/api/share/image?${shareImageQuery(target)}` : null,
    imageWidth: size?.width ?? null,
    imageHeight: size?.height ?? null,
    /** False means the picture is the flat econ icon — a host that would rather
     *  show nothing than a 2D icon can act on it. */
    baked: art?.baked ?? false,
    canonical: panelShareUrl(sharePluginPath(target), forwardedShareQuery(query)),
  };
});

// A complete unfurl document, served from this plugin's own domain. Point a link
// here and it unfurls today with no host changes at all; the tags are the same
// set the panel's own shims emit, so this doubles as the reference the middleware
// above would render.
app.get("/api/share/unfurl", async (request, reply) => {
  const query = flatQuery(request.query);
  const { target, art, title, description } = await resolveShare(query);
  const origin = requestOrigin(request);
  const size = art?.file && art.type === "image/png" ? await pngSizeOf(art.file) : null;
  const canonical = panelShareUrl(sharePluginPath(target), forwardedShareQuery(query));
  // og:url is the address of the THING, so it is the panel's page when we know
  // it and the URL actually fetched when we do not — never a guess. The human
  // link degrades further, to this plugin's own front door: a page that unfurls
  // beautifully and then dead-ends is worse than no page.
  const humanUrl = canonical ?? `${origin}/`;
  // Short, not immutable: the picture behind this page can improve on its own
  // (icon today, the owner's render tomorrow), and a chat client that cached the
  // document for a day would never ask again.
  reply.header("Cache-Control", "public, max-age=300");
  return reply.type("text/html; charset=utf-8").send(
    renderUnfurl({
      title,
      description,
      pageUrl: canonical ?? `${origin}${request.url}`,
      humanUrl,
      image: art ? `${origin}/api/share/image?${shareImageQuery(target)}` : null,
      imageWidth: size?.width ?? null,
      imageHeight: size?.height ?? null,
    }),
  );
});

// ---- Composite store routes ---------------------------------------------------
// Filename builder. MUST agree with compositeKey() in src/compositeStore.ts.
//
// Unlike renderKeyForRow, a disagreement here is harmless: the backend derives
// the name from the identity it verified, so a drift means clients simply never
// hit the cache. It can never serve one skin's pixels under another's name.
// The POST response echoes the derived name so a mismatch shows up in the
// client console instead of silently costing every hit.
const safeSeg = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
function compositeStem(id: {
  model: string; legacy: boolean; material: string; wear: number; seed: number; cap: number;
}) {
  return [
    safeSeg(id.model),
    id.legacy ? "legacy" : "hd",
    safeSeg(id.material.replace(/\.(vcompmat|vmat)\.json$/i, "")),
    Math.min(Math.max(id.wear, 0), 1).toFixed(4),
    Math.max(0, Math.trunc(id.seed)),
    `c${id.cap}`,
  ].join("__");
}
// Only the caps the client can actually composite at (see MAX_COMPOSITE_SIZE and
// MAX_COMPOSITE_SIZE_PROJECTED). Bounded so a client cannot invent an unlimited
// number of variants of the same skin.
const COMPOSITE_CAPS = new Set([1024, 2048, 4096]);

// Fastify's default bodyLimit is 1MB, which silently 413s every composite
// before the handler ever runs — a lossless 2k pair is a few MB and a 4k
// projected style more. Raised per route rather than globally so nothing else
// gains the right to accept a 48MB body.
//
// The same limit exists OUTSIDE the pod: ingress-nginx also defaults to 1MB, and
// the `inventory-api` Ingress carries no proxy-body-size annotation. That one
// cannot be fixed from this repo — the deploy manifests live in the panel repo.
app.post<{ Params: { gen: string; file: string } }>("/api/composite/:gen/:file", {
  bodyLimit: COMPOSITE_MAX_BYTES,
}, async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) return reply.status(401).send({ error: "not signed in" });

  const gen = request.params.gen;
  const q = request.query as Record<string, string | undefined>;
  const kind = q.kind;
  const cap = Number(q.cap);
  const wear = Number(q.wear);
  const seed = Number(q.seed);
  const model = q.model ?? "";
  const material = q.material ?? "";
  const legacy = q.legacy === "1";
  const dir = compositeDir(gen);
  if (
    !dir ||
    (kind !== "albedo" && kind !== "rm") ||
    !COMPOSITE_CAPS.has(cap) ||
    !Number.isFinite(wear) || wear < 0 || wear > 1 ||
    !Number.isInteger(seed) || seed < 0 ||
    !model || !material
  ) {
    return reply.status(400).send({ error: "bad composite identity" });
  }

  const body = request.body as Buffer;
  const ext = /^\x89PNG/.test(body?.subarray?.(0, 4).toString("latin1") ?? "")
    ? "png"
    : body?.subarray?.(0, 4).toString("latin1") === "RIFF" &&
      body.subarray(8, 12).toString("latin1") === "WEBP"
      ? "webp"
      : null;
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > COMPOSITE_MAX_BYTES || !ext) {
    return reply.status(400).send({ error: "bad composite" });
  }

  // The store is SHARED, so a client does not get to choose which skin its
  // pixels land on. Every uploaded tuple has to describe an item the caller
  // actually owns: the wear/seed pair is effectively unique per instance, so
  // this bounds the blast radius of a doctored client to its own items rather
  // than to every viewer of that skin.
  const { rows } = await pool.query(
    `SELECT item_id FROM inventory.owned_items
      WHERE steam_id = $1 AND seed = $2 AND ROUND(wear::numeric, 4) = ROUND($3::numeric, 4)`,
    [identity.steamId, seed, wear],
  );
  const owns = getItemsByIds(rows.map((r: { item_id: number }) => Number(r.item_id))).some(
    (i) => i.model === model && i.paintMaterial === material && !!i.legacyPaint === legacy,
  );
  if (!owns) return reply.status(403).send({ error: "not your item" });

  const stem = compositeStem({ model, legacy, material, wear, seed, cap });
  try {
    await fs.mkdir(dir, { recursive: true });
    // A client that could not produce lossless WebP fell back to PNG (see
    // encoderFormat in src/compositeStore.ts). Transcode it here so the store
    // does not end up permanently holding a ~3x larger file just because the
    // first viewer of that skin used a browser with a lossy WebP encoder.
    // LOSSLESS, so this re-encode cannot change a pixel. ImageMagick is already
    // in the image for the econ icons; without it the PNG is kept as-is.
    let out = body;
    let outExt = ext;
    if (ext === "png" && (await magickAvailable())) {
      const converted = await pngToLosslessWebp(body, dir);
      if (converted) {
        out = converted;
        outExt = "webp";
      }
    }
    const file = `${stem}.${kind}.${outExt}`;
    const dest = path.join(dir, file);
    // First write wins: re-uploading is pure cost, and leaving the original in
    // place means a client that somehow produces different pixels cannot
    // overwrite a bake other viewers are already caching hard.
    if (await fs.access(dest).then(() => true, () => false)) return { ok: true, file, existed: true };
    // Write-then-rename so a reader never sees a half-written image — the same
    // discipline the extractor uses for textures.
    const tmp = `${dest}.${process.pid}.tmp`;
    await fs.writeFile(tmp, out);
    await fs.rename(tmp, dest);
    void pruneComposites();
    return { ok: true, file };
  } catch {
    return reply.status(500).send({ error: "composite store unavailable" });
  }
});

let magickChecked: Promise<boolean> | null = null;
function magickAvailable(): Promise<boolean> {
  magickChecked ??= new Promise<boolean>((resolve) => {
    const p = spawn("convert", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
  return magickChecked;
}

/** PNG buffer -> lossless WebP buffer, or null if the conversion failed. */
async function pngToLosslessWebp(png: Buffer, dir: string): Promise<Buffer | null> {
  const base = path.join(dir, `.transcode.${process.pid}.${Date.now()}`);
  const src = `${base}.png`;
  const dst = `${base}.webp`;
  try {
    await fs.writeFile(src, png);
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn("convert", [src, "-define", "webp:lossless=true", "-quality", "100", dst], {
        stdio: "ignore",
      });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    });
    return ok ? await fs.readFile(dst) : null;
  } catch {
    return null;
  } finally {
    await fs.rm(src, { force: true }).catch(() => {});
    await fs.rm(dst, { force: true }).catch(() => {});
  }
}

// Served under both paths for the same reason renders are: /api/* provably
// reaches this pod, bare /composites/* backs nginx's static-miss fallback.
for (const route of ["/api/composites/:gen/:file", "/composites/:gen/:file"]) {
  app.get<{ Params: { gen: string; file: string } }>(route, async (request, reply) => {
    const { gen, file } = request.params;
    const dir = compositeDir(gen);
    if (!dir || !/^[\w.-]+\.(png|webp)$/.test(file)) {
      return reply.status(404).send({ error: "not found" });
    }
    try {
      const buf = await fs.readFile(path.join(dir, file));
      // Genuinely immutable: the generation directory covers the shader and the
      // extraction, and the stem covers the item — so this URL can never change
      // meaning. No ?v= dance needed, unlike the paint materials.
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.endsWith(".webp") ? "image/webp" : "image/png").send(buf);
    } catch {
      return reply.status(404).send({ error: "not found" });
    }
  });
}

// Trim the whole composites tree to COMPOSITE_CACHE_BYTES, least-recently-used
// first, across EVERY generation.
//
// It deliberately does not know or care which generation is "current". An
// earlier version deleted every directory that wasn't the uploading client's
// `gen`, which is wrong twice over:
//
//   - `gen` is a request parameter. A doctored client could name a generation
//     nobody uses and take the entire shared cache with it.
//   - It is not even adversarial to hit. `gen` is a hash of the client's shader
//     source, so during any rollout two builds are live at once and each upload
//     would delete the other build's cache — the two would erase each other in a
//     loop for as long as the rollout lasted.
//
// Ageing them out by LRU handles retirement on its own: nothing reads a
// superseded generation, so its files become the oldest and go first, and a
// rollout keeps both caches until the disk actually needs the space. Empty
// directories are swept afterwards.
let prunePending: Promise<void> | null = null;
function pruneComposites(): Promise<void> {
  prunePending ??= (async () => {
    try {
      const gens = await fs.readdir(COMPOSITES_DIR, { withFileTypes: true }).catch(() => []);
      const files: { path: string; size: number; used: number }[] = [];
      let total = 0;
      for (const g of gens) {
        if (!g.isDirectory()) continue;
        const dir = path.join(COMPOSITES_DIR, g.name);
        for (const name of await fs.readdir(dir).catch(() => [])) {
          const full = path.join(dir, name);
          const st = await fs.stat(full).catch(() => null);
          if (!st?.isFile()) continue;
          // atime where the filesystem keeps it (relatime updates it once a day,
          // which is plenty for an LRU measured in weeks); mtime is the floor.
          files.push({ path: full, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) });
          total += st.size;
        }
      }
      if (total > COMPOSITE_CACHE_BYTES) {
        files.sort((a, b) => a.used - b.used);
        for (const f of files) {
          if (total <= COMPOSITE_CACHE_BYTES) break;
          await fs.rm(f.path, { force: true }).catch(() => {});
          total -= f.size;
        }
      }
      // Sweep generation directories the trim emptied. rmdir, not rm -rf: it
      // refuses on a non-empty directory, so a file written between the scan and
      // now cannot be caught by it.
      for (const g of gens) {
        if (!g.isDirectory()) continue;
        await fs.rmdir(path.join(COMPOSITES_DIR, g.name)).catch(() => {});
      }
    } finally {
      prunePending = null;
    }
  })();
  return prunePending;
}

// ---- Skin test suite --------------------------------------------------------
// A dev/QA harness that renders EVERY painted finish (weapon/knife/glove) so a
// human can eyeball the whole catalog for compositor regressions at once. The
// PNGs are browser-produced (the real production render path) and streamed here
// to the same hostPath mount as the card renders — never committed, wiped and
// regenerated on demand. Serving + storage + the report live in the container;
// only the WebGL render itself needs a browser (see src/SkinTests.vue).
//
// Admin-gated: a full run writes ~2k files and pins a GPU for the better part
// of an hour, so it is not something a normal signed-in user should kick off.
const TESTS_DIR = process.env.TESTS_DIR ?? "/cs2-models/tests";
// Render key = the finish's own economy id. Stable (resumable, overwrite in
// place) and un-spoofable into a path — the regex is the only thing that ever
// reaches the filesystem.
const TEST_KEY = /^test-\d+\.png$/;
const REPORT_FILE = "report.json";
// Human good/bad triage. Its own file because it outlives the renders: Clear
// throws away every PNG and the machine report, but somebody's judgement on
// ~2k skins is not something to make them redo for a re-run.
const VERDICT_FILE = "verdicts.json";

// The work-list. Public reference data like the rest of /api/catalog.
app.get("/api/tests/catalog", async () => getRenderTestCatalog());

// Which finishes are already rendered — lets a run resume instead of redoing
// the whole catalog, and backs the gallery.
app.get("/api/tests/list", async () => {
  try {
    const files = await fs.readdir(TESTS_DIR);
    return { keys: files.filter((f) => TEST_KEY.test(f)) };
  } catch {
    return { keys: [] };
  }
});

// Persisted flags from the last run (failures + suspected-grey renders), so the
// gallery can surface problems after a reload without re-analysing pixels.
app.get("/api/tests/report", async (_request, reply) => {
  try {
    const buf = await fs.readFile(path.join(TESTS_DIR, REPORT_FILE));
    return reply.type("application/json").send(buf);
  } catch {
    return {};
  }
});
app.put("/api/tests/report", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  try {
    await fs.mkdir(TESTS_DIR, { recursive: true });
    await fs.writeFile(path.join(TESTS_DIR, REPORT_FILE), JSON.stringify(request.body ?? {}));
    return { ok: true };
  } catch {
    return reply.status(500).send({ error: "test store unavailable" });
  }
});

// Human verdicts (good / bad / note per finish). Readable by anyone who can see
// the gallery; only an admin can write.
app.get("/api/tests/verdicts", async (_request, reply) => {
  try {
    const buf = await fs.readFile(path.join(TESTS_DIR, VERDICT_FILE));
    return reply.type("application/json").send(buf);
  } catch {
    return {};
  }
});
app.put("/api/tests/verdicts", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  try {
    await fs.mkdir(TESTS_DIR, { recursive: true });
    await fs.writeFile(path.join(TESTS_DIR, VERDICT_FILE), JSON.stringify(request.body ?? {}));
    return { ok: true };
  } catch {
    return reply.status(500).send({ error: "test store unavailable" });
  }
});

// Store one rendered finish. Raw PNG body (octet-stream, same parser as the
// card render route); the key is validated against TEST_KEY before it touches
// disk.
app.post<{ Params: { key: string } }>("/api/tests/snap/:key", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const key = request.params.key;
  if (!TEST_KEY.test(key)) return reply.status(400).send({ error: "bad key" });
  const body = request.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 5_000_000 || !/^\x89PNG/.test(body.subarray(0, 4).toString("latin1"))) {
    return reply.status(400).send({ error: "bad render" });
  }
  try {
    await fs.mkdir(TESTS_DIR, { recursive: true });
    await fs.writeFile(path.join(TESTS_DIR, key), body);
    return { ok: true };
  } catch {
    return reply.status(500).send({ error: "test store unavailable" });
  }
});

// Wipe the suite (admin) — everything repopulates on the next run. Deliberately
// file-by-file rather than rm -rf: the verdict file is human triage and must
// survive, so only renders and the machine report are removed.
app.delete("/api/tests", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  let cleared = 0;
  try {
    for (const file of await fs.readdir(TESTS_DIR)) {
      if (!TEST_KEY.test(file) && file !== REPORT_FILE) continue;
      await fs.rm(path.join(TESTS_DIR, file), { force: true }).catch(() => {});
      cleared++;
    }
  } catch {
    /* nothing rendered yet */
  }
  return { cleared };
});

// Serve the rendered PNGs. Registered under BOTH paths for the same reason as
// /renders (see above): /api/tests/img/* is the canonical client path, bare
// /tests/* backs nginx's static-miss fallback.
for (const route of ["/api/tests/img/:key", "/tests/:key"]) {
  app.get<{ Params: { key: string } }>(route, async (request, reply) => {
    const key = request.params.key;
    if (!TEST_KEY.test(key)) return reply.status(404).send({ error: "not found" });
    try {
      const buf = await fs.readFile(path.join(TESTS_DIR, key));
      reply.header("Cache-Control", "public, max-age=3600");
      return reply.type("image/png").send(buf);
    } catch {
      return reply.status(404).send({ error: "not found" });
    }
  });
}

/**
 * The `/images/<file>.webp` key a caller means, or null if it isn't one.
 *
 * Every route that is asked ABOUT an item's artwork gets handed whatever the
 * viewer is holding, and what the viewer holds is a fully-resolved URL —
 * `https://<assets>/images/x.webp`, because api.ts absolutises every
 * `/images/...` string in a response so the bundle (running on the PANEL's
 * origin) can load it at all. It may now also carry `?v=<extract version>`.
 *
 * Both of those broke a bare `startsWith("/images/")` check, and broke it
 * SILENTLY: the route answers `{art: null}`, which is a legitimate answer
 * meaning "no texture on this mount", so the viewer quietly fell back to
 * cropping the flat icon for EVERY sticker. It looked like a working feature.
 * charm-model hit exactly this and was fixed there alone; this is that fix,
 * shared, so the next such route can't reintroduce it.
 */
function imagePathParam(raw: string | undefined): string | null {
  let image = raw ?? "";
  if (!image) return null;
  try {
    // Absolute URL -> pathname (which excludes the query by definition).
    if (/^https?:\/\//i.test(image)) image = new URL(image).pathname;
  } catch {
    return null;
  }
  // Bare path: drop a query/hash the URL parser never saw.
  image = image.replace(/[?#].*$/, "");
  if (!image.startsWith("/images/") || image.includes("..")) return null;
  return image;
}

// Sticker placement envelope for a weapon model (drives the 3D drag editor).
// Bounds AND the real per-slot UV anchors. Bounds alone can only rule a
// placement out; the anchors are what let the viewer put a sticker where the
// game will actually draw it. Markup is read off the extracted mount, so an
// un-extracted mount (or a knife) degrades to bounds-only rather than failing.
// The sticker ART the game actually draws, for a sticker's inventory image.
//
// `item.image` is the INVENTORY ICON — 512x384 with the art inset and pushed to
// one edge (measured on Dystopian Gaze: 11.5% at the sides, flush top, 11.2%
// clear at the bottom). The game draws `g_tSticker0` from the sticker's own
// material instead: square, no padding. Drawing the icon as a decal squashed
// every sticker and hung it above its own anchor.
//
// Resolved here rather than shipped on every catalog row because it costs a file
// read per sticker and a viewer needs at most five. Answers null — never an
// error — when the texture isn't on the mount, which is the case on any mount
// extracted before v12; the viewer then falls back to the icon.
//
// Dropped whenever the mount is re-extracted, the same way stickerMarkup.ts
// keys its caches on the source file's mtime. This is not hygiene, it is a bug
// that shipped: an extraction can change WHICH texture a sticker's material
// names — v18 repointed 6,410 sticker materials at the right event's art — and a
// process that had answered for a sticker before the run kept handing out the
// old texture path for its whole lifetime. The old file is still on the mount
// (superseded textures are pruned a generation behind), so it resolved 200 and
// the weapon kept wearing the wrong sticker with nothing in any log. Costs one
// stat per request; the map itself is what makes that acceptable.
/**
 * Everything csgo_weapon_sticker.vfx needs to draw one sticker.
 *
 * `art` is the original contract and keeps its meaning exactly, so a client
 * that predates the effect work still works. `sfx` is the rest of the material:
 * the flags that say WHICH finish this is, the scalars that tune it, and the
 * maps the shader samples. Null when the mount has no material for this sticker.
 *
 * One route rather than two because it is one file read either way, and two
 * routes reading the same document is how they end up disagreeing about which
 * sticker they resolved.
 */
interface StickerSfx {
  /** Texture paths under /textures, or null when not on this mount. */
  scratches: string | null;
  sfxMask: string | null;
  holoSpectrum: string | null;
  glitterNormal: string | null;
  normalRoughness: string | null;
  backing: string | null;
  /** Which finish. Mutually exclusive in practice, but the shader tests each. */
  glitter: boolean;
  holo: boolean;
  metallic: boolean;
  paperBacking: boolean;
  pbrFit: boolean;
  legacyTint: boolean;
  preserveRoughness: boolean;
  clampSpectrumV: boolean;
  selfIllum: boolean;
  /** Scalars. Defaults are the shader's, for the params a material may omit. */
  wear: number;
  wearScratches: number;
  colorBoost: number;
  sfxColorBoost: number;
  tintSaturate: number;
  glitterScale: number;
  colorTint: [number, number, number];
  wearBias: [number, number];
}

// Scalars arrive STRINGIFIED — the extracted material JSON mirrors cs2-lib's
// shape, where every scalar is a string ("0.858", not 0.858). Parsing with a
// default rather than Number() so an absent param and an unparseable one behave
// the same way, which is how the shader treats them.
const numParam = (list: { m_name?: string; m_flValue?: unknown; m_nValue?: unknown }[] | undefined, name: string, dflt: number) => {
  const raw = list?.find((p) => p.m_name === name);
  const v = Number(raw?.m_flValue ?? raw?.m_nValue);
  return Number.isFinite(v) ? v : dflt;
};
// `dflt` matters: the shader's variable table (dumped from the .vcs, 2026-08-10)
// defaults g_bAutomaticPBRColorFittingSticker0 and g_bClampSpectrumVSticker0 to
// TRUE — a material that authors neither still gets the PBR colour refit in
// game, so an absent param must not read as false across the board.
const boolParam = (list: { m_name?: string; m_nValue?: unknown; m_flValue?: unknown }[] | undefined, name: string, dflt = false) => {
  const raw = list?.find((p) => p.m_name === name);
  if (!raw) return dflt;
  const v = Number(raw.m_nValue ?? raw.m_flValue);
  return Number.isFinite(v) ? v === 1 : dflt;
};
const vecParam = (list: { m_name?: string; m_value?: unknown }[] | undefined, name: string, dflt: number[]) => {
  const raw = list?.find((p) => p.m_name === name)?.m_value;
  if (!Array.isArray(raw)) return dflt;
  return raw.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
};

const stickerArtCache = new Map<
  string,
  { art: string | null; artKind: "sticker" | "patch" | null; sfx: StickerSfx | null; patchBacking: string | null }
>();
let stickerArtStamp = -1;
app.get<{ Querystring: { image?: string } }>("/api/catalog/sticker-art", async (request) => {
  const image = imagePathParam(request.query.image);
  if (!image) return { art: null, artKind: null, sfx: null };
  const stamp = await fs.stat(EXTRACT_VERSION_FILE).then((s) => s.mtimeMs, () => -1);
  if (stamp !== stickerArtStamp) {
    stickerArtCache.clear();
    stickerArtStamp = stamp;
  }
  const hit = stickerArtCache.get(image);
  if (hit !== undefined) return hit;
  let art: string | null = null;
  // Which param served `art`. A patch's albedo has ORDINARY alpha; a real
  // g_tSticker0's alpha is dual-purpose (coverage ramp in 0-20, wear order
  // above) and the client must expand it ×12.75 before display — but only
  // when it knows this is what it got. "art is non-null" cannot carry that:
  // the patch fallback below serves art too.
  let artKind: "sticker" | "patch" | null = null;
  let sfx: StickerSfx | null = null;
  let patchBacking: string | null = null;
  try {
    const material = stickerMaterialFor(image, await getPatchMaterials());
    if (material) {
      const doc = JSON.parse(
        await fs.readFile(path.join(PAINTS_DIR, "materials", path.basename(material)), "utf8"),
      ) as {
        m_shaderName?: string;
        m_textureParams?: { m_name?: string; m_pValue?: string }[];
        m_intParams?: { m_name?: string; m_nValue?: unknown }[];
        m_floatParams?: { m_name?: string; m_flValue?: unknown }[];
        m_vectorParams?: { m_name?: string; m_value?: unknown }[];
      };
      // Only claim a texture once the file is really there — the material names
      // every param whether or not the extraction pulled it, and before v19 it
      // pulled exactly one of them. A client handed a path that 404s renders a
      // black effect layer, which is worse than no effect at all.
      const tex = async (name: string) => {
        const p = doc.m_textureParams?.find((t) => t.m_name === name)?.m_pValue;
        if (!p?.startsWith("/textures/")) return null;
        try {
          await fs.access(path.join(PAINTS_DIR, "textures", path.basename(p)));
          return p;
        } catch {
          return null;
        }
      };
      art = await tex("g_tSticker0");
      if (art) artKind = "sticker";
      // A PATCH IS NOT A STICKER MATERIAL. Its vmat is `csgo_character.vfx` —
      // the same shader an agent's body uses — so it has no `g_tSticker0` and
      // none of the sfx params below; its art is `g_tPatch0` and its stitched
      // fabric border is `g_tPatch0Backing`, which the agent composite draws
      // UNDER the art. Both are already extracted; nothing here needed a new
      // extraction, only the lookup.
      if (!art) {
        art = await tex("g_tPatch0");
        if (art) {
          artKind = "patch";
          patchBacking = await tex("g_tPatch0Backing");
        }
      }
      const [scratches, sfxMask, holoSpectrum, glitterNormal, normalRoughness, backing] = await Promise.all([
        tex("g_tStickerScratches"),
        tex("g_tSfxMaskSticker0"),
        tex("g_tHoloSpectrumSticker0"),
        tex("g_tGlitterNormalSticker0"),
        tex("g_tNormalRoughnessSticker0"),
        tex("g_tColor"),
      ]);
      // The sfx doc only means something on the sticker shader. A patch's
      // vmat is csgo_character.vfx: it names NONE of these params, so every
      // flag would read as its default — and the defaults are not inert
      // (pbrFit defaults TRUE). Handing that to the client would run the
      // sticker refit on patch art.
      const isStickerMaterial = (doc.m_shaderName ?? "").includes("sticker");
      const tint = vecParam(doc.m_vectorParams, "g_vColorTintSticker0", [1, 1, 1]);
      const bias = vecParam(doc.m_vectorParams, "g_vWearBiasSticker0", [1, 1]);
      // ONE namespace, not two. Valve does not sort params by prefix — a
      // g_f* scalar can be authored into m_intParams and a g_b* flag into
      // m_floatParams (g_fPatternPaintRespectsTintMask already bit us this
      // way; see GLOVES-GEN2). Splitting the lookup by list silently hands
      // back the default for every param on the wrong side.
      const scalarParams = [...(doc.m_intParams ?? []), ...(doc.m_floatParams ?? [])];
      sfx = !isStickerMaterial ? null : {
        scratches, sfxMask, holoSpectrum, glitterNormal, normalRoughness, backing,
        glitter: boolParam(scalarParams, "g_bGlitterSticker0"),
        holo: boolParam(scalarParams, "g_bHolographicSticker0"),
        metallic: boolParam(scalarParams, "g_bMetallicSticker0"),
        paperBacking: boolParam(scalarParams, "g_bPaperBackingSticker0"),
        pbrFit: boolParam(scalarParams, "g_bAutomaticPBRColorFittingSticker0", true),
        legacyTint: boolParam(scalarParams, "g_bLegacyTintMultiplySticker0"),
        preserveRoughness: boolParam(scalarParams, "g_bPreserveRoughnessSticker0"),
        clampSpectrumV: boolParam(scalarParams, "g_bClampSpectrumVSticker0", true),
        selfIllum: boolParam(scalarParams, "g_bSelfIllumSticker0"),
        wear: numParam(scalarParams, "g_flSticker0Wear", 0),
        // Variable-table default is 1, not 0 — at 0 the scratch term reads
        // 1 - min(0, tex) = 1 and the whole scratch mask is dead.
        wearScratches: numParam(scalarParams, "g_fWearScratchesSticker0", 1),
        colorBoost: numParam(scalarParams, "g_flColorBoostSticker0", 1),
        sfxColorBoost: numParam(scalarParams, "g_flSfxColorBoostSticker0", 1),
        tintSaturate: numParam(scalarParams, "g_flTintSaturateSticker0", 1),
        glitterScale: numParam(scalarParams, "g_flGlitterScaleSticker0", 1),
        colorTint: [tint[0] ?? 1, tint[1] ?? 1, tint[2] ?? 1],
        wearBias: [bias[0] ?? 1, bias[1] ?? 1],
      };
    }
  } catch {
    art = null;
    artKind = null;
    sfx = null;
  }
  // Only successes are cached. A null means "not on this mount yet", and the
  // very next thing that changes it is an extraction — which would otherwise be
  // invisible until the pod restarted, leaving every sticker on the icon.
  const answer = { art, artKind, sfx, patchBacking };
  if (art) stickerArtCache.set(image, answer);
  return answer;
});

// Which model and material a charm should render as.
//
// Asked by image, because that is all a charm placement carries. Answers null on
// a mount that predates the charm-models step, and the viewer then falls back to
// the charm's flat art — the behaviour every charm had before.
app.get<{ Querystring: { image?: string } }>("/api/catalog/charm-model", async (request) => {
  // Callers hold a fully-resolved image URL, not a path — see imagePathParam,
  // which is where this route's own hard-won handling of that now lives, and
  // which also strips the ?v= the icons carry since they became versioned.
  const image = imagePathParam(request.query.image);
  if (!image) return { charm: null };
  // cs2-lib names assets `<game stem>_<hash8>.webp`; the stem is the econ name.
  const stem = path.basename(image).replace(/\.webp$/i, "").replace(/_[0-9a-f]{8}$/i, "");
  const charm = (await getCharmModels())[stem] ?? null;
  // The whole shading map rides along rather than the entry for this charm: the
  // caller matches it against the material names inside the GLB, which only it
  // can see, and the map is the handful of materials that deviate from identity.
  return { charm, shading: charm ? await getCharmShading() : {} };
});

app.get<{ Params: { model: string } }>("/api/catalog/sticker-bounds/:model", async (request) => {
  const model = request.params.model;
  const [bounds, slots, charmQuads] = await Promise.all([
    Promise.resolve(getStickerBounds(model)),
    getStickerMarkup(model),
    getCharmMarkup(model),
  ]);
  // Charm surfaces ride along with the sticker markup because they come out of
  // the same DATA block, are fetched at the same moment (the viewer mounts a
  // weapon), and would otherwise be a second round trip for one file.
  //
  // `charmQuads` is the game's authored placement surfaces IN GLB SPACE — see
  // the note in stickerMarkup.ts. `charmBounds` is the convenience box over the
  // static body only; it deliberately does NOT come from cs2-lib 9's
  // keychainPosition* fields, which union incompatible bone frames.
  return {
    bounds,
    slots,
    // The anchor counts, per body. NOT a sticker cap — an item carries five on
    // every weapon (STICKER_LIMITS.maxStickers) and shares an anchor when the
    // stack outnumbers them; see slotCount's note. Published because the client
    // otherwise recounts the slots itself, and because a markup regression is
    // legible as a zero here and invisible in a rendered position.
    anchorCount: slotCount(slots),
    anchorCountLegacy: slotCount(slots, "body_legacy"),
    charmQuads,
    charmBounds: charmBounds(charmQuads),
    charmBoundsLegacy: charmBounds(charmQuads, "body_legacy"),
  };
});

/** What a loadout slot can be crafted from. Its own function because TWO routes
 *  ask now — the catalog itself and the stock-price map beside it — and a slot
 *  the two disagree about is a picker full of items with no prices. */
function catalogForSlot(slot: string) {
  if (slot === "knife") return { base: null, skins: getKnives() };
  if (slot === "gloves") return { base: null, skins: getGloves() };
  if (slot === "agent") return { base: null, skins: getAgents() };
  if (slot === "musickit") return { base: null, skins: getMusicKits() };
  if (slot === "collectible") return { base: null, skins: getCollectibles() };
  // Spreads the sheet's facet metadata (groups, tints) alongside `skins` —
  // graffiti is the one catalog whose splits aren't in any item field.
  if (slot === "graffiti") return { base: null, ...getGraffiti() };
  if (slot === "zeus") return getWeaponSkins("taser");
  if (slot === "c4") return getWeaponSkins("c4");
  return getWeaponSkins(slot);
}

app.get<{ Querystring: { slot?: string } }>(
  "/api/catalog/skins",
  async (request, reply) => {
    const slot = request.query.slot;
    if (!slot) {
      return reply.status(400).send({ error: "slot required" });
    }
    return catalogForSlot(slot);
  },
);

// The collections index — every skin set in the game, with the ids of what is in
// it. Small enough to hand over whole (94 rows, ~1.6k ids) and deliberately so:
// the client intersects those ids with the inventory it already has to answer
// "you own 4 of 17", which is a set operation, not an endpoint.
app.get("/api/catalog/collections", async () => getCollections());

// One collection's finishes. A key nothing answers to is a stale link, not a
// client error — 404 rather than 400, and the armory shows its empty state.
app.get<{ Querystring: { key?: string } }>("/api/catalog/collection", async (request, reply) => {
  const page = getCollection(request.query.key ?? "");
  return page ?? reply.status(404).send({ error: "unknown collection" });
});

// Attachment pickers: one page of matches, the match total so the grid can scroll
// on into a 10k-item catalog instead of stopping at an arbitrary cap, and the
// facet counts that draw the filter bar. See searchAttachments for the facets.
//
// The page ceiling is a guard against a hand-written ?limit=99999 dumping the
// catalog in one response, not a product limit — the client asks for another page.
const CATALOG_PAGE = 120;
const CATALOG_PAGE_MAX = 500;
type PageQuery = {
  q?: string;
  group?: string;
  collection?: string;
  rarity?: string;
  sort?: string;
  dir?: string;
  offset?: string;
  limit?: string;
};
const ATTACH_SORTS = new Set<AttachSort>(["default", "rarity", "name"]);

function attachQuery(kind: AttachKind, query: PageQuery): AttachQuery {
  const asked = Math.floor(Number(query.limit)) || CATALOG_PAGE;
  const sort = query.sort as AttachSort | undefined;
  return {
    kind,
    q: query.q ?? "",
    group: query.group ?? "",
    collection: query.collection ?? "",
    rarity: query.rarity ?? "",
    // An unknown sort falls back to catalog order rather than 400ing — a stale
    // link should show the catalog, not an error. An absent `dir` lets the sort's
    // own natural direction apply.
    sort: sort && ATTACH_SORTS.has(sort) ? sort : "default",
    dir: query.dir === "asc" || query.dir === "desc" ? query.dir : undefined,
    offset: Math.max(0, Math.floor(Number(query.offset)) || 0),
    limit: Math.min(CATALOG_PAGE_MAX, Math.max(1, asked)),
  };
}

// One handler shape, three paths — the pickers differ only in which catalog they
// browse. Paths kept as-is (rather than folded into ?kind=) so a frontend bundle
// from before the facets existed keeps working against this backend: the extra
// fields in the response are simply ignored by it.
for (const [path, kind] of [
  ["stickers", "sticker"],
  ["charms", "charm"],
  ["patches", "patch"],
] as [string, AttachKind][]) {
  app.get<{ Querystring: PageQuery }>(`/api/catalog/${path}`, async (request) =>
    searchAttachments(attachQuery(kind, request.query)),
  );
}

// Bulk id → item lookup, for rehydrating a shared craft link. Capped so a
// hand-written ?ids= can't turn into a catalog dump.
app.get<{ Querystring: { ids?: string } }>("/api/catalog/items", async (request) => {
  const ids = (request.query.ids ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 24);
  if (!ids.length) return [];
  // Agents carry their patch-slot count here too, not only on /api/catalog.
  // This is the route the CRAFT page resolves an owned item through, so without
  // it the form fell back to five slots for every agent — which is wrong for 62
  // of the 63 (they have three). See patchSlotsFor.
  return Promise.all(
    getItemsByIds(ids).map(async (i) =>
      i.type === "agent" && i.model ? { ...i, patchSlots: await patchSlotsFor(i.model) } : i,
    ),
  );
});

// ---- Inventory (per-user owned item instances; the loadout is craft-gated) ----

// Sticker/patch slot entries: legacy rows stored plain item ids; newer rows
// store {id, x, y, r, w} placement specs. Normalize on read. `w` is the
// sticker's own scratch wear (0 pristine .. 1 scratched off) — distinct from
// the weapon's float wear. Rows written before it existed normalize to null,
// which reads as pristine everywhere downstream.
/**
 * `inst` is the owned_items row this attachment IS, when it is a thing the user
 * owns rather than a bare catalog id.
 *
 * That link is what makes a sticker on a gun the same object as the sticker in
 * the inventory, and it is why `w` below is a FALLBACK rather than the truth:
 * a linked attachment's scratch lives on its own row, so editing it from the
 * sticker's page, the weapon's options column or the 3D preview all write to
 * one place and every gun wearing it re-renders. Nothing has to be kept in
 * sync because nothing is duplicated.
 *
 * Unlinked specs stay legal forever: Steam-imported guns have their stickers
 * SCRAPED out of a description blob (see attachmentIds), so those are catalog
 * ids with no instance behind them and `w` is all they will ever have.
 */
type AttachSpec = {
  id: number;
  x?: number | null;
  y?: number | null;
  r?: number | null;
  w?: number | null;
  inst?: number | null;
} | null;
// Clamp on READ as well as on write: the game applies this straight to the
// "sticker slot N wear" econ attribute, so a bad float already sitting in the
// JSONB column must never reach a server.
//
// Truncated to the game's stored precision (2dp) as well as clamped. An
// over-precise value does not survive the round trip through an inspect link,
// so the placement the user saved comes back as a slightly different one.
function normWear(w: unknown): number | null {
  if (typeof w !== "number" || !Number.isFinite(w)) return null;
  return truncateToPrecision(Math.min(1, Math.max(0, w)), STICKER_LIMITS.wearFactor);
}
/**
 * A sticker's in-plane rotation, in degrees. Lives in catalog.ts with the limits
 * it enforces, so `tools/inspect-roundtrip.ts` can test it without booting a
 * server — see the note there.
 */
const normRotation = (r: unknown): number | null =>
  typeof r === "number" && Number.isFinite(r) ? normStickerRotation(r) : null;
/**
 * A sticker's UV offset from its slot anchor.
 *
 * Truncated only, NOT clamped: the real limit is the authored region in the
 * weapon's sticker markup, which is a triangle soup rather than a range and
 * which the viewer already clamps a drag against. A range check here would have
 * to use cs2-lib's bounding box, and that box overshoots the region badly (on
 * the M4A1-S it runs to u +1.007 where the region ends at +0.467), so it would
 * reject nothing real while implying a guarantee it can't make.
 */
function normOffset(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return truncateToPrecision(v, STICKER_LIMITS.offsetFactor);
}
/**
 * Accepts a string as well as a number, because that is how it comes BACK.
 *
 * owned_items.id is a bigint, and node-postgres hands those to JS as strings —
 * so an id makes the round trip to the client as `"1014"` and returns as one.
 * Stored as a NUMBER in the jsonb regardless, which is what the backfill in
 * schema.sql writes and what jsonb_typeof(...) = 'number' tests for.
 */
const normInst = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
};
function normSpecs(arr: unknown): AttachSpec[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((entry) => {
    if (entry == null) return null;
    if (typeof entry === "number") return { id: entry };
    if (typeof entry === "object" && typeof (entry as { id?: unknown }).id === "number") {
      const e = entry as {
        id: number; x?: number | null; y?: number | null; r?: number | null; w?: number | null; inst?: number | null;
      };
      return {
        id: e.id,
        x: normOffset(e.x),
        y: normOffset(e.y),
        r: normRotation(e.r),
        w: normWear(e.w),
        inst: normInst(e.inst),
      };
    }
    return null;
  });
}
/** Every owned_items id an item row's attachments point at. */
function referencedInstances(row: {
  stickers?: unknown[] | null;
  patches?: unknown[] | null;
  charm_offset?: { inst?: number | null } | null;
}): number[] {
  const out = [
    ...normSpecs(row.stickers).map((s) => s?.inst ?? null),
    ...normSpecs(row.patches).map((s) => s?.inst ?? null),
    normInst(row.charm_offset?.inst),
  ].filter((v): v is number => v != null);
  return [...new Set(out)];
}

interface ItemRow {
  id: number;
  item_id: number;
  wear: number | null;
  seed: number | null;
  stattrak: boolean;
  stattrak_count?: number | null;
  nametag: string | null;
  stickers?: unknown[] | null;
  charm_id?: number | null;
  /** Placement plus the charm's own PATTERN. `seed` rides in the same jsonb as
   *  x/y/z rather than taking a column of its own: it is per-attached-charm,
   *  arrives and leaves with the charm, and the game's keychain message carries
   *  it in the same breath as the offsets. */
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null } | null;
  patches?: unknown[] | null;
  /**
   * When this instance entered the inventory.
   *
   * A string by the time anything here reads it: node-postgres hands back a Date
   * and it becomes an ISO string on the way out through JSON, so the client sorts
   * lexicographically — which is the same order numerically for ISO-8601.
   *
   * Note the id would ALSO work as a proxy: it is an identity column, so higher
   * means inserted later. This carries the real field anyway, because sorting a
   * user-visible "recently added" on a surrogate key is only correct until
   * someone backfills a row, and because the date is worth showing.
   */
  created_at?: string | null;
}

// Reject bad wear on the RAW array — normSpecs() clamps, so it has to be
// checked before normalization or an out-of-range value is silently accepted.
function checkWear(arr: unknown[]): string | null {
  for (const entry of arr) {
    if (entry == null || typeof entry !== "object") continue;
    const w = (entry as { w?: unknown }).w;
    if (w == null) continue;
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1) {
      return "Sticker wear must be between 0 and 1.";
    }
  }
  return null;
}

// Validate sticker/charm attachments; returns an error string or null.
//
// `item_id` is the thing being attached TO — needed because some attachments
// are only legal on some bases (see the charm rule at the bottom).
function checkAttachments(
  item_id: number | null | undefined,
  stickers?: unknown[] | null,
  charm_id?: number | null,
  patches?: unknown[] | null,
): string | null {
  if (stickers != null) {
    if (!Array.isArray(stickers) || stickers.length > STICKER_LIMITS.maxStickers) {
      return `Up to ${STICKER_LIMITS.maxStickers} stickers can be applied.`;
    }
    for (const spec of normSpecs(stickers)) {
      if (spec != null && getItem(spec.id)?.type !== "sticker") return "That isn't a sticker.";
    }
    const badWear = checkWear(stickers);
    if (badWear) return badWear;
  }
  if (patches != null) {
    if (!Array.isArray(patches) || patches.length > STICKER_LIMITS.maxPatches) {
      return `Up to ${STICKER_LIMITS.maxPatches} patches can be applied.`;
    }
    for (const spec of normSpecs(patches)) {
      if (spec != null && getItem(spec.id)?.type !== "patch") return "That isn't a patch.";
    }
    const badWear = checkWear(patches);
    if (badWear) return badWear;
  }
  if (charm_id != null) {
    if (getItem(charm_id)?.type !== "keychain") {
      return "That isn't a charm.";
    }
    // Charms hang off GUNS only — CS2 has no attachment point on a knife, a
    // glove or an agent, and one sent anyway is dropped by the game. The
    // editor doesn't offer the slot; this is the same rule at the door, so a
    // stale client or a hand-rolled request can't leave a charm marked
    // attached to something that can never show it.
    const base = item_id != null ? getItem(item_id) : null;
    if (base && base.type !== "weapon") {
      return "That item can't take a charm.";
    }
  }
  return null;
}
/** wear/seed of the owned rows an item's attachments are linked to. */
type InstFacts = Map<number, { wear: number | null; seed: number | null }>;
/**
 * Load the attachment instances a set of item rows point at.
 *
 * Skipped entirely when nothing is linked, which is the common case for a
 * Steam-heavy inventory and for every row written before the link existed.
 */
async function instFactsFor(steamId: string, rows: Parameters<typeof referencedInstances>[0][]): Promise<InstFacts> {
  const ids = [...new Set(rows.flatMap(referencedInstances))];
  if (!ids.length) return new Map();
  // Scoped to the owner: an `inst` is user input, and without this a crafted
  // spec could name someone else's row and read its wear back out.
  const { rows: found } = await pool.query<{ id: string; wear: number | null; seed: number | null }>(
    `SELECT id, wear, seed FROM inventory.owned_items WHERE steam_id = $1 AND id = ANY($2::bigint[])`,
    [steamId, ids],
  );
  return new Map(found.map((r) => [Number(r.id), { wear: r.wear, seed: r.seed }]));
}
/**
 * Fold each LINKED attachment's own wear/seed back into the spec that names it.
 *
 * The single place the link is dereferenced. Everything downstream — the
 * inspect link, the equipped feed the game server reads, the enriched shape the
 * UI gets — then works off a plain spec and never has to know whether the
 * scratch came from the weapon's blob or the sticker's own row. That is the
 * whole trick: one resolve at read time instead of four consumers each
 * remembering to check.
 *
 * A spec with no `inst`, or one pointing at a row that has since been deleted,
 * keeps its inline `w`. Steam-scraped attachments never have an instance and
 * are the reason that fallback is permanent rather than a migration step.
 */
function resolveAttachments<T extends AttachBody>(row: T, insts: InstFacts): T {
  const fix = (s: AttachSpec): AttachSpec => {
    if (!s) return null;
    const own = s.inst != null ? insts.get(s.inst) : undefined;
    return own ? { ...s, w: own.wear ?? null } : s;
  };
  const charmInst = normInst(row.charm_offset?.inst);
  const charmOwn = charmInst != null ? insts.get(charmInst) : undefined;
  return {
    ...row,
    stickers: normSpecs(row.stickers).map(fix),
    patches: normSpecs(row.patches).map(fix),
    charm_offset: charmOwn ? { ...(row.charm_offset ?? {}), seed: charmOwn.seed ?? null } : row.charm_offset,
  };
}
/** Load the links for these rows and dereference them in one step. */
async function withAttachments<T extends AttachBody>(steamId: string, rows: T[]): Promise<T[]> {
  const insts = await instFactsFor(steamId, rows);
  return rows.map((r) => resolveAttachments(r, insts));
}
function enrichAttachments<T extends { stickers?: unknown[] | null; charm_id?: number | null; charm_offset?: ItemRow["charm_offset"]; patches?: unknown[] | null }>(row: T) {
  const enrich = (spec: AttachSpec) =>
    spec
      ? {
          ...getItem(spec.id),
          x: spec.x ?? null,
          y: spec.y ?? null,
          r: spec.r ?? null,
          w: spec.w ?? null,
          // Rides out to the UI so an edit can send it back. Without the round
          // trip every save would look like a fresh catalog pick and mint the
          // sticker again.
          //
          // Emitted as a STRING to match how owned_items.id is serialised —
          // node-postgres renders bigints as strings, so the inventory's own
          // ids are `"1014"`. Leaving this a number made every `inst === id`
          // comparison in the UI quietly false, which is the worst shape a bug
          // can take: the sticker is there, and nothing can find it.
          inst: spec.inst != null ? String(spec.inst) : null,
        }
      : null;
  return {
    ...row,
    // Sparse arrays: index = the sticker/patch POSITION on the item.
    stickers: normSpecs(row.stickers).map(enrich),
    patches: normSpecs(row.patches).map(enrich),
    charm:
      row.charm_id != null
        ? {
            ...getItem(row.charm_id),
            ...(row.charm_offset ?? {}),
            inst: normInst(row.charm_offset?.inst) != null ? String(normInst(row.charm_offset?.inst)) : null,
          }
        : null,
  };
}

// Enrich an owned instance with catalog data + its loadout slot + where it's
// equipped, so the UI can render and validate without a second catalog lookup.
function enrichInstance(row: ItemRow, equippedOn: { team: string; slot: string }[]) {
  const item = getItem(row.item_id);
  return {
    id: row.id,
    item_id: row.item_id,
    wear: row.wear,
    seed: row.seed,
    stattrak: row.stattrak,
    // Only meaningful when stattrak is set; the 3D module reads it to drive the
    // digit atlas. The 2D card render deliberately ignores it (blank display),
    // which is what keeps the count out of renderKeyFor and the card off the
    // re-bake treadmill every time a kill lands.
    stattrak_count: row.stattrak ? row.stattrak_count ?? 0 : 0,
    nametag: row.nametag,
    // Drives the "Recently added" sort. Emitted for every instance rather than
    // only when that sort is active: the client sorts in memory over the list it
    // already holds, so a field the row omits is a mode that silently does
    // nothing.
    created_at: row.created_at ?? null,
    slot: slotForItem(row.item_id),
    item,
    equipped: equippedOn.filter((e) => e.slot === slotForItem(row.item_id)),
  };
}

app.get("/api/inventory", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const [{ rows: items }, { rows: equips }] = await Promise.all([
    pool.query<ItemRow>(
      `SELECT id, item_id, wear, seed, stattrak, stattrak_count, nametag, stickers, charm_id, charm_offset, patches, origin, created_at
       FROM inventory.owned_items WHERE steam_id = $1 ORDER BY id DESC`,
      [identity.steamId],
    ),
    pool.query<{ team: string; slot: string; item_instance_id: number }>(
      `SELECT team, slot, item_instance_id FROM inventory.loadout
       WHERE steam_id = $1 AND item_instance_id IS NOT NULL`,
      [identity.steamId],
    ),
  ]);
  const byInstance = new Map<number, { team: string; slot: string }[]>();
  for (const e of equips) {
    const list = byInstance.get(e.item_instance_id) ?? [];
    list.push({ team: e.team, slot: e.slot });
    byInstance.set(e.item_instance_id, list);
  }
  // Every row the user owns is already in hand, so the attachment links resolve
  // out of THIS result set — instFactsFor's query is for the endpoints that
  // only have one row.
  const insts: InstFacts = new Map(items.map((r) => [Number(r.id), { wear: r.wear, seed: r.seed }]));
  const resolved = items.map((r) => resolveAttachments(r, insts));
  // Which weapon each attachment instance is currently on. Derived rather than
  // stored: the weapon's spec list is the single record of what is applied, and
  // a second column saying the same thing is a second thing to get wrong.
  // Keyed and valued as STRINGS, matching how owned_items.id serialises — this
  // is compared against `id` in the UI, and a number would never match.
  const attachedTo = new Map<number, string>();
  for (const row of items) {
    for (const inst of referencedInstances(row)) attachedTo.set(inst, String(row.id));
  }
  // NO prices here, deliberately. They are a second request (see
  // /api/inventory/prices): an inventory is what someone came for and it must
  // paint the moment it is ready, while pricing is an enhancement that can
  // arrive a beat later — and being separate means it can also be re-fetched on
  // its own after a sync, a craft, or the switch being turned on.
  return resolved.map((row) => ({
    ...enrichAttachments(row),
    slot: slotForItem(row.item_id),
    item: getItem(row.item_id),
    equipped: byInstance.get(row.id) ?? [],
    // "On your AK-47" — what makes an owned sticker feel owned rather than
    // duplicated. Null when it is loose in the inventory.
    attached_to: attachedTo.get(Number(row.id)) ?? null,
  }));
});

/** The attachment fields of a craft/update body, as they arrive and as they leave. */
type AttachBody = {
  stickers?: unknown[] | null;
  patches?: unknown[] | null;
  charm_id?: number | null;
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null; inst?: number | null } | null;
};
/**
 * Turn attachment specs into OWNED attachments, and take them off whatever else
 * was wearing them.
 *
 * Two things happen here, and both are what "it's in my inventory" means:
 *
 * MINTING. A spec with no `inst` came off the catalog — the user picked a
 * sticker they don't own. Saving mints it, so the sticker on the gun and the
 * sticker in the inventory are one row from that moment on. Deliberately at
 * SAVE and not at attach: everything else in this editor commits on save, and
 * minting on attach would litter the inventory with stickers from a craft that
 * was abandoned.
 *
 * CONSUMING. An instance can only be on one weapon, so applying it here takes
 * it off anything else. That is the CS2 rule and the one the user picked; the
 * escape hatch for wanting a sticker on two rifles is to own two, which is what
 * duplicate is for. The move is silent at this layer on purpose — the frontend
 * knows `attached_to` from the inventory and asks before it gets here, and a
 * server-side reject would just be a second way to say the same thing.
 *
 * NOT reachable from the Steam sync, and that matters: the sync writes scraped
 * catalog ids straight to the column, so routing it through here would mint a
 * fresh sticker instance on every re-sync.
 */
async function linkAttachments(steamId: string, body: AttachBody, selfId: number | null): Promise<AttachBody> {
  const stickers = normSpecs(body.stickers);
  const patches = normSpecs(body.patches);
  const charmId = body.charm_id ?? null;
  const charmOffset = body.charm_offset ?? null;

  // Trust nothing: an `inst` is user input, so it only survives if the row is
  // the caller's AND is actually the item the spec claims. A mismatch falls
  // through to minting rather than erroring — the attachment is still valid,
  // it just isn't the instance it said it was.
  const claimed = [
    ...stickers.map((s) => s?.inst ?? null),
    ...patches.map((s) => s?.inst ?? null),
    normInst(charmOffset?.inst),
  ].filter((v): v is number => v != null);
  const valid = new Map<number, number>(); // inst id -> item_id
  if (claimed.length) {
    const { rows } = await pool.query<{ id: string; item_id: number }>(
      `SELECT id, item_id FROM inventory.owned_items WHERE steam_id = $1 AND id = ANY($2::bigint[])`,
      [steamId, [...new Set(claimed)]],
    );
    for (const r of rows) valid.set(Number(r.id), r.item_id);
  }

  const minted: number[] = [];
  // One instance cannot be in two slots of the SAME weapon either, and
  // detachElsewhere can't catch that — it skips this row on purpose, so that a
  // plain re-save doesn't strip the gun of its own stickers. Claiming an id
  // that has already been taken by an earlier slot in this same request falls
  // through to minting, which is what a second copy of a sticker is.
  const taken = new Set<number>();
  /** Resolve one spec to an owned instance, minting if it hasn't got one. */
  const link = async (itemId: number, w: number | null, seedFor: number | null, inst: number | null) => {
    if (inst != null && valid.get(inst) === itemId && !taken.has(inst)) {
      taken.add(inst);
      // The attachment's OWN row is what read time dereferences — see
      // resolveAttachments, which folds this row's wear/seed back OVER the
      // spec stored in the weapon's jsonb. So an edit that changes a charm's
      // pattern or a sticker's scratch has to land here as well; writing it
      // into the weapon's blob alone was silently lossy, because the very
      // response to the save read it straight back off the untouched row.
      //
      // COALESCE, not a plain assignment: a spec carries only the fields its
      // kind has (a sticker has no pattern, a patch has neither), and a null
      // there means "this spec has nothing to say about it" rather than
      // "clear it".
      if (w != null || seedFor != null) {
        await pool.query(
          `UPDATE inventory.owned_items
              SET wear = COALESCE($3, wear), seed = COALESCE($4, seed)
            WHERE id = $1 AND steam_id = $2`,
          [inst, steamId, w, seedFor],
        );
      }
      return inst;
    }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO inventory.owned_items (steam_id, item_id, wear, seed, origin)
       VALUES ($1,$2,$3,$4,'crafted') RETURNING id`,
      [steamId, itemId, w, seedFor],
    );
    const id = Number(rows[0].id);
    minted.push(id);
    taken.add(id);
    return id;
  };

  const outStickers: AttachSpec[] = [];
  for (const s of stickers) {
    outStickers.push(s ? { ...s, inst: await link(s.id, s.w ?? null, null, s.inst ?? null) } : null);
  }
  const outPatches: AttachSpec[] = [];
  for (const p of patches) {
    outPatches.push(p ? { ...p, inst: await link(p.id, p.w ?? null, null, p.inst ?? null) } : null);
  }
  let outCharm = charmOffset;
  if (charmId != null) {
    const inst = await link(charmId, null, charmOffset?.seed ?? null, normInst(charmOffset?.inst));
    outCharm = { ...(charmOffset ?? {}), inst };
  }

  const used = [
    ...outStickers.map((s) => s?.inst ?? null),
    ...outPatches.map((s) => s?.inst ?? null),
    normInst(outCharm?.inst),
  ].filter((v): v is number => v != null);
  await detachElsewhere(steamId, used, selfId, minted);

  return { stickers: outStickers, patches: outPatches, charm_id: charmId, charm_offset: outCharm };
}
/**
 * Strip these instances off every OTHER item the user owns.
 *
 * A freshly minted id cannot be on anything yet, so the scan is skipped when
 * nothing pre-existing is in play — which is the whole cost in the common case
 * of building a gun out of catalog picks.
 *
 * Scans the user's rows in JS rather than asking Postgres to match inside the
 * jsonb: a containment query needs a GIN index to beat a scan, and one player's
 * inventory is a few hundred rows. Revisit if that stops being true.
 */
async function detachElsewhere(steamId: string, insts: number[], keepRowId: number | null, minted: number[]) {
  const fresh = new Set(minted);
  const hunt = new Set(insts.filter((i) => !fresh.has(i)));
  if (!hunt.size) return;
  const { rows } = await pool.query<ItemRow & { id: string }>(
    `SELECT id, stickers, patches, charm_id, charm_offset FROM inventory.owned_items
     WHERE steam_id = $1 AND (stickers IS NOT NULL OR patches IS NOT NULL OR charm_offset IS NOT NULL)`,
    [steamId],
  );
  for (const row of rows) {
    const rowId = Number(row.id);
    if (keepRowId != null && rowId === keepRowId) continue;
    const stickers = normSpecs(row.stickers);
    const patches = normSpecs(row.patches);
    const charmInst = normInst(row.charm_offset?.inst);
    const nextStickers = stickers.map((s) => (s && s.inst != null && hunt.has(s.inst) ? null : s));
    const nextPatches = patches.map((s) => (s && s.inst != null && hunt.has(s.inst) ? null : s));
    const dropCharm = charmInst != null && hunt.has(charmInst);
    const changed =
      dropCharm ||
      nextStickers.some((s, i) => s !== stickers[i]) ||
      nextPatches.some((s, i) => s !== patches[i]);
    if (!changed) continue;
    await pool.query(
      `UPDATE inventory.owned_items
         SET stickers = $2::jsonb, patches = $3::jsonb,
             charm_id = CASE WHEN $4 THEN NULL ELSE charm_id END,
             charm_offset = CASE WHEN $4 THEN NULL ELSE charm_offset END
       WHERE id = $1`,
      [
        rowId,
        nextStickers.some(Boolean) ? JSON.stringify(nextStickers) : null,
        nextPatches.some(Boolean) ? JSON.stringify(nextPatches) : null,
        dropCharm,
      ],
    );
  }
}

app.post<{ Body: Partial<ItemRow> }>("/api/inventory/craft", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches } = request.body;
  if (typeof item_id !== "number" || !getItem(item_id)) {
    return reply.status(400).send({ error: "That item doesn't exist." });
  }
  if (!isOwnable(item_id)) {
    return reply.status(400).send({ error: "That item can't be owned." });
  }
  const attachErr = checkAttachments(item_id, stickers, charm_id, patches);
  if (attachErr) {
    return reply.status(400).send({ error: attachErr });
  }
  // Scalars were going into the column unchecked and straight on into the feed
  // the CS2 server applies. cs2-lib knows each item's real float range, pattern
  // range and whether it can be StatTrak'd at all — see validateCraftAttrs.
  const checked = validateCraftAttrs(item_id, { wear, seed, stattrak, nametag });
  if ("error" in checked) {
    return reply.status(400).send({ error: checked.error });
  }
  // Mint the attachments into the inventory and take them off anything else
  // wearing them, BEFORE the weapon row is written — the specs it stores are
  // the linked ones. selfId null: this row doesn't exist yet, so there is
  // nothing of its own to preserve.
  const linked = await linkAttachments(identity.steamId, { stickers, patches, charm_id, charm_offset }, null);
  const { rows } = await pool.query<ItemRow>(
    `INSERT INTO inventory.owned_items (steam_id, item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb)
     RETURNING id, item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches`,
    [
      identity.steamId, item_id,
      checked.clean.wear ?? null, checked.clean.seed ?? null,
      checked.clean.stattrak ?? false, checked.clean.nametag ?? null,
      normSpecs(linked.stickers).some(Boolean) ? JSON.stringify(normSpecs(linked.stickers)) : null, charm_id ?? null,
      linked.charm_offset ? JSON.stringify(linked.charm_offset) : null,
      normSpecs(linked.patches).some(Boolean) ? JSON.stringify(normSpecs(linked.patches)) : null,
    ],
  );
  return {
    ...enrichInstance(rows[0], []),
    ...enrichAttachments((await withAttachments(identity.steamId, [rows[0]]))[0]),
  };
});

// Update a crafted instance (StatTrak / wear / pattern / nametag). Reflects
// everywhere the instance is equipped.
app.post<{ Params: { id: string }; Body: Partial<ItemRow> }>(
  "/api/inventory/:id",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    // Imported items mirror a real Steam inventory — read-only by design.
    // `item_id` comes back too: the body doesn't carry it on an edit, and the
    // attachment rules need to know WHAT is being attached to.
    const chk = await pool.query<{ origin: string | null; item_id: number }>(
      `SELECT origin, item_id FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
      [Number(request.params.id), identity.steamId],
    );
    // Existence is settled HERE, before anything is written. linkAttachments
    // mints rows, and running it against an id that turns out not to be the
    // caller's would leave those mints behind with no weapon to hang on.
    if (!chk.rows.length) {
      return reply.status(404).send({ error: "That item isn't in your inventory." });
    }
    if (chk.rows[0]?.origin === "steam") {
      return reply.status(400).send({ error: "Imported items are read-only — duplicate them to edit." });
    }
    const id = Number(request.params.id);
    const { wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches } = request.body;
    const attachErr = checkAttachments(chk.rows[0].item_id, stickers, charm_id, patches);
    if (attachErr) {
      return reply.status(400).send({ error: attachErr });
    }
    // Same per-item check the craft path does. It matters MORE here: an edit is
    // where a float gets dragged, and the row it writes is already equipped, so
    // an impossible value reaches the game server on the next poll rather than
    // waiting to be equipped.
    const checked = validateCraftAttrs(chk.rows[0].item_id, { wear, seed, stattrak, nametag });
    if ("error" in checked) {
      return reply.status(400).send({ error: checked.error });
    }
    const hasStickers = stickers !== undefined;
    const hasCharm = charm_id !== undefined;
    const hasPatches = patches !== undefined;
    // Only what this request actually sends goes through the linker — an
    // omitted field means "leave it alone", and minting for a key the caller
    // never mentioned would grant stickers on a rename.
    const linked = await linkAttachments(
      identity.steamId,
      {
        stickers: hasStickers ? stickers : [],
        patches: hasPatches ? patches : [],
        charm_id: hasCharm ? charm_id : null,
        charm_offset: hasCharm ? charm_offset : null,
      },
      // Keep THIS row's own links: an edit that only moves a sticker must not
      // read as "applied elsewhere" and strip the gun it is already on.
      id,
    );
    const { rows } = await pool.query<ItemRow>(
      `UPDATE inventory.owned_items SET
         wear = COALESCE($3, wear), seed = COALESCE($4, seed),
         stattrak = COALESCE($5, stattrak), nametag = $6,
         stickers = CASE WHEN $7 THEN $8::jsonb ELSE stickers END,
         charm_id = CASE WHEN $9 THEN $10 ELSE charm_id END,
         charm_offset = CASE WHEN $9 THEN $11::jsonb ELSE charm_offset END,
         patches = CASE WHEN $12 THEN $13::jsonb ELSE patches END
       WHERE id = $1 AND steam_id = $2
       RETURNING id, item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches`,
      [
        // `?? null` keeps the COALESCE contract: a key validateCraftAttrs left
        // unset is one the request never sent, and null means "leave it alone".
        id, identity.steamId,
        checked.clean.wear ?? null, checked.clean.seed ?? null,
        checked.clean.stattrak ?? null, checked.clean.nametag ?? null,
        hasStickers, hasStickers && normSpecs(linked.stickers).some(Boolean) ? JSON.stringify(normSpecs(linked.stickers)) : null,
        hasCharm, hasCharm ? charm_id ?? null : null,
        hasCharm && linked.charm_offset ? JSON.stringify(linked.charm_offset) : null,
        hasPatches, hasPatches && normSpecs(linked.patches).some(Boolean) ? JSON.stringify(normSpecs(linked.patches)) : null,
      ],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: "That item isn't in your inventory." });
    }
    return {
      ...enrichInstance(rows[0], []),
      ...enrichAttachments((await withAttachments(identity.steamId, [rows[0]]))[0]),
    };
  },
);

// One place that turns an item + its attachments into an inspect link, shared
// by the saved-instance route and the live draft route below. They MUST agree:
// the whole point of previewing a draft is that what you inspect is what you
// will get, so a second copy of this that drifts is worse than useless.
function inspectLinkFor(
  itemId: number,
  row: {
    wear?: number | null;
    seed?: number | null;
    stattrak?: boolean;
    stattrak_count?: number | null;
    nametag?: string | null;
    stickers?: unknown[] | null;
    patches?: unknown[] | null;
    charm_id?: number | null;
    // seed included, or "Inspect in game" on an UNSAVED craft would drop the
    // charm pattern the user just set and show 0.
    charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null } | null;
  },
): string | null {
  const item = getItem(itemId);
  if (!item || item.def == null) return null;

  // Agents carry patches through the sticker slots, same as the equipped feed.
  const attachments = normSpecs(item.type === "agent" ? row.patches : row.stickers);
  const stickers: InspectSticker[] = [];
  attachments.forEach((spec, slot) => {
    if (!spec) return;
    const kit = getItem(spec.id)?.index;
    if (kit == null) return;
    stickers.push({
      slot,
      id: kit as number,
      wear: spec.w ?? null,
      offsetX: spec.x ?? null,
      offsetY: spec.y ?? null,
      rotation: spec.r ?? null,
    });
  });

  const keychains: InspectSticker[] = [];
  const charm = row.charm_id != null ? getItem(row.charm_id) : null;
  if (charm?.index != null) {
    keychains.push({
      slot: 0,
      id: charm.index as number,
      // Must match what the equipped feed sends as `keychains[].sticker`, or
      // the slab you inspect is not the slab the server puts on the gun.
      wrappedSticker: charm.stickerIndex ?? null,
      offsetX: row.charm_offset?.x ?? null,
      offsetY: row.charm_offset?.y ?? null,
      offsetZ: row.charm_offset?.z ?? null,
      pattern: row.charm_offset?.seed ?? 0,
    });
  }

  return buildInspectLink({
    defindex: item.def as number,
    paintindex: (item.index as number | undefined) ?? 0,
    paintseed: row.seed ?? 0,
    paintwear: row.wear ?? 0,
    stattrak: row.stattrak ?? false,
    killeatervalue: row.stattrak ? row.stattrak_count ?? 0 : null,
    nametag: row.nametag ?? null,
    stickers,
    keychains,
  });
}

const clampCount = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), 0xffffffff) : 0;

// Inspect link for an UNSAVED craft — the state sitting in the editor right
// now. Without this, "Inspect in game" could only ever show the last saved
// version, so moving a sticker or charm and inspecting showed the old
// placement until you saved and reopened.
app.post<{ Body: Partial<ItemRow> }>("/api/inspect/preview", async (request, reply) => {
  if (!(await getIdentity(request))) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const b = request.body ?? ({} as Partial<ItemRow>);
  if (typeof b.item_id !== "number") {
    return reply.status(400).send({ error: "Nothing to inspect yet." });
  }
  const attachErr = checkAttachments(b.item_id, b.stickers, b.charm_id, b.patches);
  if (attachErr) {
    return reply.status(400).send({ error: attachErr });
  }
  const link = inspectLinkFor(b.item_id, {
    wear: b.wear,
    seed: b.seed,
    stattrak: b.stattrak,
    // The count comes from the client here because a draft has no row to read
    // it off — clamped to what the protobuf field can hold, since it goes out
    // as a uint32 varint and a negative or fractional one writes garbage.
    stattrak_count: clampCount(b.stattrak_count),
    nametag: b.nametag,
    stickers: b.stickers,
    patches: b.patches,
    charm_id: b.charm_id,
    charm_offset: b.charm_offset,
  });
  if (!link) {
    return reply.status(400).send({ error: "That item can't be expressed as an inspect link." });
  }
  return { inspect: link };
});

// steam:// inspect link for a crafted item — opens the craft, stickers and all,
// in CS2's inspect view without the item existing on Steam's backend.
app.get<{ Params: { id: string } }>("/api/inventory/:id/inspect", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { rows } = await pool.query<ItemRow & { stattrak_count: number | null }>(
    `SELECT id, item_id, wear, seed, stattrak, stattrak_count, nametag, stickers,
            charm_id, charm_offset, patches
     FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
    [Number(request.params.id), identity.steamId],
  );
  if (!rows.length) {
    return reply.status(404).send({ error: "That item isn't in your inventory." });
  }
  // Through the link first: an inspect link carries each sticker's scratch, and
  // for a linked attachment that number lives on the sticker's own row.
  const row = (await withAttachments(identity.steamId, rows))[0];
  const link = inspectLinkFor(row.item_id, row);
  if (!link) {
    return reply.status(400).send({ error: "That item can't be expressed as an inspect link." });
  }
  return { inspect: link, stattrak: row.stattrak };
});

// Where this gun has actually been: the ledger behind the StatTrak counter.
//
app.delete<{ Params: { id: string } }>("/api/inventory/:id", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const id = Number(request.params.id);
  // Scrapping an attachment takes it OFF whatever is wearing it first. The row
  // is about to stop existing, and a spec still naming it would leave a weapon
  // pointing at nothing: the sticker would keep rendering (the inline `w`
  // fallback catches it) but nothing could ever edit or remove it again.
  // Scoped to the owner, so this can only ever touch the caller's own weapons.
  await detachElsewhere(identity.steamId, [id], null, []);
  await pool.query(`DELETE FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`, [
    id,
    identity.steamId,
  ]);
  return { ok: true };
});

/**
 * The wishlist: catalog items the caller wants but does not own.
 *
 * Enriched through getItem on the way out for the same reason the inventory is —
 * the client should not need a second lookup to draw a tile. An id cs2-lib has
 * retired resolves to null and is dropped rather than rendering a blank card.
 */
app.get("/api/wishlist", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { rows } = await pool.query<{ item_id: number; created_at: string }>(
    `SELECT item_id, created_at FROM inventory.wishlist WHERE steam_id = $1
      ORDER BY created_at DESC, item_id`,
    [identity.steamId],
  );
  return rows
    .map((r) => ({ item_id: r.item_id, created_at: r.created_at, item: getItem(r.item_id) }))
    .filter((r) => r.item != null);
});

/**
 * Add or remove one catalog item.
 *
 * `isOwnable` is the gate, not `getItem` — a wishlist of things that can never
 * enter an inventory (a case, a key, a tool) is a list of rows nothing will ever
 * clear. Same predicate the Steam import uses, so the two agree on what "an item
 * you could have" means.
 */
app.post<{ Body: { item_id?: number; want?: boolean } }>(
  "/api/wishlist",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const itemId = Number(request.body?.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0 || !isOwnable(itemId)) {
      return reply.status(400).send({ error: "That item can't be wishlisted." });
    }
    if (request.body?.want === false) {
      await pool.query(`DELETE FROM inventory.wishlist WHERE steam_id = $1 AND item_id = $2`, [
        identity.steamId,
        itemId,
      ]);
      return { want: false };
    }
    // ON CONFLICT DO NOTHING, so starring twice is not an error and does not
    // move the created_at that orders the list.
    await pool.query(
      `INSERT INTO inventory.wishlist (steam_id, item_id) VALUES ($1, $2)
       ON CONFLICT (steam_id, item_id) DO NOTHING`,
      [identity.steamId, itemId],
    );
    return { want: true };
  },
);

// ---- Loadout (per-user; slots reference owned instances) ----

app.get("/api/loadout", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { rows } = await pool.query<{
    team: string;
    slot: string;
    item_instance_id: number | null;
    skinned: boolean;
    item_id: number | null;
    wear: number | null;
    seed: number | null;
    stattrak: boolean;
    stattrak_count: number;
    nametag: string | null;
  }>(
    `SELECT l.team, l.slot, l.item_instance_id,
       (l.item_instance_id IS NOT NULL) AS skinned,
       COALESCE(i.item_id, l.item_id)   AS item_id,
       COALESCE(i.wear, l.wear)         AS wear,
       COALESCE(i.seed, l.seed)         AS seed,
       COALESCE(i.stattrak, l.stattrak) AS stattrak,
       -- Only owned instances carry a count; loadout defaults have no such
       -- column, so an unskinned StatTrak default reads 0.
       COALESCE(i.stattrak_count, 0)    AS stattrak_count,
       COALESCE(i.nametag, l.nametag)   AS nametag
     FROM inventory.loadout l
     LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
     WHERE l.steam_id = $1`,
    [identity.steamId],
  );
  // Prices ride on /api/inventory/prices, not here — same reasoning as the
  // inventory: the loadout is the screen, money is an overlay on it.
  return rows
    .filter((row) => row.item_id != null)
    .map((row) => ({ ...row, item: getItem(row.item_id as number) }));
});

// ---- CS2-style positional slots (v2) ----
// sp = starting pistol, p1-p4 = other pistols, m1-m5 = mid-tier (SMGs +
// shotguns + LMGs), r1-r5 = rifles (incl. snipers), plus knife/gloves/agent.
// KEEP IN STEP WITH the slot whitelist in schema.sql — that DELETE runs on every
// boot, so a slot this accepts and that list omits is wiped on the next restart.
// Over there it is one `legal_slot` CTE cleaning BOTH slot-bearing tables
// (inventory.loadout and the presets' parked rows), so adding a slot here is
// still exactly one list to edit there.
const SLOT_RE = /^(sp|p[1-4]|m[1-5]|r[1-5]|knife|gloves|agent|zeus|c4|musickit|graffiti|collectible)$/;
const START_PISTOLS = new Set(["glock", "usp_silencer", "hkp2000"]);
function slotCategories(slot: string): string[] | null {
  if (slot === "sp" || /^p[1-4]$/.test(slot)) {
    return ["secondary"];
  }
  if (/^m[1-5]$/.test(slot)) {
    return ["smg", "heavy"];
  }
  if (/^r[1-5]$/.test(slot)) {
    return ["rifle"];
  }
  return null;
}

// One equip request, validated but not yet written: what the client asked to
// put where. Shared by single equips and the two halves of a swap.
type EquipSpec = { slot: string; item_instance_id?: number | string; item_id?: number };
type ResolvedEquip =
  | { error: string }
  | { error?: undefined; slot: string; instanceId: number | string | null; resolvedItemId: number };

// Validates ownership, slot fit, team, and no duplicate weapon in the loadout.
// `ignoreSlots`: slots whose CURRENT occupants are excluded from the duplicate
// check — a swap rewrites both of its slots in one transaction, so what sits
// in them right now is about to move, not collide.
async function resolveEquip(
  steamId: string,
  team: string,
  spec: EquipSpec,
  ignoreSlots: string[] = [],
): Promise<ResolvedEquip> {
  const { slot, item_instance_id, item_id } = spec;

  // Resolve the item being equipped. Bigint ids arrive as strings from
  // Postgres, so item_instance_id may be a numeric string.
  let resolvedItemId: number;
  let instanceId: number | string | null = null;
  if (item_instance_id != null && item_instance_id !== "") {
    const { rows } = await pool.query<{ item_id: number }>(
      `SELECT item_id FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
      [item_instance_id, steamId],
    );
    if (!rows.length) {
      return { error: "That item isn't in your inventory — craft it first." };
    }
    resolvedItemId = rows[0].item_id;
    instanceId = item_instance_id;
  } else if (typeof item_id === "number") {
    if (!isBaseWeapon(item_id)) {
      return { error: "Only default (vanilla) weapons can be equipped without crafting." };
    }
    resolvedItemId = item_id;
  } else {
    return { error: "Nothing to equip — pick a skin or a default weapon." };
  }

  const item = getItem(resolvedItemId);
  if (!item) {
    return { error: "Unknown item." };
  }

  // Slot-fit validation.
  if (slot === "knife") {
    if (item.type !== "melee") {
      return { error: `${item.name} isn't a knife.` };
    }
  } else if (slot === "gloves") {
    if (item.type !== "glove") {
      return { error: `${item.name} aren't gloves.` };
    }
  } else if (slot === "zeus") {
    if (item.type !== "weapon" || item.model !== "taser") {
      return { error: `${item.name} isn't a Zeus x27.` };
    }
  } else if (slot === "c4") {
    if (item.type !== "weapon" || item.category !== "c4") {
      return { error: `${item.name} isn't a C4.` };
    }
  } else if (slot === "musickit") {
    if (item.type !== "musickit") {
      return { error: `${item.name} isn't a music kit.` };
    }
  } else if (slot === "graffiti") {
    if (item.type !== "graffiti") {
      return { error: `${item.name} isn't graffiti.` };
    }
  } else if (slot === "collectible") {
    if (item.type !== "collectible") {
      return { error: `${item.name} isn't a pin or a medal.` };
    }
  } else if (slot === "agent") {
    if (item.type !== "agent") {
      return { error: `${item.name} isn't an agent.` };
    }
    if (item.teams.length && !item.teams.includes(team as "CT" | "T")) {
      return { error: `${item.name} can't play on the ${team} side.` };
    }
  } else {
    if (item.type !== "weapon" || !item.model) {
      return { error: `${item.name} isn't a weapon.` };
    }
    const cats = slotCategories(slot)!;
    if (!cats.includes(item.category as string)) {
      return { error: `${item.name} doesn't fit that slot.` };
    }
    if (slot === "sp" && !START_PISTOLS.has(item.model as string)) {
      return { error: "Only a starting pistol (Glock-18, USP-S, P2000) fits that slot." };
    }
    if (slot !== "sp" && START_PISTOLS.has(item.model as string)) {
      return { error: "Starting pistols go in the starting-pistol slot." };
    }
    if (item.teams.length && !item.teams.includes(team as "CT" | "T")) {
      return { error: `${item.name} can't be used by the ${team} side.` };
    }
    // No duplicate weapon across the rest of this team's loadout.
    const skip = [slot, ...ignoreSlots];
    const { rows: others } = await pool.query<{ slot: string; item_id: number | null }>(
      `SELECT l.slot, COALESCE(i.item_id, l.item_id) AS item_id
       FROM inventory.loadout l
       LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
       WHERE l.steam_id = $1 AND l.team = $2 AND l.slot <> ALL($3::text[])`,
      [steamId, team, skip],
    );
    for (const row of others) {
      const model = row.item_id != null ? getItem(row.item_id)?.model : null;
      if (model && model === item.model) {
        return { error: "That weapon is already in another slot of this loadout." };
      }
    }
  }

  return { slot, instanceId, resolvedItemId };
}

const UPSERT_LOADOUT = `INSERT INTO inventory.loadout (steam_id, team, slot, item_instance_id, item_id, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (steam_id, team, slot) DO UPDATE SET
       item_instance_id = EXCLUDED.item_instance_id, item_id = EXCLUDED.item_id, updated_at = now()`;
const upsertParams = (steamId: string, team: string, r: Exclude<ResolvedEquip, { error: string }>) => [
  steamId,
  team,
  r.slot,
  r.instanceId,
  r.instanceId != null ? null : r.resolvedItemId,
];

// Equip into a positional slot: either an owned crafted instance
// (item_instance_id) or a free default weapon (item_id of a vanilla base item).
app.post<{
  Body: { team?: string; slot?: string; item_instance_id?: number | string; item_id?: number };
}>("/api/loadout", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { team, slot, item_instance_id, item_id } = request.body;
  if (!team || !TEAMS.has(team) || !slot || !SLOT_RE.test(slot)) {
    return reply.status(400).send({ error: "A team and a valid loadout slot are required." });
  }
  const r = await resolveEquip(identity.steamId, team, { slot, item_instance_id, item_id });
  if (r.error != null) {
    return reply.status(400).send({ error: r.error });
  }
  await pool.query(UPSERT_LOADOUT, upsertParams(identity.steamId, team, r));
  return { ok: true };
});

// Swap two positional slots in one transaction. A pair of plain equips can't
// express this: the duplicate-weapon check would see the first write as a
// collision with the not-yet-moved second slot ("already in another slot").
// Here both writes are validated with each other's slots exempted, then land
// atomically.
app.post<{
  Body: { team?: string; a?: EquipSpec; b?: EquipSpec };
}>("/api/loadout/swap", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { team, a, b } = request.body;
  if (
    !team || !TEAMS.has(team) ||
    !a?.slot || !SLOT_RE.test(a.slot) ||
    !b?.slot || !SLOT_RE.test(b.slot) ||
    a.slot === b.slot
  ) {
    return reply.status(400).send({ error: "A team and two distinct loadout slots are required." });
  }
  const ignore = [a.slot, b.slot];
  const ra = await resolveEquip(identity.steamId, team, a, ignore);
  if (ra.error != null) {
    return reply.status(400).send({ error: ra.error });
  }
  const rb = await resolveEquip(identity.steamId, team, b, ignore);
  if (rb.error != null) {
    return reply.status(400).send({ error: rb.error });
  }
  // The exemption above covers what's in the slots NOW — still reject a swap
  // whose two incoming halves are the same weapon model.
  const ma = getItem(ra.resolvedItemId)?.model;
  if (ma && ma === getItem(rb.resolvedItemId)?.model) {
    return reply.status(400).send({ error: "Both sides of that swap are the same weapon." });
  }
  await inTransaction(async (client) => {
    await client.query(UPSERT_LOADOUT, upsertParams(identity.steamId, team, ra));
    await client.query(UPSERT_LOADOUT, upsertParams(identity.steamId, team, rb));
  });
  return { ok: true };
});

app.delete<{ Querystring: { team?: string; slot?: string } }>(
  "/api/loadout",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const { team, slot } = request.query;
    if (!team || !slot) {
      return reply.status(400).send({ error: "team, slot required" });
    }
    await pool.query(
      `DELETE FROM inventory.loadout WHERE steam_id = $1 AND team = $2 AND slot = $3`,
      [identity.steamId, team, slot],
    );
    return { ok: true };
  },
);

// ---- Loadout presets (named builds you switch between) ----------------------
//
// The preset you are wearing has no rows of its own: its slots ARE
// inventory.loadout, which is why nothing above this comment had to change to
// support presets. Every other preset parks its slots in
// inventory.loadout_preset_slots, and activate swaps the two sets over inside a
// transaction. See the long note in schema.sql for why the alternative — a
// preset_id folded into inventory.loadout's key — was not taken: it would have
// put a "which preset is active" lookup into /api/equipped/v5, the one read
// every game server makes for every player on every connect.
//
// These routes live under /api/loadout/… alongside `/api/loadout/:steamId`.
// find-my-way matches a static segment before a parametric one, so "presets"
// never reaches the steam-id route — the same arrangement /api/inventory/:id
// already has with /api/inventory/import-steam.

// CS2 itself ships five loadout slots. Matching it is not deference: the
// switcher is a pill strip in a header that already scrolls sideways on a
// phone, and an unbounded list of them is a strip you cannot read.
const PRESET_LIMIT = 5;
const PRESET_NAME_MAX = 24;

/**
 * Anything that can run a query — the pool itself, or one pooled client inside
 * a transaction. The helpers below take it so the same code can mint a preset
 * standalone or as part of a caller's transaction, where a write that escaped
 * to the pool would be a row that survives the rollback.
 */
type Queryable = typeof pool | PoolClient;

/** Collapse whitespace, cap the length, fall back when nothing is left. */
function cleanPresetName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return name ? name.slice(0, PRESET_NAME_MAX) : fallback;
}

/**
 * The id of the preset whose slots are currently in inventory.loadout, minting
 * it if this player has never had one.
 *
 * Every player needs exactly one from the moment they equip anything, and the
 * boot-time backfill in schema.sql can only cover the players who had a loadout
 * when it ran. This is the other half: a player who signs in for the first time
 * after that gets theirs here, on whichever preset route they touch first.
 *
 * `q` takes a pooled client so the mint can join a caller's transaction — an
 * activate that mints the source preset outside its own transaction would be a
 * row that survives a rollback.
 */
async function ensureActivePreset(
  steamId: string,
  q: Queryable = pool,
): Promise<string> {
  const read = async () => {
    const { rows } = await q.query<{ id: string }>(
      `SELECT id FROM inventory.loadout_presets WHERE steam_id = $1 AND active`,
      [steamId],
    );
    return rows.length ? String(rows[0].id) : null;
  };
  const existing = await read();
  if (existing) return existing;
  // The conflict target names the partial index's predicate, so this is the
  // unique "one active per player" index and not a full-table one. DO NOTHING
  // rather than an error because two first-ever page loads in two tabs is a
  // real race, and losing it is not a failure — it means somebody else already
  // made the row we were about to.
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO inventory.loadout_presets (steam_id, name, active)
     VALUES ($1, 'Loadout 1', true)
     ON CONFLICT (steam_id) WHERE active DO NOTHING
     RETURNING id`,
    [steamId],
  );
  if (rows.length) return String(rows[0].id);
  return (await read()) as string;
}

/** A preset row the caller owns, or null. Every write route starts here. */
async function ownedPreset(
  steamId: string,
  id: string,
  q: Queryable = pool,
): Promise<{ id: string; name: string; active: boolean } | null> {
  if (!/^\d+$/.test(id)) return null;
  const { rows } = await q.query<{ id: string; name: string; active: boolean }>(
    `SELECT id, name, active FROM inventory.loadout_presets WHERE id = $1 AND steam_id = $2`,
    [id, steamId],
  );
  return rows.length ? { ...rows[0], id: String(rows[0].id) } : null;
}

/**
 * Make `presetId` the live one. MUST be called inside a transaction.
 *
 * Between parking the current rows and loading the new ones the player has NO
 * loadout at all, and a game server polling /api/equipped/v5 in that window
 * would build them a vanilla rack and never re-evaluate it (the plugin skins
 * weapons in a GiveNamedItem detour at creation — nothing revisits a weapon that
 * already exists). Inside a transaction that window is invisible to every other
 * reader; outside one it is a real, if narrow, way to spawn someone skinless.
 *
 * Returns false when the preset was already active, so callers can skip the
 * "switched" notification without a second query.
 */
async function activatePreset(
  client: PoolClient,
  steamId: string,
  presetId: string,
): Promise<boolean> {
  const fromId = await ensureActivePreset(steamId, client);
  // Serialises two activations for the same player. Without it both could read
  // the same "current" preset and both park the live rows under it — the second
  // parking whatever the first had already swapped in, so one build ends up
  // stored under two names and the other is gone.
  await client.query(`SELECT 1 FROM inventory.loadout_presets WHERE id = $1 FOR UPDATE`, [fromId]);
  if (fromId === presetId) return false;

  // Park what is live now under the preset that owns it. The DELETE first
  // because a preset that was active carries no parked rows, but one that was
  // half-parked by an interrupted earlier attempt might.
  await client.query(`DELETE FROM inventory.loadout_preset_slots WHERE preset_id = $1`, [fromId]);
  await client.query(
    `INSERT INTO inventory.loadout_preset_slots
       (preset_id, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, updated_at)
     SELECT $1, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, updated_at
       FROM inventory.loadout WHERE steam_id = $2`,
    [fromId, steamId],
  );
  // Clear the old flag BEFORE setting the new one: loadout_presets_active_idx
  // is a unique partial index, and the other order trips it every single time.
  await client.query(
    `UPDATE inventory.loadout_presets SET active = false, updated_at = now() WHERE id = $1`,
    [fromId],
  );

  await client.query(`DELETE FROM inventory.loadout WHERE steam_id = $1`, [steamId]);
  await client.query(
    `INSERT INTO inventory.loadout
       (steam_id, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, updated_at)
     SELECT $1, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, updated_at
       FROM inventory.loadout_preset_slots WHERE preset_id = $2`,
    [steamId, presetId],
  );
  // The rows live in exactly ONE of the two tables, never both. A copy left
  // behind here would be a second source of truth that every subsequent equip
  // silently diverges from, and switching away and back would hand the player
  // their loadout as it was at this moment instead of as they left it.
  await client.query(`DELETE FROM inventory.loadout_preset_slots WHERE preset_id = $1`, [presetId]);
  await client.query(
    `UPDATE inventory.loadout_presets SET active = true, updated_at = now() WHERE id = $1`,
    [presetId],
  );
  return true;
}

/** Run `fn` in a transaction. */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// The filled-slot count is per preset and comes from two different places for
// the same reason the whole feature does: the active one's slots are the live
// loadout, everyone else's are parked.
const PRESET_LIST_SQL = `
  SELECT p.id, p.name, p.active,
         (CASE WHEN p.active
               THEN (SELECT count(*) FROM inventory.loadout l WHERE l.steam_id = p.steam_id)
               ELSE (SELECT count(*) FROM inventory.loadout_preset_slots s WHERE s.preset_id = p.id)
          END)::int AS slots
    FROM inventory.loadout_presets p
   WHERE p.steam_id = $1
   ORDER BY p.created_at, p.id`;

type PresetRow = { id: string; name: string; active: boolean; slots: number };
const listPresets = async (steamId: string, q: Queryable = pool) =>
  (await q.query<PresetRow>(PRESET_LIST_SQL, [steamId])).rows.map((r) => ({
    ...r,
    id: String(r.id),
  }));

app.get("/api/loadout/presets", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  // A read that writes, deliberately: this is where a player who has never
  // equipped anything gets their first preset, so the switcher has something to
  // show and "duplicate this one" has a source. It is idempotent and costs one
  // indexed lookup on the path that already hit it.
  await ensureActivePreset(identity.steamId);
  return listPresets(identity.steamId);
});

// Create a preset. `copy` seeds it from the loadout you are wearing right now —
// that is the "duplicate" action; without it the preset starts empty.
//
// NOT modelled on /api/loadout/copy-from, which mints a fresh owned_items row
// per slot. That is right for cloning a STRANGER's loadout (their instances are
// not yours to point at) and wrong here: crafting is the gate, presets are only
// arrangements of what you already own. Minting would double your inventory
// every time you duplicated a build, and each copy would then wear its own
// stickers and its own StatTrak count.
app.post<{ Body: { name?: string; copy?: boolean } }>(
  "/api/loadout/presets",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const copy = request.body?.copy === true;
    const created = await inTransaction(async (client) => {
      await ensureActivePreset(identity.steamId, client);
      const { rows: count } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM inventory.loadout_presets WHERE steam_id = $1`,
        [identity.steamId],
      );
      if (Number(count[0].n) >= PRESET_LIMIT) {
        return null;
      }
      const name = cleanPresetName(request.body?.name, `Loadout ${Number(count[0].n) + 1}`);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO inventory.loadout_presets (steam_id, name, active)
         VALUES ($1, $2, false) RETURNING id`,
        [identity.steamId, name],
      );
      const id = String(rows[0].id);
      if (copy) {
        await client.query(
          `INSERT INTO inventory.loadout_preset_slots
             (preset_id, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, updated_at)
           SELECT $1, team, slot, item_id, item_instance_id, wear, seed, stattrak, nametag, now()
             FROM inventory.loadout WHERE steam_id = $2`,
          [id, identity.steamId],
        );
      }
      return id;
    });
    if (created == null) {
      return reply
        .status(400)
        .send({ error: `You can keep ${PRESET_LIMIT} loadouts — delete one to make room.` });
    }
    const presets = await listPresets(identity.steamId);
    return presets.find((p) => p.id === created) ?? presets[presets.length - 1];
  },
);

app.patch<{ Params: { id: string }; Body: { name?: string } }>(
  "/api/loadout/presets/:id",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const preset = await ownedPreset(identity.steamId, request.params.id);
    if (!preset) {
      return reply.status(404).send({ error: "No such loadout." });
    }
    const name = cleanPresetName(request.body?.name, preset.name);
    await pool.query(
      `UPDATE inventory.loadout_presets SET name = $1, updated_at = now() WHERE id = $2`,
      [name, preset.id],
    );
    return { id: preset.id, name, active: preset.active };
  },
);

// Wear a different build. One transaction, because the swap is a window in
// which the player has no loadout — see activatePreset.
app.post<{ Params: { id: string } }>(
  "/api/loadout/presets/:id/activate",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const preset = await ownedPreset(identity.steamId, request.params.id);
    if (!preset) {
      return reply.status(404).send({ error: "No such loadout." });
    }
    await inTransaction((client) => activatePreset(client, identity.steamId, preset.id));
    return { ok: true, active: preset.id };
  },
);

// Delete a preset. Deleting the one you are WEARING is allowed and moves you to
// the oldest of the rest — the buttons in the header act on the preset on
// screen, and refusing the only one you can see is a worse rule to explain than
// "you always end up wearing something". The last preset is not deletable for
// that same reason: there would be nothing left to move to, and inventory.
// loadout would have no name.
app.delete<{ Params: { id: string } }>(
  "/api/loadout/presets/:id",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const preset = await ownedPreset(identity.steamId, request.params.id);
    if (!preset) {
      return reply.status(404).send({ error: "No such loadout." });
    }
    const outcome = await inTransaction(async (client) => {
      const { rows: rest } = await client.query<{ id: string }>(
        `SELECT id FROM inventory.loadout_presets
          WHERE steam_id = $1 AND id <> $2 ORDER BY created_at, id`,
        [identity.steamId, preset.id],
      );
      if (!rest.length) {
        return null;
      }
      let active = preset.active ? String(rest[0].id) : await ensureActivePreset(identity.steamId, client);
      if (preset.active) {
        // Reuses the ordinary switch rather than a bespoke "delete and adopt"
        // path. It parks the doomed preset's live rows on its way out, which
        // the DELETE below then cascades away — a wasted write, and worth it
        // for there being exactly one piece of code that moves the live rows.
        await activatePreset(client, identity.steamId, active);
      }
      // Cascades its parked slots. Scoped to the owner as well as the id so a
      // guessed id can never reach somebody else's build.
      await client.query(`DELETE FROM inventory.loadout_presets WHERE id = $1 AND steam_id = $2`, [
        preset.id,
        identity.steamId,
      ]);
      return active;
    });
    if (outcome == null) {
      return reply.status(400).send({ error: "That's your only loadout — rename it instead." });
    }
    return { ok: true, active: outcome };
  },
);

// ---- Public loadout view + copy (player profiles / sharing) -----------------

/**
 * Take the owner's row handle off one enriched attachment.
 *
 * Same reasoning as the null instance id below, one level deeper: `inst` names a
 * row in the OWNER's inventory, and the only thing anyone does with one is act
 * on it. Nothing a viewer renders needs it — the placement, the scratch wear and
 * the charm's pattern are all inline by the time enrichAttachments is done — so
 * it goes out null rather than being a handle a stranger holds. Missing this is
 * the quiet way a "read-only" endpoint stops being read-only.
 */
function withoutInstanceHandle<T extends { inst?: string | null } | null>(a: T): T {
  return a ? { ...a, inst: null } : a;
}

// Read-only view of any player's loadout (enriched like /api/inventory, but
// without inventory instance ids). Unauthenticated on purpose: an equipped
// loadout is already public — /api/equipped/v5 hands the same items to any game
// server that asks, with no credential — and this is the shareable, human-facing
// form of it. What is NOT public is anything a player merely owns; see the
// README for why an owned-item list needs a decision before it gets a route.
// Every preset a player has, for a VISITOR. Same rows and same shape the owner
// sees — id, name, active, filled-slot count — because none of that is private:
// a preset is an arrangement of items, and this endpoint has always disclosed
// the active one anyway.
//
// It deliberately does NOT call ensureActivePreset the way the owner's list
// does. That is a read that writes, and a stranger opening a profile must not
// mint rows in someone else's account. A player who has never equipped anything
// simply lists empty.
app.get<{ Params: { steamId: string } }>("/api/loadout/:steamId/presets", async (request, reply) => {
  const steamId = request.params.steamId;
  if (!/^\d{17}$/.test(steamId)) {
    return reply.status(400).send({ error: "invalid steam id" });
  }
  return listPresets(steamId);
});

app.get<{ Params: { steamId: string }; Querystring: { preset?: string } }>(
  "/api/loadout/:steamId",
  async (request, reply) => {
  const steamId = request.params.steamId;
  if (!/^\d{17}$/.test(steamId)) {
    return reply.status(400).send({ error: "invalid steam id" });
  }

  // Which build to read. Absent — and for the ACTIVE preset — that is the live
  // loadout; a parked preset is its own table. The two carry identical columns
  // (loadout_preset_slots is inventory.loadout minus steam_id), which is what
  // lets one SELECT serve both by swapping the FROM rather than duplicating it.
  //
  // Ownership is checked, never assumed: `preset` is a bare id from the caller,
  // so without this a visitor could walk ids and read builds out of accounts
  // they never asked about. A preset that is not this player's 404s rather than
  // falling back to the live loadout — quietly answering with a different build
  // than the one requested is how someone ends up certain they are looking at
  // something they are not.
  let parkedId: string | null = null;
  if (request.query.preset) {
    if (!/^\d+$/.test(request.query.preset)) {
      return reply.status(400).send({ error: "invalid preset" });
    }
    const { rows: owned } = await pool.query<{ id: string; active: boolean }>(
      `SELECT id, active FROM inventory.loadout_presets WHERE id = $1 AND steam_id = $2`,
      [request.query.preset, steamId],
    );
    if (!owned.length) {
      return reply.status(404).send({ error: "no such preset" });
    }
    if (!owned[0].active) parkedId = String(owned[0].id);
  }
  const { rows } = await pool.query<{
    team: string; slot: string; item_id: number | null; skinned: boolean;
    wear: number | null; seed: number | null; stattrak: boolean; stattrak_count: number;
    nametag: string | null; stickers: unknown[] | null; patches: unknown[] | null;
    charm_id: number | null; charm_offset: ItemRow["charm_offset"];
  }>(
    `SELECT l.team, l.slot,
       COALESCE(i.item_id, l.item_id) AS item_id,
       (l.item_instance_id IS NOT NULL) AS skinned,
       COALESCE(i.wear, l.wear) AS wear, COALESCE(i.seed, l.seed) AS seed,
       COALESCE(i.stattrak, l.stattrak) AS stattrak,
       -- Same as /api/loadout: only owned instances carry a count.
       COALESCE(i.stattrak_count, 0) AS stattrak_count,
       COALESCE(i.nametag, l.nametag) AS nametag,
       -- Attachments are i.* with no COALESCE: inventory.loadout has no columns
       -- for them, so a free default weapon simply has none. Selecting these at
       -- all is the fix for a viewer seeing a bare gun where the owner had five
       -- stickers and a charm — the part of a loadout people actually spend
       -- their time on, and the part this endpoint used to drop on the floor
       -- while copy-from happily cloned it.
       i.stickers, i.patches, i.charm_id, i.charm_offset
     FROM ${parkedId ? "inventory.loadout_preset_slots" : "inventory.loadout"} l
     LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
     WHERE ${parkedId ? "l.preset_id" : "l.steam_id"} = $1`,
    [parkedId ?? steamId],
  );
  // Dereference the attachment links against the OWNER's rows — this is their
  // loadout, so their instances are the ones a linked spec points at. Same read
  // at the same place as every other consumer; see resolveAttachments for why
  // that lives at read time rather than in each caller.
  const resolved = await withAttachments(steamId, rows.filter((row) => row.item_id != null));
  // The instance id stays null — it is someone else's row handle and a viewer
  // has no business acting on it. `skinned` carries the one bit the client
  // actually needed from it: crafted skin vs. free default weapon. Without it a
  // viewer saw every cell as unskinned, so names read "Default" and the focus
  // view fell back to the base model even though the art was right.
  return resolved.map((row) => {
    // charm_offset is dropped rather than sanitised: enrichAttachments has
    // already folded its x/y/z/seed into `charm`, so all that would survive the
    // trip is the `inst` we are deliberately withholding.
    const { charm_offset, ...enriched } = enrichAttachments(row);
    return {
      ...enriched,
      item_instance_id: null,
      stickers: enriched.stickers.map(withoutInstanceHandle),
      patches: enriched.patches.map(withoutInstanceHandle),
      charm: withoutInstanceHandle(enriched.charm),
      item: getItem(row.item_id as number),
    };
  });
  },
);

// Clone another player's loadout: copies each equipped skin into the caller's
// inventory (origin 'copied') and equips it in the same slot.
app.post<{ Params: { steamId: string } }>(
  "/api/loadout/copy-from/:steamId",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const source = request.params.steamId;
    if (!/^\d{17}$/.test(source)) {
      return reply.status(400).send({ error: "invalid steam id" });
    }
    if (source === identity.steamId) {
      return reply.status(400).send({ error: "That's already your loadout." });
    }
    const { rows } = await pool.query<{
      team: string; slot: string; base_item_id: number | null; item_id: number | null;
      wear: number | null; seed: number | null; stattrak: boolean; nametag: string | null;
      stickers: unknown[] | null; patches: unknown[] | null; charm_id: number | null;
      charm_offset: AttachBody["charm_offset"];
    }>(
      `SELECT l.team, l.slot, l.item_id AS base_item_id, i.item_id, i.wear, i.seed,
              i.stattrak, i.nametag, i.stickers, i.patches, i.charm_id, i.charm_offset
       FROM inventory.loadout l
       LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
       WHERE l.steam_id = $1`,
      [source],
    );
    // Resolve the source's attachment links BEFORE copying anything.
    //
    // The specs in a weapon's jsonb are a CACHE of each attachment's wear/seed,
    // and the authoritative copy lives on the attachment's own owned_items row —
    // which is why resolveAttachments exists and why its doc calls itself "one
    // resolve at read time instead of four consumers each remembering to check".
    // Editing an applied charm's pattern writes the new seed to that row and
    // deliberately does NOT rewrite every weapon referencing it, so the blob can
    // be arbitrarily out of date.
    //
    // Copying read the blob. linkAttachments then minted the new owner's charm
    // with `charmOffset.seed` and their stickers with `s.w` — the stale values —
    // so a copied loadout could come out a different COLOUR from the one on
    // screen, and copied stickers could carry the wrong scratch. This route was
    // the fifth consumer, and the one that didn't check.
    //
    // Scoped to `source`, not the caller: the instances belong to them, and
    // instFactsFor is steam_id-scoped precisely so a spec can't name a stranger's
    // row. Nothing new is exposed — the public loadout endpoint already shows
    // these items' wear and seed, and the copy clones them regardless.
    const resolved = await withAttachments(source, rows);
    let copied = 0;
    for (const row of resolved) {
      if (row.item_id != null) {
        // Through linkAttachments, exactly like a craft — NOT straight into the
        // column. The specs being copied carry the SOURCE user's `inst` ids, and
        // an inst only means anything to its owner (instFactsFor is scoped by
        // steam_id). Written verbatim they resolved to nothing here, so every
        // copied sticker quietly fell back to its inline `w` and was not a thing
        // the new owner actually owned. linkAttachments already refuses an inst
        // that is not the caller's and mints a fresh one instead, which is
        // exactly what a copy wants.
        //
        // charm_offset rides along for the first time here too — it was never
        // selected, so a copied loadout silently lost its charm PLACEMENT.
        const linked = await linkAttachments(
          identity.steamId,
          {
            stickers: row.stickers,
            patches: row.patches,
            charm_id: row.charm_id,
            charm_offset: row.charm_offset,
          },
          null,
        );
        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO inventory.owned_items
             (steam_id, item_id, wear, seed, stattrak, nametag, stickers, patches, charm_id, charm_offset, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,'copied') RETURNING id`,
          [
            identity.steamId, row.item_id, row.wear, row.seed, row.stattrak, row.nametag,
            normSpecs(linked.stickers).some(Boolean) ? JSON.stringify(normSpecs(linked.stickers)) : null,
            normSpecs(linked.patches).some(Boolean) ? JSON.stringify(normSpecs(linked.patches)) : null,
            row.charm_id,
            linked.charm_offset ? JSON.stringify(linked.charm_offset) : null,
          ],
        );
        await pool.query(
          `INSERT INTO inventory.loadout (steam_id, team, slot, item_instance_id, item_id, updated_at)
           VALUES ($1,$2,$3,$4,NULL, now())
           ON CONFLICT (steam_id, team, slot) DO UPDATE SET
             item_instance_id = EXCLUDED.item_instance_id, item_id = NULL, updated_at = now()`,
          [identity.steamId, row.team, row.slot, inserted[0].id],
        );
        copied++;
      } else if (row.base_item_id != null) {
        await pool.query(
          `INSERT INTO inventory.loadout (steam_id, team, slot, item_instance_id, item_id, updated_at)
           VALUES ($1,$2,$3,NULL,$4, now())
           ON CONFLICT (steam_id, team, slot) DO UPDATE SET
             item_instance_id = NULL, item_id = EXCLUDED.item_id, updated_at = now()`,
          [identity.steamId, row.team, row.slot, row.base_item_id],
        );
        copied++;
      }
    }
    return { copied };
  },
);

// ---- Steam inventory import (read-only, PUBLIC data only) --------------------
// Deliberately scam-safe: no login, no API key, no trade access — we fetch the
// caller's own PUBLIC Steam inventory (they control visibility) and mirror the
// equippable items. Exact floats/seeds aren't public, so wear maps to the tier
// midpoint and the pattern is derived from the asset id.
const WEAR_MID: Record<string, number> = {
  "Factory New": 0.035, "Minimal Wear": 0.11, "Field-Tested": 0.265,
  "Well-Worn": 0.415, "Battle-Scarred": 0.725,
};

interface SteamAsset {
  classid: string;
  assetid: string;
}
interface SteamDescription {
  classid: string;
  market_hash_name?: string;
  descriptions?: { value?: string; name?: string }[];
  fraudwarnings?: string[];
}
interface SteamPage {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  more_items?: number;
  last_assetid?: string;
}

// Steam serves the inventory oldest-first in pages, so the newest items are on
// the LAST page — we have to walk them all or recent acquisitions never sync.
const STEAM_PAGE = 1000;
const STEAM_MAX_PAGES = 10;

// NB: plain field assignment, not a constructor parameter property — node's
// --experimental-strip-types only erases types, so it can't emit the implicit
// `this.status = status` a parameter property relies on.
class SteamFetchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchSteamInventory(steamId: string) {
  const assets: SteamAsset[] = [];
  const byClass = new Map<string, SteamDescription>();
  let start: string | undefined;
  let complete = false;
  for (let page = 0; page < STEAM_MAX_PAGES; page++) {
    const url =
      `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=${STEAM_PAGE}` +
      (start ? `&start_assetid=${start}` : "");
    let payload: SteamPage;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "5stack-inventory-plugin" },
      });
      if (res.status === 403 || res.status === 401) {
        throw new SteamFetchError(
          400,
          "Your Steam inventory is private. Set it to Public in Steam privacy settings and retry — we only ever read public data.",
        );
      }
      if (!res.ok) {
        throw new SteamFetchError(502, `Steam responded ${res.status} — try again in a minute.`);
      }
      payload = (await res.json()) as SteamPage;
    } catch (error) {
      if (error instanceof SteamFetchError) throw error;
      throw new SteamFetchError(502, "Couldn't reach Steam — try again in a minute.");
    }
    assets.push(...(payload.assets ?? []));
    for (const d of payload.descriptions ?? []) byClass.set(d.classid, d);
    if (!payload.more_items || !payload.last_assetid) {
      complete = true;
      break;
    }
    start = payload.last_assetid;
  }
  // `complete` gates the prune step — a truncated read must never be mistaken
  // for "the user no longer owns these".
  return { assets, byClass, complete };
}

// Applied stickers/charms/patches only exist in the description HTML blob, as
// market names minus their type prefix ("Sticker: byali | Krakow 2017"). Names
// containing a comma can't be split apart reliably and just fail to resolve.
// Steam can name an attachment more specifically than the catalog models it:
// the Austin 2025 charms arrive as "Austin 2025 Highlight | flameZ Double Dust
// II Kill" while cs2-lib only carries the generic "Charm | Austin 2025
// Highlight". Trim trailing " | " segments until something matches, so the
// charm resolves to its family instead of dropping to null.
function resolveAttachment(prefix: string, raw: string): number | null {
  const parts = raw.split(" | ");
  for (let end = parts.length; end > 0; end--) {
    const id = getItemIdByName(`${prefix} | ${parts.slice(0, end).join(" | ")}`);
    if (id != null) return id;
  }
  return null;
}

function attachmentIds(
  desc: SteamDescription | undefined,
  label: string,
  prefix: string,
  misses?: string[],
) {
  for (const d of desc?.descriptions ?? []) {
    const text = String(d.value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ");
    const line = text.match(new RegExp(`${label}:\\s*([^\\n]+)`))?.[1];
    if (!line) continue;
    return line
      .split(",")
      .map((n) => {
        const raw = n.trim();
        const id = resolveAttachment(prefix, raw);
        // A name Steam shows but the catalog can't resolve silently becomes an
        // empty slot — surface it rather than letting it vanish.
        if (id == null) misses?.push(`${prefix}: ${raw}`);
        return id;
      })
      .slice(0, 5);
  }
  return [];
}

function nametagOf(desc: SteamDescription | undefined): string | null {
  for (const w of desc?.fraudwarnings ?? []) {
    const m = String(w).match(/Name Tag:\s*''(.*)''\s*$/);
    if (m) return m[1] || null;
  }
  return null;
}

// When (if ever) this account last pulled its Steam inventory. The UI marks the
// sync button until this comes back non-null — a brand new account's inventory
// is empty and there is nothing on screen to suggest Steam is where it fills up
// from. Cheap enough to sit alongside the inventory load.
app.get("/api/inventory/steam-sync", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { rows } = await pool.query<{ synced_at: Date }>(
    `SELECT synced_at FROM inventory.steam_sync WHERE steam_id = $1`,
    [identity.steamId],
  );
  return { syncedAt: rows[0]?.synced_at?.toISOString() ?? null };
});

app.post("/api/inventory/import-steam", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  let inventory: Awaited<ReturnType<typeof fetchSteamInventory>>;
  try {
    inventory = await fetchSteamInventory(identity.steamId);
  } catch (error) {
    const e = error as SteamFetchError;
    // Explicit 4xx/5xx returns aren't errors as far as fastify is concerned, so
    // with request logging off a failed sync would otherwise produce NO output
    // at all — the one case where silence is most misleading.
    app.log.warn(`[steam-sync] ${identity.steamId}: FAILED (${e.status ?? 502}) — ${e.message}`);
    return reply.status(e.status ?? 502).send({ error: e.message });
  }
  const { assets, byClass, complete } = inventory;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let unknown = 0;
  const seen: string[] = [];
  const unresolved: string[] = [];
  const skippedNames: string[] = [];
  // What came in, by cs2-lib type. "412 added" cannot answer the question
  // anyone actually asks after a sync — did my stickers arrive, did my music
  // kits, did the medals — and a whole family failing to resolve looks exactly
  // like a whole family the player doesn't own. Counted per ASSET, so it says
  // what the account holds, not what changed this run.
  const owned = new Map<string, number>();
  const seedFrom = (assetid: string) => (Number(BigInt(assetid) % 999n) + 1);
  for (const asset of assets) {
    const desc = byClass.get(asset.classid);
    const marketName = desc?.market_hash_name ?? "";
    if (!marketName) continue;
    // ★ / StatTrak™ / Souvenir / the wear bracket all come off in there — see
    // parseSteamMarketName for what each decoration means and why only two of
    // them are kept.
    const { itemId, name, stattrak, wearTier } = parseSteamMarketName(marketName);
    // `isOwnable`, not `slotForItem`: the old gate was "can it go in a loadout
    // slot", which answers no for a loose sticker or charm — so a player with a
    // drawer full of Katowice Crowns imported none of them and the picker's
    // "stickers you own" was always empty. Cases, keys and tools still fall out
    // here, since they aren't things this app models; music kits, graffiti,
    // pins, medals and the Zeus all import, each through its loadout slot.
    // tools/steam-sync-coverage.ts proves that family by family.
    //
    // Each CS2 item is its own asset with its own assetid — they do NOT arrive
    // stacked with an `amount` — so owning fourteen Crowns imports as fourteen
    // rows through the same per-asset upsert and prune below, with no quantity
    // handling anywhere.
    if (itemId == null || !isOwnable(itemId)) {
      skipped++;
      // Resolved-but-unownable items (cases, keys) are expected and would
      // drown the log — only unresolved names are anomalies.
      if (itemId == null) {
        unknown++;
        if (skippedNames.length < 20) skippedNames.push(name);
      }
      continue;
    }
    seen.push(asset.assetid);
    const type = getItem(itemId)?.type ?? "unknown";
    owned.set(type, (owned.get(type) ?? 0) + 1);
    const stickers = attachmentIds(desc, "Sticker", "Sticker", unresolved);
    const patches = attachmentIds(desc, "Patch", "Patch", unresolved);
    const charmId = attachmentIds(desc, "Charm", "Charm", unresolved)[0] ?? null;
    // Re-sync mutable state (stickers scraped/added, charm swapped, item
    // renamed) onto the existing row: the id stays put, so anything equipped
    // in the loadout stays equipped. charm_offset is the user's own placement
    // and is deliberately left alone.
    //
    // Note `stickers = EXCLUDED.stickers` overwrites the column wholesale with
    // freshly scraped catalog ids, which would DROP any `inst` links it held.
    // Safe today because a Steam row can never acquire them — crafting always
    // writes an origin of 'crafted', and the update endpoint refuses imported
    // items outright — so there is nothing here to preserve. If either of those
    // ever changes, this line has to merge instead of replace, or every re-sync
    // will unlink a player's whole imported collection and mint it again.
    const { rows } = await pool.query<{ inserted: boolean }>(
      `INSERT INTO inventory.owned_items
         (steam_id, item_id, wear, seed, stattrak, origin, steam_asset_id,
          stickers, charm_id, patches, nametag)
       VALUES ($1,$2,$3,$4,$5,'steam',$6,$7,$8,$9,$10)
       ON CONFLICT (steam_id, steam_asset_id) WHERE steam_asset_id IS NOT NULL
       DO UPDATE SET
         item_id = EXCLUDED.item_id,
         wear = EXCLUDED.wear,
         seed = EXCLUDED.seed,
         stattrak = EXCLUDED.stattrak,
         stickers = EXCLUDED.stickers,
         charm_id = EXCLUDED.charm_id,
         patches = EXCLUDED.patches,
         nametag = EXCLUDED.nametag
       WHERE owned_items.item_id IS DISTINCT FROM EXCLUDED.item_id
          OR owned_items.wear IS DISTINCT FROM EXCLUDED.wear
          OR owned_items.seed IS DISTINCT FROM EXCLUDED.seed
          OR owned_items.stattrak IS DISTINCT FROM EXCLUDED.stattrak
          OR owned_items.stickers IS DISTINCT FROM EXCLUDED.stickers
          OR owned_items.charm_id IS DISTINCT FROM EXCLUDED.charm_id
          OR owned_items.patches IS DISTINCT FROM EXCLUDED.patches
          OR owned_items.nametag IS DISTINCT FROM EXCLUDED.nametag
       RETURNING (xmax = 0) AS inserted`,
      [
        identity.steamId, itemId,
        wearTier ? WEAR_MID[wearTier] : null,
        wearTier ? seedFrom(asset.assetid) : null,
        stattrak, asset.assetid,
        stickers.some((s) => s != null) ? JSON.stringify(stickers) : null,
        charmId,
        patches.some((p) => p != null) ? JSON.stringify(patches) : null,
        nametagOf(desc),
      ],
    );
    // No row back means the DO UPDATE's WHERE filtered it out — already in sync.
    if (rows[0]?.inserted) imported++;
    else if (rows.length) updated++;
  }
  // Drop imported items the user no longer owns on Steam (traded/sold). Skipped
  // on a partial read so a Steam hiccup can't wipe the inventory.
  // `seen` empty + complete would make the NOT-ANY below match every row and
  // wipe the whole Steam-origin inventory. An empty result here means the read
  // or the catalog lookup went wrong, not that the user sold everything.
  let removed = 0;
  if (complete && seen.length) {
    // Which rows are about to go, BEFORE they go. An imported sticker can be
    // applied to a crafted weapon, so trading it away on Steam has to take it
    // off that gun too — deleting the row on its own would leave the weapon
    // pointing at an instance that no longer exists, and the sticker would keep
    // rendering off the inline fallback with nothing able to edit or remove it.
    // Same reasoning as the DELETE endpoint, which detaches for the same reason.
    const { rows: doomed } = await pool.query<{ id: string }>(
      `SELECT id FROM inventory.owned_items
       WHERE steam_id = $1 AND origin = 'steam' AND steam_asset_id IS NOT NULL
         AND NOT (steam_asset_id = ANY($2::text[]))`,
      [identity.steamId, seen],
    );
    if (doomed.length) {
      await detachElsewhere(identity.steamId, doomed.map((r) => Number(r.id)), null, []);
    }
    const { rowCount } = await pool.query(
      `DELETE FROM inventory.owned_items
       WHERE steam_id = $1 AND origin = 'steam' AND steam_asset_id IS NOT NULL
         AND NOT (steam_asset_id = ANY($2::text[]))`,
      [identity.steamId, seen],
    );
    removed = rowCount ?? 0;
  }
  // Mark the account as synced. Written even when nothing was imported — the
  // point is "you have done this", not "you own Steam items" — but only after
  // the fetch itself succeeded, so a failed sync leaves the nag in place.
  await pool.query(
    `INSERT INTO inventory.steam_sync (steam_id, synced_at) VALUES ($1, now())
     ON CONFLICT (steam_id) DO UPDATE SET synced_at = now()`,
    [identity.steamId],
  );
  const ownedBreakdown = [...owned.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  app.log.info(
    `[steam-sync] ${identity.steamId}: ${assets.length} assets` +
      `${complete ? "" : " (PARTIAL read)"} — ${imported} added, ${updated} updated, ` +
      `${removed} removed, ${skipped} skipped (${unknown} unknown)` +
      (ownedBreakdown ? ` | owned: ${ownedBreakdown}` : "") +
      (skippedNames.length ? ` | unknown names: ${[...new Set(skippedNames)].join("; ")}` : "") +
      (unresolved.length ? ` | UNRESOLVED attachments: ${[...new Set(unresolved)].join("; ")}` : ""),
  );
  return { imported, updated, removed, skipped, partial: !complete };
});

// ---- Market prices (opt-in) -------------------------------------------------
// A Steam market price feed, mirrored hourly into inventory.prices and held in
// memory for lookups. The mapping rules live in prices.ts, on their own, so
// tools/price-coverage.ts can prove them without a Postgres; this half is the
// job, the cache and the endpoints.
//
// OPT-IN and off by default, exactly like the shared asset CDN and for the same
// reason: the fetch leaves the operator's network. There is no 5stack price CDN
// — every source here is one the operator picked, and the default (Skinport)
// needs no URL at all. The JSON-feed source falls back to the public
// cs2-prices-tracker project, which the panel names rather than dressing up as
// ours. Whichever host is in play, only the SERVER talks to it; a browser never
// does.

const PRICE_SYNC_INTERVAL_MS = 60 * 60_000;

interface PriceConfig {
  enabled: boolean;
  source: PriceSource;
  base: string;
  custom: boolean;
  /** Which number this source is asked for first. */
  window: PriceWindow;
}

/** Read on nearly every priced request, and it is three short values in a
 *  key/value table — memoised briefly so a page full of tiles doesn't ask the
 *  database what the settings are once per tile. Short enough that flipping the
 *  switch in the admin panel is visible immediately. */
let priceConfigMemo: { at: number; value: PriceConfig } | null = null;
const PRICE_CONFIG_TTL_MS = 5_000;

async function priceSettings(): Promise<PriceConfig> {
  if (priceConfigMemo && Date.now() - priceConfigMemo.at < PRICE_CONFIG_TTL_MS) {
    return priceConfigMemo.value;
  }
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM inventory.settings WHERE key IN ('prices', 'price_source', 'price_feed')`,
  );
  const settings = new Map(rows.map((r) => [r.key, r.value]));
  const stored = settings.get("price_source") as PriceSource | undefined;
  const source = stored && PRICE_SOURCES.includes(stored) ? stored : DEFAULT_PRICE_SOURCE;
  const custom = (settings.get("price_feed") ?? "").trim();
  const value: PriceConfig = {
    enabled: settings.get("prices") === "1",
    source,
    base: custom || PRICE_FEED_BASE,
    custom: custom !== "",
    window: DEFAULT_WINDOW[source],
  };
  priceConfigMemo = { at: Date.now(), value };
  return value;
}
const invalidatePriceConfig = () => (priceConfigMemo = null);

interface PriceMetaRow {
  source_url: string | null;
  /** Which source produced the rows currently in the table — not necessarily the
   *  one configured now, which is the whole point of storing it. */
  source_name: string | null;
  source_date: Date | null;
  synced_at: Date | null;
  attempted_at: Date | null;
  failed_at: Date | null;
  failure: string | null;
  rows: number;
  unmatched: number;
  unmatched_sample: string | null;
}
async function priceMeta(): Promise<PriceMetaRow | null> {
  const { rows } = await pool.query<PriceMetaRow>(
    `SELECT source_url, source_name, source_date, synced_at, attempted_at, failed_at, failure, rows, unmatched, unmatched_sample
     FROM inventory.price_meta WHERE id = 1`,
  );
  return rows[0] ?? null;
}

/**
 * item_id -> the id its price is filed under, as a table.
 *
 * The JS twin of this is priceGroupId(), and it cannot be used here: the lookup
 * is a JOIN in Postgres, so the name-collapse has to be something the join can
 * reach. Rebuilt on boot rather than migrated — it is derived from cs2-lib, so a
 * catalog bump changes it, and ~400 rows are cheaper to rewrite wholesale than
 * to reconcile.
 */
async function syncPriceAliases(): Promise<number> {
  const aliases = catalogSummary()
    .map((item) => [item.id, priceGroupId(item.id)] as const)
    .filter(([id, groupId]) => groupId !== id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM inventory.price_aliases`);
    for (let i = 0; i < aliases.length; i += 1_000) {
      const chunk = aliases.slice(i, i + 1_000);
      const values: number[] = [];
      const tuples = chunk
        .map(([id, groupId], n) => {
          values.push(id, groupId);
          return `($${n * 2 + 1},$${n * 2 + 2})`;
        })
        .join(",");
      await client.query(`INSERT INTO inventory.price_aliases (item_id, price_item_id) VALUES ${tuples}`, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return aliases.length;
}

interface PriceTarget {
  itemId: number;
  wear: number | null;
  stattrak: boolean;
}

/**
 * Prices for a batch of items, in one query.
 *
 * Deliberately NOT a resident copy of the mirror. ~27k listings would sit in
 * every worker's heap, and — the part that actually breaks — each replica would
 * hold its own: the pod that runs a sync would serve fresh prices while its
 * neighbours served whatever they last loaded, with nothing on screen to say
 * which one you got. The table is the single copy; this reads it.
 *
 * One statement per REQUEST, not per item. The caller hands over every item it
 * is about to render (a 200-item inventory, a 15-slot loadout, one craft with
 * its stickers) and gets a map back — the join does the id-collapse via
 * price_aliases and the float bucketing via wearTierSql, both of which used to
 * be the reason this could not be SQL.
 *
 * Duplicates collapse before the query: an inventory with forty of the same
 * sticker asks about it once.
 */
/** float4 round-trip tolerance: a JS double bound as ::real comes back rounded,
 *  so identity has to be "the same number to within float4 precision". */
const nearlyEqual = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && Math.abs(a - b) < 1e-6);

async function lookupPrices(targets: PriceTarget[], window: PriceWindow): Promise<Map<string, PricePoint>> {
  const unique = new Map<string, PriceTarget>();
  for (const target of targets) {
    unique.set(priceTargetKey(target.itemId, target.wear, target.stattrak), target);
  }
  const found = new Map<string, PricePoint>();
  if (unique.size === 0) return found;
  const values: unknown[] = [];
  const tuples = [...unique.values()]
    .map((target, i) => {
      values.push(target.itemId, target.wear, target.stattrak);
      const b = i * 3;
      return `($${b + 1}::int, $${b + 2}::real, $${b + 3}::boolean)`;
    })
    .join(",");
  const { rows } = await pool.query<{
    item_id: number;
    wear: number | null;
    stattrak_asked: boolean;
    market_hash_name: string;
    wear_tier: number;
    stattrak: boolean;
    last_24h: number | null;
    last_7d: number | null;
    last_30d: number | null;
    last_90d: number | null;
    suggested: number | null;
    median: number | null;
    lowest: number | null;
  }>(
    `SELECT v.item_id, v.wear, v.stattrak AS stattrak_asked,
            p.market_hash_name, p.wear_tier, p.stattrak, p.last_24h, p.last_7d, p.last_30d,
            p.last_90d, p.suggested, p.median, p.lowest
       FROM (VALUES ${tuples}) AS v(item_id, wear, stattrak)
       LEFT JOIN inventory.price_aliases a ON a.item_id = v.item_id
       -- Two candidate rows, and the ORDER BY is the whole point: the item's OWN
       -- id first, the name-collapsed one only as a fallback. A source that
       -- prices Doppler phases separately (Skinport does; Steam does not) writes
       -- a row per phase, and this is what lets a Ruby read its own $2.4k rather
       -- than the shared "Doppler" price. When the source doesn't distinguish,
       -- there is no exact row and the alias answers, exactly as before.
       JOIN LATERAL (
         SELECT pr.market_hash_name, pr.wear_tier, pr.stattrak, pr.last_24h, pr.last_7d,
                pr.last_30d, pr.last_90d, pr.suggested, pr.median, pr.lowest
           FROM inventory.prices pr
          WHERE pr.item_id IN (v.item_id, COALESCE(a.price_item_id, v.item_id))
            -- The item's own bracket, OR a listing that carries no bracket at
            -- all (-1). That second case is not an edge: VANILLA knives are sold
            -- as "★ Karambit", with no wear in the name, while the knife itself
            -- very much has a float. Asking only for the float's bracket missed
            -- every one of them — 22 melee items, and the most valuable things
            -- most inventories hold.
            -- Nothing here mints souvenirs. The column exists so a Souvenir AWP's
            -- price is never filed on the plain one; this side just never asks.
            AND pr.souvenir = false
          -- Preference, not filter. Markets do not carry every variant: StatTrak
          -- exists for a fraction of finishes and trades thinly, and the ends of
          -- the wear range are often unlisted — so a Battle-Scarred StatTrak
          -- weapon could match nothing at all and showed no price no matter what
          -- its owner changed. Now the closest listing answers, in this order:
          --   the item's own row (a phase-priced source wrote one)
          --   its StatTrak variant matching the ask
          --   its exact wear bracket
          --   a listing with no bracket at all (vanilla knives)
          --   failing all that, the nearest bracket by distance
          -- What actually matched rides back to the caller, which labels it.
          ORDER BY (pr.item_id = v.item_id) DESC,
                   (pr.stattrak = v.stattrak) DESC,
                   (pr.wear_tier = ${wearTierSql("v.wear")}) DESC,
                   (pr.wear_tier = -1) DESC,
                   abs(pr.wear_tier - ${wearTierSql("v.wear")}) ASC
          LIMIT 1
       ) p ON true`,
    values,
  );
  // Keyed off what was ASKED, never off what came back. Targets bind as $n::real
  // (float4), so a wear of 0.14999999 returns as 0.15000000596 — the caller keys
  // it as Minimal Wear and the row would key as Field-Tested, the get() misses,
  // and a tile renders "no listing" for an item the query actually priced.
  const asked = [...unique.entries()];
  for (const row of rows) {
    // The window fallback stays in prices.ts — one implementation, already
    // covered by tools/price-coverage.ts. Writing it a second time as SQL
    // COALESCE would be two places to get "which window is this" wrong.
    const point = pickPrice(
      {
        last24h: row.last_24h,
        last7d: row.last_7d,
        last30d: row.last_30d,
        last90d: row.last_90d,
        suggested: row.suggested,
        median: row.median,
        lowest: row.lowest,
        marketHashName: row.market_hash_name,
      },
      window,
    );
    if (!point) continue;
    // Say so when the listing is not the one asked for. Compared here, where both
    // halves are in hand: the client knows what it asked but not what the table
    // held, and a substitution the UI cannot see is a substitution it will
    // present as exact.
    // The target this row answers, by identity rather than by re-deriving the
    // key from a rounded float.
    const target = asked.find(
      ([, t]) => t.itemId === row.item_id && t.stattrak === row.stattrak_asked && nearlyEqual(t.wear, row.wear),
    );
    if (!target) continue;
    const askedTier = wearTierIndex(wearTierOf(target[1].wear));
    if (row.wear_tier !== askedTier || row.stattrak !== row.stattrak_asked) {
      point.approx = { wearTier: row.wear_tier, stattrak: row.stattrak };
    }
    found.set(target[0], point);
  }
  return found;
}

const itemNameOf = (id: number) => getItem(id)?.name ?? null;

/** How many listings the mirror holds. Read off the meta row rather than
 *  COUNT(*): it is written by the sync that produced them, and every price
 *  surface asks this to decide whether to draw money at all. */
async function priceListingCount(): Promise<number> {
  const { rows } = await pool.query<{ rows: number }>(`SELECT rows FROM inventory.price_meta WHERE id = 1`);
  return rows[0]?.rows ?? 0;
}

/** An itemized quote for a stored row or a craft-form body — both carry
 *  attachments as the same jsonb specs, so both go through normSpecs. One query
 *  for the weapon and everything on it. */
async function quoteFor(
  row: { item_id: number; wear?: number | null; stattrak?: boolean | null; stickers?: unknown[] | null; patches?: unknown[] | null; charm_id?: number | null },
  window: PriceWindow,
): Promise<Quote> {
  const ids = (arr: unknown) => normSpecs(arr).map((spec) => (spec ? { id: spec.id } : null));
  const spec = {
    itemId: row.item_id,
    wear: row.wear ?? null,
    stattrak: row.stattrak === true,
    stickers: ids(row.stickers),
    patches: ids(row.patches),
    charmId: row.charm_id ?? null,
  };
  // Attachments price at their bare name: no float, no StatTrak.
  const targets: PriceTarget[] = [{ itemId: spec.itemId, wear: spec.wear, stattrak: spec.stattrak }];
  for (const attachment of [...(spec.stickers ?? []), ...(spec.patches ?? [])]) {
    if (attachment) targets.push({ itemId: attachment.id, wear: null, stattrak: false });
  }
  if (spec.charmId != null) targets.push({ itemId: spec.charmId, wear: null, stattrak: false });
  const prices = await lookupPrices(targets, window);
  return quoteItem(
    spec,
    (id, wear, stattrak) => prices.get(priceTargetKey(id, wear, stattrak)) ?? null,
    itemNameOf,
  );
}

const PRICE_INSERT_BATCH = 1_000;

/**
 * Pull the feed and replace the mirror.
 *
 * DELETE + INSERT inside ONE transaction, not an upsert: the feed is a full
 * snapshot, so a merge would keep rows for listings that have since gone away,
 * and prices that stopped being published would sit there looking current
 * forever. The transaction is what makes the wholesale delete safe — a fetch
 * that 404s, or a body that turns out to be an HTML error page, rolls back and
 * leaves yesterday's prices exactly where they were. A failed sync must never
 * cost an operator their price data.
 */
async function syncPrices(opts: { force?: boolean } = {}): Promise<
  { skipped: "disabled" } | { rows: number; unmatched: number; collisions: number } | { error: string }
> {
  const { enabled, source, base } = await priceSettings();
  if (!enabled && !opts.force) return { skipped: "disabled" };
  const provider = PRICE_PROVIDERS[source];
  const url = providerUrl(source, base);
  const startedAt = performance.now();
  await pool.query(
    `INSERT INTO inventory.price_meta (id, source_url, source_name, attempted_at) VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, source_name = EXCLUDED.source_name, attempted_at = now()`,
    [url, source],
  );
  try {
    const response = await fetch(url, {
      // Per-provider: Skinport refuses a client that can't take Brotli (406).
      headers: { Accept: "application/json", ...provider.headers },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Price source returned HTTP ${response.status}.`);
    // The feed itself carries no date. Last-Modified is the mirror's own answer
    // to "how old is this", and a missing header degrades to now() rather than
    // failing the sync — a stale-looking date is a smaller problem than no
    // prices at all.
    const lastModified = response.headers.get("last-modified");
    const sourceDate = lastModified ? new Date(lastModified) : new Date();
    const { prices, unmatched, collisions } = provider.map(await response.json());
    if (prices.length === 0) throw new Error("Price feed mapped to zero rows.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM inventory.prices`);
      for (let i = 0; i < prices.length; i += PRICE_INSERT_BATCH) {
        const chunk = prices.slice(i, i + PRICE_INSERT_BATCH);
        const values: unknown[] = [];
        const tuples = chunk
          .map((p, n) => {
            values.push(
              p.itemId, p.wearTier, p.stattrak, p.souvenir, p.marketHashName,
              p.last24h, p.last7d, p.last30d, p.last90d,
              p.suggested, p.median, p.lowest, p.listings, source,
            );
            const b = n * 14;
            return `(${Array.from({ length: 14 }, (_, k) => `$${b + k + 1}`).join(",")})`;
          })
          .join(",");
        await client.query(
          `INSERT INTO inventory.prices
             (item_id, wear_tier, stattrak, souvenir, market_hash_name,
              last_24h, last_7d, last_30d, last_90d,
              suggested, median, lowest, listings, source)
           VALUES ${tuples}`,
          values,
        );
      }
      await client.query(
        `UPDATE inventory.price_meta
            SET source_date = $1, synced_at = now(), failed_at = NULL, failure = NULL,
                rows = $2, unmatched = $3, unmatched_sample = $4
          WHERE id = 1`,
        [sourceDate, prices.length, unmatched.length, [...new Set(unmatched)].slice(0, 20).join("\n") || null],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    app.log.info(
      `[prices] ${source} ${url}: ${prices.length} listings, ${unmatched.length} unmatched, ${collisions.length} collisions ` +
        `in ${Math.round(performance.now() - startedAt)}ms`,
    );
    return { rows: prices.length, unmatched: unmatched.length, collisions: collisions.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await pool.query(
      `UPDATE inventory.price_meta SET failed_at = now(), failure = $1 WHERE id = 1`,
      [message.slice(0, 1_000)],
    );
    // Explicit, because the alternative is a price column that silently stops
    // updating: the table still has yesterday's rows, so nothing on screen looks
    // broken until someone notices every number is a week old.
    app.log.warn(`[prices] ${source} ${url}: FAILED — ${message}`);
    return { error: message };
  }
}

let priceSyncRunning = false;
function schedulePriceSync() {
  const run = async () => {
    if (priceSyncRunning) return;
    priceSyncRunning = true;
    try {
      await syncPrices();
    } catch (error) {
      app.log.warn(`[prices] sync job threw — ${(error as Error).message}`);
    } finally {
      priceSyncRunning = false;
    }
  };
  void run();
  setInterval(() => void run(), PRICE_SYNC_INTERVAL_MS);
}

/** What the UI needs to decide whether to show money at all. Any signed-in user:
 *  it is one row of operator state, and the alternative is every price surface
 *  guessing from whether numbers came back. */
app.get("/api/prices", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) return reply.status(401).send({ error: "unauthorized" });
  const { enabled, source, window } = await priceSettings();
  const meta = await priceMeta();
  const listings = meta?.rows ?? 0;
  // Rows produced by a DIFFERENT source than the one configured are dead weight:
  // a feed fills last_24h..last_90d, a market fills suggested/median/lowest, and
  // the configured source's window chain only ever looks at its own columns. So
  // a mirror full of feed rows under a market source resolves to nothing at all,
  // for every item, silently. Reported as not-ready rather than ready-but-blank,
  // because "no prices anywhere" with the switch on is the single most confusing
  // state this feature has. `null` counts as a mismatch — it means the rows
  // predate source tracking, which is exactly the case that needs a re-sync.
  const stale = listings > 0 && meta?.source_name !== source;
  return {
    enabled,
    source,
    stale,
    /** Enabled AND actually holding data. The gate every price surface reads —
     *  an enabled feed that has never synced must not draw empty price slots. */
    ready: enabled && listings > 0 && !stale,
    window,
    listings,
    sourceDate: meta?.source_date?.toISOString() ?? null,
    syncedAt: meta?.synced_at?.toISOString() ?? null,
  };
});

/**
 * What a craft would cost, itemized.
 *
 * Takes a craft-form body rather than an owned id on purpose: the estimate has
 * to update while someone is still choosing the float and the stickers, before
 * anything is saved. Same body shape the craft endpoint accepts, so the form can
 * post exactly what it is holding.
 */
app.post<{ Body: Partial<ItemRow> }>("/api/prices/quote", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) return reply.status(401).send({ error: "unauthorized" });
  const body = request.body ?? {};
  const itemId = body.item_id;
  // Validated like the craft endpoint, not merely type-checked. This body is
  // user-supplied and expands into one SQL statement with three bind parameters
  // per attachment, so an unbounded sticker array is a cheap way to blow past
  // Postgres's 65535-parameter ceiling and 500 the pool.
  if (typeof itemId !== "number" || !getItem(itemId)) {
    return reply.status(400).send({ error: "Unknown item." });
  }
  const cap = <T,>(arr: T[] | null | undefined, max: number) => (Array.isArray(arr) ? arr.slice(0, max) : arr);
  const { window } = await priceSettings();
  return await quoteFor(
    {
      ...body,
      item_id: itemId,
      stickers: cap(body.stickers, STICKER_LIMITS.maxStickers),
      patches: cap(body.patches, STICKER_LIMITS.maxPatches),
    },
    window,
  );
});

/**
 * Every price this account's screens need, in one request, separate from the
 * screens themselves.
 *
 * Split from /api/inventory and /api/loadout on purpose. An inventory is what
 * someone came for and should paint the instant it is ready; a dollar figure is
 * an overlay on it. Being its own request also means it can be re-fetched alone
 * — after a craft, after a Steam sync, or the moment a player flips the switch
 * on — without re-loading anything else.
 *
 * Two shapes, because two questions:
 *   `items` — each owned row's OWN price. Summing this counts every thing once;
 *             an applied sticker is a row here as well as a line on its weapon.
 *   `slots` — what each equipped slot is WORTH: skin plus everything on it. Safe
 *             to sum across a team, since an attachment lives on one weapon and
 *             that weapon occupies one slot.
 */
app.get("/api/inventory/prices", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) return reply.status(401).send({ error: "unauthorized" });
  const { enabled, window } = await priceSettings();
  if (!enabled) return { ready: false, window, items: {}, slots: {} };
  const [{ rows: owned }, { rows: equipped }] = await Promise.all([
    pool.query<{ id: string; item_id: number; wear: number | null; stattrak: boolean }>(
      `SELECT id, item_id, wear, stattrak FROM inventory.owned_items WHERE steam_id = $1`,
      [identity.steamId],
    ),
    pool.query<{
      team: string; slot: string; item_id: number | null; wear: number | null; stattrak: boolean;
      stickers: unknown[] | null; patches: unknown[] | null; charm_id: number | null;
    }>(
      `SELECT l.team, l.slot,
              COALESCE(i.item_id, l.item_id)   AS item_id,
              COALESCE(i.wear, l.wear)         AS wear,
              COALESCE(i.stattrak, l.stattrak) AS stattrak,
              i.stickers, i.patches, i.charm_id
         FROM inventory.loadout l
         LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
        WHERE l.steam_id = $1`,
      [identity.steamId],
    ),
  ]);
  // ONE lookup for both halves — the equipped weapons are owned rows too, so
  // asking twice would ask the same questions twice.
  const targets: PriceTarget[] = owned.map((row) => ({
    itemId: row.item_id,
    wear: row.wear,
    stattrak: row.stattrak,
  }));
  for (const row of equipped) {
    if (row.item_id == null) continue;
    targets.push({ itemId: row.item_id, wear: row.wear, stattrak: row.stattrak });
    for (const spec of [...normSpecs(row.stickers), ...normSpecs(row.patches)]) {
      if (spec) targets.push({ itemId: spec.id, wear: null, stattrak: false });
    }
    if (row.charm_id != null) targets.push({ itemId: row.charm_id, wear: null, stattrak: false });
  }
  const prices = await lookupPrices(targets, window);
  const items: Record<string, PricePoint> = {};
  for (const row of owned) {
    const price = prices.get(priceTargetKey(row.item_id, row.wear, row.stattrak));
    if (price) items[String(row.id)] = price;
  }
  const bare = (id: number) => prices.get(priceTargetKey(id, null, false))?.value ?? 0;
  const slots: Record<string, number> = {};
  for (const row of equipped) {
    if (row.item_id == null) continue;
    const base = prices.get(priceTargetKey(row.item_id, row.wear, row.stattrak))?.value ?? 0;
    const attachments =
      normSpecs(row.stickers).reduce((sum, spec) => sum + (spec ? bare(spec.id) : 0), 0) +
      normSpecs(row.patches).reduce((sum, spec) => sum + (spec ? bare(spec.id) : 0), 0) +
      (row.charm_id != null ? bare(row.charm_id) : 0);
    const total = base + attachments;
    if (total > 0) slots[`${row.team}:${row.slot}`] = Math.round(total * 100) / 100;
  }
  return { ready: Object.keys(items).length > 0 || Object.keys(slots).length > 0, window, items, slots };
});

/**
 * What each finish in a slot would cost to buy BRAND NEW — the craft browser's
 * price column, and what a sort-by-value there orders on.
 *
 * "Brand new" is Factory New when Factory New exists, and the next bracket up
 * when it does not. Plenty of finishes have a float floor above 0.07 and are
 * never sold Factory New at all (a Howl caps at 0.08); a strict FN lookup would
 * price those at nothing and drop them out of the sort entirely, which is a
 * worse answer than "the freshest one anybody sells". The bracket that answered
 * rides back with the figure so the UI can say which it was.
 *
 * Non-StatTrak and non-Souvenir on purpose: this is the cost of the FINISH, the
 * floor you would pay to own it at all. StatTrak is a variant you opt into, and
 * pricing every row as its StatTrak copy would make the cheap end of the list
 * meaningless.
 */
app.get<{ Querystring: { slot?: string } }>("/api/prices/stock", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) return reply.status(401).send({ error: "unauthorized" });
  const slot = request.query.slot;
  if (!slot) return reply.status(400).send({ error: "slot required" });
  const { enabled, window } = await priceSettings();
  const empty = { ready: false, window, prices: {} as Record<string, unknown> };
  if (!enabled) return empty;
  // The same catalog the picker is showing, so a price map and a grid can never
  // be about different sets of items.
  const ids = (catalogForSlot(slot).skins ?? []).map((skin) => skin.id);
  if (ids.length === 0) return empty;
  const values: number[] = [];
  const tuples = ids
    .map((id, i) => {
      values.push(id);
      return `($${i + 1}::int)`;
    })
    .join(",");
  const { rows } = await pool.query<{
    item_id: number;
    wear_tier: number;
    market_hash_name: string;
    last_24h: number | null;
    last_7d: number | null;
    last_30d: number | null;
    last_90d: number | null;
    suggested: number | null;
    median: number | null;
    lowest: number | null;
  }>(
    `SELECT v.item_id, p.wear_tier, p.market_hash_name,
            p.last_24h, p.last_7d, p.last_30d, p.last_90d,
            p.suggested, p.median, p.lowest
       FROM (VALUES ${tuples}) AS v(item_id)
       LEFT JOIN inventory.price_aliases a ON a.item_id = v.item_id
       JOIN LATERAL (
         SELECT pr.wear_tier, pr.market_hash_name, pr.last_24h, pr.last_7d, pr.last_30d,
                pr.last_90d, pr.suggested, pr.median, pr.lowest
           FROM inventory.prices pr
          WHERE pr.item_id IN (v.item_id, COALESCE(a.price_item_id, v.item_id))
            AND pr.stattrak = false
            AND pr.souvenir = false
          -- The item's OWN row first (a source that prices Doppler phases wrote
          -- one), then the freshest bracket that exists: wear_tier ascends
          -- -1 (no bracket at all) → 0 Factory New → 1 Minimal Wear → …
          ORDER BY (pr.item_id = v.item_id) DESC, pr.wear_tier ASC
          LIMIT 1
       ) p ON true`,
    values,
  );
  const prices: Record<string, { value: number; window: PriceWindow; marketHashName: string; wearTier: number }> = {};
  for (const row of rows) {
    const point = pickPrice(
      {
        last24h: row.last_24h,
        last7d: row.last_7d,
        last30d: row.last_30d,
        last90d: row.last_90d,
        suggested: row.suggested,
        median: row.median,
        lowest: row.lowest,
        marketHashName: row.market_hash_name,
      },
      window,
    );
    if (point) prices[String(row.item_id)] = { ...point, wearTier: row.wear_tier };
  }
  return { ready: Object.keys(prices).length > 0, window, prices };
});

// ---- Sale history for one listing -------------------------------------------
// The spread behind the single figure. See inventory.price_history for why.

/**
 * One week.
 *
 * A sale spread moves on the scale of days, and the source allows a handful of
 * calls per five minutes — the budget is the scarce thing here, not freshness.
 * A tighter TTL spends it re-fetching numbers that have not moved, and the cost
 * of being a few days stale on a range is nil next to the cost of having no
 * range at all because the last twenty requests were refused.
 */
const HISTORY_TTL_MS = 7 * 24 * 60 * 60_000;
/** A floor between OUTBOUND fetches, whatever is being asked for. Clicking
 *  through twenty knives must not become twenty requests in twenty seconds. */
const HISTORY_MIN_GAP_MS = 3_000;
let lastHistoryFetch = 0;
/**
 * Refused, so stop asking.
 *
 * The per-request floor is not enough on its own: once the source starts
 * answering 429 the polite thing — and the only thing that gets the budget
 * back — is to go quiet for a while rather than keep knocking every three
 * seconds. Process-local because it is a property of THIS pod's recent
 * behaviour; the shared TTL below is what keeps replicas off each other's toes.
 */
let historyCooldownUntil = 0;
const HISTORY_COOLDOWN_MS = 5 * 60_000;
/** Marks "we asked about this name and it has no sale history" — see the note at
 *  the write below. Not a real window; it never renders. */
const HISTORY_NONE = "none";

const HISTORY_WINDOWS = ["last_24_hours", "last_7_days", "last_30_days", "last_90_days"] as const;
type HistoryWindow = (typeof HISTORY_WINDOWS)[number];
interface HistoryRow {
  window: HistoryWindow;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  volume: number;
}

/** Skinport's sales history, which is public, phase-aware and returns one row
 *  per version. Only this provider publishes it; with any other source selected
 *  the detail endpoint simply has nothing to add. */
function skinportHistoryUrl(marketHashName: string) {
  return `https://api.skinport.com/v1/sales/history?app_id=730&currency=USD&market_hash_name=${encodeURIComponent(marketHashName)}`;
}

async function fetchSaleHistory(marketHashName: string): Promise<Map<string, HistoryRow[]>> {
  const response = await fetch(skinportHistoryUrl(marketHashName), {
    headers: { "Accept-Encoding": "br, gzip", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429) {
    historyCooldownUntil = Date.now() + HISTORY_COOLDOWN_MS;
    throw new Error("Sale history is rate-limited; backing off.");
  }
  if (!response.ok) throw new Error(`Sale history returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Sale history is not an array.");
  const byVersion = new Map<string, HistoryRow[]>();
  for (const raw of payload) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    if (entry.market_hash_name !== marketHashName) continue;
    const version = typeof entry.version === "string" ? entry.version : "";
    const rows: HistoryRow[] = [];
    for (const window of HISTORY_WINDOWS) {
      const w = (entry[window] ?? {}) as Record<string, unknown>;
      const volume = typeof w.volume === "number" ? w.volume : 0;
      // A window nobody sold in is not a data point. Storing four nulls per
      // window would only teach the cache that this item trades at nothing.
      if (volume <= 0) continue;
      rows.push({
        window,
        min: positiveOrNull(w.min),
        max: positiveOrNull(w.max),
        avg: positiveOrNull(w.avg),
        median: positiveOrNull(w.median),
        volume,
      });
    }
    if (rows.length) byVersion.set(version, rows);
  }
  return byVersion;
}

const positiveOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * What copies of this exact listing recently sold for.
 *
 * Answers a question the flat bracket price cannot: a Factory New Karambit
 * Doppler is everything from a 0.0001 Phase 4 to a 0.069 one, and the MIN and
 * MAX of recent sales bound how much that actually matters. The caller pairs it
 * with where the item's own float sits inside its bracket — this endpoint
 * deliberately does not, because a spread is a fact and the adjustment is an
 * inference, and mixing them produces a number that looks measured.
 */
app.get<{ Querystring: { item_id?: string; wear?: string; stattrak?: string } }>(
  "/api/prices/detail",
  async (request, reply) => {
    const identity = await getIdentity(request);
    if (!identity) return reply.status(401).send({ error: "unauthorized" });
    const itemId = Number(request.query.item_id);
    if (!Number.isFinite(itemId)) return reply.status(400).send({ error: "item_id is required." });
    const { enabled, source, window } = await priceSettings();
    const wear = request.query.wear != null && request.query.wear !== "" ? Number(request.query.wear) : null;
    const stattrak = request.query.stattrak === "1";
    const none = { available: false, window, marketHashName: null, version: null, history: [] as HistoryRow[] };
    // Only one provider publishes a sale history, and the market name to ask it
    // about comes out of our own mirror — which is keyed by exactly the four
    // facts a listing is: item, bracket, StatTrak, Souvenir.
    if (!enabled || source !== "skinport") return none;
    const prices = await lookupPrices([{ itemId, wear, stattrak }], window);
    const point = prices.get(priceTargetKey(itemId, wear, stattrak));
    if (!point) return none;
    const marketHashName = point.marketHashName;
    // The phase, when the item has one: the source reports a row per version and
    // a Black Pearl is not a Phase 1.
    const version = getItem(itemId)?.altName ?? "";

    const { rows: cached } = await pool.query<{
      // `period` is a HistoryWindow OR the HISTORY_NONE sentinel, so it is typed
      // as it is stored: a string, narrowed when the usable rows are picked.
      version: string; period: string; min: number | null; max: number | null;
      avg: number | null; median: number | null; volume: number; fetched_at: Date;
    }>(
      `SELECT version, period, min, max, avg, median, volume, fetched_at
         FROM inventory.price_history WHERE market_hash_name = $1`,
      [marketHashName],
    );
    const fresh =
      cached.length > 0 && Date.now() - Math.max(...cached.map((r) => r.fetched_at.getTime())) < HISTORY_TTL_MS;

    if (!fresh && Date.now() > historyCooldownUntil && Date.now() - lastHistoryFetch > HISTORY_MIN_GAP_MS) {
      lastHistoryFetch = Date.now();
      try {
        const byVersion = await fetchSaleHistory(marketHashName);
        const values: unknown[] = [];
        const tuples: string[] = [];
        for (const [ver, rows] of byVersion) {
          for (const row of rows) {
            const b = values.length;
            values.push(marketHashName, ver, row.window, row.min, row.max, row.avg, row.median, row.volume);
            tuples.push(`(${Array.from({ length: 8 }, (_, k) => `$${b + k + 1}`).join(",")}, now())`);
          }
        }
        // NOTHING is a result too. Without a row saying "asked, and this name
        // has no sale history", every view of that item re-asked — and the items
        // with no history are exactly the thin ones people click through while
        // browsing, so the empty answers were spending the whole budget.
        if (!tuples.length) {
          values.push(marketHashName, version, HISTORY_NONE, null, null, null, null, 0);
          tuples.push(`(${Array.from({ length: 8 }, (_, k) => `$${k + 1}`).join(",")}, now())`);
        }
        if (tuples.length) {
          await pool.query(
            `INSERT INTO inventory.price_history
               (market_hash_name, version, period, min, max, avg, median, volume, fetched_at)
             VALUES ${tuples.join(",")}
             ON CONFLICT (market_hash_name, version, period) DO UPDATE SET
               min = EXCLUDED.min, max = EXCLUDED.max, avg = EXCLUDED.avg,
               median = EXCLUDED.median, volume = EXCLUDED.volume, fetched_at = now()`,
            values,
          );
        }
        const rows = byVersion.get(version) ?? byVersion.get("") ?? [];
        return { available: rows.length > 0, window, marketHashName, version: version || null, history: rows };
      } catch (error) {
        // A history that won't load is not an error worth failing the request
        // over — the caller still has a price to show.
        app.log.warn(`[prices] sale history for ${marketHashName}: ${(error as Error).message}`);
      }
    }
    // Serve what is stored, stale or not: a spread from this morning beats none.
    const usable = cached.filter((r) => r.period !== HISTORY_NONE);
    const mine = usable.filter((r) => r.version === version);
    const rows = (mine.length ? mine : usable.filter((r) => r.version === "")).map((r) => ({
      window: r.period as HistoryWindow,
      min: r.min,
      max: r.max,
      avg: r.avg,
      median: r.median,
      volume: r.volume,
    }));
    return { available: rows.length > 0, window, marketHashName, version: version || null, history: rows };
  },
);

// ---- Admin: the price feed ---------------------------------------------------
// Same shape as the asset-CDN panel: read the switch, flip the switch, and see
// enough of the last attempt to tell "never ran" from "ran and failed" from "ran
// fine, that item just doesn't trade".
/** What the sale-history cache holds. One cheap aggregate; the admin panel is
 *  the only caller. */
async function historyCacheStats() {
  const { rows } = await pool.query<{ listings: string; withdata: string; oldest: Date | null }>(
    `SELECT count(DISTINCT market_hash_name)                                 AS listings,
            count(DISTINCT market_hash_name) FILTER (WHERE period <> 'none') AS withdata,
            min(fetched_at)                                                  AS oldest
       FROM inventory.price_history`,
  );
  const row = rows[0];
  return {
    listings: Number(row?.listings ?? 0),
    /** The rest were asked about and genuinely have no recent sales — cached as
     *  such so they are not asked about again for a week. */
    withData: Number(row?.withdata ?? 0),
    oldest: row?.oldest?.toISOString() ?? null,
    staleAfterDays: HISTORY_TTL_MS / (24 * 60 * 60_000),
  };
}

app.get("/api/admin/prices", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const { enabled, source, base, custom, window } = await priceSettings();
  const meta = await priceMeta();
  return {
    enabled,
    source,
    sources: PRICE_SOURCES,
    base,
    /** The operator typed this URL in; false means it is our default. */
    custom,
    url: providerUrl(source, base),
    providers: PRICE_SOURCES.map((id) => ({
      id,
      label: PRICE_PROVIDERS[id].label,
      blurb: PRICE_PROVIDERS[id].blurb,
      /** Null means "the operator supplies the URL" — only the JSON feed does. */
      url: PRICE_PROVIDERS[id].url,
      window: PRICE_PROVIDERS[id].window,
    })),
    defaultBase: PRICE_FEED_BASE,
    /** Where the default mirror is built FROM. Shown so an operator who would
     *  rather not depend on the 5stack host knows what to point at instead. */
    window,
    windows: PRICE_WINDOWS,
    listings: meta?.rows ?? 0,
    /** The mirror holds another source's rows — see the note in /api/prices. */
    stale: (meta?.rows ?? 0) > 0 && meta?.source_name !== source,
    /** The sale-history cache: how many listings have been looked up, and when
     *  the oldest of them was. Shown because the rate budget it protects is the
     *  reason it exists, and a cache nobody can see is a cache nobody trusts. */
    history: await historyCacheStats(),
    syncing: priceSyncRunning,
    intervalMinutes: PRICE_SYNC_INTERVAL_MS / 60_000,
    sourceDate: meta?.source_date?.toISOString() ?? null,
    syncedAt: meta?.synced_at?.toISOString() ?? null,
    syncedSource: meta?.source_name ?? null,
    attemptedAt: meta?.attempted_at?.toISOString() ?? null,
    failedAt: meta?.failed_at?.toISOString() ?? null,
    failure: meta?.failure ?? null,
    unmatched: meta?.unmatched ?? 0,
    unmatchedSample: meta?.unmatched_sample?.split("\n").filter(Boolean) ?? [],
  };
});

app.put<{ Body: { enabled?: boolean; base?: string | null; source?: string } }>("/api/admin/prices", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const body = request.body ?? {};
  if (body.source !== undefined) {
    if (!PRICE_SOURCES.includes(body.source as PriceSource)) {
      return reply.status(400).send({ error: `Unknown price source. Pick one of: ${PRICE_SOURCES.join(", ")}.` });
    }
    // Switching source makes every stored row the wrong shape — a Skinport
    // reference price and a feed's 7-day average live in different columns, and
    // the old rows would simply never resolve. Cheaper and far less confusing to
    // drop them and re-sync than to leave a table that silently prices nothing.
    const { rows: current } = await pool.query<{ value: string }>(
      `SELECT value FROM inventory.settings WHERE key = 'price_source'`,
    );
    if ((current[0]?.value ?? DEFAULT_PRICE_SOURCE) !== body.source) {
      await pool.query(`DELETE FROM inventory.prices`);
      await pool.query(`UPDATE inventory.price_meta SET rows = 0, unmatched = 0, unmatched_sample = NULL, synced_at = NULL, source_date = NULL WHERE id = 1`);
    }
    await pool.query(
      `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('price_source', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [body.source],
    );
  }
  if (body.base !== undefined) {
    const base = (body.base ?? "").trim();
    // An http(s) URL or nothing. Anything else would be stored, retried hourly
    // and reported as a fetch failure once an hour forever.
    if (base !== "") {
      let parsed: URL;
      try {
        parsed = new URL(base);
      } catch {
        return reply.status(400).send({ error: "That isn't a valid URL." });
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return reply.status(400).send({ error: "The feed URL must be http or https." });
      }
    }
    await pool.query(
      `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('price_feed', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [base],
    );
  }
  if (body.enabled !== undefined) {
    await pool.query(
      `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('prices', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [body.enabled === true ? "1" : "0"],
    );
  }
  invalidatePriceConfig();
  const settings = await priceSettings();
  // Turning it on with nothing mirrored yet would otherwise leave the panel
  // saying "enabled" over an empty table until the top of the hour.
  if (settings.enabled && (await priceListingCount()) === 0 && !priceSyncRunning) {
    priceSyncRunning = true;
    void syncPrices()
      .catch(() => {})
      .finally(() => {
        priceSyncRunning = false;
      });
  }
  return { enabled: settings.enabled, source: settings.source, base: settings.base, custom: settings.custom };
});

/** Force a refresh now, ignoring both the hourly clock and the opt-in — an
 *  operator asking for a sync IS the opt-in, and it is how you test a URL
 *  before flipping the switch. */
app.post("/api/admin/prices/sync", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  if (priceSyncRunning) return reply.status(409).send({ error: "A price sync is already running." });
  priceSyncRunning = true;
  try {
    const result = await syncPrices({ force: true });
    if ("error" in result) return reply.status(502).send(result);
    return result;
  } finally {
    priceSyncRunning = false;
  }
});

/** Drop the mirror. The opt-in switch stops the refresh; this is for an operator
 *  who wants the data gone as well — the rows are a third party's numbers about
 *  a market, and "off" should be able to mean empty. */
app.delete("/api/admin/prices", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  await pool.query(`DELETE FROM inventory.prices`);
  await pool.query(
    `UPDATE inventory.price_meta SET rows = 0, unmatched = 0, unmatched_sample = NULL, source_date = NULL, synced_at = NULL WHERE id = 1`,
  );
  return { listings: 0 };
});

// ---- Shared asset CDN (opt-in) ---------------------------------------------
// Extraction is DETERMINISTIC: texture names hash the archive path, material
// names come from cs2-lib, so the same pipeline version against the same CS2
// build produces byte-identical output on every deployment. That makes a shared,
// 5stack-operated CDN safe — an instance can serve exactly what it would have
// extracted itself, without spending ~13 minutes extracting it.
//
// OPT-IN, and off by default, on purpose. The failure that motivated removing
// cdn.cstrike.app was assets quietly arriving from somewhere the operator did
// not choose; a first-party CDN is fine, silently switching to it is not.
const ASSET_CDN_BASE = process.env.INVENTORY_ASSET_CDN ?? "https://skins.5stack.gg";

async function assetCdnEnabled(): Promise<boolean> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM inventory.settings WHERE key = 'asset_cdn'`,
  );
  return rows[0]?.value === "1";
}

/** The CDN's own pipeline+build, read from the stamp it serves. The CDN host is
 *  the same frontend on a second domain (see the panel's ingress.yaml), so it
 *  serves assets at the ROOT and its extract stamp is reachable at the same
 *  path ours is. No /api is exposed there, which is why this reads the stamp
 *  file rather than asking the API. */
async function assetCdnStamp(): Promise<{ version: number | null; gameBuild: number | null }> {
  try {
    const res = await fetch(`${ASSET_CDN_BASE}/models/extract-version.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { version: null, gameBuild: null };
    const p = (await res.json()) as { version?: number; gameBuild?: number };
    return {
      version: typeof p.version === "number" ? p.version : null,
      gameBuild: typeof p.gameBuild === "number" ? p.gameBuild : null,
    };
  } catch {
    return { version: null, gameBuild: null };
  }
}

/** Where clients should fetch item art and paint assets from. Empty means "the
 *  same host that served the API" — the default, and what every deployment did
 *  before this existed.
 *
 *  Refuses to hand out the CDN unless its pipeline AND CS2 build match ours.
 *  The assets sit at the host root with no version in the URL, so a mismatch
 *  would quietly serve another build's skins rather than 404 — wrong pixels are
 *  far harder to notice than missing ones. Extraction is deterministic for a
 *  given pipeline+build, so equal keys really do mean identical bytes. */
/** What this deployment's assets ARE — or WOULD be if it extracted right now.
 *
 *  The projected case is the important one. A brand-new install has never
 *  extracted, so it has no stamp; keying only on the stamp meant the CDN could
 *  never engage for exactly the deployment that needs it most. What it *would*
 *  produce is knowable without running anything: the pipeline version baked into
 *  this build's script, against the CS2 build the mounted install reports. */
async function localAssetKey(): Promise<{ version: number | null; gameBuild: number | null; projected: boolean }> {
  const stamp = await readExtractStamp();
  if (stamp.version != null && stamp.gameBuild != null) {
    return { version: stamp.version, gameBuild: stamp.gameBuild, projected: false };
  }
  const [required, current] = await Promise.all([readRequiredExtractVersion(), readCurrentGameVersion()]);
  return { version: required, gameBuild: current.gameBuild, projected: true };
}

/** True once this deployment has completed its own extraction. The stamp is
 *  written last, on success, so its presence is the honest signal. */
async function hasLocalAssets(): Promise<boolean> {
  return (await readExtractStamp()).version != null;
}

async function assetOrigin(): Promise<string> {
  // Two ways to end up on the CDN:
  //
  //   1. The operator opted in.
  //   2. This box has NOTHING of its own yet — no completed extraction — so the
  //      alternative is blank icons and white skins.
  //
  // Case 2 is deliberately not "silently using someone else's assets", which is
  // the thing removing cdn.cstrike.app was about. That was a third party
  // REPLACING assets the server already had. This is a first-party CDN filling
  // a void, it only applies while the void exists, it stops the moment an
  // extraction completes, and the panel says so plainly.
  const enabled = await assetCdnEnabled();
  if (!enabled && (await hasLocalAssets())) return "";
  const theirs = await assetCdnStamp();
  // Nothing published (or unreachable) — never hand out an origin we can't
  // confirm is serving anything.
  if (theirs.version == null || theirs.gameBuild == null) return "";
  const mine = await localAssetKey();
  // Pipeline version must agree: a different version means a different output
  // format, not just different bytes.
  if (mine.version != null && theirs.version !== mine.version) return "";
  // CS2 build must agree WHEN WE KNOW OURS. A deployment with no game files
  // mounted has no build to compare, and no way to extract either — refusing
  // there would leave it with no assets at all, which is strictly worse than
  // serving the CDN's. The panel says the build is unverified in that case.
  if (mine.gameBuild != null && theirs.gameBuild !== mine.gameBuild) return "";
  return ASSET_CDN_BASE;
}

// ---- Server API key (panel-generated; used as invsim_apikey by game servers) --

async function getServerApiKey(): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM inventory.settings WHERE key = 'server_api_key'`,
  );
  return rows[0]?.value ?? process.env.INVSIM_API_KEY ?? null;
}

// ---- Game type config sync -------------------------------------------------
// Writes the invsim block to the TOP of the panel's match_type_cfgs rows
// (Lan/Competitive/Wingman/Duel) so game servers pick the key up without any
// manual config editing. Runs on startup, on admin key fetch, and on key
// generation. A cfg row REPLACES the default file on the game server, so a
// missing row is seeded from the stock config (same source the panel's
// get-default-config endpoint uses) before prepending.
// Lan is deliberately excluded — that cfg is hand-maintained, leave it alone.
const CFG_TYPES = ["Competitive", "Wingman", "Duel"];
const CFG_MARKER = "5stack inventory plugin (auto-added)";

function invsimBlock(url: string, key: string): string {
  return [
    `// ${CFG_MARKER}`,
    `invsim_url "${url}"`,
    `invsim_apikey "${key}"`,
    "invsim_ws_enabled 1",
    "invsim_ws_immediately 1",
    // Defers the player's activation until their loadout fetch resolves.
    // Without it, 5stack auto-assigns a team and force-respawns ~100ms after
    // connect, which beats this HTTP round-trip — the weapons are then built
    // vanilla and nothing re-evaluates them until the next spawn, so skins
    // only show up after the player's first death.
    "invsim_require_inventory 1",
    "invsim_spraychanger_enabled 1",
    "",
  ].join("\n");
}

async function fetchDefaultCfg(type: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/5stackgg/game-server/refs/heads/main/shared/cfg/5stack.${type.toLowerCase()}.cfg`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (error) {
    app.log.error({ err: error }, `[invsim-cfg] ${type}: default config fetch failed`);
    return null;
  }
}

// The plugin's public URL, for invsim_url: INVSIM_URL env wins; otherwise it's
// derived from the admin request's Host header and remembered for startup runs.
async function resolveInvsimUrl(request?: { headers: Record<string, unknown>; protocol?: string }): Promise<string | null> {
  if (process.env.INVSIM_URL) return process.env.INVSIM_URL;
  const host = String(request?.headers?.["x-forwarded-host"] ?? request?.headers?.host ?? "").split(",")[0].trim();
  if (host) {
    const proto = String(request?.headers?.["x-forwarded-proto"] ?? request?.protocol ?? "https").split(",")[0].trim();
    const url = `${proto}://${host}`;
    await pool.query(
      `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('invsim_url', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [url],
    );
    return url;
  }
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM inventory.settings WHERE key = 'invsim_url'`,
  );
  return rows[0]?.value ?? null;
}

async function syncGameConfigs(url: string, key: string): Promise<{ updated: string[]; failed: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];
  for (const type of CFG_TYPES) {
    try {
      const { rows } = await pool.query<{ cfg: string }>(
        `SELECT cfg FROM public.match_type_cfgs WHERE type = $1`,
        [type],
      );
      let cfg = rows[0]?.cfg;
      if (cfg == null) {
        app.log.info(`[invsim-cfg] ${type}: no row — seeding from default config`);
        const def = await fetchDefaultCfg(type);
        if (def == null) {
          failed.push(type);
          continue;
        }
        cfg = def;
      }
      // Strip any invsim lines already present (old bottom-placed block, stale
      // key) so the fresh block always sits at the very top.
      const cleaned = cfg
        .split("\n")
        .filter((line) => !/^\s*invsim_/.test(line) && !line.includes(CFG_MARKER))
        .join("\n")
        .replace(/^\s+/, "")
        .replace(/\s+$/, "");
      const next = invsimBlock(url, key) + "\n" + cleaned + "\n";
      if (next === rows[0]?.cfg) {
        continue;
      }
      await pool.query(
        `INSERT INTO public.match_type_cfgs (type, cfg) VALUES ($1, $2)
         ON CONFLICT (type) DO UPDATE SET cfg = EXCLUDED.cfg`,
        [type, next],
      );
      app.log.info(`[invsim-cfg] ${type}: invsim block written at top (${next.length} chars)`);
      updated.push(type);
    } catch (error) {
      app.log.error({ err: error }, `[invsim-cfg] ${type}: sync FAILED`);
      failed.push(type);
    }
  }
  return { updated, failed };
}

// ---- Cached-asset admin: sizes + clearing.
//
// Only CARD RENDERS are a cache. They are client bakes of items the user owns,
// so clearing one costs a re-render and nothing else.
//
// Paints and icons used to belong here too, back when a miss was lazily
// re-fetched from a public CDN. That fallback is gone — they are extracted from
// the instance's own CS2 install now — so deleting them is unrecoverable
// without a full re-extraction, and every skin renders white in the meantime.
// That is exactly what happened once. They are reported here but NOT clearable;
// re-running the extraction is the way to rebuild them.
type DirStat = { files: number; bytes: number };

/**
 * Walk a tree once, bucketing every file by what it IS.
 *
 * `classify` gets the path RELATIVE to `dir` and returns a bucket name, or null
 * to count the file in the total but in no bucket. One walk either way — the
 * expensive part is the ~45k stat calls, not the arithmetic — so a breakdown
 * costs the same as the single number it replaces.
 */
async function dirStats(
  dir: string,
  classify?: (rel: string) => string | null,
): Promise<DirStat & { buckets: Record<string, DirStat> }> {
  let files = 0;
  let bytes = 0;
  const buckets: Record<string, DirStat> = {};
  async function walk(d: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, childRel);
      else {
        const size = (await fs.stat(full).catch(() => ({ size: 0 }))).size;
        files++;
        bytes += size;
        const key = classify?.(childRel);
        if (key) {
          const b = (buckets[key] ??= { files: 0, bytes: 0 });
          b.files++;
          b.bytes += size;
        }
      }
    }
  }
  await walk(dir, "");
  return { files, bytes, buckets };
}

/**
 * What lives on the models mount, by kind.
 *
 * Everything here is flat in one directory or one level down, so the shape of
 * the path IS the answer — there is no manifest to consult and adding one would
 * be a second thing to keep in sync with the extractor.
 *
 * The split exists because the two biggest things on this mount were invisible:
 * composite inputs (1.2 GB of `.inputs.hd`, the per-weapon paint sources) and
 * the flat model textures (1.4 GB) were both reported inside one "3D models"
 * row that read as if it were a few hundred MB of GLBs.
 */
function classifyModelFile(rel: string): string | null {
  // Agents keep their archive path (agents/models/<faction>/<name>.glb).
  if (rel.startsWith("agents/")) return "agents";
  // Per-weapon paint compositor sources — by far the largest bucket, and the
  // one an operator low on disk most wants to see.
  if (/(^|\/)[^/]+\.inputs(\.hd)?\//.test(rel)) return "compositeInputs";
  const base = rel.split("/").pop() ?? "";
  if (base.startsWith("kc_") && base.endsWith(".glb")) return "charms";
  if (base.endsWith(".glb")) return "meshes"; // weapons, knives, gloves, modules
  if (base.endsWith(".webp") || base.endsWith(".png")) return "modelTextures";
  return "modelMeta"; // anchors, markup, the version stamp, raw .vmdl dumps
}

/** Paint chain: a little JSON naming a lot of texture. Split for the same
 *  reason — "Paint materials, 12 GB" described 61 MB of JSON plus everything
 *  the JSON points at. */
function classifyPaintFile(rel: string): string | null {
  if (rel.startsWith("materials/")) return "paintMaterials";
  if (rel.startsWith("textures/")) return "paintTextures";
  return null;
}
async function requireAdmin(request: Parameters<typeof getIdentity>[0]) {
  const identity = await getIdentity(request);
  if (!identity) return { code: 401 as const, error: "unauthorized" };
  if (identity.role !== "administrator") return { code: 403 as const, error: "Only administrators can manage caches." };
  return null;
}
// Read/write the shared-CDN opt-in. Reports whether the CDN actually has this
// build so the panel can say so BEFORE someone flips it on and finds every skin
// missing — the CDN is keyed on pipeline+build, and a deployment on a CS2
// version it has never published is a real possibility.
app.get("/api/admin/asset-cdn", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const enabled = await assetCdnEnabled();
  const mine = await localAssetKey();
  const theirs = await assetCdnStamp();
  // Report exactly what assetOrigin() decides, so the panel can never say
  // "available" while the client gate quietly refuses it.
  const origin = await assetOrigin();
  const hasLocal = await hasLocalAssets();
  const available = origin !== "";
  const wouldMatch =
    theirs.version != null &&
    theirs.gameBuild != null &&
    (mine.version == null || theirs.version === mine.version) &&
    (mine.gameBuild == null || theirs.gameBuild === mine.gameBuild);
  return {
    enabled,
    base: ASSET_CDN_BASE,
    origin: theirs.version != null ? ASSET_CDN_BASE : null,
    available: enabled ? available : wouldMatch,
    /** Serving from the CDN right now WITHOUT being opted in, because this box
     *  has no extraction of its own. Ends as soon as one completes. */
    usingFallback: !enabled && origin !== "",
    hasLocalAssets: hasLocal,
    extractVersion: mine.version,
    gameBuild: mine.gameBuild,
    cdnVersion: theirs.version,
    cdnGameBuild: theirs.gameBuild,
    /** True when this box has never extracted, so the key above is what it
     *  WOULD produce rather than what it has. */
    projected: mine.projected,
    /** No CS2 install to read a build from — the build cannot be verified. */
    buildUnknown: mine.gameBuild == null,
  };
});

app.put<{ Body: { enabled?: boolean } }>("/api/admin/asset-cdn", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const enabled = request.body?.enabled === true;
  await pool.query(
    `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('asset_cdn', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [enabled ? "1" : "0"],
  );
  return { enabled };
});

app.get("/api/admin/cache", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  // models = extracted GLBs + composite inputs on the mount (read-only here;
  // populated by the extraction Job / manual script). Handy truth-check when
  // the 3D toggle "disappears" — 0 files means the mount is empty, not a bug.
  return await cachedDirStats();
});

// dirStats walks and stats EVERY file under four directories — ~45k of them
// once the mount is populated. The panel polls this while an extraction runs
// (to show the counts climbing), and that walk competes with the extraction for
// the same disk. Memoised briefly so a polling tab, or several admins watching
// at once, cost one walk rather than one each.
const DIR_STATS_TTL_MS = 8_000;
let dirStatsMemo: { at: number; value: Promise<Record<string, { files: number; bytes: number }>> } | null = null;
function cachedDirStats() {
  if (dirStatsMemo && Date.now() - dirStatsMemo.at < DIR_STATS_TTL_MS) return dirStatsMemo.value;
  const modelsDir = path.join(path.dirname(RENDERS_DIR), "models");
  const value = (async () => {
    const [renders, paints, images, models, composites, music] = await Promise.all([
      dirStats(RENDERS_DIR),
      dirStats(PAINTS_DIR, classifyPaintFile),
      dirStats(IMAGES_DIR),
      dirStats(modelsDir, classifyModelFile),
      // Client-baked, self-invalidating and LRU-trimmed, so it needs no
      // attention — but it is the one directory here that grows from ordinary
      // use rather than from an extraction, so an operator watching disk should
      // be able to see it.
      dirStats(COMPOSITES_DIR),
      // ~3.5MB per music kit, ~350MB in total — the largest single thing this
      // mount grew in one version, and the question an operator asks of this
      // panel is "what is eating the disk". Unlisted, it is 350MB of nothing.
      dirStats(MUSIC_DIR),
    ]);
    // Totals stay exactly where they were so an older panel keeps working; the
    // breakdown rides alongside as `parts`. A panel that doesn't know about it
    // renders the same three rows it always did.
    const strip = (d: DirStat & { buckets?: Record<string, DirStat> }) => ({ files: d.files, bytes: d.bytes });
    return {
      renders: strip(renders),
      paints: strip(paints),
      images: strip(images),
      models: strip(models),
      composites: strip(composites),
      music: strip(music),
      parts: { ...models.buckets, ...paints.buckets },
    };
  })();
  // Don't let a failed walk stick around as a poisoned memo.
  value.catch(() => {
    if (dirStatsMemo?.value === value) dirStatsMemo = null;
  });
  dirStatsMemo = { at: Date.now(), value };
  return value;
}
app.delete<{ Querystring: { scope?: string } }>("/api/admin/cache", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  // Renders only, whatever is asked for. "paints"/"all" used to be valid and
  // are refused rather than silently downgraded, so an old client (or a stale
  // bookmarked request) can't quietly wipe the paint chain again.
  const scope = request.query.scope ?? "renders";
  // Composites are clearable for the same reason renders are — they are derived
  // output this server can rebuild — but paints/icons still are not: those come
  // from the CS2 install and only an extraction can restore them.
  if (scope !== "renders" && scope !== "composites") {
    return reply.status(400).send({
      error:
        "Only card renders and paint composites can be cleared. Paints and icons are extracted from this server's CS2 install — re-run the model extraction to rebuild them.",
    });
  }
  const dir = scope === "composites" ? COMPOSITES_DIR : RENDERS_DIR;
  const before = await dirStats(dir);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  // Drop the memo. The panel re-reads the stats the instant this returns, and
  // cachedDirStats would otherwise serve its 8-second-old walk — so a clear that
  // worked perfectly reported the same file count it started with, which reads
  // exactly like a clear that did nothing.
  dirStatsMemo = null;
  return { cleared: { [scope]: before.files } };
});

// ---- Model extraction (admins) ----------------------------------------------
// Runs scripts/extract-models.sh as a child process of THIS backend: it reads
// the node's CS2 install (mounted read-only) and writes GLBs + composite inputs
// straight onto the models mount we already serve from. No k8s Job, no RBAC —
// the only state is a JSON file on that same mount, so a pod restart still
// remembers the last run without needing redis or a table.
import { spawn, type ChildProcess } from "node:child_process";

const MODELS_ROOT = path.dirname(RENDERS_DIR); // /cs2-models
const EXTRACT_STATE_FILE = path.join(MODELS_ROOT, "extract-state.json");
// Full run log, streamed to disk as it happens. The state file only carries a
// tail for the panel; this is the whole thing, and it survives the run ending
// (and the pod restarting) so a failure can actually be handed to someone.
const EXTRACT_LOG_FILE = path.join(MODELS_ROOT, "extract-last.log");
// Where the script lives differs by how the backend is running: the image
// copies it to /usr/local/bin, while dev syncs the whole repo at /app (so it's
// the repo's own scripts/). Resolve at request time — under dev sync the file
// can appear after boot.
const EXTRACT_SCRIPT_CANDIDATES = [
  "/usr/local/bin/extract-models.sh", // container image
  "/app/scripts/extract-models.sh", // dev: repo synced at /app
  path.resolve("scripts/extract-models.sh"), // running from the repo root
  path.resolve("../scripts/extract-models.sh"), // running from backend/
];
async function resolveExtractScript(): Promise<string | null> {
  if (process.env.EXTRACT_SCRIPT) return process.env.EXTRACT_SCRIPT;
  for (const candidate of EXTRACT_SCRIPT_CANDIDATES) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  return null;
}
const CS2_DIR = process.env.CS2_DIR ?? "/cs2-game";
const EXTRACT_LOG_LINES = 200;

// ---- How many workers the extraction may use -------------------------------
// One plain integer in a file on the mount, because the script re-reads it as
// it runs: raising the number in the panel adds workers to the decompile
// already in progress rather than needing a restart. The DB row is the durable
// setting; this file is how a live run hears about it.
const EXTRACT_JOBS_FILE = path.join(MODELS_ROOT, "extract-jobs");
// Measured peak RSS of ONE decompile worker (see "Parallelism" in the script,
// where the full measurements live). A range, not a number, because it depends
// entirely on the weapon a worker draws: the knife directory peaked at 0.5 GB,
// a single 4K-textured AK at 1.3 GB. Full-run aggregates landed between those
// per worker (12 workers -> 13.5 GB, 3 -> 3.7 GB), so the band is honest rather
// than padded. The panel multiplies it out to warn before someone OOMs their
// box — which is exactly what `-P $(nproc)` used to do here.
const EXTRACT_WORKER_MIN_MB = 500;
const EXTRACT_WORKER_MAX_MB = 1400;
// Headroom the panel tells operators to leave. This plugin runs INSIDE a 5stack
// deployment, so the box is normally also serving the panel, its database and
// possibly game servers; an extraction that fits only by consuming every free
// page takes those down with it.
const PANEL_RESERVE_MB = 3072;
// One worker. The failure mode of guessing high is the operator's machine
// going down, so the default is the one that cannot do that.
const EXTRACT_JOBS_DEFAULT = 1;

function extractCores(): number {
  return Math.max(1, os.cpus().length || 1);
}

/** Node memory, for the panel's "N workers ≈ X GB of Y GB" warning. Reads
 *  /proc/meminfo first: under a cgroup os.freemem() reports the HOST's free
 *  pages, and MemAvailable is the number that actually predicts an OOM. */
async function machineMemoryMb(): Promise<{ totalMb: number | null; availableMb: number | null }> {
  try {
    const meminfo = await fs.readFile("/proc/meminfo", "utf8");
    const field = (name: string) => {
      const m = new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(meminfo);
      return m ? Math.round(Number(m[1]) / 1024) : null;
    };
    const totalMb = field("MemTotal");
    const availableMb = field("MemAvailable");
    if (totalMb) return { totalMb, availableMb };
  } catch {
    // Not Linux — fall through to the os module.
  }
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  return { totalMb: totalMb || null, availableMb: freeMb || null };
}

async function readExtractJobs(): Promise<number> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM inventory.settings WHERE key = 'extract_jobs'`,
  );
  const n = Number(rows[0]?.value);
  if (!Number.isInteger(n) || n < 1) return EXTRACT_JOBS_DEFAULT;
  return Math.min(n, extractCores());
}

/** Publish the count where the running script can see it. Best-effort: the
 *  script falls back to its own default if the file is missing or junk, so a
 *  failure here slows a run down, it doesn't break one. */
async function writeExtractJobsFile(jobs: number): Promise<void> {
  try {
    await fs.mkdir(MODELS_ROOT, { recursive: true });
    await fs.writeFile(EXTRACT_JOBS_FILE, `${jobs}\n`);
  } catch (e) {
    app.log.warn(`[extract-models] could not publish worker count: ${(e as Error).message}`);
  }
}

type ExtractState = {
  state: "idle" | "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  log: string;
};
const IDLE_STATE: ExtractState = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  log: "",
};

// Only one run at a time, and only this process can be running it — a child
// dies with its parent, so "running in the file" + "no child here" means a
// restart killed it (reported as `interrupted`, not a phantom `running`).
let extractChild: ChildProcess | null = null;
let extractLog: string[] = [];

async function readExtractState(): Promise<ExtractState> {
  try {
    const raw = await fs.readFile(EXTRACT_STATE_FILE, "utf8");
    const parsed = { ...IDLE_STATE, ...(JSON.parse(raw) as Partial<ExtractState>) };
    if (parsed.state === "running" && !extractChild) {
      return { ...parsed, state: "interrupted", error: "The backend restarted while extraction was running." };
    }
    return parsed;
  } catch {
    return IDLE_STATE; // never run, or the mount was wiped
  }
}

// ---- Pipeline version: is what's on the mount what this build expects? ------
// Two numbers. `extractVersion` is stamped into the models dir by the last
// successful run; `requiredVersion` is read out of the script we would run
// right now. Reading the script instead of hardcoding a constant here means
// there is exactly ONE place to bump (EXTRACT_VERSION in extract-models.sh) and
// the two can never drift apart in a release.
const EXTRACT_VERSION_FILE = path.join(MODELS_ROOT, "models", "extract-version.json");

// The CS2 build the game reports, from its steam.inf. `gameBuild` (ClientVersion)
// is the monotonic integer we compare on; the patch/date strings are for display.
interface GameVersion {
  gameBuild: number | null;
  gamePatch: string | null;
  gameDate: string | null;
}

// steam.inf is a plain Key=Value text file. Tolerant of missing keys / CRLF.
function parseSteamInf(text: string): GameVersion {
  const get = (key: string) => {
    const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const build = get("ClientVersion");
  return {
    gameBuild: build != null && /^\d+$/.test(build) ? Number(build) : null,
    gamePatch: get("PatchVersion"),
    gameDate: get("VersionDate"),
  };
}

async function readExtractVersion(): Promise<number | null> {
  return (await readExtractStamp()).version;
}

// The full stamp written by the last successful run: the pipeline version plus
// the CS2 build the assets were extracted against. Tolerant of old stamps that
// predate the game fields (they read back as null).
type ExtractStamp = {
  version: number | null;
  durationSeconds: number | null;
  steps: Record<string, number> | null;
  extractedAt: string | null;
} & GameVersion;
const EMPTY_STAMP: ExtractStamp = {
  version: null,
  gameBuild: null,
  gamePatch: null,
  gameDate: null,
  durationSeconds: null,
  steps: null,
  extractedAt: null,
};
async function readExtractStamp(): Promise<ExtractStamp> {
  try {
    const raw = await fs.readFile(EXTRACT_VERSION_FILE, "utf8");
    const p = JSON.parse(raw) as Partial<ExtractStamp>;
    return {
      version: typeof p.version === "number" ? p.version : null,
      gameBuild: typeof p.gameBuild === "number" ? p.gameBuild : null,
      gamePatch: typeof p.gamePatch === "string" ? p.gamePatch : null,
      gameDate: typeof p.gameDate === "string" ? p.gameDate : null,
      // Stamps written before v5 have neither — an absent duration reads as
      // "unknown", never as zero.
      durationSeconds: typeof p.durationSeconds === "number" ? p.durationSeconds : null,
      steps: p.steps && typeof p.steps === "object" ? (p.steps as Record<string, number>) : null,
      extractedAt: typeof p.extractedAt === "string" ? p.extractedAt : null,
    };
  } catch {
    return EMPTY_STAMP;
  }
}

// The build the mounted CS2 install reports right now — read live, so it reflects
// a Valve patch that landed after the last extract. Null fields when unmounted.
async function readCurrentGameVersion(): Promise<GameVersion> {
  const steamInf = path.join(CS2_DIR, "game", "csgo", "steam.inf");
  try {
    const raw = await fs.readFile(steamInf, "utf8");
    const parsed = parseSteamInf(raw);
    app.log.debug(
      `[game-version] read ${steamInf}: build=${parsed.gameBuild ?? "null"} patch=${parsed.gamePatch ?? "null"} date=${parsed.gameDate ?? "null"}`,
    );
    return parsed;
  } catch (e) {
    app.log.warn(`[game-version] could not read ${steamInf}: ${(e as Error).message}`);
    return { gameBuild: null, gamePatch: null, gameDate: null };
  }
}

async function readRequiredExtractVersion(): Promise<number | null> {
  const script = await resolveExtractScript();
  if (!script) return null;
  try {
    const src = await fs.readFile(script, "utf8");
    const m = src.match(/^EXTRACT_VERSION=(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// Anything extracted at all? An empty mount isn't stale — it's just a
// deployment that has never run this, which the panel already says plainly.
async function hasExtractedModels(): Promise<boolean> {
  try {
    const entries = await fs.readdir(path.join(MODELS_ROOT, "models"));
    return entries.some((e) => e !== "extract-version.json");
  } catch {
    return false;
  }
}

async function extractVersionInfo() {
  const [stamp, requiredVersion, extracted, current] = await Promise.all([
    readExtractStamp(),
    readRequiredExtractVersion(),
    hasExtractedModels(),
    readCurrentGameVersion(),
  ]);
  const { version: extractVersion, gameBuild, gamePatch, gameDate, durationSeconds, steps, extractedAt } = stamp;
  return {
    extractVersion,
    requiredVersion,
    extracted,
    // How long the last successful run took, and where it went. Surfaced so
    // "press this button" comes with an idea of what you're committing to.
    lastRunSeconds: durationSeconds,
    lastRunSteps: steps,
    // When it finished, per the script's own stamp. The state file's
    // `finishedAt` only exists if THIS process was still around to see the
    // child exit — a pod restart or a `node --watch` reload mid-run reparents
    // the script, which finishes and stamps itself while nobody writes the
    // state file. That read as "never · 7m 27s": no date, but a duration.
    lastRunAt: extractedAt,
    // CS2 build the assets were extracted against vs. what the install reports
    // now. `gameUpdated` is a soft, informational signal — it deliberately does
    // NOT feed `stale`/the re-extract badge, since most CS2 patches don't touch
    // weapon models. It's true whenever we have extracted assets and the live
    // build differs from the stamped one; a MISSING stamp (assets predate build
    // tracking) counts as "differs" too — we can't claim they're current, so we
    // surface it rather than silently assume they match.
    gameBuild,
    gamePatch,
    gameDate,
    currentGameBuild: current.gameBuild,
    currentGamePatch: current.gamePatch,
    currentGameDate: current.gameDate,
    gameUpdated: extracted && current.gameBuild != null && gameBuild !== current.gameBuild,
    // Three things all mean "an admin needs to press the button": nothing
    // extracted at all, output with no version stamp (pre-versioning), and
    // output behind this build's pipeline. `extracted` tells them apart for
    // the wording; the flag itself is what lights the badge.
    //
    // Gated on knowing requiredVersion: if the script can't be resolved there
    // is no re-run to ask for, so nagging would be pointless.
    stale: requiredVersion !== null && (!extracted || (extractVersion ?? 0) < requiredVersion),
  };
}

async function writeExtractState(next: ExtractState) {
  try {
    await fs.mkdir(MODELS_ROOT, { recursive: true });
    await fs.writeFile(EXTRACT_STATE_FILE, JSON.stringify(next, null, 2));
  } catch (e) {
    app.log.error(`[extract-models] could not persist state: ${(e as Error).message}`);
  }
}

// A run outlives the process that started it: the bash child is reparented when
// node restarts (which `node --watch` does on every edit), so `extractChild`
// being null does NOT mean nothing is running. Without this, a restart during a
// run starts a SECOND extraction writing to the same mount — observed once.
const EXTRACT_LOCK_FILE = path.join(MODELS_ROOT, "extract.lock");

// Written by the script as it works (see its `progress` helper). Read rather
// than parsed out of the child's stdout so it still works for a run this process
// didn't start, and survives `node --watch` restarting us mid-run.
const EXTRACT_PROGRESS_FILE = path.join(MODELS_ROOT, "extract-progress.json");
type ExtractStep = {
  name: string;
  state: "pending" | "running" | "done";
  done?: number;
  total?: number;
  seconds?: number;
  /** Epoch seconds the step went running. Lets the panel show elapsed + an ETA
   *  for the step in flight, which is the only thing that distinguishes a long
   *  step from a wedged one. */
  started?: number;
};
type ExtractProgress = { steps: ExtractStep[]; at: string };
async function readExtractProgress(): Promise<ExtractProgress | null> {
  try {
    const p = JSON.parse(await fs.readFile(EXTRACT_PROGRESS_FILE, "utf8")) as Partial<ExtractProgress>;
    if (!Array.isArray(p.steps)) return null;
    const steps = p.steps.flatMap((s): ExtractStep[] => {
      if (!s || typeof s.name !== "string") return [];
      const state = s.state === "running" || s.state === "done" ? s.state : "pending";
      return [{
        name: s.name,
        state,
        ...(typeof s.done === "number" ? { done: s.done } : {}),
        ...(typeof s.total === "number" ? { total: s.total } : {}),
        ...(typeof s.seconds === "number" ? { seconds: s.seconds } : {}),
        // This projection is a WHITELIST — a field the script starts writing is
        // dropped here until it is named, silently and with no type error, and
        // the UI just renders nothing. That is exactly how `started` went
        // missing after the script and the panel were both already correct.
        ...(typeof s.started === "number" ? { started: s.started } : {}),
      }];
    });
    return { steps, at: typeof p.at === "string" ? p.at : "" };
  } catch {
    return null;
  }
}

/** A token that changes whenever the extracted assets might have. Paint MATERIAL
 *  filenames are fixed by cs2-lib, so their URLs can't self-version the way our
 *  content-hashed textures do — a client that cached one kept pointing at
 *  texture names a later run had replaced. Hanging this on the URL gives those
 *  files a version to bust on, so they can be cached hard again.
 *
 *  Built from the pipeline version, the CS2 build and when the run finished:
 *  re-running the SAME pipeline can still change output (a game patch, or a
 *  half-finished previous run), so the timestamp has to be in it. */
async function assetVersion(): Promise<string> {
  const { version, gameBuild, extractedAt } = await readExtractStamp();
  const stamp = extractedAt ? Date.parse(extractedAt) : NaN;
  return [version ?? 0, gameBuild ?? 0, Number.isFinite(stamp) ? Math.floor(stamp / 1000) : 0].join("-");
}

/** PID of a still-live extraction, or null.
 *
 *  A bare "does this pid exist" check is NOT enough: the lock lives on the
 *  mount, which outlives the pod, and pids restart from 1 in a new container.
 *  A stale lock naming pid 66 would then match some unrelated process and
 *  report a phantom run forever, blocking every future extraction. So confirm
 *  the process is actually our script before believing the lock. */
async function liveExtractionPid(): Promise<number | null> {
  try {
    const { pid } = JSON.parse(await fs.readFile(EXTRACT_LOCK_FILE, "utf8")) as { pid?: number };
    if (typeof pid !== "number") return null;
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    // No /proc (non-Linux dev box): fall back to trusting the pid, since the
    // pod-restart collision this guards against can't happen there anyway.
    if (cmdline && !cmdline.includes("extract-models")) {
      await fs.rm(EXTRACT_LOCK_FILE, { force: true }).catch(() => {});
      return null;
    }
    return pid;
  } catch {
    return null; // no lock, unreadable, or the pid is gone (ESRCH)
  }
}

/** Create the lock exclusively. Returns why it failed rather than throwing, and
 *  clears a lock whose owner is gone so a killed run can't wedge this forever. */
async function acquireExtractLock(): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const attempt of [0, 1]) {
    try {
      const fh = await fs.open(EXTRACT_LOCK_FILE, "wx");
      await fh.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await fh.close();
      return { ok: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        return { ok: false, error: `Could not claim the extraction lock: ${(e as Error).message}` };
      }
      const owner = await liveExtractionPid();
      if (owner !== null) {
        return { ok: false, error: `Extraction is already running (pid ${owner}).` };
      }
      // Owner is gone — a killed run, or a pod restart that left the file
      // behind. Clear it here rather than relying on liveExtractionPid, which
      // only unlinks when the pid belongs to some OTHER process; a pid that
      // simply no longer exists would otherwise wedge extraction forever.
      await fs.rm(EXTRACT_LOCK_FILE, { force: true }).catch(() => {});
      if (attempt === 1) return { ok: false, error: "Extraction lock is held by a process that no longer exists." };
    }
  }
  return { ok: false, error: "Could not claim the extraction lock." };
}

/** Launch the extraction. Returns an error shape instead of throwing so both
 *  the admin route and the boot-time auto-run can report it their own way. */
async function startExtraction(): Promise<{ started: true } | { code: number; error: string }> {
  if (extractChild) return { code: 409, error: "Extraction is already running." };
  // Claim the lock ATOMICALLY, before any of the async checks below. A
  // check-then-write lock is a race: the admin pressing the button and the
  // boot auto-run both passed the "is anything running?" test and spawned two
  // extractions a second apart, both writing the same mount. `wx` makes the
  // create fail if the file exists, so exactly one caller can win.
  const claimed = await acquireExtractLock();
  if (!claimed.ok) return { code: 409, error: claimed.error };
  // From here on, any early return must release the lock or nothing will ever
  // run again.
  const fail = async (code: number, error: string) => {
    await fs.rm(EXTRACT_LOCK_FILE, { force: true }).catch(() => {});
    return { code, error };
  };

  // Fail loudly up front rather than spawning something that can't work: these
  // two paths are exactly what the deployment has to mount.
  const vpk = path.join(CS2_DIR, "game", "csgo", "pak01_dir.vpk");
  if (!(await fs.access(vpk).then(() => true, () => false))) {
    return await fail(
      412,
      `CS2 install not readable at ${CS2_DIR} (looked for game/csgo/pak01_dir.vpk). Mount the game dir into the backend and/or set CS2_DIR.`,
    );
  }
  const script = await resolveExtractScript();
  if (!script) {
    return await fail(
      412,
      `Extraction script not found. Looked in: ${EXTRACT_SCRIPT_CANDIDATES.join(", ")} (override with EXTRACT_SCRIPT).`,
    );
  }

  const startedAt = new Date().toISOString();
  extractLog = [];
  await fs.mkdir(MODELS_ROOT, { recursive: true }).catch(() => {});
  // Truncates: only the latest run is kept, which is the one anyone asks about.
  const logStream = createWriteStream(EXTRACT_LOG_FILE, { flags: "w" });
  logStream.on("error", (e) => app.log.error(`[extract-models] log file: ${e.message}`));
  logStream.write(`# extract-models started ${startedAt}\n`);
  // Scratch defaults onto the models mount: it's already there, it's real node
  // disk with room, and the raw decompile pass is several GB.
  const workDir = process.env.EXTRACT_WORK_DIR ?? path.join(MODELS_ROOT, ".work");
  // Publish the worker count before the script can read it, so a run always
  // starts on the operator's setting rather than the script's own default.
  const jobs = await readExtractJobs();
  await writeExtractJobsFile(jobs);
  // Deliberately NOT detached: a run is tied to the process that started it, so
  // restarting the backend stops it. Simple and predictable — the alternative
  // leaves orphaned multi-GB jobs nobody is tracking.
  const child = spawn("bash", [script], {
    env: {
      ...process.env,
      CS2_DIR,
      OUT_DIR: MODELS_ROOT,
      WORK_DIR: workDir,
      EXTRACT_JOBS: String(jobs),
      EXTRACT_JOBS_FILE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  extractChild = child;
  // Record the CHILD's pid in the lock we already hold — it is the thing that
  // survives a restart of this process.
  await fs.writeFile(EXTRACT_LOCK_FILE, JSON.stringify({ pid: child.pid, startedAt })).catch(() => {});
  app.log.info(`[extract-models] started: pid=${child.pid} script=${script} CS2_DIR=${CS2_DIR} OUT_DIR=${MODELS_ROOT} WORK_DIR=${workDir}`);
  await writeExtractState({ ...IDLE_STATE, state: "running", startedAt });

  // Everything goes to the file; only the tail is kept in memory, since that's
  // all the status panel renders.
  const absorb = (chunk: Buffer) => {
    logStream.write(chunk);
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim()) extractLog.push(line);
    }
    if (extractLog.length > EXTRACT_LOG_LINES) extractLog = extractLog.slice(-EXTRACT_LOG_LINES);
  };
  child.stdout?.on("data", absorb);
  child.stderr?.on("data", absorb);

  const settle = async (exitCode: number | null, error: string | null) => {
    if (extractChild !== child) return; // superseded; ignore late events
    extractChild = null;
    await fs.rm(EXTRACT_LOCK_FILE, { force: true }).catch(() => {});
    const ok = exitCode === 0 && !error;
    app.log.info(`[extract-models] finished: exit=${exitCode} error=${error ?? "none"}`);
    logStream.end(`# extract-models finished ${new Date().toISOString()} exit=${exitCode}${error ? ` error=${error}` : ""}\n`);
    if (ok) {
      // The raw decompile output is several GB and lives on the same disk that
      // serves the models — drop it, but keep cli/ so a re-run doesn't
      // re-download Source2Viewer. Failures keep raw/ around for debugging.
      const work = path.join(workDir, "cs2-model-extract");
      for (const dir of ["raw", "raw_ci"]) {
        await fs.rm(path.join(work, dir), { recursive: true, force: true }).catch(() => {});
      }
      // Card bakes are keyed on the extraction version (see renderKeyForRow), so
      // a run that bumped it has just orphaned the whole previous generation.
      // Only after `ok`: a failed run leaves the stamp alone, and sweeping on the
      // strength of a half-written mount would delete cards nothing replaces.
      const swept = await pruneRenders();
      if (swept) app.log.info(`[extract-models] pruned ${swept} superseded card render(s)`);
    }
    await writeExtractState({
      state: ok ? "succeeded" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      error,
      log: extractLog.join("\n"),
    });
  };
  child.on("error", (e) => void settle(null, e.message));
  child.on("close", (code) => void settle(code, null));

  return { started: true };
}

app.post("/api/admin/extract-models", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const result = await startExtraction();
  if ("code" in result) return reply.status(result.code).send({ error: result.error });
  return result;
});

// Self-heal on boot. A mount that is empty or behind the pipeline means blank
// item art and white skins — there is nothing an admin would do about it except
// press the button, so press it for them. Set INVENTORY_AUTO_EXTRACT=0 to
// disable (e.g. a node where the ~30 minute run is unwelcome at startup).
async function autoExtractIfStale() {
  if (process.env.INVENTORY_AUTO_EXTRACT === "0") return;
  try {
    const info = await extractVersionInfo();
    if (!info.stale) return;
    // Already running, started by a process that has since been replaced —
    // `node --watch` restarts on every edit, and without this the auto-run
    // stacks a second extraction on top of the live one.
    const running = await liveExtractionPid();
    if (running !== null) {
      app.log.info(`[extract-models] already running (pid ${running}) — not auto-starting another`);
      return;
    }
    // A previous run that FAILED is not something to retry on every restart —
    // a crash-looping pod would spawn a multi-GB job each time, and the failure
    // wants a human. Manual re-run still works.
    const prior = await readExtractState();
    if (prior.state === "failed") {
      app.log.warn("[extract-models] mount is stale but the last run failed — not auto-running; re-run it from the panel");
      return;
    }
    app.log.info(
      `[extract-models] mount is stale (has v${info.extractVersion ?? "none"}, script produces v${info.requiredVersion}) — starting automatically`,
    );
    const result = await startExtraction();
    if ("code" in result) {
      app.log.warn(`[extract-models] auto-run could not start: ${result.error}`);
    }
  } catch (e) {
    app.log.warn(`[extract-models] auto-run check failed: ${(e as Error).message}`);
  }
}

app.get("/api/admin/extract-models", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const stored = await readExtractState();
  // A run can be owned by a process we replaced, so "is it running" is the lock,
  // not just our own child handle.
  const live = extractChild != null || (await liveExtractionPid()) !== null;
  const status = live ? { ...stored, state: "running" as const, log: extractLog.join("\n") } : stored;
  const logBytes = await fs.stat(EXTRACT_LOG_FILE).then((s) => s.size, () => 0);
  const progress = live ? await readExtractProgress() : null;
  return {
    available: true as const,
    ...status,
    logBytes,
    progress,
    workers: await extractWorkerInfo(),
    ...(await extractVersionInfo()),
  };
});

/** Everything the panel needs to choose a worker count and be warned about it:
 *  the setting, what the box has, and what a worker costs at each end of the
 *  measured range. */
async function extractWorkerInfo() {
  const { totalMb, availableMb } = await machineMemoryMb();
  return {
    jobs: await readExtractJobs(),
    cores: extractCores(),
    perWorkerMinMb: EXTRACT_WORKER_MIN_MB,
    perWorkerMaxMb: EXTRACT_WORKER_MAX_MB,
    panelReserveMb: PANEL_RESERVE_MB,
    memTotalMb: totalMb,
    memAvailableMb: availableMb,
  };
}

// Changing this DURING a run is the intended path, not an edge case: the script
// re-reads the file every couple of seconds, so more workers start within one
// tick. Fewer never kills a worker mid-model — the pool just stops refilling
// until it has drained to the new number.
app.put<{ Body: { jobs?: number } }>("/api/admin/extract-models/jobs", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  const cores = extractCores();
  const raw = Number(request.body?.jobs);
  if (!Number.isInteger(raw) || raw < 1 || raw > cores) {
    return reply.status(400).send({ error: `jobs must be a whole number between 1 and ${cores}.` });
  }
  await pool.query(
    `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('extract_jobs', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(raw)],
  );
  await writeExtractJobsFile(raw);
  return { workers: await extractWorkerInfo() };
});

// Full log as a download — the panel only ever shows the tail, and the
// interesting failures (shader/texture exceptions) scroll past it.
app.get("/api/admin/extract-models/log", async (request, reply) => {
  const denied = await requireAdmin(request);
  if (denied) return reply.status(denied.code).send({ error: denied.error });
  let data: Buffer;
  try {
    data = await fs.readFile(EXTRACT_LOG_FILE);
  } catch {
    return reply.status(404).send({ error: "No extraction log yet — run an extraction first." });
  }
  return reply
    .header("Content-Type", "text/plain; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="extract-models.log"`)
    .send(data);
});

app.get("/api/admin/server-api-key", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  if (identity.role !== "administrator") {
    return reply.status(403).send({ error: "Only administrators can manage the server API key." });
  }
  const key = await getServerApiKey();
  let cfg: { updated: string[]; failed: string[] } | null = null;
  if (key) {
    const url = await resolveInvsimUrl(request);
    if (url) cfg = await syncGameConfigs(url, key);
  }
  return { key, cfg };
});

app.post("/api/admin/server-api-key", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  if (identity.role !== "administrator") {
    return reply.status(403).send({ error: "Only administrators can manage the server API key." });
  }
  const key = `inv_${randomBytes(24).toString("hex")}`;
  await pool.query(
    `INSERT INTO inventory.settings (key, value, updated_at) VALUES ('server_api_key', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key],
  );
  let cfg: { updated: string[]; failed: string[] } | null = null;
  const url = await resolveInvsimUrl(request);
  if (url) cfg = await syncGameConfigs(url, key);
  return { key, cfg };
});

// ---- Game-server API (ianlucas/cs2-css-inventory-simulator compatible) ------
// The CS2 server plugin polls this for a player's equipped loadout. Public by
// design (game servers can't do Steam forward-auth), same as upstream.

const TEAM_BYTE: Record<string, string> = { T: "2", CT: "3" };

/**
 * One entry in the v5 feed. Field-for-field the shape upstream documents in
 * docs/api.md and the plugin deserialises in `src/Models/InventoryItem.cs`; a
 * name that doesn't match is a field the game server silently drops.
 *
 * `charges` is deliberately never set. It is how upstream makes graffiti a
 * consumable (50 sprays, then the item is gone), and the plugin reads a MISSING
 * charges as "unlimited" — `ConsumeGraffitiCharge` returns before it decrements
 * or POSTs anything. That is what we want here: this is a loadout sandbox, not
 * an economy, so there is nothing to spend and no /api/consume-item-spray to
 * implement. It stays on the interface so the omission reads as a decision.
 */
interface EquippedItem {
  charges?: number;
  def?: number;
  paint?: number;
  seed?: number | null;
  wear?: number | null;
  stattrak?: number;
  nametag?: string;
  stickers?: { def: number; slot: number; wear: number; x?: number; y?: number; rotation?: number }[];
  keychains?: { def: number; seed: number; slot: number; sticker?: number; x?: number; y?: number; z?: number }[];
  musicId?: number;
  tint?: number;
  uid?: number;
  hash?: string;
}

/**
 * `hash` is the plugin's ONLY change-detection signal.
 *
 * `InventoryItem.Equals` compares nothing but this string, and RegiveAgent /
 * RegiveGloves / RegiveWeapons all bail on `oldItem == item`. So a field that
 * the hash doesn't cover is a field that `!ws` cannot apply without a respawn —
 * which is what happened while the hash was a hand-rolled
 * `uid:item:seed:wear:stattrak`: re-stickering a rifle or swapping its charm
 * changed the payload and not the hash, so the refresh looked broken.
 *
 * Hashing the WHOLE entry is what upstream does (hash-object, truncated to 7),
 * and it can't drift out of step with the fields as they're added. Key order is
 * normalised because ours are built in a different order per item type.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function hashed<T extends EquippedItem>(entry: T): T {
  entry.hash = createHash("sha1").update(stableStringify(entry)).digest("hex").slice(0, 7);
  return entry;
}

function equippedStickers(specs?: unknown[] | null) {
  const out: NonNullable<EquippedItem["stickers"]> = [];
  normSpecs(specs).forEach((spec, slot) => {
    if (!spec) return;
    const kit = getItem(spec.id)?.index;
    if (kit == null) return;
    // Always emit `wear`, even at 0 — the plugin skips the "sticker slot N
    // wear" attribute when it's absent, and an explicit 0 keeps pristine
    // stickers behaving exactly as they did before wear existed.
    const entry: (typeof out)[number] = { def: kit as number, slot, wear: spec.w ?? 0 };
    if (spec.x != null) entry.x = spec.x;
    if (spec.y != null) entry.y = spec.y;
    if (spec.r != null) entry.rotation = spec.r;
    out.push(entry);
  });
  // An empty ARRAY, not undefined: upstream always sends one, and the plugin
  // reads it as "no sticker attributes" either way. Keeping the field present
  // also keeps it inside the hash for an item whose last sticker was removed.
  return out;
}

app.get<{ Params: { steamId: string } }>("/api/equipped/v5/:steamId", async (request, reply) => {
  const steamId = request.params.steamId.replace(/\.json$/, "");
  if (!/^\d{17}$/.test(steamId)) {
    return reply.status(400).send({ error: "invalid steam id" });
  }
  const { rows } = await pool.query<{
    team: string;
    slot: string;
    uid: string | null;
    item_id: number | null;
    wear: number | null;
    seed: number | null;
    stattrak: boolean;
    stattrak_count: number | null;
    nametag: string | null;
    stickers: unknown[] | null;
    patches: unknown[] | null;
    charm_id: number | null;
    charm_offset: { x?: number; y?: number; z?: number; seed?: number } | null;
  }>(
    `SELECT l.team, l.slot, i.id AS uid, i.item_id, i.wear, i.seed, i.stattrak,
            i.stattrak_count, i.nametag, i.stickers, i.patches, i.charm_id, i.charm_offset
     FROM inventory.loadout l
     JOIN inventory.owned_items i ON i.id = l.item_instance_id
     WHERE l.steam_id = $1`,
    [steamId],
  );
  // THE feed the CS2 server applies, so the link has to be dereferenced here of
  // all places — an unresolved spec would send the game the stale inline
  // scratch while every screen in the panel showed the sticker's real one.
  const equippedRows = await withAttachments(steamId, rows);

  const out = {
    agents: {} as Record<string, EquippedItem>,
    collectible: undefined as EquippedItem | undefined,
    ctWeapons: {} as Record<string, EquippedItem>,
    tWeapons: {} as Record<string, EquippedItem>,
    gloves: {} as Record<string, EquippedItem>,
    knives: {} as Record<string, EquippedItem>,
    musicKit: undefined as EquippedItem | undefined,
    graffiti: undefined as EquippedItem | undefined,
  };

  for (const row of equippedRows) {
    const item = getItem(row.item_id as number);
    if (!item) continue;
    const uid = Number(row.uid);
    // -1 is the plugin's "StatTrak-capable but not counting" sentinel: it only
    // writes the "kill eater" attribute for a value ABOVE -1, so this is how a
    // non-StatTrak item says so out loud rather than by omission.
    const stattrak = row.stattrak ? row.stattrak_count ?? 0 : -1;
    const nametag = row.nametag ?? "";
    const teamByte = TEAM_BYTE[row.team];

    if (row.slot === "agent") {
      out.agents[teamByte] = hashed({
        def: item.def as number | undefined,
        stickers: equippedStickers(row.patches), // patches apply via sticker slots
      });
    } else if (row.slot === "knife") {
      out.knives[teamByte] = hashed({
        def: item.def as number | undefined,
        nametag,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        stattrak,
        stickers: [],
        uid,
        wear: row.wear ?? 0,
      });
    } else if (row.slot === "gloves") {
      out.gloves[teamByte] = hashed({
        def: item.def as number | undefined,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        wear: row.wear ?? 0,
      });
    } else if (row.slot === "musickit") {
      // hashed(), like every other entry. These three were the only ones built
      // without it, which left them with NO change-detection signal at all:
      // InventoryItem.Equals compares the hash and nothing else, so an absent
      // hash means swapping your music kit could not be applied by !ws.
      out.musicKit = hashed({ musicId: item.index as number | undefined, stattrak, uid });
    } else if (row.slot === "collectible") {
      // Pins and medals carry nothing but their defindex — no paint, no wear,
      // no uid to increment. The plugin hangs it off the player as-is.
      out.collectible = hashed({ def: item.def as number | undefined });
    } else if (row.slot === "graffiti") {
      out.graffiti = hashed({
        def: item.index as number | undefined,
        // `?? 0`, NOT the raw field. 438 of the 2,205 graffiti carry no tint at
        // all, and the plugin's SprayGraffiti() returns early when Tint is null —
        // so an omitted tint didn't mean "untinted", it meant the spray silently
        // did nothing for one graffiti in five.
        tint: (item.tint as number | undefined) ?? 0,
        uid,
      });
    } else {
      // Weapon positions incl. zeus/c4 — keyed by weapon def index.
      if (item.def == null) continue;
      const entry: EquippedItem = {
        def: item.def as number,
        nametag,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        stattrak,
        stickers: equippedStickers(row.stickers),
        keychains: [],
        uid,
        wear: row.wear ?? 0,
      };
      const charm = row.charm_id != null ? getItem(row.charm_id) : null;
      if (charm?.index != null) {
        const keychain: NonNullable<EquippedItem["keychains"]>[number] = {
          def: charm.index as number, seed: row.charm_offset?.seed ?? 0, slot: 0,
        };
        // A Sticker Slab is one model wearing one sticker, and 10.5k of the
        // 10.6k charms are slabs — the charm's own def only picks the slab, so
        // without this every slab in the game arrived as the same blank hanger.
        if (charm.stickerIndex != null) keychain.sticker = charm.stickerIndex;
        if (row.charm_offset?.x != null) keychain.x = row.charm_offset.x;
        if (row.charm_offset?.y != null) keychain.y = row.charm_offset.y;
        if (row.charm_offset?.z != null) keychain.z = row.charm_offset.z;
        entry.keychains = [keychain];
      }
      hashed(entry);
      const bucket = row.team === "CT" ? out.ctWeapons : out.tWeapons;
      bucket[String(item.def)] = entry;
    }
  }
  return out;
});

// StatTrak kill counting from the game server. Guarded by the panel-generated
// server API key (Settings → generate; set the same value as `invsim_apikey`
// on the CS2 server plugin). INVSIM_API_KEY env acts as an override for dev.
app.post<{ Body: { apiKey?: string; targetUid?: number; userId?: string } }>(
  "/api/increment-item-stattrak",
  async (request, reply) => {
    const key = await getServerApiKey();
    const { apiKey, targetUid, userId } = request.body;
    if (!key || apiKey !== key) {
      return reply.status(401).send({ error: "invalid api key" });
    }
    if (targetUid == null || !userId || !/^\d{17}$/.test(userId)) {
      return reply.status(400).send({ error: "targetUid and userId required" });
    }
    const { rowCount } = await pool.query(
      `UPDATE inventory.owned_items
       SET stattrak_count = stattrak_count + 1
       WHERE id = $1 AND steam_id = $2 AND stattrak`,
      [targetUid, userId],
    );
    return {};
  },
);

app.get("/healthz", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);

async function start() {
  // CORS handled in the app (like the 5stack api's enableCors) — reflects the
  // requesting origin and allows credentials, so the panel (any origin/site) can
  // call the API without any ingress config.
  const cors = (await import("@fastify/cors")).default;
  await app.register(cors, { origin: true, credentials: true });
  await applySchema();
  await dropImpossibleScalars();
  await app.listen({ port, host: "0.0.0.0" });
  // Agent patch-slot counts, so the synchronous getItem() can answer. Fire and
  // forget: a cold cache reads as "unknown", the form falls back to five slots
  // for a moment, and the next request is right — far better than delaying
  // listen() on 63 file reads.
  void warmPatchSlots(getAgents().map((a) => a.model).filter((m): m is string => !!m));
  void autoExtractIfStale();
  // Prices: warm the index off the mirror already in Postgres, then keep it
  // fresh on the hour. Both fire-and-forget — pricing is an enhancement, and a
  // slow or unreachable feed must never hold up listen() or a single request.
  void syncPriceAliases()
    .then((n) => app.log.info(`[prices] ${n} catalog ids aliased onto their price group`))
    .catch((error) => app.log.warn(`[prices] alias rebuild failed — ${(error as Error).message}`));
  schedulePriceSync();
  // Freshness marker: node --watch in this container is event-based and quietly
  // misses synced edits, so "my change did nothing" is usually "the process is
  // still on old code".
  //
  // Reports the NEWEST source file, not main.ts. It used to stat only itself,
  // which reads as fresh whenever the edit landed anywhere else — and most of
  // them do (catalog.ts, stickerMarkup.ts). Worse, the documented workaround for
  // a missed reload was "touch main.ts", which cannot work: Mutagen syncs
  // CONTENT, so a touch never crosses into the container at all. Naming the file
  // makes both failures obvious.
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const stamps = await Promise.all(
      (await fs.readdir(dir))
        .filter((f) => f.endsWith(".ts"))
        .map(async (f) => ({ f, mtime: (await fs.stat(path.join(dir, f))).mtime })),
    );
    const newest = stamps.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
    if (newest) {
      app.log.info(`[boot] newest source: ${newest.f} ${newest.mtime.toISOString()}`);
    }
  } catch {
    /* bundled/compiled — no source to stat */
  }
  // Push the invsim block into the game type configs on boot so a deploy alone
  // fixes them — no admin visit required. Needs a key and a known public URL
  // (INVSIM_URL env, or remembered from a previous admin request).
  try {
    const key = await getServerApiKey();
    const url = await resolveInvsimUrl();
    if (key && url) await syncGameConfigs(url, key);
    else app.log.info(`[invsim-cfg] startup sync skipped (key: ${!!key}, url: ${url ?? "unknown"})`);
  } catch (error) {
    app.log.error({ err: error }, "[invsim-cfg] startup sync failed");
  }
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
