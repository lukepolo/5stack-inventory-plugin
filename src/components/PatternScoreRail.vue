<script setup lang="ts">
// A weapon's pattern space, ranked.
//
// The charm rail can paint its whole space because a charm's pattern IS a
// colour and we can compute it. A weapon's cannot: the pattern moves artwork
// around, and the only way to know what a pattern looks like is to composite
// it. So this rail plots the next best thing — a MEASUREMENT of every pattern,
// swept once and drawn as a curve you can read.
//
// Peaks are the answer to the question people actually have. On a case-hardened
// finish the pattern indexes a colour ramp, so "how blue did this one land" is
// a real number, and the tall peaks are the patterns the community pays for —
// except computed from Valve's shader instead of copied off a spreadsheet.
//
// HONEST ABOUT WHAT IT MEASURES: the composited albedo is a UV atlas, not the
// playside, so these are not the community's percentages and are never labelled
// as a tier. The ranking is what transfers — more blue in the atlas is more
// blue on the gun — and finding the blue ones is the whole job.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { loadPaintDef } from "../paintComposite";
import {
  cachedScan,
  comparePatterns,
  metricsFor,
  scanPatterns,
  type PatternMetric,
  type PatternScan,
} from "../patternScan";

const props = withDefaults(
  defineProps<{
    modelValue?: number | null;
    paintMaterial?: string | null;
    model?: string | null;
    legacyPaint?: boolean;
    /**
     * Per-texel importance from the mounted model — see paintUvWeights. Turns a
     * measurement of the UV atlas into a measurement of the GUN.
     *
     * A getter rather than the array, pulled only when a scan starts: building
     * it rasterises every triangle, and a rail that is never scanned should
     * never pay for it. Null means no model is mounted, which is also the
     * signal that a scan would have to fall back to the flat atlas.
     */
    weightsFor?: (() => Float32Array | null) | null;
    min?: number;
    max?: number;
  }>(),
  { modelValue: null, paintMaterial: null, model: null, legacyPaint: false, weightsFor: null, min: 1, max: 1000 },
);

const emit = defineEmits<{
  "update:modelValue": [value: number];
  /**
   * Show this pattern on the viewer WITHOUT committing it; null restores.
   *
   * Separate from update:modelValue because previewing must not dirty the item.
   * Hovering a peak to see it, or blinking between two, would otherwise leave
   * the craft form edited by a gesture that was only ever a look.
   */
  preview: [seed: number | null];
}>();

const RAIL_H = 40;

const canvas = ref<HTMLCanvasElement | null>(null);
const metrics = shallowRef<PatternMetric[]>([]);
const metric = ref<string | null>(null);
const scan = shallowRef<PatternScan | null>(null);
const progress = ref(0);
const scanning = ref(false);
const hover = ref<number | null>(null);
const dragging = ref(false);
const editing = ref(false);
const draft = ref("");
const editEl = ref<HTMLInputElement | null>(null);

const seed = computed(() =>
  Math.min(props.max, Math.max(props.min, Math.round(props.modelValue ?? props.min))),
);
const cursor = computed(() => (seed.value - props.min) / Math.max(1, props.max - props.min));
const hoverSeed = computed(() =>
  hover.value == null ? null : Math.round(props.min + hover.value * (props.max - props.min)),
);
/** The measured fraction at one pattern, as a percentage for display. */
function scoreAt(s: number): number | null {
  const sc = scan.value;
  if (!sc) return null;
  const v = sc.scores[s - sc.min];
  return v == null ? null : Math.round(v * 100);
}
const current = computed(() => scoreAt(seed.value));

/** Identity of the thing being scanned — everything the sweep depends on. */
const target = computed(() =>
  props.paintMaterial && props.model
    ? { paintMaterial: props.paintMaterial, model: props.model, legacy: !!props.legacyPaint }
    : null,
);
/** Whether a scan can be weighted by the gun rather than by its unwrap. */
const canWeight = computed(() => !!props.weightsFor);

let runId = 0;
async function runScan() {
  const t = target.value;
  const m = metric.value;
  if (!t || !m || scanning.value) return;
  const id = ++runId;
  scanning.value = true;
  progress.value = 0;
  try {
    const out = await scanPatterns({
      ...t,
      // Pulled HERE, at the one moment it is worth building.
      weights: props.weightsFor?.() ?? null,
      metric: m,
      min: props.min,
      max: props.max,
      onProgress: (f) => {
        if (id === runId) progress.value = f;
      },
      stillWanted: () => id === runId,
    });
    if (id !== runId) return;
    scan.value = out;
    void nextTick(draw);
  } finally {
    if (id === runId) scanning.value = false;
  }
}

/**
 * Draw the sweep as a filled curve.
 *
 * Normalised to the sweep's own peak rather than to 1.0. An absolute scale
 * flattens every finish whose best pattern only reaches a fifth of the frame
 * into a straight line along the bottom — which is most of them, and which
 * destroys exactly the structure the rail exists to show. What matters is where
 * THIS finish's good patterns are relative to its own bad ones.
 */
function draw() {
  const cv = canvas.value;
  const sc = scan.value;
  if (!cv || !sc) return;
  const w = Math.max(1, Math.round(cv.clientWidth));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(RAIL_H * dpr);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const h = cv.height;
  const peak = sc.peak || 1;
  const n = sc.scores.length;
  const accent = getComputedStyle(cv).getPropertyValue("--acc").trim() || "#f5a524";

  // One column per pixel, taking the MAX of the patterns that fall in it. A
  // mean would average a lone standout away, and a lone standout is the entire
  // point of looking.
  const col = new Float32Array(w);
  for (let i = 0; i < n; i++) {
    const x = Math.min(w - 1, Math.floor((i / Math.max(1, n - 1)) * (w - 1)));
    if (sc.scores[i] > col[x]) col[x] = sc.scores[i];
  }

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x < w; x++) ctx.lineTo(x * dpr, h - (col[x] / peak) * h * 0.92);
  ctx.lineTo(w * dpr, h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h - (col[x] / peak) * h * 0.92;
    if (x === 0) ctx.moveTo(0, y);
    else ctx.lineTo(x * dpr, y);
  }
  ctx.stroke();
}

function fracAt(ev: PointerEvent, el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (ev.clientX - box.left) / Math.max(1, box.width)));
}
function commit(ev: PointerEvent, el: HTMLElement) {
  emit("update:modelValue", Math.round(props.min + fracAt(ev, el) * (props.max - props.min)));
}
function onDown(ev: PointerEvent) {
  dragging.value = true;
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  commit(ev, ev.currentTarget as HTMLElement);
}
function onMove(ev: PointerEvent) {
  hover.value = fracAt(ev, ev.currentTarget as HTMLElement);
  if (dragging.value) return commit(ev, ev.currentTarget as HTMLElement);
  // HOVER PREVIEWS on the gun. The rail can show you where the good patterns
  // are but not what they look like, and the round trip of clicking one, judging
  // it, then clicking back is what makes a curve feel like homework. Previewing
  // is viewer-only, so sweeping the peaks costs nothing but composites — which
  // coalesce, and run at proxy resolution.
  if (!blinking.value && hoverSeed.value != null) emit("preview", hoverSeed.value);
}
function onLeave() {
  hover.value = null;
  if (!blinking.value) emit("preview", null);
}
function onUp(ev: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
}
function onKey(ev: KeyboardEvent) {
  const dir = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  ev.preventDefault();
  emit(
    "update:modelValue",
    Math.min(props.max, Math.max(props.min, seed.value + dir * (ev.shiftKey ? 10 : 1))),
  );
}

function beginEdit() {
  draft.value = String(seed.value);
  editing.value = true;
  void nextTick(() => editEl.value?.select());
}
function commitEdit() {
  if (!editing.value) return;
  editing.value = false;
  const v = Math.round(Number(draft.value));
  if (Number.isFinite(v)) emit("update:modelValue", Math.min(props.max, Math.max(props.min, v)));
}
function roll() {
  emit("update:modelValue", props.min + Math.floor(Math.random() * (props.max - props.min + 1)));
}

/**
 * Compare: pin one pattern, then flip between it and the current one.
 *
 * A blink comparator, which is the astronomers' trick and is not a gimmick —
 * the eye is enormously better at catching a change that FLICKERS than at
 * holding two stills side by side and hunting for the difference. On a finish
 * that only shifts slightly between patterns, side-by-side tells you nothing
 * and a blink tells you instantly.
 *
 * Nearly free, too: two composites sit in the renderer's LRU, so the alternation
 * after the first pass is a texture swap.
 */
const pinned = ref<number | null>(null);
const blinking = ref(false);
const blinkOnPinned = ref(false);
const diff = ref<number | null>(null);
let blinkTimer: ReturnType<typeof setInterval> | undefined;

const pinnedCursor = computed(() =>
  pinned.value == null ? null : (pinned.value - props.min) / Math.max(1, props.max - props.min),
);

function togglePin() {
  if (pinned.value != null) {
    stopBlink();
    pinned.value = null;
    diff.value = null;
    return;
  }
  pinned.value = seed.value;
  diff.value = null;
}

function stopBlink() {
  blinking.value = false;
  clearInterval(blinkTimer);
  blinkTimer = undefined;
  blinkOnPinned.value = false;
  emit("preview", null);
}

function toggleBlink() {
  if (blinking.value) return stopBlink();
  if (pinned.value == null || pinned.value === seed.value) return;
  blinking.value = true;
  // Slow enough to register each state as a picture, fast enough that the two
  // are held in visual memory together — which is the whole mechanism.
  blinkTimer = setInterval(() => {
    blinkOnPinned.value = !blinkOnPinned.value;
    emit("preview", blinkOnPinned.value ? pinned.value : seed.value);
  }, 620);
}

/**
 * Measure the pinned pattern against the current one.
 *
 * Held off WHILE DRAGGING. Each measurement is two composites and two
 * readbacks, and running one per tick of a scrub would spend the whole drag
 * measuring pairs the pointer has already left behind — the answer is only
 * wanted once the gesture picks something.
 */
let diffId = 0;
watch([pinned, seed, dragging, () => target.value], async () => {
  const t = target.value;
  const p = pinned.value;
  diff.value = null;
  // Comparing a pattern with itself is not a comparison; the UI hides the whole
  // block in that case, and a running blink has nothing left to alternate.
  if (p != null && p === seed.value && blinking.value) stopBlink();
  if (!t || p == null || p === seed.value || dragging.value) return;
  const id = ++diffId;
  const d = await comparePatterns(
    { ...t, weights: props.weightsFor?.() ?? null, min: props.min, max: props.max },
    p,
    seed.value,
  );
  if (id === diffId) diff.value = d;
});

let ro: ResizeObserver | null = null;
watch(canvas, (el) => {
  ro?.disconnect();
  ro = null;
  if (!el) return;
  ro = new ResizeObserver(() => draw());
  ro.observe(el);
});
onBeforeUnmount(() => {
  runId++; // abandon any sweep in flight
  clearInterval(blinkTimer);
  ro?.disconnect();
  // A preview left standing would strand the viewer on a pattern the item does
  // not have — and this component going away is exactly when nobody is watching.
  emit("preview", null);
});

/** Pick a hunt and run it. Cache hits come back instantly, so switching between
 *  two already-measured hunts costs nothing and needs no separate path. */
function findWith(key: string) {
  if (scanning.value) return;
  metric.value = key;
  void runScan();
}

watch(
  () => [props.paintMaterial, props.model, props.legacyPaint, props.weightsFor] as const,
  async () => {
    runId++;
    scanning.value = false;
    scan.value = null;
    metrics.value = [];
    metric.value = null;
    const t = target.value;
    if (!t) return;
    const def = await loadPaintDef(t.paintMaterial);
    if (!def || target.value?.paintMaterial !== t.paintMaterial) return;
    metrics.value = metricsFor(def);
    // No metric is chosen up front. Nothing is measured until asked, so the
    // rail opens as what it is — a scrub bar — rather than as a chart with an
    // empty chart in it.
    metric.value = null;
    pinned.value = null;
    diff.value = null;
  },
  { immediate: true },
);
</script>

<template>
  <!-- No panel chrome: the host row already draws the card. See PatternRail. -->
  <div>
    <div class="mb-2 flex items-center gap-2">
      <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>

      <input
        v-if="editing"
        ref="editEl"
        v-model="draft"
        type="number"
        :min="min"
        :max="max"
        class="h-6 w-20 rounded border border-[color:var(--acc)] bg-background px-1.5 font-mono text-f11 tabular-nums outline-none"
        @blur="commitEdit"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="editing = false"
      />
      <button
        v-else
        class="rounded px-1 font-mono text-f13 tabular-nums text-foreground/90 transition-colors hover:bg-white/5 hover:text-[color:var(--acc)]"
        title="Type an exact pattern"
        @click="beginEdit"
      >#{{ seed }}</button>

      <!-- The measurement at the pattern you are on, next to the pattern. Only
           once a sweep exists — a percentage with nothing behind it would be
           the spreadsheet problem all over again. -->
      <span
        v-if="scan && current != null"
        class="rounded-sm bg-[color:var(--acc)]/15 px-1 font-mono text-f8 tabular-nums text-[color:var(--acc)]"
        :title="`${scan.label}: measured over this finish's composited artwork`"
      >{{ current }}% {{ scan.label }}</span>

      <!-- The die is the only thing that earns a place beside the number. Every
           other tool moved to the sentence under the rail: a row of equal-weight
           buttons made scrubbing — the thing that works — compete for attention
           with analysis nobody asked for yet. -->
      <button
        class="ml-auto rounded border border-input px-1.5 py-0.5 text-f11 leading-none transition-colors hover:border-[color:var(--acc)] hover:bg-white/5"
        :title="`Random pattern between ${min} and ${max}`"
        @click="roll"
      >🎲</button>
    </div>

    <!-- How different the two actually are, as a fact rather than an
         impression. On some finishes neighbouring patterns are visually the
         same thing and this is what says so. -->
    <div
      v-if="pinned != null && pinned !== seed"
      class="mb-1.5 flex items-center gap-2 rounded-sm bg-black/25 px-2 py-1 font-mono text-f8 tabular-nums text-muted-foreground"
    >
      <span class="uppercase tracking-cs1">#{{ pinned }} vs #{{ seed }}</span>
      <span v-if="diff == null" class="text-muted-foreground/50">measuring…</span>
      <span v-else-if="diff < 0.01" class="text-muted-foreground/70">
        {{ (diff * 100).toFixed(1) }}% different — all but identical
      </span>
      <span v-else class="text-[color:var(--acc)]">{{ (diff * 100).toFixed(1) }}% different</span>
      <!-- The blink lives HERE, next to the two patterns it alternates, rather
           than up in the header — it only exists once there is a pair, and it
           is meaningless read apart from them. -->
      <button
        class="ml-auto rounded px-1 uppercase tracking-cs1 transition-colors"
        :class="
          blinking
            ? 'bg-[color:var(--acc)]/20 text-[color:var(--acc)]'
            : 'text-muted-foreground hover:text-foreground'
        "
        title="Flip between the two on the model — the eye catches a change that blinks"
        @click="toggleBlink"
      >{{ blinking ? `showing ${blinkOnPinned ? "A" : "B"} — stop` : "Flip between them" }}</button>
    </div>

    <div
      class="relative touch-none select-none overflow-hidden rounded-sm outline-none"
      :style="{ height: RAIL_H + 'px', cursor: 'ew-resize' }"
      tabindex="0"
      role="slider"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="seed"
      aria-label="Weapon pattern"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onLeave"
      @keydown="onKey"
    >
      <span
        class="absolute inset-0"
        style="
          background:
            repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.14) 0 1px, transparent 1px 10%),
            rgba(0, 0, 0, 0.42);
        "
      ></span>
      <canvas ref="canvas" class="relative block h-full w-full" :style="{ height: RAIL_H + 'px' }"></canvas>

      <!-- Before a sweep the rail is still a slider — it just has nothing to
           plot yet. The invitation sits ON it rather than beside it, because
           the thing you get is this strip filling with the answer. -->
      <div
        v-if="scanning"
        class="absolute inset-0 grid place-items-center bg-black/45 font-mono text-f8 tabular-nums uppercase tracking-cs1 text-muted-foreground"
      >
        <span>Measuring… {{ Math.round(progress * 100) }}%</span>
        <span
          class="absolute inset-x-0 bottom-0 h-[2px] bg-[color:var(--acc)] transition-[width] duration-150"
          :style="{ width: progress * 100 + '%' }"
        ></span>
      </div>

      <span
        v-if="hover != null && !dragging"
        class="pointer-events-none absolute inset-y-0 w-px bg-white/45"
        :style="{ left: hover * 100 + '%' }"
      ></span>
      <span
        v-if="hoverSeed != null && !dragging"
        class="pointer-events-none absolute top-1 -translate-x-1/2 rounded-sm bg-black/80 px-1 font-mono text-[8px] tabular-nums text-white/90"
        :style="{ left: `clamp(1.8rem, ${hover! * 100}%, calc(100% - 1.8rem))` }"
      >{{ hoverSeed }}<template v-if="scoreAt(hoverSeed) != null"> · {{ scoreAt(hoverSeed) }}%</template></span>

      <!-- The pinned pattern, marked but subordinate: dashed and accent-tinted
           so it never competes with the needle you are actually moving. -->
      <span
        v-if="pinnedCursor != null"
        class="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-[color:var(--acc)]"
        :style="{ left: pinnedCursor * 100 + '%', boxShadow: '0 0 5px color-mix(in srgb, var(--acc) 70%, transparent)' }"
      ></span>
      <span
        v-if="pinnedCursor != null"
        class="pointer-events-none absolute bottom-0.5 -translate-x-1/2 rounded-sm bg-[color:var(--acc)] px-0.5 font-mono text-[7px] font-bold leading-tight text-black"
        :style="{ left: `clamp(0.6rem, ${pinnedCursor * 100}%, calc(100% - 0.6rem))` }"
      >A</span>
      <span
        class="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white"
        :style="{
          left: cursor * 100 + '%',
          boxShadow: '0 0 6px rgba(255,255,255,0.55), 0 1px 3px rgba(0,0,0,0.8)',
          transition: dragging ? 'none' : 'left 220ms cubic-bezier(0.22,1,0.36,1)',
        }"
      ></span>
      <span
        class="pointer-events-none absolute inset-0 rounded-sm"
        style="box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 3px rgba(0, 0, 0, 0.6)"
      ></span>
    </div>

    <div class="mt-1 flex items-baseline gap-2 font-mono text-f8 tabular-nums text-muted-foreground/60">
      <span>{{ min }}</span>
      <!-- The peaks, as buttons. Reading a curve tells you where to look; these
           are for when you just want the best one. -->
      <span v-if="scan" class="mx-auto flex items-center gap-1">
        <span class="uppercase tracking-cs1">Top</span>
        <button
          v-for="s in scan.top"
          :key="s"
          class="rounded px-1 tabular-nums transition-colors hover:bg-white/10"
          :class="s === seed ? 'bg-[color:var(--acc)]/20 text-[color:var(--acc)]' : 'text-foreground/80'"
          :title="`${scoreAt(s)}% ${scan.label}`"
          @mouseenter="emit('preview', s)"
          @mouseleave="emit('preview', null)"
          @click="emit('update:modelValue', s)"
        >#{{ s }}</button>
      </span>
      <span class="ml-auto">{{ max }}</span>
    </div>

    <!-- The tools, written as a sentence rather than stacked as a toolbar.
         "Find the bluest" says what you get; BLUE next to GOLD next to COLOUR
         said nothing — it read as a filter, or a paint choice, or three states
         of something unnamed. Text links rather than boxes, so the rail above
         stays the loudest thing here. -->
    <!-- Always present. Comparing two patterns is useful on every finish, and
         it shared a gate with the hunts once — which quietly removed it from
         every skin that has nothing to hunt for. -->
    <div class="mt-1.5 flex items-center gap-2 text-f8">
      <template v-if="metrics.length">
        <span class="uppercase tracking-cs1 text-muted-foreground/50">Find</span>
        <button
          v-for="(m, i) in metrics"
          :key="m.key"
          class="transition-colors"
          :class="[
            metric === m.key && scan ? 'text-[color:var(--acc)]' : 'text-muted-foreground hover:text-foreground',
            i ? 'border-l border-border/60 pl-2' : '',
          ]"
          :disabled="scanning"
          :title="
            canWeight
              ? `Composite all ${max - min + 1} patterns once and rank them by ${m.label} — a few seconds, measured on the gun`
              : `Composite all ${max - min + 1} patterns once and rank them by ${m.label}. Open the 3D view first and it can weight the answer by what you actually see.`
          "
          @click="findWith(m.key)"
        >{{ m.hunt }}</button>
      </template>
      <button
        class="ml-auto transition-colors"
        :class="pinned != null ? 'text-[color:var(--acc)]' : 'text-muted-foreground hover:text-foreground'"
        :title="
          pinned != null
            ? `Comparing against #${pinned} — click to stop`
            : 'Hold this pattern, then move to another to see how they differ'
        "
        @click="togglePin"
      >{{ pinned != null ? "Stop comparing" : "Compare with another" }}</button>
    </div>
  </div>
</template>
