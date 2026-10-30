import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,createRef} from 'react';
import {JSDOM} from 'jsdom';
import CanvasDragPreview from '../src/CanvasDragPreview.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
function fixture(t){
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),ref=createRef(),motions=[];
  window.matchMedia=()=>({matches:false});
  window.HTMLElement.prototype.animate=function(frames,options){let resolve;const finished=new Promise(r=>resolve=r);const animation={element:this,frames,options,finished,complete:resolve,cancelled:false,cancel(){this.cancelled=true;resolve();}};motions.push(animation);return animation;};
  act(()=>root.render(React.createElement(CanvasDragPreview,{ref})));
  t.after(()=>{act(()=>root.unmount());div.remove();delete window.HTMLElement.prototype.animate;delete window.matchMedia;});
  const entries=Array.from({length:8},(_,i)=>({id:String(i),name:'画布 '+i,count:i,cover:'/media/test.webp',rect:{left:100+i*300,top:200,width:260,height:220}}));
  return {ref,entries,motions,root};
}
test('previews gather from each source, follow pointer without layout replacement, and reverse to individual origins',async t=>{
  const f=fixture(t);act(()=>f.ref.current.start(f.entries.slice(0,2),{x:130,y:230},'1',2));
  const layer=document.querySelector('.cm-flight');assert.equal(layer.parentNode,document.body);assert.equal(layer.getAttribute('aria-hidden'),'true');
  const cards=[...layer.querySelectorAll('.cm-flight-card')];assert.equal(cards.length,2);assert.equal(cards[0].querySelector('b').textContent,'画布 1');assert.equal(layer.querySelector('.cm-flight-count').textContent,'2');
  assert.match(f.motions[0].frames[0].transform,/270px,-30px/);assert.notEqual(f.motions[0].frames[1].transform,f.motions[1].frames[1].transform);
  act(()=>f.ref.current.move({x:600,y:400}));assert.equal(document.querySelector('.cm-flight'),layer);assert.equal(layer.style.transform,'translate3d(600px,400px,0)');
  let settling;act(()=>{settling=f.ref.current.settle(null);});assert.equal(layer.dataset.phase,'returning');assert.ok(f.motions.slice(0,2).every(m=>m.cancelled));
  const returns=f.motions.slice(2);assert.match(returns[0].frames[1].transform,/-200px,-200px/);assert.match(returns[1].frames[1].transform,/-500px,-200px/);
  assert.ok(document.querySelector('.cm-flight'),'preview stays until landing animation completes');
  await act(async()=>{returns.forEach(m=>m.complete());await settling;});assert.equal(document.querySelector('.cm-flight'),null);
});
test('large selections have a bounded stack, reduced motion is respected, and unmount cancels pending animation',async t=>{
  const f=fixture(t);window.matchMedia=()=>({matches:true});
  act(()=>f.ref.current.start(f.entries,{x:130,y:230},'7',8));
  assert.equal(document.querySelectorAll('.cm-flight-card').length,6);assert.equal(document.querySelector('.cm-flight-count').textContent,'8');assert.ok(f.motions.every(m=>m.options.duration===0));
  let settling;act(()=>{settling=f.ref.current.settle({left:10,top:40,width:120,height:40});});
  assert.equal(document.querySelector('.cm-flight').dataset.phase,'landing');assert.equal(f.motions.at(-1).frames[1].opacity,0);
  await act(async()=>{f.root.unmount();await settling;});assert.ok(f.motions.every(m=>m.cancelled));assert.equal(document.querySelector('.cm-flight'),null);
});
test('approaching groups shrinks the stack outside the sidebar, leaving restores it, and return uses the displayed origin',async t=>{
  const f=fixture(t);act(()=>f.ref.current.start(f.entries.slice(0,2),{x:430,y:230},'1',2));
  const dock={right:260,bottom:800};
  act(()=>f.ref.current.move({x:180,y:300},dock));
  const layer=document.querySelector('.cm-flight');assert.equal(layer.dataset.compact,'true');assert.equal(layer.style.transform,'translate3d(276px,316px,0)');
  assert.equal(f.motions[2].frames[0].transform,f.motions[3].frames[0].transform,'compact cards begin together instead of side by side');
  assert.ok(f.motions.slice(2).every(m=>Number(m.frames[1].transform.match(/scale\(([^)]+)/)[1])<.5));
  const before=f.motions.length;act(()=>f.ref.current.move({x:120,y:340},dock));assert.equal(f.motions.length,before,'moving between groups does not restart scaling');assert.equal(layer.style.transform,'translate3d(276px,356px,0)');
  act(()=>f.ref.current.move({x:600,y:400}));assert.equal(layer.dataset.compact,'false');assert.equal(layer.style.transform,'translate3d(600px,400px,0)');assert.match(f.motions.at(-2).frames[1].transform,/scale\(1.035\)/);
  act(()=>f.ref.current.move({x:180,y:300},dock));let settling;act(()=>{settling=f.ref.current.settle(null);});
  const returns=f.motions.slice(-2);assert.match(returns[0].frames[1].transform,/124px,-116px/);assert.match(returns[1].frames[1].transform,/-176px,-116px/);
  await act(async()=>{returns.forEach(m=>m.complete());await settling;});assert.equal(document.querySelector('.cm-flight'),null);
});
