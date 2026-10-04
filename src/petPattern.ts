/**
 * A PET'S PATTERN — how CS2 turns the "pet seed" attribute into a look.
 *
 * Recovered from libclient.so (build 2000924) and verified bit-exact against the
 * shipped machine code (emulated libtier0, 504 seeds x 14 draws, 0 mismatches).
 * Nothing about it is hard-coded in the game binary beyond the algorithm — every
 * range, table and mapping comes from `chicken_metadata` in each pet's vmdl,
 * which the pet-models extraction step writes into pet-styles.json as `seed`.
 *
 * TWO INDEPENDENT STREAMS, both `CUniformRandomStream(seed)`:
 *
 *  1. COLOUR (BuildChickenMatParams). Ten `RandomFloat(0, 1)` draws; each entry
 *     of `matparams` names a render attribute (`$ChickenHue`) and INDEXES one of
 *     the ten. The material's dynamic expressions read those attributes — that
 *     is what moves a breed's hue, saturation, face detail and iridescence. A
 *     seed of 0 sets nothing.
 *  2. BODY (CChickenPoseGenerator). A fresh stream on the same seed draws, in
 *     the preset's order, one `RandomFloat(min, max)` per characteristic —
 *     fatness, tail, legs, wings, neck, head, wattle — with `comb` drawing two
 *     more jitters for front and back. Each weight blends a one-frame DELTA pose
 *     (`chicken_hips_min` / `_max`) in or out around 0.5. The preset is `adult`
 *     for a hen, `adolescent` for a pullet; the chick has no body variation.
 *
 * Because both streams start from the same seed, body and colour correlate —
 * on a catalana, `tail` and `$ChickenHue` are literally the same draw.
 */

import { buildTraitTable, type TraitTable } from "./traitSearch";

/** `chicken_metadata`, as extract-models.sh writes it into pet-styles.json. */
export interface PetSeedTable {
  /** Render attribute -> index into the ten colour draws. */
  matparams: Record<string, number>;
  /** Characteristic -> [sequence_min, sequence_max] clip names. */
  characteristics?: Record<string, [string | null, string | null]>;
  /** Stage -> ORDERED [name, min, max] draws. */
  presets?: Record<string, [string, number, number][]>;
}

// ---- CUniformRandomStream ------------------------------------------------------
//
// Numerical Recipes ran1, as Source has always shipped it, with CS2's one
// difference: the float maths are FLOAT32 (cvtsi2ss / mulss), so every step
// goes through Math.fround or the seeds drift in the last bit.
const IA = 16807;
const IM = 2147483647;
const IQ = 127773;
const IR = 2836;
const NTAB = 32;
const NDIV = 1 + Math.floor((IM - 1) / NTAB);
const RNMX = Math.fround(0.99999988079071044921875); // 0x3f7ffffe
const TWO_NEG_31 = Math.fround(2 ** -31);

class UniformRandomStream {
  private idum: number;
  private iy = 0;
  private iv = new Array<number>(NTAB).fill(0);
  constructor(seed: number) {
    this.idum = seed < 0 ? seed : -seed; // -|seed|
  }
  private step() {
    const k = Math.trunc(this.idum / IQ);
    this.idum = IA * (this.idum - k * IQ) - IR * k;
    if (this.idum < 0) this.idum += IM;
  }
  private nextInt(): number {
    if (this.idum <= 0 || !this.iy) {
      this.idum = -this.idum < 1 ? 1 : -this.idum;
      for (let j = NTAB + 7; j >= 0; j--) {
        this.step();
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0];
    }
    this.step();
    const j = Math.trunc(this.iy / NDIV);
    this.iy = this.iv[j];
    this.iv[j] = this.idum;
    return this.iy;
  }
  float(lo: number, hi: number): number {
    const fl = Math.min(RNMX, Math.fround(Math.fround(this.nextInt()) * TWO_NEG_31));
    const flo = Math.fround(lo);
    return Math.fround(flo + Math.fround(Math.fround(Math.fround(hi) - flo) * fl));
  }
}

// ---- render attribute tokens -------------------------------------------------
/** MurmurHash2 of the lower-cased name, seed 0x31415926 — how a dynamic
 *  expression names `$ChickenHue` (0xECB0E515). */
export function attributeToken(name: string): number {
  const data = new TextEncoder().encode(name.toLowerCase());
  const m = 0x5bd1e995;
  let n = data.length;
  let h = (0x31415926 ^ n) >>> 0;
  let i = 0;
  while (n >= 4) {
    let k = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
    n -= 4;
  }
  if (n === 3) h = (h ^ (data[i + 2] << 16)) >>> 0;
  if (n >= 2) h = (h ^ (data[i + 1] << 8)) >>> 0;
  if (n >= 1) {
    h = (h ^ data[i]) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Seed -> render attribute values, by token. Empty for seed 0 (the game sets
 *  nothing then, and the material's baked constants stand). */
export function petSeedAttributes(seed: number, table: PetSeedTable): Map<number, number> {
  const out = new Map<number, number>();
  if (!seed) return out;
  const s = new UniformRandomStream(seed);
  const r = Array.from({ length: 10 }, () => s.float(0, 1));
  for (const [name, idx] of Object.entries(table.matparams)) {
    out.set(attributeToken(name), r[Math.max(0, Math.min(9, idx))]);
  }
  return out;
}

/** Seed -> body weights for one stage's preset. 0.5 is "no change". */
export function petPoseWeights(seed: number, preset: [string, number, number][]): Record<string, number> {
  const s = new UniformRandomStream(seed);
  const out: Record<string, number> = {};
  for (const [name, lo, hi] of preset) {
    const v = s.float(lo, hi);
    if (name === "comb") {
      out.comb_front = Math.min(1, Math.max(0, Math.fround(s.float(0.8, 1.2) * v)));
      out.comb_back = Math.min(1, Math.max(0, Math.fround(s.float(0.8, 1.2) * v)));
    } else {
      out[name] = v;
    }
  }
  return out;
}

// ---- dynamic expressions -----------------------------------------------------
//
// Source 2's material expression VM, run directly rather than decoded to a tree:
// the pet materials use real control flow — 0x04 BRANCH (cond; true/false
// absolute offsets) and 0x02 JUMP — which compile ternaries and short-circuit
// logic (silkie_red_beetle: `Hue < 0.5 ? lerp(-8,28,Hue) : lerp(60,190,Hue)`).
// Values are vectors (float2 builds the detail UV offset); scalars broadcast.
type V = number[];
const map1 = (a: V, f: (x: number) => number) => a.map(f);
const map2 = (a: V, b: V, f: (x: number, y: number) => number) =>
  Array.from({ length: Math.max(a.length, b.length) }, (_, i) => f(a[i] ?? a[0], b[i] ?? b[0]));
const map3 = (a: V, b: V, c: V, f: (x: number, y: number, z: number) => number) =>
  Array.from({ length: Math.max(a.length, b.length, c.length) }, (_, i) => f(a[i] ?? a[0], b[i] ?? b[0], c[i] ?? c[0]));
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)));
  return t * t * (3 - 2 * t);
};
/** By VfxEval's function id. Unlisted ids throw, and the param is skipped. */
const FUNCS: Record<number, (a: V[]) => V> = {
  0: ([x]) => map1(x, Math.sin),
  1: ([x]) => map1(x, Math.cos),
  2: ([x]) => map1(x, Math.tan),
  3: ([x]) => map1(x, (v) => v - Math.floor(v)),
  4: ([x]) => map1(x, Math.floor),
  5: ([x]) => map1(x, Math.ceil),
  6: ([x]) => map1(x, (v) => Math.min(1, Math.max(0, v))),
  7: ([x, lo, hi]) => map3(x, lo, hi, (v, l, h) => Math.min(h, Math.max(l, v))),
  8: ([a, b, t]) => map3(a, b, t, (x, y, s) => x + (y - x) * s),
  12: ([x]) => map1(x, Math.log),
  13: ([x]) => map1(x, Math.log2),
  14: ([x]) => map1(x, Math.log10),
  15: ([x]) => map1(x, Math.exp),
  16: ([x]) => map1(x, (v) => 2 ** v),
  17: ([x]) => map1(x, Math.sqrt),
  18: ([x]) => map1(x, (v) => 1 / Math.sqrt(v)),
  19: ([x]) => map1(x, Math.sign),
  20: ([x]) => map1(x, Math.abs),
  21: ([a, b]) => map2(a, b, (x, y) => x ** y),
  22: ([edge, x]) => map2(edge, x, (e, v) => (v >= e ? 1 : 0)),
  23: ([e0, e1, x]) => map3(e0, e1, x, smooth),
  24: (a) => a.map((v) => v[0]),
  25: (a) => a.map((v) => v[0]),
  26: (a) => a.map((v) => v[0]),
  28: ([a, b]) => map2(a, b, Math.min),
  29: ([a, b]) => map2(a, b, Math.max),
  35: ([x]) => map1(x, (v) => v * v),
};
const ARGC: Record<number, number> = { 7: 3, 8: 3, 21: 2, 22: 2, 23: 3, 24: 4, 25: 3, 26: 2, 28: 2, 29: 2 };
const BINOPS: Record<number, (x: number, y: number) => number> = {
  0x0a: (x, y) => (x || y ? 1 : 0),
  0x0b: (x, y) => (x && y ? 1 : 0),
  0x0d: (x, y) => (x === y ? 1 : 0),
  0x0e: (x, y) => (x !== y ? 1 : 0),
  0x0f: (x, y) => (x > y ? 1 : 0),
  0x10: (x, y) => (x >= y ? 1 : 0),
  0x11: (x, y) => (x < y ? 1 : 0),
  0x12: (x, y) => (x <= y ? 1 : 0),
  0x13: (x, y) => x + y,
  0x14: (x, y) => x - y,
  0x15: (x, y) => x * y,
  0x16: (x, y) => x / y,
  0x17: (x, y) => x % y,
};

/** Run one expression (`m_dynamicParams` bytecode, as hex). Null if it uses an
 *  opcode or function this does not implement — the caller keeps the constant. */
export function runVfx(hex: string, attrs: Map<number, number>): V | null {
  const code = Uint8Array.from(hex.split(/\s+/).filter(Boolean), (b) => parseInt(b, 16));
  const view = new DataView(code.buffer);
  const stack: V[] = [];
  const local: V[] = [];
  let i = 0;
  try {
    for (let guard = 0; i < code.length && guard < 10000; guard++) {
      const op = code[i++];
      if (op === 0x00) break;
      if (op === 0x07) {
        stack.push([view.getFloat32(i, true)]);
        i += 4;
      } else if (op === 0x08) {
        local[code[i++]] = stack.pop()!;
      } else if (op === 0x09) {
        stack.push(local[code[i++]]);
      } else if (op === 0x02) {
        i = view.getUint16(i, true);
      } else if (op === 0x04) {
        const t = view.getUint16(i, true);
        const f = view.getUint16(i + 2, true);
        i = stack.pop()![0] ? t : f;
      } else if (op === 0x0c) {
        stack.push(map1(stack.pop()!, (v) => (v ? 0 : 1)));
      } else if (op === 0x18) {
        stack.push(map1(stack.pop()!, (v) => -v));
      } else if (op === 0x19) {
        stack.push([attrs.get(view.getUint32(i, true)) ?? 0]);
        i += 4;
      } else if (op === 0x06) {
        const id = code[i];
        i += 2;
        const fn = FUNCS[id];
        if (!fn) return null;
        const n = ARGC[id] ?? 1;
        stack.push(fn(stack.splice(stack.length - n, n)));
      } else if (BINOPS[op]) {
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(map2(a, b, BINOPS[op]));
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  return stack.length ? stack[stack.length - 1] : null;
}

// ---- body proportions --------------------------------------------------------

/** One bone's combined proportion delta, applied on top of its local pose. */
export interface PetBoneDelta {
  t: import("three").Vector3;
  q: import("three").Quaternion;
  s: import("three").Vector3;
}

/** cs2-lib's stage number -> the preset the generator draws from. The chick
 *  (1) has its generator detached in game; the egg (0) has no poses at all. */
const STAGE_PRESET: Record<number, string> = { 2: "adolescent", 3: "adult" };

/**
 * Seed -> per-bone deltas, from the GLB's own one-frame clips.
 *
 * The min/max clips are DELTA poses by authoring convention (unaffected bones
 * are identity: `chicken_hips_max` leaves spine1 at T=0 against a bind of 2.07)
 * with children counter-scaled for hierarchical application — so a weight of w
 * picks the max clip above 0.5 (t = 2(w - 0.5)), the min clip below
 * (t = 1 - 2w), and blends it in from identity by t. Deltas concatenate per bone
 * in characteristic order, as the generator does: D = d1 * d2 * ...
 */
export function petPoseDeltas(
  THREE: typeof import("three"),
  clips: import("three").AnimationClip[],
  table: PetSeedTable | null | undefined,
  seed: number,
  stage: number,
): Map<string, PetBoneDelta> {
  const out = new Map<string, PetBoneDelta>();
  const preset = table?.presets?.[STAGE_PRESET[stage] ?? ""];
  if (!seed || !preset || !table?.characteristics) return out;
  const weights = petPoseWeights(seed, preset);
  const qId = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const [name, [minClip, maxClip]] of Object.entries(table.characteristics)) {
    const w = weights[name];
    if (w === undefined) continue;
    const clipName = w > 0.5 ? maxClip : minClip;
    const t = w > 0.5 ? 2 * (w - 0.5) : 1 - 2 * w;
    const clip = clipName ? clips.find((c) => c.name === clipName) : undefined;
    if (!clip || t < 1e-4) continue;
    const per = new Map<string, { t?: number[]; q?: number[]; s?: number[] }>();
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const bone = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);
      const at0 = Array.from(track.values.slice(0, prop === "quaternion" ? 4 : 3));
      const e = per.get(bone) ?? {};
      if (prop === "position") e.t = at0;
      else if (prop === "quaternion") e.q = at0;
      else if (prop === "scale") e.s = at0;
      per.set(bone, e);
    }
    for (const [bone, e] of per) {
      const dt = v.fromArray(e.t ?? [0, 0, 0]).multiplyScalar(t);
      q.fromArray(e.q ?? [0, 0, 0, 1]);
      const dq = qId.clone().slerp(q, t);
      const ds = new THREE.Vector3(1, 1, 1).lerp(new THREE.Vector3().fromArray(e.s ?? [1, 1, 1]), t);
      // Near-identity deltas are skipped, as the game does (0.01 / 0.02).
      if (dt.lengthSq() < 1e-4 && Math.abs(dq.w) > 0.99995 && Math.abs(ds.x - 1) + Math.abs(ds.y - 1) + Math.abs(ds.z - 1) < 0.02) continue;
      const D = out.get(bone);
      if (!D) {
        out.set(bone, { t: dt.clone(), q: dq, s: ds });
        continue;
      }
      // D ∘ d: translate by D's frame, then rotate and scale on.
      D.t.add(dt.clone().multiply(D.s).applyQuaternion(D.q));
      D.q.multiply(dq);
      D.s.multiply(ds);
    }
  }
  return out;
}

/**
 * The deltas as a REVERSIBLE layer over whatever the mixer last wrote.
 *
 * Applying them in place and trusting the mixer to reset each frame does not
 * work, because the mixer does not reset each frame: three's PropertyMixer only
 * writes a property when the value it computes DIFFERS from the one it wrote
 * last time. Every pet clip keys the 50 `*_ENV` helper bones with CONSTANT
 * tracks, so the mixer writes them once and never again — and a delta added on
 * top every frame ran their positions past 1000 in seconds (scale, which no
 * clip keys at all, compounded the same way). So: `undo()` before the mixer
 * runs, `apply()` after it. The mixer then always finds the bone where it left
 * it, and the delta is always laid over a clean frame.
 */
export class PetPoseLayer {
  private saved = new Map<import("three").Object3D, [import("three").Vector3, import("three").Quaternion, import("three").Vector3]>();

  /** Put every bone back to its value before the last apply(). */
  undo() {
    for (const [b, [p, q, s]] of this.saved) {
      b.position.copy(p);
      b.quaternion.copy(q);
      b.scale.copy(s);
    }
    this.saved.clear();
  }

  /** local ∘ D on each bone, remembering what was there. */
  apply(bones: Map<string, import("three").Object3D>, deltas: Map<string, PetBoneDelta>, tmp: import("three").Vector3) {
    for (const [name, d] of deltas) {
      const b = bones.get(name);
      if (!b || this.saved.has(b)) continue;
      this.saved.set(b, [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
      b.position.add(tmp.copy(d.t).multiply(b.scale).applyQuaternion(b.quaternion));
      b.quaternion.multiply(d.q);
      b.scale.multiply(d.s);
    }
  }
}

// ---- finding a pattern by its traits -------------------------------------------
// See traitSearch.ts: every pattern's body tabulated once (100,000 x ~10 draws,
// ~80ms), then searched for the one nearest a body you describe.

export const PET_SEED_MAX = 100000;

const traitTables = new Map<string, TraitTable>();
/** Every pattern's trait weights for one preset. Cached per preset. ~80ms. */
export function petTraitTable(preset: [string, number, number][]): TraitTable {
  const id = JSON.stringify(preset);
  let table = traitTables.get(id);
  if (!table) {
    table = buildTraitTable(1, PET_SEED_MAX, (s) => petPoseWeights(s, preset));
    traitTables.set(id, table);
  }
  return table;
}

/**
 * Ease the deltas ON SCREEN toward a target set, by `a` (0..1) this frame.
 *
 * A trait drag hops between real patterns, and two neighbours in trait space
 * can still differ by a fifth of a trait elsewhere — so snapping to each one
 * jerks the bird. Chasing the target instead (called per frame with an
 * exponential `a`) turns a run of hops into one continuous morph, and a bone
 * that leaves the target set relaxes back to identity rather than popping.
 */
export function easePetPose(
  THREE: typeof import("three"),
  shown: Map<string, PetBoneDelta>,
  target: Map<string, PetBoneDelta>,
  a: number,
): void {
  for (const [bone, t] of target) {
    let s = shown.get(bone);
    if (!s) {
      s = { t: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) };
      shown.set(bone, s);
    }
    s.t.lerp(t.t, a);
    s.q.slerp(t.q, a);
    s.s.lerp(t.s, a);
  }
  for (const [bone, s] of shown) {
    if (target.has(bone)) continue;
    s.t.multiplyScalar(1 - a);
    s.q.slerp(new THREE.Quaternion(), a);
    s.s.lerp(new THREE.Vector3(1, 1, 1), a);
    if (s.t.lengthSq() < 1e-8 && Math.abs(s.q.w) > 0.999999 && Math.abs(s.s.x - 1) + Math.abs(s.s.y - 1) + Math.abs(s.s.z - 1) < 1e-5) {
      shown.delete(bone);
    }
  }
}
