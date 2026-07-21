// Dev static server for dist/ — replaces `vite preview`, which snapshots the
// dist directory at startup (sirv production mode) and therefore keeps serving
// STALE builds until restarted. This reads from disk on every request and sends
// no-store so neither the browser nor Cloudflare caches remoteEntry.js.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
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
    let data;
    try {
      data = await readFile(file);
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
    res.writeHead(200, { ...HEADERS, "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (error) {
    res.writeHead(500, HEADERS);
    res.end(String(error));
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`serving ${root} on :${port} (fresh reads, no-store)`);
});
