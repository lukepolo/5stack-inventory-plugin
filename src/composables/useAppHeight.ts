// How tall are we, really?
//
// The app's height is `100dvh - 6rem`, where 6rem is an ASSUMPTION about the
// host chrome above us (breadcrumb + page padding). It holds on desktop. On a
// phone the host header is shorter, so we subtract more than we should and the
// app stops short of the bottom — a dead band under the picker sheet that no
// amount of padding-hunting inside the plugin can explain, because it isn't
// inside the plugin.
//
// So measure where we actually begin.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * `apply` decides whether the measured height is used at all — desktop's 6rem is
 * correct there and well tested, so only compact overrides it.
 */
export function useAppHeight(apply: () => boolean) {
  const el = ref<HTMLElement | null>(null);
  const topPx = ref(0);

  // Read after paint, and sanity-checked against a runaway value: if the number
  // looks wrong we keep the 6rem guess rather than rendering an app taller than
  // the window.
  function measure() {
    const node = el.value;
    if (!node) return;
    const top = Math.round(node.getBoundingClientRect().top);
    topPx.value = top >= 0 && top < window.innerHeight * 0.5 ? top : 0;
  }

  onMounted(() => {
    requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
  });
  onBeforeUnmount(() => window.removeEventListener("resize", measure));

  const style = computed(() =>
    apply() && topPx.value > 0 ? { height: `calc(100dvh - ${topPx.value}px)` } : {},
  );

  return { el, topPx, style, measure };
}
