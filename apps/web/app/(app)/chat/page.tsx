'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageList } from '@/components/chat/MessageList';
import { InputBar } from '@/components/chat/InputBar';
import { ConversationSidebar } from '@/components/chat/ConversationSidebar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

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
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
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
      if (res.ok) setConversations(await res.json());
    } catch {}
  };

  const loadConversation = async (id: string) => {
    setConversationId(id);
    setMessages([]);
    setResultPanel(null);
    try {
      const res = await fetch(`${API_BASE}/agent/conversations/${id}/turns`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const turns = await res.json();
        setMessages(turns.map((t: { role: string; content: string | null }) => ({
          role: t.role === 'user' ? 'user' : 'assistant',
          content: t.content ?? '',
        })));
      }
    } catch {}
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setResultPanel(null);
  };

  const uploadFile = async (file: File): Promise<{ fileId: string; name: string; size: number } | null> => {
    if (file.size > 50 * 1024 * 1024) { alert('文件超过50MB限制'); return null; }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) { alert('不支持的文件格式'); return null; }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
    if (!res.ok) { alert('文件上传失败'); return null; }
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
    setMessages(prev => prev.map(m => m.confirmationId === confirmationId ? { ...m, confirmed } : m));
    setRejectingId(null);
    setRejectComment('');
    try {
      const res = await fetch(`${API_BASE}/agent/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
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
    if (assistantContent) setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);
  };

  const handleEvent = (event: AgentEvent, setContent: (s: string) => void) => {
    switch (event.type) {
      case 'tool_call': setCurrentToolCall(`正在调用 ${event.name}...`); break;
      case 'tool_result': setCurrentToolCall(null); setResultPanel(event.data); break;
      case 'text': setContent(event.content ?? ''); break;
      case 'confirmation_request':
        setMessages(prev => [...prev, {
          role: 'confirmation', content: event.message ?? '',
          confirmationId: event.id, confirmationArgs: event.args, confirmed: null,
        }]);
        break;
      case 'error': setContent(`错误: ${event.message}`); break;
      case 'done': if (event.conversationId) setConversationId(event.conversationId); break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !attachedFile) || isLoading) return;
    const userMessage = input.trim() || (attachedFile ? `导入文件: ${attachedFile.name}` : '');
    setInput('');
    setMessages(prev => [...prev, {
      role: 'user', content: userMessage,
      fileInfo: attachedFile ? { name: attachedFile.name, size: attachedFile.size } : undefined,
    }]);
    setIsLoading(true);
    setCurrentToolCall(null);
    const fileId = attachedFile?.fileId;
    setAttachedFile(null);
    try {
      const res = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ message: userMessage, ...(conversationId ? { conversationId } : {}), ...(fileId ? { fileId } : {}) }),
      });
      await processSSEStream(res);
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
      <ConversationSidebar
        conversations={conversations}
        currentId={conversationId}
        onSelect={loadConversation}
        onNew={startNewConversation}
      />

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
        <div className="px-4 py-3 border-b border-gray-200">
          <h1 className="text-sm font-semibold text-gray-900">AI 对话</h1>
        </div>
        <MessageList
          messages={messages}
          currentToolCall={currentToolCall}
          rejectingId={rejectingId}
          rejectComment={rejectComment}
          onConfirm={handleConfirm}
          onSetRejectingId={setRejectingId}
          onSetRejectComment={setRejectComment}
          messagesEndRef={messagesEndRef}
        />
        <InputBar
          input={input}
          isLoading={isLoading}
          attachedFile={attachedFile}
          fileInputRef={fileInputRef}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onFileSelect={handleFileSelect}
          onClearFile={() => setAttachedFile(null)}
        />
      </div>

      <div className="w-[480px] border-l border-gray-200 overflow-y-auto bg-gray-50 hidden lg:block">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-xs font-medium text-gray-500">查询结果</h2>
        </div>
        <div className="p-4">
          {resultPanel ? <ResultTable data={resultPanel} /> : (
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标签</TableHead>
            {keys.map(k => <TableHead key={k}>{k}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium text-gray-900">{row.label}</TableCell>
              {keys.map(k => <TableCell key={k} className="text-gray-700">{String(row.properties[k] ?? '')}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
