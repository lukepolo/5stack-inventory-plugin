// StatTrak module: the little counter block CS2 bolts onto the side of a
// StatTrak weapon. It is a SEPARATE model parented to the weapon at an
// attachment literally named `stattrak` — not a bodygroup, not baked into the
// weapon mesh:
//
//   weapons/models/shared/stattrak/stattrak_module.vmdl        (guns)
//   weapons/models/shared/stattrak/stattrak_module_knife.vmdl  (knives)
//
// Both are already on the models mount (extract-models.sh sweeps
// `weapons/models/`), and each .glb carries its own materials + digit atlas,
// so nothing here has to build geometry.
//
// This file owns the DIGIT MATH only; viewer3d owns the scene plumbing. The
// split is deliberate — the digit decode is the part with a right answer, and
// keeping it pure makes it checkable without a GPU (see tools/stattrak-digits).
//
// Ground truth is Valve's own shader, csgo_weapon_stattrak.vfx, which draws all
// six digits from ONE integer (`g_nStatTrakValue`) by indexing an atlas:
//
//   const uint div[6] = {100000, 10000, 1000, 100, 10, 1};
//   int slot = clamp(int(u * 6.0), 0, 5);          // 0 = most significant
//   uint q   = uint(value) / div[slot];
//   idx.x    = int(q != 0 || slot == 5) + (q % 10) // col 0 = BLANK
//   u_atlas  = idx.x * 0.0625      + fract(u*6) * 0.0546875
//   v_atlas  = idx.y * 0.125       + v          * 0.07421875
//
// i.e. a 16-column x 8-row atlas where column 0 is blank and columns 1..10 are
// digits 0..9. The digit occupies 87.5% of a cell horizontally (0.0546875 /
// 0.0625) and 59.375% vertically (0.07421875 / 0.125) — the rest is padding we
// must NOT sample, or neighbouring digits bleed in.

/** Atlas layout, straight from the shader constants above. */
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;
/** Fraction of a cell the glyph actually occupies. */
export const CELL_U_FRAC = 0.0546875 / (1 / ATLAS_COLS); // 0.875
export const CELL_V_FRAC = 0.07421875 / (1 / ATLAS_ROWS); // 0.59375
export const DIGIT_SLOTS = 6;

const DIV = [100000, 10000, 1000, 100, 10, 1];
/** CS2 caps the counter here (cs2-lib's CS2_MAX_STATTRAK). */
export const MAX_STATTRAK = 999999;

// Asset basenames. The extractor flat-copies every texture next to the models
// and content-hashes the names, so these change on a CS2 update that retouches
// the art — if the display ever renders untextured, re-check these against
// `ls /cs2-models/models/stattrak_*`.
export const MODULE_GLB = "extra/stattrak_module";
export const MODULE_GLB_KNIFE = "knives/stattrak_module_knife";
// The gun module's readout is `stattrak_module_display`; the knife's is
// `stattrak_module_display_knife`, so match on the prefix rather than equality
// — an exact compare silently skips every knife.
export const DISPLAY_MATERIAL = "stattrak_module_display";
export const isDisplayMaterial = (name: string | undefined) =>
  !!name && name.startsWith(DISPLAY_MATERIAL);

/**
 * The six atlas COLUMN indices for a counter value, most-significant first.
 *
 * `null` means "no readout" — every slot blank. That is the 2D card case: the
 * baked card deliberately shows a dark display so the image stays valid no
 * matter how many kills land, which is what keeps the kill count out of
 * renderKeyFor and off the re-bake treadmill.
 *
 * Note CS2 uses -1 as an "unassigned" sentinel that plays a 5-frame scramble
 * out of atlas rows 1..5. We never hit it: every item we render has a real
 * count, so row 0 is the only row this ever samples.
 */
export function digitColumns(value: number | null): number[] {
  if (value == null) return new Array(DIGIT_SLOTS).fill(0);
  const v = Math.max(0, Math.min(MAX_STATTRAK, Math.floor(value)));
  return DIV.map((div, slot) => {
    const q = Math.floor(v / div);
    // Column 1+d is the LIT digit d; column 0 is the UNLIT zero. So a leading
    // zero is not skipped, it is drawn dim — which is why CS2 renders a fresh
    // StatTrak as "000000" and 1337 as a dim "00" followed by a lit "1337".
    return q !== 0 || slot === DIGIT_SLOTS - 1 ? 1 + (q % 10) : 0;
  });
}

/**
 * Build a replacement ATLAS whose first six columns hold the glyphs this count
 * should display, so the model's own UVs address them unchanged.
 *
 * This is not a "strip". The display plate is already unwrapped INTO ATLAS
 * SPACE — measured off the gun module, its six digit quads use
 *
 *   u = 1.0, 2.0625, 3.125, 4.1875, 5.25, 6.3125   (each spanning 0.0546875)
 *   v = -1.0 .. -0.9238                            (spanning 0.0742)
 *
 * Under Repeat wrapping those fract to 0, 0.0625, 0.125, 0.1875, 0.25, 0.3125
 * — exactly atlas columns 0..5 at the column pitch of 1/16, with the glyph
 * width and row height the shader uses. In other words slot n samples atlas
 * column n, and Valve's shader does its work by choosing WHICH glyph lives
 * there. So do the same: permute the columns and change nothing else.
 *
 * The earlier approach — compose a 6-cell strip and remap the UVs onto it with
 * texture repeat/offset — stretched one glyph across the whole plate and
 * rendered as an orange smear.
 *
 * Works for the colour atlas and the self-illum mask alike; they share UVs.
 */
export function composeDigitAtlas(
  source: CanvasImageSource & { width: number; height: number },
  value: number | null,
): HTMLCanvasElement {
  const cols = digitColumns(value);
  const canvas = document.createElement("canvas");
  // Same dimensions as the source, so every UV constant stays valid.
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const cw = source.width / ATLAS_COLS;
  const ch = source.height / ATLAS_ROWS;
  // Start from the untouched atlas: anything the plate samples outside the six
  // digit cells (padding, the unlit grid) must still be there.
  ctx.drawImage(source, 0, 0);
  cols.forEach((col, slot) => {
    // Column `slot` is what the plate reads; fill it with glyph `col`.
    // EVERY slot is written, including col 0 — that column is NOT blank, it is
    // the UNLIT zero, which is why CS2 shows a fresh StatTrak as "000000".
    // The shader's +1 picks the LIT digit; column 0 is the same digit dark.
    ctx.clearRect(slot * cw, 0, cw, ch);
    ctx.drawImage(source, col * cw, 0, cw, ch, slot * cw, 0, cw, ch);
  });
  return canvas;
}

// Typed as plain number[] rather than 3-tuples because these come straight
// from a JSON import, which widens tuples — asserting the narrower type would
// be a cast that proves nothing. Length is checked where it's consumed.
export interface StatTrakAnchor {
  /**
   * Raw attachment origin in MODEL INCHES, unswizzled — the space poseXform
   * consumes. This is the one to use whenever the body has a skeleton, which
   * is every weapon: the body's vertices were baked through the
   * `inventory_icon` pose, and an anchor that skips that pose stays where the
   * gun USED to be (it renders hanging in space below the weapon).
   */
  src: number[];
  /** GLB metres, already swizzled out of Source space by the extractor. Only
   *  correct for a skeleton-less model, where rendered space IS model space. */
  pos: number[];
  /** Source-space Euler in DEGREES, as authored on the attachment. */
  angles: number[];
}

/**
 * Where the module sits on this weapon, in the viewer's own space.
 *
 * Position comes from the model's `stattrak` attachment. Unlike charm anchors
 * there is no second space to reconcile: CS2 exposes no user offsets for the
 * module, so the attachment origin IS the answer and the `weapon` bone base
 * that bedevils charmAnchors.json must NOT be added.
 *
 * Rotation matters — `ignore_rotation` is false on every weapon and the tilt
 * reaches 13.1 degrees on the SG553, which is plainly visible as a module
 * floating off the receiver if dropped. The extractor's swizzle
 * (glb.x,y,z = src.y,z,x) is a cyclic permutation, so it carries rotations the
 * same way: a rotation about src X is one about glb Z, src Y -> glb X,
 * src Z -> glb Y, signs preserved. Every shipped anchor turns out to be
 * single-axis, so Euler order never actually bites.
 */
export function stattrakTransform(anchor: StatTrakAnchor): {
  /** Model inches, source axes — feed through poseXform. */
  src: [number, number, number];
  /** Pre-swizzled metres — only for the skeleton-less fallback. */
  pos: [number, number, number];
  /** Radians about the MODEL's own axes, to be composed with the pose's
   *  rotation. Not pre-swizzled: poseXform already carries the axis change. */
  euler: [number, number, number];
} | null {
  if (anchor.src.length !== 3 || anchor.pos.length !== 3) return null;
  const [ax = 0, ay = 0, az = 0] = anchor.angles;
  const rad = Math.PI / 180;
  return {
    src: [anchor.src[0], anchor.src[1], anchor.src[2]],
    pos: [anchor.pos[0], anchor.pos[1], anchor.pos[2]],
    euler: [ax * rad, ay * rad, az * rad],
  };
}

export interface StatTrakAnchorSet {
  hd?: StatTrakAnchor;
  legacy?: StatTrakAnchor;
  /** Knives take the knife module — a bare engraved plate with no housing and
   *  no glow — so this decides both the GLB and whether to light the digits. */
  knife: boolean;
}

/** Pick the anchor variant matching the body the viewer actually rendered. */
export function pickAnchor(
  anchors: Record<string, StatTrakAnchorSet | undefined>,
  model: string,
  legacy: boolean,
): { anchor: StatTrakAnchor; knife: boolean } | null {
  const entry = anchors[model];
  if (!entry) return null;
  // Fall back across variants rather than dropping the module: a missing
  // legacy anchor (the Zeus has none) is better served by the HD one a few
  // hundredths of an inch away than by no module at all.
  const anchor = (legacy ? entry.legacy ?? entry.hd : entry.hd ?? entry.legacy) ?? null;
  return anchor ? { anchor, knife: entry.knife } : null;
}
