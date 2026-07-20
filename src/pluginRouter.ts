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

import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from "vue";

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

  // Embedded, `props.path` is the host's ECHO of a navigation we asked for, and
  // it lands a tick or more after go() returns. Anything reading the path inside
  // that window sees the old route — and a watcher that flushes after the same
  // click that navigated (say, one mirroring state into the query with
  // `replace`) will then write against the route we just left and silently undo
  // the navigation. Hold the requested path until the flush is over; the echo
  // has taken over by then, so this only papers over the synchronous gap.
  const pendingPath = ref<string | null>(null);
  // The query needs the same hold as the path, or the two tear: during the gap
  // the route flips synchronously while the query is still the old echo, and a
  // watcher keying off both sees a hybrid state that never existed — e.g.
  // "loadout route, but no ?slot yet" on modal close, which reset the selected
  // slot and collapsed the rail behind the closing modal.
  const pendingQuery = ref<Record<string, string> | null>(null);
  const path = computed(() =>
    embedded.value ? pendingPath.value ?? normalize(props.path ?? "/") : localPath.value,
  );
  const query = computed(() =>
    embedded.value
      ? pendingQuery.value ?? flatten(props.query ?? {})
      : localQuery.value,
  );

  // Releasing the hold is the whole ballgame, and it CANNOT be done on a timer.
  //
  // This used to release on nextTick(), on the reasoning that watchers queued by
  // the navigating click had run by then and the echo had taken over. The first
  // half is true; the second is not. The echo is a round-trip through the host's
  // router and measured 20-60ms — thousands of times longer than a microtask. In
  // the gap between release and echo, `path` fell back to `props.path`, which
  // still held the route we had just LEFT. So a close navigated to /items, the
  // path snapped back to /items/<id>/craft, and the route watcher — correctly,
  // against a route that was lying — reopened the modal it had just torn down,
  // rebuilding the 3D viewer in the process. That was the flicker.
  //
  // So: hold until the host actually speaks. Any CHANGE to the echo means it
  // landed, and that's the release condition rather than an exact match on what
  // we asked for — the host is entitled to redirect, normalise a trailing slash,
  // or land somewhere else entirely, and none of those would equal our target.
  // Waiting for an exact match would hold a stale value forever.
  //
  // Path and query are held SEPARATELY because the host echoes them separately,
  // up to a frame apart. Releasing both the moment the path echo lands drops the
  // query hold while the query echo is still in flight, and `query` falls back to
  // the pre-navigation echo for that frame. That tear is not cosmetic: closing a
  // modal back to the loadout produced one frame of "route is /, but ?slot is
  // still absent", and the slot watcher reads an absent ?slot as the DEFAULT —
  // so it reset the focused slot and collapsed the rail behind the closing modal.
  type Hold = { stop: (() => void) | null; timer: ReturnType<typeof setTimeout> | undefined };
  const holds: Record<"path" | "query", Hold> = {
    path: { stop: null, timer: undefined },
    query: { stop: null, timer: undefined },
  };
  const clearHold = (which?: "path" | "query") => {
    for (const k of which ? [which] : (["path", "query"] as const)) {
      holds[k].stop?.();
      holds[k].stop = null;
      clearTimeout(holds[k].timer);
      holds[k].timer = undefined;
    }
  };
  /**
   * Hold `pending` until the corresponding host prop changes.
   *
   * `read` must return a comparable snapshot of the echo (a string), so the
   * query can be compared by value rather than by object identity — the host
   * hands us a fresh object on every render and identity alone would fire
   * instantly, releasing the hold before anything actually changed.
   */
  function holdUntilEcho(
    which: "path" | "query",
    read: () => string,
    release: () => void,
  ) {
    // A second navigation supersedes the first; only the newest hold matters.
    clearHold(which);
    const before = read();
    const done = () => {
      clearHold(which);
      release();
    };
    holds[which].stop = watch(read, (now) => { if (now !== before) done(); }, { flush: "sync" });
    // Backstop: a navigation the host drops on the floor (blocked, or deduped as
    // a same-path no-op) produces no echo at all, and a navigation that doesn't
    // change the query produces no query echo. Without this the hold would pin
    // the route to a state we never actually reached.
    holds[which].timer = setTimeout(done, 1500);
  }
  onBeforeUnmount(clearHold);

  const href = (to: string, q?: Record<string, unknown>) =>
    `${window.location.origin}${normalize(`${props.base ?? ""}${to}`)}${toSearch(
      q ?? query.value,
    )}`;

  const go: PluginRouter["go"] = (to, options = {}) => {
    const target = normalize(to);
    if (embedded.value) {
      // Only a push moves the route; a replace stays put, so letting it claim
      // `pendingPath` would let the query-sync watcher clobber a push that is
      // still in flight.
      if (!options.replace) {
        // Query FIRST, path second. Both are refs, so each assignment is
        // independently observable by a sync watcher — and assigning the path
        // first published a state of "new path, old query" that never existed
        // as far as the caller was concerned. Setting the query first means the
        // only intermediate state is "old path, new query", which no consumer
        // keys off (the query is read as belonging to whatever path it arrives
        // with, and that path is about to change in the same statement).
        //
        // Mirror toSearch's semantics (drop null/undefined/empty) so the held
        // query equals what the echo will eventually say.
        if (options.query) {
          const held: Record<string, string> = {};
          for (const [k, v] of Object.entries(options.query)) {
            if (v === undefined || v === null || v === "") continue;
            held[k] = String(v);
          }
          pendingQuery.value = held;
          holdUntilEcho(
            "query",
            () => JSON.stringify(flatten(props.query ?? {})),
            () => {
              if (pendingQuery.value === held) pendingQuery.value = null;
            },
          );
        }
        pendingPath.value = target;
        holdUntilEcho(
          "path",
          () => normalize(props.path ?? "/"),
          () => {
            if (pendingPath.value === target) pendingPath.value = null;
          },
        );
      }
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
