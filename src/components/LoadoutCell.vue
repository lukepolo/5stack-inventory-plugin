<script setup lang="ts">
/**
 * ONE loadout cell. There were six.
 *
 * Compact equipment, compact weapon, desktop knife/gloves, desktop agent, the
 * small extras rail and desktop weapon were six near-copies of the same 60 lines
 * inline in App.vue. They had already drifted — the agent cell lost its name and
 * float, the extras rail lost its price — and every fact added since was added
 * to some of them. StatTrak, stickers and charms were never added to any, which
 * is why an AK with a charm and a StatTrak module rendered in the loadout as a
 * bare name while the same item in the inventory grid showed all of it.
 *
 * WHAT LIVES HERE: the interior — label, price, status marks, hover actions, the
 * art well, and the footer row of name + badges + float. The differences between
 * the six are props, not copies: `showName` / `showWear` / `showPrice` /
 * `showBadges` cover the agent and rail outliers, which deliberately carry less.
 *
 * WHAT DOES NOT: anything positional or stateful. The root is a single <button>,
 * so `:class`, `:style` and every native listener the parent writes — click,
 * contextmenu, dragstart, dragover, dragleave, drop — fall through to it
 * untouched. That is deliberate: the drag-to-equip, drag-to-reorder and
 * long-press wiring is the most delicate code in the app, and it did not move.
 */
import { computed, inject } from "vue";
import ItemArt from "./ItemArt.vue";
import ItemBadges from "./ItemBadges.vue";
import ItemName from "./ItemName.vue";
import MusicPlayer from "./MusicPlayer.vue";
import { formatDuration, musicPreview } from "../musicPreview";
import PriceTag from "./PriceTag.vue";
import SlotStatus from "./SlotStatus.vue";
import TileActions from "./TileActions.vue";
import WearBar from "./WearBar.vue";
import { Clock, Loader2 } from "lucide-vue-next";
import { cn } from "@5stack/ui";
import { ART_FADE_B, CARD_ART, glowStyle } from "../itemVisuals";
import type { LoadoutCellProps } from "./loadoutCellProps";

const props = withDefaults(
  defineProps<LoadoutCellProps>(),
  {
    label: "",
    item: null,
    inst: null,
    badges: null,
    image: null,
    audio: null,
    fallback: "Default",
    strip: false,
    teams: null,
    value: null,
    valueTip: "",
    valueMissing: false,
    wear: null,
    seed: null,
    rarity: null,
    dim: false,
    baking: false,
    queued: false,
    index: 0,
    artKey: "",
    fadeArt: false,
    padArt: false,
    focusAction: false,
    fadeStatusOnHover: false,
    compact: false,
    showName: true,
    showWear: true,
    showPrice: true,
    showBadges: true,
  },
);

/**
 * The kit's length for the caption, or "" while it is unknown.
 *
 * Read straight off the shared cache rather than plumbed down as a prop: the
 * length is a fact about the FILE, discovered asynchronously once the player
 * scrolls into view, and threading that back up through cellFacts would make
 * every loadout cell re-render each time any kit on the page measured itself.
 * Empty until known — a blank caption is right, "0:00" is a lie.
 */
const audioLength = computed(() => {
  const seconds = props.audio ? musicPreview.durationOf(props.audio) : 0;
  return seconds > 0 ? formatDuration(seconds) : "";
});

const tr = inject<(k: string, f: string) => string>("tr", (_k, f) => f);

defineEmits<{
  (e: "view3d" | "inspect" | "edit" | "duplicate" | "remove" | "focus"): void;
}>();
</script>

<template>
  <button
    class="group relative flex flex-col overflow-hidden rounded-lg border p-2.5 text-left transition-colors"
  >
    <span class="pointer-events-none absolute inset-0" :style="glowStyle(rarity ?? undefined, 0.35)"></span>

    <SlotStatus
      :teams="teams"
      :inst="inst"
      :compact="compact"
      :class="fadeStatusOnHover ? '!right-2.5 !top-2.5 transition-opacity group-hover:opacity-0' : ''"
    />
    <!-- The same cluster every slot and tile carries. It used to be hand-rolled
         per cell, which is how some of them ended up offering Edit on a
         read-only Steam item. -->
    <TileActions
      v-if="inst || focusAction"
      :inst="inst ?? null"
      :focus="focusAction"
      :compact="compact"
      @focus="$emit('focus')"
      @view3d="$emit('view3d')"
      @inspect="$emit('inspect')"
      @edit="$emit('edit')"
      @duplicate="$emit('duplicate')"
      @remove="$emit('remove')"
    />

    <!-- Label, then the price under it: the cell's quietest corner, reading
         top-down as "what it is, what it's worth".
         The price is ABSOLUTE, and that is the whole point. In flow it took its
         line out of CARD_ART — which is `flex-1` — so switching values on visibly
         shrank every weapon in the loadout. Money is an overlay on an item, and
         turning an overlay on must not resize the thing underneath it. -->
    <div v-if="!compact" class="relative z-[2] min-w-0">
      <!-- The slot name steps aside on hover, exactly as the status marks do
           (see fadeStatusOnHover) — the action cluster sits at the top-right of
           this same row, and on a short cell the two meet in the middle, leaving
           a truncated word wedged under three buttons.

           FADED, not moved. Sliding the name down would push into CARD_ART,
           which is flex-1 — the same mistake the price above is absolute to
           avoid, and it would resize the art on every hover. It would also make
           a grid of cells twitch as the cursor crosses them, which reads as the
           page being unstable rather than as room being made.

           Only the NAME goes. The price sits below this line on its own overlay
           and is the thing people hover to read, so it stays put and stays
           legible; what disappears is a label the cell was already truncating.

           Gated on there being a cluster at all: a slot with no actions has
           nothing to make room for, and a name that fades for no reason reads
           as a rendering fault. -->
      <span
        class="block truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70"
        :class="(inst || focusAction) && 'transition-opacity duration-100 group-hover:opacity-0'"
      >{{ label }}</span>
      <PriceTag
        v-if="showPrice"
        class="absolute left-0 top-full z-[2]"
        size="xs"
        :value="value"
        :missing="valueMissing"
        :title="valueTip"
      />
    </div>

    <div
      :key="artKey"
      :class="['animate-cell-in', padArt && 'py-1', CARD_ART]"
      :style="{ '--i': index }"
    >
      <ItemArt
        v-if="image"
        :inst="inst"
        :image="image"
        :class="cn('max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105', fadeArt && ART_FADE_B, dim && 'opacity-60')"
      />
      <span v-else class="text-f10 uppercase text-muted-foreground/50">{{ fallback }}</span>
      <!-- Steps aside on hover, like the name and the status marks. On a short
           cell this chip and the action cluster end up a few pixels apart in the
           same corner of the eye, and "queued" is a thing you glance at rather
           than a thing you are reaching for — so it yields to the buttons and
           comes back when the cursor leaves. -->
      <span
        v-if="baking || queued"
        class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)] transition-opacity duration-100 group-hover:opacity-0"
        ><Loader2 v-if="baking" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" />
        <template v-if="!compact">{{ baking ? tr('inventory.tile.baking', 'baking') : tr('inventory.tile.queued', 'queued') }}</template></span
      >
      <!-- Hear the kit you have on, from the rack itself.
           An OVERLAY on the art rather than a row of its own: the kit lives in
           the extras strip, and those tiles are 70px tall with every pixel of it
           already spoken for — a transport in flow would come straight out of
           CARD_ART, paying for the sound with the only thing that identifies the
           slot.

           No chip, unlike the bake badge above. That badge is a word about an
           item; this is the control FOR the artwork it was covering. At 70px a
           bordered plate with a button and a clock in it was most of the sleeve,
           so the thing meant to represent a kit was hiding the only part of the
           cell that tells one kit from another. MusicPlayer's overlay mode draws
           into the corners instead and leaves the middle alone — see it for how
           it stays legible without a background.

           It can live inside this <button> because every element in it is a
           <span> — see MusicPlayer. -->
      <MusicPlayer v-if="audio" :src="audio" overlay />
    </div>

    <!-- The centred caption the small rail tiles carry instead of a footer.
         A kit's LENGTH rides here rather than on the artwork: it is a fact about
         the item in the same way the slot name is, and printing it over the
         sleeve was the last thing still competing with the only part of the cell
         that tells one kit from another. -->
    <div
      v-if="compact"
      class="relative z-[2] w-full truncate text-center text-f8 uppercase tracking-cs1 text-muted-foreground/70"
    >
      {{ label
      }}<span v-if="audioLength" class="font-mono tabular-nums text-muted-foreground/45">
        · {{ audioLength }}</span>
    </div>

    <div v-else-if="showName || showWear" class="relative z-[2] flex items-end justify-between gap-2">
      <span v-if="showName" class="flex min-w-0 flex-1 items-center gap-1.5">
        <ItemName :item="item" :strip="strip" :fallback="fallback" name-class="text-f11 font-medium" class="min-w-0 flex-1" />
        <!-- StatTrak and what's applied. The loadout showed neither until this
             component existed; the inventory grid has shown both all along. -->
        <ItemBadges v-if="showBadges" :inst="badges ?? inst" :max="3" compact />
      </span>
      <WearBar v-if="showWear" :item="item" :wear="wear" :seed="seed" mini class="mb-1" />
    </div>
  </button>
</template>
