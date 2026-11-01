import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,attempts=150){for(let i=0;i<attempts;i++){const value=await fn();if(value)return value;await wait(20);}throw new Error('Lifecycle fixture timed out');}
async function service(t,{env={},dev=false,seed}={}){
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-lifecycle-'));
  if(seed)await writeFile(path.join(data,'jobs.json'),JSON.stringify(seed));
  const child=spawn(process.execPath,['server/index.mjs',...(dev?[]:['--production'])],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:data,TAPNOW_IDLE_GRACE_MS:'180',TAPNOW_STARTUP_IDLE_MS:'3000',...env},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited;}await rm(data,{recursive:true,force:true});});
  const url=await until(()=>{if(child.exitCode!==null)throw new Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];},750);
  const state=()=>fetch(url+'/api/lifecycle').then(r=>r.json());
  const open=async()=>{const controller=new AbortController();const response=await fetch(url+'/api/events',{signal:controller.signal});assert.equal(response.status,200);return ()=>controller.abort();};
  const finish=async()=>{const result=await Promise.race([exited,wait(4000).then(()=>{throw new Error('Server did not exit: '+log);})]);assert.deepEqual(result,{code:0,signal:null});await assert.rejects(fetch(url+'/api/lifecycle'));};
  return {data,child,url,state,open,finish};
}
async function fixture(t,handler){const server=createServer(handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return `http://127.0.0.1:${server.address().port}`;}
const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};

test('last SSE tab idle timeout honors multiple tabs and reconnect grace',async t=>{
  const s=await service(t),a=await s.open(),b=await s.open();
  const first=await s.state();assert.equal(first.app,'tapnow-local');assert.match(first.instanceId,/^[a-f0-9-]{36}$/);assert.equal(first.clients,2);assert.equal(first.idleDeadlineAt,null);
  a();await wait(260);assert.equal((await s.state()).clients,1);
  b();await until(async()=>(await s.state()).clients===0);await wait(60);
  const c=await s.open();await wait(260);assert.equal((await s.state()).clients,1);assert.equal((await s.state()).instanceId,first.instanceId);
  c();await s.finish();
});

test('startup timeout exits; disabled timeout and dev SIGTERM close server and Vite',async t=>{
  const timed=await service(t,{env:{TAPNOW_STARTUP_IDLE_MS:'160'}});await timed.finish();
  const independent=await fixture(t,(_req,res)=>json(res,{alive:true}));
  const disabled=await service(t,{dev:true,env:{TAPNOW_STARTUP_IDLE_MS:'0',TAPNOW_IDLE_GRACE_MS:'0'}});
  const tab=await disabled.open();tab();await wait(260);assert.equal((await disabled.state()).idleDeadlineAt,null);
  disabled.child.kill('SIGTERM');await disabled.finish();assert.equal((await(await fetch(independent)).json()).alive,true,'does not stop unrelated listeners');
});

test('idle waits for actual generation completion and persists downloaded result',async t=>{
  let release=false;
  // Header-only protocol fixture, not a generated or playable video.
  const media=Buffer.from([0,0,0,20,...Buffer.from('ftypisom00000000')]);
  const upstream=await fixture(t,async(req,res)=>{
    if(req.url==='/v1/session')return json(res,{},404);
    if(req.method==='POST'){for await(const _ of req){}return json(res,{id:'video_fixture'});}
    if(req.url.endsWith('/content')){res.writeHead(200,{'Content-Type':'video/mp4'});return res.end(media);}
    json(res,{status:release?'completed':'in_progress'});
  });
  const s=await service(t,{env:{COLAB_URL:upstream,COLAB_TOKEN:'fixture-secret'}}),tab=await s.open();
  const response=await fetch(s.url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'fixture',requestId:'fixture',nodeId:'node',canvasId:'canvas'})});assert.equal(response.status,202);const job=await response.json();
  await until(async()=>(await s.state()).activeJobs===1);tab();await wait(260);assert.equal((await s.state()).activeJobs,1);
  release=true;await s.finish();const saved=JSON.parse(await readFile(path.join(s.data,'jobs.json'),'utf8')).find(j=>j.id===job.id);assert.equal(saved.status,'completed');assert.deepEqual(await readFile(path.join(s.data,saved.src)),media);
});

test('idle waits for Agent response even after its canvas disconnects',async t=>{
  let respond;
  const upstream=await fixture(t,async(req,res)=>{for await(const _ of req){}respond=()=>json(res,{choices:[{message:{content:'fixture reply'}}]});});
  const s=await service(t,{env:{DEEPSEEK_API_KEY:'fixture-only',DEEPSEEK_BASE_URL:upstream}}),tab=await s.open();
  const pending=fetch(s.url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'fixture'})}).then(r=>r.json());
  await until(()=>respond);tab();await wait(260);assert.equal((await s.state()).activeAgentRequests,1);respond();assert.equal((await pending).text,'fixture reply');await s.finish();
});

test('failed monitor for a cancelled historical job does not prevent idle exit',async t=>{
  const upstream=await fixture(t,(_req,res)=>json(res,{},404));
  const s=await service(t,{env:{TAPNOW_STARTUP_IDLE_MS:'180'},seed:[{id:'old',status:'cancelled',remoteId:'missing',startedAt:Date.now(),input:{},connection:{colabUrl:upstream,colabToken:'fixture-only'}}]});
  await s.finish();const saved=JSON.parse(await readFile(path.join(s.data,'jobs.json'),'utf8'))[0];assert.equal(saved.status,'cancelled');assert.equal(saved.upstreamFinishedAt,undefined);assert.match(saved.error,/无法确认/);
});

test('page heartbeat keeps the canvas alive without SSE, close releases it and crashed pages expire',async t=>{
  const s=await service(t,{env:{TAPNOW_PAGE_LEASE_MS:'300'}});
  const pulse=async(id,active)=>fetch(s.url+'/api/page-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,active})});
  assert.equal((await pulse('one',true)).status,200);await pulse('two',true);
  await wait(230);assert.equal((await s.state()).clients,0);assert.equal((await s.state()).pageSessions,2);
  await pulse('two',true);await pulse('one',false);await wait(230);assert.equal((await s.state()).pageSessions,1);
  await pulse('two',false);await s.finish();
  const reason=JSON.parse(await readFile(path.join(s.data,'last-shutdown.json'),'utf8'));assert.equal(reason.reason,'idle');
  const crashed=await service(t,{env:{TAPNOW_PAGE_LEASE_MS:'100'}});await fetch(crashed.url+'/api/page-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'crashed',active:true})});await crashed.finish();
});
