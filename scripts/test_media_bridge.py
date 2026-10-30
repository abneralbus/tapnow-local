"""Offline contract checks: never starts Chromium or submits upstream work."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


runtime = module("bridge_runtime_test", "media_bridge_runtime.py")
launcher = module("bridge_launcher_test", "start-media-bridge.py")


class BoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, provider, path, method="GET", origin=None, host="127.0.0.1:8434"):
        messages = []

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        headers = [(b"host", host.encode())]
        if origin is not None:
            headers.append((b"origin", origin.encode()))
        await runtime.LocalBridgeBoundary(app, provider)(
            {"type": "http", "path": path, "method": method, "headers": headers}, receive, send)
        return messages[0]

    async def test_media_contract_and_marker(self):
        for provider, method, path in [
            ("flow", "GET", "/api/health"), ("flow", "POST", "/api/requests"),
            ("flow", "POST", "/api/upload"), ("flow", "GET", "/media/example-id"),
            ("muse", "POST", "/v1/images/generations"), ("muse", "POST", "/v1/videos"),
            ("muse", "GET", "/v1/media/vid-example.mp4"),
        ]:
            response = await self.request(provider, path, method)
            self.assertEqual(response["status"], 200)
            self.assertIn((b"x-tapnow-media-bridge", b"1"), response["headers"])

    async def test_admin_cross_origin_and_host_rejected(self):
        for provider, path, origin, host in [
            ("flow", "/api/llm/providers", None, "127.0.0.1"),
            ("muse", "/admin/accounts", None, "127.0.0.1"),
            ("flow", "/api/requests", "https://example.com", "127.0.0.1"),
            ("flow", "/api/health", None, "evil.example"),
            ("flow", "/api/health", "null", "localhost"),
        ]:
            response = await self.request(provider, path, origin=origin, host=host)
            self.assertEqual(response["status"], 403)

    async def test_extension_callback_only(self):
        origin = "chrome-extension://test-extension"
        self.assertEqual((await self.request("flow", "/api/ext/callback", "POST", origin))["status"], 200)
        self.assertEqual((await self.request("flow", "/api/requests", "POST", origin))["status"], 403)


class ConfigurationTests(unittest.TestCase):
    def test_muse_resume_is_remembered_but_explicit_pause_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "bridge.json"
            self.assertFalse(launcher.muse_enabled(None, config))
            self.assertTrue(launcher.muse_enabled(True, config))
            config.write_text(json.dumps({"museEnabled": True, "musePaused": False}))
            self.assertTrue(launcher.muse_enabled(None, config))
            self.assertFalse(launcher.muse_enabled(False, config))
            for state in [{"museEnabled": True, "musePaused": True}, {}, [], None]:
                config.write_text(json.dumps(state))
                self.assertFalse(launcher.muse_enabled(None, config))
            config.write_text("broken json")
            self.assertFalse(launcher.muse_enabled(None, config))

    def test_flow_only_ignores_missing_muse_environment_and_accounts(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "flow"
            source.mkdir()
            args = SimpleNamespace(flow_source=source, muse_source=Path(folder) / "missing-muse",
                                   flow_python=Path(sys.executable), muse_python=None,
                                   muse_accounts=None, with_muse=False)
            services = launcher.prepare(args)
            self.assertEqual([service[0] for service in services], ["flow"])
            self.assertNotIn("TAPNOW_MUSE_ACCOUNTS_FILE", services[0][2])

    def test_dotenv_is_data_and_prefix_limited(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("OTHER_SECRET=hidden\nexport MUSE2API_DRIVER='browser'\nMUSE2API_LITERAL=$(do-not-execute)\n")
            self.assertEqual(launcher.dotenv(path, "MUSE2API_"), {
                "MUSE2API_DRIVER": "browser", "MUSE2API_LITERAL": "$(do-not-execute)",
            })

    def test_private_runtime_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private/config.json"
            launcher.private_write(path, json.dumps({"museKeyFile": "/private/path/api_key"}))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(set(json.loads(path.read_text())), {"museKeyFile"})


class LifecycleTests(unittest.TestCase):
    def test_waits_for_first_canvas_and_times_out_without_one(self):
        watch = launcher.CanvasWatch(10, startup_timeout=120)
        self.assertIsNone(watch.observe(None, 129))
        self.assertIsNotNone(watch.observe({"app": "unrelated", "instanceId": "x"}, 130))

    def test_transient_disconnect_does_not_stop_services(self):
        watch = launcher.CanvasWatch(0)
        state = {"app": "tapnow-local", "instanceId": "first", "activeJobs": 1}
        self.assertIsNone(watch.observe(state, 1))
        self.assertIsNone(watch.observe(None, 2))
        self.assertIsNone(watch.observe(state, 6))
        self.assertIsNone(watch.observe(None, 10))
        self.assertIsNone(watch.observe(None, 14.9))
        self.assertIsNotNone(watch.observe(None, 15))

    def test_replacement_instance_does_not_take_over_old_processes(self):
        watch = launcher.CanvasWatch(0)
        watch.observe({"app": "tapnow-local", "instanceId": "first"}, 1)
        self.assertIsNone(watch.observe({"app": "tapnow-local", "instanceId": "second"}, 2))
        self.assertIsNotNone(watch.observe({"app": "tapnow-local", "instanceId": "second"}, 7))

    @unittest.skipUnless(os.name == "posix", "Process-group ownership is POSIX-specific")
    def test_cleanup_only_terminates_owned_group(self):
        # Harmless Python sleepers stand in for the provider and its browser.
        # A separate session represents a user's unrelated application.
        sleeper = "import time; time.sleep(60)"
        unrelated = subprocess.Popen([sys.executable, "-c", sleeper], start_new_session=True)
        code = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c',sys.argv[1]]); print(p.pid,flush=True); time.sleep(60)"
        owned = subprocess.Popen([sys.executable, "-c", code, sleeper], start_new_session=True,
                                 stdout=subprocess.PIPE, text=True)
        try:
            grandchild = int(owned.stdout.readline().strip())
            self.assertEqual(os.getpgid(grandchild), owned.pid)
            launcher.stop_owned_processes([owned])
            self.assertIsNotNone(owned.poll())
            self.assertIsNone(unrelated.poll())
            # The grandchild inherits this pipe and keeps it open while alive.
            # EOF proves its descriptors closed without inspecting user processes.
            readable, _, _ = select.select([owned.stdout], [], [], 2)
            self.assertTrue(readable)
            self.assertEqual(owned.stdout.read(), "")
        finally:
            owned.stdout.close()
            for process in [owned, unrelated]:
                if process.poll() is None:
                    os.killpg(process.pid, 9)
                process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
