<script setup lang="ts">
// THE hover action cluster for an owned item — the Inventory grid's tiles and
// the loadout rail's equipment tiles both render it, so "what can I do with
// this item" is answered identically wherever the item shows up. It lived
// inline in ItemTile until the rail needed it too; duplicating it there would
// have let the two drift the way the tile chrome already had once.
//
// Emits rather than acts: the host owns the item and the handlers.
//
// Rendered as <span>s, not <button>s, on purpose — every host puts this INSIDE
// a <button> (tile, slot), and a nested button is invalid HTML that browsers
// silently reparent, which drops the click handlers.
import { computed } from "vue";
import { Box, Copy, ExternalLink, Pencil, Trash2 } from "lucide-vue-next";
import type { InventoryItem } from "./api";
import { isReadOnly, supports3d } from "./itemVisuals";
import { isCoarse } from "./responsive";

const props = withDefaults(
  defineProps<{
    inst: InventoryItem;
    /** Tighter padding for the small square gear tiles (Zeus, C4, Music Kit…). */
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{ (e: "view3d" | "inspect" | "edit" | "duplicate" | "remove"): void }>();

// Steam-synced items are read-only server-side, so they get Duplicate where
// crafted items get Edit — never both.
const readOnly = computed(() => isReadOnly(props.inst));
// Hidden, not disabled, for types we have no models for — see supports3d.
const can3d = computed(() => supports3d(props.inst.item));

const BTN = computed(
  () =>
    `rounded border border-border/60 bg-background/70 text-muted-foreground hover:text-foreground ${props.compact ? "p-0.5" : "p-1"}`,
);
const ICON = computed(() => (props.compact ? "h-2.5 w-2.5" : "h-3 w-3"));
</script>

<template>
  <!-- Hidden on touch outright: 20px targets are unusable there, and tap /
       long-press both open the action menu, which has every one of these. -->
  <span
    v-if="!isCoarse"
    class="absolute z-[3] flex opacity-0 transition-opacity group-hover:opacity-100"
    :class="compact ? 'right-1 top-1 gap-0.5' : 'right-1.5 top-1.5 gap-1'"
  >
    <span v-if="can3d" :class="BTN" title="View in 3D" @click.stop="emit('view3d')"><Box :class="ICON" /></span>
    <!-- steam:// can't launch CS2 from a phone — hide the dead-end on touch. -->
    <span :class="BTN" title="Inspect in game" @click.stop="emit('inspect')"><ExternalLink :class="ICON" /></span>
    <span
      v-if="readOnly"
      :class="BTN"
      title="Synced from Steam and read-only — craft your own copy of it"
      @click.stop="emit('duplicate')"
    ><Copy :class="ICON" /></span>
    <span v-else :class="BTN" title="Edit item" @click.stop="emit('edit')"><Pencil :class="ICON" /></span>
    <span
      :class="[BTN, 'hover:!text-[#ff7a6a]']"
      title="Delete from inventory"
      @click.stop="emit('remove')"
    ><Trash2 :class="ICON" /></span>
  </span>
</template>
