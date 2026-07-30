/**
 * Headless checks for the charm cloth solver — no rendering, no three.
 *
 * These are the tests that decide whether the port in src/charmPhysics.ts is
 * right, and they are cheap enough to run on the whole catalogue:
 *
 *  1. THE AUTHORED POSE IS AN EQUILIBRIUM. Start every charm at its authored
 *     pose under local -Z gravity: it should settle by a hair and then stop.
 *     Not "not move at all" — the authored pose is the UNDEFORMED pose, not the
 *     gravity equilibrium, so a little sag is correct. Across the whole
 *     catalogue it is at most 0.07in on a ~1.6in charm.
 *
 *     This is the sharpest test available: a wrong quad projection, a wrong
 *     Gram-Schmidt order or a wrong qAdjust composition each send it to tens of
 *     inches, and it needs no reference imagery to compare against. It is also
 *     the end-to-end cross-check that the CS:GO-era solver still describes CS2 —
 *     these poses were authored by CS2's own tools, and a transcription of the
 *     wrong maths does not hold 62 of them still by luck.
 *
 *  2. IT COMES TO REST. Nothing in the model damps anything: every drag,
 *     windage and point-damping field is zero, so the constraint projections are
 *     the only thing that can remove energy. If they do their job the charm is
 *     stationary by 50s; if they inject energy instead it never settles.
 *
 *  3. NO NaN, from a perturbed start as well as a clean one.
 *
 * Run:
 *   npx esbuild tools/charmsim-check.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/check.mjs && node /tmp/check.mjs <dir-of-phys-json>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  charmMotion,
  bareCharmSim as bareSim,
  CHARM_STEP,
  type CharmSim,
  type FeModel,
  parseFeModel,
  stepCharmSimOnce,
} from "../src/charmPhysics";

/**
 * Gravity is local -Z. That is the engine's own convention (CSoftbody::Predict
 * builds `{0, 0, -scale, 0}`) and these models are authored in that space, so
 * it is also the direction the rest pose was posed under. An earlier version of
 * this check estimated the hang direction from the geometry instead, which
 * quietly tested every charm against a pose it was never authored in.
 */
const GRAVITY_DIR = new Float32Array([0, 0, -1]);

function maxDrift(sim: CharmSim): number {
  const { pos, model } = sim;
  let worst = 0;
  for (let n = 0; n < model.nodes; n++) {
    const d = Math.hypot(
      pos[n * 3] - model.initPos[n * 3],
      pos[n * 3 + 1] - model.initPos[n * 3 + 1],
      pos[n * 3 + 2] - model.initPos[n * 3 + 2],
    );
    if (d > worst) worst = d;
  }
  return worst;
}

function kinetic(sim: CharmSim): number {
  const { pos, prev, model } = sim;
  let e = 0;
  for (const n of model.free) {
    const i = n * 3;
    const v =
      (pos[i] - prev[i]) ** 2 + (pos[i + 1] - prev[i + 1]) ** 2 + (pos[i + 2] - prev[i + 2]) ** 2;
    const mass = model.invMass[n] > 0 ? 1 / model.invMass[n] : 0;
    e += 0.5 * mass * v;
  }
  return e;
}

function hasNaN(sim: CharmSim): boolean {
  for (let i = 0; i < sim.pos.length; i++) if (!Number.isFinite(sim.pos[i])) return true;
  return false;
}

const dir = process.argv[2] ?? process.argv.slice(-1)[0];
const files = readdirSync(dir).filter((f) => f.endsWith(".phys.json"));
if (!files.length) {
  console.error(`no .phys.json in ${dir}`);
  process.exit(1);
}

/**
 * Tolerances. A charm is roughly 1.6in tall.
 *
 * SAG is not required to be zero: the authored pose is the UNDEFORMED pose, not
 * the gravity equilibrium, so a correct solver lets the charm settle a little.
 * What must be true is that it settles by a small amount and then stops. The
 * bound is set well below "visibly wrong" and well above the ~0.07in the whole
 * catalogue actually shows, so it catches a broken constraint without pinning
 * the number.
 */
const SAG_TOL = 0.25;
/** Per-step motion once settled. Below the solver's own calm threshold. */
const STILL_TOL = 1e-4;

let failed = 0;
const rows: Array<[string, number, number]> = [];
for (const f of files.sort()) {
  const model = parseFeModel(JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (!model.free.length) continue; // degenerate model, nothing to simulate
  const g = GRAVITY_DIR;

  const sim = bareSim(model);
  let peakE = 0;
  for (let i = 0; i < 600; i++) {
    stepCharmSimOnce(sim, CHARM_STEP, g);
    peakE = Math.max(peakE, kinetic(sim));
  }
  const sag = maxDrift(sim);

  // 1. it must come to REST, not merely stay bounded. Run out to 50s and look
  //    at how much the worst node still moves per step.
  for (let i = 0; i < 2400; i++) stepCharmSimOnce(sim, CHARM_STEP, g);
  const still = charmMotion(sim);

  // 3. a perturbed start must not blow up or go non-finite
  const sim2 = bareSim(model);
  for (const n of sim2.dynamic) sim2.pos[n * 3] += 0.05;
  for (let i = 0; i < 600; i++) stepCharmSimOnce(sim2, CHARM_STEP, g);

  rows.push([model.name, sag, still]);
  const why: string[] = [];
  if (hasNaN(sim)) why.push("NaN");
  if (hasNaN(sim2)) why.push("NaN(perturbed)");
  if (sag > SAG_TOL) why.push(`sag ${sag.toExponential(2)}in`);
  if (still > STILL_TOL) why.push(`still moving ${still.toExponential(2)}in/step at 50s`);
  // Settling from an undeformed pose releases a little energy; a constraint that
  // pumps energy in shows up here long before the charm visibly misbehaves.
  if (!Number.isFinite(peakE)) why.push("energy diverged");
  if (why.length) {
    failed++;
    console.log(
      `FAIL ${model.name.padEnd(28)} ${why.join(", ")}` +
        `  [nodes ${model.nodes} dyn ${sim.dynamic.length} quads ${model.quadNode.length / 4}` +
        ` rods ${model.rodMin.length} axial ${model.axialTe.length}]`,
    );
  }
}

rows.sort((a, b) => b[1] - a[1]);
console.log(`\n${rows.length} charms simulated, ${failed} failed`);
console.log("largest settle from the authored pose:");
for (const [name, sag, still] of rows.slice(0, 5)) {
  console.log(`  ${name.padEnd(30)} sag ${sag.toFixed(4)}in  moving ${still.toExponential(1)}in/step at 50s`);
}
process.exit(failed ? 1 : 0);
