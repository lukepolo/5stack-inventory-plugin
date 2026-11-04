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
//
// Every control is its icon, named by the panel's Tooltip on hover. The labels
// ("Inspect in game", "Share", "Reset") were most of the row's width and pushed
// it onto a second line beside the 2D/3D switch.
import { ExternalLink, Copy, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-vue-next";
import ShareMenu from "./ShareMenu.vue";
import Tooltip from "./Tooltip.vue";
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
    <Tooltip
      v-if="canInspect"
      :text="viewOnly ? 'Inspect in game' : 'Inspect in game — exactly what\'s in the editor, no need to save'"
    >
      <button
        class="grid flex-none place-items-center rounded-md border border-border text-muted-foreground tac-action"
        :class="isCompact ? 'h-10 w-10' : 'h-8 w-8'"
        :aria-label="linkOpening ? 'Opening CS2…' : 'Inspect in game'"
        @click="emit('inspect')"
      >
        <!-- Handed to the OS and CS2 not up yet: the icon spins in place of the
             "Opening…" the label used to say. -->
        <Loader2 v-if="linkOpening" class="animate-spin" :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
        <ExternalLink v-else :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
      </button>
    </Tooltip>
    <!-- Nothing to share, no button: focus on a default weapon, or a visitor
         whose item has no public link. -->
    <ShareMenu
      v-if="shareLinks.length"
      icon
      :links="shareLinks"
      :note="shareNote"
      :btn-class="isCompact ? 'grid h-10 w-10 place-items-center rounded-md border' : 'grid h-8 w-8 place-items-center rounded-md border'"
    />
    <!-- Also in the footer, deliberately. This row is where the eye goes for
         "what can I do with this item", and on a tall details panel the footer
         copy can be a scroll away. -->
    <Tooltip
      v-if="viewOnly && canEditItem"
      :text="readOnly ? 'Synced from Steam and read-only — craft your own copy' : 'Edit this item'"
    >
      <button
        class="grid place-items-center rounded-md border border-border text-muted-foreground tac-action"
        :class="isCompact ? 'h-10 w-10' : 'h-8 w-8'"
        :aria-label="readOnly ? 'Craft your own copy' : 'Edit this item'"
        @click="emit('edit')"
      >
        <Copy v-if="readOnly" :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
        <Pencil v-else :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
      </button>
    </Tooltip>
    <!-- Destructive, so it keeps its distance from the commit at the bottom of
         the screen. -->
    <Tooltip v-if="viewOnly && canDelete" text="Delete from inventory">
      <button
        class="grid place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]"
        :class="isCompact ? 'h-10 w-10' : 'h-8 w-8'"
        aria-label="Delete from inventory"
        @click="emit('delete')"
      >
        <Trash2 :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
      </button>
    </Tooltip>
    <Tooltip v-if="!viewOnly" text="Reset all options">
      <button
        class="grid place-items-center rounded-md border border-border text-muted-foreground tac-action"
        :class="isCompact ? 'h-10 w-10' : 'h-8 w-8'"
        aria-label="Reset all options"
        @click="emit('reset')"
      >
        <RotateCcw :class="isCompact ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'" />
      </button>
    </Tooltip>
  </div>
</template>
