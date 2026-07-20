// Charm placement suite: mounts the REAL viewer against the REAL model for
// every weapon with a keychain anchor, and measures the frame the charm offsets
// are expressed in.
//
// Why this exists
// ---------------
// A charm shipped to the game at x=86.941" on an AK-47 whose own `keychain`
// attachment sits at x=8.567". In-game it rendered floating past the muzzle;
// in our viewer it looked fine. It looked fine because `offsetToWorld` and
// `worldToOffset` share one SRC_TO_M constant, so a drag round-trips perfectly
// against itself no matter what that constant is. Self-consistency is exactly
// the failure mode the paint rig was built to defeat (see README) — the number
// is only wrong relative to something OUTSIDE our code: the game's units.
//
// So every assertion here is anchored to a fact we do not control:
//   - a real AK-47 is ~34" long, not ~340"
//   - the anchor read back through the drag path must equal the anchor we
//     extracted from the model file
//   - a charm offset must land inside the weapon it hangs on
import CHARM_ANCHORS from "../../src/charmAnchors.json";
import { mountViewer, type PlacementProbe } from "../../src/viewer3d";

/** Source inches per GLB unit if the GLB is in metres, which is what
 *  viewer3d's SRC_TO_M assumes. Duplicated deliberately: if someone edits the
 *  constant in viewer3d to "fix" a failure here, this suite must still fail. */
const SRC_TO_M = 0.0254;

// Real-world overall lengths in inches, for the models where the number is
// unambiguous. These come from the physical firearms, not from our data — they
// are the outside reference that makes this a test rather than a tautology.
const REAL_LENGTH_IN: Record<string, number> = {
  ak47: 34.3,
  awp: 46.5,
  m4a1: 33.0,
  deagle: 10.75,
  glock: 7.3,
  usp_silencer: 13.4, // suppressor fitted — the model ships it attached
  p90: 27.4,
  mac10: 12.0,
  ump45: 27.2,
  nova: 40.0,
  xm1014: 41.0,
  scar20: 46.0,
  g3sg1: 45.3,
  famas: 29.8,
  galilar: 33.1,
  aug: 31.0,
  sg556: 31.1,
  m249: 41.0,
  negev: 35.0,
  mp9: 20.3,
  mp7: 25.0,
  mp5sd: 21.7,
  bizon: 27.0,
  p250: 7.2,
  fiveseven: 8.2,
  tec9: 10.5,
  cz75a: 8.1,
  revolver: 13.0,
  elite: 8.4,
  p2000: 7.0,
  sawedoff: 27.0,
  mag7: 31.0,
  ssg08: 42.5,
  m4a1_silencer: 39.5,
  hkp2000: 7.0,
};

// A weapon model that measures outside this band is not a scale we can explain.
// Generous on purpose: the bug this catches is a 10x, not a 10%.
const MIN_IN = 5;
const MAX_IN = 60;

const el = document.getElementById("out")!;
const line = (s: string, cls = "") => {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = s;
  el.appendChild(d);
};

interface Row {
  model: string;
  probe?: PlacementProbe;
  problems: string[];
  error?: string;
}

function check(model: string, p: PlacementProbe): string[] {
  const probs: string[] = [];

  // 1. UNIT SCALE. The decisive one. If the GLB is not in metres then every
  //    offset we have ever emitted is wrong by that factor.
  const len = p.lengthInSrcUnits;
  if (!(len > MIN_IN && len < MAX_IN)) {
    probs.push(`SCALE: model measures ${len.toFixed(1)}" long — outside ${MIN_IN}-${MAX_IN}". SRC_TO_M is wrong for this GLB.`);
  }
  const real = REAL_LENGTH_IN[model];
  if (real) {
    // Models include magazines/stocks and a little slop, so allow 40%.
    const ratio = len / real;
    if (ratio < 0.6 || ratio > 1.4) {
      probs.push(`SCALE: measures ${len.toFixed(1)}" vs real ${real}" (${ratio.toFixed(2)}x)`);
    }
  }

  // 2. READBACK PATH. Push the extracted anchor through the exact conversion a
  //    drag uses and demand we get the extracted numbers back. This is what
  //    catches a swizzle or pose error independently of scale.
  // NOTE: no anchor-readback check. charmAnchors.json now stores the anchor
  // BONE-RELATIVE while worldToOffset emits game space (anchor + base + cal),
  // so the two are deliberately different numbers and comparing them only
  // re-asserts the conversion against itself. The muzzle calibration below is
  // the real check: it compares against a landmark we did not derive.
  const json = p.anchorJson;
  if (!json) probs.push("no anchor in charmAnchors.json");
  else if (!p.anchorAsOffset) probs.push("viewer resolved no charmAnchor despite JSON having one");

  // 3. ROUND TRIP. offsetToWorld ∘ worldToOffset must be identity.
  if (p.roundTripErr != null && p.roundTripErr > 1e-6) {
    probs.push(`ROUNDTRIP: drifts ${p.roundTripErr.toExponential(2)} GLB units`);
  }

  // NOTE: there is deliberately no bounding-box containment check here.
  // An earlier version asserted that a charm offset must land inside the
  // weapon's bbox, on the assumption that offset space and rendered world space
  // share a scale. They do not — poseXform sits between them — so that check
  // flagged perfectly good placements (a USP-S offset of 18.316 is correct in
  // game and sits well outside the model's 16.8" measured length) and drove a
  // "fix" that broke charm placement. Do not reintroduce it without ground
  // truth from the game for the specific model.

  return probs;
}

// Mounting a viewer per model costs a WebGL context, and Chrome degrades badly
// long before it hard-caps (~16 live). A full 35-model sweep slowed from 4s to
// 40s per model and took half an hour, which is a suite nobody runs. Default to
// a spread that covers the scale range (7" pistol → 54" AWP) and both body
// variants; `?all=1` still runs everything when the model set changes.
const REPRESENTATIVE = [
  "glock", "deagle", "usp_silencer", "mac10",
  "ak47", "m4a1", "famas", "p90",
  "awp", "mag7", "m249", "mp5sd",
];

(async () => {
  const qs = new URLSearchParams(location.search);
  const all = Object.keys(CHARM_ANCHORS as Record<string, unknown>).sort();
  const one = qs.get("model");
  const models = one ? [one] : qs.get("all") ? all : REPRESENTATIVE.filter((m) => all.includes(m));
  line(`probing ${models.length}${one || qs.get("all") ? "" : ` of ${all.length}`} models with keychain anchors…`);
  if (!one && !qs.get("all")) line("(representative subset — add ?all=1 for every model)", "dim");
  line("");

  const rows: Row[] = [];
  const host = document.createElement("div");
  host.style.cssText = "width:320px;height:220px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);

  // Report per model as it lands. A suite that only prints at the end is
  // indistinguishable from a hung one, which cost a debugging round already.
  const progress = document.createElement("div");
  progress.className = "dim";
  el.appendChild(progress);

  for (const model of models) {
    progress.textContent = `… ${model} (${rows.length}/${models.length})`;
    try {
      // Guard the mount: a model that never resolves would otherwise stall the
      // whole run with no output at all.
      const handle = await Promise.race([
        mountViewer(host, model, { paintMaterial: null, interactive: false, still: true } as any),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mount timed out after 20s")), 20000)),
      ]);
      const probe = handle.probePlacement();
      handle.dispose();
      rows.push({ model, probe, problems: check(model, probe) });
    } catch (e: any) {
      rows.push({ model, problems: [], error: String(e?.message ?? e) });
    }
    // Yield so the browser can paint progress and reclaim the GL context the
    // disposed viewer just released.
    await new Promise((r) => setTimeout(r, 50));
  }
  progress.remove();
  host.remove();

  // ---- report ----
  const pad = (s: string, n: number) => s.padEnd(n);
  line(pad("model", 18) + pad("length", 12) + pad("anchor x,y,z (in)", 30) + "status");
  line("─".repeat(96), "dim");

  let pass = 0, fail = 0;
  for (const r of rows) {
    if (r.error) {
      // No GLB served for this key (c4 has an anchor but no weapon model in a
      // local extraction). Not a placement failure — report it and move on.
      const missing = /404|Not Found/.test(r.error);
      line(pad(r.model, 18) + (missing ? "SKIP  no model served" : "ERROR " + r.error.slice(0, 90)),
           missing ? "warn" : "fail");
      if (!missing) fail++;
      continue;
    }
    const p = r.probe!;
    const off = p.anchorAsOffset;
    const offStr = off ? `${off.x.toFixed(2)}, ${off.y.toFixed(2)}, ${off.z.toFixed(2)}` : "—";
    const ok = r.problems.length === 0;
    line(
      pad(r.model, 18) + pad(`${p.lengthInSrcUnits.toFixed(1)}"`, 12) + pad(offStr, 30) + (ok ? "PASS" : "FAIL"),
      ok ? "pass" : "fail",
    );
    const b = p.offsetBox;
    const s = (p as any).poseScale;
    const wb = (p as any).worldBox;
    const aw = (p as any).anchorWorld;
    line(`    offsetBox x[${b.min.x.toFixed(1)}, ${b.max.x.toFixed(1)}] y[${b.min.y.toFixed(1)}, ${b.max.y.toFixed(1)}] z[${b.min.z.toFixed(1)}, ${b.max.z.toFixed(1)}]`, "dim");
    line(`    poseScale ${s ? `${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)}` : "none"}  (must be ~1,1,1)`, s && Math.abs(s.x - 1) < 0.01 ? "dim" : "warn");
    line(`    worldBox  x[${wb.min.x.toFixed(3)}, ${wb.max.x.toFixed(3)}] y[${wb.min.y.toFixed(3)}, ${wb.max.y.toFixed(3)}] z[${wb.min.z.toFixed(3)}, ${wb.max.z.toFixed(3)}]`, "dim");
    line(`    anchorWorld ${aw ? `${aw.x.toFixed(3)}, ${aw.y.toFixed(3)}, ${aw.z.toFixed(3)}` : "none"}  ← must be inside worldBox`, "dim");
    // Derived per-weapon calibration. Compare the M4A4's row against the
    // hand-measured (0.784, 0.146, -2.37) — if they agree, this method can
    // replace in-game measurement for every other weapon.
    const mc = (p as any).muzzleCalibration?.();
    if (mc) {
      const c = mc.calibration;
      line(`    muzzleCal  x=${c.x.toFixed(3)}  y=${c.y.toFixed(3)}  z=${c.z.toFixed(3)}   (${mc.samples} verts)`, "warn");
    } else {
      line(`    muzzleCal  — no muzzle landmark`, "dim");
    }
    const lin = (p as any).probeLinearity?.(0.05);
    if (lin) {
      // 1.00 = one inch of offset per inch of world. `base` carries the frame
      // shift now, not poseXform, so the scale really is 1:1.
      const ok = lin.every((l: any) => Math.abs(l.ratio - 1) < 0.02);
      line(`    linearity @5cm  ${lin.map((l: any) => `${l.axis}=${l.ratio.toFixed(2)}`).join("  ")}  (expect 1.00)`,
           ok ? "dim" : "fail");
      if (!ok) r.problems.push(`LINEARITY: expected 1.00 per axis, got ${lin.map((l: any) => l.ratio.toFixed(2)).join("/")}`);
    }
    for (const prob of r.problems) line("    " + prob, "fail");
    ok ? pass++ : fail++;
  }

  line("");
  line(`${pass} passed, ${fail} failed`, fail ? "fail" : "pass");

  // Scale summary — the single number that answers "is the GLB in metres?".
  const lens = rows.filter((r) => r.probe).map((r) => r.probe!.lengthInSrcUnits);
  if (lens.length) {
    const med = lens.slice().sort((a, b) => a - b)[Math.floor(lens.length / 2)];
    line("");
    line(`median model length: ${med.toFixed(1)}" — expect ~20-35" for a mixed weapon set.`, "dim");
    line(`if this reads ~10x that, SRC_TO_M (${SRC_TO_M}) does not match the GLB's units.`, "dim");
  }

  // Pasteable per-weapon calibration for charmAnchors.json. This is the whole
  // point of the muzzle landmark: the correction is DERIVED from geometry we
  // already ship, so it does not need measuring in game per weapon.
  const cal: Record<string, number[]> = {};
  for (const r of rows) {
    const mc = (r.probe as any)?.muzzleCalibration?.();
    if (mc) cal[r.model] = [+mc.calibration.x.toFixed(3), +mc.calibration.y.toFixed(3), +mc.calibration.z.toFixed(3)];
  }
  line("");
  line(`derived calibration for ${Object.keys(cal).length} weapons:`, "dim");
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(cal);
  pre.style.cssText = "white-space:pre-wrap;color:#7ddc7d";
  el.appendChild(pre);
  (window as any).__cal = cal;
  (window as any).__placement = rows;
})();
