// Run the REAL plugin UI on your machine against a fake inventory — no panel,
// no login, no database.
//
// It serves a standalone build of the frontend, answers the signed-in endpoints
// (inventory, loadout, presets, wishlist, prices) itself, answers the knife and
// glove craft catalogs straight from the working tree's backend/src/catalog.ts
// (so a catalog change is visible without deploying a backend), and proxies
// everything else — art, models, paints, sticker bounds, the rest of the
// catalog — to a real backend. Drive it with drive.mjs.
//
//   VITE_INVENTORY_API=http://127.0.0.1:8787 npx vite build --outDir /tmp/inv-dist --emptyOutDir
//   ASSET_HOST=https://inventory.5stack.gg MOCK_INVENTORY=tools/standalone/inventory.example.json \
//     node --experimental-strip-types tools/standalone/mock-server.mjs /tmp/inv-dist
//   open http://127.0.0.1:8787/
//
// MOCK_INVENTORY is a JSON array of
//   { item_id, wear?, seed?, stattrak?, stattrak_count?, nametag?, slot?,
//     stickers?: [{ id, x?, y?, r?, w? }] }
// and item ids come from cs2-lib (see backend/src/catalog.ts getItemIdByName).
// MOCK_LOADOUT is the /api/loadout answer, inline JSON (default []).
// MOCK_CARDS=stub answers every instance card with a 1x1 PNG, so the card
// backfill never runs. Use it to time a COLD 3D open: a backfill bake loads the
// same GLB and composite into the viewer's caches, and the open you then time
// finds them already there.
//
// Editing an item (POST /api/inventory/<id>) is answered here and applied to
// the in-memory inventory, so Save -> card re-bake can be tested; other writes
// are proxied to a backend that will refuse them without a session. Card
// uploads are kept and served back (see the card store below: CARDS_DIR,
// MOCK_CARD_FORMATS).
//
// The shared COMPOSITE STORE is answered here too, in memory and isolated from
// the real backend's: uploads (POST /api/composite/...) are checked the way the
// backend checks them (the filename must be the stem backend/src/compositeStore.ts
// derives from the identity, and an item in MOCK_INVENTORY must composite to
// it), then kept, and reads (/api/composites/...) serve only what was uploaded.
// /api/admin/cache gets fake sizes so the Asset Cache tab renders. GET
// /__mock/composites lists what is stored. MOCK_ADMIN=0 answers every admin
// route 403.
// MOCK_COMPOSITES=keep also lets a composite this mock does not hold fall
// through to the real backend's store (read only), for timing a store HIT
// on skins someone already opened against the dev mount.
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cat = await import(join(REPO, "backend/src/catalog.ts"));
const { cardFormatOf, CARD_FORMATS, findCard, readCard, storeCard } = await import(join(REPO, "backend/src/cardStore.ts"));
const store = await import(join(REPO, "backend/src/compositeStore.ts"));
const DIST = process.argv[2];
if (!DIST) {
  console.error("usage: node --experimental-strip-types tools/standalone/mock-server.mjs <dist dir>");
  process.exit(2);
}
const UP = (process.env.ASSET_HOST ?? "https://inventory.5stack.gg").replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 8787);
const LOADOUT = JSON.parse(process.env.MOCK_LOADOUT ?? "[]");
const seed = process.env.MOCK_INVENTORY ? JSON.parse(await readFile(process.env.MOCK_INVENTORY, "utf8")) : [];
const INVENTORY = seed.map((e, n) => ({
  id: String(9000 + n),
  item_id: e.item_id,
  wear: e.wear ?? 0,
  seed: e.seed ?? 1,
  stattrak: !!e.stattrak,
  stattrak_count: e.stattrak_count ?? 0,
  nametag: e.nametag ?? null,
  stickers: (e.stickers ?? []).map((s) => ({ ...cat.getItem(s.id), x: s.x ?? null, y: s.y ?? null, r: s.r ?? 0, w: s.w ?? 0 })),
  patches: [],
  slot: e.slot ?? cat.slotForItem(e.item_id),
  item: cat.getItem(e.item_id),
  equipped: [],
  origin: "crafted",
}));

// The card store, through the backend's own cardStore.ts: a PNG upload is
// transcoded to WebP when cwebp is installed, and a card is answered in
// whichever format is stored. CARDS_DIR keeps it (as inst-<id>.png|.webp) for
// the next run, which is how "a card stored as PNG by an older client still
// shows" is checked; without it the store is a temp dir, gone on exit.
const CARDS_DIR = process.env.CARDS_DIR || (await mkdtemp(join(tmpdir(), "mock-cards-")));
if (!process.env.CARDS_DIR) {
  process.on("exit", () => rmSync(CARDS_DIR, { recursive: true, force: true }));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
}
await mkdir(CARDS_DIR, { recursive: true });
// MOCK_CARD_FORMATS plays an older or a broken backend:
//   png          one from before WebP cards: no `cardFormats` on the catalog,
//                PNG uploads stored as they come, WebP refused (400)
//   refuse-webp  one that advertises WebP but refuses it anyway
const CARD_MODE = process.env.MOCK_CARD_FORMATS ?? "";
/** gen -> Map<file, Buffer>: the in-memory composite store. */
const COMPOSITES = new Map();
const ADMIN = process.env.MOCK_ADMIN !== "0";
const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
};
const status = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
// The same identity check the backend's upload route makes: the signed-in user
// (everything in MOCK_INVENTORY) owns an item that composites to this tuple.
const ownsComposite = (id) =>
  INVENTORY.some(
    (r) =>
      !!r.item &&
      String(r.item.model) === id.model &&
      r.item.paintMaterial === id.material &&
      !!r.item.legacyPaint === id.legacy &&
      store.compositeWear(r.wear) === store.compositeWear(id.wear) &&
      store.compositeSeed(r.seed) === store.compositeSeed(id.seed),
  );
// 1x1 transparent PNG — see MOCK_CARDS.
const STUB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const json = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const PROXIED = ["/api/", "/images/", "/models/", "/paints/", "/renders/", "/composites/", "/anims/", "/music/"];

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/api/catalog/skins") {
      const slot = url.searchParams.get("slot");
      if (slot === "knife") return json(res, { base: null, skins: cat.getKnives() });
      if (slot === "gloves") return json(res, { base: null, skins: cat.getGloves() });
    }
    // Made-up but stable prices, so price labels and sorts have something to show.
    if (p === "/api/prices")
      return json(res, { enabled: true, source: "steam", ready: true, window: "7d", listings: 1, sourceDate: null, syncedAt: null });
    if (p === "/api/prices/stock") {
      const slot = url.searchParams.get("slot");
      const list = slot === "knife" ? cat.getKnives() : slot === "gloves" ? cat.getGloves() : [];
      const prices = {};
      for (const s of list) prices[s.id] = { value: 100 + (s.id % 900), window: "7d", marketHashName: s.name, wearTier: 1 };
      return json(res, { ready: true, window: "7d", prices });
    }
    const edit = req.method === "POST" && p.match(/^\/api\/inventory\/(\d+)$/);
    if (edit) {
      const row = INVENTORY.find((r) => r.id === edit[1]);
      if (!row) return json(res, { error: "not found" });
      const body = JSON.parse(await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b || "{}")); }));
      for (const k of ["wear", "seed", "stattrak", "stattrak_count", "nametag"]) if (k in body) row[k] = body[k];
      if (Array.isArray(body.stickers)) {
        row.stickers = body.stickers.map((sp) =>
          sp && sp.id ? { ...cat.getItem(sp.id), x: sp.x ?? null, y: sp.y ?? null, r: sp.r ?? 0, w: sp.w ?? 0 } : null,
        );
      }
      return json(res, row);
    }
    // The catalog's `cardFormats` is what tells a client it may upload WebP
    // cards; an old backend (MOCK_CARD_FORMATS=png) doesn't send it.
    if (p === "/api/catalog") {
      const body = await (await fetch(UP + req.url)).json();
      if (CARD_MODE === "png") delete body.cardFormats;
      else body.cardFormats = [...CARD_FORMATS];
      return json(res, body);
    }
    // Card store, the way a backend WITHOUT card_look keys it: one file per
    // instance whatever its stickers — the case where a stale card can win.
    // Validated by magic bytes like the real one; an old backend refused
    // anything but a PNG with exactly this answer.
    const up = req.method === "POST" && p.match(/^\/api\/render\/(\d+)$/);
    if (up) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const format = cardFormatOf(body);
      if (!format || (CARD_MODE && format !== "png")) {
        console.log(`card ${up[1]}: refused ${format ?? "unknown"} upload, ${body.length} bytes`);
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "bad render" }));
      }
      const key = `inst-${up[1]}.png`;
      if (CARD_MODE === "png") {
        await writeFile(join(CARDS_DIR, key), body);
        await rm(join(CARDS_DIR, `inst-${up[1]}.webp`), { force: true });
      } else {
        await storeCard(CARDS_DIR, key, body);
      }
      const stored = await findCard(CARDS_DIR, key);
      console.log(`card ${up[1]}: got ${format} ${body.length} bytes, stored ${stored.type} ${(await stat(stored.file)).size} bytes`);
      return json(res, { ok: true });
    }
    const card = p.match(/^\/api\/renders\/inst-(\d+)-/);
    const stored = card && (await readCard(CARDS_DIR, `inst-${card[1]}.png`));
    if (stored) {
      res.writeHead(200, { "content-type": stored.type });
      return res.end(stored.body);
    }
    // ---- composite store (see the header) ----
    if (p.startsWith("/api/admin/") && !ADMIN) return status(res, 403, { error: "Only administrators can manage caches." });
    if (p === "/api/admin/cache") {
      let files = 0;
      let bytes = 0;
      for (const g of COMPOSITES.values()) for (const b of g.values()) (files++, (bytes += b.length));
      const z = { files: 0, bytes: 0 };
      const cards = (await readdir(CARDS_DIR).catch(() => [])).length;
      return json(res, { renders: { files: cards, bytes: 0 }, paints: z, images: z, models: z, composites: { files, bytes }, music: z, parts: {} });
    }
    if (p === "/__mock/composites") {
      const out = [];
      for (const [gen, g] of COMPOSITES) for (const [file, b] of g) out.push({ gen, file, bytes: b.length });
      return json(res, out);
    }
    const cup = req.method === "POST" && p.match(/^\/api\/composite\/([^/]+)\/([^/]+)$/);
    if (cup) {
      const gen = decodeURIComponent(cup[1]);
      const file = decodeURIComponent(cup[2]);
      const q = Object.fromEntries(url.searchParams);
      const body = await readBody(req);
      const magic = body.subarray(0, 4).toString("latin1");
      const ext = magic === "\x89PNG" ? "png" : magic === "RIFF" && body.subarray(8, 12).toString("latin1") === "WEBP" ? "webp" : null;
      const id = {
        model: q.model ?? "",
        legacy: q.legacy === "1",
        material: q.material ?? "",
        wear: Number(q.wear),
        seed: Number(q.seed),
        cap: Number(q.cap),
      };
      if (!ext || !["albedo", "rm"].includes(q.kind) || ![1024, 2048, 4096].includes(id.cap))
        return status(res, 400, { error: "bad composite" });
      // The backend names the file itself: the stem from the identity, the
      // extension from the bytes (Safari sends a PNG under a .webp name). A
      // client whose STEM differs would never hit, so the mock refuses that
      // outright where the backend only echoes its own name back.
      const name = `${store.compositeStem(id)}.${q.kind}.${ext}`;
      if (file.replace(/\.(webp|png)$/, "") !== name.replace(/\.(webp|png)$/, "")) {
        console.log(`[mock] composite KEY DRIFT: client ${file} vs backend ${name}`);
        return status(res, 400, { error: `key drift: the backend names it ${name}` });
      }
      if (!ownsComposite(id)) return status(res, 403, { error: "not your item" });
      const g = COMPOSITES.get(gen) ?? new Map();
      COMPOSITES.set(gen, g);
      if (g.has(name)) return json(res, { ok: true, file: name, existed: true });
      g.set(name, body);
      console.log(`[mock] composite stored ${gen}/${name} ${(body.length / 1048576).toFixed(2)}MB`);
      return json(res, { ok: true, file: name });
    }
    const cget = p.match(/^\/(?:api\/)?composites\/([^/]+)\/([^/]+)$/);
    if (cget) {
      const b = COMPOSITES.get(decodeURIComponent(cget[1]))?.get(decodeURIComponent(cget[2]));
      if (b) {
        res.writeHead(200, { "content-type": cget[2].endsWith(".webp") ? "image/webp" : "image/png" });
        return res.end(req.method === "HEAD" ? undefined : b);
      }
      // A miss is a 404 unless MOCK_COMPOSITES=keep, which reads it through
      // from the real backend's store below (see the header).
      if (process.env.MOCK_COMPOSITES !== "keep") return status(res, 404, { error: "not found" });
    }
    if (card && process.env.MOCK_CARDS === "stub") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(STUB_PNG);
    }
    if (p === "/api/loadout") return json(res, LOADOUT);
    if (p === "/api/inventory") return json(res, INVENTORY);
    if (p === "/api/wishlist" || p === "/api/loadout/presets") return json(res, []);
    if (PROXIED.some((pre) => p.startsWith(pre))) {
      const r = await fetch(UP + req.url, { method: req.method === "HEAD" ? "HEAD" : "GET" });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/octet-stream" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    // The panel normally provides Vue through Federation's shared scope; a
    // standalone page has to put it where shared-globals.ts looks.
    if (p === "/vue.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(await readFile(join(REPO, "node_modules/vue/dist/vue.esm-browser.prod.js")));
    }
    // The app routes in the address bar (/items, /admin…), so a reload lands
    // on one of those: answer every extension-less path with the app itself.
    if (p === "/" || p === "/index.html" || !extname(p)) {
      const html = (await readFile(join(DIST, "index.html"), "utf8")).replace(
        "<head>",
        '<head><script type="module">import * as vue from "/vue.js"; globalThis.__5stack_shared__ = { vue };</script>',
      );
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(html);
    }
    const file = join(DIST, p);
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock app on http://127.0.0.1:${PORT}/ (assets from ${UP})`));
