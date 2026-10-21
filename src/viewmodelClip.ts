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
  /**
   * The WEAPON's own skeleton, as the same clip animates it — `weapon_offset`
   * and the moving parts, in the weapon GLB's bone-local space (inches, like
   * every other track). On a knife this is the blade's facing in the fist and
   * the whole of a butterfly's flip; see buildPropClip. Absent on an older
   * extraction.
   */
  prop?: {
    /** `weapons/<name>` — which prop skeleton these tracks were authored on. */
    skeleton: string;
    bones: Record<string, { rot?: RawTrack; pos?: RawTrack }>;
    parents?: Record<string, string>;
  };
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
 * 6 — `prop`: the weapon's own skeleton tracks (tools/nmclip-data.mjs).
 * 7 — no shape change: a RE-KEY. 6 went live before the files carrying `prop`
 *     were on the mount, and a `?v=` URL is served immutable for a year
 *     (nginx.conf) — so every browser that opened a knife in that window
 *     pinned the OLD shape under the NEW key, and its inspect played with the
 *     knife frozen while a fresh fetch of the same URL had the tracks. Bump this
 *     only once the data it describes is already on the mount.
 * 8 — a RE-KEY again, for the C4's own clips (equipment/c4, no reload or
 *     shot) and the rare inspects (inspect2/inspect3) with the index.json
 *     that lists them. A scoped `step viewmodel-anims` changes those files
 *     without changing the extraction stamp, so the version half of the key
 *     stayed put and browsers kept the rifle-held C4 they had cached. Bumped
 *     after the step had run (2026-10-21).
 */
const CLIP_SCHEMA = 8;

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
export type ClipAction = "idle" | "inspect" | "inspect2" | "inspect3" | "draw" | "reload" | "fire" | "fire2";
/**
 * The inspect and its rarer variants, in the order a repeated press steps
 * through them. `inspect2`/`inspect3` are the game's lookat02/lookat03 — the
 * Deagle's spin, the AK's, a knife's second trick — and most weapons have
 * neither; the clip index says which (see viewmodelActions).
 */
export const INSPECTS: readonly ClipAction[] = ["inspect", "inspect2", "inspect3"];

/**
 * What the game lets you do with an item in hand, where that is LESS than the
 * clips on the mount say.
 *
 * The C4 is the case this exists for. Extractions before it had its own entry
 * in the folder table gave it the generic rifle's clips (`_default_rifle`), so
 * the mount holds a reload and a shot for a bomb — the files outlive the
 * mistake, and a viewer that trusted them offered both. The Zeus is
 * single-shot: it fires, and recharges rather than reloading.
 */
const CANNOT: Record<string, ClipAction[]> = {
  c4: ["fire", "reload"],
  taser: ["reload"],
};

let actionIndex: Promise<(Record<string, Partial<Record<ClipAction, unknown>>> & { _built?: string }) | null> | null = null;
/**
 * The clip index, revalidated rather than trusted from cache.
 *
 * Every other /anims/ URL is served immutable, keyed on the extraction stamp
 * and CLIP_SCHEMA — and a scoped `step viewmodel-anims` changes clips without
 * changing either, so browsers kept the C4's rifle clips until CLIP_SCHEMA was
 * bumped by hand. The index is small and says when it was written (`_built`),
 * so it is asked for with `no-cache` (a conditional request, a 304 when
 * nothing changed) and the clips are keyed on that time.
 */
function loadActionIndex() {
  actionIndex ??= fetch(viewmodelAssetUrl("index.json"), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => {
      // Not cached as a permanent no — see loadViewmodelClip.
      if (!v) actionIndex = null;
      return v;
    });
  return actionIndex;
}
/**
 * The actions this model's clips cover, from the extractor's `index.json`.
 *
 * Knives ship no shot and no reload, the Zeus no reload, the C4 neither — and
 * a button whose press finds no clip does nothing at all, which reads as
 * broken. Null while the index is unknown (an older mount, a failed fetch):
 * the caller then offers everything but what CANNOT rules out, as it did
 * before the index was read.
 */
export async function viewmodelActions(model: string): Promise<Set<ClipAction> | null> {
  const index = await loadActionIndex();
  const listed = model === "_built" ? undefined : index?.[model];
  if (!listed) return null;
  const out = new Set(Object.keys(listed) as ClipAction[]);
  for (const a of CANNOT[model] ?? []) out.delete(a);
  return out;
}
/** The same rule with nothing fetched — for a button row that has to draw now. */
export function viewmodelCannot(model: string, action: ClipAction): boolean {
  return (CANNOT[model] ?? []).includes(action);
}

function clipUrl(model: string, action: ClipAction, built: string | null): string {
  const url = viewmodelAssetUrl(`${encodeURIComponent(model)}.${action}.json`);
  return built ? `${url}&a=${encodeURIComponent(built)}` : url;
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
  const p = loadActionIndex()
    .then((index) => fetch(clipUrl(model, action, typeof index?._built === "string" ? index._built : null)))
    .then((r) => (r.ok ? (r.json() as Promise<RawClip>) : null))
    .catch(() => null)
    // NO IDLE IS NOT NO FIRST PERSON. Idle is what the mount asks for, so a
    // missing one dropped the weapon onto the clipless fallback, which frames a
    // different rig — every knife opened looking at an empty room with the
    // blade clipped into a corner, because extractions before the `idle1_` fix
    // wrote no knife idle at all. A draw ENDS at the ready pose (measured
    // against the real idles: wpn identical, arms within 2°), so its last frame
    // is the idle in everything but the breathing.
    .then((v) => v ?? (action === "idle" ? loadViewmodelClip(model, "draw").then((d) => d && finalPose(d)) : null))
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
 * A clip's LAST frame as a still clip of its own — zero duration, every track
 * constant, no sounds — which the rig holds exactly as it holds a real idle.
 */
function finalPose(raw: RawClip): RawClip {
  const last = (t: RawTrack | undefined, width: number): RawTrack | undefined =>
    t && { v: t.t ? t.v.slice(-width) : t.v.slice(0, width) };
  const still = (from: RawClip["bones"]) => {
    const bones: RawClip["bones"] = {};
    for (const [bone, tr] of Object.entries(from)) bones[bone] = { rot: last(tr.rot, 4), pos: last(tr.pos, 3) };
    return bones;
  };
  return {
    source: `${raw.source}#end`,
    duration: 0,
    parents: raw.parents,
    bones: still(raw.bones),
    // The knife's own pose rides along — a draw ends with the blade where the
    // idle holds it, and that is half of what the fallback is for.
    ...(raw.prop ? { prop: { ...raw.prop, bones: still(raw.prop.bones) } } : {}),
  };
}

/**
 * The weapon's own skeleton tracks as a clip for the WEAPON's mixer.
 *
 * Same track format and the same clock as the arm clip (the extractor keys
 * both on the DMX's frame times), so the two can be started together and stay
 * locked without any time-scaling. `weapon` is left out: it is the attachment
 * root, and the seat already puts it on the clip's `wpn` (see fpvUnbake) — the
 * prop skeleton states it at its own origin, and taking that track would move
 * the bone the seat was measured against. Bones the GLB has no node for are
 * skipped rather than handed to three to warn about.
 *
 * Null when the clip carries no prop tracks (an older extraction) or none of
 * them land on this model.
 */
export function buildPropClip(
  THREE: typeof import("three"),
  raw: RawClip,
  has: (bone: string) => boolean,
): import("three").AnimationClip | null {
  if (!raw.prop) return null;
  const tracks: import("three").KeyframeTrack[] = [];
  for (const [bone, tr] of Object.entries(raw.prop.bones)) {
    if (bone === "weapon" || !has(bone)) continue;
    if (tr.rot) {
      const times = tr.rot.t ?? [0];
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, tr.rot.t ? tr.rot.v : tr.rot.v.slice(0, 4)));
    }
    if (tr.pos) {
      const times = tr.pos.t ?? [0];
      tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times, tr.pos.t ? tr.pos.v : tr.pos.v.slice(0, 3)));
    }
  }
  if (!tracks.length) return null;
  return new THREE.AnimationClip(`prop:${raw.source.replace(/^.*\//, "")}`, raw.duration, tracks);
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
