import {generationRequest,providerCatalog} from '../server/media-request.mjs';

export {providerCatalog};
export function modeReferences(references,mode){
  return references.filter(ref=>mode==='frames'?['start','end'].includes(ref.role):mode==='reference'&&ref.role==='reference')
    .map(({src,role,nodeId,label})=>({src,role,nodeId,...(label?{label}:{})}));
}
export function generationIssue(type,provider,mode,references=[],model,duration=4,aspectRatio='16:9'){
  try{generationRequest({kind:type,provider,mode,references:modeReferences(references,mode),model,duration,aspectRatio,prompt:'规格检查',width:1344,height:768});return '';}
  catch(error){return error.message;}
}

export function newGenerationData(type,sources=[]){
  const images=sources.filter(node=>node.type==='image'&&node.data?.src);
  if(type==='video')return {provider:'flow',model:images.length>1?'omni':'veo-fast',mode:images.length>1?'reference':'frames',duration:8,aspectRatio:'16:9',references:images.length===1?[{src:images[0].data.src,nodeId:images[0].id,role:'start'}]:[]};
  return {provider:'flow',mode:images.length?'reference':'text',duration:4,aspectRatio:'16:9',resolution:'768p'};
}
