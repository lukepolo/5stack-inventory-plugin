// Extract the pets' animation clips.
//
// The chicken models carry no motion of their own — their GLB clips are
// one-frame POSES (`ref` and the `chicken_<part>_min/_max` proportions). What
// the game plays lives where the viewmodel inspects do, as `.vnmclip_c` under
// `animation/anims/chicken/`, in three folders:
//
//   world/     what a pet does at your feet: idle01..07, walk, run, hop,
//              trick01..13, react01..05, scared, sleep, squat, turn-in-place
//   ui/        the inventory's own: reveal (a 22s showcase), shoulder perches,
//              feeding, egg hatch, retirement; `chickbaby_*` is the chick's
//   snapshot/  one-frame photo-booth poses, `_adolescent` / `_baby` variants
//
// ALL OF THEM DRIVE ONE RIG. Every clip names the same 117 bones, and every one
// of those is a node in all four bird GLBs (chick, catalana, silkie, polish),
// with matching bone-local translations — so a clip plays on any of them by
// name, with no retarget. Units are source units, the same as the GLB's bones.
//
// ADDITIVE clips are skipped in favour of their absolute twins: the sleep
// flinches ship as `chick_sleep_flinch01` (`m_additiveType = "RelativeToFrame"`,
// a delta on top of the sleep loop) AND `chick_sleep_flinch01.vnmclip+non_additive`
// (the same motion, absolute). Only the second plays on its own.
//
// Output, beside the rest of the pet assets:
//   <models>/pets/anims/<folder>/<clip>.json   tracks, as tools/nmclip.mjs reads them
//   <models>/pets/anims/index.json             [{ name, duration }]
//
// Usage (extract-models.sh step pet-models passes all three):
//   node scripts/extract-pet-anims.mjs --cli <Source2Viewer-CLI> --vpk <pak01_dir.vpk> --out <models>/pets/anims
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactTrack, readClip } from "../tools/nmclip.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const CS2_DIR = process.env.CS2_DIR ?? "/cs2-game";
const OUT_DIR = process.env.OUT_DIR ?? "/cs2-models";
const WORK_DIR = process.env.WORK_DIR ?? process.env.EXTRACT_WORK_DIR ?? path.join(OUT_DIR, ".work");
const VPK = arg("vpk", path.join(CS2_DIR, "game/csgo/pak01_dir.vpk"));
const CLI = arg("cli", path.join(WORK_DIR, "cs2-model-extract/cli/Source2Viewer-CLI"));
const OUT = arg("out", path.join(OUT_DIR, "models/pets/anims"));
const PREFIX = "animation/anims/chicken/";
const NON_ADDITIVE = ".vnmclip+non_additive";

function clipList() {
  const out = execFileSync(CLI, ["-i", VPK, "--vpk_dir"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return out
    .split("\n")
    .map((l) => l.split(" ")[0])
    .filter((p) => p.startsWith(PREFIX) && p.endsWith(".vnmclip_c"));
}

function main() {
  const all = clipList();
  if (!all.length) {
    console.warn(`!! no clips under ${PREFIX} — nothing extracted`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "petanim-"));
  const index = [];
  let skipped = 0;
  let failed = 0;
  for (const src of all) {
    // `world/chick_idle01` — the folder stays in the name, because `ui/` and
    // `world/` are different questions (a showcase versus a behaviour).
    const rel = src.slice(PREFIX.length).replace(/\.vnmclip_c$/, "");
    const name = rel.replace(NON_ADDITIVE, "");
    try {
      // A directory per clip: an additive clip and its +non_additive twin share
      // a source DMX name, so a shared one could hand this clip its twin's file.
      const dir = fs.mkdtempSync(path.join(tmp, "c-"));
      execFileSync(CLI, ["-i", VPK, "--vpk_filepath", src, "-o", dir, "-d"], { stdio: "pipe" });
      const written = fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f)));
      const kv = written.filter((f) => /\.vnmclip/.test(f) && !f.endsWith(".dmx")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
      const additive = /m_additiveType\s*=\s*"([^"]+)"/.exec(kv)?.[1];
      if (additive && additive !== "None") {
        skipped++;
        continue;
      }
      const dmx = written.find((f) => f.endsWith(".dmx"));
      if (!dmx) throw new Error("no DMX written");
      const clip = readClip(fs.readFileSync(dmx));
      const bones = {};
      for (const [bone, tr] of Object.entries(clip.bones)) {
        const rot = compactTrack(tr.rot, 1e-4);
        const pos = compactTrack(tr.pos, 1e-3);
        if (rot || pos) bones[bone] = { ...(rot ? { rot } : {}), ...(pos ? { pos } : {}) };
      }
      const out = path.join(OUT, `${name}.json`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({ source: src, duration: clip.duration, bones }));
      index.push({ name, duration: Math.round(clip.duration * 1000) / 1000 });
    } catch (e) {
      failed++;
      console.warn(`  ${rel} FAILED ${e.message}`);
    }
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    `--- pet clips: ${index.length} written to ${OUT}, ${skipped} additive skipped, ${failed} failed`,
  );
}

main();
