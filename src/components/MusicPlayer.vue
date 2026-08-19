<script setup lang="ts">
// The preview transport for a music kit — play/pause, the track's length, and a
// scrub bar. Used by the item tile, by the picker's catalog card, by the focus
// stage and by the loadout's own kit slot, which is why it renders the same way
// in all four.
//
// EVERY ELEMENT HERE IS A <span>, never a <button> or an <input>.
//
// Three of the four surfaces put this INSIDE a <button> (the tile root is one,
// the picker card another, and every loadout cell is one). A nested <button> is
// invalid HTML that the parser silently reparents out of its ancestor — the
// control still draws and its click handler is simply gone — and an <input
// type=range> inside a button is interactive content in a phrasing-only slot,
// which is why the scrub is a pointer-driven span rather than a real range
// input. Same rule TileActions follows, for the same reason.
//
// Playback lives in musicPreview: one audio element for the whole plugin, so a
// second kit cannot start without replacing the first. Track LENGTHS live there
// too, cached per URL — that one element can only answer for the one track it
// holds, and this control has to state a length it has never played.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Pause, Play } from "lucide-vue-next";
import { formatDuration, musicPreview } from "../musicPreview";

const props = withDefaults(
  defineProps<{
    /** The kit's audio URL, already resolved and version-stamped by api.ts. */
    src: string;
    /**
     * Transport only — play/pause and the clock, no scrub bar. For the sheet's
     * 68px list rows, which have one line to spare and no width for a track.
     */
    compact?: boolean;
    /**
     * Drawn ON the artwork instead of on a plate over it.
     *
     * A loadout tile gives this ~70px square, and a kit IS its cover art — the
     * one thing distinguishing it from the next kit. A bordered chip at that size
     * covers most of the sleeve, so the control that exists to represent the
     * artwork ends up hiding it. Overlay drops the box: a bare glyph bottom-left,
     * a bare length bottom-right, both kept legible by .art-mark's shadow, and
     * the middle of the sleeve left alone.
     *
     * Fills its parent — the caller positions it over the art well and this owns
     * its own corners, rather than the caller guessing at them.
     */
    overlay?: boolean;
  }>(),
  { compact: false, overlay: false },
);

/** App owns the catalogue and the resolution order; this is the same resolver,
 *  defaulted so the component still renders outside App. */
const tr = inject<(key: string, fallback: string) => string>("tr", (_key, fallback) => fallback);

// Identity for playback ownership: if this component goes away while ITS track
// is playing (the sheet closes, the grid re-windows), the audio stops with it
// rather than playing on with no reachable pause button.
const claim = Symbol("music-preview");

// How long is this kit, BEFORE you commit to hearing it.
//
// The answer comes from a header-only fetch (musicPreview.probe), and it is
// deferred until this control is on screen: these lists are windowed, not
// virtualised — 60 rows mount at once and the sentinel adds 60 more per scroll —
// so measuring on mount would spend sixty requests on the six rows a reader can
// see. The observer lives in musicPreview and is shared by every player.
const root = ref<HTMLElement | null>(null);
onMounted(() => root.value && musicPreview.measure(root.value, props.src));
watch(
  () => props.src,
  (url) => {
    if (!root.value) return;
    // Unobserve first. Re-observing an element the observer already holds is a
    // no-op that fires no callback, so a row that swapped kits while on screen
    // would keep advertising the previous track's length indefinitely.
    musicPreview.unmeasure(root.value);
    musicPreview.measure(root.value, url);
  },
);
onBeforeUnmount(() => {
  musicPreview.release(claim);
  if (root.value) musicPreview.unmeasure(root.value);
});

const current = computed(() => musicPreview.isCurrent(props.src));
const playing = computed(() => current.value && musicPreview.playing.value);
const failed = computed(() => musicPreview.failed.value === props.src);
const elapsed = computed(() => (current.value ? musicPreview.time.value : 0));
/** Live off the element while this is the loaded track, out of the cache when it
 *  isn't. The element only ever knows about ONE track, so reading it alone left
 *  every other row on a screenful of kits claiming a length of zero. */
const total = computed(() =>
  current.value && musicPreview.duration.value > 0 ? musicPreview.duration.value : musicPreview.durationOf(props.src),
);
const fraction = computed(() => (total.value > 0 ? Math.min(1, elapsed.value / total.value) : 0));
/** Playback has actually begun on THIS track. A paused track still counts — its
 *  elapsed figure is real, and hiding it on pause would read as a reset. */
const started = computed(() => current.value && (playing.value || elapsed.value > 0));

/**
 * m:ss, in two forms, because an untouched player and a running one are asked
 * different questions.
 *
 * Idle, the useful fact is the LENGTH — "how long is this kit" — and it shows
 * alone. "0:00 / 2:38" would answer it too, but it reads as a track sitting
 * stalled at the start, so the elapsed half only appears once there is elapsed
 * time to report.
 *
 * Nothing at all when the length is still unknown, or never resolves: a 404, a
 * codec the browser won't touch, a mount without the audio extracted. "0:00" for
 * an unknown length is a wrong answer where an empty slot is merely no answer,
 * and it is the case that actually turns up in the wild.
 */
const clock = computed(() => {
  const stamp = formatDuration;
  if (started.value) return total.value > 0 ? `${stamp(elapsed.value)} / ${stamp(total.value)}` : stamp(elapsed.value);
  return total.value > 0 ? stamp(total.value) : "";
});

function onToggle() {
  void musicPreview.toggle(props.src, claim);
}

// Pointer-driven scrub. `setPointerCapture` is what makes a drag survive leaving
// the 4px-tall track — without it the bar stops following the finger the moment
// it strays vertically, which on a phone is immediately.
let scrubbing = false;
function seekFrom(e: PointerEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (box.width > 0) musicPreview.seek(props.src, (e.clientX - box.left) / box.width);
}
function onScrubDown(e: PointerEvent) {
  if (!current.value) return;
  scrubbing = true;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  seekFrom(e);
}
function onScrubMove(e: PointerEvent) {
  if (scrubbing) seekFrom(e);
}
function onScrubUp(e: PointerEvent) {
  scrubbing = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}
</script>

<template>
  <!--
    `.stop` on BOTH click and pointerdown, everywhere.

    Click, because the surfaces this sits on equip on click: a play button that
    also equipped the kit you were trying to hear would be the worst possible
    version of this feature. Pointerdown, because ItemTile starts its long-press
    timer there, and a 450ms hold on the scrub bar would open the item's action
    menu mid-drag.
  -->
  <!-- One conditional gap rather than a static `gap-2` plus a compact override:
       two gap utilities on one element resolve by stylesheet order, not by the
       order they are written in, so the "override" is a coin toss. -->
  <!-- Overlay: markings on the sleeve, not a widget on top of it. Every node is
       a <span> for the same reason the row below is — this renders inside the
       loadout cell's <button>, and a <button> inside a <button> is invalid HTML
       that browsers silently reflow. -->
  <span
    v-if="overlay"
    ref="root"
    class="pointer-events-none absolute inset-0 z-[3]"
    @click.stop
    @pointerdown.stop
  >
    <!-- Left margin, vertically centred on the sleeve rather than pinned to a
         corner. These tiles are wide and only ~70px tall, so "bottom-left" put
         the glyph level with the middle of the art anyway — it read as the first
         item in a ROW of three (glyph, sleeve, clock) instead of a mark on the
         cover. Centred against the art it reads as belonging to it, and the wide
         tile has margin going spare on both sides. -->
    <span
      role="button"
      tabindex="-1"
      :aria-pressed="playing"
      :title="playing ? tr('inventory.music.pause', 'Pause preview') : tr('inventory.music.play', 'Play preview')"
      class="art-mark pointer-events-auto absolute left-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full transition-colors"
      :class="playing ? 'text-[color:var(--acc)]' : 'text-white/90 hover:text-[color:var(--acc)]'"
      @click.stop="onToggle"
    >
      <!-- Pause where play was, in the same 20px target. This briefly showed an
           animated equaliser instead: nicer to look at, and wrong — a READOUT
           standing where the CONTROL is, so stopping a track meant hunting for a
           button that had turned into a picture. Playing state is carried by the
           accent colour and by the groove below, neither of which is somewhere
           anyone would think to click.

           `component :is` rather than two v-ifs: one node, so the element
           survives the swap and keyboard focus is not dropped on toggle. -->
      <component :is="playing ? Pause : Play" class="h-3.5 w-3.5" fill="currentColor" />
    </span>

    <!-- No clock here. A length printed beside the sleeve made three unrelated
         things sit in a line across the tile, and "0:04 / 2:08" is wide enough to
         crowd the art on its own. The caption row underneath already carries the
         slot's name and has room to spare, so the length lives there — see
         LoadoutCell. Elapsed is what the groove below is for.

         The failure still belongs on the art: it explains why the glyph did
         nothing, so it has to be where the glyph is. -->
    <span
      v-if="failed"
      class="art-mark absolute bottom-0.5 right-1 text-f8 uppercase tracking-cs1 text-white/70"
    >{{ tr('inventory.music.failed', 'Preview unavailable') }}</span>

    <!-- Progress as a groove along the very bottom edge, full-bleed. A bar with
         ends would be a second widget; an edge that fills reads as part of the
         card. Only while playing — an idle hairline is a UI element with nothing
         to say. -->
    <span
      v-if="playing"
      class="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-black/30"
    >
      <span
        class="absolute inset-y-0 left-0 bg-[color:var(--acc)]"
        :style="{ width: `${fraction * 100}%` }"
      ></span>
    </span>
  </span>

  <span
    v-else
    ref="root"
    class="flex min-w-0 items-center"
    :class="compact ? 'gap-1.5' : 'gap-2'"
    @click.stop
    @pointerdown.stop
  >
    <span
      role="button"
      tabindex="-1"
      :aria-pressed="playing"
      :title="playing ? tr('inventory.music.pause', 'Pause preview') : tr('inventory.music.play', 'Play preview')"
      class="grid flex-none cursor-pointer place-items-center rounded-full border transition-colors"
      :class="[
        compact ? 'h-6 w-6' : 'h-7 w-7',
        playing
          ? 'border-[color:var(--acc)] text-[color:var(--acc)]'
          : 'border-border text-muted-foreground hover:border-[color:var(--acc)] hover:text-[color:var(--acc)]',
      ]"
      @click.stop="onToggle"
    >
      <!-- Filled, not outlined: at 12px a stroked play triangle is three thin
           lines and reads as a chevron. Lucide draws these unfilled by default
           and passes an explicit `fill` straight through to the <svg>. -->
      <component :is="playing ? Pause : Play" :class="compact ? 'h-3 w-3' : 'h-3.5 w-3.5'" fill="currentColor" />
    </span>

    <!-- A failed track says so where the scrub would have been. The transport
         stays, so a retry is one click away rather than a reload. -->
    <span v-if="failed" class="min-w-0 flex-1 truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">
      {{ tr('inventory.music.failed', 'Preview unavailable') }}
    </span>
    <template v-else>
      <span
        v-if="!compact"
        role="slider"
        aria-orientation="horizontal"
        :aria-label="tr('inventory.music.seek', 'Seek preview')"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="Math.round(fraction * 100)"
        class="relative h-1.5 min-w-0 flex-1 rounded-full bg-border"
        :class="current ? 'cursor-pointer' : 'cursor-default opacity-60'"
        @pointerdown.stop="onScrubDown"
        @pointermove="onScrubMove"
        @pointerup="onScrubUp"
        @pointercancel="onScrubUp"
      >
        <span
          class="absolute inset-y-0 left-0 rounded-full bg-[color:var(--acc)]"
          :style="{ width: `${fraction * 100}%` }"
        ></span>
      </span>
      <!-- v-if, not an empty string: the row is a flex with a gap, so a blank
           span would still reserve its share of it — a play button sitting
           visibly off-centre on every track whose header never landed. -->
      <span v-if="clock" class="flex-none font-mono text-f9 tabular-nums text-muted-foreground">{{ clock }}</span>
    </template>
  </span>
</template>
