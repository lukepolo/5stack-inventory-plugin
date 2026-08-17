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
import { Box, Copy, Crosshair, ExternalLink, Pencil, Trash2 } from "lucide-vue-next";
import type { InventoryItem } from "../api";
import { canInspect, isCustomizable, isReadOnly } from "../itemVisuals";
import { resolveViewerModelSync } from "../viewerModel";
import { isCoarse } from "../responsive";

const props = withDefaults(
  defineProps<{
    /**
     * Nullable because a loadout slot can hold a DEFAULT — a model, not an item
     * anyone owns. There is nothing to inspect, edit or delete there, but the
     * slot can still be focused, so `focus` is the only action that survives.
     */
    inst: InventoryItem | null;
    /** Tighter padding for the small square gear tiles (Zeus, C4, Music Kit…). */
    compact?: boolean;
    /**
     * Lead with a "Focus" action — only the loadout's weapon cells have somewhere
     * to focus TO, so it is opt-in.
     *
     * This is the one thing the weapon column's hand-rolled copy of this cluster
     * had that the component didn't, and it was the excuse for the copy existing.
     */
    focus?: boolean;
  }>(),
  { compact: false, focus: false },
);

const emit = defineEmits<{ (e: "focus" | "view3d" | "inspect" | "edit" | "duplicate" | "remove"): void }>();

// Steam-synced items are read-only server-side, so they get Duplicate where
// crafted items get Edit — never both.
const readOnly = computed(() => !!props.inst && isReadOnly(props.inst));
// Hidden, not disabled, for types we have no models for.
//
// Asks the RESOLVER, not the type set: `supports3d` answers per TYPE, and the
// per-ITEM answer is narrower — a painted glove is a glove we cannot composite
// yet. Offering the button and landing on the flat image is exactly the "reads
// as broken" the type gate was written to avoid, so it has to be the same
// question the mount site will ask. `undefined` means "a charm, needs a lookup",
// which is still a yes.
const can3d = computed(() => !!props.inst && resolveViewerModelSync(props.inst.item) !== null);
// Same treatment for Edit: a graffiti has no float, pattern, StatTrak, name tag
// or attachment slots, so the pencil opened an empty form. See isCustomizable.
const canEditItem = computed(() => !!props.inst && isCustomizable(props.inst.item));
// Not every economy item has a defindex to build a steam:// link around — see
// canInspect. Hidden rather than left to fail with a toast on click.
const canInspectItem = computed(() => !!props.inst && canInspect(props.inst.item));

// `tac-action` carries the hover (tactical amber border + foreground icon) and
// the transition — see style.css. It's the same treatment the header tools and
// the modal actions wear, which is the point: an action looks like an action
// wherever it turns up.
const BTN = computed(
  () =>
    `tac-action rounded border border-border/60 bg-background/70 text-muted-foreground ${props.compact ? "p-0.5" : "p-1"}`,
);
const ICON = computed(() => (props.compact ? "h-2.5 w-2.5" : "h-3 w-3"));
</script>

<template>
  <!-- Hidden on touch outright: 20px targets are unusable there, and tap /
       long-press both open the action menu, which has every one of these. -->
  <span
    v-if="!isCoarse && (inst || focus)"
    class="absolute z-[3] flex opacity-0 transition-opacity group-hover:opacity-100"
    :class="compact ? 'right-1 top-1 gap-0.5' : 'right-1.5 top-1.5 gap-1'"
  >
    <span v-if="focus" :class="BTN" title="Focus" @click.stop="emit('focus')"><Crosshair :class="ICON" /></span>
    <span v-if="can3d" :class="BTN" title="View in 3D" @click.stop="emit('view3d')"><Box :class="ICON" /></span>
    <!-- steam:// can't launch CS2 from a phone — hide the dead-end on touch. -->
    <span v-if="canInspectItem" :class="BTN" title="Inspect in game" @click.stop="emit('inspect')"><ExternalLink :class="ICON" /></span>
    <span
      v-if="readOnly"
      :class="BTN"
      title="Synced from Steam and read-only — craft your own copy of it"
      @click.stop="emit('duplicate')"
    ><Copy :class="ICON" /></span>
    <span v-else-if="canEditItem" :class="BTN" title="Edit item" @click.stop="emit('edit')"><Pencil :class="ICON" /></span>
    <!-- Guarded like the rest: with no instance there is nothing to delete, and
         a default weapon offering a bin was the one action that used to escape
         the null check. -->
    <span
      v-if="inst"
      :class="[BTN, 'hover:!border-[#e04a3a] hover:!text-[#ff7a6a]']"
      title="Delete from inventory"
      @click.stop="emit('remove')"
    ><Trash2 :class="ICON" /></span>
  </span>
</template>
