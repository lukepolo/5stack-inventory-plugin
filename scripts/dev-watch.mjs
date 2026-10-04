// The in-cluster dev rebuild loop: poll the sources, run a FULL `vite build` on
// change.
//
// This replaced `DEV_WATCH=1 vite build` (vite's own --watch), because under
// vite 8 / rolldown a watch REBUILD does not re-emit the federation expose. It
// writes the chunks that changed plus remoteEntry.js, but never
// `App-*.js` or `__federation_expose_App-*.js`, so
// @originjs/vite-plugin-federation finds no expose chunk in the bundle and leaves
// its placeholder in remoteEntry verbatim:
//
//   o("${__federation_expose_./App}")
//
// The panel fails to import that, retries, and reload-loops until a clean build.
// Patching the placeholder would not be enough either: the App chunk on disk is
// the previous one, still importing the previous viewer3d, so an edit would
// silently not show. A full build is correct every time — it is what the
// clean build at dev start does — and costs a few seconds per change.
//
// Polling, not fs.watch, for the reason vite.config.ts gives: inotify inside the
// codepier-synced container goes blind after a while.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WATCH = [
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "shared-globals.ts",
  "federation.shared.ts",
  "tailwind.config.js",
  "postcss.config.cjs",
];
const POLL_MS = 500;
const SETTLE_MS = 300;

function signature() {
  const parts = [];
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name));
    } else {
      parts.push(`${p}:${st.mtimeMs}:${st.size}`);
    }
  };
  for (const w of WATCH) walk(path.join(ROOT, w));
  return parts.join("\n");
}

let building = false;
let again = false;

function build() {
  if (building) {
    again = true;
    return;
  }
  building = true;
  const started = Date.now();
  // DEV_WATCH keeps emptyOutDir off (see vite.config.ts): a build that wiped
  // dist/ first would 404 remoteEntry for its whole duration.
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: ROOT,
    env: { ...process.env, DEV_WATCH: "1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.on("exit", (code) => {
    building = false;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(code === 0 ? `[dev-watch] rebuilt in ${secs}s` : `[dev-watch] build FAILED (exit ${code}) after ${secs}s`);
    if (again) {
      again = false;
      build();
    }
  });
}

let last = signature();
let pending;
setInterval(() => {
  const now = signature();
  if (now === last) return;
  last = now;
  // Let a burst of synced files land before building once for all of them.
  clearTimeout(pending);
  pending = setTimeout(build, SETTLE_MS);
}, POLL_MS);
console.log(`[dev-watch] polling ${WATCH.join(", ")} every ${POLL_MS}ms`);
