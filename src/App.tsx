import React, {useEffect, useRef, useState} from 'react';
import {Bot, Menu} from 'lucide-react';
import Sidebar, {AREAS, areaForTab} from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ContentReviewer from './components/ContentReviewer';
import ToolGenerator from './components/ToolGenerator';
import Settings from './components/Settings';
import RulesManager from './components/RulesManager';
import Automations from './components/Automations';
import AgentChat from './components/AgentChat';
import AgentTasks from './components/AgentTasks';
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
  const [taskInstruction,setTaskInstruction] = useState('');
  const openTasks=(instruction='')=>{setTaskInstruction(instruction);setChatOpen(false);setActiveTab('agent-tasks');};
  const [chatOpen,setChatOpen] = useStored('azat.studio.assistant.v2',false);
  const {selection,selectStory}=useStudio();
  const assistantToggleRef=useRef<HTMLButtonElement>(null);
  const menuToggleRef=useRef<HTMLButtonElement>(null);
  const assistantRef=useRef<HTMLElement>(null);
  const [assistantOverlay,setAssistantOverlay]=useState(()=>window.matchMedia('(max-width: 1150px)').matches);
  const [navigationOverlay,setNavigationOverlay]=useState(()=>window.matchMedia('(max-width: 720px)').matches);
  const closeAssistant=()=>{setChatOpen(false);requestAnimationFrame(()=>assistantToggleRef.current?.focus());};
  const closeNavigation=()=>{setSidebarOpen(false);requestAnimationFrame(()=>menuToggleRef.current?.focus());};
  const openNavigation=()=>{setChatOpen(false);setSidebarOpen(true);};
  const toggleAssistant=()=>{if(chatOpen)closeAssistant();else{setSidebarOpen(false);setChatOpen(true);}};
  useEffect(()=>{const media=window.matchMedia('(max-width: 1150px)');const update=()=>setAssistantOverlay(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{const media=window.matchMedia('(max-width: 720px)');const update=()=>{setNavigationOverlay(media.matches);if(!media.matches)setSidebarOpen(false);};media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{if(!chatOpen||assistantRef.current?.contains(document.activeElement))return;const frame=requestAnimationFrame(()=>assistantRef.current?.querySelector<HTMLTextAreaElement>('#assistant-prompt')?.focus());return()=>cancelAnimationFrame(frame);},[chatOpen,assistantOverlay]);
  useEffect(()=>{if(!sidebarOpen||!navigationOverlay)return;const frame=requestAnimationFrame(()=>document.getElementById('studio-navigation')?.querySelector<HTMLElement>('button[aria-current],button')?.focus());return()=>cancelAnimationFrame(frame);},[sidebarOpen,navigationOverlay]);
  const [settingsVisited,setSettingsVisited]=useState(activeTab==='settings');
  useEffect(()=>{if(activeTab==='settings')setSettingsVisited(true);},[activeTab]);
  const area = areaForTab(activeTab);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();toggleAssistant();return;}
      if(event.key==='Escape'){if(sidebarOpen){event.preventDefault();closeNavigation();}else if(chatOpen){event.preventDefault();closeAssistant();}return;}
      const container=sidebarOpen&&navigationOverlay?document.getElementById('studio-navigation'):chatOpen&&assistantOverlay?assistantRef.current:null;
      if(event.key!=='Tab'||!container)return;
      const controls=Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(control=>control.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);if(!first)return;
      if(!container.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[chatOpen,sidebarOpen,assistantOverlay,navigationOverlay]);
  const current = AREAS.find(item=>item.id===area) || AREAS[0];
  const context = JSON.stringify({area:current.label,view:activeTab,permissions:'Advice and research only. Do not execute changes. Do not claim live state unless a tool receipt establishes it. Local evidence status is not publication or factual verification.'},null,2);
  const pages:Record<string,React.ReactNode>={dashboard:<Dashboard setActiveTab={setActiveTab}/>,'agent-tasks':<AgentTasks initialInstruction={taskInstruction} onInstructionConsumed={()=>setTaskInstruction('')}/>,content:<ContentReviewer/>,evidence:<EvidenceWorkspace/>,seo:<SEOAnalytics/>,wordpress:<WordPressHealthDashboard/>,tools:<ToolGenerator/>,automations:<Automations/>,desktop:<AzatHandbook/>,newsroom:<NewsroomPipeline/>,history:<NewsroomHistory/>,workshop:<CodeWorkshop/>,autoresearch:<AutoResearch/>,rules:<RulesManager/>};
  return <div className="studio-shell"><Sidebar activeTab={activeTab} setActiveTab={setActiveTab} isOpen={sidebarOpen} setIsOpen={(open)=>open?openNavigation():closeNavigation()}/><div className="studio-main"><header className="studio-topbar drag-region"><div className="topbar-title no-drag"><button ref={menuToggleRef} className="icon-btn mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="studio-navigation" onClick={openNavigation}><Menu size={19}/></button><span>Studio</span><span className="muted">/</span><strong>{current.label}</strong></div><button ref={assistantToggleRef} className={`btn no-drag ${chatOpen?'btn-selected':''}`} aria-expanded={chatOpen} aria-controls="studio-assistant" onClick={toggleAssistant}><Bot size={16}/> Assistant <kbd>⌘K</kbd></button></header><nav className="subnav" aria-label={`${current.label} views`}>{current.tabs.map(tab=><button key={tab.id} aria-current={activeTab===tab.id?'page':undefined} className={activeTab===tab.id?'active':''} onClick={()=>setActiveTab(tab.id)}>{tab.label}</button>)}</nav>{selection && <div className="story-context"><span className="context-label">Selected story</span><strong title={selection.title}>{selection.title}</strong><span className="badge">{selection.language || (selection.kind==='wordpress'?'WordPress':'Evidence')}</span><button className="text-btn" onClick={()=>setActiveTab(selection.kind==='wordpress'?'content':'evidence')}>Open</button><button className="icon-btn" onClick={()=>selectStory(null)} aria-label="Clear selected story">×</button></div>}<div className={`workspace-columns ${chatOpen?'with-assistant':''}`}><main id="main-content" className="workspace-content" inert={chatOpen&&assistantOverlay||sidebarOpen&&navigationOverlay}><div hidden={activeTab!=='settings'}>{(settingsVisited||activeTab==='settings')&&<Settings/>}</div>{activeTab!=='settings'&&<div key={activeTab}>{pages[activeTab] || pages.dashboard}</div>}</main>{chatOpen&&assistantOverlay&&<button className="assistant-backdrop" aria-label="Close assistant" tabIndex={-1} onClick={closeAssistant}/>}{chatOpen && <aside ref={assistantRef} id="studio-assistant" className="assistant-dock" role={assistantOverlay?'dialog':undefined} aria-modal={assistantOverlay?true:undefined} aria-label="Contextual assistant"><AgentChat context={context} onClose={closeAssistant} onOpenTasks={openTasks}/></aside>}</div></div></div>;
}
export default function App(){return <StudioProvider><Workspace/></StudioProvider>;}
