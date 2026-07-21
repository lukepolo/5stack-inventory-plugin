<script setup lang="ts">
// Skin test suite: render EVERY painted finish (weapon / knife / glove) through
// the real production path (snapshotModel — the same code that bakes card art),
// stream each PNG to the mount, and lay them all out in one gallery so a human
// can sweep the whole catalog for compositor regressions at a glance.
//
// Why this lives here and not in a standalone tool: the point is to catch what
// SHIPS, so it must render through the deployed viewer, not a rig that imports
// src/ directly. This is a route inside the app (an admin tab), so it runs
// against the same models mount + paint CDN the app itself uses.
//
// "Can it all run in the container?" — storage, serving and the report do
// (backend + nginx, same mount as /renders). The render itself needs WebGL, so
// it runs in WHATEVER browser opens this page. Open it, hit Run, leave the tab
// in the foreground; ~2k finishes take the better part of an hour. It is
// resumable (keyed on each finish's economy id) and safe to stop and restart.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Loader2, Play, Square, Trash2, RefreshCw, AlertTriangle,
  ThumbsUp, ThumbsDown, Box, X, ChevronLeft, ChevronRight,
  Search, FilterX,
} from "lucide-vue-next";
import { hasModel, mountViewer, snapshotModel, type ViewerHandle } from "./viewer3d";
import {
  fetchTestCatalog,
  fetchTestList,
  fetchTestReport,
  fetchTestVerdicts,
  saveTestReport,
  saveTestVerdicts,
  uploadTestSnap,
  clearTests,
  testKeyFor,
  testImgUrl,
  type RenderTestItem,
  type TestReport,
  type TestResult,
  type TestVerdict,
  type TestVerdicts,
} from "./api";

const props = defineProps<{ isAdmin?: boolean }>();
const emit = defineEmits<{ (e: "notify", message: string, kind: "error" | "success"): void }>();

// ---- data -------------------------------------------------------------------
const catalog = ref<RenderTestItem[]>([]);
const rendered = ref<Set<number>>(new Set()); // ids with a PNG on disk
const report = ref<TestReport>({});
const verdicts = ref<TestVerdicts>({}); // human good/bad, survives Clear
const loading = ref(true);
const loadError = ref<string | null>(null);

// A fresh bake wins over the cached <img> — bump an id here after re-rendering
// so its thumbnail cache-busts and reloads instead of showing the old pixels.
const bakeStamp = ref<Record<number, number>>({});

// ---- persisted view state ---------------------------------------------------
// The filters and render knobs are how you were LOOKING at the catalog; a
// refresh (or the panel remounting the micro-frontend) shouldn't dump you back
// at "all, unsorted, wear 0". Persist them under one key and restore on mount.
const LS_KEY = "5stack.skintests.view.v1";
type KindKey = RenderTestItem["kind"];
interface ViewState {
  wear: number;
  seed: number;
  search: string;
  kinds: Record<KindKey, boolean>;
  problemsOnly: boolean;
  sortByChroma: boolean;
  review: "all" | "unreviewed" | "good" | "bad";
}
const VIEW_DEFAULTS: ViewState = {
  wear: 0,
  seed: 1,
  search: "",
  kinds: { weapon: true, knife: true, glove: true },
  problemsOnly: false,
  sortByChroma: false,
  review: "all",
};
function loadView(): ViewState {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    return {
      ...VIEW_DEFAULTS,
      ...raw,
      kinds: { ...VIEW_DEFAULTS.kinds, ...(raw?.kinds ?? {}) },
    };
  } catch {
    return { ...VIEW_DEFAULTS, kinds: { ...VIEW_DEFAULTS.kinds } };
  }
}
const saved = loadView();

// The render finishes we render at. Wear/seed are the finish's LOOK, not part
// of the key: the suite holds one current render per finish, and re-running at a
// different wear overwrites it. Factory New + the app's default seed show the
// cleanest pattern for spotting problems.
const wear = ref(saved.wear);
const seed = ref(saved.seed);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    const [cat, keys, rep, ver] = await Promise.all([
      fetchTestCatalog(),
      fetchTestList(),
      fetchTestReport().catch(() => ({}) as TestReport),
      fetchTestVerdicts().catch(() => ({}) as TestVerdicts),
    ]);
    catalog.value = cat;
    rendered.value = new Set(
      keys.map((k) => Number(k.replace(/^test-(\d+)\.png$/, "$1"))).filter(Number.isFinite),
    );
    report.value = rep ?? {};
    verdicts.value = ver ?? {};
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// ---- the run ----------------------------------------------------------------
const running = ref(false);
let stopRequested = false;
const current = ref<string>("");
// The finish being rendered RIGHT NOW. Drives the in-progress badge on its tile,
// so a run that looks stuck can be traced to the exact skin that hung.
const currentId = ref<number | null>(null);
// Ids waiting their turn, in order. The Set view backs the per-tile "queued"
// badge; enqueue() checks it so the same finish is never scheduled twice — click
// a tile that's already waiting and nothing happens.
const queue = ref<number[]>([]);
const queuedIds = computed(() => new Set(queue.value));
const isQueued = (id: number) => queuedIds.value.has(id);
// Rendered so far in the CURRENT worker session: reset each time the worker
// spins up from idle, and grows if more work is enqueued mid-run.
const doneCount = ref(0);
const remaining = computed(() => queue.value.length + (currentId.value !== null ? 1 : 0));
const progressTotal = computed(() => doneCount.value + remaining.value);

const pending = computed(() => catalog.value.filter((i) => !rendered.value.has(i.id)));

// Pixel stats off the rendered frame. The reliable grey-bug signal is low
// chroma over the weapon's own pixels — but plenty of skins are legitimately
// achromatic (bare knives, black finishes), so this is a SORT key for triage,
// never an automatic condemnation. Only the hard failures (no model, empty
// frame) get a red status.
const scratch = document.createElement("canvas");
async function analyze(blob: Blob): Promise<{ sat: number; luma: number; coverage: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("decode failed"));
      im.src = url;
    });
    const S = 96;
    scratch.width = S;
    scratch.height = S;
    const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(img, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);
    let n = 0, sat = 0, luma = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 24) continue; // transparent backdrop — not the gun
      const r = data[i], g = data[i + 1], b = data[i + 2];
      n++;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
      luma += 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return {
      sat: n ? +(sat / n).toFixed(1) : 0,
      luma: n ? +(luma / n).toFixed(1) : 0,
      coverage: +(n / (S * S)).toFixed(3),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderOne(item: RenderTestItem): Promise<TestResult> {
  if (!(await hasModel(item.model))) {
    return { status: "failed", sat: 0, luma: 0, coverage: 0, reason: "model not extracted" };
  }
  let blob: Blob | null;
  try {
    blob = await snapshotModel(item.model, {
      paintMaterial: item.paintMaterial,
      legacyPaint: item.legacy,
      wear: wear.value,
      seed: seed.value,
    });
  } catch (e) {
    return { status: "failed", sat: 0, luma: 0, coverage: 0, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!blob) return { status: "failed", sat: 0, luma: 0, coverage: 0, reason: "snapshot returned no image" };

  const stats = await analyze(blob).catch(() => ({ sat: 0, luma: 0, coverage: 0 }));
  const up = await uploadTestSnap(testKeyFor(item.id), blob);
  if (!up.ok) return { status: "failed", ...stats, reason: `upload failed: ${up.error}` };

  rendered.value = new Set(rendered.value).add(item.id);
  bakeStamp.value = { ...bakeStamp.value, [item.id]: Date.now() };
  // A frame that's nearly all backdrop means the model didn't draw.
  if (stats.coverage < 0.01) return { status: "empty", ...stats, reason: "near-empty frame" };
  return { status: "ok", ...stats };
}

// Add finishes to the render queue and make sure the worker is turning. Ids
// already queued or rendering right now are dropped, so clicking a tile that's
// waiting — or hitting "Render pending" twice — never schedules the same finish
// a second time. Works whether or not a run is already going.
function enqueue(items: RenderTestItem[]) {
  const seen = queuedIds.value;
  const add = items
    .map((i) => i.id)
    .filter((id) => id !== currentId.value && !seen.has(id));
  if (!add.length) return;
  queue.value = [...queue.value, ...add];
  void drain();
}

// The single worker. One turns at a time (each render mounts its own WebGL
// context — running them concurrently would fight for the GPU); enqueue() just
// extends the queue the running worker is already draining.
async function drain() {
  if (running.value) return;
  running.value = true;
  stopRequested = false;
  doneCount.value = 0;
  let sinceSave = 0;
  try {
    while (queue.value.length && !stopRequested) {
      const id = queue.value[0];
      queue.value = queue.value.slice(1);
      const item = catalog.value.find((i) => i.id === id);
      if (!item) continue;
      current.value = item.name;
      currentId.value = id;
      const result = await renderOne(item);
      report.value = { ...report.value, [id]: result };
      currentId.value = null;
      doneCount.value++;
      // Persist the report periodically so a crash or a closed tab mid-run
      // doesn't lose the problem flags for everything already done.
      if (++sinceSave >= 40) {
        sinceSave = 0;
        saveTestReport(report.value).catch(() => {});
      }
      // Yield so the gallery repaints and the WebGL context from the disposed
      // viewer is reclaimed before the next mount.
      await new Promise((r) => setTimeout(r, 16));
    }
  } finally {
    await saveTestReport(report.value).catch(() => {});
    const rendered_ = doneCount.value;
    running.value = false;
    current.value = "";
    currentId.value = null;
    const failed = Object.values(report.value).filter((r) => r.status !== "ok").length;
    emit(
      "notify",
      stopRequested
        ? `Stopped — ${rendered_} rendered this run.`
        : `Done — ${rendered_} rendered, ${failed} flagged.`,
      "success",
    );
  }
  // Work enqueued during the final flush (running was still true, so its own
  // drain() no-op'd) would otherwise sit in the queue with no worker — pick it
  // back up now that we've stood down.
  if (queue.value.length && !stopRequested) void drain();
}

const runPending = () => enqueue(pending.value);
const runAll = () => enqueue(catalog.value);
function stop() {
  stopRequested = true;
  queue.value = []; // drop what's waiting so the worker halts instead of draining on
}
onBeforeUnmount(() => {
  stopRequested = true;
});

// One-off re-render is just a queue of one — same de-dupe, and it slots into a
// run in progress instead of being locked out by it.
const reRender = (item: RenderTestItem) => enqueue([item]);

async function wipe() {
  if (running.value) return;
  if (!confirm("Delete every rendered skin PNG and the report? They regenerate on the next run. Good/bad verdicts are kept.")) return;
  try {
    const { cleared } = await clearTests();
    rendered.value = new Set();
    report.value = {};
    bakeStamp.value = {};
    emit("notify", `Cleared ${cleared} files.`, "success");
  } catch (e) {
    emit("notify", e instanceof Error ? e.message : String(e), "error");
  }
}

// ---- triage -----------------------------------------------------------------
// The machine can only flag the hard failures; whether a skin LOOKS right is a
// human call. Verdicts are stored apart from the report so a re-run (or Clear)
// never throws the judgements away — see the api.ts note.
let verdictSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistVerdicts() {
  if (verdictSaveTimer) clearTimeout(verdictSaveTimer);
  // Coalesce: rapid-fire triage (keyboard sweep) would otherwise PUT the whole
  // map on every keystroke.
  verdictSaveTimer = setTimeout(() => {
    verdictSaveTimer = null;
    saveTestVerdicts(verdicts.value).catch((e) =>
      emit("notify", `Verdict not saved: ${e instanceof Error ? e.message : String(e)}`, "error"),
    );
  }, 400);
}

const verdictOf = (id: number): TestVerdict | undefined => verdicts.value[id]?.verdict;

// Clicking the verdict it already has clears it — the same button is mark and
// unmark, so a misclick during a fast sweep costs one click to undo.
function setVerdict(id: number, v: TestVerdict) {
  const next = { ...verdicts.value };
  if (next[id]?.verdict === v) delete next[id];
  else next[id] = { ...next[id], verdict: v, at: Date.now() };
  verdicts.value = next;
  persistVerdicts();
}
function setNote(id: number, note: string) {
  const entry = verdicts.value[id];
  if (!entry) return; // a note without a verdict has nothing to qualify
  verdicts.value = { ...verdicts.value, [id]: { ...entry, note: note.trim() || undefined } };
  persistVerdicts();
}

// ---- 3D inspection ----------------------------------------------------------
// A 128px thumbnail hides exactly the bugs this suite is hunting (pattern
// placement, glitter, wear). Open the real interactive viewer on the same
// finish, at an adjustable wear/seed, and mark it good or bad from there.
const viewItem = ref<Row | null>(null);
const viewEl = ref<HTMLElement | null>(null);
const viewBusy = ref(false);
const viewError = ref<string | null>(null);
const viewWear = ref(0);
const viewSeed = ref(1);
let viewHandle: ViewerHandle | null = null;
let viewAbort: AbortController | null = null;
let viewGen = 0;

function teardownView() {
  viewGen++;
  viewAbort?.abort();
  viewAbort = null;
  viewHandle?.dispose();
  viewHandle = null;
}

async function mountView() {
  teardownView();
  const gen = viewGen;
  const item = viewItem.value;
  if (!item) return;
  viewBusy.value = true;
  viewError.value = null;
  await nextTick();
  const host = viewEl.value;
  if (!host) {
    viewBusy.value = false;
    return;
  }
  const ac = new AbortController();
  viewAbort = ac;
  try {
    const handle = await mountViewer(host, item.model, {
      signal: ac.signal,
      paintMaterial: item.paintMaterial,
      legacyPaint: item.legacy,
      wear: viewWear.value,
      seed: viewSeed.value,
    });
    // Closed or stepped to another skin while the GLB loaded — this handle has
    // no host left to draw into.
    if (gen !== viewGen) {
      handle.dispose();
      return;
    }
    viewHandle = handle;
  } catch (e) {
    if (gen !== viewGen || (e as { name?: string })?.name === "AbortError") return;
    viewError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (gen === viewGen) viewBusy.value = false;
  }
}

function open3d(item: Row) {
  viewWear.value = wear.value;
  viewSeed.value = seed.value;
  viewItem.value = item;
}
function close3d() {
  teardownView();
  viewItem.value = null;
  viewBusy.value = false;
}
// Step through the CURRENT filter, so "problems only" or a search doubles as a
// triage work-list: open the first one and walk it with the arrow keys.
function step3d(delta: number) {
  const list = rows.value;
  const i = list.findIndex((r) => r.id === viewItem.value?.id);
  const next = list[i + delta];
  if (next) viewItem.value = next;
}

watch(viewItem, (v) => {
  if (v) void mountView();
});
// Wear/seed are the two knobs that change what a finish LOOKS like, so a
// remount is the whole point — debounced because they're dragged sliders.
let viewOptsTimer: ReturnType<typeof setTimeout> | null = null;
watch([viewWear, viewSeed], () => {
  if (!viewItem.value) return;
  if (viewOptsTimer) clearTimeout(viewOptsTimer);
  viewOptsTimer = setTimeout(() => void mountView(), 250);
});

function onKey(e: KeyboardEvent) {
  if (!viewItem.value) return;
  const el = e.target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return; // typing a note
  if (e.key === "Escape") return close3d();
  if (e.key === "ArrowRight") return step3d(1);
  if (e.key === "ArrowLeft") return step3d(-1);
  if (!props.isAdmin) return;
  if (e.key === "g" || e.key === "G") setVerdict(viewItem.value.id, "good");
  if (e.key === "b" || e.key === "B") setVerdict(viewItem.value.id, "bad");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  teardownView();
});

// ---- gallery ----------------------------------------------------------------
const search = ref(saved.search);
const kinds = ref<Record<KindKey, boolean>>(saved.kinds);
const problemsOnly = ref(saved.problemsOnly);
const sortByChroma = ref(saved.sortByChroma);
// good / bad / unreviewed — the triage work-list filter.
const review = ref<ViewState["review"]>(saved.review);

// One key, all of it, debounced — a fast typed search shouldn't hammer
// localStorage on every keystroke.
let viewSaveTimer: ReturnType<typeof setTimeout> | null = null;
watch([wear, seed, search, kinds, problemsOnly, sortByChroma, review], () => {
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => {
    viewSaveTimer = null;
    const state: ViewState = {
      wear: wear.value, seed: seed.value, search: search.value,
      kinds: kinds.value, problemsOnly: problemsOnly.value,
      sortByChroma: sortByChroma.value, review: review.value,
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* private mode / quota — non-fatal */ }
  }, 300);
}, { deep: true });

const resetFilters = () => {
  search.value = "";
  kinds.value = { ...VIEW_DEFAULTS.kinds };
  problemsOnly.value = false;
  sortByChroma.value = false;
  review.value = "all";
};
const filtersActive = computed(() =>
  search.value.trim() !== "" || problemsOnly.value || sortByChroma.value ||
  review.value !== "all" || !kinds.value.weapon || !kinds.value.knife || !kinds.value.glove,
);

type Row = RenderTestItem & { result?: TestResult; done: boolean };
const rows = computed<Row[]>(() => {
  const q = search.value.trim().toLowerCase();
  let list: Row[] = catalog.value
    .filter((i) => kinds.value[i.kind])
    .filter((i) => !q || i.name.toLowerCase().includes(q))
    .map((i) => ({ ...i, result: report.value[i.id], done: rendered.value.has(i.id) }));
  if (problemsOnly.value) list = list.filter((r) => r.result && r.result.status !== "ok");
  if (review.value !== "all") {
    list = list.filter((r) =>
      review.value === "unreviewed" ? !verdictOf(r.id) : verdictOf(r.id) === review.value,
    );
  }
  list.sort((a, b) => {
    if (sortByChroma.value) {
      // Rendered-but-low-chroma first (the grey-bug suspects), then un-rendered,
      // then the rest by name.
      const sa = a.result ? a.result.sat : Infinity;
      const sb = b.result ? b.result.sat : Infinity;
      if (sa !== sb) return sa - sb;
    }
    return a.name.localeCompare(b.name);
  });
  return list;
});

const stats = computed(() => {
  const vals = Object.values(report.value);
  const verds = Object.values(verdicts.value);
  return {
    total: catalog.value.length,
    done: rendered.value.size,
    failed: vals.filter((r) => r.status === "failed").length,
    empty: vals.filter((r) => r.status === "empty").length,
    good: verds.filter((v) => v.verdict === "good").length,
    bad: verds.filter((v) => v.verdict === "bad").length,
  };
});

// Chip styling, shared by every filter toggle so the row reads as one control
// set instead of a mix of checkboxes and selects.
const KIND_LIST = ["weapon", "knife", "glove"] as const;
const CHIP = "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors";
const CHIP_ON = "border-[hsl(var(--tac-amber))] bg-[hsl(var(--tac-amber)/0.12)] text-foreground";
const CHIP_OFF = "border-border text-muted-foreground hover:bg-muted";
const chipClass = (on: boolean) => [CHIP, on ? CHIP_ON : CHIP_OFF];

function thumbUrl(item: Row): string {
  const bust = bakeStamp.value[item.id];
  return testImgUrl(testKeyFor(item.id)) + (bust ? `?v=${bust}` : "");
}
function ring(r?: TestResult): string {
  if (!r) return "ring-border/50";
  if (r.status === "failed") return "ring-2 ring-red-500/70";
  if (r.status === "empty") return "ring-2 ring-amber-500/70";
  return "ring-border/50";
}
// A human verdict outranks the machine ring — it's the more reliable signal.
function verdictRing(id: number): string {
  const v = verdictOf(id);
  if (v === "good") return "ring-2 ring-emerald-500/70";
  if (v === "bad") return "ring-2 ring-red-500/70";
  return "";
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card text-card-foreground shadow">
    <div class="space-y-6 p-6">
      <!-- Header + counts -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Skin test suite</h3>
          <p class="max-w-xl text-sm text-muted-foreground">
            Renders every weapon, knife and glove finish through the real viewer so the whole
            catalog can be eyeballed for compositor issues. Runs in this browser — keep the tab
            in the foreground. Resumable; the PNGs live on the mount and are never committed.
          </p>
        </div>
        <div class="flex shrink-0 gap-4 text-sm">
          <div><span class="font-semibold text-foreground">{{ stats.done }}</span
            ><span class="text-muted-foreground">/{{ stats.total }}</span>
            <div class="text-xs text-muted-foreground">rendered</div></div>
          <div><span class="font-semibold" :class="stats.failed ? 'text-red-500' : 'text-foreground'">{{ stats.failed }}</span>
            <div class="text-xs text-muted-foreground">failed</div></div>
          <div><span class="font-semibold" :class="stats.empty ? 'text-amber-500' : 'text-foreground'">{{ stats.empty }}</span>
            <div class="text-xs text-muted-foreground">empty</div></div>
          <div><span class="font-semibold text-emerald-500">{{ stats.good }}</span>
            <div class="text-xs text-muted-foreground">good</div></div>
          <div><span class="font-semibold" :class="stats.bad ? 'text-red-500' : 'text-foreground'">{{ stats.bad }}</span>
            <div class="text-xs text-muted-foreground">bad</div></div>
        </div>
      </div>

      <p v-if="!isAdmin" class="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-600">
        <AlertTriangle class="h-4 w-4 shrink-0" />
        Running the suite writes to the shared mount and needs an administrator session.
      </p>

      <!-- Controls -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="!running"
          :disabled="!isAdmin || loading || !pending.length"
          class="inline-flex h-9 items-center gap-2 rounded-md bg-[hsl(var(--tac-amber))] px-3 text-sm font-medium text-black transition-colors hover:brightness-110 disabled:opacity-40"
          @click="runPending"
        >
          <Play class="h-3.5 w-3.5" /> Render pending ({{ pending.length }})
        </button>
        <button
          v-else
          class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-muted"
          @click="stop"
        >
          <Square class="h-3.5 w-3.5" /> Stop
        </button>
        <button
          :disabled="!isAdmin || running || loading"
          class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted disabled:opacity-40"
          @click="runAll"
          title="Re-render every finish, including ones already done"
        >
          <RefreshCw class="h-3.5 w-3.5" /> Re-render all
        </button>
        <button
          :disabled="!isAdmin || running || loading || !stats.done"
          class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-40"
          @click="wipe"
        >
          <Trash2 class="h-3.5 w-3.5" /> Clear
        </button>

        <div class="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <label class="flex items-center gap-1">wear
            <input v-model.number="wear" type="number" min="0" max="1" step="0.05"
              :disabled="running" class="h-8 w-16 rounded-md border border-border bg-transparent px-2" /></label>
          <label class="flex items-center gap-1">seed
            <input v-model.number="seed" type="number" min="0" max="1000" step="1"
              :disabled="running" class="h-8 w-16 rounded-md border border-border bg-transparent px-2" /></label>
        </div>
      </div>

      <!-- Progress -->
      <div v-if="running" class="space-y-1">
        <div class="h-1.5 overflow-hidden rounded-full bg-muted">
          <div class="h-full bg-[hsl(var(--tac-amber))] transition-[width] duration-200"
            :style="{ width: `${progressTotal ? (doneCount / progressTotal) * 100 : 0}%` }"></div>
        </div>
        <p class="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 class="h-3 w-3 animate-spin" />
          {{ doneCount }}/{{ progressTotal }} — {{ current }}
          <span v-if="queue.length" class="text-muted-foreground/70">· {{ queue.length }} queued</span>
        </p>
      </div>

      <p v-if="loadError" class="text-sm text-red-500">Failed to load: {{ loadError }}</p>

      <!-- Filters — chip toggles, persisted to localStorage so a refresh keeps
           your view. -->
      <div class="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 text-sm">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input v-model="search" placeholder="Search name…"
            class="h-8 w-52 rounded-md border border-border bg-transparent pl-7 pr-2" />
        </div>

        <!-- Item kind — segmented, so the group reads as one control -->
        <div class="flex overflow-hidden rounded-md border border-border">
          <button v-for="k in KIND_LIST" :key="k" type="button"
            class="h-8 px-2.5 text-xs capitalize transition-colors"
            :class="kinds[k] ? 'bg-[hsl(var(--tac-amber)/0.15)] text-foreground' : 'text-muted-foreground hover:bg-muted'"
            @click="kinds[k] = !kinds[k]">{{ k }}</button>
        </div>

        <button type="button" :class="chipClass(problemsOnly)" @click="problemsOnly = !problemsOnly">
          Problems only
        </button>
        <button type="button" :class="chipClass(sortByChroma)"
          title="Float low-chroma renders to the top — the grey-bug suspects"
          @click="sortByChroma = !sortByChroma">
          Low chroma first
        </button>

        <select v-model="review"
          class="h-8 rounded-md border px-2 text-xs"
          :class="review === 'all' ? CHIP_OFF : CHIP_ON">
          <option value="all">All reviews</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="good">Good</option>
          <option value="bad">Bad</option>
        </select>

        <button v-if="filtersActive" type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          @click="resetFilters">
          <FilterX class="h-3.5 w-3.5" /> Reset
        </button>

        <span class="ml-auto text-xs text-muted-foreground">{{ rows.length }} shown</span>
      </div>

      <!-- Gallery -->
      <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">
        <Loader2 class="mx-auto h-5 w-5 animate-spin" />
      </div>
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        <div v-for="item in rows" :key="item.id"
          class="group relative overflow-hidden rounded-lg border border-border bg-black/20 ring-1 ring-inset"
          :class="[ring(item.result), verdictRing(item.id)]">
          <button type="button" class="block aspect-square w-full cursor-zoom-in"
            title="Open in 3D" @click="open3d(item)">
            <img v-if="item.done" :src="thumbUrl(item)" :alt="item.name" loading="lazy"
              class="h-full w-full object-contain" />
            <div v-else class="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              not rendered
            </div>
          </button>

          <!-- Rendering RIGHT NOW: the whole point of this feature — you can see
               which finish the run is on, and which one it hangs on. -->
          <div v-if="currentId === item.id"
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-[10px] font-medium text-[hsl(var(--tac-amber))]">
            <Loader2 class="h-5 w-5 animate-spin" />
            rendering…
          </div>
          <!-- Waiting its turn — so it reads as scheduled, not idle, and a
               second click can't re-queue it. -->
          <div v-else-if="isQueued(item.id)"
            class="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <span class="mt-1 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--tac-amber))]">
              queued
            </span>
          </div>

          <!-- Verdict corner badge -->
          <div v-if="verdictOf(item.id)"
            class="absolute left-1 top-1 rounded p-0.5 text-white"
            :class="verdictOf(item.id) === 'good' ? 'bg-emerald-600/90' : 'bg-red-600/90'"
            :title="verdicts[item.id]?.note || verdictOf(item.id)">
            <ThumbsUp v-if="verdictOf(item.id) === 'good'" class="h-3 w-3" />
            <ThumbsDown v-else class="h-3 w-3" />
          </div>

          <div class="space-y-0.5 p-1.5">
            <p class="truncate text-[11px] font-medium leading-tight text-foreground" :title="item.name">{{ item.name }}</p>
            <div class="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{{ item.kind }}<span v-if="item.legacy"> · legacy</span></span>
              <span v-if="item.result">sat {{ item.result.sat }}</span>
            </div>
            <p v-if="item.result && item.result.status !== 'ok'" class="truncate text-[10px] text-red-500" :title="item.result.reason">
              {{ item.result.reason }}
            </p>
            <p v-else-if="verdicts[item.id]?.note" class="truncate text-[10px] text-red-400" :title="verdicts[item.id]?.note">
              {{ verdicts[item.id]?.note }}
            </p>
          </div>

          <!-- Hover actions: mark good/bad, open 3D, re-render -->
          <div v-if="isAdmin && currentId !== item.id"
            class="absolute right-1 top-1 hidden gap-1 group-hover:flex">
            <button
              class="rounded p-1 text-white hover:bg-black/80"
              :class="verdictOf(item.id) === 'good' ? 'bg-emerald-600' : 'bg-black/60'"
              title="Mark good" @click.stop="setVerdict(item.id, 'good')">
              <ThumbsUp class="h-3 w-3" />
            </button>
            <button
              class="rounded p-1 text-white hover:bg-black/80"
              :class="verdictOf(item.id) === 'bad' ? 'bg-red-600' : 'bg-black/60'"
              title="Mark bad" @click.stop="setVerdict(item.id, 'bad')">
              <ThumbsDown class="h-3 w-3" />
            </button>
            <button
              class="rounded p-1 text-white hover:bg-black/80 disabled:opacity-40"
              :class="isQueued(item.id) ? 'bg-[hsl(var(--tac-amber))]/70' : 'bg-black/60'"
              :disabled="isQueued(item.id)"
              :title="isQueued(item.id) ? 'Already queued' : running ? 'Queue a re-render' : 'Re-render this finish'"
              @click.stop="reRender(item)">
              <RefreshCw class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <p v-if="!loading && !rows.length" class="py-8 text-center text-sm text-muted-foreground">
        Nothing matches the current filters.
      </p>
    </div>

    <!-- 3D inspector: the real interactive viewer on one finish, so a suspect
         thumbnail can be checked at full fidelity and triaged in place. -->
    <div v-if="viewItem" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      @click.self="close3d">
      <div class="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl">
        <!-- Header -->
        <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Box class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium" :title="viewItem.name">{{ viewItem.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ viewItem.kind }}<span v-if="viewItem.legacy"> · legacy</span></p>
          </div>
          <div class="ml-auto flex items-center gap-1">
            <button class="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              title="Previous (←)" :disabled="viewBusy" @click="step3d(-1)"><ChevronLeft class="h-4 w-4" /></button>
            <button class="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              title="Next (→)" :disabled="viewBusy" @click="step3d(1)"><ChevronRight class="h-4 w-4" /></button>
            <button class="rounded-md p-1.5 text-muted-foreground hover:bg-muted" title="Close (Esc)" @click="close3d">
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Viewer -->
        <div class="relative aspect-square w-full bg-black/30">
          <div ref="viewEl" class="absolute inset-0"></div>
          <div v-if="viewBusy" class="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 class="h-6 w-6 animate-spin text-[hsl(var(--tac-amber))]" />
          </div>
          <div v-if="viewError" class="absolute inset-x-0 bottom-0 bg-red-950/80 px-3 py-2 text-xs text-red-300">
            {{ viewError }}
          </div>
        </div>

        <!-- Triage controls -->
        <div class="space-y-3 border-t border-border px-4 py-3">
          <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <label class="flex items-center gap-1">wear
              <input v-model.number="viewWear" type="range" min="0" max="1" step="0.01" class="w-28" />
              <span class="w-8 text-xs">{{ viewWear.toFixed(2) }}</span></label>
            <label class="flex items-center gap-1">seed
              <input v-model.number="viewSeed" type="number" min="0" max="1000" step="1"
                class="h-8 w-16 rounded-md border border-border bg-transparent px-2" /></label>
          </div>

          <div v-if="isAdmin" class="flex flex-wrap items-center gap-2">
            <button
              class="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
              :class="verdictOf(viewItem.id) === 'good'
                ? 'bg-emerald-600 text-white'
                : 'border border-border hover:bg-muted'"
              @click="setVerdict(viewItem.id, 'good')">
              <ThumbsUp class="h-3.5 w-3.5" /> Good <span class="opacity-60">(g)</span>
            </button>
            <button
              class="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
              :class="verdictOf(viewItem.id) === 'bad'
                ? 'bg-red-600 text-white'
                : 'border border-border hover:bg-muted'"
              @click="setVerdict(viewItem.id, 'bad')">
              <ThumbsDown class="h-3.5 w-3.5" /> Bad <span class="opacity-60">(b)</span>
            </button>
            <input
              :value="verdicts[viewItem.id]?.note ?? ''"
              @input="setNote(viewItem.id, ($event.target as HTMLInputElement).value)"
              :disabled="!verdictOf(viewItem.id)"
              placeholder="what's wrong…"
              class="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-sm disabled:opacity-40" />
          </div>
          <p v-else class="text-xs text-muted-foreground">Sign in as an administrator to mark this finish good or bad.</p>
        </div>
      </div>
    </div>
  </section>
</template>
