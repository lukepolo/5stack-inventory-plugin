<script setup lang="ts">
// THE one way an item's picture renders. Crafted instances show their baked
// true render (3D snapshot incl. paint, wear, seed, stickers, charm); when
// the bake doesn't exist yet the catalog art shows immediately and a bake is
// queued in the background (App provides the canonical helpers — no view
// gets to invent its own fallback chain, that's how the tiles drifted apart).
// Catalogue items share App's stored-card/model fallback where available.
import { computed, inject } from "vue";
import type { InventoryItem, Skin } from "../api";

const props = defineProps<{
  inst?: InventoryItem | null;
  image?: string | null;
  /** Catalogue items can use App's shared stored-card/model fallback. */
  catalog?: Skin | null;
}>();

const art = inject<{
  renderSrc: (i: InventoryItem) => string;
  onRenderError: (e: Event, i: InventoryItem) => void;
} | null>("itemArt", null);

const catalogArt = inject<{
  src: (item: Skin) => string | undefined;
  onError: (e: Event, item: Skin) => void;
} | null>("catalogArt", null);

const src = computed(() => {
  if (props.inst && art) return art.renderSrc(props.inst);
  if (props.catalog && catalogArt) return catalogArt.src(props.catalog);
  return props.image ?? undefined;
});

// A failed image is hidden, and that inline style belongs to the ELEMENT, not
// to the URL that failed — Vue keeps the same <img> when `src` changes. So a
// cell whose catalog path 404'd stayed invisible after it was handed working
// art (a visitor's pet, swapped to its catalog card). Whatever loads is shown.
function onLoad(e: Event) {
  (e.target as HTMLImageElement).style.visibility = "";
}
function onError(e: Event) {
  if (props.inst && art) {
    art.onRenderError(e, props.inst);
  } else if (props.catalog && catalogArt) {
    catalogArt.onError(e, props.catalog);
  } else {
    // Catalog art 404 — blank beats a broken-image glyph.
    (e.target as HTMLImageElement).style.visibility = "hidden";
  }
}
</script>

<template>
  <!-- decoding="async": this is the art in every card of every long grid, so a
       fast scroll decodes dozens at once. Synchronous decode does that on the
       main thread, inside the scroll frames. -->
  <img v-if="src" :src="src" alt="" loading="lazy" decoding="async" @load="onLoad" @error="onError" />
</template>
