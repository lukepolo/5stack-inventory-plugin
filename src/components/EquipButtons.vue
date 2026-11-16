<script setup lang="ts">
import { Loader2 } from "lucide-vue-next";

withDefaults(
  defineProps<{
    busy: boolean;
    done: boolean;
    canEdit: boolean;
    editLabel?: string;
    canEquip?: boolean;
  }>(),
  { editLabel: "Edit", canEquip: true },
);
const emit = defineEmits<{ (e: "equip"): void; (e: "edit"): void }>();
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      :disabled="!canEdit"
      class="flex h-9 items-center rounded-md border border-border bg-secondary/60 px-4 text-f11 font-semibold uppercase tracking-wider text-foreground/85 tac-action transition-transform active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--acc)] disabled:cursor-not-allowed disabled:opacity-35"
      @click="emit('edit')"
    >
      {{ editLabel }}
    </button>
    <button
      type="button"
      :disabled="busy || done || !canEquip"
      style="box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22)"
      class="tac-cta relative flex h-9 min-w-[112px] items-center justify-center rounded-md border border-transparent px-5 text-f11 font-bold uppercase tracking-wider transition-transform active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--acc)] disabled:cursor-not-allowed disabled:opacity-40"
      @click="emit('equip')"
    >
      <span :class="busy && 'invisible'">{{ done ? "Equipped" : "Equip" }}</span>
      <Loader2 v-if="busy" class="absolute inset-0 m-auto h-4 w-4 animate-spin" />
    </button>
  </div>
</template>
