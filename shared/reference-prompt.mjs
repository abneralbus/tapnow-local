export function referencePrompt(prompt,references,mentions=[]){
 if(!Array.isArray(mentions)||mentions.length>80)throw new Error('引用标记格式无效');
 let result='',cursor=0;
 for(const m of [...mentions].sort((a,b)=>a.start-b.start)){
  if(!m||!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<cursor||m.end<=m.start||m.end>prompt.length||prompt.slice(m.start,m.end)!==m.token)throw new Error('引用文字已改变，请重新选择 @ 素材');
  const index=references.findIndex(r=>r.nodeId===m.nodeId);
  if(index<0)throw new Error('引用的素材未随请求上传，请重新选择参考图；当前生成接口不支持视频作为输入');
  result+=prompt.slice(cursor,m.start)+`[参考图 ${index+1}]`;cursor=m.end;
 }
 result+=prompt.slice(cursor);
 // Legacy prompts can still use a unique named reference without a stored range.
 const names=[...new Set(references.map(r=>r.label).filter(Boolean))].sort((a,b)=>b.length-a.length);
 for(const name of names){const matches=references.map((r,i)=>r.label===name?i:-1).filter(i=>i>=0),escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp('@'+escaped+'(?![0-9A-Za-z])','g');if(re.test(result)&&matches.length>1)throw new Error('同名素材引用不明确，请使用 @ 菜单重新选择');result=result.replace(re,`[参考图 ${matches[0]+1}]`);}
 if(/@(?:图片|视频)\s*\d+/.test(result))throw new Error('提示词含未关联的图片或视频，请通过 @ 菜单选择实际素材');
 if(!references.length||(!mentions.length&&!references.some(r=>r.label)))return result;
 return result+'\n\n参考素材对应关系（与本次实际上传的图片顺序一致）：\n'+references.map((r,i)=>`参考图 ${i+1}${r.label?'（'+r.label+'）':''} = 第 ${i+1} 张上传图片${r.role==='start'?'，作为首帧':r.role==='end'?'，作为尾帧':'，作为参考素材'}。`).join('\n')+'\n上文 [参考图 N] 指对应上传图片；该处描述的主体、外观、构图或风格应参考这张图片，不要把引用标记画成文字。';
}
