<script setup lang="ts">
// Copy-a-link menu, dropped next to the Inspect buttons.
//
// It's a MENU rather than a single button because most things here are
// addressable more than one way — the same skin has an item page, a 3D view and
// a craft editor, and which one you want depends on what you're about to say
// about it. Each row shows the path it will copy, so you can see what you're
// sharing before you paste it somewhere.
import { ref, onBeforeUnmount } from "vue";
import { Share2, Check, Link2 } from "lucide-vue-next";
import type { ShareLink } from "./routes";

const props = defineProps<{
  links: ShareLink[];
  /** Caveat shown at the foot of the menu — e.g. that item links are owner-only. */
  note?: string;
  /** Compact icon-only trigger, for tight toolbars. */
  icon?: boolean;
  label?: string;
}>();

const open = ref(false);
const copied = ref<string | null>(null);
const failed = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(link: ShareLink) {
  clearTimeout(copiedTimer);
  failed.value = false;
  try {
    // Clipboard API needs a secure context. The panel is https in practice, but
    // a plain-http dev host would throw here and silently copy nothing.
    await navigator.clipboard.writeText(link.href);
    copied.value = link.key;
  } catch {
    failed.value = true;
    copied.value = null;
  }
  copiedTimer = setTimeout(() => {
    copied.value = null;
    failed.value = false;
    open.value = false;
  }, 1400);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <div class="relative">
    <button
      :class="[
        props.icon
          ? 'grid h-9 w-9 place-items-center rounded-md border text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground'
          : 'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-f10 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--acc)] hover:text-foreground',
        open ? 'border-[color:var(--acc)] text-foreground' : 'border-border',
      ]"
      title="Copy a link to this"
      @click.stop="open = !open"
    >
      <Share2 class="h-3.5 w-3.5" />
      <span v-if="!props.icon">{{ props.label ?? "Share" }}</span>
    </button>

    <!-- Full-viewport catcher, the same dismissal pattern as the context menus. -->
    <div v-if="open" class="fixed inset-0 z-[1000]" @click="open = false" @contextmenu.prevent="open = false"></div>

    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="absolute right-0 z-[1001] mt-2 min-w-[300px] origin-top-right animate-menu-in overflow-hidden rounded-md border border-border bg-card py-1 shadow-2xl"
        @click.stop
      >
        <div class="border-b border-border px-3 py-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">
          Copy link
        </div>
        <button
          v-for="l in props.links"
          :key="l.key"
          class="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
          @click="copy(l)"
        >
          <component
            :is="copied === l.key ? Check : Link2"
            class="mt-0.5 h-3.5 w-3.5 flex-none"
            :class="copied === l.key ? 'text-[color:var(--acc)]' : 'text-muted-foreground'"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-f13">{{ copied === l.key ? "Copied" : l.label }}</span>
            <span v-if="l.hint" class="block text-f10 text-muted-foreground">{{ l.hint }}</span>
          </span>
        </button>
        <div v-if="failed" class="border-t border-border px-3 py-1.5 text-f10 text-[#ff7a6a]">
          Couldn't reach the clipboard — copy from the address bar instead.
        </div>
        <div v-else-if="props.note" class="border-t border-border px-3 py-1.5 text-f10 leading-relaxed text-muted-foreground">
          {{ props.note }}
        </div>
      </div>
    </Transition>
  </div>
</template>
