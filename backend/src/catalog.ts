import {
  CS2Economy,
  CS2RarityColorOrder,
  CS2_ITEMS,
  CS2_MAX_STATTRAK,
  CS2_MAX_PATCHES,
  CS2_MAX_STICKERS,
  CS2_MAX_STICKER_ROTATION,
  CS2_MAX_KEYCHAINS,
  CS2_MIN_STICKER_ROTATION,
  CS2_STICKER_OFFSET_FACTOR,
  CS2_STICKER_ROTATION_STEP,
  CS2_STICKER_WEAR_FACTOR,
  CS2_WEAR_FACTOR,
  truncateToFactor,
} from "@ianlucas/cs2-lib";
import { patchSlotsSync } from "./agentPatchSlots.ts";
import { english } from "@ianlucas/cs2-lib/translations/english";

// Load the CS2 economy catalog once at startup (~27k items). This is the same
// data source the reference cs2-inventory-simulator uses — but only for item
// METADATA. Artwork is served from our own mount, never a third party.
CS2Economy.load({ items: CS2_ITEMS, language: english });

const items = CS2Economy.itemsAsArray;

// cs2-lib's `imagePath` is a ROOT-RELATIVE path ("/images/<stem>_<hash8>.webp")
// that we serve ourselves out of the extracted econ-icon mirror. It stays
// relative here: the backend can't know the public origin (the plugin is
// federated into the panel, so a bare path would resolve against the PANEL's
// host), so the frontend prefixes it at the API boundary — see assetUrl in
// src/api.ts. That indirection is also the seam for pointing artwork at a
// shared CDN (skins.5stack.gg) later without touching the catalog.
function img(path: string | undefined): string | null {
  return path ?? null;
}

// CS2 teams: 2 = Terrorist, 3 = Counter-Terrorist.
function teamsOf(item: { teams?: unknown[] | undefined }): ("CT" | "T")[] {
  return (item.teams ?? []).map((t) => (String(t) === "3" ? "CT" : "T"));
}

export interface CatalogWeapon {
  model: string;
  name: string;
  category: string;
  teams: ("CT" | "T")[];
  image: string | null;
  def: number | undefined;
}

export interface CatalogSkin {
  id: number;
  name: string;
  rarity: string;
  image: string | null;
  // Phase/variant for finishes that share one market name — Doppler and Gamma
  // Doppler ("Ruby", "Phase 2", "Emerald"), Marble Fade, etc. Each is its own
  // paint index; without this the picker shows N identical rows.
  altName?: string | null;
  // What the 3D viewer needs to draw the finish before it is an owned item.
  // The weapon sheet can infer the model from the slot, but a KNIFE sheet
  // can't — every knife finish carries its own model — so listings that feed
  // the craft editor have to say. Without these the editor had no model to
  // probe and fell back to the flat icon; the same knife opened 3D fine once
  // it was in the inventory, because that path reads getItem().
  model?: string | null;
  paintMaterial?: string | null;
  legacyPaint?: boolean;
  /**
   * cs2-lib type — "weapon", "melee", "glove", "musickit", "agent", …
   *
   * Every listing carries it, and that is load-bearing: the craft editor decides
   * which controls an item gets by asking its TYPE, and falls back to the
   * loadout slot only when the type is unknown. Agents and gloves said so;
   * knives, music kits and weapon finishes did not — which was invisible while
   * crafting always started from a matching slot, and wrong the moment it could
   * start anywhere else. Opened from the armory, a knife inherited whatever
   * rifle position was last selected and was offered five sticker slots.
   */
  type?: string;
  /** Game defindex. Absent means the item CANNOT be expressed as an inspect
   *  link (1,767 of the 2,205 graffiti have none), which is the one thing the
   *  frontend can't work out for itself — so every listing says. */
  def?: number;
  // ---- sheet facets. Optional, and only graffiti carries them today; the
  // sheet's filter bar is driven ENTIRELY by which of these show up on the
  // list it loaded, so a catalog that omits them renders exactly as before.
  /** Coarse "what IS this" split — the tab strip. See GRAFFITI_GROUPS. */
  group?: string;
  /** Capsule / box / tournament this came in. Omitted when it came in none. */
  collection?: string;
  /** Artwork identity shared by every colour variant — the STACK key. */
  design?: number;
  /** Colourway id, for the items that come in more than one. */
  tint?: number;
  /** That colourway's name ("Cash Green"). */
  tintName?: string;
  // ---- per-item attribute facts, for the craft editor's controls ------------
  // Only the paintable listings carry these; see wearRange below for why they
  // are not derivable from `type`.
  wearMin?: number;
  wearMax?: number;
  seedMin?: number;
  seedMax?: number;
}

/**
 * The float and pattern ranges a finish REALLY has.
 *
 * A listing's `type` cannot answer this. 1,683 of the 2,106 paintable items are
 * narrower than 0..1 — AK-47 | Redline is 0.10–0.70, Desert Eagle | Blaze is
 * 0.00–0.08 — and the craft editor drew every one of them a full-range slider,
 * which built floats those items cannot have and sent them to the game server.
 *
 * Spread into the paintable listings only. A vanilla weapon answers `hasWear()`
 * false and gets nothing, which is what stops the editor offering it a float.
 */
function wearRange(i: (typeof items)[number]) {
  return {
    ...(i.hasWear() ? { wearMin: i.getMinimumWear(), wearMax: i.getMaximumWear() } : {}),
    ...(i.hasSeed() ? { seedMin: i.getMinimumSeed(), seedMax: i.getMaximumSeed() } : {}),
  };
}

// The 36 base (vanilla) weapons. Excludes the C4. `id` is the base economy
// item id — equipping it is a free "default weapon" equip (no crafting).
export function getWeapons(): (CatalogWeapon & { id: number })[] {
  return items
    .filter(
      (i) => i.type === "weapon" && !i.variantIndex && i.loadoutCategory !== "c4",
    )
    .map((i) => ({
      id: i.id,
      model: i.modelKey as string,
      name: i.name,
      category: i.loadoutCategory as string,
      teams: teamsOf(i),
      image: img(i.imagePath),
      def: i.definitionIndex,
    }));
}

// True for vanilla base weapons (no paint index) — the only items that can be
// equipped for free, without crafting.
export function isBaseWeapon(id: number): boolean {
  try {
    const i = CS2Economy.getById(id);
    return !!i && i.type === "weapon" && !i.variantIndex;
  } catch {
    return false;
  }
}

// Paints (skins) for a weapon model, with the vanilla base as the first option.
export function getWeaponSkins(model: string): {
  base: CatalogSkin | null;
  skins: CatalogSkin[];
} {
  const base = items.find(
    (i) => i.type === "weapon" && i.modelKey === model && !i.variantIndex,
  );
  const skins = items
    .filter((i) => i.type === "weapon" && i.modelKey === model && i.variantIndex)
    .map((i) => ({
      id: i.id,
      name: i.name,
      altName: i.alternateName ?? null,
      rarity: i.rarityColor as string,
      image: img(i.imagePath),
      model: (i.modelKey as string) ?? null,
      paintMaterial: i.materialPath ?? null,
      legacyPaint: !!i.isLegacyModel,
      type: i.type,
      def: i.definitionIndex,
      ...wearRange(i),
    }));
  return {
    base: base
      ? {
          id: base.id,
          name: base.name,
          rarity: base.rarityColor as string,
          image: img(base.imagePath),
          def: base.definitionIndex,
        }
      : null,
    skins,
  };
}

export function getAgents() {
  return items
    .filter((i) => i.type === "agent")
    .map((a) => ({
      id: a.id,
      name: a.name,
      // Same as every other catalog listing: without it the craft sheet draws
      // agents with no rarity rule and no glow, so they were the one slot whose
      // tiles changed appearance the moment you equipped them (the equipped
      // instance resolves rarity through getItem).
      rarity: a.rarityColor as string,
      teams: teamsOf(a),
      image: img(a.imagePath),
      // `model` and `type` are what let the craft editor mount 3D at all — the
      // resolver reads the type to pick a viewer kind, and without either the
      // agent sheet had no 2D/3D toggle and no 3D button. An agent's model is
      // ALREADY the full archive path ("agents/models/tm_leet/tm_leet_variantg"),
      // which is why nothing else has to translate it.
      model: (a.modelKey as string) ?? null,
      type: a.type,
      def: a.definitionIndex,
    }));
}

export function getKnives(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "melee")
    .map((k) => ({
      id: k.id,
      name: k.name,
      altName: k.alternateName ?? null,
      rarity: k.rarityColor as string,
      image: img(k.imagePath),
      // Per FINISH, not per slot: "★ Karambit | Doppler" and "★ Bayonet |
      // Doppler" are different models, so the craft editor can only mount 3D
      // if the listing carries it.
      model: (k.modelKey as string) ?? null,
      paintMaterial: k.materialPath ?? null,
      legacyPaint: !!k.isLegacyModel,
      type: k.type,
      def: k.definitionIndex,
      ...wearRange(k),
    }));
}

export function getMusicKits(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "musickit")
    .map((m) => ({
      id: m.id,
      name: m.name,
      rarity: m.rarityColor as string,
      image: img(m.imagePath),
      type: m.type,
      def: m.definitionIndex,
    }));
}

// Pins and medals. Display-only in game (the plugin sends one `collectible.def`
// and CS2 hangs it off the player), so there is no wear/seed/pattern here and
// nothing to craft — the listing is the whole feature.
export function getCollectibles(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "collectible")
    .map((c) => ({
      id: c.id,
      name: c.name,
      rarity: c.rarityColor as string,
      image: img(c.imagePath),
      type: c.type,
      def: c.definitionIndex,
    }));
}

// ---- Attachment browsing (stickers / charms / patches) ----------------------
//
// Stickers and charms are ~10.5k items EACH, so the pickers search, FACET and
// page server-side — a full sticker list is over a megabyte of JSON, and a flat
// name search over that many near-identical names ("Sticker | <team> | <event>",
// twenty variants each) isn't browsing, it's guessing. Every item is indexed
// once at startup under three facets, and a query narrows by all three.
//
// There used to be a flat `limit = 80` here with no offset, which silently made
// the picker "the first 80 stickers whose name contains your query" — with no
// way to reach the rest and nothing on screen saying so.

export type AttachKind = "sticker" | "charm" | "patch";

/** cs2-lib `type` behind each picker. "charm" is the game's `keychain`. */
const ATTACH_TYPE: Record<AttachKind, string> = { sticker: "sticker", charm: "keychain", patch: "patch" };

/**
 * Sub-kind facet — the coarse "what IS this" split, which no single cs2-lib
 * field carries. Derived per kind:
 *
 * CHARMS. 10,565 of the 10,646 `keychain` items are Sticker Slabs (the hanging
 * slab version of a sticker, one per sticker) and only 81 are actual Charms.
 * Undivided, the charm picker is a wall of slabs with the charms lost in it.
 *
 * STICKERS. Player autographs are exactly the ones whose artwork stem is
 * `sig_*` — that is the game's own naming and it covers 7,495 of them with no
 * exceptions (every `sig_` sticker also carries a tournamentDesc, so the two
 * signals agree). What's left in a tournament capsule is team logos; what's
 * outside one is community/licensed art.
 */
interface GroupDef {
  value: string;
  label: string;
  /** Indexed groups this tab covers. More than one would be a UNION tab. */
  members: string[];
}
// Tab order as shown, left to right — most browsable first, and the picker opens
// on whichever is first (see PICKER_DEFAULT_GROUP in App.vue). "All" is not here:
// it's the frontend's own (value ""), and it goes LAST, after the useful splits.
//
// Deliberately three DISJOINT sticker tabs rather than a "not an autograph"
// union. That union read as "Logos & Art" and was mostly logos — 2,105 team
// crests drowning the 965 actual art stickers, which is the same burying problem
// one level down. Logos have their own tab; art means art.
const GROUPS: Record<AttachKind, GroupDef[]> = {
  sticker: [
    { value: "community", label: "Art", members: ["community"] },
    { value: "team", label: "Team Logos", members: ["team"] },
    // Last, and never the default: 7,495 of the 10,565 stickers are player
    // autographs, up to twenty near-identical variants each. Nothing anyone
    // picks by eye is in here — you get here by searching a player's name.
    { value: "signature", label: "Signatures", members: ["signature"] },
  ],
  charm: [
    { value: "charm", label: "Charms", members: ["charm"] },
    { value: "slab", label: "Sticker Slabs", members: ["slab"] },
  ],
  patch: [],
};

export interface AttachFacet {
  value: string;
  /** Absent for rarity — those are hex colours the frontend already names. */
  label?: string;
  count: number;
}
export interface AttachPage {
  items: CatalogSkin[];
  total: number;
  /** Matches for the text query ALONE — what the "All" tab counts. Can't be
   *  derived from `groups`: one of those is a union of the others. */
  queryTotal: number;
  groups: AttachFacet[];
  collections: AttachFacet[];
  rarities: AttachFacet[];
}

interface AttachEntry {
  id: number;
  name: string;
  rarity: string;
  image: string | null;
  group: string;
  /** Capsule / collection this came in. "" for the items that belong to none. */
  collection: string;
  /** Lowercased name, precomputed — the search runs on every keystroke. */
  search: string;
}

// Built once, lazily, and held for the process. Also replaces a full 27k-item
// scan per keystroke with a walk over just the ~21k rows that can ever match.
const attachIndexes = new Map<AttachKind, AttachEntry[]>();

function buildAttachIndex(kind: AttachKind): AttachEntry[] {
  const type = ATTACH_TYPE[kind];
  const out: AttachEntry[] = [];
  for (const i of items) {
    if (i.type !== type) continue;
    let group = "";
    let collection = (i.categoryName as string) ?? "";
    if (kind === "sticker") {
      group = /\/images\/sig_/.test(i.imagePath ?? "")
        ? "signature"
        : i.tournamentDescription
          ? "team"
          : "community";
    } else if (kind === "charm") {
      // Only the STICKER carries the capsule, so a slab borrows its collection
      // from the sticker it displays. This used to join on the name (strip the
      // "Sticker Slab | " prefix, look up "Sticker | …") — exact in practice but
      // a string join all the same. cs2-lib 9 states the relationship outright:
      // `displayedStickerId` is on the slab itself, so the link is data now.
      const slab = i.isStickerDisplayCase();
      group = slab ? "slab" : "charm";
      collection = slab ? (i.displayedSticker?.categoryName as string) ?? "" : "";
    }
    out.push({
      id: i.id,
      name: i.name,
      rarity: i.rarityColor as string,
      image: img(i.imagePath),
      group,
      collection,
      search: i.name.toLowerCase(),
    });
  }
  return out;
}

function attachIndex(kind: AttachKind): AttachEntry[] {
  let index = attachIndexes.get(kind);
  if (!index) {
    index = buildAttachIndex(kind);
    attachIndexes.set(kind, index);
  }
  return index;
}

/**
 * Sort has to happen HERE, not in the picker: the grid only ever holds the pages
 * it has scrolled through, so sorting client-side would order those and leave the
 * rest of the 10k arriving in catalog order underneath.
 *
 * "default" is catalog order, which is roughly release order and groups a capsule
 * together — the best default for browsing, and free (no sort at all).
 */
export type AttachSort = "default" | "rarity" | "name";
export type AttachDir = "asc" | "desc";
/** Each sort's natural direction — the one you meant by picking it. A flip negates
 *  the PRIMARY key only, so the name tiebreak stays A→Z either way. */
const ATTACH_NATURAL: Record<AttachSort, AttachDir> = { default: "asc", rarity: "desc", name: "asc" };

// Rarity is a hex colour with no inherent order, so ranking it needs a table —
// and cs2-lib ships exactly that one. The hand-written copy that used to live
// here agreed with `CS2RarityColorOrder` on all eight colours the catalogue
// actually uses, and carried two (#ffd700, #ffae39) that appear on no item at
// all, so this is a straight dedup rather than a behaviour change.
//
// NB the FRONTEND's RARITY_META stays hand-written on purpose: it carries the
// player-facing tier NAMES ("Covert", "Mil-Spec"), and cs2-lib's names are the
// internal ones ("ancient", "rare"). Only the ordering was duplicated.
const rarityRank = (hex: string) =>
  CS2RarityColorOrder[hex?.toLowerCase() as keyof typeof CS2RarityColorOrder] ?? 0;

export interface AttachQuery {
  kind: AttachKind;
  q?: string;
  group?: string;
  collection?: string;
  rarity?: string;
  sort?: AttachSort;
  dir?: AttachDir;
  offset?: number;
  limit?: number;
}

const bump = (into: Map<string, number>, key: string) => into.set(key, (into.get(key) ?? 0) + 1);

/**
 * One page of an attachment search, plus the facet counts to draw the filter bar.
 *
 * Each facet is counted with the filters ABOVE it applied and its own ignored —
 * group, then collection, then rarity. That's what keeps the bar usable: counted
 * with its own filter applied, a facet list would collapse to the single value
 * you just picked and there'd be no way to switch to another without clearing.
 */
export function searchAttachments(query: AttachQuery): AttachPage {
  const needle = (query.q ?? "").trim().toLowerCase();
  const group = query.group ?? "";
  const collection = query.collection ?? "";
  const rarity = query.rarity ?? "";
  const offset = query.offset ?? 0;
  const limit = query.limit ?? Infinity;
  const groups = new Map<string, number>();
  const collections = new Map<string, number>();
  const rarities = new Map<string, number>();
  const out: CatalogSkin[] = [];
  let total = 0;
  let queryTotal = 0;
  // An unrecognised group (a stale link, a renamed tab) reads as "All" rather
  // than as an empty grid — nothing is hidden by a filter nobody chose.
  const members = GROUPS[query.kind].find((g) => g.value === group)?.members;
  // Sorted queries have to see the whole match set before they can know what
  // belongs on this page, so they collect first and slice after. Unsorted stays
  // streaming: it never holds more than one page, which is what keeps the default
  // "All stickers" open cheap.
  const sort = query.sort ?? "default";
  const dir = query.dir ?? ATTACH_NATURAL[sort];
  const flip = dir === ATTACH_NATURAL[sort] ? 1 : -1;
  // Streaming only survives the one case that needs no reordering at all.
  const ordered = sort !== "default" || flip === -1;
  const matched: AttachEntry[] = [];
  for (const e of attachIndex(query.kind)) {
    if (needle && !e.search.includes(needle)) continue;
    queryTotal++;
    if (e.group) bump(groups, e.group);
    if (members && !members.includes(e.group)) continue;
    if (e.collection) bump(collections, e.collection);
    if (collection && e.collection !== collection) continue;
    bump(rarities, e.rarity);
    if (rarity && e.rarity !== rarity) continue;
    total++;
    if (ordered) {
      matched.push(e);
      continue;
    }
    // Keep counting past the page — `total` drives the infinite scroll.
    if (total <= offset || out.length >= limit) continue;
    // `type` rides along on every row. The craft editor picks an item's whole
    // FORM off its type — a sticker gets a scratch slider, a charm a pattern —
    // and falls back to the loadout slot when it's missing. From a picker that
    // was harmless (a slot was always in play); from the armory it meant a
    // sticker opened the gun editor, because `selected` was still on a rifle.
    out.push({ id: e.id, name: e.name, rarity: e.rarity, image: e.image, type: ATTACH_TYPE[query.kind] });
  }
  if (ordered) {
    // Rarity naturally descending (covert first, like the weapon sheets), with
    // name as the tiebreak so the order is TOTAL. A partial order would let
    // equal-ranked items shuffle between page fetches and the same sticker could
    // arrive twice, or never — the pages are requested separately.
    if (sort === "name") matched.sort((a, b) => flip * a.name.localeCompare(b.name));
    else if (sort === "rarity") {
      matched.sort((a, b) => flip * (rarityRank(b.rarity) - rarityRank(a.rarity)) || a.name.localeCompare(b.name));
    } else matched.reverse(); // "default" reversed = newest capsules first
    for (const e of matched.slice(offset, offset + (limit === Infinity ? matched.length : limit))) {
        out.push({ id: e.id, name: e.name, rarity: e.rarity, image: e.image, type: ATTACH_TYPE[query.kind] });
    }
  }
  return {
    items: out,
    total,
    queryTotal,
    // Fixed order, so the tabs don't reshuffle as counts change. A union tab sums
    // its members; a tab with nothing behind it is dropped.
    groups: GROUPS[query.kind]
      .map((g) => ({
        value: g.value,
        label: g.label,
        count: g.members.reduce((n, m) => n + (groups.get(m) ?? 0), 0),
      }))
      .filter((g) => g.count > 0),
    // Insertion order = catalog order ≈ release order, which reads far better
    // for capsules than alphabetical ("2013 DreamHack Winter" first, newest last).
    collections: [...collections].map(([value, count]) => ({ value, label: value, count })),
    rarities: [...rarities].map(([value, count]) => ({ value, count })),
  };
}

// ---- Graffiti ---------------------------------------------------------------
//
// The graffiti SHEET is a different shape from the pickers: it filters, sorts
// and facets client-side over the whole list (like every other weapon sheet), so
// paging it server-side would quietly reduce its search box to "search the pages
// you happen to have loaded". ~2.2k items is small enough to hand over whole and
// let the grid's render window keep the DOM sane.
//
// What the sheet CAN'T do for itself is name the facets: cs2-lib gives graffiti
// no `category` (the field stickers get their capsule from — zero of the 2,205
// carry one), so every split below is derived here and shipped alongside.

/** Tab order as shown, left to right. "All" is the frontend's own, and goes last. */
const GRAFFITI_GROUPS: { value: string; label: string }[] = [
  { value: "art", label: "Art" },
  // 384 tournament team crests. Undivided they're ~1 tile in 6 of the sheet,
  // and none of them is what you came to the Art tab looking for.
  { value: "team", label: "Team Logos" },
];

/**
 * Swatch colours for the 19 colourways, indexed by the game's tint id.
 *
 * DECORATIVE ONLY — these are eyeballed approximations for the dot beside the
 * label in the filter dropdown, not the tint the game actually applies (that
 * lives in the sprayed material, not in any item field). The label is what
 * carries the meaning; the dot only has to be close enough to scan by.
 */
const GRAFFITI_TINT_HEX: Record<number, string> = {
  1: "#9c3b2e", 2: "#7a1f1f", 3: "#d2691e", 4: "#8b6b4a", 5: "#d99a2b",
  6: "#e8d84a", 7: "#4a5d33", 8: "#2e6b3f", 9: "#5fbf4a", 10: "#2fa36b",
  11: "#3aa8c1", 12: "#2f5fb3", 13: "#1f3a6e", 14: "#6a3fa0", 15: "#a24bd4",
  16: "#e0559b", 17: "#f2a8c6", 18: "#b3567a", 19: "#e6e6e6",
};

export interface GraffitiCatalog {
  skins: CatalogSkin[];
  /** Tab strip, in display order. Empty tabs are dropped by the caller. */
  groups: { value: string; label: string }[];
  /** Colourways in game order, so the dropdown reads red → white, not A→Z. */
  tints: { value: string; label: string; color: string }[];
}

let graffitiCatalog: GraffitiCatalog | null = null;

export function getGraffiti(): GraffitiCatalog {
  if (graffitiCatalog) return graffitiCatalog;
  const graffiti = items.filter((i) => i.type === "graffiti");

  // Which box a spray came in. There is no field for this — the only record is
  // the six graffiti containers' own `contents`, read backwards. Covers 1,042
  // of the 2,205; the tournament sprays are covered by their event instead and
  // the rest genuinely belong to no collection (they get "", same as a
  // capsule-less sticker — see searchAttachments).
  //
  // `contentIds`, not `contents`: the latter asserts the item IS a container
  // (expectContainer in cs2-lib, which throws) and inflates every id into a full
  // item object. All we want is the ids.
  const ids = new Set(graffiti.map((i) => i.id));
  const boxes = new Map<number, string>();
  for (const c of items) {
    if (c.type !== "case") continue;
    const contents = c.contentIds;
    if (!Array.isArray(contents)) continue;
    for (const id of contents) {
      if (ids.has(id) && !boxes.has(id)) boxes.set(id, c.name.replace(/^Container \| /, ""));
    }
  }

  // Colourway names come from the data rather than a table of our own: the
  // parenthesised suffix is the tint's name for all 1,767 tinted sprays, with
  // no untinted spray carrying one. A table would be a second place to keep
  // them right.
  const tintNames = new Map<number, string>();
  const skins = graffiti.map((i) => {
    const tint = i.tintIndex as number | undefined;
    const tintName = tint != null ? /\(([^()]+)\)\s*$/.exec(i.name)?.[1] : undefined;
    if (tint != null && tintName) tintNames.set(tint, tintName);
    return {
      id: i.id,
      name: i.name,
      rarity: i.rarityColor as string,
      image: img(i.imagePath),
      def: i.definitionIndex,
      // Same rule the sticker index uses: a tournament description means it came
      // out of an event capsule, and for graffiti that only ever means a crest.
      group: i.tournamentDescription ? "team" : "art",
      // "Graffiti | Astralis | Atlanta 2017" — the third segment IS the event,
      // and reads far better as a filter value than the tournamentDescription
      // sentence it's taken from ("This item commemorates the 2017 ELEAGUE…").
      collection: (i.tournamentDescription ? i.name.split(" | ")[2] : boxes.get(i.id)) || undefined,
      // 531 designs across 2,205 items: 93 of them exist in all 19 colourways
      // and 438 in exactly one. This is what the sheet stacks on.
      design: i.variantIndex as number | undefined,
      tintName,
    } satisfies CatalogSkin;
  });

  graffitiCatalog = {
    skins,
    groups: GRAFFITI_GROUPS,
    tints: [...tintNames.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, label]) => ({ value: label, label, color: GRAFFITI_TINT_HEX[id] ?? "#888888" })),
  };
  return graffitiCatalog;
}

// Resolve items by id. Shareable craft links carry only ids (a URL can't hold
// names and CDN paths for five stickers), so opening one has to turn those ids
// back into renderable items. Search-by-name can't do it: the recipient doesn't
// know the name, that's the whole point of the link.
export function getItemsByIds(ids: number[]): (CatalogSkin & {
  paintMaterial: string | null;
  legacyPaint: boolean;
  model: string | null;
  type: string;
})[] {
  const out = [];
  for (const id of ids) {
    let i;
    try {
      i = CS2Economy.getById(id);
    } catch {
      continue; // a hand-edited or stale id — skip it, don't fail the link
    }
    if (!i) continue;
    out.push({
      id: i.id,
      name: i.name,
      rarity: i.rarityColor as string,
      image: img(i.imagePath),
      paintMaterial: i.materialPath ?? null,
      legacyPaint: !!i.isLegacyModel,
      model: (i.modelKey as string) ?? null,
      type: i.type as string,
      // Every other catalog projection carries it, and this one dropping it was
      // silently load-bearing: a SHARED craft link rehydrates through here, so
      // the item arrived with no defindex and the editor's "Inspect in game"
      // decided the item couldn't be expressed as a link. The link itself never
      // needed the field — the backend resolves the defindex from item_id — so
      // the only casualty was the button, on the one route where the item comes
      // from a stranger's URL rather than from your own inventory.
      def: i.definitionIndex,
      ...wearRange(i),
    });
  }
  return out;
}

export function getGloves(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "glove")
    .map((g) => ({
      id: g.id,
      name: g.name,
      rarity: g.rarityColor as string,
      image: img(g.imagePath),
      // Same reason as the agents above. `paintMaterial` rides along because a
      // glove finish needs its own compositor — and because its presence is what
      // the resolver checks to decide whether a glove can render yet.
      model: (g.modelKey as string) ?? null,
      type: g.type,
      paintMaterial: g.materialPath ?? null,
      def: g.definitionIndex,
      ...wearRange(g),
    }));
}

export interface RenderTestItem {
  id: number;
  name: string;
  kind: "weapon" | "knife" | "glove";
  model: string;
  paintMaterial: string;
  legacy: boolean;
  rarity: string;
  image: string | null;
}

// Every 3D-renderable painted finish — weapon skins, knife finishes and glove
// finishes — flattened into the minimum a client needs to drive the viewer
// (model + paintMaterial + legacy). This is the work-list the skin test suite
// walks; only `index`-bearing items are finishes (the vanilla base carries no
// paint and nothing to test). Each item's own economy id is the stable render
// key, so a run is resumable and a re-run overwrites in place.
export function getRenderTestCatalog(): RenderTestItem[] {
  const KIND: Record<string, RenderTestItem["kind"]> = {
    weapon: "weapon",
    melee: "knife",
    glove: "glove",
  };
  const out: RenderTestItem[] = [];
  for (const i of items) {
    const kind = KIND[i.type as string];
    if (!kind || !i.variantIndex || !i.modelKey || !i.materialPath) continue;
    out.push({
      id: i.id,
      name: i.name,
      kind,
      model: i.modelKey as string,
      paintMaterial: i.materialPath,
      legacy: !!i.isLegacyModel,
      rarity: i.rarityColor as string,
      image: img(i.imagePath),
    });
  }
  return out;
}

// Default (stock) items for the special slots — cs2-lib marks them `isDefault`.
// Knives/gloves/agents differ per team; Zeus/C4/music kit are global.
export function getDefaults() {
  const lite = (i?: (typeof items)[number]) =>
    i ? { id: i.id, name: i.name, image: img(i.imagePath) } : null;
  const perTeam = (type: string) => {
    const frees = items.filter((i) => i.type === type && i.isDefault);
    const forTeam = (team: "CT" | "T") =>
      lite(frees.find((i) => teamsOf(i).includes(team)) ?? frees[0]);
    return { CT: forTeam("CT"), T: forTeam("T") };
  };
  // No stock SAS/Phoenix exist as economy items — use the classic-look agent
  // models as the DISPLAY default (display-only; nothing gets equipped).
  const agentDefault = (team: "CT" | "T") => {
    const family = team === "CT" ? "ctm_sas" : "tm_phoenix";
    const preferred = team === "CT" ? "ctm_sas_variantf" : "tm_phoenix_varianth";
    const pool = items.filter((i) => i.type === "agent" && (i.modelKey ?? "").includes(family));
    return lite(pool.find((i) => (i.modelKey ?? "").includes(preferred)) ?? pool[0]);
  };
  return {
    knife: perTeam("melee"),
    gloves: perTeam("glove"),
    agent: { CT: agentDefault("CT"), T: agentDefault("T") },
    zeus: lite(items.find((i) => i.type === "weapon" && i.modelKey === "taser" && !i.variantIndex)),
    c4: lite(items.find((i) => i.type === "weapon" && i.loadoutCategory === "c4" && !i.variantIndex)),
    musickit: lite(items.find((i) => i.type === "musickit" && i.isDefault)),
  };
}

// Exact-name lookup (market_hash_name minus StatTrak/Souvenir/star prefixes and
// the wear suffix) — used by the Steam inventory import.
let nameIndex: Map<string, number> | null = null;
export function getItemIdByName(name: string): number | null {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const i of items) {
      if (!nameIndex.has(i.name)) nameIndex.set(i.name, i.id);
    }
    // A handful of catalog names carry doubled spaces (old Katowice stickers,
    // "Ground Rebel  | Elite Crew"); index a collapsed alias in a second pass
    // so exact names always win over aliases.
    for (const i of items) {
      const collapsed = i.name.replace(/\s{2,}/g, " ");
      if (!nameIndex.has(collapsed)) nameIndex.set(collapsed, i.id);
    }
  }
  return nameIndex.get(name) ?? nameIndex.get(name.replace(/\s{2,}/g, " ")) ?? null;
}

// Steam's market_hash_name omits the type prefix cs2-lib bakes into non-weapon
// names: "Kilowatt Case" is "Container | Kilowatt Case", "2025 Service Medal"
// is "Collectible | 2025 Service Medal", and agents drop "Agent | " entirely.
// Weapons/stickers/music kits/patches already match verbatim, so try the raw
// name (and its ★ knife/glove form) first, then each known prefix. Sealed
// graffiti is its own rename: "Sealed Graffiti | X" vs "Graffiti | X", with an
// optional tint suffix the catalog may not carry.
const STEAM_NAME_PREFIXES = ["Agent", "Container", "Collectible", "Key", "Tool"];
export function getItemIdBySteamName(name: string): number | null {
  const direct = getItemIdByName(name) ?? getItemIdByName(`★ ${name}`);
  if (direct != null) return direct;
  for (const prefix of STEAM_NAME_PREFIXES) {
    const id = getItemIdByName(`${prefix} | ${name}`);
    if (id != null) return id;
  }
  if (name.startsWith("Sealed Graffiti | ")) {
    const unsealed = name.replace(/^Sealed /, "");
    return (
      getItemIdByName(unsealed) ??
      getItemIdByName(unsealed.replace(/ \([^)]+\)$/, ""))
    );
  }
  return null;
}

const baseWeapon = (model: string) =>
  items.find((i) => i.type === "weapon" && i.modelKey === model && !i.variantIndex);

// Per-weapon sticker offset bounds from the game schema (offsets are relative
// to each sticker slot's default position). Null for models without them.
export function getStickerBounds(model: string): { x: [number, number]; y: [number, number] } | null {
  const bounds = baseWeapon(model)?.getStickerOffsetBounds();
  if (
    bounds?.x.min == null ||
    bounds.x.max == null ||
    bounds.y.min == null ||
    bounds.y.max == null
  ) {
    return null;
  }
  return { x: [bounds.x.min, bounds.x.max], y: [bounds.y.min, bounds.y.max] };
}

// NO getCharmBounds here on purpose, even though cs2-lib 9 exposes
// `getKeychainPositionBounds()` and it is accurate (checked on all 34 weapons
// that carry it: 20 identical to ours, 14 looser by at most 0.561").
//
// It is the wrong SHAPE, not wrong numbers. It flattens the model's
// KeychainMarkup quads into one axis-aligned box, and a box has no surface to
// sit a charm on. We read the same block ourselves and keep the quads — see
// getCharmMarkup / charmBounds in stickerMarkup.ts.

export function getItem(id: number) {
  try {
    const i = CS2Economy.getById(id);
    if (!i) {
      return null;
    }
    return {
      id: i.id,
      name: i.name,
      altName: i.alternateName ?? null,
      image: img(i.imagePath),
      rarity: i.rarityColor as string,
      model: i.modelKey,
      category: i.loadoutCategory,
      type: i.type,
      teams: teamsOf(i),
      def: i.definitionIndex,
      index: i.variantIndex,
      tint: i.tintIndex,
      /**
       * The sticker a Sticker Slab charm DISPLAYS, as a sticker-kit index.
       *
       * 10.5k of the 10.6k charms are slabs, and a slab is one model wearing one
       * sticker — the charm's own index only picks the slab, so without this the
       * game has no idea which art goes on it. It rides out to the CS2 server as
       * the `keychain slot N sticker` attribute; see the v5 equipped feed.
       */
      stickerIndex: i.displayedSticker?.variantIndex,
      /**
       * What this item ACTUALLY has, per item rather than per type.
       *
       * The editor used to decide from the cs2-lib TYPE alone, which is right
       * for most things and wrong for every vanilla weapon: an unpainted Desert
       * Eagle is `type: "weapon"`, so it was offered a float, a pattern and
       * StatTrak — 68 items with none of the three. `wearMin`/`wearMax` matter
       * even more: 1,683 of 2,106 finishes are narrower than 0..1, so the
       * editor's full-range slider could build a Blaze at 0.9.
       */
      hasWear: i.hasWear(),
      hasSeed: i.hasSeed(),
      hasStatTrak: i.hasStatTrak(),
      hasNameTag: i.hasNameTag(),
      wearMin: i.hasWear() ? i.getMinimumWear() : undefined,
      wearMax: i.hasWear() ? i.getMaximumWear() : undefined,
      seedMin: i.hasSeed() ? i.getMinimumSeed() : undefined,
      seedMax: i.hasSeed() ? i.getMaximumSeed() : undefined,
      // Agents only, null for everything else: how many patches this model can
      // actually carry. The craft page opens an OWNED item through here, so
      // without it the form falls back to five slots — wrong for 62 of 63.
      patchSlots: i.type === "agent" ? patchSlotsSync(i.modelKey as string) : null,
      // Same two the graffiti catalog derives, under the same names, so the
      // OWNED list can stack colourways exactly the way the craft grid does.
      // `index` and `tint` are already right here, but they're the game's
      // vocabulary and the sheet speaks design/tintName.
      design: i.type === "graffiti" ? (i.variantIndex as number | undefined) : undefined,
      tintName: i.type === "graffiti" ? /\(([^()]+)\)\s*$/.exec(i.name)?.[1] : undefined,
      paintMaterial: i.materialPath ?? null,
      legacyPaint: !!i.isLegacyModel,
    };
  } catch {
    return null;
  }
}

/**
 * Normalise-then-validate the four scalar attributes a craft carries.
 *
 * These used to go into the database completely unchecked — `wear ?? null` and
 * straight into the INSERT — and from there into the v5 feed the CS2 server
 * applies and into inspect links. cs2-lib knows the real answer PER ITEM, which
 * a range check of our own never could:
 *
 *   - 1,683 of the 2,106 paintable items have a NARROWED float range. Desert
 *     Eagle | Blaze is [0, 0.08]; the editor's 0..1 slider let you build one at
 *     0.9, which is not an item that can exist.
 *   - seed runs 1..1000 for a finish and 1..100,000 for a charm.
 *   - a vanilla (unpainted) weapon has no float, no pattern and no StatTrak at
 *     all — 68 items our type-level gates offered all three to.
 *
 * TRUNCATE BEFORE VALIDATING, which is the order upstream uses too. cs2-lib
 * requires the value to sit exactly on the attribute's quantization step, and
 * an 0.01 slider in a browser emits 0.30000000000000004 — rejecting that would
 * be rejecting the user's own honest input. Truncation is what the game does to
 * it anyway.
 *
 * Returns the CLEANED values alongside the error, so callers store what was
 * validated rather than what arrived.
 */
export interface CraftAttrs {
  wear?: number | null;
  seed?: number | null;
  stattrak?: boolean | null;
  nametag?: string | null;
}
export function validateCraftAttrs(
  itemId: number,
  attrs: CraftAttrs,
): { error: string } | { clean: CraftAttrs } {
  let item;
  try {
    item = CS2Economy.getById(itemId);
  } catch {
    return { error: "Unknown item." };
  }
  const clean: CraftAttrs = {};

  if (attrs.wear != null) {
    if (!Number.isFinite(attrs.wear)) return { error: "That float isn't a number." };
    // A sticker's scratch rides the same column as a weapon's float but is a
    // different attribute with a coarser step — see hasScratch in itemVisuals.
    const scratch = item.isSticker();
    const wear = truncateToFactor(attrs.wear, scratch ? CS2_STICKER_WEAR_FACTOR : CS2_WEAR_FACTOR);
    if (scratch) {
      if (wear < 0 || wear > 1) return { error: "A sticker's scratch runs from 0 to 1." };
    } else if (!CS2Economy.safeValidateWear(wear, item)) {
      return {
        error: item.hasWear()
          ? `${item.name} only exists between ${item.getMinimumWear()} and ${item.getMaximumWear()}.`
          : `${item.name} has no float.`,
      };
    }
    clean.wear = wear;
  }

  if (attrs.seed != null) {
    if (!CS2Economy.safeValidateSeed(attrs.seed, item)) {
      return {
        error: item.hasSeed()
          ? `${item.name}'s pattern runs from ${item.getMinimumSeed()} to ${item.getMaximumSeed()}.`
          : `${item.name} has no pattern.`,
      };
    }
    clean.seed = attrs.seed;
  }

  if (attrs.stattrak) {
    if (!item.hasStatTrak()) return { error: `${item.name} can't be StatTrak™.` };
    clean.stattrak = true;
  } else if (attrs.stattrak != null) {
    clean.stattrak = false;
  }

  if (attrs.nametag != null) {
    // trimNameTag turns "   " into undefined, which is the difference between
    // "named with spaces" and "not named".
    const tag = CS2Economy.trimNameTag(attrs.nametag);
    if (tag !== undefined && !CS2Economy.safeValidateNameTag(tag, item)) {
      return {
        error: item.hasNameTag()
          ? "A name tag is up to 20 characters and can't start with a space."
          : `${item.name} can't take a name tag.`,
      };
    }
    clean.nametag = tag ?? null;
  }

  return { clean };
}

/** StatTrak counts come back from the game server, so they get the same
 *  treatment as anything else crossing the wire. */
export const clampStatTrakCount = (n: number) =>
  Math.min(CS2_MAX_STATTRAK, Math.max(0, Math.floor(n)));

/**
 * The grid and range the game stores each sticker attribute on.
 *
 * Re-exported rather than re-typed so there is one source for numbers that have
 * to match the game exactly: a rotation off the 0.5° step or an offset off the
 * 1e-4 grid does not round-trip through an inspect link, and the placement the
 * user saved comes back as a slightly different one.
 *
 * `main.ts` cannot import cs2-lib itself without becoming a third reader of the
 * economy (see the 9.0.0 bump, where the second reader was missed and silently
 * wiped the live textures), so it goes through here.
 */
export const STICKER_LIMITS = {
  offsetFactor: CS2_STICKER_OFFSET_FACTOR,
  wearFactor: CS2_STICKER_WEAR_FACTOR,
  rotationMin: CS2_MIN_STICKER_ROTATION,
  rotationMax: CS2_MAX_STICKER_ROTATION,
  rotationStep: CS2_STICKER_ROTATION_STEP,
  maxStickers: CS2_MAX_STICKERS,
  maxPatches: CS2_MAX_PATCHES,
  maxKeychains: CS2_MAX_KEYCHAINS,
} as const;

/**
 * Truncate to an attribute's stored PRECISION.
 *
 * Named for what cs2-lib's `truncateToFactor` actually does, which is not what
 * "factor" suggests: it counts the factor's decimal places and cuts the value's
 * string there. `truncateToFactor(37.24, 0.5)` is 37.2, NOT 37.0 — a 0.5 factor
 * means "one decimal place", not "a multiple of a half". Its companion
 * `isFactorPrecise`, which the validators use, likewise only asks whether the
 * value has no more decimals than the factor.
 *
 * That is the right rule to match: it is exactly what upstream stores and
 * transmits, so a placement round-trips through an inspect link identically.
 */
export const truncateToPrecision = (v: number, factor: number) => truncateToFactor(v, factor);

/**
 * A sticker's in-plane rotation, folded into the range the game stores.
 *
 * WRAPPED into ±180, not clamped. A rotation is an ANGLE: 286.5° and -73.5° are
 * the same placement and only the second is representable. This used to clamp,
 * which pinned everything past a half turn to a flat 180 — a sticker rotated to
 * 286.5 in the viewer arrived in game at 180, and typing the negative did not
 * help either, because -286.5 clamped to -180. cs2-lib does the same wrap in
 * `healBaseInventoryItem` (`if (v > 180) v -= 360`), so this now agrees with the
 * only other implementation of the rule.
 *
 * Truncated to ONE DECIMAL PLACE, which is what cs2-lib's 0.5 "step" actually
 * means (see truncateToPrecision above). That single decimal is the whole reason
 * the equipped feed is v5 rather than v4: upstream widened the plugin's rotation
 * field from int to float for it, so rounding to a whole degree here would throw
 * away the precision the version bump exists to carry.
 *
 * Here rather than in main.ts — which is where every other norm* lives — because
 * main.ts boots a server on import, and this is the one of them with arithmetic
 * worth testing directly. tools/inspect-roundtrip.ts imports it from here.
 */
export function normStickerRotation(r: number): number {
  const { rotationMin: lo, rotationMax: hi, rotationStep } = STICKER_LIMITS;
  const span = hi - lo;
  // Only what is actually outside gets wrapped: an in-range value must come back
  // untouched, or a legitimate 180 would fold to -180 on every single save.
  const wrapped = r >= lo && r <= hi ? r : ((((r - lo) % span) + span) % span) + lo;
  // Truncated AFTER the wrap, not before — the modulo lands on values like
  // -159.70000000000005, and cs2-lib's isFactorPrecise rejects that outright.
  return truncateToPrecision(wrapped, rotationStep);
}

// The loadout slot an item belongs to: a weapon model ("ak47"), or one of the
// special slots for melee/gloves/agents. Returns null for non-loadout items.
export function slotForItem(id: number): string | null {
  const i = getItem(id);
  if (!i) {
    return null;
  }
  if (i.type === "melee") {
    return "knife";
  }
  if (i.type === "glove") {
    return "gloves";
  }
  if (i.type === "agent") {
    return "agent";
  }
  if (i.type === "musickit") {
    return "musickit";
  }
  if (i.type === "graffiti") {
    return "graffiti";
  }
  if (i.type === "collectible") {
    return "collectible";
  }
  if (i.type === "weapon" && i.category === "c4") {
    return "c4";
  }
  if (i.type === "weapon" && i.model === "taser") {
    return "zeus";
  }
  if (i.type === "weapon" && i.model) {
    return i.model as string;
  }
  return null;
}

/**
 * The material a sticker's inventory image belongs to, or null.
 *
 * Stickers are looked up BY IMAGE because that is all a placement carries: the
 * viewer is handed `/images/<sticker>.webp` and nothing else. Built once, on
 * first ask — cs2-lib is already in memory, so this is a walk, not a load.
 */
let stickerMaterials: Map<string, string> | null = null;
export function stickerMaterialFor(image: string, patchMaterials?: Record<string, string>): string | null {
  if (!stickerMaterials) {
    stickerMaterials = new Map();
    for (const i of items) {
      if (i.type !== "sticker" && i.type !== "patch") continue;
      if (typeof i.imagePath !== "string" || typeof i.materialPath !== "string") continue;
      stickerMaterials.set(i.imagePath, i.materialPath);
    }
  }
  const direct = stickerMaterials.get(image);
  if (direct) return direct;
  // A PATCH NEVER HAS ONE. cs2-lib gives 0 of 112 patches a `paintMaterial`, so
  // the loop above cannot see them and every patch resolved to null — which is
  // why patches rendered from their inventory icon while stickers got the real
  // game art. The extraction already resolves them from the econ schema's
  // `patch_material` into models/patch-materials.json, keyed by the same kit
  // index cs2-lib exposes as `index`, so the answer only ever needed joining up.
  if (!patchMaterials) return null;
  for (const i of items) {
    if (i.type !== "patch" || i.imagePath !== image) continue;
    const hit = patchMaterials[String(i.variantIndex)];
    if (hit) {
      stickerMaterials.set(image, hit);
      return hit;
    }
  }
  return null;
}
