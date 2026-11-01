import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';import {JSDOM} from 'jsdom';import React,{act,useState} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const source=(await readFile(new URL('../src/ColabControls.jsx',import.meta.url),'utf8')).replace(/from '([^']+)'/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?new URL('../src/'+name,import.meta.url).href:import.meta.resolve(name))}`);
const {code}=await transform(source,{loader:'jsx',format:'esm'});const {default:Controls}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('canvas opens configured notebook and handles release failures',async t=>{
 const div=document.createElement('div');document.body.append(div);const root=createRoot(div);
 t.after(()=>{act(()=>root.unmount());div.remove();});
 let calls=0,finish;const notices=[];
 const config={colabNotebookUrl:'https://colab.research.google.com/drive/test',colabUrl:'https://worker.example',hasToken:true};
 await act(async()=>root.render(React.createElement(Controls,{config,notify:v=>notices.push(v),onRelease:()=>{calls++;return new Promise((resolve,reject)=>finish=reject);}})));
 assert.equal(div.querySelector('a').href,config.colabNotebookUrl);assert.equal(div.querySelector('a').target,'_blank');
 const button=div.querySelector('button');await act(async()=>button.click());assert.equal(calls,1);assert.equal(button.disabled,true);
 await act(async()=>button.click());assert.equal(calls,1);
 await act(async()=>finish(Error('pending results')));assert.deepEqual(notices,['pending results']);assert.equal(button.disabled,false);
 await act(async()=>root.render(React.createElement(Controls,{config:{},notify:()=>{},onRelease:()=>calls++})));
 assert.equal(div.querySelector('button').disabled,true);
});
