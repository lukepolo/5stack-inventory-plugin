<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, provide, type ComputedRef } from "vue";
import { cn } from "@5stack/ui";
import en from "./locales/en.json";
import {
  Loader2, Search, LayoutGrid, Crosshair,
  Package, Hammer, Trash2, Copy, RotateCcw, Sparkles, Replace, RefreshCw, Pencil, Plus, X, Download, CheckSquare, Settings, Box, Clock,
  Image as ImageIcon, Check, ExternalLink, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, Palette,
} from "lucide-vue-next";
import {
  fetchCatalog,
  fetchSkins,
  searchAttachments,
  type AttachFacet,
  type AttachSort,
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
  fetchSteamSync,
  API_ORIGIN,
  equip,
  swapLoadout,
  unequip,
  type Team,
  type CatalogWeapon,
  type DefaultsMap,
  type CatalogItem,
  type Skin,
  type SheetFacets,
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
import InfiniteSentinel from "./InfiniteSentinel.vue";
import SortDirection from "./SortDirection.vue";
import ViewerControls from "./ViewerControls.vue";
import { SORT_DIR_ICON, type SortDir, type SortKind } from "./sortIcons";
import { ART_FADE_B, attachmentsOf, canInspect, CARD_ART, CARD_CHROME_PX, glowStyle, hasSeed, hasWear, isCustomizable, isReadOnly, itemName, STEAM_BLUE, stripName, wearTier } from "./itemVisuals";
import { isCompact, isCoarse, reducedMotion } from "./responsive";
import { revealInScroller, scrollPanelToTop } from "./dom";
import { hasModel, hasModelSync, mountViewer, snapshotModel, viewersIdle, viewerStats, INCOMPLETE, type ViewerHandle, type StickerPlacement, type CharmPlacement } from "./viewer3d";
import { resolveViewerModel, resolveViewerModelSync, type ViewerTarget } from "./viewerModel";
import "./style.css";

// `user` plus the host's routing contract (base/path/query/navigate) — see
// pluginRouter.ts. Standalone, none of the routing props are passed and the
// router falls back to the History API.
interface Props extends HostRouting {
  user?: { steam_id: string; name: string; role: string } | null;
  /**
   * The host's toast, handed down the same way `navigate` is.
   *
   * REQUIRED, unlike the routing props. There is deliberately no fallback: a
   * second, hand-rolled toast is a second thing to keep looking and behaving
   * like the panel's, and it only ever rendered when embedded under a host too
   * old to pass this. Standalone dev supplies its own in main.ts.
   *
   * It cannot be imported — a federated remote is a separate module graph, and
   * `useToast` keeps its state in module scope, so an imported copy would push
   * onto a toast list nothing renders.
   */
  notify: (message: string, kind: "error" | "success") => void;
  /**
   * The host's translator, and the locale it is currently resolving against.
   *
   * Same reasoning as `notify`: a federated remote has its own module graph, so
   * it cannot reach the host's vue-i18n instance by importing it. Both optional
   * — standalone and older hosts fall back to the built-in English.
   *
   * `locale` is passed as well as `t` so a language switch actually re-renders:
   * `t` is a stable function reference, so nothing depending only on it would
   * invalidate. Read it (see `tr`) to make a computed reactive to the switch.
   */
  t?: (key: string, named?: Record<string, unknown>) => string;
  locale?: string;
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
// whether a slot resolves to something we have a model for.
//
// Gloves and agents came off this list when their trees joined the extraction
// (v19). zeus came off too — its GLB has shipped all along, it was only ever
// here because this list started life as the "special slot" one. c4 stays:
// nothing extracts it, since it has no MAP entry.
//
// A slot-level answer is necessarily coarse — it is asked before an occupant is
// known. The per-ITEM answer (a painted glove has no compositor yet) lives in
// resolveViewerModel, and the focus/ctx paths below still HEAD-probe on top.
const isNo3d = (s: string) => ["c4", "musickit", "graffiti"].includes(s);
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
// the plugin tracks the host's live branding; CT uses the panel's CT blue, which
// is not a global token — see --tac-ct in style.css for where it comes from and
// why that value. Both halves now read the same way, and neither is a hex picked
// here: CT was #4a8fe0, a colour the panel uses nowhere.
const accent = computed(() =>
  team.value === "T" ? "hsl(var(--tac-amber, 33 94% 58%))" : "hsl(var(--tac-ct, 198 100% 67%))",
);
const gradient = computed(() =>
  team.value === "T"
    ? "linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16))"
    : "linear-gradient(135deg, var(--tac-ct-cta-from, #7ad7ff), var(--tac-ct-cta-to, #35b4e8))",
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
// Chip shapes for the compact inventory filter sheet. 36px tall — these are the
// only way to reach these filters on a phone, so they get a real target.
const INV_CHIP = "flex h-9 items-center rounded-md border px-3 text-f10 uppercase tracking-cs1 transition-colors";
const INV_CHIP_ON = "border-[color:var(--acc)] text-foreground";
const INV_CHIP_OFF = "border-border/60 text-muted-foreground";
// Focus view's action row (Inspect / Share / StatTrak / Unequip): one height,
// one radius, one type size — they drifted into four slightly different pills.
//
// min-w + justify-center because equal height alone didn't read as equal: the
// labels are different lengths, so the pills shrink-wrapped to different widths
// and the pair looked mismatched rather than like one set of controls.
const FOCUS_ACTION =
  "flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-md border px-3.5 text-f11 font-medium uppercase tracking-wider transition-colors";
// Focus view's STAGE controls (Edit / Inspect / Share), which sit in the header
// beside the 2D/3D pill. They were px/py-sized while the pill is a padded tab
// group, so they came out ~6px shorter and read as a different tier of control.
// Everything in that row is pinned to h-8 instead.
const FOCUS_STAGE =
  "flex h-8 items-center gap-1.5 rounded-md border px-3 text-f10 uppercase tracking-wider transition-colors";
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
const skinsCache = new Map<string, { base: Skin | null; skins: Skin[] } & SheetFacets>();
const sheetSkins = ref<Skin[]>([]);
// Labels and ordering the sheet can't work out from the items alone — a tab's
// display name, a colourway's swatch. Empty for every catalog but graffiti,
// which is what keeps the extra controls off every other weapon sheet.
const sheetFacets = ref<SheetFacets>({ groups: [], tints: [] });
const sheetLoading = ref(false);
/** How long a search box waits after the last keystroke before the grid filters.
 *  Shared by the inventory and the sheet. Declared up here because the sheet's
 *  watcher is thousands of lines above the inventory's — a `const` used before its
 *  declaration is a TDZ waiting for someone to make it eager. */
const SEARCH_DEBOUNCE_MS = 220;
const sheetSearch = ref("");
/** The sheet's debounced term — same reasoning as invSearchApplied, and the sheet
 *  animates its tiles too, so a live filter churned just as visibly here. */
const sheetSearchApplied = ref("");
const activeRarity = ref<string>("");
// Graffiti-shaped facets. Nothing here is slot-aware: each control shows only
// when the loaded catalog actually has more than one value behind it.
const sheetGroup = ref<string>("");
const sheetCollection = ref<string>("");
const sheetTint = ref<string>("");
// Drill-in: the `design` of the stack being opened, or null for the grid of
// stacks. Every filter change clears it — you can't be inside a card that the
// filters just removed.
const sheetDesign = ref<number | null>(null);

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
    sheetFacets.value = { groups: data.groups, tints: data.tints };
    sheetGroup.value = sheetDefaultGroup.value;
  } catch (e) {
    fail(e);
  } finally {
    if (sheetKey.value === key) sheetLoading.value = false;
  }
}
// One place to clear the catalog-shaped filters, because there are four of them
// and four reset points — a filter left set on a list it no longer applies to
// shows an empty grid with no visible cause.
// The catalog opens on its FIRST declared tab, not on "All" — the backend
// orders them most-browsable-first for exactly this (graffiti: Art, then the
// 384 tournament crests). "All" is still there, last, when you want it.
const sheetDefaultGroup = computed(() => sheetFacets.value.groups[0]?.value ?? "");
function clearSheetFacets() {
  activeRarity.value = "";
  sheetGroup.value = sheetDefaultGroup.value;
  sheetCollection.value = "";
  sheetTint.value = "";
  sheetDesign.value = null;
}
watch(sheetKey, (key) => {
  sheetSearch.value = "";
  clearSheetFacets();
  sheetSkins.value = [];
  sheetFacets.value = { groups: [], tints: [] };
  loadSkins(key);
});
// Switching sheet modes also resets the filters so nothing "sticks".
watch(sheetMode, () => {
  sheetSearch.value = "";
  clearSheetFacets();
});
function selectPos(pos: string) {
  const changed = selected.value !== pos;
  selected.value = pos;
  if (changed || sheetMode.value === "replace") sheetMode.value = signedIn.value ? "owned" : "craft";
  // Raising the sheet lives here as well as in the `selected` watch, because
  // re-tapping the slot you are already on doesn't change `selected` and so
  // never fires it — and after minimising the picker, that re-tap is the
  // gesture people reach for to bring it back.
  if (isCompact.value && view.value === "grid") sheetSnap.value = "full";
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
  return [...seen.entries()]
    .filter(([hex]) => sheetSkins.value.some((s) => s.rarity === hex && passGroup(s) && passCollection(s) && passTint(s)))
    .sort((a, b) => a[1] - b[1])
    .map(([hex]) => ({ hex, name: rarityName(hex) }));
});

// ---- catalog facets: group / collection / colourway -------------------------
//
// Graffiti is the catalog that needed these — 2,205 sprays, of which 384 are
// tournament team crests you never want mixed into the art, and 1,767 are the
// same 93 designs in 19 colourways each. Rarity can't separate any of that:
// every tinted spray is Consumer.
//
// None of it is slot-aware. A control shows when the loaded catalog has more
// than one value behind it and stays hidden otherwise, so every other weapon
// sheet is unchanged without a single `if (slot === …)`.
const passGroup = (s: Skin) => !sheetGroup.value || s.group === sheetGroup.value;
const passCollection = (s: Skin) => !sheetCollection.value || s.collection === sheetCollection.value;
const passTint = (s: Skin) => !sheetTint.value || s.tintName === sheetTint.value;

// Counts move with the SEARCH, the way the attachment picker's do: typing
// "astralis" should leave the Team Logos tab reading 1, not 384.
const sheetSearched = computed(() => {
  const q = sheetSearchApplied.value.trim().toLowerCase();
  return q ? sheetSkins.value.filter((s) => itemName(s).toLowerCase().includes(q)) : sheetSkins.value;
});

// Each facet is counted with the filters ABOVE it applied and its own ignored —
// group, then collection, then colourway, then rarity. Counted with its own
// filter on, a list would collapse to the single value you just picked and
// there'd be no way to switch to another without clearing first.
//
// WHICH options exist is a property of the catalog (`sheetSkins`); HOW MANY match
// is a property of the query (`sheetSearched`). Deriving both from the query made
// the controls delete themselves the moment a search narrowed or missed —
// the same failure the inventory rail had, and the reason a typo could leave the
// sheet with no visible way back. Options persist; counts go to zero.
const sheetGroupTabs = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sheetSearched.value) if (s.group) counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
  const owned = new Set(sheetSkins.value.map((s) => s.group).filter(Boolean));
  const tabs = sheetFacets.value.groups
    .filter((g) => owned.has(g.value))
    .map((g) => ({ ...g, count: counts.get(g.value) ?? 0 }));
  // One tab is not a split — judged on the CATALOG, so searching can't collapse
  // the strip. "All" goes last, after the useful ones.
  return tabs.length > 1 ? [...tabs, { value: "", label: "All", count: sheetSearched.value.length }] : [];
});
const sheetCollectionOptions = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sheetSearched.value) {
    if (s.collection && passGroup(s)) counts.set(s.collection, (counts.get(s.collection) ?? 0) + 1);
  }
  // Insertion order = catalog order ≈ release order, which reads far better for
  // capsules and events than alphabetical.
  const all: string[] = [];
  const seen = new Set<string>();
  for (const s of sheetSkins.value) {
    if (s.collection && passGroup(s) && !seen.has(s.collection)) {
      seen.add(s.collection);
      all.push(s.collection);
    }
  }
  if (all.length < 2) return [];
  return [
    { value: "", label: `All collections (${fmtCount([...counts.values()].reduce((n, c) => n + c, 0))})` },
    ...all.map((value) => ({ value, label: `${value} (${counts.get(value) ?? 0})` })),
  ];
});
const sheetTintOptions = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sheetSearched.value) {
    if (s.tintName && passGroup(s) && passCollection(s)) counts.set(s.tintName, (counts.get(s.tintName) ?? 0) + 1);
  }
  const owned = new Set(
    sheetSkins.value.filter((s) => s.tintName && passGroup(s) && passCollection(s)).map((s) => s.tintName),
  );
  if (owned.size < 2) return [];
  // Game order (red → white), not A→Z: that's how the colourways read as a set.
  return [
    { value: "", label: "All colors", color: null },
    ...sheetFacets.value.tints
      .filter((t) => owned.has(t.value))
      .map((t) => ({ value: t.value, label: `${t.label} (${counts.get(t.value) ?? 0})`, color: t.color })),
  ];
});
// Narrowing cascade, same as the attachment picker: a collection you picked
// under Art means nothing under Team Logos.
// Each is a no-op when the value is unchanged. Re-picking the active tab is not
// a state change and must not clear the finer facets below it — nor, in the
// picker's case, cost a refetch that visibly reloads the grid.
//
// A real change replaces the list, so the scroll offset (which belongs to the
// old one) goes back to the top. The container is keyed on `sheetMode|sheetKey`,
// so opening a different WEAPON remounts it and resets for free — but switching a
// tab within one weapon does not, which is where you ended up part-way down a set
// you had never scrolled.
function setSheetGroup(v: string) {
  if (sheetGroup.value === v) return;
  sheetGroup.value = v;
  sheetCollection.value = "";
  sheetTint.value = "";
  sheetDesign.value = null;
  scrollPanelToTop(sheetScrollEl);
}
function setSheetCollection(v: string) {
  if (sheetCollection.value === v) return;
  sheetCollection.value = v;
  sheetTint.value = "";
  sheetDesign.value = null;
  scrollPanelToTop(sheetScrollEl);
}
function setSheetTint(v: string) {
  if (sheetTint.value === v) return;
  sheetTint.value = v;
  sheetDesign.value = null;
  scrollPanelToTop(sheetScrollEl);
}
// The two filters that aren't behind a setter (both are v-model). Searching
// while inside a stack would otherwise show an empty grid whose cause — the
// stack you're still in — isn't among the controls you just touched.
watch([sheetSearch, activeRarity], () => (sheetDesign.value = null));
// Debounce, mirroring invSearchApplied: clearing is instant, typing waits for you
// to stop. A settled term means a new list, so the panel goes back to the top.
let sheetSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(sheetSearch, (v) => {
  clearTimeout(sheetSearchTimer);
  if (!v.trim()) {
    sheetSearchApplied.value = "";
    return;
  }
  sheetSearchTimer = setTimeout(() => (sheetSearchApplied.value = v), SEARCH_DEBOUNCE_MS);
});
onBeforeUnmount(() => clearTimeout(sheetSearchTimer));

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

/**
 * Sort direction. Every sorted grid has one and SHOWS it — an unlabelled "Sort ·
 * Rarity" doesn't say which end it starts from, and for wear the two ends mean
 * opposite things (a factory-new hunt vs a battle-scarred one).
 *
 * Each mode has a NATURAL direction: the one you meant when you picked it. The
 * comparators below are written in that direction, and a flip negates the primary
 * key only — the name tiebreak stays A→Z either way, so reversing rarity doesn't
 * silently reverse the names inside each tier too.
 */
const SORT_NATURAL: Record<SortMode, SortDir> = { default: "desc", rarity: "desc", name: "asc", wear: "asc" };
// What each direction MEANS per mode, for the toggle's tooltip. "Ascending" is
// useless here; "Lowest float first" is what someone is actually looking for.
const SORT_DIR_HINT: Record<SortMode, Record<SortDir, string>> = {
  default: { desc: "Source order", asc: "Reversed" },
  rarity: { desc: "Highest rarity first", asc: "Lowest rarity first" },
  name: { asc: "A → Z", desc: "Z → A" },
  wear: { asc: "Lowest float first", desc: "Highest float first" },
};
// Which icon pair reads the direction: names get A→Z, a float gets 0→1, a rank
// gets the narrow/wide bars. See SortDirection.vue.
const SORT_DIR_KIND: Record<SortMode, SortKind> = {
  default: "amount",
  rarity: "amount",
  name: "alpha",
  wear: "numeric",
};
/**
 * Direction is remembered PER MODE, not per control.
 *
 * A single stored direction per grid meant a preference set on one mode silently
 * became the default for every other: flip Name to Z→A, come back to Rarity, and
 * you get lowest-rarity-first for a choice you made about names. Rarity means
 * highest-first unless you have said otherwise ABOUT RARITY, and per-mode keys are
 * what makes that true no matter what you touched before.
 */
const dirKey = (scope: string, mode: string) => `cs2inv.${scope}Dir.${mode}`;
function loadDir(scope: string, mode: SortMode): SortDir {
  const stored = localStorage.getItem(dirKey(scope, mode));
  return stored === "asc" || stored === "desc" ? stored : SORT_NATURAL[mode];
}

const invSort = ref<SortMode>((localStorage.getItem("cs2inv.invSort") as SortMode | null) ?? DEFAULT_SORT);
watch(invSort, (v) => localStorage.setItem("cs2inv.invSort", v));
const invDir = ref<SortDir>(loadDir("inv", invSort.value));
watch(invDir, (v) => localStorage.setItem(dirKey("inv", invSort.value), v));
const sheetSort = ref<SortMode>((localStorage.getItem("cs2inv.sheetSort") as SortMode | null) ?? DEFAULT_SORT);
watch(sheetSort, (v) => localStorage.setItem("cs2inv.sheetSort", v));
const sheetDir = ref<SortDir>(loadDir("sheet", sheetSort.value));
watch(sheetDir, (v) => localStorage.setItem(dirKey("sheet", sheetSort.value), v));
// Switching mode restores THAT mode's remembered direction, or its natural one.
// Two setters rather than one taking refs: templates auto-unwrap, so a shared
// helper would receive the string values instead of the refs to write back to.
function setInvSort(next: string) {
  invSort.value = next as SortMode;
  invDir.value = loadDir("inv", invSort.value);
}
function setSheetSort(next: string) {
  sheetSort.value = next as SortMode;
  sheetDir.value = loadDir("sheet", sheetSort.value);
}
const byName = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "");
function sortInstances(list: InventoryItem[], mode: SortMode, dir: SortDir): InventoryItem[] {
  const flip = dir === SORT_NATURAL[mode] ? 1 : -1;
  if (mode === "default") return flip === 1 ? list : [...list].reverse();
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => flip * byName(itemName(a.item), itemName(b.item)));
  if (mode === "wear") return arr.sort((a, b) => flip * ((a.wear ?? 1) - (b.wear ?? 1)) || byName(itemName(a.item), itemName(b.item)));
  return arr.sort((a, b) => flip * (rarityRank(b.item?.rarity) - rarityRank(a.item?.rarity)) || byName(itemName(a.item), itemName(b.item)));
}
function sortSkins(list: Skin[], mode: SortMode, dir: SortDir): Skin[] {
  if (mode === "wear") return list; // catalog skins have no wear
  const flip = dir === SORT_NATURAL[mode] ? 1 : -1;
  if (mode === "default") return flip === 1 ? list : [...list].reverse();
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => flip * byName(a.name, b.name));
  return arr.sort((a, b) => flip * (rarityRank(b.rarity) - rarityRank(a.rarity)) || byName(a.name, b.name));
}

/**
 * Render window over a list that is already fully in memory — the client half of
 * infinite scrolling.
 *
 * The catalog lists behind these grids are big (2.2k graffiti, 578 knives, and an
 * inventory can be thousands of items) and every tile is a card with artwork, so
 * committing the whole list to the DOM at once is what actually made these
 * screens feel capped. The window grows a page at a time as the sentinel comes
 * into view; nothing is ever unreachable.
 *
 * `reset` is a getter over the FILTER inputs, not the list itself. Watching the
 * list would send you back to the top of the grid every time anything mutated it
 * — a render landing, an equip re-sorting — while changing a filter genuinely
 * should start over at page one.
 */
/** How many more items each scroll-triggered growth adds. */
const WINDOW_STEP = 60;
/**
 * How many mount on the FIRST paint of a new list, and the cutoff for the
 * entrance cascade — see invCellDelay (grids) and sheetCellClass (sheet).
 *
 * Smaller than the growth step, which is the point. Every list change replaces the
 * cards rather than moving them (see invFilterSig), so the whole window is created
 * in one synchronous task — and at 60 image-bearing cards that task is long enough
 * to eat the frames the tab indicator and the cards' own entrance need, which read
 * as both of them stalling. Roughly a viewport's worth mounts up front and the
 * sentinel tops the rest up over later frames, where there is nothing to compete
 * with.
 */
const WINDOW_FIRST = 24;
function renderWindow<T>(
  source: ComputedRef<T[]>,
  reset: () => unknown,
  step = WINDOW_STEP,
  first = WINDOW_FIRST,
) {
  const shown = ref(first);
  watch(reset, () => {
    shown.value = first;
  });
  return {
    items: computed(() => (shown.value >= source.value.length ? source.value : source.value.slice(0, shown.value))),
    done: computed(() => shown.value >= source.value.length),
    grow: () => {
      shown.value += step;
    },
  };
}

const teamOk = (teams?: Team[] | null) => !teams || teams.length === 0 || teams.includes(team.value);
const matchesFilters = (name?: string, rarity?: string) => {
  const q = sheetSearchApplied.value.trim().toLowerCase();
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
    sheetDir.value,
  ),
);
/**
 * Fold colour variants of one artwork into a single card.
 *
 * 1,767 of the 2,205 sprays are 93 designs repeated in 19 colourways. As one
 * tile each they bury the 438 that are actually distinct artwork, and finding
 * "the green GGEZ" means reading nineteen near-identical names. Items sharing a
 * `design` become one stacked card that says how many it holds; `drill` is the
 * design being opened, and inside one the variants ARE the cards.
 *
 * Generic over what's being stacked because three grids need it — the craft
 * sheet (catalog skins), the sheet's Owned tab and the inventory page (owned
 * instances). Anything without a `design` — every weapon, knife and glove —
 * comes through one card per item, so nothing outside graffiti changes.
 *
 * A stack survives the filters if ANY variant does, and drilling in shows only
 * the survivors. That's why the colour filter needs no special case: pick one
 * and every stack is down to a single variant, so the grid is flat again.
 */
interface Stack<T> {
  key: string | number;
  /** The item a single card equips, and the art a deck wears. */
  face: T;
  /** Two more colourways to fan out behind the face. Empty for a single. */
  behind: string[];
  variants: T[];
}
const TINT_SUFFIX = / \([^()]+\)\s*$/;
const tintColors = computed(() => new Map(sheetFacets.value.tints.map((t) => [t.value, t.color])));
function stackByDesign<T>(
  list: T[],
  drill: number | null,
  of: (v: T) => { id: number; design?: number; tintName?: string } | null | undefined,
  // The card's Vue key, and it has to identify the ROW, not the artwork: two
  // owned copies of one skin share an item id, and a duplicate key inside a
  // keyed v-for makes Vue's diff patch one node twice and orphan the other —
  // an already-filtered-out card left sitting in the grid.
  keyOf: (v: T) => string | number,
): Stack<T>[] {
  const out: Stack<T>[] = [];
  const byDesign = new Map<number, Stack<T>>();
  for (const v of list) {
    const meta = of(v);
    const design = meta?.design;
    if (drill != null) {
      if (design === drill) out.push({ key: keyOf(v), face: v, behind: [], variants: [v] });
      continue;
    }
    if (design == null) {
      out.push({ key: keyOf(v), face: v, behind: [], variants: [v] });
      continue;
    }
    const stack = byDesign.get(design);
    if (stack) {
      stack.variants.push(v);
      continue;
    }
    const next: Stack<T> = { key: `d${design}`, face: v, behind: [], variants: [v] };
    byDesign.set(design, next);
    out.push(next);
  }
  // Which colourway a deck WEARS. Taking the first survivor made a whole grid
  // one colour — catalog order puts the same tint first for every design, so 93
  // stacks all showed up Battle Green. Offsetting by the design id spreads them
  // across the range, and stays deterministic so the colours don't reshuffle
  // every time a filter changes.
  for (const st of out) {
    const n = st.variants.length;
    if (n < 2) continue;
    const at = (k: number) => st.variants[((((of(st.face)?.design ?? 0) + k) % n) + n) % n];
    st.face = at(0);
    // Thirds apart, so the two behind never repeat the face or each other.
    st.behind = [at(Math.floor(n / 3)), at(Math.floor((2 * n) / 3))]
      .map((v) => tintColors.value.get(of(v)?.tintName ?? "") ?? "")
      .filter(Boolean);
  }
  return out;
}

const ownedStacks = computed(() =>
  stackByDesign(ownedForSheet.value, sheetDesign.value, (i) => i.item, (i) => i.id),
);

// Sheet: ALL catalog skins for the weapon (craft mode). The catalog facets only
// live here — the Owned and Replace lists are inventory instances and weapons,
// neither of which carries them.
const craftList = computed(() =>
  sortSkins(
    sheetSkins.value.filter(
      // itemName folds in the phase, so "ruby" / "phase 2" find the right Doppler.
      (s) =>
        matchesFilters(itemName(s), s.rarity) &&
        passGroup(s) &&
        passCollection(s) &&
        passTint(s) &&
        (selected.value !== "agent" || teamOk(s.teams)),
    ),
    sheetSort.value,
    sheetDir.value,
  ),
);

/** Craft grid stacks, plus the name a deck shows: the face's, minus the
 *  "(Colour)" that only distinguishes it from its own siblings. */
const craftStacks = computed(() =>
  stackByDesign(craftList.value, sheetDesign.value, (s) => s, (s) => s.id).map((st) => ({
    ...st,
    card: st.variants.length > 1 ? { ...st.face, name: st.face.name.replace(TINT_SUFFIX, "") } : st.face,
  })),
);

/** The design being drilled into, for the back chip's label. */
const sheetDesignName = computed(() =>
  sheetDesign.value == null
    ? ""
    : stripName(sheetSkins.value.find((s) => s.design === sheetDesign.value)?.name ?? "").replace(TINT_SUFFIX, ""),
);

// Both sheet lists scroll rather than truncate. The reset key is every filter
// that narrows them plus the slot itself — switching weapons is a new list.
const sheetResetKey = () =>
  [
    sheetKey.value,
    sheetMode.value,
    sheetSearchApplied.value,
    activeRarity.value,
    sheetGroup.value,
    sheetCollection.value,
    sheetTint.value,
    sheetDesign.value,
    sheetSort.value,
    sheetDir.value,
    sheetOrigin.value,
  ].join("|");
// Both windows count CARDS, not items — a stack is one thing to scroll past.
const ownedWindow = renderWindow(ownedStacks, sheetResetKey);
const craftWindow = renderWindow(craftStacks, sheetResetKey);
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
/**
 * Translate `key`: our catalogue first, the panel second, `fallback` last.
 *
 * OURS wins deliberately. The panel ships its own messages and an operator
 * upgrading it must not be able to silently change this plugin's wording, so a
 * key we define is the one that renders. The panel is consulted only for keys
 * we do not own.
 *
 * Two distinct misses to survive, and vue-i18n conflates them: no host `t` at
 * all (standalone), and a host `t` that does not know the key — vue-i18n
 * returns the KEY itself for an unknown message, so without the comparison
 * below `inventory.foo.bar` would render on screen.
 *
 * Reads `props.locale` so anything computed from this re-evaluates on a
 * language switch — `props.t` is a stable reference and would not trigger it.
 */
const CATALOGUES: Record<string, Record<string, unknown>> = { en };
function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], catalogue);
}
function tr(key: string, fallback: string, named?: Record<string, unknown>): string {
  const lang = props.locale ?? "en";
  const mine = lookup(CATALOGUES[lang] ?? {}, key) ?? lookup(CATALOGUES.en, key);
  if (typeof mine === "string") {
    return mine.replace(/\{(\w+)\}/g, (_, k) => String(named?.[k] ?? `{${k}}`));
  }
  const host = props.t?.(key, named);
  return !host || host === key ? fallback : host;
}

/** Every notification in the plugin funnels through here — including the ones
 *  AdminConsole and SkinTests emit upward — so the host's toast is the single
 *  implementation. */
function notify(message: string, kind: "error" | "success" = "error") {
  props.notify(message, kind);
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
  /** `seed` is the charm's own PATTERN, the same idea as the weapon's and a
   *  tradeable attribute in its own right. Purely an attribute: CS2 varies no
   *  charm geometry or art by it, so the 3D viewer never sees it. */
  charm: (Attach & { z?: number | null; seed?: number | null }) | null;
} | null>(null);
/**
 * Does the editor's right-hand column have anything IN it?
 *
 * Every box in there — name tag, attachment slots, pattern, wear, StatTrak —
 * is gated per slot, and for graffiti every one of those gates is closed. The
 * column still claimed its 300px, so the preview centred itself in what was
 * left and a spray sat visibly off to the left of an empty panel. Hidden, the
 * preview takes the whole modal.
 */
const craftHasOptions = computed(() => selected.value !== "graffiti");
/**
 * What attachments the thing being edited supports.
 *
 * ASKS THE ITEM FIRST, and only falls back to the slot. It used to ask the slot
 * alone, which is right when you craft from the loadout sheet (the slot IS the
 * subject) and wrong every other way in: opening an owned agent from the
 * inventory grid leaves `selected` on whatever weapon position was last picked,
 * so the agent got a weapon's form — five sticker slots, a charm, a pattern and
 * a float — and no patches at all.
 *
 * Note zeus and c4 take stickers despite not being weapon POSITIONS, and both
 * are cs2-lib `weapon` type, so the item answer covers them without the special
 * case the slot form needed.
 */
const attachKind = computed<"weapon" | "agent" | "none">(() => {
  const type = craftType.value;
  if (type) {
    if (type === "agent") return "agent";
    return type === "weapon" || type === "melee" ? "weapon" : "none";
  }
  if (selected.value === "agent") return "agent";
  if (isWeaponPos(selected.value) || selected.value === "zeus" || selected.value === "c4") return "weapon";
  return "none";
});
/**
 * The cs2-lib type of whatever the craft modal is editing, when it knows it.
 *
 * Every "which controls does this item get" question below asks THIS first and
 * only falls back to the slot. They all used to ask the slot alone
 * (`!['agent','musickit','graffiti'].includes(selected)`), which is right when
 * you craft from the loadout sheet and wrong every other way in: opening an
 * owned agent from the inventory grid leaves `selected` on whatever weapon
 * position was last picked, so the agent was offered a pattern, a float and
 * StatTrak — none of which an agent has.
 */
const craftType = computed(() => craft.value?.skin.type ?? craftInst.value?.item?.type ?? null);
/** Fall back to the slot only when the item's type is genuinely unknown — a
 *  catalog listing that predates the field. */
const craftSlotSays = (nope: string[]) => !nope.includes(selected.value);
const craftHasSeed = computed(() =>
  craftType.value ? hasSeed({ type: craftType.value }) : craftSlotSays(["agent", "musickit", "graffiti"]),
);
const craftHasWear = computed(() =>
  craftType.value ? hasWear({ type: craftType.value }) : craftSlotSays(["agent", "musickit", "graffiti"]),
);
// StatTrak is weapons, knives and music kits — NOT gloves, which do have a float
// and a pattern. That distinction is invisible to a slot-shaped gate.
const craftHasStatTrak = computed(() =>
  craftType.value
    ? ["weapon", "melee", "musickit"].includes(craftType.value)
    : craftSlotSays(["agent", "graffiti"]),
);
const editingId = ref<number | null>(null);
// The weapon model this craft/edit is about. Crafting from the sheet = the
// selected slot's weapon; editing from anywhere = the ITEM's own weapon.
const craftModel = ref<string | null>(null);
// What the 3D stage MOUNTS for this craft/edit — model key plus what kind of
// thing it is. Distinct from craftModel, which stays "the weapon", because
// plenty here is weapon-specific (sticker geometry, the weapon name, the
// inspect link) and a charm has no weapon model at all. Resolved in the `craft`
// watcher; null means this item has no 3D form.
const craftTarget = ref<ViewerTarget | null>(null);
/**
 * Show a glove's forearms.
 *
 * CS2 models gloves as the player's viewmodel ARMS, so `bare_arm_*` geometry
 * ships with every glove. Off by default — the ITEM is the glove, and the arms
 * are twice its bulk, which dominates the frame and makes two finishes hard to
 * compare side by side. Flipping it REMOUNTS: the arms are culled geometry, not
 * a material flag.
 */
const gloveArms = ref(false);
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
  // The finish's OWN model wins: a knife/zeus/c4 sheet isn't a weapon position,
  // so the slot can't name a model, and every knife finish is a different one.
  // Falling back to the slot keeps working for weapon skins whose listing
  // predates the model field. No model = no 3D — see the `craft` watcher.
  craftModel.value = skin.model ?? (isWeaponPos(selected.value) ? occupantModel(selected.value) : null);
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
      notify(tr("inventory.notify.craft_link_missing", "That craft link points at an item that no longer exists."), "error");
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
        charm: attach(d.charm, {
          x: d.charm?.x ?? null,
          y: d.charm?.y ?? null,
          z: d.charm?.z ?? null,
          seed: d.charm?.seed ?? null,
        }) as (Attach & { z?: number | null; seed?: number | null }) | null,
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
    // `type` and `model` ride along because they are what decides WHAT the 3D
    // stage mounts (see resolveViewerModel) — a charm carries no model at all,
    // so without the type this projection resolves to "no 3D form" and the
    // modal silently stays flat.
    skin: { id: inst.item.id, name: inst.item.name, altName: inst.item.altName ?? null, rarity: inst.item.rarity ?? "", image: inst.item.image, paintMaterial: inst.item.paintMaterial ?? null, legacyPaint: !!inst.item.legacyPaint, type: inst.item.type, model: inst.item.model ?? null },
    wear: inst.wear ?? DEFAULT_WEAR,
    seed: inst.seed ?? 1,
    stattrak: inst.stattrak,
    nametag: inst.nametag ?? "",
    stickers,
    patches,
    charm: inst.charm
      ? { id: inst.charm.id, name: inst.charm.name, image: inst.charm.image, x: inst.charm.x ?? null, y: inst.charm.y ?? null, z: inst.charm.z ?? null, seed: inst.charm.seed ?? null }
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
 * Does the preview need the waist-crop feather (ART_FADE_B)? Three ways into
 * this modal and only two of them carry a type: an owned item and a shared
 * craft link (/catalog/items) both know it, while the sheet's catalog listing
 * doesn't — there the selected slot is the answer. Type first, so opening a
 * weapon link while the agent slot happens to be selected doesn't mask a barrel.
 */
const craftIsAgent = computed(() => {
  const type = craft.value?.skin.type ?? craftInst.value?.item?.type;
  return type ? type === "agent" : selected.value === "agent";
});
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
// Charm patterns run to 100000, an order of magnitude past a weapon's 1000 —
// they are their own attribute with their own range, not the weapon's reused.
function randomCharmSeed() {
  if (craft.value?.charm) craft.value.charm.seed = Math.floor(rand(1, 100001));
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
    charm_offset: c.charm ? { x: c.charm.x ?? null, y: c.charm.y ?? null, z: c.charm.z ?? null, seed: c.charm.seed ?? null } : null,
  };
}
// Inspect the DRAFT — works before the craft has ever been saved.
async function openCraftInspect() {
  if (!craft.value) return;
  try {
    const { inspect } = await fetchDraftInspectLink({ item_id: craft.value.skin.id, ...craftBody() });
    window.location.href = inspect;
    linkOpening.value = true;
    notifyInspectSent();
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
  if (!signedIn.value) return notify(tr("inventory.notify.sign_in_to_save", "Sign in to save this to your inventory."));
  editingId.value = null;
  duplicating.value = true;
  await confirmCraft();
}
async function confirmCraft() {
  if (!craft.value || craftBusy.value) return;
  // Belt-and-braces behind the disabled button: the editor is reachable signed
  // out (and via a shared /craft/<id> draft link), so the commit re-checks
  // rather than trusting that no path got here.
  if (!signedIn.value) return notify(tr("inventory.notify.sign_in_to_save", "Sign in to save this to your inventory."));
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
        duplicating.value
          ? tr("inventory.notify.copy_created", "Editable copy created in your inventory.")
          : tr("inventory.notify.crafted", "Crafted — it's in your inventory."),
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
// A bake found paint assets missing from the mount, which means an extraction
// is still populating it. Latched for the session: it flips off on reload, and
// the honest message while it's set is "these are still being prepared" rather
// than showing white guns as if they were the real skins.
const assetsPending = ref(false);
// Snapshots each need a WebGL context — run them one at a time so a page of
// missing renders backfills calmly instead of exhausting context limits.
let renderQueue: Promise<unknown> = Promise.resolve();
const queuedIds = ref<Set<number>>(new Set());

// ---- phone budget -----------------------------------------------------------
// Serialising the queue bounds how many bakes run AT ONCE (one, here and again
// in viewer3d's build lane). It does not bound how many get ASKED for, and on a
// phone that is the number that matters: scrolling a long grid can enqueue
// dozens in a second, each one a context created, a 2K paint composited, and
// the context torn down again. Mobile Safari starts shedding the oldest context
// once too many have existed and Android Chrome just runs the tab out of
// memory — which is the crash.
//
// So on touch devices: keep a short backlog, and leave a gap between bakes for
// the browser to actually reclaim the last one. Cards that lose their turn show
// catalog art and ask again next time they scroll into view.
const TOUCH_BAKE_BACKLOG = 3;
const TOUCH_BAKE_COOLDOWN_MS = 400;
const bakeCooldown = () =>
  isCoarse.value ? new Promise((r) => setTimeout(r, TOUCH_BAKE_COOLDOWN_MS)) : Promise.resolve();

function generateRender(inst: InventoryItem): Promise<boolean> {
  if (renderedIds.has(inst.id) || queuedIds.value.has(inst.id)) return Promise.resolve(false);
  if (isCoarse.value && queuedIds.value.size >= TOUCH_BAKE_BACKLOG) return Promise.resolve(false);
  queuedIds.value = new Set([...queuedIds.value, inst.id]);
  const run = renderQueue.then(() => generateRenderNow(inst));
  // The cooldown rides the QUEUE, not the returned promise: the next bake waits
  // for it, the caller doesn't.
  renderQueue = run.catch(() => false).then(bakeCooldown);
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
  // WEAPONS AND KNIVES ONLY.
  //
  // `hasModel` alone used to be the whole gate, which was fine while those were
  // the only two types with a GLB. The moment gloves and agents landed on the
  // mount they started baking too — and a glove baked through the weapon path
  // has no compositor, so every painted glove card became a pair of blank white
  // hands, cached under a key that says it is finished.
  //
  // Beyond the bug: 3D for the new types is ON DEMAND by design. Their grid card
  // IS the flat icon, so there is nothing here to bake even once gloves
  // composite correctly. Anything that changes must also change
  // RENDERED_IN_3D in build-asset-manifest.mjs, which encodes the same decision
  // for the extractor's missing-icon report.
  if ((resolveViewerModelSync(inst.item)?.kind ?? null) !== "weapon") return false;
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
    if (blob === INCOMPLETE) {
      // Paint assets aren't extracted yet — this would bake a white gun, and
      // render keys never change, so it would be served forever. Leave the id
      // unmarked so the backfill retries once the extraction has populated the
      // mount, and let the card show its pending state meanwhile.
      renderedIds.delete(inst.id);
      assetsPending.value = true;
      return false;
    }
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
      notify(tr("inventory.notify.render_upload_failed",
        `Render made locally, but saving it failed: ${up.error}. Check backend deploy/mount.`,
        { error: up.error }), "error");
    } else if (up.ok && !uploadWarned) {
      // Verify the file actually serves back — if not, the backend wrote to a
      // mount nginx can't see (or a CDN cached the old 404).
      if (!(await renderServes(`${renderUrlFor(inst)}?verify=${Date.now()}`))) {
        uploadWarned = true;
        notify(
          tr("inventory.notify.render_not_served",
            "Render SAVED (backend OK) but /renders/ doesn't serve it back — frontend + backend pods aren't sharing the mount, or a cache is serving a stale 404."),
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
provide("itemArt", { renderSrc, onRenderError, renderingIds, queuedIds, assetsPending });
// Child components translate through the same resolver — one catalogue, one
// resolution order. Provided rather than passed as a prop because it is needed
// at every depth and threading it through each component adds nothing.
provide("tr", tr);

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
  craftTarget.value = null;
  if (open) {
    // What to MOUNT is not always the weapon model: a charm has no `model` at
    // all (the econ schema names its mesh, and 23 of them share one blank), so
    // resolveViewerModel is the only thing that can answer. The sync form comes
    // first because everything except a charm can answer without a round trip —
    // see the peek note below, which an unconditional await would defeat.
    //
    // The craftModel fallback is not belt-and-braces: /catalog/skins does not
    // send `type`, so a plain AK finish resolves to null here, and without it
    // every weapon in the craft sheet would lose 3D.
    const sync = resolveViewerModelSync(craft.value?.skin);
    craftTarget.value =
      (sync === undefined ? await resolveViewerModel(craft.value?.skin) : sync) ??
      (craftModel.value ? { model: craftModel.value, kind: "weapon" } : null);
  }
  const targetKey = craftTarget.value?.model;
  if (open && targetKey) {
    // Peek before awaiting. On a cache hit this whole branch stays synchronous,
    // so `modal3d` is already true when the modal first paints and the 2D still
    // never appears — and `modal3dAvailable` goes false→true inside one flush,
    // so the 2D/3D pill doesn't blink out either.
    const known = hasModelSync(targetKey);
    modal3dAvailable.value = known ?? (await hasModel(targetKey));
    // 3D is the default editor: placement is the whole job here, and the 2D
    // form can't show you where anything actually lands. Falls back to the
    // form when the weapon has no extracted model, or when the link said ?d=2.
    if (modal3dAvailable.value && craft.value && !routeWants2d.value) modal3d.value = true;
  }
  // After the flush, so the watcher jobs these assignments queued have run.
  await nextTick();
  modal3dResetting = false;
  // The modal3d watcher mounts on an EDGE, and reassigning `craft` while 3D is
  // already on doesn't produce one: the reset above writes true→false→true
  // inside a single flush, which the watcher sees as no change at all. So the
  // teardown at the top of this watcher would take the viewer away and nothing
  // would bring it back — a blank stage on every view↔edit flip and every item
  // switch made from the URL. `modalViewerAbort` is the "a mount has started
  // since that teardown" flag (teardown is what clears it), so a genuine
  // false→true edge, which HAS already mounted by now, doesn't mount twice.
  if (modal3d.value && !modalViewerAbort) void mountModalViewer();
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
    charm: c.charm ? { id: c.charm.id, x: c.charm.x, y: c.charm.y, z: c.charm.z, seed: c.charm.seed } : null,
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
  // The seed goes to the RENDERER too, not just the game server: a charm's
  // pattern drives real shader params (hue, saturation, brightness) on 36 of the
  // 89 keychain materials.
  return c?.image ? { image: c.image, x: c.x ?? null, y: c.y ?? null, z: c.z ?? null, seed: c.seed ?? null } : null;
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
    const target = craftTarget.value;
    if (!target) return;
    const model = target.model;
    // Weapon-only machinery, skipped by kind rather than by "did the lookup
    // happen to come back empty": sticker slots and the charm attachment are
    // meaningless on a charm that IS the model, and stickerGeom would fetch
    // markup for a key no weapon has.
    const isWeapon = target.kind === "weapon";
    const handle = await mountViewer(modalViewerEl.value, model, {
      signal: ac.signal,
      kind: target.kind,
      charmSpec: target.charm ?? null,
      gloveArms: gloveArms.value,
      // A sticker or patch has no model to name, so it is addressed by its art.
      decal:
        target.kind === "sticker" || target.kind === "patch"
          ? { image: craft.value?.skin.image ?? "", wear: 0 }
          : null,
      paintMaterial: craft.value?.skin.paintMaterial ?? null,
      legacyPaint: !!craft.value?.skin.legacyPaint,
      wear: craft.value?.wear,
      // A charm's `seed` is its own PATTERN, and the standalone viewer grades
      // its material by it — so this is the charm's seed when the charm is the
      // model, and the weapon's float pattern otherwise.
      seed: craft.value?.seed,
      // View mode isn't interactive in the viewer's sense: no attachment
      // dragging, and the model idles on a slow auto-rotate the way the old
      // standalone overlay did. Orbit/pan/zoom are gated on `still`, not this,
      // so they stay available either way.
      interactive: !viewOnly.value,
      ...(isWeapon ? await stickerGeom(model) : {}),
      stickers: isWeapon ? craftStickerPlacements() : [],
      charm: isWeapon ? craftCharmPlacement() : null,
      // Live 3D, so a real readout — the owned item's count when the modal is
      // showing one (craftInstId covers editing AND duplicating, which
      // editingId does not), and 0 for a brand-new craft that has no kills.
      stattrak: craft.value?.stattrak
        ? { count: inventory.value.find((i) => i.id === craftInstId.value)?.stattrak_count ?? 0 }
        : null,
      nametag: craft.value?.nametag ?? null,
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
    // The options above are a snapshot taken before the GLB loaded, and pressing
    // Edit during that load flips viewOnly while there is no handle for the
    // watcher below to talk to. Reconcile here so a mode change can't be lost in
    // the gap — no-ops when it already matches.
    handle.setInteractive(!viewOnly.value);
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
// Culling the forearms changes GEOMETRY, so it cannot be flipped on a live
// scene the way a material flag could — the viewer has to be rebuilt.
watch(gloveArms, () => {
  if (modal3d.value && craftTarget.value?.kind === "glove") void mountModalViewer();
});
// View ↔ edit is a flag flip, not a remount (see craftViewEdit for why), so the
// already-mounted viewer has to be TOLD which mode it is in. Without this the
// viewer kept whatever `interactive` it was mounted with: opening an item at
// /items/<id> and pressing Edit gave a weapon that idled on a slow auto-rotate,
// ignored every attempt to drag a sticker, and showed the SPIN reticle over one
// — while the same item opened straight into the editor worked. That's the
// "sometimes I can't drag the sticker" report.
watch(viewOnly, (on) => modalViewerHandle?.setInteractive(!on));
// Wear/seed changes retexture the model — debounced remount so slider drags
// don't recomposite on every tick.
let retexTimer: ReturnType<typeof setTimeout> | undefined;
/** Which `craft` object the wear/seed this watcher last saw belonged to. */
let retexCraft: object | null = null;
watch(
  () => [craft.value?.wear, craft.value?.seed],
  () => {
    // EDITS ONLY. Loading an item into the modal trips this watcher too — the
    // values go null→(wear, seed) as `craft` is assigned — and that is not an
    // edit: the mount the `craft` watcher started one line earlier was given
    // those exact numbers. Acting on it built every weapon TWICE per open (two
    // GLB loads, two paint composites), and the second mount aborted the first
    // mid-download, which is where the orphaned canvas that rendered the gun
    // below the pane came from. Identity, not a "first fire" flag: view↔edit
    // and draft restores reassign `craft` too, and each one is the same
    // not-an-edit.
    const owner = craft.value ?? null;
    if (owner !== retexCraft) {
      retexCraft = owner;
      return;
    }
    if (!modal3d.value) return;
    clearTimeout(retexTimer);
    retexTimer = setTimeout(() => {
      if (modal3d.value) void mountModalViewer();
    }, 450);
  },
);
// StatTrak toggle → attach/detach the module on the live viewer. Deliberately
// NOT folded into the wear/seed remount above: the module is independent of the
// paint composite, and remounting would reset the camera on every flip.
watch(
  () => craft.value?.stattrak,
  (on) => {
    if (!modalViewerHandle || !craft.value) return;
    modalViewerHandle.setStatTrak(
      on
        ? { count: inventory.value.find((i) => i.id === craftInstId.value)?.stattrak_count ?? 0 }
        : null,
    );
  },
);
// Name tag → swap the engraved plate on the live viewer. Its own watcher for
// the same reason StatTrak has one: the plate is independent of the paint
// composite, so remounting to show it would reset the camera mid-keystroke.
watch(
  () => craft.value?.nametag,
  (text) => {
    if (!modalViewerHandle || !craft.value) return;
    modalViewerHandle.setNameTag(text ?? null);
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
    ? JSON.stringify([craft.value.skin.id, craft.value.wear, craft.value.seed, craft.value.stickers, craft.value.charm, craft.value.stattrak])
    : "";
async function refreshCraftPreview() {
  const c = craft.value;
  const model = craftModel.value;
  if (!c || !model) return;
  // A brand-new craft with no customization has nothing worth baking — the
  // base catalog art is the truth until stickers/charm/wear get touched
  // (the template already falls back to craft.skin.image while null).
  if (editingId.value == null && craftBaseline === "" && !c.stickers.some(Boolean) && !c.charm && !c.stattrak) return;
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
    // INCOMPLETE = the skin's textures aren't extracted yet; showing the white
    // fallback as a 'preview' would be a lie. Leave the catalog art in place.
    if (!blob || blob === INCOMPLETE || token !== craftPreviewToken) return;
    if (craftPreview.value) URL.revokeObjectURL(craftPreview.value);
    craftPreview.value = URL.createObjectURL(blob);
  } finally {
    if (token === craftPreviewToken) craftPreviewBusy.value = false;
  }
}
// NOT baked while the modal is showing 3D — the image it produces is
// `v-show="!modal3d"`, i.e. hidden behind the live viewer.
//
// A bake mounts a SECOND WebGL context, loads the model and composites the paint:
// about a second of GPU and main thread, competing with the viewer the user is
// actually looking at. It fires off a 400ms debounce, so every sticker you added
// and every pause mid-drag to line one up bought a stall in the 3D view — for a
// picture nobody could see. Deferred to the moment 3D is switched off instead.
let craftPreviewStale = false;
function scheduleCraftPreview(ms: number) {
  clearTimeout(craftPreviewTimer);
  if (modal3d.value) {
    craftPreviewStale = true;
    return;
  }
  craftPreviewTimer = setTimeout(() => void refreshCraftPreview(), ms);
}
// Leaving 3D is when that deferred bake comes due — the 2D image is about to be
// the thing on screen, so it has to catch up on everything edited while hidden.
watch(modal3d, (on) => {
  if (on || !craftPreviewStale) return;
  craftPreviewStale = false;
  scheduleCraftPreview(0);
});
watch(
  // must match craftStateJson exactly — the baseline compare below is what
  // decides whether the already-baked render still stands
  () => craft.value && craftStateJson(),
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
    scheduleCraftPreview(400);
  },
);

// Sticker/charm picker. Searched, FACETED and paged server-side: stickers and
// charms are ~10.5k items each, far too many to ship in one response, so the grid
// scrolls through the match set a page at a time. `pickerTotal` is the full match
// count, which is both the "N stickers" readout and how the sentinel knows when
// to stop.
//
// Three facets, narrowing left to right (see searchAttachments in the backend for
// how each is derived):
//   group      Signatures / Team logos / Community — or, for charms, the split
//              that matters most: 81 real Charms vs 10,565 Sticker Slabs.
//   collection the capsule it came in, ~61 of them, in release order.
//   rarity     the usual hex tiers, named by RARITY_META.
const PICKER_PAGE = 120;
/**
 * Which tab each picker OPENS on. A UI decision, so it lives here — the backend
 * just answers whatever it is asked (its GROUPS table owns the tabs themselves).
 *
 * NOT "All", because for both big catalogs "All" is mostly one thing nobody
 * browses by eye: 7,495 of the 10,565 stickers are player autographs, and 10,565
 * of the 10,646 charms are Sticker Slabs. Opening on the smaller half is the
 * difference between a picker and a scroll. Everything is one tab away, counted.
 */
const PICKER_DEFAULT_GROUP: Record<"sticker" | "charm" | "patch", string> = {
  sticker: "community", // the Art tab — 965 art stickers, no crests, no autographs
  charm: "charm",
  patch: "",
};
const picker = ref<{ kind: "sticker" | "charm" | "patch"; slot: number } | null>(null);
const pickerQuery = ref("");
const pickerGroup = ref("");
const pickerCollection = ref("");
const pickerRarity = ref("");
// Remembered across pickers and sessions, like the inventory/sheet sorts — a
// preference for how to read a catalog isn't per-visit.
// Rarity by default: it is the one attribute that ranks these against each other,
// and it's now visible on every tile (the coloured rule + glow), so the grid reads
// top-down as best-first instead of as arrival order.
const pickerSort = ref<AttachSort>((localStorage.getItem("cs2inv.pickerSort") as AttachSort | null) ?? "rarity");
watch(pickerSort, (v) => localStorage.setItem("cs2inv.pickerSort", v));
const PICKER_SORT_NATURAL: Record<AttachSort, SortDir> = { default: "asc", rarity: "desc", name: "asc" };
const PICKER_SORT_KIND: Record<AttachSort, SortKind> = { default: "amount", rarity: "amount", name: "alpha" };
const PICKER_DIR_HINT: Record<AttachSort, Record<SortDir, string>> = {
  default: { asc: "Oldest capsules first", desc: "Newest capsules first" },
  rarity: { desc: "Highest rarity first", asc: "Lowest rarity first" },
  name: { asc: "A \u2192 Z", desc: "Z \u2192 A" },
};
// Per mode, same reason as the grids above — see dirKey/loadDir.
function loadPickerDir(mode: AttachSort): SortDir {
  const stored = localStorage.getItem(dirKey("picker", mode));
  return stored === "asc" || stored === "desc" ? stored : PICKER_SORT_NATURAL[mode];
}
const pickerDir = ref<SortDir>(loadPickerDir(pickerSort.value));
watch(pickerDir, (v) => localStorage.setItem(dirKey("picker", pickerSort.value), v));
const PICKER_SORTS: { value: AttachSort; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "default", label: "Collection" },
  { value: "name", label: "Name" },
];
const pickerGroups = ref<AttachFacet[]>([]);
const pickerCollections = ref<AttachFacet[]>([]);
const pickerRarities = ref<AttachFacet[]>([]);
const pickerResults = ref<Skin[]>([]);
const pickerTotal = ref(0);
const pickerQueryTotal = ref(0);
/** The picker's grid, which is also its scroller — see pickerFetch. */
const pickerScrollEl = ref<HTMLElement | null>(null);
const pickerLoading = ref(false); // first page — the grid shows a spinner instead
const pickerLoadingMore = ref(false); // a later page — the grid stays put
let pickerTimer: ReturnType<typeof setTimeout> | undefined;
// Every response is checked against this. A search that resolves after the query
// moved on (or after the picker closed) must not append its rows to a list that
// is now about something else — the pages would interleave.
let pickerToken = 0;
const pickerDone = computed(() => pickerResults.value.length >= pickerTotal.value);

async function pickerFetch(offset: number) {
  const p = picker.value;
  if (!p) return;
  const token = ++pickerToken;
  const q = pickerQuery.value;
  if (offset === 0) {
    // A new search supersedes any page fetch still in flight. Clear its flag
    // here: that fetch's own `finally` belongs to a dead token and won't, and a
    // stuck pickerLoadingMore would block loading forever.
    pickerLoadingMore.value = false;
    pickerLoading.value = true;
    // The offset belongs to the list being replaced. Switching a tab left you
    // part-way down a set you had never scrolled — or past the end of a shorter
    // one, looking at nothing. Done on the way OUT, while the old results are
    // still up and dimming, so the arriving page is never scrolled after paint.
    scrollPanelToTop(pickerScrollEl.value);
  } else {
    pickerLoadingMore.value = true;
  }
  try {
    const page = await searchAttachments(p.kind, {
      q,
      group: pickerGroup.value,
      collection: pickerCollection.value,
      rarity: pickerRarity.value,
      sort: pickerSort.value,
      dir: pickerDir.value,
      offset,
      limit: PICKER_PAGE,
    });
    if (token !== pickerToken) return;
    // OUR default tab must never hide the USER's search. On "Logos & Art",
    // typing a player name returned nothing while 39 signatures sat one tab over
    // — so when the default (and only the default: `pickerFiltered` is false
    // exactly while nothing has been chosen by hand) is what emptied the grid,
    // widen to All and let the tabs show where the matches actually live.
    // Checked before the assignments so the empty grid never flashes. Terminates:
    // with no group filter, total is queryTotal, which is > 0 here.
    if (offset === 0 && page.total === 0 && page.queryTotal > 0 && pickerGroup.value && !pickerFiltered.value) {
      pickerGroup.value = "";
      // Bumps the token, so this response is abandoned and the `finally` below
      // leaves the busy flags to the refetch that now owns them.
      return void pickerFetch(0);
    }
    pickerResults.value = offset === 0 ? page.items : [...pickerResults.value, ...page.items];
    pickerTotal.value = page.total;
    pickerQueryTotal.value = page.queryTotal;
    pickerGroups.value = keepFacets(pickerGroups.value, page.groups);
    pickerCollections.value = keepFacets(pickerCollections.value, page.collections);
    pickerRarities.value = keepFacets(pickerRarities.value, page.rarities);
  } catch (e) {
    fail(e);
  } finally {
    // Only the CURRENT request owns the flags — see the token comment above.
    if (token === pickerToken) {
      pickerLoading.value = false;
      pickerLoadingMore.value = false;
    }
  }
}
const pickerSearch = () => pickerFetch(0);
function pickerMore() {
  if (pickerLoading.value || pickerLoadingMore.value || pickerDone.value) return;
  void pickerFetch(pickerResults.value.length);
}
watch(pickerQuery, () => {
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(pickerSearch, SEARCH_DEBOUNCE_MS);
});
// Facets are a click, not typing — refetch immediately, and cancel a debounced
// search so a keystroke from a moment ago can't land after and undo the filter.
// Sort re-orders the WHOLE match set server-side, so the already-loaded pages are
// no longer the right first pages — start over from page one.
function setPickerSort(value: string) {
  clearTimeout(pickerTimer);
  pickerSort.value = value as AttachSort;
  pickerDir.value = loadPickerDir(pickerSort.value);
  void pickerSearch();
}
// Direction re-orders the whole match set server-side, so the loaded pages are no
// longer the right first pages — same restart as changing the mode.
function setPickerDir(value: SortDir) {
  clearTimeout(pickerTimer);
  pickerDir.value = value;
  void pickerSearch();
}
function setPickerFacet(facet: "group" | "collection" | "rarity", value: string) {
  // Re-picking what is already picked is not a state change, so it must not cost
  // a round trip. It did: clicking the active tab re-ran the search, and because
  // the grid remounts its tiles that read as the whole sticker list flickering
  // and reloading for no reason. Note this has to come BEFORE the cascade below,
  // which would otherwise clear the finer facets on a no-op click.
  const currentValue =
    facet === "group" ? pickerGroup.value : facet === "collection" ? pickerCollection.value : pickerRarity.value;
  if (currentValue === value) return;
  clearTimeout(pickerTimer);
  // Narrowing cascade: a collection only exists within a group and a rarity
  // within a collection, so picking a coarser facet drops the finer ones. Kept
  // rather than intersected because the alternative is a filter bar that reads as
  // set but returns nothing — pick "Charms" while "IEM Katowice" is still on and
  // there is no such thing.
  if (facet === "group") {
    pickerGroup.value = value;
    pickerCollection.value = "";
    pickerRarity.value = "";
  } else if (facet === "collection") {
    pickerCollection.value = value;
    pickerRarity.value = "";
  } else {
    pickerRarity.value = value;
  }
  void pickerSearch();
}
// Group tabs as rendered: the catalog's own splits, then All. All goes LAST
// because it is the fallback, not the starting point — and its count comes from
// `queryTotal`, since summing the tabs would double-count the union tab.
const pickerTabs = computed(() =>
  pickerGroups.value.length
    ? [...pickerGroups.value, { value: "", label: "All", count: pickerQueryTotal.value }]
    : [],
);
const pickerDefaultGroup = computed(() => (picker.value ? PICKER_DEFAULT_GROUP[picker.value.kind] : ""));
// Unlike every other pill, these tabs are DATA — they arrive with the first
// response and a search can change which ones exist at all, so the indicator has
// to follow the tab list as well as the selection. `immediate` seeds the active
// key before the list mounts, so the ResizeObserver's first fire measures the
// selected tab instead of parking the indicator under "All" (key "", which is
// also makePill's initial activeKey).
watch([pickerGroup, pickerTabs], () => nextTick(() => pickerGroupPill.sync(pickerGroup.value)), {
  immediate: true,
});
// "Filtered" means "not how it opened" — so Clear appears when there is something
// to undo, and the default tab alone doesn't count as a filter to clear.
const pickerFiltered = computed(
  () => pickerGroup.value !== pickerDefaultGroup.value || !!pickerCollection.value || !!pickerRarity.value,
);
// What the footer count is counting. The group label when one is picked, because
// "10565 charms" is a poor description of 10565 Sticker Slabs.
const pickerNoun = computed(() => {
  const group = pickerGroups.value.find((g) => g.value === pickerGroup.value);
  if (group?.label) return group.label.toLowerCase();
  const kind = picker.value?.kind ?? "item";
  return pickerTotal.value === 1 ? kind : `${kind}s`;
});
function clearPickerFacets() {
  clearTimeout(pickerTimer);
  pickerGroup.value = pickerDefaultGroup.value; // back to how it opened, not to All
  pickerCollection.value = "";
  pickerRarity.value = "";
  void pickerSearch();
}
/**
 * Facet lists survive a query that matches nothing.
 *
 * A zero-result search returns no facet entries at all — correctly, nothing
 * matches — and every control in the bar is drawn `v-if="…length > 1"`. So
 * typing a typo deleted the tabs, the collection dropdown and the rarity
 * dropdown at the exact moment they were the only way out, leaving a bare CLEAR
 * on an empty screen. It also reflowed the toolbar, which is the jerkiness.
 *
 * Keep the OPTIONS and zero the COUNTS: the options are a property of the
 * catalog, which hasn't changed, while the counts belong to the query, which
 * found nothing. Both halves stay honest and the bar stops moving.
 */
function keepFacets(prev: AttachFacet[], next: AttachFacet[]): AttachFacet[] {
  if (next.length) return next;
  return prev.map((f) => ({ ...f, count: 0 }));
}
const fmtCount = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
// "All" first, then the facet's own values with counts. The dropdowns show every
// option regardless of count because the counts are already narrowed by the
// facets above — a zero would mean the row shouldn't be there at all.
const pickerCollectionOptions = computed(() => [
  { value: "", label: `All collections (${fmtCount(pickerCollections.value.reduce((n, f) => n + f.count, 0))})` },
  ...pickerCollections.value.map((f) => ({ value: f.value, label: `${f.label ?? f.value} (${f.count})` })),
]);
const pickerRarityOptions = computed(() => [
  { value: "", label: "All rarities", color: null },
  ...[...pickerRarities.value]
    .sort((a, b) => rarityRank(b.value) - rarityRank(a.value))
    .map((f) => ({ value: f.value, label: `${rarityName(f.value)} (${f.count})`, color: f.value })),
]);
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
  pickerGroup.value = PICKER_DEFAULT_GROUP[kind];
  pickerCollection.value = "";
  pickerRarity.value = "";
  pickerResults.value = [];
  pickerTotal.value = 0;
  pickerQueryTotal.value = 0;
  // Cleared too, not just re-fetched: they belong to whichever catalog was open
  // last, and a stale Sticker Slabs tab over a patch picker is worse than none.
  pickerGroups.value = [];
  pickerCollections.value = [];
  pickerRarities.value = [];
  void pickerSearch();
}
// ---- Catalog art from the model, for items CS2 ships no picture of ----------
/**
 * Some catalog items have no artwork ANYWHERE in the game, so their card is
 * blank however hard the extractor looks.
 *
 * The 8 paintable base gloves are the case: Bloodhound, Broken Fang, Sport,
 * Slick, Specialist, Hydra, Moto and Handwraps. Verified against the archive —
 * `default_generated/` holds only `<glove>_<paint>_<wear>` skinned variants,
 * `base_weapons/` and `wearables/gloves/` hold only the two DEFAULT gloves, and
 * items_game.txt gives the paintable ones no `image_inventory` key at all. You
 * cannot own an unpainted Broken Fang Glove in game; cs2-lib synthesises the
 * base item and invents an image path Valve never shipped.
 *
 * So the picture has to come from the MODEL, which we now extract. Baked on the
 * card's own 404 rather than up front — this costs a GL context, and the only
 * items that need it are the handful that ask.
 *
 * Session-scoped on purpose. The server-side render store is keyed per owned
 * INSTANCE (`inst-<id>-…`) and these are catalog rows with no instance, so
 * persisting them needs a second store — worth doing if this ever covers more
 * than a few items, overkill for eight.
 */
const catalogArt = ref<Record<number, string>>({});
const catalogArtTried = new Set<number>();
async function bakeCatalogArt(skin: { id: number; name?: string; model?: string | null; type?: string | null; paintMaterial?: string | null }) {
  if (!skin?.id || catalogArtTried.has(skin.id) || catalogArt.value[skin.id]) return;
  catalogArtTried.add(skin.id);
  const target = await resolveViewerModel(skin);
  if (!target || !(await hasModel(target.model))) return;
  try {
    // Background lane and idle-gated, exactly like the card backfill: this is
    // never what the user is waiting on.
    await viewersIdle();
    const blob = await snapshotModel(
      target.model,
      { kind: target.kind, charmSpec: target.charm ?? null, paintMaterial: null, wear: 0, seed: 0 },
      undefined,
      true,
    );
    if (blob && blob !== INCOMPLETE) catalogArt.value = { ...catalogArt.value, [skin.id]: URL.createObjectURL(blob) };
  } catch {
    /* a missing picture is not worth an error surface — the card stays blank */
  }
}
function onCatalogArtError(e: Event, skin: { id: number; model?: string | null; type?: string | null }) {
  (e.target as HTMLImageElement).style.visibility = "hidden";
  void bakeCatalogArt(skin);
}
onBeforeUnmount(() => Object.values(catalogArt.value).forEach((u) => URL.revokeObjectURL(u)));

// ---- Attachment 3D preview --------------------------------------------------
/**
 * One attachment, on its own, in 3D — over whatever is already open.
 *
 * The craft modal shows a sticker or a charm as its flat inventory icon, which
 * for a sticker is not even the art the game draws (it is a 512x384 frame with
 * the ink inset) and for a charm is a photograph of a 3D object. Picking one
 * from a wall of those is guesswork, and the answer to "what does this actually
 * look like" was: add it to the gun, then hunt for it on the model.
 *
 * So this is deliberately a SMALL overlay rather than a route or a replacement
 * stage: it sits above the picker, the thing underneath keeps its state, and
 * dismissing it puts you back exactly where you were mid-decision.
 */
const preview3d = ref<{ image: string; name: string; kind: string } | null>(null);
const preview3dEl = ref<HTMLElement | null>(null);
const preview3dBusy = ref(false);
let preview3dHandle: ViewerHandle | null = null;
let preview3dAbort: AbortController | null = null;
let preview3dGen = 0;
function closePreview3d() {
  preview3dGen++;
  preview3dAbort?.abort();
  preview3dAbort = null;
  preview3dHandle?.dispose();
  preview3dHandle = null;
  preview3dBusy.value = false;
  preview3d.value = null;
}
/** Open the preview for any attachment-shaped thing (sticker, patch, charm). */
/** Picker kind -> cs2-lib type. The picker says "charm"; the economy calls it a
 *  "keychain", and the resolver switches on the economy's name. Without this the
 *  charm preview resolved to null and the panel opened on nothing. */
const ATTACH_TYPE: Record<string, string> = { sticker: "sticker", patch: "patch", charm: "keychain" };
async function openPreview3d(item: { image?: string | null; name?: string | null; type?: string | null }, kind: string) {
  if (!item?.image) return;
  // The picker's rows are `Skin`s from an attachment catalog, which carry no
  // `type` — the PICKER knows what it is asking for, so the kind comes from the
  // caller and the resolver is fed a synthetic item.
  const target = await resolveViewerModel({ type: item.type ?? ATTACH_TYPE[kind] ?? kind, image: item.image });
  if (!target) return;
  preview3d.value = { image: item.image, name: item.name ?? "", kind };
  preview3dBusy.value = true;
  const gen = ++preview3dGen;
  await nextTick();
  const host = preview3dEl.value;
  if (!host || gen !== preview3dGen) {
    preview3dBusy.value = false;
    return;
  }
  try {
    preview3dAbort?.abort();
    const ac = new AbortController();
    preview3dAbort = ac;
    const handle = await mountViewer(host, target.model, {
      signal: ac.signal,
      kind: target.kind,
      charmSpec: target.charm ?? null,
      decal: target.kind === "sticker" || target.kind === "patch" ? { image: item.image, wear: 0 } : null,
      frame: "fit",
      // Orbitable but not draggable: there is no weapon to place anything on,
      // and a slow turn is what shows a holo sticker or a charm's depth.
      interactive: false,
    });
    // Dismissed (or another attachment picked) while the GLB loaded.
    if (gen !== preview3dGen) {
      handle.dispose();
      return;
    }
    preview3dHandle = handle;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") mdebug("preview3d MOUNT failed", { e: String(e) });
    if (gen === preview3dGen) preview3d.value = null;
  } finally {
    if (gen === preview3dGen) preview3dBusy.value = false;
  }
}
// The craft modal closing (or the picker) must not leave a live context
// rendering into a detached node.
watch([craft, picker], () => {
  if (preview3d.value) closePreview3d();
});

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
function onCacheCleared(scope: "renders" | "composites") {
  // Composites are the shared paint textures, not the cards — binning them
  // costs each skin one re-composite and leaves every baked card still valid.
  // This ran for both scopes while the emit was typed as "renders" only, so
  // reclaiming composite disk also threw away every card in the session and
  // re-baked the lot. The type error hid it.
  if (scope !== "renders") return;
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
/**
 * The sliding indicator's transition. TRANSFORM ONLY — the `width 0.2s ease` that
 * used to ride along with it is gone on purpose.
 *
 * `transform` is composited: it keeps animating on its own thread even while the
 * main thread is busy. `width` is layout, so every frame of it is main-thread
 * work — and switching a tab is exactly when the main thread is busiest, rebuilding
 * the grid underneath. The width animation stalled there, which is why the pill
 * slid part way, hung, then snapped to the end. Width now applies instantly and
 * only the travel animates, so nothing the grid does can block it.
 */
const pillTransition = (animated: boolean) =>
  animated ? "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)" : "none";

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
const pickerGroupPill = makePill();
const sheetGroupPill = makePill();
function syncAllPills() {
  viewPill.sync(view.value);
  sheetPill.sync(sheetMode.value);
  teamPill.sync(team.value);
  invOriginPill.sync(invOrigin.value);
  modal3dPill.sync(modal3d.value ? "3D" : "2D");
  sheetOriginPill.sync(sheetOrigin.value);
  focus3dPill.sync(focus3d.value ? "3D" : "2D");
  sheetGroupPill.sync(sheetGroup.value);
}
// immediate: seeds the pill's active key before the modal ever opens, so the
// ResizeObserver's initial fire on mount can position the indicator itself.
watch(modal3d, () => nextTick(() => modal3dPill.sync(modal3d.value ? "3D" : "2D")), { immediate: true });
// Sheet pill also tracks things that change tab widths (owned count) or tab
// existence (Replace only on weapon slots).
watch([sheetMode, selected, () => inventory.value.length], () => nextTick(() => sheetPill.sync(sheetMode.value)));
watch([team, view], () => nextTick(syncAllPills));
// Same reason as the picker's group pill: the tab list arrives with the catalog
// and only exists for some of them, so the indicator has to follow the list as
// well as the selection.
watch([sheetGroup, sheetGroupTabs], () => nextTick(() => sheetGroupPill.sync(sheetGroup.value)), {
  immediate: true,
});

const linkOpening = ref(false);
// The handoff is silent by design (see openInspectLink) — nothing in the page
// changes and CS2 may take a while to surface, so without this the click reads
// as having done nothing.
function notifyInspectSent() {
  notify(
    tr("inventory.notify.inspect_sent", "Sent to your game client — CS2 will open the inspect view."),
    "success",
  );
}
// Hands a steam:// inspect link to the OS, which launches CS2 straight into
// the inspect view for this craft — stickers and all — without the item ever
// existing on Steam's backend. Nothing happens if Steam isn't installed to
// claim the protocol, so this stays a no-op rather than an error.
async function openInspectLink(id: number) {
  try {
    const { inspect } = await fetchInspectLink(id);
    window.location.href = inspect;
    linkOpening.value = true;
    notifyInspectSent();
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
/**
 * Teams this item is ALREADY equipped on, at the slot it would land in.
 *
 * Equipping is idempotent server-side, so re-equipping was harmless but
 * pointless: the menu offered "Equip on CT" for a skin already on CT, and
 * taking it spent a round trip and a loadout refresh to arrive back where you
 * started. Scoped to the target slot on purpose — the same instance can be on
 * CT in slot 1 and nowhere on T, and only slot 1 is settled.
 */
const itemCtxEquippedOn = computed<Set<Team>>(() => {
  const inst = itemCtx.value?.inst;
  const on = new Set<Team>();
  if (!inst) return on;
  const equipped = inst.equipped ?? [];
  // Inventory view has no target slot in mind — you opened a card, not a
  // loadout cell. So the question is just "is this item on that team", and
  // matching against positionForInstance's guess was the bug: it returns the
  // slot the item WOULD land in, which for a weapon already sitting in a
  // different slot of the same group is not the slot it is equipped at. The
  // row then read "Equip on CT" for a skin that was plainly on CT.
  if (view.value === "inventory") {
    equipped.forEach((e) => on.add(e.team));
    return on;
  }
  // In the loadout the slot IS the question — the same instance can be on CT
  // in one slot and absent from another, and only the selected one is settled.
  const pos = selected.value;
  if (pos) equipped.forEach((e) => e.slot === pos && on.add(e.team));
  return on;
});
/** Shared slots (knife, gloves, agent…) are one decision, not two — they're
 *  settled only when BOTH sides already carry this item. */
const itemCtxSharedEquipped = computed(
  () => itemCtxEquippedOn.value.has("CT") && itemCtxEquippedOn.value.has("T"),
);
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

// ---- swipe down to dismiss (compact bottom sheets) --------------------------
// Every compact menu already draws a grab pill, which promises a drag none of
// them honoured: the only way out was tapping the backdrop, and on a tall sheet
// that means reaching over the whole thing to the strip above it — one-handed,
// the hardest pixel on the screen to hit. This makes the pill's promise true.
//
// Shared drag state rather than one set per sheet: only one of these can be
// open at a time, and the sheet being dragged is the only one mounted.
const swipeOffset = ref(0);
/** Live transform for a sheet mid-swipe. No transition while the finger is
 *  down (it must track exactly), a spring back when it lifts without passing
 *  the threshold. */
const swipeStyle = computed(() =>
  swipeOffset.value
    ? { transform: `translateY(${swipeOffset.value}px)`, transition: "none" }
    : { transition: reducedMotion.value ? "none" : "transform 200ms cubic-bezier(0.22,1,0.36,1)" },
);
/**
 * Handlers for `v-on` on a sheet's grab area. Dismisses past a third of the
 * sheet's own height, or on a flick faster than 0.5px/ms — so a short sheet
 * needs a short drag and a tall one doesn't dismiss on a twitch.
 *
 * Capture is LAZY: taken only once the finger has actually travelled, never on
 * pointerdown. That is what lets the whole sheet header carry this without
 * swallowing taps on the controls inside it (the filter sheet's Reset button
 * sits in its header) — pointer capture retargets the click that follows, so
 * capturing eagerly would eat it.
 */
const SWIPE_ARM_PX = 4;
function swipeToDismiss(close: () => void) {
  let sheet: HTMLElement | null = null;
  let dragging = false;
  let y0 = 0;
  let t0 = 0;
  const reset = () => {
    sheet = null;
    dragging = false;
    swipeOffset.value = 0;
  };
  return {
    pointerdown(e: PointerEvent) {
      if (!isCompact.value) return;
      sheet = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-sheet]");
      dragging = false;
      y0 = e.clientY;
      t0 = e.timeStamp;
    },
    // Down only. Following a finger upwards would tear the sheet off the
    // bottom edge it is anchored to and show background under it.
    pointermove(e: PointerEvent) {
      if (!sheet) return;
      const dy = e.clientY - y0;
      if (!dragging) {
        if (dy < SWIPE_ARM_PX) return;
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      swipeOffset.value = Math.max(0, dy);
    },
    pointerup(e: PointerEvent) {
      if (!sheet || !dragging) return reset();
      const dy = Math.max(0, e.clientY - y0);
      const gone = dy > sheet.getBoundingClientRect().height / 3 || dy / Math.max(1, e.timeStamp - t0) > 0.5;
      reset();
      if (gone) close();
    },
    pointercancel: reset,
  };
}

// ---- long-press → the slot menu (touch has no right-click) ------------------
// Delegated from the loadout container instead of bound per-slot: every slot
// already carries data-slot for the drag/drop system, and there are five
// distinct slot markups that would each otherwise need the same four handlers.
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10; // movement past this is a scroll, not a press
let lpTimer: ReturnType<typeof setTimeout> | undefined;
let lpOrigin: { x: number; y: number } | null = null;
let lpFired = false;

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
// The three compact bottom sheets, each wired to its own dismiss. Declared
// here because the filter sheet's flag is — see swipeToDismiss above.
const slotMenuSwipe = swipeToDismiss(closeCtx);
const itemMenuSwipe = swipeToDismiss(closeItemCtx);
const filterSheetSwipe = swipeToDismiss(() => (sheetFiltersOpen.value = false));
// Search counts as an active filter on compact — it lives inside the sheet
// there, so without it in the badge a search you forgot about is invisible.
const sheetFilterCount = computed(
  () =>
    (activeRarity.value ? 1 : 0) +
    // The tab it opened on isn't a filter you set, so it isn't one to clear.
    (sheetGroup.value !== sheetDefaultGroup.value ? 1 : 0) +
    (sheetCollection.value ? 1 : 0) +
    (sheetTint.value ? 1 : 0) +
    (sheetOrigin.value !== "all" ? 1 : 0) +
    (sheetSort.value !== DEFAULT_SORT ? 1 : 0) +
    (sheetSearch.value.trim() ? 1 : 0),
);
// Live count behind the sheet's confirm button, so you can tell a filter
// combination returns nothing before dismissing the sheet to find out. Craft
// counts CARDS — that's what the grid puts on screen, and a stack is one card.
const sheetResultCount = computed(() =>
  sheetMode.value === "owned"
    ? ownedStacks.value.length
    : sheetMode.value === "craft"
      ? craftStacks.value.length
      : replaceOptions.value.defaults.length + replaceOptions.value.owned.length,
);
function resetSheetFilters() {
  sheetSearch.value = "";
  clearSheetFacets();
  sheetOrigin.value = "all";
  sheetSort.value = DEFAULT_SORT;
}

// ---- desktop: the lifting picker sheet --------------------------------------
// The picker used to be a fixed 34vh strip below the loadout. Browsing skins in
// it is cramped, and the only lever for more room — shrinking the loadout —
// reflows three column scrollers and squeezes every slot card down to its
// min-height.
//
// So on desktop the sheet comes OUT OF FLOW and floats over the loadout. The
// loadout half reserves the collapsed height as padding and then never moves
// again: lifting changes nothing but the sheet's own height, which also means
// the 3D canvas up there never gets resized by a lift. The cost is occlusion —
// the slot you're editing can end up underneath — and `revealSelectedSlot`
// below is what pays it off.
//
// Explicitly toggled, never automatic. An earlier build raised it on pointer-in
// and lowered it on pointer-out, which read as the panel deciding things on its
// own — a half-second of hesitation over the wrong pixel resized the screen.
//
// Compact keeps its drag-to-snap sheet; none of this applies there.
const SHEET_COLLAPSED_MIN = 210; // was min-h-[210px]
const SHEET_COLLAPSED_VH = 34; // was h-[34vh]
const SHEET_LIFT_PCT = 60; // of the loadout column, NOT of the viewport
const SHEET_LIFT_MS = 240; // height transition; the reveal below waits it out
// A little more scroll range than the sheet actually covers, so the LAST slot
// in a column can sit clear of its top edge instead of flush against it.
const LIFT_SPACER_PAD = 12;
const SHEET_COLLAPSED_CSS = `max(${SHEET_COLLAPSED_MIN}px, ${SHEET_COLLAPSED_VH}vh)`;

const sheetLift = ref(localStorage.getItem("cs2inv.sheetLift") === "1");
watch(sheetLift, (v) => localStorage.setItem("cs2inv.sheetLift", v ? "1" : "0"));

// The sheet only floats on desktop, and only when it's on screen at all — the
// 3D viewer route replaces it entirely (`v-if="!viewerId"`), and reserving
// space for a sheet that isn't rendered would leave a dead strip.
const canLift = computed(() => !isCompact.value && !viewerId.value);

// Tap-to-equip is a desktop affordance: it leans on hover to preview what the
// click will do and on a cursor-precise target. On touch a tap opens the action
// menu instead — whose Equip rows are the same one tap anyway, but named.
// Keyed off compact as well as coarse because a narrowed desktop window is
// exactly where the phone layout gets tested, and there a stray tap silently
// re-equipped the slot with no menu and no undo.
const tapOpensMenu = computed(() => isCoarse.value || isCompact.value);
const lifted = computed(() => canLift.value && sheetLift.value);

const loadoutEl = ref<HTMLElement | null>(null);
const loadoutH = ref(0);
const viewportH = ref(typeof window === "undefined" ? 0 : window.innerHeight);
// Collapsed height stays viewport-derived (that's what 34vh meant) while the
// lifted one is a fraction of the loadout column, so CSS can resolve both on
// its own. Only their DIFFERENCE has to be a real number here, because that's
// how far the sheet reaches over the loadout — the band the slot columns have
// to be able to scroll out from under.
const collapsedPx = computed(() => Math.max(SHEET_COLLAPSED_MIN, (SHEET_COLLAPSED_VH / 100) * viewportH.value));
const liftIntrusion = computed(() =>
  lifted.value ? Math.max(0, Math.round((loadoutH.value * SHEET_LIFT_PCT) / 100 - collapsedPx.value)) : 0,
);

// Reserved on the loadout side so the collapsed layout is exactly what it was
// when the sheet still took its space in flow.
// Compact reserves the PEEK height as a constant. The sheet is out of flow so
// it can be transform-driven (see sheetStyle), which means without this the
// loadout's last row would sit permanently under the collapsed sheet. A
// constant, deliberately — anything snap-dependent would relayout the loadout
// mid-animation and reintroduce exactly the jank the transform is avoiding.
const loadoutPadStyle = computed(() =>
  isCompact.value
    ? { paddingBottom: `${Math.round(sheetPeekPx.value || loadoutH.value * PEEK_FRAC)}px` }
    : canLift.value
      ? { paddingBottom: SHEET_COLLAPSED_CSS }
      : {},
);
// Every loadout scroller gets the same pair: a spacer in the template gives it
// somewhere to scroll TO, and scroll-padding keeps browser-driven scrolls (tab
// focus, mostly) from landing under the sheet.
const liftScrollStyle = computed(() => (liftIntrusion.value ? { scrollPaddingBottom: `${liftIntrusion.value}px` } : {}));

// The whole point of the reserve above: with the sheet lifted, the slot being
// edited has to stay visible in the strip that's left. Every loadout scroller
// carries a spacer exactly `liftIntrusion` tall while lifted, so there is
// always a scroll position that clears the sheet.
async function revealSelectedSlot(smooth = true) {
  if (!lifted.value || view.value !== "grid") return;
  await nextTick(); // the spacer has to be in the DOM before there's anywhere to go
  const el = loadoutEl.value?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(selected.value)}"]`);
  if (!el) return;
  const inset = liftIntrusion.value;
  // Two passes, and the second is the one that's actually load-bearing. A
  // scroll issued while the sheet is still animating its own height lands
  // short — measured ~50px shy — and on the toggle-up that starts it the
  // scroller may not even have the range yet, making the first pass a silent
  // no-op. The settle pass runs once the transition is over and is itself a
  // no-op whenever the first one already arrived.
  revealInScroller(el, inset, smooth && !reducedMotion.value);
  clearTimeout(revealSettleTimer);
  revealSettleTimer = setTimeout(() => revealInScroller(el, inset, false), SHEET_LIFT_MS + 80);
}
let revealSettleTimer: ReturnType<typeof setTimeout> | undefined;
// liftIntrusion is in here for the resize case: the free strip changes size and
// what used to be visible may not be any more.
watch([lifted, selected, liftIntrusion], () => void revealSelectedSlot());

let loadoutRO: ResizeObserver | null = null;
// The loadout column mounts and unmounts with the view swap, so the observer
// follows the ref rather than being set up once. It also stands in for a
// window resize listener — this element is sized off the viewport, so anything
// that changes the viewport changes it.
watch(loadoutEl, (el) => {
  loadoutRO?.disconnect();
  loadoutRO = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  loadoutH.value = el.clientHeight;
  loadoutRO = new ResizeObserver(() => {
    loadoutH.value = el.clientHeight;
    viewportH.value = window.innerHeight;
  });
  loadoutRO.observe(el);
});

// The default snap reserves exactly two rows of slot cards — four skins — and
// the fifth scrolls. Expressed as a PIXEL reserve, not a screen fraction: a
// fraction that shows two rows on a 800px phone shows four on a 1180px one,
// and the cap is the point.
const COMPACT_CARD_H = 118; // slot card min-height
const COMPACT_GRID_GAP = 8; // grid gap-2
const COMPACT_GRID_PAD = 28; // pt-3 + pb-4
const COMPACT_RAIL_H = 34; // category rail, measured (min-h-[30px] + py-0.5)
const HALF_RESERVE = 2 * COMPACT_CARD_H + COMPACT_GRID_GAP + COMPACT_GRID_PAD + COMPACT_RAIL_H;
const PEEK_FRAC = 0.22;
const FULL_FRAC = 0.86;
// Floor for `half` so a short/landscape phone can't hand the whole screen to
// the loadout and leave the picker a sliver.
const HALF_MIN_FRAC = 0.3;

/**
 * The compact picker is a NATIVE-STYLE bottom sheet: it is always full height
 * and every detent is a `translateY`. Nothing about the drag touches layout.
 *
 * It used to animate `height` directly, which meant each of the ~60 frames of a
 * drag relaid out the flex column, the loadout grid above it AND the item grid
 * inside it. That is the jerk — a drag that visibly stepped rather than
 * tracked. Transform is compositor-only, so the sheet now follows the finger at
 * refresh rate however much is in the grid.
 *
 * The cost is that the sheet must be out of flow (it is `absolute`, same as
 * desktop) and the loadout has to reserve the peek height as padding so its
 * last row never sits permanently underneath. That reserve is a constant, so it
 * never animates.
 */
// `peek` is the FLOOR, not a way station — a swipe down minimises the sheet,
// it never dismisses it. Collapsing to nothing meant the only route back was
// tapping a slot, which is a rule you have to already know; leaving the header
// on screen keeps the picker's own handle as the way back in. The loadout
// reserves exactly this height (loadoutPadStyle), so a minimised sheet covers
// nothing.
type SheetSnap = "peek" | "half" | "full";
/** Detents low→high. Order is load-bearing: flicks step through this array. */
const SHEET_DETENTS: SheetSnap[] = ["peek", "half", "full"];
/**
 * Minimised height: MEASURED, as exactly the grab handle plus the mode/filter
 * row — no tally, no clipped first row of cards.
 *
 * It was a fraction of the viewport, which meant the strip landed wherever the
 * arithmetic put it: a sliver of grid on a tall phone, half the tally bar on a
 * short one. Neither is a state worth having. Minimised should show the
 * controls that switch what the sheet is showing and nothing else — you either
 * want the tabs or you want the list.
 */
const sheetPeekPx = ref(0);
let peekRO: ResizeObserver | null = null;
/** Function ref on the wrapper holding grab handle + toolbar — its own
 *  `offsetHeight` IS the minimised height. Deliberately not `offsetTop +
 *  offsetHeight` of the toolbar alone: that depends on which ancestor happens
 *  to be the offsetParent, and read a frame too early it returns 0, which
 *  silently fell back to the old viewport fraction and left a band of dead
 *  space under the tabs. A wrapper's own height has neither failure mode. */
function setSheetPeekEl(el: unknown) {
  peekRO?.disconnect();
  peekRO = null;
  const node = el as HTMLElement | null;
  if (!node) return;
  const measure = () => {
    const h = node.offsetHeight;
    if (h > 0) sheetPeekPx.value = h;
  };
  measure();
  if (typeof ResizeObserver === "undefined") return;
  // The toolbar wraps to a second row at narrow widths and when the filter
  // chip gains its badge, so its height is not a constant. The observer also
  // covers the mount-time 0 above — it fires once on observe.
  peekRO = new ResizeObserver(measure);
  peekRO.observe(node);
}
/** Visible height of a detent, in px. */
function snapPx(s: SheetSnap, hostH: number): number {
  // Fraction only as a fallback for the frame before the toolbar is measured.
  if (s === "peek") return sheetPeekPx.value || hostH * PEEK_FRAC;
  if (s === "full") return hostH * FULL_FRAC;
  return Math.max(hostH * HALF_MIN_FRAC, hostH - HALF_RESERVE);
}
// iOS's sheet curve: leaves fast, arrives slow, no overshoot. A spring here
// reads as bounce on a panel this size.
const SHEET_EASE = "cubic-bezier(0.32,0.72,0,1)";
const SHEET_SNAP_MS = 340;
/** px/ms past which a gesture is a flick (step a detent) rather than a drag
 *  (settle at the nearest). Roughly a deliberate flick of the thumb. */
const FLICK_V = 0.45;
/** …and past which it is a hard throw that goes straight to the end. */
const THROW_V = 1.1;

const sheetSnap = ref<SheetSnap>("half");
/** Live translateY mid-drag; null means "resting at sheetSnap". */
const sheetDragPx = ref<number | null>(null);
const sheetFullPx = computed(() => Math.round(loadoutH.value * FULL_FRAC));
/** How far the sheet is pushed down from fully open. 0 = full, sheetFullPx = gone. */
const sheetTranslate = computed(() =>
  sheetDragPx.value != null
    ? sheetDragPx.value
    : Math.max(0, sheetFullPx.value - snapPx(sheetSnap.value, loadoutH.value)),
);

const sheetStyle = computed(() => {
  if (!isCompact.value) {
    // Desktop: absolutely positioned, so the height IS the whole interaction.
    // The percentage resolves against the loadout column, which is what makes
    // "60% of the loadout area" mean that on every screen.
    return {
      height: lifted.value ? `${SHEET_LIFT_PCT}%` : SHEET_COLLAPSED_CSS,
      transition: reducedMotion.value ? "none" : `height ${SHEET_LIFT_MS}ms cubic-bezier(0.22,1,0.36,1)`,
      // Reads as a layer above the loadout rather than a taller panel.
      boxShadow: lifted.value ? "0 -18px 40px -22px hsl(var(--background))" : "none",
    };
  }
  return {
    height: `${sheetFullPx.value}px`,
    // translate3d, not translateY: it promotes the sheet to its own layer, so
    // the grid inside is rasterised once and the drag is a matrix update.
    transform: `translate3d(0, ${sheetTranslate.value}px, 0)`,
    // No transition mid-drag — it must track the finger exactly, not chase it.
    transition:
      sheetDragPx.value != null || reducedMotion.value ? "none" : `transform ${SHEET_SNAP_MS}ms ${SHEET_EASE}`,
    boxShadow: "0 -18px 40px -22px hsl(var(--background))",
  };
});

// The sheet is out of flow now, so on compact it OVERLAYS whatever is behind
// it rather than sharing the column. In the grid that's the point; in focus
// view the thing behind it is the 3D stage, and arriving there still at `full`
// from the grid would bury it. Collapse to peek on the way in — the stage
// already reserves that much padding, so nothing ends up hidden.
watch(view, (v) => {
  if (isCompact.value && v === "focus" && sheetSnap.value === "full") sheetSnap.value = "peek";
});

// Switching Owned/Craft/Replace is a statement of intent to browse that list —
// same as tapping a slot. It used to leave the sheet at whatever detent it was
// on, so picking "Craft" from a minimised sheet swapped the contents of a strip
// you couldn't see into and looked like the tab had done nothing. Every mode
// change opens it. This also covers the programmatic switches (a replace
// dropping you back on Owned, the slot menu's Pick/Craft/Replace rows), which
// are intent to browse just as much as a tab tap is.
watch(sheetMode, () => {
  if (isCompact.value && view.value === "grid") sheetSnap.value = "full";
});

/** Bound to the sheet header via `v-on`. Empty on desktop, which drags by
 *  lifting the whole panel with a button instead. */
const sheetHeaderDrag = computed(() =>
  isCompact.value
    ? {
        pointerdown: onSheetDragStart,
        pointermove: onSheetDragMove,
        pointerup: onSheetDragEnd,
        pointercancel: onSheetDragEnd,
      }
    : {},
);

/** Detent whose height sits closest to a given visible height. */
function nearestSnap(visiblePx: number): SheetSnap {
  const d = (s: SheetSnap) => Math.abs(snapPx(s, loadoutH.value) - visiblePx);
  return SHEET_DETENTS.reduce((best, s) => (d(s) < d(best) ? s : best), SHEET_DETENTS[0]);
}

// Capture is taken lazily (see SWIPE_ARM_PX) so the toolbar buttons sharing
// this drag surface keep their taps — pointer capture retargets the click.
let sheetDrag: {
  y0: number;
  base: number;
  lastY: number;
  lastT: number;
  vy: number;
  moved: boolean;
  captured: boolean;
  /** The gesture started on a control (a mode tab, the filter chip), so a tap
   *  belongs to that control and must not also toggle the sheet. A DRAG from
   *  the same spot is still a drag — you can swipe starting anywhere. */
  onControl: boolean;
} | null = null;

function onSheetDragStart(e: PointerEvent) {
  if (!isCompact.value) return;
  sheetDrag = {
    y0: e.clientY,
    base: sheetTranslate.value,
    lastY: e.clientY,
    lastT: e.timeStamp,
    vy: 0,
    moved: false,
    captured: false,
    onControl: !!(e.target as HTMLElement | null)?.closest?.("button, a, input, select, label"),
  };
}
function onSheetDragMove(e: PointerEvent) {
  if (!sheetDrag) return;
  const dy = e.clientY - sheetDrag.y0;
  if (!sheetDrag.moved) {
    if (Math.abs(dy) < SWIPE_ARM_PX) return;
    sheetDrag.moved = true;
    sheetDrag.captured = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  // Velocity as an EMA over the recent frames, so one stuttery frame at the
  // moment of release can't decide the whole gesture.
  const dt = e.timeStamp - sheetDrag.lastT;
  if (dt > 0) {
    sheetDrag.vy = 0.7 * ((e.clientY - sheetDrag.lastY) / dt) + 0.3 * sheetDrag.vy;
    sheetDrag.lastY = e.clientY;
    sheetDrag.lastT = e.timeStamp;
  }
  // Rubber band at BOTH ends — fully open at the top, minimised at the bottom.
  // The sheet resists instead of stopping dead, which is what tells a finger it
  // has hit the end of the track rather than that the drag broke. Without the
  // lower band a hard swipe drags the header clean off the screen and then
  // springs it back, which reads as the sheet having closed and reopened.
  const minimised = sheetFullPx.value - snapPx("peek", loadoutH.value);
  let next = sheetDrag.base + dy;
  if (next < 0) next = next / 3;
  else if (next > minimised) next = minimised + (next - minimised) / 3;
  sheetDragPx.value = next;
}
function onSheetDragEnd() {
  if (!sheetDrag) return;
  const { moved, vy, onControl } = sheetDrag;
  const at = sheetDragPx.value ?? 0;
  sheetDrag = null;
  sheetDragPx.value = null;
  // A tap (no travel) toggles minimised ↔ open, for people who don't think to
  // drag — and because minimised deliberately shows nothing but the tabs, so
  // tapping the strip is the obvious way to ask for the list back.
  //
  // Skipped when the tap landed on a control: the whole header is the drag
  // surface now, so without this, tapping "Craft" would switch the mode AND
  // collapse the sheet out from under the list it just loaded.
  if (!moved) {
    if (!onControl) sheetSnap.value = sheetSnap.value === "peek" ? "full" : "peek";
    return;
  }
  const landed = nearestSnap(sheetFullPx.value - at);
  const i = SHEET_DETENTS.indexOf(landed);
  // A throw goes all the way; a flick steps one detent; anything slower just
  // settles where you left it. Without this a slow drag and a fast swipe did
  // exactly the same thing, which is why a big swipe never dismissed.
  if (vy > THROW_V) sheetSnap.value = "peek";
  else if (vy < -THROW_V) sheetSnap.value = "full";
  else if (vy > FLICK_V) sheetSnap.value = SHEET_DETENTS[Math.max(0, i - 1)];
  else if (vy < -FLICK_V) sheetSnap.value = SHEET_DETENTS[Math.min(SHEET_DETENTS.length - 1, i + 1)];
  else sheetSnap.value = landed;
}

// Same adjustable card size as the Inventory grid. The default is roomier
// than the old fixed 164/132 — tiles now carry a model header + team dots, and
// the art needs air under the type line. Compact clamps the floor so a phone
// still fits two columns.
const sheetCardSize = ref(Number(localStorage.getItem("cs2inv.sheetCardSize")) || 176);
watch(sheetCardSize, (v) => localStorage.setItem("cs2inv.sheetCardSize", String(v)));

// ---- compact: rows for picking, cards for browsing --------------------------
// Compact used to reuse the desktop card at a 168px clamp. With CARD_CHROME_PX
// under it that's a 246px row, and the sheet at its `half` snap only has about
// 210px of scroller — so not one full row fit, and the two visible cards sat
// clipped by the viewport edge with nothing to say a third existed.
//
// Owned/Replace are LISTS you pick from: a row shows the whole name, and six
// fit where two did. Craft is a gallery you browse — a finish is a picture, so
// it stays a grid, just at a phone-sized tile with a phone-sized chrome (the
// craft card is art + one name line, nowhere near the 78px a full item card
// needs for its header, attachments and wear bar).
// Budget: 44px thumb vs a text column of model line (12) + name (16) + gap (4)
// + inline wear bar (~12) = 44, whichever is taller, plus py-2 top and bottom.
// 66 leaves a couple of pixels of slack without letting a row go slack-jawed.
const COMPACT_ROW_H = 66;
const COMPACT_CRAFT_TILE = 108;
const COMPACT_CRAFT_CHROME = 56;
/** Rows, not cards. Compact + a mode you pick from rather than browse. */
const sheetRows = computed(() => isCompact.value && sheetMode.value !== "craft");
const pickerGridStyle = computed(() => {
  if (sheetRows.value) {
    return { display: "grid", gridTemplateColumns: "1fr", gridAutoRows: `${COMPACT_ROW_H}px` };
  }
  const tile = isCompact.value ? COMPACT_CRAFT_TILE : sheetCardSize.value;
  const chrome = isCompact.value ? COMPACT_CRAFT_CHROME : CARD_CHROME_PX;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))`,
    gridAutoRows: `${tile + chrome}px`,
  };
});

// The picker holds entries that aren't ItemTiles — the craft prompt, the stock
// default, the Replace candidates. They have to follow the same card/row switch
// or they stay card-shaped inside a 74px grid row and squash.
const SHEET_ENTRY = computed(() =>
  sheetRows.value ? "flex w-full items-center gap-3 px-2.5 py-2" : "flex h-full flex-col px-2.5 py-2.5",
);
const SHEET_ART = computed(() =>
  sheetRows.value ? "grid h-11 w-14 flex-none place-items-center rounded bg-background/40" : CARD_ART,
);
// ...and their LABEL has to flip with them. `flex-1` on the caption is right in
// the row layout (it takes the width left over beside the thumb) and actively
// wrong in the card layout, where the same class makes the caption claim an
// equal share of the COLUMN — it split every default card 50/50 and left the
// art half-height, so a stock M4A4 drew ~35% smaller than the crafted M4A4
// next to it and read as broken art rather than as a deliberate "no skin".
const SHEET_LABEL = computed(() => (sheetRows.value ? "min-w-0 flex-1" : "min-w-0 w-full flex-none"));

// ---- "there is more below" --------------------------------------------------
// The picker is a short scroller inside a sheet inside a page; none of the
// usual cues (a scrollbar, the page continuing past the fold) are available on
// a phone. So it says so: a live count in the header, and a fade over the
// bottom edge that clears once you've reached the end.
const sheetHasMore = ref(false);
function measureSheetScroll(el: HTMLElement | null) {
  if (!el) return void (sheetHasMore.value = false);
  // The compact sheet is always full height and pushed down by a transform, so
  // at any detent below `full` part of the scroller is off the bottom of the
  // screen. That hidden strip is content below the fold too — count it, or the
  // tally claims you've seen everything while a whole detent's worth is
  // sitting under the edge.
  const offscreen = isCompact.value ? sheetTranslate.value : 0;
  sheetHasMore.value = el.scrollHeight - el.scrollTop - el.clientHeight + offscreen > 8;
}
// Same per-frame coalescing as scrollFade, and for the same reason: the three
// reads in measureSheetScroll are layout reads on a scroller that can fire
// several events per paint.
let sheetScrollPending = false;
const onSheetScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  if (sheetScrollPending) return;
  sheetScrollPending = true;
  requestAnimationFrame(() => {
    sheetScrollPending = false;
    measureSheetScroll(el);
  });
};
// Function ref rather than a plain one: the scroller is keyed on
// mode|weapon inside an out-in Transition, so it is destroyed and rebuilt on
// every mode switch and a static ref would go stale. Measured on the next frame
// because the grid's children mount after the container does.
let sheetScrollEl: HTMLElement | null = null;
function setSheetScrollEl(el: unknown) {
  sheetScrollEl = (el as HTMLElement) ?? null;
  if (sheetScrollEl) requestAnimationFrame(() => measureSheetScroll(sheetScrollEl));
  else sheetHasMore.value = false;
}
// A settled search term means a new list, so the panel goes back to the top.
// Lives HERE, beside sheetScrollEl, not next to the debounce that produces the
// term: a watcher reading a `let` declared 3,000 lines below it works only because
// the callback is deferred, and that is not a property to build on.
watch(sheetSearchApplied, () => scrollPanelToTop(sheetScrollEl));
// Opening a colour stack replaces the grid under a scroll position that meant
// something in the OLD list — open one from the bottom of 93 stacks and the
// nineteen colours land above the fold, off screen. Go to the top for the new
// list, and put the old position back on the way out so leaving a stack doesn't
// also lose your place in the grid you opened it from.
let stackReturnScroll = 0;
watch(sheetDesign, (design, prev) => {
  if (design !== null && prev === null) stackReturnScroll = sheetScrollEl?.scrollTop ?? 0;
  const to = design === null ? stackReturnScroll : 0;
  // After the new cards render, or the scroller is still the height of the old
  // list and clamps the restore.
  requestAnimationFrame(() => sheetScrollEl?.scrollTo({ top: to }));
});
// The window grows as you scroll (InfiniteSentinel) and shrinks as you filter;
// both change whether there's more below without any scroll event firing.
watch(
  [
    () => sheetResultCount.value,
    () => ownedWindow.items.value.length,
    () => craftWindow.items.value.length,
    sheetSnap,
    sheetTranslate,
  ],
  () => requestAnimationFrame(() => measureSheetScroll(sheetScrollEl)),
);
/**
 * The same cue for any ORDINARY scroller — the picker sheet keeps its own
 * (measureSheetScroll) because part of its box deliberately hangs off the
 * bottom of the screen, which nothing else does.
 *
 * `remeasure` exists because the two things that change "is there more below"
 * on these grids — the render window growing as you scroll, and the filter set
 * shrinking — neither of them fires a scroll event.
 */
function scrollFade() {
  const more = ref(false);
  let el: HTMLElement | null = null;
  const measure = () => (more.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  // Coalesced to one measurement per frame. `scrollHeight`/`clientHeight` are
  // layout reads, and a scroll event can fire many times between paints — on a
  // long inventory grid that is a forced reflow per event for a boolean that
  // can only change once per frame anyway.
  let pending = false;
  const measureSoon = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      measure();
    });
  };
  return {
    more,
    onScroll: (e: Event) => {
      el = e.target as HTMLElement;
      measureSoon();
    },
    /**
     * Function ref for the WRAPPER, which then finds the scroller inside it by
     * `data-scroller`. Indirect on purpose: the inventory grid is a
     * <TransitionGroup>, and a ref on that hands back the component instance,
     * not the element that actually scrolls.
     */
    setHost: (node: unknown) => {
      el = (node as HTMLElement | null)?.querySelector<HTMLElement>("[data-scroller]") ?? null;
      if (el) requestAnimationFrame(measure);
      else more.value = false;
    },
    remeasure: () => requestAnimationFrame(measure),
    /** Back to the top, for when the LIST is replaced rather than appended —
     *  see scrollPanelToTop. The scroller is already resolved here, so callers
     *  don't have to find it a second way. */
    toTop: () => {
      scrollPanelToTop(el);
      requestAnimationFrame(measure);
    },
  };
}
const invFade = scrollFade();
/**
 * The cell's place in the entrance cascade (`--i`, read by animate-cell-in).
 *
 * The CLASS is not applied per item any more — TransitionGroup owns it, via
 * `appear-active-class` and `enter-active-class`. That matters twice over.
 * TransitionGroup does not animate the initial render at all unless told to
 * `appear`, which is why the first paint used to arrive with no transition; and a
 * class Vue adds is a class Vue REMOVES when the animation ends, so a card stops
 * carrying a spent `animation-delay` around. That leftover delay was what made
 * Vue retire leaving cards one at a time, in index order (see .inv-leave).
 *
 * Only the first window gets a stagger. cs2CellIn is `both`-filled, so a delayed
 * cell sits at opacity 0 while the grid has already grown to fit it — the arrival
 * wave, and equally the scroll jitter if it lands on rows appended under the fold.
 * Past the first window the delay is 0: those cards still fade, they just do it
 * immediately, because nothing about them needs announcing.
 */
const invCellDelay = (i: number) => (i < WINDOW_FIRST ? i : 0);
/** Same rule for the sheet's two windowed grids (owned, craft), whose cascade is
 *  `animate-sheet-in`. Both are infinite-scrolled, and both were staggering every
 *  appended row — the `sheet-settled` gate only covers the options column. */
const sheetCellClass = (i: number) => (i < WINDOW_FIRST ? "animate-sheet-in" : "");
// The watch on the list lengths lives down beside inventoryWindow, NOT here —
// see the note there. cardSize is watched separately too, where it's declared:
// it changes row heights, so it changes whether there's more below.

// Selecting a slot from anywhere else (focus rail, a menu action, equipping)
// pulls the rail to the category that actually contains it — otherwise the
// selection highlight lands on a card the user can't see.
watch(selected, (pos) => {
  const c = catOfPos(pos);
  if (c !== compactCat.value) compactCat.value = c;
  // Picking a slot is a statement of intent to change it — surface the picker
  // if it was collapsed. Never shrink an already-open sheet.
  //
  // Compact goes all the way to `full` rather than `half`: `half` reserves
  // HALF_RESERVE (315px) for the loadout behind it, which on a phone leaves the
  // picker too short to show even one card row. The slot you just tapped is
  // named in the sheet's own header, so the loadout underneath has nothing left
  // to tell you — and the grab handle drops back to it in one gesture.
  //
  // Grid view only. In focus view the thing behind the sheet is the 3D stage,
  // which IS the screen — burying it to show a picker inverts the mode.
  if (isCompact.value && view.value === "grid") sheetSnap.value = "full";
  else if (sheetSnap.value === "peek") sheetSnap.value = "half";
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
/**
 * What the GRID filters by, a beat behind what the box holds.
 *
 * The input stays on `invSearch` so typing is never laggy, but the filter runs on
 * this. Typing "p90" against a live filter renders three different inventories —
 * "p", "p9", "p90" — and because the grid animates its reflow (`inv-move`, 280ms)
 * you watch every weapon you own slide to a new home twice on the way to the
 * answer, with the animations overlapping. Only the end state is interesting.
 *
 * Clearing is NOT debounced: emptying the box is a decision, not a keystroke on
 * the way to one, and it should snap back instantly. Same reason the picker
 * debounces its own search (see pickerTimer) — this is that treatment, which was
 * missing here.
 */
const invSearchApplied = ref("");
let invSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(invSearch, (v) => {
  clearTimeout(invSearchTimer);
  if (!v.trim()) {
    invSearchApplied.value = "";
    return;
  }
  invSearchTimer = setTimeout(() => (invSearchApplied.value = v), SEARCH_DEBOUNCE_MS);
});
onBeforeUnmount(() => clearTimeout(invSearchTimer));
watch(invSearchApplied, () => invFade.toTop());
// Synced (steam) vs crafted filter + adjustable card size (persisted).
const invOrigin = ref<OriginFilter>("all");
// Multi-select, not one-of: toggling is the whole point of the rail, and
// "show me my AKs AND my AWPs" is a question people actually have. An item
// shows if it matches ANY active toggle; nothing active means everything.
const invModels = ref<string[]>([]); // specific weapon models, e.g. "ak47"
const invTypes = ref<string[]>([]); // whole categories, e.g. "rifle" or "sticker"
// Both replace the grid's contents (the render window resets with the filter),
// so both send it back to the top — the old offset can easily be past the end of
// the new, shorter list.
function toggleModel(m: string) {
  invModels.value = invModels.value.includes(m)
    ? invModels.value.filter((x) => x !== m)
    : [...invModels.value, m];
  invFade.toTop();
}
function toggleType(t: string) {
  invTypes.value = invTypes.value.includes(t)
    ? invTypes.value.filter((x) => x !== t)
    : [...invTypes.value, t];
  invFade.toTop();
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
  const q = invSearchApplied.value.trim().toLowerCase();
  return inventory.value.filter(
    (i) => (!q || itemName(i.item).toLowerCase().includes(q)) && matchesOrigin(i, invOrigin.value),
  );
});
/**
 * The rail's ROWS come from the whole inventory; only its COUNTS come from the
 * filtered set.
 *
 * Both used to come from `railBase`, so a search that matched nothing emptied the
 * maps and the entire left-hand weapon selection disappeared — the layout
 * restructured itself at the exact moment you needed a way back, and the rail
 * reflowed on every keystroke as groups dropped in and out. What you own does not
 * change when you type; only how much of it currently matches does.
 *
 * So a row with `count: 0` is still drawn, disabled (see the template). Nothing
 * about the rail's SHAPE depends on the filters any more.
 */
const invRail = computed(() => {
  type RailModel = { model: string; name: string; image: string | null; count: number; cat: string };
  const models = new Map<string, RailModel>();
  const types = new Map<string, number>();
  // Pass 1 — the shape, from everything owned. Counts start at zero.
  for (const i of inventory.value) {
    const cat = categoryOf(i);
    if (!types.has(cat)) types.set(cat, 0);
    const m = i.item?.model;
    if (!m || !WEAPONISH.has(cat) || models.has(m)) continue;
    const base = weapons.value.find((w) => w.model === m);
    models.set(m, {
      model: m,
      name: base?.name ?? prettyModel(m),
      // The vanilla silhouette, not the first skin that happens to be owned —
      // a filter tile should say "AK-47", not "AK-47 | Redline".
      image: base?.image ?? i.item?.image ?? null,
      count: 0,
      cat,
    });
  }
  // Pass 2 — the counts, from what the search and origin filters left.
  for (const i of railBase.value) {
    const cat = categoryOf(i);
    types.set(cat, (types.get(cat) ?? 0) + 1);
    const m = i.item?.model;
    const hit = m ? models.get(m) : undefined;
    if (hit) hit.count++;
  }
  return {
    // A group with no OWNED items is still dropped — the rail is a picture of
    // what you own, and that is a fact about the inventory, not about the query.
    weapons: WEAPON_GROUPS.map(([key, label]) => ({
      key,
      label,
      count: types.get(key) ?? 0,
      items: [...models.values()].filter((e) => e.cat === key).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.items.length),
    gear: GEAR_TYPES.map(([key, label]) => ({ key, label, count: types.get(key) ?? 0 })).filter((r) =>
      types.has(r.key),
    ),
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
  clearTimeout(invSearchTimer);
  invSearchApplied.value = "";
  invSearch.value = "";
  invOrigin.value = "all";
  invRarity.value = "";
  invModels.value = [];
  invTypes.value = [];
}
// ---- compact: the inventory filter sheet ------------------------------------
// Same treatment the picker got. The desktop toolbar is a search field, an
// origin pill, two dropdowns and a sort-direction toggle on one line — it needs
// ~600px and a phone has ~376, so it scrolled sideways with most of the
// controls off the edge. The rail carrying the type/model facets is `lg:` only,
// so on a phone those were not reachable at ALL. One chip, one sheet, every
// filter in it.
const invFiltersOpen = ref(false);
// Sort counts here where it doesn't on the desktop toolbar: down there the
// dropdown shows its own state, in a closed sheet nothing does.
const invFilterCount = computed(
  () =>
    (invSearch.value.trim() ? 1 : 0) +
    (invOrigin.value !== "all" ? 1 : 0) +
    (invRarity.value ? 1 : 0) +
    (invSort.value !== DEFAULT_SORT ? 1 : 0) +
    invModels.value.length +
    invTypes.value.length,
);
function resetInvFilters() {
  clearInvFilters();
  invSort.value = DEFAULT_SORT;
  invDir.value = loadDir("inv", DEFAULT_SORT);
}
const invFilterSheetSwipe = swipeToDismiss(() => (invFiltersOpen.value = false));
watch(invOrigin, () => nextTick(() => invOriginPill.sync(invOrigin.value)));
// ---- how tall are we, really ------------------------------------------------
// The app's height is `100dvh - 6rem`, where 6rem is an ASSUMPTION about the
// host chrome above us (breadcrumb + page padding). It holds on desktop. On a
// phone the host header is shorter, so we subtract more than we should and the
// app stops short of the bottom — a dead band under the picker sheet that no
// amount of padding-hunting inside the plugin can explain, because it isn't
// inside the plugin.
//
// So measure where we actually begin. Read after paint, and sanity-checked
// against a runaway value: if the number looks wrong we keep the 6rem guess
// rather than rendering an app taller than the window.
const appRootEl = ref<HTMLElement | null>(null);
const appTopPx = ref(0);
function measureAppTop() {
  const el = appRootEl.value;
  if (!el) return;
  const top = Math.round(el.getBoundingClientRect().top);
  appTopPx.value = top >= 0 && top < window.innerHeight * 0.5 ? top : 0;
}
onMounted(() => {
  requestAnimationFrame(measureAppTop);
  window.addEventListener("resize", measureAppTop);
});
onBeforeUnmount(() => window.removeEventListener("resize", measureAppTop));
/** Compact only: desktop's 6rem is correct there and well tested. */
const appHeightStyle = computed(() =>
  isCompact.value && !embedMode.value && appTopPx.value > 0
    ? { height: `calc(100dvh - ${appTopPx.value}px)` }
    : {},
);

const cardSize = ref(Number(localStorage.getItem("cs2inv.cardSize")) || 164);
watch(cardSize, (v) => {
  localStorage.setItem("cs2inv.cardSize", String(v));
  invFade.remeasure();
});
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
    if (q !== invSearch.value) {
      invSearch.value = q;
      // Applied straight away, bypassing the debounce: this is a whole query
      // arriving at once (a deep link or a back/forward), not someone typing, so
      // there are no intermediate states to hide and no reason to wait.
      clearTimeout(invSearchTimer);
      invSearchApplied.value = q;
    }
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
  const q = invSearchApplied.value.trim().toLowerCase();
  return sortInstances(
    inventory.value.filter(
      (i) =>
        (!q || itemName(i.item).toLowerCase().includes(q)) &&
        matchesOrigin(i, invOrigin.value) &&
        (!invRarity.value || i.item?.rarity === invRarity.value) &&
        matchesRail(i),
    ),
    invSort.value,
    invDir.value,
  );
});
// Colour stacks here too — the inventory page is where you LOOK at what you
// own, and nineteen tints of one spray is the same wall there as in the picker.
// Its own drill-in state, not the sheet's: the two grids are different screens
// and being inside a stack on one says nothing about the other.
const invDesign = ref<number | null>(null);
const inventoryStacks = computed(() =>
  stackByDesign(filteredInventory.value, invDesign.value, (i) => i.item, (i) => i.id),
);
const invDesignName = computed(() =>
  invDesign.value == null
    ? ""
    : stripName(
        inventory.value.find((i) => i.item?.design === invDesign.value)?.item?.name ?? "",
      ).replace(TINT_SUFFIX, ""),
);
// Any filter change drops you out of the stack — you can't stay inside a card
// the filters just removed. (Entering select mode does too; that watch lives
// with selectMode, which is declared further down.)
//
// The SETTLED search term, not the raw box: invDesign is part of invFilterSig, so
// firing this on a keystroke rebuilt the grid one keystroke early and defeated the
// debounce for anyone who happened to be inside a colour stack.
watch([invSearchApplied, invOrigin, invRarity, invTypes, invModels], () => (invDesign.value = null));
/**
 * Everything that changes WHICH items the grid shows — one string.
 *
 * Two jobs. It resets the render window (a new list starts at page one), and it
 * is folded into every card's `:key`, which is what stops the grid ANIMATING its
 * way to the answer.
 *
 * TransitionGroup only animates a "move" for children whose keys survive. With
 * stable keys, filtering to five P90s left ~55 survivors that each FLIPped from
 * their old cell to their new one over 280ms — so you watched the grid sift
 * itself, weapon by weapon, while the toolbar had already said 5/153. Worse, the
 * cards carry `content-visibility: auto` (see style.css), so FLIP's before/after
 * getBoundingClientRect on each one forces layout of a subtree the browser had
 * deliberately skipped — dozens of image-bearing cards, spread over many frames.
 * Changing the keys makes a filter a straight swap: every card is new, none
 * moves, no offsets are read, and the result appears filtered and then waves in
 * (animate-cell-in, first window only).
 *
 * `inv-move` still earns its keep for changes that AREN'T filters — crafting an
 * item, deleting one — where the surviving cards genuinely should slide.
 */
const invFilterSig = computed(() =>
  [invSearchApplied.value, invOrigin.value, invRarity.value, invSort.value, invDir.value, invTypes.value.join("."), invModels.value.join("."), invDesign.value].join("|"),
);
const inventoryWindow = renderWindow(inventoryStacks, () => invFilterSig.value);
// Down HERE, not up beside invFade where it reads more naturally, because `watch`
// runs its source getters once at creation to seed the old value — it does that
// with or without `immediate`. Sitting above these two consts, both getters threw
// "Cannot access 'inventoryWindow' before initialization" into Vue's error
// handler, which logs and continues: the watcher was never established, so the
// "more below" fade silently stopped remeasuring when the list length changed.
// A visible console error and a dead feature, from declaration order alone.
watch([() => inventoryWindow.items.value.length, () => inventoryStacks.value.length], invFade.remeasure);
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
// Whether this item can go into the loadout at all, and where. The button
// itself just says "Equip" — the modal's name plate is already showing the
// weapon a few pixels away, and spelling out "AK-47 · Rifles" inside the button
// made it the widest thing in the footer without answering a question anyone
// had. `pos` is still the destination the equip actually uses.
const craftEquipTarget = computed(() => {
  const i = craftInst.value;
  if (!i || !viewOnly.value || !canEquipInstance(i)) return null;
  const pos = positionForInstance(i);
  return pos ? { pos } : null;
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
/**
 * What the focus stage mounts, as a TARGET rather than a bare key.
 *
 * The slot's occupant decides the kind, not the slot: the gloves slot holds a
 * glove and the agent slot an agent, and both would otherwise mount as `kind:
 * "weapon"` and run the weapon compositor over a mesh it was never written for.
 *
 * Resolved synchronously because this is a computed the template reads —
 * `resolveViewerModelSync` answers without a round trip for every kind a
 * loadout slot can hold (only charms need the async form, and no slot holds
 * one). Falls back to the slot's own key so a DEFAULT with no catalog row still
 * mounts, which is how an unowned weapon gets its 3D view.
 */
const focusTarget = computed<ViewerTarget | null>(() => {
  if (view.value !== "focus" || isNo3d(selected.value)) return null;
  const occupant = focusRow.value?.item ?? null;
  if (occupant) return resolveViewerModelSync(occupant) ?? null;
  const key = occupantModel(selected.value);
  return key ? { model: key, kind: "weapon" } : null;
});
const focusModelKey = computed(() => focusTarget.value?.model ?? null);
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

// Shape (not colour — ShareMenu keeps its own) for the item modal's header
// actions on compact. 40px is the floor for a thumb; the desktop row is built
// for a cursor and stays at 28.
const MODAL_HEAD_BTN = "flex h-10 items-center gap-1.5 rounded-md border px-3 text-f11 uppercase tracking-wider";
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
    // Weapon-only machinery, skipped by kind — sticker slots and the charm
    // attachment mean nothing on an agent or a glove, and stickerGeom would
    // fetch markup for a key no weapon has.
    const isWeapon = (focusTarget.value?.kind ?? "weapon") === "weapon";
    const handle = await mountViewer(host, key, {
      signal: ac.signal,
      kind: focusTarget.value?.kind,
      paintMaterial: focusPaint.value,
      legacyPaint: focusLegacyPaint.value,
      wear: focusRow.value?.wear ?? focusInstance.value?.wear,
      seed: focusRow.value?.seed ?? focusInstance.value?.seed,
      ...(isWeapon ? await stickerGeom(key) : {}),
      ...(isWeapon ? instPlacements(focusInstance.value) : {}),
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
  clearTimeout(revealSettleTimer);
  loadoutRO?.disconnect();
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
//
// Desktop only. This is ~15 bakes fired the moment the page loads, and on a
// phone that is the single most reliable way to lose the tab — see the touch
// budget above for why volume rather than concurrency is what kills it. Phones
// bake on demand instead: a card whose render 404s asks for its own through
// onRenderError, so what you actually look at still gets baked, just not the
// whole loadout up front.
function queueLoadoutRenders() {
  if (!canEdit.value || isCoarse.value) return;
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
      // Off to the side: the nag dot is the least important thing on screen and
      // must never hold up (or fail) the load it rides along with.
      void loadSteamSyncState();
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
    if (preview3d.value) {
      // Topmost of the lot (z-1400) — it sits over the picker, which sits over
      // the craft modal. Missing from this chain meant Escape fell straight
      // through to `craft` and shut the whole editor from a look at a sticker.
      closePreview3d();
      e.stopPropagation();
    } else if (confirmAsk.value) {
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
    } else if (lifted.value) {
      // Topmost non-modal layer: it's covering the loadout, so it's what
      // Escape should get you out from under.
      sheetLift.value = false;
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
  // Loading straight into a remembered lift never trips the watcher below, so
  // the slot a deep link selected would start out under the sheet.
  void revealSelectedSlot(false);
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

// Has this account ever pulled from Steam? Starts true so the nag can only ever
// appear once the answer is known — a dot that flashes on every load and then
// vanishes is worse than one that shows up a beat late. Stays true if the
// endpoint is missing (older backend) or errors: better to nag nobody than to
// nag everybody with a false one.
const steamSynced = ref(true);
const needsSteamSync = computed(() => signedIn.value && !viewerId.value && !steamSynced.value);
async function loadSteamSyncState() {
  try {
    const { syncedAt } = await fetchSteamSync();
    steamSynced.value = syncedAt != null;
  } catch {
    steamSynced.value = true;
  }
}

async function runSteamImport() {
  if (importBusy.value) return;
  importBusy.value = true;
  try {
    const { imported, updated, removed, skipped, partial } = await importSteamInventory();
    // The server recorded the sync; drop the nag without a round trip to ask.
    steamSynced.value = true;
    await refreshAll();
    const parts = [
      imported && `${imported} added`,
      updated && `${updated} updated`,
      removed && `${removed} no longer owned`,
      skipped && `${skipped} skipped`,
    ].filter(Boolean);
    const summary = parts.join(" · ");
    notify(
      parts.length
        ? partial
          ? tr(
              "inventory.notify.synced_partial",
              `Synced with Steam — ${summary}. Inventory too large to read fully.`,
              { summary },
            )
          : tr("inventory.notify.synced", `Synced with Steam — ${summary}.`, { summary })
        : tr(
            "inventory.notify.synced_no_changes",
            "Synced with Steam — everything was already up to date.",
          ),
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
  // Bulk actions operate on instances and a colour deck isn't one, so selecting
  // starts from the flat grid.
  invDesign.value = null;
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
  <!-- Full-bleed wrapper: cancels the host's p-1/sm:p-4 on the left, right and
       bottom, and owns an opaque background.
       The lifting picker sheet HAS to paint an opaque surface (it covers the
       loadout), and the moment anything in here is opaque the host's padding
       stops reading as page margin and starts reading as a gap between the
       panel and the window edge — most obviously down the right side with the
       friends list open. Top is deliberately left alone: that edge sits under
       the breadcrumb and wants the breathing room.
       Separate from the sizing div below so `mx-auto` there still centres the
       app inside its max width on wide monitors — negative margins would
       cancel the auto. -->
  <div class="-mx-1 -mb-1 flex min-w-0 flex-1 flex-col bg-background sm:-mx-4 sm:-mb-4">
  <div
    ref="appRootEl"
    class="mx-auto flex w-full max-w-[1560px] flex-col overflow-hidden text-foreground"
    :class="[
      // Embedded we're one tab among several on a page that scrolls itself, so
      // 100dvh would push the rest of the profile off-screen. Take a bounded
      // slice instead and let the host own the page scroll.
      //
      // The +0.25/+1rem is the host padding the wrapper above bleeds over: the
      // negative margin lets us paint there, but this height is fixed, so
      // without matching it the app would just stop 16px short and leave the
      // gap along the bottom edge. Keep the two in step.
      embedMode ? 'h-[70dvh] min-h-[480px]' : 'h-[calc(100dvh-6rem+0.25rem)] sm:h-[calc(100dvh-6rem+1rem)]',
      !isCompact && !embedMode && 'min-h-[560px]',
    ]"
    :data-team="team"
    :style="{ '--acc': accent, ...appHeightStyle }"
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
      :class="isCompact ? 'flex-nowrap gap-1.5 overflow-x-auto px-2 py-1' : 'flex-wrap gap-3 px-6 py-3'"
    >
      <!-- Compact runs the whole header at 32px instead of 36: p-0.5 on the
           pills, h-8 on the buttons. Four pixels a control does not sound like
           much, but this bar plus the category rail under it were eating two
           bands off the top of a phone before any loadout showed. -->
      <div v-if="view !== 'inventory'" :ref="(el) => teamPill.setListEl(el)" class="relative inline-flex items-center rounded-lg bg-muted" :class="isCompact ? 'p-0.5' : 'p-1'">
        <div
          v-show="teamPill.w.value > 0"
          class="pointer-events-none absolute left-0 z-0 rounded-md shadow-sm"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
          :style="{
            transform: `translateX(${teamPill.x.value}px)`,
            width: teamPill.w.value + 'px',
            background: gradient,
            transition: pillTransition(teamPill.animated.value),
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
        class="flex items-center gap-1.5 rounded-lg border text-f11 font-semibold uppercase tracking-wider transition-colors"
        :class="[isCompact ? 'h-8 px-2' : 'h-9 px-3.5', view === 'focus' ? 'border-[color:var(--acc)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground']"
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
          <!-- Never synced: the button gets an orange dot and the tooltip turns
               into the pitch. Nothing else on an empty inventory says where the
               skins you already own are supposed to come from. -->
          <Tooltip
            v-if="!viewerId"
            :text="needsSteamSync
              ? 'You haven\'t synced with Steam yet — click to pull the skins you already own into your inventory. Read-only: it mirrors your public Steam inventory. No passwords, keys, or trades, ever.'
              : 'Sync from Steam — read-only: mirrors your public Steam inventory. No passwords, keys, or trades, ever.'"
          >
            <button
              class="relative grid place-items-center rounded-md border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground disabled:opacity-60"
              :class="[
                isCompact ? 'h-8 w-8' : 'h-9 w-9',
                needsSteamSync ? 'border-[#f97316]/60' : 'border-border',
              ]"
              :disabled="importBusy"
              @click="runSteamImport"
            >
              <Loader2 v-if="importBusy" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" :style="{ color: STEAM_BLUE }" />
              <!-- Same badge geometry as the admin gear's warning dot, so the
                   two read as one language of "this wants your attention". -->
              <span
                v-if="needsSteamSync && !importBusy"
                class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                style="background: #f97316; box-shadow: 0 0 6px #f9731699"
              ></span>
            </button>
          </Tooltip>
          <ShareMenu icon :links="viewShareLinks" />
          <Tooltip
            v-if="user?.role === 'administrator' && !viewerId"
            :text="gearWarnings.length ? gearWarnings.join(' · ') : 'Game-server configuration'"
          >
            <button
              class="relative grid place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              :class="isCompact ? 'h-8 w-8' : 'h-9 w-9'"
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
        <div v-if="!embedMode" :ref="(el) => viewPill.setListEl(el)" class="relative inline-flex items-center rounded-lg bg-muted" :class="isCompact ? 'p-0.5' : 'p-1'">
          <div
            v-show="viewPill.w.value > 0"
            class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
            :style="{
              transform: `translateX(${viewPill.x.value}px)`,
              width: viewPill.w.value + 'px',
              border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
              background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
              boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
              transition: pillTransition(viewPill.animated.value),
            }"
          ></div>
          <button
            :ref="(el) => viewPill.setRef('grid', el)"
            class="relative z-[1] flex h-7 items-center gap-1.5 rounded-md px-3 text-f11 uppercase tracking-wider transition-colors"
            :class="view === 'grid' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="go('/')"
          >
            <!-- Compact drops BOTH labels, not just the inactive one. Two tabs
                 with distinct icons and a sliding indicator under the live one
                 say which is which; the words were ~70px of a ~376px row, which
                 is what pushed the header into scrolling sideways. -->
            <LayoutGrid class="h-3.5 w-3.5" />
            <span v-if="!isCompact">Loadout</span>
          </button>
          <button
            v-if="canEdit"
            :ref="(el) => viewPill.setRef('inventory', el)"
            class="relative z-[1] flex h-7 items-center gap-1.5 rounded-md px-3 text-f11 uppercase tracking-wider transition-colors"
            :class="view === 'inventory' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="go('/items')"
          >
            <Package class="h-3.5 w-3.5" />
            <span v-if="!isCompact">Inventory</span>
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
        <!-- ============ INVENTORY TOOLBAR · COMPACT ============ -->
        <div v-else-if="isCompact" class="flex min-h-[44px] flex-none items-center gap-2 border-b border-border px-3 py-1.5">
          <button
            class="flex h-8 flex-none items-center gap-1.5 rounded-md border px-2.5 text-f10 uppercase tracking-wider transition-colors"
            :class="invFilterCount ? 'border-[color:var(--acc)] text-foreground' : 'border-border text-muted-foreground'"
            :style="invFilterCount ? { background: accentSoft } : {}"
            @click="invFiltersOpen = true"
          >
            <Search v-if="invSearch" class="h-3.5 w-3.5" /><SlidersHorizontal v-else class="h-3.5 w-3.5" />
            Filters
            <span v-if="invFilterCount" class="font-mono text-f9">{{ invFilterCount }}</span>
          </button>
          <span v-if="inventory.length" class="min-w-0 truncate font-mono text-f10 text-muted-foreground/60">
            {{ filteredInventory.length }}<template v-if="filteredInventory.length !== inventory.length">/{{ inventory.length }}</template>
          </span>
          <button
            v-if="inventory.length"
            class="ml-auto grid h-8 w-8 flex-none place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
            title="Select multiple items"
            @click="selectMode = true"
          >
            <CheckSquare class="h-3.5 w-3.5" />
          </button>
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
              class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
              :style="{
                transform: `translateX(${invOriginPill.x.value}px)`,
                width: invOriginPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: pillTransition(invOriginPill.animated.value),
              }"
            ></div>
            <button
              v-for="f in ORIGIN_FILTERS"
              :key="f[0]"
              :ref="(el) => invOriginPill.setRef(f[0], el)"
              class="relative z-[1] flex h-6 items-center rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
              :class="invOrigin === f[0] ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="invOrigin = f[0]"
            >
              {{ f[1] }}
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
            :model-value="invSort"
            prefix="Sort"
            class="shrink-0"
            :options="SORTS.map((s) => ({ value: s[0], label: s[0] === 'default' ? 'Newest' : s[1] }))"
            @update:model-value="setInvSort"
          />
          <SortDirection v-model="invDir" :kind="SORT_DIR_KIND[invSort]" :hint="SORT_DIR_HINT[invSort][invDir]" />
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

        <!-- ============ INVENTORY FILTER SHEET (compact) ============
             Deliberately the same sheet as the picker's, down to the chip
             styling — "filters" should mean one thing in this plugin. It also
             carries the type/model facets, which live in the `lg:` rail and so
             had no mobile home at all before this. -->
        <Transition enter-active-class="animate-sheet-enter" leave-active-class="animate-sheet-leave">
        <div
          v-if="isCompact && invFiltersOpen"
          class="fixed inset-0 z-[998] bg-background/60"
          @click="invFiltersOpen = false"
        >
          <div
            data-role="inv-filter-sheet"
            data-sheet
            class="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-card shadow-2xl"
            :style="swipeStyle"
            @click.stop
          >
            <div class="sticky top-0 z-[2] touch-none bg-card pt-1" v-on="invFilterSheetSwipe">
              <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
              <div class="flex items-center gap-2 border-b border-border px-4 pb-2">
                <span class="text-f10 uppercase tracking-cs2 text-muted-foreground">Filter inventory</span>
                <button
                  v-if="invFilterCount"
                  class="ml-auto rounded-md border border-border px-2 py-1 text-f9 uppercase tracking-cs1 text-muted-foreground"
                  @click="resetInvFilters"
                >
                  Reset
                </button>
              </div>
            </div>

            <div class="flex flex-col gap-4 px-4 pb-5 pt-3">
              <div class="relative">
                <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  v-model="invSearch"
                  placeholder="Search inventory…"
                  class="h-10 w-full rounded-md border border-border bg-background pl-9 pr-8 text-f13 outline-none focus:border-[color:var(--acc)]"
                />
                <button
                  v-if="invSearch"
                  class="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-muted-foreground"
                  title="Clear search"
                  @click="invSearch = ''"
                ><X class="h-3.5 w-3.5" /></button>
              </div>

              <section class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs2 text-muted-foreground/60">Origin</div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="f in ORIGIN_FILTERS"
                    :key="f[0]"
                    :class="[INV_CHIP, invOrigin === f[0] ? INV_CHIP_ON : INV_CHIP_OFF]"
                    :style="invOrigin === f[0] ? { background: accentSoft } : {}"
                    @click="invOrigin = f[0]"
                  >{{ f[1] }}</button>
                </div>
              </section>

              <section v-if="invRarityFacets.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs2 text-muted-foreground/60">Rarity</div>
                <div class="flex flex-wrap gap-2">
                  <button :class="[INV_CHIP, !invRarity ? INV_CHIP_ON : INV_CHIP_OFF]" @click="invRarity = ''">All</button>
                  <button
                    v-for="r in invRarityFacets"
                    :key="r.hex"
                    :class="[INV_CHIP, 'gap-1.5', invRarity === r.hex ? INV_CHIP_ON : INV_CHIP_OFF]"
                    @click="invRarity = invRarity === r.hex ? '' : r.hex"
                  >
                    <span class="h-2 w-2 flex-none rounded-full" :style="{ background: r.hex }"></span>{{ r.name }}
                  </button>
                </div>
              </section>

              <section class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-f9 uppercase tracking-cs2 text-muted-foreground/60">Sort</span>
                  <SortDirection v-model="invDir" :kind="SORT_DIR_KIND[invSort]" :hint="SORT_DIR_HINT[invSort][invDir]" class="ml-auto" />
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="s in SORTS"
                    :key="s[0]"
                    :class="[INV_CHIP, invSort === s[0] ? INV_CHIP_ON : INV_CHIP_OFF]"
                    @click="setInvSort(s[0])"
                  >{{ s[0] === 'default' ? 'Newest' : s[1] }}</button>
                </div>
              </section>

              <!-- The rail's facets. Groups toggle the whole category, the
                   tiles under them toggle one model — same additive rule as the
                   desktop rail, just laid out as chips. -->
              <!-- Same rule as the desktop rail: empty means disabled, never
                   removed. A sheet that reflows while you type is worse than the
                   desktop rail doing it, because it can move the control under
                   your thumb between the touch and the release. -->
              <section v-for="grp in invRail.weapons" :key="grp.key" class="flex flex-col gap-2">
                <button
                  class="flex items-center gap-2 text-left transition-opacity duration-200"
                  :class="!grp.count && !invTypes.includes(grp.key) ? 'pointer-events-none opacity-60' : ''"
                  :disabled="!grp.count && !invTypes.includes(grp.key)"
                  @click="toggleType(grp.key)"
                >
                  <span class="text-f9 uppercase tracking-cs2" :class="invTypes.includes(grp.key) ? 'text-[color:var(--acc)]' : 'text-muted-foreground/60'">{{ grp.label }}</span>
                  <span class="font-mono text-f9 text-muted-foreground/50">{{ grp.count }}</span>
                </button>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="it in grp.items"
                    :key="it.model"
                    :class="[
                      INV_CHIP,
                      'gap-1.5 transition-opacity duration-200',
                      invModels.includes(it.model) ? INV_CHIP_ON : INV_CHIP_OFF,
                      !it.count && !invModels.includes(it.model) ? 'pointer-events-none opacity-30' : '',
                    ]"
                    :disabled="!it.count && !invModels.includes(it.model)"
                    @click="toggleModel(it.model)"
                  >
                    {{ it.name }}<span class="font-mono text-f8 text-muted-foreground/50">{{ it.count }}</span>
                  </button>
                </div>
              </section>

              <section v-if="invRail.gear.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs2 text-muted-foreground/60">Gear</div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="row in invRail.gear"
                    :key="row.key"
                    :class="[
                      INV_CHIP,
                      'gap-1.5 transition-opacity duration-200',
                      invTypes.includes(row.key) ? INV_CHIP_ON : INV_CHIP_OFF,
                      !row.count && !invTypes.includes(row.key) ? 'pointer-events-none opacity-30' : '',
                    ]"
                    :disabled="!row.count && !invTypes.includes(row.key)"
                    @click="toggleType(row.key)"
                  >
                    {{ row.label }}<span class="font-mono text-f8 text-muted-foreground/50">{{ row.count }}</span>
                  </button>
                </div>
              </section>

              <button
                class="mt-1 w-full rounded-md border border-[color:var(--acc)] py-2.5 text-f11 font-semibold uppercase tracking-cs2 text-foreground"
                :style="{ background: accentSoft }"
                @click="invFiltersOpen = false"
              >
                Show {{ filteredInventory.length }} item{{ filteredInventory.length === 1 ? '' : 's' }}
              </button>
            </div>
          </div>
        </div>
        </Transition>

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
            <!-- Dimmed less than the tiles when empty: this one is also the group's
                 LABEL, and fading it out would take the rail's structure with it. -->
            <button
              class="flex items-center justify-between px-0.5 text-f8 uppercase tracking-cs3 transition-[color,opacity] duration-200"
              :class="[
                invTypes.includes(grp.key) ? 'text-[color:var(--acc)]' : 'text-muted-foreground/60',
                !grp.count && !invTypes.includes(grp.key) ? 'pointer-events-none opacity-60' : 'hover:text-foreground',
              ]"
              :disabled="!grp.count && !invTypes.includes(grp.key)"
              :title="grp.count ? `Show all ${grp.label.toLowerCase()}` : `No ${grp.label.toLowerCase()} match the current filters`"
              @click="toggleType(grp.key)"
            >
              <span>{{ grp.label }}</span>
              <span class="font-mono">{{ grp.count }}</span>
            </button>
            <!-- A model with nothing left after the search is DISABLED, not
                 removed: the rail keeps its geometry, so typing never restructures
                 the page out from under you. `disabled` keeps it off the tab order
                 too. Still drawn when it is the ACTIVE filter, and still clickable
                 then, or turning a filter on could strand you with no way to turn
                 it back off. -->
            <div class="grid grid-cols-2 gap-1.5">
              <button
                v-for="it in grp.items"
                :key="it.model"
                class="group relative grid aspect-square place-items-center overflow-hidden rounded-md border transition-[color,background-color,border-color,opacity] duration-200"
                :class="[
                  invModels.includes(it.model)
                    ? 'border-[color:var(--acc)] bg-secondary/70'
                    : 'border-border/60 bg-secondary/30',
                  !it.count && !invModels.includes(it.model)
                    ? 'pointer-events-none opacity-30'
                    : 'hover:border-muted-foreground/40 hover:bg-secondary/60',
                ]"
                :disabled="!it.count && !invModels.includes(it.model)"
                :style="selRing(invModels.includes(it.model))"
                :title="it.count ? `${it.name} · ${it.count}` : `${it.name} — none match the current filters`"
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
              class="flex items-center justify-between rounded-md border px-2 py-1.5 text-f9 uppercase tracking-wider transition-[color,background-color,border-color,opacity] duration-200"
              :class="[
                invTypes.includes(row.key)
                  ? 'border-[color:var(--acc)] bg-secondary/70 text-foreground'
                  : 'border-border/60 bg-secondary/30 text-muted-foreground',
                !row.count && !invTypes.includes(row.key)
                  ? 'pointer-events-none opacity-30'
                  : 'hover:border-muted-foreground/40 hover:text-foreground',
              ]"
              :disabled="!row.count && !invTypes.includes(row.key)"
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
        <!-- Wrapper exists purely to anchor the fade: the grid itself is the
             scroller, so the overlay cannot live inside it (it would scroll
             with the content) and the row above holds the filter rail too. -->
        <div :ref="invFade.setHost" class="relative flex min-w-0 flex-1 flex-col">
        <!-- Inside a colour stack. Above the grid rather than in it: the grid's
             rows are a fixed card height, so a col-span-full header reserves a
             whole card-tall row for an 8px button. -->
        <div
          v-if="invDesign !== null"
          class="flex flex-none items-center gap-3 border-b border-border px-6 py-2.5"
        >
          <button
            class="flex h-8 flex-none items-center gap-1.5 rounded-md border px-3 text-f10 font-semibold uppercase tracking-cs1 text-foreground transition-colors"
            :style="{
              borderColor: 'hsl(var(--tac-amber, 33 94% 58%) / 0.55)',
              background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
            }"
            @click="invDesign = null"
          >
            <ChevronLeft class="h-4 w-4" />
            Back
          </button>
          <span class="min-w-0 truncate text-f11 uppercase tracking-cs2 text-foreground">{{ invDesignName }}</span>
          <span class="flex-none text-f9 uppercase tracking-cs1 text-muted-foreground">
            <span class="font-mono text-foreground">{{ inventoryStacks.length }}</span>
            {{ inventoryStacks.length === 1 ? 'color' : 'colors' }}
          </span>
        </div>
        <TransitionGroup
          data-scroller
          tag="div"
          class="min-h-0 min-w-0 flex-1 auto-rows-min content-start gap-3 overflow-y-auto p-6"
          :style="invGridStyle"
          move-class="inv-move"
          appear
          appear-active-class="animate-cell-in"
          enter-active-class="animate-cell-in"
          leave-active-class="inv-leave"
          leave-from-class="inv-leave"
          leave-to-class="inv-leave"
          @scroll.passive="invFade.onScroll"
        >
          <div v-if="!inventory.length" key="empty" class="col-span-full grid place-items-center gap-2 py-20 text-center text-muted-foreground">
            <Package class="h-8 w-8 opacity-40" />
            <div>Your inventory is empty.</div>
            <div class="text-f13">Open the <b class="text-foreground">Loadout</b>, pick a weapon, and craft a finish.</div>
          </div>
          <div
            v-else-if="!inventoryStacks.length"
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
               into the detail modal so a stray click can't re-equip a slot.
               The entrance is TransitionGroup's (`appear` + enter classes above);
               each card only contributes its place in the cascade via `--i`. See
               invCellDelay for why the class is not applied per item. -->
          <template v-for="(st, i) in inventoryWindow.items.value" :key="st.key + '|' + invFilterSig">
            <!-- A deck is not an item: no single instance to open, select or
                 act on, so its only verb is "open me". Selecting is done inside
                 it, where the instances are. -->
            <div v-if="st.variants.length > 1" class="cv-tile relative h-full" :style="{ '--i': invCellDelay(i), '--cis': cardSize + CARD_CHROME_PX + 'px' }">
              <span
                v-for="(hex, n) in st.behind"
                :key="n"
                class="pointer-events-none absolute inset-0 rounded-lg border"
                :style="{
                  transform: `rotate(${n === 0 ? -5 : 5}deg) scale(0.88)`,
                  transformOrigin: 'bottom center',
                  borderColor: hex,
                  background: `color-mix(in srgb, ${hex} 70%, hsl(var(--card)))`,
                }"
              ></span>
              <button
                data-role="inv-item"
                class="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
                :style="st.face.item?.rarity ? { borderBottom: `3px solid ${st.face.item.rarity}` } : {}"
                :title="`${st.variants.length} colours — open`"
                @click="invDesign = st.face.item?.design ?? null"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(st.face.item?.rarity, 0.22)"></span>
                <span class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 font-mono text-f8 text-[color:var(--acc)]">
                  <Palette class="h-2.5 w-2.5" /> {{ st.variants.length }}
                </span>
                <div :class="CARD_ART">
                  <img
                    :src="st.face.item?.image ?? undefined"
                    alt=""
                    loading="lazy" decoding="async"
                    class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105"
                  />
                </div>
                <ItemName
                  :item="{ ...st.face.item, name: (st.face.item?.name ?? '').replace(TINT_SUFFIX, '') }"
                  strip
                  class="relative z-[2]"
                />
              </button>
            </div>
            <ItemTile
              v-else
              class="cv-tile"
              :style="{ '--i': invCellDelay(i), '--cis': cardSize + CARD_CHROME_PX + 'px' }"
              :inst="st.face"
              show-header
              :selected="selectMode && selectedIds.has(st.face.id)"
              :hide-actions="selectMode"
              :title="selectMode ? 'Toggle selection' : itemName(st.face.item) || 'View item'"
              @click="selectMode ? toggleSelected(st.face.id) : openDetail(st.face)"
              @contextmenu.prevent="openItemCtx(st.face, $event)"
              @longpress="openItemCtxFor(st.face)"
              @view3d="view3dForInstance(st.face)"
              @inspect="openInspectLink(st.face.id)"
              @edit="openEdit(st.face)"
              @duplicate="openEdit(st.face)"
              @remove="deleteOwned(st.face)"
            />
          </template>
          <!-- Keyed: TransitionGroup requires it, and a stable key keeps the
               sentinel out of the move/enter animations. -->
          <InfiniteSentinel
            key="more"
            :count="inventoryWindow.items.value.length"
            :done="inventoryWindow.done.value"
            @hit="inventoryWindow.grow"
          />
        </TransitionGroup>
        <!-- Same cue as the picker sheet: the grid runs off the edge rather
             than ending flush against it, and the fade clears at the bottom. -->
        <div
          v-if="invFade.more.value"
          class="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-12 bg-gradient-to-t from-background via-background/70 to-transparent"
        ></div>
        </div>
        </div>
      </div>

      <!-- ============ LOADOUT / FOCUS ============ -->
      <!-- `relative` makes this the containing block for the desktop picker
           sheet, which floats over the loadout instead of sitting under it; the
           existing overflow-hidden then clips it to the loadout area. -->
      <div v-else ref="loadoutEl" key="loadout" class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- Stacks on compact so the focus rail can sit above the stage as a
           strip rather than beside it as a fixed 122px column.
           The padding is the space the sheet used to occupy in flow: reserving
           it here means the collapsed layout is unchanged and a lift moves
           nothing but the sheet. -->
      <!-- `isolate` keeps this half's z-indexes to itself — the focus-view 3D
           cursor overlay sits at z-20 and would otherwise punch up through the
           lifted sheet. With a stacking context here the sheet only has to
           out-rank one element, so it can stay at a low enough z to lose to the
           host's drawers. -->
      <div class="relative isolate flex min-h-0 flex-1 overflow-hidden" :class="isCompact && 'flex-col'" :style="loadoutPadStyle">
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
                    it.pos === 'agent' && ART_FADE_B,
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
          <nav class="flex flex-none gap-1 overflow-x-auto border-b border-border px-2 py-0.5" data-role="compact-rail">
            <button
              v-for="c in compactCats"
              :key="c.key"
              class="flex min-h-[30px] flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-f10 font-semibold uppercase tracking-cs1 transition-colors"
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
                    :class="cn('max-h-full max-w-full object-contain', s.slot === 'agent' && ART_FADE_B, !rowFor(s.slot) && 'opacity-60')"
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
                  <WearBar :item="rowFor(s.slot)?.item" :wear="rowFor(s.slot)?.wear" :seed="rowFor(s.slot)?.seed" mini class="mb-1" />
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
                  <WearBar :item="cellWear(cell.pos)?.item" :wear="cellWear(cell.pos)?.wear" :seed="cellWear(cell.pos)?.seed" mini class="mb-1" />
                </div>
              </button>
            </div>

            <!-- Permanent, not retired-after-first-use. It used to hide itself
                 the moment you long-pressed once, on the theory that a standing
                 hint costs a row of scroll — but long-press has no other
                 affordance, so the one time it showed was the one time you
                 weren't looking for it. One dim 9px line is a cheap price for
                 the only place the gesture is ever named. -->
            <p class="px-1 pt-2 text-center text-f9 uppercase tracking-cs2 text-muted-foreground/50">
              Tap to select · hold for options
            </p>
          </div>
        </div>

        <!-- ============ LOADOUT GRID ============ -->
        <template v-else-if="view === 'grid'">
          <!-- Identity column: gloves + knife (prominent) and a compact agent -->
          <!-- The inner wrapper exists so the lift spacer can be a SIBLING of
               the cards rather than padding on the scroller: padding would come
               out of the flex line and squeeze every flex-1 card toward its
               min-height, which is the reflow the floating sheet exists to
               avoid. min-h-full keeps the cards stretching exactly as before. -->
          <aside class="animate-grid-in flex w-full min-w-[200px] max-w-[340px] flex-1 flex-col overflow-y-auto py-3 pl-4 pr-1" :style="liftScrollStyle">
            <div class="flex min-h-full flex-col gap-2.5">
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
                <WearBar :item="rowFor(s.slot)?.item" :wear="rowFor(s.slot)?.wear" :seed="rowFor(s.slot)?.seed" mini class="mb-1" />
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
                  :class="cn('max-h-full max-w-full object-contain', ART_FADE_B, !rowFor('agent') && 'opacity-70')"
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
            </div>
            <div v-if="liftIntrusion" aria-hidden="true" class="flex-none" :style="{ height: liftIntrusion + LIFT_SPACER_PAD + 'px' }"></div>
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
              <!-- Wrapper + spacer, same shape as the identity column: the
                   spacer is what gives this scroller somewhere to scroll when
                   the lifted sheet is covering its bottom, without padding
                   stealing height from the flex-1 cells. -->
              <div class="flex flex-1 flex-col overflow-y-auto pt-2" :style="liftScrollStyle">
                <div class="flex min-h-full flex-col gap-2">
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
                          v-if="!isCoarse && canInspect(cellInstance(cell.pos)?.item)"
                          class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
                          title="Inspect in game"
                          @click.stop="openInspectLink(cellInstance(cell.pos)!.id)"
                        ><ExternalLink class="h-3 w-3" /></span>
                        <span
                          v-if="isCustomizable(cellInstance(cell.pos)?.item)"
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
                      :item="cellWear(previewPos(cell.pos))?.item"
                      :wear="cellWear(previewPos(cell.pos))?.wear"
                      :seed="cellWear(previewPos(cell.pos))?.seed"
                      mini
                      class="mb-1"
                    />
                  </div>
                </button>
                </div>
                <div v-if="liftIntrusion" aria-hidden="true" class="flex-none" :style="{ height: liftIntrusion + LIFT_SPACER_PAD + 'px' }"></div>
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
                <div v-if="focus3dAvailable" :ref="(el) => focus3dPill.setListEl(el)" class="relative flex h-8 items-center rounded-lg bg-muted p-1">
                  <div
                    v-show="focus3dPill.w.value > 0"
                    class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
                    :style="{
                      transform: `translateX(${focus3dPill.x.value}px)`,
                      width: focus3dPill.w.value + 'px',
                      border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                      background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                      boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                      transition: pillTransition(focus3dPill.animated.value),
                    }"
                  ></div>
                  <button
                    :ref="(el) => focus3dPill.setRef('2D', el)"
                    class="relative z-[1] flex h-full items-center gap-1.5 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
                    :class="!focus3d ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                    @click="setFocus3d(false)"
                  >
                    <ImageIcon class="h-3.5 w-3.5" /> 2D
                  </button>
                  <button
                    :ref="(el) => focus3dPill.setRef('3D', el)"
                    class="relative z-[1] flex h-full items-center gap-1.5 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
                    :class="focus3d ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                    @click="setFocus3d(true)"
                  >
                    <Box class="h-3.5 w-3.5" /> 3D
                  </button>
                </div>
                <!-- Edit + Inspect + Share live top right, same corner as every
                     other surface (3D overlay, craft modal, item detail).
                     Edit leads: focus is where you land on a slot, and until now
                     the only way into the editor from here was the context menu
                     or a trip back to the grid. -->
                <button
                  v-if="isSkinned(focusRow) && canEdit && focusInstance && isCustomizable(focusRow?.item)"
                  :class="[FOCUS_STAGE, 'border-border text-muted-foreground hover:border-[color:var(--acc)] hover:text-foreground']"
                  title="Edit this item — wear, pattern, stickers, charm"
                  @click="openEdit(focusInstance)"
                >
                  <Pencil class="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  v-if="isSkinned(focusRow) && canEdit && focusInstance && !isCoarse && canInspect(focusRow?.item)"
                  :class="[FOCUS_STAGE, 'border-border text-muted-foreground hover:border-[color:var(--acc)] hover:text-foreground']"
                  title="Launch CS2 and inspect this item in-game"
                  @click="openInspectLink(focusInstance.id)"
                >
                  <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect' }}
                </button>
                <ShareMenu
                  v-if="isSkinned(focusRow) && canEdit"
                  :links="instanceShareLinks(focusInstance?.id)"
                  :note="ITEM_LINK_NOTE"
                  :btn-class="FOCUS_STAGE"
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
              <!-- Camera legend. Floats over the canvas at the bottom edge, where
                   the model almost never is, and sits at 70% until hovered so it
                   reads as chrome rather than as part of the item. -->
              <ViewerControls
                v-if="focus3d && !focus3dBusy"
                variant="overlay"
                class="absolute bottom-1 left-1/2 z-[3] -translate-x-1/2"
              />
            </div>

            <div class="relative z-[2] flex flex-wrap items-center gap-6 border-t border-border pt-3.5">
              <!-- Hidden, not dashed out, for the types that have no such
                   reading: a spray has no float and no pattern, and "—" under a
                   Float heading still says the item HAS one and we don't know
                   it. -->
              <div v-if="hasWear(focusRow?.item)" class="flex flex-col gap-1">
                <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">Float</span>
                <span class="font-mono text-f13">{{ focusRow?.wear != null ? focusRow.wear.toFixed(4) : '—' }}</span>
                <!-- Was a hand-rolled track: full-saturation ramp, no tier
                     boundaries, no lit zone. It was the one wear readout in the
                     app that didn't look like the others. WearBar is THE way
                     wear renders — bare drops its numbers, since "Float" above
                     already prints the value. -->
                <WearBar v-if="focusRow?.wear != null" :item="focusRow?.item" :wear="focusRow.wear" bare class="mt-1.5 w-[180px]" />
              </div>
              <div v-if="hasSeed(focusRow?.item)" class="flex flex-col gap-1">
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
      <!-- z-[5]: high enough to clear the loadout half (isolated above, so its
           internals can't reach up here), low enough to stay UNDER the host
           panel's own chrome — the notifications and friends drawers are fixed
           at z-10, and at z-40 this sheet painted straight over them. -->
      <section
        v-if="!viewerId"
        data-role="picker-sheet"
        class="absolute inset-x-0 bottom-0 z-[5] flex flex-col border-t border-border bg-background"
        :style="sheetStyle"
      >
        <!-- ============ SHEET HEADER (compact: the drag surface) ============
             The ENTIRE header drags — pill, toolbar and tally together, not
             just the pill. A 20px pill is not a target anyone hits on a phone,
             and a swipe that misses it lands on the page, where the browser
             takes it as pull-to-refresh. `touch-none` is what denies the
             browser that gesture, and it only works on the element the finger
             actually starts on — hence the whole block.
             Capture is lazy (SWIPE_ARM_PX), so the mode tabs and filter chip
             living inside this surface keep their taps. -->
        <div class="flex-none" :class="isCompact && 'touch-none'" v-on="sheetHeaderDrag">
        <!-- Handle + toolbar. This wrapper's height IS the minimised state —
             see setSheetPeekEl. Nothing else may go inside it. -->
        <div :ref="setSheetPeekEl">
        <div v-if="isCompact" class="flex cursor-grab justify-center py-2.5">
          <span class="h-1 w-10 rounded-full bg-muted-foreground/40"></span>
        </div>
        <!-- Desktop never wraps. A second row here costs ~40px of picker for one
             input, and it appears and disappears as you switch modes (Replace
             drops the rarity/sort controls), so the grid below jumps. The search
             box absorbs the pressure by shrinking instead. -->
        <div
          class="flex items-center border-b border-border"
          :class="isCompact ? 'flex-wrap gap-2 px-3 py-2' : 'gap-2.5 px-6 py-2.5'"
        >
          <!-- Sheet-mode tabs: same sliding pill as the view tabs, pinned first
               so nothing in this row ever jumps around. Stays auto-width at
               every size — stretching it full-width on compact left the three
               tabs marooned at the left of a wide empty bar, and desynced the
               sliding indicator that measures against button positions. -->
          <div :ref="(el) => sheetPill.setListEl(el)" class="relative inline-flex flex-none items-center rounded-lg bg-muted p-1">
            <div
              v-show="sheetPill.w.value > 0"
              class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
              :style="{
                transform: `translateX(${sheetPill.x.value}px)`,
                width: sheetPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: pillTransition(sheetPill.animated.value),
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
              class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetMode === 'replace' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetMode = 'replace'"
            >
              Replace
            </button>
            <!-- Text only. These are three tabs in one pill with the sliding
                 indicator already saying which is active; the glyphs were
                 spending ~60px of the row on decoration, and that was the
                 difference between the search box fitting and wrapping. -->
            <button
              :ref="(el) => sheetPill.setRef('craft', el)"
              class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetMode === 'craft' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetMode = 'craft'"
            >
              Craft
            </button>
          </div>
          <!-- Catalog facets. Craft only — Owned and Replace list inventory
               instances and weapons, which carry none of this — and each one
               hides itself when the loaded catalog has nothing to split, so
               only graffiti shows them today and no weapon sheet changed.
               Same sliding-pill tabs as every other tab group here. -->
          <div
            v-if="sheetMode === 'craft' && sheetGroupTabs.length && (!isCompact || sheetFiltersOpen)"
            :ref="(el) => sheetGroupPill.setListEl(el)"
            class="relative inline-flex h-8 flex-none items-center rounded-lg bg-muted p-1"
          >
            <div
              v-show="sheetGroupPill.w.value > 0"
              class="pointer-events-none absolute left-0 z-0 rounded-md"
              :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
              :style="{
                transform: `translateX(${sheetGroupPill.x.value}px)`,
                width: sheetGroupPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: pillTransition(sheetGroupPill.animated.value),
              }"
            ></div>
            <button
              v-for="g in sheetGroupTabs"
              :key="g.value"
              :ref="(el) => sheetGroupPill.setRef(g.value, el)"
              class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetGroup === g.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setSheetGroup(g.value)"
            >
              {{ g.label }}
              <!-- Fixed width + tabular figures — see the picker's tab strip: a
                   self-sizing count resizes the tab and drags the sliding pill on
                   every keystroke. -->
              <span class="ml-1.5 inline-flex h-[15px] w-[34px] flex-none items-center justify-center rounded border border-border bg-background/70 px-1 font-mono text-f9 leading-none tabular-nums">{{ fmtCount(g.count) }}</span>
            </button>
          </div>
          <FilterDropdown
            v-if="sheetMode === 'craft' && sheetCollectionOptions.length && (!isCompact || sheetFiltersOpen)"
            :model-value="sheetCollection"
            :options="sheetCollectionOptions"
            @update:model-value="setSheetCollection"
          />
          <!-- Colourways. The dot is an approximation of the tint (see
               GRAFFITI_TINT_HEX) — the label is what identifies it. -->
          <FilterDropdown
            v-if="sheetMode === 'craft' && sheetTintOptions.length && (!isCompact || sheetFiltersOpen)"
            :model-value="sheetTint"
            dots
            :options="sheetTintOptions"
            @update:model-value="setSheetTint"
          />
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
          <template v-if="sheetMode !== 'replace' && (!isCompact || sheetFiltersOpen)">
            <FilterDropdown
              :model-value="sheetSort"
              prefix="Sort"
              :options="SORTS.map((s) => ({ value: s[0], label: s[1], disabled: s[0] === 'wear' && sheetMode === 'craft' }))"
              @update:model-value="setSheetSort"
            />
            <SortDirection v-model="sheetDir" :kind="SORT_DIR_KIND[sheetSort]" :hint="SORT_DIR_HINT[sheetSort][sheetDir]" />
          </template>
          <!-- Owned only: same Synced/Crafted filter as the Inventory grid, so
               read-only Steam imports can be kept out of the equip picker. -->
          <div
            v-if="sheetMode === 'owned' && (!isCompact || sheetFiltersOpen)"
            :ref="(el) => sheetOriginPill.setListEl(el)"
            class="relative inline-flex flex-none items-center rounded-lg bg-muted p-1"
          >
            <div
              v-show="sheetOriginPill.w.value > 0"
              class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
              :style="{
                transform: `translateX(${sheetOriginPill.x.value}px)`,
                width: sheetOriginPill.w.value + 'px',
                border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                transition: pillTransition(sheetOriginPill.animated.value),
              }"
            ></div>
            <button
              v-for="f in ORIGIN_FILTERS"
              :key="f[0]"
              :ref="(el) => sheetOriginPill.setRef(f[0], el)"
              class="relative z-[1] flex h-6 items-center rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
              :class="sheetOrigin === f[0] ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="sheetOrigin = f[0]"
            >
              {{ f[1] }}
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
          <div v-if="!isCompact" class="relative w-[220px] min-w-[128px] shrink">
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
          <!-- The only way in or out of the lift, and it stays put across
               sessions: the panel changes size when you ask it to and at no
               other time. -->
          <button
            v-if="canLift"
            class="grid h-8 w-8 flex-none place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
            :title="sheetLift ? 'Lower the picker' : 'Raise the picker over the loadout'"
            :aria-expanded="sheetLift"
            @click="sheetLift = !sheetLift"
          >
            <ChevronUp class="h-4 w-4 transition-transform duration-200" :class="sheetLift && 'rotate-180'" />
          </button>
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
        </div>
        <!-- /measured minimised height -->

        <!-- Compact-only tally. A phone can't show a scrollbar, and the picker
             is a short scroller inside a sheet inside a page — so how many
             results there are, and whether you've seen them all, has to be
             said out loud rather than implied by the geometry. -->
        <div
          v-if="isCompact"
          class="flex flex-none items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-f9 uppercase tracking-cs1 text-muted-foreground"
        >
          <span class="truncate">
            <span class="font-mono text-foreground">{{ sheetResultCount }}</span>
            {{ sheetMode === 'craft' ? 'finishes' : sheetMode === 'replace' ? 'weapons' : sheetResultCount === 1 ? 'skin' : 'skins' }}
            · {{ sheetWeaponName }}
          </span>
          <span v-if="sheetHasMore" class="flex flex-none items-center gap-1 text-muted-foreground/70">
            Scroll <ChevronDown class="h-3 w-3" />
          </span>
        </div>
        </div>
        <!-- /sheet header -->

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
            data-sheet
            class="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-card shadow-2xl"
            :style="swipeStyle"
            @click.stop
          >
            <!-- Whole header grabs, Reset included — the lazy capture in
                 swipeToDismiss keeps that button's tap working. -->
            <div class="sticky top-0 z-[2] touch-none bg-card pt-1" v-on="filterSheetSwipe">
              <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
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

              <!-- Catalog facets, same three the desktop toolbar shows and on
                   the same "only if the catalog splits" condition. Chips rather
                   than dropdowns: a menu inside a bottom sheet inside a sheet is
                   one popover too many on a phone. -->
              <section v-if="sheetMode === 'craft' && sheetGroupTabs.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Type</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="g in sheetGroupTabs"
                    :key="g.value"
                    class="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="sheetGroup === g.value ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetGroup === g.value ? { background: accentSoft } : {}"
                    @click="setSheetGroup(g.value)"
                  >
                    {{ g.label }}
                    <span class="font-mono text-f9 text-muted-foreground/70">{{ fmtCount(g.count) }}</span>
                  </button>
                </div>
              </section>

              <section v-if="sheetMode === 'craft' && sheetCollectionOptions.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Collection</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="c in sheetCollectionOptions"
                    :key="c.value"
                    class="rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="sheetCollection === c.value ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetCollection === c.value ? { background: accentSoft } : {}"
                    @click="setSheetCollection(c.value)"
                  >
                    {{ c.value ? c.label : 'All' }}
                  </button>
                </div>
              </section>

              <section v-if="sheetMode === 'craft' && sheetTintOptions.length" class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Color</div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="t in sheetTintOptions"
                    :key="t.value"
                    class="flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="sheetTint === t.value ? 'text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetTint === t.value
                      ? t.color
                        ? { borderColor: t.color, background: `color-mix(in srgb, ${t.color} 16%, transparent)` }
                        : { borderColor: 'var(--acc)', background: accentSoft }
                      : {}"
                    @click="setSheetTint(t.value)"
                  >
                    <span
                      v-if="t.color"
                      class="h-2 w-2 flex-none rounded-full"
                      :style="{ background: t.color, boxShadow: `0 0 6px ${t.color}` }"
                    ></span>
                    {{ t.value ? t.label : 'All' }}
                  </button>
                </div>
              </section>

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
                    @click="setSheetSort(s[0])"
                  >
                    {{ s[1] }}
                  </button>
                  <!-- Direction is part of the sort, so it belongs in this section
                       rather than only on the desktop toolbar. Spelled out here
                       because there's room for words — the icon alone carries it
                       on the toolbar. Inline icon rather than <SortDirection>: this
                       IS the button, and nesting one inside it is invalid HTML. -->
                  <button
                    class="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-2 text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors"
                    @click="sheetDir = sheetDir === 'desc' ? 'asc' : 'desc'"
                  >
                    <component :is="SORT_DIR_ICON[SORT_DIR_KIND[sheetSort]][sheetDir]" class="h-3.5 w-3.5" />
                    {{ SORT_DIR_HINT[sheetSort][sheetDir] }}
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
                    class="flex items-center rounded-md border px-2.5 py-2 text-f10 uppercase tracking-cs1 transition-colors"
                    :class="sheetOrigin === f[0] ? 'border-[color:var(--acc)] text-foreground' : 'border-border/60 text-muted-foreground'"
                    :style="sheetOrigin === f[0] ? { background: accentSoft } : {}"
                    @click="sheetOrigin = f[0]"
                  >
                    {{ f[1] }}
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

        <!-- Inside a colour stack. Its own strip rather than a cell in the grid:
             the grid's rows are a fixed card height, so a col-span-full header
             left a card-tall hole above the results.
             Unfilled, like the compact tally strip below the toolbar — a band of
             flat colour is a weight nothing else in this app carries.
             Tactical amber rather than var(--acc): the team accent turns CS2
             blue on CT, which put a blue control directly under the amber CRAFT
             and ART pills that own this row. Amber is what this UI uses for
             "the thing you act on". -->
        <div
          v-if="sheetMode !== 'replace' && sheetDesign !== null"
          class="flex flex-none items-center gap-3 border-b border-border"
          :class="isCompact ? 'px-3 py-2' : 'px-6 py-2.5'"
        >
          <button
            class="flex h-8 flex-none items-center gap-1.5 rounded-md border px-3 text-f10 font-semibold uppercase tracking-cs1 text-foreground transition-colors"
            :style="{
              borderColor: 'hsl(var(--tac-amber, 33 94% 58%) / 0.55)',
              background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
            }"
            @click="sheetDesign = null"
          >
            <ChevronLeft class="h-4 w-4" />
            Back
          </button>
          <span class="min-w-0 truncate text-f11 uppercase tracking-cs2 text-foreground">{{ sheetDesignName }}</span>
          <span class="flex-none text-f9 uppercase tracking-cs1 text-muted-foreground">
            <span class="font-mono text-foreground">{{ sheetResultCount }}</span>
            {{ sheetResultCount === 1 ? 'color' : 'colors' }}
          </span>
        </div>

        <Transition
          mode="out-in"
          enter-active-class="transition duration-150"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-100"
          leave-to-class="opacity-0"
        >
        <div
          :key="sheetMode + '|' + sheetKey"
          :ref="setSheetScrollEl"
          class="flex-1 auto-rows-min content-start overflow-y-auto overscroll-contain"
          :class="isCompact ? 'gap-1.5 px-3 pb-8 pt-2' : 'gap-2.5 px-6 pb-6 pt-3.5'"
          :style="pickerGridStyle"
          @scroll.passive="onSheetScroll"
        >
          <!-- OWNED: your skins for the slot's weapon -->
          <template v-if="sheetMode === 'owned'">
            <button
              data-role="craft-tile"
              class="animate-sheet-in flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]"
              :class="sheetRows ? 'w-full px-2.5 py-2' : 'h-full flex-col'"
              :style="{ '--i': 0 }"
              @click="sheetMode = 'craft'"
            >
              <Plus :class="sheetRows ? 'h-4 w-4 flex-none' : 'h-6 w-6'" />
              <span class="max-w-full truncate px-2 text-f11 font-semibold uppercase tracking-wider">Craft {{ sheetWeaponName }}</span>
            </button>
            <!-- Stock/default item for special slots (agent, knife, gloves,
                 zeus, c4, music kit) — equipping it = reverting the slot. -->
            <button
              v-if="isSpecial(selected) && specialDefault(selected)"
              data-role="skin"
              class="animate-sheet-in relative overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-muted-foreground/40"
              :class="[SHEET_ENTRY, !isSkinned(rowFor(selected)) ? 'border-[color:var(--acc)]' : 'border-border']"
              :style="{ '--i': 1 }"
              @click="clearSlot(selected)"
            >
              <div :class="SHEET_ART">
                <img
                  :src="specialDefault(selected)?.image ?? undefined"
                  alt=""
                  class="max-h-full max-w-full object-contain"
                  :class="selected === 'agent' && ART_FADE_B"
                />
              </div>
              <div :class="SHEET_LABEL">
                <div class="truncate text-f13 font-medium text-muted-foreground">{{ specialDefault(selected)?.name ?? 'Default' }}</div>
                <div class="text-f9 uppercase tracking-cs1 text-muted-foreground/60">Default · {{ isShared(selected) ? 'CT + T' : team }}</div>
              </div>
            </button>
            <button
              v-if="isWeaponPos(selected) && occupantWeapon(selected)"
              data-role="skin"
              class="animate-sheet-in relative overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-muted-foreground/40"
              :class="[SHEET_ENTRY, !isSkinned(rowFor(selected)) ? 'border-[color:var(--acc)]' : 'border-border']"
              :style="{ '--i': 1 }"
              @click="equipDefaultAt(occupantWeapon(selected)!, selected)"
            >
              <div :class="SHEET_ART">
                <img :src="occupantWeapon(selected)!.image ?? undefined" alt="" class="max-h-full max-w-full object-contain" />
              </div>
              <div :class="[SHEET_LABEL, 'truncate text-f13 font-medium text-muted-foreground']">Default</div>
            </button>
            <!-- draggable: drop it on any eligible loadout slot (grid, rail,
                 focus rail) — clicking still equips into the selected slot.
                 On touch a tap opens the action menu instead: instant-equip
                 plus fingernail-sized hover icons made the tiles a minefield,
                 and the menu's Equip rows are the same one tap anyway. -->
            <template v-for="(st, idx) in ownedWindow.items.value" :key="st.key">
              <!-- A deck is not an item: it has no float to drag onto a slot and
                   no single instance to equip, so it gets a plain card whose only
                   verb is "open me" rather than an ItemTile with actions that
                   would each need an owner. -->
              <div v-if="st.variants.length > 1" class="relative h-full" :class="sheetCellClass(idx)" :style="{ '--i': idx + 2 }">
                <span
                  v-for="(hex, i) in st.behind"
                  :key="i"
                  class="pointer-events-none absolute inset-0 rounded-lg border"
                  :style="{
                    transform: `rotate(${i === 0 ? -5 : 5}deg) scale(0.88)`,
                    transformOrigin: 'bottom center',
                    borderColor: hex,
                    background: `color-mix(in srgb, ${hex} 70%, hsl(var(--card)))`,
                  }"
                ></span>
                <button
                  data-role="skin"
                  class="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
                  :style="st.face.item?.rarity ? { borderBottom: `3px solid ${st.face.item.rarity}` } : {}"
                  @click="sheetDesign = st.face.item?.design ?? null"
                >
                  <span class="pointer-events-none absolute inset-0" :style="glowStyle(st.face.item?.rarity, 0.22)"></span>
                  <span class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 font-mono text-f8 text-[color:var(--acc)]">
                    <Palette class="h-2.5 w-2.5" /> {{ st.variants.length }}
                  </span>
                  <div :class="CARD_ART">
                    <img
                      :src="st.face.item?.image ?? undefined"
                      alt=""
                      loading="lazy" decoding="async"
                      class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105"
                    />
                  </div>
                  <ItemName
                    :item="{ ...st.face.item, name: (st.face.item?.name ?? '').replace(TINT_SUFFIX, '') }"
                    strip
                    class="relative z-[2]"
                  />
                </button>
              </div>
              <ItemTile
                v-else
                :inst="st.face"
                :class="sheetCellClass(idx)"
                :style="{ '--i': idx + 2 }"
                draggable="true"
                @dragstart="onTileDragStart(st.face, $event)"
                @dragend="onTileDragEnd"
                strip-weapon-name
                show-header
                :row="sheetRows"
                :active="String(rowFor(selected)?.item_instance_id) === String(st.face.id)"
                @click="tapOpensMenu ? openItemCtxFor(st.face) : equipInstanceAt(st.face, selected)"
                @contextmenu.prevent="openItemCtx(st.face, $event)"
                @longpress="openItemCtxFor(st.face)"
                @view3d="view3dForInstance(st.face)"
                @inspect="openInspectLink(st.face.id)"
                @edit="openEdit(st.face)"
                @duplicate="openEdit(st.face)"
                @remove="deleteOwned(st.face)"
              />
            </template>
            <InfiniteSentinel
              :count="ownedWindow.items.value.length"
              :done="ownedWindow.done.value"
              @hit="ownedWindow.grow"
            />
          </template>

          <!-- CRAFT: full catalog for the slot's weapon -->
          <template v-else-if="sheetMode === 'craft'">
            <!-- Fixed height, and it does not take the grid's place: this used to
                 be `v-if="sheetLoading"` against a `v-else` holding the whole
                 catalog, so switching weapons collapsed the grid to one centred
                 line and then re-expanded it. Reserving the row instead means the
                 spinner costs the layout nothing. -->
            <div v-if="sheetLoading" class="col-span-full flex h-11 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" /> Loading finishes…
            </div>
            <template v-else>
              <!-- The wrapper exists so the "deck" layers can sit OUTSIDE the
                   card: the card itself is overflow-hidden (the art scales on
                   hover) and would clip them. -->
              <div
                v-for="(st, idx) in craftWindow.items.value"
                :key="st.key"
                class="relative h-full"
                :class="sheetCellClass(idx)"
                :style="{ '--i': idx }"
              >
                <!-- Fanned out from the bottom edge and wearing two of the
                     OTHER colourways, so a stack says "this also comes in
                     nineteen colours" without having to be read.
                     The scale is what keeps it neighbourly: the card fills its
                     whole grid cell, so anything visible behind it is out in
                     the gap, and 0.88 at 5° puts the corners ~5px out — half
                     the gap, so two adjacent stacks never touch. Saturated,
                     because 5px of a wash is 5px of nothing. -->
                <span
                  v-for="(hex, i) in st.behind"
                  :key="i"
                  class="pointer-events-none absolute inset-0 rounded-lg border"
                  :style="{
                    transform: `rotate(${i === 0 ? -5 : 5}deg) scale(0.88)`,
                    transformOrigin: 'bottom center',
                    borderColor: hex,
                    background: `color-mix(in srgb, ${hex} 70%, hsl(var(--card)))`,
                  }"
                ></span>
                <button
                  data-role="skin"
                  class="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
                  :style="st.face.rarity ? { borderBottom: `3px solid ${st.face.rarity}` } : {}"
                  @click="st.variants.length > 1 ? (sheetDesign = st.face.design ?? null) : openCraft(st.face)"
                >
                  <span class="pointer-events-none absolute inset-0" :style="glowStyle(st.face.rarity, 0.22)"></span>
                  <!-- A stack isn't craftable as such — you pick a colour first
                       — so it says how many rather than offering the hammer. -->
                  <span
                    v-if="st.variants.length > 1"
                    class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 font-mono text-f8 text-[color:var(--acc)]"
                  >
                    <Palette class="h-2.5 w-2.5" /> {{ st.variants.length }}
                  </span>
                  <span
                    v-else
                    class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 text-f8 uppercase text-[color:var(--acc)] opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Hammer class="h-2.5 w-2.5" /> Craft
                  </span>
                  <div :class="CARD_ART">
                    <img
                      :src="catalogArt[st.card.id] ?? st.card.image ?? undefined"
                      alt=""
                      loading="lazy" decoding="async"
                      class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105"
                      :class="sheetKey === 'agent' && ART_FADE_B"
                      @error="onCatalogArtError($event, st.card)"
                    />
                  </div>
                  <ItemName :item="st.card" strip class="relative z-[2]" />
                </button>
              </div>
              <InfiniteSentinel
                :count="craftWindow.items.value.length"
                :done="craftWindow.done.value"
                @hit="craftWindow.grow"
              />
              <div v-if="!craftStacks.length" class="col-span-full py-8 text-center text-sm text-muted-foreground">
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
              class="animate-sheet-in relative overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-[color:var(--acc)]"
              :class="SHEET_ENTRY"
              :style="{ '--i': idx }"
              @click="equipDefaultAt(w, selected)"
            >
              <div :class="SHEET_ART">
                <img :src="w.image ?? undefined" alt="" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain" />
              </div>
              <div :class="SHEET_LABEL">
                <div class="truncate text-f13 font-medium">{{ w.name }}</div>
                <div class="mt-0.5 text-f8 uppercase tracking-wider text-muted-foreground/60">Default</div>
              </div>
            </button>
            <button
              v-for="(i, idx) in replaceOptions.owned"
              :key="'own' + i.id"
              data-role="skin"
              class="animate-sheet-in relative overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-[color:var(--acc)]"
              :class="SHEET_ENTRY"
              :style="[
                { '--i': replaceOptions.defaults.length + idx },
                i.item?.rarity ? (sheetRows ? { borderLeft: `3px solid ${i.item.rarity}` } : { borderBottom: `3px solid ${i.item.rarity}` }) : {},
              ]"
              @click="equipInstanceAt(i, selected)"
              @contextmenu.prevent="openItemCtx(i, $event)"
            >
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(i.item?.rarity, 0.22)"></span>
              <div :class="[SHEET_ART, 'relative z-[2]']">
                <img :src="i.item?.image ?? undefined" alt="" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain" />
              </div>
              <div :class="[SHEET_LABEL, 'relative z-[2] flex items-center gap-1.5']">
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

        <!-- A fade over the last row so the list visibly runs off the edge
             instead of ending flush against it. Clears when you reach the
             bottom, so it never lies.
             Desktop too: the picker is a short scroller inside a panel there
             as well, and "is that everything?" is the same question at any
             width — the scrollbar answers it only if you go looking. -->
        <div
          v-if="sheetHasMore"
          class="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-background via-background/70 to-transparent"
          :class="isCompact ? 'h-10' : 'h-12'"
        ></div>
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
    <!-- Backdrop click unwinds ONE layer, same rule as the Escape chain: with the
         attachment picker up it closes back to the editor rather than throwing the
         whole craft away. Dismissing a picker must never discard the edit behind
         it — that's a lost sticker placement, not a closed dialog. -->
    <!-- Compact goes edge to edge: the inset, the rounding and the border are
         desktop affordances that say "this is a layer over your inventory".
         On a phone there is nothing else on screen for it to be a layer OVER,
         so all they did was spend ~70px of width and ~100px of height — most
         of it out of the 3D viewer, which is the whole reason to open this. -->
    <div
      v-if="craft"
      class="fixed inset-0 z-[999] flex items-center justify-center bg-background/85 backdrop-blur-sm"
      :class="isCompact ? 'p-0' : 'p-4'"
      @click.self="picker ? (picker = null) : closeCraft()"
    >
      <div
        class="relative flex flex-col overflow-hidden bg-card shadow-2xl animate-pop-in"
        :class="isCompact
          ? 'h-full w-full'
          : 'h-[min(92vh,940px)] w-[min(96vw,1320px)] rounded-lg border border-border'"
      >
        <div class="flex items-center justify-between border-b border-border" :class="isCompact ? 'gap-2 px-3 py-2' : 'px-4 py-2.5'">
          <!-- Provenance and where it's equipped belong to the item's IDENTITY,
               not its spec — "this is your Steam one, and it's on T" is part of
               answering "which item am I looking at". So they ride with the name
               rather than sitting in the readout column with wear and pattern. -->
          <span v-if="viewOnly" class="flex min-w-0 items-center gap-2">
            <!-- Compact drops the name: the plate under the model already
                 carries it, and a second copy up here was buying a duplicate
                 with the room the action buttons need to be thumb-sized. The
                 provenance icon and equip dots stay — those appear nowhere
                 else on this screen. -->
            <ItemName v-if="!isCompact" :item="craft.skin" class="min-w-0 truncate" name-class="text-f13 font-semibold uppercase tracking-cs1" />
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
              v-if="!isCoarse && signedIn && canInspect(viewOnly ? craftInst?.item : craft.skin)"
              class="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              :title="viewOnly ? 'Launch CS2 and inspect this item in-game' : 'Launch CS2 and inspect exactly what\'s in the editor right now — saving not required'"
              @click="viewOnly && craftInstId != null ? openInspectLink(craftInstId) : openCraftInspect()"
            >
              <ExternalLink class="h-3 w-3" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
            </button>
            <ShareMenu
              :links="craftShareLinks"
              :note="route.name === 'draft' ? undefined : ITEM_LINK_NOTE"
              :btn-class="isCompact ? MODAL_HEAD_BTN : undefined"
            />
            <!-- Also in the footer, deliberately. This row is where the eye goes
                 for "what can I do with this item", and on a tall spec column the
                 footer copy can be a scroll away. Icon-only and square, paired
                 with the trash: same handler and same read-only Craft branch as
                 the footer button, so it's one control in two places. -->
            <button
              v-if="viewOnly && canEdit && craftInst && isCustomizable(craftInst.item)"
              class="grid place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              :class="isCompact ? 'h-10 w-10' : 'h-7 w-7'"
              :title="isReadOnly(craftInst) ? 'Synced from Steam and read-only — craft your own copy of it' : 'Edit this item'"
              @click="craftViewEdit"
            >
              <Copy v-if="isReadOnly(craftInst)" :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" /><Pencil v-else :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
            </button>
            <!-- Destructive, so it keeps its distance from the action row at the
                 bottom and lives up here beside Close, the way it did on the
                 detail modal this screen replaced. -->
            <button
              v-if="viewOnly && craftInst && canEdit"
              class="grid place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]"
              :class="isCompact ? 'h-10 w-10' : 'h-7 w-7'"
              title="Delete from inventory"
              @click="deleteOwned(craftInst, closeCraft)"
            >
              <Trash2 :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
            </button>
            <button
              v-if="!viewOnly"
              class="flex items-center gap-1.5 rounded-md border border-border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              :class="isCompact ? 'h-10 px-3 text-f11 uppercase tracking-wider' : 'px-2.5 py-1 text-f10 uppercase tracking-wider'"
              title="Reset all options"
              @click="resetCraft"
            >
              <RotateCcw :class="isCompact ? 'h-4 w-4' : 'h-3 w-3'" /> Reset
            </button>
            <!-- Was a bare ✕ glyph with no box: a ~14px target, and the single
                 most-used control on the screen. -->
            <button
              class="grid place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              :class="isCompact ? 'h-10 w-10 border border-border' : 'h-7 w-7'"
              title="Close"
              @click="closeCraft()"
            >
              <X :class="isCompact ? 'h-5 w-5' : 'h-4 w-4'" />
            </button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-wrap overflow-y-auto" :class="isCompact ? 'gap-3 p-2' : 'gap-5 p-5'">
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
                <img
                  :src="craftPreview ?? craft.skin.image ?? undefined"
                  alt=""
                  class="max-h-full max-w-full object-contain drop-shadow-[0_28px_30px_rgba(0,0,0,0.45)]"
                  :class="craftIsAgent && ART_FADE_B"
                  @error="craftPreview = null"
                />
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
                  class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
                  :style="{
                    transform: `translateX(${modal3dPill.x.value}px)`,
                    width: modal3dPill.w.value + 'px',
                    border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                    background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                    boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                    transition: pillTransition(modal3dPill.animated.value),
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
            <!-- Footer. The report link used to hold a column of its own on the
                 same baseline as the name and the controls legend, which meant
                 the name — the one thing here anyone reads — was squeezed
                 between two pieces of chrome and truncated first. It now stacks
                 ABOVE the controls in a single side column, so the name plate
                 gets the width back and stays optically centred under the
                 model. -->
            <!-- Desktop keeps the three-column baseline so the name plate stays
                 optically centred under the model with the chrome beside it.
                 Compact STACKS: at phone width the centre column collapses to
                 whatever's left after the controls legend, which pushed the
                 name into a narrow ribbon with dead space either side of it.
                 Full width each, name first — it's the line people read. -->
            <div
              class="w-full"
              :class="isCompact
                ? 'mb-1 flex flex-col gap-1.5'
                : 'mb-3 grid grid-cols-[1fr_auto_1fr] items-end gap-3 pb-1'"
            >
              <div :class="isCompact ? 'w-full text-center' : 'col-start-2 text-center'">
                <div class="mx-auto mb-1.5 h-px" :class="isCompact ? 'w-40' : 'w-28'" :style="{ background: `linear-gradient(90deg, transparent, ${craft.skin.rarity}, transparent)` }"></div>
                <div class="text-f11 uppercase tracking-cs1 text-muted-foreground">{{ editingId != null || duplicating ? (weaponByModel.get(craftModel ?? '')?.name ?? sheetWeaponName) : sheetWeaponName }}</div>
                <ItemName :item="craft.skin" strip name-class="text-f13 font-semibold" :style="{ color: craft.skin.rarity }" />
              </div>
              <!-- Controls legend. Overlaying the model put it on top of the
                   thing being dragged; on the footer baseline it sits out of the
                   way but still in eyeline. Compact spreads report and legend to
                   opposite ends of their own full-width row. -->
              <div
                v-if="modal3d"
                :class="isCompact
                  ? 'flex w-full items-center justify-between gap-3'
                  : 'col-start-1 row-start-1 flex flex-col items-start gap-1 justify-self-start'"
              >
                <a
                  :href="craftReportHref"
                  target="_blank"
                  rel="noopener noreferrer"
                  :class="[REPORT_LINK, 'min-w-0 truncate']"
                  title="Open a GitHub issue pre-filled with this item's details"
                >
                  Report a problem
                </a>
                <!-- The legend is fixed-size chrome; the link is the elastic
                     half of this row. Without the two rules the link's text
                     wrapped to a second line at phone widths and shoved the
                     legend down with it. -->
                <ViewerControls class="flex-none" :edit="!viewOnly" :rotate="craft.stickers.some(Boolean)" />
              </div>
            </div>
          </div>
          <!-- Options (edit) / spec (view). Same column, same boxes, same
               order — view mode just states what edit mode lets you change.
               `sheet-settled`: the two modes are separate template branches, so
               a view↔edit flip mounts a fresh set of boxes — without the gate
               they replay the staggered entrance from opacity:0 and the column
               goes blank mid-flip. The cascade belongs to the modal OPENING. -->
          <!-- The 300px cap is a READING-WIDTH cap for the desktop two-column
               layout, where this column sits beside the preview. On compact it
               wraps under the preview and owns the whole modal, so the cap just
               left a dead gutter down the right-hand side. -->
          <div
            v-if="craftHasOptions"
            class="flex w-full flex-none flex-col gap-2.5"
            :class="[{ 'sheet-settled': craftSettled }, !isCompact && 'max-w-[300px]']"
          >
            <template v-if="!viewOnly">
            <!-- FIRST, above the attachment slots. The name is the one field
                 that is pure text entry and it applies to the item itself
                 rather than to a slot on it — buried under five sticker wells
                 it read as an afterthought. -->
            <label
              v-if="!['agent', 'musickit', 'graffiti'].includes(selected)"
              class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5"
              :style="{ '--i': 0 }"
            >
              <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Name tag</span>
              <input
                v-model="craft.nametag"
                maxlength="24"
                placeholder="Type a custom name…"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
              />
            </label>
            <div v-if="attachKind === 'agent'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 1 }">
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
                  <span
                    v-if="pt"
                    class="absolute -left-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-[color:var(--acc)] group-hover/pt:opacity-100"
                    :title="`View ${pt.name} in 3D`"
                    @click.stop="openPreview3d(pt, 'patch')"
                  ><Box class="h-3 w-3" /></span>
                </button>
              </div>
            </div>
            <div v-if="attachKind === 'weapon'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 1 }">
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
                  <!-- Inspect what is ALREADY on the weapon. Without it the only
                       way to see a sticker in 3D was to re-open the picker and
                       find it again, which is backwards once it is applied. -->
                  <span
                    v-if="st"
                    class="absolute -left-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-[color:var(--acc)] group-hover/st:opacity-100"
                    :title="`View ${st.name} in 3D`"
                    @click.stop="openPreview3d(st, 'sticker')"
                  ><Box class="h-3 w-3" /></span>
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
            <div v-if="attachKind === 'weapon'" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 2 }">
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
                  <span
                    v-if="craft.charm"
                    class="absolute -left-1 -top-1 z-[2] rounded-full bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-[color:var(--acc)] group-hover/ch:opacity-100"
                    :title="`View ${craft.charm.name} in 3D`"
                    @click.stop="openPreview3d(craft!.charm, 'charm')"
                  ><Box class="h-3 w-3" /></span>
                </button>
                <span v-if="craft.charm" class="truncate text-f10 text-muted-foreground">{{ craft.charm.name }}</span>
              </div>
              <!-- A charm carries its own pattern, exactly as the weapon does,
                   and it is a tradeable attribute rather than a placement
                   detail — so it sits with the charm itself and NOT behind
                   Advanced with the x/y/z nudges. Same label / field / die
                   rhythm as the weapon's Pattern row so the two read as the
                   same control for the same idea. -->
              <div v-if="craft.charm" class="mt-2 flex items-center gap-2">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>
                <input
                  v-model.number="craft.charm.seed"
                  type="number" min="0" max="100000" placeholder="0"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
                />
                <button class="grid h-9 w-9 flex-none place-items-center rounded-md border border-input text-f13 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground" title="Random charm pattern" @click="randomCharmSeed">🎲</button>
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
            <div v-if="craftHasSeed" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
              <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>
              <!-- flex-1, not a fixed width: Pattern sat at w-24 and Wear at
                   w-28, so two stacked rows with the same label column ended in
                   fields of different lengths and a pocket of dead space before
                   each die. Filling the row is what the Name tag input above
                   already does — this makes the whole stack one column. -->
              <input
                v-model.number="craft.seed"
                type="number" min="1" max="1000"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
              />
              <button class="grid h-9 w-9 flex-none place-items-center rounded-md border border-input text-f13 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground" title="Random pattern" @click="randomSeed">🎲</button>
            </div>
            <div v-if="craftHasWear" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
              <div class="flex items-center gap-2">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <input
                  v-model.number="craft.wear"
                  type="number" min="0" max="1" step="0.0001"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
                />
                <button class="grid h-9 w-9 flex-none place-items-center rounded-md border border-input text-f13 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground" title="Random wear" @click="randomWear">🎲</button>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="craft.wear" type="range" min="0" max="1" step="0.0001" class="wear-range w-full" />
              </div>
              <div class="mt-1 text-right font-mono text-f9 text-muted-foreground">{{ wearTier(craft.wear) }}</div>
            </div>
            <div
              v-if="craftHasStatTrak"
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
              <!-- Name tag leads here too — the read-only spec has to list the
                   same things in the same order as the form, or switching modes
                   reshuffles the panel under the cursor. -->
              <div v-if="craft.nametag" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 0 }">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Name tag</span>
                <span class="min-w-0 flex-1 truncate text-f13 italic">“{{ craft.nametag }}”</span>
              </div>
              <div v-if="craftInst && attachmentsOf(craftInst).length" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 1 }">
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
              <div v-if="craftInst?.seed != null" class="animate-sheet-in flex items-center gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 2 }">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>
                <span class="font-mono text-f13">#{{ craftInst.seed }}</span>
              </div>
              <div v-if="craftInst?.wear != null" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
                <div class="flex items-baseline gap-2">
                  <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                  <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ wearTier(craftInst.wear) }}</span>
                </div>
                <div class="mt-2"><WearBar :item="craftInst.item" :wear="craftInst.wear" /></div>
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
            <!-- Says where it goes. A bare ✕ in the same corner as the craft
                 modal's own ✕ reads as "close everything", which is the one thing
                 it must not do — the edit underneath is unsaved. -->
            <button
              class="flex flex-none items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
              title="Back to the editor — nothing is applied"
              @click="picker = null"
            >
              <X class="h-3.5 w-3.5" /> Back
            </button>
          </div>

          <!-- Facet bar. Counts are on every control on purpose: with 10.5k
               stickers the useful question is never "does this exist" but "how
               much am I about to wade through". Each NARROWING control hides
               itself when the catalog behind it has nothing to split (patches have
               no groups and no collections, so a patch picker shows rarity alone),
               while the bar itself always renders — Sort is always meaningful, and
               a bar that can vanish could strand an active filter with no visible
               control to switch it off. -->
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <!-- Same sliding-pill animated tabs as every other tab group, with
                 the list driven by the facets rather than hardcoded. -->
            <div
              v-if="pickerTabs.length > 1"
              :ref="(el) => pickerGroupPill.setListEl(el)"
              class="relative inline-flex h-8 flex-none items-center rounded-lg bg-muted p-1"
            >
              <div
                v-show="pickerGroupPill.w.value > 0"
                class="pointer-events-none absolute left-0 z-0 rounded-md"
          :class="isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
                :style="{
                  transform: `translateX(${pickerGroupPill.x.value}px)`,
                  width: pickerGroupPill.w.value + 'px',
                  border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
                  background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                  boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                  transition: pillTransition(pickerGroupPill.animated.value),
                }"
              ></div>
              <button
                v-for="g in pickerTabs"
                :key="g.value"
                :ref="(el) => pickerGroupPill.setRef(g.value, el)"
                class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
                :class="pickerGroup === g.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="setPickerFacet('group', g.value)"
              >
                {{ g.label }}
                <!-- Wider than the other count badges and square-cornered, not a
                     circle: these read "10.6k", where a pill sized for "12" put
                     the text against its own border.
                     FIXED width, not min-width, and tabular figures: the count is
                     the one thing here that changes while you type, and letting it
                     size itself resized the TAB — which moved every tab after it
                     and dragged the sliding indicator along, on every keystroke.
                     Sized for "10.6k", the widest value the formatter emits. -->
                <span class="ml-1.5 inline-flex h-[15px] w-[34px] flex-none items-center justify-center rounded border border-border bg-background/70 px-1 font-mono text-f9 leading-none tabular-nums">{{ fmtCount(g.count) }}</span>
              </button>
            </div>
            <FilterDropdown
              v-if="pickerCollections.length > 1"
              :model-value="pickerCollection"
              :options="pickerCollectionOptions"
              prefix="Collection"
              @update:model-value="setPickerFacet('collection', $event)"
            />
            <FilterDropdown
              v-if="pickerRarities.length > 1"
              :model-value="pickerRarity"
              :options="pickerRarityOptions"
              dots
              @update:model-value="setPickerFacet('rarity', $event)"
            />
            <button
              v-if="pickerFiltered"
              class="flex h-8 items-center gap-1.5 rounded-md px-2 text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:text-foreground"
              @click="clearPickerFacets"
            >
              <X class="h-3 w-3" /> Clear
            </button>
            <!-- Sort sits apart from the narrowing controls: it changes the ORDER
                 of the same set, so Clear has nothing to do with it. -->
            <FilterDropdown
              class="ml-auto"
              :model-value="pickerSort"
              :options="PICKER_SORTS"
              prefix="Sort"
              @update:model-value="setPickerSort"
            />
            <SortDirection
              :model-value="pickerDir"
              :kind="PICKER_SORT_KIND[pickerSort]"
              :hint="PICKER_DIR_HINT[pickerSort][pickerDir]"
              @update:model-value="setPickerDir"
            />
          </div>

          <!-- The results are NOT unmounted while the next set loads. They used to
               be — `v-if="pickerLoading"` swapped the whole grid for a centred
               "Searching…" — so every keystroke collapsed the grid to one line,
               jumped the scroll height and popped it back. Now the outgoing set
               dims in place and the incoming one waves in over it, which is the
               same treatment the inventory grid gives a filter change. -->
          <div
            ref="pickerScrollEl"
            data-scroller
            class="flex-1 content-start gap-2 overflow-y-auto transition-opacity duration-200 ease-out"
            :class="pickerLoading ? 'opacity-45' : 'opacity-100'"
            :style="attachGridStyle"
          >
            <!-- Rarity is read the same way as on a weapon card: the tier's colour
                 as a bottom rule plus a soft glow behind the art. Without it the
                 grid is a wall of identical grey boxes and the one attribute that
                 sorts them is invisible. -->
            <!-- animate-cell-in is the loadout grid's stagger, reused — but ONLY
                 for the first page. cs2CellIn is `both`-filled with a delay, so an
                 appended tile holds opacity 0 for up to 420ms while the grid has
                 ALREADY grown to fit it: you scroll, the layout jumps down, and
                 the stickers fade in afterwards. That is the infinite-scroll jank.
                 Pages after the first appear immediately; there is nothing to
                 announce, they were prefetched below the fold on purpose.
                 Honours prefers-reduced-motion via the global animate-* rule. -->
            <button
              v-for="(it, i) in pickerResults"
              :key="it.id"
              class="cv-tile group relative flex h-full flex-col items-center overflow-hidden rounded-md border border-border bg-background p-1.5 transition-colors hover:border-[color:var(--acc)]"
              :class="i < PICKER_PAGE ? 'animate-cell-in' : ''"
              :style="{ ...(it.rarity ? { borderBottom: `3px solid ${it.rarity}` } : {}), '--i': i, '--cis': attachCardSize + 12 + 'px' }"
              :title="it.name"
              @click="pickAttachment(it)"
            >
              <span class="pointer-events-none absolute inset-0" :style="glowStyle(it.rarity, 0.22)"></span>
              <!-- Inspect before committing. A `button` inside the tile's button
                   is invalid HTML, so this is a span with a click that stops
                   propagation — otherwise picking is the only thing a tile can
                   do, and choosing a holo sticker from a flat icon is a guess. -->
              <span
                role="button"
                tabindex="0"
                class="absolute right-1 top-1 z-[3] hidden items-center justify-center rounded border border-border bg-background/90 p-1 text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-[color:var(--acc)] group-hover:flex"
                :title="`View ${it.name} in 3D`"
                @click.stop="openPreview3d(it, picker?.kind ?? 'sticker')"
                @keydown.enter.stop.prevent="openPreview3d(it, picker?.kind ?? 'sticker')"
              ><Box class="h-3.5 w-3.5" /></span>
              <div :class="CARD_ART" class="relative z-[2]">
                <!-- decoding="async" keeps the decode off the main thread. With
                     `lazy`, a fast scroll brings dozens of images into view at
                     once and the default synchronous decode lands all of them in
                     the scroll frames — the "logos rendering in" stutter. -->
                <img :src="it.image ?? undefined" alt="" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-110" />
              </div>
              <span class="relative z-[2] w-full truncate text-center text-f8 text-muted-foreground">{{ it.name.replace(/^(Sticker|Charm|Sticker Slab) \| /, '') }}</span>
            </button>
            <div v-if="!pickerLoading && !pickerResults.length" class="col-span-full animate-fade-in py-8 text-center text-f13 text-muted-foreground">
              No results — try a different search.
            </div>
            <!-- Scrolling to the bottom pulls the next page. `done` also carries
                 the first-page spinner: without it the sentinel is on screen
                 under an empty grid and would fire a second, duplicate page.
                 A deeper rootMargin than the 500px default: one page is 120 tiles,
                 which at any card size is several screens, so firing further ahead
                 costs one request that was coming anyway and buys the page landing
                 before you reach the end — the difference between infinite scroll
                 and scroll-then-wait. -->
            <InfiniteSentinel
              :count="pickerResults.length"
              :done="pickerDone || pickerLoading"
              root-margin="1200px"
              @hit="pickerMore"
            />
          </div>
          <!-- OUTSIDE the scroller, and a fixed height that is always present.
               This row used to be the last cell of the grid, so it was pushed down
               by every appended page and its own content swaps ("Loading more…"
               has a spinner, "1200 of 10565" does not) resized it mid-scroll. A
               loading state must not be able to move anything: as a sibling of the
               scroll area it is outside the grid's layout entirely, it reserves
               its space whether or not there is anything to say, and the status
               text now stays visible instead of scrolling away. -->
          <div class="flex h-11 flex-none items-center justify-center gap-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
            <template v-if="pickerLoading"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Searching…</template>
            <template v-else-if="pickerLoadingMore"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading more…</template>
            <!-- Nothing to say on an empty result set; `h-11` holds the space
                 regardless, so the grid above never resizes either way. -->
            <template v-else-if="!pickerResults.length"></template>
            <template v-else-if="pickerDone">{{ pickerTotal }} {{ pickerNoun }}</template>
            <template v-else>{{ pickerResults.length }} of {{ pickerTotal }}</template>
          </div>
        </div>
        </Transition>

        <!-- Attachment preview — a SIBLING of the picker's Transition, not a
             child of it: <Transition> takes exactly one child, and nesting this
             inside it silently stopped the picker from opening at all.
             z-1400 puts it above the picker (z-1300) it is opened from.
             Deliberately a small panel rather than a full stage — the picker
             keeps its scroll position and its search, so this is a look, not a
             detour. -->
        <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
          <div
            v-if="preview3d"
            class="fixed inset-0 z-[1400] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
            @click.self="closePreview3d()"
          >
            <div class="flex w-full max-w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
              <div class="flex items-center gap-2 border-b border-border px-3 py-2">
                <span class="min-w-0 flex-1 truncate text-f11 uppercase tracking-cs1">{{ preview3d.name }}</span>
                <button
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                  title="Close"
                  @click="closePreview3d()"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
              <!-- Square: a sticker is square, a charm is portrait, and a fixed
                   aspect keeps the panel from resizing as you flick between them. -->
              <div class="relative aspect-square w-full bg-background">
                <div ref="preview3dEl" class="absolute inset-0" />
                <div v-if="preview3dBusy" class="pointer-events-none absolute inset-0 grid place-items-center">
                  <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Same row, same positions in both modes: dismiss on the left, the
             commit on the right. Editing commits a change to the item; viewing
             commits it to your loadout — so Equip inherits Save's slot. -->
        <!-- Every button in this row is the same BOX: h-9, rounded-md, px-4, f11,
             1px border (transparent on the filled ones). What separates the
             primary action is the amber fill, not extra size. Getting there took
             three passes, so the traps, in the order they bit:
               · height came from padding + line-height, and f13 text is taller
                 than f11 — pinning h-9 is what actually equalises them;
               · `0 2px 0` under the CTA paints a hard bar BELOW the box, which
                 reads as two more pixels of button. It's a soft blur now;
               · rounded-sm vs rounded-md makes two same-size boxes look like
                 different sizes at the corners.
             Change one of these and change all of them. -->
        <div class="flex items-center justify-end border-t border-border" :class="isCompact ? 'gap-2 px-3 py-2.5' : 'gap-3 px-5 py-3.5'">
          <button class="flex h-9 items-center rounded-md border border-transparent px-4 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground" @click="closeCraft()">{{ viewOnly ? 'Close' : 'Cancel' }}</button>
          <!-- Edit is secondary here: it changes the item, but equipping it is
               what you came to decide. -->
          <button
            v-if="viewOnly && canEdit && craftInst && isCustomizable(craftInst.item)"
            class="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground"
            :title="isReadOnly(craftInst) ? 'Synced from Steam and read-only — craft your own copy of it' : 'Edit this item'"
            @click="craftViewEdit"
          >
            <Copy v-if="isReadOnly(craftInst)" class="h-3.5 w-3.5" /><Pencil v-else class="h-3.5 w-3.5" />
            {{ isReadOnly(craftInst) ? 'Craft' : 'Edit' }}
          </button>
          <button
            v-if="viewOnly && canEdit"
            class="flex h-9 items-center gap-1.5 rounded-md border border-transparent px-4 text-f11 font-bold uppercase tracking-wider text-black transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style="background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16)); box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)"
            :disabled="!craftEquipTarget"
            :title="craftEquipTarget ? 'Equip on ' + team : 'Not usable by ' + team"
            @click="craftViewEquip"
          >
            <template v-if="craftEquipTarget">Equip</template>
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
            class="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-f11 font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="craftBusy || !signedIn"
            title="Save these changes as a new item, leaving the original untouched"
            @click="duplicateCraft"
          >
            <Copy class="h-3.5 w-3.5" /> Copy
          </button>
          <button
            v-if="!viewOnly"
            class="flex h-9 items-center gap-1.5 rounded-md border border-transparent px-4 text-f11 font-bold uppercase tracking-wider text-black transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            style="background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16)); box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)"
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
        data-sheet
        :class="isCompact
          ? 'absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl'
          : 'absolute min-w-[204px] origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl'"
        :style="isCompact ? swipeStyle : { left: (ctx?.x ?? 0) + 'px', top: (ctx?.y ?? 0) + 'px' }"
        @click.stop
      >
        <!-- The WHOLE header is the grab area, pill and title together. A 20px
             pill is not a target anyone hits on a phone, and a swipe that
             misses it lands on the page — where the browser reads it as
             pull-to-refresh and reloads the panel out from under you.
             touch-none is what denies the browser that gesture; it has to be on
             the element the finger actually starts on, hence the whole strip. -->
        <div v-if="isCompact" class="touch-none border-b border-border" v-on="slotMenuSwipe">
          <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
          <div class="px-3 pb-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
            {{ ctx ? (occupantWeapon(ctx.pos)?.name ?? ctx.pos) : '' }}
          </div>
        </div>
        <div v-else class="border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          {{ ctx ? (occupantWeapon(ctx.pos)?.name ?? ctx.pos) : '' }}
        </div>
        <!-- 3D leads, same as the item menu: looking at the gun is the most
             common reason this menu gets opened, and it's the one row that
             never depends on what's already in the slot. -->
        <button
          v-if="ctx3dOk"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="ctxView3d"
        >
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <button class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="ctxOwned">
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
          v-if="ctx && equippedInstance(ctx.pos) && !isCoarse && canInspect(equippedInstance(ctx.pos)?.item)"
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
      <!-- Edge to edge on compact, same reasoning as the craft modal above. -->
      <div
        v-if="loadout3d"
        class="fixed inset-0 z-[998] flex items-center justify-center bg-background"
        :class="isCompact ? 'p-0' : 'p-6'"
        @click="dismissLoadout3d"
      >
        <div
          class="relative flex flex-col overflow-hidden bg-card shadow-2xl animate-pop-in"
          :class="isCompact
            ? 'h-full w-full'
            : 'h-[min(88vh,900px)] w-[min(96vw,1400px)] rounded-lg border border-border'"
          @click.stop
        >
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
        data-sheet
        :class="isCompact
          ? 'absolute inset-x-0 bottom-0 max-h-[80%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-card shadow-2xl'
          : 'absolute min-w-[214px] origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl'"
        :style="isCompact ? swipeStyle : { left: (itemCtx?.x ?? 0) + 'px', top: (itemCtx?.y ?? 0) + 'px' }"
        @click.stop
      >
        <!-- Same whole-header grab area as the slot menu above. -->
        <div v-if="isCompact" class="sticky top-0 z-[2] touch-none border-b border-border bg-card" v-on="itemMenuSwipe">
          <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
          <div class="truncate px-3 pb-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
            <ItemName :item="itemCtx?.inst.item" />
          </div>
        </div>
        <div v-else class="truncate border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          <ItemName :item="itemCtx?.inst.item" />
        </div>
        <!-- 3D leads. It is the only row that always applies — every equip
             below it can be already-done and greyed out, and looking at the
             thing is what you came for anyway. -->
        <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="itemCtxView3d">
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <!-- Equip rows go DISABLED, not hidden, once the item is already on
             that team: a menu whose rows move around between openings is worse
             than one with a dead row, and "Equipped on CT" answers the question
             the row would otherwise raise. -->
        <template v-if="itemCtxTeams === 'shared'">
          <button
            class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-f13 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="itemCtxSharedEquipped"
            @click="ctxEquipTeams(['CT', 'T'])"
          >
            <Crosshair class="h-3.5 w-3.5" /> {{ itemCtxSharedEquipped ? 'Equipped (CT + T)' : 'Equip (CT + T)' }}
          </button>
        </template>
        <template v-else-if="itemCtxTeams">
          <button
            v-for="(t, ti) in itemCtxTeams"
            :key="t"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            :class="ti === 0 && 'border-t border-border'"
            :disabled="itemCtxEquippedOn.has(t)"
            @click="ctxEquipTeams([t])"
          >
            <Crosshair class="h-3.5 w-3.5" /> {{ itemCtxEquippedOn.has(t) ? `Equipped on ${t}` : `Equip on ${t}` }}
          </button>
          <!-- Both-teams stays live while EITHER side is still open — it's the
               one-tap way to finish the pair. -->
          <button
            v-if="itemCtxTeams.length === 2"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="itemCtxSharedEquipped"
            @click="ctxEquipTeams(['CT', 'T'])"
          >
            <Copy class="h-3.5 w-3.5" /> {{ itemCtxSharedEquipped ? 'Equipped on both teams' : 'Equip on both teams' }}
          </button>
        </template>
        <button
          v-if="itemCtx && !['agent', 'graffiti', 'musickit'].includes(itemCtx.inst.slot ?? '')"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="itemCtxStatTrak"
        >
          <Sparkles class="h-3.5 w-3.5" /> {{ itemCtx.inst.stattrak ? 'Remove' : 'Add' }} StatTrak™
        </button>
        <button
          v-if="isCustomizable(itemCtx?.inst.item)"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted"
          @click="itemCtxEdit"
        >
          <Pencil class="h-3.5 w-3.5" /> Edit…
        </button>
        <button v-if="!isCoarse && canInspect(itemCtx?.inst.item)" class="flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted" @click="itemCtxInspect">
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
  </div>
</template>
