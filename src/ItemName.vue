<script setup lang="ts">
// THE way an item name renders. Finishes that share a market name are told
// apart only by their phase (Doppler "Ruby" / "Phase 2", Gamma Doppler
// "Emerald") — each is a separate paint index, so the phase sits ABOVE the name
// as an eyebrow: it's the disambiguator, and in a grid of twelve "Doppler" rows
// it's the line you actually scan.
//
// Plain-string contexts (tooltips, toasts, the 3D title bar) can't stack, so
// they use itemName() from itemVisuals instead, which folds the phase into
// "Doppler (Ruby)".
import { computed } from "vue";
import { stripName } from "./itemVisuals";

const props = defineProps<{
  item?: { name?: string | null; altName?: string | null } | null;
  /** Drop the weapon prefix — for slots whose header already names the weapon. */
  strip?: boolean;
  /** Shown muted when there's no item (an empty or default-weapon slot). */
  fallback?: string;
  nameClass?: string;
  phaseClass?: string;
}>();

const name = computed(() =>
  props.item?.name ? (props.strip ? stripName(props.item.name) : props.item.name) : "",
);
</script>

<template>
  <span class="block min-w-0">
    <span
      v-if="item?.altName"
      class="block truncate leading-tight"
      :class="phaseClass ?? 'text-f9 text-muted-foreground'"
      >{{ item.altName }}</span
    >
    <span
      class="block truncate leading-tight"
      :class="[nameClass ?? 'text-f13 font-medium', !name && 'text-muted-foreground']"
      >{{ name || fallback }}</span
    >
  </span>
</template>
