// CS2's per-weapon first-person inspect, as a three AnimationClip.
//
// The JSON these read comes from `scripts/extract-viewmodel-anims.mjs`, which
// decodes `animation/anims/viewmodel/<family>/<weapon>/lookat01_*.vnmclip_c`.
// See tools/nmclip.mjs for what a clip contains; the short version is that ONE
// clip drives the arms AND the weapon —
//
//   wpn wpnEnd wpnTip wpnHand_L wpnHand_R      the weapon
//   arm_upper_R arm_lower_R hand_R finger_*    the arm holding it
//   root_motion                                the viewmodel's sway
//
// — which is the whole reason a real first-person view is possible. The gun is
// not parented to a hand and hoped for; it is animated alongside it by the same
// clip, exactly as the game does it.
//
// UNITS ARE SOURCE UNITS, NOT METRES. Bone-local translations come out as
// authored (a forearm is ~11.08 long, i.e. inches), matching the bone-local
// values inside the glove GLBs — both trees put the inch→metre conversion on
// the model's ROOT node rather than in the bones. So these tracks drop straight
// onto the glove skeleton with no scaling, and anything reading the weapon
// track has to apply that root transform itself.
import { getAssetOrigin, withAssetVersion } from "./api";

/** One track as the extractor writes it: either constant, or keyed. */
interface RawTrack {
  /** Key times in seconds. Absent means the track never moves. */
  t?: number[];
  /** Flat values — 4 per key for rotations, 3 for positions. */
  v: number[];
}

/** A sound the clip asks for — taken from the .vnmclip's own event track. */
export interface ClipCue {
  /** Seconds into the clip. */
  t: number;
  /**
   * Path under `/anims/sfx/`, WITH its extension — `ak47/ak47_01.wav`,
   * `aug/aug_clipout.mp3`, `_shared/movement1.wav`. The game ships the shots as
   * PCM and most of the foley as MP3, and the extractor keeps each as it came.
   */
  file: string;
}

export interface RawClip {
  source: string;
  duration: number;
  /** Clip-skeleton hierarchy, `bone -> parent`. See nmclip.mjs. */
  parents?: Record<string, string>;
  bones: Record<string, { rot?: RawTrack; pos?: RawTrack }>;
  /** Sound cues, in clip order. Absent on a clip that asks for none. */
  sounds?: ClipCue[];
  /** Fire clips only: the weapon's cycle time in seconds and whether holding
   *  the trigger keeps firing — both from scripts/weapons.vdata. */
  cycle?: number;
  auto?: boolean;
}

export interface ViewmodelClip {
  clip: import("three").AnimationClip;
  duration: number;
  /** Every bone the clip drives, whether or not the rig has one. */
  bones: string[];
  /** `bone -> parent`, already retargeted. Empty for an older extraction. */
  parents: Record<string, string>;
}

/**
 * In-flight and completed fetches, keyed by model.
 *
 * A clip is ~300KB of JSON and the same weapon is opened repeatedly (2D↔3D
 * flips, wear edits, a slot revisited). Unbounded on purpose: there are 57 of
 * them and a session touches a handful, so an LRU would be machinery guarding
 * against a case that does not arise.
 */
const cache = new Map<string, Promise<RawClip | null>>();

/**
 * The clip format's own version, in the URL.
 *
 * `withAssetVersion` stamps the EXTRACTION version, which is right for models
 * and textures — they change when an extraction runs. These files also change
 * when the EXTRACTOR's output SHAPE changes, which is a different event: adding
 * the `parents` map rewrote every clip while the extraction version stood
 * still, so every browser kept serving the old shape from cache and the new
 * field silently read as absent. Bump this whenever the JSON's shape changes.
 *
 * 2 — added `parents` (the clip skeleton's hierarchy).
 * 3 — one file per ACTION: `<model>.<action>.json`.
 * 4 — `sounds` cues on each action; sfx/ and fx/ assets alongside.
 * 5 — sound files keep their shipped format (.wav/.mp3, named in the cue);
 *     fire clips carry `cycle`/`auto` from scripts/weapons.vdata.
 */
const CLIP_SCHEMA = 5;

/**
 * A URL under the viewmodel asset tree — clips, their sounds, the effect
 * textures — stamped with both the extraction version and the clip schema.
 * Everything here is produced by the same extractor and changes together, so it
 * shares the one cache key.
 */
export function viewmodelAssetUrl(rel: string): string {
  // `&` CANNOT BE ASSUMED. withAssetVersion is a NO-OP until the catalog lands
  // (an unversioned URL is correct, it just revalidates), so appending `&c=…`
  // to its result produced `muzzleflash1.png&c=5` — not a query at all, a
  // different FILENAME, and a 404 on every viewmodel asset fetched before the
  // catalog resolved. It reads as "the flash does not render".
  const url = withAssetVersion(`${getAssetOrigin()}/anims/${rel}`);
  return `${url}${url.includes("?") ? "&" : "?"}c=${CLIP_SCHEMA}`;
}

/**
 * What a viewmodel can be doing.
 *
 * `idle` is the resting pose and the DEFAULT — it is a single static keyframe,
 * which is exactly how the game holds a weapon when you are not doing anything
 * to it. The inspect was the default here for a while and it is a poor one: it
 * holds the gun up and turned, filling the frame, which reads as broken
 * framing rather than as a pose.
 */
export type ClipAction = "idle" | "inspect" | "draw" | "reload" | "fire";

function clipUrl(model: string, action: ClipAction): string {
  return viewmodelAssetUrl(`${encodeURIComponent(model)}.${action}.json`);
}

/**
 * Fetch a weapon's inspect clip. Null when it has none.
 *
 * Null is a NORMAL answer, not an error: the extraction covers the weapons CS2
 * ships viewmodel animations for, and anything else (a future model, an item
 * that is not held) simply has no first person. The caller falls back to the
 * item view rather than failing the mount.
 */
export function loadViewmodelClip(model: string, action: ClipAction = "idle"): Promise<RawClip | null> {
  const key = `${model}.${action}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(clipUrl(model, action))
    .then((r) => (r.ok ? (r.json() as Promise<RawClip>) : null))
    .catch(() => null)
    // A failed fetch is not cached as a permanent no: a 404 while an extraction
    // is mid-run would otherwise pin this weapon to "no animation" for the rest
    // of the session.
    .then((v) => {
      if (!v) cache.delete(key);
      return v;
    });
  cache.set(key, p);
  return p;
}

/**
 * Clip bone → glove-rig bone. Null means "drop this track".
 *
 * THE TWO SKELETONS ARE NOT THE SAME RIG, and the overlap in names is a trap.
 * Measured from the clip's own joint tree:
 *
 *   clip                              glove GLB
 *   root_motion                       (none — synthesised, see buildArms)
 *     armUpperShoulder_R      <──>    arm_upper_R      the real upper arm
 *       arm_lower_R           <──>    arm_lower_R
 *         hand_R              <──>    hand_R
 *           finger_*          <──>    finger_*
 *           attachHand_R              (none)
 *       armUpperStraighten_0_R        (none)
 *         arm_upper_R         ──╳     NOT the glove's arm_upper_R
 *
 * The clip's `arm_upper_R` is a LEAF helper hanging off a straightening joint,
 * a sibling of the forearm — nothing like the glove's upper arm, which is the
 * forearm's parent. Binding the two by name drove the shoulder with a twist
 * helper's values and threw the arms across the screen. So the real upper arm
 * is `armUpperShoulder_*`, and the clip's own `arm_upper_*` must be dropped
 * BEFORE it can collide with the name it happens to share.
 */
export function retargetBone(bone: string): string | null {
  const shoulder = /^armUpperShoulder_([LR])$/.exec(bone);
  if (shoulder) return `arm_upper_${shoulder[1]}`;
  // Helpers with no counterpart. `arm_upper_*` is listed here deliberately: it
  // is the one name that exists in both rigs and means something different in
  // each, so leaving it out would silently reintroduce the bug above.
  //
  // `attachHand_*` is NOT dropped: it is the hand-side half of CS2's IK pair
  // (`wpnHand_*` on the weapon is the other), and keeping it is what lets the
  // grip be measured — and, later, solved.
  if (/^(arm_upper_[LR]|armUpperStraighten_0_[LR])$/.test(bone)) return null;
  return bone;
}

/**
 * Turn the raw tracks into a clip three can play.
 *
 * Track names are `<bone>.quaternion` / `<bone>.position`, which is what
 * three's PropertyBinding resolves against the mixer root by NAME — so a track
 * for a bone the rig does not have is dropped by three with a warning rather
 * than throwing, and the arm and finger names match the glove GLBs exactly.
 */
export function buildViewmodelClip(
  THREE: typeof import("three"),
  raw: RawClip,
  /** Bones to skip — the caller's rig has no node for them. */
  skip?: (bone: string) => boolean,
): ViewmodelClip {
  const tracks: import("three").KeyframeTrack[] = [];
  const bones: string[] = [];

  for (const [raw_name, tr] of Object.entries(raw.bones)) {
    const bone = retargetBone(raw_name);
    if (!bone) continue;
    bones.push(bone);
    if (skip?.(bone)) continue;
    // A constant track still has to be a track: leaving the bone alone would
    // let whatever the previous clip or the bind pose put there show through,
    // and "the value never changes" is a statement about this clip, not a
    // licence for another one to win.
    const emit = (t: RawTrack, prop: string, width: number) => {
      const times = t.t ?? [0];
      const values = t.t ? t.v : t.v.slice(0, width);
      const name = `${bone}.${prop}`;
      tracks.push(
        prop === "quaternion"
          ? new THREE.QuaternionKeyframeTrack(name, times, values)
          : new THREE.VectorKeyframeTrack(name, times, values),
      );
    };
    if (tr.rot) emit(tr.rot, "quaternion", 4);
    if (tr.pos) emit(tr.pos, "position", 3);
  }

  // Retarget the hierarchy the same way the tracks were, so a carrier built
  // from it hangs where the clip says — `wpnHand_L` under `wpn`, not loose.
  const parents: Record<string, string> = {};
  for (const [child, parent] of Object.entries(raw.parents ?? {})) {
    const c = retargetBone(child);
    const p = retargetBone(parent);
    if (c && p) parents[c] = p;
  }

  const clip = new THREE.AnimationClip(raw.source.replace(/^.*\//, ""), raw.duration, tracks);
  return { clip, duration: raw.duration, bones, parents };
}
