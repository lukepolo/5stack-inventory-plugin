// The glyphs for the 3D viewer's control legend.
//
// Each icon is one sentence: a VERB on the left (what happens) and the DEVICE on
// the right (what you do it with) — "these arcs, with that button". Reading a
// row of them tells you the whole control scheme without any text, which is the
// point: the legend used to be three lines of prose that nobody read twice.
//
// The stroke language is deliberately the cursor reticle's (see viewerCursor.ts)
// — hairlines, square caps, arc-arrows for spin — so the legend and the thing
// under your pointer look like the same instrument. Lit parts (the button you
// press, the finger you put down) take var(--acc), so the bar crossfades with
// the team accent along with everything else.
//
// Markup rather than components: these are static strings rendered through
// v-html into one <svg> that owns the shared stroke attributes, so an icon costs
// a string lookup instead of a component instance.

/** Shared canvas. Verb occupies x≈1–15, device x≈19–26. */
export const CONTROL_ICON_VIEWBOX = "0 0 30 24";

const ACC = 'fill="var(--acc, #fff)"';

/** Point on a circle. 0° is up, matching the reticle's convention. */
function polar(cx: number, cy: number, r: number, deg: number): string {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
}

/** Barbed head on the arc at `deg`, pointing `dir` (+1 clockwise) along it. */
function arcHead(cx: number, cy: number, r: number, deg: number, dir: 1 | -1): string {
  const back = deg - dir * 15;
  return `<path d="M${polar(cx, cy, r - 2.7, back)} L${polar(cx, cy, r, deg)} L${polar(cx, cy, r + 2.7, back)}"/>`;
}

/** Arc centred on `mid` spanning `span`, headed at one or both ends. */
function arcArrow(cx: number, cy: number, r: number, mid: number, span: number, both = false): string {
  const a = mid - span / 2;
  const b = mid + span / 2;
  const large = span > 180 ? 1 : 0;
  // Barbs struck back from the tip, one inside the arc and one outside, so the
  // head still reads when the arrow is only six pixels long.
  return (
    `<path d="M${polar(cx, cy, r, a)} A${r},${r} 0 ${large} 1 ${polar(cx, cy, r, b)}"/>` +
    arcHead(cx, cy, r, b, 1) +
    (both ? arcHead(cx, cy, r, a, -1) : "")
  );
}

// Barbs are narrow on purpose: at a 30% wider spread the four heads of the
// cross close up into a diamond outline and stop reading as arrows at all.
/** Arrowhead at radius `r` along `deg`, pointing away from the centre. */
function chevron(cx: number, cy: number, deg: number, r: number, size = 2.6): string {
  const a = ((deg - 90) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const p = (along: number, side: number) =>
    `${(cx + cos * along - sin * side).toFixed(2)},${(cy + sin * along + cos * side).toFixed(2)}`;
  return `<path d="M${p(r - size, -size * 0.78)} L${p(r, 0)} L${p(r - size, size * 0.78)}"/>`;
}

/** Same head, pointing INWARD — the two halves of a pinch. */
function chevronIn(cx: number, cy: number, deg: number, r: number, size = 3): string {
  const a = ((deg - 90) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const p = (along: number, side: number) =>
    `${(cx + cos * along - sin * side).toFixed(2)},${(cy + sin * along + cos * side).toFixed(2)}`;
  return `<path d="M${p(r + size, -size * 0.95)} L${p(r, 0)} L${p(r + size, size * 0.95)}"/>`;
}

// ---- verbs (left half, centred on 8,12) ----

/** Orbit: the item, and a two-way sweep going round it. The body in the middle
 *  is what separates this from V_TURN — camera around the thing vs the thing
 *  itself turning. */
const V_SPIN =
  '<circle cx="8" cy="12" r="2.4" fill="currentColor" stroke="none" opacity="0.45"/>' +
  arcArrow(8, 12, 6.4, 150, 265);
/** Free movement in the view plane. */
const V_CROSS =
  '<path d="M8 5.8v12.4M1.8 12h12.4"/>' +
  chevron(8, 12, 0, 6.4) +
  chevron(8, 12, 90, 6.4) +
  chevron(8, 12, 180, 6.4) +
  chevron(8, 12, 270, 6.4);
/** The same four arrows, but around a THING rather than through the frame —
 *  this is a sticker being nudged, not the whole view sliding. */
const V_CROSS_ITEM =
  '<rect x="5.4" y="9.4" width="5.2" height="5.2" rx="1"/>' +
  chevron(8, 12, 0, 6.6) +
  chevron(8, 12, 90, 6.6) +
  chevron(8, 12, 180, 6.6) +
  chevron(8, 12, 270, 6.6);
/** Wheel travel — the axis a scroll actually moves along. */
const V_SCROLL = '<path d="M8 6.4v11.2"/>' + chevron(8, 12, 0, 6.6) + chevron(8, 12, 180, 6.6);
/** A single sweep: rotating the thing itself, not the camera around it. */
const V_TURN = arcArrow(8, 12, 6, 40, 250);
/** Pinch: two heads closing on the centre, with their travel behind them. */
const V_PINCH =
  '<path d="M8 3.6v5M8 20.4v-5"/>' + chevronIn(8, 12, 0, 3.4) + chevronIn(8, 12, 180, 3.4);

// ---- devices (right half, centred on 22.5) ----

// Body is a 7×14 capsule-topped rect: rx equals half the width, so the top arc
// is a true semicircle and the button fills below can reuse its radius exactly.
const MOUSE_SHELL = '<rect x="19" y="5" width="7" height="14" rx="3.5"/><path d="M19 10h7"/>';
const BTN_LEFT = `<path ${ACC} stroke="none" d="M22.5 10H19V8.5A3.5 3.5 0 0 1 22.5 5Z"/>`;
const BTN_RIGHT = `<path ${ACC} stroke="none" d="M22.5 10H26V8.5A3.5 3.5 0 0 0 22.5 5Z"/>`;
const WHEEL = (lit: boolean) =>
  `<rect x="21.85" y="6.3" width="1.3" height="3.1" rx="0.65" ${
    lit ? ACC : 'fill="currentColor" opacity="0.35"'
  } stroke="none"/>`;

const mouse = (lit: "left" | "right" | "wheel") =>
  MOUSE_SHELL + (lit === "left" ? BTN_LEFT : lit === "right" ? BTN_RIGHT : "") + WHEEL(lit === "wheel");

/** Fingertips on glass: a filled contact point inside its touch halo. */
const finger = (x: number, halo: number) =>
  `<circle cx="${x}" cy="12" r="2.1" ${ACC} stroke="none"/><circle cx="${x}" cy="12" r="${halo}" opacity="0.4"/>`;

const ONE_FINGER = finger(22.5, 4.4);
// Two contacts need room for both halos, so they trade halo for separation.
const TWO_FINGERS = finger(20.2, 3.2) + finger(24.8, 3.2);

export type ControlIcon =
  | "spin"
  | "zoom"
  | "pan"
  | "move"
  | "rotate"
  | "spinTouch"
  | "zoomTouch"
  | "panTouch"
  | "moveTouch";

/**
 * Transport glyphs, which deliberately break the grammar above.
 *
 * Every other icon here is a SENTENCE — verb plus device, "these arcs with that
 * button" — because the legend describes gestures you perform elsewhere. Play
 * and pause are not gestures; they are the button itself, and the universal
 * shapes for them carry no device half and need none. So they get their own
 * square canvas and are filled rather than stroked, which is also what stops a
 * 6px triangle reading as a stray hairline next to the reticle-weight glyphs.
 */
export const TRANSPORT_ICON_VIEWBOX = "0 0 16 16";
export const TRANSPORT_ICON = {
  play: '<path d="M5 3.4 12.2 8 5 12.6Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M4.6 3.6h2.3v8.8H4.6ZM9.1 3.6h2.3v8.8H9.1Z" fill="currentColor" stroke="none"/>',
};

export const CONTROL_ICON: Record<ControlIcon, string> = {
  spin: V_SPIN + mouse("left"),
  zoom: V_SCROLL + mouse("wheel"),
  pan: V_CROSS + mouse("right"),
  move: V_CROSS_ITEM + mouse("left"),
  rotate: V_TURN + mouse("left"),
  spinTouch: V_SPIN + ONE_FINGER,
  zoomTouch: V_PINCH + TWO_FINGERS,
  panTouch: V_CROSS + TWO_FINGERS,
  moveTouch: V_CROSS_ITEM + ONE_FINGER,
};
