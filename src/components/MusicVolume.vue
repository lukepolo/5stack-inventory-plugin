<script setup lang="ts">
// The music kit preview's volume: a mute toggle and a level bar. One level for
// every player (musicPreview), so this can sit anywhere — the craft sheet's
// toolbar puts it there once instead of on every card in the grid.
//
// Spans, not a <button> and an <input type=range>, for the reason MusicPlayer
// gives: it is also drawn inside players that live inside <button>s.
import { computed, inject } from "vue";
import { Volume1, Volume2, VolumeX } from "lucide-vue-next";
import { musicPreview } from "../musicPreview";

const props = withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });

const tr = inject<(key: string, fallback: string) => string>("tr", (_key, fallback) => fallback);

const volume = computed(() => musicPreview.volume.value);
const volumeIcon = computed(() => (volume.value === 0 ? VolumeX : volume.value < 0.5 ? Volume1 : Volume2));
let adjusting = false;
function volumeFrom(e: PointerEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (box.width > 0) musicPreview.setVolume((e.clientX - box.left) / box.width);
}
function onVolumeDown(e: PointerEvent) {
  adjusting = true;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  volumeFrom(e);
}
function onVolumeMove(e: PointerEvent) {
  if (adjusting) volumeFrom(e);
}
function onVolumeUp(e: PointerEvent) {
  adjusting = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}
</script>

<template>
  <span class="flex flex-none items-center gap-1" @click.stop @pointerdown.stop>
    <span
      role="button"
      tabindex="-1"
      :aria-pressed="volume === 0"
      :title="volume === 0 ? tr('inventory.music.unmute', 'Unmute') : tr('inventory.music.mute', 'Mute')"
      class="grid h-5 w-5 cursor-pointer place-items-center text-muted-foreground transition-colors hover:text-[color:var(--acc)]"
      @click.stop="musicPreview.toggleMute()"
    >
      <component :is="volumeIcon" class="h-3.5 w-3.5" />
    </span>
    <span
      role="slider"
      aria-orientation="horizontal"
      :aria-label="tr('inventory.music.volume', 'Preview volume')"
      :title="tr('inventory.music.volume', 'Preview volume')"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="Math.round(volume * 100)"
      class="relative cursor-pointer rounded-full bg-border"
      :class="props.wide ? 'h-1.5 w-28' : 'h-1 w-12'"
      @pointerdown.stop="onVolumeDown"
      @pointermove="onVolumeMove"
      @pointerup="onVolumeUp"
      @pointercancel="onVolumeUp"
    >
      <span class="absolute inset-y-0 left-0 rounded-full bg-muted-foreground" :style="{ width: `${volume * 100}%` }"></span>
    </span>
  </span>
</template>
