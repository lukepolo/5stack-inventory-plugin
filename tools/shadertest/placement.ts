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

/**
 * ?attach=1 — does the charm actually touch the gun?
 *
 * Separate from the suite above because it asks a different KIND of question.
 * Everything else here is about the offset SPACE: is the conversion linear, does
 * it round-trip, does the model measure the length a real one does. Those can
 * all be right while the thing on screen hangs in mid-air, because the offset a
 * placement carries need not correspond to any point on the weapon — the game
 * clamps a charm to the surface, and until now we did not.
 *
 * So this measures the rendered result and nothing else: resolve the pivot the
 * viewer would use, then take the distance to the nearest weapon triangle. No
 * conversion is trusted, no invariant of ours is asserted. A gap is a gap.
 *
 *   unplaced       what you get the moment a charm is added (the `keychain`
 *                  attachment) — must land ON the weapon or every new charm
 *                  floats
 *   from the game  offsets authored elsewhere: a Steam-synced item, an inspect
 *                  link, our own emitted offset re-read through a `cal` that is
 *                  derived rather than measured. Probed by walking away from the
 *                  anchor in each axis, which is what a real placement does.
 */
const ATTACH_CASES: { label: string; d?: [number, number, number] }[] = [
  { label: "unplaced" },
  { label: "anchor" , d: [0, 0, 0] },
  { label: "+2in fwd", d: [2, 0, 0] },
  { label: "-2in aft", d: [-2, 0, 0] },
  { label: "+1in left", d: [0, 1, 0] },
  { label: "+2in up", d: [0, 0, 2] },
  { label: "-2in down", d: [0, 0, -2] },
  { label: "+6in fwd", d: [6, 0, 0] },
  // Off the model entirely. Nothing should produce this, which is the point:
  // the guarantee has to hold for the placement we did not anticipate, not only
  // for the ones we generate ourselves.
  { label: "40in away", d: [40, 20, 20] },
];

/**
 * The model's authored charm surfaces, the way the app gets them.
 *
 * Straight off the real endpoint through the rig's /api proxy — not a fixture.
 * A fixture would let the extraction regress (or the field get dropped in the
 * client mapper, which is exactly where these sat unused) while every number
 * below stayed green.
 */
async function charmSurfacesFor(model: string) {
  try {
    const r = await fetch(`/api/catalog/sticker-bounds/${encodeURIComponent(model)}`);
    if (!r.ok) return [];
    return ((await r.json()) as { charmQuads?: unknown[] }).charmQuads ?? [];
  } catch {
    return [];
  }
}

/**
 * ?quads=1 — do the authored charm surfaces line up with the mesh we render?
 *
 * The prerequisite for every other number here. The quads are authored in the
 * GLB's own frame while the viewer renders a POSED body, and the entire history
 * of charm placement is spaces that looked right until they were measured
 * against something outside our own code. So: distance from each quad corner to
 * the nearest rendered triangle, which no convention of ours can flatter.
 *
 * `seated` is the other half: where the previewed charm actually ends up, as a
 * distance to the nearest authored surface. It reads as the standing clearance
 * (sizeL * 0.003) rather than as zero, because the seat deliberately holds the
 * pivot a hair off the shell — a charm sunk into the metal is its own bug.
 */
async function quadSweep(models: string[]) {
  const host = document.createElement("div");
  host.style.cssText = "width:320px;height:220px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  const progress = document.createElement("div");
  progress.className = "dim";
  el.appendChild(progress);
  line("fit = authored quad corner -> nearest rendered triangle. Small means the quads are on the gun.", "dim");
  line("anchor = the keychain attachment's own distance to the nearest authored surface.", "dim");
  line("");
  let ok = 0, seen = 0;
  for (const model of models) {
    progress.textContent = `… ${model}`;
    try {
      const charmSurfaces = await charmSurfacesFor(model);
      const handle = await Promise.race([
        mountViewer(host, model, { paintMaterial: null, interactive: false, still: true, charmSurfaces } as any),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mount timed out after 20s")), 20000)),
      ]);
      const probe = handle.probePlacement();
      const fit = probe.charmSurfaceFit();
      const a = probe.attachment();
      handle.dispose();
      seen++;
      if (!fit) {
        line(`${model.padEnd(16)} no authored surfaces (quads=${charmSurfaces.length})`, "warn");
        continue;
      }
      // A quad is a flat patch on a curved shell, so its corners overhang by a
      // little by construction. The MEDIAN is the claim; a fat p90 is a shape
      // difference, not a space error, and a space error moves the median.
      const good = fit.medianMm < 6;
      if (good) ok++;
      line(`${model.padEnd(16)} quads=${String(fit.quads).padStart(3)} fit median=${fit.medianMm.toFixed(2)}mm ` +
        `p90=${fit.p90Mm.toFixed(2)}mm max=${fit.maxMm.toFixed(2)}mm  ` +
        `cover=${(fit.coverage * 100).toFixed(0)}% ` +
        `seated=${a.authoredMm == null ? "?" : a.authoredMm.toFixed(1) + "mm"}`,
        good ? "pass" : "fail");
      // Which reading of the quad frame actually lands. Printed always, not only
      // on a failure: the one that wins has to keep winning across the catalogue,
      // and a silent second place is how a transform gets "fixed" on one weapon.
      if (fit.candidates) {
        const ranked = Object.entries(fit.candidates).sort((x, y) => x[1] - y[1]);
        line(`${"".padEnd(16)} ` + ranked.map(([k, v]) => `${k}=${v.toFixed(1)}`).join("  "), "dim");
      }
    } catch (e: any) {
      line(`${model.padEnd(16)} ERROR ${String(e?.message ?? e).slice(0, 90)}`, "warn");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  progress.remove();
  host.remove();
  line("");
  line(`${ok}/${seen} models have authored surfaces sitting on the mesh`, ok === seen ? "pass" : "fail");
}

async function attachSweep(models: string[]) {
  const host = document.createElement("div");
  host.style.cssText = "width:320px;height:220px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  const progress = document.createElement("div");
  progress.className = "dim";
  el.appendChild(progress);
  line("gap = distance from the charm's clip point to the nearest weapon triangle.", "dim");
  line("AIR = hanging off the model. in = buried inside the shell (fine — it is still on the gun).", "dim");
  line("");
  let air = 0, crept = 0, cases = 0;
  for (const model of models) {
    progress.textContent = `… ${model}`;
    try {
      // WITH the authored surfaces, because that is what the app mounts — the
      // gap this sweep measures is only the shipped one if the seat has the same
      // data to seat against.
      const charmSurfaces = await charmSurfacesFor(model);
      const handle = await Promise.race([
        mountViewer(host, model, { paintMaterial: null, interactive: false, still: true, charmSurfaces } as any),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mount timed out after 20s")), 20000)),
      ]);
      const probe = handle.probePlacement();
      const cands = (probe as any).anchorCandidates?.();
      if (cands) {
        line(`${model.padEnd(16)} ` + Object.entries(cands)
          .map(([k, c]: any) => `${k}=${c.gapMm == null ? "?" : c.gapMm.toFixed(1)}`).join("  "), "dim");
      }
      const anchor = probe.anchorAsOffset;
      const parts: string[] = [];
      let worst = 0;
      for (const c of ATTACH_CASES) {
        const off = !c.d
          ? {}
          : anchor
            ? { x: anchor.x + c.d[0], y: anchor.y + c.d[1], z: anchor.z + c.d[2] }
            : { x: c.d[0], y: c.d[1], z: c.d[2] };
        const a = probe.attachment(off);
        cases++;
        const g = a.gapMm ?? Infinity;
        // Contact is judged as a FRACTION of the weapon, not in millimetres: 4mm
        // is invisible on an AWP and obvious on a Glock. The bar is twice the
        // lift a snapped anchor is deliberately given (sizeL * 0.003), so a
        // correctly attached charm reads as contact with margin to spare.
        const floating = !a.buried && g > Math.max(1, a.lengthMm * 0.006);
        if (floating) { air++; worst = Math.max(worst, g); }
        // A snap that is not idempotent creeps the charm on every pointermove.
        const creeps = a.reReadMm > Math.max(0.5, a.lengthMm * 0.002);
        if (creeps) { crept++; worst = Math.max(worst, a.reReadMm); }
        parts.push(`${c.label}=${g === Infinity ? "?" : g.toFixed(1)}${a.buried ? "in" : floating ? "AIR" : ""}` +
          (creeps ? `/CREEP${a.reReadMm.toFixed(1)}` : ""));
        // What seating COST this placement: how far it moved, and how much of
        // that the authored surface added over the nearest triangle. The second
        // number is what any relocation cap has to admit, so it is measured
        // rather than guessed at.
        if (creeps) {
          const d = a.reReadDelta;
          line(`${"".padEnd(16)} ${c.label} creep axes = ` +
            `${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)} mm  ` +
            `emitted = ${a.emitted.x}, ${a.emitted.y}, ${a.emitted.z}`, "warn");
        }
        if (c.label === "unplaced") {
          line(`${"".padEnd(16)} seat moved ${a.snapMoveMm.toFixed(1)}mm` +
            (a.authoredCostMm == null ? "" : `, authored cost ${a.authoredCostMm.toFixed(1)}mm`), "dim");
        }
      }
      // Cost matters: a drag re-resolves the pivot on every pointermove, and the
      // snap is a closest-point query over the whole weapon.
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) probe.attachment({ x: (anchor?.x ?? 0) + i * 0.01 });
      // Nearly all of it is liftOutOfBody's six full-mesh raycasts, which
      // predate the snap — measured at 0.7-11.8ms of it against 0.1-0.2ms for
      // the closest-point query. Worth watching: it is paid per pointermove.
      const us = ((performance.now() - t0) / 20) * 1000;
      handle.dispose();
      line(`${model.padEnd(16)} ${parts.join("  ")}  [${us.toFixed(0)}µs/placement]`, worst > 1 ? "fail" : "pass");
    } catch (e: any) {
      line(`${model.padEnd(16)} ERROR ${String(e?.message ?? e).slice(0, 90)}`, "warn");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  progress.remove();
  host.remove();
  line("");
  line(`${cases - air}/${cases} placements touch the weapon`, air ? "fail" : "pass");
  line(`${cases - crept}/${cases} survive a read-back without moving`, crept ? "fail" : "pass");
}

/**
 * ?hook=1 — is the charm's HOOK on the weapon, or only its pivot?
 *
 * A separate question from ?attach=1 and the one you can actually SEE. The pivot
 * is the charm's origin and the ring is authored AROUND that origin, so lifting
 * the pivot clear of the surface lifts the ring with it: the gap shows up at the
 * hook, which is the part touching the gun in every screenshot anyone looks at.
 *
 * Reported as a SIGNED distance. Negative is the ring biting into the shell,
 * which is what a clip looks like; positive is daylight.
 */
const HOOK_CHARMS = [
  "/images/kc_missinglink_ava_36bc006a.webp",       // owns its own model
  "/images/kc_wpn_ak_jelly_7b0873e2.webp",          // Die-cast AK
  "/images/kc_wpn_usp_jewel_3595a16c.webp",         // Glamour Shot
  "/images/kc_missinglink_ancientcurse_5d7da72d.webp",
];
const HOOK_WEAPONS = ["ak47", "awp", "glock", "m4a1", "mac10", "deagle"];

/**
 * `live` mounts the way the interactive viewer does (`still: false`), which on
 * the Dual Berettas is a DIFFERENT MODEL: the side-by-side layout is synthesised
 * in bakePose by giving every `*_l` bone its `*_r` twin's pose, so the geometry
 * the charm has to sit on is not the geometry the card bake shows. Everything
 * here ran `still: true` and reported the elite seated 4/4 — while the layout
 * the modal actually renders had no charm on it at all.
 */
async function hookSweep(models: string[], charms: string[], live = false, cases = false) {
  const host = document.createElement("div");
  host.style.cssText = "width:320px;height:220px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  const progress = document.createElement("div");
  progress.className = "dim";
  el.appendChild(progress);
  line("hook = signed distance from the RING (the pinned nodes) to the weapon surface.");
  line("negative = biting into the shell, which is what clipped-on looks like. positive = daylight.", "dim");
  line("");
  let seated = 0, total = 0;
  for (const model of models) {
    for (const image of charms) {
      progress.textContent = `… ${model} / ${image.split("/").pop()}`;
      try {
        const handle = await Promise.race([
          mountViewer(host, model, {
            kind: "weapon", interactive: false, still: !live,
            charmSurfaces: await charmSurfacesFor(model),
            charm: { image, x: null, y: null, z: null, seed: 1 },
          } as any),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mount timed out")), 25000)),
        ]);
        // The charm is fetched AFTER the weapon mounts and is deliberately not
        // awaited by mountViewer — probing before it lands measures nothing.
        await (handle as any).charmReady?.();
        // WALK THE PLACEMENTS, not just the default one. Hook seating had only
        // ever been measured where an unplaced charm lands, and that is the one
        // placement the user never sees: they drag it somewhere. Re-anchoring
        // through setCharm rather than remounting is both faster and the path a
        // drag actually takes.
        if (cases) {
          const anchor = handle.probePlacement().anchorAsOffset;
          for (const c of ATTACH_CASES) {
            const off = !c.d
              ? { x: null, y: null, z: null }
              : anchor
                ? { x: anchor.x + c.d[0], y: anchor.y + c.d[1], z: anchor.z + c.d[2] }
                : { x: c.d[0], y: c.d[1], z: c.d[2] };
            await handle.setCharm({ image, seed: 1, ...off });
            // The cloth needs frames to settle onto a moved anchor.
            await new Promise((r) => setTimeout(r, 260));
            const s2 = handle.probeCharmSeat();
            total++;
            if (!s2) { line(`${model.padEnd(8)} ${c.label.padEnd(12)} no rig`, "warn"); continue; }
            const ok2 = s2.hookDrawnMm <= 0.5;
            if (ok2) seated++;
            line(`${model.padEnd(8)} ${c.label.padEnd(12)} drawn=${s2.hookDrawnMm.toFixed(2)}mm ` +
              `anchor=${s2.hookGapMm.toFixed(2)}mm pivot=${s2.pivotGapMm.toFixed(2)}mm ` +
              `BULK=${s2.bulkGapMm == null ? "-" : s2.bulkGapMm.toFixed(2) + "mm"}`,
              ok2 ? "pass" : "fail");
          }
          handle.dispose();
          continue;
        }
        const seat = handle.probeCharmSeat();
        handle.dispose();
        total++;
        if (!seat) { line(`${model.padEnd(8)} ${image.split("/").pop()!.padEnd(38)} no rig`, "warn"); continue; }
        // Touching or biting is seated. The bar is a hair of daylight, in mm,
        // because a hook is a real object of a fixed size — unlike the pivot
        // check, this one does not scale with the weapon.
        // Judged on what is DRAWN. The anchor-based number is kept beside it
        // because the two disagreeing is the whole diagnosis: a seat that holds
        // and a cloth that pulls away from it look identical in every other
        // measurement here.
        const ok = seat.hookDrawnMm <= 0.5;
        if (ok) seated++;
        line(`${model.padEnd(8)} ${image.split("/").pop()!.padEnd(38)} drawn=${seat.hookDrawnMm.toFixed(2)}mm ` +
          `anchor=${seat.hookGapMm.toFixed(2)}mm ` +
          `pivot=${seat.pivotGapMm.toFixed(2)}mm ring=${seat.ringMm.toFixed(2)}mm nodes=${seat.hookNodes}`,
          ok ? "pass" : "fail");
        // The rig being seated is not the charm being VISIBLE — see the note on
        // CharmSeatProbe.spriteMm. Reported every run so "seated 4/4" can never
        // again be printed about a weapon that draws no charm.
        line(`${"".padEnd(8)} ${"".padEnd(38)} drawn=${seat.spriteMm.x.toFixed(0)}x${seat.spriteMm.y.toFixed(0)}x${seat.spriteMm.z.toFixed(0)}mm ` +
          `offPivot=${seat.spriteToPivotMm == null ? "EMPTY" : seat.spriteToPivotMm.toFixed(1) + "mm"} ` +
          `mapRefused=${seat.mapSpots ? `${seat.mapSpots.enclosed}/${seat.mapSpots.total}` : "-"} ` +
          `scene=${seat.inScene} visible=${seat.visible} ` +
          `ndc=${seat.ndc ? `${seat.ndc.x.toFixed(2)},${seat.ndc.y.toFixed(2)},${seat.ndc.z.toFixed(2)}` : "-"} ` +
          `inFrame=${seat.inFrame}`, seat.inFrame ? "dim" : "warn");
        const mm = (v: number) => (v * 1000).toFixed(0);
        if (seat.weaponBox && seat.bulkWorld) {
          line(`${"".padEnd(8)} ${"".padEnd(38)} pivot=(${mm(seat.pivotWorld.x)},${mm(seat.pivotWorld.y)},${mm(seat.pivotWorld.z)}) ` +
            `bulk=(${mm(seat.bulkWorld.x)},${mm(seat.bulkWorld.y)},${mm(seat.bulkWorld.z)}) ` +
            `weapon=(${mm(seat.weaponBox.min.x)}..${mm(seat.weaponBox.max.x)}, ` +
            `${mm(seat.weaponBox.min.y)}..${mm(seat.weaponBox.max.y)}, ` +
            `${mm(seat.weaponBox.min.z)}..${mm(seat.weaponBox.max.z)})mm`, "dim");
        }
      } catch (e: any) {
        total++;
        line(`${model.padEnd(8)} ${image.split("/").pop()!.padEnd(38)} ERROR ${String(e?.message ?? e).slice(0, 60)}`, "fail");
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  progress.remove();
  host.remove();
  line("");
  line(`${seated}/${total} charms have their hook ON the weapon`, seated === total ? "pass" : "fail");
}

(async () => {
  const qs = new URLSearchParams(location.search);
  const all = Object.keys(CHARM_ANCHORS as Record<string, unknown>).sort();
  const one = qs.get("model");
  const models = one ? [one] : qs.get("all") ? all : REPRESENTATIVE.filter((m) => all.includes(m));
  if (qs.get("hook")) {
    line("charm hook seating — is the RING touching the gun?");
    line("");
    await hookSweep(
      one ? [one] : HOOK_WEAPONS,
      qs.get("charm") ? [qs.get("charm")!] : HOOK_CHARMS,
      !!qs.get("live"),
      !!qs.get("cases"),
    );
    return;
  }
  if (qs.get("quads")) {
    line("authored charm surfaces — are the model's own quads ON the rendered mesh?");
    line("");
    await quadSweep(one ? [one] : models);
    return;
  }
  if (qs.get("attach")) {
    // `elite` has no anchor at all, so it is the case the fallback path exists
    // for — include it unless a single model was asked for.
    line("charm attachment sweep — is the previewed charm ON the weapon?");
    line("");
    await attachSweep(one ? [one] : [...models, "elite"]);
    return;
  }
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
