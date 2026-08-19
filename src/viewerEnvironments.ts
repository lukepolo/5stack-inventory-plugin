// Named lighting rigs for the 3D viewer.
//
// A skin does not look like one thing. A fade reads differently in a bright
// showcase than under the flat light of a map, and which one is "right" is the
// argument the community actually has — so this makes the rig a setting rather
// than a constant.
//
// WHY THIS IS SO SMALL: `ViewerOpts.lighting` already existed, as a calibration
// hook for tools/shadertest, and nothing in production ever passed it. Every
// number here goes through that same seam. No light is added, moved, renamed or
// restructured, which matters because the inspect-motion code rotates the rig as
// a group at render time and references those lights by name.
//
// `studio` IS the calibrated default, value for value — see the long comment
// above the rig in viewer3d.ts for how those five numbers were closed against
// both the CDN weapon targets and a charm against csgoskins. It is spelled out
// rather than left as an absent override so that "which rig am I looking at" has
// an answer on every preset including the default one, and so a future re-tune
// changes one table instead of hunting `?? 0.35` literals.

/** The five intensities `ViewerOpts.lighting` accepts, plus where the HDRI faces. */
export interface ViewerEnvironment {
  key: string;
  label: string;
  /** One line, shown under the picker. Says what it is FOR, not what it does. */
  hint: string;
  lighting: { env: number; key: number; rim: number; ambient: number; spot: number };
  /**
   * Y rotation of the environment map, in radians.
   *
   * The HDRI is a real place, so this decides where the sun and the bright sky
   * sit in every reflection — it is the difference between a highlight raking
   * across a slide and sitting flat on it. 3.8 is what csgoskins use and what the
   * default was calibrated against.
   */
  envRotation: number;
}

/**
 * THE canonical rig. Card bakes and the /admin/tests sweep pin to this one and
 * ignore the user's choice — a baked card is cached forever against its render
 * key, so a preset baked into it would give everyone a grid of cards lit
 * differently with no way to tell why. Exactly the argument that already forces
 * bloom off for bakes.
 *
 * SEPARATE from DEFAULT_ENVIRONMENT below, and it has to stay that way. These
 * were one constant until the viewer default moved to Showcase; moving the pin
 * with it would have re-baked new cards under Showcase while every card already
 * on disk kept its Studio lighting — and the render key carries the extraction
 * version, not the rig, so nothing would ever invalidate the old ones. The grid
 * would be permanently half-lit one way and half the other, which reads as a
 * rendering bug rather than a settings change.
 */
export const BAKE_ENVIRONMENT = "studio";

/**
 * What a LIVE viewer opens under when the user has not picked. Showcase: the
 * brighter rig with the harder overhead spot, because most people open the 3D
 * view to look at a skin rather than to grade it. Judging a finish is what
 * Studio is for, and it is one click away.
 */
export const DEFAULT_ENVIRONMENT = "showcase";

export const VIEWER_ENVIRONMENTS: ViewerEnvironment[] = [
  {
    key: "studio",
    label: "Studio",
    hint: "The calibrated rig every card is baked under. Neutral, and the one to judge a finish by.",
    lighting: { env: 0.8, key: 1.15, rim: 0.35, ambient: 0.12, spot: 1.2 },
    envRotation: 3.8,
  },
  {
    key: "showcase",
    label: "Showcase",
    hint: "Brighter, with a harder overhead spot — flatters chrome and gems, and blows out a pale finish.",
    lighting: { env: 1.05, key: 1.45, rim: 0.55, ambient: 0.16, spot: 1.9 },
    envRotation: 3.8,
  },
  {
    key: "warm",
    label: "Warm",
    hint: "Low sun raking across the item. Strong rim, weak fill — reads the way a skin does on a sunlit map.",
    lighting: { env: 0.7, key: 1.25, rim: 0.8, ambient: 0.1, spot: 0.7 },
    // A quarter turn off the default so the bright side of the HDRI comes in
    // from the side rather than over the shoulder, which is what makes a rake.
    envRotation: 2.2,
  },
  {
    key: "dark",
    label: "Dark",
    hint: "Almost no fill. Only what is genuinely emissive or specular survives — where glitter and holo actually show.",
    lighting: { env: 0.32, key: 0.55, rim: 0.28, ambient: 0.04, spot: 0.9 },
    envRotation: 3.8,
  },
];

/**
 * Resolve a stored key, falling back to the canonical rig.
 *
 * Total on purpose: the value comes out of localStorage, so a key from a build
 * that offered a preset this one does not must degrade to Studio rather than
 * render an unlit model.
 */
export function viewerEnvironment(key: string | null | undefined): ViewerEnvironment {
  return (
    VIEWER_ENVIRONMENTS.find((e) => e.key === key) ??
    VIEWER_ENVIRONMENTS.find((e) => e.key === BAKE_ENVIRONMENT)!
  );
}
