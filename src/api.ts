// The remote executes inside the PANEL's origin, but the backend lives with the
// plugin's own host (which serves both /assets and /api). Derive that host from
// where this bundle was loaded (import.meta.url) so it works in production with
// no config; override with VITE_INVENTORY_API for local dev.
function resolveApiBase(): string {
  const override = import.meta.env.VITE_INVENTORY_API;
  if (override) {
    return override;
  }
  try {
    return new URL(import.meta.url).origin;
  } catch {
    return "";
  }
}

const API_BASE = resolveApiBase();
export const API_ORIGIN = API_BASE;

export type Team = "CT" | "T";

export interface CatalogWeapon {
  id: number; // base (vanilla) economy item id — free "default weapon" equips
  model: string;
  name: string;
  category: string;
  teams: Team[];
  image: string | null;
  def?: number;
}

export interface Skin {
  id: number;
  name: string;
  // Phase/variant for finishes sharing one market name — "Ruby", "Phase 2",
  // "Emerald". Distinct paint index per phase; the name alone can't tell them
  // apart, so the picker renders this alongside it.
  altName?: string | null;
  rarity?: string;
  image: string | null;
  teams?: Team[];
  paintMaterial?: string | null;
  // Pre-CS2 finish: pattern is authored against the LEGACY body's UV unwrap,
  // so the 3D viewer must render the legacy mesh for it to align.
  legacyPaint?: boolean;
  // `model` comes back from /catalog/skins for weapon and knife finishes too —
  // the craft editor needs it to mount 3D on a finish nobody owns yet. `type`
  // is /catalog/items only (id lookup): a shared craft link knows an id and
  // nothing else, and the type is what tells a sticker from a charm.
  model?: string | null;
  type?: string;
}

export interface DefaultsMap {
  knife: Record<Team, CatalogItem | null>;
  gloves: Record<Team, CatalogItem | null>;
  agent: Record<Team, CatalogItem | null>;
  zeus: CatalogItem | null;
  c4: CatalogItem | null;
  musickit: CatalogItem | null;
}

export interface Catalog {
  weapons: CatalogWeapon[];
  agents: Skin[];
  defaults?: DefaultsMap;
  /** Changes whenever the extracted assets might have. See assetVersion below. */
  assetVersion?: string;
  /** Where to fetch item art and paint assets from. Empty (the default) means
   *  the same host that served this API. Non-empty when the operator has opted
   *  into the shared 5stack CDN. */
  assetOrigin?: string;
}

export interface CatalogItem {
  id: number;
  name: string;
  /** Phase/variant — see `Skin.altName`. */
  altName?: string | null;
  image: string | null;
  rarity?: string;
  model?: string;
  category?: string;
  type?: string;
  teams?: Team[];
  paintMaterial?: string | null;
  legacyPaint?: boolean;
}

export interface LoadoutEntry {
  team: Team;
  slot: string;
  item_instance_id: number | null;
  /**
   * Crafted skin (as opposed to a free default weapon picked for the slot).
   * Its own field rather than `item_instance_id != null` because the public
   * player-loadout endpoint withholds the instance id — someone else's row
   * handle — while still needing to say the cell holds a real skin.
   */
  skinned: boolean;
  item_id: number;
  wear: number | null;
  seed: number | null;
  stattrak: boolean;
  stattrak_count: number;
  nametag: string | null;
  item: CatalogItem | null;
}

// An owned, crafted item instance in the user's inventory.
// `w` is the sticker's own scratch wear (0 pristine .. 1 scratched off) — the
// game's "sticker slot N wear" attribute, not the weapon's float wear.
export type AttachSpec = { id: number; x?: number | null; y?: number | null; r?: number | null; w?: number | null } | null;
export type PlacedItem = (CatalogItem & { x?: number | null; y?: number | null; r?: number | null; w?: number | null }) | null;

export interface InventoryItem {
  id: number;
  item_id: number;
  wear: number | null;
  seed: number | null;
  stattrak: boolean;
  /** Kills recorded on the module. 0 when the item isn't StatTrak. Drives the
   *  3D digit display only — 2D cards render a blank display on purpose. */
  stattrak_count: number;
  nametag: string | null;
  stickers?: PlacedItem[];
  patches?: PlacedItem[];
  charm?: (CatalogItem & { x?: number | null; y?: number | null; z?: number | null }) | null;
  slot: string | null;
  item: CatalogItem | null;
  equipped: { team: Team; slot: string }[];
  origin?: "crafted" | "steam" | "copied";
}

// Item artwork lives on our own mount, served under /images by the plugin host
// — the same origin as /api. The backend emits ROOT-RELATIVE paths because it
// can't know that origin (this bundle runs inside the PANEL's origin, so a bare
// "/images/..." would resolve against the wrong host). Resolving here, at the
// single door every API response comes through, means no view has to remember
// to do it — and swapping artwork onto a shared CDN later is a one-line change.
// Defaults to the API host — what every deployment does unless it opts into the
// shared CDN. Set from /catalog, so it is in place before any asset is fetched.
let assetOrigin = API_ORIGIN;
export const ASSET_ORIGIN = API_ORIGIN;
export const getAssetOrigin = () => assetOrigin;
export const assetUrl = (path: string) => `${assetOrigin}${path}`;

/** Rewrite every "/images/..." string in a decoded response body in place.
 *  Item art appears under a dozen different keys (item, skin, stickers[],
 *  patches[], charm, agents, collections...), so a walk is materially safer
 *  than enumerating them and silently missing one the next time a shape grows. */
function resolveAssetPaths(node: unknown): unknown {
  if (typeof node === "string") {
    return node.startsWith("/images/") ? assetUrl(node) : node;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = resolveAssetPaths(node[i]);
    return node;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const k in obj) obj[k] = resolveAssetPaths(obj[k]);
    return obj;
  }
  return node;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    // Only claim a JSON body when we actually send one — Fastify 400s on
    // body-less DELETEs that carry a JSON content-type.
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    // Surface the backend's human-readable error message when there is one.
    let message = `Something went wrong (${response.status}).`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new Error(message);
  }
  return resolveAssetPaths(await response.json()) as T;
}

// Cache-buster for paint MATERIALS. Their filenames come from cs2-lib and are
// fixed, so unlike our content-hashed textures the URL can't change when the
// contents do — a browser held one for a day and kept asking for texture names
// a later extraction had replaced, so every one 404'd and the skin rendered
// white. Stamping the extraction's version on the query gives them something to
// bust on, which is what lets them be cached hard instead of revalidated.
//
// Empty until the catalog lands; an unversioned URL is still correct, it just
// revalidates (the server only marks a response immutable when `v` is present).
let assetVersion = "";
export const getAssetVersion = () => assetVersion;
export const withAssetVersion = (url: string) =>
  assetVersion ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(assetVersion)}` : url;

export const fetchCatalog = async () => {
  const c = await request<Catalog>("/catalog");
  if (c.assetVersion) assetVersion = c.assetVersion;
  // Empty string is meaningful — "serve from this host" — so only a non-empty
  // value overrides the default.
  if (c.assetOrigin) assetOrigin = c.assetOrigin;
  return c;
};

// Cached true-render card images (client 3D snapshots stored on the mount).
// Number() guards: pg numerics can arrive as strings — .toFixed on a string throws.
// Version suffix must match the backend's key builder — bumped when the
// render pipeline changes so stale bakes miss and re-render.
// The ST flag is in the key (cards draw the module) but the kill count is NOT
// — the 2D module renders a blank display, so a card is identical at 0 kills
// and 4000. Keying on the count would re-bake every card on every kill.
// stattrak is REQUIRED, not optional: an omitted flag silently builds a key
// that disagrees with the one the writer used, and the card 404s forever.
export const renderKeyFor = (i: { id: number; wear: number | null; seed: number | null; stattrak: boolean | null }) =>
  `inst-${i.id}-${Number(i.wear ?? 0).toFixed(4)}-${Number(i.seed ?? 0)}${i.stattrak ? "-st" : ""}-v7.png`;
// Served via /api (canonical): that ingress path provably reaches the backend
// pod that stores the files — immune to stale nginx images, CDN-cached 404s,
// and hostPath node mismatches. Plain <img> tags send session cookies, so the
// forward-auth gate passes for signed-in users.
export const renderUrlFor = (i: { id: number; wear: number | null; seed: number | null; stattrak: boolean | null }) =>
  `${API_ORIGIN}/api/renders/${renderKeyFor(i)}`;
export async function uploadRender(instanceId: number, blob: Blob): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/render/${instanceId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (res.ok) return { ok: true };
    let error = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) error = `${error} — ${data.error}`;
    } catch { /* non-JSON */ }
    return { ok: false, error };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- Skin test suite --------------------------------------------------------
// Drives src/SkinTests.vue: the render work-list, the resume/gallery listing,
// and the persisted problem report. PNGs upload as raw octet-stream (same as
// uploadRender); the key is the finish's economy id, validated server-side.
export interface RenderTestItem {
  id: number;
  name: string;
  kind: "weapon" | "knife" | "glove";
  model: string;
  paintMaterial: string;
  legacy: boolean;
  rarity: string;
  image: string | null;
}
// One entry per rendered finish, keyed by economy id. `status` flags the hard
// failures (no model, empty frame); `sat`/`luma`/`coverage` are measured off
// the rendered pixels so the gallery can SORT by chroma — the reliable way to
// surface a "renders flat grey" compositor bug without false-flagging skins
// that are legitimately dark or achromatic. Small enough (~2k rows of numbers)
// to live as a plain JSON blob on the mount and survive reloads.
export interface TestResult {
  status: "ok" | "failed" | "empty";
  /** Mean per-pixel chroma (max−min channel) over gun pixels, 0–255. */
  sat: number;
  /** Mean luma over gun pixels, 0–255. */
  luma: number;
  /** Share of the frame the weapon covers, 0–1. */
  coverage: number;
  reason?: string;
}
export type TestReport = Record<string, TestResult>;

// Human triage, kept DELIBERATELY separate from the machine report: a verdict is
// someone's eyes on the render and is expensive to reproduce, whereas the report
// is regenerated by every run and wiped by Clear. Same reason the backend keeps
// them in different files and Clear spares this one.
export type TestVerdict = "good" | "bad";
export interface TestVerdictEntry {
  verdict: TestVerdict;
  /** What's wrong with it — free text, only meaningful on "bad". */
  note?: string;
  /** epoch ms, so a verdict can be aged against a later compositor change. */
  at: number;
}
export type TestVerdicts = Record<string, TestVerdictEntry>;

export const testKeyFor = (id: number) => `test-${id}.png`;
export const testImgUrl = (key: string) => `${API_ORIGIN}/api/tests/img/${key}`;

export const fetchTestCatalog = () => request<RenderTestItem[]>("/tests/catalog");
export const fetchTestList = () =>
  request<{ keys: string[] }>("/tests/list").then((r) => r.keys);
export const fetchTestReport = () => request<TestReport>("/tests/report");
export const saveTestReport = (report: TestReport) =>
  request<{ ok: boolean }>("/tests/report", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
export const clearTests = () =>
  request<{ cleared: number }>("/tests", { method: "DELETE" });

export const fetchTestVerdicts = () => request<TestVerdicts>("/tests/verdicts");
export const saveTestVerdicts = (verdicts: TestVerdicts) =>
  request<{ ok: boolean }>("/tests/verdicts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verdicts),
  });

export async function uploadTestSnap(key: string, blob: Blob): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/tests/snap/${key}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (res.ok) return { ok: true };
    let error = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) error = `${error} — ${data.error}`;
    } catch { /* non-JSON */ }
    return { ok: false, error };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Per-weapon sticker geometry (cached — schema data only moves on a CS2 model
// change). `slots` carries the game's own per-slot UV anchors; `bounds` is the
// looser envelope cs2-lib derives from them.
export type StickerBounds = { x: [number, number]; y: [number, number] };
export interface StickerSlot {
  /** The game's slot index — this is what the protobuf `slot` field wants. */
  index: number;
  /** "body_hd" | "body_legacy" — must match the body the finish renders on. */
  mesh: string;
  /** UV anchor centred on 0; add 0.5 for TEXCOORD_1 space. */
  offset: [number, number];
  /** UV magnification: the sticker spans 1/scale UV units. */
  scale: number;
  rotation: number;
  special?: string;
}
export interface StickerGeometry {
  bounds: StickerBounds | null;
  slots: StickerSlot[];
}
const stickerGeomCache = new Map<string, Promise<StickerGeometry>>();
export function fetchStickerGeometry(model: string): Promise<StickerGeometry> {
  let cached = stickerGeomCache.get(model);
  if (!cached) {
    cached = request<StickerGeometry>(`/catalog/sticker-bounds/${encodeURIComponent(model)}`)
      .then((r) => ({ bounds: r.bounds ?? null, slots: r.slots ?? [] }))
      .catch(() => ({ bounds: null, slots: [] }));
    stickerGeomCache.set(model, cached);
  }
  return cached;
}
export const fetchStickerBounds = (model: string) => fetchStickerGeometry(model).then((g) => g.bounds);

export const fetchSkins = (slot: string) =>
  request<{ base: Skin | null; skins: Skin[] }>(
    `/catalog/skins?slot=${encodeURIComponent(slot)}`,
  );

export const fetchLoadout = () => request<LoadoutEntry[]>("/loadout");

// ---- Inventory (owned instances) ----
export const fetchInventory = () => request<InventoryItem[]>("/inventory");

export const searchStickers = (q: string) =>
  request<Skin[]>(`/catalog/stickers?q=${encodeURIComponent(q)}`);
export const searchCharms = (q: string) =>
  request<Skin[]>(`/catalog/charms?q=${encodeURIComponent(q)}`);
export const searchPatches = (q: string) =>
  request<Skin[]>(`/catalog/patches?q=${encodeURIComponent(q)}`);

// Resolve catalog items by id — how a shared /craft link turns the ids in its
// query back into a renderable draft. Returns only the ids that exist, so a
// stale sticker id drops that one slot instead of breaking the whole link.
export const fetchCatalogItems = (ids: number[]) =>
  ids.length
    ? request<Skin[]>(`/catalog/items?ids=${ids.join(",")}`)
    : Promise.resolve([]);

export const craftItem = (body: {
  item_id: number;
  wear?: number | null;
  seed?: number | null;
  stattrak?: boolean;
  nametag?: string | null;
  stickers?: AttachSpec[];
  patches?: AttachSpec[];
  charm_id?: number | null;
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null } | null;
}) =>
  request<InventoryItem>("/inventory/craft", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateInstance = (
  id: number,
  body: {
    wear?: number | null;
    seed?: number | null;
    stattrak?: boolean;
    nametag?: string | null;
    stickers?: AttachSpec[];
    patches?: AttachSpec[];
    charm_id?: number | null;
    charm_offset?: { x?: number | null; y?: number | null; z?: number | null } | null;
  },
) =>
  request<InventoryItem>(`/inventory/${id}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

// Public read-only loadout for any player + clone it into your own.
export const fetchPlayerLoadout = (steamId: string) =>
  request<LoadoutEntry[]>(`/loadout/${steamId}`);
export const copyLoadoutFrom = (steamId: string) =>
  request<{ copied: number }>(`/loadout/copy-from/${steamId}`, { method: "POST", body: "{}" });

// Steam import: read-only fetch of the caller's PUBLIC Steam inventory.
export const importSteamInventory = () =>
  request<{
    imported: number;
    updated: number;
    removed: number;
    skipped: number;
    partial: boolean;
  }>("/inventory/import-steam", {
    method: "POST",
    body: "{}",
  });

// Admin: cached-asset stats + clearing (renders / paints on the mount).
export type DirStat = { files: number; bytes: number };
export type CacheStats = {
  renders: DirStat;
  paints: DirStat;
  images?: DirStat; // absent on older backends
  models?: DirStat;
};
export const fetchCacheStats = () => request<CacheStats>("/admin/cache");

// Shared 5stack asset CDN. Off by default: extraction output is deterministic
// for a given pipeline+CS2 build, so a first-party CDN can serve exactly what
// this box would have produced — but which host your assets come from is the
// operator's call to make, not a default to inherit.
export type AssetCdnStatus = {
  enabled: boolean;
  base: string;
  /** CDN origin, or null if nothing is extracted here yet. */
  origin: string | null;
  /** Does the CDN's pipeline+build match ours? null when unknown. */
  available: boolean | null;
  extractVersion: number | null;
  gameBuild: number | null;
  /** What the CDN reports, for showing the mismatch rather than just denying. */
  cdnVersion?: number | null;
  cdnGameBuild?: number | null;
};
export const fetchAssetCdn = () => request<AssetCdnStatus>("/admin/asset-cdn");
export const setAssetCdn = (enabled: boolean) =>
  request<{ enabled: boolean }>("/admin/asset-cdn", { method: "PUT", body: JSON.stringify({ enabled }) });
// Renders only. Paints and icons are extracted from the server's own CS2
// install with no upstream to re-fetch from, so deleting them breaks rendering
// until someone re-extracts — the backend rejects any other scope.
export const clearCache = () =>
  request<{ cleared: Record<string, number> }>("/admin/cache?scope=renders", { method: "DELETE" });

// Admin: model extraction (pulls weapon GLBs + composite inputs from the
// node's CS2 install straight onto the models mount). Runs as a child process
// of the backend; state is persisted to a JSON file on that same mount.
export interface ExtractStatus {
  available: boolean;
  state: "idle" | "running" | "succeeded" | "failed" | "interrupted";
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  error?: string | null;
  log?: string; // tail only — the full run log is the download below
  logBytes?: number;
  // Extraction-pipeline version: what the mount was built by vs. what the
  // script in this build produces. `stale` covers every "press the button"
  // case — never extracted, extracted without a version stamp, or extracted
  // behind this build — and is what lights the gear badge. `extracted`
  // distinguishes the first from the rest for wording. All absent on older
  // backends, which is why `stale` is read as falsy-by-default.
  extractVersion?: number | null;
  requiredVersion?: number | null;
  extracted?: boolean;
  stale?: boolean;
  /** Wall-clock of the last successful run, and the per-step breakdown of it.
   *  Null on mounts stamped before v5 — "unknown", not zero. */
  lastRunSeconds?: number | null;
  lastRunSteps?: Record<string, number> | null;
  /** Live progress while a run is going: every step of the pipeline with its
   *  own state, plus a unit count for the steps that know one. The whole list
   *  is present from the start so the panel can show what's still to come. */
  progress?: {
    steps: { name: string; state: "pending" | "running" | "done"; done?: number; total?: number; seconds?: number }[];
    at: string;
  } | null;
  // CS2 game build. The first three are the build the assets were extracted
  // against (from the stamp); the `current*` ones are read live from the
  // mounted install's steam.inf. `gameUpdated` is a soft "the game moved on"
  // hint — a separate, non-alarming notice, NOT the `stale` re-extract badge.
  gameBuild?: number | null;
  gamePatch?: string | null;
  gameDate?: string | null;
  currentGameBuild?: number | null;
  currentGamePatch?: string | null;
  currentGameDate?: string | null;
  gameUpdated?: boolean;
}
// Plain <a download> hits this: same cookie-auth path the render <img> tags
// use, so no token juggling.
export const extractLogUrl = () => `${API_ORIGIN}/api/admin/extract-models/log`;

export const fetchExtractStatus = () => request<ExtractStatus>("/admin/extract-models");
export const startExtractJob = () =>
  request<{ started: true }>("/admin/extract-models", { method: "POST", body: "{}" });

// Admin: panel-generated server API key (game servers use it as invsim_apikey).
export interface CfgSyncResult {
  updated: string[];
  failed: string[];
}
export const fetchServerApiKey = () =>
  request<{ key: string | null; cfg: CfgSyncResult | null }>("/admin/server-api-key");
export const generateServerApiKey = () =>
  request<{ key: string; cfg: CfgSyncResult | null }>("/admin/server-api-key", { method: "POST", body: "{}" });

// Inspect link for the craft currently in the editor, saved or not — so what
// you inspect is the state on screen rather than the last write to the DB.
export const fetchDraftInspectLink = (body: {
  item_id: number;
  wear?: number | null;
  seed?: number | null;
  stattrak?: boolean;
  nametag?: string | null;
  stickers?: AttachSpec[];
  patches?: AttachSpec[];
  charm_id?: number | null;
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null } | null;
}) =>
  request<{ inspect: string }>("/inspect/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const fetchInspectLink = (id: number) =>
  request<{ inspect: string; stattrak: boolean }>(`/inventory/${id}/inspect`);

export const deleteInstance = (id: number) =>
  request<{ ok: true }>(`/inventory/${id}`, { method: "DELETE" });

// ---- Loadout ----
// Equip an owned instance (item_instance_id) OR a free default weapon (item_id
// of a vanilla base item) into a positional slot.
export const equip = (body: {
  team: Team;
  slot: string;
  item_instance_id?: number;
  item_id?: number;
}) =>
  request<{ ok: true }>("/loadout", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Swap two positional slots atomically — the server exempts the pair from the
// duplicate-weapon check, which a pair of plain equips would always trip.
export const swapLoadout = (body: {
  team: Team;
  a: { slot: string; item_instance_id?: number; item_id?: number };
  b: { slot: string; item_instance_id?: number; item_id?: number };
}) =>
  request<{ ok: true }>("/loadout/swap", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const unequip = (team: Team, slot: string) =>
  request<{ ok: true }>(
    `/loadout?team=${team}&slot=${encodeURIComponent(slot)}`,
    { method: "DELETE" },
  );
