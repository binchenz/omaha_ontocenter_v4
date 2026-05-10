'use client';

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface ConversationSidebarProps {
  conversations: ConversationItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationSidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
}: ConversationSidebarProps) {
  return (
    <div className="w-56 border-r border-gray-200 flex flex-col bg-white hidden lg:flex">
      <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">历史对话</span>
        <button
          onClick={onNew}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          title="新对话"
        >
          ＋
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-4">暂无历史对话</p>
        ) : (
          conversations.map(c => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-2 text-xs truncate hover:bg-gray-50 transition-colors ${
                currentId === c.id ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              {c.title}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
