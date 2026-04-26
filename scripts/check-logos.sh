#!/usr/bin/env bash
cd "$(dirname "$0")/.."
cd mobile/assets/logos/banks
for f in *.png; do
  echo "${f}: $(file --brief "$f" 2>&1)"
done
