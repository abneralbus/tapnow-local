import React,{useState} from 'react';
import {ExternalLink,Power,LoaderCircle} from 'lucide-react';
import {colabNotebookUrl} from '../shared/colab-notebook.mjs';
export default function ColabControls({config,onRelease,notify}) {
  const [busy,setBusy]=useState(false);
  let url='https://colab.research.google.com/';
  try { url=colabNotebookUrl(config.colabNotebookUrl||''); } catch {}
  async function release(){
    if(busy)return;
    setBusy(true);
    try { await onRelease(); } catch(error) { notify(error.message); } finally { setBusy(false); }
  }
  return <div className="canvas-colab-controls" aria-label="Colab 控制">
    <a href={url} target="_blank" rel="noreferrer" title="打开笔记本，在 Colab 中连接 GPU 并运行"><ExternalLink size={16}/>打开 Colab</a>
    <button type="button" disabled={busy||!config.colabUrl||!config.hasToken} onClick={release} title="确认结果已保存后，结束当前 Colab 会话并释放 GPU">{busy?<LoaderCircle size={16} className="spin"/>:<Power size={16}/>} {busy?'正在请求…':'关闭 GPU'}</button>
  </div>;
}
