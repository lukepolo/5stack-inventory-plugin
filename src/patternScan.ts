/**
 * Score every pattern a finish has, by compositing all of them.
 *
 * The community answers "which pattern do I want" with hand-maintained
 * spreadsheets — blue gem tiers, fade percentages, playside charts — built by
 * people eyeballing screenshots for years. They have to, because every other
 * site serves pre-baked images and has no way to ask the question.
 *
 * We can just measure it. compositePaint is model-free (a PaintDef and a
 * meta.json, no GLB), its inputs are cached for the session, and `maxSize` runs
 * it small — so a thousand patterns is a thousand pairs of fullscreen passes
 * over textures already on the GPU. Seconds, from Valve's own shader, rather
 * than a table someone typed.
 *
 * WHAT THIS MEASURES, precisely: the composited albedo, which is a UV ATLAS —
 * the whole unwrap, both sides, gutters and all. That is NOT the same as what
 * the playside shows, so these numbers are not the community's numbers and must
 * never be presented as them. What survives the difference is the RANKING: a
 * pattern that puts more blue in the atlas puts more blue on the gun. Finding
 * the blue ones is the job; quoting a tier is not.
 */
import { loadPaintDef, loadWeaponInputs, compositePaint, type PaintDef } from "./paintComposite";
import { withSharedRenderer } from "./viewer3d";

/** Composite resolution for a scan. A coverage fraction is a statistic over
 *  thousands of texels — it converges long before the resolution a human needs
 *  to look at, and this is 64x fewer pixels than the 2048 a viewer composites. */
const SCAN_SIZE = 256;
/** Readback resolution. Smaller again: the metric is a histogram, and a 128²
 *  readback is 64KB against 256KB for no measurable change in the answer. */
const READ_SIZE = 128;
/** Patterns per yield. The shared renderer also drives every live viewer, so
 *  the scan hands the main thread back often enough to keep them at frame rate
 *  rather than freezing the page for the whole sweep. */
const CHUNK = 12;

export interface PatternMetric {
  key: string;
  /** What is being counted, for a readout: "63% blue". */
  label: string;
  /**
   * The offer, as the user would phrase the want: "the bluest".
   *
   * Written as a noun phrase completing "Find …" because that is the sentence
   * someone is already saying to themselves. A row of bare nouns — BLUE, GOLD,
   * COLOUR — reads as a filter, a paint choice, or nothing at all; every reading
   * except the right one.
   */
  hunt: string;
  /**
   * Fraction 0..1 over the weapon's artwork.
   *
   * `weights` is per-texel importance — world-space surface area times how much
   * that surface faces the camera (see ViewerHandle.paintUvWeights). Absent
   * when no model was available, in which case every texel counts the same and
   * the answer is over the raw atlas.
   */
  score: (px: Uint8ClampedArray, weights?: Float32Array | null) => number;
}

/** HSV, on 0..255 bytes. Hue in degrees, s/v in 0..1. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h < 0 ? h + 360 : h, mx ? d / mx : 0, mx / 255];
}

/**
 * Count texels inside a hue band, as a fraction of the weapon's own texels.
 *
 * The denominator is what matters here. An atlas is mostly empty — gutters and
 * unused island space read as near-black — and dividing by every texel would
 * score a finish on how efficiently its unwrap was packed. So near-black and
 * near-grey texels are excluded from BOTH sides: what is being measured is the
 * share of the coloured artwork that falls in the band.
 */
function bandFraction(
  px: Uint8ClampedArray,
  from: number,
  to: number,
  weights?: Float32Array | null,
): number {
  let hits = 0;
  let total = 0;
  for (let i = 0, t = 0; i < px.length; i += 4, t++) {
    if (px[i + 3] < 8) continue;
    // Zero weight means no triangle lands here — a gutter. Skipping it is the
    // difference between measuring the artwork and measuring the unwrap.
    const w = weights ? weights[t] : 1;
    if (!w) continue;
    const [h, s, v] = hsv(px[i], px[i + 1], px[i + 2]);
    if (v < 0.06 || s < 0.18) continue; // unpainted atlas, or bare metal
    total += w;
    // Bands may wrap past 360 (reds); compare on the circle, not the number.
    const inBand = from <= to ? h >= from && h <= to : h >= from || h <= to;
    if (inBand) hits += w;
  }
  return total ? hits / total : 0;
}

const BLUE: PatternMetric = {
  key: "blue",
  label: "blue",
  hunt: "the bluest",
  // Deliberately wide. Case hardening's blues run from a steel cyan through to
  // a deep violet depending where on the ramp a texel lands, and a band tight
  // enough to mean "blue" to a colour scientist scores the famous patterns low.
  score: (px, w) => bandFraction(px, 185, 265, w),
};

const GOLD: PatternMetric = {
  key: "gold",
  label: "gold",
  hunt: "the most gold",
  score: (px, w) => bandFraction(px, 25, 62, w),
};

/**
 * Kept, but NOT offered. See metricsFor.
 *
 * Ranking a finish by how vivid each pattern came out is only meaningful where
 * the pattern changes the colours. Everywhere else it moves the same artwork
 * around, every pattern scores nearly the same, and the rail draws a flat line
 * that implies a judgement it cannot make. Here for when a metric worth having
 * on those finishes turns up — fade percentage, doppler phase — not as a
 * stand-in for one.
 */
const CHROMA: PatternMetric = {
  key: "chroma",
  label: "colour",
  hunt: "the most colourful",
  /** Mean saturation over the painted texels — "how vivid did this pattern
   *  land", which is the only thing worth ranking on a finish with no colour
   *  the community has named. */
  score: (px, weights) => {
    let sum = 0;
    let total = 0;
    for (let i = 0, t = 0; i < px.length; i += 4, t++) {
      if (px[i + 3] < 8) continue;
      const w = weights ? weights[t] : 1;
      if (!w) continue;
      const [, s, v] = hsv(px[i], px[i + 1], px[i + 2]);
      if (v < 0.06) continue;
      total += w;
      sum += s * w;
    }
    return total ? sum / total : 0;
  },
};

/**
 * Which hunts are worth offering for a finish — empty for most of them.
 *
 * Case hardening is the one place the game turns the pattern into COLOUR rather
 * than placement: pattern.r and pattern.g index a ramp, so blue and gold are
 * real, separable things to rank, and they are exactly what people hunt.
 *
 * Everywhere else this returns NOTHING, on purpose. A ranking offered where no
 * pattern is meaningfully better than another is worse than no ranking at all —
 * it draws a flat curve, implies a judgement it cannot make, and buries the
 * control that does work under buttons that do not. The rail is a scrub bar on
 * those finishes, which is what it should be.
 */
export function metricsFor(def: PaintDef): PatternMetric[] {
  return def.caseHardening ? [BLUE, GOLD] : [];
}

export interface PatternScan {
  metric: string;
  label: string;
  min: number;
  max: number;
  /** Raw fraction per pattern, indexed by `seed - min`. */
  scores: Float32Array;
  /** Highest score in the sweep, for normalising the rail's height. */
  peak: number;
  /** Best patterns, descending. */
  top: number[];
}

export interface ScanRequest {
  paintMaterial: string;
  model: string;
  legacy: boolean;
  metric?: string;
  min?: number;
  max?: number;
  /**
   * Per-texel importance at READ_SIZE², from ViewerHandle.paintUvWeights.
   *
   * Optional, and the results say which they are: with it the scan measures the
   * GUN, without it the atlas. Weighted is strictly better, so the rail waits
   * for a mounted model rather than scanning early and caching the weaker answer.
   */
  weights?: Float32Array | null;
  /** Called with 0..1 as the sweep proceeds. */
  onProgress?: (f: number) => void;
  /** Checked between chunks — return false to abandon the sweep. */
  stillWanted?: () => boolean;
}

/** Texel grid the scan reads back at — what `weights` must be sized for. */
export const SCAN_READ_SIZE = READ_SIZE;

/**
 * Scanned at a FIXED wear, not the item's.
 *
 * A pattern index is a property of the pattern, and the community quotes tiers
 * without reference to float for exactly that reason. Scanning at the item's
 * own wear would also mean re-scanning the whole space every time the wear
 * slider moved, which is a thousand composites to answer a question the wear
 * did not change.
 */
const SCAN_WEAR = 0;

const cache = new Map<string, PatternScan>();
// The weighting is in the key because it changes the ANSWER, not the speed: an
// atlas-wide scan and a gun-weighted one rank patterns differently, and serving
// one for the other would quietly pin whichever ran first.
const cacheKey = (r: ScanRequest, metric: string) =>
  `${r.paintMaterial}|${r.model}|${r.legacy ? "l" : "h"}|${metric}|${r.min ?? 1}|${r.max ?? 1000}|${r.weights ? "w" : "flat"}`;

/** A completed scan for this finish and metric, if one was already run. */
export function cachedScan(r: ScanRequest, metric: string): PatternScan | null {
  return cache.get(cacheKey(r, metric)) ?? null;
}

/**
 * How much two patterns actually differ, 0..1, weighted by what you can see.
 *
 * The question behind "this one only changes it slightly". Some finishes move a
 * lot between neighbouring patterns and some move almost nothing — Heat Treated
 * being the one that prompted this — and there is no way to tell by looking at
 * two numbers. Measuring it turns "is this worth comparing" into a fact.
 *
 * Mean absolute colour difference over the weighted texels. Both composites are
 * almost always already in the renderer's LRU by the time this is asked, since
 * the viewer just rendered one of them.
 */
export async function comparePatterns(
  r: Omit<ScanRequest, "metric" | "onProgress" | "stillWanted">,
  a: number,
  b: number,
): Promise<number | null> {
  if (a === b) return 0;
  const def = await loadPaintDef(r.paintMaterial);
  if (!def) return null;
  const weapon = await loadWeaponInputs(r.model, r.legacy);
  return withSharedRenderer(async (THREE, renderer) => {
    const rt = new THREE.WebGLRenderTarget(READ_SIZE, READ_SIZE, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const read = async (seed: number) => {
      const comp = await compositePaint(THREE, renderer, def, {
        wear: SCAN_WEAR,
        seed,
        weapon,
        model: r.model,
        maxSize: SCAN_SIZE,
      }).catch(() => null);
      if (!comp) return null;
      mat.map = comp.albedo;
      mat.needsUpdate = true;
      const buf = new Uint8ClampedArray(READ_SIZE * READ_SIZE * 4);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, READ_SIZE, READ_SIZE, buf);
      renderer.setRenderTarget(null);
      comp.release();
      return buf;
    };
    try {
      const pa = await read(a);
      const pb = await read(b);
      if (!pa || !pb) return null;
      let sum = 0;
      let total = 0;
      for (let i = 0, t = 0; i < pa.length; i += 4, t++) {
        const w = r.weights ? r.weights[t] : 1;
        if (!w) continue;
        total += w;
        // Mean of the three channels, not a Euclidean distance: a channel-wise
        // mean is what "how different does this look" means to an eye, and the
        // distance metric over-rewards a shift that only moves one channel.
        sum +=
          (w * (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]))) /
          3 /
          255;
      }
      return total ? sum / total : 0;
    } finally {
      rt.dispose();
      mat.dispose();
      renderer.setRenderTarget(null);
    }
  });
}

export async function scanPatterns(r: ScanRequest): Promise<PatternScan | null> {
  const def = await loadPaintDef(r.paintMaterial);
  if (!def) return null;
  const choices = metricsFor(def);
  const metric = choices.find((m) => m.key === r.metric) ?? choices[0];
  const hit = cache.get(cacheKey(r, metric.key));
  if (hit) return hit;

  const min = r.min ?? 1;
  const max = r.max ?? 1000;
  const weapon = await loadWeaponInputs(r.model, r.legacy);
  const scores = new Float32Array(max - min + 1);

  const done = await withSharedRenderer(async (THREE, renderer) => {
    // One target, one quad, reused for every pattern — a thousand allocations
    // of each is its own cost, and this is the whole readback rig.
    const rt = new THREE.WebGLRenderTarget(READ_SIZE, READ_SIZE, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const buf = new Uint8ClampedArray(READ_SIZE * READ_SIZE * 4);
    try {
      for (let seed = min; seed <= max; seed++) {
        if (r.stillWanted && !r.stillWanted()) return false;
        const comp = await compositePaint(THREE, renderer, def, {
          wear: SCAN_WEAR,
          seed,
          weapon,
          model: r.model,
          // No `persist`: a scan would otherwise fire up to four 404s per
          // pattern on its way to compositing locally anyway, and there is no
          // point storing a proxy nobody will render from.
          maxSize: SCAN_SIZE,
        }).catch(() => null);
        if (comp) {
          mat.map = comp.albedo;
          mat.needsUpdate = true;
          renderer.setRenderTarget(rt);
          renderer.render(scene, cam);
          renderer.readRenderTargetPixels(rt, 0, 0, READ_SIZE, READ_SIZE, buf);
          renderer.setRenderTarget(null);
          scores[seed - min] = metric.score(buf, r.weights);
          comp.release();
        }
        if ((seed - min) % CHUNK === CHUNK - 1) {
          r.onProgress?.((seed - min + 1) / scores.length);
          // Unbound before yielding, so a viewer's rAF frame never lands while
          // this owns the render target.
          renderer.setRenderTarget(null);
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      return true;
    } finally {
      rt.dispose();
      mat.dispose();
      renderer.setRenderTarget(null);
    }
  });
  if (!done) return null;

  let peak = 0;
  for (const s of scores) if (s > peak) peak = s;
  const top = Array.from(scores)
    .map((s, i) => [s, i + min] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
    .map(([, seed]) => seed);

  const out: PatternScan = { metric: metric.key, label: metric.label, min, max, scores, peak, top };
  cache.set(cacheKey(r, metric.key), out);
  r.onProgress?.(1);
  return out;
}
