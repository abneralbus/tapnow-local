import {readFile,writeFile,rename,readdir,unlink,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {trashExpiresAt} from '../shared/canvas-retention.mjs';
const idPattern=/^[a-zA-Z0-9_-]{1,80}$/;
const mediaPattern=/^\/media\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|ogg|m4a))$/;
export function mediaReferences(value,found=new Set()){
  if(typeof value==='string'){const match=value.match(mediaPattern);if(match)found.add(match[1]);}
  else if(Array.isArray(value))value.forEach(item=>mediaReferences(item,found));
  else if(value&&typeof value==='object')Object.values(value).forEach(item=>mediaReferences(item,found));
  return found;
}
// Called within the library's mutation queue; generation submissions wait for that queue.
export function createCanvasRetention(data,{clock=Date.now,getJobs=()=>[],removeJobs=async()=>{},canCleanup=()=>true,onPurged=()=>{}}={}){
  const directory=path.join(data,'canvases'),historyDirectory=path.join(data,'canvas-history'),assetDirectory=path.join(data,'canvas-assets'),manifestFile=path.join(data,'canvas-retention.json');
  const read=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
  async function save(manifest){const temp=manifestFile+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(manifest),{mode:0o600});await rename(temp,manifestFile);}
  async function manifest(){const value=await read(manifestFile,{canvases:{},media:[]});if(!value||typeof value.canvases!=='object'||!value.canvases||Array.isArray(value.canvases)||!Array.isArray(value.media)||Object.keys(value.canvases).some(id=>!idPattern.test(id))||value.media.some(name=>!mediaPattern.test('/media/'+name)))throw new Error('回收站清理记录损坏，已停止清理');return value;}
  const remove=async file=>{try{await unlink(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  async function documents(dir){let files;try{files=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}return Promise.all(files.filter(name=>name.endsWith('.json')&&idPattern.test(name.slice(0,-5))).map(async name=>({id:name.slice(0,-5),value:await read(path.join(dir,name),null)})));}
  async function isPurged(id){return Object.hasOwn((await manifest()).canvases,id);}
  async function recordAssets(id,...values){
    if(!idPattern.test(id))throw new Error('无效画布 ID');
    const file=path.join(assetDirectory,id+'.json'),previous=await read(file,[]);
    if(!Array.isArray(previous)||previous.some(name=>!mediaPattern.test(name)))throw new Error('画布素材清单损坏');
    const refs=new Set(previous.map(name=>name.slice('/media/'.length)));values.forEach(value=>mediaReferences(value,refs));
    if(refs.size===previous.length)return;
    await mkdir(assetDirectory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify([...refs].map(name=>'/media/'+name)),{mode:0o600});await rename(temp,file);
  }

  async function sweep(){
    if(!canCleanup())return {deferred:true};
    const now=clock(),state=await manifest(),docs=await documents(directory);
    if(docs.some(({value})=>!value||!Array.isArray(value.nodes)))throw new Error('画布数据损坏，已停止回收站清理');
    const expired=docs.filter(({value})=>{const expiry=trashExpiresAt(value);return expiry!==null&&expiry<=now;});
    const unfinished=Object.entries(state.canvases).filter(([,entry])=>entry.pending).map(([id])=>id);
    if(!expired.length&&!unfinished.length&&!state.media.length)return {canvases:0,media:0};
    const ids=new Set([...Object.keys(state.canvases),...expired.map(d=>d.id)]),purging=new Set([...unfinished,...expired.map(d=>d.id)]);
    const snapshots=await documents(historyDirectory),jobs=getJobs(),candidates=new Set(state.media),protectedFiles=new Set();
    if(snapshots.some(({value})=>!Array.isArray(value)||value.some(entry=>!entry?.document||!Array.isArray(entry.document.nodes))))throw new Error('历史快照损坏，已停止回收站清理');
    // Scan every surviving snapshot too, including snapshots written just before an interrupted canvas save.
    for(const {id,value} of [...docs,...snapshots])mediaReferences(value,ids.has(id)?candidates:protectedFiles);
    // Ownership survives snapshot rotation; it is not itself a live reference.
    for(const id of ids){const inventory=await read(path.join(assetDirectory,id+'.json'),[]);if(!Array.isArray(inventory)||inventory.some(src=>!mediaPattern.test(src)))throw new Error('画布素材清单损坏，已停止清理');mediaReferences(inventory,candidates);}
    for(const job of jobs)mediaReferences(job,ids.has(job.canvasId)?candidates:protectedFiles);
    for(const {id,value} of expired)Object.defineProperty(state.canvases,id,{value:{deletedAt:value.deletedAt,purgedAt:state.canvases[id]?.purgedAt||now,pending:true},enumerable:true,writable:true,configurable:true});
    state.media=[...candidates];await save(state); // Durable tombstones and candidates before the first unlink.
    for(const id of purging){await remove(path.join(directory,id+'.json'));await remove(path.join(historyDirectory,id+'.json'));await remove(path.join(assetDirectory,id+'.json'));}
    const jobIds=jobs.filter(job=>ids.has(job.canvasId)).map(job=>job.id);if(jobIds.length)await removeJobs(jobIds);
    let removed=0;const retained=[],cleared=[];
    for(const name of candidates){if(protectedFiles.has(name)){retained.push(name);continue;}if(await remove(path.join(data,'media',name)))removed++;cleared.push('/media/'+name);}
    for(const id of purging)state.canvases[id]={deletedAt:state.canvases[id].deletedAt,purgedAt:state.canvases[id].purgedAt};
    state.media=retained;state.lastSweepAt=now;await save(state);
    if(purging.size||cleared.length)onPurged({canvasIds:[...purging],jobIds,media:cleared});
    return {canvases:purging.size,media:removed,sharedMedia:retained.length};
  }
  return {sweep,isPurged,recordAssets};
}
