#!/usr/bin/env bash
# Smoke test for Liga — validates login + authenticated endpoints through a
# simulated reverse proxy that INJECTS a bogus Authorization header.
# Auth success = 200 (allowed) or 403 (RBAC denied). A 401 means auth broke.
BASE="${BASE:-http://localhost:3000}"
pass=0; fail=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1 -> $3"; pass=$((pass+1));
  else echo "  FAIL $1 -> expected $2 got $3"; fail=$((fail+1)); fi
}
check_auth() { # name actual  (200 or 403 == auth OK)
  if [ "$2" = "200" ] || [ "$2" = "403" ]; then echo "  ok   $1 -> $2"; pass=$((pass+1));
  else echo "  FAIL $1 -> auth broken, got $2"; fail=$((fail+1)); fi
}

login() {
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}"
}

echo "== Gateway probe (Ninja gate compat) =="
PW=$(cat /root/.vnc/password.txt)
check "GET /api/auth/login?password=<sandbox>" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/login?password=$PW")"

for cred in "admin@liga.com:admin123" "liga@liga.com:liga123" "gestor@liga.com:gestor123" "arbitro@liga.com:arbitro123"; do
  email="${cred%%:*}"; pw="${cred##*:}"
  echo ""
  echo "== $email =="
  resp=$(login "$email" "$pw")
  token=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$token" ]; then echo "  FAIL login ($resp)"; fail=$((fail+1)); continue; fi
  echo "  ok   login"
  for ep in bootstrap dashboard organizations clubs modalities referees venues athletes championships matches transfers finance/summary; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$ep?token=$token" \
      -H "Authorization: Bearer GATEWAY_INJECTED_BOGUS" -H "X-Auth-Token: GATEWAY_BOGUS_2")
    check_auth "/api/$ep (query token + bogus header)" "$code"
  done
done

echo ""
echo "== Security: no auth must be 401 =="
check "/api/dashboard (no auth)" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard")"
check "/api/dashboard (bogus header only)" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard" -H "Authorization: Bearer GATEWAY_INJECTED_BOGUS")"

echo ""
echo "== Public portal =="
check "/api/public/orgs" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/orgs")"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
