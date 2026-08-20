#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NODE_BIN=$(command -v node)
PLIST="$HOME/Library/LaunchAgents/com.loadchat.server.plist"
LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

sed \
  -e "s|__WORKING_DIRECTORY__|$PROJECT_ROOT|g" \
  -e "s|__NODE_BINARY__|$NODE_BIN|g" \
  -e "s|__LOG_DIRECTORY__|$LOG_DIR|g" \
  "$SCRIPT_DIR/com.loadchat.server.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "LoadChat LaunchAgent installed: $PLIST"
