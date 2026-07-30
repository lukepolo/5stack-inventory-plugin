/**
 * Small DOM helpers shared by the scrolling panels.
 *
 * Every grid and column in this app scrolls inside its own `overflow-y-auto`
 * panel rather than the page, so "which element actually scrolls" is a question
 * that comes up in more than one place — the infinite-scroll sentinel needs it
 * for its observer root, and the loadout needs it to reveal a slot that the
 * lifted picker sheet is covering.
 */
import { ref } from "vue";

/** The nearest scrollable ancestor, or null if nothing above it scrolls. */
export function scrollRoot(from: HTMLElement): HTMLElement | null {
  for (let p = from.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null; // no scrolling ancestor — fall back to the viewport
}

/**
 * Scroll `el` into the usable part of its scroller.
 *
 * `bottomInset` is how much of the scroller's bottom edge is covered by
 * something floating over it (the lifted picker sheet); that band is treated as
 * not-visible. Deliberately explicit rather than `scrollIntoView` +
 * `scroll-padding-bottom`: the CSS route relies on the browser honouring
 * scroll-padding for programmatic scrolls, which is uneven, and it would also
 * scroll ancestors we want left alone.
 *
 * Vertical only — the loadout's horizontal column strip never overflows above
 * the compact breakpoint.
 */
export function revealInScroller(el: HTMLElement, bottomInset = 0, smooth = true, margin = 8): void {
  const sc = scrollRoot(el);
  if (!sc) return;
  const e = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  const top = s.top + margin;
  const bottom = s.bottom - bottomInset - margin;
  if (bottom <= top) return; // nothing left uncovered — no sane place to put it

  // Below the fold wins over above it: an element taller than the free strip
  // should sit with its top visible rather than its bottom.
  let dy = 0;
  if (e.bottom > bottom) dy = e.bottom - bottom;
  if (e.top - dy < top) dy = e.top - top;
  if (Math.abs(dy) < 1) return;

  sc.scrollBy({ top: dy, behavior: smooth ? "smooth" : "auto" });
}

/**
 * Send a results panel back to the top, for when its CONTENT is replaced.
 *
 * Switching a tab or a filter builds a different list, and the scroll offset
 * belongs to the old one — so you landed part-way down a set you had never
 * looked at, or past the end of a shorter one and staring at blank space. This is
 * only ever right when the list is REPLACED; appending a page must leave the
 * offset alone.
 *
 * `auto`, never smooth: the new list is arriving in the same frames, and animating
 * the offset across a content swap is the jitter it looks like.
 *
 * Takes the scroller itself, or any element inside it (the grids mark theirs with
 * `[data-scroller]`, but several ARE the scroller).
 */
export function scrollPanelToTop(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const sc = el.matches("[data-scroller]") || el.scrollHeight > el.clientHeight ? el : scrollRoot(el);
  (sc ?? el).scrollTo({ top: 0, behavior: "auto" });
}

/**
 * The "there is more below" cue for any ORDINARY scroller.
 *
 * The picker sheet keeps its own (`measureSheetScroll`) because part of its box
 * deliberately hangs off the bottom of the screen, which nothing else does.
 *
 * `remeasure` exists because the two things that change "is there more below" on
 * these grids — the render window growing as you scroll, and the filter set
 * shrinking — neither of them fires a scroll event.
 */
export function scrollFade() {
  const more = ref(false);
  let el: HTMLElement | null = null;
  const measure = () => (more.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  // Coalesced to one measurement per frame. `scrollHeight`/`clientHeight` are
  // layout reads, and a scroll event can fire many times between paints — on a
  // long inventory grid that is a forced reflow per event for a boolean that
  // can only change once per frame anyway.
  let pending = false;
  const measureSoon = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      measure();
    });
  };
  return {
    more,
    onScroll: (e: Event) => {
      el = e.target as HTMLElement;
      measureSoon();
    },
    /**
     * Function ref for the WRAPPER, which then finds the scroller inside it by
     * `data-scroller`. Indirect on purpose: the inventory grid is a
     * <TransitionGroup>, and a ref on that hands back the component instance,
     * not the element that actually scrolls.
     */
    setHost: (node: unknown) => {
      el = (node as HTMLElement | null)?.querySelector<HTMLElement>("[data-scroller]") ?? null;
      if (el) requestAnimationFrame(measure);
      else more.value = false;
    },
    remeasure: () => requestAnimationFrame(measure),
    /** Back to the top, for when the LIST is replaced rather than appended —
     *  see scrollPanelToTop. The scroller is already resolved here, so callers
     *  don't have to find it a second way. */
    toTop: () => {
      scrollPanelToTop(el);
      requestAnimationFrame(measure);
    },
  };
}
