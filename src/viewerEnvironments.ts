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
  /**
   * A BAKED CS2 SCENE, if this rig is one.
   *
   * The panorama under `/anims/env/<map>.jpg` — see scripts/extract-map-envs.mjs
   * and tools/shadertest/envbake.ts. When present the viewer lights the item
   * with it and draws it behind the model; when absent (the four studio rigs)
   * the shared HDRI does the lighting and nothing is drawn behind.
   *
   * A missing file is not an error: the viewer keeps the HDRI and the item
   * still renders, which is the right answer for an instance whose extraction
   * has not run yet.
   */
  scene?: string;
  /**
   * The BACKDROP, as a picture.
   *
   * `scene` is an equirect panorama and it is the right shape for lighting —
   * but the viewer only ever shows a ~42 degree slice of it, so a 4096-wide
   * sphere hands about 480 pixels to a 1400-pixel pane and the wall behind the
   * weapon looks blocky. This is that same view rendered directly at full
   * resolution, from the camera CS2 itself frames a weapon with in that scene.
   */
  plate?: string;
}

/**
 * CS2's OWN VANITY SCENES, as environments.
 *
 * Every map ships a `<map>_vanity.vpk` — the diorama the game shows behind your
 * character and your items — and each one is baked into a panorama from the
 * scene's own `csgo_item_previewmodel` marker: the exact spot the game displays
 * an item at, lit by that map's own sky. So "show me this knife on Mirage" is
 * not a stylised backdrop, it is where the game would put it.
 *
 * The lighting numbers are deliberately flatter than the studio rigs: the
 * panorama IS the light here, so the artificial lamps step back and let it do
 * the work rather than double-lighting the model from two directions at once.
 */
const MAP_SCENES: { map: string; label: string; hint: string }[] = [
  { map: "de_mirage", label: "Mirage", hint: "The A-site courtyard, mid-morning — warm stone and a hard sun." },
  { map: "de_dust2", label: "Dust II", hint: "Bright sand and a pale sky. Flattens dark finishes; the one most people picture." },
  { map: "de_inferno", label: "Inferno", hint: "Close walls and warm brick — soft light, little sky." },
  { map: "de_nuke", label: "Nuke", hint: "Cold concrete and steel under an overcast sky." },
  { map: "de_ancient", label: "Ancient", hint: "Jungle green, heavily shaded — reads dark, and shows emissives." },
  { map: "de_ancient_night", label: "Ancient (night)", hint: "The same site after dark: almost no fill, only what glows." },
  { map: "de_anubis", label: "Anubis", hint: "Sunlit sandstone by the water — strong bounce from below." },
  { map: "de_overpass", label: "Overpass", hint: "Grey daylight under concrete. Neutral, close to a studio rig." },
  { map: "de_train", label: "Train", hint: "Overcast yard light with cold steel around the item." },
  { map: "de_vertigo", label: "Vertigo", hint: "Open sky at altitude — bright above, dark below." },
  { map: "de_cache", label: "Cache", hint: "Industrial daylight, strong sun, hard shadows." },
  { map: "cs_office", label: "Office", hint: "Interior fluorescents and snow through the windows." },
  { map: "cs_italy", label: "Italy", hint: "Warm plaster and afternoon sun." },
  { map: "ar_baggage", label: "Baggage", hint: "Interior hangar light, even and neutral." },
  { map: "warehouse", label: "Warehouse", hint: "The training scene — flat, even, and very neutral." },
];

const mapEnvironment = ({ map, label, hint }: (typeof MAP_SCENES)[number]): ViewerEnvironment => ({
  key: `map:${map}`,
  label,
  hint,
  /**
   * Env-led, and turned UP.
   *
   * The scene carries the light here, so the lamps only shape highlights — but
   * the panorama is an LDR JPEG, where the sun is 1.0 like everything else,
   * while the studio HDRI carries a sun several times brighter than white.
   * Matching its numbers left every map rig looking like dusk. The environment
   * is scaled to make up the range, and the key light keeps a little presence
   * so the model still has a direction to it.
   */
  lighting: { env: 2.4, key: 0.8, rim: 0.45, ambient: 0.14, spot: 0.6 },
  // The panorama is a real place with the sun where the map's sun is, so it
  // starts unrotated — turning it would move the sun off the buildings casting
  // the shadows in the picture.
  envRotation: 0,
  scene: `/anims/env/${map}.jpg`,
  plate: `/anims/env/${map}.plate.jpg`,
});

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
  // The CS2 map scenes are PARKED, not removed: the bakes are not yet good
  // enough to stand behind (flat-albedo lighting reads as CS:GO, the lightmap
  // application is still being worked out), and an entry here is a promise the
  // picker makes to every instance. Re-enable when the bake earns it.
  // ...MAP_SCENES.map(mapEnvironment),
];
void mapEnvironment;

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
