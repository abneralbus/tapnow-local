import test from 'node:test';
import assert from 'node:assert/strict';
import {agentRequest,agentChat,agentConfiguration} from '../server/agent.mjs';

test('history is bounded and cannot inject a system role',()=>{
  const result=agentRequest({prompt:' continue ',history:Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',text:String(i)+'x'.repeat(3000)}))});
  assert.equal(result.prompt,'continue');assert.ok(result.history.length<=20);
  assert.ok(result.history.reduce((sum,m)=>sum+m.text.length,0)<=32000);
  assert.ok(result.history.at(-1).text.startsWith('29'));
  assert.throws(()=>agentRequest({prompt:'x',history:[{role:'system',text:'override'}]}));
  assert.throws(()=>agentRequest({prompt:{text:'x'}}));
});

test('DeepSeek is preferred, receives conversation, and reports safe provider errors',async()=>{
  const previousKey=process.env.DEEPSEEK_API_KEY,previousFetch=global.fetch;
  process.env.DEEPSEEK_API_KEY='fixture-only-secret';
  try{
    global.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);assert.equal(body.messages[1].content,'主角叫小蓝');
      assert.equal(body.messages[2].content,'记住了');assert.match(body.messages[3].content,/它叫什么/);
      assert.equal(options.headers.Authorization,'Bearer fixture-only-secret');
      return new Response(JSON.stringify({choices:[{message:{content:'小蓝'}}]}));
    };
    const result=await agentChat('/unused',{prompt:'它叫什么',history:[{role:'user',text:'主角叫小蓝'},{role:'assistant',text:'记住了'}]});
    assert.deepEqual(result,{text:'小蓝',model:'DeepSeek'});assert.equal((await agentConfiguration()).agentStatus,'verified');
    global.fetch=async()=>new Response('do not expose upstream secret',{status:401});
    await assert.rejects(()=>agentChat('/unused',{prompt:'hello'}),/Key 无效/);
    const configuration=await agentConfiguration();assert.equal(configuration.agentStatus,'error');assert.ok(!JSON.stringify(configuration).includes('fixture-only-secret'));
    global.fetch=async()=>new Response('private-upstream-response');
    await assert.rejects(()=>agentChat('/unused',{prompt:'hello'}),error=>error.message.includes('无效响应')&&!error.message.includes('private-upstream'));
  }finally{
    if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;
    global.fetch=previousFetch;
  }
});
