<script setup lang="ts">
// THE toolbar dropdown (rarity, sort). The native <select> rendered as an OS
// menu — visibly foreign next to the app's own popovers — and every toolbar
// control had drifted to its own height. One h-8 button + the same bordered
// card menu the context menus use, for all of them.
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, ChevronDown, Search, X } from "lucide-vue-next";

const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string; color?: string | null; disabled?: boolean }[];
  /** Static prefix on the closed button, e.g. "Sort" -> "Sort · Name". */
  prefix?: string;
  /** Rarity mode: color dots on the rows and the closed button. */
  dots?: boolean;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const tr = inject<(k: string, f: string, n?: Record<string, unknown>) => string>("tr", (_k, f) => f);

const open = ref(false);
const current = computed(() => props.options.find((o) => o.value === props.modelValue));
function pick(v: string) {
  emit("update:modelValue", v);
  open.value = false;
}

// ---- Filtering the menu itself ---------------------------------------------
//
// Only past a threshold, and that threshold is the point: Sort has three
// options and Rarity six, where a search box is a second thing to read before
// you can click the obvious one. Collection has SIXTY-TWO — every tournament
// and capsule that ever shipped — and scrolling that to find "2014 EMS One
// Katowice" is what made the sticker we were looking for feel absent even
// after it was there.
const SEARCHABLE_FROM = 12;
const searchable = computed(() => props.options.length >= SEARCHABLE_FROM);
const q = ref("");
const searchEl = ref<HTMLInputElement | null>(null);
const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(needle));
});
// Opening always starts from the full list — a query left over from last time
// would read as a broken menu. Focus after the v-if has actually mounted it.
watch(open, async (isOpen) => {
  q.value = "";
  if (isOpen && searchable.value) {
    await nextTick();
    searchEl.value?.focus();
  }
});
// Enter takes the only thing you can mean. Guarded on a single match rather
// than "the first one": with several left, picking the top one silently is a
// worse outcome than doing nothing and letting you keep typing.
function onEnter() {
  const only = shown.value.filter((o) => !o.disabled);
  if (only.length === 1) pick(only[0].value);
}
// Capture phase so Escape closes the menu WITHOUT also bubbling into App's
// global escape chain (which would pop a modal underneath at the same time).
// With a query in the box Escape clears it FIRST — one key, innermost thing
// first, so it can't throw away the menu you were mid-way through narrowing.
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !open.value) return;
  e.stopPropagation();
  if (q.value) {
    q.value = "";
    searchEl.value?.focus();
    return;
  }
  open.value = false;
}
onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div class="relative">
    <button
      class="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-f11 uppercase tracking-wide transition-colors hover:text-foreground"
      :class="(dots && modelValue) || open ? 'text-foreground' : 'text-muted-foreground'"
      :style="open ? { borderColor: 'var(--acc)' } : {}"
      @click="open = !open"
    >
      <span
        v-if="dots"
        class="h-2 w-2 flex-none rounded-full"
        :style="current?.color
          ? { background: current.color, boxShadow: `0 0 6px ${current.color}` }
          : { border: '1px solid hsl(var(--border))' }"
      ></span>
      <span class="truncate">{{ prefix ? prefix + ' · ' : '' }}{{ current?.label ?? '—' }}</span>
      <ChevronDown class="h-3 w-3 flex-none opacity-60 transition-transform" :class="open && 'rotate-180'" />
    </button>
    <div v-if="open" class="fixed inset-0 z-[90]" @click="open = false"></div>
    <div
      v-if="open"
      class="absolute left-0 top-full z-[91] mt-1 flex max-h-[min(60vh,26rem)] min-w-full origin-top-left animate-menu-in flex-col rounded-md border border-border bg-card shadow-2xl"
    >
      <!-- Sticky rather than scrolling away with the rows: the whole point is to
           still be reachable 60 collections down. -->
      <div v-if="searchable" class="relative flex-none border-b border-border p-1.5">
        <Search class="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref="searchEl"
          v-model="q"
          :placeholder="tr('inventory.filters.search', 'Filter {count} …', { count: options.length })"
          class="h-7 w-full rounded border border-border bg-background pl-8 pr-7 text-f11 outline-none focus:border-[color:var(--acc)]"
          @keydown.enter.prevent="onEnter"
        />
        <button
          v-if="q"
          class="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
          :title="tr('inventory.filters.search_clear', 'Clear filter')"
          @click="q = ''; searchEl?.focus()"
        ><X class="h-3 w-3" /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <!-- Active row: the panel's own neutral `accent`, which is what its
           SelectItem uses (components/ui/select/SelectItem.vue -> focus:bg-accent).
           This used to be a 16% wash of var(--acc), and on CT that is a blue the
           panel has nowhere else — the plugin invents #4a8fe0 for the team accent,
           while the panel ships one brand colour (--tac-amber) plus neutral greys.
           A RARITY row keeps its own tint: that colour is the item's, carried by
           the dot and the label already, and is not the invented accent. -->
      <button
        v-for="o in shown"
        :key="o.value"
        class="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-f11 uppercase tracking-wide transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :class="[
          modelValue === o.value ? 'text-foreground' : 'text-muted-foreground',
          modelValue === o.value && !o.color ? 'bg-accent' : '',
        ]"
        :style="modelValue === o.value && o.color
          ? { background: `color-mix(in srgb, ${o.color} 16%, transparent)` }
          : {}"
        :disabled="o.disabled"
        @click="pick(o.value)"
      >
        <span
          v-if="dots"
          class="h-2 w-2 flex-none rounded-full"
          :style="o.color ? { background: o.color, boxShadow: `0 0 6px ${o.color}` } : { border: '1px solid hsl(var(--border))' }"
        ></span>
        <span :style="o.color ? { color: o.color } : {}">{{ o.label }}</span>
        <Check v-if="modelValue === o.value" class="ml-auto h-3.5 w-3.5 flex-none pl-1" />
      </button>
      <!-- Says so, rather than showing an empty card that reads as a hung menu. -->
      <div v-if="!shown.length" class="px-3 py-2 text-f11 uppercase tracking-wide text-muted-foreground">
        {{ tr('inventory.filters.no_match', 'No match') }}
      </div>
      </div>
    </div>
  </div>
</template>
