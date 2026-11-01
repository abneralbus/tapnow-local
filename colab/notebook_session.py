"""Notebook-owned lifecycle. Import this in the Colab kernel, not the model venv."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time
import urllib.request

ROOT = Path('/content/tapnow-h3')
STATE = Path('/content/tapnow-h3-state')
DRIVE = Path('/content/drive/MyDrive/TapNowLocal')
REVISION = '42ed227ee7df40d41602854ae760620d6eb651fe'
_processes = []
_watcher = None


def prepare(variant='fl2va', allow_download=False, install_env=False):
    if variant not in ('fl2va', 'ref2va'):
        raise ValueError('Select fl2va or ref2va')
    if not DRIVE.parent.is_dir():
        raise RuntimeError('Mount the mert Google Drive first')
    if (STATE/'session.json').exists():
        raise RuntimeError('A session already exists. Finish it before restarting or changing mode.')
    memory = int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.total','--format=csv,noheader,nounits'], text=True).splitlines()[0])
    ram = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))
    if memory < 75000 or ram < 120*1024**2:
        raise RuntimeError('This original-weight profile needs an 80 GB-class GPU and at least 120 GiB RAM. Stop here; use a separately tested low-memory profile on smaller machines.')
    python = Path('/content/h3-venv/bin/python')
    if install_env:
        subprocess.run(['bash', str(ROOT/'install.sh')], check=True)
    elif not python.exists():
        archive = DRIVE/'session/h3-venv.tar.gz'
        if not archive.is_file() or not (DRIVE/'session/BACKUP_COMPLETE').is_file():
            raise RuntimeError('No complete saved environment. Set INSTALL_ENV=True for first-time installation.')
        subprocess.run(['tar','-C','/','-xzf',str(archive)], check=True)
    # A saved install marker is not evidence that a restored environment still works.
    Path('/content/h3-install.ok').unlink(missing_ok=True)
    subprocess.run([str(python), str(ROOT/'validate_install.py')], check=True)
    partition = 'Ref2VA' if variant=='ref2va' else 'FL2VA'
    command = [str(python),str(ROOT/'cache_model.py'),'--partition',partition]
    if not allow_download:
        command.append('--restore-only')
    subprocess.run(command, check=True)
    # Keep deployment helpers current without copying tokens, notebooks' outputs, or private config.
    deployment = DRIVE/'deployment'
    deployment.mkdir(parents=True, exist_ok=True)
    for file in ROOT.iterdir():
        if file.suffix in ('.py','.sh'):
            shutil.copy2(file, deployment/file.name)
    print('Ready to start', partition, 'from local SSD.')


def release_runtime():
    from google.colab import drive, runtime
    drive.flush_and_unmount()
    runtime.unassign()


def start(variant, token, auto_release=True, idle_seconds=60, open_tunnel=True):
    global _watcher
    if _processes or (STATE/'session.json').exists():
        raise RuntimeError('Session already started; do not run the start cell twice')
    if len(token)<32:
        raise ValueError('Use a temporary token with at least 32 characters')
    env = {**os.environ,'H3_VARIANT':variant,'H3_PROXY_TOKEN':token,
           'H3_AUTO_RELEASE':'yes' if auto_release else 'no','H3_IDLE_SECONDS':str(idle_seconds)}
    def launch(command, name):
        with open('/content/h3-'+name+'.log','w') as log:
            process = subprocess.Popen(command,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        _processes.append(process)
        return process
    def wait_ready(url, process, headers=None, timeout=1200):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            if process.poll() is not None:
                raise RuntimeError('Service exited; inspect /content/h3-*.log')
            try:
                with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}), timeout=3) as response:
                    if response.status==200:
                        return
            except Exception:
                pass
            time.sleep(3)
        raise TimeoutError('Service did not become ready; inspect logs before retrying')
    try:
        model=launch(['bash',str(ROOT/'start_model.sh')],'model')
        wait_ready('http://127.0.0.1:30020/health',model)
        proxy=launch(['/content/h3-venv/bin/python',str(ROOT/'session_service.py')],'proxy')
        wait_ready('http://127.0.0.1:30011/v1/session',proxy,{'Authorization':'Bearer '+token},timeout=60)
        if open_tunnel:
            env['H3_ALLOW_PUBLIC_TUNNEL']='yes'
            launch(['/content/h3-venv/bin/python',str(ROOT/'open_tunnel.py')],'tunnel')
    except BaseException:
        for process in reversed(_processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        _processes.clear()
        raise
    def monitor():
        while True:
            time.sleep(3)
            try:
                state=json.loads((STATE/'session.json').read_text())
                if state['phase']!='release_requested':
                    continue
                # Gateway has stopped admitting work and verified each completed output's receipt.
                release_runtime()
                return
            except Exception as error:
                (STATE/'release-error.json').write_text(json.dumps({'error':str(error)}))
                print('GPU release did not complete. Check Colab and disconnect/delete runtime manually:',error)
                return
    _watcher=threading.Thread(target=monitor,daemon=True)
    _watcher.start()
    print('Model and authenticated gateway ready. GPU release watcher is active.')


def save_environment():
    """Optional one-time environment backup, without copying the whole /content directory."""
    session=DRIVE/'session'
    session.mkdir(parents=True, exist_ok=True)
    python=Path('/content/h3-venv/bin/python').resolve()
    paths=['content/h3-venv']
    if not str(python).startswith('/usr/'):
        paths.append(str(python.parent.parent).lstrip('/'))
    archive=session/'h3-venv.tar.gz.part'
    subprocess.run(['tar','-C','/','-czf',str(archive),*paths],check=True)
    archive.replace(session/'h3-venv.tar.gz')
    (session/'BACKUP_COMPLETE').write_text(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    print('Saved Python environment for future sessions.')
