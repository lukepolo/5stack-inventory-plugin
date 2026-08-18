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
import ItemArt from "./ItemArt.vue";
import ItemBadges from "./ItemBadges.vue";
import ItemName from "./ItemName.vue";
import PriceTag from "./PriceTag.vue";
import SlotStatus from "./SlotStatus.vue";
import TileActions from "./TileActions.vue";
import WearBar from "./WearBar.vue";
import { Clock, Loader2 } from "lucide-vue-next";
import { cn } from "@5stack/ui";
import { ART_FADE_B, CARD_ART, glowStyle } from "../itemVisuals";
import type { CatalogItem, InventoryItem, Team } from "../api";

withDefaults(
  defineProps<{
    /** The slot's own caption — "AK-47", "Agent · CT", "Music Kit". */
    label?: string;
    item?: CatalogItem | null;
    /** The owned instance, or null for a free default. Drives the marks, the
     *  hover actions and the badges. */
    inst?: InventoryItem | null;
    image?: string | null;
    /** Muted text when the slot holds nothing crafted. */
    fallback?: string;
    /** Drop the weapon prefix — weapon cells already say "AK-47" above. */
    strip?: boolean;
    teams?: Team[] | null;
    value?: number | null;
    valueTip?: string;
    /** The slot holds something the mirror couldn't price — see PriceTag. */
    valueMissing?: boolean;
    wear?: number | null;
    seed?: number | null;
    /** Rarity colour for the glow wash. The border stripe is the parent's, since
     *  it rides on the same style binding as the selection ring. */
    rarity?: string | null;
    /** Default/unskinned art sits back so a crafted slot reads as the filled one. */
    dim?: boolean;
    /** A card render is in flight for this instance. */
    baking?: boolean;
    queued?: boolean;
    /** Entrance stagger index, and the key that re-runs it — switching sides or
     *  replacing the weapon should sweep, not teleport. */
    index?: number;
    artKey?: string;
    /** Agents are waist-cropped and need the bottom feather. */
    fadeArt?: boolean;
    /** Equipment cells breathe a little more around the art. */
    padArt?: boolean;
    /** Weapon cells offer "focus" in the hover cluster; gear slots don't. */
    focusAction?: boolean;
    /** Weapon cells put the hover actions in the same corner as the marks, so
     *  the marks step aside on hover. */
    fadeStatusOnHover?: boolean;
    /** The tiny extras tiles: marks only, identity in the title attribute. */
    compact?: boolean;
    showName?: boolean;
    showWear?: boolean;
    showPrice?: boolean;
    showBadges?: boolean;
  }>(),
  {
    label: "",
    item: null,
    inst: null,
    image: null,
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
         top-down as "what it is, what it's worth". -->
    <div v-if="!compact" class="relative z-[2] min-w-0">
      <span class="block truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ label }}</span>
      <PriceTag v-if="showPrice" class="relative z-[2]" size="xs" :value="value" :missing="valueMissing" :title="valueTip" />
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
      <span
        v-if="baking || queued"
        class="absolute bottom-1 right-1 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
        ><Loader2 v-if="baking" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" />
        <template v-if="!compact">{{ baking ? "baking" : "queued" }}</template></span
      >
    </div>

    <!-- The centred caption the small rail tiles carry instead of a footer. -->
    <div
      v-if="compact"
      class="relative z-[2] w-full truncate text-center text-f8 uppercase tracking-cs1 text-muted-foreground/70"
    >
      {{ label }}
    </div>

    <div v-else-if="showName || showWear" class="relative z-[2] flex items-end justify-between gap-2">
      <span v-if="showName" class="flex min-w-0 flex-1 items-center gap-1.5">
        <ItemName :item="item" :strip="strip" :fallback="fallback" name-class="text-f11 font-medium" class="min-w-0 flex-1" />
        <!-- StatTrak and what's applied. The loadout showed neither until this
             component existed; the inventory grid has shown both all along. -->
        <ItemBadges v-if="showBadges" :inst="inst" :max="3" compact />
      </span>
      <WearBar v-if="showWear" :item="item" :wear="wear" :seed="seed" mini class="mb-1" />
    </div>
  </button>
</template>
