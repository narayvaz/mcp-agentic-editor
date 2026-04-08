import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Sparkles, Wand2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { buildJsonInit, fetchJson } from '../lib/api';
import { AppConfig, WordPressSiteConfig } from '../types/config';

interface WordPressPostSummary {
  id: number;
  date: string;
  status: string;
  title: string;
  excerpt: string;
  content: string;
  link: string;
}

export default function ContentReviewer() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [posts, setPosts] = useState<WordPressPostSummary[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [review, setReview] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [isLoadingPostContent, setIsLoadingPostContent] = useState(false);
  const [error, setError] = useState('');
  const [postsVersion, setPostsVersion] = useState(0);

  const selectedSite = useMemo<WordPressSiteConfig | null>(() => {
    if (!config) return null;
    return config.wordpressSites.find((site) => site.id === selectedSiteId) || null;
  }, [config, selectedSiteId]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const nextConfig = await fetchJson<AppConfig>('/api/settings');
        setConfig(nextConfig);
        const initialSiteId = nextConfig.activeSiteId || nextConfig.wordpressSites[0]?.id || '';
        setSelectedSiteId(initialSiteId);
        setError('');
      } catch (loadError) {
        setError(String(loadError));
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setPosts([]);
      setSelectedPostId(null);
      return;
    }

    const loadPosts = async () => {
      setIsLoadingPosts(true);
      try {
        const payload = await fetchJson<{ posts: WordPressPostSummary[] }>(`/api/wp/posts?siteId=${encodeURIComponent(selectedSiteId)}&perPage=20`);
        setPosts(payload.posts || []);
        if (payload.posts?.length) {
          setSelectedPostId(payload.posts[0].id);
        } else {
          setSelectedPostId(null);
        }
        setError('');
      } catch (loadError) {
        setError(String(loadError));
      } finally {
        setIsLoadingPosts(false);
      }
    };

    loadPosts();
  }, [selectedSiteId, postsVersion]);

  useEffect(() => {
    if (!selectedSiteId || !selectedPostId) return;

    const loadPostContent = async () => {
      setIsLoadingPostContent(true);
      try {
        const payload = await fetchJson<{ post: WordPressPostSummary }>(
          `/api/wp/post/${selectedPostId}?siteId=${encodeURIComponent(selectedSiteId)}`,
        );
        const htmlContent = payload.post?.content || '';
        const plainText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        setContent(plainText);
        setError('');
      } catch (loadError) {
        setError(String(loadError));
      } finally {
        setIsLoadingPostContent(false);
      }
    };

    loadPostContent();
  }, [selectedPostId, selectedSiteId]);

  const handleReview = async () => {
    if (!content.trim()) return;
    setIsReviewing(true);
    try {
      const payload = await fetchJson<{ review: string }>(
        '/api/content/review',
        buildJsonInit('POST', {
          siteId: selectedSiteId || undefined,
          postId: selectedPostId || undefined,
          content,
          title: posts.find((post) => post.id === selectedPostId)?.title || undefined,
        }),
      );
      setReview(payload.review || 'Review failed.');
      setError('');
    } catch (reviewError) {
      setError(String(reviewError));
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-gray-900">Content Reviewer</h2>
          <p className="text-gray-500 text-sm">Review existing WordPress articles or custom text against your MCP rules.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setContent('')}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleReview}
            disabled={isReviewing || !content.trim()}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
          >
            {isReviewing ? <Sparkles className="animate-spin" size={18} /> : <Wand2 size={18} />}
            {isReviewing ? 'Analyzing...' : 'Run AI Review'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-sm p-4 rounded-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-100">
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">WordPress Site</label>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
          >
            {!config?.wordpressSites?.length && <option value="">No sites configured</option>}
            {config?.wordpressSites?.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} ({site.baseUrl})
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100">
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Article</label>
          <div className="flex gap-2">
            <select
              value={selectedPostId || ''}
              onChange={(e) => setSelectedPostId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
            >
              {!posts.length && <option value="">No posts loaded</option>}
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  #{post.id} {post.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => setPostsVersion((prev) => prev + 1)}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              title="Refresh posts"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 text-xs text-gray-500">
          {selectedSite ? (
            <>
              Source: <span className="font-semibold text-gray-700">{selectedSite.baseUrl}</span>
              <br />
              {isLoadingPosts ? 'Loading post list...' : `${posts.length} posts loaded`}
              <br />
              {isLoadingPostContent ? 'Loading selected content...' : 'Ready for review'}
            </>
          ) : (
            'Configure at least one WordPress site in Settings.'
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-320px)]">
        <div className="flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <FileText size={18} className="text-gray-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Draft Content</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Select a WordPress post or paste your article here..."
            className="flex-1 p-6 resize-none focus:outline-none text-gray-800 leading-relaxed font-serif text-lg"
          />
        </div>

        <div className="flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <Sparkles size={18} className="text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">AI Analysis & Suggestions</span>
          </div>
          <div className="flex-1 p-6 overflow-y-auto bg-blue-50/20">
            {review ? (
              <div className="prose prose-blue max-w-none">
                <ReactMarkdown>{review}</ReactMarkdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 bg-blue-50 text-blue-200 rounded-full flex items-center justify-center mb-4">
                  <Wand2 size={32} />
                </div>
                <h4 className="text-gray-900 font-bold mb-2">No Analysis Yet</h4>
                <p className="text-gray-500 text-sm max-w-xs">
                  Choose a post or paste text, then click "Run AI Review".
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
