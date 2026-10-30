import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCanvasHistory,removedContent} from '../server/canvas-history.mjs';
test('history deduplicates, spaces automatic versions, protects removals immediately, persists and bounds retained versions',async t=>{
  const data=await mkdtemp(path.join(tmpdir(),'canvas-history-'));t.after(()=>rm(data,{recursive:true,force:true}));let now=1000;
  const h=createCanvasHistory(data,{clock:()=>now,limit:3});const doc={name:'a',nodes:[{id:'a',data:{text:'first'}}],edges:[],messages:[],updatedAt:1};
  await h.capture('a',doc);now+=100;assert.equal(await h.capture('a',{...doc,name:'edit'}),null);
  await h.capture('a',{...doc,updatedAt:999,nodes:[{...doc.nodes[0],selected:true,measured:{width:300}}]},'manual',true);assert.equal((await h.list('a')).length,1);
  const edited={...doc,name:'unsaved edits'};assert.equal(removedContent(edited,{...edited,nodes:[]}),true);await h.capture('a',edited,'before-delete',true);
  assert.equal((await h.list('a'))[0].reason,'before-delete');assert.equal((await h.list('a'))[0].document.nodes.length,1);
  now+=120000;await h.capture('a',{...doc,name:'periodic'});now+=1;await h.capture('a',{...doc,name:'manual'},'manual',true);
  const fresh=createCanvasHistory(data),versions=await fresh.list('a');assert.equal(versions.length,3);assert.deepEqual(versions.map(v=>v.document.name),['manual','periodic','unsaved edits']);
  assert.equal(removedContent({...doc,edges:[{id:'edge',source:'a',target:'b'}]},doc),true);
  await assert.rejects(h.list('../escape'),/无效/);
});
