/**
 * Colour DECKS — folding the colourway variants of one artwork into one card.
 *
 * Lifted out of App.vue when the inventory grid became its own component. Three
 * grids stack the same way (the craft sheet's catalog skins, the sheet's Owned
 * tab and the inventory page's owned instances), so the primitive has to sit
 * somewhere all three can reach without one screen importing another.
 */

/** Trailing "(Colour)" on a tinted variant's name — a deck spans every colour,
 *  so the face card drops it. Paired with `stripName` at every call site. */
export const TINT_SUFFIX = / \([^()]+\)\s*$/;

/**
 * Fold colour variants of one artwork into a single card.
 *
 * 1,767 of the 2,205 sprays are 93 designs repeated in 19 colourways. As one
 * tile each they bury the 438 that are actually distinct artwork, and finding
 * "the green GGEZ" means reading nineteen near-identical names. Items sharing a
 * `design` become one stacked card that says how many it holds; `drill` is the
 * design being opened, and inside one the variants ARE the cards.
 *
 * Generic over what's being stacked because three grids need it — the craft
 * sheet (catalog skins), the sheet's Owned tab and the inventory page (owned
 * instances). Anything without a `design` — every weapon, knife and glove —
 * comes through one card per item, so nothing outside graffiti changes.
 *
 * A stack survives the filters if ANY variant does, and drilling in shows only
 * the survivors. That's why the colour filter needs no special case: pick one
 * and every stack is down to a single variant, so the grid is flat again.
 */
export interface Stack<T> {
  key: string | number;
  /** The item a single card equips, and the art a deck wears. */
  face: T;
  /** Two more colourways to fan out behind the face. Empty for a single. */
  behind: string[];
  variants: T[];
}

export function stackByDesign<T>(
  list: T[],
  drill: number | null,
  of: (v: T) => { id: number; design?: number; tintName?: string } | null | undefined,
  // The card's Vue key, and it has to identify the ROW, not the artwork: two
  // owned copies of one skin share an item id, and a duplicate key inside a
  // keyed v-for makes Vue's diff patch one node twice and orphan the other —
  // an already-filtered-out card left sitting in the grid.
  keyOf: (v: T) => string | number,
  /** tintName -> colour for the fanned layers. See `tintColors` in App.vue. */
  palette: Map<string, string>,
): Stack<T>[] {
  const out: Stack<T>[] = [];
  const byDesign = new Map<number, Stack<T>>();
  for (const v of list) {
    const meta = of(v);
    const design = meta?.design;
    if (drill != null) {
      if (design === drill) out.push({ key: keyOf(v), face: v, behind: [], variants: [v] });
      continue;
    }
    if (design == null) {
      out.push({ key: keyOf(v), face: v, behind: [], variants: [v] });
      continue;
    }
    const stack = byDesign.get(design);
    if (stack) {
      stack.variants.push(v);
      continue;
    }
    const next: Stack<T> = { key: `d${design}`, face: v, behind: [], variants: [v] };
    byDesign.set(design, next);
    out.push(next);
  }
  // Which colourway a deck WEARS. Taking the first survivor made a whole grid
  // one colour — catalog order puts the same tint first for every design, so 93
  // stacks all showed up Battle Green. Offsetting by the design id spreads them
  // across the range, and stays deterministic so the colours don't reshuffle
  // every time a filter changes.
  for (const st of out) {
    const n = st.variants.length;
    if (n < 2) continue;
    const at = (k: number) => st.variants[((((of(st.face)?.design ?? 0) + k) % n) + n) % n];
    st.face = at(0);
    // Thirds apart, so the two behind never repeat the face or each other.
    st.behind = [at(Math.floor(n / 3)), at(Math.floor((2 * n) / 3))]
      .map((v) => palette.get(of(v)?.tintName ?? "") ?? "")
      .filter(Boolean);
  }
  return out;
}
