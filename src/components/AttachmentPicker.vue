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
import { Box, LayoutGrid, Link2, Loader2, Search, X } from "lucide-vue-next";
import { CARD_ART, glowStyle } from "../itemVisuals";
import { isCompact } from "../responsive";
import { ATTACH_SORTS } from "../sortModes";
import { Z } from "../zLayers";
import { PICKER_PAGE, type AttachmentPickerView, type PickerRow } from "../composables/useAttachmentPicker";
import CatalogFilters from "./CatalogFilters.vue";
import InfiniteSentinel from "./InfiniteSentinel.vue";

const props = defineProps<{
  /** The screen's own state, created once in App.vue. See useAttachmentPicker. */
  view: AttachmentPickerView;
}>();

defineEmits<{
  /** Apply this row to the waiting slot — App writes it into the craft draft. */
  (e: "pick", row: PickerRow): void;
  /** Look at one before committing, on the small preview stage App owns. */
  (e: "preview", row: PickerRow, kind: "sticker" | "charm" | "patch"): void;
}>();

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
  pickerNoun,
  attachCardSize,
  attachGridStyle,
} = props.view;
</script>

<template>
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
            role="button"
            tabindex="0"
            class="absolute right-1 top-1 z-[3] hidden items-center justify-center rounded border border-border bg-background/90 p-1 text-muted-foreground tac-action group-hover:flex"
            :title="`View ${it.name} in 3D`"
            @click.stop="$emit('preview', it, picker?.kind ?? 'sticker')"
            @keydown.enter.stop.prevent="$emit('preview', it, picker?.kind ?? 'sticker')"
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
</template>
