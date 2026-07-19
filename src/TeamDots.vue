<script setup lang="ts">
// Which teams have this item equipped. Lives in the card's top-right status
// cluster next to the Steam-synced mark — both answer "what's the state of this
// item?", so they read as one group instead of being split across two corners,
// and the dots stop costing a whole line under the model name.
import type { Team } from "./api";

defineProps<{ teams?: readonly Team[] | null }>();

const COLOR: Record<Team, string> = { CT: "#7ea6ff", T: "#f2c14e" };
</script>

<template>
  <span v-if="teams?.length" class="flex flex-none items-center gap-1">
    <span
      v-for="(t, i) in teams"
      :key="i"
      class="h-1.5 w-1.5 rounded-full"
      :style="{ background: COLOR[t], boxShadow: `0 0 5px ${COLOR[t]}` }"
      :title="`Equipped on ${t}`"
    ></span>
  </span>
</template>
