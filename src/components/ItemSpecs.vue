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
import { computed } from "vue";
import PatternRail from "./PatternRail.vue";
import WearBar from "./WearBar.vue";
import { attachmentsOf, hasScratch, hasWear, wearTier } from "../itemVisuals";
import type { InventoryItem, KillHistory } from "../api";

const props = withDefaults(
  defineProps<{
    inst?: InventoryItem | null;
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
    /** The kill ledger for this item, when the caller has fetched it. */
    killHistory?: KillHistory | null;
    /** That fetch is in flight — shown instead of an empty history box. */
    killHistoryBusy?: boolean;
  }>(),
  { inst: null, charmAlbedo: null, charmLoading: false, still: false },
);

/**
 * The record behind the StatTrak number, when the caller has fetched it.
 *
 * A prop, not a fetch, for the same reason `charmAlbedo` is: this component is
 * handed an item and renders it, and the request belongs to whoever knows the
 * modal is open in view mode. Absent, the counter still renders — the history is
 * additive, never a precondition for the box it sits in.
 */
const KILL_TREND_DAYS = 30;
/**
 * The trend, as a DENSE day-by-day series over the last 30 days.
 *
 * Dense on purpose. The ledger only carries days that saw kills, and drawing
 * those bars side by side makes a gun used twice a month look like a daily
 * driver — the gaps are most of the signal. Days are keyed in UTC to match the
 * buckets the server cut, so the newest bar isn't a half-day short of the rest.
 */
const killTrend = computed<number[]>(() => {
  const days = props.killHistory?.days;
  if (!days?.length) return [];
  const byDay = new Map(days.map((d) => [d.day, d.kills]));
  const now = new Date();
  const out: number[] = [];
  for (let back = KILL_TREND_DAYS - 1; back >= 0; back--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    out.push(byDay.get(day.toISOString().slice(0, 10)) ?? 0);
  }
  return out;
});
const killTrendMax = computed(() => Math.max(1, ...killTrend.value));
/** Hidden rather than drawn flat: 30 empty bars over a gun last fired in March
 *  says "no data" in a shape that looks like data. The dates below say it. */
const killTrendActive = computed(() => killTrend.value.some((n) => n > 0));
const killBestMap = computed(() => props.killHistory?.maps[0] ?? null);
const killDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const attachments = computed(() => (props.inst ? attachmentsOf(props.inst) : []));
/** A CHARM's own pattern, as opposed to a weapon's: the seed on a keychain is a
 *  colourway, and the rail renders it as one. */
const seedIsCharm = computed(() => props.inst?.item?.type === "keychain");
const box = "animate-sheet-in rounded-md bg-secondary/40 p-2.5";
const label = "w-16 flex-none text-f10 uppercase tracking-cs1 text-muted-foreground";
</script>

<template>
  <template v-if="inst">
    <!-- Name tag leads, same as the form. -->
    <div v-if="inst.nametag" :class="[box, 'flex items-center gap-2']" :style="still ? {} : { '--i': 0 }">
      <span :class="label">Name tag</span>
      <span class="min-w-0 flex-1 truncate text-f13 italic">“{{ inst.nametag }}”</span>
    </div>

    <div v-if="attachments.length" :class="box" :style="still ? {} : { '--i': 1 }">
      <div class="mb-1.5 text-f10 uppercase tracking-cs1 text-muted-foreground">Applied</div>
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
        <span :class="label">Pattern</span>
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
        <span :class="label">Wear</span>
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ wearTier(inst.wear) }}</span>
      </div>
      <div class="mt-2"><WearBar :item="inst.item" :wear="inst.wear" /></div>
    </div>
    <div
      v-if="inst.wear != null && hasScratch(inst.item)"
      :class="[box, 'flex items-baseline gap-2']"
      :style="still ? {} : { '--i': 3 }"
    >
      <span :class="label">Wear</span>
      <span class="font-mono text-f13">{{ inst.wear.toFixed(2) }}</span>
      <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">scratched</span>
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
          >{{ inst.stattrak_count.toLocaleString() }} <span class="text-f9 text-muted-foreground">kills</span></span
        >
      </div>
      <!-- A counter on its own is a number with no story: it cannot say which
           match, which map or when. This one can, because the kills are real and
           the match data lives in the same Postgres.
           Gated on `logged` rather than on the counter: an item whose kills all
           predate the ledger has a number and no story, and blank rows under it
           would read as a broken panel instead of as history nobody recorded. -->
      <template v-if="killHistory && killHistory.logged > 0">
        <div
          v-if="killTrendActive"
          class="mt-2.5 flex h-8 items-end gap-px"
          :title="`Kills per day over the last ${KILL_TREND_DAYS} days`"
        >
          <span
            v-for="(n, i) in killTrend"
            :key="i"
            class="min-w-0 flex-1 rounded-[1px]"
            :style="{
              height: Math.max(2, (n / killTrendMax) * 100) + '%',
              background: n ? 'hsl(var(--tac-stattrak))' : 'rgba(255,255,255,0.07)',
            }"
          ></span>
        </div>
        <dl class="mt-2.5 flex flex-col gap-1.5">
          <div v-if="killHistory.first_at" class="flex items-baseline justify-between gap-2">
            <dt class="text-f10 uppercase tracking-cs1 text-muted-foreground">First kill</dt>
            <dd class="font-mono tabular-nums text-f11 text-foreground/85">{{ killDate(killHistory.first_at) }}</dd>
          </div>
          <div v-if="killBestMap" class="flex items-baseline justify-between gap-2">
            <dt class="text-f10 uppercase tracking-cs1 text-muted-foreground">Best map</dt>
            <dd class="min-w-0 truncate text-f11 text-foreground/85">
              {{ killBestMap.map }}
              <span class="font-mono tabular-nums text-muted-foreground">· {{ killBestMap.kills.toLocaleString() }}</span>
            </dd>
          </div>
          <div v-if="killHistory.match_count" class="flex items-baseline justify-between gap-2">
            <dt class="text-f10 uppercase tracking-cs1 text-muted-foreground">Matches</dt>
            <dd class="font-mono tabular-nums text-f11 text-foreground/85">{{ killHistory.match_count.toLocaleString() }}</dd>
          </div>
          <!-- Only shown when the two disagree, which is every item that was
               already killing before the ledger existed. Printing `logged` as
               though it were the whole record would make a 2,000-kill AK look
               like it had forty. -->
          <div v-if="killHistory.logged < killHistory.counted" class="flex items-baseline justify-between gap-2">
            <dt class="text-f10 uppercase tracking-cs1 text-muted-foreground">Logged</dt>
            <dd class="font-mono tabular-nums text-f11 text-muted-foreground">
              {{ killHistory.logged.toLocaleString() }} of {{ killHistory.counted.toLocaleString() }}
            </dd>
          </div>
        </dl>
        <!-- Where it has been lately. Three is enough to say that without
             turning the spec column into a match list; the rollups above already
             carry the whole history. -->
        <div class="mt-2.5 flex flex-col gap-1 border-t border-border/60 pt-2">
          <span
            v-for="m in killHistory.matches.slice(0, 3)"
            :key="(m.match_map_id ?? m.match_id ?? 'none') + m.first_at"
            class="flex items-baseline justify-between gap-2"
          >
            <span class="min-w-0 truncate text-f10 text-foreground/70">{{ m.map ?? 'Unattributed' }}</span>
            <span class="flex-none font-mono tabular-nums text-f10 text-muted-foreground">{{ killDate(m.last_at) }} · {{ m.kills }}</span>
          </span>
        </div>
      </template>
      <div v-else-if="killHistoryBusy" class="mt-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
        Loading history…
      </div>
    </div>
  </template>
</template>
