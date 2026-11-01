import {resolveMentions} from './node-mentions.mjs';
export const organizePermissions={move:true,connect:true,disconnect:true,create:false,delete:false,prompt:false,generate:false};
export const organizePrompt=`请整理当前完整画布。以下是本次默认 specification，必须逐项满足：
1. 覆盖全部节点，不受选中或引用范围限制，不遗漏。每个节点都提供 move（位置不变也提供），便于核验覆盖。
2. 逐一检查节点提示词中的 @图片/视频名称，以明确引用建立依赖；绑定的 mentions 真实 ID 可消除同名歧义。连线方向为上游参考 → 下游使用者。不能凭剧情、编号或人物出现推断额外依赖。未解析引用、同名歧义、循环依赖等矛盾先问清，actions 返回空数组。
3. 编号辅助生成先后，例如图片5早于图片7；时间先后用位置表达，不为编号顺序虚构连线。编号与明确依赖冲突时先澄清。
4. 无提示词节点不推断、不添加入向依赖，作为独立分支起点；其他节点明确引用它们时仍建立出向连线。
5. 整体从左向右展开为生成关系图，上游在左、下游在右。逐节点沿依赖挂接，分支上下错开，优先展示创作思路，不强行排成整齐层级或网格。
6. 相邻节点布局步距尽量450—800画布单位，密集区域适当放宽。用实际节点卡片宽高避免重叠；这不是每条跨分支线的长度上限。未知尺寸先澄清，不能用素材像素尺寸代替。
7. 按依赖顺序逐节点同时考虑移动和连线，不能只移动不补线或只补线不移动。
8. 从头核对全部目标依赖，旧线可视作废。正确线保留、不重复添加，错误线断开后修正。若快照不完整，明确报告不能完整核验，不冒称完成。
9. 硬性保证：不改任何节点提示词、文本、名称或素材，不新增或删除节点，不生成素材。只允许 move、connect、disconnect。
10. 使用已有节点真实 ID；connect/disconnect 使用 source、target。修正端点先 disconnect 再 connect。全部动作按依赖顺序返回，不按固定数量分批。
11. 回复逐项核对节点覆盖、引用关系、编号先后、方向、间距及硬性保证。输出 JSON {"text":"待执行：方案和核对说明","actions":[...]}。你返回的是待执行建议，应用负责执行及核验；没有实际执行结果和终态验证不得声称已整理完成。
12. 工作边界：模型只返回文字与 JSON 动作建议，不调用工具、不访问文件或网络。出现尚未解决的矛盾先澄清，澄清期间 actions 必须为空数组。`;
const key=(source,target)=>JSON.stringify([source,target]);
export function organizationDependencies(nodes){
 const edges=new Map(),issues=[];
 for(const n of nodes){
  const text=n.type==='text'?(n.data?.text||''):(n.data?.prompt||'');
  if(!text.trim())continue;
  let mentions=[];
  try{mentions=resolveMentions(text,n.data?.mentions||[],nodes);}catch(error){issues.push(`${n.id}: ${error.message}`);}
  // Accept numbered UI labels with or without spaces, but never guess between names.
  for(const match of text.matchAll(/@(图片|视频)\s*\d+/g)){
   if(mentions.some(m=>match.index>=m.start&&match.index<m.end))continue;
   const matches=nodes.filter(v=>['image','video'].includes(v.type)&&('@'+v.data?.title).replace(/\s/g,'')===match[0].replace(/\s/g,''));
   if(matches.length===1)mentions.push({nodeId:matches[0].id,start:match.index,end:match.index+match[0].length});
   else issues.push(`${n.id}: ${match[0]} ${matches.length?'同名歧义':'未找到节点'}`);
  }
  for(const match of text.matchAll(/@[^\s@，。；、：！？,;:!?\n]+/g))if(!mentions.some(m=>match.index>=m.start&&match.index<m.end))issues.push(`${n.id}: 引用 ${match[0]} 未解析`);
  for(const m of mentions){const source=nodes.find(v=>v.id===m.nodeId);if(!source||!['image','video'].includes(source.type))continue;if(source.id===n.id)issues.push(`${n.id}: 自引用`);else edges.set(key(source.id,n.id),{source:source.id,target:n.id});}
 }
 const outgoing=new Map(nodes.map(n=>[n.id,[]])),indegree=new Map(nodes.map(n=>[n.id,0]));
 for(const e of edges.values()){outgoing.get(e.source).push(e.target);indegree.set(e.target,indegree.get(e.target)+1);}
 const queue=nodes.filter(n=>!indegree.get(n.id)).map(n=>n.id);
 for(let i=0;i<queue.length;i++)for(const target of outgoing.get(queue[i])){indegree.set(target,indegree.get(target)-1);if(!indegree.get(target))queue.push(target);}
 if(queue.length!==nodes.length)issues.push('明确引用存在循环依赖，不能同时满足全部上游在左');
 return {edges:[...edges.values()],issues:[...new Set(issues)]};
}
export function organizationFingerprint(nodes,edges){return JSON.stringify({nodes:nodes.map(n=>({id:n.id,type:n.type,position:n.position,data:n.data})),edges:edges.map(e=>({id:e.id,source:e.source,target:e.target}))});}
export function verifyOrganization(before,after,actions){
 const issues=[],warnings=[],moves=new Set(actions.filter(a=>a.type==='move').map(a=>a.id));
 if(actions.some(a=>!['move','connect','disconnect'].includes(a.type)))issues.push('包含整理权限以外的动作');
 if(before.nodes.length!==after.nodes.length)issues.push('节点数量发生变化');
 for(const n of before.nodes){const next=after.nodes.find(v=>v.id===n.id);if(!next||next.type!==n.type||JSON.stringify(next.data)!==JSON.stringify(n.data))issues.push(`${n.id}: 节点内容被更改`);if(!moves.has(n.id))issues.push(`${n.id}: 未提供布局动作`);}
 const expected=organizationDependencies(before.nodes);issues.push(...expected.issues);
 const actual=new Set(after.edges.map(e=>key(e.source,e.target))),wanted=new Set(expected.edges.map(e=>key(e.source,e.target)));
 if(actual.size!==after.edges.length)issues.push('存在重复依赖线');
 for(const e of wanted)if(!actual.has(e))issues.push(`缺少依赖 ${e}`);
 for(const e of actual)if(!wanted.has(e))issues.push(`多余依赖 ${e}`);
 const dimensions=n=>({width:n.measured?.width??n.width??n.style?.width,height:n.measured?.height??n.height??n.style?.height});
 for(const n of after.nodes){const d=dimensions(n);if(!(d.width>0&&d.height>0))issues.push(`${n.id}: 缺少实际卡片尺寸`);}
 for(const e of expected.edges){const s=after.nodes.find(n=>n.id===e.source),t=after.nodes.find(n=>n.id===e.target);if(!s||!t)continue;if(t.position.x<s.position.x+dimensions(s).width)issues.push(`${e.source} → ${e.target}: 下游未在上游右侧`);if(t.position.x-s.position.x<450)warnings.push(`${e.source} → ${e.target}: 横向步距小于450`);}
 for(let i=0;i<after.nodes.length;i++)for(let j=i+1;j<after.nodes.length;j++){const a=after.nodes[i],b=after.nodes[j],ad=dimensions(a),bd=dimensions(b);if(a.position.x<b.position.x+bd.width&&b.position.x<a.position.x+ad.width&&a.position.y<b.position.y+bd.height&&b.position.y<a.position.y+ad.height)issues.push(`${a.id} / ${b.id}: 卡片重叠`);}
 const numbered=after.nodes.map(n=>({n,m:n.data?.title?.match(/^(图片|视频)\s*(\d+)$/)})).filter(v=>v.m);
 for(let i=0;i<numbered.length;i++)for(let j=i+1;j<numbered.length;j++){const a=numbered[i],b=numbered[j];if(a.m[1]===b.m[1]&&Number(a.m[2])!==Number(b.m[2])&&(Number(a.m[2])-Number(b.m[2]))*(a.n.position.x-b.n.position.x)<0)issues.push(`${a.n.id} / ${b.n.id}: 编号先后与横向位置冲突`);}
 return {ok:!issues.length,issues:[...new Set(issues)],warnings:[...new Set(warnings)],nodeCount:after.nodes.length,edgeCount:after.edges.length};
}
