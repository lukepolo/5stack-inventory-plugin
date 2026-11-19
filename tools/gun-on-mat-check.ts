// Does a layout read off a gun land on the Sticker Crafts mat so that putting it
// back on that gun gives the same stickers in the same places?
//
// Run: npm run check:gun-on-mat
//
// The way onto a gun is useStickerCraftPlacement: membersOf turns mat units
// into the unwrap at 1 / (STICKER_CM * slotScale), placeOnOutline goes through
// the outline's projection, seat subtracts each slot's anchor, and the mat's
// turn is the game's negated. gunOnMat is that backwards; each case here goes
// there and back again.
import { STICKER_CM } from "../src/stickerCraftsModel";
import { gunOnMat, outlineProjection, projectPoint, projectVector, type GunSticker, type WeaponOutline } from "../src/outlineTrace";
import type { StickerSlot } from "../src/api";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${JSON.stringify(got)}`);
  }
}
/** Within a ten-thousandth of the unwrap: the mat keeps hundredths of a centimetre, a gun ten-thousandths. */
function near(label: string, got: number[][], want: number[][]) {
  const off = Math.max(0, ...got.flatMap((g, i) => g.map((v, j) => Math.abs(v - want[i][j]))));
  check(label, got.length === want.length && off <= 1e-4 ? want : got, want);
}
const wrapDeg = (d: number) => Math.round(((((d + 180) % 360) + 360) % 360 - 180) * 2) / 2;

const slot = (index: number, mesh: string, offset: [number, number], scale: number): StickerSlot => ({ index, mesh, offset, scale, rotation: 0 });
const SLOTS: StickerSlot[] = [
  slot(0, "body_hd", [-0.2, 0.05], 20),
  slot(1, "body_hd", [0, 0.05], 20),
  slot(2, "body_hd", [0.2, 0.05], 20),
  slot(3, "body_hd", [0.4, 0.1], 22),
  slot(0, "body_legacy", [-0.25, 0.08], 22),
  slot(1, "body_legacy", [-0.02, 0.08], 22),
  slot(2, "body_legacy", [0.15, 0.08], 22),
  slot(3, "body_legacy", [0.35, 0.12], 22),
  slot(4, "body_legacy", [0.5, 0.12], 22),
];
const HD_SCALE = 20;
const anchorOn = (body: string, index: number) => {
  const mine = SLOTS.filter((s) => s.mesh === body);
  return (mine.find((s) => s.index === index) ?? mine.reduce((lo, s) => (s.index < lo.index ? s : lo))).offset;
};

/** membersOf + seat, at the centre the stickers' own anchors put them (placeHere): the offsets a gun gets back. */
function backOnGun(laid: ReturnType<typeof gunOnMat>, code: GunSticker[], body: string) {
  const k = 1 / (STICKER_CM * HD_SCALE);
  const places = code.map((s) => ({ u: anchorOn(body, s.slot)[0] + s.x, v: anchorOn(body, s.slot)[1] + s.y }));
  const cu = places.reduce((sum, p) => sum + p.u, 0) / places.length;
  const cv = places.reduce((sum, p) => sum + p.v, 0) / places.length;
  return laid.stickers.map((m, i) => {
    const a = anchorOn(body, code[i].slot);
    return [cu + m.x * k - a[0], cv + m.y * k - a[1], wrapDeg(-m.rot)];
  });
}
/** "Put on your …": the centre through projectPoint, each sticker through projectVector, then seat. */
function backThroughOutline(laid: ReturnType<typeof gunOnMat>, code: GunSticker[], body: string, o: WeaponOutline) {
  const mine = SLOTS.filter((s) => s.mesh === body);
  const proj = outlineProjection(o, body, (i) => mine.find((s) => s.index === i), HD_SCALE)!;
  const c = projectPoint(proj, laid.at!.x, laid.at!.y);
  return laid.stickers.map((m, i) => {
    const d = projectVector(proj, m.x, m.y);
    const a = anchorOn(body, code[i].slot);
    return [c.u + d.u - a[0], c.v + d.v - a[1], wrapDeg(-m.rot)];
  });
}
const asCode = (code: GunSticker[]) => code.map((s) => [s.x, s.y, s.r]);

const pair: GunSticker[] = [
  { slot: 0, x: 0, y: 0, r: 0 },
  { slot: 1, x: 0.05, y: -0.01, r: 30 },
];
const free = gunOnMat(pair, SLOTS, "body_hd");
check("anchor + offset, about the stickers' centre, at one HD sticker per STICKER_CM, turn negated",
  free, { stickers: [{ x: -12.5, y: 0.5, rot: 0 }, { x: 12.5, y: -0.5, rot: -30 }], at: null });
near("and back on the gun the places and turns are the code's", backOnGun(free, pair, "body_hd"), asCode(pair));

const five: GunSticker[] = [
  { slot: 0, x: 0.03, y: 0.01, r: -12.5 },
  { slot: 1, x: -0.02, y: 0.02, r: 90 },
  { slot: 2, x: 0, y: -0.015, r: 179.5 },
  { slot: 3, x: 0.07, y: 0, r: -180 },
  { slot: 0, x: 0.12, y: 0.03, r: 45 },
];
near("a full gun, the fifth on anchor 0, goes there and back", backOnGun(gunOnMat(five, SLOTS, "body_hd"), five, "body_hd"), asCode(five));
check("the order is the gun's: slot 1 first", gunOnMat(five, SLOTS, "body_hd").stickers.map((s) => s.rot), [12.5, -90, -179.5, -180, -45]);

const shared = gunOnMat([{ slot: 0, x: 0, y: 0, r: 0 }, { slot: 4, x: 0, y: 0, r: 0 }], SLOTS, "body_hd");
check("an anchor the body lacks is its first, so both sit on one spot", shared.stickers.map((s) => [s.x, s.y]), [[0, 0], [0, 0]]);

const legacy = gunOnMat(pair, SLOTS, "body_legacy");
near("a legacy finish measures from the legacy body's anchors", backOnGun(legacy, pair, "body_legacy"), asCode(pair));
check("the legacy body's own spacing: its anchors are 0.23 apart here, the HD body's 0.2", legacy.stickers[1].x, 14);
const onlyHd = SLOTS.filter((s) => s.mesh === "body_hd");
check("a legacy finish on a gun with no legacy anchors uses the HD body's", gunOnMat(pair, onlyHd, "body_legacy"), free);

const OUTLINE: WeaponOutline = {
  model: "ak47",
  stickerCm: 5,
  w: 60,
  h: 20,
  paths: [],
  anchors: [{ index: 0, x: 10, y: 8 }, { index: 1, x: 30, y: 8 }, { index: 2, x: 50, y: 8 }],
  uv: { hd: [0.0098, 0.0012, 0.18, -0.0011, 0.0099, 0.42], legacy: [0.0095, 0, 0.16, 0, 0.0095, 0.45] },
};
const chalked = gunOnMat(pair, SLOTS, "body_hd", OUTLINE);
check("on the chalked gun there is a centre to put the craft back at", chalked.at !== null, true);
near("through the HD unwrap and back, the code's places and turns", backThroughOutline(chalked, pair, "body_hd", OUTLINE), asCode(pair));
near("five through the HD unwrap and back", backThroughOutline(gunOnMat(five, SLOTS, "body_hd", OUTLINE), five, "body_hd", OUTLINE), asCode(five));
near("through the legacy unwrap and back", backThroughOutline(gunOnMat(pair, SLOTS, "body_legacy", OUTLINE), pair, "body_legacy", OUTLINE), asCode(pair));
const traced = { ...OUTLINE, uv: undefined };
near("an outline from before the unwraps goes through its slot spots, and back",
  backThroughOutline(gunOnMat(pair, SLOTS, "body_hd", traced), pair, "body_hd", traced), asCode(pair));
check("an outline with nothing to project by leaves the free layout", gunOnMat(pair, SLOTS, "body_hd", { ...traced, anchors: [] }), free);

check("a gun with no anchors at all: a row, a sticker and a centimetre apart",
  gunOnMat([{ slot: 0, x: 0.1, y: 0, r: 10 }, { slot: 1, x: 0, y: 0, r: 0 }, { slot: 2, x: 0, y: 0, r: -20 }], [], "body_hd"),
  { stickers: [{ x: -(STICKER_CM + 1), y: 0, rot: -10 }, { x: 0, y: 0, rot: 0 }, { x: STICKER_CM + 1, y: 0, rot: 20 }], at: null });
check("no stickers, nothing to lay", gunOnMat([], SLOTS, "body_hd", OUTLINE), { stickers: [], at: null });

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\na gun's layout goes onto the mat and back unchanged");
