#!/usr/bin/env bash
# B14 (17.3): smoke test after a deploy, from outside, through Cloudflare (as a visitor would arrive).
#   infra/deploy/smoke.sh https://staging.example.lk
# Staging sits behind Cloudflare Access: CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (a service token) are sent
# when set. Checks readiness (database + migration), the home page, the catalogue and the sitemap. The full journey
# (sign-in, checkout) is B15's Playwright test.
set -euo pipefail

base="${1:?usage: smoke.sh <site address>}"
base="${base%/}"
headers=()
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" ]]; then
  headers=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
fi

check() {
  local path="$1" expect="$2" body status
  body=$(mktemp)
  for attempt in 1 2 3 4 5 6; do
    status=$(curl -sS -o "$body" -w '%{http_code}' --max-time 30 "${headers[@]}" "$base$path" || echo 000)
    if [[ "$status" == "200" ]] && grep -q -- "$expect" "$body"; then
      echo "{\"msg\":\"smoke.ok\",\"path\":\"$path\"}"
      rm -f "$body"
      return 0
    fi
    sleep $((attempt * 5))
  done
  echo "{\"msg\":\"smoke.failed\",\"path\":\"$path\",\"status\":\"$status\"}"
  rm -f "$body"
  return 1
}

check /api/ready '"ok":true'
check / '<html'
check /shop '<html'
check /sitemap.xml '<urlset'
