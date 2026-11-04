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
  /** Each sticker slot's anchor (0-based slot), in the same units. */
  anchors: { index: number; x: number; y: number }[];
}

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
  for (let y = minY - 1; y <= maxY; y++) {
    for (let x = minX - 1; x <= maxX; x++) {
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
  const unit = (o.worldPerPx * STICKER_CM) / o.stickerWorld;
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
    // Specks of a few pixels are noise, not part of the shape.
    if (loop.length < 12) continue;
    // A closed loop thins as two halves, so its ends stay put.
    const half = loop.length >> 1;
    const thin = [...simplify(loop.slice(0, half + 1), 0.7), ...simplify(loop.slice(half).concat([loop[0]]), 0.7).slice(1, -1)];
    paths.push(thin.flatMap(([x, y]) => [round((x - minX) * unit), round((y - minY) * unit)]));
  }
  return {
    model,
    stickerCm: round(o.stickerWorld * 100),
    w: round((maxX - minX + 1) * unit),
    h: round((maxY - minY + 1) * unit),
    paths,
    // The anchors are in pixel-EDGE coordinates, the loops in pixel centres.
    anchors: o.anchors.map((a) => ({ index: a.index, x: round((a.x - 0.5 - minX) * unit), y: round((a.y - 0.5 - minY) * unit) })),
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
  const pairs = o.anchors.flatMap((a) => {
    const s = body.find((x) => x.index === a.index);
    return s ? [{ x: a.x, y: a.y, u: s.offset[0] * k, v: s.offset[1] * k }] : [];
  });
  if (pairs.length < 2) return o;
  const mean = (f: (p: (typeof pairs)[number]) => number) => pairs.reduce((sum, p) => sum + f(p), 0) / pairs.length;
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
  const f = num / den;
  if (!(f > 0.8 && f < 1.25)) return o;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    ...o,
    stickerCm: round(o.stickerCm / f),
    w: round(o.w * f),
    h: round(o.h * f),
    paths: o.paths.map((p) => p.map((v) => round(v * f))),
    anchors: o.anchors.map((a) => ({ index: a.index, x: round(a.x * f), y: round(a.y * f) })),
  };
}

/**
 * Where a point of an outline (mat units from its top-left corner) is on the
 * gun, in sticker-offset space: the outline's slot spots matched to the same
 * slots' offsets, by index, at slotScale. Null without a slot to match.
 */
export function outlineToOffset(
  at: { x: number; y: number },
  anchors: { index: number; x: number; y: number }[],
  slotOf: (index: number) => StickerSlot | undefined,
  scale: number,
): { u: number; v: number } | null {
  const k = 1 / (STICKER_CM * scale);
  const pairs = anchors.flatMap((a) => {
    const s = slotOf(a.index);
    return s ? [{ a, s }] : [];
  });
  if (!pairs.length) return null;
  const u = pairs.reduce((sum, { a, s }) => sum + s.offset[0] - a.x * k, 0) / pairs.length + at.x * k;
  const v = pairs.reduce((sum, { a, s }) => sum + s.offset[1] - a.y * k, 0) / pairs.length + at.y * k;
  return { u, v };
}
