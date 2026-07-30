// The overlay stacking order, named.
//
// These were bare numbers scattered across nine full-screen overlays —
// 998/999/1001/1010/1300/1400 — and the ordering had already drifted out of
// step with the comments describing it. The confirm dialog still claims to sit
// "above every other overlay (modals 998, context menus 999, share popovers
// 1001)", which stopped being true once the attachment picker took 1300 and its
// 3D preview took 1400: a destructive confirm raised from either would open
// BEHIND the thing that raised it.
//
// Ordered as a ladder, so the relationship is the definition rather than
// something you reconstruct by grepping for z-[...].
// Every value below is the one that was already in the markup, EXCEPT `confirm`
// — see its note. Naming them changed no stacking; it only made the ladder
// checkable.
export const Z = {
  /** The bare 3D overlay for a default weapon, and the compact filter sheets. */
  stage: 998,
  /** The craft modal — deliberately one above `stage`, since it is opened FROM it. */
  modal: 999,
  /** Context menus, and the compact bottom sheets they become. */
  menu: 999,
  /** The undo-delete toast. */
  toast: 1000,
  /** Share popovers, which can be opened from a modal header. */
  popover: 1001,
  /** The attachment picker — reachable from both the craft form and its 3D stage. */
  picker: 1300,
  /** The picker's own 3D preview, which must cover the picker. */
  previewStage: 1400,
  /**
   * Destructive confirmation. Genuinely last, and the one value here that
   * CHANGED: it sat at 1010, under the picker (1300) and its preview (1400),
   * while its own comment claimed it was above every other overlay. Nothing
   * raises a confirm from those two today, so this was latent rather than live
   * — but it is exactly the kind of thing that stops being latent quietly.
   */
  confirm: 1500,
} as const;

export type ZLayer = keyof typeof Z;
