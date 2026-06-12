'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, UserRecord } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AddUserModal } from '@/components/users/add-user-modal';

export default function UsersSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: api.listUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onSettled: () => setDeletingId(null),
  });

  const handleDelete = (id: string) => {
    if (!confirm('确认删除该用户？')) return;
    setDeletingId(id);
    deleteMutation.mutate(id);
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-base font-semibold text-gray-900">用户管理</h1>
        <button onClick={() => setModalOpen(true)} className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
          添加用户
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">姓名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">邮箱</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">角色</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600">{u.roleName}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(u.id)}
                      disabled={u.id === user?.id || deletingId === u.id}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
