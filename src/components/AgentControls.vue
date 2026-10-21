<script setup lang="ts">
// An agent's controls in the craft panel: the pose it stands in and how it
// moves. Both are VIEWING choices, never saved with the agent and never sent to
// the game — the same footing as the pet's animation.
//
// POSE was a row of pills over the model's top-left corner, where it sat on the
// item's own name. It lives here with the other controls for what is on the
// stage, the way the pet's coat and clips do.
//
// MOTION exists because an agent ships nothing to play: its GLB's only clips are
// `tools_preview` (a single frame, the "Ready" pose) and `eye_test` (a face-rig
// check). So the viewer moves it itself — see AgentMotion in viewer3d.ts:
// breathing and a slow look round in the chosen pose, or that while blending
// through all three poses in turn. Still is for placing patches.
import PillTabs from "./PillTabs.vue";

type Pose = "stand" | "open" | "ready";
type Motion = "still" | "idle" | "cycle";

defineProps<{
  /** The pose showing; while cycling, the one it is nearest. */
  pose: Pose;
  motion: Motion;
}>();
const emit = defineEmits<{
  "update:pose": [Pose];
  "update:motion": [Motion];
}>();

const POSES: { id: Pose; label: string; hint: string }[] = [
  { id: "ready", label: "Ready", hint: "The model's own in-game pose" },
  { id: "stand", label: "Stand", hint: "Relaxed standing pose" },
  { id: "open", label: "Open", hint: "Arms out — shows every patch position" },
];
const MOTIONS: { id: Motion; label: string; hint: string }[] = [
  { id: "idle", label: "Idle", hint: "Breathing and looking around in the chosen pose" },
  { id: "cycle", label: "Cycle", hint: "Moves through Ready, Stand and Open in turn" },
  { id: "still", label: "Still", hint: "Holds the pose — best for placing patches" },
];
const PILL =
  "relative z-[1] flex h-7 flex-1 items-center justify-center rounded-md px-1 text-f10 uppercase tracking-wider transition-colors";
</script>

<template>
  <div class="flex flex-col gap-3">
    <section class="agent-block">
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Pose</span>
        <span class="ml-auto truncate text-f11 text-muted-foreground">{{ POSES.find((p) => p.id === pose)?.hint }}</span>
      </header>
      <PillTabs
        :items="POSES"
        :item-key="(p) => p.id"
        :item-title="(p) => p.hint"
        :active="pose"
        list-class="flex w-full"
        :button-class="PILL"
        @select="(id) => emit('update:pose', id as Pose)"
      >
        <template #default="{ item }">{{ (item as (typeof POSES)[number]).label }}</template>
      </PillTabs>
    </section>
    <section class="agent-block">
      <header class="mb-2 flex items-baseline gap-2">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">Motion</span>
        <span class="ml-auto truncate text-f11 text-muted-foreground">{{ MOTIONS.find((m) => m.id === motion)?.hint }}</span>
      </header>
      <PillTabs
        :items="MOTIONS"
        :item-key="(m) => m.id"
        :item-title="(m) => m.hint"
        :active="motion"
        list-class="flex w-full"
        :button-class="PILL"
        @select="(id) => emit('update:motion', id as Motion)"
      >
        <template #default="{ item }">{{ (item as (typeof MOTIONS)[number]).label }}</template>
      </PillTabs>
    </section>
  </div>
</template>

<style scoped>
/* Same block as the pet's (PetControls .pet-block), so the two read as one kind
   of control. */
.agent-block {
  border-radius: 0.375rem;
  background: hsl(var(--secondary) / 0.4);
  padding: 0.625rem;
}
</style>
