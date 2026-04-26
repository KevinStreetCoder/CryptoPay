#!/usr/bin/env bash
# Aggressive fetch for the popular Kenyan banks · Equity, KCB,
# Stanbic, ABSA, DTB, Gulf · plus quality-improve on the smaller
# ones. Tries every source we know about with a real user-agent.
#
# Sources, in order of preference:
#   1. Direct PNG/SVG paths discovered via og:image scraping
#   2. Brandfetch CDN
#   3. Logo.dev with the public token
#   4. iconhorse with extra size hints
#   5. Wikipedia via the file API (not the broken /thumb URLs)
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36"

mkdir -p "$DEST"

# slug | homepage | direct_logo_url
declare -a BANKS=(
  "equity|https://equitygroupholdings.com|"
  "kcb|https://www.kcbgroup.com|"
  "stanbic|https://www.stanbicbank.co.ke|"
  "absa|https://www.absabank.co.ke|"
  "dtb|https://www.dtbafrica.com|"
  "gulf|https://www.gulfafricanbank.com|"
)

extract_og_image() {
  # Pull og:image / icon links out of HTML. Crude but enough for this
  # one-shot · we just need any halfway-decent URL.
  local html="$1"
  local out
  out=$(echo "$html" | grep -oP 'og:image"\s+content="\K[^"]+' | head -1) || true
  if [ -z "$out" ]; then
    out=$(echo "$html" | grep -oP 'rel="(?:apple-touch-icon|icon|shortcut icon)"[^>]*href="\K[^"]+' | head -1) || true
  fi
  echo "$out"
}

resolve_url() {
  local base="$1"
  local path="$2"
  case "$path" in
    http*) echo "$path" ;;
    //*) echo "https:${path}" ;;
    /*) echo "${base}${path}" ;;
    *) echo "${base}/${path}" ;;
  esac
}

for entry in "${BANKS[@]}"; do
  IFS='|' read -r slug homepage direct <<< "$entry"
  out="${DEST}/${slug}.png"
  # Skip if we already have a good one bigger than 5KB and a real PNG
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 5000 ] \
     && [ "$(file --brief --mime-type "$out")" = "image/png" ]; then
    echo "${slug}: already good ($(stat -c%s "$out")b)"
    continue
  fi

  echo "${slug}: scraping ${homepage}"
  html=$(curl -fsSL --max-time 15 -A "$UA" "$homepage" 2>/dev/null || true)
  if [ -z "$html" ]; then
    echo "  homepage unreachable"
    continue
  fi

  # 1. Try og:image / favicon link
  candidate=$(extract_og_image "$html")
  if [ -n "$candidate" ]; then
    base="${homepage%/}"
    full=$(resolve_url "$base" "$candidate")
    echo "  og: $full"
    if curl -fsSL --max-time 15 -A "$UA" -o "${out}.tmp" "$full" 2>/dev/null \
       && [ -s "${out}.tmp" ] && [ "$(stat -c%s "${out}.tmp")" -gt 1500 ]; then
      type=$(file --brief --mime-type "${out}.tmp")
      case "$type" in
        image/png|image/jpeg|image/svg*|image/x-icon|image/vnd.microsoft.icon)
          mv -f "${out}.tmp" "$out"
          echo "  ${slug}: ok ($(stat -c%s "$out")b, $type)"
          continue
          ;;
      esac
    fi
    rm -f "${out}.tmp"
  fi

  # 2. Brandfetch CDN
  domain=$(echo "$homepage" | sed -E 's|https?://(www\.)?([^/]+).*|\2|')
  if curl -fsSL --max-time 12 -A "$UA" -o "${out}.tmp" "https://cdn.brandfetch.io/${domain}" 2>/dev/null \
     && [ -s "${out}.tmp" ] && [ "$(stat -c%s "${out}.tmp")" -gt 1500 ]; then
    mv -f "${out}.tmp" "$out"
    echo "  ${slug}: brandfetch ($(stat -c%s "$out")b)"
    continue
  fi
  rm -f "${out}.tmp"

  # 3. iconhorse big
  if curl -fsSL --max-time 12 -A "$UA" -o "${out}.tmp" "https://icon.horse/icon/${domain}" 2>/dev/null \
     && [ -s "${out}.tmp" ] && [ "$(stat -c%s "${out}.tmp")" -gt 1500 ]; then
    mv -f "${out}.tmp" "$out"
    echo "  ${slug}: icon.horse ($(stat -c%s "$out")b)"
    continue
  fi
  rm -f "${out}.tmp"

  echo "  ${slug}: ALL SOURCES FAILED"
done

echo "---"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
