export const nodeLabels={image:'图片',video:'视频',audio:'音频',text:'文本'};
export function editMentions(before,after,mentions=[]){
 let left=0;while(left<before.length&&left<after.length&&before[left]===after[left])left++;
 let right=0;while(right<before.length-left&&right<after.length-left&&before.at(-1-right)===after.at(-1-right))right++;
 const end=before.length-right,delta=after.length-before.length;
 return mentions.filter(m=>Number.isInteger(m.start)&&Number.isInteger(m.end)&&before.slice(m.start,m.end)===m.token).flatMap(m=>m.end<=left?[m]:m.start>=end?[{...m,start:m.start+delta,end:m.end+delta}]:[]);
}
export function mentionQuery(text,caret,mentions=[]){const prefix=text.slice(0,caret),start=prefix.lastIndexOf('@');if(start<0||mentions.some(m=>m.start===start&&m.end<=caret&&text.slice(m.start,m.end)===m.token))return null;const query=prefix.slice(start+1);return /[\n@，。！？]/.test(query)||query.length>80?null:{start,end:caret,query};}
export function insertMention(text,mentions,query,item){
 const token='@'+item.title,next=text.slice(0,query.start)+token+' '+text.slice(query.end);
 const bindings=editMentions(text,next,mentions);bindings.push({nodeId:item.id,start:query.start,end:query.start+token.length,token});bindings.sort((a,b)=>a.start-b.start);
 return {text:next,mentions:bindings,caret:query.start+token.length+1};
}
export function rewriteMentions(text,mentions=[],nodes=[]){
 const byId=new Map(nodes.map(n=>[n.id,n])),result=[];let cursor=0,out='';
 for(const m of [...mentions].sort((a,b)=>a.start-b.start)){
  if(!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<cursor||m.end>text.length||text.slice(m.start,m.end)!==m.token)continue;
  out+=text.slice(cursor,m.start);const node=byId.get(m.nodeId),token=node?'@'+node.data.title:m.token;
  result.push({...m,start:out.length,end:out.length+token.length,token});out+=token;cursor=m.end;
 }
 return {text:out+text.slice(cursor),mentions:result};
}
export function renumberNodes(nodes){
 const counts={},titled=nodes.map(n=>{
  const label=nodeLabels[n.type],data=n.data||{},automatic=data.autoTitle===true||(data.autoTitle!==false&&label&&(!data.title||new RegExp('^'+label+'(?: \\d+)?$').test(data.title)));
  if(!automatic)return n;const title=label+' '+(counts[n.type]=(counts[n.type]||0)+1);
  return data.title===title&&data.autoTitle===true?n:{...n,data:{...data,title,autoTitle:true}};
 });
 const result=titled.map(n=>{if(!n.data?.mentions?.length)return n;const key=n.type==='text'?'text':'prompt',updated=rewriteMentions(n.data[key]||'',n.data.mentions,titled);return updated.text===n.data[key]&&JSON.stringify(updated.mentions)===JSON.stringify(n.data.mentions)?n:{...n,data:{...n.data,[key]:updated.text,mentions:updated.mentions}};});
 return result.every((n,i)=>n===nodes[i])?nodes:result;
}
export function resolveMentions(text,bindings=[],nodes=[]){
 const byId=new Map(nodes.map(n=>[n.id,n])),resolved=[];
 for(const m of bindings){if(text.slice(m.start,m.end)!==m.token)continue;if(!byId.has(m.nodeId))throw new Error('引用的节点已删除，请重新选择 @ 素材');resolved.push(m);}
 const names=[...new Set(nodes.filter(n=>['image','video'].includes(n.type)).map(n=>n.data.title))].filter(Boolean).sort((a,b)=>b.length-a.length);
 for(const name of names){const token='@'+name;let start=text.indexOf(token);while(start>=0){const end=start+token.length;if(!/[0-9A-Za-z]/.test(text[end]||'')&&!resolved.some(m=>start<m.end&&end>m.start)){
  const matches=nodes.filter(n=>['image','video'].includes(n.type)&&n.data.title===name);if(matches.length!==1)throw new Error('同名节点无法自动识别，请从 @ 菜单重新选择');resolved.push({nodeId:matches[0].id,start,end,token});
 }start=text.indexOf(token,end);}}
 return resolved.sort((a,b)=>a.start-b.start);
}
