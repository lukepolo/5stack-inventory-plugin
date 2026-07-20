// Seed audit: does the pattern seed reach the pixels, and how much of it
// survives to what the user actually sees?
//
// Replaces four throwaway pages written while chasing "patterns don't respond
// to the seed". The conclusion that came out of them is worth keeping as a
// standing check, because the answer was NOT the obvious one:
//
//   - Seed -> pattern PLACEMENT is correct. Proven by a negative control: a
//     skin whose vcompmat envelopes all collapse to a point (USP-S Printstream)
//     samples bit-identically across seeds, while MAG-7 | Navy Shine moves by
//     ~a third of full scale.
//   - The pattern is then heavily ATTENUATED downstream. Navy Shine's sampled
//     pattern moves by mean ~80/255 between seeds; its composited albedo moves
//     by mean ~2.5. See the styleNote on the MAG-7 case.
//
// So the interesting number is not "did it change" but the attenuation from one
// stage to the next. Each stage is measured with the same full-resolution
// metric so the ratios mean something.
import { runOne, runViewer } from "./rig";
import { SEED_SWEEP } from "./fixtures";

interface Case {
  name: string;
  model: string;
  pm: string;
  wear: number;
  styleNote?: string;
}

/**
 * Whether the seed CAN move the sampled pattern, derived from the resolved
 * paint rather than hardcoded per case. Two independent ways it cannot:
 *
 *  - no pattern texture at all (styles like 0/solid never ship one), in which
 *    case tPattern binds to the 1x1 white fallback and samples identically at
 *    every UV;
 *  - degenerate vcompmat envelopes, which is how authored placements (custom
 *    paintjob, gunsmith) pin a skin to one fixed layout.
 *
 * Both are correct behaviour, and both look exactly like a broken seed. Writing
 * the expectation by hand got Five-SeveN | Autumn Thicket wrong — it has live
 * envelopes (-1..1, -360..360) and no pattern texture, so it can never move.
 */
const seedCanMove = (r: { pattern?: string; seedInert?: boolean }) =>
  !!r.pattern && !r.seedInert;

const CASES: Case[] = [
  {
    name: "MAG-7 | Navy Shine", model: "mag7", wear: 0.415,
    pm: "/materials/am_navy_shine_122024d8.vcompmat.json",
    styleNote:
      "Style 4 (anodized multi). Placement is correct but the composite barely " +
      "moves. Two suspects, both measured: (1) paintComposite.ts:826-829 re-mixes " +
      "cPaint toward uC2/uC3 by masks.g/masks.b AFTER the pattern already mixed " +
      "between those same entries — measured masks.g mean 0.31, masks.b mean 0.22, " +
      "so ~46% of the pattern-derived colour is discarded. Style 2 is the only " +
      "style that skips this re-mix, and style 2 is the only one that visibly " +
      "responds to the seed. (2) paintComposite.ts:721 doubles pattern.a for " +
      "style 4, but pattern.a is never read again on that path — dead code. " +
      "NOT fixed: needs an in-game capture to establish the correct form.",
  },
  {
    name: "P90 | Desert Halftone", model: "p90", wear: 0.11,
    pm: "/materials/ht_simple_camo_35a9b53a.vcompmat.json",
    styleNote: "Style 2 (spraypaint). The style that skips the masks re-mix, and the one whose seed response is clearly visible.",
  },
  {
    name: "Five-SeveN | Autumn Thicket", model: "fiveseven", wear: 0.265,
    pm: "/materials/soo_branches_1bfe8683.vcompmat.json",
    styleNote: "Style 0 (solid). NO g_tPattern anywhere in its vcompmat or template, so tPattern is the 1x1 white fallback and placement can never move — despite live envelopes (-1..1, -360..360). Composite movement here is wear/grunge only.",
  },
  {
    name: "USP-S | Printstream (control)", model: "usp_silencer", wear: 0.05,
    pm: "/materials/cu_usp_printstream_a18d8674.vcompmat.json",
    styleNote: "Style 6 (custom paintjob): authored placement, degenerate envelopes. Negative control — sampled pattern MUST be bit-identical across seeds.",
  },
];

const VIEWER = new URLSearchParams(location.search).has("viewer");

const out = document.getElementById("out")!;
const el = (tag: string, cls = "", text = "") => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  out.appendChild(d);
  return d;
};
const line = (s: string, cls = "") => el("pre", cls, s);

/** Full-resolution mean absolute RGB difference, 0..255.
 *  The 8x8 luma thumbprint used elsewhere in this rig averages away exactly the
 *  kind of change a relocating pattern produces — it reported 1.3 for a pair of
 *  images whose sampled pattern differed by 80. Do not substitute it here. */
async function decode(dataUrl: string): Promise<ImageData> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, cv.width, cv.height);
}
function meanAbsDiff(a: ImageData, b: ImageData): number {
  if (a.width !== b.width || a.height !== b.height) return NaN;
  let sum = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i])
         + Math.abs(a.data[i + 1] - b.data[i + 1])
         + Math.abs(a.data[i + 2] - b.data[i + 2]);
    n += 3;
  }
  return sum / n;
}

const snap = (name: string, png: string) =>
  fetch("/__snap", { method: "POST", body: JSON.stringify({ name, png }) }).catch(() => {});

/** Runs one stage across SEED_SWEEP and returns the max diff vs the first seed. */
async function stage(
  label: string,
  render: (seed: number) => Promise<string | undefined>,
  tag: string,
  showStrip: boolean,
): Promise<number> {
  let base: ImageData | undefined;
  let max = 0;
  const strip = showStrip ? el("div", "strip") : null;
  const progress = el("pre", "dim", `  ${label}: …`);
  for (const s of SEED_SWEEP) {
    // A composite that never resolves used to hang the page with no output at
    // all, which is indistinguishable from "still working". Time-box it and say
    // which call stalled.
    const t0 = performance.now();
    progress.textContent = `  ${label}: rendering seed ${s}…`;
    const png = await Promise.race([
      render(s),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 120_000)),
    ]);
    if (!png) {
      progress.textContent = "";
      line(`  ${label}: render returned nothing / timed out at seed ${s} after ${((performance.now() - t0) / 1000).toFixed(0)}s`, "fail");
      return NaN;
    }
    console.log(`[seedaudit] ${label} seed ${s} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    void snap(`${tag}_${s}`, png);
    const img = await decode(png);
    if (!base) base = img;
    else max = Math.max(max, meanAbsDiff(img, base));
    if (strip) {
      const fig = document.createElement("figure");
      const i = document.createElement("img");
      i.src = png;
      fig.appendChild(i);
      const cap = document.createElement("figcaption");
      cap.textContent = `seed ${s}`;
      fig.appendChild(cap);
      strip.appendChild(fig);
    }
  }
  progress.textContent = "";
  return max;
}

(async () => {
  const summary: { name: string; placement: number; composite: number; viewer?: number; ok: boolean }[] = [];

  for (const c of CASES) {
    el("h2", "", c.name);
    if (c.styleNote) line(c.styleNote, "dim");

    const probe = await runOne(c.model, c.pm, c.wear, SEED_SWEEP[0], 64);
    if (probe.error) { line(`  ERROR ${probe.error.slice(0, 300)}`, "fail"); continue; }
    line(
      `  style=${probe.style} pattern=${probe.pattern ?? "NONE (1x1 white fallback)"} ` +
      `envelopes=${JSON.stringify(probe.seedRanges)} inert=${probe.seedInert}`,
      "dim",
    );
    const shouldMove = seedCanMove(probe);

    // Stage A — placement. The pattern exactly as the shader samples it.
    const placement = await stage(
      "placement",
      async (s) => (await runOne(c.model, c.pm, c.wear, s, 256, false, 2)).png,
      `audit_${c.model}_pattern`,
      true,
    );

    // Stage B — composite. How much of stage A survives the paint pipeline.
    const composite = await stage(
      "composite",
      async (s) => (await runOne(c.model, c.pm, c.wear, s, 256)).png,
      `audit_${c.model}_albedo`,
      true,
    );

    // Stage C — the real viewer, optional because it is slow (mounts a GLB and
    // waits for textures per seed). This is the only stage that measures what a
    // user actually looks at.
    let viewer: number | undefined;
    if (VIEWER) {
      viewer = await stage(
        "viewer",
        async (s) => (await runViewer(c.model, c.pm, c.wear, s, { width: 420, height: 280 })).png,
        `audit_${c.model}_viewer`,
        true,
      );
    }

    // Placement is the assertion. Composite/viewer are reported, not asserted:
    // a low-contrast skin legitimately shows little, and hard-coding a floor
    // there would just bake in whatever the pipeline does today.
    const moved = placement >= 1.0;
    const ok = moved === shouldMove;
    const atten = placement > 0 ? (composite / placement) : NaN;
    line(
      `  placement=${placement.toFixed(2)}  composite=${composite.toFixed(2)}` +
      (viewer !== undefined ? `  viewer=${viewer.toFixed(2)}` : "") +
      `  attenuation(composite/placement)=${isNaN(atten) ? "n/a" : atten.toFixed(3)}`,
    );
    line(
      `  ${ok ? "PASS" : "FAIL"} — expected the seed to ${shouldMove ? "MOVE" : "NOT move"} the sampled pattern, ` +
      `it ${moved ? "moved" : "did not move"}`,
      ok ? "pass" : "fail",
    );
    if (ok && shouldMove && atten < 0.15) {
      line(
        `  NOTE placement is correct but ${((1 - atten) * 100).toFixed(0)}% of it is lost before the albedo — ` +
        `the seed works, the skin just barely shows it.`,
        "warn",
      );
    }
    summary.push({ name: c.name, placement, composite, viewer, ok });
  }

  el("h2", "", "Summary");
  const t = el("table") as HTMLTableElement;
  const row = (cells: string[], tag: "td" | "th", classes: string[] = []) => {
    const tr = document.createElement("tr");
    cells.forEach((c, i) => {
      const cell = document.createElement(tag);
      cell.textContent = c;
      if (classes[i]) cell.className = classes[i];
      tr.appendChild(cell);
    });
    t.appendChild(tr);
  };
  row(["skin", "placement", "composite", ...(VIEWER ? ["viewer"] : []), "attenuation", ""], "th");
  for (const s of summary) {
    row(
      [
        s.name, s.placement.toFixed(2), s.composite.toFixed(2),
        ...(VIEWER ? [s.viewer?.toFixed(2) ?? "-"] : []),
        s.placement > 0 ? (s.composite / s.placement).toFixed(3) : "n/a",
        s.ok ? "PASS" : "FAIL",
      ],
      "td",
      [, , , ...(VIEWER ? [undefined] : []), , s.ok ? "pass" : "fail"] as string[],
    );
  }

  if (!VIEWER) line("\nAdd ?viewer to also measure the real 3D viewer (slower: mounts a GLB per seed).", "dim");
  (window as any).__seedAudit = summary;
  (window as any).__done = true;
  line("\ndone");
})();
