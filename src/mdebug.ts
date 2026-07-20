/**
 * TEMPORARY overlay tracing — delete once the modal flicker/reopen is found.
 *
 * Lives in its own module rather than inside App.vue because the overlays are
 * split across components (ShareMenu owns its own `open`), and a shared
 * sequence counter is the whole point: the bug is about ORDER — which layer
 * moved first, and what reopened after a close — so every trace has to come
 * off one clock.
 *
 * Enabled with ?mdebug=1, so it can be switched on against a running instance
 * without a rebuild.
 */
import { watch, type Ref, type WatchSource } from "vue";

export const MDEBUG =
  typeof location !== "undefined" && /[?&]mdebug=1/.test(location.search);

let seq = 0;
const t0 = typeof performance !== "undefined" ? performance.now() : 0;

/** The frames that actually triggered this — our own frames stripped out. */
function caller(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(2);
  return (
    lines
      .map((l) => l.trim().replace(/^at\s+/, ""))
      .filter((l) => l && !/mdebug|traceLayer/.test(l))
      .slice(0, 4)
      .join("\n       <- ") || "?"
  );
}

/** Extra context appended to every line, wired up by App.vue at setup. */
let ambient: () => Record<string, unknown> = () => ({});
export function setMdebugAmbient(fn: () => Record<string, unknown>) {
  ambient = fn;
}

export function mdebug(event: string, detail?: Record<string, unknown>) {
  if (!MDEBUG) return;
  const n = String(++seq).padStart(3, "0");
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0);
  // eslint-disable-next-line no-console
  console.log(
    `[m#${n} +${ms}ms] ${event}`,
    { ...ambient(), ...(detail ?? {}) },
    `\n  via ${caller()}`,
  );
}

/**
 * Trace one dismissable layer's lifecycle.
 *
 * REASSIGN — value→value without ever passing through null — gets its own
 * label because it's invisible to a plain truthy/falsy log yet remounts the
 * entire subtree, which is exactly what reads as a flicker on screen.
 */
export function traceLayer<T>(
  name: string,
  src: Ref<T> | WatchSource<T>,
  describe?: (v: NonNullable<T>) => Record<string, unknown>,
) {
  if (!MDEBUG) return;
  watch(
    src as WatchSource<T>,
    (now, before) => {
      const was = !!before;
      const is = !!now;
      const what = !was && is ? "OPEN" : was && !is ? "CLOSE" : was && is ? "REASSIGN (remount)" : null;
      if (!what) return;
      mdebug(`${name} ${what}`, is && describe ? describe(now as NonNullable<T>) : undefined);
    },
    // Sync, deliberately: with the default `pre` flush several transitions
    // coalesce into one callback per tick, which hides the very double-fire
    // this exists to catch.
    { flush: "sync" },
  );
}
