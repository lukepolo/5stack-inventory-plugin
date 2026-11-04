<script setup lang="ts" generic="T extends string">
// THE TRACK — the web app's `TabsList variant="track"` (the player page's tab
// strip), ported without reka: one bordered track whose tabs share the row as
// segments, wrap when they run out of room, and on a phone sit in a 4-wide grid
// with labels up to two lines. One indicator follows the active tab's whole box
// (x, y, width, height), so a wrapped second row works too.
//
// For a large or nested set of tabs: flatten them into one track instead of
// tabs inside tabs (the sticker picker's Catalog · Owned · Your crafts · Craft
// Store). Nothing in or around the track changes size when the active tab
// changes, so switching never shifts the row.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  items: readonly { id: T; label: string; count?: number | null; title?: string }[];
  active: T;
  /** Phone layout: the 4-wide grid with two-line labels. */
  compact?: boolean;
  label?: string;
}>();
const emit = defineEmits<{ (e: "select", id: T): void }>();

const list = ref<HTMLElement | null>(null);
const box = ref<{ x: number; y: number; w: number; h: number } | null>(null);
/** No slide on the first measure: the indicator starts where it belongs. */
const settled = ref(false);

function measure() {
  const el = list.value;
  const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!el || !on) return void (box.value = null);
  const a = el.getBoundingClientRect();
  const b = on.getBoundingClientRect();
  if (!b.width) return;
  box.value = { x: b.left - a.left - el.clientLeft, y: b.top - a.top - el.clientTop, w: b.width, h: b.height };
  if (!settled.value) requestAnimationFrame(() => requestAnimationFrame(() => (settled.value = true)));
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(measure);
  if (typeof ResizeObserver !== "undefined" && list.value) {
    ro = new ResizeObserver(measure);
    ro.observe(list.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());
watch(
  () => [props.active, props.items.length, props.compact],
  () => void nextTick(measure),
);

function key(e: KeyboardEvent, i: number) {
  const n = props.items.length;
  const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  emit("select", props.items[to].id);
  void nextTick(() => list.value?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus());
}
</script>

<template>
  <div
    ref="list"
    role="tablist"
    :aria-label="label"
    class="relative w-full gap-0.5 rounded-lg border border-border bg-muted/30 p-1"
    :class="compact ? 'grid grid-cols-4' : 'flex flex-wrap'"
  >
    <span
      v-show="box"
      aria-hidden="true"
      class="tt-ind pointer-events-none absolute left-0 top-0 z-0 rounded-md"
      :class="settled ? 'tt-slide' : ''"
      :style="box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w + 'px', height: box.h + 'px' } : undefined"
    ></span>
    <button
      v-for="(it, i) in items"
      :key="it.id"
      type="button"
      role="tab"
      :aria-selected="it.id === active"
      :tabindex="it.id === active ? 0 : -1"
      :title="it.title"
      class="relative z-[1] inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md text-f10 uppercase tracking-cs1 transition-colors duration-200"
      :class="[
        it.id === active ? 'text-foreground' : 'text-muted-foreground tt-hover',
        compact ? 'h-10 px-1' : 'h-[34px] px-3.5',
      ]"
      :style="compact ? undefined : { flex: '1 0 auto' }"
      @click="emit('select', it.id)"
      @keydown="key($event, i)"
    >
      <span :class="compact ? 'tt-two text-center leading-tight' : 'truncate'">{{ it.label }}</span>
      <span v-if="it.count != null" class="flex-none rounded bg-background/70 px-1 font-mono text-f8 normal-case tracking-normal">{{ it.count }}</span>
    </button>
  </div>
</template>

<style scoped>
/* The web track's indicator: amber tint with an inset ring, sprung on move. */
.tt-ind {
  background: hsl(var(--tac-amber, 33 94% 58%) / 0.12);
  box-shadow: inset 0 0 0 1px hsl(var(--tac-amber, 33 94% 58%) / 0.4);
}
.tt-slide {
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    width 0.2s ease,
    height 0.2s ease;
}
@media (hover: hover) {
  .tt-hover:hover {
    color: hsl(var(--foreground));
  }
}
.tt-two {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .tt-slide {
    transition: none;
  }
}
</style>
