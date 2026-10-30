import React,{useState} from 'react';
import {Hand,X} from 'lucide-react';
import {permissions,permissionLabels} from '../shared/agent-actions.mjs';
export default function AgentAccess({value,onChange,disabled}){
 const [open,setOpen]=useState(false),count=Object.values(value).filter(Boolean).length;
 return <div className="agent-access"><button className={'icon-button '+(count?'granted':'')} aria-label="Agent 操作权限" title="Agent 操作权限" aria-expanded={open} onClick={()=>setOpen(!open)}><Hand size={20}/></button>{open&&<section className="agent-access-menu" aria-label="Agent 操作权限设置"><header><b>Agent 权限</b><button aria-label="关闭权限设置" onClick={()=>setOpen(false)}><X size={16}/></button></header><div className="agent-access-presets"><button disabled={disabled} onClick={()=>onChange(permissions())}>只读对话</button><button disabled={disabled} onClick={()=>onChange(permissions({move:true}))}>仅移动节点</button></div>{Object.entries(permissionLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={value[key]} disabled={disabled} onChange={e=>onChange({...value,[key]:e.target.checked})}/>{label}</label>)}<small>默认只读。生成会使用当前节点的模型配置，并可能消耗额度。权限只控制 Agent，不影响你的手动操作。</small></section>}</div>;
}
