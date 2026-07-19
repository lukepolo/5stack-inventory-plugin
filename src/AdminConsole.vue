<script setup lang="ts">
// The admin surface, as real routes instead of a cramped dialog. Laid out like
// the panel's own application settings (tactical page header + side tabs +
// section cards) so it reads as part of 5stack, not a plugin doing its own thing.
//
// Each side tab is a route (/admin, /admin/assets, /admin/models) — same as
// settings, where the nav is links rather than in-page anchors.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Loader2, Copy, KeyRound, Trash2, Box, Check, ShieldAlert, Download } from "lucide-vue-next";
import {
  API_ORIGIN,
  fetchServerApiKey,
  generateServerApiKey,
  fetchCacheStats,
  clearCache,
  fetchExtractStatus,
  startExtractJob,
  extractLogUrl,
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
  (e: "cache-cleared", scope: "renders" | "paints" | "all"): void;
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

// ---- asset cache ------------------------------------------------------------
const cacheStats = ref<CacheStats | null>(null);
const cacheBusy = ref(false);
const fmtBytes = (b: number) =>
  b > 1048576 * 900 ? `${(b / 1073741824).toFixed(2)} GB` : b > 900 ? `${(b / 1048576).toFixed(1)} MB` : `${b} B`;
// Only the two real caches — things you can safely clear and have rebuilt on
// demand. Extracted models are NOT a cache (clearing them just breaks 3D until
// someone re-extracts), so their size is reported on the 3D Models tab instead.
const cacheRows = computed(() => {
  const s = cacheStats.value;
  if (!s) return [];
  return [
    { key: "renders", label: "Card renders", ...s.renders },
    { key: "paints", label: "Mirrored paints", ...s.paints },
  ];
});
async function refreshCacheStats() {
  try {
    cacheStats.value = await fetchCacheStats();
  } catch {
    cacheStats.value = null;
  }
}
async function doClearCache(scope: "renders" | "paints" | "all") {
  if (cacheBusy.value) return;
  cacheBusy.value = true;
  try {
    await clearCache(scope);
    emit("cache-cleared", scope);
    emit("notify", `Cleared ${scope === "all" ? "render + paint" : scope} cache — assets rebuild on demand.`, "success");
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
  } catch {
    extractStatus.value = null; // older backend — the section says so
  }
  if (extractLive.value && !extractPoll) {
    extractPoll = setInterval(refreshExtractStatus, 5000);
  } else if (!extractLive.value && extractPoll) {
    stopPoll();
    if (wasLive && extractStatus.value?.state === "succeeded") {
      emit("notify", "Model extraction finished — 3D assets are live on the mount.", "success");
    }
  }
}
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
    else if (key === "assets") refreshCacheStats();
    else if (key === "models") {
      refreshExtractStatus();
      refreshCacheStats(); // for the on-disk size of what's already extracted
    }
    if (key !== "models") stopPoll();
  },
  { immediate: true },
);
onBeforeUnmount(stopPoll);

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
                <h3 class="text-sm font-semibold uppercase tracking-wider text-foreground">Cached assets</h3>
                <p class="text-sm text-muted-foreground">
                  Baked card renders, mirrored paint textures and extracted models on disk.
                </p>
              </div>
            </div>

            <div v-if="cacheRows.length" class="divide-y divide-border rounded-md border border-border">
              <div
                v-for="row in cacheRows"
                :key="row.key"
                class="flex items-center justify-between gap-4 px-4 py-3"
              >
                <span class="text-sm text-muted-foreground">{{ row.label }}</span>
                <span class="font-mono text-sm">
                  {{ row.files.toLocaleString() }} files
                  <span class="text-muted-foreground">·</span>
                  {{ fmtBytes(row.bytes) }}
                </span>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">
              Cache stats unavailable — older backend, or the mount is missing.
            </p>

            <div class="space-y-3">
              <div class="flex flex-wrap gap-2">
                <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache('renders')">
                  <Loader2 v-if="cacheBusy" class="h-3.5 w-3.5 animate-spin" /><Trash2 v-else class="h-3.5 w-3.5" />
                  Clear renders
                </button>
                <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache('paints')">
                  <Trash2 class="h-3.5 w-3.5" /> Clear paints
                </button>
                <button :class="BTN_DANGER" :disabled="cacheBusy" @click="doClearCache('all')">
                  <Trash2 class="h-3.5 w-3.5" /> Clear all
                </button>
              </div>
              <p class="text-xs text-muted-foreground">
                Clearing forces fresh generation everywhere — the go-to move after a rendering fix, so
                stale bakes can't hide it.
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
            </div>

            <!-- What's already on disk: the extraction output, served as
                 /models/*. Non-zero here means 3D is live right now. -->
            <div class="flex items-baseline gap-2 text-sm">
              <span class="text-muted-foreground">On disk:</span>
              <span v-if="cacheStats?.models" class="font-mono text-foreground">
                {{ cacheStats.models.files.toLocaleString() }} files · {{ fmtBytes(cacheStats.models.bytes) }}
              </span>
              <span v-else class="text-muted-foreground">nothing extracted yet — 3D toggles stay hidden</span>
            </div>

            <p v-if="!extractStatus" class="text-sm text-muted-foreground">
              Extraction isn't available on this backend.
            </p>

            <template v-else>
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="
                    extractLive
                      ? 'animate-pulse bg-[hsl(var(--tac-amber))]'
                      : extractStatus.state === 'succeeded'
                        ? 'bg-emerald-400'
                        : extractStatus.state === 'failed' || extractStatus.state === 'interrupted'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground/50'
                  "
                ></span>
                <span class="font-mono">
                  {{ extractStatus.state === "idle" ? "never run" : extractStatus.state }}
                </span>
                <span v-if="extractStatus.finishedAt" class="text-muted-foreground">
                  · finished {{ new Date(extractStatus.finishedAt).toLocaleString() }}
                </span>
              </div>

              <p v-if="extractStatus.error" class="text-xs text-destructive">{{ extractStatus.error }}</p>

              <!-- Tail stays up after the run ends: a succeeded run can still
                   have per-texture failures worth noticing. -->
              <pre
                v-if="extractStatus.log"
                class="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-input bg-background px-3 py-2.5 font-mono text-xs text-muted-foreground"
              >{{ extractStatus.log }}</pre>

              <div class="flex flex-wrap items-center gap-2">
                <button :class="BTN_PRIMARY" :disabled="extractBusy || extractLive" @click="doStartExtract">
                  <Loader2 v-if="extractBusy || extractLive" class="h-3.5 w-3.5 animate-spin" />
                  <Box v-else class="h-3.5 w-3.5" />
                  {{ extractLive ? "Extraction running…" : "Extract models from game files" }}
                </button>
              </div>
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
