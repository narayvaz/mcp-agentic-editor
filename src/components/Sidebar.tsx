import React from 'react';
import {BriefcaseBusiness, BookOpenCheck, Radio, BarChart3, Settings2, FlaskConical, X, ArrowUpRight} from 'lucide-react';
export const AREAS=[
{id:'work',label:'Work',icon:BriefcaseBusiness,tabs:[{id:'dashboard',label:'Overview'},{id:'content',label:'Article review'}]},
{id:'evidence',label:'Evidence',icon:BookOpenCheck,tabs:[{id:'evidence',label:'Story records'}]},
{id:'production',label:'Production',icon:Radio,tabs:[{id:'newsroom',label:'Runs & outputs'},{id:'automations',label:'Schedules'}]},
{id:'audience',label:'Audience',icon:BarChart3,tabs:[{id:'seo',label:'Search performance'}]},
{id:'system',label:'System',icon:Settings2,tabs:[{id:'wordpress',label:'Health'},{id:'settings',label:'Connections'},{id:'rules',label:'Editorial rules'},{id:'history',label:'Activity'},{id:'desktop',label:'Guide'}]},
{id:'lab',label:'Development lab',icon:FlaskConical,tabs:[{id:'tools',label:'Prompt recipes'},{id:'workshop',label:'Code workshop'},{id:'autoresearch',label:'Experiments'}]},
];
export function areaForTab(tab:string){return AREAS.find(area=>area.tabs.some(item=>item.id===tab))?.id||'work';}
interface Props{activeTab:string;setActiveTab:(tab:string)=>void;isOpen:boolean;setIsOpen:(open:boolean)=>void;}
export default function Sidebar({activeTab,setActiveTab,isOpen,setIsOpen}:Props){
 const current=areaForTab(activeTab); const open=(tab:string)=>{setActiveTab(tab);setIsOpen(false);};
 return <>{isOpen&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setIsOpen(false)}/>}<aside className={`studio-sidebar ${isOpen?'is-open':''}`}><a className="skip-link" href="#main-content">Skip to content</a><div className="studio-brand"><div className="brand-mark">Ա</div><div><strong>AZAT</strong><span>STUDIO</span></div><button className="icon-btn mobile-menu" aria-label="Close navigation" onClick={()=>setIsOpen(false)}><X size={18}/></button></div><p className="sidebar-label">YOUR NEWSROOM</p><nav aria-label="Main navigation">{AREAS.filter(area=>area.id!=='lab').map(area=><button key={area.id} className={`area-link ${current===area.id?'active':''}`} aria-current={current===area.id?'page':undefined} onClick={()=>open(area.tabs[0].id)}><area.icon size={19}/><span>{area.label}</span>{current===area.id&&<span className="active-dot"/>}</button>)}</nav><div className="sidebar-bottom"><button className={`area-link lab-link ${current==='lab'?'active':''}`} onClick={()=>open('tools')}><FlaskConical size={18}/><span>Development lab</span></button><div className="sidebar-note">Independent journalism.<br/>Evidence before output.</div><a href="https://azat.tv" target="_blank" rel="noopener noreferrer" className="site-link">azat.tv <ArrowUpRight size={13}/></a></div></aside></>;
}
