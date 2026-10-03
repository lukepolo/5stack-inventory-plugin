// "Unmasked" CS2 inspect links — the kind that don't need the item to exist on
// Steam's backend:
//
//   steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20<HEX>
//
// Built by @ianlucas/cs2-lib-inspect, the same encoder the reference inventory
// simulator ships. This used to be a hand-rolled protobuf writer, which meant
// every new field the game grew (music kits' `musicindex`, graffiti riding the
// sticker list, and now a pet's `petindex` / `style` / `upgradeLevel` /
// variation pattern) had to be reverse-engineered here a second time. Upstream
// already knows the wire format; this file only turns our rows into its input.
//
// Input is a CS2BaseInventoryItem — cs2-lib's own shape — so the caller says
// what the item IS (cs2-lib ids, wear, seed, stickers by schema) and never
// anything about protobuf field numbers.
//
// Not a second reader of the economy (see catalog.ts on why there is only
// one): CS2Economy is the singleton catalog.ts loads, and nothing here reads an
// item field itself — it only hands items to cs2-lib's own repair and encoder.
import {
  CS2Economy,
  CS2Inventory,
  CS2InventoryItem,
  repairInventoryItem,
  type CS2BaseInventoryItem,
} from "@ianlucas/cs2-lib";
import { CS2_PREVIEW_URL, generateInspectLink } from "@ianlucas/cs2-lib-inspect";

export type { CS2BaseInventoryItem };

export { CS2_PREVIEW_URL };

// CS2InventoryItem wants an owning inventory, but only reads it for storage
// units. One empty one is enough for every link.
const scratch = new CS2Inventory({ economy: CS2Economy });

/**
 * The inspect link for an item, or null when cs2-lib cannot express it (an id
 * it does not know, or an item that is not addable at all).
 *
 * Returns either a `steam://` URL or, past the ~300 character launch limit
 * steam:// imposes, the bare `csgo_econ_action_preview <HEX>` console command
 * — that is cs2-lib-inspect's contract, and the frontend copies the command
 * instead of navigating to it.
 */
export function buildInspectLink(base: CS2BaseInventoryItem): string | null {
  const item = structuredClone(base);
  // CS2InventoryItem's constructor ASSERTS every attribute is on cs2-lib's grid,
  // so a row that was fine yesterday could throw today on one over-precise
  // float. repairInventoryItem is what the simulator itself runs on load: snap
  // to the grid, drop what can't be kept, and only fail on what is unknowable.
  if (!repairInventoryItem(CS2Economy, item)) return null;

  // Rotation is the one attribute repair moves further than our own stored
  // precision. cs2-lib validates on a 0.5° grid; we store and SEND 0.1° (see
  // normStickerRotation — that decimal is why the equipped feed is v5). The
  // link and the game server must agree, so the exact angle goes back on after
  // validation. Matched by position: repair keeps order, and if it dropped a
  // sticker the positions no longer line up, so the snapped value stands.
  const exact = Object.entries(base.stickers ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, s]) => s.rotation);

  let inspected: CS2InventoryItem;
  try {
    inspected = new CS2InventoryItem(scratch, 0, item, CS2Economy.getById(item.id));
  } catch {
    return null;
  }

  const placed = [...(inspected.stickers?.values() ?? [])];
  if (placed.length === exact.length) placed.forEach((s, i) => (s.rotation = exact[i] || undefined));

  return generateInspectLink(inspected);
}
