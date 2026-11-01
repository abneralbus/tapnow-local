import test from 'node:test';
import assert from 'node:assert/strict';
import {permissions,actionInstructions,validateActions,decodeActions,planActions} from '../shared/agent-actions.mjs';
import {canvasAgentContext} from '../src/agent-context.mjs';
const nodes=[{id:'a',type:'text',position:{x:0,y:0},data:{title:'脚本',text:'原文'}},{id:'b',type:'video',position:{x:400,y:0},data:{prompt:'原提示词',src:'/media/demo.mp4'}}];
const all=Object.fromEntries(['move','create','connect','disconnect','delete','prompt','generate'].map(k=>[k,true]));
test('permissions default to readonly; strings and unknown actions cannot grant access',()=>{
 assert.equal(Object.values(permissions({create:'true'})).some(Boolean),false);
 for(const type of Object.keys(all))assert.throws(()=>validateActions([{type,id:'a'}],{}),/未授予/);
 assert.throws(()=>validateActions([{type:'shell',id:'a'}],all),/不支持/);
 assert.deepEqual(decodeActions('普通回复',{}),{text:'普通回复',actions:[]});
 assert.throws(()=>decodeActions('{"text":"已删除","actions":[{"type":"delete","id":"a"}]}',{}),/未授予/);
});
test('move-only changes positions without editing originals; malformed or stale batches do not partly apply',()=>{
 const result=planActions(nodes,[],[{type:'move',id:'a',x:100,y:200}],{move:true});
 assert.deepEqual(result.nodes[0].position,{x:100,y:200});assert.equal(nodes[0].position.x,0);assert.equal(result.nodes[0].data.text,'原文');
 assert.throws(()=>planActions(nodes,[],[{type:'move',id:'a',x:100,y:200},{type:'delete',id:'missing'}],all),/不存在/);assert.equal(nodes[0].position.x,0);
 assert.throws(()=>planActions(nodes,[],[{type:'move',id:'a',x:Infinity,y:0}],all),/坐标/);
});
test('created temporary IDs resolve for links and generation; deletion removes incident links',()=>{
 let n=0;const result=planActions(nodes,[],[{type:'create',id:'new',kind:'image',title:'首帧',x:0,y:300,prompt:'画森林',sourceIds:['a']},{type:'prompt',id:'new',text:'晴天森林'},{type:'generate',id:'new'},{type:'delete',id:'b'}],all,{newId:()=>`id${++n}`});
 assert.equal(result.nodes.length,2);assert.equal(result.nodes[1].data.prompt,'晴天森林');assert.deepEqual(result.generate,['id1']);assert.equal(result.edges[0].source,'a');assert.equal(result.edges[0].target,'id1');
 const deleted=planActions(nodes,[{id:'edge',source:'a',target:'b'}],[{type:'delete',id:'a'}],all);assert.equal(deleted.edges.length,0);
 assert.throws(()=>planActions(nodes,[],[{type:'generate',id:'b'}],{generate:true}),/创建节点权限/);
 assert.throws(()=>planActions([{...nodes[1],data:{status:'running'}}],[],[{type:'delete',id:'b'}],all),/正在生成/);
});
test('explicit references stay attached independently of selection and include upstream text',()=>{
 const context=canvasAgentContext({nodes:[{...nodes[0],selected:false},{...nodes[1],selected:false},{id:'c',type:'text',selected:true,data:{text:'不相关'}}],edges:[{source:'a',target:'b'}],referenceIds:['b']});
 assert.match(context,/原文/);assert.match(context,/原提示词/);assert.match(context,/不相关/);
});

test('connect and disconnect edit directed edges without changing nodes or requiring node-edit grants',()=>{
 const grants={move:true,connect:true,disconnect:true};
 const edges=[{id:'old',source:'a',target:'b'}];
 const result=planActions(nodes,edges,[{type:'disconnect',source:'a',target:'b'},{type:'connect',source:'b',target:'a'},{type:'connect',source:'b',target:'a'}],grants);
 assert.deepEqual(result.nodes,nodes);assert.equal(result.edges.length,1);
 assert.equal(result.edges[0].source,'b');assert.equal(result.edges[0].target,'a');
 assert.deepEqual(edges,[{id:'old',source:'a',target:'b'}]);assert.deepEqual(result.generate,[]);
 assert.throws(()=>planActions(nodes,edges,[{type:'disconnect',source:'b',target:'a'}],grants),/连线已不存在/);
});
test('edge actions validate permissions and endpoints and reject stale batches atomically',()=>{
 for(const type of ['connect','disconnect']){
  assert.throws(()=>validateActions([{type,source:'a',target:'b'}],{create:true,delete:true}),/未授予/);
  assert.throws(()=>validateActions([{type,source:'a',target:42}],all),/端点/);
  assert.throws(()=>validateActions([{type,source:'a',target:'a'}],all),/自身/);
 }
 const edges=[];
 assert.throws(()=>planActions(nodes,edges,[{type:'connect',source:'a',target:'b'},{type:'connect',source:'missing',target:'a'}],all),/不存在/);
 assert.deepEqual(edges,[]);
 assert.equal(validateActions(Array.from({length:100},()=>({type:'connect',source:'a',target:'b'})),all).length,100);
 assert.match(actionInstructions(all),/"type":"connect","source"/);
 assert.match(actionInstructions(all),/"type":"disconnect","source"/);
 assert.equal(decodeActions(JSON.stringify({text:'建议连接',actions:[{type:'connect',source:'a',target:'b'}]}),all).actions.length,1);
});
test('connections resolve newly created aliases and disconnect only the specified direction',()=>{
 let id=0;
 const result=planActions(nodes,[],[{type:'create',id:'new',kind:'image',title:'新节点',x:0,y:0},{type:'connect',source:'a',target:'new'}],all,{newId:()=>`test${++id}`});
 assert.equal(result.edges[0].target,result.nodes[2].id);
 const remaining=planActions(nodes,[{id:'ab',source:'a',target:'b'},{id:'ba',source:'b',target:'a'}],[{type:'disconnect',source:'a',target:'b'}],all);
 assert.deepEqual(remaining.edges,[{id:'ba',source:'b',target:'a'}]);
});

test('large batches execute fully and creation accepts more than twenty reference edges',()=>{
 const many=Array.from({length:100},(_,i)=>({id:`n${i}`,type:'text',position:{x:0,y:0},data:{text:'keep'}}));
 const actions=many.map((n,i)=>({type:'move',id:n.id,x:i*300,y:100}));
 const result=planActions(many,[],actions,{move:true});
 assert.equal(result.nodes[99].position.x,29700);
 assert.equal(result.nodes[99].position.y,100);
 assert.equal(many[99].position.x,0);
 const created=planActions(many,[],[{type:'create',id:'new',kind:'text',title:'references',x:0,y:0,sourceIds:many.map(n=>n.id)}],{create:true});
 assert.equal(created.edges.length,100);
 assert.throws(()=>validateActions({},all),/格式/);
 assert.doesNotMatch(actionInstructions(all),/最多20项/);
});
