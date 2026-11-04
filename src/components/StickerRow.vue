<script setup lang="ts">
// ONE applied sticker as a row: where it stacks, what it is, its scratch, and —
// behind its own position button — its exact placement (per row, not a mode
// for the whole list: you open the one sticker you are nudging).
//
// SHOWCASE (decided from the slot-row prototype): the sticker fills a dark
// plate, its name and wear sit along the plate's bottom edge, its options
// float in the corner, and a thin wear bar runs underneath. Every row is one
// height (the name is one line), so the Seams links read straight down. The gun's
// sticker section and the mat both list their stickers with it, so wear and
// placement look and work the same in both places.
//
// The list around it owns ordering (a gun swaps slots, the mat restacks) and
// selection; this owns the row. Its controls stop `pointerdown`, so dragging a
// slider or typing a number never starts the list's row drag.
import { ref } from "vue";
import { Copy, GripVertical, SlidersHorizontal, X } from "lucide-vue-next";

withDefaults(
  defineProps<{
    image?: string | null;
    name: string;
    /** The slot number on a gun; the slot on the mat. */
    label: string;
    wear: number;
    x?: number | null;
    y?: number | null;
    r?: number | null;
    /** What X / Y are measured in: "cm" on the mat, the game's own offsets on a gun. */
    unit?: string;
    /** X / Y field step. */
    step?: number;
    selected?: boolean;
    /** A drag handle: the row is one of a reorderable list (useSortableList —
     *  a finger drags by it, a mouse by anywhere on the row's top line). */
    grip?: boolean;
    /** Offer Duplicate beside Remove. */
    copyable?: boolean;
    /** Taller targets for a finger. */
    coarse?: boolean;
  }>(),
  { image: null, x: null, y: null, r: null, unit: "", step: 0.05, selected: false, grip: false, copyable: false, coarse: false },
);

const emit = defineEmits<{
  (e: "wear", w: number): void;
  (e: "place", key: "x" | "y" | "r", v: number): void;
  (e: "remove"): void;
  (e: "copy"): void;
}>();

/** Exact X / Y / ROT shown under the wear: this row's position button. */
const exact = ref(false);
const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
function place(key: "x" | "y" | "r", e: Event) {
  const v = num(e);
  if (Number.isFinite(v)) emit("place", key, v);
}
const fixed = (v: number | null | undefined, d: number) => (v == null ? "" : String(Math.round(v * 10 ** d) / 10 ** d));

const CELL = "flex min-w-0 items-center gap-1 whitespace-nowrap font-mono text-f8 text-muted-foreground";
const FIELD =
  "h-6 w-full min-w-0 flex-1 rounded border border-input bg-background px-1 text-f10 outline-none focus:border-[color:var(--acc)]";
const ICON = "grid flex-none place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground";
</script>

<template>
  <div
    class="srow-card flex flex-col gap-1.5 rounded-[10px] border p-1.5 text-muted-foreground transition-colors"
    :class="selected ? 'text-foreground' : 'border-border/70 bg-secondary/30 hover:border-border'"
    :style="selected ? { background: 'hsl(var(--tac-amber) / 0.06)', borderColor: 'hsl(var(--tac-amber) / 0.55)' } : undefined"
  >
    <!-- The plate: the sticker big, its slot, its options, its name. -->
    <div class="srow-plate relative grid place-items-center overflow-hidden rounded-[7px]">
      <img v-if="image" :src="image" alt="" class="srow-art pointer-events-none object-contain" draggable="false" />
      <span class="absolute left-2 top-2 flex items-center gap-1">
        <slot name="lead" />
        <span
          v-if="grip"
          class="srow-grip flex cursor-grab items-center text-muted-foreground/60"
          data-sort-grip
          aria-hidden="true"
        ><GripVertical class="h-3 w-3" /></span>
        <span class="font-mono text-f10 text-muted-foreground/70">{{ label }}</span>
      </span>
      <!-- Options float over the plate: on hover or focus with a mouse, always
           for a finger, and kept while the position fields are open. -->
      <span class="srow-ops absolute right-1 top-1 flex gap-px rounded-[7px] p-0.5" :class="exact || coarse ? 'srow-keep' : ''">
        <button
          type="button"
          :class="[ICON, coarse ? 'h-9 w-9' : 'h-6 w-6', exact ? '!text-[hsl(var(--tac-amber))]' : '']"
          :aria-label="(exact ? 'Hide the exact position of ' : 'Exact position of ') + name"
          :aria-pressed="exact"
          :title="exact ? 'Hide the exact position' : 'Exact position — X, Y and rotation'"
          @pointerdown.stop
          @click.stop="exact = !exact"
        ><SlidersHorizontal class="h-3.5 w-3.5" /></button>
        <button
          v-if="copyable"
          type="button"
          :class="[ICON, coarse ? 'h-9 w-9' : 'h-6 w-6']"
          :aria-label="'Duplicate ' + name"
          :title="'Duplicate (Ctrl/⌘ + D)'"
          @pointerdown.stop
          @click.stop="emit('copy')"
        ><Copy class="h-3.5 w-3.5" /></button>
        <button
          type="button"
          :class="[ICON, coarse ? 'h-9 w-9' : 'h-6 w-6', 'hover:!text-[#ff7a6a]']"
          :aria-label="'Remove ' + name"
          :title="'Remove ' + name"
          @pointerdown.stop
          @click.stop="emit('remove')"
        ><X class="h-3.5 w-3.5" /></button>
      </span>
      <span class="srow-cap absolute inset-x-0 bottom-0 flex items-end gap-2 px-2.5">
        <span class="min-w-0 flex-1 truncate text-f12 font-medium text-foreground" :title="name">{{ name }}</span>
        <span class="flex-none font-mono text-f10 text-muted-foreground">{{ wear.toFixed(2) }}</span>
      </span>
    </div>
    <!-- Scratch wear: a thin bar the width of the plate. -->
    <label class="flex items-center gap-2 px-1" @pointerdown.stop>
      <span class="flex-none font-mono text-f8 uppercase tracking-cs1 text-muted-foreground">Wear</span>
      <input
        :value="wear"
        type="range" min="0" max="1" step="0.01"
        class="wear-range min-w-0 flex-1"
        :aria-label="name + ' scratch wear'"
        @input="emit('wear', num($event))"
      />
    </label>
    <!-- Exact placement — dragging in 3D is the way in; these are for numbers. -->
    <div v-if="exact" class="grid grid-cols-3 gap-1.5 px-1" @pointerdown.stop>
      <label :class="CELL">X<template v-if="unit"> {{ unit }}</template>
        <input :class="FIELD" type="number" :step="step" placeholder="0" :value="fixed(x, 2)" @input="place('x', $event)" />
      </label>
      <label :class="CELL">Y<template v-if="unit"> {{ unit }}</template>
        <input :class="FIELD" type="number" :step="step" placeholder="0" :value="fixed(y, 2)" @input="place('y', $event)" />
      </label>
      <!-- ±180, the range the GAME stores (it folds anything past 180). -->
      <label :class="CELL">ROT
        <input :class="FIELD" type="number" step="0.5" min="-180" max="180" placeholder="0" :value="fixed(r, 1)" @input="place('r', $event)" />
      </label>
    </div>
  </div>
</template>

<style scoped>
/* The handle a finger can drag by; the rest of a row scrolls the list. */
.srow-grip {
  touch-action: none;
}
/* SHOWCASE (decided from the slot-row prototype): the sticker on a dark plate,
   big enough to read at a glance. Fixed height, so every slot is one size and
   the Seams rail can sit at the plate's middle. */
.srow-plate {
  height: 104px;
  background: radial-gradient(120% 90% at 50% 40%, #1b1e22, #0f1113);
}
.srow-art {
  height: 92px;
  width: auto;
  max-width: 70%;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
}
.srow-ops {
  background: rgba(12, 13, 15, 0.72);
  backdrop-filter: blur(6px);
  transition: opacity 150ms ease-out;
}
@media (hover: hover) and (pointer: fine) {
  .srow-card:not(:hover):not(:focus-within) .srow-ops:not(.srow-keep) {
    opacity: 0;
  }
}
.srow-cap {
  padding-top: 18px;
  padding-bottom: 7px;
  background: linear-gradient(transparent, rgba(8, 9, 10, 0.88));
}
</style>
