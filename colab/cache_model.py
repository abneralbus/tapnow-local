"""Pin the native FL2VA partition, use local SSD, and keep a verified Drive copy."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

REPO = 'MiniMaxAI/MiniMax-H3'
REVISION = '42ed227ee7df40d41602854ae760620d6eb651fe'


def copy_verified(source, target, expected_size, expected_sha=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + '.part')
    digest = hashlib.sha256()
    size = 0
    try:
        with source.open('rb') as src, temp.open('wb') as dst:
            while chunk := src.read(8 * 1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                dst.write(chunk)
        actual_sha = digest.hexdigest()
        if size != expected_size or (expected_sha and actual_sha != expected_sha):
            raise ValueError('Model cache checksum mismatch: ' + str(source))
        temp.replace(target)
        return actual_sha
    except BaseException:
        temp.unlink(missing_ok=True)
        raise


def wait_for_local_space(need_bytes, path='/content', headroom=15 * 1024**3, timeout=3600):
    """Colab's Drive FUSE stages writes on the local disk; wait until uploads drain."""
    deadline = time.time() + timeout
    while shutil.disk_usage(path).free < need_bytes + headroom:
        if time.time() > deadline:
            raise RuntimeError('Local disk did not drain within timeout; Drive upload may be stuck')
        print(f'Waiting for Drive upload to drain: free {shutil.disk_usage(path).free / 1024**3:.1f} GiB, '
              f'need {(need_bytes + headroom) / 1024**3:.1f} GiB', flush=True)
        time.sleep(30)


def cache(local, drive):
    from huggingface_hub import HfApi, snapshot_download, hf_hub_download
    if not Path('/content/drive/MyDrive').is_dir():
        raise RuntimeError('Mount the intended Google Drive before caching weights')
    local.mkdir(parents=True, exist_ok=True)
    drive.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    files = [f for f in api.list_repo_tree(REPO, path_in_repo='FL2VA', recursive=True, revision=REVISION)
             if hasattr(f, 'size') and f.size > 0]
    metadata = {f.path: {'size': f.size, 'sha256': f.lfs.sha256 if f.lfs else None} for f in files}
    total = sum(f['size'] for f in metadata.values())
    missing = sum(f['size'] for name, f in metadata.items()
                  if not (local/name).is_file() or (local/name).stat().st_size != f['size'])
    if shutil.disk_usage(local).free < missing + 8 * 1024**3:
        raise RuntimeError(f'Need {missing / 1024**3:.1f} GiB for weights plus 8 GiB free headroom')
    print(f'Pinned {REPO}@{REVISION}; FL2VA only: {total / 1024**3:.2f} GiB', flush=True)
    print('Drive free space is not inferred from FUSE statvfs; a quota error fails this backup.', flush=True)
    drive_manifest = drive/'verified-manifest.json'
    prior = json.loads(drive_manifest.read_text()) if drive_manifest.is_file() else {}
    verified = prior.get('files', {}) if prior.get('revision') == REVISION else {}
    restore = [name for name, meta in metadata.items()
               if verified.get(name, {}).get('size') == meta['size']
               and (drive/name).is_file() and (drive/name).stat().st_size == meta['size']
               and (not (local/name).is_file() or (local/name).stat().st_size != meta['size'])]
    if restore:
        print(f'Restoring {len(restore)} cached files from Drive to local SSD', flush=True)
        def restore_one(name):
            meta = metadata[name]
            try:
                copy_verified(drive/name, local/name, meta['size'], meta['sha256'] or verified[name]['sha256'])
                print('Restored ' + name, flush=True)
            except ValueError:
                verified.pop(name, None)
                print('Drive checksum mismatch; will download a fresh official copy: ' + name, flush=True)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(restore_one, restore))
    download = [name for name, meta in metadata.items()
                if not (local/name).is_file() or (local/name).stat().st_size != meta['size']]
    if download:
        snapshot_download(REPO, revision=REVISION, allow_patterns=download,
                          local_dir=str(local), max_workers=4)
    # Keep the model identity for SGLang pipeline discovery without downloading duplicate root weights.
    snapshot_download(REPO, revision=REVISION, allow_patterns=['model_index.json', 'LICENSE'],
                      local_dir=str(local), max_workers=2)
    print('MODEL_READY_ON_LOCAL_SSD: ' + str(local), flush=True)
    result = {}
    for name, meta in metadata.items():
        if (drive/name).is_file() and (drive/name).stat().st_size == meta['size'] and verified.get(name, {}).get('sha256'):
            result[name] = verified[name]
            continue
        wait_for_local_space(meta['size'])
        try:
            sha = copy_verified(local/name, drive/name, meta['size'], meta['sha256'])
        except ValueError:
            hf_hub_download(REPO, name, revision=REVISION, local_dir=str(local), force_download=True)
            sha = copy_verified(local/name, drive/name, meta['size'], meta['sha256'])
        result[name] = {'size': meta['size'], 'sha256': sha}
        record = {'repo': REPO, 'revision': REVISION, 'files': {**verified, **result}, 'complete': False}
        temp = drive_manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2)); temp.replace(drive_manifest)
        print('Verified Drive backup ' + name, flush=True)
    for name in ['model_index.json', 'LICENSE']:
        source = local/name
        copy_verified(source, drive/name, source.stat().st_size)
    record = {'repo': REPO, 'revision': REVISION, 'bytes': total, 'files': result, 'complete': True}
    for folder in [local, drive]:
        manifest = folder/'verified-manifest.json'
        temp = manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2)); temp.replace(manifest)
    print('DRIVE_BACKUP_COMPLETE: ' + str(drive), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', type=Path, default=Path('/content/MiniMax-H3'))
    parser.add_argument('--drive', type=Path, default=Path('/content/drive/MyDrive/TapNowLocal/models/MiniMax-H3')/REVISION)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        with tempfile.TemporaryDirectory() as folder:
            src, dst = Path(folder)/'src', Path(folder)/'dst'
            src.write_bytes(b'weights')
            digest = hashlib.sha256(b'weights').hexdigest()
            assert copy_verified(src, dst, 7, digest) == digest
            assert dst.read_bytes() == b'weights'
            try:
                copy_verified(src, dst, 8, digest)
                raise AssertionError('Expected integrity error')
            except ValueError:
                assert dst.read_bytes() == b'weights'
                assert not dst.with_name('dst.part').exists()
        print('model cache integrity checks passed')
    else:
        os.environ['HF_XET_CHUNK_CACHE_SIZE_BYTES'] = '0'
        cache(args.local, args.drive)
