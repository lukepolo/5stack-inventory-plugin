<script setup lang="ts">
// A pet's controls in the craft panel: its coat, its life stage, and what it is
// doing on the stage.
//
// COAT is a row of swatches, not a "Style 1..13" list, because a number says
// nothing about a chicken. Each swatch is that style's own colour map reduced to
// its four dominant colours at extraction (pet-styles.json `palette`), and its
// name is the one Valve gave the material — `chicken_catalan_blue` is "Blue".
// Hovering one dresses the bird on the stage without committing it, the way the
// pattern rail previews a seed: you choose by looking at the chicken, not at a
// label.
//
// STAGE is the life track, egg to hen. All four stops are drawn because the
// track IS the explanation of what a stage is; the ones this pet cannot be are
// there but not pressable.
//
// ANIMATION is a viewing choice, not an item attribute — it is never saved with
// the pet and never reaches the game. The clips are the game's own (see
// petAnim.ts), grouped by what the bird is doing: a tab per group, then every
// clip of it in a grid — nothing scrolls (a strip that did was the complaint).
// Under it a stepper walks every clip in order (← → too, with the block
// focused), and WANDER hands the choosing to the bird: idles and tricks at
// random, one after another, the way it potters about in game.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Shuffle } from "lucide-vue-next";
import PillTabs from "./PillTabs.vue";
import { groupPetClips, loadPetClipIndex, petWanderPool, type PetClipGroup, type PetClipInfo } from "../petAnim";
import { petSeedTable, petStyleOptions, type PetStyleOption } from "../petMaterial";
import { petPoseWeights, petTraitTable, type PetSeedTable } from "../petPattern";
import TraitBars, { type TraitRow } from "./TraitBars.vue";
import { PET_STAGE_NAMES, PET_TRAIT_NAMES, petPresetKey } from "../pets";

const props = defineProps<{
  /** The pet's model key, e.g. `models/chicken/chicken`. */
  model: string;
  /** The style (material group) chosen; null is the stock coat. */
  coat: number | null;
  /** Stages this pet can be set to; one entry means there is no choice. */
  stages: number[];
  stage: number | null;
  defaultStage: number | null;
  /** The clip on the stage, or null when the stage is not in 3D. */
  clip: string | null;
  /** The pet's pattern — read here only to show what it does. */
  seed: number;
  /** Whether Wander is choosing the clips. */
  wander: boolean;
  /** How far through the playing clip, 0..1 — polled for the stepper's bar. */
  progress?: (() => number | null) | null;
}>();
const emit = defineEmits<{
  "update:coat": [number | null];
  "update:stage": [number];
  "update:clip": [string];
  /** A pattern found by dragging a trait — see the TRAITS block. */
  "update:seed": [number];
  /** Wander on (the clips it may choose from) or off (null). */
  wander: [string[] | null];
  /** A coat to SHOW without committing it; undefined puts the chosen one back. */
  previewStyle: [number | null | undefined];
}>();

const styles = ref<PetStyleOption[]>([]);
const clipIndex = ref<PetClipInfo[]>([]);
const seedTable = ref<PetSeedTable | null>(null);
async function load() {
  const model = props.model;
  const [opts, index, table] = await Promise.all([petStyleOptions(model), loadPetClipIndex(), petSeedTable(model)]);
  if (model !== props.model) return;
  styles.value = opts;
  clipIndex.value = index;
  seedTable.value = table;
}
onMounted(load);
watch(() => props.model, load);

const current = computed(() => styles.value.find((s) => s.style === props.coat) ?? styles.value[0] ?? null);
const hovered = ref<PetStyleOption | null>(null);
const shown = computed(() => hovered.value ?? current.value);

/**
 * The palette as a soft swirl: each colour centred on the share of the coat it
 * covers and blended into its neighbours, closing back on the heaviest. Hard
 * stops read as a pie chart; a coat is not one.
 */
function swatchFill(o: PetStyleOption) {
  if (!o.palette.length) return "hsl(var(--muted))";
  let at = 0;
  const stops = o.palette.map(({ c, w }) => {
    const mid = at + (w * 100) / 2;
    at += w * 100;
    return `${c} ${mid.toFixed(1)}%`;
  });
  const first = o.palette[0].c;
  return `conic-gradient(from 200deg, ${first} 0%, ${stops.join(", ")}, ${first} 100%)`;
}
function enter(o: PetStyleOption) {
  hovered.value = o;
  emit("previewStyle", o.style);
}
function leave() {
  hovered.value = null;
  emit("previewStyle", undefined);
}

const ALL_STAGES = [0, 1, 2, 3];
const stageNow = computed(() => props.stage ?? props.defaultStage);
const canStage = computed(() => props.stages.length > 1);

/**
 * What the pattern does to the body, drawn — the same draws the viewer shapes
 * the bird by (petPattern.ts), so the bars and the chicken cannot disagree.
 * 0.5 is the average bird; a bar runs from the middle toward the min or max
 * pose. Only the grown breeds vary: the chick's generator is off in game.
 */
const preset = computed(() => {
  const key = petPresetKey(stageNow.value);
  return key ? seedTable.value?.presets?.[key] ?? null : null;
});
const weights = computed(() => (preset.value && props.seed ? petPoseWeights(props.seed, preset.value) : null));
const traits = computed<TraitRow[]>(() => {
  const w = weights.value;
  if (!w) return [];
  return Object.entries(PET_TRAIT_NAMES)
    .filter(([k]) => w[k] !== undefined)
    .map(([k, label]) => ({ key: k, label, value: w[k], display: String(Math.round(w[k] * 100)) }));
});
/** What a trait drag searches — see TraitBars and traitSearch. */
const petTable = () => (preset.value ? petTraitTable(preset.value) : null);
// The table is ~80ms to build: build it while nobody is looking, not on the
// first press.
watch(
  preset,
  (p) => {
    if (!p) return;
    const build = () => petTraitTable(p);
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(build);
    else setTimeout(build, 200);
  },
  { immediate: true },
);

const groups = computed<PetClipGroup[]>(() => (props.clip == null ? [] : groupPetClips(clipIndex.value, props.model)));
const clipNow = computed(() => {
  for (const g of groups.value) {
    const c = g.clips.find((x) => x.name === props.clip);
    if (c) return { group: g.key, groupLabel: g.label, ...c };
  }
  return null;
});
/** The tab: the one picked, else the playing clip's own, else the first. */
const tabPicked = ref<string | null>(null);
const tab = computed(() => tabPicked.value ?? clipNow.value?.group ?? groups.value[0]?.key ?? "");
const tabGroup = computed(() => groups.value.find((g) => g.key === tab.value) ?? null);
/** Numbered groups pack seven to a row; named ones (Walk, Sleep, Reveal…) need
 *  the width, three to a row. */
const tabNumeric = computed(() => !!tabGroup.value?.clips.every((c) => /^\d+$/.test(c.label)));
// A clip changing — picked, stepped to or Wandered into — brings its own tab
// back, so the grid always shows what is playing.
watch(
  () => props.clip,
  () => (tabPicked.value = null),
);

/** Every clip, in tab order: what the stepper walks. */
const allClips = computed(() => groups.value.flatMap((g) => g.clips.map((c) => c.name)));
function step(d: number) {
  const list = allClips.value;
  if (!list.length) return;
  const i = Math.max(0, list.indexOf(props.clip ?? ""));
  emit("update:clip", list[(i + d + list.length) % list.length]);
}

const wanderPool = computed(() => petWanderPool(clipIndex.value, props.model));
function toggleWander() {
  emit("wander", props.wander ? null : wanderPool.value);
}

// The stepper's bar follows the clip on the stage. Polled per frame rather than
// pushed: the viewer has no reason to know a progress bar exists.
const prog = ref(0);
let raf = 0;
const poll = () => {
  prog.value = props.progress?.() ?? 0;
  raf = requestAnimationFrame(poll);
};
onMounted(() => (raf = requestAnimationFrame(poll)));
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- COAT -->
    <section v-if="styles.length" class="pet-block">
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Coat</span>
        <span class="ml-auto truncate text-f11 text-foreground">
          <span class="font-mono text-f10 text-muted-foreground">{{ shown?.style == null ? "STOCK" : String(shown.style).padStart(2, "0") }}</span>
          <span class="mx-1 text-muted-foreground/50">·</span>{{ shown?.name }}
        </span>
      </header>
      <div class="grid grid-cols-7 gap-1.5" @pointerleave="leave">
        <button
          v-for="(o, i) in styles"
          :key="o.style ?? 'stock'"
          type="button"
          class="pet-swatch"
          :class="{ 'is-on': o.style === props.coat, 'is-stock': o.style == null }"
          :style="{ '--fill': swatchFill(o), '--i': i }"
          :title="o.style == null ? `Stock — ${o.name}` : `Style ${o.style} — ${o.name}`"
          :aria-label="o.style == null ? `Stock coat, ${o.name}` : `Style ${o.style}, ${o.name}`"
          :aria-pressed="o.style === props.coat"
          @pointerenter="enter(o)"
          @focus="enter(o)"
          @blur="leave"
          @click="emit('update:coat', o.style)"
        />
      </div>
    </section>

    <!-- STAGE -->
    <section v-if="canStage" class="pet-block">
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Stage</span>
        <span class="ml-auto text-f11 text-foreground">{{ PET_STAGE_NAMES[stageNow ?? -1] ?? "—" }}</span>
      </header>
      <ol class="pet-track">
        <li v-for="lvl in ALL_STAGES" :key="lvl" class="pet-stop">
          <button
            type="button"
            class="pet-stop-dot"
            :class="{ 'is-on': lvl === stageNow, 'is-past': stageNow != null && lvl < stageNow }"
            :disabled="!props.stages.includes(lvl)"
            :aria-pressed="lvl === stageNow"
            :title="props.stages.includes(lvl) ? PET_STAGE_NAMES[lvl] : `${PET_STAGE_NAMES[lvl]} — not for this pet`"
            @click="emit('update:stage', lvl)"
          />
          <span class="pet-stop-label" :class="{ 'text-foreground': lvl === stageNow }">{{ PET_STAGE_NAMES[lvl] }}</span>
        </li>
      </ol>
    </section>

    <!-- ANIMATION: tabs, a grid of the tab's clips, then the stepper. -->
    <section
      v-if="groups.length"
      class="pet-block pet-anim"
      tabindex="0"
      aria-label="Animation — arrow keys step through clips"
      @keydown.left.prevent="step(-1)"
      @keydown.right.prevent="step(1)"
    >
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Animation</span>
        <span v-if="clipNow" class="ml-auto truncate text-f11 text-foreground">
          {{ /^\d+$/.test(clipNow.label) ? `${clipNow.groupLabel} ${clipNow.label}` : clipNow.label }}
          <span class="ml-1 font-mono text-f10 text-muted-foreground">{{ clipNow.duration.toFixed(1) }}s</span>
        </span>
      </header>
      <PillTabs
        :items="groups"
        :item-key="(g) => g.key"
        :active="tab"
        list-class="flex w-full"
        button-class="relative z-[1] flex h-6 flex-1 items-center justify-center rounded-md px-1 text-f9 uppercase tracking-wider transition-colors"
        @select="(k) => (tabPicked = k)"
      >
        <template #default="{ item }">{{ (item as PetClipGroup).label }}</template>
      </PillTabs>
      <div class="mt-2 grid gap-1" :class="tabNumeric ? 'grid-cols-7' : 'grid-cols-3'">
        <button
          v-for="c in tabGroup?.clips ?? []"
          :key="c.name"
          type="button"
          class="tac-action h-7 min-w-0 truncate rounded border border-border/60 px-1 font-mono text-f10 text-muted-foreground"
          :class="{ 'tac-on': c.name === props.clip }"
          :title="`${tabGroup?.label} ${c.label} — ${c.duration.toFixed(1)}s`"
          @click="emit('update:clip', c.name)"
        >{{ c.label }}</button>
      </div>
      <div class="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          class="tac-action grid h-7 w-7 flex-none place-items-center rounded border border-border/60 text-muted-foreground"
          aria-label="Previous clip"
          @click="step(-1)"
        ><ChevronLeft class="h-3.5 w-3.5" /></button>
        <span class="pet-progress" aria-hidden="true"><span class="pet-progress-fill" :style="{ width: `${prog * 100}%` }" /></span>
        <button
          type="button"
          class="tac-action grid h-7 w-7 flex-none place-items-center rounded border border-border/60 text-muted-foreground"
          aria-label="Next clip"
          @click="step(1)"
        ><ChevronRight class="h-3.5 w-3.5" /></button>
        <button
          type="button"
          class="tac-action flex h-7 flex-none items-center gap-1.5 rounded border border-border/60 px-2.5 text-f9 uppercase tracking-wider text-muted-foreground"
          :class="{ 'tac-on': props.wander }"
          :aria-pressed="props.wander"
          title="Let the pet pick its own idles and tricks"
          @click="toggleWander"
        ><Shuffle class="h-3 w-3" /> Wander</button>
      </div>
      <p v-if="props.wander" class="mt-2 text-f10 leading-snug text-muted-foreground">
        Wandering — idles and tricks at random, as it does in game. Pick a clip to stop.
      </p>
    </section>
    <!-- TRAITS: the body the pattern draws — and, dragged, the way to choose
         one. See TraitBars for what a drag really does. Last in the block,
         so it sits right over the Pattern field it drives. -->
    <section v-if="traits.length" class="pet-block">
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Traits</span>
        <span class="ml-auto text-f10 text-muted-foreground/70">drag to shape</span>
        <span class="font-mono text-f10 text-muted-foreground">#{{ props.seed }}</span>
      </header>
      <!-- One trait per row, full width: twice the travel of the old two-column
           grid, which is what makes a drag land where you mean it. -->
      <TraitBars :traits="traits" :table="petTable" :seed="props.seed" centered @seek="(s) => emit('update:seed', s)" />
    </section>

  </div>
</template>

<style scoped>
/* The block takes focus for ← →; show it only for keyboard focus. */
.pet-anim {
  outline: none;
}
.pet-anim:focus-visible {
  box-shadow: 0 0 0 1px hsl(var(--tac-amber, 33 94% 58%) / 0.6);
}
/* The playing clip's progress — per-frame, so no transition to lag behind. */
.pet-progress {
  position: relative;
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 9999px;
  background: hsl(var(--border));
}
.pet-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 9999px;
  background: hsl(var(--tac-amber, 33 94% 58%));
}
.pet-block {
  border-radius: 0.375rem;
  background: hsl(var(--secondary) / 0.4);
  padding: 0.625rem;
}

/* A swatch reads as a FEATHER BALL, not a flat chip: the palette pie under a
   soft top-left light and a rim shadow, so a dozen of them in a row look like
   coats rather than a paint-mixing chart. */
.pet-swatch {
  position: relative;
  aspect-ratio: 1;
  border-radius: 9999px;
  background:
    radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.32), transparent 52%),
    radial-gradient(circle at 50% 60%, transparent 55%, rgb(0 0 0 / 0.35) 100%),
    /* barbs: a fine radial hatch, so the colour reads as plumage */
    repeating-conic-gradient(from 0deg, rgb(0 0 0 / 0.07) 0deg 2deg, transparent 2deg 7deg),
    var(--fill);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 1px 2px rgb(0 0 0 / 0.4);
  transition:
    transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 160ms ease;
  animation: pet-pop 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(var(--i) * 18ms);
}
.pet-swatch:hover,
.pet-swatch:focus-visible {
  transform: scale(1.12);
  outline: none;
}
.pet-swatch.is-on {
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.12),
    0 0 0 2px hsl(var(--card)),
    0 0 0 3.5px hsl(var(--tac-amber, 33 94% 58%)),
    0 0 14px hsl(var(--tac-amber, 33 94% 58%) / 0.35);
}
/* The stock coat is the one with nothing set — marked, so "stock" and the
   numbered style that happens to repeat it are not mistaken for one choice. */
.pet-swatch.is-stock::after {
  content: "";
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: hsl(var(--foreground) / 0.8);
  box-shadow: 0 0 0 2px hsl(var(--card));
}
@keyframes pet-pop {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
}

/* The life track: four stops on a rule, the passed part of it lit. */
.pet-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.pet-track::before {
  content: "";
  position: absolute;
  top: 6px;
  left: 12.5%;
  right: 12.5%;
  height: 1px;
  background: hsl(var(--border));
}
.pet-stop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
}
.pet-stop-dot {
  position: relative;
  width: 13px;
  height: 13px;
  border-radius: 9999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  transition:
    transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 160ms ease,
    border-color 160ms ease;
}
.pet-stop-dot:not(:disabled):hover {
  transform: scale(1.2);
  border-color: hsl(var(--tac-amber, 33 94% 58%));
}
.pet-stop-dot:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pet-stop-dot.is-past {
  background: hsl(var(--tac-amber, 33 94% 58%) / 0.35);
  border-color: hsl(var(--tac-amber, 33 94% 58%) / 0.5);
}
.pet-stop-dot.is-on {
  background: hsl(var(--tac-amber, 33 94% 58%));
  border-color: hsl(var(--tac-amber, 33 94% 58%));
  box-shadow: 0 0 10px hsl(var(--tac-amber, 33 94% 58%) / 0.5);
}
.pet-stop-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}

@media (prefers-reduced-motion: reduce) {
  .pet-swatch {
    animation: none;
  }
}
</style>
