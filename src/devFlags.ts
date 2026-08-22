/**
 * Developer flags — one registry, so the HUD and the viewer agree.
 *
 * These started as `?name=1` query params read straight out of localStorage
 * wherever they were needed. That worked while there were two of them. It stops
 * working once there are seven: nothing lists what exists, nothing says what a
 * flag DOES, and finding out means grepping for `debugFlag(` and reading the
 * comment above each call. Turning one on means editing the URL, and turning it
 * off again means remembering you left it on — which is how you end up measuring
 * a run with `?patchboxes=1` still set.
 *
 * So the flags declare themselves here, and the HUD renders the declaration.
 * viewer3d.ts still reads them through the same `debugFlag()` it always did; the
 * only change is that the name has to exist in FLAGS to be listed.
 *
 * STORAGE IS UNCHANGED — `viewer3d.<name>` in localStorage, and `?name=1` still
 * sets it. A shared debug URL from before this file keeps working.
 */
import { ref } from "vue";
import { DEFAULT_ENVIRONMENT, VIEWER_ENVIRONMENTS } from "./viewerEnvironments";

export interface DevFlag {
  /** The `?name=1` param and the localStorage suffix. */
  name: string;
  /** What the HUD shows. */
  label: string;
  /** One line: what turning this on actually does. */
  hint: string;
  /** Applies when the switch has never been touched. */
  dflt: boolean;
  /**
   * Whether a live viewer picks this up, or it needs a remount.
   *
   * Most of these are read once at module load or at mount, so flipping them
   * mid-session changes nothing until the model is rebuilt. Saying so in the HUD
   * is the difference between "this toggle is broken" and "reopen the item".
   *
   * ABSENT MEANS "NEEDS A REMOUNT" — the HUD asks `remount !== false`, so a flag
   * that says nothing gets the reload prompt. That is the safe way round: the
   * only cost of an unnecessary prompt is a reload, while a flag wrongly marked
   * live is a control that silently does nothing and no longer admits it. So
   * `remount: false` is a claim about the viewer, and only three of these make
   * it — see the live setters in viewer3d.ts.
   */
  remount?: boolean;
  /** Grouping in the panel. */
  group: "3D viewer" | "Patches" | "Diagnostics";
  /**
   * Who this is for.
   *
   * "user" settings are shown plainly to everyone and are safe to leave in any
   * position — they change how the viewer LOOKS. "developer" ones live behind the
   * Advanced disclosure because most of them make a correct render look broken,
   * which is a support ticket rather than a preference.
   */
  audience?: "user" | "developer";
}

export const FLAGS: DevFlag[] = [
  {
    name: "charmquads",
    label: "Authored charm surfaces",
    hint: "Use the model's own KeychainMarkup quads: they seat the UNPLACED charm's default spot and bound where a drag may go. A dragged charm goes wherever you point on the body inside that box. Off drops both, which is where default charms used to float.",
    dflt: true,
    remount: true,
    group: "3D viewer",
    audience: "developer",
  },
  {
    name: "pricelog",
    label: "Log the price path",
    hint: "Prints one console line per step of the price pipeline — what was armed, what request went out, what came back and whether it was kept. The figure and its readings arrive from three different calls, and when one of them goes missing this says which.",
    dflt: false,
    group: "3D viewer",
    audience: "developer",
  },
  {
    name: "fpvhud",
    label: "Viewmodel readout",
    hint: "Draws the copyable line of first-person dials over the model. It is a tuning instrument — the numbers only mean anything while you are dialling the pose in — so it is off unless you are. Needs a remount: the readout is built with the first-person rig.",
    dflt: false,
    remount: true,
    group: "3D viewer",
    audience: "developer",
  },
  {
    name: "charmmap",
    label: "Show the charm quads",
    hint: "Paint the game's authored charm surfaces on the weapon (debug). They no longer restrict a drag — placement is free inside their bounding box — but they seat the unplaced default, and this shows whether they sit on the rendered mesh.",
    dflt: false,
    remount: true,
    group: "3D viewer",
    audience: "developer",
  },
  {
    name: "patchboxes",
    label: "Patch footprints",
    hint: "Paint every patch position as a flat colour instead of its art — slot 1 red, 2 green, 3 blue.",
    dflt: false,
    remount: true,
    group: "Patches",
  },
  {
    name: "patchflipv",
    label: "Flip patch V",
    hint: "Mirror patch offsets vertically. Off matches the shader; on is the comparison.",
    dflt: false,
    remount: true,
    group: "Patches",
  },
  {
    name: "uvdecal",
    label: "UV-space stickers",
    hint: "Cut stickers out of TEXCOORD_1 rather than projecting them. On is how the game does it.",
    dflt: true,
    remount: true,
    group: "3D viewer",
  },
  {
    name: "bloom",
    label: "Bloom",
    hint: "A soft glow on the brightest parts of a skin. Applies to the 3D viewer; item cards are always rendered without it.",
    dflt: true,
    // Live: the viewer builds and frees the composer on the switch. Stated as
    // `false` rather than left out, because ABSENT MEANS "needs a remount" — the
    // HUD reads `remount !== false` — and the three sliders under this one were
    // always live, so a group where the dials moved and the switch above them
    // asked you to reopen the item was the whole complaint.
    remount: false,
    group: "3D viewer",
    audience: "user",
  },
  {
    name: "inspectanim",
    label: "Motion",
    hint: "Play a model's own inspect animation in the 3D viewer instead of turning it on a turntable — where it has one, which measurement says is nowhere in the weapon tree: every weapon's inspect clip is a single static keyframe. Item cards are always rendered from the still pose.",
    dflt: true,
    // Live: the clip drives the camera and the light rig, never the mesh, so the
    // viewer makes and unmakes a mixer instead of being rebuilt. Explicit for the
    // same reason as bloom above — absent reads as "needs a remount".
    remount: false,
    group: "3D viewer",
    audience: "user",
  },
  {
    name: "notwist",
    label: "Disable the twist solver",
    hint: "Stop distributing forearm roll onto the _TWIST helper bones. A diagnostic: if a wrung-out arm looks the SAME with this on, the solver is not what is wringing it.",
    dflt: false,
    remount: true,
    group: "Diagnostics",
  },
  {
    name: "pivotdot",
    label: "Show the orbit pivot",
    hint: "Draw a dot at the point a drag rotates around, through the model. If it is not sitting on the item, that is why dragging feels like it is swinging the model rather than turning it.",
    dflt: false,
    remount: true,
    group: "Diagnostics",
  },
  {
    name: "fpvsound",
    label: "Weapon sounds",
    hint: "Play the weapon's own sounds in first person — the shot, the mag out and in, the bolt — at the moments the game's animation asks for them.",
    dflt: true,
    // Live: the flag is read at the moment a cue fires, nothing is built on it.
    remount: false,
    group: "3D viewer",
    audience: "user",
  },
  {
    name: "perf",
    label: "Perf HUD",
    hint: "Frame-time split, skinned mesh count and mount cost, drawn over the model.",
    dflt: false,
    remount: true,
    group: "Diagnostics",
  },
  {
    name: "stickerlog",
    label: "Sticker drag log",
    hint: "Console trace of what a press hit, by how much it missed, and each rebuild's cost.",
    dflt: false,
    group: "Diagnostics",
  },
  {
    name: "nameplateprobe",
    label: "Name plate probe",
    hint: "Dump the measured seating of the engraved name plate.",
    dflt: false,
    remount: true,
    group: "Diagnostics",
  },
  {
    name: "compositeverify",
    label: "Verify composites",
    hint: "Re-check the shared composite store against a freshly built texture.",
    dflt: false,
    remount: true,
    group: "Diagnostics",
  },
];

/**
 * A numeric knob, for values that get DIALLED rather than switched.
 *
 * Separate from DevFlag because the UI is different (a slider, with a live
 * readout) and so is the intent: a flag answers "which code path", a number
 * answers "how much". They share the localStorage convention so a debug URL
 * behaves the same for both.
 */
export interface DevNumber {
  name: string;
  label: string;
  hint: string;
  dflt: number;
  min: number;
  max: number;
  step: number;
  group: DevFlag["group"];
  /** Only shown when this flag is on — a bloom slider is noise with bloom off. */
  requires?: string;
  /** See DevFlag.audience. */
  audience?: "user" | "developer";
}

export const NUMBERS: DevNumber[] = [
  // Defaults are the dialled-in set, not three's. The useful range turned out to
  // be the bottom of the slider, so the maxima are tightened and the steps are
  // fine — a 0-2 range at 0.05 steps gave strength exactly one notch of travel
  // between "nothing" and "too much".
  {
    name: "bloomstrength",
    label: "Bloom strength",
    hint: "How much the glow adds. Tiny is the whole trick: csgoskins use 1.2, which at our exposure turns a bright slide solid white.",
    dflt: 0.05, min: 0, max: 0.5, step: 0.01,
    group: "3D viewer", requires: "bloom", audience: "user",
  },
  {
    name: "bloomradius",
    label: "Bloom radius",
    hint: "How far the glow spreads.",
    dflt: 0.3, min: 0, max: 1.5, step: 0.05,
    group: "3D viewer", requires: "bloom", audience: "user",
  },
  {
    name: "bloomthreshold",
    label: "Bloom threshold",
    hint: "How bright a pixel must be to glow, in LINEAR light. Low (~0.2) blooms almost everything a little, which is what reads as the material being luminous; ~1.0 means 'brighter than white' and picks out only specular hits.",
    dflt: 0.18, min: 0, max: 1.5, step: 0.02,
    group: "3D viewer", requires: "bloom", audience: "user",
  },
  // The level of the first-person sounds. ONE DIAL, TWO HANDLES: this knob and
  // the slider beside the fire button in the viewer bar read and write the same
  // stored value, so neither can disagree with what is actually playing. Gated
  // on the sounds flag for the same reason the bloom knobs are gated on bloom.
  // A FIFTH by default — the game's shot samples are authored hot, mixed to sit
  // under a game's own bus, and a first press at full level in a quiet room is a
  // flinch, not a preview. 0.2 is audible on laptop speakers and does not make
  // anyone reach for the system volume; the slider is right there for louder.
  {
    name: "fpvvolume",
    label: "Weapon volume",
    hint: "How loud the first-person sounds play — the shot, the mag, the bolt. The speaker slider in the viewer's own control bar is this same setting.",
    dflt: 0.2, min: 0, max: 1, step: 0.05,
    group: "3D viewer", requires: "fpvsound", audience: "user",
  },
  // First-person tuning. Developer-audience: these TRIM a pose that is already
  // right, and a viewer with no arms in it would show six sliders that move
  // nothing.
  //
  // THE DEFAULTS BELOW ARE THE SHIPPED POSE, dialled in by hand against the
  // real thing and then written down here — yaw -7, pitch -12, offset
  // (0.06, 0.01, 0.12), FOV 54. They are not neutral values waiting to be
  // found; zeroing them puts the weapon back to the raw clip framing, which
  // sits too central and too level to read as a viewmodel.
  //
  // WHY FOV IS 54 AND NOT CS2'S 68: `viewmodel_fov` is roughly a HORIZONTAL
  // measure at 4:3 and three's `fov` is VERTICAL. 68 there works out near 54
  // here — feeding 68 straight in is nearly 100 degrees across, which is what
  // made the weapon look stretched.
  {
    name: "fpvfov",
    label: "Viewmodel FOV",
    hint: "Vertical field of view for the first-person camera, in degrees, letterboxed to 16:9 so it means the same thing whatever shape the pane is. CS2's viewmodel_fov is a HORIZONTAL angle measured at 4:3 and does not transfer directly: its 54-68 range works out as 44-54 here. Larger is wider and distorts more — 68 here is nearly 100 degrees across, which is what made the weapon look stretched.",
    dflt: 54, min: 30, max: 90, step: 1,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvx",
    label: "Viewmodel offset X",
    hint: "Moves the eye right (+) or left (-), in metres, along the camera's own axis.",
    dflt: 0.06, min: -1, max: 1, step: 0.01,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvy",
    label: "Viewmodel offset Y",
    hint: "Raises (+) or lowers (-) the eye, in metres, along the camera's own up axis.",
    dflt: 0.01, min: -1, max: 1, step: 0.01,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvz",
    label: "Viewmodel offset Z",
    hint: "Moves the eye along its own view axis, in metres. Forward (+) is the safe direction: the arms are cut at the shoulder, and pulling BACK drags those cuts into shot.",
    dflt: 0.12, min: -1.5, max: 1.5, step: 0.01,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvyaw",
    label: "Viewmodel yaw",
    hint: "Turns the first-person view left or right, in degrees, FROM the framing the viewer works out for itself. Zero is that framing — these dials trim it, they no longer have to find it.",
    dflt: -7, min: -180, max: 180, step: 1,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvpitch",
    label: "Viewmodel pitch",
    hint: "Tilts the first-person camera up (+) or down (-), in degrees.",
    dflt: -12, min: -90, max: 90, step: 1,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvshiftx",
    label: "Viewmodel frame X",
    hint: "Slides the whole first-person PICTURE across its frame, as a fraction of the frame's width. Positive moves the weapon right. This moves the image, not the eye — the pose, the perspective and the scale are untouched, which is why it is the dial for composition and the offsets above are the dials for the pose.",
    dflt: 0.1, min: -0.5, max: 0.5, step: 0.01,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "fpvshifty",
    label: "Viewmodel frame Y",
    hint: "Slides the first-person picture down (+) or up (-) its frame, as a fraction of the frame's height. Down is what seats the weapon in the corner instead of leaving it floating mid-air.",
    dflt: 0.12, min: -0.5, max: 0.5, step: 0.01,
    group: "3D viewer", audience: "developer",
  },
  {
    name: "idlespin",
    label: "Idle spin delay",
    hint: "How long the item sits still before the turntable starts. Any drag restarts the wait. Zero spins immediately, as it always used to; the whole point of a wait is that the first look at a skin is a still one.",
    dflt: 6, min: 0, max: 30, step: 1,
    group: "3D viewer", audience: "user",
  },
];

const key = (name: string) => `viewer3d.${name}`;

/**
 * THE FIRST-PERSON POSE, RESET ONCE.
 *
 * The six viewmodel dials are stored like every other setting — and while
 * free-look was on, DRAGGING wrote them. That is what the gesture was for, but
 * it means anyone who ever moved the view is pinned to wherever they let go,
 * and the shipped pose (yaw -7, pitch -12, offset 0.06/0.01/0.12) can never
 * reach them: a stored value always beats a default.
 *
 * So the pose carries a version. Bump it and every browser drops its stored
 * dials exactly once, landing on whatever this build ships. Bump it again the
 * next time the shipped pose changes; do NOT bump it for anything else, because
 * this throws away a deliberate setting along with a stale one.
 */
const FPV_POSE_VERSION = "3";
// v3 adds the frame-shift pair: the first-person frame changed shape twice
// today (letterboxed 16:9, then the full pane), and dials tuned against either
// earlier frame land the weapon somewhere else in the current one. The shipped
// defaults ARE the tuned pose; stored leftovers from the tuning sessions are
// what a reset clears.
const FPV_DIALS = ["fpvyaw", "fpvpitch", "fpvfov", "fpvx", "fpvy", "fpvz", "fpvshiftx", "fpvshifty"];
try {
  if (localStorage.getItem(key("fpvpose")) !== FPV_POSE_VERSION) {
    for (const n of FPV_DIALS) localStorage.removeItem(key(n));
    localStorage.setItem(key("fpvpose"), FPV_POSE_VERSION);
  }
} catch {
  // A browser with storage denied has nothing stored to reset.
}

/** Bumped on every write, so the HUD re-renders without polling storage. */
export const flagsVersion = ref(0);

export function flagValue(name: string): boolean {
  const flag = FLAGS.find((f) => f.name === name);
  try {
    const stored = localStorage.getItem(key(name));
    return stored === null ? !!flag?.dflt : stored === "1";
  } catch {
    return !!flag?.dflt;
  }
}

export function setFlag(name: string, on: boolean): void {
  try {
    localStorage.setItem(key(name), on ? "1" : "0");
  } catch {
    /* private mode — the flag just doesn't stick */
  }
  flagsVersion.value++;
}

/**
 * A setting that PICKS ONE OF SEVERAL, for values that are neither a switch nor
 * a dial.
 *
 * The third kind, and the reason it needs its own shape rather than being
 * squeezed into the other two: a flag answers "which code path", a number
 * answers "how much", and this answers "which one" — an enum with labels and its
 * own per-option hint. Encoding four lighting rigs as three booleans would make
 * two of the eight combinations meaningless and the picker unrepresentable.
 *
 * Shares the same `viewer3d.<name>` localStorage convention, so `?name=studio`
 * in a debug URL works exactly like it does for the other two.
 */
export interface DevChoice {
  name: string;
  label: string;
  hint: string;
  dflt: string;
  options: { value: string; label: string; hint?: string }[];
  group: DevFlag["group"];
  /** See DevFlag.remount — and note the picker only prints the note, so leaving
   *  it out here reads as "live" rather than as "needs a remount". State it. */
  remount?: boolean;
  audience?: "user" | "developer";
}

export const CHOICES: DevChoice[] = [
  {
    name: "env",
    label: "Lighting",
    hint: "Which rig the viewer lights an item under. Item CARDS are always baked under Studio, whatever this says — a card is cached against its render key, so a preset baked into one could never be told apart from a bug.",
    dflt: DEFAULT_ENVIRONMENT,
    options: VIEWER_ENVIRONMENTS.map((e) => ({ value: e.key, label: e.label, hint: e.hint })),
    // Live: a preset is five intensities and an env rotation, and the viewer
    // re-assigns them on the lights it already has. It was remount-gated only
    // because the rig was read once at mount, which made picking a preset update
    // this hint and leave the render pixel for pixel identical.
    remount: false,
    group: "3D viewer",
    audience: "user",
  },
];

/** Bumped on every choice write, so the HUD re-renders and the viewer re-reads. */
export const choicesVersion = ref(0);

export function choiceValue(name: string): string {
  const spec = CHOICES.find((c) => c.name === name);
  const dflt = spec?.dflt ?? "";
  try {
    const stored = localStorage.getItem(key(name));
    // Validated against the declared options, not just returned: a value from a
    // build that offered a preset this one dropped has to fall back rather than
    // reach the renderer as an unknown key.
    if (stored && spec?.options.some((o) => o.value === stored)) return stored;
    return dflt;
  } catch {
    return dflt;
  }
}

export function setChoice(name: string, v: string): void {
  try {
    localStorage.setItem(key(name), v);
  } catch {
    /* private mode — the value just does not stick */
  }
  choicesVersion.value++;
}

export const userChoices = (): DevChoice[] => CHOICES.filter((c) => c.audience === "user");
export const devChoices = (): DevChoice[] => CHOICES.filter((c) => c.audience !== "user");

/** Back to defaults, and forget every stored answer. */
export function resetFlags(): void {
  for (const n of NUMBERS) {
    try {
      localStorage.removeItem(key(n.name));
    } catch {
      /* ignore */
    }
  }
  numbersVersion.value++;
  for (const f of FLAGS) {
    try {
      localStorage.removeItem(key(f.name));
    } catch {
      /* ignore */
    }
  }
  flagsVersion.value++;
  for (const c of CHOICES) {
    try {
      localStorage.removeItem(key(c.name));
    } catch {
      /* ignore */
    }
  }
  choicesVersion.value++;
}

/** Bumped on every numeric write, so a slider re-renders and the viewer re-reads. */
export const numbersVersion = ref(0);

export function numberValue(name: string): number {
  const spec = NUMBERS.find((n) => n.name === name);
  const dflt = spec?.dflt ?? 0;
  try {
    const stored = localStorage.getItem(key(name));
    if (stored === null) return dflt;
    const v = Number(stored);
    return Number.isFinite(v) ? v : dflt;
  } catch {
    return dflt;
  }
}

export function setNumber(name: string, v: number): void {
  try {
    localStorage.setItem(key(name), String(v));
  } catch {
    /* private mode — the value just doesn't stick */
  }
  numbersVersion.value++;
}

/** Everything a normal user is offered, in declaration order. */
export const userFlags = (): DevFlag[] => FLAGS.filter((f) => f.audience === "user");
export const userNumbers = (): DevNumber[] => NUMBERS.filter((n) => n.audience === "user");
/** Everything behind Advanced — the default for anything that does not say. */
export const devFlags = (): DevFlag[] => FLAGS.filter((f) => f.audience !== "user");
export const devNumbers = (): DevNumber[] => NUMBERS.filter((n) => n.audience !== "user");

/** Flags currently differing from their default — what the HUD badge counts. */
export const activeFlags = (): DevFlag[] => FLAGS.filter((f) => flagValue(f.name) !== f.dflt);

/**
 * The developer-cog gate USED TO LIVE HERE and is deliberately gone.
 *
 * It answered "should the cog be shown at all", which mattered while everything
 * behind it was a diagnostic that could make a correct render look broken. The
 * panel now separates user settings (bloom) from those diagnostics itself, so the
 * cog is always offered and the gate moved down a level — see DevHud.
 *
 * `isDevHost()` went with it: nothing else asked.
 */
