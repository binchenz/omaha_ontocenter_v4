'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Reverse-inference trigger for the workbench (ADR-0032). Pick a database connector and
 * infer a provenance-tagged draft ontology in one shot. When a Draft already exists, the
 * inference merges into it (incremental re-entry, #74) so client data can be onboarded in
 * waves; otherwise it seeds a fresh Draft.
 */
export function ReverseInferControl({ hasDraft }: { hasDraft: boolean }) {
  const qc = useQueryClient();
  const [connectorId, setConnectorId] = useState('');
  const { data: connectors } = useQuery({ queryKey: ['connectors'], queryFn: api.listConnectors });

  const infer = useMutation({
    mutationFn: () => api.reverseInfer(connectorId, hasDraft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['draft'] }),
  });

  const dbConnectors = (connectors ?? []).filter((c) => c.type === 'postgresql' || c.type === 'mysql');
  if (dbConnectors.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={connectorId}
        onChange={(e) => setConnectorId(e.target.value)}
        className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 max-w-[140px]"
      >
        <option value="">选择数据库…</option>
        {dbConnectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button
        onClick={() => infer.mutate()}
        disabled={!connectorId || infer.isPending}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        title="读取外键/唯一索引/列类型，产出带「铁/猜」标记的草稿"
      >
        {infer.isPending ? '反推中...' : hasDraft ? '反推并合并入草稿' : '整库反推为草稿'}
      </button>
      {infer.isError && <span className="text-xs text-red-500">{(infer.error as Error).message}</span>}
      {infer.isSuccess && <span className="text-xs text-emerald-600">✓ {infer.data.stats.tables} 类型 / {infer.data.stats.relationships} 关系</span>}
    </div>
  );
}
