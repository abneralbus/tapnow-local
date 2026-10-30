import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import TextInput from '../src/TextInput.mjs';

const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const h=React.createElement;
function fixture(t,as='textarea'){
  const container=document.createElement('div');document.body.append(container);
  const root=createRoot(container),changes=[],keys=[],bubbled=[];
  let value='';
  const render=()=>act(()=>root.render(h('div',{onKeyDown:e=>bubbled.push(e.key)},h(TextInput,{as,value,onChange:e=>changes.push(e.target.value),onKeyDown:e=>keys.push(e.key)}))));
  render();const input=container.firstChild.firstChild;
  const dispatch=(type,options={})=>act(()=>input.dispatchEvent(type.startsWith('composition')?new window.CompositionEvent(type,{bubbles:true,...options}):type==='keydown'?new window.KeyboardEvent(type,{bubbles:true,...options}):new window.Event(type,{bubbles:true,...options})));
  const type=text=>act(()=>{Object.getOwnPropertyDescriptor(as==='input'?window.HTMLInputElement.prototype:window.HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));});
  t.after(()=>{act(()=>root.unmount());container.remove();});
  return {input,changes,keys,bubbled,dispatch,type,render,setValue:next=>{value=next;render();}};
}

test('Chinese composition stays local through delayed graph renders and commits the chosen word',t=>{
  const f=fixture(t);f.dispatch('compositionstart');
  for(const text of ['s','sh','she','shen','sheng']){f.type(text);f.render();assert.equal(f.input.value,text);}
  assert.deepEqual(f.changes,[]);
  for(const key of ['ArrowDown','Enter','Escape'])f.dispatch('keydown',{key,isComposing:true,keyCode:229});
  assert.deepEqual(f.keys,[]);assert.deepEqual(f.bubbled,[]);
  f.type('生成');f.dispatch('compositionend',{data:'生成'});
  assert.deepEqual(f.changes,['生成']);assert.equal(f.input.value,'生成');
  f.setValue('生成');assert.equal(f.input.value,'生成');
  f.dispatch('keydown',{key:'Enter',keyCode:229});assert.deepEqual(f.keys,[]);
  f.dispatch('keydown',{key:'Enter',keyCode:13});assert.deepEqual(f.keys,['Enter']);
  f.setValue('撤销后的提示词');assert.equal(f.input.value,'撤销后的提示词');
});

test('ordinary typing survives stale node props; blur preserves an unfinished composition',t=>{
  const f=fixture(t,'input');
  act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(f.input,'fox');f.input.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText'}));});
  f.render();assert.equal(f.input.value,'fox');assert.deepEqual(f.changes,['fox']);
  f.setValue('fox');f.dispatch('compositionstart');f.type('fox森林');
  f.dispatch('focusout');assert.equal(f.changes.at(-1),'fox森林');assert.equal(f.input.value,'fox森林');
});
