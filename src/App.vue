<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, type ComputedRef, watch } from "vue";
import { cn } from "@5stack/ui";
import { useI18n } from "./composables/useI18n";
import {
  Loader2, Search, LayoutGrid, Crosshair,
  Package, Hammer, Trash2, Copy, RotateCcw, Sparkles, Replace, RefreshCw, Pencil, Plus, X, Settings, Box, Clock, CircleDollarSign,
  Image as ImageIcon, Check, ExternalLink, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, Palette, Link2,
  Layers,
} from "lucide-vue-next";
import {
  fetchCatalog,
  fetchSkins,
  type AttachSort,
  fetchCatalogItems,
  fetchLoadout,
  fetchInventory,
  craftItem,
  updateInstance,
  deleteInstance,
  fetchInspectLink,
  fetchDraftInspectLink,
  fetchGameConfig,
  fetchExtractStatus,
  type ExtractStatus,
  fetchPlayerLoadout,
  copyLoadoutFrom,
  importSteamInventory,
  fetchSteamSync,
  fetchPriceStatus,
  fetchInventoryPrices,
  fetchStockPrices,
  fetchPriceDetail,
  approxNote,
  bestSaleWindow,
  HISTORY_WINDOW_LABEL,
  type PriceDetail,
  WEAR_TIER_NAME,
  quoteCraft,
  formatPrice,
  PRICE_WINDOW_LABEL,
  PRICE_SOURCE_LABEL,
  type PriceStatus,
  type Quote,
  API_ORIGIN,
  equip,
  swapLoadout,
  unequip,
  fetchPresets,
  fetchPlayerPresets,
  createPreset,
  renamePreset,
  deletePreset,
  activatePreset,
  type LoadoutPreset,
  type PresetPreviewItem,
  type Team,
  type CatalogWeapon,
  type DefaultsMap,
  type CatalogItem,
  type Skin,
  type SheetFacets,
  type LoadoutEntry,
  type InventoryItem,
  type AttachSource,
  type AttachSpec,
  fetchStickerGeometry,
  MAX_STICKERS,
  MAX_PATCHES,
  uploadRender,
  renderUrlFor,
  type GameConfigState,
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
import { activeFlags, flagValue, flagsVersion } from "./devFlags";
import Armory from "./components/Armory.vue";
import InventoryScreen from "./components/InventoryScreen.vue";
import LoadoutGrid from "./components/LoadoutGrid.vue";
import AttachmentPicker from "./components/AttachmentPicker.vue";
import ShareMenu from "./components/ShareMenu.vue";
import Tooltip from "./components/Tooltip.vue";
import { MDEBUG, mdebug, setMdebugAmbient, traceLayer } from "./mdebug";
import ItemArt from "./components/ItemArt.vue";
import ItemName from "./components/ItemName.vue";
import SlotStatus from "./components/SlotStatus.vue";
import WearBar from "./components/WearBar.vue";
import ItemTile from "./components/ItemTile.vue";
import MusicPlayer from "./components/MusicPlayer.vue";
import TileActions from "./components/TileActions.vue";
import FilterDropdown from "./components/FilterDropdown.vue";
import InfiniteSentinel from "./components/InfiniteSentinel.vue";
import SortDirection from "./components/SortDirection.vue";
import PatternRail from "./components/PatternRail.vue";
import PriceTag from "./components/PriceTag.vue";
import ItemSpecs from "./components/ItemSpecs.vue";
import ItemBadges from "./components/ItemBadges.vue";
import PatternScoreRail from "./components/PatternScoreRail.vue";
import { SCAN_READ_SIZE } from "./patternScan";
import { useRenderWindow, WINDOW_FIRST } from "./composables/useRenderWindow";
import ViewerControls from "./components/ViewerControls.vue";
import ItemStage from "./components/ItemStage.vue";
import ItemIdentity from "./components/ItemIdentity.vue";
import ItemScreen from "./components/ItemScreen.vue";
import CraftActions from "./components/CraftActions.vue";
import ViewerSettingsButton from "./components/ViewerSettingsButton.vue";
import StageTabs from "./components/StageTabs.vue";
import PillTabs from "./components/PillTabs.vue";
import DeckCard from "./components/DeckCard.vue";
import DeckFan from "./components/DeckFan.vue";
import ContextMenu, { MENU_ROW } from "./components/ContextMenu.vue";
import PresetDeck from "./components/PresetDeck.vue";
import FilterSheet from "./components/FilterSheet.vue";
import { Z } from "./zLayers";
import { SORT_DIR_ICON, type SortDir } from "./sortIcons";
import {
  SORTS, SORTS_WITHOUT_VALUE, DEFAULT_SORT, SORT_NATURAL, SORT_DIR_HINT, SORT_DIR_KIND, needsOwnedItem, type SortMode,
  byName, sortRarityRank,
} from "./sortModes";
import {
  DEFAULT_WEAR, POSITION_GROUPS, START_PISTOLS, isWeaponPos, isSpecial, isShared, isNo3d,
  type OriginFilter, ORIGIN_FILTERS, ORIGIN_VALUES, WEAPON_GROUPS, GEAR_TYPES,
  matchesOrigin, catsForPos, DEFAULTS, RAIL, EXTRAS, ALL_SPECIALS, sortPreview,
} from "./loadoutModel";
import { useSortControl } from "./composables/useSortControl";
import { SWIPE_ARM_PX } from "./composables/useSwipeDismiss";
import { useSlotLongPress } from "./composables/useSlotLongPress";
import { useAppHeight } from "./composables/useAppHeight";
import { useBuildCheck } from "./composables/useBuildCheck";
import { useViewerMount } from "./composables/useViewerMount";
import type { ClipAction } from "./viewmodelClip";
import { useViewerStage, type StageIcon, type StageKey } from "./composables/useViewerStage";
import { useDebouncedSearch } from "./composables/useDebouncedSearch";
import { useInventoryView } from "./composables/useInventoryView";
import { useAttachmentPicker, type PickerRow } from "./composables/useAttachmentPicker";
import { usePersistedBool, usePersistedEnum, usePersistedNumber } from "./composables/usePersistedRef";
import { accentSoft, ART_FADE_B, attachmentsOf, canInspect, CARD_ART, CARD_CHROME_PX, glowStyle, hasScratch, hasSeed, hasWear, isCustomizable, isReadOnly, itemName, RARITY_META, rarityName, rarityRank, selRing, STEAM_BLUE, stripName, wearTier, wearPositionInTier } from "./itemVisuals";
import { stackByDesign, TINT_SUFFIX } from "./decks";
import { loadPaintDef, seedMovesPattern } from "./paintComposite";
import { isCompact, isCoarse, reducedMotion } from "./responsive";
import { revealInScroller, scrollFade, scrollPanelToTop } from "./dom";
import { hasModel, hasModelSync, mountViewer, snapshotModel, viewersIdle, viewerStats, INCOMPLETE, type CameraState, type ViewerHandle, type ViewerKind, type StickerPlacement, type CharmPlacement } from "./viewer3d";
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
// One class string for the item modal's secondary actions so the row can't
// drift into three slightly different heights and two text sizes again.
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
/**
 * The track this slot would play — the equipped kit, else the stock one.
 *
 * Same fallback order as specialImage, and for the same reason: the kit slot has
 * always drawn the default's ART, so leaving the sound out made it a picture of
 * a record with no player. Everyone is issued the stock kit and most never
 * change it, which is exactly the case that read as an empty slot.
 *
 * Null on any other slot and on an instance without the audio extracted — every
 * surface gates the transport on the URL rather than offering a button that
 * 404s, so nothing else has to know which slots make sound.
 */
function specialAudio(slot: string): string | null {
  return rowFor(slot)?.item?.audio ?? specialDefault(slot)?.audio ?? null;
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
/**
 * The extras tiles' tooltip — 70px of tile has room for the slot's name and
 * nothing else, so the occupant's identity lives here.
 *
 * It used to name the occupant only when something was equipped, which left the
 * stock items anonymous: those tiles draw the DEFAULT's artwork, so an untouched
 * kit slot was a picture of an item the screen refused to name. Falls through to
 * the bare slot name for graffiti and pins, where no default exists at all —
 * "Graffiti · Default" is noise, not an answer.
 */
function slotTitle(slot: string, name: string): string {
  const item = rowFor(slot)?.item ?? specialDefault(slot);
  return item ? `${name} · ${itemName(item)}` : name;
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
/** What's in this slot, in money — the skin plus every sticker, patch and charm
 *  on it (the server's per-slot `value`). Null when prices are off or the slot
 *  holds a free default, which is most of them and correctly worth nothing. */
/** One slot's figure out of a TEAM:slot map — the live loadout's, or a parked
 *  preset's. Same lookup for both so a build prices the same wherever it sits. */
function slotValueIn(values: Record<string, number>, pos: string, forTeam: Team): number | null {
  // Shared slots (knife, gloves) can be stored under either side, same rule as
  // rowFor — otherwise a knife equipped from the T side prices as nothing on CT.
  const value = isShared(pos) ? values[`CT:${pos}`] ?? values[`T:${pos}`] : values[`${forTeam}:${pos}`];
  return value && value > 0 ? value : null;
}
function valueForSlot(pos: string, forTeam: Team): number | null {
  if (!pricesOn.value) return null;
  return slotValueIn(slotValues.value, pos, forTeam);
}
/** What one side of a build is worth — guns plus everything on them. */
function sideValueIn(values: Record<string, number>, forTeam: Team): number {
  let total = 0;
  // Through slotValueIn, not the raw keys. A shared slot (knife, gloves, zeus,
  // C4, music kit, graffiti, collectible) is stored under whichever side
  // equipped it and the lookup falls back CT→T to find it — so summing the raw
  // map credited it to one side only, and the header total came out lower than
  // the cells drawn underneath it. Flipping sides then changed the total for a
  // loadout that had not changed.
  for (const group of POSITION_GROUPS) {
    for (const pos of group.positions) total += slotValueIn(values, pos, forTeam) ?? 0;
  }
  for (const special of ALL_SPECIALS) total += slotValueIn(values, special.slot, forTeam) ?? 0;
  return total;
}
/** The showing side's figure — what a cell draws. */
const cellValue = (pos: string) => valueForSlot(pos, team.value);

/**
 * Everything a loadout cell needs to DRAW, for one slot.
 *
 * One builder because there is now one cell (LoadoutCell.vue) where there were
 * six copies. The per-family differences that used to justify the copies are all
 * here, in one readable branch: weapon slots strip the model from the finish
 * name and fall back to the default gun's art, gear slots keep the full name and
 * fall back to the stock item.
 *
 * `displayPos` is what to SHOW; `pos` is what the cell IS. They differ only
 * during a reorder hover, where two cells render each other's contents so the
 * drop confirms what you see — see previewPos().
 */
function cellFacts(pos: string, displayPos: string = pos) {
  const weaponSlot = isWeaponPos(pos);
  const row = rowFor(displayPos);
  const inst = cellInstance(displayPos) ?? null;
  // Weapon cells only show a float for a CRAFTED occupant; a default gun has
  // none. Gear reads its row directly, which is null for a stock knife anyway.
  const wearRow = weaponSlot ? cellWear(displayPos) : row ?? null;
  // Once. This ran three times per cell — value, tip, missing — each re-walking
  // the shared-slot branch, for every cell of a 15-slot loadout on every tick.
  const value = cellValue(displayPos);
  return {
    item: weaponSlot ? cellItem(displayPos) : row?.item ?? null,
    inst,
    // The badge row reads the instance when there is one and the ROW when there
    // isn't, which is the only case a visitor ever has: the public endpoint
    // withholds the owner's row handle and sends the enriched stickers, patches
    // and charm on the loadout row itself. Without the fallback, someone else's
    // loadout drew every cell as an unmarked gun. Your own is untouched — its
    // rows carry no attachments (nothing needs them; the instance is right
    // there), so `inst` still answers for every cell you can edit.
    badges: inst ?? row ?? null,
    image: (weaponSlot ? cellImage(displayPos) : specialImage(displayPos)) ?? null,
    // Music kits, and nothing else — the only slot whose occupant is a sound
    // rather than a thing to look at. Weapon cells never carry one, so the
    // branch is here rather than a null check thirteen cells deep.
    audio: weaponSlot ? null : specialAudio(displayPos),
    fallback: weaponSlot ? "Default" : specialFallback(pos),
    strip: weaponSlot,
    teams: cellTeams(displayPos),
    value,
    valueTip: inst && value == null ? noPriceTip.value : slotValueTip.value,
    // A free default has no listing to be missing; only an OWNED occupant that
    // the mirror couldn't price gets the dash.
    valueMissing: pricesOn.value && !!inst && value == null,
    wear: wearRow?.wear ?? null,
    seed: wearRow?.seed ?? null,
    rarity: (weaponSlot ? rarityOf(displayPos) : row?.item?.rarity) ?? null,
    dim: weaponSlot ? !isSkinned(rowFor(displayPos)) : !row,
    baking: !!inst && renderingIds.value.has(inst.id),
    queued: !!inst && queuedIds.value.has(inst.id),
  };
}

/** The hover-cluster actions, which are identical for every cell and were
 *  hand-wired six times. `focus` is bound at the call site — only weapon cells
 *  have somewhere to focus to. */
function cellActions(pos: string) {
  const inst = () => cellInstance(pos);
  return {
    focus: () => {
      selectPos(pos);
      go("/focus");
    },
    view3d: () => inst() && view3dForInstance(inst()!),
    inspect: () => inst() && openInspectLink(inst()!.id),
    edit: () => {
      selectPos(pos);
      if (inst()) openEdit(inst()!);
    },
    duplicate: () => {
      selectPos(pos);
      if (inst()) openEdit(inst()!);
    },
    remove: () => inst() && deleteOwned(inst()!),
  };
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
    // After, never with: the picker must paint as soon as the catalog lands.
    void loadStockPrices(key);
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

// ---- sorting ----------------------------------------------------------------
// One control on the Inventory grid, one on the sheet (Owned + Craft share it),
// one in the attachment picker. All three are useSortControl over the tables in
// sortModes.ts; "Default" is whatever order the source already has.
//
// Sort direction is shown, never implied — an unlabelled "Sort · Rarity" doesn't
// say which end it starts from, and for wear the two ends mean opposite things
// (a factory-new hunt vs a battle-scarred one).

const sheetSortCtl = useSortControl<SortMode>({
  scope: "sheet",
  fallback: DEFAULT_SORT,
  natural: SORT_NATURAL,
  hints: SORT_DIR_HINT,
  kinds: SORT_DIR_KIND,
});
// Destructured, including the computeds: a ref nested inside an object is not
// auto-unwrapped in a template, only a top-level binding is.
const { mode: sheetSort, dir: sheetDir, setMode: setSheetSort, kind: sheetSortKind, hint: sheetSortHint } = sheetSortCtl;

/** The sort list this session offers. "Value" appears only when there are values
 *  — a mode that leaves the list in source order looks like a broken sort, not a
 *  missing feature. */
const invSorts = computed(() => (pricesOn.value ? SORTS : SORTS_WITHOUT_VALUE));

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
/**
 * When an owned instance arrived, as a sortable number.
 *
 * 0 for anything without a date, which puts it at the OLD end in either
 * direction — the honest place for "we do not know", and what an older backend
 * that never sends created_at degrades to.
 */
const addedAt = (i: InventoryItem): number => {
  const t = i.created_at ? Date.parse(i.created_at) : NaN;
  return Number.isFinite(t) ? t : 0;
};
function sortInstances(list: InventoryItem[], mode: SortMode, dir: SortDir): InventoryItem[] {
  const flip = dir === SORT_NATURAL[mode] ? 1 : -1;
  if (mode === "default") return flip === 1 ? list : [...list].reverse();
  const arr = [...list];
  if (mode === "name") return arr.sort((a, b) => flip * byName(itemName(a.item), itemName(b.item)));
  if (mode === "wear") return arr.sort((a, b) => flip * ((a.wear ?? 1) - (b.wear ?? 1)) || byName(itemName(a.item), itemName(b.item)));
  if (mode === "recent") {
    // The id breaks ties, because a craft loop can mint several rows inside one
    // clock tick and a comparator that returns 0 on genuinely different items
    // lets their order flicker between renders. It is an identity column, so it
    // orders the same way the timestamp does.
    return arr.sort((a, b) => flip * (addedAt(b) - addedAt(a) || Number(b.id) - Number(a.id)));
  }
  // Unpriced items sink to the bottom in BOTH directions — treated as -1 rather
  // than 0, so "least valuable first" still leads with the cheap things we can
  // actually price instead of a wall of items we know nothing about.
  if (mode === "value") {
    return arr.sort(
      (a, b) =>
        (a.price ? 0 : 1) - (b.price ? 0 : 1) ||
        flip * ((b.price?.value ?? -1) - (a.price?.value ?? -1)) ||
        byName(itemName(a.item), itemName(b.item)),
    );
  }
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
  // Catalog entries have neither a float nor an acquisition date, so both of
  // those modes are inert here — see needsOwnedItem, which is also what gates
  // them out of the pickers that offer this list.
  if (needsOwnedItem(mode)) return list;
  // They have no price of their own either — what they have is a STOCK cost,
  // which is a different question ("what would making one cost") answered by a
  // different map. Unpriced finishes sink in both directions, same rule as the
  // inventory's value sort. Not folded into needsOwnedItem: that predicate is
  // about what an item IS, this is about whether the operator has a feed.
  if (mode === "value") {
    const flip = dir === SORT_NATURAL.value ? 1 : -1;
    return [...list].sort(
      (a, b) =>
        (stockPriceOf(a.id) ? 0 : 1) - (stockPriceOf(b.id) ? 0 : 1) ||
        flip * ((stockPriceOf(b.id)?.value ?? -1) - (stockPriceOf(a.id)?.value ?? -1)) ||
        byName(a.name, b.name),
    );
  }
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
  // After, not with: a craft or an equip should land on screen immediately and
  // have its price catch up.
  void loadPrices();
  // Items staged for deletion are already gone from the UI but not yet from
  // the server — a refresh mid-grace must not resurrect them.
  const pend = pendingDelete.value;
  if (pend) {
    const ids = new Set(pend.items.map((i) => String(i.id)));
    inventory.value = inventory.value.filter((i) => !ids.has(String(i.id)));
  }
}

// ---- loadout presets --------------------------------------------------------
// Named builds you switch between. Exactly one is live at a time and the server
// parks the rest, so `loadout` still means "the build you are wearing" — every
// switch is a round trip followed by a full refresh, never a local swap.
//
// Owner-only, deliberately. A viewer (and the profile tab) sees the build that
// is live; the others are drafts, and whose they are is the only thing that
// makes them interesting.
const presets = ref<LoadoutPreset[]>([]);
const presetBusy = ref(false);
/** Cursor anchor for the preset menu — same contract as the slot/item menus. */
const presetCtx = ref<{ x: number; y: number } | null>(null);
/**
 * Which preset the menu acts on. Null = the one on screen, which is the only
 * thing the compact menu can mean. On desktop the menu is raised from a CARD
 * in the deck and names that card's build, so "Delete this loadout" has a
 * "this" that is not necessarily the one you are wearing.
 */
const presetMenuFor = ref<string | null>(null);
const presetMenuTarget = computed(
  () => presets.value.find((p) => p.id === (presetMenuFor.value ?? activePreset.value?.id)) ?? null,
);
/** The in-place rename draft; null when not renaming. COMPACT only — the header
 *  input that replaces the name button. Desktop renames inside the deck. */
const presetDraft = ref<string | null>(null);
const presetInputEl = ref<HTMLInputElement | null>(null);
/**
 * The loadout deck — the desktop switcher's open state. The header button's
 * box, so the deck hangs off the control that opened it; null = closed.
 */
const presetDeck = ref<{ x: number; y: number; w: number } | null>(null);
const presetBtnEl = ref<HTMLButtonElement | null>(null);
/** The deck card mid-rename (its name is an input). */
const presetRenaming = ref<string | null>(null);

const activePreset = computed(() => presets.value.find((p) => p.active) ?? null);

/**
 * Which of THEIR builds a visitor is looking at. Null means the one they are
 * wearing, which is where every visit starts — the same answer this page gave
 * before presets existed, so a link to a profile still opens on the live rack.
 */
const viewerPreset = ref<string | null>(null);

/**
 * The build the pill is under. These are two different questions and only look
 * like one: for the owner it is what they are WEARING, for a visitor it is what
 * they are READING. Collapsing them would light the pill under the owner's
 * active build while the grid showed a parked one.
 */
/** What the compact button prints. The build on SCREEN, which for a visitor is
 *  whichever of theirs they are paging through rather than the one they wear. */
const activePresetName = computed(
  () => presets.value.find((p) => p.id === shownPresetId.value)?.name ?? "Loadout",
);

const shownPresetId = computed(() =>
  (viewerId.value ? viewerPreset.value ?? activePreset.value?.id : activePreset.value?.id) ?? "",
);
/**
 * The whole control hides when there is nothing to report. That is not just the
 * signed-out and viewer cases: a backend older than this feature 404s the route
 * and leaves the list empty, and a switcher over an empty list is a control with
 * nothing behind it.
 *
 * For the OWNER a single preset still shows its pill. It names the build you
 * are wearing and it is what the menu button hangs off — which is also how
 * anyone finds out presets exist at all.
 *
 * For a VISITOR it takes two. Their strip is a switch and nothing else — no cog,
 * nothing to manage — so with one build there is nothing to switch to and the
 * pill would just restate that the page shows what the player wears.
 */
const showPresets = computed(() =>
  canEdit.value ? presets.value.length > 0 : !!viewerId.value && presets.value.length > 1,
);

/**
 * DISPLAY ONLY — PRESET_LIMIT in backend/src/main.ts is the door, and it answers
 * with a sentence a human can read. This only decides whether the menu offers an
 * action that would bounce. If the two ever drift, the worst case is a hidden
 * row that would have worked, or a row that returns that sentence.
 */
const PRESET_LIMIT = 6;
const presetsFull = computed(() => presets.value.length >= PRESET_LIMIT);

async function loadPresets() {
  // Swallowed rather than surfaced: frontend and backend ship as separate
  // images, so this route 404s on a backend that predates presets. That has to
  // read as "this deployment has no presets" — an empty list hides the whole
  // control — and not as a failed page load.
  // A visitor reads the owner's list from the public route; it carries the same
  // id/name/active/count and nothing more. Same swallow for the same reason.
  presets.value = viewerId.value
    ? await fetchPlayerPresets(viewerId.value).catch(() => [])
    : canEdit.value
      ? await fetchPresets().catch(() => [])
      : [];
  void loadPresetRows();
}

/**
 * The ROWS of every parked preset, by id — what the deck cards are drawn from.
 *
 * The build on screen is `loadout`; every other build is fetched here through
 * the same public per-preset read a visitor uses, and its art, its per-side
 * meters and its "nothing equipped" are derived from those rows exactly as the
 * shown card's are from `loadout`. One derivation, so a card looks the same
 * whether or not it is the one you are on — which is the whole point of a deck.
 *
 * A parked build cannot change while parked (only the live one is editable),
 * so entries are fetched once and kept. The one that just became live is
 * dropped on switch — its rows are `loadout` now — and whichever was live is
 * fetched fresh, because the server has just parked its rows.
 */
const presetRows = ref<Record<string, LoadoutEntry[]>>({});
async function loadPresetRows() {
  const owner = viewerId.value ?? props.user?.steam_id;
  if (!owner) return;
  const parked = presets.value.filter((p) => p.id !== shownPresetId.value);
  // Forget what is no longer parked (deleted, or now on screen).
  const keep = new Set(parked.map((p) => p.id));
  for (const id of Object.keys(presetRows.value)) if (!keep.has(id)) delete presetRows.value[id];
  await Promise.all(
    parked
      .filter((p) => !(p.id in presetRows.value))
      .map(async (p) => {
        try {
          const rows = await fetchPlayerLoadout(String(owner), p.id);
          // Guard against a switch that landed while this was in flight.
          if (p.id !== shownPresetId.value) presetRows.value[p.id] = rows;
        } catch {
          // A card with no rows draws blank; not worth a toast over someone's loadout.
        }
      }),
  );
}
/** A preset's rows, wherever they live; null while unknown (fetch in flight). */
const rowsOf = (p: LoadoutPreset): LoadoutEntry[] | null =>
  p.id === shownPresetId.value ? loadout.value : presetRows.value[p.id] ?? null;

async function switchPreset(id: string) {
  // A VISITOR is changing what they are LOOKING AT, not what the owner wears.
  // activatePreset writes to the account that owns the preset, so sending a
  // visitor down the path below would either 401 or — far worse, if it ever
  // stopped 401ing — reach into someone else's loadout from a page that only
  // ever advertised itself as a view. The two meanings of "switch" diverge
  // here, so they fork here.
  if (viewerId.value) {
    if (presetBusy.value || shownPresetId.value === id) return;
    presetBusy.value = true;
    const previous = viewerPreset.value;
    try {
      loadout.value = await fetchPlayerLoadout(viewerId.value, id);
      viewerPreset.value = id;
      // The build just left behind is parked again as far as the deck is
      // concerned, and it has no cached rows (shown builds never do).
      void loadPresetRows();
      queueLoadoutRenders();
    } catch (e) {
      fail(e);
      // The fetch is what decides: the pill only moves once a build is actually
      // on screen, so a failed switch leaves the strip naming what is drawn.
      viewerPreset.value = previous;
    } finally {
      presetBusy.value = false;
    }
    return;
  }
  if (presetBusy.value || activePreset.value?.id === id) return;
  presetBusy.value = true;
  try {
    await activatePreset(id);
    // Everything on screen is downstream of which build is live: the loadout
    // itself, and the inventory's `equipped` markers with it.
    await Promise.all([refreshAll(), loadPresets()]);
    queueLoadoutRenders();
  } catch (e) {
    fail(e);
    // The strip is rendered off `presets`, so a switch that failed has to put
    // the real active one back — otherwise the pill sits under a build the
    // player is not actually wearing.
    await loadPresets();
  } finally {
    presetBusy.value = false;
  }
}

/** `copy` is the duplicate action: the new preset starts as what you're wearing
 *  now, pointing at the same owned instances (it does not clone your items). */
async function newPreset(copy: boolean) {
  if (presetBusy.value) return;
  presetBusy.value = true;
  let made: LoadoutPreset | null = null;
  try {
    made = await createPreset({ copy });
  } catch (e) {
    fail(e);
  } finally {
    presetBusy.value = false;
  }
  // Straight into it — a build you made and are not wearing is two clicks for
  // the one thing anyone wants from that button.
  if (made) await switchPreset(made.id);
}

function togglePresetDeck() {
  if (presetDeck.value) {
    closePresetDeck();
    return;
  }
  const box = presetBtnEl.value?.getBoundingClientRect();
  if (!box) return;
  presetDeck.value = { x: box.left, y: box.bottom, w: box.width };
}
function closePresetDeck() {
  presetDeck.value = null;
  presetRenaming.value = null;
  presetMenuFor.value = null;
}
/** A deck card's ··· (or right-click): the context menu, aimed at THAT build. */
function openPresetCardMenu(id: string, at: { x: number; y: number }) {
  presetMenuFor.value = id;
  presetCtx.value = at;
}

/** Two renames, one per surface. Compact edits in the header, where the name
 *  button is; desktop edits in the deck card, where the name is. The menu row
 *  that starts it doesn't know which — the open deck decides. */
function startPresetRename() {
  const target = presetMenuTarget.value ?? activePreset.value;
  if (!target) return;
  if (presetDeck.value) {
    presetRenaming.value = target.id;
    return;
  }
  presetDraft.value = target.name;
  void nextTick(() => presetInputEl.value?.select());
}

async function commitDeckRename(id: string, name: string) {
  presetRenaming.value = null;
  const target = presets.value.find((p) => p.id === id);
  if (!target || !name.trim() || name.trim() === target.name) return;
  try {
    await renamePreset(id, name);
    await loadPresets();
  } catch (e) {
    fail(e);
  }
}

async function commitPresetRename() {
  const draft = presetDraft.value;
  const target = activePreset.value;
  // Cleared FIRST: blur fires on Enter as the input unmounts, so commit runs
  // twice, and the second pass has to find nothing left to do.
  presetDraft.value = null;
  if (!target || draft == null || !draft.trim() || draft.trim() === target.name) return;
  try {
    // The server does the trimming and the length cap and falls back to the old
    // name for an empty one, so there is nothing to validate here.
    await renamePreset(target.id, draft);
    await loadPresets();
  } catch (e) {
    fail(e);
  }
}

function askDeletePreset() {
  const target = presetMenuTarget.value ?? activePreset.value;
  if (!target) return;
  confirmAsk.value = {
    title: `Delete "${target.name}"?`,
    // The distinction worth spelling out: a preset is an arrangement, not a
    // container. Deleting one is not deleting anything you crafted.
    body:
      `That loadout and the ${target.slots} slot${target.slots === 1 ? "" : "s"} in it go away. ` +
      "The items themselves stay in your inventory — a preset only arranges what you already own. " +
      // Only true of the one you are wearing; a parked build just goes.
      (target.active ? "You'll be switched to another loadout." : ""),
    confirmLabel: "Delete",
    onConfirm: () => void removePreset(target.id),
  };
}

async function removePreset(id: string) {
  if (presetBusy.value) return;
  presetBusy.value = true;
  try {
    await deletePreset(id);
    // The server moves you onto another preset when you delete the live one, so
    // the loadout on screen has changed even though nothing here equipped
    // anything.
    await Promise.all([refreshAll(), loadPresets()]);
    queueLoadoutRenders();
  } catch (e) {
    fail(e);
  } finally {
    presetBusy.value = false;
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
// Every cell cleared this inline (`@dragleave="dragOverPos === pos && ..."`)
// until the grid moved into its own component. Named now, because a highlight
// may only be cancelled by the slot that owns it — clearing unconditionally
// would kill the highlight the cell you just dragged ONTO has already set.
function slotDragLeave(pos: string) {
  if (dragOverPos.value === pos) dragOverPos.value = null;
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
/** A full-length attachment row, every slot present and empty. Full length
 *  because the slot INDEX is what the game keys a sticker or patch on, so a
 *  short array is not "fewer stickers", it is a hole the form cannot address. */
const emptySlots = (n: number): (Attach | null)[] => Array.from({ length: n }, () => null);
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
/**
 * What the craft/view modal prints above the finish name — the craft's OWN
 * weapon, never the loadout's. It used to show `sheetWeaponName`, which was
 * right when every craft started from the selected slot and wrong from the
 * armory: `selected` still points at whatever position was last touched, so an
 * M4A4 finish opened over an MP7 slot read "MP7". The finish's own name prefix
 * covers knives, gloves and agents, whose models aren't in the base-weapon
 * list; items with no weapon in their name (pins, vanilla knives) answer null
 * and the line hides rather than name an unrelated gun.
 */
const craftWeaponLabel = computed(() => {
  const w = weaponByModel.value.get(craftModel.value ?? "")?.name;
  if (w) return w;
  const name = craft.value?.skin.name ?? "";
  return name.includes(" | ") ? name.split(" | ")[0] : null;
});
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
  craft.value = { skin, wear: DEFAULT_WEAR, seed: 1, stattrak: false, nametag: "", stickers: emptySlots(MAX_STICKERS), patches: emptySlots(MAX_PATCHES), charm: null };
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
          .slice(0, MAX_STICKERS)
          .map((s) => attach(s, { x: s?.x ?? null, y: s?.y ?? null, r: s?.r ?? null, w: s?.w ?? null })),
        patches: d.patches.slice(0, MAX_PATCHES).map((p) => attach(p ? { id: p } : null)),
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
  const stickers = emptySlots(MAX_STICKERS);
  (inst.stickers ?? []).forEach((st, i) => {
    if (st && i < MAX_STICKERS) stickers[i] = { id: st.id, name: st.name, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null, inst: st.inst ?? null };
  });
  const patches = emptySlots(MAX_PATCHES);
  (inst.patches ?? []).forEach((pt, i) => {
    if (pt && i < MAX_PATCHES) patches[i] = { id: pt.id, name: pt.name, image: pt.image, inst: pt.inst ?? null };
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
  // A stored card bake IS a render (weapons and charms have one), but the flag
  // is read solely by the agent fade — and an agent never bakes — so "not ours"
  // is the honest answer here.
  craftPreviewRendered.value = false;
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

// ---- StatTrak history -------------------------------------------------------
//
// The ledger behind the counter: first kill, which matches, which map, and a
// trend. Loaded lazily and only here, on the item's own detail surface — it is
// a scan of one item's kills rather than a column read, so it deliberately does
// NOT ride along on /api/inventory the way stattrak_count does. A grid of two
// hundred tiles has no use for it.

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
      stickers: emptySlots(MAX_STICKERS), patches: emptySlots(MAX_PATCHES), charm: null,
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
/**
 * Kinds whose grid card is a RENDER of the item rather than its stock icon.
 *
 * `hasModel` alone used to be the whole gate, which was fine while weapons and
 * knives were the only two types with a GLB. The moment gloves and agents landed
 * on the mount they started baking too — and a glove baked through the weapon
 * path has no compositor, so every painted glove card became a pair of blank
 * white hands, cached under a key that says it is finished.
 *
 * CHARMS ARE IN because their icon can never be right. A charm's whole look is
 * its pattern — Semi-Precious sweeps green to purple across its range — and the
 * stock icon is one frozen sample of that, so every Semi-Precious in the grid
 * showed the same blue crystal whatever pattern it was built with, and changing
 * the pattern re-labelled the tile "#1" while leaving the art alone. That is the
 * same "can the icon be wrong" test craftPreviewNeeded already applies to decide
 * whether the 2D still has to be rendered; this is the grid answering it the
 * same way. The seed is already in renderKeyFor, so a pattern change invalidates
 * the card by itself.
 *
 * GLOVES ARE IN for the same reason, and their exclusion was never really about
 * the test: it was the blank-white-hands bug above. That bug was weapon opts on
 * a glove, not gloves being unbakeable, and the fix is to pass the kind — which
 * this now does.
 *
 * Agents and stickers pass the test only CONDITIONALLY — an agent's icon stops
 * being true once a patch is on it, a sticker's once it is scuffed — so they
 * want a per-instance test rather than membership of a set, and neither is here.
 * A patch has no pattern and no wear, so its icon is always the truth.
 *
 * Anything added here must also be added to RENDERED_IN_3D in
 * build-asset-manifest.mjs, which encodes the same decision for the extractor's
 * missing-icon report.
 */
const CARD_BAKE_KINDS = new Set<ViewerKind>(["weapon", "charm", "glove"]);
async function generateRenderNow(inst: InventoryItem): Promise<boolean> {
  if (renderedIds.has(inst.id)) return false;
  // Resolved, not read off `item.model`. A charm names no model of its own —
  // the econ schema names its mesh and 23 of them share one blank — so the sync
  // answer is `undefined` ("ask the backend"), and the old `item.model` gate
  // dropped every charm before the kind was even consulted.
  const sync = resolveViewerModelSync(inst.item);
  const target = (sync === undefined ? await resolveViewerModel(inst.item) : sync) ?? null;
  if (!target || !CARD_BAKE_KINDS.has(target.kind)) return false;
  const model = target.model;
  if (!(await hasModel(model))) return false;
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
    // Gated by KIND, not by "did the lookup come back empty" — the same split
    // craftVisualOpts makes. Sticker slots, a hanging charm and a StatTrak
    // module are all meaningless on a charm that IS the model, and stickerGeom
    // would go and fetch markup for a key no weapon has.
    const isWeapon = target.kind === "weapon";
    const blob = await snapshotModel(
      model,
      {
        kind: target.kind,
        // Where a charm's material and pattern shading come from. Without it the
        // charm renders undressed — a featureless grey shape, which does not
        // throw and does not read as broken in a thumbnail.
        charmSpec: target.charm ?? null,
        // NOT weapon-gated, deliberately. The paint chain is composited for
        // gloves too, so gating this on `isWeapon` would be a trap set for
        // whoever adds "glove" to CARD_BAKE_KINDS: a glove with no
        // paintMaterial composites to blank white hands, which is precisely the
        // bug that got its whole kind excluded in the first place. A charm has
        // none to pass (its material comes from charmSpec), so unconditional
        // costs nothing and matches craftVisualOpts.
        paintMaterial: inst.item?.paintMaterial ?? null,
        legacyPaint: !!inst.item?.legacyPaint,
        wear: inst.wear != null ? Number(inst.wear) : null,
        // A charm's `seed` is its own PATTERN and the standalone viewer grades
        // its material by it; on a weapon the same field is the float pattern.
        seed: inst.seed != null ? Number(inst.seed) : null,
        // NOT the live `gloveArms` toggle, and that is the point: a card is
        // keyed on id+wear+seed+stattrak, so anything else it renders from has
        // to be a constant. Reading a UI switch here would bake two different
        // pictures under one key, whichever the last viewer happened to leave
        // on. Bare hands is what the icon shows.
        gloveArms: false,
        ...(isWeapon ? await stickerGeom(model) : {}),
        ...(isWeapon ? instPlacements(inst) : {}),
        // Module yes, readout no. The count is deliberately absent from
        // renderKeyFor — a baked card must stay valid as kills land, and it
        // can only do that if the digits were never in the picture.
        stattrak: isWeapon && inst.stattrak ? { count: null } : null,
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

/**
 * Transport wiring for one viewer slot's control legend.
 *
 * ViewerControls POLLS this rather than being handed a value (see its `inspect`
 * prop), so all a slot has to give it is a getter that follows whichever handle
 * the slot currently holds — the getter identity then survives a remount, and
 * the bar keeps working when the modal rebuilds its viewer under it.
 *
 * Per slot, not once: the focus stage stays mounted behind the craft modal, so
 * two of these are live at the same time and they must not share a handle.
 */
function viewerTransport(slot: ReturnType<typeof useViewerMount>) {
  return {
    read: () => slot.current()?.inspect() ?? null,
    play: (on: boolean) => slot.current()?.setInspectPlaying(on),
    seek: (t: number) => slot.current()?.setInspectTime(t),
  };
}

// 3D preview inside the craft/edit modal.
const modal3d = ref(false);
const modal3dAvailable = ref(false);
/**
 * First person, in the modal — in both modes.
 *
 * Editing gets it too. Most of the weapon's surface points away from you while
 * it is held, so it is a poor pose to place a sticker in, but that is the
 * user's call to make and the toggle back is right there: what you cannot do is
 * check how your craft actually looks in the game without leaving the editor.
 */
const craftHeld = ref(false);
const craftHeldAvailable = computed(() => craftTarget.value?.kind === "weapon");
const craftStageCmp = ref<InstanceType<typeof ItemStage> | null>(null);
const craftPanelW = ref(0);
const modalViewerEl = computed<HTMLElement | null>(() => craftStageCmp.value?.hostEl ?? null);
const modalViewer = useViewerMount({
  label: "craft modal",
  host: () => modalViewerEl.value,
  onError: (e) => {
    modal3d.value = false;
    charmPending.value = false; // nothing is coming — don't strand the rail
    fail(e);
  },
});
const craftInspect = viewerTransport(modalViewer);
/**
 * The box that goes fullscreen — the STAGE, not `modalViewerEl`.
 *
 * The canvas host is `absolute inset-0` inside this, so fullscreening it would
 * take the loading spinner, the 2D/3D pill and the settings cog out of the
 * fullscreen subtree: the browser paints only the fullscreen element and its
 * descendants, so every overlay would simply vanish for the duration.
 */
const craftStageEl = computed<HTMLElement | null>(() => craftStageCmp.value?.stageEl ?? null);
const craftStage = useViewerStage({
  stage: () => craftStageEl.value,
  handle: () => modalViewer.current(),
  // Held: the same weapon actions the focus stage offers, against this viewer.
  // Two screens showing one item should answer the same keys.
  viewmodel: () => craftHeld.value,
  extraKeys: () =>
    craftHeld.value
      ? FPV_ACTIONS.map((a) => ({
          key: a.key,
          cap: a.cap,
          label: a.label,
          icon: a.icon,
          on: fpvAction.value === a.action,
          run: () => (a.action === "fire" ? holdFpvFire(true, modalViewer) : fireFpvAction(a.action, modalViewer)),
          ...(a.action === "fire" ? { release: () => holdFpvFire(false, modalViewer) } : {}),
        }))
      : [],
  // 3D only. The keys move a camera, and the 2D branch of this stage is an
  // <img> — binding "R" to reset a camera that is not on screen is how a
  // shortcut earns a reputation for doing nothing.
  enabled: () => !!craft.value && modal3d.value,
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
  // The albedo belongs to the charm that WAS mounted, and nothing else clears
  // it — so it outlived its item. Held over, the pattern rail resolves the new
  // charm's shading against the old charm's material name, and a wrong match
  // and no match do not look different: both paint a plausible ramp, and the
  // swatch is now a read-only claim about an item on two screens rather than a
  // hint beside a control. Mounting refills it (see mountModalViewer), and
  // until it does the rail says so instead of guessing.
  charmAlbedo.value = null;
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
  // Kick the 2D still for the items whose fallback is the stock icon.
  //
  // The still normally only re-renders when the FORM changes, which is right
  // when the fallback is that item's own stored card — but a draft has no
  // instance and so no card, whatever its kind, and the kinds outside
  // CARD_BAKE_KINDS never have one at all. There the icon is the item as the
  // game ships it rather than as it was built, and it takes a render before 2D
  // tells the truth: a charm's pattern, a glove's wear, the patches on an agent.
  //
  // Skipped where a stored card IS standing in (openEdit seeded it), because
  // this would bake a second identical copy of it. If that card turns out not to
  // be there the <img> 404s, and craftPreviewFailed kicks the render from the
  // error instead — so the missing case is covered without paying for it here.
  //
  // Cheap either way: scheduleCraftPreview parks it while 3D is on (which is the
  // default), so nothing bakes until the 2D tab is actually asked for.
  const still = craftTarget.value;
  if (open && still && craftPreviewNeeded(still) && !craftStillIsStored(still)) scheduleCraftPreview(0);
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
// It does NOT size the form — see stickerSlotCount below.
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
/**
 * Sticker wells the form offers: five, on every weapon.
 *
 * Constant on purpose. This used to be the model's HD anchor count, which is 4
 * on sixteen weapons — so the fifth sticker the game accepts had nowhere to be
 * typed. Three things were wrong with that: the anchor count is not a sticker
 * cap (the stack shares anchors when it outnumbers them), the HD count is the
 * wrong one for a legacy-model paint (14 of 35 weapons disagree between bodies),
 * and the five 6-anchor weapons drew a sixth column over a five-element array.
 *
 * Placement is where the anchors belong, and the viewer already does that per
 * body variant — see slotMarkup in viewer3d.ts.
 */
const stickerSlotCount = MAX_STICKERS;
async function stickerGeom(model: string) {
  const g = await fetchStickerGeometry(model);
  // `charmSurfaces` rides along because it comes out of the same request — and
  // because every site that mounts a weapon needs it for the same reason it
  // needs the sticker anchors: it is the model's own answer to where an
  // attachment goes. Spread into ViewerOpts, so adding it here reaches the live
  // stage, the 2D still and the card bake at once.
  return { stickerBounds: g.bounds, stickerSlots: g.slots, charmSurfaces: g.charmQuads };
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
/**
 * Everything about the craft state that decides how the item LOOKS, as the
 * viewer wants it.
 *
 * Shared by the live 3D stage and the 2D still on purpose: those are one
 * picture in two renderers, and they only stay one picture if there is a single
 * place that says what is on the model. They were built separately, and the 2D
 * half never grew past the weapon it was written for — it passed a model key and
 * a paint and nothing else, so a STANDALONE item was snapshotted with `kind`
 * defaulted to "weapon": no charm material, no decal art, no agent patches. For
 * a charm that meant the one attribute it has, its pattern, was mounted with
 * nothing to apply it to, and the 2D tab quietly showed the stock icon while the
 * rail beside it painted the colour that was picked.
 *
 * What is NOT here is per-renderer by nature: interactivity and the drag
 * callbacks, the StatTrak readout (live count on the stage, dark on a bake — see
 * renderKeyFor), and the name plate, which no bake carries because the render
 * key has no room for it.
 */
async function craftVisualOpts(target: ViewerTarget) {
  const c = craft.value;
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
    // the same field a weapon spends on its float. A patch has no scratch, so it
    // stays at 0.
    decal:
      target.kind === "sticker" || target.kind === "patch"
        ? { image: c?.skin.image ?? "", wear: (craftHasScratch.value ? c?.wear : 0) ?? 0 }
        : null,
    paintMaterial: c?.skin.paintMaterial ?? null,
    legacyPaint: !!c?.skin.legacyPaint,
    // Coerced rather than passed through: `v-model.number` on a field the user
    // has emptied yields "", and a string reaching the compositor comes out as
    // NaN texcoords rather than as a visible mistake.
    wear: Number(c?.wear ?? 0),
    // A charm's `seed` is its own PATTERN, and the standalone viewer grades its
    // material by it — so this is the charm's seed when the charm is the model,
    // and the weapon's float pattern otherwise.
    seed: Number(c?.seed ?? 0),
    ...(isWeapon ? await stickerGeom(target.model) : {}),
    stickers: isWeapon ? craftStickerPlacements() : [],
    // Patches are the AGENT's equivalent of stickers, but they are not decals
    // and share none of that machinery: the viewer stamps them into the body
    // texture at UV rects the model itself declares. Just the art, in slot
    // order — there is no geometry and nothing to place.
    patches: target.kind === "agent" ? (c?.patches ?? []).map((p) => p?.image ?? null) : undefined,
    charm: isWeapon ? craftCharmPlacement() : null,
  };
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
    async () => ({
      ...(await craftVisualOpts(target)),
      // View mode isn't interactive in the viewer's sense: no attachment
      // dragging, and the model idles on a slow auto-rotate the way the old
      // standalone overlay did. Orbit/pan/zoom are gated on `still`, not this,
      // so they stay available either way.
      interactive: !viewOnly.value,
      frameInset: { right: craftPanelW.value },
      // Held, on the same terms as the focus view: the equipped gloves wear
      // their finish and the equipped agent lends a sleeve.
      firstPerson:
        craftHeld.value && craftHeldAvailable.value
          ? {
              arms: fpvArms.value,
              action: "idle" as const,
              armsPaint: fpvArmsPaint.value,
              sleeve: fpvSleeve.value,
            }
          : null,
      // Live 3D, so a real readout — the owned item's count when the modal is
      // showing one (craftInstId covers editing AND duplicating, which
      // editingId does not), and 0 for a brand-new craft that has no kills.
      stattrak: craft.value?.stattrak
        ? { count: inventory.value.find((i) => i.id === craftInstId.value)?.stattrak_count ?? 0 }
        : null,
      nametag: craft.value?.nametag ?? null,
      // Drags write straight into the craft form — the numeric inputs follow
      // live, and confirm sends the same offsets to the game server.
      onStickerPlaced(slot: number, x: number, y: number) {
        const st = craft.value?.stickers[slot];
        if (st) {
          st.x = x;
          st.y = y;
        }
      },
      onStickerRotated(slot: number, r: number) {
        const st = craft.value?.stickers[slot];
        if (st) st.r = r;
      },
      onCharmPlaced(x: number, y: number, z: number) {
        if (craft.value?.charm) {
          craft.value.charm.x = x;
          craft.value.charm.y = y;
          craft.value.charm.z = z; // vertical — dropping this pinned drags to a plane
        }
      },
    }),
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
watch([modal3d, craftHeld], ([on, held], [was3d]) => {
  // Same shape as the focus stage's mode watcher: the arms are a second GLB and
  // the weapon has to be re-parented onto a hand bone, so holding it is a
  // remount — and both flags changing at once must still mount exactly once.
  if (!on) {
    if (was3d) teardownModalViewer();
    return;
  }
  void mountModalViewer();
  void held;
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
/**
 * Is what `craftPreview` holds a RENDER of this item, rather than catalog art?
 *
 * Only the agent fade reads it, and it has to: ART_FADE_B feathers the bottom
 * of an agent's icon because that icon is cropped at the waist, and a render is
 * a whole standing figure — so applying it there cuts the legs off instead.
 */
const craftPreviewRendered = ref(false);
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
/**
 * The still's image didn't load — a stored card bake that was never made (or a
 * 404 from the mount). Back to the catalog art, fade and all.
 *
 * And then, for the kinds where that art cannot be right, straight into
 * rendering one: this is the case the `craft` watcher deliberately does not pay
 * for up front. An owned charm reached by a deep link has usually never had its
 * card baked — nothing put its tile on screen — so without this the one screen
 * dedicated to that charm is the one that shows it at the wrong pattern.
 */
function craftPreviewFailed() {
  craftPreview.value = null;
  craftPreviewRendered.value = false;
  const t = craftPreviewTarget();
  if (t && craftPreviewNeeded(t)) scheduleCraftPreview(0);
}
/**
 * Is the still already showing a stored card bake for this item?
 *
 * Owned (`craftInstId`) and of a kind that bakes cards — the two halves of what
 * openEdit's `renderSrc` seeds. A draft has no instance and so no card however
 * card-worthy its kind is, which is exactly the distinction craftPreviewNeeded
 * cannot make on its own.
 */
const craftStillIsStored = (target: ViewerTarget): boolean =>
  craftInstId.value != null && CARD_BAKE_KINDS.has(target.kind);
/**
 * What the still is a picture OF — the same target the 3D stage mounts.
 *
 * The fallback is not belt-and-braces: /catalog/skins does not send `type`, so
 * a plain finish opened from the sheet resolves to no target at all, and
 * without it every weapon in there would lose its preview (see the same
 * fallback in the `craft` watcher).
 */
const craftPreviewTarget = (): ViewerTarget | null =>
  craftTarget.value ?? (craftModel.value ? { model: craftModel.value, kind: "weapon" } : null);
/**
 * Does this item's 2D still have to be RENDERED, rather than left as the icon?
 *
 * Asked of the DRAFT, so it is not the same question CARD_BAKE_KINDS answers: a
 * craft that has never been saved has no instance and so no card bake to fall
 * back on, whatever its kind. The fallback is then the stock Steam icon — the
 * item as the game ships it, not as it was built.
 * Whether that matters is per kind, and the test is "can the icon be wrong":
 * a charm's whole look is its pattern and a glove's is its pattern and its wear,
 * so those two are always worth rendering; a sticker's icon only stops being
 * true once it is scuffed, and an agent's once a patch is on it. A patch itself
 * has neither, so its icon is always the truth.
 */
function craftPreviewNeeded(target: ViewerTarget): boolean {
  const c = craft.value;
  if (!c) return false;
  switch (target.kind) {
    case "charm":
    case "glove":
      return true;
    case "sticker":
      return (c.wear ?? 0) > 0;
    case "agent":
      return (c.patches ?? []).some(Boolean);
    default:
      return false; // weapon (its own card bake stands in) and patch
  }
}
async function refreshCraftPreview() {
  const c = craft.value;
  const target = craftPreviewTarget();
  if (!c || !target) return;
  // A brand-new craft with no customization has nothing worth baking — the
  // base catalog art is the truth until stickers/charm/wear get touched
  // (the template already falls back to craft.skin.image while null).
  //
  // WEAPONS ONLY. Every other kind's catalog art is a stock icon that cannot
  // show the pattern or the wear this item was built with, so there the render
  // is the only honest picture and there is no untouched state to defer to.
  if (
    target.kind === "weapon" &&
    editingId.value == null &&
    craftBaseline === "" &&
    !c.stickers.some(Boolean) &&
    !c.charm &&
    !c.stattrak
  ) return;
  if (!(await hasModel(target.model))) return;
  const token = ++craftPreviewToken;
  craftPreviewBusy.value = true;
  try {
    const blob = await snapshotModel(
      target.model,
      {
        ...(await craftVisualOpts(target)),
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
    craftPreviewRendered.value = true;
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
      craftPreviewRendered.value = false;
      craftPreviewBusy.value = false;
      return;
    }
    if (v === craftBaseline) return; // unchanged since open — stored render stands
    scheduleCraftPreview(400);
  },
);

// Sticker/charm/patch picker. The screen is components/AttachmentPicker.vue and
// every bit of its state — the paging, the facet cascade, the two shelves — is
// composables/useAttachmentPicker.ts.
//
// Created HERE rather than inside that component because `picker` is load-bearing
// across this file: the Escape chain unwinds through it, the craft modal's
// backdrop click closes back to the editor rather than discarding the edit, the
// deep-link reader opens it, and the 3D editor checks it before mounting.
const pickerView = useAttachmentPicker({ inventory, attachedName, fail });
const { picker, openPicker } = pickerView;

// "1.2k" over "1204" — the compact count badge. It sat beside the attachment
// picker until that moved out; the sheet's group tabs and the collection facet
// are what still read it.
const fmtCount = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
// Numeric x/y/z/rotation are the escape hatch, not the interface — dragging in
// 3D is. Off by default; the toggle is remembered for the session so anyone who
// wants the numbers isn't re-opening it on every craft.
const advancedPlacement = ref(false);
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
watch(preview3d, () => {
  previewCharmInert.value = false;
  // Same sentence, same reason: the albedo belongs to the charm that was
  // mounted, so until the next one's GLB lands its rail would grade the last
  // charm's texture against the last charm's material name.
  previewAlbedo.value = null;
});
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
// Badge state: true when the invsim cvars are not configured anywhere, or the
// block this plugin used to write is still sitting in the match type configs.
const cfgWarning = ref<string | null>(null);
function onGameConfig(state: GameConfigState | null) {
  if (!state) return;
  if (!state.key) {
    cfgWarning.value = "No server API key generated yet";
    return;
  }
  if (state.legacy.length && state.canMigrate) {
    cfgWarning.value = `Old invsim block still in ${state.legacy.join(", ")} — configure to move it`;
    return;
  }

  cfgWarning.value = state.configured
    ? null
    : "Game servers are not configured for the inventory yet";
}
// The models mount needs the extraction run: either never run, or run by an
// older pipeline than this build's script. Same badge as cfgWarning — this is
// the only place either surfaces outside /admin, and an admin who never opens
// the models tab would otherwise ship stale (or no) 3D forever.
type ExtractWarn = "missing" | "stale" | null;
const extractWarn = ref<ExtractWarn>(null);
const extractWarnFrom = (s: ExtractStatus): ExtractWarn =>
  s.stale !== true ? null : s.extracted === false ? "missing" : "stale";
// Both badge reasons in one line, so the tooltip says which one (or both) it is.
const gearWarnings = computed(() => {
  const out: string[] = [];
  if (cfgWarning.value) out.push(cfgWarning.value);
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

// The 2D/3D switch and the held toggle both live in ItemStage now — one pane,
// one set of chrome, in both of the screens that show an item.

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
/** Same rule as the inventory grid's own cascade (invCellDelay, in
 *  useInventoryView) for the sheet's two windowed grids (owned, craft), whose
 *  cascade is `animate-sheet-in`. Both are infinite-scrolled, and both were
 *  staggering every appended row — the `sheet-settled` gate only covers the
 *  options column. */
const sheetCellClass = (i: number) => (i < WINDOW_FIRST ? "animate-sheet-in" : "");

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
// The screen itself is components/InventoryScreen.vue; its filters, sort,
// colour-deck drill-in, render window and select mode are all in
// composables/useInventoryView.ts.
//
// They are created HERE rather than inside that component because App still owns
// the URL: viewQuery writes five of these refs into the query string and the
// watchers further down read them back, which is what makes a shared inventory
// link open on the sender's filters. A screen holding its filters privately
// could not honour one.
const invView = useInventoryView({
  inventory,
  weapons,
  tintColors,
  sort: sortInstances,
});
const {
  invSearch,
  invSearchCtl,
  invSearchEl,
  invOrigin,
  invTypes,
  invModels,
  invSort,
  setInvSort,
  filteredInventory,
  selectedIds,
  exitSelectMode,
} = invView;
// ---- money ------------------------------------------------------------------
// Estimated values, off by default until an operator turns the price feed on
// (Admin → Prices) — and off for each PLAYER until they ask for it, because a
// dollar figure beside every gun changes what the screen is about. The toggle
// lives in the header beside Steam sync: both are account-level, both act on
// everything rather than on what a filter is showing.
//
// Never presented as a sale price. Every number here is a whole-wear-bracket
// market estimate that cannot know about float, pattern or phase, so the label
// is always "est." and the tooltip says so in words.
const priceStatus = ref<PriceStatus | null>(null);
const PRICES_SHOWN_KEY = "inventory.prices.shown";
const showPrices = ref(localStorage.getItem(PRICES_SHOWN_KEY) !== "0");
/** Prices exist AND this player wants to see them. Every money surface reads
 *  this one flag, so turning it off cannot leave a stray total behind. */
const pricesOn = computed(() => !!priceStatus.value?.ready && showPrices.value);
/** Which market the figures came from, in words — for the caption that explains
 *  a BLANK price. Declared here, with the rest of the money state, because the
 *  tips below read it during setup. */
const priceSourceLabel = computed(() =>
  priceStatus.value ? PRICE_SOURCE_LABEL[priceStatus.value.source] : "the price feed",
);
function togglePrices() {
  showPrices.value = !showPrices.value;
  // Turning money off while sorted by it would leave the grid in an order
  // nothing on screen explains.
  if (!showPrices.value && invSort.value === "value") setInvSort(DEFAULT_SORT);
  localStorage.setItem(PRICES_SHOWN_KEY, showPrices.value ? "1" : "0");
  // Someone turning it on for the first time this session has no numbers yet.
  if (showPrices.value && !pricesLoaded.value) void loadPrices();
}
/** Re-read the status on the way OUT of the admin screen.
 *
 * The admin console is the same SPA, so an operator who has just switched the
 * price feed on lands back on the loadout with a `priceStatus` fetched before
 * pricing existed — the header toggle would stay missing until a hard reload,
 * which reads exactly like the setting not working. One cheap request on a
 * screen change nobody makes in a loop. */
watch(
  () => route.value.name === "admin",
  (inAdmin, wasInAdmin) => {
    if (wasInAdmin && !inAdmin) void loadPriceStatus().then(() => loadPrices());
  },
);

/**
 * A live estimate for whatever the editor is currently holding.
 *
 * Quoted server-side (POST /api/prices/quote) rather than summed here, so the
 * breakdown obeys exactly the rules the rest of the app does: the skin at ITS
 * wear bracket and StatTrak variant, then each sticker, patch and charm at its
 * own bare-name price, with the ones that couldn't be priced counted rather than
 * quietly dropped.
 *
 * Debounced because the things that move it are dragged, not typed: a sticker
 * slid across a gun fires a change per frame, and every one of those would be a
 * request. 250ms after the hand stops is indistinguishable from live.
 */
/**
 * THE ITEM BEING PRICED — whichever item screen is on top.
 *
 * The quote, the sale history, the wear standing and every tooltip built on
 * them used to read `craft.value` directly, so they existed only inside the
 * modal. That is why the focus view showed a bare figure while the modal showed
 * a figure, a spread, a volume and a verdict: not a different component, a
 * different amount of DATA. One subject fixes it at the source — the same
 * pipeline runs for whichever screen is up, and ItemPrice draws what it is
 * given.
 *
 * Only one of them is ever on top (the modal covers focus, and suspends its
 * viewer), so a single pipeline is not a race.
 *
 * A REF, FED BY THE FOCUS SCREEN — not a computed reaching down the file for
 * `focusPriceable`. This module is one long `<script setup>`, so a computed
 * declared here that reads a `const` declared 1,100 lines below throws
 * `ReferenceError: Cannot access … before initialization` the first time
 * anything evaluates it, which during setup is immediately. Vue catches that
 * inside a watcher's getter and carries on, so nothing crashes and nothing
 * works: the watcher never finishes tracking its dependencies and the price
 * never arms. The screen below assigns into this instead, which cannot happen
 * before it exists.
 */
const focusSubject = shallowRef<{
  skin: Skin;
  wear: number;
  seed: number;
  stattrak: boolean;
  nametag: string;
  stickers: (Attach | null)[];
  patches: (Attach | null)[];
  charm: Attach | null;
} | null>(null);
const priceSubject = computed(() => craft.value ?? focusSubject.value);

const itemQuote = ref<Quote | null>(null);
const itemQuoting = ref(false);
let quoteTimer: ReturnType<typeof setTimeout> | undefined;

function quoteKeyOf(c: NonNullable<typeof priceSubject.value>) {
  // Only the inputs a PRICE depends on. Deliberately not the placement — moving
  // a sticker across the gun changes the render, never the bill — so dragging
  // one costs nothing here.
  return [
    c.skin.id,
    c.wear,
    c.stattrak ? 1 : 0,
    c.stickers.map((x) => x?.id ?? "-").join(","),
    c.patches.map((x) => x?.id ?? "-").join(","),
    c.charm?.id ?? "-",
  ].join("|");
}

let quoteToken = 0;
/**
 * The price path, out loud.
 *
 * This pipeline has now been wrong three times in ways that all LOOKED the same
 * from outside — a figure with nothing under it — and each cause was a
 * different link in the chain: a watcher that never armed, a debounce that kept
 * re-arming, a reading gated on the editor's own state. A chain that fails
 * silently in three places gets to say which one it was.
 *
 * `?pricelog=1` (or the flag in the developer panel) prints one line per step:
 * what was armed, what went out, what came back.
 */
const priceLog = (...args: unknown[]) => {
  if (flagValue("pricelog")) console.log("[price]", ...args);
};

function scheduleQuote() {
  const c = priceSubject.value;
  priceLog("quote: arm", { subject: c ? c.skin.name : null, id: c?.skin?.id, on: pricesOn.value });
  clearTimeout(quoteTimer);
  // Supersedes any request already in flight as well as any timer not yet fired
  // — see the token note below.
  quoteToken++;
  if (!c || !pricesOn.value) {
    itemQuote.value = null;
    // The cleared timer's `finally` will never run, so this is the only place
    // the busy flag can be lowered — left set, the whole value block sits at 40%
    // opacity for the rest of the editor session, looking permanently mid-load.
    itemQuoting.value = false;
    return;
  }
  itemQuoting.value = true;
  // Which request owns the busy flag. Without it the flag was lowered by whichever
  // quote settled FIRST: change a sticker just after a timer has fired and the
  // older request's `finally` clears it while the newer one is still ~500ms away,
  // so the panel shows the previous total at full opacity with nothing pending.
  // The value itself keeps its own guard below — a late answer for a gun that is
  // no longer on screen is worse than none.
  const token = quoteToken;
  quoteTimer = setTimeout(async () => {
    const key = quoteKeyOf(c);
    try {
      const quote = await quoteCraft({
        item_id: c.skin.id,
        wear: c.wear,
        stattrak: c.stattrak,
        stickers: c.stickers.map((x) => (x ? { id: x.id } : null)),
        patches: c.patches.map((x) => (x ? { id: x.id } : null)),
        charm_id: c.charm?.id ?? null,
      });
      // The form may have moved on while that was in flight; a late answer for a
      // gun that no longer exists on screen is worse than none.
      const match = !!priceSubject.value && quoteKeyOf(priceSubject.value) === key;
      priceLog("quote: back", { total: quote?.total, kept: match });
      if (match) itemQuote.value = quote;
    } catch (e) {
      priceLog("quote: FAILED", e);
      if (token === quoteToken) itemQuote.value = null;
    } finally {
      if (token === quoteToken) itemQuoting.value = false;
    }
  }, 250);
}

// The bill, not the render: watches only what a PRICE depends on, so sliding a
// sticker around the gun never triggers a quote. Closing the editor clears it,
// or the next open flashes the last craft's total.
watch(
  () => (priceSubject.value ? quoteKeyOf(priceSubject.value) : null),
  (key) => {
    if (key === null) {
      itemQuote.value = null;
      return;
    }
    scheduleQuote();
    scheduleDetail();
  },
);
// Turning values on mid-edit should fill the line in, not wait for the next
// sticker change.
watch(pricesOn, () => {
  if (priceSubject.value) {
    scheduleQuote();
    scheduleDetail();
  } else {
    itemQuote.value = null;
    itemDetail.value = null;
  }
});

/** The quote, spelled out. Line by line so it is obvious what the total is made
 *  of, and explicit about what could not be priced — an estimate silently
 *  missing the expensive sticker is worse than no estimate. */
const itemQuoteTip = computed(() => {
  const quote = itemQuote.value;
  if (!quote) return "";
  // Nothing priced at all. The most useful thing to say is WHAT was looked for:
  // an item with no listing and a feed that never synced look identical from
  // here, and the bracket is usually the answer — markets list per bracket, and
  // the ends of the range often have no copies for sale at all.
  if (quote.total === 0) {
    const bracket = priceSubject.value?.wear != null ? ` (${wearTier(priceSubject.value.wear)})` : "";
    const st = priceSubject.value?.stattrak ? "StatTrak™ " : "";
    return (
      `No ${priceSourceLabel.value} listing for ${st}${quote.base.name ?? "this item"}${bracket}.\n` +
      (quote.attachments.length
        ? `${quote.attachments.filter((a) => a.price).length} of ${quote.attachments.length} applied items could be priced.\n`
        : "") +
      "Try another source in Admin → Prices, or a different wear — thinly traded brackets often have none."
    );
  }
  // The substitution leads, when there is one: it changes what the total means.
  const note =
    quote.base.price && priceSubject.value
      ? approxNote(quote.base.price, priceSubject.value.wear ?? null, priceSubject.value.stattrak)
      : "";
  const lines = [
    ...(note ? [`No exact listing for this variant — priced from the ${note} one.`, ""] : []),
    `${quote.base.name ?? "Skin"} — ${quote.base.price ? formatPrice(quote.base.price.value) : "no price"}`,
    ...quote.attachments.map((a) => `${a.name ?? a.kind} — ${a.price ? formatPrice(a.price.value) : "no price"}`),
  ];
  return (
    `Rough cost to buy this build:\n${lines.join("\n")}\n` +
    `Total ${formatPrice(quote.total)}` +
    (quote.unpriced ? ` (${quote.unpriced} of ${quote.lines} couldn't be priced)` : "") +
    ". Each piece at its own market price — not what the finished craft would resell for."
  );
});

/**
 * What the finishes in the OPEN craft list would cost brand new.
 *
 * Keyed by catalog id, fetched per slot alongside the skins themselves, and
 * cached the same way — a picker that has already loaded its 1,400 AK finishes
 * should not re-ask for their prices every time it opens.
 */
const stockPrices = ref<Record<string, { value: number; window: string; marketHashName: string; wearTier: number }>>({});
const stockCache = new Map<string, Record<string, { value: number; window: string; marketHashName: string; wearTier: number }>>();

async function loadStockPrices(key: string) {
  if (!priceStatus.value?.ready) return;
  const cached = stockCache.get(key);
  if (cached) {
    stockPrices.value = cached;
    return;
  }
  try {
    const { prices } = await fetchStockPrices(key);
    stockCache.set(key, prices);
    // A newer slot may have won while this was out; the skins loader guards the
    // same way for the same reason.
    if (sheetKey.value === key) stockPrices.value = prices;
  } catch {
    // No prices is the normal state on an instance with the feed off.
  }
}

/** A craft card's cost, and the caption that keeps it honest about which wear
 *  bracket answered — "brand new" is Factory New only where FN exists. */
const stockPriceOf = (id?: number | null) => (id != null ? stockPrices.value[String(id)] ?? null : null);
function stockPriceTip(id?: number | null) {
  const hit = stockPriceOf(id);
  if (!hit) return `No ${priceSourceLabel.value} listing for this finish, in any wear bracket.`;
  const tier = WEAR_TIER_NAME[hit.wearTier] ?? null;
  return (
    `Rough cost to craft this brand new${tier ? ` — cheapest listing is ${tier}` : ""}. ` +
    "Not a sale price, and it doesn't include stickers, a charm or StatTrak."
  );
}

/**
 * The spread behind the editor's single figure, and where THIS copy sits in it.
 *
 * A flat bracket price is the wrong shape for a knife: Factory New spans 0.00 to
 * 0.07, and a market's one figure for it covers both ends. So two facts, kept
 * apart on purpose —
 *
 *   the SPREAD: what copies actually sold for recently, min to max, with the
 *     count behind it. Measured, from real sales.
 *   the POSITION: where this float sits inside its own bracket. Also measured,
 *     from the float itself.
 *
 * The inference joining them ("yours is low in the bracket, so nearer the top of
 * that range") is stated in words and never as a number. Producing a
 * float-adjusted price would need per-listing floats, and no public feed exposes
 * them — CSFloat and Waxpeer both require an account. A fabricated figure on a
 * $1,400 knife is worse than an honest range.
 */
const itemDetail = ref<PriceDetail | null>(null);
let detailTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleDetail() {
  const c = priceSubject.value;
  priceLog("detail: arm", { subject: c ? c.skin.name : null, id: c?.skin?.id, on: pricesOn.value });
  clearTimeout(detailTimer);
  if (!c || !pricesOn.value) {
    itemDetail.value = null;
    return;
  }
  const key = `${c.skin.id}:${wearTier(c.wear ?? 0)}:${c.stattrak ? 1 : 0}`;
  detailTimer = setTimeout(async () => {
    try {
      const detail = await fetchPriceDetail(c.skin.id, c.wear ?? null, c.stattrak);
      priceLog("detail: back", { available: detail?.available, rows: detail?.history?.length });
      const still = priceSubject.value;
      if (still && `${still.skin.id}:${wearTier(still.wear ?? 0)}:${still.stattrak ? 1 : 0}` === key) {
        itemDetail.value = detail.available ? detail : null;
      }
    } catch (e) {
      priceLog("detail: FAILED", e);
      itemDetail.value = null;
    }
  }, 400);
}

/** The window worth quoting, once. */
const itemSales = computed(() => (itemDetail.value ? bestSaleWindow(itemDetail.value.history) : null));

/** Where the edited float sits in its own bracket, and what that means in words.
 *  Only for items that HAVE a float — a charm has no bracket to be at the end of. */
const itemWearStanding = computed(() => {
  const c = priceSubject.value;
  // `hasWear(c.skin)`, not the craft form's own flag: this reading is about the
  // ITEM being priced, and gating it on the editor's state is what left the
  // focus view showing a figure with no standing under it — the line existed,
  // the screen that could produce it did not.
  if (!c || !hasWear(c.skin) || c.wear == null) return null;
  const { tier, pct } = wearPositionInTier(c.wear);
  const rank = Math.max(1, Math.round(pct * 100));
  return {
    tier,
    pct,
    // "Top 4% of Factory New" reads as a rank, which is what people compare on.
    caption: pct <= 0.5 ? `top ${rank}% of ${tier}` : `bottom ${101 - rank}% of ${tier}`,
    verdict: pct <= 0.2 ? "better" : pct >= 0.8 ? "worse" : "typical",
  };
});

/** One sentence tying the two together, and one saying what it can't see. */
const itemValueTip = computed(() => {
  const sales = itemSales.value;
  const standing = itemWearStanding.value;
  if (!sales) return "";
  const range =
    sales.min != null && sales.max != null && sales.max > sales.min
      ? `${formatPrice(sales.min)}–${formatPrice(sales.max)}`
      : formatPrice(sales.median ?? sales.avg ?? sales.min ?? 0);
  const lines = [
    `${sales.volume} recent sale${sales.volume === 1 ? "" : "s"} (${HISTORY_WINDOW_LABEL[sales.window]}) ranged ${range}.`,
  ];
  if (standing) {
    lines.push(
      standing.verdict === "better"
        ? `This float is ${standing.caption} — low floats trade toward the upper end of that range.`
        : standing.verdict === "worse"
          ? `This float is ${standing.caption} — high floats trade toward the lower end.`
          : `This float sits mid-bracket (${standing.caption}).`,
    );
  }
  lines.push("The spread also carries stickers and patterns, which this can't see — treat it as a bracket, not a quote.");
  return lines.join("\n");
});

/** Slot values, keyed TEAM:slot, straight off the server. */
const slotValues = ref<Record<string, number>>({});
/** The same, for every PARKED preset, keyed by preset id — the deck's per-card
 *  figure. The active preset is not here; its slots are `slotValues`. */
const presetSlotValues = ref<Record<string, Record<string, number>>>({});
/** A fetch is in flight AND we have nothing yet — the only state worth showing a
 *  player. A refresh over prices already on screen is silent: numbers that
 *  flicker to "loading" every time something is crafted are worse than numbers
 *  that update a beat late. */
const pricesLoading = ref(false);
const pricesPending = computed(() => pricesLoading.value && !pricesLoaded.value);
const pricesLoaded = ref(false);

/**
 * Fetch prices and fold them into the items already on screen.
 *
 * Merged onto the existing rows rather than kept in a parallel map: everything
 * that reads a price — tiles, totals, sorting — then reads it off the item it
 * belongs to, which is the shape it would have had if the payload carried it.
 * The difference is only in WHEN, which is the whole point.
 */
async function loadPrices() {
  if (!priceStatus.value?.enabled) return;
  pricesLoading.value = true;
  try {
    const { items, slots, presets: parked, ready } = await fetchInventoryPrices();
    for (const inst of inventory.value) inst.price = items[String(inst.id)] ?? null;
    slotValues.value = slots;
    // Absent on a backend that predates the deck: the cards simply carry no figure.
    presetSlotValues.value = parked ?? {};
    pricesLoaded.value = ready;
  } catch {
    // Prices failing is not worth a toast on top of someone's inventory. The
    // numbers simply don't appear, which is the same as pricing being off.
  } finally {
    pricesLoading.value = false;
  }
}

async function loadPriceStatus() {
  try {
    priceStatus.value = await fetchPriceStatus();
  } catch {
    // A panel with no pricing is the normal state, not an error worth a toast.
    priceStatus.value = null;
  }
}

/** Sum of what's on screen right now — filters, search and all. The number that
 *  answers "what are my knives worth", which no total can. */
const inventoryValueInView = computed(() =>
  filteredInventory.value.reduce((sum, i) => sum + (i.price?.value ?? 0), 0),
);
/** Everything owned, unfiltered. Every owned row carries its OWN price, so an
 *  applied sticker counts once here and not again through its weapon. */
const inventoryValueTotal = computed(() =>
  inventory.value.reduce((sum, i) => sum + (i.price?.value ?? 0), 0),
);
/**
 * Real versus simulated, in money.
 *
 * Keyed by the origin filter's own values so the figures and the tabs can never
 * disagree about what "Synced" means — `matchesOrigin` is the same predicate the
 * grid filters on, so a tab's number is exactly the sum of what that tab shows.
 *
 * Client-side on purpose. Every owned row already carries its own price by the
 * time this runs, and each row is counted once — an applied sticker is a row
 * here as well as a line on its weapon. A server endpoint doing the same sum
 * would be a second implementation of one number, and the two would drift.
 */
const valueByOrigin = computed(() => {
  const totals: Record<OriginFilter, number> = { all: 0, steam: 0, crafted: 0 };
  for (const item of inventory.value) {
    const value = item.price?.value ?? 0;
    if (!value) continue;
    totals.all += value;
    totals[matchesOrigin(item, "steam") ? "steam" : "crafted"] += value;
  }
  return totals;
});

/** Show the in-view figure only when the view is actually narrowed, and only
 *  when it has something to say. */
const filteredValueShown = computed(
  () => inventoryValueInView.value > 0 && filteredInventory.value.length !== inventory.value.length,
);

/** Owned rows the mirror couldn't price. Shown as "+N unpriced" rather than
 *  folded into the total: a total built from 180 of 201 items is a different
 *  claim from one built from all of them. */
const inventoryUnpriced = computed(() => inventory.value.filter((i) => !i.price).length);

/** What the equipped loadout for a side would cost — guns plus everything on
 *  them. `value` is the server's per-slot figure and already includes stickers,
 *  patches and charms, which is why this sums that and not `price`. */
const loadoutValue = computed<Record<string, number>>(() =>
  pricesOn.value
    ? { CT: sideValueIn(slotValues.value, "CT"), T: sideValueIn(slotValues.value, "T") }
    : { CT: 0, T: 0 },
);
const teamLoadoutValue = computed(() => loadoutValue.value[team.value] ?? 0);

/**
 * A preset deck card's figure: what one side of THIS build is worth, by the
 * same arithmetic as the header chip above it. The active preset IS the live
 * loadout, so it reads the header's own slot map — the card and the chip
 * cannot disagree. Null where there is nothing honest to print: prices off, a backend
 * without per-preset values, or a visitor (prices are the signed-in account's
 * and say nothing about the builds on someone else's page).
 */
/**
 * Filled weapon positions per side, for a deck card's meters — counted off the
 * build's rows (see presetRows), so the shown card's number moves the instant a
 * slot is equipped and a parked card's is the same count by the same rule.
 * Null while the rows are still on their way: no meter, not an empty one.
 */
const GUN_POSITIONS = POSITION_GROUPS.flatMap((g) => g.positions);
function presetGuns(p: LoadoutPreset): { CT: number; T: number } | null {
  const rows = rowsOf(p);
  if (!rows) return null;
  const count = (t: Team) =>
    GUN_POSITIONS.filter((pos) => rows.some((r) => r.team === t && r.slot === pos)).length;
  return { CT: count("CT"), T: count("T") };
}

/**
 * The hand a deck card fans out: five of the build's items for the showing side,
 * off its rows (every LoadoutEntry carries its catalog item).
 */
function presetPreview(p: LoadoutPreset): PresetPreviewItem[] | null {
  // Null is UNKNOWN — rows still in flight — and the card draws a blank strip.
  // Only a known-empty list may say "nothing equipped"; "42 slots" beside that
  // sentence is the kind of contradiction people screenshot.
  const rows = rowsOf(p);
  if (!rows) return null;
  return sortPreview(
    rows
      .filter((r) => r.team === team.value)
      .map((row) => ({
        team: row.team,
        slot: row.slot,
        skinned: row.skinned,
        image: row.item?.image ?? null,
        rarity: row.item?.rarity ?? null,
        name: row.item?.name ?? "",
      })),
  ).slice(0, 5);
}

function presetValue(p: LoadoutPreset, side: Team): number | null {
  if (!pricesOn.value || viewerId.value) return null;
  const values = p.active ? slotValues.value : presetSlotValues.value[p.id];
  if (!values) return null;
  const total = sideValueIn(values, side);
  return total > 0 ? total : null;
}

/** "$41" / "$4.55" / "$18k" — see formatPrice. Blank rather than "$0" when
 *  nothing in the set could be priced, so an empty state reads as unknown. */
const money = (value: number) => (value > 0 ? formatPrice(value) : "—");

/** Which figure the header shows, by screen. The loadout screens answer "what
 *  is this side wearing"; the inventory answers "what do I own". Same object,
 *  two questions — and nothing at all on the armory, where nothing is yours. */
const headerValue = computed(() =>
  view.value === "inventory"
    ? inventoryValueTotal.value
    : view.value === "grid" || view.value === "focus"
      ? teamLoadoutValue.value
      : 0,
);
const headerValueLabel = computed(() => (view.value === "inventory" ? "Inventory" : `${team.value} value`));
const headerValueTip = computed(() => {
  const window = priceStatus.value ? PRICE_WINDOW_LABEL[priceStatus.value.window] : "market estimate";
  return view.value === "inventory"
    ? invValueTip.value
    : `Rough estimate for everything equipped on ${team.value} — skins plus the stickers, patches and charms on them. Based on ${window}s; not a sale price.`;
});

/** And the caption for a slot whose occupant the mirror had nothing for. */
const noPriceTip = computed(
  () => `No ${priceSourceLabel.value} listing for what's in this slot, at its wear bracket.`,
);

/** One caption for every per-slot figure in the loadout grid. */
const slotValueTip = computed(
  () =>
    `Rough estimate for this slot — the skin plus anything applied to it. Based on ${
      priceStatus.value ? PRICE_WINDOW_LABEL[priceStatus.value.window] : "market estimate"
    }s; not a sale price.`,
);

/** The caption that keeps the number honest — which window it came from, and how
 *  many owned rows the mirror had nothing for. A total silently missing a fifth
 *  of an inventory is worse than no total. */
const invValueTip = computed(() => {
  const window = priceStatus.value ? PRICE_WINDOW_LABEL[priceStatus.value.window] : "market estimate";
  const missing = inventoryUnpriced.value;
  const split = valueByOrigin.value;
  return (
    `Rough estimate — ${window}s across ${inventory.value.length - missing} of ${inventory.value.length} items` +
    (missing ? `; ${missing} couldn't be priced` : "") +
    (split.steam && split.crafted
      ? `.\nSynced from Steam ${formatPrice(split.steam)} · crafted here ${formatPrice(split.crafted)}`
      : "") +
    ". Not a sale price: it can't know about float, pattern or Doppler phase."
  );
});

// ---- how tall are we, really ------------------------------------------------
// See composables/useAppHeight.ts. Compact only: desktop's 6rem assumption is
// correct there and well tested.
const { el: appRootEl, style: appHeightStyle } = useAppHeight(
  () => isCompact.value && !embedMode.value,
);


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
/**
 * The focus stage, and the two elements the viewer plumbing needs off it: the
 * PANE (what goes fullscreen) and the 3D HOST (what the renderer mounts into).
 * Both `useViewerMount` and `useViewerStage` take getters, so these stay plain
 * reads rather than props threaded down.
 */
const focusStageCmp = ref<InstanceType<typeof ItemStage> | null>(null);
/**
 * What the floating spec panel covers, per stage — see ItemStage's
 * `panel-width` and the viewer's `frameInset`. Kept as state rather than read
 * at mount time because it changes with the breakpoint and with whether the
 * item has anything to say about itself, neither of which is a remount.
 */
const focusPanelW = ref(0);
/** Any overlay sitting on top of the focus screen — see the suspend watcher. */
const overlayOpen = ref(false);
const viewer3dEl = computed<HTMLElement | null>(() => focusStageCmp.value?.hostEl ?? null);
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
/**
 * Save what is on the 3D stage as a PNG.
 *
 * The renderer could already produce this — `snapshot()` is how every item card
 * is baked — but it had exactly one caller, the bake queue, so the picture this
 * app is best at making was the one thing you could not take away from it. A
 * shared craft link carries the exact state and shows nothing; this is the other
 * half of that.
 *
 * Grabs the LIVE stage rather than re-mounting an offscreen one, so you get the
 * angle you framed, not a canonical three-quarter view. That is the point: if
 * the interesting thing about a pattern is only visible from one side, a
 * standard pose does not capture it.
 */
async function downloadStageImage(slot: ReturnType<typeof useViewerMount>, name: string) {
  const handle = slot.current();
  if (!handle) return;
  let blob: Blob | null = null;
  try {
    // `live`: the frame on screen, inspect turn and all. The bake queue is the
    // other caller and deliberately does not pass it — a card is keyed forever
    // and has to come out of a canonical pose.
    blob = await handle.snapshot({ live: true });
  } catch (e) {
    notify((e as Error).message);
    return;
  }
  if (!blob) {
    // Null rather than a throw is how the viewer reports "nothing to capture" —
    // a model that never finished, a context that was lost. Say so, because a
    // button that does nothing reads as a broken click.
    notify("Nothing to save yet — the model has not finished loading.");
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Item names carry "|" and spaces, which survive a download but make an ugly
  // file and break naive shell globs on the other side.
  const slug = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  a.download = (slug || "item") + ".png";
  // In the document, not detached. Chrome fires a download from an element that
  // was never connected; Firefox does not, so the button simply did nothing
  // there — and silently, since nothing above it can see a click that had no
  // effect.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a tick later, not immediately: some browsers have not started
  // reading the blob when click() returns, and revoking first cancels the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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
    // The craft's own weapon — same rule as craftWeaponLabel, and for the same
    // reason: the loadout's selected slot says nothing about a craft opened
    // from the armory. Prefix-less items (a pin, a vanilla knife) report their
    // full name rather than an unrelated gun.
    weapon: craftWeaponLabel.value ?? c.skin.name,
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
const focusInspect = viewerTransport(focusViewer);
/**
 * The focus stage's fullscreen box.
 *
 * Unlike the craft modal this one needs no second control bar: the focus stage
 * already floats its ViewerControls INSIDE this element (`variant="overlay"`),
 * so the bar comes along into the fullscreen subtree for free.
 */
/**
 * First person: OFF by default, and deliberately not persisted.
 *
 * The item view is what this app is for — you open a skin to look at the skin —
 * so holding it is a thing you ask for, not a mode you can get stranded in. Not
 * persisted for the same reason: a preference that survives a reload would have
 * every future item open in the hands, which is exactly the "why is my weapon
 * gone" a sticky viewer setting causes.
 */
const fpvOn = ref(false);
/**
 * What the held weapon is doing — CS2's own four actions plus the resting pose.
 *
 * Resets to `idle` whenever first person is left, because an action is a thing
 * you press rather than a mode: coming back to a weapon frozen mid-reload would
 * read as broken.
 */
const fpvAction = ref<ClipAction>("idle");
/** The action buttons, in the order the game lists them. */
const FPV_ACTIONS: { action: ClipAction; key: string; cap: string; label: string; icon: StageIcon }[] = [
  { action: "fire", key: "k", cap: "K", label: "Fire", icon: "fire" },
  { action: "reload", key: "r", cap: "R", label: "Reload", icon: "reload" },
  // I, not the game's F: F is FULLSCREEN on every stage in this app, and one
  // key cannot be two things on a screen that offers both.
  { action: "inspect", key: "i", cap: "I", label: "Inspect", icon: "inspect" },
  { action: "draw", key: "1", cap: "1", label: "Deploy", icon: "deploy" },
];
/**
 * The arms to wear — the equipped gloves, else the team's stock pair.
 *
 * The glove GLB is where the arm skeleton and the inspect clip live (see
 * viewerArms.ts), so there is always an answer: a player wearing no gloves still
 * has hands, and `ct_gloves`/`t_gloves` are the models the game gives them.
 */
const fpvArms = computed<string>(() => {
  const worn = cellItem("gloves") ?? specialDefault("gloves");
  const resolved = worn ? resolveViewerModelSync(worn)?.model : null;
  return resolved ?? (team.value === "CT" ? "ct_gloves" : "t_gloves");
});
/**
 * The equipped glove's FINISH, so the hands wear what the loadout says.
 *
 * Null for the stock pair, which has no finish and is correct unpainted — the
 * default gloves' own textures are the real thing rather than a placeholder.
 */
const fpvArmsPaint = computed<{ material: string; wear: number | null } | null>(() => {
  const row = rowFor("gloves");
  const inst = isSkinned(row) ? row?.item ?? null : null;
  const material = inst?.paintMaterial ?? null;
  return material ? { material, wear: row?.wear ?? null } : null;
});
/**
 * The equipped agent's model, for the first-person sleeve.
 *
 * Falls back to the team's stock agent so the arms are dressed either way — a
 * player who has equipped nothing still wears something in game.
 */
const fpvSleeve = computed<string | null>(() => {
  const worn = cellItem("agent") ?? specialDefault("agent");
  return worn ? resolveViewerModelSync(worn)?.model ?? null : null;
});
/** Only weapons go in a hand. A glove, an agent or a music kit has no grip. */
const fpvAvailable = computed(() => (focusTarget.value?.kind ?? "weapon") === "weapon");

const focusStageEl = computed<HTMLElement | null>(() => focusStageCmp.value?.stageEl ?? null);
const focusStage = useViewerStage({
  stage: () => focusStageEl.value,
  handle: () => focusViewer.current(),
  // Not while a modal is over the top: the craft sheet opens on top of the
  // focus view and has its own stage with the same keys, and two handlers
  // answering "R" would reset a camera nobody is looking at as well as the one
  // they are.
  enabled: () => view.value === "focus" && focus3d.value && !craft.value && !loadout3d.value,
  viewmodel: () => fpvOn.value,
  extraKeys: () => {
    if (!fpvAvailable.value) return [];
    const rows: StageKey[] = [
      {
        key: "v",
        cap: "V",
        label: fpvOn.value
          ? tr("inventory.viewer.controls.fpv_exit", "Put it down")
          : tr("inventory.viewer.controls.fpv", "Hold it"),
        icon: "inspect",
        on: fpvOn.value,
        // The SHORTCUT for the stage strip's HELD tab, which is where this
        // choice is now made and drawn. Hidden so it is not offered twice.
        hidden: true,
        run: () => (fpvOn.value = !fpvOn.value),
      },
    ];
    // The weapon's own actions, only while it is being held. `idle` is not
    // among them: it is where the weapon RESTS, so pressing an action again
    // returns to it rather than needing a button of its own.
    if (fpvOn.value) {
      for (const a of FPV_ACTIONS) {
        rows.push({
          key: a.key,
          cap: a.cap,
          label: a.label,
          icon: a.icon,
          on: fpvAction.value === a.action,
          run: () => (a.action === "fire" ? holdFpvFire(true) : fireFpvAction(a.action)),
          // Fire is a TRIGGER, not a button: run on press, release on let-go,
          // and the viewer repeats it at the weapon's own cycle time while held.
          ...(a.action === "fire" ? { release: () => holdFpvFire(false) } : {}),
        });
      }
    }
    return rows;
  },
});
// Toggling rebuilds the viewer: the arms are a second GLB and the weapon has to
// be re-parented onto a hand bone, neither of which is a live setter. That
// remount is watched next to the 3D switch itself — see the mode watcher — so
// changing both at once still mounts exactly once.
/**
 * Play one of the weapon's actions on the LIVE viewer.
 *
 * Not a remount. An action is a thing you press — it plays once and the weapon
 * settles back to idle — so the state here is "what is playing right now", lit
 * on the button while it runs and cleared by the viewer when the clip ends.
 * Pressing the same action again restarts it.
 */
function fireFpvAction(a: ClipAction, slot: ReturnType<typeof useViewerMount> = focusViewer) {
  const h = slot.current();
  if (!h) return;
  // The button lights only for a press the viewer TOOK — a reload cannot be
  // interrupted and an inspect never interrupts, so a rejected press changing
  // the lit button would claim something the arms are not doing.
  const taken = h.setFpvAction(a, () => {
    if (fpvAction.value === a) fpvAction.value = "idle";
  });
  if (taken) fpvAction.value = a;
}
/** The trigger. Press-and-hold is full auto where the weapon is. */
function holdFpvFire(held: boolean, slot: ReturnType<typeof useViewerMount> = focusViewer) {
  const h = slot.current();
  if (!h) return;
  const taken = h.setFpvFire(held, () => {
    if (fpvAction.value === "fire") fpvAction.value = "idle";
  });
  if (held && taken) fpvAction.value = "fire";
}
/**
 * A MODAL OVER THE FOCUS VIEW STOPS IT DRAWING.
 *
 * Opening Edit from focus left two live viewers on one GPU — the modal's, and
 * the focus one behind it still turning a weapon nobody can see, at full rate,
 * with its own composite and its own charm simulation. The hidden one keeps
 * everything it has loaded and simply stops its loop, so closing the modal is
 * instant rather than a remount.
 *
 * `craft` covers both ways in (edit and view); `loadout3d` is the other overlay
 * that can sit on top of this screen.
 */
watch([craft, overlayOpen], ([c, l]) => focusViewer.current()?.setSuspended(!!c || !!l));

// Live: a breakpoint change or an item with nothing to show swaps the panel in
// and out under a viewer that is already mounted.
watch(focusPanelW, (w) => focusViewer.current()?.setFrameInset(w));
watch(craftPanelW, (w) => modalViewer.current()?.setFrameInset(w));
const teardownViewer = focusViewer.teardown;
watch([focusModelKey, focusPaint], async ([key]) => {
  teardownViewer();
  // Peek before awaiting — same as the craft modal. On a cache hit this whole
  // branch stays synchronous, so `focus3d` is already true when the focus view
  // first paints and the 2D art never appears. Awaiting here on every entry
  // mounted the 2D art for one tick, then flipped to 3D, and the art's 100ms
  // leave transition played out under the spinner — one frame of flat icon
  // that the 3D model then "jumped" away from.
  const known = key ? hasModelSync(key) : false;
  focus3dAvailable.value = known ?? (await hasModel(key!));
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
/**
 * What the panel PRINTS about the focused item: the badge row beside the name,
 * and the spec column under the stage controls.
 *
 * Narrower than focusAttachments, and deliberately so. The 3D stage is happy to
 * dress a free default with no attachments, but those two surfaces are not: a
 * default row has no name tag, nothing applied and no float, so standing it in
 * would render an empty spec column AND hide the dashed Float/Pattern pair at
 * the foot of the panel, which is the only reading a default slot has. So the
 * public row deputises for the missing instance exactly where it has something
 * to say — a crafted cell in someone else's loadout, which is where the stickers
 * and the charm the visitor came to see actually live.
 */
/**
 * The focused item, in the shape the price pipeline takes.
 *
 * Deliberately the SAME shape the craft form has rather than a second flavour
 * of "priceable": `quoteKeyOf` and `quoteCraft` then work on either without
 * knowing which screen they are serving, which is what makes the two show the
 * same reading. Null for a default finish — there is nothing to price.
 */
const focusPriceable = computed(() => {
  // Only while the focus SCREEN is up. `focusRow` answers for the selected slot
  // whatever view is showing, and quoting on every click around the loadout
  // grid would be a request per selection for a figure nothing is drawing.
  if (view.value !== "focus") return null;
  const row = focusRow.value;
  if (!row?.item || !isSkinned(row)) return null;
  const a = focusAttachments.value;
  return {
    skin: row.item as Skin,
    wear: row.wear ?? 0,
    seed: row.seed ?? 0,
    stattrak: !!row.stattrak,
    nametag: "",
    stickers: (a?.stickers ?? []) as (Attach | null)[],
    patches: (a?.patches ?? []) as (Attach | null)[],
    charm: (a?.charm ?? null) as Attach | null,
  };
});
/**
 * LANDING ON AN ITEM IS NOT A CHANGE TO ONE.
 *
 * The pipeline's own watcher fires on the quote KEY changing, which covers
 * editing but not arriving: open focus on a weapon nobody has touched and the
 * key was already what it is. `immediate` on that watcher would have been the
 * obvious fix and was the wrong one — it lives above `focusPriceable` in this
 * file, so running it at creation read a `const` in its temporal dead zone. The
 * throw was swallowed by Vue's watcher error handling, the effect never
 * finished registering its dependencies, and the price appeared only after
 * something ELSE it had managed to track changed — opening the editor and
 * coming back. Declared here instead, after the thing it reads.
 */
// The focus screen hands its item to the pipeline. Declared HERE, after the
// computed it reads — see the note on `focusSubject`.
watch(focusPriceable, (p) => (focusSubject.value = p), { immediate: true });
watch(
  // THE KEY, NOT THE OBJECT. `focusPriceable` builds a fresh object every time
  // it evaluates, so watching it fires on any tick that touches one of its
  // sources — and both schedulers begin by CLEARING their debounce timer.
  // Anything re-evaluating faster than the 400ms detail debounce therefore kept
  // pushing the request into the future and it never went out at all, which is
  // exactly what "the figure loads but the sale history never does" looks like.
  // The key is a string of the facts a price depends on: it changes when the
  // answer would change, and not otherwise.
  () => (focusPriceable.value ? quoteKeyOf(focusPriceable.value) : null),
  (k) => {
    priceLog("focus: key", k, craft.value ? "(editor open — it owns the pipeline)" : "");
    if (k === null || craft.value) return;
    scheduleQuote();
    scheduleDetail();
  },
  { immediate: true },
);
/**
 * The focus screen's price, as data — see ItemPrice.
 *
 * THE FIGURE COMES FIRST. The quote is a round trip and the slot's own value is
 * already in hand, so the line renders immediately with what is known and the
 * quote's extra readings (the spread, the volume, the float's standing) fill in
 * underneath when it lands. Waiting for the round trip meant an item screen
 * that showed no price at all until something happened to trigger one.
 */
const focusPrice = computed(() => {
  if (!pricesOn.value) return null;
  // Three sources, nearest first: the quote (the whole reading), the slot's
  // cached value, and the item's own market price. The last one is on the row
  // already — a deep link into focus has no slot values fetched yet, which is
  // how this screen managed to show no figure at all while the modal showed
  // one for the same weapon.
  const q = itemQuote.value;
  const total = q?.total ?? cellValue(selected.value) ?? focusInstance.value?.price?.value ?? null;
  if (total == null) return null;
  return {
    total,
    extra: q?.attachmentTotal,
    approx: !!q?.base.price?.approx,
    sales: itemSales.value,
    standing: itemWearStanding.value,
    tip: q ? itemQuoteTip.value : slotValueTip.value,
    busy: itemQuoting.value && !q,
  };
});
const focusSpecs = computed<AttachSource | null>(() =>
  focusInstance.value ?? (viewerId.value && isSkinned(focusRow.value) ? focusRow.value ?? null : null),
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
      // The spec panel floats over the pane's right edge; the viewer frames the
      // model around it rather than the pane giving up the width.
      frameInset: { right: focusPanelW.value },
      // Absent unless asked for, which is what keeps the item view the default.
      firstPerson:
        isWeapon && fpvOn.value
          ? {
              arms: fpvArms.value,
              action: "idle",
              armsPaint: fpvArmsPaint.value,
              sleeve: fpvSleeve.value,
            }
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
// What the suspend watcher above actually watches — assigned here because that
// watcher is declared before this ref exists. See `focusSubject` for the same
// trap and why reaching down the file is not an option in one long setup.
watch(loadout3d, (v) => (overlayOpen.value = !!v));
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
/**
 * The focus stage's MODE, watched as one thing.
 *
 * `focus3d` and `fpvOn` change together — the stage strip going 2D → HELD sets
 * both — and two watchers each calling `mount3d()` in the same flush is how a
 * host ends up with two canvases in it. One watcher, one mount.
 */
watch([focus3d, fpvOn], ([on, held], [was3d]) => {
  // Leaving first person puts the weapon back down.
  if (!held) fpvAction.value = "idle";
  if (!on) {
    // Only on the way OUT of 3D: toggling the hands while the flat art is up
    // has nothing mounted to tear down.
    if (was3d) teardownViewer();
    return;
  }
  void mount3d();
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
  // (the picker's own debounce is cleared by useAttachmentPicker, with the timer)
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
      // Their builds come along with their loadout. Swallowed on failure for the
      // same reason loadPresets swallows: a backend that predates presets 404s
      // here, and that has to read as "this deployment has none" rather than
      // stranding a visitor on the retry screen for a strip they never asked for.
      const [catalog, theirs, theirPresets] = await Promise.all([
        fetchCatalog(),
        fetchPlayerLoadout(viewerId.value),
        fetchPlayerPresets(viewerId.value).catch(() => []),
      ]);
      weapons.value = catalog.weapons;
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = theirs;
      inventory.value = [];
      presets.value = theirPresets;
      // Always the live build on arrival, even when the last profile you looked
      // at left a preset id sitting here — that id belongs to a different player.
      viewerPreset.value = null;
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
      presets.value = [];
      loadSkins(sheetKey.value);
    } else {
      const [catalog, current, inv] = await Promise.all([fetchCatalog(), fetchLoadout(), fetchInventory()]);
      weapons.value = catalog.weapons;
      catalogAgents.value = catalog.agents ?? [];
      specialDefaults.value = catalog.defaults ?? null;
      loadout.value = current;
      inventory.value = inv;
      // Status, THEN prices, and both after the rows they attach to — the whole
      // sequence spelled out because every shortcut here is a race: fired early
      // it merges onto an empty array, and fired in parallel it can run before
      // the status that decides whether to run at all. Not awaited, so the
      // screen is interactive while the numbers are still coming.
      void loadPriceStatus().then(() => loadPrices());
      loadSkins(sheetKey.value);
      queueLoadoutRenders();
      // Off to the side: the nag dot is the least important thing on screen and
      // must never hold up (or fail) the load it rides along with.
      void loadSteamSyncState();
      // Same treatment, same reason — the switcher naming the build you are
      // already looking at is not worth a slower first paint, and a backend
      // that has never heard of presets must still render a loadout.
      void loadPresets();
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
    } else if (presetCtx.value) {
      presetCtx.value = null;
      presetMenuFor.value = null;
      e.stopPropagation();
    } else if (presetDeck.value) {
      // The deck's rename input stops Escape itself (it abandons the edit); this
      // is the deck with no edit in flight, and Escape shuts it.
      closePresetDeck();
      e.stopPropagation();
    } else if (presetDraft.value != null) {
      // Escape ABANDONS the rename — commitPresetRename is the blur/Enter path,
      // and routing Escape through it would save the very edit you backed out
      // of. Below the menus because you can only ever be in one of the two.
      presetDraft.value = null;
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
// The sheet's "/"-shortcut target (see onGlobalKey). The inventory grid's own
// search box is a ref inside useInventoryView, with the rest of that screen.
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
  // Admin app load asks the panel where the invsim cvars stand — that answer is
  // what lights the gear badge before /admin is ever opened. Read-only: this
  // used to write three of the operator's server configs as a side effect.
  if (props.user?.role === "administrator") {
    fetchGameConfig()
      .then((state) => onGameConfig(state))
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

// ---- bulk delete (inventory view) ----

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
    <!-- Compact runs as TWO rows. It used to scroll sideways instead, on the
         measurement that wrapping cost a whole second row (95px, ~12% of an
         800px viewport) to show one stray button — but that was naive wrapping,
         where each control lands wherever it falls and the second row exists to
         catch an overflow rather than to hold anything. In use the sideways
         scroll was worse than the height it saved: a control you cannot see is
         one you do not know about, and the side/value/tools all competed for the
         same 376px.

         So the break is PLACED rather than left to overflow — see the spacer
         below. Row one is what you are looking at (side, preset, focus, value),
         row two is what you can do about it (tools, then the screen tabs). Two
         32px rows plus a 4px gap is ~68px against the scroller's 42px, so it
         costs ~26px, not 95. -->
    <header
      data-role="app-header"
      class="flex flex-none items-center border-b border-border"
      :class="isCompact ? 'flex-wrap gap-x-1.5 gap-y-1 px-2 py-1' : 'flex-wrap gap-3 px-6 py-3'"
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
        :class="isCompact ? 'order-1' : ''"
        :items="(['CT', 'T'] as Team[])"
        :item-key="(t) => t"
        :active="team"
        variant="solid"
        :solid-background="gradient"
        :button-class="`relative z-[1] flex h-7 items-center rounded-md font-bold uppercase tracking-widest transition-colors ${isCompact ? 'px-2.5 text-f13' : 'px-5 text-sm'}`"
        active-class="text-black"
        @select="(t) => switchTeam(t as Team)"
      />

      <!-- Preset switcher. Sits next to the side toggle because the two are the
           same kind of control — "which loadout am I looking at" — where Focus
           beside them is a view mode. Same PillTabs, `accent` variant: the CT/T
           pill is the solid one on purpose (it's a switch, not a filter) and a
           second solid strip next to it would read as two halves of one toggle.

           Shown to visitors too, read-only: someone else's page opens on the
           build they are wearing and lets you page through the rest. Only the
           STRIP crosses over — the cog beside it stays gated on canEdit, because
           rename/new/delete act on the account that owns the preset. -->
      <div
        v-if="showPresets && (view === 'grid' || view === 'focus')"
        class="flex flex-none items-center"
        :class="isCompact ? 'order-5 gap-1' : 'gap-1.5'"
      >
        <!-- Rename happens in place, where the name already is. The input
             REPLACES the strip rather than sitting under it: mid-rename the
             other pills would be switches that throw the edit away, and the
             header has no vertical room for a second row anyway. -->
        <input
          v-if="presetDraft !== null"
          ref="presetInputEl"
          v-model="presetDraft"
          maxlength="24"
          class="h-7 w-[9rem] rounded-lg border border-[color:var(--acc)] bg-muted px-2.5 text-f11 uppercase tracking-wider text-foreground outline-none"
          @keydown.enter.prevent="commitPresetRename"
          @blur="commitPresetRename"
        />
        <!-- ONE control, both breakpoints: the name of the build you are on.
             It used to be a strip of every preset plus a square ··· beside it
             on desktop, and with one preset (most people) that read as two
             unrelated buttons — "a LOADOUT 1 button, and a dots button" — for
             one thing and its menu. Now the name IS the button. What it opens
             differs by surface: compact gets the bottom sheet (switch list over
             the actions), desktop gets the deck — every build as a card, with
             the meter and the figure that tell builds apart, and the manage
             menu hanging off each card. See PresetDeck.vue. -->
        <button
          v-else
          ref="presetBtnEl"
          class="tac-action flex min-w-0 items-center gap-1.5 border border-border uppercase tracking-wider text-muted-foreground disabled:opacity-60"
          :class="[isCompact ? 'h-8 rounded-md px-2 text-f11' : 'h-9 rounded-lg px-3 text-f11 font-semibold', presetDeck && 'tac-on']"
          :disabled="presetBusy"
          :title="`${activePresetName} — ${isCompact ? 'tap' : 'click'} to switch or manage`"
          @click="isCompact ? (presetCtx = { x: $event.clientX, y: $event.clientY }) : togglePresetDeck()"
        >
          <Loader2 v-if="presetBusy" class="h-3.5 w-3.5 flex-none animate-spin" />
          <Layers v-else class="h-3.5 w-3.5 flex-none" />
          <span class="max-w-[9rem] truncate">{{ activePresetName }}</span>
          <ChevronDown class="h-3 w-3 flex-none opacity-60 transition-transform" :class="presetDeck && 'rotate-180'" />
        </button>
      </div>
      <button
        v-if="view === 'grid' || view === 'focus'"
        class="tac-action flex items-center gap-1.5 rounded-lg border text-f11 font-semibold uppercase tracking-wider"
        :class="[isCompact ? 'order-6 h-8 px-2' : 'h-9 px-3.5', view === 'focus' ? 'tac-on' : 'border-border text-muted-foreground']"
        :title="view === 'focus' ? 'Focused' : 'Focus'"
        @click="go(view === 'focus' ? '/' : '/focus')"
      >
        <!-- Icon-only on compact: the label costs ~54px of a ~376px header,
             and the crosshair plus its active accent already carry the state. -->
        <Crosshair class="h-3.5 w-3.5" />
        <!-- "Focus" → "Focused": the suffix slides open rather than appearing.
             It used to print one word or the other, so engaging focus grew the
             button by two letters with no transition and shoved the value chip
             beside it. The suffix sits in a one-column grid whose track goes
             0fr → 1fr (a width:auto you CAN transition), on the same 150ms the
             border and fill already take, and the button grows with it. The
             inner span needs min-w-0 or the track can't shrink below the text. -->
        <span v-if="!isCompact" class="flex">
          <span>Focus</span>
          <span
            class="grid"
            :style="{
              gridTemplateColumns: view === 'focus' ? '1fr' : '0fr',
              opacity: view === 'focus' ? 1 : 0,
              transition: 'grid-template-columns 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 150ms cubic-bezier(0.4, 0, 0.2, 1)',
            }"
            :aria-hidden="view !== 'focus'"
          ><span class="min-w-0 overflow-hidden">ed</span></span>
        </span>
      </button>
      <!-- The headline figure for whatever screen you're on: the side's loadout
           on the loadout screens, the whole collection on the inventory. ONE
           chip rather than two, so the two screens cannot drift apart — the
           label changes, the object doesn't.
           Not a button. It reads as a readout: a hairline rule, the value in
           the same tabular mono the floats use, and the "$" set back so the
           number leads. -->
      <!-- Pending: the chip's own outline with a pulsing dash inside it, so the
           number lands in a place the eye is already looking instead of shifting
           the header when it arrives. -->
      <!-- The order class goes on the PriceTag, NOT on the Tooltip around it.
           Tooltip renders its trigger `as-child`, so it contributes no element
           of its own and the flex item here is the PriceTag's root span. A class
           on the wrapper would have gone nowhere — and an unordered item defaults
           to order:0, which sorts BEFORE order-1, so the miss would have parked
           the value chip at the head of row one rather than simply doing nothing. -->
      <Tooltip v-if="pricesOn && (headerValue > 0 || pricesPending)" :text="headerValueTip">
        <PriceTag
          :class="isCompact ? 'items-center order-2' : 'items-center'"
          frame="spine"
          size="md"
          :label="isCompact ? null : headerValueLabel"
          :value="headerValue"
          :pending="pricesPending"
          suffix="est"
        />
      </Tooltip>

      <!-- The row break, and the only reason the compact header is two ROWS
           rather than however many the widths happen to produce. A full-width
           zero-height item in a wrapping flex row forces everything after it
           onto the next line, which is the one way to say "break HERE" without
           a second container and a duplicated child list.

           WHICH controls fall either side of it is set by `order` on compact,
           not by their position in this file. Reading order here is the desktop
           one, where a single row means source order is the only order; the
           phone wants the split by IMPORTANCE instead:

             row 1  side toggle · value ........ screen tabs
             row 2  presets · focus ............ tools

           Row one is the primary pair — which side, and which screen — with the
           side's value sitting against the toggle it belongs to, since the figure
           only means anything once you know which side it counts. Row two is
           everything you do to the place you have landed in.

           Ordering rather than moving the markup keeps one child list for both
           layouts. Two copies of a header this size is how the two drift, and
           the drift is always the thing only one of them got. -->
      <span v-if="isCompact" class="order-4 w-full" aria-hidden="true"></span>

      <!-- Utility actions sit LEFT of the tabs and are grouped tight, so the
           header reads as "tools | where you are" instead of three things
           floating at equal distance. All three controls are 36px tall (the
           pill is h-7 + p-1), so they share a baseline.

           ml-auto only on desktop. On compact these open row two, so pushing
           them right would strand them against the tabs and leave the row's
           whole left side empty — the tabs take the ml-auto there instead. -->
      <div class="flex items-center" :class="isCompact ? 'order-7 ml-auto gap-1.5' : 'ml-auto gap-3'">
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
          <!-- Money is a MODE, not a decoration: a dollar figure beside every
               gun changes what the screen is about, and plenty of people want
               the collection and not the appraisal. Sits beside Steam sync
               because both are account-level and both act on everything rather
               than on what a filter is showing. Absent entirely when the
               operator hasn't turned pricing on — a dead switch is worse than
               no switch. -->
          <Tooltip
            v-if="priceStatus?.ready"
            :text="showPrices
              ? `Hide estimated values (${PRICE_WINDOW_LABEL[priceStatus.window]}s — rough estimates, not sale prices)`
              : 'Show estimated values — rough market estimates, not sale prices'"
          >
            <!-- State by PRESENCE, not by hue: on, it is an ordinary action
                 button like sync and share beside it; off, it wears the disabled
                 look — dimmed border, faded glyph — so "values are hidden" reads
                 as the control being stood down rather than as a second accent
                 colour in a row that already has amber. -->
            <button
              class="relative grid place-items-center rounded-md border tac-action"
              :class="[
                isCompact ? 'h-8 w-8' : 'h-9 w-9',
                showPrices ? 'border-border text-foreground' : 'border-border/40 text-muted-foreground/40',
              ]"
              @click="togglePrices"
            >
              <CircleDollarSign class="h-3.5 w-3.5" />
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
      </div>

      <!-- The screen tabs are a HEADER child, not a member of the tools group.
           They lived inside it because on desktop that group is one right-hand
           cluster and nesting read as tidy. On compact it is wrong in a way that
           cannot be styled around: `order` sorts an element among its SIBLINGS,
           so an order on a tab strip nested one level down reshuffles it against
           the sync and share buttons and can never lift it out of their row.
           Flat here, the header orders all five groups against each other. -->
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
        :class="isCompact ? 'order-3 ml-auto' : ''"
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
      <InventoryScreen
        v-else-if="view === 'inventory'"
        key="inventory"
        :inv="invView"
        :inventory="inventory"
        :inv-sorts="invSorts"
        :prices-on="pricesOn"
        :prices-pending="pricesPending"
        :price-source-label="priceSourceLabel"
        :inventory-value-in-view="inventoryValueInView"
        :filtered-value-shown="filteredValueShown"
        :inv-value-tip="invValueTip"
        :value-by-origin="valueByOrigin"
        :attached-name="attachedName"
        @armory="openArmory"
        @detail="openDetail"
        @item-ctx="openItemCtx"
        @item-ctx-for="openItemCtxFor"
        @view3d="view3dForInstance"
        @inspect="openInspectLink"
        @edit="openEdit"
        @duplicate="openEdit"
        @remove="deleteOwned"
        @delete-selected="deleteSelected"
      />

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

        <!-- ============ LOADOUT GRID ============
             Both shapes of it — the desktop columns and the compact
             one-category rail — are components/LoadoutGrid.vue.
             Deliberately plain props rather than a composable: nothing the grid
             draws is its own state. Every fact comes off the loadout held here
             and every verb ends in a mutation or a route change, so the model
             goes in named and the prop list IS the audit of that coupling. -->
        <LoadoutGrid
          v-if="view === 'grid'"
          v-model:compact-cat="compactCat"
          :can-edit="canEdit"
          :team="team"
          :selected="selected"
          :compact-cats="compactCats"
          :compact-cells="compactCells"
          :compact-equipment="compactEquipment"
          :columns-view="columnsView"
          :cell-facts="cellFacts"
          :cell-actions="cellActions"
          :row-for="rowFor"
          :slot-title="slotTitle"
          :occupant-weapon="occupantWeapon"
          :occupant-model="occupantModel"
          :rarity-of="rarityOf"
          :preview-pos="previewPos"
          :drop-style="dropStyle"
          :reorder-style="reorderStyle"
          :pulse-pos="pulsePos"
          :select-pos="selectPos"
          :open-ctx="openCtx"
          :on-slot-drag-over="onSlotDragOver"
          :on-slot-drop="onSlotDrop"
          :on-cell-drag-start="onCellDragStart"
          :on-cell-drag-end="onCellDragEnd"
          :on-cell-drag-over="onCellDragOver"
          :on-cell-drag-leave="onCellDragLeave"
          :on-cell-drop="onCellDrop"
          :on-slot-pointer-down="onSlotPointerDown"
          :on-slot-pointer-move="onSlotPointerMove"
          :cancel-long-press="cancelLongPress"
          :on-slot-click-capture="onSlotClickCapture"
          :lift-intrusion="liftIntrusion"
          :lift-scroll-style="liftScrollStyle"
          @slot-drag-leave="slotDragLeave"
        />

        <!-- ============ FOCUS VIEW ============ -->
        <div v-else data-role="focus" class="animate-view-in flex flex-1 flex-col overflow-hidden" :class="isCompact ? 'p-2' : 'p-5'">
          <!-- FLEX, NOT A THREE-ROW GRID. The grid's rows were header / stage /
               footer back when this file laid those out itself; ItemScreen owns
               that stack now and went into the FIRST row — the `auto` one — so
               the card sized it to its content and left the `1fr` row empty
               underneath. The model sat in the top half of a card with a third
               of its height unused below it. -->
          <div
            class="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card"
            :class="isCompact ? 'px-4 py-4' : 'px-8 py-6'"
          >
            <span
              class="pointer-events-none absolute inset-0"
              :style="rarityOf(selected) ? { background: `radial-gradient(56% 66% at 50% 44%, ${rarityOf(selected)}, transparent 62%)`, filter: 'blur(30px)', opacity: 0.5 } : {}"
            ></span>
            <!-- ONE SCREEN. The identity, the actions, the stage and the row
                 under it are ordered by ItemScreen rather than by this file —
                 the item modal mounts the same one, so the two cannot drift
                 into looking like different screens again. -->
            <ItemScreen :held="fpvOn && focus3d" @panel-width="(w) => (focusPanelW = w)" :identity="{ slotLabel: focusSlotLabel, weapon: sheetWeaponName, finish: isSkinned(focusRow) ? stripName(focusRow!.item!.name) : '— default finish —', price: focusPrice }">
              <template #actions>
                <!-- The same three controls the modal carries, in the same
                     order. Focus had no settings cog at all for a while, which
                     meant lighting, bloom and motion were unreachable on the
                     screen you land on to look at a weapon. -->
                <ViewerSettingsButton v-if="focus3d" v-model:open="devHudOpen" :changed="devFlagCount" />
                <StageTabs v-if="focus3dAvailable" :is3d="focus3d" list-class="h-8" @update:is3d="setFocus3d" />
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
              </template>
            <!-- THE STAGE, the same component the item modal mounts. See
                 ItemStage: the backdrop, the 2D/3D switch, the held toggle, the
                 control bar and the corner links all live in there now, which
                 is what makes these two screens one picture of an item instead
                 of two. -->
            <ItemStage
              ref="focusStageCmp"
              :available="focus3dAvailable"
              :is3d="focus3d"
              :held="fpvOn"
              :held-available="fpvAvailable"
              :busy="focusViewer.busy.value"
              :rarity="rarityOf(selected)"
              :fullscreen="focusStage.fullscreen.value"
              :stage-keys="focusStage.keys.value"
              :inspect="focusInspect.read"
              :report-href="focusReportHref"
              can-save
              bleed
              class="min-h-0 flex-1"
              :class="isCompact ? '-mx-4 -mb-4' : '-mx-8 -mb-6'"
              @update:is3d="setFocus3d"
              @update:held="(v) => (fpvOn = v)"
              @inspect-play="focusInspect.play"
              @inspect-seek="focusInspect.seek"
              @save="downloadStageImage(focusViewer, itemName(focusRow?.item) || 'item')"
            >
              <template #flat>
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
                  <div :key="selected" class="grid h-full w-full min-h-0 place-items-center">
                    <ItemArt
                      :inst="isSpecial(selected) ? null : cellInstance(selected)"
                      :image="isSpecial(selected) ? focusRow?.item?.image : cellImage(selected)"
                      :class="cn('w-[min(64%,520px)] object-contain animate-float motion-reduce:animate-none', !isSkinned(focusRow) && 'opacity-50')"
                      style="filter: drop-shadow(0 22px 30px rgba(0,0,0,0.55))"
                    />
                    <!-- A second grid row under the art, and only for a music kit.
                         This stage has no 3D for one (isNo3d), so the flat icon was
                         the entire focus view of an item whose whole content is a
                         sound. Wider than the tile's copy because there is room:
                         this is the screen you land on to study one item. -->
                    <MusicPlayer
                      v-if="focusRow?.item?.audio"
                      :src="focusRow.item.audio"
                      class="w-[min(80%,420px)]"
                    />
                  </div>
                </Transition>
              </template>
              <!-- The item's facts, floating over the stage rather than taking
                   a column beside it — see ItemStage. Desktop only: on compact
                   the pane is barely wider than the panel would be, and the
                   readings are printed under the stage there instead.
                   `still`: this panel does not animate in, the view does. -->
            </ItemStage>
            <template v-if="focusSpecs && !isCompact" #panel>
              <ItemSpecs :inst="focusSpecs" still />
            </template>
            </ItemScreen>

            <!-- Compact only, now that the actions have gone: on desktop the
                 float and the pattern live in the details panel, so this row had
                 nothing left in it but its own top border and 14px of padding
                 taken off the model. -->
            <div
              v-if="isCompact || !focusSpecs"
              class="relative z-[2] flex flex-wrap items-center gap-6 border-t border-border pt-3.5"
            >
              <!-- Float and pattern used to be spelled out here by hand, and
                   after the spec column landed they were being printed TWICE,
                   three inches apart. They live in that column now, with
                   everything else about the item. Compact keeps them: the column
                   is desktop-only, so on a phone this is the only place a float
                   appears at all.
                   Hidden, not dashed out, for the types that have no such
                   reading: a spray has no float and no pattern, and "—" under a
                   Float heading still says the item HAS one and we don't know
                   it. -->
              <!-- Keyed to the same source as the spec column, not to the owned
                   instance: viewing someone else's crafted slot now fills that
                   column from the public row, and a `!focusInstance` guard here
                   printed the float and the pattern a second time three inches
                   away. -->
              <template v-if="isCompact || !focusSpecs">
                <div v-if="hasWear(focusRow?.item)" class="flex flex-col gap-1">
                  <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">Float</span>
                  <span class="font-mono text-f13">{{ focusRow?.wear != null ? focusRow.wear.toFixed(4) : '—' }}</span>
                  <!-- WearBar is THE way wear renders — bare drops its numbers,
                       since "Float" above already prints the value. -->
                  <WearBar v-if="focusRow?.wear != null" :item="focusRow?.item" :wear="focusRow.wear" bare class="mt-1.5 w-[180px]" />
                </div>
                <div v-if="hasSeed(focusRow?.item)" class="flex flex-col gap-1">
                  <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">Pattern</span>
                  <span class="font-mono text-f13">{{ focusRow?.seed != null ? '#' + focusRow.seed : '—' }}</span>
                </div>
              </template>
              <!-- StatTrak and Unequip used to sit here. They are edits, and
                   this screen is for LOOKING — the item modal owns both, one
                   click away, and the row they were holding open is height the
                   model now gets. -->
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
            <!-- invSorts (HEAD's list — drops Value when there is no
                 feed) crossed with needsOwnedItem (the predicate that knows wear
                 and recent are meaningless over a catalog). Two different reasons
                 a mode can be unavailable, and both still apply. -->
            <FilterDropdown
              :model-value="sheetSort"
              prefix="Sort"
              :options="invSorts.map((s) => ({ value: s[0], label: s[1], disabled: needsOwnedItem(s[0]) && sheetMode === 'craft' }))"
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
                    :disabled="needsOwnedItem(s[0]) && sheetMode === 'craft'"
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
                :show-price="pricesOn"
                :price-pending="pricesPending"
                :price-source="priceSourceLabel"
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
                  <!-- Top left, in the flow above the art — the same corner an
                       owned card puts it in, under the model label. The craft
                       card has no model label to sit under (its name is at the
                       bottom), but the POSITION is what people have learned, and
                       a price that moves between two grids of the same shape is
                       a price you have to hunt for. -->
                  <PriceTag
                    v-if="pricesOn"
                    class="absolute left-2.5 top-2 z-[3]"
                    size="xs"
                    :value="stockPriceOf(st.card.id)?.value"
                    :missing="!stockPriceOf(st.card.id)"
                    :title="stockPriceTip(st.card.id)"
                  />
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
                  <!-- THE screen this feature is for: this is the grid you pick
                       a music kit from, and until now every card on it was a
                       name and a disc. The player is a <span> tree precisely so
                       it can live inside this <button> — see MusicPlayer. -->
                  <MusicPlayer v-if="st.card.audio" :src="st.card.audio" class="relative z-[2] mt-1.5" />
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
                <span v-if="i.stattrak" class="flex-none font-mono text-f8 text-[hsl(var(--tac-stattrak))]">ST™</span>
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
      @game-config="onGameConfig"
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
      :class="isCompact || !viewOnly ? 'p-0' : 'p-4'"
      @click.self="picker ? (picker = null) : closeCraft()"
    >
      <!-- EDITING FILLS THE SCREEN; VIEWING IS A CARD.
           They are different acts. Looking at an item is a glance at one thing,
           and a card floating over your inventory says so — the grid behind it
           is where you came from and where you are going back to. Editing is
           work: five sticker wells, a charm, wear and pattern, all aimed at a
           model you are dragging things onto, and every pixel the card spent on
           being a layer came out of that model. So edit takes the whole
           viewport and drops the rounding, the border and the inset with it. -->
      <div
        class="relative flex flex-col overflow-hidden bg-card shadow-2xl animate-pop-in"
        :class="isCompact || !viewOnly
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
            <!-- No name here. The identity block below carries it at full size,
                 the same one the focus view uses, and printing it twice on one
                 screen is how the two started looking different in the first
                 place. What stays is what appears nowhere else: where this item
                 came from, and where it is equipped. -->
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
          <!-- THE SAME SCREEN THE FOCUS VIEW IS. Identity, actions, stage,
               footer — in that order, decided by ItemScreen rather than here,
               which is the only way two surfaces stay one surface. -->
          <ItemScreen class="min-w-[220px]" :held="craftHeld && modal3d" @panel-width="(w) => (craftPanelW = w)" :identity="{ weapon: craftWeaponLabel ?? (craft.skin.name.includes(' | ') ? craft.skin.name.split(' | ')[0] : craft.skin.name), finish: stripName(craft.skin.name), price: pricesOn && itemQuote ? { total: itemQuote.total, extra: itemQuote.attachmentTotal, approx: !!itemQuote.base.price?.approx, sales: itemSales, standing: itemWearStanding, tip: itemQuoteTip, busy: itemQuoting } : null }">
            <template #actions>
            <!-- Settings, then which picture, then what you can do with the
                 item — broadest question first. Both screens carry the same
                 three; only the third differs, because only editing has a form
                 to put its buttons in. -->
            <ViewerSettingsButton v-if="modal3d" v-model:open="devHudOpen" :changed="devFlagCount" />
            <StageTabs v-if="modal3dAvailable" :is3d="modal3d" @update:is3d="(v) => (modal3d = v)" />
            <!-- VIEWING keeps these here; EDITING moves them to the top of the
                 form — see CraftActions. -->
            <CraftActions
              v-if="viewOnly"
              :view-only="viewOnly"
              :can-inspect="canInspect(craft?.skin) || canInspect(craftInst?.item)"
              :link-opening="linkOpening"
              :share-links="craftShareLinks"
              :share-note="route.name === 'draft' ? undefined : ITEM_LINK_NOTE"
              :can-edit-item="canEdit && !!craftInst && isCustomizable(craftInst.item)"
              :read-only="!!craftInst && isReadOnly(craftInst)"
              :can-delete="!!craftInst && canEdit"
              :compact-btn-class="MODAL_HEAD_BTN"
              @inspect="viewOnly && craftInstId != null ? openInspectLink(craftInstId) : openCraftInspect()"
              @edit="craftViewEdit"
              @delete="deleteOwned(craftInst!, closeCraft)"
              @reset="resetCraft"
            />
            </template>
            <!-- THE STAGE — the same component the focus view mounts. What used
                 to be ~230 lines of pane here is now the shared one; only the
                 things that belong to CRAFTING stayed behind, in slots.

                 The control bar moved INSIDE the pane with it, which retires the
                 copy this file used to keep for fullscreen: a fullscreen element
                 paints only itself and its descendants, so a bar living outside
                 the pane simply is not on screen while the pane is full, and the
                 fix for that was a second bar. One bar, in the pane, is on
                 screen in both. -->
            <ItemStage
              ref="craftStageCmp"
              :available="modal3dAvailable"
              :is3d="modal3d"
              :held="craftHeld"
              :held-available="craftHeldAvailable"
              :busy="modalViewer.busy.value"
              :rarity="craft.skin.rarity"
              :fullscreen="craftStage.fullscreen.value"
              :stage-keys="craftStage.keys.value"
              :edit="!viewOnly"
              :rotate="craft.stickers.some(Boolean)"
              :inspect="viewOnly ? craftInspect.read : null"
              :report-href="craftReportHref"
              :can-save="viewOnly"
              :bleed="viewOnly"
              :class="viewOnly ? (isCompact ? '-mx-2 -mb-2' : '-mx-5 -mb-5') : ''"
              @update:is3d="(v) => (modal3d = v)"
              @update:held="(v) => (craftHeld = v)"
              @inspect-play="craftInspect.play"
              @inspect-seek="craftInspect.seek"
              @save="downloadStageImage(modalViewer, itemName(craft.skin) || 'item')"
            >
              <template #flat>
                <!-- The waist feather belongs to the ICON, which is cropped at
                       the waist. A rendered agent is a whole standing figure, so
                       the same mask takes its legs instead. -->
                  <img
                    :src="craftPreview ?? craft.skin.image ?? undefined"
                    alt=""
                    class="max-h-full max-w-full object-contain drop-shadow-[0_28px_30px_rgba(0,0,0,0.45)]"
                    :class="craftIsAgent && !craftPreviewRendered && ART_FADE_B"
                    @error="craftPreviewFailed"
                  />
                <span v-if="craftPreviewBusy && !modal3d" class="animate-sheen pointer-events-none absolute inset-0 z-[3]"></span>
                <span
                  v-if="craftPreviewBusy && !modal3d"
                  class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
                ><Loader2 class="h-3 w-3 animate-spin" /> rendering</span>
              </template>
              <!-- Viewing: the item's facts float over the model, the same way
                   the focus view shows them. EDITING keeps its column beside the
                   stage instead — the form is tall, it is what you are working
                   in, and parking it over the model would cover the surface you
                   are dragging stickers onto. -->
              <template #chrome>
                <!-- Click-away for the developer panel, the same idiom
                     FilterDropdown and ShareMenu use. `absolute inset-0`, not
                     `fixed`: a fixed element in this plugin resolves against the
                     nearest TRANSFORMED ancestor rather than the viewport, and
                     the host panel has several. The pane is the right scope
                     anyway. It lives here rather than beside the cog because
                     this slot is a direct child of the pane — inset-0 in the
                     control ROW would only cover the row.

                     UNDER the cog (z-[4] vs the row's own stacking) so the cog
                     stays live and its button toggles the panel shut, and OVER
                     the pose pills so the first click anywhere else dismisses. -->
                <div v-if="modal3d && devHudOpen" class="absolute inset-0 z-[4]" @click="devHudOpen = false"></div>
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
                <!-- Live cost, stacked under the 2D/3D + cog row so it reads as part
                     of the same top-left column of chrome — the same corner the
                     inventory card puts it in, under the model label. It was up in
                     the modal header competing with the item's name and the action
                     buttons; here it sits beside the thing it is a fact about, with
                     room for the label to say "est." out loud.
                     Falls back to `top-0` when there is no 2D/3D toggle to sit
                     beneath (items with no 3D model) rather than hanging in a gap. -->
              </template>
            </ItemStage>
            <template v-if="viewOnly && !isCompact" #panel>
              <ItemSpecs :inst="craftInst" :charm-albedo="charmAlbedo" :charm-loading="charmRailLoading" />
            </template>
            <template #footer>
            <!-- Compact stacks the readings under the model. The floating panel
                 is a desktop affordance: at phone width it would be the whole
                 pane, i.e. a spec sheet with a gun behind it. -->
            <div v-if="viewOnly && isCompact" class="flex w-full flex-col gap-2.5">
              <ItemSpecs :inst="craftInst" :charm-albedo="charmAlbedo" :charm-loading="charmRailLoading" />
            </div>

            </template>
          </ItemScreen>
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
            v-if="craftHasOptions && !viewOnly"
            class="flex w-full flex-none flex-col gap-2.5"
            :class="[{ 'sheet-settled': craftSettled }, !isCompact && 'max-w-[300px]']"
          >
            <!-- Inspect, share and reset, at the top of the form rather than in
                 the screen's actions row — see CraftActions. Editing is work
                 done in this column, and Reset in particular is about the form
                 and not about the item. -->
            <CraftActions
              :view-only="viewOnly"
              :can-inspect="canInspect(craft?.skin) || canInspect(craftInst?.item)"
              :link-opening="linkOpening"
              :share-links="craftShareLinks"
              :share-note="route.name === 'draft' ? undefined : ITEM_LINK_NOTE"
              :compact-btn-class="MODAL_HEAD_BTN"
              class="flex-wrap"
              @inspect="openCraftInspect()"
              @reset="resetCraft"
            />
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
              <span class="text-f10 uppercase tracking-cs1" :class="craft.stattrak ? 'text-[hsl(var(--tac-stattrak))]' : 'text-muted-foreground'">StatTrak™</span>
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
    <!-- v-if HERE, not only on the component's own root: <Transition> drives
         enter/leave off its child mounting and unmounting, and a component that
         is always mounted with the v-if inside it would toggle the panel with
         no fade at all. -->
    <AttachmentPicker v-if="picker" :view="pickerView" @pick="pickAttachment" @preview="openPreview3d" />
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

    <!-- Preset menu. The same ContextMenu as the two above rather than a bespoke
         dropdown — on a phone it becomes a bottom sheet with touch-sized rows,
         which a popover anchored to a 32px header button never would.

         On compact it also does the SWITCHING, because there is no pill strip
         there to do it — the header collapses to one button, and a control that
         opened a menu with everything except the thing you most wanted would be
         worse than the strip it replaced. Desktop keeps the strip, so listing
         the same builds here would be two ways to do one thing a centimetre
         apart. -->
    <ContextMenu :at="presetCtx" @close="presetCtx = null; presetMenuFor = null">
      <template #title>{{ presetMenuTarget?.name ?? activePresetName }}</template>
      <template v-if="isCompact">
        <button
          v-for="p in presets"
          :key="p.id"
          :class="[MENU_ROW, p.id === shownPresetId && 'text-foreground']"
          :disabled="presetBusy"
          @click="presetCtx = null; switchPreset(p.id)"
        >
          <!-- The tick holds its column on every row, so the names line up and
               the list reads as a set with one chosen rather than as one odd row
               indented past the others. -->
          <Check class="h-3.5 w-3.5 flex-none" :class="p.id === shownPresetId ? '' : 'opacity-0'" />
          <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
          <span class="flex-none font-mono text-f9 text-muted-foreground/50">{{ p.slots }}</span>
        </button>
      </template>
      <!-- MANAGING is owner-only, switching is not.
           These four used to need no guard: the only way in was the cog, and the
           cog was already gated on canEdit. Compact changed that — its collapsed
           button opens this menu for anyone, because a visitor has to be able to
           page through someone's builds — so the gate has to move here, onto the
           rows that write. Without it a stranger gets Rename and Delete on an
           account that is not theirs, one tap from a header that only ever
           advertised itself as a view. -->
      <!-- The row handlers read presetMenuTarget BEFORE clearing presetMenuFor —
           the action is synchronous up to the point it captures its target, so
           the order in each handler is load-bearing. -->
      <template v-if="canEdit">
      <button :class="[MENU_ROW, isCompact && 'border-t border-border']" @click="presetCtx = null; startPresetRename(); presetMenuFor = null">
        <Pencil class="h-3.5 w-3.5" /> Rename…
      </button>
      <!-- Creation rows are COMPACT only. On desktop this menu is raised from a
           deck card and is about that card; making a new build is the deck's
           own footer and dashed card, where it is about the set. -->
      <!-- Duplicate leads over "new empty": rebuilding 15 craft-gated slots by
           hand is the whole reason this feature exists, so the row that starts
           you from what you're already wearing is the one people want. -->
      <template v-if="isCompact">
      <button
        v-if="!presetsFull"
        :class="[MENU_ROW, 'border-t border-border']"
        @click="presetCtx = null; newPreset(true)"
      >
        <Copy class="h-3.5 w-3.5" /> Duplicate this loadout
      </button>
      <button v-if="!presetsFull" :class="MENU_ROW" @click="presetCtx = null; newPreset(false)">
        <Plus class="h-3.5 w-3.5" /> New empty loadout
      </button>
      <!-- Deliberately NOT a MENU_ROW: it is a sentence, not an action, and
           MENU_ROW's hover highlight would promise it does something. -->
      <div v-else class="border-t border-border px-3 py-2 text-f11 leading-relaxed text-muted-foreground">
        {{ PRESET_LIMIT }} loadouts is the limit — delete one to make room.
      </div>
      </template>
      <!-- Hidden, not disabled, at one preset: there is no state in which it
           becomes available without first creating another, so a dead row here
           would only ever be furniture. -->
      <button
        v-if="presets.length > 1"
        :class="[MENU_ROW, 'border-t border-border text-muted-foreground hover:!text-[#ff7a6a]']"
        @click="presetCtx = null; askDeletePreset(); presetMenuFor = null"
      >
        <Trash2 class="h-3.5 w-3.5" /> Delete this loadout
      </button>
      </template>
    </ContextMenu>

    <!-- The desktop switcher's open state; see PresetDeck.vue. Sits UNDER the
         context menu (Z.deck < Z.menu) because its cards raise that menu. -->
    <PresetDeck
      v-if="!isCompact"
      :at="presetDeck"
      :presets="presets"
      :shown-id="shownPresetId"
      :team="team"
      :can-edit="canEdit"
      :busy="presetBusy"
      :limit="PRESET_LIMIT"
      :renaming="presetRenaming"
      :value-for="presetValue"
      :guns-for="presetGuns"
      :preview-for="presetPreview"
      :prices-on="pricesOn"
      @close="closePresetDeck"
      @switch="(id) => { closePresetDeck(); void switchPreset(id); }"
      @menu="openPresetCardMenu"
      @rename="commitDeckRename"
      @rename-cancel="presetRenaming = null"
      @duplicate="closePresetDeck(); void newPreset(true)"
      @create="closePresetDeck(); void newPreset(false)"
    />
  </div>
  </div>
  </div>
</template>
