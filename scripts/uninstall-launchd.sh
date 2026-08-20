#!/usr/bin/env sh
set -eu
PLIST="$HOME/Library/LaunchAgents/com.loadchat.server.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "LoadChat LaunchAgent removed. Application data was kept."
