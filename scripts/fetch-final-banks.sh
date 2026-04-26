#!/usr/bin/env bash
# Final attempt for the 4 most-popular missing banks · Equity, KCB,
# Stanbic, ABSA. Tries a curated list of direct asset URLs and uses
# librsvg-via-rsvg-convert if available for SVG rendering.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="mobile/assets/logos/banks"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36"

# Make sure rsvg-convert is around · ImageMagick's MSVG delegate is
# disabled in the Ubuntu IM6 build, but rsvg-convert renders SVG
# perfectly and is part of librsvg2-bin.
if ! command -v rsvg-convert >/dev/null 2>&1; then
  apt-get install -y librsvg2-bin >/dev/null 2>&1 || true
fi

# slug | candidate URLs (one per line, first that's a real PNG/SVG > 1KB wins)
declare -A CANDIDATES
CANDIDATES[equity]="
https://upload.wikimedia.org/wikipedia/en/3/30/Equity_Group_Holdings_Logo.png
https://upload.wikimedia.org/wikipedia/en/thumb/3/30/Equity_Group_Holdings_Logo.png/256px-Equity_Group_Holdings_Logo.png
https://equitygroupholdings.com/wp-content/uploads/2021/01/equity-bank-logo-1.png
https://equitybankgroup.com/themes/custom/equity/logo.svg
"
CANDIDATES[kcb]="
https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/KCB_Group_Logo.svg/256px-KCB_Group_Logo.svg.png
https://upload.wikimedia.org/wikipedia/commons/9/91/KCB_Group_Logo.svg
https://www.kcbgroup.com/images/kcb-logo.svg
https://kcbgroup.com/wp-content/uploads/2021/06/KCB-Group-Logo.png
"
CANDIDATES[stanbic]="
https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Stanbic_Bank_logo.svg/256px-Stanbic_Bank_logo.svg.png
https://upload.wikimedia.org/wikipedia/commons/5/5d/Stanbic_Bank_logo.svg
https://www.stanbicbank.co.ke/static_file/SBG/Content shared/Logos/Stanbic-Logo.svg
"
CANDIDATES[absa]="
https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/ABSA_Group_Limited_Logo.svg/256px-ABSA_Group_Limited_Logo.svg.png
https://upload.wikimedia.org/wikipedia/commons/d/de/ABSA_Group_Limited_Logo.svg
https://www.absabank.co.ke/content/dam/africa/absa/global/logo/absa-logo.svg
"

ok=0; fail=0
for slug in equity kcb stanbic absa; do
  out="${DEST}/${slug}.png"

  if [ -f "$out" ] && [ "$(stat -c%s "$out")" -gt 4000 ] \
     && [ "$(file --brief --mime-type "$out")" = "image/png" ]; then
    echo "${slug}: keep"
    continue
  fi
  rm -f "$out" "${out%.png}.svg"

  found=false
  while IFS= read -r url; do
    [ -z "${url// }" ] && continue
    echo "${slug}: try $url"
    tmp="${out}.tmp"
    if ! curl -fsSL --max-time 15 -A "$UA" -o "$tmp" "$url" 2>/dev/null; then
      rm -f "$tmp"; continue
    fi
    [ -s "$tmp" ] || { rm -f "$tmp"; continue; }
    [ "$(stat -c%s "$tmp")" -lt 800 ] && { rm -f "$tmp"; continue; }
    type=$(file --brief --mime-type "$tmp")
    case "$type" in
      image/png|image/jpeg)
        # Resize to 256-max and normalise as PNG
        if convert "$tmp" -resize 256x256\> -strip "png:${tmp}.fix" 2>/dev/null; then
          mv -f "${tmp}.fix" "$out"
          rm -f "$tmp"
        else
          mv -f "$tmp" "$out"
        fi
        echo "  ${slug}: ok ($(stat -c%s "$out")b)"
        ok=$((ok+1)); found=true; break
        ;;
      image/svg*)
        svg_in="${out%.png}.svg"
        mv -f "$tmp" "$svg_in"
        # Try rsvg-convert first, fall back to ImageMagick
        if rsvg-convert --width 256 -o "${out}.fix" "$svg_in" 2>/dev/null \
           || convert -background none -density 300 "$svg_in" -resize 256x256\> "${out}.fix" 2>/dev/null; then
          mv -f "${out}.fix" "$out"
          rm -f "$svg_in"
          echo "  ${slug}: SVG→PNG ok ($(stat -c%s "$out")b)"
          ok=$((ok+1)); found=true; break
        fi
        rm -f "$svg_in" "${out}.fix"
        ;;
    esac
    rm -f "$tmp"
  done <<< "${CANDIDATES[$slug]}"

  if ! $found; then
    echo "  ${slug}: ALL CANDIDATES FAILED"
    fail=$((fail+1))
  fi
done

# Convert ABSA SVG that's already in the dir, just in case
if [ -f "${DEST}/absa.svg" ] && [ ! -f "${DEST}/absa.png" ]; then
  if rsvg-convert --width 256 -o "${DEST}/absa.png" "${DEST}/absa.svg" 2>/dev/null; then
    rm -f "${DEST}/absa.svg"
    echo "absa: salvaged from existing SVG"
  fi
fi

echo "---"
echo "OK: $ok | FAIL: $fail"
ls -la "$DEST"/*.png 2>&1 | awk '{print $5, $NF}'
echo "---"
for f in "$DEST"/*.png; do
  echo "$(basename "$f"): $(file --brief --mime-type "$f")"
done
