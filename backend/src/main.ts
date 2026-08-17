import { readFileSync, createWriteStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { LogController } from "fastify";
import { pool } from "./db.ts";
import { getIdentity } from "./identity.ts";
import { buildInspectLink, type InspectSticker } from "./inspect.ts";
import {
  getStickerMarkup,
  getCharmMarkup,
  charmBounds,
  getCharmModels,
  getCharmShading,
  getPatchMaterials,
} from "./stickerMarkup.ts";
import { patchSlotsFor, warmPatchSlots } from "./agentPatchSlots.ts";
import {
  getWeapons,
  getDefaults,
  getWeaponSkins,
  getAgents,
  getKnives,
  getGloves,
  getMusicKits,
  getCollectibles,
  searchAttachments,
  type AttachKind,
  type AttachQuery,
  type AttachSort,
  getGraffiti,
  getItemsByIds,
  getItem,
  getItemIdByName,
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
const ASSET_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};
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
    try {
      const buf = await fs.readFile(path.join(dir, rel));
      // Two very different lifetimes behind one route:
      //
      //  - TEXTURES and ICONS carry a content hash in the filename, so a given
      //    URL never changes meaning. Cache them hard.
      //  - MATERIAL JSON does NOT: the filename comes from cs2-lib and is fixed,
      //    while the content (and the texture names it points at) is rewritten
      //    by every extraction. Caching those for a day meant a browser kept a
      //    material referencing textures the new run had renamed — every one
      //    404'd and the skin rendered white long after the mount was correct.
      //
      // So a material is only immutable once the client has stamped the
      // extraction version on it (see withAssetVersion). Unversioned requests
      // still revalidate, which keeps old clients and hand-typed URLs correct.
      const versioned = (request.query as { v?: string } | undefined)?.v != null;
      const immutable = type !== "application/json" || versioned;
      reply.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
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
    charmQuads,
    charmBounds: charmBounds(charmQuads),
    charmBoundsLegacy: charmBounds(charmQuads, "body_legacy"),
  };
});

app.get<{ Querystring: { slot?: string } }>(
  "/api/catalog/skins",
  async (request, reply) => {
    const slot = request.query.slot;
    if (!slot) {
      return reply.status(400).send({ error: "slot required" });
    }
    if (slot === "knife") {
      return { base: null, skins: getKnives() };
    }
    if (slot === "gloves") {
      return { base: null, skins: getGloves() };
    }
    if (slot === "agent") {
      return { base: null, skins: getAgents() };
    }
    if (slot === "musickit") {
      return { base: null, skins: getMusicKits() };
    }
    if (slot === "collectible") {
      return { base: null, skins: getCollectibles() };
    }
    if (slot === "graffiti") {
      // Spreads the sheet's facet metadata (groups, tints) alongside `skins` —
      // graffiti is the one catalog whose splits aren't in any item field.
      return { base: null, ...getGraffiti() };
    }
    if (slot === "zeus") {
      return getWeaponSkins("taser");
    }
    if (slot === "c4") {
      return getWeaponSkins("c4");
    }
    return getWeaponSkins(slot);
  },
);

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
      `SELECT id, item_id, wear, seed, stattrak, stattrak_count, nametag, stickers, charm_id, charm_offset, patches, origin
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
  return rows
    .filter((row) => row.item_id != null)
    .map((row) => ({ ...row, item: getItem(row.item_id as number) }));
});

// ---- CS2-style positional slots (v2) ----
// sp = starting pistol, p1-p4 = other pistols, m1-m5 = mid-tier (SMGs +
// shotguns + LMGs), r1-r5 = rifles (incl. snipers), plus knife/gloves/agent.
// KEEP IN STEP WITH the slot whitelist in schema.sql — that DELETE runs on every
// boot, so a slot this accepts and that list omits is wiped on the next restart.
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(UPSERT_LOADOUT, upsertParams(identity.steamId, team, ra));
    await client.query(UPSERT_LOADOUT, upsertParams(identity.steamId, team, rb));
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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

// ---- Public loadout view + copy (player profiles / sharing) -----------------

// Read-only view of any player's loadout (enriched like /api/loadout, but
// without inventory instance ids). Public: loadouts are cosmetic + shareable.
app.get<{ Params: { steamId: string } }>("/api/loadout/:steamId", async (request, reply) => {
  const steamId = request.params.steamId;
  if (!/^\d{17}$/.test(steamId)) {
    return reply.status(400).send({ error: "invalid steam id" });
  }
  const { rows } = await pool.query<{
    team: string; slot: string; item_id: number | null; skinned: boolean;
    wear: number | null; seed: number | null; stattrak: boolean; nametag: string | null;
  }>(
    `SELECT l.team, l.slot,
       COALESCE(i.item_id, l.item_id) AS item_id,
       (l.item_instance_id IS NOT NULL) AS skinned,
       COALESCE(i.wear, l.wear) AS wear, COALESCE(i.seed, l.seed) AS seed,
       COALESCE(i.stattrak, l.stattrak) AS stattrak, COALESCE(i.nametag, l.nametag) AS nametag
     FROM inventory.loadout l
     LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
     WHERE l.steam_id = $1`,
    [steamId],
  );
  // The instance id stays null — it is someone else's row handle and a viewer
  // has no business acting on it. `skinned` carries the one bit the client
  // actually needed from it: crafted skin vs. free default weapon. Without it a
  // viewer saw every cell as unskinned, so names read "Default" and the focus
  // view fell back to the base model even though the art was right.
  return rows
    .filter((row) => row.item_id != null)
    .map((row) => ({ ...row, item_instance_id: null, item: getItem(row.item_id as number) }));
});

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
      stickers: (number | null)[] | null; patches: (number | null)[] | null; charm_id: number | null;
    }>(
      `SELECT l.team, l.slot, l.item_id AS base_item_id, i.item_id, i.wear, i.seed,
              i.stattrak, i.nametag, i.stickers, i.patches, i.charm_id
       FROM inventory.loadout l
       LEFT JOIN inventory.owned_items i ON i.id = l.item_instance_id
       WHERE l.steam_id = $1`,
      [source],
    );
    let copied = 0;
    for (const row of rows) {
      if (row.item_id != null) {
        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO inventory.owned_items
             (steam_id, item_id, wear, seed, stattrak, nametag, stickers, patches, charm_id, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'copied') RETURNING id`,
          [
            identity.steamId, row.item_id, row.wear, row.seed, row.stattrak, row.nametag,
            row.stickers?.some((x) => x != null) ? JSON.stringify(row.stickers) : null,
            row.patches?.some((x) => x != null) ? JSON.stringify(row.patches) : null,
            row.charm_id,
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
    const [renders, paints, images, models, composites] = await Promise.all([
      dirStats(RENDERS_DIR),
      dirStats(PAINTS_DIR, classifyPaintFile),
      dirStats(IMAGES_DIR),
      dirStats(modelsDir, classifyModelFile),
      // Client-baked, self-invalidating and LRU-trimmed, so it needs no
      // attention — but it is the one directory here that grows from ordinary
      // use rather than from an extraction, so an operator watching disk should
      // be able to see it.
      dirStats(COMPOSITES_DIR),
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
      out.musicKit = { musicId: item.index as number | undefined, stattrak, uid };
    } else if (row.slot === "collectible") {
      // Pins and medals carry nothing but their defindex — no paint, no wear,
      // no uid to increment. The plugin hangs it off the player as-is.
      out.collectible = { def: item.def as number | undefined };
    } else if (row.slot === "graffiti") {
      out.graffiti = {
        def: item.index as number | undefined,
        // `?? 0`, NOT the raw field. 438 of the 2,205 graffiti carry no tint at
        // all, and the plugin's SprayGraffiti() returns early when Tint is null —
        // so an omitted tint didn't mean "untinted", it meant the spray silently
        // did nothing for one graffiti in five.
        tint: (item.tint as number | undefined) ?? 0,
        uid,
      };
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
    await pool.query(
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
