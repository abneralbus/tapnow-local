import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reconcileJobs} from '../src/state.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,attempts=120){for(let n=0;n<attempts;n++){const value=await fn();if(value)return value;await wait(50);}throw new Error('Timed out');}
async function start(data,base){
  const child=spawn(process.execPath,['server/index.mjs','--production'],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:data,FLOWBOARD_BASE_URL:base,MUSE2API_BASE_URL:base,MUSE2API_API_KEY:'backend-fixture-key'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const url=await until(()=>{if(child.exitCode!==null)throw new Error(output);return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  return {url,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');})};
}

test('image jobs persist, publish completed SSE, recover after restart, and reject corrupt downloads',async t=>{
  // A fixed one-pixel PNG is a fixture, never a provider-generated image.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
  const records=new Map();let next=0,hold=false,submits=0,uploads=0;
  const fixture=createServer(async(req,res)=>{
    let bytes='';for await(const chunk of req)bytes+=chunk;
    const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(req.url==='/api/health')return json({ok:true,extension_connected:true});
    if(req.url==='/api/flow/projects/pinned')return json({flow_project_id:'fixture-project'});
    if(req.url==='/readyz')return json({ready:true,driver:{driver:'browser',ok:true}});
    if(req.url==='/v1/models')return json({data:[{id:'muse-image'}]});
    if(req.url.startsWith('/v1/')&&req.headers.authorization!=='Bearer backend-fixture-key')return json({error:'unauthorized'},401);
    if(req.url==='/api/upload'){uploads++;return json({media_id:'uploaded-reference'});}
    const isFlow=req.url==='/api/requests',isMuse=req.url==='/v1/images/generations';
    if(req.method==='POST'&&(isFlow||isMuse)){
      const body=JSON.parse(bytes),id=++next;submits++;
      records.set(String(id),{provider:isFlow?'flow':'muse',prompt:isFlow?body.params.prompt:body.prompt,polls:0});
      return json({id:isFlow?id:String(id)});
    }
    const match=req.url.match(/^\/(?:api\/requests|v1\/images\/generations)\/(\d+)$/);
    if(match){const record=records.get(match[1]);record.polls++;if(record.prompt==='transient-outage'&&record.polls<=4)return json({error:'temporary bridge restart'},503);const running=(record.prompt==='hold'&&hold)||record.polls<2;
      return json({status:running?'running':record.provider==='flow'?'done':'succeeded',result:record.provider==='flow'?{media_ids:[match[1]]}:{data:[{url:'/v1/media/'+match[1]}]}});
    }
    const media=req.url.match(/^\/(?:media|v1\/media)\/(\d+)$/);
    if(media){res.writeHead(200,{'Content-Type':'image/png'});res.end(records.get(media[1]).prompt==='corrupt'?Buffer.from('<html>not an image</html>'):png);return;}
    return json({error:'unknown fixture route'},404);
  });
  await new Promise((resolve,reject)=>{fixture.on('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${fixture.address().port}`,data=await mkdtemp(path.join(tmpdir(),'tapnow-media-backend-'));
  let service=await start(data,base);const controller=new AbortController(),events=[];
  const response=await fetch(service.url+'/api/events',{signal:controller.signal});
  const eventTask=(async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let index;while((index=buffer.indexOf('\n\n'))!==-1){const part=buffer.slice(0,index);buffer=buffer.slice(index+2);if(part.startsWith('data: '))events.push(JSON.parse(part.slice(6)));}}}catch(error){if(!controller.signal.aborted)throw error;}})();
  t.after(async()=>{controller.abort();await eventTask;await service.stop();await new Promise(resolve=>fixture.close(resolve));await rm(data,{recursive:true,force:true});});
  const call=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(service.url+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const job=async id=>(await call('/api/jobs')).body.find(j=>j.id===id);
  const submit=async(provider,prompt,requestId,extra={})=>{const result=await call('/api/jobs',{provider,kind:'image',prompt,requestId,nodeId:'image-node',canvasId:'canvas',...extra});assert.equal(result.status,202);return result.body;};

  assert.equal((await call('/api/providers')).body.muse.connected,true);
  await call('/api/canvases/canvas',{name:'fixture',nodes:[{id:'image-node',type:'image',position:{x:0,y:0},data:{status:'queued'}}],edges:[]},'PUT');
  const upload=await fetch(service.url+'/api/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:png});const asset=await upload.json();
  const good=await submit('flow','fox','image-flow',{mode:'reference',references:[{src:asset.src,role:'reference'}]});
  const completed=await until(async()=>{const value=await job(good.id);return value.status==='completed'&&value;});
  assert.equal(uploads,1);assert.equal(completed.kind,'image');assert.equal(completed.provider,'flow');assert.match(completed.src,/\.png$/);
  assert.equal(completed.connection,undefined);assert.deepEqual(await readFile(path.join(data,completed.src)),png);
  const served=await fetch(service.url+completed.src);assert.match(served.headers.get('content-type'),/^image\/png/);assert.deepEqual(Buffer.from(await served.arrayBuffer()),png);
  await until(()=>events.find(event=>event.id===good.id&&event.status==='completed'&&event.src===completed.src));
  const duplicate=await call('/api/jobs',{provider:'flow',kind:'image',prompt:'fox',requestId:'image-flow',nodeId:'image-node',canvasId:'canvas'});assert.equal(duplicate.body.id,good.id);assert.equal(submits,1);
  const savedCanvas=(await call('/api/canvases/canvas')).body;
  const restored=reconcileJobs(savedCanvas.nodes,(await call('/api/jobs')).body,'canvas');assert.equal(restored[0].data.src,completed.src);assert.equal(restored[0].data.status,'completed');

  controller.abort();await eventTask;
  hold=true;const resumed=await submit('muse','hold','image-muse');await until(async()=> (await job(resumed.id)).remoteId);
  await service.stop();service=await start(data,base);hold=false;
  const resumedResult=await until(async()=>{const value=await job(resumed.id);return value.status==='completed'&&value;});
  assert.deepEqual(await readFile(path.join(data,resumedResult.src)),png);assert.equal(submits,2,'restart must not resubmit a generation');assert.equal((await job(good.id)).src,completed.src);
  const bad=await submit('muse','corrupt','image-bad');await until(async()=> (await job(bad.id)).status==='failed');
  assert.equal((await job(bad.id)).src,undefined);assert.ok(!(await readdir(path.join(data,'media'))).some(file=>file.includes(bad.id)||file.endsWith('.part')));
  const beforeOutage=submits;
  const outage=await submit('flow','transient-outage','flow-outage');
  const reconnected=await until(async()=>{const value=await job(outage.id);return value.status==='completed'&&value;},240);
  assert.ok(reconnected.src);assert.equal(submits,beforeOutage+1,'four transient poll errors must not fail or resubmit the generation');
  assert.ok(!JSON.stringify((await call('/api/jobs')).body).includes('backend-fixture-key'));
});
