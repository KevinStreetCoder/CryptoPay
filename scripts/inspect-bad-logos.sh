#!/usr/bin/env bash
cd "$(dirname "$0")/.."
cd mobile/assets/logos/banks
for f in equity.png stanbic.png dtb.png gulf.png absa.png kcb.png; do
  echo "--- $f ---"
  if [ -f "$f" ]; then
    file --brief "$f"
    echo "First bytes: $(head -c 30 "$f" | xxd -ps -c 30)"
  fi
done
