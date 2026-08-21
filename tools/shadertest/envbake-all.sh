#!/usr/bin/env bash
# Bake every CS2 vanity scene into a viewer environment.
#
# One map at a time, because the source is enormous and the product is not: the
# world export runs 60-400MB of geometry and textures, the panorama that ships
# is 250-600KB. So each map is exported on the pod, streamed here, rendered,
# uploaded, and deleted again before the next one starts.
#
#   tools/shadertest/envbake-all.sh                 # every map that has no panorama yet
#   tools/shadertest/envbake-all.sh de_nuke de_train
#   FORCE=1 tools/shadertest/envbake-all.sh de_mirage   # re-bake one that exists
#
# Needs the rig running:  npx vite --config tools/shadertest/vite.config.ts
set -uo pipefail

export KUBECONFIG=${KUBECONFIG:-~/.kube/5stackgg}
NS=${NS:-5stack}
POD=${POD:-$(kubectl -n "$NS" get pods -o name | grep inventory-backend | head -1 | cut -d/ -f2)}
CLI=/app/cs2-model-extract/cli/Source2Viewer-CLI
OUT=/cs2-models/anims/env
RIG=${RIG:-http://localhost:5199}
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/envsrc"
TMP=${TMPDIR:-/tmp}/envbake
mkdir -p "$SRC" "$TMP"

# Smallest first: the quick ones prove the loop before the 300MB ones spend an
# hour on it.
ALL=(de_mirage de_overpass cs_office de_vertigo de_nuke de_anubis de_cache de_dust2
     ar_baggage cs_italy de_inferno de_train de_ancient de_ancient_night warehouse)
MAPS=("${@:-${ALL[@]}}")

kubectl -n "$NS" exec "$POD" -c inventory-backend -- mkdir -p "$OUT" >/dev/null

for m in "${MAPS[@]}"; do
  if [ -z "${FORCE:-}" ] && kubectl -n "$NS" exec "$POD" -c inventory-backend -- test -f "$OUT/$m.jpg" 2>/dev/null; then
    echo "== $m: already baked, skipping"
    continue
  fi
  echo "== $m: exporting on the pod"
  kubectl -n "$NS" exec "$POD" -c inventory-backend -- sh -c "
    rm -rf /tmp/envx && mkdir -p /tmp/envx
    $CLI -i /cs2-game/game/csgo/maps/${m}_vanity.vpk \
      --vpk_filepath 'maps/${m}_vanity/world.vwrld_c' -o /tmp/envx -d \
      --gltf_export_format glb --gltf_export_materials >/dev/null 2>&1
    du -sh /tmp/envx/maps/${m}_vanity 2>/dev/null | cut -f1" || { echo "!! $m: export failed"; continue; }

  echo "== $m: streaming it here"
  rm -rf "${SRC:?}/$m" && mkdir -p "$SRC/$m"
  kubectl -n "$NS" exec "$POD" -c inventory-backend -- sh -c "cd /tmp/envx/maps/${m}_vanity && tar cf - ." > "$TMP/$m.tar" 2>/dev/null
  tar xf "$TMP/$m.tar" -C "$SRC/$m" && rm -f "$TMP/$m.tar"
  [ -f "$SRC/$m/world.glb" ] || { echo "!! $m: no world.glb after the transfer"; continue; }

  # TWO OUTPUTS, because a backdrop and a light are not the same picture.
  #
  #   <map>.jpg        equirect panorama, 2048 wide — what the model is LIT by.
  #                    Small on purpose: it is prefiltered into a PMREM cube, and
  #                    no amount of resolution survives that.
  #   <map>.plate.jpg  the backdrop, 2560x1440, rendered from the camera the game
  #                    frames a weapon with. Full resolution where it is seen.
  echo "== $m: baking the light panorama"
  node "$HERE/shoot.mjs" "$RIG/envbake.html?map=$m&out=2048" "$TMP/$m" --wait 120000 2>&1 |
    grep -E "meshes —|sky |panorama|ERROR" || true
  echo "== $m: baking the backdrop plate"
  node "$HERE/shoot.mjs" "$RIG/envbake.html?map=$m&plate=1&pw=2560" "$TMP/${m}-plate" --wait 120000 2>&1 |
    grep -E "plate from|ERROR" || true
  if [ ! -f "$TMP/${m}0.png" ]; then
    echo "!! $m: the rig produced no image"
    rm -rf "${SRC:?}/$m"
    continue
  fi

  # JPEG to ship: neither has alpha and this is a quarter of the size.
  ffmpeg -v error -y -i "$TMP/${m}0.png" -q:v 4 "$TMP/$m.jpg"
  kubectl -n "$NS" exec -i "$POD" -c inventory-backend -- sh -c "cat > $OUT/$m.jpg" < "$TMP/$m.jpg"
  if [ -f "$TMP/${m}-plate0.png" ]; then
    ffmpeg -v error -y -i "$TMP/${m}-plate0.png" -q:v 3 "$TMP/$m.plate.jpg"
    kubectl -n "$NS" exec -i "$POD" -c inventory-backend -- sh -c "cat > $OUT/$m.plate.jpg" < "$TMP/$m.plate.jpg"
    echo "== $m: shipped $(du -h "$TMP/$m.jpg" | cut -f1) light + $(du -h "$TMP/$m.plate.jpg" | cut -f1) plate"
  else
    echo "== $m: shipped $(du -h "$TMP/$m.jpg" | cut -f1) light — NO PLATE (no weapon camera?)"
  fi
  rm -rf "${SRC:?}/$m" "$TMP/${m}0.png" "$TMP/${m}-plate0.png" "$TMP/$m.jpg" "$TMP/$m.plate.jpg"
done

echo "== done"
kubectl -n "$NS" exec "$POD" -c inventory-backend -- sh -c "ls -la $OUT"
