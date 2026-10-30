import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export function createCanvasHistory(data,{clock=Date.now,intervalMs=120000,limit=100}={}){
  const directory=path.join(data,'canvas-history');
  const file=id=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id||''))throw new Error('无效画布 ID');return path.join(directory,id+'.json');};
  const fingerprint=d=>JSON.stringify({name:d.name,nodes:d.nodes.map(({selected,dragging,measured,...n})=>n),edges:d.edges,messages:d.messages||[],viewport:d.viewport});
  async function list(id){try{return JSON.parse(await readFile(file(id),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async function capture(id,document,reason='automatic',force=false){
    const entries=await list(id),last=entries[0],now=clock();
    if(last&&fingerprint(last.document)===fingerprint(document))return last;
    if(last&&!force&&now-last.savedAt<intervalMs)return null;
    const entry={id:randomUUID(),savedAt:now,reason,document:structuredClone(document)};
    await mkdir(directory,{recursive:true});const p=file(id),temp=p+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify([entry,...entries].slice(0,limit)),{mode:0o600});await rename(temp,p);return entry;
  }
  return {list,capture};
}
export function removedContent(previous,next){
  const nodes=new Set(next.nodes.map(n=>n.id)),edges=new Set(next.edges.map(e=>e.id||`${e.source}:${e.target}`));
  return previous.nodes.some(n=>!nodes.has(n.id))||previous.edges.some(e=>!edges.has(e.id||`${e.source}:${e.target}`));
}
