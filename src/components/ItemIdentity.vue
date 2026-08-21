<script setup lang="ts">
// WHICH ITEM AM I LOOKING AT — the block that answers it, in both screens.
//
// Slot, weapon, finish, and what it is worth. Top-left, and big, because it is
// the first thing read on the screen and the only part of it that is not about
// the picture.
//
// DELIBERATELY NOT: the rarity chip, the StatTrak mark, the stickers, the charm.
// Every one of them is stated in the details panel on the right of the same
// screen, and a fact printed twice is a fact you have to reconcile — you read
// the badges, then read the panel, then check whether they agree. The panel
// wins because it has the room to say WHICH sticker and WHAT float, not just
// that there is one.
//
// The value stays, because the panel does not carry it and it is the other
// thing people want at a glance.
import ItemPrice from "./ItemPrice.vue";
import { isCompact } from "../responsive";

defineProps<{
  /** "RIFLES · SLOT 2" — the line above the name. Absent in the modal, which is
   *  opened from an item rather than from a slot. */
  slotLabel?: string | null;
  /** The weapon, big. */
  weapon: string;
  /** The finish, in the accent — or the em-dashed placeholder for a default. */
  finish?: string | null;
  /**
   * What it is worth, as data — see ItemPrice, which decides how that looks.
   * A screen with only a figure passes only a figure.
   */
  price?: InstanceType<typeof ItemPrice>["$props"] | null;
}>();
</script>

<template>
  <div class="min-w-0">
    <div v-if="slotLabel" class="text-f9 uppercase tracking-cs4 text-muted-foreground/70">{{ slotLabel }}</div>
    <h2 class="truncate font-bold leading-none" :class="[isCompact ? 'text-2xl' : 'text-4xl', slotLabel && 'mt-1.5']">
      {{ weapon }}
    </h2>
    <!-- items-START. The price grows downward as its readings arrive — the
         spread, then where this float sits in its bracket — and centred, the
         finish drifted down the line with it every time one landed. Aligned to
         the top, the name and the finish stay put and the extra lines hang
         under the figure where they belong. -->
    <div class="mt-1.5 flex min-w-0 flex-wrap items-start gap-2">
      <span v-if="finish" class="truncate font-medium leading-tight" :class="isCompact ? 'text-f13' : 'text-base'" style="color: var(--acc)">
        {{ finish }}
      </span>
      <!-- The price rides with the name as another fact about the item. Same
           block on every screen — what differs is how much any of them knows,
           not how it is drawn. -->
      <ItemPrice v-if="price" v-bind="price" />
      <slot />
    </div>
  </div>
</template>
