#!/usr/bin/env bash
set -euo pipefail
python -m pip install -q uv
if [ ! -x /content/h3-venv/bin/python ]; then
  uv venv --python 3.12 /content/h3-venv
fi
export UV_NO_CACHE=1
# The official source supports disabling optional SRT Rust extensions.
export SGLANG_BUILD_RUST_EXTS=none
uv pip install --python /content/h3-venv/bin/python --prerelease=allow \
  'sglang[diffusion] @ git+https://github.com/sgl-project/sglang.git@45252c64ca8577fb842f953d57f85509a0aa104e#subdirectory=python'
# H3 denoising JIT-compiles fused kernels at request time and hard-fails without ninja.
uv pip install --python /content/h3-venv/bin/python ninja
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq ffmpeg
fi
/content/h3-venv/bin/sglang serve --model-type diffusion --help > /content/h3-serve-help.txt
uv pip freeze --python /content/h3-venv/bin/python > /content/h3-environment.txt
/content/h3-venv/bin/python "$(dirname "$0")/validate_install.py"
