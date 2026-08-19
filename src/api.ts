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

import { WEAR_STOPS } from "./itemVisuals";

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
  /** Game defindex. Absent = no inspect link is possible for this item. */
  def?: number;
  /**
   * AGENTS only: how many patches this agent's model can actually carry.
   *
   * 3 to 5, read from the model's own materials. The inventory schema stores
   * five for every agent, but the POSITIONS belong to the model and most declare
   * three. Null means the backend could not tell (model not on the mount), which
   * must read as "do not restrict" rather than as zero.
   */
  patchSlots?: number | null;
  /**
   * What this item actually has, straight from cs2-lib PER ITEM — not inferred
   * from its type. The distinction is load-bearing for the 68 vanilla weapons,
   * which are `type: "weapon"` and have no float, pattern or StatTrak at all.
   *
   * `wearMin`/`wearMax` are the finish's real float range: 1,683 of the 2,106
   * paintable items are narrower than 0..1 (AK-47 | Redline is 0.10–0.70), and
   * the backend rejects a craft outside it, so the editor's slider has to agree.
   *
   * All optional — a catalog listing from before these existed must stay
   * editable, so absent means "no per-item answer, use the type-level one".
   */
  hasWear?: boolean;
  hasSeed?: boolean;
  hasStatTrak?: boolean;
  hasNameTag?: boolean;
  wearMin?: number | null;
  wearMax?: number | null;
  seedMin?: number | null;
  seedMax?: number | null;
  // ---- sheet facets. The sheet's filter bar is driven entirely by which of
  // them appear on the list it loaded, so a catalog without them renders exactly
  // as it did before — which is what let `collection` spread from graffiti to
  // every weapon, knife, glove and agent finish without touching the bar.
  /** Coarse "what IS this" split — the sheet's tab strip. */
  group?: string;
  /** The set it came in — a capsule for graffiti, a case, map or drop pool for a
   *  finish. Absent when it came in none: M4A4 | Howl's collection was withdrawn
   *  with the skin, and the classic knife pool is the special of eleven cases at
   *  once, so no single one is true. */
  collection?: string;
  /** Artwork identity shared by every colour variant — the STACK key. */
  design?: number;
  /** That variant's colourway ("Cash Green"). */
  tintName?: string;
  /** MUSIC KITS only: the kit's menu theme, ready to play. See `CatalogItem`. */
  audio?: string | null;
}

/** Facet metadata a catalog can ship next to its skins, for the values the
 *  sheet can't name or order by itself (a tab's label, a colourway's swatch). */
export interface SheetFacets {
  groups: { value: string; label: string }[];
  tints: { value: string; label: string; color: string }[];
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
  /** Extraction pipeline version the card bakes are keyed on. See renderKeyFor. */
  renderVersion?: number;
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
  /** Game defindex. Absent = no inspect link is possible for this item. */
  def?: number;
  /** Artwork identity shared by every colour variant — see `Skin.design`. */
  design?: number;
  /** That variant's colourway ("Cash Green"). */
  tintName?: string;
  /** The set it came in — see `Skin.collection`. Present on an OWNED instance
   *  too (the backend resolver fills it), which is what lets the inventory grid
   *  and the loadout sheet sort by collection. */
  collection?: string;
  /**
   * MUSIC KITS only: the kit's menu theme, as a fully resolved, playable URL.
   *
   * Null or absent means this instance has not extracted the audio (or the item
   * is not a music kit), and every surface reads that as "draw no player" — the
   * transport is never rendered against a track that cannot load.
   */
  audio?: string | null;
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
  // NO price here. It rode on this type briefly and was never set: slot values
  // come from /inventory/prices, keyed TEAM:slot, so the loadout paints before
  // money arrives. A permanently-undefined field is worse than none — the next
  // person to reach for `row.value` gets a silent zero.
  /**
   * Attachments, sent only by the PUBLIC player-loadout endpoint.
   *
   * Your own loadout doesn't carry them and doesn't need to: every skinned row
   * there points at something in your inventory, and that item is where the
   * screen reads stickers from. A visitor holds no inventory for the player
   * they are looking at, so nothing could resolve — which is why viewing
   * someone's loadout used to show a bare gun where they had five stickers and
   * a charm. The row brings its own, enriched exactly like an owned item's,
   * minus the `inst` handles: those name rows in the owner's inventory and
   * never leave their account.
   */
  stickers?: PlacedItem[];
  patches?: PlacedItem[];
  charm?: PlacedCharm;
}

// An owned, crafted item instance in the user's inventory.
// `w` is the sticker's own scratch wear (0 pristine .. 1 scratched off) — the
// game's "sticker slot N wear" attribute, not the weapon's float wear.
// `inst` is the owned_items row this attachment IS. Present once it has been
// saved; absent on a catalog pick, which is what tells the server to mint one.
// It must survive the round trip — see the Attach type in App.vue.
export type AttachSpec = { id: number; x?: number | null; y?: number | null; r?: number | null; w?: number | null; inst?: string | null } | null;
export type PlacedItem = (CatalogItem & { x?: number | null; y?: number | null; r?: number | null; w?: number | null; inst?: string | null }) | null;
/** An attached charm: catalog item, its offset on the gun, and the pattern that
 *  grades its material. Named rather than inlined because two shapes carry one
 *  — an owned item and a public loadout row — and they must not drift. */
export type PlacedCharm = (CatalogItem & { x?: number | null; y?: number | null; z?: number | null; seed?: number | null; inst?: string | null }) | null;

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
  charm?: PlacedCharm;
  slot: string | null;
  item: CatalogItem | null;
  equipped: { team: Team; slot: string }[];
  origin?: "crafted" | "steam" | "copied";
  /** This item's own market price. Summing this column across an inventory
   *  counts every thing exactly once — an applied sticker is its own row here
   *  as well as a line on the weapon it sits on. */
  price?: PricePoint | null;
  /** The owned item this one is currently attached to, if it's a sticker,
   *  patch or charm sitting on a weapon. Null when it's loose in the
   *  inventory. Derived server-side from what the weapons actually reference.
   *  A string, like every other owned-item id on the wire — node-postgres
   *  renders bigints as strings, so `id` is `"1014"` and this must match it. */
  attached_to?: string | null;
  /** When this instance was crafted, imported or copied — an ISO string (the
   *  column is timestamptz; node-postgres yields a Date and JSON stringifies
   *  it). Drives the "Recently added" sort. Optional because an older backend
   *  does not send it, and a mode with nothing to sort on has to degrade rather
   *  than reorder the grid at random. */
  created_at?: string | null;
}

/**
 * Anything that carries the facts a screen prints ABOUT one copy: an owned
 * instance, or a public loadout row.
 *
 * Both shapes hold the same enriched `stickers`/`patches`/`charm`, the same
 * StatTrak pair and the same wear/seed/nametag, and every renderer of those
 * facts (ItemBadges, ItemSpecs, attachmentsOf, the 3D placements builder) reads
 * only that overlap. It is named here rather than in each of them because the
 * union is the reason a VISITOR sees anything at all: they hold no inventory for
 * the player they are looking at, so nothing resolves to an InventoryItem and
 * every one of those surfaces would otherwise render a gun with none of the work
 * on it.
 */
export type AttachSource = InventoryItem | LoadoutEntry;

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
// Versioned, for the same reason the paint materials are (see withAssetVersion):
// an icon's filename is cs2-lib's content hash, not ours, so it does NOT change
// when the artwork behind it does — and /images is served `immutable, max-age=1y`.
//
// That combination cached wrong art for a YEAR. Extraction v18 repointed 13,102
// icons at the right event's asset, and every browser and Cloudflare edge kept
// serving the old bytes off an identical URL: `cf-cache-status: HIT` on a
// nine-hour-old copy, with no reload able to touch it. Only the URL changing can
// fix that, and the extraction version is exactly the thing that should change it.
export const assetUrl = (path: string) => withAssetVersion(`${assetOrigin}${path}`);

/** Rewrite every "/images/..." string in a decoded response body in place.
 *  Item art appears under a dozen different keys (item, skin, stickers[],
 *  patches[], charm, agents, collections...), so a walk is materially safer
 *  than enumerating them and silently missing one the next time a shape grows.
 *
 *  "/music/..." joins it for exactly the same reason: a music kit's preview
 *  arrives on both the catalog listing and the owned item, and a bare path in a
 *  federated remote resolves against the PANEL's host, not ours. Riding the
 *  same walk also means the audio picks up the ?v= stamp, which is what lets it
 *  be cached hard without pinning a browser to one CS2 build's track. */
function resolveAssetPaths(node: unknown): unknown {
  if (typeof node === "string") {
    return node.startsWith("/images/") || node.startsWith("/music/") ? assetUrl(node) : node;
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

/** Runtime bits the catalog carries. Applied BEFORE the asset walk below — see
 *  the call in `request`. */
function applyCatalogRuntime(c: Partial<Catalog>) {
  if (c.assetVersion) assetVersion = c.assetVersion;
  if (typeof c.renderVersion === "number") renderVersion = c.renderVersion;
  // Empty string is meaningful — "serve from this host" — so only a non-empty
  // value overrides the default.
  if (c.assetOrigin) assetOrigin = c.assetOrigin;
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
  const body = await response.json();
  // The catalog's OWN images are rewritten by the walk below, so the origin and
  // version it carries have to be in place before that runs — applying them in
  // fetchCatalog afterwards left the first response's URLs unstamped (stale art
  // that no later reload could dislodge) and, on any deployment that sets
  // assetOrigin, pointed them at the wrong host entirely.
  if (path === "/catalog") applyCatalogRuntime(body as Partial<Catalog>);
  return resolveAssetPaths(body) as T;
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

// The runtime bits are applied inside `request`, before it rewrites asset paths.
export const fetchCatalog = () => request<Catalog>("/catalog");

// Cached true-render card images (client 3D snapshots stored on the mount).
// Number() guards: pg numerics can arrive as strings — .toFixed on a string throws.
//
// The version suffix is the EXTRACTION pipeline version, handed over by the
// catalog. It replaced a hand-bumped constant that lived in two files and had
// to be remembered in both; keying on the extraction means a re-extract
// re-bakes every card by itself, which is right — new textures on the mount are
// exactly the thing that changes what a card should look like. Must match
// renderKeyForRow in backend/src/main.ts, and the backend sweeps the superseded
// generation once an extraction finishes.
//
// Safe to read at call time: every caller reaches a card through the inventory,
// which App.vue only sets after fetchCatalog has resolved alongside it. The 0
// fallback is therefore an unstamped mount, not a race — and it is consistent
// with what the backend derives from the same missing stamp, so the two still
// agree on the filename.
//
// The ST flag is in the key (cards draw the module) but the kill count is NOT
// — the 2D module renders a blank display, so a card is identical at 0 kills
// and 4000. Keying on the count would re-bake every card on every kill.
// stattrak is REQUIRED, not optional: an omitted flag silently builds a key
// that disagrees with the one the writer used, and the card 404s forever.
let renderVersion = 0;
export const renderKeyFor = (i: { id: number; wear: number | null; seed: number | null; stattrak: boolean | null }) =>
  `inst-${i.id}-${Number(i.wear ?? 0).toFixed(4)}-${Number(i.seed ?? 0)}${i.stattrak ? "-st" : ""}-v${renderVersion}.png`;
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

/**
 * How many stickers an item can carry — the STACK depth, five on every weapon.
 *
 * NOT the same number as how many anchors the weapon's model declares (4, 5 or
 * 6; see `StickerGeometry.anchorCount`). The two are independent: the stack can
 * outnumber the anchors, and then stickers SHARE one. cs2-lib says so outright
 * ("a model with fewer schemas than stickers shares anchors") and its validator
 * enforces the two separately — five stickers on an AK-47 is legal, a fifth
 * ANCHOR on it is not.
 *
 * Deriving the well count from the anchors instead is what hid the fifth sticker
 * on the sixteen weapons with four: AK-47, AWP, Glock, M4A1, Galil, M249, UMP,
 * PP-Bizon, MAG-7, Negev, Tec-9, MP9, SCAR-20, SG 553, SSG 08, Dual Berettas.
 *
 * Mirrors `STICKER_LIMITS.maxStickers` (cs2-lib's `CS2_MAX_STICKERS`), which the
 * backend enforces in `checkAttachments`. Duplicated rather than fetched because
 * the frontend never imports cs2-lib and the craft form needs the array length
 * before any request resolves.
 */
export const MAX_STICKERS = 5;

/**
 * How many patches an agent can carry — `CS2_MAX_PATCHES`, five.
 *
 * Equal to MAX_STICKERS today and still its own constant: they are unrelated
 * numbers that happen to match, and this file exists to stop that kind of
 * coincidence from being written down once and read as one rule.
 *
 * The equivalent of the anchor count here is `patchSlots` on /api/catalog (3-5,
 * from the agent's own materials) — and unlike sticker anchors that one IS a cap,
 * because the compositor has nowhere to stamp a patch the model never placed.
 */
export const MAX_PATCHES = 5;

// Per-weapon sticker geometry (cached — schema data only moves on a CS2 model
// change). `slots` carries the game's own per-slot UV anchors; `bounds` is the
// looser envelope cs2-lib derives from them.
export type StickerBounds = { x: [number, number]; y: [number, number] };
export interface StickerSlot {
  /** The game's anchor index. NOT a cap on stickers — see MAX_STICKERS. */
  index: number;
  /** "body_hd" | "body_legacy" — must match the body the finish renders on. */
  mesh: string;
  /** UV anchor centred on 0; add 0.5 for TEXCOORD_1 space. */
  offset: [number, number];
  /** UV magnification: the sticker spans 1/scale UV units. */
  scale: number;
  rotation: number;
  special?: string;
  /** Authored placement area as flat 2D triangle soup, same space as `offset`.
   *  Absent on mounts extracted before v12. */
  region?: number[];
}
/**
 * One authored surface a charm may hang from — the game's own `KeychainMarkup`,
 * out of the same model DATA block the sticker anchors come from.
 *
 * This is to a charm what `StickerSlot` is to a sticker: the model saying where
 * the game puts one, rather than us inferring it. And the inference is what it
 * replaces — the `keychain` attachment is a clip point that sits 70mm off an
 * AK-47, 44mm off a MAG-7, so a charm previewed at it hangs in the air.
 * Measured against the rendered mesh, these quads sit 1-3mm off it on every
 * weapon and both bodies, which is the whole reason to carry them.
 */
export interface CharmQuad {
  /** "body_hd" | "body_legacy" — pick the one the finish actually renders on. */
  mesh: string;
  /** The bone that MOVES this surface. `weapon_offset` is the static body;
   *  slide/bolt/silencer/pump quads ride a part that animates in game. Ours
   *  never animates, and all of them measure flush in the pose we render, so
   *  they are all usable here — on a pistol most of the surface IS the slide. */
  bone: string;
  /** 4 corners x XYZ, flat, in GLB space (no base, no cal, no pose). Ordered as
   *  two edges rather than a ring: (0,1) is one end, (2,3) the other. */
  corners: number[];
}
export interface StickerGeometry {
  bounds: StickerBounds | null;
  slots: StickerSlot[];
  /** Charm placement surfaces, empty on a knife (no charms) and on a mount
   *  extracted before v23 — read as "we have no authored answer", not as "this
   *  weapon takes no charm". */
  charmQuads: CharmQuad[];
  /** Anchors the HD body declares. 0 when the mount has no markup for the model
   *  — read that as "unknown", not as "this weapon takes no stickers". */
  anchorCount: number;
  /** Anchors the LEGACY body declares. Differs from `anchorCount` on 14 of the
   *  35 stickerable weapons (AWP 4/5, M4A1 4/7, Deagle 5/4 …), so a legacy paint
   *  must not be placed against the HD count. */
  anchorCountLegacy: number;
}
const stickerGeomCache = new Map<string, Promise<StickerGeometry>>();
export function fetchStickerGeometry(model: string): Promise<StickerGeometry> {
  let cached = stickerGeomCache.get(model);
  if (!cached) {
    cached = request<StickerGeometry>(`/catalog/sticker-bounds/${encodeURIComponent(model)}`)
      .then((r) => ({
        bounds: r.bounds ?? null,
        slots: r.slots ?? [],
        charmQuads: Array.isArray(r.charmQuads) ? r.charmQuads : [],
        // Counted server-side from the same slots, so a client that only wants
        // the number does not re-derive it — and a mount whose markup regressed
        // shows up as a zero here rather than as a mispositioned sticker.
        anchorCount: r.anchorCount ?? 0,
        anchorCountLegacy: r.anchorCountLegacy ?? 0,
      }))
      .catch(() => ({ bounds: null, slots: [], charmQuads: [], anchorCount: 0, anchorCountLegacy: 0 }));
    stickerGeomCache.set(model, cached);
  }
  return cached;
}
export const fetchStickerBounds = (model: string) => fetchStickerGeometry(model).then((g) => g.bounds);

// Facets are normalised at the boundary rather than trusted: frontend and
// backend ship as separate images, so a response from a backend that predates
// them has to read as "this catalog has no facets", not throw in a computed.
export const fetchSkins = (slot: string) =>
  request<{ base: Skin | null; skins: Skin[] } & Partial<SheetFacets>>(
    `/catalog/skins?slot=${encodeURIComponent(slot)}`,
  ).then((r) => ({
    base: r.base ?? null,
    skins: r.skins ?? [],
    groups: Array.isArray(r.groups) ? r.groups : [],
    tints: Array.isArray(r.tints) ? r.tints : [],
  }));

// ---- Collections ------------------------------------------------------------
//
// The case, map or drop pool a finish came out of. The index is small enough to
// hold whole, and it carries the member ids on purpose: "you own 4 of 17" is
// then an intersection with the inventory already in memory, so the badge on a
// tile and the page behind it can never disagree.

/** How you get a collection — the tab strip on the collections index, and what
 *  decides whether its skins can be StatTrak (case) or Souvenir (souvenir). */
export type CollectionSource = "case" | "souvenir" | "drop";

export interface Collection {
  /** cs2-lib's own key ("set_bravo_i") — the handle, not the display name. */
  key: string;
  name: string;
  /** The set's best finish — its art and its rarity colour, so a collection
   *  tile lights the same way an item tile does. */
  image: string | null;
  rarity: string | null;
  source: CollectionSource;
  itemIds: number[];
}

// Normalised here for the same reason every other catalog fetch is: frontend and
// backend ship as SEPARATE images, so a bundle that knows about collections runs
// against a backend that doesn't for as long as it takes both to roll. An empty
// list is what "this backend has no collections" has to look like — the armory
// hides the section rather than showing one that opens onto nothing.
export const fetchCollections = () =>
  request<Collection[]>("/catalog/collections")
    .then((r) => (Array.isArray(r) ? r : []))
    .catch(() => [] as Collection[]);

export const fetchCollection = (key: string) =>
  request<Collection & { skins: Skin[] }>(`/catalog/collection?key=${encodeURIComponent(key)}`).then((r) => ({
    ...r,
    skins: r.skins ?? [],
  }));

export const fetchLoadout = () => request<LoadoutEntry[]>("/loadout");

// ---- Inventory (owned instances) ----
export const fetchInventory = () => request<InventoryItem[]>("/inventory");

export type AttachKind = "sticker" | "charm" | "patch";

/** One value of a picker facet, with how many items carry it. */
export interface AttachFacet {
  value: string;
  /** Absent on rarity facets — those are hex colours the UI names itself. */
  label?: string;
  count: number;
}
/**
 * One page of an attachment search, plus the facets to draw the filter bar.
 *
 * `total` counts every match, not this page, so the picker knows whether
 * scrolling further will find anything. Each facet list is counted with the
 * filters ABOVE it applied and its own ignored (group → collection → rarity), so
 * switching between values within one facet is always possible.
 */
export interface AttachPage {
  items: Skin[];
  total: number;
  /** Matches for the text query ALONE — what the "All" tab counts. Not derivable
   *  from `groups`: "Logos & Art" is a union of two of the others, so summing
   *  them double-counts. */
  queryTotal: number;
  /** Sub-kind: Logos & Art / Signatures / Team Logos / Community, or Charms /
   *  Sticker Slabs. Tab order as shown; "All" is the UI's own, and goes last. */
  groups: AttachFacet[];
  /** Capsule or collection the item came in. */
  collections: AttachFacet[];
  rarities: AttachFacet[];
}
/** Server-side, because the grid only holds the pages it has scrolled through —
 *  sorting those alone would leave the rest arriving in catalog order beneath. */
export type AttachSort = "default" | "rarity" | "name";
export type AttachDir = "asc" | "desc";
export interface AttachFilters {
  q?: string;
  group?: string;
  collection?: string;
  rarity?: string;
  sort?: AttachSort;
  dir?: AttachDir;
  offset?: number;
  limit?: number;
}
// Stickers and charms are ~10.5k items each — searched, faceted and paged
// server-side, and scrolled through rather than truncated. `offset` is simply how
// many are already on screen.
const ATTACH_PATH: Record<AttachKind, string> = { sticker: "stickers", charm: "charms", patch: "patches" };
export async function searchAttachments(kind: AttachKind, filters: AttachFilters = {}): Promise<AttachPage> {
  const query = new URLSearchParams({
    q: filters.q ?? "",
    group: filters.group ?? "",
    collection: filters.collection ?? "",
    rarity: filters.rarity ?? "",
    sort: filters.sort ?? "default",
    dir: filters.dir ?? "",
    offset: String(filters.offset ?? 0),
    limit: String(filters.limit ?? 120),
  });
  // Normalised HERE, at the boundary, so callers can treat every field as
  // present. The frontend and backend ship as SEPARATE images, so a bundle that
  // knows about paging and facets can and does run for a while against an API
  // that doesn't — and this endpoint has had three shapes: a bare array, then
  // {items,total}, now facets too. Trusting the newest shape crashed the picker
  // on `undefined.length` mid-render instead of simply hiding the filter bar.
  const body = await request<Partial<AttachPage> | Skin[]>(`/catalog/${ATTACH_PATH[kind]}?${query}`);
  if (Array.isArray(body)) {
    return { items: body, total: body.length, queryTotal: body.length, groups: [], collections: [], rarities: [] };
  }
  const items = body.items ?? [];
  const total = body.total ?? items.length;
  return {
    items,
    total,
    queryTotal: body.queryTotal ?? total,
    groups: body.groups ?? [],
    collections: body.collections ?? [],
    rarities: body.rarities ?? [],
  };
}

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
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null } | null;
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
    charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null } | null;
  },
) =>
  request<InventoryItem>(`/inventory/${id}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** One wishlisted CATALOG item — something wanted but not owned, so it has no
 *  instance id and nothing to attach a flag to. See setWishlist. */
export interface WishlistEntry {
  item_id: number;
  created_at: string;
  item: CatalogItem | null;
}
export const fetchWishlist = () => request<WishlistEntry[]>("/wishlist");
export const setWishlist = (item_id: number, want: boolean) =>
  request<{ want: boolean }>("/wishlist", {
    method: "POST",
    body: JSON.stringify({ item_id, want }),
  });

// Public read-only loadout for any player + clone it into your own.
//
// `preset` picks WHICH of their named builds to read; omitted, that is the one
// they are wearing. The id is validated server-side against the same steam id,
// so a preset belonging to anyone else 404s rather than quietly returning the
// live loadout under the name you asked for.
export const fetchPlayerLoadout = (steamId: string, preset?: string | null) =>
  request<LoadoutEntry[]>(
    `/loadout/${steamId}${preset ? `?preset=${encodeURIComponent(preset)}` : ""}`,
  );

/** Someone else's named builds. Same shape as your own; nothing here is private
 *  beyond what the equipped loadout already discloses. */
export const fetchPlayerPresets = (steamId: string) =>
  request<LoadoutPreset[]>(`/loadout/${steamId}/presets`);
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

// null = this account has never run a sync (the UI nags about it). Older
// backends don't have the route; callers treat a failure as "already synced"
// rather than nagging everyone on a version skew.
export const fetchSteamSync = () =>
  request<{ syncedAt: string | null }>("/inventory/steam-sync");

// Admin: cached-asset stats + clearing (renders / paints on the mount).
export type DirStat = { files: number; bytes: number };
/**
 * Which slice of a mount a `parts` entry describes. Every one of these is a
 * subdivision of `models` or `paints` above — the totals stay authoritative, so
 * a backend that predates the breakdown just sends no `parts` and the panel
 * falls back to the coarse rows.
 */
export type CachePart =
  | "meshes" // weapon / knife / glove GLBs, plus the shared modules
  | "agents" // agents/models/**, which keep their archive path
  | "charms" // kc_*.glb
  | "compositeInputs" // <weapon>.inputs[.hd] — the paint compositor's sources
  | "modelTextures" // the flat texture pool the GLBs reference
  | "modelMeta" // anchors, sticker markup, the version stamp
  | "paintMaterials" // the finish JSON
  | "paintTextures"; // everything the finish JSON points at

export type CacheStats = {
  renders: DirStat;
  paints: DirStat;
  images?: DirStat; // absent on older backends
  models?: DirStat;
  composites?: DirStat; // shared paint composites; absent on older backends
  /** Music kit previews. ~3.5MB a kit, so it is the one directory an operator
   *  can be surprised by; absent on a mount extracted before v28. */
  music?: DirStat;
  /** Per-kind breakdown of `models` and `paints`. Absent on older backends. */
  parts?: Partial<Record<CachePart, DirStat>>;
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
  /** Key is what this box WOULD extract, not what it has. */
  projected?: boolean;
  /** No CS2 install mounted, so the build can't be verified. */
  buildUnknown?: boolean;
  /** Serving from the CDN without being opted in, because nothing is extracted
   *  here yet. Stops on the first successful extraction. */
  usingFallback?: boolean;
  hasLocalAssets?: boolean;
};
export const fetchAssetCdn = () => request<AssetCdnStatus>("/admin/asset-cdn");
export const setAssetCdn = (enabled: boolean) =>
  request<{ enabled: boolean }>("/admin/asset-cdn", { method: "PUT", body: JSON.stringify({ enabled }) });
// Renders only. Paints and icons are extracted from the server's own CS2
// install with no upstream to re-fetch from, so deleting them breaks rendering
// until someone re-extracts — the backend rejects any other scope.
// Only DERIVED output is clearable — renders and composites are both rebuilt on
// demand by the clients that need them. Paints and icons are refused by the
// backend: those come from the CS2 install and only an extraction restores them.
export const clearCache = (scope: "renders" | "composites" = "renders") =>
  request<{ cleared: Record<string, number> }>(`/admin/cache?scope=${scope}`, { method: "DELETE" });

// ---- Market prices ----------------------------------------------------------
// A mirrored Steam price feed. Off by default and operator-configurable (see the
// Prices tab in the admin console) for the same reason as the asset CDN: the
// fetch leaves their network, so the switch and the URL are both theirs. The
// browser never touches the feed — everything here comes from our API.
export type PriceWindow =
  | "suggested"
  | "median"
  | "lowest"
  | "last_24h"
  | "last_7d"
  | "last_30d"
  | "last_90d";
/** Every source an instance can pull for itself. There is no 5stack price CDN —
 *  see the note in backend/src/prices.ts for why Steam's own market isn't one
 *  of these. */
export type PriceSource = "skinport" | "csfloat" | "waxpeer" | "bitskins" | "feed";

/** One switchable source, as the server describes it. Rendered straight into the
 *  settings list rather than duplicated here — the backend owns which providers
 *  exist and what each is good for, so adding one is a backend change only. */
export interface PriceProviderInfo {
  id: PriceSource;
  label: string;
  blurb: string;
  /** Null means the operator supplies the URL (the JSON feed). */
  url: string | null;
  window: PriceWindow;
}

/** A price never travels as a bare number: which trailing window it came from
 *  is part of the claim. ~38% of listings have no 24h datapoint, so a displayed
 *  price is often a 7- or 30-day average and has to be able to say so. */
export interface PricePoint {
  value: number;
  window: PriceWindow;
  marketHashName: string;
  /**
   * The listing found was NOT the one asked for.
   *
   * Markets don't carry every variant: StatTrak exists for a fraction of
   * finishes and trades thinly, and the ends of the wear range are often
   * unlisted — a Battle-Scarred StatTrak weapon can genuinely have nothing of
   * its own for sale. Rather than showing no price at all, the closest listing
   * answers and says so here.
   *
   * Anything rendering a price MUST make this visible. "$40" and "$40, for the
   * non-StatTrak Field-Tested one" are different claims, and the second is only
   * useful while it stays honest about being a stand-in.
   */
  approx?: { wearTier: number; stattrak: boolean };
}

/** The five Steam wear brackets by their stored index; -1 is "this item has no
 *  bracket" (charms, agents, music kits, vanilla knives). */
export const WEAR_TIER_NAME = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

/** Which bracket a float falls in.
 *
 *  Imports the boundaries rather than restating them. They had been written out
 *  four separate times — catalog.ts (which feeds the SQL), itemVisuals (which
 *  draws the ramp), here, and the test harness — and the failure mode of drift
 *  is the one catalog.ts warns about in capitals: a tile captioned
 *  "Field-Tested" beside a Well-Worn price. itemVisuals imports only a TYPE from
 *  this module, so there is no cycle. */
const wearTierIndexOf = (wear: number) => {
  const i = WEAR_STOPS.findIndex((stop) => wear < stop.max);
  return i === -1 ? WEAR_STOPS.length - 1 : i;
};

/** What was substituted, in words — for the caption beside an approximate
 *  figure. Empty when the listing was the one asked for. */
export function approxNote(price: PricePoint, wear: number | null, stattrak: boolean): string {
  if (!price.approx) return "";
  const parts: string[] = [];
  if (price.approx.stattrak !== stattrak) parts.push(price.approx.stattrak ? "StatTrak™" : "non-StatTrak");
  const asked = wear == null ? -1 : wearTierIndexOf(wear);
  if (price.approx.wearTier !== asked) {
    parts.push(
      price.approx.wearTier === -1 ? "no wear bracket" : WEAR_TIER_NAME[price.approx.wearTier] ?? "another wear",
    );
  }
  return parts.join(", ");
}

export interface PriceStatus {
  enabled: boolean;
  source: PriceSource;
  /** The mirror holds rows a DIFFERENT source produced, so nothing resolves —
   *  a feed fills the trailing averages, a market fills the live-ask columns,
   *  and each source only reads its own. Needs a re-sync, not a bug report. */
  stale?: boolean;
  /** Enabled AND holding data. The gate every price surface reads — an enabled
   *  feed that has never synced must not draw empty price slots. */
  ready: boolean;
  window: PriceWindow;
  listings: number;
  sourceDate: string | null;
  syncedAt: string | null;
}
export const fetchPriceStatus = () => request<PriceStatus>("/prices");

/**
 * Every price the screens need, in one request, deliberately separate from the
 * screens' own data.
 *
 * The inventory and the loadout must paint the moment they're ready — money is
 * an overlay on them, not a precondition. Being its own request also means it
 * can be re-fetched alone: after a craft, after a Steam sync, or the instant a
 * player flips the switch on.
 *
 * `items` is keyed by owned-item id (a string, like every owned id on the wire).
 * `slots` is keyed `TEAM:slot` and is the whole slot — skin plus everything
 * applied to it.
 *
 * There is deliberately NO server-side "what is my inventory worth" endpoint.
 * Every owned row carries its own price here, so the totals — including the
 * real-versus-crafted split on the origin tabs — are summed from rows the client
 * already holds. A second implementation of one number is how two numbers drift.
 */
export interface InventoryPrices {
  ready: boolean;
  window: PriceWindow;
  items: Record<string, PricePoint>;
  slots: Record<string, number>;
}
export const fetchInventoryPrices = () => request<InventoryPrices>("/inventory/prices");

/**
 * What each finish in a slot costs BRAND NEW — the craft browser's price column.
 *
 * Factory New where it exists, the next bracket up where it doesn't: plenty of
 * finishes have a float floor above 0.07 and are never sold Factory New, and
 * pricing those at nothing would drop them out of a sort-by-value entirely.
 * `wearTier` says which bracket answered, so the tooltip can be honest about it.
 */
export interface StockPrices {
  ready: boolean;
  window: PriceWindow;
  prices: Record<string, PricePoint & { wearTier: number }>;
}
export const fetchStockPrices = (slot: string) =>
  request<StockPrices>(`/prices/stock?slot=${encodeURIComponent(slot)}`);

/**
 * What copies of one exact listing recently sold for.
 *
 * The spread behind the single figure. A flat bracket price says a Factory New
 * Karambit Doppler is worth $1,426; this says ten of them sold between $1,205
 * and $1,520 — which is the part a knife owner actually wants, because their
 * float and pattern decide where in that range theirs sits.
 *
 * Only Skinport publishes one (CSFloat and Waxpeer both require an account), so
 * `available` is false on every other source. Phase-aware: `version` is the
 * Doppler phase the rows belong to.
 */
export type HistoryWindow = "last_24_hours" | "last_7_days" | "last_30_days" | "last_90_days";
export interface SaleWindow {
  window: HistoryWindow;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  volume: number;
}
export interface PriceDetail {
  available: boolean;
  window: PriceWindow;
  marketHashName: string | null;
  version: string | null;
  history: SaleWindow[];
}
export const fetchPriceDetail = (itemId: number, wear: number | null, stattrak: boolean) =>
  request<PriceDetail>(
    `/prices/detail?item_id=${itemId}&wear=${wear ?? ""}&stattrak=${stattrak ? 1 : 0}`,
  );

/** The window a spread is worth showing from. Widest first would bury a fresh,
 *  liquid market under three months of noise; narrowest first would show a
 *  single sale as the whole story. Two sales is the floor for a RANGE to mean
 *  anything at all. */
export const bestSaleWindow = (history: SaleWindow[]): SaleWindow | null =>
  history.find((h) => h.volume >= 2) ?? history.find((h) => h.volume >= 1) ?? null;

export const HISTORY_WINDOW_LABEL: Record<HistoryWindow, string> = {
  last_24_hours: "24h",
  last_7_days: "7d",
  last_30_days: "30d",
  last_90_days: "90d",
};

export interface QuoteLine {
  kind: "base" | "sticker" | "patch" | "charm";
  itemId: number;
  name: string | null;
  price: PricePoint | null;
}
export interface Quote {
  base: QuoteLine;
  attachments: QuoteLine[];
  baseTotal: number;
  attachmentTotal: number;
  total: number;
  unpriced: number;
  lines: number;
}
/** What a craft would cost to buy, itemized. Takes the craft form's own body so
 *  the estimate can update before anything is saved. */
export const quoteCraft = (body: {
  item_id: number;
  wear?: number | null;
  stattrak?: boolean | null;
  stickers?: unknown[] | null;
  patches?: unknown[] | null;
  charm_id?: number | null;
}) => request<Quote>("/prices/quote", { method: "POST", body: JSON.stringify(body) });

export interface PriceAdminStatus extends PriceStatus {
  sources: PriceSource[];
  providers: PriceProviderInfo[];
  /** Which source produced the rows in the table right now — not necessarily
   *  the configured one, if it was just changed. */
  syncedSource: PriceSource | null;
  base: string;
  /** The operator typed this URL in; false means it is our default. */
  custom: boolean;
  url: string;
  defaultBase: string;
  windows: PriceWindow[];
  syncing: boolean;
  intervalMinutes: number;
  attemptedAt: string | null;
  failedAt: string | null;
  failure: string | null;
  unmatched: number;
  unmatchedSample: string[];
  /** The sale-history cache — the thing standing between browsing knives and a
   *  rate limit. `listings` were looked up; `withData` had sales to report, and
   *  the rest are cached as "nothing here" so they aren't asked about again. */
  history?: { listings: number; withData: number; oldest: string | null; staleAfterDays: number };
}
export const fetchPriceAdmin = () => request<PriceAdminStatus>("/admin/prices");
export const savePriceAdmin = (body: { enabled?: boolean; base?: string; source?: PriceSource }) =>
  request<{ enabled: boolean; source: PriceSource; base: string; custom: boolean }>("/admin/prices", {
    method: "PUT",
    body: JSON.stringify(body),
  });
export const syncPricesNow = () =>
  request<{ rows: number; unmatched: number; collisions: number }>("/admin/prices/sync", { method: "POST" });
export const clearPrices = () => request<{ listings: number }>("/admin/prices", { method: "DELETE" });

/** Money, short. Sub-$10 keeps cents (a $4.55 charm rounds to a meaningless $5);
 *  above that they are noise on a number that moves by dollars a day, and four
 *  digits of Dragon Lore do not fit in a tile corner. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
  if (value >= 10) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

/** The honest caption for whichever number came back. Every price surface shows
 *  this somewhere: a market's reference price, the middle of what's listed and a
 *  90-day sold average are three different claims, and a bare "$41" implies a
 *  precision none of them has. Always presented as a ROUGH ESTIMATE — none of
 *  these is what an item would actually sell for. */
/** The symbol and the digits, separately.
 *
 *  Money sits among instrument readouts here — floats, seeds, StatTrak counts —
 *  and a full-weight "$" competes with the number it belongs to. Splitting them
 *  lets the glyph sit back at partial opacity while the figure keeps primacy,
 *  which is what makes a price read as a value rather than as one more code. */
export const priceParts = (value: number) => {
  const text = formatPrice(value);
  return { symbol: text.slice(0, 1), digits: text.slice(1) };
};

export const PRICE_WINDOW_LABEL: Record<PriceWindow, string> = {
  suggested: "market estimate",
  median: "median listing",
  lowest: "cheapest listing",
  last_24h: "24-hour average",
  last_7d: "7-day average",
  last_30d: "30-day average",
  last_90d: "90-day average",
};

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  skinport: "Skinport",
  csfloat: "CSFloat",
  waxpeer: "Waxpeer",
  bitskins: "BitSkins",
  feed: "JSON price feed",
};

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
  /** When the last successful run finished, per the script's own stamp — use
   *  this in preference to `finishedAt`, which is only written if the backend
   *  outlived the run it started. */
  lastRunAt?: string | null;
  /** Live progress while a run is going: every step of the pipeline with its
   *  own state, plus a unit count for the steps that know one. The whole list
   *  is present from the start so the panel can show what's still to come. */
  progress?: {
    steps: {
      name: string;
      state: "pending" | "running" | "done";
      done?: number;
      total?: number;
      seconds?: number;
      /** Epoch seconds this step went running — lets the panel count it up.
       *  Absent on backends/scripts older than v10. */
      started?: number;
    }[];
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
  /** How many models the extraction decompiles at once, and what that costs.
   *  Absent on older backends, where the count wasn't adjustable.
   *
   *  This is a memory dial, not a speed dial: the per-worker figures are the
   *  measured peak RSS of ONE worker (a range, because it depends which weapon
   *  the worker draws), so the panel can say what a setting will cost before it
   *  takes the machine out. It defaults to 1 for that reason.
   *
   *  `panelReserveMb` is the headroom to leave for the rest of the 5stack
   *  deployment sharing the box — memory the extraction must not plan to use. */
  workers?: {
    jobs: number;
    cores: number;
    perWorkerMinMb: number;
    perWorkerMaxMb: number;
    panelReserveMb: number;
    memTotalMb: number | null;
    memAvailableMb: number | null;
  };
}
// Plain <a download> hits this: same cookie-auth path the render <img> tags
// use, so no token juggling.
export const extractLogUrl = () => `${API_ORIGIN}/api/admin/extract-models/log`;

export const fetchExtractStatus = () => request<ExtractStatus>("/admin/extract-models");
export const startExtractJob = () =>
  request<{ started: true }>("/admin/extract-models", { method: "POST", body: "{}" });
// Takes effect immediately, including on a run already in progress — the script
// re-reads the count as it works.
export const setExtractJobs = (jobs: number) =>
  request<{ workers: NonNullable<ExtractStatus["workers"]> }>("/admin/extract-models/jobs", {
    method: "PUT",
    body: JSON.stringify({ jobs }),
  });

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
  /** Kills for the StatTrak module. Comes off the owned row, not the form. */
  stattrak_count?: number | null;
  nametag?: string | null;
  stickers?: AttachSpec[];
  patches?: AttachSpec[];
  charm_id?: number | null;
  charm_offset?: { x?: number | null; y?: number | null; z?: number | null; seed?: number | null } | null;
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

// ---- Loadout presets --------------------------------------------------------
// Named builds. Only ONE of them is "the loadout" at a time — the rest are
// parked server-side — so every mutation below changes what `fetchLoadout`
// returns, and callers refresh rather than patch their copy.

export interface LoadoutPreset {
  /** A bigint on the wire, i.e. a STRING, same as every owned-item id here.
   *  Compare with `String(...)` and never with `===` against a literal number. */
  id: string;
  name: string;
  /** The one whose slots are the live loadout. Exactly one is ever true. */
  active: boolean;
  /** Filled slots across both teams — what the switcher shows under the name. */
  slots: number;
}

export const fetchPresets = () => request<LoadoutPreset[]>("/loadout/presets");

/** `copy: true` seeds the new preset from the loadout you are wearing now.
 *  It does NOT duplicate the owned items — both presets point at the same
 *  crafted instances, because crafting is the gate and a preset is only an
 *  arrangement of what you already own. */
export const createPreset = (body: { name?: string; copy?: boolean } = {}) =>
  request<LoadoutPreset>("/loadout/presets", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const renamePreset = (id: string, name: string) =>
  request<{ id: string; name: string; active: boolean }>(`/loadout/presets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

/** Deleting the preset you are wearing moves you to another one, so the
 *  response names whichever is active afterwards. */
export const deletePreset = (id: string) =>
  request<{ ok: true; active: string }>(`/loadout/presets/${id}`, { method: "DELETE" });

export const activatePreset = (id: string) =>
  request<{ ok: true; active: string }>(`/loadout/presets/${id}/activate`, {
    method: "POST",
    body: "{}",
  });
