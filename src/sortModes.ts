// The sort MODES themselves — the data half of useSortControl.
//
// Two families, because two things get sorted and they don't share a mode list:
//
//  - ITEM sorts (inventory grid, loadout sheet) run client-side over things you
//    own, so `wear` is available.
//  - ATTACHMENT sorts (attachment picker, armory) run over catalog entries and
//    partly server-side, so there is no float to sort by.
//
// These lived as four near-copies across App.vue and Armory.vue and had drifted:
// `default` was naturally descending in two and ascending in the other two, and
// the same "A → Z" hint was spelled two different ways. Kept here so the drift
// cannot come back.
import type { SortDir, SortKind } from "./sortIcons";
import type { AttachSort } from "./api";

// ---- items you own ----------------------------------------------------------

export type SortMode = "default" | "rarity" | "name" | "wear" | "value";

export const SORTS: [SortMode, string][] = [
  ["default", "Default"],
  ["rarity", "Rarity"],
  ["name", "Name"],
  ["wear", "Wear"],
  ["value", "Value"],
];

/**
 * Sorting by price only makes sense where there are prices.
 *
 * Offered only when the operator has a feed AND the player has values switched
 * on — a "Value" mode that silently keeps source order is worse than no mode,
 * because the list looks sorted. Callers filter SORTS through this.
 */
export const SORTS_WITHOUT_VALUE = SORTS.filter(([mode]) => mode !== "value");

/**
 * Catalog lists have no float, so offering "Wear" over one is a control that
 * does nothing. Surfaces that show catalog entries filter the list through this.
 */
export const SORTS_WITHOUT_WEAR = SORTS.filter(([mode]) => mode !== "wear" && mode !== "value");

/**
 * Rarity, not insertion order: an inventory reads better with the covert reds at
 * the top than with whatever you happened to craft last.
 */
export const DEFAULT_SORT: SortMode = "rarity";

export const SORT_NATURAL: Record<SortMode, SortDir> = {
  default: "desc",
  rarity: "desc",
  name: "asc",
  wear: "asc",
  // Descending: "what are my most expensive things" is the question people
  // actually open a value sort to answer.
  value: "desc",
};

export const SORT_DIR_HINT: Record<SortMode, Record<SortDir, string>> = {
  default: { desc: "Source order", asc: "Reversed" },
  rarity: { desc: "Highest rarity first", asc: "Lowest rarity first" },
  name: { asc: "A → Z", desc: "Z → A" },
  wear: { asc: "Lowest float first", desc: "Highest float first" },
  value: { desc: "Most valuable first", asc: "Least valuable first" },
};

export const SORT_DIR_KIND: Record<SortMode, SortKind> = {
  default: "amount",
  rarity: "amount",
  name: "alpha",
  wear: "numeric",
  value: "amount",
};

// ---- catalog attachments ----------------------------------------------------

/**
 * Aliased to the wire type rather than restated: these modes go to the server as
 * a query parameter, so a second copy of the union here could drift out of step
 * with what the API actually accepts. No `wear`, and `default` means collection
 * order.
 */
export type AttachSortMode = AttachSort;

export const ATTACH_SORTS: { value: AttachSortMode; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "default", label: "Collection" },
  { value: "name", label: "Name" },
];

/**
 * Rarity by default: it is the one attribute that ranks these against each
 * other, and it's visible on every tile (the coloured rule + glow), so the grid
 * reads top-down as best-first instead of as arrival order.
 */
export const DEFAULT_ATTACH_SORT: AttachSortMode = "rarity";

export const ATTACH_SORT_NATURAL: Record<AttachSortMode, SortDir> = {
  default: "asc",
  rarity: "desc",
  name: "asc",
};

export const ATTACH_DIR_HINT: Record<AttachSortMode, Record<SortDir, string>> = {
  // Deliberately NOT "Oldest capsules first". The picker said that, but the
  // armory sorts weapon and knife catalogs with the same table, and those don't
  // come out of capsules.
  default: { asc: "Oldest first", desc: "Newest first" },
  rarity: { desc: "Highest rarity first", asc: "Lowest rarity first" },
  name: { asc: "A → Z", desc: "Z → A" },
};

export const ATTACH_SORT_KIND: Record<AttachSortMode, SortKind> = {
  default: "amount",
  rarity: "amount",
  name: "alpha",
};
