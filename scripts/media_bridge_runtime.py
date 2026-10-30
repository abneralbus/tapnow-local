"""Run vendored providers with isolated jobs/media and existing private accounts."""
from __future__ import annotations

import os
from pathlib import Path
import re
import sys

EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")


class LocalBridgeBoundary:
    """Only expose the local media contract, not upstream admin/account routes."""

    FLOW_ROUTES = (
        ("GET", r"/api/health"),
        ("GET", r"/api/auth/me"),
        ("GET", r"/api/flow/projects/pinned"),
        ("POST", r"/api/requests"),
        ("GET", r"/api/requests/[0-9]+"),
        ("POST", r"/api/requests/[0-9]+/cancel"),
        ("POST", r"/api/upload"),
        ("GET", r"/media/[^/]+"),
        ("GET", r"/api/media/[^/]+/status"),
        ("POST", r"/api/ext/callback"),
    )
    MUSE_ROUTES = (
        ("GET", r"/healthz"), ("GET", r"/readyz"),
        ("GET", r"/v1/models"), ("GET", r"/v1/models/[^/]+"),
        ("POST", r"/v1/images/generations"),
        ("GET", r"/v1/images/generations/[^/]+"),
        ("POST", r"/v1/images/edits"),
        ("POST", r"/v1/videos"), ("GET", r"/v1/videos/[^/]+"),
        ("GET", r"/v1/media/[^/]+"),
    )

    def __init__(self, app, provider: str):
        self.app = app
        self.routes = self.FLOW_ROUTES if provider == "flow" else self.MUSE_ROUTES

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        host = headers.get(b"host", b"").decode("latin1").lower()
        local_host = re.fullmatch(r"(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?", host)
        origin = headers.get(b"origin", b"").decode("latin1")
        path, method = scope.get("path", ""), scope.get("method", "")
        # The Node adapter sends no Origin. The extension callback is separately
        # authenticated by Flowboard's constant-time callback-secret check.
        extension_callback = path == "/api/ext/callback" and origin.startswith("chrome-extension://")
        allowed_origin = not origin or extension_callback
        allowed_route = any(method == verb and re.fullmatch(pattern, path) for verb, pattern in self.routes)
        if not local_host or not allowed_origin or not allowed_route:
            body = b'{"error":"local_media_bridge_route_not_allowed"}'
            await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json")]})
            return await send({"type": "http.response.body", "body": body})
        async def identified_send(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), (b"x-tapnow-media-bridge", b"1")]}
            await send(message)

        await self.app(scope, receive, identified_send)


def main() -> None:
    import uvicorn

    provider = sys.argv[1]
    if provider == "flow":
        import asyncio
        import websockets
        from flowboard import main as flow_main
        from flowboard.config import EXTENSION_WS_PORT, WS_HOST
        from flowboard.services import ws_server

        async def extension_socket():
            # Preserve the extension transport, but do not let an unrelated
            # website connect to loopback and receive its callback secret.
            async with websockets.serve(ws_server._handler, WS_HOST, EXTENSION_WS_PORT,
                                        origins=[EXTENSION_ORIGIN]):
                await asyncio.Future()

        flow_main.run_ws_server = extension_socket
        app = flow_main.app
        port = 8434
    elif provider == "muse":
        from muse2api.app import create_app
        from muse2api.config import Settings

        class BridgeSettings(Settings):
            @property
            def accounts_file(self) -> Path:
                # Keep the sole account store in its existing private location.
                # Cookie refreshes by the original driver continue to persist there.
                return Path(os.environ["TAPNOW_MUSE_ACCOUNTS_FILE"])

        settings = BridgeSettings(
            _env_file=None, driver="browser", host="127.0.0.1", port=18610,
            api_key="", admin_key="", public_base="http://127.0.0.1:18610",
            data_dir=Path(os.environ["TAPNOW_MUSE_DATA"]),
            keepalive_enabled=False,
        )
        app, port = create_app(settings), 18610
    else:
        raise SystemExit("Expected flow or muse")
    uvicorn.run(LocalBridgeBoundary(app, provider), host="127.0.0.1", port=port,
                log_level="info", access_log=False, timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
