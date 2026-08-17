// Does a Steam inventory of X actually land in ours?
//
// Run: node --experimental-strip-types tools/steam-sync-coverage.ts
//
// Why this exists
// ---------------
// The Steam import is two gates in a row, and BOTH fail silently:
//
//   1. NAME. Steam ships a `market_hash_name` and nothing else — no defindex,
//      no type. It is the item's name with decorations bolted on (★, StatTrak™,
//      Souvenir, a wear bracket) and, for whole families, with cs2-lib's type
//      prefix stripped off: "Container | Kilowatt Case" arrives as "Kilowatt
//      Case", "Collectible | 2025 Service Medal" as "2025 Service Medal",
//      graffiti as "Sealed Graffiti | X" against a catalog that calls it
//      "Graffiti | X". Miss a rename and that family resolves to null.
//   2. OWNERSHIP. isOwnable decides what may enter an inventory at all. It is
//      mostly slotForItem, which reads fields off the cs2-lib item — and those
//      fields have been RENAMED under us before (the 9.0.0 bump moved `model`
//      to `modelKey` and `category` to `loadoutCategory`; a second reader was
//      missed and the live textures went blank).
//
// Either failure looks exactly like "the player doesn't own any of those" — an
// empty sticker drawer is not a stack trace. So this sweeps every item in the
// economy through the real import path, family by family, and says so out loud.
//
// It builds each Steam name by INVERTING the documented rules rather than
// asking cs2-lib for it, which is the point: if the catalog renames a field or
// a prefix, the two halves stop agreeing and this fails.
// From catalog.ts, not main.ts (main boots a Fastify server on import) and not
// cs2-lib directly (catalog.ts is deliberately the ONE reader of the economy —
// a second one is how the 9.0.0 renames got half-applied). These are the same
// two functions the import route runs every asset through.
import {
  parseSteamMarketName,
  isOwnable,
  getItem,
  slotForItem,
  catalogSummary,
} from "../backend/src/catalog.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// ---- 1. the families we CLAIM to sync ---------------------------------------
// Every cs2-lib type that has somewhere to go: a loadout slot, or a place on a
// weapon. Keep this list and loadoutModel.ts's GEAR_TYPES/EXTRAS in step — they
// are the same promise made at the two ends of the app.
const SYNCED_TYPES = [
  "weapon", "melee", "glove", "agent",
  "musickit", "graffiti", "collectible",
  "sticker", "patch", "keychain",
] as const;
// Resolve, but deliberately do NOT enter an inventory: this app does not model
// unopened containers or the tools that alter items.
const SKIPPED_TYPES = ["case", "key", "tool", "utility", "stub"] as const;

// ---- 2. real market_hash_names, typed out by hand ----------------------------
// Hand-written on purpose. The sweep below generates names from the same rules
// the parser reverses, so it cannot catch a rule that is wrong in both
// directions; these came off Steam listings and can.
const SAMPLES: [name: string, wantType: string, wantSlot: string | null][] = [
  ["AK-47 | Redline (Field-Tested)", "weapon", "ak47"],
  ["StatTrak™ AK-47 | Redline (Field-Tested)", "weapon", "ak47"],
  ["Souvenir AWP | Dragon Lore (Factory New)", "weapon", "awp"],
  ["★ Karambit | Doppler (Factory New)", "melee", "knife"],
  ["★ StatTrak™ Karambit | Fade (Factory New)", "melee", "knife"],
  ["★ Sport Gloves | Pandora's Box (Field-Tested)", "glove", "gloves"],
  ["Zeus x27", "weapon", "zeus"],
  ["Zeus x27 | Olympus (Field-Tested)", "weapon", "zeus"],
  ["C4 Explosive", "weapon", "c4"],
  ["Sir Bloody Miami Darryl | The Professionals", "agent", "agent"],
  ["Music Kit | Daniel Sadowski, Crimson Assault", "musickit", "musickit"],
  ["StatTrak™ Music Kit | Daniel Sadowski, Crimson Assault", "musickit", "musickit"],
  ["Sealed Graffiti | Recoil AWP (Cash Green)", "graffiti", "graffiti"],
  ["Sealed Graffiti | Kawaii Killer CT (Tracer Yellow)", "graffiti", "graffiti"],
  ["Bloodhound Pin", "collectible", "collectible"],
  ["5 Year Veteran Coin", "collectible", "collectible"],
  ["2025 Service Medal", "collectible", "collectible"],
  ["Global Offensive Badge", "collectible", "collectible"],
  ["Sticker | Titan (Holo) | Katowice 2014", "sticker", null],
  ["Sticker | Natus Vincere | Paris 2023", "sticker", null],
  ["Patch | Crazy Banana", "patch", null],
  ["Charm | Die-cast AK", "keychain", null],
];

console.log("Steam market names -> catalog");
for (const [market, wantType, wantSlot] of SAMPLES) {
  const { itemId } = parseSteamMarketName(market);
  if (itemId == null) {
    check(market, false, "UNRESOLVED — this family imports as nothing");
    continue;
  }
  const item = getItem(itemId);
  const slot = slotForItem(itemId);
  const ok = item?.type === wantType && slot === wantSlot && isOwnable(itemId);
  check(
    market,
    ok,
    ok ? "" : `type=${item?.type} (want ${wantType}), slot=${slot} (want ${wantSlot}), ownable=${isOwnable(itemId)}`,
  );
}

// StatTrak is the one decoration that has to SURVIVE the strip rather than just
// come off it — it is how an imported item knows it counts kills.
const st = parseSteamMarketName("★ StatTrak™ Karambit | Fade (Factory New)");
check("StatTrak survives the ★ prefix", st.stattrak, `got ${st.stattrak}`);
check("wear bracket is read, not just dropped", st.wearTier === "Factory New", `got ${st.wearTier}`);
const plain = parseSteamMarketName("AK-47 | Redline (Minimal Wear)");
check("a plain item is not StatTrak", !plain.stattrak);
check("wear bracket parsed", plain.wearTier === "Minimal Wear", `got ${plain.wearTier}`);

// ---- 3. the whole economy, family by family ---------------------------------
// The inverse of the parser: what Steam calls a given catalog item.
const STEAM_STRIPPED_PREFIXES = ["Agent | ", "Container | ", "Collectible | ", "Key | ", "Tool | "];
function steamNameOf(item: { name: string; type: string }): string {
  if (item.type === "graffiti") return item.name.replace(/^Graffiti \| /, "Sealed Graffiti | ");
  for (const p of STEAM_STRIPPED_PREFIXES) {
    if (item.name.startsWith(p)) return item.name.slice(p.length);
  }
  // The ★ is Steam's, not the catalog's, and it rides on every knife and glove.
  if (item.type === "melee" || item.type === "glove") return `★ ${item.name}`;
  return item.name;
}

console.log("\nWhole-catalog sweep");
const stats = new Map<string, { total: number; unresolved: string[]; unownable: string[] }>();
for (const item of catalogSummary()) {
  const bucket = stats.get(item.type) ?? { total: 0, unresolved: [], unownable: [] };
  bucket.total++;
  const { itemId } = parseSteamMarketName(steamNameOf(item));
  if (itemId == null) bucket.unresolved.push(item.name);
  else if (!isOwnable(itemId)) bucket.unownable.push(item.name);
  stats.set(item.type, bucket);
}

for (const type of SYNCED_TYPES) {
  const b = stats.get(type);
  if (!b) {
    check(`${type}: present in the catalog`, false, "no items of this type at all — did cs2-lib rename it?");
    continue;
  }
  const lost = b.unresolved.length + b.unownable.length;
  check(
    `${type}: all ${b.total} import`,
    lost === 0,
    lost === 0
      ? ""
      : `${b.unresolved.length} unresolved, ${b.unownable.length} not ownable` +
        ` (e.g. ${[...b.unresolved, ...b.unownable].slice(0, 3).join("; ")})`,
  );
}
for (const type of SKIPPED_TYPES) {
  const b = stats.get(type);
  if (!b) continue;
  const entering = b.total - b.unresolved.length - b.unownable.length;
  check(`${type}: stays out of inventories`, entering === 0, `${entering} of ${b.total} would import`);
}

// A type the catalog grew that this file has never heard of. Not a failure —
// cs2-lib adds things — but it IS the moment to decide which list it belongs
// on, rather than discovering the answer from a player's empty drawer.
const known = new Set<string>([...SYNCED_TYPES, ...SKIPPED_TYPES]);
for (const type of stats.keys()) {
  if (!known.has(type)) console.log(`  note  new cs2-lib type "${type}" (${stats.get(type)!.total} items) — synced or skipped?`);
}

console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
