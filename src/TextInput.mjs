import React,{useEffect,useRef,useState} from 'react';

// React Flow syncs node props through an effect; keep the DOM value synchronous locally.
export default function TextInput({as='textarea',value='',onChange,onKeyDown,onBlur,onCompositionStart,onCompositionEnd,...props}){
  const [draft,setDraft]=useState(value),composing=useRef(false);
  useEffect(()=>{if(!composing.current)setDraft(value);},[value]);
  function change(event){
    setDraft(event.currentTarget.value);
    if(!composing.current&&!event.nativeEvent.isComposing)onChange?.(event);
  }
  function finish(event){
    composing.current=false;
    setDraft(event.currentTarget.value);
    onChange?.(event);
  }
  return React.createElement(as,{...props,value:draft,onChange:change,
    onCompositionStart:event=>{composing.current=true;onCompositionStart?.(event);},
    onCompositionEnd:event=>{finish(event);onCompositionEnd?.(event);},
    onBlur:event=>{if(composing.current)finish(event);onBlur?.(event);},
    onKeyDown:event=>{
      // Safari may clear isComposing before the Enter that confirms a candidate.
      if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229){event.stopPropagation();return;}
      onKeyDown?.(event);
    }
  });
}
