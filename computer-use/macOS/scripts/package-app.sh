#!/bin/bash
#
# Assemble, sign, and install the nsai-cua helper as a macOS .app bundle.
#
# The .app is what lets the helper hold Accessibility + Screen Recording TCC
# grants on a stable identity (see make-signing-cert.sh and the research doc
# §5.2). Signing preference:
#   1. $NSAI_CUA_SIGN_IDENTITY, if set
#   2. a keychain identity named "NicoSoft CUA Dev" (run make-signing-cert.sh)
#   3. ad-hoc ("-") with a warning — works, but TCC resets on every rebuild
#
# Usage: scripts/package-app.sh
# Env:
#   NSAI_CUA_SIGN_IDENTITY   codesign identity to use
#   NSAI_CUA_INSTALL_DIR     install destination (default: ~/Applications)
#   NSAI_CUA_SKIP_INSTALL    if set, build into ./out only, don't install
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

APP_NAME="NicoSoft Computer Use"
EXE_NAME="NsComputerUseHelper"
BUNDLE_ID="dev.nicosoft.cuh"
SHORT_VERSION="1.0.1"
BUILD_VERSION="1"
INSTALL_DIR="${NSAI_CUA_INSTALL_DIR:-$HOME/.nsai/computer-use}"

OUT="$ROOT/out"
APP="$OUT/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"

echo "▸ Building release binary…"
swift build -c release
BIN="$ROOT/.build/release/$EXE_NAME"
[ -f "$BIN" ] || { echo "✗ release binary not found at $BIN"; exit 1; }

echo "▸ Assembling $APP_NAME.app…"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$BIN" "$MACOS_DIR/$EXE_NAME"
chmod +x "$MACOS_DIR/$EXE_NAME"

# Reuse the Studio app icon so the helper is visually identified with Studio.
# ROOT is computer-use/macOS; the icon lives at the repo root's build/.
STUDIO_ICON="$ROOT/../../build/icon.icns"
ICON_PLIST_KEY=""
if [ -f "$STUDIO_ICON" ]; then
  cp "$STUDIO_ICON" "$RESOURCES_DIR/AppIcon.icns"
  ICON_PLIST_KEY=$'\t<key>CFBundleIconFile</key>\n\t<string>AppIcon</string>'
  echo "▸ Bundled Studio icon (build/icon.icns)."
else
  echo "⚠ Studio icon not found at $STUDIO_ICON — using default icon."
fi

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>$EXE_NAME</string>
	<key>CFBundleDisplayName</key>
	<string>$APP_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleExecutable</key>
	<string>$EXE_NAME</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$SHORT_VERSION</string>
	<key>CFBundleVersion</key>
	<string>$BUILD_VERSION</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>NicoSoft</string>
${ICON_PLIST_KEY}
</dict>
</plist>
PLIST

# Resolve signing identity.
if [ -n "${NSAI_CUA_SIGN_IDENTITY:-}" ]; then
  IDENTITY="$NSAI_CUA_SIGN_IDENTITY"
elif security find-identity -p codesigning 2>/dev/null | grep -qF "NicoSoft CUA Dev"; then
  # No "-v": the self-signed identity is untrusted (CSSMERR_TP_NOT_TRUSTED) but
  # signs fine, which is all we need for stable local TCC.
  IDENTITY="NicoSoft CUA Dev"
else
  IDENTITY="-"
fi

if [ "$IDENTITY" = "-" ]; then
  echo "▸ Signing ad-hoc (no stable identity found)."
  echo "  ⚠ TCC grants will reset on each rebuild. Run scripts/make-signing-cert.sh"
  echo "    for a stable identity that survives rebuilds."
else
  echo "▸ Signing with identity: $IDENTITY"
fi

codesign --force --sign "$IDENTITY" --timestamp=none \
  --identifier "$BUNDLE_ID" \
  "$APP"
codesign --verify --verbose=2 "$APP" || { echo "✗ signature verification failed"; exit 1; }

echo "▸ Signed. Designated requirement:"
codesign -d -r- "$APP" 2>&1 | sed 's/^/    /' || true

if [ -n "${NSAI_CUA_SKIP_INSTALL:-}" ]; then
  echo "✓ Built (not installed): $APP"
  exit 0
fi

echo "▸ Installing to $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR"
DEST="$INSTALL_DIR/$APP_NAME.app"
# Fixed install path keeps the TCC grant stable; replace in place.
rm -rf "$DEST"
cp -R "$APP" "$DEST"

echo ""
echo "✓ Installed: $DEST"
echo ""
echo "Next steps:"
echo "  1. Launch it:        open \"$DEST\""
echo "  2. Grant permissions: System Settings ▸ Privacy & Security ▸"
echo "       • Accessibility    → enable \"$APP_NAME\""
echo "       • Screen Recording → enable \"$APP_NAME\""
echo "  3. Socket path:      ~/.nsai/computer-use/sock/nscu.sock"
echo "  4. Smoke test:       node scripts/socket-client.mjs ~/.nsai/computer-use/sock/nscu.sock '{\"method\":\"ping\"}'"
