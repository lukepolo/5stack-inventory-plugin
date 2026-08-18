<script setup lang="ts">
/**
 * What is ON this copy: StatTrak, and the stickers, patches and charm applied
 * to it.
 *
 * These facts existed in exactly one place — the inventory tile — because they
 * were written inline there, twice. The loadout cells and the focus view showed
 * none of them, so the same AK read as a bare name in the loadout and as a
 * stickered, charmed, StatTrak gun in the grid. That is not a missing feature
 * per surface; it is one fact with one renderer that only one surface had.
 *
 * Same reasoning as SlotStatus, whose own note says it: "Weapon cells grew this
 * first; gear slots hold instances the same way, so they get the identical mark
 * rather than a lookalike."
 */
import { computed } from "vue";
import { attachmentsOf } from "../itemVisuals";
import type { InventoryItem } from "../api";

const props = withDefaults(
  defineProps<{
    inst?: InventoryItem | null;
    /**
     * How many thumbnails fit. The caller knows its own width: four across a
     * 68px list row, six on a card, three in a loadout cell footer that is
     * already carrying a float and a pattern.
     */
    max?: number;
    /** Tighter marks for dense cells. */
    compact?: boolean;
    /**
     * Kills recorded on the module.
     *
     * Off by default and deliberately so: `stattrak_count` has ridden the API
     * since StatTrak shipped and is rendered nowhere, because on a grid of
     * cards a number beside every badge is noise. Worth showing where the item
     * is the subject — focus, the editor — and not where it is one of forty.
     */
    count?: boolean;
  }>(),
  { inst: null, max: 4, compact: false, count: false },
);

const attachments = computed(() => (props.inst ? attachmentsOf(props.inst) : []));
const stattrak = computed(() => props.inst?.stattrak === true);
const kills = computed(() => props.inst?.stattrak_count ?? 0);
const shown = computed(() => attachments.value.slice(0, props.max));
/** "+2" rather than silently dropping them: a gun with six stickers and room
 *  for four must not look like a gun with four. */
const overflow = computed(() => Math.max(0, attachments.value.length - props.max));
</script>

<template>
  <!-- ONE group, not two. Apart, each aligned itself against a row whose height
       is set by the tallest chip, so the badge floated relative to them — and
       the taller charm chip makes any such gap worse. -->
  <span v-if="stattrak || attachments.length" class="flex flex-none items-center gap-1.5">
    <!-- One size in both modes, deliberately. `compact` shrinks the attachment
         thumbnails, but f8 is the floor of the type scale (tailwind.config.js)
         and there is nothing below it to shrink to — the binding that used to be
         here picked f8 either way, which read as a size decision and was a
         no-op. -->
    <span
      v-if="stattrak"
      class="font-mono text-f8 leading-none text-[hsl(var(--tac-stattrak))]"
      :title="count && kills ? `StatTrak™ — ${kills.toLocaleString()} kills` : 'StatTrak™'"
      >ST™<template v-if="count && kills"> {{ kills.toLocaleString() }}</template></span
    >
    <span v-if="shown.length" class="flex items-center gap-0.5">
      <!-- The charm is drawn LARGER and last, behind a hairline: there is only
           ever one, it is picked on its own, and at sticker size in a row of
           four it read as a fifth sticker. -->
      <img
        v-for="(a, k) in shown"
        :key="k"
        :src="a.image ?? undefined"
        :title="a.name ?? undefined"
        alt=""
        :class="
          a.kind === 'charm'
            ? compact
              ? 'ml-0.5 h-4 w-4 flex-none border-l border-border/60 pl-1 object-contain'
              : 'ml-0.5 h-5 w-5 flex-none border-l border-border/60 pl-1 object-contain'
            : compact
              ? 'h-3 w-3 flex-none object-contain'
              : 'h-3.5 w-3.5 flex-none object-contain'
        "
      />
      <span v-if="overflow" class="font-mono text-f8 leading-none text-muted-foreground/70">+{{ overflow }}</span>
    </span>
  </span>
</template>
