import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageCircle,Workflow} from 'lucide-react';

const titles={text:'文本',image:'图片',video:'视频',audio:'音频'};
const previewPoint=(x,y)=>({x:Math.max(8,Math.min(x+18,window.innerWidth-150)),y:Math.max(8,Math.min(y+15,window.innerHeight-110))});
const contains=(rect,event)=>rect&&event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
export default function AgentReferenceButton({nodes,onReference,onOpenAgent,getDropTarget,onHoverChange}){
  const button=useRef(),gesture=useRef(null),timer=useRef(),suppressClick=useRef(false),latest=useRef(),cancelGesture=useRef();
  const [flight,setFlight]=useState(null);
  latest.current={nodes,onReference,onOpenAgent,getDropTarget,onHoverChange};
  useEffect(()=>{
    function release(drag){try{if(button.current?.hasPointerCapture?.(drag.pointerId))button.current.releasePointerCapture(drag.pointerId);}catch{}}
    function finish(event,cancelled=false){
      const drag=gesture.current;if(!drag||(event.pointerId!==undefined&&event.pointerId!==drag.pointerId))return;
      gesture.current=null;release(drag);latest.current.onHoverChange(null);
      if(!drag.active)return;
      suppressClick.current=true;
      const rect=latest.current.getDropTarget()?.getBoundingClientRect(),accepted=!cancelled&&contains(rect,event);
      if(accepted)latest.current.onReference(drag.items.map(n=>n.id));
      const target=accepted?rect:button.current?.getBoundingClientRect()||drag.origin;
      setFlight(old=>old?{...old,phase:accepted?'landing':'returning',x:target.left+target.width/2-65,y:target.top+target.height/2-45}:null);
      clearTimeout(timer.current);timer.current=setTimeout(()=>setFlight(null),window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:180);
    }
    function move(event){
      const drag=gesture.current;if(!drag||event.pointerId!==drag.pointerId)return;
      if(!drag.active){
        if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
        drag.active=true;suppressClick.current=true;latest.current.onOpenAgent();
      }
      event.preventDefault();
      const rect=latest.current.getDropTarget()?.getBoundingClientRect(),over=contains(rect,event);
      if(drag.over!==!!over){drag.over=!!over;latest.current.onHoverChange(over?{count:drag.items.length}:null);}
      setFlight({items:drag.items,...previewPoint(event.clientX,event.clientY),phase:'dragging',over:!!over});
    }
    cancelGesture.current=event=>finish(event,true);
    const up=event=>finish(event),cancel=event=>finish(event,true),blur=()=>finish({},true),key=event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();finish({},true);}};
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
    window.addEventListener('blur',blur);window.addEventListener('keydown',key);
    return()=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',blur);window.removeEventListener('keydown',key);
      clearTimeout(timer.current);if(gesture.current){const drag=gesture.current;gesture.current=null;release(drag);latest.current.onHoverChange(null);}
    };
  },[]);
  function down(event){
    event.stopPropagation();if(event.button!==0||event.isPrimary===false||!nodes.length||gesture.current)return;
    clearTimeout(timer.current);setFlight(null);suppressClick.current=false;
    gesture.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,origin:event.currentTarget.getBoundingClientRect(),active:false,items:nodes.map(n=>({id:n.id,type:n.type,title:n.data.title||titles[n.type],src:n.type==='image'?n.data.src:undefined}))};
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
  }
  function click(event){event.stopPropagation();if(suppressClick.current){suppressClick.current=false;return;}onReference(nodes.map(n=>n.id));}
  return <><button ref={button} type="button" className="selection-reference nodrag nopan nowheel" aria-label="引用到 Agent" title="单击引用；按住拖到 Agent 输入框" onPointerDown={down} onMouseDown={e=>e.stopPropagation()} onClick={click} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')suppressClick.current=false;}} onLostPointerCapture={e=>{if(gesture.current?.pointerId===e.pointerId)cancelGesture.current?.(e);}}><MessageCircle size={16}/><span>引用到 Agent</span></button>
    {flight&&createPortal(<div className="agent-ref-flight" aria-hidden="true" data-phase={flight.phase} data-over={flight.over} style={{left:flight.x,top:flight.y}}>{flight.items.slice(0,3).map((n,i)=><div key={n.id} style={{transform:`translate(${i*4}px,${-i*4}px) rotate(${i*3}deg)`,zIndex:3-i}}>{n.src?<img src={n.src} alt="" draggable={false}/>:<Workflow size={24}/>}<span>{n.title}</span>{i===0&&<b>{flight.items.length}</b>}</div>)}</div>,document.body)}
  </>;
}
