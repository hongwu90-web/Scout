#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Scout"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "==> Preparing build environment..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# 1. Build frontend
echo "==> Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  npm run build
)

# 2. Sync web dist to backend
echo "==> Syncing web dist to backend..."
rm -rf "$ROOT_DIR/backend/internal/web/dist"
mkdir -p "$ROOT_DIR/backend/internal/web/dist"
cp -R "$ROOT_DIR/frontend/dist/." "$ROOT_DIR/backend/internal/web/dist/"
printf '%s\n' "This file keeps the embedded dist directory in version control." > "$ROOT_DIR/backend/internal/web/dist/.keep"

# 3. Build standalone Go binary for macOS arm64
echo "==> Building standalone Scout binary for macOS Apple Silicon (arm64)..."
(
  cd "$ROOT_DIR/backend"
  CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o "$RESOURCES_DIR/scout" ./cmd/fusion
)
chmod +x "$RESOURCES_DIR/scout"
cp "$RESOURCES_DIR/scout" "$ROOT_DIR/scout"

# Copy .env into resources if present
if [ -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env" "$RESOURCES_DIR/.env"
fi

# 4. Use AppIcon.icns from assets/Icons/macos/ or generate from 512x512 PNG
echo "==> Setting up AppIcon.icns..."
MACOS_ICNS="$ROOT_DIR/assets/Icons/macos/AppIcon.icns"
ICON_SRC="$ROOT_DIR/assets/Icons/macos/AppIcon512.png"
if [ ! -f "$ICON_SRC" ]; then
  ICON_SRC="$ROOT_DIR/frontend/public/icon-512.png"
fi

if [ -f "$MACOS_ICNS" ]; then
  echo "==> Copying pre-compiled AppIcon.icns from assets/Icons/macos/..."
  cp "$MACOS_ICNS" "$RESOURCES_DIR/AppIcon.icns"
elif [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1; then
  ICONSET_DIR="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null 2>&1 || true
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null 2>&1 || true
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null 2>&1 || true
  sips -z 64 64     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null 2>&1 || true
  sips -z 128 128   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null 2>&1 || true
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null 2>&1 || true
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null 2>&1 || true
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null 2>&1 || true
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null 2>&1 || true
  iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns" || true
  rm -rf "$ICONSET_DIR"
fi

# 5. Create Info.plist
cat << 'EOF' > "$CONTENTS_DIR/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Scout</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.scout.app</string>
    <key>CFBundleName</key>
    <string>Scout v1.45</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.45</string>
    <key>CFBundleVersion</key>
    <string>1.45</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# 6. Compile Native macOS Swift WebKit App
echo "==> Compiling native macOS Swift WebKit app..."
mkdir -p "$DIST_DIR/.module-cache"
swiftc -module-cache-path "$DIST_DIR/.module-cache" -O -o "$MACOS_DIR/Scout" "$ROOT_DIR/scripts/macos/main.swift"
chmod +x "$MACOS_DIR/Scout"

echo "==> Creating Zip archive for easy distribution..."
(
  cd "$DIST_DIR"
  rm -f Scout-macOS-arm64.zip Scout-v1.45-macOS-arm64.zip Scout-v1.40-macOS-arm64.zip Scout-v1.33-macOS-arm64.zip Scout-v1.32-macOS-arm64.zip Scout-v1.31-macOS-arm64.zip Scout-v1.30-macOS-arm64.zip Scout-v1.20-macOS-arm64.zip
  zip -r -q Scout-v1.45-macOS-arm64.zip "$APP_NAME.app"
  cp Scout-v1.45-macOS-arm64.zip Scout-macOS-arm64.zip
)

echo "==> Done! Application bundle created at: $APP_DIR"
echo "==> Zip archive created at: $DIST_DIR/Scout-v1.45-macOS-arm64.zip"

if [ "${1:-}" = "--install" ] || [ "${INSTALL_APP:-0}" = "1" ]; then
  if [ -d "/Applications" ]; then
    echo "==> Explicit install requested: Syncing bundle to /Applications/Scout.app..."
    rm -rf "/Applications/Scout.app"
    cp -R "$APP_DIR" "/Applications/Scout.app"
  fi
else
  echo "==> Build complete. Note: /Applications/Scout.app was left untouched (pass --install or set INSTALL_APP=1 to replace)."
fi
