// Runs every fixture (and a wear sweep) and prints a pass/fail table.
// Results also land on window.__results for a scripted driver to read.
import { FIXTURES, WEAR_SWEEP, SEED_SWEEP, type Fixture } from "./fixtures";
import { runOne, type RigResult } from "./rig";

// A composited skin that reads as flat grey is the failure this rig exists to
// catch: it is what a disabled-but-applied overlay, a default palette, or a
// dropped pattern all collapse to. Real skins sit well above this.
const GREY_SAT = 8;

const el = document.getElementById("out")!;
const line = (s: string, cls = "") => {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = s;
  el.appendChild(d);
};

interface Row { fixture: Fixture; result: RigResult; problems: string[]; sweep?: number[]; seedDiff?: number }

/** Mean absolute delta between two 8x8 luma thumbprints. */
const sigDelta = (a: number[], b: number[]) =>
  a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / a.length;

function check(f: Fixture, r: RigResult): string[] {
  const p: string[] = [];
  if (r.error) return [`ERROR ${r.error.slice(0, 120)}`];
  if (r.style !== f.style) p.push(`style ${r.style} != expected ${f.style}`);
  if (r.hasOverlay !== f.overlay) p.push(`overlay ${r.hasOverlay} != expected ${f.overlay}`);
  if (!r.weaponInputs?.length) p.push("no weapon inputs (extraction missing?)");
  const floor = f.greyFloor ?? (f.lowChroma ? 2 : GREY_SAT);
  if ((r.albedo?.sat ?? 0) < floor) p.push(`GREY: saturation ${r.albedo?.sat} < ${floor}`);
  if (!f.paletteFallbackOk && r.colors?.every((c) => c[0] === 0.5 && c[1] === 0.5 && c[2] === 0.5)) {
    p.push("palette is the [0.5,0.5,0.5] fallback — per-skin colours not resolving");
  }
  return p;
}

(async () => {
  const rows: Row[] = [];
  line(`running ${FIXTURES.length} fixtures…`);
  for (const f of FIXTURES) {
    const r = await runOne(f.model, f.pm, f.wear, f.seed);
    const problems = check(f, r);

    // Wear must actually change the output. Compare 8x8 luma thumbprints rather
    // than mean brightness: when a skin's bare metal is about as bright as its
    // paint, stripping barely moves the mean even though the image changes a lot.
    const sweep: number[] = [];
    let firstSig: number[] | undefined;
    let maxDiff = 0;
    for (const w of WEAR_SWEEP) {
      const s = await runOne(f.model, f.pm, w, f.seed, 64);
      sweep.push(s.albedo?.mean.reduce((a, b) => a + b, 0)! / 3 || 0);
      if (!firstSig) firstSig = s.sig;
      else if (firstSig && s.sig) {
        const d = s.sig.reduce((acc, v, i) => acc + Math.abs(v - firstSig![i]), 0) / s.sig.length;
        maxDiff = Math.max(maxDiff, d);
      }
    }
    if (maxDiff < 1.5) {
      problems.push(`wear does nothing (thumbprint delta ${maxDiff.toFixed(2)} across float 0→0.95)`);
    }

    // Same idea for the pattern seed, but the gate is subtler than wear's.
    // "Seed does nothing" is only a bug when the seed CAN do something, and
    // there are two independent ways it cannot — both legitimate:
    //   - degenerate vcompmat envelopes (authored placement: custom paintjob,
    //     gunsmith pin the pattern to one fixed layout);
    //   - no pattern texture at all, where tPattern is the 1x1 white fallback
    //     and samples identically at every UV. Five-SeveN | Autumn Thicket is
    //     this case and has LIVE envelopes, so gating on seedInert alone
    //     false-fails it.
    // Measure the sampled pattern (debug pass 2) rather than the composite: the
    // composite is attenuated ~10x by the palette/mask stages, so a correct
    // seed can move the pattern a lot and the albedo barely at all.
    const seedCanMove = !!r.pattern && !r.seedInert;
    let seedDiff = 0;
    let seedBase: number[] | undefined;
    for (const s of SEED_SWEEP) {
      const q = await runOne(f.model, f.pm, f.wear, s, 64, false, 2);
      if (!seedBase) seedBase = q.sig;
      else if (seedBase && q.sig) seedDiff = Math.max(seedDiff, sigDelta(q.sig, seedBase));
    }
    if (seedCanMove && seedDiff < 1.5) {
      problems.push(
        `seed does not move the pattern (delta ${seedDiff.toFixed(2)} across seeds ` +
        `${SEED_SWEEP.join("/")}) despite pattern ${r.pattern} and envelopes ` +
        `${JSON.stringify(r.seedRanges)}`,
      );
    }
    if (!seedCanMove && seedDiff > 0) {
      problems.push(
        `seed moved a pattern that cannot move (delta ${seedDiff.toFixed(2)}; ` +
        `pattern=${r.pattern ?? "none"} inert=${r.seedInert})`,
      );
    }

    rows.push({ fixture: f, result: r, problems, sweep, seedDiff });
    const ok = problems.length === 0;
    line(
      `${ok ? "PASS" : "FAIL"}  ${f.name.padEnd(30)} style=${r.style} overlay=${r.hasOverlay}` +
      ` albedo=${JSON.stringify(r.albedo?.mean)} sat=${r.albedo?.sat}` +
      ` wear[${sweep.map((v) => v.toFixed(0)).join(",")}] d=${maxDiff.toFixed(1)}` +
      ` seed d=${seedDiff.toFixed(1)}${seedCanMove ? "" : " (cannot move)"}`,
      ok ? "pass" : "fail",
    );
    problems.forEach((p) => line(`        ${p}`, "fail"));
  }
  const failed = rows.filter((r) => r.problems.length);
  line("");
  line(`${rows.length - failed.length}/${rows.length} passed`, failed.length ? "fail" : "pass");
  (window as any).__results = rows.map((r) => ({
    name: r.fixture.name, problems: r.problems, ...r.result, sweep: r.sweep, seedDiff: r.seedDiff,
  }));
  (window as any).__done = true;
})();
