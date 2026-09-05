#!/usr/bin/env bash
set -euo pipefail

# Scout Background Feed Sync Service Setup (macOS LaunchAgent)
# Keeps Scout feeds synchronized 24/7 in the background even when GUI is closed.

PLIST_LABEL="com.scout.puller"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ACTION="${1:-install}"
INTERVAL_SECONDS="${2:-900}" # Default: 15 minutes (900s)

# Locate scout binary
SCOUT_BIN=""
if [ -f "/Applications/Scout.app/Contents/Resources/scout" ]; then
    SCOUT_BIN="/Applications/Scout.app/Contents/Resources/scout"
elif [ -f "$PROJECT_ROOT/dist/Scout.app/Contents/Resources/scout" ]; then
    SCOUT_BIN="$PROJECT_ROOT/dist/Scout.app/Contents/Resources/scout"
elif [ -f "$PROJECT_ROOT/scout" ]; then
    SCOUT_BIN="$PROJECT_ROOT/scout"
fi

if [ "$ACTION" = "uninstall" ]; then
    echo "==> Stopping and removing Scout background service..."
    launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
    rm -f "$PLIST_FILE"
    echo "==> Uninstalled successfully."
    exit 0
fi

if [ -z "$SCOUT_BIN" ] || [ ! -f "$SCOUT_BIN" ]; then
    echo "Error: Scout binary not found. Please build the application first."
    exit 1
fi

LOG_DIR="$HOME/Library/Application Support/Scout/logs"
mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

echo "==> Configuring LaunchAgent using binary: $SCOUT_BIN"
echo "==> Interval: ${INTERVAL_SECONDS} seconds ($(( INTERVAL_SECONDS / 60 )) minutes)"

cat <<PLIST_CONTENT > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${SCOUT_BIN}</string>
        <string>--pull-once</string>
    </array>
    <key>StartInterval</key>
    <integer>${INTERVAL_SECONDS}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/background_pull.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/background_pull.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>FUSION_DB_PATH</key>
        <string>${HOME}/Library/Application Support/Scout/fusion.db</string>
    </dict>
</dict>
</plist>
PLIST_CONTENT

chmod 644 "$PLIST_FILE"

# Unload previous version if running
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

# Load and bootstrap service
launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"

echo "==> Scout background sync service installed and activated successfully!"
echo "==> Feeds will automatically sync every $(( INTERVAL_SECONDS / 60 )) minutes in the background."
echo "==> Logs: ${LOG_DIR}/background_pull.log"
