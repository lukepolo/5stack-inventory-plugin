<script setup lang="ts">
// The top-right status cluster on a loadout card: which teams have this item
// equipped, plus the Steam-synced mark. Weapon cells grew this first; gear
// slots (knife, gloves, agent, zeus, C4, music kit, graffiti) hold instances
// the same way, so they get the identical mark rather than a lookalike.
import { RefreshCw } from "lucide-vue-next";
import TeamDots from "./TeamDots.vue";
import type { InventoryItem, Team } from "./api";
import { STEAM_BLUE } from "./itemVisuals";

// `compact` is for the 70px extras tiles, where the full-size cluster would
// crowd the art — same marks, tighter.
withDefaults(
  defineProps<{
    teams?: readonly Team[] | null;
    inst?: InventoryItem | null;
    compact?: boolean;
  }>(),
  { teams: null, inst: null, compact: false },
);
</script>

<template>
  <span
    class="absolute z-[2] flex items-center"
    :class="compact ? 'right-1 top-1 gap-1' : 'right-2 top-2 gap-1.5'"
  >
    <TeamDots :teams="teams" />
    <RefreshCw
      v-if="inst?.origin === 'steam'"
      :class="compact ? 'h-2.5 w-2.5' : 'h-3 w-3'"
      :style="{ color: STEAM_BLUE }"
      title="Synced from your Steam inventory (read-only)"
    />
  </span>
</template>
