// One `bytes=` range header, parsed once for both servers that answer them.
//
// Plain .mjs on purpose. Two very different callers import this: the backend
// (backend/src/main.ts, run through Node's type stripping) and the dev/hot-swap
// static server (scripts/serve.mjs, plain Node with no flags). A .ts module
// would be unimportable from the second on any Node without type stripping
// enabled, and a copy under scripts/ would be unreachable from the first —
// Dockerfile.backend copies `backend/` and nothing else.
//
// It lived as two byte-for-byte copies before that, which is precisely the
// nginx-vs-serve.mjs divergence the comments around both call sites say the
// range handling exists to prevent: a fix to one (multi-range support, say)
// would have left the other environment behaving differently.

/**
 * One `bytes=` range against a known size.
 *
 * A music kit is ~3.5MB and nobody listens to all of it — without ranges the
 * browser downloads the whole track before the first note and cannot seek at
 * all, because seeking IS a range request and an element that never saw
 * `Accept-Ranges: bytes` treats the stream as unseekable.
 *
 * @param {string | undefined} header the raw Range header, if any
 * @param {number} size the file's size in bytes
 * @returns {{ start: number, end: number } | null | false}
 *   `null` when no range was asked for, and `false` when the one asked for
 *   cannot be met.
 *
 * The distinction matters: an unsatisfiable range is a 416, and answering it
 * with the whole file instead hands a media element bytes from an offset it did
 * not ask about, which it decodes as noise.
 */
export function parseByteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  // `bytes=-500` means the LAST 500 bytes. Media elements use the suffix form
  // to read a trailing index, so reading it as "0 to 500" serves the header
  // where the tail was asked for.
  let start = rawStart === "" ? size - Number(rawEnd) : Number(rawStart);
  let end = rawStart === "" ? size - 1 : rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (size === 0 || start > end || start >= size) return false;
  return { start, end };
}
