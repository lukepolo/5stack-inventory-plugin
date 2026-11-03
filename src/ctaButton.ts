// The primary action's look: the item editor's Save and Equip, in the panel's
// amber CTA gradient. For the one button on a screen that commits something;
// `tac-on` is not this — it marks a toggle that is on (Snap, a published craft).
export const CTA_CLASS =
  "flex h-9 items-center justify-center gap-1.5 rounded-md border border-transparent px-4 text-f11 font-bold uppercase tracking-wider text-black transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
export const CTA_STYLE =
  "background: linear-gradient(135deg, var(--tac-amber-cta-from, #f9b04a), var(--tac-amber-cta-to, #d97f16)); box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)";
