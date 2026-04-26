#!/usr/bin/env bash
# Convert any non-PNG bank logo files to true PNG (256x256 max),
# delete bad downloads, and report. Uses ImageMagick 6 (`convert`).
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"

for f in "$DEST"/*.png; do
  type=$(file --brief --mime-type "$f")
  base=$(basename "$f")

  case "$type" in
    image/png)
      dim=$(identify -format "%w %h" "$f" 2>/dev/null || echo "0 0")
      w=$(echo "$dim" | cut -d' ' -f1)
      h=$(echo "$dim" | cut -d' ' -f2)
      if [ "$w" -gt 256 ] || [ "$h" -gt 256 ]; then
        convert "$f" -resize 256x256\> -strip "${f}.tmp" && mv -f "${f}.tmp" "$f"
        echo "${base}: resized PNG to 256max"
      else
        echo "${base}: PNG ${w}x${h}"
      fi
      ;;
    image/jpeg)
      convert "$f" -strip "${f}.tmp" && mv -f "${f}.tmp" "$f"
      echo "${base}: JPEG → PNG"
      ;;
    image/x-icon|image/vnd.microsoft.icon)
      # Move to .ico extension so convert reads correctly, pick largest
      tmp_ico="${f%.png}.ico"
      mv -f "$f" "$tmp_ico"
      # Try frames 0..5, keep largest
      best="${f}.best"
      bestw=0
      for i in 0 1 2 3 4 5; do
        cand="${f}.try${i}"
        if convert "${tmp_ico}[${i}]" "$cand" 2>/dev/null; then
          w=$(identify -format "%w" "$cand" 2>/dev/null || echo 0)
          if [ "$w" -gt "$bestw" ]; then
            bestw=$w
            mv -f "$cand" "$best"
          else
            rm -f "$cand"
          fi
        fi
      done
      if [ -f "$best" ]; then
        # Upscale tiny favicons to a usable 96px so they don't look pixelated
        convert "$best" -filter Lanczos -resize 256x256\> -resize 96x96^ -gravity center -extent 96x96 -strip "$f" && rm -f "$best"
        echo "${base}: ICO → PNG (was ${bestw}px wide)"
      else
        echo "${base}: ICO unreadable" >&2
        rm -f "$tmp_ico"
        continue
      fi
      rm -f "$tmp_ico"
      ;;
    *)
      echo "${base}: bad type ($type) · removing" >&2
      rm -f "$f"
      ;;
  esac
done

echo "---"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
