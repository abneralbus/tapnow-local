"""Run only after explicit approval to expose the authenticated video proxy."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request


def main():
    if os.environ.get('H3_ALLOW_PUBLIC_TUNNEL') != 'yes':
        raise SystemExit('Public exposure is disabled. Confirm the temporary authenticated tunnel first.')
    request = urllib.request.Request('http://127.0.0.1:30011/health', headers={
        'Authorization': 'Bearer ' + os.environ['H3_PROXY_TOKEN']})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError('Authenticated proxy is not ready')
    with urllib.request.urlopen('https://api.github.com/repos/cloudflare/cloudflared/releases/latest') as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == 'cloudflared-linux-amd64')
    digest = asset.get('digest', '')
    if not digest.startswith('sha256:'):
        raise RuntimeError('Official release does not provide a SHA256 digest; verify the binary manually')
    binary = Path('/content/cloudflared')
    temp = binary.with_suffix('.part')
    hasher = hashlib.sha256()
    try:
        with urllib.request.urlopen(asset['browser_download_url']) as src, temp.open('wb') as dst:
            while chunk := src.read(1024 * 1024):
                hasher.update(chunk); dst.write(chunk)
        if hasher.hexdigest() != digest[7:]:
            raise RuntimeError('Cloudflare release checksum mismatch')
        temp.chmod(0o700); temp.replace(binary)
    finally:
        temp.unlink(missing_ok=True)
    Path('/content/h3-cloudflared-version.json').write_text(json.dumps({
        'version': release['tag_name'], 'sha256': digest[7:]}))
    subprocess.run([str(binary), 'tunnel', '--url', 'http://127.0.0.1:30011', '--no-autoupdate'], check=True)


if __name__ == '__main__':
    import sys
    if '--self-test' in sys.argv:
        from unittest.mock import patch
        with patch.dict(os.environ, {'H3_ALLOW_PUBLIC_TUNNEL': 'no'}), patch('urllib.request.urlopen', side_effect=AssertionError('Must not use network')):
            try:
                main()
                raise AssertionError('Tunnel must stay closed without approval')
            except SystemExit as error:
                assert 'disabled' in str(error)
        print('tunnel fail-closed check passed (no network exposure)')
    else:
        main()
