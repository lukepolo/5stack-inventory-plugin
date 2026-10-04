/**
 * Choosing a pattern by what it LOOKS like, for anything whose pattern is a
 * random draw.
 *
 * A pet's pattern (1..100000) and a gun's (1..1000) both seed Valve's
 * CUniformRandomStream, so neighbouring patterns are unrelated: no slider over
 * the number can mean "fatter" or "rotated further". What can is the other
 * direction — tabulate what every pattern draws, once, then search the table for
 * the pattern nearest a description. Dragging a trait bar (TraitBars.vue) is that
 * search: THIS trait at THIS value, the rest kept as close as they can stay. The
 * answer is always a real pattern the game reproduces exactly.
 */

export interface TraitTable {
  keys: string[];
  /** The first pattern in the table; row r is pattern `first + r`. */
  first: number;
  /** Row-major, `keys.length` values per pattern. */
  data: Float32Array;
  /** Each trait's own range over the table. Distances are measured in it, so a
   *  trait that only spans 0.2..0.6 is not swamped by one spanning 0..1. */
  span: Float32Array;
}

/** Tabulate `traits(seed)` for every pattern in [first, last]. */
export function buildTraitTable(first: number, last: number, traits: (seed: number) => Record<string, number>): TraitTable {
  const keys = Object.keys(traits(first));
  const rows = last - first + 1;
  const data = new Float32Array(rows * keys.length);
  for (let r = 0; r < rows; r++) {
    const t = traits(first + r);
    for (let k = 0; k < keys.length; k++) data[r * keys.length + k] = t[keys[k]];
  }
  const span = new Float32Array(keys.length);
  for (let k = 0; k < keys.length; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < rows; r++) {
      const v = data[r * keys.length + k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    span[k] = Math.max(1e-6, hi - lo);
  }
  return { keys, first, data, span };
}

/**
 * The pattern whose traits are nearest `target`. `focus` is the trait being
 * asked for: it weighs `focusWeight` times the others, so it lands where it was
 * put while the rest drift as little as they can. Traits absent from `target`
 * do not count.
 */
export function nearestSeed(table: TraitTable, target: Record<string, number>, focus: string, focusWeight = 40): number {
  const n = table.keys.length;
  const idx: number[] = [];
  const want: number[] = [];
  const weight: number[] = [];
  table.keys.forEach((k, i) => {
    if (target[k] === undefined) return;
    idx.push(i);
    want.push(target[k]);
    weight.push((k === focus ? focusWeight : 1) / (table.span[i] * table.span[i]));
  });
  const rows = table.data.length / n;
  let best = 0;
  let bestScore = Infinity;
  for (let r = 0; r < rows; r++) {
    const row = r * n;
    let score = 0;
    for (let j = 0; j < idx.length && score < bestScore; j++) {
      const d = table.data[row + idx[j]] - want[j];
      score += weight[j] * d * d;
    }
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return table.first + best;
}
