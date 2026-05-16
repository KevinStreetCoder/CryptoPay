#!/bin/bash
# Same detached-launch pattern as _apk-build-detached.sh but for the
# AAB production profile.
set -e

BUILD_SCRIPT="/mnt/c/Users/Street Coder/StartupsIdeas/CryptoPay/scripts/_build-aab-wsl.sh"
# Per-build log file · timestamp so concurrent / re-run builds never
# clobber each other and we can always tail the right one.
LOG_FILE="/root/aab-build-$(date +%Y%m%d-%H%M%S).log"

: > "$LOG_FILE"
echo "[$(date -Iseconds)] launcher · spawning detached AAB build" >> "$LOG_FILE"

setsid nohup bash "$BUILD_SCRIPT" </dev/null >>"$LOG_FILE" 2>&1 &
disown $!

CHILD_PID=$!
echo "[$(date -Iseconds)] launcher · detached child pid=$CHILD_PID" >> "$LOG_FILE"
echo "AAB build detached · tail -f $LOG_FILE · expect ~10-12 min"
echo "Output: /root/cpay-aab/cpay-v<version>-vc<vc>-<timestamp>.aab"
