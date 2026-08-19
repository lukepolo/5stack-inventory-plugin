<script setup lang="ts">
// THE loadout deck — the desktop preset switcher's open state.
//
// The header used to hold a pill strip of preset names with a square ···
// button beside it. With one preset (most people) that was two outlines for
// one thing — "a LOADOUT 1 button, and a dots button" — and with five it was
// a strip you switched with sitting next to a button that did everything else
// to the same thing. Now the header carries ONE button, the name of the build
// you are on, and it opens this: every build as a card, with the things that
// tell builds apart — how much of the grid is filled, what it's worth — so you
// can pick one without reading five near-identical names.
//
// Switch by clicking a card. Manage a card from the ··· that surfaces on hover
// (or right-click, the same gesture the slots and items use); the menu that
// opens is App's ContextMenu, aimed at that card's preset, so "Delete this
// loadout" has an obvious "this". Creation lives in the footer because it is
// not about any one card.
//
// Desktop only. Compact keeps its name-button + bottom sheet: hover-revealed
// tools don't exist on touch, and a 486px popover has nowhere to go on a phone.
import { computed, nextTick, ref, watch } from "vue";
import { Loader2, MoreHorizontal, Plus, Copy } from "lucide-vue-next";
import PriceTag from "./PriceTag.vue";
import ItemArt from "./ItemArt.vue";
import { Z } from "../zLayers";
import type { LoadoutPreset, PresetPreviewItem, Team } from "../api";

const props = withDefaults(
  defineProps<{
    /** The header button's box — left edge, bottom edge, width. Null = closed. */
    at: { x: number; y: number; w: number } | null;
    presets: readonly LoadoutPreset[];
    /** The build on SCREEN — the owner's active one, or what a visitor is paging through. */
    shownId: string;
    /** The side the header is showing: the meter and the figure are for it. */
    team: Team;
    canEdit: boolean;
    busy: boolean;
    /** Display only — the server is the door (PRESET_LIMIT). */
    limit: number;
    /** Which card is mid-rename (its name becomes an input). Owned by App so the
     *  context menu's Rename… can start it. */
    renaming: string | null;
    /** One side's figure; null when there is nothing honest to print. */
    valueFor: (p: LoadoutPreset, side: Team) => number | null;
    /** Filled weapon positions per side, for the meters; null = unknown (no meters). */
    gunsFor: (p: LoadoutPreset) => { CT: number; T: number } | null;
    /** The hand the card fans: up to five of the build's items for the showing
     *  side. Null = unknown (older backend) — a blank strip, NOT "nothing". */
    previewFor: (p: LoadoutPreset) => PresetPreviewItem[] | null;
    pricesOn: boolean;
  }>(),
  { renaming: null },
);

const emit = defineEmits<{
  (e: "close"): void;
  (e: "switch", id: string): void;
  (e: "menu", id: string, at: { x: number; y: number }): void;
  (e: "rename", id: string, name: string): void;
  (e: "rename-cancel"): void;
  (e: "duplicate"): void;
  (e: "create"): void;
}>();

/** Fifteen weapon positions per side — sp, p1-4, m1-5, r1-5 — the cells the
 *  grid draws. The meter is "how much of THAT grid is filled", nothing else. */
const GUN_SLOTS = 15;
const SIDES: Team[] = ["CT", "T"];
const full = computed(() => props.presets.length >= props.limit);

/* Geometry. Three cards across at the width a name, a meter and a figure need;
   clamped to the viewport so a header near the right edge doesn't push the deck
   off screen. `fixed` rather than absolute-in-the-header: the header clips
   nothing today, but a popover that depends on that is one overflow-hidden
   away from being cut in half. */
const WIDTH = 570;
const style = computed(() => {
  if (!props.at) return {};
  const left = Math.max(8, Math.min(props.at.x, window.innerWidth - WIDTH - 8));
  return { left: `${left}px`, top: `${props.at.y + 6}px`, width: `${WIDTH}px`, zIndex: Z.deck };
});

/* Inline rename. The input is the card's own name slot, so the edit happens
   where the name already is. Blur and Enter commit, Escape is App's (it clears
   `renaming`, which unmounts the input without committing). */
const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
watch(
  () => props.renaming,
  (id) => {
    if (!id) return;
    draft.value = props.presets.find((p) => p.id === id)?.name ?? "";
    void nextTick(() => inputEl.value?.select());
  },
);
function commit() {
  const id = props.renaming;
  if (!id) return;
  emit("rename", id, draft.value);
}

/** A template ref inside v-for collects into an array; only one input ever
 *  exists (one card renames at a time), so a function ref keeps it a single. */
function setInput(el: unknown) {
  inputEl.value = (el as HTMLInputElement | null) ?? null;
}

function onCardMenu(e: MouseEvent | KeyboardEvent, id: string) {
  if (!props.canEdit) return;
  e.preventDefault();
  e.stopPropagation();
  // Keyboard has no cursor: anchor the menu under the ··· itself.
  const at =
    "clientX" in e
      ? { x: e.clientX, y: e.clientY }
      : (() => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          return { x: r.left, y: r.bottom };
        })();
  emit("menu", id, at);
}

/** The rarity glow under a thumb. Not itemVisuals.glowStyle: that blur is
 *  sized for a card's art well and on a 30px cell it washes to nothing. Tighter
 *  spread, softer blur; dimmer under a free default than under a skin. */
function thumbGlow(color: string | null, skinned: boolean) {
  return color
    ? { background: `radial-gradient(70% 80% at 50% 55%, ${color}, transparent 70%)`, filter: "blur(5px)", opacity: skinned ? 0.55 : 0.2 }
    : { opacity: 0 };
}

function pick(id: string) {
  if (props.busy || props.renaming === id) return;
  emit("switch", id);
}

const CARD =
  "group relative flex flex-col gap-2 rounded-md border p-2.5 text-left outline-none transition-colors focus-visible:border-[hsl(var(--tac-amber,33_94%_58%))]";
const FOOT_ROW =
  "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-f11 uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60";
</script>

<template>
  <Transition enter-active-class="transition duration-150" enter-from-class="opacity-0" leave-active-class="transition duration-100" leave-to-class="opacity-0">
    <div
      v-if="at"
      class="fixed inset-0"
      :style="{ zIndex: Z.deck }"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        data-role="preset-deck"
        role="dialog"
        aria-label="Loadouts"
        class="fixed origin-top-left animate-menu-in rounded-lg border border-border bg-card p-2.5 shadow-2xl"
        :style="style"
        @click.stop
      >
        <div class="grid grid-cols-3 gap-2">
          <!-- A div, not a <button>: the rename input lives inside the card,
               and an input inside a disabled button is inert — the one state
               where it has to work is the one where a button would kill it. -->
          <div
            v-for="p in presets"
            :key="p.id"
            role="button"
            :tabindex="busy ? -1 : 0"
            :aria-disabled="busy || undefined"
            :class="[
              CARD,
              busy && 'opacity-60',
              renaming === p.id ? 'cursor-default' : 'cursor-pointer',
              p.id === shownId
                ? 'border-[hsl(var(--tac-amber,33_94%_58%)/0.55)] bg-[hsl(var(--tac-amber,33_94%_58%)/0.08)] text-foreground shadow-[0_0_12px_hsl(var(--tac-amber,33_94%_58%)/0.2)]'
                : 'border-border bg-muted text-muted-foreground hover:border-[hsl(var(--tac-amber,33_94%_58%))] hover:text-foreground',
            ]"
            :title="p.id === shownId ? `${p.name} — the one on screen` : `Switch to ${p.name}`"
            @click="pick(p.id)"
            @keydown.enter.self.prevent="pick(p.id)"
            @contextmenu="onCardMenu($event, p.id)"
          >
            <!-- The hand: five of the build's items, each over its rarity glow,
                 so a card says WHAT the build is — a Doppler, Vice gloves, a
                 Howl — before you read its name. Skinned pieces sit bright;
                 free defaults go dim, because "this slot has a gun in it" is
                 not the same claim as "this slot has YOUR gun in it". An empty
                 build shows its emptiness honestly rather than a blank bar. -->
            <span class="relative flex h-11 items-center gap-0.5 overflow-hidden rounded bg-background/50 px-1" aria-hidden="true">
              <template v-if="previewFor(p)?.length">
                <span
                  v-for="(it, i) in previewFor(p)"
                  :key="it.team + it.slot + i"
                  class="relative grid h-full flex-1 place-items-center overflow-hidden"
                  :title="it.name"
                >
                  <span class="absolute inset-0" :style="thumbGlow(it.rarity, it.skinned)"></span>
                  <ItemArt
                    :image="it.image"
                    class="relative z-[1] max-h-9 max-w-full object-contain drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
                    :class="it.skinned ? '' : 'opacity-40 saturate-0'"
                  />
                </span>
              </template>
              <span v-else-if="previewFor(p)" class="w-full text-center text-f9 uppercase tracking-wider text-muted-foreground/50">Nothing equipped</span>
            </span>

            <!-- Name row. No tick: the lit border and tint already say which
                 card is on screen, and a tick column left every other name
                 indented past an invisible glyph. -->
            <span class="flex min-w-0 items-center gap-1.5">
              <input
                v-if="renaming === p.id"
                :ref="setInput"
                v-model="draft"
                maxlength="24"
                class="h-6 min-w-0 flex-1 rounded border border-[hsl(var(--tac-amber,33_94%_58%))] bg-muted px-1.5 text-f11 uppercase tracking-wider text-foreground outline-none"
                @click.stop
                @keydown.enter.prevent="commit"
                @keydown.esc.stop.prevent="emit('rename-cancel')"
                @blur="commit"
              />
              <span v-else class="min-w-0 flex-1 truncate text-f11 font-semibold uppercase tracking-wider">{{ p.name }}</span>
              <!-- The door to this card's menu. Hover-revealed: five of these
                   at rest would be five buttons competing with the cards they
                   sit on. Right-click on the card is the same door. -->
              <span
                v-if="canEdit"
                role="button"
                tabindex="0"
                class="-my-1 -mr-1 grid h-5 w-5 flex-none place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-[hsl(var(--tac-amber,33_94%_58%)/0.18)] hover:text-[hsl(var(--tac-amber,33_94%_58%))] focus-visible:opacity-100 group-hover:opacity-100"
                title="Manage this loadout"
                @click="onCardMenu($event, p.id)"
                @keydown.enter="onCardMenu($event, p.id)"
              >
                <MoreHorizontal class="h-3.5 w-3.5" />
              </span>
            </span>

            <!-- Both sides, one row each: the side's fifteen weapon cells as a
                 meter — the same fifteen the grid draws, so "12/15" is a number
                 you can check against the screen — then what that side is
                 worth. Team-coloured the way the header toggle is, so the rows
                 read as CT and T without reading the letters. Draws nothing
                 when the counts are unknown rather than two rows of empty ticks
                 that would read as "this build is empty". -->
            <template v-if="gunsFor(p)">
              <span
                v-for="side in SIDES"
                :key="side"
                class="flex items-center gap-1"
                :style="{ '--side': side === 'CT' ? 'var(--tac-ct, 198 100% 67%)' : 'var(--tac-amber, 33 94% 58%)' }"
                :title="`${gunsFor(p)?.[side] ?? 0} of ${GUN_SLOTS} weapon slots filled on ${side}`"
              >
                <span class="w-4 flex-none font-mono text-f9 font-semibold uppercase text-[hsl(var(--side))]">{{ side }}</span>
                <span class="flex items-center gap-[2px]" aria-hidden="true">
                  <i
                    v-for="n in GUN_SLOTS"
                    :key="n"
                    class="block h-2 w-[2px] rounded-[1px]"
                    :class="n <= (gunsFor(p)?.[side] ?? 0) ? 'bg-[hsl(var(--side))]' : 'bg-muted-foreground/25'"
                  ></i>
                </span>
                <span class="font-mono text-f9 tabular-nums text-muted-foreground/70">{{ gunsFor(p)?.[side] ?? 0 }}/{{ GUN_SLOTS }}</span>
                <span class="ml-auto">
                  <PriceTag v-if="pricesOn" :value="valueFor(p, side)" size="xs" />
                </span>
              </span>
            </template>
            <span v-else class="font-mono text-f9 tabular-nums text-muted-foreground/70">{{ p.slots }} slot{{ p.slots === 1 ? "" : "s" }}</span>

          </div>

          <!-- The empty card IS the "new" action: a dashed outline where the
               next build would sit. Hidden at the limit — the footer says why. -->
          <button
            v-if="canEdit && !full"
            type="button"
            class="grid min-h-[112px] place-items-center rounded-md border border-dashed border-border text-f11 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[hsl(var(--tac-amber,33_94%_58%))] hover:text-foreground disabled:opacity-60"
            :disabled="busy"
            title="Start an empty loadout"
            @click="emit('create')"
          >
            <span class="flex items-center gap-1.5"><Plus class="h-3.5 w-3.5" /> New loadout</span>
          </button>
        </div>

        <!-- Creation, not management: these are about the SET of builds, so
             they don't belong to any one card. Duplicate leads — rebuilding
             fifteen craft-gated slots by hand is the whole reason presets exist. -->
        <div v-if="canEdit" class="mt-2.5 flex items-center gap-1 border-t border-border pt-2.5">
          <button v-if="!full" type="button" :class="FOOT_ROW" :disabled="busy" @click="emit('duplicate')">
            <Loader2 v-if="busy" class="h-3.5 w-3.5 animate-spin" />
            <Copy v-else class="h-3.5 w-3.5" />
            Duplicate this loadout
          </button>
          <!-- A sentence, not an action, so it gets no hover. -->
          <span v-else class="px-2.5 py-1.5 text-f11 leading-relaxed text-muted-foreground">
            {{ limit }} loadouts is the limit — delete one to make room.
          </span>
          <span class="ml-auto text-f9 uppercase tracking-cs4 text-muted-foreground/50">{{ presets.length }}/{{ limit }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
