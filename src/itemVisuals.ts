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

// Bottom feather for waist-cropped art — see `.art-fade-b` in style.css for
// what it does and why it's per-item. Agents are the only type that needs it;
// everything else is a whole object with air under it.
export const ART_FADE_B = "art-fade-b";
export const isAgentArt = (i?: { slot?: string | null; item?: { type?: string | null } | null } | null) =>
  i?.item?.type === "agent" || i?.slot === "agent";

export function glowStyle(color?: string | null, opacity = 0.42) {
  return color
    ? { background: `radial-gradient(75% 65% at 50% 42%, ${color}, transparent 62%)`, filter: "blur(16px)", opacity }
    : { opacity: 0 };
}

/** Every attachment on an item, tagged with WHAT it is.
 *
 *  The kind used to be flattened away, which left a tile rendering the charm as
 *  a fifth sticker at sticker size — and a charm is one per weapon, chosen
 *  separately, so it deserves to read as its own thing rather than get lost in
 *  the row. Callers that only want images can still ignore it. */
export function attachmentsOf(i: InventoryItem) {
  const tag = <T,>(list: (T | null | undefined)[], kind: "sticker" | "patch" | "charm") =>
    list.filter((x): x is NonNullable<T> => !!x).map((x) => ({ ...x, kind }));
  return [
    ...tag(i.stickers ?? [], "sticker"),
    ...tag(i.patches ?? [], "patch"),
    ...tag(i.charm ? [i.charm] : [], "charm"),
  ];
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

// Which cs2-lib types we can actually put on screen in 3D. Music kits and
// graffiti have no 3D form at all; offering a button that silently falls back
// to the flat image reads as broken, so it is hidden rather than dead.
//
// A charm is here even though it has no `model`: its mesh is named by the econ
// schema rather than the item, and 23 of the 82 share one blank — which is why
// resolveViewerModel exists and why nothing should derive a key from `model`
// directly any more.
//
// This is a TYPE-level answer, not a per-file one. Two narrower gates sit below
// it and both matter: an individual model can be missing from the mount (the
// viewer's own HEAD probe catches that), and a PAINTED glove needs a compositor
// that does not exist yet (see resolveViewerModelSync).
const TYPES_3D = new Set(["weapon", "melee", "keychain", "agent", "glove", "sticker", "patch"]);
export const supports3d = (item?: { type?: string | null } | null) => !!item?.type && TYPES_3D.has(item.type);

// Which types actually HAVE a float and a pattern, mirroring cs2-lib's own
// CS2_PAINTABLE_ITEMS / CS2_SEEDABLE_ITEMS. Everything else — graffiti, music
// kits, agents, stickers, patches, pins — is stored with wear 0 / seed 1
// because the columns aren't nullable, and rendering those reads as a real
// reading: a spray was showing a factory-new ramp at "0.0000 · #1".
const TYPES_WEAR = new Set(["weapon", "melee", "glove"]);
const TYPES_SEED = new Set(["weapon", "melee", "glove", "keychain"]);
export const hasWear = (item?: { type?: string | null } | null) => !!item?.type && TYPES_WEAR.has(item.type);
export const hasSeed = (item?: { type?: string | null } | null) => !!item?.type && TYPES_SEED.has(item.type);

/**
 * Is there anything on this item you could change?
 *
 * The union of every editable attribute's types: float and pattern (weapon,
 * melee, glove, and the charm's own pattern), StatTrak (+ music kits), name tag,
 * and attachment slots (weapon: stickers + charm; agent: patches). A graffiti
 * has none of them — its Edit button opened a form with nothing in it, so the
 * only verb it has is equip. Same for stickers, patches and pins.
 */
const TYPES_EDITABLE = new Set(["weapon", "melee", "glove", "musickit", "agent", "keychain"]);
export const isCustomizable = (item?: { type?: string | null } | null) =>
  !!item?.type && TYPES_EDITABLE.has(item.type);

/**
 * Can this item be expressed as a steam:// inspect link?
 *
 * An inspect link is built around the game DEFINDEX, and not every economy item
 * has one — 1,767 of the 2,205 graffiti don't, which is why "Inspect in game"
 * on a tinted spray came back with "That item can't be expressed as an inspect
 * link". Not a type-level rule: the 438 graffiti that DO have a defindex
 * inspect fine, so this asks the item rather than its type. Every catalog
 * listing carries `def` for exactly this.
 */
export const canInspect = (item?: { def?: number | null } | null) => item?.def != null;
