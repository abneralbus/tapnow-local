import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const source=(await readFile(new URL('../src/CanvasManager.jsx',import.meta.url),'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?new URL('../src/'+name,import.meta.url).href:import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});
const {default:CanvasManager}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

async function fixture(t,{reject=false,trashAge=0}={}){
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),calls=[],opened=[];
  const docs=[{id:'a',name:'画布 A',count:0,updatedAt:1,groupId:null},{id:'b',name:'画布 B',count:0,updatedAt:2,groupId:null},{id:'c',name:'画布 C',count:0,updatedAt:3,groupId:'g'}];
  if(trashAge)docs[0].deletedAt=Date.now()-trashAge;
  const api=async route=>route==='/canvas-groups'?[{id:'g',name:'分组 G'}]:docs.filter(d=>route.includes('trash')?d.deletedAt:!d.deletedAt).map(d=>({...d}));
  const onMutate=async(action,ids,patch)=>{calls.push({action,ids,patch});if(reject)throw new Error('移动失败，分组已删除');docs.forEach(d=>{if(ids.includes(d.id)){if(action==='move')d.groupId=patch.groupId;if(action==='delete')d.deletedAt=Date.now();if(action==='restore')delete d.deletedAt;}});};
  await act(async()=>root.render(React.createElement(CanvasManager,{api,json:()=>{},currentId:'a',onOpen:id=>opened.push(id),onNew:()=>{},onImport:()=>{},onMutate})));
  t.after(()=>{act(()=>root.unmount());div.remove();});
  const card=id=>div.querySelector(`[aria-label="打开画布 画布 ${id.toUpperCase()}"]`).closest('article');
  const destination=()=>div.querySelector('.cm-groups>button');
  let source=null;
  async function pointer(el,type,x=0,y=0){const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:1,button:0,clientX:x,clientY:y});await act(async()=>el.dispatchEvent(e));return e;}
  async function event(el,type){
    document.elementFromPoint=()=>el;
    if(type==='dragstart'){source=el;await pointer(el,'pointerdown');return pointer(el,'pointermove',20,20);}
    if(type==='dragend'){const result=await pointer(source||el,'pointercancel');source=null;return result;}
    return pointer(source||el,type==='drop'?'pointerup':'pointermove',30,30);
  }
  const select=async id=>act(async()=>{const input=card(id).querySelector('[role=checkbox]');input.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));input.click();});
  return {div,card,destination,event,pointer,select,calls,opened,docs};
}

test('dragging a selected card moves the entire selection and never opens it',async t=>{
  const f=await fixture(t);await f.select('a');await f.select('b');
  await f.event(f.card('a'),'dragstart');assert.match(f.div.querySelector('[role=status]').textContent,/2 个画布/);
  await act(async()=>f.card('a').querySelector('.cm-open').click());assert.deepEqual(f.opened,[]);
  const over=await f.event(f.destination(),'dragover');assert.equal(over.defaultPrevented,true);assert.ok(f.destination().classList.contains('cm-drop-target'));
  await f.event(f.destination(),'drop');assert.deepEqual(f.calls,[{action:'move',ids:['a','b'],patch:{groupId:'g'}}]);
  assert.equal(f.div.querySelectorAll('.cm-dragging,.cm-drop-target').length,0);assert.match(f.div.querySelector('[role=status]').textContent,/已将 2 个画布/);
});
test('an unselected card drags alone; ungrouped accepts drops; same-group moves are no-ops',async t=>{
  const f=await fixture(t);await f.select('a');await f.select('b');
  await f.event(f.card('c'),'dragstart');await f.event(f.destination(),'drop');assert.equal(f.calls.length,0);
  await f.event(f.card('c'),'dragstart');await f.event(f.div.querySelector('.cm-sidebar>button:nth-of-type(2)'),'drop');
  assert.deepEqual(f.calls,[{action:'move',ids:['c'],patch:{groupId:null}}]);
});
test('external drags and cancelled gestures cannot move canvases; failed moves retain selection',async t=>{
  const f=await fixture(t,{reject:true});
  assert.equal((await f.event(f.destination(),'dragover')).defaultPrevented,false);await f.event(f.destination(),'drop');assert.equal(f.calls.length,0);
  await f.event(f.card('a'),'dragstart');await f.event(f.card('a'),'dragend');await f.event(f.destination(),'drop');assert.equal(f.calls.length,0);
  assert.equal(f.div.querySelectorAll('.cm-dragging,.cm-drop-target').length,0);
  await f.select('b');await f.event(f.card('a'),'dragstart');await f.event(f.destination(),'drop');
  assert.match(f.div.querySelector('[role=alert]').textContent,/移动失败/);assert.equal(f.card('a').querySelector('[role=checkbox]').getAttribute('aria-checked'),'true');assert.equal(f.card('b').querySelector('[role=checkbox]').getAttribute('aria-checked'),'true');
  assert.ok(f.docs.filter(d=>d.id!=='c').every(d=>d.groupId===null));
});

async function click(el){assert.ok(el);await act(async()=>el.click());}
const checked=el=>el.getAttribute('aria-checked')==='true';
test('bulk delete confirms the exact selection, soft deletes all of it and can restore it',async t=>{
  const f=await fixture(t);await f.select('a');await f.select('b');
  await click(f.div.querySelector('.cm-bulk-delete'));
  const dialog=f.div.querySelector('[role=alertdialog]');assert.match(dialog.textContent,/删除 2 个画布/);assert.match(dialog.textContent,/30 天/);assert.match(dialog.textContent,/JSON 不包含素材/);
  assert.deepEqual([...dialog.querySelectorAll('li')].map(el=>el.textContent),['画布 A','画布 B']);
  assert.equal(f.card('a').querySelector('[role=checkbox]').disabled,true);
  assert.equal(f.div.querySelector('.cm-main').hasAttribute('inert'),true);
  assert.equal(document.activeElement,dialog.querySelector('button[type=button]'));
  await click(dialog.querySelector('[type=submit]'));
  assert.deepEqual(f.calls,[{action:'delete',ids:['a','b'],patch:{}}]);
  assert.equal(f.div.querySelectorAll('[data-cm-card]').length,1);assert.equal(f.div.querySelector('[role=alertdialog]'),null);
  await click(f.div.querySelector('.cm-trash'));await f.select('a');await f.select('b');
  await click([...f.div.querySelectorAll('.cm-selection>button')].find(el=>el.textContent==='恢复'));
  assert.deepEqual(f.calls[1],{action:'restore',ids:['a','b'],patch:undefined});assert.ok(f.docs.every(d=>!d.deletedAt));
});
test('selected card menu deletes the whole selection; unselected card targets only itself; Escape cancels',async t=>{
  const f=await fixture(t);await f.select('a');await f.select('b');
  await click(f.card('b').querySelector('.cm-more'));await click(f.div.querySelector('.cm-menu .danger'));
  assert.match(f.div.querySelector('[role=alertdialog]').textContent,/删除 2 个画布/);
  const escape=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
  await act(async()=>document.activeElement.dispatchEvent(escape));assert.equal(f.div.querySelector('[role=alertdialog]'),null);assert.equal(f.calls.length,0);
  assert.ok(checked(f.card('a').querySelector('[role=checkbox]')));
  await click(f.card('c').querySelector('.cm-more'));await click(f.div.querySelector('.cm-menu .danger'));
  assert.match(f.div.querySelector('[role=alertdialog]').textContent,/删除 1 个画布/);
  assert.equal(f.div.querySelector('[role=alertdialog] li').textContent,'画布 C');
});
test('failed bulk deletion preserves selected cards and exposes the error inside confirmation',async t=>{
  const f=await fixture(t,{reject:true});await f.select('a');await f.select('b');
  await click(f.div.querySelector('.cm-bulk-delete'));await click(f.div.querySelector('.cm-delete-confirm'));
  assert.match(f.div.querySelector('[role=alertdialog] [role=alert]').textContent,/失败/);
  assert.ok(checked(f.card('a').querySelector('[role=checkbox]')));assert.ok(f.docs.every(d=>!d.deletedAt));
  assert.equal(f.div.querySelector('.cm-delete-confirm').disabled,false);
});
test('dragging from a checkbox cannot toggle it or start a card drag; deliberate clicks still work',async t=>{
  const f=await fixture(t),box=f.card('a').querySelector('[role=checkbox]');
  await f.pointer(box,'pointerdown',10,10);await f.pointer(box,'pointermove',24,10);await f.pointer(box,'pointerup',24,10);
  await act(async()=>box.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:1})));
  assert.equal(checked(box),false);assert.equal(f.div.querySelectorAll('.cm-dragging').length,0);assert.deepEqual(f.opened,[]);
  await f.pointer(box,'pointerdown',10,10);await f.pointer(box,'pointerup',10,10);
  await act(async()=>box.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:1})));
  assert.equal(checked(box),true);await click(box);assert.equal(checked(box),false);
});

test('trash shows remaining retention and disables restoration after the deadline',async t=>{
  const f=await fixture(t,{trashAge:31*86400000});await click(f.div.querySelector('.cm-trash'));
  assert.match(f.div.querySelector('.cm-expiry').textContent,/已到期/);assert.equal(f.card('a').querySelector('[role=checkbox]').disabled,true);
  assert.equal(f.div.querySelector('[aria-label="全选画布"]').disabled,true);
  await click(f.card('a').querySelector('.cm-more'));assert.equal(f.div.querySelector('.cm-menu button').disabled,true);
});
