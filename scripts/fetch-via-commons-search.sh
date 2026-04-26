#!/usr/bin/env bash
# Search Wikimedia Commons for bank-logo files, download the first
# match, render to PNG. This is the most reliable approach because
# Commons is comprehensive for major brands.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 cpay-asset-fetcher"

declare -A SEARCHES
SEARCHES[equity]="Equity Bank Group logo"
SEARCHES[kcb]="KCB Group Bank Kenya logo"
SEARCHES[stanbic]="Stanbic Bank logo"

for slug in equity kcb stanbic; do
  out="${DEST}/${slug}.png"
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 4000 ] \
     && [ "$(file --brief --mime-type "$out")" = "image/png" ]; then
    echo "${slug}: keep"
    continue
  fi

  query="${SEARCHES[$slug]}"
  api="https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=${query// /%20}&srlimit=10"
  echo "${slug}: search ${query}"
  json=$(curl -fsSL --max-time 15 -A "$UA" "$api" 2>/dev/null || true)
  if [ -z "$json" ]; then
    echo "  Commons API down"
    continue
  fi

  # Extract first 5 file titles from the search results
  files=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    for r in d.get('query', {}).get('search', [])[:5]:
        print(r.get('title', ''))
except Exception:
    pass
" "$json" 2>/dev/null || echo "")

  if [ -z "$files" ]; then
    echo "  no Commons hits"
    continue
  fi

  found=false
  while IFS= read -r title; do
    [ -z "$title" ] && continue
    # Get the file URL via imageinfo
    url_api="https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${title// /%20}&prop=imageinfo&iiprop=url&iiurlwidth=256"
    info=$(curl -fsSL --max-time 12 -A "$UA" "$url_api" 2>/dev/null || true)
    [ -z "$info" ] && continue

    file_url=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    pages = d.get('query', {}).get('pages', {})
    for _pid, page in pages.items():
        ii = page.get('imageinfo', [{}])[0]
        # Prefer the thumbnail at 256px so we don't drag down a 5MB PSD
        url = ii.get('thumburl') or ii.get('url')
        if url:
            print(url)
            break
except Exception:
    pass
" "$info" 2>/dev/null || echo "")

    if [ -z "$file_url" ]; then continue; fi

    echo "  trying ${title}: ${file_url}"
    tmp="${out}.tmp"
    if curl -fsSL --max-time 15 -A "$UA" -o "$tmp" "$file_url" 2>/dev/null \
       && [ -s "$tmp" ] && [ "$(stat -c%s "$tmp")" -gt 1500 ]; then
      type=$(file --brief --mime-type "$tmp")
      case "$type" in
        image/png|image/jpeg)
          mv -f "$tmp" "$out"
          echo "  ${slug}: ok (${type}, $(stat -c%s "$out")b)"
          found=true; break
          ;;
        image/svg*)
          svg_in="${out%.png}.svg"
          mv -f "$tmp" "$svg_in"
          if rsvg-convert --width 256 -o "$out" "$svg_in" 2>/dev/null; then
            rm -f "$svg_in"
            echo "  ${slug}: SVG→PNG ok"
            found=true; break
          fi
          rm -f "$svg_in"
          ;;
      esac
    fi
    rm -f "$tmp"
  done <<< "$files"

  $found || echo "  ${slug}: still failing"
done

echo "---"
ls "$DEST"/*.png | wc -l
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
