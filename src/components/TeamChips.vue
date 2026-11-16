<script setup lang="ts">
type Team = "CT" | "T";

const props = defineProps<{
  pending: Team[];
  canTeams: Team[];
  equippedOn: Team[];
}>();
const emit = defineEmits<{ (e: "update:pending", v: Team[]): void }>();

const TEAM_DOT: Record<Team, string> = { CT: "#7ea6ff", T: "#f2c14e" };

function toggle(t: Team) {
  if (props.equippedOn.includes(t)) {
    return;
  }
  emit("update:pending", props.pending.includes(t) ? props.pending.filter((x) => x !== t) : [...props.pending, t]);
}

function title(t: Team): string {
  if (props.equippedOn.includes(t)) {
    return `Equipped on ${t}`;
  }
  return props.pending.includes(t) ? `Equip will put it on ${t}` : `Not on ${t} — click to equip there too`;
}
</script>

<template>
  <div class="flex items-center gap-1.5" role="group" aria-label="Teams">
    <button
      v-for="t in (['CT', 'T'] as const)"
      :key="t"
      type="button"
      :aria-pressed="equippedOn.includes(t) || pending.includes(t)"
      :disabled="!canTeams.includes(t)"
      class="flex h-9 w-[64px] items-center justify-center gap-2 rounded-md border text-f11 font-semibold uppercase tracking-cs2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--acc)] disabled:cursor-not-allowed disabled:opacity-35"
      :class="
        equippedOn.includes(t)
          ? 'cursor-default text-foreground'
          : pending.includes(t)
            ? 'border-dashed border-[hsl(var(--tac-amber,33_94%_58%)/0.75)] bg-[hsl(var(--tac-amber,33_94%_58%)/0.08)] text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground'
      "
      :style="equippedOn.includes(t) ? { borderColor: `color-mix(in srgb, ${TEAM_DOT[t]} 55%, transparent)`, background: `color-mix(in srgb, ${TEAM_DOT[t]} 14%, transparent)` } : undefined"
      :title="title(t)"
      @click="toggle(t)"
    >
      <span
        class="h-2 w-2 rounded-full"
        :style="equippedOn.includes(t) ? { background: TEAM_DOT[t] } : { boxShadow: `inset 0 0 0 1.5px ${TEAM_DOT[t]}` }"
      ></span>
      {{ t }}
    </button>
  </div>
</template>
