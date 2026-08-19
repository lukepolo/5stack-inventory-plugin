// Sticker/charm/patch picker. Searched, FACETED and paged server-side: stickers and
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
//
// Lifted verbatim out of App.vue when the picker became AttachmentPicker.vue.
// It stays a composable rather than component-local state because `picker` is
// read all over App: the Escape chain unwinds through it, the craft modal's
// backdrop click closes back to the editor rather than throwing the craft away,
// the deep-link reader opens it, and the 3D editor checks it before mounting.
// What is NOT here is what happens when you PICK one — that writes into the
// craft draft, which App owns, so it comes back as an emit.
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  searchAttachments,
  type AttachFacet,
  type InventoryItem,
  type Skin,
} from "../api";
import { scrollPanelToTop } from "../dom";
import { itemName, rarityName } from "../itemVisuals";
import {
  ATTACH_DIR_HINT,
  ATTACH_SORT_KIND,
  ATTACH_SORT_NATURAL,
  byName,
  DEFAULT_ATTACH_SORT,
  sortRarityRank,
  type AttachSortMode,
} from "../sortModes";
import type { FacetAxis } from "../components/CatalogFilters.vue";
import { SEARCH_DEBOUNCE_MS } from "./useDebouncedSearch";
import { usePersistedNumber } from "./usePersistedRef";
import { useSortControl } from "./useSortControl";

export const PICKER_PAGE = 120;

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

/** cs2-lib calls a charm a keychain; the picker calls it a charm. */
const PICKER_TYPE: Record<string, string> = { sticker: "sticker", patch: "patch", charm: "keychain" };

/**
 * One row shape for both shelves, so the grid renders one loop.
 *
 * `inst` is what separates them: a catalog row has none and gets minted on save,
 * an owned row carries the instance and links to it.
 */
export type PickerRow = {
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

export interface AttachmentPickerOptions {
  /** Every owned row — the "Owned" shelf is answered from memory, never fetched. */
  inventory: Ref<InventoryItem[]>;
  /** App's `attachedName`: what an owned attachment is already stuck to. */
  attachedName: (inst?: InventoryItem | null) => string | null;
  /** App's notification funnel (useI18n) — a failed search is a toast, not a throw. */
  fail: (e: unknown) => void;
}

export function useAttachmentPicker(opts: AttachmentPickerOptions) {
  const { inventory, attachedName } = opts;

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
      opts.fail(e);
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
  // A debounced search that outlives the component fires into a torn-down setup
  // and writes to refs nothing reads. App used to clear this alongside its own
  // timers; it travels with the timer now.
  onBeforeUnmount(() => clearTimeout(pickerTimer));
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

  return {
    picker,
    openPicker,
    pickerSource,
    pickerQuery,
    pickerGroup,
    pickerCollection,
    pickerRarity,
    pickerSort,
    pickerDir,
    setPickerSort,
    setPickerDir,
    pickerSortKind,
    pickerSortHint,
    pickerTabs,
    pickerAxes,
    pickerDefaultGroup,
    setPickerFacet,
    clearPickerFacets,
    pickerScrollEl,
    pickerLoading,
    pickerLoadingMore,
    pickerDone,
    pickerMore,
    pickerResults,
    pickerTotal,
    pickerRows,
    pickerOwned,
    pickerNoun,
    attachCardSize,
    attachGridStyle,
  };
}

/** What `useAttachmentPicker` hands back — the prop AttachmentPicker.vue takes. */
export type AttachmentPickerView = ReturnType<typeof useAttachmentPicker>;
