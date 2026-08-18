<script setup lang="ts">
/**
 * THE way a price renders. One component, every surface.
 *
 * This started as inline markup and got pasted eight times — the card header, the
 * list row, five loadout cell labels, the screen header, the inventory toolbar
 * and the editor stage — and they had already drifted: some set the "$" back at
 * 55% opacity and some didn't, some used tabular figures and some didn't, and the
 * "est" suffix was spelled three ways. Exactly the drift WearBar exists to
 * prevent for floats, for exactly the same reason: these are the same fact shown
 * in different places, so they have to be the same object.
 *
 * The variants are SHAPES, not styles. Nothing here takes a colour override —
 * money is --tac-value everywhere, and per-call-site colour is how the drift
 * started. The token is WHITE — see its note in style.css: every hue in this
 * panel already means something else, so the emphasis inside the figure (full
 * white digits, 55% "$", quieter suffix) carries what a colour was carrying.
 */
import { priceParts, formatPrice } from "../api";

const props = withDefaults(
  defineProps<{
    /** Null/undefined = nothing to show. Distinct from 0, which no real listing
     *  has: a mirror with no entry for an item must render blank, never "$0". */
    value?: number | null;
    /** Micro-caps label — "T value", "est. cost". */
    label?: string | null;
    /** A second, quieter figure after the main one: the attachments' share of a
     *  craft. The part that MOVES while someone works. */
    extra?: number | null;
    /** Trailing word after the figure — "est", "in view". */
    suffix?: string | null;
    /**
     * The fetch is still out.
     *
     * Renders a pulsing dash in the figure's own place so the number lands where
     * the eye already is instead of shifting the layout when it arrives. Only
     * meaningful on a FIRST load; a refresh over a value already on screen
     * should be silent (see pricesPending in App.vue).
     */
    pending?: boolean;
    /**
     * Priced, and the mirror had nothing for it.
     *
     * Renders a muted dash instead of nothing at all. An absent price and a
     * broken one look identical when both draw zero pixels — that ambiguity is
     * what sends people to check whether pricing is working. Only pass this
     * where the item is genuinely priceable: a loadout slot holding a free
     * default has no listing to miss, and a dash there would be a claim.
     */
    missing?: boolean;
    /**
     * This figure came from a DIFFERENT listing than the one asked for — the
     * non-StatTrak copy, or a neighbouring wear bracket. Renders a leading "~"
     * and dims the figure, because a stand-in that looks identical to an exact
     * price is worse than no price: it is a wrong answer with a confident face.
     * The caller's title says what was substituted.
     */
    approx?: boolean;
    size?: "xs" | "sm" | "md" | "lg";
    /**
     * How the figure is separated from what surrounds it.
     *
     * `none`  — a line of an item's data (a card, a cell). Spacing does the work.
     * `spine` — a lit bar down the left. Every standalone readout uses this:
     *   the screen header, the inventory toolbar, the editor stage, focus.
     *
     * There WAS a bordered-and-tinted `chip` shape. It is gone on purpose. A
     * bordered rectangle sits among this panel's controls as one more control —
     * worst directly under the editor's 2D/3D row, where it read as a third
     * button — and the spine is the panel's own idiom for a titled readout: the
     * admin console gives every section header the same bar in amber. Keeping
     * both shapes for one fact is how a design drifts into two looks, so there
     * is one.
     */
    frame?: "none" | "spine";
    /** Label above the figure instead of before it. */
    stack?: boolean;
    /** Native tooltip. Every price carries one: a bare figure implies a precision
     *  no whole-wear-bracket estimate has. */
    title?: string;
  }>(),
  { value: null, label: null, extra: null, suffix: null, pending: false, missing: false, approx: false, size: "sm", frame: "none", stack: false, title: "" },
);

const FIGURE = { xs: "text-f9", sm: "text-f10", md: "text-f12", lg: "text-f13" } as const;

/** Frame chrome on the outer element; the inner wrapper always owns the
 *  label/figure layout, so a spine can sit beside a stacked pair without the two
 *  directions fighting. */
const FRAME = { none: "", spine: "gap-2.5" } as const;
/** Same geometry as the admin console's section rule, in the money hue rather
 *  than amber — amber there means "section header", here it would mean "press me". */
const SPINE =
  "w-0.5 flex-none self-stretch rounded-full bg-[hsl(var(--tac-value))] shadow-[0_0_6px_hsl(var(--tac-value)/0.25)]";
</script>

<template>
  <span
    v-if="value != null && value > 0"
    :class="['flex', frame === 'spine' ? 'items-stretch' : 'items-baseline', 'gap-1.5', FRAME[frame]]"
    :title="title || undefined"
  >
    <span v-if="frame === 'spine'" :class="SPINE" aria-hidden="true"></span>
    <span :class="stack ? 'flex flex-col gap-0.5' : 'flex items-baseline gap-1.5'">
      <span v-if="label" class="text-f9 uppercase tracking-cs4 text-muted-foreground/60">{{ label }}</span>
      <span class="flex items-baseline gap-1.5">
        <!-- The "$" set back so the figure leads. These sit among instrument
             readouts — floats, seeds, kill counts — and a full-weight symbol
             competes with the number it belongs to. -->
        <span :class="['font-mono leading-none tabular-nums text-[hsl(var(--tac-value))]', FIGURE[size]]">
          <span class="text-[hsl(var(--tac-value))]/55">{{ priceParts(value).symbol }}</span
          >{{ priceParts(value).digits }}
        </span>
        <span
          v-if="extra != null && extra > 0"
          class="font-mono text-f9 leading-none tabular-nums text-muted-foreground/70"
          >+{{ formatPrice(extra) }}</span
        >
        <span v-if="suffix" class="text-f8 uppercase tracking-cs4 text-muted-foreground/50">{{ suffix }}</span>
      </span>
    </span>
  </span>

  <!-- No listing. Same footprint as a figure, so a grid of cards does not
       reflow as prices land, and it carries the reason in its title. -->
  <span
    v-else-if="missing && !pending"
    :class="['flex', frame === 'spine' ? 'items-stretch' : 'items-baseline', 'gap-1.5', FRAME[frame]]"
    :title="title || undefined"
  >
    <span v-if="frame === 'spine'" :class="[SPINE, 'opacity-30']" aria-hidden="true"></span>
    <span :class="stack ? 'flex flex-col gap-0.5' : 'flex items-baseline gap-1.5'">
      <span v-if="label" class="text-f9 uppercase tracking-cs4 text-muted-foreground/40">{{ label }}</span>
      <span :class="['font-mono leading-none text-muted-foreground/40', FIGURE[size]]">—</span>
    </span>
  </span>

  <!-- Pending, and only when there is no figure yet. The spine stays lit so the
       readout holds its place; only the figure pulses. -->
  <span
    v-else-if="pending"
    :class="[
      'flex',
      frame === 'spine' ? 'items-stretch' : 'items-baseline',
      'gap-1.5',
      FRAME[frame],
    ]"
  >
    <span v-if="frame === 'spine'" :class="[SPINE, 'opacity-40']" aria-hidden="true"></span>
    <span :class="stack ? 'flex flex-col gap-0.5' : 'flex items-baseline gap-1.5'">
      <span v-if="label" class="text-f9 uppercase tracking-cs4 text-muted-foreground/40">{{ label }}</span>
      <span :class="['animate-pulse font-mono leading-none text-[hsl(var(--tac-value))]/30', FIGURE[size]]">$ —</span>
    </span>
  </span>
</template>
