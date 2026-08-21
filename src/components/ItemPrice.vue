<script setup lang="ts">
// WHAT THIS ITEM IS WORTH — one block, both screens.
//
// This was two blocks for a while: a plain figure in the focus view and a
// stacked readout in the modal, positioned differently, so the same item
// answered "how much" in two different shapes. The shape is fixed here now and
// the CALLER ONLY SUPPLIES DATA — a screen with just a figure renders the
// figure, a screen that also knows the spread renders the spread under it.
// Nothing about the layout is a prop.
//
// The sentence joining the two numbers ("yours is probably worth more") lives in
// the tooltip, because it is an inference and printing it as a number would
// dress a guess as a measurement.
import PriceTag from "./PriceTag.vue";
import Tooltip from "./Tooltip.vue";
import { formatPrice, HISTORY_WINDOW_LABEL, type HistoryWindow } from "../api";

defineProps<{
  /** The headline figure. Nothing renders without one. */
  total?: number | null;
  /** Attachments on top of the base — the modal's running craft cost. */
  extra?: number | null;
  /** The base price is a bracket estimate rather than a measured sale. */
  approx?: boolean;
  /** Recent sales behind the figure. */
  sales?: { min?: number | null; max?: number | null; median?: number | null; avg?: number | null; volume: number; window: HistoryWindow } | null;
  /** Where this float sits in its wear tier, and whether that is good news. */
  standing?: { verdict: string; caption: string } | null;
  /** Explains the figure. */
  tip?: string;
  /** A quote is in flight — the figure on screen is the previous one. */
  busy?: boolean;
  label?: string;
}>();
</script>

<template>
  <Tooltip v-if="total != null" :text="tip ?? ''">
    <span class="flex flex-col gap-1 transition-opacity" :class="busy && 'opacity-40'">
      <PriceTag
        frame="spine"
        stack
        size="lg"
        :label="label ?? 'est. value'"
        :value="total"
        :extra="extra ?? undefined"
        :missing="total === 0"
        :approx="approx"
      />
      <span v-if="sales" class="flex flex-col gap-0.5 pl-2.5 text-f9 leading-tight">
        <span class="font-mono tabular-nums text-muted-foreground">
          <template v-if="sales.min != null && sales.max != null && sales.max > sales.min">
            {{ formatPrice(sales.min) }}–{{ formatPrice(sales.max) }}
          </template>
          <template v-else>{{ formatPrice(sales.median ?? sales.avg ?? sales.min ?? 0) }}</template>
          <span class="text-muted-foreground/50"> · {{ sales.volume }} sold {{ HISTORY_WINDOW_LABEL[sales.window] }}</span>
        </span>
        <span
          v-if="standing"
          class="uppercase tracking-cs4"
          :class="standing.verdict === 'better'
            ? 'text-[#37c46a]'
            : standing.verdict === 'worse'
              ? 'text-[#e0a24a]'
              : 'text-muted-foreground/60'"
          >{{ standing.caption }}</span
        >
      </span>
    </span>
  </Tooltip>
</template>
