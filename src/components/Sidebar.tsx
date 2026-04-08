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
  Monitor
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'content', label: 'Content Review', icon: FileText },
    { id: 'seo', label: 'SEO & Analytics', icon: Search },
    { id: 'wordpress', label: 'WordPress Health', icon: Globe },
    { id: 'tools', label: 'Tool Generator', icon: Code2 },
    { id: 'rules', label: 'MCP Rules', icon: ScrollText },
    { id: 'automations', label: 'Automations', icon: Zap },
    { id: 'desktop', label: 'Desktop App', icon: Monitor },
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
              <div className="w-8 h-8 liquid-accent rounded-lg flex items-center justify-center text-white font-bold">
                M
              </div>
              <h1 className="font-serif font-bold text-xl tracking-tight liquid-title">MCP Editor</h1>
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

          <div className="p-4 mt-auto">
            <div className="liquid-surface rounded-xl p-4 border">
              <div className="flex items-center gap-2 text-amber-700 mb-2">
                <AlertCircle size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">System Alert</span>
              </div>
              <p className="text-xs text-amber-700/90 leading-relaxed">
                LiteSpeed Cache requires optimization. 3 issues detected.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
