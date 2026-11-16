// Do wheel and pinch zoom keep the point under the pointer still, does the
// Spotlight's "Loading 3D model…" pill sit just under the 2D picture, and do the
// team chips aim Equip at a side the item is missing?
//
// Run: node --experimental-strip-types tools/spotlight-check.ts
//
// Zoom used to scale about the weapon's middle, so with a pan applied every
// wheel step dragged the view back toward the centre. The pill used to sit at
// the foot of a tall stage, out of sight on a tall screen.
import { panAfterZoom, pointerMidpoint, type Vec2 } from "../src/viewerZoom.ts";
import { belowContainedArt, containedRect } from "../src/containedArt.ts";
import { defaultEquipSides, onEverySide } from "../src/teamSides.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${JSON.stringify(got)}`);
  }
}
const r = (v: Vec2) => ({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000 });

// viewer3d applyPan: setViewOffset(dx = -pan.x + inset/2, dy = -pan.y), so an
// image point p lands on screen at p - dx across and p - dy down.
const onScreen = (p: Vec2, pan: Vec2, inset: number) => ({ x: p.x + pan.x - inset / 2, y: p.y + pan.y });
const imagePoint = (screen: Vec2, pan: Vec2, inset: number) => ({ x: screen.x - pan.x + inset / 2, y: screen.y - pan.y });

function stays(label: string, anchor: Vec2, pan: Vec2, inset: number, ratio: number) {
  const p = imagePoint(anchor, pan, inset);
  const next = panAfterZoom(anchor, pan, inset, ratio);
  check(label, r(onScreen({ x: p.x * ratio, y: p.y * ratio }, next, inset)), r(anchor));
}

stays("wheel in over the stock, no pan", { x: -300, y: 40 }, { x: 0, y: 0 }, 0, 1.25);
stays("wheel in after a pan", { x: -300, y: 40 }, { x: 120, y: -35 }, 0, 1.25);
stays("wheel out after a pan", { x: 210, y: -80 }, { x: 120, y: -35 }, 0, 0.8);
stays("with the spec panel's inset", { x: -150, y: 10 }, { x: 60, y: 20 }, 380, 1.5);
check("zoom at the pane's centre leaves no pan", r(panAfterZoom({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 2)), { x: 0, y: 0 });
check("a pinch anchors on the fingers' midpoint", pointerMidpoint([{ x: -100, y: 20 }, { x: 60, y: -40 }]), { x: -20, y: -10 });
check("no pointers, no anchor", pointerMidpoint([]), null);

// A 512x384 picture in a 400x900 stage's 352x900 <img> box: drawn 352x264,
// centred, so its bottom is at 450 + 132 = 582.
check("under a picture in a tall stage", belowContainedArt({ top: 0, width: 352, height: 900 }, { width: 512, height: 384 }, 900, 12, 40), 594);
check("under a picture offset in its stage", belowContainedArt({ top: 30, width: 352, height: 600 }, { width: 512, height: 384 }, 700, 12, 40), 474);
check("a picture that fills the height", belowContainedArt({ top: 0, width: 800, height: 300 }, { width: 512, height: 384 }, 300, 12, 40), 260);
check("not loaded yet", belowContainedArt({ top: 0, width: 352, height: 900 }, { width: 0, height: 0 }, 900, 12, 40), null);

// Where the 3D opens: the card's drawn rect inside its object-contain box.
check("a wide card in a tall box", containedRect({ top: 0, left: 0, width: 352, height: 900 }, { width: 512, height: 384 }), { x: 0, y: 318, w: 352, h: 264 });
check("a tall card in a wide box", containedRect({ top: 10, left: 20, width: 800, height: 300 }, { width: 384, height: 512 }), { x: 307.5, y: 10, w: 225, h: 300 });
check("an unloaded card has no rect", containedRect({ top: 0, left: 0, width: 352, height: 900 }, { width: 0, height: 0 }), null);

// The team chips: where Equip goes before anyone picks, and when it reads Equipped.
check("not equipped anywhere: your side", defaultEquipSides(["CT", "T"], [], "CT"), ["CT"]);
check("not equipped anywhere, viewing T: T", defaultEquipSides(["CT", "T"], [], "T"), ["T"]);
check("on T only, viewing CT: CT", defaultEquipSides(["CT", "T"], ["T"], "CT"), ["CT"]);
check("on CT only, viewing CT: the missing T", defaultEquipSides(["CT", "T"], ["CT"], "CT"), ["T"]);
check("on both: nothing left", defaultEquipSides(["CT", "T"], ["CT", "T"], "CT"), []);
check("a CT-only gun already on CT: nothing", defaultEquipSides(["CT"], ["CT"], "CT"), []);
check("a T-only gun viewed from CT: T", defaultEquipSides(["T"], [], "CT"), ["T"]);
check("on both reads Equipped", onEverySide(["CT", "T"], ["CT", "T"]), true);
check("on one side does not", onEverySide(["CT", "T"], ["T"]), false);

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
