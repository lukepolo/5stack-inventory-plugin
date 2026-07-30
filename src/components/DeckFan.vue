<script setup lang="ts">
// The two colour layers fanned out behind a colour deck.
//
// Byte-identical at three call sites (inventory grid, sheet Owned, sheet Craft)
// before this — the only difference between the copies was the name of the
// v-for index variable.
//
// The scale is what keeps it neighbourly: the card fills its whole grid cell, so
// anything visible behind it is out in the gap, and 0.88 at 5° puts the corners
// ~5px out — half the gap, so two adjacent stacks never touch. Saturated,
// because 5px of a wash is 5px of nothing.
defineProps<{
  /** Rarity/tint hexes for the layers, nearest last. Usually two. */
  colors: readonly string[];
}>();
</script>

<template>
  <span
    v-for="(hex, i) in colors"
    :key="i"
    class="pointer-events-none absolute inset-0 rounded-lg border"
    :style="{
      transform: `rotate(${i === 0 ? -5 : 5}deg) scale(0.88)`,
      transformOrigin: 'bottom center',
      borderColor: hex,
      background: `color-mix(in srgb, ${hex} 70%, hsl(var(--card)))`,
    }"
  ></span>
</template>
