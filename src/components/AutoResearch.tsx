import React, { useState, useEffect, useRef } from 'react';
import {
  FlaskConical, Play, Square, CheckCircle, XCircle, Clock,
  RefreshCw, ChevronDown, ChevronRight, Brain, Loader2,
  AlertTriangle, GitBranch, Sparkles, FileCode, BookOpen,
  ToggleLeft, ToggleRight, TrendingUp, Target
} from 'lucide-react';
import { cn } from '../lib/utils';

interface ArExperiment {
  id: string;
  runNumber: number;
  timestamp: string;
  targetFile: string;
  hypothesis: string;
  notebookContext: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  kept: boolean;
  reverted: boolean;
  qualityGatePassed: boolean;
  gitHash: string;
  status: 'running' | 'scored' | 'awaiting_approval' | 'approved' | 'reverted' | 'error';
  error?: string;
}

interface ArStatus {
  running: boolean;
  domain: string;
  mode: 'approval-gated' | 'autonomous';
  experimentCount: number;
  keptCount: number;
  revertedCount: number;
  winRate: number;
  bestScore: number;
  currentScore: number;
  currentExperiment: ArExperiment | null;
  pendingApproval: ArExperiment | null;
  startedAt: string | null;
  pausedAt: string | null;
}

function ScoreBadge({ score, delta }: { score: number; delta?: number }) {
  const color = score >= 8 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : score >= 7 ? 'text-sky-600 bg-sky-50 border-sky-200'
    : score >= 5 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-rose-600 bg-rose-50 border-rose-200';

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold border', color)}>
      {score.toFixed(1)}
      {delta !== undefined && delta !== 0 && (
        <span className={delta > 0 ? 'text-emerald-600' : 'text-rose-600'}>
          {' '}{delta > 0 ? '+' : ''}{delta.toFixed(1)}
        </span>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: ArExperiment['status'] }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    running:           { label: 'Running',           cls: 'text-sky-600 bg-sky-50 border-sky-200',        icon: <Loader2 size={10} className="animate-spin" /> },
    scored:            { label: 'Kept ✅',            cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: <CheckCircle size={10} /> },
    awaiting_approval: { label: 'Needs Approval ⏸',  cls: 'text-amber-600 bg-amber-50 border-amber-200',  icon: <Clock size={10} /> },
    approved:          { label: 'Approved ✅',        cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: <CheckCircle size={10} /> },
    reverted:          { label: 'Reverted ↩',        cls: 'text-slate-500 bg-slate-50 border-slate-200',  icon: <XCircle size={10} /> },
    error:             { label: 'Error ❌',           cls: 'text-rose-600 bg-rose-50 border-rose-200',     icon: <AlertTriangle size={10} /> },
  };
  const { label, cls, icon } = map[status] || map.error;
  return (
    <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border', cls)}>
      {icon} {label}
    </span>
  );
}

export default function AutoResearch() {
  const [status, setStatus] = useState<ArStatus | null>(null);
  const [log, setLog] = useState<ArExperiment[]>([]);
  const [program, setProgram] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [clearingLog, setClearingLog] = useState(false);
  const [expandedExp, setExpandedExp] = useState<string | null>(null);
  const [showProgram, setShowProgram] = useState(false);
  const [useAutonomous, setUseAutonomous] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/autoresearch/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  };

  const fetchLog = async () => {
    try {
      const res = await fetch('/api/autoresearch/log');
      if (res.ok) {
        const data = await res.json();
        setLog(data.experiments || []);
      }
    } catch { /* ignore */ }
  };

  const fetchProgram = async () => {
    try {
      const res = await fetch('/api/autoresearch/program');
      if (res.ok) {
        const data = await res.json();
        setProgram(data.content || '');
      }
    } catch { /* ignore */ }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchLog(), fetchProgram()]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(() => {
      fetchStatus();
      fetchLog();
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/autoresearch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireApproval: !useAutonomous, autonomous: useAutonomous }),
      });
      const data = await res.json();
      if (!data.ok) alert(data.message);
      else await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/autoresearch/stop', { method: 'POST' });
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (approved: boolean) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/autoresearch/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      const data = await res.json();
      if (!data.ok) alert(data.message);
      await Promise.all([fetchStatus(), fetchLog()]);
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearFailed = async () => {
    setClearingLog(true);
    try {
      const res = await fetch('/api/autoresearch/clear-failed', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        await fetchLog();
        await fetchStatus();
      }
    } finally {
      setClearingLog(false);
    }
  };

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-sky-500" />
      </div>
    );
  }

  const isRunning = status?.running ?? false;
  const pending = status?.pendingApproval;

  return (
    <div className="h-full flex flex-col gap-5 overflow-y-auto">
      {/* Header */}
      <div className="liquid-surface-strong p-6 rounded-3xl border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl liquid-pill flex items-center justify-center text-indigo-600">
              <FlaskConical size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-serif font-bold liquid-title flex items-center gap-3">
                AutoResearch
                <span className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-full border',
                  isRunning ? 'text-emerald-600 bg-emerald-50 border-emerald-200 animate-pulse'
                           : 'text-slate-500 bg-slate-50 border-slate-200'
                )}>
                  {isRunning ? '● RUNNING' : '○ IDLE'}
                </span>
              </h2>
              <p className="readable-copy text-sm mt-0.5">
                Karpathy-style autonomous improvement loop — NotebookLM as the wise brain
              </p>
            </div>
          </div>
          <button onClick={loadAll} className="p-2 liquid-pill rounded-xl liquid-soft hover:liquid-title">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats Row — Exp #80: enhanced with win-rate bar and reverted count */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Experiments', value: status?.experimentCount ?? 0, icon: <FlaskConical size={16} />, color: 'text-indigo-600' },
          { label: 'Kept ✅', value: status?.keptCount ?? 0, icon: <CheckCircle size={16} />, color: 'text-emerald-600' },
          { label: 'Reverted ↩', value: status?.revertedCount ?? 0, icon: <XCircle size={16} />, color: 'text-slate-500' },
          { label: 'Best Score', value: (status?.bestScore ?? 0).toFixed(1), icon: <Target size={16} />, color: 'text-amber-600' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="liquid-surface-strong rounded-2xl border p-4 flex items-center gap-3">
            <div className={cn('p-2 liquid-pill rounded-xl', color)}>{icon}</div>
            <div>
              <p className="text-xs liquid-soft font-medium uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold liquid-title">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Performance & Reliability Stats Bar */}
      {(status?.experimentCount ?? 0) > 0 && (
        <div className="liquid-surface-strong rounded-2xl border p-5 bg-gradient-to-br from-white/40 to-indigo-50/20">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-600" />
              <h3 className="text-sm font-bold liquid-title uppercase tracking-wider">Agent Performance & Reliability</h3>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest liquid-soft">
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500" /> Reliability</span>
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Efficiency</span>
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500" /> Quality</span>
            </div>
          </div>
          
          <div className="space-y-5">
            {/* Reliability Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="font-medium liquid-soft">Autonomous Reliability (Win Rate)</span>
                <span className="font-bold liquid-title">{status?.winRate ?? 0}%</span>
              </div>
              <div className="h-2 w-full bg-slate-100/50 rounded-full overflow-hidden border border-slate-200/30">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-1000 ease-out" 
                  style={{ width: `${status?.winRate ?? 0}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Efficiency Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium liquid-soft">Research Efficiency</span>
                  <span className="font-bold liquid-title">
                    {status?.experimentCount ? Math.round((status.keptCount / status.experimentCount) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-100/50 rounded-full overflow-hidden border border-slate-200/30">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000 ease-out" 
                    style={{ width: `${status?.experimentCount ? (status.keptCount / status.experimentCount) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Quality Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium liquid-soft">Insight Quality Consistency</span>
                  <span className="font-bold liquid-title">
                    {status?.bestScore ? Math.round(((status.currentScore || 0) / status.bestScore) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-100/50 rounded-full overflow-hidden border border-slate-200/30">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all duration-1000 ease-out" 
                    style={{ width: `${status?.bestScore ? ((status.currentScore || 0) / status.bestScore) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="liquid-surface-strong rounded-2xl border p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseAutonomous(!useAutonomous)}
              className="flex items-center gap-2 text-sm font-medium liquid-title"
              disabled={isRunning}
            >
              {useAutonomous
                ? <ToggleRight size={22} className="text-indigo-600" />
                : <ToggleLeft size={22} className="text-slate-400" />}
              <span>{useAutonomous ? 'Autonomous (overnight)' : 'Approval-gated'}</span>
            </button>
          </div>

          <div className="flex-1" />

          {/* Start / Stop */}
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50 shadow-lg shadow-indigo-500/20"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}
            >
              {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Start Loop
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50 shadow-lg shadow-rose-500/20"
              style={{ background: 'linear-gradient(135deg, #e11d48, #fb7185)' }}
            >
              {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
              Stop Loop
            </button>
          )}
        </div>

        {/* Current experiment status */}
        {status?.currentExperiment && (
          <div className="mt-4 p-3 rounded-xl bg-indigo-50/60 border border-indigo-200/50">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 size={14} className={cn(status.currentExperiment.status === 'running' && 'animate-spin', 'text-indigo-600')} />
              <span className="text-xs font-bold text-indigo-700">
                Experiment #{status.currentExperiment.runNumber}
              </span>
              <StatusBadge status={status.currentExperiment.status} />
            </div>
            {status.currentExperiment.hypothesis && (
              <p className="text-xs text-indigo-800 font-medium">
                "{status.currentExperiment.hypothesis.slice(0, 120)}"
              </p>
            )}
            {status.currentExperiment.targetFile && (
              <p className="text-[10px] text-indigo-600 mt-1 flex items-center gap-1">
                <FileCode size={10} /> {status.currentExperiment.targetFile}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Approval Gate — shown prominently when waiting */}
      {pending && (
        <div className="liquid-surface-strong rounded-2xl border-2 border-amber-300 p-5 bg-amber-50/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm liquid-title">Approval Required — Experiment #{pending.runNumber}</h3>
              <p className="text-xs liquid-soft">Review the proposed change before it gets applied</p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <div className="p-3 rounded-xl bg-white/60 border border-amber-200/50">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Hypothesis</p>
              <p className="text-sm font-medium liquid-title">"{pending.hypothesis}"</p>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 p-3 rounded-xl bg-white/60 border border-amber-200/50">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Target File</p>
                <p className="text-xs font-mono liquid-title">{pending.targetFile}</p>
              </div>
              {pending.notebookContext && (
                <div className="flex-1 p-3 rounded-xl bg-white/60 border border-amber-200/50">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Brain size={9} /> NotebookLM Context
                  </p>
                  <p className="text-[10px] liquid-soft line-clamp-2">{pending.notebookContext}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleApprove(true)}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 shadow-lg shadow-emerald-500/20"
              style={{ background: 'linear-gradient(135deg, #059669, #34d399)' }}
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Approve & Apply
            </button>
            <button
              onClick={() => handleApprove(false)}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              <XCircle size={14} />
              Skip & Continue
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Experiment Log */}
        <div className="lg:col-span-2 liquid-surface-strong rounded-2xl border overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-white/30 flex items-center justify-between">
            <h3 className="font-bold text-sm liquid-title flex items-center gap-2">
              <GitBranch size={16} className="text-indigo-500" />
              Experiment Log
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] liquid-soft">{log.length} total</span>
              {log.some(e => !e.hypothesis || e.hypothesis.trim().length <= 5 || e.status === 'running') && (
                <button
                  onClick={handleClearFailed}
                  disabled={clearingLog}
                  title="Remove stuck/empty experiment entries"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-all disabled:opacity-50 active:scale-95"
                >
                  {clearingLog ? <RefreshCw size={10} className="animate-spin" /> : '🧹'}
                  Clear Failed
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[420px]">
            {log.length === 0 ? (
              <div className="p-8 text-center">
                <FlaskConical size={32} className="mx-auto mb-3 opacity-20 text-indigo-400" />
                <p className="text-sm liquid-soft">No experiments yet.</p>
                <p className="text-[11px] liquid-soft mt-1">Start the loop to begin autonomous self-improvement.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/20">
                {log.map((exp) => {
                  const isOpen = expandedExp === exp.id;
                  return (
                    <div key={exp.id} className="transition-colors hover:bg-white/20">
                      <button
                        onClick={() => setExpandedExp(isOpen ? null : exp.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <span className="text-[10px] font-bold liquid-soft w-8">#{exp.runNumber}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium liquid-title truncate">
                            {exp.hypothesis || 'Generating hypothesis...'}
                          </p>
                          <p className="text-[10px] liquid-soft truncate">{exp.targetFile}</p>
                        </div>
                        <StatusBadge status={exp.status} />
                        {exp.scoreAfter > 0 && (
                          <ScoreBadge score={exp.scoreAfter} delta={exp.delta} />
                        )}
                        {isOpen ? <ChevronDown size={13} className="liquid-soft shrink-0" /> 
                                : <ChevronRight size={13} className="liquid-soft shrink-0" />}
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 border-t border-white/20 space-y-2 bg-white/10">
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                              <span className="liquid-soft">Time:</span>{' '}
                              <span className="font-medium liquid-title">{timeAgo(exp.timestamp)}</span>
                            </div>
                            <div>
                              <span className="liquid-soft">Quality Gate:</span>{' '}
                              <span className={exp.qualityGatePassed ? 'text-emerald-600 font-bold' : 'text-slate-500'}>
                                {exp.qualityGatePassed ? '✅ Passed' : 'N/A'}
                              </span>
                            </div>
                            {exp.gitHash && (
                              <div className="col-span-2">
                                <span className="liquid-soft">Git:</span>{' '}
                                <span className="font-mono text-indigo-600">{exp.gitHash.slice(0, 50)}</span>
                              </div>
                            )}
                          </div>
                          {exp.notebookContext && (
                            <div className="p-2 rounded-lg bg-indigo-50/50 border border-indigo-100">
                              <p className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Brain size={8} /> NotebookLM Context
                              </p>
                              <p className="text-[10px] text-indigo-700 line-clamp-3">{exp.notebookContext}</p>
                            </div>
                          )}
                          {exp.error && (
                            <p className="text-[10px] text-rose-600 font-medium">{exp.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: program.md + info */}
        <div className="space-y-4">
          {/* Program viewer */}
          <div className="liquid-surface-strong rounded-2xl border overflow-hidden">
            <button
              onClick={() => setShowProgram(!showProgram)}
              className="w-full flex items-center gap-2 px-4 py-3 border-b border-white/30 text-left hover:bg-white/20 transition-colors"
            >
              <BookOpen size={15} className="text-emerald-600" />
              <span className="font-bold text-sm liquid-title flex-1">azat_program_selfmod.md</span>
              {showProgram ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {showProgram && (
              <pre className="p-4 text-[9px] text-slate-600 font-mono leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[300px] bg-slate-900 text-slate-300">
                {program}
              </pre>
            )}
          </div>

          {/* How it works */}
          <div className="liquid-surface-strong rounded-2xl border p-4 space-y-3">
            <h4 className="font-bold text-xs liquid-title flex items-center gap-2">
              <Sparkles size={14} className="text-amber-500" />
              How AutoResearch Works
            </h4>
            {[
              { icon: '📖', label: 'Reads program.md strategy', desc: 'Your instructions + past results' },
              { icon: '🧠', label: 'Queries NotebookLM', desc: 'Gets domain knowledge from your notebooks' },
              { icon: '💡', label: 'Proposes 1 change', desc: 'Gemini selects a targeted improvement' },
              { icon: '🏗️', label: 'Quality gate', desc: 'npm lint + build must pass' },
              { icon: '📊', label: 'Scores the change', desc: 'Gemini evaluates: ≥7.0 = KEPT' },
              { icon: '🔀', label: 'Git snapshot', desc: 'Full rollback history preserved' },
              { icon: '🔁', label: 'Repeats every 8 min', desc: 'Runs overnight autonomously' },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="flex gap-2 text-xs">
                <span className="shrink-0">{icon}</span>
                <div>
                  <p className="font-bold liquid-title">{label}</p>
                  <p className="liquid-soft text-[10px]">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Self-mod settings reminder */}
          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/50 text-[10px] text-amber-800">
            <p className="font-bold mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Requirement</p>
            <p>Go to <strong>Settings → Self-Modification</strong> and enable it with the workspace path set to your <code>mcp-agentic-editor</code> folder before starting.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
