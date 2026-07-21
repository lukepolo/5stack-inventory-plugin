import { readFileSync, createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify, { LogController } from "fastify";
import { pool } from "./db.ts";
import { getIdentity } from "./identity.ts";
import { buildInspectLink, type InspectSticker } from "./inspect.ts";
import { getStickerMarkup } from "./stickerMarkup.ts";
import {
  getWeapons,
  getDefaults,
  getWeaponSkins,
  getAgents,
  getKnives,
  getGloves,
  getMusicKits,
  getStickers,
  getCharms,
  getPatches,
  getGraffiti,
  getItemsByIds,
  getItem,
  getItemIdByName,
  getItemIdBySteamName,
  slotForItem,
  isBaseWeapon,
  getStickerBounds,
  getRenderTestCatalog,
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

const TEAMS = new Set(["CT", "T"]);

// ---- Catalog (CS2 item data; no auth needed, it's public reference data) ----

app.get("/api/catalog", async () => {
  // assetVersion rides along here because the client needs it before it can
  // request a single paint file, and this is the one call it always makes first.
  return {
    weapons: getWeapons(),
    agents: getAgents(),
    defaults: getDefaults(),
    assetVersion: await assetVersion(),
    assetOrigin: await assetOrigin(),
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
export function renderKeyForRow(row: { id: number | string; wear: number | string | null; seed: number | string | null; stattrak: boolean | null }) {
  // Version suffix = render pipeline version: bumping it makes every older
  // bake miss so cards re-render instead of serving stale art. Must match
  // renderKeyFor in src/api.ts. (v2 compositor/legacy-body, v3 content-crop,
  // v4 paint+lighting: durability inversion, cavity from ao4.b, the disabled
  // g_bUseOverlay/g_bUseRoughness gates, and the IBL/key/rim scale-down that
  // stopped a white specular term swamping every skin's chroma. v5 crop aspect
  // cap: slim crops (the Nova) went full-bleed in cards and drew oversized.
  // v6 noPaint/composite-inputs: dropped the base-metalness gate on noPaint
  // that was painting polymer hardware, and started picking the HD vs legacy
  // composite-input bundle to match the body being rendered.
  // v7 StatTrak module: cards now draw the module, so the ST flag has to be in
  // the key or toggling it serves the pre-toggle bake.)
  //
  // The key covers id+wear+seed+stattrak only — NOT the shader — so a
  // compositor fix changes the pixels while the filename stays put, and every
  // card keeps serving the pre-fix bake. Bumping this is the ONLY thing that
  // invalidates them; "clear cache" cannot, because the URL is unchanged.
  //
  // Deliberately NOT the kill count: the 2D module renders a blank display, so
  // the card is identical at 0 kills and 4000. Putting the count here would
  // re-bake every card on every kill.
  const st = row.stattrak ? "-st" : "";
  return `inst-${row.id}-${Number(row.wear ?? 0).toFixed(4)}-${Number(row.seed ?? 0)}${st}-v7.png`;
}
app.post<{ Params: { id: string } }>("/api/render/:id", async (request, reply) => {
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
    await fs.writeFile(path.join(RENDERS_DIR, renderKeyForRow(rows[0])), body);
    return { ok: true };
  } catch {
    return reply.status(500).send({ error: "render store unavailable" });
  }
});

const PAINTS_DIR = process.env.PAINTS_DIR ?? "/cs2-models/paints";
const IMAGES_DIR = process.env.IMAGES_DIR ?? "/cs2-models/images";
const ASSET_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
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

// Sticker placement envelope for a weapon model (drives the 3D drag editor).
// Bounds AND the real per-slot UV anchors. Bounds alone can only rule a
// placement out; the anchors are what let the viewer put a sticker where the
// game will actually draw it. Markup is read off the extracted mount, so an
// un-extracted mount (or a knife) degrades to bounds-only rather than failing.
app.get<{ Params: { model: string } }>("/api/catalog/sticker-bounds/:model", async (request) => {
  const model = request.params.model;
  const [bounds, slots] = await Promise.all([
    Promise.resolve(getStickerBounds(model)),
    getStickerMarkup(model),
  ]);
  return { bounds, slots };
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
    if (slot === "graffiti") {
      return { base: null, skins: getGraffiti("") };
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

app.get<{ Querystring: { q?: string } }>("/api/catalog/stickers", async (request) => {
  return getStickers(request.query.q ?? "");
});
app.get<{ Querystring: { q?: string } }>("/api/catalog/charms", async (request) => {
  return getCharms(request.query.q ?? "");
});
app.get<{ Querystring: { q?: string } }>("/api/catalog/patches", async (request) => {
  return getPatches(request.query.q ?? "");
});

// Bulk id → item lookup, for rehydrating a shared craft link. Capped so a
// hand-written ?ids= can't turn into a catalog dump.
app.get<{ Querystring: { ids?: string } }>("/api/catalog/items", async (request) => {
  const ids = (request.query.ids ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 24);
  return ids.length ? getItemsByIds(ids) : [];
});

// ---- Inventory (per-user owned item instances; the loadout is craft-gated) ----

// Sticker/patch slot entries: legacy rows stored plain item ids; newer rows
// store {id, x, y, r, w} placement specs. Normalize on read. `w` is the
// sticker's own scratch wear (0 pristine .. 1 scratched off) — distinct from
// the weapon's float wear. Rows written before it existed normalize to null,
// which reads as pristine everywhere downstream.
type AttachSpec = { id: number; x?: number | null; y?: number | null; r?: number | null; w?: number | null } | null;
// Clamp on READ as well as on write: the game applies this straight to the
// "sticker slot N wear" econ attribute, so a bad float already sitting in the
// JSONB column must never reach a server.
function normWear(w: unknown): number | null {
  if (typeof w !== "number" || !Number.isFinite(w)) return null;
  return Math.min(1, Math.max(0, w));
}
function normSpecs(arr: unknown): AttachSpec[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((entry) => {
    if (entry == null) return null;
    if (typeof entry === "number") return { id: entry };
    if (typeof entry === "object" && typeof (entry as { id?: unknown }).id === "number") {
      const e = entry as { id: number; x?: number | null; y?: number | null; r?: number | null; w?: number | null };
      return { id: e.id, x: e.x ?? null, y: e.y ?? null, r: e.r ?? null, w: normWear(e.w) };
    }
    return null;
  });
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
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null } | null;
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
function checkAttachments(
  stickers?: unknown[] | null,
  charm_id?: number | null,
  patches?: unknown[] | null,
): string | null {
  if (stickers != null) {
    if (!Array.isArray(stickers) || stickers.length > 5) {
      return "Up to 5 stickers can be applied.";
    }
    for (const spec of normSpecs(stickers)) {
      if (spec != null && getItem(spec.id)?.type !== "sticker") return "That isn't a sticker.";
    }
    const badWear = checkWear(stickers);
    if (badWear) return badWear;
  }
  if (patches != null) {
    if (!Array.isArray(patches) || patches.length > 5) {
      return "Up to 5 patches can be applied.";
    }
    for (const spec of normSpecs(patches)) {
      if (spec != null && getItem(spec.id)?.type !== "patch") return "That isn't a patch.";
    }
    const badWear = checkWear(patches);
    if (badWear) return badWear;
  }
  if (charm_id != null && getItem(charm_id)?.type !== "keychain") {
    return "That isn't a charm.";
  }
  return null;
}
function enrichAttachments<T extends { stickers?: unknown[] | null; charm_id?: number | null; charm_offset?: ItemRow["charm_offset"]; patches?: unknown[] | null }>(row: T) {
  const enrich = (spec: AttachSpec) =>
    spec ? { ...getItem(spec.id), x: spec.x ?? null, y: spec.y ?? null, r: spec.r ?? null, w: spec.w ?? null } : null;
  return {
    ...row,
    // Sparse arrays: index = the sticker/patch POSITION on the item.
    stickers: normSpecs(row.stickers).map(enrich),
    patches: normSpecs(row.patches).map(enrich),
    charm: row.charm_id != null ? { ...getItem(row.charm_id), ...(row.charm_offset ?? {}) } : null,
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
  return items.map((row) => ({
    ...enrichAttachments(row),
    slot: slotForItem(row.item_id),
    item: getItem(row.item_id),
    equipped: byInstance.get(row.id) ?? [],
  }));
});

app.post<{ Body: Partial<ItemRow> }>("/api/inventory/craft", async (request, reply) => {
  const identity = await getIdentity(request);
  if (!identity) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  const { item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches } = request.body;
  if (typeof item_id !== "number" || !getItem(item_id)) {
    return reply.status(400).send({ error: "That item doesn't exist." });
  }
  if (!slotForItem(item_id)) {
    return reply.status(400).send({ error: "That item can't be equipped." });
  }
  const attachErr = checkAttachments(stickers, charm_id, patches);
  if (attachErr) {
    return reply.status(400).send({ error: attachErr });
  }
  const { rows } = await pool.query<ItemRow>(
    `INSERT INTO inventory.owned_items (steam_id, item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb)
     RETURNING id, item_id, wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches`,
    [
      identity.steamId, item_id, wear ?? null, seed ?? null, stattrak ?? false, nametag ?? null,
      normSpecs(stickers).some(Boolean) ? JSON.stringify(normSpecs(stickers)) : null, charm_id ?? null,
      charm_offset ? JSON.stringify(charm_offset) : null,
      normSpecs(patches).some(Boolean) ? JSON.stringify(normSpecs(patches)) : null,
    ],
  );
  return { ...enrichInstance(rows[0], []), ...enrichAttachments(rows[0]) };
});

// Update a crafted instance (StatTrak / wear / pattern / nametag). Reflects
// everywhere the instance is equipped.
app.post<{ Params: { id: string }; Body: Partial<ItemRow> }>(
  "/api/inventory/:id",
  async (request, reply) => {
    {
      // Imported items mirror a real Steam inventory — read-only by design.
      const identity0 = await getIdentity(request);
      if (identity0) {
        const chk = await pool.query(
          `SELECT origin FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
          [Number(request.params.id), identity0.steamId],
        );
        if (chk.rows[0]?.origin === "steam") {
          return reply.status(400).send({ error: "Imported items are read-only — duplicate them to edit." });
        }
      }
    }
    const identity = await getIdentity(request);
    if (!identity) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const id = Number(request.params.id);
    const { wear, seed, stattrak, nametag, stickers, charm_id, charm_offset, patches } = request.body;
    const attachErr = checkAttachments(stickers, charm_id, patches);
    if (attachErr) {
      return reply.status(400).send({ error: attachErr });
    }
    const hasStickers = stickers !== undefined;
    const hasCharm = charm_id !== undefined;
    const hasPatches = patches !== undefined;
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
        id, identity.steamId, wear ?? null, seed ?? null, stattrak ?? null, nametag ?? null,
        hasStickers, hasStickers && normSpecs(stickers).some(Boolean) ? JSON.stringify(normSpecs(stickers)) : null,
        hasCharm, hasCharm ? charm_id ?? null : null,
        hasCharm && charm_offset ? JSON.stringify(charm_offset) : null,
        hasPatches, hasPatches && normSpecs(patches).some(Boolean) ? JSON.stringify(normSpecs(patches)) : null,
      ],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: "That item isn't in your inventory." });
    }
    return { ...enrichInstance(rows[0], []), ...enrichAttachments(rows[0]) };
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
    charm_offset?: { x?: number | null; y?: number | null; z?: number | null } | null;
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
  const charmKit = row.charm_id != null ? getItem(row.charm_id)?.index : null;
  if (charmKit != null) {
    keychains.push({
      slot: 0,
      id: charmKit as number,
      offsetX: row.charm_offset?.x ?? null,
      offsetY: row.charm_offset?.y ?? null,
      offsetZ: row.charm_offset?.z ?? null,
      pattern: 0,
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
  const attachErr = checkAttachments(b.stickers, b.charm_id, b.patches);
  if (attachErr) {
    return reply.status(400).send({ error: attachErr });
  }
  const link = inspectLinkFor(b.item_id, {
    wear: b.wear,
    seed: b.seed,
    stattrak: b.stattrak,
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
  const row = rows[0];
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
  await pool.query(`DELETE FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`, [
    Number(request.params.id),
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
const SLOT_RE = /^(sp|p[1-4]|m[1-5]|r[1-5]|knife|gloves|agent|zeus|c4|musickit|graffiti)$/;
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
  const seedFrom = (assetid: string) => (Number(BigInt(assetid) % 999n) + 1);
  for (const asset of assets) {
    const desc = byClass.get(asset.classid);
    let name = desc?.market_hash_name ?? "";
    if (!name) continue;
    const stattrak = name.startsWith("StatTrak™ ") || name.startsWith("★ StatTrak™ ");
    name = name.replace(/^★ /, "").replace(/^StatTrak™ /, "").replace(/^Souvenir /, "");
    const wearMatch = name.match(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/);
    const wearTier = wearMatch?.[1];
    if (wearTier) name = name.slice(0, -wearMatch![0].length);
    const itemId = getItemIdBySteamName(name);
    if (itemId == null || !slotForItem(itemId)) {
      skipped++;
      // Resolved-but-slotless items (cases, keys, medals, coins) are expected
      // and would drown the log — only unresolved names are anomalies.
      if (itemId == null) {
        unknown++;
        if (skippedNames.length < 20) skippedNames.push(name);
      }
      continue;
    }
    seen.push(asset.assetid);
    const stickers = attachmentIds(desc, "Sticker", "Sticker", unresolved);
    const patches = attachmentIds(desc, "Patch", "Patch", unresolved);
    const charmId = attachmentIds(desc, "Charm", "Charm", unresolved)[0] ?? null;
    // Re-sync mutable state (stickers scraped/added, charm swapped, item
    // renamed) onto the existing row: the id stays put, so anything equipped
    // in the loadout stays equipped. charm_offset is the user's own placement
    // and is deliberately left alone.
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
    const { rowCount } = await pool.query(
      `DELETE FROM inventory.owned_items
       WHERE steam_id = $1 AND origin = 'steam' AND steam_asset_id IS NOT NULL
         AND NOT (steam_asset_id = ANY($2::text[]))`,
      [identity.steamId, seen],
    );
    removed = rowCount ?? 0;
  }
  app.log.info(
    `[steam-sync] ${identity.steamId}: ${assets.length} assets` +
      `${complete ? "" : " (PARTIAL read)"} — ${imported} added, ${updated} updated, ` +
      `${removed} removed, ${skipped} skipped (${unknown} unknown)` +
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
        app.log.info(`[invsim-cfg] ${type}: already up to date`);
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
  app.log.info(`[invsim-cfg] sync done — updated: [${updated.join(", ")}] failed: [${failed.join(", ")}]`);
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
async function dirStats(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(d: string) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        files++;
        bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
      }
    }
  }
  await walk(dir);
  return { files, bytes };
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
    const [renders, paints, images, models] = await Promise.all([
      dirStats(RENDERS_DIR),
      dirStats(PAINTS_DIR),
      dirStats(IMAGES_DIR),
      dirStats(modelsDir),
    ]);
    return { renders, paints, images, models };
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
  if (scope !== "renders") {
    return reply.status(400).send({
      error:
        "Only card renders can be cleared. Paints and icons are extracted from this server's CS2 install — re-run the model extraction to rebuild them.",
    });
  }
  const before = await dirStats(RENDERS_DIR);
  await fs.rm(RENDERS_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(RENDERS_DIR, { recursive: true }).catch(() => {});
  return { cleared: { renders: before.files } };
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
  const { version: extractVersion, gameBuild, gamePatch, gameDate, durationSeconds, steps } = stamp;
  return {
    extractVersion,
    requiredVersion,
    extracted,
    // How long the last successful run took, and where it went. Surfaced so
    // "press this button" comes with an idea of what you're committing to.
    lastRunSeconds: durationSeconds,
    lastRunSteps: steps,
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
  // Deliberately NOT detached: a run is tied to the process that started it, so
  // restarting the backend stops it. Simple and predictable — the alternative
  // leaves orphaned multi-GB jobs nobody is tracking.
  const child = spawn("bash", [script], {
    env: { ...process.env, CS2_DIR, OUT_DIR: MODELS_ROOT, WORK_DIR: workDir },
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
  return { available: true as const, ...status, logBytes, progress, ...(await extractVersionInfo()) };
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

interface EquippedItem {
  def?: number;
  paint?: number;
  seed?: number | null;
  wear?: number | null;
  stattrak?: number;
  nametag?: string;
  stickers?: { def: number; slot: number; wear: number; x?: number; y?: number; rotation?: number }[];
  keychains?: { def: number; seed: number; slot: number }[];
  musicId?: number;
  tint?: number;
  uid?: number;
  hash?: string;
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
  return out.length ? out : undefined;
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
    charm_offset: { x?: number; y?: number; z?: number } | null;
  }>(
    `SELECT l.team, l.slot, i.id AS uid, i.item_id, i.wear, i.seed, i.stattrak,
            i.stattrak_count, i.nametag, i.stickers, i.patches, i.charm_id, i.charm_offset
     FROM inventory.loadout l
     JOIN inventory.owned_items i ON i.id = l.item_instance_id
     WHERE l.steam_id = $1`,
    [steamId],
  );

  const out = {
    agents: {} as Record<string, EquippedItem>,
    ctWeapons: {} as Record<string, EquippedItem>,
    tWeapons: {} as Record<string, EquippedItem>,
    gloves: {} as Record<string, EquippedItem>,
    knives: {} as Record<string, EquippedItem>,
    musicKit: undefined as EquippedItem | undefined,
    graffiti: undefined as EquippedItem | undefined,
  };

  for (const row of rows) {
    const item = getItem(row.item_id as number);
    if (!item) continue;
    const base: EquippedItem = {
      uid: Number(row.uid),
      hash: `${row.uid}:${row.item_id}:${row.seed ?? ""}:${row.wear ?? ""}:${row.stattrak ? row.stattrak_count : -1}`,
    };
    if (row.stattrak) base.stattrak = row.stattrak_count ?? 0;
    if (row.nametag) base.nametag = row.nametag;
    const teamByte = TEAM_BYTE[row.team];

    if (row.slot === "agent") {
      out.agents[teamByte] = {
        ...base,
        def: item.def as number | undefined,
        stickers: equippedStickers(row.patches), // patches apply via sticker slots
      };
    } else if (row.slot === "knife") {
      out.knives[teamByte] = {
        ...base,
        def: item.def as number | undefined,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        wear: row.wear ?? 0,
      };
    } else if (row.slot === "gloves") {
      out.gloves[teamByte] = {
        ...base,
        def: item.def as number | undefined,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        wear: row.wear ?? 0,
      };
    } else if (row.slot === "musickit") {
      out.musicKit = { ...base, musicId: item.index as number | undefined };
    } else if (row.slot === "graffiti") {
      out.graffiti = { ...base, def: item.index as number | undefined, tint: item.tint as number | undefined };
    } else {
      // Weapon positions incl. zeus/c4 — keyed by weapon def index.
      if (item.def == null) continue;
      const entry: EquippedItem = {
        ...base,
        def: item.def as number,
        paint: (item.index as number | undefined) ?? 0,
        seed: row.seed ?? 1,
        wear: row.wear ?? 0,
        stickers: equippedStickers(row.stickers),
      };
      const charmKit = row.charm_id != null ? getItem(row.charm_id)?.index : null;
      if (charmKit != null) {
        const keychain: { def: number; seed: number; slot: number; x?: number; y?: number; z?: number } = {
          def: charmKit as number, seed: 0, slot: 0,
        };
        if (row.charm_offset?.x != null) keychain.x = row.charm_offset.x;
        if (row.charm_offset?.y != null) keychain.y = row.charm_offset.y;
        if (row.charm_offset?.z != null) keychain.z = row.charm_offset.z;
        entry.keychains = [keychain];
      }
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
  await app.listen({ port, host: "0.0.0.0" });
  void autoExtractIfStale();
  // Freshness marker: node --watch in this container is event-based and quietly
  // misses synced edits, so "my change did nothing" is usually "the process is
  // still on old code". Compare this mtime against the file you just edited.
  try {
    const self = fileURLToPath(new URL("./main.ts", import.meta.url));
    const { mtime } = await fs.stat(self);
    app.log.info(`[boot] main.ts last modified ${mtime.toISOString()}`);
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
