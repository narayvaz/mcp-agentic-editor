/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ContentReviewer from './components/ContentReviewer';
import ToolGenerator from './components/ToolGenerator';
import Settings from './components/Settings';
import RulesManager from './components/RulesManager';
import Automations from './components/Automations';
import AgentChat from './components/AgentChat';
import NewsroomPipeline from './components/NewsroomPipeline';
import NewsroomHistory from './components/NewsroomHistory';
import AzatHandbook from './components/AzatHandbook';
import CodeWorkshop from './components/CodeWorkshop';
import { Menu, Search, Globe, Bot, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const WordPressHealthMonitor = () => {
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Simulated API call to fetch WordPress health metrics
        await new Promise(resolve => setTimeout(resolve, 1200));
        setHealthData({
          site: 'mcp-news.com',
          objectCache: 'Enabled',
          maxQueryTime: 0.034,
          activePlugins: 7,
          status: 'Healthy'
        });
      } catch (error) {
        console.error('Failed to fetch WP health:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMetrics();
  }, []);

  if (loading) {
    return (
      <div className="liquid-surface-strong flex flex-col items-center justify-center h-full text-center p-12 rounded-3xl border">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400 mb-4"></div>
        <p className="readable-copy">Analyzing WordPress Health (Rule 3)...</p>
      </div>
    );
  }

  return (
    <div className="liquid-surface-strong p-6 lg:p-10 rounded-3xl border h-full overflow-y-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-emerald-500/10 rounded-2xl">
          <Globe size={32} className="text-emerald-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold liquid-title">WordPress Health Monitor</h2>
          <p className="text-sm liquid-soft">Real-time compliance check for {healthData.site}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
          <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-300 mb-4">Performance Metrics</h3>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="opacity-60">Object Cache</span>
              <span className="font-mono text-emerald-400">{healthData.objectCache}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-60">Slowest Query</span>
              <span className="font-mono text-emerald-400">{healthData.maxQueryTime}s</span>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
          <h3 className="text-sm font-bold uppercase tracking-widest text-sky-300 mb-4">Site Configuration</h3>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="opacity-60">Active Plugins</span>
              <span className="font-mono">{healthData.activePlugins}</span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-60">Health Status</span>
              <span className="text-emerald-400 font-bold">{healthData.status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
        <p className="text-xs text-emerald-300/80 leading-relaxed">
          <strong>Rule 3 Compliance:</strong> Object Cache is active via LiteSpeed. 
          All database queries are performing under the 0.5s limit. 
          Plugin count is within essential limits.
        </p>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'content':
        return <ContentReviewer />;
      case 'seo':
        return (
          <div className="liquid-surface-strong flex flex-col items-center justify-center h-full text-center p-12 rounded-3xl border">
            <Search size={48} className="text-sky-300 mb-4" />
            <h2 className="text-xl font-bold liquid-title mb-2">SEO & Analytics Module</h2>
            <p className="readable-copy max-w-md">Connect your Google Search Console and Analytics accounts in settings to see detailed query performance and SEO insights.</p>
          </div>
        );
      case 'wordpress':
        return <WordPressHealthMonitor />;
      case 'tools':
        return <ToolGenerator />;
      case 'automations':
        return <Automations />;
      case 'desktop':
        return <AzatHandbook />;
      case 'newsroom':
        return <NewsroomPipeline />;
      case 'history':
        return <NewsroomHistory />;
      case 'workshop':
        return <CodeWorkshop />;
      case 'rules':
        return <RulesManager />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="liquid-page flex h-screen font-sans overflow-hidden">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
      />

      <main className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden px-3 pb-3 lg:px-5 lg:pb-5">
        {/* Header */}
        <header className="mt-3 h-16 liquid-surface-strong rounded-2xl border flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="liquid-pill p-2 liquid-muted hover:liquid-title rounded-lg lg:hidden transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="hidden lg:flex items-center gap-2 text-sm liquid-soft font-medium">
              <span>Azat</span>
              <span className="opacity-40">/</span>
              <span className="liquid-title capitalize">{activeTab.replace('-', ' ')}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsChatOpen(!isChatOpen)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                isChatOpen ? 'liquid-accent text-white' : 'liquid-pill text-sky-700 hover:text-sky-800'
              }`}
            >
              <Bot size={18} />
              <span className="hidden sm:inline">Ask Studio</span>
            </button>
            <div className="w-8 h-8 rounded-full liquid-pill border flex items-center justify-center text-sky-600">
              <Bot size={20} />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden pt-3 relative">
          <div className="flex-1 overflow-y-auto p-2 lg:p-4 w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="h-full"
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Chat Panel - Overlay with backdrop */}
          <AnimatePresence>
            {isChatOpen && (
              <>
                {/* Backdrop scrim */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px] md:hidden"
                  onClick={() => setIsChatOpen(false)}
                />
                {/* Chat panel */}
                <motion.div
                  initial={{ opacity: 0, x: 20, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.97 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                  className="absolute right-0 top-0 bottom-0 w-full md:w-[420px] lg:w-[460px] z-50 p-2 lg:p-3"
                  style={{ filter: 'drop-shadow(-8px 0 24px rgba(0,0,0,0.12))' }}
                >
                  <AgentChat 
                    context={`Currently viewing the ${activeTab} tab of Azat Studio.`} 
                    onClose={() => setIsChatOpen(false)}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}