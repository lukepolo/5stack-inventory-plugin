<script setup lang="ts">
// The viewer settings cog, and the panel it opens.
//
// One component because BOTH item screens carry it. It used to exist only in
// the modal — floating in the pane's corner on a hand-measured offset — which
// meant the focus view had no way to reach lighting, bloom or motion at all
// while showing the same model through the same renderer.
//
// It sits to the LEFT of the 2D/3D switch: this decides how the model is drawn,
// the switch decides whether you are looking at the model at all, and the
// broader question goes first.
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Settings } from "lucide-vue-next";
import DevHud from "./DevHud.vue";
import { Z } from "../zLayers";

const props = defineProps<{
  open: boolean;
  /** How many settings differ from their defaults — the badge on the cog. */
  changed?: number;
}>();

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

/** DevHud's own fixed width, mirrored here so the clamp can do its arithmetic
 *  before the panel exists to measure. */
const PANEL_W = 320;
/** The gap under the cog. Was `mt-1.5`. */
const GAP = 6;

const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const box = ref<{ left: number; top: number; max: number } | null>(null);
/** Read once on open, not in `place()` — that runs on every scroll event, and a
 *  colour cannot change under it. */
const acc = ref("");

/**
 * Where the panel goes, measured from the cog.
 *
 * It hangs from a button inside a card with `overflow-hidden`, so as a child of
 * that card it was CUT at the card's bottom edge — the advanced section and the
 * last sliders sat outside the clip with no rounded corner, which is what a
 * teleport to <body> is here to fix. Positioning is the cost of leaving: out
 * there nothing lays it out, so the two numbers have to be measured.
 *
 * `fixed` is correct now and was not always. DevHud's own comment records it
 * failing, because a fixed element is contained by the nearest transformed
 * ancestor rather than the viewport and the host panel had several — but this
 * lands on body, which by construction has none above it.
 *
 * `--acc` is copied because it is the one token that does NOT come along: the
 * theme vars are scoped to [data-cs2-inventory] and ride on the attributes
 * below, while --acc is set inline on the app frame this is now outside of.
 * Without it the panel's "N changed" badge renders transparent.
 */
function place() {
  const el = root.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  box.value = {
    left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
    top: r.bottom + GAP,
    // Keeps the old 60vh where there is room, and gives up only what the
    // viewport actually withholds. The subtraction covers the panel's header
    // and a margin off the bottom edge; the scroller takes the rest.
    max: Math.max(180, Math.min(vh * 0.6, vh - r.bottom - GAP - 56)),
  };
}

/**
 * Press anywhere else and it closes.
 *
 * CAPTURE phase, on the document: the 3D viewer binds its own pointerdown to
 * the stage container with `capture` and can claim a press for a drag, so a
 * bubbling listener would never hear the presses aimed at the model — which is
 * the most obvious place to click when a panel is covering it. Capture on the
 * document runs before any of that, and only reads the event.
 *
 * BOTH elements count as inside. The cog, because pressing it to close must
 * fall through to its own toggle instead of being closed here first and
 * reopened by the click that follows; the panel, because teleporting it out of
 * the button's subtree means `root` alone no longer contains it, and every
 * slider drag inside it would read as a press on the outside world.
 */
function onDocPointerDown(e: PointerEvent) {
  const t = e.target as Node;
  if (root.value?.contains(t) || panel.value?.contains(t)) return;
  emit("update:open", false);
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      acc.value = getComputedStyle(root.value!).getPropertyValue("--acc").trim();
      place();
      await nextTick();
      document.addEventListener("pointerdown", onDocPointerDown, true);
      window.addEventListener("resize", place);
      // Capture, because the scroll that moves the cog is an inner pane's, and
      // scroll does not bubble to window from the element that did it.
      window.addEventListener("scroll", place, true);
    } else {
      stop();
    }
  },
);

function stop() {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
}
// Closing by unmount — switching to 2D drops the cog entirely — never runs the
// watcher's `else`, so the listeners would outlive the component.
onBeforeUnmount(stop);
</script>

<template>
  <!-- The same `bg-muted p-1` shell the pill tabs use, so the two sit on one
       baseline at one height. A bare button here was 2px shorter and read as
       misaligned. -->
  <div ref="root" class="relative inline-flex items-center rounded-lg bg-muted p-1">
    <!-- OPEN gets the same amber indicator an active pill tab gets, because it
         sits in the same shell and "this one is engaged" should look the same in
         both. An INSET ring, not a border: this plugin ships without Tailwind's
         preflight, so `box-sizing` is not guaranteed to be border-box and a real
         1px border would grow the button and shift the badge pinned to its
         corner. -->
    <button
      class="relative grid h-[22px] w-[26px] place-items-center rounded-md transition-all active:scale-95"
      :class="open ? 'text-foreground' : changed ? 'text-[#f2c14e]' : 'text-muted-foreground hover:text-foreground'"
      :style="open
        ? {
            background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.12)',
            boxShadow: 'inset 0 0 0 1px hsl(var(--tac-amber, 33 94% 58%) / 0.45), 0 0 12px hsl(var(--tac-amber, 33 94% 58%) / 0.25)',
          }
        : {}"
      :title="`Viewer settings (Ctrl/Cmd + Shift + D)${changed ? ` — ${changed} changed` : ''}`"
      :aria-expanded="open"
      @click="emit('update:open', !open)"
    >
      <Settings class="h-3.5 w-3.5" />
      <span
        v-if="changed"
        class="absolute -right-0.5 -top-0.5 grid h-3 w-3 place-items-center rounded-full bg-[#e0a92e] font-mono text-[8px] text-background"
      >{{ changed }}</span>
    </button>
    <!-- Teleported to body, but still anchored to the cog and still scaling out
         of its own top-left corner, so it reads as belonging to the button that
         opened it. The two data attributes are what carry the design system's
         utilities and this plugin's own [data-cs2-inventory] tokens out here —
         without them the panel renders unstyled at the top of the document. -->
    <Teleport to="body">
      <div
        v-if="open && box"
        ref="panel"
        data-5stack-plugin
        data-cs2-inventory
        class="fixed origin-top-left animate-menu-in"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          zIndex: Z.popover,
          '--acc': acc,
          '--devhud-max': `${box.max}px`,
        }"
      >
        <DevHud :open="open" @close="emit('update:open', false)" />
      </div>
    </Teleport>
  </div>
</template>
