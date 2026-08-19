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
import { RARITY_META } from "./itemVisuals";

// ---- items you own ----------------------------------------------------------

export type SortMode = "default" | "rarity" | "name" | "wear" | "recent" | "value" | "collection";

export const SORTS: [SortMode, string][] = [
  ["default", "Default"],
  // Next to Default because both answer "in what order did these arrive?", and
  // this is the one people reach for after crafting a batch.
  ["recent", "Recently added"],
  ["rarity", "Rarity"],
  ["name", "Name"],
  ["wear", "Wear"],
  // Last, and after Wear, because it is the only mode that leaves part of the
  // grid unsorted: an item with no collection (a vanilla weapon, a music kit,
  // most knives) has nothing to rank by, and those all land together at the end
  // rather than under a blank heading at the top.
  ["collection", "Collection"],
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
 * Modes that need something only an item you OWN can have.
 *
 * `wear` needs a float, `recent` needs an acquisition date, and `value` needs a
 * price the mirror may not carry; a catalog entry has none of them. Exported as
 * one predicate because the surfaces that mix the two list kinds each used to
 * spell the condition out inline — which is how `wear` came to be checked in two
 * places by hand.
 *
 * `value` is NOT in here: it has its own gate (SORTS_WITHOUT_VALUE) because it
 * turns on the operator's feed rather than on what kind of list this is.
 */
export const needsOwnedItem = (mode: SortMode): boolean =>
  mode === "wear" || mode === "recent";

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
  // Newest first: "recently added" names the thing you want at the top, so the
  // natural direction is the one that puts it there.
  recent: "desc",
  collection: "asc",
};

export const SORT_DIR_HINT: Record<SortMode, Record<SortDir, string>> = {
  default: { desc: "Source order", asc: "Reversed" },
  rarity: { desc: "Highest rarity first", asc: "Lowest rarity first" },
  name: { asc: "A → Z", desc: "Z → A" },
  wear: { asc: "Lowest float first", desc: "Highest float first" },
  value: { desc: "Most valuable first", asc: "Least valuable first" },
  recent: { desc: "Newest first", asc: "Oldest first" },
  // Spelled out rather than reusing the name hint's "A → Z": next to a grid the
  // two modes sort visibly differently, and the hint is the only thing that says
  // WHICH name is being ordered.
  collection: { asc: "Collection A → Z", desc: "Collection Z → A" },
};

export const SORT_DIR_KIND: Record<SortMode, SortKind> = {
  default: "amount",
  rarity: "amount",
  name: "alpha",
  wear: "numeric",
  value: "amount",
  recent: "numeric",
  collection: "alpha",
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

// ---- the two comparator primitives every grid here sorts through -------------
// Lifted out of App.vue when the attachment picker became its own component:
// both the picker's facet axis and App's own sortInstances/sortSkins need them,
// and a second copy of either is a second place for a tie-break to drift.

/** Name order, null-safe. The tie-break under every other mode, which is why it
 *  stays A → Z in both directions. */
export const byName = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "");

// Its own fallback on purpose: an unrecognised colour sorts FIRST here (0),
// where the facet lists put it last (8). Sorting a grid, "I don't know what
// this is" belongs with the commons; listing the tiers, it belongs after them.
export const sortRarityRank = (hex?: string | null) => (hex && RARITY_META[hex.toLowerCase()]?.rank) || 0;
