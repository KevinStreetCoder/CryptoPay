#!/usr/bin/env bash
# Final bank-logo pass:
#   1. Convert any SVG/ICO files to true PNG (256-px max).
#   2. Aggressively scrape the bank's homepage for a logo <img> tag.
#   3. Try a curated list of known-good direct URLs for Kenyan banks.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36"

# ── Step 1 · normalise everything that's not already a PNG ─────────
for f in "$DEST"/*.png; do
  [ -e "$f" ] || continue
  type=$(file --brief --mime-type "$f")
  base=$(basename "$f")
  case "$type" in
    image/png) ;; # ok
    image/svg+xml|image/svg)
      # Render SVG to a 256-px PNG with transparent background
      tmp="${f}.tmp"
      mv -f "$f" "${f%.png}.svg"
      if convert -background none -density 300 "${f%.png}.svg" -resize 256x256\> "$tmp" 2>/dev/null; then
        mv -f "$tmp" "$f"
        rm -f "${f%.png}.svg"
        echo "${base}: SVG→PNG ok"
      else
        echo "${base}: SVG render failed" >&2
        rm -f "$tmp" "${f%.png}.svg"
      fi
      ;;
    image/jpeg)
      convert "$f" -strip "png:${f}.tmp" && mv -f "${f}.tmp" "$f"
      echo "${base}: JPEG→PNG"
      ;;
    image/x-icon|image/vnd.microsoft.icon)
      tmp_ico="${f%.png}.ico"
      mv -f "$f" "$tmp_ico"
      best=""
      bestw=0
      for i in 0 1 2 3 4 5; do
        cand="${f}.try${i}"
        if convert "${tmp_ico}[${i}]" "$cand" 2>/dev/null; then
          w=$(identify -format "%w" "$cand" 2>/dev/null || echo 0)
          if [ "$w" -gt "$bestw" ]; then
            bestw=$w
            mv -f "$cand" "${f}.best"
          else
            rm -f "$cand"
          fi
        fi
      done
      if [ -f "${f}.best" ]; then
        # Upscale tiny favicons to 96px so they don't look pixelated
        convert "${f}.best" -filter Lanczos -resize 256x256\> -resize 96x96^ -gravity center -extent 96x96 -strip "$f"
        rm -f "${f}.best" "$tmp_ico"
        echo "${base}: ICO→PNG (was ${bestw}px)"
      fi
      ;;
    text/html|text/xml|*)
      echo "${base}: bad type ${type} · removing" >&2
      rm -f "$f"
      ;;
  esac
done

# ── Step 2 · deeper scrape for the popular missing banks ─────────────
declare -a TARGETS=(
  "equity|https://equitygroupholdings.com"
  "stanbic|https://www.stanbicbank.co.ke"
  "dtb|https://www.dtbafrica.com"
  "gulf|https://www.gulfafricanbank.com"
)

scrape_logo_img() {
  # Pull every <img> tag from the HTML, score each by likelihood of
  # being the brand logo (path contains `logo`, sits in header/nav,
  # is SVG or large PNG). Prints the top URL.
  local html="$1" base="$2"
  echo "$html" \
    | grep -oP '<img\s+[^>]*src="\K[^"]+' \
    | head -40 \
    | grep -iE 'logo|brand' \
    | head -3 \
    | while read -r src; do
        case "$src" in
          http*) echo "$src" ;;
          //*) echo "https:${src}" ;;
          /*) echo "${base%/}${src}" ;;
          *) echo "${base%/}/${src}" ;;
        esac
      done
}

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r slug homepage <<< "$entry"
  out="${DEST}/${slug}.png"

  # Skip if already a good PNG
  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 3000 ] \
     && [ "$(file --brief --mime-type "$out")" = "image/png" ]; then
    echo "${slug}: already good"
    continue
  fi

  echo "${slug}: scrape ${homepage}"
  html=$(curl -fsSL --max-time 15 -A "$UA" "$homepage" 2>/dev/null || true)
  if [ -z "$html" ]; then
    echo "  homepage unreachable"
    continue
  fi

  found=false
  while IFS= read -r logo_url; do
    [ -z "$logo_url" ] && continue
    echo "  trying: $logo_url"
    tmp="${out}.tmp"
    if curl -fsSL --max-time 12 -A "$UA" -o "$tmp" "$logo_url" 2>/dev/null \
       && [ -s "$tmp" ] && [ "$(stat -c%s "$tmp")" -gt 800 ]; then
      type=$(file --brief --mime-type "$tmp")
      case "$type" in
        image/png|image/jpeg)
          mv -f "$tmp" "$out"
          echo "  ${slug}: ok (${type})"
          found=true
          break
          ;;
        image/svg*)
          mv -f "$tmp" "${out%.png}.svg"
          if convert -background none -density 300 "${out%.png}.svg" -resize 256x256\> "$out" 2>/dev/null; then
            rm -f "${out%.png}.svg"
            echo "  ${slug}: SVG→PNG ok"
            found=true
            break
          fi
          ;;
      esac
    fi
    rm -f "$tmp"
  done < <(scrape_logo_img "$html" "$homepage")

  if ! $found; then
    echo "  ${slug}: no usable logo on the homepage"
  fi
done

echo "---"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
echo "---"
for f in "$DEST"/*.png; do
  echo "$(basename "$f"): $(file --brief "$f")"
done
