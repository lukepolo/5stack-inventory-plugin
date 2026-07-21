import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/translations/english";

// Load the CS2 economy catalog once at startup (~27k items). This is the same
// data source the reference cs2-inventory-simulator uses; images are hosted on
// cdn.cstrike.app so we don't store any assets ourselves.
CS2Economy.load({ items: CS2_ITEMS, language: english });

const CDN = "https://cdn.cstrike.app";
const items = CS2Economy.itemsAsArray;

function img(path: string | undefined): string | null {
  return path ? `${CDN}${path}` : null;
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
      paintMaterial: i.paintMaterial ?? null,
      legacyPaint: !!i.legacy,
    }));
  return {
    base: base
      ? { id: base.id, name: base.name, rarity: base.rarity as string, image: img(base.image) }
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
      teams: teamsOf(a),
      image: img(a.image),
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
    }));
}

// Stickers/charms are huge catalogs (thousands) — search server-side.
function searchByType(type: string, q: string, limit: number): CatalogSkin[] {
  const needle = q.trim().toLowerCase();
  const out: CatalogSkin[] = [];
  for (const i of items) {
    if (i.type !== type) continue;
    if (needle && !i.name.toLowerCase().includes(needle)) continue;
    out.push({ id: i.id, name: i.name, rarity: i.rarity as string, image: img(i.image) });
    if (out.length >= limit) break;
  }
  return out;
}
export const getStickers = (q: string, limit = 80) => searchByType("sticker", q, limit);
export const getCharms = (q: string, limit = 80) => searchByType("keychain", q, limit);
export const getPatches = (q: string, limit = 80) => searchByType("patch", q, limit);
export const getGraffiti = (q: string, limit = 120) => searchByType("graffiti", q, limit);

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

// cs2-lib ships a versioned model path per weapon ("/models/weapon_rif_ak47_
// 025c0af3.glb"); the same stem with .json is the parsed model KV on its CDN,
// which is where the sticker slot markup lives. See stickerMarkup.ts.
export function getWeaponPlayerModel(model: string): string | null {
  const base = items.find((i) => i.type === "weapon" && i.model === model && !i.index) as
    | (Record<string, unknown> & { playerModel?: string })
    | undefined;
  return base?.playerModel ?? null;
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
