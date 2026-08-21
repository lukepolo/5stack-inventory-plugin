<script setup lang="ts">
// THE STAGE — one item, looked at. Shared by the focus view and the item modal.
//
// These are the two screens you open to study a single item, and they had drifted
// into two different pictures of it: the modal drew a rarity glow and a masked
// grid behind the model and put its view controls in the top-left corner of the
// pane; focus drew neither, kept its 2D/3D switch up in the header next to the
// item's name, and floated its control bar over the canvas. Same item, same job,
// two layouts — which is how someone learns to distrust both.
//
// The modal's arrangement won because it is the one that belongs to the MODEL
// rather than to the page around it: chrome in the pane's own corners, backdrop
// behind the thing it is lighting. Focus adopting it also fixes the flat, unlit
// background it had.
//
// WHAT IS NOT IN HERE: anything only one caller has. The cost readout, the agent
// pose tabs, the developer cog and the craft's own rendering badge come in
// through slots, positioned by the caller in the pane's coordinate space, so
// this component owns the stage and not the business of either screen.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { isCompact } from "../responsive";
import { Camera, Loader2 } from "lucide-vue-next";
import PillTabs from "./PillTabs.vue";
import ViewerControls from "./ViewerControls.vue";
import { ACTION_ICON, ACTION_ICON_BOX, ACTION_ICON_VIEWBOX } from "../weaponActionIcons";
import { glowStyle } from "../itemVisuals";
import type { InspectTransport } from "../viewer3d";
import type { StageKey } from "../composables/useViewerStage";

const props = withDefaults(
  defineProps<{
    /** Whether a 3D model exists at all. No model, no switch. */
    available?: boolean;
    /** Which view is up. */
    is3d: boolean;
    /** First person — the model in your hands. Only offered for weapons. */
    held?: boolean;
    heldAvailable?: boolean;
    /** The mount is still fetching. */
    busy?: boolean;
    /** Rarity colour, for the glow behind the model. */
    rarity?: string | null;
    /** This pane is the fullscreen element right now. */
    fullscreen?: boolean;
    /**
     * The pane runs to the edges of whatever contains it — the caller pulls it
     * out past its own padding with a negative margin, and this drops the
     * rounding so the corner that shows is the CARD's, not two nested ones.
     *
     * The padding is for text. A render is not text: an inset canvas reads as a
     * picture of a weapon pasted into a page, and the same weapon reaching the
     * edges reads as a window.
     */
    bleed?: boolean;
    /** Passed through to the control bar. */
    stageKeys?: StageKey[];
    edit?: boolean;
    rotate?: boolean;
    inspect?: (() => InspectTransport | null) | null;
    /** Pre-filled issue link. Absent hides the link. */
    reportHref?: string | null;
    /** Offer "save image" — false while there is nothing rendered to save. */
    canSave?: boolean;
  }>(),
  {
    available: true,
    held: false,
    heldAvailable: false,
    busy: false,
    rarity: null,
    fullscreen: false,
    bleed: false,
    stageKeys: () => [],
    edit: false,
    rotate: false,
    inspect: null,
    reportHref: null,
    canSave: false,
  },
);

const emit = defineEmits<{
  (e: "update:is3d", v: boolean): void;
  (e: "update:held", v: boolean): void;
  (e: "inspect-play", on: boolean): void;
  (e: "inspect-seek", t: number): void;
  (e: "save"): void;
}>();

/**
 * The pane itself and the 3D host, handed back to the caller.
 *
 * `useViewerMount` and `useViewerStage` both take GETTERS for their elements, so
 * a caller reads these off the component instance — `host: () => stage.value
 * ?.hostEl` — and nothing has to be passed down as a prop.
 */
const stageEl = ref<HTMLElement | null>(null);
const hostEl = ref<HTMLElement | null>(null);
defineExpose({ stageEl, hostEl });

/**
 * THE LAST FRAME, HELD ACROSS A REMOUNT.
 *
 * Putting the weapon in your hands rebuilds the viewer — the arms are a second
 * GLB and the weapon re-parents onto a hand bone, neither of which is a live
 * setter — so the canvas is destroyed and another is built in its place.
 * Between those two the pane is empty, and what the eye sees is the model
 * vanishing, a spinner, then a differently-framed model appearing: a jolt in
 * the middle of what should read as one continuous view.
 *
 * The 2D canvas the viewer blits into can be read at any time, so the frame
 * that was on screen is copied out before it goes and held over the pane until
 * the new one is drawing, then faded. Nothing about the viewer changes; the gap
 * is covered by what was there a moment ago.
 */
const frozen = ref<string | null>(null);
let freezeTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.busy,
  (busy) => {
    clearTimeout(freezeTimer);
    if (busy) {
      if (frozen.value) return;
      for (const c of hostEl.value?.querySelectorAll("canvas") ?? []) {
        try {
          const url = (c as HTMLCanvasElement).toDataURL("image/png");
          // A WebGL canvas without preserveDrawingBuffer reads back blank, so
          // take the longest — the blit target is the one with the picture.
          if (url.length > (frozen.value?.length ?? 0)) frozen.value = url;
        } catch {
          /* a tainted canvas is not worth failing a transition over */
        }
      }
      return;
    }
    // A beat of overlap: `busy` clears when the mount RESOLVES, and the first
    // frame lands after that.
    freezeTimer = setTimeout(() => (frozen.value = null), 140);
  },
);
onBeforeUnmount(() => clearTimeout(freezeTimer));


/** The two ways of looking at the MODEL, once you are looking at the model. */
const HELD_TABS = ["weapon", "held"] as const;
const HELD_LABEL: Record<string, string> = {
  weapon: "The weapon on its own",
  held: "First person — the weapon in your hands (V)",
};
const heldOn = computed(() => (props.held ? "held" : "weapon"));

const iconBox = (k: string) => ACTION_ICON_BOX[k as keyof typeof ACTION_ICON_BOX] ?? ACTION_ICON_VIEWBOX;
const iconMarkup = (k: string) => ACTION_ICON[k as keyof typeof ACTION_ICON] ?? "";

/**
 * WHERE THE PANE'S OWN CHROME SITS.
 *
 * A bleeding pane's edge IS the card's edge, so chrome pinned to it lands in
 * the card's padding — the held toggle ended up flush against the border with
 * the item's name inset 32px above it. Bleeding therefore re-states the padding
 * the pane was pulled out of, and everything lines up with the text again.
 */
const chromeTL = computed(() => (props.bleed ? (isCompact.value ? "left-4 top-3" : "left-8 top-5") : "left-0 top-0"));
const chromeBL = computed(() => (props.bleed ? (isCompact.value ? "bottom-3 left-4" : "bottom-4 left-8") : "bottom-2 left-4"));
const chromeBR = computed(() => (props.bleed ? (isCompact.value ? "bottom-3 right-4" : "bottom-4 right-8") : "bottom-2 right-4"));
const chromeBC = computed(() => (props.bleed ? (isCompact.value ? "bottom-3" : "bottom-4") : "bottom-2"));

const REPORT_LINK =
  "text-f9 uppercase tracking-cs2 text-muted-foreground/45 underline decoration-dotted underline-offset-2 transition-colors hover:text-muted-foreground";
</script>

<template>
  <!-- min-h so the pane has a height before anything is in it: the canvas is
       height:100%, and against a flex-sized (indefinite) host it would fall back
       to its drawing-buffer height and grow the column. -->
  <!-- overflow-hidden CLIPS THE GLOW. It is a blurred `absolute inset-0`, and a
       30px blur paints well outside the box that owns it — which is why the
       rarity light was washing across the spec column and the card's own padding
       instead of lighting the model. rounded so the clip follows a corner rather
       than cutting a square out of the card. -->
  <div
    ref="stageEl"
    class="relative flex min-h-[320px] w-full flex-1 items-center justify-center overflow-hidden"
    :class="[fullscreen && 'bg-background', !bleed && 'rounded-xl']"
  >
    <!-- The rarity glow, then a grid that fades out before it reaches the edges.
         Both sit behind everything (no z), both are pointer-transparent: they
         are lighting, not surface. A fullscreen pane composites against the
         browser's own backdrop rather than the panel, which is why the explicit
         background above matters — without it these two float over black. -->
    <span v-if="rarity" class="pointer-events-none absolute inset-0" :style="glowStyle(rarity, 0.3)"></span>
    <span
      class="pointer-events-none absolute inset-0 z-[1] opacity-[0.045]"
      style="background-image: linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px); background-size: 44px 44px; -webkit-mask-image: radial-gradient(ellipse at center, black 25%, transparent 72%); mask-image: radial-gradient(ellipse at center, black 25%, transparent 72%)"
    ></span>

    <!-- The flat artwork. Kept mounted under `v-show` so a 2D↔3D flip does not
         re-run its own enter transition every time. -->
    <div v-show="!is3d" class="relative z-[2] flex h-full w-full items-center justify-center">
      <slot name="flat" />
    </div>

    <!-- absolute, not h-full — see the note on min-h above. -->
    <div v-show="is3d" ref="hostEl" class="absolute inset-0 z-[2]"></div>
    <!-- The held frame, over the gap. `object-contain` so a pane that resized
         mid-swap shows the old frame at its own shape rather than stretched. -->
    <Transition enter-active-class="transition-opacity duration-150" leave-active-class="transition-opacity duration-200" leave-to-class="opacity-0">
      <img v-if="is3d && frozen" :src="frozen" alt="" class="pointer-events-none absolute inset-0 z-[3] h-full w-full object-contain" />
    </Transition>
    <div v-if="is3d && busy && !frozen" class="absolute inset-0 z-[3] grid place-items-center">
      <div class="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 class="h-6 w-6 animate-spin text-[color:var(--acc)]" />
        <span class="text-f11 uppercase tracking-cs2">Loading 3D model…</span>
      </div>
    </div>

    <!-- The pane's top-left corner, for whatever the caller floats there. The
         held toggle used to live here; it sits with the other viewer controls
         at the bottom now — it is a control on the VIEW, and the corner over
         the model is where the item's own name and price are. -->
    <div v-if="$slots.tools" class="absolute z-[5] flex items-center gap-1.5" :class="chromeTL">
      <slot name="tools" />
    </div>

    <!-- Anything else the caller wants in the pane, in its coordinate space. -->
    <slot name="chrome" />

    <!-- BOTTOM: what you do WITH the picture (report it, save it) in the
         corners, and how you move it in the middle. The control bar recedes to
         70% until hovered so it reads as chrome rather than as part of the item. -->
    <a
      v-if="is3d && reportHref"
      :href="reportHref"
      target="_blank"
      rel="noopener noreferrer"
      :class="['absolute z-[3]', chromeBL, REPORT_LINK]"
      title="Open a GitHub issue pre-filled with this item's details"
    >
      Report a problem
    </a>
    <!-- Bottom CENTRE: how you move the picture. -->
    <ViewerControls
      v-if="is3d && !busy"
      variant="overlay"
      :edit="edit"
      :rotate="rotate"
      :inspect="inspect"
      :stage="stageKeys"
      class="absolute left-1/2 z-[3] -translate-x-1/2"
      :class="chromeBC"
      @inspect-play="(on) => emit('inspect-play', on)"
      @inspect-seek="(t) => emit('inspect-seek', t)"
    />
    <!-- Bottom RIGHT, pinned: which picture it is, and taking one of it.
         Deliberately not in the centred group — that group grows and shrinks
         with what the item supports (a charm adds a control, an agent adds a
         pose), and anything sharing a row with it moved every time. Against the
         corner these two stay where the hand learned they are.

         SAVE IS A CAMERA, not the words "save image" in the corner: same height
         as the toggle beside it, reads at a glance, and a control that comes
         and goes no longer shifts a line of text around. -->
    <div v-if="is3d && !busy" class="absolute z-[3] flex items-center gap-2" :class="chromeBR">
      <PillTabs
        v-if="available && heldAvailable"
        :items="HELD_TABS"
        :item-key="(k) => k"
        :item-title="(k) => HELD_LABEL[k]"
        :active="heldOn"
        button-class="relative z-[1] flex items-center rounded-md px-2 py-1 transition-colors"
        @select="(k) => emit('update:held', k === 'held')"
      >
        <template #default="{ item: k }">
          <svg class="h-4 w-4" :viewBox="iconBox(k)" fill="currentColor" aria-hidden="true" v-html="iconMarkup(k)" />
        </template>
      </PillTabs>
      <button
        v-if="canSave"
        class="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground"
        title="Save this view as a PNG"
        @click="emit('save')"
      >
        <Camera class="h-4 w-4" />
      </button>
    </div>

  </div>
</template>
