'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ObjectType, Relationship } from '@/lib/api';
import { DraftEditor } from '@/components/ontology/DraftEditor';
import { EvalsPanel } from '@/components/ontology/EvalsPanel';
import { PublishDialog } from '@/components/ontology/PublishDialog';
import { ReverseInferControl } from '@/components/ontology/ReverseInferControl';
import { TemplatesPanel } from '@/components/ontology/TemplatesPanel';
import { OntologyGraph } from '@/components/ontology/OntologyGraph';

function PublishedTypeCard({ type, relationships }: { type: ObjectType; relationships: Relationship[] }) {
  const [open, setOpen] = useState(false);
  const outbound = relationships.filter((r) => r.sourceType.id === type.id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
            {type.label[0]}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{type.label}</p>
            <p className="text-xs text-gray-400 font-mono">{type.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{type.properties.length} 字段</span>
          {type.derivedProperties.length > 0 && (
            <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
              {type.derivedProperties.length} 派生
            </span>
          )}
          <span className={`text-gray-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">属性字段</p>
            <div className="space-y-1">
              {type.properties.map((p) => (
                <div key={p.name} className="flex items-center gap-2 py-1">
                  <span className="text-xs font-mono text-gray-700 w-32 shrink-0">{p.name}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{p.type}</span>
                  <span className="text-xs text-gray-500">{p.label}</span>
                  <div className="flex gap-1 ml-auto">
                    {p.filterable && <span className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">可过滤</span>}
                    {p.sortable && <span className="text-xs bg-green-50 text-green-500 px-1.5 py-0.5 rounded">可排序</span>}
                    {p.required && <span className="text-xs bg-orange-50 text-orange-500 px-1.5 py-0.5 rounded">必填</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {outbound.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">关联关系</p>
              <div className="space-y-1">
                {outbound.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 py-1">
                    <span className="text-xs font-mono text-gray-700">{r.name}</span>
                    <span className="text-gray-300 text-xs">→</span>
                    <span className="text-xs text-gray-600">{r.targetType.label}</span>
                    <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded ml-auto">{r.cardinality}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function OntologyWorkbenchPage() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'list' | 'graph'>('list');
  const qc = useQueryClient();

  const { data: types, isLoading: typesLoading } = useQuery({ queryKey: ['objectTypes'], queryFn: api.listObjectTypes });
  const { data: relationships } = useQuery({ queryKey: ['relationships'], queryFn: api.listRelationships });
  const { data: draftResp } = useQuery({ queryKey: ['draft'], queryFn: api.getDraft });
  const draft = draftResp?.draft ?? null;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['draft'] });
    qc.invalidateQueries({ queryKey: ['objectTypes'] });
    qc.invalidateQueries({ queryKey: ['relationships'] });
  };

  const createDraft = useMutation({ mutationFn: api.createDraft, onSuccess: invalidateAll });
  const discardDraft = useMutation({ mutationFn: api.discardDraft, onSuccess: invalidateAll });
  const [showPublish, setShowPublish] = useState(false);
  const [publishedSummary, setPublishedSummary] = useState<string | null>(null);

  const filterType = (name: string, label: string) =>
    !search || name.toLowerCase().includes(search.toLowerCase()) || label.includes(search);

  const publishedTypes = (types ?? []).filter((t) => !t.name.includes('probe')).filter((t) => filterType(t.name, t.label));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">本体工作台</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {draft ? '编辑草稿，验证后一键发布到运行期' : '查看已发布本体；创建草稿以安全地迭代修改'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
            <button onClick={() => setTab('list')} className={`px-3 py-1.5 ${tab === 'list' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>列表</button>
            <button onClick={() => setTab('graph')} className={`px-3 py-1.5 ${tab === 'graph' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>图谱</button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索类型..."
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-40"
          />
        </div>
      </div>

      {/* Draft control banner */}
      <div className={`mb-5 rounded-xl px-4 py-3 flex items-center justify-between ${draft ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="text-sm">
          {draft ? (
            <span className="text-amber-700">草稿编辑中 · {draft.snapshot.objectTypes.length} 类型 · 更新于 {new Date(draft.updatedAt).toLocaleString()}</span>
          ) : (
            <span className="text-gray-500">当前无草稿，运行期读取已发布本体</span>
          )}
        </div>
        <div className="flex gap-2">
          {!draft && (
            <button
              onClick={() => createDraft.mutate()}
              disabled={createDraft.isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {createDraft.isPending ? '创建中...' : '从已发布创建草稿'}
            </button>
          )}
          <ReverseInferControl hasDraft={!!draft} />
          {draft && (
            <>
              <button
                onClick={() => setShowPublish(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
              >
                发布草稿
              </button>
              <button
                onClick={() => { if (confirm('确定丢弃草稿？所有未发布修改将回滚。')) discardDraft.mutate(); }}
                disabled={discardDraft.isPending}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                丢弃草稿
              </button>
            </>
          )}
        </div>
      </div>

      {publishedSummary && (
        <div className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {publishedSummary}
        </div>
      )}

      {showPublish && (
        <PublishDialog
          onClose={() => setShowPublish(false)}
          onPublished={() => { setShowPublish(false); setPublishedSummary('发布成功，草稿已清空。'); }}
        />
      )}

      {typesLoading && <div className="text-center py-12 text-sm text-gray-400">加载中...</div>}

      {tab === 'graph' ? (
        <OntologyGraph types={types ?? []} relationships={relationships ?? []} />
      ) : draft ? (
        <DraftEditor key={draft.updatedAt} draft={draft} search={search} />
      ) : (
        <div className="space-y-2">
          {publishedTypes.map((t) => (
            <PublishedTypeCard key={t.id} type={t} relationships={relationships ?? []} />
          ))}
        </div>
      )}

      {!typesLoading && !draft && publishedTypes.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">未找到匹配的对象类型</div>
      )}

      <div className="mt-8 border-t border-gray-100 pt-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">准确率 Evals</h2>
        <EvalsPanel />
      </div>

      <div className="mt-8 border-t border-gray-100 pt-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">模板库</h2>
        <TemplatesPanel />
      </div>
    </div>
  );
}
