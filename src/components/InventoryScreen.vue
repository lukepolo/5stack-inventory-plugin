<script setup lang="ts">
// THE INVENTORY — the drawer of everything you own, and the second of the
// plugin's four screens.
//
// Extracted from App.vue the same way Armory.vue and AdminConsole.vue were. The
// split is deliberately lopsided: the FILTER state went to a composable
// (useInventoryView) rather than into props, because App.vue still has to mirror
// five of those refs into the URL — the URL is the single source of truth for
// which screen you are on AND for what the grid is filtered to, and a screen
// that owned its filters privately could not honour a shared link.
//
// What arrives as props is what the inventory does not own: the rows themselves,
// the money (App holds the price feed), and the ambient tooltip/label helpers.
// What leaves as an emit is every verb a card offers — opening, editing,
// inspecting, deleting — because each of those ends in a route change or a
// mutation, and both belong to App.
import { computed } from "vue";
import { cn } from "@5stack/ui";
import {
  Check,
  CheckSquare,
  ChevronLeft,
  Hammer,
  LayoutGrid,
  Package,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-vue-next";
import { formatPrice, type InventoryItem } from "../api";
import { TINT_SUFFIX } from "../decks";
import { accentSoft, CARD_CHROME_PX, itemName, selRing } from "../itemVisuals";
import { ORIGIN_FILTERS, type OriginFilter } from "../loadoutModel";
import { isCompact } from "../responsive";
import type { SortMode } from "../sortModes";
import type { InventoryView } from "../composables/useInventoryView";
import DeckCard from "./DeckCard.vue";
import FilterDropdown from "./FilterDropdown.vue";
import FilterSheet from "./FilterSheet.vue";
import InfiniteSentinel from "./InfiniteSentinel.vue";
import ItemTile from "./ItemTile.vue";
import PillTabs from "./PillTabs.vue";
import PriceTag from "./PriceTag.vue";
import SortDirection from "./SortDirection.vue";
import Tooltip from "./Tooltip.vue";

const props = defineProps<{
  /** The screen's own state, created once in App.vue. See useInventoryView. */
  inv: InventoryView;
  /** Every owned row, unfiltered — the empty state and the "12/153" counter
   *  both need the total, which no filtered list can supply. */
  inventory: InventoryItem[];
  /** The sort list this session offers — shared with the loadout sheet, so it
   *  stays App's (it drops "Value" when the operator has no price feed). */
  invSorts: [SortMode, string][];
  pricesOn: boolean;
  pricesPending: boolean;
  priceSourceLabel: string;
  /** Money, all of it App's: it owns the feed and the tooltip that keeps the
   *  figure honest about how many rows it could actually price. */
  inventoryValueInView: number;
  filteredValueShown: boolean;
  invValueTip: string;
  valueByOrigin: Record<OriginFilter, number>;
  /** "on the AK-47 | Redline" for a sticker/charm that is applied to something. */
  attachedName: (inst?: InventoryItem | null) => string | null;
}>();

defineEmits<{
  (e: "armory"): void;
  (e: "detail", inst: InventoryItem): void;
  (e: "item-ctx", inst: InventoryItem, ev: MouseEvent): void;
  (e: "item-ctx-for", inst: InventoryItem): void;
  (e: "view3d", inst: InventoryItem): void;
  (e: "inspect", id: number): void;
  (e: "edit", inst: InventoryItem): void;
  (e: "duplicate", inst: InventoryItem): void;
  (e: "remove", inst: InventoryItem): void;
  (e: "delete-selected"): void;
}>();

// Destructured so the template reads exactly as it did inside App.vue — a ref
// nested inside an object is not auto-unwrapped in a template, only a top-level
// binding is. The object identity never changes, so this is safe to take once.
const {
  invFade,
  invSearch,
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
} = props.inv;

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
</script>

<template>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
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
              @click="$emit('delete-selected')"
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
          <!-- Only when a filter actually narrows the view. The full total lives
               in the header now, so repeating it here would be two identical
               numbers a few pixels apart; what this adds is "…and the twelve on
               screen are worth this much". Bordered rather than bare mono, because
               beside the item count in the same weight and colour it read as more
               of the counter instead of a different fact. -->
          <Tooltip v-if="pricesOn && filteredValueShown" :text="invValueTip">
            <PriceTag
              :class="'flex-none'"
              frame="spine"
              :value="inventoryValueInView"
              suffix="in view"
            />
          </Tooltip>
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
            <!-- The money rides on the ORIGIN TABS rather than in a readout of
                 its own, because the tabs already are the question: "Synced" is
                 what you actually own on Steam, "Crafted" is what you built
                 here. Attaching the figure to the switch makes the comparison
                 structural instead of another number to correlate.
                 Desktop only — at compact width the pills are 54px and a
                 second figure inside one would truncate the label it belongs
                 to. -->
            <template #default="{ item: f }"
              >{{ f[1]
              }}<span
                v-if="pricesOn && !isCompact && valueByOrigin[f[0] as OriginFilter]"
                class="ml-1.5 font-mono text-f9 normal-case tracking-normal text-[hsl(var(--tac-value))]/70"
                >{{ formatPrice(valueByOrigin[f[0] as OriginFilter]) }}</span
              ></template
            >
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
            :options="invSorts.map((s) => ({ value: s[0], label: s[0] === 'default' ? 'Newest' : s[1] }))"
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
          <!-- Same object as the compact toolbar's, same reasoning. -->
          <Tooltip v-if="pricesOn && filteredValueShown" :text="invValueTip">
            <PriceTag
              :class="'shrink-0'"
              frame="spine"
              :value="inventoryValueInView"
              suffix="in view"
            />
          </Tooltip>

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
                    v-for="s in invSorts"
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

              <!-- Card size, which the toolbar drops below xl. That is right for the
                   toolbar — it tunes the view rather than filtering it, so it is the
                   first thing to give up a tight row — but it left the control with
                   nowhere to live on a phone, which is the width where how many
                   cards fit across matters most. The sheet is where the other
                   view controls already are.

                   A wider range than the toolbar's: 132 is two columns on the
                   narrowest phone and 280 is one big card, and both are useful
                   answers here in a way they are not on a desktop grid. -->
              <section class="flex items-center gap-3">
                <span class="flex flex-none items-center gap-2 text-f11 uppercase tracking-cs1 text-muted-foreground">
                  <LayoutGrid class="h-3.5 w-3.5" /> Card size
                </span>
                <input
                  v-model.number="cardSize"
                  type="range"
                  min="132"
                  max="280"
                  step="4"
                  class="min-w-0 flex-1 accent-[#e0a24a]"
                  aria-label="Card size"
                />
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
              @click="$emit('armory')"
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
              :show-price="pricesOn"
              :price-pending="pricesPending"
              :price-source="priceSourceLabel"
              show-header
              :selected="selectMode && selectedIds.has(st.face.id)"
              :hide-actions="selectMode"
              :title="selectMode ? 'Toggle selection' : itemName(st.face.item) || 'View item'"
              @click="selectMode ? toggleSelected(st.face.id) : $emit('detail', st.face)"
              @contextmenu.prevent="$emit('item-ctx', st.face, $event)"
              @longpress="$emit('item-ctx-for', st.face)"
              @view3d="$emit('view3d', st.face)"
              @inspect="$emit('inspect', st.face.id)"
              @edit="$emit('edit', st.face)"
              @duplicate="$emit('duplicate', st.face)"
              @remove="$emit('remove', st.face)"
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
</template>
