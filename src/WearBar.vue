<script setup lang="ts">
// THE way wear renders. The loadout grid used to show a bare muted float with
// no ramp, which made "is this one beat up?" unanswerable without opening the
// item.
//
// The ramp is drawn dim on purpose. At full saturation across a whole card it
// reads as a health bar and out-shouts the rarity colour, which is the one
// thing on these cards that's supposed to carry meaning. So: ramp recedes to
// context, and the float's own position gets the light — a lit zone in its tier
// colour plus a white needle. The eye lands on the value, not the rainbow.
import { computed } from "vue";
import { WEAR_BOUNDS, WEAR_GRADIENT, wearColor, wearTier } from "./itemVisuals";

const props = withDefaults(
  defineProps<{
    wear?: number | null;
    seed?: number | null;
    /** Tighter track + type, for grid cells rather than inventory tiles. */
    compact?: boolean;
    /**
     * One row: float · track · seed. Wide cards (the knife/gloves gear cells)
     * stretch a stacked block edge to edge, which turns a readout into a
     * dashboard gauge — inline keeps the numbers next to the thing they label.
     */
    inline?: boolean;
    /**
     * Track only, no numbers — a stub that tucks into a corner beside the name
     * instead of claiming rows of its own. On loadout cells the art is the
     * point, and a full readout was eating the space the skin needed; the exact
     * float lives in the tooltip and on the item/focus screens.
     */
    mini?: boolean;
  }>(),
  { wear: null, seed: null, compact: false, inline: false, mini: false },
);

const pct = computed(() => Math.min(100, Math.max(0, (props.wear ?? 0) * 100)));
const color = computed(() => wearColor(props.wear ?? 0));
// Mini drops both numbers, so the tooltip has to carry the whole readout.
const tip = computed(() => {
  const parts: string[] = [];
  if (props.wear != null) parts.push(`${wearTier(props.wear)} · ${props.wear.toFixed(4)}`);
  if (props.seed != null) parts.push(`#${props.seed}`);
  return parts.join(" · ") || undefined;
});
</script>

<template>
  <div
    v-if="wear != null || seed != null"
    :class="
      inline
        ? 'flex items-center gap-2'
        : mini
          ? 'flex min-w-[54px] flex-none flex-col items-end gap-1'
          : 'w-full'
    "
    :title="tip"
  >
    <!-- Mini stacks the readout over the stub: the corner has the width for it,
         and a bar with no numbers reads as decoration. The float leads, pattern
         trails muted — the track below spans them both. -->
    <span
      v-if="mini"
      class="flex items-baseline gap-1.5 font-mono text-f8 leading-none tabular-nums"
    >
      <span v-if="wear != null" class="text-foreground/85">{{ wear.toFixed(4) }}</span>
      <span v-if="seed != null" class="text-muted-foreground">#{{ seed }}</span>
    </span>
    <span
      v-if="inline && wear != null"
      class="flex-none font-mono tabular-nums text-foreground/85"
      :class="compact ? 'text-f8' : 'text-f9'"
      >{{ wear.toFixed(4) }}</span
    >

    <!-- Track. Outer stays overflow-visible so the needle can overhang; the
         painted layers clip to the pill inside it. -->
    <div
      v-if="wear != null"
      class="relative"
      :class="[
        mini ? 'h-[3px]' : compact ? 'h-[5px]' : 'h-[6px]',
        inline ? 'min-w-0 flex-1' : 'w-full',
      ]"
    >
      <span class="absolute inset-0 overflow-hidden rounded-full">
        <span class="absolute inset-0 opacity-[0.45]" :style="{ background: WEAR_GRADIENT }"></span>
        <!-- Tier boundaries: the ramp's whole point is where you sit relative
             to these, so make them legible rather than implied by a hue shift.
             Too fine to resolve at mini's width — dropped there. -->
        <span
          v-for="b in mini ? [] : WEAR_BOUNDS"
          :key="b"
          class="absolute inset-y-0 w-px bg-black/45"
          :style="{ left: b + '%' }"
        ></span>
        <!-- Lit zone: the ramp at full strength, but only around the value. -->
        <span
          class="absolute inset-y-0 -translate-x-1/2"
          :style="{
            left: pct + '%',
            width: mini ? '16px' : compact ? '26px' : '34px',
            background: `radial-gradient(closest-side, ${color}, transparent)`,
            transition: 'left 300ms cubic-bezier(0.22,1,0.36,1)',
          }"
        ></span>
        <span
          class="absolute inset-0 rounded-full"
          style="box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(0, 0, 0, 0.55)"
        ></span>
      </span>
      <span
        class="absolute -translate-x-1/2 rounded-full bg-white"
        :class="mini ? '-top-[2px] h-[7px] w-[2px]' : compact ? '-top-[3px] h-[11px] w-[2px]' : '-top-[4px] h-[14px] w-[2px]'"
        :style="{
          left: pct + '%',
          boxShadow: `0 0 5px ${color}, 0 0 10px ${color}80, 0 1px 2px rgba(0,0,0,0.7)`,
          transition: 'left 300ms cubic-bezier(0.22,1,0.36,1)',
        }"
      ></span>
    </div>

    <span
      v-if="inline && seed != null"
      class="flex-none font-mono tabular-nums text-muted-foreground"
      :class="compact ? 'text-f8' : 'text-f9'"
      >#{{ seed }}</span
    >

    <div
      v-if="!inline && !mini"
      class="flex items-center justify-between font-mono tabular-nums"
      :class="[compact ? 'text-f8' : 'text-f9', wear != null && 'mt-1.5']"
    >
      <span v-if="wear != null" class="text-foreground/85">{{ wear.toFixed(4) }}</span>
      <span v-if="seed != null" class="text-muted-foreground">#{{ seed }}</span>
    </div>
  </div>
</template>
