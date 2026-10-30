#!/bin/bash
# Install into this checkout; never overwrite an existing local configuration.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("需要 Node.js 22.12 或更新版本")'
python3 -c 'import sys; assert sys.version_info >= (3,10), "需要 Python 3.10+"'
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r vendor/flowboard/agent/requirements.txt ./vendor/muse2api
umask 077
mkdir -p data/private/flow data/private/muse/data
[ -f .env ] || cp .env.example .env
[ -f data/private/flow/.env ] || cp config/flow.env.example data/private/flow/.env
[ -f data/private/muse/.env ] || cp config/muse.env.example data/private/muse/.env
npm run build
printf '%s\n' '安装完成。画布：npm start；Flow / Muse 首次连接请按 MEDIA-BRIDGE.md 配置自己的账号。' '视频预览还需要 ffmpeg。macOS 可通过 Homebrew 安装：brew install ffmpeg'
