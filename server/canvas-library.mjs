import {readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {canvasDocument} from './validation.mjs';
import {createCanvasHistory,removedContent} from './canvas-history.mjs';
import {createCanvasRetention} from './canvas-retention.mjs';
import {trashExpiresAt} from '../shared/canvas-retention.mjs';

// Serialize content and management mutations together: stale tabs cannot resurrect trash.
export function installCanvasLibrary(app,data,options={}){
  const clock=options.clock||Date.now,retention=createCanvasRetention(data,options);
  const directory=path.join(data,'canvases'),groupFile=path.join(data,'canvas-groups.json');
  const history=createCanvasHistory(data,{clock});
  let pending=Promise.resolve();
  const serialize=fn=>{const task=pending.catch(()=>{}).then(fn);pending=task;return task;};
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
  const file=id=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id||''))fail('无效画布 ID');return path.join(directory,id+'.json');};
  const read=async(p,fallback=null)=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
  const save=async(p,value)=>{const temp=p+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,p);};
  const assertRetained=async id=>{file(id);if(await retention.isPurged(id))fail('画布已超过 30 天保留期，已永久清理',410);};
  const assertNotExpired=value=>{const expiry=trashExpiresAt(value);if(expiry!==null&&expiry<=clock())fail('画布已超过 30 天保留期，无法恢复',410);};
  const groups=()=>read(groupFile,[]);
  const label=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>100)fail('名称需要 1–100 个字符');return value.trim();};
  const normalized=(value,gs)=>({...value,groupId:gs.some(g=>g.id===value.groupId)?value.groupId:null});
  app.get('/api/canvas-groups',async(req,res)=>res.json(await groups()));
  app.post('/api/canvas-groups',async(req,res)=>res.json(await serialize(async()=>{
    const gs=await groups(),name=label(req.body.name);if(gs.some(g=>g.name===name))fail('分组名称已存在',409);
    const group={id:randomUUID(),name};await save(groupFile,[...gs,group]);return group;
  })));
  app.patch('/api/canvas-groups/:id',async(req,res)=>res.json(await serialize(async()=>{
    const gs=await groups(),group=gs.find(g=>g.id===req.params.id);if(!group)fail('分组不存在',404);
    const name=label(req.body.name);if(gs.some(g=>g.id!==group.id&&g.name===name))fail('分组名称已存在',409);
    group.name=name;await save(groupFile,gs);return group;
  })));
  app.delete('/api/canvas-groups/:id',async(req,res)=>res.json(await serialize(async()=>{
    const gs=await groups();if(!gs.some(g=>g.id===req.params.id))fail('分组不存在',404);
    // Missing group IDs resolve to ungrouped, including restored and legacy documents.
    await save(groupFile,gs.filter(g=>g.id!==req.params.id));return {deleted:true};
  })));
  app.get('/api/canvases',async(req,res)=>res.json(await serialize(async()=>{const gs=await groups(),files=(await readdir(directory)).filter(f=>f.endsWith('.json'));
    const docs=await Promise.all(files.map(async f=>{const d=normalized(await read(path.join(directory,f)),gs);const cover=d.nodes.find(n=>n.type==='image'&&n.data?.src)?.data.src;return {id:f.slice(0,-5),name:d.name,updatedAt:d.updatedAt,count:d.nodes.length,cover,groupId:d.groupId,deletedAt:d.deletedAt||null,expiresAt:trashExpiresAt(d)};}));
    return docs.filter(d=>req.query.trash==='true'?!!d.deletedAt:!d.deletedAt).sort((a,b)=>(b.deletedAt||b.updatedAt)-(a.deletedAt||a.updatedAt));
  })));
  app.get('/api/canvases/:id',async(req,res)=>{
    await assertRetained(req.params.id);const d=await read(file(req.params.id));if(!d)fail('画布不存在',404);if(d.deletedAt)fail('画布已移入回收站，请先恢复',410);res.json(normalized(d,await groups()));
  });
  app.get('/api/canvases/:id/history',async(req,res)=>{
    file(req.params.id);await pending.catch(()=>{});
    await assertRetained(req.params.id);const document=await read(file(req.params.id));if(!document)fail('画布不存在',404);assertNotExpired(document);
    res.json((await history.list(req.params.id)).map(({document,...entry})=>({...entry,name:document.name,nodes:document.nodes.length,edges:document.edges.length,cover:document.nodes.find(n=>n.type==='image'&&n.data?.src)?.data.src})));
  });
  app.post('/api/canvases/:id/history',async(req,res)=>res.json(await serialize(async()=>{
    await assertRetained(req.params.id);const d=await read(file(req.params.id));if(!d)fail('画布不存在',404);if(d.deletedAt)fail('画布已移入回收站',410);
    if(req.body.baseUpdatedAt!==d.updatedAt)fail('画布已更新，请重新读取后保存快照',409);
    const entry=await history.capture(req.params.id,d,req.body.automatic?'automatic':'manual',!req.body.automatic);
    return {saved:!!entry,id:entry?.id};
  })));
  app.post('/api/canvases/:id/history/:version/restore',async(req,res)=>res.json(await serialize(async()=>{
    await assertRetained(req.params.id);const original=await read(file(req.params.id));if(!original)fail('画布不存在',404);assertNotExpired(original);
    const entry=(await history.list(req.params.id)).find(v=>v.id===req.params.version);if(!entry)fail('快照不存在',404);
    const restored=canvasDocument(entry.document),id=randomUUID();
    restored.name=(restored.name.slice(0,90)+' · 恢复副本');restored.groupId=normalized(original,await groups()).groupId;
    restored.nodes=restored.nodes.map(n=>{const {jobId,jobStartedAt,clickedAt,clickedSessionId,progress,error,timings,status,...data}=n.data;return {...n,selected:false,data:{...data,...(data.src?{status:'completed'}:{})}};});
    await retention.recordAssets(id,restored);await history.capture(id,restored,'restored',true);await save(file(id),restored);return {id,updatedAt:restored.updatedAt};
  })));
  app.put('/api/canvases/:id',async(req,res)=>res.json(await serialize(async()=>{
    await assertRetained(req.params.id);const p=file(req.params.id),value=canvasDocument(req.body),previous=await read(p);
    if(previous?.deletedAt)fail('画布已移入回收站，已阻止旧页面重新保存',410);
    if(previous&&req.body.baseUpdatedAt!==previous.updatedAt)fail('其他页面已更新画布，已阻止旧内容覆盖。请先导出当前画布，再刷新读取最新版本。',409);
    await retention.recordAssets(req.params.id,previous,value);
    if(previous){const removing=removedContent(previous,value);await history.capture(req.params.id,previous,removing?'before-delete':'automatic',removing);}
    else await history.capture(req.params.id,value,'initial',true);
    value.groupId=previous?.groupId||null;value.updatedAt=Math.max(clock(),(previous?.updatedAt||0)+1);await save(p,value);return {saved:true,updatedAt:value.updatedAt};
  })));
  app.post('/api/canvas-management',async(req,res)=>res.json(await serialize(async()=>{
    const {action,ids,groupId}=req.body;
    if(!['rename','move','delete','restore'].includes(action)||!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length)fail('无效的画布管理操作');
    if(action==='rename'&&ids.length!==1)fail('每次重命名一个画布');
    const name=action==='rename'?label(req.body.name):null,gs=await groups();
    if(action==='move'&&groupId!==null&&!gs.some(g=>g.id===groupId))fail('目标分组不存在',404);
    const docs=await Promise.all(ids.map(async id=>{await assertRetained(id);const p=file(id),value=await read(p);if(!value)fail('画布不存在',404);if(action==='restore')assertNotExpired(value);if(action!=='restore'&&value.deletedAt)fail('画布已移入回收站',410);return {id,p,value};}));
    for(const d of docs){
      if(action==='delete'){await retention.recordAssets(d.id,d.value);await history.capture(d.id,d.value,'before-delete',true);}
      if(action==='rename')d.value.name=name;
      if(action==='move')d.value.groupId=groupId;
      if(action==='delete')d.value.deletedAt=clock();
      if(action==='restore')delete d.value.deletedAt;
      d.value.updatedAt=Math.max(clock(),(d.value.updatedAt||0)+1);await save(d.p,d.value);
    }
    return {updated:docs.map(d=>({id:d.id,name:d.value.name,updatedAt:d.value.updatedAt,deletedAt:d.value.deletedAt||null}))};
  })));
  let timer;
  const drain=async()=>{clearInterval(timer);await pending.catch(()=>{});};
  drain.wait=()=>pending.catch(()=>{});
  drain.sweep=()=>serialize(()=>retention.sweep());
  drain.startCleanup=async()=>{
    const clean=()=>drain.sweep().catch(error=>console.error('回收站清理失败，将稍后重试：'+error.message));
    await clean();timer=setInterval(clean,60000);timer.unref();
  };
  drain.assertWritable=async id=>{await drain.wait();await assertRetained(id);const d=await read(file(id));if(d?.deletedAt)fail('画布已移入回收站，不能提交生成任务',410);};
  return drain;
}
