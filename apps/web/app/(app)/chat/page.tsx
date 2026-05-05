'use client';

import { useState, useRef, useEffect } from 'react';
import { Markdown } from '@/lib/markdown';

interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'confirmation_request' | 'error' | 'done';
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  data?: unknown;
  message?: string;
  conversationId?: string;
  toolName?: string;
  id?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'confirmation';
  content: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  toolResults?: Array<{ name: string; data: unknown }>;
  confirmationId?: string;
  confirmationArgs?: Record<string, unknown>;
  confirmed?: boolean | null;
  fileInfo?: { name: string; size: number };
}

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
  const [resultPanel, setResultPanel] = useState<unknown>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [attachedFile, setAttachedFile] = useState<{ fileId: string; name: string; size: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentToolCall]);

  useEffect(() => {
    loadConversations();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getToken = () => localStorage.getItem('token');

  const loadConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/agent/conversations`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch {}
  };

  const loadConversation = async (id: string) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    setConversationId(id);
    setMessages([]);
    setResultPanel(null);
    try {
      const res = await fetch(`${API_BASE}/agent/conversations/${id}/turns`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const turns = await res.json();
        const msgs: Message[] = turns.map((t: { role: string; content: string | null }) => ({
          role: t.role === 'user' ? 'user' : 'assistant',
          content: t.content ?? '',
        }));
        setMessages(msgs);
      }
    } catch {}
  };

  const startNewConversation = () => { // eslint-disable-line @typescript-eslint/no-unused-vars
    setConversationId(null);
    setMessages([]);
    setResultPanel(null);
  };

  const uploadFile = async (file: File): Promise<{ fileId: string; name: string; size: number } | null> => {
    if (file.size > 50 * 1024 * 1024) {
      alert('文件超过50MB限制，建议使用数据库连接方式导入');
      return null;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      alert('不支持的文件格式，支持: .xlsx, .xls, .csv');
      return null;
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
    if (!res.ok) {
      alert('文件上传失败');
      return null;
    }
    const data = await res.json();
    return { fileId: data.fileId, name: file.name, size: file.size };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadFile(file);
    if (result) setAttachedFile(result);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const result = await uploadFile(file);
    if (result) setAttachedFile(result);
  };

  const handleConfirm = async (confirmationId: string, confirmed: boolean, comment?: string) => {
    setMessages(prev => prev.map(m =>
      m.confirmationId === confirmationId ? { ...m, confirmed } : m
    ));
    setRejectingId(null);
    setRejectComment('');

    try {
      const res = await fetch(`${API_BASE}/agent/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ conversationId, confirmed, comment }),
      });
      if (res.ok && res.headers.get('content-type')?.includes('text/event-stream')) {
        await processSSEStream(res);
      }
    } catch {}
  };

  const processSSEStream = async (res: Response) => {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let assistantContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event: AgentEvent = JSON.parse(line.slice(6));
          handleEvent(event, (content) => { assistantContent = content; });
        } catch {}
      }
    }

    if (assistantContent) {
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);
    }
  };

  const handleEvent = (event: AgentEvent, setContent: (s: string) => void) => {
    switch (event.type) {
      case 'tool_call':
        setCurrentToolCall(`正在调用 ${event.name}...`);
        break;
      case 'tool_result':
        setCurrentToolCall(null);
        setResultPanel(event.data);
        break;
      case 'text':
        setContent(event.content ?? '');
        break;
      case 'confirmation_request':
        setMessages(prev => [...prev, {
          role: 'confirmation',
          content: event.message ?? '',
          confirmationId: event.id,
          confirmationArgs: event.args,
          confirmed: null,
        }]);
        break;
      case 'error':
        setContent(`错误: ${event.message}`);
        break;
      case 'done':
        if (event.conversationId) setConversationId(event.conversationId);
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !attachedFile) || isLoading) return;

    const userMessage = input.trim() || (attachedFile ? `导入文件: ${attachedFile.name}` : '');
    setInput('');
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      fileInfo: attachedFile ? { name: attachedFile.name, size: attachedFile.size } : undefined,
    }]);
    setIsLoading(true);
    setCurrentToolCall(null);

    const fileId = attachedFile?.fileId;
    setAttachedFile(null);

    try {
      const res = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          message: userMessage,
          ...(conversationId ? { conversationId } : {}),
          ...(fileId ? { fileId } : {}),
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));
            handleEvent(event, (content) => { assistantContent = content; });
          } catch {}
        }
      }

      if (assistantContent) {
        setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);
      }
      loadConversations();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => [...prev, { role: 'assistant', content: `连接错误: ${message}` }]);
    } finally {
      setIsLoading(false);
      setCurrentToolCall(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left: Conversation */}
      <div
        className={`flex-1 flex flex-col min-w-0 relative ${isDragOver ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-50/80 z-10 flex items-center justify-center">
            <p className="text-blue-600 font-medium">松开上传文件</p>
          </div>
        )}

        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-900">AI 对话</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg mb-2">你好，有什么可以帮你的？</p>
              <p className="text-sm">试试问：找出华东地区的A级客户</p>
            </div>
          )}
          {messages.map((msg, i) => {
            if (msg.role === 'confirmation') {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="text-xs font-medium text-amber-700 mb-2">需要确认</div>
                    <div className="text-sm text-gray-900 mb-3">
                      <Markdown content={msg.content} />
                    </div>
                    {msg.confirmed === null ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirm(msg.confirmationId!, true)}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                        >
                          确认执行
                        </button>
                        {rejectingId === msg.confirmationId ? (
                          <div className="flex gap-1 flex-1">
                            <input
                              type="text"
                              value={rejectComment}
                              onChange={e => setRejectComment(e.target.value)}
                              placeholder="说明原因（可选）"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                              autoFocus
                            />
                            <button
                              onClick={() => handleConfirm(msg.confirmationId!, false, rejectComment || undefined)}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            >
                              发送
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRejectingId(msg.confirmationId!)}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300 transition-colors"
                          >
                            拒绝
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className={`text-xs font-medium ${msg.confirmed ? 'text-green-600' : 'text-red-600'}`}>
                        {msg.confirmed ? '已确认' : '已拒绝'}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  {msg.fileInfo && (
                    <div className="flex items-center gap-1.5 mb-1 text-xs opacity-75">
                      <span>📎</span>
                      <span>{msg.fileInfo.name}</span>
                    </div>
                  )}
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <Markdown content={msg.content} />
                  )}
                </div>
              </div>
            );
          })}
          {currentToolCall && (
            <div className="flex justify-start">
              <div className="bg-blue-50 text-blue-700 rounded-xl px-4 py-2.5 text-sm animate-pulse">
                {currentToolCall}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attached file indicator */}
        {attachedFile && (
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">📎 {attachedFile.name} ({(attachedFile.size / 1024).toFixed(0)} KB)</span>
            <button onClick={() => setAttachedFile(null)} className="text-xs text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-200">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-2 text-gray-400 hover:text-gray-600 transition-colors"
              title="上传文件"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="输入你的问题..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && !attachedFile)}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '...' : '发送'}
            </button>
          </div>
        </form>
      </div>

      {/* Right: Result Panel */}
      <div className="w-[480px] border-l border-gray-200 overflow-y-auto bg-gray-50 hidden lg:block">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-xs font-medium text-gray-500">查询结果</h2>
        </div>
        <div className="p-4">
          {resultPanel ? (
            <ResultTable data={resultPanel} />
          ) : (
            <p className="text-sm text-gray-400 text-center mt-10">查询结果将显示在这里</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultTable({ data }: { data: unknown }) {
  const typed = data as { data?: Array<{ label: string; properties: Record<string, unknown> }>; meta?: { total: number } };
  if (!typed.data?.length) return <p className="text-sm text-gray-400">无数据</p>;

  const rows = typed.data;
  const keys = Object.keys(rows[0].properties);

  return (
    <div className="overflow-x-auto">
      <div className="text-xs text-gray-500 mb-2">共 {typed.meta?.total ?? rows.length} 条</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-2 font-medium text-gray-600">标签</th>
            {keys.map(k => (
              <th key={k} className="text-left py-2 px-2 font-medium text-gray-600">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-white">
              <td className="py-2 px-2 font-medium text-gray-900">{row.label}</td>
              {keys.map(k => (
                <td key={k} className="py-2 px-2 text-gray-700">{String(row.properties[k] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
