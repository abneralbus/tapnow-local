"""Pin a native H3 partition, use local SSD, and reuse verified shared Drive weights."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

REPO = 'MiniMaxAI/MiniMax-H3'
REVISION = '42ed227ee7df40d41602854ae760620d6eb651fe'


def cache_source(root, name, entry):
    relative = Path(entry.get('source_path', name))
    if relative.is_absolute() or '..' in relative.parts or not relative.parts:
        raise RuntimeError('Invalid Drive cache source path')
    return root / relative


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


def cache(local, drive, partition="FL2VA"):
    from huggingface_hub import HfApi, snapshot_download, hf_hub_download
    if not Path('/content/drive/MyDrive').is_dir():
        raise RuntimeError('Mount the intended Google Drive before caching weights')
    local.mkdir(parents=True, exist_ok=True)
    drive.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    files = [f for f in api.list_repo_tree(REPO, path_in_repo=partition, recursive=True, revision=REVISION)
             if hasattr(f, 'size') and f.size > 0]
    metadata = {f.path: {'size': f.size, 'sha256': f.lfs.sha256 if f.lfs else None} for f in files}
    total = sum(f['size'] for f in metadata.values())
    missing = sum(f['size'] for name, f in metadata.items()
                  if not (local/name).is_file() or (local/name).stat().st_size != f['size'])
    if shutil.disk_usage(local).free < missing + 8 * 1024**3:
        raise RuntimeError(f'Need {missing / 1024**3:.1f} GiB for weights plus 8 GiB free headroom')
    print(f'Pinned {REPO}@{REVISION}; {partition} only: {total / 1024**3:.2f} GiB', flush=True)
    print('Drive free space is not inferred from FUSE statvfs; a quota error fails this backup.', flush=True)
    drive_manifest = drive/'verified-manifest.json'
    prior = json.loads(drive_manifest.read_text()) if drive_manifest.is_file() else {}
    verified = prior.get('files', {}) if prior.get('revision') == REVISION else {}
    completed = prior.get('completed_partitions', [prior.get('partition', 'FL2VA')] if prior.get('complete') else []) if prior.get('revision') == REVISION else []
    # Reuse only exact official SHA-256 matches from the other verified partition.
    # source_path points to one canonical Drive file; runtime paths stay partition-specific.
    by_digest = {}
    for name, entry in verified.items():
        if entry.get('sha256'):
            by_digest.setdefault((entry.get('size'), entry['sha256']), (name, entry))
    shared_bytes = 0
    for name, meta in metadata.items():
        if name in verified or not meta['sha256']:
            continue
        shared = by_digest.get((meta['size'], meta['sha256']))
        if shared:
            shared_name, entry = shared
            source = cache_source(drive, shared_name, entry)
            if source.is_file() and source.stat().st_size == meta['size']:
                verified[name] = {**meta, 'source_path': str(source.relative_to(drive))}
                shared_bytes += meta['size']
    if shared_bytes:
        print(f'Reusing {shared_bytes / 1024**3:.2f} GiB of identical verified Drive weights', flush=True)
    restore = [name for name, meta in metadata.items()
               if verified.get(name, {}).get('size') == meta['size']
               and cache_source(drive, name, verified[name]).is_file()
               and cache_source(drive, name, verified[name]).stat().st_size == meta['size']
               and (not (local/name).is_file() or (local/name).stat().st_size != meta['size'])]
    if restore:
        print(f'Restoring {len(restore)} cached files from Drive to local SSD', flush=True)
        def restore_one(name):
            meta = metadata[name]
            try:
                copy_verified(cache_source(drive, name, verified[name]), local/name, meta['size'], meta['sha256'] or verified[name]['sha256'])
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
        prior_entry = verified.get(name, {})
        prior_source = cache_source(drive, name, prior_entry)
        if prior_source.is_file() and prior_source.stat().st_size == meta['size'] and prior_entry.get('sha256'):
            result[name] = verified[name]
            continue
        wait_for_local_space(meta['size'])
        try:
            sha = copy_verified(local/name, drive/name, meta['size'], meta['sha256'])
        except ValueError:
            hf_hub_download(REPO, name, revision=REVISION, local_dir=str(local), force_download=True)
            sha = copy_verified(local/name, drive/name, meta['size'], meta['sha256'])
        result[name] = {'size': meta['size'], 'sha256': sha}
        record = {'repo': REPO, 'revision': REVISION, 'files': {**verified, **result}, 'complete': False, 'completed_partitions': completed}
        temp = drive_manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2)); temp.replace(drive_manifest)
        print('Verified Drive backup ' + name, flush=True)
    for name in ['model_index.json', 'LICENSE']:
        source = local/name
        copy_verified(source, drive/name, source.stat().st_size)
    record = {'repo': REPO, 'revision': REVISION, 'bytes': total, 'files': {**verified, **result}, 'complete': True, 'partition': partition, 'completed_partitions': sorted(set(completed + [partition]))}
    for folder in [local, drive]:
        manifest = folder/'verified-manifest.json'
        temp = manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2)); temp.replace(manifest)
    print('DRIVE_BACKUP_COMPLETE: ' + str(drive), flush=True)


def restore_only(local, drive, partition):
    """Restore an already verified partition without network access or downloads."""
    record = json.loads((drive/'verified-manifest.json').read_text())
    if record.get('repo') != REPO or record.get('revision') != REVISION:
        raise RuntimeError('Drive cache version does not match this deployment')
    completed = record.get('completed_partitions', [record.get('partition', 'FL2VA')] if record.get('complete') else [])
    if partition not in completed:
        raise RuntimeError(partition + ' backup is incomplete; finish its initial download and verification first')
    files = {name: meta for name, meta in record.get('files', {}).items()
             if name.startswith(partition + '/')}
    if not files or partition + '/model_index.json' not in files:
        raise RuntimeError(partition + ' is not cached. Enable download once to prepare it.')
    local.mkdir(parents=True, exist_ok=True)
    need = sum(meta['size'] for name, meta in files.items() if not (local/name).is_file())
    if shutil.disk_usage(local).free < need + 8 * 1024**3:
        raise RuntimeError('Not enough local SSD space for selected partition')
    def restore_one(item):
        name, meta = item
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or not meta.get('sha256'):
            raise RuntimeError('Invalid Drive cache manifest entry')
        source, target = cache_source(drive, name, meta), local/name
        if target.is_file() and target.stat().st_size == meta['size']:
            with target.open('rb') as existing:
                digest = hashlib.file_digest(existing, 'sha256').hexdigest()
            if digest == meta['sha256']:
                return
        copy_verified(source, target, meta['size'], meta['sha256'])
        print('Restored ' + name, flush=True)
    # Bound concurrency to two Drive reads; verify each file before publishing it.
    pool = ThreadPoolExecutor(max_workers=2)
    futures = [pool.submit(restore_one, item) for item in files.items()]
    try:
        for future in as_completed(futures):
            future.result()
    finally:
        # If any file fails verification, do not keep copying queued files.
        pool.shutdown(wait=True, cancel_futures=True)
    for name in ('model_index.json', 'LICENSE'):
        source = drive/name
        copy_verified(source, local/name, source.stat().st_size)
    print('MODEL_READY_ON_LOCAL_SSD: ' + str(local), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', type=Path, default=Path('/content/MiniMax-H3'))
    parser.add_argument('--drive', type=Path, default=Path('/content/drive/MyDrive/TapNowLocal/models/MiniMax-H3')/REVISION)
    parser.add_argument('--partition', choices=['FL2VA', 'Ref2VA'], default='FL2VA')
    parser.add_argument('--restore-only', action='store_true')
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
        if args.restore_only:
            restore_only(args.local, args.drive, args.partition)
        else:
            cache(args.local, args.drive, args.partition)
