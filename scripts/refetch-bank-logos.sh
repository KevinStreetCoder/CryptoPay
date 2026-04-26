#!/usr/bin/env bash
# Re-fetch missing/poor bank logos with alternate domains.
set -euo pipefail

DEST="mobile/assets/logos/banks"
mkdir -p "$DEST"

# Try multiple domains per slug · ordered by likelihood Clearbit/Google
# has the brand. The first one that returns >1.5 KB wins.
declare -a CANDIDATES=(
  # slug | domain1 | domain2 | domain3
  "equity|equitybankgroup.com|equitygroupholdings.com|equitybank.co.ke"
  "kcb|kcbgroup.com|kcbbankgroup.com|kcbbank.co.ke"
  "stanbic|stanbicbank.co.ke|stanbicbank.com|stanbic.com"
  "boa|boakenya.com|bankofafrica.co.ke|boagroup.com"
  "hfc|hfgroup.co.ke|housingfinance.co.ke|hf.co.ke"
  "dtb|dtbafrica.com|dtbk.co.ke|diamondtrust.co.ke"
  "gulf|gulfafricanbank.com|gulfbank.co.ke|gulfafricanbank.co.ke"
  "absa|absabank.co.ke|absa.co.ke|absa.africa"
)

for entry in "${CANDIDATES[@]}"; do
  slug="${entry%%|*}"
  rest="${entry#*|}"
  out="${DEST}/${slug}.png"

  # Skip if we already have a good one
  if [ -f "$out" ] && [ -s "$out" ] && [ "$(stat -c%s "$out")" -gt 1500 ]; then
    echo "${slug}: keep existing ($(stat -c%s "$out")b)"
    continue
  fi

  found=false
  IFS='|' read -ra DOMAINS <<< "$rest"
  for domain in "${DOMAINS[@]}"; do
    # Tier 1: Clearbit
    if curl -fsSL --max-time 8 -o "$out" "https://logo.clearbit.com/${domain}" 2>/dev/null \
       && [ -s "$out" ] && [ "$(stat -c%s "$out")" -gt 1500 ]; then
      echo "${slug}: clearbit ${domain} ($(stat -c%s "$out")b)"
      found=true
      break
    fi
    # Tier 2: Google favicon at 256
    if curl -fsSL --max-time 8 -o "$out" "https://www.google.com/s2/favicons?domain=${domain}&sz=256" 2>/dev/null \
       && [ -s "$out" ] && [ "$(stat -c%s "$out")" -gt 1500 ]; then
      echo "${slug}: google ${domain} ($(stat -c%s "$out")b)"
      found=true
      break
    fi
  done

  if ! $found; then
    echo "${slug}: ALL DOMAINS FAILED" >&2
    rm -f "$out"
  fi
done

echo "---"
ls -la "$DEST"/*.png 2>&1
