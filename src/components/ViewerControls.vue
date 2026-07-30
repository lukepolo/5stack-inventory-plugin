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
import { computed } from "vue";
import Tooltip from "./Tooltip.vue";
import { isCoarse } from "../responsive";
import { CONTROL_ICON, CONTROL_ICON_VIEWBOX, type ControlIcon } from "../viewerControlIcons";

const props = withDefaults(
  defineProps<{
    /** Attachments can be dragged — adds the ITEM group. */
    edit?: boolean;
    /** There is at least one sticker to rotate (shift-drag; fine pointers only). */
    rotate?: boolean;
    /** `overlay` floats over the canvas and recedes until hovered. */
    variant?: "overlay" | "plain";
  }>(),
  { edit: false, rotate: false, variant: "plain" },
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
      label: "Spin",
      hint: coarse ? "Drag with one finger to rotate the model" : "Drag to rotate the model",
    },
    {
      key: "zoom",
      icon: coarse ? "zoomTouch" : "zoom",
      label: "Zoom",
      hint: coarse ? "Pinch to zoom" : "Scroll to zoom",
    },
    {
      key: "pan",
      icon: coarse ? "panTouch" : "pan",
      label: "Pan",
      hint: coarse ? "Drag with two fingers to pan" : "Right-drag to pan",
    },
  ];
  if (props.edit) {
    out.push({
      key: "move",
      icon: coarse ? "moveTouch" : "move",
      label: "Move",
      // The zoom advice belongs here rather than on Zoom: it only matters once
      // you're placing something, and that's the cell you're looking at.
      hint: "Drag a sticker or charm to move it — zoom in for fine placement",
      group: true,
    });
    // Touch has no shift key, so this gesture is unreachable there. Rotation is
    // still available from the sticker's numeric field — only the hint is gone.
    if (props.rotate && !coarse) {
      out.push({
        key: "rotate",
        icon: "rotate",
        label: "Turn",
        hint: "Shift-drag a sticker to rotate it",
        mod: "shift",
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
  </div>
</template>
