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
// Serve /models/* straight off disk from a local extraction.
function localModels(dir: string): Plugin {
  return {
    name: "local-models",
    configureServer(server) {
      server.middlewares.use("/models", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = resolve(dir, rel);
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

// Serve /models from a LOCAL extraction when one is present, so the rig does not
// depend on the deployed backend being up. It went 503 mid-session and every
// fixture failed with "no weapon inputs" — a real dependency, but not one a
// shader test should have. Point MODELS_DIR at any extract-models.sh output.
const MODELS_DIR = process.env.MODELS_DIR
  ?? resolve(process.env.HOME ?? "", "Downloads/cs2-model-extract/models");
const hasLocalModels = existsSync(MODELS_DIR);

// Standalone rig: serves tools/shadertest, the paint CDN, and the weapon models.
export default defineConfig({
  root: "tools/shadertest",
  plugins: [snapshotSink(), ...(hasLocalModels ? [localModels(MODELS_DIR)] : [])],
  publicDir: false,
  server: {
    port: 5199,
    fs: { allow: [resolve(HERE, "../.."), MODELS_DIR] },
    proxy: {
      "/materials": { target: "https://cdn.cstrike.app", changeOrigin: true },
      "/textures": { target: "https://cdn.cstrike.app", changeOrigin: true },
      "/images": { target: "https://cdn.cstrike.app", changeOrigin: true },
      // Only fall back to the deployed host for models when there is no local
      // extraction to serve.
      ...(hasLocalModels ? {} : { "/models": { target: "https://inventory.5stack.gg", changeOrigin: true } }),
      "/paints": { target: "https://inventory.5stack.gg", changeOrigin: true },
      "/api": { target: "https://inventory.5stack.gg", changeOrigin: true },
    },
  },
});
