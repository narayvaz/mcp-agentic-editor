import React, { useState, useEffect } from 'react';
import { Play, Square, Settings, FileText, Mic, Video, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';

interface PipelineStatus {
  status: string;
  current_stage: string;
  script_text: string;
  logs: string[];
}

export default function NewsroomPipeline() {
  const [pipeline, setPipeline] = useState<PipelineStatus>({
    status: 'idle',
    current_stage: 'none',
    script_text: '',
    logs: []
  });
  const [script, setScript] = useState('');
  const [projectName, setProjectName] = useState('');
  const [selectedAnchor, setSelectedAnchor] = useState('anchor_animated_looped.mp4');
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("Summarize the latest news from this project for a 4-sentence broadcast script.");
  const [isGenerating, setIsGenerating] = useState(false);

  const API_URL = "http://127.0.0.1:5005";

  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API_URL}/api/status`)
        .then(res => res.json())
        .then(data => {
          setPipeline(data);
          if (data.script_text && !script) {
             setScript(data.script_text);
          }
        })
        .catch(err => console.error("Pipeline API Error:", err));
    }, 2000);
    return () => clearInterval(interval);
  }, [script]);

  const generateScript = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_URL}/api/notebooklm/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: customPrompt, notebook_id: selectedNotebookId })
      });
      const data = await res.json();
      if (data.text) setScript(data.text);
    } catch (e) {
      console.error(e);
    }
    setIsGenerating(false);
  };

  const saveScript = async () => {
    try {
      await fetch(`${API_URL}/api/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const startStage = async (stageName: string) => {
    await saveScript();
    try {
      await fetch(`${API_URL}/api/pipeline/start_stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageName, project_name: projectName, anchor: selectedAnchor })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const stopPipeline = async () => {
    try {
      await fetch(`${API_URL}/api/pipeline/stop`, { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold liquid-title">AI Newsroom Pipeline</h2>
          <p className="readable-copy mt-1">Control your local Mac-optimized Premium AI News Broadcast.</p>
        </div>
        <div className="flex gap-3 items-center">
          {pipeline.status === 'running' ? (
            <button onClick={stopPipeline} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all">
              <Square size={18} fill="currentColor" /> Stop
            </button>
          ) : (
            <div className="px-4 py-2 liquid-pill text-sky-700 rounded-xl font-bold flex items-center gap-2">
              <CheckCircle size={18} /> Ready
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* Pipeline Stages */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="liquid-surface-strong p-6 rounded-3xl border shadow-sm">
            <h3 className="font-bold text-lg liquid-title mb-4 flex items-center gap-2">
              <Settings size={20} className="text-sky-500" /> Pipeline Stages
            </h3>
            
            <div className="space-y-4">
              {/* Stage 1: Script from NotebookLM */}
              <div className="w-full flex flex-col p-4 liquid-surface border rounded-2xl hover:border-sky-300 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl liquid-pill text-sky-600 flex items-center justify-center">
                      <FileText size={20} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm">1. Script (NotebookLM)</p>
                      <p className="text-[10px] readable-copy">Query sources & generate script</p>
                    </div>
                  </div>
                  <button 
                    onClick={generateScript}
                    disabled={isGenerating || pipeline.status === 'running'}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-sky-500/30 hover:scale-110 transition-all disabled:opacity-40 disabled:hover:scale-100 shrink-0"
                    style={{ background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)' }}
                    title="Generate Script"
                  >
                    {isGenerating ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
                  </button>
                </div>
                
                <div className="space-y-2">
                  <input 
                    type="text"
                    placeholder="Generation Prompt (e.g. Focus on tech trends)..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded-lg bg-white/50 text-xs focus:outline-none focus:border-sky-300"
                  />
                  <input 
                    type="text"
                    placeholder="Paste NotebookLM URL or Notebook ID..."
                    value={selectedNotebookId}
                    onChange={(e) => {
                      let val = e.target.value;
                      if (val.includes('/notebook/')) {
                        val = val.split('/notebook/')[1].split('?')[0].split('/')[0];
                      }
                      setSelectedNotebookId(val);
                    }}
                    className="w-full px-3 py-1.5 border rounded-lg bg-white/50 text-xs focus:outline-none focus:border-sky-300"
                  />
                  <select 
                    value={selectedNotebookId}
                    onChange={(e) => setSelectedNotebookId(e.target.value)}
                    className="w-full px-2 py-1 border rounded-lg bg-white/50 text-[10px] focus:outline-none focus:border-sky-300"
                  >
                    <option value="" disabled>Quick select saved notebook...</option>
                    <option value="b8eb54eb-c05d-4117-8fbf-bcbbf3dadbd3">Armenia's AI Infrastructure</option>
                    <option value="e7cf718e-6b6d-491f-a3a5-e7f63fee11fb">Armenian Micro-Enterprise Tax</option>
                    <option value="8567da0a-f6d3-4a32-ab79-2da2155a4f0b">Brave Nazar: The Unlikely Hero</option>
                    <option value="818e166a-4bf9-4178-8673-1df391fe5f79">Architecture of a Rewired Mind</option>
                  </select>
                </div>
              </div>

              {/* Stage 2: Voice */}
              <button 
                onClick={() => startStage('voice')}
                disabled={pipeline.status === 'running'}
                className="w-full flex items-center justify-between p-4 liquid-surface border rounded-2xl hover:border-emerald-300 transition-all disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl liquid-pill text-emerald-600 flex items-center justify-center">
                    <Mic size={20} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm">2. Voice & Audio</p>
                    <p className="text-xs readable-copy">Gemini Puck Voice Synthesis</p>
                  </div>
                </div>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 shrink-0"
                  style={{ background: 'linear-gradient(135deg, #059669, #34d399)' }}
                >
                  <Play size={15} fill="currentColor" />
                </div>
              </button>

              {/* Stage 3: Animation (LivePortrait or EchoMimic) */}
              <div className="w-full flex flex-col p-4 liquid-surface border rounded-2xl hover:border-purple-300 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl liquid-pill text-purple-600 flex items-center justify-center">
                      <Video size={20} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm">3. Animation (Mimicry)</p>
                      <p className="text-[10px] readable-copy">LivePortrait or EchoMimic v2</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => startStage('liveportrait')}
                      disabled={pipeline.status === 'running'}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-purple-500/30 hover:scale-110 transition-all disabled:opacity-40 disabled:hover:scale-100 shrink-0"
                      style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)' }}
                      title="Run LivePortrait"
                    >
                      <Play size={15} fill="currentColor" />
                    </button>
                    <button 
                      onClick={() => startStage('echomimic')}
                      disabled={pipeline.status === 'running'}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 hover:scale-110 transition-all disabled:opacity-40 disabled:hover:scale-100 shrink-0"
                      style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}
                      title="Run EchoMimic v2"
                    >
                      <Play size={15} fill="currentColor" />
                    </button>
                  </div>
                </div>
                <select 
                  value={selectedAnchor}
                  onChange={(e) => setSelectedAnchor(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded-lg bg-white/50 text-xs focus:outline-none focus:border-purple-300"
                >
                  <option value="anchor_animated_looped.mp4">Anchor 1 (Looped)</option>
                  <option value="final_anchor_premium.mp4">Anchor 2 (Premium)</option>
                  <option value="d0.mp4">Anchor 3 (LivePortrait)</option>
                </select>
              </div>

              {/* Stage 4: Lipsync */}
              <button 
                onClick={() => startStage('lipsync')}
                disabled={pipeline.status === 'running'}
                className="w-full flex items-center justify-between p-4 liquid-surface border rounded-2xl hover:border-pink-300 transition-all disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl liquid-pill text-pink-600 flex items-center justify-center">
                    <Mic size={20} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm">4. Lip-Syncing</p>
                    <p className="text-xs readable-copy">MuseTalk Audio-to-Video</p>
                  </div>
                </div>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-pink-500/30 shrink-0"
                  style={{ background: 'linear-gradient(135deg, #db2777, #f472b6)' }}
                >
                  <Play size={15} fill="currentColor" />
                </div>
              </button>

              {/* Stage 5: Assembly */}
              <div className="w-full flex flex-col p-4 liquid-surface border rounded-2xl hover:border-amber-300 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl liquid-pill text-amber-600 flex items-center justify-center">
                      <Video size={20} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm">5. Premium Assembly</p>
                      <p className="text-[10px] readable-copy">Composite to Final MP4</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => startStage('assembly')}
                    disabled={pipeline.status === 'running'}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg shadow-amber-500/30 hover:scale-110 transition-all disabled:opacity-40 disabled:hover:scale-100 shrink-0"
                    style={{ background: 'linear-gradient(135deg, #d97706, #fbbf24)' }}
                    title="Start Assembly"
                  >
                    <Play size={15} fill="currentColor" />
                  </button>
                </div>
                <input 
                  type="text" 
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded-lg bg-white/50 text-xs focus:outline-none focus:border-amber-300"
                  placeholder="Output filename (e.g. armenia_ai_news)"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Script Editor & Logs */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">
          <div className="liquid-surface-strong p-6 rounded-3xl border shadow-sm flex flex-col flex-1 min-h-[250px]">
             <div className="flex justify-between items-center mb-4">
               <h3 className="font-bold text-lg liquid-title flex items-center gap-2">
                 <FileText size={20} className="text-sky-500" /> Script Editor
               </h3>
               <button onClick={saveScript} className="text-xs px-3 py-1 liquid-pill text-sky-700 rounded-lg hover:bg-sky-100 transition-colors">
                 Save Script
               </button>
             </div>
             <textarea 
               value={script}
               onChange={(e) => setScript(e.target.value)}
               placeholder="Enter or generate script here..."
               className="flex-1 w-full p-4 rounded-2xl border border-sky-100 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-200 resize-none font-medium text-sm readable-copy"
             />
          </div>

           <div className="liquid-surface-strong p-6 rounded-3xl border shadow-sm flex flex-col min-h-[200px]"
              style={{ maxHeight: '250px' }}>
             <h3 className="font-bold text-lg liquid-title mb-4 flex items-center gap-2">
               <AlertCircle size={20} className="text-sky-500" /> Terminal Output
             </h3>
             <div className="flex-1 bg-slate-900 rounded-2xl p-4 overflow-y-auto font-mono text-xs text-sky-300 shadow-inner">
                {pipeline.logs.length === 0 ? (
                  <p className="opacity-50">Waiting for pipeline to start...</p>
                ) : (
                  pipeline.logs.map((log, i) => (
                    <div key={i} className="mb-1 opacity-90">{log}</div>
                  ))
                )}
             </div>
           </div>

        </div>

      </div>
    </div>
  );
}
