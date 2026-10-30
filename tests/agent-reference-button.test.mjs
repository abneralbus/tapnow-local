import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const source=(await readFile(new URL('../src/AgentReferenceButton.jsx',import.meta.url),'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});
const {default:Button}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const nodes=[{id:'a',type:'image',position:{x:12,y:34},data:{title:'首帧',src:'/media/a.jpg'}},{id:'b',type:'video',position:{x:56,y:78},data:{title:'镜头'}}];
function fixture(t){
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),target=document.createElement('div');document.body.append(target);
 target.getBoundingClientRect=()=>({left:600,right:900,top:400,bottom:650,width:300,height:250});
 const refs=[],hover=[],opens=[];act(()=>root.render(React.createElement(Button,{nodes,onReference:ids=>refs.push(ids),onOpenAgent:()=>opens.push(true),getDropTarget:()=>target,onHoverChange:value=>hover.push(value)})));
 const button=container.querySelector('button');button.getBoundingClientRect=()=>({left:100,right:220,top:50,bottom:80,width:120,height:30});
 const emit=(el,name,x=120,y=60,extra={})=>act(()=>{const event=new window.MouseEvent(name,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,detail:1});Object.defineProperties(event,{pointerId:{value:extra.pointerId??1},isPrimary:{value:true}});el.dispatchEvent(event);});
 t.after(()=>{act(()=>root.unmount());container.remove();target.remove();});return {root,button,refs,hover,opens,emit};
}
test('click and keyboard reference directly; a small movement does not start a drag',t=>{
 const f=fixture(t);f.emit(f.button,'pointerdown');f.emit(window,'pointermove',122,62);assert.equal(document.querySelector('.agent-ref-flight'),null);
 f.emit(window,'pointerup',122,62);f.emit(f.button,'click');assert.deepEqual(f.refs,[['a','b']]);assert.equal(f.opens.length,0);
 act(()=>{f.button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));f.button.click();});assert.equal(f.refs.length,2);
});
test('only the reference handle starts a stack; valid drop adds all IDs once without changing nodes',t=>{
 const f=fixture(t),before=JSON.stringify(nodes);
 f.emit(window,'pointermove',700,500);assert.equal(document.querySelector('.agent-ref-flight'),null);
 f.emit(f.button,'pointerdown');f.emit(window,'pointermove',300,200);
 const flight=document.querySelector('.agent-ref-flight');assert.equal(flight.children.length,2);assert.equal(flight.querySelector('b').textContent,'2');assert.equal(f.refs.length,0);assert.equal(f.opens.length,1);
 f.emit(window,'pointermove',700,500);assert.deepEqual(f.hover.at(-1),{count:2});
 f.emit(window,'pointerup',700,500);f.emit(f.button,'click');assert.deepEqual(f.refs,[['a','b']]);assert.equal(JSON.stringify(nodes),before);assert.equal(document.querySelector('.agent-ref-flight').dataset.phase,'landing');assert.equal(f.hover.at(-1),null);
});
test('dropping outside returns the stack and does not accidentally click-reference',t=>{
 const f=fixture(t);f.emit(f.button,'pointerdown');f.emit(window,'pointermove',300,200);f.emit(window,'pointerup',300,200);f.emit(f.button,'click');
 assert.deepEqual(f.refs,[]);assert.equal(document.querySelector('.agent-ref-flight').dataset.phase,'returning');
 f.emit(f.button,'pointerdown');f.emit(window,'pointerup');f.emit(f.button,'click');assert.equal(f.refs.length,1);
});
test('Escape, pointer cancellation and unmount clear the drop highlight and never add references',t=>{
 const f=fixture(t);
 for(const event of ['escape','pointercancel']){
  f.emit(f.button,'pointerdown');f.emit(window,'pointermove',700,500);
  if(event==='escape')act(()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));else f.emit(window,'pointercancel',700,500);
  f.emit(window,'pointerup',700,500);assert.equal(f.refs.length,0);assert.equal(f.hover.at(-1),null);
 }
 f.emit(f.button,'pointerdown');f.emit(window,'pointermove',700,500);act(()=>f.root.unmount());assert.equal(document.querySelector('.agent-ref-flight'),null);assert.equal(f.hover.at(-1),null);f.emit(window,'pointerup',700,500);assert.equal(f.refs.length,0);
});
test('another pointer cannot complete the gesture',t=>{
 const f=fixture(t);f.emit(f.button,'pointerdown');f.emit(window,'pointermove',700,500,{pointerId:2});assert.equal(document.querySelector('.agent-ref-flight'),null);
 f.emit(window,'pointermove',700,500);f.emit(window,'pointerup',700,500,{pointerId:2});assert.equal(f.refs.length,0);f.emit(window,'pointerup',700,500);assert.equal(f.refs.length,1);
});
