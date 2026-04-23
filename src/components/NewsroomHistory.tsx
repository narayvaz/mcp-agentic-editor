import React, { useState, useEffect } from 'react';
import { 
  History, RotateCcw, ShieldCheck, ShieldAlert, 
  ExternalLink, Globe, Server, Cpu, RefreshCw,
  Search, Filter, ChevronDown, ChevronRight,
  Clock, AlertTriangle, CheckCircle2, XCircle
} from 'lucide-react';

interface HistoryEntry {
  id: string;
  timestamp: string;
  type: 'vps' | 'wordpress' | 'app' | 'automation';
  action: string;
  summary: string;
  target?: string;
  status: 'success' | 'failure' | 'pending';
  canRollback: boolean;
  rollbackId?: string;
}

export default function NewsroomHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState<string | null>(null);

  const API_BASE = 'http://127.0.0.1:3000'; // Standard local API

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history`);
      const data = await res.json();
      setEntries(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async (id: string) => {
    if (!window.confirm('Are you sure you want to rollback this change? This will overwrite current files/settings.')) return;
    
    setRollbackStatus(id);
    try {
      const res = await fetch(`${API_BASE}/api/history/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.ok) {
        alert('Rollback successful!');
        loadHistory();
      } else {
        alert(`Rollback failed: ${data.message}`);
      }
    } catch (error) {
      alert('Error connecting to server.');
    } finally {
      setRollbackStatus(null);
    }
  };

  const filteredEntries = entries.filter(e => {
    const matchesSearch = e.summary.toLowerCase().includes(search.toLowerCase()) || 
                         e.action.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || e.type === filter;
    return matchesSearch && matchesFilter;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'vps': return <Server size={16} className="text-sky-500" />;
      case 'wordpress': return <Globe size={16} className="text-emerald-500" />;
      case 'app': return <Cpu size={16} className="text-purple-500" />;
      default: return <History size={16} className="text-slate-500" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 size={14} className="text-emerald-500" />;
      case 'failure': return <XCircle size={14} className="text-rose-500" />;
      default: return <Clock size={14} className="text-amber-500 animate-pulse" />;
    }
  };

  return (
    <div className="h-full flex flex-col gap-5 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <ShieldCheck size={32} className="text-emerald-600" />
            Newsroom Insurance
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Audit log of all technical changes and one-click rollback options.</p>
        </div>
        <button 
          onClick={loadHistory}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search history..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-white dark:bg-slate-800 border rounded-xl">
          <Filter size={16} className="text-slate-400" />
          <select 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-transparent border-none outline-none text-sm font-medium"
          >
            <option value="all">All Types</option>
            <option value="vps">VPS Pipeline</option>
            <option value="wordpress">WordPress</option>
            <option value="app">Azat Studio App</option>
            <option value="automation">Automations</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 border rounded-2xl shadow-inner relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={32} className="text-emerald-600 animate-spin" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
            <History size={48} className="mb-4 opacity-20" />
            <p>No records found matching your filters.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Action / Summary</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Protection</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {filteredEntries.map((entry) => (
                <React.Fragment key={entry.id}>
                  <tr 
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {getTypeIcon(entry.type)}
                        <span className="text-xs font-bold uppercase text-slate-400">{entry.type}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white text-sm">{entry.action}</p>
                        <p className="text-xs text-slate-500 line-clamp-1">{entry.summary}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(entry.status)}
                        <span className="text-xs capitalize">{entry.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 font-mono">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {entry.canRollback && (
                        <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 text-[10px] font-bold rounded-full border border-emerald-200 uppercase">
                          Rollback Ready
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-b border-emerald-500/20">
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase text-slate-400">Technical Details</h4>
                            <p className="text-sm dark:text-slate-200">{entry.summary}</p>
                            {entry.target && (
                              <div className="flex items-center gap-2 text-xs font-mono bg-slate-200 dark:bg-slate-700 p-2 rounded-lg break-all">
                                <span className="text-slate-400">Target:</span>
                                {entry.target}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 min-w-[200px]">
                            {entry.canRollback ? (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleRollback(entry.id); }}
                                disabled={rollbackStatus === entry.id}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                              >
                                {rollbackStatus === entry.id ? <RefreshCw size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                                One-Click Rollback
                              </button>
                            ) : (
                              <div className="flex items-center gap-2 p-3 bg-slate-100 dark:bg-slate-700 rounded-xl text-slate-500 text-xs italic">
                                <AlertTriangle size={14} />
                                This action is permanent or self-rolling.
                              </div>
                            )}
                            <button className="w-full py-2 bg-white dark:bg-slate-700 border rounded-xl text-xs font-bold hover:shadow-sm">
                              Export Log
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
