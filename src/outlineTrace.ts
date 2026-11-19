// A weapon's side outline as vector paths, in the Sticker Crafts mat's units —
// what the mat chalks and the outline cards draw.
//
// The viewer measures a weapon as a silhouette MASK (viewer3d's sideOutline);
// this traces the mask's edges (marching squares), links them into closed
// loops, thins them (Ramer–Douglas–Peucker) and scales them to the mat: one
// sticker on that gun is STICKER_CM on the mat. A few kilobytes a weapon, so
// every weapon's outline ships baked in weaponOutlines.json
// (tools/shadertest/outlines.html makes it) and a card shows at once; this same
// code traces one live when the table doesn't have it.
import type { SideOutline } from "./viewer3d";
import type { StickerSlot } from "./api";
import { STICKER_CM } from "./stickerCraftsModel";

export interface WeaponOutline {
  model: string;
  /** One sticker's real width on this gun, in cm. CS2 sizes stickers per gun
   *  (a Glock's are 4.4 cm, an AWP's 7.7), so the mat's rulers read real
   *  centimetres against this rather than against STICKER_CM. */
  stickerCm: number;
  /** The outline's box, in mat units. */
  w: number;
  h: number;
  /** Closed loops, in mat units from the box's top-left: x0, y0, x1, y1, … */
  paths: number[][];
  /** Each sticker slot's anchor (0-based slot), in the same units. `size` is
   *  only ever set for drawing (the slot's sticker as a share of STICKER_CM). */
  anchors: { index: number; x: number; y: number; size?: number }[];
  /** The StatTrak module's outline: closed loops in the same units and from the
   *  same corner, where the editor puts the module on this gun. [] when the gun
   *  takes none; absent on an outline traced before the module was. */
  stattrak?: number[][];
  /** The trace's format (OUTLINE_V); absent = 1. */
  v?: number;
  /**
   * Each body's sticker unwrap over this outline: TEXCOORD_1 at a point
   * (x, y) of it (mat units from its top-left) is u = a·x + b·y + c,
   * v = d·x + e·y + f, [a, b, c, d, e, f]. Measured off the body's own mesh
   * (viewer3d sideOutline). A craft goes on the gun through the unwrap of the
   * body its finish uses — the two differ (the AWP's by 2.2cm).
   */
  uv?: { hd?: number[]; legacy?: number[] };
}

/** This trace format: 2 adds the StatTrak counter and the bodies' unwraps. A
 *  stored outline of an older format is traced again (and replaces it). */
export const OUTLINE_V = 2;

// Marching squares: for each cell's corner pattern (tl 8, tr 4, br 2, bl 1),
// the edges it joins — T, R, B, L for the midpoints of the cell's sides.
const CASES: string[][] = [
  [], ["LB"], ["BR"], ["LR"], ["TR"], ["LT", "BR"], ["TB"], ["LT"],
  ["LT"], ["TB"], ["TR", "LB"], ["TR"], ["LR"], ["BR"], ["LB"], [],
];

/** Points further than `eps` from the chord are kept (open polyline). */
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A mask's edges as closed loops (marching squares, linked, thinned), in mat
 * units measured from (minX, minY) — the GUN's box corner for both the gun and
 * its StatTrak module, so the two line up. Loops of fewer than `minLoop` edge
 * points are specks, not shape.
 */
function traceLoops(mask: Uint8Array, W: number, H: number, minX: number, minY: number, unit: number, minLoop: number): number[][] {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return [];
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] ? 1 : 0);
  // Segments between side midpoints, keyed at twice their coordinates so every
  // point is an integer and a shared midpoint is the same key from both cells.
  const segs: [number, number][] = [];
  const keyOf = (x2: number, y2: number) => y2 * (2 * W + 4) + x2;
  const coord = new Map<number, [number, number]>();
  const mid = (x: number, y: number, side: string): number => {
    const [x2, y2] =
      side === "T" ? [2 * x + 1, 2 * y] : side === "R" ? [2 * x + 2, 2 * y + 1] : side === "B" ? [2 * x + 1, 2 * y + 2] : [2 * x, 2 * y + 1];
    const k = keyOf(x2 + 2, y2 + 2);
    if (!coord.has(k)) coord.set(k, [x2 / 2, y2 / 2]);
    return k;
  };
  for (let y = y0 - 1; y <= y1; y++) {
    for (let x = x0 - 1; x <= x1; x++) {
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      for (const pair of CASES[c]) segs.push([mid(x, y, pair[0]), mid(x, y, pair[1])]);
    }
  }
  // Link into loops.
  const ends = new Map<number, number[]>();
  segs.forEach(([a, b], i) => {
    (ends.get(a) ?? ends.set(a, []).get(a)!).push(i);
    (ends.get(b) ?? ends.set(b, []).get(b)!).push(i);
  });
  const used = new Uint8Array(segs.length);
  const round = (v: number) => Math.round(v * 100) / 100;
  const paths: number[][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segs[s][0];
    let cur = segs[s][1];
    const loop: [number, number][] = [coord.get(start)!, coord.get(cur)!];
    for (;;) {
      const next = (ends.get(cur) ?? []).find((i) => !used[i]);
      if (next == null) break;
      used[next] = 1;
      cur = segs[next][0] === cur ? segs[next][1] : segs[next][0];
      if (cur === start) break;
      loop.push(coord.get(cur)!);
    }
    if (loop.length < minLoop) continue;
    // A closed loop thins as two halves, so its ends stay put.
    const half = loop.length >> 1;
    const thin = [...simplify(loop.slice(0, half + 1), 0.7), ...simplify(loop.slice(half).concat([loop[0]]), 0.7).slice(1, -1)];
    paths.push(thin.flatMap(([x, y]) => [round((x - minX) * unit), round((y - minY) * unit)]));
  }
  return paths;
}

export function traceOutline(model: string, o: SideOutline): WeaponOutline | null {
  const { width: W, height: H, mask } = o;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const unit = (o.worldPerPx * STICKER_CM) / o.stickerWorld;
  const round = (v: number) => Math.round(v * 100) / 100;
  // Specks of a few pixels are noise, not part of the shape.
  const paths = traceLoops(mask, W, H, minX, minY, unit, 12);
  if (!paths.length) return null;
  return {
    model,
    stickerCm: round(o.stickerWorld * 100),
    w: round((maxX - minX + 1) * unit),
    h: round((maxY - minY + 1) * unit),
    paths,
    // The anchors are in pixel-EDGE coordinates, the loops in pixel centres.
    anchors: o.anchors.map((a) => ({ index: a.index, x: round((a.x - 0.5 - minX) * unit), y: round((a.y - 0.5 - minY) * unit) })),
    // The module is small (a few dozen pixels across), so its loops are kept
    // down to 8 edge points.
    stattrak: o.stattrak ? traceLoops(o.stattrak, W, H, minX, minY, unit, 8) : [],
    v: OUTLINE_V,
    uv: Object.fromEntries(
      (["hd", "legacy"] as const).flatMap((key) => {
        const q = o.uv?.[key];
        if (!q) return [];
        // Pixels to mat units: px = x / unit + minX + 0.5 (the anchors' rule).
        const [a, b, c, d, e, f] = q;
        const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
        const cx = minX + 0.5;
        const cy = minY + 0.5;
        return [[key, [a / unit, b / unit, a * cx + b * cy + c, d / unit, e / unit, d * cx + e * cy + f].map(r6)]];
      }),
    ) as WeaponOutline["uv"],
  };
}

// ---- the outline against the gun's own slots -------------------------------------

/** The slots of the body an outline is traced on: body_hd's, when it has any. */
export function bodySlots(slots: StickerSlot[], body = "body_hd"): StickerSlot[] {
  const mine = slots.filter((s) => s.mesh === body);
  return mine.length ? mine : slots;
}

/**
 * One sticker's size on a gun, in the unwrap: the median of its slots' scales
 * (a sticker spans 1/scale). The mat draws every sticker STICKER_CM across, so
 * this is also how mat centimetres turn into the gun's sticker offsets — ONE
 * factor for the whole gun. A place on the gun is a property of its surface,
 * not of the slot a sticker happens to be in: converting each sticker at its
 * own slot's scale (FAMAS 13.6–17.3, P90, MAC-10, Desert Eagle) pulled a
 * craft's layout apart.
 */
export function slotScale(slots: StickerSlot[]): number {
  const sc = slots.map((s) => s.scale).filter((x) => x > 0).sort((a, b) => a - b);
  return sc.length ? sc[Math.floor(sc.length / 2)] : 1;
}

/**
 * The outline at the scale the gun's own slots set.
 *
 * A trace is sized by the unwrap's density over the WHOLE gun (uv1Density, a
 * median over every triangle edge — scope, magazine and all), while stickers
 * are placed in the unwrap where they actually sit, which is 5–9% less dense
 * on every gun measured: a craft laid out on the chalk landed that much wider
 * on the gun, the slots' dashed squares out of step with the gun's own. Each
 * slot's spot on the outline and its offset on the gun are the same point, so
 * the outline is scaled until they agree (least squares about their centres).
 * The real length stays the same — only what one sticker measures on it
 * (stickerCm) changes. Stored outlines stay raw; this runs on the way in.
 * Fewer than two slots, or slots all on one spot (the Desert Eagle's), leave
 * nothing to measure by, and the outline is used as traced.
 */
export function calibrateOutline(o: WeaponOutline, slots: StickerSlot[]): WeaponOutline {
  const body = bodySlots(slots);
  const k = STICKER_CM * slotScale(body);
  let f: number | null = null;
  const hd = o.uv?.hd;
  if (hd) {
    // Measured: how much of the unwrap one mat unit spans, against what it
    // must (one sticker, 1/scale, over STICKER_CM units).
    const m = (Math.hypot(hd[0], hd[3]) + Math.hypot(hd[1], hd[4])) / 2;
    f = m * k;
  } else {
    // An outline traced before the unwraps were: from the slots alone.
    const pairs = o.anchors.flatMap((a) => {
      const s = body.find((x) => x.index === a.index);
      return s ? [{ x: a.x, y: a.y, u: s.offset[0] * k, v: s.offset[1] * k }] : [];
    });
    if (pairs.length < 2) return o;
    const mean = (g: (p: (typeof pairs)[number]) => number) => pairs.reduce((sum, p) => sum + g(p), 0) / pairs.length;
    const ax = mean((p) => p.x);
    const ay = mean((p) => p.y);
    const au = mean((p) => p.u);
    const av = mean((p) => p.v);
    let num = 0;
    let den = 0;
    for (const p of pairs) {
      num += (p.x - ax) * (p.u - au) + (p.y - ay) * (p.v - av);
      den += (p.x - ax) ** 2 + (p.y - ay) ** 2;
    }
    if (den < 4) return o;
    f = num / den;
  }
  if (!(f > 0.8 && f < 1.25)) return o;
  const ff = f;
  const round = (v: number) => Math.round(v * 100) / 100;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  // An unwrap per mat unit shrinks as the units do; where it starts does not move.
  const scaleUv = (q: number[]) => [q[0] / ff, q[1] / ff, q[2], q[3] / ff, q[4] / ff, q[5]].map(r6);
  return {
    ...o,
    stickerCm: round(o.stickerCm / ff),
    w: round(o.w * ff),
    h: round(o.h * ff),
    paths: o.paths.map((p) => p.map((v) => round(v * ff))),
    anchors: o.anchors.map((a) => ({ index: a.index, x: round(a.x * ff), y: round(a.y * ff) })),
    ...(o.stattrak ? { stattrak: o.stattrak.map((p) => p.map((v) => round(v * ff))) } : {}),
    ...(o.uv ? { uv: Object.fromEntries(Object.entries(o.uv).map(([key, q]) => [key, scaleUv(q!)])) as WeaponOutline["uv"] } : {}),
  };
}

/** Mat units of an outline to sticker-offset space (TEXCOORD_1 − 0.5): an offset
 *  is m·(x, y) + c, m = [mxx, mxy, myx, myy]. */
export type OutlineProjection = { m: [number, number, number, number]; c: [number, number] };

/**
 * How an outline's points land on the gun, for the body the finish renders on:
 * through that body's measured unwrap (WeaponOutline.uv) — exact, and the only
 * thing that is for a legacy finish, whose unwrap sits elsewhere than the HD
 * body's the outline was traced on. An outline from before the unwraps were
 * measured falls back to the slots: their spots matched to the same slots'
 * offsets by index, at one scale (`scale`, slotScale of the HD slots). Null
 * with neither.
 */
export function outlineProjection(
  o: { anchors: { index: number; x: number; y: number }[]; uv?: WeaponOutline["uv"] },
  body: string,
  slotOf: (index: number) => StickerSlot | undefined,
  scale: number,
): OutlineProjection | null {
  const q = o.uv?.[body === "body_legacy" ? "legacy" : "hd"];
  if (q) return { m: [q[0], q[1], q[3], q[4]], c: [q[2] - 0.5, q[5] - 0.5] };
  const k = 1 / (STICKER_CM * scale);
  const pairs = o.anchors.flatMap((a) => {
    const s = slotOf(a.index);
    return s ? [{ a, s }] : [];
  });
  if (!pairs.length) return null;
  const cu = pairs.reduce((sum, { a, s }) => sum + s.offset[0] - a.x * k, 0) / pairs.length;
  const cv = pairs.reduce((sum, { a, s }) => sum + s.offset[1] - a.y * k, 0) / pairs.length;
  return { m: [k, 0, 0, k], c: [cu, cv] };
}
/** A point of the outline, in sticker-offset space. */
export const projectPoint = (p: OutlineProjection, x: number, y: number) => ({
  u: p.m[0] * x + p.m[1] * y + p.c[0],
  v: p.m[2] * x + p.m[3] * y + p.c[1],
});
/** A distance on the mat (a sticker from its craft's centre), in offset space. */
export const projectVector = (p: OutlineProjection, x: number, y: number) => ({
  u: p.m[0] * x + p.m[1] * y,
  v: p.m[2] * x + p.m[3] * y,
});

/** An offset on the gun (sticker-offset space) back to a point of the outline. */
export function unprojectPoint(p: OutlineProjection, u: number, v: number): { x: number; y: number } | null {
  const [a, b, c, d] = p.m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const du = u - p.c[0];
  const dv = v - p.c[1];
  return { x: (d * du - b * dv) / det, y: (a * dv - c * du) / det };
}
