#!/usr/bin/env bash
#
# Build dist/DirectTalk.app — a self-contained, double-clickable macOS app.
#
# The app bundles an official (portable) Node.js binary, starts server.js, then
# opens the UI in the default browser. No system Node is required on the target
# Mac. Drag the result into /Applications.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
APP="$DIST/DirectTalk.app"
NODE_VER="v26.3.0"
NODE_ARCH="darwin-arm64"           # Apple Silicon. Change to darwin-x64 for Intel.
NODE_PKG="node-${NODE_VER}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/${NODE_VER}/${NODE_PKG}.tar.gz"
CACHE="${TMPDIR:-/tmp}/directtalk-node-${NODE_VER}-${NODE_ARCH}.tar.gz"

echo "==> Ensuring portable Node ${NODE_VER} (${NODE_ARCH})"
if [ ! -s "$CACHE" ]; then
  echo "    downloading $NODE_URL"
  curl -fL "$NODE_URL" -o "$CACHE"
fi
WORK="$(mktemp -d)"
tar xzf "$CACHE" -C "$WORK"
NODE_BIN="$WORK/${NODE_PKG}/bin/node"
[ -x "$NODE_BIN" ] || { echo "node binary not found at $NODE_BIN" >&2; exit 1; }

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

# Bundle the portable node runtime.
cp "$NODE_BIN" "$APP/Contents/Resources/node"
chmod +x "$APP/Contents/Resources/node"

# Copy only the runtime files the server needs (no tests/docs/scripts).
cp "$ROOT/server.js"   "$APP/Contents/Resources/app/"
cp "$ROOT/sessions.js" "$APP/Contents/Resources/app/"
cp "$ROOT/index.html"  "$APP/Contents/Resources/app/"
cp "$ROOT/package.json" "$APP/Contents/Resources/app/"
cp -R "$ROOT/src"      "$APP/Contents/Resources/app/"

# Launcher: the bundle's main executable. Starts the server with the bundled
# node, waits for it to accept connections, opens the browser, then blocks on
# the server so the app stays "running" until quit (which kills the server).
cat > "$APP/Contents/MacOS/DirectTalk" <<'LAUNCH'
#!/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"
RES="$HERE/../Resources"
NODE="$RES/node"
APP="$RES/app"

PORT="$("$NODE" -e "process.stdout.write(String(require('$APP/src/port.generated').PORT))")"
URL="http://localhost:$PORT"

"$NODE" "$APP/server.js" &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM

# Wait (up to ~10s) for the server to accept connections before opening the UI.
for _ in $(seq 1 50); do
  if "$NODE" -e "require('http').get('$URL',r=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

open "$URL"
wait $SRV
LAUNCH
chmod +x "$APP/Contents/MacOS/DirectTalk"

# Info.plist
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>DirectTalk</string>
  <key>CFBundleDisplayName</key>     <string>DirectTalk</string>
  <key>CFBundleIdentifier</key>      <string>com.jralden.directtalk</string>
  <key>CFBundleVersion</key>         <string>1.0.0</string>
  <key>CFBundleShortVersionString</key> <string>1.0.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>DirectTalk</string>
  <key>LSMinimumSystemVersion</key>  <string>11.0</string>
  <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
PLIST

# Ad-hoc code signature so Gatekeeper treats it as a stable, signed identity on
# this Mac. (Apps transferred to *another* Mac will still need a right-click >
# Open the first time, since this is not a Developer-ID signature.)
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || \
  echo "    (codesign skipped/failed — app still runs locally)"

rm -rf "$WORK"
echo "==> Built $APP"
echo "    Drag it into /Applications, or run: open \"$APP\""
