<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, provide, type ComputedRef } from "vue";
import { cn } from "@5stack/ui";
import { useI18n } from "./composables/useI18n";
import {
  Loader2, Search, LayoutGrid, Crosshair,
  Package, Hammer, Trash2, Copy, RotateCcw, Sparkles, Replace, RefreshCw, Pencil, Plus, X, Download, CheckSquare, Settings, Box, Clock,
  Image as ImageIcon, Check, ExternalLink, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, Palette, Link2,
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
  copyLoadoutFrom,
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
import AdminConsole from "./components/AdminConsole.vue";
import DevHud from "./components/DevHud.vue";
import { activeFlags, flagsVersion } from "./devFlags";
import CatalogFilters, { type FacetAxis } from "./components/CatalogFilters.vue";
import Armory from "./components/Armory.vue";
import ShareMenu from "./components/ShareMenu.vue";
import Tooltip from "./components/Tooltip.vue";
import { MDEBUG, mdebug, setMdebugAmbient, traceLayer } from "./mdebug";
import ItemArt from "./components/ItemArt.vue";
import ItemName from "./components/ItemName.vue";
import SlotStatus from "./components/SlotStatus.vue";
import WearBar from "./components/WearBar.vue";
import ItemTile from "./components/ItemTile.vue";
import TileActions from "./components/TileActions.vue";
import FilterDropdown from "./components/FilterDropdown.vue";
import InfiniteSentinel from "./components/InfiniteSentinel.vue";
import SortDirection from "./components/SortDirection.vue";
import PatternRail from "./components/PatternRail.vue";
import PatternScoreRail from "./components/PatternScoreRail.vue";
import { SCAN_READ_SIZE } from "./patternScan";
import { useRenderWindow, WINDOW_FIRST } from "./composables/useRenderWindow";
import ViewerControls from "./components/ViewerControls.vue";
import PillTabs from "./components/PillTabs.vue";
import DeckCard from "./components/DeckCard.vue";
import DeckFan from "./components/DeckFan.vue";
import ContextMenu, { MENU_ROW } from "./components/ContextMenu.vue";
import FilterSheet from "./components/FilterSheet.vue";
import { Z } from "./zLayers";
import { SORT_DIR_ICON, type SortDir } from "./sortIcons";
import {
  SORTS, DEFAULT_SORT, SORT_NATURAL, SORT_DIR_HINT, SORT_DIR_KIND, type SortMode,
  ATTACH_SORTS, DEFAULT_ATTACH_SORT, ATTACH_SORT_NATURAL, ATTACH_DIR_HINT, ATTACH_SORT_KIND, type AttachSortMode,
} from "./sortModes";
import {
  DEFAULT_WEAR, POSITION_GROUPS, START_PISTOLS, isWeaponPos, isSpecial, isShared, isNo3d,
  type OriginFilter, ORIGIN_FILTERS, ORIGIN_VALUES, WEAPON_GROUPS, GEAR_TYPES, WEAPONISH,
  categoryOf, prettyModel, matchesOrigin, catsForPos, DEFAULTS, RAIL, EXTRAS, ALL_SPECIALS,
} from "./loadoutModel";
import { useSortControl } from "./composables/useSortControl";
import { SWIPE_ARM_PX } from "./composables/useSwipeDismiss";
import { useSlotLongPress } from "./composables/useSlotLongPress";
import { useAppHeight } from "./composables/useAppHeight";
import { useBuildCheck } from "./composables/useBuildCheck";
import { useViewerMount } from "./composables/useViewerMount";
import { useDebouncedSearch, SEARCH_DEBOUNCE_MS } from "./composables/useDebouncedSearch";
import { usePersistedBool, usePersistedEnum, usePersistedNumber } from "./composables/usePersistedRef";
import { ART_FADE_B, attachmentsOf, canInspect, CARD_ART, CARD_CHROME_PX, glowStyle, hasScratch, hasSeed, hasWear, isCustomizable, isReadOnly, itemName, RARITY_META, rarityName, rarityRank, STEAM_BLUE, stripName, wearTier } from "./itemVisuals";
import { loadPaintDef, seedMovesPattern } from "./paintComposite";
import { isCompact, isCoarse, reducedMotion } from "./responsive";
import { revealInScroller, scrollFade, scrollPanelToTop } from "./dom";
import { hasModel, hasModelSync, mountViewer, snapshotModel, viewersIdle, viewerStats, INCOMPLETE, type ViewerHandle, type ViewerKind, type StickerPlacement, type CharmPlacement } from "./viewer3d";
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
  armory: { name: "armory" },
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
// Screens are ordered left-to-right: loadout, inventory, armory. Sliding by
// that order is what makes the swap read as travel rather than a redraw — the
// armory sits PAST the inventory (you get to it from there), so it arrives from
// the right the way the inventory does from the loadout.
const VIEW_ORDER: Record<string, number> = { grid: 0, focus: 0, inventory: 1, armory: 2, admin: 3 };
const viewDeeper = computed(() => (VIEW_ORDER[view.value] ?? 0) > 0);
const viewEnterFrom = computed(() =>
  viewDeeper.value ? "opacity-0 translate-x-4" : "opacity-0 -translate-x-4",
);
const viewLeaveTo = computed(() =>
  viewDeeper.value ? "opacity-0 -translate-x-4" : "opacity-0 translate-x-4",
);

// The slot taxonomy (POSITION_GROUPS, DEFAULTS, RAIL, EXTRAS, the slot
// predicates) lives in loadoutModel.ts.

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
const sheetSearchCtl = useDebouncedSearch();
const sheetSearch = sheetSearchCtl.term;
/** The sheet's debounced term — same reasoning as invSearchApplied, and the sheet
 *  animates its tiles too, so a live filter churned just as visibly here. */
const sheetSearchApplied = sheetSearchCtl.applied;
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
// RARITY_META / rarityName / rarityRank live in itemVisuals — the armory needs
// the same table and two copies is two places for a colour to stop meaning what
// it means.
const rarityFacets = computed(() => {
  const seen = new Map<string, number>();
  for (const s of sheetSkins.value) {
    if (s.rarity) seen.set(s.rarity, rarityRank(s.rarity));
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

// Rarity facets for the Inventory grid — over what's OWNED, not a catalog.
const invRarity = ref<string>("");
const invRarityFacets = computed(() => {
  const seen = new Map<string, number>();
  for (const i of inventory.value) {
    const r = i.item?.rarity;
    if (r) seen.set(r, rarityRank(r));
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([hex]) => ({ hex, name: rarityName(hex) }));
});

// ---- sorting ----------------------------------------------------------------
// One control on the Inventory grid, one on the sheet (Owned + Craft share it),
// one in the attachment picker. All three are useSortControl over the tables in
// sortModes.ts; "Default" is whatever order the source already has.
//
// Sort direction is shown, never implied — an unlabelled "Sort · Rarity" doesn't
// say which end it starts from, and for wear the two ends mean opposite things
// (a factory-new hunt vs a battle-scarred one).

// Its own fallback on purpose: an unrecognised colour sorts FIRST here (0),
// where the facet lists put it last (8). Sorting a grid, "I don't know what
// this is" belongs with the commons; listing the tiers, it belongs after them.
const sortRarityRank = (hex?: string | null) => (hex && RARITY_META[hex.toLowerCase()]?.rank) || 0;

const invSortCtl = useSortControl<SortMode>({
  scope: "inv",
  fallback: DEFAULT_SORT,
  natural: SORT_NATURAL,
  hints: SORT_DIR_HINT,
  kinds: SORT_DIR_KIND,
});
// Destructured, including the computeds: a ref nested inside an object is not
// auto-unwrapped in a template, only a top-level binding is.
const { mode: invSort, dir: invDir, setMode: setInvSort, kind: invSortKind, hint: invSortHint } = invSortCtl;

const sheetSortCtl = useSortControl<SortMode>({
  scope: "sheet",
  fallback: DEFAULT_SORT,
  natural: SORT_NATURAL,
  hints: SORT_DIR_HINT,
  kinds: SORT_DIR_KIND,
});
const { mode: sheetSort, dir: sheetDir, setMode: setSheetSort, kind: sheetSortKind, hint: sheetSortHint } = sheetSortCtl;

const byName = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "");
/**
 * Collection order, with the uncollected pinned to the BOTTOM in both
 * directions.
 *
 * Half of what anyone owns has no collection — every vanilla weapon, every music
 * kit, and all but 96 knife finishes (the classic knife pool is the rare special
 * of eleven cases at once, so no single one is true; see collectionOf in
 * catalog.ts). Sorted as an empty string they lead the grid, so picking
 * "Collection" scrolled the collections off the bottom and showed a wall of
 * things that have none. Flipping the direction pins them the same way, for the
 * same reason the name tiebreak stays A → Z either way.
 */
const byCollection = (a?: string | null, b?: string | null, flip = 1) => {
  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
  return flip * a.localeCompare(b);
};
function sortInstances(list: InventoryItem[], mode: SortMode, dir: SortDir): InventoryItem[] {
  const flip = dir === SORT_NATURAL[mode] ? 1 : -1;
  if (mode === "default") return flip === 1 ? list : [...list].reverse();
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => flip * byName(itemName(a.item), itemName(b.item)));
  if (mode === "wear") return arr.sort((a, b) => flip * ((a.wear ?? 1) - (b.wear ?? 1)) || byName(itemName(a.item), itemName(b.item)));
  if (mode === "collection") {
    // Rarity, not name, as the tiebreak WITHIN a collection: a case reads the
    // way it reads in game, covert first, which is the whole point of grouping
    // by one.
    return arr.sort(
      (a, b) =>
        byCollection(a.item?.collection, b.item?.collection, flip) ||
        sortRarityRank(b.item?.rarity) - sortRarityRank(a.item?.rarity) ||
        byName(itemName(a.item), itemName(b.item)),
    );
  }
  return arr.sort((a, b) => flip * (sortRarityRank(b.item?.rarity) - sortRarityRank(a.item?.rarity)) || byName(itemName(a.item), itemName(b.item)));
}
function sortSkins(list: Skin[], mode: SortMode, dir: SortDir): Skin[] {
  if (mode === "wear") return list; // catalog skins have no wear
  const flip = dir === SORT_NATURAL[mode] ? 1 : -1;
  if (mode === "default") return flip === 1 ? list : [...list].reverse();
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => flip * byName(a.name, b.name));
  if (mode === "collection") {
    return arr.sort(
      (a, b) =>
        byCollection(a.collection, b.collection, flip) ||
        sortRarityRank(b.rarity) - sortRarityRank(a.rarity) ||
        byName(a.name, b.name),
    );
  }
  return arr.sort((a, b) => flip * (sortRarityRank(b.rarity) - sortRarityRank(a.rarity)) || byName(a.name, b.name));
}

// Render window + entrance-cascade cutoff live in composables/useRenderWindow.ts.

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
const sheetOrigin = usePersistedEnum<OriginFilter>("cs2inv.sheetOrigin", ORIGIN_VALUES, "all");
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
/**
 * tintName -> colour, for the layers fanned out behind a colour deck.
 *
 * Comes from the SHEET's facets, which are fetched per loadout slot — so this
 * only knows the tints of whichever weapon the sheet last loaded. It is passed
 * to `stackByDesign` explicitly rather than read from inside it: the inventory
 * grid stacks the same way, and having the palette reach out of an unrelated
 * screen's state silently was the kind of coupling that is impossible to see at
 * the call site.
 *
 * The inventory therefore gets whatever the sheet happens to hold, and mostly
 * misses (tint names are per-finish, not a shared vocabulary) — which
 * `.filter(Boolean)` turns into "no fan layers". Giving it a correct palette of
 * its own needs an inventory-wide tint facet the API does not expose today.
 */
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
  /** tintName -> colour for the fanned layers. See `tintColors`. */
  palette: Map<string, string>,
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
      .map((v) => palette.get(of(v)?.tintName ?? "") ?? "")
      .filter(Boolean);
  }
  return out;
}

const ownedStacks = computed(() =>
  stackByDesign(ownedForSheet.value, sheetDesign.value, (i) => i.item, (i) => i.id, tintColors.value),
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
  stackByDesign(craftList.value, sheetDesign.value, (s) => s, (s) => s.id, tintColors.value).map((st) => ({
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
const ownedWindow = useRenderWindow(ownedStacks, sheetResetKey);
const craftWindow = useRenderWindow(craftStacks, sheetResetKey);
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
// `tr`/`notify`/`fail` live in useI18n — see composables/useI18n.ts for why they
// have to close over props rather than be a plain module. `props` is passed
// whole, not destructured, so a language switch still invalidates.
const { tr, notify, fail } = useI18n(props);

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
/**
 * `inst` is the owned_items row this attachment IS — see the backend's
 * AttachSpec. It has to survive a round trip, because the server reads a spec
 * with no `inst` as a fresh catalog pick and mints one: drop it on the way out
 * and every save would grant the user another copy of every sticker on the gun.
 *
 * Deliberately NOT in the shareable draft URL (encodeDraft). An instance id
 * belongs to one account, so a link opened by anyone else would name a row they
 * don't own — the server falls through to minting there, which is exactly right
 * for someone building their own copy of a craft.
 */
type Attach = { id: number; name: string; image: string | null; x?: number | null; y?: number | null; r?: number | null; w?: number | null; inst?: string | null };
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
  charm: (Attach & { z?: number | null; seed?: number | null; inst?: string | null }) | null;
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
    // Melee answers "none": CS2 hangs neither a sticker nor a charm off a
    // knife. It used to be its own kind so it could be offered a charm, which
    // the game drops on the floor — the same way folding it in with weapons
    // handed it five sticker slots it has nowhere to put.
    return type === "weapon" ? "weapon" : "none";
  }
  if (selected.value === "agent") return "agent";
  if (isWeaponPos(selected.value) || selected.value === "zeus" || selected.value === "c4") return "weapon";
  return "none";
});
/** Everything that can wear a charm — guns only, not knives, gloves or agents. */
const attachTakesCharm = computed(() => attachKind.value === "weapon");
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
/**
 * Is the pattern being edited a CHARM's?
 *
 * Charms and weapons both have one, and they are not the same control: a
 * weapon's is a 1..1000 continuum you scrub, a charm's is a 1..100,000 space
 * where each band is a colour you aim at. Same field, different instrument.
 */
const craftSeedIsCharm = computed(() => craftType.value === "keychain");
const craftHasSeed = computed(() =>
  craftType.value ? hasSeed({ type: craftType.value }) : craftSlotSays(["agent", "musickit", "graffiti", "collectible"]),
);
const craftHasWear = computed(() =>
  craftType.value ? hasWear({ type: craftType.value }) : craftSlotSays(["agent", "musickit", "graffiti", "collectible"]),
);
/**
 * Can this finish's pattern move its artwork at all?
 *
 * Null while unknown — the paint def has to be fetched, and a control that
 * flickers "fixed" for a frame before deciding otherwise is worse than one that
 * waits. Every style 0 solid and style 3 anodized in the game answers false, so
 * this is not an edge case: it is most of the finishes where someone would
 * otherwise sit and press the die expecting something to happen.
 */
const patternMoves = ref<boolean | null>(null);
/**
 * A sticker's scratch wear, on the sticker's OWN page.
 *
 * The same number the weapon's options column exposes per slot — this is where
 * you set it when the sticker is the subject rather than something stuck to a
 * gun. It rides `craft.wear`, which already round-trips to owned_items.wear, so
 * an owned sticker keeps its scuff with no new column.
 *
 * Type-only, never the slot: a sticker is always opened from the inventory or
 * the catalog, where `selected` is still pointing at whatever weapon position
 * was last touched.
 */
const craftHasScratch = computed(() => hasScratch({ type: craftType.value }));
/**
 * The float range this FINISH actually exists in — not 0..1.
 *
 * 1,683 of the 2,106 paintable items are narrower than the full range (AK-47 |
 * Redline is 0.10–0.70, Desert Eagle | Blaze is 0.00–0.08), and the editor used
 * to offer every one of them a 0..1 slider. That built items that cannot exist,
 * and shipped the impossible float to the game server through the v5 feed.
 *
 * The backend now rejects those (validateCraftAttrs), so the slider agreeing
 * with it is not cosmetic — an unbounded slider would just turn an impossible
 * item into a save that 400s.
 *
 * Falls back to the full range while the item's own bounds are unknown: a
 * catalog listing from before the field existed must stay editable.
 */
const craftWearRange = computed(() => {
  const i = (craft.value?.skin ?? craftInst.value?.item) as
    | { wearMin?: number | null; wearMax?: number | null }
    | undefined;
  // A sticker's scratch is a different attribute that happens to share the
  // column — it is always the full 0..1 and has no per-item bound.
  if (craftHasScratch.value) return { min: 0, max: 1 };
  return { min: i?.wearMin ?? 0, max: i?.wearMax ?? 1 };
});
/**
 * Name tag. Asks the type for the same reason every gate here does — the old
 * slot-shaped test would offer one to a sticker opened from the inventory,
 * because `selected` was still on a rifle.
 */
const craftHasNameTag = computed(() =>
  craftType.value
    // Guns and knives only. A name tag is applied with a Name Tag tool, and CS2
    // will not let you put one on gloves, an agent, a music kit or a charm —
    // the field was offered to gloves and charms purely because the old
    // exclusion list was written before either could be opened on its own.
    ? ["weapon", "melee"].includes(craftType.value)
    : craftSlotSays(["agent", "musickit", "graffiti", "collectible", "gloves"]),
);
// StatTrak is weapons, knives and music kits — NOT gloves, which do have a float
// and a pattern. That distinction is invisible to a slot-shaped gate.
const craftHasStatTrak = computed(() =>
  craftType.value
    ? ["weapon", "melee", "musickit"].includes(craftType.value)
    : craftSlotSays(["agent", "graffiti", "collectible"]),
);
/**
 * Does the options column have anything to put in it?
 *
 * The UNION of the gates below rather than a rule of its own, so it can never
 * disagree with them: add a control and this follows. It used to ask the slot
 * ("not graffiti"), which was right while every craft started from a matching
 * slot and wrong from the armory — a patch has no name tag, no float, no
 * pattern, no StatTrak and no attachments, so it opened a 300px column with
 * nothing in it.
 *
 * Declared after the gates it sums; see the note on craftHasNameTag.
 */
const craftHasOptions = computed(
  () =>
    craftHasNameTag.value ||
    craftHasSeed.value ||
    craftHasWear.value ||
    craftHasScratch.value ||
    craftHasStatTrak.value ||
    attachKind.value !== "none",
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

// Declared AFTER craftTarget on purpose: `immediate` makes Vue run this
// getter synchronously during setup, and reading a `const` that is declared
// further down the file throws on the temporal dead zone — which blanked the
// whole plugin, since a setup that throws mounts nothing at all.
watch(
  // The type is read off the SKIN rather than through craftType, which is the
  // same temporal-dead-zone rule as the note above: craftType reaches for
  // craftInst, declared far below, and `immediate` runs this getter during
  // setup. The skin's own type is what a glove always carries anyway.
  () => [craft.value?.skin.paintMaterial ?? null, craftTarget.value?.kind ?? null, craft.value?.skin.type ?? null] as const,
  async ([pm, kind, type]) => {
    patternMoves.value = null;
    // A GLOVE carries a pattern and is rendered by a different compositor —
    // gloveComposite, which never reads the seed. Asking the weapon paint def
    // about it would answer a question about a shader that is not the one
    // drawing this. The pattern is still a real tradeable attribute, so the
    // field stays; there is simply no look to browse.
    //
    // Asked of the ECONOMY TYPE as well as the viewer kind, because the two
    // become known at different moments and only one of them is synchronous.
    // `craftTarget` is resolved a tick after `craft` is assigned, so the first
    // run of this watcher always sees kind null — the type is already 'glove'
    // by then and settles it without waiting for anything.
    if (kind === "glove" || type === "glove") {
      patternMoves.value = false;
      return;
    }
    if (!pm) return;
    const def = await loadPaintDef(pm);
    // Still the same subject? The fetch is cached, but a fast click through two
    // skins can still land these out of order.
    //
    // The KIND is re-checked here, not just the finish, and that is the whole
    // bug: the first run — the one that sees kind null — went off to fetch, and
    // came back to overwrite the `false` the glove gate had set in the meantime.
    // Every glove therefore got a 1..1000 pattern rail, on a compositor with no
    // seed input at all, so dragging it moved the needle and nothing else.
    if (
      (craft.value?.skin.paintMaterial ?? null) !== pm ||
      (craftTarget.value?.kind ?? null) !== kind ||
      (craft.value?.skin.type ?? null) !== type
    ) {
      return;
    }
    patternMoves.value = def ? seedMovesPattern(def) : null;
  },
  { immediate: true },
);
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
// ---- viewer settings -------------------------------------------------------
// ALWAYS OFFERED. The cog used to be gated on devToolsEnabled() — dev builds, or
// opt-in from the admin console — because everything behind it was a diagnostic
// that could make a correct render look broken.
//
// That stopped being true when bloom landed: it is a look preference, and a
// preference nobody can find is not a preference. The panel now separates the two
// (see DevHud), so the gate moved DOWN a level: everyone gets the settings, the
// diagnostics sit behind Advanced.
const devHudOpen = ref(false);
/** Flags currently off their default — surfaced ON the cog so a switch left on
 *  is visible without opening the panel. That is the failure this whole thing is
 *  meant to prevent. */
const devFlagCount = computed(() => {
  void flagsVersion.value;
  return activeFlags().length;
});
function onDevHudKey(e: KeyboardEvent) {
  // Ctrl/Cmd+Shift+D. Shift keeps it clear of the browser's own Cmd+D (bookmark).
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
    e.preventDefault();
    devHudOpen.value = !devHudOpen.value;
  }
}
onMounted(() => window.addEventListener("keydown", onDevHudKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onDevHudKey));
/** The catalog's agent list, kept for its `patchSlots` — see patchSlotCount. */
const catalogAgents = ref<Skin[]>([]);
/**
 * Poses offered for an agent in 3D.
 *
 * "Open" exists for PATCHES specifically: at any lifelike arm angle the upper
 * arms cover the side and sleeve positions, so there is no one pose that both
 * looks right and shows everything. Rather than compromise the default, the
 * user picks. "Ready" is the model's own tools_preview clip — the only real
 * animation an agent ships.
 */
const AGENT_POSES = [
  { id: "ready" as const, label: "Ready", hint: "The model's own in-game pose" },
  { id: "stand" as const, label: "Stand", hint: "Relaxed standing pose" },
  { id: "open" as const, label: "Open", hint: "Arms out — shows every patch position" },
];
/** The model's own pose leads: it is how CS2 presents the agent, so it is what
 *  someone expects to see first. "Open" is a tool, not a default. */
const DEFAULT_AGENT_POSE = "ready" as const;
const agentPose = ref<"stand" | "open" | "ready">(DEFAULT_AGENT_POSE);
function setAgentPose(pose: "stand" | "open" | "ready") {
  agentPose.value = pose;
  modalViewer.current()?.setAgentPose(pose);
}
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
  agentPose.value = DEFAULT_AGENT_POSE;
  editingId.value = null;
  duplicating.value = false;
  viewOnly.value = false;
  craftInstId.value = null;
  // The finish's OWN model wins: a knife/zeus/c4 sheet isn't a weapon position,
  // so the slot can't name a model, and every knife finish is a different one.
  // Falling back to the slot keeps working for weapon skins whose listing
  // predates the model field. No model = no 3D — see the `craft` watcher.
  // The slot's model is a fallback for WEAPON finishes only. Crafting is
  // reachable from the armory now (see Armory.vue), where `selected` is
  // still pointing at whatever loadout position was last touched — so a sticker
  // crafted on its own would inherit "ak47" and claim to be a rifle in the
  // header and the report link.
  const skinIsWeapon = !skin.type || skin.type === "weapon" || skin.type === "melee";
  craftModel.value =
    skin.model ?? (skinIsWeapon && isWeaponPos(selected.value) ? occupantModel(selected.value) : null);
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
  agentPose.value = DEFAULT_AGENT_POSE;
  mdebug("openEdit()", { inst: inst.id, hasItem: !!inst.item });
  if (!inst.item) return;
  craftModel.value = inst.item.model ?? null;
  viewOnly.value = false;
  craftInstId.value = inst.id;
  duplicating.value = inst.origin === "steam";
  editingId.value = duplicating.value ? null : inst.id;
  const stickers: (Attach | null)[] = [null, null, null, null, null];
  (inst.stickers ?? []).forEach((st, i) => {
    if (st && i < 5) stickers[i] = { id: st.id, name: st.name, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null, inst: st.inst ?? null };
  });
  const patches: (Attach | null)[] = [null, null, null, null, null];
  (inst.patches ?? []).forEach((pt, i) => {
    if (pt && i < 5) patches[i] = { id: pt.id, name: pt.name, image: pt.image, inst: pt.inst ?? null };
  });
  craft.value = {
    // `type` and `model` ride along because they are what decides WHAT the 3D
    // stage mounts (see resolveViewerModel) — a charm carries no model at all,
    // so without the type this projection resolves to "no 3D form" and the
    // modal silently stays flat.
    //
    // `def` for the same class of reason: canInspect() asks the item for its
    // defindex, and this projection dropping it was what made "Inspect in game"
    // vanish the moment you pressed Edit on an item that inspects fine in view
    // mode. The link itself never needed it — the backend resolves the defindex
    // from item_id — so it was only ever the button that went missing.
    skin: { id: inst.item.id, name: inst.item.name, altName: inst.item.altName ?? null, rarity: inst.item.rarity ?? "", image: inst.item.image, paintMaterial: inst.item.paintMaterial ?? null, legacyPaint: !!inst.item.legacyPaint, type: inst.item.type, model: inst.item.model ?? null, def: inst.item.def },
    wear: inst.wear ?? DEFAULT_WEAR,
    seed: inst.seed ?? 1,
    stattrak: inst.stattrak,
    nametag: inst.nametag ?? "",
    stickers,
    patches,
    charm: inst.charm
      ? { id: inst.charm.id, name: inst.charm.name, image: inst.charm.image, x: inst.charm.x ?? null, y: inst.charm.y ?? null, z: inst.charm.z ?? null, seed: inst.charm.seed ?? null, inst: inst.charm.inst ?? null }
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
  // Two decimals for a scratch, six-figure precision for a float. Not fussiness:
  // a sticker's scratch is the same 0..1 the per-slot sliders step at 0.01 and
  // print at 2dp, so rolling 0.4837 here would have the sticker's own page and
  // the weapon's options column disagree about the same number.
  //
  // Rolls inside the finish's OWN range — a die that can land on a float the
  // item cannot have is a die that produces a save error.
  const { min, max } = craftWearRange.value;
  if (craft.value) craft.value.wear = Number(rand(min, max).toFixed(craftHasScratch.value ? 2 : 4));
}
/**
 * Pull the float back inside the finish's range whenever the subject changes.
 *
 * The editor keeps `craft.wear` across a skin swap (deliberately — you compare
 * two finishes at the same float), so switching from a 0..1 finish to Blaze at
 * 0.00–0.08 would otherwise leave 0.5 sitting in a slider that cannot express
 * it: the thumb pins to the end, the number says 0.5, and the save 400s.
 *
 * Clamp only — never rewrites a float already inside the range, so it can't
 * quietly "fix" a value the user chose.
 */
watch(
  () => [craftWearRange.value.min, craftWearRange.value.max, craft.value?.skin?.id] as const,
  () => {
    const c = craft.value;
    if (!c || typeof c.wear !== "number") return;
    const { min, max } = craftWearRange.value;
    if (c.wear < min) c.wear = min;
    else if (c.wear > max) c.wear = max;
  },
);
function randomSeed() {
  if (craft.value) craft.value.seed = Math.floor(rand(1, 1001));
}
// Charm patterns run to 100000, an order of magnitude past a weapon's 1000 —
// they are their own attribute with their own range, not the weapon's reused.
// The die for them lives inside PatternRail rather than here: it rolls within
// whatever range the rail is showing, and a button that far from the range it
// obeys is what made that relationship need a label nobody could read.
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
  return a ? { id: a.id, x: a.x ?? null, y: a.y ?? null, r: a.r ?? null, w: a.w ?? null, inst: a.inst ?? null } : null;
}
function craftBody() {
  const c = craft.value!;
  return {
    // Only the scalars this item can actually CARRY. The form is one shape for
    // every item and its fields start at neutral defaults (wear 0, seed 1,
    // StatTrak off), so an ungated body posted a float for a medal and a
    // pattern for an agent — attributes those items have no honest value for.
    // The gates here are the same ones that decide whether the control is drawn
    // at all, so what is sent is exactly what was editable.
    wear: craftHasWear.value || craftHasScratch.value ? c.wear : null,
    seed: craftHasSeed.value ? c.seed : null,
    stattrak: craftHasStatTrak.value ? c.stattrak : false,
    nametag: craftHasNameTag.value ? c.nametag.trim() || null : null,
    stickers: c.stickers.map(toSpec),
    patches: c.patches.map(toSpec),
    charm_id: c.charm?.id ?? null,
    charm_offset: c.charm ? { x: c.charm.x ?? null, y: c.charm.y ?? null, z: c.charm.z ?? null, seed: c.charm.seed ?? null, inst: c.charm.inst ?? null } : null,
  };
}
// Inspect the DRAFT — works before the craft has ever been saved.
async function openCraftInspect() {
  if (!craft.value) return;
  await sendInspect(() =>
    fetchDraftInspectLink({
      item_id: craft.value!.skin.id,
      ...craftBody(),
      // Kills are NOT part of craftBody(): they live on the owned row, not in
      // the form, and craftBody() is also what save sends. Same number the 3D
      // stage puts on the module, so inspecting an edit of a StatTrak item
      // opens CS2 on its real count instead of a fresh 0.
      stattrak_count: craft.value!.stattrak ? craftInst.value?.stattrak_count ?? 0 : 0,
    }),
  );
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
/**
 * Attachments in this craft that are currently applied to something ELSE.
 *
 * A sticker can only be on one weapon at a time, so saving this would take each
 * of these off the gun wearing it. The server does that move unconditionally —
 * it has to, it's the rule — which is exactly why the asking happens here,
 * where there is still something to cancel.
 */
function craftTakesFrom(): { name: string; from: string }[] {
  const c = craft.value;
  if (!c) return [];
  const self = craftInstId.value != null ? String(craftInstId.value) : null;
  const out: { name: string; from: string }[] = [];
  const check = (a: Attach | null) => {
    if (!a?.inst) return;
    const row = inventory.value.find((i) => String(i.id) === String(a.inst));
    // Loose, or already on THIS item — neither is a move.
    if (row?.attached_to == null || String(row.attached_to) === self) return;
    const host = inventory.value.find((i) => String(i.id) === String(row.attached_to));
    out.push({ name: a.name, from: host ? itemName(host.item) : "another item" });
  };
  c.stickers.forEach(check);
  c.patches.forEach(check);
  check(c.charm);
  return out;
}
async function confirmCraft() {
  if (!craft.value || craftBusy.value) return;
  // Belt-and-braces behind the disabled button: the editor is reachable signed
  // out (and via a shared /craft/<id> draft link), so the commit re-checks
  // rather than trusting that no path got here.
  if (!signedIn.value) return notify(tr("inventory.notify.sign_in_to_save", "Sign in to save this to your inventory."));
  const moving = craftTakesFrom();
  if (moving.length) {
    confirmAsk.value = {
      title: moving.length === 1 ? "Move it off the other item?" : "Move them off their other items?",
      body:
        moving.map((m) => `${m.name} is on your ${m.from}.`).join(" ") +
        ` Saving moves ${moving.length === 1 ? "it" : "them"} here, so that item loses ${moving.length === 1 ? "it" : "them"}.` +
        " To keep both, duplicate the attachment first.",
      confirmLabel: "Move",
      tone: "neutral",
      // Cleared before re-entering, or this would ask again forever.
      onConfirm: () => void saveCraft(),
    };
    return;
  }
  await saveCraft();
}
async function saveCraft() {
  if (!craft.value || craftBusy.value) return;
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
const modalViewerEl = ref<HTMLElement | null>(null);
const modalViewer = useViewerMount({
  label: "craft modal",
  host: () => modalViewerEl.value,
  onError: (e) => {
    modal3d.value = false;
    charmPending.value = false; // nothing is coming — don't strand the rail
    fail(e);
  },
});
const teardownModalViewer = () => {
  charmPending.value = false;
  modalViewer.teardown();
};
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
  // switch made from the URL. `modalViewer.started()` is the "a mount has started
  // since that teardown" flag (teardown is what clears it), so a genuine
  // false→true edge, which HAS already mounted by now, doesn't mount twice.
  if (modal3d.value && !modalViewer.started()) void mountModalViewer();
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
/**
 * Patch slots the CURRENT agent actually has.
 *
 * The inventory schema stores five for every agent, but the positions belong to
 * the model — most declare three, some five (see /api/catalog `patchSlots`). The
 * form used to show five regardless, so you could fill all of them and the
 * viewer would silently drop the overflow. A missing count means the backend
 * could not read the model, and that has to fall back to five rather than to
 * zero: capping on a failed lookup would make every agent unpatchable.
 */
const patchSlotCount = computed(() => {
  const skin = craft.value?.skin;
  if (!skin) return 5;
  // TWO SOURCES ON PURPOSE. The craft page opens an owned item through the
  // inventory row, whose item comes from the backend's synchronous getItem() —
  // and that reads a cache warmed at boot, so a cold or failed warm silently
  // yields null and the form falls back to five slots for every agent. The
  // catalog's agents list is computed per request and cannot go stale that way,
  // so it backstops the item. Matching on id, not model: the id is what both
  // sides key on.
  const n = skin.patchSlots ?? catalogAgents.value.find((a) => a.id === skin.id)?.patchSlots;
  return typeof n === "number" && n > 0 ? Math.min(n, 5) : 5;
});
/** Slots beyond that count are cleared, so a saved craft cannot carry a patch
 *  the model has nowhere to put — including one equipped before this cap, or
 *  copied from another agent by the duplicate flow. */
watch(patchSlotCount, (n) => {
  const list = craft.value?.patches;
  if (!list) return;
  for (let i = n; i < list.length; i++) list[i] = null;
});
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
  const target = craftTarget.value;
  if (!target) return;
  const model = target.model;
  // Only a weapon hangs a charm the mount does not wait for. On the standalone
  // charm the charm IS the model, so `busy` already covers it and claiming a
  // pending charm here would leave the rail a skeleton forever.
  charmPending.value = target.kind === "weapon" && !!craft.value?.charm;
  await modalViewer.mount(
    model,
    async () => {
      // Weapon-only machinery, skipped by kind rather than by "did the lookup
      // happen to come back empty": sticker slots and the charm attachment are
      // meaningless on a charm that IS the model, and stickerGeom would fetch
      // markup for a key no weapon has.
      const isWeapon = target.kind === "weapon";
      return {
      kind: target.kind,
      charmSpec: target.charm ?? null,
      gloveArms: gloveArms.value,
      // A sticker or patch has no model to name, so it is addressed by its art.
      // The sticker IS the item here, so its scratch is the item's own `wear` —
      // the same field a weapon spends on its float. Hardcoded 0 before, which
      // meant the one screen dedicated to a sticker was the one screen that
      // could not show it scuffed. A patch has no scratch, so it stays at 0.
      decal:
        target.kind === "sticker" || target.kind === "patch"
          ? { image: craft.value?.skin.image ?? "", wear: (craftHasScratch.value ? craft.value?.wear : 0) ?? 0 }
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
      // Patches are the AGENT's equivalent of stickers, but they are not decals
      // and share none of that machinery: the viewer stamps them into the body
      // texture at UV rects the model itself declares. Just the art, in slot
      // order — there is no geometry and nothing to place.
      patches: target.kind === "agent" ? (craft.value?.patches ?? []).map((p) => p?.image ?? null) : undefined,
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
      },      };
    },
    (handle) => {
      // Re-apply the chosen pose: the 2D/3D toggle remounts, and a viewer that
      // came back in the default stance after the user picked "Open" would look
      // like the control had stopped working.
      if (craftTarget.value?.kind === "agent") handle.setAgentPose(agentPose.value);
      // The charm's authored albedo, for the pattern rail's gradient. Sampled
      // off the model because for most charms that is the only place it exists
      // — see ViewerHandle.charmAlbedoTile. Taken here rather than in the rail
      // so the rail never has to know a viewer exists.
      //
      // TWICE, and the second one is the one that usually lands: the mount does
      // not wait on the charm, so at this instant an attached charm is still
      // fetching and answers null. Sampling only here is what left the rail grey
      // until the first drag re-sampled it as a side effect.
      charmAlbedo.value = handle.charmAlbedoTile();
      void handle.charmReady().then(() => {
        if (modalViewer.current() !== handle) return; // superseded mid-load
        charmAlbedo.value = handle.charmAlbedoTile();
        charmPending.value = false;
      });
      // The options above are a snapshot taken before the GLB loaded, and
      // pressing Edit during that load flips viewOnly while there is no handle
      // for the watcher below to talk to. Reconcile here so a mode change can't
      // be lost in the gap — no-ops when it already matches.
      handle.setInteractive(!viewOnly.value);
    },
  );
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
watch(viewOnly, (on) => modalViewer.current()?.setInteractive(!on));
/**
 * The mounted charm's authored albedo, for the pattern rail's gradient.
 *
 * Only the 23 community charms that share the blank mesh have a standalone
 * material to fetch; every other charm keeps its textures inside its GLB, so
 * the mounted model is the only cheap source. Held here rather than inside the
 * rail so the rail stays a control that knows nothing about renderers.
 */
type CharmAlbedo = {
  data: Uint8ClampedArray;
  size: number;
  material: string | null;
  /** That material's tint mask — which texels the pattern may recolour at all. */
  mask: Uint8ClampedArray | null;
};
const charmAlbedo = ref<CharmAlbedo | null>(null);
const previewAlbedo = ref<CharmAlbedo | null>(null);
/**
 * The charm has not landed on the mounted model yet.
 *
 * Separate from the mount's own `busy`, because the mount deliberately finishes
 * without the charm (see ViewerHandle.charmReady) — so `busy` going false is not
 * the moment the rail has something to paint. The rail takes both and stays a
 * skeleton until neither is true: dragging before then moves a number nothing is
 * listening to, which reads as a broken control.
 */
const charmPending = ref(false);
const charmRailLoading = computed(() => modalViewer.busy.value || charmPending.value);
/**
 * Charms whose pattern provably changes nothing, reported by their own rail.
 *
 * Held out here rather than inside the rail because what has to disappear is
 * the ROW — the card, its heading, its padding. A control that hides itself and
 * leaves an empty panel behind has moved the problem, not solved it.
 */
const craftCharmInert = ref(false);
const previewCharmInert = ref(false);
/**
 * Reset on every change of subject, because hiding the row UNMOUNTS the rail
 * that set the flag.
 *
 * Nothing is left to report `false` once the panel is gone, so a charm opened
 * after an inert one would inherit the verdict and lose a control it should
 * have. The flag has to be a claim about the CURRENT charm, and the only way to
 * guarantee that is to drop it whenever the charm does.
 */
watch(() => craft.value?.skin.image ?? null, () => (craftCharmInert.value = false));
// previewCharmInert's own reset lives next to preview3d — reaching a `const`
// declared further down the file throws on the temporal dead zone, and a setup
// that throws mounts nothing at all.
/**
 * Paint-atlas texel weights from the mounted weapon — see PatternScoreRail.
 *
 * A GETTER, not a value, and pulled only when a scan actually starts. Computing
 * it eagerly would rasterise every triangle on every mount, and the card
 * backfill mounts one viewer per inventory item — none of which will ever rank
 * a pattern. The viewer memoises, so asking twice is free.
 */
function paintWeightsNow(): Float32Array | null {
  return modalViewer.current()?.paintUvWeights(SCAN_READ_SIZE) ?? null;
}
/**
 * Wear/pattern changes RE-PAINT the live viewer rather than rebuilding it.
 *
 * Both feed one thing — the paint composite — and a composite is two fullscreen
 * passes over textures the mount already downloaded. Rebuilding to change them
 * meant a fresh GLB load and a fresh context per tick, which is why these had to
 * hide behind a 450ms debounce and still felt like a slideshow. Re-compositing
 * keeps the camera, the decals and the charm exactly where they are, so a
 * pattern slider is just a slider.
 *
 * THREE KINDS take three routes to the same place, because "the pattern" means
 * something different to each compositor:
 *
 *  · a weapon or knife re-composites its paint (wear and seed both feed it);
 *  · a glove re-composites too, but only wear reaches csgo_customglove — a seed
 *    change there is answered without work rather than with a rebuild;
 *  · a CHARM's pattern is not a composite at all. It drives a handful of shader
 *    params through decoded Source 2 expressions, so it re-shades in place via
 *    setCharmSeed. Sending it through the paint path found no composite to redo
 *    and fell through to a full rebuild per pointer tick — a fresh GLB, a fresh
 *    context and a re-settled cloth sim to change three floats, which is exactly
 *    the slideshow the attached charm and the preview panel already stopped
 *    having.
 *
 * The remount stays as the fallback for anything with nothing to re-do at all
 * (an unpainted model, or a build whose paint failed): setPaintVariant says so
 * rather than silently doing nothing. It is DEBOUNCED, because a fallback that
 * fires per tick is the very thing this watcher exists to avoid — one rebuild
 * once the gesture stops, not one per pointer move.
 */
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
    // IMMEDIATE, not debounced. Debouncing meant nothing moved until you STOPPED
    // moving, which is the worst possible response for a scrub: the gun sat
    // still through the whole gesture and then jumped. The viewer coalesces
    // instead — it keeps only the newest request while a composite is running —
    // so firing on every tick costs one composite per frame the GPU can afford
    // and never builds a queue.
    repaint(true);
    // ...then settle to full resolution once the pointer stops. The proxy is a
    // quarter-resolution stand-in; this is the frame that stays on screen.
    clearTimeout(retexTimer);
    retexTimer = setTimeout(() => repaint(false), 220);
  },
);
/**
 * Show a pattern on the viewer WITHOUT committing it to the item.
 *
 * Hovering the score rail and blinking two patterns are both looks, not edits —
 * they must leave `craft.seed` alone, or browsing would dirty the form and a
 * Save would ship whatever the pointer happened to be over. The viewer is the
 * only thing that changes; null puts the committed pattern back.
 *
 * Proxy resolution for the preview, full for the restore: a preview is a
 * glance, and the frame that stays on screen is the one worth the texels.
 */
function previewPattern(seed: number | null) {
  if (!modal3d.value || !craft.value || !modalViewer.current()) return;
  void modalViewer.current()!.setPaintVariant(
    craft.value.wear ?? 0,
    seed ?? craft.value.seed ?? 0,
    seed != null,
  );
}
/** Pending fallback rebuild — see the note on debouncing it, below. */
let retexRebuild: ReturnType<typeof setTimeout> | undefined;
/**
 * The handle a fallback rebuild has already been spent on.
 *
 * One per mount, because the second one cannot help. A viewer that answers
 * "nothing to re-paint" is either unpainted — where wear and pattern change no
 * pixels at all, so rebuilding arrives at the identical picture — or its paint
 * failed to load, and nothing about dragging a slider makes the next attempt go
 * differently. One retry is worth having; a retry per gesture is a model reload
 * charged to a scrub that had no visible effect either way.
 */
let retexRebuilt: object | null = null;
function repaint(proxy: boolean) {
  if (!modal3d.value || !craft.value) return;
  const handle = modalViewer.current();
  if (!handle) return void mountModalViewer();
  // A CHARM's pattern is not paint. It grades the charm's material through
  // shader params the mount already holds, so it is a synchronous re-shade with
  // no composite, no fetch and no proxy resolution to settle out of.
  if (craftTarget.value?.kind === "charm") {
    clearTimeout(retexRebuild);
    handle.setCharmSeed(craft.value.seed ?? 0);
    return;
  }
  void handle.setPaintVariant(craft.value.wear ?? 0, craft.value.seed ?? 0, proxy).then((ok) => {
    if (ok || !modal3d.value || modalViewer.current() !== handle) return;
    if (retexRebuilt === handle) return;
    // Nothing to re-composite — fall back to the rebuild this replaced, but
    // ONCE the gesture stops. Firing it per tick is what made an unpainted item
    // reload its GLB on every pointer move; the guard on the handle still being
    // the live one keeps a remount that happened meanwhile from being redone.
    clearTimeout(retexRebuild);
    retexRebuild = setTimeout(() => {
      if (!modal3d.value || modalViewer.current() !== handle) return;
      retexRebuilt = handle;
      void mountModalViewer();
    }, 240);
  });
}
// StatTrak toggle → attach/detach the module on the live viewer. Deliberately
// NOT folded into the wear/seed remount above: the module is independent of the
// paint composite, and remounting would reset the camera on every flip.
watch(
  () => craft.value?.stattrak,
  (on) => {
    if (!modalViewer.current() || !craft.value) return;
    modalViewer.current()!.setStatTrak(
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
    if (!modalViewer.current() || !craft.value) return;
    modalViewer.current()!.setNameTag(text ?? null);
  },
);
// Numeric edits / picker changes → live decal + charm updates. The viewer
// no-ops on identical placements, so drag echoes don't rebuild anything.
watch(
  () => JSON.stringify([craft.value?.stickers, craft.value?.charm]),
  () => {
    const handle = modalViewer.current();
    if (!handle || !craft.value) return;
    handle.setStickers(craftStickerPlacements());
    // Re-sample the albedo once the charm has actually landed — swapping charms
    // does not remount the viewer, so the mount-time sample belongs to the
    // previous one. Guarded on the handle still being the live one: a remount
    // mid-swap would otherwise publish a torn-down viewer's colours.
    void handle.setCharm(craftCharmPlacement()).then(() => {
      if (modalViewer.current() !== handle) return;
      charmAlbedo.value = handle.charmAlbedoTile();
      charmPending.value = false;
    });
  },
);
// A SWAPPED charm is a fresh load, so the rail goes back to its skeleton until
// the new one lands. Keyed on the image alone: the watcher above also fires on
// every tick of a pattern drag, and flipping this there would disable the rail
// under the pointer that is using it.
watch(
  () => craft.value?.charm?.image ?? null,
  (img, was) => {
    if (img === was) return;
    charmPending.value = !!img && craftTarget.value?.kind === "weapon";
  },
);
// A charm on something that can't wear one is dropped as the editor opens.
// Knives could take one until the slot came out, so those rows still exist —
// and with no slot to clear it from, the charm would be stuck on the knife
// forever (still hanging in 3D, still marked attached, so unusable anywhere
// else). Clearing it here means opening the knife and saving releases it.
// A watcher rather than a check inside craftBody() because every consumer —
// the 3D stage, the inspect link, the "takes it off your X" prompt — reads
// `craft.charm` directly, and they should all agree there is no charm.
// Watched as the CONJUNCTION, not on attachTakesCharm alone: opening a knife
// from the knife slot never flips that flag (it reads false either side of the
// modal opening), so a plain gate would sit there while the charm rode in
// underneath it.
watch(
  () => !attachTakesCharm.value && !!craft.value?.charm,
  (stray) => {
    if (stray) craft.value!.charm = null;
  },
  { immediate: true },
);
// Patches → re-composite the agent's body texture on the live viewer. Its own
// watcher rather than a remount for the same reason the three above have one:
// remounting to show a patch resets the camera mid-edit. Without this the only
// way to see a patch was to save and reopen.
watch(
  () => JSON.stringify(craft.value?.patches ?? []),
  () => {
    if (!modalViewer.current() || craftTarget.value?.kind !== "agent") return;
    void modalViewer.current()!.setPatches((craft.value?.patches ?? []).map((p) => p?.image ?? null));
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
/** Browsing to ATTACH — a slot on the item being edited is waiting for the
 *  answer. Browsing to CRAFT is a different activity and has its own screen
 *  (see Armory.vue), which is why this one has no mode. */
const picker = ref<{ kind: "sticker" | "charm" | "patch"; slot: number } | null>(null);
const pickerQuery = ref("");
const pickerGroup = ref("");
const pickerCollection = ref("");
const pickerRarity = ref("");
// Remembered across pickers and sessions, like the inventory/sheet sorts — a
// preference for how to read a catalog isn't per-visit.
//
// Sort and direction both re-order the WHOLE match set server-side, so the
// already-loaded pages stop being the right first pages -- `onChange` restarts
// from page one, and cancels a debounced search first so a keystroke from a
// moment ago can't land after and undo the change.
const pickerSortCtl = useSortControl<AttachSortMode>({
  scope: "picker",
  fallback: DEFAULT_ATTACH_SORT,
  natural: ATTACH_SORT_NATURAL,
  hints: ATTACH_DIR_HINT,
  kinds: ATTACH_SORT_KIND,
  onChange: () => {
    clearTimeout(pickerTimer);
    void pickerSearch();
  },
});
const {
  mode: pickerSort, dir: pickerDir, setMode: setPickerSort, setDir: setPickerDir,
  kind: pickerSortKind, hint: pickerSortHint,
} = pickerSortCtl;
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

/**
 * Which shelf the picker is browsing: the whole catalog, or your own drawer.
 *
 * Owned mode is answered entirely from `inventory` — no fetch, no paging. The
 * client already holds every instance the user owns, and an attachment you own
 * is a few dozen rows next to a catalog of ten thousand.
 */
const pickerSource = ref<"all" | "owned">("all");
/** cs2-lib calls a charm a keychain; the picker calls it a charm. */
const PICKER_TYPE: Record<string, string> = { sticker: "sticker", patch: "patch", charm: "keychain" };
/**
 * One row shape for both shelves, so the grid renders one loop.
 *
 * `inst` is what separates them: a catalog row has none and gets minted on save,
 * an owned row carries the instance and links to it.
 */
type PickerRow = {
  key: string;
  id: number;
  name: string;
  image: string | null;
  rarity?: string;
  /** cs2-lib type. Carried so crafting one straight from here gets the right
   *  form — without it the editor can't tell a sticker from a charm. */
  type?: string;
  inst?: string | null;
  /** What this owned one is already applied to, if anything. */
  attachedName?: string | null;
  /** The owned row's own scratch / pattern, so picking it previews truthfully. */
  wear?: number | null;
  seed?: number | null;
};
const pickerOwned = computed<PickerRow[]>(() => {
  const p = picker.value;
  if (!p) return [];
  const want = PICKER_TYPE[p.kind] ?? p.kind;
  const q = pickerQuery.value.trim().toLowerCase();
  return inventory.value
    .filter((i) => i.item?.type === want && (!q || itemName(i.item).toLowerCase().includes(q)))
    .map((i) => ({
      key: `own-${i.id}`,
      id: i.item!.id,
      name: itemName(i.item),
      image: i.item?.image ?? null,
      rarity: i.item?.rarity,
      type: i.item?.type,
      inst: String(i.id),
      attachedName: attachedName(i),
      wear: i.wear,
      seed: i.seed,
    }))
    // Spares first: the whole reason to open this shelf is to find one that
    // isn't already spoken for, and burying those under the applied ones would
    // make the common case the hard one.
    .sort((a, b) => Number(!!a.attachedName) - Number(!!b.attachedName) || byName(a.name, b.name));
});
const pickerRows = computed<PickerRow[]>(() =>
  pickerSource.value === "owned"
    ? pickerOwned.value
    : pickerResults.value.map((it) => ({
        key: `cat-${it.id}`,
        id: it.id,
        name: it.name,
        image: it.image,
        rarity: it.rarity,
        type: it.type ?? PICKER_TYPE[picker.value?.kind ?? "sticker"],
      })),
);

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
// Facets are a click, not typing - refetch immediately, and cancel a debounced
// search so a keystroke from a moment ago can't land after and undo the filter.
// (Sort and direction do the same via useSortControl's onChange, above.)
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
/**
 * The picker's narrowing axes, in the order they read.
 *
 * Counts ride INSIDE the label rather than in `count`: the shared bar puts a
 * fixed-width badge on tabs, where the value changes as you type, but a
 * dropdown row is only ever read when it is open and "IEM Katowice (42)" is
 * shorter than the same thing spread across two columns.
 */
const pickerAxes = computed<FacetAxis[]>(() => {
  const out: FacetAxis[] = [];
  if (pickerCollections.value.length > 1) {
    out.push({
      key: "collection",
      label: "Collection",
      options: pickerCollections.value.map((f) => ({ value: f.value, label: `${f.label ?? f.value} (${f.count})` })),
    });
  }
  if (pickerRarities.value.length > 1) {
    out.push({
      key: "rarity",
      dots: true,
      options: [...pickerRarities.value]
        .sort((a, b) => sortRarityRank(b.value) - sortRarityRank(a.value))
        .map((f) => ({ value: f.value, label: `${rarityName(f.value)} (${f.count})`, color: f.value })),
    });
  }
  return out;
});
// Same adjustable-tile treatment as the inventory/loadout grids. Charm and
// sticker art is small and busy — 92px is a lot of catalog on screen but too
// little to tell two similar charms apart, so the size is the user's call.
const attachCardSize = usePersistedNumber("cs2inv.attachCardSize", 92);
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
  // Always opens on the catalog. Owned is the narrower shelf and is often
  // empty, and a picker that opened on "no results" would read as broken.
  pickerSource.value = "all";
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
const preview3d = ref<{
  image: string;
  name: string;
  kind: string;
  /**
   * The slot on the weapon this was opened FROM, or null when it came from the
   * picker. What it decides is where the panel's wear/seed write to — see
   * preview3dWearBound. The charm is slot 0; it is the only one it has, and the
   * game's own keychain message numbers it the same way.
   */
  slot: number | null;
} | null>(null);
const preview3dEl = ref<HTMLElement | null>(null);
/** Resolved off the reactive state on purpose: a ViewerTarget carries the
 *  charm's whole shading table, and there is nothing in it worth proxying. */
let preview3dTarget: ViewerTarget | null = null;
const preview3dViewer = useViewerMount({
  label: "preview3d",
  host: () => preview3dEl.value,
  // Surfaced now, like the other three mounts. This one closed the panel and
  // said nothing, so a preview that failed to load was indistinguishable from
  // one you had dismissed yourself.
  onError: (e) => {
    preview3d.value = null;
    fail(e);
  },
});
function closePreview3d() {
  preview3dViewer.teardown();
  preview3dTarget = null;
  clearTimeout(preview3dRetex);
  preview3d.value = null;
}
/**
 * Wear/seed for a preview with nothing to write to.
 *
 * Seeded from whatever is actually applied when there IS an applied value (see
 * openPreview3d), so a view-only preview opens showing the real sticker rather
 * than a pristine one, and scrubbing it is a non-destructive "what if".
 */
const preview3dScratch = ref({ wear: 0, seed: 0 });
/**
 * Does this panel edit the weapon for real, or a throwaway?
 *
 * Real when the preview was opened from a slot that still holds something and
 * the modal is in edit mode. Then the slider and the one in the options column
 * are two views of ONE value: the gun behind the panel retextures as you drag
 * and Save keeps it. From the picker there is no slot yet, and in view mode
 * there is nothing to change, so both fall back to the scratch.
 */
const preview3dWearBound = computed(() => {
  const p = preview3d.value;
  return !!p && p.kind === "sticker" && p.slot != null && !viewOnly.value && !!craft.value?.stickers[p.slot];
});
const preview3dSeedBound = computed(() => {
  const p = preview3d.value;
  return !!p && p.kind === "charm" && p.slot != null && !viewOnly.value && !!craft.value?.charm;
});
/** A patch gets neither: patches don't scratch and carry no pattern. */
const preview3dHasWear = computed(() => preview3d.value?.kind === "sticker");
const preview3dHasSeed = computed(() => preview3d.value?.kind === "charm");
const preview3dWear = computed({
  get: () =>
    preview3dWearBound.value
      ? craft.value!.stickers[preview3d.value!.slot!]!.w ?? 0
      : preview3dScratch.value.wear,
  set: (w: number) => {
    if (preview3dWearBound.value) setStickerWear(preview3d.value!.slot!, w);
    else preview3dScratch.value.wear = Math.min(1, Math.max(0, w));
  },
});
const preview3dSeed = computed({
  get: () => (preview3dSeedBound.value ? craft.value!.charm!.seed ?? 0 : preview3dScratch.value.seed),
  set: (s: number) => {
    const v = Math.min(100000, Math.max(0, Math.floor(Number(s) || 0)));
    if (preview3dSeedBound.value) craft.value!.charm!.seed = v;
    else preview3dScratch.value.seed = v;
  },
});
// Declared HERE, not with its ref: hiding the pattern strip unmounts the rail
// that reported the verdict, so the flag has to be dropped whenever the subject
// changes or the next charm inherits it. See craftCharmInert for the full note.
watch(preview3d, () => (previewCharmInert.value = false));
/** Picker kind -> cs2-lib type. The picker says "charm"; the economy calls it a
 *  "keychain", and the resolver switches on the economy's name. Without this the
 *  charm preview resolved to null and the panel opened on nothing. */
const ATTACH_TYPE: Record<string, string> = { sticker: "sticker", patch: "patch", charm: "keychain" };
/**
 * Open the preview for any attachment-shaped thing (sticker, patch, charm).
 *
 * `applied` is where it came from: a slot means it is already on the weapon and
 * the panel's controls edit it for real; omitted means the PICKER, where
 * nothing is attached yet and they drive a scratch value instead.
 */
async function openPreview3d(
  item: { image?: string | null; name?: string | null; type?: string | null },
  kind: string,
  applied?: { slot: number },
) {
  if (!item?.image) return;
  // The picker's rows are `Skin`s from an attachment catalog, which carry no
  // `type` — the PICKER knows what it is asking for, so the kind comes from the
  // caller and the resolver is fed a synthetic item.
  const target = await resolveViewerModel({ type: item.type ?? ATTACH_TYPE[kind] ?? kind, image: item.image });
  if (!target) return;
  preview3dScratch.value = {
    wear: (applied && kind === "sticker" ? craft.value?.stickers[applied.slot]?.w : null) ?? 0,
    seed: (applied && kind === "charm" ? craft.value?.charm?.seed : null) ?? 0,
  };
  preview3dTarget = target;
  preview3d.value = { image: item.image, name: item.name ?? "", kind, slot: applied?.slot ?? null };
  await mountPreview3d();
}
/**
 * (Re)build the viewer for whatever `preview3d` currently describes.
 *
 * Split out of openPreview3d because wear and seed are MOUNT-time inputs — the
 * decal's scratch is baked into its texture and a charm's pattern grades its
 * material (tuneCharmShading), and neither has a live setter on the handle. So
 * changing one rebuilds, exactly as the craft modal's retex watcher does.
 */
async function mountPreview3d() {
  const p = preview3d.value;
  const target = preview3dTarget;
  if (!p || !target) return;
  await preview3dViewer.mount(
    target.model,
    () => ({
      kind: target.kind,
      charmSpec: target.charm ?? null,
      // The slot's own scratch amount, not a hardcoded 0 — this panel is where
      // you set it, and a preview that ignored it showed a sticker the weapon
      // behind it disagreed with.
      decal:
        target.kind === "sticker" || target.kind === "patch"
          ? { image: p.image, wear: preview3dWear.value }
          : null,
      // A charm's pattern drives real shader params on 36 of the 89 keychain
      // materials. Unpassed, every charm previewed at its default grade.
      seed: preview3dSeed.value,
      frame: "fit",
      // Orbitable but not draggable: there is no weapon to place anything on,
      // and a slow turn is what shows a holo sticker or a charm's depth.
      interactive: false,
    }),
    (handle) => (previewAlbedo.value = handle.charmAlbedoTile()),
  );
}
// Debounced remount so dragging the wear slider doesn't recomposite the decal on
// every tick. Identity-guarded for the same reason the craft modal's retex
// watcher is: OPENING a preview trips this too (the values go to whatever the
// new attachment carries) and that is not an edit — openPreview3d already
// mounted it, and remounting again would restart the load and reset the spin.
let preview3dRetex: ReturnType<typeof setTimeout> | undefined;
let preview3dRetexOwner: object | null = null;
watch(
  () => [preview3d.value, preview3dWear.value, preview3dSeed.value] as const,
  (now, before) => {
    const owner = preview3d.value ?? null;
    if (owner !== preview3dRetexOwner) {
      preview3dRetexOwner = owner;
      return;
    }
    // A PATTERN change on the same attachment is a re-shade, not a rebuild —
    // the charm's seed drives a handful of shader params and nothing else, so
    // the mounted model can just be told the new number. That is what lets the
    // rail below scrub: at 300ms-debounced remounts a drag produced a slideshow
    // of reloads, and every one of them restarted the spin. Wear still remounts
    // (it recomposites a decal) and so does a swapped attachment.
    if (before && now[0] === before[0] && now[1] === before[1] && now[2] !== before[2]) {
      preview3dViewer.current()?.setCharmSeed(now[2]);
      return;
    }
    clearTimeout(preview3dRetex);
    preview3dRetex = setTimeout(() => {
      if (preview3d.value) void mountPreview3d();
    }, 300);
  },
);
// The craft modal closing (or the picker) must not leave a live context
// rendering into a detached node.
watch([craft, picker], () => {
  if (preview3d.value) closePreview3d();
});

function pickAttachment(item: PickerRow) {
  if (!picker.value || !craft.value) return;
  // `inst` rides along from an OWNED row: that is what links the gun to the
  // sticker you already have instead of minting another one. A catalog row has
  // none, and saving mints it.
  const a: Attach = { id: item.id, name: item.name, image: item.image, inst: item.inst ?? null };
  const kind = picker.value.kind;
  if (kind === "sticker") {
    // Its own scratch, carried over so the 3D preview is honest BEFORE the save
    // that would resolve it server-side. Picking a sticker you'd worn down to
    // 0.8 and seeing it render pristine reads as the wear having been lost.
    if (item.inst) a.w = item.wear ?? null;
    craft.value.stickers[picker.value.slot] = a;
  } else if (kind === "patch") {
    craft.value.patches[picker.value.slot] = a;
  } else {
    craft.value.charm = item.inst ? { ...a, seed: item.seed ?? null } : a;
  }
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
  /**
   * Destructive by default, because that is what this dialog was built for.
   * "neutral" drops the red and the bin for the asks that aren't losing you
   * anything — moving a sticker between two of your own guns is a decision
   * worth confirming, not a deletion, and dressing it as one cries wolf.
   */
  tone?: "danger" | "neutral";
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

// ---- sliding-pill tabs ------------------------------------------------------
// Every strip is a <PillTabs>, which owns its own indicator and re-syncs itself
// on the active tab, the tab SET and the breakpoint. That retired eight
// makePill() instances here plus `syncAllPills` and its six watchers — each of
// which existed only because the markup was pasted rather than shared.

/** The header's three screens. `to` is what the tab navigates to. */
const viewTabs = computed(() => [
  { key: "grid", label: "Loadout", icon: LayoutGrid, to: "/" },
  ...(canEdit.value
    ? [
        { key: "inventory", label: "Inventory", icon: Package, to: "/items" },
        { key: "armory", label: "Craft", icon: Hammer, to: "/craft" },
      ]
    : []),
]);

/** Owned only exists when signed in; Replace only on a weapon slot. */
const sheetModeTabs = computed(() => [
  ...(signedIn.value ? [{ key: "owned", label: "Owned" }] : []),
  ...(isWeaponPos(selected.value) ? [{ key: "replace", label: "Replace" }] : []),
  { key: "craft", label: "Craft" },
]);

/** The 2D/3D stage toggle, shared by the focus view and the craft modal. */
const STAGE_TABS = ["2D", "3D"] as const;
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
//
// EVERY inspect entry point funnels through here: the item modal, the focus
// stage, both context menus, the tile clusters, the default-weapon stage and
// the attachment preview. ONE RULE — a surface that is showing you an item
// offers to open it in game — and the only way that rule holds is if the
// surfaces share this. Each one used to carry its own copy of the handoff plus
// its own idea of when to bother, which is how the button ended up present on
// some screens, absent on others, and gone the moment you touched Edit.
async function sendInspect(link: () => Promise<{ inspect: string }>) {
  // Both link endpoints are authenticated, so signed out there is genuinely
  // nothing to hand the OS. SAID, not hidden: this app is a public sandbox —
  // an anonymous visitor can build a whole craft and open it in 3D — and a
  // button that quietly isn't there reads as a missing feature, where "sign in"
  // reads as a door. Same call the Save row makes two boxes down.
  if (!signedIn.value) {
    notify(tr("inventory.notify.sign_in_to_inspect", "Sign in to open this in game."), "error");
    return;
  }
  try {
    const { inspect } = await link();
    window.location.href = inspect;
    linkOpening.value = true;
    notifyInspectSent();
    setTimeout(() => (linkOpening.value = false), 1600);
  } catch (e) {
    fail(e);
  }
}
/** An OWNED row of yours. The saved route re-reads each attachment's own row
 *  server-side, which is where a linked sticker's scratch actually lives, so
 *  this is the authoritative link whenever there is an instance to ask about. */
async function openInspectLink(id: number) {
  await sendInspect(() => fetchInspectLink(id));
}
/**
 * Inspect a bare CATALOG item — one nobody owns and no editor is holding: the
 * default weapon on the loadout's 3D stage, the sticker or charm in the
 * attachment preview. Vanilla is just paintindex 0 to the link builder, so the
 * id plus whatever the surface knows is the whole input.
 */
async function openItemInspect(
  itemId?: number | null,
  spec: Omit<Parameters<typeof fetchDraftInspectLink>[0], "item_id"> = {},
) {
  if (itemId == null) return;
  await sendInspect(() => fetchDraftInspectLink({ item_id: itemId, ...spec }));
}
/**
 * Inspect whatever a LOADOUT CELL is showing, owned or not.
 *
 * Two of the three things a cell can hold have no instance id behind them: a
 * free DEFAULT weapon (never owned), and any cell on a loadout you are VISITING
 * (the public endpoint withholds the id on purpose — it's their row handle).
 * Both used to mean no button, which is backwards: someone else's gun is the
 * one you most want to see in game, and the row already carries everything this
 * screen is rendering for it.
 *
 * Attachments are the one thing it can't carry — a visited row ships no
 * stickers or charm — but the viewer next to the button isn't showing them
 * either, so the link and the model still agree.
 */
async function inspectLoadoutRow(row?: LoadoutEntry) {
  const inst = instanceById(row?.item_instance_id);
  if (inst) return openInspectLink(inst.id);
  await openItemInspect(row?.item?.id, {
    wear: row?.wear,
    seed: row?.seed,
    stattrak: row?.stattrak,
    stattrak_count: row?.stattrak_count,
    nametag: row?.nametag,
  });
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

// ---- gestures ---------------------------------------------------------------
// Swipe-to-dismiss now belongs to the sheets themselves — ContextMenu and
// FilterSheet each call useSwipeDismiss(), so App no longer brokers it. Only the
// slot long-press stays here, because it is DELEGATED from the loadout
// container rather than bound to any one element.
const {
  onPointerDown: onSlotPointerDown,
  onPointerMove: onSlotPointerMove,
  cancel: cancelLongPress,
  onClickCapture: onSlotClickCapture,
} = useSlotLongPress((pos) => openCtxFor(pos));

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
  // Direction too — resetInvFilters always did this and this one didn't, so the
  // same button left the sheet sorted backwards on one screen and not the other.
  sheetDir.value = sheetSortCtl.loadDir(DEFAULT_SORT);
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

const sheetLift = usePersistedBool("cs2inv.sheetLift", false);

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
const sheetCardSize = usePersistedNumber("cs2inv.sheetCardSize", 176);
/**
 * The sheet's card slider has two ranges — a phone cannot give a 260px card the
 * room a desktop can. They were two hardcoded `min`/`max` pairs writing ONE
 * value, so a desktop size of 260 left the compact slider pegged at its 168 max
 * while the grid still laid out at 260. Clamp into whichever range is live.
 */
const SHEET_CARD_BOUNDS = computed<[number, number]>(() => (isCompact.value ? [120, 168] : [140, 260]));
watch(
  SHEET_CARD_BOUNDS,
  ([lo, hi]) => (sheetCardSize.value = Math.min(hi, Math.max(lo, sheetCardSize.value))),
  { immediate: true },
);

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
// scrollFade (the ordinary "more below" cue) lives in dom.ts.
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
  if (pos) await inspectLoadoutRow(rowFor(pos));
}
async function ctxCopy() {
  if (ctx.value) await copyToOtherTeam(ctx.value.pos);
  closeCtx();
}

// ---- inventory view ---------------------------------------------------------
const invSearchCtl = useDebouncedSearch();
const invSearch = invSearchCtl.term;
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
const invSearchApplied = invSearchCtl.applied;
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
function clearInvFilters() {
  invSearchCtl.applyNow("");
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

/**
 * Derived from the count rather than restated. These were two separate
 * predicates over the same state that disagreed: this one ignored sort, while
 * `invFilterCount` (the compact sheet's badge) counted it — so the desktop
 * Clear button could be hidden while the phone claimed one active filter.
 *
 * Declared AFTER invFilterCount, which is why this is a getter over it.
 */
const filtersActive = computed(() => invFilterCount.value > 0);
function resetInvFilters() {
  clearInvFilters();
  invSort.value = DEFAULT_SORT;
  invDir.value = invSortCtl.loadDir(DEFAULT_SORT);
}
// ---- how tall are we, really ------------------------------------------------
// See composables/useAppHeight.ts. Compact only: desktop's 6rem assumption is
// correct there and well tested.
const { el: appRootEl, style: appHeightStyle } = useAppHeight(
  () => isCompact.value && !embedMode.value,
);

const cardSize = usePersistedNumber("cs2inv.cardSize", 164);
// Resizing the cards re-flows the grid, so the "more below" cue has to re-measure.
watch(cardSize, () => invFade.remeasure());
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
    // Applied straight away, bypassing the debounce: this is a whole query
    // arriving at once (a deep link or a back/forward), not someone typing, so
    // there are no intermediate states to hide and no reason to wait.
    if (q !== invSearch.value) invSearchCtl.applyNow(q);
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
  stackByDesign(filteredInventory.value, invDesign.value, (i) => i.item, (i) => i.id, tintColors.value),
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
const inventoryWindow = useRenderWindow(inventoryStacks, () => invFilterSig.value);
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
// The preference is its own persisted value, deliberately NOT `focus3d` itself:
// a slot with no model forces the live ref to 2D, and that must not overwrite
// what the user actually chose.
const focus3dWanted = usePersistedBool("cs2inv.focus3d", true);
const focus3dPref = () => focus3dWanted.value;
function setFocus3d(on: boolean) {
  focus3d.value = on;
  focus3dWanted.value = on;
}
const focus3d = ref(false);
const focus3dAvailable = ref(false);
// immediate: seeds the active key before the focus stage mounts, so the pill's
// initial ResizeObserver fire can position the indicator on its own.
// Sheet origin tabs only exist in Owned mode (and behind the compact filter
// disclosure), so re-seed on every condition that (re)mounts them.
const viewer3dEl = ref<HTMLElement | null>(null);
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
  // The attachment source, not the instance: a report filed from someone else's
  // loadout has to count the stickers that are on the stage, and in viewer mode
  // there is no instance behind them.
  const inst = focusAttachments.value;
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

// Same abort discipline as every other stage — see useViewerMount. `waitForHost`
// is this one's peculiarity: the focus stage arrives inside a view swap, so the
// host element can be a frame or two late.
const focusViewer = useViewerMount({
  label: "focus",
  host: () => viewer3dEl.value,
  waitForHost: () => waitForViewerEl(),
  onError: (e) => {
    focus3d.value = false;
    fail(e);
  },
});
const teardownViewer = focusViewer.teardown;
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
/**
 * Anything that can dress a model: an owned inventory item, or a public loadout
 * row. Both carry the same enriched `stickers`/`patches`/`charm` and the same
 * StatTrak pair, which is all instPlacements ever reads off either.
 */
type AttachSource = InventoryItem | LoadoutEntry;
// The equipped instance behind the focused slot. Own loadout only: viewer mode
// withholds the instance id (it is the owner's row handle), so nothing here can
// resolve — see focusAttachments for where a visitor's stickers come from.
const focusInstance = computed(() => {
  return instanceById(focusRow.value?.item_instance_id) ?? null;
});
/**
 * Where the focused slot's attachments come from, whichever loadout it is.
 *
 * Your own resolves the owned instance out of the inventory list; a visitor has
 * no inventory for the player they are looking at, so the PUBLIC loadout row
 * carries the same enriched stickers/patches/charm and stands in for it. That
 * fallback is the whole of "render attachments in viewer mode" — before it, a
 * shared loadout showed the right finish, wear and pattern on a gun with none of
 * the work on it, which is the part people actually spend their time placing.
 */
const focusAttachments = computed<AttachSource | null>(
  () => focusInstance.value ?? focusRow.value ?? null,
);
// InventoryItem → viewer placement shapes (Focus + loadout 3D overlay).
/**
 * "Applied to AK-47 | Redline", for an attachment that is currently on a gun.
 *
 * The API says WHICH item (`attached_to`, an owned-item id) and the name is
 * looked up here, because only this screen holds the whole inventory. Null for
 * anything loose — which is every weapon, and every spare sticker.
 *
 * Ids are compared as strings on purpose: owned_items.id is a bigint and
 * node-postgres serialises those as strings, so both sides of this are `"1014"`.
 */
function attachedName(inst?: InventoryItem | null): string | null {
  const to = inst?.attached_to;
  if (to == null) return null;
  const host = inventory.value.find((i) => String(i.id) === String(to));
  return host ? itemName(host.item) : null;
}
function instPlacements(inst?: AttachSource | null) {
  return {
    stickers: (inst?.stickers ?? []).flatMap((st, i) =>
      st?.image ? [{ slot: i, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null }] : [],
    ),
    charm: inst?.charm?.image
      ? {
          image: inst.charm.image,
          x: inst.charm.x ?? null,
          y: inst.charm.y ?? null,
          z: inst.charm.z ?? null,
          // The charm's own pattern grades its material, exactly as it does in
          // the craft modal (craftCharmPlacement passes it). Dropped here, every
          // charm in Focus and on the loadout stage rendered at its default
          // grade while the editor showed the real one.
          seed: inst.charm.seed ?? null,
        }
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
  if (!key) return;
  await focusViewer.mount(key, async () => {
    // Weapon-only machinery, skipped by kind — sticker slots and the charm
    // attachment mean nothing on an agent or a glove, and stickerGeom would
    // fetch markup for a key no weapon has.
    const isWeapon = (focusTarget.value?.kind ?? "weapon") === "weapon";
    return {
      kind: focusTarget.value?.kind,
      paintMaterial: focusPaint.value,
      legacyPaint: focusLegacyPaint.value,
      wear: focusRow.value?.wear ?? focusInstance.value?.wear,
      seed: focusRow.value?.seed ?? focusInstance.value?.seed,
      ...(isWeapon ? await stickerGeom(key) : {}),
      ...(isWeapon ? instPlacements(focusAttachments.value) : {}),
      // See the craft modal for why patches are their own option rather than
      // part of instPlacements.
      patches:
        focusTarget.value?.kind === "agent"
          ? (focusAttachments.value?.patches ?? []).map((p) => p?.image ?? null)
          : undefined,
      // Focus can be showing a loadout DEFAULT rather than an owned item, and
      // a default can be StatTrak too — instPlacements sees no instance there
      // and would drop the module, so fall back to the row.
      stattrak:
        focusAttachments.value?.stattrak || focusRow.value?.stattrak
          ? { count: focusAttachments.value?.stattrak_count ?? focusRow.value?.stattrak_count ?? 0 }
          : null,
    };
  });
}

// ---- 3D overlay for a DEFAULT weapon (ctx menu → View in 3D) ----------------
// Owned items don't come here — they open the craft modal in view mode, which
// can show their spec and hand off to Edit. This overlay is what's left for a
// model with no instance behind it: no wear and no attachments, so it's a bare
// stage with a name, an inspect link and a close button.
//
// `id` is the base weapon's own economy item id. It's here because "no instance
// behind it" was read as "nothing to inspect", and that's wrong: a vanilla
// weapon is paintindex 0 to the link builder like any other item, so this stage
// can offer the link the same way every other stage does. It just can't ask the
// saved route for it — there is no owned row — so it goes out as a bare draft.
const loadout3d = ref<{ pos: string; model: string; name: string; id: number | null } | null>(null);
const loadout3dEl = ref<HTMLElement | null>(null);
// Mounting downloads a GLB and composites the paint — seconds on a cold cache,
// during which the canvas is just empty black. Covered by a spinner instead
// (`loadout3dViewer.busy`).
const loadout3dViewer = useViewerMount({
  label: "loadout3d",
  host: () => loadout3dEl.value,
  onError: (e) => {
    closeLoadout3d();
    fail(e);
  },
});
// Pure teardown. The route watcher calls this, so it must NOT navigate — see
// dismissLoadout3d for the button the user actually presses.
function closeLoadout3d() {
  loadout3dViewer.teardown();
  loadout3d.value = null;
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
/**
 * `kind` is REQUIRED, and was the bug: this mount alone passed none, so a
 * default knife, glove or agent opened from a slot's context menu was mounted
 * as a weapon. It also fetched sticker geometry unconditionally, for models
 * that have no sticker slots — the other three mounts gate that on being a
 * weapon.
 */
async function openViewer3d(
  model: string,
  name: string,
  paint: string | null,
  legacyPaint = false,
  kind: ViewerKind = "weapon",
  id: number | null = null,
) {
  loadout3d.value = { pos: "", model, name, id };
  await loadout3dViewer.mount(model, async () => ({
    kind,
    paintMaterial: paint,
    legacyPaint,
    ...(kind === "weapon" ? await stickerGeom(model) : {}),
  }));
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
  // A default has no instance to resolve a kind from, so it comes from the SLOT.
  const kind: ViewerKind = pos === "gloves" ? "glove" : pos === "agent" ? "agent" : "weapon";
  // The row's own item first — a slot can hold a free default WEAPON equip
  // (an item_id with no instance), and that item is what the stage is showing.
  // The catalog weapon is the fallback for a slot sitting on true vanilla.
  await openViewer3d(
    model,
    name,
    isSkinned(row) ? row?.item?.paintMaterial ?? null : null,
    isSkinned(row) && !!row?.item?.legacyPaint,
    kind,
    row?.item?.id ?? occupantWeapon(pos)?.id ?? null,
  );
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
  // preview3d was the one viewer NOT torn down here — it relied on
  // watch([craft, picker]) firing, which unmount does not do. A live WebGL
  // context rendering into a detached node outlives the whole plugin.
  closePreview3d();
  // Timers that used to outlive the component. Each one fires into a torn-down
  // setup: the retex pair remount viewers that no longer have a host, and the
  // preview/craft ones write to refs nothing reads.
  clearTimeout(craftSettleTimer);
  clearTimeout(retexTimer);
  clearTimeout(retexRebuild);
  clearTimeout(craftPreviewTimer);
  clearTimeout(pickerTimer);
  clearTimeout(preview3dRetex);
  peekRO?.disconnect();
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
      catalogAgents.value = catalog.agents ?? [];
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = [];
      inventory.value = [];
      loadSkins(sheetKey.value);
    } else {
      const [catalog, current, inv] = await Promise.all([fetchCatalog(), fetchLoadout(), fetchInventory()]);
      weapons.value = catalog.weapons;
      catalogAgents.value = catalog.agents ?? [];
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
    if (devHudOpen.value) {
      // Ahead of everything: it is a popover anchored inside the craft modal's
      // 3D stage, so Escape has to dismiss IT before the modal underneath.
      // DevHud also listens for Escape itself; both closing it is the same
      // outcome, and this branch is what stops the modal going with it.
      devHudOpen.value = false;
      e.stopPropagation();
    } else if (preview3d.value) {
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
    // Matches the header pill: no visible toggle, no shortcut for it.
  } else if ((e.key === "t" || e.key === "T") && (view.value === "grid" || view.value === "focus")) {
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
// `serverBuild` is intentionally not destructured: it was only ever passed to
// AdminConsole as `:server-build`, which never declared the prop, so the value
// has never been displayed anywhere. The composable still logs the stamp and
// still drives `staleBuild`. Surfacing it in the admin gear dialog would be a
// small follow-up, not a refactor.
const { staleBuild, reloadPage } = useBuildCheck();
onMounted(() => {
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
  // per-view routes rather than offering nothing. `itemPage` is reused rather
  // than rebuilt: it was constructed twice with identical arguments.
  return links.length
    ? links
    : [
        itemPage,
        shareLink("3D view", `/items/${id}/3d`, {}, ITEM_LINK_NOTE),
        shareLink("Craft editor", `/items/${id}/craft`, {}, ITEM_LINK_NOTE),
      ];
}
/** Append the public loadout link when there is one — the tail both list
 *  builders below used to spell out separately. */
function withPublicLink(links: ShareLink[]): ShareLink[] {
  const pub = publicLoadoutLink.value;
  return pub ? [...links, pub] : links;
}
function instanceShareLinks(id: number | string | null | undefined): ShareLink[] {
  return withPublicLink(id == null ? [] : itemShareLinks(id));
}
// The current screen, filters/team/slot and all — the payoff for putting view
// state in the query in the first place.
const viewShareLinks = computed<ShareLink[]>(() => {
  const here = shareLink(
    view.value === "inventory" ? "This inventory view" : view.value === "focus" ? "This focused slot" : "This view",
    router.path.value,
    transientQuery(),
  );
  return withPublicLink([here]);
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

// ---- copy the loadout you're looking at -------------------------------------
// /loadout/copy-from has existed since player profiles shipped and nothing in
// the UI ever pointed at it, so the one action a visitor actually wants from
// someone else's loadout was reachable only by hand-rolling a POST.
//
// It is not a "follow" or a bookmark: it mints a real copy of every equipped
// skin into your inventory (origin 'copied') and equips each one in the same
// slot, overwriting what you had there. That's worth a sentence BEFORE the
// click rather than a surprise after it — hence the confirm, in the neutral
// tone: nothing is lost, but your own loadout is rearranged.
const copyBusy = ref(false);
function askCopyLoadout() {
  const source = viewerId.value;
  if (!source || copyBusy.value) return;
  confirmAsk.value = {
    title: "Copy this loadout?",
    body:
      "Every skin equipped here is copied into your inventory and equipped in" +
      " the same slot of your own loadout, replacing whatever you have in those" +
      " slots. Nothing of theirs changes, and nothing of yours is deleted — the" +
      " items you had stay in your inventory.",
    confirmLabel: "Copy loadout",
    tone: "neutral",
    onConfirm: () => void copyViewedLoadout(source),
  };
}
async function copyViewedLoadout(source: string) {
  copyBusy.value = true;
  try {
    const { copied } = await copyLoadoutFrom(source);
    // Deliberately NO refreshAll(): in viewer mode `loadout` holds THEIR rows
    // and `inventory` is empty by design, so refreshing would swap the screen
    // for yours — the copy would look like it had teleported you somewhere.
    // The toast says where the items went; the loadout you came to look at
    // stays on screen.
    const summary = copied === 1 ? "1 item" : `${copied} items`;
    notify(
      copied
        ? tr(
            "inventory.notify.loadout_copied",
            `Copied ${summary} into your inventory and equipped them on your own loadout.`,
            { summary },
          )
        : tr("inventory.notify.loadout_copy_empty", "Nothing to copy — that loadout is empty."),
      "success",
    );
  } catch (e) {
    fail(e);
  } finally {
    copyBusy.value = false;
  }
}

// ---- bulk select/delete (inventory view) ----
const selectMode = ref(false);

/**
 * Craft something, with no loadout slot involved.
 *
 * Crafting used to start at a loadout POSITION — pick the r2 slot, browse what
 * fits it, build one. That is the right flow when you're filling a loadout and
 * the wrong one when you just want to make a thing, and it could not express an
 * attachment at all: a sticker fits no slot, so there was no way in.
 *
 * This is a whole SCREEN rather than a menu (see Armory.vue). A menu was the
 * first attempt and it had to punt the weapon case back to the loadout, which
 * is the detour the button exists to avoid — and a nine-item list is a poor
 * front door for ten thousand stickers besides. Browsing is the activity here,
 * so it gets somewhere to happen.
 */
function openArmory() {
  go(buildPath({ name: "armory" }));
}
/**
 * Which catalog ids the viewer already has, as a set.
 *
 * The armory's ownership progress ("you own 4 of 17 in this collection") is this
 * intersected with a collection's members — no endpoint, and no second source of
 * truth about what is owned. Derived from the inventory already in memory, so it
 * follows a craft or a delete the moment the grid does.
 */
const ownedItemIds = computed(() => new Set(inventory.value.map((i) => i.item_id)));
/** A finish chosen in the armory: straight into the editor, over the armory. */
function armoryPick(skin: Skin) {
  modalBackdrop.value = "armory";
  openCraft(skin);
}
watch(selectMode, () => {
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
      <!-- Only the loadout screens are per-side. The inventory is one list of
           what you own, and the armory is a catalogue you craft FROM — neither
           reads `team`, so a side toggle there is a control with nothing on the
           other end of it. -->
      <PillTabs
        v-if="view === 'grid' || view === 'focus'"
        :items="(['CT', 'T'] as Team[])"
        :item-key="(t) => t"
        :active="team"
        variant="solid"
        :solid-background="gradient"
        :button-class="`relative z-[1] flex h-7 items-center rounded-md font-bold uppercase tracking-widest transition-colors ${isCompact ? 'px-2.5 text-f13' : 'px-5 text-sm'}`"
        active-class="text-black"
        @select="(t) => switchTeam(t as Team)"
      />
      <button
        v-if="view === 'grid' || view === 'focus'"
        class="tac-action flex items-center gap-1.5 rounded-lg border text-f11 font-semibold uppercase tracking-wider"
        :class="[isCompact ? 'h-8 px-2' : 'h-9 px-3.5', view === 'focus' ? 'tac-on' : 'border-border text-muted-foreground']"
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
          class="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-f11 font-semibold uppercase tracking-wider text-muted-foreground tac-action"
          title="Edit your loadout in the full inventory page"
          @click="onEditClick"
        >
          <Pencil class="h-3.5 w-3.5" />
          <span v-if="!isCompact">Edit</span>
        </a>
        <!-- Someone else's loadout is read-only, with exactly one way to act on
             it: take it home. This is the only entry point to
             /loadout/copy-from, which the backend has had all along — and the
             corner it sits in is the one every other surface puts its actions
             in, so it reads as "the thing to do here" rather than an offer.
             Hidden on your own profile tab (copying yourself onto yourself),
             signed out (nowhere to copy TO) and on an empty loadout (nothing to
             copy), because a button that can only disappoint is worse than no
             button. The dialog behind it says what it will do first. -->
        <button
          v-if="viewerId && !viewingSelf && signedIn && loadout.length && !loading && !error"
          class="tac-action flex items-center gap-1.5 rounded-lg border border-border text-f11 font-semibold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
          :class="isCompact ? 'h-8 px-2' : 'h-9 px-3.5'"
          :disabled="copyBusy"
          title="Copy every skin in this loadout into your own inventory"
          @click="askCopyLoadout"
        >
          <Loader2 v-if="copyBusy" class="h-3.5 w-3.5 animate-spin" />
          <Copy v-else class="h-3.5 w-3.5" />
          <!-- Compact keeps the label. The icon alone is the same two sheets
               of paper the inventory uses for "duplicate an item", and here it
               would be the only header control whose meaning depends on
               knowing whose loadout you are on. -->
          <span>Copy loadout</span>
        </button>

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
              class="relative grid place-items-center rounded-md border text-muted-foreground tac-action disabled:opacity-60"
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
              class="relative grid place-items-center rounded-md border border-border text-muted-foreground tac-action"
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
        <!-- Craft is a PEER of the other two, not a button inside the
             inventory. The three tabs are the three things you do here — wear
             it, keep it, make it — and burying the third inside the second
             said it was a mode of managing what you own, which is the opposite
             of what that screen is for: nothing in it is yours yet.
             Gated on canEdit like Inventory: with no account to craft into,
             the tab is a dead end. -->
        <PillTabs
          v-if="!embedMode"
          :items="viewTabs"
          :item-key="(t) => t.key"
          :active="view"
          button-class="relative z-[1] flex h-7 items-center gap-1.5 rounded-md px-3 text-f11 uppercase tracking-wider transition-colors"
          @select="(k) => go(viewTabs.find((t) => t.key === k)!.to)"
        >
          <template #default="{ item: t }">
            <!-- Compact drops EVERY label, not just the inactive ones. Tabs with
                 distinct icons and a sliding indicator under the live one say
                 which is which; the words were ~70px of a ~376px row, which is
                 what pushed the header into scrolling sideways — and that was
                 with two of them. -->
            <component :is="t.icon" class="h-3.5 w-3.5" />
            <span v-if="!isCompact">{{ t.label }}</span>
            <span v-if="t.key === 'inventory' && inventory.length" class="font-mono text-f10 text-muted-foreground">{{ inventory.length }}</span>
          </template>
        </PillTabs>
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
        class="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-f13 uppercase tracking-wider text-muted-foreground tac-action"
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
      <!-- ============ ARMORY (catalog browser) ============
           Its own screen in the cross-slide, so arriving from the inventory
           reads as travel rather than the page redrawing itself. -->
      <Armory
        v-if="view === 'armory'"
        key="armory"
        :weapons="weapons"
        :owned="ownedItemIds"
        :compact="isCompact"
        @pick="armoryPick"
      />

      <!-- ============ INVENTORY VIEW ============ -->
      <div v-else-if="view === 'inventory'" key="inventory" class="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            class="ml-auto grid h-8 w-8 flex-none place-items-center rounded-md border border-border text-muted-foreground tac-action"
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
          <PillTabs
            :items="ORIGIN_FILTERS"
            :item-key="(f) => f[0]"
            :active="invOrigin"
            list-class="shrink-0"
            button-class="relative z-[1] flex h-6 items-center rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
            @select="(v) => (invOrigin = v as OriginFilter)"
          >
            <template #default="{ item: f }">{{ f[1] }}</template>
          </PillTabs>
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
          <SortDirection v-model="invDir" :kind="invSortKind" :hint="invSortHint" />
          <button
            v-if="filtersActive"
            class="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            title="Clear all filters"
            @click="resetInvFilters"
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
        <FilterSheet
          :open="invFiltersOpen"
          :active-count="invFilterCount"
          @close="invFiltersOpen = false"
          @reset="resetInvFilters"
        >
          <template #title>Filter inventory</template>
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
                  <SortDirection v-model="invDir" :kind="invSortKind" :hint="invSortHint" class="ml-auto" />
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
        </FilterSheet>

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
              class="flex h-full w-full items-center justify-center gap-1 rounded-md border border-border text-f9 uppercase tracking-wider text-muted-foreground tac-action"
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
            <!-- Points at the armory, not the loadout. Sending someone to pick a
                 loadout slot first was the detour that screen exists to remove,
                 and this is the one place in the app that gets read by someone
                 who owns nothing yet. -->
            <div class="text-f13">Open the <b class="text-foreground">Armory</b> and craft your first item.</div>
            <button
              class="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-f10 uppercase tracking-wider text-muted-foreground tac-action"
              @click="openArmory()"
            >
              <Hammer class="h-3.5 w-3.5" /> Browse the Armory
            </button>
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
              class="rounded-md border border-border px-3 py-1.5 text-f10 uppercase tracking-wider tac-action"
              @click="resetInvFilters"
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
            <DeckCard
              v-if="st.variants.length > 1"
              class="cv-tile"
              :style="{ '--i': invCellDelay(i), '--cis': cardSize + CARD_CHROME_PX + 'px' }"
              :face="st.face"
              :behind="st.behind"
              :count="st.variants.length"
              role="inv-item"
              :strip-suffix="TINT_SUFFIX"
              @open="invDesign = st.face.item?.design ?? null"
            />
            <ItemTile
              v-else
              class="cv-tile"
              :style="{ '--i': invCellDelay(i), '--cis': cardSize + CARD_CHROME_PX + 'px' }"
              :inst="st.face"
              :attached-name="attachedName(st.face)"
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
                  // Agent already eats two cells, so the row parity flips on an
                  // EVEN item count — then the last tile takes the full width
                  // instead of sitting alone next to a gap.
                  compactEquipment.length % 2 === 0 && si === compactEquipment.length - 1 && 'col-span-2',
                  selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === s.slot && 'animate-equip-pulse',
                ]"
                :style="[selRing(selected === s.slot), rowFor(s.slot)?.item?.rarity ? { borderLeft: `3px solid ${rowFor(s.slot)!.item!.rarity}` } : {}, dropStyle(s.slot)]"
                @click="selectPos(s.slot)"
                @contextmenu.prevent="openCtx(s.slot, $event)"
                @dragover="onSlotDragOver(s.slot, $event)"
                @dragleave="dragOverPos === s.slot && (dragOverPos = null)"
                @drop.prevent="onSlotDrop(s.slot)"
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
                class="group relative flex min-h-[118px] flex-col overflow-hidden rounded-lg border p-2 text-left transition-colors"
                :class="[
                  selected === cell.pos ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === cell.pos && 'animate-equip-pulse',
                ]"
                :style="[
                  selRing(selected === cell.pos),
                  rarityOf(cell.pos) ? { borderLeft: `3px solid ${rarityOf(cell.pos)}` } : {},
                  dropStyle(cell.pos),
                ]"
                @click="selectPos(cell.pos)"
                @contextmenu.prevent="openCtx(cell.pos, $event)"
                @dragover="onSlotDragOver(cell.pos, $event)"
                @dragleave="dragOverPos === cell.pos && (dragOverPos = null)"
                @drop.prevent="onSlotDrop(cell.pos)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(rarityOf(cell.pos), 0.35)"></span>
                <div class="relative z-[2] truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">
                  {{ cell.weapon?.name ?? cell.pos }}
                </div>
                <SlotStatus :teams="cellTeams(cell.pos)" :inst="cellInstance(cell.pos)" />
                <!-- These cells had NO actions at all, while the equipment cells
                     beside them in the same compact layout had the full cluster.
                     Hidden on touch by TileActions itself, so in practice this
                     only lights up on a narrow desktop window. -->
                <TileActions
                  :inst="cellInstance(cell.pos) ?? null"
                  focus
                  @focus="selectPos(cell.pos); go('/focus')"
                  @view3d="view3dForInstance(cellInstance(cell.pos)!)"
                  @inspect="openInspectLink(cellInstance(cell.pos)!.id)"
                  @edit="selectPos(cell.pos); openEdit(cellInstance(cell.pos)!)"
                  @duplicate="selectPos(cell.pos); openEdit(cellInstance(cell.pos)!)"
                  @remove="deleteOwned(cellInstance(cell.pos)!)"
                />
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
              :style="[selRing(selected === 'agent'), dropStyle('agent')]"
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
                  // Odd count in a two-column grid: the last tile takes the whole
                  // row rather than leaving a half-width orphan beside a gap.
                  EXTRAS.length % 2 === 1 && si === EXTRAS.length - 1 && 'col-span-2',
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
                  </div>
                  <!-- The same cluster every other slot and tile carries. This
                       used to be five hand-rolled spans that had drifted: no
                       read-only branch (a Steam item offered Edit), no model
                       check (3D on things with no model), and no touch hide. -->
                  <TileActions
                    :inst="cellInstance(cell.pos) ?? null"
                    focus
                    @focus="selectPos(cell.pos); go('/focus')"
                    @view3d="view3dForInstance(cellInstance(cell.pos)!)"
                    @inspect="openInspectLink(cellInstance(cell.pos)!.id)"
                    @edit="selectPos(cell.pos); openEdit(cellInstance(cell.pos)!)"
                    @duplicate="selectPos(cell.pos); openEdit(cellInstance(cell.pos)!)"
                    @remove="deleteOwned(cellInstance(cell.pos)!)"
                  />
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
                <PillTabs
                  v-if="focus3dAvailable"
                  :items="STAGE_TABS"
                  :item-key="(s) => s"
                  :active="focus3d ? '3D' : '2D'"
                  list-class="h-8"
                  button-class="relative z-[1] flex h-full items-center gap-1.5 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
                  @select="(s) => setFocus3d(s === '3D')"
                >
                  <template #default="{ item: s }">
                    <component :is="s === '3D' ? Box : ImageIcon" class="h-3.5 w-3.5" /> {{ s }}
                  </template>
                </PillTabs>
                <!-- Edit + Inspect + Share live top right, same corner as every
                     other surface (3D overlay, craft modal, item detail).
                     Edit leads: focus is where you land on a slot, and until now
                     the only way into the editor from here was the context menu
                     or a trip back to the grid. -->
                <button
                  v-if="isSkinned(focusRow) && canEdit && focusInstance && isCustomizable(focusRow?.item)"
                  :class="[FOCUS_STAGE, 'tac-action border-border text-muted-foreground']"
                  title="Edit this item — wear, pattern, stickers, charm"
                  @click="openEdit(focusInstance)"
                >
                  <Pencil class="h-3.5 w-3.5" /> Edit
                </button>
                <!-- Same rule as the item modal: a stage showing a weapon
                     offers to open it in game. Deliberately none of the three
                     gates the Edit button above needs — `canEdit` (inspecting
                     is not editing, and a loadout you are VISITING is exactly
                     the one you most want to see in game), `isSkinned` (a
                     default weapon inspects fine — it's paintindex 0) and
                     `focusInstance` (a cell with no instance behind it is
                     precisely those two cases; inspectLoadoutRow sends the row
                     as a draft instead). -->
                <button
                  v-if="canInspect(focusRow?.item)"
                  :class="[FOCUS_STAGE, 'tac-action border-border text-muted-foreground']"
                  title="Launch CS2 and inspect this item in-game"
                  @click="inspectLoadoutRow(focusRow)"
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
              <div v-if="focus3d && focusViewer.busy.value" class="absolute inset-0 z-[3] grid place-items-center">
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
                v-if="focus3d && !focusViewer.busy.value"
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
          <!-- Text only. These are three tabs in one pill with the sliding
               indicator already saying which is active; glyphs were spending
               ~60px of the row on decoration, and that was the difference
               between the search box fitting and wrapping. -->
          <PillTabs
            :items="sheetModeTabs"
            :item-key="(t) => t.key"
            :active="sheetMode"
            list-class="flex-none"
            @select="(m) => (sheetMode = m as 'owned' | 'craft' | 'replace')"
          >
            <template #default="{ item: t }">
              {{ t.label }}
              <!-- Counts the origin-filtered pool (a persistent setting) but not
                   search/rarity, so the badge doesn't twitch as you type. -->
              <span
                v-if="t.key === 'owned'"
                class="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-border bg-background/70 px-1 font-mono text-f9 leading-none"
              >{{ inventory.filter((i) => i.slot === sheetKey && matchesOrigin(i, sheetOrigin)).length }}</span>
            </template>
          </PillTabs>
          <!-- Catalog facets. Craft only — Owned and Replace list inventory
               instances and weapons, which carry none of this — and each one
               hides itself when the loaded catalog has nothing to split, so
               only graffiti shows them today and no weapon sheet changed.
               Same sliding-pill tabs as every other tab group here. -->
          <PillTabs
            v-if="sheetMode === 'craft' && sheetGroupTabs.length && (!isCompact || sheetFiltersOpen)"
            :items="sheetGroupTabs"
            :item-key="(g) => g.value"
            :active="sheetGroup"
            list-class="h-8 flex-none"
            @select="setSheetGroup"
          >
            <template #default="{ item: g }">
              {{ g.label }}
              <!-- Fixed width + tabular figures — see the picker's tab strip: a
                   self-sizing count resizes the tab and drags the sliding pill on
                   every keystroke. -->
              <span class="ml-1.5 inline-flex h-[15px] w-[34px] flex-none items-center justify-center rounded border border-border bg-background/70 px-1 font-mono text-f9 leading-none tabular-nums">{{ fmtCount(g.count) }}</span>
            </template>
          </PillTabs>
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
            <SortDirection v-model="sheetDir" :kind="sheetSortKind" :hint="sheetSortHint" />
          </template>
          <!-- Owned only: same Synced/Crafted filter as the Inventory grid, so
               read-only Steam imports can be kept out of the equip picker. -->
          <PillTabs
            v-if="sheetMode === 'owned' && (!isCompact || sheetFiltersOpen)"
            :items="ORIGIN_FILTERS"
            :item-key="(f) => f[0]"
            :active="sheetOrigin"
            list-class="flex-none"
            button-class="relative z-[1] flex h-6 items-center rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors"
            @select="(v) => (sheetOrigin = v as OriginFilter)"
          >
            <template #default="{ item: f }">{{ f[1] }}</template>
          </PillTabs>
          <!-- No weapon name here: the cards below all show it, and at ~220px of
               label it was the one element that pushed the search input onto a
               second row whenever a longer name was selected. -->
          <div v-if="!isCompact" class="ml-auto flex flex-none items-center gap-2 text-muted-foreground" title="Card size">
            <LayoutGrid class="h-3.5 w-3.5" />
            <input v-model.number="sheetCardSize" type="range" :min="SHEET_CARD_BOUNDS[0]" :max="SHEET_CARD_BOUNDS[1]" step="4" class="w-24 accent-[#e0a24a]" />
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
            class="grid h-8 w-8 flex-none place-items-center rounded-md border border-border text-muted-foreground tac-action"
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
        <FilterSheet
          :open="sheetFiltersOpen"
          :active-count="sheetFilterCount"
          @close="sheetFiltersOpen = false"
          @reset="resetSheetFilters"
        >
          <template #title>Filter · {{ sheetWeaponName }}</template>
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
                    <component :is="SORT_DIR_ICON[sheetSortKind][sheetDir]" class="h-3.5 w-3.5" />
                    {{ sheetSortHint }}
                  </button>
                </div>
              </section>

              <section class="flex flex-col gap-2">
                <div class="text-f9 uppercase tracking-cs3 text-muted-foreground/60">Card size</div>
                <div class="flex items-center gap-3 text-muted-foreground">
                  <LayoutGrid class="h-4 w-4 flex-none" />
                  <input v-model.number="sheetCardSize" type="range" :min="SHEET_CARD_BOUNDS[0]" :max="SHEET_CARD_BOUNDS[1]" step="4" class="w-full accent-[#e0a24a]" />
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
        </FilterSheet>

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
              <DeckCard
                v-if="st.variants.length > 1"
                :class="sheetCellClass(idx)"
                :style="{ '--i': idx + 2 }"
                :face="st.face"
                :behind="st.behind"
                :count="st.variants.length"
                role="skin"
                :strip-suffix="TINT_SUFFIX"
                @open="sheetDesign = st.face.item?.design ?? null"
              />
              <ItemTile
                v-else
                :inst="st.face"
                :class="sheetCellClass(idx)"
                :style="{ '--i': idx + 2 }"
                draggable="true"
                @dragstart="onTileDragStart(st.face, $event)"
                @dragend="onTileDragEnd"
                strip-weapon-name
                :attached-name="attachedName(st.face)"
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
                <DeckFan :colors="st.behind" />
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
      class="fixed inset-0 flex items-center justify-center bg-background/85 backdrop-blur-sm" :style="{ zIndex: Z.modal }"
      role="dialog" aria-modal="true" aria-label="Item editor"
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
            <!-- UNCONDITIONAL, bar the one thing that makes a link impossible.
                 This modal IS the item — 2D or 3D, view or edit — so it always
                 offers to open it in game. Every previous gate here was a
                 different reason the button vanished on a screen showing a
                 perfectly inspectable gun: `signedIn` (now a message from
                 sendInspect, not an absence), `isCoarse` (a phone can't launch
                 CS2, but it can be a Steam Deck or a touchscreen desktop, and
                 hiding it on every touch device to spare the minority the
                 no-op was the wrong trade), and asking only the current mode's
                 copy of the item for its defindex.

                 View and edit are the SAME item, so either source answering
                 "this has a defindex" is enough. -->
            <button
              v-if="canInspect(craft.skin) || canInspect(craftInst?.item)"
              class="flex flex-none items-center justify-center gap-1.5 rounded-md border border-border uppercase tracking-wider text-muted-foreground tac-action"
              :class="isCompact ? 'h-10 w-10' : 'px-2.5 py-1 text-f10'"
              :title="viewOnly ? 'Launch CS2 and inspect this item in-game' : 'Launch CS2 and inspect exactly what\'s in the editor right now — saving not required'"
              @click="viewOnly && craftInstId != null ? openInspectLink(craftInstId) : openCraftInspect()"
            >
              <!-- Icon-only on compact: the header already carries share, edit,
                   delete and close at 40px each, and the label is what pushed
                   that row past a phone's width. -->
              <ExternalLink :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3 w-3'" />
              <template v-if="!isCompact">{{ linkOpening ? 'Opening…' : 'Inspect in game' }}</template>
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
              class="grid place-items-center rounded-md border border-border text-muted-foreground tac-action"
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
              class="flex items-center gap-1.5 rounded-md border border-border text-muted-foreground tac-action"
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
              <div v-if="modal3d && modalViewer.busy.value" class="absolute inset-0 z-[3] grid place-items-center">
                <div class="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
                  <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
                </div>
              </div>
              <!-- Agent poses. An agent's patch positions sit on the chest,
                   sides and sleeves, and no single pose shows all of them — the
                   arms cover the sides in any stance a person actually stands
                   in. So the pose is the user's to pick rather than something
                   to compromise on. Agents only: nothing else has a skeleton to
                   re-pose. -->
              <!-- Developer cog, INSIDE the pane. It was `position: fixed` in
                   the app root and never rendered: this plugin is federated into
                   the 5stack panel, and `fixed` resolves against the nearest
                   transformed ancestor rather than the viewport. The pane is
                   already an absolute context that demonstrably works — the
                   2D/3D pill lives in it — and the switches belong next to the
                   model they change anyway.

                   Beside the 2D/3D pill: it is a view control like the others,
                   and that spot came free when the pose tabs moved to their own
                   row. The panel drops below both rows (top-20) so it never
                   covers the controls that opened it. -->
              <template v-if="modal3d">
                <!-- Click-away catcher, the same idiom FilterDropdown and
                     ShareMenu use. `absolute inset-0`, not `fixed`: a fixed
                     element in this plugin resolves against the nearest
                     TRANSFORMED ancestor rather than the viewport, and the host
                     panel has several — see the note on DevHud itself. The stage
                     is the right scope anyway.

                     It sits UNDER the cog so the cog stays live and the button
                     toggles the panel shut, and OVER the 2D/3D and pose pills so
                     the first click anywhere else just dismisses. -->
                <div v-if="devHudOpen" class="absolute inset-0 z-[4]" @click="devHudOpen = false"></div>
                <!-- Wrapped in the same `bg-muted p-1` shell the 2D/3D pill
                     uses, so the two sit on one baseline at one height. A bare
                     button here was 2px shorter and read as misaligned.
                     `relative` is on the wrapper too so the panel below can hang
                     off the BUTTON rather than off the stage corner. -->
                <div class="absolute left-[5rem] top-0 z-[5] inline-flex items-center rounded-lg bg-muted p-1">
                  <!-- OPEN gets the same amber indicator an active pill tab
                       gets, because it sits in the same `bg-muted` shell as the
                       2D/3D pill and "this one is engaged" should look the same
                       in both. Without it the cog was identical open or shut —
                       only ever its hover state — so nothing said the click had
                       landed except the panel appearing.

                       An INSET ring, not a border: this plugin ships without
                       Tailwind's preflight, so `box-sizing` is not guaranteed to
                       be border-box and a real 1px border would grow the 22×26
                       button and shift the count badge pinned to its corner.
                       `active:scale-95` is the press itself. -->
                  <button
                    class="relative grid h-[22px] w-[26px] place-items-center rounded-md transition-all active:scale-95"
                    :class="devHudOpen
                      ? 'text-foreground'
                      : devFlagCount > 0 ? 'text-[#f2c14e]' : 'text-muted-foreground hover:text-foreground'"
                    :style="devHudOpen
                      ? {
                          background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
                          boxShadow: 'inset 0 0 0 1px hsl(var(--tac-amber, 33 94% 58%) / 0.45), 0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
                        }
                      : {}"
                    :title="`Developer options (Ctrl/Cmd + Shift + D)${devFlagCount ? ` — ${devFlagCount} flag(s) on` : ''}`"
                    :aria-expanded="devHudOpen"
                    @click="devHudOpen = !devHudOpen"
                  >
                    <Settings class="h-3.5 w-3.5" />
                    <span
                      v-if="devFlagCount"
                      class="absolute -right-0.5 -top-0.5 grid h-3 w-3 place-items-center rounded-full bg-[#e0a92e] font-mono text-[8px] text-background"
                    >{{ devFlagCount }}</span>
                  </button>
                  <!-- Anchored to the cog (`top-full`) and scaling out of its own
                       top-left corner, so it reads as belonging to the button
                       that opened it. It used to be parked at `left-0 top-20` —
                       a slab in the stage's corner that sat over the model
                       whether or not you had just asked for it. -->
                  <DevHud
                    :open="devHudOpen"
                    class="absolute left-0 top-full z-[6] mt-1.5 origin-top-left animate-menu-in"
                    @close="devHudOpen = false"
                  />
                </div>
              </template>
              <!-- BELOW the 2D/3D toggle, not beside it: they are different
                   questions (which renderer vs which pose), and stacking keeps
                   the top edge free for the model. Not the bottom-left corner
                   either — that is where the perf HUD draws, and the two
                   overlapped. top-10 clears the 2D/3D pill's own height. -->
              <PillTabs
                v-if="modal3d && craftTarget?.kind === 'agent'"
                :items="AGENT_POSES"
                :item-key="(p) => p.id"
                :item-title="(p) => p.hint"
                :active="agentPose"
                position="absolute"
                list-class="left-0 top-10 z-[3]"
                button-class="relative z-[1] rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
                @select="(id) => setAgentPose(id as 'stand' | 'open' | 'ready')"
              >
                <template #default="{ item: p }">{{ p.label }}</template>
              </PillTabs>
              <span v-if="craftPreviewBusy && !modal3d" class="animate-sheen pointer-events-none absolute inset-0 z-[3]"></span>
              <span
                v-if="craftPreviewBusy && !modal3d"
                class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
              ><Loader2 class="h-3 w-3 animate-spin" /> rendering</span>
              <!-- 2D / 3D toggle: same sliding-pill animated tabs as the rest -->
              <PillTabs
                v-if="modal3dAvailable"
                :items="STAGE_TABS"
                :item-key="(s) => s"
                :active="modal3d ? '3D' : '2D'"
                position="absolute"
                list-class="left-0 top-0 z-[3]"
                button-class="relative z-[1] rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
                @select="(s) => (modal3d = s === '3D')"
              />
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
              v-if="craftHasNameTag"
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
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${patchSlotCount}, minmax(0, 1fr))` }">
                <button
                  v-for="(pt, idx) in craft.patches.slice(0, patchSlotCount)"
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
                    @click.stop="openPreview3d(pt, 'patch', { slot: idx })"
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
                    @click.stop="openPreview3d(st, 'sticker', { slot: idx })"
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
                <!-- ±180, the range the GAME stores. It read 0..360 before, which
                     is the same set of angles and the wrong half of them: the
                     backend folds anything past 180 to its negative equivalent,
                     so a typed 286.5 came straight back as -73.5. -->
                <label class="flex items-center gap-1 font-mono text-f8 text-muted-foreground">ROT
                  <input v-if="st" v-model.number="st.r" type="number" step="0.5" min="-180" max="180" placeholder="0"
                    class="h-6 w-14 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]" />
                </label>
              </div>
            </div>
            <div v-if="attachTakesCharm" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 2 }">
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
                    @click.stop="openPreview3d(craft!.charm, 'charm', { slot: 0 })"
                  ><Box class="h-3 w-3" /></span>
                </button>
                <span v-if="craft.charm" class="truncate text-f10 text-muted-foreground">{{ craft.charm.name }}</span>
              </div>
              <!-- A charm carries its own pattern, exactly as the weapon does,
                   and it is a tradeable attribute rather than a placement
                   detail — so it sits with the charm itself and NOT behind
                   Advanced with the x/y/z nudges.
                   The number FIELD that used to be here is gone: a charm's
                   pattern is a colour, and picking a colour by typing
                   coordinates at it is the problem the rail solves. The rail
                   owns the readout and it is still click-to-edit, so a pattern
                   quoted from a trade site is no harder to enter than before. -->
              <PatternRail
                v-if="craft.charm"
                class="mt-2"
                :model-value="craft.charm.seed ?? 0"
                :image="craft.charm.image"
                :albedo="charmAlbedo"
                :loading="charmRailLoading"
                @update:model-value="craft!.charm!.seed = $event"
              />
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
            <!-- A CHARM's pattern gets the rail, wherever the charm is.
                 It was only wired up for a charm hanging off a weapon, so
                 opening one on its own fell through to the weapon control
                 below — a 1..1000 slider for an attribute that runs to 100,000,
                 scrubbing a continuum for something that is really a colour.
                 Same component, same reasoning as the attached case: you aim at
                 a pattern, you don't scrub to it. -->
            <!-- The panel goes with the rail when the charm has no pattern to
                 pick. Hiding the control alone would leave an empty card. -->
            <div
              v-if="craftHasSeed && craftSeedIsCharm && !craftCharmInert"
              class="animate-sheet-in rounded-md bg-secondary/40 p-2.5"
              :style="{ '--i': 3 }"
            >
              <PatternRail
                :model-value="craft.seed ?? 0"
                :image="craft.skin.image"
                :albedo="charmAlbedo"
                :loading="charmRailLoading"
                @update:model-value="craft!.seed = $event"
                @update:inert="craftCharmInert = $event"
              />
            </div>
            <!-- The scored rail, which is the charm rail's twin: same drag,
                 same needle, same click-to-edit readout — but plotting a
                 MEASUREMENT of every pattern, because a weapon's pattern
                 moves artwork rather than being a colour we can compute.
                 It is only usable at all because the viewer re-composites in
                 place now: the seed feeds six uniforms, so dragging re-runs
                 two fullscreen passes over textures already on the GPU.

                 Shown only on a finish whose pattern can actually move the
                 artwork — `=== true`, not `!== false`, so a finish still being
                 resolved never appears and then vanishes. A fixed-pattern
                 finish used to get the field back with a line explaining that
                 it did nothing; the row is simply gone now.

                 The tradeoff, stated: on those finishes the pattern can no
                 longer be typed. It remains a real tradeable attribute and it
                 still round-trips through save and share — there is just no
                 longer a control for a number with nothing to show for it. -->
            <div v-else-if="craftHasSeed && patternMoves === true" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
              <PatternScoreRail
                :model-value="craft.seed"
                :paint-material="craft.skin.paintMaterial"
                :model="craftTarget?.model ?? craftModel"
                :legacy-paint="!!craft.skin.legacyPaint"
                :weights-for="modal3d ? paintWeightsNow : null"
                @update:model-value="craft!.seed = $event"
                @preview="previewPattern"
              />
            </div>
            <div v-if="craftHasWear" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
              <div class="flex items-center gap-2">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <input
                  v-model.number="craft.wear"
                  type="number" :min="craftWearRange.min" :max="craftWearRange.max" step="0.0001"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
                />
                <button class="grid h-9 w-9 flex-none place-items-center rounded-md border border-input text-f13 text-muted-foreground tac-action" title="Random wear" @click="randomWear">🎲</button>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="craft.wear" type="range" :min="craftWearRange.min" :max="craftWearRange.max" step="0.0001" class="wear-range w-full" />
              </div>
              <div class="mt-1 flex items-center justify-between font-mono text-f9 text-muted-foreground">
                <!-- Only worth saying when it ISN'T the full range, which is
                     most finishes — otherwise it reads as noise on the few that
                     genuinely go 0.00–1.00. -->
                <span v-if="craftWearRange.min > 0 || craftWearRange.max < 1">
                  {{ craftWearRange.min.toFixed(2) }}–{{ craftWearRange.max.toFixed(2) }} only
                </span>
                <span v-else></span>
                <span>{{ wearTier(craft.wear) }}</span>
              </div>
            </div>
            <!-- A sticker's scratch. Same box and rhythm as the weapon's Wear
                 above but NO tier caption: "Factory New" is a float's vocabulary
                 and a sticker doesn't have one — it's just how scuffed it is.
                 Mutually exclusive with that box in practice (nothing has both a
                 float and a scratch), so they can share the slot. -->
            <div v-if="craftHasScratch" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
              <div class="flex items-center gap-2">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <input
                  v-model.number="craft.wear"
                  type="number" min="0" max="1" step="0.01"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-f13 outline-none transition-colors focus:border-[color:var(--acc)]"
                />
                <button class="grid h-9 w-9 flex-none place-items-center rounded-md border border-input text-f13 text-muted-foreground tac-action" title="Random wear" @click="randomWear">🎲</button>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="craft.wear" type="range" min="0" max="1" step="0.0001" class="wear-range w-full" />
              </div>
              <div class="mt-1 text-right font-mono text-f9 text-muted-foreground">{{ (craft.wear ?? 0).toFixed(2) }} scratched</div>
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
              <!-- Type-gated, not just null-gated. A sticker spends the same
                   `wear` column on its SCRATCH, so the moment one could be set
                   this box started captioning a sticker "Factory New" over an
                   empty track (WearBar drops the ramp itself, the tier caption
                   was left saying it anyway). The scratch gets its own box
                   below, with a number instead of a tier. -->
              <div v-if="craftInst?.wear != null && hasWear(craftInst.item)" class="animate-sheet-in rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
                <div class="flex items-baseline gap-2">
                  <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                  <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ wearTier(craftInst.wear) }}</span>
                </div>
                <div class="mt-2"><WearBar :item="craftInst.item" :wear="craftInst.wear" /></div>
              </div>
              <div v-if="craftInst?.wear != null && hasScratch(craftInst.item)" class="animate-sheet-in flex items-baseline gap-2 rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 3 }">
                <span class="w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground">Wear</span>
                <span class="font-mono text-f13">{{ craftInst.wear.toFixed(2) }}</span>
                <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">scratched</span>
              </div>
              <div v-if="craftInst?.stattrak" class="animate-sheet-in flex items-center justify-between rounded-md bg-secondary/40 p-2.5" :style="{ '--i': 4 }">
                <span class="text-f10 uppercase tracking-cs1 text-[#f2c14e]">StatTrak™</span>
              </div>
            </template>

          </div>
        </div>

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
            class="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-f11 font-semibold uppercase tracking-wider text-muted-foreground tac-action"
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
            class="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-f11 font-semibold uppercase tracking-wider text-muted-foreground tac-action disabled:cursor-not-allowed disabled:opacity-40"
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
      class="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-f13 shadow-2xl" :style="{ zIndex: Z.toast }"
    >
      <Trash2 class="h-3.5 w-3.5 flex-none text-muted-foreground" />
      <span class="max-w-[380px] truncate">{{ pendingDeleteLabel }}</span>
      <button
        class="flex-none rounded-sm px-2 py-1 text-f11 font-bold uppercase tracking-cs1 text-[hsl(var(--tac-amber,33_94%_58%))] transition-colors hover:bg-muted"
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
    <ContextMenu :at="ctx" @close="closeCtx">
      <template #title>{{ ctx ? (occupantWeapon(ctx.pos)?.name ?? ctx.pos) : '' }}</template>
        <!-- 3D leads, same as the item menu: looking at the gun is the most
             common reason this menu gets opened, and it's the one row that
             never depends on what's already in the slot. -->
        <button
          v-if="ctx3dOk"
          :class="MENU_ROW"
          @click="ctxView3d"
        >
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <button :class="[MENU_ROW, 'border-t border-border']" @click="ctxOwned">
          <Search class="h-3.5 w-3.5" /> Pick / change skin
        </button>
        <button :class="MENU_ROW" @click="ctxCraft">
          <Hammer class="h-3.5 w-3.5" /> Craft new skin
        </button>
        <button
          v-if="ctx && isWeaponPos(ctx.pos)"
          :class="MENU_ROW"
          @click="ctxReplace"
        >
          <Replace class="h-3.5 w-3.5" /> Replace weapon…
        </button>
        <!-- The touch path's ONLY way to this action: the tile clusters are
             hover chrome and stay desktop-only, so hiding it here too left a
             phone with no inspect at all. Asks the ROW, not the instance — a
             default weapon in the slot is still a gun you can look at. -->
        <button
          v-if="ctx && canInspect(rowFor(ctx.pos)?.item)"
          :class="MENU_ROW"
          @click="ctxInspect"
        >
          <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
        </button>
        <button
          v-if="ctx && !['agent', 'graffiti', 'musickit', 'collectible'].includes(ctx.pos)"
          :class="[MENU_ROW, 'disabled:opacity-40 disabled:hover:bg-transparent']"
          :disabled="!equippedInstance(ctx.pos)"
          @click="ctxStatTrak"
        >
          <Sparkles class="h-3.5 w-3.5" /> Toggle StatTrak™
        </button>
        <button
          v-if="ctx && !isShared(ctx.pos) && ctx.pos !== 'agent'"
          :class="[MENU_ROW, 'disabled:opacity-40 disabled:hover:bg-transparent']"
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
    </ContextMenu>



    <!-- 3D overlay for a DEFAULT weapon off the loadout grid. An owned item goes
         to /items/<id>/3d instead, which opens the craft modal in view mode —
         so there's no spec strip and no Edit/Inspect/Share here: a default
         weapon is a model, not an item anyone owns. -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
      <!-- Edge to edge on compact, same reasoning as the craft modal above. -->
      <div
        v-if="loadout3d"
        class="fixed inset-0 flex items-center justify-center bg-background" :style="{ zIndex: Z.stage }"
        role="dialog" aria-modal="true" aria-label="3D view"
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
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span class="truncate text-f11 uppercase tracking-cs3 text-muted-foreground">{{ loadout3d.name }}</span>
            <div class="flex flex-none items-center gap-2">
              <!-- Same corner, same rule as every other stage. A default weapon
                   has no owned row, so this is the bare-item link — see
                   openItemInspect. -->
              <button
                v-if="loadout3d.id != null"
                class="flex items-center justify-center gap-1.5 rounded-md border border-border uppercase tracking-wider text-muted-foreground tac-action"
                :class="isCompact ? 'h-10 w-10' : 'px-2.5 py-1 text-f10'"
                title="Launch CS2 and inspect this weapon in-game"
                @click="openItemInspect(loadout3d.id)"
              >
                <ExternalLink :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3 w-3'" />
                <template v-if="!isCompact">{{ linkOpening ? 'Opening…' : 'Inspect in game' }}</template>
              </button>
              <button class="flex-none rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Close" aria-label="Close" @click="dismissLoadout3d">
                <X class="h-4 w-4" />
              </button>
            </div>
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
            <div v-if="loadout3dViewer.busy.value" class="absolute inset-0 grid place-items-center bg-card">
              <div class="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
                <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Sticker / charm picker -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
    <!-- fixed + above the 3D overlay (z-1200): the picker is reachable from
         both the form and the 3D editor, and must cover whichever is up. -->
    <div v-if="picker" class="fixed inset-0 flex flex-col bg-card/[0.985] p-4" :style="{ zIndex: Z.picker }" role="dialog" aria-modal="true" aria-label="Pick an attachment">
      <div class="mb-3 flex items-center gap-3">
        <span class="text-f11 font-semibold uppercase tracking-cs1">Pick a {{ picker.kind }}</span>
        <!-- Catalog vs your own drawer. Owned counts the SPARES, not the
             total: the question this shelf answers is "have I got one going
             spare", and a badge counting ones already stuck to a gun would
             answer a different one. -->
        <div class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5">
          <button
            v-for="src in (['all', 'owned'] as const)"
            :key="src"
            class="flex items-center gap-1.5 rounded px-2.5 py-1 text-f10 uppercase tracking-cs1 transition-colors"
            :class="pickerSource === src ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :title="src === 'all' ? 'Browse every ' + picker.kind + ' in the game' : 'Only ' + picker.kind + 's you own'"
            @click="pickerSource = src"
          >
            {{ src === 'all' ? 'Catalog' : 'Owned' }}
            <span
              v-if="src === 'owned' && pickerOwned.length"
              class="rounded bg-background/70 px-1 font-mono text-f8"
            >{{ pickerOwned.filter((r) => !r.attachedName).length }}</span>
          </button>
        </div>
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
          class="flex flex-none items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-f10 uppercase tracking-cs1 text-muted-foreground tac-action"
          title="Back to the editor — nothing is applied"
          @click="picker = null"
        >
          <X class="h-3.5 w-3.5" /> Back
        </button>
      </div>

      <!-- Facets. THE shared bar — same component the armory uses, so a rarity
           dropdown behaves identically wherever you meet it.
           The cascade and the no-op guard stay here in setPickerFacet: they are
           this catalog's rules (a collection only exists within a group), not
           the bar's, and the bar only reports what was clicked.
           Catalog only: every facet is a slice of the CATALOG query, and the
           owned shelf is a local list of a few dozen rows that ignores all of
           them. Leaving them up would offer controls that silently do nothing. -->
      <CatalogFilters
        v-if="pickerSource === 'all'"
        class="mb-3"
        :tabs="pickerTabs.map((t) => ({ value: t.value, label: t.label ?? t.value, count: t.count }))"
        :tab="pickerGroup"
        :axes="pickerAxes"
        :axis-values="{ collection: pickerCollection, rarity: pickerRarity }"
        :sorts="ATTACH_SORTS"
        :sort="pickerSort"
        :dir="pickerDir"
        :sort-kind="pickerSortKind"
        :dir-hint="pickerSortHint"
        :default-tab="pickerDefaultGroup"
        :compact="isCompact"
        @update:tab="setPickerFacet('group', $event)"
        @update:axis="(k, v) => setPickerFacet(k as 'collection' | 'rarity', v)"
        @update:sort="setPickerSort"
        @update:dir="setPickerDir"
        @clear="clearPickerFacets"
      />

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
          v-for="(it, i) in pickerRows"
          :key="it.key"
          class="cv-tile group relative flex h-full flex-col items-center overflow-hidden rounded-md border border-border bg-background p-1.5 transition-colors hover:border-[color:var(--acc)]"
          :class="i < PICKER_PAGE ? 'animate-cell-in' : ''"
          :style="{ ...(it.rarity ? { borderBottom: `3px solid ${it.rarity}` } : {}), '--i': i, '--cis': attachCardSize + 12 + 'px' }"
          :title="it.attachedName ? it.name + ' — applied to ' + it.attachedName : it.name"
          @click="pickAttachment(it)"
        >
          <span class="pointer-events-none absolute inset-0" :style="glowStyle(it.rarity, 0.22)"></span>
          <!-- Already on something. Not disabled: picking it is legal and
               means "move it here", which the save confirms before doing —
               so this marks the cost rather than blocking the choice. -->
          <span
            v-if="it.attachedName"
            class="pointer-events-none absolute left-1 top-1 z-[3] flex items-center rounded bg-background/90 p-0.5 text-[color:var(--acc)]"
          ><Link2 class="h-3 w-3" /></span>
          <!-- Inspect before committing. A `button` inside the tile's button
               is invalid HTML, so this is a span with a click that stops
               propagation — otherwise picking is the only thing a tile can
               do, and choosing a holo sticker from a flat icon is a guess. -->
          <span
            role="button"
            tabindex="0"
            class="absolute right-1 top-1 z-[3] hidden items-center justify-center rounded border border-border bg-background/90 p-1 text-muted-foreground tac-action group-hover:flex"
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
        <div v-if="!pickerLoading && !pickerRows.length" class="col-span-full animate-fade-in py-8 text-center text-f13 text-muted-foreground">
          <template v-if="pickerSource === 'owned' && !pickerQuery">
            You don't own any {{ picker.kind }}s yet — pick one from the catalog and it's
            yours once you save.
          </template>
          <template v-else>No results — try a different search.</template>
        </div>
        <!-- Scrolling to the bottom pulls the next page. `done` also carries
             the first-page spinner: without it the sentinel is on screen
             under an empty grid and would fire a second, duplicate page.
             A deeper rootMargin than the 500px default: one page is 120 tiles,
             which at any card size is several screens, so firing further ahead
             costs one request that was coming anyway and buys the page landing
             before you reach the end — the difference between infinite scroll
             and scroll-then-wait. -->
        <!-- Catalog only. The owned shelf is already whole — it came out of
             memory, not a paged endpoint. -->
        <InfiniteSentinel
          v-if="pickerSource === 'all'"
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
        <template v-else-if="!pickerRows.length"></template>
        <!-- Owned counts spares against the total, because "3 of 11 spare"
             is the number you are actually shopping against. -->
        <template v-else-if="pickerSource === 'owned'">
          {{ pickerOwned.filter((r) => !r.attachedName).length }} spare of {{ pickerOwned.length }} owned
        </template>
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
        class="fixed inset-0 grid place-items-center bg-background/80 p-4 backdrop-blur-sm" :style="{ zIndex: Z.previewStage }"
        role="dialog" aria-modal="true" aria-label="Attachment preview"
        @click.self="closePreview3d()"
      >
        <div class="flex w-full max-w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <span class="min-w-0 flex-1 truncate text-f11 uppercase tracking-cs1">{{ preview3d.name }}</span>
            <!-- No inspect link here, unlike every other stage, and it is NOT
                 an oversight to fix by copying the button in: a standalone
                 sticker or charm carries its kit id in `index`, and the preview
                 block has nowhere to put that except the stickers/keychains
                 list — the slot it fills when it's ON a weapon. Sent as
                 `paintindex` (what inspectLinkFor does for every other item) it
                 would open CS2 on defindex 1209 with no art. Attaching it to a
                 gun and inspecting THAT works today and is the honest link. -->
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
            <div v-if="preview3dViewer.busy.value" class="pointer-events-none absolute inset-0 grid place-items-center">
              <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          </div>
          <!-- Wear (sticker) / Pattern (charm), on the panel where you are
               already looking at the thing they change. Opened from a slot
               while editing, these write STRAIGHT THROUGH to that slot —
               the same value the options column shows, so the gun behind
               this panel retextures as you drag and Save keeps it.
               From the picker, or in view mode, there is nothing to write
               to and they drive a scratch instead. Worth having anyway:
               "what does this look like scratched" is the question you
               opened the panel to answer, and answering it before you
               commit is the whole point. The chip is what says which mode
               you're in — an unlabelled slider that silently discards its
               value is the worse half of an either/or. -->
          <!-- The whole strip goes when there is nothing to set: an inert
               charm leaves the rail rendering nothing, and a bordered band of
               empty space is a worse answer than no band. -->
          <div
            v-if="preview3dHasWear || (preview3dHasSeed && !previewCharmInert)"
            class="flex gap-2 border-t border-border px-3 py-2"
            :class="preview3dHasWear ? 'items-center' : 'items-start'"
          >
            <template v-if="preview3dHasWear">
              <span class="w-9 flex-none font-mono text-f8 uppercase tracking-cs1 text-muted-foreground">Wear</span>
              <input
                :value="preview3dWear"
                type="range" min="0" max="1" step="0.01"
                class="wear-range min-w-0 flex-1"
                :title="preview3dWearBound ? preview3d!.name + ' scratch wear' : preview3d!.name + ' scratch wear (preview only — not saved)'"
                @input="preview3dWear = ($event.target as HTMLInputElement).valueAsNumber"
              />
              <span class="w-8 flex-none text-right font-mono text-f9 text-muted-foreground">{{ preview3dWear.toFixed(2) }}</span>
            </template>
            <!-- The rail belongs here more than anywhere: this panel is the
                 charm on its own, big, with nothing else to look at while you
                 drag. It carries its own label and readout, so the row's
                 Pattern caption and number field would both be duplicates. -->
            <PatternRail
              v-else
              class="min-w-0 flex-1"
              :model-value="preview3dSeed"
              :image="preview3d?.image ?? null"
              :albedo="previewAlbedo"
              :loading="preview3dViewer.busy.value"
              @update:model-value="preview3dSeed = $event"
              @update:inert="previewCharmInert = $event"
            />
          </div>
          <div
            v-if="(preview3dHasWear && !preview3dWearBound) || (preview3dHasSeed && !preview3dSeedBound)"
            class="border-t border-border px-3 py-1.5 text-center text-f8 uppercase tracking-cs1 text-muted-foreground/60"
          >Preview only — not saved</div>
        </div>
      </div>
    </Transition>

    <!-- Destructive-action confirm. Above every other overlay (modals 998,
         context menus 999, share popovers 1001) because it can be raised from
         any of them and must never open behind the thing that triggered it. -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
      <div
        v-if="confirmAsk"
        class="fixed inset-0 grid place-items-center bg-background/80 p-4 backdrop-blur-sm" :style="{ zIndex: Z.confirm }"
        role="alertdialog" aria-modal="true"
        @click.self="confirmAsk = null"
      >
        <div class="w-[min(92vw,420px)] animate-pop-in overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
          <div class="flex items-start gap-3 p-5">
            <span
              class="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-md border"
              :class="confirmAsk.tone === 'neutral' ? 'border-border bg-secondary/40' : 'border-[#e04a3a]/40 bg-[#e04a3a]/10'"
            >
              <Link2 v-if="confirmAsk.tone === 'neutral'" class="h-4 w-4 text-[color:var(--acc)]" />
              <Trash2 v-else class="h-4 w-4 text-[#ff7a6a]" />
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
              v-if="confirmAsk.tone === 'neutral'"
              class="flex items-center gap-1.5 rounded-md px-4 py-2 text-f11 font-bold uppercase tracking-wider text-black shadow-sm transition-[filter] hover:brightness-110"
              style="background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16))"
              @click="runConfirm"
            >
              <Link2 class="h-3.5 w-3.5" /> {{ confirmAsk.confirmLabel }}
            </button>
            <button
              v-else
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
    <ContextMenu :at="itemCtx" @close="closeItemCtx">
      <template #title><ItemName :item="itemCtx?.inst.item" /></template>
        <!-- 3D leads. It is the only row that always applies — every equip
             below it can be already-done and greyed out, and looking at the
             thing is what you came for anyway. -->
        <button :class="MENU_ROW" @click="itemCtxView3d">
          <Box class="h-3.5 w-3.5" /> View in 3D
        </button>
        <!-- Equip rows go DISABLED, not hidden, once the item is already on
             that team: a menu whose rows move around between openings is worse
             than one with a dead row, and "Equipped on CT" answers the question
             the row would otherwise raise. -->
        <template v-if="itemCtxTeams === 'shared'">
          <button
            :class="[MENU_ROW, 'border-t border-border', 'disabled:opacity-40 disabled:hover:bg-transparent']"
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
            :class="[MENU_ROW, 'disabled:opacity-40 disabled:hover:bg-transparent', ti === 0 && 'border-t border-border']"
            :disabled="itemCtxEquippedOn.has(t)"
            @click="ctxEquipTeams([t])"
          >
            <Crosshair class="h-3.5 w-3.5" /> {{ itemCtxEquippedOn.has(t) ? `Equipped on ${t}` : `Equip on ${t}` }}
          </button>
          <!-- Both-teams stays live while EITHER side is still open — it's the
               one-tap way to finish the pair. -->
          <button
            v-if="itemCtxTeams.length === 2"
            :class="[MENU_ROW, 'disabled:opacity-40 disabled:hover:bg-transparent']"
            :disabled="itemCtxSharedEquipped"
            @click="ctxEquipTeams(['CT', 'T'])"
          >
            <Copy class="h-3.5 w-3.5" /> {{ itemCtxSharedEquipped ? 'Equipped on both teams' : 'Equip on both teams' }}
          </button>
        </template>
        <button
          v-if="itemCtx && !['agent', 'graffiti', 'musickit', 'collectible'].includes(itemCtx.inst.slot ?? '')"
          :class="MENU_ROW"
          @click="itemCtxStatTrak"
        >
          <Sparkles class="h-3.5 w-3.5" /> {{ itemCtx.inst.stattrak ? 'Remove' : 'Add' }} StatTrak™
        </button>
        <button
          v-if="isCustomizable(itemCtx?.inst.item)"
          :class="MENU_ROW"
          @click="itemCtxEdit"
        >
          <Pencil class="h-3.5 w-3.5" /> Edit…
        </button>
        <!-- Same as the loadout menu above: this is where touch gets the action
             at all, so it can't be the desktop-only copy. -->
        <button v-if="canInspect(itemCtx?.inst.item)" :class="MENU_ROW" @click="itemCtxInspect">
          <ExternalLink class="h-3.5 w-3.5" /> {{ linkOpening ? 'Opening…' : 'Inspect in game' }}
        </button>
        <button
          :class="[MENU_ROW, 'border-t border-border text-muted-foreground hover:!text-[#ff7a6a]']"
          @click="itemCtxDelete"
        >
          <Trash2 class="h-3.5 w-3.5" /> Delete from inventory
        </button>
    </ContextMenu>
  </div>
  </div>
  </div>
</template>
