import express from 'express';
import {createVideoFrames} from './video-frame.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { endpoint } from './validation.mjs';
import {installCanvasLibrary} from './canvas-library.mjs';
import {agentConfiguration,agentChat} from './agent.mjs';
import {stopCodexChildren} from './codex.mjs';
import {stopAgentCliChildren} from './agent-cli.mjs';
import {writeAgentSettings} from './agent-settings.mjs';
import {generationRequest} from './media-request.mjs';
import {mediaConnection,providerStatus,submitMedia,pollMedia,mediaContent,imageMime} from './media-providers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root,'.env')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data')), media = path.join(data,'media'), canvases = path.join(data,'canvases');
await Promise.all([mkdir(media,{recursive:true}), mkdir(canvases,{recursive:true})]);
async function readJSON(file, fallback) { try { return JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
async function saveJSON(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp,JSON.stringify(value),{mode:0o600}); await rename(temp,file); }
let config = await readJSON(path.join(data,'config.json'),{ colabUrl:process.env.COLAB_URL || '', colabToken:process.env.COLAB_TOKEN || '' });
const port = Number(process.env.PORT || 4317), app = express(), server = createServer(app);
let closing=false,vite;
const stopping=new AbortController();
app.disable('x-powered-by');
app.use((req,res,next) => {
  const hostname = req.headers.host?.split(':')[0];
  if (!['127.0.0.1','localhost'].includes(hostname)) return res.status(403).json({error:'仅支持本机访问'});
  const origin = req.headers.origin;
  if (origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)) return res.status(403).json({error:'不允许跨站请求'});
  res.setHeader('X-Content-Type-Options','nosniff'); next();
});
app.use('/api',express.json({limit:'4mb'}));
app.use('/api',(req,res,next)=>closing?res.status(503).json({error:'本地画布正在关闭，请重新启动后访问。'}):next());
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const drainCanvases=installCanvasLibrary(app,data,{
  canCleanup:()=>!activeRuns.size&&!pendingJobRequests,
  getJobs:()=>[...jobs.values()],
  onPurged:result=>{for(const stream of listeners)stream.write('event: library-purged\ndata: '+JSON.stringify(result)+'\n\n');},
  removeJobs:async ids=>{
    const removed=ids.map(id=>jobs.get(id)).filter(Boolean);
    for(const job of removed){jobs.delete(job.id);if(job.requestId)requests.delete(job.requestId);}
    try{await saveJobs();}catch(error){for(const job of removed){jobs.set(job.id,job);if(job.requestId)requests.set(job.requestId,job.id);}throw error;}
  }
});
app.get('/api/config',async(req,res) => res.json({colabUrl:config.colabUrl,hasToken:!!config.colabToken,...await agentConfiguration(data)}));
app.get('/api/providers',async(req,res)=>res.json(await providerStatus(data)));
app.put('/api/agent/config',async(req,res)=>{if(activeAgentRequests)return res.status(409).json({error:'Agent 正在回复，请等待完成后切换配置。'});await writeAgentSettings(data,req.body);res.json(await agentConfiguration(data));});
app.post('/api/agent/test',async(req,res)=>{activeAgentRequests++;checkIdle();const start=performance.now();try{const result=await agentChat(data,{prompt:'请只回复：连接正常。'});res.json({text:result.text.slice(0,300),elapsedMs:Math.round(performance.now()-start),...await agentConfiguration(data)});}finally{activeAgentRequests--;checkIdle();}});
app.put('/api/config',async(req,res) => {
  const next={colabUrl:endpoint(req.body.colabUrl),colabToken:typeof req.body.colabToken==='string' && req.body.colabToken ? req.body.colabToken : config.colabToken};
  if(next.colabToken.length>1024)throw new Error('Token 过长');
  await saveJSON(path.join(data,'config.json'),next);config=next;res.json({saved:true});
});
async function remote(route,options={},current=config) {
  if(!current.colabUrl)throw new Error('先在连接设置中配置 Colab 服务');
  const response=await fetch(current.colabUrl+route,{...options,redirect:'error',signal:AbortSignal.any([stopping.signal,options.signal||AbortSignal.timeout(15000)]),headers:{Authorization:`Bearer ${current.colabToken}`,...options.headers}});
  if(!response.ok){let message=`Colab 返回 ${response.status}`;try{const body=await response.json();message=body.detail||body.error?.message||body.error||message;}catch{}const error=new Error(typeof message==='string'?message:JSON.stringify(message));error.upstreamStatus=response.status;throw error;}
  return response;
}
app.get('/api/health',async(req,res)=> { const start=performance.now();try{ const info=await(await remote('/v1/models',{signal:AbortSignal.timeout(6000)})).json();const model=info.data?.find(item=>item.id==='MiniMaxAI/MiniMax-H3');if(!model)throw new Error('服务没有提供 MiniMaxAI/MiniMax-H3');res.json({connected:true,model:model.id,gpu:model.num_gpus?`${model.num_gpus} GPU`:undefined,roundTripMs:Math.round(performance.now()-start),canCancelGpu:false}); }catch(error){res.json({connected:false,error:error.message});} });
const extensions={ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/ogg':'.ogg','audio/mp4':'.m4a' };
app.post('/api/assets',express.raw({type:()=>true,limit:'100mb'}),async(req,res) => {const ext=extensions[req.headers['content-type']];if(!ext||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'支持图片、视频或音频，单文件不超过 100MB'});const name=randomUUID()+ext;await writeFile(path.join(media,name),req.body);res.json({src:'/media/'+name});});
app.use('/media',express.static(media,{dotfiles:'deny',setHeaders:res=>res.setHeader('Cache-Control','private, max-age=86400')}));
const videoFrame=createVideoFrames(media,{signal:stopping.signal});
app.get('/api/video-frame/:file',async(req,res)=>{try{const frame=await videoFrame(req.params.file,req.query.time??0);res.set('Cache-Control','private, no-cache').type('jpg').send(frame);}catch(error){res.status(error.status||500).json({error:error.message});}});
const jobsFile=path.join(data,'jobs.json');
const jobs=new Map((await readJSON(jobsFile,[])).map(job=>[job.id,job])),listeners=new Set(),downloads=new Map();
const activeRuns=new Set(),instanceId=randomUUID(),startedAt=Date.now();
let activeAgentRequests=0,pendingJobRequests=0,hadClient=false,lastClientLeftAt=startedAt,idleTimer,listening=false;
function idleDuration(key,fallback){const value=Number(process.env[key]??fallback);if(!Number.isFinite(value)||value<0)throw new Error(`${key} 应为非负毫秒数（0 禁用）`);return value;}
const idleGraceMs=idleDuration('TAPNOW_IDLE_GRACE_MS',30000),startupIdleMs=idleDuration('TAPNOW_STARTUP_IDLE_MS',120000),pageLeaseMs=idleDuration('TAPNOW_PAGE_LEASE_MS',120000);
const pageLeases=new Map();
function idleDeadline(){const delay=hadClient?idleGraceMs:startupIdleMs;return !listeners.size&&delay?Math.max(lastClientLeftAt,...pageLeases.values())+delay:null;}
function checkIdle(){
  clearTimeout(idleTimer);if(closing||!listening)return;
  const deadline=idleDeadline();if(deadline===null)return;
  const remaining=deadline-Date.now();
  if(remaining>0)idleTimer=setTimeout(checkIdle,remaining);
  else if(!activeRuns.size&&!activeAgentRequests&&!pendingJobRequests)shutdown('idle').catch(error=>{console.error(error.message);process.exit(1);});
}
app.post('/api/page-session',(req,res)=>{
  const {id,active}=req.body;if(!idPattern.test(id||'')||typeof active!=='boolean')return res.status(400).json({error:'无效页面会话'});
  const now=Date.now();for(const [key,expires] of pageLeases)if(expires<now)pageLeases.delete(key);
  if(active){pageLeases.set(id,now+pageLeaseMs);hadClient=true;}
  else if(pageLeases.delete(id))lastClientLeftAt=now;
  checkIdle();res.json({connected:true});
});
app.get('/api/lifecycle',(req,res)=>res.json({app:'tapnow-local',instanceId,pid:process.pid,startedAt,closing,clients:listeners.size,pageSessions:[...pageLeases.values()].filter(expiry=>expiry>Date.now()).length,activeJobs:activeRuns.size,activeAgentRequests,idleDeadlineAt:idleDeadline()}));
const active=job=>['queued','running','downloading'].includes(job.status)||(job.status==='cancelled'&&job.remoteId&&!job.upstreamFinishedAt);
const publicJob=({connection,...job})=>job;
let persist=Promise.resolve();
function saveJobs(){const snapshot=JSON.stringify([...jobs.values()]);persist=persist.catch(()=>{}).then(()=>saveJSON(jobsFile,JSON.parse(snapshot)));return persist;}
function publish(job){const event=`data: ${JSON.stringify(publicJob(job))}\n\n`;for(const stream of listeners)stream.write(event);}
async function record(job){await saveJobs();publish(job);}
app.get('/api/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write(': connected\n\n');listeners.add(res);hadClient=true;checkIdle();const pulse=setInterval(()=>res.write(': keepalive\n\n'),20000);req.on('close',()=>{listeners.delete(res);clearInterval(pulse);if(!listeners.size)lastClientLeftAt=Date.now();checkIdle();});});
app.get('/api/jobs',(req,res)=>res.json([...jobs.values()].map(publicJob)));
const requests=new Map([...jobs.values()].filter(j=>j.requestId).map(j=>[j.requestId,j.id]));
app.post('/api/jobs',(req,res,next)=>{pendingJobRequests++;res.once('close',()=>{pendingJobRequests--;checkIdle();});next();},async(req,res)=>{
  const input=generationRequest(req.body);
  const requestId=String(req.body.requestId||'');
  if(!idPattern.test(requestId)||!idPattern.test(req.body.nodeId||'')||!idPattern.test(req.body.canvasId||''))return res.status(400).json({error:'缺少有效请求、节点或画布 ID'});
  await drainCanvases.assertWritable(req.body.canvasId);
  if(requests.has(requestId))return res.json(publicJob(jobs.get(requests.get(requestId))));
  if(input.provider==='colab'&&!config.colabUrl)return res.status(503).json({error:'Colab 尚未连接。请先打开连接设置。'});
  if(input.provider!=='colab'){
    const status=await providerStatus(data),ready=input.provider==='flow'?status.bridge.connected&&status.bridge.extensionConnected&&status.bridge.projectConfigured:status.muse.connected;
    if(!ready)return res.status(503).json({error:(input.provider==='flow'?status.bridge.error:status.muse.error)||'媒体服务尚未就绪'});
  }
  if(closing)return res.status(503).json({error:'本地画布正在关闭，请重新启动后访问。'});
  // Provider checks await I/O; a duplicate may have committed meanwhile.
  if(requests.has(requestId))return res.json(publicJob(jobs.get(requests.get(requestId))));
  if([...jobs.values()].filter(active).length>=4)return res.status(429).json({error:'已有 4 个远端任务尚未结束，请稍后再试'});
  const job={id:randomUUID(),requestId,nodeId:req.body.nodeId,canvasId:req.body.canvasId,status:'queued',startedAt:Date.now(),prompt:input.prompt,input,kind:input.kind,provider:input.provider,connection:input.provider==='colab'?{...config}:mediaConnection()};
  jobs.set(job.id,job);requests.set(requestId,job.id);
  try{await record(job);}catch(error){jobs.delete(job.id);requests.delete(requestId);throw error;}
  res.status(202).json(publicJob(job));if(!closing)launch(job);
});
function launch(job){const operation=(job.input.provider&&job.input.provider!=='colab'?runMedia(job):run(job)).catch(async error=>{
  if(closing)return;
  if(job.status!=='cancelled'){job.status='failed';job.error=error.message+(!job.upstreamFinishedAt&&job.submittedAt?'；远端提交或完成状态未确认，请检查对应生成服务，避免重复生成。':'');job.finishedAt=Date.now();}
  else job.error='已停止接收结果；无法确认远端是否结束，请检查对应生成服务。';
  await record(job).catch(e=>console.error('保存任务失败:',e.message));
}).finally(()=>{activeRuns.delete(operation);checkIdle();});activeRuns.add(operation);checkIdle();}
async function run(job){
  const current=job.connection,deadline=job.startedAt+30*60*1000;
  if(!job.remoteId){
    if(job.status==='cancelled')return;
    // Persist before dispatch so a crash never causes an automatic duplicate GPU job.
    job.submittedAt=Date.now();await saveJobs();
    const input=job.input;
    const response=await remote('/v1/videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      model:'MiniMaxAI/MiniMax-H3',prompt:input.prompt,seconds:input.duration,task:'t2va',conditions:[],
      target:{short_edge:input.height,aspect_ratio:'16:9',duration_seconds:input.duration},
      num_outputs_per_prompt:1,num_inference_steps:input.steps,flow_shift:12,audio_flow_shift:3,seed:input.seed
    })},current);
    const remoteJob=await response.json();
    if(!idPattern.test(remoteJob.id))throw new Error('Colab 返回无效任务 ID');
    job.remoteId=remoteJob.id;job.timings={submitMs:Date.now()-job.submittedAt};await record(job);
  }
  let failures=0;
  while(true){
    let info;
    try{info=await(await remote(`/v1/videos/${job.remoteId}`,{},current)).json();failures=0;}
    catch(error){if(error.upstreamStatus===404)throw new Error('远端任务不存在，Colab 服务可能已重启');if(++failures>=3||[401,403].includes(error.upstreamStatus))throw error;await new Promise(resolve=>setTimeout(resolve,1000));continue;}
    if(!['queued','in_progress','completed','failed'].includes(info.status))throw new Error('Colab 返回未知任务状态');
    const terminal=['completed','failed'].includes(info.status);
    if(!terminal&&Date.now()>deadline)throw new Error('等待结果超过 30 分钟');
    if(terminal){job.upstreamFinishedAt=Date.now();await saveJobs();}
    if(job.status==='cancelled'){if(terminal){job.error='已停止接收结果；远端任务已结束。';await record(job);return;}}
    else{
      if(info.status==='failed')throw new Error(info.error?.message||String(info.error||'Colab 生成失败'));
      if(info.status==='in_progress'&&!job.runningObservedAt){job.runningObservedAt=Date.now();job.timings.queueObservedMs=job.runningObservedAt-job.submittedAt;}
      const previous=job.status;
      job.status=info.status==='completed'?'downloading':info.status==='in_progress'?'running':'queued';
      job.progress=Number.isFinite(info.progress)?Math.max(0,Math.min(100,info.progress)):undefined;
      if(previous!==job.status)await record(job);else publish(job);
      if(terminal)break;
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(job.status==='cancelled')return;
  const transferStart=Date.now(),filename=job.id+'.mp4',temp=path.join(media,filename+'.part');
  const controller=new AbortController();downloads.set(job.id,controller);
  let bytes=0,header=Buffer.alloc(0);
  try{
    const result=await remote(`/v1/videos/${job.remoteId}/content`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])},current);
    if(!/^(video\/mp4|application\/octet-stream)(;|$)/i.test(result.headers.get('content-type')||''))throw new Error('Colab 没有返回 MP4 视频');
    const limit=new Transform({transform(chunk,encoding,callback){
      bytes+=chunk.length;if(bytes>250*1024*1024)return callback(new Error('视频超过 250MB'));
      if(header.length<12){header=Buffer.concat([header,chunk]).subarray(0,12);if(header.length>=12&&header.toString('ascii',4,8)!=='ftyp')return callback(new Error('返回文件不是有效 MP4 容器'));}
      callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(result.body),limit,createWriteStream(temp));
    if(bytes<12)throw new Error('返回视频为空或不完整');
    if(job.status==='cancelled'){await unlink(temp).catch(()=>{});return;}
    await rename(temp,path.join(media,filename));
    if(job.status==='cancelled'){await unlink(path.join(media,filename)).catch(()=>{});return;}
  }catch(error){await unlink(temp).catch(()=>{});if(job.status==='cancelled')return;throw error;}
  finally{downloads.delete(job.id);}
  job.src='/media/'+filename;job.status='completed';job.finishedAt=Date.now();job.progress=100;
  job.timings={...job.timings,remoteElapsedMs:transferStart-job.submittedAt,transferMs:Date.now()-transferStart,serverTotalMs:Date.now()-job.startedAt};
  await record(job);await saveJSON(path.join(data,'last-benchmark.json'),publicJob(job));
}
async function runMedia(job){
  const deadline=job.startedAt+30*60*1000;
  if(!job.remoteId){
    if(job.status==='cancelled')return;
    job.submittedAt=Date.now();await saveJobs();
    job.remoteId=await submitMedia(job.input,data,job.connection);
    job.timings={submitMs:Date.now()-job.submittedAt};await record(job);
  }
  let info,failures=0;
  while(true){
    try{info=await pollMedia(job,data);failures=0;}catch(error){if(++failures>=3)throw error;await new Promise(r=>setTimeout(r,1500));continue;}
    if(info.status==='unknown')throw new Error('媒体服务返回未知任务状态');
    const terminal=['completed','failed','cancelled'].includes(info.status);
    if(!terminal&&Date.now()>deadline)throw new Error('媒体生成等待超过 30 分钟，未自动重试');
    if(terminal){job.upstreamFinishedAt=Date.now();await saveJobs();}
    if(job.status==='cancelled'){if(terminal){await record(job);return;}}
    else{
      if(info.status==='failed'||info.status==='cancelled')throw new Error(info.error||'远端生成失败或取消');
      job.status=terminal?'downloading':info.status;await record(job);
      if(terminal)break;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  const transferStart=Date.now(),controller=new AbortController(),temp=path.join(media,job.id+'.part');downloads.set(job.id,controller);
  let src;
  try{
    const response=await mediaContent(job,info.result,data,AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]));
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim();
    const imageExtensions={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'};
    const ext=job.input.kind==='image'?imageExtensions[mime]:['video/mp4','application/octet-stream'].includes(mime)?'.mp4':null;
    if(!ext)throw new Error('媒体服务返回的文件类型与请求不符');
    let bytes=0,head=Buffer.alloc(0);
    const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>(job.input.kind==='image'?40:250)*1024*1024)return callback(new Error('生成素材超过大小限制'));if(head.length<32)head=Buffer.concat([head,chunk]).subarray(0,32);callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(temp));
    if(job.input.kind==='image'?imageMime(head)!==mime:head.length<12||head.toString('ascii',4,8)!=='ftyp')throw new Error('生成素材格式校验失败');
    if(job.status==='cancelled')return;
    const filename=job.id+ext;await rename(temp,path.join(media,filename));src='/media/'+filename;
  }finally{downloads.delete(job.id);await unlink(temp).catch(()=>{});}
  if(job.status==='cancelled'){if(src)await unlink(path.join(data,src)).catch(()=>{});return;}
  job.src=src;job.status='completed';job.finishedAt=Date.now();job.progress=100;
  job.timings={...job.timings,remoteElapsedMs:transferStart-job.submittedAt,transferMs:Date.now()-transferStart,serverTotalMs:Date.now()-job.startedAt};
  await record(job);
}
app.delete('/api/jobs/:id',async(req,res)=>{
  const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:'任务不存在'});
  if(!['completed','failed','cancelled'].includes(job.status)){
    job.status='cancelled';job.finishedAt=Date.now();
    job.error=job.input.provider&&job.input.provider!=='colab'?'已停止接收结果；远端生成可能继续并消耗服务商额度。':'已停止接收结果；SGLang 已提交的 GPU 任务可能继续运行。';
    downloads.get(job.id)?.abort();await record(job);
  }
  res.json(publicJob(job));
});
for(const job of jobs.values()){
  if(!active(job))continue;
  if(job.remoteId&&job.connection)launch(job);
  else {job.status='failed';job.finishedAt=Date.now();job.error='本地服务在提交阶段重启，无法确认远端是否接收；为避免重复生成，没有自动重试。';await record(job);}
}
await drainCanvases.startCleanup();
app.post('/api/chat',async(req,res)=>{activeAgentRequests++;checkIdle();try{res.json(await agentChat(data,req.body));}finally{activeAgentRequests--;checkIdle();}});
app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
if(process.argv.includes('--production'))app.use(express.static(path.join(root,'dist')));
else{const {createServer:createViteServer}=await import('vite');vite=await createViteServer({root,server:{middlewareMode:true,hmr:{server}},appType:'spa'});app.use(vite.middlewares);}
app.use((error,req,res,next)=>{console.error(error.message);if(!res.headersSent)res.status(error.status||400).json({error:error.message||'请求失败'});});
async function shutdown(reason){
  if(closing)return;closing=true;clearTimeout(idleTimer);stopping.abort();
  for(const controller of downloads.values())controller.abort();
  for(const stream of listeners)stream.end();listeners.clear();
  const closed=new Promise(resolve=>server.close(resolve));
  const forceClose=setTimeout(()=>server.closeAllConnections(),1500);
  await Promise.all([closed,stopCodexChildren(),stopAgentCliChildren(),vite?.close(),persist.catch(()=>{}),drainCanvases()]);
  await saveJSON(path.join(data,'last-shutdown.json'),{reason,stoppedAt:Date.now(),instanceId}).catch(()=>{});
  clearTimeout(forceClose);console.log(`TapNow Local stopped: ${reason}`);process.exit(0);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{shutdown(signal).catch(error=>{console.error(error.message);process.exit(1);});});
server.listen(port,'127.0.0.1',()=>{listening=true;console.log(`TapNow Local: http://127.0.0.1:${server.address().port}`);checkIdle();});
