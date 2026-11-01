#!/usr/bin/env bash
# Legacy command-line restore entry; the daily notebook uses notebook_session.prepare.
set -euo pipefail
SESSION=/content/drive/MyDrive/TapNowLocal/session
test -f "$SESSION/BACKUP_COMPLETE" || { echo 'No complete environment backup'; exit 1; }
if [ ! -x /content/h3-venv/bin/python ]; then
  tar -C / -xzf "$SESSION/h3-venv.tar.gz"
fi
H3_HELPERS=$(cd -- "$(dirname -- "$0")" && pwd)
/content/h3-venv/bin/python "$H3_HELPERS/validate_install.py"
/content/h3-venv/bin/python "$H3_HELPERS/cache_model.py" --partition "${H3_PARTITION:-FL2VA}" --restore-only
echo 'RESTORE_COMPLETE. Start the model and session gateway from the daily notebook.'
