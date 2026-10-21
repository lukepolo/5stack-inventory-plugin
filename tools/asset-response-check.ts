// Does a mount-backed file get the answer nginx.conf would give it?
//
// Run: node --experimental-strip-types tools/asset-response-check.ts
//
// Why this exists
// ---------------
// backend/src/assetResponse.mjs decides, for the backend's serveAssetDir and
// for scripts/serve.mjs, what nginx decides for production: which bytes go out
// (the extractor's `.gz`, on-the-fly gzip, or the file), under which ETag, and
// when a 304 or a range answers instead. Every failure here is silent in a
// browser — a gzip body under the wrong Content-Type still "loads", a range on
// compressed bytes plays as noise, a stale `.gz` serves last run's model — so
// the cases are pinned against a throwaway directory instead.
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptsGzip, IMMUTABLE, isCompressible, openAssetBody, planAsset } from "../backend/src/assetResponse.mjs";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${g}`);
  }
}
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

check("gzip accepted", acceptsGzip("gzip, deflate, br"), true);
check("gzip;q=0 is a refusal", acceptsGzip("gzip;q=0, identity"), false);
check("* counts", acceptsGzip("*"), true);
check("* does not override gzip;q=0", acceptsGzip("gzip;q=0, *"), false);
check("br alone is not gzip", acceptsGzip("br"), false);
check("no header", acceptsGzip(undefined), false);
check("GLB is compressible", isCompressible("model/gltf-binary"), true);
check("charset parameter ignored", isCompressible("text/css; charset=utf-8"), true);
check("audio is not (ranges)", isCompressible("audio/mpeg"), false);
check("WebP is not", isCompressible("image/webp"), false);
check("EXR is not (zips itself)", isCompressible("image/x-exr"), false);

const dir = mkdtempSync(join(tmpdir(), "asset-response-check-"));
try {
  // A GLB-ish body with a .gz beside it, the .gz carrying the original's mtime
  // the way `gzip -k` writes it.
  const glb = Buffer.alloc(64 * 1024, "glTF mesh data ");
  const glbFile = join(dir, "ak47.glb");
  writeFileSync(glbFile, glb);
  writeFileSync(`${glbFile}.gz`, gzipSync(glb, { level: 9 }));
  const t = new Date("2026-10-20T20:45:49.612Z");
  // The sibling a few hundred microseconds OLDER than its source, which is
  // what microsecond-precision timestamp copies produce.
  utimesSync(glbFile, t, t);
  utimesSync(`${glbFile}.gz`, new Date(t.getTime() - 0.4), new Date(t.getTime() - 0.4));
  const json = Buffer.from(JSON.stringify({ frames: Array.from({ length: 500 }, (_, i) => [i, i * 2, i * 3]) }));
  const jsonFile = join(dir, "clip.json");
  writeFileSync(jsonFile, json);
  const tiny = join(dir, "tiny.json");
  writeFileSync(tiny, "{}");
  const mp3 = join(dir, "kit.mp3");
  writeFileSync(mp3, Buffer.alloc(10_000, 7));
  const GZ = { "accept-encoding": "gzip, deflate, br" };

  const plan = (file: string, type: string, headers: Record<string, string> = {}, method = "GET") =>
    planAsset({ file, type, method, headers, cacheControl: IMMUTABLE });

  const miss = await plan(join(dir, "nope.glb"), "model/gltf-binary");
  check("a miss is null (the caller's own 404)", miss, null);
  const dirAsFile = await plan(dir, "model/gltf-binary");
  check("a directory is a miss", dirAsFile, null);

  const pre = await plan(glbFile, "model/gltf-binary", GZ);
  check("gzip client gets the .gz", [pre?.status, pre?.headers["Content-Encoding"], pre?.body?.path.endsWith(".gz")], [200, "gzip", true]);
  check(".gz keeps the ORIGINAL type", pre?.headers["Content-Type"], "model/gltf-binary");
  check(".gz length is the .gz's", pre?.headers["Content-Length"], gzipSync(glb, { level: 9 }).length);
  check("Vary on the .gz", pre?.headers.Vary, "Accept-Encoding");
  check("Cache-Control passed through", pre?.headers["Cache-Control"], IMMUTABLE);
  check("no Accept-Ranges on a compressed answer", pre?.headers["Accept-Ranges"], undefined);
  const preBody = await readAll(openAssetBody(pre!.body!));
  check(".gz body decodes to the file", gunzipSync(preBody).equals(glb), true);

  const ident = await plan(glbFile, "model/gltf-binary");
  check("no Accept-Encoding: the file", [ident?.status, ident?.headers["Content-Encoding"], ident?.headers["Content-Length"]], [200, undefined, glb.length]);
  check("identity still says Vary", ident?.headers.Vary, "Accept-Encoding");
  check("identity advertises ranges", ident?.headers["Accept-Ranges"], "bytes");
  check("each representation has its own ETag", ident?.headers.ETag !== pre?.headers.ETag, true);

  const refused = await plan(glbFile, "model/gltf-binary", { "accept-encoding": "gzip;q=0" });
  check("gzip;q=0: the file", refused?.headers["Content-Encoding"], undefined);

  // The original rewritten after its .gz: the sibling is stale and is skipped.
  const later = new Date(t.getTime() + 5000);
  utimesSync(glbFile, later, later);
  const stale = await plan(glbFile, "model/gltf-binary", GZ);
  check("stale .gz skipped, gzipped on the fly", [stale?.headers["Content-Encoding"], stale?.body?.path, stale?.body?.gzip], ["gzip", glbFile, true]);
  check("on-the-fly ETag is weak", String(stale?.headers.ETag).startsWith('W/"'), true);
  check("on-the-fly has no length", stale?.headers["Content-Length"], undefined);
  utimesSync(glbFile, t, t);

  const dyn = await plan(jsonFile, "application/json", GZ);
  check("JSON gzipped on the fly", [dyn?.headers["Content-Encoding"], dyn?.body?.gzip], ["gzip", true]);
  const dynBody = await readAll(openAssetBody(dyn!.body!));
  check("on-the-fly body decodes to the file", gunzipSync(dynBody).equals(json), true);
  check("on-the-fly is smaller", dynBody.length < json.length, true);

  const small = await plan(tiny, "application/json", GZ);
  check("under 1KB is sent as is", small?.headers["Content-Encoding"], undefined);

  const audio = await plan(mp3, "audio/mpeg", GZ);
  check("audio is never compressed", [audio?.headers["Content-Encoding"], audio?.headers.Vary], [undefined, undefined]);

  // Conditionals.
  const etag = String(ident?.headers.ETag);
  const nm = await plan(glbFile, "model/gltf-binary", { "if-none-match": etag });
  check("If-None-Match hit is a 304 with no body", [nm?.status, nm?.body], [304, null]);
  check("304 keeps Cache-Control and ETag", [nm?.headers["Cache-Control"], nm?.headers.ETag], [IMMUTABLE, etag]);
  check("304 carries no Content-Type/Length", [nm?.headers["Content-Type"], nm?.headers["Content-Length"]], [undefined, undefined]);
  const nmList = await plan(glbFile, "model/gltf-binary", { "if-none-match": `"x", W/${etag}` });
  check("If-None-Match list, weak form, matches", nmList?.status, 304);
  const nmDyn = await plan(jsonFile, "application/json", { ...GZ, "if-none-match": String(dyn?.headers.ETag) });
  check("weak on-the-fly ETag revalidates", nmDyn?.status, 304);
  const nmMiss = await plan(glbFile, "model/gltf-binary", { "if-none-match": '"other"', "if-modified-since": String(ident?.headers["Last-Modified"]) });
  check("a non-matching If-None-Match beats If-Modified-Since", nmMiss?.status, 200);
  const ims = await plan(glbFile, "model/gltf-binary", { "if-modified-since": String(ident?.headers["Last-Modified"]) });
  check("If-Modified-Since at Last-Modified is a 304", ims?.status, 304);
  const imsOld = await plan(glbFile, "model/gltf-binary", { "if-modified-since": "Mon, 01 Jan 2024 00:00:00 GMT" });
  check("older If-Modified-Since is a 200", imsOld?.status, 200);

  // Ranges.
  const r = await plan(mp3, "audio/mpeg", { range: "bytes=100-199", ...GZ });
  check("range: 206 with Content-Range", [r?.status, r?.headers["Content-Range"], r?.headers["Content-Length"]], [206, "bytes 100-199/10000", 100]);
  const rBody = await readAll(openAssetBody(r!.body!));
  check("range body is exactly the slice", rBody.length, 100);
  const rGlb = await plan(glbFile, "model/gltf-binary", { range: "bytes=0-9", ...GZ });
  check("range on a GLB addresses the ORIGINAL, never the .gz", [rGlb?.status, rGlb?.headers["Content-Encoding"], rGlb?.body?.path], [206, undefined, glbFile]);
  const bad = await plan(mp3, "audio/mpeg", { range: "bytes=20000-" });
  check("unsatisfiable range is a 416", [bad?.status, bad?.headers["Content-Range"]], [416, "bytes */10000"]);
  const ifRangeStale = await plan(mp3, "audio/mpeg", { range: "bytes=0-9", "if-range": '"old"' });
  check("If-Range mismatch: the whole file", [ifRangeStale?.status, ifRangeStale?.headers["Content-Length"]], [200, 10000]);
  const audioEtag = String(audio?.headers.ETag);
  const ifRangeOk = await plan(mp3, "audio/mpeg", { range: "bytes=0-9", "if-range": audioEtag });
  check("If-Range match: the range", ifRangeOk?.status, 206);

  // HEAD: the same headers, no body to open.
  const head = await plan(glbFile, "model/gltf-binary", GZ, "HEAD");
  check("HEAD: .gz headers, no body", [head?.status, head?.headers["Content-Length"], head?.body], [200, pre?.headers["Content-Length"], null]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nasset responses match nginx.conf's rules");
