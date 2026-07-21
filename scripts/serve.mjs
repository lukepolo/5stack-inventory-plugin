// Dev static server for dist/ — replaces `vite preview`, which snapshots the
// dist directory at startup (sirv production mode) and therefore keeps serving
// STALE builds until restarted. This reads from disk on every request and sends
// no-store so neither the browser nor Cloudflare caches remoteEntry.js.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist", import.meta.url));
// Extracted CS2 models live on a hostPath mount (see k8s/deployment.yaml);
// /models/* is served from there so 36MB of GLBs never enter the build.
const modelsDir = process.env.MODELS_DIR ?? "/cs2-models/models";
const paintsDir = process.env.PAINTS_DIR ?? "/cs2-models/paints";
const rendersDir = process.env.RENDERS_DIR ?? "/cs2-models/renders";
const testsDir = process.env.TESTS_DIR ?? "/cs2-models/tests";
// Econ item icons, extracted from this instance's own CS2 install. Must be
// served here as well as in nginx.conf: the hot-swap deployment runs THIS file
// rather than nginx, so an nginx-only route leaves every tile blank in dev.
const imagesDir = process.env.IMAGES_DIR ?? "/cs2-models/images";
// Production nginx falls back to the backend when a mount-backed path misses
// (`try_files $uri @backend`), for the case where the frontend and backend pods
// land on different nodes and only one of them can see the file. Mirror that
// here so dev behaves the same.
const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://inventory-backend:3000";
const port = Number(process.env.PORT ?? 80);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".webp": "image/webp",
  ".map": "application/json",
};
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // Default: never cache. Right for the dev loop — dist/ is rebuilt constantly
  // and a cached bundle is the classic "my change did nothing".
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

// Mount-backed assets are a different story, and must match nginx.conf or the
// two environments disagree (they already did: this file's blanket no-store
// meant every 1.3 MB paint texture re-downloaded on every page load).
//
//  - textures / icons  -> filename carries a content hash, so a URL never
//                         changes meaning. Cache for a year.
//  - materials with ?v -> the client stamped the extraction version on it
//                         (withAssetVersion), so it is equally immutable.
//  - materials bare    -> the filename comes from cs2-lib and is FIXED while
//                         the contents are rewritten by every extraction, so
//                         this one has to revalidate. Caching it is what left a
//                         browser asking for textures a later run had renamed.
const IMMUTABLE = "public, max-age=31536000, immutable";
function cacheControlFor(base, pathname, query) {
  if (base === imagesDir) return IMMUTABLE;
  // Materials AND textures: both are only immutable once version-stamped. A
  // texture's filename hashes its archive PATH, not its bytes, so a CS2 update
  // can replace the contents behind an identical name.
  if (base === paintsDir) return query.get("v") ? IMMUTABLE : "no-cache";
  return HEADERS["Cache-Control"];
}

createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url ?? "/", "http://x");
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    let base = root;
    if (pathname.startsWith("/models/")) {
      base = modelsDir;
      pathname = pathname.slice("/models".length);
    } else if (pathname.startsWith("/paints/")) {
      base = paintsDir;
      pathname = pathname.slice("/paints".length);
    } else if (pathname.startsWith("/renders/")) {
      base = rendersDir;
      pathname = pathname.slice("/renders".length);
    } else if (pathname.startsWith("/tests/")) {
      base = testsDir;
      pathname = pathname.slice("/tests".length);
    } else if (pathname.startsWith("/images/")) {
      base = imagesDir;
      pathname = pathname.slice("/images".length);
    }
    const file = normalize(join(base, pathname));
    if (!file.startsWith(base + sep) && file !== join(root, "index.html")) {
      res.writeHead(403, HEADERS);
      res.end("forbidden");
      return;
    }
    let info;
    try {
      info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      // Mount miss on a backend-backed path — hand it to the backend, which
      // serves it and mirrors it so the next request comes off the mount.
      if (base === paintsDir || base === rendersDir || base === testsDir || base === imagesDir) {
        try {
          const upstream = await fetch(backendOrigin + req.url);
          if (upstream.ok) {
            const body = Buffer.from(await upstream.arrayBuffer());
            res.writeHead(200, {
              ...HEADERS,
              "Cache-Control": cacheControlFor(base, pathname, parsed.searchParams),
              "Content-Type": upstream.headers.get("content-type") ?? MIME[extname(file)] ?? "application/octet-stream",
            });
            res.end(body);
            return;
          }
        } catch {
          /* backend unreachable — fall through to an honest 404 */
        }
      }
      // SPA fallback: the plugin owns routes below its mount (/admin, /focus…),
      // so a hard refresh on one must still get index.html. Only extensionless
      // paths fall back — a missing .js/.glb stays an honest 404.
      if (base === root && !extname(file)) {
        try {
          data = await readFile(join(root, "index.html"));
          res.writeHead(200, { ...HEADERS, "Content-Type": MIME[".html"] });
          res.end(data);
          return;
        } catch {
          /* no index.html — fall through to 404 */
        }
      }
      res.writeHead(404, HEADERS);
      res.end("not found");
      return;
    }
    // STREAM, and never read a body for HEAD. This used to readFile() the whole
    // file into memory on every request — including HEAD — so the viewer's ~24
    // parallel `.glb` existence probes each buffered 3-5 MB for nothing. On a
    // single-threaded server that stalled hard enough for the edge to return
    // 503s. Production nginx streams via sendfile; this makes dev behave the
    // same instead of falling over as soon as it fronts a CDN host.
    res.writeHead(200, {
      ...HEADERS,
      "Cache-Control": cacheControlFor(base, pathname, parsed.searchParams),
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch (error) {
    res.writeHead(500, HEADERS);
    res.end(String(error));
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`serving ${root} on :${port} (fresh reads, no-store)`);
});
