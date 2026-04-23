import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Sparkles, Wand2, RefreshCw, Globe, Upload } from 'lucide-react';
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
        // Decode HTML entities but keep the code tags so the user can see/edit them
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        // We use innerHTML to get the decoded HTML back out with tags intact
        setContent(doc.body.innerHTML || htmlContent);
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

  const handleUpdate = async () => {
    if (!content.trim() || !selectedPostId || !selectedSiteId) return;
    setIsReviewing(true); // Reusing this loading state
    try {
      await fetchJson(
        `/api/wp/post/${selectedPostId}?siteId=${encodeURIComponent(selectedSiteId)}`,
        buildJsonInit('PUT', { content })
      );
      setReview('✅ Article successfully updated on WordPress!');
      setError('');
    } catch (err) {
      setError(String(err));
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold liquid-title">Content Reviewer</h2>
          <p className="readable-copy text-sm">Review existing WordPress articles or custom text against your MCP rules.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setContent('')}
            className="px-4 py-2 text-sm font-medium liquid-soft hover:liquid-title liquid-pill rounded-xl transition-all"
          >
            Clear
          </button>
          <button
            onClick={handleUpdate}
            disabled={isReviewing || !content.trim() || !selectedPostId}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 hover:scale-[1.02]"
            style={{ background: 'linear-gradient(128deg, #059669, #34d399 55%, #6ee7b7)' , boxShadow: '0 12px 24px rgba(5, 150, 105, 0.28)' }}
          >
            <Upload size={16} />
            Update WordPress
          </button>
          <button
            onClick={handleReview}
            disabled={isReviewing || !content.trim()}
            className="flex items-center gap-2 px-5 py-2 liquid-accent text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:scale-[1.02]"
          >
            {isReviewing ? <Sparkles className="animate-spin" size={18} /> : <Wand2 size={18} />}
            {isReviewing ? 'Processing...' : 'Run AI Review'}
          </button>
        </div>
      </header>

      {error && (
        <div className="liquid-note-error text-sm p-4 rounded-xl flex items-center gap-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="liquid-surface-strong p-4 rounded-2xl border">
          <label className="block text-[10px] font-bold uppercase tracking-widest liquid-soft mb-2">WordPress Site</label>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full px-3 py-2 liquid-input rounded-xl text-sm"
          >
            {!config?.wordpressSites?.length && <option value="">No sites configured</option>}
            {config?.wordpressSites?.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} ({site.baseUrl})
              </option>
            ))}
          </select>
        </div>

        <div className="liquid-surface-strong p-4 rounded-2xl border">
          <label className="block text-[10px] font-bold uppercase tracking-widest liquid-soft mb-2">Article</label>
          <div className="flex gap-2">
            <select
              value={selectedPostId || ''}
              onChange={(e) => setSelectedPostId(Number(e.target.value))}
              className="w-full px-3 py-2 liquid-input rounded-xl text-sm"
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
              className="px-3 py-2 liquid-pill rounded-xl liquid-soft hover:liquid-title transition-colors"
              title="Refresh posts"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="liquid-surface p-4 rounded-2xl border text-xs readable-copy">
          {selectedSite ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Globe size={14} className="text-emerald-600 shrink-0" />
                <span className="font-bold liquid-title">{selectedSite.baseUrl}</span>
              </div>
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
        <div className="flex flex-col liquid-surface-strong rounded-3xl border overflow-hidden">
          <div className="p-4 border-b border-white/30 flex items-center gap-2">
            <FileText size={18} className="liquid-soft" />
            <span className="text-[10px] font-bold uppercase tracking-widest liquid-soft">Draft Content</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Select a WordPress post or paste your article here..."
            className="flex-1 p-6 resize-none focus:outline-none liquid-title leading-relaxed font-serif text-lg bg-transparent"
          />
        </div>

        <div className="flex flex-col liquid-surface-strong rounded-3xl border overflow-hidden">
          <div className="p-4 border-b border-white/30 flex items-center gap-2">
            <Sparkles size={18} className="text-sky-600" />
            <span className="text-[10px] font-bold uppercase tracking-widest liquid-soft">AI Analysis & Suggestions</span>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            {review ? (
              <div className="prose prose-sm max-w-none liquid-title">
                <ReactMarkdown>{review}</ReactMarkdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 liquid-pill rounded-full flex items-center justify-center mb-4">
                  <Wand2 size={32} className="text-sky-400" />
                </div>
                <h4 className="liquid-title font-bold mb-2">No Analysis Yet</h4>
                <p className="readable-copy text-sm max-w-xs">
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
