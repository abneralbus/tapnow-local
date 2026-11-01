import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasAgentContext} from '../src/agent-context.mjs';
import {agentRequest} from '../server/agent.mjs';
test('full canvas exposes measured geometry and references without private media paths',()=>{
 const nodes=[{id:'a',type:'image',position:{x:20,y:40},measured:{width:328,height:400},data:{title:'图片 1',prompt:'晨光',width:1920,height:1080,src:'/media/private.png'}},{id:'b',type:'video',selected:true,data:{prompt:'@图片 1',mentions:[{nodeId:'a',token:'@图片 1',start:0,end:5}]}},{id:'c',type:'text',data:{text:'未选中草稿'}}];
 const text=canvasAgentContext({nodes,edges:[{id:'e',source:'a',target:'b'}],referenceIds:['b']});const snapshot=JSON.parse(text);
 assert.equal(snapshot.nodes.length,3);assert.equal(snapshot.nodes[0].width,328);assert.equal(snapshot.nodes[0].height,400);assert.equal(snapshot.nodes[0].media.width,1920);
 assert.equal(snapshot.nodes[1].referenced,true);assert.equal(snapshot.nodes[1].width,null);assert.equal(snapshot.edges[0].id,'e');
 assert.match(text,/未选中草稿/);assert.doesNotMatch(text,/private.png/);assert.match(text,/未提供图片像素/);
});
test('large canvases and long prompts survive client context and backend request without truncation',()=>{
 const nodes=Array.from({length:100},(_,i)=>({id:String(i),type:'text',data:{text:'内容'.repeat(3000)+'END'+i}}));
 const edges=nodes.slice(1).map((n,i)=>({id:'e'+i,source:String(i),target:n.id}));
 const text=canvasAgentContext({nodes,edges});const received=JSON.parse(agentRequest({prompt:'整理',context:text}).context);
 assert.equal(received.nodeCount,100);assert.equal(received.nodes.length,100);assert.equal(received.edges.length,99);assert.ok(received.nodes[99].text.endsWith('END99'));assert.equal(received.complete,true);
 assert.equal(JSON.parse(canvasAgentContext({})).nodeCount,0);
});
