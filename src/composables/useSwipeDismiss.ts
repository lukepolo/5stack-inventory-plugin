// Swipe down to dismiss, for the compact bottom sheets.
//
// Every compact menu already draws a grab pill, which promises a drag none of
// them honoured: the only way out was tapping the backdrop, and on a tall sheet
// that means reaching over the whole thing to the strip above it — one-handed,
// the hardest pixel on the screen to hit. This makes the pill's promise true.
import { computed, ref } from "vue";
import { isCompact, reducedMotion } from "../responsive";

/**
 * Movement before a sheet drag arms — see the lazy-capture note on `forSheet`.
 * Exported because the picker sheet's own detent drag arms on the same
 * threshold, and two numbers meaning "the finger has actually moved" would
 * drift.
 */
export const SWIPE_ARM_PX = 4;

/**
 * Call ONCE per screen and hand each sheet its own handlers via `forSheet`.
 *
 * The offset is deliberately shared across every sheet rather than one set per
 * sheet: only one of these can be open at a time, and the sheet being dragged is
 * the only one mounted.
 */
export function useSwipeDismiss() {
  const offset = ref(0);

  /** Live transform for a sheet mid-swipe. No transition while the finger is
   *  down (it must track exactly), a spring back when it lifts without passing
   *  the threshold. */
  const style = computed(() =>
    offset.value
      ? { transform: `translateY(${offset.value}px)`, transition: "none" }
      : { transition: reducedMotion.value ? "none" : "transform 200ms cubic-bezier(0.22,1,0.36,1)" },
  );

  /**
   * Handlers for `v-on` on a sheet's grab area. Dismisses past a third of the
   * sheet's own height, or on a flick faster than 0.5px/ms — so a short sheet
   * needs a short drag and a tall one doesn't dismiss on a twitch.
   *
   * Capture is LAZY: taken only once the finger has actually travelled, never on
   * pointerdown. That is what lets the whole sheet header carry this without
   * swallowing taps on the controls inside it (the filter sheet's Reset button
   * sits in its header) — pointer capture retargets the click that follows, so
   * capturing eagerly would eat it.
   */
  function forSheet(close: () => void) {
    let sheet: HTMLElement | null = null;
    let dragging = false;
    let y0 = 0;
    let t0 = 0;
    const reset = () => {
      sheet = null;
      dragging = false;
      offset.value = 0;
    };
    return {
      pointerdown(e: PointerEvent) {
        if (!isCompact.value) return;
        sheet = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-sheet]");
        dragging = false;
        y0 = e.clientY;
        t0 = e.timeStamp;
      },
      // Down only. Following a finger upwards would tear the sheet off the
      // bottom edge it is anchored to and show background under it.
      pointermove(e: PointerEvent) {
        if (!sheet) return;
        const dy = e.clientY - y0;
        if (!dragging) {
          if (dy < SWIPE_ARM_PX) return;
          dragging = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        offset.value = Math.max(0, dy);
      },
      pointerup(e: PointerEvent) {
        if (!sheet || !dragging) return reset();
        const dy = Math.max(0, e.clientY - y0);
        const gone = dy > sheet.getBoundingClientRect().height / 3 || dy / Math.max(1, e.timeStamp - t0) > 0.5;
        reset();
        if (gone) close();
      },
      pointercancel: reset,
    };
  }

  return { offset, style, forSheet };
}
