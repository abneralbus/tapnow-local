import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cliPath} from '../server/cli-path.mjs';
test('CLI lookup uses PATH, respects explicit overrides and rejects non-executables',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'canvas-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const name='canvas-test-cli',file=path.join(dir,name);await writeFile(file,'#!/bin/sh\nexit 0\n');await chmod(file,0o700);
 assert.equal(cliPath(name,undefined,dir),file);assert.equal(cliPath(name,file,''),file);
 assert.equal(cliPath(name,path.join(dir,'missing'),dir),undefined);
 await chmod(file,0o600);assert.equal(cliPath(name,undefined,dir),undefined);
 assert.equal(cliPath(name,dir,dir),undefined);
});
