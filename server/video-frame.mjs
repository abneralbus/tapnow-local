import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat,realpath} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
export function createVideoFrames(directory,{signal,run=exec}={}){
  const cache=new Map(),pending=new Map(),waiters=[];let active=0;
  async function extract(file,time){
    if(active>=2)await new Promise(resolve=>waiters.push(resolve));else active++;
    try{
      const {stdout}=await run('ffmpeg',['-v','error','-nostdin','-ss',String(time),'-protocol_whitelist','file,pipe','-i',file,'-frames:v','1','-vf','scale=min(960\\,iw):-2','-f','image2pipe','-vcodec','mjpeg','-threads','1','pipe:1'],{encoding:'buffer',timeout:12000,maxBuffer:2*1024*1024,signal});
      if(stdout.length<4||stdout[0]!==255||stdout[1]!==216)throw failure('无法提取视频画面，请重试播放。',422);
      return stdout;
    }catch(error){if(error.status)throw error;throw failure(error.code==='ENOENT'?'本机缺少 ffmpeg，无法生成视频预览。':'视频预览暂不可用，请重试。',503);}
    finally{const next=waiters.shift();if(next)next();else active--;}
  }
  return async function frame(filename,seconds=0){
    if(!/^[a-zA-Z0-9_-]{1,120}\.(mp4|webm|mov|m4v)$/i.test(filename))throw failure('无效的视频文件名');
    const value=Number(seconds);if(!Number.isFinite(value)||value<0||value>86400)throw failure('无效的视频时间');
    const time=Math.floor(value*10)/10,file=path.join(directory,filename);
    let info;try{const [resolved,root]=await Promise.all([realpath(file),realpath(directory)]);if(path.dirname(resolved)!==root)throw failure('视频不在媒体目录内',403);info=await stat(file);if(!info.isFile())throw failure('视频不存在',404);}catch(error){if(error.code==='ENOENT')throw failure('视频不存在',404);throw error;}
    const key=`${filename}:${info.mtimeMs}:${info.size}:${time}`;
    if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
    if(pending.has(key))return pending.get(key);
    if(pending.size>=32)throw failure('视频预览正在加载，请稍后重试。',429);
    const task=extract(file,time).then(value=>{cache.set(key,value);let bytes=[...cache.values()].reduce((sum,b)=>sum+b.length,0);while(cache.size>32||bytes>8*1024*1024){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).length;cache.delete(oldest);}return value;}).finally(()=>pending.delete(key));
    pending.set(key,task);return task;
  };
}
