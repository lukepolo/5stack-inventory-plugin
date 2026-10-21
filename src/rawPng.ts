// PNG -> exact RGBA bytes, for the textures whose ALPHA is data rather than
// coverage.
//
// WebKit (Safari, and every browser on iOS) uploads a FULLY transparent image
// to WebGL as all zeros, RGB included, even with UNPACK_PREMULTIPLY_ALPHA off.
// One opaque texel anywhere and the same file comes through intact; it is only
// the all-transparent case that is emptied. MEASURED in WebKit 26 against
// Chromium on the same files (mean R,G,B,A read back from the texture):
//
//   bayonet masks.png  (alpha 0 everywhere)  webkit 0,0,0,0       chromium 91,102,62,0
//   bayonet ao.png     (alpha 0 on 97%)      webkit 129,191,0,8   chromium 129,191,0,8
//
// The weapon composite inputs are packed exactly like that. masks.png carries
// the paint-by-number regions in RGB with an unused alpha the extractor leaves
// at 0, and ao.png's alpha is noPaint, which is 0 on any weapon with no bare
// hardware. On the Bayonet, Butterfly and Navaja the whole mask is transparent,
// so in Safari masks.r -- the anodized paint region -- read 0 everywhere and every
// Doppler, Gamma Doppler and Marble Fade on them composited to the bare knife.
// The Flip Knife's mask has a handful of opaque texels and was fine, which is
// why it looked model-specific.
//
// createImageBitmap(premultiplyAlpha: "none") is no way round it: WebKit loses
// even MORE through that path (the ao.png above reads back 7,8,0,8). So on a
// browser that has the bug, these PNGs are inflated and unfiltered here and
// uploaded as a DataTexture. Elsewhere the browser's own decoder is kept, since
// it runs off the main thread.
import { prefetchedFetch } from "./prefetchStore";

/** 1x1 PNG, RGBA (255, 128, 0, 0). */
const PROBE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP438DAAAAFgQGAX/d3agAAAABJRU5ErkJggg==";

let probe: Promise<boolean> | null = null;

/**
 * Whether this browser empties fully transparent images on their way to WebGL.
 * Asked once per page, on a throwaway context: binding anything on three's own
 * context would desync its state cache.
 */
export function imagesLoseTransparentRgb(): Promise<boolean> {
  return (probe ??= (async () => {
    let gl: WebGL2RenderingContext | null = null;
    try {
      const img = new Image();
      img.src = PROBE_PNG;
      await img.decode();
      gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[0] < 128;
    } catch {
      return false;
    } finally {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }
  })());
}

export interface RawImage {
  width: number;
  height: number;
  /** RGBA8, top row first: the same orientation an <img> uploads in with flipY off. */
  data: Uint8Array<ArrayBuffer>;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Decode an 8-bit, non-interlaced grey/grey+alpha/RGB/RGBA PNG. Null for
 * anything else (palette, 16-bit, Adam7) or when DecompressionStream is
 * missing, so the caller can fall back to the browser's decoder; the extractor
 * only writes 8-bit RGBA.
 */
export async function decodePng(buf: ArrayBuffer): Promise<RawImage | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const b = new Uint8Array(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(buf);
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  const idat: Uint8Array<ArrayBuffer>[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const len = dv.getUint32(p);
    const name = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (name === "IHDR") {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      depth = b[p + 16];
      type = b[p + 17];
      interlace = b[p + 20];
    } else if (name === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
    else if (name === "IEND") break;
    p += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!ch || depth !== 8 || interlace !== 0 || !width || !height || !idat.length) return null;
  const stride = width * ch;
  const raw = new Uint8Array(
    await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
  );
  if (raw.length < (stride + 1) * height) return null;

  // Unfilter in place into `px` (the packed, filter-byte-free rows).
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const s = y * (stride + 1) + 1;
    const d = y * stride;
    const u = d - stride; // row above; only read when y > 0
    if (f === 0 || (f === 2 && y === 0)) {
      px.set(raw.subarray(s, s + stride), d);
    } else if (f === 1) {
      for (let i = 0; i < stride; i++) px[d + i] = raw[s + i] + (i >= ch ? px[d + i - ch] : 0);
    } else if (f === 2) {
      for (let i = 0; i < stride; i++) px[d + i] = raw[s + i] + px[u + i];
    } else if (f === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= ch ? px[d + i - ch] : 0;
        const up = y ? px[u + i] : 0;
        px[d + i] = raw[s + i] + ((left + up) >> 1);
      }
    } else if (f === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[d + i - ch] : 0;
        const bb = y ? px[u + i] : 0;
        const c = y && i >= ch ? px[u + i - ch] : 0;
        const pa = Math.abs(bb - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + bb - 2 * c);
        px[d + i] = raw[s + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
      }
    } else {
      return null;
    }
  }
  if (ch === 4) return { width, height, data: px };

  const out = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < px.length; i += ch, o += 4) {
    if (ch === 3) {
      out[o] = px[i];
      out[o + 1] = px[i + 1];
      out[o + 2] = px[i + 2];
      out[o + 3] = 255;
    } else {
      out[o] = out[o + 1] = out[o + 2] = px[i];
      out[o + 3] = ch === 2 ? px[i + 1] : 255;
    }
  }
  return { width, height, data: out };
}

/**
 * The texture TextureLoader would have produced for a PNG, with every byte as
 * stored -- or null when this browser does not need it (or cannot decode it
 * here), meaning: use TextureLoader. Filtering matches TextureLoader's
 * defaults, which a DataTexture does not share (it defaults to nearest, no
 * mipmaps).
 */
export async function loadRawPngTexture(
  THREE: typeof import("three"),
  url: string,
): Promise<import("three").Texture | null> {
  if (!/\.png(?:[?#]|$)/i.test(url) || !(await imagesLoseTransparentRgb())) return null;
  // The same bytes whether src/prefetch.ts fetched them first or not: the
  // decode below is what matters, and it is unchanged.
  const res = await prefetchedFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const img = await decodePng(await res.arrayBuffer());
  if (!img) return null;
  const t = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
