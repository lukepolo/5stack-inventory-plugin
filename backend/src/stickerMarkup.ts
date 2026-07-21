// Per-weapon STICKER SLOT positions, straight from the compiled model.
//
// CS2 does not project stickers as 3D decals — it composites them in the
// weapon's TEXCOORD_1 UV space through a mask (csgo_weapon.slang:
// `g_vSticker0Offset < Range2(-0.5,-0.5, 0.5,0.5) >`, and no projector matrix
// anywhere in the shader). Every slot has a hand-authored UV anchor, so the
// silhouette heuristic the viewer used before could never line up: it was
// inventing a position in the wrong space entirely.
//
// The anchors live in the vmdl_c's DATA block at `m_modelInfo.m_keyValueText`.
// ValveResourceFormat parses that but ModelExtract re-emits only a whitelist of
// keys, and StickerMarkup isn't on it — which is why our own extraction pass
// (which DID recover the keychain attachment) came up empty here.
//
// This used to be read from cs2-lib's CDN, which publishes the whole parsed
// model KV as JSON. That third party is gone, so extract-models.sh §3d now
// recovers it from the game archive itself — `-b DATA` prints the vmdl_c's DATA
// block verbatim, sidestepping the ModelExtract whitelist — and writes one
// aggregate `sticker-markup.json` keyed by cs2-lib model key.
//
// Aggregate rather than a file per weapon because it is 51 KB for all 35
// stickerable weapons, and because it matches the charm-anchors sidecar next to
// it. Knives are absent from it by design: they have no sticker slots at all.
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const MODELS_DIR = process.env.MODELS_DIR ?? "/cs2-models/models";

export interface StickerSlot {
  /** The game's own slot index — this is what the protobuf `slot` field wants. */
  index: number;
  /** "body_hd" | "body_legacy" — must match the body the finish renders on. */
  mesh: string;
  /** UV anchor, centred on 0 (add 0.5 to land in TEXCOORD_1 space). */
  offset: [number, number];
  /** UV magnification: the sticker spans 1/scale UV units. */
  scale: number;
  /** In-plane rotation. Radians (values top out ~0.19, meaningless as degrees). */
  rotation: number;
  /** Autograph / Team1 / Team2 / Map — souvenir tagging, NOT an ordering. */
  special?: string;
}

const FILE = path.join(MODELS_DIR, "sticker-markup.json");

type Markup = Record<string, StickerSlot[]>;
// Keyed on mtime rather than a clock: the file only changes when an extraction
// runs, and picking that up immediately is the difference between a re-run
// fixing placement and it appearing not to.
let cache: { mtimeMs: number; markup: Markup } | null = null;
let inflight: Promise<Markup> | null = null;

/** Drop anything malformed rather than trusting the file wholesale — a
 *  truncated write would otherwise surface as NaN offsets, which the viewer
 *  renders as a sticker parked at the origin instead of not at all. */
function validate(raw: unknown): StickerSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: StickerSlot[] = [];
  for (const item of raw) {
    const e = item as Record<string, unknown>;
    const off = Array.isArray(e.offset) ? (e.offset as unknown[]).map(Number) : null;
    const index = Number(e.index);
    const scale = Number(e.scale);
    if (!off || off.length !== 2 || off.some((v) => !Number.isFinite(v))) continue;
    if (!Number.isFinite(index) || !Number.isFinite(scale)) continue;
    out.push({
      index,
      mesh: String(e.mesh ?? "body_hd"),
      offset: [off[0], off[1]],
      scale,
      rotation: Number(e.rotation) || 0,
      special: e.special ? String(e.special) : undefined,
    });
  }
  return out;
}

async function load(): Promise<Markup> {
  const { mtimeMs } = await stat(FILE);
  if (cache && cache.mtimeMs === mtimeMs) return cache.markup;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const doc = JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>;
      const markup: Markup = {};
      for (const [model, slots] of Object.entries(doc)) markup[model] = validate(slots);
      cache = { mtimeMs, markup };
      return markup;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Slot markup for a weapon model key, or [] when unavailable. Never throws.
 *  Empty is the honest answer for a knife (no sticker slots exist) and for a
 *  mount that predates extract-models.sh v5 — callers fall back to bounds. */
export async function getStickerMarkup(model: string): Promise<StickerSlot[]> {
  try {
    return (await load())[model] ?? [];
  } catch {
    return [];
  }
}

/** How many sticker slots this weapon really has — 4, 5 or 6, never a fixed 5. */
export function slotCount(slots: StickerSlot[], mesh = "body_hd"): number {
  return slots.filter((s) => s.mesh === mesh).length;
}
