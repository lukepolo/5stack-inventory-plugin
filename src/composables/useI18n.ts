// Translation + the one notification funnel, as a composable rather than a
// module.
//
// It cannot be a plain module: both halves close over PROPS. `t`/`locale` are
// handed down by the host (a federated remote has its own module graph, so it
// cannot reach the panel's vue-i18n by importing it — see App.vue's Props), and
// `notify` is the host's toast for the same reason. A module would have to be
// initialised imperatively at mount, which is a second source of truth for
// something the props already answer.
//
// Almost every other composable ends up depending on `fail()`/`tr()`, so this
// one is created first in App and passed (or provided) to the rest.
import en from "../locales/en.json";

/**
 * The slice of App's props this needs. Declared structurally rather than
 * importing App's `Props` so the composable stays testable in isolation.
 */
export interface I18nHost {
  t?: (key: string, named?: Record<string, unknown>) => string;
  locale?: string;
  notify: (message: string, kind: "error" | "success") => void;
}

const CATALOGUES: Record<string, Record<string, unknown>> = { en };

function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], catalogue);
}

/**
 * Pass the props OBJECT, never a destructured copy — `tr` reads `host.locale`
 * on every call so anything computed from it re-evaluates on a language switch.
 * Destructuring would snapshot the locale at setup and freeze the UI in
 * whatever language it mounted in.
 */
export function useI18n(host: I18nHost) {
  /**
   * Translate `key`: our catalogue first, the panel second, `fallback` last.
   *
   * OURS wins deliberately. The panel ships its own messages and an operator
   * upgrading it must not be able to silently change this plugin's wording, so a
   * key we define is the one that renders. The panel is consulted only for keys
   * we do not own.
   *
   * Two distinct misses to survive, and vue-i18n conflates them: no host `t` at
   * all (standalone), and a host `t` that does not know the key — vue-i18n
   * returns the KEY itself for an unknown message, so without the comparison
   * below `inventory.foo.bar` would render on screen.
   */
  function tr(key: string, fallback: string, named?: Record<string, unknown>): string {
    const lang = host.locale ?? "en";
    const mine = lookup(CATALOGUES[lang] ?? {}, key) ?? lookup(CATALOGUES.en, key);
    if (typeof mine === "string") {
      return mine.replace(/\{(\w+)\}/g, (_, k) => String(named?.[k] ?? `{${k}}`));
    }
    const hosted = host.t?.(key, named);
    return !hosted || hosted === key ? fallback : hosted;
  }

  /** Every notification in the plugin funnels through here — including the ones
   *  AdminConsole and SkinTests emit upward — so the host's toast is the single
   *  implementation. */
  function notify(message: string, kind: "error" | "success" = "error") {
    host.notify(message, kind);
  }

  function fail(e: unknown) {
    notify(e instanceof Error ? e.message : String(e), "error");
  }

  return { tr, notify, fail };
}
