import test from 'node:test';
import assert from 'node:assert/strict';
import {h3References} from '../shared/h3-references.mjs';
const references=(images,videos,audios)=>[
 ...Array.from({length:images},(_,i)=>({src:`/media/img${i}.png`})),
 ...Array.from({length:videos},(_,i)=>({src:`/media/video${i}.mp4`})),
 ...Array.from({length:audios},(_,i)=>({src:`/media/audio${i}.wav`}))];
test('H3 accepts 12 mixed references but rejects a 13th within per-type limits',()=>{
 assert.equal(h3References(references(9,2,1),'reference').length,12);
 assert.throws(()=>h3References(references(9,3,1),'reference'),/12/);
 assert.throws(()=>h3References(references(10,0,0),'reference'),/图片最多 9/);
});
