import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVideoFrames} from '../server/video-frame.mjs';
test('video frame decoding is local, bounded, deduplicated and never serves a deleted source from cache',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'video-frame-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'v.mp4'),'fixture');
 let runs=0;const image=Buffer.from([255,216,1,2,255,217]);
 const frame=createVideoFrames(dir,{run:async(binary,args,options)=>{runs++;assert.equal(binary,'ffmpeg');assert.ok(args.includes('file,pipe'));assert.equal(options.timeout,12000);assert.equal(options.maxBuffer,2097152);return {stdout:image};}});
 assert.deepEqual(await Promise.all([frame('v.mp4',1.24),frame('v.mp4',1.24)]),[image,image]);assert.equal(runs,1);
 await frame('v.mp4',1.29);assert.equal(runs,1);await rm(path.join(dir,'v.mp4'));await assert.rejects(()=>frame('v.mp4',1.24),e=>e.status===404);
 await assert.rejects(()=>frame('../escape.mp4'),e=>e.status===400);await assert.rejects(()=>frame('v.mp4',-1),e=>e.status===400);
 await symlink('/etc/hosts',path.join(dir,'escape.mp4'));await assert.rejects(()=>frame('escape.mp4'),e=>e.status===403);
});
test('invalid decoder output returns an explicit preview error instead of a blank success',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'video-frame-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'v.mp4'),'fixture');
 const frame=createVideoFrames(dir,{run:async()=>({stdout:Buffer.alloc(0)})});await assert.rejects(()=>frame('v.mp4'),e=>e.status===422);
});
