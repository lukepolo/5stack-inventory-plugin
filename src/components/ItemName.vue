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
//
// A NAMED PET reads the way CS2 shows a named item: the name, in quotes, is the
// name, and what it is moves up to the eyebrow — "Catalana" over “Clucky”. A pet
// is its name in a way a gun is not, so this is the pets' alone (callers pass
// `nametag` only for them).
import { computed } from "vue";
import { stripName } from "../itemVisuals";

const props = defineProps<{
  item?: { name?: string | null; altName?: string | null } | null;
  /** Drop the weapon prefix — for slots whose header already names the weapon. */
  strip?: boolean;
  /** Shown muted when there's no item (an empty or default-weapon slot). */
  fallback?: string;
  nameClass?: string;
  phaseClass?: string;
  /** A pet's name tag. When set it is the main line, and the item's own name
   *  becomes the eyebrow. */
  nametag?: string | null;
}>();

const itemName = computed(() =>
  props.item?.name ? (props.strip ? stripName(props.item.name) : props.item.name) : "",
);
const named = computed(() => props.nametag?.trim() || "");
const name = computed(() => (named.value ? `“${named.value}”` : itemName.value));
const eyebrow = computed(() => (named.value ? itemName.value : props.item?.altName ?? ""));
</script>

<template>
  <span class="block min-w-0">
    <span
      v-if="eyebrow"
      class="block truncate leading-tight"
      :class="phaseClass ?? 'text-f9 text-muted-foreground'"
      >{{ eyebrow }}</span
    >
    <span
      class="block truncate leading-tight"
      :class="[nameClass ?? 'text-f13 font-medium', !name && 'text-muted-foreground']"
      >{{ name || fallback }}</span
    >
  </span>
</template>
