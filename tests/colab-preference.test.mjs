import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareColab} from '../server/colab-client.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('auto-release preference saves offline, survives URL updates and a server restart',async t=>{
 const data=await mkdtemp(path.join(tmpdir(),'tapnow-preference-'));let child;
 async function stop(){if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}}
 t.after(async()=>{await stop();await rm(data,{recursive:true,force:true});});
 async function start(){
  child=spawn(process.execPath,['server/index.mjs','--production'],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:data,COLAB_URL:'',COLAB_TOKEN:'',TAPNOW_STARTUP_IDLE_MS:'0'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(log);const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)return url;await delay(20);}throw Error('Server startup timed out');
 }
 let url=await start();
 async function call(route,body,method='POST'){const r=await fetch(url+'/api'+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 assert.equal((await call('/colab/settings',{autoRelease:'yes'})).status,400);
 assert.deepEqual((await call('/colab/settings',{autoRelease:true})).body,{autoRelease:true,synced:false});
 await call('/config',{colabUrl:'http://127.0.0.1:9',colabToken:''},'PUT');
 assert.equal((await call('/config',null,'GET')).body.colabAutoRelease,true);
 await stop();url=await start();
 assert.equal((await call('/config',null,'GET')).body.colabAutoRelease,true);
});
test('new model session receives saved auto-release before generation and rejects unconfirmed setting',async()=>{
 const calls=[];
 const session={sessionId:'fresh',phase:'ready',tasks:['t2va'],autoRelease:false};
 const remote=async(route,options)=>{calls.push(route);return {json:async()=>route==='/v1/session'?session:{...session,autoRelease:JSON.parse(options.body).autoRelease}};};
 const result=await prepareColab({mode:'text',prompt:'fixture',references:[]},remote,{colabAutoRelease:true},'/unused');
 assert.equal(result.sessionId,'fresh');assert.deepEqual(calls,['/v1/session','/v1/session/settings']);
 await assert.rejects(prepareColab({mode:'text',prompt:'fixture',references:[]},async()=>({json:async()=>session}),{colabAutoRelease:true},'/unused'),/未确认自动释放/);
});
