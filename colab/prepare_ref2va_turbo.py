"""Stage the pinned Ref2VA Turbo adapter; never load or stop a GPU model."""
import hashlib
import json
from pathlib import Path
import shutil

REPO = 'lightx2v/Minimax-h3-Turbo'
REVISION = '30f485ed874aa44c8183348ad361c5eabad318da'
FILENAME = 'minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors'
SIZE = 1383677768
SHA256 = '9e642fc8749c74f8da5e2382877ab5c7aa37b9a73b7fd0d6d457bd1b3cb1ae99'
LOCAL = Path('/content/tapnow-h3-adapters') / REVISION
DRIVE = Path('/content/drive/MyDrive/TapNowLocal/adapters') / REVISION

def valid(path):
    if not path.is_file() or path.stat().st_size != SIZE:
        return False
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == SHA256

def prepare():
    from huggingface_hub import hf_hub_download
    if not Path('/content/drive/MyDrive').is_dir():
        raise RuntimeError('Mount the intended Drive first')
    LOCAL.mkdir(parents=True, exist_ok=True)
    DRIVE.mkdir(parents=True, exist_ok=True)
    source, backup = LOCAL/FILENAME, DRIVE/FILENAME
    if not valid(source):
        if shutil.disk_usage(LOCAL).free < SIZE + 8*1024**3:
            raise RuntimeError('Need adapter size plus 8 GiB free disk')
        if valid(backup):
            temporary = source.with_suffix('.part')
            shutil.copyfile(backup, temporary)
            if not valid(temporary):
                raise RuntimeError('Restored adapter failed verification')
            temporary.replace(source)
        else:
            hf_hub_download(REPO, FILENAME, revision=REVISION, local_dir=LOCAL)
    if not valid(source):
        raise RuntimeError('Downloaded adapter failed verification')
    if not valid(backup):
        temporary = backup.with_suffix('.part')
        shutil.copyfile(source, temporary)
        if not valid(temporary):
            raise RuntimeError('Drive adapter failed verification')
        temporary.replace(backup)
    record = dict(repo=REPO, revision=REVISION, filename=FILENAME, sha256=SHA256,
                  bytes=SIZE, variant='ref2va', steps=4, lora_alpha=8,
                  lora_scale=1.0, flow_shift=12, audio_flow_shift=3,
                  reference_resize_mode='match', inference_verified=False)
    for folder in (LOCAL, DRIVE):
        temp = folder/'verified-manifest.json.part'
        temp.write_text(json.dumps(record, indent=2))
        temp.replace(folder/'verified-manifest.json')
    print('REF2VA_TURBO_ADAPTER_VERIFIED:', source, flush=True)
    print('Drive backup verified; inference has NOT been tested.', flush=True)

if __name__ == '__main__':
    prepare()
