#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SERVICE_DIR/loadchat.service"
NODE_BIN=$(command -v node)

mkdir -p "$SERVICE_DIR"
sed \
  -e "s|__WORKING_DIRECTORY__|$PROJECT_ROOT|g" \
  -e "s|__NODE_BINARY__|$NODE_BIN|g" \
  "$SCRIPT_DIR/loadchat.service.template" > "$SERVICE_FILE"

systemctl --user daemon-reload
systemctl --user enable --now loadchat.service
echo "LoadChat user service installed: $SERVICE_FILE"
echo "Status: systemctl --user status loadchat"
