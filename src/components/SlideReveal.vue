<script setup lang="ts">
// Text that slides open sideways instead of popping in: the header's "Focus" →
// "Focused" suffix, and the screen tabs' labels (only the live tab spells its
// name, which is what keeps the header on one row).
//
// The slot sits in a one-column grid whose track goes 0fr → 1fr — a width:auto
// you CAN transition — on the same 150ms the borders and fills around it take,
// so the button grows with it. The inner span needs min-w-0 or the track can't
// shrink below the text, and nowrap or a two-word label folds onto a second
// line on its way closed.
defineProps<{ open: boolean }>();
</script>

<template>
  <span
    class="grid"
    :style="{
      gridTemplateColumns: open ? '1fr' : '0fr',
      opacity: open ? 1 : 0,
      transition: 'grid-template-columns 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    }"
    :aria-hidden="!open"
  ><span class="min-w-0 overflow-hidden whitespace-nowrap"><slot /></span></span>
</template>
