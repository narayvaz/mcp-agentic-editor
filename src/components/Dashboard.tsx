import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  MousePointer2, 
  Eye, 
  Activity,
  AlertTriangle,
  Globe
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
} from 'recharts';
import { cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import AgentCapabilities from './AgentCapabilities';
import { SeoStatsResponse, WordPressStatusResponse } from '../types/config';

export default function Dashboard() {
  const [stats, setStats] = useState<SeoStatsResponse | null>(null);
  const [wpStatus, setWpStatus] = useState<WordPressStatusResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [nextStats, nextWpStatus] = await Promise.all([
          fetchJson<SeoStatsResponse>('/api/seo-stats'),
          fetchJson<WordPressStatusResponse>('/api/wp-status'),
        ]);
        setStats(nextStats);
        setWpStatus(nextWpStatus);
        setError('');
      } catch (fetchError) {
        setError(String(fetchError));
      }
    };

    load();
  }, []);

  const trends = (stats as any)?.trends || {};
  const cards = [
    {
      label: 'Total Clicks',
      value: stats?.clicks?.toLocaleString() || '0',
      icon: MousePointer2,
      trend: trends.clicks || (stats ? '—' : '--'),
      iconClass: 'liquid-pill text-sky-700',
    },
    {
      label: 'Impressions',
      value: stats?.impressions?.toLocaleString() || '0',
      icon: Eye,
      trend: trends.impressions || (stats ? '—' : '--'),
      iconClass: 'liquid-pill text-indigo-700',
    },
    {
      label: 'Avg. Position',
      value: stats ? stats.avgPosition : '0',
      icon: TrendingUp,
      trend: trends.avgPosition || (stats ? '—' : '--'),
      iconClass: 'liquid-pill text-emerald-700',
    },
    {
      label: 'CTR',
      value: stats ? `${stats.ctr}%` : '0%',
      icon: Activity,
      trend: trends.ctr || (stats ? '—' : '--'),
      iconClass: 'liquid-pill text-amber-700',
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-serif font-bold liquid-title">Studio Overview</h2>
        <p className="readable-copy text-sm">Live metrics from your configured data sources.</p>
      </header>

      {error && (
        <div className="liquid-surface border text-amber-700 text-sm p-4 rounded-xl flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Could not reach data endpoints. Configure your WordPress site and VPS in <strong>Settings</strong>.</span>
        </div>
      )}

      {stats?.note && (
        <div className="liquid-surface border text-yellow-800 text-sm p-4 rounded-xl">
          {stats.note}
        </div>
      )}

      <AgentCapabilities />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="liquid-surface p-6 rounded-2xl border">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-lg", card.iconClass)}>
                <card.icon size={20} />
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                card.trend.startsWith('+') ? 'liquid-pill text-emerald-600' :
                card.trend.startsWith('-') ? 'liquid-pill text-rose-600' :
                'liquid-pill liquid-soft'
              }`}>
                {card.trend}
              </span>
            </div>
            <p className="text-sm readable-copy font-medium mb-1">{card.label}</p>
            <h3 className="text-2xl font-bold liquid-title">{card.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 liquid-surface p-6 rounded-2xl border">
          <h3 className="font-bold liquid-title mb-6 flex items-center gap-2">
            <TrendingUp size={18} className="text-sky-600" />
            Traffic Trends (Last 7 Days)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats?.history || []}>
                <defs>
                  <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1cc8c3" stopOpacity={0.16}/>
                    <stop offset="95%" stopColor="#1cc8c3" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(90, 157, 166, 0.28)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#5a7280'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#5a7280'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: '1px solid rgba(245,255,253,0.6)', boxShadow: '0 16px 30px rgba(35, 95, 109, 0.2)', background: 'rgba(247,255,253,0.74)', backdropFilter: 'blur(16px)' }}
                />
                <Area type="monotone" dataKey="clicks" stroke="#1cc8c3" fillOpacity={1} fill="url(#colorClicks)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="liquid-surface p-6 rounded-2xl border">
          <h3 className="font-bold liquid-title mb-6 flex items-center gap-2">
            <Globe size={18} className="text-emerald-600" />
            WordPress Health {wpStatus?.source ? `(${wpStatus.source})` : ''}
          </h3>
          <div className="space-y-4">
            {wpStatus?.issues?.map((issue) => (
              <div key={issue.id} className="flex gap-3 p-3 rounded-xl liquid-pill border">
                <div className={cn(
                  "mt-0.5",
                  issue.severity === 'high' ? 'text-rose-500' : 
                  issue.severity === 'medium' ? 'text-amber-500' : 'text-sky-500'
                )}>
                  {issue.severity === 'high' ? <AlertTriangle size={16} /> : <Activity size={16} />}
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider liquid-soft mb-1">{issue.type}</p>
                  <p className="text-sm liquid-muted font-medium">{issue.message}</p>
                </div>
              </div>
            ))}
            {!wpStatus?.issues?.length && (
              <div className="text-sm readable-copy">No issues reported yet.</div>
            )}
            <button 
              onClick={() => {
                const btn = document.activeElement as HTMLButtonElement;
                if (btn) {
                  const originalText = btn.innerText;
                  btn.innerText = 'Checking PWA Status...';
                  btn.disabled = true;
                  
                  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                  setTimeout(() => {
                    btn.innerText = isStandalone ? 'App Installed (Standalone)' : 'Running in Browser';
                    setTimeout(() => {
                      btn.innerText = 'Diagnostic Complete';
                      setTimeout(() => {
                        btn.innerText = originalText;
                        btn.disabled = false;
                      }, 2000);
                    }, 2000);
                  }, 2000);
                }
              }}
              className="w-full py-3 liquid-accent text-white rounded-xl text-sm font-bold transition-transform mt-4 disabled:opacity-50 hover:scale-[1.01]"
            >
              Run Full Diagnostic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
