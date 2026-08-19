#!/usr/bin/env bash
# Extract CS2 weapon models as TEXTURED .glb files using Source 2 Viewer's CLI
# (ValveResourceFormat). Run this ON the machine where CS2 is installed:
#
#   CS2_DIR="/path/to/Counter-Strike Global Offensive" ./scripts/extract-models.sh
#
# Output: cs2-models-glb.tar.gz — copy its contents into the plugin's
# public/models/ and restart dev:ui (or redeploy).
#
# In-cluster mode (the admin-triggered extraction Job): set OUT_DIR to the
# models mount (e.g. /cs2-models) — models land directly in $OUT_DIR/models
# and no tarball is produced. WORK_DIR points scratch space at an emptyDir.
#
# Windows: download cli-windows-x64.zip from
# https://github.com/ValveResourceFormat/ValveResourceFormat/releases and run
# the same Source2Viewer-CLI flags from step 2 in PowerShell.
set -euo pipefail

# ---- Pipeline version --------------------------------------------------------
# BUMP THIS whenever a change here makes previously-extracted output wrong or
# incomplete (new bundle files, changed packing, fixed anchors — anything a
# re-run would produce differently). The number is stamped into
# $DEST/extract-version.json at the end of a successful run; the backend
# compares that stamp against the version declared *in this script* and lights
# an orange dot on the panel's settings cog when the mount is behind. That's
# the whole contract — bump the line, and every deployment is told to re-run.
# v2 (2026-07-20): added g_tPosition + g_tSurface to the composite-input
# bundles. Styles 2 and 5 need them for the triplanar spray projection; without
# them those skins fall back to sampling the pattern in paint-UV space, which is
# the wrong space entirely.
# v3 (2026-07-20): v2 shipped INCOMPLETE — it wrote `surface` but silently
# dropped `position` on all 89 weapons, because the copy loop only accepted
# ".png" and g_tPosition is RGBA16161616F, which the CLI writes as .exr. The
# loop now probes real extensions and reports anything it fails to recover.
# v4 (2026-07-21): extracts econ item icons to <mount>/images (step 4). Item
# artwork used to come from a third-party CDN; it is now ours, so a mount
# without this step renders every tile blank rather than merely un-baked.
# v5 (2026-07-21): writes models/sticker-markup.json (step 3d) — the per-weapon
# sticker slot anchors, also previously read from that CDN. Without it sticker
# placement falls back to a silhouette guess in the wrong UV space.
# v6 (2026-07-21): extracts the paint chain to <mount>/paints (step 5) — the
# vcompmat/vmat JSON and their textures, the last thing that came from the CDN.
# Without it the compositor falls back to defaults and skins render white.
# v7 (2026-07-21): paint entry points restricted to the types that are actually
# composited (weapon/melee/glove). Stickers and patches are drawn as decals from
# their flat icon and never fetch a paint material, so following their 10,565
# vmats pulled in 6,245 textures nothing requests — 76% of the texture work.
# Paints also build in paints.next and swap in atomically, so a run no longer
# disturbs what is being served.
# v8 (2026-07-21): the graph walk now follows PLAIN-STRING resource references,
# not just typed `resource:` ones. Every skin names its template vmat as a bare
# string (m_strSpecificContainerMaterial), so no template was ever walked or
# written — the rewrite emitted a correct reference to a file that did not
# exist, and those skins rendered broken (Deagle | Blaze). Any mount built
# before this is missing every template vmat, which is why this bumps.
# v9 (2026-07-28): model textures are re-encoded to LOSSLESS webp and each .glb
# is rewritten to reference them (step 3a2). Byte-identical pixels, measured
# 18-36% smaller (avg ~25%) — an AK's colour map goes 15MB -> 10MB. A mount
# built before this still serves PNG and still works; it just ships ~25% more
# bytes on every first view of a weapon, which is why this bumps rather than
# being left to the next unrelated re-extraction.
# v10 (2026-07-28): v9's webp conversion silently produced PNG. ImageMagick
# takes the output format from the extension, and both converters write to
# "<name>.webp.tmp" first — ".tmp" is unrecognised, so it fell back to the input
# format and the rename dressed a PNG up as a .webp. Fixed with an explicit
# "webp:" prefix in BOTH places, which also fixes it for the PAINT textures,
# where it has been happening since those were introduced (v6) and is why
# /paints/textures is 3.4GB. Paint textures now encode LOSSLESS rather than the
# `-quality 90` that line asked for and never performed — see the note there;
# switching them to lossy now would change the pixels of all 2106 finishes.
# Measured: model textures -30%, paint textures -25%, no pixel changed.
# v12 (2026-07-28): two additions that sticker placement needs, both read from
# assets we already had and neither previously recovered.
#   - sticker-markup.json gains each slot's `region`: the authored placement
#     area, as triangle soup in offset space, from the vmdl's StickerMarkup
#     Polygons (which the parser used to skip). It is the only ground truth for
#     where a sticker may sit — cs2-lib's per-weapon bounds are a rectangle
#     drawn around it that overshoots by a third of the weapon on the M4A1-S, so
#     a drag clamped to the box named a UV that is nowhere on the unwrap and the
#     sticker silently stopped moving.
#   - sticker/patch materials are now entry points, and the walk takes exactly
#     ONE texture from them (`g_tSticker0`) before stopping — ~3.2k textures, not
#     the 6,245 their full chain drags in (see v7). That texture is what the game
#     draws; the icon we drew instead is 512x384 with the art inset and pushed to
#     one edge, so every sticker was squashed and hung above its own anchor.
# A mount built before this still works: the viewer falls back to the bounds box
# and to cropping the icon.
# v13 (2026-07-28): textures are encoded with `cwebp -exact`, not ImageMagick.
# IM's WebP writer ZEROES the RGB of fully-transparent texels. For a picture
# that is invisible; for these it is destruction, because the compositor samples
# colour channels independently of alpha and case hardening reads pattern.g as a
# ramp lookup coordinate. v10-v12 mounts render Glock | AXIA's slide as chrome
# instead of dark steel, and anything with an SFX/material mask over-shiny.
# Verified: cwebp -exact round-trips RGBA byte-identical, IM differs.
# v28 (2026-08-18): MUSIC KIT AUDIO (new step 5b -> <mount>/music). The one item
# type with no preview of any kind: a kit IS its sound, and you picked one by
# reading its name. `music_definitions` in items_game.txt names the sound folder
# per kit and Source2Viewer decodes `sounds/music/<name>/mainmenu.vsnd_c` STRAIGHT
# TO MP3 — no ffmpeg, no transcode step — so the only reason this did not exist
# was that nobody had read the mapping.
#
# The mapping is keyed by cs2-lib's `variantIndex`, NOT `definitionIndex`.
# definitionIndex is 1314 for every kit — it means "is a music kit", not which
# one — so keying on it resolves all 100 kits to one folder and every kit plays
# the same song. That is the whole trap in this step.
#
# ~3.5MB x 101 kits, roughly 350MB on the mount, served with byte ranges so a
# browser fetches only the seconds it plays (nginx does this natively;
# scripts/serve.mjs and serveAssetDir had to learn it). Deliberately NOT trimmed:
# a shorter clip is the thing that would have needed ffmpeg, and full fidelity
# costs nothing once the transport is honest about ranges.
#
# This bump is not free — EXTRACT_VERSION is also the card-bake and composite
# generation key, so every cached render is re-baked by it. It rides one anyway
# because the version IS the "your mount is behind, re-run" signal: without a
# bump a v27 mount looks current forever and no operator would ever run the step,
# so the audio would never appear on any deployment that is already up to date.
# v27 (2026-08-05): `liquid.metalMap` — csgo_simple_liquid's METALNESS, which is
# g_tColorA's ALPHA. The shader declares no metalness texture (which is why this
# was twice written off as "this shader has no metalness"), but the decompile
# splits metal from dielectric off g_tColorA.w the textbook way: the specular
# colour is mix(vec3(g_flReflectance), albedo, alpha) and the diffuse is scaled by
# (1 - alpha). VRF's glTF export writes the albedo RGB-only, so Charm | Butane
# Buddy's polished lighter case and hinge pin rendered as flat matte plastic.
# The albedo joins the paint chain as a bare texture so the alpha survives — and
# is deliberately NOT reused as the material's `map`, because three multiplies
# diffuseColor.a by it and every metal texel would go transparent in a snapshot.
# Verified: alpha is a clean binary mask, median 0 / p90 254, matching the case.
# v26 (2026-08-05): the liquid's REFRACTION and SPECULAR params —
# g_flGlassRefraction / g_flLiquidRefraction / g_flLiquidSurfaceRefraction,
# g_flRefractRoughnessMultiplier, g_flCubeRefract{Transparency,LiquidTransparency,
# Brightness}, plus g_flReflectance, the two specular strengths, transmissive and
# emissive (the last five extracted but not yet consumed — a param absent from the
# JSON is indistinguishable from one authored at 0, which is exactly how the
# roughness channel got written off for a whole session).
# These had been recorded as unimplementable without "a scene colour buffer we do
# not render", and that was simply WRONG: liquid_outer_combo12.glsl:707 samples
# the refracted ray out of g_tEnvironmentMap, a CUBEMAP ARRAY, and :1462 builds
# the liquid's own hard specular from the light constants. An environment map and
# one directional light is the whole requirement. That one wrong sentence is what
# four rounds of chasing smaller terms were downstream of — see BUTANE-BUDDY.md.
# It also retires the "metallic casing is a dropped channel" lead: this shader
# declares four textures (g_tColorA, g_tNormalA, g_tLiquidMask, g_tDroplets) and
# no metalness input of any kind, so the metal read IS the env reflection.
# v23 (2026-08-05): `liquid.roughMap` — csgo_simple_liquid's glass roughness,
# which the vmat carries only inside g_tNormalA's spare channel and VRF's glTF
# export drops (RGB only). Without it the vessel renders dead matte.
# v22 (2026-08-05): charm-shading.json gains `liquid` — the params of
# `csgo_simple_liquid.vfx`, the ONE shader a charm uses that is not
# csgo_weapon.vfx. Charm | Butane Buddy (kc_db_lighter) is the only item in the
# catalog on it, and it rendered as a pale teal blob: every red pixel of that
# charm is the shader's, not the texture's, so the glTF fallback showed the
# EMPTY glass and nothing else. Its `g_tLiquidMask` joins the paint chain the
# same way tint masks do (VRF's glTF exporter drops it — no PBR slot maps to it).
# The two params that make the charm worth a pattern rail at all are seed-driven:
#   g_flLiquidColorHueShift = lerp(0, 320, seed)              — a full hue sweep
#   g_flLiquidLevelHeight   = lerp(0.45, 0.8, frac(seed*100)) — the fill level
# Decompiled ground truth at tools/shadertest/groundtruth/liquid_outer_combo12.glsl
# (static combo 12 = S_OPAQUE_REFRACT + S_USE_TEST_VALUES) and _inner_combo8.
# v21 (2026-08-05): charm-shading.json gains `tintMask` (and `maskRoughness`),
# and the pattern grade stops applying to the whole charm. CS2 ends the grade
# with `mix(albedo, graded, g_tTintMask.r)` — decompiled and saved at
# tools/shadertest/groundtruth/weapon_tintmask.glsl — and 52 of the 81
# seed-driven keychain materials set it, so a pattern that should sweep a
# charm's shell was sweeping its face, its metal and its trim too. The masks
# themselves join the paint chain as bare textures (charm-textures.json): 58 of
# the 81 charms keep their art inside the GLB, which has no mask channel, so
# nothing on the chain reached them.
# Also fixes the dynamic-expression blob regex, which only matched VRF's INLINE
# `m_value = #[ … ]` and not the indented form it wraps longer expressions onto.
# 45 of 81 seed-driven materials were being dropped by that — every kc_db_*
# charm — so those charms looked identical at every pattern.
# v20 (2026-07-30): charm CLOTH SIMULATION (new step 3g -> <stem>.phys.json).
# A CS2 charm is a cloth softbody, not a pendulum. Every kc_*.vmdl_c has always
# carried a PHYS block whose m_pFeModel is a complete PhysFeModelDesc — Valve's
# FEM/position-based cloth description, simulated by vphysics2's CFeModel — and
# nothing ever read it. The viewer hung the charm off a hand-rolled one-particle
# verlet pendulum on a 4mm cord instead, every constant of it a guess, which is
# why charms read as a rigid blob on a string rather than a thing that swings and
# flexes. There is no authored fallback to prefer: the charm GLB's one "inspect"
# animation is a SINGLE static keyframe, so all charm motion in game comes out of
# this solver. 62 models, ~8KB each, fetched lazily per charm.
# Units need no conversion — see the step comment. Cheap to re-run on its own
# (ONLY_STEPS=charm-physics), but it rides a version bump because it changes what
# a charm looks like in a card bake.
# v19 (2026-07-30): FOUR cosmetic types gain their assets in one run — batched
# deliberately, because each bump re-bakes every card and rerunning this four
# times over is hours of the operator's day.
#
#  1. STICKER TEXTURES (step 5, STICKER_TEXTURES). Sticker materials contribute a
#     named set now, not just g_tSticker0. The material JSON already listed all
#     ten params; nine of them 404'd, so the viewer had the flags for glitter /
#     holographic / gold and none of the maps they need, and approximated the
#     game's authored wear mask (g_tStickerScratches) with 2-octave value noise.
#     ~6,960 files: g_tNormalRoughnessSticker0 (4,157) and g_tSfxMaskSticker0
#     (2,650) are PER-STICKER, not the shared defaults they look like. Fixes
#     stickers already applied to weapons, not just any standalone view.
#  2. AGENTS (step 2 shard filter, step 3 placement). agents/models/ joins the
#     decompile, and agents keep their ARCHIVE PATH on the mount because that is
#     already what cs2-lib hands out as their model — no MAP entry, no client
#     change. 63 in use out of 92.
#  3. GLOVES (same two steps + GLOVE_KEY). The 12 meshes live under agents/ while
#     their materials live under characters/, and the 10 cs2-lib keys are READ
#     from items_game.txt rather than written down: t_gloves is glove_FINGERLESS
#     and ct_gloves is glove_HARDKNUCKLE, neither of which is guessable, and two
#     meshes belong to no item at all.
#  4. PATCH MATERIALS (step 3f -> patch-materials.json, fed to step 5). cs2-lib
#     gives a patch no paintMaterial — 0 of 112 — so nothing about a patch ever
#     reached the paint chain and DECAL_TYPES's "patch" was dead code. The econ
#     schema's patch_material is the only place the path exists.
#
# items_game.txt is now extracted ONCE above the step guards, since three steps
# read it and a skipped step must not be able to empty it.
# v18 (2026-07-29): decal art is resolved by STICKER KIT FOLDER, not by basename
# (step 3f + steps 4/5). The archive files sticker art per event, cs2-lib keeps
# only the basename, and the icon/material indexes were keyed on that — so all
# three `ibuypower` stickers (emskatowice2014 / cologne2014 / dhw2014) collapsed
# onto whichever the archive listed first, and every player who owned the
# Katowice one saw Cologne art. 3,907 basenames were ambiguous, hiding 13,163
# assets. Measured on this catalogue: 13,102 icons and 6,410 sticker materials
# resolved to the WRONG asset, some not stickers at all (sticker `metal` was an
# Inferno bookshelf material, `aces_high` a collectible pin). The kit id is
# cs2-lib's `index`, and items_game.txt turns it into the folder: 10,565/10,565
# stickers, 112/112 patches, 2,205/2,205 graffiti, 10,545/10,565 slabs — the 20
# are Budapest 2025, newer than this build, and are now reported blank rather
# than dressed in another event's art. Re-extraction required; card bakes and
# composites keyed on this version invalidate with it.
# v17 (2026-07-29): charm-shading.json gains `dynamic` — the SEED-DRIVEN shader
# params, decoded from each keychain vmat's Source 2 dynamic-expression
# bytecode. A charm's pattern is not just a tradeable number: 36 of the 89
# materials drive real params from `$KeychainSeed`, and Semi-Precious is
# `g_fHueShift = lerp(0, -160, $KeychainSeed)` — the entire green-to-purple ramp
# players catalogue by pattern. Decoded to an AST, not special-cased per charm.
# Also TIGHT-CROPS charm icons: they ship as a narrow vertical charm floating in
# a 512x384 landscape canvas (the art is 26% of the width, 22% on the crystal),
# so a square UI tile drew the charm at roughly an eighth of its area.
# v16 (2026-07-29): charm-shading.json (step 3e) — the per-material metalness
# remap and roughness adjust from each keychain vmat. The GLB carries the raw
# texture channels and csgo_weapon.vfx does not use them raw: Charm | Sasquatch
# authors its eyes metalness 1 but declares g_vMetalnessRemapRange [0, 0.5], and
# its roughness channel (max 0.51) is scaled by brightness 1.9 / contrast 0.7.
# Rendered raw, that is a chrome mirror where the game shows dull white.
# v15 (2026-07-29): the KV3 parser now understands binary blobs (`#[ 07 00 ... ]`).
# Every charm material carries one, so all 23 failed to parse in v14 with
# "cannot tokenize at '#['" and not one was written — the community charms had
# their model resolved and no material to dress it with. Re-run needed for them.
# v14 (2026-07-29): charm-models.json (step 3e) — which MODEL and which MATERIAL
# each charm is, parsed from the econ schema's keychain_definitions. A charm is
# not one model per charm: 23 of the 82 on this build are a shared blank mesh
# (workshop_blanks/kc_missinglink_default) wearing their own keychain_material,
# so resolving the model from the item's image name found nothing for them and
# they rendered as flat art. The named materials ride the paint chain, so their
# textures land alongside every other one.
EXTRACT_VERSION=28

# Default is the node's CS2 dedicated-server install — the same tree the
# game-server pods mount, present on every 5stack game node. Its root IS the
# CS2 dir (game/csgo/pak01_dir.vpk lives two levels down).
CS2_DIR="${CS2_DIR:-/opt/5stack/serverfiles}"
VPK="$CS2_DIR/game/csgo/pak01_dir.vpk"
OUT_DIR="${OUT_DIR:-}"
WORK="${WORK_DIR:-$(pwd)}/cs2-model-extract"
RAW="$WORK/raw"
if [[ -n "$OUT_DIR" ]]; then
  DEST="$OUT_DIR/models"
else
  DEST="$WORK/models"
fi
CLI_DIR="$WORK/cli"

if [[ ! -f "$VPK" ]]; then
  echo "!! pak01_dir.vpk not found at: $VPK"
  echo "   Set CS2_DIR to your CS2 install dir (the folder containing game/csgo)."
  exit 1
fi

# ---- Parallelism -------------------------------------------------------------
# Sized in WORKERS, and the unit that matters is memory, not cores. Every
# fan-out here is a Source2Viewer or ImageMagick process, and the CLI's peak RSS
# is set by the textures it decodes WHOLE, not by how long it runs. Measured on
# a 12-core node:
#
#   decompile one weapon dir  -> 1.3 GB anon RSS (a single 4K-textured AK is
#                                0.8 GB on its own; the knife dir, 22 models
#                                with smaller maps, is only 0.5 GB)
#   extract a texture batch   -> ~0.12 GB per process
#
# .NET GC knobs do nothing about that (tried: gcServer=0, GCConserveMemory=9,
# GCHeapHardLimit — all within noise), because the memory is live decoded
# pixels, not GC slack. How many run at once is the only lever. Measured over
# the full 41-dir decompile on that node:
#
#   -P 12 -> 13.5 GB peak, 79s        -P 3 -> 3.7 GB peak,  86s
#   -P  6 ->  7.0 GB peak, 78s        -P 2 -> 2.4 GB peak, 106s
#
# THE DEFAULT IS ONE. This step used to run `-P $(nproc)`, which asked for up to
# 13.5 GB and OOM-killed people's machines — not the extraction, the box. The
# cost of guessing low is a slower run; the cost of guessing high is somebody's
# server falling over, so low is the default and the panel offers the knob with
# the per-worker cost printed next to it.
#
# The count is re-read from JOBS_FILE while the run is going (see the decompile
# loop), so raising it in the panel spins up more workers in a run ALREADY IN
# PROGRESS. That is the intended workflow: start at one, watch the memory, add
# workers if the box has room.
DECOMPILE_WORKER_MB=1400   # measured peak RSS of one decompile shard
EXTRACT_WORKER_MB=120      # …and of one texture extract/convert worker
JOBS_FILE="${EXTRACT_JOBS_FILE:-${OUT_DIR:-$WORK}/extract-jobs}"
CORES=$(nproc 2>/dev/null || echo 4)
read_jobs() { # the panel's number, else the env, else 1 — clamped to the cores
  local n=""
  if [[ -r "$JOBS_FILE" ]]; then read -r n < "$JOBS_FILE" || true; fi
  if [[ ! "$n" =~ ^[0-9]+$ ]]; then n="${EXTRACT_JOBS:-1}"; fi
  if [[ ! "$n" =~ ^[0-9]+$ ]]; then n=1; fi
  if (( n > CORES )); then n=$CORES; fi
  if (( n < 1 )); then n=1; fi
  printf '%s' "$n"
}
# The python steps read the same file for their own pools.
export JOBS_FILE CORES
echo "--- Parallelism: starting at $(read_jobs) worker(s) — about $((DECOMPILE_WORKER_MB / 1024))GB each" \
  "while decompiling, $CORES cores available. Adjustable from the panel mid-run."

# ---- Step timing -------------------------------------------------------------
# A full run is long — tens of minutes, and how many depends on the worker count
# and the box — with most of it in one opaque decompile, so without
# per-step numbers there is no way to tell where to spend effort. Each step
# reports its own elapsed time, and the total lands in extract-version.json so
# the admin panel can say how long the last run took.
RUN_START=$(date +%s)
STEP_START=$RUN_START
declare -a STEP_TIMES=()
fmt_dur() { # seconds -> "1m 23s" / "45s"
  local s=$1
  if (( s >= 60 )); then printf '%dm %02ds' $(( s / 60 )) $(( s % 60 )); else printf '%ds' "$s"; fi
}
# Progress goes to a FILE, not just stdout. The backend reads it to drive the
# panel, and a file survives what a pipe does not: a backend restart mid-run, or
# a run started outside it.
#
# The file carries the WHOLE step list up front, each with its own state and (for
# the steps that know it) a unit count. A single "step 6 of 7" bar could not say
# how big a step was or how far into it you were — 6/7 sat next to a 26,878-item
# pass that had barely started.
PROGRESS_FILE="${OUT_DIR:-$WORK}/extract-progress.json"
export PROGRESS_FILE
# Declared here so the panel can show what is coming, not just what has been.
# ORDER MATTERS: this is the list the panel renders, and a step missing from it
# does not appear at all — it runs invisibly and the bar simply sits on the
# previous step, which reads as a hang. (model-textures was added in v9 and did
# exactly that for one run: several minutes of texture compression with the UI
# still showing "Mapping models to catalog keys" as the last thing that moved.)
STEPS=(decompile-models rename-models model-textures composite-inputs charm-anchors sticker-markup charm-models charm-physics econ-icons paint-chain sticker-art music-audio stamp)

# Read-modify-write via python: the file is shared with the embedded python
# steps, and hand-rolling JSON in shell got the quoting wrong the first time.
prog() { # prog <step> <state> [done] [total] [seconds]
  P_NAME="$1" P_STATE="$2" P_DONE="${3:-}" P_TOTAL="${4:-}" P_SECS="${5:-}" \
  python3 -c '
import json, os, datetime
f = os.environ["PROGRESS_FILE"]
try:
    d = json.load(open(f))
except Exception:
    d = {"steps": []}
name = os.environ["P_NAME"]
for s in d.get("steps", []):
    if s["name"] == name:
        s["state"] = os.environ["P_STATE"]
        # Wall-clock start, so the panel can count a RUNNING step up. Finished
        # steps report `seconds`; without this the current one showed only a
        # unit count, and the longest step in the run (texture compression) had
        # no way to say how long it had been at it. Set once — the embedded
        # python steps re-assert state="running" on every progress update, and
        # resetting here would restart the clock a few times a second.
        if os.environ["P_STATE"] == "running" and not s.get("started"):
            s["started"] = int(__import__("time").time())
        for key, env in (("done", "P_DONE"), ("total", "P_TOTAL"), ("seconds", "P_SECS")):
            v = os.environ.get(env, "")
            if v:
                s[key] = int(v)
        break
d["at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump(d, open(f, "w"))
' 2>/dev/null || true
}

prog_init() {
  local json="{\"steps\":["
  local first=1
  for s in "${STEPS[@]}"; do
    [[ $first == 1 ]] || json+=","
    first=0
    json+="{\"name\":\"$s\",\"state\":\"pending\"}"
  done
  json+="]}"
  printf '%s\n' "$json" >"$PROGRESS_FILE" 2>/dev/null || true
}
prog_init

step() { # step "Name" — closes the previous step and opens this one
  local now; now=$(date +%s)
  if [[ -n "${STEP_NAME:-}" ]]; then
    local d=$(( now - STEP_START ))
    STEP_TIMES+=("$STEP_NAME=$d")
    echo "--- [${STEP_NAME}] took $(fmt_dur "$d")"
    prog "$STEP_NAME" done "" "" "$d"
  fi
  STEP_NAME="$1"
  STEP_START=$now
  prog "$1" running
}

# ---- Step selection (DEVELOPMENT ONLY) ---------------------------------------
# A full run is hours, and most work on this script touches exactly one step —
# so iterating on, say, the glove branch of rename-models meant re-decompiling
# every weapon first. ONLY_STEPS/SKIP_STEPS are comma-separated step ids:
#
#   ONLY_STEPS=rename-models,model-textures ./scripts/extract-models.sh
#   SKIP_STEPS=decompile-models             ./scripts/extract-models.sh
#
# Both default to empty, i.e. today's behaviour exactly — the backend never sets
# them, so a production run cannot be affected by this.
#
# A SCOPED RUN IS SAFE NOW, AND IT IS THE DEV LOOP. Use it — a full run is ~30
# minutes and you almost never need one while iterating:
#
#   ONLY_STEPS=charm-models   ~1s    every charm's params (charm-shading.json)
#   ONLY_STEPS=charm-anchors  ~5s    where charms hang
#   ONLY_STEPS=sticker-markup ~1s    sticker slots
#   ONLY_STEPS=music-audio    ~1-2m  the 101 music kit previews (~350MB)
#
# Only reach for the paint chain when a NEW TEXTURE has to be extracted; params
# alone never need it. Two things make scoped runs safe, and both had to be
# fixed after a scoped run took the live mount from ~16,800 textures to 262:
#
#   · the paint chain does NOT prune on a scoped run (it cannot know what the
#     steps it skipped would have referenced), and
#   · a scoped run does NOT stamp extract-version.json, so the mount stays
#     honestly stale and a full run still happens later.
#
# The seven model steps are individually selectable, and so is music-audio (it
# reads the econ schema and the archive and nothing else). econ-icons,
# paint-chain and sticker-art are one interleaved flow with no seam between them,
# so naming any of the three runs all three.
#
# A skipped step reuses whatever the last run left in $WORK and $DEST. That is
# the point, and it is also the hazard: skip decompile-models after changing the
# archive filter and you will be reading stale shards. Rerun clean before you
# trust a result. Cross-step INPUTS (MAP, MODEL_KEY_JSON) are deliberately built
# outside the guards so a skip can't silently empty them — put anything else of
# that kind out there too, not inside the step that happens to use it first.
want_step() { # want_step <id> — true when this run should execute it
  local id="$1"
  if [[ -n "${ONLY_STEPS:-}" ]] && [[ ",${ONLY_STEPS}," != *",${id},"* ]]; then return 1; fi
  if [[ -n "${SKIP_STEPS:-}" ]] && [[ ",${SKIP_STEPS}," == *",${id},"* ]]; then return 1; fi
  return 0
}
# Opens the step and reports whether to run its body. Skipped steps are marked
# done with no duration so the panel doesn't sit on a step that never ran.
# Is this a SCOPED run? Load-bearing: a scoped run has not walked the whole
# catalogue, so anything that reasons about "everything referenced" — the paint
# prune, the version stamp — must not act on it. See PARTIAL_RUN below.
PARTIAL_RUN=0
if [[ -n "${ONLY_STEPS:-}" || -n "${SKIP_STEPS:-}" ]]; then PARTIAL_RUN=1; fi
export PARTIAL_RUN

step_if() { # step_if <id>
  if want_step "$1"; then step "$1"; return 0; fi
  echo "--- [$1] SKIPPED (ONLY_STEPS/SKIP_STEPS)"
  prog "$1" done
  return 1
}

# ---- Read the CS2 game build from steam.inf ----------------------------------
# steam.inf sits right next to the VPK and is a plain Key=Value file. We stamp
# the build alongside our pipeline version so the backend can tell when the game
# has moved on under the current assets (Valve shipped a patch since the last
# extract) — a softer signal than the pipeline stamp, since most patches don't
# touch weapon models. A missing/odd file just leaves these empty.
STEAM_INF="$CS2_DIR/game/csgo/steam.inf"
GAME_BUILD=""; GAME_PATCH=""; GAME_DATE=""
if [[ -f "$STEAM_INF" ]]; then
  GAME_BUILD=$(grep -m1 '^ClientVersion=' "$STEAM_INF" | cut -d= -f2- | tr -d '\r')
  GAME_PATCH=$(grep -m1 '^PatchVersion=' "$STEAM_INF" | cut -d= -f2- | tr -d '\r')
  GAME_DATE=$(grep -m1 '^VersionDate=' "$STEAM_INF" | cut -d= -f2- | tr -d '\r')
  echo "--- CS2 build: ${GAME_BUILD:-unknown} (${GAME_PATCH:-?}, ${GAME_DATE:-?})"
else
  echo "!! steam.inf not found at $STEAM_INF — game version will not be stamped."
fi

mkdir -p "$RAW" "$DEST/knives" "$DEST/extra" "$CLI_DIR"

# ---- 1. Fetch Source 2 Viewer CLI (linux-x64) --------------------------------
CLI="$CLI_DIR/Source2Viewer-CLI"
if [[ ! -x "$CLI" ]]; then
  echo "--- Downloading Source 2 Viewer CLI…"
  url=$(curl -s https://api.github.com/repos/ValveResourceFormat/ValveResourceFormat/releases/latest |
    grep browser_download_url | grep 'cli-linux-x64.zip' | cut -d '"' -f4)
  curl -sL "$url" -o "$WORK/cli.zip"
  unzip -o -q "$WORK/cli.zip" -d "$CLI_DIR"
  CLI="$(find "$CLI_DIR" -maxdepth 2 -type f -name '*CLI*' ! -name '*.zip' | head -1)"
  chmod +x "$CLI"
fi
echo "--- CLI: $CLI"

# One listing of the archive, reused by every step below (model sharding,
# sticker markup, icons, paints). Cheap, and it keeps the matching rules in one
# place instead of each step re-deriving what exists.
VPK_LIST="$WORK/vpk-list.txt"
"$CLI" -i "$VPK" --vpk_dir 2>/dev/null | awk '{print $1}' | grep '/' >"$VPK_LIST" || true
echo "--- Archive: $(wc -l <"$VPK_LIST") entries"

# ---- 2. Decompile every weapon model to GLB with materials + textures --------
if step_if "decompile-models"; then
echo "--- Decompiling weapon models (this takes a few minutes)…"
# --gltf_export_animations is NOT about playing animations: it is the only way
# to make VRF emit the SKELETON (skins + bone nodes). Without it the export
# carries JOINTS_0/WEIGHTS_0 but `skins: 0`, so nothing applies the bone
# transforms and every animation-only prop renders at its bind-pose parking
# spot — the Revolver's speed loader floating below the gun, the XM1014's
# loose shells beside it.
#
# Valve hides those props by SCALING THE BONE TO ZERO (verified: every clip in
# weapon_pist_revolver sets `loader_handle` scale to [0,0,0]). viewer3d applies
# the `inventory_icon` clip at t=0 to get that pose — the same clip Valve
# renders its own item icons from. Costs about +4% glb size (revolver
# 3.70 -> 3.86 MB).
# NOTE: this step logs thousands of "Failed to get texture inputs ... Only VCS
# file versions 59 through 70 are supported" lines against current CS2, which
# ships VCS 71. They are NOISE — do not go fix them. VRF reads the shader to map
# textures to material slots, and when that fails it falls back to a hardcoded
# name->slot table which handles every map we care about. VERIFIED on a run with
# 6822 of these: p90.glb still came out with 6 textures and baseColor/
# metallicRoughness/normal bound on both materials. The composite inputs in
# step 3b are unaffected too — they parse with `-b DATA` and never touch a
# shader. Chasing this costs a from-source VRF build and buys nothing.
# Sharded by weapon directory across all cores. As ONE invocation this is a
# single-threaded walk of every model and by far the longest step; the shards are
# independent (one weapon each) so they scale nearly linearly — but each one
# peaks around 1.3 GB, so how many run at once is the operator's call (see
# "Parallelism" at the top), not the core count's.
#
# Each shard gets its OWN output dir. Pointing them all at $RAW would have them
# racing to write the same shared material/texture files, and a torn texture is
# not something the later flat-copy would notice. They are merged with `cp -rn`
# afterwards, first writer wins — the files are identical either way.
# Keychains ride along with the weapons: they are ordinary models under a
# sibling tree (weapons/keychains/<collection>/[vmdl/]kc_*.vmdl_c), one per
# charm, ~43KB each and 62 of them. Same decompile, same texture handling, so
# adding the tree here is the whole cost — no second pass, and the shard
# scheduler picks them up as a few more dirs.
#
# AGENTS AND GLOVES ride along the same way, out of `agents/models/`. One regex
# covers both because the archive files them together, which is not obvious:
#
#   agents/models/<faction>/<name>.vmdl_c              63 agents in use
#   agents/models/shared/arms/glove_<type>/...         12 glove meshes
#
# The 3-component grouping below turns that into one shard per faction plus one
# for `agents/models/shared/`, which is the granularity the pool wants.
#
# Their MATERIALS live under `characters/`, a different top-level tree — but -f
# scopes which vmdl_c files get DUMPED, not what VRF follows out of them, so
# --gltf_export_materials pulls them regardless. (If a glove ever comes out
# untextured, that assumption is where to look first.)
#
# Taking the first three path components covers both layouts the collections
# use (with and without the extra vmdl/ level).
mapfile -t WEAPON_DIRS < <(grep -E '^(weapons/(models|keychains)|agents/models)/.*\.vmdl_c$' "$VPK_LIST" |
  awk -F/ 'NF>3 {print $1"/"$2"/"$3"/"}' | sort -u)
SHARDS="$WORK/raw_shards"
rm -rf "$SHARDS"
mkdir -p "$SHARDS"
if (( ${#WEAPON_DIRS[@]} == 0 )); then
  echo "!! No model directories found in the archive listing — falling back to one pass per tree."
  # Both trees, or the fallback silently drops every agent and glove and the run
  # still reports success. Two passes because -f takes one prefix.
  for tree in "weapons/models/" "agents/models/"; do
  "$CLI" -i "$VPK" -o "$RAW" -d \
    -f "$tree" -e "vmdl_c" \
    --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt \
    --gltf_export_animations
  done
else
  echo "--- Sharding ${#WEAPON_DIRS[@]} model dirs (weapons, charms, agents, gloves), starting at $(read_jobs) worker(s)…"
  # Each shard touches a marker on completion, which is both the progress count
  # the panel reads and how the scheduler below knows what is still in flight.
  SHARD_DONE="$SHARDS/.done"
  mkdir -p "$SHARD_DONE"
  # FILTER, do not silence. As one pass this step emitted ~26k lines, almost all
  # of it the documented VCS-71 shader noise plus a four-line vpk preamble per
  # shard. Dumping it all buried everything; dumping none of it also threw away
  # real decompile failures, which is the only thing here worth reading. Keep
  # the rest, tagged with the weapon so parallel shards stay legible.
  SHARD_NOISE='Only VCS file versions|^Preloading vpk|^Added folder|^Found "Counter-Strike 2"|^--- Dumping decompiled|^--- Creating mesh|^--- Loading material|^--- Dump written to|^$'
  shard_one() {
    local dir="$1" tag
    tag="${dir//\//_}"
    "$CLI" -i "$VPK" -o "$SHARDS/$tag" -d -f "$dir" -e "vmdl_c" \
      --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt \
      --gltf_export_animations 2>&1 |
      grep -vE "$SHARD_NOISE" |
      sed "s|^|    [$(basename "$dir")] |" || true
    : >"$SHARD_DONE/$tag"
  }
  # A dynamic pool rather than `xargs -P N`: xargs fixes its width at launch,
  # and the whole point of the knob is that an operator who starts at one worker
  # and sees the box coping can raise it WITHOUT restarting a run that is
  # already twenty minutes in. Every tick re-reads the count and tops the pool
  # up to it. Lowering never kills a shard mid-flight — it just stops new ones
  # starting until enough have finished, so the memory comes down on its own.
  shard_total=${#WEAPON_DIRS[@]}
  launched=0
  want=$(read_jobs)
  while :; do
    done_n=$(find "$SHARD_DONE" -type f 2>/dev/null | wc -l | tr -d "[:space:]")
    prog "decompile-models" running "$done_n" "$shard_total"
    if (( done_n >= shard_total )); then break; fi
    prev=$want
    want=$(read_jobs)
    if (( want != prev )); then
      echo "--- Workers: $prev -> $want (panel)"
    fi
    # `launched - done_n` over-counts if a shard finished since the find above,
    # which only ever makes this wait a tick longer. Never the other way round.
    while (( launched < shard_total )) && (( launched - done_n < want )); do
      shard_one "${WEAPON_DIRS[launched]}" &
      launched=$((launched + 1))
    done
    sleep 2
  done
  wait
  for shard in "$SHARDS"/*/; do
    [[ -d "$shard" ]] && cp -rn "$shard". "$RAW/" 2>/dev/null || true
  done
  rm -rf "$SHARDS"
  echo "--- Merged $(find "$RAW" -name '*.glb' | wc -l) glb files from shards"
fi

fi

# The model key table is DATA, not work — every step that resolves an archive
# name to a cs2-lib key needs it, so it lives outside the step guards below.
#
# The plugin looks up /models/<cs2-lib model key>.glb. Quirks: M4A4's key is
# "m4a1", Glock-18 is "glock", USP-S is "usp_silencer", etc.
declare -A MAP=(
  [weapon_pist_glock18]=glock
  [weapon_pist_usp_silencer]=usp_silencer
  [weapon_pist_hkp2000]=hkp2000
  [weapon_pist_p250]=p250
  [weapon_pist_elite]=elite
  [weapon_pist_fiveseven]=fiveseven
  [weapon_pist_tec9]=tec9
  [weapon_pist_cz75a]=cz75a
  [weapon_pist_deagle]=deagle
  [weapon_pist_revolver]=revolver
  [weapon_pist_taser]=taser
  [weapon_smg_mp9]=mp9
  [weapon_smg_mac10]=mac10
  [weapon_smg_mp7]=mp7
  [weapon_smg_mp5sd]=mp5sd
  [weapon_smg_ump45]=ump45
  [weapon_smg_p90]=p90
  [weapon_smg_bizon]=bizon
  [weapon_shot_nova]=nova
  [weapon_shot_xm1014]=xm1014
  [weapon_shot_mag7]=mag7
  [weapon_shot_sawedoff]=sawedoff
  [weapon_mach_m249]=m249
  [weapon_mach_negev]=negev
  [weapon_rif_galilar]=galilar
  [weapon_rif_famas]=famas
  [weapon_rif_ak47]=ak47
  [weapon_rif_m4a4]=m4a1
  [weapon_rif_m4a1_silencer]=m4a1_silencer
  [weapon_rif_aug]=aug
  [weapon_rif_sg556]=sg556
  [weapon_snip_ssg08]=ssg08
  [weapon_snip_awp]=awp
  [weapon_snip_g3sg1]=g3sg1
  [weapon_snip_scar20]=scar20
  # Knives. Keys are cs2-lib's melee `model` values; the vmdl basenames come
  # from each item's `playerModel` GLB name, which is the only reliable link —
  # several pairs are unguessable (navaja/gypsy_jackknife, talon/widowmaker,
  # bowie/survival_bowie, m9/m9_bayonet) and a wrong key just 404s in silence.
  # Mapping them here (rather than the knives/ passthrough below) also feeds
  # MODEL_KEY in §3b, so knives get their composite_inputs bundles too.
  [weapon_knife_default_ct]=knife
  [weapon_knife_default_t]=knife_t
  [weapon_knife_bayonet]=bayonet
  [weapon_knife_bowie]=knife_survival_bowie
  [weapon_knife_butterfly]=knife_butterfly
  [weapon_knife_canis]=knife_canis
  [weapon_knife_cord]=knife_cord
  [weapon_knife_css]=knife_css
  [weapon_knife_falchion]=knife_falchion
  [weapon_knife_flip]=knife_flip
  [weapon_knife_gut]=knife_gut
  [weapon_knife_karambit]=knife_karambit
  [weapon_knife_kukri]=knife_kukri
  [weapon_knife_m9]=knife_m9_bayonet
  [weapon_knife_navaja]=knife_gypsy_jackknife
  [weapon_knife_outdoor]=knife_outdoor
  [weapon_knife_push]=knife_push
  [weapon_knife_skeleton]=knife_skeleton
  [weapon_knife_stiletto]=knife_stiletto
  [weapon_knife_tactical]=knife_tactical
  [weapon_knife_talon]=knife_widowmaker
  [weapon_knife_ursus]=knife_ursus
)

# Derived from MAP and consumed by two LATER python steps (composite-inputs,
# sticker-markup), so it is built out here rather than inside a step: keeping it
# in one meant a skipped rename-models handed the others an empty map, and an
# empty MODEL_KEY resolves nothing without erroring.
MODEL_KEY_JSON="{"
for k in "${!MAP[@]}"; do MODEL_KEY_JSON+="\"$k\":\"${MAP[$k]}\","; done
MODEL_KEY_JSON="${MODEL_KEY_JSON%,}}"
export MODEL_KEY_JSON

# ---- The econ schema, out here because FOUR steps read it --------------------
# rename-models needs the glove table below, charm-models needs
# keychain_definitions, step 3f needs sticker_kits, and music-audio needs
# music_definitions (which is the only place a kit's sound FOLDER is named — so
# a scoped ONLY_STEPS=music-audio run works without a decompile). One small file
# and about a second to pull, so it is extracted once up front rather than by
# whichever step happens to run first — which is also what makes it survive a
# skip (see the note on ONLY_STEPS).
echo ""
echo "--- Reading the econ schema…"
rm -rf "$WORK/raw_items"
"$CLI" -i "$VPK" -o "$WORK/raw_items" -d -f "scripts/items/items_game.txt" >/dev/null 2>&1 || true
ITEMS_GAME="$(find "$WORK/raw_items" -name items_game.txt | head -1)"

# ---- Glove model key -> mesh -------------------------------------------------
# 10 cs2-lib keys against 12 meshes, and NOT guessable: `t_gloves` is
# glove_FINGERLESS and `ct_gloves` is glove_HARDKNUCKLE, while `glove_fullfinger`
# and `glove_cloth_collision` belong to no econ item at all. This is exactly the
# case the knife MAP comment warns about — a wrong key just 404s in silence — so
# it is READ, not written down:
#
#   "5030" { name sporty_gloves  model_player agents/models/shared/arms/glove_sporty/glove_sporty.vmdl }
#
# `name` IS cs2-lib's `model` for a glove, so the pair falls straight out.
declare -A GLOVE_KEY=()
if [[ -n "$ITEMS_GAME" ]]; then
  while IFS=$'\t' read -r gname gmesh; do
    [[ -n "$gname" && -n "$gmesh" ]] && GLOVE_KEY["$gmesh"]="$gname"
  done < <(ITEMS_GAME="$ITEMS_GAME" python3 -c '
import os, re, sys
src = os.environ["ITEMS_GAME"]
KV = re.compile(r"^\s*\"([^\"]+)\"\s+\"([^\"]*)\"\s*$")
name = None
out = {}
for line in open(src, encoding="utf8", errors="replace"):
    m = KV.match(line)
    if not m:
        continue
    k, v = m.group(1), m.group(2)
    if k == "name":
        name = v
    elif k == "model_player" and name and "/arms/glove_" in v:
        # Mesh BASENAME is what the decompiler writes as <stem>.glb.
        out.setdefault(v.rsplit("/", 1)[-1].removesuffix(".vmdl"), name)
for mesh, n in sorted(out.items()):
    sys.stdout.write(f"{n}\t{mesh}\n")
' 2>/dev/null)
fi
echo "--- Glove keys: ${#GLOVE_KEY[@]} (${!GLOVE_KEY[*]})"

# ---- 3. Rename to cs2-lib model keys -----------------------------------------
if step_if "rename-models"; then

count=0
charms=0
gloves=0
agents=0
while IFS= read -r -d '' f; do
  base="$(basename "$f" .glb)"
  # Path RELATIVE to $RAW, which mirrors the archive — the agent branch below is
  # the only thing that needs more than the basename, and it needs all of it.
  rel="${f#"$RAW"/}"
  key="${MAP[$base]:-}"
  gkey="${GLOVE_KEY[$base]:-}"
  if [[ -n "$key" ]]; then
    cp "$f" "$DEST/$key.glb"
    count=$((count + 1))
  elif [[ -n "$gkey" ]]; then
    # Gloves land TOP LEVEL under their cs2-lib key, exactly like weapons, so
    # modelUrlFor("sporty_gloves") resolves with no client change. The two meshes
    # with no econ item (fullfinger, cloth_collision) simply never match here.
    cp "$f" "$DEST/$gkey.glb"
    gloves=$((gloves + 1))
  elif [[ "$rel" == agents/models/* && "$rel" != agents/models/shared/* && "$base" != *_physics ]]; then
    # Agents keep their ARCHIVE PATH. cs2-lib already gives them
    # `agents/models/tm_leet/tm_leet_variantg` as the model, and modelUrlFor
    # encodes path segments individually — so mirroring the tree here is the
    # whole integration, with no MAP entry and no client change. Their textures
    # still go in the flat copy below: loadGltf parses with an explicit
    # `/models/` base URL, so a subdirectory GLB resolves siblings from the root.
    mkdir -p "$DEST/$(dirname "$rel")"
    cp "$f" "$DEST/$rel"
    agents=$((agents + 1))
  elif [[ "$base" == kc_*_physics ]]; then
    # Collision hulls ship alongside every charm and render as a grey blob if
    # anything ever loaded one. Nothing looks them up, so drop them rather than
    # doubling the charm count on the mount.
    :
  elif [[ "$base" == kc_* ]]; then
    # Charms, TOP LEVEL on purpose. The exporter writes textures as separate
    # files referenced by RELATIVE uri, and the flat copy below drops them all
    # in $DEST — so a charm parked in a subdirectory would look for its textures
    # one level down and render untextured. The kc_ prefix already namespaces
    # them against the weapon keys, and it is exactly the stem the catalog's
    # image gives (kc_missinglink_ava_36bc006a.webp -> kc_missinglink_ava).
    cp "$f" "$DEST/$base.glb"
    charms=$((charms + 1))
  elif [[ "$base" == *knife* || "$base" == *bayonet* || "$base" == *karambit* || "$base" == *daggers* ]]; then
    # Mapped knives now land top-level via MAP; what still falls here is the
    # _physics collision hulls and stattrak_module_knife — none of them render.
    cp "$f" "$DEST/knives/$base.glb"
  else
    cp "$f" "$DEST/extra/$base.glb"
  fi
done < <(find "$RAW" -name '*.glb' -print0)

# The glTF exporter writes base textures as SEPARATE .png files referenced by
# relative URI from each .glb — they must live next to the models or the
# viewer 404s and defaults render flat. Names are content-hashed, so a flat
# copy dedupes shared ones (default_*, sticker_gaps, ...).
find "$RAW" -name '*.png' -exec cp -n {} "$DEST" \; 2>/dev/null || true
# `cp -n` is first-writer-wins and silent, and the namespace is now shared by
# weapons, charms, gloves and 63 agents. That is SAFE by construction — the
# decompiler names textures after the source vtex including its content hash
# (`rif_famas_color_psd_442edc53.png`), so equal names mean equal content — but
# a handful of names carry no hash (`physics_weaponrifle.png`), and those are
# the ones that could quietly differ. Compare sizes and say so if they do:
# cheap, and the alternative symptom is one wrong-textured agent with nothing in
# any log.
find "$RAW" -name '*.png' -printf '%f\t%s\t%p\n' 2>/dev/null | sort | awk -F'\t' '
  { if ($1 == prev_name && $2 != prev_size) print "!! texture name collision with DIFFERENT sizes: " $1 " (" prev_size " vs " $2 ")\n!!   " prev_path "\n!!   " $3; prev_name=$1; prev_size=$2; prev_path=$3 }
' || true

echo "--- Mapped $count weapons, $charms charms, $gloves gloves, $agents agents ($(du -sh "$DEST" | cut -f1) total)"
# The glove keys come from the econ schema, so a zero here means the schema read
# failed rather than that the archive changed — worth saying out loud, since the
# only other symptom is every glove 404ing in the viewer.
(( gloves == 0 )) && echo "!! No gloves mapped — check the GLOVE_KEY table above and that items_game.txt extracted."
(( agents == 0 )) && echo "!! No agents mapped — check the shard filter includes agents/models/."

fi

# ---- 3a2. Model textures -> lossless webp -------------------------------------
if step_if "model-textures"; then
# The glTF exporter writes PNG. Lossless WebP is byte-identical after decode and
# MEASURED 18-36% smaller on these (avg ~25%: ak47_default_color 15->10MB,
# _normal 15->11MB, _ao/orm 17->14MB) — so this is pure transfer and disk saved
# with no pixel changed. LOSSLESS is not optional: these are normal maps and
# packed ORM/mask data, where lossy WebP's chroma subsampling would smear
# channels that are independent signals rather than colour.
#
# The .glb references its textures by relative URI, so the JSON chunk has to be
# rewritten to match — done here rather than at load time because the viewer
# would otherwise have to probe for a .webp twin on every texture.
DEST="$DEST" python3 - <<'PYEOF'
import json, os, shutil, struct, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

dest = os.environ["DEST"]
# cwebp, NOT ImageMagick. IM's WebP writer zeroes the RGB of fully-transparent
# pixels, and these textures are DATA — the compositor samples colour channels
# independently of alpha. Silently correct-looking, catastrophically wrong.
# There is no ImageMagick fallback for the same reason; without cwebp the PNGs
# are simply left alone, which costs transfer but never pixels.
have_cwebp = shutil.which("cwebp") is not None
if not have_cwebp:
    print("!!  `cwebp` not found — leaving model textures as PNG (~30% larger "
          "transfers). Install the `webp` package for the real output. NOT "
          "falling back to ImageMagick: its WebP writer discards colour under "
          "zero alpha, which corrupts masks and ramp-lookup patterns.",
          file=sys.stderr)

CORES = int(os.environ.get("CORES") or 0) or (os.cpu_count() or 4)
def pool_size(cap=8):
    try:
        with open(os.environ["JOBS_FILE"]) as fh:
            n = int(fh.read().strip())
    except Exception:
        n = int(os.environ.get("EXTRACT_JOBS") or 1)
    return max(1, min(cap, CORES, max(4, n)))

def progress(step, done, total, state="running", secs=None):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one.

    `state="done"` with `secs` closes a step the way the shell's `step` helper
    does, for a program that spans more than one step."""
    pf = os.environ.get("PROGRESS_FILE")
    if not pf:
        return
    try:
        try:
            with open(pf) as fh:
                doc = json.load(fh)
        except Exception:
            doc = {"steps": []}
        for s in doc.get("steps", []):
            if s["name"] == step:
                s["state"] = state
                s["done"], s["total"] = done, total
                if secs is not None:
                    s["secs"] = secs
                break
        else:
            # The step id must exist in the shell's STEPS list or the update
            # lands nowhere and the row sits indeterminate forever.
            print(f"!! progress: no step named {step!r} — check STEPS in the shell",
                  file=sys.stderr)
        with open(pf, "w") as fh:
            json.dump(doc, fh)
    except Exception:
        pass

# Every .glb we placed, wherever it landed.
glbs = []
for root, _dirs, files in os.walk(dest):
    for f in files:
        if f.endswith(".glb"):
            glbs.append(os.path.join(root, f))

def read_glb(path):
    """(header_version, json_dict, bin_chunk_bytes) or None."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 20 or data[:4] != b"glTF":
        return None
    ver = struct.unpack_from("<I", data, 4)[0]
    off, doc, binc = 12, None, b""
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return None if doc is None else (ver, doc, binc)

def write_glb(path, ver, doc, binc):
    """Rebuild the container. Chunk payloads are 4-byte aligned by spec — JSON
    pads with spaces, BIN with zeros — and every length in the header has to
    agree or the loader rejects the file outright."""
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    out = bytearray()
    out += b"glTF" + struct.pack("<I", ver) + struct.pack("<I", 0)  # length patched below
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    if binc:
        pad = binc + b"\x00" * (-len(binc) % 4)
        out += struct.pack("<II", len(pad), 0x004E4942) + pad
    struct.pack_into("<I", out, 8, len(out))
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(bytes(out))
    os.replace(tmp, path)

# Collect every PNG the models actually reference. Anything unreferenced is left
# alone — converting it would spend minutes on bytes nothing fetches.
parsed = {}
wanted = set()
for g in glbs:
    got = read_glb(g)
    if not got:
        continue
    parsed[g] = got
    for img in got[1].get("images", []) or []:
        uri = img.get("uri")
        if uri and uri.lower().endswith(".png"):
            wanted.add(uri)

# Same trap the paint staging hits: skipping what already exists is the right
# resume behaviour right up until the ENCODING changes, at which point every
# existing file is the thing being fixed. v9 wrote PNGs under .webp names, so a
# v10 run that trusted them would ship the bug it was released to fix. The stamp
# still holds the PREVIOUS run's version here — it is written at the very end.
TEXTURE_ENCODING_VERSION = 13
try:
    with open(os.path.join(dest, "extract-version.json")) as fh:
        _prev = int(json.load(fh).get("version") or 0)
except Exception:
    _prev = 0
reencode = _prev < TEXTURE_ENCODING_VERSION
if reencode and _prev:
    print(f"---   texture encoding changed (mount v{_prev} < v{TEXTURE_ENCODING_VERSION}) — re-encoding all",
          flush=True)

def convert(uri):
    src = os.path.join(dest, uri)
    dst = os.path.join(dest, uri[:-4] + ".webp")
    if os.path.exists(dst) and not reencode:
        return uri  # already done by an earlier run
    if not os.path.exists(src):
        return None
    tmp = dst + ".tmp"
    try:
        if not have_cwebp:
            return None
        # -exact is the whole point: without it libwebp is free to rewrite the
        # RGB of fully-transparent texels to zero, because for a PICTURE they are
        # invisible. These are not pictures. Verified byte-identical RGBA with
        # it, and 192 bytes different without it on a 64x64 probe.
        subprocess.run(
            ["cwebp", "-exact", "-lossless", "-q", "100", src, "-o", tmp],
            check=True, capture_output=True,
        )
        os.replace(tmp, dst)
        return uri
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None

todo = sorted(wanted)
progress("model-textures", 0, len(todo))
done = set()
if have_cwebp and todo:
    with ThreadPoolExecutor(max_workers=pool_size()) as pool:
        for i, res in enumerate(pool.map(convert, todo), 1):
            if res:
                done.add(res)
            if i % 10 == 0 or i == len(todo):
                progress("model-textures", i, len(todo))
            # The run log is the other place people watch, and this is the
            # longest step in the extraction — silence here reads as a hang just
            # as much as a missing progress row does.
            if i % 50 == 0 or i == len(todo):
                print(f"---   textures {i}/{len(todo)}", flush=True)

# Repoint the models at what actually converted. A texture that failed keeps its
# PNG and its URI, so a partial pass degrades to "some are still PNG" rather
# than to a model referencing a file that was never written.
rewritten = 0
for g, (ver, doc, binc) in parsed.items():
    changed = False
    for img in doc.get("images", []) or []:
        uri = img.get("uri")
        if uri in done:
            img["uri"] = uri[:-4] + ".webp"
            if img.get("mimeType"):
                img["mimeType"] = "image/webp"
            changed = True
    if changed:
        write_glb(g, ver, doc, binc)
        rewritten += 1

# Only now are the PNGs safe to drop: every .glb that named one points at the
# .webp. Done last so an interrupted run leaves both forms on disk (harmless)
# rather than a model pointing at a file that is gone (fatal).
freed = 0
if rewritten:
    for uri in done:
        p = os.path.join(dest, uri)
        try:
            freed += os.path.getsize(p)
            os.remove(p)
        except OSError:
            pass
print(f"---   {len(done)}/{len(todo)} textures -> lossless webp, "
      f"{rewritten} glb rewritten, {freed / 1e6:.0f}MB freed", flush=True)
PYEOF

fi

# ---- 3b. Per-weapon composite inputs ------------------------------------------
if step_if "composite-inputs"; then
# CS2 composites skins from per-weapon input textures (cavity/AO/noPaint,
# paint-by-number masks, base color, base rough/metal — all in paint-UV
# space). The 3D viewer's compositor consumes them from
# /models/<key>.inputs/{meta.json,*.png}; without them it falls back to the
# generic defaults (worn areas then show generic gunmetal instead of the
# weapon's true base texture).
echo "--- Extracting composite inputs…"
# Location: materials/models/weapons/customization/<folder>/, NOT the
# weapons/models/ tree the vmdl passes use — filtering on the latter matched
# zero entries, which is why every weapon fell back to generic ao/cavity.
#
# NOTE THE MISSING -d. Decompiling a vmat_c makes VRF resolve the material's
# shader to learn texture channel packing, and CS2 has moved .vcs to version
# 71 while VRF 19.2 (the newest release) only reads 59-70 — so every single
# composite_inputs vmat threw UnexpectedMagicException and wrote nothing. We
# don't need VRF's interpretation, only the g_t* -> .vtex paths, so dump the
# vmat_c raw and scan it ourselves. vtex decompiling is unaffected (no shader
# lookup) and still uses -d below.
RAW_CI="$WORK/raw_ci"
rm -rf "$RAW_CI"
mkdir -p "$RAW_CI"
"$CLI" -i "$VPK" -o "$RAW_CI" \
  -f "materials/models/weapons/customization/" -e "vmat_c"

# Every weapon ships a SECOND composite_inputs set, and the two are authored
# against DIFFERENT UV unwraps:
#
#   customization/<class>_<key>/   -> layer_name_1 = v_models/<key>.vmat, i.e.
#                                     the LEGACY body. (the pass above)
#   weapons/models/<key>/materials/composite_inputs/  -> the HD / CS2-native
#                                     body, usually F_SEPARATE_CHANNEL_INPUTS=1.
#
# MEASURED on the P90: the two noPaint masks agree on only 55% of texels, which
# is chance for their coverages. The viewer renders body_hd for every CS2-native
# finish (cs2-lib item.legacy == false), so shipping only the legacy bundle put
# a mask authored for a different unwrap onto the HD body — bare-metal texels
# landed mid-panel and the real hardware got painted. Bundle both; the viewer
# picks by the same flag it picks the body with.
#
# -f is a path PREFIX match, not a substring match: filtering on
# "materials/composite_inputs/" matches nothing (verified — 0 entries), because
# the real paths start "weapons/models/". So take the whole models-tree vmat set
# (148 entries, cheap) and let the walk below keep the composite_inputs ones.
"$CLI" -i "$VPK" -o "$RAW_CI" \
  -f "weapons/models/" -e "vmat_c"

# Parse each composite_inputs vmat for its texture references, decompile
# exactly those textures, and assemble <key>.inputs/ bundles.
CLI="$CLI" VPK="$VPK" RAW_CI="$RAW_CI" RAW="$RAW" DEST="$DEST" python3 - <<'PYEOF'
import json, os, re, shutil, subprocess, sys

cli, vpk, raw, dest = (os.environ[k] for k in ("CLI", "VPK", "RAW_CI", "DEST"))
raw_models = os.environ["RAW"]  # step-2 vmdl tree — holds the *_mag.glb exports

# ---- pool sizing ------------------------------------------------------------
# Same worker count the panel writes and the decompile loop watches, re-read
# every time a pool is built (once per batch), so raising the knob mid-run
# speeds these steps up too.
#
# Floored at 4, unlike the decompile: these extract and convert TEXTURES at
# ~0.12 GB per process, so four of them still sit under the 1.3 GB a SINGLE
# decompile worker needs — memory the run has already spent by the time it gets
# here. Dropping them to one would add minutes to the icon and paint steps to
# save headroom nothing else is using.
CORES = int(os.environ.get("CORES") or 0) or (os.cpu_count() or 4)


def pool_size(cap=8):
    try:
        with open(os.environ["JOBS_FILE"]) as fh:
            n = int(fh.read().strip())
    except Exception:
        n = int(os.environ.get("EXTRACT_JOBS") or 1)
    return max(1, min(cap, CORES, max(4, n)))

# The customization tree names folders by weapon CLASS (pist_/rif_/smg_/snip_/
# shot_/mach_), which is NOT the cs2-lib model key the plugin serves under.
# Stripping the prefix covers most; these are the ones it doesn't.
CLASS_PREFIX = ("pist_", "rif_", "smg_", "snip_", "shot_", "mach_")
FOLDER_KEY = {
    "glock18": "glock",
    "cz_75": "cz75a",
    "m249para": "m249",
    "m4a1_s": "m4a1_silencer",  # rif_m4a1 is the M4A4, whose key is plain m4a1
    # UNVERIFIED: pist_223 is the USP-S by elimination (it is the only pistol
    # folder left once every other one is accounted for), not by confirmation.
    # If usp_silencer renders wrong while its neighbours are right, suspect this.
    "223": "usp_silencer",
}
WANTED = {  # composite param -> served filename
    "g_tAmbientOcclusion": "ao.png",     # R=cavity G=ao A=noPaint
    "g_tMasks": "masks.png",             # paint-by-number RGB
    "g_tColor": "color.png",             # base weapon albedo
    "g_tMetalness": "metalness.png",     # R=rough G=metal
    # Needed by the PROJECTED paint styles, 2 (Spraypaint) and 5 (Anodized
    # Airbrushed). Those two do not sample the pattern in paint-UV space at all:
    # csgo_customweapon combo 293 builds the pattern coordinate in the fragment
    # shader from g_tPosition via a triplanar projection, weighted by the
    # object-space normal in g_tSurface. Without these, an airbrushed graphic
    # authored as a side elevation gets smeared across the whole unwrap —
    # Desert Eagle | Blaze puts flames on the grip.
    #
    # g_tPosition is declared RGBA16161616F. If VRF's default PNG export
    # quantises it to 8 bits the position will stair-step visibly under the
    # pattern magnification — check the exported format and prefer 16-bit PNG
    # or EXR if so.
    "g_tPosition": "position.png",       # object-space position, paint-UV space
    "g_tSurface": "surface.png",         # object-space normal, paint-UV space
}

FLOATS = {"g_flWeaponLength1": "weaponLength", "g_flUvScale1": "uvScale"}
# Channel packing is not fixed — it depends on this feature flag. Ground truth,
# csgo_composite_inputs.slang:
#   F_SEPARATE_CHANNEL_INPUTS=1 -> g_tAmbientOcclusion R=Cavity G=AO A=NoPaint
#   F_SEPARATE_CHANNEL_INPUTS=0 -> the pre-packed Source1 AO texture (B=cavity)
# The compositor reads cavity from the wrong channel without it, and on an HD
# map B is 0.000 everywhere, which zeroes wear-through entirely.
INTS = {"F_SEPARATE_CHANNEL_INPUTS": "separateChannels"}
MODEL_KEY = json.loads(os.environ.get("MODEL_KEY_JSON") or "{}")
# The models tree names two things differently from the GLB basenames it is
# otherwise identical to. Verified by diffing all 36 HD vmat stems against MAP:
# these are the ONLY discrepancies, so a silent .get() would drop exactly one
# weapon's HD bundle and nothing would say so.
MODEL_KEY["weapon_pist_glock"] = "glock"  # GLB is weapon_pist_glock18

# Knives break the naming rule the guns follow. Their GLB keeps the class prefix
# (weapon_knife_bayonet.glb, so MAP must key on that for the §3 rename) but their
# vmat DROPS it: .../knife/knife_bayonet/materials/composite_inputs/
# knife_bayonet_composite_inputs.vmat_c. Keying only on the GLB name silently
# yields no bundle and knives render on the generic ao/color fallback — visible
# as uniform wear, not as an error. Alias the prefix-less stem to the same key.
for _glb_base, _key in list(MODEL_KEY.items()):
    if _glb_base.startswith("weapon_knife_"):
        MODEL_KEY[_glb_base[len("weapon_"):]] = _key

# The vmat_c's KV3 payload is compressed, so scanning the raw bytes for strings
# recovers nothing (confirmed: 36 files dumped, 0 textures found). Ask the CLI
# to print just the DATA block instead — that path walks resource.Blocks and
# calls WriteText(), which inflates the KV3 without ever going near
# MaterialExtract, so it sidesteps the VCS 71 shader wall that -d hits.
#
# Params serialise as a list of { m_name = "g_tColor" m_pValue = resource:"..." }
# entries, so read the tokens in order and pair each name with the next value
# of the right shape rather than trying to regex the record as a whole.
TOKEN = re.compile(r'"([^"]*)"|(-?\d+(?:\.\d+)?)')

def scan(path):
    out = subprocess.run([cli, "-i", path, "-b", "DATA"],
                         capture_output=True, text=True, check=False).stdout
    # findall() reports a non-participating group as "" rather than None, which
    # makes quoted and numeric tokens indistinguishable — finditer does not.
    textures, floats, pending = {}, {}, None
    for m in TOKEN.finditer(out):
        tok, is_quoted = (m.group(1), True) if m.group(1) is not None else (m.group(2), False)
        if is_quoted and (tok in WANTED or tok in FLOATS or tok in INTS):
            pending = tok
        elif pending is None:
            continue
        elif pending in WANTED:
            if is_quoted and tok.endswith((".vtex", ".vtex_c")):
                textures[pending] = tok
                pending = None
        elif not is_quoted:
            if pending in INTS:
                floats[INTS[pending]] = bool(int(float(tok)))
            else:
                floats[FLOATS[pending]] = float(tok)
            pending = None
    return textures, floats

vmats = []
for root, _dirs, files in os.walk(raw):
    for f in files:
        if f.endswith("_composite_inputs.vmat_c"):
            vmats.append(os.path.join(root, f))
print(f"--- Found {len(vmats)} composite_inputs vmats")
if not vmats:
    # Don't abort — 3c still has work to do — but never let this read as success.
    print("!! NONE matched: the VPK filter is wrong, every weapon will fall back "
          "to generic ao/cavity/baseColor", file=sys.stderr)

made = 0
unmapped, unscannable, missing_tex = [], [], []

# Each scan() is its own CLI process that re-opens the 132k-entry VPK index, and
# there are ~148 of them — serially that is minutes of pure startup cost with the
# CPU mostly idle. They are independent and read-only, so run them up front on a
# pool and let the loop below consume the results.

# Unit-level progress for the panel. Written to the same file the shell uses —
# see the `progress` helper there for why it is a file and not stdout.

def progress(step, done, total, state="running", secs=None):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one.

    `state="done"` with `secs` closes a step the way the shell's `step` helper
    does, for a program that spans more than one step."""
    pf = os.environ.get("PROGRESS_FILE")
    if not pf:
        return
    try:
        try:
            with open(pf) as fh:
                doc = json.load(fh)
        except Exception:
            doc = {"steps": []}
        for s in doc.get("steps", []):
            if s["name"] == step:
                s["state"] = state
                s["done"], s["total"] = done, total
                if secs is not None:
                    s["secs"] = secs
                break
        else:
            # The step id must exist in the shell's STEPS list or the update
            # lands nowhere and the row sits indeterminate forever — which is
            # exactly how "paint-textures" vs "paint-chain" hid for a whole run.
            print(f"!! progress: no step named {step!r} — check STEPS in the shell",
                  file=__import__("sys").stderr)
        doc["at"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(pf, "w") as fh:
            json.dump(doc, fh)
    except Exception:
        pass

from concurrent.futures import ThreadPoolExecutor
_ordered = sorted(vmats)
with ThreadPoolExecutor(max_workers=pool_size(CORES)) as _pool:
    SCANNED = dict(zip(_ordered, _pool.map(scan, _ordered)))

# Pre-extract every texture these bundles reference, in ONE pass. `-f` takes a
# comma-separated list of exact paths (and only honours exact paths when `-e` is
# omitted), so ~540 individual CLI calls — each re-opening the 132k-entry archive
# index — collapse into a handful. This step was 7m09s almost entirely on that
# startup cost.
_all_vtex = sorted({
    (v[:-2] if v.endswith("_c") else v) + "_c"
    for _tex, _ in SCANNED.values() for v in _tex.values()
})
print(f"--- Pre-extracting {len(_all_vtex)} composite-input textures…", flush=True)
_BATCH = 150
_workers = pool_size()
for _i in range(0, len(_all_vtex), _BATCH):
    _batch = _all_vtex[_i:_i + _BATCH]
    _stride = max(1, (len(_batch) + _workers - 1) // _workers)
    _slices = [_batch[j:j + _stride] for j in range(0, len(_batch), _stride)]
    with ThreadPoolExecutor(max_workers=len(_slices)) as _pool:
        list(_pool.map(
            lambda paths: subprocess.run(
                [cli, "-i", vpk, "-o", raw, "-d", "-f", ",".join(paths)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False),
            _slices))
    progress("composite-inputs", min(_i + _BATCH, len(_all_vtex)), len(_all_vtex))

for vmat_path in _ordered:
    base = os.path.basename(vmat_path)
    folder = os.path.basename(os.path.dirname(vmat_path))
    if folder == "customization":  # default_composite_inputs.vmat_c, no weapon
        continue
    # ssg08 ships a separate scope body; the primary bundle is the one we want
    if "_scope_" in base or "_2_" in base:
        continue
    # Two trees, two bundles. The models tree (.../materials/composite_inputs/)
    # is the HD body's set and lands in <key>.inputs.hd; the customization tree
    # is the legacy body's and keeps <key>.inputs. See the shell comment above.
    if folder == "composite_inputs":
        stem = base[: -len("_composite_inputs.vmat_c")]
        key = MODEL_KEY.get(stem)
        if not key:
            # Knives and test_shape legitimately have no weapon model key (the
            # plugin does not serve them yet) — those are expected and quiet.
            # An unmapped weapon_* stem is a real gap and must be reported.
            if stem.startswith("weapon_"):
                unmapped.append(f"{stem}.inputs.hd -> (no model key)")
            continue
        out_dir = os.path.join(dest, f"{key}.inputs.hd")
    else:
        stripped = folder
        for p in CLASS_PREFIX:
            if stripped.startswith(p):
                stripped = stripped[len(p):]
                break
        key = FOLDER_KEY.get(stripped, stripped)
        out_dir = os.path.join(dest, f"{key}.inputs")

    label = os.path.basename(out_dir)
    textures, floats = SCANNED[vmat_path]
    if not textures:
        # Block dump failed or the param names moved — say so per-weapon rather
        # than emit a half-empty bundle.
        unscannable.append(label)
        continue
    if not os.path.isfile(os.path.join(dest, f"{key}.glb")):
        # Every bundle must land on a model the plugin actually serves. A key
        # that matches no .glb is a mapping bug, and it fails silently at
        # runtime as a 404 the viewer papers over with generic defaults.
        unmapped.append(f"{label} -> {key}")

    meta = {"textures": {}, **floats}
    os.makedirs(out_dir, exist_ok=True)
    for param, vtex in textures.items():
        vtex = vtex[:-2] if vtex.endswith("_c") else vtex
        # Already on disk from the batched pre-extract above.
        # The CLI picks the output container from the texture's FORMAT, so an
        # 8-bit map lands as .png but a float one does not. g_tPosition is
        # RGBA16161616F (verified: 1024x1024, decodes to RgbaF32) and comes out
        # as .exr.
        #
        # This loop used to hardcode ".png" and skip anything else in silence.
        # That is exactly how the v2 run produced 89 bundles with `surface` and
        # NO `position` while logging nothing at all: 27k lines, zero mentions.
        # Probe the real extensions and say so loudly when a wanted map yields
        # nothing.
        stem = os.path.join(raw, vtex[: -len(".vtex")])
        src = next((stem + e for e in (".png", ".exr", ".pfm", ".tif", ".tga")
                    if os.path.isfile(stem + e)), None)
        if src:
            out_name = WANTED[param]
            # Keep the extension the CLI actually produced; meta.json records the
            # real filename so the loader never has to guess.
            out_name = os.path.splitext(out_name)[0] + os.path.splitext(src)[1]
            shutil.copyfile(src, os.path.join(out_dir, out_name))
            meta["textures"][out_name.split(".")[0]] = out_name
        else:
            missing_tex.append(f"{label}:{param}")
    if meta["textures"]:
        with open(os.path.join(out_dir, "meta.json"), "w") as fh:
            json.dump(meta, fh)
        made += 1
        print(f"---   {label}: {' '.join(sorted(meta['textures']))}")
    else:
        shutil.rmtree(out_dir, ignore_errors=True)
        unscannable.append(label)

# ---- Translucent-magazine UV masks --------------------------------------------
# The P90's magazine is clear plastic: in-game the paint shows THROUGH it,
# slightly smoked. The viewer approximates that with a per-weapon mask of the
# magazine's UV islands (mag.png), which the compositor darkens. Baked from the
# mag's own GLB (same texture atlas as the body) rather than guessed from
# texture channels — ao.a marks the mag but also marks bare hardware, and no
# channel separates them (measured; see tools/shadertest/README.md).
# ONLY weapons whose mag is actually translucent belong here: baking this for
# an opaque painted mag (AK-47 etc.) would wrongly darken its paint.
TRANSLUCENT_MAGS = {"p90"}  # models-tree folder == cs2-lib key for these

def bake_mag_mask(glb_path, out_png, size=1024):
    import zlib, struct as st
    d = open(glb_path, "rb").read()
    jlen = st.unpack_from("<I", d, 12)[0]
    doc = json.loads(d[20:20 + jlen])
    binoff = 20 + jlen + 8
    def acc(i):
        a = doc["accessors"][i]; bv = doc["bufferViews"][a["bufferView"]]
        off = binoff + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        fmt = {5126: "f", 5123: "H", 5125: "I"}[a["componentType"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        cnt = a["count"] * n
        import struct as st2
        return [st2.unpack_from("<" + fmt * n, d, off + k * st2.calcsize("<" + fmt * n))
                for k in range(a["count"])]
    prim = doc["meshes"][0]["primitives"][0]
    uv = acc(prim["attributes"]["TEXCOORD_0"])
    idx = [i[0] for i in acc(prim["indices"])]
    grid = bytearray(size * size)
    for t in range(0, len(idx), 3):
        pts = [(uv[idx[t + k]][0] * size, uv[idx[t + k]][1] * size) for k in range(3)]
        (x1, y1), (x2, y2), (x3, y3) = pts
        minx, maxx = max(0, int(min(x1, x2, x3))), min(size - 1, int(max(x1, x2, x3)) + 1)
        miny, maxy = max(0, int(min(y1, y2, y3))), min(size - 1, int(max(y1, y2, y3)) + 1)
        den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(den) < 1e-9:
            continue
        for py in range(miny, maxy + 1):
            row = py * size
            for px in range(minx, maxx + 1):
                a_ = ((y2 - y3) * (px + 0.5 - x3) + (x3 - x2) * (py + 0.5 - y3)) / den
                b_ = ((y3 - y1) * (px + 0.5 - x3) + (x1 - x3) * (py + 0.5 - y3)) / den
                if a_ >= 0 and b_ >= 0 and (1 - a_ - b_) >= 0:
                    grid[row + px] = 255
    # minimal grayscale PNG, stdlib only — the game node has no PIL
    def chunk(tag, data):
        import zlib as z
        c = tag + data
        return st.pack(">I", len(data)) + c + st.pack(">I", z.crc32(c) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + bytes(grid[y * size:(y + 1) * size]) for y in range(size))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", st.pack(">IIBBBBB", size, size, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(rows, 6))
           + chunk(b"IEND", b""))
    open(out_png, "wb").write(png)
    return sum(1 for v in grid if v) / len(grid)

for mkey in sorted(TRANSLUCENT_MAGS):
    import glob as _g
    cands = [g for g in _g.glob(os.path.join(raw_models, "weapons/models", mkey, "*_mag.glb"))
             if "_physics" not in g]
    if not cands:
        print(f"!! {mkey}: translucent mag expected but no *_mag.glb found", file=sys.stderr)
        continue
    # Write into BOTH bundles. This used to land only in <key>.inputs, so every
    # CS2-native finish — which loads <key>.inputs.hd — got uHasMag = false and
    # no smoked magazine at all. Confirmed against the live mount after the
    # 2026-07-20 rerun: p90.inputs had mag, p90.inputs.hd did not.
    #
    # OPEN: the source *_mag.glb comes from the models (HD) tree, so this mask
    # is authored against the HD unwrap — which makes the legacy copy the
    # suspect one, not the HD copy. Legacy and HD unwraps genuinely differ (see
    # loadWeaponInputs), so if a legacy-finish P90 shows the darkening in the
    # wrong place, the legacy bundle needs its own bake from the legacy mag
    # model rather than this one.
    wrote = []
    for suffix in (".inputs", ".inputs.hd"):
        inputs_dir = os.path.join(dest, f"{mkey}{suffix}")
        meta_path = os.path.join(inputs_dir, "meta.json")
        if not os.path.isfile(meta_path):
            continue
        cov = bake_mag_mask(cands[0], os.path.join(inputs_dir, "mag.png"))
        meta = json.load(open(meta_path))
        meta.setdefault("textures", {})["mag"] = "mag.png"
        json.dump(meta, open(meta_path, "w"))
        wrote.append(f"{suffix.lstrip('.')} {cov*100:.0f}%")
    if wrote:
        print(f"---   {mkey}: mag mask baked ({', '.join(wrote)})")
    else:
        print(f"!! {mkey}: translucent mag but no composite-input bundle to write into",
              file=sys.stderr)

print(f"--- Composite inputs for {made} weapons")
if unscannable:
    print(f"!! No textures recovered for {len(unscannable)}: {', '.join(sorted(unscannable))}",
          file=sys.stderr)
    print("!! If this is ALL of them, run: $CLI -i <a_composite_inputs.vmat_c> -b DATA "
          "and check whether the block prints at all.", file=sys.stderr)
if unmapped:
    print(f"!! Bundles with no matching .glb (folder -> key): {', '.join(sorted(unmapped))}",
          file=sys.stderr)
if missing_tex:
    # Grouped by PARAM, because "every weapon is missing the same one" and "one
    # weapon is missing everything" are different bugs and the flat list hides
    # which you have. A param missing across the board means the CLI wrote an
    # extension this script does not recognise — that is how g_tPosition was
    # dropped from all 89 bundles in v2 without a single line of output.
    by_param = {}
    for item in missing_tex:
        by_param.setdefault(item.split(":")[-1], []).append(item.split(":")[0])
    for param, labels in sorted(by_param.items()):
        print(f"!! {param}: no decompiled file for {len(labels)} weapon(s)"
              + (" — ALL of them, so the CLI is writing a format this script "
                 "does not look for; check $RAW for the real extension."
                 if len(labels) == made else f": {', '.join(sorted(labels)[:8])}"),
              file=sys.stderr)
PYEOF

fi

# ---- 3c. Keychain (charm) anchor points --------------------------------------
if step_if "charm-anchors"; then
# Where a charm hangs is baked into the weapon model as an attachment named
# "keychain" (parented to bone weapon_hand_r), and it is hand-placed per weapon
# — the AK's sits forward of the ejection port while the M4A4's sits behind it,
# so no geometric rule can stand in for it. CS2 also ignores the keychain
# offset_x/y/z we send on inspect links, which makes the attachment the ONLY
# thing that decides position.
#
# The GLB export drops attachments (and bones) entirely — verified against the
# shipped models — but decompiling vmdl_c to TEXT keeps an AttachmentList. So
# decompile a second time without the glTF flags and pull the anchors out.
#
# The raw .vmdl text is kept alongside the parsed JSON on purpose: extraction
# runs on the game node and is slow, so if the parser ever needs fixing we can
# do it from the dump instead of asking for another run.
echo "--- Extracting keychain anchors…"
RAW_ATT="$WORK/raw_att"
mkdir -p "$RAW_ATT" "$DEST/attachments"
"$CLI" -i "$VPK" -o "$RAW_ATT" -d \
  -f "weapons/models/" -e "vmdl_c" >/dev/null 2>&1 || true

RAW_ATT="$RAW_ATT" DEST="$DEST" python3 - <<'PYEOF'
import json, os, re, shutil

raw, dest = os.environ["RAW_ATT"], os.environ["DEST"]
FOLDER_KEY = {"glock18": "glock", "m4a4": "m4a1"}  # cs2-lib naming quirks

# VRF writes: { _class = "Attachment" name = "keychain" ... parent_bone = "..."
#              relative_origin = [ 1.0, 2.0, 3.0 ] ... }
# Split on the class marker and parse each block on its own — one big regex
# across the file happily matches a name from one attachment against an origin
# from the next.
NAME = re.compile(r'name\s*=\s*"([^"]+)"')
BONE = re.compile(r'parent_bone\s*=\s*"([^"]*)"')
ORIGIN = re.compile(r'relative_origin\s*=\s*\[([^\]]*)\]')

def attachments_in(text):
    out = {}
    for block in text.split('_class = "Attachment"')[1:]:
        # Stop at the end of this block so we can't read the next one's fields.
        block = block[: block.find("_class") if "_class" in block else len(block)]
        name, origin = NAME.search(block), ORIGIN.search(block)
        if not name or not origin:
            continue
        try:
            xyz = [float(v) for v in origin.group(1).replace(",", " ").split()][:3]
        except ValueError:
            continue
        if len(xyz) != 3:
            continue
        bone = BONE.search(block)
        out[name.group(1)] = {"parent_bone": bone.group(1) if bone else None, "origin": xyz}
    return out

anchors, kept, vmdls = {}, 0, 0
for root, _dirs, files in os.walk(raw):
    for f in files:
        if not f.endswith(".vmdl"):
            continue
        vmdls += 1
        path = os.path.join(root, f)
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        found = attachments_in(text)
        # Keep every attachment, not just the keychain: muzzle_flash and
        # shell_eject land on unmistakable features, which is how the viewer
        # calibrates the Source -> glTF axis swizzle without guessing.
        if not any(k.startswith("keychain") for k in found):
            continue
        folder = os.path.relpath(path, raw).split(os.sep)[2]
        key = FOLDER_KEY.get(folder, folder)
        anchors[key] = found
        kept += 1
        shutil.copyfile(path, os.path.join(dest, "attachments", key + ".vmdl"))

with open(os.path.join(dest, "keychain-anchors.json"), "w") as fh:
    json.dump(anchors, fh, indent=1, sort_keys=True)
print(f"--- Scanned {vmdls} .vmdl files; keychain anchors for {kept} weapons")
if not kept:
    print("!!! No keychain attachments found — the raw dump in attachments/ is")
    print("!!! empty too, which means -d did not emit text .vmdl. Say so and")
    print("!!! the parser can be pointed at whatever it DID emit.")

# ---- attachment space -> the space the GLB mesh actually uses ----------------
# Attachments are relative to bone `weapon_offset`, but VRF bakes that bone's
# world transform into the exported vertices and then drops the bone. So mesh
# space is offset from attachment space by the accumulated bone chain, and
# without adding it back a charm lands metres from the gun. (Curve-fitting the
# offset from the silhouette gets close enough to look right and is wrong —
# the M4A4 fit landed on 18.22 against a true 18.234869.)
BONE_ORIGIN = re.compile(r'origin = \[([^\]]+)\]')
BONE_ANGLES = re.compile(r'angles = \[([^\]]+)\]')

def bone_chain(text, target="weapon_offset"):
    """Model-space position of `target`, plus the largest rotation on the chain
    that ACTUALLY moves it — `target` and its ancestors only. Translation-only:
    every shipped weapon has ~0 rotation in this chain (verified across all 34),
    so applying an unverified Euler order would be guesswork. max_angle is
    returned so a future model that DOES rotate the anchor shows up loudly
    instead of silently misplacing the charm. Rotations on sibling/cousin bones
    (e.g. g3sg1's charging_handle at 90°) never touch the anchor, so they are
    NOT counted — measuring them just cries wolf on every game update."""
    stack, cur, found, max_angle = [], None, None, 0.0
    for line in text.split("\n"):
        if '_class = "Bone"' in line:
            cur = {"depth": len(line) - len(line.lstrip("\t")), "name": None,
                   "origin": [0.0, 0.0, 0.0]}
            continue
        if cur is None:
            continue
        m = NAME.search(line)
        if m:
            cur["name"] = m.group(1)
            continue
        m = BONE_ORIGIN.search(line)
        if m:
            try:
                cur["origin"] = [float(v) for v in m.group(1).replace(",", " ").split()][:3]
            except ValueError:
                pass
            continue
        m = BONE_ANGLES.search(line)
        if m:  # angles closes the bone record
            try:
                angles = [float(v) for v in m.group(1).replace(",", " ").split()][:3]
            except ValueError:
                angles = [0.0, 0.0, 0.0]
            while stack and stack[-1]["depth"] >= cur["depth"]:
                stack.pop()
            parent = stack[-1] if stack else None
            cur["abs"] = ([p + c for p, c in zip(parent["abs"], cur["origin"])]
                          if parent else list(cur["origin"]))
            cur["angles"] = angles
            stack.append(cur)
            if cur["name"] == target:
                found = cur["abs"]
                # stack is now target + its ancestors: the only bones whose
                # rotation can move the anchor.
                max_angle = max([0.0] + [abs(a) for b in stack for a in b["angles"]])
            cur = None
    return found, max_angle

# GLB node matrix, identical on every shipped weapon: local X -> world Z,
# local Y -> world X, local Z -> world Y, scale 0.0254 (inches -> metres).
S = 0.0254
world = {}
rotated = []
skipped = []
for key, found in sorted(anchors.items()):
    kc = found.get("keychain") or found.get("keychain_legacy")
    if not kc:
        continue
    path = os.path.join(dest, "attachments", key + ".vmdl")
    try:
        base, max_angle = bone_chain(open(path, encoding="utf-8", errors="replace").read())
    except OSError:
        skipped.append((key, "no attachments/.vmdl dumped"))
        continue
    if base is None:
        # No `weapon_offset` bone. Dual-wield rigs (elite) parent their
        # attachments to weapon_r/weapon_l instead, so the single-weapon base
        # correction does not apply — they need their own placement handling.
        skipped.append((key, "no weapon_offset bone (dual-wield rig?)"))
        continue
    if max_angle > 0.01:
        rotated.append((key, round(max_angle, 3)))
    # Do NOT fold `base` into the anchor. Two different spaces:
    #
    #   our GLB       - attachment origin ONLY. Attachments are parented to
    #                   `weapon_offset`, which sits at [0,0,0]. The `weapon`
    #                   bone that `base` comes from is a SIBLING, not an
    #                   ancestor, so VRF never bakes it into the vertices.
    #   game offsets  - attachment origin + base, in Source inches.
    #
    # Folding base in made the anchor a game-space value that the viewer then
    # read as a GLB position. On the M4A4 (base x=18.23) that pinned the charm
    # past the muzzle; confirmed in game that muzzle_flash 18.455 + base 18.235
    # = 36.69 is the muzzle, so base belongs to the offsets, not the geometry.
    # The viewer adds/removes it when crossing between the two spaces.
    o = kc["origin"]
    world[key] = {
        "keychain": [round(o[1] * S, 6), round(o[2] * S, 6), round(o[0] * S, 6)],
        "base": [round(v, 4) for v in base],
    }

with open(os.path.join(dest, "charm-anchors.json"), "w") as fh:
    json.dump(world, fh, indent=1, sort_keys=True)
print(f"--- Charm anchors (viewer space) for {len(world)} weapons")
if skipped:
    print(f"!!! No charm anchor written for {len(skipped)} weapon(s) with a "
          f"keychain attachment: {skipped}")
if rotated:
    print(f"!!! Bone rotation in the weapon_offset chain: {rotated}")
    print("!!! The chain is translation-only — these anchors may be off.")
PYEOF

fi

# ---- 3d. Sticker slot markup + charm placement surfaces ----------------------
if step_if "sticker-markup"; then
# TWO markup blocks live side by side in the same DATA dump, so one invocation
# recovers both: `StickerMarkup` (UV anchors, below) and `KeychainMarkup` (the
# authored surfaces a charm may hang from).
#
# KeychainMarkup is worth spelling out because it replaces a pile of inference.
# Each record is one QUAD — `Corners`, 4 corners x XYZ — plus the `BoneName`
# that animates it and a `LegacyModel` flag selecting the body variant. Measured
# on this build: 2,155 quads across 35 weapons, 1,932 of them on `weapon_offset`
# and the rest on moving parts (slide, bolt, magazine, silencer, pump…).
#
# THE CORNERS ARE ALREADY IN GLB SPACE. Verified against every weapon's GLB
# POSITION accessor bounds: 32/32 fit as-is, 1/32 fit with `base` added, and the
# tight ones touch the mesh bound to 3 decimal places. So unlike the keychain
# ATTACHMENT — which is bone-relative and needs base folded in — this data needs
# no transform to be used by the viewer at all. `BoneName` names the bone that
# MOVES the quad, not the frame it is written in.
#
# Why not just take cs2-lib's `keychainPosition{X,Y,Z}{Min,Max}`: those are
# derived from this same block and they are accurate (20 of 34 weapons identical
# to ours, 14 looser by at most 0.561"), but they are an axis-aligned BOX. A box
# is enough to reject an out-of-range placement and useless for putting a charm
# flush against the weapon, which needs the surfaces themselves.
#
# Also covers `elite`, the one weapon with no charm anchor at all (dual-wield
# rigs have no `weapon_offset` bone, so §3c skips it): its quads arrive under
# `weapon_r`/`weapon_l`, which is the placement data that gap was missing.
# Per-weapon sticker slot anchors, in the weapon's TEXCOORD_1 UV space.
#
# CS2 does not project stickers as 3D decals — it composites them in UV space
# through a mask, so every slot has a hand-authored anchor. Without these the
# viewer falls back to guessing a position from the silhouette, which is a
# different space entirely and never lines up.
#
# These live in the vmdl_c's DATA block under m_modelInfo.m_keyValueText.
# Decompiling the model (step 2) does NOT recover them: VRF's ModelExtract
# re-emits only a whitelist of keys and StickerMarkup isn't on it — which is why
# the keychain attachment came through and this didn't. `-b DATA` prints the
# block verbatim as KV3 text instead, sidestepping the whitelist. Same trick as
# §3b, and likewise it never resolves a shader, so the VCS-71 noise is absent.
#
# One invocation for every model: the dump delimits files with `[n/m] <path>`.
echo ""
echo "--- Extracting sticker slot markup…"
CLI="$CLI" VPK="$VPK" DEST="$DEST" python3 - <<'PYEOF'
import json, os, re, subprocess

cli, vpk, dest = os.environ["CLI"], os.environ["VPK"], os.environ["DEST"]
MODEL_KEY = json.loads(os.environ.get("MODEL_KEY_JSON") or "{}")

proc = subprocess.run(
    [cli, "-i", vpk, "-f", "weapons/models/", "-e", "vmdl_c", "-b", "DATA"],
    capture_output=True, text=True, errors="replace",
)

HEADER = re.compile(r"^\[\d+/\d+\]\s+(\S+)\s*$")
sections, cur, buf = {}, None, []
for line in proc.stdout.splitlines():
    m = HEADER.match(line)
    if m:
        if cur:
            sections[cur] = buf
        cur, buf = m.group(1), []
    elif cur is not None:
        buf.append(line)
if cur:
    sections[cur] = buf

SCALAR = re.compile(r"^(\w+)\s*=\s*(\S.*)$")

def value(raw):
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    if raw.startswith("["):
        return [float(x) for x in raw.strip("[] ").split(",") if x.strip()]
    if raw in ("true", "false"):
        return raw == "true"
    try:
        return float(raw)
    except ValueError:
        return raw

NUMBER = re.compile(r"^-?\d")

def parse_markup(lines):
    """The array of slot records under `StickerMarkup`. Indentation-driven, which
    is what lets it read the nested Polygons tree without parsing KV3 in general.

    Each record carries `Polygons`: a list of objects whose `Vertices` are flat
    triangle soup in the SAME space as `Offset` (uv1 recentred on 0). That is the
    authored region the slot may be placed on, and it is the only ground truth
    for where a sticker is allowed to sit — cs2-lib's per-weapon bounds box is a
    rectangle around it that overshoots badly (measured on the M4A1-S: the box
    runs to u +1.007 where the real region ends at +0.467), so a drag clamped to
    the box lands on a UV that is not on the unwrap at all and the sticker
    silently stops moving."""
    try:
        i = next(n for n, l in enumerate(lines) if l.strip() == "StickerMarkup =")
    except StopIteration:
        return []
    j = i + 1
    while j < len(lines) and lines[j].strip() != "[":
        j += 1
    if j >= len(lines):
        return []
    base = len(lines[j]) - len(lines[j].lstrip("\t"))
    out, entry = [], None
    # Bracket depth inside a Polygons block: its own "[" takes it to 1 and the
    # matching "]" back to 0, which is what ends the block.
    in_poly, poly_depth = False, 0
    for line in lines[j + 1:]:
        # VRF separates array elements with a trailing comma ("\t\t},"), so the
        # record terminators are `},` and not `}`. Dropping it here rather than
        # comparing against both spellings also covers `],` and any scalar that
        # picks one up. Without this every record opens and none ever closes,
        # and the whole pass silently yields zero slots.
        stripped = line.strip().rstrip(",")
        indent = len(line) - len(line.lstrip("\t"))
        if in_poly:
            closes = stripped.count("]")
            poly_depth += stripped.count("[") - closes
            if closes and poly_depth <= 0:
                in_poly, poly_depth = False, 0
            elif entry is not None and NUMBER.match(stripped):
                entry.setdefault("_verts", []).extend(
                    float(x) for x in stripped.split(",") if x.strip()
                )
            continue
        if indent <= base and stripped == "]":
            break
        if indent == base + 1:
            if stripped == "{":
                entry = {}
            elif stripped == "}" and entry is not None:
                out.append(entry)
                entry = None
            continue
        if entry is None or indent != base + 2:
            continue
        if stripped == "Polygons =":
            in_poly, poly_depth = True, 0  # the "[" on the next line opens it
            continue
        m = SCALAR.match(stripped)
        if m:
            entry[m.group(1)] = value(m.group(2))
    return out

def slot(rec):
    off = rec.get("Offset")
    if not isinstance(off, list) or len(off) != 2:
        return None
    try:
        out = {
            "index": int(rec["Index"]),
            "mesh": str(rec.get("Mesh") or "body_hd"),
            "offset": [round(float(off[0]), 6), round(float(off[1]), 6)],
            "scale": float(rec["Scale"]),
            # Radians — values top out around 0.19, which is meaningless as degrees.
            "rotation": float(rec.get("Rotation") or 0.0),
        }
    except (KeyError, TypeError, ValueError):
        return None
    special = rec.get("SpecialIdentifier")
    if special:
        out["special"] = str(special)
    # The authored region, as flat triangle soup (x,y per vertex, 3 vertices per
    # triangle) in the same space as Offset. Dropped when it isn't whole
    # triangles — a partial region would silently shrink where a sticker may go.
    verts = rec.get("_verts")
    if isinstance(verts, list) and len(verts) >= 6 and len(verts) % 6 == 0:
        out["region"] = [round(float(v), 5) for v in verts]
    return out

def parse_keychain(lines):
    """The array of quad records under `KeychainMarkup`.

    Same indentation walk as parse_markup, but the payload is `Corners` — a flat
    list of 4 corners x XYZ — rather than a nested Polygons tree, so the bracket
    tracking only has to survive one level.

    Corners are in GLB space already (see the header note): no base, no cal, no
    pose. `BoneName` says which bone MOVES the quad, not which frame it is in.
    """
    try:
        i = next(n for n, l in enumerate(lines) if l.strip() == "KeychainMarkup =")
    except StopIteration:
        return []
    j = i + 1
    while j < len(lines) and lines[j].strip() != "[":
        j += 1
    if j >= len(lines):
        return []
    base = len(lines[j]) - len(lines[j].lstrip("\t"))
    out, entry = [], None
    in_corners, depth = False, 0
    for line in lines[j + 1:]:
        # Same trailing-comma rule as parse_markup — VRF writes `},` and `],`.
        stripped = line.strip().rstrip(",")
        indent = len(line) - len(line.lstrip("\t"))
        if in_corners:
            closes = stripped.count("]")
            depth += stripped.count("[") - closes
            if closes and depth <= 0:
                in_corners, depth = False, 0
            elif entry is not None and NUMBER.match(stripped):
                entry.setdefault("_corners", []).extend(
                    float(x) for x in stripped.split(",") if x.strip()
                )
            continue
        if indent <= base and stripped == "]":
            break
        if indent == base + 1:
            if stripped == "{":
                entry = {}
            elif stripped == "}" and entry is not None:
                out.append(entry)
                entry = None
            continue
        if entry is None or indent != base + 2:
            continue
        if stripped == "Corners =":
            in_corners, depth = True, 0
            continue
        m = SCALAR.match(stripped)
        if m:
            entry[m.group(1)] = value(m.group(2))
    return out


def quad(rec):
    corners = rec.get("_corners")
    # Exactly four XYZ corners or nothing. A truncated quad would define a
    # surface that isn't there, and the viewer would snap a charm onto it.
    if not isinstance(corners, list) or len(corners) != 12:
        return None
    return {
        # Named to match sticker-markup's `mesh`, so the viewer's existing
        # body-variant pick (body_hd / body_legacy) selects these too. An absent
        # LegacyModel means HD — same default the game applies.
        "mesh": "body_legacy" if rec.get("LegacyModel") is True else "body_hd",
        # The bone that animates this surface. `weapon_offset` (1,932 of the
        # 2,155 quads) is the static body; the rest ride a slide, bolt, magazine
        # or silencer and move with it. A consumer that can't follow a bone
        # should use the weapon_offset quads and skip the others rather than
        # place a charm on a part that will slide out from under it.
        "bone": str(rec.get("BoneName") or "weapon_offset"),
        "corners": [round(float(v), 5) for v in corners],
    }


markup, empty = {}, []
keychain, kc_empty = {}, []
for path, lines in sections.items():
    base = os.path.basename(path).replace(".vmdl_c", "")
    key = MODEL_KEY.get(base)
    if not key:
        continue  # a mag/prop vmdl, or a model we don't ship
    slots = [s for s in (slot(r) for r in parse_markup(lines)) if s]
    if slots:
        markup[key] = sorted(slots, key=lambda s: s["index"])
    else:
        empty.append(key)
    quads = [q for q in (quad(r) for r in parse_keychain(lines)) if q]
    if quads:
        keychain[key] = quads
    else:
        kc_empty.append(key)

with open(os.path.join(dest, "sticker-markup.json"), "w") as fh:
    json.dump(markup, fh, indent=1, sort_keys=True)
with open(os.path.join(dest, "keychain-markup.json"), "w") as fh:
    json.dump(keychain, fh, indent=1, sort_keys=True)

total = sum(len(v) for v in markup.values())
print(f"--- Sticker markup: {total} slots across {len(markup)} weapons")
if empty:
    # Knives and gloves genuinely have no sticker slots, so this list is only a
    # problem if a RIFLE shows up in it.
    print(f"---   no slots (expected for melee): {len(empty)} — {', '.join(sorted(empty)[:8])}")
if not markup:
    print("!!! No sticker markup recovered at all — sticker placement will fall "
          "back to the silhouette guess. Check the `-b DATA` output format.")

kc_total = sum(len(v) for v in keychain.values())
kc_bones = {}
for quads in keychain.values():
    for q in quads:
        kc_bones[q["bone"]] = kc_bones.get(q["bone"], 0) + 1
print(f"--- Charm surfaces: {kc_total} quads across {len(keychain)} weapons "
      f"({kc_bones.get('weapon_offset', 0)} on weapon_offset, "
      f"{len(kc_bones) - 1} other bone(s))")
if kc_empty:
    # Knives and gloves take no charm, so they belong here. A RIFLE in this list
    # means the charm has no authored surface to sit on and placement falls back
    # to the attachment point alone.
    print(f"---   no charm surfaces (expected for melee): {len(kc_empty)} — "
          f"{', '.join(sorted(kc_empty)[:8])}")
if not keychain:
    print("!!! No charm surfaces recovered at all — charm placement keeps the "
          "raycast lift. Check that `KeychainMarkup` is still in the DATA block.")
PYEOF

fi

# ---- 3e. Charm model + material map ------------------------------------------
if step_if "charm-models"; then
# Which MODEL and which MATERIAL each charm is, straight from the econ schema.
#
# A charm is not "one model per charm". The community collections are a shared
# blank mesh wearing their own material — measured on this build, 23 of the 82
# charms with a model all point at
# weapons/keychains/workshop_blanks/kc_missinglink_default.vmdl and differ only
# by `keychain_material`. Guessing the model from the item's image name (which
# is what the viewer did first) therefore works for the 59 that happen to own a
# model of the same name and silently fails for the rest — they rendered as flat
# art with no way to tell why.
#
# scripts/items/items_game.txt carries the real answer per keychain index:
#   "55" { name kc_missinglink_slime
#          pedestal_display_model weapons/keychains/workshop_blanks/kc_missinglink_default.vmdl
#          keychain_material      weapons/keychains/missinglink_community_01/kc_missinglink_slime.vmat }
#
# The definitions arrive in SEVERAL `keychain_definitions` blocks (one per
# release), so they are merged rather than read from the first.
echo ""
echo "--- Reading charm models…"
# items_game.txt is extracted once above the step guards — three steps read it.
# Every keychain material's DATA block, for the shading params below. Written to
# a FILE, not an environment variable: the dump is ~90 materials of KV3 and the
# whole environment has to fit execve's limit, so inlining it failed the run
# outright with "Argument list too long".
"$CLI" -i "$VPK" -f "weapons/keychains/" -e vmat_c -b DATA >"$WORK/charm-vmats.txt" 2>/dev/null || true
CHARM_SHADING="$WORK/charm-vmats.txt" \
ITEMS_GAME="$ITEMS_GAME" DEST="$DEST" CHARM_MATS="$WORK/charm-materials.json" \
CHARM_TEXTURES="$WORK/charm-textures.json" python3 - <<'PYEOF'
import hashlib, json, os, re, struct

src, dest = os.environ.get("ITEMS_GAME", ""), os.environ["DEST"]
KV = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"\s*$')
INDEX = re.compile(r'^"(\d+)"$')


def parse(path):
    """Every `keychain_definitions` block, merged by index."""
    out = {}
    lines = open(path, encoding="utf8", errors="replace").read().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != '"keychain_definitions"':
            i += 1
            continue
        j = i + 1
        while j < len(lines) and lines[j].strip() != "{":
            j += 1
        depth, j = 1, j + 1
        cur, entry = None, None
        while j < len(lines) and depth > 0:
            stripped = lines[j].strip()
            if stripped == "{":
                depth += 1
            elif stripped == "}":
                depth -= 1
                if depth == 1 and cur is not None:
                    out[cur] = entry
                    cur, entry = None, None
            elif depth == 1:
                m = INDEX.match(stripped)
                if m:
                    cur, entry = m.group(1), {}
            elif depth == 2 and entry is not None:
                m = KV.match(lines[j])
                if m:
                    entry[m.group(1)] = m.group(2)
            j += 1
        i = j
    return out


# Same naming the paint chain uses for anything cs2-lib does not name, so the
# material this points at is the file that step writes.
def mat_out_name(path):
    stem = os.path.basename(path)
    stem = stem[: stem.index(".")]
    return f"{stem}_{hashlib.sha1((path + '_c').encode()).hexdigest()[:8]}.vmat.json"


# The same rule for a TEXTURE, so the shading map below can name a file the
# paint chain has not written yet. Predicted rather than reported back because
# §3e runs first and can run alone; §5 re-derives it from the archive path and
# shouts if the two ever disagree.
def tex_out_name(path):
    stem = os.path.basename(path)
    stem = stem[: stem.index(".")]
    return f"{stem}_{hashlib.sha1((path + '_c').encode()).hexdigest()[:8]}.webp"


charms, mats = {}, []
if src and os.path.exists(src):
    for index, rec in sorted(parse(src).items(), key=lambda kv: int(kv[0])):
        name = rec.get("name")
        model = rec.get("pedestal_display_model")
        if not name or not model:
            continue  # sticker slabs and the like carry no display model
        entry = {"index": int(index), "model": os.path.basename(model).replace(".vmdl", "")}
        mat = rec.get("keychain_material")
        if mat:
            entry["material"] = f"/materials/{mat_out_name(mat)}"
            mats.append(mat + "_c")
        charms[name] = entry

with open(os.path.join(dest, "charm-models.json"), "w") as fh:
    json.dump(charms, fh, indent=1, sort_keys=True)

# ---- How the game SHADES those materials -------------------------------------
#
# The decompiled GLB carries the raw texture channels, and taking them at face
# value is wrong: csgo_weapon.vfx does not use them raw. Two params rewrite them,
# and both are per material.
#
#   g_vMetalnessRemapRange  [min,max] the metalness channel is remapped into.
#     Charm | Sasquatch is [0, 0.5]: its eyes are authored metalness 1, which the
#     game renders as 0.5 and we rendered as a chrome mirror.
#   g_fTextureRoughnessBrightness / Contrast  an affine adjust on roughness,
#     applied when F_ENABLE_ADJUSTMENTS is set. Sasquatch is 1.9 / 0.7 — its
#     roughness channel tops out at 0.51 and the game nearly doubles it.
#
# Emitted per MATERIAL STEM, not per charm: the clasp is its own material shared
# across a whole collection, so charm-keyed params would put one charm's tuning
# on everybody's chain. Identity values are dropped — the map is the exceptions.
shading_src = os.environ.get("CHARM_SHADING", "")
raw_vmats = ""
if shading_src and os.path.exists(shading_src):
    raw_vmats = open(shading_src, encoding="utf8", errors="replace").read()
BLOCKS = re.split(r'--- Data for block "DATA" ---', raw_vmats)[1:]


def num(block, param, key):
    m = re.search(r'm_name = "%s"\s*\n\s*%s = ([-\d.]+)' % (param, key), block)
    return float(m.group(1)) if m else None


def vec(block, param, n=3):
    """A `m_vectorParams` entry as its first n components.

    Every vector param is written as a float4 even when the shader declares a
    vec3 — `g_vLiquidColor` is `[ 0.8, 0.078431, 0.188235, 0.0 ]` — so the
    trailing 0 is padding, not a value, and taking it would ship an alpha the
    shader never reads.
    """
    m = re.search(r'm_name = "%s"\s*\n\s*m_value = \[ ([^\]]+) \]' % param, block)
    if not m:
        return None
    parts = [float(x) for x in m.group(1).split(",")]
    return [round(v, 6) for v in parts[:n]] if len(parts) >= n else None


# Source 2 dynamic-expression VM, enough of it to read what charms actually use.
# Opcode and function tables are VfxEval's (ValveResourceFormat/Serialization).
_VFX_FUNCS = [("sin",1),("cos",1),("tan",1),("frac",1),("floor",1),("ceil",1),
              ("saturate",1),("clamp",3),("lerp",3),("dot4",2),("dot3",2),("dot2",2),
              ("log",1),("log2",1),("log10",1),("exp",1),("exp2",1),("sqrt",1),
              ("rsqrt",1),("sign",1),("abs",1),("pow",2),("step",2),("smoothstep",3),
              ("float4",4),("float3",3),("float2",2),("time",0),("min",2),("max",2),
              ("SrgbLinearToGamma",1),("SrgbGammaToLinear",1),("random",2),
              ("normalize",1),("length",1),("sqr",1),("rotation2d",1),("rotate2d",2),
              ("sincos",1),("TextureSize",1),("TextureAverageColor",1)]
_VFX_BINOPS = {0x13:"+",0x14:"-",0x15:"*",0x16:"/",0x17:"%",
               # Comparisons yield 1.0/0.0 and are used as BRANCHLESS SELECTS —
               # `a * (seed <= 0.5) + b * (seed > 0.5)` — not as control flow, so
               # they need no jump handling. Charm | That's Bananas splits its
               # ramp in half this way.
               0x0A:"||",0x0B:"&&",0x0D:"==",0x0E:"!=",0x0F:">",0x10:">=",0x11:"<",0x12:"<="}
# Murmur token for the one render attribute charms use.
_VFX_KEYCHAIN_SEED = 0x8BEF1EF6


def vfx_decode(code):
    """Bytecode -> JSON AST. Numbers stay numbers; nodes are {"f": name, "a": [...]}."""
    stack = []
    # STORE/LOAD locals. The expressions are pure, so a LOAD can simply paste the
    # stored SUBTREE back in — no let-binding to represent, and the AST the
    # renderer walks stays a plain tree. Charm | That's Bananas needs this: all
    # four of its colour params (hue, saturation, brightness, contrast) compute
    # one ramp into a local and read it back.
    local = {}
    i = 0
    while i < len(code):
        op = code[i]
        i += 1
        if op == 0x00:  # RETURN
            break
        if op == 0x07:  # FLOAT literal
            stack.append(round(struct.unpack_from("<f", code, i)[0], 6))
            i += 4
        elif op == 0x08:  # STORE — a statement, so it takes its value off the stack
            local[code[i]] = stack.pop()
            i += 1
        elif op == 0x09:  # LOAD
            if code[i] not in local:
                raise ValueError(f"load of unset local {code[i]}")
            stack.append(local[code[i]])
            i += 1
        elif op == 0x18:  # NEGATE
            v = stack.pop()
            stack.append(-v if isinstance(v, (int, float)) else {"f": "neg", "a": [v]})
        elif op == 0x0C:  # NOT
            stack.append({"f": "!", "a": [stack.pop()]})
        elif op == 0x19:  # ATTRIBUTE
            tok = struct.unpack_from("<I", code, i)[0]
            i += 4
            if tok != _VFX_KEYCHAIN_SEED:
                raise ValueError(f"unknown render attribute {tok:08x}")
            stack.append({"f": "seed", "a": []})
        elif op == 0x06:  # FUNC
            fid, check = code[i], code[i + 1]
            i += 2
            if check != 0 or fid >= len(_VFX_FUNCS):
                raise ValueError(f"bad function id {fid:#x}")
            name, argc = _VFX_FUNCS[fid]
            args = [stack.pop() for _ in range(argc)][::-1]
            stack.append({"f": name, "a": args})
        elif op in _VFX_BINOPS:
            b, a = stack.pop(), stack.pop()
            stack.append({"f": _VFX_BINOPS[op], "a": [a, b]})
        else:
            raise ValueError(f"unhandled opcode {op:#x}")
    if not stack:
        raise ValueError("empty expression")
    return stack[-1]


shading, mask_textures = {}, {}
for block in BLOCKS:
    named = re.search(r'm_materialName = "([^"]+)"', block)
    if not named:
        continue
    stem = os.path.basename(named.group(1)).split(".")[0]
    entry = {}
    # ---- The liquid shader ---------------------------------------------------
    #
    # `csgo_simple_liquid.vfx` is the one shader a charm uses that is not
    # csgo_weapon.vfx, and exactly one charm is on it: Charm | Butane Buddy
    # (kc_db_lighter, two materials — an inner liquid volume and an outer glass
    # shell sharing one vertex pool). It matters far out of proportion to that
    # count, because the shader IS the charm: the authored albedo is the EMPTY
    # glass, pale teal, and every red pixel of the official icon comes from
    # g_vLiquidColor filling to g_flLiquidLevelHeight. Rendered through the glTF
    # fallback it was a featureless blob.
    #
    # Emitted as a flat param bag rather than a curated subset: this is one
    # material on one charm, and the renderer — the only thing that knows which
    # terms it can honour — should not have to come back here to try another.
    # Defaults are the shader's own, so a material that omits a param behaves as
    # the game does rather than as a zero.
    if re.search(r'm_shaderName = "csgo_simple_liquid\.vfx"', block):
        liquid = {
            # Level. The MinMidMax triples are the level scalar at fill 0 / 0.5 /
            # 1, chosen by how upright the charm hangs — the shader picks between
            # them with dot(objectUp, -gravity), so a charm swinging on its cord
            # slides between the three rather than snapping.
            "levelHeight": num(block, "g_flLiquidLevelHeight", "m_flValue") or 0.0,
            "levelDelta": num(block, "g_flLiquidLevelHeightDelta", "m_flValue") or 0.0,
            "up": vec(block, "g_vLiquidLevelUpwardsMinMidMax") or [0.0, 0.0, 0.0],
            "down": vec(block, "g_vLiquidLevelDownwardsMinMidMax") or [0.0, 0.0, 0.0],
            "side": vec(block, "g_vLiquidLevelSidewardsMinMidMax") or [0.0, 0.0, 0.0],
            "center": vec(block, "g_flLiquidCenterOffset") or [0.0, 0.0, 0.0],
            # Colour. hueShift is authored in DEGREES and uploaded as radians,
            # the same convention g_fHueShift uses on csgo_weapon.
            "color": vec(block, "g_vLiquidColor") or [1.0, 1.0, 1.0],
            "hueShift": num(block, "g_flLiquidColorHueShift", "m_flValue") or 0.0,
            "brightness": num(block, "g_flLiquidBrightness", "m_flValue") or 1.0,
            "innerGlow": num(block, "g_flLiquidInnerGlow", "m_flValue") or 0.0,
            # Edges: the meniscus, the sharpness of the fill boundary, and the
            # bright line the surface draws where it meets the glass.
            "surfaceTension": num(block, "g_flSurfaceTension", "m_flValue") or 0.0,
            "sharpness": num(block, "g_flLiquidSharpness", "m_flValue") or 0.0,
            "waterLine": num(block, "g_flWaterLineStrength", "m_flValue") or 0.0,
            "brightenEmpty": num(block, "g_flBrightenEmptyArea", "m_flValue") or 0.0,
            "fresnelThickness": num(block, "g_flFresnelGlassThickness", "m_flValue") or 0.0,
            # The BACK wall of the volume, so the fill reads as a body of liquid
            # rather than a flat cut across the silhouette.
            "backOffset": num(block, "g_flLiquidBackOffset", "m_flValue") or 0.0,
            "backFade": num(block, "g_flLiquidBackFade", "m_flValue") or 0.0,
            "backShape": num(block, "g_flLiquidBackCylinderOrSphere", "m_flValue") or 0.0,
            "roughness": num(block, "g_flLiquidRoughness", "m_flValue") or 0.0,
            "maskMin": num(block, "g_flMaskMinimum", "m_flValue") or 0.0,
            "maskMax": num(block, "g_flMaskMaximum", "m_flValue") or 0.0,
            # REFRACTION, and it is not blocked on anything. This file's own notes
            # and the handover doc both had it filed as "needs a scene colour
            # buffer we do not render" — the decompile says otherwise:
            # liquid_outer_combo12.glsl:707 samples the refracted ray out of
            # g_tEnvironmentMap, a CUBEMAP array, and :1462 builds the liquid's own
            # specular from the light constants. A prefiltered environment and one
            # directional light is the whole requirement, and the viewer has had
            # both since it was written.
            #
            # This is the missing CHARACTER of the reference render — the hard
            # speculars and the reflections. It is also the "metallic casing":
            # csgo_simple_liquid declares NO metalness texture at all (g_tColorA,
            # g_tNormalA, g_tLiquidMask, g_tDroplets and nothing else), so the
            # brass read on kc_db_lighter_02 cannot be a dropped channel — it is
            # this env reflection, and there was never a channel to go looking for.
            "glassRefraction": num(block, "g_flGlassRefraction", "m_flValue") or 0.0,
            "liquidRefraction": num(block, "g_flLiquidRefraction", "m_flValue") or 0.0,
            "surfaceRefraction": num(block, "g_flLiquidSurfaceRefraction", "m_flValue") or 0.0,
            "refractRoughMul": num(block, "g_flRefractRoughnessMultiplier", "m_flValue") or 0.0,
            "cubeTransparency": num(block, "g_flCubeRefractTransparency", "m_flValue") or 0.0,
            "cubeLiquidTransparency": num(block, "g_flCubeRefractLiquidTransparency", "m_flValue") or 0.0,
            "cubeBrightness": num(block, "g_flCubeRefractBrightness", "m_flValue") or 0.0,
            # The rest of the shader's surface response, none of it consumed yet.
            # Extracted together because they are one block in the vmat and a param
            # that is absent from the JSON is indistinguishable from one authored
            # at 0 — which is exactly how the roughness channel got written off.
            "reflectance": num(block, "g_flReflectance", "m_flValue") or 0.0,
            "specularStrength": num(block, "g_flLiquidSpecularStrength", "m_flValue") or 0.0,
            "surfaceSpecularStrength": num(block, "g_flLiquidSurfaceSpecularStrength", "m_flValue") or 0.0,
            "transmissive": num(block, "g_flTransmissiveStrength", "m_flValue") or 0.0,
            "emissive": num(block, "g_flLiquidEmissiveStrength", "m_flValue") or 0.0,
            # Wobble, and the gravity the whole level test is taken along. Both
            # are STATIC here on purpose: the game drives g_vTestGravityDir and
            # g_flTestAgitation from a dynamic expression on render attribute
            # 0x4B002DCA — the charm's live motion, which vfx_decode reports as
            # unknown and drops — so the authored constants are the only honest
            # answer. They are the at-rest values, which is what a viewer shows.
            # Bubbles. Their density is gated by the roughness channel (see
            # roughMap) — which is why they were first, wrongly, measured as
            # never appearing at all.
            "bubbleScale": num(block, "g_flBubbleScale", "m_flValue") or 0.0,
            "bubbleDepthFalloff": num(block, "g_flBubbleDepthFalloff", "m_flValue") or 0.0,
            "bubblesMin": num(block, "g_flBubblesMinimum", "m_flValue") or 0.0,
            "bubblesMax": num(block, "g_flBubblesMaximum", "m_flValue") or 0.0,
            "bubbleSpeed": num(block, "g_flBubbleSpeed", "m_flValue") or 0.0,
            "bubbleSpaceScale": num(block, "g_flBubbleSpaceScale", "m_flValue") or 0.0,
            "bubbleOpacity": num(block, "g_flBubbleOpacity", "m_flValue") or 0.0,
            # Spent on the NORMAL, not the colour — see the bubbleStrength note in
            # charmLiquid.ts. Without it the bubbles compute and stay invisible.
            "bubbleStrength": num(block, "g_flBubbleStrength", "m_flValue") or 0.0,
            "bubbleColorInner": vec(block, "g_vBubbleColorInner") or [0.0, 0.0, 0.0],
            "bubbleColorOuter": vec(block, "g_vBubbleColorOuter") or [1.0, 1.0, 1.0],
            "wobbleScale": num(block, "g_flLiquidWobbleScale", "m_flValue") or 0.0,
            "wobbleSpeed": num(block, "g_flLiquidWobbleSpeed", "m_flValue") or 0.0,
            "wobbleWavelength": num(block, "g_flLiquidWobbleWavelength", "m_flValue") or 0.0,
            "agitation": num(block, "g_flTestAgitation", "m_flValue") or 0.0,
            "gravity": vec(block, "g_vTestGravityDir") or [0.0, 0.0, -1.0],
            # The outer shell sets F_OPAQUE_REFRACT and the inner volume does not,
            # which is how the two halves of one vertex pool tell themselves apart.
            "opaqueRefract": bool(num(block, "F_OPAQUE_REFRACT", "m_nValue")),
        }
        # Gates the fill, the waterline and the empty-area brighten. Without it
        # the liquid covers the whole material — including the parts of the mesh
        # that are not the vessel — so a missing mask is worth saying out loud.
        # THE GLASS'S ROUGHNESS, which VRF's glTF export throws away.
        #
        # csgo_simple_liquid reads it as `g_tNormalA.z` (the decompile is explicit:
        # `_13387 = vec2(_23988)` and _13387 is the base roughness). The vmat binds
        # no roughness texture at all, so without this the vessel falls back to
        # glTF's default 1.0 and renders DEAD MATTE — no speculars, no
        # reflections, which is most of what the reference render is made of.
        #
        # It rides the chain as a bare texture, exactly like the tint masks, and
        # for the same reason: the glTF carries RGB only. Measured inside the
        # liquid mask on kc_db_lighter's normal map, blue is a flat 255 (VRF has
        # rebuilt it as the octahedral Z) while ALPHA runs p10 30 / median 93 /
        # p90 167 — the authored channel survives there and nowhere else, so the
        # client samples .a.
        nrm = re.search(r'm_name = "g_tNormalA"\s*\n\s*m_pValue = resource:"([^"]+)"', block)
        if nrm:
            liquid["roughMap"] = f"/textures/{tex_out_name(nrm.group(1))}"
            mask_textures[nrm.group(1) + "_c"] = tex_out_name(nrm.group(1))
        else:
            print(f"!!! {stem}: csgo_simple_liquid with no g_tNormalA — the glass will render matte")
        # THE METALNESS, and it is in the ALBEDO'S ALPHA — same trap as the
        # roughness above, one channel over.
        #
        # csgo_simple_liquid declares no metalness texture, which reads as "this
        # shader has no metalness" and is wrong. The decompile splits metal from
        # dielectric the textbook way, off g_tColorA.w:
        #   _18392 = _22452.w                                  (g_tColorA alpha)
        #   _24253 = mix(vec3(g_flReflectance), albedo, _18392) (specular colour)
        #   ... mix(albedo * (1.0 - _18392), cubeRefract, ...)  (diffuse killed)
        #
        # VRF's glTF export writes the albedo as RGB, so the charm's polished
        # lighter case and its hinge pin — both fully metal — arrived as flat matte
        # plastic. Pulled onto the chain as a bare texture so the alpha survives;
        # it is deliberately NOT reused as the material's `map`, because three
        # multiplies diffuseColor.a by it and every metal texel would then render
        # transparent in a snapshot.
        col = re.search(r'm_name = "g_tColorA"\s*\n\s*m_pValue = resource:"([^"]+)"', block)
        if col:
            liquid["metalMap"] = f"/textures/{tex_out_name(col.group(1))}"
            mask_textures[col.group(1) + "_c"] = tex_out_name(col.group(1))
        else:
            print(f"!!! {stem}: csgo_simple_liquid with no g_tColorA — metal parts will render matte")
        lmask = re.search(r'm_name = "g_tLiquidMask"\s*\n\s*m_pValue = resource:"([^"]+)"', block)
        if lmask:
            liquid["mask"] = f"/textures/{tex_out_name(lmask.group(1))}"
            mask_textures[lmask.group(1) + "_c"] = tex_out_name(lmask.group(1))
        else:
            print(f"!!! {stem}: csgo_simple_liquid with no g_tLiquidMask — the fill will not be gated")
        # The renderer ships the WOBBLE as a constant, because the shader scales
        # its noise by `wobbleScale * agitation^2` and both of Butane Buddy's
        # materials leave that at 1e-4/1e-2 — at most a 0.008 ripple on a body
        # 1.2 units across. Checked HERE because here is where a new liquid charm
        # would first be seen; the bound is the noise term's own maximum,
        # `0.35 * wobbleScale * agit^2 * 15 * 1.5`.
        _agit = liquid["agitation"] ** 2 + 0.01
        _ripple = 0.35 * liquid["wobbleScale"] * _agit * _agit * 22.5
        if _ripple > 0.01:
            print(f"!!! {stem}: wobble amplitude {_ripple:.4f} is no longer negligible — "
                  "the renderer's constant needs replacing with the real noise "
                  "(see wobbleConstant in src/charmLiquid.ts)")
        entry["liquid"] = liquid
    # ---- WHICH PART of the charm the pattern recolours ----------------------
    #
    # Not all of it, on 52 of the 81 seed-driven materials. `F_TINT_MASK` binds
    # a greyscale `g_tTintMask` in the albedo's UV space and the shader ends the
    # grade with `mix(albedo, graded, mask.r)` — see the decompile saved at
    # tools/shadertest/groundtruth/weapon_tintmask.glsl (combo 33). Ungated, a
    # charm whose pattern should only sweep its shell sweeps end to end.
    #
    # The mask rides the SHADING map rather than the material JSON because it
    # has to reach both kinds of charm: 23 wear a standalone material the client
    # can fetch, the other 58 keep their textures inside the GLB and this map,
    # keyed by material stem, is the only channel that reaches them.
    if num(block, "F_TINT_MASK", "m_nValue"):
        mask = re.search(r'm_name = "g_tTintMask"\s*\n\s*m_pValue = resource:"([^"]+)"', block)
        if mask:
            entry["tintMask"] = f"/textures/{tex_out_name(mask.group(1))}"
            mask_textures[mask.group(1) + "_c"] = tex_out_name(mask.group(1))
        # The mask also lerps the ROUGHNESS adjust toward identity, per material.
        # Its two knobs are folded into scale/offset below, and folding is exact
        # only at mask=1 — so the flag rides along and the renderer unfolds.
        if num(block, "g_bMaskRoughnessAdjustmentsByTintMask", "m_nValue"):
            entry["maskRoughness"] = True
    remap = re.search(r'm_name = "g_vMetalnessRemapRange"\s*\n\s*m_value = \[ ([^\]]+) \]', block)
    if remap:
        lo, hi = [float(x) for x in remap.group(1).split(",")[:2]]
        # Expressed as a SCALE on the metalness map, which is all a glTF material
        # can carry. Exact whenever the range starts at 0, and every charm on
        # this build does; a nonzero floor would need a real offset, so it is
        # reported rather than silently approximated.
        if lo != 0:
            print(f"!!! {stem}: metalness remap floor {lo} is not modelled (range {lo}..{hi})")
        elif hi != 1:
            entry["metalness"] = round(hi, 4)
    # Adjustments only apply when the material asks for them.
    if num(block, "F_ENABLE_ADJUSTMENTS", "m_nValue"):
        bright = num(block, "g_fTextureRoughnessBrightness", "m_flValue")
        contrast = num(block, "g_fTextureRoughnessContrast", "m_flValue")
        bright = 1.0 if bright is None else bright
        contrast = 1.0 if contrast is None else contrast
        # ((g - 0.5) * contrast + 0.5) * brightness, folded into scale + offset
        # so the renderer applies one affine step instead of re-deriving it.
        scale = contrast * bright
        offset = bright * 0.5 * (1.0 - contrast)
        if abs(scale - 1) > 1e-4 or abs(offset) > 1e-4:
            entry["roughness"] = round(scale, 4)
            entry["roughnessOffset"] = round(offset, 4)
    # ---- Seed-driven params ---------------------------------------------
    #
    # A charm's PATTERN is not just a tradeable number: 36 of the 89 keychain
    # materials on this build drive real shader params from it. Semi-Precious is
    # `g_fHueShift = lerp(0, -160, $KeychainSeed)`, which is the whole
    # green-teal-cyan-blue-purple ramp players catalogue by pattern.
    #
    # The vmat stores these as Source 2 dynamic-expression BYTECODE
    # (`m_dynamicParams`, with `m_renderAttributesUsed = ["$KeychainSeed"]`),
    # which is why the KV3 blob token added in v15 matters here. Decoded to a
    # tiny AST rather than special-cased per charm — the whole language in use is
    # lerp/frac/float2, four arithmetic ops and negate, so one decoder covers
    # every charm that exists now and any Valve ships later.
    #
    # The blob is written two ways and BOTH have to be read. VRF prints a short
    # expression inline (`m_value = #[ 07 00 … ]`) and wraps anything longer onto
    # its own line, indented. Matching only the inline form silently dropped 45
    # of the 81 seed-driven materials — every kc_db_* charm and most of the
    # tint-masked ones — so those charms held one colour at every pattern and
    # nothing said why.
    dyn = re.search(r"m_dynamicParams\s*=\s*\[(.*?)\n\t\]", block, re.S)
    if dyn:
        exprs = {}
        for pm in re.finditer(r'm_name = "([^"]+)"\s*\n\s*m_value =\s*#\[([0-9A-Fa-f\s]*)\]', dyn.group(1)):
            try:
                exprs[pm.group(1)] = vfx_decode(bytes.fromhex("".join(pm.group(2).split())))
            except Exception as exc:  # a param we cannot read must not kill the run
                print(f"!!! {stem}: cannot decode dynamic {pm.group(1)}: {exc}")
        if exprs:
            entry["dynamic"] = exprs
    if entry:
        shading[stem] = entry

with open(os.path.join(dest, "charm-shading.json"), "w") as fh:
    json.dump(shading, fh, indent=1, sort_keys=True)
# Handed to the paint chain, which owns extracting materials and their textures.
with open(os.environ["CHARM_MATS"], "w") as fh:
    json.dump(sorted(set(mats)), fh)
# Tint masks, likewise — but as TEXTURES, not entry points. Only the 23 charms
# that name a material in the econ schema ride the chain as materials; the rest
# keep their textures in the GLB, which carries no mask channel, so their mask
# would never be extracted and the URL above would 404. A map, not a list, so
# the chain can check its own naming against what was written here.
with open(os.environ["CHARM_TEXTURES"], "w") as fh:
    json.dump(mask_textures, fh, indent=1, sort_keys=True)

shared = len([c for c in charms.values() if "material" in c])
seeded = len([e for e in shading.values() if "dynamic" in e])
masked = len([e for e in shading.values() if "tintMask" in e])
liquids = len([e for e in shading.values() if "liquid" in e])
print(f"--- Charm models: {len(charms)} charms, {shared} sharing a blank mesh with their own material")
print(f"--- Charm shading: {len(shading)} of {len(BLOCKS)} materials corrected, "
      f"{seeded} pattern-driven, {masked} tint-masked ({len(mask_textures)} mask textures)")
# Two on this build, both Butane Buddy's. A zero here means the liquid parse
# stopped matching and that charm is back to rendering as empty glass — which
# looks like a texture problem and is not one.
print(f"--- Charm liquid: {liquids} csgo_simple_liquid materials")
if not charms:
    print("!!! No charm definitions recovered — charms will fall back to their "
          "flat art. Check that scripts/items/items_game.txt extracted.")
PYEOF

# ---- 3f. Sticker kit -> archive FOLDER ---------------------------------------
# Read here because this is where items_game.txt already is; consumed by steps 4
# and 5.
#
# Decal art is filed by EVENT and cs2-lib keeps only the basename, so
# `ibuypower` names three different stickers (emskatowice2014, cologne2014,
# dhw2014) and a basename-keyed index silently serves one of them as all three.
# That was 13,163 unreachable archive assets — most of the tournament sticker set
# wearing the wrong event's art, on the tile AND on the gun.
#
# The kit id (cs2-lib's `index` for a sticker/patch/graffiti) names the folder:
#   "59" { name kat2014_ibuypower  sticker_material "emskatowice2014/ibuypower" }
#   "4550" { name patch_banana     patch_material   "case01/patch_banana" }
# Only the DIRECTORY is kept — sticker slabs live in the same folder under a
# different stem (`ibuypower_1355_37`), so the file name has to stay the
# manifest's. Like keychain_definitions these arrive in ~55 blocks, so merge.
STICKER_KITS="$WORK/sticker-kits.json"
PATCH_MATS="$WORK/patch-materials.json"
ITEMS_GAME="$ITEMS_GAME" STICKER_KITS="$STICKER_KITS" PATCH_MATS="$PATCH_MATS" DEST="$DEST" python3 - <<'PYEOF'
import hashlib, json, os, re

src, out_path = os.environ.get("ITEMS_GAME", ""), os.environ["STICKER_KITS"]
patch_path, dest = os.environ["PATCH_MATS"], os.environ["DEST"]
KV = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"\s*$')
INDEX = re.compile(r'^"(\d+)"$')

dirs = {}
patches = {}
if src and os.path.exists(src):
    lines = open(src, encoding="utf8", errors="replace").read().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != '"sticker_kits"':
            i += 1
            continue
        j = i + 1
        while j < len(lines) and lines[j].strip() != "{":
            j += 1
        depth, j = 1, j + 1
        cur, entry = None, None
        while j < len(lines) and depth > 0:
            stripped = lines[j].strip()
            if stripped == "{":
                depth += 1
            elif stripped == "}":
                depth -= 1
                if depth == 1 and cur is not None:
                    # `stickers/` and `patches/` are the archive trees these two
                    # keys are relative to, for both the icon and the material.
                    mat = entry.get("sticker_material")
                    tree = "stickers"
                    if mat is None:
                        mat, tree = entry.get("patch_material"), "patches"
                    if mat:
                        dirs[cur] = f"{tree}/{mat}".rsplit("/", 1)[0]
                        # PATCHES need the FULL path, not just the folder.
                        #
                        # cs2-lib gives a patch no `paintMaterial` at all — 0 of
                        # 112 — so unlike a sticker there is no manifest entry to
                        # resolve, and the paint chain would never see one. This
                        # is the only place the schema names it, so it is kept
                        # whole and fed in as an extra entry point (same
                        # mechanism the charm materials already use). That is
                        # also what makes DECAL_TYPES's "patch" in the asset
                        # manifest stop being dead code.
                        if tree == "patches":
                            patches[cur] = f"patches/{mat}.vmat"
                    cur, entry = None, None
            elif depth == 1:
                m = INDEX.match(stripped)
                if m:
                    cur, entry = m.group(1), {}
            elif depth == 2 and entry is not None:
                m = KV.match(lines[j])
                if m:
                    entry[m.group(1)] = m.group(2)
            j += 1
        i = j

with open(out_path, "w") as fh:
    json.dump(dirs, fh)
# Two different files from the same table, exactly as the charm step does it:
#
#   $WORK  archive paths WITH the _c suffix, for the paint chain to queue as
#          extra entry points (see CHARM_MATS, same mechanism)
#   $DEST  the OUTPUT name each will be written under, so the backend can answer
#          "which material is this patch" without re-deriving it — the same
#          shape and the same hash rule charm-models.json uses
def mat_out_name(path):
    stem = os.path.basename(path)
    stem = stem[: stem.index(".")]
    return f"{stem}_{hashlib.sha1((path + '_c').encode()).hexdigest()[:8]}.vmat.json"


with open(patch_path, "w") as fh:
    json.dump(sorted({p + "_c" for p in patches.values()}), fh)
os.makedirs(dest, exist_ok=True)
with open(os.path.join(dest, "patch-materials.json"), "w") as fh:
    json.dump({k: f"/materials/{mat_out_name(v)}" for k, v in patches.items()}, fh,
              indent=1, sort_keys=True)
print(f"--- Sticker kits: {len(dirs)} kit folders (disambiguates same-named decal art)")
print(f"--- Patch materials: {len(patches)}")
if not dirs:
    print("!!! No sticker kits recovered — decal art falls back to a basename match, "
          "which serves ONE event's art for every same-named sticker.")
if not patches:
    print("!!! No patch materials recovered — patches have no paintMaterial in cs2-lib, "
          "so this file is the ONLY way their art reaches the paint chain.")
PYEOF

fi

# ---- 3g. Charm cloth simulation ----------------------------------------------
if step_if "charm-physics"; then
# How a charm MOVES. A charm is a cloth softbody, not a pendulum.
#
# Every kc_*.vmdl_c carries a PHYS block whose m_pFeModel is a complete
# PhysFeModelDesc — Valve's FEM/position-based cloth description, simulated by
# vphysics2's CPhysicsSoftbody/CFeModel. Nodes, quads, rods, hinge limits, axial
# bends, per-node masses and gravity, all authored per charm. The DATA block adds
# `cloth_sleep_enabled`. There is no authored swing anywhere to fall back on: the
# charm GLB's one "inspect" animation is a SINGLE static keyframe, a reference
# pose. All charm motion in game comes out of this solver.
#
# The viewer had a hand-rolled one-particle verlet pendulum on a 4mm cord in its
# place, every constant of it a guess. This is the real thing.
#
# Units need no conversion. The GLB's root node carries the 0.0254 scale and the
# Source->glTF swizzle, so everything below it — bones, mesh — is Source inches in
# Source axes, and so is this. Verified: m_InitPose entry 3 of kc_aus2025 is
# joint1's GLB bind translation byte for byte. flGravity (360 in/s^2 here) is used
# as-is; only the gravity DIRECTION has to be rotated in from world space.
#
# m_CtrlName maps sim nodes to bones. Only the `joint*` ctrls are real bones —
# `$ha_*`, `$cc*` and `$cloth_node_*` are virtual — which is what makes 20 nodes
# drive a 3-bone skin.
#
# Two invocations for the whole tree, as §3d does it: the dump delimits files with
# `[n/m] <path>`. `-b PHYS` prints the block verbatim as KV3 rather than resolving
# anything, so the VCS-71 noise is absent here too.
echo ""
echo "--- Extracting charm cloth models…"
mkdir -p "$DEST"
"$CLI" -i "$VPK" -f "weapons/keychains/" -e vmdl_c -b PHYS >"$WORK/charm-phys.txt" 2>/dev/null || true
"$CLI" -i "$VPK" -f "weapons/keychains/" -e vmdl_c -b DATA >"$WORK/charm-phys-data.txt" 2>/dev/null || true
# The raw dumps are archived next to the parsed JSON for the same reason §3c keeps
# the .vmdl text: extraction runs on the game node and is slow, so a parser bug
# should be fixable from the dump instead of costing another run. ~2.5MB, gzipped.
gzip -c "$WORK/charm-phys.txt" >"$DEST/charm-phys.txt.gz" 2>/dev/null || true

CHARM_PHYS="$WORK/charm-phys.txt" CHARM_PHYS_DATA="$WORK/charm-phys-data.txt" \
DEST="$DEST" python3 - <<'PYEOF'
import json, os, re

phys_path, data_path = os.environ["CHARM_PHYS"], os.environ["CHARM_PHYS_DATA"]
dest = os.environ["DEST"]

# ---- KV3 text parser ---------------------------------------------------------
# A trimmed copy of the paint parser further down this script. Trimmed and
# duplicated rather than shared because the two live in different heredocs and
# this one needs a strict subset — PHYS KV3 is objects, arrays, strings, numbers
# and booleans, with no `resource:` refs and no binary blobs. If the tokenizer
# below ever gains a case, check whether this one needs it too.
_TOKEN = re.compile(
    r"""
      (?P<ws>\s+)
    | (?P<comment><!--.*?-->)
    | (?P<punct>[\{\}\[\],=])
    | (?P<string>"(?:[^"\\]|\\.)*")
    | (?P<number>[-+]?(?:\d+\.\d+(?:[eE][-+]?\d+)?|\.\d+|\d+))
    | (?P<ident>[A-Za-z_][A-Za-z0-9_.]*)
    """,
    re.X | re.S,
)


def kv3_parse(text):
    pos, end, buf = 0, len(text), []

    def pump():
        nonlocal pos
        while pos < end:
            m = _TOKEN.match(text, pos)
            if not m:
                raise ValueError(f"cannot tokenize at {text[pos:pos + 40]!r}")
            pos = m.end()
            if m.lastgroup not in ("ws", "comment"):
                return (m.lastgroup, m.group())
        return None

    def peek():
        if not buf:
            t = pump()
            if t is None:
                return None
            buf.append(t)
        return buf[0]

    def take():
        peek()
        return buf.pop(0) if buf else None

    def value():
        tok = take()
        if tok is None:
            raise ValueError("unexpected end of input")
        kind, raw = tok
        if kind == "punct" and raw == "{":
            obj = {}
            while True:
                nxt = peek()
                if nxt is None:
                    raise ValueError("unterminated object")
                if nxt[1] == "}":
                    take()
                    return obj
                if nxt[1] == ",":
                    take()
                    continue
                kkind, key = take()
                if kkind == "string":
                    key = key[1:-1]
                elif kkind != "ident":
                    raise ValueError(f"bad key {key!r}")
                eq = take()
                if eq is None or eq[1] != "=":
                    raise ValueError(f"expected = after {key!r}")
                obj[key] = value()
        if kind == "punct" and raw == "[":
            arr = []
            while True:
                nxt = peek()
                if nxt is None:
                    raise ValueError("unterminated array")
                if nxt[1] == "]":
                    take()
                    return arr
                if nxt[1] == ",":
                    take()
                    continue
                arr.append(value())
        if kind == "string":
            return raw[1:-1]
        if kind == "number":
            return float(raw) if re.search(r"[.eE]", raw) else int(raw)
        if kind == "ident":
            return {"true": True, "false": False, "null": None}.get(raw, raw)
        raise ValueError(f"unexpected token {raw!r}")

    return value()


HEADER = re.compile(r"^\[\d+/\d+\]\s+(\S+)\s*$")


def sections(text):
    """Split a `-b <BLOCK>` dump per file. The KV3 body starts at the first line
    that is exactly `{` — everything above it is the resource header VRF always
    prints (block table, external refs), which is not KV3 and must be dropped."""
    out, cur, buf = {}, None, []
    for line in text.splitlines():
        m = HEADER.match(line)
        if m:
            if cur:
                out[cur] = buf
            cur, buf = m.group(1), []
        elif cur is not None:
            buf.append(line)
    if cur:
        out[cur] = buf

    def body(lines):
        for i, l in enumerate(lines):
            if l.rstrip() == "{":
                return "\n".join(lines[i:])
        return ""

    return {k: body(v) for k, v in out.items()}


# VRF prints ~6 significant digits; rounding past that would invent precision.
# At inch scale 1e-6in is far below anything visible, so never hand-tune these.
R = 6


def col(rows, key, cast=float):
    return [cast(r[key]) for r in rows]


def colr(rows, key):
    return [round(float(r[key]), R) for r in rows]


def colflat(rows, key, n, cast=float):
    out = []
    for r in rows:
        v = r[key]
        if len(v) != n:
            raise ValueError(f"{key}: expected width {n}, got {len(v)}")
        out.extend(cast(x) if cast is int else round(float(x), R) for x in v)
    return out


# Arrays empty on every charm in this build, kept as a TRIPWIRE rather than
# assumed away: a future charm that populates one would need solver support it
# silently would not get, and an unsimulated constraint means a charm that falls
# through the gun instead of hanging off it.
#
# This list is much shorter than it first looked. Rods, twists, axial edges and
# dyn/kin links are not rare — 15 of 62 charms carry rods (every weapon-shaped
# charm, plus the display case), 13 carry axial edges, 2 carry twists. They were
# merely absent from the first charm that got dumped.
EXPECTED_EMPTY = [
    "m_Ropes", "m_SpringIntegrator", "m_SimdSpringIntegrator",
    "m_GoalDampedSpringIntegrators", "m_JiggleBones", "m_Tris", "m_SimdTris",
    "m_SphereRigids", "m_BoxRigids", "m_SDFRigids", "m_TaperedCapsuleStretches",
    "m_TaperedCapsuleRigids", "m_Effects", "m_MorphLayers", "m_MorphSetData",
    "m_FitMatrices", "m_FitWeights", "m_KelagerBends", "m_AntiTunnelBytecode",
    "m_CollisionPlanes", "m_WorldCollisionParams", "m_WorldCollisionNodes",
    "m_LegacyStretchForce", "m_AnimStrayRadii", "m_SimdAnimStrayRadii",
    "m_CtrlSoftOffsets", "m_CtrlOsOffsets", "m_FollowNodes", "m_LocalRotation",
    "m_LocalForce", "m_LockToParent", "m_LockToGoal", "m_DynNodeVertexSet",
    "m_RigidColliderPriorities",
]


def convert(fe, name, sleep):
    n = int(fe["m_nNodeCount"])
    # m_InitPose is [x, y, z, 1.0, qx, qy, qz, qw] per ctrl.
    pos, rot = [], []
    for e in fe["m_InitPose"]:
        if len(e) != 8:
            raise ValueError(f"m_InitPose width {len(e)}")
        pos.extend(round(float(x), R) for x in e[0:3])
        rot.extend(round(float(x), R) for x in e[4:8])

    quads, bases = fe["m_Quads"], fe["m_NodeBases"]
    hinges, integ = fe["m_HingeLimits"], fe["m_NodeIntegrator"]
    rods, twists, axial = fe["m_Rods"], fe["m_Twists"], fe["m_AxialEdges"]

    return {
        "name": name,
        "nodes": n,
        "static": int(fe["m_nStaticNodes"]),
        "rotLockStatic": int(fe["m_nRotLockStaticNodes"]),
        "firstPosDriven": int(fe["m_nFirstPositionDrivenNode"]),
        "treeDepth": int(fe["m_nTreeDepth"]),
        # Every iteration count and every count1/count2 pair. Those pairs slice
        # each constraint array into solver passes, and WHICH slice runs WHEN is a
        # solver question the data cannot answer on its own — so keep them all
        # rather than deciding here which ones matter.
        "iters": int(fe["m_nExtraIterations"]),
        "pressureIters": int(fe["m_nExtraPressureIterations"]),
        "goalIters": int(fe["m_nExtraGoalIterations"]),
        "quadCount1": int(fe["m_nQuadCount1"]),
        "quadCount2": int(fe["m_nQuadCount2"]),
        "simdQuadCount1": int(fe["m_nSimdQuadCount1"]),
        "simdQuadCount2": int(fe["m_nSimdQuadCount2"]),
        "triCount1": int(fe["m_nTriCount1"]),
        "triCount2": int(fe["m_nTriCount2"]),
        "baseJiggleDepends": int(fe["m_nNodeBaseJiggleboneDependsCount"]),
        "staticNodeFlags": int(fe["m_nStaticNodeFlags"]),
        "dynamicNodeFlags": int(fe["m_nDynamicNodeFlags"]),
        "localForce": round(float(fe["m_flLocalForce"]), R),
        "localRotation": round(float(fe["m_flLocalRotation"]), R),
        "gravityScale": round(float(fe["m_flDefaultGravityScale"]), R),
        "addWorldCollisionRadius": round(float(fe["m_flAddWorldCollisionRadius"]), R),
        "motionSmoothCDT": round(float(fe["m_flMotionSmoothCDT"]), R),
        "internalPressure": round(float(fe["m_flInternalPressure"]), R),
        "timeDilation": round(float(fe["m_flDefaultTimeDilation"]), R),
        "windage": round(float(fe["m_flWindage"]), R),
        "windDrag": round(float(fe["m_flWindDrag"]), R),
        "surfaceStretch": round(float(fe["m_flDefaultSurfaceStretch"]), R),
        "threadStretch": round(float(fe["m_flDefaultThreadStretch"]), R),
        "velAirDrag": round(float(fe["m_flDefaultVelAirDrag"]), R),
        "expAirDrag": round(float(fe["m_flDefaultExpAirDrag"]), R),
        "velQuadAirDrag": round(float(fe["m_flDefaultVelQuadAirDrag"]), R),
        "expQuadAirDrag": round(float(fe["m_flDefaultExpQuadAirDrag"]), R),
        "volumetricSolve": round(float(fe["m_flDefaultVolumetricSolveAmount"]), R),
        "rodVelSmoothRate": round(float(fe["m_flRodVelocitySmoothRate"]), R),
        "quadVelSmoothRate": round(float(fe["m_flQuadVelocitySmoothRate"]), R),
        "rodVelSmoothIters": int(fe["m_nRodVelocitySmoothIterations"]),
        "quadVelSmoothIters": int(fe["m_nQuadVelocitySmoothIterations"]),
        "localDrag1": round(float(fe["m_flLocalDrag1"]), R),
        "sleep": bool(sleep),
        # The node -> bone map. `$`-prefixed ctrls are virtual and have no bone.
        "ctrl": list(fe["m_CtrlName"]),
        "invMass": [round(float(x), R) for x in fe["m_NodeInvMasses"]],
        # radius/friction are per DYNAMIC node, NOT per node: their length is
        # nodeCount - staticNodes on every charm here (20-4=16 on kc_aus2025,
        # 21-4=17 on kc_wpn_ak_base), so index them as [node - staticNodes].
        # friction is simply absent when it is uniformly zero.
        "radius": [round(float(x), R) for x in fe["m_NodeCollisionRadii"]],
        "friction": [round(float(x), R) for x in fe["m_DynNodeFriction"]],
        "initPos": pos,
        "initRot": rot,
        "free": [int(x) for x in fe["m_FreeNodes"]],
        "sourceElems": [int(x) for x in fe["m_SourceElems"]],
        "skelParents": [int(x) for x in fe["m_SkelParents"]],
        # The node BVH: parents and masks are one entry per TREE node (33 for a
        # 21-node model), children are pairs. These index tree nodes, not sim
        # nodes, which is why they sit outside the range check below.
        "treeParents": [int(x) for x in fe["m_TreeParents"]],
        "treeChildren": [int(x) for c in fe["m_TreeChildren"] for x in c["nChild"]],
        "treeMasks": [int(x) for x in fe["m_TreeCollisionMasks"]],
        "quads": {
            "n": colflat(quads, "nNode", 4, int),
            "slack": colr(quads, "flSlack"),
            "shape": [round(float(x), R) for q in quads for v in q["vShape"] for x in v],
        },
        # Distance constraints. flMaxDist 16384 reads as "no upper bound" — a cord
        # that may go slack but must not stretch past flMinDist.
        "rods": {
            "n": colflat(rods, "nNode", 2, int),
            "min": colr(rods, "flMinDist"),
            "max": colr(rods, "flMaxDist"),
            "w0": colr(rods, "flWeight0"),
            "relax": colr(rods, "flRelaxationFactor"),
        },
        "bases": {
            "n": col(bases, "nNode", int),
            "x0": col(bases, "nNodeX0", int),
            "x1": col(bases, "nNodeX1", int),
            "y0": col(bases, "nNodeY0", int),
            "y1": col(bases, "nNodeY1", int),
            "q": colflat(bases, "qAdjust", 4),
        },
        "hinges": {
            "n": colflat(hinges, "nNode", 6, int),
            "w4": colr(hinges, "flWeight4"),
            "w5": colr(hinges, "flWeight5"),
            "flags": col(hinges, "nFlags", int),
            "center": colr(hinges, "flAngleCenter"),
            "extent": colr(hinges, "flAngleExtents"),
        },
        # Bending constraints: six nodes, a barycentric-looking (te, tv) pair and
        # four weights.
        "axial": {
            "n": colflat(axial, "nNode", 6, int),
            "te": colr(axial, "te"),
            "tv": colr(axial, "tv"),
            "dist": colr(axial, "flDist"),
            "w": colflat(axial, "flWeight", 4),
        },
        "twists": [
            {"orient": int(t["nNodeOrient"]), "end": int(t["nNodeEnd"]),
             "twist": round(float(t["flTwistRelax"]), R),
             "swing": round(float(t["flSwingRelax"]), R)}
            for t in twists
        ],
        "dynKinLinks": [
            {"parent": int(l["m_nParent"]), "child": int(l["m_nChild"])}
            for l in fe["m_DynKinLinks"]
        ],
        # Per NODE, one entry each — verified across all 62, not assumed.
        "integrator": {
            "damping": colr(integ, "flPointDamping"),
            "animForce": colr(integ, "flAnimationForceAttraction"),
            "animVertex": colr(integ, "flAnimationVertexAttraction"),
            "gravity": colr(integ, "flGravity"),
        },
        "ctrlOffsets": [
            {"o": [round(float(x), R) for x in c["vOffset"]],
             "parent": int(c["nCtrlParent"]), "child": int(c["nCtrlChild"])}
            for c in fe["m_CtrlOffsets"]
        ],
        "reverseOffsets": [
            {"o": [round(float(x), R) for x in c["vOffset"]],
             "ctrl": int(c["nBoneCtrl"]), "node": int(c["nTargetNode"])}
            for c in fe["m_ReverseOffsets"]
        ],
        "antiTunnel": {
            "probes": [
                {"w": round(float(p["flWeight"]), R), "flags": int(p["nFlags"]),
                 "node": int(p["nProbeNode"]), "count": int(p["nCount"]),
                 "begin": int(p["nBegin"]),
                 "activation": round(float(p["flActivationDistance"]), R),
                 "curvature": round(float(p["flCurvatureRadius"]), R),
                 "bias": round(float(p["flBias"]), R)}
                for p in fe["m_AntiTunnelProbes"]
            ],
            "targets": [int(x) for x in fe["m_AntiTunnelTargetNodes"]],
        },
    }


def check(out):
    """Structural invariants. A charm failing one is DROPPED rather than shipped:
    the solver is data-driven, and a bad index is either a crash or a charm that
    flies off — neither is better than falling back to the flat sprite."""
    n, errs = out["nodes"], []
    if len(out["ctrl"]) != n:
        errs.append(f"ctrl {len(out['ctrl'])} != nodes {n}")
    if len(out["invMass"]) != n:
        errs.append(f"invMass {len(out['invMass'])} != nodes {n}")
    if len(out["integrator"]["gravity"]) != n:
        errs.append(f"integrator {len(out['integrator']['gravity'])} != nodes {n}")
    if len(out["initPos"]) != 3 * n:
        errs.append(f"initPos {len(out['initPos'])} != 3*{n}")
    dyn = n - out["static"]
    for k in ("radius", "friction"):
        if len(out[k]) not in (0, dyn):
            errs.append(f"{k} {len(out[k])} != 0 or {dyn} (dynamic nodes)")
    for i in range(out["static"]):
        if out["invMass"][i] != 0.0:
            errs.append(f"invMass[{i}] = {out['invMass'][i]}, expected 0 (static)")
    idx = (out["quads"]["n"] + out["bases"]["n"] + out["bases"]["x0"]
           + out["bases"]["x1"] + out["bases"]["y0"] + out["bases"]["y1"]
           + out["hinges"]["n"] + out["free"] + out["antiTunnel"]["targets"]
           + out["rods"]["n"] + out["axial"]["n"]
           + [t["orient"] for t in out["twists"]] + [t["end"] for t in out["twists"]]
           + [l["parent"] for l in out["dynKinLinks"]]
           + [l["child"] for l in out["dynKinLinks"]])
    bad = [i for i in idx if i < 0 or i >= n]
    if bad:
        errs.append(f"{len(bad)} node indices out of range 0..{n - 1}: {bad[:6]}")
    return errs


def read(path):
    try:
        return open(path, encoding="utf8", errors="replace").read()
    except OSError:
        return ""


SLEEP = re.compile(r"cloth_sleep_enabled\s*=\s*(true|false)")
sleep_by = {p: bool(SLEEP.search(t) and SLEEP.search(t).group(1) == "true")
            for p, t in sections(read(data_path)).items()}

index, failed, extra = {}, [], {}
for path, text in sorted(sections(read(phys_path)).items()):
    stem = os.path.basename(path).replace(".vmdl_c", "")
    # Rigid collision hulls, dropped as GLBs in §3 for the same reason.
    if stem.endswith("_physics"):
        continue
    try:
        fe = kv3_parse(text).get("m_pFeModel")
    except ValueError as e:
        failed.append(f"{stem}: {e}")
        continue
    if not isinstance(fe, dict):
        failed.append(f"{stem}: no m_pFeModel")
        continue
    for k in EXPECTED_EMPTY:
        v = fe.get(k)
        if isinstance(v, list) and v:
            extra.setdefault(k, []).append(stem)
    try:
        out = convert(fe, stem, sleep_by.get(path, False))
    except (KeyError, ValueError, TypeError) as e:
        failed.append(f"{stem}: {type(e).__name__} {e}")
        continue
    errs = check(out)
    if errs:
        failed.append(f"{stem}: " + "; ".join(errs))
        continue
    with open(os.path.join(dest, f"{stem}.phys.json"), "w") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=True)
    index[stem] = {
        "nodes": out["nodes"], "static": out["static"],
        "quads": len(out["quads"]["slack"]), "bases": len(out["bases"]["n"]),
        "hinges": len(out["hinges"]["center"]), "rods": len(out["rods"]["min"]),
        "axial": len(out["axial"]["te"]), "twists": len(out["twists"]),
    }

with open(os.path.join(dest, "charm-physics.json"), "w") as fh:
    json.dump(index, fh, indent=1, sort_keys=True)

if index:
    def rng(k):
        return min(v[k] for v in index.values()), max(v[k] for v in index.values())
    # The spans are the point of this line: the solver is data-driven, so an
    # outlier model should read as a number here rather than as a viewer that
    # drops to 5fps in production.
    print(f"--- Charm physics: {len(index)} cloth models  " + "  ".join(
        f"{k} {rng(k)[0]}-{rng(k)[1]}" for k in ("nodes", "quads", "rods", "hinges", "axial")))
for k, v in sorted(extra.items()):
    print(f"---   UNSUPPORTED {k} populated on {len(v)}: {', '.join(sorted(v)[:6])}")
for f in failed:
    print(f"---   skipped {f}")
if not index:
    print("!!! No charm physics recovered — charms fall back to the viewer's own "
          "pendulum. Check the `-b PHYS` output format.")
PYEOF

fi

# The icons/paints region is ALL OR NOTHING for ONLY_STEPS/SKIP_STEPS.
# econ-icons, paint-chain and sticker-art are one interleaved python flow —
# sticker-art is a sub-phase that paint-chain's own code opens and closes — so
# there is no seam to cut between them. Naming any of the three runs all three.
# It is guarded as a unit rather than left unguarded because it is the LONGEST
# part of a run, and an ONLY_STEPS that still paid for it would be no use.
if want_step "econ-icons" || want_step "paint-chain" || want_step "sticker-art"; then
# ---- 4. Econ item icons ------------------------------------------------------
step "econ-icons"
# Flat item artwork for everything the UI lists. We serve this ourselves — there
# is no third-party CDN in the serving path — so if it isn't written here, the
# tile is blank.
#
# Only `weapon` and `melee` get a 3D render (supports3d in src/itemVisuals.ts),
# and for those the flat icon is just the placeholder shown while the real bake
# runs. Everything else — stickers, agents, gloves, patches, charms, cases,
# graffiti — has NO other source, which is why a missing icon there is a
# permanently empty card rather than a slow one.
#
# The filenames are cs2-lib's (`item.image`), because that is what the catalog
# hands the frontend. cs2-lib names assets `<game-stem>_<hash8>.webp` using its
# own content hash, which we can't recompute — but stripping the suffix leaves
# the game asset's name, and that we can resolve.
#
# The stem is not enough on its own for DECALS: the archive files sticker art by
# event and a stem names one file per event, so those resolve by kit folder
# (§3f) and only everything else falls back to the basename rules. Measured on
# build 14116: 26849/26878 resolve — 8 vanilla gloves (ambiguous, see below) and
# 21 items newer than the installed game.
echo ""
echo "--- Extracting econ item icons…"

if [[ -n "$OUT_DIR" ]]; then IMG_DEST="$OUT_DIR/images"; else IMG_DEST="$WORK/images"; fi
# Paints are built in a STAGING dir and swapped in atomically at the end, so a
# run never disturbs what is being served. Materials reference textures by name,
# so a half-populated paints dir renders skins white — and an extraction takes
# long enough that somebody will hit it. The live copy stays untouched until the
# whole step succeeds.
#
# Only paints get this. Icons degrade gracefully (a blank tile that fills in on
# the next load) and models are written early and HEAD-probed before use, so
# neither earns the extra moving parts.
if [[ -n "$OUT_DIR" ]]; then PAINT_LIVE="$OUT_DIR/paints"; else PAINT_LIVE="$WORK/paints"; fi
PAINT_DEST="$PAINT_LIVE.next"
mkdir -p "$IMG_DEST" "$PAINT_LIVE/materials" "$PAINT_LIVE/textures"
rm -rf "$PAINT_DEST"

# Seed staging from the live copy with HARDLINKS: near-instant, no extra disk
# for the (many) files a run does not change, and it preserves the
# skip-what-exists resume in the texture pass.
#
# Only safe within the SAME CS2 build. Our texture filenames hash the archive
# PATH, not the contents — so if Valve changes a texture's bytes without moving
# it, the name is identical, the resume check sees the file and we would serve
# the old one forever. A build change therefore forces a clean rebuild.
#
# The SAME hazard applies to a change in THIS script's encoding of a texture,
# which is not a CS2 build change at all. v10 fixed the webp conversion that had
# been writing PNGs under .webp names since v6; seeding from live would have
# hardlinked all 2,647 of those in and the skip-what-exists resume would have
# left every one of them untouched, so the fix would have shipped as a no-op.
# Any stamp older than the version that last changed texture ENCODING has to
# rebuild from scratch.
PAINT_ENCODING_VERSION=13
read -r PREV_BUILD PREV_VERSION <<<"$(STAMP="$DEST/extract-version.json" python3 - <<'PYV' 2>/dev/null || echo " "
import json, os
try:
    d = json.load(open(os.environ["STAMP"]))
    print(d.get("gameBuild") or "-", d.get("version") or 0)
except Exception:
    print("-", 0)
PYV
)"
if [[ -n "$GAME_BUILD" && "$PREV_BUILD" == "$GAME_BUILD" && "${PREV_VERSION:-0}" -ge "$PAINT_ENCODING_VERSION" ]]; then
  echo "--- Seeding paint staging from the live copy (same CS2 build $GAME_BUILD)"
  cp -al "$PAINT_LIVE" "$PAINT_DEST"
elif [[ "${PREV_VERSION:-0}" -lt "$PAINT_ENCODING_VERSION" ]]; then
  echo "--- Paint texture encoding changed (mount v${PREV_VERSION:-0} < v$PAINT_ENCODING_VERSION) — rebuilding paints from scratch"
else
  echo "--- CS2 build changed (${PREV_BUILD:-none} -> ${GAME_BUILD:-unknown}) — rebuilding paints from scratch"
fi
mkdir -p "$PAINT_DEST/materials" "$PAINT_DEST/textures"

# The manifest generator needs cs2-lib, so it runs from whichever backend tree
# has node_modules: /app in the container image, ../backend from a repo checkout.
# Shared by steps 4 and 5 — icons and paints are both keyed off cs2-lib names.
ASSET_MANIFEST="$WORK/asset-manifest.json"
manifest_built=0
for backend_dir in "/app" "$(dirname "$0")/../backend"; do
  gen="$backend_dir/scripts/build-asset-manifest.mjs"
  if [[ -f "$gen" && -d "$backend_dir/node_modules/@ianlucas/cs2-lib" ]]; then
    if (cd "$backend_dir" && node "scripts/build-asset-manifest.mjs") >"$ASSET_MANIFEST" 2>/dev/null; then
      manifest_built=1
      break
    fi
  fi
done
if [[ "$manifest_built" != 1 ]]; then
  echo "!! Could not build the asset manifest (no backend tree with cs2-lib installed)."
  echo "   Skipping icons AND paints — item art will be blank and skins render white."
else
  RAW_ICONS="$WORK/raw_icons"
  rm -rf "$RAW_ICONS"

  CLI="$CLI" VPK="$VPK" VPK_LIST="$VPK_LIST" RAW_ICONS="$RAW_ICONS" \
  STICKER_KITS="$STICKER_KITS" \
  ASSET_MANIFEST="$ASSET_MANIFEST" IMG_DEST="$IMG_DEST" python3 - <<'PYEOF'
import glob, json, os, re, shutil, subprocess, sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

cli, vpk = os.environ["CLI"], os.environ["VPK"]
raw, dest = os.environ["RAW_ICONS"], os.environ["IMG_DEST"]
manifest = json.load(open(os.environ["ASSET_MANIFEST"]))["icons"]

# ---- pool sizing ------------------------------------------------------------
# Same worker count the panel writes and the decompile loop watches, re-read
# every time a pool is built (once per batch), so raising the knob mid-run
# speeds these steps up too.
#
# Floored at 4, unlike the decompile: these extract and convert TEXTURES at
# ~0.12 GB per process, so four of them still sit under the 1.3 GB a SINGLE
# decompile worker needs — memory the run has already spent by the time it gets
# here. Dropping them to one would add minutes to the icon and paint steps to
# save headroom nothing else is using.
CORES = int(os.environ.get("CORES") or 0) or (os.cpu_count() or 4)


def pool_size(cap=8):
    try:
        with open(os.environ["JOBS_FILE"]) as fh:
            n = int(fh.read().strip())
    except Exception:
        n = int(os.environ.get("EXTRACT_JOBS") or 1)
    return max(1, min(cap, CORES, max(4, n)))

ECON = "panorama/images/econ/"

# Kit id -> archive folder, for the decals whose basename is not unique. Empty
# if items_game.txt did not extract; the stem rules below still apply, they just
# can't tell two same-named stickers apart.
try:
    kit_dirs = json.load(open(os.environ["STICKER_KITS"]))
except Exception:
    kit_dirs = {}

# ---- index the archive's icons -------------------------------------------
# Key on the lowercased basename with the trailing `_png` dropped: the archive
# spells some assets in mixed case (cu_bizon_Curse) while cs2-lib lowercases,
# so an exact byte match silently loses items.
#
# BASENAMES COLLIDE — 3,907 of them, hiding 13,163 assets — so this map is the
# fallback, not the primary. Anything with a kit is resolved by full path below.
by_name = {}
by_path = {}
for line in open(os.environ["VPK_LIST"]):
    p = line.strip()
    if not p.startswith(ECON):
        continue
    by_path[p.lower()] = p
    base = re.sub(r"\.(vtex_c|vsvg_c)$", "", p.split("/")[-1])
    base = re.sub(r"_png$", "", base).lower()
    by_name.setdefault(base, p)

# Names that merely START with a wanted stem — sticker art carries a
# `_<schema>_<id>` tail that cs2-lib drops.
by_prefix = defaultdict(list)
for name in by_name:
    for i, ch in enumerate(name):
        if ch == "_":
            by_prefix[name[:i]].append(name)

TINT = re.compile(r"_([0-9a-f]{6})$")

def in_kit(kit, stem):
    """The asset at <kit folder>/<stem>, if the archive has it. Icons are
    `<name>_png.vtex_c`; a few are `<name>.vsvg_c`."""
    folder = kit_dirs.get(str(kit)) if kit is not None else None
    if not folder:
        return None
    for cand in (f"{ECON}{folder}/{stem}_png.vtex_c", f"{ECON}{folder}/{stem}.vsvg_c"):
        hit = by_path.get(cand.lower())
        if hit:
            return hit
    return None


def resolve(stem, kit=None):
    """-> (archive path or None, tint hex or None, reason). Order matters: the
    wear/tint rules must not fire before an exact hit, or e.g. a skin literally
    named ..._light would resolve to the wrong asset."""
    s = stem.lower()
    # A kit names the exact folder, which is the only way to tell the three
    # `ibuypower` stickers apart. Tried FIRST and by full path: a basename hit is
    # not evidence of anything when 3,907 basenames are ambiguous.
    folder = kit_dirs.get(str(kit)) if kit is not None else None
    if folder:
        hit = in_kit(kit, s)
        if hit:
            return hit, None, "kit"
        m = TINT.search(s)
        if m:
            hit = in_kit(kit, s[: m.start()])
            if hit:
                return hit, m.group(1), "kit-tint"
        # The folder is known and the art is not in it: the item is newer than
        # the installed game (the 20 Budapest 2025 slabs on build 14116). Falling
        # through to the basename rules would find a SAME-NAMED sticker from
        # another event and publish it as this one — the wrong-art-that-looks-
        # right failure the gloves comment below is about. Report it instead.
        return None, None, "absent"
    if s in by_name:
        return by_name[s], None, "exact"
    # Weapon skin icons ship one per wear tier; they differ only in the amount
    # of battle-scarring drawn on. `light` is the cleanest and reads best small.
    for tier in ("light", "medium", "heavy"):
        if f"{s}_{tier}" in by_name:
            return by_name[f"{s}_{tier}"], None, "wear"
    # Graffiti: cs2-lib mints one item per TINT, appending the rgb hex to the
    # base name. The archive only ships the untinted white stencil.
    m = TINT.search(s)
    if m and s[: m.start()] in by_name:
        return by_name[s[: m.start()]], m.group(1), "tint"
    # Sticker art appends a `_<schema>_<id>` tail cs2-lib drops, so a UNIQUE
    # prefix match is that same asset. Several matches is not a near-miss to be
    # broken by "shortest wins": the vanilla gloves land here, and the archive
    # only ships their SKINNED variants (sporty_gloves -> 57 of them). Guessing
    # publishes a random skin as the vanilla item, which reads as correct and is
    # wrong — strictly worse than the blank tile. Report it instead.
    cands = by_prefix.get(s)
    if cands and len(cands) == 1:
        return by_name[cands[0]], None, "prefix"
    return None, None, ("ambiguous" if cands else "absent")

wanted = defaultdict(list)   # archive path -> [(out name, tint)]
missing = []
for entry in manifest:
    path, tint, reason = resolve(entry["stem"], entry.get("kit"))
    if path is None:
        missing.append(dict(entry, reason=reason))
        continue
    wanted[path].append((entry["out"], tint))

print(f"---   {len(manifest)} icons wanted, {len(wanted)} distinct archive assets")

# ---- extract + convert ---------------------------------------------------
# `-f` takes a COMMA-SEPARATED LIST and accepts exact file paths, so a single
# process extracts exactly the icons we want. It only honours exact paths when
# `-e` is OMITTED — with an extension filter it silently matches nothing.
#
# The previous approach unpacked whole econ subtrees, which decompiled ~19k
# assets we never use (and made `stickers` a single 8.5k-asset serial stall).

def convert(src, out, tint, crop=False):
    dst = os.path.join(dest, out)
    # CHARM icons are a narrow vertical charm floating in a 512x384 landscape
    # canvas — measured, the art is 26% of the width and 74% of the height, and
    # on the crystal only 22% wide. Fitted into a square UI tile that letterboxes
    # to 32x24 and then draws the charm at about 8x18: a seventh of the tile,
    # which is why an equipped charm was unreadable at every size we show it.
    #
    # Trimmed here rather than zoomed in CSS because the padding is not uniform
    # across charms (the USP jewel is 50% x 53%), so any fixed transform that
    # fills one clips another. Trimming makes the icon BE the charm, and every
    # surface — slot, picker, tile chip — gets it for free.
    trim = ["-bordercolor", "none", "-fuzz", "1%", "-trim", "+repage",
            "-bordercolor", "none", "-border", "3%"] if crop else []
    if tint:
        # Multiply, not -colorize: the stencils carry internal shading (measured
        # weighted luminance 0.49, not a flat 1.0), and colorize would flatten
        # it to a solid slab. Alpha is re-attached because the composite drops
        # it, which showed up as NaN coverage.
        cmd = ["convert", src, "-colorspace", "sRGB",
               "(", "+clone", "-alpha", "off", "-fill", f"#{tint}", "-colorize", "100", ")",
               "-compose", "Multiply", "-composite",
               "(", src, "-alpha", "extract", ")", "-compose", "CopyOpacity", "-composite",
               *trim, "-quality", "85", dst]
    else:
        cmd = ["convert", src, *trim, "-quality", "85", dst]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return True
    except Exception:
        return False

have_convert = shutil.which("convert") is not None
if not have_convert:
    print("!!  ImageMagick `convert` not found — writing PNG instead of webp "
          "(~8x larger). Install imagemagick for the real output.")


# Unit-level progress for the panel. Written to the same file the shell uses —
# see the `progress` helper there for why it is a file and not stdout.

def progress(step, done, total, state="running", secs=None):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one.

    `state="done"` with `secs` closes a step the way the shell's `step` helper
    does, for a program that spans more than one step."""
    pf = os.environ.get("PROGRESS_FILE")
    if not pf:
        return
    try:
        try:
            with open(pf) as fh:
                doc = json.load(fh)
        except Exception:
            doc = {"steps": []}
        for s in doc.get("steps", []):
            if s["name"] == step:
                s["state"] = state
                s["done"], s["total"] = done, total
                if secs is not None:
                    s["secs"] = secs
                break
        else:
            # The step id must exist in the shell's STEPS list or the update
            # lands nowhere and the row sits indeterminate forever — which is
            # exactly how "paint-textures" vs "paint-chain" hid for a whole run.
            print(f"!! progress: no step named {step!r} — check STEPS in the shell",
                  file=__import__("sys").stderr)
        doc["at"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(pf, "w") as fh:
            json.dump(doc, fh)
    except Exception:
        pass

written, failed = 0, []
todo_paths = sorted(wanted)
# Publish the denominator BEFORE the first batch. Progress is otherwise only
# reported once a 150-item batch finishes, and until the first one lands the
# panel sees a running step with no total — which it renders as an
# indeterminate bar, indistinguishable from stuck. Matters most when there is
# nothing to do: the loop never runs, so nothing was ever reported at all.
progress("econ-icons", 0, len(manifest))
BATCH = 150
for bi in range(0, len(todo_paths), BATCH):
    batch = todo_paths[bi:bi + BATCH]
    shutil.rmtree(raw, ignore_errors=True)
    os.makedirs(raw, exist_ok=True)
    workers = pool_size()
    stride = max(1, (len(batch) + workers - 1) // workers)
    slices = [batch[i:i + stride] for i in range(0, len(batch), stride)]

    def grab(paths):
        subprocess.run([cli, "-i", vpk, "-o", raw, "-d", "-f", ",".join(paths)],
                       capture_output=True)

    with ThreadPoolExecutor(max_workers=len(slices)) as pool:
        list(pool.map(grab, slices))

    jobs = []
    for path in batch:
        # The CLI picks the container from the texture format, and a handful of
        # econ assets are .vsvg_c rather than .vtex_c — probe by glob so a
        # silent skip can't pass for "no such icon".
        stem = os.path.join(raw, re.sub(r"\.vtex_c$|\.vsvg_c$", "", path))
        src = next(iter(sorted(glob.glob(glob.escape(stem) + ".*"))), None)
        if src is None:
            failed.extend(o for o, _ in wanted[path])
            continue
        # `econ/keychains/...` is the charm namespace in the econ schema.
        crop = "/keychains/" in path
        for out, tint in wanted[path]:
            if not have_convert:
                shutil.copyfile(src, os.path.join(dest, out.replace(".webp", ".png")))
                written += 1
            else:
                jobs.append((src, out, tint, crop))

    if jobs:
        with ThreadPoolExecutor(max_workers=pool_size(CORES)) as pool:
            for ok, (_, out, _, _) in zip(pool.map(lambda j: convert(*j), jobs), jobs):
                if ok:
                    written += 1
                else:
                    failed.append(out)
    print(f"---   icons {written}/{len(manifest)}", flush=True)
    progress("econ-icons", written, len(manifest))

shutil.rmtree(raw, ignore_errors=True)
print(f"--- Wrote {written} icons to {dest}")

# Two very different failures. A 3D-rendered type degrades to "slow" (the bake
# still draws it); anything else degrades to a permanently blank tile — so the
# counts are reported apart rather than as one reassuring total.
blocking = [m for m in missing if not m["placeholderOnly"]]
placeholder = [m for m in missing if m["placeholderOnly"]]
if placeholder:
    print(f"--- {len(placeholder)} unresolved icons are 3D-rendered types "
          f"(placeholder only — cards still bake)")
if blocking:
    by_type = defaultdict(int)
    for m in blocking:
        by_type[m["type"]] += 1
    print(f"!!! {len(blocking)} icons have NO other source and will render blank: "
          + ", ".join(f"{t}x{n}" for t, n in sorted(by_type.items())))
    # Two different causes, two different fixes — don't report them as one.
    absent = [m for m in blocking if m["reason"] == "absent"]
    ambiguous = [m for m in blocking if m["reason"] == "ambiguous"]
    if absent:
        print(f"!!!   {len(absent)} absent from the archive, e.g. "
              + ", ".join(m["out"] for m in absent[:4]))
        print("!!!   Usually means the installed CS2 build predates these items.")
    if ambiguous:
        print(f"!!!   {len(ambiguous)} matched several assets and were NOT guessed, e.g. "
              + ", ".join(m["out"] for m in ambiguous[:4]))
        print("!!!   Mostly vanilla gloves: the archive ships only skinned variants, "
              "so any pick would be a wrong image dressed up as the right one.")
if failed:
    print(f"!!! {len(failed)} icons failed to convert, e.g. {failed[:5]}")
PYEOF

  # ---- 5. Paint chain --------------------------------------------------------
  # The skin finishes themselves: a vcompmat per paint (loose per-skin values)
  # pointing at a shared template vmat, which in turn names the pattern/normal/
  # mask textures. Without these the compositor falls back to defaults and every
  # skin renders untextured white.
  #
  # cs2-lib publishes these as JSON — a KV3 dump with scalars stringified and
  # resource references rewritten to asset paths. We reproduce that from the
  # archive: `-b DATA` gives the KV3 text, we parse it, rewrite the references to
  # our own filenames, and emit the same shape. Only the ENTRY filenames have to
  # match cs2-lib (the catalog's `paintMaterial`); includes and textures are
  # referenced from inside the JSON we write, so those names are ours to choose.
  #
  # Verified against the pre-cut mirror: our output is semantically identical.
  # Floats differ in TEXT only — VRF prints 0.24 where cs2-lib had
  # 0.23999999463558197, the same float32 — so compare numerically, not bytewise.
  step "paint-chain"
  echo ""
  echo "--- Extracting paint chain…"
  RAW_PAINTS="$WORK/raw_paints"
  rm -rf "$RAW_PAINTS"
  CLI="$CLI" VPK="$VPK" VPK_LIST="$VPK_LIST" RAW_PAINTS="$RAW_PAINTS" \
  CHARM_MATS="$WORK/charm-materials.json" CHARM_TEXTURES="$WORK/charm-textures.json" \
  PATCH_MATS="$WORK/patch-materials.json" STICKER_KITS="$STICKER_KITS" \
  ASSET_MANIFEST="$ASSET_MANIFEST" PAINT_DEST="$PAINT_DEST" python3 - <<'PYEOF'
import glob, hashlib, json, os, re, shutil, subprocess, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

STARTED = time.time()
cli, vpk = os.environ["CLI"], os.environ["VPK"]
raw, dest = os.environ["RAW_PAINTS"], os.environ["PAINT_DEST"]
manifest = json.load(open(os.environ["ASSET_MANIFEST"])).get("paints", [])
# Charm materials, handed over by the charm-models step (§3e). They are entry
# points like any other, but they do not come from cs2-lib — a charm has no
# paintMaterial, its material is named by the econ schema — so they arrive as
# raw archive paths rather than manifest entries. 23 materials, ~4 textures
# each: the whole reason the community charms can render at all, since their
# model is a shared blank and the material is the entire difference between one
# charm and the next.
CHARM_MATS = []
try:
    with open(os.environ.get("CHARM_MATS") or "") as fh:
        CHARM_MATS = [p for p in json.load(fh) if isinstance(p, str)]
except Exception:
    pass
# Charm TINT MASKS, from the same step: {archive path -> the filename §3e told
# charm-shading.json to expect}. These are textures with no material to reach
# them by — 58 of the 81 charms keep their art inside the GLB, so their mask has
# no entry point on the chain at all — and without them the shading map's
# tintMask URL points at a file nobody wrote and the whole charm recolours.
CHARM_TEXTURES = {}
try:
    with open(os.environ.get("CHARM_TEXTURES") or "") as fh:
        CHARM_TEXTURES = {k: v for k, v in json.load(fh).items() if isinstance(v, str)}
except Exception:
    pass
# Patch materials, handed over by step 3f, and for the SAME reason the charms
# are: cs2-lib gives a patch no paintMaterial (0 of 112), so nothing about a
# patch reaches the manifest and the chain would never see one. 112 materials,
# each pulling its own art plus the two shared embroidery maps under
# patches/shared/.
PATCH_MATS = []
try:
    with open(os.environ.get("PATCH_MATS") or "") as fh:
        PATCH_MATS = [p for p in json.load(fh) if isinstance(p, str)]
except Exception:
    pass

# ---- pool sizing ------------------------------------------------------------
# Same worker count the panel writes and the decompile loop watches, re-read
# every time a pool is built (once per batch), so raising the knob mid-run
# speeds these steps up too.
#
# Floored at 4, unlike the decompile: these extract and convert TEXTURES at
# ~0.12 GB per process, so four of them still sit under the 1.3 GB a SINGLE
# decompile worker needs — memory the run has already spent by the time it gets
# here. Dropping them to one would add minutes to the icon and paint steps to
# save headroom nothing else is using.
CORES = int(os.environ.get("CORES") or 0) or (os.cpu_count() or 4)


def pool_size(cap=8):
    try:
        with open(os.environ["JOBS_FILE"]) as fh:
            n = int(fh.read().strip())
    except Exception:
        n = int(os.environ.get("EXTRACT_JOBS") or 1)
    return max(1, min(cap, CORES, max(4, n)))


# Unit-level progress for the panel. Written to the same file the shell uses —
# see the `progress` helper there for why it is a file and not stdout.#
# This program covers TWO steps — the paint chain and the sticker art that
# follows it — so it also has to CLOSE them, with their own elapsed times. The
# shell's `step` helper can't: it sees one heredoc and would bill the whole run
# to paint-chain, leaving sticker-art showing "running" forever and hiding how
# long ~3.2k sticker textures actually take.

def progress(step, done, total, state="running", secs=None):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one.

    `state="done"` with `secs` closes a step the way the shell's `step` helper
    does, for a program that spans more than one step."""
    pf = os.environ.get("PROGRESS_FILE")
    if not pf:
        return
    try:
        try:
            with open(pf) as fh:
                doc = json.load(fh)
        except Exception:
            doc = {"steps": []}
        for s in doc.get("steps", []):
            if s["name"] == step:
                s["state"] = state
                s["done"], s["total"] = done, total
                if secs is not None:
                    s["secs"] = secs
                break
        else:
            # The step id must exist in the shell's STEPS list or the update
            # lands nowhere and the row sits indeterminate forever — which is
            # exactly how "paint-textures" vs "paint-chain" hid for a whole run.
            print(f"!! progress: no step named {step!r} — check STEPS in the shell",
                  file=__import__("sys").stderr)
        doc["at"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(pf, "w") as fh:
            json.dump(doc, fh)
    except Exception:
        pass

# ---- KV3 text parser -------------------------------------------------------
# Small on purpose: paint KV3 only uses objects, arrays, strings, numbers,
# booleans and `resource:"..."` refs. No binary blobs, no heredocs.
_TOKEN = re.compile(
    r"""
      (?P<ws>\s+)
    | (?P<comment><!--.*?-->)
    | (?P<blob>\#\[[^\]]*\])
    | (?P<punct>[\{\}\[\],=])
    | (?P<prefixed>[A-Za-z_][A-Za-z0-9_]*:"(?:[^"\\]|\\.)*")
    | (?P<string>"(?:[^"\\]|\\.)*")
    | (?P<number>[-+]?(?:\d+\.\d+(?:[eE][-+]?\d+)?|\.\d+|\d+))
    | (?P<ident>[A-Za-z_][A-Za-z0-9_.]*)
    """,
    re.X | re.S,
)


class Ref(str):
    """A `resource:"..."` value. Subclasses str so it still reads as the game
    path, but stays distinguishable so the rewrite finds every reference
    instead of sniffing for path-shaped strings."""
    __slots__ = ()


def kv3_parse(text):
    pos, end, buf = 0, len(text), []

    def pump():
        nonlocal pos
        while pos < end:
            m = _TOKEN.match(text, pos)
            if not m:
                raise ValueError(f"cannot tokenize at {text[pos:pos + 40]!r}")
            pos = m.end()
            if m.lastgroup not in ("ws", "comment"):
                return (m.lastgroup, m.group())
        return None

    def peek():
        if not buf:
            t = pump()
            if t is None:
                return None
            buf.append(t)
        return buf[0]

    def take():
        peek()
        return buf.pop(0) if buf else None

    def value():
        tok = take()
        if tok is None:
            raise ValueError("unexpected end of input")
        kind, text_ = tok
        if kind == "punct" and text_ == "{":
            obj = {}
            while True:
                nxt = peek()
                if nxt is None:
                    raise ValueError("unterminated object")
                if nxt[1] == "}":
                    take()
                    return obj
                if nxt[1] == ",":
                    take()
                    continue
                kkind, key = take()
                if kkind == "string":
                    key = key[1:-1]
                elif kkind != "ident":
                    raise ValueError(f"bad key {key!r}")
                eq = take()
                if eq is None or eq[1] != "=":
                    raise ValueError(f"expected = after {key!r}")
                obj[key] = value()
        if kind == "punct" and text_ == "[":
            arr = []
            while True:
                nxt = peek()
                if nxt is None:
                    raise ValueError("unterminated array")
                if nxt[1] == "]":
                    take()
                    return arr
                if nxt[1] == ",":
                    take()
                    continue
                arr.append(value())
        # KV3 binary blob: `#[ 07 00 00 ... ]`. Nothing here ever reads the
        # bytes — they carry compiled shader state — but the tokenizer has to
        # recognise them or the whole document fails. That is not hypothetical:
        # every charm material has one, so all 23 of them errored out with
        # "cannot tokenize at '#['" and no charm material was ever written.
        if kind == "blob":
            return None
        if kind == "string":
            return text_[1:-1]
        if kind == "prefixed":
            return Ref(text_[text_.index(":") + 1:][1:-1])
        if kind == "number":
            return float(text_) if re.search(r"[.eE]", text_) else int(text_)
        if kind == "ident":
            return {"true": True, "false": False, "null": None}.get(text_, text_)
        raise ValueError(f"unexpected token {text_!r}")

    return value()


# ---- archive index ---------------------------------------------------------
# Every compiled material, keyed "<basename>.<kind>" lowercased (the archive
# mixes case; cs2-lib lowercases). Also keyed by full path so a reference from
# inside a KV3 resolves directly.
by_key, by_path = {}, {}
for line in open(os.environ["VPK_LIST"]):
    p = line.strip()
    m = re.search(r"\.(vcompmat_c|vmat_c|vtex_c)$", p)
    if not m:
        continue
    by_path[p.lower()] = p
    kind = m.group(1)[:-2]
    base = os.path.basename(p)[: -(len(m.group(1)) + 1)]
    by_key.setdefault(f"{base}.{kind}".lower(), p)


def resolve_ref(ref):
    """A reference names the SOURCE asset ("....vmat"); the archive holds the
    COMPILED one ("....vmat_c")."""
    cand = f"{ref}_c".lower()
    if cand in by_path:
        return by_path[cand]
    m = re.search(r"\.(vcompmat|vmat|vtex)$", ref)
    return by_key.get(f"{os.path.basename(ref)[: -(len(m.group(1)) + 1)]}.{m.group(1)}".lower()) if m else None


# ---- output naming ---------------------------------------------------------
# cs2-lib's exact filename where it has one (the catalog's paintMaterial points
# at it and must resolve); otherwise our own stable name. The short hash keeps
# same-named assets in different trees apart.
#
# Sticker vmats are keyed by BASENAME in the archive index above, and sticker
# basenames are not unique — `stickers/emskatowice2014/ibuypower.vmat_c` and
# `stickers/cologne2014/ibuypower.vmat_c` are different art. This is the material
# the viewer DRAWS on the weapon, so a basename match put the wrong event's
# sticker on the gun. The kit's folder (§3f) makes it exact: 10,565/10,565.
try:
    kit_dirs = json.load(open(os.environ["STICKER_KITS"]))
except Exception:
    kit_dirs = {}

wanted_name = {}
unresolved = []
for entry in manifest:
    folder = kit_dirs.get(str(entry["kit"])) if entry.get("kit") is not None else None
    path = by_path.get(f"{folder}/{entry['stem']}.{entry['kind']}_c".lower()) if folder else None
    if path is None and not folder:
        path = by_key.get(f"{entry['stem']}.{entry['kind']}".lower())
    if path:
        wanted_name[path] = entry["out"]
    else:
        unresolved.append(entry["out"])


def out_name(path, kind):
    if path in wanted_name:
        return wanted_name[path]
    stem = os.path.basename(path)
    stem = stem[: stem.index(".")]
    h = hashlib.sha1(path.encode()).hexdigest()[:8]
    return f"{stem}_{h}.{'webp' if kind == 'vtex' else kind + '.json'}"


def asset_url(path, kind):
    return f"/{'textures' if kind == 'vtex' else 'materials'}/{out_name(path, kind)}"


# ---- bulk DATA dump --------------------------------------------------------
# One CLI process per tree instead of ~12k: each start re-opens the 132k-entry
# archive index, which dwarfs the parsing. The trees are DERIVED from where the
# entry points actually live (paints sit under weapons/, gloves/, stickers/,
# workshop/paintkits/ and the customization tree) — hardcoding them silently
# lost every sticker vmat and the case-hardening templates.
HEADER = re.compile(r"^\[\d+/\d+\]\s+(\S+)\s*$")


def split_blocks(stdout, out):
    cur, buf = None, []
    for line in stdout.splitlines():
        m = HEADER.match(line)
        if m:
            if cur:
                out[cur] = "\n".join(buf)
            cur, buf = m.group(1), []
        elif cur is not None:
            buf.append(line)
    if cur:
        out[cur] = "\n".join(buf)
    return out


def dump(spec):
    prefix, ext = spec
    proc = subprocess.run([cli, "-i", vpk, "-f", prefix, "-e", ext, "-b", "DATA"],
                          capture_output=True, text=True, errors="replace")
    return split_blocks(proc.stdout, {})


# Entry points only live in weapons/paints/ and gloves/paints/, but every one of
# them REFERENCES a template vmat that lives somewhere else entirely:
#
#   materials/models/weapons/customization/  -> the per-skin template vmats and
#                                               default_composite_inputs
#   workshop/paintkits/                      -> shared gunsmith/case-hardening
#
# Those are structural, not incidental, so dump them as trees rather than
# leaning on the per-file fallback below — it works, but it is one CLI process
# per template, and a template that fails to resolve takes its skin down with
# it. Deagle | Blaze rendered broken for exactly this reason: its vcompmat
# pointed at aa_flames.vmat.json and nothing had written it.
TEMPLATE_TREES = {"materials/models/weapons/customization/", "workshop/paintkits/"}
# Patch entry points are raw archive paths, not manifest entries, so their tree
# has to join the bulk dump — otherwise all 112 fall through to the
# one-CLI-process-per-file path below. Charms are deliberately NOT added: there
# are only 23 of them, that path already works, and widening a working bulk dump
# is not what this change is for.
EXTRA_TREES = {"/".join(p.split("/")[:2]) + "/" for p in PATCH_MATS}
TREES = sorted({"/".join(p.split("/")[:2]) + "/" for p in wanted_name} | TEMPLATE_TREES | EXTRA_TREES)
specs = [(t, e) for t in TREES for e in ("vcompmat_c", "vmat_c")]
blocks = {}
with ThreadPoolExecutor(max_workers=max(2, min(pool_size(), len(specs)))) as pool:
    for part in pool.map(dump, specs):
        blocks.update(part)
print(f"---   dumped {len(blocks)} material blocks from {len(TREES)} trees")


def kv3_body(text):
    i = text.find('--- Data for block "DATA" ---')
    return text[text.index("\n", i) + 1:] if i >= 0 else text


# Strings that NAME a resource. Used by both the graph walk and the rewrite —
# they have to agree on what counts as a reference.
RESOURCE_SUFFIX = re.compile(r"\.(vcompmat|vmat|vtex)$")

# The only textures a csgo_weapon_sticker.vfx material contributes — see the
# cutoff in the walk below for why this is an allowlist and not the whole chain.
# Named after the shader's own params so the two can be compared by eye against
# a `-b DATA` dump.
#
#   g_tSticker0                 the square albedo (512x512, no padding)
#   g_tStickerScratches         Valve's authored wear mask, shared
#   g_tSfxMaskSticker0          which texels take the effect; per-sticker
#   g_tHoloSpectrumSticker0     holo/gold rainbow ramp, shared
#   g_tGlitterNormalSticker0    glitter sparkle normals (starmoon/magnolia/squares)
#   g_tNormalRoughnessSticker0  2-channel normal + roughness in .z
#   g_tColor                    the paper backing, shared
#
# Deliberately NOT here: g_tAmbientOcclusion / g_tMetalness / g_tNormal, which
# on a sticker material are the flat engine defaults and carry nothing.
STICKER_TEXTURES = {
    "g_tSticker0",
    "g_tStickerScratches",
    "g_tSfxMaskSticker0",
    "g_tHoloSpectrumSticker0",
    "g_tGlitterNormalSticker0",
    "g_tNormalRoughnessSticker0",
    "g_tColor",
}

# ---- walk the graph from every entry point ---------------------------------
# `sticker_textures` is a subset of `textures`, tracked so the two get their own
# progress rows and their own times — a sticker run adds thousands of files and
# billing that to the paint chain makes the paint chain look like it regressed.
docs, textures, sticker_textures, failed = {}, set(), set(), []
seen_charm = set()
queue = [p for p in wanted_name if p.endswith(("vcompmat_c", "vmat_c"))]
# Charm materials resolve by exact archive path, so they skip the by_key lookup
# the manifest entries need. out_name() falls through to its hash naming for
# them, which is what charm-models.json was written against.
for p in CHARM_MATS + PATCH_MATS:
    if p not in seen_charm:
        seen_charm.add(p)
        queue.append(p)
seen = set(queue)
while queue:
    path = queue.pop()
    body = blocks.get(path)
    if body is None:
        # Reached by reference from outside the entry-point trees — the shared
        # workshop/paintkits templates do this. Rare enough to fetch one at a
        # time rather than widen the bulk dump.
        proc = subprocess.run([cli, "-i", vpk, "-f", path, "-b", "DATA"],
                              capture_output=True, text=True, errors="replace")
        split_blocks(proc.stdout, blocks)
        body = blocks.get(path)
    if body is None:
        failed.append(f"{path} (no DATA block)")
        continue
    try:
        doc = kv3_parse(kv3_body(body))
    except Exception as e:
        failed.append(f"{path} ({e})")
        continue
    docs[path] = doc

    # STICKERS STOP HERE — but they take a NAMED SET with them, not one texture.
    #
    # A sticker/patch material is an entry point like any other, and following
    # its whole chain would quadruple the texture count. So the walk still stops
    # (the `continue` below is load-bearing); what changed in v19 is which
    # textures come along.
    #
    # It was `g_tSticker0` alone, the square albedo the game puts on the weapon.
    # That is enough to draw a sticker FLAT and nothing else: the game's own
    # wear is `g_tStickerScratches` — a real authored scratch mask — and the
    # holo/glitter/gold finishes are driven by `g_tSfxMaskSticker0` against a
    # spectrum and a glitter normal. Without them the viewer approximated wear
    # with value noise and could not draw an effect finish at all.
    #
    # The set is bounded and cheap. Everything except `g_tSfxMaskSticker0` is
    # SHARED — `materials/default/stickers/*` and
    # `materials/stickers/glitter_pattern/*`, ~13 files that dedupe by archive
    # path through out_name() no matter how many stickers name them. Only the
    # sfx mask is per-sticker, and only effect finishes have one (~1.1k).
    #
    # Recognised by shader name rather than by the manifest flag so a material
    # reached BY REFERENCE is treated the same way as one we asked for.
    if str(doc.get("m_shaderName") or "") == "csgo_weapon_sticker.vfx":
        for tp in doc.get("m_textureParams") or []:
            if isinstance(tp, dict) and tp.get("m_name") in STICKER_TEXTURES:
                target = resolve_ref(str(tp.get("m_pValue") or ""))
                if target and target.endswith("vtex_c"):
                    textures.add(target)
                    sticker_textures.add(target)
        continue

    def visit(node):
        # Follow typed `resource:` refs AND plain strings that name a resource.
        # These MUST match what convert() rewrites, or the two disagree and you
        # get a correct-looking reference to a file nothing ever wrote.
        #
        # That is not hypothetical: every skin's template vmat is referenced as
        # `m_strSpecificContainerMaterial = "materials/.../aa_flames.vmat"` — a
        # bare string, not a Ref. Walking only Refs meant no template was ever
        # queued, so Deagle | Blaze shipped a vcompmat pointing at a vmat that
        # did not exist, and rendered broken.
        if isinstance(node, (Ref, str)):
            raw = str(node)
            if not isinstance(node, Ref) and not RESOURCE_SUFFIX.search(raw):
                return
            target = resolve_ref(raw)
            if not target:
                return
            if target.endswith("vtex_c"):
                textures.add(target)
            elif target not in seen:
                seen.add(target)
                queue.append(target)
        elif isinstance(node, dict):
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(doc)

# Charm tint masks join the texture set directly — nothing in the graph walk
# reaches them. Their names are also CHECKED here rather than trusted: §3e wrote
# the URL into charm-shading.json from the same hash rule, and a silent
# disagreement between the two is a 404 that reads as "this charm has no mask",
# which is exactly the bug the mask exists to fix.
for path, expected in CHARM_TEXTURES.items():
    textures.add(path)
    actual = out_name(path, "vtex")
    if actual != expected:
        print(f"!!! charm tint mask naming disagrees: {path} -> {actual}, shading map says {expected}")
if CHARM_TEXTURES:
    print(f"---   {len(CHARM_TEXTURES)} charm tint masks added directly")

print(f"---   {len(docs)} materials reachable, {len(textures)} textures referenced")

# ---- serialise -------------------------------------------------------------
# cs2-lib stringifies every scalar (1 -> "1", -50.0 -> "-50", true -> "1").
# Everything downstream runs Number() over these, so the exact spelling only
# matters for matching the reference format.


def scalar(v):
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        f = float(v)
        return str(int(f)) if f.is_integer() and abs(f) < 1e15 else repr(f)
    return v


def rewrite(ref):
    target = resolve_ref(ref)
    if not target:
        return ref  # dangling in the archive too — leave it legible
    return asset_url(target, "vtex" if target.endswith("vtex_c") else
                     ("vcompmat" if target.endswith("vcompmat_c") else "vmat"))


def convert(node):
    if isinstance(node, Ref):
        return rewrite(str(node))
    if isinstance(node, dict):
        return {k: convert(v) for k, v in node.items()}
    if isinstance(node, list):
        return [convert(v) for v in node]
    if node is None:
        return None
    # Plain strings that name a resource get rewritten too — m_materialName and
    # m_stringAttributes carry paths without the resource: prefix, and cs2-lib
    # rewrote those as well.
    if isinstance(node, str) and RESOURCE_SUFFIX.search(node):
        return rewrite(node)
    return scalar(node)


# ---- textures FIRST ---------------------------------------------------------
# Order matters, and it is the whole reason this step used to break the site
# mid-run. A material NAMES its textures, so writing materials first left the
# mount holding materials that pointed at files not yet extracted — for the
# several minutes the texture pass takes. Anything viewed in that window
# composited on fallbacks and rendered as a white gun.
#
# Textures first inverts that. Old textures are never deleted, so at every
# instant every material on disk resolves: either the previous material with its
# textures still present, or the new one with textures already written. The
# worst a reader sees is a material that hasn't been refreshed yet, which is a
# correct older skin rather than a broken new one.
have_cwebp = shutil.which("cwebp") is not None
tex_dir = os.path.join(dest, "textures")
missing = [t for t in sorted(textures) if not os.path.exists(os.path.join(tex_dir, out_name(t, "vtex")))]
# Two phases, two progress rows, two times: paint textures under "paint-chain"
# and sticker art under "sticker-art". Sticker art is thousands of files on a
# first run, and billing that to the paint chain makes an unchanged paint chain
# look like it doubled.
paint_todo = [t for t in missing if t not in sticker_textures]
sticker_todo = [t for t in missing if t in sticker_textures]
print(f"---   {len(paint_todo)} paint textures + {len(sticker_todo)} sticker textures to extract "
      f"({len(textures) - len(missing)} already present)")

# `-f` takes a COMMA-SEPARATED LIST and accepts exact file paths, so one process
# can extract exactly the textures we want. The catch: it only honours exact
# paths when `-e` is OMITTED — combined with an extension filter it silently
# matches nothing and writes zero files.
#
# This matters enormously. One call per texture ran at ~1.6/s (each start
# re-opens the 132k-entry index) — about 85 minutes. Unpacking whole folders
# instead was worse: some hold thousands of textures we don't need, and it was
# tracking to ~3 hours. Exact batches do neither.
BATCH = 150
converted = 0


def extract_textures(todo, step, close=False):
  """Pull and convert one phase's textures, reporting under `step`.

  `close` marks the step finished with its own elapsed time — the sticker phase
  ends here, while the paint phase still has its materials to write."""
  global converted
  started = time.time()
  converted = 0
  # See the econ-icons pass: publish the denominator before the first batch so
  # the panel has a determinate bar from the start.
  progress(step, 0, len(todo))
  for bi in range(0, len(todo), BATCH):
    batch = todo[bi:bi + BATCH]
    shutil.rmtree(raw, ignore_errors=True)
    os.makedirs(raw, exist_ok=True)
    # Split across cores; each sub-batch is still one process for many files.
    workers = pool_size()
    stride = max(1, (len(batch) + workers - 1) // workers)
    slices = [batch[i:i + stride] for i in range(0, len(batch), stride)]

    def grab(paths):
        subprocess.run([cli, "-i", vpk, "-o", raw, "-d", "-f", ",".join(paths)],
                       capture_output=True)

    with ThreadPoolExecutor(max_workers=len(slices)) as pool:
        list(pool.map(grab, slices))
    jobs = []
    for t in batch:
        # The CLI picks the container from the texture FORMAT, so 8-bit maps
        # land as .png but float ones (position/PFM) come out .exr. Probe by
        # glob rather than guessing the list — a silent skip here is a texture
        # the compositor then substitutes a default for.
        stem = os.path.join(raw, re.sub(r"\.vtex_c$", "", t))
        src = next(iter(sorted(glob.glob(glob.escape(stem) + ".*"))), None)
        if src is None:
            failed.append(f"{t} (no image written)")
            continue
        jobs.append((src, os.path.join(tex_dir, out_name(t, "vtex"))))

    def to_webp(job):
        src, dst = job
        # Write to a temp and rename. Staging is seeded with HARDLINKS to the
        # live copy, so writing a texture in place would mutate the file being
        # served right now. Today the skip-existing filter above means we never
        # touch an existing texture — but that is an accident of ordering, and
        # this makes it safe by construction. It also means a reader can never
        # catch a half-written image.
        tmp = dst + ".tmp"
        try:
            if not have_cwebp:
                # Copy the PNG bytes under the .webp name. Ugly, but it is what
                # this line did for its whole life before v10 and it renders
                # CORRECTLY — browsers sniff the content. Never fall back to
                # ImageMagick's WebP writer: see below.
                shutil.copyfile(src, tmp)
            else:
                # Three corrections to one line, all from 2026-07-28. The first
                # two were found by inspection; the third by a skin going wrong
                # in production, which is the only reason the others mattered.
                #
                # 1. Written via cwebp, not ImageMagick. IM's WebP writer ZEROES
                #    the RGB of fully-transparent texels — fine for a picture,
                #    fatal here. These are DATA: the compositor samples
                #    pattern.rgb independently of pattern.a, and case hardening
                #    reads pattern.g as a ramp lookup coordinate, so colour under
                #    zero alpha decides what colour the gun is. Zeroing it
                #    rendered Glock | AXIA's slide as chrome instead of dark
                #    steel — the exact symptom the compositor's own comments warn
                #    about. `-exact` is the flag that stops it; IM's equivalent
                #    (`-define webp:exact`) only exists in ImageMagick 7 and
                #    bookworm ships 6.9.11.
                #
                # 2. The output previously went to "<name>.webp.tmp", and
                #    ImageMagick reads the format off the extension — ".tmp" is
                #    unknown, so it fell back to the INPUT format and wrote a PNG
                #    the rename then dressed up as .webp. Every paint texture on
                #    every mount was a misnamed PNG, which is why
                #    /paints/textures sat at 3.4GB.
                #
                # 3. LOSSLESS, where this said `-quality 90`. That lossy intent
                #    never actually executed — because of (2) — so every skin
                #    ever rendered here, and every shadertest calibration against
                #    the official art, used lossless input. Fixing the format
                #    while leaving q90 would have silently changed the pixels of
                #    all 2106 finishes.
                subprocess.run(
                    ["cwebp", "-exact", "-lossless", "-q", "100", src, "-o", tmp],
                    check=True, capture_output=True,
                )
            os.replace(tmp, dst)
            return True
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return False

    with ThreadPoolExecutor(max_workers=pool_size(CORES)) as pool:
        for ok, (_, dst) in zip(pool.map(to_webp, jobs), jobs):
            if ok:
                converted += 1
            else:
                failed.append(f"{os.path.basename(dst)} (convert failed)")
    print(f"---   {step} {converted}/{len(todo)}", flush=True)
    progress(step, converted, len(todo))
  secs = int(time.time() - started)
  print(f"--- [{step}] {converted} textures in {secs // 60}m{secs % 60:02d}s", flush=True)
  if close:
    # The shell's `step` helper only knows about one heredoc, so this program
    # closes the step it owns outright.
    progress(step, converted, len(todo), state="done", secs=secs)
  return converted, secs


paint_done, _ = extract_textures(paint_todo, "paint-chain")
sticker_done, sticker_secs = extract_textures(sticker_todo, "sticker-art", close=True)
converted = paint_done + sticker_done
todo = paint_todo + sticker_todo

shutil.rmtree(raw, ignore_errors=True)

# ---- materials LAST ---------------------------------------------------------
# Every texture these reference is on disk by now — see the note above the
# texture pass for why that ordering is load-bearing.
written = 0
# The textures pass left the bar at its own denominator; hand over to this
# one immediately rather than after the first 250.
progress("paint-chain", 0, len(docs))
for path, doc in docs.items():
    kind = "vcompmat" if path.endswith("vcompmat_c") else "vmat"
    out_path = os.path.join(dest, "materials", out_name(path, kind))
    # Write-then-rename: a reader must never catch a half-written material, and
    # os.replace is atomic within a filesystem.
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(convert(doc), fh, separators=(",", ":"))
    os.replace(tmp, out_path)
    written += 1
    if written % 250 == 0:
        progress("paint-chain", written, len(docs))
# Final exact count: the throttle above leaves the bar short of 100% whenever
# the total is not a multiple of 250 (or is under it, where it never fired).
progress("paint-chain", written, len(docs))
print(f"---   wrote {written} material JSON files")

# ---- prune, one generation behind -------------------------------------------
# Delete textures nothing references any more — but keep whatever the PREVIOUS
# run referenced too. A browser that cached a material before this run holds
# immutable URLs for the texture names that material used; dropping them the
# moment they go unreferenced would 404 those and render that tab's guns white,
# which is exactly the interruption staging exists to avoid. One run of grace is
# enough — a tab that old has reloaded.
# A SCOPED RUN MUST NOT PRUNE. `textures` is only what THIS run walked, so on a
# partial run it is a tiny fraction of the catalogue and pruning against it
# deletes everything else. That is not hypothetical: a two-step run on
# 2026-08-05 took the live mount from ~16,800 textures to 262 and every skin
# rendered white. Staging is seeded from live, so skipping the prune simply
# leaves the untouched files in place — and referenced.json keeps the FULL run's
# answer, which is what the next full run needs to prune correctly.
if os.environ.get("PARTIAL_RUN") == "1":
    print("---   scoped run: no prune, referenced.json left alone")
else:
    keep = {out_name(t, "vtex") for t in textures}
    prev_file = os.path.join(dest, "referenced.json")
    try:
        with open(prev_file) as fh:
            keep |= set(json.load(fh))
    except Exception:
        pass  # first run, or unreadable — prune nothing this time
    removed = 0
    for f in os.listdir(tex_dir):
        if f not in keep:
            try:
                os.remove(os.path.join(tex_dir, f))
                removed += 1
            except OSError:
                pass
    with open(prev_file, "w") as fh:
        json.dump(sorted(out_name(t, "vtex") for t in textures), fh)
    if removed:
        print(f"---   pruned {removed} textures no longer referenced by this or the previous run")

print(f"--- Paint chain: {written} materials, {len(textures)} textures -> {dest}")
if unresolved:
    print(f"!!! {len(unresolved)} paint materials are not in this CS2 build "
          f"(those skins render white), e.g. {', '.join(unresolved[:4])}")
if failed:
    print(f"!!! {len(failed)} paint assets failed: {failed[:5]}")
PYEOF

  # ---- swap staging into place ------------------------------------------------
  # `set -e` means we only reach here if the step above succeeded, so the live
  # copy is only ever replaced by a COMPLETE one. Two renames within the same
  # filesystem, so each is atomic: a request either resolves against the old
  # directory or the new one, never a half-built mix. Readers already holding an
  # open fd finish against the inode they opened.
  echo "--- Swapping paints into place…"
  rm -rf "$PAINT_LIVE.old"
  mv "$PAINT_LIVE" "$PAINT_LIVE.old"
  mv "$PAINT_DEST" "$PAINT_LIVE"
  # Hardlinked from the new copy where nothing changed, so this frees only the
  # files this run actually replaced.
  rm -rf "$PAINT_LIVE.old"
  echo "--- Paints live: $(find "$PAINT_LIVE/materials" -type f | wc -l | tr -d "[:space:]") materials, $(find "$PAINT_LIVE/textures" -type f | wc -l | tr -d "[:space:]") textures"
  # sticker-art is closed by the python above (it alone knows that phase's
  # duration); paint-chain stays with the shell so the run stamp still records a
  # time for it. Clearing STEP_NAME here instead dropped BOTH from the stamp.
fi

fi

# ---- 5b. Music kit audio -----------------------------------------------------
if step_if "music-audio"; then
# A music kit IS its sound, and until this step there was no preview of any kind
# — you picked one by reading the artist's name. This decodes each kit's menu
# theme out of this instance's own CS2 install, exactly like every other asset
# here: licensed music, mirrored locally, never fetched from anyone else.
#
# THE MAPPING IS `variantIndex`, NOT `definitionIndex`. items_game.txt's
# `music_definitions` is keyed by cs2-lib's variantIndex and its `name` is the
# sound folder ("1" -> valve_cs2_01, "3" -> danielsadowski_01, "4" -> noisia_01,
# checked against the catalogue). definitionIndex is 1314 for EVERY kit — it says
# "this is a music kit", not which one — so keying on it collapses all 100 kits
# onto one folder and every kit plays the same song.
#
# `mainmenu` of the 13-22 files a kit ships (bombplanted, deathcam,
# roundmvpanthem, startround...) because it is the menu theme, i.e. the part
# people recognise; all 101 folders on this build have one.
#
# No transcode: Source2Viewer writes .vsnd_c straight out as .mp3. The output
# extension is still PROBED rather than assumed — the CLI picks the container
# from the codec inside the .vsnd_c, so a kit stored as PCM lands as .wav, and
# assuming .mp3 would drop it silently rather than serve it.
echo ""
echo "--- Extracting music kit audio…"
if [[ -n "$OUT_DIR" ]]; then MUSIC_LIVE="$OUT_DIR/music"; else MUSIC_LIVE="$WORK/music"; fi
# Staged like the paints, and for a sharper reason: an mp3 is written
# PROGRESSIVELY, and the browser range-requests it. A viewer who hits a file
# mid-write gets a truncated body, and a truncated decode is what an <audio>
# element caches — so it stays broken for that session even after the file is
# whole. The live directory is only ever replaced by a complete one.
MUSIC_DEST="$MUSIC_LIVE.next"
rm -rf "$MUSIC_DEST"
mkdir -p "$MUSIC_DEST" "$MUSIC_LIVE"

CLI="$CLI" VPK="$VPK" ITEMS_GAME="$ITEMS_GAME" MUSIC_DEST="$MUSIC_DEST" \
RAW_MUSIC="$WORK/raw_music" python3 - <<'PYEOF'
import glob, json, os, re, shutil, subprocess
from concurrent.futures import ThreadPoolExecutor

cli, vpk = os.environ["CLI"], os.environ["VPK"]
src, dest, raw = os.environ.get("ITEMS_GAME", ""), os.environ["MUSIC_DEST"], os.environ["RAW_MUSIC"]

CORES = int(os.environ.get("CORES") or 0) or (os.cpu_count() or 4)


def pool_size(cap=8):
    """Same knob the panel writes and every other step reads, re-read here so
    raising it mid-run speeds this step up too."""
    try:
        with open(os.environ["JOBS_FILE"]) as fh:
            n = int(fh.read().strip())
    except Exception:
        n = int(os.environ.get("EXTRACT_JOBS") or 1)
    return max(1, min(cap, CORES, max(4, n)))


def progress(step, done, total, state="running"):
    """Unit counts for the panel — a file, not stdout, so it survives a backend
    restart mid-run. See the shell's `prog` helper for the whole story."""
    pf = os.environ.get("PROGRESS_FILE")
    if not pf:
        return
    try:
        try:
            with open(pf) as fh:
                doc = json.load(fh)
        except Exception:
            doc = {"steps": []}
        for s in doc.get("steps", []):
            if s["name"] == step:
                s["state"], s["done"], s["total"] = state, done, total
                break
        doc["at"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(pf, "w") as fh:
            json.dump(doc, fh)
    except Exception:
        pass


# ---- the mapping ------------------------------------------------------------
# Same depth walker the sticker_kits block uses: the table arrives as
#   "music_definitions" { "1" { "name" "valve_cs2_01" ... } ... }
# and, like keychain_definitions, may arrive in more than one block — so entries
# are merged rather than the first block winning.
KV = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"\s*$')
INDEX = re.compile(r'^"(\d+)"$')
# The folder name becomes a filename on a public route, so it is validated here
# rather than trusted: items_game.txt is game data, but this is the one value in
# this step that crosses into a path.
FOLDER = re.compile(r"^[A-Za-z0-9_.-]+$")

kits = {}
if src and os.path.exists(src):
    lines = open(src, encoding="utf8", errors="replace").read().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != '"music_definitions"':
            i += 1
            continue
        j = i + 1
        while j < len(lines) and lines[j].strip() != "{":
            j += 1
        depth, j = 1, j + 1
        cur, entry = None, None
        while j < len(lines) and depth > 0:
            stripped = lines[j].strip()
            if stripped == "{":
                depth += 1
            elif stripped == "}":
                depth -= 1
                if depth == 1 and cur is not None:
                    name = (entry or {}).get("name")
                    if name and FOLDER.match(name):
                        kits[cur] = name
                    cur, entry = None, None
            elif depth == 1:
                m = INDEX.match(stripped)
                if m:
                    cur, entry = m.group(1), {}
            elif depth == 2 and entry is not None:
                m = KV.match(lines[j])
                if m:
                    entry[m.group(1)] = m.group(2)
            j += 1
        i = j

if not kits:
    print("!!! No music_definitions recovered — every music kit stays previewless. "
          "Check that scripts/items/items_game.txt extracted.")

# Deduplicated: the manifest is index -> file, but two indices naming the same
# folder must not decode the same 3.5MB twice.
folders = sorted(set(kits.values()))
progress("music-audio", 0, len(folders))

# ---- decode -----------------------------------------------------------------
# `-f` takes a COMMA-SEPARATED LIST of exact archive paths and honours them only
# while `-e` is omitted — one process extracts exactly the files asked for. That
# is the difference between ~100 process launches and a handful, and it is why
# nothing here unpacks a folder (a kit folder holds 13-22 files and we want one).
shutil.rmtree(raw, ignore_errors=True)
os.makedirs(raw, exist_ok=True)
wanted = [f"sounds/music/{name}/mainmenu.vsnd_c" for name in folders]
workers = pool_size()
stride = max(1, (len(wanted) + workers - 1) // workers)
slices = [wanted[i:i + stride] for i in range(0, len(wanted), stride)]


def grab(paths):
    subprocess.run([cli, "-i", vpk, "-o", raw, "-d", "-f", ",".join(paths)], capture_output=True)


if slices:
    with ThreadPoolExecutor(max_workers=len(slices)) as pool:
        list(pool.map(grab, slices))

# ---- collect ----------------------------------------------------------------
# Probed by glob for the reason in the step comment: the container is chosen by
# the codec, not by us.
written, missing = {}, []
for name in folders:
    stem = os.path.join(raw, "sounds", "music", name, "mainmenu")
    hit = next(iter(sorted(glob.glob(glob.escape(stem) + ".*"))), None)
    if hit is None:
        missing.append(name)
        continue
    out = name + os.path.splitext(hit)[1].lower()
    shutil.move(hit, os.path.join(dest, out))
    written[name] = out
    progress("music-audio", len(written), len(folders))
shutil.rmtree(raw, ignore_errors=True)

# The manifest lives WITH the audio rather than in models/, so the atomic swap
# below moves both together — a manifest that promised a file the swap had not
# published yet would advertise a preview that 404s. Keyed by variantIndex,
# which is the number the backend has in hand for a kit.
index = {idx: written[name] for idx, name in kits.items() if name in written}
with open(os.path.join(dest, "music-kits.json"), "w") as fh:
    json.dump(index, fh, indent=1, sort_keys=True)

print(f"--- Music kits: {len(written)}/{len(folders)} themes -> {dest} ({len(index)} kits mapped)")
if missing:
    print(f"!!! {len(missing)} kits have no mainmenu track in this build, e.g. {missing[:4]}")
PYEOF

# ---- swap staging into place -------------------------------------------------
# Guarded on the staging directory having something in it, which the paint swap
# does not need: paints run under `set -e` behind a step that fails loudly, while
# this one degrades quietly — no items_game.txt means zero kits resolved and the
# python above still exits 0. Swapping then would DELETE a good previous run's
# audio and replace it with an empty directory. Leaving the old copy live is the
# honest failure: the previews keep working and the warning above says why.
staged=$(find "$MUSIC_DEST" -type f -name '*.mp3' -o -type f -name '*.wav' | wc -l | tr -d "[:space:]")
if (( staged > 0 )); then
  # Two renames within one filesystem, so each is atomic — a request resolves
  # against the old directory or the new one, never a half-written file.
  rm -rf "$MUSIC_LIVE.old"
  mv "$MUSIC_LIVE" "$MUSIC_LIVE.old"
  mv "$MUSIC_DEST" "$MUSIC_LIVE"
  rm -rf "$MUSIC_LIVE.old"
  echo "--- Music live: $staged themes ($(du -sh "$MUSIC_LIVE" | cut -f1))"
else
  rm -rf "$MUSIC_DEST"
  echo "!! No music decoded — keeping the previously extracted audio (if any) rather than emptying it."
fi

fi

# ---- 6. Stamp the pipeline version -------------------------------------------
# Written last, and only here: `set -e` means reaching this line is what makes
# the run a success, so the stamp can never claim output that wasn't produced.
# JSON helpers: a number when we have one, `null` otherwise (unquoted); a quoted
# string or `null`. Keeps the stamp valid even on a CS2 install with no steam.inf.
json_num() { [[ "$1" =~ ^[0-9]+$ ]] && printf '%s' "$1" || printf 'null'; }
json_str() { [[ -n "$1" ]] && printf '"%s"' "$1" || printf 'null'; }
step "stamp"          # closes the last real step so its time is reported
RUN_SECONDS=$(( $(date +%s) - RUN_START ))
# Per-step seconds as a JSON object, so the panel can show where the time went
# rather than just a total that nobody can act on.
steps_json() {
  local out="{" first=1
  for entry in "${STEP_TIMES[@]}"; do
    [[ $first == 1 ]] || out+=","
    first=0
    out+="\"${entry%%=*}\":${entry##*=}"
  done
  printf '%s}' "$out"
}
# A SCOPED RUN DOES NOT STAMP.
#
# The version means "this mount has everything the pipeline at vN produces", and
# a run that skipped steps has not earned that. Leaving the mount stale is the
# safe direction: the next full run still happens, and nothing downstream is
# fooled into treating a partial mount as complete. It also keeps the dev loop
# honest — a scoped run is for iterating, not for shipping a version.
if [[ "$PARTIAL_RUN" == "1" ]]; then
  echo "--- Total run time: $(fmt_dur "$RUN_SECONDS")"
  echo "--- Scoped run — NOT stamping extract-version.json (mount stays stale on purpose)"
else
cat >"$DEST/extract-version.json" <<JSON
{
 "version": $EXTRACT_VERSION,
 "gameBuild": $(json_num "$GAME_BUILD"),
 "gamePatch": $(json_str "$GAME_PATCH"),
 "gameDate": $(json_str "$GAME_DATE"),
 "extractedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "durationSeconds": $RUN_SECONDS,
 "steps": $(steps_json)
}
JSON
echo "--- Total run time: $(fmt_dur "$RUN_SECONDS")"
echo "--- Stamped extract-version.json (pipeline v$EXTRACT_VERSION, CS2 build ${GAME_BUILD:-unknown})"
fi

# ---- 7. Bundle ---------------------------------------------------------------
if [[ -n "$OUT_DIR" ]]; then
  echo ""
  echo "=== Done: models written to $DEST ($(du -sh "$DEST" | cut -f1))"
  echo "    Served directly from the mount — no restart needed."
else
  tar -czf cs2-models-glb.tar.gz -C "$DEST" .
  echo ""
  echo "=== Done: $(pwd)/cs2-models-glb.tar.gz"
  echo "    Copy into the plugin, e.g.:"
  echo "      scp cs2-models-glb.tar.gz you@dev:/tmp/ "
  echo "      tar -xzf /tmp/cs2-models-glb.tar.gz -C 5stack-inventory-plugin/public/models/"
  echo "    then restart dev:ui (vite's watch doesn't rebuild on public/ changes)."
fi
