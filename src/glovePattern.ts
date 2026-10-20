/**
 * A Gen2 glove's pattern, as the artwork placement it actually moves — the
 * glove's half of what gunPattern.ts does for guns.
 *
 * The pattern seeds the same CUniformRandomStream, but a glove's draws come off
 * its own RANDOM_ROLL list (gloveRolls in gloveCompositeModern.ts), in an order
 * that varies by finish. The traits here are the pattern artwork's rotation and
 * offset; the layer, damage and grime offsets roll too, but they shift repeating
 * fabric rather than placing anything, so they get no bar.
 *
 * A finish whose envelope is a single value has no trait there. Flames, the
 * pinstripes, Racer and the quilted pair have none at all: their pattern moves
 * only the fabric underneath.
 */
import { gloveRolled, type GloveModernDef } from "./gloveCompositeModern";
import type { GunTrait } from "./gunPattern";
import { buildTraitTable, type TraitTable } from "./traitSearch";

const ROT = "g_fPatternTexCoordRotation";
const OFFSET = "g_vPatternTexCoordOffset";

/** The placement draws this finish varies. Same shape as a gun's, so the same
 *  bars and formatGunTrait read it. */
export function glovePlacementTraits(def: GloveModernDef): GunTrait[] {
  const out: GunTrait[] = [];
  const moves = (r?: [number, number]) => !!r && r[0] !== r[1];
  const offset = def.rolls.find((r) => r.name === OFFSET)?.bounds;
  const rot = def.rolls.find((r) => r.name === ROT)?.bounds[0];
  if (moves(offset?.[0])) out.push({ key: "x", label: "Shift X", range: offset![0] });
  if (moves(offset?.[1])) out.push({ key: "y", label: "Shift Y", range: offset![1] });
  if (moves(rot)) out.push({ key: "rot", label: "Rotation", range: rot! });
  return out;
}

/** Where `seed` puts the artwork, each trait as 0..1 of its envelope. */
export function glovePlacementAt(def: GloveModernDef, seed: number): Record<string, number> {
  const rolled = gloveRolled(def, seed);
  const raw: Record<GunTrait["key"], number> = {
    x: rolled.get(OFFSET)?.[0] ?? 0,
    y: rolled.get(OFFSET)?.[1] ?? 0,
    rot: rolled.get(ROT)?.[0] ?? 0,
  };
  const out: Record<string, number> = {};
  for (const t of glovePlacementTraits(def)) out[t.key] = (raw[t.key] - t.range[0]) / (t.range[1] - t.range[0]);
  return out;
}

const tables = new WeakMap<GloveModernDef, Map<string, TraitTable>>();
/** Every pattern's placement, for dragging a bar to the nearest real pattern. */
export function glovePlacementTable(def: GloveModernDef, min: number, max: number): TraitTable {
  let byRange = tables.get(def);
  if (!byRange) tables.set(def, (byRange = new Map()));
  const id = `${min}-${max}`;
  let table = byRange.get(id);
  if (!table) {
    table = buildTraitTable(min, max, (s) => glovePlacementAt(def, s));
    byRange.set(id, table);
  }
  return table;
}
