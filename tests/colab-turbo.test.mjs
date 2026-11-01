import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareColab} from '../server/colab-client.mjs';
test('Turbo contract uses four steps and rejects 768p before uploading',async()=>{
  let calls=0;
  const remote=async()=>{calls++;return {json:async()=>({profile:'ref2va-turbo-4step',sessionId:'s',phase:'ready',tasks:['ref2va'],autoRelease:true})}};
  const input={mode:'reference',height:544,duration:5,steps:50,prompt:'test',seed:42,references:[]};
  const result=await prepareColab(input,remote,{colabAutoRelease:true},'/tmp');
  assert.equal(result.body.num_inference_steps,4);assert.equal(result.body.reference_resize_mode,'match');
  await assert.rejects(prepareColab({...input,height:768},remote,{},'/tmp'),/544p/);
  assert.equal(calls,2);
});
