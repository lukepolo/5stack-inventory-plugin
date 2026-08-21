import { defineConfig, type Plugin } from "vite";
import { mkdirSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// POST {name, png} -> writes tools/shadertest/snapshots/<name>.png
// Lets the rig dump what the GPU actually produced to disk, so composites can be
// eyeballed and diffed across runs instead of only ever being reduced to
// statistics. "sat=18" tells you it isn't grey; only the image tells you the
// pattern is the right pattern.
// Serve an asset prefix straight off disk, falling through to the proxy on a
// miss. The fall-through is the whole point: a local mirror is a CACHE, not a
// replacement. Pulling all 27GB of the mount is not something anyone will do, so
// the useful state is a partial one — GLBs and sidecars local (173MB + change),
// the 21GB of paint textures still coming off the deployment. `next()` on a miss
// is what makes that state work instead of 404ing.
function localDir(prefix: string, dir: string): Plugin {
  return {
    name: `local${prefix.replace(/\W/g, "-")}`,
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = resolve(dir, rel);
        // Path traversal: `rel` comes off the wire, and this server has fs.allow
        // pointed at a models dir full of assets.
        if (!file.startsWith(dir) || !existsSync(file)) return next();
        const ext = file.split(".").pop()!.toLowerCase();
        res.setHeader("content-type",
          { json: "application/json", png: "image/png", glb: "model/gltf-binary", webp: "image/webp" }[ext] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

function snapshotSink(): Plugin {
  const dir = resolve(HERE, "snapshots");
  return {
    name: "snapshot-sink",
    configureServer(server) {
      server.middlewares.use("/__snap", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("post only");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { name, png } = JSON.parse(body);
            mkdirSync(dir, { recursive: true });
            const safe = String(name).replace(/[^a-z0-9._-]/gi, "_");
            writeFileSync(resolve(dir, `${safe}.png`), Buffer.from(String(png).split(",")[1], "base64"));
            res.end("ok");
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// Serve assets from a LOCAL mirror when one is present, so the rig does not
// depend on the deployed backend being up. It went 503 mid-session and every
// fixture failed with "no weapon inputs" — a real dependency, but not one a
// shader test should have.
//
// `tools/shadertest/sync-assets.sh` populates the mirror; ASSETS_DIR is its root
// and mirrors the mount's own layout (models/, paints/materials, paints/textures,
// images/), so a path that works against the deployment works against the mirror
// unchanged. The individual DIR vars still override for anything laid out
// differently — MODELS_DIR predates this and keeps its old default.
const ASSETS_DIR = process.env.ASSETS_DIR
  ?? resolve(process.env.HOME ?? "", "Downloads/cs2-model-extract");
const MODELS_DIR = process.env.MODELS_DIR ?? resolve(ASSETS_DIR, "models");
const TEXTURES_DIR = process.env.TEXTURES_DIR ?? resolve(ASSETS_DIR, "paints/textures");
const MATERIALS_DIR = process.env.MATERIALS_DIR ?? resolve(ASSETS_DIR, "paints/materials");
const IMAGES_DIR = process.env.IMAGES_DIR ?? resolve(ASSETS_DIR, "images");

const local: Plugin[] = [];
const served: string[] = [];
for (const [prefix, dir] of [
  ["/models", MODELS_DIR],
  ["/textures", TEXTURES_DIR],
  ["/materials", MATERIALS_DIR],
  ["/images", IMAGES_DIR],
] as const) {
  if (!existsSync(dir)) continue;
  local.push(localDir(prefix, dir));
  served.push(prefix);
}
if (served.length) {
  // Say it out loud. A stale mirror serving last week's textures while you debug
  // a shader is the same class of bug as a stale dist/, and silently preferring
  // local files is exactly how you spend an afternoon on one.
  console.log(`[shadertest] local assets for ${served.join(" ")} from ${ASSETS_DIR} (missing files fall through to the host)`);
}

const ASSET_HOST = process.env.ASSET_HOST ?? "https://inventory.5stack.gg";

// Standalone rig: serves tools/shadertest plus the paint chain and models. Every
// asset route points at OUR deployment (or a local extraction) — the rig must
// exercise the same assets production does, and there is no third-party mirror
// to borrow from anymore. Point ASSET_HOST at another instance if needed.
export default defineConfig({
  root: "tools/shadertest",
  plugins: [snapshotSink(), ...local],
  publicDir: false,
  server: {
    port: 5199,
    fs: { allow: [resolve(HERE, "../.."), ASSETS_DIR, MODELS_DIR] },
    // EVERY prefix keeps its proxy, including ones served locally. The local
    // middleware runs first and calls next() on a miss, so a partial mirror
    // degrades to the network instead of 404ing — see localDir. This used to
    // drop the /models proxy whenever a local dir existed, which meant one
    // missing GLB broke the rig with no clue as to why.
    proxy: {
      // The rig loads paint assets by their mirror-relative path
      // ("/materials/...", "/textures/..."), which our host serves under
      // /paints — rewrite rather than expecting a bare-rooted layout.
      "/materials": { target: ASSET_HOST, changeOrigin: true, rewrite: (p) => `/paints${p}` },
      "/textures": { target: ASSET_HOST, changeOrigin: true, rewrite: (p) => `/paints${p}` },
      // The viewmodel tree: clips, their sounds, the fx textures and the game's
      // own UI icons. Same host, same shape as production — the rig fetching a
      // flash texture over the real URL is part of what it is testing.
      "/anims": { target: ASSET_HOST, changeOrigin: true },
      "/images": { target: ASSET_HOST, changeOrigin: true },
      "/models": { target: ASSET_HOST, changeOrigin: true },
      "/paints": { target: ASSET_HOST, changeOrigin: true },
      "/api": { target: ASSET_HOST, changeOrigin: true },
    },
  },
});
