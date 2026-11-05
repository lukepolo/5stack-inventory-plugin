<script setup lang="ts" generic="T extends { key: string; label: string; icon?: Component; count?: number | string }">
// The panel's collapsing tab strip, ported for this remote — the same strip as
// the utility page's tabs (web/components/common/AnimatedFilters.vue with
// `square collapse`), so the inventory's screens switch the way the rest of
// 5stack does: icons only, the picked tab a solid amber pill wearing its label.
//
// On a switch the amber grows out of the new tab's icon-sized box while a ghost
// of the old pill shrinks back to its icon and lets go, and every tab's icon
// glides from where it was to where it lands. All of it is FLIP — measure before
// the change and after, play the difference as a transform — so the layout
// lands at once and nothing on the compositor waits for the main thread, which
// is busiest exactly when a screen is mounting underneath.
//
// Deviations from the panel's copy, all forced by this being a remote:
//   - Only the collapse mode: it is the only one used here.
//   - Our Tooltip (not FiveStackToolTip) names the icon-only tabs.
//   - The glow is an inline style: arbitrary classes carrying decimals get
//     mangled in this remote's injected CSS (see Tooltip.vue).
//   - `hideLabels` drops even the picked tab's label, for a phone header.
//   - The strip RESERVES its width (reserve()): the panel's sits full width in
//     its card, so its edge never moves; this one sits in a header row, and
//     hugging its content it changed width on every switch ("Craft" against
//     "Sticker Crafts") and jumped sideways while the swap was still sliding.
//   - The swap leads the screen change (pick()): the strip switches and its
//     swap starts, then a frame later the screen behind it is asked to change.
//     Started in the same tick, its first frames waited behind the new screen
//     mounting (a 3D mat, an inventory grid) and it played late and choppy.
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import Tooltip from "./Tooltip.vue";

const props = defineProps<{
  items: readonly T[];
  active: string;
  /** No label even on the picked tab — the compact header's width. */
  hideLabels?: boolean;
}>();
const emit = defineEmits<{ (e: "select", key: string): void }>();

/** The tab shown as picked — set on the click, ahead of `active` (see pick()). */
const current = ref(props.active);
// Navigation from anywhere else (a link, Back) moves it too.
watch(
  () => props.active,
  (a) => {
    if (a !== current.value) current.value = a;
  },
);
/** One frame after the swap has started, or soon regardless: a hidden tab runs no frames. */
function afterFrame(run: () => void) {
  let done = false;
  const once = () => {
    if (!done) {
      done = true;
      run();
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(once));
  setTimeout(once, 60);
}
function pick(key: string) {
  if (key !== current.value) current.value = key;
  afterFrame(() => emit("select", key));
}

const containerRef = ref<HTMLElement | null>(null);
const indicatorRef = ref<HTMLElement | null>(null);
const ghostRef = ref<HTMLElement | null>(null);
// Not reactive, and neither is where the indicator sits: kept in state, every
// move of the pill would re-render the strip to change four numbers.
const btns = new Map<string, HTMLElement>();
function setBtn(el: unknown, key: string) {
  if (el) btns.set(key, el as HTMLElement);
  else btns.delete(key);
}

type Rect = { left: number; top: number; width: number; height: number };
let placed: Rect | null = null;
function place(rect: Rect | null) {
  const el = indicatorRef.value;
  if (!el) return;
  placed = rect;
  if (!rect) {
    el.style.opacity = "0";
    return;
  }
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.opacity = "1";
}
function tabRect(): Rect | null {
  const el = btns.get(current.value);
  if (!el || !containerRef.value || el.offsetWidth === 0) return null;
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const running = new Set<Animation>();
function play(el: Element | null | undefined, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
  if (!el || typeof el.animate !== "function") return;
  const animation = el.animate(keyframes, timing);
  running.add(animation);
  const done = () => running.delete(animation);
  animation.addEventListener("finish", done);
  animation.addEventListener("cancel", done);
}
function stop() {
  for (const animation of [...running]) animation.cancel();
  running.clear();
}

const SWAP_MS = 300;
const SWAP_EASE = "cubic-bezier(0.45, 0, 0.55, 1)";
type Box = { left: number; width: number; icon: number; count: number | null };
let before: Record<string, Box> | null = null;
let leaving: string | null = null;

/** On SCREEN, not in the strip: should the strip itself move (the header
 *  reflowing round it), the swap still plays from where things were seen. */
function measure() {
  const out: Record<string, Box> = {};
  for (const [key, el] of btns) {
    const rect = el.getBoundingClientRect();
    out[key] = {
      left: rect.left,
      width: rect.width,
      icon: el.firstElementChild?.getBoundingClientRect().left ?? rect.left,
      count: el.querySelector(".ct-count")?.getBoundingClientRect().left ?? null,
    };
  }
  return out;
}

/**
 * The strip's width, fixed: every tab's icon, the widest label, the gaps and
 * the strip's own padding. The picked tab takes the room (it grows), so no
 * switch changes the strip's width. Measured off the labels themselves
 * (scrollWidth reads a collapsed one at its full width), so a translation or a
 * late web font is measured as it is.
 */
const reserved = ref<number | null>(null);
function reserve() {
  const strip = containerRef.value;
  if (!strip || props.hideLabels || !btns.size) {
    reserved.value = null;
    return;
  }
  const px = (v: string) => parseFloat(v) || 0;
  let bare = 0;
  let widest = 0;
  for (const el of btns.values()) {
    // From what is IN the tab — padding, icon, count — never the tab's own
    // width: the picked tab grows into the room reserved here, and measuring
    // it would feed that growth back into the reservation every resize.
    const bs = getComputedStyle(el);
    bare += px(bs.paddingLeft) + px(bs.paddingRight) + px(bs.borderLeftWidth) + px(bs.borderRightWidth);
    for (const child of el.children) {
      if (child.classList.contains("ct-track")) continue;
      const cs = getComputedStyle(child);
      bare += child.getBoundingClientRect().width + px(cs.marginLeft) + px(cs.marginRight);
    }
    widest = Math.max(widest, el.querySelector<HTMLElement>(".ct-label")?.scrollWidth ?? 0);
  }
  const cs = getComputedStyle(strip);
  const chrome =
    px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + px(cs.columnGap) * (btns.size - 1);
  const w = Math.ceil(bare + widest + chrome);
  if (reserved.value === null || Math.abs(reserved.value - w) > 0.5) reserved.value = w;
}

// Before the DOM is patched: where everything is on screen right now,
// including anything still mid-flight from the last switch.
watch(
  current,
  (_next, previous) => {
    if (containerRef.value && placed) {
      before = measure();
      leaving = previous ?? null;
    }
  },
  { flush: "pre" },
);

function swap(first: Record<string, Box>, key: string) {
  const last = measure();
  const timing = { duration: SWAP_MS, easing: SWAP_EASE };
  const from = (start: Box, end: Box) => [
    { transform: `translateX(${start.left - end.left}px) scaleX(${start.width / (end.width || 1)})` },
    { transform: "none" },
  ];
  for (const [name, el] of btns) {
    if (!first[name] || !last[name]) continue;
    const shift = first[name].icon - last[name].icon;
    if (Math.abs(shift) > 0.5) play(el, [{ transform: `translateX(${shift}px)` }, { transform: "none" }], timing);
    // A count (the inventory's 214) sits after the label, so when its tab is
    // picked or left it lands somewhere else IN the tab, and changes colour
    // with it. It glides from where it was on screen — net of its tab's own
    // glide — and dips out while the pill crosses it, rather than jumping to
    // the tab's far end and blinking black-on-dark there.
    const count = el.querySelector(".ct-count");
    const was = first[name].count;
    const now = last[name].count;
    if (count && was != null && now != null) {
      const own = was - now - shift;
      if (Math.abs(own) > 0.5) play(count, [{ transform: `translateX(${own}px)` }, { transform: "none" }], timing);
      if (name === key || name === leaving) {
        play(count, [{ opacity: 1 }, { opacity: 0, offset: 0.2 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: SWAP_MS });
      }
    }
  }
  if (first[key] && last[key]) play(indicatorRef.value, from(first[key], last[key]), timing);
  const old = leaving;
  const tab = old ? btns.get(old) : null;
  if (ghostRef.value && old && tab && old !== key && first[old] && last[old]) {
    Object.assign(ghostRef.value.style, {
      left: `${tab.offsetLeft}px`,
      top: `${tab.offsetTop}px`,
      width: `${tab.offsetWidth}px`,
      height: `${tab.offsetHeight}px`,
    });
    play(ghostRef.value, from(first[old], last[old]), timing);
    play(ghostRef.value, [{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: SWAP_MS });
  }
  // The label arrives once the pill has grown enough to be under it.
  play(btns.get(key)?.querySelector(".ct-label"), [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], {
    duration: SWAP_MS,
  });
}

function follow() {
  const first = before;
  before = null;
  stop();
  const to = tabRect();
  place(to);
  if (!to || reduced()) return;
  if (first) swap(first, current.value);
}

// Measured once per change of size, never per frame.
let ro: ResizeObserver | null = null;
function observe() {
  if (!ro || !containerRef.value) return;
  ro.disconnect();
  ro.observe(containerRef.value);
  for (const el of btns.values()) ro.observe(el);
}
onMounted(() => {
  void nextTick(() => {
    reserve();
    place(tabRect());
  });
  // Measured before the web font arrived, the strip kept the fallback's
  // widths: slack inside its right edge. Once more when the fonts are in.
  void document.fonts?.ready.then(() => {
    reserve();
    place(tabRect());
  });
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      reserve();
      place(tabRect());
    });
    observe();
  }
});
onBeforeUnmount(() => {
  ro?.disconnect();
  stop();
});

// One watcher for both, so a switch that also changes the set of tabs is
// followed once: a second pass would cancel what the first had just started.
watch(
  [current, () => props.items.map((i) => i.key).join(","), () => props.hideLabels],
  ([, keys, hide], [, previousKeys, wasHidden]) => {
    if (keys !== previousKeys) observe();
    if (keys !== previousKeys || hide !== wasHidden) reserve();
    follow();
  },
  { flush: "post" },
);
</script>

<template>
  <!-- 26px tabs + p-1 + the 1px border = the header's 36px controls. -->
  <div
    ref="containerRef"
    class="relative inline-flex max-w-full justify-end gap-1 rounded-md border border-border bg-muted/30 p-1"
    :class="reserved === null ? 'w-fit' : ''"
    :style="reserved === null ? undefined : { width: reserved + 'px' }"
  >
    <!-- The pill the old tab gives up: placed and played by swap(), invisible
         the rest of the time. -->
    <span
      ref="ghostRef"
      aria-hidden="true"
      class="pointer-events-none absolute origin-top-left rounded-sm bg-[hsl(var(--tac-amber))] opacity-0"
    />
    <!-- Placed and moved from the script, never through a binding: see place(). -->
    <span
      ref="indicatorRef"
      aria-hidden="true"
      class="pointer-events-none absolute origin-top-left rounded-sm bg-[hsl(var(--tac-amber))] opacity-0"
      style="box-shadow: 0 0 12px -2px hsl(var(--tac-amber) / 0.6)"
    />
    <Tooltip v-for="item in items" :key="item.key" :text="item.label" :delay="300">
      <button
        :ref="(el) => setBtn(el, item.key)"
        type="button"
        class="touch-hit relative z-10 inline-flex h-[26px] items-center justify-center rounded-sm px-2.5 font-mono text-f10 font-semibold uppercase leading-none tracking-cs1 transition-colors duration-200"
        :class="current === item.key ? 'min-w-0 grow font-bold text-black' : 'shrink-0 grow-0 text-muted-foreground hover:text-foreground'"
        :aria-label="item.label"
        :aria-current="current === item.key ? 'page' : undefined"
        @click="pick(item.key)"
      >
        <component :is="item.icon" v-if="item.icon" class="h-3.5 w-3.5 flex-none" />
        <!-- A one-column grid whose track is 1fr on the picked tab and 0fr on
             the rest; it switches at once and the swap above draws the motion. -->
        <span v-if="!hideLabels" class="ct-track grid" :class="current === item.key ? 'grid-cols-[1fr]' : 'grid-cols-[0fr] opacity-0'">
          <span class="min-w-0 overflow-hidden">
            <span class="ct-label block whitespace-nowrap pl-1.5 font-bold">{{ item.label }}</span>
          </span>
        </span>
        <span v-if="item.count !== undefined" class="ct-count ml-1 opacity-60">{{ item.count }}</span>
      </button>
    </Tooltip>
  </div>
</template>
