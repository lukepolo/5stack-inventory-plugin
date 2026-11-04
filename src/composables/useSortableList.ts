// Drag-to-reorder for a list of rows, the way a phone's list does it: the row
// you hold LIFTS (a touch larger, a soft shadow) and follows the pointer, the
// rows it passes slide out of its way to show where it will land, and on
// release it settles into that gap before the list underneath is reordered —
// so the reorder itself is never seen as a jump.
//
// Everything moves by `transform` (composited), and the list's own state
// changes exactly once, on drop (`onMove`). Pointer events, not HTML drag and
// drop: Safari on touch has none, and HTML DnD can't animate the rows around
// the one in flight.
//
// A mouse lifts a row after a few pixels of movement from anywhere on it; a
// finger lifts it from its grip (an element marked `data-sort-grip`, which
// carries `touch-action: none`), so the rest of a row still scrolls the panel.
// A press that never moves is a tap (the press's own `tap`).
import { onBeforeUnmount, ref } from "vue";

const LIFT_PX = 4;
const SETTLE_MS = 200;
const SLIDE = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const SETTLE = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow ${SETTLE_MS}ms ease-out`;
const LIFTED_SHADOW = "0 14px 28px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px hsl(var(--tac-amber, 33 94% 58%) / 0.45)";

type Drag = {
  list: string;
  from: number;
  pointer: number;
  y0: number;
  active: boolean;
  touch: boolean;
  item: HTMLElement;
  rows: HTMLElement[];
  rects: DOMRect[];
  /** How far a passed row slides: the lifted row's height and the gap after it. */
  step: number;
  to: number;
  scroller: HTMLElement | null;
  scroll0: number;
  tap?: (e: PointerEvent) => void;
};

export function useSortableList(opts: {
  /** Move the row shown at `from` to `to` (both in the list's shown order). */
  onMove: (list: string, from: number, to: number) => void;
}) {
  /** The list and row being dragged, for styling the rest of the screen. */
  const dragging = ref<{ list: string; from: number } | null>(null);
  let d: Drag | null = null;
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Start tracking a press on a row. `list` names the rows that sort together
   *  (each carries `data-sort-list="<list>"`); `index` is this row's place;
   *  `tap` runs for a press that never moved (a click). */
  function press(e: PointerEvent, list: string, index: number, tap?: (e: PointerEvent) => void) {
    if (e.button !== 0 || d) return;
    const item = (e.currentTarget as HTMLElement).closest<HTMLElement>(`[data-sort-list="${CSS.escape(list)}"]`);
    if (!item) return;
    const touch = e.pointerType !== "mouse";
    // A finger only lifts from the grip; anywhere else it scrolls the panel.
    if (touch && !(e.target as HTMLElement).closest("[data-sort-grip]")) {
      if (tap) {
        window.addEventListener("pointerup", function once(up) {
          window.removeEventListener("pointerup", once);
          if (Math.abs(up.clientY - e.clientY) < LIFT_PX) tap(up);
        });
      }
      return;
    }
    e.stopPropagation();
    d = {
      list, from: index, pointer: e.pointerId, y0: e.clientY, active: false, touch, item,
      rows: [], rects: [], step: 0, to: index, scroller: null, scroll0: 0, tap,
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    // A grip pressed by a finger lifts at once: the finger already chose it.
    if (touch) lift();
  }

  function lift() {
    if (!d) return;
    const container = d.item.parentElement;
    d.rows = [...(container?.querySelectorAll<HTMLElement>(`:scope > [data-sort-list="${CSS.escape(d.list)}"]`) ?? [])];
    d.rects = d.rows.map((r) => r.getBoundingClientRect());
    const me = d.rects[d.from];
    const next = d.rects[d.from + 1] ?? d.rects[d.from - 1];
    const gap = next ? Math.max(0, next.top > me.top ? next.top - me.bottom : me.top - next.bottom) : 0;
    d.step = me.height + gap;
    d.scroller = scrollParent(d.item);
    d.scroll0 = d.scroller?.scrollTop ?? 0;
    d.active = true;
    dragging.value = { list: d.list, from: d.from };
    const glide = reduced() ? "none" : SLIDE;
    d.rows.forEach((r, i) => {
      if (i === d!.from) return;
      r.style.transition = glide;
      r.style.willChange = "transform";
    });
    const it = d.item;
    it.style.position = "relative";
    it.style.zIndex = "30";
    it.style.cursor = "grabbing";
    it.style.transition = reduced() ? "none" : "box-shadow 150ms ease-out";
    it.style.boxShadow = LIFTED_SHADOW;
    it.style.background = "hsl(var(--card))";
    it.style.willChange = "transform";
    it.style.transform = "scale(1.02)";
    document.body.style.cursor = "grabbing";
    // A tick under the finger where the platform has one (Android); nothing elsewhere.
    if (d.touch) (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(8);
  }

  function move(e: PointerEvent) {
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.y0) < LIFT_PX) return;
      lift();
    }
    e.preventDefault();
    // Near the scroller's edge, scroll it — a long mat list is taller than the panel.
    const sc = d.scroller;
    if (sc) {
      const b = sc.getBoundingClientRect();
      if (e.clientY < b.top + 36) sc.scrollTop -= 10;
      else if (e.clientY > b.bottom - 36) sc.scrollTop += 10;
    }
    const scrolled = (sc?.scrollTop ?? 0) - d.scroll0;
    const me = d.rects[d.from];
    // Held inside the list: from above its first row to below its last.
    const lo = d.rects[0].top - me.top;
    const hi = d.rects[d.rects.length - 1].bottom - me.bottom;
    const dy = Math.min(hi, Math.max(lo, e.clientY - d.y0 + scrolled));
    d.item.style.transform = `translateY(${dy - scrolled}px) scale(1.02)`;
    // Where it lands: past every row whose middle its own middle has reached.
    // Reached, not crossed: held against the end of a list of equal rows, its
    // middle sits EXACTLY on the end row's — with a strict test the drop never
    // counted, and the row settled back where it started.
    const mid = me.top + me.height / 2 + dy;
    let to = d.from;
    for (let i = d.from + 1; i < d.rects.length; i++) if (mid >= d.rects[i].top + d.rects[i].height / 2 - 0.5) to = i;
    for (let i = d.from - 1; i >= 0; i--) if (mid <= d.rects[i].top + d.rects[i].height / 2 + 0.5) to = i;
    if (to !== d.to) {
      d.to = to;
      d.rows.forEach((r, i) => {
        if (i === d!.from) return;
        const shift = i > d!.from && i <= to ? -d!.step : i < d!.from && i >= to ? d!.step : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    }
  }

  function key(e: KeyboardEvent) {
    if (e.key !== "Escape" || !d) return;
    e.preventDefault();
    e.stopPropagation();
    d.to = d.from;
    settle(null);
  }

  function up(e: PointerEvent) {
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.active) {
      const t = d;
      teardown();
      if (e.type === "pointerup") t.tap?.(e);
      return;
    }
    settle(e.type === "pointerup" ? e : null);
  }

  /** Glide the lifted row into its gap, then reorder for real with nothing moving. */
  function settle(e: PointerEvent | null) {
    const t = d;
    if (!t) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key);
    const to = e ? t.to : t.from;
    if (!e) t.rows.forEach((r, i) => i !== t.from && (r.style.transform = ""));
    const scrolled = (t.scroller?.scrollTop ?? 0) - t.scroll0;
    const me = t.rects[t.from];
    const land = to > t.from ? t.rects[to].bottom - me.bottom : to < t.from ? t.rects[to].top - me.top : 0;
    const it = t.item;
    it.style.transition = reduced() ? "none" : SETTLE;
    it.style.transform = `translateY(${land - scrolled}px)`;
    it.style.boxShadow = "";
    const finish = () => {
      // Every row back to its own place in one go, and the list reordered in
      // the same task: they land exactly where they were drawn.
      for (const r of t.rows) {
        r.style.transition = "none";
        r.style.transform = "";
        r.style.willChange = "";
      }
      for (const k of ["position", "zIndex", "cursor", "boxShadow", "background"] as const) it.style[k] = "";
      document.body.style.cursor = "";
      dragging.value = null;
      d = null;
      if (to !== t.from) opts.onMove(t.list, t.from, to);
      requestAnimationFrame(() => t.rows.forEach((r) => (r.style.transition = "")));
    };
    if (reduced()) finish();
    else setTimeout(finish, SETTLE_MS);
  }

  function teardown() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key);
    d = null;
    dragging.value = null;
  }

  onBeforeUnmount(teardown);
  return { press, dragging };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
