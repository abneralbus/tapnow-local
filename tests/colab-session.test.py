import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import httpx
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'colab'))
from session_service import create_app, Session

TOKEN='test-token-'+'x'*32
HEADERS={'Authorization':'Bearer '+TOKEN}
VIDEO=b'\x00\x00\x00\x18ftypisom'+b'0'*128
class Bytes(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield VIDEO[:12]
        yield VIDEO[12:]

class Gateway(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.requests=[]
        self.fail_submit=False
        self.terminal='completed'
        async def upstream(request):
            if request.url.path=='/v1/videos':
                self.requests.append(json.loads(request.content))
                if self.fail_submit: raise httpx.ReadTimeout('unknown',request=request)
                return httpx.Response(200,json={'id':'video_1','status':'queued'})
            if request.url.path.endswith('/content'):
                return httpx.Response(200,headers={'Content-Type':'video/mp4','Content-Length':str(len(VIDEO))},stream=Bytes())
            return httpx.Response(200,json={'id':'video_1','status':self.terminal})
        self.app=create_app(self.tmp.name,variant='ref2va',token=TOKEN,transport=httpx.MockTransport(upstream))
        self.client=TestClient(self.app,headers=HEADERS)
        self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.tmp.cleanup()
    def submit(self):
        asset=self.client.post('/v1/assets/input.png',content=b'image').json()['assetId']
        return self.client.post('/v1/videos',json={'task':'ref2va','conditions':[{'assetId':asset,'type':'image','role':'reference'}]})
    def test_upload_condition_and_receipt_gate(self):
        self.assertEqual(self.submit().status_code,200)
        self.assertTrue(self.requests[0]['conditions'][0]['uri'].startswith('file://'))
        self.assertNotIn('assetId',self.requests[0]['conditions'][0])
        self.assertEqual(self.client.post('/v1/session/release').status_code,409)
        self.client.get('/v1/videos/video_1')
        self.assertEqual(self.client.get('/v1/videos/video_1/content').content,VIDEO)
        self.assertEqual(self.client.post('/v1/session/release').status_code,409)
        state=self.app.state.session
        receipt={'sessionId':state.data['id'],'bytes':len(VIDEO),'sha256':hashlib.sha256(VIDEO).hexdigest()}
        self.assertEqual(self.client.post('/v1/videos/video_1/receipt',json={**receipt,'bytes':1}).status_code,409)
        self.assertEqual(self.client.post('/v1/videos/video_1/receipt',json=receipt).status_code,200)
        state.data['autoRelease']=True;state.data['lastActivity']=0
        state.active=1;self.assertFalse(state.release(automatic=True))
        state.active=0;self.assertTrue(state.release(automatic=True))
        self.assertEqual(self.client.post('/v1/assets/input.png',content=b'x').status_code,409)
        self.assertEqual(self.client.post('/v1/videos',json={'task':'ref2va'}).status_code,409)
    def test_ambiguous_submission_and_restart_block_release(self):
        self.fail_submit=True
        self.assertEqual(self.submit().status_code,503)
        resumed=Session(self.tmp.name,'ref2va')
        self.assertTrue(resumed.blocked())
        self.assertFalse(resumed.release())
    def test_manual_default_and_auto_release_toggle(self):
        self.assertFalse(self.client.get('/v1/session').json()['autoRelease'])
        self.assertEqual(self.client.post('/v1/session/settings',json={'autoRelease':'yes'}).status_code,400)
        self.assertTrue(self.client.post('/v1/session/settings',json={'autoRelease':True}).json()['autoRelease'])
        self.assertFalse(self.app.state.session.release(automatic=True),'An unused session must not auto-release')

    def test_wrong_mode_external_uri_and_auth_rejected(self):
        self.assertEqual(self.client.get('/v1/session',headers={'Authorization':'bad'}).status_code,401)
        self.assertEqual(self.client.post('/v1/videos',json={'task':'t2va'}).status_code,409)
        self.assertEqual(self.client.post('/v1/videos',json={'task':'ref2va','conditions':[{'uri':'file:///etc/passwd'}]}).status_code,400)
        self.assertEqual(self.client.get('/server_info').status_code,404)
        self.assertEqual(self.client.get('/v1/videos/unknown').status_code,404)
        self.assertEqual(self.client.post('/v1/assets/input.png',content=b'').status_code,400)
    def test_reference_total_limit_rejects_before_upstream(self):
        response=self.client.post('/v1/videos',json={'task':'ref2va','conditions':[{}]*13})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.requests,[])
        self.assertFalse(self.app.state.session.blocked())

    def test_failed_jobs_can_release_but_unacknowledged_results_cannot(self):
        self.submit();self.terminal='failed';self.client.get('/v1/videos/video_1')
        self.assertEqual(self.client.post('/v1/session/release').status_code,200)

class Cache(unittest.TestCase):
    def test_partition_restore_is_offline_and_checks_integrity(self):
        import cache_model
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);drive=root/'drive';local=root/'local'
            (drive/'Ref2VA').mkdir(parents=True)
            payload=b'{}';(drive/'Ref2VA/model_index.json').write_bytes(payload)
            for name in ['model_index.json','LICENSE']:(drive/name).write_bytes(payload)
            (drive/'verified-manifest.json').write_text(json.dumps({'repo':cache_model.REPO,'revision':cache_model.REVISION,'complete':True,'partition':'Ref2VA','files':{'Ref2VA/model_index.json':{'size':2,'sha256':hashlib.sha256(payload).hexdigest()}}}))
            cache_model.restore_only(local,drive,'Ref2VA')
            self.assertEqual((local/'Ref2VA/model_index.json').read_bytes(),payload)
            with self.assertRaises(RuntimeError):cache_model.restore_only(local,drive,'FL2VA')
            (local/'Ref2VA/model_index.json').write_bytes(b'xx')
            (drive/'Ref2VA/model_index.json').write_bytes(b'xx')
            with self.assertRaises(ValueError):cache_model.restore_only(local,drive,'Ref2VA')

class ReleaseOrder(unittest.TestCase):
    def test_drive_flush_precedes_release_and_failure_does_not_release(self):
        from unittest.mock import Mock, patch
        from types import SimpleNamespace
        import notebook_session
        sequence=[]
        drive=SimpleNamespace(flush_and_unmount=Mock(side_effect=lambda:sequence.append('flush')))
        runtime=SimpleNamespace(unassign=Mock(side_effect=lambda:sequence.append('release')))
        with patch.dict(sys.modules,{'google.colab':SimpleNamespace(drive=drive,runtime=runtime)}):
            notebook_session.release_runtime()
            self.assertEqual(sequence,['flush','release'])
            runtime.unassign.reset_mock();drive.flush_and_unmount.side_effect=RuntimeError('flush failed')
            with self.assertRaises(RuntimeError):notebook_session.release_runtime()
            runtime.unassign.assert_not_called()

if __name__=='__main__':unittest.main()
