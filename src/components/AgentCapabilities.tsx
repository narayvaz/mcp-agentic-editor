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
          <p className="text-sm liquid-muted">Understanding what your MCP Agent can and cannot do.</p>
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
                <span className="liquid-title font-semibold">Multimodal Analysis:</span> I can process images, audio, and video files that you upload to the chat.
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
                <span className="liquid-title font-semibold">Native Desktop App:</span> I have added Electron support. You can now build a real <code>.dmg</code> installer for your iMac. Check <code>TECH_DOCS.md</code> for the build commands.
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
                <span className="liquid-title font-semibold">NotebookLM:</span> NotebookLM does not have a public API yet. I cannot "log in" to your account, but you can upload the same research files here.
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
          <span className="liquid-title font-semibold">Pro Tip:</span> To give me context like NotebookLM, upload your research PDFs or text files using the paperclip icon in chat. I will keep that context during the conversation.
        </p>
      </div>
    </div>
  );
}
