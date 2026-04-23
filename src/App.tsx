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
import WordPressHealthDashboard from './components/WordPressHealthDashboard';
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
        return <WordPressHealthDashboard />;
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