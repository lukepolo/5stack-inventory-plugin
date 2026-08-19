<script lang="ts">
import type { CatalogWeapon, LoadoutEntry, Team } from "../api";
import type { LoadoutCellProps } from "./loadoutCellProps";

/** One weapon cell in a column — the position, and what currently fills it. */
export interface LoadoutGridCell {
  pos: string;
  weapon: CatalogWeapon | undefined;
  row: LoadoutEntry | undefined;
}

/** A positional column (pistols / mid-tier / rifles), counted and filled.
 *  Spelled out rather than derived from POSITION_GROUPS: that table is `as
 *  const`, so deriving it would drag five slot-name literals through every
 *  binding for no gain. */
export interface LoadoutColumn {
  key: string;
  label: string;
  positions: readonly string[];
  skinned: number;
  cells: LoadoutGridCell[];
}

/** The hover cluster's verbs. Identical for every cell, which is why App builds
 *  them once per slot rather than wiring six copies. */
export interface LoadoutCellActions {
  focus: () => void;
  view3d: () => void;
  inspect: () => void;
  edit: () => void;
  duplicate: () => void;
  remove: () => void;
}

export interface LoadoutGridProps {
  /** Read-only mode (someone else's loadout, or signed out) drops `draggable`
   *  and every mutation behind it. */
  canEdit: boolean;
  /** The showing side. Also the cells' `art-key`, so flipping sides re-runs the
   *  entrance sweep rather than teleporting the art. */
  team: Team;
  /** The focused slot — the one wearing the selection ring. */
  selected: string;
  /** Which category the compact rail is showing. Two-way: App's `watch(selected)`
   *  pulls it to whichever category contains a slot selected from elsewhere. */
  compactCat: string;
  compactCats: { key: string; label: string; short: string; skinned: number; total: number }[];
  compactCells: LoadoutGridCell[];
  compactEquipment: { slot: string; name: string }[];
  columnsView: LoadoutColumn[];
  /** Everything one cell draws, for one slot. `displayPos` is what to SHOW and
   *  differs from the slot only mid-reorder — see previewPos. */
  cellFacts: (pos: string, displayPos?: string) => LoadoutCellProps;
  cellActions: (pos: string) => LoadoutCellActions;
  rowFor: (pos: string) => LoadoutEntry | undefined;
  /** "Music Kit · Valve, CS2" for the extras tiles, which are far too small to
   *  print an item name. Names the STOCK default too, so an unequipped slot
   *  stops showing artwork it won't identify — see slotTitle in App. */
  slotTitle: (slot: string, name: string) => string;
  occupantWeapon: (pos: string) => CatalogWeapon | undefined;
  occupantModel: (pos: string) => string;
  rarityOf: (pos: string) => string | undefined;
  /** Which slot a reorder hover is currently PRETENDING this one is. */
  previewPos: (pos: string) => string;
  /** Drag-to-equip highlight (an inventory tile over a slot). */
  dropStyle: (pos: string) => Record<string, string>;
  /** Drag-to-reorder highlight (one weapon cell over another). */
  reorderStyle: (pos: string) => Record<string, string>;
  /** The slot that just took an equip, mid-pulse. */
  pulsePos: string | null;
  selectPos: (pos: string) => void;
  openCtx: (pos: string, e: MouseEvent) => void;
  onSlotDragOver: (pos: string, e: DragEvent) => void;
  onSlotDrop: (pos: string) => void;
  onCellDragStart: (pos: string, e: DragEvent) => void;
  onCellDragEnd: () => void;
  onCellDragOver: (pos: string, e: DragEvent) => void;
  onCellDragLeave: (pos: string) => void;
  onCellDrop: (pos: string) => void;
  /** Long-press to open a slot menu, DELEGATED from the container rather than
   *  bound per cell — see composables/useSlotLongPress.ts. */
  onSlotPointerDown: (e: PointerEvent) => void;
  onSlotPointerMove: (e: PointerEvent) => void;
  cancelLongPress: () => void;
  onSlotClickCapture: (e: MouseEvent) => void;
  /** How far the lifted picker sheet covers this half, in px, and the matching
   *  scroll padding. Zero whenever the sheet is down. */
  liftIntrusion: number;
  liftScrollStyle: { scrollPaddingBottom?: string };
}
</script>

<script setup lang="ts">
// THE LOADOUT GRID — the fifteen slots you fill, in the two shapes they take:
// four columns side by side on a desktop, one category at a time behind a rail
// on a phone.
//
// Extracted from App.vue alongside the inventory and the attachment picker. This
// one is deliberately a PLAIN props component rather than a composable+screen
// pair: none of what it draws is its own state. Every fact is derived from the
// loadout App holds (cellFacts / cellActions / columnsView), and every verb ends
// in a mutation or a route change App owns. Passing that model in, named, is the
// honest description of the coupling — and the prop list IS the audit of it.
//
// WHAT DID NOT MOVE: the drag-to-equip, drag-to-reorder and long-press wiring.
// It is the most delicate code in the app, and it stays whole in App.vue with
// only its handlers reaching across. Same rule LoadoutCell.vue already follows.
import { isCompact } from "../responsive";
import { accentSoft, selRing } from "../itemVisuals";
import { EXTRAS, RAIL } from "../loadoutModel";
import LoadoutCell from "./LoadoutCell.vue";

defineProps<LoadoutGridProps>();

defineEmits<{
  /** The compact rail switched category. */
  (e: "update:compactCat", key: string): void;
  /** A drag left this slot — App clears its own highlight if it was the one. */
  (e: "slot-drag-leave", pos: string): void;
}>();

// A little more scroll range than the sheet actually covers, so the LAST slot
// in a column can sit clear of its top edge instead of flush against it.
const LIFT_SPACER_PAD = 12;
</script>

<template>
        <!-- ============ LOADOUT GRID · COMPACT ============ -->
        <!-- One category at a time behind a sticky rail. This is a separate
             tree rather than a restyle of the desktop grid on purpose: the two
             have different DOM (and the focus view mounts a WebGL viewer), so
             rendering both and hiding one would double the slot count and, in
             focus mode, cost a second GL context. -->
        <div
          v-if="isCompact"
          class="animate-grid-in flex min-h-0 flex-1 flex-col"
          @pointerdown="onSlotPointerDown"
          @pointermove="onSlotPointerMove"
          @pointerup="cancelLongPress"
          @pointercancel="cancelLongPress"
          @click.capture="onSlotClickCapture"
        >
          <nav class="flex flex-none gap-1 overflow-x-auto border-b border-border px-2 py-0.5" data-role="compact-rail">
            <button
              v-for="c in compactCats"
              :key="c.key"
              class="flex min-h-[30px] flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-f10 font-semibold uppercase tracking-cs1 transition-colors"
              :class="compactCat === c.key
                ? 'border-[color:var(--acc)] text-foreground'
                : 'border-border/60 text-muted-foreground'"
              :style="compactCat === c.key ? { background: accentSoft } : {}"
              @click="$emit('update:compactCat', c.key)"
            >
              {{ c.short }}
              <span class="font-mono text-f9 text-muted-foreground/70">{{ c.skinned }}/{{ c.total }}</span>
            </button>
          </nav>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
            <!-- Equipment: agent spans both columns as the identity piece. -->
            <div v-if="compactCat === 'equipment'" class="grid grid-cols-2 gap-2">
              <LoadoutCell
                v-for="(s, si) in compactEquipment"
                :key="s.slot"
                :data-slot="s.slot" data-role="rail"
                :class="[
                  s.slot === 'agent' ? 'col-span-2 min-h-[132px]' : 'min-h-[96px]',
                  // Agent already eats two cells, so the row parity flips on an
                  // EVEN item count — then the last tile takes the full width
                  // instead of sitting alone next to a gap.
                  compactEquipment.length % 2 === 0 && si === compactEquipment.length - 1 && 'col-span-2',
                  selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === s.slot && 'animate-equip-pulse',
                ]"
                :style="[selRing(selected === s.slot), rowFor(s.slot)?.item?.rarity ? { borderLeft: `3px solid ${rowFor(s.slot)!.item!.rarity}` } : {}, dropStyle(s.slot)]"
                :label="s.slot === 'agent' ? `Agent · ${team}` : s.name"
                :index="si"
                :art-key="team"
                :fade-art="s.slot === 'agent'"
                pad-art
                v-bind="cellFacts(s.slot)"
                @click="selectPos(s.slot)"
                @contextmenu.prevent="openCtx(s.slot, $event)"
                @dragover="onSlotDragOver(s.slot, $event)"
                @dragleave="$emit('slot-drag-leave', s.slot)"
                @drop.prevent="onSlotDrop(s.slot)"
                @view3d="cellActions(s.slot).view3d()"
                @inspect="cellActions(s.slot).inspect()"
                @edit="cellActions(s.slot).edit()"
                @duplicate="cellActions(s.slot).duplicate()"
                @remove="cellActions(s.slot).remove()"
              />
            </div>

            <!-- Weapon categories: a flat 2-up of the group's five slots. -->
            <div v-else class="grid grid-cols-2 gap-2">
              <LoadoutCell
                v-for="(cell, ci) in compactCells"
                :key="cell.pos"
                :data-slot="cell.pos" data-role="weapon"
                class="min-h-[118px] !p-2"
                :class="[
                  selected === cell.pos ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40',
                  pulsePos === cell.pos && 'animate-equip-pulse',
                ]"
                :style="[
                  selRing(selected === cell.pos),
                  rarityOf(cell.pos) ? { borderLeft: `3px solid ${rarityOf(cell.pos)}` } : {},
                  dropStyle(cell.pos),
                ]"
                :label="cell.weapon?.name ?? cell.pos"
                :index="ci"
                :art-key="team + ':' + occupantModel(cell.pos)"
                focus-action
                v-bind="cellFacts(cell.pos)"
                @click="selectPos(cell.pos)"
                @contextmenu.prevent="openCtx(cell.pos, $event)"
                @dragover="onSlotDragOver(cell.pos, $event)"
                @dragleave="$emit('slot-drag-leave', cell.pos)"
                @drop.prevent="onSlotDrop(cell.pos)"
                @focus="cellActions(cell.pos).focus()"
                @view3d="cellActions(cell.pos).view3d()"
                @inspect="cellActions(cell.pos).inspect()"
                @edit="cellActions(cell.pos).edit()"
                @duplicate="cellActions(cell.pos).duplicate()"
                @remove="cellActions(cell.pos).remove()"
              />
            </div>

            <!-- Permanent, not retired-after-first-use. It used to hide itself
                 the moment you long-pressed once, on the theory that a standing
                 hint costs a row of scroll — but long-press has no other
                 affordance, so the one time it showed was the one time you
                 weren't looking for it. One dim 9px line is a cheap price for
                 the only place the gesture is ever named. -->
            <p class="px-1 pt-2 text-center text-f9 uppercase tracking-cs2 text-muted-foreground/50">
              Tap to select · hold for options
            </p>
          </div>
        </div>

        <!-- ============ LOADOUT GRID ============ -->
        <template v-else>
          <!-- Identity column: gloves + knife (prominent) and a compact agent -->
          <!-- The inner wrapper exists so the lift spacer can be a SIBLING of
               the cards rather than padding on the scroller: padding would come
               out of the flex line and squeeze every flex-1 card toward its
               min-height, which is the reflow the floating sheet exists to
               avoid. min-h-full keeps the cards stretching exactly as before. -->
          <aside class="animate-grid-in flex w-full min-w-[200px] max-w-[340px] flex-1 flex-col overflow-y-auto py-3 pl-4 pr-1" :style="liftScrollStyle">
            <div class="flex min-h-full flex-col gap-2.5">
            <div class="px-1 text-f9 uppercase tracking-cs3 text-muted-foreground/70">Equipment</div>
            <LoadoutCell
              v-for="(s, si) in [RAIL[2], RAIL[1]]"
              :key="s.slot"
              class="min-h-[96px] flex-1"
              :class="[
                selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                pulsePos === s.slot && 'animate-equip-pulse',
              ]"
              :style="[selRing(selected === s.slot), rowFor(s.slot)?.item?.rarity ? { borderLeft: `3px solid ${rowFor(s.slot)!.item!.rarity}` } : {}, dropStyle(s.slot)]"
              :data-slot="s.slot" data-role="rail"
              :label="s.name"
              :index="si"
              :art-key="team"
              v-bind="cellFacts(s.slot)"
              @click="selectPos(s.slot)"
              @contextmenu.prevent="openCtx(s.slot, $event)"
              @dragover="onSlotDragOver(s.slot, $event)"
              @dragleave="$emit('slot-drag-leave', s.slot)"
              @drop.prevent="onSlotDrop(s.slot)"
              @view3d="cellActions(s.slot).view3d()"
              @inspect="cellActions(s.slot).inspect()"
              @edit="cellActions(s.slot).edit()"
              @duplicate="cellActions(s.slot).duplicate()"
              @remove="cellActions(s.slot).remove()"
            />
            <LoadoutCell
              class="min-h-[132px] flex-[1.6]"
              :class="[
                selected === 'agent' ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                pulsePos === 'agent' && 'animate-equip-pulse',
              ]"
              :style="[selRing(selected === 'agent'), dropStyle('agent')]"
              data-slot="agent" data-role="agent"
              :label="`Agent · ${team}`"
              :index="2"
              :art-key="team"
              fade-art
              pad-art
              v-bind="cellFacts('agent')"
              @click="selectPos('agent')"
              @contextmenu.prevent="openCtx('agent', $event)"
              @dragover="onSlotDragOver('agent', $event)"
              @dragleave="$emit('slot-drag-leave', 'agent')"
              @drop.prevent="onSlotDrop('agent')"
              @view3d="cellActions('agent').view3d()"
              @inspect="cellActions('agent').inspect()"
              @edit="cellActions('agent').edit()"
              @duplicate="cellActions('agent').duplicate()"
              @remove="cellActions('agent').remove()"
            />
            <div class="grid flex-none grid-cols-2 gap-2">
              <LoadoutCell
                v-for="(s, si) in EXTRAS"
                :key="s.slot"
                class="h-[70px] items-center justify-between !p-1.5"
                :class="[
                  selected === s.slot ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                  pulsePos === s.slot && 'animate-equip-pulse',
                  // Odd count in a two-column grid: the last tile takes the whole
                  // row rather than leaving a half-width orphan beside a gap.
                  EXTRAS.length % 2 === 1 && si === EXTRAS.length - 1 && 'col-span-2',
                ]"
                :style="[selRing(selected === s.slot), dropStyle(s.slot)]"
                :data-slot="s.slot" data-role="rail"
                :title="slotTitle(s.slot, s.name)"
                :label="s.name"
                :index="3 + si"
                :art-key="team"
                compact
                v-bind="cellFacts(s.slot)"
                fallback="—"
                @click="selectPos(s.slot)"
                @contextmenu.prevent="openCtx(s.slot, $event)"
                @dragover="onSlotDragOver(s.slot, $event)"
                @dragleave="$emit('slot-drag-leave', s.slot)"
                @drop.prevent="onSlotDrop(s.slot)"
                @view3d="cellActions(s.slot).view3d()"
                @inspect="cellActions(s.slot).inspect()"
                @edit="cellActions(s.slot).edit()"
                @duplicate="cellActions(s.slot).duplicate()"
                @remove="cellActions(s.slot).remove()"
              />
            </div>
            </div>
            <div v-if="liftIntrusion" aria-hidden="true" class="flex-none" :style="{ height: liftIntrusion + LIFT_SPACER_PAD + 'px' }"></div>
          </aside>

          <!-- Positional weapon columns (CS2: 5 slots each) -->
          <div class="animate-grid-in flex flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-3">
            <section
              v-for="(g, gi) in columnsView"
              :key="g.key"
              data-role="column"
              class="flex min-w-[212px] max-w-[460px] flex-1 flex-col"
            >
              <header class="flex items-baseline gap-2 border-b border-border/60 px-1 pb-2">
                <span class="text-f11 font-semibold uppercase tracking-cs2 text-muted-foreground">{{ g.label }}</span>
                <span class="ml-auto font-mono text-f9 text-muted-foreground/60">{{ g.skinned }}/{{ g.positions.length }}</span>
              </header>
              <!-- Wrapper + spacer, same shape as the identity column: the
                   spacer is what gives this scroller somewhere to scroll when
                   the lifted sheet is covering its bottom, without padding
                   stealing height from the flex-1 cells. -->
              <div class="flex flex-1 flex-col overflow-y-auto pt-2" :style="liftScrollStyle">
                <div class="flex min-h-full flex-col gap-2">
                <!-- Every pos-derived display below reads through
                     previewPos(): during a reorder hover the two cells render
                     each other's contents — the drop confirms what you see. -->
                <LoadoutCell
                  v-for="(cell, ci) in g.cells"
                  :key="cell.pos"
                  class="min-h-[96px] flex-1"
                  :data-slot="cell.pos" data-role="weapon"
                  :draggable="canEdit"
                  :class="[
                    selected === cell.pos ? 'border-[color:var(--acc)] bg-secondary/70' : 'border-border/60 bg-secondary/40 hover:bg-secondary/70',
                    pulsePos === cell.pos && 'animate-equip-pulse',
                  ]"
                  :style="[
                    selRing(selected === cell.pos),
                    rarityOf(previewPos(cell.pos)) ? { borderLeft: `3px solid ${rarityOf(previewPos(cell.pos))}` } : {},
                    dropStyle(cell.pos),
                    reorderStyle(cell.pos),
                  ]"
                  :label="occupantWeapon(previewPos(cell.pos))?.name ?? cell.pos"
                  :index="ci * 3 + gi"
                  :art-key="team + ':' + occupantModel(cell.pos)"
                  focus-action
                  fade-status-on-hover
                  v-bind="cellFacts(cell.pos, previewPos(cell.pos))"
                  @click="selectPos(cell.pos)"
                  @contextmenu.prevent="openCtx(cell.pos, $event)"
                  @dragstart="onCellDragStart(cell.pos, $event)"
                  @dragend="onCellDragEnd"
                  @dragover="onCellDragOver(cell.pos, $event)"
                  @dragleave="onCellDragLeave(cell.pos)"
                  @drop.prevent="onCellDrop(cell.pos)"
                  @focus="cellActions(cell.pos).focus()"
                  @view3d="cellActions(cell.pos).view3d()"
                  @inspect="cellActions(cell.pos).inspect()"
                  @edit="cellActions(cell.pos).edit()"
                  @duplicate="cellActions(cell.pos).duplicate()"
                  @remove="cellActions(cell.pos).remove()"
                />
                </div>
                <div v-if="liftIntrusion" aria-hidden="true" class="flex-none" :style="{ height: liftIntrusion + LIFT_SPACER_PAD + 'px' }"></div>
              </div>
            </section>
          </div>
        </template>
</template>
