#!/usr/bin/env python3
"""Export a source-only review package; never copy local runtime data."""
import argparse
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'README.md', 'MEDIA-BRIDGE.md', 'LICENSE', '.gitignore', '.env.example',
              'package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'start-local.command'}
SOURCE_DIRS = {'src', 'server', 'shared', 'scripts', 'tests', 'config', 'docs', 'colab', 'vendor'}
EXCLUDED = {'data', 'storage', 'node_modules', 'dist', '.venv', 'venv', '.git', '__pycache__',
            '.pytest_cache', 'screenshots', 'browser-profile', 'accounts.json', 'cookies.json', 'api_key'}
EXTENSIONS = {'.py', '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt',
              '.toml', '.html', '.css', '.sh', '.command', '.ipynb', '.svg'}


def export(source, destination):
    source, destination = source.resolve(), destination.absolute()
    if destination.resolve().is_relative_to(source):
        raise ValueError('分享目录必须在源项目之外')
    archive = destination.with_name(destination.name + '.zip')
    if destination.exists() or archive.exists():
        raise FileExistsError('目标目录或 ZIP 已存在；请换一个名称，不会覆盖旧分享包')
    files = []
    for file in sorted(source.rglob('*')):
        relative = file.relative_to(source)
        if any(part in EXCLUDED or part.startswith('.env') and part != '.env.example' for part in relative.parts):
            continue
        if file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != source):
            continue
        if not file.is_file():
            continue
        if len(relative.parts) == 1:
            if file.name not in ROOT_FILES:
                continue
        elif relative.parts[0] not in SOURCE_DIRS or not (file.suffix in EXTENSIONS or file.name in {'LICENSE', '.env.example'} or file.name.endswith('.env.example')):
            continue
        content = file.read_bytes()
        if file.suffix == '.ipynb':
            notebook = json.loads(content)
            notebook['metadata'] = {}
            for cell in notebook.get('cells', []):
                cell['metadata'] = {}
                if cell.get('cell_type') == 'code':
                    cell['outputs'], cell['execution_count'] = [], None
            content = (json.dumps(notebook, ensure_ascii=False, indent=2) + '\n').encode()
        if re.search(rb'AIza[0-9A-Za-z_-]{35}', content):
            raise ValueError(f'拒绝导出：{relative} 含 Google API key；请先移除硬编码凭据')
        files.append((relative, content, file))
    # Validate every exported source, including vendor code, before creating artifacts.
    destination.mkdir(parents=True)
    for relative, content, original in files:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        shutil.copystat(original, target)
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(destination.rglob('*')):
            if file.is_file():
                bundle.write(file, Path(destination.name) / file.relative_to(destination))
    return len(files), archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='一个尚不存在的分享目录，旁边同时生成 ZIP')
    args = parser.parse_args()
    count, archive = export(ROOT, args.destination)
    print(f'Exported {count} source files. ZIP: {archive}')
    print('Review vendor/THIRD-PARTY-NOTICES.md before public distribution; no license grant is implied.')


if __name__ == '__main__':
    main()
