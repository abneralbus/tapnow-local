import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act,useState} from 'react';
import {mentionCandidates,connectMention} from '../shared/node-mentions.mjs';
import {canvasDocument} from '../server/validation.mjs';
const dom=new JSDOM('<html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.requestAnimationFrame=fn=>fn();
const {createRoot}=await import('react-dom/client');
const file=new URL('../src/GenerationPanel.jsx',import.meta.url);
const source=(await readFile(file,'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?new URL(name,file).href:import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});
const {default:Panel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function fixture(t,initialEdges=[]){
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);let state;
 const sources=[{id:'text',type:'text',position:{x:100,y:0},data:{title:'场景文本',text:'清晨的森林'}},{id:'image',type:'image',position:{x:200,y:-10},data:{title:'角色图片',src:'/media/hero.png'}},{id:'video',type:'video',position:{x:0,y:30},data:{title:'动作视频',src:'/media/motion.mp4'}}];
 function Harness(){
  const [data,setData]=useState({title:'结果',provider:'colab',mode:'text',prompt:''}),[edges,setEdges]=useState(initialEdges);
  const nodes=[...sources,{id:'out',type:'video',position:{x:500,y:0},data}];state={data,edges,nodes};
  const update=(_id,patch)=>setData(old=>({...old,...patch}));
  return React.createElement(Panel,{id:'out',type:'video',data,actions:{images:[],media:[],mentionItems:id=>mentionCandidates(nodes,edges,id),update,pickMention:(id,patch,item)=>{update(id,patch);setEdges(old=>connectMention(nodes,old,item.id,id));}}});
 }
 act(()=>root.render(React.createElement(Harness)));t.after(()=>{act(()=>root.unmount());div.remove();});
 const input=div.querySelector('textarea');
 return {div,state:()=>state,type:text=>act(()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,text);input.setSelectionRange(text.length,text.length);input.dispatchEvent(new window.InputEvent('input',{bubbles:true}));}),key:key=>act(()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true})))};
}
test('unconnected @ selects text, creates an input edge, then restricts the next picker without making a media reference',t=>{
 const f=fixture(t);f.type('@');
 assert.deepEqual([...f.div.querySelectorAll('[role=option]')].map(e=>e.querySelector('small').previousElementSibling.textContent),['角色图片','场景文本','动作视频']);
 f.key('ArrowDown');f.key('Enter');
 assert.equal(f.state().data.prompt,'@场景文本 ');assert.equal(f.state().data.mode,'text');assert.equal(f.state().data.references,undefined);
 assert.equal(f.state().edges[0].source,'text');assert.equal(f.state().edges[0].target,'out');
 canvasDocument({name:'test',nodes:f.state().nodes,edges:f.state().edges});
 f.type(f.state().data.prompt+'@');assert.equal(f.div.querySelectorAll('[role=option]').length,1);
 f.key('Enter');assert.equal(f.state().edges.length,1);
});
test('existing connections limit @ to sorted inputs, retain media bindings and never duplicate edges',t=>{
 const f=fixture(t,[{id:'1',source:'video',target:'out'},{id:'2',source:'image',target:'out'}]);f.type('@');
 const options=[...f.div.querySelectorAll('[role=option]')];assert.equal(options.length,2);assert.match(options[0].textContent,/角色图片/);assert.match(options[1].textContent,/动作视频/);
 act(()=>options[1].click());
 assert.equal(f.state().data.mentions[0].nodeId,'video');assert.equal(f.state().data.references[0].src,'/media/motion.mp4');assert.equal(f.state().data.mode,'reference');assert.equal(f.state().edges.length,2);
 f.type(f.state().data.prompt+'@场景');assert.equal(f.div.querySelectorAll('[role=option]').length,0);
});
