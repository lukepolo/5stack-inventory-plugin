// Everything the INVENTORY grid is: its filters, its sort, its colour-deck
// drill-in, its render window and its bulk-selection mode.
//
// Lifted verbatim out of App.vue when that screen became InventoryScreen.vue.
// A composable rather than props because the state has two owners: the screen
// draws it, and App.vue mirrors five of these refs into the URL (see viewQuery
// and the query → state watchers there — the URL stays the single source of
// truth, and nothing here assigns a route). Prop-drilling ~40 bindings through
// a component boundary just so App could keep writing to them would have made
// the seam worse than the file it came out of.
//
// What is NOT here: money (App owns the price feed), the actions a card offers
// (open, edit, inspect, delete — all App's, reached by emit) and the sort list
// itself (`invSorts`, shared with the loadout sheet).
import { computed, ref, watch, type Ref } from "vue";
import type { CatalogWeapon, InventoryItem } from "../api";
import { scrollFade } from "../dom";
import { CARD_CHROME_PX, itemName, rarityName, rarityRank, stripName } from "../itemVisuals";
import { stackByDesign, TINT_SUFFIX, type Stack } from "../decks";
import {
  categoryOf,
  GEAR_TYPES,
  matchesOrigin,
  prettyModel,
  WEAPON_GROUPS,
  WEAPONISH,
  type OriginFilter,
} from "../loadoutModel";
import { DEFAULT_SORT, SORT_DIR_HINT, SORT_DIR_KIND, SORT_NATURAL, type SortMode } from "../sortModes";
import type { SortDir } from "../sortIcons";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { usePersistedNumber } from "./usePersistedRef";
import { useRenderWindow, WINDOW_FIRST } from "./useRenderWindow";
import { useSortControl } from "./useSortControl";

export interface InventoryViewOptions {
  /** Every owned row. The screen never fetches — App owns the list. */
  inventory: Ref<InventoryItem[]>;
  /** The catalog, for the rail's vanilla silhouettes and proper model names. */
  weapons: Ref<CatalogWeapon[]>;
  /** tintName -> colour for a deck's fanned layers. See `tintColors` in App.vue. */
  tintColors: Ref<Map<string, string>>;
  /** App's `sortInstances` — the one comparator table both grids sort through. */
  sort: (list: InventoryItem[], mode: SortMode, dir: SortDir) => InventoryItem[];
}

export function useInventoryView(opts: InventoryViewOptions) {
  const { inventory, weapons, tintColors } = opts;

  // scrollFade (the ordinary "more below" cue) lives in dom.ts.
  const invFade = scrollFade();

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

  // One of the three useSortControls in the app (this, the loadout sheet, the
  // attachment picker). Sort direction is shown, never implied — an unlabelled
  // "Sort · Rarity" doesn't say which end it starts from, and for wear the two
  // ends mean opposite things (a factory-new hunt vs a battle-scarred one).
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

  const filteredInventory = computed(() => {
    const q = invSearchApplied.value.trim().toLowerCase();
    return opts.sort(
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
  const inventoryStacks = computed<Stack<InventoryItem>[]>(() =>
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
  // with selectMode, below.)
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

  const cardSize = usePersistedNumber("cs2inv.cardSize", 164);
  // Resizing the cards re-flows the grid, so the "more below" cue has to re-measure.
  watch(cardSize, () => invFade.remeasure());
  const invGridStyle = computed(() => ({
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`,
    gridAutoRows: `${cardSize.value + CARD_CHROME_PX}px`,
  }));

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

  /** The "/"-shortcut target while the inventory is on screen (see onGlobalKey). */
  const invSearchEl = ref<HTMLInputElement | null>(null);

  // ---- bulk select/delete -----------------------------------------------------
  const selectMode = ref(false);
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

  return {
    invFade,
    invSearchCtl,
    invSearch,
    invSearchApplied,
    invSearchEl,
    invOrigin,
    invRarity,
    invRarityFacets,
    invSort,
    invDir,
    setInvSort,
    invSortKind,
    invSortHint,
    invModels,
    invTypes,
    toggleModel,
    toggleType,
    invRail,
    invRailShown,
    resetInvFilters,
    filtersActive,
    invFilterCount,
    invFiltersOpen,
    filteredInventory,
    invDesign,
    invDesignName,
    inventoryStacks,
    invFilterSig,
    inventoryWindow,
    cardSize,
    invGridStyle,
    invCellDelay,
    selectMode,
    selectedIds,
    toggleSelected,
    exitSelectMode,
    allVisibleSelected,
    toggleSelectAllVisible,
  };
}

/** What `useInventoryView` hands back — the prop InventoryScreen.vue takes. */
export type InventoryView = ReturnType<typeof useInventoryView>;
