#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Wrap Preview.app"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
ZIP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/Wrap_Preview_dev_macos.zip"

cd "$ROOT_DIR"

echo "[dev-deploy] Building Tauri app bundle..."
npx tauri build

if [[ ! -d "$APP_PATH" ]]; then
  echo "[dev-deploy] App bundle not found at: $APP_PATH" >&2
  exit 1
fi

echo "[dev-deploy] Re-signing app bundle with ad-hoc signature..."
codesign --force --deep --sign - "$APP_PATH"

echo "[dev-deploy] Verifying bundle structure..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "[dev-deploy] Creating zip archive..."
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

echo
echo "[dev-deploy] Done."
echo "App: $APP_PATH"
echo "Zip: $ZIP_PATH"
echo
echo "Note:"
echo "- This is a dev package only."
echo "- It is ad-hoc signed, not notarized."
echo "- If macOS blocks it on another machine, remove quarantine or use a proper Developer ID signed build."
