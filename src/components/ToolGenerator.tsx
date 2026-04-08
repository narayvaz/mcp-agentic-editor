import React, { useState } from 'react';
import { Code2, Plus, Play, Trash2, Sparkles } from 'lucide-react';
import { getAgentResponse } from '../services/gemini';

interface Tool {
  id: string;
  name: string;
  description: string;
  code: string;
}

export default function ToolGenerator() {
  const [tools, setTools] = useState<Tool[]>([
    { id: '1', name: 'Headline Optimizer', description: 'Generates 5 catchy headlines for a given topic.', code: '// Headline Optimizer Logic' },
    { id: '2', name: 'Keyword Extractor', description: 'Extracts top 5 keywords from an article.', code: '// Keyword Extractor Logic' }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newToolPrompt, setNewToolPrompt] = useState('');

  const handleGenerate = async () => {
    if (!newToolPrompt.trim()) return;
    setIsGenerating(true);
    
    const prompt = `Create a new tool for our Azat Studio app. 
    The user wants: ${newToolPrompt}
    
    Return a JSON object with:
    {
      "name": "Short Name",
      "description": "Brief description",
      "code": "A mock implementation or logic summary"
    }`;
    
    const result = await getAgentResponse(prompt);
    try {
      const jsonStr = result?.match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        setTools(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            name: parsed.name || 'Generated Tool',
            description: parsed.description || newToolPrompt,
            code: parsed.code || (typeof result === 'string' ? result : '// No code summary returned'),
          },
        ]);
      } else {
        setTools(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            name: `Tool: ${newToolPrompt.slice(0, 32)}`,
            description: newToolPrompt,
            code: typeof result === 'string' ? result : '// No code summary returned',
          },
        ]);
      }
    } catch (e) {
      console.error("Failed to parse tool JSON, using fallback", e);
      setTools(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          name: `Tool: ${newToolPrompt.slice(0, 32)}`,
          description: newToolPrompt,
          code: typeof result === 'string' ? result : '// No code summary returned',
        },
      ]);
    }
    setNewToolPrompt('');
    setIsGenerating(false);
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-serif font-bold text-gray-900">Tool Generator</h2>
        <p className="text-gray-500 text-sm">Create and manage custom agentic tools for your workflow.</p>
      </header>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h3 className="font-bold text-sm uppercase tracking-wider text-gray-400 mb-4">Generate New Tool</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={newToolPrompt}
            onChange={(e) => setNewToolPrompt(e.target.value)}
            placeholder="Describe a tool (e.g., 'A tool that checks for passive voice')..."
            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
          />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !newToolPrompt.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            {isGenerating ? <Sparkles className="animate-spin" size={18} /> : <Plus size={18} />}
            {isGenerating ? 'Generating...' : 'Create Tool'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <div key={tool.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Code2 size={20} />
              </div>
              <div className="flex gap-1">
                <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Play size={16} />
                </button>
                <button 
                  onClick={() => setTools(prev => prev.filter(t => t.id !== tool.id))}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <h4 className="font-bold text-gray-900 mb-1">{tool.name}</h4>
            <p className="text-xs text-gray-500 line-clamp-2 flex-1">{tool.description}</p>
            <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Status: Ready</span>
              <button className="text-xs font-bold text-blue-600 hover:underline">Edit Logic</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
