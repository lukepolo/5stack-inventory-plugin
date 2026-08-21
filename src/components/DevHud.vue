<script setup lang="ts">
/**
 * Viewer settings.
 *
 * This started as a developer HUD — a list of debug switches that used to be
 * query params you had to know existed — and it still is that, at the bottom.
 * But bloom is a genuine look preference rather than a diagnostic, and hiding a
 * preference behind a dev gate means nobody finds it. So the panel now has two
 * halves:
 *
 *   · SETTINGS: shown to everyone, safe in any position, changes how the viewer
 *     looks. Declared with `audience: "user"`.
 *   · ADVANCED: everything else. Most of these make a CORRECT render look broken
 *     (patch footprints paint flat colours over the art, flipping patch V mirrors
 *     every placement), which is a support ticket rather than a preference — so
 *     it is collapsed, labelled as diagnostics, and Reset is always in reach.
 *
 * Each control still says what it does and whether it needs a reload, and the
 * header still counts what is off its default — a switch left on should be
 * visible, not something you rediscover an hour later wondering why every agent
 * is covered in coloured rectangles.
 */
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { X, RotateCcw, ChevronRight } from "lucide-vue-next";
import {
  activeFlags, devFlags, devNumbers, flagValue, flagsVersion, numberValue, numbersVersion,
  resetFlags, setFlag, setNumber, userFlags, userNumbers, type DevFlag, type DevNumber,
  choiceValue, choicesVersion, setChoice, userChoices, type DevChoice,
} from "../devFlags";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const tr = inject<(k: string, f: string, n?: Record<string, unknown>) => string>("tr", (_k, f) => f);

// Everything reads through the version refs: localStorage has no reactivity of
// its own, and polling it would be worse than a counter.
const isOn = (f: DevFlag) => {
  void flagsVersion.value;
  return flagValue(f.name);
};
const knobValue = (n: DevNumber) => {
  void numbersVersion.value;
  return numberValue(n.name);
};
/** Hide a knob whose gate flag is off — a bloom slider with bloom off is noise. */
const shown = (list: DevNumber[]) => {
  void flagsVersion.value;
  return list.filter((n) => !n.requires || flagValue(n.requires));
};
const pickValue = (c: DevChoice) => {
  void choicesVersion.value;
  return choiceValue(c.name);
};
/** The hint under a picker is the SELECTED option's, not the setting's — the
 *  setting's label already says what it is; what you want to know is what the
 *  thing you just chose does. */
const pickHint = (c: DevChoice) =>
  c.options.find((o) => o.value === pickValue(c))?.hint ?? c.hint;
/**
 * A picker's options, in sections.
 *
 * Only the lighting rig has enough of them to need it: four studio rigs and
 * every CS2 map the extraction has baked. `map:` on the option's key is what
 * separates them, so a new map appears in the right half without anything here
 * knowing its name.
 */
function sections(c: DevChoice): { title: string; options: DevChoice["options"] }[] {
  const scenes = c.options.filter((o) => o.value.startsWith("map:"));
  if (!scenes.length) return [{ title: "", options: c.options }];
  return [
    { title: "Studio", options: c.options.filter((o) => !o.value.startsWith("map:")) },
    { title: "Maps", options: scenes },
  ];
}
const userPicks = computed(() => userChoices());
const userSwitches = computed(() => userFlags());
const userKnobs = computed(() => shown(userNumbers()));
/** Advanced, grouped, so Patches and Diagnostics stay apart. */
const advanced = computed<[string, DevFlag[], DevNumber[]][]>(() => {
  void flagsVersion.value;
  const names = [...new Set(devFlags().map((f) => f.group))];
  return names.map((g) => [
    g,
    devFlags().filter((f) => f.group === g),
    shown(devNumbers()).filter((n) => n.group === g),
  ]);
});

const activeCount = computed(() => {
  void flagsVersion.value;
  return activeFlags().length;
});

/**
 * Most of these are read at module load or at mount, so a live viewer does not
 * see the change. Rather than pretend otherwise, the panel says a reload is
 * pending and offers it — which is also the only way to be sure every one took,
 * since they are read in several places at several times.
 *
 * The bloom SLIDERS are the exception and deliberately do not set this: the
 * viewer re-reads them every frame, so they move the model as you drag.
 */
const dirty = ref(false);
const advancedOpen = ref(false);

function toggle(f: DevFlag) {
  setFlag(f.name, !flagValue(f.name));
  if (f.remount !== false) dirty.value = true;
}
// `input`, not `change` — live feedback is the whole point of a slider here.
const onKnob = (n: DevNumber, e: Event) => setNumber(n.name, (e.target as HTMLInputElement).valueAsNumber);
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
       This started as `position: fixed` and never appeared, because a fixed
       element is contained by the nearest transformed ancestor rather than the
       viewport, and the host panel had several between here and the document.
       Rendering inside the viewer pane and letting that pane place it was the
       fix. That then cost the panel its bottom edge — the pane's card clips
       with overflow-hidden — so ViewerSettingsButton now teleports this to
       <body> and pins it under the cog, where `fixed` finally means what it
       says. The lesson survives the change: this element still positions
       nothing, and the caller is still the only one that knows where it goes. -->
  <!-- OPAQUE. This was bg-background/95 + backdrop-blur, which is a fine surface
       over a still page and the wrong one here: it floats over a lit 3D model
       and a card that is itself bg-card, so every label in it was competing with
       whatever was moving underneath. Solid `background` also keeps it distinct
       from the `card` it sits on rather than blending into it, and with nothing
       showing through there is no backdrop left to blur. -->
  <div
    v-if="open"
    class="w-[320px] rounded-lg border border-border bg-background shadow-xl"
  >
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <span class="text-f10 uppercase tracking-cs2 text-muted-foreground">{{ tr('inventory.devhud.heading', 'Viewer settings') }}</span>
      <span
        v-if="activeCount"
        class="rounded bg-[color:var(--acc)]/15 px-1.5 py-0.5 font-mono text-f9 text-[color:var(--acc)]"
      >{{ tr('inventory.devhud.changed', '{count} changed', { count: activeCount }) }}</span>
      <button
        class="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        :title="tr('inventory.devhud.reset', 'Back to defaults')"
        @click="reset()"
      ><RotateCcw class="h-3.5 w-3.5" /></button>
      <button
        class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        :title="tr('inventory.devhud.close', 'Close (Esc)')"
        @click="emit('close')"
      ><X class="h-3.5 w-3.5" /></button>
    </div>

    <!-- The cap is the CALLER's now. The panel is teleported to body and pinned
         under the cog, so how much room is left below it is something only the
         thing doing the pinning can measure; 60vh stays the answer whenever the
         viewport allows it. -->
    <div class="overflow-y-auto p-2" :style="{ maxHeight: 'var(--devhud-max, 60vh)' }">
      <!-- USER SETTINGS. No group heading: this IS the panel as far as most
           people are concerned, and a heading over a single section is chrome. -->

      <!-- Pickers first: a lighting rig frames every switch under it, so choosing
           one is the outer decision. Segmented rather than a <select> — there are
           four options and the panel is already 240px of buttons, so a native
           dropdown would be the only OS-chrome control in it. -->
      <div v-for="c in userPicks" :key="c.name" class="rounded px-1.5 py-1.5">
        <span class="block text-f11 text-foreground">{{ c.label }}</span>
        <!-- SPLIT INTO SECTIONS. The lighting picker used to be four studio
             rigs; it is now those four plus fifteen CS2 maps, and nineteen
             buttons in one wrap read as a wall rather than as a choice. The
             split is on the option's own key (`map:` prefixes a scene), so
             nothing here has to be told which is which. -->
        <template v-for="sec in sections(c)" :key="sec.title">
        <span v-if="sec.title" class="mt-2 block text-f9 uppercase tracking-cs2 text-muted-foreground/60">{{ sec.title }}</span>
        <div class="mt-1.5 flex flex-wrap gap-1">
          <button
            v-for="o in sec.options"
            :key="o.value"
            type="button"
            class="rounded border px-2 py-1 text-f10 transition-colors"
            :class="pickValue(c) === o.value
              ? 'border-[#f2c14e] text-[#f2c14e]'
              : 'border-border/60 text-muted-foreground hover:text-foreground'"
            :aria-pressed="pickValue(c) === o.value"
            @click="setChoice(c.name, o.value)"
          >{{ o.label }}</button>
        </div>
        </template>
        <span class="mt-1 block text-f10 leading-snug text-muted-foreground/70">{{ pickHint(c) }}</span>
        <!-- Same note the flags carry: read when the rig is built, so an open
             viewer keeps the old one until it is rebuilt. -->
        <span v-if="c.remount" class="mt-0.5 block text-f9 text-muted-foreground/50">{{ tr('inventory.devhud.remount', 'Reopen the item to apply') }}</span>
      </div>

      <button
        v-for="f in userSwitches"
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

      <div v-for="k in userKnobs" :key="k.name" class="rounded px-1.5 py-1.5">
        <div class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 text-f11 text-foreground">{{ k.label }}</span>
          <span class="flex-none font-mono text-f10 text-[#f2c14e]">{{ knobValue(k).toFixed(2) }}</span>
        </div>
        <input
          type="range"
          class="wear-range mt-1 w-full"
          :min="k.min" :max="k.max" :step="k.step"
          :value="knobValue(k)"
          @input="onKnob(k, $event)"
        />
        <span class="block text-f9 leading-snug text-muted-foreground">{{ k.hint }}</span>
      </div>

      <!-- ADVANCED. Collapsed, and honest about what is in there. -->
      <button
        class="mt-1 flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        @click="advancedOpen = !advancedOpen"
      >
        <ChevronRight class="h-3 w-3 transition-transform" :class="advancedOpen && 'rotate-90'" />
        {{ tr('inventory.devhud.advanced', 'Advanced') }}
      </button>
      <div v-if="advancedOpen">
        <p class="px-1.5 pb-1 text-f9 leading-snug text-muted-foreground/80">
          {{
            tr(
              'inventory.devhud.advanced_note',
              'Rendering diagnostics. Several of these deliberately draw the model wrong so it can be measured — if something looks broken, reset.'
            )
          }}
        </p>
        <div v-for="[name, flags, knobs] in advanced" :key="name" class="mb-2 last:mb-0">
          <div class="px-1 pb-1 text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ name }}</div>
          <button
            v-for="f in flags"
            :key="f.name"
            class="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/50"
            @click="toggle(f)"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-f11" :class="isOn(f) ? 'text-[#f2c14e]' : 'text-foreground'">{{ f.label }}</span>
              <span class="block text-f9 leading-snug text-muted-foreground">{{ f.hint }}</span>
            </span>
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
          <div v-for="k in knobs" :key="k.name" class="rounded px-1.5 py-1.5">
            <div class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 text-f11 text-foreground">{{ k.label }}</span>
              <span class="flex-none font-mono text-f10 text-[#f2c14e]">{{ knobValue(k).toFixed(2) }}</span>
            </div>
            <input
              type="range"
              class="wear-range mt-1 w-full"
              :min="k.min" :max="k.max" :step="k.step"
              :value="knobValue(k)"
              @input="onKnob(k, $event)"
            />
            <span class="block text-f9 leading-snug text-muted-foreground">{{ k.hint }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="dirty" class="flex items-center gap-2 border-t border-border px-3 py-2">
      <span class="flex-1 text-f9 text-muted-foreground">{{ tr('inventory.devhud.reload_note', 'Read at load — reload to apply.') }}</span>
      <button
        class="rounded border border-[color:var(--acc)]/45 bg-[color:var(--acc)]/12 px-2 py-1 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
        @click="reload()"
      >{{ tr('inventory.devhud.reload', 'Reload') }}</button>
    </div>
  </div>
</template>
