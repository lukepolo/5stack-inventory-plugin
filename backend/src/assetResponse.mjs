// How one mount-backed file is answered: caching validators, the precompressed
// `.gz` sibling, on-the-fly gzip and byte ranges. Decided once here for the two
// Node servers that answer these paths: the backend's serveAssetDir (what
// nginx's `try_files … @backend` falls back to) and scripts/serve.mjs (the
// hot-swap pods, which have no nginx at all). nginx.conf is the third server and the
// reference; everything below mirrors what it does, so the three agree.
//
// Plain .mjs for the reason byteRange.mjs is: the backend imports it through
// Node's type stripping and serve.mjs imports it as plain Node, and
// Dockerfile.backend copies `backend/` and nothing else.
//
// WHY ANY OF THIS
// The models mount was served as a bare 200 with no validator a browser could
// use and no compression. An AK-47's GLB is 3.3 MB on the wire, 1.1 MB gzipped
// (geometry compresses to about a third); its inspect clip is 273 KB of JSON
// that gzips to 32 KB. And an unversioned request (an old client, or the first
// one before the catalog lands) had no ETag to revalidate against, so "no-cache"
// meant "download it again".
//
// WHAT IS NOT COMPRESSED, measured on the mount (gzip -5 of the original):
//   PNG / WebP / JPEG / MP3   100%  already entropy-coded
//   position.exr               97%  EXR carries its own zip compression
//   venice_sunset_1k.hdr       78%  worth it, so .hdr is on the list
//   *.glb                      34%
//   *.json                   8-25%
// Audio is also kept off the list for a second reason: it is the one thing on
// the mount that is STREAMED, and a compressed body cannot honour a byte range
// against the file a media element is seeking in (nginx drops the range
// outright once it gzips on the fly).
import { createReadStream, promises as fs } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream";
import { parseByteRange } from "./byteRange.mjs";

/** A URL that can never change meaning. Same string nginx.conf sends. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

// Same list, same thresholds as nginx.conf's gzip_types / gzip_min_length /
// gzip_comp_level, so a response does not change shape depending on which of
// the three servers happened to answer it.
const COMPRESSIBLE = new Set([
  "application/json",
  "application/javascript",
  "text/javascript",
  "text/css",
  "text/html",
  "text/plain",
  "image/svg+xml",
  "model/gltf-binary",
  "model/gltf+json",
  "image/vnd.radiance",
  "application/wasm",
]);
const GZIP_MIN_LENGTH = 1024;
// Level 5, measured on the AK-47's 3.3 MB GLB: 1.120 MB in ~50 ms, against
// 1.115 MB in ~180 ms at 9 and 1.161 MB in ~25 ms at 1. The extractor's own
// `.gz` files are -9 and take this path out of the picture for what it writes.
const GZIP_LEVEL = 5;

/** The bare media type, without parameters: "text/css; charset=utf-8" -> "text/css". */
const mediaType = (type) => String(type ?? "").split(";")[0].trim().toLowerCase();

/** Is this Content-Type worth gzipping on the fly? */
export function isCompressible(type) {
  return COMPRESSIBLE.has(mediaType(type));
}

/**
 * Does this Accept-Encoding allow gzip?
 *
 * Honours q-values, because "no" is spelled `gzip;q=0` — a substring test
 * would read that as yes. `*` counts unless gzip itself is refused.
 */
export function acceptsGzip(header) {
  const list = Array.isArray(header) ? header.join(",") : String(header ?? "");
  let gzip = null;
  let star = null;
  for (const part of list.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (name === "gzip" || name === "x-gzip") gzip = q;
    else if (name === "*") star = q;
  }
  if (gzip !== null) return gzip > 0;
  return star !== null && star > 0;
}

/** nginx's own ETag shape — `"<mtime seconds hex>-<size hex>"`. */
const etagOf = (info) => `"${Math.floor(info.mtimeMs / 1000).toString(16)}-${info.size.toString(16)}"`;
const httpDate = (info) => new Date(Math.floor(info.mtimeMs / 1000) * 1000).toUTCString();
/** Weak comparison (RFC 9110 §8.8.3.2), which is what If-None-Match uses. */
const opaque = (tag) => tag.trim().replace(/^W\//, "");

function noneMatch(header, etag) {
  if (header == null) return null;
  const value = String(header).trim();
  if (value === "*") return true;
  const mine = opaque(etag);
  return value.split(",").some((tag) => opaque(tag) === mine);
}

function header(headers, name) {
  const v = headers?.[name];
  return Array.isArray(v) ? v.join(", ") : v;
}

async function statFile(file) {
  try {
    const info = await fs.stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ path: string, start?: number, end?: number, gzip?: boolean }} AssetBody
 * @typedef {{ status: number, headers: Record<string, string | number>, body: AssetBody | null }} AssetPlan
 */

/**
 * Work out the whole answer for one file, without writing anything.
 *
 * Returns null when the file does not exist, so each caller keeps its own miss
 * (the backend's `no-store` 404, serve.mjs's hand-off to the backend).
 *
 * The representation is picked first, then validated against:
 *  1. A Range request gets the ORIGINAL bytes. Ranges are what <audio> seeks
 *     with, and they have to address the file it is decoding.
 *  2. Otherwise, a client that takes gzip gets the extractor's `<file>.gz` when
 *     one is there and no older than the file itself. That freshness check is
 *     one thing nginx's gzip_static cannot do; here it is free, and it means a
 *     run that rewrote a file without its sibling is served correctly.
 *  3. Otherwise, a compressible type is gzipped on the fly.
 * Each representation carries its own ETag — the .gz's own, or the original's
 * marked weak for on-the-fly output, as nginx does — so a cache can never mix
 * one up with another.
 *
 * @param {{ file: string, type: string, method?: string,
 *           headers?: Record<string, string | string[] | undefined>,
 *           cacheControl: string }} req
 * @returns {Promise<AssetPlan | null>}
 */
export async function planAsset({ file, type, method = "GET", headers = {}, cacheControl }) {
  const info = await statFile(file);
  if (!info) return null;
  const compressible = isCompressible(type);
  const rangeHeader = header(headers, "range");
  const gzipOk = !rangeHeader && acceptsGzip(header(headers, "accept-encoding"));

  let served = info;
  let path = file;
  /** @type {"identity" | "static" | "dynamic"} */
  let encoding = "identity";
  // Only looked for when it could be used — a request that cannot take gzip
  // pays no extra stat for it.
  const sibling = gzipOk ? await statFile(`${file}.gz`) : null;
  // Compared in whole seconds. `gzip -k` (and cp -p, tar, rsync) copy the
  // original's mtime onto the output at microsecond precision at best, so a
  // sibling made that way reads a fraction of a millisecond OLDER than its
  // source and an exact comparison refused every one of them.
  if (sibling && Math.floor(sibling.mtimeMs / 1000) >= Math.floor(info.mtimeMs / 1000)) {
    served = sibling;
    path = `${file}.gz`;
    encoding = "static";
  } else if (gzipOk && compressible && info.size >= GZIP_MIN_LENGTH) {
    encoding = "dynamic";
  }

  const etag = encoding === "dynamic" ? `W/${etagOf(info)}` : etagOf(served);
  const lastModified = httpDate(served);
  /** @type {Record<string, string | number>} */
  const out = {
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": lastModified,
    // On every reply, not just ranged ones: a browser only attempts a range
    // after an ordinary response said ranges are available.
    "Accept-Ranges": "bytes",
  };
  // Whenever the answer COULD have depended on Accept-Encoding, so a shared
  // cache keys the gzip and identity copies apart. nginx's gzip_vary does the
  // same: it is sent even to a client that got the identity bytes.
  if (compressible || encoding === "static") out.Vary = "Accept-Encoding";

  // Conditionals first (RFC 9110 §13.2.2): If-None-Match wins over
  // If-Modified-Since, and both win over Range.
  const inm = noneMatch(header(headers, "if-none-match"), etag);
  const ims = header(headers, "if-modified-since");
  const fresh =
    inm !== null ? inm : ims != null && Math.floor(served.mtimeMs / 1000) * 1000 <= Date.parse(String(ims));
  if (fresh) return { status: 304, headers: out, body: null };

  out["Content-Type"] = type;
  const head = method === "HEAD";
  if (encoding !== "identity") {
    out["Content-Encoding"] = "gzip";
    // Ranges are only ever served against the original (see above), so a
    // compressed answer must not advertise them; nginx drops it too.
    delete out["Accept-Ranges"];
    // On-the-fly output has no length until it is done; it goes out chunked.
    if (encoding === "static") out["Content-Length"] = served.size;
    return { status: 200, headers: out, body: head ? null : { path, gzip: encoding === "dynamic" } };
  }

  // If-Range: a range is only honoured against the version the client already
  // holds part of; anything else gets the whole file.
  const ifRange = header(headers, "if-range");
  const rangeStillValid = ifRange == null || ifRange.trim() === etag || ifRange.trim() === lastModified;
  const range = rangeStillValid ? parseByteRange(rangeHeader, info.size) : null;
  if (range === false) {
    return {
      status: 416,
      headers: { ...out, "Content-Range": `bytes */${info.size}`, "Content-Length": 0 },
      body: null,
    };
  }
  if (range) {
    out["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
    out["Content-Length"] = range.end - range.start + 1;
    return { status: 206, headers: out, body: head ? null : { path, start: range.start, end: range.end } };
  }
  out["Content-Length"] = info.size;
  return { status: 200, headers: out, body: head ? null : { path } };
}

/**
 * The bytes a plan said to send, as one readable stream. Errors on the file
 * read are forwarded to the stream returned, so the caller's own error
 * handling (a destroyed socket) applies to on-the-fly output too.
 *
 * @param {AssetBody} body
 */
export function openAssetBody(body) {
  const file = createReadStream(body.path, body.start != null ? { start: body.start, end: body.end } : undefined);
  if (!body.gzip) return file;
  return pipeline(file, createGzip({ level: GZIP_LEVEL }), () => {});
}
