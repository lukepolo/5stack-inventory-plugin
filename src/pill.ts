import { ref } from "vue";

// ---- animated sliding-pill tabs (mirrors the panel's TabsList indicator) ----
// One reusable mechanism powers the view tabs, sheet-mode tabs, CT/T toggle,
// the inventory origin filter and every catalog filter bar. Self-healing: the
// loadout app remounts inside an out-in Transition when leaving /admin, so
// nextTick watchers fire before the entering tree is in the DOM and measure
// nothing — each pill therefore re-measures via ResizeObserver whenever its tab
// list (re)mounts, resizes (fonts, count badges) or flips hidden→visible.
//
// Lives here rather than in App.vue because CatalogFilters needs it too, and a
// tab strip that slides in one screen and jumps in another reads as a bug.

/**
 * The sliding indicator's transition. TRANSFORM ONLY — the `width 0.2s ease` that
 * used to ride along with it is gone on purpose.
 *
 * `transform` is composited: it keeps animating on its own thread even while the
 * main thread is busy. `width` is layout, so every frame of it is main-thread
 * work — and switching a tab is exactly when the main thread is busiest, rebuilding
 * the grid underneath. The width animation stalled there, which is why the pill
 * slid part way, hung, then snapped to the end. Width now applies instantly and
 * only the travel animates, so nothing the grid does can block it.
 */
/** The spring every indicator in the app travels on. Shared with the panel's
 *  own settings side-tabs, so a vertical rail here feels like one there. */
const SPRING = "0.35s cubic-bezier(0.34,1.56,0.64,1)";
export const pillTransition = (animated: boolean) =>
  animated ? `transform ${SPRING}` : "none";
/** Vertical rails animate their HEIGHT too — tabs in a column are not all the
 *  same size the way tabs in a row are. Shorter than the travel so the bar
 *  settles to length before it finishes moving, rather than stretching the
 *  whole way down. */
export const railTransition = (animated: boolean) =>
  animated ? `transform ${SPRING}, height 0.18s ease` : "none";

/**
 * One measured indicator, on either axis.
 *
 * `x`/`w` for a row of tabs, `y`/`h` for a column — same measuring, same
 * self-healing, same spring. Written once because the alternative is two of
 * these drifting apart, which is exactly what happened to the filter bars.
 */
function makeIndicator(axis: "x" | "y") {
  const refs: Record<string, HTMLElement | null> = {};
  let listEl: HTMLElement | null = null;
  let activeKey = "";
  /** Offset along the axis, and extent across it. */
  const pos = ref(0);
  const size = ref(0);
  const animated = ref(false);
  function sync(key?: string) {
    if (key !== undefined) activeKey = key;
    const btn = refs[activeKey];
    if (!listEl || !btn) {
      size.value = 0;
      return;
    }
    const listRect = listEl.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    // Coming back from hidden: place the indicator instantly instead of
    // sliding it in from wherever it last sat.
    if (size.value === 0) animated.value = false;
    pos.value = axis === "x" ? btnRect.left - listRect.left : btnRect.top - listRect.top;
    size.value = axis === "x" ? btnRect.width : btnRect.height;
    requestAnimationFrame(() => (animated.value = true));
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
  return {
    // Both namings expose the SAME two refs — `x`/`w` reads right on a row and
    // `y`/`h` on a column, and every existing call site says x/w.
    x: pos,
    w: size,
    y: pos,
    h: size,
    animated,
    setListEl(el: unknown) {
      const next = (el as HTMLElement | null) ?? null;
      if (next === listEl) return;
      if (listEl) ro?.unobserve(listEl);
      listEl = next;
      if (listEl) ro?.observe(listEl);
    },
    setRef(key: string, el: unknown) {
      refs[key] = (el as HTMLElement | null) ?? null;
    },
    sync,
  };
}
/** A row of tabs: the indicator slides left/right and takes the tab's width. */
export const makePill = () => makeIndicator("x");
/** A column of tabs: the indicator slides up/down and takes the tab's height.
 *  Mirrors the panel's SettingsSideTabs. */
export const makeRail = () => makeIndicator("y");
export type Pill = ReturnType<typeof makePill>;
