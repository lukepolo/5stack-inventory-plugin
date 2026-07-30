<script setup lang="ts">
// A charm's whole pattern space, drawn.
//
// Before this, finding a pattern meant typing a number or hitting the die and
// waiting for a render — a hundred thousand of them, one blind guess at a time.
// The thing that makes browsing possible is that a charm's pattern does not
// need rendering to be known: `$KeychainSeed` feeds a handful of shader params
// through decoded Source 2 expressions, and we already evaluate those on the
// CPU (see evalVfx). So the colour at every pattern is computable, exactly,
// with no GL context and no model.
//
// That turns "press random until something looks good" into a map you read, and
// it is why this component replaces the number field rather than sitting under
// it: a coordinate is only worth typing once you know where you are going. The
// readout is still click-to-edit, because a pattern is a tradeable attribute and
// someone quoting one from a trade site should not have to hunt for it.
//
// WHAT THE RAIL IS NOT: a render. It grades the charm's authored albedo, which
// is what the shader grades, but the viewer lights that afterwards — so expect
// the rail to read flatter than the charm. It is a map for finding the band; the
// 3D charm beside it is the truth.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { API_ORIGIN } from "../api";
import {
  charmAdjustSrgb,
  charmColorTextureUrl,
  charmSeedAdjust,
  charmMaterialName,
  seedDrivenShading,
  type CharmShading,
} from "../charmMaterial";

const props = withDefaults(
  defineProps<{
    modelValue?: number | null;
    /** Catalog image — the key /api/catalog/charm-model resolves a charm by. */
    image?: string | null;
    /**
     * The charm's albedo sampled off the MOUNTED model, for the ~72% of charms
     * that keep their textures inside the GLB and so have no material to fetch.
     * See ViewerHandle.charmAlbedoTile.
     */
    albedo?: { data: Uint8ClampedArray; size: number; material: string | null } | null;
    min?: number;
    max?: number;
    /** Chunk width. 1000 over a 100000 space is 100 bands, which is as many
     *  ticks as a rail this size can show without becoming a hatch pattern. */
    chunk?: number;
  }>(),
  { modelValue: null, image: null, albedo: null, min: 1, max: 100000, chunk: 1000 },
);

const emit = defineEmits<{
  "update:modelValue": [value: number];
  /**
   * True once this charm is known to look the same at every pattern.
   *
   * Reported outward because the ROW this sits in belongs to the caller, and an
   * inert charm should take the whole row with it. A Pattern heading over a
   * control that cannot change anything is worse than no heading — and saying
   * so in a sentence beside it was still an explanation nobody needed.
   */
  "update:inert": [inert: boolean];
}>();

/** `?patternlog=1` — which material the rail resolved, how, and what it grades
 *  to. The one question worth asking when a band comes out the wrong colour:
 *  matching the wrong entry and matching none look identical on screen. */
const PATTERN_LOG = typeof location !== "undefined" && /[?&]patternlog=1/.test(location.search);

const RAIL_H = 40;
/** Downsample width/height of the albedo sample. 16x16 is 256 pixels — enough
 *  that a two-tone charm keeps both tones in the average, small enough that
 *  grading it once per rail column stays a few milliseconds. */
const TILE = 16;

type Spec = { model?: string; material?: string } | null;

const canvas = ref<HTMLCanvasElement | null>(null);
const editEl = ref<HTMLInputElement | null>(null);
const tune = shallowRef<CharmShading | null>(null);
const tile = shallowRef<Uint8ClampedArray | null>(null);
/** The econ lookup's answer, kept so resolve() can re-run against it. */
const econ = shallowRef<{ shading: Record<string, CharmShading>; spec: Spec } | null>(null);
/** The albedo fetched from a community charm's own material, if it had one. */
const fetched = shallowRef<Uint8ClampedArray | null>(null);
const state = ref<"loading" | "ready" | "inert" | "unavailable">("loading");
/** The 1k band the rail is zoomed into, or null for the whole space. */
const zoom = ref<{ lo: number; hi: number } | null>(null);
const editing = ref(false);
const draft = ref("");
/** Pointer position over the rail, 0..1 — drives the ghost needle. */
const hover = ref<number | null>(null);
const dragging = ref(false);

const lo = computed(() => zoom.value?.lo ?? props.min);
const hi = computed(() => zoom.value?.hi ?? props.max);
const seed = computed(() => Math.min(props.max, Math.max(props.min, Math.round(props.modelValue ?? props.min))));
/** Where the current pattern sits on the rail, 0..1. Off-scale while zoomed
 *  into a band the pattern is not in — clamped, so the marker parks at the edge
 *  it left through rather than vanishing. */
const cursor = computed(() => {
  const span = hi.value - lo.value || 1;
  return Math.min(1, Math.max(0, (seed.value - lo.value) / span));
});
const inBand = computed(() => seed.value >= lo.value && seed.value <= hi.value);
const hoverSeed = computed(() =>
  hover.value == null ? null : Math.round(lo.value + hover.value * (hi.value - lo.value)),
);
const canBrowse = computed(() => state.value === "ready" || state.value === "unavailable");

/** The exact colour at one pattern, as a CSS rgb() — the swatch and the
 *  needle's glow both read from this, so the marker is tinted by the very
 *  thing it points at. */
function colorAt(s: number): string | null {
  const src = tile.value;
  const t = tune.value;
  if (!src || !t) return null;
  const work = new Uint8ClampedArray(src);
  charmAdjustSrgb(work, charmSeedAdjust(t, s));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < work.length; i += 4) {
    if (src[i + 3] < 8) continue;
    r += work[i];
    g += work[i + 1];
    b += work[i + 2];
    n++;
  }
  return n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : null;
}
const swatch = computed(() => colorAt(seed.value));

/**
 * Resolve the charm's shading and the albedo the grade operates on.
 *
 * Two sources for that albedo, in order of independence. A community charm
 * names a `keychain_material` in the econ schema and so has a standalone
 * texture we can fetch with no viewer at all. Every other charm keeps its
 * textures inside its GLB, and the only cheap way at them is the model already
 * mounted next to this control — which is what the `albedo` prop carries.
 */
async function load(image: string) {
  state.value = "loading";
  tune.value = null;
  tile.value = null;
  fetched.value = null;
  const answer = await fetch(`${API_ORIGIN}/api/catalog/charm-model?image=${encodeURIComponent(image)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (props.image !== image) return; // a faster charm won the race
  const shading = (answer as { shading?: Record<string, CharmShading> } | null)?.shading ?? {};
  const spec = (answer as { charm?: Spec } | null)?.charm ?? null;
  // Kept so resolve() can run again when the mounted model reports its material
  // — which lands after this, and is the only authoritative answer.
  econ.value = { shading, spec };
  // Painted from whatever is here now, so a community charm shows its gradient
  // without waiting on a viewer at all; the model's own report re-resolves it
  // through the albedo watcher if and when it lands.
  resolve(image);
  const url = spec?.material ? await charmColorTextureUrl(spec.material) : null;
  if (props.image !== image || !url) return;
  fetched.value = await sampleAlbedo(url);
  if (props.image !== image) return;
  resolve(image);
}

/**
 * Settle on a material and an albedo from whatever sources have arrived.
 *
 * Re-runnable, and it has to be: the econ lookup resolves immediately while the
 * mounted model shows up whenever its GLB finishes, and it is the model that
 * knows which material is really being graded. Resolving once, on whatever was
 * available first, is what left the rail painting a flat gold ramp for a charm
 * the renderer was grading green.
 */
function resolve(image: string) {
  const e = econ.value;
  if (!e || props.image !== image) return;
  const { shading, spec } = e;
  // Which material governs, in order of authority:
  //
  //  1. The one the RENDERER actually tuned, reported by the mounted model.
  //     Only this is guaranteed to agree with what you are looking at.
  //  2. The econ spec's `keychain_material`, for a community charm — exact, and
  //     available with no viewer at all.
  //  3. A name match against the model stem. A guess, and the reason this order
  //     exists: the shading map is keyed by vmat stem, a charm that owns its
  //     model carries its material names only inside the GLB, and guessing
  //     wrong picks an entry with no hue shift in it — which paints the whole
  //     rail one flat colour that the render never agrees with.
  const named = props.albedo?.material ?? null;
  tune.value =
    (named ? shading[named] : null) ??
    (spec?.material ? shading[charmMaterialName(spec.material)] : null) ??
    Object.entries(shading).find(
      ([k, t]) => (k === spec?.model || k.startsWith(`${spec?.model}_`)) && seedDrivenShading(t),
    )?.[1] ??
    null;

  // INERT is a claim, and it needs evidence — declaring it on the name guess is
  // what left Glitter Bomb saying "one look at every pattern" about a charm the
  // renderer was happily re-shading. Two sources can settle it:
  //
  //  · a community charm names its material in the econ spec, so the lookup is
  //    exact and the answer is trustworthy right away;
  //  · a charm that owns its model only becomes knowable once the MOUNT reports
  //    which material it tuned. `material: null` from a mounted model is a real
  //    answer — nothing was tuned, so nothing varies.
  //
  // Until one of those arrives, an own-model charm stays draggable. Erring
  // toward the working control costs a rail that might not move; erring the
  // other way silently removes the feature from the charm you are holding.
  const settled = !!spec?.material || !!props.albedo;
  if (settled && !seedDrivenShading(tune.value ?? undefined)) {
    state.value = "inert";
    tune.value = null;
    tile.value = null;
    emit("update:inert", true);
    return;
  }
  emit("update:inert", false);
  // The mounted model wins here too when it named its material: that texture is
  // the one being graded on screen, where a fetched one is only probably it.
  tile.value = (named ? fromProp() : null) ?? fetched.value ?? fromProp();
  if (PATTERN_LOG) {
    console.log("[patternrail]", {
      image,
      spec,
      material: named ?? (spec?.material ? charmMaterialName(spec.material) : null),
      matchedBy: named ? "renderer" : spec?.material ? "econ spec" : "model-stem guess",
      dynamic: tune.value?.dynamic ? Object.keys(tune.value.dynamic) : null,
      atSeed: tune.value ? charmSeedAdjust(tune.value, seed.value) : null,
      shadingKeys: Object.keys(shading).length,
    });
  }
  settle();
}

/** The mounted model's albedo, resized to TILE² if it came in at another size. */
function fromProp(): Uint8ClampedArray | null {
  const a = props.albedo;
  if (!a?.data?.length) return null;
  if (a.size === TILE) return a.data;
  const out = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const sx = Math.min(a.size - 1, Math.floor((x * a.size) / TILE));
      const sy = Math.min(a.size - 1, Math.floor((y * a.size) / TILE));
      out.set(a.data.subarray((sy * a.size + sx) * 4, (sy * a.size + sx) * 4 + 4), (y * TILE + x) * 4);
    }
  }
  return out;
}

function settle() {
  state.value = tune.value && tile.value ? "ready" : "unavailable";
  void nextTick(draw);
}

/** The charm's albedo, downsampled to TILE² RGBA. */
async function sampleAlbedo(url: string): Promise<Uint8ClampedArray | null> {
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : null));
    if (!blob) return null;
    const bmp = await createImageBitmap(blob, { resizeWidth: TILE, resizeHeight: TILE, resizeQuality: "high" });
    const cv = document.createElement("canvas");
    cv.width = TILE;
    cv.height = TILE;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    // Fully transparent texels are padding, not colour — averaging them in
    // drags every band toward black, so every read below skips them on alpha.
    return ctx.getImageData(0, 0, TILE, TILE).data;
  } catch {
    return null;
  }
}

/**
 * Paint one column per pixel: pattern → grade → averaged albedo.
 *
 * Averaging AFTER the grade, not before. The hue rotation is faded per pixel by
 * that pixel's own saturation (see charmAdjustSrgb), so grading a pre-averaged
 * colour would apply one charm-wide fade instead of the per-texel one — which
 * is exactly the difference between a chrome charm that stays chrome and one
 * the rail promises will turn purple.
 */
function draw() {
  const cv = canvas.value;
  const src = tile.value;
  const t = tune.value;
  if (!cv || !src || !t) return;
  const w = Math.max(1, Math.round(cv.clientWidth));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(RAIL_H * dpr);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const span = hi.value - lo.value;
  const work = new Uint8ClampedArray(src.length);
  for (let x = 0; x < w; x++) {
    work.set(src);
    charmAdjustSrgb(work, charmSeedAdjust(t, lo.value + (span * x) / Math.max(1, w - 1)));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < work.length; i += 4) {
      if (src[i + 3] < 8) continue;
      r += work[i];
      g += work[i + 1];
      b += work[i + 2];
      n++;
    }
    if (!n) continue;
    ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    ctx.fillRect(x * dpr, 0, Math.ceil(dpr), cv.height);
  }
}

/** Pointer x → pattern. */
function fracAt(ev: PointerEvent, el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (ev.clientX - box.left) / Math.max(1, box.width)));
}
function seedAt(ev: PointerEvent, el: HTMLElement): number {
  return Math.round(lo.value + fracAt(ev, el) * (hi.value - lo.value));
}

function onDown(ev: PointerEvent) {
  if (!canBrowse.value) return;
  dragging.value = true;
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  emit("update:modelValue", seedAt(ev, ev.currentTarget as HTMLElement));
}
function onMove(ev: PointerEvent) {
  if (!canBrowse.value) return;
  hover.value = fracAt(ev, ev.currentTarget as HTMLElement);
  if (dragging.value) emit("update:modelValue", seedAt(ev, ev.currentTarget as HTMLElement));
}
function onUp(ev: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
}

/** Arrow keys step one pattern, shift-arrows a hundred — the rail is a slider
 *  and has to answer to a keyboard like one. */
function onKey(ev: KeyboardEvent) {
  if (!canBrowse.value) return;
  const dir = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  ev.preventDefault();
  const step = ev.shiftKey ? 100 : 1;
  emit("update:modelValue", Math.min(hi.value, Math.max(lo.value, seed.value + dir * step)));
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

/**
 * Zoom STEPS by ten, rather than jumping straight to the chunk.
 *
 * A single jump from the whole space to a 1000-wide band looked broken, and was
 * not: the hue sweeps something like 160° across all 100000 patterns, so a
 * thousand of them span under two degrees. The band redrew, identically, and
 * read as a dead button.
 *
 * Ten-times steps fix both halves of that. The first lands on a range wide
 * enough to still show colour moving, and the last is the 1000-wide band worth
 * locking the die to. Which is also the honest lesson of the flat band: past a
 * point, zooming buys PRECISION, not more colour — every pattern in there is
 * the same colour, and that is a useful thing to be able to see.
 */
const ZOOM_STEPS = computed(() => {
  const full = props.max - props.min;
  const out: number[] = [];
  for (let span = Math.floor(full / 10); span >= props.chunk; span = Math.floor(span / 10)) out.push(span);
  return out;
});
const zoomLevel = ref(0);

function cycleZoom() {
  zoomLevel.value = (zoomLevel.value + 1) % (ZOOM_STEPS.value.length + 1);
  if (zoomLevel.value === 0) {
    zoom.value = null;
  } else {
    // Centred on the current pattern rather than snapped to a fixed lattice:
    // you zoom because you like the colour you are ON, and a lattice can put it
    // one pattern from the edge of the band it lands in.
    const span = ZOOM_STEPS.value[zoomLevel.value - 1];
    const half = Math.floor(span / 2);
    const lo = Math.min(props.max - span, Math.max(props.min, seed.value - half));
    zoom.value = { lo, hi: lo + span };
  }
  void nextTick(draw);
}
/** Span currently shown, as the button's own label — "100K" / "10K" / "1K". */
const spanLabel = computed(() => {
  const span = hi.value - lo.value;
  return span >= 1000 ? `${Math.round(span / 1000)}K` : String(span);
});

/**
 * Roll a pattern — inside whatever range is on screen.
 *
 * There is no separate "lock the die to this band" control, and there was: it
 * needed explaining, which is the tell that it should not exist. Zooming
 * already states a range of interest perfectly well, so the die just honours
 * it. Zoom to the greens, press the die, get a green — no second concept, and
 * nothing to learn beyond "it rolls in what you are looking at".
 */
function roll() {
  emit("update:modelValue", lo.value + Math.floor(Math.random() * (hi.value - lo.value + 1)));
}

/**
 * Tick marks, in two weights, scaled to whatever range is shown.
 *
 * A hundred identical hairlines is a hatch pattern, not a scale — so the step
 * is chosen to land on roughly ten labelled divisions however far in you are,
 * and the minors subdivide those. Fixing the step to the chunk width instead
 * meant a zoomed band fell below two divisions and the ticks disappeared
 * entirely, which is half of why zooming looked like it had done nothing.
 */
const ticks = computed(() => {
  const span = hi.value - lo.value;
  if (span < 10) return [];
  const major = Math.max(1, Math.pow(10, Math.round(Math.log10(span / 10))));
  const minor = Math.max(1, major / (major >= 10 ? 5 : 1));
  const out: { f: number; major: boolean; label: string }[] = [];
  const first = Math.ceil(lo.value / minor) * minor;
  for (let v = first; v < hi.value; v += minor) {
    const isMajor = v % major === 0;
    if (!isMajor && span / minor > 40) continue; // too dense to read as a scale
    out.push({
      f: (v - lo.value) / span,
      major: isMajor,
      label: major >= 1000 ? `${Math.round(v / 1000)}k` : String(v),
    });
    if (out.length > 220) break;
  }
  return out;
});

let ro: ResizeObserver | null = null;
watch(canvas, (el) => {
  ro?.disconnect();
  ro = null;
  if (!el) return;
  ro = new ResizeObserver(() => draw());
  ro.observe(el);
});
onBeforeUnmount(() => ro?.disconnect());

// The mounted model finishes loading after the econ lookup does — and it is
// the one that knows which material is actually being graded, so its arrival
// re-decides both the shading entry and the albedo, not just the albedo.
watch(
  () => props.albedo,
  () => {
    if (props.image) resolve(props.image);
  },
);

watch(
  () => props.image,
  (img) => {
    zoom.value = null;
    zoomLevel.value = 0;
    editing.value = false;
    emit("update:inert", false);
    if (img) void load(img);
    else state.value = "unavailable";
  },
  { immediate: true },
);
</script>

<template>
  <!-- NO panel chrome of its own. Every host already renders this inside a
       `rounded-md bg-secondary/40 p-2.5` row, so carrying the same card here
       drew a box inside an identical box. A control should not assume it is a
       card; the surface it sits on is the caller's decision. -->
  <div v-if="state !== 'inert'">
    <!-- Holds the row's height while the econ lookup lands. Collapsing to
         nothing and springing back is the jump the charm slot above already
         avoids, and this control is taller than that one. -->
    <div v-if="state === 'loading'">
      <div class="mb-2 flex items-center gap-2">
        <span class="animate-skeleton h-5 w-5 flex-none rounded-sm bg-muted-foreground/20"></span>
        <span class="animate-skeleton h-2 w-24 rounded-full bg-muted-foreground/20" :style="{ '--i': 1 }"></span>
      </div>
      <div class="animate-skeleton rounded-sm bg-muted-foreground/15" :style="{ height: RAIL_H + 'px', '--i': 2 }"></div>
    </div>

    <!-- Inert charms get the row back as a plain statement. No rail, no die, no
         readout to scrub — there is one look and this is it. -->
    <!-- Nothing here for the inert case — the root above is gone entirely, so
         even the wrapper's margin goes with it. There used to be a "one look at
         every pattern" line, which was accurate and still wrong: it spent a row
         of the form describing a control that was not there. A pattern that
         cannot change anything is not worth a heading, a number, or a sentence. -->

    <div v-else>
      <!-- Header: the live swatch, the pattern it belongs to, and the band
           controls. The swatch is the whole argument for this control — it is
           the colour you are about to get, at the size you can actually judge. -->
      <div class="mb-2 flex items-center gap-2">
        <span
          class="h-5 w-5 flex-none rounded-sm ring-1 ring-inset ring-white/15"
          :style="{
            background: swatch ?? 'transparent',
            boxShadow: swatch ? `0 0 10px -2px ${swatch}` : undefined,
            transition: 'background 220ms linear, box-shadow 220ms linear',
          }"
        ></span>
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Pattern</span>

        <!-- Click-to-edit. The field is gone from the row because a coordinate
             is only worth typing once you know where you are going — but a
             pattern quoted from a trade site still has to be enterable. -->
        <input
          v-if="editing"
          ref="editEl"
          v-model="draft"
          type="number"
          :min="min"
          :max="max"
          class="h-6 w-24 rounded border border-[color:var(--acc)] bg-background px-1.5 font-mono text-f11 tabular-nums outline-none"
          @blur="commitEdit"
          @keydown.enter.prevent="commitEdit"
          @keydown.esc.prevent="editing = false"
        />
        <button
          v-else
          class="rounded px-1 font-mono text-f13 tabular-nums text-foreground/90 transition-colors hover:bg-white/5 hover:text-[color:var(--acc)]"
          title="Type an exact pattern"
          @click="beginEdit"
        >#{{ seed.toLocaleString() }}</button>

        <!-- One segmented group, because the two are one idea: the span you are
             looking at, and a roll inside it. Sitting apart — worse, with the
             die outside the component entirely — is what made the range control
             need a name like "Lock" and then need explaining. -->
        <div
          class="ml-auto flex flex-none items-stretch overflow-hidden rounded border transition-colors"
          :class="zoom ? 'border-[color:var(--acc)]/60' : 'border-input'"
        >
          <!-- Labelled with the span it is showing, not with a verb: the button
               cycles 100K → 10K → 1K → back, so "Zoom" would name only one of
               the four things a press does. -->
          <button
            class="px-1.5 py-0.5 font-mono text-f8 uppercase tracking-cs1 transition-colors"
            :class="
              zoom
                ? 'text-[color:var(--acc)] hover:bg-[color:var(--acc)]/10'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
            "
            :title="
              zoomLevel < ZOOM_STEPS.length
                ? `Showing ${spanLabel} patterns — click to zoom in`
                : 'Narrowest band — click for the full range'
            "
            @click="cycleZoom"
          >{{ spanLabel }}</button>
          <span class="w-px flex-none self-stretch" :class="zoom ? 'bg-[color:var(--acc)]/40' : 'bg-input'"></span>
          <button
            class="px-1.5 py-0.5 text-f11 leading-none transition-colors hover:bg-white/5"
            :title="`Random pattern between ${lo.toLocaleString()} and ${hi.toLocaleString()}`"
            @click="roll"
          >🎲</button>
        </div>
      </div>

      <!-- The rail. Grab anywhere on it; the charm follows the drag. -->
      <div
        class="relative touch-none select-none overflow-hidden rounded-sm outline-none"
        :class="canBrowse ? 'cursor-ew-resize' : ''"
        :style="{ height: RAIL_H + 'px' }"
        tabindex="0"
        role="slider"
        :aria-valuemin="lo"
        :aria-valuemax="hi"
        :aria-valuenow="seed"
        aria-label="Charm pattern"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="hover = null"
        @keydown="onKey"
      >
        <canvas ref="canvas" class="block h-full w-full" :style="{ height: RAIL_H + 'px' }"></canvas>

        <!-- No albedo from either source. Say so rather than leaving a blank
             bar that reads as a charm with no colours — the band picker and the
             scrub both still work. -->
        <div
          v-if="state === 'unavailable'"
          class="absolute inset-0 grid place-items-center bg-secondary/70 text-f8 uppercase tracking-cs1 text-muted-foreground/70"
        >
          Drag to browse
        </div>

        <!-- Ticks. Major rules carry a number; minors are hairlines. -->
        <template v-for="(t, i) in ticks" :key="i">
          <span
            class="pointer-events-none absolute w-px"
            :class="t.major ? 'inset-y-0 bg-black/40' : 'top-0 h-1.5 bg-black/30'"
            :style="{ left: t.f * 100 + '%' }"
          ></span>
          <span
            v-if="t.major"
            class="pointer-events-none absolute bottom-0.5 -translate-x-1/2 font-mono text-[7px] tabular-nums text-white/45"
            :style="{ left: t.f * 100 + '%', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }"
            >{{ t.label }}</span
          >
        </template>

        <!-- Ghost needle: read the pattern under the cursor before committing. -->
        <span
          v-if="hover != null && !dragging"
          class="pointer-events-none absolute inset-y-0 w-px bg-white/50"
          :style="{ left: hover * 100 + '%' }"
        ></span>
        <span
          v-if="hoverSeed != null && !dragging"
          class="pointer-events-none absolute top-1 -translate-x-1/2 rounded-sm bg-black/75 px-1 font-mono text-[8px] tabular-nums text-white/90"
          :style="{ left: `clamp(1.6rem, ${hover! * 100}%, calc(100% - 1.6rem))` }"
          >{{ hoverSeed.toLocaleString() }}</span
        >

        <!-- The marker, glowing in the colour it points at — the same white
             needle + coloured bloom the wear track uses, so the two readouts
             read as one family. Transition OFF while dragging: easing toward
             the pointer during a scrub feels like lag, not polish. -->
        <span
          class="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white"
          :class="inBand ? '' : 'opacity-30'"
          :style="{
            left: cursor * 100 + '%',
            boxShadow: swatch
              ? `0 0 6px ${swatch}, 0 0 14px color-mix(in srgb, ${swatch} 50%, transparent), 0 1px 3px rgba(0,0,0,0.8)`
              : '0 1px 3px rgba(0,0,0,0.8)',
            transition: dragging ? 'none' : 'left 220ms cubic-bezier(0.22,1,0.36,1)',
          }"
        ></span>

        <!-- Inset lip, painted last so it sits over the gradient's edges. -->
        <span
          class="pointer-events-none absolute inset-0 rounded-sm"
          style="box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 3px rgba(0, 0, 0, 0.6)"
        ></span>
      </div>

      <!-- The end labels are the range; the middle one says what the range is
           FOR the moment it stops being everything. That sentence is the whole
           of what the old Lock button was trying to mean. -->
      <div class="mt-1 flex items-baseline font-mono text-f8 tabular-nums text-muted-foreground/60">
        <span>{{ lo.toLocaleString() }}</span>
        <span v-if="zoom" class="mx-auto uppercase tracking-cs1 text-[color:var(--acc)]/80">🎲 rolls in here</span>
        <span class="ml-auto">{{ hi.toLocaleString() }}</span>
      </div>
    </div>
  </div>
</template>
