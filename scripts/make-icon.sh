#!/usr/bin/env bash
# Make resources/icon.icns from resources/Superbrowser.png (square, ≥ 1024 px).
# Run it again after changing the PNG, and commit both files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/resources/Superbrowser.png"
OUT="$ROOT/resources/icon.icns"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"

for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$SRC" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz * 2)) $((sz * 2)) "$SRC" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT"

echo "$OUT"
