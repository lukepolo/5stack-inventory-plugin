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
import { Check, Clock, Loader2 } from "lucide-vue-next";
import type { InventoryItem } from "../api";
import ItemArt from "./ItemArt.vue";
import { ART_FADE_B, CARD_ART, glowStyle, isAgentArt, weaponName } from "../itemVisuals";
import ItemName from "./ItemName.vue";
import TileActions from "./TileActions.vue";
import WearBar from "./WearBar.vue";
import PriceTag from "./PriceTag.vue";
import ItemBadges from "./ItemBadges.vue";
import SlotStatus from "./SlotStatus.vue";
import { approxNote, PRICE_WINDOW_LABEL } from "../api";
import { wearTier } from "../itemVisuals";

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
    /**
     * The item this one is currently applied to ("AK-47 | Redline"), for a
     * sticker, patch or charm sitting on a weapon.
     *
     * Resolved by the caller rather than looked up here: the tile is handed one
     * instance and knows nothing about the rest of the inventory, and `inst`
     * carries only the id (`attached_to`). Passing the NAME keeps it that way.
     */
    attachedName?: string | null;
    /** Model name + equipped-team dots. Off in the sheet (one weapon there). */
    showHeader?: boolean;
    /** Hide per-item actions (bulk-select mode, read-only viewer). */
    hideActions?: boolean;
    /**
     * Horizontal list row instead of a card. Compact only: a 168px art well
     * with 78px of chrome under it is ~246px tall, which is more than a phone's
     * picker sheet has to give — you got two clipped cards and no sign that a
     * third existed. A 68px row shows six, and the name stops truncating.
     */
    row?: boolean;
    /**
     * Draw this item's estimated value.
     *
     * A prop rather than "render it whenever `inst.price` exists": money is a
     * mode the player switches on in the header, and a tile has no business
     * reading that preference itself. The price rides along on every item
     * regardless — the toggle decides whether it is shown, not whether it is
     * fetched.
     */
    showPrice?: boolean;
    /** Prices are still on their way. Distinct from "this item has no price":
     *  one is temporary and worth a placeholder, the other is permanent and
     *  worth nothing at all. */
    pricePending?: boolean;
    /** Which market the prices came from, for the "why is this blank" caption.
     *  A name, not a lookup: the tile has no business knowing the settings. */
    priceSource?: string;
  }>(),
  { active: false, selected: false, disabled: false, stripWeaponName: false, showHeader: false, hideActions: false, row: false, showPrice: false, pricePending: false, priceSource: "the price feed" },
);

/** Always "est." and always says which window it came from. A bare "$41" on a
 *  skin implies a precision a whole-wear-bracket average does not have. */
const priceTitle = computed(() => {
  if (props.inst.price) {
    const note = approxNote(props.inst.price, props.inst.wear ?? null, props.inst.stattrak === true);
    // A substituted listing says so first: it is the thing that makes the number
    // mean something different from what the tile appears to claim.
    return (
      (note ? `No exact listing — this is the ${note} one. ` : "") +
      `Rough estimate — ${PRICE_WINDOW_LABEL[props.inst.price.window]} for ${props.inst.price.marketHashName}. Not a sale price.`
    );
  }
  // Say WHY it is blank. "No price" and "pricing is broken" look identical on a
  // card, and the wear bracket is usually the answer: a market lists a finish
  // per bracket, and the beaten-up end of the range often has no listing at all.
  const bracket = props.inst.wear != null ? ` (${wearTier(props.inst.wear)})` : "";
  return `No ${props.priceSource} listing for this item${bracket}.`;
});

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
  /** An extraction is still populating the mount, so bakes are being refused
   *  rather than caching white guns. */
  assetsPending: { value: boolean };
} | null>("itemArt", null);

const baking = computed(() => !!art?.renderingIds.value.has(props.inst.id));
const queued = computed(() => !!art?.queuedIds.value.has(props.inst.id));
// Distinct from `queued`: the bake didn't just lose its turn, it was refused
// because the skin's textures aren't extracted yet. Says so rather than
// implying the queue is merely slow.
const preparing = computed(() => !!art?.assetsPending.value && !baking.value);
const equippedTeams = computed(() => (props.inst.equipped ?? []).map((e) => e.team));
</script>

<template>
  <button
    data-role="item-tile"
    :data-origin="inst.origin ?? 'crafted'"
    class="group relative flex overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
    :class="[
      row ? 'w-full items-center gap-3 px-2.5 py-2' : 'h-full flex-col px-2.5 py-2.5',
      active && !selected ? 'outline outline-2 -outline-offset-2 outline-[color:var(--acc)]' : '',
      selected ? 'outline outline-2 -outline-offset-2 outline-[hsl(var(--tac-amber,33_94%_58%))]' : '',
    ]"
    :style="{
      // The rarity edge moves to the left in row mode: a bottom rule between
      // stacked rows reads as a divider, not as the item's own rarity.
      ...(inst.item?.rarity ? (row ? { borderLeft: `3px solid ${inst.item.rarity}` } : { borderBottom: `3px solid ${inst.item.rarity}` }) : {}),
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
      v-if="baking || queued || preparing"
      class="absolute left-1.5 top-1.5 z-[3] flex items-center gap-1 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 text-f9 uppercase tracking-cs1 text-[color:var(--acc)]"
    >
      <Loader2 v-if="baking" class="h-3 w-3 animate-spin" /><Clock v-else class="h-3 w-3" />
      {{ baking ? 'baking' : preparing ? 'preparing' : 'queued' }}
    </span>

    <!-- Hover actions. Shared with the loadout rail's equipment tiles.
         Never in row mode: rows exist for compact, where a tap already opens
         the action menu that holds every one of these. -->
    <TileActions
      v-if="!hideActions && !row"
      :inst="inst"
      @view3d="emit('view3d')"
      @inspect="emit('inspect')"
      @edit="emit('edit')"
      @duplicate="emit('duplicate')"
      @remove="emit('remove')"
    />

    <!-- ============ ROW ============ -->
    <!-- Same information, one line: thumb · (model) name + wear · state dots. -->
    <template v-if="row">
      <div class="relative z-[2] grid h-11 w-14 flex-none place-items-center rounded bg-background/40">
        <ItemArt :inst="inst" :image="inst.item?.image" class="max-h-full max-w-full object-contain" :class="isAgentArt(inst) && ART_FADE_B" />
      </div>
      <div class="relative z-[2] min-w-0 flex-1">
        <div v-if="showHeader" class="truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">
          {{ weaponName(inst.item) || inst.slot }}
        </div>
        <div class="flex items-center gap-1.5">
          <ItemName :item="inst.item" :strip="stripWeaponName" class="min-w-0 flex-1" />
          <ItemBadges :inst="inst" :max="4" />
        </div>
        <!-- Inline, not stacked: the stacked variant spends a second line on
             the float/seed readout, which is the difference between a row that
             fits the budget below and one that doesn't. -->
        <!-- The row has one line under the name and the wear bar owns it, so the
             price shares that line rather than claiming a third: at 68px tall
             there is no room for another, and the two facts belong together. -->
        <div class="mt-1 flex items-center gap-2">
          <PriceTag
            v-if="showPrice"
            class="flex-none"
            size="xs"
            :value="inst.price?.value"
            :pending="pricePending"
            :missing="!inst.price"
            :approx="!!inst.price?.approx"
            :title="priceTitle"
          />
          <WearBar :item="inst.item" :wear="inst.wear" :seed="inst.seed" inline compact class="min-w-0 flex-1" />
        </div>
      </div>
      <SlotStatus inline :teams="equippedTeams" :inst="inst" :attached-name="attachedName" />
    </template>

    <!-- ============ CARD ============ -->
    <template v-else>
    <!-- Model + status dots: steam-synced (steam blue), equipped per team
         (CT blue / T amber) — hover any dot for the label. -->
    <div v-if="showHeader" class="relative z-[2] flex items-start justify-between gap-2">
      <!-- Model, then the price under it. The top-left corner is the card's
           quietest real estate — a label nobody reads twice — and hanging the
           value off it costs the art nothing that a footer line wouldn't, while
           keeping the name row to the name. Reads top-down as "what it is, what
           it's worth". -->
      <span class="relative min-w-0 flex-1">
        <span class="block truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ weaponName(inst.item) || inst.slot }}</span>
        <!-- Absolute: in flow it grew the card's chrome, so toggling values on
             resized every tile in the grid. See the note in LoadoutCell. -->
        <PriceTag
          v-if="showPrice"
          class="absolute left-0 top-full"
          :value="inst.price?.value"
          :pending="pricePending"
          :missing="!inst.price"
          :approx="!!inst.price?.approx"
          suffix="est"
          :title="priceTitle"
        />
      </span>
      <SlotStatus inline :teams="equippedTeams" :inst="inst" :attached-name="attachedName" />
    </div>
    <!-- Headerless tiles (the sheet) park the same cluster where the header
         would have put it — top right, under the hover actions. -->
    <SlotStatus v-if="!showHeader" :teams="equippedTeams" :inst="inst" :attached-name="attachedName" />

    <div :class="CARD_ART">
      <ItemArt
        :inst="inst"
        :image="inst.item?.image"
        class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-105"
        :class="isAgentArt(inst) && ART_FADE_B"
      />
    </div>

    <!-- items-CENTER, not items-start. The badge cluster is taller than a line
         of text now that the charm chip is, so top-alignment left the name
         sitting a few pixels above everything beside it. Centring is right in
         both cases: against a plain name it is exact, and against a name with a
         phase line above it (Doppler) the cluster centres on the pair. -->
    <div class="relative z-[2] flex items-center gap-1.5">
      <ItemName :item="inst.item" :strip="stripWeaponName" class="min-w-0 flex-1" />
      <!-- ST™ and the chips are ONE centred group: apart, the badge floated
           against a row whose height is set by the tallest chip. -->
      <ItemBadges :inst="inst" :max="6" class="ml-auto" />
    </div>

    <WearBar :item="inst.item" :wear="inst.wear" :seed="inst.seed" class="relative z-[2] mt-2" />
    </template>
  </button>
</template>
