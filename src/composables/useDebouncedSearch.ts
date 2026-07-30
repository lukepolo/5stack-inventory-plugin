// A search box and the settled term it produces.
//
// The inventory grid and the loadout sheet each had their own copy of this —
// byte-identical apart from the variable names, down to the `onBeforeUnmount`
// that cleared the timer.
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * Long enough that a normal typing cadence produces one query, short enough
 * that pausing feels immediate.
 */
export const SEARCH_DEBOUNCE_MS = 220;

export interface DebouncedSearch {
  /** Bound to the input — updates on every keystroke. */
  term: Ref<string>;
  /** What the grid actually filters on. */
  applied: Ref<string>;
  /** Drop a pending debounce and apply `value` now (a whole query arriving at once). */
  applyNow: (value: string) => void;
}

export function useDebouncedSearch(): DebouncedSearch {
  const term = ref("");
  const applied = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(term, (v) => {
    clearTimeout(timer);
    // Clearing is instant; typing waits for you to stop. An empty box should
    // show everything immediately rather than after a beat of nothing.
    if (!v.trim()) {
      applied.value = "";
      return;
    }
    timer = setTimeout(() => (applied.value = v), SEARCH_DEBOUNCE_MS);
  });

  onBeforeUnmount(() => clearTimeout(timer));

  return {
    term,
    applied,
    applyNow(value: string) {
      clearTimeout(timer);
      term.value = value;
      applied.value = value;
    },
  };
}
