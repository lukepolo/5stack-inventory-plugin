#!/usr/bin/env bash
# Install, update or remove the DEV backend beside the installed plugin.
#
# Run it wherever kubectl reaches the panel's cluster (normally the machine the
# 5stack panel runs on), from a checkout of this fork:
#
#   ./scripts/dev-backend.sh            # install, or re-apply after a change
#   ./scripts/dev-backend.sh update     # restart onto the newest :dev image
#   ./scripts/dev-backend.sh remove     # delete everything this created
#
# It asks nothing: like plugin.sh, it reads the installed plugin instead — its
# database connection, its panel domains, its ingress class and whether it
# terminates TLS in the cluster. See docs/DEV-PLUGIN.md for what runs and why.
set -euo pipefail

NS=5stack
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/lcrew/5stack-inventory-plugin-backend:dev}"

die() { echo "!! $*" >&2; exit 1; }
say() { echo "--- $*"; }
kc() { kubectl -n "$NS" "$@"; }

command -v kubectl >/dev/null 2>&1 || die "kubectl not found. Run this on the machine your 5stack panel runs on."
kc get deployment inventory-backend >/dev/null 2>&1 ||
  die "No inventory plugin in namespace $NS. The dev backend runs beside an installed one."

case "${1:-install}" in
  remove)
    kc delete ingress/inventory-dev deployment/inventory-dev-backend service/inventory-dev-backend \
      secret/inventory-dev-secrets configmap/inventory-dev-config --ignore-not-found
    kc delete certificate/inventory-dev-ssl --ignore-not-found 2>/dev/null || true
    say "Removed. Its cards are still on the node at /opt/5stack/models/cs2-model-extract/renders-dev;"
    say "delete that folder too if you want them gone. The live plugin was not touched."
    exit 0
    ;;
  update)
    kc rollout restart deployment/inventory-dev-backend
    kc rollout status deployment/inventory-dev-backend --timeout=300s
    exit 0
    ;;
  install) ;;
  *) die "usage: $0 [install|update|remove]" ;;
esac

# ---- What the live backend runs with -------------------------------------------
# Read off the DEPLOYMENT rather than guessed: kustomize suffixes the generated
# ConfigMap and Secret with a content hash, and older generations can linger.
cm=$(kc get deployment inventory-backend \
  -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')
sec=$(kc get deployment inventory-backend \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="DATABASE_URL")].valueFrom.secretKeyRef.name}')
[[ -n "$cm" && -n "$sec" ]] || die "Could not read the live backend's ConfigMap/Secret names."

live_domain=$(kc get configmap "$cm" -o jsonpath='{.data.INVENTORY_DOMAIN}')
[[ -n "$live_domain" ]] || die "The live config has no INVENTORY_DOMAIN."
# inventory.fulm.eu -> inventory-dev.fulm.eu. Override with DOMAIN=...
DOMAIN="${DOMAIN:-inventory-dev.${live_domain#*.}}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Config (copied from $cm, INVENTORY_DOMAIN=$DOMAIN)"
kc get configmap "$cm" -o go-template='{{range $k, $v := .data}}{{$k}}={{$v}}{{"\n"}}{{end}}' |
  grep -v '^INVENTORY_DOMAIN=' >"$tmp/config.env" || true
echo "INVENTORY_DOMAIN=$DOMAIN" >>"$tmp/config.env"
kc create configmap inventory-dev-config --from-env-file="$tmp/config.env" --dry-run=client -o yaml | kc apply -f -

say "Database connection (copied from $sec)"
db=$(kc get secret "$sec" -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
[[ -n "$db" ]] || die "The live secret has no DATABASE_URL."
kc create secret generic inventory-dev-secrets --from-literal=DATABASE_URL="$db" --dry-run=client -o yaml |
  kc apply -f -

# ---- Manifests -----------------------------------------------------------------
class=$(kc get ingress inventory-api -o jsonpath='{.spec.ingressClassName}' 2>/dev/null || true)
class="${class:-nginx}"
live_tls=$(kc get ingress inventory-api -o jsonpath='{.spec.tls[0].secretName}' 2>/dev/null || true)

sed -e "s|__IMAGE__|$IMAGE|" "$REPO_DIR/k8s/dev/backend.yaml" >"$tmp/backend.yaml"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CLASS__|$class|" "$REPO_DIR/k8s/dev/ingress.yaml" >"$tmp/ingress.yaml"

if [[ -n "$live_tls" ]]; then
  # The live plugin terminates TLS in the cluster, so this host needs a
  # certificate too — from the same issuer as the live one.
  issuer=$(kc get certificate inventory-ssl -o jsonpath='{.spec.issuerRef.name}' 2>/dev/null || true)
  issuer_kind=$(kc get certificate inventory-ssl -o jsonpath='{.spec.issuerRef.kind}' 2>/dev/null || true)
  sed -e "s|__DOMAIN__|$DOMAIN|" -e "s|__ISSUER__|${issuer:-5stack-issuer}|" \
    -e "s|__ISSUER_KIND__|${issuer_kind:-Issuer}|" "$REPO_DIR/k8s/dev/certificate.yaml" >"$tmp/certificate.yaml"
  awk -v d="$DOMAIN" '
    /#__TLS__/ { print "  tls:"; print "    - hosts:"; print "        - " d; print "      secretName: inventory-dev-ssl"; next }
    { print }' "$tmp/ingress.yaml" >"$tmp/ingress.tls.yaml"
  mv "$tmp/ingress.tls.yaml" "$tmp/ingress.yaml"
  say "TLS: in-cluster (certificate from ${issuer:-5stack-issuer})"
else
  say "TLS: terminated in front of the cluster (Cloudflare / reverse proxy), no certificate"
fi

say "Applying"
kc apply -f "$tmp/backend.yaml"
[[ -f "$tmp/certificate.yaml" ]] && kc apply -f "$tmp/certificate.yaml"
kc apply -f "$tmp/ingress.yaml"

# A re-run should land on the newest :dev, and apply alone does not re-pull an
# unchanged tag.
kc rollout restart deployment/inventory-dev-backend >/dev/null
say "Waiting for inventory-dev-backend (first start applies the schema; it is the same one)"
if ! kc rollout status deployment/inventory-dev-backend --timeout=300s; then
  kc get pods -l app=inventory-dev-backend -o wide || true
  echo
  echo "If the pod shows ErrImagePull / ImagePullBackOff, the image is private:"
  echo "  github.com/LCrew -> Packages -> 5stack-inventory-plugin-backend -> Package settings ->"
  echo "  Change visibility -> Public. Then: ./scripts/dev-backend.sh update"
  echo "Otherwise: kubectl -n $NS logs deploy/inventory-dev-backend"
  exit 1
fi

cat <<EOF

Dev backend is running.

1. DNS: point $DOMAIN at the same place as $live_domain
   (Cloudflare: a record like the live one; a Cloudflare Tunnel: add it as a
   public hostname to the same service as $live_domain).
$([[ -n "$live_tls" ]] && echo "   Then wait for the certificate:  kubectl -n $NS get certificate inventory-dev-ssl -w")
2. Check it answers:  curl -s https://$DOMAIN/api/catalog | head -c 200
3. Point the dev copy at it: GitHub repo variable INVENTORY_API = https://$DOMAIN,
   then re-run the dev-plugin workflow (docs/DEV-PLUGIN.md).
EOF
