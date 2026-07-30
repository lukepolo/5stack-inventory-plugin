<script setup lang="ts" generic="T">
// THE sliding-pill tab strip — the indicator markup that goes with `makePill`.
//
// `pill.ts` already shared the mechanism, but the ~12 lines of wrapper +
// indicator + `:ref` wiring were pasted at nine sites in App.vue and once in
// CatalogFilters, and they had drifted: the agent-pose strip hardcoded
// `bottom-1 top-1` where every sibling branches on `isCompact`, so its
// indicator sat 4px taller than the rest on a phone. Seven of the copies even
// share a mis-indented `:class` line — a literal fingerprint of the paste.
//
// The strip owns its own pill and re-syncs on its own, which also retires the
// per-strip `watch(..., () => nextTick(() => somePill.sync(x)))` each call site
// used to carry.
import { nextTick, watch } from "vue";
import { makePill, pillTransition } from "../pill";
import { isCompact } from "../responsive";

const props = withDefaults(
  defineProps<{
    items: readonly T[];
    /** Stable identity per tab — also what `select` emits and what `active` matches. */
    itemKey: (item: T) => string;
    /** Optional per-tab tooltip (the agent-pose strip explains what each pose is). */
    itemTitle?: (item: T) => string | undefined;
    active: string;
    /**
     * `accent` is the amber-glow indicator every filter/mode strip uses.
     * `solid` is the CT/T toggle: a filled gradient with a drop shadow, because
     * it reads as a switch rather than as a filter.
     */
    variant?: "accent" | "solid";
    /** Background for `solid` — the team gradient. Ignored by `accent`. */
    solidBackground?: string;
    /**
     * The strip's position utility. Its own prop rather than something you smuggle
     * in through `listClass`, because the root has to carry a position class
     * either way and two of them on one element is decided by stylesheet order,
     * not by the order you wrote them.
     *
     * `relative` for a strip in normal flow; the craft modal's two stage strips
     * pass `absolute` and pin themselves with `listClass`.
     */
    position?: string;
    /** Extra classes on the strip itself (height, flex behaviour, offsets). */
    listClass?: string;
    /** Shared classes for every tab button. */
    buttonClass?: string;
    activeClass?: string;
    inactiveClass?: string;
  }>(),
  {
    position: "relative",
    variant: "accent",
    solidBackground: "",
    listClass: "",
    buttonClass: "relative z-[1] flex h-6 items-center rounded-md px-3 text-f10 uppercase tracking-wider transition-colors",
    activeClass: "text-foreground",
    inactiveClass: "text-muted-foreground hover:text-foreground",
  },
);

const emit = defineEmits<{ (e: "select", key: string): void }>();

const pill = makePill();

// Re-measure whenever the active tab, the tab SET, or the breakpoint changes —
// the last one matters because the buttons change size at the compact
// breakpoint. `immediate` seeds the key before the first paint so the
// indicator's own ResizeObserver fire can position it without a jump.
watch(
  () => [props.active, props.items, isCompact.value] as const,
  () => nextTick(() => pill.sync(props.active)),
  { immediate: true },
);
</script>

<template>
  <!--
    Deliberately a plain class list, NOT `cn`/tailwind-merge. twMerge does not
    know this repo's custom font tokens (text-f10/f11/f13 from tailwind.config),
    so it reads `text-f10` as an unrecognised `text-*` and files it under
    text-COLOUR — merging it against `text-foreground` then drops the SIZE and
    every tab label renders at the inherited size. Position is a prop instead.
  -->
  <div :ref="(el) => pill.setListEl(el)" :class="[position, 'inline-flex items-center rounded-lg bg-muted', isCompact ? 'p-0.5' : 'p-1', listClass]">
    <div
      v-show="pill.w.value > 0"
      class="pointer-events-none absolute left-0 z-0 rounded-md"
      :class="[isCompact ? 'bottom-0.5 top-0.5' : 'bottom-1 top-1', variant === 'solid' && 'shadow-sm']"
      :style="{
        transform: `translateX(${pill.x.value}px)`,
        width: pill.w.value + 'px',
        transition: pillTransition(pill.animated.value),
        ...(variant === 'solid'
          ? { background: solidBackground }
          : {
              border: '1px solid hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
              background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
              boxShadow: '0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
            }),
      }"
    ></div>
    <button
      v-for="item in items"
      :key="itemKey(item)"
      :ref="(el) => pill.setRef(itemKey(item), el)"
      :class="[buttonClass, active === itemKey(item) ? activeClass : inactiveClass]"
      :title="itemTitle?.(item)"
      @click="emit('select', itemKey(item))"
    >
      <slot :item="item" :active="active === itemKey(item)">{{ itemKey(item) }}</slot>
    </button>
  </div>
</template>
