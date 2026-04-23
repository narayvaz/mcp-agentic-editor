import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function AgentLogViewer() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(true);
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
  }, [logs]);

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
            animate={{ height: 160, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="liquid-surface-strong border border-white/10 overflow-hidden rounded-b-xl"
          >
            <div 
              ref={scrollRef}
              className="h-full overflow-y-auto p-3 space-y-1.5 font-mono text-[9px] custom-scrollbar"
            >
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center opacity-30 italic">
                  Waiting for agent activity...
                </div>
              ) : (
                logs.map((log, i) => {
                  const isError = log.includes('ERROR');
                  const isGate = log.includes('GATE');
                  return (
                    <div 
                      key={i} 
                      className={`${isError ? 'text-rose-400' : isGate ? 'text-amber-400' : 'text-sky-200/70'}`}
                    >
                      {log}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
