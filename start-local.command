#!/bin/bash
# Start only this project's services. They stop after the last canvas closes.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PWD/.runtime/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ ! -d node_modules ]; then
  echo '请先在此目录运行 npm run setup。'
  exit 1
fi
npm run build
node server/index.mjs --production &
canvas_pid=$!
bridge_pid=''
cleanup() {
  kill -TERM "$canvas_pid" 2>/dev/null || true
  if [ -n "$bridge_pid" ]; then kill -TERM "$bridge_pid" 2>/dev/null || true; fi
  wait "$canvas_pid" 2>/dev/null || true
  if [ -n "$bridge_pid" ]; then wait "$bridge_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
python3 - <<'PY'
import json,time,urllib.request
for _ in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:4317/api/lifecycle', timeout=1) as r:
            if json.load(r).get('instanceId'):
                break
    except Exception:
        time.sleep(.25)
else:
    raise SystemExit('画布服务没有启动，请检查终端错误。')
PY
kill -0 "$canvas_pid" 2>/dev/null || { echo "本次画布进程已退出，请查看端口是否被占用。"; exit 1; }
python3 scripts/start-media-bridge.py "$@" &
bridge_pid=$!
open 'http://127.0.0.1:4317'
wait "$canvas_pid"
echo '画布已关闭，正在清理本项目的媒体服务。'
