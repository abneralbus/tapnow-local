import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generationRequest} from '../server/media-request.mjs';
import {submitMedia,pollMedia,flowErrorMessage,mediaContent,flowPayload,providerStatus,mediaConnection,imageMime} from '../server/media-providers.mjs';

test('generation validation rejects unsupported media modes instead of silently dropping references',()=>{
  const image={src:'/media/first.png',role:'reference'},start={...image,role:'start'},end={src:'/media/end.png',role:'end'};
  const flowVideo={provider:'flow',kind:'video',model:'veo-fast',prompt:'move',mode:'frames',duration:8,references:[start]};
  assert.equal(generationRequest(flowVideo).duration,8);
  for(const patch of [{references:[start,end]},{duration:4},{references:[],mode:'text'},{references:[start,start],mode:'reference'},{aspectRatio:'1:1'}])assert.throws(()=>generationRequest({...flowVideo,...patch}));
  assert.throws(()=>generationRequest({...flowVideo,model:'omni',duration:5}));
  assert.throws(()=>generationRequest({...flowVideo,model:'omni'}),/参考图模式/);
  assert.throws(()=>generationRequest({...flowVideo,mode:'reference',references:[image]}),/首帧模式/);
  assert.throws(()=>generationRequest({...flowVideo,provider:'muse',model:'muse-video',duration:4}),/不能锁定首尾帧/);
  assert.equal(generationRequest({provider:'colab',prompt:'move',references:[image],mode:'reference'}).references[0].type,'image');
  assert.throws(()=>generationRequest({provider:'muse',kind:'image',prompt:'x',references:Array.from({length:5},(_,i)=>({src:`/media/${i}.png`,role:'reference'}))}));
  assert.throws(()=>generationRequest({provider:'muse',kind:'image',prompt:'x',references:[{src:'https://other.example/private.png'}]}));
  assert.throws(()=>generationRequest({provider:'muse',kind:'image',prompt:'x',model:'unsupported'}));
  assert.equal(generationRequest({provider:'flow',kind:'image',prompt:'x',references:[image,image]}).references.length,1);
  assert.equal(flowPayload(generationRequest({provider:'flow',kind:'image',prompt:'x',aspectRatio:'1:1'}),'project',[]).params.aspect_ratio,'IMAGE_ASPECT_RATIO_SQUARE');
});

test('Flow and Muse local HTTP contracts, references, results, and credential boundaries',async t=>{
  // Header-only bytes are protocol fixtures; these tests do not claim image/video generation.
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
  const data=await mkdtemp(path.join(tmpdir(),'tapnow-providers-'));await mkdir(path.join(data,'media'));
  await writeFile(path.join(data,'media','first.png'),png);await writeFile(path.join(data,'media','second.png'),png);
  await writeFile(path.join(data,'media','bad.png'),'not an image');
  await writeFile(path.join(data,'media','too-large.png'),png);await truncate(path.join(data,'media','too-large.png'),21*1024*1024);
  const calls=[],uploads=[];let museDriver={driver:'browser',ok:true},museError=null,flowProject='project-42',nextId=40,externalHits=0;
  const external=createServer((req,res)=>{externalHits++;res.end('must not receive a credential');});
  await new Promise((resolve,reject)=>{external.on('error',reject);external.listen(0,'127.0.0.1',resolve);});
  const externalUrl=`http://127.0.0.1:${external.address().port}`;
  const fixture=createServer(async(req,res)=>{
    let bytes=Buffer.alloc(0);for await(const chunk of req)bytes=Buffer.concat([bytes,chunk]);
    const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    calls.push({method:req.method,url:req.url,authorization:req.headers.authorization,body:bytes.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(bytes):null});
    if(req.url==='/api/health')return json({ok:true,extension_connected:true});
    if(req.url==='/api/flow/projects/pinned')return json({flow_project_id:flowProject});
    if(req.url==='/readyz')return json({ready:true,driver:museDriver});
    if(req.url==='/v1/models')return json({data:[{id:'muse-image'},{id:'muse-video'}]});
    if(req.url==='/api/upload'){
      const form=await new Request('http://fixture/upload',{method:'POST',headers:req.headers,body:bytes}).formData(),file=form.get('file');
      uploads.push({project:form.get('project_id'),name:file.name,type:file.type,bytes:Buffer.from(await file.arrayBuffer())});
      return json({media_id:'ref-'+uploads.length});
    }
    if(req.url==='/api/requests'&&req.method==='POST')return json({id:++nextId});
    if(req.url.startsWith('/api/requests/'))return json({status:'done',result:{media_entries:[{media_id:'flow-result'}]}});
    if(req.url==='/v1/images/generations'&&req.method==='POST')return json({id:'muse-image-job'});
    if(req.url==='/v1/videos'&&req.method==='POST')return json({id:'muse-video-job'});
    if(req.url==='/v1/images/generations/muse-image-job')return json(museError?{status:'failed',error:museError}:{status:'succeeded',result:{data:[{url:'/v1/media/image-result'}]}});
    if(req.url==='/v1/videos/muse-video-job')return json({status:'succeeded',result:{url:'/v1/media/video-result'}});
    if(req.url==='/v1/media/redirect'){res.writeHead(302,{Location:externalUrl+'/v1/media/stolen'});res.end();return;}
    if(req.url.startsWith('/media/')||req.url.startsWith('/v1/media/')){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
    return json({error:'unknown fixture route'},404);
  });
  await new Promise((resolve,reject)=>{fixture.on('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${fixture.address().port}`,connection={bridgeUrl:base,museUrl:base};
  const keys=['FLOWBOARD_BASE_URL','MUSE2API_BASE_URL','MUSE2API_API_KEY'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{FLOWBOARD_BASE_URL:base,MUSE2API_BASE_URL:base,MUSE2API_API_KEY:'fixture-muse-key'});
  t.after(async()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}await Promise.all([new Promise(resolve=>fixture.close(resolve)),new Promise(resolve=>external.close(resolve))]);await rm(data,{recursive:true,force:true});});
  const input=patch=>generationRequest({provider:'flow',kind:'image',prompt:'an orange fox',...patch});
  const refs=[{src:'/media/first.png',role:'reference'},{src:'/media/second.png',role:'reference'}];
  const start=[{...refs[0],role:'start'}];
  const job=(input,remoteId)=>({input,remoteId,connection});
  const lastBody=route=>calls.filter(call=>call.url===route&&call.method==='POST').at(-1).body;

  const state=await providerStatus(data);assert.equal(state.bridge.connected,true);assert.equal(state.bridge.projectConfigured,true);assert.equal(state.muse.connected,true);assert.equal(state.muse.driver,'browser');
  // Migrated projects resolve their private key relative to data/, while old absolute paths remain valid.
  await writeFile(path.join(data,'local-key'),'fixture-muse-key');
  delete process.env.MUSE2API_API_KEY;
  for(const museKeyFile of ['local-key',path.join(data,'local-key')]){
    await writeFile(path.join(data,'media-bridge.json'),JSON.stringify({museEnabled:true,musePaused:false,museKeyFile}));
    assert.equal((await providerStatus(data)).muse.connected,true);
  }
  process.env.MUSE2API_API_KEY='fixture-muse-key';
  museDriver={driver:'mock',ok:true};assert.equal((await providerStatus(data)).muse.connected,false);museDriver={driver:'browser',ok:true};
  const flowImage=input({model:'NANO_BANANA_2',references:refs});const flowId=await submitMedia(flowImage,data,connection);
  assert.equal(flowId,'41');assert.equal(uploads.length,2);assert.equal(uploads[0].project,'project-42');assert.equal(uploads[0].type,'image/png');assert.deepEqual(uploads[0].bytes,png);
  assert.deepEqual(lastBody('/api/requests'),{node_id:null,type:'gen_image',params:{media_provider:'flow',project_id:'project-42',prompt:'an orange fox',variant_count:1,aspect_ratio:'IMAGE_ASPECT_RATIO_LANDSCAPE',image_model:'NANO_BANANA_2',ref_media_ids:['ref-1','ref-2']}});
  const flowResult=await pollMedia(job(flowImage,flowId),data);assert.equal(flowResult.status,'completed');
  assert.deepEqual(Buffer.from(await(await mediaContent(job(flowImage,flowId),flowResult.result,data)).arrayBuffer()),png);
  assert.ok(calls.filter(call=>call.url.startsWith('/api/')||call.url.startsWith('/media/')).every(call=>!call.authorization));

  await submitMedia(input({kind:'video',model:'veo-fast',mode:'frames',duration:8,references:start,aspectRatio:'9:16'}),data,connection);
  assert.deepEqual(lastBody('/api/requests').params,{media_provider:'flow',project_id:'project-42',prompt:'an orange fox',variant_count:1,aspect_ratio:'VIDEO_ASPECT_RATIO_PORTRAIT',start_media_id:'ref-3',video_quality:'fast'});
  await submitMedia(input({kind:'video',model:'omni',duration:6,references:refs}),data,connection);
  assert.equal(lastBody('/api/requests').type,'gen_video_omni');assert.equal(lastBody('/api/requests').params.duration_s,6);assert.deepEqual(lastBody('/api/requests').params.ref_media_ids,['ref-4','ref-5']);

  const museImage=input({provider:'muse',model:'muse-image',aspectRatio:'1:1',references:refs});const museId=await submitMedia(museImage,data,connection);
  const imageBody=lastBody('/v1/images/generations');assert.equal(imageBody.async,true);assert.equal(imageBody.n,1);assert.equal(imageBody.size,'1:1');assert.equal(imageBody.response_format,'url');assert.deepEqual(imageBody.image,[1,2].map(()=>`data:image/png;base64,${png.toString('base64')}`));
  const museResult=await pollMedia(job(museImage,museId),data);assert.equal(museResult.status,'completed');
  await mediaContent(job(museImage,museId),museResult.result,data);
  assert.equal(calls.find(call=>call.url==='/v1/media/image-result').authorization,'Bearer fixture-muse-key');
  for(const [code,expected] of [['upstream_access_unavailable',/没有可用的创作环境/],['upstream_auth_failed',/登录会话已失效/],['upstream_timeout',/生成超时/],['unknown',/检查媒体服务日志/]]){
    museError={code,message:'private upstream response must not leak'};
    const failed=await pollMedia(job(museImage,museId),data);
    assert.equal(failed.status,'failed');assert.match(failed.error,expected);assert.doesNotMatch(failed.error,/private upstream/);
  }
  museError=null;
  // The private adapter can encode this field; the public validator rejects Muse frame locking.
  const museVideo={...input({provider:'muse',kind:'video',model:'muse-video',duration:4}),mode:'frames',references:start};
  const videoId=await submitMedia(museVideo,data,connection);assert.equal(typeof lastBody('/v1/videos').image,'string');assert.equal(lastBody('/v1/videos').reference_images,undefined);assert.equal(lastBody('/v1/videos').duration,4);
  const videoResult=await pollMedia(job(museVideo,videoId),data);assert.equal(videoResult.status,'completed');await mediaContent(job(museVideo,videoId),videoResult.result,data);
  await submitMedia(input({provider:'muse',kind:'video',model:'muse-video',duration:6,references:refs}),data,connection);assert.equal(lastBody('/v1/videos').reference_images.length,2);assert.equal(lastBody('/v1/videos').image,undefined);
  await submitMedia(input({provider:'muse',kind:'video',model:'muse-video',duration:4}),data,connection);assert.equal(lastBody('/v1/videos').reference_images,undefined);

  for(const src of ['/media/bad.png','/media/missing.png','/media/too-large.png'])await assert.rejects(()=>submitMedia(input({references:[{src,role:'reference'}]}),data,connection));
  assert.equal(imageMime(Buffer.from('<html>')),null);
  const before=calls.length;
  await assert.rejects(()=>mediaContent(job(museImage,museId),{data:[{url:externalUrl+'/v1/media/stolen'}]},data),/拒绝携带凭据/);
  await assert.rejects(()=>mediaContent(job(museVideo,videoId),{url:base+'/admin'},data),/拒绝携带凭据/);
  assert.equal(calls.length,before,'rejected result URLs must not cause a credentialed request');
  await assert.rejects(()=>mediaContent(job(museImage,museId),{data:[{url:'/v1/media/redirect'}]},data));assert.equal(externalHits,0,'redirects must not leak the Muse key');
  await assert.rejects(()=>mediaContent(job(flowImage,flowId),{},data),/没有返回可下载/);
  flowProject=null;await assert.rejects(()=>submitMedia(input({}),data,connection),/未配置项目/);
  process.env.FLOWBOARD_BASE_URL='https://external.example';assert.throws(mediaConnection,/本机 HTTP/);
});

test('Flow failures preserve the real code and explain the cause',()=>{
  assert.match(flowErrorMessage('PUBLIC_ERROR_MINOR'),/未成年人.*PUBLIC_ERROR_MINOR/);
  assert.match(flowErrorMessage('timeout_waiting_video'),/未自动重新生成/);
  assert.equal(flowErrorMessage('new_upstream_error'),'new_upstream_error');
});
