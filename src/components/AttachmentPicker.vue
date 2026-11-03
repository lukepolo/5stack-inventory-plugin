<script setup lang="ts">
// THE ATTACHMENT PICKER — the full-screen shelf you browse to answer "which
// sticker goes in this slot".
//
// Extracted from App.vue the same way Armory.vue and InventoryScreen.vue were.
// Its state stays App's (useAttachmentPicker) because `picker` is load-bearing
// all over that file: the Escape chain unwinds through it, the craft modal's
// backdrop click closes back to the editor rather than throwing the edit away,
// and the 3D editor checks it before mounting. What is genuinely this screen's
// — the paging, the facet cascade, the two shelves — moved wholesale.
//
// The two emits are the two things a pick DOES, and both belong to App: writing
// the choice into the craft draft, and opening the preview stage over the top.
import { computed } from "vue";
import { Box, LayoutGrid, Link2, Loader2, Search, Store, X } from "lucide-vue-next";
import { CARD_ART, glowStyle } from "../itemVisuals";
import { isCompact } from "../responsive";
import { ATTACH_SORTS } from "../sortModes";
import { Z } from "../zLayers";
import { PICKER_PAGE, type AttachmentPickerView, type PickerRow } from "../composables/useAttachmentPicker";
import { MAX_PER_GROUPING, type SavedCraft, type StoreCraft } from "../stickerCraftsModel";
import CatalogFilters from "./CatalogFilters.vue";
import CraftTile from "./CraftTile.vue";
import CraftPreview from "./CraftPreview.vue";
import InfiniteSentinel from "./InfiniteSentinel.vue";

const props = defineProps<{
  /** The screen's own state, created once in App.vue. See useAttachmentPicker. */
  view: AttachmentPickerView;
  /** No 3D preview button on the tiles — for a caller with no preview stage
   *  (Sticker Crafts, where picking IS the preview: it lands on the board). */
  hidePreview?: boolean;
  /** The Back button's tooltip; says what is underneath. */
  backTitle?: string;
  /** The Back button's word, when "Back" alone doesn't say where to. */
  backLabel?: string;
  /** The heading, for a caller that opens it on a shelf ("Craft Store");
   *  "Pick a sticker" otherwise. */
  title?: string;
  /** Where a pick goes: a gun's sticker slots (the editor, the default) or the
   *  Sticker Crafts mat. Only the words change — room, footer, empty shelf. */
  target?: "gun" | "mat";
}>();
const onMat = computed(() => props.target === "mat");



// Destructured so the template reads exactly as it did inside App.vue — a ref
// nested inside an object is not auto-unwrapped in a template, only a top-level
// binding is. The object identity never changes, so this is safe to take once.
const {
  picker,
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
  pickerCrafts,
  pickerCraftsLoading,
  pickerCraftRows,
  craftsPublished,
  craftsScope,
  craftRoom,
  craftCount,
  craftFits,
  craftPlanFor,
  myScores,
  storeSort,
  storeRows,
  storeLoading,
  storeMissing,
  voteOn,
  previewCraft,
  pickerNoun,
  attachCardSize,
  attachGridStyle,
} = props.view;

/** The shelves on offer. Sticker Crafts only to a sticker picker. */
const sources = computed(() =>
  picker.value?.kind === "sticker" ? (["all", "owned", "crafts"] as const) : (["all", "owned"] as const),
);
const SOURCE_LABEL = computed(() => ({ all: "Catalog", owned: "Owned", crafts: isCompact.value ? "Crafts" : "Sticker Crafts" }) as const);
/**
 * Craft tiles: a reading width rather than the sticker slider's scale — at a
 * large card size they became posters with 8px captions — and rows as tall as
 * their content. `max-content`, not `auto`: in a full shelf `auto` rows gave
 * way to the scroller's height and squashed every picture to a strip, where
 * they must stay whole and the shelf scroll.
 */
const craftGridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: isCompact.value ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(260px, 340px))",
  gridAutoRows: "max-content",
  justifyContent: "start",
}));
/** The crafts on show: yours, or the store's. */
const craftRows = computed<(SavedCraft | StoreCraft)[]>(() =>
  craftsScope.value === "store" ? storeRows.value : pickerCraftRows.value,
);
const craftsBusy = computed(() => (craftsScope.value === "store" ? storeLoading.value : pickerCraftsLoading.value));
/** The ones there is room for first; the rest after, under a line saying why. */
const craftFitRows = computed(() => craftRows.value.filter((c) => craftFits(c.stickers.length)));
const craftBigRows = computed(() => craftRows.value.filter((c) => !craftFits(c.stickers.length)));
const emit = defineEmits<{
  /** Apply this row to the waiting slot — App writes it into the craft draft. */
  (e: "pick", row: PickerRow): void;
  /** Look at one before committing, on the small preview stage App owns. */
  (e: "preview", row: PickerRow, kind: "sticker" | "charm" | "patch"): void;
  /** A saved Sticker Craft — up to five stickers placed together, in one pick. */
  (e: "pickCraft", craft: SavedCraft): void;
}>();
function useCraft(c: SavedCraft | StoreCraft) {
  previewCraft.value = null;
  emit("pickCraft", c);
}
</script>

<template>
    <!-- fixed + above the 3D overlay (z-1200): the picker is reachable from
         both the form and the 3D editor, and must cover whichever is up. -->
    <div v-if="picker" class="fixed inset-0 flex flex-col bg-card/[0.985] p-4" :style="{ zIndex: Z.picker }" role="dialog" aria-modal="true" aria-label="Pick an attachment">
      <!-- On a phone: title and Back on the first row, then the shelves, then
           search, each full width. In one row Back and search ran off the
           screen, and with no Esc key Back is the only way out. -->
      <div class="mb-3 flex items-center" :class="isCompact ? 'flex-wrap gap-2' : 'gap-3'">
        <span class="text-f11 font-semibold uppercase tracking-cs1" :class="isCompact ? 'order-1' : ''">{{ title ?? 'Pick a ' + picker.kind }}</span>
        <!-- Catalog vs your own drawer. Owned counts the SPARES, not the
             total: the question this shelf answers is "have I got one going
             spare", and a badge counting ones already stuck to a gun would
             answer a different one. -->
        <div class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5" :class="isCompact ? 'order-3 w-full' : ''">
          <button
            v-for="src in sources"
            :key="src"
            class="flex items-center justify-center gap-1.5 rounded px-2.5 text-f10 uppercase tracking-cs1 transition-colors"
            :class="[pickerSource === src ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground', isCompact ? 'h-9 flex-1' : 'py-1']"
            :title="src === 'all' ? 'Browse every ' + picker.kind + ' in the game' : src === 'owned' ? 'Only ' + picker.kind + 's you own' : 'Layouts saved on the Sticker Crafts tab — up to five stickers placed in one pick'"
            @click="pickerSource = src"
          >
            {{ SOURCE_LABEL[src] }}
            <span
              v-if="src === 'owned' && pickerOwned.length"
              class="rounded bg-background/70 px-1 font-mono text-f8"
            >{{ pickerOwned.filter((r) => !r.attachedName).length }}</span>
            <span
              v-if="src === 'crafts' && pickerCrafts.length"
              class="rounded bg-background/70 px-1 font-mono text-f8"
            >{{ pickerCrafts.length }}</span>
          </button>
        </div>
        <div v-if="!isCompact && pickerSource !== 'crafts'" class="ml-auto flex flex-none items-center gap-2 text-muted-foreground" title="Card size">
          <LayoutGrid class="h-3.5 w-3.5" />
          <input v-model.number="attachCardSize" type="range" min="72" max="200" step="4" class="w-24 accent-[#e0a24a]" />
        </div>
        <div class="relative" :class="isCompact ? 'order-4 w-full' : pickerSource === 'crafts' ? 'ml-auto w-[240px]' : 'w-[240px]'">
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
          class="flex flex-none items-center gap-1.5 rounded-md border border-border px-2.5 text-f10 uppercase tracking-cs1 text-muted-foreground tac-action"
          :class="isCompact ? 'order-2 ml-auto h-9' : 'py-2'"
          :title="backTitle ?? 'Back to the editor — nothing is applied'"
          @click="picker = null"
        >
          <X class="h-3.5 w-3.5" /> {{ backLabel ?? "Back" }}
        </button>
      </div>

      <!-- STICKER CRAFTS: yours or the store's, and how many stickers. The
           count chips past the room this gun has are off — a craft has to fit
           the free slots it lands in (useStickerCraftPlacement). -->
      <!-- What there is room for first, then whose crafts, then the size filter
           — labelled, so its 1–5 don't read as the gun's slot numbers. -->
      <div v-if="pickerSource === 'crafts'" class="mb-3 flex flex-wrap items-center gap-2">
        <!-- On the mat the room only matters when it is short: "5" read as the
             mat's size, when it is a craft's. -->
        <span v-if="!onMat || craftRoom < MAX_PER_GROUPING" class="order-none text-f11 text-foreground" :class="isCompact ? 'w-full' : ''">
          <template v-if="onMat">Room on the mat: {{ craftRoom }} more {{ craftRoom === 1 ? "sticker" : "stickers" }}</template>
          <template v-else>This gun: {{ craftRoom }} empty {{ craftRoom === 1 ? "slot" : "slots" }}</template>
        </span>
        <div class="order-1 flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5" :class="isCompact ? 'min-w-0 flex-1' : ''">
          <button
            v-for="sc in (['mine', 'store'] as const)"
            :key="sc"
            class="rounded px-2.5 text-f10 uppercase tracking-cs1 transition-colors"
            :class="[craftsScope === sc ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground', isCompact ? 'h-9 flex-1' : 'py-1']"
            :title="sc === 'mine' ? 'Crafts you saved on the Sticker Crafts tab' : 'Crafts other players published'"
            @click="craftsScope = sc"
          >{{ sc === 'mine' ? 'Mine' : 'Craft Store' }}</button>
        </div>
        <div class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5" :class="isCompact ? 'order-3' : 'order-2'">
          <span class="px-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">Stickers</span>
          <button
            v-for="c in [0, 1, 2, 3, 4, 5]"
            :key="c"
            class="rounded px-2 font-mono text-f10 uppercase tracking-cs1 transition-colors"
            :class="[craftCount === c ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground', isCompact ? 'h-9 min-w-9' : 'py-1']"
            :title="c === 0 ? 'Crafts of any size' : `Crafts of exactly ${c} ${c === 1 ? 'sticker' : 'stickers'}`"
            @click="craftCount = c"
          >{{ c === 0 ? 'All' : c }}</button>
        </div>
        <div v-if="craftsScope === 'store'" class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5" :class="isCompact ? 'order-2' : 'order-3 ml-auto'">
          <button
            v-for="so in (['top', 'new'] as const)"
            :key="so"
            class="rounded px-2.5 text-f10 uppercase tracking-cs1 transition-colors"
            :class="[storeSort === so ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground', isCompact ? 'h-9' : 'py-1']"
            :title="so === 'top' ? 'Best rated first' : 'Newest first'"
            @click="storeSort = so"
          >{{ so === 'top' ? 'Top' : 'New' }}</button>
        </div>
      </div>

      <div v-if="pickerSource === 'crafts' && onMat && craftsScope === 'store'" class="mb-3 text-f11 text-muted-foreground">
        Lay any craft on the mat, change it if you like, then Save as craft to keep your own copy.
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
        :class="pickerLoading && pickerSource !== 'crafts' ? 'opacity-45' : 'opacity-100'"
        :style="pickerSource === 'crafts' ? craftGridStyle : attachGridStyle"
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
          @click="$emit('pick', it)"
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
            v-if="!hidePreview"
            role="button"
            tabindex="0"
            class="absolute right-1 top-1 z-[3] hidden items-center justify-center rounded border border-border bg-background/90 p-1 text-muted-foreground tac-action group-hover:flex"
            :title="`View ${it.name} in 3D`"
            @click.stop="$emit('preview', it, picker?.kind ?? 'sticker')"
            @keydown.enter.stop.prevent="$emit('preview', it, picker?.kind ?? 'sticker')"
          ><Box class="h-3.5 w-3.5" /></span>
          <!-- The capsule it came in, over the art — the place the knife and
               glove craft cards put their model label, in the same grey caps.
               The name under the art says WHAT it is; this says where it is
               from, which is how stickers are actually hunted ("the Katowice
               2014 one"). Clear of the corner badges either side. -->
          <span
            v-if="it.capsule"
            class="relative z-[2] w-full truncate text-center text-f8 uppercase tracking-cs1 text-muted-foreground/70"
            :class="it.attachedName ? 'px-4' : 'pr-4'"
          >{{ it.capsule }}</span>
          <div :class="CARD_ART" class="relative z-[2]">
            <!-- decoding="async" keeps the decode off the main thread. With
                 `lazy`, a fast scroll brings dozens of images into view at
                 once and the default synchronous decode lands all of them in
                 the scroll frames — the "logos rendering in" stutter. -->
            <img :src="it.image ?? undefined" alt="" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-110" />
          </div>
          <span class="relative z-[2] w-full truncate text-center text-f8 text-muted-foreground">{{ it.name.replace(/^(Sticker|Charm|Sticker Slab) \| /, '') }}</span>
        </button>
        <!-- STICKER CRAFTS — a whole layout per tile, pictured by the Sticker
             Crafts board itself. The picture opens it in 3D; Use fills that
             many free slots. -->
        <template v-if="pickerSource === 'crafts'">
          <CraftTile
            v-for="(c, i) in craftFitRows"
            :key="'craft-' + craftsScope + c.id"
            class="animate-cell-in"
            :style="{ '--i': i }"
            :craft="c"
            fits
            :room="craftRoom"
            :plan="craftPlanFor(c.stickers.length)"
            :target="onMat ? 'mat' : 'gun'"
            :published="craftsScope === 'mine' && craftsPublished.has(c.id)"
            :score="craftsScope === 'mine' ? (myScores.get(c.id) ?? null) : null"
            @preview="previewCraft = c"
            @use="useCraft(c)"
            @vote="(v) => voteOn(c as StoreCraft, v)"
          >
            <template v-if="$slots.craftActions && craftsScope === 'mine'" #actions>
              <slot name="craftActions" :craft="c as SavedCraft" />
            </template>
          </CraftTile>
          <div v-if="craftBigRows.length" class="col-span-full mt-2 flex items-center gap-2 text-f11 text-muted-foreground">
            {{ onMat ? "Need more room on the mat" : "Need more empty slots" }} ({{ craftBigRows.length }})
            <span class="h-px flex-1 bg-border"></span>
          </div>
          <CraftTile
            v-for="c in craftBigRows"
            :key="'craft-big-' + craftsScope + c.id"
            :craft="c"
            :fits="false"
            :room="craftRoom"
            :plan="null"
            :target="onMat ? 'mat' : 'gun'"
            :published="craftsScope === 'mine' && craftsPublished.has(c.id)"
            :score="craftsScope === 'mine' ? (myScores.get(c.id) ?? null) : null"
            @preview="previewCraft = c"
            @use="useCraft(c)"
            @vote="(v) => voteOn(c as StoreCraft, v)"
          >
            <template v-if="$slots.craftActions && craftsScope === 'mine'" #actions>
              <slot name="craftActions" :craft="c as SavedCraft" />
            </template>
          </CraftTile>
          <div v-if="!craftRows.length" class="col-span-full animate-fade-in py-8 text-center text-f13 text-muted-foreground">
            <Loader2 v-if="craftsBusy" class="mx-auto h-4 w-4 animate-spin" />
            <template v-else-if="craftsScope === 'store' && storeMissing">
              The Craft Store needs the updated backend.
            </template>
            <template v-else-if="pickerQuery">No crafts match that search.</template>
            <template v-else-if="craftCount">
              {{ craftsScope === 'store' ? 'No published crafts' : 'None of your crafts' }} {{ craftsScope === 'store' ? 'of' : 'has' }} {{ craftCount }} {{ craftCount === 1 ? 'sticker' : 'stickers' }}.
              <div class="mt-4 flex justify-center">
                <button
                  class="tac-action flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground"
                  @click="craftCount = 0"
                >Show crafts of any size</button>
              </div>
            </template>
            <template v-else-if="craftsScope === 'store'">No one has published a craft yet.</template>
            <template v-else>
              You haven't saved any crafts yet.
              {{ onMat ? "Select up to five stickers on the mat and press Save as craft" : "Make one on the Sticker Crafts tab in the top menu" }}, or use one from the Craft Store.
              <!-- Or use someone else's: the way into the store from an empty shelf. -->
              <div class="mt-4 flex justify-center">
                <button
                  class="tac-action flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground"
                  title="See the crafts other players published"
                  @click="craftsScope = 'store'"
                >
                  <Store class="h-3.5 w-3.5" /> Browse the Craft Store
                </button>
              </div>
            </template>
          </div>
        </template>
        <div v-if="pickerSource !== 'crafts' && !pickerLoading && !pickerRows.length" class="col-span-full animate-fade-in py-8 text-center text-f13 text-muted-foreground">
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
        <template v-if="pickerLoading && pickerSource !== 'crafts'"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Searching…</template>
        <template v-else-if="pickerLoadingMore"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading more…</template>
        <!-- Nothing to say on an empty result set; `h-11` holds the space
             regardless, so the grid above never resizes either way. -->
        <template v-else-if="pickerSource === 'crafts'">
          <span v-if="craftRows.length && !isCompact" class="text-f11 normal-case tracking-normal">
            {{ onMat ? "Place lays the craft on the mat as a group, where you can change it." : "Use holds the craft over the gun — drag it into place, or press Place to put it on its slots." }}
          </span>
        </template>
        <template v-else-if="!pickerRows.length"></template>
        <!-- Owned counts spares against the total, because "3 of 11 spare"
             is the number you are actually shopping against. -->
        <template v-else-if="pickerSource === 'owned'">
          {{ pickerOwned.filter((r) => !r.attachedName).length }} spare of {{ pickerOwned.length }} owned
        </template>
        <template v-else-if="pickerDone">{{ pickerTotal }} {{ pickerNoun }}</template>
        <template v-else>{{ pickerResults.length }} of {{ pickerTotal }}</template>
      </div>
      <!-- A craft in 3D, over the picker (CraftPreview). -->
      <CraftPreview
        v-if="previewCraft"
        :craft="previewCraft"
        :fits="craftFits(previewCraft.stickers.length)"
        :room="craftRoom"
        :plan="craftPlanFor(previewCraft.stickers.length)"
        :target="onMat ? 'mat' : 'gun'"
        @close="previewCraft = null"
        @use="useCraft(previewCraft)"
        @vote="(v) => voteOn(previewCraft as StoreCraft, v)"
      />
    </div>
</template>
