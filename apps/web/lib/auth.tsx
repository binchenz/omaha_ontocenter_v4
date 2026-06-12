'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, User } from './api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  tenantSlug: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      try {
        const status = await api.setupStatus();
        if (!status.initialized) {
          if (pathname !== '/setup') router.replace('/setup');
          return;
        }
        setTenantSlug(status.slug ?? null);
        if (pathname === '/setup') { router.replace('/login'); return; }
        const stored = localStorage.getItem('token');
        if (stored) {
          setToken(stored);
          const me = await api.me().catch(() => { localStorage.removeItem('token'); return null; });
          if (me) setUser(me);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    if (!tenantSlug) throw new Error('系统尚未初始化，请刷新页面');
    const res = await api.login(tenantSlug, email, password);
    localStorage.setItem('token', res.accessToken);
    setToken(res.accessToken);
    setUser(await api.me());
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, tenantSlug, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

