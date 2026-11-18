#!/usr/bin/env bash
# Build Superbrowser.app (ad-hoc signed). Usage: scripts/build-app.sh [--install]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTALL=0
case "${1:-}" in
  "") ;;
  --install) INSTALL=1 ;;
  *) echo "usage: $0 [--install]" >&2; exit 2 ;;
esac

APP="$ROOT/build/Superbrowser.app"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/Superbrowser"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/Superbrowser"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.superbrowser.app</string>
  <key>CFBundleName</key><string>Superbrowser</string>
  <key>CFBundleExecutable</key><string>Superbrowser</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist"

codesign --force --sign - "$APP"
FINAL="$APP"

if [ "$INSTALL" = 1 ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Superbrowser.app"
  cp -R "$APP" "$HOME/Applications/Superbrowser.app"
  FINAL="$HOME/Applications/Superbrowser.app"
  echo "If Accessibility stopped working after a rebuild, run: tccutil reset Accessibility dev.superbrowser.app, then re-grant."
fi

echo "$FINAL"
