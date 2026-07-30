// Long-press a loadout slot to open its menu — touch has no right-click.
//
// Delegated from the loadout container instead of bound per-slot: every slot
// already carries `data-slot` for the drag/drop system, and there are five
// distinct slot markups that would each otherwise need the same four handlers.
import { onBeforeUnmount } from "vue";

const LONG_PRESS_MS = 450;
/** Movement past this is a scroll, not a press. */
const LONG_PRESS_SLOP = 10;

export function useSlotLongPress(openMenuFor: (pos: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | null = null;
  let fired = false;

  function cancel() {
    clearTimeout(timer);
    origin = null;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse") return; // mouse already has right-click
    const pos = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-slot]")?.dataset.slot;
    if (!pos) return;
    fired = false;
    origin = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      origin = null;
      // Haptic confirmation the press "took" — without it the gesture feels
      // broken for the frame or two before the menu paints.
      navigator.vibrate?.(8);
      openMenuFor(pos);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: PointerEvent) {
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP) cancel();
  }

  // The browser still delivers a click when the finger lifts. Swallow it, or the
  // long-press would also select the slot sitting behind the menu it just opened.
  function onClickCapture(e: MouseEvent) {
    if (!fired) return;
    fired = false;
    e.stopPropagation();
    e.preventDefault();
  }

  // The pending timer used to outlive the component: it fires into a torn-down
  // setup and calls `openMenuFor` on a screen that is no longer mounted.
  onBeforeUnmount(cancel);

  return { onPointerDown, onPointerMove, cancel, onClickCapture };
}
