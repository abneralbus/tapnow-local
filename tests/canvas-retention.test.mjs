import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCanvasRetention,mediaReferences} from '../server/canvas-retention.mjs';
import {TRASH_RETENTION_MS,trashExpiresAt} from '../shared/canvas-retention.mjs';
const now=Date.UTC(2026,9,30),old=now-TRASH_RETENTION_MS;
const doc=(srcs=[],deletedAt)=>({name:'fixture',nodes:srcs.map((src,i)=>({id:String(i),type:'image',position:{x:0,y:0},data:{src}})),edges:[],updatedAt:now,...(deletedAt?{deletedAt}:{})});
async function fixture(t){const data=await mkdtemp(path.join(os.tmpdir(),'tapnow-retention-'));for(const dir of ['canvases','canvas-history','media'])await mkdir(path.join(data,dir));t.after(()=>rm(data,{recursive:true,force:true}));
 const put=(file,value)=>writeFile(path.join(data,file),typeof value==='string'?value:JSON.stringify(value));
 const exists=async file=>{try{await access(path.join(data,file));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 return {data,put,exists};}
test('30-day expiry removes exclusive media and tasks while preserving every surviving reference and unrelated uploads',async t=>{
 const f=await fixture(t),names=['owned.png','shared.png','history.png','orphan.png','job-reference.png','sole-input.png','sole-output.mp4','young.png','unrelated.png'];
 for(const name of names)await f.put('media/'+name,'fixture');
 await f.put('canvases/expired.json',doc(names.slice(0,5).map(n=>'/media/'+n),old));
 await f.put('canvas-history/expired.json',[{document:doc(['/media/owned.png'])}]);
 await f.put('canvases/live.json',doc(['/media/shared.png']));
 await f.put('canvas-history/live.json',[{document:doc(['/media/history.png'])}]);
 await f.put('canvas-history/orphan.json',[{document:doc(['/media/orphan.png'])}]);
 await f.put('canvases/young.json',doc(['/media/young.png'],now-1000));
 let jobs=[{id:'dead-task',canvasId:'expired',src:'/media/sole-output.mp4',input:{references:[{src:'/media/sole-input.png'}]}},{id:'live-task',canvasId:'live',input:{references:[{src:'/media/job-reference.png'}]}}];
 const events=[],gc=createCanvasRetention(f.data,{clock:()=>now,getJobs:()=>jobs,removeJobs:async ids=>{jobs=jobs.filter(j=>!ids.includes(j.id));},onPurged:event=>events.push(event)});
 assert.deepEqual(await gc.sweep(),{canvases:1,media:3,sharedMedia:4});
 assert.equal(await f.exists('canvases/expired.json'),false);assert.equal(await f.exists('canvas-history/expired.json'),false);assert.equal(jobs.length,1);assert.equal(await gc.isPurged('expired'),true);
 for(const name of ['shared.png','history.png','orphan.png','job-reference.png','young.png','unrelated.png'])assert.equal(await f.exists('media/'+name),true,name);
 for(const name of ['owned.png','sole-input.png','sole-output.mp4'])assert.equal(await f.exists('media/'+name),false,name);
 assert.deepEqual(events[0].canvasIds,['expired']);assert.deepEqual(events[0].jobIds,['dead-task']);
 // A shared candidate is reclaimed only after its last surviving use disappears.
 await f.put('canvases/live.json',doc());assert.equal((await gc.sweep()).media,1);assert.equal(await f.exists('media/shared.png'),false);assert.equal(await f.exists('media/history.png'),true);
});
test('retention boundary is exact; ongoing generation defers cleanup without altering files',async t=>{
 const f=await fixture(t);await f.put('canvases/a.json',doc(['/media/a.png'],old));await f.put('media/a.png','fixture');let time=now-1,allowed=true;
 const gc=createCanvasRetention(f.data,{clock:()=>time,canCleanup:()=>allowed});assert.equal((await gc.sweep()).canvases,0);time++;allowed=false;assert.deepEqual(await gc.sweep(),{deferred:true});assert.equal(await f.exists('media/a.png'),true);
 allowed=true;assert.equal((await gc.sweep()).canvases,1);assert.equal(trashExpiresAt({deletedAt:old}),now);assert.equal(trashExpiresAt({deletedAt:'invalid'}),null);
});
test('durable tombstones resume an interrupted purge even after canvas and snapshots disappeared',async t=>{
 const f=await fixture(t);await f.put('canvases/a.json',doc(['/media/a.mp4'],old));await f.put('media/a.mp4','fixture');
 const jobs=[{id:'task',canvasId:'a',src:'/media/a.mp4'}];const first=createCanvasRetention(f.data,{clock:()=>now,getJobs:()=>jobs,removeJobs:async()=>{throw new Error('fixture storage failure');}});
 await assert.rejects(()=>first.sweep(),/storage failure/);assert.equal(await f.exists('canvases/a.json'),false);assert.equal(await f.exists('media/a.mp4'),true);assert.equal(await first.isPurged('a'),true);
 let removed=[];const restarted=createCanvasRetention(f.data,{clock:()=>now,getJobs:()=>jobs,removeJobs:async ids=>{removed=ids;jobs.length=0;}});
 assert.equal((await restarted.sweep()).media,1);assert.deepEqual(removed,['task']);assert.equal(await f.exists('media/a.mp4'),false);assert.equal(await restarted.isPurged('a'),true);
 const state=JSON.parse(await readFile(path.join(f.data,'canvas-retention.json'),'utf8'));assert.equal(state.canvases.a.pending,undefined);assert.deepEqual(state.media,[]);
});
test('corrupt reference data fails closed; paths outside the owned media directory are never deletion candidates',async t=>{
 const f=await fixture(t);await f.put('canvases/a.json',doc(['/media/a.png','/media/../outside.txt'],old));await f.put('media/a.png','fixture');await f.put('outside.txt','keep');await f.put('canvas-history/live.json','not json');
 const gc=createCanvasRetention(f.data,{clock:()=>now});await assert.rejects(()=>gc.sweep());assert.equal(await f.exists('canvases/a.json'),true);assert.equal(await f.exists('media/a.png'),true);
 await f.put('canvas-history/live.json',[]);await gc.sweep();assert.equal(await f.exists('outside.txt'),true);
 assert.deepEqual([...mediaReferences({a:'/media/../outside.txt',b:'/media/abc.png',c:'https://example.com/media/abc.png'})],['abc.png']);
});

test('asset ownership survives removed nodes and snapshot rotation without pinning unused shared files',async t=>{
 const f=await fixture(t);await f.put('media/old-upload.png','fixture');await f.put('canvases/a.json',doc([],old));await f.put('canvases/live.json',doc());
 const gc=createCanvasRetention(f.data,{clock:()=>now});await gc.recordAssets('a',doc(['/media/old-upload.png']));await gc.recordAssets('live',doc(['/media/old-upload.png']));
 await gc.sweep();assert.equal(await f.exists('media/old-upload.png'),false);assert.equal(await f.exists('canvas-assets/a.json'),false);assert.equal(await f.exists('canvas-assets/live.json'),true);
});

test('all accepted canvas IDs retain durable tombstones, including object property names',async t=>{
 const f=await fixture(t);await f.put('canvases/__proto__.json',doc([],old));const gc=createCanvasRetention(f.data,{clock:()=>now});
 await gc.sweep();assert.equal(await gc.isPurged('__proto__'),true);assert.equal(await f.exists('canvases/__proto__.json'),false);
});
