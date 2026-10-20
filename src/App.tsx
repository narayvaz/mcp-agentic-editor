import React, {useEffect, useState} from 'react';
import {Bot, Menu} from 'lucide-react';
import Sidebar, {AREAS, areaForTab} from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ContentReviewer from './components/ContentReviewer';
import ToolGenerator from './components/ToolGenerator';
import Settings from './components/Settings';
import RulesManager from './components/RulesManager';
import Automations from './components/Automations';
import AgentChat from './components/AgentChat';
import NewsroomPipeline from './components/NewsroomPipeline';
import NewsroomHistory from './components/NewsroomHistory';
import AzatHandbook from './components/AzatHandbook';
import CodeWorkshop from './components/CodeWorkshop';
import AutoResearch from './components/AutoResearch';
import WordPressHealthDashboard from './components/WordPressHealthDashboard';
import SEOAnalytics from './components/SEOAnalytics';
import EvidenceWorkspace from './components/EvidenceWorkspace';
import {StudioProvider, useStored, useStudio} from './lib/studio';

function Workspace() {
  const [activeTab,setActiveTab] = useStored('azat.studio.active-tab.v2','dashboard');
  const [sidebarOpen,setSidebarOpen] = useState(false);
  const [chatOpen,setChatOpen] = useStored('azat.studio.assistant.v2',false);
  const {selection,selectStory}=useStudio();
  const [settingsVisited,setSettingsVisited]=useState(activeTab==='settings');
  useEffect(()=>{if(activeTab==='settings')setSettingsVisited(true);},[activeTab]);
  const area = areaForTab(activeTab);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setChatOpen(v=>!v);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  const current = AREAS.find(item=>item.id===area) || AREAS[0];
  const context = JSON.stringify({area:current.label,view:activeTab,permissions:'Advice and research only. Do not execute changes. Do not claim live state unless a tool receipt establishes it. Local evidence status is not publication or factual verification.'},null,2);
  const pages:Record<string,React.ReactNode>={dashboard:<Dashboard setActiveTab={setActiveTab}/>,content:<ContentReviewer/>,evidence:<EvidenceWorkspace/>,seo:<SEOAnalytics/>,wordpress:<WordPressHealthDashboard/>,tools:<ToolGenerator/>,automations:<Automations/>,desktop:<AzatHandbook/>,newsroom:<NewsroomPipeline/>,history:<NewsroomHistory/>,workshop:<CodeWorkshop/>,autoresearch:<AutoResearch/>,rules:<RulesManager/>};
  return <div className="studio-shell"><Sidebar activeTab={activeTab} setActiveTab={setActiveTab} isOpen={sidebarOpen} setIsOpen={setSidebarOpen}/><div className="studio-main"><header className="studio-topbar drag-region"><div className="topbar-title no-drag"><button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={()=>setSidebarOpen(true)}><Menu size={19}/></button><span>Studio</span><span className="muted">/</span><strong>{current.label}</strong></div><button className={`btn no-drag ${chatOpen?'btn-selected':''}`} aria-expanded={chatOpen} aria-controls="studio-assistant" onClick={()=>setChatOpen(v=>!v)}><Bot size={16}/> Assistant <kbd>⌘K</kbd></button></header><nav className="subnav" aria-label={`${current.label} views`}>{current.tabs.map(tab=><button key={tab.id} aria-current={activeTab===tab.id?'page':undefined} className={activeTab===tab.id?'active':''} onClick={()=>setActiveTab(tab.id)}>{tab.label}</button>)}</nav>{selection && <div className="story-context"><span className="context-label">Selected story</span><strong title={selection.title}>{selection.title}</strong><span className="badge">{selection.language || (selection.kind==='wordpress'?'WordPress':'Evidence')}</span><button className="text-btn" onClick={()=>setActiveTab(selection.kind==='wordpress'?'content':'evidence')}>Open</button><button className="icon-btn" onClick={()=>selectStory(null)} aria-label="Clear selected story">×</button></div>}<div className={`workspace-columns ${chatOpen?'with-assistant':''}`}><main id="main-content" className="workspace-content"><div hidden={activeTab!=='settings'}>{(settingsVisited||activeTab==='settings')&&<Settings/>}</div>{activeTab!=='settings'&&<div key={activeTab}>{pages[activeTab] || pages.dashboard}</div>}</main>{chatOpen && <aside id="studio-assistant" className="assistant-dock" aria-label="Contextual assistant"><AgentChat context={context} onClose={()=>setChatOpen(false)}/></aside>}</div></div></div>;
}
export default function App(){return <StudioProvider><Workspace/></StudioProvider>;}
