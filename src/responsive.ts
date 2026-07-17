import { ref, type Ref } from "vue";

// Module-level media refs: one matchMedia subscription per query for the whole
// app, shared by every component that asks. Deliberately never torn down —
// there is exactly one of each and they live as long as the plugin does.
function mediaRef(query: string): Ref<boolean> {
  // SSR / non-DOM safety: the plugin is a federated remote and gets imported in
  // contexts (tests, prerender) where matchMedia doesn't exist.
  if (typeof matchMedia === "undefined") return ref(false);
  const mq = matchMedia(query);
  const r = ref(mq.matches);
  mq.addEventListener("change", (e) => (r.value = e.matches));
  return r;
}

/** The loadout grid needs ~880px to lay out (200px identity column + three
 *  212px weapon columns + gutters). Below that the desktop composition stops
 *  being a compromise and starts being unusable, so we swap layouts outright
 *  rather than letting it scroll sideways. */
export const isCompact = mediaRef("(max-width: 860px)");

/** Touch/stylus primary input. Distinct from isCompact on purpose: a tablet is
 *  coarse but roomy, a narrow desktop window is fine but precise. Layout keys
 *  off isCompact, interaction affordances key off this. */
export const isCoarse = mediaRef("(pointer: coarse)");
