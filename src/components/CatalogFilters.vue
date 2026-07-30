<script setup lang="ts">
// THE filter bar for any browsable catalog — the picker, the armory, and
// anything that comes next.
//
// Every catalog in this plugin narrows the same way: one coarse TAB STRIP for
// "what kind of thing is this", then some number of DROPDOWNS for the axes that
// kind happens to have, then sort. Only the axes differ — stickers split by
// collection and rarity, graffiti by capsule and colourway — so the shape is
// shared and the axes are a prop.
//
// It was three copies before this: the picker's, the loadout sheet's, and
// (nearly) a fourth in the armory. They had already drifted — different count
// formatting, different Clear semantics, only one of them animating its tabs —
// which is the tell that "filters" had stopped meaning one thing in this app.
//
// Counts ride on every control on purpose: with 10.5k stickers the useful
// question is never "does this exist" but "how much am I about to wade
// through". Each NARROWING control hides itself when the catalog behind it has
// nothing to split (patches have no groups and no collections, so a patch
// picker shows rarity alone), while the bar itself always renders — Sort is
// always meaningful, and a bar that can vanish could strand an active filter
// with no visible control to switch it off.
import { computed, nextTick, watch } from "vue";
import { X } from "lucide-vue-next";
import FilterDropdown from "./FilterDropdown.vue";
import SortDirection from "./SortDirection.vue";
import { makePill, pillTransition } from "../pill";
import type { SortDir, SortKind } from "../sortIcons";

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  /** Rarity hex, for the dropdowns that render a colour dot. */
  color?: string;
}
/** One narrowing axis: a dropdown of options, plus how to label it. */
export interface FacetAxis {
  key: string;
  /** Prefix shown when nothing is picked ("Collection", "Colour"). */
  label?: string;
  options: FacetOption[];
  /** Render a colour swatch beside each option — rarity and colourways. */
  dots?: boolean;
}

const props = withDefaults(
  defineProps<{
    /** The coarse tab strip. Fewer than two and it hides — one tab is not a choice. */
    tabs?: FacetOption[];
    tab?: string;
    /** Narrowing dropdowns, in the order they should read. */
    axes?: FacetAxis[];
    /** Current value per axis key. */
    axisValues?: Record<string, string>;
    sorts?: FacetOption[];
    sort?: string;
    dir?: SortDir;
    sortKind?: SortKind;
    dirHint?: string;
    /** What "unfiltered" is. Clear returns here, not necessarily to "". */
    defaultTab?: string;
    compact?: boolean;
  }>(),
  { tabs: () => [], axes: () => [], axisValues: () => ({}), sorts: () => [], dir: "desc", sortKind: "amount", compact: false },
);
const emit = defineEmits<{
  (e: "update:tab", v: string): void;
  (e: "update:axis", key: string, v: string): void;
  (e: "update:sort", v: string): void;
  (e: "update:dir", v: SortDir): void;
  (e: "clear"): void;
}>();

const pill = makePill();
// Re-measure when the strip's CONTENT changes, not just its size: the counts
// re-render on every keystroke and a tab can appear or vanish with them.
watch(
  () => [props.tab, props.tabs.map((t) => t.value + ":" + (t.count ?? "")).join("|")],
  () => nextTick(() => pill.sync(props.tab)),
  { immediate: true },
);

/** Anything narrowed away from how it opened. The default tab alone doesn't
 *  count — Clear is for undoing, and there is nothing to undo there. */
const filtered = computed(
  () =>
    (props.defaultTab !== undefined && props.tab !== props.defaultTab) ||
    props.axes.some((a) => !!props.axisValues[a.key]),
);

/** "10.6k" — a sticker count has to fit a fixed-width badge. */
function fmtCount(n?: number) {
  if (n == null) return "";
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}
/**
 * A dropdown's options, with an unfiltered row on top.
 *
 * Just "All" — the closed button already prints the prefix, so anything longer
 * reads back as "Collection · All collection".
 */
function axisOptions(a: FacetAxis): FacetOption[] {
  return [{ value: "", label: "All" }, ...a.options];
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- Same sliding-pill animated tabs as every other tab group in the app,
         with the list driven by the facets rather than hardcoded. -->
    <div
      v-if="tabs.length > 1"
      :ref="(el) => pill.setListEl(el)"
      class="relative inline-flex h-8 flex-none items-center rounded-lg bg-muted p-1"
    >
      <div
        v-show="pill.w.value > 0"
        class="pointer-events-none absolute left-0 z-0 rounded-md"
        :class="compact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1'"
        :style="{
          transform: `translateX(${pill.x.value}px)`,
          width: pill.w.value + 'px',
          border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
          background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
          boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
          transition: pillTransition(pill.animated.value),
        }"
      ></div>
      <button
        v-for="t in tabs"
        :key="t.value"
        :ref="(el) => pill.setRef(t.value, el)"
        class="relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors"
        :class="tab === t.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="emit('update:tab', t.value)"
      >
        {{ t.label }}
        <!-- Wider than the other count badges and square-cornered, not a
             circle: these read "10.6k", where a pill sized for "12" put the
             text against its own border.
             FIXED width, not min-width, and tabular figures: the count is the
             one thing here that changes while you type, and letting it size
             itself resized the TAB — which moved every tab after it and dragged
             the sliding indicator along, on every keystroke. Sized for "10.6k",
             the widest value the formatter emits. -->
        <span
          v-if="t.count != null"
          class="ml-1.5 inline-flex h-[15px] w-[34px] flex-none items-center justify-center rounded border border-border bg-background/70 px-1 font-mono text-f9 leading-none tabular-nums"
        >{{ fmtCount(t.count) }}</span>
      </button>
    </div>

    <FilterDropdown
      v-for="a in axes"
      :key="a.key"
      v-show="a.options.length > 1"
      :model-value="axisValues[a.key] ?? ''"
      :options="axisOptions(a)"
      :prefix="a.label"
      :dots="a.dots"
      @update:model-value="emit('update:axis', a.key, $event)"
    />

    <button
      v-if="filtered"
      class="flex h-8 items-center gap-1.5 rounded-md px-2 text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:text-foreground"
      @click="emit('clear')"
    >
      <X class="h-3 w-3" /> Clear
    </button>

    <!-- Sort sits apart from the narrowing controls: it changes the ORDER of
         the same set, so Clear has nothing to do with it. -->
    <template v-if="sorts.length">
      <FilterDropdown
        class="ml-auto"
        :model-value="sort ?? ''"
        :options="sorts"
        prefix="Sort"
        @update:model-value="emit('update:sort', $event)"
      />
      <SortDirection
        :model-value="dir"
        :kind="sortKind"
        :hint="dirHint"
        @update:model-value="emit('update:dir', $event)"
      />
    </template>
  </div>
</template>
