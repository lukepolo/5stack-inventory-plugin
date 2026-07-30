// One sort control: a mode, a direction, and the persistence rules both follow.
//
// There were three near-copies of this (inventory grid, loadout sheet,
// attachment picker) plus a fourth in Armory.vue, and they had drifted — two
// spellings of the same "A → Z" hint, `default` naturally descending in two of
// them and ascending in the third, and `loadPickerDir` a byte-for-byte clone of
// `loadDir` differing only in which natural-direction table it read.
//
// What differs legitimately between call sites is DATA — the mode list and its
// three lookup tables — so that is what this takes. The one behavioural
// difference, that the picker sorts server-side and must refetch, is the
// `onChange` hook.
import { computed, ref, watch, type Ref } from "vue";
import type { SortDir, SortKind } from "../sortIcons";

export interface SortSpec<M extends string> {
  /** localStorage namespace: `cs2inv.<scope>Sort` and `cs2inv.<scope>Dir.<mode>`. */
  scope: string;
  /** Used when nothing is stored, and when what IS stored is no longer a valid mode. */
  fallback: M;
  /**
   * The direction you meant when you picked each mode. Comparators are written
   * in this direction and a flip negates the primary key only, so reversing
   * rarity doesn't silently reverse the names inside each tier too.
   *
   * Doubles as the mode registry — its keys are the valid modes.
   */
  natural: Record<M, SortDir>;
  /**
   * What each direction MEANS per mode, for the toggle's tooltip. "Ascending" is
   * useless here; "Lowest float first" is what someone is actually looking for.
   */
  hints: Record<M, Record<SortDir, string>>;
  /** Which icon pair reads the direction — see SortDirection.vue. */
  kinds: Record<M, SortKind>;
  /** Ran after mode or direction settles. The picker re-queries the server here. */
  onChange?: () => void;
}

export function useSortControl<M extends string>(spec: SortSpec<M>) {
  const modeStorageKey = `cs2inv.${spec.scope}Sort`;
  const dirStorageKey = (mode: string) => `cs2inv.${spec.scope}Dir.${mode}`;

  const isMode = (v: unknown): v is M => typeof v === "string" && v in spec.natural;

  /**
   * Direction is remembered PER MODE, not per control.
   *
   * A single stored direction per grid meant a preference set on one mode
   * silently became the default for every other: flip Name to Z→A, come back to
   * Rarity, and you get lowest-rarity-first for a choice you made about names.
   */
  function loadDir(mode: M): SortDir {
    const stored = localStorage.getItem(dirStorageKey(mode));
    return stored === "asc" || stored === "desc" ? stored : spec.natural[mode];
  }

  // Validated on read: a stored mode that is no longer in the table (a renamed
  // mode, a hand-edited value) used to index the natural table as `undefined`
  // and leave the direction undefined with it.
  const stored = localStorage.getItem(modeStorageKey);
  const mode = ref(isMode(stored) ? stored : spec.fallback) as Ref<M>;
  const dir = ref(loadDir(mode.value)) as Ref<SortDir>;

  watch(mode, (v) => localStorage.setItem(modeStorageKey, v));
  watch(dir, (v) => localStorage.setItem(dirStorageKey(mode.value), v));

  /**
   * Switching mode restores THAT mode's remembered direction, or its natural one.
   *
   * This used to be two hand-written setters per call site, because a shared
   * module-level helper taking refs would receive the auto-unwrapped string
   * values from a template instead of the refs to write back to. A composable
   * closes over its own refs, so the problem doesn't arise.
   */
  function setMode(next: string) {
    if (!isMode(next)) return;
    mode.value = next;
    dir.value = loadDir(next);
    spec.onChange?.();
  }

  function setDir(next: SortDir) {
    dir.value = next;
    spec.onChange?.();
  }

  return {
    mode,
    dir,
    setMode,
    setDir,
    loadDir,
    /** Natural direction for the CURRENT mode — comparators flip against this. */
    natural: computed(() => spec.natural[mode.value]),
    kind: computed(() => spec.kinds[mode.value]),
    hint: computed(() => spec.hints[mode.value][dir.value]),
  };
}
