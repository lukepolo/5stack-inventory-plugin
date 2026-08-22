<script setup lang="ts">
// The 3D viewer's control legend.
//
// Was three lines of prose ("drag to rotate · scroll to zoom · right-drag to
// pan") in a corner, which is the shape of legend you read once and then never
// look at again — by the time you want to know how to pan, a wall of small grey
// text is slower to parse than just trying things. Every viewer worth copying
// (Sketchfab, Blender's gizmo bar, CS2's own inspect screen) shows the same
// information as a row of device glyphs instead: mouse, lit button, motion.
//
// So: one icon per gesture, grouped CAMERA | ITEM with a rule between them,
// because those two groups answer different questions ("how do I look at it"
// vs "how do I change it"). The words survive as tooltips — discoverable on
// hover, out of the way otherwise. On touch there is no hover, so the label
// rides under the icon instead and the glyphs swap mouse for fingertips.
//
// The MOTION group is the third of those questions — "what is it doing" — and it
// is the one cell here that is a control rather than a caption. It appears only
// when the mounted model turned out to have a usable inspect clip, which most of
// the catalogue does not: a transport bar over a model that cannot move is worse
// than no transport at all.
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { FlipHorizontal2, Maximize2, Minimize2, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-vue-next";
import Tooltip from "./Tooltip.vue";
import { isCoarse } from "../responsive";
import { CONTROL_ICON, CONTROL_ICON_VIEWBOX, TRANSPORT_ICON, TRANSPORT_ICON_VIEWBOX, type ControlIcon } from "../viewerControlIcons";
import { ACTION_ICON, ACTION_ICON_VIEWBOX, type ActionIcon } from "../weaponActionIcons";
import type { StageIcon, StageKey } from "../composables/useViewerStage";
import type { InspectTransport } from "../viewer3d";
import { flagValue, flagsVersion, numberValue, numbersVersion, setNumber } from "../devFlags";

const props = withDefaults(
  defineProps<{
    /** Attachments can be dragged — adds the ITEM group. */
    edit?: boolean;
    /** There is at least one sticker to rotate — shift-drag, or a two-finger twist. */
    rotate?: boolean;
    /** `overlay` floats over the canvas and recedes until hovered. */
    variant?: "overlay" | "plain";
    /**
     * Reads the mounted viewer's inspect transport — `handle.inspect`.
     *
     * A GETTER, polled, rather than a value passed down. The alternative is the
     * render loop writing the clip's position into Vue reactivity sixty times a
     * second to move a scrub bar that is often not even on screen; this way the
     * cost belongs to the one component that draws it, at a rate that suits a
     * slider rather than a renderer. Returning null (or omitting the prop) hides
     * the group entirely.
     */
    inspect?: (() => InspectTransport | null) | null;
    /**
     * Stage actions — reset, flip, fullscreen — from `useViewerStage`.
     *
     * They ride THIS bar rather than a second strip of their own because a
     * viewer with two control rows makes the user pick which one to read before
     * they can look for anything. The distinction that matters is not
     * "gestures vs buttons" but where the cell sits: the groups run
     * CAMERA · ITEM · MOTION · VIEW, and VIEW is the frame around the render.
     */
    stage?: StageKey[];
  }>(),
  { edit: false, rotate: false, variant: "plain", inspect: null, stage: () => [] },
);

const emit = defineEmits<{
  (e: "inspect-play", on: boolean): void;
  (e: "inspect-seek", seconds: number): void;
}>();

const tr = inject<(k: string, f: string, n?: Record<string, unknown>) => string>("tr", (_k, f) => f);

/**
 * How often the transport is re-read.
 *
 * A scrub bar is a position readout, not an animation: at 15Hz the thumb still
 * tracks smoothly and the poll costs a fifteenth of what matching the render
 * loop would. rAF rather than an interval so a backgrounded tab stops paying
 * for it at all.
 */
const POLL_MS = 66;
const transport = ref<InspectTransport | null>(null);
/**
 * Where the user has dragged the scrub to, while they are still dragging.
 *
 * The poll would otherwise fight the drag: it writes the clip's real position
 * back into the input every 66ms, so the thumb jumps out from under the pointer
 * on any frame where the seek has not landed yet. Cleared on `change`, which is
 * the event a range input fires when the drag ends.
 */
const scrubAt = ref<number | null>(null);

let raf = 0;
let lastPoll = 0;
function poll(now: number) {
  raf = requestAnimationFrame(poll);
  if (now - lastPoll < POLL_MS) return;
  lastPoll = now;
  transport.value = props.inspect?.() ?? null;
}
// Starts and stops the poll with the prop, so a bar rendered without one costs
// nothing. The getter's identity is what is watched rather than its result: a
// caller that hands over a stable getter (App.vue does — it reads whichever
// handle the slot holds) keeps polling straight through a remount, which is
// exactly what it wants.
watch(
  () => props.inspect,
  (fn) => {
    cancelAnimationFrame(raf);
    raf = 0;
    transport.value = fn?.() ?? null;
    scrubAt.value = null;
    if (fn) raf = requestAnimationFrame(poll);
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(raf));

const scrubValue = computed(() => scrubAt.value ?? transport.value?.time ?? 0);
function onScrub(e: Event) {
  const t = Number((e.target as HTMLInputElement).value);
  scrubAt.value = t;
  emit("inspect-seek", t);
}

/** Names the clip, because "which animation is this" is the first thing anyone
 *  looking at a model that moves wrong will want to know. */
const playHint = computed(() => {
  const t = transport.value;
  if (!t) return "";
  return t.playing
    ? tr("inventory.viewer.controls.pause_clip", "Pause the model's own inspect animation ({clip})", { clip: t.clip })
    : tr("inventory.viewer.controls.play_clip", "Play the model's own inspect animation ({clip})", { clip: t.clip });
});

// The one cell in this bar that is pressed rather than read, so it is the one
// cell that gets a pointer cursor — everything else is deliberately
// `cursor-default` to stop the legend looking like a row of buttons.
const TRANSPORT_BTN =
  "flex flex-none cursor-pointer flex-col items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-1 " +
  "text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground";

/**
 * Semantic name → glyph. The mapping lives here rather than in the composable
 * so that module stays free of an icon-set dependency — see StageIcon.
 */
/** Lucide glyphs for the stage controls. The four weapon actions are NOT here —
 *  they draw CS2's own artwork instead, so this covers the remainder. */
const STAGE_GLYPH: Partial<Record<StageIcon, unknown>> = {
  reset: RotateCcw,
  flip: FlipHorizontal2,
  expand: Maximize2,
  collapse: Minimize2,
};

/** The four weapon actions draw CS2's OWN artwork — see weaponActionIcons. */
const GAME_ICON = new Set<string>(["fire", "reload", "inspect", "deploy"]);
/** A `hidden` key still fires; it just is not offered here. See StageKey. */
const shownStage = computed(() => props.stage.filter((s) => !s.hidden));
// `ActionIcon` also covers glyphs no stage key uses (the stage strip's own
// weapon/held pair), so the predicate narrows to the OVERLAP rather than
// claiming every ActionIcon is a StageIcon.
const isGameIcon = (i: StageIcon): i is StageIcon & ActionIcon => GAME_ICON.has(i);

/** "Reset camera · R" — the key printed with the action it performs, in the one
 *  place someone is already asking what the button does. */
const stageHint = (k: StageKey) => `${k.label} · ${k.cap}`;

// ---- Volume -------------------------------------------------------------------
// The weapon's sounds have a level, and it lives beside the trigger: a slider
// under the fire button is found by the hand that just made the noise, where a
// knob in the debug menu is found by nobody. Offered only with a trigger to
// pull — it is the level of what the weapon actions play, and a viewer with no
// fire button has nothing for it to turn down.
//
// NOT ITS OWN STORAGE. The value is the `fpvvolume` dial from devFlags, the same
// one the debug menu draws as "Weapon volume", so the two can never disagree and
// this component persists nothing of its own. The version ref is what makes a
// localStorage read reactive — see DevHud.
const VOLUME = "fpvvolume";
const hasFire = computed(() => shownStage.value.some((s) => s.icon === "fire"));
/** Sounds off altogether (the debug menu's "Weapon sounds") hides the level:
 *  a slider for a sound that is switched off is a control that does nothing. */
const soundOn = computed(() => {
  void flagsVersion.value;
  return flagValue("fpvsound");
});
const volume = computed(() => {
  void numbersVersion.value;
  return Math.min(1, Math.max(0, numberValue(VOLUME)));
});
const setVolume = (v: number) => setNumber(VOLUME, Math.round(v * 100) / 100);
function onVolume(e: Event) {
  setVolume(Number((e.target as HTMLInputElement).value));
}
/** Where the level was before the mute, so un-muting returns there rather than
 *  to the default. Per mount: a remembered level that outlives the bar is a
 *  surprise a session later. */
let beforeMute = 0.2;
function toggleMute() {
  if (volume.value > 0) {
    beforeMute = volume.value;
    setVolume(0);
  } else {
    setVolume(beforeMute > 0 ? beforeMute : 0.2);
  }
}
const volumePct = computed(() => Math.round(volume.value * 100));
/** The glyph reads the level back: off, quiet, loud. */
const volumeGlyph = computed(() => (volume.value === 0 ? VolumeX : volume.value < 0.5 ? Volume1 : Volume2));
const volumeHint = computed(() => `${tr("inventory.viewer.controls.volume", "Weapon volume")} · ${volumePct.value}%`);
const muteHint = computed(() =>
  volume.value > 0
    ? tr("inventory.viewer.controls.mute", "Mute weapon sounds")
    : tr("inventory.viewer.controls.unmute", "Unmute weapon sounds"),
);

interface Control {
  key: string;
  icon: ControlIcon;
  label: string;
  hint: string;
  /** Keyboard modifier printed ahead of the glyph. */
  mod?: string;
  /** Starts the ITEM group — draws the rule before this cell. */
  group?: boolean;
}

const controls = computed<Control[]>(() => {
  const coarse = isCoarse.value;
  const out: Control[] = [
    {
      key: "spin",
      icon: coarse ? "spinTouch" : "spin",
      label: tr("inventory.viewer.controls.spin", "Spin"),
      hint: coarse
        ? tr("inventory.viewer.controls.spin_hint_touch", "Drag with one finger to rotate the model")
        : tr("inventory.viewer.controls.spin_hint", "Drag to rotate the model"),
    },
    {
      key: "zoom",
      icon: coarse ? "zoomTouch" : "zoom",
      label: tr("inventory.viewer.controls.zoom", "Zoom"),
      hint: coarse
        ? tr("inventory.viewer.controls.zoom_hint_touch", "Pinch to zoom")
        : tr("inventory.viewer.controls.zoom_hint", "Scroll to zoom"),
    },
    {
      key: "pan",
      icon: coarse ? "panTouch" : "pan",
      label: tr("inventory.viewer.controls.pan", "Pan"),
      hint: coarse
        ? tr("inventory.viewer.controls.pan_hint_touch", "Drag with two fingers to pan")
        : tr("inventory.viewer.controls.pan_hint", "Right-drag to pan"),
    },
  ];
  if (props.edit) {
    out.push({
      key: "move",
      icon: coarse ? "moveTouch" : "move",
      label: tr("inventory.viewer.controls.move", "Move"),
      // The zoom advice belongs here rather than on Zoom: it only matters once
      // you're placing something, and that's the cell you're looking at.
      hint: tr("inventory.viewer.controls.move_hint", "Drag a sticker or charm to move it — zoom in for fine placement"),
      group: true,
    });
    // Touch has no shift key, so this cell used to be hidden there entirely and
    // rotation was reachable only through the Advanced form's numeric ROT field
    // — a placement gesture that ran out halfway through, on the device where
    // typing a number is hardest. The viewer now takes a two-finger twist (see
    // applyDrag), so both pointers get a real gesture and the same cell.
    if (props.rotate) {
      out.push({
        key: "rotate",
        icon: coarse ? "rotateTouch" : "rotate",
        label: tr("inventory.viewer.controls.turn", "Turn"),
        hint: coarse
          ? tr("inventory.viewer.controls.turn_hint_touch", "Twist two fingers on a sticker to rotate it")
          : tr("inventory.viewer.controls.turn_hint", "Shift-drag a sticker to rotate it"),
        mod: coarse ? undefined : "shift",
      });
    }
  }
  return out;
});
</script>

<template>
  <div
    class="inline-flex flex-none flex-nowrap items-center gap-0.5 rounded-lg border border-border/60 p-1 backdrop-blur"
    :class="variant === 'overlay' && 'opacity-70 transition-opacity duration-200 hover:opacity-100'"
    style="background: hsl(var(--background) / 0.72); box-shadow: 0 6px 20px -10px hsl(var(--background))"
  >
    <template v-for="c in controls" :key="c.key">
      <span v-if="c.group" class="mx-1 h-5 w-px flex-none bg-border/70"></span>

      <!-- Coarse pointers get the label printed; there is no hover to reveal a
           tooltip on, and an unexplained glyph is worse than no glyph.
           `flex-none` + `whitespace-nowrap`: the printed label is what makes a
           cell wider than its glyph, and a squeezed row broke the labels across
           two lines rather than letting the bar keep its width. -->
      <span
        v-if="isCoarse"
        class="flex flex-none flex-col items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-muted-foreground"
      >
        <svg
          :viewBox="CONTROL_ICON_VIEWBOX"
          style="width: 26px; height: 21px"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="square"
          stroke-linejoin="miter"
          aria-hidden="true"
          v-html="CONTROL_ICON[c.icon]"
        ></svg>
        <span class="text-f8 uppercase tracking-cs2 text-muted-foreground/70">{{ c.label }}</span>
      </span>

      <Tooltip v-else :text="c.hint" side="top" :delay="180">
        <span
          class="flex flex-none cursor-default items-center gap-1 whitespace-nowrap rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          :aria-label="c.hint"
        >
          <span
            v-if="c.mod"
            class="rounded border border-border/70 px-1 py-px font-mono text-f8 uppercase leading-none tracking-cs1"
            >{{ c.mod }}</span
          >
          <svg
            :viewBox="CONTROL_ICON_VIEWBOX"
            style="width: 26px; height: 21px"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="square"
            stroke-linejoin="miter"
            aria-hidden="true"
            v-html="CONTROL_ICON[c.icon]"
          ></svg>
        </span>
      </Tooltip>
    </template>

    <!-- MOTION. Only for a model that actually has a clip — see the `inspect`
         prop. The button is a real control, so unlike every cell above it takes
         a pointer cursor and a hover state that means "clickable". -->
    <template v-if="transport">
      <span class="mx-1 h-5 w-px flex-none bg-border/70"></span>

      <button
        v-if="isCoarse"
        type="button"
        :class="TRANSPORT_BTN"
        :aria-label="playHint"
        @click="emit('inspect-play', !transport.playing)"
      >
        <svg
          :viewBox="TRANSPORT_ICON_VIEWBOX"
          style="width: 21px; height: 21px"
          aria-hidden="true"
          v-html="TRANSPORT_ICON[transport.playing ? 'pause' : 'play']"
        ></svg>
        <span class="text-f8 uppercase tracking-cs2 text-muted-foreground/70">
          {{ transport.playing ? tr('inventory.viewer.controls.pause', 'Pause') : tr('inventory.viewer.controls.play', 'Play') }}
        </span>
      </button>

      <Tooltip v-else :text="playHint" side="top" :delay="180">
        <button
          type="button"
          :class="TRANSPORT_BTN"
          :aria-label="playHint"
          @click="emit('inspect-play', !transport.playing)"
        >
          <svg
            :viewBox="TRANSPORT_ICON_VIEWBOX"
            style="width: 21px; height: 21px"
            aria-hidden="true"
            v-html="TRANSPORT_ICON[transport.playing ? 'pause' : 'play']"
          ></svg>
        </button>
      </Tooltip>

      <!-- The scrub is its own readout: there is no elapsed/total text, because
           a two-second clip's numbers say less than the thumb's position and
           cost the bar a third of its width to print. -->
      <input
        type="range"
        class="clip-range mx-1 flex-none"
        min="0"
        :max="transport.duration"
        step="0.01"
        :value="scrubValue"
        :aria-label="tr('inventory.viewer.controls.scrub', 'Scrub the inspect animation')"
        @input="onScrub"
        @change="scrubAt = null"
      />
    </template>

    <!-- VIEW. The frame around the render rather than the render itself: put
         the camera back, look at the other side, get the chrome out of the way,
         fill the screen. Buttons, so they take the same pointer cursor and
         hover the transport does — and the tooltip carries the key, because
         these are the four things anyone doing this repeatedly wants a key for.

         Coarse pointers get the same buttons with the label printed under the
         glyph (there is no hover to reveal a tooltip on) minus the key cap,
         which means nothing on a device with no keyboard. -->
    <template v-if="shownStage.length">
      <span class="mx-1 h-5 w-px flex-none bg-border/70"></span>

      <template v-for="s in shownStage" :key="s.key">
        <button
          v-if="isCoarse"
          type="button"
          :class="[TRANSPORT_BTN, s.on && 'text-[color:var(--acc)]']"
          :aria-label="s.label"
          @click="!s.release && s.run()"
          @pointerdown="s.release && s.run()"
          @pointerup="s.release?.()"
          @pointerleave="s.release?.()"
        >
          <svg
            v-if="isGameIcon(s.icon)"
            :viewBox="ACTION_ICON_VIEWBOX"
            style="width: 21px; height: 21px"
            fill="currentColor"
            aria-hidden="true"
            v-html="ACTION_ICON[s.icon]"
          ></svg>
          <component v-else :is="STAGE_GLYPH[s.icon]" class="h-[21px] w-[21px]" />
          <span class="text-f8 uppercase tracking-cs2 text-muted-foreground/70">{{ s.label }}</span>
        </button>

        <Tooltip v-else :text="stageHint(s)" side="top" :delay="180">
          <!-- A key with `release` is a HOLD control (the trigger): press and
               let-go, on pointer events, with pointerleave standing in for a
               drag off the button mid-burst. Everything else stays a click. -->
          <button
            type="button"
            :class="[TRANSPORT_BTN, s.on && 'text-[color:var(--acc)]']"
            :aria-label="stageHint(s)"
            @click="!s.release && s.run()"
            @pointerdown="s.release && s.run()"
            @pointerup="s.release?.()"
            @pointerleave="s.release?.()"
          >
            <svg
              v-if="isGameIcon(s.icon)"
              :viewBox="ACTION_ICON_VIEWBOX"
              style="width: 18px; height: 18px"
              fill="currentColor"
              aria-hidden="true"
              v-html="ACTION_ICON[s.icon]"
            ></svg>
            <component v-else :is="STAGE_GLYPH[s.icon]" class="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      </template>
    </template>

    <!-- VOLUME. How loud the weapon actions are, beside the button that makes
         the noise. The speaker is the mute; the slider is the level. On touch
         the readout prints under the glyph, where every other cell prints its
         label. -->
    <template v-if="hasFire && soundOn">
      <span class="mx-1 h-5 w-px flex-none bg-border/70"></span>

      <button v-if="isCoarse" type="button" :class="TRANSPORT_BTN" :aria-label="muteHint" @click="toggleMute">
        <component :is="volumeGlyph" class="h-[21px] w-[21px]" />
        <span class="text-f8 uppercase tracking-cs2 text-muted-foreground/70">{{ volumePct }}%</span>
      </button>

      <Tooltip v-else :text="muteHint" side="top" :delay="180">
        <button type="button" :class="TRANSPORT_BTN" :aria-label="muteHint" @click="toggleMute">
          <component :is="volumeGlyph" class="h-[18px] w-[18px]" />
        </button>
      </Tooltip>

      <!-- Narrower than the scrub: a level has no position worth reading off
           the track, so the thumb's travel is all the width it needs. -->
      <input
        type="range"
        class="clip-range mx-1 flex-none"
        style="width: 56px"
        min="0"
        max="1"
        step="0.05"
        :value="volume"
        :aria-label="volumeHint"
        :title="volumeHint"
        @input="onVolume"
      />
    </template>
  </div>
</template>
