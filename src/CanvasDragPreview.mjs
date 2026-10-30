import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Workflow} from 'lucide-react';

const h=React.createElement;
function stackTransform(flight,index){
  const angle=index?(index%2?-1:1)*Math.min(index*2,7):-1.5;
  if(flight.compact){
    const scale=Math.min(.4,100/flight.entries[0].rect.width);
    return `translate3d(${index*3}px,${-index*3}px,0) rotate(${angle}deg) scale(${scale*(1-index*.018)})`;
  }
  return `translate3d(${flight.offset.x+index*9}px,${flight.offset.y-index*7-10}px,0) rotate(${angle}deg) scale(${1.035-index*.018})`;
}
const timing=duration=>({duration:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:duration,easing:'cubic-bezier(.22,.8,.22,1)',fill:'both'});

// A separate, pointer-transparent layer keeps previews out of hit testing and modal clipping.
export default forwardRef(function CanvasDragPreview(_,ref){
  const [flight,setFlight]=useState(null),current=useRef(null),root=useRef(null),cards=useRef(new Map()),animations=useRef([]);
  function cancelAnimations(){animations.current.forEach(animation=>animation.cancel());animations.current=[];}
  useLayoutEffect(()=>()=>{current.current=null;cancelAnimations();},[]);
  useImperativeHandle(ref,()=>({
    start(entries,point,primaryId,count){
      cancelAnimations();
      const ordered=[entries.find(card=>card.id===primaryId),...entries.filter(card=>card.id!==primaryId)].filter(Boolean).slice(0,6);
      const primary=ordered[0];if(!primary)return;
      const value={entries:ordered,count,point:{...point},origin:{...point},compact:false,offset:{x:primary.rect.left-point.x,y:primary.rect.top-point.y}};
      current.current=value;setFlight(value);
    },
    move(point,dock=null){
      const value=current.current;if(!value)return;
      const compact=!!dock,previous=value.origin;
      // Keep the small stack outside the sidebar so even long group names remain visible.
      const origin=compact?{x:Math.min(Math.max(point.x+24,dock.right+16),window.innerWidth-120),y:Math.min(point.y+16,window.innerHeight-110)}:{...point};
      if(compact&&dock.right>window.innerWidth-140)origin.y=Math.min(Math.max(origin.y,dock.bottom+16),window.innerHeight-110);
      const changed=compact!==value.compact;
      const frames=changed?value.entries.map(entry=>{const element=cards.current.get(entry.id);return element?{element,transform:window.getComputedStyle(element).transform}:null;}):[];
      value.point={...point};value.origin=origin;value.compact=compact;
      if(root.current){root.current.style.transform=`translate3d(${origin.x}px,${origin.y}px,0)`;root.current.dataset.compact=String(compact);}
      if(changed){
        cancelAnimations();
        frames.forEach((frame,index)=>{
          if(!frame)return;
          const {element}=frame,to=stackTransform(value,index);
          // Collapse rear cards onto the front before shrinking, never fly them side by side.
          const transform=compact?(frames[0]?.transform||frame.transform):frame.transform;
          const from=`translate3d(${previous.x-origin.x}px,${previous.y-origin.y}px,0) ${transform==='none'?'':transform}`;
          element.style.transform=to;
          if(element.animate){const animation=element.animate([{transform:from},{transform:to}],timing(compact?140:180));animation.finished.catch(()=>{});animations.current.push(animation);}
        });
      }
    },
    async settle(target){
      const value=current.current;if(!value)return;
      const frames=value.entries.map(entry=>{const element=cards.current.get(entry.id);return {entry,element,transform:element?window.getComputedStyle(element).transform:'none',opacity:element?window.getComputedStyle(element).opacity:'1'};});
      cancelAnimations();
      if(root.current)root.current.dataset.phase=target?'landing':'returning';
      const motions=[];
      for(const {entry,element,transform,opacity} of frames){
        if(!element)continue;
        const end=target?`translate3d(${target.left+target.width/2-value.origin.x-entry.rect.width*.06}px,${target.top+target.height/2-value.origin.y-entry.rect.height*.06}px,0) rotate(0deg) scale(.12)`:`translate3d(${entry.rect.left-value.origin.x}px,${entry.rect.top-value.origin.y}px,0) rotate(0deg) scale(1)`;
        element.style.transform=end;element.style.opacity=target?'0':'1';
        if(element.animate){const animation=element.animate([{transform,opacity},{transform:end,opacity:target?0:1}],timing(target?240:300));animations.current.push(animation);motions.push(animation.finished.catch(()=>{}));}
      }
      await Promise.all(motions);
      if(current.current===value){cancelAnimations();current.current=null;setFlight(null);}
    },
  }),[]);
  useLayoutEffect(()=>{
    if(!flight||current.current!==flight)return;
    for(const [index,entry] of flight.entries.entries()){
      const element=cards.current.get(entry.id);if(!element)continue;
      const source=flight.compact?flight.entries[0]:entry;
      const from=`translate3d(${source.rect.left-flight.origin.x}px,${source.rect.top-flight.origin.y}px,0) rotate(0deg) scale(1)`;
      const to=stackTransform(flight,index);
      element.style.transform=to;
      if(element.animate){const animation=element.animate([{transform:from,boxShadow:'0 4px 12px #0003'},{transform:to,boxShadow:'0 24px 60px #0009'}],timing(flight.compact?140:280));animation.finished.catch(()=>{});animations.current.push(animation);}
    }
  },[flight]);
  if(!flight)return null;
  return createPortal(h('div',{ref:root,className:'cm-flight', 'aria-hidden':true,'data-phase':'floating','data-compact':String(flight.compact),style:{transform:`translate3d(${flight.origin.x}px,${flight.origin.y}px,0)`}},
    flight.entries.map((entry,index)=>h('div',{key:entry.id,ref:element=>{if(element)cards.current.set(entry.id,element);else cards.current.delete(entry.id);},className:'cm-flight-card',style:{width:entry.rect.width,height:entry.rect.height,zIndex:flight.entries.length-index}},
      h('div',{className:'cm-flight-cover'},entry.cover?h('img',{src:entry.cover,alt:'',draggable:false}):h(Workflow,{size:36})),
      h('div',{className:'cm-flight-caption'},h('b',null,entry.name),h('small',null,`${entry.count} 个节点`)),
      index===0&&flight.count>1?h('span',{className:'cm-flight-count'},flight.count):null,
    )),
  ),document.body);
});
