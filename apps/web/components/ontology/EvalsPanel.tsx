'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, EvalRunResult, EvalNRunResult } from '@/lib/api';

/**
 * Evals panel for the OPC workbench (ADR-0033). Lists the captured question bank and runs a
 * question once (structural score) or the full N times (pass rate, exposing non-determinism).
 * The N-run pass rates feed the soft publish gate.
 */
export function EvalsPanel() {
  const qc = useQueryClient();
  const { data: questions } = useQuery({ queryKey: ['evals'], queryFn: api.listEvals });
  const [results, setResults] = useState<Record<string, EvalRunResult>>({});
  const [nResults, setNResults] = useState<Record<string, EvalNRunResult>>({});

  const run = useMutation({
    mutationFn: (id: string) => api.runEval(id),
    onSuccess: (res) => setResults((prev) => ({ ...prev, [res.questionId]: res })),
  });
  const runN = useMutation({
    mutationFn: (id: string) => api.runEvalN(id, 8),
    onSuccess: (res) => { setNResults((prev) => ({ ...prev, [res.questionId]: res })); qc.invalidateQueries({ queryKey: ['evals'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteEval(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evals'] }),
  });

  if (!questions || questions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        还没有 Evals 基准。在对话中得到正确的查询计划后，点「加入 Evals 基准」即可捕获，无需手写 JSON。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500">Evals 问题库（{questions.length}）· 跑满 N=8 次以暴露非确定性</p>
      {questions.map((q) => {
        const r = results[q.id];
        const nr = nResults[q.id];
        const latestRate = q.passHistory.length > 0 ? q.passHistory[q.passHistory.length - 1] : null;
        return (
          <div key={q.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">{q.question}</p>
                {q.planSummary && <p className="text-xs text-gray-400 truncate">{q.planSummary}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {nr ? (
                  <PassRate rate={nr.passRate} label={`${nr.passes}/${nr.n}`} />
                ) : latestRate !== null ? (
                  <PassRate rate={latestRate} label={`${Math.round(latestRate * 100)}%`} />
                ) : r ? (
                  <span className={`text-xs px-2 py-0.5 rounded ${r.pass ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>{r.pass ? '通过' : '不通过'}</span>
                ) : null}
                <button onClick={() => run.mutate(q.id)} disabled={run.isPending} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">运行一次</button>
                <button onClick={() => runN.mutate(q.id)} disabled={runN.isPending} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{runN.isPending && runN.variables === q.id ? '跑 8 次中...' : '跑 8 次'}</button>
                <button onClick={() => del.mutate(q.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
              </div>
            </div>
            {r && !r.pass && r.diffs.length > 0 && (
              <ul className="mt-2 ml-4 list-disc text-xs text-red-500 space-y-0.5">
                {r.diffs.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PassRate({ rate, label }: { rate: number; label: string }) {
  const color = rate >= 0.8 ? 'bg-emerald-50 text-emerald-600' : rate >= 0.5 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
  return <span className={`text-xs px-2 py-0.5 rounded ${color}`}>通过率 {label}</span>;
}
