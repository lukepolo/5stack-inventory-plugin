// Lighter copies of what the extraction put on the mount — the same pixels and
// the same bytes, in fewer bytes on the wire. Two passes, each a step of
// extract-models.sh (v39):
//
//   node scripts/lighten-assets.mjs inputs-2048 --models /cs2-models/models
//   node scripts/lighten-assets.mjs gzip        --models /cs2-models/models
//
// NEITHER REPLACES A FILE. Every output is a new file beside the original, for
// one reason: an older client reads this mount too (a tab still running the
// previous bundle, a pod mid-rollout). A file it cannot read, or a meta.json
// shape it does not know, would break it the moment the mount re-extracts. So
// the originals stay byte-for-byte what they were, every reader of them keeps
// working untouched, and only a client (or server) that knows about a lighter
// copy uses it.
//
//   inputs-2048  <key>.inputs[.hd]/<name>.2048.png for every composite input over
//                2048 px, listed in meta.json as `textures2048`. The compositor
//                renders at most 2048 outside the projected styles, and at that
//                cap the GPU samples a 4096 input at its 2048 mip anyway — this
//                is that mip, made once here instead of downloaded at 4x the size
//                and built on every client. Box filter per channel; sRGB-correct
//                for the two inputs the compositor reads as colour (ao, color);
//                RGB under zero alpha kept exactly (ao's alpha is noPaint).
//   gzip         <file>.gz (gzip -9) beside every .glb and .json over 1KB, for
//                servers that send a precompressed sibling instead of the raw
//                file (nothing compressed GLBs on the wire before this: an AK-47
//                was 3.3MB, its .gz is 1.1MB). PNG/WebP/EXR are compressed
//                already and gain nothing.
//
// Both are incremental and safe to interrupt: outputs are written to a temp name
// and renamed, and a re-run redoes only what changed. A .gz must never outlive a
// change to its original — extract-models.sh deletes them all at the start of a
// run and this pass, its last step, writes them back.
//
// WHY NOT MESHOPT. EXT_meshopt_compression was built and measured for the GLBs
// (2026-10-21): without quantisation or filters — the only form that keeps every
// float exact — it is lossless (15 models, every accessor, index buffer, skin
// and animation track identical through three's own decoder), but it only packs
// the raw float bytes that gzip packs anyway. Over 8 models, gzip -9 alone came
// to 8.12MB; meshopt + gzip to 7.95MB (2.0% less), 7.79MB with the v1 codec at
// its highest level. Not worth a second copy of every GLB and a decoder in the
// client. Meshopt's real wins come from quantising, which would move vertices.
//
// No dependencies beyond node itself (zlib).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : dflt;
};
const MODELS = path.resolve(arg("models", path.join(process.env.OUT_DIR ?? "/cs2-models", "models")));
// The step id in extract-models.sh's STEPS list, for the panel's progress row.
const STEP = arg("step", cmd);

// ---- progress ----------------------------------------------------------------
// Same file and the same read-modify-write the python steps use (see `progress`
// in extract-models.sh): the panel shows a unit count for the running step. A
// failure here must never fail the pass.
let lastProgress = 0;
function progress(done, total, force = false) {
  const pf = process.env.PROGRESS_FILE;
  if (!pf) return;
  const now = Date.now();
  if (!force && now - lastProgress < 500) return;
  lastProgress = now;
  try {
    let doc = { steps: [] };
    try {
      doc = JSON.parse(fs.readFileSync(pf, "utf8"));
    } catch {
      /* first write, or a torn one — start clean */
    }
    const s = (doc.steps ?? []).find((x) => x.name === STEP);
    if (!s) return;
    s.state = "running";
    s.done = done;
    s.total = total;
    doc.at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    fs.writeFileSync(pf, JSON.stringify(doc));
  } catch {
    /* progress is cosmetic */
  }
}

// ---- shared helpers ----------------------------------------------------------
/** Every file under `dir`, as "/"-separated relative paths. */
function walk(dir) {
  const out = [];
  const rec = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) rec(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  rec(dir, "");
  return out.sort();
}

/** Write via a temp name in the same directory, so a reader (or an interrupted
 *  run) only ever sees the old file or the complete new one. */
const TMP_SUFFIX = ".lighten-tmp";
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}${TMP_SUFFIX}${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const mb = (n) => `${(n / 1e6).toFixed(1)}MB`;

// ==== inputs-2048 ==============================================================
// ---- PNG codec (8-bit, non-interlaced) -----------------------------------------
// Decode handles what the CLI writes (grey, grey+alpha, RGB, RGBA at 8 bits);
// anything else (16-bit, palette, Adam7) is reported and skipped, never guessed.
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);

async function decodePng(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let width = 0, height = 0, depth = 0, type = -1, interlace = 0;
  const idat = [];
  for (let p = 8; p + 12 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString("latin1", p + 4, p + 8);
    if (name === "IHDR") {
      width = buf.readUInt32BE(p + 8);
      height = buf.readUInt32BE(p + 12);
      depth = buf[p + 16];
      type = buf[p + 17];
      interlace = buf[p + 20];
    } else if (name === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (name === "IEND") break;
    p += 12 + len;
  }
  const ch = PNG_CHANNELS[type];
  if (!ch || depth !== 8 || interlace !== 0 || !width || !height || !idat.length) return null;
  const stride = width * ch;
  // Async, like the deflate below: zlib runs on libuv's pool, so several
  // textures decode and encode at once while this thread does the filtering.
  const raw = await inflate(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) return null;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const s = y * (stride + 1) + 1;
    const d = y * stride;
    const u = d - stride;
    if (f === 0 || (f === 2 && y === 0)) px.set(raw.subarray(s, s + stride), d);
    else if (f === 1) for (let i = 0; i < stride; i++) px[d + i] = raw[s + i] + (i >= ch ? px[d + i - ch] : 0);
    else if (f === 2) for (let i = 0; i < stride; i++) px[d + i] = raw[s + i] + px[u + i];
    else if (f === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= ch ? px[d + i - ch] : 0;
        const up = y ? px[u + i] : 0;
        px[d + i] = raw[s + i] + ((left + up) >> 1);
      }
    } else if (f === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[d + i - ch] : 0;
        const b = y ? px[u + i] : 0;
        const c = y && i >= ch ? px[u + i - ch] : 0;
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        px[d + i] = raw[s + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
    } else return null;
  }
  // Widen to RGBA: what the compositor uploads either way (rawPng.ts does the same).
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

// zlib.crc32 is node 22.2+; the image runs 24, the table is for anything older.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 =
  typeof zlib.crc32 === "function"
    ? (buf) => zlib.crc32(buf) >>> 0
    : (buf) => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
function pngChunk(name, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** 8-bit RGBA PNG, always — the one shape src/rawPng.ts decodes itself, which is
 *  what keeps Safari from emptying a fully transparent input. `text` rides in a
 *  tEXt chunk (the source fingerprint the incremental check reads back). Every
 *  row uses the Paeth filter, and deflate runs at level 6 with Z_FILTERED, the
 *  strategy PNG encoders use: MEASURED on the AK-47's 2048 color/metalness, level
 *  9 is 3-6% smaller and 7-14x slower (7-12s a texture, which over the ~90 large
 *  inputs is a quarter of an hour added to every extraction). */
async function encodePngRgba(width, height, rgba, text) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const d = y * (stride + 1);
    const s = y * stride;
    const u = s - stride;
    raw[d] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[s + i - 4] : 0;
      const b = y ? rgba[u + i] : 0;
      const c = y && i >= 4 ? rgba[u + i - 4] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      raw[d + 1 + i] = (rgba[s + i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    ...(text ? [pngChunk("tEXt", Buffer.from(`${text.key}\0${text.value}`, "latin1"))] : []),
    pngChunk("IDAT", await deflate(raw, { level: 6, memLevel: 9, strategy: zlib.constants.Z_FILTERED })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The tEXt value under `key` in a PNG, or null. Reads chunk headers only. */
function pngText(buf, key) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  for (let p = 8; p + 12 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString("latin1", p + 4, p + 8);
    if (name === "tEXt") {
      const body = buf.subarray(p + 8, p + 8 + len);
      const nul = body.indexOf(0);
      if (nul > 0 && body.toString("latin1", 0, nul) === key) return body.toString("latin1", nul + 1);
    }
    if (name === "IDAT" || name === "IEND") break;
    p += 12 + len;
  }
  return null;
}

// ---- the downscale -------------------------------------------------------------
// sRGB <-> linear, as the GPU does it for an SRGB8_ALPHA8 texture (three uploads
// every srgb:true input that way, and the GPU builds that texture's mips in
// linear light). Decoding is a 256-entry table; encoding searches the table, so
// the result is the exact nearest 8-bit code with no pow() rounding drift.
const SRGB_TO_LIN = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
// Midpoints between adjacent codes in linear space: code k covers
// [MID[k-1], MID[k]), so encoding is a binary search with exact rounding.
const SRGB_MID = Float64Array.from({ length: 255 }, (_, i) => (SRGB_TO_LIN[i] + SRGB_TO_LIN[i + 1]) / 2);
function linToSrgb8(v) {
  let lo = 0, hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v < SRGB_MID[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Halve an RGBA8 image with a 2x2 box filter, PER CHANNEL: alpha never weights
 * colour, so RGB under alpha 0 averages exactly like RGB anywhere else (a
 * premultiplying resize — Pillow's, ImageMagick's — zeroes it, and that RGB is
 * data here). `srgbRgb` averages R, G and B in linear light; alpha, and every
 * channel of a linear texture, average as stored. Rounds half up.
 */
function halve(img, srgbRgb) {
  const { width: w, height: h, data: src } = img;
  const W = w >> 1, H = h >> 1;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const r0 = 2 * y * w * 4, r1 = r0 + w * 4;
    for (let x = 0; x < W; x++) {
      const a = r0 + 8 * x, b = a + 4, c = r1 + 8 * x, d = c + 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) {
        if (srgbRgb && k < 3) {
          out[o + k] = linToSrgb8(
            (SRGB_TO_LIN[src[a + k]] + SRGB_TO_LIN[src[b + k]] + SRGB_TO_LIN[src[c + k]] + SRGB_TO_LIN[src[d + k]]) / 4,
          );
        } else {
          out[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
        }
      }
    }
  }
  return { width: W, height: H, data: out };
}

// Which inputs the compositor samples as colour. Mirrors the loadTex calls in
// src/paintComposite.ts: ao and color are srgb:true, masks and metalness are
// data. A key not listed here is not downscaled at all.
const INPUT_SRGB = { ao: true, color: true, masks: false, metalness: false };
const MAX_INPUT = 2048;
// Bumped when the downscale itself changes, so every copy is rebuilt.
const INPUTS_2048_REV = 1;
const SRC_KEY = "lighten-assets-src";

/** Workers for the texture pass: the panel's number (JOBS_FILE), floored at 2
 *  and capped at 4. Each one holds a decoded 4096 map and its intermediates,
 *  ~250MB, so four is still under the 1.4GB of a single decompile worker. */
function poolSize() {
  let n = NaN;
  try {
    n = parseInt(fs.readFileSync(process.env.JOBS_FILE ?? "", "utf8"), 10);
  } catch {
    n = parseInt(process.env.EXTRACT_JOBS ?? "", 10);
  }
  const cores = parseInt(process.env.CORES ?? "", 10) || 4;
  return Math.max(1, Math.min(4, cores, Math.max(2, Number.isFinite(n) ? n : 1)));
}

/** One input -> its 2048 copy. Returns the copy's name, or null to list none. */
async function lowResCopy(dir, key, file, tally) {
  const src = path.join(MODELS, dir, file);
  let buf;
  try {
    buf = fs.readFileSync(src);
  } catch {
    return null;
  }
  // Dimensions from IHDR before decoding anything: most inputs are already 2048
  // or smaller and need nothing.
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w <= MAX_INPUT && h <= MAX_INPUT) return null;
  // Halved until it fits, so every step needs even edges. Power-of-two maps
  // (every input on the mount) always have them; anything else would lose a
  // row or column and is left at full size rather than approximated.
  for (let cw = w, ch = h; cw > MAX_INPUT || ch > MAX_INPUT; cw /= 2, ch /= 2) {
    if (cw % 2 || ch % 2) return null;
  }
  const outName = file.replace(/\.png$/i, ".2048.png");
  const out = path.join(MODELS, dir, outName);
  // The copy carries a fingerprint of the file it was made from. A re-run
  // re-copies every input (composite-inputs copies them fresh), so an mtime would
  // rebuild all of them every time; the content is what matters.
  const fp = `r${INPUTS_2048_REV}:${buf.length}:${crc32(buf).toString(16)}`;
  try {
    if (pngText(fs.readFileSync(out), SRC_KEY) === fp) {
      tally.kept++;
      tally.full += buf.length;
      tally.small += fs.statSync(out).size;
      return outName;
    }
  } catch {
    /* no copy yet */
  }
  const img = await decodePng(buf);
  if (!img) {
    console.log(`!!   ${dir}/${file}: not an 8-bit PNG this pass can read — left at full size only`);
    tally.failed++;
    return null;
  }
  let cur = img;
  while (cur.width > MAX_INPUT || cur.height > MAX_INPUT) cur = halve(cur, INPUT_SRGB[key]);
  const png = await encodePngRgba(cur.width, cur.height, cur.data, { key: SRC_KEY, value: fp });
  writeAtomic(out, png);
  tally.made++;
  tally.full += buf.length;
  tally.small += png.length;
  return outName;
}

async function cmdInputs2048() {
  const dirs = fs
    .readdirSync(MODELS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /\.inputs(\.hd)?$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const metas = new Map();
  const jobs = [];
  for (const dir of dirs) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(MODELS, dir, "meta.json"), "utf8"));
      metas.set(dir, { meta, lowres: {} });
      for (const [key, file] of Object.entries(meta.textures ?? {})) {
        if (key in INPUT_SRGB && /\.png$/i.test(file)) jobs.push({ dir, key, file });
      }
    } catch {
      /* no bundle here (or a half-written one): nothing to list */
    }
  }
  const tally = { made: 0, kept: 0, failed: 0, full: 0, small: 0 };
  let next = 0, done = 0;
  progress(0, jobs.length, true);
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const name = await lowResCopy(j.dir, j.key, j.file, tally);
        if (name) metas.get(j.dir).lowres[j.key] = name;
      } catch (e) {
        // Never fatal: the input is simply not listed, so it loads at full size.
        console.log(`!!   ${j.dir}/${j.file}: ${e.message} — left at full size only`);
        tally.failed++;
      }
      progress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: poolSize() }, worker));

  for (const [dir, { meta, lowres }] of metas) {
    // meta.json is rewritten only when the listing changes. `textures` is never
    // touched: it is what every client already reads, and still names the
    // full-size originals.
    const had = JSON.stringify(meta.textures2048 ?? null);
    if (Object.keys(lowres).length) meta.textures2048 = lowres;
    else delete meta.textures2048;
    if (JSON.stringify(meta.textures2048 ?? null) !== had) {
      writeAtomic(path.join(MODELS, dir, "meta.json"), JSON.stringify(meta));
    }
    // A copy no longer listed (its source shrank, or went away) is dead weight.
    const listed = new Set(Object.values(lowres));
    for (const f of fs.readdirSync(path.join(MODELS, dir))) {
      if (f.endsWith(".2048.png") && !listed.has(f)) fs.rmSync(path.join(MODELS, dir, f), { force: true });
    }
  }
  progress(jobs.length, jobs.length, true);
  console.log(
    `--- 2048 composite inputs: ${tally.made} made, ${tally.kept} already current` +
      `${tally.failed ? `, ${tally.failed} unreadable` : ""} — ${mb(tally.full)} of >2048 inputs` +
      ` have ${mb(tally.small)} of 2048 copies`,
  );
}

// ==== gzip =====================================================================
// GLB and JSON only. EXR is zip-compressed inside already (97% at gzip -9, not
// worth a file), PNG/WebP likewise, and audio is range-streamed: nginx answers a
// range request out of the .gz's bytes when the browser accepts gzip, so only
// files that are always fetched whole may have one.
const GZ_EXT = /\.(glb|json)$/i;
const GZ_MIN = 1024;
// Written by the stamp AFTER this pass, so a sibling would always be one run old.
// It is a few hundred bytes the backend reads straight off disk anyway.
const GZ_NEVER = new Set(["extract-version.json"]);
const gzip = promisify(zlib.gzip);

async function cmdGzip() {
  const files = walk(MODELS);
  const have = new Set(files);
  const todo = files.filter((f) => GZ_EXT.test(f) && !GZ_NEVER.has(f));
  const t = { made: 0, kept: 0, raw: 0, packed: 0, dropped: 0 };
  let next = 0, done = 0;
  progress(0, todo.length, true);
  const one = async (rel) => {
    const src = path.join(MODELS, rel);
    const gz = `${src}.gz`;
    const st = fs.statSync(src);
    if (st.size < GZ_MIN) {
      if (have.has(`${rel}.gz`)) fs.rmSync(gz, { force: true });
      return;
    }
    // A .gz no older than its original is the one made from it: it is always
    // written after the original is final, and its own mtime is never set back.
    // That is also the test the Node servers apply before sending one. nginx
    // applies none, which is why the run deletes every .gz before it starts
    // rewriting originals (extract-models.sh, "Precompressed siblings").
    try {
      const gst = fs.statSync(gz);
      if (gst.mtimeMs >= st.mtimeMs) {
        t.kept++;
        t.raw += st.size;
        t.packed += gst.size;
        return;
      }
    } catch {
      /* none yet */
    }
    const body = fs.readFileSync(src);
    const z = await gzip(body, { level: 9 });
    // Not worth a second file under 10% saved.
    if (z.length > body.length * 0.9) {
      fs.rmSync(gz, { force: true });
      return;
    }
    // The original may have been rewritten while this one compressed (only if
    // something else is writing the mount mid-pass); never publish a stale .gz.
    if (fs.statSync(src).mtimeMs !== st.mtimeMs) return;
    writeAtomic(gz, z);
    t.made++;
    t.raw += body.length;
    t.packed += z.length;
  };
  // zlib runs on libuv's pool, so a few files compress at once.
  const worker = async () => {
    while (next < todo.length) {
      const rel = todo[next++];
      try {
        await one(rel);
      } catch (e) {
        console.log(`!!   ${rel}: ${e.message} — no .gz`);
        fs.rmSync(path.join(MODELS, `${rel}.gz`), { force: true });
      }
      progress(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  // Siblings of files that no longer exist, or no longer qualify — and the temp
  // files of an earlier pass (either command) that was killed mid-write.
  for (const rel of files) {
    if (rel.includes(TMP_SUFFIX)) {
      fs.rmSync(path.join(MODELS, rel), { force: true });
      continue;
    }
    if (!rel.endsWith(".gz")) continue;
    const orig = rel.slice(0, -3);
    if (!have.has(orig) || !GZ_EXT.test(orig) || GZ_NEVER.has(orig)) {
      fs.rmSync(path.join(MODELS, rel), { force: true });
      t.dropped++;
    }
  }
  progress(todo.length, todo.length, true);
  console.log(
    `--- gzip siblings: ${t.made} made, ${t.kept} already current${t.dropped ? `, ${t.dropped} stale removed` : ""} —` +
      ` ${mb(t.raw)} -> ${mb(t.packed)} (${t.raw ? Math.round((100 * t.packed) / t.raw) : 0}%)`,
  );
}

// ---- entry ---------------------------------------------------------------------
if (!fs.existsSync(MODELS)) {
  console.log(`!! ${MODELS} does not exist`);
  process.exit(1);
}
if (cmd === "inputs-2048") await cmdInputs2048();
else if (cmd === "gzip") await cmdGzip();
else {
  console.log("usage: lighten-assets.mjs <inputs-2048|gzip> --models <dir> [--step <id>]");
  process.exit(1);
}
