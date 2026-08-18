<script setup lang="ts">
// The admin surface, as real routes instead of a cramped dialog. Laid out like
// the panel's own application settings (tactical page header + side tabs +
// section cards) so it reads as part of 5stack, not a plugin doing its own thing.
//
// Each side tab is a route (/admin, /admin/assets, /admin/models) — same as
// settings, where the nav is links rather than in-page anchors.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Loader2,
  Copy,
  KeyRound,
  Trash2,
  Box,
  Check,
  ShieldAlert,
  Download,
  Info,
  ChevronRight,
  Minus,
  Plus,
  CircleDollarSign,
  RefreshCw,
} from "lucide-vue-next";
import SkinTests from "./SkinTests.vue";
import { FLAGS, activeFlags, flagValue, flagsVersion, setFlag } from "../devFlags";
import {
  API_ORIGIN,
  fetchServerApiKey,
  generateServerApiKey,
  fetchCacheStats,
  clearCache,
  fetchAssetCdn,
  setAssetCdn,
  fetchPriceAdmin,
  savePriceAdmin,
  syncPricesNow,
  clearPrices,
  formatPrice,
  PRICE_WINDOW_LABEL,
  PRICE_SOURCE_LABEL,
  fetchExtractStatus,
  startExtractJob,
  setExtractJobs,
  extractLogUrl,
  type AssetCdnStatus,
  type CacheStats,
  type CfgSyncResult,
  type DirStat,
  type ExtractStatus,
  type PriceAdminStatus,
  type PriceSource,
} from "../api";

const props = defineProps<{
  user?: { steam_id: string; name: string; role: string } | null;
  /** Sub-route below /admin: "", "assets" or "models". */
  section?: string;
}>();

const emit = defineEmits<{
  (e: "notify", message: string, kind: "error" | "success"): void;
  (e: "cfg-sync", cfg: CfgSyncResult | null): void;
  // Both scopes clearClearCache accepts. It said "renders" only, which made the
  // composites button a type error at its own call site.
  (e: "cache-cleared", scope: "renders" | "composites"): void;
  // Extraction hasn't been run, or ran on an older pipeline. App owns the gear
  // badge, so every status refresh here reports the answer upward — that's
  // what clears the dot the moment a run finishes.
  (e: "extract-stale", warn: "missing" | "stale" | null): void;
  (e: "navigate", section: string): void;
  (e: "back"): void;
}>();

/** App owns the catalogue and the resolution order; this is the same resolver.
 *  Defaulted so the component still renders if it is ever mounted outside App. */
const tr = inject<(key: string, fallback: string, named?: Record<string, unknown>) => string>(
  "tr",
  (_key, fallback) => fallback,
);

const isAdmin = computed(() => props.user?.role === "administrator");
const fail = (e: unknown) => emit("notify", e instanceof Error ? e.message : String(e), "error");

// ---- side tabs --------------------------------------------------------------
const TABS = [
  { key: "", label: "Game Server" },
  { key: "assets", label: "Asset Cache" },
  { key: "prices", label: "Prices" },
  { key: "models", label: "3D Models" },
  { key: "tests", label: "Skin Tests" },
  { key: "dev", label: "Developer" },
] as const;
const activeKey = computed(() => {
  const s = props.section ?? "";
  return TABS.some((t) => t.key === s) ? s : "";
});
const activeIndex = computed(() => TABS.findIndex((t) => t.key === activeKey.value));

// ---- shared -----------------------------------------------------------------
const copied = ref<string | null>(null);
async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text);
  copied.value = what;
  setTimeout(() => (copied.value = copied.value === what ? null : copied.value), 1600);
}

// ---- game server: key + configs ---------------------------------------------
const serverApiKey = ref<string | null>(null);
const keyBusy = ref(false);
const cfgMissing = ref<string[] | null>(null);
function applyCfgSync(cfg: CfgSyncResult | null) {
  emit("cfg-sync", cfg);
  if (!cfg) return;
  cfgMissing.value = cfg.failed;
  if (cfg.updated.length) {
    emit("notify", `invsim commands updated in: ${cfg.updated.join(", ")}.`, "success");
  }
}
async function loadKey() {
  try {
    const res = await fetchServerApiKey();
    serverApiKey.value = res.key;
    applyCfgSync(res.cfg);
  } catch (e) {
    fail(e);
  }
}
async function rotateKey() {
  if (keyBusy.value) return;
  keyBusy.value = true;
  try {
    const res = await generateServerApiKey();
    serverApiKey.value = res.key;
    applyCfgSync(res.cfg);
    emit("notify", tr("inventory.admin.server.key_reissued", "New server key issued — the old key is now dead."), "success");
  } catch (e) {
    fail(e);
  } finally {
    keyBusy.value = false;
  }
}
const invsimSnippet = computed(() =>
  [
    `invsim_url "${API_ORIGIN}"`,
    `invsim_apikey "${serverApiKey.value ?? "<generate a key first>"}"`,
    "invsim_ws_enabled 1",
    "invsim_ws_immediately 1",
    "invsim_require_inventory 1",
    "invsim_spraychanger_enabled 1",
  ].join("\n"),
);

// ---- extraction run time ----------------------------------------------------
const fmtDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);
// Shown only before this box has ever measured itself — once it has, "Last run"
// carries the real duration and this would just restate it. Any figure we put
// here would be a lie on somebody's hardware anyway: it swings with the worker
// count, the CPU and the disk, and one panel took half an hour.
const extractDurationHint =
  "Takes a long time — how long depends on the worker count and this machine's CPU and disk.";
// Two files record the same event and either can be the only survivor.
// `finishedAt` is the backend's — it exists only if this process was still
// around when the child exited, and a restart mid-run (pod bounce, `node
// --watch` reload) leaves the reparented script to finish without it. The
// stamp's `lastRunAt` is the script's own, so it's there whenever a duration
// is. Preferring `finishedAt` keeps a FAILED run (which stamps nothing) as the
// last run; falling back stops a completed run reading as "never · 7m 27s".
const lastRunAt = computed(() => extractStatus.value?.finishedAt ?? extractStatus.value?.lastRunAt ?? null);

// The two heaviest steps, which is the actionable part — a bare total tells you
// the run is long but not which stage to blame.
const slowestSteps = computed(() => {
  const steps = extractStatus.value?.lastRunSteps;
  if (!steps) return "";
  const top = Object.entries(steps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([, secs]) => secs > 0);
  return top.length ? `mostly ${top.map(([name, secs]) => `${name} ${fmtDuration(secs)}`).join(", ")}` : "";
});

// ---- asset cache ------------------------------------------------------------
const cacheStats = ref<CacheStats | null>(null);
const cacheBusy = ref(false);
const fmtBytes = (b: number) =>
  b > 1048576 * 900 ? `${(b / 1073741824).toFixed(2)} GB` : b > 900 ? `${(b / 1048576).toFixed(1)} MB` : `${b} B`;
// Exactly ONE row is a cache: card renders are client bakes of items the user
// owns, so binning one costs a re-render. Everything below it is extracted from
// this server's CS2 install with nothing upstream to re-fetch from — deleting
// those breaks rendering outright until someone re-extracts, which is why they
// are shown for confidence ("is the mount actually populated?") and have no
// clear button. "Mirrored paints" used to sit in the cache list and read as
// disposable; it was neither.
const cacheRows = computed(() => {
  const s = cacheStats.value;
  if (!s) return [];
  return [
    { key: "renders", label: "Card renders", hint: "Baked item cards — cleared safely, re-render on view", ...s.renders },
    {
      key: "composites",
      label: "Paint composites",
      hint: "Shared skin textures — lets every viewer skip ~38MB of inputs per weapon",
      ...(s.composites ?? { files: 0, bytes: 0 }),
    },
  ];
});
/**
 * The extracted mounts, broken down by what each part actually is.
 *
 * Three rows was not enough to answer the question an operator actually has,
 * which is "what is eating the disk". Both real answers were invisible: paint
 * TEXTURES are ~12 GB behind a row labelled "Paint materials" (the materials
 * themselves are 61 MB of JSON), and composite inputs are ~1.5 GB behind a row
 * labelled "3D models" (the GLBs are ~170 MB).
 *
 * `required` marks the parts whose absence BREAKS rendering, so a 0 there reads
 * as an error. The rest are legitimately empty on a mount extracted before they
 * existed — flagging those red would cry wolf on every older install.
 */
const PART_META: Record<string, { label: string; hint: string; required?: boolean }> = {
  meshes: { label: "Weapon, knife & glove models", hint: "The GLBs the viewer mounts", required: true },
  agents: { label: "Agent models", hint: "Character meshes, kept at their archive path" },
  charms: { label: "Charms", hint: "Keychain models and their textures" },
  compositeInputs: {
    label: "Composite inputs",
    hint: "Per-weapon paint sources — the compositor reads these, the viewer never does",
    required: true,
  },
  modelTextures: { label: "Model textures", hint: "The shared pool every GLB references", required: true },
  modelMeta: { label: "Anchors & markup", hint: "Attachment points, sticker slots, the version stamp" },
  paintMaterials: { label: "Finish definitions", hint: "One document per skin, naming its textures", required: true },
  paintTextures: { label: "Finish textures", hint: "Patterns, masks, sticker and decal art", required: true },
};
const ZERO = { files: 0, bytes: 0 };
const extractedGroups = computed(() => {
  const s = cacheStats.value;
  if (!s) return [];
  const parts = s.parts;
  const group = (key: string, label: string, hint: string, total: DirStat, partKeys: string[]) => {
    const rows = partKeys
      .map((k) => ({ key: k, ...PART_META[k], ...(parts?.[k as keyof typeof parts] ?? ZERO) }))
      // A part with nothing in it is only worth a row when its absence MEANS
      // something. Otherwise an older mount grows empty rows for every type it
      // predates, which reads as breakage rather than as history.
      .filter((r) => r.files > 0 || r.required);
    return { key, label, hint, total, rows, share: (b: number) => (total.bytes ? b / total.bytes : 0) };
  };
  return [
    group(
      "models",
      "3D models mount",
      "Meshes, their textures, and the compositor's inputs",
      s.models ?? ZERO,
      ["meshes", "agents", "charms", "compositeInputs", "modelTextures", "modelMeta"],
    ),
    group("paints", "Paint chain", "Every skin finish — without these, skins render white", s.paints, [
      "paintMaterials",
      "paintTextures",
    ]),
    group("images", "Item icons", "Flat catalog art for every item", s.images ?? ZERO, []),
  ];
});
// ---- shared asset CDN (opt-in) ----------------------------------------------
const flagOn = (name: string) => {
  void flagsVersion.value;
  return flagValue(name);
};
const activeFlagCount = computed(() => {
  void flagsVersion.value;
  return activeFlags().length;
});
const toggleFlag = (name: string) => setFlag(name, !flagValue(name));
const assetCdn = ref<AssetCdnStatus | null>(null);
const assetCdnBusy = ref(false);
async function refreshAssetCdn() {
  try {
    assetCdn.value = await fetchAssetCdn();
  } catch {
    assetCdn.value = null; // older backend — the row just doesn't render
  }
}
async function toggleAssetCdn(enabled: boolean) {
  if (assetCdnBusy.value) return;
  assetCdnBusy.value = true;
  try {
    await setAssetCdn(enabled);
    await refreshAssetCdn();
    emit(
      "notify",
      enabled
        ? "Asset CDN enabled — reload for clients to start fetching from it."
        : "Asset CDN disabled — assets come from this server again.",
      "success",
    );
  } catch (e) {
    fail(e);
  } finally {
    assetCdnBusy.value = false;
  }
}

async function refreshCacheStats() {
  try {
    cacheStats.value = await fetchCacheStats();
  } catch {
    cacheStats.value = null;
  }
}
async function doClearCache(scope: "renders" | "composites" = "renders") {
  if (cacheBusy.value) return;
  cacheBusy.value = true;
  try {
    await clearCache(scope);
    emit("cache-cleared", scope);
    emit(
      "notify",
      scope === "composites"
        ? tr("inventory.admin.cache.cleared_composites", "Cleared paint composites — each skin re-composites once, then is shared again.")
        : tr("inventory.admin.cache.cleared_renders", "Cleared card renders — each one re-bakes when it is next viewed."),
      "success",
    );
    await refreshCacheStats();
  } catch (e) {
    fail(e);
  } finally {
    cacheBusy.value = false;
  }
}

// ---- 3D extraction ----------------------------------------------------------
const extractStatus = ref<ExtractStatus | null>(null);
const extractBusy = ref(false);
let extractPoll: ReturnType<typeof setInterval> | null = null;
const extractLive = computed(() => extractStatus.value?.state === "running");
function stopPoll() {
  if (extractPoll) clearInterval(extractPoll);
  extractPoll = null;
}
async function refreshExtractStatus() {
  const wasLive = extractLive.value;
  try {
    const next = await fetchExtractStatus();
    // A poll every 5s racing a debounced edit would yank the worker count back
    // to the server's older value while someone is still clicking. The pending
    // number wins until its write lands.
    if (pendingJobs.value != null && next.workers) next.workers = { ...next.workers, jobs: pendingJobs.value };
    extractStatus.value = next;
    const s = extractStatus.value;
    emit("extract-stale", s.stale !== true ? null : s.extracted === false ? "missing" : "stale");
  } catch {
    extractStatus.value = null; // older backend — the section says so
  }
  if (extractLive.value && !extractPoll) {
    extractPoll = setInterval(pollTick, 5000);
  } else if (!extractLive.value && extractPoll) {
    stopPoll();
    if (wasLive && extractStatus.value?.state === "succeeded") {
      emit("notify", tr("inventory.admin.extract.finished", "Model extraction finished — 3D assets are live on the mount."), "success");
    }
  }
}
// One tick of the live poll. Status every 5s; the on-disk ledger every third
// tick, because it is far more expensive than it looks — the backend walks and
// stats EVERY file under models + paints + images (~45k once populated), and
// doing that every 5 seconds would have the panel competing with the extraction
// for the same disk. 15s is still visibly "growing" for a run this long.
let cacheTick = 0;
async function pollTick() {
  await refreshExtractStatus();
  if (cacheTick++ % 3 === 0) await refreshCacheStats();
}

// Presentation of the run state, hoisted out of the template: three ternary
// chains inline made the markup unreadable and kept drifting apart.
const extractDot = computed(() => {
  const s = extractStatus.value?.state;
  if (extractLive.value) return "animate-pulse bg-[hsl(var(--tac-amber))]";
  if (s === "succeeded") return "bg-emerald-400";
  if (s === "failed" || s === "interrupted") return "bg-destructive";
  return "bg-muted-foreground/50";
});
const extractStateLabel = computed(() =>
  extractStatus.value?.state === "idle" ? "never run" : (extractStatus.value?.state ?? ""),
);
// Drives the dot on the "3D Models" side tab, so the tab you aren't looking at
// can still say it wants something. Version numbers themselves live only in the
// callout — stating them a second time in the ledger just made two quiet lines.
const modelsNeedWork = computed(() => extractStatus.value?.stale === true);
// Elapsed time for a live run. The status only polls every 5s, so the clock
// ticks locally off startedAt — a multi-minute job with a spinner and nothing
// else looks identical to a hung one, and this is the cheapest way to tell
// them apart without the backend reporting progress it doesn't know.
const nowTick = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
watch(extractLive, (live) => {
  if (live && !clockTimer) {
    nowTick.value = Date.now();
    clockTimer = setInterval(() => (nowTick.value = Date.now()), 1000);
  } else if (!live && clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
});
// Live progress from the running script. Unit counts where a step knows them
// (icons, paint textures), otherwise "step 4 of 7" — a bar that only ever moved
// seven times told you almost nothing during a 20-minute icon pass.
// The script's step ids are kebab-case internals. Nobody reading a progress
// list wants to decode "composite-inputs" — say what is happening. Unknown ids
// fall through to the raw name so a new step never renders as a blank row.
const STEP_LABELS: Record<string, string> = {
  // "weapon models" was accurate until the same step started decompiling agents
  // and gloves out of agents/models/ — which is most of its new runtime, so a
  // label that only mentions weapons reads as a hang rather than as progress.
  "decompile-models": "Decompiling weapons, agents & gloves",
  "rename-models": "Mapping models to catalog keys",
  "model-textures": "Compressing model textures",
  "composite-inputs": "Extracting composite inputs",
  "charm-anchors": "Reading charm anchors",
  "sticker-markup": "Reading sticker slots",
  // Was missing entirely, so this row rendered as the raw kebab id.
  "charm-models": "Reading charm & patch definitions",
  "econ-icons": "Extracting item icons",
  "paint-chain": "Extracting paint chain",
  "sticker-art": "Extracting sticker & decal art",
  stamp: "Recording the build",
};

const extractProgress = computed(() => {
  const rawSteps = extractStatus.value?.progress?.steps;
  if (!rawSteps?.length || !extractLive.value) return null;
  // ONE step reads as running at a time, whatever the file says.
  //
  // sticker-art is a sub-phase of paint-chain, not a step after it: the script
  // pulls the paint textures, then the sticker textures, then writes the paint
  // MATERIALS. So paint-chain is genuinely still in flight while sticker-art
  // runs, and the file honestly reports both — which the panel then drew as two
  // lit rows, reading as "the earlier one got stuck".
  //
  // The list is declared in execution order, so a later step running means every
  // earlier one has finished the work it reports. Collapse on that rather than
  // on any special knowledge of which pairs overlap, so a future sub-phase needs
  // no change here.
  const lastRunning = rawSteps.reduce((acc, s, i) => (s.state === "running" ? i : acc), -1);
  const steps = rawSteps.map((s, i) =>
    s.state === "running" && i < lastRunning
      ? // Keep its counts; it really did complete them. Only the STATE was
        // ambiguous, and `seconds` may be absent since the shell closes it later.
        { ...s, state: "done" as const }
      : s,
  );
  return steps.map((s, i) => ({
    ...s,
    label: tr(`inventory.admin.extract.steps.${s.name}`, STEP_LABELS[s.name] ?? s.name),
    last: i === steps.length - 1,
    // Only steps that report a unit count get a real percentage. A running step
    // without one is genuinely indeterminate — showing 0% would read as stuck.
    pct: s.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : null,
    // One metric per state, assembled HERE so the template can't recombine the
    // parts wrongly: a done step kept its last done/total and was rendering
    // "1m 24s · 85%", which claims it stopped short.
    // Split into two ranks rather than one run of four values separated by
    // dots. Everything at equal weight gave the eye nothing to land on, and the
    // percentage restated the bar sitting directly underneath it — so the
    // percentage is gone and the count leads.
    //   primary   17 / 41          what you scan for
    //   secondary 39s · ~55s left  elapsed, then remaining
    ...(() => {
      if (s.state === "done") {
        return { primary: s.seconds != null ? fmtDuration(s.seconds) : "", secondary: "" };
      }
      if (s.state !== "running") return { primary: "", secondary: "" };
      // nowTick drives the re-render.
      const elapsed = s.started ? Math.max(0, Math.floor(nowTick.value / 1000) - s.started) : null;
      const done = s.done ?? 0;
      // Linear extrapolation from THIS step's own rate — not a stored average
      // from a previous run, which would be wrong on a first run and after any
      // hardware or catalog change. Held back until a few units are done, or the
      // first tick prints a wild number and then walks it back, which reads as
      // less trustworthy than showing nothing.
      const eta =
        elapsed && s.total && done >= 5 && done < s.total
          ? Math.round((elapsed / done) * (s.total - done))
          : null;
      const time = [elapsed != null ? fmtDuration(elapsed) : "", eta != null ? `~${fmtDuration(eta)} left` : ""]
        .filter(Boolean)
        .join(" · ");
      // A step with no unit count has only its elapsed time, and that is the
      // whole signal that it is alive — so it gets the primary slot rather than
      // being dimmed into the secondary one.
      return s.total != null
        ? { primary: `${done.toLocaleString()} / ${s.total.toLocaleString()}`, secondary: time }
        : { primary: time, secondary: "" };
    })(),
  }));
});

const extractElapsed = computed(() => {
  const started = extractStatus.value?.startedAt;
  if (!started || !extractLive.value) return "";
  const secs = Math.max(0, Math.floor((nowTick.value - new Date(started).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
});

const logLineCount = computed(() => (extractStatus.value?.log ? extractStatus.value.log.split("\n").length : 0));
/** The download normally rides along in the log disclosure's header. This is
 *  the case where there is no tail to disclose but a log file still exists —
 *  after a backend restart the in-memory tail is empty while the file on the
 *  mount is the whole previous run, which is exactly when someone needs it.
 *  Also true on a backend too old to report status at all. */
const showLogFallback = computed(
  () => !extractStatus.value?.log && (!extractStatus.value || !!extractStatus.value.logBytes),
);

async function doStartExtract() {
  if (extractBusy.value) return;
  extractBusy.value = true;
  try {
    await startExtractJob();
    emit("notify", tr("inventory.admin.extract.started", "Extraction job started — expect it to run for a long while."), "success");
    await refreshExtractStatus();
  } catch (e) {
    fail(e);
  } finally {
    extractBusy.value = false;
  }
}

// ---- workers ----------------------------------------------------------------
// A memory dial. Each decompile worker peaks around 1.4 GB (measured — see the
// script's "Parallelism" note), which is why this defaults to 1 and why the
// projection below is stated in GB rather than as an abstract "parallelism"
// number: running this at core count is what OOM-killed people's machines.
const workersBusy = ref(false);
const workers = computed(() => extractStatus.value?.workers ?? null);
const fmtGb = (gb: number) => `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;

/** The memory picture as one model, so the bar and the sentence under it can
 *  never disagree.
 *
 *  Everything is measured against TOTAL, with what's already in use as the
 *  first band — an operator needs to see that the extraction stacks on top of
 *  a box that is already doing something, not into an empty machine. The
 *  projection is a RANGE for the same reason the backend reports one: a worker
 *  drawing the knife directory takes 0.5 GB and one drawing an AK takes 1.3, so
 *  a single number would be a guess dressed as a measurement. */
const memPlan = computed(() => {
  const w = workers.value;
  if (!w || !w.memTotalMb) return null;
  const total = w.memTotalMb;
  const available = w.memAvailableMb ?? null;
  const inUse = available == null ? null : Math.max(0, total - available);
  const min = (w.jobs * w.perWorkerMinMb) / 1024;
  const max = (w.jobs * w.perWorkerMaxMb) / 1024;
  const reserve = w.panelReserveMb / 1024;
  const totalGb = total / 1024;
  const inUseGb = inUse == null ? null : inUse / 1024;
  const availableGb = available == null ? null : available / 1024;
  // What the extraction may use before it is eating the panel's headroom.
  const budgetGb = availableGb == null ? null : Math.max(0, availableGb - reserve);
  const pct = (gb: number) => Math.max(0, Math.min(100, (gb / totalGb) * 100));
  return {
    totalGb,
    inUseGb,
    availableGb,
    reserveGb: reserve,
    minGb: min,
    maxGb: max,
    budgetGb,
    // Bar geometry, all as percentages of total.
    usedPct: inUseGb == null ? 0 : pct(inUseGb),
    // The projection starts where current usage ends and spans min..max.
    minPct: pct(min),
    rangePct: pct(max - min),
    // The reserve is the last slice of the track, so the projection visibly
    // runs INTO it when a setting is too greedy.
    reservePct: pct(reserve),
  };
});

/** Three states, because they are three different sentences. `over` = even the
 *  optimistic end doesn't fit; `tight` = the pessimistic end eats the panel's
 *  headroom. Measured against what is FREE, not total — free is what decides
 *  whether the kernel starts killing things. */
const workerRisk = computed<"none" | "tight" | "over">(() => {
  const p = memPlan.value;
  if (!p || p.budgetGb == null) return "none";
  if (p.minGb > p.budgetGb) return "over";
  if (p.maxGb > p.budgetGb) return "tight";
  return "none";
});

// The stepper moves LOCALLY on every click and the write is debounced behind
// it. Awaiting the round-trip per click meant a request in flight swallowed the
// next press — measured: five rapid clicks landed as three. A stepper that
// silently drops input reads as broken, and the fix is not a faster request, it
// is not making the pointer wait for one.
let jobsTimer: ReturnType<typeof setTimeout> | null = null;
/** Set while a debounced write is outstanding, so a status poll landing
 *  mid-edit can't stomp the number under the user's cursor with the server's
 *  older one. */
const pendingJobs = ref<number | null>(null);

function setWorkers(next: number) {
  const w = workers.value;
  if (!w) return;
  const jobs = Math.min(Math.max(1, next), w.cores);
  if (jobs === w.jobs) return;
  const from = pendingJobs.value ?? w.jobs;
  // Optimistic: the bar, the projection and the warnings all recompute off
  // this, so the whole control answers the click immediately.
  pendingJobs.value = jobs;
  if (extractStatus.value) extractStatus.value = { ...extractStatus.value, workers: { ...w, jobs } };
  if (jobsTimer) clearTimeout(jobsTimer);
  jobsTimer = setTimeout(() => void commitWorkers(jobs, from), 350);
}

async function commitWorkers(jobs: number, from: number) {
  workersBusy.value = true;
  try {
    const res = await setExtractJobs(jobs);
    if (extractStatus.value) extractStatus.value = { ...extractStatus.value, workers: res.workers };
    // Worth saying out loud when a run is live: the change is not queued for
    // next time, it lands on the run you are watching.
    if (extractLive.value) {
      emit(
        "notify",
        jobs > from
          ? `Now ${jobs} workers — the run in progress will spin up more within a few seconds.`
          : `Now ${jobs} workers — the run in progress winds down to that as models finish.`,
        "success",
      );
    }
  } catch (e) {
    fail(e);
    // The optimistic number was never persisted — put the truth back rather
    // than leaving the panel claiming a setting the backend rejected.
    await refreshExtractStatus();
  } finally {
    pendingJobs.value = null;
    workersBusy.value = false;
  }
}

// Each tab fetches what it shows, when you land on it — so nothing polls for a
// section that isn't on screen.
// Declared ABOVE the activeKey watcher on purpose. That watcher is
// `{ immediate: true }`, so on a direct load of /admin/prices its callback runs
// synchronously during setup and calls refreshPrices() — which reads these refs.
// Sitting below it, the consts were still in their temporal dead zone and the
// whole console died on load with a minified "cannot access before
// initialization". Every other tab's state already lives up here; this is not a
// special case, it was the odd one out.
// ---- prices: the market feed -------------------------------------------------
// Off by default. Two settings, deliberately separate: WHETHER to mirror a price
// feed, and WHICH one. The second exists because the default is a 5stack host —
// fine as a default, wrong as an obligation — and an operator who would rather
// mirror the public source themselves needs somewhere to say so.
const prices = ref<PriceAdminStatus | null>(null);
const pricesBusy = ref(false);
const priceSyncBusy = ref(false);
// The field is a DRAFT until saved: typing a URL must not start hourly fetches
// at half a hostname. Re-seeded from the server on every refresh, except while
// the operator is mid-edit.
const feedDraft = ref("");
const feedDirty = ref(false);

async function refreshPrices(seedDraft = true) {
  if (!isAdmin.value) return;
  try {
    prices.value = await fetchPriceAdmin();
    if (seedDraft && !feedDirty.value) feedDraft.value = prices.value.custom ? prices.value.base : "";
  } catch (e) {
    fail(e);
  }
}

async function togglePrices(enabled: boolean) {
  if (pricesBusy.value) return;
  pricesBusy.value = true;
  try {
    await savePriceAdmin({ enabled });
    // Enabling kicks off a first sync server-side when the mirror is empty, so
    // the panel would otherwise sit on "0 listings" until the top of the hour.
    await refreshPrices();
    emit("notify", enabled ? "Price feed enabled." : "Price feed disabled.", "success");
    if (enabled) void pollPricesUntilSynced();
  } catch (e) {
    fail(e);
  } finally {
    pricesBusy.value = false;
  }
}

/** Switching source empties the table server-side — a market's reference price
 *  and a feed's 7-day average live in different columns, so the old rows would
 *  resolve to nothing rather than to something wrong. Re-sync immediately so the
 *  operator never sees the empty middle. */
async function setPriceSource(source: PriceSource) {
  if (pricesBusy.value || prices.value?.source === source) return;
  pricesBusy.value = true;
  try {
    await savePriceAdmin({ source });
    await refreshPrices();
    if (prices.value?.enabled) void doSyncPrices();
  } catch (e) {
    fail(e);
  } finally {
    pricesBusy.value = false;
  }
}

async function saveFeedUrl() {
  if (pricesBusy.value) return;
  pricesBusy.value = true;
  try {
    await savePriceAdmin({ base: feedDraft.value.trim() });
    feedDirty.value = false;
    await refreshPrices();
    emit("notify", "Feed URL saved. Sync now to test it.", "success");
  } catch (e) {
    fail(e);
  } finally {
    pricesBusy.value = false;
  }
}

async function doSyncPrices() {
  if (priceSyncBusy.value) return;
  priceSyncBusy.value = true;
  try {
    const result = await syncPricesNow();
    await refreshPrices();
    emit("notify", `Mirrored ${result.rows.toLocaleString()} listings (${result.unmatched.toLocaleString()} unmatched).`, "success");
  } catch (e) {
    // The failure text is the whole diagnostic — an HTTP status, a JSON parse
    // error or "mapped to zero rows" each point somewhere completely different.
    fail(e);
    await refreshPrices();
  } finally {
    priceSyncBusy.value = false;
  }
}

async function doClearPrices() {
  if (pricesBusy.value) return;
  pricesBusy.value = true;
  try {
    await clearPrices();
    await refreshPrices();
    emit("notify", "Mirrored prices deleted.", "success");
  } catch (e) {
    fail(e);
  } finally {
    pricesBusy.value = false;
  }
}

/** The first sync after enabling runs in the background — watch it land rather
 *  than leaving the operator to guess whether it worked. */
async function pollPricesUntilSynced() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    await refreshPrices();
    if (!prices.value?.syncing && (prices.value?.listings || prices.value?.failedAt)) return;
  }
}

const priceAge = computed(() => {
  const at = prices.value?.syncedAt;
  if (!at) return null;
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
});


watch(
  activeKey,
  (key) => {
    if (!isAdmin.value) return;
    if (key === "") loadKey();
    else if (key === "assets") {
      refreshCacheStats();
      refreshAssetCdn();
      // Also needed here to learn whether a run is live: the asset counts climb
      // during an extraction, and this tab is where you watch them.
      refreshExtractStatus();
    } else if (key === "models") {
      refreshExtractStatus();
      refreshCacheStats(); // for the on-disk size of what's already extracted
    } else if (key === "prices") {
      refreshPrices();
    }
    if (key !== "models" && key !== "assets") stopPoll();
  },
  { immediate: true },
);
// The tab dot has to be right before you visit the tab it's on, so the status
// is fetched once on mount too — the per-tab watch above only covers the case
// where you're already standing on /admin/models.
onMounted(() => {
  if (isAdmin.value && activeKey.value !== "models") refreshExtractStatus();
});
onBeforeUnmount(() => {
  stopPoll();
  if (clockTimer) clearInterval(clockTimer);
});

// Class strings lifted from the panel's settings components, so this tracks the
// same look: Card, SettingsSection's amber rule, SettingsSideTabs' ghost items.
const CARD = "rounded-xl border border-border bg-card text-card-foreground shadow";
const RULE = "w-0.5 self-stretch rounded-full bg-[hsl(var(--tac-amber))] shadow-[0_0_8px_hsl(var(--tac-amber)/0.45)]";
const BTN =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:border-[hsl(var(--tac-amber))] hover:text-foreground disabled:pointer-events-none disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-2 rounded-md bg-[hsl(var(--tac-amber))] px-4 text-sm font-medium text-black shadow-sm transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-50";
const BTN_DANGER =
  "inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:pointer-events-none disabled:opacity-50";
</script>

<template>
  <div class="h-full min-w-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
    <!-- Page header, in the panel's tactical style -->
    <header
      class="relative overflow-hidden rounded-lg border border-border bg-[linear-gradient(180deg,hsl(var(--card)/0.55)_0%,hsl(var(--card)/0.25)_100%)] px-4 py-4 sm:px-6 sm:py-5 [backdrop-filter:blur(6px)]"
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-2 top-2 h-[14px] w-[14px] border-l-2 border-t-2 border-[hsl(var(--tac-amber))]"
      ></span>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute bottom-2 right-2 h-[14px] w-[14px] border-b-2 border-r-2 border-[hsl(var(--tac-amber))]"
      ></span>

      <div class="flex min-w-0 flex-col gap-[0.35rem]">
        <span class="inline-flex items-center gap-2 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          <span class="translate-y-[-1px] text-[0.7rem] text-[hsl(var(--tac-amber))]">◢</span>
          Inventory
        </span>
        <h1 class="truncate text-xl font-semibold tracking-tight">Plugin Settings</h1>
        <p class="text-sm text-muted-foreground">
          Game-server integration, cached assets and 3D model extraction.
        </p>
      </div>
    </header>

    <div v-if="!isAdmin" :class="[CARD, 'mt-6 flex flex-col items-center gap-3 p-10 text-center']">
      <ShieldAlert class="h-6 w-6 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">This section is restricted to panel administrators.</p>
      <button :class="BTN" @click="emit('back')">Back to loadout</button>
    </div>

    <div v-else class="mt-6 flex flex-col gap-6 lg:flex-row lg:gap-6">
      <!-- Side tabs — real routes, like the panel's settings nav -->
      <aside class="w-full shrink-0 lg:w-auto">
        <nav
          aria-label="Inventory plugin settings"
          class="relative flex min-w-0 flex-row gap-1 overflow-x-auto border-b border-border/70 pb-2 lg:min-w-[12rem] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-2"
        >
          <div
            aria-hidden="true"
            class="pointer-events-none absolute right-[-1px] top-0 z-10 hidden h-9 w-0.5 rounded-full bg-[hsl(var(--tac-amber))] shadow-[0_0_8px_hsl(var(--tac-amber)/0.45)] lg:block [transition:transform_0.35s_cubic-bezier(0.34,1.56,0.64,1)]"
            :style="{ transform: `translateY(${activeIndex * 2.5}rem)` }"
          ></div>
          <button
            v-for="tab in TABS"
            :key="tab.key"
            class="relative z-[1] h-9 flex-none whitespace-nowrap rounded-sm px-3 text-left text-sm transition-colors duration-200 hover:bg-[hsl(var(--tac-amber)/0.08)] hover:text-foreground lg:w-full"
            :class="
              tab.key === activeKey
                ? 'bg-[hsl(var(--tac-amber)/0.06)] text-foreground'
                : 'text-muted-foreground'
            "
            :aria-current="tab.key === activeKey ? 'page' : undefined"
            @click="emit('navigate', tab.key)"
          >
            {{ tab.label }}
            <!-- Same amber dot as the gear badge, one level down: the gear says
                 "something in settings", this says which tab. Only shown when
                 there's an action to take — a permanent green "all good" dot on
                 every tab would be noise you'd learn to stop seeing. -->
            <span
              v-if="tab.key === 'models' && modelsNeedWork"
              class="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle bg-[hsl(var(--tac-amber))] shadow-[0_0_6px_hsl(var(--tac-amber)/0.6)]"
              :title="extractStatus?.extracted === false ? 'Extraction has never been run' : 'Extraction is out of date'"
            ></span>
          </button>
        </nav>
      </aside>

      <!-- Section swap, matching the panel's PageTransition: same easing, same
           rise. Keyed on the tab so switching tabs animates, but re-renders
           within a tab (a poll landing, a key rotating) don't. -->
      <Transition
        mode="out-in"
        enter-active-class="transition-[opacity,transform] [transition-duration:420ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] motion-reduce:![transition-duration:1ms]"
        leave-active-class="transition-[opacity,transform] [transition-duration:140ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] motion-reduce:![transition-duration:1ms]"
        enter-from-class="opacity-0 translate-y-5 motion-reduce:translate-y-0"
        leave-to-class="opacity-0 -translate-y-5 motion-reduce:translate-y-0"
      >
      <div :key="activeKey" class="min-w-0 flex-1 space-y-6">
        <!-- Game Server -->
        <template v-if="activeKey === ''">
          <section :class="CARD">
            <div class="space-y-6 p-6">
              <div class="flex items-start gap-3">
                <span :class="RULE" />
                <div class="min-w-0 flex-1 space-y-0.5">
                  <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Server key</h3>
                  <p class="text-sm text-muted-foreground">
                    Game servers authenticate StatTrak kill reports with this key as
                    <code class="rounded bg-secondary px-1 py-0.5 font-mono text-xs">invsim_apikey</code>.
                  </p>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center gap-2">
                  <code class="min-w-0 flex-1 truncate rounded-md border border-input bg-background px-3 py-2 font-mono text-xs">
                    {{ serverApiKey ?? "— no key generated yet —" }}
                  </code>
                  <button v-if="serverApiKey" :class="[BTN, 'w-9 px-0']" title="Copy key" @click="copy(serverApiKey, 'key')">
                    <Check v-if="copied === 'key'" class="h-3.5 w-3.5 text-[hsl(var(--tac-amber))]" />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button :class="BTN_PRIMARY" :disabled="keyBusy" @click="rotateKey">
                    <Loader2 v-if="keyBusy" class="h-3.5 w-3.5 animate-spin" />
                    <KeyRound v-else class="h-3.5 w-3.5" />
                    {{ serverApiKey ? "Generate new key" : "Generate key" }}
                  </button>
                  <p class="min-w-[16rem] flex-1 text-xs text-muted-foreground">
                    Rotating invalidates the current key immediately. Game type configs are rewritten
                    automatically; servers configured by hand need the new key pasted in.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section :class="CARD">
            <div class="space-y-6 p-6">
              <div class="flex items-start gap-3">
                <span :class="RULE" />
                <div class="min-w-0 flex-1 space-y-0.5">
                  <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Game configs</h3>
                  <p class="text-sm text-muted-foreground">
                    Kept at the very top of your Lan, Competitive, Wingman and Duel configs, so they run
                    before anything else.
                  </p>
                </div>
                <div class="shrink-0 pl-4">
                  <button :class="[BTN, 'w-9 px-0']" title="Copy lines" @click="copy(invsimSnippet, 'cfg')">
                    <Check v-if="copied === 'cfg'" class="h-3.5 w-3.5 text-[hsl(var(--tac-amber))]" />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <pre class="overflow-x-auto rounded-md border border-input bg-background px-3 py-2.5 font-mono text-xs text-muted-foreground">{{ invsimSnippet }}</pre>

              <div
                v-if="cfgMissing && cfgMissing.length"
                class="rounded-md border border-[hsl(var(--tac-amber)/0.4)] bg-[hsl(var(--tac-amber)/0.08)] px-3 py-2.5 text-sm"
              >
                <template v-if="!serverApiKey">
                  Generate a key above — it lands at the top of your game configs automatically.
                </template>
                <template v-else>
                  Couldn't write configs for <b>{{ cfgMissing.join(", ") }}</b> — check the plugin backend
                  logs, or paste the lines above at the very top yourself.
                </template>
              </div>
              <p v-else-if="cfgMissing" class="flex items-center gap-2 text-sm text-muted-foreground">
                <Check class="h-3.5 w-3.5 text-[hsl(var(--tac-amber))]" />
                All game configs carry the invsim commands at the top.
              </p>
            </div>
          </section>
        </template>

        <!-- Asset Cache -->
        <section v-else-if="activeKey === 'assets'" :class="CARD">
          <div class="space-y-6 p-6">
            <div class="flex items-start gap-3">
              <span :class="RULE" />
              <div class="min-w-0 flex-1 space-y-0.5">
                <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Assets on disk</h3>
                <p class="text-sm text-muted-foreground">
                  What this server has generated or extracted onto the models mount.
                </p>
              </div>
            </div>

            <template v-if="cacheStats">
              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cache</p>
                <div class="divide-y divide-border rounded-md border border-border">
                  <div
                    v-for="row in cacheRows"
                    :key="row.key"
                    class="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <span class="min-w-0">
                      <span class="block text-sm text-foreground">{{ row.label }}</span>
                      <span class="block text-xs text-muted-foreground">{{ row.hint }}</span>
                    </span>
                    <span class="whitespace-nowrap font-mono text-sm">
                      {{ row.files.toLocaleString() }} files
                      <span class="text-muted-foreground">·</span>
                      {{ fmtBytes(row.bytes) }}
                    </span>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache('renders')">
                    <Loader2 v-if="cacheBusy" class="h-3.5 w-3.5 animate-spin" /><Trash2 v-else class="h-3.5 w-3.5" />
                    Clear renders
                  </button>
                  <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache('composites')">
                    <Loader2 v-if="cacheBusy" class="h-3.5 w-3.5 animate-spin" /><Trash2 v-else class="h-3.5 w-3.5" />
                    Clear composites
                  </button>
                </div>
                <p class="text-xs text-muted-foreground">
                  Clearing forces every card to re-bake — the go-to move after a rendering fix, so stale
                  bakes can't hide it. Composites normally look after themselves (a shader change gives
                  them a new generation, and the oldest are trimmed to stay under the size cap), so
                  clearing them is only for reclaiming disk now rather than later.
                </p>
              </div>

              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Extracted from this server's CS2 install
                </p>
                <div class="divide-y divide-border rounded-md border border-border">
                  <div v-for="g in extractedGroups" :key="g.key">
                    <div class="flex items-center justify-between gap-4 px-4 py-3">
                      <span class="min-w-0">
                        <span class="block text-sm font-medium text-foreground">{{ g.label }}</span>
                        <span class="block text-xs text-muted-foreground">{{ g.hint }}</span>
                      </span>
                      <span class="whitespace-nowrap font-mono text-sm">
                        <span :class="g.total.files ? '' : 'text-destructive'">
                          {{ g.total.files.toLocaleString() }} files
                        </span>
                        <span class="text-muted-foreground">·</span>
                        {{ fmtBytes(g.total.bytes) }}
                      </span>
                    </div>
                    <!-- Breakdown. The bar is proportion WITHIN the group, which is
                         the comparison that answers "what is eating this mount" —
                         against the grand total every model row would be a sliver
                         next to the paint textures. -->
                    <div v-if="g.rows.length" class="space-y-1.5 border-t border-border/50 bg-muted/20 px-4 py-2.5">
                      <div v-for="row in g.rows" :key="row.key" class="space-y-1">
                        <div class="flex items-baseline justify-between gap-4">
                          <span class="min-w-0 text-xs text-muted-foreground">
                            {{ row.label }}
                            <span class="hidden sm:inline opacity-70">— {{ row.hint }}</span>
                          </span>
                          <span class="whitespace-nowrap font-mono text-xs">
                            <span :class="row.files || !row.required ? 'text-muted-foreground' : 'text-destructive'">
                              {{ row.files.toLocaleString() }}
                            </span>
                            <span class="text-muted-foreground/60">·</span>
                            {{ fmtBytes(row.bytes) }}
                          </span>
                        </div>
                        <div class="h-1 overflow-hidden rounded-full bg-border">
                          <div
                            class="h-full rounded-full bg-foreground/30"
                            :style="{ width: `${Math.max(g.share(row.bytes) * 100, row.bytes ? 1 : 0)}%` }"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p class="text-xs text-muted-foreground">
                  These are not a cache and cannot be cleared here — nothing re-downloads them. If a row
                  reads 0, rendering is broken until the model extraction is re-run.
                </p>
              </div>
            </template>
            <p v-else class="text-sm text-muted-foreground">
              Asset stats unavailable — older backend, or the mount is missing.
            </p>

            <!-- Shared CDN opt-in. Off by default and deliberately explicit:
                 the whole reason the third-party CDN was removed is that assets
                 were arriving from a host nobody had chosen. A 5stack-run CDN is
                 fine; inheriting it silently is not. -->
            <div v-if="assetCdn" class="space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Asset source</p>
              <div class="rounded-md border border-border">
                <div class="flex items-start justify-between gap-4 px-4 py-3">
                  <span class="min-w-0">
                    <span class="block text-sm text-foreground">Use the 5stack asset CDN</span>
                    <span class="block text-xs text-muted-foreground">
                      Serve item art, paints and models from
                      <span class="font-mono">{{ assetCdn.base }}</span> instead of this server. Extraction output is
                      identical for a given pipeline and CS2 build, so this is the same data — it just saves running the
                      extraction at all.
                    </span>
                  </span>
                  <button
                    :class="BTN"
                    :disabled="assetCdnBusy || (!assetCdn.enabled && assetCdn.available === false)"
                    :title="
                      !assetCdn.enabled && assetCdn.available === false
                        ? 'The CDN has no assets published for this pipeline + CS2 build yet'
                        : undefined
                    "
                    @click="toggleAssetCdn(!assetCdn.enabled)"
                  >
                    <Loader2 v-if="assetCdnBusy" class="h-3.5 w-3.5 animate-spin" />
                    {{ assetCdn.enabled ? "Disable" : "Enable" }}
                  </button>
                </div>
                <!-- Say whether it can actually serve THIS build before someone
                     flips it on and finds every skin missing. -->
                <div class="border-t border-border px-4 py-2.5 text-xs">
                  <!-- Loudest case first: assets are coming from the CDN right
                       now even though nobody switched it on. Never leave that
                       implicit — an unexplained asset source is the exact
                       problem removing the third-party CDN was about. -->
                  <span v-if="assetCdn.usingFallback" class="text-[hsl(var(--tac-amber))]">
                    Currently serving from the CDN as a fallback — nothing has been extracted on this server yet.
                    Run the extraction and it switches back automatically.
                  </span>
                  <span v-else-if="!assetCdn.origin" class="text-muted-foreground">
                    The CDN is not reachable or has nothing published.
                  </span>
                  <span v-else-if="assetCdn.available === true" class="text-[hsl(var(--tac-value))]">
                    ✓ Serving <span class="font-mono">v{{ assetCdn.extractVersion }}-{{ assetCdn.gameBuild }}</span> —
                    <template v-if="assetCdn.buildUnknown">pipeline matches; no CS2 install here to verify the build against.</template>
                    <template v-else-if="assetCdn.projected">matches what this server would extract.</template>
                    <template v-else>same pipeline and CS2 build as this server.</template>
                  </span>
                  <span v-else-if="assetCdn.available === false" class="text-[hsl(var(--tac-amber))]">
                    Build mismatch — this server is
                    <span class="font-mono">v{{ assetCdn.extractVersion }}-{{ assetCdn.gameBuild }}</span>, the CDN has
                    <span class="font-mono">{{
                      assetCdn.cdnVersion != null ? "v" + assetCdn.cdnVersion + "-" + assetCdn.cdnGameBuild : "nothing"
                    }}</span>. Assets would be for a different build, so this stays on the local extraction.
                  </span>
                  <span v-else class="text-muted-foreground">Could not reach the CDN to check.</span>
                </div>
              </div>
              <p v-if="assetCdn.enabled" class="text-xs text-muted-foreground">
                This server's own extracted files stay on disk and are used again the moment this is turned off.
              </p>
            </div>
          </div>
        </section>

        <!-- Prices. A mirrored Steam market feed — what an item is worth, next
             to the item. Its own tab rather than a row under Asset Cache: it is
             the one setting here that changes what PLAYERS see, and burying it
             with the disk-usage tooling is how a switch stays undiscovered. -->
        <section v-else-if="activeKey === 'prices'" :class="CARD">
          <div class="space-y-6 p-6">
            <div class="flex items-start gap-3">
              <span :class="RULE" />
              <div class="min-w-0 flex-1 space-y-0.5">
                <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Market prices</h3>
                <p class="text-sm text-muted-foreground">
                  Mirror a Steam market price feed so items show what they're worth — real inventory value, and
                  what a craft would cost to buy for real.
                </p>
              </div>
            </div>

            <template v-if="prices">
              <!-- The switch. Off by default and explicit for the same reason as
                   the asset CDN: enabling it makes this server fetch from a host
                   outside the operator's network, once an hour. -->
              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price feed</p>
                <div class="rounded-md border border-border">
                  <div class="flex items-start justify-between gap-4 px-4 py-3">
                    <span class="min-w-0">
                      <span class="block text-sm text-foreground">Mirror market prices</span>
                      <span class="block text-xs text-muted-foreground">
                        This server fetches
                        <span class="font-mono break-all">{{ prices.url }}</span>
                        every {{ prices.intervalMinutes }} minutes and stores it locally. Players' browsers never talk
                        to {{ PRICE_SOURCE_LABEL[prices.source] }} — prices reach the UI through this API.
                      </span>
                    </span>
                    <button :class="BTN" :disabled="pricesBusy" @click="togglePrices(!prices.enabled)">
                      <Loader2 v-if="pricesBusy" class="h-3.5 w-3.5 animate-spin" />
                      {{ prices.enabled ? "Disable" : "Enable" }}
                    </button>
                  </div>
                  <!-- Three states that look identical from a blank price column
                       and have completely different fixes: never ran, ran and
                       failed, ran fine. Never make an operator guess which. -->
                  <div class="border-t border-border px-4 py-2.5 text-xs">
                    <span v-if="prices.failure" class="text-destructive">
                      Last sync failed{{ prices.failedAt ? ` (${new Date(prices.failedAt).toLocaleString()})` : "" }} —
                      <span class="font-mono">{{ prices.failure }}</span>
                      <template v-if="prices.listings">
                        . The {{ prices.listings.toLocaleString() }} listings already mirrored are still being served.
                      </template>
                      <!-- The fix for a provider being down is another provider,
                           and it is one click away. Say so at the point of
                           failure rather than leaving it to be discovered. -->
                      Pick a different source below if {{ PRICE_SOURCE_LABEL[prices.source] }} stays unreachable.
                    </span>
                    <span v-else-if="prices.syncing" class="text-[hsl(var(--tac-amber))]">
                      Syncing now — this takes a few seconds.
                    </span>
                    <!-- Louder than "synced fine", because it looks exactly like
                         success from here: rows in the table, a recent sync time,
                         and not a single price anywhere in the app. -->
                    <span v-else-if="prices.stale" class="text-[hsl(var(--tac-amber))]">
                      The {{ prices.listings.toLocaleString() }} mirrored rows came from a different source
                      <template v-if="prices.syncedSource">({{ PRICE_SOURCE_LABEL[prices.syncedSource] }})</template>
                      than the one selected now, so none of them can be read — each source stores its prices in its
                      own columns. Hit Sync now to replace them.
                    </span>
                    <span v-else-if="prices.listings" class="text-[hsl(var(--tac-value))]">
                      ✓ {{ prices.listings.toLocaleString() }} listings mirrored{{ priceAge ? ` — synced ${priceAge}` : "" }}
                      <template v-if="prices.sourceDate">
                        (source dated {{ new Date(prices.sourceDate).toLocaleDateString() }})
                      </template>
                      . Shown as the {{ PRICE_WINDOW_LABEL[prices.window].toLowerCase() }}.
                    </span>
                    <span v-else-if="prices.enabled" class="text-muted-foreground">
                      Enabled, nothing mirrored yet. The first sync runs on its own; "Sync now" doesn't wait for it.
                    </span>
                    <span v-else class="text-muted-foreground">
                      Off — no prices anywhere in the app, and nothing is fetched.
                    </span>
                  </div>
                </div>
              </div>

              <!-- Where the numbers come from. Every option is THIS server
                   pulling for itself; there is no 5stack price CDN, on purpose —
                   a number about someone's money should come from a source the
                   operator picked. -->
              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
                <div class="divide-y divide-border rounded-md border border-border">
                  <!-- Driven by the server's list, not a copy of it here: which
                       providers exist, and what each is good for, is a backend
                       fact. Adding one should not need a frontend release. -->
                  <button
                    v-for="option in prices.providers"
                    :key="option.id"
                    class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                    :disabled="pricesBusy"
                    @click="setPriceSource(option.id)"
                  >
                    <span
                      class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border"
                      :class="prices.source === option.id
                        ? 'border-[hsl(var(--tac-amber))] bg-[hsl(var(--tac-amber))]'
                        : 'border-input'"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-baseline gap-x-2">
                        <span class="text-sm text-foreground">{{ option.label }}</span>
                        <span class="text-f10 uppercase tracking-cs4 text-muted-foreground">
                          {{ PRICE_WINDOW_LABEL[option.window] }}
                        </span>
                        <span
                          v-if="prices.syncedSource === option.id && prices.listings"
                          class="text-f10 uppercase tracking-cs4 text-[hsl(var(--tac-value))]"
                        >
                          {{ prices.listings.toLocaleString() }} mirrored
                        </span>
                      </span>
                      <span class="block text-xs text-muted-foreground">{{ option.blurb }}</span>
                      <span v-if="option.url" class="block truncate font-mono text-f10 text-muted-foreground/70">
                        {{ option.url }}
                      </span>
                    </span>
                  </button>
                </div>
                <!-- The reason five exist. A provider going down should be a
                     setting change, not an outage — and they genuinely differ in
                     what they cover, so switching is also how you improve it. -->
                <p class="text-xs text-muted-foreground">
                  All five are switchable at any time — if one goes down or starts refusing requests, pick another and
                  hit Sync. They cover the catalog differently (sticker coverage in particular ranges from about half
                  to nearly all of it), and only some price Doppler phases separately, so it is worth trying a couple.
                </p>

                <!-- Say plainly why Steam is not on this list. It is the obvious
                     thing to reach for and it is measurably a trap. -->
                <p class="text-xs text-muted-foreground">
                  Steam's own market isn't offered: <span class="font-mono">priceoverview</span> 429s after about six
                  requests and stays blocked for minutes, and market search pins its page size to 10 — a full sweep is
                  ~3,500 requests, hours long, every day. It also shares an IP budget with the Steam inventory import
                  this app already depends on, so a crawler that gets throttled takes that down too.
                </p>
              </div>

              <!-- Only the JSON-feed source has a URL to set. Skinport's endpoint
                   is fixed, so showing an editable box for it would be a lie. -->
              <div v-if="prices.source === 'feed'" class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feed URL</p>
                <div class="space-y-2 rounded-md border border-border px-4 py-3">
                  <label class="block text-sm text-foreground" for="price-feed-url">Feed base URL</label>
                  <div class="flex flex-wrap items-center gap-2">
                    <input
                      id="price-feed-url"
                      v-model="feedDraft"
                      :placeholder="prices.defaultBase"
                      spellcheck="false"
                      autocomplete="off"
                      class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors focus:border-[hsl(var(--tac-amber))]"
                      @input="feedDirty = true"
                    />
                    <button :class="BTN" :disabled="pricesBusy || !feedDirty" @click="saveFeedUrl()">
                      <Loader2 v-if="pricesBusy" class="h-3.5 w-3.5 animate-spin" />
                      Save
                    </button>
                    <button
                      :class="BTN"
                      :disabled="pricesBusy || (!feedDraft && !prices.custom)"
                      @click="feedDraft = ''; feedDirty = true"
                    >
                      Reset to default
                    </button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Blank uses <span class="font-mono break-all">{{ prices.defaultBase }}</span>, the public
                    cs2-prices-tracker project. <code class="font-mono">/latest.json</code> is appended to whatever you
                    set, so point this at your own mirror if you'd rather not depend on someone else's repository.
                  </p>
                </div>
              </div>

              <!-- Sync + prune. "Sync now" ignores the switch: an operator asking
                   for a sync IS the opt-in, and it is how you test a URL before
                   committing to it. -->
              <div class="space-y-2">
                <div class="flex flex-wrap gap-2">
                  <button :class="BTN_PRIMARY" :disabled="priceSyncBusy" @click="doSyncPrices()">
                    <Loader2 v-if="priceSyncBusy" class="h-3.5 w-3.5 animate-spin" />
                    <RefreshCw v-else class="h-3.5 w-3.5" />
                    Sync now
                  </button>
                  <button :class="BTN_DANGER" :disabled="pricesBusy || !prices.listings" @click="doClearPrices()">
                    <Trash2 class="h-3.5 w-3.5" />
                    Delete mirrored prices
                  </button>
                </div>
                <p class="text-xs text-muted-foreground">
                  Syncing replaces the whole table in one transaction, so a failed fetch leaves the previous prices
                  exactly where they were. Testing a URL this way works with the switch off.
                </p>
              </div>

              <!-- Unmatched names. The early warning: it is small and boring
                   while the name -> catalog mapping works, and steps up the day
                   an upstream rename breaks it. Without it, a whole family
                   losing its prices looks exactly like a family that stopped
                   trading. -->
              <div v-if="prices.listings" class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coverage</p>
                <div class="divide-y divide-border rounded-md border border-border">
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <span class="min-w-0">
                      <span class="block text-sm text-foreground">Listings mirrored</span>
                      <span class="block text-xs text-muted-foreground">Name + wear + StatTrak + Souvenir, each priced separately.</span>
                    </span>
                    <span class="whitespace-nowrap font-mono text-sm">{{ prices.listings.toLocaleString() }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <span class="min-w-0">
                      <span class="block text-sm text-foreground">Unmatched names</span>
                      <span class="block text-xs text-muted-foreground">
                        Listings this catalog has no entry for — mostly viewer passes and event capsules. A few percent
                        is normal; a jump means the feed renamed something.
                      </span>
                    </span>
                    <span class="whitespace-nowrap font-mono text-sm">{{ prices.unmatched.toLocaleString() }}</span>
                  </div>
                </div>
                <!-- The sale-history cache. Its own row because the number it
                     protects is a RATE BUDGET: the source allows a handful of
                     calls per five minutes, so every listing already looked up is
                     one nobody has to spend a request on for a week. -->
                <div v-if="prices.history?.listings" class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
                  <span class="min-w-0">
                    <span class="block text-sm text-foreground">Sale history cached</span>
                    <span class="block text-xs text-muted-foreground">
                      {{ prices.history.withData.toLocaleString() }} with recent sales; the rest are recorded as having
                      none, so they aren't looked up again. Refreshed after
                      {{ prices.history.staleAfterDays }} days.
                    </span>
                  </span>
                  <span class="whitespace-nowrap font-mono text-sm">{{ prices.history.listings.toLocaleString() }}</span>
                </div>
                <details v-if="prices.unmatchedSample.length" class="rounded-md border border-border px-4 py-2.5">
                  <summary class="cursor-pointer text-xs text-muted-foreground">Sample of unmatched names</summary>
                  <ul class="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                    <li v-for="name in prices.unmatchedSample" :key="name">{{ name }}</li>
                  </ul>
                </details>
              </div>

              <!-- What the number is and is not. Cheaper to say here once than to
                   answer forever: these are Steam sale averages per wear bracket,
                   so they cannot know about float, pattern or Doppler phase. -->
              <div class="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-4 py-3">
                <CircleDollarSign class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p class="text-xs text-muted-foreground">
                  <span class="text-foreground">These are rough estimates, not sale prices.</span> Every number is a
                  whole-wear-bracket figure, so it can't account for float, pattern (blue gems, fades) or Doppler
                  phase — the market lists those under one name too. Applied stickers and charms are priced as
                  separate lines at their own market value, never folded into the weapon: applying a sticker destroys
                  its listing, and how much value survives is opinion, not data. Treat a total as a ballpark for
                  bragging rights, never as what an inventory would fetch.
                </p>
              </div>
            </template>
            <p v-else class="text-sm text-muted-foreground">
              Price status unavailable — older backend, or this server can't reach its database.
            </p>
          </div>
        </section>

        <!-- Skin Tests — renders every finish for a visual sweep. Its own
             component: the render loop + gallery is a lot of state that has no
             business entangled with the cache/extract logic here. -->
        <SkinTests
          v-else-if="activeKey === 'tests'"
          :is-admin="isAdmin"
          @notify="(m: string, k: 'error' | 'success') => emit('notify', m, k)"
        />

        <!-- Developer. Its own tab rather than a row buried in Asset Cache,
             which is where it started and where nobody found it — a switch you
             have to already know about is not a switch. -->
        <section v-else-if="activeKey === 'dev'" :class="CARD">
          <div class="space-y-6 p-6">
            <div class="flex items-start gap-3">
              <span :class="RULE" />
              <div class="min-w-0 flex-1 space-y-0.5">
                <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Developer tools</h3>
                <p class="text-sm text-muted-foreground">
                  Switches that change how the 3D viewer renders. Browser-local — nothing here is a server setting, and
                  nothing here affects anyone else.
                </p>
              </div>
            </div>

            <!-- The "show the cog" switch that used to live here is GONE, not
                 hidden: the cog is now always in the 3D viewer, because the panel
                 behind it carries real user settings (bloom) alongside the
                 diagnostics, and those sit behind its own Advanced disclosure. A
                 control that no longer controls anything is worse than no control,
                 so it was removed rather than left to lie. -->
            <div class="rounded-md border border-border">
              <div class="px-4 py-3">
                <span class="block text-sm text-foreground">Where these live</span>
                <span class="block text-xs text-muted-foreground">
                  The cog over the 3D viewer opens the same switches in context, next to the model they change —
                  that is the better place to use them. <span class="font-mono">Ctrl/Cmd + Shift + D</span> opens it too.
                  Look under <span class="font-medium">Advanced</span> there; the top of that panel is user-facing
                  settings.
                </span>
              </div>
            </div>

            <!-- The flags themselves, here as well as in the cog panel. The cog
                 is the better place to use them (it is next to the model you are
                 looking at) but it is reachable only once this page has been
                 found — so the page cannot be the only thing the cog unlocks. -->
            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Viewer flags
                <span v-if="activeFlagCount" class="ml-1 font-mono text-[hsl(var(--tac-amber))]">{{ activeFlagCount }} on</span>
              </p>
              <div class="divide-y divide-border rounded-md border border-border">
                <button
                  v-for="f in FLAGS"
                  :key="f.name"
                  class="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                  @click="toggleFlag(f.name)"
                >
                  <span class="min-w-0">
                    <span class="block text-sm text-foreground">{{ f.label }}</span>
                    <span class="block text-xs text-muted-foreground">{{ f.hint }}</span>
                  </span>
                  <span
                    class="mt-1 h-4 w-7 flex-none rounded-full transition-colors"
                    :class="flagOn(f.name) ? 'bg-[hsl(var(--tac-amber))]' : 'bg-muted'"
                  >
                    <span
                      class="block h-3.5 w-3.5 translate-y-[1px] rounded-full bg-background transition-transform"
                      :class="flagOn(f.name) ? 'translate-x-[13px]' : 'translate-x-[1px]'"
                    ></span>
                  </span>
                </button>
              </div>
              <p class="text-xs text-muted-foreground">
                Read when a model mounts — reopen the item, or reload, for a change to show.
              </p>
            </div>
          </div>
        </section>

        <!-- 3D Models -->
        <section v-else :class="CARD">
          <div class="space-y-6 p-6">
            <div class="flex items-start gap-3">
              <span :class="RULE" />
              <div class="min-w-0 flex-1 space-y-0.5">
                <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Model extraction</h3>
                <p class="text-sm text-muted-foreground">
                  Reads the node's CS2 install and writes weapon models plus composite-input textures
                  straight onto the models mount. Only needed once — re-run after a CS2 update changes
                  the models.
                </p>
              </div>
              <!-- State belongs beside the title, not on a line of its own: it
                   qualifies the whole section, and as a pill it's findable at a
                   glance instead of being one more sentence to read. -->
              <div v-if="extractStatus" class="shrink-0 pl-4">
                <span
                  class="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :class="extractDot"></span>
                  {{ extractStateLabel }}
                </span>
              </div>
            </div>

            <p v-if="!extractStatus" class="text-sm text-muted-foreground">
              Extraction isn't available on this backend.
            </p>

            <template v-else>
              <!-- The three facts worth knowing, as a label/value ledger — same
                   bordered-and-divided list the Cached assets tab uses, so the
                   two tabs read as one console. Monospace values line up down
                   the right edge, which is what makes them scannable. -->
              <dl class="divide-y divide-border rounded-md border border-border">
                <div class="flex items-center justify-between gap-4 px-4 py-3">
                  <dt class="text-sm text-muted-foreground">On disk</dt>
                  <dd v-if="cacheStats?.models?.files" class="font-mono text-sm">
                    {{ cacheStats.models.files.toLocaleString() }} files
                    <span class="text-muted-foreground">·</span>
                    {{ fmtBytes(cacheStats.models.bytes) }}
                  </dd>
                  <dd v-else class="text-sm text-muted-foreground">nothing yet — 3D toggles stay hidden</dd>
                </div>
                <!-- When it ran and how long it took are ONE fact about ONE
                     event, so they share a row. As two rows they read as two
                     separate things to check, and "13m 23s" appeared again next
                     to the button — the same number in three places. -->
                <div class="flex items-start justify-between gap-4 px-4 py-3">
                  <dt class="text-sm text-muted-foreground">Last run</dt>
                  <dd class="text-right">
                    <span class="font-mono text-sm" :class="lastRunAt ? '' : 'text-muted-foreground'">
                      {{ lastRunAt ? new Date(lastRunAt).toLocaleString() : "never" }}
                      <template v-if="extractStatus.lastRunSeconds != null">
                        <span class="text-muted-foreground">·</span>
                        {{ fmtDuration(extractStatus.lastRunSeconds) }}
                      </template>
                    </span>
                    <span v-if="slowestSteps" class="mt-0.5 block text-xs text-muted-foreground">{{ slowestSteps }}</span>
                  </dd>
                </div>
                <!-- Which CS2 build the assets were extracted against, and what
                     the mounted install reports now. Only shown once we know at
                     least one of them. -->
                <div
                  v-if="extractStatus.gameBuild != null || extractStatus.currentGameBuild != null"
                  class="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <dt class="text-sm text-muted-foreground">CS2 build</dt>
                  <dd class="font-mono text-sm" :class="extractStatus.gameBuild != null ? '' : 'text-muted-foreground'">
                    <!-- Stamped build (what the assets were extracted against). -->
                    <template v-if="extractStatus.gameBuild != null">
                      {{ extractStatus.gameBuild }}
                      <span v-if="extractStatus.gamePatch" class="text-muted-foreground">· {{ extractStatus.gamePatch }}</span>
                      <span v-if="extractStatus.gameUpdated" class="text-muted-foreground">
                        → now {{ extractStatus.currentGameBuild }}
                      </span>
                    </template>
                    <!-- No stamped build (assets predate version stamping): show
                         the live install's build plainly. It reads as the build
                         either way, so the qualifier was just noise. -->
                    <template v-else-if="extractStatus.currentGameBuild != null">
                      {{ extractStatus.currentGameBuild }}
                      <span v-if="extractStatus.currentGamePatch" class="text-muted-foreground">· {{ extractStatus.currentGamePatch }}</span>
                    </template>
                    <template v-else>unknown</template>
                  </dd>
                </div>
              </dl>

              <p v-if="extractStatus.error" class="text-xs text-destructive">{{ extractStatus.error }}</p>

              <!-- Game version drift. Deliberately a softer, blue/muted notice —
                   not the amber re-extract alert above. The game moving on is
                   informational: most CS2 patches don't touch weapon models, so
                   this is a "re-run if skins look wrong" hint, not a demand.
                   Suppressed while `stale` is showing: both notices ask for the
                   same single action, and stacking them made one re-extraction
                   look like two separate problems. -->
              <div
                v-if="extractStatus.gameUpdated && !extractStatus.stale"
                class="flex items-start gap-3 rounded-md border border-[hsl(var(--tac-value)/0.4)] bg-[hsl(var(--tac-value)/0.08)] px-3 py-2.5"
              >
                <Info class="mt-0.5 h-3.5 w-3.5 flex-none text-[hsl(var(--tac-value))]" />
                <div class="min-w-0 space-y-1">
                  <p class="text-sm font-medium text-foreground">
                    {{ extractStatus.gameBuild != null ? "Game updated since last extract" : "Game version not recorded" }}
                  </p>
                  <!-- Known baseline that has since moved on. -->
                  <p v-if="extractStatus.gameBuild != null" class="text-xs text-muted-foreground">
                    The models were extracted against CS2 build
                    <span class="font-mono">{{ extractStatus.gameBuild }}</span
                    ><span v-if="extractStatus.gamePatch" class="font-mono"> ({{ extractStatus.gamePatch }})</span>, but the
                    install is now build <span class="font-mono">{{ extractStatus.currentGameBuild }}</span
                    ><span v-if="extractStatus.currentGamePatch" class="font-mono"> ({{ extractStatus.currentGamePatch }})</span>.
                    Most patches don't change weapon models — re-run the extraction below only if skins look wrong.
                  </p>
                  <!-- No baseline: assets predate build tracking, so we can't say
                       which build they match — don't assume they're current. -->
                  <p v-else class="text-xs text-muted-foreground">
                    The models on the mount were extracted before build tracking existed, so we can't tell which CS2 build
                    they match. The install is build <span class="font-mono">{{ extractStatus.currentGameBuild }}</span
                    ><span v-if="extractStatus.currentGamePatch" class="font-mono"> ({{ extractStatus.currentGamePatch }})</span>.
                    Re-run the extraction below to record the baseline and pick up any model changes.
                  </p>
                </div>
              </div>
              <!-- Worker count. Sits directly ABOVE the run button because it
                   is part of the same decision: how hard this is about to hit
                   the machine. Stated in GB, not as a "parallelism" number —
                   the cost is memory, and the default of 1 exists because
                   running one per core OOM-killed people's boxes. -->
              <div v-if="workers" class="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-foreground">Parallel workers</p>
                    <!-- What a worker IS, and what the box has, on one line —
                         the capacity figure belongs with the explanation, not
                         as a fourth entry in the colour key below. -->
                    <p class="text-xs text-muted-foreground">
                      Weapon models decompiled at once, while step 1 runs.<template v-if="memPlan">
                        <span class="mx-1 text-muted-foreground/50">·</span>
                        <span class="font-mono"
                          >{{ memPlan.availableGb != null ? fmtGb(memPlan.availableGb) : "?" }} free of
                          {{ fmtGb(memPlan.totalGb) }}</span
                        ></template
                      >
                    </p>
                  </div>
                  <!-- Stepper, not a free-text field: the range is 1..cores and
                       every value in it is one click from the current one. -->
                  <div class="flex items-center gap-1">
                    <button
                      :class="[BTN, 'w-9 px-0']"
                      :disabled="workers.jobs <= 1"
                      title="Fewer workers"
                      aria-label="Fewer workers"
                      @click="setWorkers(workers.jobs - 1)"
                    >
                      <Minus class="h-3.5 w-3.5" />
                    </button>
                    <span
                      class="min-w-[3.5rem] text-center font-mono text-lg tabular-nums"
                      :class="workerRisk === 'over' ? 'text-destructive' : ''"
                      aria-live="polite"
                      >{{ workers.jobs }}</span
                    >
                    <button
                      :class="[BTN, 'w-9 px-0']"
                      :disabled="workers.jobs >= workers.cores"
                      title="More workers"
                      aria-label="More workers"
                      @click="setWorkers(workers.jobs + 1)"
                    >
                      <Plus class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <!-- The projection is the whole point of the control: a worker
                     count on its own tells an operator nothing about whether
                     their box survives it. One track = all the memory on this
                     machine, read left to right: what is in use now, what this
                     setting adds (as a range, since it depends on the weapon a
                     worker draws), and the headroom the rest of 5stack needs. -->
                <template v-if="memPlan">
                  <!-- Absolutely positioned bands, NOT flex children: flex items
                       shrink to fit, so an over-budget projection would quietly
                       compress itself back inside the track — understating the
                       exact situation the bar exists to show. Positioned, it
                       overruns the panel's reserve and gets clipped, which is
                       what "this does not fit" should look like. -->
                  <div
                    class="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    :aria-label="`${fmtGb(memPlan.totalGb)} total memory. ${
                      memPlan.inUseGb != null ? fmtGb(memPlan.inUseGb) + ' in use. ' : ''
                    }Extraction needs about ${fmtGb(memPlan.minGb)} to ${fmtGb(memPlan.maxGb)} at ${workers.jobs} worker${
                      workers.jobs === 1 ? '' : 's'
                    }. ${fmtGb(memPlan.reserveGb)} reserved for the 5stack panel.`"
                  >
                    <!-- Panel headroom first, so the extraction draws OVER it
                         when a setting is greedy enough to collide. -->
                    <span
                      class="absolute inset-y-0 right-0 bg-destructive/25"
                      :style="{ width: memPlan.reservePct + '%' }"
                    ></span>
                    <!-- In use now. /35 rather than /25: against the track this
                         sat at almost the same value, so the bar read as one
                         undifferentiated grey blob and "how much headroom do I
                         have" — the question it exists to answer — was lost. -->
                    <span
                      class="absolute inset-y-0 left-0 bg-foreground/35"
                      :style="{ width: memPlan.usedPct + '%' }"
                    ></span>
                    <!-- Extraction: the part every run pays… The glow is the
                         panel's existing vocabulary for "this is the live
                         thing", and it earns it here — at one worker the band
                         is a 2% sliver that otherwise disappears. It animates
                         because it is the direct result of the stepper: seeing
                         it grow is what connects the click to the cost. -->
                    <span
                      class="absolute inset-y-0 transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
                      :class="
                        workerRisk === 'over'
                          ? 'bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.7)]'
                          : 'bg-[hsl(var(--tac-amber))] shadow-[0_0_6px_hsl(var(--tac-amber)/0.6)]'
                      "
                      :style="{ left: memPlan.usedPct + '%', width: memPlan.minPct + '%' }"
                    ></span>
                    <!-- …and the part that depends on which weapons land where.
                         Striped so it reads as "up to", not "will". -->
                    <span
                      class="absolute inset-y-0 opacity-60 transition-[left,width] duration-300 ease-out motion-reduce:transition-none [background-image:repeating-linear-gradient(45deg,currentColor_0_3px,transparent_3px_6px)]"
                      :class="workerRisk === 'over' ? 'text-destructive' : 'text-[hsl(var(--tac-amber))]'"
                      :style="{ left: memPlan.usedPct + memPlan.minPct + '%', width: memPlan.rangePct + '%' }"
                    ></span>
                  </div>
                  <!-- A colour KEY, nothing else. It used to double as a stat
                       readout, which put "In use 18 GB" next to "Free 14 GB of
                       31 GB" — the same fact stated twice, since one is the
                       other subtracted from the total. -->
                  <dl class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
                    <div v-if="memPlan.inUseGb != null" class="flex items-center gap-1.5">
                      <span class="h-2 w-2 rounded-sm bg-foreground/25"></span>
                      <dt>In use</dt>
                      <dd class="font-mono">{{ fmtGb(memPlan.inUseGb) }}</dd>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span
                        class="h-2 w-2 rounded-sm"
                        :class="workerRisk === 'over' ? 'bg-destructive' : 'bg-[hsl(var(--tac-amber))]'"
                      ></span>
                      <dt>Extraction</dt>
                      <dd class="font-mono">{{ fmtGb(memPlan.minGb) }}–{{ fmtGb(memPlan.maxGb) }}</dd>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="h-2 w-2 rounded-sm bg-destructive/25"></span>
                      <dt>5stack panel</dt>
                      <dd class="font-mono">{{ fmtGb(memPlan.reserveGb) }} min</dd>
                    </div>
                  </dl>
                </template>
                <p class="mt-2 text-xs" :class="workerRisk === 'none' ? 'text-muted-foreground' : ''">
                  <template v-if="workerRisk === 'over'">
                    <span class="font-medium text-destructive">
                      {{ workers.jobs }} workers won't fit. Even the low end needs
                      <span class="font-mono">{{ fmtGb(memPlan!.minGb) }}</span> and only
                      <span class="font-mono">{{ fmtGb(memPlan!.budgetGb!) }}</span> is spare once the panel keeps its
                      {{ fmtGb(memPlan!.reserveGb) }}.
                    </span>
                    The kernel will start killing processes — the extraction, the panel, or a live match. Lower it.
                  </template>
                  <template v-else-if="workerRisk === 'tight'">
                    <span class="font-medium text-[hsl(var(--tac-amber))]">
                      {{ workers.jobs }} workers may not fit.
                    </span>
                    If several land on 4K-textured weapons at once this reaches
                    <span class="font-mono">{{ fmtGb(memPlan!.maxGb) }}</span> and starts eating the
                    {{ fmtGb(memPlan!.reserveGb) }} the rest of 5stack needs. Safe below
                    <span class="font-mono">{{ fmtGb(memPlan!.budgetGb!) }}</span
                    >.
                  </template>
                  <template v-else-if="workers.jobs === 1">
                    Raise it if this machine has memory to spare — more workers is the main thing that makes an
                    extraction finish sooner.
                  </template>
                  <template v-else> Fits with room to spare. </template>
                  <!-- Say it plainly: the knob is live. Without this, an
                       operator watching a slow run assumes they have to cancel
                       and start over to change it — the one thing this design
                       exists to avoid. -->
                  <template v-if="extractLive">
                    <br />Takes effect on the run in progress — within seconds while models are decompiling, at the next
                    batch after that. Lowering it never kills work mid-model; the pool just drains to the new number.
                  </template>
                </p>
              </div>

              <!-- Problem and its fix as one block. The button used to sit
                   below the log, several hundred pixels from the sentence
                   telling you to press it. -->
              <div class="flex flex-wrap items-center gap-3">
                <!-- Running is a first-class state here, not just "disabled":
                     the button keeps its amber weight, sweeps an indeterminate
                     bar (there is no percentage to report — the script doesn't
                     emit one) and counts elapsed time, so a slow run is
                     visibly distinct from a hung one. -->
                <button
                  :class="[
                    BTN_PRIMARY,
                    'relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tac-amber))] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    extractLive
                      ? 'disabled:opacity-100 cursor-progress'
                      : 'hover:shadow-[0_0_18px_hsl(var(--tac-amber)/0.35)] active:translate-y-px',
                  ]"
                  :disabled="extractBusy || extractLive"
                  :title="extractLive ? 'Extraction in progress — it can\'t be cancelled from here' : undefined"
                  @click="doStartExtract"
                >
                  <span
                    v-if="extractLive"
                    aria-hidden="true"
                    class="pointer-events-none absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/30 to-transparent motion-reduce:hidden"
                  ></span>
                  <Loader2 v-if="extractBusy || extractLive" class="relative h-3.5 w-3.5 animate-spin" />
                  <Box v-else class="relative h-3.5 w-3.5" />
                  <span class="relative">
                    {{ extractLive ? "Extracting…" : extractStatus.stale ? "Run extraction" : "Re-extract models" }}
                  </span>
                  <!-- Tabular figures: without them the clock jitters the label
                       sideways every second as digit widths change. -->
                  <span v-if="extractElapsed" class="relative font-mono text-xs tabular-nums opacity-80">
                    {{ extractElapsed }}
                  </span>
                </button>
                <!-- The reason to press it sits WITH the button rather than in
                     its own callout above: one action, one place. A separate
                     banner made a single re-run read as a second problem. -->
                <p class="min-w-[16rem] flex-1 space-y-0.5 text-xs">
                  <span v-if="extractStatus.stale" class="block font-medium text-[hsl(var(--tac-amber))]">
                    {{
                      extractStatus.extracted === false
                        ? "Never run — item art and 3D stay hidden until it does."
                        : `Out of date — the mount has ${extractStatus.extractVersion == null ? "an unversioned pipeline" : "v" + extractStatus.extractVersion}, this build produces v${extractStatus.requiredVersion}.`
                    }}
                  </span>
                  <!-- The estimate appears ONLY when this box has never measured
                       itself. Once "Last run" carries a real duration, repeating
                       it here made one number look like two different claims. -->
                  <span class="block text-muted-foreground">
                    <template v-if="extractStatus.lastRunSeconds == null">{{ extractDurationHint }} </template>
                    Replaces what's on the mount in place — 3D stays served throughout.
                  </span>
                </p>
              </div>

              <!-- Live progress: the pipeline as a vertical spine, one node per
                   step. The spine is the point — it shows the whole sequence at
                   once, so you can see how many stages remain and how big the
                   current one is. A single bar could say neither, and a bar on
                   every row was just noise: a finished step is fully described
                   by a filled node and its duration.

                   Two steps lit at once would read as parallel work, which is
                   why state lives on the node rather than in the ordering. -->
              <ol v-if="extractProgress" class="space-y-0">
                <li v-for="s in extractProgress" :key="s.name" class="flex gap-3">
                  <!-- Gutter: node + the connector to the next step. -->
                  <span class="relative flex w-3 flex-none justify-center" aria-hidden="true">
                    <span
                      v-if="!s.last"
                      class="absolute top-3 bottom-0 w-px"
                      :class="s.state === 'done' ? 'bg-[hsl(var(--tac-amber)/0.35)]' : 'bg-border'"
                    ></span>
                    <!-- Squares, not dots: the panel's vocabulary is angular
                         (corner brackets, ◢) and a circle reads as foreign. -->
                    <span
                      class="relative mt-[7px] h-1.5 w-1.5 flex-none rotate-45"
                      :class="{
                        'bg-[hsl(var(--tac-amber)/0.45)]': s.state === 'done',
                        'bg-[hsl(var(--tac-amber))] shadow-[0_0_8px_hsl(var(--tac-amber)/0.7)]': s.state === 'running',
                        'border border-border bg-transparent': s.state === 'pending',
                      }"
                    ></span>
                  </span>

                  <div class="min-w-0 flex-1 pb-3">
                    <div class="flex items-baseline justify-between gap-3">
                      <span
                        class="truncate text-xs"
                        :class="{
                          'font-medium text-foreground': s.state === 'running',
                          'text-muted-foreground': s.state === 'done',
                          'text-muted-foreground/45': s.state === 'pending',
                        }"
                      >{{ s.label }}</span>
                      <span
                        v-if="s.primary || s.secondary"
                        class="flex flex-none items-baseline gap-2 font-mono text-xs tabular-nums"
                      >
                        <span
                          v-if="s.primary"
                          :class="s.state === 'running' ? 'text-[hsl(var(--tac-amber))]' : 'text-muted-foreground/70'"
                          >{{ s.primary }}</span
                        >
                        <!-- Timing sits a rank down: it answers "how much
                             longer", which you only read once the count has told
                             you where you are. Dimmer and [10px] so the two
                             don't compete at a glance. -->
                        <span v-if="s.secondary" class="text-[10px] text-muted-foreground/60">{{ s.secondary }}</span>
                      </span>
                    </div>
                    <!-- Only the running step gets a bar. An indeterminate one
                         pulses full-width rather than sitting at 0%, which reads
                         as stalled rather than "working, length unknown". -->
                    <div v-if="s.state === 'running'" class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border">
                      <div
                        class="h-full rounded-full bg-[hsl(var(--tac-amber))] shadow-[0_0_6px_hsl(var(--tac-amber)/0.6)]"
                        :class="s.pct == null ? 'w-full animate-pulse' : 'transition-[width] duration-700 ease-out'"
                        :style="s.pct != null ? { width: Math.max(2, s.pct) + '%' } : undefined"
                      ></div>
                    </div>
                  </div>
                </li>
              </ol>

              <!-- Collapsed by default: the tail is ~200 lines of dump paths
                   that dominated the card while being the least-read thing on
                   it. Open on its own when a run is live or has failed, which
                   are the two times anyone actually wants it. Lines don't wrap
                   any more — the paths are long and wrapping shredded them
                   into unreadable ribbons; scroll sideways instead. -->
              <details
                v-if="extractStatus.log"
                :open="extractLive || extractStatus.state === 'failed' || extractStatus.state === 'interrupted'"
                class="group rounded-md border border-border"
              >
                <!-- The download lives IN this header rather than in a block of
                     its own below. Two separate log affordances, in two
                     different styles, split by the progress list read as two
                     features; they are one thing — the tail, and all of it.
                     `.stop` keeps the link from toggling the disclosure. -->
                <summary
                  class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
                >
                  <ChevronRight class="h-3.5 w-3.5 flex-none transition-transform duration-200 group-open:rotate-90" />
                  Run log
                  <span class="font-mono text-xs">last {{ logLineCount.toLocaleString() }} lines</span>
                  <a
                    :class="[BTN, 'ml-auto h-7 gap-1.5 px-2 text-xs']"
                    :href="extractLogUrl()"
                    download="extract-models.log"
                    title="Complete output of the most recent run — the box below only shows the tail"
                    @click.stop
                  >
                    <Download class="h-3 w-3" />
                    Full log
                    <span v-if="extractStatus.logBytes" class="font-mono">({{ fmtBytes(extractStatus.logBytes) }})</span>
                  </a>
                </summary>
                <pre
                  class="max-h-72 overflow-auto whitespace-pre border-t border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground"
                >{{ extractStatus.log }}</pre>
              </details>
            </template>

            <!-- Outside the v-else on purpose: the last run's log is worth
                 grabbing even when the status lookup itself came back empty.
                 Plain link, not fetch — the browser streams it straight to
                 disk and carries the session cookie on its own. Same bordered
                 module as the disclosure it stands in for, so the card keeps
                 one container language top to bottom. -->
            <div
              v-if="showLogFallback"
              class="flex flex-wrap items-center gap-3 rounded-md border border-border px-4 py-2.5"
            >
              <span class="text-sm text-muted-foreground">Run log</span>
              <span class="text-xs text-muted-foreground/70">no tail in memory — the file is the whole run</span>
              <a
                :class="[BTN, 'ml-auto h-7 gap-1.5 px-2 text-xs']"
                :href="extractLogUrl()"
                download="extract-models.log"
              >
                <Download class="h-3 w-3" />
                Full log
                <span v-if="extractStatus?.logBytes" class="font-mono">({{ fmtBytes(extractStatus.logBytes) }})</span>
              </a>
            </div>
          </div>
        </section>
      </div>
      </Transition>
    </div>
  </div>
</template>
