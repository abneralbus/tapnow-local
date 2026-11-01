export function nodeGeometry(node){
 const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
 const width=positive(node.measured?.width)??positive(node.width)??positive(node.style?.width);
 const height=positive(node.measured?.height)??positive(node.height)??positive(node.style?.height);
 return {x:node.position?.x??0,y:node.position?.y??0,width,height,dimensionSource:node.measured?.width&&node.measured?.height?'measured':width&&height?'declared':'unknown'};
}
export function canvasAgentContext({name='',nodes=[],edges=[],referenceIds=[]}){
 const refs=new Set(referenceIds);
 return JSON.stringify({canvas:name||'未命名',nodeCount:nodes.length,edgeCount:edges.length,complete:true,
  visibility:'完整画布快照，包含全部节点和全部连线；selected/referenced 仅为关注标记，不限制工作范围。未提供图片像素、视频画面或音频内容。',
  geometry:'坐标和节点宽高均为画布坐标单位，不随视口缩放改变；尺寸是卡片尺寸，不是素材分辨率。null 表示尚未测量，不得当作零。节点默认左侧输入、右侧输出。',
  nodes:nodes.map(n=>({id:n.id,type:n.type,title:n.data?.title||'',selected:!!n.selected,referenced:refs.has(n.id),...nodeGeometry(n),
   text:n.data?.text||'',prompt:n.data?.prompt||'',mentions:n.data?.mentions||[],status:n.data?.status||'',hasMedia:!!n.data?.src,
   media:{width:n.data?.width??null,height:n.data?.height??null,aspectRatio:n.data?.aspectRatio??null},
   generation:{provider:n.data?.provider,model:n.data?.model,mode:n.data?.mode,duration:n.data?.duration,resolution:n.data?.resolution}})),
  edges:edges.map(e=>({id:e.id,source:e.source,target:e.target,sourceHandle:e.sourceHandle??null,targetHandle:e.targetHandle??null}))});
}
