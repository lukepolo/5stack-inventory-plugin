<script setup lang="ts">
/**
 * Developer HUD — the switches behind the 3D viewer's debug rendering.
 *
 * Everything here used to be a query param you had to know existed. The panel
 * exists so the flags are DISCOVERABLE: each one says what it does and whether
 * it needs a remount, and the header says how many are off their default, so a
 * flag left on is visible rather than something you rediscover an hour later
 * wondering why every agent is covered in coloured rectangles.
 *
 * Gated by devToolsEnabled() — always on in dev, opt-in from the admin console
 * in production. See devFlags.ts.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { X, RotateCcw } from "lucide-vue-next";
import { FLAGS, activeFlags, flagValue, flagsVersion, resetFlags, setFlag, type DevFlag } from "../devFlags";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

// Read through the version ref so a toggle re-renders the list. localStorage has
// no reactivity of its own, and polling it would be worse than a counter.
const groups = computed<[string, DevFlag[]][]>(() => {
  void flagsVersion.value;
  const by = new Map<string, DevFlag[]>();
  for (const f of FLAGS) by.set(f.group, [...(by.get(f.group) ?? []), f]);
  return [...by.entries()];
});
const activeCount = computed(() => {
  void flagsVersion.value;
  return activeFlags().length;
});
const isOn = (f: DevFlag) => {
  void flagsVersion.value;
  return flagValue(f.name);
};

/**
 * Flags are read at module load or at mount, so a live viewer does not see a
 * change. Rather than pretend otherwise, the panel says a reload is pending and
 * offers the reload — which is also the only way to be sure every one of them
 * took, since they are read in several places at several times.
 */
const dirty = ref(false);
function toggle(f: DevFlag) {
  setFlag(f.name, !flagValue(f.name));
  if (f.remount !== false) dirty.value = true;
}
function reset() {
  resetFlags();
  dirty.value = true;
}
const reload = () => window.location.reload();

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- NO POSITIONING OF ITS OWN — the caller supplies it.
       This started as `position: fixed`, which never appeared: the plugin is
       federated into the 5stack panel, and a fixed element is positioned against
       the nearest ancestor with a transform, not the viewport. The panel has
       several. Rendering inside the viewer pane and letting that pane's own
       absolute context place it is the thing that actually works — and it is
       also where the switches belong, next to the model they change. -->
  <div
    v-if="open"
    class="w-[320px] rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur"
  >
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <span class="text-f10 uppercase tracking-cs2 text-muted-foreground">Developer</span>
      <span
        v-if="activeCount"
        class="rounded bg-[color:var(--acc)]/15 px-1.5 py-0.5 font-mono text-f9 text-[color:var(--acc)]"
      >{{ activeCount }} on</span>
      <span class="flex-1"></span>
      <button
        class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        title="Back to defaults"
        @click="reset"
      ><RotateCcw class="h-3.5 w-3.5" /></button>
      <button
        class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        title="Close (Esc)"
        @click="emit('close')"
      ><X class="h-3.5 w-3.5" /></button>
    </div>

    <div class="max-h-[60vh] overflow-y-auto p-2">
      <div v-for="[name, list] in groups" :key="name" class="mb-2 last:mb-0">
        <div class="px-1 pb-1 text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ name }}</div>
        <button
          v-for="f in list"
          :key="f.name"
          class="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/50"
          @click="toggle(f)"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-f11" :class="isOn(f) ? 'text-[#f2c14e]' : 'text-foreground'">{{ f.label }}</span>
            <span class="block text-f9 leading-snug text-muted-foreground">{{ f.hint }}</span>
          </span>
          <!-- The app's switch, not a bespoke one — same geometry and the same
               amber as the StatTrak toggle in the craft form. A settings switch
               that looks different in one panel reads as a different control. -->
          <span
            role="switch"
            :aria-checked="isOn(f)"
            class="relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors"
            :class="isOn(f) ? 'bg-[#e0a92e]' : 'bg-muted'"
          >
            <span
              class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              :class="isOn(f) && 'translate-x-4'"
            ></span>
          </span>
        </button>
      </div>
    </div>

    <div v-if="dirty" class="flex items-center gap-2 border-t border-border px-3 py-2">
      <span class="flex-1 text-f9 text-muted-foreground">Read at load — reload to apply.</span>
      <button
        class="rounded border border-[color:var(--acc)]/45 bg-[color:var(--acc)]/12 px-2 py-1 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
        @click="reload()"
      >Reload</button>
    </div>
  </div>
</template>
