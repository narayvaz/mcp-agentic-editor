import React, { useEffect, useState } from 'react';
import {
  Globe,
  Search,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Save,
  Plus,
  Trash2,
  Server,
  TestTube2,
  BookOpen,
  Cpu,
  FolderOpen,
  Eye,
  EyeOff,
  Wrench,
  Download,
  RefreshCw,
  Rocket,
} from 'lucide-react';
import { AppConfig, WordPressSiteConfig } from '../types/config';
import { DesktopUpdaterState } from '../types/desktop-updater';
import { buildJsonInit, fetchJson } from '../lib/api';

const emptySite = (): WordPressSiteConfig => ({
  id: `site-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: 'New Site',
  baseUrl: '',
  username: '',
  appPassword: '',
});

interface ModelOption {
  id: string;
  label: string;
  releaseDate?: string;
  note?: string;
}

interface SelfModProposalResponse {
  proposalId: string;
  targetFile: string;
  summary: string;
  diffPreview: string;
  approvalCode: string;
  expiresAt: string;
  modelUsed?: string;
  warning?: string;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [selfModTargetFile, setSelfModTargetFile] = useState('');
  const [selfModInstruction, setSelfModInstruction] = useState('');
  const [selfModApprovalInput, setSelfModApprovalInput] = useState('');
  const [selfModProposal, setSelfModProposal] = useState<SelfModProposalResponse | null>(null);
  const [isSelfModBusy, setIsSelfModBusy] = useState(false);
  const [updaterState, setUpdaterState] = useState<DesktopUpdaterState | null>(null);
  const [updaterBusyAction, setUpdaterBusyAction] = useState<'check' | 'download' | 'install' | null>(null);
  const [updaterAvailable, setUpdaterAvailable] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const nextConfig = await fetchJson<AppConfig>('/api/settings');
        setConfig(nextConfig);
        try {
          const modelPayload = await fetchJson<{ models: ModelOption[] }>('/api/models');
          setModelOptions(modelPayload.models || []);
        } catch {
          setModelOptions([
            { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B IT' },
            { id: 'gemma-4-31b-it', label: 'Gemma 4 31B IT' },
            { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
          ]);
        }
        setError('');
      } catch (loadError) {
        setError(String(loadError));
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!window.desktopUpdater) return;
    setUpdaterAvailable(true);

    let unsubscribe: (() => void) | undefined;

    window.desktopUpdater
      .getState()
      .then((state) => setUpdaterState(state))
      .catch((stateError) => setError(String(stateError)));

    unsubscribe = window.desktopUpdater.onState((state) => setUpdaterState(state));

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const updateSite = (siteId: string, updater: (site: WordPressSiteConfig) => WordPressSiteConfig) => {
    if (!config) return;
    const updatedSites = config.wordpressSites.map((site) => (site.id === siteId ? updater(site) : site));
    setConfig({ ...config, wordpressSites: updatedSites });
  };

  const toggleSecret = (fieldKey: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
  };

  const runUpdaterAction = async (action: 'check' | 'download' | 'install') => {
    if (!window.desktopUpdater) {
      setError('Updater is available only in packaged desktop builds (.dmg install).');
      return;
    }

    setUpdaterBusyAction(action);
    try {
      const result = await window.desktopUpdater[action]();
      setUpdaterState(result.state);
      if (!result.ok && result.message) {
        setError(result.message);
      } else {
        setError('');
        if (result.message) setMessage(result.message);
      }
    } catch (updaterError) {
      setError(String(updaterError));
    } finally {
      setUpdaterBusyAction(null);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      const saved = await fetchJson<AppConfig>('/api/settings', buildJsonInit('PUT', config));
      setConfig(saved);
      setIsSaved(true);
      setMessage('Settings saved.');
      setError('');
      setTimeout(() => setIsSaved(false), 2500);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async (type: 'wordpress' | 'vps' | 'google' | 'hostinger' | 'ai', siteId?: string) => {
    try {
      const response = await fetchJson<{ ok: boolean; message: string }>(
        '/api/connection/test',
        buildJsonInit('POST', { type, siteId }),
      );
      setMessage(response.message);
      setError('');
    } catch (testError) {
      setError(String(testError));
    }
  };

  const proposeSelfModification = async () => {
    if (!config) return;
    setIsSelfModBusy(true);
    try {
      const payload = await fetchJson<SelfModProposalResponse>(
        '/api/self-mod/propose',
        buildJsonInit('POST', {
          workspacePath: config.selfModification.workspacePath,
          targetFile: selfModTargetFile,
          instruction: selfModInstruction,
        }),
      );
      setSelfModProposal(payload);
      setSelfModApprovalInput('');
      setMessage(`Proposal ready for ${payload.targetFile}. Enter approval code to apply.`);
      setError('');
    } catch (proposalError) {
      setError(String(proposalError));
    } finally {
      setIsSelfModBusy(false);
    }
  };

  const applySelfModification = async () => {
    if (!selfModProposal) return;
    setIsSelfModBusy(true);
    try {
      const payload = await fetchJson<{ ok: boolean; message: string; backupPath: string }>(
        '/api/self-mod/apply',
        buildJsonInit('POST', {
          proposalId: selfModProposal.proposalId,
          approvalCode: selfModApprovalInput.trim(),
        }),
      );
      setMessage(payload.message);
      setError('');
      setSelfModProposal(null);
      setSelfModApprovalInput('');
      setSelfModInstruction('');
    } catch (applyError) {
      setError(String(applyError));
    } finally {
      setIsSelfModBusy(false);
    }
  };

  const updaterStatus = updaterState?.status ?? 'idle';
  const updaterBadgeClass =
    updaterStatus === 'error'
      ? 'border-rose-300/80 text-rose-600 bg-rose-50/80'
      : updaterStatus === 'downloaded'
        ? 'border-emerald-300/80 text-emerald-600 bg-emerald-50/80'
        : updaterStatus === 'downloading' || updaterStatus === 'checking'
          ? 'border-sky-300/80 text-sky-600 bg-sky-50/80'
          : updaterStatus === 'available'
            ? 'border-amber-300/80 text-amber-600 bg-amber-50/80'
            : 'border-white/30 liquid-title bg-white/10';

  if (!config) {
    return <div className="text-sm liquid-muted">Loading settings...</div>;
  }

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h2 className="text-2xl font-serif font-bold liquid-title">Settings & Integrations</h2>
        <p className="liquid-muted text-sm">Connect real data sources for dashboard, automations, and article review.</p>
      </header>

      {message && (
        <div className="liquid-note-success text-sm p-4 rounded-xl">{message}</div>
      )}
      {error && (
        <div className="liquid-note-error text-sm p-4 rounded-xl">{error}</div>
      )}

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 liquid-pill text-emerald-600 rounded-lg">
              <Globe size={20} />
            </div>
            <div>
              <h3 className="font-bold liquid-title">WordPress Sites</h3>
              <p className="text-xs liquid-muted">Add one or many websites. Content Reviewer and Dashboard use this.</p>
            </div>
          </div>
          <button
            onClick={() => setConfig({ ...config, wordpressSites: [...config.wordpressSites, emptySite()] })}
            className="flex items-center gap-2 px-3 py-2 liquid-accent text-white rounded-lg text-xs font-bold"
          >
            <Plus size={14} />
            Add Site
          </button>
        </div>

        <div className="space-y-4">
          {!config.wordpressSites.length && (
            <div className="text-sm liquid-muted liquid-pill border rounded-xl p-4">
              No sites configured yet.
            </div>
          )}

          {config.wordpressSites.map((site) => (
            <div key={site.id} className="liquid-surface border rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <input
                  value={site.name}
                  onChange={(e) => updateSite(site.id, (prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Site name"
                  className="px-3 py-2 liquid-input rounded-lg text-sm"
                />
                <input
                  value={site.baseUrl}
                  onChange={(e) => updateSite(site.id, (prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://example.com"
                  className="px-3 py-2 liquid-input rounded-lg text-sm"
                />
                <div className="relative">
                  <input
                    value={site.username}
                    onChange={(e) => updateSite(site.id, (prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="Application Username"
                    type={visibleSecrets[`wp-username-${site.id}`] ? 'text' : 'password'}
                    className="w-full px-3 pr-10 py-2 liquid-input rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => toggleSecret(`wp-username-${site.id}`)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 liquid-soft hover:liquid-title rounded"
                    aria-label={visibleSecrets[`wp-username-${site.id}`] ? 'Hide username' : 'Show username'}
                  >
                    {visibleSecrets[`wp-username-${site.id}`] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="relative">
                  <input
                    value={site.appPassword}
                    onChange={(e) => updateSite(site.id, (prev) => ({ ...prev, appPassword: e.target.value }))}
                    placeholder="Application Password"
                    type={visibleSecrets[`wp-password-${site.id}`] ? 'text' : 'password'}
                    className="w-full pl-10 pr-10 px-3 py-2 liquid-input rounded-lg text-sm"
                  />
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 liquid-soft" />
                  <button
                    type="button"
                    onClick={() => toggleSecret(`wp-password-${site.id}`)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 liquid-soft hover:liquid-title rounded"
                    aria-label={visibleSecrets[`wp-password-${site.id}`] ? 'Hide app password' : 'Show app password'}
                  >
                    {visibleSecrets[`wp-password-${site.id}`] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfig({ ...config, activeSiteId: site.id })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    config.activeSiteId === site.id ? 'liquid-accent text-white' : 'liquid-pill border liquid-title'
                  }`}
                >
                  {config.activeSiteId === site.id ? 'Active Site' : 'Set Active'}
                </button>
                <button
                  onClick={() => testConnection('wordpress', site.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold liquid-pill border liquid-title"
                >
                  <TestTube2 size={12} />
                  Test
                </button>
                <button
                  onClick={() =>
                    setConfig({
                      ...config,
                      wordpressSites: config.wordpressSites.filter((entry) => entry.id !== site.id),
                      activeSiteId: config.activeSiteId === site.id ? null : config.activeSiteId,
                    })
                  }
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold liquid-pill border border-rose-300 text-rose-700"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-violet-600 rounded-lg">
            <Server size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">VPS Bridge</h3>
            <p className="text-xs liquid-muted">Use existing endpoints on your VPS for automations and real SEO/status stats.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={config.vps.baseUrl}
            onChange={(e) => setConfig({ ...config, vps: { ...config.vps, baseUrl: e.target.value } })}
            placeholder="https://your-vps-domain.com"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <div className="relative">
            <input
              value={config.vps.apiToken}
              onChange={(e) => setConfig({ ...config, vps: { ...config.vps, apiToken: e.target.value } })}
              placeholder="Bearer token (optional)"
              type={visibleSecrets.vpsApiToken ? 'text' : 'password'}
              className="w-full px-3 pr-10 py-2 liquid-input rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => toggleSecret('vpsApiToken')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 liquid-soft hover:liquid-title rounded"
              aria-label={visibleSecrets.vpsApiToken ? 'Hide VPS API token' : 'Show VPS API token'}
            >
              {visibleSecrets.vpsApiToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <input
            value={config.vps.automationsPath}
            onChange={(e) => setConfig({ ...config, vps: { ...config.vps, automationsPath: e.target.value } })}
            placeholder="/api/automations"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <input
            value={config.vps.seoStatsPath}
            onChange={(e) => setConfig({ ...config, vps: { ...config.vps, seoStatsPath: e.target.value } })}
            placeholder="/api/seo-stats"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <input
            value={config.vps.wpStatusPath}
            onChange={(e) => setConfig({ ...config, vps: { ...config.vps, wpStatusPath: e.target.value } })}
            placeholder="/api/wp-status"
            className="px-3 py-2 liquid-input rounded-lg text-sm md:col-span-2"
          />
        </div>
        <button
          onClick={() => testConnection('vps')}
          className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
        >
          <TestTube2 size={12} />
          Test VPS Connection
        </button>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-indigo-600 rounded-lg">
            <Cpu size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">AI Model Routing</h3>
            <p className="text-xs liquid-muted">
              Choose which model to run by default. You requested Gemma 4 model choice, so both are available here.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider liquid-soft mb-2">Primary Model</label>
            <select
              value={config.ai.model}
              onChange={(e) => setConfig({ ...config, ai: { ...config.ai, model: e.target.value } })}
              className="w-full px-3 py-2 liquid-input rounded-lg text-sm"
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider liquid-soft mb-2">Fallback Model</label>
            <select
              value={config.ai.fallbackModel}
              onChange={(e) => setConfig({ ...config, ai: { ...config.ai, fallbackModel: e.target.value } })}
              className="w-full px-3 py-2 liquid-input rounded-lg text-sm"
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.id})
                </option>
              ))}
            </select>
          </div>
          <input
            value={config.ai.model}
            onChange={(e) => setConfig({ ...config, ai: { ...config.ai, model: e.target.value } })}
            placeholder="Custom model id (optional)"
            className="px-3 py-2 liquid-input rounded-lg text-sm md:col-span-2"
          />
          <div className="md:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider liquid-soft mb-2">Gemini API Key</label>
            <div className="relative">
              <input
                value={config.ai.apiKey || ''}
                onChange={(e) => setConfig({ ...config, ai: { ...config.ai, apiKey: e.target.value } })}
                placeholder="AIza... (stored locally on this Mac)"
                type={visibleSecrets.geminiApiKey ? 'text' : 'password'}
                className="w-full px-3 pr-10 py-2 liquid-input rounded-lg text-sm"
              />
              <button
                type="button"
                onClick={() => toggleSecret('geminiApiKey')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 liquid-soft hover:liquid-title rounded"
                aria-label={visibleSecrets.geminiApiKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
              >
                {visibleSecrets.geminiApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs liquid-soft mt-2">
              If this field is empty, the app falls back to <code>GEMINI_API_KEY</code> from <code>.env</code>.
            </p>
          </div>
        </div>
        <button
          onClick={() => testConnection('ai')}
          className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
        >
          <TestTube2 size={12} />
          Test Selected Model
        </button>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-emerald-600 rounded-lg">
            <Server size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Hostinger Connection</h3>
            <p className="text-xs liquid-muted">Store and test Hostinger endpoint credentials.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={config.hostinger.baseUrl}
            onChange={(e) => setConfig({ ...config, hostinger: { ...config.hostinger, baseUrl: e.target.value } })}
            placeholder="https://hostinger-api-or-endpoint"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <input
            value={config.hostinger.username}
            onChange={(e) => setConfig({ ...config, hostinger: { ...config.hostinger, username: e.target.value } })}
            placeholder="Hostinger username/email"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <div className="relative">
            <input
              value={config.hostinger.apiToken}
              onChange={(e) => setConfig({ ...config, hostinger: { ...config.hostinger, apiToken: e.target.value } })}
              placeholder="Hostinger API token"
              type={visibleSecrets.hostingerApiToken ? 'text' : 'password'}
              className="w-full px-3 pr-10 py-2 liquid-input rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => toggleSecret('hostingerApiToken')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 liquid-soft hover:liquid-title rounded"
              aria-label={visibleSecrets.hostingerApiToken ? 'Hide Hostinger API token' : 'Show Hostinger API token'}
            >
              {visibleSecrets.hostingerApiToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <button
          onClick={() => testConnection('hostinger')}
          className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
        >
          <TestTube2 size={12} />
          Test Hostinger Connection
        </button>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill liquid-title rounded-lg">
            <FolderOpen size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Connector Tool Import</h3>
            <p className="text-xs liquid-muted">
              Import hints from your existing `connector_tool` JSON files (WordPress/VPS/Hostinger).
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <input
            value={config.connectorToolPath}
            onChange={(e) => setConfig({ ...config, connectorToolPath: e.target.value })}
            placeholder="/Users/.../Documents/New project/connector_tool"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <button
            onClick={async () => {
              try {
                const payload = await fetchJson<{ ok: boolean; message: string }>(
                  '/api/connector/import',
                  buildJsonInit('POST', { path: config.connectorToolPath }),
                );
                setMessage(payload.message);
                const refreshed = await fetchJson<AppConfig>('/api/settings');
                setConfig(refreshed);
              } catch (importError) {
                setError(String(importError));
              }
            }}
            className="justify-self-start flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
          >
            <FolderOpen size={12} />
            Import From Connector Tool
          </button>
        </div>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-sky-600 rounded-lg">
            <Search size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Google GA4 / GSC (Preparation)</h3>
            <p className="text-xs liquid-muted">
              Fields are saved now; direct OAuth connector is not implemented in this build yet.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={config.google.ga4PropertyId}
            onChange={(e) => setConfig({ ...config, google: { ...config.google, ga4PropertyId: e.target.value } })}
            placeholder="GA4 Property ID"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <input
            value={config.google.gscSiteUrl}
            onChange={(e) => setConfig({ ...config, google: { ...config.google, gscSiteUrl: e.target.value } })}
            placeholder="GSC Site URL"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <div className="relative md:col-span-2">
            <textarea
              value={config.google.serviceAccountJson}
              onChange={(e) => setConfig({ ...config, google: { ...config.google, serviceAccountJson: e.target.value } })}
              placeholder="Google service account JSON (optional, for future implementation)"
              className={`w-full px-3 py-2 pr-10 liquid-input rounded-lg text-sm min-h-[120px] ${visibleSecrets.googleServiceJson ? '' : 'masked-text'}`}
            />
            <button
              type="button"
              onClick={() => toggleSecret('googleServiceJson')}
              className="absolute right-2 top-2 p-1 liquid-soft hover:liquid-title rounded"
              aria-label={visibleSecrets.googleServiceJson ? 'Hide service account JSON' : 'Show service account JSON'}
            >
              {visibleSecrets.googleServiceJson ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-cyan-600 rounded-lg">
            <Search size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Research Fabric</h3>
            <p className="text-xs liquid-muted">
              Enable adaptive web browsing, scholarly retrieval, and notebook-style large document research.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-3 text-sm liquid-title">
            <input
              type="checkbox"
              checked={config.research.webBrowsingEnabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  research: { ...config.research, webBrowsingEnabled: e.target.checked },
                })
              }
              className="h-4 w-4 rounded border-white/50 bg-white/15 accent-cyan-500"
            />
            Enable internet browsing for factual checks
          </label>

          <label className="flex items-center gap-3 text-sm liquid-title">
            <input
              type="checkbox"
              checked={config.research.scholarEnabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  research: { ...config.research, scholarEnabled: e.target.checked },
                })
              }
              className="h-4 w-4 rounded border-white/50 bg-white/15 accent-cyan-500"
            />
            Enable scholarly source retrieval (OpenAlex)
          </label>

          <input
            type="number"
            min={2}
            max={10}
            value={config.research.maxWebSources}
            onChange={(e) =>
              setConfig({
                ...config,
                research: {
                  ...config.research,
                  maxWebSources: Number(e.target.value) || 5,
                },
              })
            }
            placeholder="Max web/scholar sources"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />

          <input
            type="number"
            min={2}
            max={16}
            value={config.research.maxNotebookSnippets}
            onChange={(e) =>
              setConfig({
                ...config,
                research: {
                  ...config.research,
                  maxNotebookSnippets: Number(e.target.value) || 6,
                },
              })
            }
            placeholder="Max notebook snippets"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />

          <input
            value={config.research.notebookWorkspacePath}
            onChange={(e) =>
              setConfig({
                ...config,
                research: { ...config.research, notebookWorkspacePath: e.target.value },
              })
            }
            placeholder="/Users/.../Documents/research_docs"
            className="px-3 py-2 liquid-input rounded-lg text-sm md:col-span-2"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              try {
                const payload = await fetchJson<{ ok: boolean; query: string; sources: Array<{ title: string }> }>(
                  '/api/research/web',
                  buildJsonInit('POST', { query: 'recent practical AI research' }),
                );
                setMessage(`Web research test OK: ${payload.sources.length} source(s) found.`);
                setError('');
              } catch (testError) {
                setError(String(testError));
              }
            }}
            className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
          >
            <TestTube2 size={12} />
            Test Web Research
          </button>

          <button
            onClick={async () => {
              try {
                const payload = await fetchJson<{ ok: boolean; query: string; sources: Array<{ title: string }> }>(
                  '/api/research/scholar',
                  buildJsonInit('POST', { query: 'public health intervention outcomes' }),
                );
                setMessage(`Scholar research test OK: ${payload.sources.length} source(s) found.`);
                setError('');
              } catch (testError) {
                setError(String(testError));
              }
            }}
            className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title"
          >
            <TestTube2 size={12} />
            Test Scholar Research
          </button>
        </div>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-sky-600 rounded-lg">
            <Wrench size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Self-Modification (Strict Approval)</h3>
            <p className="text-xs liquid-muted">
              Generate one-file code change proposals, review preview diff, then apply only with approval code and automatic backup.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm liquid-title">
          <input
            type="checkbox"
            checked={config.selfModification.enabled}
            onChange={(e) =>
              setConfig({
                ...config,
                selfModification: { ...config.selfModification, enabled: e.target.checked },
              })
            }
            className="h-4 w-4 rounded border-white/50 bg-white/15 accent-sky-500"
          />
          Enable in-app self-modification workflow
        </label>

        <div className="grid grid-cols-1 gap-3">
          <input
            value={config.selfModification.workspacePath}
            onChange={(e) =>
              setConfig({
                ...config,
                selfModification: { ...config.selfModification, workspacePath: e.target.value },
              })
            }
            placeholder="/Users/.../Downloads/azat-studio"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <input
            value={selfModTargetFile}
            onChange={(e) => setSelfModTargetFile(e.target.value)}
            placeholder="Target file relative path, e.g. src/components/AgentChat.tsx"
            className="px-3 py-2 liquid-input rounded-lg text-sm"
          />
          <textarea
            value={selfModInstruction}
            onChange={(e) => setSelfModInstruction(e.target.value)}
            placeholder="Describe exact change to implement (clear, testable, one-file scope)."
            className="px-3 py-2 liquid-input rounded-lg text-sm min-h-[110px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={proposeSelfModification}
            disabled={!config.selfModification.enabled || !selfModTargetFile.trim() || !selfModInstruction.trim() || isSelfModBusy}
            className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title disabled:opacity-50"
          >
            <Wrench size={12} />
            {isSelfModBusy ? 'Generating Proposal...' : 'Generate Proposal'}
          </button>
        </div>

        {selfModProposal && (
          <div className="liquid-surface border rounded-xl p-4 space-y-3">
            <div className="text-sm liquid-title font-semibold">{selfModProposal.summary}</div>
            <div className="text-xs liquid-muted">Target: {selfModProposal.targetFile}</div>
            <div className="text-xs liquid-muted">Expires: {new Date(selfModProposal.expiresAt).toLocaleString()}</div>
            <div className="text-xs liquid-soft">
              Approval code: <code>{selfModProposal.approvalCode}</code>
            </div>
            <pre className="text-xs liquid-title bg-black/20 rounded-lg p-3 max-h-56 overflow-auto whitespace-pre-wrap">
{selfModProposal.diffPreview}
            </pre>
            <div className="flex flex-col gap-2">
              <input
                value={selfModApprovalInput}
                onChange={(e) => setSelfModApprovalInput(e.target.value)}
                placeholder="Type approval code exactly to apply"
                className="px-3 py-2 liquid-input rounded-lg text-sm"
              />
              <button
                onClick={applySelfModification}
                disabled={isSelfModBusy || !selfModApprovalInput.trim()}
                className="self-start flex items-center gap-2 px-4 py-2 liquid-accent text-white rounded-lg text-xs font-bold disabled:opacity-60"
              >
                {isSelfModBusy ? 'Applying...' : 'Apply Approved Change'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-amber-600 rounded-lg">
            <BookOpen size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">NotebookLM & Research</h3>
            <p className="text-xs liquid-muted">
              Direct NotebookLM private account API access is unavailable; use notebook workspace bridge + exported artifacts.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm liquid-title">
          <input
            type="checkbox"
            checked={config.notebookLmEnabled}
            onChange={(e) => setConfig({ ...config, notebookLmEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-white/50 bg-white/15 accent-sky-500"
          />
          Enable NotebookLM mode label (for workflow tracking only)
        </label>
        <div className="p-4 liquid-note-warn rounded-xl border flex gap-3">
          <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm liquid-title leading-relaxed">
            Recommended workflow: set a Notebook workspace path in Research Fabric, then this app can search large local docs.
            If you run external NotebookLM MCP workflows, export notes/files into that workspace so Azat Studio can consume them.
          </p>
        </div>
      </section>

      <section className="liquid-surface-strong p-6 rounded-2xl border space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 liquid-pill text-cyan-600 rounded-lg">
            <RefreshCw size={20} />
          </div>
          <div>
            <h3 className="font-bold liquid-title">Desktop Updates</h3>
            <p className="text-xs liquid-muted">
              Check, download, and install updates from GitHub Releases.
            </p>
          </div>
        </div>

        {!updaterAvailable && (
          <div className="p-4 liquid-note-warn rounded-xl border flex gap-3">
            <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm liquid-title leading-relaxed">
              Updater controls are available only in the packaged desktop app (.dmg install), not in browser preview/dev mode.
            </p>
          </div>
        )}

        {updaterAvailable && (
          <>
            <div className="liquid-surface border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm liquid-title font-semibold">
                    Version: {updaterState?.currentVersion || 'unknown'}
                    {updaterState?.availableVersion ? ` -> ${updaterState.availableVersion}` : ''}
                  </div>
                  <div className="text-xs liquid-muted">{updaterState?.message || 'Ready.'}</div>
                </div>
                <span className={`px-2 py-1 text-[10px] font-bold rounded-full border uppercase tracking-wide ${updaterBadgeClass}`}>
                  {updaterStatus}
                </span>
              </div>

              {updaterState?.status === 'downloading' && (
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, updaterState.progress))}%` }}
                    />
                  </div>
                  <div className="text-[11px] liquid-soft">{Math.round(updaterState.progress)}%</div>
                </div>
              )}

              {updaterState?.lastCheckedAt && (
                <div className="text-[11px] liquid-soft">
                  Last check: {new Date(updaterState.lastCheckedAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runUpdaterAction('check')}
                disabled={!!updaterBusyAction}
                className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title disabled:opacity-60"
              >
                <RefreshCw size={12} />
                {updaterBusyAction === 'check' ? 'Checking...' : 'Check Updates'}
              </button>
              <button
                onClick={() => runUpdaterAction('download')}
                disabled={!!updaterBusyAction || updaterStatus !== 'available'}
                className="flex items-center gap-2 px-4 py-2 liquid-pill border rounded-lg text-xs font-bold liquid-title disabled:opacity-60"
              >
                <Download size={12} />
                {updaterBusyAction === 'download' ? 'Downloading...' : 'Download Update'}
              </button>
              <button
                onClick={() => runUpdaterAction('install')}
                disabled={!!updaterBusyAction || updaterStatus !== 'downloaded'}
                className="flex items-center gap-2 px-4 py-2 liquid-accent text-white rounded-lg text-xs font-bold disabled:opacity-60"
              >
                <Rocket size={12} />
                {updaterBusyAction === 'install' ? 'Installing...' : 'Restart & Install'}
              </button>
            </div>

            <p className="text-xs liquid-soft">
              Updates are served from releases in <code>github.com/narayvaz/mcp-agentic-editor</code>.
            </p>
          </>
        )}
      </section>

      <section className="liquid-surface-strong p-8 rounded-2xl border">
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck size={24} className="text-green-400" />
          <h3 className="font-bold text-xl liquid-title">Security & Privacy</h3>
        </div>
        <p className="text-sm liquid-muted leading-relaxed">
          Credentials are stored locally in your app config file on this machine to enable live integrations.
          Use dedicated low-privilege keys and WordPress application passwords.
        </p>
      </section>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-8 py-3 liquid-accent text-white rounded-xl font-bold transition-all disabled:opacity-60"
        >
          {isSaved ? <CheckCircle2 size={18} /> : <Save size={18} />}
          {isSaving ? 'Saving...' : isSaved ? 'Settings Saved' : 'Save All Changes'}
        </button>
      </div>

      <div className="text-xs liquid-muted">
        Need fully automated GA4/GSC OAuth and NotebookLM-like research pipeline? We can add that next as a dedicated backend connector module.
      </div>
    </div>
  );
}
