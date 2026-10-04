/**
 * The pets' animation clips, as three AnimationClips.
 *
 * Extracted by scripts/extract-pet-anims.mjs from
 * `animation/anims/chicken/{world,ui,snapshot}/*.vnmclip_c` into
 * `/models/pets/anims/<folder>/<clip>.json`, with `index.json` beside them.
 * Every clip drives the same 117-bone rig that all four bird GLBs share, by the
 * same bone names and in the same source units, so a track binds by name with
 * no retarget — the chick plays the hen's clips and vice versa, as in game.
 *
 * `root_motion` is dropped. It carries the locomotion — a walk travels, a turn
 * clip turns the whole bird — and on a turntable that walks the pet out of
 * frame or spins it away from the camera. The game moves the entity by it; we
 * want the motion in place.
 */
import { getAssetOrigin, withAssetVersion } from "./api";

interface RawTrack {
  t?: number[];
  v: number[];
}
interface RawPetClip {
  source: string;
  duration: number;
  bones: Record<string, { rot?: RawTrack; pos?: RawTrack }>;
}
export interface PetClipInfo {
  /** `world/chick_idle01` — folder and clip, as the archive names it. */
  name: string;
  duration: number;
}

/** What a pet does when nobody picked anything: the game's own first idle. */
export const DEFAULT_PET_CLIP = "world/chick_idle01";

const petAsset = (rel: string) => withAssetVersion(`${getAssetOrigin()}/models/pets/anims/${rel}`);

let indexDoc: Promise<PetClipInfo[]> | null = null;
/** Every extracted clip. Empty on a mount extracted before pet clips existed. */
export function loadPetClipIndex(): Promise<PetClipInfo[]> {
  indexDoc ??= fetch(petAsset("index.json"))
    .then((r) => (r.ok ? (r.json() as Promise<PetClipInfo[]>) : []))
    .catch(() => [] as PetClipInfo[]);
  return indexDoc;
}

export interface PetClipGroup {
  key: string;
  label: string;
  clips: { name: string; label: string; duration: number }[];
}

/**
 * The clips worth offering for `model`, grouped by what the bird is doing.
 *
 * Left out on purpose: the turn-in-place clips (`chick_45l` …), which are
 * nothing but root motion once that is dropped; the swim variants; and every
 * `_loop`, which plays on its own after its intro (see setPetClip). The `ui/`
 * showcases split by bird — `chickbaby_*` and `*_baby` are the chick's, the
 * rest the grown breeds'.
 */
export function groupPetClips(index: PetClipInfo[], model: string): PetClipGroup[] {
  const chick = /\/chick$/.test(model);
  const has = new Set(index.map((c) => c.name));
  const groups: PetClipGroup[] = [];
  const add = (key: string, label: string, test: RegExp, name: (m: RegExpExecArray) => string, order?: string[]) => {
    const clips = index
      .map((c) => ({ c, m: test.exec(c.name) }))
      .filter((x): x is { c: PetClipInfo; m: RegExpExecArray } => !!x.m)
      .map(({ c, m }) => ({ name: c.name, label: name(m), duration: c.duration }))
      // The index is alphabetical, which puts "10" before "2"; numbered clips
      // sort as numbers, named ones by `order` when given.
      .sort((a, b) =>
        order
          ? order.indexOf(a.label) - order.indexOf(b.label)
          : Number(a.label) - Number(b.label) || a.label.localeCompare(b.label),
      );
    if (clips.length) groups.push({ key, label, clips });
  };
  const n = (m: RegExpExecArray) => String(Number(m[1]));
  add("idle", "Idle", /^world\/chick_idle0*(\d+)$/, n);
  add("trick", "Tricks", /^world\/chick_trick0*(\d+)$/, n);
  add(
    "move",
    "Moves",
    /^world\/chick_(walk|run|runflap|hop|fall_flap)$/,
    (m) => ({ walk: "Walk", run: "Run", runflap: "Flap", hop: "Hop", fall_flap: "Fall" })[m[1]] ?? m[1],
    ["Walk", "Run", "Flap", "Hop", "Fall"],
  );
  add("react", "React", /^world\/chick_(react|scared)0*(\d+)$/, (m) => (m[1] === "scared" ? `Scared ${m[2]}` : m[2]));
  add("rest", "Rest", /^world\/chick_(sleep_loop01|squat_loop0*(\d+))$/, (m) => (m[2] ? `Squat ${m[2]}` : "Sleep"));
  const show: Record<string, string> = chick
    ? {
        "ui/chickbaby_egg_hatch01": "Hatch",
        "ui/chickbaby_egg_hatch01alt": "Hatch II",
        "ui/chickbaby_egg_hatch02": "Hatch III",
        "ui/chickbaby_feed02": "Feed",
        "ui/chickbaby_feed_to_sad02": "Sulk",
        "ui/chick_retirement02_baby": "Retire",
      }
    : {
        "ui/chick_reveal": "Reveal",
        "ui/chick_reveal02": "Reveal II",
        "ui/chick_shoulder_01": "Perch",
        "ui/chick_shoulder_02": "Perch II",
        "ui/chick_shoulder_03": "Perch III",
        "ui/chick_feed01": "Feed",
        "ui/chick_feed_to_sad01": "Sulk",
        "ui/chick_retirement01": "Retire",
        "ui/chick_retirement02": "Retire II",
      };
  const showcase = Object.entries(show)
    .filter(([name]) => has.has(name))
    .map(([name, label]) => ({ name, label, duration: index.find((c) => c.name === name)!.duration }));
  if (showcase.length) groups.push({ key: "show", label: "Show", clips: showcase });
  return groups;
}

/** What Wander picks from: the bird's idles and its tricks — what it does of
 *  its own accord in game. */
export function petWanderPool(index: PetClipInfo[], model: string): string[] {
  return groupPetClips(index, model)
    .filter((g) => g.key === "idle" || g.key === "trick")
    .flatMap((g) => g.clips.map((c) => c.name));
}

/** The clip that carries on after `name` finishes, when the game ships one. */
export async function petLoopAfter(name: string): Promise<string | null> {
  const loop = `${name}_loop`;
  return (await loadPetClipIndex()).some((c) => c.name === loop) ? loop : null;
}

const clipCache = new Map<string, Promise<RawPetClip | null>>();
function loadRaw(name: string): Promise<RawPetClip | null> {
  let hit = clipCache.get(name);
  if (!hit) {
    hit = fetch(petAsset(`${name.split("/").map(encodeURIComponent).join("/")}.json`))
      .then((r) => (r.ok ? (r.json() as Promise<RawPetClip>) : null))
      .catch(() => null)
      .then((v) => {
        // Not cached as a permanent no — see loadViewmodelClip.
        if (!v) clipCache.delete(name);
        return v;
      });
    clipCache.set(name, hit);
  }
  return hit;
}

/**
 * Put the rig's Z-up -> Y-up axis swap where the clips expect it: on
 * `root_motion`, not on `root`.
 *
 * Every bird ships the same swap, (0.5, 0.5, 0.5, 0.5), but VRF hangs it on a
 * different bone per model. chicken.glb has it on `root_motion` with `root`
 * plain at (0, 7.2, -2.01); chick.glb has `root_motion` plain and the swap on
 * `root` at (-2.01, 0, 7.2). Same world bind, so a still render cannot tell.
 * The clips are written for the first layout and their `root_motion` track is
 * dropped, so on the chick a clip's plain `root` wiped the swap and the bird
 * played lying on its side.
 *
 * Moved up rather than baked into the clips: every child of `root_motion` (the
 * IK targets, attachWorld) is re-expressed so nothing moves in the world, and
 * the skin's inverse binds stay valid. A rig already in the clip layout, and
 * the single-bone egg, are left alone.
 */
export function normalizePetRig(rig: import("three").Object3D) {
  const motion = rig.getObjectByName("root_motion");
  const root = motion?.getObjectByName("root");
  if (!motion || !root || root.parent !== motion) return;
  const swap = root.quaternion.clone();
  if (swap.w > 1 - 1e-6) return;
  const undo = swap.clone().invert();
  for (const child of motion.children) {
    child.position.applyQuaternion(undo);
    child.quaternion.premultiply(undo);
  }
  motion.quaternion.multiply(swap);
  rig.updateMatrixWorld(true);
}

/**
 * A pet clip ready to play on `rig`, or null when there is nothing to play —
 * the clip is not on the mount, or the rig is not the chicken skeleton (the
 * egg is a single bone, and every clip would bind to nothing on it).
 */
export async function loadPetClip(
  THREE: typeof import("three"),
  rig: import("three").Object3D,
  name: string,
): Promise<import("three").AnimationClip | null> {
  const raw = await loadRaw(name);
  if (!raw) return null;
  const nodes = new Set<string>();
  rig.traverse((o) => nodes.add(o.name));
  const tracks: import("three").KeyframeTrack[] = [];
  let bound = 0;
  for (const [bone, tr] of Object.entries(raw.bones)) {
    if (bone === "root_motion" || !nodes.has(bone)) continue;
    bound++;
    // A constant track is still a track — otherwise the previous clip's value
    // for that bone shows through after a switch.
    const emit = (t: RawTrack, prop: "quaternion" | "position", width: number) => {
      const times = t.t ?? [0];
      const values = t.t ? t.v : t.v.slice(0, width);
      tracks.push(
        prop === "quaternion"
          ? new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values)
          : new THREE.VectorKeyframeTrack(`${bone}.position`, times, values),
      );
    };
    if (tr.rot) emit(tr.rot, "quaternion", 4);
    if (tr.pos) emit(tr.pos, "position", 3);
  }
  if (bound < Object.keys(raw.bones).length / 2) return null;
  return new THREE.AnimationClip(name, raw.duration, tracks);
}
