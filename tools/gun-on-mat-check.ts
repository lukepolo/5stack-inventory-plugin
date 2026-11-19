import { STICKER_CM, type SavedCraft } from "../src/stickerCraftsModel";
import { frameFrom, gunOnMat, membersOf, outlineSeat, runCentre, seat, type GunLayout, type GunSticker } from "../src/composables/useStickerCraftPlacement";
import type { WeaponOutline } from "../src/outlineTrace";
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
/** The mat rounds to hundredths of a centimetre (5e-5 of the unwrap) and seat to ten-thousandths (5e-5), so a round trip is good to 1e-4 plus float error. */
function near(label: string, got: number[][], want: number[][]) {
  const off = Math.max(0, ...got.flatMap((g, i) => g.map((v, j) => Math.abs(v - want[i][j]))));
  check(label, got.length === want.length && off <= 1.5e-4 ? want : got, want);
}

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
const OUTLINE: WeaponOutline = {
  model: "ak47",
  stickerCm: 5,
  w: 60,
  h: 20,
  paths: [],
  anchors: [{ index: 0, x: 10, y: 8 }, { index: 1, x: 30, y: 8 }, { index: 2, x: 50, y: 8 }],
  uv: { hd: [0.0098, 0.0012, 0.18, -0.0011, 0.0099, 0.42], legacy: [0.0095, 0, 0.16, 0, 0.0095, 0.45] },
};

const craftOf = (laid: GunLayout): SavedCraft => ({
  id: "imported",
  name: "imported",
  savedAt: 0,
  stickers: laid.stickers.map((p, i) => ({ id: i + 1, name: "", image: "", x: p.x, y: p.y, rot: p.rot, wear: 0 })),
});
const frameOf = (legacy: boolean, slots = SLOTS) => frameFrom({ slots, bounds: null }, legacy)!;
/** Put on an empty gun from slot 1 (planRun's run 0..n-1) and placed with Place: the editor's placeHere. */
function placedHere(laid: GunLayout, legacy: boolean) {
  const frame = frameOf(legacy);
  const run = laid.stickers.map((_, i) => i);
  const c = runCentre(run, frame)!;
  return seat(membersOf(craftOf(laid), run, frame), frame, c.u, c.v, 0).map(({ x, y, r }) => [x!, y!, r]);
}
/** "Put on your …" from the chalk: the editor's placeOnOutline. */
function placedOnOutline(laid: GunLayout, legacy: boolean, o: WeaponOutline) {
  const frame = frameOf(legacy);
  const run = laid.stickers.map((_, i) => i);
  const entry = craftOf(laid);
  const put = outlineSeat(entry, membersOf(entry, run, frame), { x: laid.at!.x, y: laid.at!.y, anchors: o.anchors, uv: o.uv }, frame)!;
  return seat(put.members, frame, put.centre.u, put.centre.v, 0).map(({ x, y, r }) => [x!, y!, r]);
}
const asCode = (code: GunSticker[]) => code.map((s) => [s.x, s.y, s.r]);
/** Without a chalk the mat keeps only the layout, so Place puts its centre on the run's anchors: offsets less their mean. */
const aboutTheirCentre = (code: GunSticker[]) => {
  const mx = code.reduce((sum, s) => sum + s.x, 0) / code.length;
  const my = code.reduce((sum, s) => sum + s.y, 0) / code.length;
  return code.map((s) => [s.x - mx, s.y - my, s.r]);
};

const pair: GunSticker[] = [
  { slot: 0, x: 0, y: 0, r: 0 },
  { slot: 1, x: 0.05, y: -0.01, r: 30 },
];
const five: GunSticker[] = [
  { slot: 0, x: 0.03, y: 0.01, r: -12.5 },
  { slot: 1, x: -0.02, y: 0.02, r: 90 },
  { slot: 2, x: 0, y: -0.015, r: 179.5 },
  { slot: 3, x: 0.07, y: 0, r: -180 },
  { slot: 0, x: 0.12, y: 0.03, r: 45 },
];

const free = gunOnMat(pair, SLOTS, false);
check("anchor + offset, about the stickers' centre, at one HD sticker per STICKER_CM, turn negated",
  free, { stickers: [{ x: -12.5, y: 0.5, rot: 0 }, { x: 12.5, y: -0.5, rot: -30 }], at: null });
near("no chalk, placed with Place: the spacing and turns come back, centred on the run's anchors", placedHere(free, false), aboutTheirCentre(pair));
near("a full gun, the fifth on anchor 0, placed with Place", placedHere(gunOnMat(five, SLOTS, false), false), aboutTheirCentre(five));
near("stickers that sat on their own anchors come back exactly", placedHere(gunOnMat([{ slot: 0, x: 0, y: 0, r: 10 }, { slot: 1, x: 0, y: 0, r: 0 }], SLOTS, false), false), [[0, 0, 10], [0, 0, 0]]);
check("the order is the gun's: slot 1 first", gunOnMat(five, SLOTS, false).stickers.map((s) => s.rot), [12.5, -90, -179.5, -180, -45]);

const shared = gunOnMat([{ slot: 0, x: 0, y: 0, r: 0 }, { slot: 4, x: 0, y: 0, r: 0 }], SLOTS, false);
check("an anchor the body lacks is its first, so both sit on one spot", shared.stickers.map((s) => [s.x, s.y]), [[0, 0], [0, 0]]);

const legacy = gunOnMat(pair, SLOTS, true);
check("the legacy body's own spacing: its anchors are 0.23 apart here, the HD body's 0.2", legacy.stickers[1].x, 14);
near("a legacy finish placed with Place", placedHere(legacy, true), aboutTheirCentre(pair));
const onlyHd = SLOTS.filter((s) => s.mesh === "body_hd");
check("a legacy finish on a gun with no legacy anchors uses the HD body's", gunOnMat(pair, onlyHd, true), free);

const chalked = gunOnMat(pair, SLOTS, false, OUTLINE);
check("on the chalked gun there is a centre to put the craft back at", chalked.at !== null, true);
near("chalked, put on with Put on your …: the code's places and turns", placedOnOutline(chalked, false, OUTLINE), asCode(pair));
near("five through the HD unwrap and back", placedOnOutline(gunOnMat(five, SLOTS, false, OUTLINE), false, OUTLINE), asCode(five));
near("through the legacy unwrap and back", placedOnOutline(gunOnMat(pair, SLOTS, true, OUTLINE), true, OUTLINE), asCode(pair));
const traced = { ...OUTLINE, uv: undefined };
near("an outline from before the unwraps goes through its slot spots, and back",
  placedOnOutline(gunOnMat(pair, SLOTS, false, traced), false, traced), asCode(pair));
check("an outline with nothing to project by leaves the free layout", gunOnMat(pair, SLOTS, false, { ...traced, anchors: [] }), free);

check("a gun with no anchors at all: a row, a sticker and a centimetre apart",
  gunOnMat([{ slot: 0, x: 0.1, y: 0, r: 10 }, { slot: 1, x: 0, y: 0, r: 0 }, { slot: 2, x: 0, y: 0, r: -20 }], [], false),
  { stickers: [{ x: -(STICKER_CM + 1), y: 0, rot: -10 }, { x: 0, y: 0, rot: 0 }, { x: STICKER_CM + 1, y: 0, rot: 20 }], at: null });
check("no stickers, nothing to lay", gunOnMat([], SLOTS, false, OUTLINE), { stickers: [], at: null });

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\na gun's layout goes onto the mat and back unchanged");
