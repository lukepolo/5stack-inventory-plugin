import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import federation from "@originjs/vite-plugin-federation";
import cssInjectedByJs from "vite-plugin-css-injected-by-js";
import { sharedGlobals } from "./shared-globals";

// No @types/node in this project — declare just enough for the env check below.
declare const process: { env: Record<string, string | undefined> };

// Stamp every build (including --watch rebuilds) with a build id the app can
// fetch at runtime — ends the "is the server serving my latest code?" guessing.
function buildStamp() {
  return {
    name: "build-stamp",
    generateBundle(this: unknown, _opts: unknown, bundle: Record<string, unknown>) {
      const builtAt = new Date().toISOString();
      (this as { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }).emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: JSON.stringify({ builtAt }),
      });
      void bundle;
    },
  };
}

// Federation shares JS, not CSS. cssInjectedByJs bundles this plugin's compiled
// Tailwind into the remoteEntry so styles auto-load in the host when the remote
// mounts. Colors still track the host's live branding via the shared CSS-var
// tokens from @5stack/ui.
export default defineConfig({
  plugins: [
    buildStamp(),
    sharedGlobals(),
    vue(),
    cssInjectedByJs(),
    federation({
      name: "inventory",
      filename: "remoteEntry.js",
      exposes: {
        "./App": "./src/App.vue",
      },
      // Intentionally no `shared` — see shared-globals.ts. Adding anything here
      // reintroduces the top-level await that breaks the panel in Safari.
    }),
  ],
  // `vue` resolves to the virtual bridge module, so Vite must not try to
  // pre-bundle the real package into an optimized dep.
  optimizeDeps: {
    exclude: ["vue"],
  },
  build: {
    // remoteEntry.js itself still uses top-level await. That one is safe: it is
    // a single isolated entry, not fanned out across the whole app.
    target: "esnext",
    cssCodeSplit: false,
    // reka-ui / lucide are bundled into this remote now (only Vue comes from
    // the panel), so their size is expected.
    chunkSizeWarningLimit: 900,
    // In-cluster dev watch (DEV_WATCH=1, set by `yarn dev:ui`). Two hard-won rules:
    //  - usePolling: inotify events in the codepier-synced container go silently
    //    blind after a while (`--watch` then never rebuilds again even though the
    //    sync delivered the file). Polling can't go blind.
    //  - emptyOutDir:false: watch rebuilds otherwise wipe dist/ first, so every
    //    rebuild has a window where remoteEntry.js/chunks 404 through the ingress,
    //    and clients holding the previous remoteEntry lose their hashed chunks.
    //    Overwrite in place instead; stale hashed chunks accumulating is harmless
    //    (the initial clean `vite build` at dev startup still empties it).
    ...(process.env.DEV_WATCH
      ? {
          emptyOutDir: false,
          watch: {
            buildDelay: 300,
            exclude: ["**/node_modules/**", "**/dist/**"],
            chokidar: { usePolling: true, interval: 500 },
          },
        }
      : {}),
  },
  // `vite preview` serves the built remoteEntry.js. cors:true sends
  // Access-Control-Allow-Origin:* so the panel can import it cross-origin.
  preview: {
    cors: true,
    // Served behind the plugin's own ingress host (inventory.5stack.gg, etc.),
    // so accept any host.
    allowedHosts: true,
    // remoteEntry.js keeps a stable filename but changes every build. In dev
    // (vite preview behind Cloudflare + the browser) a cached copy makes the
    // panel load STALE code — so disable caching entirely here. Production
    // nginx already handles this per-file.
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  },
});
