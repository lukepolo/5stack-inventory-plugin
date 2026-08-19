<script setup lang="ts">
// A colour DECK of owned items — one design you own in several colourways,
// stacked into a single card.
//
// A deck is not an item: there is no single instance to open, select, equip or
// act on, so its only verb is "open me". Selecting happens inside it, where the
// instances are — which is why this is a plain card rather than an ItemTile with
// actions that would each need an owner.
//
// The inventory grid and the loadout sheet rendered this as two copies of the
// same markup, differing only in `data-role`, whether they carried a `title`,
// and which drill-down ref the click wrote to.
import { inject } from "vue";
import type { InventoryItem } from "../api";
import { CARD_ART, glowStyle } from "../itemVisuals";
import { Palette } from "lucide-vue-next";
import DeckFan from "./DeckFan.vue";
import ItemName from "./ItemName.vue";

defineProps<{
  /** The instance whose artwork represents the deck. */
  face: InventoryItem;
  /** Rarity/tint hexes for the layers behind the face. */
  behind: readonly string[];
  /** How many colourways are in the deck — shown in the corner badge. */
  count: number;
  /**
   * Marks which grid this is in, for the `content-visibility` sizing rules in
   * style.css. The inventory grid and the sheet use different roles because the
   * two grids have different intrinsic card heights.
   */
  role: "inv-item" | "skin";
  /** Trailing tint suffix to strip from the name — a deck spans every colour. */
  stripSuffix?: RegExp;
}>();

const emit = defineEmits<{ (e: "open"): void }>();

const tr = inject<(k: string, f: string, n?: Record<string, unknown>) => string>("tr", (_k, f) => f);
</script>

<template>
  <div class="relative h-full">
    <DeckFan :colors="behind" />
    <button
      :data-role="role"
      class="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-[color:var(--acc)]"
      :style="face.item?.rarity ? { borderBottom: `3px solid ${face.item.rarity}` } : {}"
      :title="tr('inventory.deck.open', '{count} colours — open', { count })"
      @click="emit('open')"
    >
      <span class="pointer-events-none absolute inset-0" :style="glowStyle(face.item?.rarity, 0.22)"></span>
      <span class="absolute right-1.5 top-1.5 z-[3] flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 font-mono text-f8 text-[color:var(--acc)]">
        <Palette class="h-2.5 w-2.5" /> {{ count }}
      </span>
      <div :class="CARD_ART">
        <img
          :src="face.item?.image ?? undefined"
          alt=""
          loading="lazy" decoding="async"
          class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105"
        />
      </div>
      <ItemName
        :item="{ ...face.item, name: (face.item?.name ?? '').replace(stripSuffix ?? /$^/, '') }"
        strip
        class="relative z-[2]"
      />
    </button>
  </div>
</template>
