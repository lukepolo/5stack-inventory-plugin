// Sticker Crafts' shared vocabulary — the mat's measurements, the shape of a
// sticker lying on it, the saved library — and where all of it is kept.
//
// Its own leaf module so StickerCrafts.vue and the weapon editor's sticker
// picker can both read the library without importing stickerBoard.ts, which
// pulls in three and the 3D viewer.
//
// STORAGE. Everything is kept against the ACCOUNT, on the backend
// (backend/src/stickerCrafts.ts), so the mat and the crafts are the same on
// every browser and device. localStorage is only the fallback for a backend
// image that predates that storage, and the source of a one-time upload: the
// first time an account's server copy is found empty, whatever this browser
// held from before is sent up, so crafts made then are not lost.

import {
  deleteItemCraftGroup,
  deleteStickerCraft,
  fetchCraftStore,
  fetchItemCraftGroup,
  fetchStickerCrafts,
  publishCraft,
  unpublishCraft,
  voteCraft,
  saveItemCraftGroup,
  saveStickerBoard,
  saveStickerCraft,
} from "./api";

/** The grid area of the mat, in cm. Positions are measured from its top-left corner. */
export const GRID_W = 45;
export const GRID_H = 30;
/** The ruled border around the grid, where the numbers are. */
export const MARGIN = 1.5;
/**
 * One sticker's footprint on the mat, in cm — the square its art fills.
 *
 * Fixed, because it is fixed on a weapon too: CS2 has no sticker size, and a
 * slot's footprint is the same square whatever goes in it. So one footprint on
 * the mat is one footprint on the gun, and a layout measured here in footprints
 * lands on any weapon the same way (see applyStickerCraft in App.vue).
 */
export const STICKER_CM = 5;
/**
 * The mat's size and its rulers: the grid's extent in grid units (the home
 * grid is 0..GRID_W by 0..GRID_H, and stickers keep their place in it however
 * the mat grows round them), and the real centimetres one unit stands for: 1
 * with no weapon chalked, else that weapon's sticker over STICKER_CM, so the
 * rulers measure the weapon in its own centimetres (CS2 sizes stickers per
 * gun: a Glock's are 4.4 cm across, an AWP's 7.7).
 */
export type MatLayout = { x0: number; y0: number; x1: number; y1: number; cmPerUnit: number };
export const HOME_LAYOUT: MatLayout = { x0: 0, y0: 0, x1: GRID_W, y1: GRID_H, cmPerUnit: 1 };
/** Room round a chalked weapon's outline, where stickers may still go, in units. */
export const OUTLINE_ROOM = 3;
/** A grouping is one weapon's worth: CS2 takes five stickers (CS2_MAX_STICKERS). */
export const MAX_PER_GROUPING = 5;
/** The whole mat. Room for a few groupings side by side, not a load test. */
export const MAX_ON_BOARD = 25;

export interface BoardSticker {
  uid: string;
  /** Catalog id. */
  id: number;
  name: string;
  image: string;
  /** Centre, in cm from the grid's top-left corner; y runs down the mat. */
  x: number;
  y: number;
  /** Degrees, clockwise as seen from above — the same sense, and the same
   *  number, as a sticker's rotation on a weapon. */
  rot: number;
  /** Scratch wear, 0..1, like a sticker slot's on a weapon. */
  wear: number;
  /** The grouping it belongs to, if any. */
  group: string | null;
  /** The saved craft it was laid down from or saved into — the one "Update"
   *  writes the layout back to. Absent on a sticker that is in no craft. */
  craft?: string | null;
}

/** A sticker of a saved craft: x/y are cm from the craft's own centre. */
export type CraftSticker = Omit<BoardSticker, "uid" | "group" | "craft">;

/** A grouping kept in the library, bottom-most sticker first (draw order). */
export interface SavedCraft {
  id: string;
  name: string;
  savedAt: number;
  stickers: CraftSticker[];
  /** A top-down render from the board, as a data URL. Absent until the board
   *  has drawn one (crafts saved before previews existed). */
  preview?: string;
  /** The PREVIEW_VERSION it was drawn at; an older one is redrawn. */
  previewV?: number;
  /** Where its author means it to go: saved with a weapon's outline chalked
   *  under it, the board's top-down picture of it on that outline. Travels into
   *  the Craft Store with the craft, behind the tile's info chip. */
  useCase?: CraftUseCase;
}
/** A craft's proposed use: the weapon, and the craft on that weapon's outline. */
export type CraftUseCase = { model: string; weapon: string; image: string };
/** Largest craft the server keeps, in characters of JSON (backend/src/stickerCrafts.ts MAX_BYTES.craft). */
export const CRAFT_MAX_CHARS = 160_000;

/**
 * Bump when the board's look or framing changes (light, materials, the fixed
 * scale), so stored previews are redrawn the next time the board is open
 * instead of showing the old look.
 */
export const PREVIEW_VERSION = 4;

/** A named set of stickers on the mat that move and turn as one. */
export type Grouping = { id: string; name: string };
/** The mat as stored: every sticker on it, in draw order, and its groupings. */
export type BoardDoc = { stickers: BoardSticker[]; groups: Grouping[] };

// The browser-only copies: the fallback, and what the one-time upload sends.
const BOARD_KEY = "cs2inv.stickerCrafts.board";
const LIBRARY_KEY = "cs2inv.stickerCrafts.library";
const ON_ITEMS_KEY = "cs2inv.stickerCrafts.onItems";
/** Set once this browser's copies have been sent to the account. */
const UPLOADED_KEY = "cs2inv.stickerCrafts.uploaded";

// localStorage throws in Safari private mode and when full. Every read and
// write is guarded: the browser copy is a fallback, never worth an error.
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — it just doesn't persist */
  }
}

const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * A sticker image as STORED: the bare `/images/…` path, without this
 * deployment's origin or the extraction version in its query. The API's asset
 * walk puts both back on the way out (resolveAssetPaths in api.ts), so a craft
 * saved before a re-extraction, or on another device, still resolves.
 */
export function storedImage(url: string): string {
  const at = url.indexOf("/images/");
  return at >= 0 ? url.slice(at).split("?")[0] : url;
}

/** Trust nothing read back: a hand-edited or older entry must not take a screen down. */
export function cleanSticker(raw: unknown, dflt = { x: GRID_W / 2, y: GRID_H / 2 }): CraftSticker | null {
  const s = raw as Partial<BoardSticker> | null;
  if (!s || typeof s !== "object" || typeof s.image !== "string" || !s.image) return null;
  return {
    id: num(s.id, 0),
    name: typeof s.name === "string" ? s.name : "Sticker",
    image: s.image,
    x: num(s.x, dflt.x),
    y: num(s.y, dflt.y),
    rot: num(s.rot, 0),
    wear: Math.min(1, Math.max(0, num(s.wear, 0))),
  };
}

function cleanCraft(raw: unknown): SavedCraft | null {
  const e = raw as Partial<SavedCraft> | null;
  if (!e || typeof e.id !== "string" || !Array.isArray(e.stickers)) return null;
  const stickers = e.stickers.map((s) => cleanSticker(s, { x: 0, y: 0 })).filter((s): s is CraftSticker => !!s);
  if (!stickers.length) return null;
  return {
    id: e.id,
    name: typeof e.name === "string" ? e.name : "Grouping",
    savedAt: num(e.savedAt, 0),
    stickers,
    ...(typeof e.preview === "string" && e.preview.startsWith("data:image/") ? { preview: e.preview, previewV: num(e.previewV, 1) } : {}),
    ...(cleanUseCase(e.useCase) ? { useCase: cleanUseCase(e.useCase)! } : {}),
  };
}
function cleanUseCase(raw: unknown): CraftUseCase | null {
  const u = raw as Partial<CraftUseCase> | null;
  if (!u || typeof u !== "object" || typeof u.image !== "string" || !u.image.startsWith("data:image/")) return null;
  if (typeof u.model !== "string" || !u.model) return null;
  return { model: u.model, weapon: typeof u.weapon === "string" && u.weapon ? u.weapon : u.model, image: u.image };
}

function cleanBoard(raw: unknown): BoardDoc {
  const b = raw as { stickers?: unknown[]; groups?: unknown[] } | null;
  const groups = (Array.isArray(b?.groups) ? b.groups : [])
    .filter((g): g is Grouping => !!g && typeof (g as Grouping).id === "string")
    .map((g) => ({ id: g.id, name: typeof g.name === "string" ? g.name : "Group" }));
  const stickers = (Array.isArray(b?.stickers) ? b.stickers : []).flatMap((raw): BoardSticker[] => {
    const s = cleanSticker(raw);
    if (!s) return [];
    const r = raw as Partial<BoardSticker>;
    const group = typeof r.group === "string" && groups.some((g) => g.id === r.group) ? r.group : null;
    const craft = typeof r.craft === "string" ? r.craft : null;
    return [{ ...s, uid: typeof r.uid === "string" ? r.uid : newId(), group, craft }];
  });
  return { stickers, groups };
}

const storedSticker = <T extends { image: string }>(s: T): T => ({ ...s, image: storedImage(s.image) });
const storedBoard = (b: BoardDoc) => ({ stickers: b.stickers.map(storedSticker), groups: b.groups });
const storedCraft = (c: SavedCraft) => ({ ...c, stickers: c.stickers.map(storedSticker) });

/** Where this session's Sticker Crafts live. "server" is the account; "local"
 *  is this browser only, for a backend without the storage. */
export type CraftsHome = "server" | "local";

/**
 * The mat and the library, from the account — or from this browser when the
 * backend can't keep them. An account found empty takes this browser's copies
 * once (see the header). Throws when the backend could not be reached at all.
 */
export async function loadStickerCrafts(): Promise<{
  board: BoardDoc;
  library: SavedCraft[];
  home: CraftsHome;
  /** Ids of the crafts this account has in the Craft Store. */
  published: Set<string>;
}> {
  const doc = await fetchStickerCrafts();
  const localBoard = cleanBoard(readJson(BOARD_KEY));
  const localLibrary = (() => {
    const raw = readJson(LIBRARY_KEY);
    return (Array.isArray(raw) ? raw : []).map(cleanCraft).filter((c): c is SavedCraft => !!c);
  })();
  if (doc === null) return { board: localBoard, library: localLibrary, home: "local", published: new Set() };
  const published = new Set(Array.isArray(doc.published) ? doc.published.filter((x): x is string => typeof x === "string") : []);
  const board = cleanBoard(doc.board);
  const library = (Array.isArray(doc.crafts) ? doc.crafts : [])
    .map(cleanCraft)
    .filter((c): c is SavedCraft => !!c)
    .sort((a, b) => b.savedAt - a.savedAt);
  const empty = !board.stickers.length && !library.length;
  const hasLocal = localBoard.stickers.length > 0 || localLibrary.length > 0;
  if (empty && hasLocal && readJson(UPLOADED_KEY) !== 1) {
    await uploadLocal(localBoard, localLibrary);
    return { board: localBoard, library: localLibrary, home: "server", published };
  }
  return { board, library, home: "server", published };
}

/** The one-time upload of what this browser held before the account did. */
async function uploadLocal(board: BoardDoc, library: SavedCraft[]) {
  await saveStickerBoard(storedBoard(board));
  for (const c of library) await saveStickerCraft(storedCraft(c));
  const groups = readJson(ON_ITEMS_KEY) as Record<string, object> | null;
  for (const [itemId, g] of Object.entries(groups ?? {})) {
    // The item may be gone since; a group for it is nothing to keep.
    await saveItemCraftGroup(itemId, g).catch(() => {});
  }
  writeJson(UPLOADED_KEY, 1);
}

/** Just the library — the weapon picker's Sticker Crafts tab. */
export async function loadLibrary(): Promise<SavedCraft[]> {
  return (await loadStickerCrafts()).library;
}

export async function saveBoard(home: CraftsHome, board: BoardDoc) {
  if (home === "local") return writeJson(BOARD_KEY, board);
  await saveStickerBoard(storedBoard(board));
}
export async function saveCraft(home: CraftsHome, craft: SavedCraft, all: SavedCraft[]) {
  if (home === "local") return writeJson(LIBRARY_KEY, all);
  await saveStickerCraft(storedCraft(craft));
}
export async function deleteCraft(home: CraftsHome, id: string, all: SavedCraft[]) {
  if (home === "local") return writeJson(LIBRARY_KEY, all);
  await deleteStickerCraft(id);
}

/** A craft placed on an owned item, as the editor keeps it between visits. */
export type ItemGroup = { name: string; slots: number[]; ids: number[]; linked: boolean };

export async function loadItemGroup(itemId: number | string): Promise<ItemGroup | null> {
  let raw: unknown;
  try {
    raw = await fetchItemCraftGroup(itemId);
  } catch {
    return null;
  }
  if (raw === undefined) raw = (readJson(ON_ITEMS_KEY) as Record<string, unknown> | null)?.[String(itemId)] ?? null;
  const g = raw as Partial<ItemGroup> | null;
  if (!g || !Array.isArray(g.slots) || !Array.isArray(g.ids)) return null;
  return { name: String(g.name ?? "Sticker craft"), slots: g.slots.map(Number), ids: g.ids.map(Number), linked: g.linked !== false };
}
export async function saveItemGroup(itemId: number | string, group: ItemGroup | null) {
  try {
    if (group) await saveItemCraftGroup(itemId, group);
    else await deleteItemCraftGroup(itemId);
  } catch {
    // An older backend (no storage) or a moment offline: keep it in this
    // browser so the group still comes back here.
    const all = (readJson(ON_ITEMS_KEY) as Record<string, ItemGroup> | null) ?? {};
    if (group) all[String(itemId)] = group;
    else delete all[String(itemId)];
    writeJson(ON_ITEMS_KEY, all);
  }
}

// ---- the Craft Store -------------------------------------------------------

export type CraftAuthor = { steamId: string; name: string; avatar: string | null };
/** A published craft, as the store lists it: the craft, who made it, and its votes. */
export interface StoreCraft extends SavedCraft {
  stickerCount: number;
  author: CraftAuthor;
  ups: number;
  downs: number;
  score: number;
  /** The viewer's own vote. */
  myVote: -1 | 0 | 1;
  /** The viewer is its author (no voting on your own). */
  mine: boolean;
}

function cleanStoreCraft(raw: unknown): StoreCraft | null {
  const c = cleanCraft(raw);
  if (!c) return null;
  const r = raw as Partial<StoreCraft> & { author?: Partial<CraftAuthor> };
  const vote = Number(r.myVote);
  return {
    ...c,
    stickerCount: c.stickers.length,
    author: {
      steamId: String(r.author?.steamId ?? ""),
      name: typeof r.author?.name === "string" && r.author.name ? r.author.name : "Player",
      avatar: typeof r.author?.avatar === "string" && /^https?:\/\//.test(r.author.avatar) ? r.author.avatar : null,
    },
    ups: num(r.ups, 0),
    downs: num(r.downs, 0),
    score: num(r.score, 0),
    myVote: vote === 1 ? 1 : vote === -1 ? -1 : 0,
    mine: r.mine === true,
  };
}

/** Published crafts. Null when this backend has no store. */
export async function loadCraftStore(params: {
  sort: "top" | "new";
  max?: number;
  count?: number;
  q?: string;
}): Promise<StoreCraft[] | null> {
  const got = await fetchCraftStore({ ...params, limit: 100 });
  if (!got) return null;
  return (Array.isArray(got.items) ? got.items : []).map(cleanStoreCraft).filter((c): c is StoreCraft => !!c);
}
/** Put one of your saved crafts in the store, or take it out. */
export async function setPublished(id: string, on: boolean) {
  if (on) await publishCraft(id);
  else await unpublishCraft(id);
}
export const vote = (id: string, v: -1 | 0 | 1) => voteCraft(id, v);
