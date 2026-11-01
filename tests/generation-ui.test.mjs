import test from 'node:test';
import assert from 'node:assert/strict';
import {generationIssue,modeReferences} from '../src/generation.mjs';
const start={src:'/media/start.png',role:'start',nodeId:'a'};
const end={src:'/media/end.png',role:'end',nodeId:'b'};
const ref={...start,role:'reference'};

test('frame mode retains an end frame so unsupported input is never silently dropped',()=>{
  const selected=modeReferences([start,end,ref],'frames');
  assert.deepEqual(selected,[start,end]);
  for(const provider of ['flow','muse'])assert.match(generationIssue('video',provider,'frames',selected,undefined,8),/尾帧/);
});
test('Flow controls match single-frame and multi-reference capabilities',()=>{
  assert.equal(generationIssue('video','flow','frames',[start],'veo-fast',8),'');
  assert.match(generationIssue('video','flow','frames',[start],'veo-fast',4),/8 秒/);
  assert.match(generationIssue('video','flow','text',[],'veo-fast',8),/首帧|frames/);
  assert.equal(generationIssue('video','flow','reference',[ref,{...end,role:'reference'}],'omni',6),'');
  assert.match(generationIssue('video','flow','reference',[ref],'omni',5),/4、6、8、10/);
});
test('Colab accepts references and Muse uses its real model ids',()=>{
  assert.equal(generationIssue('video','colab','text',[],'MiniMaxAI/MiniMax-H3',4),'');
  assert.equal(generationIssue('video','colab','reference',[ref],undefined,4),'');
  assert.equal(generationIssue('video','colab','frames',[start,end],undefined,4),'');
  assert.equal(generationIssue('image','muse','reference',[ref],'muse-image'),'');
  assert.match(generationIssue('image','muse','text',[],'sora'),/不支持所选模型/);
});

test('providers do not silently reinterpret first frames as generic references',()=>{
  assert.match(generationIssue('video','flow','reference',[ref],'veo-fast',8),/首帧|frames/);
  assert.match(generationIssue('video','flow','frames',[start],'omni',8),/参考|reference/);
  assert.match(generationIssue('video','muse','frames',[start],'muse-video',4),/尚不能锁定|仅支持图片参考/);
});

test('new video nodes use Flow with valid frame or multi-reference defaults',async()=>{
  const {newGenerationData}=await import('../src/generation.mjs');
  const image={id:'a',type:'image',data:{src:'/media/start.png'}};
  const single=newGenerationData('video',[image]);
  assert.equal(single.provider,'flow');assert.equal(single.mode,'frames');
  assert.equal(generationIssue('video',single.provider,single.mode,single.references,single.model,single.duration),'');
  const multi=newGenerationData('video',[image,{id:'b',type:'image',data:{src:'/media/end.png'}}]);
  assert.equal(multi.model,'omni');assert.equal(multi.mode,'reference');
  assert.equal(generationIssue('video',multi.provider,multi.mode,[ref,{...end,role:'reference'}],multi.model,multi.duration),'');
  const empty=newGenerationData('video');assert.equal(empty.mode,'frames');assert.match(generationIssue('video','flow',empty.mode,[],empty.model,empty.duration),/首帧/);
  assert.equal(newGenerationData('image',[image]).mode,'reference');
});
