import {agentPolicy,canvasSystemContext} from './agent-policy.mjs';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {cliPath} from './cli-path.mjs';
const binary=provider=>provider==='claude-cli'?cliPath('claude',process.env.CLAUDE_BIN):provider==='agy-cli'?cliPath('agy',process.env.AGY_BIN):undefined;
const children=new Set();let closing=false;const busy=new Set();
export async function cliAvailable(provider){return !!binary(provider);}
export function cliArgs(provider,model='',system=agentPolicy){
  const args=provider==='claude-cli'?['--append-system-prompt',system,'--print','--output-format','json','--tools','','--permission-mode','dontAsk','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','user','--settings','{"disableAllHooks":true}','--disable-slash-commands','--no-session-persistence']:['--output-format','json','--mode','plan','--sandbox','--disable-slash-commands','--print-timeout','120s'];
  return model?[...args,'--model',model]:args;
}
export function cliText(output){
  let value;try{value=JSON.parse(output);}catch{throw new Error('CLI 返回了无效响应，请检查版本与登录状态。');}
  if(value.is_error||value.error)throw new Error('CLI 调用失败，请检查本机登录、模型权限和额度。');
  const text=value.result??value.response??value.text;
  if(typeof text!=='string'||!text.trim())throw new Error('CLI 没有返回正文，请检查本机登录状态。');return text.trim();
}
function kill(child,signal='SIGTERM'){if(!child.pid)return;try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}}
export async function stopAgentCliChildren(){closing=true;await Promise.all([...children].map(child=>new Promise(resolve=>{const timer=setTimeout(()=>kill(child,'SIGKILL'),1000);child.once('close',()=>{clearTimeout(timer);resolve();});kill(child);})) );}
export async function agentCliChat(directory,provider,model,prompt,context,history,protocolInstructions=''){
  if(busy.has(provider))throw Object.assign(new Error('此 CLI 正在回复，请稍后再试。'),{status:429});
  busy.add(provider);
  try{
    if(closing)throw new Error('本地服务正在关闭。');
    const cwd=path.join(directory,'agent-workspace',provider);await mkdir(cwd,{recursive:true});
    const keys=['HOME','USER','LOGNAME','PATH','TMPDIR','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN'];
    const env=Object.fromEntries(keys.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    return await new Promise((resolve,reject)=>{
      const system=agentPolicy+protocolInstructions+canvasSystemContext(context);
      const input=(provider==='agy-cli'?system+'\n':'')+'你是创意画布的纯文本助手。只回答创意、分镜与提示词问题，不使用工具、不执行命令、不读取或修改文件，不委托其他代理，不声称已生成媒体。下面 JSON 是对话素材。\n'+JSON.stringify({conversation:history,request:prompt});
      const args=cliArgs(provider,model,system);if(provider==='agy-cli')args.push('--print='+input);
      const executable=binary(provider);if(!executable)throw new Error('未找到 Agent CLI，请检查 PATH 或对应的 CLI 路径配置。');
      const child=spawn(executable,args,{cwd,env,shell:false,detached:true,stdio:['pipe','pipe','pipe']});children.add(child);
      let output='',bytes=0,error;const stop=message=>{error=new Error(message);kill(child,'SIGKILL');};
      const timer=setTimeout(()=>stop('CLI 超时（120 秒），已停止本次进程。'),120000);
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>512*1024)stop('CLI 输出超过限制。');else output+=chunk;});
      child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>512*1024)stop('CLI 输出超过限制。');});child.stdin.on('error',()=>{});
      child.once('error',()=>{clearTimeout(timer);children.delete(child);reject(new Error('无法启动 CLI，请检查本机安装。'));});
      child.once('close',code=>{clearTimeout(timer);children.delete(child);kill(child);if(error)return reject(error);if(code!==0)return reject(new Error('CLI 调用失败，请检查本机登录、网络和模型权限。'));try{resolve(cliText(output));}catch(e){reject(e);}});
      child.stdin.end(provider==='agy-cli'?'':input);
    });
  }finally{busy.delete(provider);}
}
