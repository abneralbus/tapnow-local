import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasAgentContext} from '../src/agent-context.mjs';

test('selected media includes upstream text across a cycle without unrelated content or media URLs',()=>{
  const nodes=[{id:'script',type:'text',data:{title:'剧本',text:'小狐狸进入松林'}},{id:'image',type:'image',data:{title:'首帧',prompt:'晨光',src:'/media/private.jpg'}},{id:'video',type:'video',selected:true,data:{title:'镜头',prompt:'缓缓推进',src:'/media/private.mp4',status:'completed'}},{id:'other',type:'text',data:{text:'无关草稿'}}];
  const text=canvasAgentContext({name:'短片',nodes,edges:[{source:'script',target:'image'},{source:'image',target:'video'},{source:'video',target:'script'}]});
  assert.match(text,/小狐狸进入松林/);assert.match(text,/晨光/);assert.match(text,/镜头（选中）/);assert.match(text,/script → image/);assert.match(text,/未提供图片像素/);
  assert.doesNotMatch(text,/无关草稿|\/media\//);assert.equal(nodes[0].selected,undefined);
});

test('unselected canvas provides a bounded overview and handles empty canvases',()=>{
  assert.match(canvasAgentContext({nodes:[],edges:[]}),/共 0 个节点/);
  const text=canvasAgentContext({name:'草稿',nodes:Array.from({length:100},(_,i)=>({id:String(i),type:'text',data:{text:'内容'.repeat(3000)}})),edges:[]});
  assert.match(text,/当前画布概述/);assert.match(text,/其余节点已省略/);assert.ok(text.length<=16000);
});
