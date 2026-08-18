// How many patches an agent can actually wear.
//
// The craft form offers five slots because that is what the inventory schema
// carries, but an agent only has as many POSITIONS as its model declares, and
// that is 3 to 5 depending on the model. Without this the form let you equip
// five and silently dropped the overflow at render time.
//
// The count is read from the GLB the viewer already loads: every agent export
// carries its source vmat under `material.extras.vmat`, so `g_flPatch<n>Scale`
// is right there. A slot whose scale is 0 is a dead declaration the artist never
// placed — it carries a zero offset too, so honouring it would stack patches at
// the UV origin. Some agents declare slots on more than one material (the
// gendarmerie on upperbody AND trousers, the diver on three), so this counts
// across all of them.
//
// NOTHING IS RE-EXTRACTED FOR THIS. Only the glTF JSON chunk is read — the first
// few hundred KB of the file — never the buffers.
import { CS2_MAX_PATCHES } from "@ianlucas/cs2-lib";
import { open, stat } from "node:fs/promises";
import path from "node:path";

const MODELS_DIR = process.env.MODELS_DIR ?? "/cs2-models/models";

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

interface VmatExtras {
  IntParams?: Record<string, number | string>;
  FloatParams?: Record<string, number | string>;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** The glTF JSON chunk of a .glb, without reading the binary chunk after it. */
async function readGlbJson(file: string): Promise<Record<string, unknown> | null> {
  const fh = await open(file, "r");
  try {
    const head = Buffer.alloc(20);
    const { bytesRead } = await fh.read(head, 0, 20, 0);
    if (bytesRead < 20 || head.readUInt32LE(0) !== GLB_MAGIC) return null;
    const len = head.readUInt32LE(12);
    if (head.readUInt32LE(16) !== CHUNK_JSON || len <= 0 || len > 64 * 1024 * 1024) return null;
    const body = Buffer.alloc(len);
    await fh.read(body, 0, len, 20);
    return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

function countSlots(json: Record<string, unknown>): number {
  const materials = (json.materials as { extras?: { vmat?: VmatExtras } }[] | undefined) ?? [];
  let n = 0;
  for (const m of materials) {
    const vmat = m?.extras?.vmat;
    if (!vmat || !num(vmat.IntParams?.F_PATCHES)) continue;
    // CS2_MAX_PATCHES, not 3. This used to stop at 3, which is the LOW end of
    // the 3-to-5 range described above rather than the high end — so a material
    // declaring four or five positions had the last one or two counted as
    // nothing. Totals only ever passed 3 by summing across several materials,
    // which made the cap look like a real model limit instead of an off-by-two.
    for (let i = 0; i < CS2_MAX_PATCHES; i++) {
      if (Math.abs(num(vmat.FloatParams?.[`g_flPatch${i}Scale`])) > 0) n++;
    }
  }
  return n;
}

const cache = new Map<string, { mtimeMs: number; slots: number }>();

/**
 * Read every agent's count up front.
 *
 * `getItem` is synchronous and used on every inventory row, and it is the call
 * the CRAFT page resolves an owned item through — so the count has to be
 * available without awaiting. There are only 63 agents and only the glTF JSON
 * chunk is read, so warming the lot at boot is cheap and makes the sync getter
 * below always answer.
 */
export async function warmPatchSlots(models: string[]): Promise<void> {
  await Promise.all(models.map((m) => patchSlotsFor(m)));
}

/**
 * The warmed count, or null if this model has not been read yet.
 *
 * Null must read as "do not restrict" — a cold cache capping the form to zero
 * would make every agent unpatchable for the first request after a restart.
 */
export function patchSlotsSync(model: string | null | undefined): number | null {
  return model ? cache.get(model)?.slots ?? null : null;
}

/**
 * Patch positions this agent model offers, or null when the model is not on the
 * mount. Null means "unknown", which callers must treat as "do not restrict" —
 * capping to 0 because a file is missing would make every agent unpatchable.
 */
export async function patchSlotsFor(model: string): Promise<number | null> {
  // The model key is an archive path from cs2-lib
  // ("agents/models/tm_leet/tm_leet_variantg"). Refuse anything that could climb
  // out of the models directory rather than trusting the catalogue.
  if (!/^[\w./-]+$/.test(model) || model.includes("..")) return null;
  const file = path.join(MODELS_DIR, `${model}.glb`);
  try {
    const { mtimeMs } = await stat(file);
    const hit = cache.get(model);
    if (hit && hit.mtimeMs === mtimeMs) return hit.slots;
    const json = await readGlbJson(file);
    if (!json) return null;
    const slots = countSlots(json);
    cache.set(model, { mtimeMs, slots });
    return slots;
  } catch {
    return null;
  }
}
