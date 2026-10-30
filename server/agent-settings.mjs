import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export const agentProviders=[
  {id:'codex-cli',name:'Codex CLI',kind:'cli'},
  {id:'claude-cli',name:'Claude CLI',kind:'cli'},
  {id:'agy-cli',name:'agy CLI',kind:'cli'},
  {id:'deepseek',name:'DeepSeek',kind:'api',protocol:'chat',baseUrl:'https://api.deepseek.com',keyEnv:'DEEPSEEK_API_KEY',modelEnv:'DEEPSEEK_MODEL',baseEnv:'DEEPSEEK_BASE_URL',model:'deepseek-chat'},
  {id:'openai',name:'OpenAI',kind:'api',protocol:'responses',baseUrl:'https://api.openai.com/v1',keyEnv:'OPENAI_API_KEY',modelEnv:'OPENAI_MODEL',baseEnv:'OPENAI_BASE_URL'},
  {id:'anthropic',name:'Anthropic / Claude',kind:'api',protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1',keyEnv:'ANTHROPIC_API_KEY',modelEnv:'ANTHROPIC_MODEL',baseEnv:'ANTHROPIC_BASE_URL'},
  {id:'gemini',name:'Google Gemini',kind:'api',protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',keyEnv:'GEMINI_API_KEY',modelEnv:'GEMINI_MODEL',baseEnv:'GEMINI_BASE_URL'},
  {id:'compatible',name:'兼容 OpenAI 的 API',kind:'api',protocol:'chat',baseUrl:''}
];
const failure=message=>Object.assign(new Error(message),{status:400});
export function agentEndpoint(value){
  try{const u=new URL(value);if(u.username||u.password||u.hash||u.search||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error();return u.toString().replace(/\/$/,'');}
  catch{throw failure('API 基础地址须为 HTTPS，本机服务可用 HTTP；不要在地址中填写 Key。');}
}
export async function readAgentSettings(directory){
  if(directory){try{return JSON.parse(await readFile(path.join(directory,'agent-config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {provider:process.env.DEEPSEEK_API_KEY?'deepseek':'codex-cli',profiles:{}};
}
export function resolvedAgent(settings,id=settings.provider){
  const provider=agentProviders.find(p=>p.id===id);if(!provider)throw failure('不支持的 Agent 服务');
  const profile=settings.profiles?.[id]||{};
  return {...provider,baseUrl:profile.baseUrl??process.env[provider.baseEnv]??provider.baseUrl??'',model:profile.model??process.env[provider.modelEnv]??provider.model??'',apiKey:Object.hasOwn(profile,'apiKey')?profile.apiKey:(process.env[provider.keyEnv]||'')};
}
let writes=Promise.resolve();
export function writeAgentSettings(directory,body){
  const operation=writes.then(async()=>{
    if(!body||!agentProviders.some(p=>p.id===body.provider))throw failure('请选择有效的 Agent 服务');
    if(body.clearKey!==undefined&&typeof body.clearKey!=='boolean')throw failure('清除 Key 选项格式错误');
    const current=await readAgentSettings(directory),old=resolvedAgent(current,body.provider),profile={...(current.profiles?.[body.provider]||{})};
    if(typeof body.model!=='string'||body.model.length>150||/[\r\n\x00]/.test(body.model))throw failure('模型名称格式错误');
    profile.model=body.model.trim();
    if(old.kind==='api'){
      if(!profile.model)throw failure('请填写该 API 的模型名称');
      profile.baseUrl=agentEndpoint(body.baseUrl);
      if(body.apiKey!==undefined&&(typeof body.apiKey!=='string'||body.apiKey.length>4096||/[\r\n\x00]/.test(body.apiKey)))throw failure('API Key 格式错误');
      if(profile.baseUrl!==old.baseUrl&&old.apiKey&&!body.apiKey?.trim()&&!body.clearKey)throw failure('更换 API 地址时请重新填写 Key，避免把旧 Key 发到另一个服务。');
      if(body.clearKey)profile.apiKey='';else if(body.apiKey?.trim())profile.apiKey=body.apiKey.trim();
    }
    const next={...current,provider:body.provider,profiles:{...current.profiles,[body.provider]:profile}};
    await mkdir(directory,{recursive:true});const file=path.join(directory,'agent-config.json'),temp=file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file);return next;
  });writes=operation.catch(()=>{});return operation;
}
