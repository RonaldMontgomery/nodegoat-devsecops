#!/usr/bin/env bash
# Lab 3 smoke test: start NodeGoat against a seeded MongoDB and check basic behaviour.
# Expects MONGODB_URI to point at a running MongoDB. Used by CI; also runnable locally.
set -euo pipefail

PORT="${PORT:-4000}"
BASE="http://127.0.0.1:${PORT}"
export NODE_ENV=production
# Throwaway per-run secrets: never stored, never reused.
SESSION_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
CRYPTO_KEY="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
export SESSION_SECRET CRYPTO_KEY

node artifacts/db-reset.js

node server.js > "${RUNNER_TEMP:-/tmp}/nodegoat.log" 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl --silent --output /dev/null "${BASE}/login"; then break; fi
  sleep 1
done

fail() { echo "SMOKE FAIL: $*"; cat "${RUNNER_TEMP:-/tmp}/nodegoat.log"; exit 1; }

code="$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE}/login")"
[ "$code" = "200" ] || fail "GET /login returned $code, expected 200"
echo "ok - GET /login returns 200"

# Anonymous users must not reach authenticated pages.
for path in /dashboard /profile /contributions /memos; do
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE}${path}")"
  location="$(curl --silent --output /dev/null --write-out '%{redirect_url}' "${BASE}${path}")"
  [ "$code" = "302" ] && [[ "$location" == */login ]] || fail "anonymous GET ${path} returned ${code} -> ${location}"
  echo "ok - anonymous GET ${path} redirects to /login"
done

# Secrets must not appear in the application log.
if grep -qF "$SESSION_SECRET" "${RUNNER_TEMP:-/tmp}/nodegoat.log"; then
  fail "SESSION_SECRET found in application log"
fi
echo "ok - secrets not present in application log"
