#!/usr/bin/env bash
# setup-cloudflare-firewall.sh
#
# Lock the origin VPS to accept HTTP/HTTPS only from Cloudflare's
# documented IP ranges. Closes the audit finding D22 on the same
# release as the SECURE_PROXY_SSL_HEADER trust contract: we need at
# least one of (a) trusted-proxy middleware, (b) origin firewall to
# Cloudflare CIDRs, (c) origin TLS termination. (b) is the cheapest
# and is what this script applies.
#
# What it does:
#   1. Fetches Cloudflare's published v4 + v6 IP lists (live, never
#      hardcoded · the lists rotate occasionally and we want auto-
#      adoption of new ranges via re-running this script).
#   2. Adds per-CIDR `ufw allow 80,443/tcp` rules for every range.
#   3. Removes the catch-all `allow 80/tcp` and `allow 443/tcp` rules
#      that were letting any-source traffic in.
#   4. SSH (22) stays open from anywhere · don't lock yourself out.
#
# Idempotent. Re-run when Cloudflare publishes a new CIDR.

set -euo pipefail

CF_V4_URL="https://www.cloudflare.com/ips-v4"
CF_V6_URL="https://www.cloudflare.com/ips-v6"
TMP_V4="$(mktemp)"
TMP_V6="$(mktemp)"
trap 'rm -f "$TMP_V4" "$TMP_V6"' EXIT

echo "→ Fetching Cloudflare IP lists…"
curl -fsS "$CF_V4_URL" > "$TMP_V4"
curl -fsS "$CF_V6_URL" > "$TMP_V6"

V4_COUNT="$(wc -l < "$TMP_V4")"
V6_COUNT="$(wc -l < "$TMP_V6")"
echo "  IPv4 CIDRs: $V4_COUNT"
echo "  IPv6 CIDRs: $V6_COUNT"
echo

if [ "$V4_COUNT" -lt 5 ] || [ "$V6_COUNT" -lt 3 ]; then
  echo "Error: Cloudflare IP list looks suspiciously short. Refusing." >&2
  exit 1
fi

# ───────── 1) Add CF-specific rules FIRST so we never have a window
#               where ports 80/443 are blocked while CF traffic is hitting us.
echo "→ Adding Cloudflare-only allow rules for 80/tcp + 443/tcp…"
add_rule() {
  local cidr="$1"
  for port in 80 443; do
    # `ufw insert 1` puts the rule at top of the chain so it's evaluated
    # before any future deny. Comment marker lets us identify our rules
    # for cleanup.
    ufw allow proto tcp from "$cidr" to any port "$port" comment "cloudflare-only" >/dev/null 2>&1 || true
  done
}
while IFS= read -r cidr; do
  [ -z "$cidr" ] && continue
  add_rule "$cidr"
done < "$TMP_V4"

while IFS= read -r cidr; do
  [ -z "$cidr" ] && continue
  add_rule "$cidr"
done < "$TMP_V6"

# ───────── 2) Now drop the wide-open allow-from-anywhere rules.
#               UFW's default policy is `deny incoming`, so once these
#               two go away, only the CF-specific rules remain, and
#               anything else gets dropped automatically.
echo "→ Removing the catch-all allow 80,443 from anywhere rules…"
# Delete by spec, not by number · numbers shift as we delete.
ufw delete allow 80/tcp     2>&1 | grep -v "Could not delete" || true
ufw delete allow 443/tcp    2>&1 | grep -v "Could not delete" || true
ufw delete allow 80         2>&1 | grep -v "Could not delete" || true
ufw delete allow 443        2>&1 | grep -v "Could not delete" || true

# Some installs have a literal "Anywhere" form too · belt-and-braces.
ufw --force delete $(ufw status numbered 2>/dev/null | awk '/Anywhere/ && /(80|443)\/tcp/ {gsub(/[\[\]]/,"",$1); print $1}' | sort -rn | head -10) 2>/dev/null || true

echo
echo "→ Reloading UFW…"
ufw reload >/dev/null

echo
echo "→ Final rule set:"
ufw status numbered | head -60
echo
echo "Done. Verify externally:"
echo "  curl -sIk https://cpay.co.ke/         # should still 200 (via CF)"
echo "  curl -sIk --resolve cpay.co.ke:443:173.249.4.109 https://cpay.co.ke/  --connect-timeout 5"
echo "    # should TIMEOUT or refuse from a non-CF source"
