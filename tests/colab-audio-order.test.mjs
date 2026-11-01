import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareColab} from '../server/colab-client.mjs';

test('explicit audio tags remain stable when preceding videos carry soundtracks',async t=>{
  const media=await mkdtemp(path.join(tmpdir(),'h3-audio-order-'));
  t.after(()=>rm(media,{recursive:true,force:true}));
  const refs=[['clip.mp4','video'],['voice.wav','audio'],['subject.jpg','image'],['music.wav','audio']];
  for(const [name] of refs)await writeFile(path.join(media,name),name);
  const remote=async(route,options)=>{
    if(route==='/v1/session')return {json:async()=>({sessionId:'test',phase:'ready',tasks:['ref2va']})};
    return {json:async()=>({assetId:options.body.toString()})};
  };
  const {body}=await prepareColab({mode:'reference',prompt:'<Audio 1> voice and <Audio 2> music with <Video 1>',duration:4,references:refs.map(([name,type])=>({src:'/media/'+name,type,role:'reference'}))},remote,{},media);
  assert.deepEqual(body.conditions.map(c=>c.assetId),['voice.wav','music.wav','clip.mp4','subject.jpg']);
  assert.equal(body.prompt,'<Audio 1> voice and <Audio 2> music with <Video 1>');
});
