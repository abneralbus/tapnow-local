from muse2api.upstream.muse import missing_session_cookies


def test_current_verified_session_does_not_require_legacy_gateway_cookie():
    cookies = {
        'hatch_sess': 'session',
        'hatch_vml': 'workspace',
        'hatch_native_auth_device': 'device',
    }
    assert missing_session_cookies(cookies) == []
    assert missing_session_cookies({**cookies, 'hatch_gw': 'legacy'}) == []
    for name in cookies:
        assert name in missing_session_cookies({**cookies, name: ''})
