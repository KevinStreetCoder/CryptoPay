#!/bin/bash
# One-time Android SDK install for local APK builds via EAS.
# Installs platform-tools, platforms 34/35, build-tools 34.0.0/35.0.0,
# NDK 27.1.12297006, and CMake 3.22.1 under $HOME/android-sdk. Persists
# ANDROID_HOME and PATH additions to ~/.bashrc.
#
# Run from WSL Ubuntu (or any Linux): bash scripts/install-android-sdk.sh
# Total download + install: ~15-20 min, ~6 GB on disk.
set -e

SDK="$HOME/android-sdk"
mkdir -p "$SDK/cmdline-tools"
cd "$SDK/cmdline-tools"

echo "[1/5] Downloading cmdline-tools..."
if [ ! -f tools.zip ]; then
  curl -fsSL -o tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
fi

echo "[2/5] Extracting cmdline-tools..."
rm -rf latest
unzip -q tools.zip
mv cmdline-tools latest

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$PATH"

echo "[3/5] Accepting licenses..."
yes | sdkmanager --licenses > /dev/null 2>&1 || true

echo "[4/5] Installing SDK packages (~15 min)..."
sdkmanager \
  "platform-tools" \
  "platforms;android-34" \
  "platforms;android-35" \
  "build-tools;34.0.0" \
  "build-tools;35.0.0" \
  "ndk;27.1.12297006" \
  "cmake;3.22.1" 2>&1 | tail -10

echo "[5/5] Persisting env to ~/.bashrc..."
if ! grep -q ANDROID_HOME "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'EOF'

# Android SDK
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$PATH"
EOF
fi

echo "DONE: SDK installed at $SDK"
ls "$SDK"
