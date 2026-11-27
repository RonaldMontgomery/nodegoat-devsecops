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
# token <path>: GET a page and print its _csrf form token (empty if the page has none).
token() {
  req "${BASE}$1" > /dev/null
  sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' "$BODY" | head -n 1
}
login() { # login <user> <password> <expected redirect path>
  rm -f "$JAR"
  local t; t="$(token /login)"
  local out; out="$(req --data-urlencode "_csrf=$t" --data-urlencode "userName=$1" \
    --data-urlencode "password=$2" "${BASE}/login")"
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

# --- A5 security headers (helmet) --------------------------------------------
req "${BASE}/dashboard" > /dev/null
header() { grep -i "^$1:" "$HEADERS" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }
csp="$(header content-security-policy)"
[[ "$csp" == *"default-src 'self'"* && "$csp" == *"script-src 'self'"* ]] \
  || fail "A5: Content-Security-Policy missing or too loose: '${csp}'"
script_src="$(echo "$csp" | grep -o "script-src [^;]*" || true)"
[[ "$script_src" != *"unsafe-inline"* ]] || fail "A5: script-src allows inline scripts: '${script_src}'"
[ "$(header x-content-type-options)" = "nosniff" ] || fail "A5: X-Content-Type-Options is not nosniff"
[ "$(header x-frame-options)" = "SAMEORIGIN" ] || fail "A5: X-Frame-Options is not SAMEORIGIN"
[[ "$(header strict-transport-security)" == max-age=* ]] || fail "A5: Strict-Transport-Security missing"
[ -z "$(header x-powered-by)" ] || fail "A5: X-Powered-By still sent: $(header x-powered-by)"
echo "ok - A5 security headers: CSP (no inline scripts), HSTS, nosniff, SAMEORIGIN, no X-Powered-By"

expect_page /dashboard "John Doe"
expect_page /profile "Doe"
expect_page /allocations/2 "Asset Allocations for John Doe"

t="$(token /contributions)"
out="$(req --data-urlencode "_csrf=$t" --data "preTax=5&afterTax=6&roth=7" "${BASE}/contributions")"
[ "${out%% *}" = "200" ] && grep -qF "Contributions updated successfully" "$BODY" \
  || fail "POST /contributions returned ${out}"
echo "ok - POST /contributions saves (replaceOne upsert)"
expect_page /contributions "<td>5 %</td>"

MEMO="smoke-memo-$$"
t="$(token /memos)"
out="$(req --data-urlencode "_csrf=$t" --data "memo=${MEMO}" "${BASE}/memos")"
[ "${out%% *}" = "200" ] && grep -qF "$MEMO" "$BODY" || fail "POST /memos returned ${out}"
echo "ok - POST /memos inserts and lists the memo"

# Stored XSS through a memo: raw HTML and script URLs must come back inert.
t="$(token /memos)"
req --data-urlencode "_csrf=$t" \
  --data-urlencode "memo=xss-$$ <script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))" \
  "${BASE}/memos" > /dev/null
grep -qF "xss-$$" "$BODY" || fail "XSS memo was not stored"
if grep -qiE "<script>alert|<img src=x|href=\"javascript:" "$BODY"; then
  fail "memo HTML was rendered as markup (stored XSS)"
fi
echo "ok - memo with <script>, <img onerror> and javascript: link renders as inert text"

login admin Admin_123 /benefits
expect_page /benefits "Will"

# Sign-up takes _id 4 from the counters collection (findOneAndUpdate) and creates
# allocations for the new user asynchronously.
rm -f "$JAR"
t="$(token /signup)"
out="$(req --data-urlencode "_csrf=$t" --data "userName=smoke$$&firstName=Smoke&lastName=Tester&password=Smoke_Pass1&verify=Smoke_Pass1&email=smoke@example.test" "${BASE}/signup")"
[ "${out%% *}" = "200" ] && grep -qF "Smoke Tester" "$BODY" || fail "POST /signup returned ${out}"
echo "ok - POST /signup creates a user"
for _ in $(seq 1 10); do
  out="$(req "${BASE}/allocations/4")"
  if [ "${out%% *}" = "200" ] && grep -qF "Asset Allocations for Smoke Tester" "$BODY"; then break; fi
  sleep 1
done
expect_page /allocations/4 "Asset Allocations for Smoke Tester"
login "smoke$$" Smoke_Pass1 /dashboard

# --- A3 stored XSS through profile fields -------------------------------------
# A user's name is shown in every page header and in the profile form. Markup in it
# must come back escaped, in both the HTML body and attribute contexts.
t="$(token /profile)"
out="$(req --data-urlencode "_csrf=$t" \
  --data-urlencode "firstName=<script>alert(1)</script>" \
  --data-urlencode 'lastName="><img src=x onerror=alert(1)>' \
  --data-urlencode "bankRouting=123456#" "${BASE}/profile")"
[ "${out%% *}" = "200" ] || fail "A3: profile update returned ${out}"
for page in /dashboard /profile; do
  req "${BASE}${page}" > /dev/null
  if grep -qiE "<script>alert\(1\)|<img src=x onerror" "$BODY"; then
    fail "A3: stored XSS: ${page} renders the profile name as markup"
  fi
  grep -qF "&lt;script&gt;alert(1)&lt;/script&gt;" "$BODY" \
    || fail "A3: ${page} does not show the escaped name"
  echo "ok - A3 ${page} shows a <script>/<img onerror> profile name as escaped text"
done

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

# --- A8 CSRF: state-changing POSTs need the session's token -----------------
# A forged request carries the victim's session cookie but cannot read the token
# from the victim's pages. Each POST without a token, or with a made-up one, must
# get 403 and change nothing.
csrf_refused() { # csrf_refused <path> <form data> <description>
  local out
  out="$(req --data "$2" "${BASE}$1")"
  [ "${out%% *}" = "403" ] || fail "A8: POST $1 without a CSRF token returned ${out}, expected 403 ($3)"
  out="$(req --data "_csrf=forged-token&$2" "${BASE}$1")"
  [ "${out%% *}" = "403" ] || fail "A8: POST $1 with a forged CSRF token returned ${out}, expected 403 ($3)"
  echo "ok - A8 POST $1 without or with a forged token is refused (403): $3"
}

login user1 User1_123 /dashboard
csrf_refused /contributions "preTax=9&afterTax=9&roth=9" "contributions"
expect_page /contributions "<td>5 %</td>"
csrf_refused /memos "memo=csrf-forged-$$" "memo"
expect_page /memos "$MEMO"
if grep -qF "csrf-forged-$$" "$BODY"; then fail "A8: forged memo was stored"; fi
csrf_refused /profile "firstName=Forged&lastName=Forged" "profile"
expect_page /profile "Doe"
if grep -qF "Forged" "$BODY"; then fail "A8: forged profile update was stored"; fi

login admin Admin_123 /benefits
csrf_refused /benefits "userId=2&benefitStartDate=2099-01-01" "benefits"
expect_page /benefits "Will"
if grep -qF "2099-01-01" "$BODY"; then fail "A8: forged benefits update was stored"; fi

rm -f "$JAR"
out="$(req --data "userName=user1&password=User1_123" "${BASE}/login")"
[ "${out%% *}" = "403" ] || fail "A8: POST /login without a CSRF token returned ${out}, expected 403 (login CSRF)"
echo "ok - A8 POST /login without a token is refused (403): login CSRF"

# --- A7 function-level access control: /benefits is for administrators -------
# Any logged-in user could list every user's benefits and change their start dates.
login user1 User1_123 /dashboard
out="$(req "${BASE}/benefits")"
if grep -qF "Will" "$BODY"; then fail "A7: user1 can see the benefits list (${out})"; fi
[ "${out%% *}" = "403" ] || fail "A7: user1 GET /benefits returned ${out}, expected 403"
t="$(token /memos)"
out="$(req --data-urlencode "_csrf=$t" --data "userId=3&benefitStartDate=2099-12-31" "${BASE}/benefits")"
[ "${out%% *}" = "403" ] || fail "A7: user1 POST /benefits (with a valid CSRF token) returned ${out}, expected 403"
login admin Admin_123 /benefits
expect_page /benefits "Will"
if grep -qF "2099-12-31" "$BODY"; then fail "A7: user1 changed another user's benefit date"; fi
echo "ok - A7 a non-admin cannot view or change /benefits (403); admin still can"

# --- A2 broken authentication ------------------------------------------------
# The login page must not reveal whether a user name exists.
rm -f "$JAR"
t="$(token /login)"
req --data-urlencode "_csrf=$t" --data "userName=user1&password=wrong-password" "${BASE}/login" > /dev/null
wrong_password="$(grep -o 'Invalid[^<]*' "$BODY" | head -n 1)"
t="$(token /login)"
req --data-urlencode "_csrf=$t" --data "userName=no-such-user-$$&password=wrong-password" "${BASE}/login" > /dev/null
no_such_user="$(grep -o 'Invalid[^<]*' "$BODY" | head -n 1)"
[ -n "$wrong_password" ] && [ "$wrong_password" = "$no_such_user" ] \
  || fail "A2: login errors differ: wrong password='${wrong_password}', unknown user='${no_such_user}'"
echo "ok - A2 wrong password and unknown user get the same message: ${wrong_password}"

# Session fixation: logging in must issue a new session id.
rm -f "$JAR"
req "${BASE}/login" > /dev/null
before="$(awk '$6 == "sessionId" {print $7}' "$JAR")"
login_keep_jar() {
  local t; t="$(sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' "$BODY" | head -n 1)"
  req --data-urlencode "_csrf=$t" --data "userName=$1&password=$2" "${BASE}/login" > /dev/null
}
login_keep_jar user1 User1_123
after="$(awk '$6 == "sessionId" {print $7}' "$JAR")"
[ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ] \
  || fail "A2: session id was not regenerated at login (before=${before:0:12}…, after=${after:0:12}…)"
echo "ok - A2 login issues a new session id (no session fixation)"

# Passwords must be stored as salted hashes, never in plaintext.
node -e '
  const { MongoClient } = require("mongodb");
  (async () => {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const users = await client.db().collection("users").find({}, { projection: { userName: 1, password: 1 } }).toArray();
    await client.close();
    const plain = ["Admin_123", "User1_123", "User2_123", "Smoke_Pass1"];
    const bad = users.filter(u => plain.includes(u.password) || !/^scrypt\$/.test(String(u.password)));
    if (bad.length) { console.error("plaintext or unhashed passwords: " + bad.map(u => u.userName).join(", ")); process.exit(1); }
    console.log("ok - A2 all " + users.length + " stored passwords are scrypt hashes");
  })().catch(e => { console.error(e.message); process.exit(1); });
' || fail "A2: passwords are stored in plaintext"

# --- Logout CSRF: ending a session needs a POST with the token ---------------
# GET /logout used to destroy the session, so any page (even an <img> tag on another
# site) could log a user out.
login user1 User1_123 /dashboard
req "${BASE}/logout" > /dev/null
out="$(req "${BASE}/dashboard")"
[ "${out%% *}" = "200" ] || fail "logout CSRF: GET /logout ended the session (dashboard now ${out})"
echo "ok - GET /logout does not end the session"
out="$(req --data "" "${BASE}/logout")"
[ "${out%% *}" = "403" ] || fail "logout CSRF: POST /logout without a token returned ${out}, expected 403"
out="$(req "${BASE}/dashboard")"
[ "${out%% *}" = "200" ] || fail "logout CSRF: tokenless POST /logout ended the session"
echo "ok - POST /logout without a CSRF token is refused (403)"
t="$(token /dashboard)"
[ -n "$t" ] || fail "logout: no CSRF token on the dashboard's logout form"
out="$(req --data-urlencode "_csrf=$t" "${BASE}/logout")"
[ "${out%% *}" = "302" ] || fail "logout: POST /logout with the token returned ${out}"
out="$(req "${BASE}/dashboard")"
[[ "$out" == "302 "*/login ]] || fail "logout: session still valid after POST /logout (${out})"
echo "ok - POST /logout with the token ends the session"

# Sign-up regenerates the session; the logout form on the page it renders must work.
rm -f "$JAR"
t="$(token /signup)"
req --data-urlencode "_csrf=$t" --data "userName=logout$$&firstName=Log&lastName=Out&password=Logout_Pass1&verify=Logout_Pass1" \
  "${BASE}/signup" > /dev/null
t="$(sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' "$BODY" | head -n 1)"
out="$(req --data-urlencode "_csrf=$t" "${BASE}/logout")"
[ "${out%% *}" = "302" ] || fail "logout: the logout form rendered right after sign-up was refused (${out})"
echo "ok - the logout form rendered right after sign-up works"

# --- SSRF, A6 and ReDoS -----------------------------------------------------
# These record findings and carry on, then fail together, so one run shows all three.
findings=()
finding() { echo "FINDING: $*"; findings+=("$*"); }
login user1 User1_123 /dashboard

# SSRF: /research fetched url+symbol from the query string server-side and copied the
# response into the page, so a user could make the server read internal addresses
# (on EC2, the instance metadata service). A local "internal" server stands in for that.
INTERNAL_PORT=4555
INTERNAL_DIR="$TMP/internal"
mkdir -p "$INTERNAL_DIR"
echo "INTERNAL-SECRET-$$" > "$INTERNAL_DIR/secret.txt"
python3 -m http.server "$INTERNAL_PORT" --bind 127.0.0.1 --directory "$INTERNAL_DIR" > "$TMP/internal.log" 2>&1 &
INTERNAL_PID=$!
trap 'kill "$APP_PID" "$INTERNAL_PID" 2>/dev/null || true' EXIT
sleep 1
out="$(req --max-time 10 -G --data-urlencode "url=http://127.0.0.1:${INTERNAL_PORT}/" \
  --data-urlencode "symbol=secret.txt" "${BASE}/research" || true)"
if grep -qF "INTERNAL-SECRET-$$" "$BODY" || grep -q "GET /secret.txt" "$TMP/internal.log"; then
  finding "SSRF: /research fetched an internal URL (${out}) and returned its content"
else
  echo "ok - SSRF /research does not fetch user-supplied URLs"
fi
out="$(req -G --data-urlencode "symbol=AAPL" "${BASE}/research")"
[[ "$out" == "302 https://finance.yahoo.com/quote/AAPL" ]] \
  || finding "SSRF: /research?symbol=AAPL returned '${out}', expected a redirect to the Yahoo quote page"
out="$(req -G --data-urlencode "symbol=../../evil" "${BASE}/research")"
[ "${out%% *}" = "400" ] || finding "SSRF: an invalid symbol returned ${out}, expected 400"

# A6: SSN, date of birth and bank details must be encrypted in the database, and the
# owner must still see the original values.
t="$(token /profile)"
req --data-urlencode "_csrf=$t" --data "ssn=123-45-6789&dob=1990-01-31&bankAcc=99887766" \
  --data-urlencode "bankRouting=123456#" "${BASE}/profile" > /dev/null
req "${BASE}/profile" > /dev/null
grep -qF 'value="123-45-6789"' "$BODY" || finding "A6: the profile page does not show the saved SSN"
node -e '
  const { MongoClient } = require("mongodb");
  (async () => {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const u = await client.db().collection("users").findOne({ _id: 2 });
    await client.close();
    const plain = { ssn: "123-45-6789", dob: "1990-01-31", bankAcc: "99887766", bankRouting: "123456#" };
    const bad = Object.keys(plain).filter(f => String(u[f]).includes(plain[f]) || !/^enc:v1:/.test(String(u[f])));
    if (bad.length) { console.log("plaintext at rest: " + bad.join(", ")); process.exit(1); }
  })().catch(e => { console.log(e.message); process.exit(1); });
' > "$TMP/a6.txt" || finding "A6: $(cat "$TMP/a6.txt")"
[[ " ${findings[*]:-} " == *" A6:"* ]] || echo "ok - A6 SSN, DOB and bank details are encrypted at rest and shown to the owner"

# ReDoS: the bank routing check /([0-9]+)+\#/ backtracks exponentially on a long run of
# digits without the '#', freezing the single Node.js thread. Runs last: on vulnerable
# code it leaves the server busy.
t="$(token /profile)"
digits="$(printf '1%.0s' $(seq 1 32))!"
start=$(date +%s)
out="$(req --max-time 5 --data-urlencode "_csrf=$t" --data-urlencode "bankRouting=${digits}" "${BASE}/profile" || true)"
elapsed=$(( $(date +%s) - start ))
if [ "${out%% *}" != "200" ] || [ "$elapsed" -ge 5 ]; then
  finding "ReDoS: a 32-digit bank routing value without '#' took ${elapsed}s (${out})"
else
  grep -qF "does not comply" "$BODY" || finding "ReDoS: the invalid routing number was not rejected"
  echo "ok - ReDoS a 32-digit routing value is rejected in ${elapsed}s"
fi

[ "${#findings[@]}" -eq 0 ] || fail "${#findings[@]} finding(s): ${findings[*]}"

# --- A10 open redirect: /learn ---------------------------------------------
# /learn used to redirect to any ?url=, so a link on the trusted host could send a
# logged-in user to a phishing page. It must only ever go to the learning resource.
LEARN_URL="https://www.khanacademy.org/economics-finance-domain/core-finance/investment-vehicles-tutorial/ira-401ks/v/traditional-iras"
login user1 User1_123 /dashboard
for target in "https://evil.example/phish" "//evil.example/phish" "/\\evil.example/phish"; do
  out="$(req -G --data-urlencode "url=${target}" "${BASE}/learn")"
  location="${out#* }"
  if [[ "$location" == *"evil.example"* ]]; then
    fail "A10: GET /learn?url=${target} redirected to ${location}"
  fi
  [ "${out%% *}" = "302" ] && [ "$location" = "$LEARN_URL" ] \
    || fail "A10: GET /learn?url=${target} returned ${out}, expected 302 to the learning resource"
  echo "ok - A10 /learn ignores url=${target} and redirects only to the learning resource"
done

# --- Every template renders (template engine) ---------------------------------
for page in /tutorial /tutorial/a1 /tutorial/a2 /tutorial/a3 /tutorial/a4 /tutorial/a5 /tutorial/a6 \
            /tutorial/a7 /tutorial/a8 /tutorial/a9 /tutorial/a10 /tutorial/redos /tutorial/ssrf /signup /research; do
  out="$(req "${BASE}${page}")"
  [ "${out%% *}" = "200" ] || fail "GET ${page} returned ${out}"
done
echo "ok - all tutorial pages, /signup and /research render (200)"

# Driver errors must not be hiding in the log behind a 200 response.
if grep -qE "TypeError|MongoServerError|MongoError|UnhandledPromiseRejection" "$TMP/nodegoat.log"; then
  fail "driver or runtime error in application log"
fi
echo "ok - no driver errors in application log"
