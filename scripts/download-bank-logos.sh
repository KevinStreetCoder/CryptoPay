#!/usr/bin/env bash
# Download bank logos to mobile/assets/logos/banks/.
# Tries Clearbit first (best quality), falls back to Google favicon at 256px.
# Run from project root.
set -euo pipefail

DEST="mobile/assets/logos/banks"
mkdir -p "$DEST"

# slug:domain pairs · keep parallel to backend/apps/payments/banks.py.
BANKS=(
  "equity:equitygroupholdings.com"
  "kcb:kcbgroup.com"
  "coop:co-opbank.co.ke"
  "ncba:ncbagroup.com"
  "absa:absabank.co.ke"
  "stanbic:stanbicbank.co.ke"
  "stanchart:sc.com"
  "im:imbank.com"
  "dtb:dtbafrica.com"
  "family:familybank.co.ke"
  "hfc:hfgroup.co.ke"
  "sidian:sidianbank.co.ke"
  "boa:boakenya.com"
  "ecobank:ecobank.com"
  "gulf:gulfafricanbank.com"
)

ok=0; fail=0
for entry in "${BANKS[@]}"; do
  slug="${entry%%:*}"
  domain="${entry#*:}"
  out="${DEST}/${slug}.png"

  # Tier 1: Clearbit
  if curl -fsSL --max-time 10 -o "$out" "https://logo.clearbit.com/${domain}" 2>/dev/null \
     && [ -s "$out" ] && [ "$(stat -c%s "$out")" -gt 500 ]; then
    echo "${slug}: clearbit ($(stat -c%s "$out")b)"
    ok=$((ok+1))
    continue
  fi

  # Tier 2: Google favicon at 256px (consistently scales to a clean 36px tile)
  if curl -fsSL --max-time 10 -o "$out" "https://www.google.com/s2/favicons?domain=${domain}&sz=256" 2>/dev/null \
     && [ -s "$out" ] && [ "$(stat -c%s "$out")" -gt 200 ]; then
    echo "${slug}: google ($(stat -c%s "$out")b)"
    ok=$((ok+1))
    continue
  fi

  # Tier 3: bank's own /favicon.ico
  if curl -fsSL --max-time 10 -o "${out%.png}.ico" "https://${domain}/favicon.ico" 2>/dev/null \
     && [ -s "${out%.png}.ico" ]; then
    echo "${slug}: site favicon"
    ok=$((ok+1))
    continue
  fi

  echo "${slug}: ALL FAILED" >&2
  fail=$((fail+1))
  rm -f "$out" "${out%.png}.ico"
done

echo "---"
echo "OK: $ok | FAIL: $fail"
ls -la "$DEST"
