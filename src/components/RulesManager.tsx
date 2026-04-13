import React, { useState, useEffect } from 'react';
import { ScrollText, Save, CheckCircle2, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildJsonInit, fetchJson } from '../lib/api';

const DEFAULT_RULES = `# MCP News Website - Core Rules & Standards

## 1. Journalistic Integrity
- All headlines must be objective and factual. No clickbait.
- Sources must be cited if provided in the draft.
- Tone should be professional, neutral, and authoritative.

## 2. SEO Standards
- Primary keyword must appear in the first 100 words.
- Meta descriptions must be between 140-160 characters.
- Use H2 and H3 tags for readability.
- Images must have descriptive ALT text.

## 3. WordPress Configuration Rules
- LiteSpeed Cache: Object Cache must be enabled for performance.
- Query Monitor: No database queries should take longer than 0.5s.
- Plugins: Only essential plugins should be active.

## 4. Automation Rules
- Never publish a post automatically; always save as "Draft" or "Pending Review".
- Always run a "Health Check" before and after any configuration change.`;

export default function RulesManager() {
  const [rules, setRules] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');

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
          <p className="text-slate-900 dark:text-slate-50 text-sm">Define the standards the Agent uses to review content and manage WordPress.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setRules(DEFAULT_RULES)}
            className="flex items-center gap-2 px-4 py-2 text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
            <textarea 
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full h-[600px] p-8 font-mono text-sm text-slate-950 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none resize-none leading-relaxed"
              placeholder="# Define your rules here..."
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-2xl border border-blue-100 dark:border-blue-800">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles size={20} className="text-blue-600" />
              <h3 className="font-bold text-blue-950 dark:text-blue-50">How Rules Work</h3>
            </div>
            <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed mb-4">
              These rules are injected into the Agent's system instructions. When you ask the Agent to "Check this article" or "Fix WordPress," it will strictly follow these guidelines.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-xs text-slate-950 dark:text-white">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span><strong>Content Review</strong>: Agent flags tone or SEO issues based on Section 1 & 2.</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-slate-950 dark:text-white">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span><strong>WordPress Fixes</strong>: Agent only suggests changes that align with Section 3.</span>
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
