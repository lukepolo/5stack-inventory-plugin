/**
 * A charm's cloth simulation — Valve's CFeModel, ported.
 *
 * A CS2 charm is a cloth softbody, not a pendulum. Each kc_*.vmdl_c ships a full
 * PhysFeModelDesc (nodes, quads, rods, axial bends, per-node mass and gravity)
 * which vphysics2 simulates with position-based dynamics, and the charm's 3-bone
 * skin is driven from the node positions. The viewer used to hang the charm off a
 * hand-rolled one-particle verlet pendulum on a 4mm cord, every constant of it
 * guessed; this is the real thing, running on the game's own data.
 *
 * EVERY formula here is transcribed, not derived. `tools/shadertest/CHARM-PHYSICS.md`
 * names the source for each one, records the cross-check that the CS2 build still
 * uses the same data contract, and lists what is still unknown (hinge limits).
 * Read it before changing any of this.
 *
 * Three is deliberately absent at runtime — the only three objects touched are
 * Bone.position/quaternion, which need no namespace. Three is dynamically
 * imported once by the viewer so it stays out of the main bundle, and a static
 * import here would undo that. Same reasoning as charmMaterial.ts.
 *
 * Everything is flat typed arrays with module-level scratch: 20 nodes x 10
 * iterations is enough traffic that allocating vectors per constraint would show
 * up in the ?perf=1 charm bucket as GC.
 */
import type * as ThreeNS from "three";

/** The parsed <stem>.phys.json. Structure-of-arrays, in Source inches. */
export interface FeModel {
  name: string;
  nodes: number;
  /** Nodes [0, static) are pinned: invMass 0, driven by the anchor. */
  static: number;
  rotLockStatic: number;
  /** Nodes >= this are written by the node bases, never integrated. */
  firstPosDriven: number;
  iters: number;
  gravityScale: number;
  sleep: boolean;
  /** node -> bone name; `$`-prefixed entries are virtual and have no bone. */
  ctrl: string[];
  invMass: Float32Array;
  /** Per DYNAMIC node — index with [node - static]. Empty when all zero. */
  radius: Float32Array;
  friction: Float32Array;
  /** 3 per node, the authored rest pose. */
  initPos: Float32Array;
  free: Int32Array;
  /** Quads are sorted by static-node count; these are the range boundaries. */
  quadCount1: number;
  quadCount2: number;
  quadNode: Int32Array; // 4 per quad
  quadShape: Float32Array; // 16 per quad (4 x Vector4D)
  rodNode: Int32Array; // 2 per rod
  rodMin: Float32Array;
  rodMax: Float32Array;
  rodWeight0: Float32Array;
  rodRelax: Float32Array;
  axialNode: Int32Array; // 6 per edge
  axialTe: Float32Array;
  axialTv: Float32Array;
  axialDist: Float32Array;
  axialWeight: Float32Array; // 4 per edge
  baseNode: Int32Array;
  baseX0: Int32Array;
  baseX1: Int32Array;
  baseY0: Int32Array;
  baseY1: Int32Array;
  baseAdjust: Float32Array; // 4 per base, xyzw
  gravity: Float32Array; // per node
  pointDamping: Float32Array; // per node
  /** Rigid attachments: ctrl `child` sits at `offset` in ctrl `parent`'s frame. */
  offChild: Int32Array;
  offParent: Int32Array;
  offVec: Float32Array; // 3 per entry
  /** Bone ctrl `ctrl` is positioned so that `node` lands at `offset` in its frame. */
  revCtrl: Int32Array;
  revNode: Int32Array;
  revVec: Float32Array; // 3 per entry
}

/** Shape of the extracted sidecar. Only the fields the solver reads. */
interface FeJson {
  name: string;
  nodes: number;
  static: number;
  rotLockStatic: number;
  firstPosDriven: number;
  iters: number;
  gravityScale: number;
  sleep: boolean;
  ctrl: string[];
  invMass: number[];
  radius: number[];
  friction: number[];
  initPos: number[];
  free: number[];
  quadCount1: number;
  quadCount2: number;
  quads: { n: number[]; slack: number[]; shape: number[] };
  rods: { n: number[]; min: number[]; max: number[]; w0: number[]; relax: number[] };
  axial: { n: number[]; te: number[]; tv: number[]; dist: number[]; w: number[] };
  bases: { n: number[]; x0: number[]; x1: number[]; y0: number[]; y1: number[]; q: number[] };
  integrator: { damping: number[]; animForce: number[]; animVertex: number[]; gravity: number[] };
  ctrlOffsets: Array<{ o: number[]; parent: number; child: number }>;
  reverseOffsets: Array<{ o: number[]; ctrl: number; node: number }>;
}

export function parseFeModel(j: FeJson): FeModel {
  const i32 = (a: number[]) => Int32Array.from(a ?? []);
  const f32 = (a: number[]) => Float32Array.from(a ?? []);
  return {
    name: j.name,
    nodes: j.nodes,
    static: j.static,
    rotLockStatic: j.rotLockStatic,
    firstPosDriven: j.firstPosDriven,
    iters: j.iters,
    gravityScale: j.gravityScale || 1,
    sleep: j.sleep,
    ctrl: j.ctrl,
    invMass: f32(j.invMass),
    radius: f32(j.radius),
    friction: f32(j.friction),
    initPos: f32(j.initPos),
    free: i32(j.free),
    quadCount1: j.quadCount1,
    quadCount2: j.quadCount2,
    quadNode: i32(j.quads.n),
    quadShape: f32(j.quads.shape),
    rodNode: i32(j.rods.n),
    rodMin: f32(j.rods.min),
    rodMax: f32(j.rods.max),
    rodWeight0: f32(j.rods.w0),
    rodRelax: f32(j.rods.relax),
    axialNode: i32(j.axial.n),
    axialTe: f32(j.axial.te),
    axialTv: f32(j.axial.tv),
    axialDist: f32(j.axial.dist),
    axialWeight: f32(j.axial.w),
    baseNode: i32(j.bases.n),
    baseX0: i32(j.bases.x0),
    baseX1: i32(j.bases.x1),
    baseY0: i32(j.bases.y0),
    baseY1: i32(j.bases.y1),
    baseAdjust: f32(j.bases.q),
    gravity: f32(j.integrator.gravity),
    pointDamping: f32(j.integrator.damping),
    offChild: i32((j.ctrlOffsets ?? []).map((o) => o.child)),
    offParent: i32((j.ctrlOffsets ?? []).map((o) => o.parent)),
    offVec: f32((j.ctrlOffsets ?? []).flatMap((o) => o.o)),
    revCtrl: i32((j.reverseOffsets ?? []).map((o) => o.ctrl)),
    revNode: i32((j.reverseOffsets ?? []).map((o) => o.node)),
    revVec: f32((j.reverseOffsets ?? []).flatMap((o) => o.o)),
  };
}

export interface CharmSim {
  model: FeModel;
  /** Current and previous node positions, 3 per node, charm-local inches. */
  pos: Float32Array;
  prev: Float32Array;
  /** Where the pinned nodes are held. Moves only when the charm is dragged. */
  anchor: Float32Array;
  /** ctrl index -> the bone it drives, or null. */
  bones: (ThreeNS.Bone | null)[];
  /** The object whose local space the sim runs in: the bones' parent. Null in
   *  the headless checks, which have no scene graph. */
  space: ThreeNS.Object3D | null;
  /** Bases sorted so a bone's parent is always solved before it. */
  baseOrder: Int32Array;
  /** For each node that drives a bone: the node of the nearest ANCESTOR bone
   *  that the sim also drives, or -1 when the bone hangs directly off `space`.
   *  Used to turn a charm-space frame into the local one three wants. */
  boneParent: Int32Array;
  /**
   * The nodes actually integrated: the free nodes minus the ones no constraint
   * touches.
   *
   * A free node that appears in no quad, rod or axial edge is not simulated —
   * nothing could determine where it goes. Those are the `$cloth_node_body*`
   * proxies: they carry a collision radius and friction but no constraint, and
   * m_CtrlOffsets rigidly attaches them to a bone. They exist so the charm's
   * rigid body collides, and they follow the bone. Integrating them makes them
   * fall through the world at exactly free-fall speed, which is how this was
   * found.
   */
  dynamic: Int32Array;
  /** Ctrl-offset entries whose child is such a driven node, as [entry...]. */
  drivenOffsets: Int32Array;
  /** 12 per node for every ctrl that a node base or reverse offset writes:
   *  3x3 column-major basis then origin. Only the driven-node placement and the
   *  bone write read it, so it is only filled for those ctrls. */
  frames: Float32Array;
  /** Per node, 0 at the anchor to 1 at the far end of the chain. How much of a
   *  body push each node is allowed to absorb — see collideBody. */
  chainWeight: Float32Array;
  /**
   * Rolling fraction of recent steps spent in contact, 0..1.
   *
   * A plain consecutive-step counter does not work: a charm stuck against
   * geometry does not hold contact solidly, it oscillates in and out of it —
   * that IS the buzz — so the counter reset every other step and the give-up
   * ramp never engaged. Measured on the jammed AK: 43 contacts in 180 steps of
   * unbroken buzzing. An average sees the duty cycle for what it is.
   */
  contactLoad: number;
  /** Largest distance a node may move in one step, in inches — the anti-tunnel
   *  bound. Derived from the smallest collision radius the model actually uses,
   *  so a charm with fat proxies is allowed to move faster than one with thin. */
  maxTravel: number;
  asleep: boolean;
  calm: number;
  /** Fixed-step accumulator, so the sim runs at H regardless of frame rate. */
  acc: number;
  lastDt: number;
  /** Set when a node was pushed out of geometry this step — see stepCharmSim. */
  contact: boolean;
}

/**
 * Fixed simulation step. Frame-coupled stepping makes the charm swing 2.4x too
 * fast on a 144Hz display, which is exactly the bug the old pendulum had.
 *
 * 120Hz rather than 60: contact stability is governed by how far a node travels
 * between queries, so halving the step halves the worst penetration and lets the
 * anti-tunnel clamp bind far less often. It is affordable because the collider
 * query is a grid lookup rather than a scan.
 */
export const CHARM_STEP = 1 / 120;
/** A stalled tab must not be able to trigger a 500-step catch-up. */
const MAX_SUBSTEPS = 4;

/**
 * Query world geometry for a contact. Supplied by the viewer, which owns the
 * baked collider.
 *
 * Returns false for no contact. On a hit, `out` is the unit normal to push
 * along (out[0..2], pointing away from the surface) and the penetration depth
 * (out[3]). The NORMAL is what matters and is why this does not simply hand back
 * a corrected point: separating the normal from the tangent is the difference
 * between a charm that rests against the gun and one that stutters on it.
 */
export type ContactFn = (
  x: number,
  y: number,
  z: number,
  radius: number,
  out: Float32Array,
) => boolean;

// ---- scratch ---------------------------------------------------------------
const ax = new Float32Array(3);
const ay = new Float32Array(3);
const az = new Float32Array(3);
const tmpA = new Float32Array(3);
const tmpB = new Float32Array(3);
const tmpC = new Float32Array(3);
/** 4 wide: contact queries return a normal AND a penetration depth. */
const tmpOut = new Float32Array(4);
const rr = new Float32Array(12); // r[4] for the quad solve
const xx = new Float32Array(12); // x[4]
const cov = new Float32Array(6); // diag.xyz, XY, XZ, YZ
const rhs = new Float32Array(3);
const omega = new Float32Array(3);
const m3 = new Float32Array(9); // a driven bone's frame, column-major xyz axes
const m3b = new Float32Array(9); // the same frame rebased onto the parent bone
const qm = new Float32Array(9);
const mParent = new Float32Array(16);
const quadIdx = new Int32Array(4);
const quadW = new Float32Array(4);

// ---- small vector helpers (on flat arrays, no allocation) ------------------
function sub3(o: Float32Array, a: Float32Array, i: number, b: Float32Array, j: number) {
  o[0] = a[i] - b[j];
  o[1] = a[i + 1] - b[j + 1];
  o[2] = a[i + 2] - b[j + 2];
}
function dot3(a: Float32Array, b: Float32Array) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(o: Float32Array, a: Float32Array, b: Float32Array) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  o[2] = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
}
function norm3(o: Float32Array, fx: number, fy: number, fz: number) {
  const l = Math.hypot(o[0], o[1], o[2]);
  if (l > 1e-12) {
    o[0] /= l;
    o[1] /= l;
    o[2] /= l;
  } else {
    o[0] = fx;
    o[1] = fy;
    o[2] = fz;
  }
  return l;
}

/** Any unit vector orthogonal to `v`. Picked off the smallest component so it
 *  stays stable rather than degenerating when v is near an axis. */
function perpendicular(o: Float32Array, v: Float32Array) {
  const ax_ = Math.abs(v[0]), ay_ = Math.abs(v[1]), az_ = Math.abs(v[2]);
  if (ax_ <= ay_ && ax_ <= az_) {
    o[0] = 0; o[1] = -v[2]; o[2] = v[1];
  } else if (ay_ <= az_) {
    o[0] = -v[2]; o[1] = 0; o[2] = v[0];
  } else {
    o[0] = -v[1]; o[1] = v[0]; o[2] = 0;
  }
  norm3(o, 1, 0, 0);
}

// ---- construction ----------------------------------------------------------

/**
 * Bind a parsed FeModel to a loaded charm GLB.
 *
 * Returns null rather than a partly-wired sim whenever anything fails to line
 * up: the viewer then keeps its pendulum, which is a worse charm but never a
 * broken one. A sim that drives no bones would just freeze the charm at bind
 * pose while claiming to be simulating it.
 */
export function buildCharmSim(model: FeModel, root: ThreeNS.Object3D): CharmSim | null {
  const byName = new Map<string, ThreeNS.Bone>();
  root.traverse((o) => {
    const b = o as ThreeNS.Bone;
    if (b.isBone) byName.set(b.name, b);
  });

  const bones: (ThreeNS.Bone | null)[] = new Array(model.nodes).fill(null);
  let matched = 0;
  for (let n = 0; n < model.nodes; n++) {
    const name = model.ctrl[n];
    if (!name || name.startsWith("$")) continue; // virtual ctrl, no bone by construction
    const bone = byName.get(name);
    if (!bone) continue;
    bones[n] = bone;
    matched++;
  }
  if (!matched) return null;

  // The units argument, enforced per charm rather than trusted: the FeModel rest
  // pose and the GLB bind pose are the same numbers in the same space.
  //
  // Only the ROOT bone can be checked this way, and only against a
  // non-position-driven ctrl. `bone.position` is relative to the bone's PARENT,
  // while initPos is in the charm's own space, so they coincide for the bone
  // whose parent IS that space and for no other. And a position-driven ctrl's
  // initPos is its NODE position, which the reverse offsets deliberately move
  // the bone away from — comparing those two is comparing different quantities.
  // (Checking every bone against its raw local position instead is what this
  // originally did, and it rejected every charm in the catalogue.)
  for (let n = 0; n < model.nodes; n++) {
    const bone = bones[n];
    if (!bone || n >= model.firstPosDriven) continue;
    if (bone.parent && (bone.parent as ThreeNS.Bone).isBone) continue; // not the root
    const dx = bone.position.x - model.initPos[n * 3];
    const dy = bone.position.y - model.initPos[n * 3 + 1];
    const dz = bone.position.z - model.initPos[n * 3 + 2];
    const off = Math.hypot(dx, dy, dz);
    if (off > 1e-3) {
      console.warn(
        `[charm] ${model.name}: root bone ${model.ctrl[n]} sits ${off.toFixed(5)}in from its ` +
          `FeModel rest position — the rig is not in the space the sim expects, not simulating`,
      );
      return null;
    }
  }

  // Solve each base only after any base that drives its bone's parent, so the
  // local TRS conversion below always sees an up-to-date parent world matrix.
  const depth = (n: number) => {
    let d = 0;
    for (let o: ThreeNS.Object3D | null = bones[n] ?? null; o; o = o.parent) d++;
    return d;
  };
  const order = Array.from(model.baseNode.keys()).sort(
    (a, b) => depth(model.baseNode[a]) - depth(model.baseNode[b]),
  );

  const sim = bareCharmSim(model);
  sim.bones = bones;
  sim.baseOrder = Int32Array.from(order);
  // Map each driven bone to the driven bone above it, so writeBones can rebase a
  // charm-space frame without ever touching a world matrix.
  const nodeOf = new Map<ThreeNS.Object3D, number>();
  bones.forEach((b, n) => b && nodeOf.set(b, n));
  sim.boneParent = new Int32Array(model.nodes).fill(-1);
  for (let n = 0; n < model.nodes; n++) {
    if (!bones[n]) continue;
    for (let o = bones[n]!.parent; o; o = o.parent) {
      const p = nodeOf.get(o);
      if (p !== undefined) {
        sim.boneParent[n] = p;
        break;
      }
    }
  }
  // Every bone shares one parent (the vmdl root node under the GLB scene), and
  // that parent IS the space initPos is expressed in.
  sim.space = bones.find((b) => b)?.parent ?? null;
  return sim;
}

/**
 * A sim with no bones attached. The solver core never needs them, so this is
 * what the headless checks in tools/charmsim-check.ts run on — and it is the
 * single place the state is laid out, so a check can't drift from the real
 * thing by constructing it slightly differently.
 */
export function bareCharmSim(model: FeModel): CharmSim {
  return {
    model,
    pos: Float32Array.from(model.initPos),
    prev: Float32Array.from(model.initPos),
    anchor: Float32Array.from(model.initPos.subarray(0, model.static * 3)),
    bones: new Array(model.nodes).fill(null),
    space: null,
    baseOrder: Int32Array.from(model.baseNode.keys()),
    boneParent: new Int32Array(model.nodes).fill(-1),
    ...splitDrivenNodes(model),
    frames: new Float32Array(model.nodes * 12),
    maxTravel: maxTravelFor(model),
    chainWeight: chainWeightsFor(model),
    contactLoad: 0,
    asleep: false,
    calm: 0,
    acc: 0,
    lastDt: CHARM_STEP,
    contact: false,
  };
}

/**
 * How freely each node may be displaced by a body contact: 0 for the pinned
 * nodes, rising to 1 at the far end of the chain.
 *
 * Measured as rest distance from the anchor, normalised. Crude compared to
 * solving the contact against the constraint system properly, but it captures
 * the thing that matters — a node next to the pin cannot move, so do not ask it
 * to and then let the constraints argue about it.
 */
function chainWeightsFor(model: FeModel): Float32Array {
  const w = new Float32Array(model.nodes);
  let ax = 0, ay = 0, az = 0;
  for (let n = 0; n < model.static; n++) {
    ax += model.initPos[n * 3];
    ay += model.initPos[n * 3 + 1];
    az += model.initPos[n * 3 + 2];
  }
  const s = Math.max(1, model.static);
  ax /= s; ay /= s; az /= s;
  let far = 0;
  for (let n = 0; n < model.nodes; n++) {
    const d = Math.hypot(
      model.initPos[n * 3] - ax,
      model.initPos[n * 3 + 1] - ay,
      model.initPos[n * 3 + 2] - az,
    );
    w[n] = d;
    if (d > far) far = d;
  }
  if (far > 0) for (let n = 0; n < model.nodes; n++) w[n] /= far;
  return w;
}

/**
 * Half the smallest collision radius the model actually uses.
 *
 * Half, so that even a node moving flat-out only ever buries itself to half its
 * own depth and the nearest surface is unambiguously the one it came through.
 * Charms with no radii at all cannot tunnel through anything, so they get a
 * generous bound off the rest pose instead of a meaningless one.
 */
function maxTravelFor(model: FeModel): number {
  let smallest = Infinity;
  for (const r of model.radius) if (r > 0 && r < smallest) smallest = r;
  if (smallest === Infinity) {
    let far = 0;
    for (let n = 0; n < model.nodes; n++) {
      far = Math.max(far, Math.hypot(model.initPos[n * 3], model.initPos[n * 3 + 1], model.initPos[n * 3 + 2]));
    }
    return Math.max(far * 0.25, 0.05);
  }
  return smallest * 0.5;
}

/** Separate the free nodes into the ones a constraint holds (integrate them) and
 *  the ones only a ctrl offset holds (place them from their parent bone). */
function splitDrivenNodes(model: FeModel) {
  const held = new Set<number>();
  for (const arr of [model.quadNode, model.rodNode, model.axialNode]) {
    for (const n of arr) held.add(n);
  }
  const dynamic: number[] = [];
  const driven = new Set<number>();
  for (const n of model.free) {
    if (held.has(n)) dynamic.push(n);
    else driven.add(n);
  }
  const drivenOffsets: number[] = [];
  for (let i = 0; i < model.offChild.length; i++) {
    if (driven.has(model.offChild[i])) drivenOffsets.push(i);
  }
  return { dynamic: Int32Array.from(dynamic), drivenOffsets: Int32Array.from(drivenOffsets) };
}

/** Put every node back on the authored rest pose, at rest. */
export function resetCharmSim(sim: CharmSim) {
  sim.pos.set(sim.model.initPos);
  sim.prev.set(sim.model.initPos);
  sim.anchor.set(sim.model.initPos.subarray(0, sim.model.static * 3));
  sim.acc = 0;
  sim.calm = 0;
  sim.asleep = false;
}

/**
 * Re-hang the rig on the authored rest pose WITHOUT moving the anchor.
 *
 * resetCharmSim's sibling for a charm that is already somewhere: the anchor
 * stays exactly where the drag put it and the rest of the rig is rebuilt around
 * it, so the charm re-hangs in place instead of teleporting back to the model
 * origin.
 *
 * The escape hatch for a rig that has ended up somewhere the constraints cannot
 * walk it back from — chiefly the far side of a thin part, where the rods are
 * satisfied, the contact push holds it there, and no amount of dragging brings
 * it round. See the reseat in viewer3d's drag.
 */
export function reseatCharmSim(sim: CharmSim) {
  const { initPos } = sim.model;
  // Every pinned node moved by the same delta (see moveCharmAnchor), so node 0
  // carries the whole of where the anchor has travelled since load.
  const dx = sim.anchor[0] - initPos[0];
  const dy = sim.anchor[1] - initPos[1];
  const dz = sim.anchor[2] - initPos[2];
  for (let n = 0; n < sim.model.nodes; n++) {
    const i = n * 3;
    sim.pos[i] = initPos[i] + dx;
    sim.pos[i + 1] = initPos[i + 1] + dy;
    sim.pos[i + 2] = initPos[i + 2] + dz;
  }
  sim.prev.set(sim.pos); // at rest: verlet carries velocity in the delta
  sim.acc = 0;
  sim.calm = 0;
  sim.asleep = false;
  sim.contactLoad = 0;
}

// ---- the solver ------------------------------------------------------------

/**
 * Verlet integration, transcribed from CSoftbody::Predict.
 *
 *   timestepScale = (1 - velocityDamping) * (1 + overPredict) * dt / max(0.25 dt, lastDt)
 *   pos0 = pos1 + (pos1 - pos0) * timestepScale + flGravity * gravityStep
 *
 * with velocityDamping and overPredict both 0 for charms, so timestepScale is
 * exactly 1 at a fixed step. NOTHING here removes energy, and that is correct —
 * see CHARM-PHYSICS.md. All dissipation comes from the constraint projections.
 * Do not "fix" a ringing charm by adding damping; fix the constraint that is
 * wrong.
 *
 * Gravity is applied along `g`, which the caller supplies already normalised.
 * The engine uses local -Z; we take a direction instead so the viewer can hand
 * us camera-frame down.
 */
function predict(sim: CharmSim, dt: number, g: Float32Array) {
  const m = sim.model;
  const scale = dt / Math.max(0.25 * dt, sim.lastDt);
  const gStep = m.gravityScale * dt * dt;
  const { pos, prev } = sim;
  for (let k = 0; k < sim.dynamic.length; k++) {
    const n = sim.dynamic[k];
    const i = n * 3;
    const gn = m.gravity[n] * gStep;
    // flPointDamping is 0 on every charm in this build, but the term is real and
    // the data could carry it, so honour it rather than asserting it away.
    const damp = m.pointDamping[n] > 0 ? Math.max(0, 1 - m.pointDamping[n] * dt) : 1;
    let vx = (pos[i] - prev[i]) * scale * damp + g[0] * gn;
    let vy = (pos[i + 1] - prev[i + 1]) * scale * damp + g[1] * gn;
    let vz = (pos[i + 2] - prev[i + 2]) * scale * damp + g[2] * gn;
    // ANTI-TUNNEL. A node that travels further than its own collision radius in
    // one step can end up on the far side of the weapon's shell, and the contact
    // query — which only knows "nearest surface" — then pushes it out through the
    // WRONG side. That is what a fast camera swing looked like: the charm
    // suddenly inside the gun, thrashing. Clamping the step keeps every
    // penetration shallow enough that the nearest surface is the right one.
    const travel = Math.hypot(vx, vy, vz);
    if (travel > sim.maxTravel) {
      const k = sim.maxTravel / travel;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    prev[i] = pos[i];
    prev[i + 1] = pos[i + 1];
    prev[i + 2] = pos[i + 2];
    pos[i] += vx;
    pos[i + 1] += vy;
    pos[i + 2] += vz;
  }
  // Static nodes are held at the anchor. In the engine these follow the animated
  // parent bone; here the anchor only moves while the charm is being dragged.
  for (let n = 0; n < m.static; n++) {
    const i = n * 3;
    prev[i] = pos[i];
    prev[i + 1] = pos[i + 1];
    prev[i + 2] = pos[i + 2];
    pos[i] = sim.anchor[i];
    pos[i + 1] = sim.anchor[i + 1];
    pos[i + 2] = sim.anchor[i + 2];
  }
}

/** CFeModel::RelaxRods2. `ftl` is the follow-the-leader variant the engine runs
 *  on the last iteration, which moves only the second node. */
function relaxRods(sim: CharmSim, ftl: boolean) {
  const m = sim.model;
  const p = sim.pos;
  for (let r = 0; r < m.rodMin.length; r++) {
    const a = m.rodNode[r * 2] * 3;
    const b = m.rodNode[r * 2 + 1] * 3;
    const dx = p[b] - p[a];
    const dy = p[b + 1] - p[a + 1];
    const dz = p[b + 2] - p[a + 2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-9) continue;
    const req = Math.min(Math.max(dist, m.rodMin[r]), m.rodMax[r]);
    const k = m.rodRelax[r] * (req / dist - 1);
    const ex = dx * k, ey = dy * k, ez = dz * k;
    if (ftl) {
      p[b] += ex;
      p[b + 1] += ey;
      p[b + 2] += ez;
    } else {
      const w = m.rodWeight0[r];
      p[a] -= ex * w;
      p[a + 1] -= ey * w;
      p[a + 2] -= ez * w;
      p[b] += ex * (1 - w);
      p[b + 1] += ey * (1 - w);
      p[b + 2] += ez * (1 - w);
    }
  }
}

/** CFeModel::RelaxBend — the axial-edge bending constraint. */
function relaxBend(sim: CharmSim, stiffness: number) {
  const m = sim.model;
  const p = sim.pos;
  for (let e = 0; e < m.axialTe.length; e++) {
    const n = e * 6;
    const i0 = m.axialNode[n] * 3, i1 = m.axialNode[n + 1] * 3;
    const i2 = m.axialNode[n + 2] * 3, i3 = m.axialNode[n + 3] * 3;
    const i4 = m.axialNode[n + 4] * 3, i5 = m.axialNode[n + 5] * 3;
    const te = m.axialTe[e], tvHalf = m.axialTv[e] * 0.5;
    for (let c = 0; c < 3; c++) {
      const fe = p[i0 + c] * (1 - te) + p[i1 + c] * te;
      const fv = (p[i2 + c] + p[i3 + c]) * (0.5 - tvHalf) + (p[i4 + c] + p[i5 + c]) * tvHalf;
      tmpA[c] = fv - fe; // axis
      tmpB[c] = p[i1 + c] - p[i0 + c]; // edge
      tmpC[c] = p[i4 + c] + p[i5 + c] - p[i2 + c] - p[i3 + c]; // virtual edge
    }
    const axisLen = Math.hypot(tmpA[0], tmpA[1], tmpA[2]);
    cross3(tmpOut, tmpB, tmpC); // crossEdges
    let correction: number;
    if (axisLen > 0.001) {
      // The sign flip detects an edge pair that has crossed over, and pushes it
      // back rather than driving it further through.
      const adj = dot3(tmpA, tmpOut) > 0 ? -m.axialDist[e] : m.axialDist[e];
      correction = 1 + adj / axisLen;
    } else {
      const cl = Math.hypot(tmpOut[0], tmpOut[1], tmpOut[2]);
      if (cl > 1e-30) {
        tmpA[0] = tmpOut[0]; tmpA[1] = tmpOut[1]; tmpA[2] = tmpOut[2];
        correction = m.axialDist[e] / cl;
      } else {
        tmpA[0] = 0; tmpA[1] = 0; tmpA[2] = 1;
        correction = m.axialDist[e];
      }
    }
    const k = stiffness * correction;
    const w = e * 4;
    const w0 = m.axialWeight[w], w1 = m.axialWeight[w + 1];
    const w2 = m.axialWeight[w + 2], w3 = m.axialWeight[w + 3];
    for (let c = 0; c < 3; c++) {
      const d = tmpA[c] * k;
      p[i0 + c] += d * w0;
      p[i1 + c] += d * w1;
      // Careful: weight 2 goes to BOTH nodes 2 and 3, weight 3 to both 4 and 5.
      p[i2 + c] += d * w2;
      p[i3 + c] += d * w2;
      p[i4 + c] += d * w3;
      p[i5 + c] += d * w3;
    }
  }
}

/** CFeBasis: X from the first tentative axis, Y orthogonalized against it. */
function feBasis(tx: Float32Array, ty: Float32Array) {
  ax[0] = tx[0]; ax[1] = tx[1]; ax[2] = tx[2];
  norm3(ax, 1, 0, 0);
  const d = dot3(ty, ax);
  ay[0] = ty[0] - ax[0] * d;
  ay[1] = ty[1] - ax[1] * d;
  ay[2] = ty[2] - ax[2] * d;
  norm3(ay, 0, 1, 0);
  cross3(az, ax, ay);
}

function localToWorld(o: Float32Array, x: number, y: number, z: number) {
  o[0] = x * ax[0] + y * ay[0] + z * az[0];
  o[1] = x * ax[1] + y * ay[1] + z * az[1];
  o[2] = x * ax[2] + y * ay[2] + z * az[2];
}

/** Cholesky decomposition of a symmetric 3x3, then LL'x = rhs. The "safe"
 *  reciprocals matter: a degenerate covariance must yield 0, not NaN, or one
 *  bad frame poisons every subsequent one. */
function choleskySolve(a00: number, a10: number, a11: number, a20: number, a21: number, a22: number,
                       b: Float32Array, out: Float32Array) {
  const safeSqrt = (v: number) => (v > 0 ? Math.sqrt(v) : 0);
  const safeRecip = (v: number) => (v > 1e-20 ? 1 / v : 0);
  const m00 = safeSqrt(a00), inv00 = safeRecip(m00);
  const m10 = a10 * inv00;
  const m11 = safeSqrt(a11 - m10 * m10), inv11 = safeRecip(m11);
  const m20 = a20 * inv00;
  const m21 = (a21 - m20 * m10) * inv11;
  const m22 = safeSqrt(a22 - m20 * m20 - m21 * m21), inv22 = safeRecip(m22);
  // SolveLeft
  const lx = inv00 * b[0];
  const ly = inv11 * (b[1] - m10 * lx);
  const lz = inv22 * (b[2] - m20 * lx - m21 * ly);
  // SolveRight
  out[2] = inv22 * lz;
  out[1] = inv11 * (ly - m21 * out[2]);
  out[0] = inv00 * (lx - m20 * out[2] - m10 * out[1]);
}

/**
 * CFeModel::RelaxQuads — shape matching, solved as Wahba's problem.
 *
 * vShape[i] is the relaxed configuration with the centre of mass at the origin
 * and .w the node's weight. Each quad finds the rotation that best maps the rest
 * shape onto the current one and snaps the nodes onto it. That projection is
 * where all of the charm's energy loss comes from.
 *
 * Three variants by how many of the quad's nodes are pinned; the array is sorted
 * so the boundaries are quadCount2 and quadCount1.
 */
function relaxQuads(sim: CharmSim) {
  const m = sim.model;
  const p = sim.pos;
  const total = m.quadNode.length / 4;
  for (let q = 0; q < total; q++) {
    const nn = q * 4;
    const i0 = m.quadNode[nn] * 3, i1 = m.quadNode[nn + 1] * 3;
    const i2 = m.quadNode[nn + 2] * 3, i3 = m.quadNode[nn + 3] * 3;
    const s = q * 16;
    if (q < m.quadCount2) {
      // Two static nodes: the quad can only rotate about the edge 0-1, so this
      // collapses to a 2D problem in the YZ plane of that edge's frame.
      for (let c = 0; c < 3; c++) {
        tmpA[c] = p[i1 + c] - p[i0 + c];
        tmpB[c] = p[i2 + c] + p[i3 + c] - 2 * p[i0 + c];
      }
      feBasis(tmpA, tmpB);
      const cx = (p[i0] + p[i1]) * 0.5;
      const cy = (p[i0 + 1] + p[i1 + 1]) * 0.5;
      const cz = (p[i0 + 2] + p[i1 + 2]) * 0.5;
      tmpA[0] = p[i2] - cx; tmpA[1] = p[i2 + 1] - cy; tmpA[2] = p[i2 + 2] - cz;
      tmpB[0] = p[i3] - cx; tmpB[1] = p[i3 + 1] - cy; tmpB[2] = p[i3 + 2] - cz;
      const l2y = dot3(tmpA, ay), l2z = dot3(tmpA, az);
      const l3y = dot3(tmpB, ay), l3z = dot3(tmpB, az);
      const s2y = m.quadShape[s + 9], s2z = m.quadShape[s + 10], m2 = m.quadShape[s + 11];
      const s3y = m.quadShape[s + 13], s3z = m.quadShape[s + 14], m3w = m.quadShape[s + 15];
      // Sine term is cross2(shape, local), i.e. the OPPOSITE order to the one the
      // CS:GO-era source uses. That version is not invariant to the roll of the
      // YZ frame, and this frame's roll is decided by numerical residue: at rest
      // the tentative Y (p2+p3-2*p0) is nearly parallel to the edge, so which way
      // Y ends up pointing comes down to the last decimal of the node positions.
      // With the other sign every one of the 62 charms in this build flips its
      // rest pose through 180 degrees on the first step; with this one every one
      // of them holds still. See CHARM-PHYSICS.md.
      const wc = (l2y * s2y + l2z * s2z) * m2 + (l3y * s3y + l3z * s3z) * m3w;
      const ws = (s2y * l2z - s2z * l2y) * m2 + (s3y * l3z - s3z * l3y) * m3w;
      const wl = Math.hypot(wc, ws);
      const co = wl > 1e-30 ? wc / wl : 1;
      const si = wl > 1e-30 ? ws / wl : 0;
      localToWorld(tmpOut, m.quadShape[s + 8], s2y * co - s2z * si, s2z * co + s2y * si);
      p[i2] = cx + tmpOut[0]; p[i2 + 1] = cy + tmpOut[1]; p[i2 + 2] = cz + tmpOut[2];
      localToWorld(tmpOut, m.quadShape[s + 12], s3y * co - s3z * si, s3z * co + s3y * si);
      p[i3] = cx + tmpOut[0]; p[i3 + 1] = cy + tmpOut[1]; p[i3 + 2] = cz + tmpOut[2];
      continue;
    }

    // One static node (node 0) or none. Same solve; they differ only in where
    // the centre of mass sits and which nodes get written.
    const oneStatic = q < m.quadCount1;
    for (let c = 0; c < 3; c++) {
      tmpA[c] = p[i2 + c] - p[i0 + c];
      tmpB[c] = p[i3 + c] - p[i1 + c];
    }
    feBasis(tmpA, tmpB);
    const w0 = m.quadShape[s + 3], w1 = m.quadShape[s + 7];
    const w2 = m.quadShape[s + 11], w3 = m.quadShape[s + 15];
    let cx: number, cy: number, cz: number;
    if (oneStatic) {
      cx = p[i0]; cy = p[i0 + 1]; cz = p[i0 + 2];
    } else {
      cx = p[i0] * w0 + p[i1] * w1 + p[i2] * w2 + p[i3] * w3;
      cy = p[i0 + 1] * w0 + p[i1 + 1] * w1 + p[i2 + 1] * w2 + p[i3 + 1] * w3;
      cz = p[i0 + 2] * w0 + p[i1 + 2] * w1 + p[i2 + 2] * w2 + p[i3 + 2] * w3;
    }
    quadIdx[0] = i0; quadIdx[1] = i1; quadIdx[2] = i2; quadIdx[3] = i3;
    quadW[0] = w0; quadW[1] = w1; quadW[2] = w2; quadW[3] = w3;
    const idx = quadIdx;
    const wts = quadW;
    const first = oneStatic ? 1 : 0; // node 0 is pinned in the one-static case
    for (let k = 0; k < 4; k++) {
      xx[k * 3] = p[idx[k]] - cx;
      xx[k * 3 + 1] = p[idx[k] + 1] - cy;
      xx[k * 3 + 2] = p[idx[k] + 2] - cz;
      localToWorld(tmpOut, m.quadShape[s + k * 4], m.quadShape[s + k * 4 + 1], m.quadShape[s + k * 4 + 2]);
      rr[k * 3] = tmpOut[0];
      rr[k * 3 + 1] = tmpOut[1];
      rr[k * 3 + 2] = tmpOut[2];
    }
    cov[0] = cov[1] = cov[2] = cov[3] = cov[4] = cov[5] = 0;
    rhs[0] = rhs[1] = rhs[2] = 0;
    for (let k = first; k < 4; k++) {
      const w = wts[k];
      const x = xx[k * 3], y = xx[k * 3 + 1], z = xx[k * 3 + 2];
      const rx = rr[k * 3], ry = rr[k * 3 + 1], rz = rr[k * 3 + 2];
      // rhs = -sum(m * cross(x, r))
      rhs[0] -= w * (y * rz - z * ry);
      rhs[1] -= w * (z * rx - x * rz);
      rhs[2] -= w * (x * ry - y * rx);
      // CovMatrix3::AddForWahba
      cov[0] += w * (y * y + z * z);
      cov[1] += w * (x * x + z * z);
      cov[2] += w * (x * x + y * y);
      cov[3] -= w * x * y;
      cov[4] -= w * x * z;
      cov[5] -= w * y * z;
    }
    choleskySolve(cov[0], cov[3], cov[1], cov[4], cov[5], cov[2], rhs, omega);
    for (let k = first; k < 4; k++) {
      const rx = rr[k * 3], ry = rr[k * 3 + 1], rz = rr[k * 3 + 2];
      // CSinCosRotation: r + cross(omega, r). A first-order rotation, applied
      // un-normalised — that is the engine's approximation, not an oversight.
      p[idx[k]] = cx + rx + (omega[1] * rz - omega[2] * ry);
      p[idx[k] + 1] = cy + ry + (omega[2] * rx - omega[0] * rz);
      p[idx[k] + 2] = cz + rz + (omega[0] * ry - omega[1] * rx);
    }
  }
}

/**
 * Node bases -> bone transforms.
 *
 * The ordering here had two plausible readings and the wrong one produces a
 * charm that looks almost right. The engine normalises Y FIRST and
 * orthogonalizes X against it; the comment on FeNodeBase_t describes the other
 * branch, which is #if 0'd out. Transcribed from the live one.
 */
function solveFrames(sim: CharmSim) {
  const m = sim.model;
  const p = sim.pos;
  // Frames are computed for every base, bone or not: the reverse offsets and the
  // driven body nodes below read them, and those matter even when nothing is
  // rendering (the headless checks, and a charm whose GLB lacks a bone).
  for (let k = 0; k < sim.baseOrder.length; k++) {
    const b = sim.baseOrder[k];

    sub3(ay, p, m.baseY1[b] * 3, p, m.baseY0[b] * 3);
    norm3(ay, 0, 0, -1);
    sub3(ax, p, m.baseX1[b] * 3, p, m.baseX0[b] * 3);
    const d = dot3(ay, ax);
    ax[0] -= ay[0] * d;
    ax[1] -= ay[1] * d;
    ax[2] -= ay[2] * d;
    if (Math.hypot(ax[0], ax[1], ax[2]) > 0.05) norm3(ax, 1, 0, 0);
    else perpendicular(ax, ay);
    cross3(az, ax, ay);

    // Column-major basis, then the authored adjustment. qAdjust.w == 1 means
    // identity and the engine skips the concat entirely.
    m3[0] = ax[0]; m3[1] = ax[1]; m3[2] = ax[2];
    m3[3] = ay[0]; m3[4] = ay[1]; m3[5] = ay[2];
    m3[6] = az[0]; m3[7] = az[1]; m3[8] = az[2];
    const qi = b * 4;
    const qw = m.baseAdjust[qi + 3];
    if (qw !== 1) applyQAdjust(m3, m.baseAdjust[qi], m.baseAdjust[qi + 1], m.baseAdjust[qi + 2], qw);

    const node = m.baseNode[b];
    const f = node * 12;
    for (let i = 0; i < 9; i++) sim.frames[f + i] = m3[i];
    sim.frames[f + 9] = p[node * 3];
    sim.frames[f + 10] = p[node * 3 + 1];
    sim.frames[f + 11] = p[node * 3 + 2];
  }

  // Reverse offsets refine a bone's ORIGIN: the bone is placed so that its
  // target node lands at the authored offset in the bone's own frame. Without
  // this the bone sits on its own node, which for joint2/joint3 is not where the
  // mesh expects it.
  for (let r = 0; r < m.revCtrl.length; r++) {
    const c = m.revCtrl[r];
    const f = c * 12;
    const o = r * 3;
    const t = m.revNode[r] * 3;
    for (let k = 0; k < 3; k++) {
      const rot =
        sim.frames[f + k] * m.revVec[o] +
        sim.frames[f + 3 + k] * m.revVec[o + 1] +
        sim.frames[f + 6 + k] * m.revVec[o + 2];
      sim.frames[f + 9 + k] = p[t + k] - rot;
    }
    // The engine also writes the bone node's position back into the sim, so the
    // next step integrates from where the bone actually ended up.
    p[c * 3] = sim.frames[f + 9];
    p[c * 3 + 1] = sim.frames[f + 10];
    p[c * 3 + 2] = sim.frames[f + 11];
    sim.prev[c * 3] = p[c * 3];
    sim.prev[c * 3 + 1] = p[c * 3 + 1];
    sim.prev[c * 3 + 2] = p[c * 3 + 2];
  }

  // Then the driven nodes ride their parent bone. CSoftbody::UpdateCtrlOffsets.
  for (let k = 0; k < sim.drivenOffsets.length; k++) {
    const e = sim.drivenOffsets[k];
    const f = m.offParent[e] * 12;
    const o = e * 3;
    const c = m.offChild[e] * 3;
    for (let i = 0; i < 3; i++) {
      p[c + i] =
        sim.frames[f + 9 + i] +
        sim.frames[f + i] * m.offVec[o] +
        sim.frames[f + 3 + i] * m.offVec[o + 1] +
        sim.frames[f + 6 + i] * m.offVec[o + 2];
      sim.prev[c + i] = p[c + i];
    }
  }

}

/** Push the solved frames onto the three bones. Split from the solve because the
 *  solve runs per substep and this only needs to happen once per rendered frame. */
function writeBones(sim: CharmSim) {
  const m = sim.model;
  for (let k = 0; k < sim.baseOrder.length; k++) {
    const b = sim.baseOrder[k];
    const node = m.baseNode[b];
    const bone = sim.bones[node];
    if (!bone) continue;
    const f = node * 12;
    for (let i = 0; i < 9; i++) m3[i] = sim.frames[f + i];
    const p = sim.boneParent[node];
    writeBone(
      bone,
      m3,
      sim.frames[f + 9],
      sim.frames[f + 10],
      sim.frames[f + 11],
      p >= 0 ? sim.frames.subarray(p * 12, p * 12 + 12) : null,
    );
  }
}

/** m3 = m3 * matrix(q), in place. */
function applyQAdjust(m: Float32Array, x: number, y: number, z: number, w: number) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx_ = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  qm[0] = 1 - (yy + zz); qm[1] = xy + wz; qm[2] = xz - wy;
  qm[3] = xy - wz; qm[4] = 1 - (xx_ + zz); qm[5] = yz + wx;
  qm[6] = xz + wy; qm[7] = yz - wx; qm[8] = 1 - (xx_ + yy);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      m3b[c * 3 + r] = m[r] * qm[c * 3] + m[3 + r] * qm[c * 3 + 1] + m[6 + r] * qm[c * 3 + 2];
    }
  }
  for (let i = 0; i < 9; i++) m[i] = m3b[i];
}

/**
 * Write a charm-local frame onto a bone as its LOCAL transform.
 *
 * The sim produces each bone's transform in charm space; three wants it relative
 * to the parent bone, so the parent's world matrix is inverted out. Bases are
 * ordered parent-first, so the parent read here is already this step's value.
 */
function writeBone(
  bone: ThreeNS.Bone,
  basis: Float32Array,
  px: number,
  py: number,
  pz: number,
  parentFrame: Float32Array | null,
) {
  if (parentFrame) {
    // Rebase into the parent BONE's frame. Both frames are in charm space, and
    // both are pure rotations (the rig has no scale), so the inverse of the
    // parent's 3x3 is its transpose.
    //
    // This must NOT reach for parent.matrixWorld: that is a WORLD matrix while
    // the sim works in charm space, and subtracting one from the other collapses
    // every bone onto the anchor — the charm renders as a speck at the clip
    // point, which is exactly how this was found.
    const dx = px - parentFrame[9], dy = py - parentFrame[10], dz = pz - parentFrame[11];
    bone.position.set(
      parentFrame[0] * dx + parentFrame[1] * dy + parentFrame[2] * dz,
      parentFrame[3] * dx + parentFrame[4] * dy + parentFrame[5] * dz,
      parentFrame[6] * dx + parentFrame[7] * dy + parentFrame[8] * dz,
    );
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        m3b[c * 3 + r] =
          parentFrame[r * 3] * basis[c * 3] +
          parentFrame[r * 3 + 1] * basis[c * 3 + 1] +
          parentFrame[r * 3 + 2] * basis[c * 3 + 2];
      }
    }
    setQuaternionFromBasis(bone, m3b);
  } else {
    // Hangs straight off the charm's own space: the frame IS the local one.
    bone.position.set(px, py, pz);
    setQuaternionFromBasis(bone, basis);
  }
  bone.updateMatrix();
}

/** Column-major 3x3 -> quaternion, the standard branchless-ish trace form. */
function setQuaternionFromBasis(bone: ThreeNS.Bone, m: Float32Array) {
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const m01 = m[3], m11 = m[4], m21 = m[5];
  const m02 = m[6], m12 = m[7], m22 = m[8];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  bone.quaternion.set(x, y, z, w);
}

/** Push nodes out of world geometry. Only dynamic nodes with an authored radius
 *  collide — the radii are per dynamic node, so index by [node - static]. */
/**
 * Separate one node from the geometry it is inside.
 *
 * Removes ONLY the inbound normal component of the velocity. Zeroing the whole
 * velocity — which is what this did first, and what the old pendulum did — means
 * a charm resting against the gun cannot slide along it, so every step it sticks,
 * gets pulled by the constraints, un-sticks, and stutters. Keeping the tangent
 * lets it settle.
 *
 * `m_DynNodeFriction` would belong here, but its units and semantics are not
 * recoverable from the leak or the data (it is 1.0 on every body node and absent
 * elsewhere), so no tangential damping is invented. See CHARM-PHYSICS.md.
 */
function separate(sim: CharmSim, i: number, nx: number, ny: number, nz: number, depth: number) {
  const p = sim.pos;
  const prev = sim.prev;
  let vx = p[i] - prev[i], vy = p[i + 1] - prev[i + 1], vz = p[i + 2] - prev[i + 2];
  // A skin so the resolved position sits just clear of the surface rather than
  // exactly on it. Landing exactly on the surface leaves the next query a
  // coin-flip between "touching" and "not", which reads as flicker.
  const push = depth * (1 + CONTACT_SKIN);
  p[i] += nx * push;
  p[i + 1] += ny * push;
  p[i + 2] += nz * push;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn < 0) {
    vx -= nx * vn;
    vy -= ny * vn;
    vz -= nz * vn;
  }
  prev[i] = p[i] - vx;
  prev[i + 1] = p[i + 1] - vy;
  prev[i + 2] = p[i + 2] - vz;
  sim.contact = true;
}

/** Fraction of the penetration depth to over-push, for contact hysteresis. */
const CONTACT_SKIN = 0.02;

/**
 * How far a node may travel between contact samples, as a fraction of its own
 * radius. Below 1 it cannot step over a wall: some sample always lands with the
 * sphere overlapping it.
 */
const SWEEP_STRIDE = 0.75;
/** Cap on samples for one node in one substep. A flick is the only thing that
 *  ever needs more than two, and past this the node is moving so fast that the
 *  velocity clamp upstream is the real answer. */
const SWEEP_MAX_SAMPLES = 12;
/**
 * Where each colliding body proxy sat at the start of the current substep.
 *
 * Module-level and grown on demand rather than stored on the sim: stepping is
 * synchronous and one sim at a time, and this is scratch for the duration of a
 * single substep — it never has to survive one.
 */
let bodyFrom = new Float32Array(0);
function snapshotBodies(sim: CharmSim) {
  const m = sim.model;
  const need = sim.drivenOffsets.length * 3;
  if (bodyFrom.length < need) bodyFrom = new Float32Array(need);
  for (let k = 0; k < sim.drivenOffsets.length; k++) {
    const i = m.offChild[sim.drivenOffsets[k]] * 3;
    bodyFrom[k * 3] = sim.pos[i];
    bodyFrom[k * 3 + 1] = sim.pos[i + 1];
    bodyFrom[k * 3 + 2] = sim.pos[i + 2];
  }
}
/** Set by sweptContact when the hit was a genuine CROSSING — the node was clear
 *  at the start of the substep and inside by the end — rather than a standing
 *  penetration. See the give-up ramp in collideBody, which such a hit ignores. */
let sweptCrossing = false;

/**
 * The FIRST contact along the segment a node travelled this substep, rather
 * than whatever is true where it happened to land.
 *
 * This is the whole fix for tunnelling. The discrete test asks "is this sphere
 * inside anything" at one point, so anything thinner than a node's own step is
 * invisible to it: a flick's release kick moves the charm's body further in one
 * substep than a magazine is thick, the test sees clear air on both sides, and
 * the charm settles on the far side of the weapon with the rods perfectly happy.
 *
 * Sampling, not an analytic swept-sphere: the contact query is a closest-point
 * query against a triangle grid, so walking the segment in steps shorter than
 * the sphere reuses it exactly and cannot step over a wall. Steps are only spent
 * when the node actually moved that far — at rest this is a single query, which
 * is what it was before.
 *
 * `out` comes back as the correction FROM WHERE THE NODE ENDED UP: direction in
 * 0..2, distance in 3, same shape the callers already apply.
 */
function sweptContact(
  contact: ContactFn,
  fx: number, fy: number, fz: number,
  tx: number, ty: number, tz: number,
  r: number,
  out: Float32Array,
): boolean {
  sweptCrossing = false;
  const dx = tx - fx, dy = ty - fy, dz = tz - fz;
  const travel = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const stride = r * SWEEP_STRIDE;
  // Short hop: where it landed is the only place it could have touched.
  if (!(travel > stride)) return contact(tx, ty, tz, r, out);
  const steps = Math.min(SWEEP_MAX_SAMPLES, Math.ceil(travel / stride));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const sx = fx + dx * t, sy = fy + dy * t, sz = fz + dz * t;
    if (!contact(sx, sy, sz, r, out)) continue;
    // Where it should have stopped: clear of the surface at the crossing.
    const px = sx + out[0] * out[3] * (1 + CONTACT_SKIN);
    const py = sy + out[1] * out[3] * (1 + CONTACT_SKIN);
    const pz = sz + out[2] * out[3] * (1 + CONTACT_SKIN);
    const cx = px - tx, cy = py - ty, cz = pz - tz;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    // The last sample IS where it landed, so a hit there is the ordinary
    // standing contact and `out` already describes it.
    if (len < 1e-9) return true;
    sweptCrossing = s < steps;
    out[0] = cx / len;
    out[1] = cy / len;
    out[2] = cz / len;
    out[3] = len;
    return true;
  }
  return false;
}

function collide(sim: CharmSim, contact: ContactFn) {
  const m = sim.model;
  if (!m.radius.length) return;
  const p = sim.pos;
  const prev = sim.prev;
  for (let k = 0; k < sim.dynamic.length; k++) {
    const n = sim.dynamic[k];
    const r = m.radius[n - m.static];
    if (!(r > 0)) continue;
    const i = n * 3;
    if (!sweptContact(contact, prev[i], prev[i + 1], prev[i + 2], p[i], p[i + 1], p[i + 2], r, tmpOut)) continue;
    separate(sim, i, tmpOut[0], tmpOut[1], tmpOut[2], tmpOut[3]);
  }
}

/**
 * Collide the charm's BODY and push the chain out of the way.
 *
 * This is the contact that actually matters, and it needs its own path. On
 * kc_aus2025 every nonzero collision radius belongs to the `$cloth_node_body*`
 * proxies — the chain links themselves have radius 0 — so colliding only the
 * simulated nodes collides nothing at all, and the charm hangs straight through
 * the weapon. Those proxies are the charm's rigid body.
 *
 * They cannot be pushed directly: they are placed from a bone, so anything
 * written to them is overwritten on the next solve. So resolve them the way the
 * geometry actually works — the body is rigidly attached to the end of the
 * chain, so pushing the body means displacing the chain. The deepest correction
 * is applied to every simulated node as a pure translation (position and
 * previous together, so it injects no velocity), and the constraint pass that
 * follows re-establishes the shape against the anchor, which bends the chain
 * rather than sliding the whole rig.
 */
function collideBody(sim: CharmSim, contact: ContactFn): boolean {
  const m = sim.model;
  if (!m.radius.length) return false;
  const p = sim.pos;
  let bestX = 0, bestY = 0, bestZ = 0, best = 0, crossed = false;
  for (let k = 0; k < sim.drivenOffsets.length; k++) {
    const n = m.offChild[sim.drivenOffsets[k]];
    const r = m.radius[n - m.static];
    if (!(r > 0)) continue;
    const i = n * 3;
    // Swept from where this proxy sat at the START of the substep. A driven node
    // has no velocity of its own — solveFrames places it from the chain — so the
    // segment has to come from the snapshot rather than from sim.prev.
    const f = k * 3;
    if (!sweptContact(contact, bodyFrom[f], bodyFrom[f + 1], bodyFrom[f + 2], p[i], p[i + 1], p[i + 2], r, tmpOut)) continue;
    const d = tmpOut[3];
    if (sweptCrossing) crossed = true;
    if (d > best) {
      best = d;
      bestX = tmpOut[0];
      bestY = tmpOut[1];
      bestZ = tmpOut[2];
    }
  }
  if (!best) return false;
  // GIVE UP on a contact that will not resolve.
  //
  // A charm whose anchor sits inside the weapon (the placement puts it there;
  // the physics cannot argue with it) is in an unsatisfiable state: the pin
  // holds it in, the contact pushes it out, and the two trade places forever.
  // Measured on a charm placed inside an AK's receiver that is a permanent
  // 0.02in buzz that never sleeps. Fading the push out over ~half a second
  // turns it into a still charm that is slightly embedded — wrong, but wrong
  // and STATIONARY, and it lets the sleep latch take over. Any real change —
  // the anchor moving, a drag, a flick — resets it through wakeCharmSim.
  //
  // A CROSSING is exempt. The ramp exists for a standing penetration that
  // cannot be satisfied; a node that was outside at the start of this substep
  // and inside by the end is the opposite case — it is the one correction that
  // must never be given up on, or the charm is through the weapon for good.
  const fade = crossed
    ? 1
    : 1 - Math.min(1, Math.max(0, sim.contactLoad - CONTACT_GIVEUP) / (1 - CONTACT_GIVEUP));
  if (fade <= 0) return false;
  // RELAXED, not the full correction. The chain is about to be pulled back by
  // the constraint pass, so shoving it the whole way in one go overshoots and
  // the two fight each other across frames — the exact ping-pong this is meant
  // to stop. Half now, and the caller runs this again after re-solving.
  const push = best * BODY_PUSH_RELAX * fade;
  for (let k = 0; k < sim.dynamic.length; k++) {
    const n = sim.dynamic[k];
    const i = n * 3;
    // WEIGHTED by how far down the chain the node is, not applied rigidly.
    //
    // A rigid translation moves the nodes that are pinned to the anchor too,
    // and the constraint pass then snaps them straight back — every step,
    // forever. That fight is what made a freshly loaded charm bounce in place
    // near its mount until you shook it loose. Weighting by rest distance from
    // the anchor lets the chain BEND out of the way, which is the only thing it
    // can physically do while one end is nailed to the gun.
    const w = sim.chainWeight[n];
    if (w <= 0) continue;
    const vx = p[i] - sim.prev[i], vy = p[i + 1] - sim.prev[i + 1], vz = p[i + 2] - sim.prev[i + 2];
    p[i] += bestX * push * w;
    p[i + 1] += bestY * push * w;
    p[i + 2] += bestZ * push * w;
    // Carry the velocity through the translation, minus whatever of it was
    // driving into the surface.
    const vn = vx * bestX + vy * bestY + vz * bestZ;
    const kx = vn < 0 ? vx - bestX * vn : vx;
    const ky = vn < 0 ? vy - bestY * vn : vy;
    const kz = vn < 0 ? vz - bestZ * vn : vz;
    sim.prev[i] = p[i] - kx;
    sim.prev[i + 1] = p[i + 1] - ky;
    sim.prev[i + 2] = p[i + 2] - kz;
  }
  sim.contact = true;
  return true;
}

const BODY_PUSH_RELAX = 0.5;
/** How many times to re-solve the chain after pushing the body out. */
const BODY_PASSES = 3;
/**
 * Contact duty cycle above which the push starts fading out, reaching zero at
 * 100%. A charm that is genuinely bouncing spends well under half its steps
 * touching; one that is jammed spends nearly all of them.
 */
const CONTACT_GIVEUP = 0.5;

/**
 * One fixed step: CSoftbody::RawSimulate, minus the parts that are no-ops for
 * charms (air drag, wind, velocity smoothing and animation attraction are all
 * driven by fields that are zero on every charm in this build).
 */
export function stepCharmSimOnce(sim: CharmSim, dt: number, g: Float32Array, contact?: ContactFn) {
  const m = sim.model;
  sim.contact = false;
  // BEFORE anything moves: the body proxies still hold last substep's positions,
  // and that is the far end of the segment the contact pass has to sweep.
  if (contact) snapshotBodies(sim);
  predict(sim, dt, g);
  // Constraints FIRST, contacts LAST, and contacts inside the loop.
  //
  // Running contacts once before the iterations (which is what this did first)
  // means the last thing to touch a position is relaxQuads, and it will happily
  // pull a node back inside the weapon it was just pushed out of. Next step it
  // is penetrating again. That push-pull across frames IS the jitter.
  relax(sim, Math.max(1, m.iters), contact);
  solveFrames(sim);
  // Then the body, which on most charms carries ALL the collision radius. Each
  // pass pushes a little and re-solves the chain, so the rig bends out of the
  // way over a few small corrections instead of one shove that the constraints
  // immediately undo.
  if (contact) {
    for (let pass = 0; pass < BODY_PASSES; pass++) {
      if (!collideBody(sim, contact)) break;
      relax(sim, 2, contact);
      solveFrames(sim);
    }
  }
  // ~0.4s time constant at 120Hz: long enough to ignore a genuine bounce, short
  // enough that a jam stops buzzing quickly.
  sim.contactLoad += ((sim.contact ? 1 : 0) - sim.contactLoad) * 0.02;
  sim.lastDt = dt;
}

function relax(sim: CharmSim, iterations: number, contact?: ContactFn) {
  for (let it = 0; it < iterations; it++) {
    // Stiffness is exp(-stretch/iterations) and every charm authors stretch 0,
    // so both come out at exactly 1. Kept as a named constant rather than
    // folded away, because a charm that does author stretch would need it.
    relaxRods(sim, it + 1 === iterations);
    relaxBend(sim, 1);
    relaxQuads(sim);
    if (contact) collide(sim, contact);
  }
}

/**
 * Advance the sim by real elapsed time, in fixed steps.
 *
 * `g` is the gravity DIRECTION in charm-local space, normalised. Returns the
 * number of steps run, for the perf HUD.
 */
export function stepCharmSim(
  sim: CharmSim,
  elapsed: number,
  g: Float32Array,
  contact?: ContactFn,
): number {
  if (sim.asleep) return 0;
  sim.acc += Math.min(elapsed, 0.1);
  let steps = 0;
  while (sim.acc >= CHARM_STEP && steps < MAX_SUBSTEPS) {
    stepCharmSimOnce(sim, CHARM_STEP, g, contact);
    sim.acc -= CHARM_STEP;
    steps++;
  }
  if (steps) {
    writeBones(sim);
    updateSleep(sim);
  }
  if (sim.acc > CHARM_STEP) sim.acc = 0; // dropped frames: catch up, don't queue up
  return steps;
}

/**
 * Run the sim to rest as fast as it will go.
 *
 * For still/offscreen viewers, which exist only to be photographed: they should
 * not be at the mercy of rAF timing for a pose that is fully determined.
 */
export function settleCharmSim(sim: CharmSim, g: Float32Array, maxSteps = 600, contact?: ContactFn) {
  for (let i = 0; i < maxSteps && !sim.asleep; i++) {
    stepCharmSimOnce(sim, CHARM_STEP, g, contact);
    updateSleep(sim);
  }
  writeBones(sim);
}

/** Largest per-node movement over the last step, in inches. */
export function charmMotion(sim: CharmSim): number {
  const { pos, prev, model } = sim;
  let worst = 0;
  for (let k = 0; k < sim.dynamic.length; k++) {
    const i = sim.dynamic[k] * 3;
    const d = Math.hypot(pos[i] - prev[i], pos[i + 1] - prev[i + 1], pos[i + 2] - prev[i + 2]);
    if (d > worst) worst = d;
  }
  return worst;
}

/** Below this much movement (inches per step) a charm counts as calm. A charm is
 *  ~1.6in tall, so this is well under a pixel at any sane zoom. */
const CALM_SPEED = 2e-4;
const CALM_FRAMES = 30;

function updateSleep(sim: CharmSim) {
  if (!sim.model.sleep) return;
  // Contact counts triple: a charm resting against the gun is being actively
  // pushed every step and would otherwise never accumulate calm frames.
  if (charmMotion(sim) < CALM_SPEED) sim.calm += sim.contact ? 3 : 1;
  else sim.calm = 0;
  if (sim.calm > CALM_FRAMES) {
    sim.asleep = true;
    sim.prev.set(sim.pos);
  }
}

export function wakeCharmSim(sim: CharmSim) {
  sim.asleep = false;
  sim.calm = 0;
}

/**
 * Give a written-off contact another chance.
 *
 * Deliberately NOT part of wakeCharmSim: the viewer wakes the charm on every
 * camera nudge (gravity is camera-relative), so resetting there would clear the
 * give-up ramp every frame the view moves and the buzz would come straight
 * back. Only something that can actually change whether the charm is embedded —
 * a new anchor, a drag, a flick — counts.
 */
export function resetCharmContact(sim: CharmSim) {
  sim.contactLoad = 0;
  wakeCharmSim(sim);
}

/**
 * Rotate a WORLD direction into the charm's own space.
 *
 * `space` is the object whose local space the FeModel lives in — the bones'
 * parent, i.e. the GLB's vmdl root node, which carries the 0.0254 scale and the
 * Source->glTF axis swizzle. Its world matrix is a rotation times a uniform
 * scale, so normalising the basis columns gives the rotation and transposing it
 * gives the inverse. Done by hand on matrixWorld.elements to keep three out of
 * this module.
 */
export function worldToCharmDir(
  space: ThreeNS.Object3D,
  wx: number,
  wy: number,
  wz: number,
  out: Float32Array,
) {
  const e = space.matrixWorld.elements;
  for (let c = 0; c < 3; c++) {
    const x = e[c * 4], y = e[c * 4 + 1], z = e[c * 4 + 2];
    const l = Math.hypot(x, y, z) || 1;
    // Transposed on the fly: row c of the inverse is column c of the rotation.
    out[c] = (x * wx + y * wy + z * wz) / l;
  }
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
}

/** Move the pinned nodes, e.g. while the charm is dragged to a new anchor. The
 *  rig then trails the anchor instead of one point teleporting. */
/**
 * Move where the rig is pinned, and CARRY the rest of it along.
 *
 * `carry` is the fraction of the move the free nodes take with them, and the
 * difference it makes is the whole feel of a drag. Moving the pinned nodes alone
 * leaves the charm's body where it was, so every pointermove stretches the
 * constraints by the full step and the solver whips the body after the anchor —
 * a 5cm drag becomes a 5cm impulse, sixty times a second. On screen that is a
 * charm flailing and spinning nearly horizontal while you drag it, which reads
 * as jitter even though every position it passes through is a legal one.
 *
 * Carrying `pos` and `prev` by the SAME amount is a translation and not a kick:
 * Verlet keeps velocity in the gap between them, so shifting both leaves the
 * charm's motion untouched and simply relocates it. Anything under 1 leaves a
 * little trail, which is what still reads as a physical object rather than a
 * cursor decoration.
 */
export function moveCharmAnchor(sim: CharmSim, dx: number, dy: number, dz: number, carry = 0) {
  for (let n = 0; n < sim.model.static; n++) {
    sim.anchor[n * 3] += dx;
    sim.anchor[n * 3 + 1] += dy;
    sim.anchor[n * 3 + 2] += dz;
  }
  if (carry > 0) {
    const cx = dx * carry;
    const cy = dy * carry;
    const cz = dz * carry;
    for (let k = 0; k < sim.dynamic.length; k++) {
      const i = sim.dynamic[k] * 3;
      sim.pos[i] += cx;
      sim.pos[i + 1] += cy;
      sim.pos[i + 2] += cz;
      sim.prev[i] += cx;
      sim.prev[i + 1] += cy;
      sim.prev[i + 2] += cz;
    }
  }
  resetCharmContact(sim);
}

/** Add a velocity to every free node, in inches per second — the release kick
 *  after a fling. Verlet carries velocity in the position delta. */
export function kickCharmSim(sim: CharmSim, vx: number, vy: number, vz: number) {
  const d = CHARM_STEP;
  for (let k = 0; k < sim.dynamic.length; k++) {
    const i = sim.dynamic[k] * 3;
    sim.prev[i] -= vx * d;
    sim.prev[i + 1] -= vy * d;
    sim.prev[i + 2] -= vz * d;
  }
  resetCharmContact(sim);
}
