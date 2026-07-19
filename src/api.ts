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
  rarity?: string;
  image: string | null;
  teams?: Team[];
  paintMaterial?: string | null;
  // Pre-CS2 finish: pattern is authored against the LEGACY body's UV unwrap,
  // so the 3D viewer must render the legacy mesh for it to align.
  legacyPaint?: boolean;
  // Only /catalog/items (id lookup) fills these — a shared craft link knows an
  // id and nothing else, so rehydrating it needs the weapon model to mount 3D
  // and the type to tell a sticker from a charm.
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
}

export interface CatalogItem {
  id: number;
  name: string;
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
  item_id: number;
  wear: number | null;
  seed: number | null;
  stattrak: boolean;
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
  nametag: string | null;
  stickers?: PlacedItem[];
  patches?: PlacedItem[];
  charm?: (CatalogItem & { x?: number | null; y?: number | null; z?: number | null }) | null;
  slot: string | null;
  item: CatalogItem | null;
  equipped: { team: Team; slot: string }[];
  origin?: "crafted" | "steam" | "copied";
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
  return (await response.json()) as T;
}

export const fetchCatalog = () => request<Catalog>("/catalog");

// Cached true-render card images (client 3D snapshots stored on the mount).
// Number() guards: pg numerics can arrive as strings — .toFixed on a string throws.
// Version suffix must match the backend's key builder — bumped when the
// render pipeline changes so stale bakes miss and re-render.
export const renderKeyFor = (i: { id: number; wear: number | null; seed: number | null }) =>
  `inst-${i.id}-${Number(i.wear ?? 0).toFixed(4)}-${Number(i.seed ?? 0)}-v5.png`;
// Served via /api (canonical): that ingress path provably reaches the backend
// pod that stores the files — immune to stale nginx images, CDN-cached 404s,
// and hostPath node mismatches. Plain <img> tags send session cookies, so the
// forward-auth gate passes for signed-in users.
export const renderUrlFor = (i: { id: number; wear: number | null; seed: number | null }) =>
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
export type CacheStats = {
  renders: { files: number; bytes: number };
  paints: { files: number; bytes: number };
  models?: { files: number; bytes: number }; // absent on older backends
};
export const fetchCacheStats = () => request<CacheStats>("/admin/cache");
export const clearCache = (scope: "renders" | "paints" | "all") =>
  request<{ cleared: Record<string, number> }>(`/admin/cache?scope=${scope}`, { method: "DELETE" });

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
