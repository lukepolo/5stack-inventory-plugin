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
// Rather than add a third decompile pass, read cs2-lib's CDN: it publishes the
// whole parsed model KV as JSON beside the GLB it ships, keyed off the
// `playerModel` field already in the catalog. No extraction run, no new infra.
import { getWeaponPlayerModel } from "./catalog.ts";

const CDN = "https://cdn.cstrike.app";
// Hand-authored data that only moves when Valve ships a model change; a day is
// plenty, and a miss degrades to bounds-only rather than breaking placement.
const TTL_MS = 24 * 60 * 60 * 1000;

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

type Entry = { at: number; slots: StickerSlot[] };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<StickerSlot[]>>();

function parse(kv: unknown): StickerSlot[] {
  const markup = (kv as { StickerMarkup?: unknown[] } | undefined)?.StickerMarkup;
  if (!Array.isArray(markup)) return [];
  const out: StickerSlot[] = [];
  for (const raw of markup) {
    const e = raw as Record<string, unknown>;
    // Offsets arrive as strings in the KV dump.
    const off = (e.Offset as unknown[] | undefined)?.map((v) => Number(v));
    if (!off || off.length !== 2 || off.some((v) => !Number.isFinite(v))) continue;
    const index = Number(e.Index);
    const scale = Number(e.Scale);
    if (!Number.isFinite(index) || !Number.isFinite(scale)) continue;
    out.push({
      index,
      mesh: String(e.Mesh ?? "body_hd"),
      offset: [off[0], off[1]],
      scale,
      rotation: Number(e.Rotation) || 0,
      special: e.SpecialIdentifier ? String(e.SpecialIdentifier) : undefined,
    });
  }
  return out;
}

/** Slot markup for a weapon model key, or [] when unavailable. Never throws. */
export async function getStickerMarkup(model: string): Promise<StickerSlot[]> {
  const hit = cache.get(model);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slots;
  const running = inflight.get(model);
  if (running) return running;

  const job = (async () => {
    try {
      const playerModel = getWeaponPlayerModel(model);
      if (!playerModel) return [];
      // "/models/weapon_rif_ak47_025c0af3.glb" -> same stem, .json
      const url = `${CDN}${playerModel.replace(/\.glb$/, ".json")}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const doc = (await res.json()) as { m_modelInfo?: { m_keyValueText?: unknown } };
      const slots = parse(doc?.m_modelInfo?.m_keyValueText);
      cache.set(model, { at: Date.now(), slots });
      return slots;
    } catch {
      return []; // offline / CDN hiccup — callers fall back to bounds
    } finally {
      inflight.delete(model);
    }
  })();
  inflight.set(model, job);
  return job;
}

/** How many sticker slots this weapon really has — 4, 5 or 6, never a fixed 5. */
export function slotCount(slots: StickerSlot[], mesh = "body_hd"): number {
  return slots.filter((s) => s.mesh === mesh).length;
}
