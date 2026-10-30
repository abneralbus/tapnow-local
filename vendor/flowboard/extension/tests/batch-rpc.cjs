const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../background.js'), 'utf8');
const runner = source.slice(source.indexOf('async function runBatchRpc'), source.indexOf('async function handleBatchRpc'));
async function check({reject, bodyReject, match, loseFirstResult = false, contextLost = false, injectionError = false} = {}) {
  let calls = 0, injections = 0, sleeps = 0, timers = new Map();
  const page = vm.createContext({
    WIZ_global_data: {SNlM0e:'test-at'}, location:{pathname:'/project/test'},
    document:{documentElement:{lang:'zh'}}, navigator:{language:'zh'}, URLSearchParams,
    setTimeout: (f) => { const id=timers.size+1; timers.set(id,f); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => { calls++; if(reject) throw new Error('Failed to fetch');
      return {status:200,text:async()=>{ if(bodyReject)throw new Error('stream closed'); return 'prefix abc image-result'; }}; },
  });
  const context=vm.createContext({
    flowUrls:[],MAX_RPC_TEXT:32000000,CAPTCHA_SLOT:'__CAPTCHA__',Date,
    reviveTabIfNeeded: async t=>t,
    sleep:async()=>{ assert.ok(++sleeps < 20,'must not poll indefinitely'); await new Promise(r=>setImmediate(r)); },
    chrome:{tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async ({func,args})=>{
      injections++;
      if(injections===2 && injectionError)return [{error:{message:'injection rejected'}}];
      if(injections===2 && contextLost)delete page.__flowboardRpcResults;
      page.args=args;
      const result=vm.runInContext(`(${func.toString()})(...args)`,page);
      assert.ok(!(result instanceof Promise),'page injections must return synchronously');
      return [{result:injections===1 && loseFirstResult ? undefined : result}];
    }}},
  });
  vm.runInContext(runner,context);
  const result=await context.runBatchRpc({id:'test-id',rpcid:'ogiZ0b',freq:'test',match});
  assert.equal(calls,1,'never repeat the generation POST');
  if(!contextLost&&!injectionError)assert.equal(Object.keys(page.__flowboardRpcResults).length,0,'consume result');
  if(!contextLost&&!injectionError)assert.equal(timers.size,0,'clear result expiry');
  return result;
}
(async()=>{
  assert.equal((await check()).text,'prefix abc image-result');
  assert.equal((await check({loseFirstResult:true})).text,'prefix abc image-result');
  assert.match((await check({reject:true})).error,/Failed to fetch/);
  assert.match((await check({bodyReject:true})).error,/stream closed/);
  assert.equal((await check({match:'abc'})).text,'abc image-result');
  assert.equal((await check({match:'absent'})).matched,false);
  assert.match((await check({contextLost:true})).error,/CONTEXT_LOST/);
  assert.match((await check({injectionError:true})).error,/injection rejected/);
  console.log('PASS: 8 RPC transport cases; one POST, result recovery, errors, filtering and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
