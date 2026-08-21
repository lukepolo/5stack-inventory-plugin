<script setup lang="ts">
// ONE ITEM, ONE SCREEN — the layout both places use, top to bottom.
//
// The focus view and the item modal kept ending up different in ways nobody
// chose: the same identity block would sit above the stage in one and under a
// dialog title bar in the other, the actions would be in a different row, the
// spacing would drift. Sharing the PIECES was not enough, because the ORDER is
// the thing that made them look like two screens — and order lives in whoever
// writes the markup. So it lives here now, once:
//
//   identity ............... actions        the item, and what you can do to it
//   ─────────────────────────────────
//   stage                                   the picture, whatever is in it
//   ─────────────────────────────────
//   footer                                  whatever the screen adds under it
//
// A caller supplies the CONTENT of those rows and cannot reorder them, which is
// the whole point: the next surface that shows an item gets the same screen for
// free, and the two that exist cannot drift apart again.
import { onBeforeUnmount, ref, watch } from "vue";
import { PanelRightOpen } from "lucide-vue-next";
import ItemIdentity from "./ItemIdentity.vue";

const props = defineProps<{
  /** Passed through to ItemIdentity — see it for the shape. */
  identity: InstanceType<typeof ItemIdentity>["$props"];
  /** First person — folds the details panel away. See below. */
  held?: boolean;
}>();

const emit = defineEmits<{
  /**
   * What the details panel covers, in CSS pixels — 0 when it is folded. The
   * viewer shifts its framing by half of this so the model sits in the middle
   * of what is VISIBLE. Measured rather than declared: a width that is a class
   * here and a constant in two other files is how those stop agreeing.
   */
  (e: "panel-width", px: number): void;
}>();

/**
 * The details panel, open or folded away.
 *
 * FIRST PERSON FOLDS IT BY DEFAULT. A held weapon is meant to fill the frame —
 * it is the one view where the pane is the picture rather than a stage with a
 * model standing on it — and a 300px panel over the right-hand third is the
 * difference between "this is what it looks like in game" and "a screenshot
 * with a sidebar".
 *
 * IT HANGS OFF THE SCREEN, NOT THE PANE. Anchored inside the stage it started
 * at the stage's top edge, which is BELOW the item's name — so the tab that
 * brings it back sat half a screen under the Share button it lines up with.
 * Here the top of the screen is the actions row, and `top-12` is directly
 * beneath it.
 */
const panelOpen = ref(true);
watch(
  () => props.held,
  (h) => (panelOpen.value = !h),
  { immediate: true },
);
const panelEl = ref<HTMLElement | null>(null);
let panelRO: ResizeObserver | null = null;
watch(panelEl, (el) => {
  panelRO?.disconnect();
  panelRO = null;
  if (!el) {
    emit("panel-width", 0);
    return;
  }
  panelRO = new ResizeObserver(() => emit("panel-width", el.offsetWidth));
  panelRO.observe(el);
  emit("panel-width", el.offsetWidth);
});
onBeforeUnmount(() => panelRO?.disconnect());
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- The header row. `items-start` because the identity is three lines tall
         and the actions are one — they align to the top of the name, not to the
         middle of the block. -->
    <!-- ABOVE the info column (z-5) and its reopen tab (z-6), not level with the
         stage at z-2. The actions slot opens popovers that hang DOWN from the
         header across both of them, and at z-2 the column painted straight
         through them — the sticker chip, PATTERN, the wear bar and the StatTrak
         readout all sat on top of the panel they were covering. A popover's own
         z is no defence: ShareMenu asks for 1001 and still lost, because that
         number is spent INSIDE this row's stacking context, not against the
         column outside it. Header chrome and anything it opens go last; the two
         never overlap geometrically (the column starts at top-12), so nothing
         else about the screen moves. -->
    <!-- OVER THE STAGE, not above it. The header used to hold a row of its own,
         which cost the model the height of the item's name — a band of card at
         the top with nothing in it but text on a flat background. The pane now
         runs the card's full height and the chrome sits ON it.
         NOTHING BEHIND THE TEXT. A scrim across the top was the obvious way to
         keep it legible and the wrong one: it greys the picture the panorama
         was chosen for, and it does it across the whole width whether anything
         is written there or not. The type carries its own contrast instead —
         see `over-art` in the stylesheet, a shadow that costs the image
         nothing. Pointer-transparent except the controls: the gap between the
         name and the buttons is stage, and dragging there turns the model. -->
    <div class="over-art pointer-events-none absolute inset-x-0 top-0 z-[7] flex items-start justify-between gap-4">
      <div class="pointer-events-auto"><ItemIdentity v-bind="identity" /></div>
      <div class="pointer-events-auto flex flex-none items-center gap-2.5"><slot name="actions" /></div>
    </div>
    <div class="relative z-[2] flex min-h-0 flex-1 gap-5"><slot /></div>

    <!-- Folded: a tab directly under the actions, in the corner the panel came
         from, so getting it back is where losing it happened. -->
    <button
      v-if="$slots.panel && !panelOpen"
      class="absolute right-0 top-12 z-[6] flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-f9 uppercase tracking-cs2 text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
      title="Show this item's details"
      @click="panelOpen = true"
    >
      <PanelRightOpen class="h-3.5 w-3.5" /> Details
    </button>
    <!-- `pointer-events-none` on the rail, restored on the panel: the empty
         space under a short list is stage, and dragging the model there should
         turn it. -->
    <div
      v-if="$slots.panel && panelOpen"
      ref="panelEl"
      class="pointer-events-none absolute bottom-0 right-0 top-12 z-[5] flex w-[308px] flex-col overflow-y-auto pb-2 pl-2"
    >
      <div class="pointer-events-auto flex flex-col gap-2.5">
        <!-- The way back out, on the panel's own top edge rather than as a
             floating X: it is a fold, not a dismissal. -->
        <button
          v-if="held"
          class="-mb-1 self-end text-f9 uppercase tracking-cs2 text-muted-foreground/60 transition-colors hover:text-foreground"
          title="Hide these details"
          @click="panelOpen = false"
        >
          Hide
        </button>
        <slot name="panel" />
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
