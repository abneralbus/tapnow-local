export function videoRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('无效的视频请求');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > 12000) throw new Error('提示词需要 1–12000 个字符');
  const duration = Number(input.duration ?? 4);
  const width = Number(input.width ?? 1344), height = Number(input.height ?? 768);
  const steps = Number(input.steps ?? 50), seed = Number(input.seed ?? 42);
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error('视频时长应为 4–15 秒');
  if (!((width===1344&&height===768)||(width===960&&height===544))) throw new Error('当前部署支持 16:9、768p 或 544p');
  if (!Number.isInteger(steps) || steps < 4 || steps > 60) throw new Error('采样步数应为 4–60');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('随机种子超出范围');
  return { prompt, duration, width, height, steps, seed };
}

export function canvasDocument(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('无效的画布文件');
  if (value.nodes.length > 1000 || value.edges.length > 4000) throw new Error('画布超过节点或连线数量限制');
  const ids = new Set();
  for (const node of value.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || node.id.length>100 || ids.has(node.id) || !['text','image','video','audio'].includes(node.type) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y) || !node.data || typeof node.data !== 'object') throw new Error('节点格式错误');
    ids.add(node.id);
    for (const key of ['title','text','prompt','src','error','status','jobId','mode','provider','model','aspectRatio']) if (node.data[key]!==undefined && typeof node.data[key]!=='string') throw new Error('节点内容格式错误');
    if(node.data.autoTitle!==undefined&&typeof node.data.autoTitle!=='boolean')throw new Error('自动名称格式错误');
    if(node.data.mentions!==undefined&&(!Array.isArray(node.data.mentions)||node.data.mentions.length>80||node.data.mentions.some(m=>!m||typeof m.nodeId!=='string'||typeof m.token!=='string'||!m.token.startsWith('@')||m.token.length>101||!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<0||m.end<=m.start)))throw new Error('节点引用标记无效');
    if(node.data.references!==undefined){
      if(!Array.isArray(node.data.references)||node.data.references.length>8||node.data.references.some(r=>!r||typeof r.src!=='string'||!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/.test(r.src)||!['reference','start','end'].includes(r.role??'reference')||(r.nodeId!==undefined&&typeof r.nodeId!=='string')))throw new Error('图片引用格式错误或素材不属于本地画布');
    }
    if(node.data.duration!==undefined&&(!Number.isFinite(node.data.duration)||node.data.duration<1||node.data.duration>60))throw new Error('节点视频时长无效');
    if (node.data.src && !/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|ogg|m4a)$/.test(node.data.src)) throw new Error('素材地址必须来自本地素材库');
  }
  for (const edge of value.edges) if (!edge || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) throw new Error('连线引用了不存在的节点');
  const viewport=value.viewport;
  if (viewport && (![viewport.x,viewport.y,viewport.zoom].every(Number.isFinite) || viewport.zoom<.15 || viewport.zoom>2.5)) throw new Error('画布视角无效');
  const messages=Array.isArray(value.messages)?value.messages.slice(-200):[];
  if(messages.some(m=>!m||!['user','assistant','error'].includes(m.role)||typeof m.text!=='string'))throw new Error('对话格式错误');
  return { name: String(value.name || 'Untitled').slice(0,100), nodes:value.nodes, edges:value.edges, viewport, messages, updatedAt:Date.now() };
}

export function endpoint(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error('Colab 地址必须是 HTTPS（本机地址允许 HTTP）');
  return url.toString().replace(/\/$/, '');
}
