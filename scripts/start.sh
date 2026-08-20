#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 22 或更新版本。"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "LoadChat 需要 Node.js 22+，当前版本：$(node --version)"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖…"
  npm install
fi
PACKAGE_VERSION=$(node -p "require('./package.json').version")
BUILD_VERSION=$(test -f dist/.loadchat-version && tr -d '\r\n' < dist/.loadchat-version || true)
if [ ! -f dist-server/index.js ] || [ ! -f dist/index.html ] || [ "$BUILD_VERSION" != "$PACKAGE_VERSION" ]; then
  echo "正在构建 LoadChat…"
  npm run build
fi

export NODE_ENV=production
echo "正在启动 LoadChat，按 Ctrl+C 停止。"
exec node dist-server/index.js
