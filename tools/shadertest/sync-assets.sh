#!/usr/bin/env bash
# Pull a subset of the live models mount into a local mirror, so the shadertest
# rig can render without a round trip to the cluster for every asset.
#
# Why a SUBSET. The mount is ~27GB: 21GB of that is paint textures and 6.3GB is
# models, most of which is per-weapon composite-input directories the rig never
# asks for. The parts that make an iteration loop fast are small — every GLB is
# 173MB together, every material JSON is 64MB, the sidecars are kilobytes. Pull
# those and let the rest come off the deployment on demand: vite.config.ts serves
# the mirror first and falls THROUGH to the host on a miss, so a partial mirror is
# a cache rather than a broken half-install.
#
#   ./tools/shadertest/sync-assets.sh                  # sidecars + all GLBs
#   ./tools/shadertest/sync-assets.sh core             # sidecars only (seconds)
#   ./tools/shadertest/sync-assets.sh materials        # + every material JSON
#   ./tools/shadertest/sync-assets.sh tex kc_db_lighter  # + textures matching a glob
#   ASSETS_DIR=/tmp/mirror ./tools/shadertest/sync-assets.sh
#
# Transport is `kubectl exec -- tar`, NOT `codepier exec`. codepier's exec mangles
# a binary stdout stream (a tar came back 0 bytes); it works if you base64 it, at
# 33% overhead. kubectl passes it through untouched.
set -euo pipefail

ASSETS_DIR="${ASSETS_DIR:-$HOME/Downloads/cs2-model-extract}"
# Never a bare kubectl: the default context on this machine is an unrelated GKE
# cluster, so a missing KUBECONFIG does not fail, it talks to the wrong cluster.
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/5stackgg}"
NS="${NS:-5stack}"
MOUNT="${MOUNT:-/cs2-models}"

pod=$(kubectl -n "$NS" get pods -o name 2>/dev/null \
  | grep inventory-backend | head -1 | cut -d/ -f2 || true)
if [[ -z "$pod" ]]; then
  echo "!!! no inventory-backend pod in namespace $NS (KUBECONFIG=$KUBECONFIG)" >&2
  exit 1
fi
echo "--- pod $pod   ->   $ASSETS_DIR"

# An extraction rewrites the models dir in place, so a pull that overlaps one
# copies half-written GLBs — which then render as a broken model with no hint
# that the file, not the code, is at fault.
if kubectl -n "$NS" exec "$pod" -c inventory-backend -- test -e "$MOUNT/extract.lock" 2>/dev/null; then
  echo "!!! an extraction is RUNNING (${MOUNT}/extract.lock exists) — the models dir is being" >&2
  echo "!!! rewritten underneath you. Wait for it to finish; a half-written GLB looks like a" >&2
  echo "!!! rendering bug, not a truncated file. Set FORCE=1 to override." >&2
  [[ "${FORCE:-0}" == "1" ]] || exit 1
fi

# $1 = destination under ASSETS_DIR, rest = paths relative to that same dir in
# the mount. Streams one tar rather than a file per exec: 191 GLBs is 191 pod
# round trips otherwise.
pull() {
  local sub="$1"; shift
  mkdir -p "$ASSETS_DIR/$sub"
  echo "---   $sub: $*"
  kubectl -n "$NS" exec "$pod" -c inventory-backend -- \
    bash -c "cd $MOUNT/$sub && tar cf - $* 2>/dev/null" | tar xf - -C "$ASSETS_DIR/$sub"
}

what="${1:-all}"

# The sidecars every mount needs: markup, anchors, shading, physics, and the
# version stamp. Kilobytes, and they are what most shader work actually reads.
if [[ "$what" == "core" || "$what" == "all" || "$what" == "materials" ]]; then
  pull models '*.json'
fi

if [[ "$what" == "all" ]]; then
  # Every GLB — 191 files, 173MB. Cheaper to take the lot than to work out which
  # ones a fixture will reach for.
  pull models '*.glb'
fi

if [[ "$what" == "materials" ]]; then
  pull paints/materials .
fi

if [[ "$what" == "tex" ]]; then
  pat="${2:-}"
  [[ -n "$pat" ]] || { echo "!!! usage: sync-assets.sh tex <glob>   e.g. tex kc_db_lighter" >&2; exit 1; }
  pull paints/textures "${pat}*"
fi

if [[ "$what" == "img" ]]; then
  pat="${2:-}"
  [[ -n "$pat" ]] || { echo "!!! usage: sync-assets.sh img <glob>" >&2; exit 1; }
  pull images "${pat}*"
fi

echo "--- mirror: $(du -sh "$ASSETS_DIR" 2>/dev/null | cut -f1) at $ASSETS_DIR"
echo "--- the rig picks it up automatically; anything absent falls through to the deployment."
