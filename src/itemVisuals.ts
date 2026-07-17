// Pure presentation helpers shared by App and ItemTile. These used to live in
// App.vue only, which is how the inventory grid and the loadout sheet ended up
// drawing the same item two different ways — keep new tile chrome in here (or
// in ItemTile) rather than re-deriving it per view.
import type { InventoryItem } from "./api";

// CS2 wear gradient (FN green -> BS red), shared by Focus + cards.
export const WEAR_GRADIENT =
  "linear-gradient(90deg,#37c46a 0 7%,#8ec44a 7% 15%,#e0b23a 15% 38%,#e07a2a 38% 45%,#e04a3a 45% 100%)";

// Steam blue — the one colour that means "this came from your Steam inventory".
export const STEAM_BLUE = "#66c0f4";

export function glowStyle(color?: string | null, opacity = 0.42) {
  return color
    ? { background: `radial-gradient(75% 65% at 50% 42%, ${color}, transparent 62%)`, filter: "blur(16px)", opacity }
    : { opacity: 0 };
}

export function attachmentsOf(i: InventoryItem) {
  return [...(i.stickers ?? []), ...(i.patches ?? []), ...(i.charm ? [i.charm] : [])].filter(
    (x): x is NonNullable<typeof x> => !!x,
  );
}

// "AK-47 | Fire Serpent" -> "Fire Serpent". Used where the weapon name is
// already the column/slot header and repeating it would just eat the width.
export function stripName(name?: string | null): string {
  if (!name) return "";
  return name.includes(" | ") ? name.split(" | ").slice(1).join(" | ") : name;
}

// Steam imports mirror a real inventory, so the backend rejects edits to them
// (POST /api/inventory/:id). The UI offers "duplicate to edit" instead.
export const isReadOnly = (i: InventoryItem) => i.origin === "steam";
