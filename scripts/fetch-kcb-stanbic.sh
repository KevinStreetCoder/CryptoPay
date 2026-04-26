#!/usr/bin/env bash
# Last-mile fetch for KCB + Stanbic.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36"

# Delete bogus Stanbic (PDF screenshot)
if [ -f "$DEST/stanbic.png" ]; then
  type=$(file --brief --mime-type "$DEST/stanbic.png")
  size=$(stat -c%s "$DEST/stanbic.png")
  if [ "$type" != "image/png" ] || [ "$size" -gt 50000 ]; then
    echo "stanbic: removing bogus $size-byte $type file"
    rm -f "$DEST/stanbic.png"
  fi
fi

declare -a CANDIDATES=(
  "kcb|https://kcbgroup.com/wp-content/themes/kcbg/assets/images/logo.svg"
  "kcb|https://www.kcbgroup.com/themes/custom/kcbg/logo.svg"
  "kcb|https://kcbgroup.com/wp-content/uploads/2020/06/KCB-Group-PLC-Logo.png"
  "kcb|https://upload.wikimedia.org/wikipedia/commons/9/9c/Kcb-bank-logo.png"
  "kcb|https://kcbgroup.com/wp-content/uploads/2024/06/KCB-Logo.png"
  "kcb|https://kcbgroup.com/wp-content/uploads/KCB-logo.svg"
  "stanbic|https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Stanbic-Bank-logo.svg/256px-Stanbic-Bank-logo.svg.png"
  "stanbic|https://upload.wikimedia.org/wikipedia/commons/c/c4/Stanbic-Bank-logo.svg"
  "stanbic|https://www.stanbicbank.co.ke/static_file/SBG/Content%20shared/Logos/Stanbic-Logo.svg"
  "stanbic|https://stanbicholdings.com/static_file/SBG/Content%20shared/Logos/Stanbic-Logo.svg"
)

for entry in "${CANDIDATES[@]}"; do
  slug="${entry%%|*}"
  url="${entry#*|}"
  out="${DEST}/${slug}.png"
  [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 4000 ] && continue

  echo "${slug}: try ${url}"
  tmp="${out}.tmp"
  if ! curl -fsSL --max-time 15 -A "$UA" -o "$tmp" "$url" 2>/dev/null; then
    rm -f "$tmp"; continue
  fi
  [ -s "$tmp" ] || { rm -f "$tmp"; continue; }
  type=$(file --brief --mime-type "$tmp")
  if [[ "$type" == image/svg* ]]; then
    if rsvg-convert --width 256 -o "$out" "$tmp" 2>/dev/null; then
      rm -f "$tmp"
      echo "  ${slug}: SVG ok ($(stat -c%s "$out")b)"
    else
      rm -f "$tmp"
    fi
  elif [[ "$type" == image/png || "$type" == image/jpeg ]]; then
    if convert "$tmp" -resize 256x256\> -strip "png:${out}" 2>/dev/null; then
      rm -f "$tmp"
      echo "  ${slug}: ok ($type, $(stat -c%s "$out")b)"
    else
      rm -f "$tmp"
    fi
  else
    echo "  ${slug}: bad type $type"
    rm -f "$tmp"
  fi
done

echo "---"
ls "$DEST"/*.png | wc -l
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
