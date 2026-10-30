import test from 'node:test';
import assert from 'node:assert/strict';
import {copyGraph,reconcileJobs,parseClipboardGraph,mergeJobs,downstreamGraph} from '../src/state.mjs';
const nodes=[{id:'a',type:'text',position:{x:0,y:0},data:{text:'keep'}},{id:'b',type:'video',position:{x:100,y:0},data:{status:'running',jobId:'old',src:'/media/result.mp4'}}];
test('clipboard is independent of original nodes and running jobs',()=>{
  const copy=copyGraph(nodes,[{id:'e',source:'a',target:'b'},{id:'outside',source:'x',target:'b'}]);
  assert.equal(copy.edges.length,1);assert.equal(copy.edges[0].source,copy.nodes[0].id);
  assert.notEqual(copy.nodes[1].id,'b');assert.equal(copy.nodes[1].data.jobId,undefined);
  copy.nodes[0].data.text='changed';assert.equal(nodes[0].data.text,'keep');
});
test('reload restores latest result for the correct canvas',()=>{
  const jobs=[{id:'1',nodeId:'b',canvasId:'c',startedAt:1,status:'running'},
    {id:'2',nodeId:'b',canvasId:'c',startedAt:2,status:'completed',src:'/media/new.mp4'},
    {id:'3',nodeId:'b',canvasId:'other',startedAt:3,status:'failed'}];
  const result=reconcileJobs(nodes,jobs,'c');assert.equal(result[1].data.jobId,'2');
  assert.equal(result[1].data.src,'/media/new.mp4');assert.equal(nodes[1].data.status,'running');
});
test('late events from an older generation cannot overwrite a new submission',()=>{
  const pending=[{...nodes[1],data:{status:'queued',clickedAt:100,jobStartedAt:50}}];
  const result=reconcileJobs(pending,[{id:'old',nodeId:'b',canvasId:'c',startedAt:50,status:'completed',src:'/media/old.mp4'}],'c');
  assert.equal(result[0],pending[0]);
  const fresh=reconcileJobs(pending,[{id:'new',nodeId:'b',canvasId:'c',startedAt:101,status:'running'}],'c');
  assert.equal(fresh[0].data.jobId,'new');
});
test('clipboard import accepts a graph, ignores plain text, and rejects external media',()=>{
  assert.equal(parseClipboardGraph('normal text'),null);
  assert.equal(parseClipboardGraph(JSON.stringify({format:'tapnow-graph',nodes,edges:[]})).nodes.length,2);
  assert.throws(()=>parseClipboardGraph(JSON.stringify({format:'tapnow-graph',nodes:[{...nodes[1],data:{src:'https://outside.example/image.png'}}],edges:[]})));
});

test('late snapshots and submit responses cannot regress a completed job',()=>{
  const done={id:'job',nodeId:'b',canvasId:'c',startedAt:10,status:'completed',src:'/media/done.mp4'};
  const old={...done,status:'running',src:undefined};
  const merged=mergeJobs([done,{id:'newer',startedAt:20,status:'queued'}],[old]);
  assert.equal(merged.length,2);assert.equal(merged.find(job=>job.id==='job').status,'completed');
  const displayed=reconcileJobs(nodes,[done],'c');
  for(const status of ['queued','running','downloading']){
    const result=reconcileJobs(displayed,[{...old,status}],'c');
    assert.equal(result[1],displayed[1]);assert.equal(result[1].data.src,'/media/done.mp4');
  }
  assert.equal(reconcileJobs(displayed,[{...done,id:'next',startedAt:11,status:'queued'}],'c')[1].data.jobId,'next');
});
test('copied image references follow copied nodes and clear playback sessions',()=>{
  const graph=[{...nodes[0],type:'image',data:{src:'/media/reference.png'}},{...nodes[1],data:{references:[{src:'/media/reference.png',nodeId:'a',role:'start'}],clickedSessionId:'old-session'}}];
  const copy=copyGraph(graph,[]);
  assert.equal(copy.nodes[1].data.references[0].nodeId,copy.nodes[0].id);
  assert.equal(copy.nodes[1].data.clickedSessionId,undefined);
});


test('multi-source creation links each existing source once and places the target beyond the group',()=>{
  const sources=[{...nodes[0],position:{x:-100,y:40},measured:{width:300}}, {...nodes[1],type:'image',position:{x:500,y:240},measured:{width:400}}];
  const before=structuredClone(sources),result=downstreamGraph(sources,['a','b','a','deleted'],'new');
  assert.deepEqual(result.position,{x:980,y:140});assert.equal(result.mode,'reference');
  assert.deepEqual(result.edges.map(({source,target})=>({source,target})),[{source:'a',target:'new'},{source:'b',target:'new'}]);
  assert.equal(new Set(result.edges.map(edge=>edge.id)).size,2);assert.deepEqual(sources,before);
  assert.deepEqual(downstreamGraph(sources,['deleted'],'new'),{position:null,mode:'text',edges:[]});
  const single=downstreamGraph(nodes,'a','new');assert.deepEqual(single.position,{x:420,y:0});assert.equal(single.edges.length,1);
  assert.equal(downstreamGraph(nodes,['a','b'],'a').edges.length,1);
});


test('unrelated and identical job events do not trigger another canvas autosave',()=>{
  assert.equal(reconcileJobs(nodes,[{id:'foreign',nodeId:'new-node',canvasId:'c',startedAt:100,status:'completed'}],'c'),nodes);
  const done={id:'job',nodeId:'b',canvasId:'c',startedAt:100,status:'completed',src:'/media/done.mp4',timings:{serverTotalMs:1000}};
  const displayed=reconcileJobs(nodes,[done],'c');
  displayed[1].data.timings.visibleMs=1100;
  assert.equal(reconcileJobs(displayed,[done],'c'),displayed);
  assert.equal(displayed[1].data.timings.visibleMs,1100);
});
