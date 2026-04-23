import React, { useState, useEffect, useRef } from 'react';
import {
  Hammer, Play, RotateCcw, GitBranch, Upload, Terminal,
  CheckCircle, XCircle, Clock, RefreshCw, AlertTriangle,
  FileCode, Trash2, Eye, ChevronDown, ChevronRight, Loader2
} from 'lucide-react';

interface BackupEntry {
  file: string;
  original: string;
  timestamp: string;
  size: number;
}

interface GitStatus {
  branch: string;
  clean: boolean;
  modified: string[];
  ahead: number;
  lastCommit: string;
}

type StepStatus = 'idle' | 'running' | 'done' | 'error';

export default function CodeWorkshop() {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<StepStatus>('idle');
  const [deployStatus, setDeployStatus] = useState<StepStatus>('idle');
  const [gitPushStatus, setGitPushStatus] = useState<StepStatus>('idle');
  const [restoreStatus, setRestoreStatus] = useState<string>('');
  const [expandedBackup, setExpandedBackup] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const API = 'http://127.0.0.1:5005';

  const poll = async (endpoint: string) => {
    try {
      const res = await fetch(`${API}${endpoint}`);
      return await res.json();
    } catch {
      return null;
    }
  };

  // Load backups and git status on mount
  useEffect(() => {
    loadBackups();
    loadGitStatus();
  }, []);

  // Auto-scroll build log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [buildLog]);

  const loadBackups = async () => {
    const data = await poll('/devops/backups');
    if (data?.backups) setBackups(data.backups);
  };

  const loadGitStatus = async () => {
    const data = await poll('/devops/git-status');
    if (data) setGitStatus(data);
  };

  const runBuild = async () => {
    setBuildStatus('running');
    setBuildLog(['▶ Starting build...']);
    try {
      const res = await fetch(`${API}/devops/build`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        // Poll build log
        const interval = setInterval(async () => {
          const log = await poll('/devops/build-log');
          if (log?.lines) setBuildLog(log.lines);
          if (log?.status === 'done') {
            clearInterval(interval);
            setBuildStatus(log.exit_code === 0 ? 'done' : 'error');
            if (log.exit_code === 0) {
              setBuildLog(prev => [...prev, '✅ Build successful!']);
            } else {
              setBuildLog(prev => [...prev, '❌ Build failed. Check logs above.']);
            }
          }
        }, 1500);
      } else {
        setBuildStatus('error');
        setBuildLog(prev => [...prev, `❌ ${data.error || 'Failed to start build'}`]);
      }
    } catch (e) {
      setBuildStatus('error');
      setBuildLog(prev => [...prev, `❌ API unreachable: ${e}`]);
    }
  };

  const runDeploy = async () => {
    setDeployStatus('running');
    setBuildLog(prev => [...prev, '▶ Deploying to /Applications...']);
    try {
      const res = await fetch(`${API}/devops/deploy`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setDeployStatus('done');
        setBuildLog(prev => [...prev, '✅ Deployed to /Applications/Azat Studio.app']);
      } else {
        setDeployStatus('error');
        setBuildLog(prev => [...prev, `❌ Deploy failed: ${data.error}`]);
      }
    } catch (e) {
      setDeployStatus('error');
      setBuildLog(prev => [...prev, `❌ ${e}`]);
    }
  };

  const runGitPush = async () => {
    if (!commitMessage.trim()) {
      setBuildLog(prev => [...prev, '⚠️ Enter a commit message first.']);
      return;
    }
    setGitPushStatus('running');
    setBuildLog(prev => [...prev, `▶ Git: committing "${commitMessage}"...`]);
    try {
      const res = await fetch(`${API}/devops/git-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage })
      });
      const data = await res.json();
      if (data.ok) {
        setGitPushStatus('done');
        setBuildLog(prev => [...prev, `✅ Committed & pushed: ${data.hash || ''}`]);
        setCommitMessage('');
        loadGitStatus();
      } else {
        setGitPushStatus('error');
        setBuildLog(prev => [...prev, `❌ Git failed: ${data.error}`]);
      }
    } catch (e) {
      setGitPushStatus('error');
      setBuildLog(prev => [...prev, `❌ ${e}`]);
    }
  };

  const restoreBackup = async (backupFile: string) => {
    setRestoreStatus(backupFile);
    setBuildLog(prev => [...prev, `▶ Restoring backup: ${backupFile}...`]);
    try {
      const res = await fetch(`${API}/devops/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_file: backupFile })
      });
      const data = await res.json();
      if (data.ok) {
        setBuildLog(prev => [...prev, `✅ Restored: ${data.original_file}`]);
      } else {
        setBuildLog(prev => [...prev, `❌ Restore failed: ${data.error}`]);
      }
    } catch (e) {
      setBuildLog(prev => [...prev, `❌ ${e}`]);
    }
    setRestoreStatus('');
  };

  const runFullPipeline = async () => {
    setBuildLog(['▶ Starting full pipeline: Build → Deploy → Git Push']);
    await runBuild();
    // The rest will be triggered after build completes via status polling
  };

  const statusIcon = (status: StepStatus) => {
    switch (status) {
      case 'running': return <Loader2 size={14} className="animate-spin text-sky-500" />;
      case 'done': return <CheckCircle size={14} className="text-emerald-500" />;
      case 'error': return <XCircle size={14} className="text-rose-500" />;
      default: return <Clock size={14} className="liquid-soft" />;
    }
  };

  return (
    <div className="h-full flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold liquid-title flex items-center gap-3">
            <Hammer size={24} className="text-sky-600" />
            Code Workshop
          </h2>
          <p className="readable-copy text-sm mt-1">Build, deploy, restore, and push changes — all from inside the app.</p>
        </div>
        <button
          onClick={loadGitStatus}
          className="p-2 liquid-pill rounded-xl liquid-soft hover:liquid-title transition-colors"
          title="Refresh status"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Action Bar */}
      <div className="liquid-surface-strong p-4 rounded-2xl border">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runBuild}
            disabled={buildStatus === 'running'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] shadow-lg shadow-sky-500/20"
            style={{ background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)' }}
          >
            {statusIcon(buildStatus)}
            Build
          </button>
          <button
            onClick={runDeploy}
            disabled={deployStatus === 'running' || buildStatus === 'running'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] shadow-lg shadow-emerald-500/20"
            style={{ background: 'linear-gradient(135deg, #059669, #34d399)' }}
          >
            {statusIcon(deployStatus)}
            Deploy
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runGitPush()}
              placeholder="Commit message..."
              className="flex-1 px-3 py-2.5 liquid-input rounded-xl text-sm"
            />
            <button
              onClick={runGitPush}
              disabled={gitPushStatus === 'running' || !commitMessage.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02] shadow-lg shadow-purple-500/20"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)' }}
            >
              {statusIcon(gitPushStatus)}
              <GitBranch size={15} />
              Push
            </button>
          </div>
        </div>

        {/* Git Status Bar */}
        {gitStatus && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5 liquid-soft">
              <GitBranch size={12} />
              <span className="font-bold liquid-title">{gitStatus.branch}</span>
            </span>
            {gitStatus.clean ? (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle size={11} /> Clean
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={11} /> {gitStatus.modified?.length || 0} modified
              </span>
            )}
            {gitStatus.ahead > 0 && (
              <span className="flex items-center gap-1 text-sky-600">
                <Upload size={11} /> {gitStatus.ahead} ahead
              </span>
            )}
            {gitStatus.lastCommit && (
              <span className="liquid-soft truncate max-w-[200px]" title={gitStatus.lastCommit}>
                Last: {gitStatus.lastCommit}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 flex-1 min-h-0">
        {/* Backup History */}
        <div className="lg:col-span-2 liquid-surface-strong rounded-2xl border flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-white/30 flex items-center justify-between">
            <h3 className="font-bold text-sm liquid-title flex items-center gap-2">
              <RotateCcw size={16} className="text-amber-500" />
              Backup History
            </h3>
            <button onClick={loadBackups} className="p-1 liquid-soft hover:liquid-title rounded-lg">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {backups.length === 0 ? (
              <div className="text-center p-8 readable-copy text-sm">
                <RotateCcw size={32} className="mx-auto mb-3 opacity-30" />
                <p>No backups yet.</p>
                <p className="text-[11px] mt-1">Self-Modify creates a backup before each code change.</p>
              </div>
            ) : (
              backups.map((b) => {
                const isExpanded = expandedBackup === b.file;
                const fileName = b.original.split('/').pop() || b.original;
                const timeAgo = b.timestamp;
                return (
                  <div key={b.file} className="liquid-surface border rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedBackup(isExpanded ? null : b.file)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/20 transition-colors"
                    >
                      <FileCode size={14} className="text-sky-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold liquid-title truncate">{fileName}</p>
                        <p className="text-[10px] liquid-soft">{timeAgo}</p>
                      </div>
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/20 space-y-2">
                        <p className="text-[10px] liquid-soft break-all">{b.original}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => restoreBackup(b.file)}
                            disabled={restoreStatus === b.file}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg, #d97706, #fbbf24)' }}
                          >
                            {restoreStatus === b.file ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                            Restore
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Build Console */}
        <div className="lg:col-span-3 liquid-surface-strong rounded-2xl border flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-white/30 flex items-center justify-between">
            <h3 className="font-bold text-sm liquid-title flex items-center gap-2">
              <Terminal size={16} className="text-emerald-500" />
              Console Output
            </h3>
            <button
              onClick={() => setBuildLog([])}
              className="text-[10px] liquid-soft hover:liquid-title px-2 py-1 rounded-lg hover:bg-white/20 transition-colors"
            >
              Clear
            </button>
          </div>
          <div
            ref={logRef}
            className="flex-1 bg-slate-900 p-4 overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {buildLog.length === 0 ? (
              <p className="text-slate-500">Ready. Click Build, Deploy, or Push to see output here.</p>
            ) : (
              buildLog.map((line, i) => (
                <div
                  key={i}
                  className={`mb-0.5 ${
                    line.startsWith('✅') ? 'text-emerald-400' :
                    line.startsWith('❌') ? 'text-rose-400' :
                    line.startsWith('⚠️') ? 'text-amber-400' :
                    line.startsWith('▶') ? 'text-sky-400 font-bold' :
                    'text-slate-300'
                  }`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
