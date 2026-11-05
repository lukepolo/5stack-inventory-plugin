<script setup lang="ts">
// Which highlight a highlight-reel charm carries (cs2-lib 9.10). The Austin 2025
// charm has 492 of them, so this is a search over a list, not a row of tiles.
//
// Two ways in. Given a `charmId` it loads that charm's highlights — the charm
// slot on a gun, or a highlight charm crafted on its own. Given `options` it
// shows exactly those — a souvenir HIGHLIGHT PACKAGE, whose highlights are only
// the ones from its own map.
//
// The clips live on Valve's CDN. They are offered as a link the player chooses
// to open, never embedded: the page itself loads nothing from a third party.
import { computed, ref, watch } from "vue";
import { ExternalLink, Search } from "lucide-vue-next";
import { fetchCharmHighlights, type HighlightOption } from "../api";

const props = defineProps<{
  charmId?: number | null;
  options?: HighlightOption[] | null;
  /** The chosen highlight's economy id. */
  modelValue: number | null;
  /** Pick the first highlight when none is chosen. A highlight charm cannot
   *  exist without one — the game shows a blank reel, and cs2-lib drops it. */
  autoPick?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [number];
  /** The charm has no highlights: the caller can hide this picker. */
  none: [];
}>();

const loaded = ref<HighlightOption[]>([]);
const loading = ref(false);
async function load() {
  if (props.options) {
    loaded.value = props.options;
    return;
  }
  const id = props.charmId;
  if (id == null) {
    loaded.value = [];
    return;
  }
  loading.value = true;
  const list = (await fetchCharmHighlights(id)) ?? [];
  if (id !== props.charmId) return;
  loading.value = false;
  loaded.value = list;
  if (!list.length) emit("none");
}
watch(() => [props.charmId, props.options] as const, load, { immediate: true });

const current = computed(() => loaded.value.find((h) => h.id === props.modelValue) ?? null);
watch(
  [loaded, () => props.modelValue] as const,
  () => {
    if (props.autoPick && loaded.value.length && !current.value) emit("update:modelValue", loaded.value[0].id);
  },
  { immediate: true },
);

const open = ref(false);
const query = ref("");
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = q
    ? loaded.value.filter((h) => `${h.name} ${h.matchup ?? ""} ${h.description ?? ""}`.toLowerCase().includes(q))
    : loaded.value;
  // Rendered in full is a few hundred rows; capped, the list stays instant on a
  // phone and the search is how to reach the rest.
  return list.slice(0, 120);
});
const hidden = computed(() => {
  const q = query.value.trim();
  return q ? 0 : Math.max(0, loaded.value.length - shown.value.length);
});

function pick(h: HighlightOption) {
  emit("update:modelValue", h.id);
  open.value = false;
  query.value = "";
}
</script>

<template>
  <div v-if="loading || loaded.length" class="flex flex-col gap-1.5">
    <div class="flex items-baseline gap-2">
      <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Highlight</span>
      <span v-if="loaded.length" class="font-mono text-f9 text-muted-foreground/60">{{ loaded.length }}</span>
      <button
        v-if="loaded.length > 1"
        class="ml-auto flex-none text-f9 uppercase tracking-cs1 text-muted-foreground/70 transition-colors hover:text-foreground"
        @click="open = !open"
      >{{ open ? 'Done' : 'Change' }}</button>
    </div>
    <div v-if="loading" class="text-f10 text-muted-foreground/60">Loading highlights…</div>
    <div v-else-if="current" class="rounded border border-border bg-background px-2 py-1.5">
      <div class="flex items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-f11 text-foreground">{{ current.name }}</span>
        <a
          v-if="current.video"
          :href="current.video"
          target="_blank"
          rel="noopener noreferrer"
          class="flex flex-none items-center gap-1 text-f9 uppercase tracking-cs1 text-muted-foreground/70 transition-colors hover:text-foreground"
          title="Watch the clip on Valve's site"
        >Clip <ExternalLink class="h-3 w-3" /></a>
      </div>
      <div v-if="current.matchup" class="text-f10 text-muted-foreground">{{ current.matchup }}</div>
      <div v-if="current.description" class="mt-0.5 line-clamp-2 text-f10 text-muted-foreground/70">{{ current.description }}</div>
    </div>
    <template v-if="open && !loading">
      <label class="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 focus-within:border-[color:var(--acc)]">
        <Search class="h-3.5 w-3.5 flex-none text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          placeholder="Player, play or team"
          class="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none sm:text-f13"
        />
      </label>
      <div class="flex max-h-64 flex-col overflow-y-auto rounded border border-border/60">
        <button
          v-for="h in shown"
          :key="h.id"
          class="flex min-h-10 flex-col items-start justify-center gap-0.5 border-b border-border/40 px-2 py-1 text-left transition-colors last:border-b-0 hover:bg-secondary/60"
          :class="h.id === modelValue && 'bg-secondary/80'"
          @click="pick(h)"
        >
          <span class="w-full truncate text-f11 text-foreground">{{ h.name }}</span>
          <span v-if="h.matchup" class="w-full truncate text-f9 text-muted-foreground">{{ h.matchup }}</span>
        </button>
        <div v-if="!shown.length" class="px-2 py-2 text-f10 text-muted-foreground">No highlight matches.</div>
        <div v-if="hidden" class="px-2 py-1.5 text-f9 text-muted-foreground/60">{{ hidden }} more — search to narrow</div>
      </div>
    </template>
  </div>
</template>
