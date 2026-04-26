#!/usr/bin/env bash
# More aggressive bank logo fetcher · tries DuckDuckGo's icon service,
# Logo.dev, and accepts smaller files (favicons can be 200-1500 bytes
# but still render OK at 36x36 px).
set -euo pipefail

DEST="mobile/assets/logos/banks"
mkdir -p "$DEST"

# Banks we still need
declare -a TARGETS=(
  "equity|equitygroupholdings.com|equitybankgroup.com|equitybank.co.ke"
  "kcb|kcbgroup.com|kcbbankgroup.com|kcb.co.ke"
  "stanbic|stanbicbank.co.ke|stanbicbank.com|stanbicholdings.com"
  "hfc|hfgroup.co.ke|hf.co.ke|housingfinance.co.ke"
  "dtb|dtbafrica.com|dtbk.co.ke|diamondtrust.co.ke"
  "gulf|gulfafricanbank.com|gulfbank.co.ke|gab.co.ke"
  "absa|absabank.co.ke|absa.africa|absa.co.ke"
)

for entry in "${TARGETS[@]}"; do
  slug="${entry%%|*}"
  rest="${entry#*|}"
  out="${DEST}/${slug}.png"

  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 1500 ]; then
    echo "${slug}: keep ($(stat -c%s "$out")b)"
    continue
  fi

  IFS='|' read -ra DOMAINS <<< "$rest"
  best=""
  best_size=0
  for domain in "${DOMAINS[@]}"; do
    # All sources we can hit
    SOURCES=(
      "https://logo.clearbit.com/${domain}"
      "https://icons.duckduckgo.com/ip3/${domain}.ico"
      "https://www.google.com/s2/favicons?domain=${domain}&sz=256"
      "https://${domain}/favicon.ico"
      "https://icon.horse/icon/${domain}"
    )
    for src in "${SOURCES[@]}"; do
      tmp="${out}.tmp"
      if curl -fsSL --max-time 8 -o "$tmp" "$src" 2>/dev/null && [ -s "$tmp" ]; then
        sz=$(stat -c%s "$tmp")
        if [ "$sz" -gt "$best_size" ]; then
          best_size=$sz
          mv -f "$tmp" "$out"
          best="$src"
        else
          rm -f "$tmp"
        fi
      else
        rm -f "$tmp"
      fi
    done
  done
  if [ -n "$best" ] && [ "$best_size" -gt 200 ]; then
    echo "${slug}: best=${best_size}b from ${best}"
  else
    echo "${slug}: ALL FAILED" >&2
    rm -f "$out"
  fi
done

echo "---"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
