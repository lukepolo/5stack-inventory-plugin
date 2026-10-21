// Bytes fetched AHEAD of a 3D mount, and the hooks the loaders use to take them.
//
// src/prefetch.ts decides what to warm and when (a tile hover, an Edit press,
// the equipped items once the page is idle). This file is the other half: an
// in-memory store of what it fetched, and four small functions the loaders call
// in place of a plain fetch()/URL so that a warmed file is never downloaded
// twice. It imports nothing from the app on purpose — the loaders it is called
// from (viewer3d, paintComposite, compositeStore, rawPng) are also used by the
// test rigs, and none of them should drag the planner in.
//
// WHY ITS OWN STORE AND NOT THE HTTP CACHE
// Warming the browser cache with a fetch() and hoping the loader's request hits
// it does not work here, measurably:
//   - asset responses can be `no-cache` (dev serves the models that way), so a
//     later request revalidates or downloads again regardless;
//   - Safari does not reuse a fetch() for a later request with a different mode
//     or credentials mode, and three's TextureLoader loads through an <img>, so
//     the two requests never match even when the response is cacheable.
// So the bytes are held here and handed over directly: as a Response for the
// callers that fetch(), and as a blob: URL for three's loaders, which only take
// a URL. Either way the DECODE path is the one the loader always used — a blob:
// URL goes through the same TextureLoader/ImageBitmapLoader, and the Safari PNG
// path in rawPng.ts still gets the raw bytes it inflates itself. Nothing here
// decodes an image.
//
// TAKE, DON'T PEEK
// A loader that finds its file here removes it. From then on the bytes live in
// that loader's own cache (the parsed-GLTF LRU, the composite LRU, the paint
// texture cache), and keeping a second copy would only count twice against the
// budget. When nothing usable is held — never warmed, failed, evicted — every
// hook falls through to exactly the request the loader made before, so a page
// on which prefetch never ran behaves identically.
//
// POLITENESS
// Background warms run at most two at a time with fetch priority "low", pause
// while the tab is hidden, and do not START while an interactive viewer is
// building (whoever installs the busy probe decides what that means). A hover
// warm that has not started yet is dropped when the pointer leaves. A press
// (Edit, View in 3D) is URGENT: it is the viewer's own download moved earlier,
// so it is not throttled.

export type Lane = 0 | 1 | 2;
/** A press: the viewer is about to ask for this. Not throttled. */
export const URGENT: Lane = 0;
/** A hover, or the follow-up work after a press. Background. */
export const HOVER: Lane = 1;
/** Idle-time warming of the equipped items. Background, and only into the
 *  share of the budget no hover has used. */
export const IDLE: Lane = 2;

/** Who asked. Cancelling one drops its warms that have not started, unless
 *  another intent (or a press) wants the same file. */
export class Intent {
  cancelled = false;
}
/** Owner of press and idle warms, which are never cancelled. */
const PERMANENT = new Intent();

type State = "queued" | "loading" | "ready" | "missing" | "failed" | "dropped";
/** What a warm ended as, for the planner deciding its next step. */
export type WarmResult = Exclude<State, "queued" | "loading">;

interface Entry {
  key: string;
  lane: Lane;
  state: State;
  /** Held bytes. Null for a call (see warmCall), which holds nothing. */
  blob: Blob | null;
  /** A call: run for its side effect, then forgotten. */
  call: (() => Promise<unknown>) | null;
  owners: Set<Intent>;
  /** Exempt from eviction until then — a press's files must still be here
   *  when the viewer asks a second later, whatever a hover did meanwhile. */
  pinnedUntil: number;
  /** When it settled. A 404 is only trusted for MISS_TTL_MS. */
  at: number;
  done: Promise<WarmResult>;
  resolve: (r: WarmResult) => void;
}

// ---- Tuning -----------------------------------------------------------------
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
/** Bytes held for loaders that have not asked yet. A painted HD AK-47 is ~31MB
 *  of GLB and textures, so this is about five such items on desktop. Phones
 *  get far less: they have the memory of one, and no hover to justify more. */
export const BUDGET_BYTES = (COARSE ? 40 : 150) * 1024 * 1024;
/** Idle warms only fill this share of the budget, so they never push out what
 *  a hover warmed. */
const IDLE_SHARE = 1 / 3;
const MAX_BACKGROUND = 2;
/** Presses are not throttled, only capped at what a browser runs in parallel
 *  per host anyway. */
const MAX_URGENT = 6;
const PIN_MS = 60_000;
/** A store file that 404'd may be baked by someone else a minute later. */
const MISS_TTL_MS = 60_000;
/** How long a file a loader took stays reachable for a repeat load of the same
 *  URL (see `taken`). blob: URLs are resolved when the loader starts its
 *  request, which is immediately, so this is not a race. */
const REVOKE_MS = 60_000;
/** A warm nobody opened is let go after this, budget or not — the tab should
 *  not carry an hour-old hover's 30MB. */
const UNUSED_TTL_MS = 10 * 60_000;

// ---- Logging ----------------------------------------------------------------
/**
 * `prefetchlog` (Developer tab -> Prefetch log), sticky like the viewer's other
 * `xxxlog` switches (see
 * compositeStore's `compositelog`): every warm queued, started and finished,
 * and every loader that took a file or fell through. Off, it costs a boolean.
 */
export function stickyFlag(name: string): boolean {
  try {
    const key = `viewer3d.${name}`;
    const q = new URLSearchParams(location.search).get(name);
    if (q === "1") localStorage.setItem(key, "1");
    if (q === "0") localStorage.removeItem(key);
    // "1" only. The Developer tab's switches (devFlags.ts setFlag) store OFF as
    // "0", which `!!getItem` read as ON: a flag switched on and off again there
    // stayed on here for good.
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
export const PREFETCH_LOG = stickyFlag("prefetchlog");
export const plog = (...a: unknown[]) => {
  if (PREFETCH_LOG) console.log("[prefetch]", ...a);
};
const short = (url: string) => url.replace(/^https?:\/\/[^/]+/, "").replace(/\?v=[^&]*$/, "").slice(-90);
const mb = (n: number) => `${(n / 1048576).toFixed(2)}MB`;

// ---- State ------------------------------------------------------------------
// Insertion order is LRU order: settling or re-warming an entry moves it to
// the end, eviction takes from the front.
const entries = new Map<string, Entry>();
const queue: Entry[] = [];
let held = 0;
let activeBackground = 0;
let activeUrgent = 0;
let busy: () => boolean = () => false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const counters = { warmed: 0, warmedBytes: 0, taken: 0, takenBytes: 0, fellThrough: 0, evicted: 0, dropped: 0, peakBackground: 0 };

/** Installed by the planner: true while an interactive viewer is building.
 *  Background warms do not start while it is. */
export function setBusyProbe(probe: () => boolean) {
  busy = probe;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pump();
  });
}

// ---- Use tracking -----------------------------------------------------------
// Which URLs a loader has already asked for, warmed or not, so the planner does
// not warm a file the loader's own cache already holds. Counted per CLASS, since
// each loader cache has its own size: "was this parse asked for within the last
// 12 parses" approximates "is it still in the parsed-GLTF LRU" far better than
// a clock does — a card backfill parses a hundred models in a minute. A parse
// is noted under gltfUseKey, `<glb url>#<variant>`; the GLB URL on its own only
// answers usedSince.
type UseClass = "parse" | "composite" | "other";
const classOf = (url: string): UseClass =>
  url.includes("#") ? "parse" : /\/composites\//.test(url) ? "composite" : "other";
const classSeq: Record<UseClass, number> = { parse: 0, composite: 0, other: 0 };
let useSeq = 0;
const lastUse = new Map<string, { at: number; nth: number }>();

/** The use key loadGltf notes for one parse of a GLB: per variant, because
 *  each variant keeps a different set of the model's textures. */
export const gltfUseKey = (glbUrl: string, variant: { legacy: boolean; painted: boolean }) =>
  `${glbUrl}#${variant.legacy ? "legacy" : "hd"}|${variant.painted ? "p" : "u"}`;

/** Record that a loader asked for `url`. The hooks below do this themselves;
 *  call it directly only from a cache hit that never reaches them. */
export function notePrefetchUse(url: string) {
  lastUse.set(url, { at: ++useSeq, nth: ++classSeq[classOf(url)] });
}
/** Did a loader ask for `url` within its class's last `within` uses? */
export function usedRecently(url: string, within = Infinity): boolean {
  const u = lastUse.get(url);
  return !!u && classSeq[classOf(url)] - u.nth < within;
}
/** A point in the use sequence, for usedSince. */
export const useMark = () => useSeq;
/** Did a loader ask for `url` after `mark`? That is the race a planner checks
 *  right before warming a file: a loader that already went to the network for
 *  it would otherwise be followed by a second, useless download. */
export function usedSince(url: string, mark: number): boolean {
  return (lastUse.get(url)?.at ?? -1) > mark;
}

// ---- Producer side (src/prefetch.ts) ----------------------------------------
/**
 * Warm `url` into the store. Resolves with what it ended as: "ready" (bytes
 * held), "missing" (404 — remembered briefly so a store lookup can skip the
 * round trip), "failed", or "dropped" (cancelled before it started).
 */
export function warmUrl(url: string, lane: Lane, intent: Intent = PERMANENT): Promise<WarmResult> {
  return enqueue(url, lane, intent, null);
}

/**
 * Run `fn` through the same queue, for warms that are a call rather than a file
 * (loadPaintDef, fetchStickerGeometry): their own promise caches hold the
 * result, so nothing is kept here — the queue only decides when they run.
 */
export function warmCall(key: string, lane: Lane, intent: Intent, fn: () => Promise<unknown>): Promise<WarmResult> {
  return enqueue(`call:${key}`, lane, intent, fn);
}

function enqueue(key: string, lane: Lane, intent: Intent, call: (() => Promise<unknown>) | null): Promise<WarmResult> {
  const now = performance.now();
  let e = entries.get(key);
  if (e && e.state === "missing" && now - e.at > MISS_TTL_MS) {
    entries.delete(key);
    e = undefined;
  }
  if (e) {
    e.owners.add(intent);
    if (lane < e.lane) e.lane = lane;
    if (lane === URGENT) e.pinnedUntil = Math.max(e.pinnedUntil, now + PIN_MS);
    if (e.state === "ready") {
      // Touched: to the back of the LRU.
      e.at = now;
      entries.delete(key);
      entries.set(key, e);
    }
    if (e.state === "queued") pump();
    return e.done;
  }
  let resolve!: (r: WarmResult) => void;
  const done = new Promise<WarmResult>((r) => (resolve = r));
  e = {
    key,
    lane,
    state: "queued",
    blob: null,
    call,
    owners: new Set([intent]),
    pinnedUntil: lane === URGENT ? now + PIN_MS : 0,
    at: now,
    done,
    resolve,
  };
  entries.set(key, e);
  queue.push(e);
  pump();
  return done;
}

/** The pointer left: drop this intent's warms that have not started. */
export function cancelIntent(intent: Intent) {
  intent.cancelled = true;
  for (let i = queue.length - 1; i >= 0; i--) {
    const e = queue[i];
    if (!e.owners.delete(intent) || e.owners.size || e.lane === URGENT) continue;
    queue.splice(i, 1);
    entries.delete(e.key);
    e.state = "dropped";
    counters.dropped++;
    e.resolve("dropped");
  }
}

/** The held bytes of a ready entry, WITHOUT taking it — for the planner, which
 *  reads a GLB's JSON chunk to learn which textures to warm next. */
export function peekBlob(url: string): Blob | null {
  const e = entries.get(url);
  return e?.state === "ready" ? e.blob : null;
}

export function heldBytes() {
  return held;
}

function pump() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  for (;;) {
    const next = pickNext();
    if (!next) return;
    start(next);
  }
}

function pickNext(): Entry | null {
  // Urgent first, FIFO within a lane.
  if (activeUrgent < MAX_URGENT) {
    const i = queue.findIndex((e) => e.lane === URGENT);
    if (i >= 0) return queue.splice(i, 1)[0];
  }
  if (activeBackground >= MAX_BACKGROUND || !queue.length) return null;
  if (typeof document !== "undefined" && document.hidden) return null; // visibilitychange re-pumps
  if (busy()) {
    // No event says "the viewer finished building", so look again shortly.
    retryTimer = setTimeout(pump, 300);
    return null;
  }
  let i = queue.findIndex((e) => e.lane === HOVER);
  if (i < 0) {
    i = queue.findIndex((e) => e.lane === IDLE);
    // Idle only fills what is left of its share; past that the rest of the idle
    // queue is not worth its bytes, so it is dropped rather than left waiting.
    if (i >= 0 && held > BUDGET_BYTES * IDLE_SHARE) {
      for (const e of queue.filter((q) => q.lane === IDLE)) {
        queue.splice(queue.indexOf(e), 1);
        entries.delete(e.key);
        e.state = "dropped";
        counters.dropped++;
        e.resolve("dropped");
      }
      plog("idle share of the budget is full — dropped the rest of the idle queue", mb(held));
      return null;
    }
  }
  return i >= 0 ? queue.splice(i, 1)[0] : null;
}

function start(e: Entry, promoted = false) {
  const urgent = e.lane === URGENT || promoted;
  if (urgent) activeUrgent++;
  else activeBackground++;
  counters.peakBackground = Math.max(counters.peakBackground, activeBackground);
  e.state = "loading";
  if (!e.call) plog("start", short(e.key), promoted ? "promoted by a loader" : ["urgent", "hover", "idle"][e.lane]);
  const t0 = performance.now();
  const call = e.call;
  const work: Promise<{ state: WarmResult; blob: Blob | null }> = call
    ? Promise.resolve().then(call).then(
        () => ({ state: "ready" as const, blob: null }),
        () => ({ state: "failed" as const, blob: null }),
      )
    : fetchBlob(e.key, urgent);
  void work.then(({ state, blob }) => {
    if (urgent) activeUrgent--;
    else activeBackground--;
    e.at = performance.now();
    if (e.call || state !== "ready") {
      // A call holds nothing, and a failure must not stand between the loader
      // and its own request: both are forgotten. A 404 stays, briefly.
      if (state !== "missing") entries.delete(e.key);
      e.state = state;
      if (!e.call) plog(state, short(e.key), `${(e.at - t0).toFixed(0)}ms`);
    } else {
      e.state = "ready";
      e.blob = blob;
      held += blob!.size;
      counters.warmed++;
      counters.warmedBytes += blob!.size;
      // Settled entries move to the back of the LRU.
      if (entries.get(e.key) === e) {
        entries.delete(e.key);
        entries.set(e.key, e);
      }
      plog("ready", short(e.key), mb(blob!.size), `${(e.at - t0).toFixed(0)}ms`, ["urgent", "hover", "idle"][e.lane], `held ${mb(held)}`);
      evict();
      scheduleSweep();
    }
    e.resolve(e.state as WarmResult);
    pump();
  });
}

async function fetchBlob(url: string, urgent: boolean): Promise<{ state: WarmResult; blob: Blob | null }> {
  try {
    // "low" only for the background lanes: a press is the viewer's own
    // request moved earlier, and should not lose to anything.
    const res = await fetch(url, urgent ? undefined : { priority: "low" });
    if (res.status === 404 || res.status === 410) return { state: "missing", blob: null };
    // A dev server answering an unknown path with the app shell is a miss to
    // every loader (see hasModel), but not one this store may vouch for:
    // falling through lets the loader see exactly what it always saw.
    if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
      return { state: "failed", blob: null };
    }
    return { state: "ready", blob: await res.blob() };
  } catch {
    return { state: "failed", blob: null };
  }
}

function evict() {
  const now = performance.now();
  for (const e of entries.values()) {
    // Expired 404s hold no bytes, but nothing else ever clears them.
    if (e.state === "missing" && now - e.at > MISS_TTL_MS) entries.delete(e.key);
  }
  for (const e of entries.values()) {
    if (held <= BUDGET_BYTES) return;
    if (e.state !== "ready" || e.pinnedUntil > now) continue;
    release(e, "evicted");
  }
}

function release(e: Entry, why: string) {
  entries.delete(e.key);
  held -= e.blob?.size ?? 0;
  counters.evicted++;
  plog(why, short(e.key), mb(e.blob?.size ?? 0));
  e.blob = null;
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = undefined;
    const now = performance.now();
    let left = false;
    for (const e of entries.values()) {
      if (e.state !== "ready") continue;
      if (now - e.at > UNUSED_TTL_MS && e.pinnedUntil < now) release(e, "expired");
      else left = true;
    }
    if (left) scheduleSweep();
  }, UNUSED_TTL_MS / 2);
}

// ---- Consumer side (the loaders) --------------------------------------------
/** The entry a loader may use for `url`, after waiting out a warm in flight. A
 *  warm still queued is started now, ahead of everything — the loader would
 *  otherwise make the same request itself. */
async function settled(url: string): Promise<Entry | undefined> {
  let e = entries.get(url);
  if (e?.state === "queued") {
    queue.splice(queue.indexOf(e), 1);
    e.lane = URGENT;
    start(e, true);
  }
  if (e?.state === "loading") {
    plog("loader waits for", short(url));
    await e.done;
    e = entries.get(url);
  }
  return e;
}

function take(e: Entry): Taken | null {
  entries.delete(e.key);
  const blob = e.blob;
  e.blob = null;
  if (!blob) return null;
  held -= blob.size;
  counters.taken++;
  counters.takenBytes += blob.size;
  plog("HIT", short(e.key), mb(blob.size));
  const t: Taken = { blob, objectUrl: null };
  taken.set(e.key, t);
  setTimeout(() => {
    if (taken.get(e.key) === t) taken.delete(e.key);
    if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
  }, REVOKE_MS);
  return t;
}

/**
 * A file a loader took stays reachable for REVOKE_MS, under ONE blob: URL.
 *
 * Several loads of the same URL are normal: Valve's combo shader and the port
 * both load the pattern through loadTex with different sampler settings, so
 * the texture cache misses and the second load asks again. Without prefetch the
 * browser's in-memory image cache answers that second <img> from the first, by
 * URL. Handing the first a blob: URL and the second the real one broke that
 * pairing and downloaded the file twice (measured: the 1MB pattern of AK-47 |
 * Predator). Same URL for both, and the image cache pairs them again.
 */
interface Taken {
  blob: Blob;
  objectUrl: string | null;
}
const taken = new Map<string, Taken>();
const objectUrl = (t: Taken) => (t.objectUrl ??= URL.createObjectURL(t.blob));
const response = (t: Taken) => new Response(t.blob, { status: 200, headers: { "content-type": t.blob.type } });

/**
 * fetch(url), served from the store when it holds the file. For loaders that
 * read a Response themselves (the GLB in loadGltf, the PNG bytes in rawPng).
 * Anything but held bytes — including a remembered 404 — goes to the network,
 * so the loader's own error handling sees exactly what it always did.
 */
export async function prefetchedFetch(url: string): Promise<Response> {
  notePrefetchUse(url);
  const recent = taken.get(url);
  if (recent) return response(recent);
  const e = await settled(url);
  const t = e?.state === "ready" ? take(e) : null;
  if (t) return response(t);
  if (e) entries.delete(e.key);
  counters.fellThrough++;
  return fetch(url);
}

/**
 * The URL a three.js loader should load for `url`: a blob: URL of the held
 * bytes, or `url` itself. REJECTS when the file is known to be missing (a 404
 * within the last minute), so a caller that treats a failed load as "not
 * there" — the composite store lookup — gets that answer without the round
 * trip, exactly as if the request had 404'd.
 */
export async function prefetchedUrl(url: string): Promise<string> {
  notePrefetchUse(url);
  const recent = taken.get(url);
  if (recent) return objectUrl(recent);
  const e = await settled(url);
  const t = e?.state === "ready" ? take(e) : null;
  if (t) return objectUrl(t);
  if (e?.state === "missing" && performance.now() - e.at <= MISS_TTL_MS) {
    entries.delete(e.key);
    plog("HIT (known 404)", short(url));
    throw new Error(`404 ${url}`);
  }
  if (e) entries.delete(e.key);
  counters.fellThrough++;
  return url;
}

/**
 * Synchronous form, for GLTFLoader's URL modifier, which cannot await: a blob:
 * URL when the bytes are already held, else null. Pair it with
 * settlePrefetched() before the parse, so nothing is still in flight by then.
 */
export function prefetchedUrlSync(url: string): string | null {
  notePrefetchUse(url);
  const recent = taken.get(url);
  if (recent) return objectUrl(recent);
  const e = entries.get(url);
  const t = e?.state === "ready" ? take(e) : null;
  return t ? objectUrl(t) : null;
}

/** Wait for any of `urls` still being warmed, and start any still queued, so a
 *  synchronous lookup afterwards finds them. Free when none are in the store. */
export async function settlePrefetched(urls: string[]): Promise<void> {
  const pending = urls.filter((u) => {
    const s = entries.get(u)?.state;
    return s === "queued" || s === "loading";
  });
  if (pending.length) await Promise.all(pending.map((u) => settled(u)));
}

// ---- Debug ------------------------------------------------------------------
export function prefetchStats() {
  const by: Record<string, number> = {};
  for (const e of entries.values()) by[e.state] = (by[e.state] ?? 0) + 1;
  return {
    held: mb(held),
    budget: mb(BUDGET_BYTES),
    activeBackground,
    viewerBusy: busy(),
    activeUrgent,
    queued: queue.length,
    entries: by,
    ...counters,
    warmedBytes: mb(counters.warmedBytes),
    takenBytes: mb(counters.takenBytes),
  };
}
