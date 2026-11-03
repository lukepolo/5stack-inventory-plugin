// Bakes src/weaponOutlines.json: every sticker-taking weapon's side outline,
// traced to vector paths at the Sticker Crafts mat's scale.
//
// Each weapon is mounted through the REAL viewer (weaponOutline: shape only,
// no textures), traced by the app's own src/outlineTrace.ts, drawn here as a
// card to look over, and the whole table printed as JSON into #json. Copy it to
// src/weaponOutlines.json — or let a driver read `window.__outlines` — when a
// CS2 update changes a weapon's model or its sticker slots.
//
//   npx vite --config tools/shadertest/vite.config.ts
//   open http://localhost:5199/outlines.html            (every weapon)
//   open http://localhost:5199/outlines.html?only=ak47  (one, to check it)
import { weaponOutline } from "../../src/viewer3d";
import { traceOutline, type WeaponOutline } from "../../src/outlineTrace";

const log = (t: string) => (document.getElementById("log")!.innerHTML += t + "<br>");
const KINDS = new Set(["rifle", "smg", "heavy", "secondary"]);

function card(o: WeaponOutline, name: string) {
  const k = 3;
  const svg = `<svg width="${o.w * k}" height="${o.h * k}" viewBox="0 0 ${o.w} ${o.h}"><path d="${o.paths
    .map((p) => "M" + p.join(" ") + "Z")
    .join("")}" fill="rgba(240,245,238,.06)" fill-rule="evenodd" stroke="#eef3ec" stroke-width="0.25"/>${o.anchors
    .map((a) => `<rect x="${a.x - 2.5}" y="${a.y - 2.5}" width="5" height="5" fill="none" stroke="#eef3ec" stroke-width="0.15" stroke-dasharray="0.6 0.5"/>`)
    .join("")}</svg>`;
  const fig = document.createElement("figure");
  fig.innerHTML = `${svg}<figcaption>${name} · ${o.w.toFixed(1)}×${o.h.toFixed(1)} · sticker ${o.stickerCm} cm · ${o.paths.reduce((n, p) => n + p.length / 2, 0)} pts</figcaption>`;
  document.getElementById("cards")!.appendChild(fig);
}

async function main() {
  const only = new URLSearchParams(location.search).get("only");
  const catalog = (await (await fetch("/api/catalog")).json()) as { weapons: { model: string; name: string; category: string }[] };
  const weapons = catalog.weapons.filter((w) => KINDS.has(w.category) && (!only || w.model === only));
  const out: WeaponOutline[] = [];
  for (const w of weapons) {
    const t0 = performance.now();
    const geo = (await (await fetch(`/api/catalog/sticker-bounds/${encodeURIComponent(w.model)}`)).json()) as { slots?: never[] };
    const side = await weaponOutline(w.model, geo.slots ?? []);
    const traced = side ? traceOutline(w.model, side) : null;
    if (!traced) {
      log(`${w.model}: FAILED`);
      continue;
    }
    out.push(traced);
    card(traced, w.name);
    log(`${w.model}: ${Math.round(performance.now() - t0)} ms`);
  }
  const table = { generated: new Date().toISOString().slice(0, 10), outlines: out };
  const json = JSON.stringify(table);
  document.getElementById("json")!.textContent = json;
  (window as unknown as { __outlines: unknown }).__outlines = table;
  log(`done: ${out.length} of ${weapons.length}, ${(json.length / 1024).toFixed(0)} KB`);
}
void main();
