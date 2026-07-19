<script setup lang="ts">
// THE one way an owned item renders as a card — used by the Inventory grid and
// by the loadout sheet's "Owned" section. Both screens showed the same items
// with different chrome (the sheet hid the origin/equipped state, the grid hid
// the bake badge), so they live here now: any status a tile can show, every
// view shows the same way.
//
// Steam-synced items are read-only server-side, so they get a Duplicate action
// where crafted items get Edit — never both.
import { computed, inject } from "vue";
import { Box, Check, Clock, Copy, ExternalLink, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";
import type { InventoryItem } from "./api";
import ItemArt from "./ItemArt.vue";
import { attachmentsOf, CARD_ART, glowStyle, isReadOnly, STEAM_BLUE, weaponName } from "./itemVisuals";
import TeamDots from "./TeamDots.vue";
import { isCoarse } from "./responsive";
import ItemName from "./ItemName.vue";
import WearBar from "./WearBar.vue";

const props = withDefaults(
  defineProps<{
    inst: InventoryItem;
    /** Team-accent outline — "this is the equipped one". */
    active?: boolean;
    /**
     * Bulk-select outline. Deliberately NOT `active`: selection isn't a team
     * concept, and borrowing --acc for it painted the whole select mode CT blue
     * in an otherwise amber panel. Carries a check badge too, so selection
     * doesn't rest on a 2px ring alone.
     */
    selected?: boolean;
    disabled?: boolean;
    title?: string;
    /** Sheet columns are narrow and already say "AK-47" in the header. */
    stripWeaponName?: boolean;
    /** Model name + equipped-team dots. Off in the sheet (one weapon there). */
    showHeader?: boolean;
    /** Hide per-item actions (bulk-select mode, read-only viewer). */
    hideActions?: boolean;
  }>(),
  { active: false, selected: false, disabled: false, stripWeaponName: false, showHeader: false, hideActions: false },
);

const emit = defineEmits<{
  (e: "view3d" | "inspect" | "edit" | "duplicate" | "remove"): void;
  /** Touch equivalent of right-click. The per-tile actions above are behind
   *  `group-hover`, which never fires on touch, so without this they'd be
   *  unreachable there — the host opens the same menu contextmenu opens. */
  (e: "longpress"): void;
}>();

// Mirrors the slot long-press in App.vue: 450ms, 10px of slop before it's
// treated as a scroll instead of a press.
let lpTimer: ReturnType<typeof setTimeout> | undefined;
let lpOrigin: { x: number; y: number } | null = null;
let lpFired = false;
function onPressStart(e: PointerEvent) {
  if (e.pointerType === "mouse") return;
  lpFired = false;
  lpOrigin = { x: e.clientX, y: e.clientY };
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpFired = true;
    lpOrigin = null;
    navigator.vibrate?.(8);
    emit("longpress");
  }, 450);
}
function onPressMove(e: PointerEvent) {
  if (lpOrigin && Math.hypot(e.clientX - lpOrigin.x, e.clientY - lpOrigin.y) > 10) cancelPress();
}
function cancelPress() {
  clearTimeout(lpTimer);
  lpOrigin = null;
}
// Swallow the click the browser fires on lift, so a long-press doesn't also
// equip the item whose menu it just opened.
function onClickCapture(e: MouseEvent) {
  if (!lpFired) return;
  lpFired = false;
  e.stopPropagation();
  e.preventDefault();
}

// Bake status comes from App's single render pipeline (same provide as ItemArt).
const art = inject<{
  renderingIds: { value: Set<number> };
  queuedIds: { value: Set<number> };
} | null>("itemArt", null);

const baking = computed(() => !!art?.renderingIds.value.has(props.inst.id));
const queued = computed(() => !!art?.queuedIds.value.has(props.inst.id));
const readOnly = computed(() => isReadOnly(props.inst));
const attachments = computed(() => attachmentsOf(props.inst));
const equippedTeams = computed(() => (props.inst.equipped ?? []).map((e) => e.team));
</script>

<template>
  <button
    data-role="item-tile"
    :data-origin="inst.origin ?? 'crafted'"
    class="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
    :class="[
      active && !selected ? 'outline outline-2 -outline-offset-2 outline-[color:var(--acc)]' : '',
      selected ? 'outline outline-2 -outline-offset-2 outline-[hsl(var(--tac-amber,33_94%_58%))]' : '',
    ]"
    :style="{
      ...(inst.item?.rarity ? { borderBottom: `3px solid ${inst.item.rarity}` } : {}),
      ...(selected ? { background: 'hsl(var(--tac-amber, 33 94% 58%) / 0.08)' } : {}),
    }"
    :disabled="disabled"
    :title="title"
    @pointerdown="onPressStart"
    @pointermove="onPressMove"
    @pointerup="cancelPress"
    @pointercancel="cancelPress"
    @click.capture="onClickCapture"
  >
    <span class="pointer-events-none absolute inset-0" :style="glowStyle(inst.item?.rarity, 0.22)"></span>
    <span
      v-if="selected"
      class="pointer-events-none absolute left-1.5 top-1.5 z-[4] grid h-4 w-4 place-items-center rounded-[3px] bg-[hsl(var(--tac-amber,33_94%_58%))] text-black shadow-sm"
    >
      <Check class="h-3 w-3" stroke-width="3" />
    </span>

    <!-- Bake status (true-render generation) -->
    <span
      v-if="baking || queued"
      class="absolute left-1.5 top-1.5 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
    >
      <Loader2 v-if="baking" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" />
      {{ baking ? 'baking' : 'queued' }}
    </span>

    <!-- Hover actions. Imported items can't be edited, only duplicated.
         Hidden on touch outright: 20px targets are unusable there, and tap /
         long-press both open the action menu, which has every one of these. -->
    <span v-if="!hideActions && !isCoarse" class="absolute right-1.5 top-1.5 z-[3] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <span
        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
        title="View in 3D"
        @click.stop="emit('view3d')"
      ><Box class="h-3 w-3" /></span>
      <!-- steam:// can't launch CS2 from a phone — hide the dead-end on touch. -->
      <span
        v-if="!isCoarse"
        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
        title="Inspect in game"
        @click.stop="emit('inspect')"
      ><ExternalLink class="h-3 w-3" /></span>
      <span
        v-if="readOnly"
        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
        title="Synced from Steam and read-only — craft your own copy of it"
        @click.stop="emit('duplicate')"
      ><Copy class="h-3 w-3" /></span>
      <span
        v-else
        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-foreground"
        title="Edit item"
        @click.stop="emit('edit')"
      ><Pencil class="h-3 w-3" /></span>
      <span
        class="rounded border border-border/60 bg-background/70 p-1 text-muted-foreground hover:text-[#ff7a6a]"
        title="Delete from inventory"
        @click.stop="emit('remove')"
      ><Trash2 class="h-3 w-3" /></span>
    </span>

    <!-- Model + status dots: steam-synced (steam blue), equipped per team
         (CT blue / T amber) — hover any dot for the label. -->
    <div v-if="showHeader" class="relative z-[2] flex items-center justify-between gap-2">
      <span class="truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ weaponName(inst.item) || inst.slot }}</span>
      <span class="flex flex-none items-center gap-1.5">
        <TeamDots :teams="equippedTeams" />
        <RefreshCw
          v-if="readOnly"
          class="h-3 w-3 flex-none"
          :style="{ color: STEAM_BLUE }"
          title="Synced from your Steam inventory (read-only)"
        />
      </span>
    </div>
    <!-- Headerless tiles (the sheet) park the same cluster where the header
         would have put it — top right, under the hover actions. -->
    <span v-if="!showHeader" class="absolute right-2 top-2 z-[2] flex items-center gap-1.5">
      <TeamDots :teams="equippedTeams" />
      <RefreshCw
        v-if="readOnly"
        class="h-3 w-3"
        :style="{ color: STEAM_BLUE }"
        title="Synced from your Steam inventory (read-only)"
      />
    </span>

    <div :class="CARD_ART">
      <ItemArt :inst="inst" :image="inst.item?.image" class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105" />
    </div>

    <div class="relative z-[2] flex items-start gap-1.5">
      <ItemName :item="inst.item" :strip="stripWeaponName" class="flex-1" />
      <span v-if="inst.stattrak" class="flex-none font-mono text-f8 text-[#f2c14e]">ST™</span>
      <span v-if="attachments.length" class="ml-auto flex flex-none items-center gap-0.5">
        <img v-for="(a, k) in attachments.slice(0, 6)" :key="k" :src="a.image ?? undefined" :title="a.name" alt="" class="h-4 w-4 object-contain" />
      </span>
    </div>

    <WearBar :wear="inst.wear" :seed="inst.seed" class="relative z-[2] mt-2" />
  </button>
</template>
