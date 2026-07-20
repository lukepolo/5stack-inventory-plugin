// The plugin routing contract.
//
// The 5stack panel owns `/apps/<slug>/*` and hands a plugin the part of the
// URL below its slug (`path`), the query, and a `navigate` callback. That means a
// plugin gets real, linkable, back-button-able routes WITHOUT bundling
// vue-router (a second router instance inside a federated remote fights the
// host's for the URL) and without knowing where it is mounted.
//
//   host  →  :base="/apps/inventory"  :path="/admin"  :query  :navigate
//   plugin → go("/admin")  →  host router.push("/apps/inventory/admin")
//
// Standalone (`npm run dev`, no host) there are no such props, so we fall back to
// the History API against the real URL. Same call sites, both modes.

import { computed, onBeforeUnmount, ref, type ComputedRef } from "vue";

export type QueryValue = string | (string | null)[] | null | undefined;
export type Query = Record<string, QueryValue>;

/** Props the host passes down. All optional — absent means standalone. */
export interface HostRouting {
  base?: string;
  path?: string;
  query?: Query;
  navigate?: (
    to: string,
    options?: { replace?: boolean; query?: Record<string, unknown> },
  ) => unknown;
  /**
   * Navigate the HOST app to an absolute panel path, leaving wherever the
   * plugin is mounted. Distinct from `navigate`, which moves the plugin WITHIN
   * its mount point — inside a profile tab that's local state that never leaves
   * the page, which is exactly what a "go to the full app" link must do. Absent
   * standalone, and absent from hosts that predate it; callers fall back to the
   * plain href, so a missing prop costs a page load, not a dead link.
   */
  navigateApp?: (to: string) => unknown;
}

export interface PluginRouter {
  /** Path within the plugin, always leading-slashed and un-trailing-slashed: "/" or "/admin". */
  path: ComputedRef<string>;
  /** Flattened query — first value wins, so `q.player` is a plain string. */
  query: ComputedRef<Record<string, string>>;
  /** Navigate within the plugin. `to` is plugin-relative ("/admin"). */
  go: (to: string, options?: { replace?: boolean; query?: Record<string, unknown> }) => void;
  /** Absolute href for a plugin-relative path — for <a> tags and share links. */
  href: (to: string, query?: Record<string, unknown>) => string;
  /**
   * Leave the plugin's mount point for the plugin's own page in the host app.
   * Returns false when the host offers no such channel, so an <a> handler can
   * decline to preventDefault and let the browser do the navigation instead.
   */
  goApp: (to: string, query?: Record<string, unknown>) => boolean;
  /** True when mounted inside the panel (as opposed to standalone dev). */
  embedded: ComputedRef<boolean>;
}

const normalize = (p: string) => {
  const trimmed = `/${p}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return trimmed || "/";
};

const flatten = (q: Query): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === "string") out[k] = first;
  }
  return out;
};

const searchToQuery = (search: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(search).entries());

const toSearch = (query: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
};

export function usePluginRouter(props: HostRouting): PluginRouter {
  const embedded = computed(() => typeof props.navigate === "function");

  // Standalone mirror of the URL. Only read when not embedded, but kept in sync
  // regardless so a mode flip (never happens in practice) can't strand us.
  const localPath = ref(normalize(window.location.pathname));
  const localQuery = ref(searchToQuery(window.location.search));
  const syncFromUrl = () => {
    localPath.value = normalize(window.location.pathname);
    localQuery.value = searchToQuery(window.location.search);
  };
  window.addEventListener("popstate", syncFromUrl);
  onBeforeUnmount(() => window.removeEventListener("popstate", syncFromUrl));

  const path = computed(() =>
    embedded.value ? normalize(props.path ?? "/") : localPath.value,
  );
  const query = computed(() =>
    embedded.value ? flatten(props.query ?? {}) : localQuery.value,
  );

  const href = (to: string, q?: Record<string, unknown>) =>
    `${window.location.origin}${normalize(`${props.base ?? ""}${to}`)}${toSearch(
      q ?? query.value,
    )}`;

  const go: PluginRouter["go"] = (to, options = {}) => {
    const target = normalize(to);
    if (embedded.value) {
      props.navigate!(target, options);
      return;
    }
    const url = `${normalize(`${props.base ?? ""}${target}`)}${toSearch(
      options.query ?? query.value,
    )}`;
    history[options.replace ? "replaceState" : "pushState"]({}, "", url);
    syncFromUrl();
  };

  const goApp: PluginRouter["goApp"] = (to, q) => {
    if (typeof props.navigateApp !== "function") return false;
    // Host-absolute, unlike go()'s plugin-relative `to`: the host router is
    // being asked to leave for a different page entirely. Query defaults to
    // NOTHING rather than the current one — the caller is exiting this mount
    // point, so carrying ?player/?embed along would land them back in it.
    props.navigateApp(
      `${normalize(`${props.base ?? ""}${to}`)}${toSearch(q ?? {})}`,
    );
    return true;
  };

  return { path, query, go, href, goApp, embedded };
}
