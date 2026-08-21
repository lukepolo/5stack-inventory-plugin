// The first-person view, fired, photographed frame by frame.
//
// `flash.html` proves the muzzle flash composites correctly ON ITS OWN — both
// plainly and through the bloom composer. So anything still wrong with it is a
// property of the REAL scene: the rig it hangs off, the letterboxed camera, the
// other things drawn in the same frame. This mounts the actual viewer in first
// person, pulls the trigger, and snapshots a burst so the offending frame can
// be looked at rather than reasoned about.
//
//   node tools/shadertest/shoot.mjs 'http://localhost:5199/fpv.html?model=aug' out/fpv --wait 30000
//
// ?model=  weapon stem (default aug)
// ?arms=   glove GLB (default ct_gloves)
// ?action= what to press (default fire)
// ?n=      how many frames to grab (default 8, ~40ms apart)
import { mountViewer } from "../../src/viewer3d";
import type { ClipAction } from "../../src/viewmodelClip";

const q = new URLSearchParams(location.search);
const MODEL = q.get("model") ?? "aug";
const ARMS = q.get("arms") ?? "ct_gloves";
const ACTION = (q.get("action") ?? "fire") as ClipAction;
const N = Number(q.get("n") ?? 8);
const GAP = Number(q.get("gap") ?? 40); // kept for the mount settle only
void GAP;

// The dials, overridable per run: `&fpvx=-0.1&fpvy=0.06`. debugNumber reads
// them out of localStorage under `viewer3d.<name>`, so seeding them here is how
// a sweep gets a different pose per shot without touching devFlags.
for (const k of ["fpvx", "fpvy", "fpvz", "fpvyaw", "fpvpitch", "fpvfov", "fpvshiftx", "fpvshifty"]) {
  const v = q.get(k);
  if (v != null) localStorage.setItem(`viewer3d.${k}`, v);
  else localStorage.removeItem(`viewer3d.${k}`);
}

const el = document.getElementById("out")!;
const stage = document.getElementById("stage")!;
const line = (t: string, cls = "") => {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = t;
  el.appendChild(d);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  line(`model=${MODEL} arms=${ARMS} action=${ACTION} frames=${N} gap=${GAP}ms`, "dim");
  const handle = await mountViewer(stage, MODEL, {
    firstPerson: { arms: ARMS, action: "idle" },
    interactive: false,
    wear: 0,
    seed: 0,
  });
  if (!handle) {
    line("mountViewer returned nothing", "fail");
    return;
  }
  // The clips, the arms GLB, the weapon composite and the fx textures all land
  // after the mount resolves.
  await sleep(6000);

  /**
   * EVERY FRAME, off the VISIBLE canvas.
   *
   * `handle.snapshot()` goes through a blob and a FileReader, which takes long
   * enough that consecutive "frames" land ~100ms apart — and the flash lives
   * for 70ms, so a burst sampled that way photographs the aftermath every time
   * and reads as "the flash never draws".
   *
   * The viewer copies each rendered frame into a 2D canvas (that is what the
   * page shows), and a 2D canvas can be read whenever — no preserveDrawingBuffer
   * needed, and it is literally what the user is looking at.
   */
  const frames: { label: string; url: string }[] = [];
  const rAF = () => new Promise<number>((r) => requestAnimationFrame(r));
  const capture = (label: string) => {
    let best = "";
    for (const c of stage.querySelectorAll("canvas")) {
      try {
        const url = (c as HTMLCanvasElement).toDataURL("image/png");
        if (url.length > best.length) best = url;
      } catch {
        /* a WebGL canvas without preserveDrawingBuffer reads back blank; skip */
      }
    }
    if (best) frames.push({ label, url: best });
  };

  await rAF();
  capture("idle (before firing)");
  handle.setFpvAction(ACTION);
  for (let i = 0; i < N; i++) {
    await rAF();
    capture(`${ACTION} frame ${i + 1}`);
  }
  for (const f of frames) {
    line(f.label, "dim");
    const img = document.createElement("img");
    img.src = f.url;
    img.style.cssText = "width:480px";
    el.appendChild(img);
  }
  line("done", "pass");
  handle.dispose();
}

void run().catch((e) => line(`ERROR ${(e as Error).message}\n${(e as Error).stack ?? ""}`, "fail"));
