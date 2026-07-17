#!/usr/bin/env node
// OPTIONAL bulk pre-warm for the paint cache. In prod the backend's
// /paints/* route lazily fetches+persists each file on first request, so
// nothing needs to run — this script just warms the whole catalog at once.
//
// Only mirrors paints that exist on items we render (weapons, knives, gloves)
// and dedupes shared textures — NOT the whole 27M-image catalog.
//
// Run from backend/ (needs its node_modules for cs2-lib):
//   node scripts/mirror-paints.mjs --out /opt/5stack/models/cs2-model-extract/paints
//   node scripts/mirror-paints.mjs --out ./paints-mirror --limit 25   # smoke test
//
// The output layout preserves CDN paths (materials/..., textures/...), so the
// frontend serves it 1:1 under /paints/ from the same hostPath mount as models.
import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/translations/english";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const CDN = "https://cdn.cstrike.app";
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};
const OUT = argOf("--out", "./paints-mirror");
const LIMIT = Number(argOf("--limit", "0")) || Infinity;
const TYPES = new Set(argOf("--types", "weapon,melee,glove").split(","));
const CONCURRENCY = 8;

CS2Economy.load({ items: CS2_ITEMS, language: english });

const paints = [
  ...new Set(
    CS2Economy.itemsAsArray
      .filter((i) => TYPES.has(i.type) && i.paintMaterial)
      .map((i) => i.paintMaterial),
  ),
].slice(0, LIMIT);
console.log(`Mirroring ${paints.length} paint materials -> ${OUT}`);

let files = 0;
let bytes = 0;
let skipped = 0;
const failures = [];
const fetched = new Set(); // dedupe within this run

async function mirror(path) {
  if (!path || fetched.has(path)) return null;
  fetched.add(path);
  const dest = join(OUT, path);
  try {
    const existing = await stat(dest).catch(() => null);
    if (existing && existing.size > 0) {
      skipped++;
      return null; // already mirrored (resume-safe); parse from CDN below if needed
    }
    const res = await fetch(CDN + path, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      failures.push(`${res.status} ${path}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    files++;
    bytes += buf.length;
    return buf;
  } catch (error) {
    failures.push(`${String(error).slice(0, 60)} ${path}`);
    return null;
  }
}

async function readJson(path) {
  // Use the local copy when present (resume runs), else what mirror() fetched.
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(join(OUT, path), "utf8"));
  } catch {
    return null;
  }
}

async function processPaint(paintPath) {
  await mirror(paintPath);
  const comp = await readJson(paintPath);
  if (!comp) return;
  let vmatPath;
  const walk = (o) => {
    if (!o || vmatPath) return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === "object") {
      if (typeof o.m_strSpecificContainerMaterial === "string") {
        vmatPath = o.m_strSpecificContainerMaterial;
        return;
      }
      Object.values(o).forEach(walk);
    }
  };
  // Composite-style paints inject skin textures as loose variables with
  // runtime resource paths — mirror ALL of those (pattern/rough/metal/normal
  // plus shared wear+grunge masks, which dedupe across the whole run).
  const runtimePaths = [];
  const walkRuntime = (o) => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walkRuntime);
    if (typeof o === "object") {
      if (typeof o.m_strTextureRuntimeResourcePath === "string" && o.m_strTextureRuntimeResourcePath.startsWith("/")) {
        runtimePaths.push(o.m_strTextureRuntimeResourcePath);
      }
      Object.values(o).forEach(walkRuntime);
    }
  };
  walkRuntime(comp);
  for (const rp of runtimePaths) await mirror(rp);
  walk(comp);
  if (!vmatPath) return;
  await mirror(vmatPath);
  const vmat = await readJson(vmatPath);
  if (!vmat) return;
  for (const t of vmat.m_textureParams ?? []) {
    if (typeof t.m_pValue === "string" && t.m_pValue.startsWith("/")) {
      await mirror(t.m_pValue);
    }
  }
  // Shared includes (e.g. _shared_paint_generic) referenced by the compmat.
  const includes = [];
  const walkIncludes = (o) => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walkIncludes);
    if (typeof o === "object") {
      if (Array.isArray(o.m_vecCompMatIncludes)) includes.push(...o.m_vecCompMatIncludes);
      Object.values(o).forEach(walkIncludes);
    }
  };
  walkIncludes(comp);
  for (const inc of includes) {
    if (typeof inc === "string") await mirror(inc);
  }
}

let index = 0;
let done = 0;
async function worker() {
  while (index < paints.length) {
    const paint = paints[index++];
    await processPaint(paint);
    done++;
    if (done % 50 === 0) {
      console.log(`  ${done}/${paints.length} paints · ${files} files · ${(bytes / 1048576).toFixed(0)} MB`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nDone: ${files} files (${(bytes / 1048576).toFixed(0)} MB), ${skipped} already present, ${failures.length} failures`);
if (failures.length) console.log("First failures:", failures.slice(0, 8));
console.log(`\nServe by placing/leaving this at <mount>/paints — the frontend maps /paints/* onto it.`);
