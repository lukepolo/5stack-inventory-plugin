<script setup lang="ts">
// THE compact filter sheet — a bottom sheet of facet controls.
//
// The inventory grid and the loadout picker each had their own ~150-line copy of
// this, and the inventory one's comment claimed they were "deliberately the same
// sheet as the picker's, down to the chip styling". They were not:
//
//  - it carried `data-role="inv-filter-sheet"`, which is NOT in style.css's
//    sheet-motion selector, so it faded in where its twin slid up;
//  - its chips hand-rolled ~30px targets while the picker used the 36px
//    INV_CHIP constant documented as the minimum for a phone.
//
// The chrome lives here; the facet sections stay at the call site, since what
// you can filter genuinely differs between a drawer of things you own and a
// catalog of things you don't.
import { isCompact } from "../responsive";
import { useSwipeDismiss } from "../composables/useSwipeDismiss";
import { Z } from "../zLayers";

defineProps<{
  open: boolean;
  /** Non-zero shows the Reset button, and is the count of active filters. */
  activeCount: number;
}>();

const emit = defineEmits<{ (e: "close"): void; (e: "reset"): void }>();

// Its own instance: only one sheet is open at a time, and owning the drag keeps
// it out of the host's state.
const swipe = useSwipeDismiss();
const handlers = swipe.forSheet(() => emit("close"));
</script>

<template>
  <Transition enter-active-class="animate-sheet-enter" leave-active-class="animate-sheet-leave">
    <div
      v-if="isCompact && open"
      class="fixed inset-0 bg-background/60"
      :style="{ zIndex: Z.modal }"
      @click="emit('close')"
    >
      <div
        data-role="filter-sheet"
        data-sheet
        class="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-card shadow-2xl"
        :style="swipe.style.value"
        @click.stop
      >
        <!-- Whole header grabs, Reset included — the lazy capture in
             useSwipeDismiss keeps that button's tap working. -->
        <div class="sticky top-0 z-[2] touch-none bg-card pt-1" v-on="handlers">
          <div class="flex justify-center py-2"><span class="h-1 w-9 rounded-full bg-muted-foreground/30"></span></div>
          <div class="flex items-center gap-2 border-b border-border px-4 pb-2">
            <span class="text-f10 uppercase tracking-cs2 text-muted-foreground"><slot name="title" /></span>
            <button
              v-if="activeCount"
              class="ml-auto rounded-md border border-border px-2 py-1 text-f9 uppercase tracking-cs1 text-muted-foreground"
              @click="emit('reset')"
            >
              Reset
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-4 px-4 pb-5 pt-3">
          <slot />
        </div>
      </div>
    </div>
  </Transition>
</template>
