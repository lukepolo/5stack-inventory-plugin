// Shared rig: resolve a paint the way the app does, run the REAL compositor on
// the GPU, and read the resulting albedo back as pixels.
//
// The point of reading pixels back is that nothing here is a reimplementation.
// A separate model of the shader (in Python, say) only ever proves itself
// self-consistent — it cannot see a bug in the shipped GLSL, in uniform wiring,
// or in a flag that gates a texture. Those are the bugs that have actually
// shipped.
import { loadPaintDef, loadWeaponInputs, compositePaint } from "../../src/paintComposite";
import { mountViewer } from "../../src/viewer3d";

export interface Stat {
  mean: [number, number, number];
  /** Mean per-pixel (max channel - min channel). ~0 means the output is grey. */
  sat: number;
  px: number;
}

export interface RigResult {
  model: string;
  pm: string;
  wear: number;
  seed: number;
  style?: number;
  colors?: number[][];
  durability?: number[];
  pattern?: string;
  wearTex?: string;
  hasOverlay?: boolean;
  overlayBlendMode?: number;
  overlayMaskMode?: number;
  weaponInputs?: string[] | null;
  /** Seed envelopes from the vcompmat. When all three collapse to a single
   *  point the seed CANNOT move the pattern — that is legitimate for authored
   *  skins (custom paintjob, gunsmith) and a data bug for anything else, so the
   *  caller needs them to tell "seed does nothing" from "seed can't do
   *  anything here". */
  seedRanges?: { offsetX: [number, number]; offsetY: [number, number]; rotation: [number, number] };
  /** True when every seed envelope is degenerate, i.e. the seed is a no-op. */
  seedInert?: boolean;
  albedo?: Stat;
  /**
   * 8x8 luma thumbprint of the albedo. Comparing these across wear levels
   * detects "wear changed nothing" far more reliably than comparing mean
   * brightness: a skin whose base metal is about as bright as its paint (M249 |
   * Sage Camo) strips correctly while its MEAN barely moves, which read as a
   * false failure.
   */
  sig?: number[];
  /** base64 PNG of the composited albedo atlas — for eyeballing / visual diff. */
  png?: string;
  error?: string;
}

function stat(px: Uint8Array, alphaGate = false): Stat {
  let r = 0, g = 0, b = 0, n = 0, sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (alphaGate && px[i + 3] < 8) continue;
    const R = px[i], G = px[i + 1], B = px[i + 2];
    r += R; g += G; b += B; n++;
    sat += Math.max(R, G, B) - Math.min(R, G, B);
  }
  n = n || 1;
  return {
    mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    sat: +(sat / n).toFixed(1),
    px: n,
  };
}

// ONE renderer for every runOne call, for two reasons:
//
//  - compositePaint's LRU is keyed PER RENDERER (the render targets it caches
//    are owned by a single GL context). A renderer per call meant the cache
//    could never hit, so every sweep recomposited from scratch — two 2K render
//    targets and a full texture re-upload per seed. Sweeps took minutes.
//  - Chrome caps live WebGL contexts (~16) and just stops granting new ones
//    past that. renderer.dispose() does not hand the context back, so a sweep
//    of more than ~16 renders would stall partway with no error at all.
//
// The composite cache key includes wear, seed and debug mode, so sharing the
// renderer across a sweep is safe: different seeds still get different entries.
let shared: import("three").WebGLRenderer | null = null;
function sharedRenderer(THREE: any, size: number): import("three").WebGLRenderer {
  if (!shared) shared = new THREE.WebGLRenderer({ antialias: false });
  shared!.setSize(size, size);
  return shared!;
}
/** Drops the shared context. Call when a page is done with the rig. */
export function disposeRig(): void {
  shared?.forceContextLoss();
  shared?.dispose();
  shared = null;
}

export async function runOne(
  model: string, pm: string, wear: number, seed: number, size = 128,
  legacyPaint = false,
  /** When set, read back the debug pass (2 = pattern.rgb as sampled, 3 =
   *  pattern.a) instead of the albedo, so the pattern can be inspected before
   *  the palette and mask stages flatten it. */
  debug?: 2 | 3 | 4,
): Promise<RigResult> {
  const out: RigResult = { model, pm, wear, seed };
  try {
    const THREE: any = await import("three");
    const def = await loadPaintDef(pm);
    if (!def) return { ...out, error: "loadPaintDef returned null" };

    out.style = def.style;
    out.colors = def.colors.map((c) => c.map((v) => +v.toFixed(4)));
    out.durability = def.durability as unknown as number[];
    out.pattern = def.pattern?.split("/").pop();
    out.wearTex = def.wearMask?.split("/").pop();
    out.hasOverlay = !!def.overlay;
    out.overlayBlendMode = def.overlayBlendMode;
    out.overlayMaskMode = def.overlayMaskMode;
    out.seedRanges = { offsetX: def.offsetX, offsetY: def.offsetY, rotation: def.rotation };
    const flat = (r: [number, number]) => r[0] === r[1];
    out.seedInert = flat(def.offsetX) && flat(def.offsetY) && flat(def.rotation);

    const weapon = await loadWeaponInputs(model, !!legacyPaint);
    out.weaponInputs = weapon
      ? Object.keys(weapon).filter((k) => (weapon as any)[k] != null)
      : null;

    const renderer = sharedRenderer(THREE, size);
    const comp = await compositePaint(THREE, renderer, def, { wear, seed, weapon, model, debug });
    if (!comp) return { ...out, error: "compositePaint returned null" };

    // Blit the composited albedo through a basic material so the readback works
    // no matter how the result is wired internally.
    const target = new THREE.WebGLRenderTarget(size, size);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: debug ? (comp as any).debug : (comp as any).albedo }),
    ));
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    const buf = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, buf);
    renderer.setRenderTarget(null);
    out.albedo = stat(buf);

    // 8x8 luma thumbprint (box-averaged), for cross-wear comparison.
    const G = 8, cell = Math.max(1, Math.floor(size / G));
    out.sig = Array.from({ length: G * G }, (_, k) => {
      const gx = k % G, gy = (k / G) | 0;
      let sum = 0, n = 0;
      for (let y = gy * cell; y < Math.min((gy + 1) * cell, size); y++) {
        for (let x = gx * cell; x < Math.min((gx + 1) * cell, size); x++) {
          const i = (y * size + x) * 4;
          sum += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
          n++;
        }
      }
      return +(sum / (n || 1)).toFixed(1);
    });

    // Numbers say "is it grey"; only the image says "is it the right pattern".
    // readRenderTargetPixels is bottom-up, so flip while copying out.
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    out.png = cv.toDataURL("image/png");

    (comp as any).release?.();
    target.dispose();
    return out;
  } catch (e: any) {
    return { ...out, error: String(e?.stack ?? e) };
  }
}

/**
 * Mounts the REAL viewer and captures the rendered weapon.
 *
 * The albedo atlas alone is not enough to judge a skin: it is UV space, so a
 * pattern that looks blotchy in the atlas can be correct once the model's UVs
 * scale it down, and vice versa. Comparing an atlas against a marketing render
 * is not a like-for-like comparison — this is.
 *
 * Uses ViewerHandle.snapshot() rather than reading the canvas directly: the
 * renderer runs with preserveDrawingBuffer off, so a canvas read outside the
 * draw call comes back blank (which is what an earlier version of this rig hit).
 */
export async function runViewer(
  model: string, pm: string, wear: number, seed: number,
  opts: { legacyPaint?: boolean; width?: number; height?: number;
          lighting?: { env?: number; key?: number; rim?: number; ambient?: number } } = {},
): Promise<{ png?: string; error?: string }> {
  const host = document.createElement("div");
  host.style.cssText = `width:${opts.width ?? 640}px;height:${opts.height ?? 420}px;position:fixed;left:-9999px;top:0`;
  document.body.appendChild(host);
  try {
    const handle = await mountViewer(host, model, {
      paintMaterial: pm, wear, seed,
      legacyPaint: !!opts.legacyPaint, interactive: false, lighting: opts.lighting,
    } as any);
    await new Promise((r) => setTimeout(r, 2000)); // let textures land + a few frames draw
    const blob = await handle.snapshot();
    handle.dispose();
    if (!blob) return { error: "snapshot() returned null" };
    return {
      png: await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      }),
    };
  } catch (e: any) {
    return { error: String(e?.stack ?? e) };
  } finally {
    host.remove();
  }
}
