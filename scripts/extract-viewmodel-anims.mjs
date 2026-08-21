// Extract CS2's per-weapon FIRST-PERSON inspect animations.
//
// These are the clips that make a first-person view worth having, and they are
// not in any file the model extraction touches. A weapon's `.vmdl_c` declares
// five world-model sequences and none of them moves — `inventory_inspect` is a
// single keyframe. The real animation lives in
// `animation/anims/viewmodel/<family>/<weapon>/lookat01_<name>.vnmclip_c`
// ("lookat" is CS2's word for inspect; the clip's own sync events are
// `WPN_INSPECT_LOOP` / `WPN_INSPECT_OUTRO`).
//
// ONE CLIP DRIVES ARMS AND WEAPON TOGETHER — `wpn`/`wpnEnd`/`wpnTip` alongside
// `arm_upper_R`/`hand_R`/`finger_*` — which is why the gun can be animated
// rather than parented to a hand and hoped for. Arm and finger bone names match
// the glove GLBs exactly, so a track retargets by name with no solve.
//
// Usage:
//   node scripts/extract-viewmodel-anims.mjs \
//     --vpk /cs2-game/game/csgo/pak01_dir.vpk \
//     --cli /app/cs2-model-extract/cli/Source2Viewer-CLI \
//     --models /cs2-models/models \
//     --out /cs2-models/anims
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readClip } from "../tools/nmclip.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const VPK = arg("vpk", "/cs2-game/game/csgo/pak01_dir.vpk");
const CLI = arg("cli", "/app/cs2-model-extract/cli/Source2Viewer-CLI");
const MODELS = arg("models", "/cs2-models/models");
const OUT = arg("out", "/cs2-models/anims");
const ONLY = arg("only", null);

/**
 * Our model stem → CS2's viewmodel clip folder.
 *
 * Only the ones a rule cannot derive. Everything else is found by trying
 * `<family>_<stem>` across the three families, which covers the majority — the
 * table is for where Valve's animation name and the model name diverge, and
 * every entry here is a case that would otherwise silently fall back to the
 * family default and animate with the wrong hands.
 */
const FOLDER = {
  ak47: "rifle/rifle_ak",
  // Our `m4a1` IS the M4A4 (the model kept its old name); the M4A1-S has no
  // viewmodel clips of its own and borrows the M4A4's.
  m4a1: "rifle/rifle_m4a4",
  m4a1_silencer: "rifle/rifle_m4a4",
  glock: "pistol/pistol_glock18",
  hkp2000: "pistol/pistol_hkp2000",
  // The USP-S ships no clip folder; the P2000 is its same-slot sibling and the
  // hands hold the two identically.
  usp_silencer: "pistol/pistol_hkp2000",
  knife_m9_bayonet: "knife/knife_m9",
  knife_survival_bowie: "knife/knife_bowie",
  knife_gypsy_jackknife: "knife/knife_navaja",
  knife_widowmaker: "knife/knife_talon",
  knife_t: "knife/knife_default_t",
  knife_butterfly: "knife/knife_butterfly",
  bayonet: "knife/knife_bayonet",
  taser: "pistol/pistol_taser",
};

/** Family fallbacks, for a weapon whose own folder has no inspect. */
const DEFAULT_FOLDER = {
  knife: "knife/_default_knife",
  pistol: "pistol/_default_pistol",
  rifle: "rifle/_default_rifle",
};

/** Variants that are NOT the plain looping inspect. */
const NOT_THE_LOOP = /_(draw|transfix|lgcy)_|_lgcy\./;

/**
 * The actions a viewmodel can play, in the order a UI would list them.
 *
 * IDLE IS THE DEFAULT and that matters: an inspect holds the weapon up and
 * turned, which is a terrible resting pose — the gun fills the frame and reads
 * as broken framing. The game rests on `idle` and plays the rest on demand, and
 * so does every viewer worth copying.
 *
 * `fire` is `shoot1_*` rather than `shoot_*`: the numbered one is the primary
 * shot, and the unnumbered name does not exist in this tree.
 */
const ACTIONS = [
  { key: "idle", match: (f) => /\/idle_/.test(f) },
  { key: "inspect", match: (f) => f.includes("/lookat01_") && !NOT_THE_LOOP.test(f) },
  { key: "draw", match: (f) => /\/draw_/.test(f) },
  { key: "reload", match: (f) => /\/reload_/.test(f) },
  { key: "fire", match: (f) => /\/shoot1?_/.test(f) },
];

let VPK_ALL = null;
function vpkAll() {
  if (VPK_ALL) return VPK_ALL;
  const out = execFileSync(CLI, ["-i", VPK, "--vpk_dir"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  VPK_ALL = out.split("\n").map((l) => l.split(" ")[0]);
  return VPK_ALL;
}
function vpkList() {
  return vpkAll().filter((p) => p.endsWith(".vnmclip_c"));
}

/**
 * Pick the inspect clip inside a folder.
 *
 * DISCOVERED, not derived. The suffix is usually the folder minus its family
 * prefix, but `pistol_glock18` ships `lookat01_glock` and `pistol_hkp2000`
 * ships `lookat01_hkp` — so a rule would quietly miss two weapons and a table
 * of suffixes would be one more thing to keep in step with Valve.
 */
function actionsIn(clips, folder) {
  const prefix = `animation/anims/viewmodel/${folder}/`;
  const here = clips.filter((c) => c.startsWith(prefix));
  const out = {};
  for (const a of ACTIONS) {
    const hit = here.find((c) => a.match(c));
    if (hit) out[a.key] = hit;
  }
  return out;
}

/** Which family a model stem belongs to, for the fallback. */
function familyOf(stem) {
  if (/^knife|^bayonet/.test(stem)) return "knife";
  if (/^(glock|usp|p250|deagle|elite|fiveseven|tec9|cz75a|revolver|hkp2000|taser)/.test(stem)) return "pistol";
  return "rifle";
}

function folderFor(stem, clips) {
  if (FOLDER[stem]) return FOLDER[stem];
  const fam = familyOf(stem);
  const guess = `${fam}/${fam}_${stem.replace(/^knife_/, "")}`;
  if (clips.some((c) => c.startsWith(`animation/anims/viewmodel/${guess}/`))) return guess;
  return DEFAULT_FOLDER[fam];
}

/**
 * Collapse a track that never changes to a single key.
 *
 * Most bones in an inspect only ROTATE — the skeleton's proportions do not
 * change, so every position track is 100+ identical keys. Storing them is the
 * difference between a clip that is hundreds of kilobytes and one that is tens.
 */
function compact(t, epsilon) {
  if (!t) return undefined;
  const { times, values } = t;
  if (!times.length || !values.length) return undefined;
  // VALUES ARE TUPLES, not a flat run of numbers: the DMX reader hands back one
  // `[x,y,z,w]` (or `[x,y,z]`) per key. Treating them as flat made every
  // comparison `array - number`, i.e. NaN, which is never greater than epsilon —
  // so every track "never moved" and a 138-key inspect collapsed to a single
  // pose. It extracted cleanly and produced a 3KB file that animated nothing.
  const first = values[0];
  const width = first.length;
  let moves = false;
  for (let i = 1; i < values.length && !moves; i++) {
    for (let k = 0; k < width; k++) {
      if (Math.abs(values[i][k] - first[k]) > epsilon) {
        moves = true;
        break;
      }
    }
  }
  const round = (v) => Math.round(v * 1e4) / 1e4;
  if (!moves) return { v: first.map(round) };
  return {
    t: Array.from(times, (x) => Math.round(x * 1e4) / 1e4),
    // Flattened on the way OUT — one array of numbers is a third the JSON of
    // nested pairs, and the consumer wants a flat buffer anyway.
    v: values.flatMap((tuple) => tuple.map(round)),
  };
}

/**
 * Our model stem → the game's sound folder and fire file, where a rule cannot
 * derive them. The rest resolve as `sounds/weapons/<stem>/<stem>_01` (or `-1`).
 * Every entry here is a real divergence found by listing the VPK — `glock`'s
 * sounds live under `glock18`, the silenced USP under `usp`, the dual Berettas
 * fire as `elites_01`, the Revolver as `revolver-1_01` — and a wrong guess is
 * silent: the action plays with no sound rather than failing.
 */
const SOUND = {
  glock: { dir: "glock18", fire: "glock_01" },
  usp_silencer: { dir: "usp", fire: "usp_01" },
  m4a1_silencer: { dir: "m4a1", fire: "m4a1_silencer_01" },
  mp5sd: { dir: "mp5", fire: "mp5_01" },
  galilar: { dir: "galilar", fire: "galil_01" },
  elite: { dir: "elite", fire: "elites_01" },
  cz75a: { dir: "cz75a", fire: "cz75_01" },
  revolver: { dir: "revolver", fire: "revolver-1_01" },
  taser: { dir: "taser", fire: "taser_shoot" },
  tec9: { dir: "tec9", fire: "tec9_02" },
  ump45: { dir: "ump45", fire: "ump45_02" },
};
/** Knives share one folder, and have no shot. */
const KNIFE_SOUND = { dir: "knife", fire: null, draw: "knife_deploy1", inspect: "knife_inspect_turn_01" };

/**
 * The clip's own sound cues, from the .vnmclip the CLI writes beside the DMX.
 *
 * Times are in FRAMES at the clip's rate. The event names are sound EVENTS
 * (`Weapon_AK47.Clipout`), which the game resolves through its soundevents
 * tables; the suffix after the dot is enough to pick the file by name from the
 * weapon's folder, and that is what this does. `WeaponMove*` is the generic
 * cloth foley under sounds/weapons/movement*.
 */
function clipCues(vnmclipPath, fps, soundFiles, dir, fallbackDir) {
  let text;
  try {
    text = fs.readFileSync(vnmclipPath, "utf8");
  } catch {
    return [];
  }
  const re = /_class = "CNmClipDocEvent_Sound"[\s\S]*?m_flStartTime = ([0-9.]+)[\s\S]*?m_name = "([^"]+)"/g;
  const cues = [];
  let m;
  while ((m = re.exec(text))) {
    const frame = Number(m[1]);
    const event = m[2].split(".").pop() ?? "";
    const file = resolveCue(event, soundFiles, dir, fallbackDir);
    if (file) cues.push({ t: +(frame / fps).toFixed(4), file });
  }
  return cues;
}

/** Event suffix → a file stem in the weapon's folder, or a shared one. */
function resolveCue(event, soundFiles, dir, fallbackDir) {
  const mv = /^WeaponMove(\d)$/.exec(event);
  if (mv) return `_shared/movement${mv[1]}`;
  const want = event.toLowerCase().replace(/_q$/, "");
  // Synonyms, in preference order: Valve names the bolt by what it does on
  // that weapon — pull, back, slide — and the event always says BoltPull.
  const ALIASES = {
    boltpull: ["boltpull", "boltback", "slideback", "sliderelease", "boltforward"],
    clipin: ["clipin", "leftclipin", "rightclipin", "clip_in"],
    clipout: ["clipout", "clip_out"],
    addammo: ["addammo", "cliphit"],
    draw: ["draw", "deploy"],
  };
  const keys = ALIASES[want] ?? [want];
  for (const d of [dir, fallbackDir]) {
    if (!d) continue;
    const inDir = soundFiles.filter((f) => f.startsWith(`sounds/weapons/${d}/`)).map((f) => f.slice(f.lastIndexOf("/") + 1, -".vsnd_c".length));
    for (const k of keys) {
      const hits = inDir.filter((n) => n.toLowerCase().includes(k));
      if (!hits.length) continue;
      // Prefer the plain or _01 take.
      hits.sort((a, b) => (/_0?1$/.test(b) ? 1 : 0) - (/_0?1$/.test(a) ? 1 : 0) || a.length - b.length);
      return `${d}/${hits[0]}`;
    }
  }
  return null;
}

/**
 * Trim the tail and fold to mono, keeping the rate.
 *
 * The game's shots are 44.1kHz stereo 16-bit with a couple of seconds of room
 * tail below hearing — 430KB for a quarter-second bang. No ffmpeg in the pod,
 * so this is done by hand: walk the RIFF chunks (not a 44-byte header
 * assumption — the CLI writes a LIST chunk first), average the channels, cut
 * where the signal last rises above -48dB plus a little, and write it back as
 * a plain 16-bit mono WAV. Web Audio decodes that everywhere.
 */
function trimWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const len = buf.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === "data") data = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) return null;
  const frames = data.length / (2 * fmt.ch);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.ch; c++) acc += data.readInt16LE((i * fmt.ch + c) * 2);
    mono[i] = acc / fmt.ch;
  }
  const thresh = 32768 * 0.004; // -48dB
  let last = frames - 1;
  while (last > 0 && Math.abs(mono[last]) < thresh) last--;
  const keep = Math.min(frames, last + Math.round(fmt.rate * 0.04));
  const out = Buffer.alloc(44 + keep * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + keep * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(fmt.rate, 24);
  out.writeUInt32LE(fmt.rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(keep * 2, 40);
  for (let i = 0; i < keep; i++) out.writeInt16LE(mono[i], 44 + i * 2);
  return out;
}

/**
 * Decompile one vsnd to `<outBase>.<ext>`. Returns the extension, or null.
 *
 * TWO FORMATS COME OUT OF THE SAME CONTAINER. A vsnd carries either PCM
 * (`m_nFormat = "PCM16"`) or MP3, and the CLI writes .wav or .mp3 accordingly.
 * The shots are PCM; most of the foley — mag out, mag in, bolt, draw — is MP3,
 * a few KB each. The first pass looked only for .wav and silently lost 99 of
 * 238 cues. MP3 is kept as-is (it is already small and Web Audio decodes it);
 * PCM is trimmed and folded to mono.
 *
 * Idempotent across weapons: knives, the two M4s and the two USPs share folders,
 * so a file already written is reported rather than redone.
 */
function extractSound(vsndPath, outBase, tmp) {
  for (const e of ["wav", "mp3"]) if (fs.existsSync(`${outBase}.${e}`)) return e;
  try {
    execFileSync(CLI, ["-i", VPK, "--vpk_filepath", vsndPath, "-o", tmp, "-d"], { stdio: "pipe" });
    const base = path.join(tmp, vsndPath.replace(/\.vsnd_c$/, ""));
    fs.mkdirSync(path.dirname(outBase), { recursive: true });
    if (fs.existsSync(`${base}.mp3`)) {
      fs.copyFileSync(`${base}.mp3`, `${outBase}.mp3`);
      return "mp3";
    }
    if (fs.existsSync(`${base}.wav`)) {
      const trimmed = trimWav(fs.readFileSync(`${base}.wav`));
      if (!trimmed) return null;
      fs.writeFileSync(`${outBase}.wav`, trimmed);
      return "wav";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Rate of fire, straight from the game.
 *
 * `scripts/weapons.vdata_c` decompiles to KV3 with one block per weapon —
 * `weapon_ak47 = { ... m_flCycleTime = [ 0.1, 0.3 ] ... m_bIsFullAuto = true }`
 * — and the block names match our model stems as `weapon_<stem>` throughout
 * (Valve's own naming already calls the M4A4 `weapon_m4a1`, which is exactly
 * the quirk our stems inherited). The first cycle time is the primary fire.
 */
function readWeaponData(tmp) {
  const out = new Map();
  try {
    execFileSync(CLI, ["-i", VPK, "--vpk_filepath", "scripts/weapons.vdata_c", "-o", tmp, "-d"], { stdio: "pipe" });
    const text = fs.readFileSync(path.join(tmp, "scripts/weapons.vdata"), "utf8");
    // One `\tname =\n\t{ … \n\t}` block per weapon AND per prefab, flat — the
    // nesting is expressed by `_base = "weapon_ak47_prefab"` rather than by
    // containment, so inheritance is a lookup chain (below), not a tree walk.
    const blocks = new Map();
    const re = /^\t([A-Za-z0-9_]+) =\s*\n\t\{\n([\s\S]*?)\n\t\}/gm;
    let m;
    while ((m = re.exec(text))) blocks.set(m[1], m[2]);

    // SCALAR ON A WEAPON, ARRAY ON A PREFAB. `weapon_ak47` says
    // `m_flCycleTime = 0.1`; the `primary` prefab it descends from says
    // `[ 0.15, 0.3 ]` (primary and secondary fire). Reading only the array form
    // found 42 prefabs and not one actual weapon.
    const field = (name, key) => {
      for (let n = name, hops = 0; n && hops < 8; hops++) {
        const body = blocks.get(n);
        if (!body) return null;
        const v = new RegExp(`${key}\\s*=\\s*(?:\\[\\s*)?([A-Za-z0-9.]+)`).exec(body);
        if (v) return v[1];
        n = (/_base = "([^"]+)"/.exec(body) ?? [])[1];
      }
      return null;
    };
    for (const name of blocks.keys()) {
      if (!name.startsWith("weapon_") || name.endsWith("_prefab")) continue;
      const cycle = field(name, "m_flCycleTime");
      if (cycle == null || !(+cycle > 0)) continue;
      out.set(name, { cycle: +(+cycle).toFixed(4), auto: field(name, "m_bIsFullAuto") === "true" });
    }
  } catch (e) {
    console.warn(`  weapons.vdata FAILED ${e.message} — fire will use the runtime default`);
  }
  return out;
}

/** The three effect textures the muzzle flash is built from. */
const FX = {
  muzzleflash1: "materials/effects/muzzleflash1_color_tga_b013e2bc.vtex_c",
  muzzleflash2: "materials/effects/muzzleflash2_color_tga_51367e8d.vtex_c",
  smokesprites0001: "materials/particle/smokesprites0001_color_tga_1d1f0542.vtex_c",
};

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const clips = vpkList();
  const stems = fs
    .readdirSync(MODELS)
    .filter((f) => f.endsWith(".glb") && !/^kc_|_physics\.glb$|gloves|handwrap/.test(f))
    .map((f) => f.replace(/\.glb$/, ""))
    .filter((s) => !ONLY || s === ONLY);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vmanim-"));
  const index = {};
  let ok = 0;
  let failed = 0;
  const soundFiles = vpkAll().filter((p) => p.startsWith("sounds/weapons/") && p.endsWith(".vsnd_c"));
  const weaponData = readWeaponData(tmp);
  console.log(`weapons.vdata: ${weaponData.size} weapons with cycle times`);

  // THE GAME'S OWN UI ICONS, once.
  //
  // `panorama/images/icons/equipment/` is the buy-menu / kill-feed set: one
  // silhouette per weapon and knife, named by the SAME stems our models use
  // (ak47, aug, knife_karambit…), plus `clothing_hands` for the gloves. They
  // decompile from `.vsvg_c` to plain SVG, so the whole set is a few hundred KB
  // and any of it can be shown next to an item anywhere in the app.
  //
  // The prolog, DOCTYPE, Illustrator comments and hard-coded white fills are
  // stripped: a glyph that inherits `currentColor` takes the colour of whatever
  // it sits in, and a white-filled one is invisible on a light surface.
  try {
    const icons = vpkAll().filter((p) => /^panorama\/images\/icons\/equipment\/[a-z0-9_]+\.vsvg_c$/i.test(p));
    fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
    const names = [];
    for (const src of icons) {
      const name = path.basename(src, ".vsvg_c");
      try {
        execFileSync(CLI, ["-i", VPK, "--vpk_filepath", src, "-o", tmp, "-d"], { stdio: "pipe" });
        const svg = fs
          .readFileSync(path.join(tmp, src.replace(/\.vsvg_c$/, ".svg")), "utf8")
          .replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, "")
          .replace(/\s*fill="(#fff(?:fff)?|#FFF(?:FFF)?|white)"/gi, "")
          // The root tag carries `fill="none"` and a fixed pixel width/height.
          // Both have to go, not just be preceded by better ones: a duplicate
          // attribute is resolved by the PARSER, not by the author, and a
          // hard-coded 32px icon cannot be sized by the page.
          .replace(/<svg\b[^>]*>/, (tag) =>
            tag
              .replace(/\s*fill="[^"]*"/gi, "")
              .replace(/\s*(?:width|height)="[^"]*"/gi, "")
              .replace(/<svg/, '<svg fill="currentColor"'),
          )
          .trim();
        fs.writeFileSync(path.join(OUT, "icons", `${name}.svg`), svg);
        names.push(name);
      } catch {
        /* an icon that will not decompile is not worth failing the run over */
      }
    }
    fs.writeFileSync(path.join(OUT, "icons", "index.json"), JSON.stringify(names.sort()));
    console.log(`icons: ${names.length} equipment glyphs -> ${path.join(OUT, "icons")}`);
  } catch (e) {
    console.warn(`  icons FAILED ${e.message}`);
  }

  // Effect textures, once.
  for (const [name, vtex] of Object.entries(FX)) {
    try {
      execFileSync(CLI, ["-i", VPK, "--vpk_filepath", vtex, "-o", tmp, "-d"], { stdio: "pipe" });
      const png = path.join(tmp, vtex.replace(/\.vtex_c$/, ".png"));
      fs.mkdirSync(path.join(OUT, "fx"), { recursive: true });
      fs.copyFileSync(png, path.join(OUT, "fx", `${name}.png`));
    } catch (e) {
      console.warn(`  fx ${name} FAILED ${e.message}`);
    }
  }
  // The shared cloth foley the clips call WeaponMove1..4.
  const SHARED_EXT = new Map();
  for (const n of [1, 2, 3, 4]) {
    const e = extractSound(`sounds/weapons/movement${n}.vsnd_c`, path.join(OUT, "sfx", "_shared", `movement${n}`), tmp);
    if (e) SHARED_EXT.set(`_shared/movement${n}`, e);
  }

  for (const stem of stems) {
    const folder = folderFor(stem, clips);
    const found = folder ? actionsIn(clips, folder) : {};
    if (!Object.keys(found).length) {
      console.warn(`  ${stem.padEnd(24)} no clips (folder ${folder ?? "?"})`);
      failed++;
      continue;
    }
    const got = [];
    // Where this weapon's sounds live, and what it fires.
    const isKnife = familyOf(stem) === "knife";
    const snd = isKnife ? KNIFE_SOUND : (SOUND[stem] ?? { dir: stem, fire: null });
    if (!isKnife && !snd.fire) {
      const cand = soundFiles.map((f) => f.slice(f.lastIndexOf("/") + 1, -".vsnd_c".length)).filter((n) => soundFiles.some((f) => f === `sounds/weapons/${snd.dir}/${n}.vsnd_c`));
      snd.fire = cand.find((n) => n === `${stem}_01`) ?? cand.find((n) => n === `${stem}-1`) ?? cand.find((n) => new RegExp(`^${stem}[-_]0?1$`).test(n)) ?? null;
    }
    const wanted = new Set();
    /** Actions decoded this pass; written once their sounds' formats are known. */
    const pending = [];
    for (const [action, clipPath] of Object.entries(found)) {
      try {
        execFileSync(CLI, ["-i", VPK, "--vpk_filepath", clipPath, "-o", tmp, "-d"], { stdio: "pipe" });
        const dmx = path.join(tmp, clipPath.replace(/_c$/, "").replace(/\.vnmclip$/, ".dmx"));
        const clip = readClip(fs.readFileSync(dmx));
        // Sound cues: the clip's own, plus the shot itself on fire — the game
        // triggers that from code, not from the animation.
        const vnm = path.join(tmp, clipPath.replace(/_c$/, ""));
        const cues = clipCues(vnm, clip.frameRate || 30, soundFiles, snd.dir, isKnife ? null : "knife");
        if (action === "fire" && snd.fire) cues.unshift({ t: 0, file: `${snd.dir}/${snd.fire}` });
        if (action === "draw" && isKnife && snd.draw && !cues.length) cues.push({ t: 0, file: `knife/${snd.draw}` });
        for (const c of cues) wanted.add(c.file);
        const bones = {};
        for (const [name, tr] of Object.entries(clip.bones)) {
          const rot = compact(tr.rot, 1e-4);
          const pos = compact(tr.pos, 1e-3);
          if (rot || pos) bones[name] = { ...(rot ? { rot } : {}), ...(pos ? { pos } : {}) };
        }
        pending.push({ action, clipPath, duration: clip.duration, parents: clip.parents, bones, cues });
        got.push(`${action} ${clip.duration.toFixed(1)}s`);
      } catch (e) {
        console.warn(`  ${stem.padEnd(24)} ${action} FAILED ${e.message}`);
      }
    }
    // The sounds those cues name, under sfx/<dir>/, in whichever format the
    // game ships them. A cue whose sound could not be extracted is dropped
    // rather than left pointing at a 404.
    const ext = new Map();
    for (const file of wanted) {
      if (file.startsWith("_shared/")) {
        const e = SHARED_EXT.get(file);
        if (e) ext.set(file, e);
        continue;
      }
      const e = extractSound(`sounds/weapons/${file}.vsnd_c`, path.join(OUT, "sfx", file), tmp);
      if (e) ext.set(file, e);
    }
    for (const p of pending) {
      const sounds = p.cues.filter((c) => ext.has(c.file)).map((c) => ({ t: c.t, file: `${c.file}.${ext.get(c.file)}` }));
      const json = { source: p.clipPath, duration: p.duration, parents: p.parents, bones: p.bones, sounds };
      if (p.action === "fire") {
        const wd = weaponData.get(`weapon_${stem}`);
        if (wd) {
          json.cycle = wd.cycle;
          json.auto = wd.auto;
        }
      }
      // ONE FILE PER ACTION. All five in one payload is ~1.5MB a weapon and
      // most sessions play only the idle — this way the rest arrive when the
      // button is actually pressed.
      fs.writeFileSync(path.join(OUT, `${stem}.${p.action}.json`), JSON.stringify(json));
      (index[stem] ??= {})[p.action] = { duration: +p.duration.toFixed(4) };
    }
    if (got.length) {
      console.log(`  ${stem.padEnd(24)} ${got.join("  ")}  · ${ext.size} sounds`);
      ok++;
    } else failed++;
  }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nviewmodel anims: ${ok} extracted, ${failed} without a clip -> ${OUT}`);
}

main();
