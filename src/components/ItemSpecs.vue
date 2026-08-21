<script setup lang="ts">
/**
 * Everything an owned copy IS, read-only: its name tag, what is applied to it,
 * the charm's colour, its pattern, its float, its StatTrak.
 *
 * Lifted verbatim out of the editor modal, where it was the `viewOnly` half of
 * the right-hand column. It moved for one reason: the focus view was showing a
 * name, a rarity and a float, and nothing about the stickers, the charm or the
 * charm's colour — facts the editor two clicks away rendered in full. Two
 * surfaces answering "what is this item" differently is the same problem the
 * loadout cells had; the fix is the same, and this is the component.
 *
 * Order matches the EDIT form's boxes deliberately: switching between editing
 * and viewing must not reshuffle the panel under the cursor.
 */
import { computed, inject } from "vue";
import PatternRail from "./PatternRail.vue";
import WearBar from "./WearBar.vue";
import { attachmentsOf, hasScratch, hasWear, wearTier } from "../itemVisuals";
import type { AttachSource } from "../api";

const props = withDefaults(
  defineProps<{
    /**
     * The copy being described. A PUBLIC loadout row is accepted alongside an
     * owned instance for the same reason ItemBadges accepts one: a visitor holds
     * no inventory for the player they are looking at, and every fact this panel
     * prints — the name tag, what is applied, the charm's colour, the float —
     * rides on that row instead.
     */
    inst?: AttachSource | null;
    /**
     * The charm rail's swatch source, and whether it is still resolving.
     *
     * Passed in rather than fetched here: the albedo is read off the mounted 3D
     * model, which the modal owns and this component has no business knowing
     * about. Absent (focus, a list) the rail still renders — it just draws its
     * swatches from the charm's own artwork.
     */
    charmAlbedo?: {
      data: Uint8ClampedArray;
      size: number;
      material: string | null;
      mask?: Uint8ClampedArray | null;
    } | null;
    charmLoading?: boolean;
    /** Skip the entrance stagger where the panel is not animating in. */
    still?: boolean;
  }>(),
  { inst: null, charmAlbedo: null, charmLoading: false, still: false },
);

const tr = inject<(k: string, f: string) => string>("tr", (_k, f) => f);

const attachments = computed(() => (props.inst ? attachmentsOf(props.inst) : []));
/** A CHARM's own pattern, as opposed to a weapon's: the seed on a keychain is a
 *  colourway, and the rail renders it as one. */
const seedIsCharm = computed(() => props.inst?.item?.type === "keychain");
/**
 * The box each reading sits in. The surface is what separates one reading from
 * the next — it stays, over a map environment as much as on a card.
 */
const box = "animate-sheet-in rounded-md bg-secondary/40 p-2.5";
const label = "w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground";
</script>

<template>
  <template v-if="inst">
    <!-- Name tag leads, same as the form. -->
    <div v-if="inst.nametag" :class="[box, 'flex items-center gap-2']" :style="still ? {} : { '--i': 0 }">
      <span :class="label">{{ tr('inventory.specs.nametag', 'Name tag') }}</span>
      <span class="min-w-0 flex-1 truncate text-f13 italic">“{{ inst.nametag }}”</span>
    </div>

    <div v-if="attachments.length" :class="box" :style="still ? {} : { '--i': 1 }">
      <div class="mb-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">{{ tr('inventory.specs.applied', 'Applied') }}</div>
      <div class="flex flex-col gap-1.5">
        <span v-for="(a, k) in attachments" :key="k" class="flex items-center gap-2" :title="a.name ?? undefined">
          <img :src="a.image ?? undefined" alt="" class="h-7 w-7 flex-none object-contain" />
          <span class="min-w-0 flex-1 truncate text-f10 text-foreground/85">{{ a.name }}</span>
        </span>
        <!-- The charm's own pattern, under the charm's own row — attachmentsOf
             lists the charm LAST, which is what puts it there. It is the only
             attachment carrying an attribute of its own, and that attribute is a
             colour: the name says "Semi-Precious", the swatch says which one you
             have. Read off `inst.charm` rather than the loop's `a` because only
             the charm arm of that union has a seed. -->
        <PatternRail
          v-if="inst.charm?.seed != null"
          readonly
          class="pl-9"
          :model-value="inst.charm.seed"
          :image="inst.charm.image"
          :albedo="charmAlbedo"
          :loading="charmLoading"
        />
      </div>
    </div>

    <!-- A CHARM's pattern is a COLOUR, so this shows the colour. "#1" on its own
         is a true statement about the item and a useless one — it is a coordinate
         into a space, and nobody memorises the space. Same component as the
         editor's rail, in its readonly mode, so the swatch here and the swatch you
         picked with are computed by one piece of code.
         A weapon's pattern is not a colour — it moves artwork — so it stays a
         number. -->
    <div v-if="inst.seed != null" :class="[box, 'flex items-center gap-2']" :style="still ? {} : { '--i': 2 }">
      <PatternRail
        v-if="seedIsCharm"
        readonly
        class="min-w-0 flex-1"
        :model-value="inst.seed"
        :image="inst.item?.image"
        :albedo="charmAlbedo"
        :loading="charmLoading"
      />
      <template v-else>
        <span :class="label">{{ tr('inventory.specs.pattern', 'Pattern') }}</span>
        <span class="font-mono text-f13">#{{ inst.seed }}</span>
      </template>
    </div>

    <!-- Type-gated, not just null-gated. A sticker spends the same `wear` column
         on its SCRATCH, so the moment one could be set this box started captioning
         a sticker "Factory New" over an empty track (WearBar drops the ramp
         itself, the tier caption was left saying it anyway). The scratch gets its
         own box below, with a number instead of a tier. -->
    <div v-if="inst.wear != null && hasWear(inst.item)" :class="box" :style="still ? {} : { '--i': 3 }">
      <div class="flex items-baseline gap-2">
        <span :class="label">{{ tr('inventory.specs.wear', 'Wear') }}</span>
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ wearTier(inst.wear) }}</span>
      </div>
      <div class="mt-2"><WearBar :item="inst.item" :wear="inst.wear" /></div>
    </div>
    <div
      v-if="inst.wear != null && hasScratch(inst.item)"
      :class="[box, 'flex items-baseline gap-2']"
      :style="still ? {} : { '--i': 3 }"
    >
      <span :class="label">{{ tr('inventory.specs.wear', 'Wear') }}</span>
      <span class="font-mono text-f13">{{ inst.wear.toFixed(2) }}</span>
      <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ tr('inventory.specs.scratched', 'scratched') }}</span>
    </div>

    <div
      v-if="inst.stattrak"
      :class="[box, 'flex flex-col']"
      :style="still ? {} : { '--i': 4 }"
    >
      <div class="flex items-center justify-between">
        <span class="text-f10 uppercase tracking-cs1 text-[hsl(var(--tac-stattrak))]">StatTrak™</span>
        <!-- The count, finally. It has ridden the API since StatTrak shipped and
             was rendered nowhere; here the item is the subject, so there is room
             for it and a reason to care. -->
        <span v-if="inst.stattrak_count" class="font-mono text-f11 tabular-nums text-[hsl(var(--tac-stattrak))]"
          >{{ inst.stattrak_count.toLocaleString() }} <span class="text-f9 text-muted-foreground">{{ tr('inventory.specs.kills', 'kills') }}</span></span
        >
      </div>
    </div>
  </template>
</template>
