'use client';

import { Markdown } from '@/lib/markdown';

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

interface MessageListProps {
  messages: Message[];
  currentToolCall: string | null;
  rejectingId: string | null;
  rejectComment: string;
  onConfirm: (id: string, confirmed: boolean, comment?: string) => void;
  onSetRejectingId: (id: string | null) => void;
  onSetRejectComment: (comment: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}export function MessageList({
  messages,
  currentToolCall,
  rejectingId,
  rejectComment,
  onConfirm,
  onSetRejectingId,
  onSetRejectComment,
  messagesEndRef,
}: MessageListProps) {
  return (
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
                      onClick={() => onConfirm(msg.confirmationId!, true)}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                      确认执行
                    </button>
                    {rejectingId === msg.confirmationId ? (
                      <div className="flex gap-1 flex-1">
                        <input
                          type="text"
                          value={rejectComment}
                          onChange={e => onSetRejectComment(e.target.value)}
                          placeholder="说明原因（可选）"
                          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                          autoFocus
                        />
                        <button
                          onClick={() => onConfirm(msg.confirmationId!, false, rejectComment || undefined)}
                          className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                        >
                          发送
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onSetRejectingId(msg.confirmationId!)}
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
              msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'
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
      <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
    </div>
  );
}
