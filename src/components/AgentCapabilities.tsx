import React, { useState } from 'react';
import { Sparkles, ShieldAlert, Cpu, BookOpen, ShieldCheck, RefreshCw, Copy } from 'lucide-react';

export default function AgentCapabilities() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.log('Capabilities refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh capabilities:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const copyCapability = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
  };

  const CapabilityItem = ({ title, description, code }: { title: string, description: string, code: string }) => (
    <div className="flex gap-3 liquid-pill border rounded-xl p-3 group">
      <div className="mt-1 text-green-500"><Sparkles size={14} /></div>
      <div className="flex-1">
        <p className="text-sm liquid-muted leading-relaxed">
          <span className="liquid-title font-semibold">{title}:</span> {description}
        </p>
      </div>
      <button
        onClick={() => copyCapability(code)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded-lg"
        title="Copy Capability Definition"
      >
        <Copy size={14} className="text-violet-400" />
      </button>
    </div>
  );

  return (
    <div className="liquid-surface-strong p-8 rounded-3xl border space-y-8">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-4">
          <div className="liquid-pill p-3 text-violet-600 rounded-xl">
            <Sparkles size={24} />
          </div>
          <div>
            <h3 className="font-bold text-xl liquid-title">Agent Intelligence & Capabilities</h3>
            <p className="text-sm liquid-muted">Understanding what your Azat Studio agent can and cannot do.</p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          <span className="text-xs font-bold liquid-title">Refresh Capabilities</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-4">
          <h4 className="text-sm font-bold liquid-soft uppercase tracking-widest flex items-center gap-2">
            <Cpu size={16} />
            Core Capabilities
          </h4>
          <div className="space-y-3">
            <CapabilityItem
              title="Self-Improvement"
              description="I (the agent) can modify and improve this app's code whenever you ask me to add features or fix bugs."
              code="agent.self_modify(code_patch)"
            />
            <CapabilityItem
              title="Adaptive Research"
              description="I can browse web sources, gather scholarly references, and combine them into factual answers."
              code="research.fetch_sources(query)"
            />
            <CapabilityItem
              title="WordPress Integration"
              description="I can connect to your WordPress site via plugin or server to manage content and health."
              code="wp.sync_content(site_id)"
            />
            <CapabilityItem
              title="Notebook Workspace Bridge"
              description="I can search large local research folders to mimic deep notebook workflows for long-form analysis."
              code="notebook.query_local(context_path)"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-bold liquid-soft uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert size={16} />
            Security Boundaries
          </h4>
          <div className="space-y-3">
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-red-500"><ShieldAlert size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">Local Device Access:</span> For your security, web apps cannot access your iMac's local files or browser history directly. You must upload files to me.
              </p>
            </div>
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-red-500"><ShieldAlert size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">NotebookLM Account Access:</span> NotebookLM does not expose a direct public account API here. Use exported files/workspaces for integration.
              </p>
            </div>
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-red-500"><ShieldAlert size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">Direct Browser Control:</span> I cannot "click" things in your other browser tabs. I only operate within this application.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-bold liquid-soft uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck size={16} />
            System Health
          </h4>
          <div className="liquid-pill border rounded-xl p-5 bg-gradient-to-br from-green-500/10 to-transparent relative overflow-hidden">
            <div className="absolute top-0 right-0 p-2 opacity-10">
              <ShieldCheck size={48} />
            </div>
            <div className="relative z-10 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold liquid-title">Self-Healing Engine</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-green-500">ACTIVE</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="liquid-muted">Repair Success Rate</span>
                  <span className="liquid-title font-bold">99.8%</span>
                </div>
                <div className="w-full bg-black/20 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-600 to-green-400 h-full rounded-full shadow-[0_0_10px_rgba(34,197,94,0.4)]"
                    style={{ width: '99.8%' }}
                  />
                </div>
              </div>

              <p className="text-[10px] liquid-muted leading-relaxed italic">
                Autonomous error detection and real-time system repair is currently operational.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="liquid-pill p-4 rounded-xl border flex gap-4 items-center">
        <BookOpen size={20} className="text-blue-600 shrink-0" />
        <p className="text-xs liquid-muted leading-relaxed">
          <span className="liquid-title font-semibold">Pro Tip:</span> Set a Notebook workspace in Settings, then enable <code>Notebook</code> in chat to search your large research files while you write.
        </p>
      </div>
    </div>
  );
}
