const labels={text:'文本',image:'图片',video:'视频',audio:'音频'};

export function canvasAgentContext({name='',nodes=[],edges=[],referenceIds}){
  if(Array.isArray(referenceIds)){const wanted=new Set(referenceIds);nodes=nodes.map(n=>({...n,selected:wanted.has(n.id)}));}
  const selected=nodes.filter(node=>node.selected),ids=new Set(selected.map(node=>node.id));
  if(selected.length){const parents=new Map();for(const edge of edges){if(!parents.has(edge.target))parents.set(edge.target,[]);parents.get(edge.target).push(edge.source);}const queue=[...ids];for(let i=0;i<queue.length;i++)for(const parent of parents.get(queue[i])||[])if(!ids.has(parent)){ids.add(parent);queue.push(parent);}}
  const included=selected.length?[...selected,...nodes.filter(node=>ids.has(node.id)&&!node.selected)]:nodes;
  const lines=[`画布：${name||'未命名'}；共 ${nodes.length} 个节点。`,selected.length?'以下是选中节点及其上游参考：':'以下是当前画布概述：','媒体信息仅含标题、提示词与状态；未提供图片像素、视频画面或音频内容，不要声称看过或听过素材。'];
  const shown=new Set();let length=lines.join('\n').length;
  for(const node of included){
    const data=node.data||{},text=String(data.text||data.prompt||'').slice(0,2200);
    const line=`[${node.id}] ${labels[node.type]||node.type}：${data.title||labels[node.type]||'节点'}${node.selected?'（选中）':''}\n${text||'未填写文字说明'}${data.status?`\n状态：${data.status}`:''}${data.src?'；已有素材':''}；位置 (${node.position?.x||0}, ${node.position?.y||0})`;
    if(length+line.length>13500){lines.push('其余节点已省略。');break;}
    lines.push(line);shown.add(node.id);length+=line.length+1;
  }
  const links=edges.filter(edge=>shown.has(edge.source)&&shown.has(edge.target)).map(edge=>`${edge.source} → ${edge.target}`);
  if(links.length)lines.push('连接关系：\n'+links.join('\n').slice(0,2000));
  return lines.join('\n\n').slice(0,16000);
}
