#!/usr/bin/env bash
# Back up the whole Colab session to Drive before closing the runtime.
# Model weights already verified on Drive are skipped (cache_model.py manifest);
# everything else is copied. Restore with session_restore.sh.
set -euo pipefail

DRIVE_ROOT=/content/drive/MyDrive/TapNowLocal
SESSION=$DRIVE_ROOT/session
test -d /content/drive/MyDrive || { echo 'Mount Google Drive first'; exit 1; }
mkdir -p "$SESSION/content"

echo '== 1/3 scripts, configs, logs, benchmarks, videos'
for item in /content/*; do
  name=$(basename "$item")
  case "$name" in
    drive|sample_data|MiniMax-H3|h3-venv|cloudflared|__pycache__) continue ;;
  esac
  cp -a "$item" "$SESSION/content/"
done
echo "SMALL_FILES_DONE: $(du -sh "$SESSION/content" | cut -f1)"

echo '== 2/3 Python environment (single archive; Drive is slow with many small files)'
PY_REAL=$(readlink -f /content/h3-venv/bin/python)
PATHS=(content/h3-venv)
case "$PY_REAL" in
  /usr/*) ;;  # system Python ships with every Colab image
  *) PY_HOME=$(dirname "$(dirname "$PY_REAL")"); PATHS+=("${PY_HOME#/}") ;;
esac
echo "venv python: $PY_REAL; archiving: ${PATHS[*]}"
free_gb=$(df --output=avail -BG /content | tail -1 | tr -dc 0-9)
if [ "$free_gb" -lt 30 ]; then echo "Only ${free_gb}G local free; wait for Drive uploads to drain"; exit 1; fi
tar -C / -cf - "${PATHS[@]}" | gzip -1 > "$SESSION/h3-venv.tar.gz.part"
mv "$SESSION/h3-venv.tar.gz.part" "$SESSION/h3-venv.tar.gz"
printf '%s\n' "${PATHS[@]}" > "$SESSION/h3-venv.paths"
echo "VENV_DONE: $(du -sh "$SESSION/h3-venv.tar.gz" | cut -f1)"

echo '== 3/3 model weights (skips files already verified on Drive)'
/content/h3-venv/bin/python /content/cache_model.py
date -u +%FT%TZ > "$SESSION/BACKUP_COMPLETE"
echo 'SESSION_BACKUP_COMPLETE. Now run drive.flush_and_unmount() in the notebook and wait for it to return.'
