import React, { useEffect, useState } from 'react';
import { Zap, Server, Globe, Terminal, Play, Activity, Shield, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchJson } from '../lib/api';

interface AutomationItem {
  id?: string | number;
  name?: string;
  type?: string;
  status?: string;
  lastRun?: string;
  source?: string;
}

interface AutomationsPayload {
  items: AutomationItem[];
  source?: string;
  note?: string;
  error?: string;
}

export default function Automations() {
  const [connectionType, setConnectionType] = useState<'plugin' | 'vps'>('plugin');
  const [payload, setPayload] = useState<AutomationsPayload>({ items: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAutomations = async () => {
    setIsLoading(true);
    try {
      const nextPayload = await fetchJson<AutomationsPayload>('/api/automations');
      setPayload(nextPayload);
      setError('');
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAutomations();
  }, []);

  const automations = payload.items || [];

  return (
    <div className="max-w-6xl space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-gray-900">Automation Hub</h2>
          <p className="text-gray-500 text-sm">Manage your existing automations from VPS and WordPress.</p>
        </div>
        <button
          onClick={loadAutomations}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-sm p-4 rounded-xl">
          {error}
        </div>
      )}

      {payload.note && (
        <div className="bg-yellow-50 border border-yellow-100 text-yellow-800 text-sm p-4 rounded-xl">
          {payload.note}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          onClick={() => setConnectionType('plugin')}
          className={cn(
            'p-6 rounded-2xl border-2 text-left transition-all',
            connectionType === 'plugin'
              ? 'bg-blue-50 border-blue-600 shadow-lg shadow-blue-600/10'
              : 'bg-white border-gray-100 hover:border-gray-200',
          )}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className={cn('p-2 rounded-lg', connectionType === 'plugin' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500')}>
              <Globe size={20} />
            </div>
            <h3 className="font-bold text-gray-900">WordPress Automations</h3>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Use plugin or REST actions for post metadata, scheduling, and editorial checks.
          </p>
        </button>

        <button
          onClick={() => setConnectionType('vps')}
          className={cn(
            'p-6 rounded-2xl border-2 text-left transition-all',
            connectionType === 'vps'
              ? 'bg-purple-50 border-purple-600 shadow-lg shadow-purple-600/10'
              : 'bg-white border-gray-100 hover:border-gray-200',
          )}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className={cn('p-2 rounded-lg', connectionType === 'vps' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500')}>
              <Server size={20} />
            </div>
            <h3 className="font-bold text-gray-900">VPS Automations</h3>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Read and trigger existing cron/webhook workflows running on your VPS.
          </p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Zap size={18} className="text-orange-500" />
                Loaded Automations {payload.source ? `(${payload.source})` : ''}
              </h3>
            </div>

            {!automations.length && (
              <div className="p-6 text-sm text-gray-500">
                No automations loaded yet. Add VPS base URL and automations endpoint in Settings.
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {automations.map((auto, index) => (
                <div key={String(auto.id ?? index)} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-gray-100 rounded-lg text-gray-400">
                      {(auto.type || '').toLowerCase().includes('vps') ? <Server size={16} /> : <Globe size={16} />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-900">{auto.name || `Automation #${index + 1}`}</h4>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{auto.type || 'Unknown Type'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            (auto.status || '').toLowerCase() === 'active' ? 'bg-green-500 animate-pulse' : 'bg-gray-300',
                          )}
                        />
                        <span className="text-xs font-medium text-gray-600">{auto.status || 'Unknown'}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">Last run: {auto.lastRun || 'n/a'}</p>
                    </div>
                    <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                      <Play size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-900 p-6 rounded-2xl text-white">
            <div className="flex items-center gap-3 mb-6">
              <Shield size={20} className="text-green-400" />
              <h3 className="font-bold">Integration Bridge</h3>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">How it works</h4>
                <p className="text-xs text-gray-300 leading-relaxed">
                  This tab reads your existing automations from configured endpoints instead of hardcoded examples.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Connection State</h4>
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <Activity size={14} />
                  <span>{payload.source === 'vps' ? 'VPS feed connected' : 'Awaiting VPS endpoint setup'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-sm">
              <Terminal size={16} className="text-gray-400" />
              Next Step
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Open Settings and set your VPS base URL + Automations Path to load real existing jobs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
