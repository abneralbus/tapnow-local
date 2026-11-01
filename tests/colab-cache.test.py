import hashlib,importlib.util,json,sys,tempfile,types
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cache_model',Path(__file__).resolve().parents[1]/'colab/cache_model.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);drive=root/'drive';local=root/'local';drive.mkdir()
 shared=b'existing encoder';fresh=b'new reference transformer';index=b'{}'
 sha=lambda x:hashlib.sha256(x).hexdigest()
 source=drive/'FL2VA/text_encoder/model.safetensors';source.parent.mkdir(parents=True);source.write_bytes(shared)
 prior={'repo':m.REPO,'revision':m.REVISION,'complete':True,'partition':'FL2VA','files':{'FL2VA/text_encoder/model.safetensors':{'size':len(shared),'sha256':sha(shared)}}}
 (drive/'verified-manifest.json').write_text(json.dumps(prior))
 data={'Ref2VA/text_encoder/model.safetensors':shared,'Ref2VA/transformer/model.safetensors':fresh,'Ref2VA/model_index.json':index,'model_index.json':index,'LICENSE':b'test'}
 listed=[types.SimpleNamespace(path=k,size=len(v),lfs=types.SimpleNamespace(sha256=sha(v))) for k,v in data.items() if k.startswith('Ref2VA/')]
 calls=[]
 def download(repo,revision,allow_patterns,local_dir,max_workers):
  calls.extend(allow_patterns)
  for k in allow_patterns:
   p=Path(local_dir)/k;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data[k])
 hub=types.SimpleNamespace(HfApi=lambda:types.SimpleNamespace(list_repo_tree=lambda *a,**k:listed),snapshot_download=download,hf_hub_download=lambda *a,**k:(_ for _ in ()).throw(AssertionError('unexpected retry')))
 original=Path.is_dir
 with patch.dict(sys.modules,{'huggingface_hub':hub}),patch.object(Path,'is_dir',lambda p:True if str(p)=='/content/drive/MyDrive' else original(p)),patch.object(m,'wait_for_local_space',lambda *a,**k:None):m.cache(local,drive,'Ref2VA')
 record=json.loads((drive/'verified-manifest.json').read_text())
 assert record['completed_partitions']==['FL2VA','Ref2VA']
 assert record['files']['Ref2VA/text_encoder/model.safetensors']['source_path']=='FL2VA/text_encoder/model.safetensors'
 assert 'Ref2VA/text_encoder/model.safetensors' not in calls
 assert not (drive/'Ref2VA/text_encoder/model.safetensors').exists()
 restored=root/'restored';m.restore_only(restored,drive,'Ref2VA')
 assert (restored/'Ref2VA/text_encoder/model.safetensors').read_bytes()==shared
 assert (restored/'Ref2VA/transformer/model.safetensors').read_bytes()==fresh
 source.write_bytes(b'x'*len(shared))
 try:m.restore_only(root/'corrupt',drive,'Ref2VA');raise AssertionError('corrupt shared source accepted')
 except ValueError:pass
 for unsafe in ('../escape','/tmp/escape'):
  try:m.cache_source(drive,'x',{'source_path':unsafe});raise AssertionError('unsafe alias accepted')
  except RuntimeError:pass
 print('PASS: shared reuse without download/duplication, both partitions retained, alias restore, corruption rejection, traversal rejection')
