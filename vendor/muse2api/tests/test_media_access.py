from unittest.mock import AsyncMock

import pytest

from muse2api.accounts.model import Account
from muse2api.config import Settings
from muse2api.drivers.base import SessionInfo
from muse2api.drivers.browser.driver import BrowserDriver
from muse2api.errors import UpstreamRefused


@pytest.mark.parametrize('kind', ['image', 'video'])
async def test_unavailable_workspace_never_submits_generation(tmp_path, monkeypatch, kind):
    driver = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path))
    renew = AsyncMock(return_value=SessionInfo(ok=False, cookies={'hatch_sess': 'rotated'},
                                             meta={'session_status': 'unavailable'}))
    checkout = AsyncMock()
    monkeypatch.setattr(driver, 'renew_session', renew)
    monkeypatch.setattr(driver, '_checkout', checkout)
    account = Account(cookies={'hatch_sess': 'old'})
    with pytest.raises(UpstreamRefused) as error:
        await driver._generate(account, 'fox', [], kind, 240, None, None)
    assert error.value.code == 'upstream_access_unavailable'
    assert error.value.retryable is False
    checkout.assert_not_awaited()
    renew.assert_awaited_once_with(account, wake_vm=False)
    assert account.cookies['hatch_sess'] == 'rotated'


async def test_assigned_workspace_keeps_normal_generation_and_tab_cleanup(tmp_path, monkeypatch):
    driver = BrowserDriver(Settings(_env_file=None, data_dir=tmp_path))
    monkeypatch.setattr(driver, 'renew_session', AsyncMock(return_value=SessionInfo(ok=True)))
    tab, result = object(), object()
    monkeypatch.setattr(driver, '_checkout', AsyncMock(return_value=tab))
    monkeypatch.setattr(driver, '_prepare', AsyncMock(return_value={}))
    monkeypatch.setattr(driver, '_wait_media', AsyncMock(return_value={}))
    monkeypatch.setattr(driver, '_download', AsyncMock(return_value=result))
    checkin = AsyncMock()
    monkeypatch.setattr(driver, '_checkin', checkin)
    assert await driver._generate(Account(), 'fox', [], 'image', 240, None, None) is result
    checkin.assert_awaited_once_with(tab)
