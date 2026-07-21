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
EXTRACT_VERSION=3

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

# ---- 2. Decompile every weapon model to GLB with materials + textures --------
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
"$CLI" -i "$VPK" -o "$RAW" -d \
  -f "weapons/models/" -e "vmdl_c" \
  --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt \
  --gltf_export_animations

# ---- 3. Rename to cs2-lib model keys -----------------------------------------
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

for vmat_path in sorted(vmats):
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
    textures, floats = scan(vmat_path)
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
        subprocess.run(
            [cli, "-i", vpk, "-o", raw, "-d", "-f", vtex + "_c"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        # The CLI picks the output container from the texture's FORMAT, so an
        # 8-bit map lands as .png but a float one does not. g_tPosition is
        # RGBA16161616F (verified: 1024x1024, decodes to RgbaF32) and comes out
        # as .exr — which is also how cdn.cstrike.app serves it.
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

# ---- 4. Stamp the pipeline version -------------------------------------------
# Written last, and only here: `set -e` means reaching this line is what makes
# the run a success, so the stamp can never claim output that wasn't produced.
# JSON helpers: a number when we have one, `null` otherwise (unquoted); a quoted
# string or `null`. Keeps the stamp valid even on a CS2 install with no steam.inf.
json_num() { [[ "$1" =~ ^[0-9]+$ ]] && printf '%s' "$1" || printf 'null'; }
json_str() { [[ -n "$1" ]] && printf '"%s"' "$1" || printf 'null'; }
cat >"$DEST/extract-version.json" <<JSON
{
 "version": $EXTRACT_VERSION,
 "gameBuild": $(json_num "$GAME_BUILD"),
 "gamePatch": $(json_str "$GAME_PATCH"),
 "gameDate": $(json_str "$GAME_DATE"),
 "extractedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "--- Stamped extract-version.json (pipeline v$EXTRACT_VERSION, CS2 build ${GAME_BUILD:-unknown})"

# ---- 5. Bundle ---------------------------------------------------------------
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
