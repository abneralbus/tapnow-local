#!/usr/bin/env bash
set -euo pipefail
# ninja (JIT kernels) lives in the venv; the server is launched without activating it.
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export PATH=/content/h3-venv/bin:/usr/local/cuda/bin:$PATH
command -v ninja >/dev/null || { echo 'ninja missing: uv pip install --python /content/h3-venv/bin/python ninja'; exit 1; }
test -f /content/h3-install.ok || { echo 'Install must finish first'; exit 1; }
# Experimental benchmark entry; never replace a running session.
if [ -e /content/tapnow-h3-state/session.json ]; then
  echo 'Existing session detected. Finish/save/release it before testing Turbo.'; exit 1
fi
H3_VARIANT=ref2va
/content/h3-venv/bin/python -c "import sys; sys.path.insert(0, '/content/tapnow-h3'); from prepare_ref2va_turbo import LOCAL,FILENAME,valid; assert valid(LOCAL/FILENAME), 'Run prepare_ref2va_turbo.py first'"
H3_TURBO_FILE=/content/tapnow-h3-adapters/30f485ed874aa44c8183348ad361c5eabad318da/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors
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
  --lora-path "$H3_TURBO_FILE" --lora-nickname ref2va-turbo-4step \
  --lora-alpha 8 --lora-scale 1.0 --lora-merge-mode auto \
  --num-gpus 1 --tp-size 1 --ulysses-degree 1 \
  --performance-mode manual \
  --component-residency dit=resident text_encoder=layerwise-offload vae=resident audio_vae=resident \
  --pin-cpu-memory false --enable-torch-compile false \
  --attention-backend fa --warmup-mode off \
  --output-path /content/h3-videos \
  --host 127.0.0.1 --port 30020
