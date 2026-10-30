"""Expose only authenticated generation routes; keep SGLang management private."""
import hmac
import os
import re


def allowed_route(method, path):
    return (method == 'GET' and path in ('/health', '/v1/models')) or (
        method == 'POST' and path == '/v1/videos'
    ) or (method == 'GET' and re.fullmatch(r'/v1/videos/[A-Za-z0-9_-]{1,100}(?:/content)?', path) is not None)


def authorized(header, token):
    return bool(token) and hmac.compare_digest(header.encode(), ('Bearer ' + token).encode())


def create_app():
    import httpx
    from contextlib import asynccontextmanager
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, StreamingResponse

    token = os.environ.get('H3_PROXY_TOKEN', '')
    if len(token) < 32:
        raise RuntimeError('Set H3_PROXY_TOKEN to a random token of at least 32 characters')

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(base_url='http://127.0.0.1:30020', timeout=60, trust_env=False) as client:
            app.state.upstream = client
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route('/{route:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
    async def proxy(route: str, request: Request):
        if not authorized(request.headers.get('authorization', ''), token):
            return JSONResponse({'error': 'Unauthorized'}, status_code=401)
        path = '/' + route
        if not allowed_route(request.method, path):
            return JSONResponse({'error': 'Route not exposed'}, status_code=404)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 1024 * 1024:
                return JSONResponse({'error': 'Request too large'}, status_code=413)
        try:
            upstream_request = request.app.state.upstream.build_request(
                request.method, path, content=bytes(body),
                headers={'Content-Type': request.headers.get('content-type', 'application/json'),
                         'Accept-Encoding': 'identity'},
            )
            upstream = await request.app.state.upstream.send(upstream_request, stream=True)
        except httpx.HTTPError:
            return JSONResponse({'error': 'Model service unavailable'}, status_code=503)
        headers = {key: value for key, value in upstream.headers.items()
                   if key in ('content-type', 'content-length', 'content-disposition', 'content-encoding')}
        async def stream():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
        return StreamingResponse(stream(), status_code=upstream.status_code, headers=headers)

    return app


if __name__ == '__main__':
    import sys
    if '--self-test' in sys.argv:
        assert allowed_route('GET', '/v1/videos/video_123/content')
        assert allowed_route('POST', '/v1/videos')
        for method, path in [('DELETE', '/v1/videos/x'), ('GET', '/server_info'),
                             ('GET', '/v1/videos/../../server_info'), ('POST', '/update_weights')]:
            assert not allowed_route(method, path)
        assert authorized('Bearer ' + 'x' * 32, 'x' * 32)
        assert not authorized('Bearer wrong', 'x' * 32)
        assert not authorized('Bearer ', '')
        print('proxy policy checks passed')
    else:
        import uvicorn
        uvicorn.run(create_app(), host='127.0.0.1', port=30011, access_log=False)
