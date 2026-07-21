<script setup lang="ts">
// The admin surface, as real routes instead of a cramped dialog. Laid out like
// the panel's own application settings (tactical page header + side tabs +
// section cards) so it reads as part of 5stack, not a plugin doing its own thing.
//
// Each side tab is a route (/admin, /admin/assets, /admin/models) — same as
// settings, where the nav is links rather than in-page anchors.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Loader2, Copy, KeyRound, Trash2, Box, Check, ShieldAlert, Download, Info, ChevronRight } from "lucide-vue-next";
import SkinTests from "./SkinTests.vue";
import {
  API_ORIGIN,
  fetchServerApiKey,
  generateServerApiKey,
  fetchCacheStats,
  clearCache,
  fetchAssetCdn,
  setAssetCdn,
  fetchExtractStatus,
  startExtractJob,
  extractLogUrl,
  type AssetCdnStatus,
  type CacheStats,
  type CfgSyncResult,
  type ExtractStatus,
} from "./api";

const props = defineProps<{
  user?: { steam_id: string; name: string; role: string } | null;
  /** Sub-route below /admin: "", "assets" or "models". */
  section?: string;
}>();

const emit = defineEmits<{
  (e: "notify", message: string, kind: "error" | "success"): void;
  (e: "cfg-sync", cfg: CfgSyncResult | null): void;
  (e: "cache-cleared", scope: "renders"): void;
  // Extraction hasn't been run, or ran on an older pipeline. App owns the gear
  // badge, so every status refresh here reports the answer upward — that's
  // what clears the dot the moment a run finishes.
  (e: "extract-stale", warn: "missing" | "stale" | null): void;
  (e: "navigate", section: string): void;
  (e: "back"): void;
}>();

const isAdmin = computed(() => props.user?.role === "administrator");
const fail = (e: unknown) => emit("notify", e instanceof Error ? e.message : String(e), "error");

// ---- side tabs --------------------------------------------------------------
const TABS = [
  { key: "", label: "Game Server" },
  { key: "assets", label: "Asset Cache" },
  { key: "models", label: "3D Models" },
  { key: "tests", label: "Skin Tests" },
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
    emit("notify", "New server key issued — the old key is now dead.", "success");
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
// Prefer this mount's OWN measured time over a generic estimate — it varies a
// lot with the node. "A few minutes" was badly wrong; it is tens of minutes.
const extractDurationHint = computed(() => {
  const secs = extractStatus.value?.lastRunSeconds;
  return secs != null ? `Took ${fmtDuration(secs)} last time.` : "Can take up to ~30 minutes.";
});
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
  return [{ key: "renders", label: "Card renders", hint: "Baked item cards — cleared safely, re-render on view", ...s.renders }];
});
const extractedRows = computed(() => {
  const s = cacheStats.value;
  if (!s) return [];
  return [
    { key: "models", label: "3D models", hint: "Weapon GLBs + composite inputs", ...(s.models ?? { files: 0, bytes: 0 }) },
    { key: "paints", label: "Paint materials", hint: "Skin finishes — without these, skins render white", ...s.paints },
    { key: "images", label: "Item icons", hint: "Flat catalog art for every item", ...(s.images ?? { files: 0, bytes: 0 }) },
  ];
});
// ---- shared asset CDN (opt-in) ----------------------------------------------
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
async function doClearCache() {
  if (cacheBusy.value) return;
  cacheBusy.value = true;
  try {
    await clearCache();
    emit("cache-cleared", "renders");
    emit("notify", "Cleared card renders — each one re-bakes when it is next viewed.", "success");
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
    extractStatus.value = await fetchExtractStatus();
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
      emit("notify", "Model extraction finished — 3D assets are live on the mount.", "success");
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
  "decompile-models": "Decompiling weapon models",
  "rename-models": "Mapping models to catalog keys",
  "composite-inputs": "Extracting composite inputs",
  "charm-anchors": "Reading charm anchors",
  "sticker-markup": "Reading sticker slots",
  "econ-icons": "Extracting item icons",
  "paint-chain": "Extracting paint chain",
  stamp: "Recording the build",
};

const extractProgress = computed(() => {
  const steps = extractStatus.value?.progress?.steps;
  if (!steps?.length || !extractLive.value) return null;
  return steps.map((s, i) => ({
    ...s,
    label: STEP_LABELS[s.name] ?? s.name,
    last: i === steps.length - 1,
    // Only steps that report a unit count get a real percentage. A running step
    // without one is genuinely indeterminate — showing 0% would read as stuck.
    pct: s.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : null,
    // One metric per state, assembled HERE so the template can't recombine the
    // parts wrongly: a done step kept its last done/total and was rendering
    // "1m 24s · 85%", which claims it stopped short.
    detail:
      s.state === "running"
        ? [
            s.total != null ? `${(s.done ?? 0).toLocaleString()} / ${s.total.toLocaleString()}` : "",
            s.total ? `${Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100))}%` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : s.state === "done" && s.seconds != null
          ? fmtDuration(s.seconds)
          : "",
  }));
});

const extractElapsed = computed(() => {
  const started = extractStatus.value?.startedAt;
  if (!started || !extractLive.value) return "";
  const secs = Math.max(0, Math.floor((nowTick.value - new Date(started).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
});

const logLineCount = computed(() => (extractStatus.value?.log ? extractStatus.value.log.split("\n").length : 0));

async function doStartExtract() {
  if (extractBusy.value) return;
  extractBusy.value = true;
  try {
    await startExtractJob();
    emit("notify", "Extraction job started — this takes a few minutes.", "success");
    await refreshExtractStatus();
  } catch (e) {
    fail(e);
  } finally {
    extractBusy.value = false;
  }
}

// Each tab fetches what it shows, when you land on it — so nothing polls for a
// section that isn't on screen.
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
                <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache()">
                  <Loader2 v-if="cacheBusy" class="h-3.5 w-3.5 animate-spin" /><Trash2 v-else class="h-3.5 w-3.5" />
                  Clear renders
                </button>
                <p class="text-xs text-muted-foreground">
                  Clearing forces every card to re-bake — the go-to move after a rendering fix, so stale
                  bakes can't hide it.
                </p>
              </div>

              <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Extracted from this server's CS2 install
                </p>
                <div class="divide-y divide-border rounded-md border border-border">
                  <div
                    v-for="row in extractedRows"
                    :key="row.key"
                    class="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <span class="min-w-0">
                      <span class="block text-sm text-foreground">{{ row.label }}</span>
                      <span class="block text-xs text-muted-foreground">{{ row.hint }}</span>
                    </span>
                    <span class="whitespace-nowrap font-mono text-sm">
                      <span :class="row.files ? '' : 'text-destructive'">{{ row.files.toLocaleString() }} files</span>
                      <span class="text-muted-foreground">·</span>
                      {{ fmtBytes(row.bytes) }}
                    </span>
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
                  <span v-if="!assetCdn.origin" class="text-muted-foreground">
                    Nothing extracted yet, so there is no pipeline + build to match against.
                  </span>
                  <span v-else-if="assetCdn.available === true" class="text-[hsl(var(--tac-cyan))]">
                    ✓ Serving <span class="font-mono">v{{ assetCdn.extractVersion }}-{{ assetCdn.gameBuild }}</span> —
                    same pipeline and CS2 build as this server.
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

        <!-- Skin Tests — renders every finish for a visual sweep. Its own
             component: the render loop + gallery is a lot of state that has no
             business entangled with the cache/extract logic here. -->
        <SkinTests
          v-else-if="activeKey === 'tests'"
          :is-admin="isAdmin"
          @notify="(m: string, k: 'error' | 'success') => emit('notify', m, k)"
        />

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
                <div class="flex items-center justify-between gap-4 px-4 py-3">
                  <dt class="text-sm text-muted-foreground">Last run</dt>
                  <dd class="font-mono text-sm" :class="extractStatus.finishedAt ? '' : 'text-muted-foreground'">
                    {{ extractStatus.finishedAt ? new Date(extractStatus.finishedAt).toLocaleString() : "never" }}
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
                <!-- How long the last run took. Absent on pre-v5 stamps, and a
                     re-extract is a ~15 minute commitment, so it is worth saying
                     before someone presses the button rather than after. -->
                <div v-if="extractStatus.lastRunSeconds != null" class="flex items-center justify-between gap-4 px-4 py-3">
                  <dt class="text-sm text-muted-foreground">Last run took</dt>
                  <dd class="text-right">
                    <span class="font-mono text-sm">{{ fmtDuration(extractStatus.lastRunSeconds) }}</span>
                    <span v-if="slowestSteps" class="mt-0.5 block text-xs text-muted-foreground">{{ slowestSteps }}</span>
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
                class="flex items-start gap-3 rounded-md border border-[hsl(var(--tac-cyan)/0.4)] bg-[hsl(var(--tac-cyan)/0.08)] px-3 py-2.5"
              >
                <Info class="mt-0.5 h-3.5 w-3.5 flex-none text-[hsl(var(--tac-cyan))]" />
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
                  <span class="block text-muted-foreground">
                    {{ extractDurationHint }} Replaces what's on the mount in place — 3D stays served
                    throughout.
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
                        v-if="s.detail"
                        class="flex-none font-mono text-xs tabular-nums"
                        :class="s.state === 'running' ? 'text-[hsl(var(--tac-amber))]' : 'text-muted-foreground/70'"
                      >
                        {{ s.detail }}
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
                <summary
                  class="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
                >
                  <ChevronRight class="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-90" />
                  Run log
                  <span class="font-mono text-xs">last {{ logLineCount.toLocaleString() }} lines</span>
                </summary>
                <pre
                  class="max-h-72 overflow-auto whitespace-pre border-t border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground"
                >{{ extractStatus.log }}</pre>
              </details>
            </template>

            <!-- Outside the v-else on purpose: the last run's log is worth
                 grabbing even when the status lookup itself came back empty.
                 Plain link, not fetch — the browser streams it straight to
                 disk and carries the session cookie on its own. -->
            <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <a :class="BTN" :href="extractLogUrl()" download="extract-models.log">
                <Download class="h-3.5 w-3.5" />
                Download full log
                <span v-if="extractStatus?.logBytes" class="font-mono text-xs">
                  ({{ fmtBytes(extractStatus.logBytes) }})
                </span>
              </a>
              <p class="text-xs text-muted-foreground">
                Complete output of the most recent run — the box above only shows the tail.
              </p>
            </div>
          </div>
        </section>
      </div>
      </Transition>
    </div>
  </div>
</template>
