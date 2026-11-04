// Sticker Crafts' rules for what may be stored: the mat (a player's board), the
// saved crafts, a craft placed on a gun, and the weapon outlines the mat
// chalks. Pure — no database, no network, no Fastify — so main.ts (which owns
// the routes) and the standalone mock apply exactly the same rules.
//
// THE SERVER OWNS THE SHAPE. Every document is normalised on the way in AND on
// the way out (a row written before a rule tightened still reads clean), and a
// sticker is kept as its catalog id and placement only. Its name and art are
// looked up from the id when it is sent back, so nothing an author typed or
// linked is ever shown to anyone else — the Craft Store puts one player's craft
// in front of everyone on the panel.

import { createHash } from "node:crypto";

/** A craft is one weapon's worth (CS2 takes five stickers); the mat holds a
 *  few crafts side by side. */
export const CRAFT_LIMITS = {
  stickersPerCraft: 5,
  // The mat is one gun's slots (the frontend's MAX_STICKERS); an older,
  // bigger board is trimmed on its next save.
  stickersOnBoard: 5,
  groupsOnBoard: 5,
  craftsPerPlayer: 200,
  nameMax: 40,
  /** Furthest a sticker may sit from the mat's corner (board) or the craft's
   *  centre (craft), in centimetres. Generous: the mat grows round a long gun. */
  extentCm: 400,
} as const;

/** Client ids — a craft's, a sticker's on the mat, a grouping's. The client
 *  mints them (UUIDs) so the mat can link a sticker to its craft before any
 *  request has answered; a write checks the owner. */
export const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface CraftSticker {
  id: number;
  /** Centimetres: from the craft's centre (a craft), from the mat's corner (the board). */
  x: number;
  y: number;
  /** Degrees, -180..180 in the game's half-degree steps. */
  rot: number;
  /** Scratch wear, 0..1. */
  wear: number;
}
export interface BoardSticker extends CraftSticker {
  uid: string;
  group: string | null;
  craft: string | null;
}
export interface Board {
  stickers: BoardSticker[];
  groups: { id: string; name: string }[];
}
/** A placed craft on a gun: the slots that move and turn as one. */
export interface StickerGroup {
  name: string;
  slots: number[];
  linked: boolean;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const docId = (v: unknown): string | null => (typeof v === "string" && DOC_ID_RE.test(v) ? v : null);

/** -180..180 in half degrees — CS2_STICKER_ROTATION_STEP, and the range the game stores. */
export function normDeg(d: number): number {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return round(r * 2, 0) / 2;
}

/** Trimmed, no control characters, at most nameMax; `fallback` when nothing is left. */
export function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, CRAFT_LIMITS.nameMax) : "";
  return s || fallback;
}

/** One sticker's placement, or null when its id is not a sticker at all. */
function normSticker(raw: unknown, isSticker: (id: number) => boolean): CraftSticker | null {
  const s = raw as Partial<CraftSticker> | null;
  if (!s || typeof s !== "object" || !finite(s.id) || !Number.isInteger(s.id) || !isSticker(s.id)) return null;
  const e = CRAFT_LIMITS.extentCm;
  return {
    id: s.id,
    x: round(clamp(finite(s.x) ? s.x : 0, -e, e), 2),
    y: round(clamp(finite(s.y) ? s.y : 0, -e, e), 2),
    rot: normDeg(finite(s.rot) ? s.rot : 0),
    wear: round(clamp(finite(s.wear) ? s.wear : 0, 0, 1), 4),
  };
}

/**
 * A craft's stickers: 1 to stickersPerCraft of them, every id a sticker.
 * Null for anything else — a craft that cannot be put on a gun is refused, not
 * trimmed into a different one.
 */
export function normCraftStickers(raw: unknown, isSticker: (id: number) => boolean): CraftSticker[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > CRAFT_LIMITS.stickersPerCraft) return null;
  const out = raw.map((s) => normSticker(s, isSticker));
  return out.every((s): s is CraftSticker => s !== null) ? out : null;
}

/**
 * The mat. Unlike a craft this is a scratchpad, so it is cleaned rather than
 * refused: unknown stickers drop out, the rest are capped, and a grouping with
 * fewer than two members left is no grouping.
 */
export function normBoard(raw: unknown, isSticker: (id: number) => boolean): Board {
  const b = raw as { stickers?: unknown; groups?: unknown } | null;
  const rawGroups = Array.isArray(b?.groups) ? b.groups.slice(0, CRAFT_LIMITS.groupsOnBoard) : [];
  const groups = rawGroups.flatMap((g) => {
    const id = docId((g as { id?: unknown })?.id);
    return id ? [{ id, name: cleanName((g as { name?: unknown }).name, "Group") }] : [];
  });
  const groupIds = new Set(groups.map((g) => g.id));
  const seen = new Set<string>();
  const stickers = (Array.isArray(b?.stickers) ? b.stickers : []).flatMap((r): BoardSticker[] => {
    const s = normSticker(r, isSticker);
    const raw = r as Partial<BoardSticker>;
    const uid = docId(raw?.uid);
    if (!s || !uid || seen.has(uid)) return [];
    seen.add(uid);
    const group = docId(raw.group);
    return [{ ...s, uid, group: group && groupIds.has(group) ? group : null, craft: docId(raw.craft) }];
  }).slice(0, CRAFT_LIMITS.stickersOnBoard);
  const counts = new Map<string, number>();
  for (const s of stickers) if (s.group) counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
  for (const s of stickers) if (s.group && (counts.get(s.group) ?? 0) < 2) s.group = null;
  return { stickers, groups: groups.filter((g) => (counts.get(g.id) ?? 0) >= 2) };
}

/**
 * A placed craft's group, checked against the stickers it is saved with: two or
 * more distinct slots, every one of them holding a sticker. Anything else is no
 * group (null) — a group naming an empty slot would move nothing, and one left
 * over from before an edit would move the wrong stickers.
 */
export function normStickerGroup(raw: unknown, filled: (slot: number) => boolean, slotCount: number): StickerGroup | null {
  const g = raw as Partial<StickerGroup> | null;
  if (!g || typeof g !== "object" || !Array.isArray(g.slots)) return null;
  const slots = [...new Set(g.slots)].filter((s): s is number => Number.isInteger(s) && s >= 0 && s < slotCount);
  if (slots.length < 2 || slots.length !== g.slots.length || !slots.every(filled)) return null;
  return { name: cleanName(g.name, "Sticker craft"), slots: slots.sort((a, b) => a - b), linked: g.linked !== false };
}

/** A traced weapon outline, as the mat draws it (src/outlineTrace.ts WeaponOutline). */
export interface WeaponOutline {
  model: string;
  stickerCm: number;
  w: number;
  h: number;
  paths: number[][];
  anchors: { index: number; x: number; y: number }[];
  /** The StatTrak module's outline, loops in the same units ([] for none).
   *  Absent on outlines traced before it was. */
  stattrak?: number[][];
}
const OUTLINE_LIMITS = { loops: 64, coords: 8000, anchors: 8, extent: 1000, counterLoops: 8 } as const;

/**
 * A browser's trace of a gun (the mat traces it from the gun's own model the
 * first time it is picked, then stores it for everyone). Strictly a box, closed
 * loops of finite coordinates inside it, and the slot anchors — or null.
 */
export function normOutline(raw: unknown, model: string): WeaponOutline | null {
  const o = raw as Partial<WeaponOutline> | null;
  const L = OUTLINE_LIMITS;
  const inBox = (v: unknown): v is number => finite(v) && Math.abs(v) <= L.extent;
  if (!o || typeof o !== "object" || o.model !== model) return null;
  if (!inBox(o.stickerCm) || o.stickerCm <= 0 || !inBox(o.w) || o.w <= 0 || !inBox(o.h) || o.h <= 0) return null;
  if (!Array.isArray(o.paths) || !o.paths.length || o.paths.length > L.loops) return null;
  let coords = 0;
  for (const p of o.paths) {
    if (!Array.isArray(p) || p.length < 6 || p.length % 2 || !p.every(inBox)) return null;
    coords += p.length;
  }
  if (coords > L.coords) return null;
  const anchors = Array.isArray(o.anchors) ? o.anchors : [];
  if (anchors.length > L.anchors) return null;
  const cleanAnchors = anchors.map((a) => ({ index: a?.index, x: a?.x, y: a?.y }));
  if (!cleanAnchors.every((a) => Number.isInteger(a.index) && (a.index as number) >= 0 && inBox(a.x) && inBox(a.y))) return null;
  // The StatTrak counter's loops: optional (older traces have none), a few
  // small loops at most, counted against the same coordinate budget.
  let stattrak: number[][] | undefined;
  if (o.stattrak !== undefined) {
    if (!Array.isArray(o.stattrak) || o.stattrak.length > L.counterLoops) return null;
    for (const p of o.stattrak) {
      if (!Array.isArray(p) || p.length < 6 || p.length % 2 || !p.every(inBox)) return null;
      coords += p.length;
    }
    if (coords > L.coords) return null;
    stattrak = o.stattrak.map((p) => p.map((v) => round(v, 2)));
  }
  return {
    model,
    stickerCm: round(o.stickerCm, 3),
    w: round(o.w, 3),
    h: round(o.h, 3),
    paths: o.paths.map((p) => p.map((v) => round(v, 2))),
    anchors: cleanAnchors as WeaponOutline["anchors"],
    ...(stattrak ? { stattrak } : {}),
  };
}

/**
 * What an administrator's takedown remembers about a craft, per author: its
 * id, its name and its set of stickers (main.ts writes them to
 * inventory.sticker_craft_takedowns, apart from the craft row). Publishing and
 * saving a published craft check them, so deleting a taken-down craft and
 * saving it again — under a new id or the same one — never puts it back in the
 * store. A craft with a new name AND new stickers is a different craft, which
 * an administrator can take down in its own right.
 */
export function takedownMarks(id: string, name: string, stickers: readonly { id?: unknown }[]): string[] {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
  const ids = stickers.map((s) => Number(s?.id)).filter(Number.isInteger).sort((a, b) => a - b);
  return [`id:${id}`, `name:${hash(name.trim().toLowerCase().replace(/\s+/g, " "))}`, `set:${hash(JSON.stringify(ids))}`];
}

/** A LIKE pattern matching `q` anywhere, with LIKE's own wildcards taken literally. */
export const likeAnywhere = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
