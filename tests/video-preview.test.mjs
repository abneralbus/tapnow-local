import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const source=(await readFile(new URL('../src/VideoPreview.jsx',import.meta.url),'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});
const {default:VideoPreview,previewUrl,loadVideoPreview}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

const previewResponse=async()=>({ok:true,blob:async()=>new Blob([new Uint8Array([255,216,1,255,217])],{type:'image/jpeg'})});
globalThis.fetch=previewResponse;

test('video controls hide without replacing video or resetting its playback position',async t=>{
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);
 t.after(()=>{act(()=>root.unmount());div.remove();});
 const render=active=>act(()=>root.render(React.createElement(VideoPreview,{src:'/media/test.mp4',active})));
 render(true);const video=div.querySelector('video');video.currentTime=3.5;
 Object.defineProperty(video,'duration',{value:8});act(()=>video.dispatchEvent(new window.Event('loadedmetadata')));
 assert.equal(video.controls,false);assert.ok(div.querySelector('.video-controls.nodrag'));assert.equal(div.querySelector('[aria-label="视频进度"]').value,'3.5');
 render(false);assert.equal(div.querySelector('.video-controls'),null);assert.equal(div.querySelector('video'),video);assert.equal(video.currentTime,3.5);
 render(true);assert.equal(div.querySelector('video'),video);assert.equal(video.currentTime,3.5);
 let plays=0;video.play=async()=>{plays++;video.dispatchEvent(new window.Event('play'));};
 await act(async()=>div.querySelector('[aria-label="播放视频"]').click());assert.equal(plays,1);assert.ok(div.querySelector('[aria-label="暂停视频"]'));
 act(()=>video.dispatchEvent(new window.Event('pause')));video.play=async()=>{throw new Error('blocked');};
 await act(async()=>div.querySelector('[aria-label="播放视频"]').click());assert.match(div.textContent,/无法播放/);
});

async function fixture(t){
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);
 await act(async()=>root.render(React.createElement(VideoPreview,{src:'/media/focus.mp4',active:true})));
 const video=div.querySelector('video'),canvas=div.querySelector('.video-still');
 video.setAttribute('src','/media/focus.mp4');
 const state={paused:true,ready:4,time:3.5,draws:0,loads:0,plays:0,pauses:0,seeks:[],callbacks:new Map(),cancelled:[],next:0};
 Object.defineProperties(video,{paused:{get:()=>state.paused},readyState:{get:()=>state.ready},duration:{get:()=>8},videoWidth:{get:()=>1280},videoHeight:{get:()=>720},currentTime:{get:()=>state.time,set:value=>{state.time=value;state.seeks.push(value);}}});
 const emit=name=>video.dispatchEvent(new window.Event(name));
 video.pause=()=>{state.paused=true;state.pauses++;emit('pause');};
 video.play=async()=>{state.paused=false;state.plays++;emit('play');emit('playing');};
 video.load=()=>{state.loads++;};
 video.requestVideoFrameCallback=fn=>{state.callbacks.set(++state.next,fn);return state.next;};
 video.cancelVideoFrameCallback=id=>{state.cancelled.push(id);state.callbacks.delete(id);};
 canvas.getContext=()=>({drawImage:()=>state.draws++});
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 const visibility=value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new window.Event('visibilitychange'));};
 await act(async()=>{emit('loadedmetadata');emit('loadeddata');});
 act(()=>canvas.dispatchEvent(new window.Event('load')));
 t.after(()=>{act(()=>root.unmount());div.remove();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
 return {div,root,video,canvas,state,emit,visibility};
}

test('switching away retains a frame, pauses once, and restores the same decoder and position',async t=>{
 const {div,video,canvas,state,emit,visibility}=await fixture(t);
 assert.equal(canvas.style.visibility,'visible');assert.match(canvas.dataset.previewUrl,/video-frame\/focus.mp4\?time=3.5/);
 await act(async()=>video.play());assert.equal(canvas.style.visibility,'visible','do not expose a stale video surface before presentation');
 act(()=>{const cb=[...state.callbacks.values()].at(-1);state.callbacks.clear();cb();});
 assert.equal(canvas.style.visibility,'hidden');
 act(()=>{state.time=5.25;window.dispatchEvent(new window.Event('blur'));visibility('hidden');window.dispatchEvent(new window.Event('pagehide'));});
 assert.equal(state.pauses,1);assert.equal(canvas.style.visibility,'visible');const draws=state.draws;
 act(()=>{state.time=0;emit('timeupdate');visibility('visible');window.dispatchEvent(new window.Event('focus'));window.dispatchEvent(new window.Event('pageshow'));});
 assert.equal(video.currentTime,5.25);assert.equal(state.loads,0);assert.equal(state.plays,1,'returning does not auto-play');assert.equal(state.draws,draws,'keep old still until seek completes');
 await act(async()=>emit('seeked'));assert.match(canvas.dataset.previewUrl,/time=5.2$/);assert.equal(div.querySelector('[aria-label="视频进度"]').value,'5.25');assert.ok(div.querySelector('[aria-label="播放视频"]'));
});

test('discarded media reloads once and restores time after metadata, with no play or unsolicited controls',async t=>{
 const {root,div,video,canvas,state,emit,visibility}=await fixture(t);
 act(()=>{visibility('hidden');state.ready=0;state.time=0;emit('timeupdate');visibility('visible');window.dispatchEvent(new window.Event('focus'));});
 assert.equal(state.loads,1);assert.equal(canvas.style.visibility,'visible');
 act(()=>{state.ready=1;emit('loadedmetadata');});assert.equal(video.currentTime,3.5);
 act(()=>{state.ready=4;emit('seeked');root.render(React.createElement(VideoPreview,{src:'/media/focus.mp4',active:false}));});
 assert.equal(div.querySelector('.video-controls'),null);assert.equal(canvas.style.visibility,'visible');assert.equal(state.plays,0);assert.equal(video.currentTime,3.5);
});

test('source replacement and unmount clear old still and cancel pending frame callbacks and listeners',async t=>{
 const {root,div,video,canvas,state}=await fixture(t);
 await act(async()=>video.play());const pending=[...state.callbacks.keys()];
 await act(async()=>{state.ready=0;state.time=0;state.paused=true;root.render(React.createElement(VideoPreview,{src:'/media/new.mp4',active:true}));});
 act(()=>canvas.dispatchEvent(new window.Event('load')));
 assert.equal(canvas.style.visibility,'visible');assert.match(canvas.dataset.previewUrl,/new.mp4\?time=0$/);assert.ok(pending.every(id=>state.cancelled.includes(id)));assert.equal(div.querySelector('[aria-label="视频进度"]').value,'0');
 act(()=>root.unmount());const pauses=state.pauses;
 act(()=>{window.dispatchEvent(new window.Event('blur'));window.dispatchEvent(new window.Event('focus'));});
 assert.equal(state.pauses,pauses);assert.equal(state.loads,1,'source replacement releases the old media');assert.equal(video.getAttribute('src'),null);
});


test('preview URL is a valid relative URL and the loader rejects HTTP and non-image responses',async()=>{
 assert.equal(previewUrl('/media/file.mp4',3.56),'/api/video-frame/file.mp4?time=3.5');
 assert.equal(previewUrl('https://external/video.mp4'),undefined);
 try{
  globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:'服务重启中'})});
  await assert.rejects(()=>loadVideoPreview('/api/video-frame/file.mp4'),/503.*服务重启中/);
  globalThis.fetch=async()=>({ok:true,blob:async()=>new Blob(['html'],{type:'text/html'})});
  await assert.rejects(()=>loadVideoPreview('/api/video-frame/file.mp4'),/有效图片/);
 }finally{globalThis.fetch=previewResponse;}
});

test('failed preview retries finitely, hides the broken image, and recovers on returning online',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {canvas,state,emit,div}=await fixture(t);let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return {ok:false,status:503,json:async()=>({error:'服务重启中'})};};
  await act(async()=>{state.time=1.1;emit('seeked');});assert.match(div.textContent,/503/);
  for(const delay of [500,1500,3500])await act(async()=>t.mock.timers.tick(delay));
  assert.equal(calls,4);await act(async()=>t.mock.timers.tick(60000));assert.equal(calls,4);
  act(()=>canvas.dispatchEvent(new window.Event('error')));assert.equal(canvas.style.visibility,'hidden');assert.match(div.textContent,/重试预览/);
  globalThis.fetch=previewResponse;
  await act(async()=>window.dispatchEvent(new window.Event('online')));
  act(()=>canvas.dispatchEvent(new window.Event('load')));
  assert.equal(canvas.style.visibility,'visible');assert.equal(div.querySelector('.video-error'),null);assert.match(canvas.getAttribute('src'),/^blob:/);assert.equal(state.time,1.1);
 }finally{globalThis.fetch=previewResponse;}
});


test('a successfully presented video frame clears preview errors and pending retries',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {canvas,video,state,emit,div}=await fixture(t);
 try{
  globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:'preview offline'})});
  await act(async()=>{state.time=2;emit('seeked');});assert.ok(div.querySelector('.video-error'));
  await act(async()=>video.play());
  act(()=>{const cb=[...state.callbacks.values()].at(-1);state.callbacks.clear();cb();});
  assert.equal(canvas.style.visibility,'hidden');assert.equal(div.querySelector('.video-error'),null);
  await act(async()=>t.mock.timers.tick(60000));assert.equal(div.querySelector('.video-error'),null);
 }finally{globalThis.fetch=previewResponse;}
});


test('video is loaded only on play and offscreen playback is released with its position retained',async t=>{
 let observe;
 globalThis.IntersectionObserver=class{constructor(fn){observe=fn;}observe(){}disconnect(){}};
 t.after(()=>delete globalThis.IntersectionObserver);
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);
 t.after(()=>{act(()=>root.unmount());div.remove();});
 await act(async()=>root.render(React.createElement(VideoPreview,{src:'/media/lazy.mp4',active:true,aspectRatio:'9:16'})));
 const v=div.querySelector('video');assert.equal(v.getAttribute('src'),null);assert.equal(v.preload,'none');
 let paused=true,position=0,ready=0,loads=0;
 Object.defineProperties(v,{paused:{get:()=>paused},readyState:{get:()=>ready},duration:{get:()=>5},currentTime:{get:()=>position,set:x=>position=x}});
 v.play=async()=>{paused=false;v.dispatchEvent(new window.Event('play'));};
 v.pause=()=>{paused=true;v.dispatchEvent(new window.Event('pause'));};v.load=()=>{loads++;position=0;ready=0;};
 await act(async()=>div.querySelector('[aria-label="播放视频"]').click());assert.equal(v.getAttribute('src'),'/media/lazy.mp4');
 act(()=>{ready=4;v.dispatchEvent(new window.Event('loadedmetadata'));position=2.5;v.dispatchEvent(new window.Event('timeupdate'));observe([{isIntersecting:false}]);});
 assert.equal(v.getAttribute('src'),null);assert.equal(paused,true);assert.equal(loads,1);
 act(()=>observe([{isIntersecting:true}]));assert.equal(v.getAttribute('src'),null,'returning to view does not download or autoplay');
 await act(async()=>div.querySelector('[aria-label="播放视频"]').click());
 act(()=>{ready=1;v.dispatchEvent(new window.Event('loadedmetadata'));});assert.equal(position,2.5);
});
