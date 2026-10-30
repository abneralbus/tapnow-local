import test from 'node:test';
import assert from 'node:assert/strict';
import {codexText,codexFailure} from '../server/codex.mjs';

test('CLI protocol only returns completed assistant text, not tool output or diagnostics',()=>{
  const output=['diagnostic',JSON.stringify({type:'item.completed',item:{type:'command_execution',text:'private tool output'}}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'第一版'}}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:' 最终视频提示词 '}})].join('\n');
  assert.equal(codexText(output),'最终视频提示词');assert.throws(()=>codexText('{"type":"turn.failed"}'));
});
test('CLI errors classify failures without exposing raw secrets or logs',()=>{
  assert.match(codexFailure('401 unauthorized token=secret'),/登录失效/);
  assert.match(codexFailure('HTTP 429 quota reached'),/额度/);
  assert.match(codexFailure('Operation not permitted'),/运行环境/);
  assert.ok(!codexFailure('unknown secret_key=example').includes('example'));
});
