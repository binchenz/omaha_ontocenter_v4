'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Private template library panel (ADR-0034). Save the current tuned ontology + Evals question
 * bank as a de-identified template, and apply a saved template to instantiate it into a Draft
 * (reusing the reverse-inference Draft path). A private toolbox, not a community marketplace.
 */
export function TemplatesPanel() {
  const qc = useQueryClient();
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates });
  const [name, setName] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['templates'] });
    qc.invalidateQueries({ queryKey: ['draft'] });
    qc.invalidateQueries({ queryKey: ['evals'] });
  };

  const save = useMutation({ mutationFn: () => api.saveTemplate(name.trim()), onSuccess: () => { setName(''); invalidate(); } });
  const apply = useMutation({ mutationFn: (id: string) => api.applyTemplate(id), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => api.deleteTemplate(id), onSuccess: invalidate });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="模板名称"
          className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 flex-1 max-w-[200px]"
        />
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          title="将当前本体（草稿或已发布）+ Evals 问题库脱敏后存为私有模板"
        >{save.isPending ? '保存中...' : '另存为模板'}</button>
      </div>

      {(!templates || templates.length === 0) ? (
        <p className="text-xs text-gray-400">还没有模板。将一个调好的本体存为模板，下次同类客户可一键套用。</p>
      ) : (
        <div className="space-y-1.5">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">{t.name}</p>
                <p className="text-xs text-gray-400">{t.typeCount} 类型 · {t.questionCount} Evals</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {apply.isSuccess && apply.variables === t.id && (
                  <span className="text-xs text-emerald-600">✓ 已套用为草稿</span>
                )}
                <button
                  onClick={() => { if (confirm('套用模板将覆盖当前草稿。继续？')) apply.mutate(t.id); }}
                  disabled={apply.isPending}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >套用为草稿</button>
                <button onClick={() => del.mutate(t.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
