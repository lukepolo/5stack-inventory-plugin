// ONE audio element for the whole plugin.
//
// "Only one kit plays at a time" can be built by remembering every player and
// pausing the others, and that is the version that breaks: a tile scrolled out
// of the sheet's windowed list is unmounted without ever being asked to stop,
// and you end up with two tracks playing and a visible control for neither. So
// there is exactly one element here and every surface drives it. A second track
// cannot start without replacing the first, because there is nowhere for it to
// play — the guarantee is structural rather than remembered.
//
// Created lazily, not at module load: the first play always comes from a click
// (browsers refuse audio without a user gesture), so there is no reason to hold
// a media element for a session that never previews anything.
//
// The other half of this module is track LENGTHS, which are deliberately not the
// element's business — see the cache below. Nothing here ever starts audio; the
// only thing that does is `toggle`, and only a click reaches it.
import { computed, ref } from "vue";

const src = ref<string | null>(null);
const playing = ref(false);
const time = ref(0);
const duration = ref(0);
/** The track failed to load — a missing extraction, a 404, an unplayable codec.
 *  Kept per URL so switching kits clears it without a separate reset call. */
const failedSrc = ref<string | null>(null);

let el: HTMLAudioElement | null = null;
/**
 * Whoever asked for the current track.
 *
 * A component that unmounts while its own track is playing stops it — closing
 * the picker sheet should not leave music playing with no way to reach the
 * pause button. Ownership is checked first so the FOCUS view unmounting its
 * player cannot silence a tile that took playback over in the meantime.
 */
let owner: symbol | null = null;

function element(): HTMLAudioElement {
  if (el) return el;
  const audio = new Audio();
  // Metadata only. The whole point of serving these with byte ranges is that a
  // preview costs the seconds it plays; "auto" would defeat that by pulling all
  // 3.5MB the moment a track is selected.
  audio.preload = "metadata";
  // Deliberately NOT crossOrigin: nothing here reads the samples, and setting it
  // would impose a CORS preflight requirement on an asset host that has no
  // reason to satisfy one.
  audio.addEventListener("timeupdate", () => (time.value = audio.currentTime));
  audio.addEventListener("durationchange", () => {
    // Infinity/NaN until the metadata lands, and a scrub bar computed from that
    // renders as NaN% — which CSS drops, leaving a bar frozen at zero while the
    // track plays.
    duration.value = Number.isFinite(audio.duration) ? audio.duration : 0;
    // Into the shared cache as well. The one track that IS loaded already knows
    // its length, and without this the player it belongs to would fire a second
    // header request the moment playback moved on and it went back to idle.
    remember(src.value, audio.duration);
  });
  audio.addEventListener("ended", () => {
    playing.value = false;
    time.value = 0;
  });
  audio.addEventListener("pause", () => (playing.value = false));
  audio.addEventListener("play", () => (playing.value = true));
  audio.addEventListener("error", () => {
    failedSrc.value = src.value;
    playing.value = false;
  });
  el = audio;
  return audio;
}

/** Is this URL the one loaded right now? */
const isCurrent = (url: string | null | undefined) => !!url && src.value === url;

// ---- track lengths, without playing anything --------------------------------
//
// A length is a fact about the FILE, not about playback, so it lives beside the
// element rather than on it: the one element can only answer for the one track
// it holds, which is why a list of kits used to read "0:00" on every row but the
// last one played. Cached per URL so a row that scrolls away and back — or a
// kit that is both owned and shown in the picker — costs one request, ever.
const durations = ref<Record<string, number>>({});
/** URLs a probe has already been fired for, in flight or finished. A FAILURE
 *  counts: a 404 that never resolves must not re-request on every re-observe. */
const probed = new Set<string>();

function remember(url: string | null, seconds: number): void {
  // Infinity for a live stream, NaN before the header lands, 0 for a file the
  // decoder gave up on — none of the three is a length, and all three format as
  // something ("Infinity:NaN") a reader would rightly report as broken.
  if (url && Number.isFinite(seconds) && seconds > 0) durations.value[url] = seconds;
}

/**
 * Read a track's header without playing it.
 *
 * `preload="metadata"` fetches the first few KB — enough for the duration — and
 * stops there, which is the only reason showing a length up front is affordable
 * against 3.5MB tracks at all.
 *
 * A THROWAWAY element, not the shared one. Pointing that at a track to measure
 * it would silently take playback away from whatever was playing, which is the
 * exact failure the single-element design exists to make impossible. This one is
 * never played, holds no `owner`, and is garbage the moment its one listener has
 * fired.
 */
function probe(url: string): void {
  if (probed.has(url) || durations.value[url] != null) return;
  probed.add(url);
  const meta = new Audio();
  meta.preload = "metadata";
  meta.addEventListener("loadedmetadata", () => remember(url, meta.duration), { once: true });
  meta.src = url;
}

/**
 * One observer for every player on screen, not one per player.
 *
 * `preload="metadata"` is a request each, and these lists are windowed rather
 * than virtualised — the inventory grid and the kit picker mount 60 rows and
 * grow by 60 more on every scroll — so measuring on mount would fire sixty
 * requests to answer a question about the six rows you can actually see.
 * Intersection bounds the cost to the viewport instead. The observer is shared
 * because sixty of them is sixty things the browser reconciles on every scroll
 * frame to reach an answer that is identical.
 */
let visibility: IntersectionObserver | null = null;
const waiting = new WeakMap<Element, string>();

function observer(): IntersectionObserver | null {
  if (visibility) return visibility;
  if (typeof IntersectionObserver === "undefined") return null;
  visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const url = waiting.get(entry.target);
      // Unobserve BEFORE probing: a length is measured once and the element has
      // nothing left to say, so leaving it registered would keep it in the
      // observer's target list for the life of the page.
      unmeasure(entry.target);
      if (url) probe(url);
    }
  });
  return visibility;
}

/** Resolve `url`'s length once `el` is actually on screen. */
function measure(el: Element, url: string): void {
  if (durations.value[url] != null) return;
  const io = observer();
  // No IntersectionObserver at all. Ask outright rather than leave every readout
  // permanently blank — a browser this old is already mounting these windowed
  // grids badly, and the request is the smaller of the two problems.
  if (!io) {
    probe(url);
    return;
  }
  waiting.set(el, url);
  io.observe(el);
}

/** Stop waiting on `el` — it unmounted, or its track changed under it. */
function unmeasure(el: Element): void {
  if (!waiting.delete(el)) return;
  visibility?.unobserve(el);
}

/**
 * m:ss. Lives here rather than in MusicPlayer because the loadout cell prints a
 * length in its caption without mounting a transport, and two copies of this
 * would drift the moment one of them learned about hours.
 */
export const formatDuration = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Length in seconds, or 0 when it is not known — see the idle clock in
 *  MusicPlayer for why "not known" must not render as "0:00". */
const durationOf = (url: string | null | undefined) => (url ? durations.value[url] ?? 0 : 0);

/**
 * Play/pause `url`, taking playback over from whatever held it.
 *
 * Must be called from a user gesture the first time — autoplay policy rejects
 * `play()` otherwise, and the rejection is reported as a failed track rather
 * than swallowed, so the control says something instead of doing nothing.
 */
async function toggle(url: string, claim: symbol): Promise<void> {
  const audio = element();
  if (isCurrent(url)) {
    if (playing.value) {
      audio.pause();
      return;
    }
  } else {
    src.value = url;
    failedSrc.value = null;
    time.value = 0;
    duration.value = 0;
    audio.src = url;
  }
  owner = claim;
  try {
    await audio.play();
  } catch {
    // Autoplay refusal, or a track that never loaded. Both look the same from
    // here and both mean "this control did not do what it said".
    failedSrc.value = url;
    playing.value = false;
  }
}

/** Jump within the current track. A no-op for a track that isn't loaded — a
 *  scrub cannot start playback, since that would be audio without a gesture. */
function seek(url: string, fraction: number): void {
  if (!isCurrent(url) || !el || !duration.value) return;
  const at = Math.min(Math.max(fraction, 0), 1) * duration.value;
  el.currentTime = at;
  time.value = at;
}

/** Give up playback if this owner still holds it (component teardown). */
function release(claim: symbol): void {
  if (owner !== claim) return;
  owner = null;
  el?.pause();
}

export const musicPreview = {
  src,
  playing,
  time,
  duration,
  isCurrent,
  toggle,
  seek,
  release,
  durationOf,
  measure,
  unmeasure,
  failed: computed(() => failedSrc.value),
};
