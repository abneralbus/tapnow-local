import React,{useState} from 'react';
import {Bot,Image,Sparkles,Server,RefreshCw,LoaderCircle,ExternalLink,Terminal,KeyRound,Check} from 'lucide-react';
import TextInput from './TextInput.mjs';
function ServiceCard({icon:Icon,name,model,status,tone,children}){
  return <section className="service-card"><header><span className="service-icon"><Icon size={19}/></span><div><h3>{name}</h3><small>{model}</small></div><span className={'service-state '+tone}><i/>{status}</span></header>{children}</section>;
}
const groups=[{id:'agent',name:'Agent',detail:'创意 · 对话 · 分镜',icon:Bot},{id:'cloud',name:'云端生成模型',detail:'图像 · 视频',icon:Image},{id:'colab',name:'Colab',detail:'自己的 GPU 服务',icon:Server}];
export default function ModelConnections({config,setConfig,providers,health,checking,checkHealth,refresh,save,api,json}){
  const [tab,setTab]=useState('agent'),[refreshing,setRefreshing]=useState(false),[form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
  const options=config.agentOptions||[],selected=options.find(p=>p.id===config.agentProvider)||options[0],draft=form||{...selected,apiKey:''};
  const flowReady=providers?.bridge?.connected&&providers.bridge.extensionConnected&&providers.bridge.projectConfigured;
  const agentReady=!!config.hasAgent&&config.agentStatus!=='error';
  const pick=option=>{if(option){setForm({...option,apiKey:'',clearKey:false});setError('');setFeedback('');}};
  const change=patch=>{setForm({...draft,...patch});setFeedback('');};
  async function saveAgent(test=false){
    setBusy(true);setError('');setFeedback('');
    try{
      const value=await api('/agent/config',json({provider:draft.id,model:draft.model||'',baseUrl:draft.baseUrl||'',apiKey:draft.apiKey||'',clearKey:!!draft.clearKey},'PUT'));
      setConfig(old=>({...old,...value}));setForm(null);setFeedback('Agent 配置已保存');
      if(test){const result=await api('/agent/test',json({}));const {text,elapsedMs,...state}=result;setConfig(old=>({...old,...state}));setFeedback(`连接成功 · ${(elapsedMs/1000).toFixed(1)} 秒 · ${text}`);}
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="model-connections grouped-connections">
    <nav className="connection-nav" aria-label="模型配置分组">{groups.map(({id,name,detail,icon:Icon})=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={19}/><span><b>{name}</b><small>{detail}</small></span></button>)}</nav>
    <div className="connection-content">
      <div className="connections-intro"><p>{tab==='agent'?'选择对话助手，切换本机 CLI 或 API。':tab==='cloud'?'管理图像与视频生成服务，在节点中选择模型。':'连接自己的 Colab 推理服务。'}</p><button disabled={refreshing||busy} onClick={async()=>{setRefreshing(true);try{await refresh();}catch(e){setError(e.message);}finally{setRefreshing(false);}}}>{refreshing?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>}刷新状态</button></div>
      {tab==='agent'&&<section className="agent-settings">
        <header className="agent-current"><span className="service-icon"><Bot size={20}/></span><div><small>当前 Agent</small><b>{config.agentModel||'尚未配置'}</b></div><span className={'service-state '+(agentReady?'success':'pending')}><i/>{config.agentStatus==='verified'?'已验证':config.agentStatus==='error'?'调用失败':agentReady?(selected?.kind==='cli'?'已检测到':'已配置'):'待配置'}</span></header>
        <div className="agent-method" aria-label="Agent 调用方式"><button type="button" disabled={busy} aria-pressed={draft.kind==='cli'} onClick={()=>pick(options.find(p=>p.kind==='cli'))}><Terminal size={16}/>本机 CLI</button><button type="button" disabled={busy} aria-pressed={draft.kind==='api'} onClick={()=>pick(options.find(p=>p.kind==='api'))}><KeyRound size={16}/>API 调用</button></div>
        <label>服务<select aria-label="Agent 服务" disabled={busy||!options.length} value={draft.id||''} onChange={e=>pick(options.find(p=>p.id===e.target.value))}>{options.filter(p=>p.kind===draft.kind).map(p=><option key={p.id} value={p.id}>{p.name}{p.kind==='cli'&&!p.available?'（未检测到）':''}</option>)}</select></label>
        <label>模型名称{draft.kind==='cli'&&<small>可选，留空使用 CLI 默认模型</small>}<TextInput as="input" aria-label="Agent 模型名称" disabled={busy} placeholder={draft.kind==='cli'?'使用 CLI 默认模型':'输入账号可用的模型 ID'} value={draft.model||''} onChange={e=>change({model:e.target.value})}/></label>
        {draft.kind==='api'?<>
          <label>API 基础地址<TextInput as="input" aria-label="Agent API 地址" disabled={busy} placeholder="https://api.example.com/v1" value={draft.baseUrl||''} onChange={e=>change({baseUrl:e.target.value})}/></label>
          <label>API Key <small>{draft.hasKey&&!draft.clearKey?'已保存，留空保持':'仅保存在本机后端'}</small><input aria-label="Agent API Key" disabled={busy} type="password" autoComplete="off" value={draft.apiKey||''} onChange={e=>change({apiKey:e.target.value,clearKey:false})}/></label>
          {draft.hasKey&&<button type="button" className="agent-clear-key" disabled={busy} onClick={()=>change({apiKey:'',clearKey:true})}>{draft.clearKey?'保存后将清除 Key':'清除已保存 Key'}</button>}
        </>:<p className="agent-note">复用本机 CLI 的登录与模型权限。Claude、Codex、agy 分别调用自己的命令行程序；每次回复结束后释放本次进程。</p>}
        <div className="agent-save-actions"><button className="primary" disabled={busy||!draft.id} onClick={()=>saveAgent(false)}>{busy?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>}保存配置</button><button disabled={busy||!draft.id} onClick={()=>saveAgent(true)}>保存并测试</button></div>
        {feedback&&<p className="service-detail" role="status">{feedback}</p>}
        {(error||config.agentError)&&<p className="service-error" role="alert">{error||config.agentError}</p>}
        <p className="agent-note">Agent 可引用画布中的文字、提示词和连接关系。测试会发送一条简短的连接检查消息。</p>
      </section>}
      {tab==='cloud'&&<div className="cloud-services">
    <ServiceCard icon={Image} name="Google Flow" model="Nano Banana · Veo · Omni" status={flowReady?'已连接':providers?.bridge?'待连接':'检测中'} tone={flowReady?'success':'pending'}>
      <div className="service-capabilities"><span>文生图 / 图生图</span><span>首帧视频</span><span>多图参考视频</span></div>
      <p>Veo 使用一张首帧，约 8 秒；Omni 使用参考图。当前接入尚不支持纯文字视频与尾帧。</p>
      {providers?.bridge?.error&&<p className="service-error">{providers.bridge.error}</p>}
      <a href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">打开 Google Flow<ExternalLink size={12}/></a>
    </ServiceCard>
    <ServiceCard icon={Sparkles} name="Muse" model="Muse Image · Muse Video" status={providers?.muse?.paused?'已暂停':providers?.muse?.connected?'桥接已连':providers?.muse?'待连接':'检测中'} tone="pending">
      <div className="service-capabilities"><span>文生图 / 图生图</span><span>文生视频</span><span>参考图视频</span></div>
      <p>连接状态仅确认本地桥接；Muse 账号访问权限与生成能力需另行验证。时长以生成结果为准，当前接入不支持锁定首尾帧。</p>
      {providers?.muse?.error&&<p className="service-error">{providers.muse.error}</p>}
    </ServiceCard>
    {providers?.error&&<p className="service-error">{providers.error}</p>}
      </div>}
      {tab==='colab'&&<div className="colab-service">
    <ServiceCard icon={Server} name="Colab" model="MiniMax H3 · 可选" status={health?.connected?'已连接':health?'未连接':config.colabUrl?'待检测':'未配置'} tone={health?.connected?'success':'pending'}>
      <div className="service-capabilities"><span>文字生视频</span><span>4 秒 · 768p</span></div>
      <p>使用你自己的 Colab GPU；图片参考和尾帧尚未适配。</p>
      <div className="colab-settings">
        <label>Colab 服务地址<input placeholder="https://your-worker.example.com" value={config.colabUrl||''} onChange={event=>setConfig({...config,colabUrl:event.target.value})}/></label>
        <label>访问 Token<input type="password" autoComplete="off" placeholder={config.hasToken?'已保存，留空则保持':'仅保存在本机后端'} value={config.colabToken||''} onChange={event=>setConfig({...config,colabToken:event.target.value})}/></label>
        <div className="button-row"><button className="primary" disabled={checking} onClick={save}>保存并连接</button><button onClick={checkHealth} disabled={checking}>{checking?<LoaderCircle className="spin" size={15}/>:<RefreshCw size={15}/>}测试连接</button></div>
      </div>
      {health&&<p className={health.connected?'service-detail':'service-error'}>{health.connected?`${health.gpu||'GPU'} · 往返 ${health.roundTripMs}ms`:health.error}{health.model?` · ${health.model}`:''}</p>}
    </ServiceCard>
      </div>}
    </div>
  </div>;
}
