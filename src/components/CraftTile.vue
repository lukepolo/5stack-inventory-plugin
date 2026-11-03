<script setup lang="ts">
// One Sticker Craft in the sticker picker's Sticker Crafts tab — yours (Mine)
// or a published one (the Craft Store).
//
// Not one big button like a sticker tile: a craft is looked at before it is
// used. The picture opens it in 3D (CraftPreview), Use puts it on the gun, and
// between them the tile says what is in it, where it would go, and — in the
// store — who made it and how it is rated. A craft with more stickers than
// there is room for stays on the shelf, greyed, saying how much room it needs.
//
// No hover tooltips (title): they popped up over the pictures. What a control
// does is on it or beside it; screen readers get aria-labels.
import { computed } from "vue";
import { ArrowBigDown, ArrowBigUp, Box, Globe } from "lucide-vue-next";
import type { SavedCraft, StoreCraft } from "../stickerCraftsModel";
import type { CraftPlan } from "../composables/useAttachmentPicker";
import { planLine } from "../craftPlanText";
import { isCompact } from "../responsive";
import CraftUseCase from "./CraftUseCase.vue";

const props = defineProps<{
  craft: SavedCraft | StoreCraft;
  fits: boolean;
  /** How many stickers there is room for here. */
  room: number;
  /** Where it would go on the gun — null on the mat, or when it doesn't fit. */
  plan: CraftPlan | null;
  /** Where a pick goes: a gun's slots or the Sticker Crafts mat. */
  target: "gun" | "mat";
  /** One of your own crafts that is in the store. */
  published?: boolean;
  /** Its votes in the store, for one of yours (Mine has no store row). */
  score?: { ups: number; downs: number; score: number } | null;
}>();
const emit = defineEmits<{
  (e: "preview"): void;
  (e: "use"): void;
  (e: "vote", v: -1 | 1): void;
}>();

const store = computed(() => ("author" in props.craft ? (props.craft as StoreCraft) : null));
const n = computed(() => props.craft.stickers.length);
const shortName = (name: string) => name.replace(/^Sticker \| /, "");
/** Where Use would put it, or why it can't. */
const where = computed(() => {
  if (!props.fits) {
    return props.target === "mat"
      ? `Needs room for ${n.value} · the mat has room for ${props.room}`
      : `Needs ${n.value} empty slots · this gun has ${props.room}`;
  }
  return props.plan ? planLine(props.plan) : "";
});
</script>

<template>
  <div
    class="group relative flex flex-col overflow-hidden rounded-md border border-border bg-background transition-colors"
    :class="fits ? 'hover:border-[color:var(--acc)]' : ''"
  >
    <!-- The picture is the way into 3D. flex-none: in a full shelf it held
         its height and the shelf scrolled, rather than squashing every
         picture to a strip. -->
    <button
      class="relative aspect-[2/1] w-full flex-none overflow-hidden bg-[#183a31]"
      :aria-label="'Look at ' + craft.name + ' in 3D'"
      @click="emit('preview')"
    >
      <img
        v-if="craft.preview"
        :src="craft.preview"
        alt=""
        class="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
        :class="fits ? '' : 'opacity-60 [filter:grayscale(1)]'"
        draggable="false"
      />
      <!-- No picture yet (saved before pictures, and the board not opened
           since): the stickers themselves, in slot order. -->
      <div v-else class="flex h-full flex-wrap items-center justify-center gap-1 p-2" :class="fits ? '' : 'opacity-60 [filter:grayscale(1)]'">
        <img v-for="(s, si) in craft.stickers" :key="si" :src="s.image" alt="" class="h-1/2 max-h-20 object-contain" />
      </div>
      <!-- Always there on a phone: no hover says the picture opens in 3D. -->
      <span
        class="absolute right-1.5 top-1.5 items-center gap-1 rounded border border-border bg-background/90 px-1.5 py-1 text-f10 uppercase tracking-cs1 text-muted-foreground"
        :class="isCompact ? 'flex' : 'hidden group-hover:flex'"
      >
        <Box class="h-3.5 w-3.5" /> 3D
      </span>
    </button>
    <!-- Its proposed use: the gun it is meant for, and (on the chip) where on
         it. Beside the picture's button, not in it — a button can't hold one. -->
    <div v-if="craft.useCase" class="absolute left-1.5 top-1.5 flex max-w-[calc(100%-4.5rem)]">
      <CraftUseCase :use-case="craft.useCase" :author="store ? (store.mine ? 'you' : store.author.name) : 'you'" />
    </div>
    <div class="flex flex-none flex-col gap-1.5 p-2">
      <div class="truncate text-f13 font-semibold text-foreground">{{ craft.name }}</div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-f11 text-muted-foreground">
        <span>{{ n }} {{ n === 1 ? "sticker" : "stickers" }}</span>
        <!-- Not when the caller's own switch below already says so. -->
        <span v-if="published && !$slots.actions" class="flex items-center gap-1 text-foreground"><Globe class="h-3.5 w-3.5" /> In the store</span>
        <span v-if="published && score" class="font-mono">▲ {{ score.ups }} · ▼ {{ score.downs }}</span>
      </div>
      <!-- What is in it: every sticker, named, in slot order — on a phone there
           is no hover to find out, and stacked ones can't be counted. -->
      <div class="flex flex-wrap gap-1">
        <img
          v-for="(s, si) in craft.stickers"
          :key="si"
          :src="s.image"
          :alt="shortName(s.name)"
          class="h-7 w-7 rounded bg-secondary/40 object-contain p-0.5"
          draggable="false"
        />
      </div>
      <div v-if="store" class="flex items-center gap-1.5 text-f11 text-muted-foreground">
        <img v-if="store.author.avatar" :src="store.author.avatar" alt="" class="h-5 w-5 flex-none rounded-full object-cover" />
        <span v-else class="grid h-5 w-5 flex-none place-items-center rounded-full bg-secondary text-f9 uppercase">{{ store.author.name.slice(0, 1) }}</span>
        <span class="min-w-0 truncate" :class="store.mine ? 'text-foreground' : ''">{{ store.mine ? "You" : store.author.name }}</span>
        <span class="ml-auto flex flex-none items-center gap-0.5 font-mono">
          <button
            class="flex items-center gap-0.5 rounded px-1 transition-colors disabled:opacity-50"
            :class="[store.myVote === 1 ? 'text-success' : 'hover:text-foreground', isCompact ? 'h-9' : 'h-7']"
            :disabled="store.mine"
            :aria-label="store.mine ? 'Your craft' : store.myVote === 1 ? 'Take your upvote back' : 'Upvote'"
            @click="emit('vote', 1)"
          ><ArrowBigUp class="h-4 w-4" />{{ store.ups }}</button>
          <button
            class="flex items-center gap-0.5 rounded px-1 transition-colors disabled:opacity-50"
            :class="[store.myVote === -1 ? 'text-destructive' : 'hover:text-foreground', isCompact ? 'h-9' : 'h-7']"
            :disabled="store.mine"
            :aria-label="store.mine ? 'Your craft' : store.myVote === -1 ? 'Take your downvote back' : 'Downvote'"
            @click="emit('vote', -1)"
          ><ArrowBigDown class="h-4 w-4" />{{ store.downs }}</button>
        </span>
      </div>
      <!-- The caller's own actions for this craft (the Sticker Crafts tab: in
           the store or not, delete). -->
      <div v-if="$slots.actions" class="flex items-center gap-1.5">
        <slot name="actions" />
      </div>
      <!-- Where Use puts it, said before Use; and Use. -->
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 text-f11 leading-snug" :class="fits ? 'text-muted-foreground' : 'text-destructive'">{{ where }}</span>
        <button
          class="tac-action flex flex-none items-center rounded-md border border-border px-3 text-f11 uppercase tracking-cs1 text-foreground disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-60"
          :class="isCompact ? 'h-9' : 'h-8'"
          :disabled="!fits"
          @click="emit('use')"
        >{{ fits ? (target === "mat" ? "Place" : "Use") : "Doesn't fit" }}</button>
      </div>
    </div>
  </div>
</template>
