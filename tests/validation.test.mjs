import test from 'node:test';
import assert from 'node:assert/strict';
import {videoRequest,canvasDocument,endpoint} from '../server/validation.mjs';
test('video request preserves requested duration, rejects malformed expensive jobs',()=>{assert.equal(videoRequest({prompt:' fox ',duration:4}).prompt,'fox');assert.equal(videoRequest({prompt:'fox',duration:4}).duration,4);for(const value of [{prompt:''},{prompt:'x',duration:0},{prompt:'x',duration:4.5},{prompt:'x',width:4096},{prompt:'x',steps:0},{prompt:'x',seed:-1}])assert.throws(()=>videoRequest(value));});
test('canvas roundtrip preserves nodes and rejects broken references and external asset URLs',()=>{const document={name:'scene',nodes:[{id:'a',type:'text',position:{x:1,y:2},data:{text:'hello'}}],edges:[]};assert.deepEqual(canvasDocument(document).nodes,document.nodes);assert.throws(()=>canvasDocument({...document,edges:[{source:'a',target:'missing'}]}));assert.throws(()=>canvasDocument({...document,nodes:[{...document.nodes[0],data:{src:'javascript:alert(1)'}}]}));});
test('upstream credentials cannot be smuggled in URL and remote HTTP is rejected',()=>{assert.equal(endpoint('https://example.com/'),'https://example.com');assert.equal(endpoint('http://127.0.0.1:9000'),'http://127.0.0.1:9000');for(const value of ['file:///etc/passwd','https://user:secret@example.com','http://example.com','https://example.com/?token=secret'])assert.throws(()=>endpoint(value));});
test('import rejects malformed viewports and non-text message payloads',()=>{const document={nodes:[],edges:[]};assert.throws(()=>canvasDocument({...document,viewport:{x:0,y:0,zoom:0}}));assert.throws(()=>canvasDocument({...document,messages:[{role:'assistant',text:{nested:'not text'}}]}));assert.throws(()=>canvasDocument({...document,nodes:[null]}));assert.throws(()=>videoRequest(null));});

test('canvas image references remain local and structurally valid on import',()=>{
  const value={nodes:[{id:'image',type:'image',position:{x:0,y:0},data:{references:[{src:'/media/fox.png',role:'reference',nodeId:'ref'}]}}],edges:[]};
  assert.equal(canvasDocument(value).nodes[0].data.references[0].src,'/media/fox.png');
  assert.throws(()=>canvasDocument({...value,nodes:[{...value.nodes[0],data:{references:'broken'}}]}),/引用/);
  assert.throws(()=>canvasDocument({...value,nodes:[{...value.nodes[0],data:{references:[{src:'https://other.example/ref.png',role:'reference'}]}}]}),/引用/);
});
