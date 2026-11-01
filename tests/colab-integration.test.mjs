import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {generationRequest} from '../server/media-request.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){const value=await fn();if(value)return value;await wait(30);}throw Error('Timed out');}

test('H3 per-modality tags, keyframe ordering, and non-Colab restrictions',()=>{
 const references=[{src:'/media/v.mp4',nodeId:'v',role:'reference'},{src:'/media/i.png',nodeId:'i',role:'reference'},{src:'/media/a.wav',nodeId:'a',role:'reference'}];
 const prompt='@声音 @图片 @动作',mentions=[{nodeId:'a',token:'@声音',start:0,end:3},{nodeId:'i',token:'@图片',start:4,end:7},{nodeId:'v',token:'@动作',start:8,end:11}];
 const value=generationRequest({provider:'colab',prompt,references,mentions,mode:'reference'});
 assert.equal(value.prompt,'<Audio 1> <Picture 1> <Video 1>');
 const frames=generationRequest({provider:'colab',prompt:'animate',mode:'frames',references:[{src:'/media/z.png',role:'end'},{src:'/media/b.png',role:'start'}]});
 assert.deepEqual(frames.references.map(r=>r.role),['start','end']);
 assert.throws(()=>generationRequest({provider:'flow',model:'omni',prompt:'x',mode:'reference',references}),/参考图片/);
 assert.throws(()=>generationRequest({provider:'colab',prompt:'x',mode:'frames',references:[{src:'/media/a.wav',role:'start'}]}),/必须是图片/);
 assert.throws(()=>generationRequest({provider:'colab',prompt:'x',mode:'reference',references:Array.from({length:4},(_,i)=>({src:`/media/v${i}.mp4`,role:'reference'}))}),/3 段视频/);
});

test('Colab upload → submit → durable local file → receipt; reject wrong model before upload',async t=>{
 const data=await mkdtemp(path.join(tmpdir(),'tapnow-colab-'));
 const video=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom00000000')]);
 let payload,receipts=0,uploads=0,variant='ref2va';
 const fake=createServer(async(req,res)=>{
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(req.url==='/v1/session')return json(200,{sessionId:'session1',phase:'ready',tasks:variant==='ref2va'?['ref2va']:['t2va','fl2va']});
  if(req.url.startsWith('/v1/assets/')){uploads++;for await(const _ of req){}return json(200,{assetId:'uploaded.png'});}
  if(req.url==='/v1/videos'){let raw='';for await(const chunk of req)raw+=chunk;payload=JSON.parse(raw);return json(200,{id:'video1'});}
  if(req.url==='/v1/videos/video1')return json(200,{status:'completed'});
  if(req.url==='/v1/videos/video1/content'){res.writeHead(200,{'Content-Type':'video/mp4'});return res.end(video);}
  if(req.url==='/v1/videos/video1/receipt'){
   let raw='';for await(const chunk of req)raw+=chunk;const receipt=JSON.parse(raw);
   const jobs=JSON.parse(await readFile(path.join(data,'jobs.json'),'utf8')),job=jobs.find(j=>j.remoteId==='video1');
   assert.equal(job.status,'completed');assert.deepEqual(await readFile(path.join(data,'media',path.basename(job.src))),video);
   assert.equal(receipt.sha256,createHash('sha256').update(video).digest('hex'));assert.equal(receipt.bytes,video.length);assert.equal(receipt.sessionId,'session1');
   receipts++;return json(200,{saved:true});
  }
  return json(404,{});
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server/index.mjs','--production'],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:data,COLAB_URL:`http://127.0.0.1:${fake.address().port}`,COLAB_TOKEN:'fixture',TAPNOW_STARTUP_IDLE_MS:'0'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
 t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fake.closeAllConnections();await new Promise(r=>fake.close(r));await rm(data,{recursive:true,force:true});});
 const url=await until(()=>{if(child.exitCode!==null)throw Error(output);return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
 const call=async(route,body,method=body?'POST':'GET')=>{const response=await fetch(url+'/api'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 await call('/canvases/canvas',{nodes:[],edges:[]},'PUT');
 const asset=await(await fetch(url+'/api/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:Buffer.from('fixture')})).json();
 const request={provider:'colab',kind:'video',mode:'reference',references:[{src:asset.src,role:'reference'}],prompt:'subject',canvasId:'canvas',nodeId:'node',requestId:'request1'};
 assert.equal((await call('/jobs',request)).status,202);
 await until(()=>receipts===1);
 const saved=await until(async()=>{const jobs=(await call('/jobs')).body;return jobs.find(j=>j.receiptSaved);});
 assert.equal(saved.status,'completed');assert.equal(payload.task,'ref2va');assert.equal(payload.conditions[0].assetId,'uploaded.png');assert.equal(payload.conditions[0].type,'image');assert.equal(uploads,1);
 variant='fl2va';await call('/jobs',{...request,requestId:'request2'});
 const failed=await until(async()=>{const jobs=(await call('/jobs')).body;return jobs.find(j=>j.requestId==='request2'&&j.status==='failed');});
 assert.match(failed.error,/Ref2VA/);assert.equal(uploads,1);assert.equal(receipts,1);
});
