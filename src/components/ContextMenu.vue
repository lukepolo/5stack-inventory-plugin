<script lang="ts">
/**
 * THE row inside a context menu. Fourteen copies of this string existed across
 * the two menus; exported so the rows stay one decision even though each menu
 * supplies its own.
 */
export const MENU_ROW =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-f13 transition-colors hover:bg-muted";
</script>

<script setup lang="ts">
// THE context menu — cursor-anchored on desktop, a bottom sheet on compact.
//
// The slot menu and the item menu were two copies of this, and they had drifted
// in ways that were bugs rather than choices:
//
//  - the slot menu had no `max-h`/`overflow-y-auto`, so a long menu on a short
//    phone ran off the bottom of the screen with no way to reach the rest;
//  - its compact drag header was not `sticky`, so the grab area scrolled away;
//  - the two panels were 204px and 214px wide for no stated reason.
//
// This takes the scrollable, sticky, 214px form — the strictly more capable one.
//
// `data-role="menu-sheet"`: BOTH menus used to carry `data-role="slot-menu"`,
// and style.css keys off that role for the touch-sized row padding and the
// `env(safe-area-inset-bottom)` gesture-bar clearance. The item menu was
// inheriting both by accident, so the role could not simply be renamed on one
// of them without silently regressing it — style.css moved to this shared role
// in the same change.
import { isCompact } from "../responsive";
import { useSwipeDismiss } from "../composables/useSwipeDismiss";
import { Z } from "../zLayers";

defineProps<{
  /** Cursor anchor. Ignored on compact, which is a bottom sheet with no cursor. */
  at: { x: number; y: number } | null;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

// Its own instance rather than App's: only one menu is ever open, so there is no
// state to share, and owning it keeps the drag entirely inside the component.
const swipe = useSwipeDismiss();
const handlers = swipe.forSheet(() => emit("close"));
</script>

<template>
  <!-- Compact swaps the plain cross-fade for sheet motion — the backdrop fades
       while the panel travels, which a single opacity transition on the root
       can't express. -->
  <Transition
    :enter-active-class="isCompact ? 'animate-sheet-enter' : 'transition duration-150'"
    :enter-from-class="isCompact ? '' : 'opacity-0'"
    :leave-active-class="isCompact ? 'animate-sheet-leave' : 'transition duration-100'"
    :leave-to-class="isCompact ? '' : 'opacity-0'"
  >
    <div
      v-if="at"
      class="fixed inset-0"
      :style="{ zIndex: Z.menu }"
      :class="isCompact && 'bg-background/60'"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <!-- Compact drops the cursor anchoring for a bottom sheet: the menu is
           opened by long-press (no cursor to anchor to), and the desktop clamp
           assumes a window wide enough for `innerWidth - 220` to be a sane left
           edge, which at 400px it is not. -->
      <div
        data-role="menu-sheet"
        data-sheet
        role="menu"
        :class="isCompact
          ? 'absolute inset-x-0 bottom-0 max-h-[80%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-card shadow-2xl'
          : 'absolute min-w-[214px] origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl'"
        :style="isCompact ? swipe.style.value : { left: (at?.x ?? 0) + 'px', top: (at?.y ?? 0) + 'px' }"
        @click.stop
      >
        <!-- The WHOLE header is the grab area, pill and title together. A 20px
             pill is not a target anyone hits on a phone, and a swipe that misses
             it lands on the page — where the browser reads it as pull-to-refresh
             and reloads the panel out from under you. `touch-none` is what
             denies the browser that gesture; it has to be on the element the
             finger actually starts on, hence the whole strip. -->
        <div v-if="isCompact" class="sticky top-0 z-[2] touch-none border-b border-border bg-card" v-on="handlers">
          <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
          <div class="truncate px-3 pb-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
            <slot name="title" />
          </div>
        </div>
        <div v-else class="truncate border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          <slot name="title" />
        </div>
        <slot />
      </div>
    </div>
  </Transition>
</template>
