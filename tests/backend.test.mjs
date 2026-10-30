import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<100;n++){const value=await fn();if(value)return value;await wait(50);}throw new Error('Timed out');}
async function start(data,upstream){
  const child=spawn(process.execPath,['server/index.mjs','--production'],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:data,COLAB_URL:upstream,COLAB_TOKEN:'test-secret'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const url=await until(()=>{if(child.exitCode!==null)throw new Error(output);return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  return {child,url,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');})};
}

test('native SGLang protocol, persistence, reconnect, stopped reception, and invalid media',async t=>{
  // This is a deterministic protocol fixture, not a generated or playable video.
  const fixture=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom00000000')]);
  const remoteJobs=new Map(),requests=[];let deletes=0,blocked=false;
  const fake=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer test-secret'){res.writeHead(401);res.end('{}');return;}
    const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(req.url==='/v1/models')return json(200,{data:[{id:'MiniMaxAI/MiniMax-H3',num_gpus:1}]});
    if(req.method==='POST'&&req.url==='/v1/videos'){
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
      if(body.prompt==='reject')return json(500,{error:{message:'fixture rejection'}});
      const id='video_'+requests.length;remoteJobs.set(id,{body,polls:0});return json(200,{id,status:'queued'});
    }
    const match=req.url.match(/^\/v1\/videos\/(video_\d+)(\/content)?$/);
    if(!match)return json(404,{});const entry=remoteJobs.get(match[1]);
    if(req.method==='DELETE'){deletes++;return json(200,{deleted:true});}
    if(match[2]){res.writeHead(200,{'Content-Type':'video/mp4'});res.end(entry.body.prompt==='bad-media'?Buffer.from('<html>error</html>'):fixture);return;}
    entry.polls++;const status=entry.body.prompt==='hold'&&blocked?'in_progress':entry.polls<2?'in_progress':'completed';
    json(200,{id:match[1],status,progress:status==='completed'?100:25});
  });
  await new Promise((resolve,reject)=>{fake.on('error',reject);fake.listen(0,'127.0.0.1',resolve);});
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-backend-'));
  let service=await start(data,`http://127.0.0.1:${fake.address().port}`);
  t.after(async()=>{await service.stop();await new Promise(resolve=>fake.close(resolve));await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{
    const response=await fetch(service.url+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
  };
  const submit=async(prompt,id)=>{const result=await call('/api/jobs',{prompt,requestId:id,nodeId:'node',canvasId:'canvas',duration:4});assert.equal(result.status,202);return result.body;};
  const job=async id=>(await call('/api/jobs')).body.find(j=>j.id===id);
  assert.equal((await call('/api/health')).body.connected,true);
  assert.equal((await call('/api/jobs',{prompt:'x',requestId:'invalid',nodeId:'',canvasId:'canvas'})).status,400);
  const good=await submit('fox','good');
  const duplicate=await call('/api/jobs',{prompt:'fox',requestId:'good',nodeId:'node',canvasId:'canvas'});
  assert.equal(duplicate.body.id,good.id);
  const completed=await until(async()=>{const value=await job(good.id);return value.status==='completed'&&value;});
  assert.deepEqual(requests[0].target,{short_edge:768,aspect_ratio:'16:9',duration_seconds:4});
  assert.equal(requests[0].num_inference_steps,50);assert.equal(requests[0].task,'t2va');
  assert.ok(completed.timings.serverTotalMs>=completed.timings.transferMs);
  assert.equal(completed.connection,undefined);assert.ok(!JSON.stringify(completed).includes('test-secret'));
  assert.deepEqual(await readFile(path.join(data,completed.src)),fixture);
  const rejected=await submit('reject','reject');
  await until(async()=> (await job(rejected.id)).status==='failed');
  const corrupt=await submit('bad-media','bad');
  await until(async()=> (await job(corrupt.id)).status==='failed');
  assert.ok(!(await readdir(path.join(data,'media'))).some(f=>f.includes(corrupt.id)));
  blocked=true;const resume=await submit('hold','resume');
  await until(async()=> (await job(resume.id)).remoteId);
  await service.stop();service=await start(data,`http://127.0.0.1:${fake.address().port}`);
  assert.equal((await job(good.id)).status,'completed');
  blocked=false;await until(async()=> (await job(resume.id)).status==='completed');
  assert.equal(requests.filter(r=>r.prompt==='hold').length,1,'restart must not duplicate the GPU job');
  blocked=true;const cancel=await submit('hold','cancel');
  await until(async()=> (await job(cancel.id)).remoteId);
  await call('/api/config',{colabUrl:`http://127.0.0.1:${fake.address().port}/different`,colabToken:'new-token'},'PUT');
  const stopped=await call('/api/jobs/'+cancel.id,null,'DELETE');
  assert.equal(stopped.body.status,'cancelled');assert.match(stopped.body.error,/GPU/);
  await service.stop();service=await start(data,`http://127.0.0.1:${fake.address().port}`);
  blocked=false;await until(async()=> (await job(cancel.id)).upstreamFinishedAt);
  assert.equal((await job(cancel.id)).status,'cancelled','resume keeps stopped reception and the original endpoint credentials');
  assert.equal(deletes,0,'remote DELETE does not cancel GPU and must not be misused');
  assert.equal((await job(cancel.id)).src,undefined);
  assert.ok(!(await readdir(path.join(data,'media'))).some(f=>f.endsWith('.part')));
});


test('canvas saves reject stale, legacy, and simultaneous overwrites',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-canvas-conflict-'));
  const service=await start(data,'http://127.0.0.1:1');
  t.after(async()=>{await service.stop();await rm(data,{recursive:true,force:true});});
  const put=async body=>{const r=await fetch(service.url+'/api/canvases/shared',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const snapshot={name:'shared',nodes:[],edges:[]};
  const first=await put(snapshot);assert.equal(first.status,200);
  const next={...snapshot,nodes:[{id:'new-video',type:'video',position:{x:0,y:0},data:{src:'/media/result.mp4'}}],baseUpdatedAt:first.body.updatedAt};
  const saved=await put(next);assert.equal(saved.status,200);
  assert.ok(saved.body.updatedAt>first.body.updatedAt);
  assert.equal((await put({...snapshot,baseUpdatedAt:first.body.updatedAt})).status,409);
  assert.equal((await put(snapshot)).status,409);
  assert.equal((await (await fetch(service.url+'/api/canvases/shared')).json()).nodes[0].id,'new-video');
  const concurrent=await Promise.all([put({...next,baseUpdatedAt:saved.body.updatedAt}),put({...snapshot,baseUpdatedAt:saved.body.updatedAt})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const latest=await (await fetch(service.url+'/api/canvases/shared')).json();
  assert.deepEqual(latest.nodes,concurrent[0].status===200?next.nodes:snapshot.nodes);
  const deletion=await put({...snapshot,baseUpdatedAt:latest.updatedAt});assert.equal(deletion.status,200);
});

test('canvas groups, batch moves and recoverable deletion survive saves and restart',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-library-'));let service=await start(data,'http://127.0.0.1:1');
  t.after(async()=>{await service.stop();await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(service.url+'/api'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const doc={name:'第一张画布',nodes:[{id:'i',type:'image',position:{x:0,y:0},data:{src:'/media/cover.webp'}}],edges:[]};
  const a=await call('/canvases/a',doc,'PUT');await call('/canvases/b',{...doc,name:'第二张画布'},'PUT');
  const group=(await call('/canvas-groups',{name:'影片项目'})).body;
  assert.equal((await call('/canvas-groups',{name:' 影片项目 '})).status,409);
  assert.equal((await call('/canvas-groups',{name:' '})).status,400);
  assert.equal((await call('/canvas-management',{action:'move',ids:['a','missing'],groupId:group.id})).status,404);
  assert.equal((await call('/canvases/a')).body.groupId,null,'invalid batches must validate before mutating');
  await call('/canvas-management',{action:'move',ids:['a','b'],groupId:group.id});
  let saved=(await call('/canvases/a')).body;
  assert.equal(saved.groupId,group.id);
  assert.equal((await call('/canvases/a',{...doc,baseUpdatedAt:a.body.updatedAt},'PUT')).status,409);
  await call('/canvases/a',{...doc,baseUpdatedAt:saved.updatedAt},'PUT');
  assert.equal((await call('/canvases/a')).body.groupId,group.id,'content autosave preserves group membership');
  await call('/canvas-management',{action:'rename',ids:['a'],name:'改名画布'});
  saved=(await call('/canvases/a')).body;assert.equal(saved.name,'改名画布');assert.deepEqual(saved.nodes,doc.nodes);
  const deleted=await call('/canvas-management',{action:'delete',ids:['a','b']});assert.equal(deleted.status,200);
  assert.equal((await call('/canvases/a',{...saved,baseUpdatedAt:saved.updatedAt},'PUT')).status,410,'old tab cannot resurrect trash');
  assert.equal((await call('/canvases/a',doc,'PUT')).status,410,'legacy save cannot resurrect trash either');
  assert.equal((await call('/canvases/a')).status,410);
  assert.deepEqual((await call('/canvases')).body,[]);
  assert.equal((await call('/canvases?trash=true')).body.length,2);
  await service.stop();service=await start(data,'http://127.0.0.1:1');
  assert.equal((await call('/canvases?trash=true')).body.length,2);
  await call('/canvas-groups/'+group.id,{name:'新分组名'},'PATCH');
  assert.equal((await call('/canvas-groups')).body[0].name,'新分组名');
  await call('/canvas-groups/'+group.id,null,'DELETE');
  await call('/canvas-management',{action:'restore',ids:['a','b']});
  const restored=(await call('/canvases/a')).body;assert.deepEqual(restored.nodes,doc.nodes);assert.equal(restored.name,'改名画布');assert.equal(restored.groupId,null);
  const list=(await call('/canvases')).body;assert.equal(list.length,2);assert.ok(list.every(p=>p.groupId===null));assert.equal(list[0].cover,'/media/cover.webp');
  assert.equal((await call('/canvas-management',{action:'move',ids:['a'],groupId:group.id})).status,404);
  const race=await Promise.all([call('/canvases/a',{...restored,baseUpdatedAt:restored.updatedAt},'PUT'),call('/canvas-management',{action:'delete',ids:['a']})]);
  assert.ok([200,410].includes(race[0].status));assert.equal(race[1].status,200);assert.equal((await call('/canvases/a')).status,410);
});

test('deletion snapshots survive restart and restore into an independent canvas without replaying jobs',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-history-api-'));let service=await start(data,'http://127.0.0.1:1');
  t.after(async()=>{await service.stop();await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(service.url+'/api'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const initial={name:'保护节点',nodes:[],edges:[]};let revision=(await call('/canvases/source',initial,'PUT')).body.updatedAt;
  const node={id:'kept',type:'image',position:{x:40,y:60},data:{src:'/media/cover.webp',prompt:'original',status:'running',jobId:'old-job',clickedSessionId:'old-session'}};
  revision=(await call('/canvases/source',{...initial,nodes:[node],baseUpdatedAt:revision},'PUT')).body.updatedAt;
  const deleted=await call('/canvases/source',{...initial,baseUpdatedAt:revision},'PUT');assert.equal(deleted.status,200);
  assert.equal((await call('/canvases/source/history',{baseUpdatedAt:revision})).status,409);
  let versions=(await call('/canvases/source/history')).body;const protective=versions.find(v=>v.reason==='before-delete');assert.ok(protective);assert.equal(protective.nodes,1);assert.equal(protective.document,undefined);
  await service.stop();service=await start(data,'http://127.0.0.1:1');versions=(await call('/canvases/source/history')).body;assert.equal(versions[0].id,protective.id);
  const restored=await call('/canvases/source/history/'+protective.id+'/restore',{});assert.equal(restored.status,200);assert.notEqual(restored.body.id,'source');
  const copy=(await call('/canvases/'+restored.body.id)).body;assert.equal(copy.nodes[0].data.prompt,'original');assert.equal(copy.nodes[0].data.src,node.data.src);assert.equal(copy.nodes[0].data.status,'completed');assert.equal(copy.nodes[0].data.jobId,undefined);assert.equal(copy.nodes[0].data.clickedSessionId,undefined);
  assert.equal((await call('/canvases/source')).body.nodes.length,0);assert.equal((await call('/jobs')).body.length,0);
  assert.equal((await call('/canvases/source/history/missing/restore',{})).status,404);
  assert.equal((await call('/canvases/missing/history')).status,404);
});

test('Agent configuration, chat and connection tests use the selected protocol and survive restart',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-agent-api-')),received=[];let hold=false,release;
  const upstream=createServer(async(req,res)=>{let input='';for await(const chunk of req)input+=chunk;received.push({url:req.url,body:JSON.parse(input),headers:req.headers});if(hold)await new Promise(resolve=>{release=resolve;});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url.endsWith('/responses')?{output:[{type:'message',content:[{type:'output_text',text:'连接正常'}]}]}:req.url.endsWith('/messages')?{content:[{type:'text',text:'连接正常'}]}:req.url.includes(':generateContent')?{candidates:[{content:{parts:[{text:'连接正常'}]}}]}:{choices:[{message:{content:'连接正常'}}]}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));let s=await start(data,'http://127.0.0.1:1');
  t.after(async()=>{await s.stop();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(s.url+'/api'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const baseUrl=`http://127.0.0.1:${upstream.address().port}/v1`;
  for(const provider of ['openai','anthropic','gemini','deepseek','compatible']){
    const saved=await call('/agent/config',{provider,model:'fixture',baseUrl,apiKey:'api-fixture-secret'},'PUT');assert.equal(saved.status,200);assert.equal(saved.body.agentProvider,provider);assert.ok(!JSON.stringify(saved.body).includes('api-fixture-secret'));
    const tested=await call('/agent/test',{});assert.equal(tested.status,200);assert.equal(tested.body.text,'连接正常');assert.equal(tested.body.agentStatus,'verified');assert.equal((await call('/lifecycle')).body.activeAgentRequests,0);
    const chat=await call('/chat',{prompt:'继续',history:[{role:'user',text:'记住角色'}]});assert.equal(chat.body.text,'连接正常');assert.match(JSON.stringify(received.at(-1).body),/记住角色/);
  }
  hold=true;const pending=call('/chat',{prompt:'慢请求'});await until(()=>release);
  const conflict=await call('/agent/config',{provider:'codex-cli',model:''},'PUT');assert.equal(conflict.status,409);
  hold=false;release();assert.equal((await pending).status,200);
  const config=(await call('/config')).body;assert.equal(config.agentProvider,'compatible');assert.equal(config.hasToken,true);
  await s.stop();s=await start(data,'http://127.0.0.1:1');assert.equal((await call('/config')).body.agentProvider,'compatible');
  assert.equal((await call('/agent/config',{provider:'invalid',model:''},'PUT')).status,400);
});


test('startup expires 30-day trash and assets; tombstones block stale saves, job submissions and snapshot restoration',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-expiry-api-')),now=Date.now(),duration=30*86400000;
  for(const dir of ['canvases','canvas-history','media'])await mkdir(path.join(data,dir));
  const doc={name:'过期样本',nodes:[{id:'i',type:'image',position:{x:0,y:0},data:{src:'/media/expired.png'}}],edges:[],updatedAt:now-duration-1,deletedAt:now-duration-1};
  const young={...doc,name:'可恢复样本',deletedAt:now-10000,nodes:[{...doc.nodes[0],data:{src:'/media/young.png'}}]};
  await writeFile(path.join(data,'canvases','expired.json'),JSON.stringify(doc));await writeFile(path.join(data,'canvases','young.json'),JSON.stringify(young));
  await writeFile(path.join(data,'canvas-history','expired.json'),JSON.stringify([{id:'version',document:doc,savedAt:now-duration}]));
  await writeFile(path.join(data,'media','expired.png'),'fixture');await writeFile(path.join(data,'media','young.png'),'fixture');
  await writeFile(path.join(data,'jobs.json'),JSON.stringify([{id:'expired-job',canvasId:'expired',status:'completed',src:'/media/expired.png',requestId:'old-request'}]));
  let s=await start(data,'http://127.0.0.1:1');t.after(async()=>{await s.stop();await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(s.url+'/api'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const trash=(await call('/canvases?trash=true')).body;assert.equal(trash.length,1);assert.equal(trash[0].id,'young');assert.equal(trash[0].expiresAt,young.deletedAt+duration);
  await assert.rejects(()=>access(path.join(data,'media','expired.png')));await access(path.join(data,'media','young.png'));assert.deepEqual((await call('/jobs')).body,[]);
  assert.equal((await call('/canvases/expired',doc,'PUT')).status,410);
  assert.equal((await call('/canvas-management',{action:'restore',ids:['expired']})).status,410);
  assert.equal((await call('/canvases/expired/history/version/restore',{})).status,410);
  assert.equal((await call('/jobs',{prompt:'stale',requestId:'old-request',nodeId:'i',canvasId:'expired',duration:4})).status,410);
  assert.equal((await call('/canvas-management',{action:'restore',ids:['young']})).status,200);assert.equal((await call('/canvases/young')).body.deletedAt,undefined);
  assert.equal((await call('/canvas-management',{action:'delete',ids:['young']})).status,200);const renewed=(await call('/canvases?trash=true')).body[0];assert.ok(renewed.expiresAt>young.deletedAt+duration);
  await s.stop();s=await start(data,'http://127.0.0.1:1');assert.equal((await call('/canvases/expired',doc,'PUT')).status,410);await access(path.join(data,'media','young.png'));
});
