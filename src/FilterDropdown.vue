<script setup lang="ts">
// THE toolbar dropdown (rarity, sort). The native <select> rendered as an OS
// menu — visibly foreign next to the app's own popovers — and every toolbar
// control had drifted to its own height. One h-8 button + the same bordered
// card menu the context menus use, for all of them.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string; color?: string | null; disabled?: boolean }[];
  /** Static prefix on the closed button, e.g. "Sort" -> "Sort · Name". */
  prefix?: string;
  /** Rarity mode: color dots on the rows and the closed button. */
  dots?: boolean;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const open = ref(false);
const current = computed(() => props.options.find((o) => o.value === props.modelValue));
function pick(v: string) {
  emit("update:modelValue", v);
  open.value = false;
}
// Capture phase so Escape closes the menu WITHOUT also bubbling into App's
// global escape chain (which would pop a modal underneath at the same time).
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    e.stopPropagation();
    open.value = false;
  }
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
      class="absolute left-0 top-full z-[91] mt-1 min-w-full origin-top-left animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl"
    >
      <!-- Active row wears the same tinted fill as the filter-sheet chips. -->
      <button
        v-for="o in options"
        :key="o.value"
        class="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-f11 uppercase tracking-wide transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :class="modelValue === o.value ? 'text-foreground' : 'text-muted-foreground'"
        :style="modelValue === o.value
          ? { background: `color-mix(in srgb, ${o.color ?? 'var(--acc)'} 16%, transparent)` }
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
    </div>
  </div>
</template>
