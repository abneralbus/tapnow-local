import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';import {JSDOM} from 'jsdom';import React,{act,useState} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const source=(await readFile(new URL('../src/ModelConnections.jsx',import.meta.url),'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?new URL('../src/'+name,import.meta.url).href:import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});const {default:Connections}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('connection groups separate services and Agent saves the chosen CLI or API without losing Colab fields',async t=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),calls=[];
  const options=[{id:'codex-cli',name:'Codex CLI',kind:'cli',available:true},{id:'claude-cli',name:'Claude CLI',kind:'cli',available:true},{id:'agy-cli',name:'agy CLI',kind:'cli',available:true},{id:'deepseek',name:'DeepSeek',kind:'api',model:'fixture',baseUrl:'https://api.deepseek.com',hasKey:true},{id:'openai',name:'OpenAI',kind:'api',model:'fixture',baseUrl:'https://api.openai.com/v1'}];
  let state;
  function Harness(){const [config,setConfig]=useState({agentProvider:'codex-cli',agentModel:'Codex CLI',hasAgent:true,agentOptions:options,colabUrl:'https://colab.example',colabToken:'unsaved-colab-token'});state=config;return React.createElement(Connections,{config,setConfig,providers:{},api:async(route,body)=>{if(route==='/colab/session')return {variant:'fl2va',phase:'ready',canRelease:true};calls.push({route,body});return {agentProvider:body.provider,agentModel:options.find(p=>p.id===body.provider).name,agentOptions:options,hasAgent:true};},json:v=>v,refresh:async()=>{},save:()=>{},checkHealth:()=>{}});}
  await act(async()=>root.render(React.createElement(Harness)));t.after(()=>{act(()=>root.unmount());div.remove();});
  const click=async(el)=>act(async()=>el.click()),nav=()=>[...div.querySelectorAll('.connection-nav button')];
  assert.ok(div.querySelector('.agent-settings'));assert.equal(div.querySelector('.cloud-services'),null);assert.equal(div.querySelector('.colab-service'),null);
  await click(nav()[1]);assert.match(div.textContent,/Google Flow/);assert.match(div.textContent,/Muse/);assert.equal(div.querySelector('.agent-settings'),null);
  await click(nav()[2]);assert.equal(div.querySelector('.colab-service input').value,'https://colab.example');
  await click(nav()[0]);const select=div.querySelector('select');await act(async()=>{select.value='claude-cli';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await click(div.querySelector('.agent-save-actions .primary'));assert.equal(calls[0].route,'/agent/config');assert.equal(calls[0].body.provider,'claude-cli');assert.equal(state.colabToken,'unsaved-colab-token');assert.equal(state.agentProvider,'claude-cli');
  await click(div.querySelectorAll('.agent-method button')[1]);assert.match(div.querySelector('select').textContent,/DeepSeek/);assert.match(div.querySelector('select').textContent,/OpenAI/);assert.equal(div.querySelector('[aria-label="Agent API Key"]').type,'password');
  await click(div.querySelector('.agent-save-actions .primary'));assert.equal(calls[1].body.provider,'deepseek');assert.equal(calls[1].body.apiKey,'');assert.equal(state.colabUrl,'https://colab.example');
});

test('Colab auto-release can be enabled and saved while GPU is offline',async t=>{
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);let state;const calls=[];
 t.after(()=>{act(()=>root.unmount());div.remove();});
 function Harness(){const [config,setConfig]=useState({colabUrl:'https://offline.example',hasToken:true,colabAutoRelease:false});state=config;return React.createElement(Connections,{config,setConfig,providers:{},json:v=>v,api:async(route,body)=>{if(route==='/colab/session')throw Error('Colab is offline');calls.push({route,body});return {autoRelease:body.autoRelease,synced:false};},refresh:async()=>{},save:()=>{},checkHealth:()=>{}});}
 await act(async()=>root.render(React.createElement(Harness)));
 await act(async()=>div.querySelectorAll('.connection-nav button')[2].click());
 const checkbox=div.querySelector('input[type="checkbox"]');assert.ok(checkbox);assert.equal(checkbox.disabled,false);
 await act(async()=>checkbox.click());
 assert.equal(checkbox.checked,true);assert.equal(state.colabAutoRelease,true);assert.equal(state.hasToken,true);
 assert.deepEqual(calls,[{route:'/colab/settings',body:{autoRelease:true}}]);assert.match(div.textContent,/已保存到本机，下次连接或生成时自动应用/);
});
