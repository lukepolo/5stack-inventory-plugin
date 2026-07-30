import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { patchSlotsSync } from "./agentPatchSlots.ts";
import { english } from "@ianlucas/cs2-lib/translations/english";

// Load the CS2 economy catalog once at startup (~27k items). This is the same
// data source the reference cs2-inventory-simulator uses — but only for item
// METADATA. Artwork is served from our own mount, never a third party.
CS2Economy.load({ items: CS2_ITEMS, language: english });

const items = CS2Economy.itemsAsArray;

// cs2-lib's `image` is a ROOT-RELATIVE path ("/images/<stem>_<hash8>.webp")
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
}

// The 36 base (vanilla) weapons. Excludes the C4. `id` is the base economy
// item id — equipping it is a free "default weapon" equip (no crafting).
export function getWeapons(): (CatalogWeapon & { id: number })[] {
  return items
    .filter(
      (i) => i.type === "weapon" && !i.index && i.category !== "c4",
    )
    .map((i) => ({
      id: i.id,
      model: i.model as string,
      name: i.name,
      category: i.category as string,
      teams: teamsOf(i),
      image: img(i.image),
      def: i.def,
    }));
}

// True for vanilla base weapons (no paint index) — the only items that can be
// equipped for free, without crafting.
export function isBaseWeapon(id: number): boolean {
  try {
    const i = CS2Economy.getById(id);
    return !!i && i.type === "weapon" && !i.index;
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
    (i) => i.type === "weapon" && i.model === model && !i.index,
  );
  const skins = items
    .filter((i) => i.type === "weapon" && i.model === model && i.index)
    .map((i) => ({
      id: i.id,
      name: i.name,
      altName: i.altName ?? null,
      rarity: i.rarity as string,
      image: img(i.image),
      model: (i.model as string) ?? null,
      paintMaterial: i.paintMaterial ?? null,
      legacyPaint: !!i.legacy,
      type: i.type,
      def: i.def,
    }));
  return {
    base: base
      ? { id: base.id, name: base.name, rarity: base.rarity as string, image: img(base.image), def: base.def }
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
      rarity: a.rarity as string,
      teams: teamsOf(a),
      image: img(a.image),
      // `model` and `type` are what let the craft editor mount 3D at all — the
      // resolver reads the type to pick a viewer kind, and without either the
      // agent sheet had no 2D/3D toggle and no 3D button. An agent's model is
      // ALREADY the full archive path ("agents/models/tm_leet/tm_leet_variantg"),
      // which is why nothing else has to translate it.
      model: (a.model as string) ?? null,
      type: a.type,
      def: a.def,
    }));
}

export function getKnives(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "melee")
    .map((k) => ({
      id: k.id,
      name: k.name,
      altName: k.altName ?? null,
      rarity: k.rarity as string,
      image: img(k.image),
      // Per FINISH, not per slot: "★ Karambit | Doppler" and "★ Bayonet |
      // Doppler" are different models, so the craft editor can only mount 3D
      // if the listing carries it.
      model: (k.model as string) ?? null,
      paintMaterial: k.paintMaterial ?? null,
      legacyPaint: !!k.legacy,
      type: k.type,
      def: k.def,
    }));
}

export function getMusicKits(): CatalogSkin[] {
  return items
    .filter((i) => i.type === "musickit")
    .map((m) => ({
      id: m.id,
      name: m.name,
      rarity: m.rarity as string,
      image: img(m.image),
      type: m.type,
      def: m.def,
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
const SLAB_PREFIX = "Sticker Slab | ";

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
  // A slab and its sticker share everything but the name prefix, and only the
  // STICKER carries the capsule, so slabs borrow their collection through the
  // name. Exact for all 10,565 of them — see the test in tools, and note that a
  // miss degrades to "no collection" rather than to a wrong one.
  const stickerCollections =
    kind === "charm"
      ? new Map(items.filter((i) => i.type === "sticker").map((i) => [i.name, (i.category as string) ?? ""]))
      : null;
  const out: AttachEntry[] = [];
  for (const i of items) {
    if (i.type !== type) continue;
    let group = "";
    let collection = (i.category as string) ?? "";
    if (kind === "sticker") {
      group = /\/images\/sig_/.test(i.image ?? "") ? "signature" : i.tournamentDesc ? "team" : "community";
    } else if (kind === "charm") {
      const slab = i.name.startsWith(SLAB_PREFIX);
      group = slab ? "slab" : "charm";
      collection = slab ? stickerCollections?.get(`Sticker | ${i.name.slice(SLAB_PREFIX.length)}`) ?? "" : "";
    }
    out.push({
      id: i.id,
      name: i.name,
      rarity: i.rarity as string,
      image: img(i.image),
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

// Rarity is a hex colour in cs2-lib with no inherent order, so ranking it needs a
// table. Mirrors RARITY_META in the frontend, which names the same tiers.
const RARITY_RANK: Record<string, number> = {
  "#b0c3d9": 1, // Consumer
  "#ded6cc": 1, // (the handful of very old stickers)
  "#5e98d9": 2, // Industrial
  "#4b69ff": 3, // Mil-Spec
  "#8847ff": 4, // Restricted
  "#d32ce6": 5, // Classified
  "#eb4b4b": 6, // Covert
  "#e4ae39": 7, // ★ Rare
  "#ffd700": 7,
  "#ffae39": 7,
};
const rarityRank = (hex: string) => RARITY_RANK[hex?.toLowerCase()] ?? 0;

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
  // `rawContents`, not `contents`: the latter asserts the item IS a container
  // (expectContainer in cs2-lib, which throws) and inflates every id into a full
  // item object. All we want is the ids.
  const ids = new Set(graffiti.map((i) => i.id));
  const boxes = new Map<number, string>();
  for (const c of items) {
    if (c.type !== "case") continue;
    const contents = c.rawContents;
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
    const tint = i.tint as number | undefined;
    const tintName = tint != null ? /\(([^()]+)\)\s*$/.exec(i.name)?.[1] : undefined;
    if (tint != null && tintName) tintNames.set(tint, tintName);
    return {
      id: i.id,
      name: i.name,
      rarity: i.rarity as string,
      image: img(i.image),
      def: i.def,
      // Same rule the sticker index uses: a tournamentDesc means it came out of
      // an event capsule, and for graffiti that only ever means a team crest.
      group: i.tournamentDesc ? "team" : "art",
      // "Graffiti | Astralis | Atlanta 2017" — the third segment IS the event,
      // and reads far better as a filter value than the tournamentDesc
      // sentence it's taken from ("This item commemorates the 2017 ELEAGUE…").
      collection: (i.tournamentDesc ? i.name.split(" | ")[2] : boxes.get(i.id)) || undefined,
      // 531 designs across 2,205 items: 93 of them exist in all 19 colourways
      // and 438 in exactly one. This is what the sheet stacks on.
      design: i.index as number | undefined,
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
      rarity: i.rarity as string,
      image: img(i.image),
      paintMaterial: i.paintMaterial ?? null,
      legacyPaint: !!i.legacy,
      model: (i.model as string) ?? null,
      type: i.type as string,
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
      rarity: g.rarity as string,
      image: img(g.image),
      // Same reason as the agents above. `paintMaterial` rides along because a
      // glove finish needs its own compositor — and because its presence is what
      // the resolver checks to decide whether a glove can render yet.
      model: (g.model as string) ?? null,
      type: g.type,
      paintMaterial: g.paintMaterial ?? null,
      def: g.def,
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
    if (!kind || !i.index || !i.model || !i.paintMaterial) continue;
    out.push({
      id: i.id,
      name: i.name,
      kind,
      model: i.model as string,
      paintMaterial: i.paintMaterial,
      legacy: !!i.legacy,
      rarity: i.rarity as string,
      image: img(i.image),
    });
  }
  return out;
}

// Default (stock) items for the special slots — cs2-lib marks them `free`.
// Knives/gloves/agents differ per team; Zeus/C4/music kit are global.
export function getDefaults() {
  const lite = (i?: (typeof items)[number]) =>
    i ? { id: i.id, name: i.name, image: img(i.image) } : null;
  const perTeam = (type: string) => {
    const frees = items.filter((i) => i.type === type && i.free);
    const forTeam = (team: "CT" | "T") =>
      lite(frees.find((i) => teamsOf(i).includes(team)) ?? frees[0]);
    return { CT: forTeam("CT"), T: forTeam("T") };
  };
  // No stock SAS/Phoenix exist as economy items — use the classic-look agent
  // models as the DISPLAY default (display-only; nothing gets equipped).
  const agentDefault = (team: "CT" | "T") => {
    const family = team === "CT" ? "ctm_sas" : "tm_phoenix";
    const preferred = team === "CT" ? "ctm_sas_variantf" : "tm_phoenix_varianth";
    const pool = items.filter((i) => i.type === "agent" && (i.model ?? "").includes(family));
    return lite(pool.find((i) => (i.model ?? "").includes(preferred)) ?? pool[0]);
  };
  return {
    knife: perTeam("melee"),
    gloves: perTeam("glove"),
    agent: { CT: agentDefault("CT"), T: agentDefault("T") },
    zeus: lite(items.find((i) => i.type === "weapon" && i.model === "taser" && !i.index)),
    c4: lite(items.find((i) => i.type === "weapon" && i.category === "c4" && !i.index)),
    musickit: lite(items.find((i) => i.type === "musickit" && i.free)),
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

// Per-weapon sticker offset bounds from the game schema (offsets are relative
// to each sticker slot's default position). Null for models without them.
export function getStickerBounds(model: string): { x: [number, number]; y: [number, number] } | null {
  const base = items.find((i) => i.type === "weapon" && i.model === model && !i.index) as
    | (Record<string, unknown> & { stickerOffsetXMin?: number; stickerOffsetXMax?: number; stickerOffsetYMin?: number; stickerOffsetYMax?: number })
    | undefined;
  if (
    base?.stickerOffsetXMin == null ||
    base.stickerOffsetXMax == null ||
    base.stickerOffsetYMin == null ||
    base.stickerOffsetYMax == null
  ) {
    return null;
  }
  return {
    x: [base.stickerOffsetXMin, base.stickerOffsetXMax],
    y: [base.stickerOffsetYMin, base.stickerOffsetYMax],
  };
}

export function getItem(id: number) {
  try {
    const i = CS2Economy.getById(id);
    if (!i) {
      return null;
    }
    return {
      id: i.id,
      name: i.name,
      altName: i.altName ?? null,
      image: img(i.image),
      rarity: i.rarity as string,
      model: i.model,
      category: i.category,
      type: i.type,
      teams: teamsOf(i),
      def: i.def,
      index: i.index,
      tint: i.tint,
      // Agents only, null for everything else: how many patches this model can
      // actually carry. The craft page opens an OWNED item through here, so
      // without it the form falls back to five slots — wrong for 62 of 63.
      patchSlots: i.type === "agent" ? patchSlotsSync(i.model as string) : null,
      // Same two the graffiti catalog derives, under the same names, so the
      // OWNED list can stack colourways exactly the way the craft grid does.
      // `index` and `tint` are already right here, but they're the game's
      // vocabulary and the sheet speaks design/tintName.
      design: i.type === "graffiti" ? (i.index as number | undefined) : undefined,
      tintName: i.type === "graffiti" ? /\(([^()]+)\)\s*$/.exec(i.name)?.[1] : undefined,
      paintMaterial: i.paintMaterial ?? null,
      legacyPaint: !!i.legacy,
    };
  } catch {
    return null;
  }
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
      if (typeof i.image !== "string" || typeof i.paintMaterial !== "string") continue;
      stickerMaterials.set(i.image, i.paintMaterial);
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
    if (i.type !== "patch" || i.image !== image) continue;
    const hit = patchMaterials[String(i.index)];
    if (hit) {
      stickerMaterials.set(image, hit);
      return hit;
    }
  }
  return null;
}
