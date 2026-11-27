#!/usr/bin/env bash
# Lab 3 smoke test: start NodeGoat against a seeded MongoDB and check basic behaviour.
# Expects MONGODB_URI to point at a running MongoDB. Used by CI; also runnable locally.
set -euo pipefail

PORT="${PORT:-4000}"
BASE="https://127.0.0.1:${PORT}"
TMP="${RUNNER_TEMP:-/tmp}"

# Per-run self-signed certificate (fix for A6: the app serves HTTPS only). curl trusts
# exactly this certificate, so a TLS or hostname error fails the test; no --insecure.
bash scripts/dev-cert.sh "$TMP/tls" > /dev/null
export TLS_KEY_FILE="$TMP/tls/tls.key" TLS_CERT_FILE="$TMP/tls/tls.crt"
export CURL_CA_BUNDLE="$TLS_CERT_FILE"
export NODE_ENV=production
# Throwaway per-run secrets: never stored, never reused.
SESSION_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
CRYPTO_KEY="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
export SESSION_SECRET CRYPTO_KEY

node artifacts/db-reset.js

node server.js > "$TMP/nodegoat.log" 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl --silent --output /dev/null "${BASE}/login"; then break; fi
  sleep 1
done

fail() { echo "SMOKE FAIL: $*"; cat "$TMP/nodegoat.log"; exit 1; }

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
if grep -qF "$SESSION_SECRET" "$TMP/nodegoat.log"; then
  fail "SESSION_SECRET found in application log"
fi
echo "ok - secrets not present in application log"

# --- Authenticated flows -------------------------------------------------------
# Exercise every DAO through the real MongoDB driver: login, reads, upserts,
# inserts and sign-up (which uses the counters collection). These would fail if
# any driver call were left on a pre-5.0 callback or removed 2.x method.
JAR="$TMP/smoke-cookies.txt"
BODY="$TMP/smoke-body.html"
HEADERS="$TMP/smoke-headers.txt"
rm -f "$JAR"

# req <curl args...>  -> prints "<status> <redirect-url>", body saved to $BODY,
# response headers to $HEADERS
req() { curl --silent --cookie "$JAR" --cookie-jar "$JAR" --output "$BODY" \
  --dump-header "$HEADERS" --write-out '%{http_code} %{redirect_url}' "$@"; }
expect_page() { # expect_page <path> <text that must appear>
  local out; out="$(req "${BASE}$1")"
  [ "${out%% *}" = "200" ] || fail "GET $1 returned ${out}"
  grep -qF "$2" "$BODY" || fail "GET $1 did not contain: $2"
  echo "ok - GET $1 shows \"$2\""
}
login() { # login <user> <password> <expected redirect path>
  rm -f "$JAR"
  local out; out="$(req --data-urlencode "userName=$1" --data-urlencode "password=$2" "${BASE}/login")"
  [[ "$out" == "302 "*"$3" ]] || fail "login as $1 returned ${out}, expected 302 -> $3"
  echo "ok - $1 logs in and is redirected to $3"
}

login user1 User1_123 /dashboard

# --- A3/A5/A6 session cookie and transport -----------------------------------
cookie="$(grep -i '^set-cookie: sessionId=' "$HEADERS" | tail -n 1 | tr -d '\r')"
[ -n "$cookie" ] || fail "login did not set a sessionId cookie: $(grep -i '^set-cookie' "$HEADERS")"
if grep -qi '^set-cookie: connect\.sid=' "$HEADERS"; then fail "default connect.sid cookie name still used"; fi
for attr in "; Path=/" "; Expires=" "; HttpOnly" "; Secure" "; SameSite=Strict"; do
  [[ "$cookie" == *"$attr"* ]] || fail "session cookie is missing '${attr#; }': ${cookie}"
done
[[ "$cookie" != *"; Domain="* ]] || fail "session cookie should be host-only (no Domain): ${cookie}"
echo "ok - session cookie is sessionId with HttpOnly, Secure, SameSite=Strict, Path=/, Expires, no Domain"

code="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${PORT}/login" || true)"
[ "$code" = "000" ] || fail "plain HTTP request got an HTTP ${code} response; expected no HTTP listener"
echo "ok - plain HTTP is not served (TLS only)"

expect_page /dashboard "John Doe"
expect_page /profile "Doe"
expect_page /allocations/2 "Asset Allocations for John Doe"

out="$(req --data "preTax=5&afterTax=6&roth=7" "${BASE}/contributions")"
[ "${out%% *}" = "200" ] && grep -qF "Contributions updated successfully" "$BODY" \
  || fail "POST /contributions returned ${out}"
echo "ok - POST /contributions saves (replaceOne upsert)"
expect_page /contributions "<td>5 %</td>"

MEMO="smoke-memo-$$"
out="$(req --data "memo=${MEMO}" "${BASE}/memos")"
[ "${out%% *}" = "200" ] && grep -qF "$MEMO" "$BODY" || fail "POST /memos returned ${out}"
echo "ok - POST /memos inserts and lists the memo"

login admin Admin_123 /benefits
expect_page /benefits "Will"

# Sign-up takes _id 4 from the counters collection (findOneAndUpdate) and creates
# allocations for the new user asynchronously.
rm -f "$JAR"
out="$(req --data "userName=smoke$$&firstName=Smoke&lastName=Tester&password=Smoke_Pass1&verify=Smoke_Pass1&email=smoke@example.test" "${BASE}/signup")"
[ "${out%% *}" = "200" ] && grep -qF "Smoke Tester" "$BODY" || fail "POST /signup returned ${out}"
echo "ok - POST /signup creates a user"
for _ in $(seq 1 10); do
  out="$(req "${BASE}/allocations/4")"
  if [ "${out%% *}" = "200" ] && grep -qF "Asset Allocations for Smoke Tester" "$BODY"; then break; fi
  sleep 1
done
expect_page /allocations/4 "Asset Allocations for Smoke Tester"
login "smoke$$" Smoke_Pass1 /dashboard

# --- A1 NoSQL injection: allocations "threshold" ----------------------------
# Vulnerable code pasted the threshold into a $where JavaScript string. A
# tautology returned every user's allocations; a loop hung MongoDB.
login user1 User1_123 /dashboard
expect_page "/allocations/2?threshold=0" "Asset Allocations for John Doe"

out="$(req --max-time 10 -G --data-urlencode "threshold=1'; return 1 == '1" "${BASE}/allocations/2" || true)"
if grep -qE "Will Smith|Node Goat Admin" "$BODY"; then
  fail "A1: threshold injection exposed other users' allocations (${out})"
fi
[ "${out%% *}" = "400" ] || fail "A1: tautology payload returned ${out}, expected 400"
echo "ok - A1 tautology payload is rejected (400) and leaks no other user's data"

out="$(req --max-time 10 "${BASE}/allocations/2?threshold%5B%24gt%5D=0" || true)"
[ "${out%% *}" = "400" ] || fail "A1: operator payload threshold[\$gt]=0 returned ${out}, expected 400"
echo "ok - A1 operator payload threshold[\$gt]=0 is rejected (400)"

# Runs last: on vulnerable code this would tie up MongoDB until curl gives up.
out="$(req --max-time 10 -G --data-urlencode "threshold=0';while(true){}'" "${BASE}/allocations/2" || true)"
[ "${out%% *}" = "400" ] || fail "A1: loop payload returned ${out}, expected a fast 400"
echo "ok - A1 loop payload is rejected (400) without reaching MongoDB"

# --- A4 BOLA: /allocations/:userId ------------------------------------------
# Two synthetic users: user1 (_id 2) and user2 (_id 3). Each may read only
# their own allocations; changing the id in the URL must be refused.
login user1 User1_123 /dashboard
for target in 3 1; do
  out="$(req "${BASE}/allocations/${target}")"
  if grep -qE "Will Smith|Node Goat Admin" "$BODY"; then
    fail "A4: user1 read the allocations of user ${target} (${out})"
  fi
  [ "${out%% *}" = "403" ] || fail "A4: user1 GET /allocations/${target} returned ${out}, expected 403"
  echo "ok - A4 user1 cannot read /allocations/${target} (403)"
done

login user2 User2_123 /dashboard
out="$(req "${BASE}/allocations/2")"
if grep -qF "John Doe" "$BODY"; then fail "A4: user2 read user1's allocations (${out})"; fi
[ "${out%% *}" = "403" ] || fail "A4: user2 GET /allocations/2 returned ${out}, expected 403"
echo "ok - A4 user2 cannot read /allocations/2 (403)"
expect_page /allocations/3 "Asset Allocations for Will Smith"

# Driver errors must not be hiding in the log behind a 200 response.
if grep -qE "TypeError|MongoServerError|MongoError|UnhandledPromiseRejection" "$TMP/nodegoat.log"; then
  fail "driver or runtime error in application log"
fi
echo "ok - no driver errors in application log"
