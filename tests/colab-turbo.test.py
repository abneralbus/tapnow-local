import json
from pathlib import Path
import sys
import tempfile
import unittest
import httpx
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'colab'))
from session_service import create_app, Session

class Turbo(unittest.TestCase):
    def test_contract_and_release_gate(self):
        seen=[]
        async def upstream(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200,json={'id':'turbo_1','status':'queued'})
        with tempfile.TemporaryDirectory() as d:
            app=create_app(d,variant='ref2va',token='x'*32,profile='ref2va-turbo-4step',transport=httpx.MockTransport(upstream))
            with TestClient(app,headers={'Authorization':'Bearer '+'x'*32}) as c:
                self.assertEqual(c.get('/v1/session').json()['profile'],'ref2va-turbo-4step')
                body={'task':'ref2va','target':{'short_edge':768},'num_inference_steps':4,'conditions':[]}
                self.assertEqual(c.post('/v1/videos',json=body).status_code,400)
                body['target']['short_edge']=544;body['num_inference_steps']=50
                self.assertEqual(c.post('/v1/videos',json=body).status_code,400)
                self.assertEqual(seen,[])
                body['num_inference_steps']=4
                self.assertEqual(c.post('/v1/videos',json=body).status_code,200)
                self.assertEqual(seen[0]['reference_resize_mode'],'match')
                self.assertEqual(seen[0]['quality'],'lossless')
                self.assertEqual(c.post('/v1/session/release').status_code,409)
            with self.assertRaises(RuntimeError):Session(d,'ref2va',profile='standard')
    def test_reject_wrong_partition(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):Session(d,'fl2va',profile='ref2va-turbo-4step')

if __name__=='__main__':unittest.main()
