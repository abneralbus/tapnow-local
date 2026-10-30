"""Lifecycle regression tests; no real browser, network or paid generation."""
from types import SimpleNamespace

import pytest

from muse2api.accounts import Account
from muse2api.config import Settings
from muse2api.drivers.browser.chromium import ChromiumProcess
from muse2api.drivers.browser.driver import BrowserDriver
from muse2api.errors import UpstreamError


class FakeProcess:
    returncode = None
    terminated = False

    def terminate(self):
        self.terminated = True
        self.returncode = -15

    async def wait(self):
        return self.returncode


async def test_owned_chromium_has_no_startup_page(monkeypatch, tmp_path):
    browser = ChromiumProcess("test-chrome", 19210, tmp_path, headless=False)
    answers = iter([None, "ws://test-browser"])
    args = []
    proc = FakeProcess()

    async def discover():
        return next(answers)

    async def spawn(*values, **kwargs):
        args.extend(values)
        return proc

    monkeypatch.setattr(browser, "browser_ws_url", discover)
    monkeypatch.setattr("muse2api.drivers.browser.chromium.asyncio.create_subprocess_exec", spawn)
    assert await browser.start() == "ws://test-browser"
    assert "--no-startup-window" in args
    assert "about:blank" not in args
    await browser.stop()
    assert proc.terminated


async def test_attached_browser_is_never_terminated(monkeypatch, tmp_path):
    browser = ChromiumProcess("test-chrome", 19210, tmp_path)

    async def discover():
        return "ws://existing-browser"

    monkeypatch.setattr(browser, "browser_ws_url", discover)
    assert await browser.start() == "ws://existing-browser"
    assert browser.proc is None
    await browser.stop()


class FakeBrowser:
    closed = False

    def __init__(self):
        self.calls = []

    async def send(self, method, params=None):
        self.calls.append((method, params))
        if method == "Target.getTargets":
            return {"targetInfos": [
                {"targetId": "startup", "type": "page", "url": "about:blank"},
                {"targetId": "task", "type": "page", "url": "about:blank", "browserContextId": "account"},
                {"targetId": "flow", "type": "page", "url": "https://flow.google.com/"},
            ]}
        if method == "Target.createTarget":
            return {"targetId": "new-task"}
        return {}


async def test_startup_cleanup_only_closes_owned_default_context_blank(tmp_path):
    driver = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path))
    driver._chromium = SimpleNamespace(proc=object())
    driver._browser = FakeBrowser()
    await driver._close_startup_blanks()
    assert ("Target.closeTarget", {"targetId": "startup"}) in driver._browser.calls
    assert sum(method == "Target.closeTarget" for method, _ in driver._browser.calls) == 1


async def test_startup_cleanup_does_not_inspect_attached_browser(tmp_path):
    driver = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path))
    driver._chromium = SimpleNamespace(proc=None)
    driver._browser = FakeBrowser()
    await driver._close_startup_blanks()
    assert driver._browser.calls == []


async def test_failed_page_connection_closes_its_new_blank_target(tmp_path, monkeypatch):
    driver = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path))
    driver._chromium = SimpleNamespace(proc=object(), port=19210)
    driver._browser = FakeBrowser()

    async def context(account):
        return "account"

    async def connect(url):
        raise OSError("page connection failed")

    monkeypatch.setattr(driver, "_context", context)
    monkeypatch.setattr("muse2api.drivers.browser.driver.muse.missing_session_cookies", lambda cookies: [])
    monkeypatch.setattr("muse2api.drivers.browser.driver.CDPSession.connect", connect)
    with pytest.raises(UpstreamError):
        await driver._open_tab(Account(id="test-account", cookies={}))
    assert ("Target.closeTarget", {"targetId": "new-task"}) in driver._browser.calls
    target_params = next(params for method, params in driver._browser.calls if method == "Target.createTarget")
    assert target_params["background"] is True
