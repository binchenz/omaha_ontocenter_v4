'use client';

import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, RoleRecord } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddUserModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery<RoleRecord[]>({ queryKey: ['roles'], queryFn: api.listRoles, enabled: open });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.createUser({ name, email, password, roleId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); reset(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const reset = () => { setName(''); setEmail(''); setPassword(''); setRoleId(''); setError(''); };

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); setError(''); mutation.mutate(); };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">添加用户</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="姓名" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="邮箱" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="密码（至少6位）" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
          <select value={roleId} onChange={e => setRoleId(e.target.value)} required className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="">选择角色</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { reset(); onClose(); }} className="flex-1 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">取消</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {mutation.isPending ? '添加中...' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
