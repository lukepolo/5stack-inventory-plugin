// Name plate suite: mounts the REAL viewer with a name tag and measures where
// the plate landed RELATIVE TO THE WEAPON, so placement can be checked instead
// of argued about.
//
// Why this exists
// ---------------
// The plate was iterated on through the deployed app, one screenshot at a time,
// with a human reporting "still wrong". That cost a whole session and several
// wrong theories, every one of which was self-consistent:
//
//   - the anchor was validated against the shipped StatTrak file (it matched),
//   - the seating reported `applied: true` and a flush inner face,
//   - the node's position measured exactly on target,
//
// ...while the plate visibly sat somewhere else entirely. The reason none of it
// caught the bug: they all measured the NODE. The plate's mesh is a sibling root
// inside its glTF scene (node 2, outside node 0's transform chain), so it does
// not sit at the node at all. Every assertion here is therefore taken from the
// MESH and expressed against the weapon:
//
//   flat   |thin . surfaceNormal|  1.0 = lying on the body, 0 = standing on edge
//   gap    inner face to that surface, mm. ~0 = seated, +big = floating,
//          negative = buried
//   long   the reading direction, so "runs along the barrel" vs "down the grip"
//          is a number rather than an impression
//
// Run: `npx vite --config tools/shadertest/vite.config.ts` then open
// /nameplate.html. `?only=deagle` narrows to one model.
import { mountViewer, type NameplateProbe } from "../../src/viewer3d";
import NAMETAG_ANCHORS from "../../src/nametagAnchors.json";

const out = document.getElementById("out")!;
const log = (html: string) => (out.innerHTML += html + "<br>");
const h2 = (t: string) => (out.innerHTML += `<h2>${t}</h2>`);
const f3 = (v: number[] | null) => (v ? v.map((n) => n.toFixed(2)).join(",") : "—");

const ONLY = new URLSearchParams(location.search).get("only");

/** Weapons worth a picture, each here because something went wrong on it. */
const CASES: { model: string; label: string; legacy?: boolean }[] = [
  { model: "ak47", label: "ak47 — the reference: plate above the grip, reads along the gun" },
  { model: "deagle", label: "deagle — reported: flat but horizontal, should follow the grip" },
  { model: "glock", label: "glock — pistol, anchor rotated -68.8deg" },
  { model: "cz75a", label: "cz75a — attachment hangs off the SLIDE bone, not the frame" },
  { model: "elite", label: "elite — dual-wield rig, weapon_r" },
  { model: "knife_karambit", label: "karambit — knife, anchor [74.6, 179.2, -2.2]" },
  { model: "knife_butterfly", label: "butterfly — knife on the `rear` bone" },
  { model: "awp", label: "awp — zero-rotation anchor (control)" },
];

async function snap(name: string, png: string) {
  await fetch("/__snap", { method: "POST", body: JSON.stringify({ name, png }) }).catch(() => {});
}

async function mount(model: string, legacy = false) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:900px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  const handle = await mountViewer(host, model, {
    legacyPaint: legacy,
    wear: 0.05,
    seed: 1,
    interactive: false,
    still: true,
    nametag: "TEST",
  } as never);
  // Textures and a few frames — the plate's label is drawn to a canvas on mount.
  await new Promise((r) => setTimeout(r, 2200));
  return { host, handle };
}

/** Picture + numbers for the hand-picked weapons. */
async function shoot(c: (typeof CASES)[number]) {
  try {
    const { host, handle } = await mount(c.model, c.legacy);
    let probe: NameplateProbe | null = null;
    try {
      probe = handle.probeNameplate();
    } catch (e) {
      log(`<span class="warn">probe failed: ${String(e)}</span>`);
    }
    const blob = await handle.snapshot();
    handle.dispose();
    host.remove();
    log(`${verdict(probe)} ${c.label}`);
    if (probe?.mounted) {
      log(
        `<span class="dim">    flat ${probe.flat?.toFixed(3)}  gap ${probe.gapMm?.toFixed(1)}mm` +
          `  long [${f3(probe.long)}]  normal [${f3(probe.normal)}]  angles [${f3(probe.angles)}]` +
          `${probe.bone ? `  bone ${probe.bone}` : ""}</span>`,
      );
    }
    if (!blob) return;
    const png = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob);
    });
    await snap(`nameplate_${c.model}${c.legacy ? "_legacy" : ""}`, png);
    const img = new Image();
    img.src = png;
    img.width = 700;
    out.appendChild(img);
  } catch (e) {
    log(`<span class="fail">FAIL</span> ${c.label}: ${String((e as Error)?.stack ?? e)}`);
  }
}

/**
 * A plate is right when it lies ON the body and touches it. Both thresholds are
 * deliberately loose — this is here to separate "obviously broken" from "worth
 * looking at", not to police millimetres.
 */
function verdict(p: NameplateProbe | null) {
  if (!p) return '<span class="fail">NO PROBE</span>';
  if (!p.mounted) return '<span class="fail">NOT MOUNTED</span>';
  if (p.flat == null) return '<span class="warn">NO SURFACE</span>';
  if (p.flat < 0.8) return '<span class="fail">ON EDGE</span>';
  if (p.gapMm != null && p.gapMm > 4) return '<span class="warn">FLOATING</span>';
  if (p.gapMm != null && p.gapMm < -3) return '<span class="warn">BURIED</span>';
  return '<span class="pass">ok</span>';
}

/**
 * Every model with an anchor, numbers only.
 *
 * The fixtures above are the weapons somebody complained about. Placement is
 * generic code, so a change moves all 57 — and "the ones I looked at are fine"
 * is exactly how the pistols and all 22 knives shipped broken.
 */
async function sweep() {
  const anchors = NAMETAG_ANCHORS as Record<string, unknown>;
  const models = Object.keys(anchors).sort();
  h2(`SWEEP — ${models.length} models`);
  const bad: string[] = [];
  for (const model of models) {
    try {
      const { host, handle } = await mount(model);
      const p = handle.probeNameplate();
      handle.dispose();
      host.remove();
      const v = verdict(p);
      if (!v.includes("pass")) bad.push(model);
      log(
        `${v} <span style="display:inline-block;min-width:170px">${model}</span>` +
          `<span class="dim">flat ${p.flat?.toFixed(3) ?? "—"}  gap ${p.gapMm?.toFixed(1) ?? "—"}mm` +
          `  long [${f3(p.long)}]${p.bone ? `  bone ${p.bone}` : ""}</span>`,
      );
    } catch (e) {
      bad.push(model);
      log(`<span class="fail">FAIL</span> ${model}: ${String(e)}`);
    }
  }
  h2(bad.length ? `${bad.length} need a look: ${bad.join(", ")}` : "all clean");
}

(async () => {
  out.innerHTML = "";
  h2("FIXTURES");
  for (const c of CASES) {
    if (ONLY && c.model !== ONLY) continue;
    await shoot(c);
  }
  if (!ONLY) await sweep();
  log('<span class="dim">done</span>');
})();
