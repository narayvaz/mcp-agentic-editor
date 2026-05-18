import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp, Filter, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function AgentLogViewer() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/agent/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch logs');
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, filter]);

  const getLogStyle = (log: string) => {
    const upperLog = log.toUpperCase();
    if (upperLog.includes('ERROR') || upperLog.includes('FAIL')) return 'text-rose-400 bg-rose-500/5 border-l border-rose-500/30';
    if (upperLog.includes('WARN')) return 'text-amber-300 bg-amber-500/5 border-l border-amber-500/30';
    if (upperLog.includes('GATE')) return 'text-emerald-400 bg-emerald-500/5 border-l border-emerald-500/30';
    if (upperLog.includes('INFO')) return 'text-sky-400 bg-sky-500/5 border-l border-sky-500/30';
    return 'text-slate-400 border-l border-transparent';
  };

  const filteredLogs = logs.filter((log) => {
    const upperLog = log.toUpperCase();
    if (filter === 'ALL') return true;
    if (filter === 'ERROR') return upperLog.includes('ERROR') || upperLog.includes('FAIL');
    if (filter === 'WARN') return upperLog.includes('WARN');
    if (filter === 'INFO') {
      return (
        upperLog.includes('INFO') || 
        upperLog.includes('GATE') || 
        (!upperLog.includes('ERROR') && !upperLog.includes('WARN') && !upperLog.includes('FAIL'))
      );
    }
    return true;
  });

  return (
    <div className="mt-4 px-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 liquid-surface-strong rounded-t-xl border-x border-t border-white/20 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-sky-400">
          <Terminal size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Internal Agent Thinking</span>
          <div className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20">
            <Activity size={8} className="text-sky-400 animate-pulse" />
            <span className="text-[7px] text-sky-400/80 font-medium">LIVE</span>
          </div>
        </div>
        {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronUp size={14} className="text-slate-500" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 250, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="liquid-surface-strong border border-white/10 overflow-hidden rounded-b-xl"
          >
            {/* Filter Bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/40">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Filter size={10} className="text-slate-500" />
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Filter</span>
                </div>
                <div className="flex gap-1">
                  {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((level) => {
                    const isActive = filter === level;
                    const styles = {
                      ALL: isActive ? 'bg-slate-500/20 text-slate-200 border-slate-500/40' : 'text-slate-500 hover:text-slate-300',
                      INFO: isActive ? 'bg-sky-500/20 text-sky-400 border-sky-500/40' : 'text-slate-500 hover:text-sky-400',
                      WARN: isActive ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'text-slate-500 hover:text-amber-400',
                      ERROR: isActive ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' : 'text-slate-500 hover:text-rose-400',
                    };
                    
                    return (
                      <button
                        key={level}
                        onClick={() => setFilter(level)}
                        className={`text-[8px] px-2 py-0.5 rounded transition-all font-bold border ${ 
                          isActive ? styles[level] : `border-transparent ${styles[level]}`
                        }`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <button 
                onClick={() => setLogs([])}
                className="p-1 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded transition-colors"
                title="Clear Logs"
              >
                <Trash2 size={10} />
              </button>
            </div>

            <div 
              ref={scrollRef}
              className="h-[calc(100%-36px)] overflow-y-auto p-3 space-y-1 font-mono text-[9px] custom-scrollbar"
            >
              {filteredLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center opacity-30 italic">
                  {logs.length === 0 ? 'Waiting for agent activity...' : 'No logs match current filter.'}
                </div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div 
                    key={i} 
                    className={`group flex gap-2 items-start hover:bg-white/5 py-1 px-2 rounded transition-colors ${
                      getLogStyle(log)
                    }`}
                  >
                    <span className="opacity-30 shrink-0 select-none font-light">
                      {new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="break-all leading-relaxed">{log}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
