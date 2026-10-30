import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';import {JSDOM} from 'jsdom';import React,{act,useState} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.requestAnimationFrame=fn=>fn();
const {createRoot}=await import('react-dom/client');const file=new URL('../src/MentionInput.jsx',import.meta.url);
const source=(await readFile(file,'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?new URL(name,file).href:import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});const {default:Input}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function fixture(t){const div=document.createElement('div');document.body.append(div);const root=createRoot(div),picked=[],keys=[];let state;
 function Harness(){const [value,setValue]=useState(''),[mentions,setMentions]=useState([]);state={value,mentions};return React.createElement(Input,{value,mentions,items:[{id:'im',type:'image',title:'图片 1',src:'/media/a.jpg'},{id:'vid',type:'video',title:'视频 1'}],onChange:(v,m)=>{setValue(v);setMentions(m);},onPick:n=>picked.push(n.id),onKeyDown:e=>keys.push(e.key)});}
 act(()=>root.render(React.createElement(Harness)));t.after(()=>{act(()=>root.unmount());div.remove();});const input=div.querySelector('textarea');
 const type=text=>act(()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,text);input.setSelectionRange(text.length,text.length);input.dispatchEvent(new window.InputEvent('input',{bubbles:true}));});
 const key=(key,extra={})=>act(()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,...extra})));
 return {div,input,picked,keys,state:()=>state,type,key};}
test('Agent @ picker selects either media type by keyboard without sending the message',t=>{
 const f=fixture(t);f.type('@');assert.equal(f.div.querySelectorAll('[role=option]').length,2);f.key('ArrowDown');f.key('Enter');assert.deepEqual(f.picked,['vid']);assert.equal(f.state().value,'@视频 1 ');assert.equal(f.state().mentions[0].nodeId,'vid');assert.deepEqual(f.keys,[]);
 f.type('@视频 1 的动作');assert.equal(f.div.querySelector('[role=listbox]'),null);assert.equal(f.state().mentions[0].nodeId,'vid');f.key('Enter');assert.deepEqual(f.keys,['Enter']);
});
test('Chinese IME confirmation cannot select a mention or submit, and names containing spaces can be searched',t=>{
 const f=fixture(t);f.type('@图片 ');assert.equal(f.div.querySelectorAll('[role=option]').length,1);f.key('Enter',{keyCode:229});assert.equal(f.picked.length,0);assert.equal(f.keys.length,0);
 act(()=>f.div.querySelector('[role=option]').click());assert.equal(f.state().value,'@图片 1 ');assert.equal(f.state().mentions[0].nodeId,'im');
});

test('pointer and keyboard share one highlighted option, with aligned thumbnail slots for both media types',t=>{
 const f=fixture(t);f.type('@');const options=[...f.div.querySelectorAll('[role=option]')];
 assert.equal(f.div.querySelectorAll('[aria-selected=true]').length,1);assert.equal(options[0].getAttribute('aria-selected'),'true');
 act(()=>options[1].dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true})));
 assert.equal(options[0].getAttribute('aria-selected'),'false');assert.equal(options[1].getAttribute('aria-selected'),'true');
 f.key('ArrowUp');assert.equal(options[0].getAttribute('aria-selected'),'true');assert.equal(options[1].getAttribute('aria-selected'),'false');
 assert.equal(options[0].querySelector('.agent-mention-thumb').tagName,'SPAN');assert.equal(options[1].querySelector('.agent-mention-thumb').tagName,'SPAN');
 f.key('Enter');assert.deepEqual(f.picked,['im']);
});
