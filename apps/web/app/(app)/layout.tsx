'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);

  const nav = [
    { href: '/chat', label: 'AI 对话', icon: '◉' },
    { href: '/query', label: '数据查询', icon: '⊞' },
    { href: '/ontology', label: '本体浏览', icon: '◈' },
  ];

  useEffect(() => {
    if (user) {
      fetch(`${API_BASE}/agent/conversations`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
        .then(r => r.ok ? r.json() : [])
        .then(setConversations)
        .catch(() => {});
    }
  }, [user, pathname]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside className="w-52 shrink-0 bg-white border-r border-gray-100 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gray-900 flex items-center justify-center">
            <span className="text-white text-xs font-bold">OC</span>
          </div>
          <span className="text-sm font-semibold text-gray-900">OntoCenter</span>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-gray-100 text-gray-900 font-medium'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}

        {conversations.length > 0 && pathname.startsWith('/chat') && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="px-3 mb-1 text-xs font-medium text-gray-400">最近对话</div>
            {conversations.slice(0, 10).map(conv => (
              <Link
                key={conv.id}
                href={`/chat?id=${conv.id}`}
                className="block px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded truncate"
              >
                {conv.title || '新对话'}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
            {user?.name?.[0] ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
