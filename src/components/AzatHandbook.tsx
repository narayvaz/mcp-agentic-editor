import React, { useState } from 'react';
import {
  BookOpen, Video, Mic, FileText, Search, Globe, Zap, Settings,
  MessageSquare, Wrench, CheckCircle, AlertTriangle, ChevronDown, ChevronRight,
  Monitor, Brain, Layers, Sparkles, Shield, BarChart3, RefreshCw
} from 'lucide-react';

interface Section {
  id: string;
  icon: React.ElementType;
  title: string;
  color: string;
  content: React.ReactNode;
}

export default function AzatHandbook() {
  const [openSection, setOpenSection] = useState<string | null>('overview');

  const toggle = (id: string) => setOpenSection(prev => prev === id ? null : id);

  const sections: Section[] = [
    {
      id: 'overview',
      icon: Monitor,
      title: 'What is Azat Studio?',
      color: 'text-sky-600',
      content: (
        <div className="space-y-3">
          <p>Azat Studio is your all-in-one AI newsroom command center, built as a native macOS desktop app (Electron). It combines research, content creation, AI video production, and WordPress publishing into a single interface.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="liquid-pill p-3 rounded-xl border text-center">
              <Brain size={24} className="mx-auto mb-2 text-sky-600" />
              <p className="text-xs font-bold">AI Research</p>
              <p className="text-[10px] liquid-soft">Gemini + NotebookLM</p>
            </div>
            <div className="liquid-pill p-3 rounded-xl border text-center">
              <Video size={24} className="mx-auto mb-2 text-purple-600" />
              <p className="text-xs font-bold">Video Pipeline</p>
              <p className="text-[10px] liquid-soft">LivePortrait + MuseTalk</p>
            </div>
            <div className="liquid-pill p-3 rounded-xl border text-center">
              <Globe size={24} className="mx-auto mb-2 text-emerald-600" />
              <p className="text-xs font-bold">WordPress CMS</p>
              <p className="text-[10px] liquid-soft">Review, Edit & Publish</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'dashboard',
      icon: BarChart3,
      title: 'Dashboard',
      color: 'text-indigo-600',
      content: (
        <div className="space-y-3">
          <p>The Dashboard shows a live overview of your connected data sources:</p>
          <ul className="space-y-2 list-none">
            <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" /><span><strong>SEO Metrics:</strong> Total clicks, impressions, average position, and CTR from Google Search Console (configure your API key in Settings).</span></li>
            <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" /><span><strong>Traffic Trends:</strong> A 7-day area chart showing click patterns.</span></li>
            <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" /><span><strong>WordPress Health:</strong> Real-time issue feed from your production site (LiteSpeed Cache, Query Monitor, core health).</span></li>
            <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" /><span><strong>Agent Capabilities:</strong> Shows what your Azat AI agent can and cannot do, including security boundaries.</span></li>
          </ul>
          <div className="liquid-pill p-3 rounded-lg border text-xs">
            <strong>Tip:</strong> If metrics show "0" or "...", go to <strong>Settings</strong> and add your WordPress site URL + API credentials.
          </div>
        </div>
      ),
    },
    {
      id: 'ask-studio',
      icon: MessageSquare,
      title: 'Ask Studio (AI Chat)',
      color: 'text-sky-600',
      content: (
        <div className="space-y-3">
          <p>Click the <strong>"Ask Studio"</strong> button in the top-right header to open the AI chat panel. It floats over your current view.</p>
          <h4 className="font-bold text-sm mt-2">Chat Modes</h4>
          <div className="space-y-2">
            <div className="flex gap-2 items-start"><span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold shrink-0">Web</span><span className="text-sm">Search the web for real-time info and include results in the conversation.</span></div>
            <div className="flex gap-2 items-start"><span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold shrink-0">Scholar</span><span className="text-sm">Search academic and scholarly sources for research-backed answers.</span></div>
            <div className="flex gap-2 items-start"><span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold shrink-0">Notebook</span><span className="text-sm">Query your connected NotebookLM notebooks directly from chat.</span></div>
            <div className="flex gap-2 items-start"><span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold shrink-0">Article Mode</span><span className="text-sm">Generate a long-form article with structured headings and WordPress-ready formatting.</span></div>
            <div className="flex gap-2 items-start"><span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold shrink-0">Self-Modify</span><span className="text-sm">Ask the AI to edit its own source code. Specify a target file or let it auto-discover. You approve changes with a code.</span></div>
          </div>
          <h4 className="font-bold text-sm mt-2">Features</h4>
          <ul className="space-y-1 text-sm">
            <li>• <strong>Multiple Threads:</strong> Create, archive, and delete chat threads using the controls at the top.</li>
            <li>• <strong>Edit & Resend:</strong> Click the pencil icon on any sent message to edit and automatically re-send it.</li>
            <li>• <strong>Stop Button:</strong> Click the red square to abort a running AI response at any time.</li>
            <li>• <strong>File Attachments:</strong> Attach images, PDFs, or videos to provide context.</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'content-reviewer',
      icon: FileText,
      title: 'Content Reviewer',
      color: 'text-blue-600',
      content: (
        <div className="space-y-3">
          <p>Review and edit your WordPress articles with AI assistance:</p>
          <ol className="space-y-2 list-decimal pl-5 text-sm">
            <li><strong>Select a Site</strong> — Choose your WordPress site from the dropdown (configure in Settings first).</li>
            <li><strong>Pick an Article</strong> — Select from the loaded post list, or paste raw text manually.</li>
            <li><strong>Edit Content</strong> — The left panel is a live editor. Make changes directly.</li>
            <li><strong>Run AI Review</strong> — Click the blue button. The AI analyzes your content against your MCP rules for style, SEO, readability, and accuracy.</li>
            <li><strong>Update WordPress</strong> — Click the green button to push your edited content back to the live site via the REST API.</li>
          </ol>
          <div className="liquid-pill p-3 rounded-lg border text-xs">
            <strong>Note:</strong> Unicode characters (apostrophes, quotes) are automatically decoded. If you see raw HTML entities, refresh the article.
          </div>
        </div>
      ),
    },
    {
      id: 'newsroom',
      icon: Video,
      title: 'Newsroom Pipeline (Triple-Stack)',
      color: 'text-purple-600',
      content: (
        <div className="space-y-3">
          <p>The flagship feature — generates premium AI news broadcasts using three local models:</p>
          <div className="space-y-3">
            <div className="liquid-surface p-3 rounded-xl border">
              <h4 className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">1</span> Script Generation</h4>
              <p className="text-sm mt-1">Queries your NotebookLM notebook to produce a factual broadcast script. Paste a Notebook URL or select from saved notebooks. Customize the prompt to focus on specific topics.</p>
            </div>
            <div className="liquid-surface p-3 rounded-xl border">
              <h4 className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">2</span> Voice Synthesis</h4>
              <p className="text-sm mt-1">Uses <strong>Gemini 3.1 TTS</strong> with the "Puck" voice to generate a natural, deep news anchor voiceover from the script.</p>
            </div>
            <div className="liquid-surface p-3 rounded-xl border">
              <h4 className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">3</span> Animation + Lip Sync</h4>
              <p className="text-sm mt-1"><strong>LivePortrait</strong> animates the static anchor image with natural head movements, blinks, and expressions using a driver video. <strong>MuseTalk</strong> then fuses the audio to the anchor's lips.</p>
            </div>
            <div className="liquid-surface p-3 rounded-xl border">
              <h4 className="font-bold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">4</span> Final Assembly</h4>
              <p className="text-sm mt-1">Composites the animated anchor over a studio background with lower-thirds, intro/outro, and exports a broadcast-ready MP4.</p>
            </div>
          </div>
          <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-xs text-amber-800">
            <AlertTriangle size={14} className="inline mr-1" />
            <strong>Important:</strong> All video rendering runs locally on your iMac's Apple Silicon (Metal/MPS). Keep the machine awake during processing. The local Flask API server must be running (<code>python pipeline_api.py</code>).
          </div>
        </div>
      ),
    },
    {
      id: 'seo-analytics',
      icon: Search,
      title: 'SEO & Analytics',
      color: 'text-amber-600',
      content: (
        <div className="space-y-3">
          <p>View detailed search performance data from Google Search Console and Analytics.</p>
          <p className="text-sm"><strong>Setup required:</strong> Go to <strong>Settings → WordPress Sites</strong> and add your Google Search Console API credentials or connect your VPS endpoint that serves the analytics data.</p>
          <p className="text-sm">Once connected, this module shows: top queries, page performance, indexing status, and keyword rankings over time.</p>
        </div>
      ),
    },
    {
      id: 'wp-health',
      icon: Shield,
      title: 'WordPress Health',
      color: 'text-emerald-600',
      content: (
        <div className="space-y-3">
          <p>Monitor your WordPress site's health in real-time:</p>
          <ul className="space-y-1 text-sm">
            <li>• <strong>LiteSpeed Cache status</strong> — cache hit rates, purge logs</li>
            <li>• <strong>Query Monitor</strong> — slow queries, duplicate queries, PHP errors</li>
            <li>• <strong>Core Health</strong> — WordPress site-health checks (updates, SSL, REST API, cron)</li>
            <li>• <strong>Plugin conflicts</strong> — detected incompatibilities</li>
          </ul>
          <p className="text-sm"><strong>Setup:</strong> Configure your site's base URL and REST API credentials in Settings. The health endpoint must be exposed on your VPS.</p>
        </div>
      ),
    },
    {
      id: 'automations',
      icon: Zap,
      title: 'Automation Hub',
      color: 'text-orange-600',
      content: (
        <div className="space-y-3">
          <p>Manage and trigger automated publishing workflows:</p>
          <ul className="space-y-1 text-sm">
            <li>• <strong>Social Media Syndication:</strong> Auto-post to X, Instagram, LinkedIn when a WordPress article is published.</li>
            <li>• <strong>Scheduled Publishing:</strong> Queue articles for future publication.</li>
            <li>• <strong>Webhook Triggers:</strong> Connect external services (Make.com, Zapier) to trigger pipelines.</li>
          </ul>
          <p className="text-sm"><strong>Setup:</strong> Requires your VPS automation endpoint configured in Settings. The module communicates with your server-side automation scripts.</p>
        </div>
      ),
    },
    {
      id: 'settings-guide',
      icon: Settings,
      title: 'Settings & Configuration',
      color: 'text-gray-600',
      content: (
        <div className="space-y-3">
          <p>The Settings page is where you configure all connections:</p>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2 items-start"><span className="font-bold text-sky-700 shrink-0">WordPress Sites →</span><span>Add your site URL, username, and application password. This powers the Content Reviewer, Health Monitor, and Dashboard.</span></div>
            <div className="flex gap-2 items-start"><span className="font-bold text-sky-700 shrink-0">API Keys →</span><span>Your Google AI Studio API key for Gemini. Located in the <code>.env</code> file at the project root.</span></div>
            <div className="flex gap-2 items-start"><span className="font-bold text-sky-700 shrink-0">VPS Endpoint →</span><span>Your production server URL for health monitoring, SEO data, and automation triggers.</span></div>
            <div className="flex gap-2 items-start"><span className="font-bold text-sky-700 shrink-0">MCP Control →</span><span>Custom rules that govern how the AI reviews content. Edit them under the MCP Control tab.</span></div>
          </div>
        </div>
      ),
    },
    {
      id: 'tips',
      icon: Sparkles,
      title: 'Tips & Best Practices',
      color: 'text-teal-600',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="liquid-pill p-3 rounded-xl border">
              <h4 className="font-bold text-xs mb-1">🎬 Video Generation</h4>
              <p className="text-[11px]">Keep your iMac awake and plugged in. Close heavy apps to free GPU memory for LivePortrait/MuseTalk.</p>
            </div>
            <div className="liquid-pill p-3 rounded-xl border">
              <h4 className="font-bold text-xs mb-1">📝 Content Quality</h4>
              <p className="text-[11px]">Always run AI Review before publishing. The agent checks against your MCP rules for consistency.</p>
            </div>
            <div className="liquid-pill p-3 rounded-xl border">
              <h4 className="font-bold text-xs mb-1">🔄 Rebuilding the App</h4>
              <p className="text-[11px]">After code changes: <code>cd ~/Downloads/mcp-agentic-editor && npm run electron:build</code>. Then replace the app in /Applications.</p>
            </div>
            <div className="liquid-pill p-3 rounded-xl border">
              <h4 className="font-bold text-xs mb-1">🛡️ Self-Modify Mode</h4>
              <p className="text-[11px]">The AI can edit its own code! Enable Self-Modify in chat, describe the change, and approve with the generated code.</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto space-y-4">
      {/* Header */}
      <div className="liquid-surface-strong p-6 rounded-3xl border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl liquid-pill flex items-center justify-center text-sky-600">
            <BookOpen size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-bold liquid-title">Azat Studio Handbook</h2>
            <p className="text-sm readable-copy">Complete guide to every feature in your AI newsroom. Click any section below to expand.</p>
          </div>
        </div>
      </div>

      {/* Accordion Sections */}
      <div className="space-y-2">
        {sections.map((section) => {
          const isOpen = openSection === section.id;
          const Icon = section.icon;
          return (
            <div key={section.id} className="liquid-surface-strong rounded-2xl border overflow-hidden transition-all">
              <button
                onClick={() => toggle(section.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/30 transition-colors"
              >
                <div className={`w-9 h-9 rounded-xl liquid-pill flex items-center justify-center ${section.color} shrink-0`}>
                  <Icon size={18} />
                </div>
                <span className="flex-1 font-bold text-sm liquid-title">{section.title}</span>
                {isOpen ? <ChevronDown size={16} className="liquid-soft" /> : <ChevronRight size={16} className="liquid-soft" />}
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 text-sm readable-copy leading-relaxed border-t border-white/30">
                  {section.content}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="liquid-surface p-4 rounded-2xl border text-center">
        <p className="text-xs liquid-soft">
          Azat Studio v0.1 · Built with Electron + React + Vite · Running on your iMac locally
        </p>
      </div>
    </div>
  );
}
