import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {writeAgentSettings,readAgentSettings,agentEndpoint} from '../server/agent-settings.mjs';
import {agentConfiguration,agentChat,apiRequest,apiText} from '../server/agent.mjs';
import {cliArgs,cliText} from '../server/agent-cli.mjs';
async function directory(t){const dir=await mkdtemp(path.join(os.tmpdir(),'tapnow-agent-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('provider profiles persist independently, blank keys preserve secrets, and public config never exposes them',async t=>{
  const dir=await directory(t);
  await writeAgentSettings(dir,{provider:'openai',baseUrl:'https://api.openai.com/v1',model:'fixture-model',apiKey:'private-fixture-key'});
  await writeAgentSettings(dir,{provider:'claude-cli',model:'sonnet'});
  await writeAgentSettings(dir,{provider:'openai',baseUrl:'https://api.openai.com/v1',model:'new-model',apiKey:''});
  const saved=await readAgentSettings(dir);assert.equal(saved.profiles.openai.apiKey,'private-fixture-key');assert.equal(saved.profiles['claude-cli'].model,'sonnet');
  assert.equal((await stat(path.join(dir,'agent-config.json'))).mode&0o777,0o600);
  const pub=await agentConfiguration(dir);assert.equal(pub.agentProvider,'openai');assert.ok(pub.hasAgent);assert.ok(!JSON.stringify(pub).includes('private-fixture-key'));
  await assert.rejects(()=>writeAgentSettings(dir,{provider:'openai',baseUrl:'https://other.example/v1',model:'new-model',apiKey:''}),/重新填写/);
  assert.equal((await readAgentSettings(dir)).profiles.openai.baseUrl,'https://api.openai.com/v1');
  await writeAgentSettings(dir,{provider:'openai',baseUrl:'https://api.openai.com/v1',model:'new-model',clearKey:true});
  assert.equal((await agentConfiguration(dir)).hasAgent,false);
});
test('invalid API settings fail before touching persisted configuration',async t=>{
  const dir=await directory(t);
  await writeAgentSettings(dir,{provider:'codex-cli',model:''});const before=await readFile(path.join(dir,'agent-config.json'),'utf8');
  for(const body of [{provider:'unknown',model:''},{provider:'openai',model:''},{provider:'openai',model:'x',baseUrl:'https://user:pass@host.test'},{provider:'openai',model:'x',baseUrl:'https://host.test?key=secret'},{provider:'openai',model:'x',baseUrl:'https://host.test',apiKey:'bad\nkey'}])await assert.rejects(()=>writeAgentSettings(dir,body));
  assert.equal(await readFile(path.join(dir,'agent-config.json'),'utf8'),before);assert.equal(agentEndpoint('http://localhost:4318/'),'http://localhost:4318');assert.throws(()=>agentEndpoint('http://example.com'));
});
test('all supported API protocols preserve conversation and extract only user-visible text',()=>{
  const messages=[{role:'user',text:'主角小蓝'},{role:'assistant',text:'记住了'}];
  for(const protocol of ['chat','responses','anthropic','gemini']){
    const {url,options}=apiRequest({protocol,baseUrl:'https://models.example/v1',apiKey:'secret',model:'model-test'},'它叫什么','画布',messages),body=JSON.parse(options.body);
    assert.equal(options.redirect,'error');assert.ok(!url.includes('secret'));assert.ok(options.signal);assert.match(options.body,/主角小蓝/);assert.match(options.body,/它叫什么/);
    if(protocol==='anthropic'){assert.match(url,/\/messages$/);assert.equal(options.headers['x-api-key'],'secret');assert.equal(body.max_tokens,4096);assert.equal(apiText(protocol,{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'小蓝'}]}),'小蓝');}
    if(protocol==='gemini'){assert.match(url,/models\/model-test:generateContent$/);assert.equal(body.contents[1].role,'model');assert.equal(apiText(protocol,{candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:'小蓝'}]}}]}),'小蓝');}
    if(protocol==='responses'){assert.equal(body.store,false);assert.equal(apiText(protocol,{output:[{type:'message',content:[{type:'output_text',text:'小蓝'}]}]}),'小蓝');}
    if(protocol==='chat')assert.equal(apiText(protocol,{choices:[{message:{content:'小蓝'}}]}),'小蓝');
    assert.throws(()=>apiText(protocol,{}),/正文/);
  }
});
test('saved provider is used for chat and verified state is scoped to configuration',async t=>{
  const dir=await directory(t),previous=global.fetch;t.after(()=>{global.fetch=previous;});
  await writeAgentSettings(dir,{provider:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:'fixture-model',apiKey:'local-secret'});
  global.fetch=async(url,options)=>{assert.match(url,/messages$/);assert.equal(options.headers['x-api-key'],'local-secret');return new Response(JSON.stringify({content:[{type:'text',text:'成功'}]}));};
  assert.deepEqual(await agentChat(dir,{prompt:'你好'}),{text:'成功',model:'Anthropic / Claude'});assert.equal((await agentConfiguration(dir)).agentStatus,'verified');
  await writeAgentSettings(dir,{provider:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:'different-model',apiKey:''});assert.equal((await agentConfiguration(dir)).agentStatus,'available');
  global.fetch=async()=>new Response('private-upstream-error',{status:403});await assert.rejects(()=>agentChat(dir,{prompt:'你好'}),/Key 无效/);
  assert.ok(!JSON.stringify(await agentConfiguration(dir)).includes('private-upstream-error'));
});
test('CLI arguments keep tool permissions bounded and parse the actual print result format',()=>{
  const claude=cliArgs('claude-cli','sonnet'),agy=cliArgs('agy-cli','custom');
  assert.equal(claude[claude.indexOf('--tools')+1],'');assert.equal(claude[claude.indexOf('--permission-mode')+1],'dontAsk');assert.ok(claude.includes('--strict-mcp-config'));assert.ok(claude.includes('--no-session-persistence'));
  assert.ok(agy.includes('--sandbox'));assert.equal(agy[agy.indexOf('--mode')+1],'plan');assert.ok(!agy.includes('--dangerously-skip-permissions'));assert.ok(!agy.includes('--remote-control'));
  assert.equal(cliText('{"type":"result","result":"连接正常。","is_error":false}'),'连接正常。');assert.throws(()=>cliText('{"is_error":true,"result":"private diagnostic"}'),/调用失败/);
});
test('action-mode chat delivers the action protocol and complete canvas as system instructions',async t=>{
 const dir=await directory(t),previous=global.fetch;t.after(()=>{global.fetch=previous;});
 await writeAgentSettings(dir,{provider:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:'fixture-model',apiKey:'local-secret'});
 global.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.match(body.system,/"type":"connect"/);assert.match(body.system,/CANVAS_FINAL_NODE/);assert.equal(body.messages.at(-1).content,'整理');return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify({text:'待执行',actions:[{type:'connect',source:'a',target:'b'}]})}]}));};
 const result=await agentChat(dir,{prompt:'整理',context:'x'.repeat(20000)+'CANVAS_FINAL_NODE',permissions:{connect:true}});
 assert.equal(result.actions[0].type,'connect');
});
