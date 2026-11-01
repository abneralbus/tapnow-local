import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function prepareColab(input,remote,connection,media){
  const task=input.mode==='reference'?'ref2va':input.mode==='frames'?'fl2va':'t2va';
  let session;
  try{session=await(await remote('/v1/session',{},connection)).json();}
  catch(error){if(error.upstreamStatus!==404||task!=='t2va')throw new Error('请启动新版 Colab 笔记本：'+error.message);}
  if(session&&(session.phase!=='ready'||!session.tasks?.includes(task)))throw new Error(session.phase!=='ready'?'Colab 正在释放 GPU，请重新启动会话':`请先在 Colab 选择 ${task==='ref2va'?'Ref2VA 全能参考':'FL2VA 文字／首尾帧'} 模式并启动`);
  // Apply the locally saved preference to every fresh session before uploading or generating.
  if(typeof connection.colabAutoRelease==='boolean'){
    if(!session)throw new Error('自动释放需要新版 Colab 笔记本，请先更新并启动');
    if(session.autoRelease!==connection.colabAutoRelease){
      session=await(await remote('/v1/session/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoRelease:connection.colabAutoRelease})},connection)).json();
      if(session.autoRelease!==connection.colabAutoRelease)throw new Error('Colab 未确认自动释放设置，请重新连接后再生成');
    }
  }
  const conditions=[];
  // H3 counts video soundtracks as audio references. Put explicit audio first so
  // canvas <Audio N> tags remain stable even when a video carries a soundtrack.
  const references=input.references||[];
  const ordered=task==='ref2va'?[...references.filter(r=>r.type==='audio'),...references.filter(r=>r.type!=='audio')]:references;
  for(const ref of ordered){
    const file=path.join(media,path.basename(ref.src)),size=(await stat(file)).size;
    if(!size||size>100*1024**2)throw new Error('参考素材为空或超过 100MB');
    const response=await remote('/v1/assets/'+randomUUID()+path.extname(file),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await readFile(file),signal:AbortSignal.timeout(120000)},connection);
    const {assetId}=await response.json();
    if(!/^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(assetId||''))throw new Error('Colab 返回了无效素材标识');
    conditions.push({type:ref.type,assetId,role:ref.role==='reference'?'reference':'keyframe',...(ref.role==='start'?{frame_index:0}:ref.role==='end'?{frame_index:-1}:{})});
  }
  return {sessionId:session?.sessionId,body:{model:'MiniMaxAI/MiniMax-H3',prompt:input.prompt,seconds:input.duration,task,conditions,
    target:{short_edge:input.height,aspect_ratio:input.aspectRatio||'16:9',duration_seconds:input.duration},
    num_outputs_per_prompt:1,num_inference_steps:input.steps,flow_shift:12,audio_flow_shift:3,seed:input.seed}};
}
