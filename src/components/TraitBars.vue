<script setup lang="ts">
// Draggable trait bars — how a random-draw pattern is CHOSEN by what it does.
//
// Used for a pet's body (petPattern.ts) and a gun's artwork placement
// (gunPattern.ts). In both, the pattern number seeds Valve's random stream, so
// neighbouring numbers are unrelated and no slider over the number means
// anything. A drag here instead asks the caller's table (traitSearch.ts) for the
// real pattern nearest "this trait, here, the rest as they were" and emits it.
// The bar then shows what that pattern actually draws.
//
// ONLY THE DOT DRAGS. Pressing anywhere on the bar used to start a drag (and
// jump the value there), which made a column of bars awkward to work: a stray
// press reshuffled the pattern. The dot has a hit area wider than it looks,
// and grabbing it off-centre keeps that offset instead of snapping to the
// pointer.
//
// THE DOT STAYS UNDER THE POINTER while dragging; the fill and a small tick
// show where the real pattern landed, and on release the dot settles onto it.
// Drawing it at the landed value instead (the first version) made it slide
// away from the cursor mid-drag, which reads as the drag slipping off the
// slider. No tooltip while dragging either — it covered the bar being dragged.
//
// THE DRAG HOLDS UNTIL RELEASE, wherever the pointer goes — like any slider,
// only the pointer's left-right counts once the dot is taken, and past either
// end it pins at 0 or 100. Ending the drag when the pointer strayed off the
// bar (the version before) was miserable on a 22px row: a hand dragging
// sideways drifts a few px up or down, and the dot let go mid-drag. What that
// version was guarding against is still covered: a move that arrives with no
// button down (a release we never heard) ends it, and so does a lost capture.
//
// Anchored to the traits at the START of the drag, so the others do not wander
// further with every step; one search per frame however fast the pointer
// reports; ← → nudge a focused bar through the same search.
import { ref } from "vue";
import { nearestSeed, type TraitTable } from "../traitSearch";

export interface TraitRow {
  key: string;
  label: string;
  /** The current pattern's value, 0..1. */
  value: number;
  /** The value as a person reads it — "48", "214°". */
  display: string;
}

const props = withDefaults(
  defineProps<{
    traits: TraitRow[];
    /** The table to search — a getter, so it is only built when first needed. */
    table: () => TraitTable | null;
    seed: number;
    /**
     * CENTRED bars fill from the middle, for traits where 0.5 is the average
     * (a pet's body). Otherwise the bar marks a POSITION along its range (where
     * a gun's artwork sits), with the handle always shown.
     */
    centered?: boolean;
  }>(),
  { centered: false },
);
const emit = defineEmits<{ seek: [number] }>();

/** `grab` is where on the dot it was taken, as a fraction of the bar. */
const drag = ref<{ key: string; target: number; grab: number; base: Record<string, number> } | null>(null);
let frame = 0;

const valuesNow = () => Object.fromEntries(props.traits.map((t) => [t.key, t.value]));
function seek(key: string, target: number, base: Record<string, number>) {
  const table = props.table();
  if (!table) return;
  const seed = nearestSeed(table, { ...base, [key]: target }, key);
  if (seed !== props.seed) emit("seek", seed);
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** The bar a dot's event belongs to. */
const barRect = (e: PointerEvent) => ((e.currentTarget as HTMLElement).parentElement as HTMLElement).getBoundingClientRect();

function down(e: PointerEvent, t: TraitRow) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const r = barRect(e);
  // No search yet: taking hold of the dot is not a request to move it.
  drag.value = { key: t.key, target: t.value, grab: (e.clientX - r.left) / Math.max(1, r.width) - t.value, base: valuesNow() };
}
function move(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  if (e.buttons === 0) return end(e);
  const r = barRect(e);
  d.target = clamp01((e.clientX - r.left) / Math.max(1, r.width) - d.grab);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (drag.value) seek(drag.value.key, drag.value.target, drag.value.base);
  });
}
/** Release, cancel, or a lost capture. */
function end(e: PointerEvent) {
  // A search still waiting on its frame is the LAST place the pointer was —
  // run it now, or a quick flick and release lands on the one before.
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
    const d = drag.value;
    if (d) seek(d.key, d.target, d.base);
  }
  drag.value = null;
  // Hand the pointer back — a no-op after a release, but an end we called
  // ourselves (no button down) must not leave the dot holding it.
  const el = e.currentTarget as HTMLElement | null;
  if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
}
function key(e: KeyboardEvent, k: string) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const now = valuesNow();
  seek(k, clamp01(now[k] + (e.key === "ArrowRight" ? 0.05 : -0.05)), now);
}
</script>

<template>
  <div class="flex flex-col">
    <div v-for="t in traits" :key="t.key" class="flex items-center gap-2.5">
      <span class="w-14 flex-none truncate text-f9 uppercase tracking-cs1 text-muted-foreground/80">{{ t.label }}</span>
      <span class="tb-bar" :class="{ 'is-dragging': drag?.key === t.key, 'is-position': !centered }">
        <span class="tb-rail">
          <span
            v-if="centered"
            class="tb-fill"
            :style="t.value >= 0.5 ? { left: '50%', width: `${(t.value - 0.5) * 100}%` } : { right: '50%', width: `${(0.5 - t.value) * 100}%` }"
          />
          <span v-else class="tb-fill" :style="{ left: '0', width: `${t.value * 100}%` }" />
        </span>
        <span v-if="drag?.key === t.key" class="tb-landed" :style="{ left: `${t.value * 100}%` }" />
        <span
          class="tb-knob"
          role="slider"
          tabindex="0"
          :aria-label="t.label"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(t.value * 100)"
          :aria-valuetext="t.display"
          :title="drag ? undefined : `${t.label}: ${t.display} — drag the dot to find the pattern that does this`"
          :style="{ left: `${(drag?.key === t.key ? drag.target : t.value) * 100}%` }"
          @pointerdown.prevent="down($event, t)"
          @pointermove="move"
          @pointerup="end"
          @pointercancel="end"
          @lostpointercapture="end"
          @keydown="key($event, t.key)"
        />
      </span>
      <span class="w-9 flex-none text-right font-mono text-f10 tabular-nums text-muted-foreground">{{ t.display }}</span>
    </div>
  </div>
</template>

<style scoped>
/* The row is 22px; the rail drawn in it is 4px. Only the dot takes a drag. */
.tb-bar {
  position: relative;
  flex: 1;
  height: 22px;
}
.tb-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 9px;
  height: 4px;
  border-radius: 9999px;
  background: hsl(var(--border));
}
/* The average mark — only meaningful where 0.5 IS the average. */
.tb-bar:not(.is-position) .tb-rail::after {
  content: "";
  position: absolute;
  left: 50%;
  top: -2px;
  width: 1px;
  height: 8px;
  background: hsl(var(--muted-foreground) / 0.6);
}
.tb-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 9999px;
  background: hsl(var(--tac-amber, 33 94% 58%));
  transition:
    width 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    left 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    right 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.is-position .tb-fill {
  background: hsl(var(--tac-amber, 33 94% 58%) / 0.45);
}
/* The value, and the only thing that drags. Always shown — it is the control —
   but quieter on a centred bar until its row is hovered, so a column of them
   stays calm. */
.tb-knob {
  position: absolute;
  top: 6px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 9999px;
  background: hsl(var(--foreground));
  box-shadow: 0 0 0 2px hsl(var(--card));
  cursor: grab;
  touch-action: none;
  outline: none;
  transition:
    background-color 120ms ease,
    transform 120ms ease,
    left 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.tb-bar:not(.is-position) .tb-knob {
  background: hsl(var(--foreground) / 0.55);
}
.tb-bar:hover .tb-knob {
  background: hsl(var(--foreground));
}
/* Bigger to the pointer than to the eye: 24px to grab, 10px drawn. */
.tb-knob::before {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: 9999px;
}
.tb-knob:hover {
  transform: scale(1.25);
}
.tb-knob:focus-visible {
  box-shadow:
    0 0 0 2px hsl(var(--card)),
    0 0 0 3px hsl(var(--tac-amber, 33 94% 58%));
}
/* Under the pointer means under the pointer: no easing while it is held. */
.tb-bar.is-dragging .tb-knob {
  cursor: grabbing;
  transition: none;
  transform: scale(1.25);
  background: hsl(var(--tac-amber, 33 94% 58%));
}
/* Where the real pattern landed, while the handle is somewhere else. */
.tb-landed {
  position: absolute;
  pointer-events: none;
  top: 4px;
  width: 2px;
  height: 14px;
  margin-left: -1px;
  border-radius: 1px;
  background: hsl(var(--foreground) / 0.8);
  transition: left 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
</style>
