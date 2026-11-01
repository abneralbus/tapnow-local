export function mediaType(src){
  if(/^\/media\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/.test(src||''))return 'image';
  if(/^\/media\/[A-Za-z0-9_-]+\.(mp4|webm|mov)$/.test(src||''))return 'video';
  if(/^\/media\/[A-Za-z0-9_-]+\.(mp3|wav|ogg|m4a)$/.test(src||''))return 'audio';
  return null;
}
export function h3References(raw,mode){
  if(!Array.isArray(raw)||raw.length>12)throw new Error('H3 最多接收 12 份素材，其中图片最多 9 张、最多 3 段视频和 3 段音频');
  const refs=[],counts={image:0,video:0,audio:0};
  for(const item of raw){
    const type=mediaType(item?.src),role=item?.role??'reference';
    if(!type||!['reference','start','end'].includes(role))throw new Error('参考素材必须来自本地画布素材库');
    if(role!=='reference'&&type!=='image')throw new Error('首尾帧必须是图片');
    if(item.label!==undefined&&(typeof item.label!=='string'||item.label.length>100||/[\r\n]/.test(item.label)))throw new Error('参考素材名称无效');
    if(item.nodeId!==undefined&&typeof item.nodeId!=='string')throw new Error('参考节点 ID 无效');
    if(refs.some(r=>r.src===item.src&&r.role===role))continue;
    counts[type]++;
    refs.push({src:item.src,role,type,...(item.nodeId?{nodeId:item.nodeId}:{}),...(item.label?{label:item.label}:{})});
  }
  if(counts.image>9||counts.video>3||counts.audio>3)throw new Error('H3 最多接收 12 份素材，其中图片最多 9 张、最多 3 段视频和 3 段音频');
  if(mode==='text'&&refs.length)throw new Error('文字模式不能携带参考素材');
  if(mode==='reference'&&(!refs.length||refs.some(r=>r.role!=='reference')))throw new Error('全能参考模式需要至少一份参考素材');
  if(mode==='frames'){
    if(!refs.length||refs.some(r=>r.role==='reference')||refs.filter(r=>r.role==='start').length>1||refs.filter(r=>r.role==='end').length>1)throw new Error('首尾帧模式需要首帧、尾帧或各一张');
    refs.sort((a,b)=>(a.role==='start'?0:1)-(b.role==='start'?0:1));
  }
  if(!['text','frames','reference'].includes(mode))throw new Error('生成模式无效');
  return refs;
}
export function h3Prompt(prompt,refs,mentions=[]){
  if(!Array.isArray(mentions)||mentions.length>80)throw new Error('引用标记格式无效');
  const counts={image:0,video:0,audio:0};
  const tags=refs.map(r=>r.role==='start'?'首帧图片':r.role==='end'?'尾帧图片':`<${{image:'Picture',video:'Video',audio:'Audio'}[r.type]} ${++counts[r.type]}>`);
  let text='',cursor=0;
  for(const m of [...mentions].sort((a,b)=>a.start-b.start)){
    if(!m||!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<cursor||m.end<=m.start||m.end>prompt.length||prompt.slice(m.start,m.end)!==m.token)throw new Error('引用文字已改变，请重新选择 @ 素材');
    const index=refs.findIndex(r=>r.nodeId===m.nodeId);
    if(index<0)throw new Error('引用素材未随请求上传，请重新选择');
    text+=prompt.slice(cursor,m.start)+tags[index];cursor=m.end;
  }
  text+=prompt.slice(cursor);
  return text;
}
