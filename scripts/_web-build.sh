#!/bin/bash
# Build the Expo web bundle in WSL and stash it at /root/cpay-build-mobile/dist/
# Pair script: _web-deploy-bundle.sh ships the dist to the VPS.
set -e

# 2026-05-15 · keep this isolated under /root so the Windows file
# watcher doesn't churn while metro/webpack writes hundreds of files.
WORK=/root/cpay-build-mobile
SRC=/mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/mobile

echo "=== sync mobile/ → ${WORK} (rsync, drop node_modules + dist) ==="
mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .expo \
  --exclude ios --exclude android \
  "$SRC/" "$WORK/"

echo "=== install deps (if needed) ==="
cd "$WORK"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund --prefer-offline 2>&1 | tail -10
fi

echo "=== expo export --platform web ==="
rm -rf dist
npx expo export --platform web 2>&1 | tail -20

echo "=== post-process · inject SEO head tags ==="
if [ -f "$WORK/../CryptoPay/scripts/_inject-seo-into-index.py" ]; then
  python3 "$WORK/../CryptoPay/scripts/_inject-seo-into-index.py" "$WORK/dist/index.html" || true
fi
# Fall back to local copy if the cross-mount path didn't resolve
if [ -f /mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/scripts/_inject-seo-into-index.py ]; then
  python3 /mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/scripts/_inject-seo-into-index.py \
    "$WORK/dist/index.html" || true
fi

echo "=== dist summary ==="
ls -la "$WORK/dist/" | head -15
du -sh "$WORK/dist"
echo "=== done · run _web-deploy-bundle.sh next ==="
