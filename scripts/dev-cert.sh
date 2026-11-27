#!/usr/bin/env bash
# Create a throwaway self-signed TLS certificate for local runs of NodeGoat.
# Usage: scripts/dev-cert.sh [output-dir]   (default: artifacts/cert)
# Works in Git Bash on Windows (Git for Windows ships openssl). The files are
# git-ignored and excluded from the Docker build context; never commit them.
set -euo pipefail

OUT="${1:-artifacts/cert}"
mkdir -p "$OUT"

MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$OUT/tls.key" -out "$OUT/tls.crt" 2>/dev/null

# Readable by the container's non-root user (65532) when bind-mounted by Compose.
# Acceptable only because this is a throwaway, self-signed, localhost-only key.
chmod 644 "$OUT/tls.key" "$OUT/tls.crt"

echo "Wrote $OUT/tls.key and $OUT/tls.crt (self-signed, localhost, 30 days)."
