#!/usr/bin/env bash
# 一条命令启动 LifeOS Local：装依赖 → 构建界面 → 起服务 → 打开浏览器
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"

if [[ ! -d node_modules ]]; then
  echo "▸ 安装后端依赖"
  npm install
fi

if [[ ! -f dist/index.html ]]; then
  echo "▸ 首次启动，构建界面"
  npm run build
fi

echo "▸ 打开 http://127.0.0.1:${PORT}"
( sleep 2; (command -v open >/dev/null && open "http://127.0.0.1:${PORT}") || (command -v xdg-open >/dev/null && xdg-open "http://127.0.0.1:${PORT}") || true ) &
exec npm start
