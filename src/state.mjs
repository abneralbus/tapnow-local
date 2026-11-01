import {canvasDocument} from '../server/validation.mjs';
export const activeJob = status => ['queued','running','downloading'].includes(status);
export function downstreamGraph(nodes,sourceIds,targetId){
  const ids=new Set(Array.isArray(sourceIds)?sourceIds:[sourceIds]);
  const sources=nodes.filter(node=>ids.has(node.id)&&node.id!==targetId);
  return {
    position:sources.length?{
      x:Math.max(...sources.map(node=>node.position.x+(node.measured?.width||node.width||340)))+80,
      y:sources.reduce((sum,node)=>sum+node.position.y,0)/sources.length
    }:null,
    mode:sources.some(node=>node.type==='image')?'reference':'text',
    edges:sources.map(node=>({id:crypto.randomUUID(),source:node.id,target:targetId}))
  };
}
const jobPhase={queued:0,running:1,downloading:2,completed:3,failed:3,cancelled:3};

function mergeJob(current,incoming){
  if(!current)return incoming;
  if((jobPhase[incoming.status]??0)<(jobPhase[current.status]??0))return current;
  if(jobPhase[current.status]===3&&incoming.status!==current.status)return current;
  return {...current,...incoming,timings:{...current.timings,...incoming.timings}};
}

export function mergeJobs(current,incoming){
  const jobs=new Map(current.map(job=>[job.id,job]));
  for(const job of incoming)jobs.set(job.id,mergeJob(jobs.get(job.id),job));
  return [...jobs.values()].sort((a,b)=>b.startedAt-a.startedAt);
}

export function parseClipboardGraph(text) {
  let value;
  try { value=JSON.parse(text); } catch { return null; }
  if(value?.format!=='tapnow-graph')return null;
  return canvasDocument(value);
}

export function reconcileJobs(nodes, jobs, canvasId) {
  const result=nodes.map(node => {
    let job = jobs.filter(j => j.canvasId === canvasId && j.nodeId === node.id)
      .sort((a,b) => b.startedAt-a.startedAt)[0];
    if (!job || job.startedAt < Math.max(node.data.jobStartedAt||0,node.data.clickedAt||0)) return node;
    if(node.data.jobId===job.id){
      const existing={id:job.id,status:node.data.status};
      job=mergeJob(existing,job);
      if(job===existing)return node;
    }
    const data={...node.data,status:job.status,jobId:job.id,jobStartedAt:job.startedAt,progress:job.progress,
      error:job.error,receiptError:job.receiptError,src:job.src||node.data.src,timings:{...node.data.timings,...job.timings}};
    return JSON.stringify(data)===JSON.stringify(node.data)?node:{...node,data};
  });
  return result.every((node,index)=>node===nodes[index])?nodes:result;
}

export function copyGraph(nodes, edges) {
  const ids = new Map(nodes.map(n => [n.id,crypto.randomUUID()]));
  return {
    nodes:nodes.map(n => ({...structuredClone(n),id:ids.get(n.id),selected:true,
      position:{x:n.position.x+40,y:n.position.y+40},
      data:{...structuredClone(n.data),mentions:n.data.mentions?.map(m=>({...m,nodeId:ids.get(m.nodeId)||m.nodeId})),references:n.data.references?.map(ref=>({...ref,nodeId:ids.get(ref.nodeId)||ref.nodeId})),status:undefined,jobId:undefined,jobStartedAt:undefined,clickedAt:undefined,clickedSessionId:undefined,error:undefined,timings:undefined}})),
    edges:edges.filter(e => ids.has(e.source)&&ids.has(e.target)).map(e => ({...e,id:crypto.randomUUID(),source:ids.get(e.source),target:ids.get(e.target)}))
  };
}
