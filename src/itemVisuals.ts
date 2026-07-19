// Pure presentation helpers shared by App and ItemTile. These used to live in
// App.vue only, which is how the inventory grid and the loadout sheet ended up
// drawing the same item two different ways — keep new tile chrome in here (or
// in ItemTile) rather than re-deriving it per view.
import type { InventoryItem } from "./api";

// The CS2 wear scale. The hard stops aren't decoration — they're the real tier
// boundaries, which is why the ramp is worth drawing at all: it says "this
// float sits near the top of Field-Tested" in a way a number can't.
export const WEAR_STOPS = [
  { max: 0.07, color: "#37c46a", tier: "Factory New" },
  { max: 0.15, color: "#8ec44a", tier: "Minimal Wear" },
  { max: 0.38, color: "#e0b23a", tier: "Field-Tested" },
  { max: 0.45, color: "#e07a2a", tier: "Well-Worn" },
  { max: Infinity, color: "#e04a3a", tier: "Battle-Scarred" },
] as const;

// Rounded because 0.07 * 100 is 7.000000000000001, which ends up in both the
// gradient string and the hairline `left:` values.
const pct = (n: number) => Math.round(Math.min(n, 1) * 1e4) / 100;

// Interior boundaries as percentages — hairlines that make the scale readable.
export const WEAR_BOUNDS = WEAR_STOPS.slice(0, -1).map((s) => pct(s.max));

export const WEAR_GRADIENT = `linear-gradient(90deg,${WEAR_STOPS.map(
  (s, i) => `${s.color} ${pct(WEAR_STOPS[i - 1]?.max ?? 0)}% ${pct(s.max)}%`,
).join(",")})`;

const stopFor = (wear: number) => WEAR_STOPS.find((s) => wear < s.max) ?? WEAR_STOPS[4];
/** Ramp colour at a float — tints the marker so it reads against its own tier. */
export const wearColor = (wear: number) => stopFor(wear).color;
export const wearTier = (wear: number) => stopFor(wear).tier;

// Steam blue — the one colour that means "this came from your Steam inventory".
export const STEAM_BLUE = "#66c0f4";

// One geometry for every surface an item renders on. The loadout cells and the
// inventory/sheet tiles stay separate components — drag-and-drop plus slot
// selection is nothing like per-item actions — so what's shared is the box, not
// the behaviour. Before this the same knife changed size and padding every time
// it moved between equipped and unequipped.
//
// CARD_ART's floor exists only to stop a total collapse: these wells were
// `min-h-0 flex-1`, which works right up until the footer grows — adding the
// phase line and the wear bar left nothing over and the art vanished. Keep the
// floor SMALL. It is not a target size; the loadout columns size cells by
// dividing their height five ways, and a generous floor here is exactly what
// forces a column to scroll instead of fitting.
export const CARD_ART =
  "relative z-[2] flex w-full flex-1 items-center justify-center min-h-[40px]";

// Vertical space a card spends on everything that isn't art: header, name (+
// phase), wear bar, float/seed row, padding. Constant regardless of card size,
// so the grids size rows as art + this rather than by a ratio — a ratio starved
// the art at small sizes the moment the footer grew.
export const CARD_CHROME_PX = 78;

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

// "★ Butterfly Knife | Marble Fade" -> "Butterfly Knife". The catalog `model`
// is a raw slug (knife_butterfly) — correct as a key, unreadable as a label,
// which is what tile headers were showing.
export function weaponName(item?: { name?: string | null; model?: string | null } | null): string {
  const full = item?.name ?? "";
  const head = full.includes(" | ") ? full.split(" | ")[0] : "";
  return (head || item?.model || "").replace(/^★\s*/, "").trim();
}

// "AK-47 | Fire Serpent" -> "Fire Serpent". Used where the weapon name is
// already the column/slot header and repeating it would just eat the width.
export function stripName(name?: string | null): string {
  if (!name) return "";
  return name.includes(" | ") ? name.split(" | ").slice(1).join(" | ") : name;
}

// THE display name for any catalog item or skin. Finishes that share a market
// name are distinguished only by `altName` (Doppler "Phase 2" / "Ruby", Gamma
// Doppler "Emerald") — each is its own paint index, so a bare name renders a
// dozen visibly different knives as identical rows. Every surface that shows an
// item name should go through this; `strip` drops the weapon prefix where a
// slot header already carries it.
export function itemName(
  item?: { name?: string | null; altName?: string | null } | null,
  opts?: { strip?: boolean },
): string {
  if (!item?.name) return "";
  const base = opts?.strip ? stripName(item.name) : item.name;
  return item.altName ? `${base} (${item.altName})` : base;
}

// Steam imports mirror a real inventory, so the backend rejects edits to them
// (POST /api/inventory/:id). The UI offers "duplicate to edit" instead.
export const isReadOnly = (i: InventoryItem) => i.origin === "steam";
