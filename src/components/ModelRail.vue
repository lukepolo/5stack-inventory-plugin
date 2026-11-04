<script setup lang="ts">
// The model rail: a "Jump to" menu and a strip of small cards that scrolls
// sideways under its own arrows and edge fades — the knife and glove sheets'
// model picker (App.vue), and the Sticker Crafts mat's weapon outlines
// (StickerCrafts.vue).
//
// The strip scrolls by touch natively and by mouse drag here; a click that
// ends a drag is not a pick. The current card is kept in view, centred, and the
// fades and arrows show only on a side with more cards past it. What a card
// shows is the caller's (the `art` slot); the rail owns the frame, the label
// and the behaviour, so two pickers that look alike behave alike too.
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import FilterDropdown from "./FilterDropdown.vue";

export interface RailItem {
  key: string;
  /** The full name: the menu's line and the card's tooltip. */
  name: string;
  /** The card's label. */
  short: string;
  disabled?: boolean;
}

const props = defineProps<{
  items: RailItem[];
  current: string;
  /** The menu's label ("Jump to"). */
  label: string;
  compact: boolean;
  /** The current card's background — the caller's accent wash. */
  activeBg?: string;
  /** The menu opens upward — for a rail along the bottom (Sticker Crafts). */
  up?: boolean;
}>();
const emit = defineEmits<{ (e: "select", key: string): void }>();

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const edge = ref({ l: false, r: false });
let railEl: HTMLElement | null = null;
const ro = new ResizeObserver(() => measure());
onBeforeUnmount(() => ro.disconnect());
/** Fades and arrows only on a side that has more cards past it. */
function measure() {
  const r = railEl;
  if (!r) return;
  const l = r.scrollLeft > 4;
  const right = r.scrollLeft < r.scrollWidth - r.clientWidth - 4;
  if (l !== edge.value.l || right !== edge.value.r) edge.value = { l, r: right };
}
function centre(smooth = true) {
  const r = railEl;
  const b = r?.querySelector<HTMLElement>(`[data-model="${CSS.escape(props.current)}"]`);
  if (!r || !b) return;
  r.scrollTo({ left: b.offsetLeft - (r.clientWidth - b.offsetWidth) / 2, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
}
// Function ref, called on every render: only a NEW element is set up, or each
// re-render would yank the rail back to centre while you're browsing it.
function setRailEl(el: unknown) {
  const next = (el as HTMLElement) ?? null;
  if (next === railEl) return;
  if (railEl) ro.unobserve(railEl);
  railEl = next;
  if (!next) return;
  ro.observe(next);
  nextTick(() => {
    centre(false);
    measure();
  });
}
watch(() => props.current, () => centre());
watch(() => props.items, () => nextTick(measure));
function nudge(dir: -1 | 1) {
  railEl?.scrollBy({ left: dir * railEl.clientWidth * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
// Mouse drag scrolls the rail (touch already does, natively).
let drag: { x: number; left: number } | null = null;
let dragged = false;
function onDown(e: PointerEvent) {
  if (e.pointerType !== "mouse" || e.button !== 0 || !railEl) return;
  drag = { x: e.clientX, left: railEl.scrollLeft };
  dragged = false;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
function onMove(e: PointerEvent) {
  if (!drag || !railEl) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 5) dragged = true;
  if (dragged) railEl.scrollLeft = drag.left - dx;
}
function onUp() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  drag = null;
  // The click that ends a drag lands on whatever card is under the pointer;
  // it isn't a pick.
  setTimeout(() => (dragged = false));
}
onBeforeUnmount(onUp);
function pick(key: string) {
  if (!dragged) emit("select", key);
}
</script>

<template>
  <!-- A fixed label, not the current item: a button that grew and shrank with
       the name shoved the whole rail sideways as you scrolled. -->
  <FilterDropdown
    class="flex-none"
    :label="label"
    :up="up"
    :model-value="current"
    :options="items.map((m) => ({ value: m.key, label: m.name, disabled: !!m.disabled }))"
    @update:model-value="(v: string) => emit('select', v)"
  />
  <span class="h-9 w-px flex-none bg-border" aria-hidden="true"></span>
  <div class="relative min-w-0 flex-1">
    <div
      :ref="setRailEl"
      class="craft-rail relative flex gap-1 overflow-x-auto overscroll-x-contain"
      @scroll.passive="measure"
      @pointerdown="onDown"
    >
      <button
        v-for="m in items"
        :key="m.key"
        type="button"
        :data-model="m.key"
        class="flex flex-none flex-col items-center gap-[3px] rounded-md border bg-transparent px-1 py-1 transition-colors disabled:cursor-default disabled:opacity-30"
        :class="[compact ? 'w-[80px]' : 'w-[92px]', current === m.key ? 'border-[color:var(--acc)]' : 'border-transparent']"
        :style="current === m.key && activeBg ? { background: activeBg } : {}"
        :title="m.name"
        :aria-label="m.name"
        :aria-current="current === m.key || undefined"
        :disabled="m.disabled"
        @click="pick(m.key)"
      >
        <!-- Fixed tracks: with an auto row the art's height:100% has nothing to
             resolve against and it draws at its natural height, over the label. -->
        <span class="grid w-full place-items-center" :class="compact ? 'h-[30px]' : 'h-[34px]'" style="grid-template: 100% / 100%">
          <slot name="art" :item="m" :active="current === m.key" />
        </span>
        <span
          class="max-w-full truncate text-f8 uppercase leading-tight tracking-wider"
          :class="current === m.key ? 'text-foreground' : 'text-muted-foreground/60'"
        >{{ m.short }}</span>
      </button>
    </div>
    <div
      v-show="edge.l"
      class="pointer-events-none absolute inset-y-0 left-0 flex w-14 items-center"
      style="background: linear-gradient(90deg, hsl(var(--background)) 30%, transparent)"
    >
      <button
        type="button"
        class="pointer-events-auto grid h-8 w-6 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:border-muted-foreground"
        aria-label="Scroll left"
        @click="nudge(-1)"
      ><ChevronLeft class="h-3.5 w-3.5" /></button>
    </div>
    <div
      v-show="edge.r"
      class="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end"
      style="background: linear-gradient(270deg, hsl(var(--background)) 30%, transparent)"
    >
      <button
        type="button"
        class="pointer-events-auto grid h-8 w-6 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:border-muted-foreground"
        aria-label="Scroll right"
        @click="nudge(1)"
      ><ChevronRight class="h-3.5 w-3.5" /></button>
    </div>
  </div>
</template>
