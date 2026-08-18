<script setup lang="ts">
// The top-right status cluster on a loadout card: which teams have this item
// equipped, plus the Steam-synced mark. Weapon cells grew this first; gear
// slots (knife, gloves, agent, zeus, C4, music kit, graffiti) hold instances
// the same way, so they get the identical mark rather than a lookalike.
import { Link2, RefreshCw } from "lucide-vue-next";
import TeamDots from "./TeamDots.vue";
import type { InventoryItem, Team } from "../api";
import { STEAM_BLUE } from "../itemVisuals";

// `compact` is for the 70px extras tiles, where the full-size cluster would
// crowd the art — same marks, tighter.
withDefaults(
  defineProps<{
    teams?: readonly Team[] | null;
    inst?: InventoryItem | null;
    compact?: boolean;
    /**
     * The item this one is applied to ("AK-47 | Redline"), for a sticker, patch
     * or charm sitting on a weapon.
     *
     * Resolved by the caller: this component is handed one instance and knows
     * nothing about the rest of the inventory, and `inst` carries only the id
     * (`attached_to`). Passing the NAME keeps it that way.
     */
    attachedName?: string | null;
    /**
     * Sit in the flow instead of pinning to the corner.
     *
     * The loadout cell wants it absolute over the art; a list row wants it as
     * the last item in a flex line. Same three marks either way — this is the
     * flag that let the tile stop hand-rolling its own copy of them.
     */
    inline?: boolean;
  }>(),
  { teams: null, inst: null, compact: false, attachedName: null, inline: false },
);
</script>

<template>
  <span
    class="z-[2] flex items-center"
    :class="[
      inline ? 'relative flex-none' : 'absolute',
      inline ? 'gap-1.5' : compact ? 'right-1 top-1 gap-1' : 'right-2 top-2 gap-1.5',
    ]"
  >
    <TeamDots :teams="teams" />
    <!-- Applied to something. An attachment can only be on one weapon at a time,
         so this is the difference between "I own this" and "this is already
         spoken for" — without it, a drawer of owned stickers gives no clue which
         are spare. -->
    <Link2
      v-if="attachedName"
      class="flex-none text-[color:var(--acc)]"
      :class="compact ? 'h-2.5 w-2.5' : 'h-3 w-3'"
      :title="'Applied to ' + attachedName"
    />
    <RefreshCw
      v-if="inst?.origin === 'steam'"
      :class="compact ? 'h-2.5 w-2.5' : 'h-3 w-3'"
      class="flex-none"
      :style="{ color: STEAM_BLUE }"
      title="Synced from your Steam inventory (read-only)"
    />
  </span>
</template>
