// Sticker Crafts' shared vocabulary — the mat's measurements, the shape of a
// sticker lying on it, the saved library — and where all of it is kept.
//
// Its own leaf module so StickerCrafts.vue and the weapon editor's sticker
// picker can both read the library without importing stickerBoard.ts, which
// pulls in three and the 3D viewer.
//
// STORAGE. Everything is kept against the ACCOUNT, on the backend (the Sticker
// Crafts block in backend/src/main.ts, its rules in backend/src/stickerCrafts.ts),
// so the mat and the crafts are the same on every browser and device. A sticker
// goes up as its id and placement; its name and art come back looked up from
// the id, so a craft in the store shows everyone the catalog's sticker.

import {
  MAX_STICKERS,
  craftPictureUrl,
  deleteStickerCraft,
  fetchCraftStore,
  fetchStickerCrafts,
  publishCraft,
  saveStickerBoard,
  saveStickerCraft,
  unpublishCraft,
  uploadCraftPicture,
  voteCraft,
  type CraftStickerWire,
  type SavedCraftWire,
  type StoreCraftWire,
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
/** The whole mat: what one gun takes (MAX_STICKERS — five, on every weapon;
 *  see stickerSlotCount in App). The mat is a gun's sticker slots laid flat,
 *  so it never holds a layout no gun could carry. */
export const MAX_ON_BOARD = MAX_STICKERS;

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
  /** Its top-down render from the board, as a picture URL. Absent until the
   *  board has drawn one. */
  preview?: string;
  /** The PREVIEW_VERSION it was drawn at; an older one is redrawn. */
  previewV?: number;
  /** Where its author means it to go: saved with a weapon's outline chalked
   *  under it, the board's top-down picture of it on that outline. Travels into
   *  the Craft Store with the craft, behind the tile's info chip. */
  useCase?: CraftUseCase;
}
/** A craft's proposed use: the weapon, and the craft on that weapon's outline
 *  (absent until the board has drawn it). */
export type CraftUseCase = { model: string; weapon: string; image?: string };

/**
 * Bump when the board's look or framing changes (light, materials, the fixed
 * scale), so stored previews are redrawn the next time the board is open
 * instead of showing the old look.
 */
export const PREVIEW_VERSION = 1;

/** A named set of stickers on the mat that move and turn as one. */
export type Grouping = { id: string; name: string };
/** The mat as stored: every sticker on it, in draw order, and its groupings. */
export type BoardDoc = { stickers: BoardSticker[]; groups: Grouping[] };

const sticker = (s: CraftStickerWire): CraftSticker => ({
  id: s.id,
  name: s.name,
  image: s.image ?? "",
  x: s.x,
  y: s.y,
  rot: s.rot,
  wear: s.wear,
});
const placement = (s: CraftSticker) => ({ id: s.id, x: s.x, y: s.y, rot: s.rot, wear: s.wear });

function craftFrom(w: SavedCraftWire): SavedCraft {
  return {
    id: w.id,
    name: w.name,
    savedAt: w.savedAt,
    stickers: w.stickers.map(sticker),
    ...(w.previewKey ? { preview: craftPictureUrl(w.previewKey), previewV: w.previewV } : {}),
    ...(w.useCase
      ? { useCase: { model: w.useCase.model, weapon: w.useCase.weapon, ...(w.useCase.imageKey ? { image: craftPictureUrl(w.useCase.imageKey) } : {}) } }
      : {}),
  };
}

/** Your own published craft's standing in the store. */
export type CraftScore = { ups: number; downs: number; score: number };

/** The mat and the library, from the account. Throws when the backend could not be reached. */
export async function loadStickerCrafts(): Promise<{
  board: BoardDoc;
  library: SavedCraft[];
  /** Ids of the crafts this account has in the Craft Store. */
  published: Set<string>;
  /** Their votes. */
  scores: Map<string, CraftScore>;
}> {
  const doc = await fetchStickerCrafts();
  return {
    board: {
      stickers: doc.board.stickers.map((s) => ({ ...sticker(s), uid: s.uid, group: s.group, craft: s.craft })),
      groups: doc.board.groups,
    },
    library: doc.crafts.map(craftFrom).sort((a, b) => b.savedAt - a.savedAt),
    published: new Set(doc.crafts.filter((c) => c.published).map((c) => c.id)),
    scores: new Map(
      doc.crafts.filter((c) => c.published).map((c) => [c.id, { ups: c.ups ?? 0, downs: c.downs ?? 0, score: c.score ?? 0 }]),
    ),
  };
}

export const saveBoard = (board: BoardDoc) =>
  saveStickerBoard({
    stickers: board.stickers.map((s) => ({ ...placement(s), uid: s.uid, group: s.group, craft: s.craft ?? null })),
    groups: board.groups,
  });
export const saveCraft = (craft: SavedCraft) =>
  saveStickerCraft(craft.id, { name: craft.name, stickers: craft.stickers.map(placement), useModel: craft.useCase?.model ?? null });
export const deleteCraft = (id: string) => deleteStickerCraft(id);
/** Store a craft's freshly drawn pictures; resolves to where each is now served. */
export async function saveCraftPictures(
  id: string,
  pictures: { top?: Blob; use?: Blob },
): Promise<{ top?: string; use?: string }> {
  const [top, use] = await Promise.all([
    pictures.top ? uploadCraftPicture(id, "top", pictures.top, PREVIEW_VERSION) : undefined,
    pictures.use ? uploadCraftPicture(id, "use", pictures.use, PREVIEW_VERSION) : undefined,
  ]);
  return { ...(top ? { top: craftPictureUrl(top) } : {}), ...(use ? { use: craftPictureUrl(use) } : {}) };
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

const storeCraftFrom = (w: StoreCraftWire): StoreCraft => ({
  ...craftFrom(w),
  stickerCount: w.stickers.length,
  author: w.author,
  ups: w.ups,
  downs: w.downs,
  score: w.score,
  myVote: w.myVote,
  mine: w.mine,
});

/** A page of published crafts. */
export async function loadCraftStore(params: {
  sort: "top" | "new";
  count?: number;
  q?: string;
}): Promise<StoreCraft[]> {
  const got = await fetchCraftStore({ ...params, limit: 60 });
  return got.items.map(storeCraftFrom);
}
/** Put one of your saved crafts in the store, or take it out. */
export async function setPublished(id: string, on: boolean) {
  if (on) await publishCraft(id);
  else await unpublishCraft(id);
}
export const vote = (id: string, v: -1 | 0 | 1) => voteCraft(id, v);
