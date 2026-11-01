import {agentPolicy,canvasSystemContext} from './agent-policy.mjs';
import {permissions,actionInstructions,decodeActions} from '../shared/agent-actions.mjs';
import {createHash} from 'node:crypto';
import {codexAvailable,codexChat} from './codex.mjs';
import {cliAvailable,agentCliChat} from './agent-cli.mjs';
import {agentProviders,readAgentSettings,resolvedAgent,agentEndpoint} from './agent-settings.mjs';
const instructions='你是创意画布助手，帮助用户编写视频提示词、分镜和创作建议。依据提供的画布文字和历史对话保持上下文，不声称已经生成视频。\n'+agentPolicy;
const last=new Map();
const signature=p=>createHash('sha256').update(JSON.stringify([p.id,p.baseUrl,p.model,p.apiKey])).digest('hex');
export async function agentConfiguration(directory){
  const settings=await readAgentSettings(directory),selected=resolvedAgent(settings);
  const installed={'codex-cli':await codexAvailable(),'claude-cli':await cliAvailable('claude-cli'),'agy-cli':await cliAvailable('agy-cli')};
  const options=agentProviders.map(p=>{const value=resolvedAgent(settings,p.id);return {id:p.id,name:p.name,kind:p.kind,protocol:p.protocol,baseUrl:value.baseUrl,model:value.model,hasKey:!!value.apiKey,available:p.kind==='cli'?installed[p.id]:!!(value.apiKey&&value.model&&value.baseUrl)};});
  const option=options.find(p=>p.id===selected.id),state=last.get(signature(selected));
  return {hasDeepSeek:options.find(p=>p.id==='deepseek').hasKey,hasCodex:installed['codex-cli'],hasAgent:option.available,
    agentProvider:selected.id,agentOptions:options,agentModel:selected.name,
    agentStatus:state?.status||(option.available?'available':'unavailable'),agentError:state?.error};
}

export function agentRequest(body){
  if(!body||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>16000)throw Object.assign(new Error('请输入 1–16000 字的内容。'),{status:400});
  if(body.context!==undefined&&typeof body.context!=='string')throw Object.assign(new Error('画布参考内容应为文本。'),{status:400});
  const incoming=body.history??[];
  if(!Array.isArray(incoming)||incoming.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'))throw Object.assign(new Error('对话历史格式错误。'),{status:400});
  let remaining=32000;const history=[];
  for(const message of incoming.slice(-20).reverse()){
    if(!remaining)break;
    const text=message.text.slice(-remaining);remaining-=text.length;history.unshift({role:message.role,text});
  }
  return {prompt:body.prompt.trim(),context:body.context||'',history};
}

export function apiRequest(provider,prompt,context,history,protocolInstructions=''){
  const system=instructions+protocolInstructions+canvasSystemContext(context);
  const base=agentEndpoint(provider.baseUrl),messages=[...history.map(m=>({role:m.role,content:m.text})),{role:'user',content:prompt}];
  const headers={'Content-Type':'application/json'};let url,body;
  if(provider.protocol==='anthropic'){
    url=base+'/messages';headers['x-api-key']=provider.apiKey;headers['anthropic-version']='2023-06-01';body={model:provider.model,system,messages,max_tokens:4096};
  }else if(provider.protocol==='gemini'){
    url=base+'/models/'+encodeURIComponent(provider.model.replace(/^models\//,''))+':generateContent';headers['x-goog-api-key']=provider.apiKey;
    body={systemInstruction:{parts:[{text:system}]},contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:8192}};
  }else if(provider.protocol==='responses'){
    url=base+'/responses';headers.Authorization=`Bearer ${provider.apiKey}`;body={model:provider.model,instructions:system,input:messages,store:false};
  }else{
    url=base+'/chat/completions';headers.Authorization=`Bearer ${provider.apiKey}`;body={model:provider.model,messages:[{role:'system',content:system},...messages],stream:false};
  }
  return {url,options:{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)}};
}
export function apiText(protocol,result){
  let text;if(protocol==='anthropic')text=result.content?.filter(v=>v.type==='text').map(v=>v.text).join('\n');
  else if(protocol==='gemini')text=result.candidates?.[0]?.content?.parts?.filter(v=>typeof v.text==='string'&&!v.thought).map(v=>v.text).join('\n');
  else if(protocol==='responses')text=result.output?.filter(v=>v.type==='message').flatMap(v=>v.content||[]).filter(v=>v.type==='output_text').map(v=>v.text).join('\n');
  else text=result.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw new Error('文本模型没有返回正文，请检查模型名称和输出限制。');return text.trim();
}
export async function agentChat(dataDirectory,body){
  let {prompt,context,history}=agentRequest(body);const actionMode=body.permissions!==undefined,grants=permissions(body.permissions);const protocolInstructions=actionMode?actionInstructions(grants):'';const settings=await readAgentSettings(dataDirectory),provider=resolvedAgent(settings),model=provider.name;
  try{
    let text;
    if(provider.id==='codex-cli')text=await codexChat(dataDirectory,prompt,context,history,provider.model,protocolInstructions);
    else if(provider.kind==='cli')text=await agentCliChat(dataDirectory,provider.id,provider.model,prompt,context,history,protocolInstructions);
    else{
      if(!provider.apiKey||!provider.model||!provider.baseUrl)throw Object.assign(new Error('请先在模型连接中填写 API 地址、模型名和 Key。'),{status:400});
      const {url,options}=apiRequest(provider,prompt,context,history,protocolInstructions),response=await fetch(url,options);
      if(!response.ok)throw new Error(response.status===401||response.status===403?`${model} Key 无效或没有模型权限，请更新配置。`:response.status===429?`${model} 额度或速率受限，请稍后重试。`:`${model} 服务返回 ${response.status}，请检查模型与地址。`);
      text=apiText(provider.protocol,await response.json());
    }
    last.set(signature(provider),{status:'verified'});return actionMode?{...decodeActions(text.trim(),grants),model}:{text:text.trim(),model};
  }catch(error){
    const message=error.name==='TimeoutError'?'文本模型超时（120 秒），请稍后重试。':error instanceof SyntaxError?'文本模型返回了无效响应，请稍后重试。':error instanceof TypeError?'文本模型连接失败，请检查本机网络。':error.message;
    last.set(signature(provider),{status:'error',error:message});throw Object.assign(new Error(message),{status:error.status||502});
  }
}
