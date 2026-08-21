<script setup lang="ts">
// FLAT ART OR THE MODEL — the one switch every screen that shows an item needs.
//
// It lives in the page HEADER rather than in the pane: this is a question about
// which picture you want, not a control on the picture itself, and in the header
// it sits on the same baseline as the other things you can do with the item
// instead of covering a corner of it.
//
// A component rather than markup in two headers, so the two screens cannot
// drift into asking the same question two ways.
import { Box, Image as ImageIcon } from "lucide-vue-next";
import PillTabs from "./PillTabs.vue";

defineProps<{
  is3d: boolean;
  /** Height of the strip. The focus header runs taller than the modal's. */
  listClass?: string;
}>();

const emit = defineEmits<{ (e: "update:is3d", v: boolean): void }>();

const TABS = ["2D", "3D"] as const;
const HINT: Record<string, string> = { "2D": "The flat artwork", "3D": "The model" };
</script>

<template>
  <PillTabs
    :items="TABS"
    :item-key="(s) => s"
    :item-title="(s) => HINT[s]"
    :active="is3d ? '3D' : '2D'"
    :list-class="listClass ?? ''"
    button-class="relative z-[1] flex h-full items-center gap-1.5 rounded-md px-2.5 py-1 text-f10 uppercase tracking-wider transition-colors"
    @select="(s) => emit('update:is3d', s === '3D')"
  >
    <template #default="{ item: s }">
      <!-- A CUBE for 3D, not a weapon silhouette. This asks "flat art or the
           model", and the model is not always a weapon — it is a glove, an
           agent, a charm. The weapon/hands pair belongs on the held toggle,
           which only exists once the answer here is "the model". -->
      <component :is="s === '2D' ? ImageIcon : Box" class="h-3.5 w-3.5" />
      {{ s }}
    </template>
  </PillTabs>
</template>
