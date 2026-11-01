#!/usr/bin/env bash
# Save the environment without copying unrelated /content files or credentials.
set -euo pipefail
H3_HELPERS=$(cd -- "$(dirname -- "$0")" && pwd)
export PYTHONPATH="$H3_HELPERS${PYTHONPATH:+:$PYTHONPATH}"
/content/h3-venv/bin/python -c 'import notebook_session; notebook_session.save_environment()'
echo 'Environment backup complete. Flush Drive before releasing the runtime.'
