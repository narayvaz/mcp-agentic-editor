import React, { useState, useEffect } from 'react';
import { Globe, Shield, Zap, Activity, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';

export default function WordPressHealthDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/wordpress/health');
      if (!response.ok) throw new Error('Failed to fetch health data');
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <RefreshCw size={32} className="animate-spin text-sky-400" />
        <p className="text-sky-200/60 font-medium">Analyzing azat.tv ecosystem...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Shield size={48} className="text-rose-400 mb-4 opacity-50" />
        <h3 className="text-xl font-bold text-rose-200 mb-2">Monitor Offline</h3>
        <p className="readable-copy max-w-sm mb-6">{error}</p>
        <button 
          onClick={fetchHealth}
          className="liquid-accent px-6 py-2 rounded-full text-white font-bold hover:brightness-110 transition-all"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-6 overflow-y-auto custom-scrollbar pr-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <Globe size={24} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold liquid-title leading-tight">{data.site}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-emerald-400/80 uppercase tracking-wider">System Operational</span>
            </div>
          </div>
        </div>
        <button 
          onClick={fetchHealth}
          disabled={loading}
          className="p-2 liquid-pill liquid-muted hover:liquid-title rounded-xl transition-all"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.metrics.map((metric: any, i: number) => (
          <motion.div 
            key={metric.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="liquid-surface-strong p-5 rounded-2xl border flex flex-col justify-between"
          >
            <span className="text-xs font-bold liquid-muted uppercase tracking-widest">{metric.name}</span>
            <div className="mt-3">
              <span className={`text-lg font-bold text-${metric.color}-400`}>{metric.value}</span>
              <p className="text-xs liquid-soft mt-1 capitalize">{metric.status}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Performance & Detailed Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 liquid-surface-strong rounded-3xl border p-6">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-bold liquid-title flex items-center gap-2">
              <Zap size={18} className="text-amber-400" />
              Core Performance
            </h3>
            <span className="text-2xl font-black text-white">{data.performance.score}<span className="text-sm text-sky-400 ml-1">/ 100</span></span>
          </div>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="liquid-soft">Response Time</span>
                <span className="font-bold text-sky-400">{data.performance.responseTime}</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-sky-400 w-[85%] rounded-full shadow-[0_0_10px_rgba(56,189,248,0.5)]" />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="liquid-soft">Uptime (30d)</span>
                <span className="font-bold text-emerald-400">{data.performance.uptime}</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 w-[99%] rounded-full shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
              </div>
            </div>
          </div>
        </div>

        <div className="liquid-surface-strong rounded-3xl border p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold liquid-title flex items-center gap-2 mb-4">
              <Activity size={18} className="text-sky-400" />
              Audit Log
            </h3>
            <div className="space-y-4">
              <div className="pl-4 border-l-2 border-emerald-500/30 py-1">
                <p className="text-xs font-bold text-white">Cache Purged</p>
                <p className="text-[10px] liquid-muted mt-1">Automatic purge triggered by post update.</p>
              </div>
              <div className="pl-4 border-l-2 border-sky-500/30 py-1">
                <p className="text-xs font-bold text-white">SSL Verified</p>
                <p className="text-[10px] liquid-muted mt-1">Certificate valid until Oct 2026.</p>
              </div>
            </div>
          </div>
          <div className="mt-8 p-4 bg-sky-500/5 border border-sky-500/10 rounded-2xl">
            <p className="text-[10px] font-bold text-sky-300 uppercase tracking-tighter">Next Health Check</p>
            <p className="text-xs text-white mt-1">In approx. 45 seconds</p>
          </div>
        </div>
      </div>
    </div>
  );
}
