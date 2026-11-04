<script setup lang="ts">
// THE undo toast: something was removed at once, and for a few seconds it can
// be put back. The inventory's staged delete and the Sticker Crafts mat both
// use it, so taking a thing back reads and works the same everywhere. The
// caller owns the timer, what Undo restores and what Dismiss settles; this
// owns the look and the motion. Where it sits is the caller's too (a class on
// it), since the mat's rises over its own picker.
import { Trash2 } from "lucide-vue-next";

defineProps<{
  /** What happened, e.g. "Removed “Howling Dawn”". Null hides it. */
  label: string | null;
  /** The Undo button's tooltip (a keyboard shortcut, where there is one). */
  undoTitle?: string;
  /** The ✕'s tooltip — what dismissing does (settles it now). */
  dismissTitle?: string;
}>();
const emit = defineEmits<{ (e: "undo"): void; (e: "dismiss"): void }>();
</script>

<template>
  <Transition
    enter-active-class="transition duration-200"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition duration-150"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="label"
      class="pointer-events-auto flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-f13 shadow-2xl"
      role="status"
    >
      <Trash2 class="h-3.5 w-3.5 flex-none text-muted-foreground" />
      <span class="max-w-[380px] truncate">{{ label }}</span>
      <button
        class="flex-none rounded-sm px-2 py-1 text-f11 font-bold uppercase tracking-cs1 text-[hsl(var(--tac-amber,33_94%_58%))] transition-colors hover:bg-muted"
        :title="undoTitle"
        @click="emit('undo')"
      >
        Undo
      </button>
      <button
        class="flex-none text-muted-foreground transition-colors hover:text-foreground"
        :title="dismissTitle ?? 'Dismiss'"
        :aria-label="dismissTitle ?? 'Dismiss'"
        @click="emit('dismiss')"
      >✕</button>
    </div>
  </Transition>
</template>
