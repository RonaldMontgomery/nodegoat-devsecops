#!/usr/bin/env bash
# Runs on the EC2 host, sent by the nodegoat-deploy SSM document (infra/deploy.tf).
# Deploys exactly one image digest, and only if this host can verify its signature.
#
# Usage: deploy-host.sh sha256:<64 hex>
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:/snap/bin"

DIGEST="${1:-}"
if [[ ! "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "usage: deploy-host.sh sha256:<64 hex digits>" >&2
  exit 2
fi

REPO="ghcr.io/ronaldmontgomery/nodegoat-devsecops"
REF="${REPO}@${DIGEST}"
IDENTITY="https://github.com/RonaldMontgomery/nodegoat-devsecops/.github/workflows/container-security.yml@refs/heads/main"
ISSUER="https://token.actions.githubusercontent.com"
REGION="us-east-1"
APP_DIR="/opt/nodegoat"
RUN_DIR="/run/nodegoat" # tmpfs: secrets are never written to the disk
APP_GID=65532           # the app containers run as 65532:65532

echo "== Verifying the signature of ${REF}"
cosign verify "$REF" --certificate-identity "$IDENTITY" --certificate-oidc-issuer "$ISSUER" > /dev/null
echo "Signature verified: signed by container-security.yml on main"

echo "== Pulling by digest"
docker pull --quiet "$REF"
# docker-compose.yml runs nodegoat:local; point it at the verified digest.
docker tag "$REF" nodegoat:local

echo "== Reading secrets from Secrets Manager"
secret() {
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" \
    --query SecretString --output text
}
umask 077
install -d -m 0700 "$RUN_DIR"
install -d -m 0750 -g "$APP_GID" "$RUN_DIR/cert"
session_secret="$(secret nodegoat/session-secret)"
crypto_key="$(secret nodegoat/crypto-key)"
tls="$(secret nodegoat/tls)"
printf 'SESSION_SECRET=%s\nCRYPTO_KEY=%s\n' "$session_secret" "$crypto_key" > "$RUN_DIR/app.env"
jq -r .key <<< "$tls" > "$RUN_DIR/cert/tls.key"
jq -r .cert <<< "$tls" > "$RUN_DIR/cert/tls.crt"
unset session_secret crypto_key tls
chgrp "$APP_GID" "$RUN_DIR/cert/tls.key" "$RUN_DIR/cert/tls.crt"
chmod 0440 "$RUN_DIR/cert/tls.key" "$RUN_DIR/cert/tls.crt"
echo "Secrets written to ${RUN_DIR} (tmpfs)"

# docker-compose.yml mounts ./artifacts/cert; keep the real files on tmpfs.
install -d -m 0755 "$APP_DIR/artifacts"
ln -sfn "$RUN_DIR/cert" "$APP_DIR/artifacts/cert"

echo "== Starting the stack"
cd "$APP_DIR"
docker compose --env-file "$RUN_DIR/app.env" up --detach --no-build --remove-orphans

echo "== Health check (HTTPS, trusting only this deployment's certificate)"
healthy=0
for _ in $(seq 1 45); do
  if curl --fail --silent --show-error --output /dev/null --max-time 5 \
    --cacert "$RUN_DIR/cert/tls.crt" https://localhost:4000/login; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  echo "NodeGoat did not answer on https://localhost:4000/login" >&2
  docker compose ps --all >&2
  docker compose logs --tail 40 seed web >&2
  exit 1
fi

want="$(docker image inspect --format '{{.Id}}' "$REF")"
got="$(docker inspect --format '{{.Image}}' "$(docker compose ps --quiet web)")"
if [[ "$want" != "$got" ]]; then
  echo "Running image ${got} is not the verified image ${want}" >&2
  exit 1
fi

docker image prune --force > /dev/null
echo "DEPLOYED ${REF}"
