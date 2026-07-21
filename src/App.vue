<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, provide } from "vue";
import { cn } from "@5stack/ui";
import {
  Loader2, Search, LayoutGrid, Crosshair,
  Package, Hammer, Trash2, Copy, RotateCcw, Sparkles, Replace, RefreshCw, Pencil, Plus, X, Download, CheckSquare, Settings, Box, Clock,
  Image as ImageIcon, Check, ExternalLink, SlidersHorizontal,
} from "lucide-vue-next";
import {
  fetchCatalog,
  fetchSkins,
  searchStickers,
  searchCharms,
  searchPatches,
  fetchCatalogItems,
  fetchLoadout,
  fetchInventory,
  craftItem,
  updateInstance,
  deleteInstance,
  fetchInspectLink,
  fetchDraftInspectLink,
  fetchServerApiKey,
  fetchExtractStatus,
  type ExtractStatus,
  fetchPlayerLoadout,
  importSteamInventory,
  API_ORIGIN,
  equip,
  swapLoadout,
  unequip,
  type Team,
  type CatalogWeapon,
  type DefaultsMap,
  type CatalogItem,
  type Skin,
  type LoadoutEntry,
  type InventoryItem,
  type AttachSpec,
  fetchStickerGeometry,
  uploadRender,
  renderUrlFor,
  type CfgSyncResult,
} from "./api";
import { usePluginRouter, type HostRouting } from "./pluginRouter";
import {
  parsePath,
  buildPath,
  screenFor,
  type Route,
  foreignQuery,
  encodeDraft,
  decodeDraft,
  draftItemIds,
  TRANSIENT_QUERY_KEYS,
  type ItemModal,
  type ShareLink,
  type Draft,
} from "./routes";
import AdminConsole from "./AdminConsole.vue";
import ShareMenu from "./ShareMenu.vue";
import Tooltip from "./Tooltip.vue";
import { MDEBUG, mdebug, setMdebugAmbient, traceLayer } from "./mdebug";
import ItemArt from "./ItemArt.vue";
import ItemName from "./ItemName.vue";
import SlotStatus from "./SlotStatus.vue";
import WearBar from "./WearBar.vue";
import ItemTile from "./ItemTile.vue";
import TileActions from "./TileActions.vue";
import FilterDropdown from "./FilterDropdown.vue";
import { attachmentsOf, CARD_ART, CARD_CHROME_PX, glowStyle, isReadOnly, itemName, STEAM_BLUE, wearTier } from "./itemVisuals";
import { isCompact, isCoarse } from "./responsive";
import { hasModel, hasModelSync, mountViewer, snapshotModel, viewersIdle, viewerStats, type ViewerHandle, type StickerPlacement, type CharmPlacement } from "./viewer3d";
import "./style.css";

// `user` plus the host's routing contract (base/path/query/navigate) — see
// pluginRouter.ts. Standalone, none of the routing props are passed and the
// router falls back to the History API.
interface Props extends HostRouting {
  user?: { steam_id: string; name: string; role: string } | null;
}
const props = defineProps<Props>();
const router = usePluginRouter(props);

// ---- state ------------------------------------------------------------------
const weapons = ref<CatalogWeapon[]>([]);
const specialDefaults = ref<DefaultsMap | null>(null);
const loadout = ref<LoadoutEntry[]>([]);
const inventory = ref<InventoryItem[]>([]);
const loading = ref(true);
const error = ref(""); // fatal (initial load) error — shows a retry screen
const notice = ref(""); // transient toast — never breaks the UI
const noticeKind = ref<"error" | "success">("error");
// Viewer mode: ?player=<steam64> shows that player's loadout read-only. The
// query is host-owned now, so a back/forward between two shared links reloads
// into the right player instead of stranding the old one on screen.
const playerParam = computed(() => {
  const p = router.query.value.player;
  return p && /^\d{17}$/.test(p) ? p : null;
});
const viewerId = ref<string | null>(playerParam.value);
// Embed mode: ?embed=1 means we're mounted inside a host page (the Inventory tab
// on /players/:steamid) rather than owning the screen at /apps/inventory. Note
// this is NOT `router.embedded` — that's "mounted in the panel at all", which is
// true for both. Here the host page already supplies the framing, so we drop our
// own full-viewport height and header chrome.
const embedMode = computed(() => router.query.value.embed === "1");
// In a profile tab we stay read-only even on our OWN profile, so "is this me?"
// is a separate question from "is this read-only?" — it's what suppresses the
// copy-to-my-inventory action, which would otherwise offer to copy your loadout
// onto itself.
const viewingSelf = computed(
  () => !!viewerId.value && viewerId.value === props.user?.steam_id,
);
// Anonymous browsing: the whole app is public. A signed-out visitor gets the
// catalog and the full craft sandbox — the preview is entirely client-side, so
// it costs us nothing — but has no inventory and no loadout to act on.
const signedIn = computed(() => !!props.user?.steam_id);
// The one gate every mutation funnels through. Two independent reasons to be
// read-only: you're looking at someone else's profile, or you aren't signed in.
// Deliberately NOT applied to the craft editor or the picker sheet that reaches
// it — crafting is the thing we want anonymous visitors to be able to do. It
// gates the *save*, not the build.
const canEdit = computed(() => !viewerId.value && signedIn.value);
const team = ref<Team>("CT");

// ---- routes -----------------------------------------------------------------
// Screens AND modals are URLs. The host hands us the path below /apps/inventory
// and a navigate callback, so tabs, the browser's back button and a pasted link
// all drive the same state — no second router inside the remote. The route
// table itself lives in routes.ts; this file only reacts to it.
//
//   /                    loadout          /items/<id>        item detail
//   /focus               focus view       /items/<id>/craft  craft editor
//   /items               inventory        /items/<id>/3d     3D viewer
//   /admin[/section]     admin            /craft/<skinId>    unsaved draft
const route = computed(() => parsePath(router.path.value));

// Paths a modal was opened from, so closing it can go back. Declared up here
// with the rest of the routing because `view` reads it — see below. Paths only,
// no queries: the query is rebuilt from live state on the way back, so a team
// switch made INSIDE the editor survives closing it instead of being reverted
// to whatever was in the URL when the modal opened. Capped, because a stack
// this deep is already a user clicking in circles.
const modalReturn = ref<string[]>([]);
const MAX_RETURN_DEPTH = 8;
/** Does this path open a modal rather than a plain screen? */
const isModalPath = (path: string) => {
  const r = parsePath(path);
  return r.name === "item" || r.name === "draft";
};

// The screen rendered BEHIND whatever modal is open. Editing an item from the
// loadout has to leave the LOADOUT on screen — flipping to the inventory just
// because the URL now says /items/<id>/craft is the same "it moved me somewhere
// else" complaint that motivated all of this, just relocated.
//
// Captured ONCE, when the modal opens, rather than derived from the return
// stack on every read. The stack is mutable and lossy — it's popped on close,
// emptied whenever the route watcher sees a non-modal route, and skips its push
// when one modal opens another — and `screenFor` sends any item route it can't
// place to "inventory". So an empty or stale stack silently flipped the loadout
// to the items screen the instant Edit was pressed. The backdrop is a property
// of the screen you were on, not of the URL, so it's stored, not inferred.
const modalBackdrop = ref<ReturnType<typeof screenFor> | null>(null);
const view = computed(() => {
  const r = route.value;
  if (r.name === "item" || r.name === "draft") {
    if (modalBackdrop.value) return modalBackdrop.value;
    // Nothing captured: a cold-loaded link. `?from=` is how a SHARED link keeps
    // its backdrop — the recipient gets the same screen behind the modal the
    // sender had, and closing it lands there instead of on an unrelated screen.
    // Validated against the known screens: `from` is user-editable, and an
    // unrecognised value must degrade to the natural screen, not blank the app.
    const from = router.query.value.from;
    if (from && from in SCREEN_ROUTE) return from as ReturnType<typeof screenFor>;
    const origin = modalReturn.value[modalReturn.value.length - 1];
    if (origin) return screenFor(parsePath(origin));
  }
  return screenFor(r);
});
/** The route each top-level screen lives at — the inverse of `screenFor`. */
const SCREEN_ROUTE: Record<ReturnType<typeof screenFor>, Route> = {
  grid: { name: "loadout" },
  focus: { name: "focus" },
  inventory: { name: "inventory" },
  admin: { name: "admin", section: "" },
};
const adminSection = computed(() => (route.value.name === "admin" ? route.value.section : ""));
const routeItemId = computed(() => (route.value.name === "item" ? route.value.id : null));
const routeItemModal = computed<ItemModal | null>(() =>
  route.value.name === "item" ? route.value.modal : null,
);
const routeDraftSkinId = computed(() => (route.value.name === "draft" ? route.value.skinId : null));
const routeWants2d = computed(() => router.query.value.d === "2");

// Defaults are omitted from the URL, so a plain link stays readable. These are
// the values the absence of a param means.
const DEFAULT_SLOT = "r2";
const DEFAULT_TEAM: Team = "CT";

// The query for a destination, rebuilt from live state rather than carried
// along blindly — that's what keeps ?slot off the inventory URL and ?q off the
// loadout URL. `extra` is merged last so a caller can pin a transient flag.
// Non-router keys (?player=) ride through untouched via foreignQuery.
function viewQuery(to: string, extra: Record<string, string> = {}): Record<string, string> {
  const r = parsePath(to);
  const out: Record<string, string> = foreignQuery(router.query.value);
  if (team.value !== DEFAULT_TEAM) out.team = team.value;
  if (r.name === "loadout" || r.name === "focus") {
    if (selected.value !== DEFAULT_SLOT) out.slot = selected.value;
  }
  // Re-attach the modal's backdrop on every hop between modal modes
  // (detail → craft → 3d), or it would be rebuilt away on the first one.
  // Omitted when it matches the screen the path already implies, so the common
  // case (opening an item from the inventory) keeps a clean URL.
  if ((r.name === "item" || r.name === "draft") && modalBackdrop.value) {
    if (modalBackdrop.value !== screenFor(r)) out.from = modalBackdrop.value;
  }
  if (r.name === "inventory" || r.name === "item") {
    if (invSearch.value.trim()) out.q = invSearch.value.trim();
    if (invOrigin.value !== "all") out.origin = invOrigin.value;
    if (invTypes.value.length) out.cat = invTypes.value.join(".");
    if (invModels.value.length) out.wep = invModels.value.join(".");
    if (invSort.value !== DEFAULT_SORT) out.sort = invSort.value;
  }
  return { ...out, ...extra };
}
// Transient params (?d=2, draft state) belong to the screen you're on. syncUrl
// re-attaches them when view state changes, so nudging the CT/T toggle inside
// the craft editor doesn't wipe the draft out of the URL.
function transientQuery(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TRANSIENT_QUERY_KEYS) {
    const v = router.query.value[k];
    if (v != null) out[k] = v;
  }
  return out;
}
const go = (to: string, options: { replace?: boolean; query?: Record<string, string> } = {}) =>
  router.go(to, { replace: options.replace, query: viewQuery(to, options.query) });
// Loadout ↔ Inventory are sibling screens, and Inventory sits to the RIGHT of
// Loadout in the tab bar — so it slides in from the right and pushes Loadout
// out to the left. Direction is read at transition time, when `view` already
// holds the incoming screen, so enter/leave stay on the same axis.
const viewEnterFrom = computed(() =>
  view.value === "inventory" ? "opacity-0 translate-x-4" : "opacity-0 -translate-x-4",
);
const viewLeaveTo = computed(() =>
  view.value === "inventory" ? "opacity-0 -translate-x-4" : "opacity-0 translate-x-4",
);
const DEFAULT_WEAR = 0;

// ---- CS2 positional loadout slots -------------------------------------------
// Like CS2: 1 starting pistol + 4 other pistols, 5 mid-tier, 5 rifles per team.
// Users pick WHICH weapon occupies each slot (right-click → replace), and each
// slot's finish comes from their crafted inventory.
const POSITION_GROUPS = [
  { key: "pistols", label: "Pistols", positions: ["sp", "p1", "p2", "p3", "p4"] },
  { key: "midtier", label: "Mid-Tier", positions: ["m1", "m2", "m3", "m4", "m5"] },
  { key: "rifles", label: "Rifles", positions: ["r1", "r2", "r3", "r4", "r5"] },
] as const;
const START_PISTOLS = ["glock", "usp_silencer", "hkp2000"];
const isWeaponPos = (s: string) => /^(sp|p[1-4]|m[1-5]|r[1-5])$/.test(s);
const isSpecial = (s: string) => ["knife", "gloves", "agent", "zeus", "c4", "musickit", "graffiti"].includes(s);
const isShared = (s: string) => ["zeus", "c4", "musickit", "graffiti"].includes(s);
// "Special" is a LAYOUT concept (slot rail, catalog fetch, sheet keys) and was
// doing double duty as the 3D gate, which is why knives could never show 3D
// even once their GLBs existed. Split: this is the 3D one, and it's about
// whether a slot resolves to something we have a model for. Knives do now.
// zeus is a one-entry removal away (its GLB already ships); c4 needs a MAP
// entry; gloves/agents need their own extraction and shader work.
const isNo3d = (s: string) => ["gloves", "agent", "zeus", "c4", "musickit", "graffiti"].includes(s);
// Origin filter — the same control on the Inventory grid and on the loadout
// sheet's Owned section, so "hide my Steam imports" works the same in both.
type OriginFilter = "all" | "steam" | "crafted";
const ORIGIN_FILTERS = [
  ["all", "All"],
  ["steam", "Synced"],
  ["crafted", "Crafted"],
] as const;
// The inventory filter rail's taxonomy. An inventory mixes weapons, knives,
// gloves, agents and the sticker/charm/patch catalogs, and a name search only
// helps when you already know what you're looking for — "show me my charms"
// needs a filter. Weapons split by their CS2 category so the rail speaks the
// loadout's own Pistols / Mid-Tier / Rifles vocabulary instead of exposing raw
// cs2-lib types.
const WEAPON_GROUPS = [
  ["rifle", "Rifles"],
  ["smg", "SMGs"],
  ["heavy", "Heavy"],
  ["secondary", "Pistols"],
  ["melee", "Knives"],
  ["glove", "Gloves"],
] as const;
// Types with no per-model breakdown worth drawing — one toggle each.
const GEAR_TYPES = [
  ["agent", "Agents"],
  ["sticker", "Stickers"],
  ["keychain", "Charms"],
  ["patch", "Patches"],
  ["musickit", "Music Kits"],
  ["graffiti", "Graffiti"],
] as const;
const WEAPONISH = new Set<string>(WEAPON_GROUPS.map(([k]) => k));
// Weapons are addressed by their category ("rifle"), everything else by its
// cs2-lib type ("keychain") — the two never collide, so one key space covers both.
const categoryOf = (i: InventoryItem): string =>
  i.item?.type === "weapon" ? i.item?.category ?? "weapon" : i.item?.type ?? "";
// "usp_silencer" -> "USP Silencer", for models the weapon catalog doesn't name
// (knives and gloves aren't in it).
const prettyModel = (m: string) =>
  m.split("_").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
const matchesOrigin = (i: InventoryItem, f: OriginFilter) =>
  f === "all" || (f === "steam" ? isReadOnly(i) : !isReadOnly(i));
function catsForPos(pos: string): string[] {
  if (pos === "sp" || /^p/.test(pos)) return ["secondary"];
  if (/^m/.test(pos)) return ["smg", "heavy"];
  return ["rifle"];
}
// CS2 default loadouts (cs2-lib model names).
const DEFAULTS: Record<Team, Record<string, string>> = {
  CT: {
    sp: "usp_silencer", p1: "elite", p2: "p250", p3: "fiveseven", p4: "deagle",
    m1: "mp9", m2: "mp7", m3: "ump45", m4: "p90", m5: "nova",
    r1: "famas", r2: "m4a1", r3: "ssg08", r4: "aug", r5: "awp",
    knife: "knife",
  },
  T: {
    sp: "glock", p1: "elite", p2: "p250", p3: "tec9", p4: "deagle",
    m1: "mac10", m2: "mp7", m3: "ump45", m4: "p90", m5: "nova",
    r1: "galilar", r2: "ak47", r3: "ssg08", r4: "sg556", r5: "awp",
    // Without this the slot falls through to the literal pos ("knife"), which
    // is a real cs2-lib key — but the CT default, so T showed a CT knife.
    knife: "knife_t",
  },
};

const RAIL = [
  { slot: "agent", name: "Agent" },
  { slot: "gloves", name: "Gloves" },
  { slot: "knife", name: "Knife" },
];
// Extra equipment slots (CS2 inventory-simulator parity).
const EXTRAS = [
  { slot: "zeus", name: "Zeus x27" },
  { slot: "c4", name: "C4" },
  { slot: "musickit", name: "Music Kit" },
  { slot: "graffiti", name: "Graffiti" },
];
const ALL_SPECIALS = [...RAIL, ...EXTRAS];

// ---- team accent ------------------------------------------------------------
// T uses the panel's brand amber (--tac-amber + its CTA gradient endpoints) so
// the plugin tracks the host's live branding; CT gets the CS2 blue.
const accent = computed(() =>
  team.value === "T" ? "hsl(var(--tac-amber, 33 94% 58%))" : "#4a8fe0",
);
const gradient = computed(() =>
  team.value === "T"
    ? "linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16))"
    : "linear-gradient(135deg, #4a8fe0, #6fb3ff)",
);
// Built on var(--acc) rather than the computed hex so it rides the registered
// property's crossfade when the team flips (see @property --acc in style.css).
const accentSoft = "color-mix(in srgb, var(--acc) 16%, transparent)";
// One class string for the item modal's secondary actions so the row can't
// drift into three slightly different heights and two text sizes again.
// BROWSE and SELECT are two toolbars that swap in the same place, and they used
// to size to their own content — so entering select mode nudged the whole grid.
// Two halves, BOTH required:
//   1. h-8 on the search input, so the browse bar's height stops depending on
//      the input's INHERITED line-height (a free variable this file doesn't
//      control). Every tall control in that bar is now 32px.
//   2. this min-height, which pins the shorter select bar to match.
//
// The number is 53, not 52, and the border is why. box-sizing is border-box, so
// min-height INCLUDES the 1px border-b:
//   browse = 10 (py) + 32 (h-8) + 10 (py) + 1 (border) = 53px  -> natural
//   select = 10 +  ~26 (py-1.5 + f10) + 10 + 1        = 47px  -> pinned to 53
// At 52 the browse bar sat one pixel ABOVE the threshold so the min-height
// never applied to it, while select was pinned to exactly 52 — which is
// precisely the 1px jump. flex-wrap still lets both grow on narrow viewports.
// flex-nowrap, NOT flex-wrap: a second row here is worse than a slightly
// cramped first one — it pushes the grid down by ~40px and the controls that
// wrapped (rarity, sort) ended up below the search field they qualify. Nothing
// here overflows now that Sync Steam moved to the header; the search field is
// the one shrinkable item, and it absorbs whatever's left. Deliberately no
// overflow-x-auto — the filter dropdowns are absolutely positioned, and a
// scroll container would clip their menus.
const INV_TOOLBAR =
  "flex min-h-[53px] flex-none flex-nowrap items-center gap-2.5 border-b pr-6 py-2.5";
// The toolbar spans rail + grid, so its left edge has two things it could line
// up with. Whenever the rail is actually drawn it wins: the search field then
// sits flush with the rail's Clear button and the filter tiles under it. With
// no rail (or below `lg`, where it's hidden) it falls back to the grid's p-6.
const INV_TOOLBAR_PL = computed(() => (invRailShown.value ? "pl-6 lg:pl-2.5" : "pl-6"));
// Focus view's action row (Inspect / Share / StatTrak / Unequip): one height,
// one radius, one type size — they drifted into four slightly different pills.
//
// min-w + justify-center because equal height alone didn't read as equal: the
// labels are different lengths, so the pills shrink-wrapped to different widths
// and the pair looked mismatched rather than like one set of controls.
const FOCUS_ACTION =
  "flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-md border px-3.5 text-f11 font-medium uppercase tracking-wider transition-colors";
function selRing(on: boolean) {
  return on ? { borderColor: "var(--acc)", boxShadow: "0 0 0 1px var(--acc)" } : {};
}

// ---- loadout lookup ---------------------------------------------------------
const loadoutMap = computed(() => {
  const map = new Map<string, LoadoutEntry>();
  for (const e of loadout.value) map.set(`${e.team}:${e.slot}`, e);
  return map;
});
function rowFor(pos: string, t: Team = team.value): LoadoutEntry | undefined {
  if (isShared(pos)) {
    return loadoutMap.value.get(`CT:${pos}`) ?? loadoutMap.value.get(`T:${pos}`);
  }
  return loadoutMap.value.get(`${t}:${pos}`);
}
const weaponByModel = computed(() => new Map(weapons.value.map((w) => [w.model, w])));
// The weapon model occupying a position (equipped row wins, else team default).
function occupantModel(pos: string, t: Team = team.value): string {
  const row = rowFor(pos, t);
  return row?.item?.model ?? DEFAULTS[t][pos] ?? pos;
}
function occupantWeapon(pos: string): CatalogWeapon | undefined {
  return weaponByModel.value.get(occupantModel(pos));
}
// A row equipping a crafted skin (vs a free default-weapon row). Reads the
// server's `skinned` flag, NOT the instance id: viewing another player, the id
// is withheld on purpose, and testing it made every one of their cells look
// unskinned — right art, but "Default" names and a base-model focus view.
const isSkinned = (row?: LoadoutEntry) => !!row?.skinned;
function skinLabel(pos: string): string {
  const row = rowFor(pos);
  if (!row || !isSkinned(row)) return "Default";
  return itemName(row.item, { strip: true });
}
// The crafted item occupying a cell, or null for a free default-weapon slot.
// Templates render this through <ItemName>/<WearBar>; skinLabel stays for the
// plain-string 3D title.
const cellItem = (pos: string) => (isSkinned(rowFor(pos)) ? rowFor(pos)?.item ?? null : null);
const cellWear = (pos: string) => (isSkinned(rowFor(pos)) ? rowFor(pos) ?? null : null);
function rarityOf(pos: string): string | undefined {
  const row = rowFor(pos);
  return isSkinned(row) ? row?.item?.rarity : undefined;
}
// The stock/default item shown in a special slot when nothing is crafted.
function specialDefault(slot: string): CatalogItem | null {
  const d = specialDefaults.value;
  if (!d) return null;
  if (slot === "knife" || slot === "gloves" || slot === "agent") return d[slot]?.[team.value] ?? null;
  if (slot === "zeus" || slot === "c4" || slot === "musickit") return d[slot] ?? null;
  return null;
}
function specialImage(slot: string): string | undefined {
  return rowFor(slot)?.item?.image ?? specialDefault(slot)?.image ?? undefined;
}
function specialLabel(slot: string): string {
  const row = rowFor(slot);
  if (row?.item) return itemName(row.item);
  return specialFallback(slot);
}
// Shown when a gear slot holds nothing crafted.
function specialFallback(slot: string): string {
  if (slot === "agent") return team.value === "CT" ? "SAS (Default)" : "Phoenix (Default)";
  return specialDefault(slot)?.name ?? "Default";
}
function cellImage(pos: string): string | undefined {
  const row = rowFor(pos);
  return row?.item?.image ?? occupantWeapon(pos)?.image ?? undefined;
}
// pg bigints serialize as STRINGS — every instance-id comparison must be
// string-normalized or lookups silently miss (loadout tiles then fall back
// to catalog art instead of the instance's true render).
function instanceById(id: unknown): InventoryItem | undefined {
  return id != null ? inventory.value.find((i) => String(i.id) === String(id)) : undefined;
}
function cellInstance(pos: string): InventoryItem | undefined {
  return instanceById(rowFor(pos)?.item_instance_id);
}
// Which teams the shown instance is equipped on at this slot — the at-a-glance
// answer to "did that copy land on both sides or just this one?". Same dots as
// ItemTile, so the mark reads identically everywhere.
function cellTeams(pos: string): Team[] {
  const eq = cellInstance(pos)?.equipped ?? [];
  return (["CT", "T"] as Team[]).filter((t) => eq.some((e) => e.team === t && e.slot === pos));
}
// Grid cells prefer the instance's true render when one exists this session.
function cellSrc(pos: string): string | undefined {
  const inst = cellInstance(pos);
  return inst ? renderSrc(inst) : cellImage(pos);
}

// Grid cells per column for the current team.
const columnsView = computed(() =>
  POSITION_GROUPS.map((g) => ({
    ...g,
    skinned: g.positions.filter((p) => isSkinned(rowFor(p))).length,
    cells: g.positions.map((pos) => ({
      pos,
      weapon: occupantWeapon(pos),
      row: rowFor(pos),
    })),
  })),
);

// ---- selection + bottom sheet ----------------------------------------------
const selected = ref<string>("r2"); // AK-47 / M4A4 slot
// Signed out there is no "owned" tab to land on, so the sandbox is the default
// rather than an empty shelf.
const sheetMode = ref<"owned" | "craft" | "replace">(signedIn.value ? "owned" : "craft");
const skinsCache = new Map<string, { base: Skin | null; skins: Skin[] }>();
const sheetSkins = ref<Skin[]>([]);
const sheetLoading = ref(false);
const sheetSearch = ref("");
const activeRarity = ref<string>("");

// What the sheet is about: the weapon occupying the selected position (or the
// special slot type).
const sheetKey = computed(() => (isSpecial(selected.value) ? selected.value : occupantModel(selected.value)));
const sheetWeaponName = computed(() => {
  if (isSpecial(selected.value)) return ALL_SPECIALS.find((r) => r.slot === selected.value)?.name ?? selected.value;
  return occupantWeapon(selected.value)?.name ?? selected.value;
});

async function loadSkins(key: string) {
  sheetLoading.value = true;
  try {
    let data = skinsCache.get(key);
    if (!data) {
      data = await fetchSkins(key);
      skinsCache.set(key, data);
    }
    if (sheetKey.value !== key) return; // a newer selection won
    sheetSkins.value = data.skins;
  } catch (e) {
    fail(e);
  } finally {
    if (sheetKey.value === key) sheetLoading.value = false;
  }
}
watch(sheetKey, (key) => {
  sheetSearch.value = "";
  activeRarity.value = "";
  sheetSkins.value = [];
  loadSkins(key);
});
// Switching sheet modes also resets the filters so nothing "sticks".
watch(sheetMode, () => {
  sheetSearch.value = "";
  activeRarity.value = "";
});
function selectPos(pos: string) {
  const changed = selected.value !== pos;
  selected.value = pos;
  if (changed || sheetMode.value === "replace") sheetMode.value = signedIn.value ? "owned" : "craft";
}

// ---- rarity facets (rarity is a hex color from cs2-lib) ---------------------
const RARITY_META: Record<string, { name: string; rank: number }> = {
  "#b0c3d9": { name: "Consumer", rank: 1 },
  "#5e98d9": { name: "Industrial", rank: 2 },
  "#4b69ff": { name: "Mil-Spec", rank: 3 },
  "#8847ff": { name: "Restricted", rank: 4 },
  "#d32ce6": { name: "Classified", rank: 5 },
  "#eb4b4b": { name: "Covert", rank: 6 },
  "#e4ae39": { name: "★ Rare", rank: 7 },
  "#ffd700": { name: "★ Rare", rank: 7 },
  "#ffae39": { name: "★ Rare", rank: 7 },
};
function rarityName(hex?: string) {
  return (hex && RARITY_META[hex.toLowerCase()]?.name) || "Special";
}
const rarityFacets = computed(() => {
  const seen = new Map<string, number>();
  for (const s of sheetSkins.value) {
    if (s.rarity) seen.set(s.rarity, RARITY_META[s.rarity.toLowerCase()]?.rank ?? 8);
  }
  // Least → greatest (Consumer first, Covert/★ last), like the game.
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([hex]) => ({ hex, name: rarityName(hex) }));
});
// Rarity facets for the Inventory grid — over what's OWNED, not a catalog.
const invRarity = ref<string>("");
const invRarityFacets = computed(() => {
  const seen = new Map<string, number>();
  for (const i of inventory.value) {
    const r = i.item?.rarity;
    if (r) seen.set(r, RARITY_META[r.toLowerCase()]?.rank ?? 8);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([hex]) => ({ hex, name: rarityName(hex) }));
});

// ---- sorting ----------------------------------------------------------------
// One control on the Inventory grid, one on the sheet (Owned + Craft share
// it). "Default" is whatever order the source already has: newest-first for
// owned items, catalog order for finishes. Both persist.
type SortMode = "default" | "rarity" | "name" | "wear";
const SORTS: [SortMode, string][] = [
  ["default", "Default"],
  ["rarity", "Rarity"],
  ["name", "Name"],
  ["wear", "Wear"],
];
const rarityRank = (hex?: string | null) => (hex && RARITY_META[hex.toLowerCase()]?.rank) || 0;
// Rarity, not insertion order: an inventory reads better with the covert reds
// at the top than with whatever you happened to craft last.
const DEFAULT_SORT: SortMode = "rarity";
const invSort = ref<SortMode>((localStorage.getItem("cs2inv.invSort") as SortMode | null) ?? DEFAULT_SORT);
watch(invSort, (v) => localStorage.setItem("cs2inv.invSort", v));
const sheetSort = ref<SortMode>((localStorage.getItem("cs2inv.sheetSort") as SortMode | null) ?? DEFAULT_SORT);
watch(sheetSort, (v) => localStorage.setItem("cs2inv.sheetSort", v));
const byName = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "");
function sortInstances(list: InventoryItem[], mode: SortMode): InventoryItem[] {
  if (mode === "default") return list;
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => byName(itemName(a.item), itemName(b.item)));
  if (mode === "wear") return arr.sort((a, b) => (a.wear ?? 1) - (b.wear ?? 1));
  return arr.sort((a, b) => rarityRank(b.item?.rarity) - rarityRank(a.item?.rarity) || byName(itemName(a.item), itemName(b.item)));
}
function sortSkins(list: Skin[], mode: SortMode): Skin[] {
  if (mode === "default" || mode === "wear") return list; // catalog skins have no wear
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => byName(a.name, b.name));
  return arr.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || byName(a.name, b.name));
}

const teamOk = (teams?: Team[] | null) => !teams || teams.length === 0 || teams.includes(team.value);
const matchesFilters = (name?: string, rarity?: string) => {
  const q = sheetSearch.value.trim().toLowerCase();
  return (
    (!q || (name ?? "").toLowerCase().includes(q)) &&
    (!activeRarity.value || rarity === activeRarity.value)
  );
};

// Sheet: skins you OWN for the selected slot's weapon. The origin filter is
// persisted — people who never want to equip their read-only Steam imports set
// it to Crafted once and it stays that way.
const sheetOrigin = ref<OriginFilter>(
  (localStorage.getItem("cs2inv.sheetOrigin") as OriginFilter | null) ?? "all",
);
watch(sheetOrigin, (v) => localStorage.setItem("cs2inv.sheetOrigin", v));
const ownedForSheet = computed(() =>
  sortInstances(
    inventory.value.filter(
      (i) =>
        i.slot === sheetKey.value &&
        matchesFilters(itemName(i.item), i.item?.rarity) &&
        matchesOrigin(i, sheetOrigin.value) &&
        (selected.value !== "agent" || teamOk(i.item?.teams)),
    ),
    sheetSort.value,
  ),
);
// Sheet: ALL catalog skins for the weapon (craft mode).
const craftList = computed(() =>
  sortSkins(
    sheetSkins.value.filter(
      // itemName folds in the phase, so "ruby" / "phase 2" find the right Doppler.
      (s) => matchesFilters(itemName(s), s.rarity) && (selected.value !== "agent" || teamOk(s.teams)),
    ),
    sheetSort.value,
  ),
);
// Sheet: replace mode — every weapon eligible for this position (defaults are
// free) plus owned skins of those weapons.
const replaceOptions = computed(() => {
  if (!isWeaponPos(selected.value)) return { defaults: [] as CatalogWeapon[], owned: [] as InventoryItem[] };
  const cats = catsForPos(selected.value);
  const used = new Set<string>();
  for (const g of POSITION_GROUPS) {
    for (const p of g.positions) {
      if (p !== selected.value) used.add(occupantModel(p));
    }
  }
  let eligible = weapons.value.filter(
    (w) => cats.includes(w.category) && w.teams.includes(team.value) && !used.has(w.model),
  );
  if (selected.value === "sp") {
    eligible = eligible.filter((w) => START_PISTOLS.includes(w.model));
  } else if (/^p/.test(selected.value)) {
    eligible = eligible.filter((w) => !START_PISTOLS.includes(w.model));
  }
  const models = new Set(eligible.map((w) => w.model));
  const owned = inventory.value.filter(
    (i) => i.item?.model && models.has(i.item.model) && matchesFilters(itemName(i.item), i.item.rarity),
  );
  return { defaults: eligible.filter((w) => matchesFilters(w.name)), owned };
});

// ---- mutations --------------------------------------------------------------
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, kind: "error" | "success" = "error") {
  notice.value = message;
  noticeKind.value = kind;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ""), 5000);
}
function fail(e: unknown) {
  notify(e instanceof Error ? e.message : String(e), "error");
}
async function refreshAll() {
  [loadout.value, inventory.value] = await Promise.all([fetchLoadout(), fetchInventory()]);
  // Items staged for deletion are already gone from the UI but not yet from
  // the server — a refresh mid-grace must not resurrect them.
  const pend = pendingDelete.value;
  if (pend) {
    const ids = new Set(pend.items.map((i) => String(i.id)));
    inventory.value = inventory.value.filter((i) => !ids.has(String(i.id)));
  }
}

// ---- delete with undo -------------------------------------------------------
// Deletes are staged: the item leaves the list instantly, but the API call
// waits out a grace window behind an Undo toast. Undo just puts the objects
// back — there is nothing to un-do server-side. One batch at a time: deleting
// something else commits the previous batch immediately, so the toast always
// describes the LAST thing deleted. A hard page refresh during the window
// abandons the delete (the item comes back) — the safe failure direction.
const pendingDelete = ref<{ items: InventoryItem[] } | null>(null);
let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined;
async function commitPendingDelete() {
  const batch = pendingDelete.value;
  if (!batch) return;
  pendingDelete.value = null;
  clearTimeout(pendingDeleteTimer);
  try {
    for (const it of batch.items) await deleteInstance(it.id);
  } catch (e) {
    fail(e);
  }
  await refreshAll();
}
function stageDelete(items: InventoryItem[]) {
  if (!items.length) return;
  void commitPendingDelete();
  const ids = new Set(items.map((i) => String(i.id)));
  inventory.value = inventory.value.filter((i) => !ids.has(String(i.id)));
  pendingDelete.value = { items };
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = setTimeout(() => void commitPendingDelete(), 6000);
}
function undoDelete() {
  const batch = pendingDelete.value;
  if (!batch) return;
  pendingDelete.value = null;
  clearTimeout(pendingDeleteTimer);
  // Newest-first, same as the API returns it.
  inventory.value = [...batch.items, ...inventory.value].sort((a, b) => Number(b.id) - Number(a.id));
}
const pendingDeleteLabel = computed(() => {
  const items = pendingDelete.value?.items;
  if (!items?.length) return "";
  return items.length === 1 ? `Deleted “${itemName(items[0].item) || "item"}”` : `Deleted ${items.length} items`;
});
// Equip confirmation: the slot that just received an item ripples an accent
// ring (grid cell, rail tile and focus-rail mini all bind this). Cleared and
// re-armed a frame apart so equipping into the same slot twice pulses twice.
const pulsePos = ref<string | null>(null);
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
function pulseSlot(pos: string) {
  pulsePos.value = null;
  requestAnimationFrame(() => (pulsePos.value = pos));
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => (pulsePos.value = null), 700);
}
function equippedInstance(pos: string): InventoryItem | undefined {
  return instanceById(rowFor(pos)?.item_instance_id);
}

async function equipInstanceAt(inst: InventoryItem, pos: string) {
  const cur = rowFor(pos);
  try {
    // Clicking the already-equipped skin is a no-op: equipping is never a
    // toggle, so a stray second click can't silently strip the slot. Removing
    // a skin is the explicit Unequip action.
    if (cur && String(cur.item_instance_id) === String(inst.id)) return;
    const teams: Team[] = isShared(pos) ? ["CT", "T"] : [team.value];
    await Promise.all(teams.map((t) => equip({ team: t, slot: pos, item_instance_id: inst.id })));
    await refreshAll();
    pulseSlot(pos);
    // Replacing lands you on the new gun's Owned skins, ready to re-skin it.
    if (sheetMode.value === "replace") sheetMode.value = "owned";
  } catch (e) {
    fail(e);
  }
}
// Free equip of a vanilla default weapon into a position (replace mode / reset).
async function equipDefaultAt(weapon: CatalogWeapon, pos: string) {
  try {
    await equip({ team: team.value, slot: pos, item_id: weapon.id });
    await refreshAll();
    pulseSlot(pos);
    sheetMode.value = "owned";
  } catch (e) {
    fail(e);
  }
}

// ---- drag-to-equip ----------------------------------------------------------
// Owned tiles in the sheet can be dragged straight onto a loadout slot (grid
// cells, the equipment rail and the focus rail all accept drops). Eligibility
// mirrors replace mode: right category for the position, start-pistol rules,
// team lock, and one position per weapon model.
const dragInst = ref<InventoryItem | null>(null);
const dragOverPos = ref<string | null>(null);
function canDropOn(pos: string, i: InventoryItem | null = dragInst.value): boolean {
  if (!i?.item) return false;
  if (isSpecial(pos) || isSpecial(i.slot ?? "")) return i.slot === pos;
  const model = i.item.model;
  if (!model || !catsForPos(pos).includes(i.item.category ?? "")) return false;
  if (pos === "sp" && !START_PISTOLS.includes(model)) return false;
  if (pos !== "sp" && /^p/.test(pos) && START_PISTOLS.includes(model)) return false;
  for (const g of POSITION_GROUPS) {
    for (const p of g.positions) {
      if (p !== pos && occupantModel(p) === model) return false;
    }
  }
  const teams = i.item.teams;
  return !teams || teams.length === 0 || teams.includes(team.value);
}
function onTileDragStart(i: InventoryItem, e: DragEvent) {
  dragInst.value = i;
  // Some browsers refuse to start a drag with an empty data store.
  e.dataTransfer?.setData("text/plain", String(i.id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onTileDragEnd() {
  dragInst.value = null;
  dragOverPos.value = null;
}
function onSlotDragOver(pos: string, e: DragEvent) {
  if (!canDropOn(pos)) return;
  e.preventDefault(); // preventing dragover is what makes a drop target
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dragOverPos.value = pos;
}
async function onSlotDrop(pos: string) {
  const i = dragInst.value;
  dragOverPos.value = null;
  dragInst.value = null;
  if (i && canDropOn(pos, i)) await equipInstanceAt(i, pos);
}
// Inline styles so they outrank the tailwind border/bg utilities on the slot
// buttons: eligible targets go dashed-accent, the hovered one lights up, and
// everything the drag can't land on steps back.
function dropStyle(pos: string): Record<string, string> {
  if (!dragInst.value) return {};
  if (dragOverPos.value === pos)
    return { borderColor: "var(--acc)", background: accentSoft, boxShadow: "0 0 0 1px var(--acc)" };
  if (canDropOn(pos)) return { borderColor: "color-mix(in srgb, var(--acc) 45%, transparent)", borderStyle: "dashed" };
  return { opacity: "0.45" };
}

// ---- drag-to-reorder (loadout weapon cells) ---------------------------------
// Grab any weapon cell and drop it on another: the two positions SWAP, so the
// favourite rifle can move to slot 1 without unequip/re-equip gymnastics.
// While the hover is live the grid renders the POST-swap layout (art, label,
// rarity and team dots all trade places), so the drop is a confirmation of
// what's on screen, not a guess.
const dragPos = ref<string | null>(null);
const swapOverPos = ref<string | null>(null);
function weaponFitsPos(w: CatalogWeapon | undefined, pos: string): boolean {
  if (!w) return false;
  if (!catsForPos(pos).includes(w.category)) return false;
  if (pos === "sp" && !START_PISTOLS.includes(w.model)) return false;
  if (pos !== "sp" && /^p/.test(pos) && START_PISTOLS.includes(w.model)) return false;
  return true;
}
// Both occupants must be legal in each other's position (start-pistol rules,
// SMG/heavy vs rifle columns) — otherwise the swap would strand a weapon
// somewhere the game can't put it.
function canSwap(a: string | null, b: string): boolean {
  if (!a || a === b) return false;
  return weaponFitsPos(occupantWeapon(a), b) && weaponFitsPos(occupantWeapon(b), a);
}
function onCellDragStart(pos: string, e: DragEvent) {
  if (!canEdit.value) return;
  dragPos.value = pos;
  e.dataTransfer?.setData("text/plain", pos);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onCellDragEnd() {
  dragPos.value = null;
  swapOverPos.value = null;
}
// Cells accept two different drags — owned tiles from the sheet (equip) and
// other cells (reorder) — so one set of handlers branches on which is live.
function onCellDragOver(pos: string, e: DragEvent) {
  if (dragPos.value) {
    if (!canSwap(dragPos.value, pos)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    swapOverPos.value = pos;
  } else {
    onSlotDragOver(pos, e);
  }
}
function onCellDragLeave(pos: string) {
  if (swapOverPos.value === pos) swapOverPos.value = null;
  if (dragOverPos.value === pos) dragOverPos.value = null;
}
async function onCellDrop(pos: string) {
  const src = dragPos.value;
  if (src) {
    dragPos.value = null;
    swapOverPos.value = null;
    if (canSwap(src, pos)) await swapPositions(src, pos);
    return;
  }
  await onSlotDrop(pos);
}
async function swapPositions(a: string, b: string) {
  // What each side carries into its new slot: the instance if there is one,
  // else the vanilla occupant (existing default row or the CS2 layout default).
  const carry = (row: LoadoutEntry | undefined, from: string) =>
    row?.item_instance_id != null
      ? { item_instance_id: row.item_instance_id }
      : { item_id: row?.item_id ?? occupantWeapon(from)!.id };
  const ra = rowFor(a);
  const rb = rowFor(b);
  try {
    await swapLoadout({
      team: team.value,
      a: { slot: b, ...carry(ra, a) },
      b: { slot: a, ...carry(rb, b) },
    });
    await refreshAll();
    pulseSlot(a);
    pulseSlot(b);
  } catch (e) {
    fail(e);
  }
}
// Where a cell should LOOK like it reads from while a reorder hover is live.
function previewPos(pos: string): string {
  const src = dragPos.value;
  const dst = swapOverPos.value;
  if (!src || !dst) return pos;
  return pos === src ? dst : pos === dst ? src : pos;
}
function reorderStyle(pos: string): Record<string, string> {
  if (!dragPos.value) return {};
  if (swapOverPos.value === pos)
    return { borderColor: "var(--acc)", borderStyle: "dashed", background: accentSoft, boxShadow: "0 0 0 1px var(--acc)" };
  if (pos === dragPos.value)
    // Previewing: the source shows the target's item, so keep it readable.
    return swapOverPos.value
      ? { borderColor: "color-mix(in srgb, var(--acc) 60%, transparent)", borderStyle: "dashed" }
      : { borderColor: "color-mix(in srgb, var(--acc) 60%, transparent)", borderStyle: "dashed", opacity: "0.5" };
  if (canSwap(dragPos.value, pos)) return { borderColor: "color-mix(in srgb, var(--acc) 45%, transparent)", borderStyle: "dashed" };
  return { opacity: "0.45" };
}
// Craft/edit modal (like inventory.cstrike.app/craft): wear, pattern, StatTrak,
// name tag, stickers ×5 and a charm. `editingId` set = editing an owned item.
// `w` = the sticker's own scratch wear (0 pristine .. 1 scratched off), which
// the game applies as "sticker slot N wear". Unrelated to `craft.wear`, the
// weapon's float.
type Attach = { id: number; name: string; image: string | null; x?: number | null; y?: number | null; r?: number | null; w?: number | null };
const craft = ref<{
  skin: Skin;
  wear: number;
  seed: number;
  stattrak: boolean;
  nametag: string;
  stickers: (Attach | null)[];
  patches: (Attach | null)[];
  charm: (Attach & { z?: number | null }) | null;
} | null>(null);
// What attachments the selected slot's item supports.
const attachKind = computed<"weapon" | "agent" | "none">(() => {
  if (selected.value === "agent") return "agent";
  if (isWeaponPos(selected.value) || selected.value === "zeus" || selected.value === "c4") return "weapon";
  return "none";
});
const editingId = ref<number | null>(null);
// The weapon model this craft/edit is about. Crafting from the sheet = the
// selected slot's weapon; editing from anywhere = the ITEM's own weapon.
const craftModel = ref<string | null>(null);
// Steam-imported items are READ-ONLY (they mirror a real inventory). Editing
// one opens the same modal as a DUPLICATE: saving creates an editable copy.
const duplicating = ref(false);
// Viewing an owned item (/items/<id>/3d) is the SAME modal as editing it, with
// the form swapped for a readout and the save row for a close row. Two screens
// that show one item ought to differ in what you can DO, not in where anything
// is — so the model, the 2D/3D toggle, the name plate and the spec column all
// keep their positions between view and edit, and "Edit" is a swap of the
// right-hand column rather than a different page.
const viewOnly = ref(false);
// Which owned item the modal is showing, in EITHER mode. `editingId` can't do
// this job: it's null while duplicating a Steam item, and null is also "brand
// new craft" — the route watcher needs to tell those apart.
const craftInstId = ref<number | null>(null);
const craftBusy = ref(false);
function openCraft(skin: Skin) {
  editingId.value = null;
  duplicating.value = false;
  viewOnly.value = false;
  craftInstId.value = null;
  craftModel.value = isWeaponPos(selected.value) ? occupantModel(selected.value) : null;
  craft.value = { skin, wear: DEFAULT_WEAR, seed: 1, stattrak: false, nametag: "", stickers: [null, null, null, null, null], patches: [null, null, null, null, null], charm: null };
  craftBaseline = ""; // new craft — no stored render to reuse
  // A brand-new craft gets a URL too: /craft/<skinId>, with the draft itself in
  // the query. Without it the one state worth sharing before you commit to it
  // — "this seed renders wrong" — is the one state with no link.
  if (!routeSyncing && routeDraftSkinId.value !== skin.id) openModalRoute(`/craft/${skin.id}`);
}

// Rehydrate a draft from its link. The URL holds ids only, so names and images
// come back from the catalog in one batched lookup — a shared link should open
// the same editor the sender was looking at, stickers and all.
async function restoreDraftRoute(skinId: number) {
  if (craft.value && craft.value.skin.id === skinId) return; // already showing it
  const d = decodeDraft(router.query.value, DEFAULT_WEAR);
  try {
    const items = await fetchCatalogItems([skinId, ...draftItemIds(d)]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const skin = byId.get(skinId);
    if (!skin) {
      notify("That craft link points at an item that no longer exists.", "error");
      go("/items");
      return;
    }
    const attach = (a: { id: number } | null, extra: Record<string, unknown> = {}): Attach | null => {
      const c = a && byId.get(a.id);
      return c ? ({ id: c.id, name: c.name, image: c.image, ...extra } as Attach) : null;
    };
    withRouteSync(() => {
      editingId.value = null;
      duplicating.value = false;
      viewOnly.value = false;
      craftInstId.value = null;
      craftModel.value = skin.model ?? null;
      craft.value = {
        skin,
        wear: d.wear,
        seed: d.seed,
        stattrak: d.stattrak,
        nametag: d.nametag,
        stickers: d.stickers
          .slice(0, 5)
          .map((s) => attach(s, { x: s?.x ?? null, y: s?.y ?? null, r: s?.r ?? null, w: s?.w ?? null })),
        patches: d.patches.slice(0, 5).map((p) => attach(p ? { id: p } : null)),
        charm: attach(d.charm, { x: d.charm?.x ?? null, y: d.charm?.y ?? null, z: d.charm?.z ?? null }) as
          | (Attach & { z?: number | null })
          | null,
      };
      craftBaseline = "";
    });
  } catch (e) {
    fail(e);
  }
}
function openEdit(inst: InventoryItem) {
  mdebug("openEdit()", { inst: inst.id, hasItem: !!inst.item });
  if (!inst.item) return;
  craftModel.value = inst.item.model ?? null;
  viewOnly.value = false;
  craftInstId.value = inst.id;
  duplicating.value = inst.origin === "steam";
  editingId.value = duplicating.value ? null : inst.id;
  const stickers: (Attach | null)[] = [null, null, null, null, null];
  (inst.stickers ?? []).forEach((st, i) => {
    if (st && i < 5) stickers[i] = { id: st.id, name: st.name, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null };
  });
  const patches: (Attach | null)[] = [null, null, null, null, null];
  (inst.patches ?? []).forEach((pt, i) => {
    if (pt && i < 5) patches[i] = { id: pt.id, name: pt.name, image: pt.image };
  });
  craft.value = {
    skin: { id: inst.item.id, name: inst.item.name, altName: inst.item.altName ?? null, rarity: inst.item.rarity ?? "", image: inst.item.image, paintMaterial: inst.item.paintMaterial ?? null, legacyPaint: !!inst.item.legacyPaint },
    wear: inst.wear ?? DEFAULT_WEAR,
    seed: inst.seed ?? 1,
    stattrak: inst.stattrak,
    nametag: inst.nametag ?? "",
    stickers,
    patches,
    charm: inst.charm
      ? { id: inst.charm.id, name: inst.charm.name, image: inst.charm.image, x: inst.charm.x ?? null, y: inst.charm.y ?? null, z: inst.charm.z ?? null }
      : null,
  };
  // Until something changes, show the render we already have for this item.
  craftBaseline = craftStateJson();
  craftPreview.value = renderSrc(inst);
  // Opened by a click, not by the URL — put it in the URL so the state is
  // linkable. Skipped when the route watcher is what called us.
  // Opened by a click, not by the URL — put it in the URL so the state is
  // linkable. Skipped when the route watcher is what called us.
  if (!routeSyncing && !(routeItemId.value === String(inst.id) && routeItemModal.value === "craft")) {
    openModalRoute(`/items/${inst.id}/craft`);
  }
}

/**
 * What /items/<id>/3d opens: the editor shell, populated from the item, with
 * every control that would CHANGE it suppressed. Deliberately built on openEdit
 * rather than beside it — one function loads an item into this modal, so a view
 * can never drift out of sync with what the editor would have shown, and the
 * "Edit" button is a flag flip, not a reload.
 *
 * `withRouteSync` because the caller is the route watcher: openEdit would
 * otherwise navigate to /craft and bounce us straight back out of view mode.
 */
function openView(inst: InventoryItem) {
  mdebug("openView()", { inst: inst.id, instId: craftInstId.value, viewOnly: viewOnly.value });
  // Already showing this item, untouched? Then this is the mirror of
  // craftViewEdit (Back out of the editor) and the same rule applies: flip the
  // mode, don't reload. Reassigning `craft` here rebuilt the 3D viewer for a
  // model that was already on screen. Gated on the state matching the baseline
  // so a DIRTY editor still reloads from the item and unsaved edits can't leak
  // into the read-only view.
  if (craftInstId.value === inst.id && craft.value && craftStateJson() === craftBaseline) {
    viewOnly.value = true;
    return;
  }
  withRouteSync(() => openEdit(inst));
  viewOnly.value = true;
}
/**
 * The owned item behind the modal. View mode reads its spec column from THIS
 * rather than from the craft form: the form fills wear/seed with defaults for
 * items that have neither (agents, graffiti, music kits), which is harmless
 * while editing — the fields are hidden — but would invent a float for a
 * sticker capsule if a readout trusted it.
 */
const craftInst = computed(() =>
  craftInstId.value != null ? instanceById(craftInstId.value) ?? null : null,
);
/**
 * View → edit, in place. Same item, same modal, form swapped back in.
 *
 * A MODE FLIP, not a reload — deliberately not `openEdit`. `craft` already
 * holds this exact item (openView built it through openEdit), so re-running it
 * only reassigned `craft` with an equivalent object, and that reassignment fired
 * the `craft` watcher below: it tore down the live 3D viewer, revealed the 2D
 * still, showed the "Loading 3D model…" spinner, and rebuilt an identical
 * viewer. Four visual states to un-grey a form. Everything openEdit would set
 * (craftModel, editingId, duplicating, craftBaseline, craftPreview) is already
 * set and still correct for this item.
 */
function craftViewEdit() {
  const inst = craftInst.value;
  if (!inst) return;
  viewOnly.value = false;
  if (!routeSyncing && routeItemModal.value !== "craft") {
    openModalRoute(`/items/${inst.id}/craft`);
  }
}

/**
 * Close the craft editor and land back where it was opened from.
 *
 * NAVIGATES, and nothing else. The route watcher below is the only thing that
 * opens or tears down modals, and Cancel must not go around it: an earlier
 * version nulled `craft` here and then navigated, but navigation is async —
 * the watcher fired while the URL still said /items/<id>/craft, saw an item
 * route with no craft loaded, and faithfully re-opened the modal. Cancel
 * relaunched the very thing it closed. State follows the URL; this function's
 * whole job is picking a good URL.
 *
 * The destination must be a NON-modal route — the first remembered screen that
 * isn't itself a modal path, else the screen pinned behind the modal. Landing
 * on another modal route (the old /items/<id> fallback) "closed" the editor
 * into the detail view of the same overlay and Cancel read as a dead button.
 */
function closeCraft() {
  mdebug("closeCraft()", { route: route.value.name, instId: craftInstId.value });
  if (route.value.name !== "item" && route.value.name !== "draft") {
    // Not URL-driven (shouldn't happen in practice) — safe to just drop state.
    craft.value = null;
    editingId.value = null;
    viewOnly.value = false;
    craftInstId.value = null;
    return;
  }
  const behind = SCREEN_ROUTE[view.value];
  const rest = [...modalReturn.value];
  let back = rest.pop();
  while (back && isModalPath(back)) back = rest.pop();
  modalReturn.value = [];
  go(back ?? buildPath(behind));
}
const rand = (min: number, max: number) => min + Math.random() * (max - min);
function randomWear() {
  if (craft.value) craft.value.wear = Number(rand(0, 1).toFixed(4));
}
function randomSeed() {
  if (craft.value) craft.value.seed = Math.floor(rand(1, 1001));
}
function resetCraft() {
  if (craft.value)
    Object.assign(craft.value, {
      wear: DEFAULT_WEAR, seed: 1, stattrak: false, nametag: "",
      stickers: [null, null, null, null, null], patches: [null, null, null, null, null], charm: null,
    });
}
// The craft form as the API wants it. Shared by save and by draft-inspect so
// "inspect" always shows the state on screen — previously it read the saved
// row, so moving a sticker and inspecting showed the OLD placement until you
// saved and reopened.
// Sparse specs: index = slot; x/y/rotation/wear all flow to the game server.
function toSpec(a: Attach | null): AttachSpec {
  return a ? { id: a.id, x: a.x ?? null, y: a.y ?? null, r: a.r ?? null, w: a.w ?? null } : null;
}
function craftBody() {
  const c = craft.value!;
  return {
    wear: c.wear,
    seed: c.seed,
    stattrak: c.stattrak,
    nametag: c.nametag.trim() || null,
    stickers: c.stickers.map(toSpec),
    patches: c.patches.map(toSpec),
    charm_id: c.charm?.id ?? null,
    charm_offset: c.charm ? { x: c.charm.x ?? null, y: c.charm.y ?? null, z: c.charm.z ?? null } : null,
  };
}
// Inspect the DRAFT — works before the craft has ever been saved.
async function openCraftInspect() {
  if (!craft.value) return;
  try {
    const { inspect } = await fetchDraftInspectLink({ item_id: craft.value.skin.id, ...craftBody() });
    window.location.href = inspect;
    linkOpening.value = true;
    setTimeout(() => (linkOpening.value = false), 1600);
  } catch (e) {
    fail(e);
  }
}
/**
 * Commit the current editor state as a NEW item instead of overwriting the one
 * being edited. Without this the only commit while editing is Save, so building
 * a variant of an existing skin meant copying its share link into a fresh
 * editor — the long way round to something the editor already had in hand.
 *
 * Dropping `editingId` is the whole mechanism: confirmCraft() branches on it,
 * and with it cleared the save path is the same one a brand-new craft takes.
 */
async function duplicateCraft() {
  if (!craft.value || craftBusy.value) return;
  if (!signedIn.value) return notify("Sign in to save this to your inventory.");
  editingId.value = null;
  duplicating.value = true;
  await confirmCraft();
}
async function confirmCraft() {
  if (!craft.value || craftBusy.value) return;
  // Belt-and-braces behind the disabled button: the editor is reachable signed
  // out (and via a shared /craft/<id> draft link), so the commit re-checks
  // rather than trusting that no path got here.
  if (!signedIn.value) return notify("Sign in to save this to your inventory.");
  craftBusy.value = true;
  try {
    const body = craftBody();
    if (editingId.value != null) {
      const updated = await updateInstance(editingId.value, body);
      renderedIds.delete(updated.id);
      void generateRender(updated).then((ok) => {
        if (ok) bakeStamp.value = { ...bakeStamp.value, [updated.id]: Date.now() };
      });
      // Patch in place rather than refetching. refreshAll() swaps the whole
      // inventory AND loadout arrays for fresh objects, which re-mounts every
      // tile and re-requests every card image — on screen that is
      // indistinguishable from a page reload, and it threw away scroll and
      // entrance-animation state on every save. Exactly one instance changed
      // and updateInstance already hands back its new state.
      inventory.value = inventory.value.map((i) =>
        String(i.id) === String(updated.id) ? updated : i,
      );
      // Loadout rows keep their OWN copy of the editable fields, so a row
      // equipping this instance has to follow it — otherwise the slot goes on
      // rendering the pre-edit wear/seed until something else refetches.
      loadout.value = loadout.value.map((r) =>
        String(r.item_instance_id) === String(updated.id)
          ? {
              ...r,
              item_id: updated.item_id,
              item: updated.item,
              wear: updated.wear,
              seed: updated.seed,
              stattrak: updated.stattrak,
              nametag: updated.nametag,
            }
          : r,
      );
    } else {
      const inst = await craftItem({ item_id: craft.value.skin.id, ...body });
      void generateRender(inst).then((ok) => {
        if (ok) bakeStamp.value = { ...bakeStamp.value, [inst.id]: Date.now() };
      });
      inventory.value = [inst, ...inventory.value];
      // A new craft lands in the INVENTORY, never straight into a slot.
      // Auto-equipping used to target whichever slot the UI happened to be on,
      // which is fine when you started from that slot and wrong every other
      // time: opening a shared craft link left `selected` pointing at an
      // unrelated slot, so saving failed with "doesn't fit that slot" and the
      // craft was lost. Equipping is one click from the inventory; a failed
      // save is not recoverable.
      notify(
        duplicating.value ? "Editable copy created in your inventory." : "Crafted — it's in your inventory.",
        "success",
      );
      sheetMode.value = "owned";
    }
    // Saving returns you to whatever you were doing — the loadout if you
    // crafted from the loadout, the inventory if you edited from there. It used
    // to hard-redirect to /items regardless, which threw away your place.
    closeCraft();
  } catch (e) {
    fail(e);
  } finally {
    craftBusy.value = false;
  }
}

// Fire-and-forget: snapshot the painted 3D model and cache it as this
// instance's card image (served from /renders/ on the mount).
const renderedIds = new Set<number>();
// Snapshots each need a WebGL context — run them one at a time so a page of
// missing renders backfills calmly instead of exhausting context limits.
let renderQueue: Promise<unknown> = Promise.resolve();
const queuedIds = ref<Set<number>>(new Set());
function generateRender(inst: InventoryItem): Promise<boolean> {
  if (renderedIds.has(inst.id) || queuedIds.value.has(inst.id)) return Promise.resolve(false);
  queuedIds.value = new Set([...queuedIds.value, inst.id]);
  const run = renderQueue.then(() => generateRenderNow(inst));
  renderQueue = run.catch(() => false);
  return run.finally(() => {
    const next = new Set(queuedIds.value);
    next.delete(inst.id);
    queuedIds.value = next;
  });
}
const renderingIds = ref<Set<number>>(new Set());
// Does the server already have this file? Probed with an <img>, NOT fetch:
// plain img loads send session cookies but are CORS-exempt, so the probe sees
// exactly what the visible cards see. A credentialed fetch is CORS-gated —
// one bad header serverside and every equipped item re-baked on every load
// while the cards displayed the stored render just fine.
const renderServes = (url: string) =>
  new Promise<boolean>((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.src = url;
  });
async function generateRenderNow(inst: InventoryItem): Promise<boolean> {
  const model = inst.item?.model;
  if (!model || renderedIds.has(inst.id) || !(await hasModel(model))) return false;
  // Already stored server-side? Nothing to bake. Carries the buster: after a
  // cache clear the browser still holds the deleted image, so an un-busted
  // probe loads it, concludes the server is fine and skips the re-bake — which
  // is exactly why clearing renders used to leave every stale card in place.
  if (await renderServes(renderUrlFor(inst) + renderBust(inst))) {
    renderedIds.add(inst.id);
    return true;
  }
  renderedIds.add(inst.id);
  // Stand down while a 3D viewer is onscreen — a bake mounts its own WebGL
  // context and composites paint for ~1s, which is what made orbiting or
  // dragging a charm crawl while the loadout backfilled behind it. Waiting
  // HERE (before the badge flips to "baking") keeps the card honest: it reads
  // queued, because that is what it is.
  await viewersIdle();
  renderingIds.value = new Set([...renderingIds.value, inst.id]);
  try {
    const blob = await snapshotModel(
      model,
      {
        paintMaterial: inst.item?.paintMaterial ?? null,
        legacyPaint: !!inst.item?.legacyPaint,
        wear: inst.wear != null ? Number(inst.wear) : null,
        seed: inst.seed != null ? Number(inst.seed) : null,
        ...(await stickerGeom(model)),
        ...instPlacements(inst),
        // Module yes, readout no. The count is deliberately absent from
        // renderKeyFor — a baked card must stay valid as kills land, and it
        // can only do that if the digits were never in the picture.
        stattrak: inst.stattrak ? { count: null } : null,
      },
      undefined,
      // Card art backfill — nobody is waiting on it, so let it stand down
      // while a 3D viewer is onscreen instead of fighting it for the GPU.
      true,
    );
    if (!blob) {
      renderedIds.delete(inst.id); // snapshot failed — retry later
      return false;
    }
    // The card can use this session-local render IMMEDIATELY — server
    // persistence is only the cross-session cache, not a display dependency.
    const prev = localRenders.value[inst.id];
    if (prev) URL.revokeObjectURL(prev);
    localRenders.value = { ...localRenders.value, [inst.id]: URL.createObjectURL(blob) };
    const up = await uploadRender(inst.id, blob);
    if (!up.ok && !uploadWarned) {
      uploadWarned = true;
      notify(`Render made locally, but saving it failed: ${up.error}. Check backend deploy/mount.`, "error");
    } else if (up.ok && !uploadWarned) {
      // Verify the file actually serves back — if not, the backend wrote to a
      // mount nginx can't see (or a CDN cached the old 404).
      if (!(await renderServes(`${renderUrlFor(inst)}?verify=${Date.now()}`))) {
        uploadWarned = true;
        notify(
          "Render SAVED (backend OK) but /renders/ doesn't serve it back — frontend + backend pods aren't sharing the mount, or a cache is serving a stale 404.",
          "error",
        );
      }
    }
    return true;
  } finally {
    const next = new Set(renderingIds.value);
    next.delete(inst.id);
    renderingIds.value = next;
  }
}
// Card <img> helper: prefer the cached true render, fall back to catalog art.
// bakeStamp bumps after a successful bake so <img> cache-busts and reloads.
const bakeStamp = ref<Record<number, number>>({});
// Session-local baked images (object URLs) — always win over server URLs.
const localRenders = ref<Record<number, string>>({});
let uploadWarned = false;
// Bumped when the server-side render cache is cleared. Renders are served with
// max-age=3600 (nginx: 86400) at a URL that a clear does NOT change, so without
// this the browser keeps answering from its own copy and "clear cache" appears
// to do nothing. Zero normally, so ordinary loads still get cache hits.
const cacheEpoch = ref(0);
// Per-item buster: a fresh bake wins, else the clear epoch, else nothing.
const renderBust = (i: InventoryItem) => {
  const t = bakeStamp.value[i.id] || cacheEpoch.value;
  return t ? `?t=${t}` : "";
};
const renderSrc = (i: InventoryItem) =>
  localRenders.value[i.id] ?? renderUrlFor(i) + renderBust(i);
// Missing render → show catalog art immediately, then LAZILY generate the true
// render in the background and swap it in (one attempt per item per session).
function onRenderError(e: Event, i: InventoryItem) {
  const img = e.target as HTMLImageElement;
  const fallback = i.item?.image;
  if (fallback && img.src !== fallback) img.src = fallback;
  if (!canEdit.value) return; // not our inventory — can't upload for others
  void generateRender(i); // success updates localRenders -> :src rebinds
}
// ItemArt (the single item-image component) and ItemTile pull these via inject
// so every view shares ONE render/fallback/bake chain and ONE bake-status
// source. (Must be provided AFTER the consts exist — script-setup runs
// top-to-bottom.)
provide("itemArt", { renderSrc, onRenderError, renderingIds, queuedIds });

// 3D preview inside the craft/edit modal.
const modal3d = ref(false);
const modal3dAvailable = ref(false);
const modal3dBusy = ref(false);
const modalViewerEl = ref<HTMLElement | null>(null);
let modalViewerHandle: ViewerHandle | null = null;
// Bumped on every teardown so an in-flight mountModalViewer can tell that the
// modal it was mounting for has since closed or been remounted.
let modalViewerGen = 0;
// The generation counter alone could only DISCARD a finished build — the mount
// still ran to completion, allocating a GL context and compositing a full paint
// job for a modal that had already closed. Aborting stops it at the next
// checkpoint instead, and a mount cancelled while queued never starts at all.
let modalViewerAbort: AbortController | null = null;
function teardownModalViewer() {
  modalViewerGen++;
  modalViewerAbort?.abort();
  modalViewerAbort = null;
  modalViewerHandle?.dispose();
  modalViewerHandle = null;
  // An aborted mount bails before its `finally` can clear this, and the
  // finally is gen-guarded anyway so a superseded build must not clear a
  // spinner it no longer owns. Teardown is the one place that always runs.
  modal3dBusy.value = false;
}
// Loading an item into the modal drives `modal3d` as BOOKKEEPING (off, then
// back on once we know the model exists), not as a 2D/3D toggle. Its URL
// watcher below must sit those out: view→edit reassigns `craft`, so the reset
// lands one tick after openEdit pushed /items/<id>/craft — while `router.path`
// is still the stale /3d the host hasn't propagated past yet — and the
// watcher's `replace` would put that old path straight back.
let modal3dResetting = false;
// False while the modal's opening cascade plays, true once it has settled —
// gates `sheet-settled` on the options column so mode flips don't replay the
// entrance. Reset on every `craft` assignment: after the mode-flip fixes above,
// reassignment means a genuine (re)load, where the cascade SHOULD play again.
const craftSettled = ref(false);
let craftSettleTimer: ReturnType<typeof setTimeout> | undefined;
watch(craft, async (open) => {
  clearTimeout(craftSettleTimer);
  craftSettled.value = false;
  // 260ms animation + up to 220ms stagger, rounded up.
  if (open) craftSettleTimer = setTimeout(() => (craftSettled.value = true), 550);
  modal3dResetting = true;
  teardownModalViewer();
  modal3d.value = false;
  modal3dAvailable.value = false;
  if (open && craftModel.value) {
    // Peek before awaiting. On a cache hit this whole branch stays synchronous,
    // so `modal3d` is already true when the modal first paints and the 2D still
    // never appears — and `modal3dAvailable` goes false→true inside one flush,
    // so the 2D/3D pill doesn't blink out either.
    const known = hasModelSync(craftModel.value);
    modal3dAvailable.value = known ?? (await hasModel(craftModel.value));
    // 3D is the default editor: placement is the whole job here, and the 2D
    // form can't show you where anything actually lands. Falls back to the
    // form when the weapon has no extracted model, or when the link said ?d=2.
    if (modal3dAvailable.value && craft.value && !routeWants2d.value) modal3d.value = true;
  }
  // After the flush, so the watcher jobs these assignments queued have run.
  await nextTick();
  modal3dResetting = false;
});

// ---- Deep links: the URL owns which modal is open ---------------------------
// Detail, craft editor and 3D viewer are all routes now. UI actions navigate;
// the watcher below is the ONLY thing that opens or closes them. That's what
// makes a click, a pasted link and the back button land in identical state, and
// it's why there's no longer a rule saying "closing the editor goes to /items"
// — closing pops back to wherever you opened it from, so saving a craft while
// you're on the loadout leaves you on the loadout.
let routeSyncing = false;
const withRouteSync = (fn: () => void | Promise<void>) => {
  routeSyncing = true;
  try {
    return fn();
  } finally {
    nextTick(() => (routeSyncing = false));
  }
};

/** Navigate to a modal route, remembering where we came from. */
function openModalRoute(to: string, extra: Record<string, string> = {}) {
  mdebug("openModalRoute()", { to, extra, stackDepth: modalReturn.value.length });
  if (route.value.name !== "item" && route.value.name !== "draft") {
    modalReturn.value = [...modalReturn.value.slice(-(MAX_RETURN_DEPTH - 1)), router.path.value];
    // Pin the screen we're leaving as the modal's backdrop. Only on the way IN
    // from a real screen: a modal opening another modal must not repaint the
    // backdrop with the modal it's layering over.
    modalBackdrop.value = screenFor(route.value);
  }
  go(to, { query: extra });
}

/**
 * Close the open modal by returning to the screen underneath.
 *
 * With nothing on the stack (a cold-loaded deep link like /items/1003/craft)
 * this lands on the grid. It used to resolve the EDITOR to the detail view of
 * the same item instead, but detail and editor are one overlay, so that closed
 * the modal into itself and left it on screen — see closeCraft.
 */
function closeModalRoute() {
  mdebug("closeModalRoute()", { stack: [...modalReturn.value] });
  const back = modalReturn.value[modalReturn.value.length - 1];
  if (back) {
    modalReturn.value = modalReturn.value.slice(0, -1);
    go(back);
    return;
  }
  go("/items");
}

// ---- TEMPORARY overlay tracing (flicker / reopen hunt) ---------------------
// Helpers are in ./mdebug; this wires in the context every line carries. The
// watchers live at the BOTTOM of this script — the overlay refs are declared
// throughout the file and a watcher can't reference one still in its TDZ.
setMdebugAmbient(() => ({
  path: router.path.value,
  query: { ...router.query.value },
  routeSyncing,
  // gl: live GL contexts / builds in flight. `building` should never exceed 1,
  // and `live` should return to 0 once every viewer is closed.
  gl: viewerStats(),
}));
// ---- end temporary tracing helpers -----------------------------------------

// Applying the URL to the modals. Depends on `inventory` as well as the route:
// a cold-loaded deep link arrives before the item exists and must open once it
// does. NOT immediate — openEdit reaches craftStateJson(), declared further
// down this file and still in its temporal dead zone during setup. Nothing is
// lost: `inventory` is empty until its fetch resolves, and that change is what
// fires this for a cold-loaded link.
watch([route, inventory], async () => {
  // This watcher is the prime suspect for a reopen: it re-applies the URL onto
  // the modal state, so anything that leaves the route pointing at a modal
  // after a close will faithfully put that modal back. Log both the entry and
  // the skip, because a MISSING "route->modal sync" line is as diagnostic as a
  // duplicated one.
  mdebug("route->modal sync", { route: route.value.name, skipped: routeSyncing, invSize: inventory.value?.length });
  if (routeSyncing) return;
  const r = route.value;

  // Left the modal routes entirely — tear everything down. The return stack is
  // only valid while a modal is open; a back-button navigation to a plain
  // screen doesn't pop it, so drop it here or it would misdirect a later close.
  if (r.name !== "item" && r.name !== "draft") {
    modalReturn.value = [];
    modalBackdrop.value = null;
    withRouteSync(() => {
      if (craft.value) {
        craft.value = null;
        editingId.value = null;
        viewOnly.value = false;
        craftInstId.value = null;
      }
    });
    if (loadout3d.value) closeLoadout3d();
    return;
  }

  // Adopt a shared link's backdrop once, so it survives the hops between modal
  // modes: viewQuery re-attaches `from` from this ref, not from the old URL.
  if (!modalBackdrop.value) {
    const from = router.query.value.from;
    if (from && from in SCREEN_ROUTE) modalBackdrop.value = from as ReturnType<typeof screenFor>;
  }

  if (r.name === "draft") {
    if (loadout3d.value) closeLoadout3d();
    await restoreDraftRoute(r.skinId);
    return;
  }

  const inst = inventory.value.find((i) => String(i.id) === r.id);
  if (!inst) return; // not loaded yet — reruns when inventory arrives

  if (loadout3d.value) closeLoadout3d();
  // Every /items/<id>[/…] route is now ONE modal in one of two modes, so
  // nothing is torn down in here — moving between them is a mode swap, and
  // dropping the modal on the way would throw away a loaded viewer just to
  // rebuild it a frame later.
  if (r.modal === "craft") {
    if (craftInstId.value !== inst.id || viewOnly.value || !craft.value) {
      await withRouteSync(() => openEdit(inst));
    }
  } else if (craftInstId.value !== inst.id || !viewOnly.value || !craft.value) {
    // "detail" and "3d" both land here — they're the same screen. Both open on
    // the 3D view when the weapon has an extracted model (the `craft` watcher
    // decides that from availability and ?d=), and both fall back to the still
    // render when it doesn't, so /items/<id> is never a worse view than /3d.
    openView(inst);
  }
});

// 2D/3D is a link-level detail, so it rides the query rather than the path.
watch(modal3d, (on) => {
  if (routeSyncing || modal3dResetting || !craft.value) return;
  const path = router.path.value;
  if (route.value.name !== "item" && route.value.name !== "draft") return;
  const q = transientQuery();
  if (on) delete q.d;
  else q.d = "2";
  go(path, { replace: true, query: q });
});

// The draft itself lives in the query, but ONLY on /craft/<skinId>. A saved
// item's URL already names the item, and letting unsaved edits shadow it would
// mean /items/3/craft?wear=0.9 has two answers for "what wear is this".
// Deep watch: sticker drags mutate the array in place.
// The editor's live state as a Draft. Shared by the URL watcher below and by
// the share links, which MUST agree: a share link that encodes the craft
// differently from the address bar is a link that reopens a different item.
function draftFromCraft(): Draft | null {
  const c = craft.value;
  if (!c) return null;
  return {
    wear: c.wear,
    seed: c.seed,
    stattrak: c.stattrak,
    nametag: c.nametag,
    stickers: c.stickers.map((s) => (s ? { id: s.id, x: s.x, y: s.y, r: s.r, w: s.w } : null)),
    patches: c.patches.map((p) => p?.id ?? null),
    charm: c.charm ? { id: c.charm.id, x: c.charm.x, y: c.charm.y, z: c.charm.z } : null,
  };
}

watch(
  craft,
  () => {
    if (routeSyncing || route.value.name !== "draft" || !craft.value) return;
    const d = draftFromCraft();
    if (!d) return;
    const next = {
      ...foreignQuery(router.query.value),
      ...(router.query.value.d === "2" ? { d: "2" } : {}),
      ...(team.value !== DEFAULT_TEAM ? { team: team.value } : {}),
      ...encodeDraft(d, DEFAULT_WEAR),
    };
    const now = router.query.value;
    const same =
      Object.keys(next).length === Object.keys(now).length &&
      Object.entries(next).every(([k, v]) => now[k] === v);
    if (!same) router.go(router.path.value, { replace: true, query: next });
  },
  { deep: true },
);
// Sticker geometry the viewer needs: the game's per-slot UV anchors plus the
// bounds envelope. Spread straight into ViewerOpts so every mount site gets
// both — a mount missing `stickerSlots` silently falls back to the old
// silhouette guess, which does not match the game.
// How many sticker slots this weapon actually has — 4, 5 or 6 depending on the
// weapon, never a flat 5. Offering more than exist means the extra ones have no
// markup index, so the game drops those stickers silently.
const stickerSlotCount = ref(5);
watch([craft, craftModel], async () => {
  if (!craft.value || !craftModel.value) return;
  const g = await fetchStickerGeometry(craftModel.value);
  const hd = g.slots.filter((sl) => sl.mesh === "body_hd");
  if (hd.length) stickerSlotCount.value = hd.length;
});
async function stickerGeom(model: string) {
  const g = await fetchStickerGeometry(model);
  return { stickerBounds: g.bounds, stickerSlots: g.slots };
}
// Craft state → viewer placement shapes.
function craftStickerPlacements(): StickerPlacement[] {
  return (craft.value?.stickers ?? []).flatMap((st, i) =>
    st?.image ? [{ slot: i, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null }] : [],
  );
}
// Slider -> craft form. The 3D decal rebuilds off the same watcher that already
// follows x/y/r, so scratching updates live.
function setStickerWear(slot: number, w: number) {
  const st = craft.value?.stickers[slot];
  if (st) st.w = Math.min(1, Math.max(0, w));
}
function craftCharmPlacement(): CharmPlacement | null {
  const c = craft.value?.charm;
  return c?.image ? { image: c.image, x: c.x ?? null, y: c.y ?? null, z: c.z ?? null } : null;
}
async function mountModalViewer() {
  teardownModalViewer();
  const gen = modalViewerGen;
  const ac = new AbortController();
  modalViewerAbort = ac;
  mdebug("viewer MOUNT start", { model: craftModel.value, gen });
  modal3dBusy.value = true;
  await nextTick();
  if (!modalViewerEl.value) {
    modal3dBusy.value = false;
    return;
  }
  try {
    const model = craftModel.value;
    if (!model) return;
    const handle = await mountViewer(modalViewerEl.value, model, {
      signal: ac.signal,
      paintMaterial: craft.value?.skin.paintMaterial ?? null,
      legacyPaint: !!craft.value?.skin.legacyPaint,
      wear: craft.value?.wear,
      seed: craft.value?.seed,
      // View mode isn't interactive in the viewer's sense: no attachment
      // dragging, and the model idles on a slow auto-rotate the way the old
      // standalone overlay did. Orbit/pan/zoom are gated on `still`, not this,
      // so they stay available either way.
      interactive: !viewOnly.value,
      ...(await stickerGeom(model)),
      stickers: craftStickerPlacements(),
      charm: craftCharmPlacement(),
      // Live 3D, so a real readout — the owned item's count when the modal is
      // showing one (craftInstId covers editing AND duplicating, which
      // editingId does not), and 0 for a brand-new craft that has no kills.
      stattrak: craft.value?.stattrak
        ? { count: inventory.value.find((i) => i.id === craftInstId.value)?.stattrak_count ?? 0 }
        : null,
      // Drags write straight into the craft form — the numeric inputs follow
      // live, and confirm sends the same offsets to the game server.
      onStickerPlaced(slot, x, y) {
        const st = craft.value?.stickers[slot];
        if (st) {
          st.x = x;
          st.y = y;
        }
      },
      onStickerRotated(slot, r) {
        const st = craft.value?.stickers[slot];
        if (st) st.r = r;
      },
      onCharmPlaced(x, y, z) {
        if (craft.value?.charm) {
          craft.value.charm.x = x;
          craft.value.charm.y = y;
          craft.value.charm.z = z; // vertical — dropping this pinned drags to a plane
        }
      },
    });
    // Modal closed (or remounted for a new wear/seed) while the GLB was
    // loading — this handle has no host left to draw into. Still checked
    // alongside the abort: a teardown that lands in the window between the
    // build's last checkpoint and here produces a live handle nobody wants.
    if (gen !== modalViewerGen) {
      handle.dispose();
      mdebug("viewer MOUNT discarded (superseded)", { gen });
      return;
    }
    modalViewerHandle = handle;
    mdebug("viewer MOUNT done", { model: craftModel.value, gen });
  } catch (e) {
    // Cancelling is the expected outcome of closing the modal mid-load, not an
    // error — surfacing it would flash a failure toast on a normal close.
    if ((e as Error)?.name === "AbortError") {
      mdebug("viewer MOUNT aborted", { gen });
      return;
    }
    modal3d.value = false;
    fail(e);
  } finally {
    // Only the CURRENT mount owns the busy flag. A superseded build landing
    // late would otherwise clear the spinner belonging to the mount that
    // replaced it.
    if (gen === modalViewerGen) modal3dBusy.value = false;
  }
}
watch(modal3d, (on) => {
  if (on) void mountModalViewer();
  else teardownModalViewer();
});
// Wear/seed changes retexture the model — debounced remount so slider drags
// don't recomposite on every tick.
let retexTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [craft.value?.wear, craft.value?.seed],
  () => {
    if (!modal3d.value) return;
    clearTimeout(retexTimer);
    retexTimer = setTimeout(() => {
      if (modal3d.value) void mountModalViewer();
    }, 450);
  },
);
// Numeric edits / picker changes → live decal + charm updates. The viewer
// no-ops on identical placements, so drag echoes don't rebuild anything.
watch(
  () => JSON.stringify([craft.value?.stickers, craft.value?.charm]),
  () => {
    if (!modalViewerHandle || !craft.value) return;
    modalViewerHandle.setStickers(craftStickerPlacements());
    modalViewerHandle.setCharm(craftCharmPlacement());
  },
);

// LIVE 2D preview in the craft/edit modal: any change to wear / pattern /
// stickers / charm re-renders the preview image itself (client-side snapshot,
// no server involved). What you see is exactly what gets baked on Save.
const craftPreview = ref<string | null>(null);
const craftPreviewBusy = ref(false);
let craftPreviewTimer: ReturnType<typeof setTimeout> | undefined;
let craftPreviewToken = 0;
// Snapshot of the craft state as-opened: while nothing changed, the modal
// shows the ALREADY-BAKED render instead of re-rendering it.
let craftBaseline = "";
const craftStateJson = () =>
  craft.value
    ? JSON.stringify([craft.value.skin.id, craft.value.wear, craft.value.seed, craft.value.stickers, craft.value.charm])
    : "";
async function refreshCraftPreview() {
  const c = craft.value;
  const model = craftModel.value;
  if (!c || !model) return;
  // A brand-new craft with no customization has nothing worth baking — the
  // base catalog art is the truth until stickers/charm/wear get touched
  // (the template already falls back to craft.skin.image while null).
  if (editingId.value == null && craftBaseline === "" && !c.stickers.some(Boolean) && !c.charm) return;
  if (!(await hasModel(model))) return;
  const token = ++craftPreviewToken;
  craftPreviewBusy.value = true;
  try {
    const blob = await snapshotModel(
      model,
      {
        paintMaterial: c.skin.paintMaterial ?? null,
        legacyPaint: !!c.skin.legacyPaint,
        wear: Number(c.wear ?? 0),
        seed: Number(c.seed ?? 0),
        ...(await stickerGeom(model)),
        stickers: craftStickerPlacements(),
        charm: craftCharmPlacement(),
        // Dark readout, matching the card this preview stands in for rather
        // than the live 3D viewer. A draft has no kills to show anyway.
        stattrak: c.stattrak ? { count: null } : null,
      },
      // Another change landed while we waited our turn — don't bake a frame
      // whose result the token check below would only throw away.
      () => token === craftPreviewToken,
    );
    if (!blob || token !== craftPreviewToken) return;
    if (craftPreview.value) URL.revokeObjectURL(craftPreview.value);
    craftPreview.value = URL.createObjectURL(blob);
  } finally {
    if (token === craftPreviewToken) craftPreviewBusy.value = false;
  }
}
watch(
  () =>
    craft.value &&
    JSON.stringify([craft.value.skin.id, craft.value.wear, craft.value.seed, craft.value.stickers, craft.value.charm]),
  (v) => {
    clearTimeout(craftPreviewTimer);
    if (!v) {
      // modal closed — reset
      craftPreviewToken++;
      if (craftPreview.value) URL.revokeObjectURL(craftPreview.value);
      craftPreview.value = null;
      craftPreviewBusy.value = false;
      return;
    }
    if (v === craftBaseline) return; // unchanged since open — stored render stands
    craftPreviewTimer = setTimeout(() => void refreshCraftPreview(), 400);
  },
);

// Sticker/charm picker (searches the catalog server-side).
const picker = ref<{ kind: "sticker" | "charm" | "patch"; slot: number } | null>(null);
const pickerQuery = ref("");
const pickerResults = ref<Skin[]>([]);
const pickerLoading = ref(false);
let pickerTimer: ReturnType<typeof setTimeout> | undefined;
async function pickerSearch() {
  if (!picker.value) return;
  pickerLoading.value = true;
  try {
    const fn = picker.value.kind === "sticker" ? searchStickers : picker.value.kind === "patch" ? searchPatches : searchCharms;
    pickerResults.value = await fn(pickerQuery.value);
  } catch (e) {
    fail(e);
  } finally {
    pickerLoading.value = false;
  }
}
watch(pickerQuery, () => {
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(pickerSearch, 250);
});
// Same adjustable-tile treatment as the inventory/loadout grids. Charm and
// sticker art is small and busy — 92px is a lot of catalog on screen but too
// little to tell two similar charms apart, so the size is the user's call.
const attachCardSize = ref(Number(localStorage.getItem("cs2inv.attachCardSize")) || 92);
watch(attachCardSize, (v) => localStorage.setItem("cs2inv.attachCardSize", String(v)));
const attachGridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${attachCardSize.value}px, 1fr))`,
  gridAutoRows: `${attachCardSize.value + 12}px`,
}));
// Numeric x/y/z/rotation are the escape hatch, not the interface — dragging in
// 3D is. Off by default; the toggle is remembered for the session so anyone who
// wants the numbers isn't re-opening it on every craft.
const advancedPlacement = ref(false);
function openPicker(kind: "sticker" | "charm" | "patch", slot = 0) {
  picker.value = { kind, slot };
  pickerQuery.value = "";
  pickerResults.value = [];
  pickerSearch();
}
function pickAttachment(item: Skin) {
  if (!craft.value || !picker.value) return;
  const a: Attach = { id: item.id, name: item.name, image: item.image };
  const kind = picker.value.kind;
  if (kind === "sticker") craft.value.stickers[picker.value.slot] = a;
  else if (kind === "patch") craft.value.patches[picker.value.slot] = a;
  else craft.value.charm = a;
  picker.value = null;
  // Anything you just stuck on the gun is something you'll want to place, so
  // switch the preview to 3D where you can actually see where it landed.
  // Patches sit in fixed agent slots — nothing to drag, so they stay put.
  if (kind !== "patch" && modal3dAvailable.value) modal3d.value = true;
}
async function clearSlot(pos: string) {
  const teams: Team[] = isShared(pos) ? ["CT", "T"] : [team.value];
  try {
    await Promise.all(teams.map((t) => unequip(t, pos)));
    await refreshAll();
  } catch (e) {
    fail(e);
  }
}
async function toggleStatTrakInstance(inst: InventoryItem) {
  try {
    await updateInstance(inst.id, { stattrak: !inst.stattrak });
    await refreshAll();
  } catch (e) {
    fail(e);
  }
}
// Destructive actions ask first. There's already a 6-second undo behind this
// (see stageDelete), so the dialog isn't the only safety net — but undo only
// helps if you notice, and a mis-aimed click on a card's trash icon is exactly
// the case where you don't.
const confirmAsk = ref<{
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null>(null);
function runConfirm() {
  const c = confirmAsk.value;
  confirmAsk.value = null;
  c?.onConfirm();
}
// `after` runs only on confirm — so cancelling out of a delete started from the
// item modal leaves that modal open instead of closing it out from under you.
function deleteOwned(inst: InventoryItem, after?: () => void) {
  confirmAsk.value = {
    title: "Delete this item?",
    body: `“${itemName(inst.item) || "This item"}” will be removed from your inventory. Anything it's equipped on falls back to the default.`,
    confirmLabel: "Delete",
    onConfirm: () => {
      stageDelete([inst]);
      after?.();
    },
  };
}
async function copyToOtherTeam(pos: string) {
  const inst = equippedInstance(pos);
  if (!inst) return;
  const other: Team = team.value === "CT" ? "T" : "CT";
  try {
    await equip({ team: other, slot: pos, item_instance_id: inst.id });
    await refreshAll();
  } catch (e) {
    fail(e);
  }
}
// ---- admin console seam -----------------------------------------------------
// The /admin route owns the server key, cache and extraction UI — including its
// own fetching and polling, which mount/unmount now scope for free. App keeps
// only the two things that outlive that route: the gear badge, and the loadout
// render bookkeeping a cache clear invalidates.
const cfgMissing = ref<string[] | null>(null); // failed config types; null = no sync report yet
function onCfgSync(cfg: CfgSyncResult | null) {
  if (cfg) cfgMissing.value = cfg.failed;
}
// The models mount needs the extraction run: either never run, or run by an
// older pipeline than this build's script. Same badge as cfgMissing — this is
// the only place either surfaces outside /admin, and an admin who never opens
// the models tab would otherwise ship stale (or no) 3D forever.
type ExtractWarn = "missing" | "stale" | null;
const extractWarn = ref<ExtractWarn>(null);
const extractWarnFrom = (s: ExtractStatus): ExtractWarn =>
  s.stale !== true ? null : s.extracted === false ? "missing" : "stale";
// Both badge reasons in one line, so the tooltip says which one (or both) it is.
const gearWarnings = computed(() => {
  const out: string[] = [];
  if (cfgMissing.value?.length) out.push(`Game-server setup needed (${cfgMissing.value.join(", ")})`);
  if (extractWarn.value === "missing") out.push("Model extraction has never been run");
  else if (extractWarn.value === "stale") out.push("Model extraction is out of date — re-run it");
  return out;
});
function onCacheCleared(scope: "renders" | "paints" | "all") {
  if (scope === "paints") return;
  // Reset session bookkeeping so cards re-bake fresh right away.
  renderedIds.clear();
  Object.values(localRenders.value).forEach((u) => URL.revokeObjectURL(u));
  localRenders.value = {};
  // Clearing bakeStamp REMOVES each card's cache-buster, which sent every <img>
  // back to the one URL the browser had cached — the opposite of the intent.
  // The epoch replaces it: one new buster for every card at once.
  bakeStamp.value = {};
  cacheEpoch.value = Date.now();
  queueLoadoutRenders();
}

// ---- animated sliding-pill tabs (mirrors the panel's TabsList indicator) ----
// One reusable mechanism powers the view tabs, sheet-mode tabs, CT/T toggle
// and the inventory origin filter. Self-healing: the loadout app remounts
// inside an out-in Transition when leaving /admin, so nextTick watchers fire
// before the entering tree is in the DOM and measure nothing — each pill
// therefore re-measures via ResizeObserver whenever its tab list (re)mounts,
// resizes (fonts, count badges) or flips hidden→visible.
function makePill() {
  const refs: Record<string, HTMLElement | null> = {};
  let listEl: HTMLElement | null = null;
  let activeKey = "";
  const x = ref(0);
  const w = ref(0);
  const animated = ref(false);
  function sync(key?: string) {
    if (key !== undefined) activeKey = key;
    const btn = refs[activeKey];
    if (!listEl || !btn) {
      w.value = 0;
      return;
    }
    const listRect = listEl.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    // Coming back from hidden: place the indicator instantly instead of
    // sliding it in from wherever it last sat.
    if (w.value === 0) animated.value = false;
    x.value = btnRect.left - listRect.left;
    w.value = btnRect.width;
    requestAnimationFrame(() => (animated.value = true));
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
  return {
    x,
    w,
    animated,
    setListEl(el: unknown) {
      const next = (el as HTMLElement | null) ?? null;
      if (next === listEl) return;
      if (listEl) ro?.unobserve(listEl);
      listEl = next;
      if (listEl) ro?.observe(listEl);
    },
    setRef(key: string, el: unknown) {
      refs[key] = (el as HTMLElement | null) ?? null;
    },
    sync,
  };
}
const viewPill = makePill();
const sheetPill = makePill();
const teamPill = makePill();
const invOriginPill = makePill();
const modal3dPill = makePill();
const sheetOriginPill = makePill();
const focus3dPill = makePill();
function syncAllPills() {
  viewPill.sync(view.value);
  sheetPill.sync(sheetMode.value);
  teamPill.sync(team.value);
  invOriginPill.sync(invOrigin.value);
  modal3dPill.sync(modal3d.value ? "3D" : "2D");
  sheetOriginPill.sync(sheetOrigin.value);
  focus3dPill.sync(focus3d.value ? "3D" : "2D");
}
// immediate: seeds the pill's active key before the modal ever opens, so the
// ResizeObserver's initial fire on mount can position the indicator itself.
watch(modal3d, () => nextTick(() => modal3dPill.sync(modal3d.value ? "3D" : "2D")), { immediate: true });
// Sheet pill also tracks things that change tab widths (owned count) or tab
// existence (Replace only on weapon slots).
watch([sheetMode, selected, () => inventory.value.length], () => nextTick(() => sheetPill.sync(sheetMode.value)));
watch([team, view], () => nextTick(syncAllPills));

const linkOpening = ref(false);
// Hands a steam:// inspect link to the OS, which launches CS2 straight into
// the inspect view for this craft — stickers and all — without the item ever
// existing on Steam's backend. Nothing happens if Steam isn't installed to
// claim the protocol, so this stays a no-op rather than an error.
async function openInspectLink(id: number) {
  try {
    const { inspect } = await fetchInspectLink(id);
    window.location.href = inspect;
    linkOpening.value = true;
    setTimeout(() => (linkOpening.value = false), 1600);
  } catch (e) {
    fail(e);
  }
}
async function toggleStatTrak() {
  const inst = equippedInstance(selected.value);
  if (inst) await toggleStatTrakInstance(inst);
}

function switchTeam(t: Team) {
  team.value = t;
}

// ---- right-click context menu: owned items (sheet + inventory cards) --------
const itemCtx = ref<{ inst: InventoryItem; x: number; y: number } | null>(null);
// As with openCtxFor: `at` is the cursor anchor for the desktop menu, omitted
// by long-press because compact renders this as a bottom sheet.
function openItemCtxFor(inst: InventoryItem, at?: { x: number; y: number }) {
  if (!canEdit.value) return;
  ctx.value = null;
  const x = at ? Math.min(Math.max(8, at.x), window.innerWidth - 230) : 0;
  const y = at ? Math.min(Math.max(8, at.y), window.innerHeight - 300) : 0;
  itemCtx.value = { inst, x, y };
}
const openItemCtx = (inst: InventoryItem, e: MouseEvent) => openItemCtxFor(inst, { x: e.clientX, y: e.clientY });
const closeItemCtx = () => (itemCtx.value = null);
// Which teams this owned item can be equipped for (null entry = shared-only).
const itemCtxTeams = computed<Team[] | "shared" | null>(() => {
  const inst = itemCtx.value?.inst;
  if (!inst?.slot) return null;
  if (isShared(inst.slot)) return "shared";
  const t = inst.item?.teams;
  return !t || t.length === 0 ? (["CT", "T"] as Team[]) : t;
});
function itemCtxPos(): string | null {
  const inst = itemCtx.value?.inst;
  if (!inst) return null;
  return view.value === "inventory" ? positionForInstance(inst) : selected.value;
}
async function ctxEquipTeams(teams: Team[]) {
  const inst = itemCtx.value?.inst;
  const pos = itemCtxPos();
  closeItemCtx();
  if (!inst || !pos) {
    if (inst) fail(new Error("No loadout slot fits that item."));
    return;
  }
  try {
    await Promise.all(teams.map((t) => equip({ team: t, slot: pos, item_instance_id: inst.id })));
    await refreshAll();
    pulseSlot(pos);
  } catch (e) {
    fail(e);
  }
}
async function itemCtxStatTrak() {
  const inst = itemCtx.value?.inst;
  closeItemCtx();
  if (inst) await toggleStatTrakInstance(inst);
}
function itemCtxEdit() {
  const inst = itemCtx.value?.inst;
  closeItemCtx();
  if (inst) openEdit(inst);
}
async function itemCtxDelete() {
  const inst = itemCtx.value?.inst;
  closeItemCtx();
  if (inst) deleteOwned(inst);
}
async function itemCtxInspect() {
  const inst = itemCtx.value?.inst;
  closeItemCtx();
  if (inst) await openInspectLink(inst.id);
}
function itemCtxView3d() {
  const inst = itemCtx.value?.inst;
  closeItemCtx();
  if (inst) view3dForInstance(inst);
}

// ---- right-click context menu ----------------------------------------------
const ctx = ref<{ pos: string; x: number; y: number } | null>(null);
const ctx3dOk = ref(false);
// `at` = cursor coords for the anchored desktop menu. Long-press passes none:
// compact renders this menu as a bottom sheet, where a cursor position would be
// meaningless (and unclampable — at 400px wide, innerWidth-220 is off-screen).
function openCtxFor(pos: string, at?: { x: number; y: number }) {
  if (!canEdit.value) return;
  itemCtx.value = null;
  selected.value = pos;
  const x = at ? Math.min(Math.max(8, at.x), window.innerWidth - 220) : 0;
  const y = at ? Math.min(Math.max(8, at.y), window.innerHeight - 260) : 0;
  ctx.value = { pos, x, y };
  ctx3dOk.value = false;
  if (!isNo3d(pos)) {
    const model = occupantModel(pos);
    hasModel(model).then((ok) => {
      if (ctx.value?.pos === pos) ctx3dOk.value = ok;
    });
  }
}
const openCtx = (pos: string, e: MouseEvent) => openCtxFor(pos, { x: e.clientX, y: e.clientY });
const closeCtx = () => (ctx.value = null);

// ---- long-press → the slot menu (touch has no right-click) ------------------
// Delegated from the loadout container instead of bound per-slot: every slot
// already carries data-slot for the drag/drop system, and there are five
// distinct slot markups that would each otherwise need the same four handlers.
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10; // movement past this is a scroll, not a press
let lpTimer: ReturnType<typeof setTimeout> | undefined;
let lpOrigin: { x: number; y: number } | null = null;
let lpFired = false;
// Sticky across sessions: once you know the gesture you don't need telling.
const hasLongPressed = ref(localStorage.getItem("cs2inv.lp") === "1");

function cancelLongPress() {
  clearTimeout(lpTimer);
  lpOrigin = null;
}
function onSlotPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse") return; // mouse already has right-click
  const pos = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-slot]")?.dataset.slot;
  if (!pos) return;
  lpFired = false;
  lpOrigin = { x: e.clientX, y: e.clientY };
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpFired = true;
    lpOrigin = null;
    // Haptic confirmation the press "took" — without it the gesture feels
    // broken for the frame or two before the menu paints.
    navigator.vibrate?.(8);
    if (!hasLongPressed.value) {
      hasLongPressed.value = true;
      localStorage.setItem("cs2inv.lp", "1");
    }
    openCtxFor(pos);
  }, LONG_PRESS_MS);
}
function onSlotPointerMove(e: PointerEvent) {
  if (lpOrigin && Math.hypot(e.clientX - lpOrigin.x, e.clientY - lpOrigin.y) > LONG_PRESS_SLOP) cancelLongPress();
}
// The browser still delivers a click when the finger lifts. Swallow it, or the
// long-press would also select the slot sitting behind the menu it just opened.
function onSlotClickCapture(e: MouseEvent) {
  if (!lpFired) return;
  lpFired = false;
  e.stopPropagation();
  e.preventDefault();
}

// ---- compact layout: one slot category at a time ----------------------------
// The desktop grid shows all four groups side by side; a phone shows one, with
// the rail as the switcher. Categories mirror the desktop columns exactly so
// the vocabulary doesn't fork between layouts.
function catOfPos(pos: string): string {
  return POSITION_GROUPS.find((g) => (g.positions as readonly string[]).includes(pos))?.key ?? "equipment";
}
const compactCat = ref(catOfPos(selected.value));
// Short labels so all four chips fit a 360px viewport without the last one
// getting clipped. "EQUIP" is CS2's own wording for this screen, and "MID"
// reads unambiguously next to PISTOLS/RIFLES.
const COMPACT_CAT_LABEL: Record<string, string> = { equipment: "Equip", midtier: "Mid" };
const compactCats = computed(() =>
  [
    { key: "equipment", label: "Equipment", skinned: ALL_SPECIALS.filter((s) => rowFor(s.slot)).length, total: ALL_SPECIALS.length },
    ...columnsView.value.map((g) => ({ key: g.key, label: g.label, skinned: g.skinned, total: g.positions.length })),
  ].map((c) => ({ ...c, short: COMPACT_CAT_LABEL[c.key] ?? c.label })),
);
const compactCells = computed(() => columnsView.value.find((g) => g.key === compactCat.value)?.cells ?? []);
// Knife and gloves lead (they're what people actually change), agent takes the
// full width as the identity piece, then the four utility slots.
const compactEquipment = computed(() => [RAIL[2], RAIL[1], RAIL[0], ...EXTRAS]);
// 164px tiles give exactly two cramped columns at 360px. 132px gives a clean
// two-up with room for the gutter, and squares up the row so art isn't
// letterboxed. Keep in sync with contain-intrinsic-size in style.css.
// ---- compact picker sheet: draggable, three snap points --------------------
// Desktop gives the sheet a flat 34vh because the loadout beside it is fully
// visible anyway. On a phone the two compete for one short viewport, so the
// user needs to arbitrate: peek to see the loadout, full to browse skins.
// Rarity + sort + origin are three separate controls that wrap onto their own
// lines at phone widths, turning the toolbar into four stacked rows before a
// single item is visible. Compact collapses them behind one chip; desktop has
// the width to show them inline and never sees this flag.
const sheetFiltersOpen = ref(false);
// Search counts as an active filter on compact — it lives inside the sheet
// there, so without it in the badge a search you forgot about is invisible.
const sheetFilterCount = computed(
  () =>
    (activeRarity.value ? 1 : 0) +
    (sheetOrigin.value !== "all" ? 1 : 0) +
    (sheetSort.value !== DEFAULT_SORT ? 1 : 0) +
    (sheetSearch.value.trim() ? 1 : 0),
);
// Live count behind the sheet's confirm button, so you can tell a filter
// combination returns nothing before dismissing the sheet to find out.
const sheetResultCount = computed(() =>
  sheetMode.value === "owned"
    ? ownedForSheet.value.length
    : sheetMode.value === "craft"
      ? craftList.value.length
      : replaceOptions.value.defaults.length + replaceOptions.value.owned.length,
);
function resetSheetFilters() {
  sheetSearch.value = "";
  activeRarity.value = "";
  sheetOrigin.value = "all";
  sheetSort.value = DEFAULT_SORT;
}

// The default snap reserves exactly two rows of slot cards — four skins — and
// the fifth scrolls. Expressed as a PIXEL reserve, not a screen fraction: a
// fraction that shows two rows on a 800px phone shows four on a 1180px one,
// and the cap is the point.
const COMPACT_CARD_H = 118; // slot card min-height
const COMPACT_GRID_GAP = 8; // grid gap-2
const COMPACT_GRID_PAD = 28; // pt-3 + pb-4
const COMPACT_RAIL_H = 43; // category rail, measured
const HALF_RESERVE = 2 * COMPACT_CARD_H + COMPACT_GRID_GAP + COMPACT_GRID_PAD + COMPACT_RAIL_H;
const PEEK_FRAC = 0.22;
const FULL_FRAC = 0.86;
// Floor for `half` so a short/landscape phone can't hand the whole screen to
// the loadout and leave the picker a sliver.
const HALF_MIN_FRAC = 0.3;

type SheetSnap = "peek" | "half" | "full";
function snapFrac(s: SheetSnap, containerH: number): number {
  if (s === "peek") return PEEK_FRAC;
  if (s === "full") return FULL_FRAC;
  return containerH > 0 ? Math.max(HALF_MIN_FRAC, (containerH - HALF_RESERVE) / containerH) : 0.5;
}
const sheetSnap = ref<SheetSnap>("half");
const sheetDragPx = ref<number | null>(null);
let sheetDrag: { y: number; h: number; max: number; moved: boolean } | null = null;

const sheetStyle = computed(() => {
  if (!isCompact.value) return {};
  const snap = sheetSnap.value;
  const height =
    sheetDragPx.value != null
      ? `${sheetDragPx.value}px`
      : snap === "half"
        // CSS does the arithmetic so the reserve holds at any viewport height
        // without this needing to observe the container.
        ? `max(${HALF_MIN_FRAC * 100}%, calc(100% - ${HALF_RESERVE}px))`
        : `${(snap === "peek" ? PEEK_FRAC : FULL_FRAC) * 100}%`;
  // No transition mid-drag — the height must track the finger exactly.
  return { height, transition: sheetDragPx.value == null ? "height 260ms cubic-bezier(0.22,1,0.36,1)" : "none" };
});

function onSheetDragStart(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  const host = handle.closest<HTMLElement>("[data-role='picker-sheet']");
  const container = host?.parentElement;
  if (!host || !container) return;
  sheetDrag = { y: e.clientY, h: host.getBoundingClientRect().height, max: container.clientHeight, moved: false };
  handle.setPointerCapture(e.pointerId);
}
function onSheetDragMove(e: PointerEvent) {
  if (!sheetDrag) return;
  const dy = e.clientY - sheetDrag.y;
  if (Math.abs(dy) > 3) sheetDrag.moved = true;
  // Dragging up grows the sheet, so the delta is inverted.
  sheetDragPx.value = Math.max(sheetDrag.max * 0.14, Math.min(sheetDrag.h - dy, sheetDrag.max * 0.9));
}
function onSheetDragEnd() {
  if (!sheetDrag) return;
  // A tap (no travel) cycles rather than snapping to where it already was —
  // the handle should do something useful for people who don't think to drag.
  if (!sheetDrag.moved) sheetSnap.value = sheetSnap.value === "full" ? "peek" : sheetSnap.value === "half" ? "full" : "half";
  else {
    const frac = (sheetDragPx.value ?? 0) / sheetDrag.max;
    const snaps: SheetSnap[] = ["peek", "half", "full"];
    const d = (k: SheetSnap) => Math.abs(snapFrac(k, sheetDrag!.max) - frac);
    sheetSnap.value = snaps.reduce((best, k) => (d(k) < d(best) ? k : best), snaps[0]);
  }
  sheetDragPx.value = null;
  sheetDrag = null;
}

// Same adjustable card size as the Inventory grid. The default is roomier
// than the old fixed 164/132 — tiles now carry a model header + team dots, and
// the art needs air under the type line. Compact clamps the floor so a phone
// still fits two columns.
const sheetCardSize = ref(Number(localStorage.getItem("cs2inv.sheetCardSize")) || 176);
watch(sheetCardSize, (v) => localStorage.setItem("cs2inv.sheetCardSize", String(v)));
const pickerGridStyle = computed(() => {
  const tile = isCompact.value ? Math.min(sheetCardSize.value, 168) : sheetCardSize.value;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))`,
    gridAutoRows: `${tile + CARD_CHROME_PX}px`,
  };
});
// Selecting a slot from anywhere else (focus rail, a menu action, equipping)
// pulls the rail to the category that actually contains it — otherwise the
// selection highlight lands on a card the user can't see.
watch(selected, (pos) => {
  const c = catOfPos(pos);
  if (c !== compactCat.value) compactCat.value = c;
  // Picking a slot is a statement of intent to change it — surface the picker
  // if it was collapsed. Never shrink an already-open sheet.
  if (sheetSnap.value === "peek") sheetSnap.value = "half";
});
function ctxOwned() {
  sheetMode.value = "owned";
  closeCtx();
}
function ctxCraft() {
  sheetMode.value = "craft";
  closeCtx();
}
function ctxReplace() {
  sheetMode.value = "replace";
  closeCtx();
}
async function ctxReset() {
  if (ctx.value) await clearSlot(ctx.value.pos);
  closeCtx();
}
async function ctxStatTrak() {
  const inst = ctx.value ? equippedInstance(ctx.value.pos) : undefined;
  if (inst) await toggleStatTrakInstance(inst);
  closeCtx();
}
async function ctxInspect() {
  const pos = ctx.value?.pos;
  closeCtx();
  const inst = pos ? equippedInstance(pos) : undefined;
  if (inst) await openInspectLink(inst.id);
}
async function ctxCopy() {
  if (ctx.value) await copyToOtherTeam(ctx.value.pos);
  closeCtx();
}

// ---- inventory view ---------------------------------------------------------
const invSearch = ref("");
// Synced (steam) vs crafted filter + adjustable card size (persisted).
const invOrigin = ref<OriginFilter>("all");
// Multi-select, not one-of: toggling is the whole point of the rail, and
// "show me my AKs AND my AWPs" is a question people actually have. An item
// shows if it matches ANY active toggle; nothing active means everything.
const invModels = ref<string[]>([]); // specific weapon models, e.g. "ak47"
const invTypes = ref<string[]>([]); // whole categories, e.g. "rifle" or "sticker"
function toggleModel(m: string) {
  invModels.value = invModels.value.includes(m)
    ? invModels.value.filter((x) => x !== m)
    : [...invModels.value, m];
}
function toggleType(t: string) {
  invTypes.value = invTypes.value.includes(t)
    ? invTypes.value.filter((x) => x !== t)
    : [...invTypes.value, t];
}
const matchesRail = (i: InventoryItem) => {
  if (!invModels.value.length && !invTypes.value.length) return true;
  const m = i.item?.model;
  return (!!m && invModels.value.includes(m)) || invTypes.value.includes(categoryOf(i));
};
// Everything EXCEPT the rail's own filters, so the counts it shows describe
// what clicking would actually give you rather than counting rows the search
// box has already excluded.
const railBase = computed(() => {
  const q = invSearch.value.trim().toLowerCase();
  return inventory.value.filter(
    (i) => (!q || itemName(i.item).toLowerCase().includes(q)) && matchesOrigin(i, invOrigin.value),
  );
});
const invRail = computed(() => {
  const models = new Map<string, { model: string; name: string; image: string | null; count: number; cat: string }>();
  const types = new Map<string, number>();
  for (const i of railBase.value) {
    const cat = categoryOf(i);
    types.set(cat, (types.get(cat) ?? 0) + 1);
    const m = i.item?.model;
    if (!m || !WEAPONISH.has(cat)) continue;
    const hit = models.get(m);
    if (hit) {
      hit.count++;
      continue;
    }
    const base = weapons.value.find((w) => w.model === m);
    models.set(m, {
      model: m,
      name: base?.name ?? prettyModel(m),
      // The vanilla silhouette, not the first skin that happens to be owned —
      // a filter tile should say "AK-47", not "AK-47 | Redline".
      image: base?.image ?? i.item?.image ?? null,
      count: 1,
      cat,
    });
  }
  return {
    // Empty groups aren't drawn: the rail should be a picture of what you own.
    weapons: WEAPON_GROUPS.map(([key, label]) => ({
      key,
      label,
      count: types.get(key) ?? 0,
      items: [...models.values()].filter((e) => e.cat === key).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length),
    gear: GEAR_TYPES.map(([key, label]) => ({ key, label, count: types.get(key) ?? 0 })).filter((r) => r.count),
  };
});
// Whether the filter rail is drawn (it also needs `lg:` — see INV_TOOLBAR_PL).
const invRailShown = computed(
  () => !!inventory.value.length && invRail.value.weapons.length + invRail.value.gear.length > 1,
);
const filtersActive = computed(
  () =>
    !!invSearch.value.trim() ||
    invOrigin.value !== "all" ||
    !!invRarity.value ||
    !!invModels.value.length ||
    !!invTypes.value.length,
);
function clearInvFilters() {
  invSearch.value = "";
  invOrigin.value = "all";
  invRarity.value = "";
  invModels.value = [];
  invTypes.value = [];
}
watch(invOrigin, () => nextTick(() => invOriginPill.sync(invOrigin.value)));
const cardSize = ref(Number(localStorage.getItem("cs2inv.cardSize")) || 164);
watch(cardSize, (v) => localStorage.setItem("cs2inv.cardSize", String(v)));
const invGridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`,
  gridAutoRows: `${cardSize.value + CARD_CHROME_PX}px`,
}));

// ---- view state ↔ query -----------------------------------------------------
// Team, focused slot and the inventory filters used to be local-only, which
// meant a shared link opened on the recipient's side and their slot rather than
// the one being talked about. They ride the query now.
//
// Both directions are idempotent — each writes only when the value actually
// differs — so there's no syncing flag here; the loop converges on its own.
// Everything is `replace`, because dragging a wear slider or typing in the
// search box should not bury the back button under fifty history entries.
function syncViewQuery() {
  const path = router.path.value;
  const next = viewQuery(path, transientQuery());
  const now = router.query.value;
  const same =
    Object.keys(next).length === Object.keys(now).length &&
    Object.entries(next).every(([k, v]) => now[k] === v);
  if (!same) router.go(path, { replace: true, query: next });
}
let searchUrlTimer: ReturnType<typeof setTimeout> | undefined;
watch([team, selected, invOrigin, invSort, invTypes, invModels], syncViewQuery);
watch(invSearch, () => {
  clearTimeout(searchUrlTimer);
  searchUrlTimer = setTimeout(syncViewQuery, 350);
});
onBeforeUnmount(() => clearTimeout(searchUrlTimer));

// Query → state. Reading an absent param as "the default" is what makes the
// back button undo a filter instead of leaving it stuck on.
watch(
  () => router.query.value.team,
  (t) => {
    const next: Team = t === "T" || t === "CT" ? t : DEFAULT_TEAM;
    if (next !== team.value) team.value = next;
  },
  { immediate: true },
);
watch(
  [() => router.query.value.slot, () => route.value.name],
  () => {
    // Only the loadout and focus screens address a slot. Without this guard,
    // navigating to /items (where ?slot is deliberately absent) would reset the
    // user's focused slot back to the default behind their back.
    const r = route.value.name;
    if (r !== "loadout" && r !== "focus") return;
    const s = router.query.value.slot ?? DEFAULT_SLOT;
    if (s !== selected.value && (isWeaponPos(s) || isSpecial(s))) selected.value = s;
  },
  { immediate: true },
);
watch(
  [
    () => router.query.value.q,
    () => router.query.value.origin,
    () => router.query.value.sort,
    () => router.query.value.cat,
    () => router.query.value.wep,
    () => route.value.name,
  ],
  () => {
    const r = route.value.name;
    if (r !== "inventory" && r !== "item") return;
    const q = router.query.value.q ?? "";
    if (q !== invSearch.value) invSearch.value = q;
    const o = router.query.value.origin;
    const nextOrigin: OriginFilter = o === "steam" || o === "crafted" ? o : "all";
    if (nextOrigin !== invOrigin.value) invOrigin.value = nextOrigin;
    const s = router.query.value.sort;
    const nextSort = SORTS.some(([m]) => m === s) ? (s as SortMode) : DEFAULT_SORT;
    if (nextSort !== invSort.value) invSort.value = nextSort;
    const known = new Set<string>([...WEAPON_GROUPS.map(([k]) => k), ...GEAR_TYPES.map(([k]) => k)]);
    const cats = (router.query.value.cat ?? "").split(".").filter((k) => known.has(k));
    if (cats.join(".") !== invTypes.value.join(".")) invTypes.value = cats;
    // Models aren't validated against a list: the catalog is the authority and
    // it isn't loaded yet on a cold deep link. An unknown one simply matches
    // nothing, which the empty state already explains.
    const weps = (router.query.value.wep ?? "").split(".").filter(Boolean);
    if (weps.join(".") !== invModels.value.join(".")) invModels.value = weps;
  },
  { immediate: true },
);
const filteredInventory = computed(() => {
  const q = invSearch.value.trim().toLowerCase();
  return sortInstances(
    inventory.value.filter(
      (i) =>
        (!q || itemName(i.item).toLowerCase().includes(q)) &&
        matchesOrigin(i, invOrigin.value) &&
        (!invRarity.value || i.item?.rarity === invRarity.value) &&
        matchesRail(i),
    ),
    invSort.value,
  );
});
function canEquipInstance(i: InventoryItem): boolean {
  if (!i.slot) return false;
  if (isShared(i.slot)) return true;
  const teams = i.item?.teams;
  return !teams || teams.length === 0 || teams.includes(team.value);
}
// Where an inventory item would go: the position its weapon already occupies,
// else the first eligible position in its category group.
function positionForInstance(i: InventoryItem): string | null {
  if (!i.item) return null;
  if (isSpecial(i.slot ?? "")) return i.slot;
  const model = i.item.model;
  if (!model) return null;
  for (const g of POSITION_GROUPS) {
    for (const p of g.positions) {
      if (occupantModel(p) === model) return p;
    }
  }
  const cat = i.item.category;
  const group = cat === "secondary" ? POSITION_GROUPS[0] : cat === "rifle" ? POSITION_GROUPS[2] : POSITION_GROUPS[1];
  for (const p of group.positions) {
    if (p === "sp" && !START_PISTOLS.includes(model)) continue;
    if (p !== "sp" && group.key === "pistols" && START_PISTOLS.includes(model)) continue;
    return p;
  }
  return null;
}
async function equipFromInventory(i: InventoryItem) {
  const pos = positionForInstance(i);
  if (!pos) {
    fail(new Error("No loadout slot fits that item."));
    return;
  }
  await equipInstanceAt(i, pos);
}

// ---- opening an item --------------------------------------------------------
// Clicking a card used to equip it on the spot, which meant the only way to
// LOOK at a skin was the tiny hover pencil. Now a click opens the item big,
// with every action on it — equipping is a deliberate button press.
//
// There used to be a second, purpose-built "detail" modal here: a still render,
// the same facts, the same buttons. It existed only because the 3D view had no
// spec column. Now that it has one, /items/<id> opens the SAME view-mode craft
// modal /items/<id>/3d does — one screen for looking at an item, which can also
// spin it, drop to 2D, and hand off to Edit.
function openDetail(i: InventoryItem) {
  if (route.value.name === "item" && route.value.id === String(i.id)) return;
  openModalRoute(`/items/${i.id}`);
}
// Where this item would land, spelled out ("Rifles · Slot 2") so the equip
// button says what it will actually do.
const craftEquipTarget = computed(() => {
  const i = craftInst.value;
  if (!i || !viewOnly.value || !canEquipInstance(i)) return null;
  const pos = positionForInstance(i);
  if (!pos) return null;
  if (isSpecial(pos)) return { pos, label: ALL_SPECIALS.find((s) => s.slot === pos)?.name ?? pos };
  const g = POSITION_GROUPS.find((x) => (x.positions as readonly string[]).includes(pos));
  const weapon = occupantWeapon(pos)?.name ?? pos;
  return { pos, label: g ? `${weapon} · ${g.label}` : weapon };
});
async function craftViewEquip() {
  const i = craftInst.value;
  if (!i) return;
  closeCraft();
  await equipFromInventory(i);
}

// ---- focus view -------------------------------------------------------------
// The rail is EVERY slot in the loadout, mini. It replaced a bottom strip that
// only listed the current group (so gear was unreachable from a rifle, and
// vice-versa) — one nav that always shows the whole loadout means focus mode
// needs no second row of chrome under the stage.
const focusRail = computed(() => [
  ...POSITION_GROUPS.map((g) => ({
    key: g.key as string,
    label: g.label as string,
    items: g.positions.map((pos) => ({
      pos: pos as string,
      name: occupantWeapon(pos)?.name ?? pos,
      image: cellSrc(pos),
      rarity: rarityOf(pos),
    })),
  })),
  {
    key: "gear",
    label: "Gear",
    items: ALL_SPECIALS.map((s) => ({
      pos: s.slot,
      name: s.name,
      image: specialImage(s.slot),
      rarity: rarityOf(s.slot),
    })),
  },
]);
// "Rifles · Slot 2" — which hole in the loadout you're looking at, since the
// rail's art alone doesn't say where the weapon sits.
const focusSlotLabel = computed(() => {
  const pos = selected.value;
  if (isSpecial(pos)) return isShared(pos) ? "Gear · CT + T" : `Gear · ${team.value}`;
  const g = POSITION_GROUPS.find((x) => (x.positions as readonly string[]).includes(pos));
  if (!g) return "";
  if (pos === "sp") return `${g.label} · Starting`;
  return `${g.label} · Slot ${(g.positions as readonly string[]).indexOf(pos) + 1}`;
});
const focusRow = computed(() => rowFor(selected.value));

// ---- 3D viewer (Focus view) -------------------------------------------------
// Shows a 3D toggle whenever public/models/<weapon-model>.glb exists.
// 3D is the default stage — focus exists to look at the gun. The ref itself
// starts false and flips per-slot once availability is known; the PREFERENCE
// (last explicit 2D/3D pick) lives in localStorage so a slot with no model
// forcing 2D doesn't overwrite what the user actually chose.
const focus3dPref = () => localStorage.getItem("cs2inv.focus3d") !== "0";
function setFocus3d(on: boolean) {
  focus3d.value = on;
  localStorage.setItem("cs2inv.focus3d", on ? "1" : "0");
}
const focus3d = ref(false);
const focus3dAvailable = ref(false);
const focus3dBusy = ref(false);
// immediate: seeds the active key before the focus stage mounts, so the pill's
// initial ResizeObserver fire can position the indicator on its own.
watch(focus3d, () => nextTick(() => focus3dPill.sync(focus3d.value ? "3D" : "2D")), { immediate: true });
// Sheet origin tabs only exist in Owned mode (and behind the compact filter
// disclosure), so re-seed on every condition that (re)mounts them.
watch([sheetOrigin, sheetMode, sheetFiltersOpen], () => nextTick(() => sheetOriginPill.sync(sheetOrigin.value)), { immediate: true });
const viewer3dEl = ref<HTMLElement | null>(null);
let viewerHandle: ViewerHandle | null = null;
const focusModelKey = computed(() =>
  view.value === "focus" && !isNo3d(selected.value) ? occupantModel(selected.value) : null,
);
const focusPaint = computed(() =>
  isSkinned(focusRow.value) ? focusRow.value?.item?.paintMaterial ?? null : null,
);
const focusLegacyPaint = computed(() => !!focusRow.value?.item?.legacyPaint);

// ---- "Report a problem" (every 3D stage) ------------------------------------
// Render bugs are near-impossible to triage from a screenshot alone — what
// decides the output is the paint material, the body variant and the seed — so
// the link pre-fills the issue with the exact state on screen and leaves the
// reporter only the "what looks wrong" part to write.
const ISSUE_NEW_URL = "https://github.com/lukepolo/5stack-inventory-plugin/issues/new";
// Deliberately quiet — it only needs to be findable at the moment something
// looks wrong, so it reads as a footnote until hovered.
const REPORT_LINK =
  "text-f9 uppercase tracking-cs2 text-muted-foreground/40 underline decoration-dotted underline-offset-2 transition-colors hover:text-[color:var(--acc)]";
function issue3dHref(o: {
  weapon: string;
  finish?: string | null;
  model?: string | null;
  paintMaterial?: string | null;
  legacyPaint?: boolean;
  wear?: number | null;
  seed?: number | null;
  stattrak?: boolean;
  stickers?: number;
  charm?: boolean;
  where: string;
}) {
  const finish = o.finish || "Default finish";
  const title = `[3D] ${o.weapon} — ${finish}`;
  const facts: [string, string][] = [
    ["Weapon", o.weapon],
    ["Finish", finish],
    ["Model", o.model || "—"],
    ["Paint material", o.paintMaterial || "—"],
    ["Body", o.legacyPaint ? "legacy" : "hd"],
    ["Float", o.wear != null ? o.wear.toFixed(6) : "—"],
    ["Seed", o.seed != null ? String(o.seed) : "—"],
    ["StatTrak™", o.stattrak ? "yes" : "no"],
    ["Stickers", String(o.stickers ?? 0)],
    ["Charm", o.charm ? "yes" : "no"],
    ["Screen", o.where],
  ];
  const body = [
    "### What looks wrong?",
    "",
    "<!-- Describe the problem, and drop a screenshot here if you can. -->",
    "",
    "### Item",
    "",
    ...facts.map(([k, v]) => `- **${k}:** ${v}`),
    "",
    `<sub>${navigator.userAgent}</sub>`,
  ].join("\n");
  return `${ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
// Focus stage.
const focusReportHref = computed(() => {
  const row = focusRow.value;
  const inst = focusInstance.value;
  return issue3dHref({
    weapon: sheetWeaponName.value,
    finish: isSkinned(row) ? [row?.item?.name, row?.item?.altName].filter(Boolean).join(" · ") : null,
    model: focusModelKey.value,
    paintMaterial: focusPaint.value,
    legacyPaint: focusLegacyPaint.value,
    wear: row?.wear,
    seed: row?.seed,
    stattrak: row?.stattrak,
    stickers: (inst?.stickers ?? []).filter(Boolean).length,
    charm: !!inst?.charm?.image,
    where: `focus · ${focusSlotLabel.value || selected.value}`,
  });
});
// Craft / view-item modal. Reads the LIVE craft form, not the saved instance —
// the whole point is reporting what is on screen right now, mid-edit.
const craftReportHref = computed(() => {
  const c = craft.value;
  if (!c) return ISSUE_NEW_URL;
  return issue3dHref({
    weapon: weaponByModel.value.get(craftModel.value ?? "")?.name ?? sheetWeaponName.value,
    finish: [c.skin.name, c.skin.altName].filter(Boolean).join(" · "),
    model: craftModel.value,
    paintMaterial: c.skin.paintMaterial,
    legacyPaint: !!c.skin.legacyPaint,
    wear: c.wear,
    seed: c.seed,
    stattrak: c.stattrak,
    stickers: c.stickers.filter(Boolean).length,
    charm: !!c.charm?.image,
    where: viewOnly.value ? "item view modal" : "craft modal",
  });
});
// Default-weapon overlay — a bare model, so there is no finish to report.
const loadout3dReportHref = computed(() =>
  loadout3d.value
    ? issue3dHref({ weapon: loadout3d.value.name, model: loadout3d.value.model, where: "default-weapon 3D overlay" })
    : ISSUE_NEW_URL,
);

// Same abort discipline as the modal viewer: switching slots quickly on the
// focus screen used to leave every superseded mount running to completion.
let focusViewerAbort: AbortController | null = null;
function teardownViewer() {
  focusViewerAbort?.abort();
  focusViewerAbort = null;
  viewerHandle?.dispose();
  viewerHandle = null;
}
watch([focusModelKey, focusPaint], async ([key]) => {
  teardownViewer();
  focus3dAvailable.value = key ? await hasModel(key) : false;
  if (!focus3dAvailable.value) focus3d.value = false;
  else {
    // Model exists → land on the preferred stage (3D unless they picked 2D).
    const wasOn = focus3d.value;
    focus3d.value = focus3dPref();
    // The focus3d watcher only mounts on false→true; an already-on viewer
    // switching slots needs the remount called explicitly.
    if (focus3d.value && wasOn) await mount3d();
  }
});
// The equipped instance behind the focused slot (own loadout only — public
// viewer mode has no inventory list, so attachments just don't render there).
const focusInstance = computed(() => {
  return instanceById(focusRow.value?.item_instance_id) ?? null;
});
// InventoryItem → viewer placement shapes (Focus + loadout 3D overlay).
function instPlacements(inst?: InventoryItem | null) {
  return {
    stickers: (inst?.stickers ?? []).flatMap((st, i) =>
      st?.image ? [{ slot: i, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null }] : [],
    ),
    charm: inst?.charm?.image
      ? { image: inst.charm.image, x: inst.charm.x ?? null, y: inst.charm.y ?? null, z: inst.charm.z ?? null }
      : null,
    // Live kill count — right for every on-screen 3D viewer. The card bake
    // overrides this to a dark display (see generateRenderNow).
    stattrak: inst?.stattrak ? { count: inst.stattrak_count ?? 0 } : null,
  };
}
// The Loadout↔Inventory swap is `mode="out-in"`, so re-entering Focus with 3D
// already on runs this BEFORE the outgoing screen has finished leaving and the
// canvas host exists. One nextTick isn't enough — wait for the element.
async function waitForViewerEl(timeoutMs = 1500): Promise<HTMLElement | null> {
  const deadline = performance.now() + timeoutMs;
  while (!viewer3dEl.value && performance.now() < deadline) {
    await nextTick();
    if (viewer3dEl.value) break;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  return viewer3dEl.value;
}
async function mount3d() {
  const key = focusModelKey.value;
  focus3dBusy.value = true;
  const host = await waitForViewerEl();
  // A newer selection (or leaving 3D entirely) won while we waited.
  if (!key || !host || focusModelKey.value !== key || !focus3d.value) {
    focus3dBusy.value = false;
    return;
  }
  try {
    teardownViewer();
    const ac = new AbortController();
    focusViewerAbort = ac;
    mdebug("focus viewer MOUNT start", { model: key });
    const handle = await mountViewer(host, key, {
      signal: ac.signal,
      paintMaterial: focusPaint.value,
      legacyPaint: focusLegacyPaint.value,
      wear: focusRow.value?.wear ?? focusInstance.value?.wear,
      seed: focusRow.value?.seed ?? focusInstance.value?.seed,
      ...(await stickerGeom(key)),
      ...instPlacements(focusInstance.value),
      // Focus can be showing a loadout DEFAULT rather than an owned item, and
      // a default can be StatTrak too — instPlacements sees no instance there
      // and would drop the module, so fall back to the row.
      stattrak:
        focusInstance.value?.stattrak || focusRow.value?.stattrak
          ? { count: focusInstance.value?.stattrak_count ?? focusRow.value?.stattrak_count ?? 0 }
          : null,
    });
    // The mount takes seconds on a cold cache (GLB fetch + paint composite) and
    // the user may well have moved on during it. Adopting the handle anyway
    // would strand a live context rendering into a detached node forever.
    if (focusModelKey.value !== key || !focus3d.value) {
      handle.dispose();
      mdebug("focus viewer MOUNT discarded (superseded)", { model: key });
      return;
    }
    viewerHandle = handle;
    mdebug("focus viewer MOUNT done", { model: key });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      mdebug("focus viewer MOUNT aborted", { model: key });
      return;
    }
    focus3d.value = false;
    fail(e);
  } finally {
    // Only the mount that still owns the slot clears the spinner — a late
    // superseded build would otherwise unmask a viewer that isn't ready.
    if (focusModelKey.value === key) focus3dBusy.value = false;
  }
}

// ---- 3D overlay for a DEFAULT weapon (ctx menu → View in 3D) ----------------
// Owned items don't come here — they open the craft modal in view mode, which
// can show their spec and hand off to Edit. This overlay is what's left for a
// model with no instance behind it: no wear, no attachments, nothing to inspect
// or edit, so it's a bare stage with a name and a close button.
const loadout3d = ref<{ pos: string; model: string; name: string } | null>(null);
const loadout3dEl = ref<HTMLElement | null>(null);
// Mounting downloads a GLB and composites the paint — seconds on a cold cache,
// during which the canvas is just empty black. Covered by a spinner instead.
const loadout3dBusy = ref(false);
let loadout3dHandle: ViewerHandle | null = null;
// Pure teardown. The route watcher calls this, so it must NOT navigate — see
// dismissLoadout3d for the button the user actually presses.
let loadout3dAbort: AbortController | null = null;
function closeLoadout3d() {
  loadout3dAbort?.abort();
  loadout3dAbort = null;
  loadout3dHandle?.dispose();
  loadout3dHandle = null;
  loadout3d.value = null;
  loadout3dBusy.value = false;
}
/** The ✕ on the 3D overlay: pop back to wherever it was opened from. */
function dismissLoadout3d() {
  mdebug("dismissLoadout3d()", { route: route.value.name });
  if (route.value.name === "item" && route.value.modal === "3d") {
    closeModalRoute();
    return;
  }
  closeLoadout3d();
}
async function openViewer3d(model: string, name: string, paint: string | null, legacyPaint = false) {
  loadout3d.value = { pos: "", model, name };
  loadout3dBusy.value = true;
  await nextTick();
  if (!loadout3dEl.value) {
    loadout3dBusy.value = false;
    return;
  }
  const ac = new AbortController();
  loadout3dAbort = ac;
  mdebug("loadout3d viewer MOUNT start", { model });
  try {
    const handle = await mountViewer(loadout3dEl.value, model, {
      signal: ac.signal,
      paintMaterial: paint,
      legacyPaint: legacyPaint,
      ...(await stickerGeom(model)),
    });
    // Overlay dismissed mid-load — closeLoadout3d already nulled the handle it
    // knew about, so adopting this one would leak it past the close.
    if (!loadout3d.value || loadout3d.value.model !== model) {
      handle.dispose();
      mdebug("loadout3d viewer MOUNT discarded (superseded)", { model });
      return;
    }
    loadout3dHandle = handle;
    mdebug("loadout3d viewer MOUNT done", { model });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      mdebug("loadout3d viewer MOUNT aborted", { model });
      return;
    }
    closeLoadout3d();
    fail(e);
  } finally {
    if (loadout3d.value?.model === model) loadout3dBusy.value = false;
  }
}
async function ctxView3d() {
  const pos = ctx.value?.pos;
  closeCtx();
  if (!pos) return;
  const row = rowFor(pos);
  const inst = instanceById(row?.item_instance_id) ?? null;
  // An owned item has an id, so it gets a shareable /items/<id>/3d URL. A
  // DEFAULT weapon has no instance and therefore nothing to address — that one
  // opens the overlay directly and stays unlinkable.
  if (inst) {
    view3dForInstance(inst);
    return;
  }
  const model = occupantModel(pos);
  const name = skinLabel(pos) === "Default" ? occupantWeapon(pos)?.name ?? model : `${occupantWeapon(pos)?.name} | ${skinLabel(pos)}`;
  await openViewer3d(model, name, isSkinned(row) ? row?.item?.paintMaterial ?? null : null, isSkinned(row) && !!row?.item?.legacyPaint);
}
/**
 * UI entry point for 3D on an owned item — navigates; the route watcher mounts.
 * Lands on the same screen as openDetail: /3d only records that the click asked
 * for the viewer, which is what a shared link should reopen on.
 */
function view3dForInstance(inst: InventoryItem) {
  if (route.value.name === "item" && route.value.id === String(inst.id)) return;
  openModalRoute(`/items/${inst.id}/3d`);
}
// An OWNED item no longer needs a bespoke overlay: /items/<id>/3d opens the
// craft modal in view mode (openView), which already carries the model, the
// spec column and the 2D fallback for weapons with no extracted GLB. The
// overlay below survives only for the case with no instance behind it — a
// default weapon straight off the loadout grid, which has nothing to view.
watch(focus3d, (on) => {
  if (on) mount3d();
  else teardownViewer();
});
onBeforeUnmount(() => {
  clearInterval(buildTimer);
  clearTimeout(pulseTimer);
  clearTimeout(pendingDeleteTimer);
  // Don't let unmount abandon a staged delete — fire the API calls now.
  const batch = pendingDelete.value;
  if (batch) {
    pendingDelete.value = null;
    for (const it of batch.items) void deleteInstance(it.id);
  }
  window.removeEventListener("keydown", onGlobalKey);
  teardownViewer();
  teardownModalViewer();
  closeLoadout3d();
});

// Pre-bake everything equipped in the loadout (queued, one at a time; items
// with a stored render are skipped via a cheap HEAD check).
function queueLoadoutRenders() {
  if (!canEdit.value) return;
  for (const i of inventory.value) {
    if (i.equipped.length) void generateRender(i);
  }
}

// ---- init -------------------------------------------------------------------
async function load() {
  loading.value = true;
  error.value = "";
  // At /apps/inventory, ?player=<me> should drop into your real editable
  // inventory rather than a read-only view of yourself. In a profile tab it must
  // NOT: the tab is a showcase, and editing belongs on the full page. Keeping
  // viewer mode on here is what makes every `!viewerId` guard below (the
  // owned/craft/replace picker sheet, drag-to-equip, the slot menus) apply to
  // your own profile too, instead of each one needing its own embed check.
  if (!embedMode.value && viewerId.value === props.user?.steam_id) viewerId.value = null;
  try {
    if (viewerId.value) {
      const [catalog, theirs] = await Promise.all([fetchCatalog(), fetchPlayerLoadout(viewerId.value)]);
      weapons.value = catalog.weapons;
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = theirs;
      inventory.value = [];
    } else if (!signedIn.value) {
      // Signed out. Loadout and inventory both 401, and asking for them anyway
      // is what used to dump anonymous visitors on the retry screen. Catalog is
      // public, so we load that and land them in the craft sandbox with the
      // default (unskinned) loadout as the backdrop.
      const catalog = await fetchCatalog();
      weapons.value = catalog.weapons;
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = [];
      inventory.value = [];
      loadSkins(sheetKey.value);
    } else {
      const [catalog, current, inv] = await Promise.all([fetchCatalog(), fetchLoadout(), fetchInventory()]);
      weapons.value = catalog.weapons;
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = current;
      inventory.value = inv;
      loadSkins(sheetKey.value);
      queueLoadoutRenders();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
// Escape unwinds exactly one layer, topmost first — the order below mirrors
// the z-index stack, so what you see on top is what closes.
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (confirmAsk.value) {
      confirmAsk.value = null;
      e.stopPropagation();
    } else if (ctx.value) {
      closeCtx();
      e.stopPropagation();
    } else if (itemCtx.value) {
      closeItemCtx();
      e.stopPropagation();
    } else if (loadout3d.value) {
      // dismiss*, not close*: these modals are routes now, so escaping has to
      // pop the URL too or the address bar keeps pointing at a closed overlay.
      dismissLoadout3d();
      e.stopPropagation();
    } else if (picker.value) {
      // Nested inside the craft sheet — closes back to it, not out of it.
      picker.value = null;
      e.stopPropagation();
    } else if (craft.value) {
      closeCraft();
      e.stopPropagation();
    } else if (view.value === "focus") {
      go("/");
    }
    return;
  }
  // Bare-key shortcuts. Never while typing, never with a modifier held, and
  // never while an overlay owns the keyboard — those layers keep their keys.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (craft.value || picker.value || loadout3d.value || ctx.value || itemCtx.value) return;
  if (view.value === "admin") return;
  if (e.key === "/") {
    // "/" drops you into the search that's on screen: inventory's own box
    // there, the sheet's box everywhere else.
    e.preventDefault();
    (view.value === "inventory" ? invSearchEl.value : sheetSearchEl.value)?.focus();
  } else if ((e.key === "t" || e.key === "T") && view.value !== "inventory") {
    switchTeam(team.value === "CT" ? "T" : "CT");
  } else if (view.value === "focus" && e.key.startsWith("Arrow")) {
    // Walk the focus rail from the keyboard: ←/→ step, ↑/↓ hop rows (the
    // rail is a 2-wide grid, so a row is 2 tiles).
    e.preventDefault();
    const flat = focusRail.value.flatMap((g) => g.items.map((it) => it.pos));
    const cur = flat.indexOf(selected.value);
    if (cur === -1) return;
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -2 : 2;
    const next = flat[Math.min(flat.length - 1, Math.max(0, cur + delta))];
    if (next) selectPos(next);
  }
}
// "/"-shortcut targets (see onGlobalKey).
const invSearchEl = ref<HTMLInputElement | null>(null);
const sheetSearchEl = ref<HTMLInputElement | null>(null);
// Which build is the plugin server actually serving? Fetched fresh (no-store),
// logged, displayed in the gear dialog, and POLLED — if the server ships a
// newer bundle while this page is open, a banner says so. Staleness becomes
// a fact you can read, never a guess.
const serverBuild = ref("");
const reloadPage = () => window.location.reload();
const staleBuild = ref(false);
let buildTimer: ReturnType<typeof setInterval> | undefined;
async function checkBuild() {
  try {
    const res = await fetch(`${API_ORIGIN}/build-info.json`, { cache: "no-store" });
    const { builtAt } = (await res.json()) as { builtAt?: string };
    if (!builtAt) return;
    if (!serverBuild.value) {
      serverBuild.value = builtAt;
      console.log(`[cs2-inventory] server bundle built at ${builtAt} (loaded ${new Date().toISOString()})`);
    } else if (builtAt !== serverBuild.value) {
      staleBuild.value = true; // server rebuilt since this page loaded
    }
  } catch {
    /* older server image without the stamp */
  }
}
onMounted(() => {
  checkBuild();
  buildTimer = setInterval(checkBuild, 30000);
  window.addEventListener("keydown", onGlobalKey);
  load();
  // Admin app load hits the key endpoint, which makes the backend sync the
  // invsim block into the game type configs (and reports the result) — that
  // report is what lights the gear badge before /admin is ever opened.
  if (props.user?.role === "administrator") {
    fetchServerApiKey()
      .then((res) => onCfgSync(res.cfg))
      .catch(() => { /* backend unavailable — the console will surface it */ });
    // Same idea for the models mount: ask once at load so the badge is right
    // before /admin is opened. Older backends omit `stale` — falsy, no badge.
    fetchExtractStatus()
      .then((s) => (extractWarn.value = extractWarnFrom(s)))
      .catch(() => { /* older backend or no mount — nothing to warn about */ });
  }
  nextTick(syncAllPills);
  setTimeout(syncAllPills, 120);
  window.addEventListener("resize", syncAllPills);
});

// The host may resolve the session after we mount, handing `user` down late. We
// only load once, so without this a slow session hand-off would strand you in
// the signed-out sandbox with no inventory — which now looks like a legitimate
// state rather than the error screen it used to produce.
watch(signedIn, (now, before) => {
  if (now && !before) {
    sheetMode.value = "owned";
    load();
  }
});

// ---- viewer actions ----
// Only one: leaving the profile tab for the full page. Viewer mode itself is
// entered and left from the player page that hosts it.
//
// The href is the fallback, not the mechanism — a full document load of a
// federated remote means re-downloading the host app to render one tab's worth
// of change. Modified clicks and non-primary buttons are left alone so the
// browser's own open-in-new-tab/window still works.
function onEditClick(e: MouseEvent) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (router.goApp("/")) e.preventDefault();
}
//
// The URL is the source of truth for viewer mode, so back/forward between two
// shared loadouts (or out of one) reloads instead of stranding the old player.
watch(playerParam, (id) => {
  if (id === viewerId.value) return;
  viewerId.value = id;
  load();
});
// ---- share links ------------------------------------------------------------
// Two kinds of link, and the difference matters enough that the menu spells it
// out: the LOADOUT link (?player=<steam64>) is public — it reads a published
// loadout and anyone on the site can open it. ITEM links address rows in your
// own inventory, and there's no public per-item endpoint, so they're for your
// own other devices and for bug reports ("this exact P90 renders white"), not
// for handing to a teammate.
const ITEM_LINK_NOTE =
  "Item links open against your own inventory. To show someone else, send the loadout link.";

// href() resolves against the host-provided base — no hardcoded /apps/inventory.
function shareLink(label: string, path: string, extra: Record<string, string> = {}, hint?: string): ShareLink {
  return { key: `${label}:${path}`, label, href: router.href(path, viewQuery(path, extra)), hint };
}

const publicLoadoutLink = computed<ShareLink | null>(() => {
  const steamId = viewerId.value ?? props.user?.steam_id;
  if (!steamId) return null;
  return shareLink(
    viewerId.value ? "This player's loadout" : "My loadout (public)",
    view.value === "focus" ? "/focus" : "/",
    { player: String(steamId) },
    "Anyone on this site can open this",
  );
});

/**
 * A self-contained link to the craft currently in the editor: the DRAFT route
 * with the whole state packed into the query.
 *
 * This is the only portable form we have. `/items/<id>/...` addresses a row in
 * the sender's own inventory — the recipient gets their own item <id> or
 * nothing — and item routes never decode draft params anyway (decodeDraft runs
 * only in restoreDraftRoute), so hanging offsets off one would produce a link
 * that looks right and silently drops the placement. Charm offsets and sticker
 * placement ride along here because encodeDraft already carries them.
 *
 * `d=2` selects the 2D view; its absence means 3D, matching the modal3d watcher.
 */
function craftStateLinks(): ShareLink[] {
  const c = craft.value;
  const d = draftFromCraft();
  if (!c || !d) return [];
  const skinId = c.skin.id;
  const state = encodeDraft(d, DEFAULT_WEAR);
  // Always 3D: omitting `d` is 3D (see the modal3d watcher), which is what the
  // editor opens in anyway. One link, and the recipient lands on the model.
  return [
    shareLink("This craft", `/craft/${skinId}`, state, "Opens in 3D with wear, seed, stickers and charm placement"),
  ];
}

/**
 * Links for one owned item, current view FIRST so the default copy is the one
 * the sender is actually looking at. Someone in the 3D viewer wants to share
 * the 3D view; someone mid-craft wants the craft.
 */
function itemShareLinks(id: number | string): ShareLink[] {
  // craftStateLinks() already leads with the sender's current 2D/3D view.
  const state = craftStateLinks();
  const itemPage = shareLink("Item page", `/items/${id}`, {}, ITEM_LINK_NOTE);
  const here: ItemModal = routeItemModal.value ?? (modal3d.value ? "3d" : "detail");
  // Only the plain item page leads with the item link; any craft/3D view wants
  // the self-contained craft link first.
  const links = here === "detail" ? [itemPage, ...state] : [...state, itemPage];
  // No live craft (item page with the editor closed) — fall back to the plain
  // per-view routes rather than offering nothing.
  return links.length
    ? links
    : [
        shareLink("Item page", `/items/${id}`, {}, ITEM_LINK_NOTE),
        shareLink("3D view", `/items/${id}/3d`, {}, ITEM_LINK_NOTE),
        shareLink("Craft editor", `/items/${id}/craft`, {}, ITEM_LINK_NOTE),
      ];
}
function instanceShareLinks(id: number | string | null | undefined): ShareLink[] {
  const links = id == null ? [] : itemShareLinks(id);
  const pub = publicLoadoutLink.value;
  return pub ? [...links, pub] : links;
}
// The current screen, filters/team/slot and all — the payoff for putting view
// state in the query in the first place.
const viewShareLinks = computed<ShareLink[]>(() => {
  const here = shareLink(
    view.value === "inventory" ? "This inventory view" : view.value === "focus" ? "This focused slot" : "This view",
    router.path.value,
    transientQuery(),
  );
  const pub = publicLoadoutLink.value;
  return pub ? [here, pub] : [here];
});
// The editor's own link: a saved item by id, or an unsaved draft with its whole
// state packed into the query.
const craftShareLinks = computed<ShareLink[]>(() => {
  // Already on the draft route: the address bar IS the self-contained link, so
  // offer it as-is, then the other view of the same craft.
  if (route.value.name === "draft") {
    const here = shareLink(
      modal3d.value ? "3D view" : "Craft editor",
      router.path.value,
      transientQuery(),
      "Carries wear, seed, stickers and charm placement",
    );
    const other = craftStateLinks().find((l) => l.label !== here.label);
    return other ? [here, other] : [here];
  }
  return instanceShareLinks(editingId.value ?? routeItemId.value);
});

// ---- Steam import (read-only public data; no credentials ever) ----
const importBusy = ref(false);
async function runSteamImport() {
  if (importBusy.value) return;
  importBusy.value = true;
  try {
    const { imported, updated, removed, skipped, partial } = await importSteamInventory();
    await refreshAll();
    const parts = [
      imported && `${imported} added`,
      updated && `${updated} updated`,
      removed && `${removed} no longer owned`,
      skipped && `${skipped} skipped`,
    ].filter(Boolean);
    notify(
      parts.length
        ? `Synced with Steam — ${parts.join(" · ")}.${partial ? " Inventory too large to read fully." : ""}`
        : "Synced with Steam — everything was already up to date.",
      "success",
    );
  } catch (e) {
    fail(e);
  } finally {
    importBusy.value = false;
  }
}

// ---- bulk select/delete (inventory view) ----
const selectMode = ref(false);
// The browse toolbar (and its origin tabs) unmounts while selecting, so the
// pill has to re-measure when it comes back.
watch(selectMode, (v) => {
  if (!v) nextTick(() => invOriginPill.sync(invOrigin.value));
});
const selectedIds = ref<Set<number>>(new Set());
function toggleSelected(id: number) {
  const next = new Set(selectedIds.value);
  next.has(id) ? next.delete(id) : next.add(id);
  selectedIds.value = next;
}
function exitSelectMode() {
  selectMode.value = false;
  selectedIds.value = new Set();
}
// "Select all" means all VISIBLE — with a search or origin filter applied,
// selecting hidden items would delete things you can't see.
const allVisibleSelected = computed(
  () => filteredInventory.value.length > 0 && filteredInventory.value.every((i) => selectedIds.value.has(i.id)),
);
function toggleSelectAllVisible() {
  selectedIds.value = allVisibleSelected.value
    ? new Set()
    : new Set(filteredInventory.value.map((i) => i.id));
}
function deleteSelected() {
  const items = inventory.value.filter((i) => selectedIds.value.has(i.id));
  if (!items.length) return;
  confirmAsk.value = {
    title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
    body: "They'll be removed from your inventory. Anything they're equipped on falls back to the default.",
    confirmLabel: `Delete ${items.length}`,
    onConfirm: () => {
      exitSelectMode();
      stageDelete(items);
    },
  };
}

// ---- TEMPORARY overlay tracing (flicker / reopen hunt) ---------------------
// Every dismissable layer in this app, traced uniformly. Remove once the
// double-open is found. Helpers in ./mdebug; enable with ?mdebug=1.
//
// Attached at the bottom of the script because these refs are declared all
// over the file and a watcher can't reference one still in its TDZ.
if (MDEBUG) {
  // Every layer App.vue owns, in z-order. Logged as a SET after each
  // transition: the complaint is "a ton of modals", and what shows that is the
  // stack as a whole, not any single flag. (ShareMenu keeps its own `open`
  // internally and traces itself.)
  const LAYERS: Array<[string, () => unknown]> = [
    ["sheetFilters", () => sheetFiltersOpen.value],
    ["loadout3d", () => loadout3d.value],
    ["craft", () => craft.value],
    ["ctx", () => ctx.value],
    ["itemCtx", () => itemCtx.value],
    ["confirm", () => confirmAsk.value],
    ["picker", () => picker.value],
  ];
  const openSet = () =>
    LAYERS.filter(([, get]) => !!get()).map(([n]) => n).join("+") || "(none)";

  traceLayer("craft", craft, (c) => ({
    skin: c.skin?.id,
    instId: craftInstId.value,
    viewOnly: viewOnly.value,
    editingId: editingId.value,
    duplicating: duplicating.value,
  }));
  traceLayer("picker", picker, (p) => ({ kind: p.kind, slot: p.slot }));
  traceLayer("confirm", confirmAsk, (c) => ({ title: c.title }));
  traceLayer("ctx", ctx, (c) => ({ pos: c.pos }));
  traceLayer("itemCtx", itemCtx, (c) => ({ inst: c.inst?.id }));
  traceLayer("loadout3d", loadout3d, (l) => ({ pos: l.pos, model: l.model }));
  traceLayer("sheetFilters", sheetFiltersOpen);

  // Sub-views that mount/unmount INSIDE the craft modal. Their own teardown
  // cycle is a plausible flicker source independent of the modal itself.
  watch(modal3d, (on) => mdebug(`modal3d ${on ? "ON" : "OFF"}`, { resetting: modal3dResetting }), { flush: "sync" });
  watch(focus3d, (on) => mdebug(`focus3d ${on ? "ON" : "OFF"}`), { flush: "sync" });
  // Mode flips that swap the craft modal's columns in place — these look like
  // a reopen to the eye but never touch `craft`.
  watch(viewOnly, (on) => mdebug(`viewOnly=${on}`, { instId: craftInstId.value }), { flush: "sync" });
  watch(craftInstId, (now, before) => mdebug("craftInstId", { from: before, to: now }), { flush: "sync" });

  // The route underneath it all. A modal opening twice usually means the path
  // or query landed twice, or tore mid-flush — so log them as one unit, with
  // the bookkeeping that close() depends on.
  watch(
    () => [router.path.value, JSON.stringify(router.query.value)] as const,
    ([p, q], prev) =>
      mdebug("route", {
        path: `${prev?.[0] ?? "-"} -> ${p}`,
        query: `${prev?.[1] ?? "-"} -> ${q}`,
        returnStack: [...modalReturn.value],
        backdrop: modalBackdrop.value,
      }),
    { flush: "sync" },
  );

  // The summary line. A reopen-on-close shows up here as a set that loses a
  // layer and regains it within a frame or two; the elapsed time is what makes
  // "that was one user action, not two" obvious.
  let lastAt = performance.now();
  watch(
    openSet,
    (now, before) => {
      const t = performance.now();
      const dt = Math.round(t - lastAt);
      lastAt = t;
      mdebug(`LAYERS  ${before}  ->  ${now}`, { sinceLastMs: dt });
    },
    { flush: "sync" },
  );
}
// ---- end temporary tracing -------------------------------------------------
</script>

<template>
  <!-- data-5stack-plugin anchors the design system's scoping (utilities + base
       rules); data-cs2-inventory scopes this plugin's own CSS in style.css. -->
  <div data-5stack-plugin data-cs2-inventory style="display: contents">
  <div
    class="mx-auto flex w-full max-w-[1560px] flex-col overflow-hidden text-foreground"
    :class="[
      // Embedded we're one tab among several on a page that scrolls itself, so
      // 100dvh would push the rest of the profile off-screen. Take a bounded
      // slice instead and let the host own the page scroll.
      embedMode ? 'h-[70dvh] min-h-[480px]' : 'h-[calc(100dvh-6rem)]',
      !isCompact && !embedMode && 'min-h-[560px]',
    ]"
    :data-team="team"
    :style="{ '--acc': accent }"
  >
    <div
      v-if="staleBuild"
      class="flex flex-none items-center justify-center gap-2 border-b border-[#e0a24a]/40 bg-[#e0a24a]/10 px-4 py-1.5 text-f11 uppercase tracking-cs1 text-[#e0a24a]"
    >
      <RefreshCw class="h-3.5 w-3.5" /> the server has a NEWER build than this page —
      <button class="underline underline-offset-2 hover:text-foreground" @click="reloadPage">reload</button>
    </div>
    <!-- Screen swap: the loadout app and /admin cross-fade the way the panel's
         own PageTransition does (same easing/offset), instead of hard-cutting. -->
    <Transition
      mode="out-in"
      enter-active-class="transition-[opacity,transform] [transition-duration:420ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] motion-reduce:![transition-duration:1ms]"
      leave-active-class="transition-[opacity,transform] [transition-duration:160ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] motion-reduce:![transition-duration:1ms]"
      enter-from-class="opacity-0 translate-y-5 motion-reduce:translate-y-0"
      leave-to-class="opacity-0 -translate-y-5 motion-reduce:translate-y-0"
    >
    <div v-if="view !== 'admin'" key="loadout-app" class="flex min-h-0 flex-1 flex-col">
    <!-- Header -->
    <!-- Compact scrolls horizontally rather than wrapping: the five control
         groups need ~404px and a phone has ~376px, so wrapping costs a whole
         second row (95px measured, ~12% of an 800px viewport) to show one
         stray button. Scrolling keeps every control reachable in 42px. -->
    <header
      data-role="app-header"
      class="flex flex-none items-center border-b border-border"
      :class="isCompact ? 'flex-nowrap gap-1.5 overflow-x-auto px-2 py-1.5' : 'flex-wrap gap-3 px-6 py-3'"
    >
      <div v-if="view !== 'inventory'" :ref="(el) => teamPill.setListEl(el)" class="relative inline-flex items-center rounded-lg bg-muted p-1">
        <div
          v-show="teamPill.w.value > 0"
          class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md shadow-sm"
          :style="{
            transform: `translateX(${teamPill.x.value}px)`,
            width: teamPill.w.value + 'px',
            background: gradient,
            transition: teamPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
          }"
        ></div>
        <button
          v-for="t in (['CT', 'T'] as Team[])"
          :key="t"
          :ref="(el) => teamPill.setRef(t, el)"
          class="relative z-[1] flex h-7 items-center rounded-md font-bold uppercase tracking-widest transition-colors"
          :class="[isCompact ? 'px-2.5 text-f13' : 'px-5 text-sm', team === t ? 'text-black' : 'text-muted-foreground hover:text-foreground']"
          @click="switchTeam(t)"
        >
          {{ t }}
        </button>
      </div>
      <button
        v-if="view === 'grid' || view === 'focus'"
        class="flex h-9 items-center gap-1.5 rounded-lg border text-f11 font-semibold uppercase tracking-wider transition-colors"
        :class="[isCompact ? 'px-2' : 'px-3.5', view === 'focus' ? 'border-[color:var(--acc)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground']"
        :style="view === 'focus' ? { background: accentSoft } : {}"
        :title="view === 'focus' ? 'Focused' : 'Focus'"
        @click="go(view === 'focus' ? '/' : '/focus')"
      >
        <!-- Icon-only on compact: the label costs ~54px of a ~376px header,
             and the crosshair plus its active accent already carry the state. -->
        <Crosshair class="h-3.5 w-3.5" />
        <span v-if="!isCompact">{{ view === 'focus' ? 'Focused' : 'Focus' }}</span>
      </button>

      <!-- Utility actions sit LEFT of the tabs and are grouped tight, so the
           header reads as "tools | where you are" instead of three things
           floating at equal distance. All three controls are 36px tall (the
           pill is h-7 + p-1), so they share a baseline. -->
      <div class="ml-auto flex items-center" :class="isCompact ? 'gap-1.5' : 'gap-3'">
        <!-- Embedded on your own profile: the one way out, to the full page
             where the loadout is editable. Stays an <a> with a real href so
             middle-click and "open in new tab" work, but a plain left click
             hands off to the host router — see onEditClick. Matched to the
             Focus button's metrics so the header keeps a single baseline. -->
        <a
          v-if="embedMode && viewingSelf && !loading && !error"
          :href="router.href('/', {})"
          class="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
          title="Edit your loadout in the full inventory page"
          @click="onEditClick"
        >
          <Pencil class="h-3.5 w-3.5" />
          <span v-if="!isCompact">Edit</span>
        </a>
        <!-- Nothing here for someone else's loadout: it is a read-only look at
             their profile, not a starting point for your own. -->

        <div v-if="user && !embedMode" class="flex items-center gap-1.5">
          <!-- Steam sync lives up here with the other account-level tools
               rather than in the inventory toolbar. It acts on the whole
               inventory, not on what the toolbar's filters are showing, and
               down there its label was the widest thing in the row — the one
               control that forced the filters onto a second line. -->
          <Tooltip
            v-if="!viewerId"
            text="Sync from Steam — read-only: mirrors your public Steam inventory. No passwords, keys, or trades, ever."
          >
            <button
              class="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground disabled:opacity-60"
              :disabled="importBusy"
              @click="runSteamImport"
            >
              <Loader2 v-if="importBusy" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" :style="{ color: STEAM_BLUE }" />
            </button>
          </Tooltip>
          <ShareMenu icon :links="viewShareLinks" />
          <Tooltip
            v-if="user?.role === 'administrator' && !viewerId"
            :text="gearWarnings.length ? gearWarnings.join(' · ') : 'Game-server configuration'"
          >
            <button
              class="relative grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              @click="go('/admin')"
            >
              <Settings class="h-3.5 w-3.5" />
              <span
                v-if="gearWarnings.length"
                class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                style="background: hsl(var(--tac-amber, 33 94% 58%))"
              ></span>
            </button>
          </Tooltip>
        </div>
        <!-- The divider earns its keep at desktop spacing; at compact gaps it's
             just another 13px between two already-distinct pills. -->
        <span v-if="user && !isCompact && !embedMode" class="h-5 w-px flex-none bg-border"></span>
        <div v-if="!embedMode" :ref="(el) => viewPill.setListEl(el)" class="relative inline-flex items-center rounded-lg bg-muted p-1">
          <div
            v-show="viewPill.w.value > 0"
            class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
            :style="{
              transform: `translateX(${viewPill.x.value}px)`,
              width: viewPill.w.value + 'px',
              border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
              background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
              boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
              transition: viewPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
            }"
          ></div>
          <button
            :ref="(el) => viewPill.setRef('grid', el)"
            class="relative z-[1] flex h-7 items-center gap-1.5 rounded-md px-3 text-f11 uppercase tracking-wider transition-colors"
            :class="view === 'grid' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="go('/')"
          >
            <!-- Compact labels only the ACTIVE tab. Two tabs with distinct
                 icons plus the sliding indicator make the inactive one legible
                 without its word, and the pair costs ~70px of a ~376px row. -->
            <LayoutGrid class="h-3.5 w-3.5" />
            <span v-if="!isCompact || view === 'grid'">Loadout</span>
          </button>
          <button
            v-if="canEdit"
            :ref="(el) => viewPill.setRef('inventory', el)"
            class="relative z-[1] flex h-7 items-center gap-1.5 rounded-md px-3 text-f11 uppercase tracking-wider transition-colors"
            :class="view === 'inventory' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="go('/items')"
          >
            <Package class="h-3.5 w-3.5" />
            <span v-if="!isCompact || view === 'inventory'">Inventory</span>
            <span v-if="inventory.length" class="font-mono text-f10 text-muted-foreground">{{ inventory.length }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- No viewer banner. Someone else's loadout is only ever reached from
         their player page, which already says whose it is and owns the way
         back out — a full-width bar here would only repeat the page. -->

    <!-- Loading: a ghost of the loadout screen, breathing. Same skeleton for
         both views — the shape says "your loadout is coming" either way, and
         the real content's entrance cascade lands on top of it. -->
    <div v-if="loading" aria-busy="true" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4 pt-3">
        <div class="flex w-full min-w-[200px] max-w-[340px] flex-1 flex-col gap-2.5 py-0">
          <div class="animate-skeleton h-3 w-24 rounded bg-secondary/40" :style="{ '--i': 0 }"></div>
          <div v-for="r in 2" :key="'rail' + r" class="animate-skeleton min-h-[104px] flex-1 rounded-lg bg-secondary/40" :style="{ '--i': r }"></div>
          <div class="animate-skeleton min-h-[200px] flex-[1.6] rounded-lg bg-secondary/40" :style="{ '--i': 3 }"></div>
          <div class="grid flex-none grid-cols-2 gap-2">
            <div v-for="r in 4" :key="'x' + r" class="animate-skeleton h-[70px] rounded-lg bg-secondary/40" :style="{ '--i': 3 + r }"></div>
          </div>
        </div>
        <div v-for="c in 3" :key="'col' + c" class="flex min-w-[212px] max-w-[460px] flex-1 flex-col gap-2 pt-8">
          <div v-for="r in 5" :key="'cell' + r" class="animate-skeleton min-h-[116px] flex-1 rounded-lg bg-secondary/40" :style="{ '--i': r * 3 + c }"></div>
        </div>
      </div>
      <div class="flex h-[34vh] min-h-[210px] flex-none gap-2.5 overflow-hidden border-t border-border px-6 pb-6 pt-14">
        <div v-for="r in 9" :key="'sh' + r" class="animate-skeleton w-[164px] flex-none rounded-lg bg-secondary/40" :style="{ '--i': r }"></div>
      </div>
    </div>
    <div v-else-if="error" class="flex flex-1 flex-col items-center justify-center gap-4">
      <div class="rounded-md border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive">
        {{ error }}
      </div>
      <button
        class="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-f13 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
        @click="load"
      >
        <RefreshCw class="h-3.5 w-3.5" /> Try again
      </button>
    </div>

    <!-- Screen swap: Loadout and Inventory cross-slide so switching tabs reads
         as movement between two places, not a hard cut. -->
    <Transition
      v-else
      mode="out-in"
      enter-active-class="transition duration-200 ease-out"
      :enter-from-class="viewEnterFrom"
      leave-active-class="transition duration-150 ease-in"
      :leave-to-class="viewLeaveTo"
    >
      <!-- ============ INVENTORY VIEW ============ -->
      <div v-if="view === 'inventory'" key="inventory" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <!-- Toolbar. Two states that never coexist: BROWSE (find things) and
             SELECT (act on things). The old bar stacked both, so five
             equally-weighted outlined buttons competed for the same eye. -->
        <div
          v-if="selectMode"
          :class="[INV_TOOLBAR, INV_TOOLBAR_PL]"
          style="background: hsl(var(--tac-amber, 33 94% 58%) / 0.08); border-bottom-color: hsl(var(--tac-amber, 33 94% 58%) / 0.35)"
        >
          <!-- A left rule in the panel's tactical idiom, the same marker the
               admin console uses for an active section. -->
          <span
            class="h-5 w-0.5 flex-none rounded-full bg-[hsl(var(--tac-amber,33_94%_58%))]"
            style="box-shadow: 0 0 8px hsl(var(--tac-amber, 33 94% 58%) / 0.45)"
          ></span>
          <span class="text-f13 font-semibold">
            <span class="font-mono text-[hsl(var(--tac-amber,33_94%_58%))]">{{ selectedIds.size }}</span> selected
            <span class="ml-1 font-normal text-muted-foreground">of {{ filteredInventory.length }}</span>
          </span>
          <!-- Reads as a toggle, so it takes the filled state when it's on. -->
          <button
            class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-f10 uppercase tracking-wider transition-colors hover:border-[hsl(var(--tac-amber,33_94%_58%))] hover:text-foreground"
            :class="allVisibleSelected
              ? 'border-[hsl(var(--tac-amber,33_94%_58%))] text-foreground'
              : 'border-border bg-background/60 text-muted-foreground'"
            :style="allVisibleSelected ? { background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.15)' } : {}"
            @click="toggleSelectAllVisible"
          >
            <Check class="h-3 w-3" /> {{ allVisibleSelected ? 'Clear all' : 'Select all' }}
          </button>
          <div class="ml-auto flex items-center gap-2">
            <button
              v-if="selectedIds.size"
              class="flex items-center gap-1.5 rounded-md border border-[#e04a3a]/60 bg-[#e04a3a]/10 px-3.5 py-1.5 text-f10 font-semibold uppercase tracking-wider text-[#ff7a6a] transition-colors hover:bg-[#e04a3a]/20"
              @click="deleteSelected"
            >
              <Trash2 class="h-3 w-3" /> Delete {{ selectedIds.size }}
            </button>
            <button
              class="rounded-md border border-border bg-background/60 px-3.5 py-1.5 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[hsl(var(--tac-amber,33_94%_58%))] hover:text-foreground"
              @click="exitSelectMode"
            >
              Done
            </button>
          </div>
        </div>
        <div v-else :class="[INV_TOOLBAR, INV_TOOLBAR_PL, 'border-border']">
          <!-- The row's only elastic item: everything else is a fixed-width
               pill or dropdown, so the search field gives up width first. -->
          <div class="relative w-[240px] min-w-[110px] shrink">
            <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref="invSearchEl"
              v-model="invSearch"
              placeholder="Search inventory…"
              class="h-8 w-full rounded-md border border-border bg-background pl-9 pr-8 text-f13 outline-none focus:border-[color:var(--acc)]"
            />
            <button
              v-if="invSearch"
              class="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
              title="Clear search"
              @click="invSearch = ''; invSearchEl?.focus()"
            ><X class="h-3.5 w-3.5" /></button>
          </div>
          <!-- Origin filter: same sliding-pill animated tabs as the
               Loadout/Inventory switcher, so filters read as filters, not actions. -->
          <div :ref="(el) => invOriginPill.setListEl(el)" class="relative inline-flex shrink-0 items-center rounded-lg bg-muted p-1">
            <div
              v-show="invOriginPill.w.value > 0"
              class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
              :style="{
                transform: `translateX(${invOriginPill.x.value}px)`,
                width: invOriginPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: invOriginPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
              }"
            ></div>
            <button
              v-for="f in ORIGIN_FILTERS"
              :key="f[0]"
              :ref="(el) => invOriginPill.setRef(f[0], el)"
              class="relative z-[1] flex h-6 items-center gap-1 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
              :class="invOrigin === f[0] ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="invOrigin = f[0]"
            >
              <RefreshCw v-if="f[0] === 'steam'" class="h-3 w-3" :style="{ color: STEAM_BLUE }" />{{ f[1] }}
            </button>
          </div>
          <FilterDropdown
            v-if="invRarityFacets.length"
            v-model="invRarity"
            dots
            class="shrink-0"
            :options="[{ value: '', label: 'All rarities' }, ...invRarityFacets.map((r) => ({ value: r.hex, label: r.name, color: r.hex }))]"
          />
          <FilterDropdown
            v-model="invSort"
            prefix="Sort"
            class="shrink-0"
            :options="SORTS.map((s) => ({ value: s[0], label: s[0] === 'default' ? 'Newest' : s[1] }))"
          />
          <button
            v-if="filtersActive"
            class="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            title="Clear all filters"
            @click="clearInvFilters"
          >
            <X class="h-3 w-3" /> Clear
          </button>
          <span v-if="inventory.length" class="shrink-0 font-mono text-f10 text-muted-foreground/60">
            {{ filteredInventory.length }}<template v-if="filteredInventory.length !== inventory.length">/{{ inventory.length }}</template>
          </span>

          <div class="ml-auto flex shrink-0 items-center gap-2">
            <!-- Card size is the first thing to go when the row gets tight:
                 it tunes the view, it doesn't filter it, and the grid is
                 legible at any of its steps. -->
            <div class="hidden items-center gap-2 text-muted-foreground xl:flex" title="Card size">
              <LayoutGrid class="h-3.5 w-3.5" />
              <input v-model.number="cardSize" type="range" min="132" max="280" step="4" class="w-24 accent-[#e0a24a]" />
            </div>
            <span class="hidden h-5 w-px flex-none bg-border xl:block"></span>
            <button
              v-if="inventory.length"
              class="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Select multiple items"
              @click="selectMode = true"
            >
              <CheckSquare class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Filter rail: the same visual language as the focus view's slot rail,
             because it answers the same question — "which of my things?" — and
             answering it by reading tiles beats picking from a dropdown that
             hides the taxonomy. Toggles are additive; counts come from railBase
             so they describe what a click would actually give you. Hidden until
             there's more than one thing to choose between. -->
        <nav
          v-if="inventory.length && (invRail.weapons.length + invRail.gear.length) > 1"
          class="hidden w-[168px] flex-none flex-col gap-3 overflow-y-auto border-r border-border px-2.5 py-3 lg:flex"
        >
          <!-- Fixed-height header slot. The Clear button used to mount and
               unmount, which shoved the entire rail down a row the instant you
               picked your first filter — the jump landed on the tiles you were
               aiming at. It now always occupies the slot and only changes what
               it says. -->
          <div class="flex h-6 flex-none items-center">
            <button
              v-if="invModels.length || invTypes.length"
              class="flex h-full w-full items-center justify-center gap-1 rounded-md border border-border text-f9 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              @click="invModels = []; invTypes = []"
            >
              <X class="h-3 w-3" /> Clear {{ invModels.length + invTypes.length }}
            </button>
            <span v-else class="px-0.5 text-f8 uppercase tracking-cs3 text-muted-foreground/40">Filters</span>
          </div>

          <section v-for="grp in invRail.weapons" :key="grp.key" class="flex flex-none flex-col gap-1.5">
            <!-- The header is itself a toggle: "all rifles" is one click. -->
            <button
              class="flex items-center justify-between px-0.5 text-f8 uppercase tracking-cs3 transition-colors"
              :class="invTypes.includes(grp.key) ? 'text-[color:var(--acc)]' : 'text-muted-foreground/60 hover:text-foreground'"
              :title="`Show all ${grp.label.toLowerCase()}`"
              @click="toggleType(grp.key)"
            >
              <span>{{ grp.label }}</span>
              <span class="font-mono">{{ grp.count }}</span>
            </button>
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="it in grp.items"
                :key="it.model"
                class="group relative grid aspect-square place-items-center overflow-hidden rounded-md border transition-colors"
                :class="invModels.includes(it.model)
                  ? 'border-[color:var(--acc)] bg-secondary/70'
                  : 'border-border/60 bg-secondary/30 hover:border-muted-foreground/40 hover:bg-secondary/60'"
                :style="selRing(invModels.includes(it.model))"
                :title="`${it.name} · ${it.count}`"
                @click="toggleModel(it.model)"
              >
                <img
                  v-if="it.image"
                  :src="it.image"
                  alt=""
                  :class="cn(
                    'relative z-[2] max-h-full max-w-full object-contain p-1 transition-opacity',
                    !invModels.includes(it.model) && 'opacity-60 group-hover:opacity-90',
                  )"
                />
                <span v-else class="relative z-[2] px-0.5 text-center text-f8 uppercase leading-tight text-muted-foreground/60">
                  {{ it.name }}
                </span>
                <span class="absolute bottom-0.5 right-1 z-[3] font-mono text-f8 text-muted-foreground">{{ it.count }}</span>
              </button>
            </div>
          </section>

          <section v-if="invRail.gear.length" class="flex flex-none flex-col gap-1.5">
            <div class="px-0.5 text-f8 uppercase tracking-cs3 text-muted-foreground/60">Other</div>
            <button
              v-for="row in invRail.gear"
              :key="row.key"
              class="flex items-center justify-between rounded-md border px-2 py-1.5 text-f9 uppercase tracking-wider transition-colors"
              :class="invTypes.includes(row.key)
                ? 'border-[color:var(--acc)] bg-secondary/70 text-foreground'
                : 'border-border/60 bg-secondary/30 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'"
              @click="toggleType(row.key)"
            >
              <span>{{ row.label }}</span>
              <span class="font-mono text-muted-foreground">{{ row.count }}</span>
            </button>
          </section>
        </nav>

        <!-- TransitionGroup: filter/search changes slide the surviving cards
             into their new spots instead of reflowing in one frame. Leaving
             cards go instantly (no leave classes) so the grid never jams. -->
        <TransitionGroup
          tag="div"
          class="min-w-0 flex-1 auto-rows-min content-start gap-3 overflow-y-auto p-6"
          :style="invGridStyle"
          move-class="inv-move"
          enter-active-class="animate-fade-in"
        >
          <div v-if="!inventory.length" key="empty" class="col-span-full grid place-items-center gap-2 py-20 text-center text-muted-foreground">
            <Package class="h-8 w-8 opacity-40" />
            <div>Your inventory is empty.</div>
            <div class="text-f13">Open the <b class="text-foreground">Loadout</b>, pick a weapon, and craft a finish.</div>
          </div>
          <div
            v-else-if="!filteredInventory.length"
            key="no-match"
            class="col-span-full grid place-items-center gap-2 py-20 text-center text-muted-foreground"
          >
            <Search class="h-8 w-8 opacity-40" />
            <div>Nothing matches those filters.</div>
            <button
              v-if="filtersActive"
              class="rounded-md border border-border px-3 py-1.5 text-f10 uppercase tracking-wider transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              @click="clearInvFilters"
            >
              Clear filters
            </button>
          </div>
          <!-- A click OPENS the item (see it big, then decide). Equipping moved
               into the detail modal so a stray click can't re-equip a slot. -->
          <ItemTile
            v-for="i in filteredInventory"
            :key="i.id"
            :inst="i"
            show-header
            :selected="selectMode && selectedIds.has(i.id)"
            :hide-actions="selectMode"
            :title="selectMode ? 'Toggle selection' : itemName(i.item) || 'View item'"
            @click="selectMode ? toggleSelected(i.id) : openDetail(i)"
            @contextmenu.prevent="openItemCtx(i, $event)"
            @longpress="openItemCtxFor(i)"
            @view3d="view3dForInstance(i)"
            @inspect="openInspectLink(i.id)"
            @edit="openEdit(i)"
            @duplicate="openEdit(i)"
            @remove="deleteOwned(i)"
          />
        </TransitionGroup>
        </div>
      </div>

      <!-- ============ LOADOUT / FOCUS ============ -->
      <div v-else key="loadout" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- Stacks on compact so the focus rail can sit above the stage as a
           strip rather than beside it as a fixed 122px column. -->
      <div class="relative flex min-h-0 flex-1 overflow-hidden" :class="isCompact && 'flex-col'">
        <!-- Slot rail (focus view only): the WHOLE loadout, mini. This is the
             only navigation focus mode needs — no strip under the stage. -->
        <nav
          v-if="view === 'focus'"
          class="flex flex-none gap-3"
          :class="isCompact
            ? 'animate-rail-in-top w-full flex-row overflow-x-auto border-b border-border px-2.5 py-2'
            : 'animate-rail-in w-[122px] flex-col overflow-y-auto border-r border-border px-2.5 py-3'"
          @pointerdown="onSlotPointerDown"
          @pointermove="onSlotPointerMove"
          @pointerup="cancelLongPress"
          @pointercancel="cancelLongPress"
          @click.capture="onSlotClickCapture"
        >
          <section v-for="grp in focusRail" :key="grp.key" class="flex flex-none flex-col gap-1.5">
            <div class="px-0.5 text-f8 uppercase tracking-cs3 text-muted-foreground/60">{{ grp.label }}</div>
            <!-- Compact turns each group into a single scrolling row so the
                 whole loadout stays reachable without a 122px column eating a
                 third of the width. -->
            <div class="grid gap-1.5" :class="isCompact ? 'grid-flow-col grid-rows-1' : 'grid-cols-2'">
              <button
                v-for="it in grp.items"
                :key="it.pos"
                :data-slot="it.pos" data-role="fnav"
                class="group relative grid aspect-square place-items-center overflow-hidden rounded-md border transition-colors"
                :class="[
                  isCompact && 'h-[52px] w-[52px]',
                  selected === it.pos
                    ? 'border-[color:var(--acc)] bg-secondary/70'
                    : 'border-border/60 bg-secondary/30 hover:border-muted-foreground/40 hover:bg-secondary/60',
                  pulsePos === it.pos && 'animate-equip-pulse',
                ]"
                :style="[selRing(selected === it.pos), it.rarity ? { borderBottom: `2px solid ${it.rarity}` } : {}, dropStyle(it.pos)]"
                :title="it.name"
                @click="selectPos(it.pos)"
                @contextmenu.prevent="openCtx(it.pos, $event)"
                @dragover="onSlotDragOver(it.pos, $event)"
                @dragleave="dragOverPos === it.pos && (dragOverPos = null)"
                @drop.prevent="onSlotDrop(it.pos)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(it.rarity, 0.5)"></span>
                <img
                  v-if="it.image"
                  :src="it.image"
                  alt=""
                  :class="cn(
                    'relative z-[2] max-h-full max-w-full object-contain p-1 transition-opacity',
                    !it.rarity && 'opacity-50 group-hover:opacity-80',
                  )"
                />
                <span v-else class="relative z-[2] px-0.5 text-center text-f8 uppercase leading-tight text-muted-foreground/60">
                  {{ it.name }}
                </span>
              </button>
            </div>
          </section>
        </nav>

        <!-- ============ LOADOUT GRID · COMPACT ============ -->
        <!-- One category at a time behind a sticky rail. This is a separate
             tree rather than a restyle of the desktop grid on purpose: the two
             have different DOM (and the focus view mounts a WebGL viewer), so
             rendering both and hiding one would double the slot count and, in
             focus mode, cost a second GL context. -->
        <div
          v-if="view === 'grid' && isCompact"
          class="animate-grid-in flex min-h-0 flex-1 flex-col"
          @pointerdown="onSlotPointerDown"
          @pointermove="onSlotPointerMove"
          @pointerup="cancelLongPress"
          @pointercancel="cancelLongPress"
          @click.capture="onSlotClickCapture"
        >
          <nav class="flex flex-none gap-1 overflow-x-auto border-b border-border px-2 py-1" data-role="compact-rail">
            <button
              v-for="c in compactCats"
              :key="c.key"
              class="flex min-h-[34px] flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-f10 font-semibold uppercase tracking-cs1 transition-colors"
              :class="compactCat === c.key
                ? 'border-[color:var(--acc)] text-foreground'
                : 'border-border/60 text-muted-foreground'"
              :style="compactCat === c.key ? { background: accentSoft } : {}"
              @click="compactCat = c.key"
            >
              {{ c.short }}
              <span class="font-mono text-f9 text-muted-foreground/70">{{ c.skinned }}/{{ c.total }}</span>
            </button>
          </nav>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
            <!-- Equipment: agent spans both columns as the identity piece. -->
            <div v-if="compactCat === 'equipment'" class="grid grid-cols-2 gap-2">
              <button
                v-for="(s, si) in compactEquipment"
                :key="s.slot"
                :data-slot="s.slot" data-role="rail"
                class="group relative flex flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors"
                :class="[
                  s.slot === 'agent' ? 'col-span-2 min-h-[132px]' : 'min-h-[96px]',
                  selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === s.slot && 'animate-equip-pulse',
                ]"
                :style="[selRing(selected === s.slot), rowFor(s.slot)?.item?.rarity ? { borderLeft: `3px solid ${rowFor(s.slot)!.item!.rarity}` } : {}]"
                @click="selectPos(s.slot)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(rowFor(s.slot)?.item?.rarity, 0.35)"></span>
                <SlotStatus :teams="cellTeams(s.slot)" :inst="cellInstance(s.slot)" />
                <TileActions
                  v-if="cellInstance(s.slot)"
                  :inst="cellInstance(s.slot)!"
                  @view3d="view3dForInstance(cellInstance(s.slot)!)"
                  @inspect="openInspectLink(cellInstance(s.slot)!.id)"
                  @edit="openEdit(cellInstance(s.slot)!)"
                  @duplicate="openEdit(cellInstance(s.slot)!)"
                  @remove="deleteOwned(cellInstance(s.slot)!)"
                />
                <div class="relative z-[2] text-f9 uppercase tracking-cs1 text-muted-foreground/70">
                  {{ s.slot === 'agent' ? `Agent · ${team}` : s.name }}
                </div>
                <div :key="team" :class="['animate-cell-in py-1', CARD_ART]" :style="{ '--i': si }">
                  <ItemArt
                    v-if="specialImage(s.slot)"
                    :inst="cellInstance(s.slot)"
                    :image="specialImage(s.slot)"
                    :class="cn('max-h-full max-w-full object-contain', !rowFor(s.slot) && 'opacity-60')"
                  />
                  <span v-else class="text-f10 uppercase text-muted-foreground/50">Default</span>
                </div>
                <div class="relative z-[2] flex items-end justify-between gap-2">
                  <ItemName
                    :item="rowFor(s.slot)?.item"
                    :fallback="specialFallback(s.slot)"
                    name-class="text-f11 font-medium"
                    class="min-w-0 flex-1"
                  />
                  <WearBar :wear="rowFor(s.slot)?.wear" :seed="rowFor(s.slot)?.seed" mini class="mb-1" />
                </div>
              </button>
            </div>

            <!-- Weapon categories: a flat 2-up of the group's five slots. -->
            <div v-else class="grid grid-cols-2 gap-2">
              <button
                v-for="(cell, ci) in compactCells"
                :key="cell.pos"
                :data-slot="cell.pos" data-role="weapon"
                class="relative flex min-h-[118px] flex-col overflow-hidden rounded-lg border p-2 text-left transition-colors"
                :class="[
                  selected === cell.pos ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === cell.pos && 'animate-equip-pulse',
                ]"
                :style="[
                  selRing(selected === cell.pos),
                  rarityOf(cell.pos) ? { borderLeft: `3px solid ${rarityOf(cell.pos)}` } : {},
                ]"
                @click="selectPos(cell.pos)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(rarityOf(cell.pos), 0.35)"></span>
                <div class="relative z-[2] truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">
                  {{ cell.weapon?.name ?? cell.pos }}
                </div>
                <SlotStatus :teams="cellTeams(cell.pos)" :inst="cellInstance(cell.pos)" />
                <div
                  :key="team + ':' + occupantModel(cell.pos)"
                  :class="['animate-cell-in', CARD_ART]"
                  :style="{ '--i': ci }"
                >
                  <ItemArt
                    :inst="cellInstance(cell.pos)"
                    :image="cellImage(cell.pos)"
                    :class="cn('max-h-full max-w-full object-contain', !isSkinned(cell.row) && 'opacity-60')"
                  />
                  <span
                    v-if="cellInstance(cell.pos) && (renderingIds.has(cellInstance(cell.pos)!.id) || queuedIds.has(cellInstance(cell.pos)!.id))"
                    class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
                  ><Loader2 v-if="renderingIds.has(cellInstance(cell.pos)!.id)" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" /></span>
                </div>
                <div class="relative z-[2] flex items-end justify-between gap-2">
                  <ItemName :item="cellItem(cell.pos)" strip fallback="Default" name-class="text-f11 font-medium" class="min-w-0 flex-1" />
                  <WearBar :wear="cellWear(cell.pos)?.wear" :seed="cellWear(cell.pos)?.seed" mini class="mb-1" />
                </div>
              </button>
            </div>

            <!-- Discoverability for long-press, retired once it's been used —
                 a permanent hint costs a row of scroll on every visit. -->
            <p v-if="!hasLongPressed" class="px-1 pt-2 text-center text-f9 uppercase tracking-cs2 text-muted-foreground/50">
              Tap to select · hold for options
            </p>
          </div>
        </div>

        <!-- ============ LOADOUT GRID ============ -->
        <template v-else-if="view === 'grid'">
          <!-- Identity column: gloves + knife (prominent) and a compact agent -->
          <aside class="animate-grid-in flex w-full min-w-[200px] max-w-[340px] flex-1 flex-col gap-2.5 overflow-y-auto py-3 pl-4 pr-1">
            <div class="px-1 text-f9 uppercase tracking-cs3 text-muted-foreground/70">Equipment</div>
            <button
              v-for="(s, si) in [RAIL[2], RAIL[1]]"
              :key="s.slot"
              class="group relative flex min-h-[96px] flex-1 flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors"
              :class="[
                selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                pulsePos === s.slot && 'animate-equip-pulse',
              ]"
              :style="[selRing(selected === s.slot), rowFor(s.slot)?.item?.rarity ? { borderLeft: `3px solid ${rowFor(s.slot)!.item!.rarity}` } : {}, dropStyle(s.slot)]"
              :data-slot="s.slot" data-role="rail"
              @click="selectPos(s.slot)"
              @contextmenu.prevent="openCtx(s.slot, $event)"
              @dragover="onSlotDragOver(s.slot, $event)"
              @dragleave="dragOverPos === s.slot && (dragOverPos = null)"
              @drop.prevent="onSlotDrop(s.slot)"
            >
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(rowFor(s.slot)?.item?.rarity, 0.35)"></span>
              <SlotStatus :teams="cellTeams(s.slot)" :inst="cellInstance(s.slot)" />
              <!-- Same actions the Inventory grid's tiles carry. Only when the
                   slot actually holds an owned item — a default knife has no
                   instance to edit, inspect or delete. -->
              <TileActions
                v-if="cellInstance(s.slot)"
                :inst="cellInstance(s.slot)!"
                @view3d="view3dForInstance(cellInstance(s.slot)!)"
                @inspect="openInspectLink(cellInstance(s.slot)!.id)"
                @edit="openEdit(cellInstance(s.slot)!)"
                @duplicate="openEdit(cellInstance(s.slot)!)"
                @remove="deleteOwned(cellInstance(s.slot)!)"
              />
              <div class="relative z-[2] text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ s.name }}</div>
              <!-- Keyed on team: switching sides re-runs the entrance so the
                   rail joins the same cascade as the weapon columns. -->
              <div :key="team" :class="['animate-cell-in', CARD_ART]" :style="{ '--i': si }">
                <ItemArt v-if="specialImage(s.slot)" :inst="cellInstance(s.slot)" :image="specialImage(s.slot)" :class="cn('max-h-full max-w-full object-contain', !rowFor(s.slot) && 'opacity-60')" />
                <span v-else class="text-f10 uppercase text-muted-foreground/50">Default</span>
              </div>
              <div class="relative z-[2] flex items-end justify-between gap-2">
                <ItemName
                  :item="rowFor(s.slot)?.item"
                  :fallback="specialFallback(s.slot)"
                  name-class="text-f11 font-medium"
                  class="min-w-0 flex-1"
                />
                <WearBar :wear="rowFor(s.slot)?.wear" :seed="rowFor(s.slot)?.seed" mini class="mb-1" />
              </div>
            </button>
            <button
              class="group relative flex min-h-[132px] flex-[1.6] cursor-pointer flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors"
              :class="[
                selected === 'agent' ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                pulsePos === 'agent' && 'animate-equip-pulse',
              ]"
              :style="[selected === 'agent' ? { boxShadow: '0 0 0 1px var(--acc)' } : {}, dropStyle('agent')]"
              data-slot="agent" data-role="agent"
              @click="selectPos('agent')"
              @contextmenu.prevent="openCtx('agent', $event)"
              @dragover="onSlotDragOver('agent', $event)"
              @dragleave="dragOverPos === 'agent' && (dragOverPos = null)"
              @drop.prevent="onSlotDrop('agent')"
            >
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(rowFor('agent')?.item?.rarity, 0.3)"></span>
              <SlotStatus :teams="cellTeams('agent')" :inst="cellInstance('agent')" />
              <TileActions
                v-if="cellInstance('agent')"
                :inst="cellInstance('agent')!"
                @view3d="view3dForInstance(cellInstance('agent')!)"
                @inspect="openInspectLink(cellInstance('agent')!.id)"
                @edit="openEdit(cellInstance('agent')!)"
                @duplicate="openEdit(cellInstance('agent')!)"
                @remove="deleteOwned(cellInstance('agent')!)"
              />
              <div class="relative z-[2] text-f9 uppercase tracking-cs1 text-muted-foreground/70">Agent · {{ team }}</div>
              <div :key="team" :class="['animate-cell-in py-1', CARD_ART]" :style="{ '--i': 2 }">
                <ItemArt
                  v-if="specialImage('agent')"
                  :inst="cellInstance('agent')"
                  :image="specialImage('agent')"
                  :class="cn('max-h-full max-w-full object-contain', !rowFor('agent') && 'opacity-70')"
                  style="filter: drop-shadow(0 10px 16px rgba(0,0,0,0.5))"
                />
                <span v-else class="text-f10 uppercase text-muted-foreground/50">Default</span>
              </div>
              <div class="relative z-[2] truncate text-f11 font-medium" :class="!rowFor('agent') && 'text-muted-foreground'">
                {{ specialLabel('agent') }}
              </div>
            </button>
            <div class="grid flex-none grid-cols-2 gap-2">
              <button
                v-for="(s, si) in EXTRAS"
                :key="s.slot"
                class="group relative flex h-[70px] flex-col items-center justify-between overflow-hidden rounded-lg border p-1.5 transition-colors"
                :class="[
                  selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                  pulsePos === s.slot && 'animate-equip-pulse',
                ]"
                :style="[selRing(selected === s.slot), dropStyle(s.slot)]"
                :data-slot="s.slot" data-role="rail"
                :title="s.name + (rowFor(s.slot)?.item ? ' · ' + itemName(rowFor(s.slot)!.item) : '')"
                @click="selectPos(s.slot)"
                @contextmenu.prevent="openCtx(s.slot, $event)"
                @dragover="onSlotDragOver(s.slot, $event)"
                @dragleave="dragOverPos === s.slot && (dragOverPos = null)"
                @drop.prevent="onSlotDrop(s.slot)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(rowFor(s.slot)?.item?.rarity, 0.35)"></span>
                <SlotStatus :teams="cellTeams(s.slot)" :inst="cellInstance(s.slot)" compact />
                <TileActions
                  v-if="cellInstance(s.slot)"
                  :inst="cellInstance(s.slot)!"
                  compact
                  @view3d="view3dForInstance(cellInstance(s.slot)!)"
                  @inspect="openInspectLink(cellInstance(s.slot)!.id)"
                  @edit="openEdit(cellInstance(s.slot)!)"
                  @duplicate="openEdit(cellInstance(s.slot)!)"
                  @remove="deleteOwned(cellInstance(s.slot)!)"
                />
                <div :key="team" :class="['animate-cell-in', CARD_ART]" :style="{ '--i': 3 + si }">
                  <ItemArt v-if="specialImage(s.slot)" :inst="cellInstance(s.slot)" :image="specialImage(s.slot)" :class="cn('max-h-full max-w-full object-contain', !rowFor(s.slot) && 'opacity-60')" />
                  <span v-else class="text-f8 uppercase text-muted-foreground/50">—</span>
                </div>
                <div class="relative z-[2] w-full truncate text-center text-f8 uppercase tracking-cs1 text-muted-foreground/70">{{ s.name }}</div>
              </button>
            </div>
          </aside>

          <!-- Positional weapon columns (CS2: 5 slots each) -->
          <div class="animate-grid-in flex flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-3">
            <section
              v-for="(g, gi) in columnsView"
              :key="g.key"
              data-role="column"
              class="flex min-w-[212px] max-w-[460px] flex-1 flex-col"
            >
              <header class="flex items-baseline gap-2 border-b border-border/60 px-1 pb-2">
                <span class="text-f11 font-semibold uppercase tracking-cs2 text-muted-foreground">{{ g.label }}</span>
                <span class="ml-auto font-mono text-f9 text-muted-foreground/60">{{ g.skinned }}/{{ g.positions.length }}</span>
              </header>
              <div class="flex flex-1 flex-col gap-2 overflow-y-auto pt-2">
                <!-- Every pos-derived display below reads through
                     previewPos(): during a reorder hover the two cells render
                     each other's contents — the drop confirms what you see. -->
                <button
                  v-for="(cell, ci) in g.cells"
                  :key="cell.pos"
                  class="group relative flex min-h-[96px] flex-1 flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors"
                  :data-slot="cell.pos" data-role="weapon"
                  :draggable="canEdit"
                  :class="[
                    selected === cell.pos ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                    pulsePos === cell.pos && 'animate-equip-pulse',
                  ]"
                  :style="[
                    selRing(selected === cell.pos),
                    rarityOf(previewPos(cell.pos)) ? { borderLeft: `3px solid ${rarityOf(previewPos(cell.pos))}` } : {},
                    dropStyle(cell.pos),
                    reorderStyle(cell.pos),
                  ]"
                  @click="selectPos(cell.pos)"
                  @contextmenu.prevent="openCtx(cell.pos, $event)"
                  @dragstart="onCellDragStart(cell.pos, $event)"
                  @dragend="onCellDragEnd"
                  @dragover="onCellDragOver(cell.pos, $event)"
                  @dragleave="onCellDragLeave(cell.pos)"
                  @drop.prevent="onCellDrop(cell.pos)"
                >
                  <span class="pointer-events-none absolute inset-0" :style="glowStyle(rarityOf(previewPos(cell.pos)), 0.35)"></span>
                  <div class="relative z-[2] flex items-center justify-between gap-2">
                    <span class="truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ occupantWeapon(previewPos(cell.pos))?.name ?? cell.pos }}</span>
                    <span class="flex flex-none gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span
                        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
                        title="Focus"
                        @click.stop="selectPos(cell.pos); go('/focus')"
                      ><Crosshair class="h-3 w-3" /></span>
                      <template v-if="cellInstance(cell.pos)">
                        <span
                          class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
                          title="View in 3D"
                          @click.stop="view3dForInstance(cellInstance(cell.pos)!)"
                        ><Box class="h-3 w-3" /></span>
                        <span
                          v-if="!isCoarse"
                          class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
                          title="Inspect in game"
                          @click.stop="openInspectLink(cellInstance(cell.pos)!.id)"
                        ><ExternalLink class="h-3 w-3" /></span>
                        <span
                          class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
                          title="Edit item"
                          @click.stop="selectPos(cell.pos); openEdit(cellInstance(cell.pos)!)"
                        ><Pencil class="h-3 w-3" /></span>
                        <span
                          class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-[#ff7a6a]"
                          title="Delete from inventory"
                          @click.stop="deleteOwned(cellInstance(cell.pos)!)"
                        ><Trash2 class="h-3 w-3" /></span>
                      </template>
                    </span>
                  </div>
                  <!-- Fades for the hover actions, which occupy this corner. -->
                  <SlotStatus
                    :teams="cellTeams(previewPos(cell.pos))"
                    :inst="cellInstance(previewPos(cell.pos))"
                    class="!right-2.5 !top-2.5 transition-opacity group-hover:opacity-0"
                  />
                  <!-- Keyed on team + occupant: switching sides (or replacing
                       the weapon) re-runs the entrance, staggered row-by-row
                       across the three columns — a wave, not a teleport.
                       Equipping a different finish keeps the key, so the
                       pulse ring is the only feedback there. -->
                  <div
                    :key="team + ':' + occupantModel(cell.pos)"
                    :class="['animate-cell-in', CARD_ART]"
                    :style="{ '--i': ci * 3 + gi }"
                  >
                    <ItemArt
                      :inst="cellInstance(previewPos(cell.pos))"
                      :image="cellImage(previewPos(cell.pos))"
                      :class="cn('max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105', !isSkinned(rowFor(previewPos(cell.pos))) && 'opacity-60')"
                    />
                    <span
                      v-if="cellInstance(cell.pos) && (renderingIds.has(cellInstance(cell.pos)!.id) || queuedIds.has(cellInstance(cell.pos)!.id))"
                      class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
                    ><Loader2 v-if="renderingIds.has(cellInstance(cell.pos)!.id)" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" /> {{ renderingIds.has(cellInstance(cell.pos)!.id) ? 'baking' : 'queued' }}</span>
                  </div>
                  <div class="relative z-[2] flex items-end justify-between gap-2">
                    <ItemName
                      :item="cellItem(previewPos(cell.pos))"
                      strip
                      fallback="Default"
                      name-class="text-f11 font-medium"
                      class="min-w-0 flex-1"
                    />
                    <WearBar
                      :wear="cellWear(previewPos(cell.pos))?.wear"
                      :seed="cellWear(previewPos(cell.pos))?.seed"
                      mini
                      class="mb-1"
                    />
                  </div>
                </button>
              </div>
            </section>
          </div>
        </template>

        <!-- ============ FOCUS VIEW ============ -->
        <div v-else data-role="focus" class="animate-view-in flex flex-1 flex-col overflow-hidden" :class="isCompact ? 'p-2' : 'p-5'">
          <div
            class="relative grid flex-1 grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-border bg-card"
            :class="isCompact ? 'px-4 py-4' : 'px-8 py-6'"
          >
            <span
              class="pointer-events-none absolute inset-0"
              :style="rarityOf(selected) ? { background: `radial-gradient(56% 66% at 50% 44%, ${rarityOf(selected)}, transparent 62%)`, filter: 'blur(30px)', opacity: 0.5 } : {}"
            ></span>
            <div class="relative z-[2] flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-f9 uppercase tracking-cs4 text-muted-foreground/70">{{ focusSlotLabel }}</div>
                <h2 class="mt-1.5 truncate font-bold leading-none" :class="isCompact ? 'text-2xl' : 'text-4xl'">{{ sheetWeaponName }}</h2>
                <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <span class="truncate font-medium" :class="isCompact ? 'text-f13' : 'text-base'" style="color: var(--acc)">
                    {{ isSkinned(focusRow) ? focusRow!.item!.name : '— default finish —' }}
                    <span v-if="focusRow?.stattrak" class="text-[#f2c14e]">· StatTrak™</span>
                  </span>
                  <!-- Rarity rides with the name it describes, not the stage
                       controls on the far side of the panel. -->
                  <span
                    v-if="rarityOf(selected)"
                    class="inline-flex flex-none items-center gap-1.5 rounded-sm border px-2 py-0.5 text-f10 uppercase tracking-cs2"
                    :style="{ borderColor: rarityOf(selected), color: rarityOf(selected), background: `color-mix(in srgb, ${rarityOf(selected)} 12%, transparent)` }"
                  >
                    <span class="h-1.5 w-1.5 rounded-[1px]" :style="{ background: rarityOf(selected) }"></span>{{ rarityName(rarityOf(selected)) }}
                  </span>
                </div>
              </div>
              <!-- Stage controls live in the header, on the same baseline as the
                   rarity chip. The 3D toggle used to float over the artwork
                   anchored to nothing. -->
              <div class="flex flex-none items-center gap-2.5">
                <!-- Same sliding-pill animated tabs as every other tab group. -->
                <div v-if="focus3dAvailable" :ref="(el) => focus3dPill.setListEl(el)" class="relative flex items-center rounded-lg bg-muted p-1">
                  <div
                    v-show="focus3dPill.w.value > 0"
                    class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
                    :style="{
                      transform: `translateX(${focus3dPill.x.value}px)`,
                      width: focus3dPill.w.value + 'px',
                      border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                      background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                      boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                      transition: focus3dPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
                    }"
                  ></div>
                  <button
                    :ref="(el) => focus3dPill.setRef('2D', el)"
                    class="relative z-[1] flex items-center gap-1.5 rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
                    :class="!focus3d ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                    @click="setFocus3d(false)"
                  >
                    <ImageIcon class="h-3.5 w-3.5" /> 2D
                  </button>
                  <button
                    :ref="(el) => focus3dPill.setRef('3D', el)"
                    class="relative z-[1] flex items-center gap-1.5 rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
                    :class="focus3d ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                    @click="setFocus3d(true)"
                  >
                    <Box class="h-3.5 w-3.5" /> 3D
                  </button>
                </div>
                <!-- Inspect + Share live top right, same corner as every other
                     surface (3D overlay, craft modal, item detail). -->
                <button
                  v-if="isSkinned(focusRow) && canEdit && focusInstance && !isCoarse"
                  class="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
                  title="Launch CS2 and inspect this item in-game"
                  @click="openInspectLink(focusInstance.id)"
                >
                  <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect' }}
                </button>
                <ShareMenu
                  v-if="isSkinned(focusRow) && canEdit"
                  :links="instanceShareLinks(focusInstance?.id)"
                  :note="ITEM_LINK_NOTE"
                />
              </div>
            </div>

            <div class="relative z-[2] grid min-h-0 place-items-center">
              <div v-show="focus3d" ref="viewer3dEl" class="h-full min-h-[240px] w-full"></div>
              <div v-if="focus3d && focus3dBusy" class="absolute inset-0 z-[3] grid place-items-center">
                <div class="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
                  <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
                </div>
              </div>
              <!-- Slot switches swap the art with a quick settle instead of a
                   hard cut. The transition rides a wrapper because the art
                   itself runs animate-float — an animation would override the
                   enter transform on the same element. -->
              <Transition
                mode="out-in"
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="opacity-0 translate-y-3 scale-95"
                leave-active-class="transition duration-100 ease-in"
                leave-to-class="opacity-0 scale-105"
              >
                <div v-if="!focus3d" :key="selected" class="grid h-full w-full min-h-0 place-items-center">
                  <ItemArt
                    :inst="isSpecial(selected) ? null : cellInstance(selected)"
                    :image="isSpecial(selected) ? focusRow?.item?.image : cellImage(selected)"
                    :class="cn('w-[min(64%,520px)] object-contain animate-float motion-reduce:animate-none', !isSkinned(focusRow) && 'opacity-50')"
                    style="filter: drop-shadow(0 22px 30px rgba(0,0,0,0.55))"
                  />
                </div>
              </Transition>
              <!-- Report link sits opposite the drag hint. Not gated on the
                   load finishing — "it never renders" is itself a report. -->
              <a
                v-if="focus3d"
                :href="focusReportHref"
                target="_blank"
                rel="noopener noreferrer"
                :class="['absolute bottom-1 left-1 z-[3]', REPORT_LINK]"
                title="Open a GitHub issue pre-filled with this item's details"
              >
                Report a problem
              </a>
              <span
                v-if="focus3d && !focus3dBusy"
                class="pointer-events-none absolute bottom-1 left-1/2 z-[3] -translate-x-1/2 text-f9 uppercase tracking-cs2 text-muted-foreground/50"
              >
                {{ isCoarse ? 'drag to rotate · pinch to zoom · two fingers to pan' : 'drag to rotate · scroll to zoom · right-drag to pan' }}
              </span>
            </div>

            <div class="relative z-[2] flex flex-wrap items-center gap-6 border-t border-border pt-3.5">
              <div class="flex flex-col gap-1">
                <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">Float</span>
                <span class="font-mono text-f13">{{ focusRow?.wear != null ? focusRow.wear.toFixed(4) : '—' }}</span>
                <!-- Was a hand-rolled track: full-saturation ramp, no tier
                     boundaries, no lit zone. It was the one wear readout in the
                     app that didn't look like the others. WearBar is THE way
                     wear renders — bare drops its numbers, since "Float" above
                     already prints the value. -->
                <WearBar v-if="focusRow?.wear != null" :wear="focusRow.wear" bare class="mt-1.5 w-[180px]" />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">Pattern</span>
                <span class="font-mono text-f13">{{ focusRow?.seed != null ? '#' + focusRow.seed : '—' }}</span>
              </div>
              <div v-if="isSkinned(focusRow) && canEdit" class="ml-auto flex items-center gap-2">
                <!-- Active StatTrak carried a full-strength gold border while
                     Unequip's sat at border-border, and the contrast made the
                     identically-sized pill look bigger than its neighbour. The
                     gold fill + gold label already say "on", so the border only
                     needs to hint at it. -->
                <button
                  :class="[FOCUS_ACTION, focusRow?.stattrak
                    ? 'border-[#e0a92e]/55 bg-[#e0a92e]/10 text-[#f2c14e]'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground']"
                  @click="toggleStatTrak"
                >
                  StatTrak™
                </button>
                <button
                  :class="[FOCUS_ACTION, 'border-border text-muted-foreground hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]']"
                  @click="clearSlot(selected)"
                >
                  Unequip
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ BOTTOM SHEET ============ -->
      <section
        v-if="!viewerId"
        data-role="picker-sheet"
        class="flex flex-none flex-col border-t border-border"
        :class="isCompact ? 'min-h-0' : 'h-[34vh] min-h-[210px]'"
        :style="sheetStyle"
      >
        <!-- Grab handle: the only affordance telling a touch user this panel
             resizes. Pointer-captured so the drag survives leaving the strip. -->
        <div
          v-if="isCompact"
          class="flex flex-none cursor-grab touch-none justify-center py-2"
          @pointerdown="onSheetDragStart"
          @pointermove="onSheetDragMove"
          @pointerup="onSheetDragEnd"
          @pointercancel="onSheetDragEnd"
        >
          <span class="h-1 w-10 rounded-full bg-muted-foreground/40"></span>
        </div>
        <div
          class="flex flex-wrap items-center border-b border-border"
          :class="isCompact ? 'gap-2 px-3 py-2' : 'gap-2.5 px-6 py-2.5'"
        >
          <!-- Sheet-mode tabs: same sliding pill as the view tabs, pinned first
               so nothing in this row ever jumps around. Stays auto-width at
               every size — stretching it full-width on compact left the three
               tabs marooned at the left of a wide empty bar, and desynced the
               sliding indicator that measures against button positions. -->
          <div :ref="(el) => sheetPill.setListEl(el)" class="relative inline-flex flex-none items-center rounded-lg bg-muted p-1">
            <div
              v-show="sheetPill.w.value > 0"
              class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
              :style="{
                transform: `translateX(${sheetPill.x.value}px)`,
                width: sheetPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: sheetPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
              }"
            ></div>
            <button
              v-if="signedIn"
              :ref="(el) => sheetPill.setRef('owned', el)"
              class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetMode === 'owned' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetMode = 'owned'"
            >
              Owned
              <!-- Counts the origin-filtered pool (a persistent setting) but not
                   search/rarity, so the badge doesn't twitch as you type. -->
              <span class="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-border bg-background/70 px-1 font-mono text-f9 leading-none">{{ inventory.filter((i) => i.slot === sheetKey && matchesOrigin(i, sheetOrigin)).length }}</span>
            </button>
            <button
              v-if="isWeaponPos(selected)"
              :ref="(el) => sheetPill.setRef('replace', el)"
              class="relative z-[1] flex h-6 items-center gap-1 rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetMode === 'replace' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetMode = 'replace'"
            >
              <Replace class="h-3 w-3" /> Replace
            </button>
            <button
              :ref="(el) => sheetPill.setRef('craft', el)"
              class="relative z-[1] flex h-6 items-center gap-1 rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetMode === 'craft' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetMode = 'craft'"
            >
              <Hammer class="h-3 w-3 text-[hsl(var(--tac-amber,33_94%_58%))]" /> Craft
            </button>
          </div>
          <!-- Rarity filter: ranks show their colors, ordered least → greatest. -->
          <FilterDropdown
            v-if="sheetMode !== 'replace' && rarityFacets.length && (!isCompact || sheetFiltersOpen)"
            v-model="activeRarity"
            dots
            :options="[{ value: '', label: 'All rarities' }, ...rarityFacets.map((r) => ({ value: r.hex, label: r.name, color: r.hex }))]"
          />
          <!-- Sort — shared by Owned and Craft. "Default" = newest first for
               owned items, catalog order for finishes; Wear only means
               something on owned items. The "Sort" prefix matters: bare
               "Rarity" next to the actual rarity dropdown read as a second,
               broken rarity filter. -->
          <FilterDropdown
            v-if="sheetMode !== 'replace' && (!isCompact || sheetFiltersOpen)"
            v-model="sheetSort"
            prefix="Sort"
            :options="SORTS.map((s) => ({ value: s[0], label: s[1], disabled: s[0] === 'wear' && sheetMode === 'craft' }))"
          />
          <!-- Owned only: same Synced/Crafted filter as the Inventory grid, so
               read-only Steam imports can be kept out of the equip picker. -->
          <div
            v-if="sheetMode === 'owned' && (!isCompact || sheetFiltersOpen)"
            :ref="(el) => sheetOriginPill.setListEl(el)"
            class="relative inline-flex flex-none items-center rounded-lg bg-muted p-1"
          >
            <div
              v-show="sheetOriginPill.w.value > 0"
              class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
              :style="{
                transform: `translateX(${sheetOriginPill.x.value}px)`,
                width: sheetOriginPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: sheetOriginPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
              }"
            ></div>
            <button
              v-for="f in ORIGIN_FILTERS"
              :key="f[0]"
              :ref="(el) => sheetOriginPill.setRef(f[0], el)"
              class="relative z-[1] flex h-6 items-center gap-1 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetOrigin === f[0] ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetOrigin = f[0]"
            >
              <RefreshCw v-if="f[0] === 'steam'" class="h-3 w-3" :style="{ color: STEAM_BLUE }" />{{ f[1] }}
            </button>
          </div>
          <!-- No weapon name here: the cards below all show it, and at ~220px of
               label it was the one element that pushed the search input onto a
               second row whenever a longer name was selected. -->
          <div v-if="!isCompact" class="ml-auto flex flex-none items-center gap-2 text-muted-foreground" title="Card size">
            <LayoutGrid class="h-3.5 w-3.5" />
            <input v-model.number="sheetCardSize" type="range" min="140" max="260" step="4" class="w-24 accent-[#e0a24a]" />
          </div>
          <!-- Search stays pinned to the right and resets on slot/mode switches -->
          <!-- Compact moves search into the filter sheet: sharing the row with
               the tabs left it ~99px wide and pushed the filter chip onto a
               line of its own, spending 40px to show one button. -->
          <div v-if="!isCompact" class="relative w-[220px] flex-none">
            <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref="sheetSearchEl"
              v-model="sheetSearch"
              placeholder="Search…"
              class="h-8 w-full rounded-md border border-border bg-background pl-9 pr-8 text-f13 outline-none focus:border-[color:var(--acc)]"
            />
            <button
              v-if="sheetSearch"
              class="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
              title="Clear search"
              @click="sheetSearch = ''; sheetSearchEl?.focus()"
            ><X class="h-3.5 w-3.5" /></button>
          </div>
          <!-- Compact-only disclosure for rarity/sort/origin. Badged so a
               filter left on somewhere out of sight is still visible. -->
          <!-- Owns search as well as the filters on compact, so it shows in
               every mode — including Replace, which has no facets but is still
               a list you want to search. -->
          <button
            v-if="isCompact"
            class="ml-auto flex h-8 flex-none items-center gap-1.5 rounded-md border px-2.5 text-f10 uppercase tracking-wider transition-colors"
            :class="sheetFilterCount ? 'border-[color:var(--acc)] text-foreground' : 'border-border text-muted-foreground'"
            :style="sheetFilterCount ? { background: accentSoft } : {}"
            @click="sheetFiltersOpen = true"
          >
            <Search v-if="sheetSearch" class="h-3.5 w-3.5" /><SlidersHorizontal v-else class="h-3.5 w-3.5" />
            <span v-if="sheetFilterCount" class="font-mono text-f9">{{ sheetFilterCount }}</span>
          </button>
        </div>

        <!-- ============ COMPACT FILTER SHEET ============
             Search + every facet as flat tappable chips. Deliberately NOT the
             desktop controls reflowed: those are a popover dropdown and a
             native <select>, and opening a popover from inside a bottom sheet
             put the rarity list on top of the item grid it was filtering. -->
        <Transition enter-active-class="animate-sheet-enter" leave-active-class="animate-sheet-leave">
        <div
          v-if="isCompact && sheetFiltersOpen"
          class="fixed inset-0 z-[998] bg-background/60"
          @click="sheetFiltersOpen = false"
        >
          <div
            data-role="filter-sheet"
            class="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl"
            @click.stop
          >
            <div class="sticky top-0 z-[2] bg-card pt-2">
              <div class="flex justify-center pb-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
              <div class="flex items-center gap-2 border-b border-border px-4 pb-2">
                <span class="text-f10 uppercase tracking-cs2 text-muted-foreground">Filter · {{ sheetWeaponName }}</span>
                <button
                  v-if="sheetFilterCount"
                  class="ml-auto rounded-md border border-border px-2 py-1 text-f9 uppercase tracking-cs1 text-muted-foreground"
                  @click="resetSheetFilters"
                >
                  Reset
                </button>
              </div>
            </div>

            <div class="flex flex-col gap-4 px-4 pb-5 pt-3">
              <div class="relative">
                <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  v-model="sheetSearch"
                  placeholder="Search skins…"
                  class="w-full rounded-md border border-border bg-background py-2.5 pl-9 pr-9 text-f13 outline-none focus:border-[color:var(--acc)]"
                />
                <!-- No refocus on clear: popping the keyboard back up inside
                     the filter sheet just to empty the field is hostile. -->
                <button
                  v-if="sheetSearch"
                  class="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
                  title="Clear search"
                  @click="sheetSearch = ''"
                ><X class="h-4 w-4" /></button>
              </div>

              <section v-if="sheetMode !== 'replace' && rarityFacets.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Rarity</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    class="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="!activeRarity ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="!activeRarity ? { background: accentSoft } : {}"
                    @click="activeRarity = ''"
                  >
                    All
                  </button>
                  <button
                    v-for="r in rarityFacets"
                    :key="r.hex"
                    class="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="activeRarity === r.hex ? 'text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="activeRarity === r.hex ? { borderColor: r.hex, background: `color-mix(in srgb, ${r.hex} 16%, transparent)` } : {}"
                    @click="activeRarity = r.hex"
                  >
                    <span class="h-2 w-2 flex-none rounded-full" :style="{ background: r.hex, boxShadow: `0 0 6px ${r.hex}` }"></span>
                    <span :style="{ color: r.hex }">{{ r.name }}</span>
                  </button>
                </div>
              </section>

              <section v-if="sheetMode !== 'replace'" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Sort</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="s in SORTS"
                    :key="s[0]"
                    class="rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors disabled:opacity-40"
                    :class="sheetSort === s[0] ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetSort === s[0] ? { background: accentSoft } : {}"
                    :disabled="s[0] === 'wear' && sheetMode === 'craft'"
                    @click="sheetSort = s[0]"
                  >
                    {{ s[1] }}
                  </button>
                </div>
              </section>

              <section class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Card size</div>
                <div class="flex items-center gap-3 text-muted-foreground">
                  <LayoutGrid class="h-4 w-4 flex-none" />
                  <input v-model.number="sheetCardSize" type="range" min="120" max="168" step="4" class="w-full accent-[#e0a24a]" />
                </div>
              </section>

              <section v-if="sheetMode === 'owned'" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Origin</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="f in ORIGIN_FILTERS"
                    :key="f[0]"
                    class="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="sheetOrigin === f[0] ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetOrigin === f[0] ? { background: accentSoft } : {}"
                    @click="sheetOrigin = f[0]"
                  >
                    <RefreshCw v-if="f[0] === 'steam'" class="h-3 w-3" :style="{ color: STEAM_BLUE }" />{{ f[1] }}
                  </button>
                </div>
              </section>

              <button
                class="mt-1 w-full rounded-md border border-[color:var(--acc)] py-2.5 text-f11 font-semibold uppercase tracking-cs2 text-foreground"
                :style="{ background: accentSoft }"
                @click="sheetFiltersOpen = false"
              >
                Show {{ sheetResultCount }} result{{ sheetResultCount === 1 ? '' : 's' }}
              </button>
            </div>
          </div>
        </div>
        </Transition>

        <Transition
          mode="out-in"
          enter-active-class="transition duration-150"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-100"
          leave-to-class="opacity-0"
        >
        <div
          :key="sheetMode + '|' + sheetKey"
          class="flex-1 auto-rows-min content-start gap-2.5 overflow-y-auto pb-6 pt-3.5"
          :class="isCompact ? 'px-3' : 'px-6'"
          :style="pickerGridStyle"
        >
          <!-- OWNED: your skins for the slot's weapon -->
          <template v-if="sheetMode === 'owned'">
            <button
              data-role="craft-tile"
              class="animate-sheet-in flex h-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]"
              :style="{ '--i': 0 }"
              @click="sheetMode = 'craft'"
            >
              <Plus class="h-6 w-6" />
              <span class="max-w-full truncate px-2 text-f11 font-semibold uppercase tracking-wider">Craft {{ sheetWeaponName }}</span>
            </button>
            <!-- Stock/default item for special slots (agent, knife, gloves,
                 zeus, c4, music kit) — equipping it = reverting the slot. -->
            <button
              v-if="isSpecial(selected) && specialDefault(selected)"
              data-role="skin"
              class="animate-sheet-in relative flex h-full flex-col overflow-hidden rounded-lg border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-muted-foreground/40"
              :class="!isSkinned(rowFor(selected)) ? 'border-[color:var(--acc)]' : 'border-border'"
              :style="{ '--i': 1 }"
              @click="clearSlot(selected)"
            >
              <div :class="CARD_ART">
                <img :src="specialDefault(selected)?.image ?? undefined" alt="" class="max-h-full max-w-full object-contain opacity-80" />
              </div>
              <div class="truncate text-f13 font-medium text-muted-foreground">{{ specialDefault(selected)?.name ?? 'Default' }}</div>
              <div class="text-f9 uppercase tracking-cs1 text-muted-foreground/60">Default · {{ isShared(selected) ? 'CT + T' : team }}</div>
            </button>
            <button
              v-if="isWeaponPos(selected) && occupantWeapon(selected)"
              data-role="skin"
              class="animate-sheet-in relative flex h-full flex-col overflow-hidden rounded-lg border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-muted-foreground/40"
              :class="!isSkinned(rowFor(selected)) ? 'border-[color:var(--acc)]' : 'border-border'"
              :style="{ '--i': 1 }"
              @click="equipDefaultAt(occupantWeapon(selected)!, selected)"
            >
              <div :class="CARD_ART">
                <img :src="occupantWeapon(selected)!.image ?? undefined" alt="" class="max-h-full max-w-full object-contain opacity-70" />
              </div>
              <div class="truncate text-f13 font-medium text-muted-foreground">Default</div>
            </button>
            <!-- draggable: drop it on any eligible loadout slot (grid, rail,
                 focus rail) — clicking still equips into the selected slot.
                 On touch a tap opens the action menu instead: instant-equip
                 plus fingernail-sized hover icons made the tiles a minefield,
                 and the menu's Equip rows are the same one tap anyway. -->
            <ItemTile
              v-for="(i, idx) in ownedForSheet"
              :key="i.id"
              :inst="i"
              class="animate-sheet-in"
              :style="{ '--i': idx + 2 }"
              draggable="true"
              @dragstart="onTileDragStart(i, $event)"
              @dragend="onTileDragEnd"
              strip-weapon-name
              show-header
              :active="String(rowFor(selected)?.item_instance_id) === String(i.id)"
              @click="isCoarse ? openItemCtxFor(i) : equipInstanceAt(i, selected)"
              @contextmenu.prevent="openItemCtx(i, $event)"
            @longpress="openItemCtxFor(i)"
              @view3d="view3dForInstance(i)"
              @inspect="openInspectLink(i.id)"
              @edit="openEdit(i)"
              @duplicate="openEdit(i)"
              @remove="deleteOwned(i)"
            />

          </template>

          <!-- CRAFT: full catalog for the slot's weapon -->
          <template v-else-if="sheetMode === 'craft'">
            <div v-if="sheetLoading" class="col-span-full flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" /> Loading finishes…
            </div>
            <template v-else>
              <button
                v-for="(s, idx) in craftList"
                :key="s.id"
                data-role="skin"
                class="group animate-sheet-in relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
                :style="[{ '--i': idx }, s.rarity ? { borderBottom: `3px solid ${s.rarity}` } : {}]"
                @click="openCraft(s)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(s.rarity, 0.22)"></span>
                <span class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 text-f8 uppercase text-[color:var(--acc)] opacity-0 transition-opacity group-hover:opacity-100">
                  <Hammer class="h-2.5 w-2.5" /> Craft
                </span>
                <div :class="CARD_ART">
                  <img :src="s.image ?? undefined" alt="" loading="lazy" class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105" />
                </div>
                <ItemName :item="s" strip class="relative z-[2]" />
              </button>
              <div v-if="!craftList.length" class="col-span-full py-8 text-center text-sm text-muted-foreground">
                No finishes match your filters.
              </div>
            </template>
          </template>

          <!-- REPLACE: pick which weapon occupies this slot -->
          <template v-else>
            <button
              v-for="(w, idx) in replaceOptions.defaults"
              :key="w.model"
              data-role="skin"
              class="animate-sheet-in relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
              :style="{ '--i': idx }"
              @click="equipDefaultAt(w, selected)"
            >
              <div :class="CARD_ART">
                <img :src="w.image ?? undefined" alt="" loading="lazy" class="max-h-full max-w-full object-contain opacity-80" />
              </div>
              <div class="truncate text-f13 font-medium">{{ w.name }}</div>
              <div class="mt-0.5 text-f8 uppercase tracking-wider text-muted-foreground/60">Default</div>
            </button>
            <button
              v-for="(i, idx) in replaceOptions.owned"
              :key="'own' + i.id"
              data-role="skin"
              class="animate-sheet-in relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
              :style="[{ '--i': replaceOptions.defaults.length + idx }, i.item?.rarity ? { borderBottom: `3px solid ${i.item.rarity}` } : {}]"
              @click="equipInstanceAt(i, selected)"
              @contextmenu.prevent="openItemCtx(i, $event)"
            @longpress="openItemCtxFor(i)"
            >
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(i.item?.rarity, 0.22)"></span>
              <div :class="CARD_ART">
                <img :src="i.item?.image ?? undefined" alt="" loading="lazy" class="max-h-full max-w-full object-contain" />
              </div>
              <div class="relative z-[2] flex items-center gap-1.5">
                <span class="truncate text-f13 font-medium">{{ itemName(i.item) }}</span>
                <span v-if="i.stattrak" class="flex-none font-mono text-f8 text-[#f2c14e]">ST™</span>
              </div>
            </button>
            <div
              v-if="!replaceOptions.defaults.length && !replaceOptions.owned.length"
              class="col-span-full py-8 text-center text-sm text-muted-foreground"
            >
              Every eligible weapon is already in this loadout.
            </div>
          </template>
        </div>
        </Transition>
      </section>
      </div>
    </Transition>
    </div>

    <!-- /admin — real routes, not a dialog: own screen, own data, own polling. -->
    <AdminConsole
      v-else
      key="admin"
      class="min-h-0 flex-1"
      :user="user"
      :section="adminSection"
      :server-build="serverBuild"
      @notify="notify"
      @navigate="(section: string) => go(section ? `/admin/${section}` : '/admin')"
      @cfg-sync="onCfgSync"
      @extract-stale="(warn: 'missing' | 'stale' | null) => (extractWarn = warn)"
      @cache-cleared="onCacheCleared"
      @back="go('/')"
    />
    </Transition>

    <!-- Craft confirm modal (inventory-simulator style) -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
    <!-- z-999, one above the 3D overlay. The editor is opened FROM that overlay,
         so for one frame (or forever, if a navigation is dropped) both are
         mounted — and at equal z the overlay wins on DOM order and swallows the
         editor whole. Ranking them means the editor is always the thing on top. -->
    <!-- Translucent + blurred, like every other overlay. It was opaque back when
         this was only the editor and the page behind it was noise; now that it's
         also how you LOOK at an item, letting the inventory show through is what
         says "this is on top of your stuff", not a new page. -->
    <div v-if="craft" class="fixed inset-0 z-[999] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" @click.self="closeCraft()">
      <div class="relative flex h-[min(92vh,940px)] w-[min(96vw,1320px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl animate-pop-in">
        <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
          <!-- Provenance and where it's equipped belong to the item's IDENTITY,
               not its spec — "this is your Steam one, and it's on T" is part of
               answering "which item am I looking at". So they ride with the name
               rather than sitting in the readout column with wear and pattern. -->
          <span v-if="viewOnly" class="flex min-w-0 items-center gap-2">
            <ItemName :item="craft.skin" class="min-w-0 truncate" name-class="text-f13 font-semibold uppercase tracking-cs1" />
            <!-- Provenance stays an ICON while equip state is dots. It was a dot
                 too for one revision, and Steam blue (#66c0f4) against CT blue
                 (#7ea6ff) is not a distinction anyone can make — "synced" read as
                 a third team dot, or as nothing at all. Different KIND of mark,
                 not a different shade. -->
            <RefreshCw
              v-if="craftInst && isReadOnly(craftInst)"
              class="h-3 w-3 flex-none"
              :style="{ color: STEAM_BLUE }"
              title="Synced from your Steam inventory — read-only"
            />
            <Hammer
              v-else-if="craftInst"
              class="h-3 w-3 flex-none text-muted-foreground"
              title="Crafted here"
            />
            <span
              v-for="e in craftInst?.equipped ?? []"
              :key="e.team + e.slot"
              class="h-2 w-2 flex-none rounded-full"
              :style="{
                background: e.team === 'CT' ? '#7ea6ff' : '#f2c14e',
                boxShadow: `0 0 6px ${e.team === 'CT' ? '#7ea6ff' : '#f2c14e'}`,
              }"
              :title="'Equipped on ' + e.team"
            ></span>
          </span>
          <span v-else class="text-f13 font-semibold uppercase tracking-cs1">{{ duplicating ? "Craft from imported item" : editingId != null ? "Edit item" : "Confirm craft" }}</span>
          <span v-if="duplicating && !viewOnly" class="flex items-center gap-1 rounded border border-[#66c0f4]/50 bg-[#66c0f4]/10 px-2 py-0.5 text-f10 uppercase tracking-cs1 text-[#66c0f4]">
            <RefreshCw class="h-3 w-3" /> synced items are read-only — saving crafts your own copy
          </span>
          <div class="flex flex-none items-center gap-3">
            <!-- Needs auth: the inspect-link endpoints are the one part of the
                 craft editor that isn't client-side, so signed out it would
                 just 401 into a toast. -->
            <button
              v-if="!isCoarse && signedIn"
              class="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              :title="viewOnly ? 'Launch CS2 and inspect this item in-game' : 'Launch CS2 and inspect exactly what\'s in the editor right now — saving not required'"
              @click="viewOnly && craftInstId != null ? openInspectLink(craftInstId) : openCraftInspect()"
            >
              <ExternalLink class="h-3 w-3" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
            </button>
            <ShareMenu :links="craftShareLinks" :note="route.name === 'draft' ? undefined : ITEM_LINK_NOTE" />
            <!-- Destructive, so it keeps its distance from the action row at the
                 bottom and lives up here beside Close, the way it did on the
                 detail modal this screen replaced. -->
            <button
              v-if="viewOnly && craftInst && canEdit"
              class="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]"
              title="Delete from inventory"
              @click="deleteOwned(craftInst, closeCraft)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
            <button
              v-if="!viewOnly"
              class="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              title="Reset all options"
              @click="resetCraft"
            >
              <RotateCcw class="h-3 w-3" /> Reset
            </button>
            <button class="text-muted-foreground transition-colors hover:text-foreground" @click="closeCraft()">✕</button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-wrap gap-5 overflow-y-auto p-5">
          <!-- Preview -->
          <div class="flex min-w-[220px] flex-1 flex-col items-center justify-center gap-2">
            <div class="relative flex min-h-[320px] w-full flex-1 items-center justify-center">
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(craft.skin.rarity, 0.3)"></span>
              <span
                class="pointer-events-none absolute inset-0 z-[1] opacity-[0.045]"
                style="background-image: linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px); background-size: 44px 44px; -webkit-mask-image: radial-gradient(ellipse at center, black 25%, transparent 72%); mask-image: radial-gradient(ellipse at center, black 25%, transparent 72%)"
              ></span>
              <!-- One editor, two views. The form on the right stays put in
                   both, so wear/pattern/name tag/StatTrak are always reachable
                   — the old fullscreen 3D overlay hid all of them. -->
              <div v-show="!modal3d" class="relative z-[2] flex h-full w-full items-center justify-center">
                <img :src="craftPreview ?? craft.skin.image ?? undefined" alt="" class="max-h-full max-w-full object-contain drop-shadow-[0_28px_30px_rgba(0,0,0,0.45)]" @error="craftPreview = null" />
              </div>
              <!-- absolute, not h-full: the canvas is height:100%, so against a
                   flex-sized (indefinite) host it falls back to its drawing-
                   buffer height and grows the column, shoving everything below
                   it off-screen the moment the model finishes loading. Taking
                   the host out of flow makes that impossible — the parent's
                   min-h-[320px] still sets the stage height. -->
              <div v-show="modal3d" ref="modalViewerEl" class="absolute inset-0 z-[2]"></div>
              <div v-if="modal3d && modal3dBusy" class="absolute inset-0 z-[3] grid place-items-center">
                <div class="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
                  <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
                </div>
              </div>
              <span v-if="craftPreviewBusy && !modal3d" class="animate-sheen pointer-events-none absolute inset-0 z-[3]"></span>
              <span
                v-if="craftPreviewBusy && !modal3d"
                class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
              ><Loader2 class="h-3 w-3 animate-spin" /> rendering</span>
              <!-- 2D / 3D toggle: same sliding-pill animated tabs as the rest -->
              <div v-if="modal3dAvailable" :ref="(el) => modal3dPill.setListEl(el)" class="absolute left-0 top-0 z-[3] inline-flex items-center rounded-lg bg-muted p-1">
                <div
                  v-show="modal3dPill.w.value > 0"
                  class="pointer-events-none absolute bottom-1 left-0 top-1 z-0 rounded-md"
                  :style="{
                    transform: `translateX(${modal3dPill.x.value}px)`,
                    width: modal3dPill.w.value + 'px',
                    border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                    background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                    boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                    transition: modal3dPill.animated.value ? 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), width 0.2s ease' : 'none',
                  }"
                ></div>
                <button
                  v-for="m in ([[false, '2D'], [true, '3D']] as [boolean, string][])"
                  :key="m[1]"
                  :ref="(el) => modal3dPill.setRef(m[1], el)"
                  class="relative z-[1] rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
                  :class="modal3d === m[0] ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                  @click="modal3d = m[0]"
                >{{ m[1] }}</button>
              </div>
            </div>
            <!-- Footer row. Report link, name plate and controls legend all
                 sit on ONE baseline instead of each floating at its own height
                 in its own column. The name keeps the centre column so it stays
                 optically centred under the model however wide the sides get. -->
            <div class="mb-3 grid w-full grid-cols-[1fr_auto_1fr] items-end gap-3 pb-1">
              <a
                v-if="modal3d"
                :href="craftReportHref"
                target="_blank"
                rel="noopener noreferrer"
                :class="['col-start-1 justify-self-start', REPORT_LINK]"
                title="Open a GitHub issue pre-filled with this item's details"
              >
                Report a problem
              </a>
              <div class="col-start-2 text-center">
                <div class="mx-auto mb-1.5 h-px w-28" :style="{ background: `linear-gradient(90deg, transparent, ${craft.skin.rarity}, transparent)` }"></div>
                <div class="text-f11 uppercase tracking-cs1 text-muted-foreground">{{ editingId != null || duplicating ? (weaponByModel.get(craftModel ?? '')?.name ?? sheetWeaponName) : sheetWeaponName }}</div>
                <ItemName :item="craft.skin" strip name-class="text-f13 font-semibold" :style="{ color: craft.skin.rarity }" />
              </div>
              <!-- Controls legend. Overlaying the model put it on top of the
                   thing being dragged; on the footer baseline it sits out of the
                   way but still in eyeline. -->
              <div
                v-if="modal3d"
                class="col-start-3 flex flex-col gap-1 justify-self-end rounded-md border border-border/60 bg-background/80 px-2.5 py-2"
              >
                <div v-if="!viewOnly" class="flex items-center gap-2">
                  <kbd class="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-f8 text-muted-foreground">drag</kbd>
                  <span class="text-f9 text-muted-foreground">move sticker or charm</span>
                </div>
                <div class="flex items-center gap-2">
                  <kbd class="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-f8 text-muted-foreground">{{ isCoarse ? '2 fingers' : 'right-drag' }}</kbd>
                  <span class="text-f9 text-muted-foreground">{{ viewOnly ? 'pan · scroll to zoom' : 'pan · zoom in for fine placement' }}</span>
                </div>
                <!-- Touch has no shift key, so this shortcut is unreachable there.
                     Rotation is still available via the sticker's numeric field —
                     only the hint is hidden, not the capability. -->
                <div v-if="craft.stickers.some(Boolean) && !isCoarse && !viewOnly" class="flex items-center gap-2">
                  <kbd class="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-f8 text-muted-foreground">shift</kbd>
                  <span class="text-f9 text-muted-foreground">+ drag to rotate</span>
                </div>
              </div>
            </div>
          </div>
          <!-- Options (edit) / spec (view). Same column, same boxes, same
               order — view mode just states what edit mode lets you change.
               `sheet-settled`: the two modes are separate template branches, so
               a view↔edit flip mounts a fresh set of boxes — without the gate
               they replay the staggered entrance from opacity:0 and the column
               goes blank mid-flip. The cascade belongs to the modal OPENING. -->
          <div
            class="flex w-full max-w-[300px] flex-none flex-col gap-2.5"
            :class="{ 'sheet-settled': craftSettled }"
          >
            <template v-if="!viewOnly">
            <div v-if="attachKind === 'agent'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 0 }">
              <div class="mb-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">Patches</div>
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${stickerSlotCount}, minmax(0, 1fr))` }">
                <button
                  v-for="(pt, idx) in craft.patches"
                  :key="idx"
                  class="group/pt relative grid h-10 place-items-center rounded border transition-colors"
                  :class="pt ? 'border-border bg-background' : 'border-dashed border-border/60 text-muted-foreground/50 hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]'"
                  :title="pt ? pt.name + ' (slot ' + (idx + 1) + ')' : 'Add a patch in slot ' + (idx + 1)"
                  @click="openPicker('patch', idx)"
                >
                  <span class="absolute bottom-0 right-0.5 z-[1] font-mono text-f8 text-muted-foreground/40">{{ idx + 1 }}</span>
                  <img v-if="pt?.image" :src="pt.image" alt="" class="max-h-8 max-w-full object-contain" />
                  <Plus v-else class="h-3.5 w-3.5" />
                  <span
                    v-if="pt"
                    class="absolute -right-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/pt:opacity-100"
                    @click.stop="craft!.patches[idx] = null"
                  ><X class="h-3 w-3" /></span>
                </button>
              </div>
            </div>
            <div v-if="attachKind === 'weapon'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 0 }">
              <div class="mb-1.5 flex items-baseline gap-2">
                <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Stickers</span>
                <button
                  v-if="craft.stickers.some(Boolean)"
                  class="ml-auto flex-none text-f9 uppercase tracking-cs1 text-muted-foreground/70 transition-colors hover:text-foreground"
                  @click="advancedPlacement = !advancedPlacement"
                >{{ advancedPlacement ? 'Hide' : 'Advanced' }}</button>
              </div>
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${stickerSlotCount}, minmax(0, 1fr))` }">
                <button
                  v-for="(st, idx) in craft.stickers.slice(0, stickerSlotCount)"
                  :key="idx"
                  class="group/st relative grid h-10 place-items-center rounded border transition-colors"
                  :class="st ? 'border-border bg-background' : 'border-dashed border-border/60 text-muted-foreground/50 hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]'"
                  :title="st ? st.name + ' (slot ' + (idx + 1) + ')' : 'Add a sticker in slot ' + (idx + 1)"
                  @click="openPicker('sticker', idx)"
                >
                  <span class="absolute bottom-0 right-0.5 z-[1] font-mono text-f8 text-muted-foreground/40">{{ idx + 1 }}</span>
                  <img v-if="st?.image" :src="st.image" alt="" class="max-h-8 max-w-full object-contain" />
                  <Plus v-else class="h-3.5 w-3.5" />
                  <span
                    v-if="st"
                    class="absolute -right-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/st:opacity-100"
                    @click.stop="craft!.stickers[idx] = null"
                  ><X class="h-3 w-3" /></span>
                </button>
              </div>
              <!-- Scratch wear per applied sticker ("sticker slot N wear", 0-1).
                   Unlike the placement numbers below this is always visible —
                   it's a look choice, not an escape hatch, so it sits alongside
                   the weapon's own float rather than behind the toggle. -->
              <div
                v-for="(st, idx) in craft.stickers.slice(0, stickerSlotCount)"
                v-show="st"
                :key="'wear' + idx"
                class="mt-1.5 flex items-center gap-2"
              >
                <span class="w-4 flex-none text-center font-mono text-f8 text-muted-foreground/60">{{ idx + 1 }}</span>
                <img v-if="st?.image" :src="st.image" alt="" class="h-4 w-4 flex-none object-contain" />
                <span class="w-9 flex-none font-mono text-f8 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <input
                  v-if="st"
                  :value="st.w ?? 0"
                  type="range" min="0" max="1" step="0.01"
                  class="wear-range min-w-0 flex-1"
                  :title="st.name + ' scratch wear'"
                  @input="setStickerWear(idx, ($event.target as HTMLInputElement).valueAsNumber)"
                />
                <span class="w-8 flex-none text-right font-mono text-f9 text-muted-foreground">{{ (st?.w ?? 0).toFixed(2) }}</span>
              </div>
              <!-- Placement per applied sticker: offsets + rotation flow straight
                   to the game server (equipped v5 x/y/rotation). Dragging in 3D
                   is the primary way in — these are the escape hatch for exact
                   numbers, so they stay folded away by default. -->
              <div
                v-for="(st, idx) in craft.stickers.slice(0, stickerSlotCount)"
                v-show="st && advancedPlacement"
                :key="'pos' + idx"
                class="mt-1.5 flex items-center gap-1.5"
              >
                <span class="w-4 flex-none text-center font-mono text-f8 text-muted-foreground/60">{{ idx + 1 }}</span>
                <img v-if="st?.image" :src="st.image" alt="" class="h-4 w-4 flex-none object-contain" />
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">X
                  <input v-if="st" v-model.number="st.x" type="number" step="0.05" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">Y
                  <input v-if="st" v-model.number="st.y" type="number" step="0.05" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">ROT
                  <input v-if="st" v-model.number="st.r" type="number" step="0.5" min="0" max="360" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
              </div>
            </div>
            <div v-if="attachKind === 'weapon'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 1 }">
              <div class="mb-1.5 flex items-baseline gap-2">
                <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Charm</span>
                <button
                  v-if="craft.charm"
                  class="ml-auto flex-none text-f9 uppercase tracking-cs1 text-muted-foreground/70 transition-colors hover:text-foreground"
                  @click="advancedPlacement = !advancedPlacement"
                >{{ advancedPlacement ? 'Hide' : 'Advanced' }}</button>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="group/ch relative grid h-10 w-10 flex-none place-items-center rounded border transition-colors"
                  :class="craft.charm ? 'border-border bg-background' : 'border-dashed border-border/60 text-muted-foreground/50 hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]'"
                  :title="craft.charm ? craft.charm.name : 'Add a charm'"
                  @click="openPicker('charm')"
                >
                  <img v-if="craft.charm?.image" :src="craft.charm.image" alt="" class="max-h-8 max-w-full object-contain" />
                  <Plus v-else class="h-3.5 w-3.5" />
                  <span
                    v-if="craft.charm"
                    class="absolute -right-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/ch:opacity-100"
                    @click.stop="craft!.charm = null"
                  ><X class="h-3 w-3" /></span>
                </button>
                <span v-if="craft.charm" class="truncate text-f10 text-muted-foreground">{{ craft.charm.name }}</span>
              </div>
              <div v-if="craft.charm && advancedPlacement" class="mt-1.5 flex items-center gap-1.5">
                <span class="w-4 flex-none"></span>
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">X
                  <input v-model.number="craft.charm.x" type="number" step="0.05" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">Y
                  <input v-model.number="craft.charm.y" type="number" step="0.05" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">Z
                  <input v-model.number="craft.charm.z" type="number" step="0.05" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
              </div>
            </div>
            <label class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 2 }">
              <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Name tag</span>
              <input
                v-model="craft.nametag"
                maxlength="24"
                placeholder="Type a custom name…"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
              />
            </label>
            <div v-if="!['agent', 'musickit', 'graffiti'].includes(selected)" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
              <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>
              <input
                v-model.number="craft.seed"
                type="number" min="1" max="1000"
                class="h-9 w-24 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
              />
              <button class="ml-auto grid h-9 w-9 place-items-center rounded-md border border-input text-f13 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground" title="Random pattern" @click="randomSeed">🎲</button>
            </div>
            <div v-if="!['agent', 'musickit', 'graffiti'].includes(selected)" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
              <div class="flex items-center gap-2">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <input
                  v-model.number="craft.wear"
                  type="number" min="0" max="1" step="0.0001"
                  class="h-9 w-28 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
                />
                <button class="ml-auto grid h-9 w-9 place-items-center rounded-md border border-input text-f13 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground" title="Random wear" @click="randomWear">🎲</button>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="craft.wear" type="range" min="0" max="1" step="0.0001" class="wear-range w-full" />
              </div>
              <div class="mt-1 text-right font-mono text-f9 text-muted-foreground">{{ wearTier(craft.wear) }}</div>
            </div>
            <div
              v-if="!['agent', 'graffiti'].includes(selected)"
              class="animate-sheet-in flex items-center justify-between rounded-md bg-secondary/40 p-2.5"
              :style="{ '--i': 5 }"
            >
              <span class="text-f10 uppercase tracking-cs1" :class="craft.stattrak ? 'text-[#f2c14e]' : 'text-muted-foreground'">StatTrak™</span>
              <button
                role="switch"
                :aria-checked="craft.stattrak"
                class="relative h-5 w-9 flex-none rounded-full transition-colors"
                :class="craft.stattrak ? 'bg-[#e0a92e]' : 'bg-muted'"
                @click="craft.stattrak = !craft.stattrak"
              >
                <span
                  class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                  :class="craft.stattrak && 'translate-x-4'"
                ></span>
              </button>
            </div>
            </template>

            <!-- Read-only spec. Deliberately the same chrome as the form boxes
                 above rather than a prettier bespoke panel: switching to Edit
                 should feel like the numbers became typable, not like the page
                 changed. -->
            <template v-else>
              <div v-if="craftInst && attachmentsOf(craftInst).length" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 0 }">
                <div class="mb-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">Applied</div>
                <div class="flex flex-col gap-1.5">
                  <span
                    v-for="(a, k) in attachmentsOf(craftInst)"
                    :key="k"
                    class="flex items-center gap-2"
                    :title="a.name"
                  >
                    <img :src="a.image ?? undefined" alt="" class="h-7 w-7 flex-none object-contain" />
                    <span class="min-w-0 flex-1 truncate text-f10 text-foreground/85">{{ a.name }}</span>
                  </span>
                </div>
              </div>
              <div v-if="craft.nametag" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 1 }">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Name tag</span>
                <span class="min-w-0 flex-1 truncate text-f13 italic">“{{ craft.nametag }}”</span>
              </div>
              <div v-if="craftInst?.seed != null" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 2 }">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>
                <span class="font-mono text-f13">#{{ craftInst.seed }}</span>
              </div>
              <div v-if="craftInst?.wear != null" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
                <div class="flex items-baseline gap-2">
                  <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                  <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ wearTier(craftInst.wear) }}</span>
                </div>
                <div class="mt-2"><WearBar :wear="craftInst.wear" /></div>
              </div>
              <div v-if="craftInst?.stattrak" class="animate-sheet-in flex items-center justify-between rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
                <span class="text-f10 uppercase tracking-cs1 text-[#f2c14e]">StatTrak™</span>
              </div>
            </template>

          </div>
        </div>
        <!-- Sticker / charm picker -->
        <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
        <!-- fixed + above the 3D overlay (z-1200): the picker is reachable from
             both the form and the 3D editor, and must cover whichever is up. -->
        <div v-if="picker" class="fixed inset-0 z-[1300] flex flex-col bg-card/[0.985] p-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="text-f11 font-semibold uppercase tracking-cs1">Pick a {{ picker.kind }}</span>
            <div class="ml-auto flex flex-none items-center gap-2 text-muted-foreground" title="Card size">
              <LayoutGrid class="h-3.5 w-3.5" />
              <input v-model.number="attachCardSize" type="range" min="72" max="200" step="4" class="w-24 accent-[#e0a24a]" />
            </div>
            <div class="relative w-[240px]">
              <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                v-model="pickerQuery"
                placeholder="Search…"
                class="w-full rounded-md border border-border bg-background py-2 pl-9 pr-8 text-f13 outline-none focus:border-[color:var(--acc)]"
                autofocus
              />
              <button
                v-if="pickerQuery"
                class="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
                title="Clear search"
                @click="pickerQuery = ''"
              ><X class="h-3.5 w-3.5" /></button>
            </div>
            <button class="text-muted-foreground transition-colors hover:text-foreground" @click="picker = null"><X class="h-4 w-4" /></button>
          </div>
          <div
            class="flex-1 content-start gap-2 overflow-y-auto"
            :style="attachGridStyle"
          >
            <div v-if="pickerLoading" class="col-span-full flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" /> Searching…
            </div>
            <button
              v-for="it in pickerResults"
              :key="it.id"
              class="group flex h-full flex-col items-center overflow-hidden rounded-md border border-border bg-background p-1.5 transition-colors hover:border-[color:var(--acc)]"
              :title="it.name"
              @click="pickAttachment(it)"
            >
              <div :class="CARD_ART">
                <img :src="it.image ?? undefined" alt="" loading="lazy" class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-110" />
              </div>
              <span class="w-full truncate text-center text-f8 text-muted-foreground">{{ it.name.replace(/^(Sticker|Charm) \| /, '') }}</span>
            </button>
            <div v-if="!pickerLoading && !pickerResults.length" class="col-span-full py-8 text-center text-f13 text-muted-foreground">
              No results — try a different search.
            </div>
          </div>
        </div>
        </Transition>

        <!-- Same row, same positions in both modes: dismiss on the left, the
             commit on the right. Editing commits a change to the item; viewing
             commits it to your loadout — so Equip inherits Save's slot. -->
        <div class="flex items-center justify-end gap-3 border-t border-border px-5 py-3.5">
          <button class="rounded px-4 py-2 text-f13 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground" @click="closeCraft()">{{ viewOnly ? 'Close' : 'Cancel' }}</button>
          <!-- Edit is secondary here: it changes the item, but equipping it is
               what you came to decide. -->
          <button
            v-if="viewOnly && canEdit && craftInst"
            class="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
            :title="isReadOnly(craftInst) ? 'Synced from Steam and read-only — craft your own copy of it' : 'Edit this item'"
            @click="craftViewEdit"
          >
            <Copy v-if="isReadOnly(craftInst)" class="h-3.5 w-3.5" /><Pencil v-else class="h-3.5 w-3.5" />
            {{ isReadOnly(craftInst) ? 'Craft' : 'Edit' }}
          </button>
          <button
            v-if="viewOnly && canEdit"
            class="flex items-center gap-1.5 rounded-sm px-5 py-2 text-f13 font-bold uppercase tracking-cs1 text-black shadow-sm transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style="background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16)); box-shadow: 0 2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.22)"
            :disabled="!craftEquipTarget"
            :title="craftEquipTarget ? 'Equip on ' + team : 'Not usable by ' + team"
            @click="craftViewEquip"
          >
            <template v-if="craftEquipTarget">Equip · {{ craftEquipTarget.label }}</template>
            <template v-else>Not usable by {{ team }}</template>
          </button>
          <!-- Signed out the editor stays fully live — only the commit is off.
               Disabled-with-a-reason rather than hidden, so it's clear up front
               that the build is a sandbox and there's a way to keep it. -->
          <span v-if="!viewOnly && !signedIn" class="text-f11 text-muted-foreground">Sign in to save</span>
          <!-- Branch a new item off this one. Only while EDITING a saved item:
               a fresh craft is already new, and Save would overwrite. -->
          <button
            v-if="!viewOnly && editingId != null"
            class="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="craftBusy || !signedIn"
            title="Save these changes as a new item, leaving the original untouched"
            @click="duplicateCraft"
          >
            <Copy class="h-3.5 w-3.5" /> Save as copy
          </button>
          <button
            v-if="!viewOnly"
            class="flex items-center gap-1.5 rounded-sm px-5 py-2 text-f13 font-bold uppercase tracking-cs1 text-black shadow-sm transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            style="background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16)); box-shadow: 0 2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.22)"
            :disabled="craftBusy || !signedIn"
            :title="signedIn ? undefined : 'Sign in to save this to your inventory'"
            @click="confirmCraft"
          >
            <Loader2 v-if="craftBusy" class="h-3.5 w-3.5 animate-spin" /> {{ editingId != null ? "Save" : "Craft" }}
          </button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- Transient action error (never breaks the app) -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0 translate-y-2"
    >
    <div
      v-if="notice"
      class="fixed left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-md border bg-card px-4 py-2.5 text-f13 shadow-2xl"
      :class="[
        noticeKind === 'success' ? 'border-[color:var(--acc)]' : 'border-destructive/50',
        pendingDelete ? 'bottom-16' : 'bottom-5',
      ]"
    >
      <span :class="noticeKind === 'success' ? 'text-foreground' : 'text-destructive'">{{ notice }}</span>
      <button class="text-muted-foreground transition-colors hover:text-foreground" @click="notice = ''">✕</button>
    </div>
    </Transition>

    <!-- Staged delete: the item is already out of the list; this is the 6s
         window in which that decision can be taken back. -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0 translate-y-2"
    >
    <div
      v-if="pendingDelete"
      class="fixed bottom-5 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-f13 shadow-2xl"
    >
      <Trash2 class="h-3.5 w-3.5 flex-none text-muted-foreground" />
      <span class="max-w-[380px] truncate">{{ pendingDeleteLabel }}</span>
      <button
        class="flex-none rounded-sm px-2 py-1 text-f11 font-bold uppercase tracking-cs1 text-[color:var(--acc)] transition-colors hover:bg-muted"
        @click="undoDelete"
      >
        Undo
      </button>
      <button class="flex-none text-muted-foreground transition-colors hover:text-foreground" title="Dismiss (delete now)" @click="commitPendingDelete">✕</button>
    </div>
    </Transition>

    <!-- Right-click context menu (weapon slots). Compact swaps the plain
         cross-fade for sheet motion — the backdrop fades while the panel
         travels, which a single opacity transition on the root can't express. -->
    <Transition
      :enter-active-class="isCompact ? 'animate-sheet-enter' : 'transition duration-150'"
      :enter-from-class="isCompact ? '' : 'opacity-0'"
      :leave-active-class="isCompact ? 'animate-sheet-leave' : 'transition duration-100'"
      :leave-to-class="isCompact ? '' : 'opacity-0'"
    >
    <div
      v-if="ctx"
      class="fixed inset-0 z-[999]"
      :class="isCompact && 'bg-background/60'"
      @click="closeCtx"
      @contextmenu.prevent="closeCtx"
    >
      <!-- Compact drops the cursor anchoring for a bottom sheet: the menu is
           opened by long-press (no cursor to anchor to), and the desktop
           clamp assumes a window wide enough for `innerWidth - 220` to be a
           sane left edge, which at 400px it is not. -->
      <div
        data-role="slot-menu"
        :class="isCompact
          ? 'absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl'
          : 'absolute min-w-[204px] origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl'"
        :style="isCompact ? {} : { left: (ctx?.x ?? 0) + 'px', top: (ctx?.y ?? 0) + 'px' }"
        @click.stop
      >
        <div v-if="isCompact" class="flex justify-center pb-1 pt-2">
          <span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span>
        </div>
        <div class="border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          {{ ctx ? (occupantWeapon(ctx.pos)?.name ?? ctx.pos) : '' }}
        </div>
        <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="ctxOwned">
          <Search class="h-3.5 w-3.5" /> Pick / change skin
        </button>
        <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="ctxCraft">
          <Hammer class="h-3.5 w-3.5" /> Craft new skin
        </button>
        <button
          v-if="ctx && isWeaponPos(ctx.pos)"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="ctxReplace"
        >
          <Replace class="h-3.5 w-3.5" /> Replace weapon…
        </button>
        <button
          v-if="ctx3dOk"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="ctxView3d"
        >
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <button
          v-if="ctx && equippedInstance(ctx.pos) && !isCoarse"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="ctxInspect"
        >
          <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
        </button>
        <button
          v-if="ctx && !['agent', 'graffiti', 'musickit'].includes(ctx.pos)"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
          :disabled="!equippedInstance(ctx.pos)"
          @click="ctxStatTrak"
        >
          <Sparkles class="h-3.5 w-3.5" /> Toggle StatTrak™
        </button>
        <button
          v-if="ctx && !isShared(ctx.pos) && ctx.pos !== 'agent'"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
          :disabled="!equippedInstance(ctx.pos)"
          @click="ctxCopy"
        >
          <Copy class="h-3.5 w-3.5" /> Copy to {{ team === 'CT' ? 'T' : 'CT' }} side
        </button>
        <button
          class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-f13 text-muted-foreground transition-colors hover:bg-muted hover:text-[#ff7a6a] disabled:opacity-40 disabled:hover:bg-transparent"
          :disabled="!ctx || !rowFor(ctx.pos)"
          @click="ctxReset"
        >
          <RotateCcw class="h-3.5 w-3.5" /> Reset to default
        </button>
      </div>
    </div>
    </Transition>



    <!-- 3D overlay for a DEFAULT weapon off the loadout grid. An owned item goes
         to /items/<id>/3d instead, which opens the craft modal in view mode —
         so there's no spec strip and no Edit/Inspect/Share here: a default
         weapon is a model, not an item anyone owns. -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
      <div v-if="loadout3d" class="fixed inset-0 z-[998] flex items-center justify-center bg-background p-6" @click="dismissLoadout3d">
        <div class="relative flex h-[min(88vh,900px)] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl animate-pop-in" @click.stop>
          <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span class="truncate text-f11 uppercase tracking-cs3 text-muted-foreground">{{ loadout3d.name }}</span>
            <button class="flex-none rounded p-1 text-muted-foreground transition-colors hover:text-foreground" @click="dismissLoadout3d">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="relative min-h-0 flex-1">
            <div ref="loadout3dEl" class="h-full w-full"></div>
            <a
              :href="loadout3dReportHref"
              target="_blank"
              rel="noopener noreferrer"
              :class="['absolute bottom-2 left-3 z-[3]', REPORT_LINK]"
              title="Open a GitHub issue pre-filled with this model's details"
            >
              Report a problem
            </a>
            <div v-if="loadout3dBusy" class="absolute inset-0 grid place-items-center bg-card">
              <div class="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
                <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Destructive-action confirm. Above every other overlay (modals 998,
         context menus 999, share popovers 1001) because it can be raised from
         any of them and must never open behind the thing that triggered it. -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
      <div
        v-if="confirmAsk"
        class="fixed inset-0 z-[1010] grid place-items-center bg-background/80 p-4"
        @click.self="confirmAsk = null"
      >
        <div class="w-[min(92vw,420px)] animate-pop-in overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
          <div class="flex items-start gap-3 p-5">
            <span class="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-md border border-[#e04a3a]/40 bg-[#e04a3a]/10">
              <Trash2 class="h-4 w-4 text-[#ff7a6a]" />
            </span>
            <div class="min-w-0">
              <div class="text-f13 font-semibold uppercase tracking-cs1">{{ confirmAsk.title }}</div>
              <p class="mt-1.5 text-f13 leading-relaxed text-muted-foreground">{{ confirmAsk.body }}</p>
            </div>
          </div>
          <div class="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button
              class="rounded-md px-4 py-2 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              @click="confirmAsk = null"
            >
              Cancel
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md bg-[#e04a3a] px-4 py-2 text-f11 font-bold uppercase tracking-wider text-white shadow-sm transition-[filter] hover:brightness-110"
              @click="runConfirm"
            >
              <Trash2 class="h-3.5 w-3.5" /> {{ confirmAsk.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Right-click context menu (owned items) -->
    <Transition
      :enter-active-class="isCompact ? 'animate-sheet-enter' : 'transition duration-150'"
      :enter-from-class="isCompact ? '' : 'opacity-0'"
      :leave-active-class="isCompact ? 'animate-sheet-leave' : 'transition duration-100'"
      :leave-to-class="isCompact ? '' : 'opacity-0'"
    >
    <div
      v-if="itemCtx"
      class="fixed inset-0 z-[999]"
      :class="isCompact && 'bg-background/60'"
      @click="closeItemCtx"
      @contextmenu.prevent="closeItemCtx"
    >
      <div
        data-role="slot-menu"
        :class="isCompact
          ? 'absolute inset-x-0 bottom-0 max-h-[80%] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl'
          : 'absolute min-w-[214px] origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl'"
        :style="isCompact ? {} : { left: (itemCtx?.x ?? 0) + 'px', top: (itemCtx?.y ?? 0) + 'px' }"
        @click.stop
      >
        <div v-if="isCompact" class="sticky top-0 flex justify-center bg-card pb-1 pt-2">
          <span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span>
        </div>
        <div class="truncate border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          <ItemName :item="itemCtx?.inst.item" />
        </div>
        <template v-if="itemCtxTeams === 'shared'">
          <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="ctxEquipTeams(['CT', 'T'])">
            <Crosshair class="h-3.5 w-3.5" /> Equip (CT + T)
          </button>
        </template>
        <template v-else-if="itemCtxTeams">
          <button
            v-for="t in itemCtxTeams"
            :key="t"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
            @click="ctxEquipTeams([t])"
          >
            <Crosshair class="h-3.5 w-3.5" /> Equip on {{ t }}
          </button>
          <button
            v-if="itemCtxTeams.length === 2"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
            @click="ctxEquipTeams(['CT', 'T'])"
          >
            <Copy class="h-3.5 w-3.5" /> Equip on both teams
          </button>
        </template>
        <button class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="itemCtxView3d">
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <button
          v-if="itemCtx && !['agent', 'graffiti', 'musickit'].includes(itemCtx.inst.slot ?? '')"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="itemCtxStatTrak"
        >
          <Sparkles class="h-3.5 w-3.5" /> {{ itemCtx.inst.stattrak ? 'Remove' : 'Add' }} StatTrak™
        </button>
        <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="itemCtxEdit">
          <Pencil class="h-3.5 w-3.5" /> Edit…
        </button>
        <button v-if="!isCoarse" class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="itemCtxInspect">
          <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
        </button>
        <button
          class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-f13 text-muted-foreground transition-colors hover:bg-muted hover:text-[#ff7a6a]"
          @click="itemCtxDelete"
        >
          <Trash2 class="h-3.5 w-3.5" /> Delete from inventory
        </button>
      </div>
    </div>
    </Transition>
  </div>
  </div>
</template>
