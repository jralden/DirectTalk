#!/usr/bin/env bash
#
# Rebuild + reinstall DirectTalk.app, preserving running state.
#
#   1. If the installed app is running, terminate it.
#   2. Build the new dist/DirectTalk.app.
#   3. Replace /Applications/DirectTalk.app with the new build.
#   4. If it was running in step 1, launch the new version.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLED="/Applications/DirectTalk.app"

# 1. Terminate if running.
WAS_RUNNING=0
if pgrep -f "DirectTalk.app" >/dev/null 2>&1; then
  WAS_RUNNING=1
  echo "==> Stopping running DirectTalk"
  pkill -f "DirectTalk.app" || true
  # Wait (up to ~5s) for the port to free / processes to die.
  for _ in $(seq 1 25); do
    pgrep -f "DirectTalk.app" >/dev/null 2>&1 || break
    sleep 0.2
  done
fi

# 2. Build.
bash "$ROOT/scripts/build-app.sh"

# 3. Replace installed copy.
echo "==> Installing to $INSTALLED"
rm -rf "$INSTALLED"
cp -R "$ROOT/dist/DirectTalk.app" "$INSTALLED"

# 4. Relaunch if it had been running.
if [ "$WAS_RUNNING" -eq 1 ]; then
  echo "==> Relaunching DirectTalk"
  open "$INSTALLED"
else
  echo "==> Done (app was not running; not launched)"
fi
