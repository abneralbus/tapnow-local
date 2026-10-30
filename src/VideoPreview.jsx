import React,{useEffect,useRef,useState} from 'react';
import {Play,Pause,Volume2,VolumeX,Maximize} from 'lucide-react';

export const previewUrl=(src,time=0)=>/^\/media\/[a-zA-Z0-9_-]+\.(mp4|webm|mov|m4v)$/i.test(src)?`/api/video-frame/${src.slice(7)}?time=${Math.floor(Math.max(0,time)*10)/10}`:undefined;
export async function loadVideoPreview(url,signal){
  const response=await fetch(url,{signal,cache:'no-store'});
  if(!response.ok){let detail='';try{detail=(await response.json()).error||'';}catch{}throw new Error(`预览请求失败（${response.status}）${detail?'：'+detail:''}`);}
  const blob=await response.blob();
  if(!blob.type.startsWith('image/')||!blob.size||blob.size>2*1024*1024)throw new Error('预览接口没有返回有效图片。');
  return blob;
}
const clock=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export default function VideoPreview({src,active,onCanPlay}){
  const video=useRef(),frame=useRef(),still=useRef(),retryPreview=useRef(()=>{});
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[muted,setMuted]=useState(false),[error,setError]=useState(''),[previewError,setPreviewError]=useState('');
  useEffect(()=>{
    const media=video.current,image=still.current;
    let position=0,suspended=false,restoring=false,hasFrame=false,callback=null,disposed=false,requested=null,controller=null,retryTimer=null,attempt=0,objectUrl=null,requestId=0,failed=false;
    setPlaying(false);setTime(0);setDuration(0);setError('');setPreviewError('');image.removeAttribute('src');image.style.visibility='hidden';
    function sync(){
      if(!suspended&&!restoring&&Number.isFinite(media.currentTime))position=media.currentTime;
      setTime(position);setDuration(Number.isFinite(media.duration)?media.duration:0);
      setPlaying(!media.paused&&!media.ended);setVolume(media.volume);setMuted(media.muted);
    }
    // Fetch explicitly so HTTP failures are observable and cannot leave a cached broken <img>.
    // The blob URL also keeps preview decoding independent of the video resource URL.
    async function requestPreview(url,force=false){
      if(!url||disposed||(!force&&url===requested))return;
      if(url!==requested){attempt=0;failed=false;}requested=url;
      clearTimeout(retryTimer);controller?.abort();controller=new AbortController();const ticket=++requestId;
      try{
        const blob=await loadVideoPreview(url,controller.signal);
        if(disposed||ticket!==requestId)return;
        const previous=objectUrl;objectUrl=URL.createObjectURL(blob);image.src=objectUrl;
        image.dataset.previewUrl=url;
        if(previous)URL.revokeObjectURL(previous);
      }catch(error){
        if(disposed||ticket!==requestId||error.name==='AbortError')return;
        failed=true;if(media.paused||suspended)setPreviewError(error.message);
        if(!hasFrame)image.style.visibility='hidden';
        if(attempt<3){const delay=[500,1500,3500][attempt++];retryTimer=setTimeout(()=>requestPreview(url,true),delay);}
      }
    }
    function capture(){
      const end=Number.isFinite(media.duration)?Math.max(0,media.duration-.1):position;
      const url=previewUrl(src,Math.min(position,end));requestPreview(url);
      if(hasFrame)image.style.visibility='visible';
    }
    function previewLoaded(){failed=false;hasFrame=true;attempt=0;setPreviewError('');if(media.paused||suspended)image.style.visibility='visible';}
    function previewFailed(){failed=true;hasFrame=false;image.style.visibility='hidden';if(media.paused||suspended)setPreviewError('浏览器无法显示视频预览，请重试。');}
    function retry(){if(!failed||!requested)return;attempt=0;setPreviewError('');requestPreview(requested,true);}
    retryPreview.current=retry;
    image.addEventListener('load',previewLoaded);image.addEventListener('error',previewFailed);
    window.addEventListener('online',retry);
    function cancelFrame(){if(callback!==null){media.cancelVideoFrameCallback?.(callback);callback=null;}}
    function showPlayback(){
      cancelFrame();
      if(suspended||media.paused)return;
      // Keep the still until a new decoded frame is actually presented, not merely until play().
      if(media.requestVideoFrameCallback)callback=media.requestVideoFrameCallback(()=>{
        callback=null;if(!suspended&&!media.paused){image.style.visibility='hidden';setPreviewError('');clearTimeout(retryTimer);}
      });
      else if(media.readyState>=2){image.style.visibility='hidden';setPreviewError('');clearTimeout(retryTimer);}
    }
    function pause(){cancelFrame();if(!suspended&&!restoring){sync();capture();}setPlaying(false);}
    function suspend(){
      if(suspended)return;
      sync();capture();suspended=true;cancelFrame();if(hasFrame)image.style.visibility='visible';
      if(!media.paused)media.pause();setPlaying(false);
    }
    function seekBack(){
      if(!restoring||media.readyState<1)return;
      const target=Number.isFinite(media.duration)?Math.min(position,media.duration):position;
      try{media.currentTime=target;restoring=false;setTime(target);}catch{restoring=false;}
    }
    function resume(){
      if(document.visibilityState==='hidden')return;retry();if(!suspended)return;
      suspended=false;restoring=true;sync();
      // Reload only when the browser really released the resource; never reset a healthy decoder.
      if(media.readyState===0)media.load();else seekBack();
    }
    function visibility(){if(document.visibilityState==='hidden')suspend();else resume();}
    function metadata(){seekBack();sync();}
    function decoded(){
      if(suspended||restoring)return;
      if(media.paused)capture();else showPlayback();
    }
    function sought(){restoring=false;sync();decoded();}
    function play(){setPlaying(true);}
    function progress(){sync();if(!media.paused&&!media.requestVideoFrameCallback&&!suspended)image.style.visibility='hidden';}
    function failure(){setPlaying(false);setError('视频加载失败，请检查连接后重试或下载查看。');}
    const events={loadedmetadata:metadata,loadeddata:decoded,seeked:sought,playing:showPlayback,play,pause,ended:pause,timeupdate:progress,volumechange:sync,error:failure};
    for(const [name,handler] of Object.entries(events))media.addEventListener(name,handler);
    window.addEventListener('blur',suspend);window.addEventListener('focus',resume);
    window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',resume);
    document.addEventListener('visibilitychange',visibility);
    capture();sync();decoded();if(document.visibilityState==='hidden')suspend();
    return()=>{
      disposed=true;clearTimeout(retryTimer);controller?.abort();retryPreview.current=()=>{};if(objectUrl)URL.revokeObjectURL(objectUrl);
      image.removeEventListener('load',previewLoaded);image.removeEventListener('error',previewFailed);window.removeEventListener('online',retry);
      cancelFrame();for(const [name,handler] of Object.entries(events))media.removeEventListener(name,handler);
      window.removeEventListener('blur',suspend);window.removeEventListener('focus',resume);
      window.removeEventListener('pagehide',suspend);window.removeEventListener('pageshow',resume);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[src]);
  async function toggle(){try{setError('');if(video.current.paused)await video.current.play();else video.current.pause();}catch{setError('无法播放此视频，请重试或下载查看。');}}
  return <div className="video-preview" ref={frame}>
    <video ref={video} src={src} playsInline preload="auto" draggable={false} onCanPlay={onCanPlay}/>
    <img ref={still} className="video-still" alt="" aria-hidden="true" draggable={false}/>
    {active&&<div className="video-controls nodrag nowheel" onDoubleClick={event=>event.stopPropagation()}>
      <button aria-label={playing?'暂停视频':'播放视频'} onClick={toggle}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>
      <span>{clock(time)}</span><input aria-label="视频进度" type="range" min="0" max={duration||1} step="0.01" value={Math.min(time,duration||1)} disabled={!duration} onChange={event=>{video.current.currentTime=Number(event.target.value);setTime(Number(event.target.value));}}/><span>{clock(duration)}</span>
      <button aria-label={muted?'取消静音':'静音'} onClick={()=>{video.current.muted=!video.current.muted;}}>{muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button>
      <input className="video-volume" aria-label="视频音量" type="range" min="0" max="1" step="0.05" value={muted?0:volume} onChange={event=>{video.current.volume=Number(event.target.value);video.current.muted=false;}}/>
      <button aria-label="全屏视频" onClick={async()=>{try{if(document.fullscreenElement===frame.current)await document.exitFullscreen();else if(frame.current.requestFullscreen)await frame.current.requestFullscreen();else video.current.webkitEnterFullscreen?.();}catch{setError('当前浏览器无法进入全屏。');}}}><Maximize size={15}/></button>
    </div>}
    {(error||previewError)&&<p className="video-error nodrag">{error||previewError}{previewError&&<button type="button" onClick={()=>retryPreview.current()} style={{marginLeft:8,textDecoration:'underline'}}>重试预览</button>}</p>}
  </div>;
}
