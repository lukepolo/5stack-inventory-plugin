<script setup lang="ts">
// A souvenir's stickers, picked the way the game deals them (cs2-lib 9.10):
// one EVENT, then two teams from it, its event sticker, an autograph from one of
// those two teams and the map. cs2-lib's rule is exactly that shape — at most two
// teams between the logos and the autograph, one of each of the rest — and the
// backend rejects anything else, so this only ever offers what can be saved.
//
// Packages drop ONE map, so their map is fixed; events whose souvenirs are
// crafted (Cologne 2026) offer every map. A highlight package (Austin 2025,
// Budapest 2025) is picked by HIGHLIGHT instead: the highlight names the two
// teams, and its charm hangs on the gun.
//
// The panel owns the souvenir stickers while Souvenir is on. It emits them in
// the game's own order — team, team, event, autograph, map, slots 0 up — and
// the editor keeps each one's wear and placement where the same sticker stays.
import { computed, ref, watch } from "vue";
import { Check } from "lucide-vue-next";
import HighlightPicker from "./HighlightPicker.vue";
import { fetchSouvenirOptions, type SouvenirOptions, type SouvenirSource, type SouvenirSticker } from "../api";

const props = defineProps<{
  itemId: number;
  /** The sticker ids on the gun now, by slot — read back into a selection. */
  stickerIds: (number | null)[];
  /** The highlight on its charm, when it carries one. */
  highlightId: number | null;
}>();
const emit = defineEmits<{
  stickers: [SouvenirSticker[]];
  /** A highlight package's charm: set, or taken off (null). */
  charm: [{ id: number; highlight: number } | null];
}>();

const options = ref<SouvenirOptions | null>(null);
const failed = ref(false);

interface Selection {
  source: number;
  teams: number[];
  event: number | null;
  autograph: number | null;
  map: number | null;
  highlight: number | null;
}
const sel = ref<Selection | null>(null);

const source = computed<SouvenirSource | null>(() => (sel.value && options.value?.sources[sel.value.source]) || null);
const sticker = (id: number | null | undefined) => (id != null ? options.value?.stickers[id] ?? null : null);
/** "Sticker | MOUZ (Gold) | Austin 2025" -> "MOUZ". */
const teamName = (name: string) => (name.split(" | ")[1] ?? name).replace(/\s*\([^)]*\)$/, "");
/** A player's name off "Sticker | s1mple (Gold) | Boston 2018". */
const playerName = (name: string) => (name.split(" | ")[1] ?? name).replace(/\s*\((Gold|Foil|Holo|Glitter)\)$/, "");

function fresh(index: number, src: SouvenirSource): Selection {
  return {
    source: index,
    teams: [],
    event: src.event[0] ?? null,
    autograph: null,
    map: src.fixedMap ? src.maps[0] ?? null : null,
    highlight: null,
  };
}

/** The selection these sticker ids ARE, in the first source that explains all
 *  of them — the newest first, as the list is sorted. */
function readBack(opts: SouvenirOptions, ids: number[]): Selection | null {
  for (const [index, src] of opts.sources.entries()) {
    const s = fresh(index, src);
    s.event = null;
    let ok = true;
    let autographTeam: number | null = null;
    for (const id of ids) {
      const logo = src.teams.find((t) => t.sticker === id);
      const signer = src.teams.find((t) => t.autographs.includes(id));
      if (src.event.includes(id) && s.event == null) s.event = id;
      else if (src.maps.includes(id) && (s.map == null || s.map === id)) s.map = id;
      else if (logo && !s.teams.includes(logo.id) && s.teams.length < 2) s.teams.push(logo.id);
      else if (signer && s.autograph == null) {
        s.autograph = id;
        autographTeam = signer.id;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (autographTeam != null && !s.teams.includes(autographTeam)) s.teams.push(autographTeam);
    if (s.teams.length > 2) continue;
    if (src.event.length === 1) s.event ??= src.event[0];
    if (src.fixedMap) s.map ??= src.maps[0] ?? null;
    if (props.highlightId != null && src.highlights.some((h) => h.id === props.highlightId)) s.highlight = props.highlightId;
    return s;
  }
  return null;
}

async function load() {
  const id = props.itemId;
  failed.value = false;
  const opts = await fetchSouvenirOptions(id);
  if (id !== props.itemId) return;
  if (!opts) {
    failed.value = true;
    return;
  }
  options.value = opts;
  if (!opts.sources.length) return;
  const ids = props.stickerIds.filter((s): s is number => s != null);
  const back = ids.length ? readBack(opts, ids) : null;
  if (back) {
    // What is on the gun already IS a souvenir set: show it, change nothing.
    sel.value = back;
  } else {
    // Anything else (no stickers, or stickers from before Souvenir was on) is
    // replaced by the newest event's start: its event sticker and fixed map.
    sel.value = fresh(0, opts.sources[0]);
    commit();
  }
}
watch(() => props.itemId, load, { immediate: true });

/** The stickers this selection deals, in the game's slot order. */
function compose(s: Selection, src: SouvenirSource): SouvenirSticker[] {
  const ids = [
    ...s.teams.map((t) => src.teams.find((team) => team.id === t)?.sticker ?? null),
    s.event,
    s.autograph,
    s.map,
  ];
  return ids.map(sticker).filter((x): x is SouvenirSticker => x != null);
}
function commit(charmChanged = false) {
  const s = sel.value;
  const src = source.value;
  if (!s || !src) return;
  emit("stickers", compose(s, src));
  if (charmChanged) {
    const h = src.highlights.find((x) => x.id === s.highlight);
    emit("charm", h ? { id: h.charmId, highlight: h.id } : null);
  }
}

function pickSource(index: number) {
  const src = options.value?.sources[index];
  if (!src || sel.value?.source === index) return;
  const hadHighlight = sel.value?.highlight != null;
  sel.value = fresh(index, src);
  commit(hadHighlight);
}
function toggleTeam(id: number) {
  const s = sel.value;
  if (!s || s.highlight != null) return;
  if (s.teams.includes(id)) s.teams = s.teams.filter((t) => t !== id);
  else s.teams = s.teams.length < 2 ? [...s.teams, id] : [s.teams[0], id];
  // An autograph has to be from one of the two teams on the gun.
  const src = source.value;
  if (s.autograph != null && src && !src.teams.some((t) => s.teams.includes(t.id) && t.autographs.includes(s.autograph!))) {
    s.autograph = null;
  }
  commit();
}
function pickHighlight(id: number) {
  const s = sel.value;
  const src = source.value;
  if (!s || !src) return;
  const h = src.highlights.find((x) => x.id === id);
  s.highlight = id;
  // The highlight IS the match: its two teams, and the autograph kept only if
  // it is still one of theirs.
  s.teams = (h?.teams ?? []).slice(0, 2);
  if (s.autograph != null && !src.teams.some((t) => s.teams.includes(t.id) && t.autographs.includes(s.autograph!))) {
    s.autograph = null;
  }
  commit(true);
}
function pick(field: "event" | "autograph" | "map", id: number | null) {
  if (!sel.value) return;
  sel.value[field] = sel.value[field] === id ? (field === "event" ? id : null) : id;
  commit();
}

/** Both teams' players, once both teams are in. */
const autographs = computed(() => {
  const s = sel.value;
  const src = source.value;
  if (!s || !src || s.teams.length < 2) return [];
  return src.teams.filter((t) => s.teams.includes(t.id)).flatMap((t) => t.autographs);
});
const teamOrder = (id: number) => (sel.value?.teams.indexOf(id) ?? -1) + 1;
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="failed" class="text-f10 text-muted-foreground">Couldn't load this finish's souvenir events.</div>
    <div v-else-if="!options" class="text-f10 text-muted-foreground/60">Loading events…</div>
    <template v-else-if="sel && source">
      <!-- EVENT. A native select: up to 19 of them, and names too long for chips. -->
      <label class="flex flex-col gap-1">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Event</span>
        <select
          :value="sel.source"
          class="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-[16px] outline-none focus:border-[color:var(--acc)] sm:text-f13"
          @change="pickSource(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="(src, i) in options.sources" :key="i" :value="i">{{ src.name }}</option>
        </select>
      </label>

      <!-- HIGHLIGHT PACKAGES: the highlight picks the teams. -->
      <HighlightPicker
        v-if="source.highlights.length"
        :options="source.highlights"
        :model-value="sel.highlight"
        @update:model-value="pickHighlight"
      />

      <div v-if="source.teams.length" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Teams</span>
          <span class="ml-auto text-f9 text-muted-foreground/70">
            {{ sel.highlight != null ? 'set by the highlight' : `pick two · ${sel.teams.length}/2` }}
          </span>
        </div>
        <div class="grid grid-cols-6 gap-1 sm:grid-cols-7">
          <button
            v-for="team in source.teams"
            :key="team.id"
            class="relative grid aspect-square min-h-10 place-items-center rounded border transition-colors"
            :class="[
              teamOrder(team.id) ? 'border-[color:var(--acc)] bg-background' : 'border-border/60 hover:border-border',
              sel.highlight != null && !teamOrder(team.id) && 'opacity-30',
            ]"
            :disabled="sel.highlight != null"
            :title="teamName(sticker(team.sticker)?.name ?? '')"
            :aria-pressed="!!teamOrder(team.id)"
            @click="toggleTeam(team.id)"
          >
            <img v-if="sticker(team.sticker)?.image" :src="sticker(team.sticker)!.image!" alt="" class="max-h-[80%] max-w-[80%] object-contain" />
            <span
              v-if="teamOrder(team.id)"
              class="absolute right-0.5 top-0.5 font-mono text-f8 leading-none text-[color:var(--acc)]"
            >{{ teamOrder(team.id) }}</span>
          </button>
        </div>
      </div>

      <!-- EVENT STICKER: only a choice when the event printed several. -->
      <div v-if="source.event.length > 1" class="flex flex-col gap-1">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Event sticker</span>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="id in source.event"
            :key="id"
            class="grid h-10 w-10 place-items-center rounded border transition-colors"
            :class="sel.event === id ? 'border-[color:var(--acc)] bg-background' : 'border-border/60 hover:border-border'"
            :title="sticker(id)?.name"
            @click="pick('event', id)"
          >
            <img v-if="sticker(id)?.image" :src="sticker(id)!.image!" alt="" class="max-h-8 max-w-8 object-contain" />
          </button>
        </div>
      </div>

      <div v-if="source.teams.some((t) => t.autographs.length)" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Autograph</span>
          <span v-if="!autographs.length" class="ml-auto text-f9 text-muted-foreground/70">pick both teams first</span>
          <span v-else-if="sel.autograph != null" class="ml-auto truncate text-f9 text-muted-foreground">{{ playerName(sticker(sel.autograph)?.name ?? '') }}</span>
        </div>
        <div v-if="autographs.length" class="grid grid-cols-5 gap-1">
          <button
            v-for="id in autographs"
            :key="id"
            class="relative grid aspect-square min-h-10 place-items-center rounded border transition-colors"
            :class="sel.autograph === id ? 'border-[color:var(--acc)] bg-background' : 'border-border/60 hover:border-border'"
            :title="playerName(sticker(id)?.name ?? '')"
            :aria-pressed="sel.autograph === id"
            @click="pick('autograph', id)"
          >
            <img v-if="sticker(id)?.image" :src="sticker(id)!.image!" alt="" class="max-h-[80%] max-w-[80%] object-contain" />
          </button>
        </div>
      </div>

      <div v-if="source.maps.length" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Map</span>
          <span v-if="source.fixedMap" class="ml-auto text-f9 text-muted-foreground/70">set by the package</span>
        </div>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="id in source.maps"
            :key="id"
            class="relative grid h-10 w-10 place-items-center rounded border transition-colors"
            :class="sel.map === id ? 'border-[color:var(--acc)] bg-background' : 'border-border/60 hover:border-border'"
            :disabled="source.fixedMap"
            :title="sticker(id)?.name"
            @click="pick('map', id)"
          >
            <img v-if="sticker(id)?.image" :src="sticker(id)!.image!" alt="" class="max-h-8 max-w-8 object-contain" />
            <Check v-if="sel.map === id && !source.fixedMap" class="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-[color:var(--acc)]" />
          </button>
        </div>
      </div>
    </template>
    <div v-else-if="options && !options.sources.length" class="text-f10 text-muted-foreground">This finish has no souvenir events.</div>
  </div>
</template>
