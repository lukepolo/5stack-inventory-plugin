<script setup lang="ts">
// A Sticker Craft in 3D, before using it — opened from a craft tile's picture in
// the sticker picker (Mine or the Craft Store).
//
// The single-sticker preview's own viewer, given a group: the same quad model,
// camera, framing, studio light and slow turn, with the craft laid on one
// larger sheet of its stickers' backing (ViewerOpts.decalGroup in viewer3d).
// Under it: how many stickers it takes, its votes when it is a store craft,
// and Use.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowBigDown, ArrowBigUp, Loader2, X } from "lucide-vue-next";
import { Z } from "../zLayers";
import { CTA_CLASS, CTA_STYLE } from "../ctaButton";
import { useViewerMount } from "../composables/useViewerMount";
import { QUAD_MODELS } from "../viewerModel";
import type { SavedCraft, StoreCraft } from "../stickerCraftsModel";
import type { CraftPlan } from "../composables/useAttachmentPicker";
import { planSentence } from "../craftPlanText";

const props = defineProps<{
  craft: SavedCraft | StoreCraft;
  /** It fits the gun (or the mat) — Use is off otherwise. */
  fits: boolean;
  /** How many stickers fit, for the reason Use is off. */
  room: number;
  /** Where it would go on the gun — null on the mat, or when it doesn't fit. */
  plan: CraftPlan | null;
  /** Where a pick goes: a gun's slots or the Sticker Crafts mat. */
  target: "gun" | "mat";
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "use"): void;
  (e: "vote", v: -1 | 1): void;
}>();

const store = computed(() => ("author" in props.craft ? (props.craft as StoreCraft) : null));
const stageEl = ref<HTMLElement | null>(null);
const failed = ref<string | null>(null);
const viewer = useViewerMount({
  label: "craft preview",
  host: () => stageEl.value,
  onError: (e) => (failed.value = e instanceof Error ? e.message : String(e)),
});
const busy = viewer.busy;
// The single-sticker preview's own options (openPreview3d in App.vue), with
// the craft in place of one decal.
// A dialog takes the keyboard: Close first, so Esc and Tab start inside it.
const closeEl = ref<HTMLButtonElement | null>(null);
onMounted(() => closeEl.value?.focus());
onMounted(() =>
  viewer.mount(QUAD_MODELS.sticker, () => ({
    kind: "sticker",
    decalGroup: props.craft.stickers.map((s) => ({ image: s.image, wear: s.wear, x: s.x, y: s.y, rot: s.rot })),
    frame: "fit",
    interactive: false,
  })),
);
onBeforeUnmount(() => viewer.teardown());

const n = computed(() => props.craft.stickers.length);
const shortName = (name: string) => name.replace(/^Sticker \| /, "");
/** Where Use puts it, or why it can't — the whole sentence, names and all. */
const where = computed(() => {
  if (!props.fits) {
    return props.target === "mat"
      ? `Needs room for ${n.value} on the mat — there is room for ${props.room}.`
      : `Needs ${n.value} empty slots — this gun has ${props.room}.`;
  }
  if (props.plan) return planSentence(props.plan);
  return props.target === "mat" ? "Lays on the mat as a group." : "";
});
</script>

<template>
  <div
    class="fixed inset-0 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
    :style="{ zIndex: Z.previewStage }"
    role="dialog"
    aria-modal="true"
    :aria-label="craft.name"
    @click.self="emit('close')"
  >
    <div class="flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="truncate text-f11 uppercase tracking-cs1">{{ craft.name }}</div>
          <div v-if="store" class="mt-0.5 flex items-center gap-1.5 text-f10 text-muted-foreground">
            <img v-if="store.author.avatar" :src="store.author.avatar" alt="" class="h-4 w-4 rounded-full object-cover" />
            <span v-else class="grid h-4 w-4 place-items-center rounded-full bg-secondary text-f8 uppercase">{{ store.author.name.slice(0, 1) }}</span>
            <span class="truncate">{{ store.author.name }}</span>
          </div>
        </div>
        <button
          ref="closeEl"
          class="flex h-7 w-7 flex-none items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          title="Close (Esc)"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <!-- The single-sticker preview's stage, wider: a craft is a strip. The
           viewer paints its own studio backdrop. -->
      <div class="relative aspect-[4/3] w-full bg-background">
        <div ref="stageEl" class="absolute inset-0" />
        <div v-if="busy" class="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="failed" class="absolute inset-0 grid place-items-center p-6 text-center text-f11 text-destructive">
          The 3D view could not start. {{ failed }}
        </div>
      </div>
      <!-- What is in it, in slot order, and where it would go. -->
      <div class="flex flex-col gap-2 border-t border-border px-3 py-2">
        <div v-if="where" class="text-f11" :class="fits ? 'text-muted-foreground' : 'text-destructive'">{{ where }}</div>
        <div class="flex flex-wrap gap-x-3 gap-y-1.5">
          <div v-for="(s, i) in craft.stickers" :key="i" class="flex min-w-0 items-center gap-1.5 text-f11 text-foreground">
            <img :src="s.image" alt="" class="h-8 w-8 flex-none object-contain" draggable="false" />
            <span class="truncate">{{ shortName(s.name) }}</span>
            <span v-if="plan" class="flex-none font-mono text-f10 text-muted-foreground">slot {{ plan.slots[i] + 1 }}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3 border-t border-border px-3 py-2">
        <span class="text-f11 text-muted-foreground">
          {{ n }} {{ n === 1 ? "sticker" : "stickers" }}
        </span>
        <!-- Votes: a store craft only, and never your own. -->
        <div v-if="store" class="flex items-center gap-0.5">
          <button
            class="grid h-7 w-7 place-items-center rounded transition-colors disabled:opacity-35"
            :class="store.myVote === 1 ? 'text-success' : 'text-muted-foreground hover:text-foreground'"
            :disabled="store.mine"
            :title="store.mine ? 'Your craft' : store.myVote === 1 ? 'Take your upvote back' : 'Upvote'"
            @click="emit('vote', 1)"
          ><ArrowBigUp class="h-4 w-4" /></button>
          <span class="font-mono text-f11" :title="`Score ${store.score}`">{{ store.ups }} · {{ store.downs }}</span>
          <button
            class="grid h-7 w-7 place-items-center rounded transition-colors disabled:opacity-35"
            :class="store.myVote === -1 ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'"
            :disabled="store.mine"
            :title="store.mine ? 'Your craft' : store.myVote === -1 ? 'Take your downvote back' : 'Downvote'"
            @click="emit('vote', -1)"
          ><ArrowBigDown class="h-4 w-4" /></button>
        </div>
        <button
          :class="CTA_CLASS"
          :style="CTA_STYLE"
          class="ml-auto"
          :disabled="!fits"
          :title="fits ? (target === 'mat' ? 'Lay it on the mat' : 'Use this craft') : where"
          @click="emit('use')"
        >
          {{ target === "mat" ? "Place on mat" : "Use this craft" }}
        </button>
      </div>
    </div>
  </div>
</template>
