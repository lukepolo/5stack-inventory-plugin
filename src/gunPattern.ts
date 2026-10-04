/**
 * A gun's pattern, as the three things it actually moves.
 *
 * The pattern index (1..1000) seeds Valve's CUniformRandomStream, and the first
 * three draws place the finish's artwork: an offset across, an offset along,
 * and a rotation, each inside an envelope the finish declares (seededVisuals in
 * paintComposite.ts, call order from CCSWeaponVisualsDataProcessor). Those are
 * the gun's "traits" — the same idea as a pet's body (petPattern.ts): dragging
 * one asks for a placement, and traitSearch finds the real pattern nearest it.
 *
 * A finish whose envelope is a single value (solids, anodized, most custom
 * paints) has no trait there: no pattern moves it, so it gets no bar.
 */
import { seededVisuals, type PaintDef } from "./paintComposite";
import { buildTraitTable, type TraitTable } from "./traitSearch";

export interface GunTrait {
  key: "x" | "y" | "rot";
  label: string;
  /** The finish's envelope for this draw — what 0..1 on the bar spans. */
  range: [number, number];
}

/** The placement draws this finish varies, in draw order. */
export function gunPlacementTraits(def: PaintDef): GunTrait[] {
  const out: GunTrait[] = [];
  const moves = (r: [number, number]) => r[0] !== r[1];
  if (moves(def.offsetX)) out.push({ key: "x", label: "Shift X", range: def.offsetX });
  if (moves(def.offsetY)) out.push({ key: "y", label: "Shift Y", range: def.offsetY });
  if (moves(def.rotation)) out.push({ key: "rot", label: "Rotation", range: def.rotation });
  return out;
}

/** Where `seed` puts the artwork, each trait as 0..1 of its envelope. */
export function gunPlacement(def: PaintDef, seed: number): Record<string, number> {
  const v = seededVisuals(def, seed);
  const raw: Record<GunTrait["key"], number> = { x: v.patternOffsetX, y: v.patternOffsetY, rot: v.patternRot };
  const out: Record<string, number> = {};
  for (const t of gunPlacementTraits(def)) out[t.key] = (raw[t.key] - t.range[0]) / (t.range[1] - t.range[0]);
  return out;
}

/** A trait's value as a person reads it: rotation in degrees, a shift as the
 *  fraction of the pattern tile it moves. */
export function formatGunTrait(t: GunTrait, v01: number): string {
  const v = t.range[0] + v01 * (t.range[1] - t.range[0]);
  return t.key === "rot" ? `${Math.round(v)}°` : `${Math.round(v * 100)}%`;
}

const tables = new WeakMap<PaintDef, Map<string, TraitTable>>();
/** Every pattern's placement, 1,000 rows — a millisecond or two. */
export function gunPlacementTable(def: PaintDef, min: number, max: number): TraitTable {
  let byRange = tables.get(def);
  if (!byRange) tables.set(def, (byRange = new Map()));
  const id = `${min}-${max}`;
  let table = byRange.get(id);
  if (!table) {
    table = buildTraitTable(min, max, (s) => gunPlacement(def, s));
    byRange.set(id, table);
  }
  return table;
}
