// CS2's own vanity scenes, turned into viewer environments.
//
// WHAT A VANITY MAP IS. Alongside every playable map, CS2 ships a small
// `<map>_vanity.vpk` — the diorama it shows behind your character and your
// items in the loadout screens. It is not a screenshot and not a cut-down
// level: it is a real scene with the map's own geometry, its own baked
// lighting, its own light bars, and a set of markers saying where things go —
//
//   csgo_item_previewmodel      where an ITEM is displayed. Our capture point.
//   csgo_player_previewmodel    where the agent stands.
//   point_camera_vertical_fov   the game's own cameras, with FOV and DOF.
//   light_bar / light_environment / post_processing_volume
//
// So the environment a weapon should be lit by is not something to invent. It
// is the light at that marker, in that scene, and this pulls both out:
//
//   1. the world, as a glTF (`world.vwrld_c` → GLB, materials and all)
//   2. the marker, out of the entity lump
//
// The GLB is a SOURCE, not a deliverable — they run 10-90MB, and one of them is
// bigger than every other asset this app ships put together. It stays in the
// work directory and the browser never sees it; `tools/shadertest/envbake.ts`
// renders it once into a panorama, and the panorama is what ships.
//
// UNITS, MEASURED OFF THE EXPORT ITSELF rather than assumed. Every world node
// comes out under this matrix (columns):
//
//     (0, 0, 0.0254) (0.0254, 0, 0) (0, 0.0254, 0)
//
// which is inches → metres with the axes ROTATED, not merely Z-up → Y-up:
//
//     world = (y, z, x) × 0.0254
//
// Guessing `(x, z, -y)` — the usual Source-to-glTF swap — put the capture point
// a mirrored 44m from the scene, and every face of the probe came back black.
// The check that settled it: a mesh's own bounding sphere, pushed through its
// `matrixWorld`, against the same sphere in local space.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// The CLI lives under the extractor's WORK dir (EXTRACT_WORK_DIR in the pod
// spec), not under /app — same resolution as extract-viewmodel-anims.mjs.
const CLI =
  process.env.CLI ??
  path.join(process.env.WORK_DIR ?? process.env.EXTRACT_WORK_DIR ?? "/cs2-models/.work", "cs2-model-extract/cli/Source2Viewer-CLI");
const MAPS = process.env.MAPS ?? "/cs2-game/game/csgo/maps";
const PAK = process.env.PAK ?? "/cs2-game/game/csgo/pak01_dir.vpk";
/** Panoramas ship from here. */
const OUT = process.env.OUT ?? "/cs2-models/anims/env";
/** The GLBs do not — see above. */
const WORK = process.env.WORK ?? "/cs2-models/.work/envsrc";

const INCH = 0.0254;

/** Pretty name for a map stem: `de_mirage` → "Mirage", `ar_baggage` → "Baggage". */
const label = (stem) =>
  stem
    .replace(/^(de|cs|ar)_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Pull `classname`-keyed blocks out of a decompiled entity lump.
 *
 * The dump is a flat KV listing per entity separated by `====N====` rulers, so
 * this splits on those and keeps the ones that name the class asked for.
 */
/**
 * The camera the GAME frames a weapon with, in this scene.
 *
 * Every vanity map ships `point_camera_vertical_fov` entities named for what
 * they shoot — `[PR#]cam_weapon_ak47_zoom`, `cam_weapon_awp_zoom`,
 * `cam_gloves`, `cam_char_inspect_wide` — each with its own position, angles,
 * vertical FOV and depth-of-field distances. That is the shot CS2 puts an item
 * in, and it is a far better backdrop than a slice of a panorama: it is framed,
 * it is at the right distance, and it renders at full resolution because it is
 * rendered as a PICTURE rather than sampled out of a sphere.
 *
 * Its DoF numbers are worth keeping too: `dof_far_crisp 150` / `dof_far_blurry
 * 200` are Source units — 3.8m and 5.1m. In game, everything past about five
 * metres behind the weapon is fully out of focus.
 */
function plateCamera(text) {
  const blocks = text.split(/====\d+====/);
  const named = (re) =>
    blocks.find((b) => re.test(b) && /classname\s+"point_camera_vertical_fov"/.test(b));
  // A rifle camera first: it frames a long weapon, so it holds the whole item
  // area. Then the generic character inspect, then anything at all.
  const b =
    named(/targetname\s+"\[PR#\]cam_weapon_(ak47|m4a1|awp|aug|sg556)_zoom"/i) ??
    named(/targetname\s+"\[PR#\]cam_weapon_[a-z0-9_]+_zoom"/i) ??
    named(/targetname\s+"\[PR#\]cam_char_inspect_wide"/i) ??
    named(/classname\s+"point_camera_vertical_fov"/);
  if (!b) return null;
  const num = (k) => {
    const m = new RegExp(`^\\s*${k}\\s+"?([-0-9. ]+)"?`, "m").exec(b);
    return m ? m[1].trim().split(/\s+/).map(Number) : null;
  };
  const at = num("origin");
  const ang = num("angles");
  if (!at || !ang) return null;
  const name = /targetname\s+"([^"]+)"/.exec(b)?.[1] ?? "";
  // Source angles are (pitch, yaw, roll) about a Z-up frame; the export is
  // `world = (y, z, x) × 0.0254`, so the forward vector is built there and
  // permuted the same way every other coordinate here is.
  const [pitch, yaw] = ang;
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  const fwd = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
  return {
    name,
    at: [at[1] * INCH, at[2] * INCH, at[0] * INCH],
    dir: [fwd[1], fwd[2], fwd[0]],
    fov: num("verticalfov")?.[0] ?? 35,
    dofCrisp: (num("dof_far_crisp")?.[0] ?? 150) * INCH,
    dofBlurry: (num("dof_far_blurry")?.[0] ?? 200) * INCH,
  };
}

function entities(text, classname) {
  return text
    .split(/====\d+====/)
    .filter((b) => new RegExp(`classname\\s+"${classname}"`).test(b))
    .map((b) => {
      const num = (k) => {
        const m = new RegExp(`^\\s*${k}\\s+"?([-0-9. ]+)"?`, "m").exec(b);
        return m ? m[1].trim().split(/\s+/).map(Number) : null;
      };
      return { origin: num("origin"), angles: num("angles"), scales: num("scales") };
    });
}

/**
 * THE SKY, WITHOUT DECODING IT.
 *
 * Each vanity scene names its sky in the entity lump —
 * `skyname "materials/skybox/sky_de_mirage.vmat"` — and the texture behind it
 * is a BC6H cube that this CLI cannot decode (it throws on every cube it is
 * asked for). It does not have to: the texture's own header carries
 * `VTEX_EXTRA_DATA_CUBEMAP_RADIANCE_SH`, 27 numbers that ARE the sky as
 * spherical harmonics — nine coefficients per channel, precomputed by Valve,
 * in HDR.
 *
 * That is exactly what a sky contributes to a scene like this: a smooth
 * gradient of the right colours in the right directions. The bake evaluates
 * them for every direction it renders, so a scene whose world export has no sky
 * geometry stops coming out with a blown white dome over it.
 *
 * Read out of the CLI's own printed header rather than by parsing the binary:
 * the numbers are already decoded there, and this runs once per map.
 */
function skyHarmonics(vpk, stem, lump, tmp) {
  // Two spellings in the wild, sometimes both in one lump: a bare
  // `skyname "sky_day01_01"` (the engine default) and the scene's real one,
  // which may or may not be wrapped in `resource_name:`. Take the last full
  // path — the specific one always follows the default.
  const paths = [...lump.matchAll(/skyname\s+(?:resource_name:)?"materials\/skybox\/([a-z0-9_]+)\.vmat"/gi)];
  const named = paths.length ? paths[paths.length - 1][1] : null;
  if (!named) return null;
  // The texture's filename carries a content hash, so it has to be found rather
  // than constructed.
  let found;
  try {
    const list = execFileSync(CLI, ["-i", PAK, "--vpk_dir"], { encoding: "utf8", maxBuffer: 1 << 28 });
    found = new RegExp(`materials/skybox/${named}_[a-z0-9_]+\\.vtex_c`, "i").exec(list)?.[0];
  } catch {
    return null;
  }
  if (!found) {
    // The texture does not always share the material's name — `cs_office_45_0`
    // is a sky material whose texture is called something else entirely. The
    // material's own external-reference list says which, so ask it rather than
    // guessing at filenames.
    try {
      const rerl = execFileSync(CLI, ["-i", PAK, "--vpk_filepath", `materials/skybox/${named}.vmat_c`, "-b", "RERL"], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      const tex = /([a-z0-9_\/]+\.vtex)/i.exec(rerl)?.[1];
      if (tex) {
        const list = execFileSync(CLI, ["-i", PAK, "--vpk_dir"], { encoding: "utf8", maxBuffer: 1 << 28 });
        const base = tex.replace(/\.vtex$/, "");
        found = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:_[a-z0-9]+)?\\.vtex_c`, "i").exec(list)?.[0];
      }
    } catch {
      /* fall through to no sky */
    }
  }
  if (!found) return null;
  try {
    const head = execFileSync(CLI, ["-i", PAK, "--vpk_filepath", found, "-b", "DATA"], { encoding: "utf8", maxBuffer: 1 << 26 });
    const sh = /RADIANCE_SH[\s\S]*?\[\s*\d+ coefficients:([^\]]+)\]/.exec(head)?.[1];
    if (!sh) return null;
    const nums = sh.split(",").map((n) => Number(n.trim()));
    if (nums.length !== 27 || nums.some((n) => !Number.isFinite(n))) return null;
    void tmp;
    void stem;
    void vpk;
    return { sky: named, sh: nums };
  } catch {
    return null;
  }
}

function extract(vpk, filepath, out, extra = []) {
  execFileSync(CLI, ["-i", vpk, "--vpk_filepath", filepath, "-o", out, "-d", ...extra], { stdio: "pipe" });
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const packs = fs
    .readdirSync(MAPS)
    .filter((f) => f.endsWith("_vanity.vpk"))
    .map((f) => ({ stem: f.replace(/_vanity\.vpk$/, ""), vpk: path.join(MAPS, f) }))
    .filter((m) => !only || m.stem === only);

  const index = [];
  for (const { stem, vpk } of packs) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `env-${stem}-`));
    const glb = path.join(WORK, `${stem}.glb`);
    try {
      // The world, once. Skipped when it is already here: these take minutes
      // and tens of megabytes each, and nothing about them changes between
      // runs of this script.
      if (!fs.existsSync(glb)) {
        extract(vpk, `maps/${stem}_vanity/world.vwrld_c`, tmp, ["--gltf_export_format", "glb", "--gltf_export_materials"]);
        const built = path.join(tmp, "maps", `${stem}_vanity`, "world.glb");
        if (!fs.existsSync(built)) throw new Error("no world.glb came out");
        fs.renameSync(built, glb);
      }

      // The markers.
      extract(vpk, `maps/${stem}_vanity/entities/default_ents.vents_c`, tmp);
      const lump = fs.readFileSync(path.join(tmp, "maps", `${stem}_vanity`, "entities", "default_ents.vents"), "utf8");
      const items = entities(lump, "csgo_item_previewmodel");
      const players = entities(lump, "csgo_player_previewmodel");
      const cams = entities(lump, "point_camera_vertical_fov");
      // THE MEDIAN MARKER, NOT THE FIRST ONE.
      //
      // A scene has eight `csgo_item_previewmodel` markers and they are not
      // interchangeable: on Nuke seven sit 1.3m up (where an item is held) and
      // the first sits flat on the floor. Taking the first put the camera in
      // the ground — the bake came out with the hangar above and open sky
      // below, because half the sphere was under the floor where the scene has
      // nothing at all. A per-axis median lands on the cluster and ignores the
      // odd one out, whichever index it happens to be.
      //
      // Falls back to where the agent stands, then to a camera, so a scene that
      // names its markers differently still yields a defensible point rather
      // than the world origin (which in these scenes is outside the room).
      const median = (rows) => {
        const pts = rows.map((r) => r.origin).filter((o) => o?.length === 3);
        if (!pts.length) return null;
        return [0, 1, 2].map((i) => {
          const col = pts.map((p) => p[i]).sort((a, b) => a - b);
          return col[Math.floor(col.length / 2)];
        });
      };
      const at = median(items) ?? median(players) ?? median(cams);
      if (!at) throw new Error("no preview marker in the entity lump");

      // The sun, as the scene states it: pitch/yaw/roll in degrees.
      const sun = entities(lump, "light_environment")[0]?.angles ?? null;
      const sky = skyHarmonics(vpk, stem, lump, tmp);
      const entry = {
        map: stem,
        label: label(stem),
        // Y-up metres, ready to hand to three — see the units note above.
        capture: [at[1] * INCH, at[2] * INCH, at[0] * INCH],
        /** The marker as the game states it, for anyone re-deriving the axes. */
        source: at,
        yaw: items[0]?.angles?.[1] ?? 0,
        /** Every item marker, for anyone checking the median against them. */
        itemOrigins: items.map((i) => i.origin).filter(Boolean),
        markers: { item: items.length, player: players.length, camera: cams.length },
        sun,
        plate: plateCamera(lump),
        ...(sky ?? {}),
        glb: `${stem}.glb`,
      };
      index.push(entry);
      console.log(
        `${stem.padEnd(18)} capture ${entry.capture.map((n) => n.toFixed(2)).join(",")}  ` +
          `sky ${sky ? sky.sky : "NONE"}  cam ${plateCamera(lump)?.name ?? "NONE"}  ` +
          `glb ${(fs.statSync(glb).size / 1e6).toFixed(0)}MB`,
      );
    } catch (e) {
      console.warn(`${stem.padEnd(18)} FAILED ${e.message}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  index.sort((a, b) => a.label.localeCompare(b.label));
  fs.writeFileSync(path.join(WORK, "index.json"), JSON.stringify(index, null, 1));
  console.log(`\n${index.length} vanity scenes -> ${WORK}/index.json`);
}

main();
