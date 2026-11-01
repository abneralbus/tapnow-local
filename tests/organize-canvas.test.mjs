import test from 'node:test';
import assert from 'node:assert/strict';
import {organizePrompt,organizePermissions,organizationDependencies,verifyOrganization,organizationFingerprint} from '../shared/organize-canvas.mjs';
import {planActions} from '../shared/agent-actions.mjs';
const nodes=[{id:'a',type:'image',position:{x:0,y:0},measured:{width:320,height:420},data:{title:'图片 1',prompt:''}},{id:'b',type:'video',position:{x:10,y:0},measured:{width:320,height:300},data:{title:'视频 1',prompt:'使用 @图片 1 作为参考'}},{id:'c',type:'image',position:{x:0,y:0},measured:{width:320,height:420},data:{title:'图片 2',prompt:''}}];
const moves=[{type:'move',id:'a',x:0,y:0},{type:'move',id:'b',x:600,y:0},{type:'move',id:'c',x:0,y:600}];
test('explicit mentions determine dependencies, blank prompts and numbering never invent edges',()=>{
 assert.deepEqual(organizationDependencies(nodes),{edges:[{source:'a',target:'b'}],issues:[]});
 assert.match(organizePrompt,/待执行/);assert.match(organizePrompt,/450—800/);
 assert.equal(organizePermissions.create,false);assert.equal(organizePermissions.generate,false);
});
test('complete proposal rebuilds wrong old edges and validates before any mutation',()=>{
 const before={nodes,edges:[{id:'wrong',source:'b',target:'c'}]};
 const actions=[{type:'disconnect',source:'b',target:'c'},...moves,{type:'connect',source:'a',target:'b'}];
 const after=planActions(nodes,before.edges,actions,organizePermissions);const result=verifyOrganization(before,after,actions);
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(before.edges[0].id,'wrong');assert.equal(before.nodes[1].position.x,10);
 assert.notEqual(organizationFingerprint(nodes,[]),organizationFingerprint(after.nodes,after.edges));
});
test('omission, stale wrong edges, overlap, text edits and unauthorized changes fail validation',()=>{
 const after=planActions(nodes,[],[...moves,{type:'connect',source:'a',target:'b'}],organizePermissions);
 assert.equal(verifyOrganization({nodes},after,moves.slice(0,2)).ok,false);
 const overlap=structuredClone(after);overlap.nodes[2].position={x:0,y:0};assert.equal(verifyOrganization({nodes},overlap,moves).ok,false);
 const edited=structuredClone(after);edited.nodes[0].data.prompt='changed';assert.equal(verifyOrganization({nodes},edited,moves).ok,false);
 assert.equal(verifyOrganization({nodes},{...after,edges:[]},moves).ok,false);
 assert.throws(()=>planActions(nodes,[],[{type:'prompt',id:'a',text:'changed'}],organizePermissions),/未授予/);
});
test('unresolved references, duplicate names and cycles require clarification',()=>{
 assert.ok(organizationDependencies([{...nodes[1],data:{prompt:'@图片99'}}]).issues.length);
 assert.ok(organizationDependencies([...nodes,{...nodes[0],id:'duplicate'}]).issues.length);
 const cycle=[{...nodes[0],data:{title:'图片 1',prompt:'@视频 1'}},nodes[1]];
 assert.match(organizationDependencies(cycle).issues.join(' '),/循环/);
});
