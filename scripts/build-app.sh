#!/usr/bin/env bash
# Build Superbrowser.app (Electron, ad-hoc signed). Usage: scripts/build-app.sh [--install]
# Output: build/Superbrowser-darwin-arm64/Superbrowser.app; --install copies it to /Applications (removing an older
# copy in ~/Applications, where earlier versions installed it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTALL=0
case "${1:-}" in
  "") ;;
  --install) INSTALL=1 ;;
  *) echo "usage: $0 [--install]" >&2; exit 2 ;;
esac

[ -d node_modules ] || npm ci
npm test
rm -rf dist
npm run build

# Only the bundled output goes into the app; esbuild already inlined everything but electron.
STAGE="$ROOT/build/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R dist "$STAGE/dist"
# productName sets the app name and so the userData dir (~/Library/Application Support/Superbrowser),
# the same one `npm start` uses.
node -e '
  const root = require(process.argv[1]);
  const pkg = { name: root.name, productName: root.productName, version: root.version, main: root.main };
  require("fs").writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2) + "\n");
' "$ROOT/package.json" "$STAGE/package.json"

ELECTRON_VERSION="$(node -p 'require("electron/package.json").version')"
npx --no-install electron-packager "$STAGE" Superbrowser \
  --platform=darwin --arch=arm64 \
  --electron-version="$ELECTRON_VERSION" \
  --app-bundle-id=dev.superbrowser.app \
  --icon="$ROOT/resources/icon.icns" \
  --usage-description.Camera="Websites you allow can use your camera, for example Google Meet." \
  --usage-description.Microphone="Websites you allow can use your microphone, for example Google Meet." \
  --usage-description.LocalNetwork="Websites can reach devices on your local network, for example a Home Assistant at 192.168.x.x." \
  --out="$ROOT/build" --overwrite --prune --quiet

APP="$ROOT/build/Superbrowser-darwin-arm64/Superbrowser.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
FINAL="$APP"

if [ "$INSTALL" = 1 ]; then
  osascript -e 'quit app "Superbrowser"' >/dev/null 2>&1 || true
  rm -rf "/Applications/Superbrowser.app"
  cp -R "$APP" "/Applications/Superbrowser.app"
  rm -rf "$HOME/Applications/Superbrowser.app"
  FINAL="/Applications/Superbrowser.app"
fi

echo "$FINAL"
