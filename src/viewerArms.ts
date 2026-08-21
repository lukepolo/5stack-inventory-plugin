// First-person arms: the rig that holds the weapon.
//
// WHERE THIS COMES FROM. Every glove GLB on the mount — the eight paintable
// families plus `ct_gloves`/`t_gloves` — ships two bodies and a full arm
// skeleton:
//
//   mesh   <glove>.vmdl_c.worldmodel   the pair of gloves, posed for an icon
//   mesh   <glove>.vmdl_c.viewmodel    the ARMS, which is what a player sees
//   skin   52 joints                   arm_upper_L … hand_R, every finger
//   clip   inspect_loop                6.167s, 186 keys, 156 channels
//
// The item view wants the worldmodel and throws the rest away
// (`pres.cullViewmodel` in viewer3d.ts). First person is the exact inverse, and
// that inversion is all this module is: keep the arms, drop the item.
//
// `inspect_loop` is worth naming separately, because it is THE ONLY REAL INSPECT
// ANIMATION IN THE WHOLE ASSET SET. Measured across every weapon and knife GLB,
// a weapon's own `inventory_inspect` is a single keyframe of zero duration — a
// pose, not an animation (see PRESENTATION.inspectClips). What CS2 animates when
// you inspect a gun is the HANDS; the gun is rigid cargo riding the right one.
// That is why first person is where the motion finally comes from, and why
// `bakePose` — which flattens the weapon to a static mesh and would otherwise
// rule this out — is not in the way at all.
//
// ONE CLIP PER GLOVE FAMILY, NOT PER WEAPON. The hand pose is therefore generic
// and will not wrap every weapon perfectly; CS2 keeps its per-weapon arm
// sequences in an anim graph our export does not reach. Stated here because it
// is a property of the assets, not a bug to be chased in the viewer.
import { buildViewmodelClip } from "./viewmodelClip";
import type { ThreeBundle } from "./viewer3d";

/** Which hand carries the weapon. CS2 is right-handed by default; `L` is the
 *  mirrored viewmodel the game offers as a setting, and dual-wield uses both. */
export type Hand = "R" | "L";

export interface ArmsRig {
  /** Add this to the scene. */
  root: import("three").Object3D;
  /** Close the hands onto the weapon — see buildGripSolver. Empty when the rig
   *  is not clip-driven, since there is nothing to grip. */
  grip: GripSolver[];
  /** The bone the weapon hangs off — `hand_R` or `hand_L`. */
  hand: import("three").Object3D;
  /**
   * The `wpn` node, when a viewmodel clip is driving the rig.
   *
   * THIS is where the weapon goes, and it is the difference between a real
   * first-person view and a gun taped to a hand. CS2's clip animates the weapon
   * on its own track alongside the arms, so the gun's motion is authored, not
   * inferred from where a finger ended up.
   *
   * Null when the rig is running a glove's own `inspect_loop`, which has no
   * weapon in it at all.
   */
  wpn: import("three").Object3D | null;
  /** Null when the GLB shipped no usable clip; the rig is then a static pose. */
  mixer: import("three").AnimationMixer | null;
  /** Seconds. Zero when there is no clip. */
  duration: number;
  /** Advance the clip. No-op without a mixer. */
  update: (dt: number) => void;
  /** Put the play head somewhere specific and evaluate there. */
  seek: (t: number) => void;
  /**
   * Play an action ONCE over the resting clip, then settle back to it.
   *
   * Crossfaded both ways, and the outgoing clip is HELD on its last frame while
   * the rest fades back in. A LoopOnce action that simply ends snaps every bone
   * it touched back to its pre-animation value for a frame, which on an arm
   * reads as the hand teleporting. `onFinished` fires when the clip has run its
   * length, before the fade back.
   */
  play: (clip: import("three").AnimationClip, onFinished?: () => void) => void;
  /** Back to the resting clip. Idempotent. */
  rest: () => void;
  /** Seconds into the action currently playing, or null at rest. */
  playhead: () => number | null;
  /** Frees the geometry and materials THIS rig cloned. */
  dispose: () => void;
}

/** Bodies to drop. The exact inverse of viewer3d's `cullViewmodel`. */
const WORLD_BODY = /worldmodel|thirdperson/i;
/** Bodies to keep — named rather than implied, so a GLB that ships neither
 *  fails loudly here instead of rendering an empty rig. */
const VIEW_BODY = /viewmodel|firstperson/i;

/** The clip that animates the hands. Anchored, because `inspect_loop` is an
 *  exact name in this tree and a loose match would also take `tools_preview`. */
const INSPECT_CLIP = /^inspect_loop$/i;
/**
 * The still fallback.
 *
 * `icon_pose` cups the hands together for a 64px tile — wrong for a viewer, and
 * the reason the glove item view prefers `tools_preview_pose`. Here it is only
 * ever reached when `inspect_loop` is missing, which on the current mount is
 * never; it exists so a future glove that ships without the loop still holds the
 * gun rather than snapping to a T-pose bind.
 */
const POSE_CLIP = /^(tools_preview_pose|icon_pose)$/i;

export interface BuildArmsOpts {
  /**
   * The agent's `firstperson_sleeves` mesh, to dress the forearms.
   *
   * An agent GLB carries the SAME 52-joint arm skeleton the gloves do — same
   * bone names, same rest pose — so its sleeve binds to this rig by name with
   * no retarget. Without it the arms are bare skin, which is only right for an
   * agent that actually has bare arms.
   */
  sleeve?: { scene: import("three").Object3D } | null;
  /**
   * The weapon's own first-person clip, raw from `/anims/<model>.json`.
   *
   * Supplying this replaces the glove's `inspect_loop` entirely — that clip is
   * the GLOVE showcase (fingers spread to display the glove, never curled on a
   * grip) and was only ever a stand-in. Bones the clip drives that the glove
   * export has no node for get an empty carrier so their tracks still bind;
   * `wpn` is the one that matters.
   */
  viewmodel?: Parameters<typeof buildViewmodelClip>[1] | null;
  /** Which hand the weapon rides. Both arms are always drawn — CS2's inspect
   *  uses the off hand to steady the weapon, and dropping it looks amputated. */
  hand?: Hand;
  /** Start still, on the clip's first frame, instead of playing. */
  still?: boolean;
  /** Force a clip by name, for `?inspectclip=`-style debugging. */
  clipOverride?: string | null;
  /** Skip the forearm twist constraint — see buildTwistSolver's `disabled`. */
  noTwist?: boolean;
}

/**
 * Build the arm rig from an already-loaded glove GLTF.
 *
 * The GLTF is passed in rather than loaded here so this module stays free of the
 * viewer's asset cache, its version stamping and its texture-skipping — all of
 * which belong to viewer3d and none of which change for arms.
 *
 * Returns null when the GLB turns out not to be an arm tree at all (no view
 * body, or no hand bone). Null means "this is not something we can hold a gun
 * with", and the caller falls back to the item view rather than rendering a
 * weapon floating in space.
 */
export function buildArms(
  THREE: ThreeBundle["THREE"],
  cloneSkeleton: ThreeBundle["cloneSkeleton"],
  gltf: { scene: import("three").Object3D; animations?: import("three").AnimationClip[] },
  opts: BuildArmsOpts = {},
): ArmsRig | null {
  const hand = opts.hand ?? "R";
  // SKELETON-AWARE CLONE, not `clone(true)`. A plain clone copies the
  // SkinnedMeshes but leaves them pointing at the ORIGINAL skeleton's bones, so
  // two viewers sharing one cached GLTF would animate each other's arms — and
  // the cache is shared by construction (gltfCache in viewer3d).
  const root = cloneSkeleton(gltf.scene) as import("three").Object3D;

  // Drop the item bodies. Same "only when both are present" guard the item view
  // makes, for the same reason: a GLB shipping one body must not have it culled
  // out from under it.
  const world: import("three").Object3D[] = [];
  let sawView = false;
  root.traverse((n) => {
    const name = n.name ?? "";
    if (WORLD_BODY.test(name)) world.push(n);
    else if (VIEW_BODY.test(name)) sawView = true;
  });
  if (!sawView) return null;
  world.forEach((w) => w.parent?.remove(w));

  const handBone = findBone(root, `hand_${hand}`);
  if (!handBone) return null;

  /**
   * Carriers for bones the clip drives that the glove export lacks.
   *
   * Added under the GLOVE ROOT, not under the scene, and that placement is the
   * whole trick: the root node is where both trees put the inch→metre
   * conversion, so a carrier's local transform is in the same source units the
   * clip's values are authored in, and `wpn.matrixWorld` comes out as the
   * weapon's real placement with no conversion of our own.
   */
  let wpn: import("three").Object3D | null = null;

  const clips = gltf.animations ?? [];
  let clip: import("three").AnimationClip | null = null;
  if (opts.viewmodel) {
    const built = buildViewmodelClip(THREE as unknown as typeof import("three"), opts.viewmodel);
    /**
     * `root_motion` is a JOINT IN THE CLIP'S RIG THAT THE GLOVE DOES NOT HAVE,
     * and it is not optional scenery: in the clip's tree both arms AND the
     * weapon hang off it, so it carries the whole viewmodel's sway. Bind it to
     * nothing and the sway is lost; worse, `wpn` ends up measured in a frame
     * one joint short of the one its values were authored in, which is a
     * silently wrong weapon position rather than an obviously missing one.
     *
     * So it is synthesised and SPLICED IN: created under the model root, then
     * the arms are moved beneath it. Re-parenting bones is safe — skinning
     * reads `bone.matrixWorld`, not the bone's place in the tree.
     */
    // SPLICED INTO THE SKELETON'S OWN SPACE, not onto `root`.
    //
    // `root` is the glTF SCENE — a plain identity Group — and the inch→metre
    // conversion lives one level down, on the model node the bones actually
    // hang off. Adding the carriers to the scene put them OUTSIDE that
    // conversion, so the clip's authored values (a weapon sits ~20 units out,
    // i.e. inches) were read as metres and the gun was placed twenty METRES
    // away: correctly sized, correctly oriented, and off in the dark where
    // nothing showed it. Anchoring to the arm's own parent puts the carriers in
    // exactly the space the clip's numbers are authored in.
    const skelRoot = (findBone(root, "arm_upper_R") ?? findBone(root, "arm_upper_L"))?.parent ?? root;
    const motion = new THREE.Object3D();
    motion.name = "root_motion";
    skelRoot.add(motion);
    for (const arm of [...skelRoot.children]) {
      if (/^arm_upper_[LR]$/.test(arm.name)) motion.add(arm);
    }
    // Everything else the clip drives that the rig has no node for, PARENTED AS
    // THE CLIP PARENTS IT. A name-prefix rule is not good enough: `wpnHand_L`
    // is a child of `wpn`, and its values are relative to that, so hanging it
    // off root_motion put it somewhere plausible-looking and wrong. Built in
    // dependency order so a parent always exists before its child.
    const made = new Map<string, import("three").Object3D>([["root_motion", motion]]);
    const ensure = (bone: string, depth = 0): import("three").Object3D | null => {
      const existing = made.get(bone) ?? findBone(root, bone);
      if (existing) return existing;
      // Cycles cannot happen in an exported tree, but a malformed parents map
      // must not hang the mount.
      if (depth > 16) return null;
      const carrier = new THREE.Object3D();
      carrier.name = bone;
      const parentName = built.parents[bone];
      const parent = (parentName ? ensure(parentName, depth + 1) : null) ?? motion;
      parent.add(carrier);
      made.set(bone, carrier);
      return carrier;
    };
    for (const bone of built.bones) ensure(bone);
    wpn = made.get("wpn") ?? findBone(root, "wpn");
    clip = built.clip;
  } else {
    clip =
      (opts.clipOverride ? clips.find((c) => c.name === opts.clipOverride) : undefined) ??
      clips.find((c) => INSPECT_CLIP.test(c.name)) ??
      clips.find((c) => POSE_CLIP.test(c.name)) ??
      null;
  }

  // THE AGENT'S SLEEVE, grafted onto this rig's skeleton.
  //
  // Taken by BONE NAME rather than by re-binding: the agent and the glove are
  // exported from the same arm rig, so every joint the sleeve is weighted to
  // already exists here under the same name. Rebuilding the skin against this
  // skeleton is therefore a lookup, not a solve — and it has to be done, because
  // a SkinnedMesh cloned from another file still points at ITS skeleton and
  // would animate on the agent's bones while the gloves animate on ours.
  if (opts.sleeve) graftSleeve(THREE, cloneSkeleton, root, opts.sleeve.scene);
  // AFTER the sleeve, so the sleeve fades with the arm it covers rather than
  // hanging on past the point the skin underneath has vanished.
  fadeArmStumps(THREE, root);

  // BEFORE the mixer — see buildTwistSolver: it reads rest rotations, and a
  // posed skeleton has none left to read.
  const twist = buildTwistSolver(THREE, root, opts.noTwist);

  let mixer: import("three").AnimationMixer | null = null;
  /** The resting clip's action — what `play` fades away from and `rest` back to. */
  let restAction: import("three").AnimationAction | null = null;
  let duration = 0;
  if (clip) {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    restAction = action;
    action.play();
    duration = clip.duration;
    // A pose clip is a single key at t=0 and `still` asks for the same thing, so
    // both evaluate once and then never advance. Stepping by ZERO rather than
    // not stepping at all: without one update the skeleton is still at BIND —
    // arms hanging at the waist — and the weapon would hang there with it.
    if (opts.still || duration === 0) {
      action.paused = true;
      mixer.update(0);
    }
  }

  twist?.apply();

  // The hand's world matrix has to be current before the caller can compute the
  // weapon's seat against it, and nothing has drawn a frame yet.
  root.updateMatrixWorld(true);

  // Bound once so the closures below do not have to re-narrow a mutable `let`
  // on every call — and so `dispose` clearing the field cannot strand `update`
  // holding a stale reference.
  /**
   * NO GRIP SOLVER. The clip already holds the weapon.
   *
   * Composed offline from the DMX's own rest pose, hierarchy and channels,
   * `hand_R` sits EXACTLY on `wpnHand_R` and `hand_L` exactly on `wpnHand_L` —
   * distance 0.00 at every sample. The clip is self-consistent; play it
   * faithfully and the hands are on the gun.
   *
   * An IK solver lived here and was actively harmful. It was built on a
   * misread: `attachHand_*` sits a CONSTANT 7.84 (right) and 4.09 (left)
   * source units from `wpnHand_*` for the whole clip, which is simply the
   * offset from the wrist to the grip point — not an error to close. Forcing
   * those two together dragged the arms out of the pose Valve authored, which
   * is what made them wonky.
   */
  const grip: GripSolver[] = [];

  const mx = mixer;

  /** Crossfade length, both ways. Short: an action's first frame is close to
   *  rest by design, and a long blend reads as lag on a shot. */
  const FADE = 0.12;
  let current: { action: import("three").AnimationAction; onFinished?: () => void } | null = null;
  /**
   * Bring the resting clip back.
   *
   * `enabled` is set by hand: a fade-out that reaches zero DISABLES the action,
   * and fadeIn does not re-enable it — so without this the rest would fade "in"
   * at weight zero and the arms would hold the outgoing clip's last frame
   * forever. `paused` is restored too: the rest clip is a single static
   * keyframe, and a zero-duration clip that is allowed to advance divides by
   * its own duration inside the mixer's loop bookkeeping.
   */
  const wakeRest = () => {
    if (!restAction) return;
    restAction.enabled = true;
    restAction.paused = duration === 0;
    restAction.fadeIn(FADE).play();
  };
  const onFinished = (e: { action: import("three").AnimationAction }) => {
    if (!current || e.action !== current.action) return;
    const done = current;
    current = null;
    wakeRest();
    done.action.fadeOut(FADE);
    done.onFinished?.();
  };
  mx?.addEventListener("finished", onFinished as (e: unknown) => void);
  const play = (clipToPlay: import("three").AnimationClip, onDone?: () => void) => {
    if (!mx) return;
    const a = mx.clipAction(clipToPlay);
    /**
     * NEVER FADE AN ACTION THAT STILL HAS WEIGHT. `clipAction` returns the one
     * cached action per clip, so re-triggering (full auto, a double-tapped
     * reload) hands back the very action that is already playing — and fading
     * it out and in again drives the mixer's TOTAL weight through zero. At
     * zero the mixer shows every bone's pre-animation original: the arms drop
     * to the bind pose at the waist, the gun turns square across the eye, and
     * the muzzle bone lands ON the camera so the flash sprites fill the frame
     * as a giant orange rectangle. All of the spam artefacts were this one
     * dip. An action with weight restarts HARD — reset, weight pinned at 1 —
     * which is also exactly what recoil looks like shot to shot.
     */
    const rearm = a.getEffectiveWeight() > 0.01;
    if (current && current.action !== a) {
      // A different action: a real crossfade, weights summing to one.
      const old = current;
      current = null;
      old.action.fadeOut(FADE);
    }
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    // Held on the last frame until the rest has faded back in — see the
    // interface comment for why a plain end is a visible snap.
    a.clampWhenFinished = true;
    a.enabled = true;
    a.setEffectiveTimeScale(1);
    a.setEffectiveWeight(1);
    restAction?.fadeOut(FADE);
    if (!rearm) a.fadeIn(FADE);
    a.play();
    current = { action: a, onFinished: onDone };
  };
  const rest = () => {
    if (!current) return;
    const c = current;
    current = null;
    wakeRest();
    c.action.fadeOut(FADE);
  };

  return {
    root,
    grip,
    hand: handBone,
    wpn,
    mixer,
    duration,
    update: (dt) => {
      mx?.update(dt);
      twist?.apply();
    },
    seek: (t) => mx?.setTime(Math.max(0, Math.min(t, duration))),
    play,
    rest,
    playhead: () => (current ? current.action.time : null),
    dispose: () => {
      mx?.removeEventListener("finished", onFinished as (e: unknown) => void);
      mx?.stopAllAction();
      root.traverse((n) => {
        const mesh = n as import("three").Mesh;
        if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
        // Geometry is CLONED per rig by cloneSkeleton, so it is ours to free.
        // Materials are NOT — they come straight off the cached GLTF and are
        // shared with every other viewer holding the same gloves, so disposing
        // them would empty the textures out from under a live render. Same
        // contract the posed-geometry cache keeps in viewer3d.
        mesh.geometry?.dispose();
      });
      root.parent?.remove(root);
    },
  };
}

/**
 * The seat: where the weapon has to sit so its grip lands in the hand.
 *
 * Every weapon and knife GLB carries an `ag1_hand_r` bone (the Dual Berettas
 * carry `ag1_hand_l` too — the only rig that needs both). It marks where CS2
 * puts the hand, expressed in the weapon's own space, and both trees are
 * exported at the same 0.0254 inch→metre scale, so the two cancel and no unit
 * reconciliation is needed.
 *
 * Returns the matrix to give a wrapper whose parent is the hand bone:
 *
 *   hand.matrixWorld · SEAT · weaponLocal · A  ==  hand.matrixWorld
 *   ⇒  SEAT = (weaponLocal · A)⁻¹
 *
 * where `A` is the attachment bone relative to the weapon root and `weaponLocal`
 * is whatever transform the weapon object already carries. A WRAPPER rather than
 * moving the weapon itself, because the item view has already recentred it on
 * the origin and a dozen coordinate systems downstream — sticker offsets, the
 * charm pivot, the collision grid — are stated against that. Moving it would
 * invalidate all of them; wrapping it invalidates nothing.
 *
 * Null when the weapon ships no attachment bone, which no model on the mount
 * does — but a silent mis-seat would put the gun through the palm, so it is
 * worth being an explicit "cannot".
 */
export function weaponSeat(
  THREE: ThreeBundle["THREE"],
  weapon: import("three").Object3D,
  hand: Hand = "R",
): import("three").Matrix4 | null {
  const bone = findBone(weapon, `ag1_hand_${hand.toLowerCase()}`);
  if (!bone) return null;
  // Relative to the weapon ROOT, not to the world: the weapon may or may not be
  // in a scene yet, and `matrixWorld` would fold in wherever it happens to be.
  weapon.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(weapon.matrixWorld).invert();
  const aRelRoot = new THREE.Matrix4().multiplyMatrices(rootInv, bone.matrixWorld);
  // weaponLocal · A, then inverted — see the doc comment.
  return new THREE.Matrix4().multiplyMatrices(weapon.matrix, aRelRoot).invert();
}

/** First node with this exact name. Bones are Object3Ds like anything else, so
 *  this deliberately does not test `isBone` — a rig that exports the attachment
 *  as an Empty still names it the same thing. */
function findBone(root: import("three").Object3D, name: string): import("three").Object3D | null {
  let hit: import("three").Object3D | null = null;
  root.traverse((n) => {
    if (!hit && n.name === name) hit = n;
  });
  return hit;
}

/**
 * The forearm twist constraint CS2 applies at runtime and the clips do not.
 *
 * THE BUG THIS FIXES. A CS2 arm rig carries helper bones — `arm_lower_R_TWIST`,
 * `arm_lower_R_TWIST1`, and the same pair on the upper arm — whose whole job is
 * to spread a wrist's roll along the forearm so the skin turns gradually
 * instead of all at one joint. The exported clips barely key them: measured on
 * `inspect_loop`, `arm_lower_R` and `hand_R` carry 186 rotation keys each while
 * both TWIST bones carry FIVE. The real values come from a constraint in the
 * game, not from the animation.
 *
 * Play the clip without that constraint and the forearm rotates while the skin
 * bound to the twist bones stays put — the mesh wrings itself out into the
 * "candy wrapper" pinch at the wrist. It is invisible on a still pose, which is
 * why it only appeared once the clip started playing.
 *
 * THE SOLVE. Take the roll of the child joint about the segment's long axis and
 * give each twist bone its share by distance along that segment. Both numbers
 * come off the rig itself rather than being tuned:
 *
 *   hand_R            local x -11.083   the far end, 100% of the roll
 *   arm_lower_R_TWIST1        -7.388    67%
 *   arm_lower_R_TWIST         -3.693    33%
 *
 * ROLL ONLY, via a swing-twist decomposition. A twist bone must not inherit the
 * bend — copying the wrist wholesale would fold the forearm in half.
 *
 * MEASURED FROM REST, WHICH IS THE WHOLE TRICK. A bone's local rotation is
 * mostly its rest orientation: `hand_R` binds at x=0.6943, an 88-degree turn
 * about the very axis being decomposed. Feeding that in raw hands every twist
 * bone a third of 88 degrees of roll that the wrist is not actually doing, and
 * it gets worse as the clip moves — `hand_R`'s w flips sign partway through
 * `inspect_loop` (-0.933 to +0.932 around t=3.5s), the same orientation written
 * the other way round, which makes a FRACTION of it jump by about 118 degrees
 * even though the orientation itself is continuous. That snap near the end of
 * the loop is what this fixes. So the roll is taken from `q · rest⁻¹` — zero at
 * rest by construction, and continuous through the sign flip because the delta
 * is canonicalised to the short way round before it is scaled.
 */
export interface TwistSolver {
  /** Apply the constraint. Call after the mixer has posed the skeleton. */
  apply: () => void;
  /** How many twist bones are driven — 0 means the rig has none. */
  count: number;
}

export function buildTwistSolver(
  THREE: ThreeBundle["THREE"],
  root: import("three").Object3D,
  /** `?notwist=1` — bisect a wrung-out arm without a rebuild. */
  disabled = false,
): TwistSolver | null {
  if (disabled) return null;
  /** `<segment>_TWIST` / `<segment>_TWIST1` → the segment it belongs to. */
  const TWIST = /^(.*)_TWIST\d*$/;
  const byName = new Map<string, import("three").Object3D>();
  root.traverse((n) => {
    if (n.name) byName.set(n.name, n);
  });

  const driven: {
    bone: import("three").Object3D;
    source: import("three").Object3D;
    f: number;
    /** Rest rotations, captured before any clip has posed the rig. */
    restSource: import("three").Quaternion;
    restBone: import("three").Quaternion;
    axis: import("three").Vector3;
  }[] = [];
  for (const [name, bone] of byName) {
    const m = TWIST.exec(name);
    if (!m) continue;
    const segment = byName.get(m[1]);
    if (!segment) continue;
    // The segment's real child — the joint whose roll is being spread. Found by
    // elimination rather than by name, so `arm_lower_*` finding `hand_*` and
    // `arm_upper_*` finding `arm_lower_*` both fall out of one rule.
    const source = segment.children.find((c) => c.name && !TWIST.test(c.name));
    if (!source) continue;
    // Share by distance along the segment. Both offsets are authored down the
    // same local axis, so their lengths divide cleanly; a zero-length segment
    // would be a degenerate rig and is skipped rather than dividing by zero.
    const reach = source.position.length();
    if (reach < 1e-6) continue;
    driven.push({
      bone,
      source,
      f: Math.min(1, bone.position.length() / reach),
      restSource: source.quaternion.clone(),
      restBone: bone.quaternion.clone(),
      // Derived from the rig rather than assumed to be X. The sign cancels in
      // the decomposition, so only the line matters, not which way it points.
      axis: source.position.clone().normalize(),
    });
  }
  if (!driven.length) return null;

  const twist = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  return {
    count: driven.length,
    apply: () => {
      for (const d of driven) {
        // How far the joint has turned FROM REST, in the parent's space.
        inv.copy(d.restSource).invert();
        delta.copy(d.source.quaternion).multiply(inv);
        // Canonicalise to the short way round. q and -q are the same
        // orientation, but only one of them is a sane thing to take a third of.
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        // Swing-twist: keep only the part of the rotation's vector component
        // that lies along the segment, which leaves the roll and drops the bend.
        const dot = delta.x * d.axis.x + delta.y * d.axis.y + delta.z * d.axis.z;
        twist.set(d.axis.x * dot, d.axis.y * dot, d.axis.z * dot, delta.w);
        // A half-turn leaves this at zero length, where the axis is genuinely
        // undefined; identity is the only non-exploding answer.
        if (twist.lengthSq() < 1e-8) twist.copy(ident);
        else twist.normalize();
        // Share of the roll, applied ON TOP of the bone's own rest orientation —
        // overwriting it outright would throw away however the rig aligns the
        // helper bone in the first place.
        d.bone.quaternion.copy(ident).slerp(twist, d.f).multiply(d.restBone);
      }
    },
  };
}

/**
 * The grip constraint CS2 solves at runtime, which the clip does not contain.
 *
 * MEASURED, not assumed: with the clip playing and the skeleton posed exactly
 * as authored, `attachHand_L` sits 10cm from `wpnHand_L` and `attachHand_R`
 * sits 21cm from `wpnHand_R`. Those four bones are an IK pair — `wpnHand_*`
 * rides the weapon and says where a hand belongs on THIS gun, `attachHand_*`
 * rides the hand and says which part of it goes there — and the game closes the
 * gap every frame. The clip only has to get the arms approximately right
 * because the solver finishes the job.
 *
 * Without it the hands float near the weapon rather than on it, which no amount
 * of camera work hides.
 *
 * A two-bone analytic solve (shoulder, elbow, wrist), not an iterative one: the
 * chain is exactly two links, so the law of cosines gives the answer outright
 * and there is nothing to converge.
 */
export interface GripSolver {
  apply: () => void;
}

export function buildGripSolver(
  THREE: ThreeBundle["THREE"],
  root: import("three").Object3D,
  side: "L" | "R",
): GripSolver | null {
  const upper = findBone(root, `arm_upper_${side}`);
  const lower = findBone(root, `arm_lower_${side}`);
  const hand = findBone(root, `hand_${side}`);
  const attach = findBone(root, `attachHand_${side}`);
  const target = findBone(root, `wpnHand_${side}`);
  if (!upper || !lower || !hand || !attach || !target) return null;

  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const T = new THREE.Vector3();
  const vAB = new THREE.Vector3();
  const vAC = new THREE.Vector3();
  const vBA = new THREE.Vector3();
  const vBC = new THREE.Vector3();
  const vAT = new THREE.Vector3();
  const axis0 = new THREE.Vector3();
  const axis1 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const wq = new THREE.Quaternion();
  const pq = new THREE.Quaternion();
  const tq = new THREE.Quaternion();
  const aq = new THREE.Quaternion();
  const hq = new THREE.Quaternion();
  const H = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));

  /** Turn a bone by a WORLD-space rotation, writing back its local quaternion. */
  const turn = (bone: import("three").Object3D, quat: import("three").Quaternion) => {
    bone.getWorldQuaternion(wq);
    if (bone.parent) bone.parent.getWorldQuaternion(pq);
    else pq.identity();
    bone.quaternion.copy(pq.invert()).multiply(quat).multiply(wq);
    bone.updateMatrixWorld(true);
  };
  const turnAxis = (bone: import("three").Object3D, axis: import("three").Vector3, angle: number) => {
    if (!Number.isFinite(angle) || Math.abs(angle) < 1e-6 || axis.lengthSq() < 1e-12) return;
    turn(bone, q.setFromAxisAngle(axis, angle));
  };

  return {
    apply: () => {
      upper.updateMatrixWorld(true);
      target.updateMatrixWorld(true);

      // ORIENTATION IS DECIDED FIRST, and the wrist target is derived from it.
      //
      // The obvious order — solve the position, then turn the hand to match the
      // anchor — cannot work: `attachHand` is a CHILD of the hand, so turning
      // the hand swings the very point that was just placed back off the
      // target. Measured, that made the grip worse than doing nothing (the
      // right hand went from 21cm out to 33cm).
      //
      // So: work out where the hand must END UP pointing, carry the
      // hand→attach offset through that rotation, and aim the chain at the
      // wrist position that puts `attachHand` on the anchor once the hand is
      // turned. Then turn it.
      target.getWorldQuaternion(tq);
      hand.getWorldQuaternion(hq);
      attach.updateMatrixWorld(true);
      attach.getWorldQuaternion(aq);
      // The rotation that takes the attach point's current facing to the
      // anchor's, expressed in world space.
      const align = tq.clone().multiply(aq.clone().invert());
      // Where the hand will point once that is applied.
      const handGoal = align.clone().multiply(hq);

      hand.getWorldPosition(H);
      attach.getWorldPosition(C);
      // The wrist→attach arm, as it will be AFTER the hand turns.
      offset.subVectors(C, H).applyQuaternion(align);

      upper.getWorldPosition(A);
      lower.getWorldPosition(B);
      target.getWorldPosition(T);
      // The wrist has to land here for the attach point to land on the anchor.
      T.sub(offset);
      // The chain's end is the WRIST now, not the attach point.
      C.copy(H);

      const lab = A.distanceTo(B);
      const lcb = B.distanceTo(C);
      if (lab < 1e-6 || lcb < 1e-6) return;
      // Reach is CLAMPED just inside the chain's span. A target further away
      // than the arm is long has no solution, and the law of cosines answers
      // with NaN rather than saying so — which would write NaN into a bone and
      // make the whole arm vanish.
      const lat = Math.min(Math.max(A.distanceTo(T), 1e-4), lab + lcb - 1e-4);

      vAB.subVectors(B, A);
      vAC.subVectors(C, A);
      vBA.subVectors(A, B);
      vBC.subVectors(C, B);
      vAT.subVectors(T, A);

      // Angles as they stand, and as they need to be.
      const ab0 = Math.acos(clamp1(vAC.clone().normalize().dot(vAB.clone().normalize())));
      const bc0 = Math.acos(clamp1(vBA.clone().normalize().dot(vBC.clone().normalize())));
      const at0 = Math.acos(clamp1(vAC.clone().normalize().dot(vAT.clone().normalize())));
      const ab1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
      const bc1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));

      // The bend plane, taken from the pose the clip put the arm in. Using the
      // animation's own elbow direction rather than a fixed pole vector is what
      // keeps the elbow where the animator put it instead of snapping it to
      // some canonical "outward" that would fight the performance.
      axis0.copy(vAC).cross(vAB);
      if (axis0.lengthSq() < 1e-12) return; // arm dead straight: no plane to bend in
      axis0.normalize();
      axis1.copy(vAC).cross(vAT);

      // Bend to the right shape, then aim the whole chain at the target. Both
      // use axes measured BEFORE either rotation, which is what makes a
      // single pass exact rather than iterative.
      turnAxis(upper, axis0, ab1 - ab0);
      turnAxis(lower, axis0, bc1 - bc0);
      if (axis1.lengthSq() > 1e-12) turnAxis(upper, axis1.normalize(), at0);

      // Now turn the hand to the facing worked out above. The chain has already
      // been aimed at the wrist position that makes this land on the anchor.
      hand.getWorldQuaternion(hq);
      turn(hand, handGoal.multiply(hq.invert()));
    },
  };
}

/**
 * Put an agent's first-person sleeve on the glove rig's arms.
 *
 * Both trees export the same 52-joint arm skeleton — identical names, identical
 * rest pose — so the sleeve's vertex weights already refer to bones this rig
 * has. What it does NOT have is a binding: a SkinnedMesh cloned out of the
 * agent file still holds the agent's own Skeleton object, and left alone it
 * would deform on bones nothing is animating while the gloves move on ours.
 *
 * So the mesh is re-bound: same geometry, same materials, same inverse bind
 * matrices, but a Skeleton built from THIS rig's bones in the order the mesh's
 * joint indices expect. A bone the rig is missing keeps the sleeve's own copy,
 * which is inert but keeps the indices aligned — dropping one would shift every
 * index after it and shred the mesh.
 */
function graftSleeve(
  THREE: ThreeBundle["THREE"],
  cloneSkeleton: ThreeBundle["cloneSkeleton"],
  root: import("three").Object3D,
  agent: import("three").Object3D,
): void {
  const source = cloneSkeleton(agent) as import("three").Object3D;
  const sleeves: import("three").SkinnedMesh[] = [];
  source.traverse((n) => {
    const m = n as import("three").SkinnedMesh;
    if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh && /firstperson_sleeves/i.test(m.name ?? "")) {
      sleeves.push(m);
    }
  });
  if (!sleeves.length) return;

  const byName = new Map<string, import("three").Object3D>();
  root.traverse((n) => {
    if (n.name && !byName.has(n.name)) byName.set(n.name, n);
  });

  for (const mesh of sleeves) {
    const old = mesh.skeleton;
    const bones = old.bones.map((b) => (byName.get(b.name) ?? b) as import("three").Bone);
    // Nothing in common means this is not the rig we thought it was; leaving it
    // on its own skeleton is inert, which is better than deforming to nonsense.
    if (!bones.some((b, i) => b !== old.bones[i])) continue;
    mesh.bind(new THREE.Skeleton(bones, old.boneInverses), mesh.bindMatrix);
    mesh.removeFromParent();
    root.add(mesh);
  }
}

/**
 * Fade the arm out toward the shoulder, so its open end is never seen.
 *
 * CS2's viewmodel arms are CUT at the shoulder — they are hollow tubes, and the
 * game only gets away with it because the camera sits at the eye, where the cut
 * is behind you. Move the camera back at all, which any showcase framing wants
 * to do, and you are looking straight into the inside of an arm.
 *
 * Capping the hole would mean generating geometry. Fading is cheaper and reads
 * better: the arm simply stops existing before the cut does.
 *
 * WEIGHTED BY THE SKIN, not by distance from the camera. Every vertex already
 * carries how much it belongs to the upper arm, so the fade follows the mesh
 * however it is posed and at whatever distance — a camera-relative fade would
 * dissolve the wrong part the moment the arm moved.
 */
export function fadeArmStumps(
  THREE: ThreeBundle["THREE"],
  root: import("three").Object3D,
): void {
  /** Bones whose influence means "this vertex is up near the cut". */
  const STUMP = /^arm_upper_[LR](_TWIST\d*)?$/;

  root.traverse((n) => {
    const mesh = n as import("three").SkinnedMesh;
    if (!(mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    const geom = mesh.geometry;
    const si = geom.getAttribute("skinIndex");
    const sw = geom.getAttribute("skinWeight");
    if (!si || !sw || geom.getAttribute("aStump")) return;

    const stump = new Set<number>();
    mesh.skeleton.bones.forEach((b, i) => {
      if (STUMP.test(b.name ?? "")) stump.add(i);
    });
    if (!stump.size) return;

    const out = new Float32Array(si.count);
    let touched = 0;
    for (let v = 0; v < si.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (stump.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      }
      out[v] = w;
      if (w > 0.001) touched++;
    }
    // A mesh with no upper-arm weight at all is a hand or a glove — nothing to
    // fade, and adding the attribute would only cost a buffer upload.
    if (!touched) return;
    geom.setAttribute("aStump", new THREE.BufferAttribute(out, 1));

    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as import("three").Material[]) {
      if (!m || (m as { userData?: { stumpFade?: boolean } }).userData?.stumpFade) continue;
      m.transparent = true;
      // Keep writing depth: these are opaque surfaces that happen to fade at one
      // end, and turning depth-write off would let the far side of the arm show
      // through the near side.
      m.depthWrite = true;
      (m as { userData: { stumpFade?: boolean } }).userData.stumpFade = true;
      m.onBeforeCompile = (shader) => {
        shader.vertexShader =
          "attribute float aStump;\nvarying float vStump;\n" +
          shader.vertexShader.replace("void main() {", "void main() {\n  vStump = aStump;");
        shader.fragmentShader =
          "varying float vStump;\n" +
          shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            // Fully solid until the vertex is mostly upper-arm, then out over a
            // short band — abrupt enough to read as "the arm ends here" rather
            // than as a ghost, soft enough not to alias into a hard rim.
            "gl_FragColor.a *= 1.0 - smoothstep(0.35, 0.75, vStump);\n#include <dithering_fragment>",
          );
      };
      m.needsUpdate = true;
    }
  });
}
