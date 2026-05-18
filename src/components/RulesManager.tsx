import React, { useState, useEffect, useRef } from 'react';
import { ScrollText, Save, CheckCircle2, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildJsonInit, fetchJson } from '../lib/api';

const DEFAULT_RULES = `# Platinum Premium Self-Development & System Automation Protocol

## 0. Self-Improvement & Self-Modification Authority
- You are a Platinum-Grade Autonomous Self-Developing AI Agent.
- You have full authority to execute user requests, write clean code, and modify application source files directly.
- Proactively identify and fix potential issues, optimize performance, and enhance UI/UX.

## 1. Professional Development & Visual Excellence
- Deliver state-of-the-art, premium designs with vibrant, harmonized colors, modern typography, glassmorphism, and smooth micro-animations.
- Avoid generic layouts; everything must feel elite and high-performance.

## 2. Advanced Newsroom & VPS Orchestration
- Streamline integrations with WordPress (hy/en), VPS automations, and deep research pipelines.
- Automate repetitive tasks and decode errors into actionable developer instructions.

## 3. Journalistic Integrity & SEO
- All headlines must be objective and factual. No clickbait.
- Primary keyword must appear in the first 100 words.
- Meta descriptions must be between 140-160 characters.
- Images must have descriptive ALT text and SEO-optimized captions.

## 4. WordPress & Automation Safety
- LiteSpeed Cache: Object Cache must be enabled for performance.
- Never publish a post automatically; always save as "Draft" or "Pending Review".
- Always run a "Health Check" before and after any configuration change.`;

export default function RulesManager() {
  const [rules, setRules] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Sync gutter scroll with textarea scroll
  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useEffect(() => {
    const loadRules = async () => {
      try {
        const payload = await fetchJson<{ rules: string }>('/api/rules');
        setRules(payload.rules || DEFAULT_RULES);
        setError('');
      } catch (loadError) {
        setRules(DEFAULT_RULES);
        setError(String(loadError));
      }
    };
    loadRules();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetchJson('/api/rules', buildJsonInit('PUT', { rules }));
      setIsSaving(false);
      setIsSaved(true);
      setError('');
      setTimeout(() => setIsSaved(false), 3000);
    } catch (saveError) {
      setIsSaving(false);
      setError(String(saveError));
    }
  };

  return (
    <div className="max-w-5xl space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-slate-950 dark:text-white">MCP Rules Engine</h2>
          <p className="text-slate-950 dark:text-white text-sm">Define the standards the Agent uses to review content and manage WordPress.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setRules(DEFAULT_RULES)}
            className="flex items-center gap-2 px-4 py-2 text-slate-950 dark:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw size={16} />
            Reset to Default
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={cn(
              "flex items-center gap-2 px-6 py-2 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-600/20",
              isSaved ? "bg-green-600 shadow-green-600/20" : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {isSaving ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : isSaved ? (
              <CheckCircle2 size={16} />
            ) : (
              <Save size={16} />
            )}
            {isSaving ? 'Saving...' : isSaved ? 'Rules Updated' : 'Save Rules'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-700 dark:text-red-400 text-sm p-4 rounded-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <ScrollText size={18} className="text-blue-600" />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Rules Definition (Markdown)</span>
            </div>
            {/* Exp #79: Line-number gutter + textarea in flex row */}
            <div className="flex overflow-hidden" style={{ height: '600px' }}>
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="select-none overflow-hidden shrink-0 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 py-8 px-3 text-right font-mono text-xs text-slate-400 leading-relaxed"
                style={{ minWidth: '3rem' }}
              >
                {rules.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea 
                ref={textareaRef}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                onScroll={syncScroll}
                className="flex-1 h-full p-8 font-mono text-sm text-slate-950 dark:text-white bg-white dark:bg-slate-900 focus:outline-none resize-none leading-relaxed"
                placeholder="# Define your rules here..."
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-2xl border border-blue-100 dark:border-blue-800">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles size={20} className="text-blue-600" />
              <h3 className="font-bold text-blue-950 dark:text-blue-50">How Rules Work</h3>
            </div>
            <p className="text-sm text-slate-950 dark:text-white leading-relaxed mb-4">
              These rules are injected into the Agent's system instructions. When you ask the Agent to "Check this article" or "Fix WordPress," it will strictly follow these guidelines.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-xs text-slate-950 dark:text-white">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span><strong>Content Review</strong>: Agent flags tone or SEO issues based on Section 3.</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-slate-950 dark:text-white">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span><strong>WordPress Fixes</strong>: Agent only suggests changes that align with Section 4.</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-slate-950 dark:text-white">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span><strong>Automations</strong>: Safety checks in Section 4 are enforced automatically.</span>
              </li>
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle size={20} className="text-orange-500" />
              <h3 className="font-bold text-slate-950 dark:text-white text-sm">Safety Notice</h3>
            </div>
            <p className="text-xs text-slate-950 dark:text-white leading-relaxed">
              Modifying these rules will immediately change the Agent's behavior. Be specific to ensure the Agent doesn't make unauthorized changes to your production site.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
