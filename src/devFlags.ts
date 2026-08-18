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
    remount: true,
    group: "3D viewer",
    audience: "user",
  },
  {
    name: "inspectanim",
    label: "Motion",
    hint: "Play the weapon's own inspect animation in the 3D viewer instead of turning it on a turntable. Item cards are always rendered from the still pose.",
    dflt: true,
    remount: true,
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
];

const key = (name: string) => `viewer3d.${name}`;

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
