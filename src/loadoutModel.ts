// The CS2 loadout taxonomy: which slots exist, what may occupy them, and what
// each team starts with.
//
// Pure data and predicates - no reactivity, no component state. Split out of
// App.vue so the loadout grid, the picker sheet, the drag/drop rules and the
// inventory rail all read the same definitions instead of re-deriving them.
import type { InventoryItem, Team } from "./api";
import { isReadOnly } from "./itemVisuals";

/** A brand-new item is factory-new until someone says otherwise. */
export const DEFAULT_WEAR = 0;

// ---- CS2 positional loadout slots -------------------------------------------
// Like CS2: 1 starting pistol + 4 other pistols, 5 mid-tier, 5 rifles per team.
// Users pick WHICH weapon occupies each slot (right-click → replace), and each
// slot's finish comes from their crafted inventory.
export const POSITION_GROUPS = [
  { key: "pistols", label: "Pistols", positions: ["sp", "p1", "p2", "p3", "p4"] },
  { key: "midtier", label: "Mid-Tier", positions: ["m1", "m2", "m3", "m4", "m5"] },
  { key: "rifles", label: "Rifles", positions: ["r1", "r2", "r3", "r4", "r5"] },
] as const;
export const START_PISTOLS = ["glock", "usp_silencer", "hkp2000"];
export const isWeaponPos = (s: string) => /^(sp|p[1-4]|m[1-5]|r[1-5])$/.test(s);
export const isSpecial = (s: string) =>
  ["knife", "gloves", "agent", "zeus", "c4", "musickit", "graffiti", "collectible"].includes(s);
export const isShared = (s: string) => ["zeus", "c4", "musickit", "graffiti", "collectible"].includes(s);
// "Special" is a LAYOUT concept (slot rail, catalog fetch, sheet keys) and was
// doing double duty as the 3D gate, which is why knives could never show 3D
// even once their GLBs existed. Split: this is the 3D one, and it's about
// whether a slot resolves to something we have a model for.
//
// Gloves and agents came off this list when their trees joined the extraction
// (v19). zeus came off too — its GLB has shipped all along, it was only ever
// here because this list started life as the "special slot" one. c4 stays:
// nothing extracts it, since it has no MAP entry.
//
// A slot-level answer is necessarily coarse — it is asked before an occupant is
// known. The per-ITEM answer (a painted glove has no compositor yet) lives in
// resolveViewerModel, and the focus/ctx paths below still HEAD-probe on top.
export const isNo3d = (s: string) => ["c4", "musickit", "graffiti", "collectible"].includes(s);
// Origin filter — the same control on the Inventory grid and on the loadout
// sheet's Owned section, so "hide my Steam imports" works the same in both.
export type OriginFilter = "all" | "steam" | "crafted";
export const ORIGIN_FILTERS = [
  ["all", "All"],
  ["steam", "Synced"],
  ["crafted", "Crafted"],
] as const;
/** The same set as a flat list, for validating what came back out of storage. */
export const ORIGIN_VALUES = ORIGIN_FILTERS.map(([v]) => v) as readonly OriginFilter[];
// The inventory filter rail's taxonomy. An inventory mixes weapons, knives,
// gloves, agents and the sticker/charm/patch catalogs, and a name search only
// helps when you already know what you're looking for — "show me my charms"
// needs a filter. Weapons split by their CS2 category so the rail speaks the
// loadout's own Pistols / Mid-Tier / Rifles vocabulary instead of exposing raw
// cs2-lib types.
export const WEAPON_GROUPS = [
  ["rifle", "Rifles"],
  ["smg", "SMGs"],
  ["heavy", "Heavy"],
  ["secondary", "Pistols"],
  ["melee", "Knives"],
  ["glove", "Gloves"],
] as const;
// Types with no per-model breakdown worth drawing — one toggle each.
export const GEAR_TYPES = [
  ["agent", "Agents"],
  ["sticker", "Stickers"],
  ["keychain", "Charms"],
  ["patch", "Patches"],
  ["musickit", "Music Kits"],
  ["graffiti", "Graffiti"],
  ["collectible", "Pins & Medals"],
] as const;
export const WEAPONISH = new Set<string>(WEAPON_GROUPS.map(([k]) => k));
// Weapons are addressed by their category ("rifle"), everything else by its
// cs2-lib type ("keychain") — the two never collide, so one key space covers both.
export const categoryOf = (i: InventoryItem): string =>
  i.item?.type === "weapon" ? i.item?.category ?? "weapon" : i.item?.type ?? "";
// "usp_silencer" -> "USP Silencer", for models the weapon catalog doesn't name
// (knives and gloves aren't in it).
export const prettyModel = (m: string) =>
  m.split("_").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
export const matchesOrigin = (i: InventoryItem, f: OriginFilter) =>
  f === "all" || (f === "steam" ? isReadOnly(i) : !isReadOnly(i));
export function catsForPos(pos: string): string[] {
  if (pos === "sp" || /^p/.test(pos)) return ["secondary"];
  if (/^m/.test(pos)) return ["smg", "heavy"];
  return ["rifle"];
}
// CS2 default loadouts (cs2-lib model names).
export const DEFAULTS: Record<Team, Record<string, string>> = {
  CT: {
    sp: "usp_silencer", p1: "elite", p2: "p250", p3: "fiveseven", p4: "deagle",
    m1: "mp9", m2: "mp7", m3: "ump45", m4: "p90", m5: "nova",
    r1: "famas", r2: "m4a1", r3: "ssg08", r4: "aug", r5: "awp",
    knife: "knife",
  },
  T: {
    sp: "glock", p1: "elite", p2: "p250", p3: "tec9", p4: "deagle",
    m1: "mac10", m2: "mp7", m3: "ump45", m4: "p90", m5: "nova",
    r1: "galilar", r2: "ak47", r3: "ssg08", r4: "sg556", r5: "awp",
    // Without this the slot falls through to the literal pos ("knife"), which
    // is a real cs2-lib key — but the CT default, so T showed a CT knife.
    knife: "knife_t",
  },
};

export const RAIL = [
  { slot: "agent", name: "Agent" },
  { slot: "gloves", name: "Gloves" },
  { slot: "knife", name: "Knife" },
];
// Extra equipment slots (CS2 inventory-simulator parity).
export const EXTRAS = [
  { slot: "zeus", name: "Zeus x27" },
  { slot: "c4", name: "C4" },
  { slot: "musickit", name: "Music Kit" },
  { slot: "graffiti", name: "Graffiti" },
  { slot: "collectible", name: "Pin / Medal" },
];
export const ALL_SPECIALS = [...RAIL, ...EXTRAS];
