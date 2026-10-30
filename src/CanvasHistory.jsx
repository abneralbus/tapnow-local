import React,{useEffect,useState} from 'react';
import {Clock,Save,RotateCcw} from 'lucide-react';
const reasons={initial:'初始版本',automatic:'自动快照','before-delete':'删除前保护',manual:'手动快照',restored:'恢复副本'};
export default function CanvasHistory({api,canvasId,onCapture,onRestore}){
  const [items,setItems]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  async function refresh(){setItems(await api('/canvases/'+canvasId+'/history'));setLoaded(true);}
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[canvasId]);
  async function run(fn){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="canvas-history"><p>有更改时约每 2 分钟保存快照，删除节点或连线前额外保护。保留最近 100 个版本。</p><div className="history-note">恢复会新建一张画布，当前内容保留；历史中的生成任务不会重新提交。</div><button className="primary" disabled={busy} onClick={()=>run(onCapture)}><Save size={16}/>保存当前快照</button>{error&&<p role="alert" className="cm-error">{error}</p>}<div className="canvas-history-list">{items.map(item=><article key={item.id}>{item.cover?<img src={item.cover} alt="快照封面"/>:<div className="snapshot-placeholder"><Clock size={25}/></div>}<div><b>{new Date(item.savedAt).toLocaleString('zh-CN')}</b><small>{reasons[item.reason]||'自动快照'} · {item.nodes} 个节点 · {item.edges} 条连线</small><span>{item.name}</span></div><button disabled={busy} onClick={()=>run(()=>onRestore(item.id))}><RotateCcw size={15}/>恢复为新画布</button></article>)}</div>{loaded&&!items.length&&<p>还没有历史快照，可以先保存当前版本。</p>}{!loaded&&!error&&<p>正在读取历史快照…</p>}</div>;
}
