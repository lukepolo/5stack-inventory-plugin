<script setup lang="ts">
// The control that says which END a sort starts from, and flips it.
//
// Sits beside a sort dropdown rather than inside it: "Sort · Rarity" alone never
// said whether that meant covert-first or consumer-first, and for wear the two
// ends are opposite intentions — someone hunting a factory-new float and someone
// hunting a battle-scarred one both pick "Wear".
//
// `kind` picks the icon pair (see sortIcons.ts) and `hint` is the mode's own words
// for the CURRENT direction — "ascending" means nothing to someone looking for a
// clean float, "Lowest float first" is the thing they're actually after.
import { computed } from "vue";
import { SORT_DIR_ICON, type SortDir, type SortKind } from "../sortIcons";

const props = withDefaults(defineProps<{ modelValue: SortDir; kind?: SortKind; hint?: string }>(), {
  kind: "amount",
});
const emit = defineEmits<{ (e: "update:modelValue", v: SortDir): void }>();

const icon = computed(() => SORT_DIR_ICON[props.kind][props.modelValue]);
</script>

<template>
  <button
    class="tac-action flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-background text-muted-foreground"
    :title="hint ? `${hint} — click to reverse` : 'Reverse sort order'"
    :aria-label="hint ?? 'Reverse sort order'"
    @click="emit('update:modelValue', props.modelValue === 'desc' ? 'asc' : 'desc')"
  >
    <component :is="icon" class="h-3.5 w-3.5" />
  </button>
</template>
