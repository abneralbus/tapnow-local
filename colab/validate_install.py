"""Fail before weight loading if required native H3 code or CLI flags are absent."""
import importlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    for executable in ('ffmpeg', 'ffprobe', 'nvidia-smi'):
        if not shutil.which(executable):
            raise RuntimeError('Missing executable: ' + executable)
    for module in ('sglang.multimodal_gen.runtime.pipelines.minimax_h3_pipeline',
                   'sglang.multimodal_gen.runtime.entrypoints.http_server',
                   'fastapi', 'httpx', 'uvicorn'):
        importlib.import_module(module)
    import ninja
    cli = Path(sys.executable).parent/'sglang'
    help_text = subprocess.check_output([str(cli), 'serve', '--model-type', 'diffusion', '--help'], text=True, stderr=subprocess.STDOUT)
    for flag in ('--component-residency', '--model-variant', '--pipeline-class-name', '--served-model-name'):
        if flag not in help_text:
            raise RuntimeError('Installed CLI is missing ' + flag)
    hardware = subprocess.check_output(['nvidia-smi', '--query-gpu=name,memory.total,driver_version',
                                        '--format=csv,noheader'], text=True).strip()
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('PyTorch cannot access the GPU')
    record = {'gpu': hardware, 'python': sys.version, 'torch': torch.__version__,
              'torch_cuda': torch.version.cuda, 'device_capability': torch.cuda.get_device_capability(),
              'sglang_commit': '45252c64ca8577fb842f953d57f85509a0aa104e',
              'scope': 'imports, CLI flags and GPU visibility only; no model inference'}
    Path('/content/h3-install-check.json').write_text(json.dumps(record, indent=2))
    Path('/content/h3-install.ok').touch()
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
