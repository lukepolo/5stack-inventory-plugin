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
import { Settings } from "lucide-vue-next";
import DevHud from "./DevHud.vue";

defineProps<{
  open: boolean;
  /** How many settings differ from their defaults — the badge on the cog. */
  changed?: number;
}>();

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();
</script>

<template>
  <!-- The same `bg-muted p-1` shell the pill tabs use, so the two sit on one
       baseline at one height. A bare button here was 2px shorter and read as
       misaligned. `relative` so the panel hangs off the BUTTON rather than off
       whatever corner it happens to be in. -->
  <div class="relative inline-flex items-center rounded-lg bg-muted p-1">
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
    <!-- Anchored to the cog and scaling out of its own top-left corner, so it
         reads as belonging to the button that opened it. -->
    <DevHud
      :open="open"
      class="absolute left-0 top-full z-[7] mt-1.5 origin-top-left animate-menu-in"
      @close="emit('update:open', false)"
    />
  </div>
</template>
