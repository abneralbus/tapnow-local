import React,{useRef,useState} from 'react';
import TextInput from './TextInput.mjs';
import {editMentions,mentionQuery,insertMention} from '../shared/node-mentions.mjs';
import {ArrowUp,Clock,Plus,StopCircle,X,Upload} from 'lucide-react';
import {generationIssue,providerCatalog} from './generation.mjs';

export const providerLabels={colab:'Colab',flow:'Google Flow',muse:'Muse'};
export const isRunning=status=>['queued','running','downloading'].includes(status);
export default function GenerationPanel({id,type,data,actions}){
  const [picker,setPicker]=useState(null),[mention,setMention]=useState(null),[highlight,setHighlight]=useState(0),input=useRef();
  const image=type==='image',provider=data.provider||(image?'flow':'colab'),mode=data.mode||'text';
  const references=Array.isArray(data.references)?data.references:[],images=actions.images||[],busy=isRunning(data.status);
  const catalog=actions.providers?.providers||providerCatalog,models=catalog.find(item=>item.id===provider)?.[image?'imageModels':'videoModels']||[];
  const model=data.model||models[0]?.id,duration=data.duration||4,aspectRatio=data.aspectRatio||'16:9';
  const issue=provider==='muse'&&actions.providers?.muse?.paused?(actions.providers.muse.error||'Muse 已暂停；恢复前先调整 proxy 规则'):generationIssue(type,provider,mode,references,model,duration,aspectRatio),time=data.timings?.[image?'visibleMs':'playableMs'];
  const durations=provider==='flow'?(model==='omni'?[4,6,8,10]:[8]):[4,5,6,8,10,15];
  const selected=references.filter(ref=>mode==='frames'?['start','end'].includes(ref.role):ref.role==='reference');
  const options=images.filter(item=>!mention||item.title.toLowerCase().includes(mention.query.toLowerCase()));
  function setReference(item,role){
    const kept=references.filter(ref=>role==='reference'?(ref.role!=='reference'||ref.src!==item.src):ref.role!==role);
    const patch={references:[...kept,{src:item.src,role,nodeId:item.id}]};
    if(mention){
      const next=insertMention(data.prompt||'',data.mentions||[],mention,item);patch.prompt=next.text;patch.mentions=next.mentions;
      if(mode==='text')patch.mode='reference';
      const caret=next.caret;
      requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(caret,caret);});
    }
    actions.update(id,patch);setPicker(null);setMention(null);
  }
  function removeReference(ref){actions.removeReference(id,ref);}
  function changePrompt(event){
    const prompt=event.target.value,end=event.target.selectionStart,bindings=editMentions(data.prompt||'',prompt,data.mentions||[]);
    actions.update(id,{prompt,mentions:bindings});setMention(mentionQuery(prompt,end,bindings));setPicker(null);setHighlight(0);
  }
  const pickRole=mention?(mode==='frames'?(references.some(ref=>ref.role==='start')?'end':'start'):'reference'):picker;
  return <div className="generation-form nodrag nowheel" onKeyDown={event=>{if(event.key==='Escape'){setPicker(null);setMention(null);event.stopPropagation();}}}>
    <div className="generation-modes" aria-label={image?'图片生成模式':'视频生成模式'}>
      {(image?[['text','文生图'],['reference','参考图']]:[['text','文字'],['reference','参考图'],['frames','首尾帧']]).map(([value,label])=><button key={value} className={mode===value?'active':''} aria-pressed={mode===value} onClick={()=>{actions.update(id,{mode:value});setPicker(null);setMention(null);}}>{label}</button>)}
      <span className="mode-hint">输入 @ 引用图片</span>
      {image&&<button className="node-upload" title="上传图片到此节点" aria-label="上传图片到此节点" onClick={()=>actions.upload('image',id)}><Upload size={14}/></button>}
    </div>
    {mode==='frames'?<div className="frame-slots">{[['start','首帧'],['end','尾帧 · 可选']].map(([role,label])=>{const ref=references.find(item=>item.role===role),item=images.find(item=>item.src===ref?.src);return <div className="frame-slot" key={role}><button onClick={()=>{setPicker(picker===role?null:role);setMention(null);}} aria-label={'选择'+(role==='start'?'首帧':'尾帧')}>{ref?<img src={ref.src} alt={label} draggable={false}/>:<Plus size={17}/>}<span>{label}<small>{item?.title||'选择画布图片'}</small></span></button>{ref&&<button className="remove-reference" aria-label={'移除'+(role==='start'?'首帧':'尾帧')} onClick={()=>removeReference(ref)}><X size={12}/></button>}</div>;})}</div>:mode==='reference'&&<div className="reference-strip">{selected.map(ref=>{const item=images.find(item=>item.src===ref.src);return <div className="reference-chip" key={ref.src}><img src={ref.src} alt={item?.title||'参考图片'} draggable={false}/><span>{item?.title||'参考图片'}</span><button aria-label={'移除参考图片 '+(item?.title||'')} onClick={()=>removeReference(ref)}><X size={12}/></button></div>;})}<button className="reference-add" aria-label="添加参考图片" onClick={()=>{setPicker(picker==='reference'?null:'reference');setMention(null);}}><Plus size={15}/><span>参考图片</span></button></div>}
    {(picker||mention)&&<div id={'image-picker-'+id} className="image-picker" role="listbox" aria-label="画布图片">{options.map((item,index)=><button role="option" aria-selected={index===highlight} id={'image-option-'+id+'-'+index} key={item.id} onClick={()=>setReference(item,pickRole)}><img src={item.src} alt="" draggable={false}/><span>{item.title}</span><small>{pickRole==='start'?'首帧':pickRole==='end'?'尾帧':'引用'}</small></button>)}{!options.length&&<p>{images.length?'没有匹配的图片':'先上传一张图片到画布'}</p>}</div>}
    <TextInput ref={input} onCompositionStart={()=>setMention(null)} aria-label={image?'图片提示词':'视频提示词'} aria-autocomplete="list" aria-controls={mention?'image-picker-'+id:undefined} aria-activedescendant={mention&&options.length?'image-option-'+id+'-'+highlight:undefined} placeholder={image?'描述想要的图片，输入 @ 添加参考…':'描述画面、动作、运镜和声音，输入 @ 引用图片…'} value={data.prompt||''} onChange={changePrompt} onKeyDown={event=>{if(!mention||!options.length||event.nativeEvent.isComposing)return;if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setHighlight((highlight+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);}if(event.key==='Enter'){event.preventDefault();setReference(options[Math.min(highlight,options.length-1)],pickRole);}}}/>
    <div className="generation-footer">
      <div className="generation-options">
        <select aria-label="生成服务商" value={provider} onChange={event=>actions.update(id,{provider:event.target.value,model:'',mode:image?mode:event.target.value==='flow'?'frames':event.target.value==='colab'?'text':mode==='frames'?'reference':mode,duration:event.target.value==='flow'?8:4,aspectRatio:event.target.value==='colab'?'16:9':aspectRatio})}>{catalog.filter(item=>item[image?'imageModels':'videoModels'].length).map(item=><option key={item.id} value={item.id}>{providerLabels[item.id]||item.label}</option>)}</select>
        <select aria-label="生成模型" className="model-select" value={model||''} onChange={event=>actions.update(id,{model:event.target.value,mode:!image&&provider==='flow'?(event.target.value==='omni'?'reference':'frames'):mode,duration:provider==='flow'&&event.target.value!=='omni'?8:duration})}>{models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>
        {!image&&<select aria-label="视频时长" value={duration} onChange={event=>actions.update(id,{duration:Number(event.target.value)})}>{!durations.includes(duration)&&<option value={duration} disabled>{duration}s 不支持</option>}{durations.map(n=><option key={n} value={n}>{provider==='flow'&&model!=='omni'?'默认约 8s':n+'s'}</option>)}</select>}
        {provider!=='colab'&&<select aria-label="画幅比例" value={aspectRatio} onChange={event=>actions.update(id,{aspectRatio:event.target.value})}>{(image?['16:9','9:16','1:1']:['16:9','9:16']).map(value=><option key={value}>{value}</option>)}</select>}
        {provider==='colab'&&<select aria-label="视频分辨率" value={data.resolution||'768p'} onChange={event=>actions.update(id,{resolution:event.target.value})}><option value="768p">768p</option><option value="544p">544p</option></select>}
      </div>
      <button className="generate-button" disabled={busy?!data.jobId:!!issue} aria-label={busy?'停止接收结果':image?'生成图片':'生成视频'} title={busy?'停止接收结果；远端任务可能继续运行':issue||'开始生成'} onClick={()=>busy?actions.cancel(data.jobId):actions.generate(id)}>{busy?<StopCircle size={17}/>:<ArrowUp size={18}/>}</button>
    </div>
    {issue&&<p className="generation-notice">{issue}</p>}
    {provider==='muse'&&!image&&<p className="model-footnote">时长为目标，实际以生成结果为准</p>}
    {busy&&<div className={'progress '+(Number.isFinite(data.progress)?'':'indeterminate')}><i style={{width:Number.isFinite(data.progress)?`${Math.min(100,Math.max(0,data.progress))}%`:'35%'}}/></div>}
    {data.error&&<p className="node-error">{data.error}</p>}
    {time&&<p className="node-timing"><Clock size={12}/>{image?'点击到图片显示':'点击到可播放'} {(time/1000).toFixed(1)} 秒</p>}
  </div>;
}
