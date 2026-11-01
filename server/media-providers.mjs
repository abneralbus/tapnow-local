import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {providerCatalog} from './media-request.mjs';

const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function localBase(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('媒体桥接服务必须使用本机 HTTP 地址');return u.origin;}
export function mediaConnection(){return {bridgeUrl:localBase(process.env.FLOWBOARD_BASE_URL||'http://127.0.0.1:8434'),museUrl:localBase(process.env.MUSE2API_BASE_URL||'http://127.0.0.1:18610')};}
async function museKey(data){
  if(process.env.MUSE2API_API_KEY)return process.env.MUSE2API_API_KEY;
  try{const config=JSON.parse(await readFile(path.join(data,'media-bridge.json'),'utf8'));if(config.museKeyFile)return (await readFile(path.resolve(data,config.museKeyFile),'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw new Error('Muse 本地凭据配置无法读取');}
  throw new Error('Muse 未配置本地访问密钥，请启动媒体桥接服务');
}
async function request(base,route,options={},key){
  let response;
  try{response=await fetch(base+route,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(20000),headers:{...options.headers,...(key?{Authorization:`Bearer ${key}`}:{})}});}catch(e){throw new Error(e.name==='TimeoutError'?'媒体服务响应超时；请检查服务日志，勿重复提交未确认的生成':'媒体桥接服务连接失败，请运行 npm run media 并保持服务运行');}
  if(!response.ok)throw new Error(`媒体服务返回 ${response.status}${[401,403].includes(response.status)?'：登录或本地访问密钥失效':response.status===503?'：服务尚未就绪':''}`);
  return response;
}
export async function providerStatus(data){
  const connection=mediaConnection();
  const [bridge,muse]=await Promise.all([
    (async()=>{try{const r=await(await request(connection.bridgeUrl,'/api/health',{signal:AbortSignal.timeout(2500)})).json();const p=await(await request(connection.bridgeUrl,'/api/flow/projects/pinned',{signal:AbortSignal.timeout(2500)})).json();return {connected:!!r.ok,extensionConnected:!!r.extension_connected,projectConfigured:!!p.flow_project_id,error:!r.extension_connected?'请在 Chrome 打开已登录的 Flow 页面并启用连接助手':!p.flow_project_id?'请在 Flowboard 桥接配置中指定 Flow 项目':undefined};}catch(e){return {connected:false,extensionConnected:false,error:e.message};}})(),
    (async()=>{try{try{const state=JSON.parse(await readFile(path.join(data,'media-bridge.json'),'utf8'));if(state.musePaused)return {connected:false,paused:true,error:'Muse 已暂停；恢复前先调整 proxy 规则'};}catch(e){if(e.code!=='ENOENT')throw e;}const r=await(await request(connection.museUrl,'/readyz',{signal:AbortSignal.timeout(2500)})).json();const key=await museKey(data);await request(connection.museUrl,'/v1/models',{signal:AbortSignal.timeout(2500)},key);const connected=!!r.ready&&r.driver?.driver==='browser'&&r.driver?.ok===true;return {connected,driver:r.driver?.driver,error:connected?undefined:'Muse 尚未登录或使用了模拟驱动'};}catch(e){return {connected:false,error:e.message};}})()
  ]);
  return {bridge,muse,providers:providerCatalog};
}
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
async function imageBytes(data,src,maxMB=20){
  if(!/^\/media\/[\w-]+\.(png|jpe?g|webp|gif)$/.test(src))throw new Error('无效参考图片地址');
  const file=path.join(data,src);const info=await stat(file).catch(()=>{throw new Error('参考图片已不存在，请重新上传');});
  if(info.size>maxMB*1024*1024)throw new Error(`单张参考图片不能超过 ${maxMB} MB`);
  const bytes=await readFile(file);const mime=imageMime(bytes);
  if(!mime||mime!==imageTypes[path.extname(file)])throw new Error('参考图片内容与格式不符');
  return {bytes,mime};
}
export function imageMime(bytes){
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(bytes.length>=10&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return 'image/gif';
  return null;
}
export function flowPayload(input,projectId,mediaIds){
  const orientation=input.aspectRatio==='9:16'?'PORTRAIT':input.aspectRatio==='1:1'?'SQUARE':'LANDSCAPE';
  const params={media_provider:'flow',project_id:projectId,prompt:input.prompt,variant_count:1,aspect_ratio:`${input.kind==='image'?'IMAGE':'VIDEO'}_ASPECT_RATIO_${orientation}`};
  let type;
  if(input.kind==='image'){type='gen_image';params.image_model=input.model;params.ref_media_ids=mediaIds;}
  else if(input.model==='omni'){type='gen_video_omni';params.ref_media_ids=mediaIds;params.duration_s=input.duration;}
  else{type='gen_video';params.start_media_id=mediaIds[0];params.video_quality='fast';}
  return {node_id:null,type,params};
}
export async function submitMedia(input,data,connection){
  if(input.provider==='flow'){
    const project=await(await request(connection.bridgeUrl,'/api/flow/projects/pinned')).json();
    if(!project.flow_project_id)throw new Error('Flow 未配置项目，请先设置已有 Flow 项目');
    const ids=[];
    for(const ref of input.references){const {bytes,mime}=await imageBytes(data,ref.src,10);const form=new FormData();form.set('project_id',project.flow_project_id);form.set('file',new Blob([bytes],{type:mime}),path.basename(ref.src));const uploaded=await(await request(connection.bridgeUrl,'/api/upload',{method:'POST',body:form,signal:AbortSignal.timeout(120000)})).json();if(!uploaded.media_id)throw new Error('Flow 上传没有返回图片标识');ids.push(uploaded.media_id);}
    const r=await(await request(connection.bridgeUrl,'/api/requests',json(flowPayload(input,project.flow_project_id,ids)))).json();
    if(!Number.isSafeInteger(r.id))throw new Error('Flow 返回无效任务标识');return String(r.id);
  }
  const key=await museKey(data),images=[];
  for(const ref of input.references){const {bytes,mime}=await imageBytes(data,ref.src);images.push(`data:${mime};base64,${bytes.toString('base64')}`);}
  const body={model:input.model,prompt:input.prompt,size:input.aspectRatio};
  if(input.kind==='image')Object.assign(body,{n:1,response_format:'url',async:true,...(images.length?{image:images}:{})});
  else Object.assign(body,{duration:input.duration,...(images.length?(input.mode==='frames'?{image:images[0]}:{reference_images:images}):{})});
  const r=await(await request(connection.museUrl,input.kind==='image'?'/v1/images/generations':'/v1/videos',{...json(body),signal:AbortSignal.timeout(45000)},key)).json();
  if(typeof r.id!=='string'||!r.id||r.id.length>200)throw new Error('Muse 返回无效任务标识');return r.id;
}
export function flowErrorMessage(error){
  const code=String(error||'').slice(0,300);
  const labels={PUBLIC_ERROR_MINOR:'Flow 拒绝生成：未成年人相关安全限制，请检查参考图和提示词',CHILD_SAFETY:'Flow 拒绝生成：未成年人相关安全限制，请检查参考图和提示词',PUBLIC_ERROR_AUDIO_FILTERED:'Flow 拒绝生成：音频内容未通过审核',PUBLIC_ERROR_UNSAFE_GENERATION:'Flow 拒绝生成：内容未通过安全审核',timeout_waiting_video:'Flow 在等待期限内未完成，未自动重新生成'};
  return labels[code]?`${labels[code]}（${code}）`:code;
}
export async function pollMedia(job,data){
  const input=job.input,c=job.connection,id=encodeURIComponent(job.remoteId);
  if(input.provider==='flow'){
    const r=await(await request(c.bridgeUrl,`/api/requests/${id}`)).json();
    return {status:({queued:'queued',running:'running',done:'completed',failed:'failed',timeout:'failed',canceled:'cancelled'})[r.status]||'unknown',error:r.error?flowErrorMessage(r.error):undefined,result:r.result};
  }
  const r=await(await request(c.museUrl,`${input.kind==='image'?'/v1/images/generations':'/v1/videos'}/${id}`,{},await museKey(data))).json();
  const errors={upstream_access_unavailable:'Muse 当前会话没有可用的创作环境；请先确认 Muse 应用中的访问权限。代理连通不代表已获准使用。',upstream_auth_failed:'Muse 登录会话已失效，请重新登录后更新连接。',upstream_timeout:'Muse 生成超时，未收到素材；请先确认 Muse 创作页能正常使用。'};
  return {status:({queued:'queued',running:'running',succeeded:'completed',failed:'failed',cancelled:'cancelled'})[r.status]||'unknown',error:r.error?(errors[r.error.code]||'Muse 生成失败，请检查媒体服务日志'):undefined,result:r.result};
}
export async function mediaContent(job,result,data,signal){
  const c=job.connection;
  if(job.input.provider==='flow'){
    const id=result?.media_ids?.find(id=>typeof id==='string'&&id)||result?.media_entries?.find(e=>e.media_id)?.media_id;
    if(typeof id!=='string'||!/[a-zA-Z0-9]/.test(id)||id.length>300)throw new Error('Flow 已结束但没有返回可下载的素材');
    return request(c.bridgeUrl,`/media/${encodeURIComponent(id)}`,{signal});
  }
  const raw=job.input.kind==='image'?result?.data?.[0]?.url:result?.url;
  if(typeof raw!=='string')throw new Error('Muse 已结束但没有返回可下载的素材');
  const url=new URL(raw,c.museUrl);
  if(url.origin!==c.museUrl||!url.pathname.startsWith('/v1/media/'))throw new Error('Muse 返回了非本地缓存地址，拒绝携带凭据下载');
  return request(c.museUrl,url.pathname+url.search,{signal},await museKey(data));
}
