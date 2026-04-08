import React from 'react';
import { Sparkles, ShieldAlert, Cpu, BookOpen } from 'lucide-react';

export default function AgentCapabilities() {
  return (
    <div className="liquid-surface-strong p-8 rounded-3xl border space-y-8">
      <div className="flex items-center gap-4">
        <div className="liquid-pill p-3 text-violet-600 rounded-xl">
          <Sparkles size={24} />
        </div>
        <div>
          <h3 className="font-bold text-xl liquid-title">Agent Intelligence & Capabilities</h3>
          <p className="text-sm liquid-muted">Understanding what your Azat Studio agent can and cannot do.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Can Do */}
        <div className="space-y-4">
          <h4 className="text-sm font-bold liquid-soft uppercase tracking-widest flex items-center gap-2">
            <Cpu size={16} />
            Core Capabilities
          </h4>
          <div className="space-y-3">
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-green-500"><Sparkles size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">Self-Improvement:</span> I (the agent) can modify and improve this app's code whenever you ask me to add features or fix bugs.
              </p>
            </div>
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-green-500"><Sparkles size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">Adaptive Research:</span> I can browse web sources, gather scholarly references, and combine them into factual answers.
              </p>
            </div>
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-green-500"><Sparkles size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">WordPress Integration:</span> I can connect to your WordPress site via plugin or server to manage content and health.
              </p>
            </div>
            <div className="flex gap-3 liquid-pill border rounded-xl p-3">
              <div className="mt-1 text-green-500"><Sparkles size={14} /></div>
              <p className="text-sm liquid-muted leading-relaxed">
                <span className="liquid-title font-semibold">Notebook Workspace Bridge:</span> I can search large local research folders to mimic deep notebook workflows for long-form analysis.
              </p>
            </div>
          </div>
        </div>

        {/* Cannot Do / Limits */}
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
