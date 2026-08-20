#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TLS_DIR="$PROJECT_ROOT/data/tls"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required: https://github.com/FiloSottile/mkcert" >&2
  exit 1
fi

mkdir -p "$TLS_DIR"
NAMES="localhost 127.0.0.1 ::1 loadchat.local"
if command -v hostname >/dev/null 2>&1; then
  NAMES="$NAMES $(hostname -I 2>/dev/null || true)"
fi

mkcert -install
# shellcheck disable=SC2086
mkcert -cert-file "$TLS_DIR/cert.pem" -key-file "$TLS_DIR/key.pem" $NAMES
echo "HTTPS certificate created at $TLS_DIR/cert.pem"
echo "Restart LoadChat to enable HTTPS/WSS. Trust the mkcert root CA on client devices."
