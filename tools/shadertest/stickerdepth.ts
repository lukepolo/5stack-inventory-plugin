// Sticker depth suite: does a sticker stay ON TOP of the weapon from every
// angle it is visible from?
//
// Why this exists
// ---------------
// Stickers rendered correctly "about 95% of the time" — the same sticker in the
// same slot at the same offset would sit on the surface from one camera angle
// and sink behind the gun from another. That is the signature of a depth bias
// that depends on the view: `polygonOffsetFactor` scales with a triangle's
// depth SLOPE, so the bias a decal gets changes as you orbit. Decal geometry is
// exactly coplanar with the surface it is projected onto, so the bias was the
// only thing separating them.
//
// The measurement avoids any judgement call. For each angle we render three
// images from the REAL viewer:
//
//   base  — no stickers
//   top   — stickers with depthTest off, i.e. the decal's true silhouette,
//           the upper bound a correct render must reach
//   norm  — stickers as they actually ship
//
// coverage = |norm ≠ base| / |top ≠ base|. A sticker fully on the surface
// scores 1.0; one sinking behind the gun scores lower. No eyeballing.
import { mountViewer } from "../../src/viewer3d";

const MODEL = "ak47";
const STICKER = "/images/dh_gologo1_df566daa.webp";
// Angles either side of the default framing, where the sticker face is still
// toward the camera. Rendering the far side would make depthTest-off draw the
// decal THROUGH the gun and the comparison would be meaningless.
const ANGLES = [-0.35, 0, 0.35];
const W = 640, H = 440;
// Close framing. At the default distance the whole weapon is ~200px wide and a
// sticker covers a few hundred pixels, so edge antialiasing swamps the signal
// we are trying to measure. Zoomed in, a sticker is thousands of pixels.
const FRAME = 0.4;
// Coverage below this is a sticker losing pixels to the weapon it sits on.
const PASS = 0.98;

const el = document.getElementById("out")!;
const line = (s: string, cls = "") => {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = s;
  el.appendChild(d);
};

async function pixels(dataUrl: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H).data;
}

/** Count pixels where two renders differ beyond sensor noise. */
function diffCount(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++;
  }
  return n;
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(b);
  });
}

async function render(
  host: HTMLElement, angle: number, onTop: boolean, slots: any[],
): Promise<{ withS: string; base: string }> {
  const stickers = [0, 1, 2, 3].map((slot) => ({ slot, image: STICKER, x: null, y: null, r: null, w: null }));
  const handle = await mountViewer(host, MODEL, {
    paintMaterial: null, interactive: false, still: true, frame: FRAME,
    viewAngle: angle, debugStickerOnTop: onTop,
    stickers, stickerSlots: slots,
  } as any);
  await new Promise((r) => setTimeout(r, 2200)); // textures + a few frames
  const withS = await blobToDataUrl((await handle.snapshot())!);
  handle.setStickers([]);
  await new Promise((r) => setTimeout(r, 400));
  const base = await blobToDataUrl((await handle.snapshot())!);
  handle.dispose();
  await new Promise((r) => setTimeout(r, 60));
  return { withS, base };
}

(async () => {
  line(`sticker depth sweep — ${MODEL}, ${ANGLES.length} angles`);
  line(`coverage = visible sticker pixels / unoccluded sticker pixels; pass >= ${PASS}`, "dim");
  line("");

  // Slot markup, without which placement falls back to the silhouette guess.
  let slots: any[] = [];
  try {
    const r = await fetch(`/api/catalog/sticker-bounds/${MODEL}`);
    const j = await r.json();
    slots = j.slots ?? j ?? [];
  } catch (e) {
    line(`could not load slot markup: ${e}`, "warn");
  }

  const host = document.createElement("div");
  host.style.cssText = `width:${W}px;height:${H}px;position:fixed;left:-9999px;top:0`;
  document.body.appendChild(host);

  let pass = 0, fail = 0;
  const strip = document.createElement("div");

  for (const angle of ANGLES) {
    const deg = ((angle * 180) / Math.PI).toFixed(0);
    try {
      const norm = await render(host, angle, false, slots);
      const top = await render(host, angle, true, slots);

      const pBase = await pixels(norm.base);
      const pNorm = await pixels(norm.withS);
      const pTop = await pixels(top.withS);

      const areaTop = diffCount(pTop, pBase);
      const areaNorm = diffCount(pNorm, pBase);
      const coverage = areaTop ? areaNorm / areaTop : 0;
      const ok = coverage >= PASS && areaTop > 200;

      line(
        `${deg.padStart(5)}°   coverage ${(coverage * 100).toFixed(1)}%   ` +
        `visible ${areaNorm} / ${areaTop} px   ${ok ? "PASS" : "FAIL"}`,
        ok ? "pass" : "fail",
      );
      if (areaTop <= 200) line("      (sticker barely visible at this angle — check framing)", "warn");
      ok ? pass++ : fail++;

      for (const src of [norm.withS, top.withS]) {
        const im = new Image();
        im.src = src; im.width = 210;
        strip.appendChild(im);
      }
    } catch (e: any) {
      line(`${deg.padStart(5)}°   ERROR ${String(e?.message ?? e).slice(0, 100)}`, "fail");
      fail++;
    }
  }
  host.remove();

  line("");
  line(`${pass} passed, ${fail} failed`, fail ? "fail" : "pass");
  line("");
  line("per angle: shipped render (left) vs depth-ignoring upper bound (right)", "dim");
  el.appendChild(strip);
  (window as any).__stickerdepth = { pass, fail };
})();
