import test from 'node:test';
import assert from 'node:assert/strict';
import {renumberNodes,insertMention,editMentions,rewriteMentions,resolveMentions,mentionQuery} from '../shared/node-mentions.mjs';
import {referencePrompt} from '../shared/reference-prompt.mjs';
import {generationRequest} from '../server/media-request.mjs';
import {flowPayload} from '../server/media-providers.mjs';
import {copyGraph} from '../src/state.mjs';
const image=(id,title='图片')=>({id,type:'image',position:{x:0,y:0},data:{title,src:`/media/${id}.jpg`}});
test('numbering compacts per type without changing identity or manual names; reruns are stable',()=>{
 const initial=renumberNodes([image('a'),image('b'),image('c'),image('d'),image('e'),{...image('v','视频'),type:'video'},image('named','主角')]);
 assert.deepEqual(initial.map(n=>n.data.title),['图片 1','图片 2','图片 3','图片 4','图片 5','视频 1','主角']);
 const remaining=renumberNodes(initial.filter(n=>n.id!=='c'));assert.deepEqual(remaining.filter(n=>n.type==='image').map(n=>n.data.title),['图片 1','图片 2','图片 3','图片 4','主角']);assert.equal(remaining[2].id,'d');assert.equal(renumberNodes(remaining),remaining);
 const manual=renumberNodes([{...image('x','图片 9'),data:{title:'图片 9',autoTitle:false}},image('y')]);assert.equal(manual[0].data.title,'图片 9');assert.equal(manual[1].data.title,'图片 1');
});
test('renumbering updates bound @ tokens, while deleting the bound source never redirects to its replacement number',()=>{
 const nodes=renumberNodes([image('a'),image('b'),image('c')]);const pick=insertMention('参考 @',[],{start:3,end:4},{id:'c',title:'图片 3'});
 const target={id:'out',type:'image',position:{x:0,y:0},data:{title:'结果',prompt:pick.text,mentions:pick.mentions}};
 const next=renumberNodes([...nodes,target].filter(n=>n.id!=='b'));
 assert.match(next.at(-1).data.prompt,/@图片 2/);assert.equal(next.at(-1).data.mentions[0].nodeId,'c');
 assert.throws(()=>resolveMentions(pick.text,pick.mentions,nodes.filter(n=>n.id!=='c')),/已删除/);
 const copy=copyGraph([nodes[2],target],[]);assert.equal(copy.nodes[1].data.mentions[0].nodeId,copy.nodes[0].id);
});
test('editing rebases unaffected mentions, removes changed bindings and supports spaces in the picker query',()=>{
 const pick=insertMention('@',[],{start:0,end:1},{id:'a',title:'图片 1'});
 const moved=editMentions(pick.text,'你好 '+pick.text,pick.mentions);assert.equal(moved[0].start,3);
 assert.deepEqual(editMentions(pick.text,'@图片 9 ',pick.mentions),[]);
 assert.equal(mentionQuery('@图片 ',4).query,'图片 ');assert.equal(mentionQuery(pick.text,pick.text.length,pick.mentions),null);
 assert.equal(resolveMentions('参考@图片 1与@图片 10',[],[image('a','图片 1'),image('b','图片 10')]).length,2);
});
test('provider prompts identify the actual upload order and preserve binding despite same-named nodes',()=>{
 const pick=insertMention('采用 @ 的人物',[],{start:3,end:4},{id:'b',title:'图片 2'});
 const refs=[{src:'/media/a.jpg',role:'reference',nodeId:'a',label:'图片 1'},{src:'/media/b.jpg',role:'reference',nodeId:'b',label:'图片 2'}];
 const input=generationRequest({provider:'flow',kind:'image',prompt:pick.text,references:refs,mentions:pick.mentions,mode:'reference'});
 const payload=flowPayload(input,'project',['upload-a','upload-b']);assert.match(payload.params.prompt,/采用 \[参考图 2\]\s+的人物/);assert.match(payload.params.prompt,/参考图 2（图片 2） = 第 2 张上传图片/);assert.deepEqual(payload.params.ref_media_ids,['upload-a','upload-b']);
 assert.throws(()=>referencePrompt(pick.text,refs.slice(0,1),pick.mentions),/未随请求上传/);
 assert.throws(()=>referencePrompt('参考 @视频 1',refs),/未关联/);
 const leading=generationRequest({provider:'flow',kind:'image',prompt:'  '+pick.text,references:refs,mentions:pick.mentions.map(m=>({...m,start:m.start+2,end:m.end+2})),mode:'reference'});assert.match(leading.prompt,/采用 \[参考图 2\]/);
});
