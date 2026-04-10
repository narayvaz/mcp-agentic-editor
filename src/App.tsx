/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ContentReviewer from './components/ContentReviewer';
import ToolGenerator from './components/ToolGenerator';
import Settings from './components/Settings';
import RulesManager from './components/RulesManager';
import Automations from './components/Automations';
import AgentChat from './components/AgentChat';
import { Menu, Search, Globe, Bot, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
        return (
          <div className="liquid-surface-strong flex flex-col items-center justify-center h-full text-center p-12 rounded-3xl border">
            <Globe size={48} className="text-emerald-300 mb-4" />
            <h2 className="text-xl font-bold liquid-title mb-2">WordPress Health Monitor</h2>
            <p className="readable-copy max-w-md">Real-time monitoring of LiteSpeed Cache, Query Monitor, and core WordPress health. Currently checking mcp-news.com against Section 3 of your MCP Rules...</p>
          </div>
        );
      case 'tools':
        return <ToolGenerator />;
      case 'automations':
        return <Automations />;
      case 'desktop':
        return (
          <div className="liquid-surface-strong p-8 rounded-3xl border space-y-6">
            <div className="flex items-center gap-4">
              <div className="liquid-pill p-3 text-sky-600 rounded-xl">
                <Monitor size={24} />
              </div>
              <div>
                <h3 className="font-bold text-xl liquid-title">Native Desktop Standalone App</h3>
                <p className="text-sm readable-copy">I have added Electron support so you can run this as a real macOS app.</p>
              </div>
            </div>
            <div className="liquid-surface p-6 rounded-2xl border space-y-4">
              <p className="text-sm liquid-title leading-relaxed">
                To turn this project into a standalone <strong>.app</strong> or <strong>.dmg</strong> for your iMac:
              </p>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full liquid-accent text-white flex items-center justify-center text-xs shrink-0">1</div>
                  <p className="text-xs readable-copy">Export the project as a ZIP and unzip it on your iMac.</p>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full liquid-accent text-white flex items-center justify-center text-xs shrink-0">2</div>
                  <p className="text-xs readable-copy">Open Terminal and run <code>npm install</code>.</p>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full liquid-accent text-white flex items-center justify-center text-xs shrink-0">3</div>
                  <p className="text-xs readable-copy">Run <code>npm run electron:build</code> to create the installer.</p>
                </div>
              </div>
              <div className="mt-4 p-4 liquid-pill border rounded-lg">
                <p className="text-[10px] text-sky-700 font-bold">
                  This will create a "release" folder on your iMac containing the standalone application.
                </p>
              </div>
            </div>
          </div>
        );
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
        <div className="flex-1 flex overflow-hidden pt-3">
          <div className="flex-1 overflow-y-auto p-2 lg:p-4">
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

          {/* Side Chat Panel */}
          <AnimatePresence>
            {isChatOpen && (
              <motion.div
                initial={{ x: 400 }}
                animate={{ x: 0 }}
                exit={{ x: 400 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 right-0 w-full sm:w-[400px] z-50 lg:relative lg:z-0 lg:border-l border-white/20 bg-white/30 lg:bg-transparent"
              >
                <div className="h-full p-3 lg:p-4">
                  <AgentChat 
                    context={`Currently viewing the ${activeTab} tab of Azat Studio.`} 
                    onClose={() => setIsChatOpen(false)}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
