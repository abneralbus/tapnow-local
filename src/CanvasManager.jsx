import React,{useEffect,useRef,useState} from 'react';
import {Plus,Search,Folder,FolderOpen,LayoutGrid,Trash2,MoreHorizontal,Workflow,FileJson,Check,Undo2,X,ArrowUpRight} from 'lucide-react';
import TextInput from './TextInput.mjs';
import CanvasDragPreview from './CanvasDragPreview.mjs';
import {trashExpiresAt} from '../shared/canvas-retention.mjs';

function SelectionCheckbox({label,checked,disabled,onChange,className=''}){
  const gesture=useRef(null);
  return <button type="button" role="checkbox" aria-label={label} aria-checked={checked} disabled={disabled} className={'cm-select-box '+className}
    onPointerDown={e=>{e.stopPropagation();gesture.current={x:e.clientX,y:e.clientY,cancelled:e.button!==0};}}
    onPointerMove={e=>{const start=gesture.current;if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>=6)start.cancelled=true;}}
    onPointerLeave={()=>{if(gesture.current)gesture.current.cancelled=true;}}
    onPointerCancel={()=>{if(gesture.current)gesture.current.cancelled=true;}}
    onClick={e=>{e.stopPropagation();const cancelled=gesture.current?.cancelled;gesture.current=null;if(e.detail!==0&&cancelled)return;onChange();}}>
    <span aria-hidden="true">{checked&&<Check size={13}/>}</span>
  </button>;
}

export default function CanvasManager({api,json,currentId,onOpen,onNew,onImport,onMutate}){
  const [items,setItems]=useState([]),[groups,setGroups]=useState([]),[tab,setTab]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('recent');
  const [selected,setSelected]=useState([]),[menu,setMenu]=useState(null),[edit,setEdit]=useState(null),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const dragSession=useRef(null),suppressClickUntil=useRef(0),pointerSession=useRef(null),preview=useRef(null),settling=useRef(false);
  const [dragIds,setDragIds]=useState([]),[dropTarget,setDropTarget]=useState(null),[feedback,setFeedback]=useState('');
  const trash=tab==='trash',group=groups.find(g=>g.id===tab);
  const [now,setNow]=useState(Date.now);
  const expiry=item=>item?.expiresAt||trashExpiresAt(item);
  const expired=item=>!!expiry(item)&&expiry(item)<=now;
  useEffect(()=>{if(!trash)return;setNow(Date.now());const timer=setInterval(()=>{setNow(Date.now());refresh().catch(e=>setError(e.message));},60000);return()=>clearInterval(timer);},[trash]);
  useEffect(()=>{setSelected(ids=>ids.filter(id=>items.some(item=>item.id===id)));},[items]);
  const confirming=edit?.type==='delete',cancelDelete=useRef(null);
  useEffect(()=>{if(!confirming)return;const previous=document.activeElement,container=previous?.closest('[role=dialog]');cancelDelete.current?.focus();return()=>{(previous?.isConnected?previous:container)?.focus();};},[confirming]);
  async function refresh(){const [active,deleted,gs]=await Promise.all([api('/canvases'),api('/canvases?trash=true'),api('/canvas-groups')]);setItems([...active,...deleted]);setGroups(gs);setLoaded(true);}
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  useEffect(()=>{setSelected([]);setMenu(null);setEdit(null);},[tab]);
  async function run(fn){if(busy)return;setBusy(true);setError('');try{await fn();setEdit(null);setMenu(null);setSelected([]);}catch(e){setError(e.message);}finally{try{await refresh();}catch(e){setError(e.message);}setBusy(false);}}
  const active=items.filter(p=>!p.deletedAt);
  const visible=items.filter(p=>(trash?!!p.deletedAt:!p.deletedAt)&&(tab==='all'||trash||(tab==='ungrouped'?!p.groupId:p.groupId===tab))&&p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(b.deletedAt||b.updatedAt)-(a.deletedAt||a.updatedAt));
  const selectable=visible.filter(item=>!trash||!expired(item));
  const heading=trash?'回收站':group?.name||(tab==='ungrouped'?'未分组':'全部画布');
  function begin(type,ids=[],name=''){setMenu(null);setError('');setValue(name);setEdit({type,ids:[...ids]});}
  function requestDelete(id){const ids=id?(selected.includes(id)?selected:[id]):selected;if(ids.length)begin('delete',ids);}
  function confirmationKey(event){
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();if(!busy)setEdit(null);}
    if(event.key==='Tab'){
      const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')];
      const index=buttons.indexOf(document.activeElement);event.preventDefault();
      buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();
    }
  }
  async function submit(e){e.preventDefault();await run(async()=>{
    if(edit.type==='newGroup')await api('/canvas-groups',json({name:value}));
    else if(edit.type==='renameGroup')await api('/canvas-groups/'+tab,json({name:value},'PATCH'));
    else if(edit.type==='deleteGroup'){await api('/canvas-groups/'+tab,{method:'DELETE'});setTab('ungrouped');}
    else await onMutate(edit.type,edit.ids,edit.type==='rename'?{name:value}:edit.type==='move'?{groupId:value||null}:{});
  });}
  async function finishDrag(target=null){
    pointerSession.current=null;dragSession.current=null;setDropTarget(null);settling.current=true;suppressClickUntil.current=Date.now()+200;
    await preview.current?.settle(target);
    setDragIds([]);settling.current=false;suppressClickUntil.current=Date.now()+200;
  }
  function pointerStart(event,id){
    suppressClickUntil.current=0;
    if(event.button!==0||busy||confirming||settling.current||trash||event.target.closest('input,label,.cm-select-box,.cm-more,.cm-menu'))return;
    const ids=(selected.includes(id)?selected:[id]).filter(value=>active.some(p=>p.id===value));
    if(!ids.length)return;
    const elements=[...event.currentTarget.closest('.cm-grid').querySelectorAll('[data-cm-card]')];
    const entries=ids.map(value=>{const element=elements.find(card=>card.dataset.cmCard===value),item=active.find(p=>p.id===value);if(!element||!item)return null;const rect=element.getBoundingClientRect();return {...item,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}};}).filter(Boolean);
    pointerSession.current={id:event.pointerId,x:event.clientX,y:event.clientY,ids,primaryId:id,entries};
    // Capture on the clicked button so an ordinary click still opens the canvas.
    const target=event.target.closest('button')||event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
  }
  function targetAt(event){
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-cm-drop]');
    return target?.dataset.cmDrop||null;
  }
  function pointerMove(event){
    const session=pointerSession.current;if(!session||session.id!==event.pointerId)return;
    if(!dragSession.current&&Math.hypot(event.clientX-session.x,event.clientY-session.y)<6)return;
    event.preventDefault();
    if(!dragSession.current){dragSession.current=session.ids;setDragIds(session.ids);setSelected(session.ids);setMenu(null);setFeedback('');preview.current?.start(session.entries,{x:session.x,y:session.y},session.primaryId,session.ids.length);}
    const sidebar=event.currentTarget.closest('.canvas-manager')?.querySelector('.cm-sidebar')?.getBoundingClientRect();
    const nearSidebar=sidebar&&event.clientX>=sidebar.left-24&&event.clientX<=sidebar.right+84&&event.clientY>=sidebar.top-24&&event.clientY<=sidebar.bottom+24;
    preview.current?.move({x:event.clientX,y:event.clientY},nearSidebar?sidebar:null);
    setDropTarget(targetAt(event));
  }
  function pointerEnd(event){
    const session=pointerSession.current;if(!session||session.id!==event.pointerId)return;
    const ids=dragSession.current,target=targetAt(event);
    pointerSession.current=null;
    if(!ids)return;
    if(!target||busy){finishDrag();return;}
    const targetElement=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-cm-drop]'),rect=targetElement?.getBoundingClientRect();
    const landing=rect?{left:rect.left,top:rect.top,width:rect.width,height:rect.height}:null;
    dragSession.current=null;setDropTarget(null);settling.current=true;suppressClickUntil.current=Date.now()+200;
    const groupId=target==='ungrouped'?null:target;
    if(groupId&&!groups.some(g=>g.id===groupId)){finishDrag();return;}
    const moving=ids.filter(id=>active.some(p=>p.id===id&&(p.groupId||null)!==groupId));
    if(!moving.length){setFeedback('所选画布已经在这个分组中');finishDrag();return;}
    const destination=groups.find(g=>g.id===groupId)?.name||'未分组';
    run(async()=>{try{await onMutate('move',moving,{groupId});await finishDrag(landing);setFeedback(`已将 ${moving.length} 个画布移到「${destination}」`);}catch(error){await finishDrag();throw error;}});
  }
  const toggle=id=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  return <div className="canvas-manager">
    <CanvasDragPreview ref={preview}/>
    <aside className="cm-sidebar" aria-label="画布分组" inert={confirming}>
      <div className="cm-sidebar-label">工作空间 <span>本地</span></div>
      <button className={tab==='all'?'active':''} onClick={()=>setTab('all')}><LayoutGrid size={17}/>全部画布 <small>{active.length}</small></button>
      <button data-cm-drop="ungrouped" className={(tab==='ungrouped'?'active ':'')+(dropTarget==='ungrouped'?'cm-drop-target':'')} onClick={()=>setTab('ungrouped')}><FolderOpen size={17}/>未分组 <small>{dropTarget==='ungrouped'?'松开放入':active.filter(p=>!p.groupId).length}</small></button>
      <div className="cm-sidebar-label cm-group-heading">我的分组 <button title="新建分组" aria-label="新建分组" disabled={busy} onClick={()=>begin('newGroup')}><Plus size={17}/></button></div>
      <div className="cm-groups">{groups.map(g=><button key={g.id} data-cm-drop={g.id} className={(tab===g.id?'active ':'')+(dropTarget===g.id?'cm-drop-target':'')} onClick={()=>setTab(g.id)} title={g.name}><Folder size={17}/><span>{g.name}</span><small>{dropTarget===g.id?'松开放入':active.filter(p=>p.groupId===g.id).length}</small></button>)}{!groups.length&&<p>按项目整理你的灵感</p>}</div>
      <button className={'cm-trash '+(trash?'active':'')} onClick={()=>setTab('trash')}><Trash2 size={17}/>回收站 <small>{items.filter(p=>p.deletedAt).length}</small></button>
    </aside>
    <main className="cm-main" inert={confirming}>
      <div className="cm-heading"><div><h3>{heading}<span>{visible.length}</span></h3><p>{trash?'回收站保留 30 天，到期清理画布与独占素材；服务关闭期间，下次启动补清。':'让每个灵感，都有自己的空间。'}</p></div>{group&&<div className="cm-group-actions"><button disabled={busy} onClick={()=>begin('renameGroup',[],group.name)}>重命名分组</button><button disabled={busy} aria-label="删除当前分组" onClick={()=>begin('deleteGroup')}><Trash2 size={16}/></button></div>}</div>
      <div className="cm-toolbar"><label className="cm-search"><Search size={17}/><TextInput as="input" aria-label="搜索画布名称" placeholder="搜索画布…" value={query} onChange={e=>{setQuery(e.target.value);setSelected([]);}}/></label><select aria-label="画布排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">最近更新</option><option value="name">名称排序</option></select>{!trash&&<><button className="cm-import" disabled={busy} onClick={onImport} title="导入画布"><FileJson size={17}/></button><button className="primary" disabled={busy} onClick={()=>run(()=>onNew(group?.id))}><Plus size={17}/>新建画布</button></>}</div>
      {error&&<div className="cm-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="关闭错误提示"><X size={14}/></button></div>}
      {edit&&!confirming&&<form className="cm-editor" onSubmit={submit}>
        <strong>{{newGroup:'新建分组',renameGroup:'重命名分组',deleteGroup:'删除分组',rename:'重命名画布',move:'移动到分组',delete:'移入回收站',restore:'恢复画布'}[edit.type]}</strong>
        {['newGroup','renameGroup','rename'].includes(edit.type)&&<TextInput as="input" aria-label="新名称" autoFocus maxLength={100} value={value} onChange={e=>setValue(e.target.value)} placeholder="输入名称"/>}
        {edit.type==='move'&&<select aria-label="目标分组" value={value} onChange={e=>setValue(e.target.value)}><option value="">未分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
        {edit.type==='deleteGroup'&&<p>仅删除分组，里面的画布会保留并移到「未分组」。</p>}
        <div><button type="button" disabled={busy} onClick={()=>setEdit(null)}>取消</button><button className="primary" disabled={busy||(['newGroup','renameGroup','rename'].includes(edit.type)&&!value.trim())} type="submit">{busy?'处理中…':'确认'}</button></div>
      </form>}
      <div className="cm-selection"><div className="cm-select-summary"><SelectionCheckbox label="全选画布" disabled={!selectable.length||busy||confirming} checked={!!selectable.length&&selectable.every(p=>selected.includes(p.id))} onChange={()=>setSelected(selectable.every(p=>selected.includes(p.id))?[]:selectable.map(p=>p.id))}/><span>{selected.length?`已选 ${selected.length} 个`:'全选画布'}</span></div>{selected.length>0&&<>{trash?<button disabled={busy||selected.some(id=>expired(items.find(item=>item.id===id)))} onClick={()=>run(()=>onMutate('restore',selected))}><Undo2 size={15}/>恢复</button>:<><button disabled={busy} onClick={()=>begin('move',selected)}><Folder size={15}/>移动到</button><button className="cm-bulk-delete" disabled={busy} aria-label={`删除所选 ${selected.length} 个画布`} onClick={()=>requestDelete()}><Trash2 size={16}/><span>删除（{selected.length}）</span></button></>}<button disabled={busy} onClick={()=>setSelected([])}>取消选择</button></>}</div>
      <div className="cm-drag-feedback" role="status" aria-live="polite">{dragIds.length?`正在移动 ${dragIds.length} 个画布 · 拖到左侧分组后松开`:feedback||(!trash?'拖动画布卡片到左侧分组，选中多个可一起移动':'')}</div>
      <div className="cm-grid" aria-busy={busy}>
        {visible.map(p=><article key={p.id} data-cm-card={p.id} onPointerDownCapture={e=>pointerStart(e,p.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={()=>finishDrag()} onLostPointerCapture={()=>{if(pointerSession.current)finishDrag();}} onDragStart={e=>e.preventDefault()} onClickCapture={e=>{if(dragSession.current||Date.now()<suppressClickUntil.current){e.preventDefault();e.stopPropagation();}}} className={'cm-card '+(!busy&&!trash?'cm-draggable ':'')+(selected.includes(p.id)?'is-selected ':'')+(dragIds.includes(p.id)?'cm-dragging':'')}>
          <div className="cm-cover"><button className="cm-open" disabled={busy||trash} aria-label={'打开画布 '+p.name} onClick={()=>onOpen(p.id)}>{p.cover?<img src={p.cover} alt="" loading="lazy" draggable={false}/>:<div className="cm-placeholder"><Workflow size={34}/><span>{p.count?'创作进行中':'从一个想法开始'}</span></div>}</button><SelectionCheckbox className="cm-checkbox" label={'选择画布 '+p.name} checked={selected.includes(p.id)} disabled={busy||confirming||(trash&&expired(p))} onChange={()=>toggle(p.id)}/>{p.id===currentId&&!trash&&<span className="cm-current"><Check size={11}/>当前</span>}<button className="cm-more" aria-label={'画布选项 '+p.name} aria-expanded={menu===p.id} disabled={busy} onClick={()=>setMenu(menu===p.id?null:p.id)}><MoreHorizontal size={19}/></button>
          {menu===p.id&&<div className="cm-menu" role="menu" aria-label={p.name+' 的操作'} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null);}}}>{trash?<button role="menuitem" disabled={busy||expired(p)} onClick={()=>run(()=>onMutate('restore',[p.id]))}><Undo2 size={15}/>恢复画布</button>:<><button role="menuitem" onClick={()=>onOpen(p.id)}><ArrowUpRight size={15}/>打开画布</button><button role="menuitem" onClick={()=>begin('rename',[p.id],p.name)}>重命名</button><button role="menuitem" onClick={()=>begin('move',[p.id],p.groupId||'')}><Folder size={15}/>移动到分组</button><button className="danger" role="menuitem" onClick={()=>requestDelete(p.id)}><Trash2 size={16}/><span>{selected.includes(p.id)&&selected.length>1?`删除所选 ${selected.length} 个画布`:'删除画布'}</span></button></>}</div>}</div>
          <div className="cm-card-info"><button disabled={busy||trash} title={p.name} onClick={()=>onOpen(p.id)}>{p.name}</button><small>{p.count} 个节点<span>·</span>{new Date(p.deletedAt||p.updatedAt).toLocaleDateString('zh-CN')}{p.groupId&&<em>{groups.find(g=>g.id===p.groupId)?.name}</em>}</small>{trash&&expiry(p)&&<div className={'cm-expiry '+(expired(p)?'expired':'')}><b>{expired(p)?'已到期，等待清理':`剩余 ${Math.ceil((expiry(p)-now)/86400000)} 天`}</b><span>{new Date(expiry(p)).toLocaleString('zh-CN')} 到期</span></div>}</div>
        </article>)}
      </div>
      {!visible.length&&<div className="cm-empty">{trash?<Trash2 size={34}/>:<FolderOpen size={34}/>}<b>{!loaded?'正在加载…':query?'没有找到匹配的画布':trash?'回收站是空的':'这里还没有画布'}</b><p>{query?'试试其他名称':trash?'删除的画布会出现在这里':'新建画布，或将已有画布移动到这个分组。'}</p></div>}
    </main>
    {confirming&&<div className="cm-delete-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEdit(null);}}>
      <form className="cm-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cm-delete-title" aria-describedby="cm-delete-description" onSubmit={submit} onKeyDown={confirmationKey}>
        <div className="cm-delete-icon"><Trash2 size={24}/></div>
        <h3 id="cm-delete-title">删除 {edit.ids.length} 个画布？</h3>
        <p id="cm-delete-description">所选画布将在回收站保留 30 天，期间可恢复。到期永久删除画布、历史快照及独占的本机图片、视频等素材；其他画布仍在引用的素材会保留。</p>
        <p className="cm-delete-export-note">导出的 JSON 不包含素材文件。素材清理后，旧 JSON 无法恢复这些图片或视频。</p>
        <ul>{edit.ids.map(id=><li key={id}>{items.find(item=>item.id===id)?.name||id}</li>)}</ul>
        {error&&<p className="cm-delete-error" role="alert">{error}</p>}
        <div className="cm-delete-actions"><button ref={cancelDelete} type="button" disabled={busy} onClick={()=>setEdit(null)}>取消</button><button type="submit" disabled={busy} className="cm-delete-confirm">{busy?'正在删除…':`移入回收站（${edit.ids.length}）`}</button></div>
      </form>
    </div>}
  </div>;
}
