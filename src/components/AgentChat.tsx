import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Send,
  Bot,
  User,
  Loader2,
  X,
  Paperclip,
  Music,
  Video,
  FileText,
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Check,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import { getAgentResponse, AgentPart, AgentResearchOptions, SelfModificationExecution } from '../services/gemini';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
  editedAt?: string;
  attachments?: {
    type: 'image' | 'audio' | 'video' | 'file';
    url: string;
    name: string;
  }[];
}

interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  messages: Message[];
}

interface AgentChatProps {
  context?: string;
  onClose?: () => void;
}

interface SelfModProposalResponse {
  ok?: boolean;
  proposalId: string;
  targetFile: string;
  summary: string;
  diffPreview: string;
  approvalCode: string;
  expiresAt: string;
  autoApplied?: boolean;
  backupPath?: string;
  modelUsed?: string;
  warning?: string;
  message?: string;
  execution?: SelfModificationExecution;
}

interface SelfModApplyResponse {
  ok: boolean;
  message: string;
  targetFile?: string;
  backupPath?: string;
  execution?: SelfModificationExecution;
}

interface SelfModAutoResponse {
  ok: boolean;
  message: string;
  targetFile?: string;
  backupPath?: string;
  execution?: SelfModificationExecution;
}

const THREADS_STORAGE_KEY = 'mcp-agent-chat-threads-v2';
const ACTIVE_THREAD_STORAGE_KEY = 'mcp-agent-chat-active-thread-v2';
const LEGACY_HISTORY_STORAGE_KEY = 'mcp-agent-chat-history-v1';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createWelcomeMessage(): Message {
  return {
    id: createId('msg'),
    role: 'agent',
    content: 'Hello! I am your Azat Studio research agent. How can I help you today?',
    createdAt: new Date().toISOString(),
  };
}

function createThread(title = 'New Chat'): ChatThread {
  const now = new Date().toISOString();
  return {
    id: createId('thread'),
    title,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    messages: [createWelcomeMessage()],
  };
}

function buildThreadTitleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New Chat';
  return cleaned.length > 42 ? `${cleaned.slice(0, 42)}...` : cleaned;
}

function formatExecutionAudit(execution?: SelfModificationExecution): string {
  if (!execution) return '';
  const steps = execution.steps.map((step) => {
    const status = step.status === 'ok' ? 'OK' : step.status === 'error' ? 'ERR' : 'SKIP';
    return `- [${status}] ${step.id}: ${step.detail}`;
  });
  return [
    'Execution audit:',
    `- mode: ${execution.mode}`,
    `- target: ${execution.targetFile}`,
    `- backup: ${execution.backupPath || 'not created'}`,
    `- rollback: ${execution.rolledBack ? 'yes' : 'no'}`,
    `- restart scheduled: ${execution.restartScheduled ? 'yes' : 'no'}`,
    `- success: ${execution.success ? 'yes' : 'no'}`,
    ...(execution.error ? [`- error: ${execution.error}`] : []),
    ...(steps.length ? ['- steps:', ...steps] : []),
  ].join('\n');
}

function migrateLegacyMessages(raw: string | null): ChatThread[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      role: 'user' | 'agent';
      content: string;
      attachments?: { type: 'image' | 'audio' | 'video' | 'file'; url: string; name: string }[];
    }>;
    if (!Array.isArray(parsed) || !parsed.length) return [];
    const now = Date.now();
    const messages: Message[] = parsed.map((message, index) => ({
      id: createId(`legacy-${index}`),
      role: message.role,
      content: message.content,
      attachments: message.attachments,
      createdAt: new Date(now + index).toISOString(),
    }));
    const thread = createThread('Migrated Chat');
    thread.messages = messages;
    thread.updatedAt = new Date().toISOString();
    return [thread];
  } catch {
    return [];
  }
}

function normalizeThreads(input: unknown): ChatThread[] {
  if (!Array.isArray(input)) return [];
  const nowIso = new Date().toISOString();
  return input
    .map((candidate): ChatThread | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const maybe = candidate as Partial<ChatThread>;
      const messages = Array.isArray(maybe.messages)
        ? maybe.messages
            .filter((message) => message && typeof message === 'object')
            .map((message) => {
              const typed = message as Partial<Message>;
              return {
                id: typeof typed.id === 'string' ? typed.id : createId('msg'),
                role: typed.role === 'user' ? 'user' : 'agent',
                content: typeof typed.content === 'string' ? typed.content : '',
                createdAt: typeof typed.createdAt === 'string' ? typed.createdAt : nowIso,
                editedAt: typeof typed.editedAt === 'string' ? typed.editedAt : undefined,
                attachments: Array.isArray(typed.attachments) ? typed.attachments : undefined,
              } as Message;
            })
        : [];

      return {
        id: typeof maybe.id === 'string' ? maybe.id : createId('thread'),
        title: typeof maybe.title === 'string' && maybe.title.trim() ? maybe.title : 'New Chat',
        createdAt: typeof maybe.createdAt === 'string' ? maybe.createdAt : nowIso,
        updatedAt: typeof maybe.updatedAt === 'string' ? maybe.updatedAt : nowIso,
        status: maybe.status === 'archived' ? 'archived' : 'active',
        messages: messages.length ? messages : [createWelcomeMessage()],
      };
    })
    .filter((thread): thread is ChatThread => Boolean(thread));
}

export default function AgentChat({ context, onClose }: AgentChatProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<{ file: File; type: 'image' | 'audio' | 'video' | 'file'; preview: string }[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [researchMode, setResearchMode] = useState<AgentResearchOptions>({
    web: true,
    scholar: true,
    notebook: false,
    articleMode: false,
  });
  const [selfModMode, setSelfModMode] = useState(false);
  const [selfModTargetFile, setSelfModTargetFile] = useState('');
  const [selfModProposal, setSelfModProposal] = useState<SelfModProposalResponse | null>(null);
  const [selfModApprovalInput, setSelfModApprovalInput] = useState('');
  const [selfModAutoApplyEnabled, setSelfModAutoApplyEnabled] = useState(false);
  const [isSelfModBusy, setIsSelfModBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedThreads = localStorage.getItem(THREADS_STORAGE_KEY);
      const parsedThreads = storedThreads ? normalizeThreads(JSON.parse(storedThreads)) : [];
      const migratedThreads = parsedThreads.length ? parsedThreads : migrateLegacyMessages(localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY));
      const initialThreads = migratedThreads.length ? migratedThreads : [createThread()];
      setThreads(initialThreads);

      const storedActiveId = localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY) || '';
      const validActive = initialThreads.some((thread) => thread.id === storedActiveId)
        ? storedActiveId
        : initialThreads[0].id;
      setActiveThreadId(validActive);
    } catch {
      const fallback = createThread();
      setThreads([fallback]);
      setActiveThreadId(fallback.id);
    }
  }, []);

  useEffect(() => {
    if (!threads.length) return;
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads.slice(-60)));
      localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, activeThreadId);
    } catch {
      // Ignore localStorage write errors.
    }
  }, [threads, activeThreadId]);

  const activeThread = useMemo(() => {
    return threads.find((thread) => thread.id === activeThreadId) || null;
  }, [threads, activeThreadId]);

  const selectableThreads = useMemo(() => {
    const filtered = threads.filter((thread) => (showArchived ? thread.status === 'archived' : thread.status === 'active'));
    return [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [threads, showArchived]);

  useEffect(() => {
    if (!activeThread) return;
    if (!showArchived && activeThread.status === 'archived') {
      const nextActive = threads.find((thread) => thread.status === 'active');
      if (nextActive) setActiveThreadId(nextActive.id);
    }
  }, [activeThread, showArchived, threads]);

  useEffect(() => {
    if (!activeThread) return;
    if (!showArchived && !selectableThreads.some((thread) => thread.id === activeThread.id)) {
      const fallback = selectableThreads[0] || threads.find((thread) => thread.status === 'active') || threads[0];
      if (fallback) setActiveThreadId(fallback.id);
    }
  }, [activeThread, selectableThreads, showArchived, threads]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [activeThread?.messages.length, isTyping]);

  useEffect(() => {
    setSelfModProposal(null);
    setSelfModApprovalInput('');
  }, [activeThreadId]);

  useEffect(() => {
    const loadSelfModMode = async () => {
      try {
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const payload = (await response.json()) as { selfModification?: { autoApplyEnabled?: boolean } };
        setSelfModAutoApplyEnabled(Boolean(payload.selfModification?.autoApplyEnabled));
      } catch {
        setSelfModAutoApplyEnabled(false);
      }
    };
    loadSelfModMode();
  }, []);

  const updateActiveThread = (updater: (thread: ChatThread) => ChatThread) => {
    if (!activeThread) return;
    setThreads((prev) => prev.map((thread) => (thread.id === activeThread.id ? updater(thread) : thread)));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        let type: 'image' | 'audio' | 'video' | 'file' = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('audio/')) type = 'audio';
        else if (file.type.startsWith('video/')) type = 'video';

        setAttachments((prev) => [
          ...prev,
          {
            file,
            type,
            preview: reader.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const createNewChat = () => {
    const thread = createThread();
    setThreads((prev) => [...prev, thread]);
    setActiveThreadId(thread.id);
    setShowArchived(false);
    setInput('');
    setAttachments([]);
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const toggleArchiveCurrentThread = () => {
    if (!activeThread) return;
    const nextStatus = activeThread.status === 'archived' ? 'active' : 'archived';
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === activeThread.id
          ? { ...thread, status: nextStatus, updatedAt: new Date().toISOString() }
          : thread,
      ),
    );

    if (nextStatus === 'archived' && !showArchived) {
      const fallback = threads.find((thread) => thread.id !== activeThread.id && thread.status === 'active');
      if (fallback) {
        setActiveThreadId(fallback.id);
      } else {
        const created = createThread();
        setThreads((prev) => [...prev, created]);
        setActiveThreadId(created.id);
      }
    }
  };

  const deleteCurrentThread = () => {
    if (!activeThread) return;
    const confirmed = window.confirm(`Delete chat "${activeThread.title}"? This cannot be undone.`);
    if (!confirmed) return;

    const remaining = threads.filter((thread) => thread.id !== activeThread.id);
    if (!remaining.length) {
      const created = createThread();
      setThreads([created]);
      setActiveThreadId(created.id);
      setShowArchived(false);
      return;
    }

    setThreads(remaining);
    const fallback =
      remaining.find((thread) => (showArchived ? thread.status === 'archived' : thread.status === 'active')) ||
      remaining[0];
    setActiveThreadId(fallback.id);
  };

  const beginEditPrompt = (message: Message) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };

  const cancelEditPrompt = () => {
    setEditingMessageId(null);
    setEditingDraft('');
  };

  const saveEditedPrompt = () => {
    if (!activeThread || !editingMessageId) return;
    const nextContent = editingDraft.trim();
    if (!nextContent) return;

    updateActiveThread((thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      messages: thread.messages.map((message) =>
        message.id === editingMessageId
          ? { ...message, content: nextContent, editedAt: new Date().toISOString() }
          : message,
      ),
    }));

    setEditingMessageId(null);
    setEditingDraft('');
  };

  const pushAgentMessage = (content: string) => {
    updateActiveThread((thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      messages: [
        ...thread.messages,
        {
          id: createId('msg'),
          role: 'agent',
          content,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  };

  const applySelfModification = async () => {
    if (!selfModProposal || !selfModApprovalInput.trim()) return;
    setIsSelfModBusy(true);
    try {
      const response = await fetch('/api/self-mod/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: selfModProposal.proposalId,
          approvalCode: selfModApprovalInput.trim(),
        }),
      });
      const payload = (await response.json()) as SelfModApplyResponse;
      if (!response.ok || !payload.ok) {
        pushAgentMessage(`Self-mod apply failed: ${payload.message || 'Unknown error'}`);
        return;
      }
      const audit = formatExecutionAudit(payload.execution);
      pushAgentMessage(
        [payload.message || `Self-mod applied to \`${payload.targetFile || selfModProposal.targetFile}\`.`, audit]
          .filter(Boolean)
          .join('\n\n'),
      );
      setSelfModProposal(null);
      setSelfModApprovalInput('');
      setSelfModMode(false);
    } catch (error) {
      pushAgentMessage(`Self-mod apply failed: ${String(error)}`);
    } finally {
      setIsSelfModBusy(false);
    }
  };

  const handleSend = async () => {
    if (!activeThread) return;
    if (!input.trim() && attachments.length === 0) return;

    const userPrompt = input;
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);

    const userMessage: Message = {
      id: createId('msg'),
      role: 'user',
      content: userPrompt,
      createdAt: new Date().toISOString(),
      attachments: currentAttachments.map((attachment) => ({
        type: attachment.type,
        url: attachment.preview,
        name: attachment.file.name,
      })),
    };

    updateActiveThread((thread) => {
      const isUntitled = thread.title === 'New Chat' || thread.title === 'Migrated Chat';
      const nextTitle = isUntitled && userPrompt.trim() ? buildThreadTitleFromPrompt(userPrompt) : thread.title;
      return {
        ...thread,
        title: nextTitle,
        updatedAt: new Date().toISOString(),
        messages: [...thread.messages, userMessage],
      };
    });

    setIsTyping(true);

    if (selfModMode) {
      setIsSelfModBusy(true);
      try {
        if (!selfModTargetFile.trim()) {
          const response = await fetch('/api/self-mod/auto', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              instruction: userPrompt,
            }),
          });

          const payload = (await response.json()) as SelfModAutoResponse;
          const audit = formatExecutionAudit(payload.execution);
          pushAgentMessage([payload.message || 'Self-mod auto execution completed.', audit].filter(Boolean).join('\n\n'));
          if (payload.ok) {
            setSelfModMode(false);
          }
        } else {
          const response = await fetch('/api/self-mod/propose', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              targetFile: selfModTargetFile.trim(),
              instruction: userPrompt,
              autoApply: selfModAutoApplyEnabled,
            }),
          });

          const payload = (await response.json()) as SelfModProposalResponse;
          if (!response.ok || !payload.proposalId) {
            pushAgentMessage(`Self-mod proposal failed: ${payload.message || 'Unknown error'}`);
            setIsTyping(false);
            setIsSelfModBusy(false);
            return;
          }

          if (payload.autoApplied) {
            setSelfModProposal(null);
            setSelfModApprovalInput('');
            setSelfModMode(false);
            const audit = formatExecutionAudit(payload.execution);
            pushAgentMessage(
              [
                payload.message || `Self-mod auto-applied to \`${payload.targetFile}\`.`,
                audit,
                '',
                `Summary: ${payload.summary}`,
                '',
                'Diff preview:',
                '```diff',
                payload.diffPreview || 'No diff preview',
                '```',
              ].join('\n'),
            );
          } else {
            setSelfModProposal(payload);
            setSelfModApprovalInput('');
            pushAgentMessage(
              [
                `Self-mod proposal ready for \`${payload.targetFile}\`.`,
                '',
                `Summary: ${payload.summary}`,
                `Approval code: \`${payload.approvalCode}\``,
                `Expires: ${new Date(payload.expiresAt).toLocaleString()}`,
                '',
                'Diff preview:',
                '```diff',
                payload.diffPreview || 'No diff preview',
                '```',
              ].join('\n'),
            );
          }
        }
      } catch (error) {
        pushAgentMessage(`Self-mod proposal failed: ${String(error)}`);
      } finally {
        setIsTyping(false);
        setIsSelfModBusy(false);
      }
      return;
    }

    const parts: AgentPart[] = [];
    for (const attachment of currentAttachments) {
      const base64Data = attachment.preview.split(',')[1];
      parts.push({
        inlineData: {
          mimeType: attachment.file.type,
          data: base64Data,
        },
      });
    }

    const recentConversation = [...activeThread.messages.slice(-12), userMessage]
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');
    const mergedContext = [
      context || '',
      recentConversation ? `Recent conversation context:\n${recentConversation}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const response = await getAgentResponse(userPrompt, mergedContext, parts, researchMode);
    const audit = formatExecutionAudit(response.selfModification?.execution);
    pushAgentMessage([response.text || 'No response', audit].filter(Boolean).join('\n\n'));

    setIsTyping(false);
  };

  const renderAttachment = (attachment: { type: 'image' | 'audio' | 'video' | 'file'; url: string; name: string }) => {
    if (attachment.type === 'image') {
      return <img src={attachment.url} alt={attachment.name} className="max-w-[200px] max-h-[200px] object-cover" />;
    }
    if (attachment.type === 'audio') {
      return (
        <div className="p-2 flex items-center gap-2 bg-blue-500/20">
          <Music size={16} />
          <span className="text-[10px] truncate max-w-[100px]">{attachment.name}</span>
        </div>
      );
    }
    if (attachment.type === 'video') {
      return (
        <div className="p-2 flex items-center gap-2 bg-purple-500/20">
          <Video size={16} />
          <span className="text-[10px] truncate max-w-[100px]">{attachment.name}</span>
        </div>
      );
    }
    return (
      <div className="p-2 flex items-center gap-2 bg-gray-500/20">
        <FileText size={16} />
        <span className="text-[10px] truncate max-w-[100px]">{attachment.name}</span>
      </div>
    );
  };

  if (!activeThread) {
    return <div className="h-full flex items-center justify-center text-sm liquid-muted">Loading chat...</div>;
  }

  return (
    <div className="flex flex-col h-full liquid-surface-strong rounded-2xl border overflow-hidden">
      <div className="p-3 border-b border-white/40 bg-white/20 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bot size={18} className="text-sky-600 shrink-0" />
            <h2 className="font-semibold text-xs uppercase tracking-wider liquid-title truncate">Azat Studio Intelligence</h2>
            <span className="px-2 py-0.5 liquid-pill text-emerald-600 text-[8px] font-bold rounded-full border uppercase tracking-widest">
              Multimodal
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 liquid-soft hover:liquid-title hover:bg-white/40 rounded-lg transition-colors"
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={activeThreadId}
            onChange={(e) => setActiveThreadId(e.target.value)}
            className="liquid-input px-2 py-1.5 text-xs rounded-lg flex-1"
          >
            {selectableThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          <button onClick={createNewChat} className="liquid-pill p-2 rounded-lg" title="New chat">
            <Plus size={14} />
          </button>
          <button onClick={toggleArchiveCurrentThread} className="liquid-pill p-2 rounded-lg" title={activeThread.status === 'archived' ? 'Unarchive chat' : 'Archive chat'}>
            {activeThread.status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
          <button onClick={deleteCurrentThread} className="liquid-pill p-2 rounded-lg text-rose-600" title="Delete chat">
            <Trash2 size={14} />
          </button>
        </div>

        <button
          onClick={() => setShowArchived((prev) => !prev)}
          className="text-[10px] liquid-soft hover:liquid-title"
        >
          {showArchived ? 'Viewing archived chats' : 'Viewing active chats'} · Click to switch
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {activeThread.messages.map((msg) => {
            const isEditing = editingMessageId === msg.id;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] p-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'liquid-accent text-white rounded-tr-none shadow-lg'
                      : 'liquid-pill liquid-title rounded-tl-none border border-white/55'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                      <span className="text-[10px] font-bold uppercase tracking-tighter opacity-80">
                        {msg.role === 'user' ? 'You' : 'Agent'}
                      </span>
                      {msg.editedAt && <span className="text-[10px] opacity-70">edited</span>}
                    </div>
                    {msg.role === 'user' && !isEditing && (
                      <button
                        onClick={() => beginEditPrompt(msg)}
                        className="p-1 rounded hover:bg-white/20"
                        title="Edit prompt"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingDraft}
                        onChange={(e) => setEditingDraft(e.target.value)}
                        className="w-full min-h-[90px] px-3 py-2 rounded-lg liquid-input text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button onClick={saveEditedPrompt} className="liquid-pill px-2 py-1 rounded text-xs flex items-center gap-1">
                          <Check size={12} /> Save
                        </button>
                        <button onClick={cancelEditPrompt} className="liquid-pill px-2 py-1 rounded text-xs flex items-center gap-1">
                          <RotateCcw size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`prose prose-sm max-w-none text-sm leading-relaxed ${msg.role === 'user' ? 'prose-invert text-white' : 'liquid-title'}`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.attachments.map((att, idx) => (
                        <div key={`${msg.id}-att-${idx}`} className="relative group rounded-lg overflow-hidden border border-white/20 bg-black/10">
                          {renderAttachment(att)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {isTyping && (
          <div className="flex justify-start">
            <div className="liquid-pill p-3 rounded-2xl rounded-tl-none flex items-center gap-2 border border-white/55">
              <Loader2 size={16} className="animate-spin liquid-soft" />
              <span className="text-xs liquid-muted font-mono">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-white/40 bg-white/20 space-y-3">
        <div className="text-[11px] readable-copy">
          Chat threads are stored locally on this device. You can create, archive, delete, and edit prompts.
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setResearchMode((prev) => ({ ...prev, web: !prev.web }))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
              researchMode.web ? 'liquid-accent text-white' : 'liquid-pill liquid-title'
            }`}
          >
            Web
          </button>
          <button
            onClick={() => setResearchMode((prev) => ({ ...prev, scholar: !prev.scholar }))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
              researchMode.scholar ? 'liquid-accent text-white' : 'liquid-pill liquid-title'
            }`}
          >
            Scholar
          </button>
          <button
            onClick={() => setResearchMode((prev) => ({ ...prev, notebook: !prev.notebook }))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
              researchMode.notebook ? 'liquid-accent text-white' : 'liquid-pill liquid-title'
            }`}
          >
            Notebook
          </button>
          <button
            onClick={() => setResearchMode((prev) => ({ ...prev, articleMode: !prev.articleMode }))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
              researchMode.articleMode ? 'liquid-accent text-white' : 'liquid-pill liquid-title'
            }`}
          >
            Article Mode
          </button>
          <button
            onClick={() => setSelfModMode((prev) => !prev)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border inline-flex items-center gap-1 ${
              selfModMode ? 'liquid-accent text-white' : 'liquid-pill liquid-title'
            }`}
          >
            <Wrench size={11} />
            Self-Modify
          </button>
        </div>

        {selfModMode && (
          <div className="space-y-2 liquid-surface border rounded-xl p-3">
            <div className="text-[10px] liquid-soft uppercase tracking-wider font-bold">Self-mod target file (optional)</div>
            <input
              value={selfModTargetFile}
              onChange={(e) => setSelfModTargetFile(e.target.value)}
              placeholder="Leave empty for automatic file discovery"
              className="w-full px-3 py-2 liquid-input rounded-lg text-xs"
            />
            <p className="text-[11px] liquid-muted">
              Send the change request in chat. If file is empty, the agent will auto-discover the target. Current mode: {selfModAutoApplyEnabled ? 'auto-apply with backup' : 'manual approval'}.
            </p>
          </div>
        )}

        {selfModProposal && (
          <div className="space-y-2 liquid-surface border rounded-xl p-3">
            <div className="text-xs liquid-title font-semibold">Pending Self-Mod Proposal</div>
            <div className="text-[11px] liquid-muted">File: {selfModProposal.targetFile}</div>
            <div className="text-[11px] liquid-muted">Approval code: <code>{selfModProposal.approvalCode}</code></div>
            <div className="flex gap-2">
              <input
                value={selfModApprovalInput}
                onChange={(e) => setSelfModApprovalInput(e.target.value)}
                placeholder="Type approval code to apply"
                className="flex-1 px-3 py-2 liquid-input rounded-lg text-xs"
              />
              <button
                onClick={applySelfModification}
                disabled={isSelfModBusy || !selfModApprovalInput.trim()}
                className="px-3 py-2 liquid-accent text-white rounded-lg text-xs font-bold disabled:opacity-60"
              >
                {isSelfModBusy ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((att, idx) => (
              <div key={`upload-${idx}`} className="relative group">
                <div className="w-16 h-16 rounded-lg border border-white/50 liquid-pill overflow-hidden flex items-center justify-center">
                  {att.type === 'image' ? (
                    <img src={att.preview} alt="preview" className="w-full h-full object-cover" />
                  ) : att.type === 'audio' ? (
                    <Music size={24} className="text-blue-500" />
                  ) : att.type === 'video' ? (
                    <Video size={24} className="text-purple-500" />
                  ) : (
                    <FileText size={24} className="liquid-muted" />
                  )}
                </div>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full shadow-sm hover:bg-red-600 transition-colors"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
            accept="image/*,audio/*,video/*,application/pdf,text/*"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="liquid-pill p-2 liquid-muted hover:text-sky-700 rounded-lg transition-colors"
            title="Attach files"
          >
            <Paperclip size={20} />
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask for checks, web facts, scholar findings, or deep-dive analysis..."
              className="w-full pl-4 pr-12 py-3 liquid-input border rounded-xl focus:outline-none transition-all text-sm liquid-title"
            />
            <button
              onClick={handleSend}
              disabled={isTyping || (!input.trim() && attachments.length === 0)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-sky-700 hover:bg-white/40 rounded-lg transition-colors disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
