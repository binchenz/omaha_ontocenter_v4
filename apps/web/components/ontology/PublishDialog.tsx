'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, SnapshotChange } from '@/lib/api';

/**
 * Publish preflight dialog (ADR-0031 informed gate). Runs the preflight on open, shows
 * each change classified safe/breaking with affected-instance counts, and requires the
 * OPC to explicitly confirm when breaking changes are present before publish proceeds.
 * Reused shape as the Evals soft gate (#75): compute impact → OPC confirms.
 */
export function PublishDialog({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const qc = useQueryClient();
  const [ack, setAck] = useState(false);
  const [evalAck, setEvalAck] = useState(false);

  const { data: pre, isLoading } = useQuery({ queryKey: ['preflight'], queryFn: api.preflightDraft });
  const { data: gate } = useQuery({ queryKey: ['softgate'], queryFn: () => api.evalSoftGate() });

  const publish = useMutation({
    mutationFn: () => api.publishDraft(pre?.hasBreaking ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['draft'] });
      qc.invalidateQueries({ queryKey: ['objectTypes'] });
      qc.invalidateQueries({ queryKey: ['relationships'] });
      onPublished();
    },
  });

  const breaking = (pre?.changes ?? []).filter((c) => c.tier === 'breaking');
  const safe = (pre?.changes ?? []).filter((c) => c.tier === 'safe');
  const needsEvalAck = gate?.requiresAck ?? false;
  const canPublish = (!pre?.hasBreaking || ack) && (!needsEvalAck || evalAck);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">发布预检</h2>
        <p className="text-xs text-gray-500 mb-4">发布只修改 schema，不会改动实例数据。破坏性变更需在确认影响后显式确认。</p>

        {isLoading && <p className="text-sm text-gray-400">计算变更影响中...</p>}

        {pre && pre.changes.length === 0 && <p className="text-sm text-gray-500">没有待发布的变更。</p>}

        {breaking.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-red-600 mb-1">破坏性变更（{breaking.length}）</p>
            <div className="space-y-1">
              {breaking.map((c, i) => <ChangeRow key={i} change={c} breaking />)}
            </div>
          </div>
        )}

        {safe.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-emerald-600 mb-1">安全变更（{safe.length}）</p>
            <div className="space-y-1">
              {safe.map((c, i) => <ChangeRow key={i} change={c} />)}
            </div>
          </div>
        )}

        {pre?.hasBreaking && (
          <label className="flex items-start gap-2 text-xs text-gray-700 mb-4">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span>我已查看上述破坏性变更及其影响实例数，确认继续发布。</span>
          </label>
        )}

        {needsEvalAck && (
          <div className="mb-4">
            <p className="text-xs font-medium text-amber-600 mb-1">Evals 通过率偏低的问题（&lt; {Math.round((gate?.threshold ?? 0.8) * 100)}%）</p>
            <div className="space-y-1 mb-2">
              {(gate?.belowThreshold ?? []).map((q) => (
                <div key={q.id} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs">
                  <span className="text-gray-700 truncate">{q.question}</span>
                  <span className="text-amber-600 shrink-0">通过率 {q.passRate !== null ? `${Math.round(q.passRate * 100)}%` : '—'}</span>
                </div>
              ))}
            </div>
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={evalAck} onChange={(e) => setEvalAck(e.target.checked)} className="mt-0.5" />
              <span>我已知悉上述问题的查询计划不稳定，仍选择发布。</span>
            </label>
          </div>
        )}

        {publish.isError && <p className="text-xs text-red-500 mb-2">{(publish.error as Error).message}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100">取消</button>
          <button
            onClick={() => publish.mutate()}
            disabled={!canPublish || publish.isPending || (pre?.changes.length ?? 0) === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
          >{publish.isPending ? '发布中...' : '确认发布'}</button>
        </div>
      </div>
    </div>
  );
}

function ChangeRow({ change, breaking }: { change: SnapshotChange; breaking?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs ${breaking ? 'bg-red-50' : 'bg-gray-50'}`}>
      <span className="text-gray-700">{change.detail}</span>
      {breaking && typeof change.impactCount === 'number' && (
        <span className="text-red-600 shrink-0">影响 {change.impactCount} 个实例</span>
      )}
    </div>
  );
}
