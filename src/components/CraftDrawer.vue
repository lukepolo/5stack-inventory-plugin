<script setup lang="ts">
// YOUR CRAFTS, ON A GUN — a drawer along the bottom of the item editor's 3D
// view (decided from the saved-crafts prototype). Shut, it is a lip that says
// how many crafts you have for this gun; click it, or drag it up with a
// finger, and it opens to their pictures, each saying where it would go. One
// click puts a craft on the gun (the editor's own placement — App's
// placeCraftFromDrawer). Your crafts are managed right here as well — rename,
// publish, delete with Undo — so there is no separate screen for them.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronUp, Globe, Layers, Loader2, Lock, Pencil, Search, Trash2 } from "lucide-vue-next";
import { deleteCraft, loadStickerCrafts, saveCraft, setPublished, type SavedCraft } from "../stickerCraftsModel";

const props = defineProps<{
  /** The gun in the editor (its model key), for "crafts made for this gun". */
  model: string | null;
  /** Its name, for the lip and the filter ("AK-47"). */
  weaponName: string;
  /** Where a craft would go on this gun right now, or null when it doesn't fit. */
  fit: (c: SavedCraft) => { slots: number[]; moved: number } | null;
  compact: boolean;
}>();
const emit = defineEmits<{
  (e: "place", craft: SavedCraft): void;
  (e: "notify", message: string, kind: "error" | "success"): void;
}>();

const LIP = 36;
const PANEL = 288;

// ---- the crafts ----------------------------------------------------------------
const library = ref<SavedCraft[] | null>(null);
const published = ref<Set<string>>(new Set());
const failed = ref(false);
async function load() {
  failed.value = false;
  try {
    const got = await loadStickerCrafts();
    library.value = got.library;
    published.value = got.published;
  } catch {
    failed.value = true;
  }
}
onMounted(load);

/** "gun": the crafts made for this gun; "all": every one. Opens on this gun's
 *  when there are any. */
const scope = ref<"gun" | "all" | null>(null);
const forGun = computed(() => (library.value ?? []).filter((c) => !!props.model && c.useCase?.model === props.model));
const shownScope = computed(() => scope.value ?? (forGun.value.length ? "gun" : "all"));
const query = ref("");
const shown = computed(() => {
  const base = shownScope.value === "gun" ? forGun.value : (library.value ?? []);
  const q = query.value.trim().toLowerCase();
  return q ? base.filter((c) => c.name.toLowerCase().includes(q) || c.stickers.some((s) => s.name.toLowerCase().includes(q))) : base;
});
const fitText = (c: SavedCraft) => {
  const f = props.fit(c);
  const n = c.stickers.length;
  if (!f) return `Needs ${n} empty ${n === 1 ? "slot" : "slots"}`;
  const s = [...f.slots].sort((a, b) => a - b);
  return `Slot${s.length > 1 ? "s" : ""} ${s[0] + 1}${s.length > 1 ? `–${s[s.length - 1] + 1}` : ""}${f.moved ? ` · moves ${f.moved} along` : ""}`;
};

// ---- open and shut: a click on the lip, or a finger dragging it ----------------------
const open = ref(false);
/** How far a finger has pulled the drawer from where it rests, in px (up is negative). */
const pull = ref(0);
let drag: { id: number; y: number; open: boolean; moved: boolean } | null = null;
const height = computed(() => Math.max(LIP, Math.min(PANEL, (open.value ? PANEL : LIP) - pull.value)));
function lipDown(e: PointerEvent) {
  if (e.button !== 0) return;
  drag = { id: e.pointerId, y: e.clientY, open: open.value, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function lipMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) pull.value = dy;
}
function lipUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  const dy = e.clientY - d.y;
  pull.value = 0;
  if (!d.moved) open.value = !open.value;
  else open.value = d.open ? dy < 48 : dy < -48;
}
const dragging = computed(() => pull.value !== 0);

function place(c: SavedCraft) {
  if (!props.fit(c)) {
    const n = c.stickers.length;
    emit("notify", `“${c.name}” needs ${n} empty sticker ${n === 1 ? "slot" : "slots"} on this gun.`, "error");
    return;
  }
  emit("place", c);
  open.value = false;
}

// ---- managed in place ------------------------------------------------------------
const renaming = ref<string | null>(null);
async function rename(c: SavedCraft, name: string) {
  renaming.value = null;
  const next = name.trim().slice(0, 40);
  if (!next || next === c.name) return;
  const was = c.name;
  c.name = next;
  try {
    await saveCraft(c);
  } catch {
    c.name = was;
    emit("notify", `Couldn't rename “${was}” — try again.`, "error");
  }
}
const publishing = ref<Set<string>>(new Set());
async function togglePublish(c: SavedCraft) {
  if (publishing.value.has(c.id)) return;
  const on = !published.value.has(c.id);
  publishing.value = new Set([...publishing.value, c.id]);
  try {
    await setPublished(c.id, on);
    const next = new Set(published.value);
    if (on) next.add(c.id);
    else next.delete(c.id);
    published.value = next;
    emit("notify", on ? `“${c.name}” is in the Craft Store.` : `“${c.name}” is private again.`, "success");
  } catch {
    emit("notify", on ? `Couldn't publish “${c.name}” — try again.` : `Couldn't take “${c.name}” out of the store — try again.`, "error");
  } finally {
    publishing.value = new Set([...publishing.value].filter((x) => x !== c.id));
  }
}
/** A delete waits out a few seconds of Undo before it reaches the server. */
const removed = ref<{ craft: SavedCraft; at: number } | null>(null);
let removeTimer: ReturnType<typeof setTimeout> | undefined;
function remove(c: SavedCraft) {
  settle();
  const list = library.value ?? [];
  const at = list.findIndex((x) => x.id === c.id);
  library.value = list.filter((x) => x.id !== c.id);
  removed.value = { craft: c, at };
  removeTimer = setTimeout(settle, 6000);
}
function undo() {
  const r = removed.value;
  if (!r) return;
  clearTimeout(removeTimer);
  removed.value = null;
  const list = (library.value ?? []).slice();
  list.splice(Math.max(0, Math.min(r.at, list.length)), 0, r.craft);
  library.value = list;
}
function settle() {
  const r = removed.value;
  clearTimeout(removeTimer);
  removed.value = null;
  if (r) void deleteCraft(r.craft.id).catch(() => emit("notify", `Couldn't delete “${r.craft.name}”.`, "error"));
}
onBeforeUnmount(settle);

const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) };
</script>

<template>
  <div
    class="absolute inset-x-0 bottom-0 z-[6] flex flex-col overflow-hidden border-t border-border bg-card/95 backdrop-blur"
    :class="dragging ? '' : 'transition-[height] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none'"
    :style="{ height: height + 'px' }"
  >
    <!-- The lip: always there, the one handle. touch-none so a finger drags it
         instead of scrolling the page. -->
    <button
      type="button"
      class="relative flex flex-none touch-none select-none items-center gap-2 px-3 text-left"
      :style="{ height: LIP + 'px' }"
      :aria-expanded="open"
      :aria-label="open ? 'Close your crafts' : 'Open your crafts'"
      @pointerdown="lipDown"
      @pointermove="lipMove"
      @pointerup="lipUp"
      @pointercancel="lipUp"
    >
      <span class="pointer-events-none absolute left-1/2 top-1 h-1 w-8 -translate-x-1/2 rounded-full bg-border"></span>
      <Layers class="h-3.5 w-3.5 flex-none text-muted-foreground" />
      <span class="text-f10 uppercase tracking-cs1 text-foreground">Your crafts</span>
      <span class="truncate text-f10 text-muted-foreground">
        <template v-if="library === null && !failed">…</template>
        <template v-else-if="failed">didn't load</template>
        <template v-else-if="forGun.length">{{ forGun.length }} for the {{ weaponName }} · {{ library!.length }} in all</template>
        <template v-else>{{ library!.length }}</template>
      </span>
      <ChevronUp class="ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform duration-300" :class="open ? 'rotate-180' : ''" />
    </button>

    <div v-if="open || dragging" class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-none flex-wrap items-center gap-1.5 px-3 pb-2">
        <div class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5" role="tablist" aria-label="Which crafts">
          <button
            v-if="model"
            role="tab"
            class="rounded px-2.5 py-1 text-f10 uppercase tracking-cs1 transition-colors"
            :class="shownScope === 'gun' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :aria-selected="shownScope === 'gun'"
            @click="scope = 'gun'"
          >For the {{ weaponName }} <span class="font-mono text-muted-foreground/70">{{ forGun.length }}</span></button>
          <button
            role="tab"
            class="rounded px-2.5 py-1 text-f10 uppercase tracking-cs1 transition-colors"
            :class="shownScope === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :aria-selected="shownScope === 'all'"
            @click="scope = 'all'"
          >All <span class="font-mono text-muted-foreground/70">{{ library?.length ?? 0 }}</span></button>
        </div>
        <label class="flex h-8 min-w-[140px] flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-muted-foreground focus-within:border-[color:var(--acc)]">
          <Search class="h-3.5 w-3.5 flex-none" />
          <input v-model="query" type="search" class="min-w-0 flex-1 bg-transparent text-f11 text-foreground outline-none" placeholder="Search" aria-label="Search your crafts" />
        </label>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div v-if="library === null" class="grid place-items-center py-8 text-muted-foreground">
          <Loader2 v-if="!failed" class="h-4 w-4 animate-spin" />
          <button v-else class="text-f11 underline" @click="load">Your crafts didn't load — try again</button>
        </div>
        <div v-else-if="!shown.length" class="py-8 text-center text-f11 text-muted-foreground">
          <template v-if="query.trim()">No crafts match “{{ query.trim() }}”.</template>
          <template v-else-if="shownScope === 'gun'">No crafts made for the {{ weaponName }} yet.</template>
          <template v-else>No crafts yet — make one on the Sticker Crafts tab.</template>
        </div>
        <div v-else class="grid gap-2.5" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 130 : 150}px, 1fr))` }">
          <div
            v-for="c in shown"
            :key="c.id"
            class="group/card relative flex min-w-0 cursor-pointer flex-col gap-1"
            :class="fit(c) ? '' : 'opacity-45'"
            role="button"
            tabindex="0"
            :aria-label="(fit(c) ? 'Put ' : 'Too big for this gun: ') + c.name + (fit(c) ? ' on the gun' : '')"
            @click="renaming !== c.id && place(c)"
            @keydown.enter.self="place(c)"
            @keydown.f2.self.prevent="renaming = c.id"
          >
            <span class="relative block aspect-[2/1] overflow-hidden rounded border border-border bg-[#183a31] transition-colors group-hover/card:border-[hsl(var(--tac-amber)/0.45)]">
              <img v-if="c.preview" :src="c.preview" alt="" class="h-full w-full object-cover" draggable="false" />
              <span v-else class="flex h-full items-center justify-center gap-1 p-1">
                <img v-for="(s, si) in c.stickers" :key="si" :src="s.image" alt="" class="h-1/2 object-contain" draggable="false" />
              </span>
              <span
                class="absolute right-1 top-1 flex gap-0.5 rounded bg-background/85 transition-opacity"
                :class="compact ? '' : 'opacity-0 focus-within:opacity-100 group-hover/card:opacity-100'"
              >
                <button
                  class="grid h-6 w-6 place-items-center rounded transition-colors disabled:opacity-40"
                  :class="published.has(c.id) ? 'text-[hsl(var(--success,142_70%_55%))]' : 'text-muted-foreground hover:text-foreground'"
                  :disabled="publishing.has(c.id)"
                  :aria-pressed="published.has(c.id)"
                  :aria-label="published.has(c.id) ? 'In the Craft Store — make it private' : 'Publish to the Craft Store'"
                  :title="published.has(c.id) ? 'In the Craft Store — click to make it private' : 'Private — click to publish it'"
                  @click.stop="togglePublish(c)"
                >
                  <Loader2 v-if="publishing.has(c.id)" class="h-3.5 w-3.5 animate-spin" />
                  <Globe v-else-if="published.has(c.id)" class="h-3.5 w-3.5" />
                  <Lock v-else class="h-3.5 w-3.5" />
                </button>
                <button class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground" :aria-label="'Rename ' + c.name" title="Rename (F2)" @click.stop="renaming = c.id">
                  <Pencil class="h-3.5 w-3.5" />
                </button>
                <button class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-[#ff7a6a]" :aria-label="'Delete ' + c.name" title="Delete — you can undo it" @click.stop="remove(c)">
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </span>
            </span>
            <span class="flex min-w-0 items-center gap-1">
              <span v-if="published.has(c.id)" class="h-1.5 w-1.5 flex-none rounded-full bg-[hsl(var(--success,142_70%_55%))]"></span>
              <input
                v-if="renaming === c.id"
                v-focus
                class="h-6 min-w-0 flex-1 rounded border border-[hsl(var(--tac-amber)/0.45)] bg-background px-1 text-f11 text-foreground outline-none"
                :value="c.name"
                maxlength="40"
                aria-label="Craft name"
                @click.stop
                @keydown.stop.enter="rename(c, ($event.target as HTMLInputElement).value)"
                @keydown.stop.esc="renaming = null"
                @blur="rename(c, ($event.target as HTMLInputElement).value)"
              />
              <span v-else class="min-w-0 flex-1 truncate text-f11 text-foreground" title="Double-click to rename" @dblclick.stop="renaming = c.id">{{ c.name }}</span>
            </span>
            <span class="truncate text-f9 text-muted-foreground">{{ fitText(c) }}</span>
          </div>
        </div>
      </div>

      <!-- Undo for a delete, before it reaches the server. -->
      <div v-if="removed" class="flex flex-none items-center gap-3 border-t border-border px-3 py-2 text-f11" role="status">
        <span class="min-w-0 flex-1 truncate">Deleted “{{ removed.craft.name }}”</span>
        <button class="flex-none rounded-sm px-2 py-1 text-f10 font-bold uppercase tracking-cs1 text-[hsl(var(--tac-amber))] hover:bg-muted" @click="undo">Undo</button>
      </div>
    </div>
  </div>
</template>
