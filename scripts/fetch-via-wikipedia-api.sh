#!/usr/bin/env bash
# Get bank logos via Wikipedia's MediaWiki API · the `pageimages`
# property returns the main image URL for a given article. This is
# stable, well-formed PNG, and won't break when the article gets
# rewritten.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 cpay-asset-fetcher (https://cpay.co.ke)"

# slug | wikipedia article title (URL-encoded if needed)
declare -a TITLES=(
  "equity|Equity_Group_Holdings"
  "kcb|KCB_Group"
  "stanbic|Stanbic_Bank_Kenya"
  "absa|Absa_Bank_Kenya"
  "dtb|Diamond_Trust_Bank"
  "gulf|Gulf_African_Bank"
)

# Clean up the HTML we accidentally saved
for slug in equity stanbic dtb gulf; do
  f="${DEST}/${slug}.png"
  if [ -f "$f" ] && [ "$(file --brief --mime-type "$f")" = "text/html" ]; then
    rm -f "$f"
  fi
done

for entry in "${TITLES[@]}"; do
  IFS='|' read -r slug title <<< "$entry"
  out="${DEST}/${slug}.png"

  # Skip if already a real PNG > 4KB
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 4000 ] \
     && [ "$(file --brief --mime-type "$out")" = "image/png" ]; then
    echo "${slug}: keep ($(stat -c%s "$out")b)"
    continue
  fi

  api="https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=original&titles=${title}"
  json=$(curl -fsSL --max-time 15 -A "$UA" "$api" 2>/dev/null || true)
  if [ -z "$json" ]; then
    echo "${slug}: API down for ${title}"
    continue
  fi

  # Extract the original.source URL · pageimages returns a single image
  # per page. Use python to parse json safely.
  url=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    pages = d.get('query', {}).get('pages', {})
    for _pid, page in pages.items():
        orig = page.get('original') or {}
        src = orig.get('source')
        if src:
            print(src)
            break
except Exception:
    pass
" "$json" 2>/dev/null || echo "")

  if [ -z "$url" ]; then
    echo "${slug}: no pageimage on ${title}"
    continue
  fi

  echo "${slug}: ${url}"
  if curl -fsSL --max-time 20 -A "$UA" -o "${out}.tmp" "$url" 2>/dev/null \
     && [ -s "${out}.tmp" ]; then
    type=$(file --brief --mime-type "${out}.tmp")
    case "$type" in
      image/png|image/jpeg|image/svg*)
        mv -f "${out}.tmp" "$out"
        echo "  ${slug}: ok ($(stat -c%s "$out")b, $type)"
        ;;
      *)
        echo "  ${slug}: bad type $type"
        rm -f "${out}.tmp"
        ;;
    esac
  else
    echo "  ${slug}: download failed"
    rm -f "${out}.tmp"
  fi
done

echo "---"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
