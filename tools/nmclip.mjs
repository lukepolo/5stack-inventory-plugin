// A CS2 viewmodel animation clip, reduced to bone tracks.
//
// Turns the DMX that Source2Viewer-CLI writes for a `.vnmclip_c` into the only
// thing the viewer wants: per-bone key times, positions and rotations. See
// tools/dmx.mjs for the container format and why any of this is necessary.
//
// WHAT ONE CLIP CONTAINS, measured on `lookat01_ak` (the AK's inspect):
//
//   56 bones · 112 channels · 138 keys · 4.5336s @ 30.22fps
//
//   wpn wpnEnd wpnTip wpnHand_L wpnHand_R        the WEAPON
//   arm_upper_R arm_lower_R hand_R finger_*      the arm that holds it
//   armUpperShoulder_R armUpperStraighten_0_R    helper bones
//   attachHand_R                                 the hand↔weapon attachment
//   root_motion                                  the whole viewmodel's sway
//
// So the weapon and the arms are ONE animation, which is what makes a real
// first-person inspect possible at all: the gun is not parented to a hand and
// hoped for, it is animated alongside it by the same clip.
//
// NAMES MATCH THE GLOVE GLBs for every arm and finger bone, so a track
// retargets by name with no solve. Two mismatches to know about:
//
//   · the clip drives `armUpperShoulder_*` / `armUpperStraighten_0_*` /
//     `attachHand_*`, which the glove export has no bone for — harmless, they
//     are dropped on lookup.
//   · the glove export has `arm_lower_*_TWIST`/`arm_upper_*_TWIST` bones that
//     the clip does NOT drive. CS2 drives those procedurally (roll distributed
//     along the forearm). Left at bind while the wrist rotates they produce the
//     wrung-out "candy wrapper" pinch — so they need solving before this looks
//     right, and that is a known piece of work rather than a surprise.
import { parseDmx } from "./dmx.mjs";

/**
 * A DMX channel is `log → layers[0] → { times, values }`.
 *
 * Layers exist so an animator can stack takes; an exported clip has exactly
 * one, and taking the first is what every other reader of these files does.
 */
function track(channel) {
  const layer = channel?.attrs?.log?.attrs?.layers?.[0];
  if (!layer) return null;
  const times = layer.attrs.times;
  const values = layer.attrs.values;
  if (!Array.isArray(times) || !Array.isArray(values)) return null;
  return { times, values };
}

/**
 * Reduce a parsed clip to `{ duration, frameRate, bones }`.
 *
 * `bones` is keyed by bone name; each entry has whichever of `pos` / `rot` the
 * clip actually animates, as `{ times, values }`. A bone with neither is
 * omitted rather than emitted empty — the consumer should not have to
 * distinguish "not animated" from "animated to nothing".
 */
export function readClip(buf) {
  const doc = parseDmx(buf);
  const clip = doc.elements.find((e) => e.type === "DmeChannelsClip");
  if (!clip) throw new Error("no DmeChannelsClip in this DMX — not an animation?");

  const bones = {};
  for (const ch of clip.attrs.channels ?? []) {
    // `<bone>_p` is position, `<bone>_o` is orientation. The suffix is the only
    // thing that says which; the channel's `toAttribute` agrees, and is checked
    // rather than trusted blindly because a renamed bone ending in "_o" would
    // otherwise be silently read as a rotation track.
    const m = /^(.*)_([po])$/.exec(ch.name ?? "");
    if (!m) continue;
    const [, bone, kind] = m;
    const attr = ch.attrs?.toAttribute;
    if (kind === "p" && attr !== "position") continue;
    if (kind === "o" && attr !== "orientation") continue;
    const t = track(ch);
    if (!t) continue;
    (bones[bone] ??= {})[kind === "p" ? "pos" : "rot"] = t;
  }

  // THE SKELETON'S SHAPE, not just its motion.
  //
  // The tracks alone are not enough to rebuild the rig: `wpnHand_L` is a child
  // of `wpn` and its values are relative to it, so parenting it anywhere else
  // puts it in the wrong place — silently, because it still has a position.
  // The hierarchy also names the IK pairs CS2 solves at runtime
  // (`attachHand_*` on the hand, `wpnHand_*` on the weapon), which cannot be
  // reconstructed from names alone.
  const parents = {};
  const walk = (el, parentName) => {
    if (!el) return;
    const isJoint = el.type === "DmeJoint";
    if (isJoint && parentName != null) parents[el.name] = parentName;
    for (const c of el.attrs.children ?? []) walk(c, isJoint ? el.name : parentName);
  };
  walk(
    doc.elements.find((e) => e.type === "DmeModel"),
    null,
  );

  const tf = clip.attrs.timeFrame?.attrs ?? {};
  return {
    duration: tf.duration ?? 0,
    frameRate: clip.attrs.frameRate ?? 0,
    boneCount: Object.keys(bones).length,
    bones,
    parents,
  };
}

// Run directly for a quick look: `node tools/nmclip.mjs <file.dmx>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const path = process.argv[2];
  if (path) {
    const fs = await import("node:fs");
    const c = readClip(fs.readFileSync(path));
    const keys = Object.values(c.bones)[0];
    console.log(
      `${path.replace(/^.*\//, "")}: ${c.boneCount} bones, ${c.duration.toFixed(4)}s @ ${c.frameRate.toFixed(2)}fps, ` +
        `${keys?.rot?.times.length ?? keys?.pos?.times.length ?? 0} keys`,
    );
    console.log("bones:", Object.keys(c.bones).join(" "));
  }
}
