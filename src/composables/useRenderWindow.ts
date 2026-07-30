// The client half of infinite scrolling — pairs 1:1 with InfiniteSentinel.vue,
// which calls `grow` when the end of the list comes into view.
//
// The catalog lists behind these grids are big (2.2k graffiti, 578 knives, and
// an inventory can be thousands of items) and every tile is a card with
// artwork, so committing the whole list to the DOM at once is what actually
// made these screens feel capped. The window grows a page at a time; nothing is
// ever unreachable.
import { computed, ref, watch, type ComputedRef } from "vue";

/** How many more items each scroll-triggered growth adds. */
export const WINDOW_STEP = 60;

/**
 * How many mount on the FIRST paint of a new list, and the cutoff for the
 * entrance cascade — see `invCellDelay` (grids) and `sheetCellClass` (sheet).
 *
 * Smaller than the growth step, which is the point. Every list change replaces
 * the cards rather than moving them (see invFilterSig), so the whole window is
 * created in one synchronous task — and at 60 image-bearing cards that task is
 * long enough to eat the frames the tab indicator and the cards' own entrance
 * need, which reads as both of them stalling. Roughly a viewport's worth mounts
 * up front and the sentinel tops the rest up over later frames, where there is
 * nothing to compete with.
 */
export const WINDOW_FIRST = 24;

/**
 * `reset` is a getter over the FILTER inputs, not the list itself. Watching the
 * list would send you back to the top of the grid every time anything mutated it
 * — a render landing, an equip re-sorting — while changing a filter genuinely
 * should start over at page one.
 */
export function useRenderWindow<T>(
  source: ComputedRef<T[]>,
  reset: () => unknown,
  step = WINDOW_STEP,
  first = WINDOW_FIRST,
) {
  const shown = ref(first);
  watch(reset, () => {
    shown.value = first;
  });
  return {
    items: computed(() => (shown.value >= source.value.length ? source.value : source.value.slice(0, shown.value))),
    done: computed(() => shown.value >= source.value.length),
    grow: () => {
      shown.value += step;
    },
  };
}
