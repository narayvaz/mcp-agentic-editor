import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp, Filter } from 'lucide-react';
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
    if (log.includes('ERROR')) return 'text-rose-500 font-bold';
    if (log.includes('WARN')) return 'text-amber-400';
    if (log.includes('GATE')) return 'text-emerald-400';
    if (log.includes('INFO')) return 'text-sky-400';
    return 'text-slate-400';
  };

  const filteredLogs = logs.filter((log) => {
    if (filter === 'ALL') return true;
    if (filter === 'ERROR') return log.includes('ERROR');
    if (filter === 'WARN') return log.includes('WARN') || log.includes('GATE');
    if (filter === 'INFO') return log.includes('INFO') || !log.includes('ERROR') && !log.includes('WARN');
    return true;
  });

  return (
    <div className="mt-4 px-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 liquid-surface-strong rounded-t-xl border-x border-t border-white/20"
      >
        <div className="flex items-center gap-2 text-sky-400">
          <Terminal size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Internal Agent Thinking</span>
        </div>
        {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 200, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="liquid-surface-strong border border-white/10 overflow-hidden rounded-b-xl"
          >
            {/* Filter Bar */}
            <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 bg-black/20">
              <Filter size={10} className="text-slate-500" />
              <div className="flex gap-1">
                {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setFilter(level)}
                    className={`text-[8px] px-2 py-0.5 rounded-md transition-all font-bold ${ 
                      filter === level 
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' 
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div 
              ref={scrollRef}
              className="h-[calc(100%-36px)] overflow-y-auto p-3 space-y-1.5 font-mono text-[9px] custom-scrollbar"
            >
              {filteredLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center opacity-30 italic">
                  {logs.length === 0 ? 'Waiting for agent activity...' : 'No logs match current filter.'}
                </div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div 
                    key={i} 
                    className={getLogStyle(log)}
                  >
                    <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                    {log}
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
