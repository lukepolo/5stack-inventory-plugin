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
EXTRACT_VERSION=8

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
STEPS=(decompile-models rename-models composite-inputs charm-anchors sticker-markup econ-icons paint-chain stamp)

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
step "decompile-models"
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
mapfile -t WEAPON_DIRS < <(grep '^weapons/models/.*\.vmdl_c$' "$VPK_LIST" |
  awk -F/ 'NF>3 {print $1"/"$2"/"$3"/"}' | sort -u)
SHARDS="$WORK/raw_shards"
rm -rf "$SHARDS"
mkdir -p "$SHARDS"
if (( ${#WEAPON_DIRS[@]} == 0 )); then
  echo "!! No weapon directories found in the archive listing — falling back to one pass."
  "$CLI" -i "$VPK" -o "$RAW" -d \
    -f "weapons/models/" -e "vmdl_c" \
    --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt \
    --gltf_export_animations
else
  echo "--- Sharding ${#WEAPON_DIRS[@]} weapon dirs, starting at $(read_jobs) worker(s)…"
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

# ---- 3. Rename to cs2-lib model keys -----------------------------------------
step "rename-models"
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

count=0
while IFS= read -r -d '' f; do
  base="$(basename "$f" .glb)"
  key="${MAP[$base]:-}"
  if [[ -n "$key" ]]; then
    cp "$f" "$DEST/$key.glb"
    count=$((count + 1))
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

echo "--- Mapped $count weapons ($(du -sh "$DEST" | cut -f1) total)"

# ---- 3b. Per-weapon composite inputs ------------------------------------------
step "composite-inputs"
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

# The models-tree vmats are named <glb basename>_composite_inputs.vmat_c, so the
# same MAP that renames the GLBs in step 3 resolves their cs2-lib keys. Hand it
# to the python below rather than maintaining a second copy that can drift.
MODEL_KEY_JSON="{"
for k in "${!MAP[@]}"; do MODEL_KEY_JSON+="\"$k\":\"${MAP[$k]}\","; done
MODEL_KEY_JSON="${MODEL_KEY_JSON%,}}"
export MODEL_KEY_JSON

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
def progress(step, done, total):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one."""
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
                s["state"] = "running"
                s["done"], s["total"] = done, total
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

# ---- 3c. Keychain (charm) anchor points --------------------------------------
step "charm-anchors"
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

# ---- 3d. Sticker slot markup -------------------------------------------------
step "sticker-markup"
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

def parse_markup(lines):
    """The array of slot records under `StickerMarkup`. Indentation-driven: each
    record also carries a Polygons/Vertices tree we want nothing from, and
    keying on depth skips it without having to parse KV3 in general."""
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
    for line in lines[j + 1:]:
        # VRF separates array elements with a trailing comma ("\t\t},"), so the
        # record terminators are `},` and not `}`. Dropping it here rather than
        # comparing against both spellings also covers `],` and any scalar that
        # picks one up. Without this every record opens and none ever closes,
        # and the whole pass silently yields zero slots.
        stripped = line.strip().rstrip(",")
        indent = len(line) - len(line.lstrip("\t"))
        if indent <= base and stripped == "]":
            break
        if indent == base + 1:
            if stripped == "{":
                entry = {}
            elif stripped == "}" and entry is not None:
                out.append(entry)
                entry = None
            continue
        # Anything deeper than a record's own keys is the polygon mesh.
        if entry is None or indent != base + 2:
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
    return out

markup, empty = {}, []
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

with open(os.path.join(dest, "sticker-markup.json"), "w") as fh:
    json.dump(markup, fh, indent=1, sort_keys=True)

total = sum(len(v) for v in markup.values())
print(f"--- Sticker markup: {total} slots across {len(markup)} weapons")
if empty:
    # Knives and gloves genuinely have no sticker slots, so this list is only a
    # problem if a RIFLE shows up in it.
    print(f"---   no slots (expected for melee): {len(empty)} — {', '.join(sorted(empty)[:8])}")
if not markup:
    print("!!! No sticker markup recovered at all — sticker placement will fall "
          "back to the silhouette guess. Check the `-b DATA` output format.")
PYEOF

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
# the game asset's name, and that we can resolve. Measured on build 14116:
# 26872/26878 resolve; the 6 misses are items newer than the installed game.
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
PREV_BUILD=$(STAMP="$DEST/extract-version.json" python3 - <<'PYV' 2>/dev/null || true
import json, os
try:
    print(json.load(open(os.environ["STAMP"])).get("gameBuild") or "")
except Exception:
    print("")
PYV
)
if [[ -n "$GAME_BUILD" && "$PREV_BUILD" == "$GAME_BUILD" ]]; then
  echo "--- Seeding paint staging from the live copy (same CS2 build $GAME_BUILD)"
  cp -al "$PAINT_LIVE" "$PAINT_DEST"
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

# ---- index the archive's icons -------------------------------------------
# Key on the lowercased basename with the trailing `_png` dropped: the archive
# spells some assets in mixed case (cu_bizon_Curse) while cs2-lib lowercases,
# so an exact byte match silently loses items.
by_name = {}
for line in open(os.environ["VPK_LIST"]):
    p = line.strip()
    if not p.startswith(ECON):
        continue
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

def resolve(stem):
    """-> (archive path or None, tint hex or None, reason). Order matters: the
    wear/tint rules must not fire before an exact hit, or e.g. a skin literally
    named ..._light would resolve to the wrong asset."""
    s = stem.lower()
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
    path, tint, reason = resolve(entry["stem"])
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

def convert(src, out, tint):
    dst = os.path.join(dest, out)
    if tint:
        # Multiply, not -colorize: the stencils carry internal shading (measured
        # weighted luminance 0.49, not a flat 1.0), and colorize would flatten
        # it to a solid slab. Alpha is re-attached because the composite drops
        # it, which showed up as NaN coverage.
        cmd = ["convert", src, "-colorspace", "sRGB",
               "(", "+clone", "-alpha", "off", "-fill", f"#{tint}", "-colorize", "100", ")",
               "-compose", "Multiply", "-composite",
               "(", src, "-alpha", "extract", ")", "-compose", "CopyOpacity", "-composite",
               "-quality", "85", dst]
    else:
        cmd = ["convert", src, "-quality", "85", dst]
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
def progress(step, done, total):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one."""
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
                s["state"] = "running"
                s["done"], s["total"] = done, total
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
        for out, tint in wanted[path]:
            if not have_convert:
                shutil.copyfile(src, os.path.join(dest, out.replace(".webp", ".png")))
                written += 1
            else:
                jobs.append((src, out, tint))

    if jobs:
        with ThreadPoolExecutor(max_workers=pool_size(CORES)) as pool:
            for ok, (_, out, _) in zip(pool.map(lambda j: convert(*j), jobs), jobs):
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
  ASSET_MANIFEST="$ASSET_MANIFEST" PAINT_DEST="$PAINT_DEST" python3 - <<'PYEOF'
import glob, hashlib, json, os, re, shutil, subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

cli, vpk = os.environ["CLI"], os.environ["VPK"]
raw, dest = os.environ["RAW_PAINTS"], os.environ["PAINT_DEST"]
manifest = json.load(open(os.environ["ASSET_MANIFEST"])).get("paints", [])

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
# see the `progress` helper there for why it is a file and not stdout.
def progress(step, done, total):
    """Update this step's unit count in the shared progress file. Read-modify-
    write because the file holds every step, not just the current one."""
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
                s["state"] = "running"
                s["done"], s["total"] = done, total
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
wanted_name = {}
unresolved = []
for entry in manifest:
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
TREES = sorted({"/".join(p.split("/")[:2]) + "/" for p in wanted_name} | TEMPLATE_TREES)
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

# ---- walk the graph from every entry point ---------------------------------
docs, textures, failed = {}, set(), []
queue = [p for p in wanted_name if p.endswith(("vcompmat_c", "vmat_c"))]
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
have_convert = shutil.which("convert") is not None
tex_dir = os.path.join(dest, "textures")
todo = [t for t in sorted(textures) if not os.path.exists(os.path.join(tex_dir, out_name(t, "vtex")))]
print(f"---   {len(todo)} textures to extract ({len(textures) - len(todo)} already present)")

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
# See the econ-icons pass: publish the denominator before the first batch so
# the panel has a determinate bar from the start.
progress("paint-chain", 0, len(todo))
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
            if not have_convert:
                shutil.copyfile(src, tmp)
            else:
                subprocess.run(["convert", src, "-quality", "90", tmp], check=True, capture_output=True)
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
    print(f"---   textures {converted}/{len(todo)}", flush=True)
    progress("paint-chain", converted, len(todo))

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
