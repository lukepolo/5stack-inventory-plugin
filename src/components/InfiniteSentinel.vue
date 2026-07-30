<script setup lang="ts">
/**
 * A zero-height marker that fires `hit` when it scrolls into view — the bottom
 * of an infinitely scrolling list.
 *
 * Two details make it work where a naive IntersectionObserver doesn't:
 *
 * ROOT. Every grid in this app scrolls inside its own `overflow-y-auto` panel,
 * not the page, so an observer against the viewport would report the sentinel as
 * visible the moment the panel is on screen — the whole list would load at once.
 * The nearest scrollable ancestor is found at mount and used as the root.
 *
 * RE-ARM. IntersectionObserver reports TRANSITIONS. Append a page and the
 * sentinel is very often still on screen (the new rows may not even fill the
 * viewport), so no second callback ever comes and the list stalls one page in.
 * `count` is the parent's current item count: when it changes we re-observe,
 * which delivers a fresh observation of the current state. That makes growth the
 * only thing that can re-trigger a load, so this can't spin — a parent that
 * stops growing simply stops being asked.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { scrollRoot } from "../dom";

const props = withDefaults(
  defineProps<{
    /** Items currently rendered. Changing it re-arms the observer. */
    count: number;
    /** Nothing left to load — stop firing. */
    done?: boolean;
    /** How far ahead of the fold to fire. */
    rootMargin?: string;
  }>(),
  { done: false, rootMargin: "500px" },
);
const emit = defineEmits<{ hit: [] }>();

const el = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;

function rearm() {
  const node = el.value;
  if (!io || !node || props.done) return;
  io.unobserve(node);
  io.observe(node);
}

onMounted(() => {
  const node = el.value;
  if (!node) return;
  io = new IntersectionObserver(
    (entries) => {
      if (props.done) return;
      if (entries.some((entry) => entry.isIntersecting)) emit("hit");
    },
    { root: scrollRoot(node), rootMargin: props.rootMargin },
  );
  io.observe(node);
});

// `nextTick` so the appended rows are in the DOM before we re-measure —
// re-observing against the pre-append layout would just fire again immediately.
watch(
  () => [props.count, props.done] as const,
  () => void nextTick(rearm),
);

onBeforeUnmount(() => io?.disconnect());
</script>

<template>
  <!-- col-span-full: every list this sits in is a grid, and a bare div would
       otherwise take a cell and leave a gap in the last row. -->
  <div ref="el" class="col-span-full h-px w-full" aria-hidden="true"></div>
</template>
