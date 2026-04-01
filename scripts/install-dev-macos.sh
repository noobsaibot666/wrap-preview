#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ZIP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/Wrap_Preview_dev_macos.zip"
TMP_DIR="$(mktemp -d)"
APP_NAME="Wrap Preview.app"
SRC_APP_PATH="$TMP_DIR/$APP_NAME"
DEST_APP_PATH="/Applications/$APP_NAME"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "[dev-install] Dev zip not found at: $ZIP_PATH" >&2
  echo "[dev-install] Run: npm run deploy:dev:macos" >&2
  exit 1
fi

echo "[dev-install] Extracting dev app..."
ditto -x -k "$ZIP_PATH" "$TMP_DIR"

if [[ ! -d "$SRC_APP_PATH" ]]; then
  echo "[dev-install] Extracted app not found at: $SRC_APP_PATH" >&2
  exit 1
fi

echo "[dev-install] Installing to /Applications..."
rm -rf "$DEST_APP_PATH"
ditto "$SRC_APP_PATH" "$DEST_APP_PATH"

echo "[dev-install] Clearing quarantine..."
xattr -dr com.apple.quarantine "$DEST_APP_PATH" 2>/dev/null || true

echo "[dev-install] Re-signing installed app..."
codesign --force --deep --sign - "$DEST_APP_PATH"

echo "[dev-install] Verifying installed app..."
codesign --verify --deep --strict --verbose=2 "$DEST_APP_PATH"

echo "[dev-install] Launching app..."
open "$DEST_APP_PATH"

echo
echo "[dev-install] Done."
echo "Installed: $DEST_APP_PATH"
