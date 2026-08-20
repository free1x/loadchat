#!/usr/bin/env sh
set -eu
SERVICE_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/loadchat.service"
systemctl --user disable --now loadchat.service 2>/dev/null || true
rm -f "$SERVICE_FILE"
systemctl --user daemon-reload
echo "LoadChat user service removed. Application data was kept."
