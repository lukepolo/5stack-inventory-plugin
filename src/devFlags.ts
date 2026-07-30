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
  /** Grouping in the HUD. */
  group: "3D viewer" | "Patches" | "Diagnostics";
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
  for (const f of FLAGS) {
    try {
      localStorage.removeItem(key(f.name));
    } catch {
      /* ignore */
    }
  }
  flagsVersion.value++;
}

/** Flags currently differing from their default — what the HUD badge counts. */
export const activeFlags = (): DevFlag[] => FLAGS.filter((f) => flagValue(f.name) !== f.dflt);

/**
 * Whether the developer cog is offered at all.
 *
 * Always on a dev host. Everywhere else it stays hidden until someone turns it
 * on from the admin console — the flags below it change how the 3D viewer
 * renders, and a player who finds "Flip patch V" has only found a way to make
 * their own inventory look broken.
 */
const DEV_TOOLS_KEY = "inventory.devTools";
export const devToolsVersion = ref(0);

/**
 * "Development" for this app is the HOST, not the build mode.
 *
 * `import.meta.env.DEV` is false in the local loop too — `npm run dev` here is
 * `vite build` plus a static server, because the plugin is consumed through
 * Module Federation and has to be built to be loadable at all. So the flag that
 * looks like it means "running locally" is false exactly where you want the cog
 * most. The served hostname is the signal that actually distinguishes the two.
 */
function isDevHost(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local");
  } catch {
    return false;
  }
}

export function devToolsEnabled(): boolean {
  if (isDevHost()) return true;
  try {
    return localStorage.getItem(DEV_TOOLS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevToolsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_TOOLS_KEY, "1");
    else localStorage.removeItem(DEV_TOOLS_KEY);
  } catch {
    /* ignore */
  }
  devToolsVersion.value++;
}
