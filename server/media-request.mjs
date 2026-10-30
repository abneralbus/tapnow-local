import {referencePrompt} from '../shared/reference-prompt.mjs';
import {videoRequest} from './validation.mjs';

export const providerCatalog=[
  {id:'colab',label:'MiniMax H3 · Colab',imageModels:[],videoModels:[{id:'MiniMaxAI/MiniMax-H3',label:'MiniMax H3 标准'}]},
  {id:'flow',label:'Google Flow',imageModels:[{id:'NANO_BANANA_PRO',label:'Nano Banana Pro'},{id:'NANO_BANANA_2',label:'Nano Banana 2'},{id:'NANO_BANANA_2_1',label:'Nano Banana 2.1'},{id:'NANO_BANANA_2_LITE',label:'Nano Banana 2 Lite'}],videoModels:[{id:'veo-fast',label:'Veo 3.1 Fast · 首帧'},{id:'omni',label:'Omni Flash · 多图参考'}]},
  {id:'muse',label:'Muse',imageModels:[{id:'muse-image',label:'Muse Image'}],videoModels:[{id:'muse-video',label:'Muse Video'}]}
];
export function generationRequest(body){
  if(!body||typeof body!=='object')throw new Error('生成请求无效');
  const provider=body.provider??'colab',kind=body.kind??'video';
  const catalog=providerCatalog.find(p=>p.id===provider);
  if(!catalog||!['image','video'].includes(kind))throw new Error('生成服务商或类型无效');
  const models=kind==='image'?catalog.imageModels:catalog.videoModels;
  const model=body.model||models[0]?.id;
  if(!models.some(m=>m.id===model))throw new Error('当前服务商不支持所选模型或生成类型');
  const prompt=typeof body.prompt==='string'?body.prompt.trim():'';
  if(!prompt||prompt.length>12000)throw new Error('提示词需要 1–12000 个字符');
  const raw=body.references??[];
  if(!Array.isArray(raw)||raw.length>8)throw new Error('最多支持 8 张参考图片');
  const references=[];
  for(const item of raw){
    if(!item||typeof item.src!=='string'||!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/.test(item.src)||!['reference','start','end'].includes(item.role??'reference'))throw new Error('参考图片必须来自本地画布素材库');
    if(item.label!==undefined&&(typeof item.label!=='string'||item.label.length>100||/[\r\n]/.test(item.label)))throw new Error('参考图名称无效');
    if(item.nodeId!==undefined&&typeof item.nodeId!=='string')throw new Error('参考节点 ID 无效');
    const ref={src:item.src,role:item.role??'reference',...(item.nodeId?{nodeId:item.nodeId}:{}),...(item.label?{label:item.label}:{})};
    if(!references.some(r=>r.src===ref.src&&r.role===ref.role))references.push(ref);
  }
  if(provider==='muse'&&kind==='image'&&references.length>4)throw new Error('Muse 图片最多支持 4 张参考图');
  const mode=body.mode??(references.length?'reference':'text');
  if(!['text','reference','frames'].includes(mode))throw new Error('生成模式无效');
  if(mode==='text'&&references.length)throw new Error('文字模式不能携带图片；请选择参考图或首尾帧模式');
  if(mode==='reference'&&(!references.length||references.some(r=>r.role!=='reference')))throw new Error('参考图模式需要至少一张参考图片');
  if(mode==='frames'&&(kind!=='video'||references.filter(r=>r.role==='start').length!==1||references.some(r=>r.role==='reference')))throw new Error('首尾帧模式需要一张明确的首帧');
  if(references.some(r=>r.role==='end'))throw new Error('尾帧接口尚未适配，当前不会忽略尾帧提交；请移除尾帧后使用首帧生成');
  const aspectRatio=body.aspectRatio??'16:9';
  if(!['16:9','9:16','1:1'].includes(aspectRatio))throw new Error('画幅比例无效');
  if(kind==='video'&&aspectRatio==='1:1')throw new Error('当前视频接口支持 16:9 或 9:16');
  const offset=(body.prompt||'').length-(body.prompt||'').trimStart().length;
  const mentions=body.mentions===undefined?[]:Array.isArray(body.mentions)?body.mentions.map(m=>({...m,start:m?.start-offset,end:m?.end-offset})):null;
  const compiled=referencePrompt(prompt,references,mentions);
  if(provider==='colab'){
    if(mode!=='text'||references.length)throw new Error('当前 Colab H3 尚未接通图片参考；请使用文字生视频或切换服务商');
    if(aspectRatio!=='16:9')throw new Error('当前 Colab H3 只接通 16:9');
    return {...videoRequest({...body,prompt:compiled}),provider,kind,model,mode,references,aspectRatio};
  }
  const duration=Number(body.duration??(provider==='flow'?8:4));
  if(kind==='video'&&(!Number.isInteger(duration)||duration<4||duration>15))throw new Error('视频时长应为 4–15 秒');
  if(provider==='muse'&&mode==='frames')throw new Error('当前 Muse 接入只能使用图片参考，尚不能锁定首尾帧；请切换参考图模式');
  if(provider==='flow'&&kind==='video'){
    if(model==='omni'&&mode!=='reference')throw new Error('Omni 当前仅接通参考图模式，首尾帧接口尚未适配');
    if(model!=='omni'&&mode!=='frames')throw new Error('Veo 当前接通首帧模式，请切换首尾帧并指定首帧');
    if(!references.length)throw new Error('当前 Flow 视频接入需要首帧或参考图；纯文字视频可选 Muse 或 Colab');
    if(model==='omni'&&![4,6,8,10].includes(duration))throw new Error('Omni 支持 4、6、8、10 秒');
    if(model!=='omni'&&references.length!==1)throw new Error('Veo 首帧模式仅支持一张图片；多图请选 Omni');
    if(model!=='omni'&&duration!==8)throw new Error('当前 Veo 接入使用默认时长（约 8 秒），暂不支持指定其他时长');
  }
  return {provider,kind,model,prompt:compiled,mode,references,aspectRatio,duration};
}
