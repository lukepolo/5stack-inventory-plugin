<script setup lang="ts">
// THE one way an item's picture renders. Crafted instances show their baked
// true render (3D snapshot incl. paint, wear, seed, stickers, charm); when
// the bake doesn't exist yet the catalog art shows immediately and a bake is
// queued in the background (App provides the canonical helpers — no view
// gets to invent its own fallback chain, that's how the tiles drifted apart).
// Un-crafted items (or none) just show catalog art.
import { computed, inject } from "vue";
import type { InventoryItem } from "./api";

const props = defineProps<{
  inst?: InventoryItem | null;
  image?: string | null;
}>();

const art = inject<{
  renderSrc: (i: InventoryItem) => string;
  onRenderError: (e: Event, i: InventoryItem) => void;
} | null>("itemArt", null);

const src = computed(() =>
  props.inst && art ? art.renderSrc(props.inst) : (props.image ?? undefined),
);

function onError(e: Event) {
  if (props.inst && art) {
    art.onRenderError(e, props.inst);
  } else {
    // Catalog art 404 — blank beats a broken-image glyph.
    (e.target as HTMLImageElement).style.visibility = "hidden";
  }
}
</script>

<template>
  <img v-if="src" :src="src" alt="" loading="lazy" @error="onError" />
</template>
