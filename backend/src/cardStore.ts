// The card store's file format: which bytes a card upload may be, which file a
// card's name resolves to, and how a PNG upload becomes a WebP.
//
// Cards (the client's 3D snapshots, see POST /api/render/:id) were PNGs only.
// A card is a cropped, transparent 3D render up to ~1400px wide, 0.2-1MB as a
// PNG, and a grid of them is most of what the inventory page downloads. Lossy
// WebP with a lossless alpha plane carries the same picture in about a tenth of
// that (see CARD_WEBP_QUALITY for the measurement).
//
// THE NAME STAYS FORMAT-AGNOSTIC. A card's key is still the `.png` name it
// always had (renderKeyForRow in main.ts, renderKeyFor in src/api.ts), and the
// `.png` in it is now part of the card's NAME, not a statement about its bytes:
//
//  - On disk a card is `<stem>.webp` or `<stem>.png`, whichever was stored,
//    so `file`, the extension and the Content-Type always agree.
//  - A request for the key (either extension) is answered with whichever of
//    the two exists, WebP first, under its own Content-Type. nginx's /renders
//    block does the same with try_files.
//
// That is what keeps every pairing of old and new working with no re-bake and
// no extra request:
//
//  - Every card already on the mount is a `.png` under exactly the key clients
//    already ask for, so it keeps being found.
//  - An old client asks for the same `.png` URL, uploads PNGs, and gets
//    whatever is stored back; every browser this app runs in decodes WebP (the
//    item icons have always been WebP).
//  - A new client only sends WebP to a backend whose catalog advertises it
//    (`cardFormats`), so an older backend, which 400s anything that does not
//    start with the PNG signature, keeps getting PNGs.
//  - The client's "is it already baked?" probe stays ONE request: the URL did
//    not change, the backend resolves the format behind it.
//
// The alternative, a `.webp` key with a client fallback to `.png`, would have
// put a 404 in front of every card stored before it, and in front of every card
// a browser that cannot encode WebP (Safari) bakes, for as long as those cards
// live.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type CardFormat = "png" | "webp";
export const CARD_CONTENT_TYPES: Record<CardFormat, string> = { png: "image/png", webp: "image/webp" };
/** The formats the upload routes take, advertised to clients as
 *  `cardFormats` on /api/catalog. A client sends WebP only when it sees it. */
export const CARD_FORMATS: readonly CardFormat[] = ["webp", "png"];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What a card upload IS, from its own bytes — never from a header or a name the
 * client chose.
 *
 * WebP is a RIFF container: "RIFF", the payload size, "WEBP", then the first
 * chunk, which is one of the three a WebP can open with (VP8X for a picture with
 * alpha, VP8 lossy, VP8L lossless). The declared size must fit in what arrived,
 * so a truncated upload is refused rather than stored as a card that never
 * decodes.
 */
export const cardFormatOf = (buf: Buffer): CardFormat | null => sniff(buf, true);

/** The magic bytes. `whole`: `buf` is the entire file, so the RIFF size it
 *  declares can be checked — not when only a header was read. */
function sniff(buf: Buffer, whole: boolean): CardFormat | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (
    buf.length >= 20 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP" &&
    ["VP8X", "VP8 ", "VP8L"].includes(buf.toString("latin1", 12, 16)) &&
    (!whole || buf.readUInt32LE(4) + 8 <= buf.length)
  ) {
    return "webp";
  }
  return null;
}

/**
 * A card's pixel size from its first 30 bytes, either format. Null if the
 * header does not say, or is not a card format at all.
 *
 * PNG: IHDR, the first chunk. WebP: the canvas size in VP8X, or the frame header
 * of a bare VP8 (14-bit little-endian sizes after the 9d 01 2a start code) or
 * VP8L (14-bit sizes minus one, packed after the 0x2f signature).
 */
export function cardPixelSize(head: Buffer): { width: number; height: number } | null {
  const format = sniff(head, false);
  let width = 0;
  let height = 0;
  if (format === "png") {
    if (head.length < 24 || head.toString("latin1", 12, 16) !== "IHDR") return null;
    width = head.readUInt32BE(16);
    height = head.readUInt32BE(20);
  } else if (format === "webp") {
    const chunk = head.toString("latin1", 12, 16);
    if (chunk === "VP8X" && head.length >= 30) {
      width = head.readUIntLE(24, 3) + 1;
      height = head.readUIntLE(27, 3) + 1;
    } else if (chunk === "VP8 " && head.length >= 30 && head[23] === 0x9d && head[24] === 0x01 && head[25] === 0x2a) {
      width = head.readUInt16LE(26) & 0x3fff;
      height = head.readUInt16LE(28) & 0x3fff;
    } else if (chunk === "VP8L" && head.length >= 25 && head[20] === 0x2f) {
      const bits = head.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  return width && height ? { width, height } : null;
}

/**
 * A card that is what it says and the size of a card: either format, 16 to
 * 4096 pixels a side. The catalog store (shared art) asks this of every upload;
 * an instance upload only needs a format, as it always only needed the PNG
 * signature.
 */
export function plausibleCard(buf: Buffer): CardFormat | null {
  const format = cardFormatOf(buf);
  return format && cardSized(buf) ? format : null;
}

/** Whether the image's header puts it within a card's bounds, 16 to 4096
 *  pixels a side. */
function cardSized(buf: Buffer): boolean {
  const size = cardPixelSize(buf);
  return !!size && size.width >= 16 && size.height >= 16 && size.width <= 4096 && size.height <= 4096;
}

/** A card's key with its extension off: the name both formats share. */
export const cardStem = (key: string) => key.replace(/\.(png|webp)$/, "");
/** A request key: the stem plus either extension. The regex is the only thing
 *  from the request that reaches the filesystem. */
export const CARD_KEY_RE = /^[\w.-]+\.(png|webp)$/;
/** A stored card's file name: the stem plus the extension of what it IS. */
export const CARD_FILE_RE = /^(inst|cat)-[\w.-]+\.(png|webp)$/;

/**
 * Where the card for `key` is stored, if it is: WebP first, then PNG.
 *
 * Every lookup of a card by its key goes through here (serving, share unfurls,
 * the catalog store's first-writer check). A `fs.stat` on the bare key finds
 * only the cards stored before WebP and reads every newer one as missing.
 */
export async function findCard(dir: string, key: string): Promise<{ file: string; type: string } | null> {
  const stem = cardStem(key);
  for (const format of CARD_FORMATS) {
    const file = path.join(dir, `${stem}.${format}`);
    if (await fs.stat(file).then((s) => s.isFile(), () => false)) return { file, type: CARD_CONTENT_TYPES[format] };
  }
  return null;
}

/** The stored card's bytes and Content-Type, or null on a miss. */
export async function readCard(dir: string, key: string): Promise<{ body: Buffer; type: string } | null> {
  const stem = cardStem(key);
  for (const format of CARD_FORMATS) {
    try {
      return { body: await fs.readFile(path.join(dir, `${stem}.${format}`)), type: CARD_CONTENT_TYPES[format] };
    } catch {
      /* not stored in this format */
    }
  }
  return null;
}

/**
 * Store a card under `key`, in the format it is best kept in, and leave the key
 * resolving to it.
 *
 * A PNG is transcoded to WebP here when it can be (see pngCardToWebp), so a card
 * from a browser that cannot encode WebP, or from a client older than WebP
 * cards, is stored as small as one from Chrome. Whatever is written, the other
 * format's file under the same stem goes: findCard prefers WebP, so a stale
 * `.webp` left beside a fresh `.png` would win.
 *
 * Written to a temporary name and renamed, so nginx, which serves this
 * directory straight off the mount, never hands out half a card.
 *
 * `exclusive` is the catalog store's first-writer-wins rule: nothing is written
 * if a card in EITHER format is already there, and the answer says so.
 */
export async function storeCard(
  dir: string,
  key: string,
  upload: Buffer,
  opts: { exclusive?: boolean } = {},
): Promise<"stored" | "exists"> {
  let format = cardFormatOf(upload);
  if (!format) throw new Error("not a card image");
  if (opts.exclusive && (await findCard(dir, key))) return "exists";
  let body = upload;
  if (format === "png") {
    const webp = await pngCardToWebp(upload);
    if (webp) [body, format] = [webp, "webp"];
  }
  await fs.mkdir(dir, { recursive: true });
  const stem = cardStem(key);
  const file = path.join(dir, `${stem}.${format}`);
  if (opts.exclusive) {
    try {
      await fs.writeFile(file, body, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return "exists";
      throw e;
    }
    return "stored";
  }
  const tmp = path.join(dir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
  await fs.rm(path.join(dir, `${stem}.${format === "webp" ? "png" : "webp"}`), { force: true });
  return "stored";
}

/**
 * The quality card WebPs are made at, here and in the browser
 * (CARD_WEBP_QUALITY in src/cardEncode.ts, the same number as 0..1).
 *
 * Chosen by measurement, on 16 real card bakes from tools/standalone (knives,
 * Dopplers, Fades, gloves, a charm, dark finishes, stickers; 255 to 1391px wide,
 * 8.9MB as PNG in all), encoded by Chrome's canvas. Lossy colour, lossless
 * alpha; composited over the grid's dark background and compared with the PNG:
 *
 *   quality   size vs PNG   PSNR at 1:1 (worst..best)   PSNR at grid size (~170px)
 *   80        6.4%          30.5 .. 38.6 dB             40.1 .. 53.4 dB
 *   90        10.0%         32.2 .. 40.9 dB             42.5 .. 56.7 dB
 *   95        14.3%         33.1 .. 43.1 dB             43.9 .. 58.2 dB
 *   lossless  50.7% (cwebp), 63.5% (Chrome)  exact
 *
 * The alpha channel came back identical at every quality. 90 is the knee: what
 * is left at 1:1 is the chroma subsampling every lossy WebP has, on saturated
 * edges (the worst card is AK-47 | Neon Rider's magenta streaks), and it barely
 * moves from 90 to 95 while the file grows by 44%. Side by side at 2x, PNG and
 * 90 could not be told apart on the Neon Rider, a dark M4A1-S | Night Terror or
 * the Butterfly Knife | Doppler's gradient. At grid size every gun, knife and
 * glove card measures 50dB or more; the charm, whose 255px-wide picture is
 * barely scaled down, 42.5dB.
 *
 * cwebp at the same quality matches Chrome to within 1% in size and error.
 * `-sharp_yuv` (the better RGB-to-YUV conversion) is cwebp's own and the
 * browser's encoder has no such switch; it costs ~25ms a card and buys back
 * ~1dB on exactly those edges.
 */
export const CARD_WEBP_QUALITY = 90;
const CWEBP_ARGS = ["-quiet", "-metadata", "none", "-q", String(CARD_WEBP_QUALITY), "-sharp_yuv"];
const CWEBP_TIMEOUT_MS = 20_000;

// At most this many cwebp processes at once; the rest wait for a slot. A card
// encodes in ~25ms, so the queue costs nothing, where a burst of uploads each
// decoding a 4096px square at once would take the pod's memory with it.
const CWEBP_CONCURRENCY = 2;
let cwebpRunning = 0;
const cwebpWaiting: (() => void)[] = [];
async function withCwebpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (cwebpRunning < CWEBP_CONCURRENCY) cwebpRunning++;
  else await new Promise<void>((resolve) => cwebpWaiting.push(resolve));
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next in line, so nothing can take it in
    // between and push the count over.
    const next = cwebpWaiting.shift();
    if (next) next();
    else cwebpRunning--;
  }
}

/**
 * Whether cwebp runs here. The backend image installs it (`webp`, for the
 * extractor); a dev pod or a bare `npm run dev` may not have it, and then PNG
 * uploads are simply stored as PNGs, as they always were.
 */
let cwebpChecked: Promise<boolean> | null = null;
const cwebpAvailable = () => (cwebpChecked ??= run("cwebp", ["-version"]));

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    const timer = setTimeout(() => p.kill("SIGKILL"), CWEBP_TIMEOUT_MS);
    p.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/**
 * A PNG card as a WebP at CARD_WEBP_QUALITY, or null to store the PNG as is:
 * no cwebp, the encode failed, or it came out no smaller.
 *
 * Only a PNG whose header puts it within a card's bounds is decoded. An
 * instance upload is checked for its format alone, and a 3MB PNG can declare a
 * 30000px square that cwebp would decode in full, gigabytes of it; anything
 * outside the bounds is stored as the PNG it is, as every upload used to be.
 *
 * Through temporary files rather than pipes, which keeps it to the cwebp
 * invocation every libwebp version takes. The output is checked like an upload,
 * so a broken encoder can never put something that is not a WebP under a key.
 */
export async function pngCardToWebp(png: Buffer): Promise<Buffer | null> {
  if (!cardSized(png) || !(await cwebpAvailable())) return null;
  const base = path.join(os.tmpdir(), `card-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await fs.writeFile(`${base}.png`, png);
    if (!(await withCwebpSlot(() => run("cwebp", [...CWEBP_ARGS, `${base}.png`, "-o", `${base}.webp`])))) return null;
    const out = await fs.readFile(`${base}.webp`);
    return cardFormatOf(out) === "webp" && out.length < png.length ? out : null;
  } catch {
    return null;
  } finally {
    await fs.rm(`${base}.png`, { force: true }).catch(() => {});
    await fs.rm(`${base}.webp`, { force: true }).catch(() => {});
  }
}
