#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0"

URLS=(
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Stanbic_Bank_Kenya_logo.svg/256px-Stanbic_Bank_Kenya_logo.svg.png"
  "https://upload.wikimedia.org/wikipedia/commons/0/02/Stanbic_Bank_Kenya_logo.svg"
  "https://upload.wikimedia.org/wikipedia/en/2/26/Stanbic_Bank_Kenya_Limited_Logo.png"
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Stanbic_Bank_logo_2024.svg/256px-Stanbic_Bank_logo_2024.svg.png"
  "https://upload.wikimedia.org/wikipedia/commons/4/41/Stanbic_Bank_logo_2024.svg"
)

for url in "${URLS[@]}"; do
  echo "trying $url"
  tmp="$DEST/stanbic.tmp"
  if ! curl -fsSL --max-time 12 -A "$UA" -o "$tmp" "$url" 2>/dev/null; then
    rm -f "$tmp"
    continue
  fi
  if [ ! -s "$tmp" ]; then rm -f "$tmp"; continue; fi
  type=$(file --brief --mime-type "$tmp")
  echo "  got: $type ($(stat -c%s "$tmp")b)"
  case "$type" in
    image/svg*)
      if rsvg-convert --width 256 -o "$DEST/stanbic.png" "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        echo "  ok SVG"
        break
      fi
      ;;
    image/png|image/jpeg)
      if convert "$tmp" -resize 256x256\> -strip "png:$DEST/stanbic.png" 2>/dev/null; then
        rm -f "$tmp"
        echo "  ok"
        break
      fi
      ;;
  esac
  rm -f "$tmp"
done

if [ -f "$DEST/stanbic.png" ]; then
  ls -la "$DEST/stanbic.png"
else
  echo "NO STANBIC LOGO · will use coloured-letter fallback"
fi
