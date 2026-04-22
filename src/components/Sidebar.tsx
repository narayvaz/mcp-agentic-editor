import React from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Search, 
  Globe, 
  Settings, 
  Zap, 
  AlertCircle,
  X, 
  Code2,
  ScrollText,
  BookOpen,
  Video,
  Hammer,
  History,
  Cloud,
  RefreshCcw
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

function WPHealthMonitor() {
  const [health, setHealth] = React.useState<{ cache: boolean; queryTime: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/wordpress/health');
      if (!res.ok) throw new Error('Failed to fetch health data');
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (e) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !health) {
    return (
      <div className="liquid-surface rounded-xl p-4 border border-teal-500/30 bg-teal-50/10 animate-pulse">
        <div className="h-3 w-24 bg-teal-200/20 rounded mb-3" />
        <div className="space-y-2">
          <div className="h-2 w-full bg-teal-200/20 rounded" />
          <div className="h-2 w-2/3 bg-teal-200/20 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="liquid-surface rounded-xl p-4 border border-teal-500/30 bg-teal-50/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-teal-700">
          <RefreshCcw size={14} className={cn("animate-spin", loading && "opacity-50")} style={{ animationDuration: '3s' }} />
          <span className="text-xs font-bold uppercase tracking-wider">WP Health Status</span>
        </div>
        {error && <AlertCircle size={14} className="text-rose-500" />}
      </div>
      
      {error ? (
        <div className="text-[10px] text-rose-600 font-medium py-1">
          {error}. Retrying...
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-teal-700/70 font-medium">Object Cache</span>
            <span className={cn("font-bold", health?.cache ? "text-emerald-600" : "text-rose-600")}>
              {health?.cache ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-teal-700/70 font-medium">Query Monitor</span>
            <span className={cn("font-bold", (health?.queryTime || 0) < 0.5 ? "text-emerald-600" : "text-rose-600")}>
              {health ? `${health.queryTime}s` : '--'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'content', label: 'Content Review', icon: FileText },
    { id: 'seo', label: 'SEO & Analytics', icon: Search },
    { id: 'wordpress', label: 'WordPress Health', icon: Globe },
    { id: 'tools', label: 'Tool Generator', icon: Code2 },
    { id: 'rules', label: 'MCP Control', icon: ScrollText },
    { id: 'automations', label: 'Automations', icon: Zap },
    { id: 'desktop', label: 'Azat Handbook', icon: BookOpen },
    { id: 'newsroom', label: 'Newsroom Pipeline', icon: Video },
    { id: 'history', label: 'Newsroom History', icon: History },
    { id: 'workshop', label: 'Code Workshop', icon: Hammer },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside className={cn(
        "fixed inset-y-2 left-2 z-50 w-64 liquid-surface-strong rounded-3xl border border-white/50 transform transition-transform duration-300 ease-in-out lg:relative lg:inset-auto lg:translate-x-0 lg:rounded-none lg:border-r lg:border-l-0 lg:border-y-0",
        !isOpen && "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 azat-logo flex items-center justify-center font-bold">
                <span className="azat-logo-letter">A</span>
              </div>
              <div className="leading-tight">
                <h1 className="font-serif font-bold text-xl tracking-tight liquid-title">Azat Studio</h1>
                <p className="text-[10px] uppercase tracking-[0.18em] liquid-soft">Research Agent OS</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="lg:hidden p-2 liquid-soft hover:liquid-title">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 px-4 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (window.innerWidth < 1024) setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                  activeTab === item.id 
                    ? "liquid-pill liquid-title shadow-sm" 
                    : "liquid-muted hover:bg-white/45 hover:border hover:border-white/55 hover:backdrop-blur-md hover:liquid-title"
                )}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 mt-auto space-y-3">
            <button
              onClick={async () => {
                const msg = window.prompt('Enter commit message to ship changes to cloud:');
                if (!msg) return;
                try {
                  const res = await fetch('http://127.0.0.1:5005/devops/git-push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg })
                  });
                  const data = await res.json();
                  if (data.ok) alert('Successfully shipped to cloud!');
                  else alert('Git push failed: ' + data.error);
                } catch (e) {
                  alert('Error connecting to local DevOps service.');
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
            >
              <Cloud size={16} />
              Ship to Cloud
            </button>

            <WPHealthMonitor />
          </div>
        </div>
      </aside>
    </>
  );
}