// Regenerate the KNIFE entries of src/stattrakAnchors.json from the game's own
// attachment data, and check the knife name tag anchors against it.
//
// The extraction (step stattrak-art, pipeline v36+) writes
// models/knife-attachments.json: per knife vmdl, every attachment's parent bone,
// relative origin and relative angles, and every bone's parent, origin and
// angles. That is the ground truth. Run this after an extraction on a new CS2
// build, or whenever a knife's counter sits in the wrong place:
//
//   node tools/knife-anchors.mjs https://inventory-dev.fulm.eu/models/knife-attachments.json
//   node tools/knife-anchors.mjs knife-attachments.json --dry-run
//
// THE CONVENTION, which placeAttachedModule (src/viewer3d.ts) depends on:
//   bone   the attachment's parent bone — the viewer follows that bone's pose,
//          so a folding knife's counter rides its blade
//   src    the parent bone's bind position (model inches) PLUS the attachment's
//          relative origin, UNROTATED; the viewer applies the bone's bind
//          rotation itself: R_bone * (src - bonePos) + bonePos
//   angles the attachment's relative angles (Source QAngle: pitch, yaw, roll)
//   pos    the fully resolved model-space point, swizzled to glb metres — only
//          used for a model without a skeleton
//
// The old knife anchors had `src` = relative origin + 0.5in (the `weapon` bone)
// and no bone: right for knives whose counter hangs off weapon_offset, an inch
// short on the six folding knives whose counter hangs off `blade`.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [src, ...flags] = process.argv.slice(2);
if (!src) {
  console.error("usage: node tools/knife-anchors.mjs <knife-attachments.json|url> [--dry-run]");
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(/^https?:/.test(src) ? await (await fetch(src)).text() : await readFile(src, "utf8"));

// vmdl basename -> the model key the GLBs and anchor files use.
const KEY = {
  weapon_knife_bayonet: "bayonet",
  weapon_knife_bowie: "knife_survival_bowie",
  weapon_knife_butterfly: "knife_butterfly",
  weapon_knife_canis: "knife_canis",
  weapon_knife_cord: "knife_cord",
  weapon_knife_css: "knife_css",
  weapon_knife_default_ct: "knife",
  weapon_knife_default_t: "knife_t",
  weapon_knife_falchion: "knife_falchion",
  weapon_knife_flip: "knife_flip",
  weapon_knife_gut: "knife_gut",
  weapon_knife_karambit: "knife_karambit",
  weapon_knife_kukri: "knife_kukri",
  weapon_knife_m9: "knife_m9_bayonet",
  weapon_knife_navaja: "knife_gypsy_jackknife",
  weapon_knife_outdoor: "knife_outdoor",
  weapon_knife_push: "knife_push",
  weapon_knife_skeleton: "knife_skeleton",
  weapon_knife_stiletto: "knife_stiletto",
  weapon_knife_tactical: "knife_tactical",
  weapon_knife_talon: "knife_widowmaker",
  weapon_knife_ursus: "knife_ursus",
};

const rad = Math.PI / 180;
// Source QAngle [pitch, yaw, roll] as a matrix: Rz(yaw) * Ry(pitch) * Rx(roll).
function qangle([p, y, r]) {
  const [cp, sp, cy, sy, cr, sr] = [Math.cos(p * rad), Math.sin(p * rad), Math.cos(y * rad), Math.sin(y * rad), Math.cos(r * rad), Math.sin(r * rad)];
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
}
const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
const apply = (m, v) => m.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function boneBind(bones, name) {
  if (!name) return { pos: [0, 0, 0], rot: I };
  const b = bones[name];
  if (!b) throw new Error(`bone ${name} not in the dump`);
  const parent = boneBind(bones, b.parent);
  return {
    pos: parent.pos.map((x, i) => x + apply(parent.rot, b.origin ?? [0, 0, 0])[i]),
    rot: mul(parent.rot, qangle(b.angles ?? [0, 0, 0])),
  };
}
const round = (v) => v.map((x) => Math.round(x * 1e6) / 1e6);
const S = 0.0254;

const anchorsPath = join(REPO, "src/stattrakAnchors.json");
const raw = await readFile(anchorsPath, "utf8");
const anchors = JSON.parse(raw);
const nametags = JSON.parse(await readFile(join(REPO, "src/nametagAnchors.json"), "utf8"));
let changed = 0;
for (const [stem, key] of Object.entries(KEY)) {
  const knife = data[stem];
  if (!knife) {
    console.log(`!! ${stem} (${key}) missing from the dump`);
    continue;
  }
  for (const which of ["stattrak", "nametag"]) {
    const att = knife.attachments[which];
    if (!att) continue;
    const bind = boneBind(knife.bones, att.parent_bone);
    const srcV = round(bind.pos.map((x, i) => x + att.origin[i]));
    const model = bind.pos.map((x, i) => x + apply(bind.rot, att.origin)[i]);
    if (which === "nametag") {
      // Report only: these were generated right (bone included) upstream.
      const have = nametags[key]?.hd?.src;
      const off = have && Math.max(...have.map((x, i) => Math.abs(x - srcV[i])));
      if (!have || off > 1e-3) console.log(`nametag ${key}: anchor ${JSON.stringify(have)} vs game ${JSON.stringify(srcV)}`);
      continue;
    }
    const entry = anchors[key];
    if (!entry?.hd) {
      console.log(`!! ${key} has no stattrak anchor entry`);
      continue;
    }
    const before = JSON.stringify(entry);
    const { bone: _old, ...rest } = entry;
    rest.hd = { ...rest.hd, angles: round(att.angles), pos: round([model[1] * S, model[2] * S, model[0] * S]), src: srcV };
    anchors[key] = { bone: att.parent_bone, ...rest };
    if (JSON.stringify(anchors[key]) !== before) {
      changed++;
      console.log(`stattrak ${key.padEnd(22)} bone=${att.parent_bone.padEnd(13)} src=${JSON.stringify(srcV)}`);
    }
  }
}
if (flags.includes("--dry-run")) console.log(`${changed} stattrak entr${changed === 1 ? "y" : "ies"} would change (dry run)`);
else {
  await writeFile(anchorsPath, JSON.stringify(anchors, null, 1) + (raw.endsWith("\n") ? "\n" : ""));
  console.log(`${changed} stattrak entr${changed === 1 ? "y" : "ies"} updated in src/stattrakAnchors.json`);
}
