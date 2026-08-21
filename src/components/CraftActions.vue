<script setup lang="ts">
// WHAT YOU CAN DO WITH THIS ITEM — inspect it in game, share it, edit or delete
// it, or throw the craft away and start again.
//
// One component because the row moves: VIEWING puts it in the screen's actions
// row, beside the 2D/3D switch, where "what can I do with this" belongs on a
// screen whose whole right-hand side is the item's details. EDITING puts it at
// the top of the form instead — the editor's own column is where the work is,
// and Reset in particular is about the form rather than about the item.
//
// The buttons gate themselves on the mode (Reset is edit-only, edit and delete
// are view-only), so both placements render the same component and each control
// appears exactly once.
import { ExternalLink, Copy, Pencil, RotateCcw, Trash2 } from "lucide-vue-next";
import ShareMenu from "./ShareMenu.vue";
import { isCompact } from "../responsive";

defineProps<{
  viewOnly: boolean;
  /** This item has a defindex — a steam:// inspect link is possible. */
  canInspect?: boolean;
  /** The link has been handed to the OS and CS2 has not surfaced yet. */
  linkOpening?: boolean;
  shareLinks: InstanceType<typeof ShareMenu>["$props"]["links"];
  shareNote?: string;
  /** Edit is offered (owned, customizable, and you may edit it). */
  canEditItem?: boolean;
  /** The item is synced from Steam: editing means crafting your own copy. */
  readOnly?: boolean;
  canDelete?: boolean;
  /** ShareMenu's button styling on compact — the caller owns that token. */
  compactBtnClass?: string;
}>();

const emit = defineEmits<{
  (e: "inspect"): void;
  (e: "edit"): void;
  (e: "delete"): void;
  (e: "reset"): void;
}>();
</script>

<template>
  <div class="flex flex-none items-center gap-2.5">
    <button
      v-if="canInspect"
      class="flex flex-none items-center justify-center gap-1.5 rounded-md border border-border uppercase tracking-wider text-muted-foreground tac-action"
      :class="isCompact ? 'h-10 w-10' : 'px-2.5 py-1 text-f10'"
      :title="viewOnly
        ? 'Launch CS2 and inspect this item in-game'
        : 'Launch CS2 and inspect exactly what\'s in the editor right now — saving not required'"
      @click="emit('inspect')"
    >
      <!-- Icon-only on compact: the label is what pushes this row past a
           phone's width. -->
      <ExternalLink :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3 w-3'" />
      <template v-if="!isCompact">{{ linkOpening ? "Opening…" : "Inspect in game" }}</template>
    </button>
    <ShareMenu :links="shareLinks" :note="shareNote" :btn-class="isCompact ? compactBtnClass : undefined" />
    <!-- Also in the footer, deliberately. This row is where the eye goes for
         "what can I do with this item", and on a tall details panel the footer
         copy can be a scroll away. -->
    <button
      v-if="viewOnly && canEditItem"
      class="grid place-items-center rounded-md border border-border text-muted-foreground tac-action"
      :class="isCompact ? 'h-10 w-10' : 'h-7 w-7'"
      :title="readOnly ? 'Synced from Steam and read-only — craft your own copy of it' : 'Edit this item'"
      @click="emit('edit')"
    >
      <Copy v-if="readOnly" :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
      <Pencil v-else :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
    </button>
    <!-- Destructive, so it keeps its distance from the commit at the bottom of
         the screen. -->
    <button
      v-if="viewOnly && canDelete"
      class="grid place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]"
      :class="isCompact ? 'h-10 w-10' : 'h-7 w-7'"
      title="Delete from inventory"
      @click="emit('delete')"
    >
      <Trash2 :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
    </button>
    <button
      v-if="!viewOnly"
      class="flex items-center gap-1.5 rounded-md border border-border text-muted-foreground tac-action"
      :class="isCompact ? 'h-10 px-3 text-f11 uppercase tracking-wider' : 'px-2.5 py-1 text-f10 uppercase tracking-wider'"
      title="Reset all options"
      @click="emit('reset')"
    >
      <RotateCcw :class="isCompact ? 'h-4 w-4' : 'h-3 w-3'" /> Reset
    </button>
  </div>
</template>
