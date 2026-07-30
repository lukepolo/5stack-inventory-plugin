// One 3D viewer slot: mount a model into a host element, and make sure exactly
// one live viewer ever belongs to it.
//
// There were four of these — the focus stage, the craft modal, the attachment
// preview and the loadout overlay — each repeating the same ~30 lines, and each
// answering "is this mount still the current one?" a DIFFERENT way:
//
//   craft modal      generation counter, bumped in teardown
//   attach preview   generation counter, bumped inside the mount
//   focus stage      compares the model key it started with
//   loadout overlay  compares the overlay's own model field
//
// The key comparisons are the weak ones: leave a slot and come back to the SAME
// model while the GLB is still loading and the stale mount's key still matches,
// so it gets adopted. A generation counter cannot be fooled that way, so that is
// what this uses for all four.
//
// Why this matters more than tidiness: a mount that is adopted after it should
// have been discarded strands a live WebGL context rendering into a detached
// node, and two canvases in one host is the "gun renders below the pane" bug.
import { nextTick, ref } from "vue";
import { mdebug } from "../mdebug";
import { mountViewer, type ViewerHandle, type ViewerOpts } from "../viewer3d";

export interface ViewerMountSpec {
  /** Names this slot in the mdebug trace, e.g. "focus" or "craft modal". */
  label: string;
  /** The element the canvas goes into. Read fresh on every mount. */
  host: () => HTMLElement | null;
  /**
   * For a host that arrives a frame or two late (the focus stage swaps view
   * trees). Defaults to a single `nextTick` + read.
   */
  waitForHost?: () => Promise<HTMLElement | null>;
  /** A real failure — not an abort, and not a supersede. */
  onError: (e: unknown) => void;
}

export function useViewerMount(spec: ViewerMountSpec) {
  const busy = ref(false);
  let handle: ViewerHandle | null = null;
  let abort: AbortController | null = null;
  let generation = 0;
  let mountStarted = false;

  /**
   * Has a mount begun since the last teardown?
   *
   * The craft modal needs this and used to read its AbortController for it. Its
   * `modal3d` watcher only mounts on an EDGE, and a reset that writes
   * true→false→true inside one flush produces no edge — so it re-mounts by hand
   * unless a mount has already started, which is exactly this question.
   */
  const started = () => mountStarted;

  /**
   * The live handle, or null.
   *
   * Deliberately exposed rather than wrapped: the craft modal drives its viewer
   * through ~11 live setters (`setStatTrak`, `setNameTag`, `setCharm`, …) and
   * guards some of its async work with `if (current() === h)`, so handle
   * IDENTITY is part of the contract.
   */
  const current = () => handle;

  /** Discards whatever is mounted and invalidates any mount still in flight. */
  function teardown() {
    generation++;
    mountStarted = false;
    abort?.abort();
    abort = null;
    handle?.dispose();
    handle = null;
    busy.value = false;
  }

  /**
   * `build` receives the AbortSignal and returns the ViewerOpts. It is a
   * callback rather than a value because two of the four callers `await`
   * sticker geometry while assembling theirs, and that await has to happen
   * inside the guarded window.
   */
  async function mount(
    model: string,
    build: (signal: AbortSignal) => ViewerOpts | Promise<ViewerOpts>,
    onReady?: (h: ViewerHandle) => void,
  ): Promise<void> {
    const mine = ++generation;
    const mineStill = () => mine === generation;
    mountStarted = true;

    busy.value = true;
    const host = spec.waitForHost ? await spec.waitForHost() : (await nextTick(), spec.host());
    if (!host || !mineStill()) {
      if (mineStill()) busy.value = false;
      return;
    }

    // Replace whatever is there BEFORE building the next one: two canvases in
    // one host is the orphan that renders a second model under the pane.
    abort?.abort();
    handle?.dispose();
    handle = null;

    const ac = new AbortController();
    abort = ac;
    mdebug(`${spec.label} viewer MOUNT start`, { model });
    try {
      const built = await mountViewer(host, model, { ...(await build(ac.signal)), signal: ac.signal });
      // The mount takes seconds on a cold cache (GLB fetch + paint composite)
      // and the user may well have moved on during it. Adopting it anyway would
      // strand a live context rendering into a detached node forever.
      if (!mineStill()) {
        built.dispose();
        mdebug(`${spec.label} viewer MOUNT discarded (superseded)`, { model });
        return;
      }
      handle = built;
      onReady?.(built);
      mdebug(`${spec.label} viewer MOUNT done`, { model });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        mdebug(`${spec.label} viewer MOUNT aborted`, { model });
        return;
      }
      mdebug(`${spec.label} viewer MOUNT failed`, { e: String(e) });
      if (mineStill()) spec.onError(e);
    } finally {
      if (mineStill()) busy.value = false;
    }
  }

  return { busy, current, started, mount, teardown };
}
