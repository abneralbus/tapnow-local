#!/usr/bin/env bash
set -euo pipefail
# ninja (JIT kernels) lives in the venv; the server is launched without activating it.
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export PATH=/content/h3-venv/bin:/usr/local/cuda/bin:$PATH
command -v ninja >/dev/null || { echo 'ninja missing: uv pip install --python /content/h3-venv/bin/python ninja'; exit 1; }
test -f /content/h3-install.ok || { echo 'Install must finish first'; exit 1; }
H3_VARIANT=${H3_VARIANT:-fl2va}
case "$H3_VARIANT" in
  fl2va) H3_PARTITION=FL2VA ;;
  ref2va) H3_PARTITION=Ref2VA ;;
  *) echo 'H3_VARIANT must be fl2va or ref2va'; exit 1 ;;
esac
test -f "/content/MiniMax-H3/$H3_PARTITION/model_index.json" || { echo "Native $H3_PARTITION weights missing"; exit 1; }
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
mkdir -p /content/h3-videos
# shortcut: unbenchmarked 96 GB single-card placement; tune only after a real baseline.
exec /content/h3-venv/bin/sglang serve \
  --model-type diffusion \
  --model-path /content/MiniMax-H3 \
  --model-id MiniMax-H3 \
  --pipeline-class-name MiniMaxH3Pipeline \
  --served-model-name MiniMaxAI/MiniMax-H3 \
  --model-variant "$H3_VARIANT" --backend sglang \
  --num-gpus 1 --tp-size 1 --ulysses-degree 1 \
  --performance-mode manual \
  --component-residency dit=resident text_encoder=layerwise-offload vae=resident audio_vae=resident \
  --pin-cpu-memory false --enable-torch-compile false \
  --attention-backend fa --warmup-mode off \
  --output-path /content/h3-videos \
  --host 127.0.0.1 --port 30020
