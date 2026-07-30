// StatTrak module suite: mounts the REAL viewer with a StatTrak module and
// dumps what the GPU actually drew, so placement and the digit readout can be
// LOOKED AT instead of argued about.
//
// Why this exists
// ---------------
// The module was iterated on through the deployed app, one screenshot at a
// time, with a human reporting back whether it looked right. That is slow, it
// burns someone else's build loop, and "looks wrong" carries no numbers. Every
// earlier theory (units, swizzle, poseXform) was self-consistent and wrong.
//
// So this renders the module against the real weapon and writes a PNG to
// tools/shadertest/snapshots/, plus a measured report of where the module
// landed RELATIVE to the weapon it is bolted to — the outside reference that
// makes this a test rather than a tautology:
//
//   - the module must OVERLAP the weapon's silhouette, not hang beside it
//   - its inner face must sit within a millimetre or two of the body surface
//   - the readout must show the digits the count asks for, not a blank plate
import { mountViewer } from "../../src/viewer3d";
import STATTRAK_ANCHORS from "../../src/stattrakAnchors.json";
import { composeDigitAtlas, digitColumns } from "../../src/stattrakModule";

const out = document.getElementById("out")!;
const log = (html: string) => (out.innerHTML += html + "<br>");

// Fixtures: model key + a paint so the body renders like it does in the app.
// null paint = bare model, which is enough to judge placement.
const CASES: { model: string; count: number | null; legacy?: boolean; label: string; nametag?: string; pm?: string; size?: number }[] = [
  // A PAINTED weapon, big. The bare body hides the failure this rig was pointed
  // at next: the module's clearance over the receiver is a fraction of a
  // millimetre by design, and what makes that visible is a high-chroma finish
  // bleeding through the readout — on grey plastic there is nothing to see.
  {
    model: "aug", count: 1337, legacy: true, size: 3000,
    pm: "/materials/cu_aug_chameleonaire_c1df2efc.vcompmat.json",
    label: "aug / Chameleon / 1337 (reported: skin shining through the module)",
  },
  { model: "m4a1", count: 1337, label: "m4a1 / 1337 (the reported case)" },
  { model: "m4a1", count: 1337, legacy: true, label: "m4a1 legacy body" },
  { model: "m4a1", count: 0, label: "m4a1 / 0 kills" },
  { model: "m4a1", count: null, label: "m4a1 / dark display (2D card)" },
  { model: "ak47", count: 42, label: "ak47 / 42" },
  { model: "awp", count: 7, label: "awp / 7 (zero-tilt anchor)" },
  // Reported 2026-07-30: the module renders sunk INTO the AUG's receiver while
  // the name plate on the same weapon sits correctly.
  { model: "aug", count: 1337, label: "aug / 1337 (reported: sunk into the body)" },
  // Same weapon with BOTH modules — the name plate is the control: it seats
  // from its posed position and is reported as correct on this gun.
  { model: "aug", count: 1337, nametag: "CONTROL", label: "aug / 1337 + name plate" },
  // Reported 2026-07-30: StatTrak invisible on a P90 (item 3573, Desert
  // Halftone). Live probe put the module at local x=0.0103 inside a body whose
  // half-width is 0.029 — sunk, not missing. Same class as the aug above.
  { model: "p90", count: 1337, label: "p90 / 1337 (reported: no module visible)" },
  { model: "p90", count: 1337, nametag: "CONTROL", label: "p90 / 1337 + name plate" },
  { model: "sg556", count: 999999, label: "sg556 / 999999 (13.1deg tilt)" },
  { model: "knife_karambit", count: 88, label: "karambit / 88 (knife module)" },
];

async function snap(name: string, png: string) {
  await fetch("/__snap", { method: "POST", body: JSON.stringify({ name, png }) }).catch(() => {});
}

async function shoot(c: (typeof CASES)[number], size = c.size ?? 1400) {
  const host = document.createElement("div");
  // Big, so the module is more than a smudge when it lands on disk. The
  // readout is ~4px per digit at 1400px wide — enough to see THAT digits are
  // there, nowhere near enough to see WHICH, hence the oversized pass below.
  host.style.cssText = `width:${size}px;height:${Math.round((size * 9) / 14)}px;position:fixed;left:-9999px;top:0`;
  document.body.appendChild(host);
  try {
    const handle = await mountViewer(host, c.model, {
      legacyPaint: !!c.legacy,
      paintMaterial: c.pm ?? null,
      wear: 0.05,
      seed: 1,
      interactive: false,
      still: true,
      stattrak: { count: c.count },
      nametag: c.nametag ?? null,
    } as never);
    // A painted body has to composite before it is worth photographing; the
    // bare-model wait is not enough for it.
    await new Promise((r) => setTimeout(r, c.pm ? 9000 : 2500));
    const blob = await handle.snapshot();
    // Probe BEFORE dispose — afterwards the scene it measures is gone.
    try {
      log(`<span class="dim">probe ${c.model}: ${JSON.stringify(handle.probePlacement())}</span>`);
    } catch (e) {
      log(`<span class="warn">probe failed: ${String(e)}</span>`);
    }
    handle.dispose();
    if (!blob) return log(`<span class="fail">FAIL</span> ${c.label}: snapshot() returned null`);
    const png = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob);
    });
    const name = `stattrak_${c.model}${c.legacy ? "_legacy" : ""}_${c.count ?? "dark"}${c.nametag ? "_nametag" : ""}${c.pm ? "_painted" : ""}${size > 1400 ? "_big" : ""}`;
    await snap(name, png);
    log(`<span class="pass">shot</span> ${c.label} <span class="dim">-> snapshots/${name}.png</span>`);
    const img = new Image();
    img.src = png;
    img.width = 700;
    out.appendChild(img);
  } catch (e) {
    log(`<span class="fail">FAIL</span> ${c.label}: ${String((e as Error)?.stack ?? e)}`);
  } finally {
    host.remove();
  }
}

// Dump the composed digit strip itself, straight from the real
// composeDigitAtlas, before it ever reaches a material. Isolates "the strip is
// wrong" from "the strip is right but mapped onto the plate wrong" — the two
// have identical symptoms on the weapon and completely different fixes.
async function dumpStrips() {
  const img = new Image();
  img.src = "/models/stattrak_digit_atlas_psd_bf07cc9c.png";
  await new Promise((r) => (img.onload = r));
  log(`<span class="dim">atlas ${img.width}x${img.height}</span>`);
  for (const v of [1337, 0, null, 999999]) {
    const canvas = composeDigitAtlas(img as never, v);
    await snap(`strip_${v ?? "dark"}`, canvas.toDataURL("image/png"));
    log(`<span class="pass">strip</span> ${v ?? "dark"} ${canvas.width}x${canvas.height} <span class="dim">-> snapshots/strip_${v ?? "dark"}.png</span>`);
    out.appendChild(canvas);
  }
}

// Settle the Source->three Euler convention by MEASUREMENT. The plate must
// end up coplanar with the blade, so its extent along the axis the knife is
// thinnest in must be minimal. Guns can't decide this (their anchors are
// unrotated); the karambit's [-54.1, 0, -170.4] can.
async function eulerSweep() {
  log('<span class="dim">EULER SWEEP (karambit) — want module thin on the knife\'s thin axis</span>');
  const g = globalThis as { __stEulerMode?: number; __stBox?: string };
  for (let m = 0; m < 8; m++) {
    g.__stEulerMode = m;
    const host = document.createElement("div");
    host.style.cssText = "width:700px;height:450px;position:fixed;left:-9999px;top:0";
    document.body.appendChild(host);
    try {
      const h = await mountViewer(host, "knife_karambit", {
        wear: 0.05, seed: 1, interactive: false, still: true,
        stattrak: { count: 88 },
      } as never);
      await new Promise((r) => setTimeout(r, 900));
      log(`<span class="dim">mode ${m}: ${g.__stBox ?? "no box"}</span>`);
      h.dispose();
    } catch (e) {
      log(`<span class="fail">mode ${m} failed: ${String(e)}</span>`);
    } finally {
      host.remove();
    }
  }
  g.__stEulerMode = 0;
}

// `?only=aug` narrows the run to one model. A full pass is ~8 weapon mounts and
// most debugging is about ONE of them; waiting out the other seven (and the
// strip dump) is the difference between a 10-second loop and a minute.
const ONLY = new URLSearchParams(location.search).get("only");

/**
 * Seat EVERY gun and report the numbers, no snapshots.
 *
 * The fixtures above are a handful of weapons picked because something went
 * wrong on them. Seating is generic code, so a change to it moves all 35 — and
 * "the six I looked at are fine" is how the aug and p90 shipped sunk in the
 * first place. This is the cheap sweep that says which weapons to go LOOK at:
 *
 *   MISS  — the ray found no surface, so the module sits wherever the anchor
 *           put it. Not necessarily wrong, but nothing checked it.
 *   FAR   — the correction ran past the 2cm cap and was thrown away.
 *   BIG   — over 1cm of movement. Legitimate on a fat receiver, but it is also
 *           what a ray through a magwell gap looks like.
 */
async function sweep() {
  const anchors = STATTRAK_ANCHORS as Record<string, { knife: boolean } | undefined>;
  const g = globalThis as { __stBox?: string; __stClearance?: string };
  const models = Object.keys(anchors).filter((m) => !anchors[m]!.knife).sort();
  log(`<span class="dim">SWEEP ${models.length} guns — seating report</span>`);
  for (const model of models) {
    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:400px;position:fixed;left:-9999px;top:0";
    document.body.appendChild(host);
    g.__stBox = undefined;
    g.__stClearance = undefined;
    try {
      const h = await mountViewer(host, model, {
        wear: 0.05, seed: 1, interactive: false, still: true, stattrak: { count: 1337 },
      } as never);
      await new Promise((r) => setTimeout(r, 400));
      h.dispose();
      if (!g.__stBox) {
        log(`<span class="warn">no module</span> ${model}`);
        continue;
      }
      // `at` is two space-separated coords ("z0.08 y0.75"), so \S+ stops short.
      const c = /worstClearance=(-?[\d.]+)mm at (z[\d.]+ y[\d.]+) push=([\d.]+)mm( SKIPPED)?/.exec(g.__stClearance ?? "");
      if (!c) {
        log(`<span class="warn">no readout</span> ${model} <span class="dim">nothing under the plate to clear</span>`);
        continue;
      }
      const [, worst, at, push, skipped] = c;
      const pushed = Number(push);
      const tag = skipped
        ? '<span class="warn">left alone</span>'
        : pushed > 0
          ? '<span class="pass">nudged</span>'
          : '<span class="pass">ok</span>';
      const why = skipped ? " — too deep to be a rounding error, see clearReadout" : pushed ? ` -> pushed ${push}mm` : "";
      log(`${tag} ${model} <span class="dim">clearance ${worst}mm at ${at}${why}</span>`);
    } catch (e) {
      log(`<span class="fail">FAIL</span> ${model}: ${String(e)}`);
    } finally {
      host.remove();
    }
  }
}

async function main() {
  out.innerHTML = "";
  (globalThis as { __stDebug?: boolean }).__stDebug = true;
  if (new URLSearchParams(location.search).has("sweep")) {
    await sweep();
    return log('<span class="dim">done</span>');
  }
  if (!ONLY) await dumpStrips();
  // Anchor sanity first — cheap, and if this is wrong the pictures are moot.
  const anchors = STATTRAK_ANCHORS as Record<string, { hd?: { pos: number[] }; legacy?: { pos: number[] }; knife: boolean }>;
  log(`<span class="dim">anchors: ${Object.keys(anchors).length} models</span>`);
  log(`<span class="dim">digits 1337 -> [${digitColumns(1337)}]  0 -> [${digitColumns(0)}]  null -> [${digitColumns(null)}]</span>`);
  for (const c of CASES) {
    if (ONLY && c.model !== ONLY) continue;
    if (!anchors[c.model]) {
      log(`<span class="warn">skip</span> ${c.label}: no anchor`);
      continue;
    }
    await shoot(c);
  }
  // Oversized pass on the readout cases: the only way to judge WHICH digits
  // rendered rather than merely that something orange did.

  log('<span class="dim">done</span>');
}

void main();
