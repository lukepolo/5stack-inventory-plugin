<script setup lang="ts">
// A craft's proposed use: the info chip on a craft's picture, naming the weapon
// its author means it for, and the picture it opens — the craft on that
// weapon's outline, as it lay on the author's mat (stickerBoard's useCaseShot).
//
// Hover shows it with a mouse; a click (or a tap) pins it open until a press
// elsewhere, Esc, or the chip again. The picture is teleported to <body>: the
// tiles it hangs from clip at their edges, and it should be bigger than them.
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Info } from "lucide-vue-next";
import type { CraftUseCase } from "../stickerCraftsModel";
import { Z } from "../zLayers";

const props = defineProps<{
  useCase: CraftUseCase;
  /** Who placed it, for the caption: "you" or the author's name. */
  author?: string;
}>();

const tr = inject<(k: string, f: string, n?: Record<string, unknown>) => string>("tr", (_k, f) => f);

const chip = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const hovered = ref(false);
const pinned = ref(false);
const open = computed(() => hovered.value || pinned.value);
const box = ref<{ left: number; top: number; width: number } | null>(null);
/** --acc doesn't ride along to <body> (see ViewerSettingsButton). */
const acc = ref("");
const GAP = 6;

/** Under the chip, or over it when there is no room below. */
function place() {
  const el = chip.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(520, vw - 16);
  const left = Math.max(8, Math.min(r.left, vw - width - 8));
  const h = panel.value?.offsetHeight ?? 0;
  const below = r.bottom + GAP;
  const top = h && below + h > vh - 8 && r.top - GAP - h >= 8 ? r.top - GAP - h : below;
  box.value = { left, top, width };
}
function onScroll() {
  if (open.value) place();
}
function onDown(e: PointerEvent) {
  const t = e.target as Node;
  if (chip.value?.contains(t) || panel.value?.contains(t)) return;
  pinned.value = false;
  hovered.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    // The picker closes on Esc too; this one goes first.
    e.stopPropagation();
    pinned.value = false;
    hovered.value = false;
  }
}
watch(open, (on) => {
  if (on) {
    acc.value = chip.value ? getComputedStyle(chip.value).getPropertyValue("--acc") : "";
    place();
    // Measured once it is drawn, to flip it above the chip if need be.
    void nextTick(place);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  } else {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  document.removeEventListener("pointerdown", onDown, true);
  window.removeEventListener("keydown", onKey, true);
});
/** Hover is a mouse's; a finger's tap would open on "enter" and close on "leave". */
const mouse = (e: PointerEvent) => e.pointerType === "mouse";
</script>

<template>
  <button
    ref="chip"
    type="button"
    class="flex h-7 min-w-0 items-center gap-1 rounded border border-border bg-background/90 px-1.5 text-f10 uppercase tracking-cs1 text-foreground transition-colors hover:border-[color:var(--acc)]"
    :class="pinned ? 'border-[color:var(--acc)]' : ''"
    :aria-label="`Proposed use: ${useCase.weapon} — show where it goes`"
    :aria-expanded="open"
    @pointerenter="(e: PointerEvent) => mouse(e) && (hovered = true)"
    @pointerleave="(e: PointerEvent) => mouse(e) && (hovered = false)"
    @click.stop="pinned = !pinned"
  >
    <Info class="h-3.5 w-3.5 flex-none" />
    <span class="truncate">{{ useCase.weapon }}</span>
  </button>
  <Teleport to="body">
    <!-- The attributes scope the plugin's utilities to what is INSIDE this
         element (`[data-5stack-plugin] .x`), so it is placed by inline style
         and the card is its child. -->
    <div
      v-if="open && box"
      ref="panel"
      data-5stack-plugin
      data-cs2-inventory
      :style="{ position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, zIndex: Z.infoPopover, '--acc': acc }"
      role="dialog"
      :aria-label="`Proposed use: ${useCase.weapon}`"
    >
    <div class="origin-top-left animate-menu-in rounded-lg border border-border bg-card p-2 shadow-2xl">
      <div class="mb-1.5 flex items-baseline gap-2 px-0.5">
        <span class="text-f10 uppercase tracking-cs1 text-muted-foreground">{{ tr("inventory.stickerCrafts.proposedUse", "Proposed use") }}</span>
        <span class="min-w-0 truncate text-f13 font-semibold text-foreground">{{ useCase.weapon }}</span>
      </div>
      <img :src="useCase.image" alt="" class="block w-full rounded-md bg-[#183a31]" draggable="false" @load="place" />
      <div class="mt-1.5 px-0.5 text-f11 leading-snug text-muted-foreground">
        Where {{ author ?? "its author" }} placed it on the {{ useCase.weapon }}'s outline, at the gun's real size. The dashed squares are the gun's sticker slots.
      </div>
    </div>
    </div>
  </Teleport>
</template>
