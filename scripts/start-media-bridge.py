#!/usr/bin/env python3
"""Start local media services and stop owned processes when the canvas exits."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "media-bridge"
OPENER = build_opener(ProxyHandler({}))


def dotenv(path: Path, prefix: str) -> dict[str, str]:
    """Read data, never execute shell syntax or print credential values."""
    result = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip().removeprefix("export ")
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key.startswith(prefix):
                if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                result[key] = value
    return result


def health(port: int, path: str) -> dict | None:
    try:
        with OPENER.open(Request(f"http://127.0.0.1:{port}{path}"), timeout=2) as response:
            state = json.loads(response.read(1_000_000))
            state["_tapnow_bridge"] = response.headers.get("X-Tapnow-Media-Bridge") == "1"
            return state
    except Exception:
        return None


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def private_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as file:
        file.write(text)
    path.chmod(0o600)


def muse_enabled(requested: bool | None, config_path: Path) -> bool:
    if requested is not None:
        return requested
    try:
        config = json.loads(config_path.read_text())
        return config.get("museEnabled") is True and config.get("musePaused") is False
    except (OSError, ValueError, AttributeError):
        return False


class CanvasWatch:
    """Follow one Node instance; brief missed polls never stop active services."""

    def __init__(self, now: float, startup_timeout: float = 120, disconnect_grace: float = 5):
        self.started_at = now
        self.startup_timeout = startup_timeout
        self.disconnect_grace = disconnect_grace
        self.instance_id = None
        self.missing_since = None

    def observe(self, state: dict | None, now: float) -> str | None:
        instance = state.get("instanceId") if isinstance(state, dict) and state.get("app") == "tapnow-local" else None
        if isinstance(instance, str) and instance:
            if self.instance_id is None:
                self.instance_id = instance
            if instance == self.instance_id:
                self.missing_since = None
                return None
        if self.instance_id is None:
            if now - self.started_at >= self.startup_timeout:
                return "Canvas backend did not start; stopping owned media services."
            return None
        if self.missing_since is None:
            self.missing_since = now
        if now - self.missing_since >= self.disconnect_grace:
            return "Canvas backend exited; stopping owned media services."
        return None


def stop_owned_processes(children) -> None:
    """Only signal process groups created by this launcher, never a reused service."""
    for child in children:
        if child.poll() is None:
            child.terminate()  # Let uvicorn finish its shutdown and close its browser.
    deadline = time.monotonic() + 12
    for child in children:
        try:
            child.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    # A child may have crashed while leaving Chromium/renderers behind. Each
    # child was spawned with start_new_session=True, so these groups are ours.
    groups = []
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            groups.append(child.pid)
        except ProcessLookupError:
            pass
    if groups:
        time.sleep(0.2)
    for group in groups:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for child in children:
        child.wait(timeout=5)


def prepare(args):
    old_flow, old_muse = args.flow_source.resolve(), args.muse_source.resolve()
    # Keep the venv entry-point path: resolving its symlink would lose pyvenv.cfg.
    flow_python = (args.flow_python or ROOT / ".venv/bin/python").absolute()
    muse_python = (args.muse_python or ROOT / ".venv/bin/python").absolute()
    environments = [("Flow", flow_python)]
    if args.with_muse:
        environments.append(("Muse", muse_python))
    for label, executable in environments:
        if not executable.is_file():
            raise SystemExit(f"{label} Python environment is missing. See MEDIA-BRIDGE.md for setup.")
    flow_env = dotenv(old_flow / ".env", "FLOWBOARD_")
    base_env = os.environ.copy()
    flow_env = {**flow_env, **base_env}
    # The original Flow UI can pin a project in SQLite, overriding its .env.
    # Read just that non-secret setting; do not migrate old requests or assets.
    old_db = Path(flow_env.get("FLOWBOARD_DB", old_flow / "storage/flowboard.db"))
    if old_db.is_file() and "FLOWBOARD_FLOW_PROJECT_ID" not in base_env:
        try:
            with sqlite3.connect(old_db.resolve().as_uri() + "?mode=ro", uri=True) as connection:
                row = connection.execute("SELECT value FROM appsetting WHERE key = ?", ("flow_project_id",)).fetchone()
                if row and isinstance(row[0], str) and row[0].strip():
                    flow_env["FLOWBOARD_FLOW_PROJECT_ID"] = row[0].strip()
        except sqlite3.Error:
            pass  # An older source database may not have the optional settings table.
    # These directories contain only the new bridge's jobs, outputs and runtime.
    flow_env.update({
        "PYTHONPATH": str(ROOT / "vendor/flowboard/agent"),
        "FLOWBOARD_STORAGE": str(DATA / "flow"),
        "FLOWBOARD_DB": str(DATA / "flow/flowboard.db"),
        "FLOWBOARD_SECRETS_PATH": str(DATA / "flow/settings.json"),
        "FLOWBOARD_WS_HOST": "127.0.0.1", "FLOWBOARD_EXT_WS_PORT": "8355",
        "FLOWBOARD_MEDIA_PROVIDER": "flow", "FLOWBOARD_MUSE2API_BASE": "",
        "FLOWBOARD_MUSE2API_KEY": "",
    })
    services = [("flow", flow_python, flow_env, 8434, "/api/health")]
    if not args.with_muse:
        return services
    muse_env = {**dotenv(old_muse / ".env", "MUSE2API_"), **base_env}
    # A new local service key is generated in its own private data directory.
    for key in list(muse_env):
        if key.startswith(("MUSE2API_PAYPAL_", "MUSE2API_GOOGLE_")) or key in {
            "MUSE2API_API_KEY", "MUSE2API_ADMIN_KEY", "MUSE2API_PUBLIC_BASE",
        }:
            muse_env.pop(key, None)
    accounts = args.muse_accounts or old_muse / "data/accounts.json"
    if not accounts.is_file():
        raise SystemExit("Muse private accounts file is missing; set --muse-accounts. No sessions were copied.")
    muse_env.update({
        "PYTHONPATH": str(ROOT / "vendor/muse2api/src"),
        "MUSE2API_DRIVER": "browser", "MUSE2API_HOST": "127.0.0.1",
        "MUSE2API_PORT": "18610", "MUSE2API_DATA_DIR": str(DATA / "muse"),
        "MUSE2API_BROWSER_PROFILE_DIR": str(DATA / "muse/browser-profile"),
        "TAPNOW_MUSE_DATA": str(DATA / "muse"),
        "TAPNOW_MUSE_ACCOUNTS_FILE": str(accounts.resolve()),
    })
    services.append(("muse", muse_python, muse_env, 18610, "/readyz"))
    return services


def main() -> None:
    default_sources = ROOT / "data/private"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flow-source", type=Path, default=default_sources / "flow")
    parser.add_argument("--muse-source", type=Path, default=default_sources / "muse")
    parser.add_argument("--flow-python", type=Path)
    parser.add_argument("--muse-python", type=Path)
    parser.add_argument("--muse-accounts", type=Path)
    providers = parser.add_mutually_exclusive_group()
    providers.add_argument("--flow-only", dest="with_muse", action="store_false", help="Only start Flow and remember Muse as paused")
    providers.add_argument("--with-muse", action="store_true", help="Explicitly re-enable the Muse service")
    parser.set_defaults(with_muse=None)
    parser.add_argument("--canvas-port", type=int, default=4317)
    parser.add_argument("--canvas-startup-timeout", type=float, default=120)
    parser.add_argument("--check", action="store_true", help="Check imports/configuration; do not launch services or Chrome")
    args = parser.parse_args()
    args.with_muse = muse_enabled(args.with_muse, ROOT / "data/media-bridge.json")
    os.umask(0o077)
    services = prepare(args)
    for name, python, env, _, _ in services:
        imports = "import fastapi,uvicorn,httpx,websockets; import " + ("sqlmodel,multipart" if name == "flow" else "pydantic_settings,multipart,socksio")
        result = subprocess.run([str(python), "-c", imports], env=env, capture_output=True)
        if result.returncode:
            raise SystemExit(f"{name}: Python dependencies unavailable. See MEDIA-BRIDGE.md; no credential values printed.")
    if args.check:
        print("Configuration and dependency checks passed; no services, browser or generation started.")
        return

    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    key_file = DATA / "muse/api_key"
    children, files = [], []
    runtime = ROOT / "scripts/media_bridge_runtime.py"
    watch = CanvasWatch(time.monotonic(), startup_timeout=max(1, args.canvas_startup_timeout))
    watch.observe(health(args.canvas_port, "/api/lifecycle"), time.monotonic())

    def cleanup(*_):
        stop_owned_processes(children)
        owner_path = DATA / "owned-processes.json"
        try:
            if json.loads(owner_path.read_text()).get("launcherPid") == os.getpid():
                owner_path.unlink()
        except (OSError, ValueError):
            pass
        for file in files:
            file.close()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, lambda *_: sys.exit(0))
    try:
        for name, python, env, port, path in services:
            if not port_free(port):
                state = health(port, path)
                ours = (ROOT / "data/media-bridge.json").exists() and (name == "flow" or key_file.exists())
                compatible = bool(state) and state.get("_tapnow_bridge") and (state.get("ok") if name == "flow" else state.get("driver", {}).get("driver") == "browser")
                if ours and compatible:
                    print(f"{name}: existing local service on {port}; leaving it running.")
                    continue
                raise SystemExit(f"Port {port} is already occupied. Stop the old provider launcher first; no process was killed.")
            if name == "flow" and not port_free(8355):
                raise SystemExit("Port 8355 is occupied; stop the old Flowboard launcher first.")
            (DATA / name).mkdir(parents=True, exist_ok=True, mode=0o700)
            output = open(DATA / f"{name}.log", "ab", buffering=0)
            files.append(output)
            child = subprocess.Popen([str(python), str(runtime), name], cwd=ROOT,
                                     env=env, stdout=output, stderr=subprocess.STDOUT,
                                     start_new_session=True)
            children.append(child)
            private_write(DATA / "owned-processes.json", json.dumps({
                "launcherPid": os.getpid(), "canvasInstanceId": watch.instance_id,
                "children": [{"pid": process.pid, "pgid": process.pid} for process in children],
            }, indent=2) + "\n")
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise SystemExit(f"{name} exited. Inspect data/media-bridge/{name}.log locally.")
                state = health(port, path)
                if state:
                    break
                time.sleep(0.5)
            else:
                raise SystemExit(f"{name} did not start within 60 seconds. Inspect its private runtime log.")
            if name == "flow":
                print(f"Flow bridge ready on {port}; extension connected: {bool(state.get('extension_connected'))}.")
            else:
                print(f"Muse bridge ready on {port}; local driver ready: {bool(state.get('ready'))}. Upstream access is not verified by this check.")
        if args.with_muse and not key_file.is_file():
            raise SystemExit("Muse did not create a private API-key file; provider configuration was not published.")
        config = {"flowEnabled": True, "museEnabled": args.with_muse, "musePaused": not args.with_muse}
        if args.with_muse:
            config["museKeyFile"] = str(key_file.relative_to(ROOT / "data"))
        private_write(ROOT / "data/media-bridge.json", json.dumps(config, indent=2) + "\n")
        print(f"Media providers configured; Muse {'enabled' if args.with_muse else 'paused'}. Following canvas backend on {args.canvas_port}.")
        print("Closing the canvas lets Node finish active jobs before exiting; this launcher then closes only its own processes.")
        if not children:
            return
        while all(child.poll() is None for child in children):
            reason = watch.observe(health(args.canvas_port, "/api/lifecycle"), time.monotonic())
            if reason:
                print(reason)
                return
            time.sleep(1)
        raise SystemExit("A media provider exited; its private log contains diagnostics.")
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
