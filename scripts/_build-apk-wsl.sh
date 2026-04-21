#!/bin/bash
# One-shot WSL APK build — invoked via `wsl -- bash _build-apk-wsl.sh`.
set -e

source /root/.android_env
# EXPO_TOKEN must live in /root/.android_env (or be exported before
# invoking this script) — NEVER hardcode here. Rotate any previously
# committed token at https://expo.dev/accounts/*/settings/access-tokens.
: "${EXPO_TOKEN:?EXPO_TOKEN is required — set it in /root/.android_env}"
export EXPO_TOKEN
export EAS_LOCAL_BUILD_WORKINGDIR=/root/eas-sandbox

rm -rf /root/eas-sandbox /tmp/metro-cache 2>/dev/null || true
mkdir -p /root/eas-sandbox /root/cpay-apk

OUT="/root/cpay-apk/cpay-$(date +%Y%m%d-%H%M%S).apk"
echo "OUT=$OUT"

# EAS requires a git-aware cwd. Copy the project into a clean WSL-native
# location so git (and Metro) can do its thing on a Linux FS.
SRC="/mnt/c/Users/Street Coder/StartupsIdeas/CryptoPay"
WORK="/root/cpay-build-mobile"
rm -rf "$WORK"
mkdir -p "$WORK"
echo "Syncing mobile/ to $WORK (this takes 30-60s)..."
# Copy ONLY the mobile/ folder so EAS sees a top-level project — no
# parent repo that EAS might mistake for the project root.
rsync -a --delete --exclude=node_modules --exclude=dist --exclude=.expo --exclude=.git "$SRC/mobile/" "$WORK/" 2>&1 | tail -5

cd "$WORK"
# Git refuses to operate on a tree with mixed ownership by default.
git config --global --add safe.directory "$WORK"
git config --global --add safe.directory '*'
git config --global user.email build@cpay.local
git config --global user.name cpay-build
# Init git AT the project root (which is now what was SRC/mobile/).
git init -q
# Stage + commit so EAS sees at least one commit.
git add -A
git commit -qm "build" 2>&1 | tail -3 || true
echo "git status:"
git rev-parse --is-inside-work-tree 2>&1
git log --oneline -1 2>&1 | head -1

echo "Installing dependencies (WSL-native node_modules)..."
npm ci --no-audit --no-fund 2>&1 | tail -5

echo "Starting EAS local build (preview profile)..."
eas build --platform android --profile preview --local --non-interactive --output "$OUT" 2>&1 | tail -60

ls -lh "$OUT"
echo "BUILD_OK=$OUT"
