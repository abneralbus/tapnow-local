#!/usr/bin/env bash
# Restore a session saved by session_backup.sh into a fresh Colab runtime.
set -euo pipefail

SESSION=/content/drive/MyDrive/TapNowLocal/session
test -d /content/drive/MyDrive || { echo 'Mount Google Drive first'; exit 1; }
test -f "$SESSION/BACKUP_COMPLETE" || echo 'WARNING: last backup did not finish; restoring what exists'

echo '== 1/3 scripts, configs, logs'
cp -a "$SESSION/content/." /content/

echo '== 2/3 Python environment'
tar -C / -xzf "$SESSION/h3-venv.tar.gz"
/content/h3-venv/bin/sglang serve --help > /dev/null && echo 'VENV_OK'

echo '== 3/3 model weights: Drive -> local SSD (missing files re-download from Hugging Face)'
/content/h3-venv/bin/python /content/cache_model.py

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
echo 'RESTORE_COMPLETE. Next: nohup bash /content/start_model.sh > /content/h3-model.log 2>&1 &'
echo 'Then start auth_proxy.py from the notebook with a new temporary token.'
