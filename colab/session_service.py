"""Authenticated H3 uploads and download receipts; release is executed by the notebook."""
import asyncio
from contextlib import asynccontextmanager, suppress
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import time
import uuid

ASSET = re.compile(r'[A-Za-z0-9_-]{1,100}\.(png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|ogg|m4a)')
JOB = re.compile(r'[A-Za-z0-9_-]{1,100}')


class Session:
    def __init__(self, root, variant, auto_release=False, idle_seconds=60, profile='standard'):
        if profile not in ('standard', 'ref2va-turbo-4step') or (profile != 'standard' and variant != 'ref2va'):
            raise ValueError('Unsupported model profile')
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.assets = self.root/'assets'
        self.assets.mkdir(exist_ok=True)
        self.file = self.root/'session.json'
        self.active = 0
        self.idle_seconds = max(30, idle_seconds)
        if self.file.exists():
            self.data = json.loads(self.file.read_text())
            if self.data['variant'] != variant or self.data.get('profile', 'standard') != profile:
                raise RuntimeError('Finish and release the previous session before changing model mode')
        else:
            self.data = dict(id=uuid.uuid4().hex, variant=variant, profile=profile, autoRelease=auto_release,
                             phase='ready', jobs={}, lastActivity=time.time())
            self.save()

    def save(self):
        temp = self.file.with_suffix('.tmp')
        temp.write_text(json.dumps(self.data))
        temp.replace(self.file)

    def touch(self):
        self.data['lastActivity'] = time.time()
        self.save()

    def blocked(self):
        return self.active or any(not j.get('acknowledged') and j['status'] != 'failed'
                                  for j in self.data['jobs'].values())

    def release(self, automatic=False):
        if self.data['phase'] != 'ready' or self.blocked():
            return False
        if automatic and (not self.data['autoRelease'] or not self.data['jobs'] or
                          time.time()-self.data['lastActivity'] < self.idle_seconds):
            return False
        self.data['phase'] = 'release_requested'
        self.save()
        return True

    def status(self):
        jobs = self.data['jobs'].values()
        return dict(profile=self.data.get('profile', 'standard'), sessionId=self.data['id'], variant=self.data['variant'], phase=self.data['phase'],
                    tasks=['ref2va'] if self.data['variant']=='ref2va' else ['t2va', 'fl2va'],
                    autoRelease=self.data['autoRelease'], idleSeconds=self.idle_seconds,
                    pendingResults=sum(not j.get('acknowledged') and j['status']!='failed' for j in jobs),
                    canRelease=not bool(self.blocked()) and self.data['phase']=='ready',
                    releaseError=json.loads((self.root/'release-error.json').read_text()).get('error') if (self.root/'release-error.json').exists() else None)


def create_app(root='/content/tapnow-h3-state', variant=None, token=None, transport=None, profile=None):
    import httpx
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, StreamingResponse
    token = token or os.environ.get('H3_PROXY_TOKEN', '')
    if len(token) < 32:
        raise RuntimeError('H3_PROXY_TOKEN must contain at least 32 characters')
    variant = variant or os.environ.get('H3_VARIANT', 'fl2va')
    if variant not in ('fl2va', 'ref2va'):
        raise RuntimeError('Unsupported model variant')
    state = Session(root, variant, os.environ.get('H3_AUTO_RELEASE')=='yes',
                    int(os.environ.get('H3_IDLE_SECONDS', '60')),
                    profile=profile or os.environ.get('H3_PROFILE', 'standard'))

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(base_url='http://127.0.0.1:30020', timeout=60,
                                    trust_env=False, transport=transport) as client:
            app.state.upstream = client
            async def idle_watch():
                while True:
                    await asyncio.sleep(5)
                    state.release(automatic=True)
            watcher = asyncio.create_task(idle_watch())
            try:
                yield
            finally:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.session = state

    @app.middleware('http')
    async def authenticate(request, call_next):
        if not hmac.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer '+token).encode()):
            return JSONResponse({'error': 'Unauthorized'}, 401)
        return await call_next(request)

    @app.get('/v1/session')
    async def session_status():
        return state.status()

    @app.post('/v1/session/settings')
    async def settings(request: Request):
        body = await request.json()
        if state.data['phase'] != 'ready':
            return JSONResponse({'error': 'Session is already releasing'}, 409)
        if not isinstance(body.get('autoRelease'), bool):
            return JSONResponse({'error': 'autoRelease must be true or false'}, 400)
        state.data['autoRelease'] = body['autoRelease']
        state.touch()
        return state.status()

    @app.post('/v1/session/release')
    async def release():
        if not state.release():
            return JSONResponse({'error': 'Still generating, transferring, or awaiting saved-result receipts'}, 409)
        return {'phase': 'release_requested'}

    @app.post('/v1/assets/{name}')
    async def upload(name: str, request: Request):
        if state.data['phase'] != 'ready':
            return JSONResponse({'error': 'Colab is releasing its GPU; start a new session'}, 409)
        if not ASSET.fullmatch(name):
            return JSONResponse({'error': 'Invalid asset name'}, 400)
        state.active += 1
        state.touch()
        # New generated names prevent concurrent uploads from replacing a referenced asset.
        target = state.assets/(uuid.uuid4().hex+Path(name).suffix)
        temp = target.with_suffix(target.suffix+'.part')
        size = 0
        try:
            if sum(p.stat().st_size for p in state.assets.iterdir()) > 2*1024**3:
                return JSONResponse({'error': 'Session input storage is full'}, 413)
            with temp.open('wb') as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 100*1024**2:
                        return JSONResponse({'error': 'Reference exceeds 100 MiB'}, 413)
                    output.write(chunk)
            if not size:
                return JSONResponse({'error': 'Empty reference'}, 400)
            temp.replace(target)
            return {'assetId': target.name, 'bytes': size}
        finally:
            temp.unlink(missing_ok=True)
            state.active -= 1
            state.touch()

    @app.post('/v1/videos/{job_id}/receipt')
    async def receipt(job_id: str, request: Request):
        body = await request.json()
        job = state.data['jobs'].get(job_id)
        if not job or job['status'] != 'completed' or not job.get('download'):
            return JSONResponse({'error': 'No complete downloaded result'}, 409)
        if body.get('sessionId') != state.data['id'] or body.get('bytes') != job['download']['bytes'] or body.get('sha256') != job['download']['sha256']:
            return JSONResponse({'error': 'Saved-file checksum does not match downloaded result'}, 409)
        job['acknowledged'] = True
        state.touch()
        return {'saved': True}

    @app.api_route('/{route:path}', methods=['GET', 'POST'])
    async def proxy(route: str, request: Request):
        path = '/'+route
        match = re.fullmatch(r'/v1/videos/([A-Za-z0-9_-]{1,100})(/content)?', path)
        submit = request.method=='POST' and path=='/v1/videos'
        if not (submit or request.method=='GET' and (path in ('/health', '/v1/models') or match)):
            return JSONResponse({'error': 'Route not exposed'}, 404)
        if match and match[1] not in state.data['jobs']:
            return JSONResponse({'error': 'Job does not belong to this session'}, 404)
        if submit and state.data['phase'] != 'ready':
            return JSONResponse({'error': 'Colab is releasing its GPU'}, 409)
        state.active += 1
        state.touch() if submit else None
        body = bytearray()
        provisional = None
        streaming = False
        try:
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 1024**2:
                    return JSONResponse({'error': 'Request too large'}, 413)
            if submit:
                value = json.loads(body)
                if value.get('task') not in state.status()['tasks']:
                    return JSONResponse({'error': 'Model mode mismatch; select the matching mode in Colab'}, 409)
                if state.data.get('profile') == 'ref2va-turbo-4step':
                    if value.get('target', {}).get('short_edge') != 544:
                        return JSONResponse({'error': 'Ref2VA Turbo currently requires 544p'}, 400)
                    if value.get('num_inference_steps') != 4:
                        return JSONResponse({'error': 'Ref2VA Turbo requires 4 inference steps'}, 400)
                    value.update(reference_resize_mode='match', flow_shift=12,
                                 audio_flow_shift=3, quality='lossless')
                conditions = value.get('conditions', [])
                if not isinstance(conditions, list) or len(conditions)>12:
                    return JSONResponse({'error': 'Invalid conditions'}, 400)
                for condition in conditions:
                    asset = condition.pop('assetId', '')
                    if not ASSET.fullmatch(asset) or not (state.assets/asset).is_file() or 'uri' in condition:
                        return JSONResponse({'error': 'Upload reference assets before submitting'}, 400)
                    condition['uri'] = (state.assets/asset).resolve().as_uri()
                body = json.dumps(value).encode()
                provisional = 'pending_'+uuid.uuid4().hex
                state.data['jobs'][provisional] = {'status': 'submitting'}
                state.save()
            upstream = await app.state.upstream.send(app.state.upstream.build_request(
                request.method, path, content=bytes(body), headers={'Content-Type':'application/json', 'Accept-Encoding':'identity'}), stream=True)
            if match and match[2] and upstream.is_success:
                streaming = True
                async def stream():
                    digest = hashlib.sha256()
                    size = 0
                    try:
                        async for chunk in upstream.aiter_raw():
                            digest.update(chunk)
                            size += len(chunk)
                            yield chunk
                        length = upstream.headers.get('content-length')
                        if size >= 12 and (length is None or size == int(length)):
                            state.data['jobs'][match[1]]['download'] = {'bytes':size, 'sha256':digest.hexdigest()}
                            state.save()
                    finally:
                        await upstream.aclose()
                        state.active -= 1
                        state.touch()
                return StreamingResponse(stream(), status_code=upstream.status_code,
                                         headers={k:v for k,v in upstream.headers.items() if k in ('content-type','content-length')})
            raw = await upstream.aread()
            await upstream.aclose()
            try:
                result = json.loads(raw)
            except ValueError:
                return JSONResponse({'error':'Invalid upstream response'}, 502)
            if submit:
                if upstream.is_success and JOB.fullmatch(str(result.get('id',''))):
                    state.data['jobs'][result['id']] = {'status':result.get('status','queued')}
                    del state.data['jobs'][provisional]
                elif 400 <= upstream.status_code < 500:
                    state.data['jobs'][provisional]['status'] = 'failed'
                state.save()  # Ambiguous submission stays blocked; never release that GPU automatically.
            elif match and upstream.is_success and result.get('status') in ('queued','in_progress','completed','failed'):
                state.data['jobs'][match[1]]['status'] = result['status']
                state.save()
            return JSONResponse(result, upstream.status_code)
        except (ValueError, TypeError, AttributeError):
            return JSONResponse({'error':'Invalid generation request or response'}, 400)
        except httpx.HTTPError:
            return JSONResponse({'error':'Model service unavailable; submission may be unresolved'}, 503)
        finally:
            if not streaming:
                state.active -= 1
                if submit:
                    state.touch()
    return app


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(create_app(), host='127.0.0.1', port=30011, access_log=False)
