'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ObjectType, Relationship } from '@/lib/api';

function TypeCard({ type, relationships }: { type: ObjectType; relationships: Relationship[] }) {
  const [open, setOpen] = useState(false);
  const outbound = relationships.filter(r => r.sourceType.id === type.id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
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
          {/* Properties */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">属性字段</p>
            <div className="space-y-1">
              {type.properties.map(p => (
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

          {/* Derived Properties */}
          {type.derivedProperties.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">派生属性</p>
              <div className="space-y-1.5">
                {type.derivedProperties.map(d => (
                  <div key={d.name} className="bg-purple-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-purple-700">{d.name}</span>
                      <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">{d.type}</span>
                      <span className="text-xs text-purple-600">{d.label}</span>
                    </div>
                    {d.expression && (
                      <p className="text-xs font-mono text-purple-500 mt-1">{d.expression}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {outbound.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">关联关系</p>
              <div className="space-y-1">
                {outbound.map(r => (
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

export default function OntologyPage() {
  const [search, setSearch] = useState('');

  const { data: types, isLoading: typesLoading } = useQuery({
    queryKey: ['objectTypes'],
    queryFn: api.listObjectTypes,
  });

  const { data: relationships } = useQuery({
    queryKey: ['relationships'],
    queryFn: api.listRelationships,
  });

  const displayTypes = (types ?? [])
    .filter(t => !t.name.includes('probe'))
    .filter(t =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.label.includes(search)
    );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">本体浏览</h1>
          <p className="text-sm text-gray-500 mt-0.5">查看对象类型、字段定义和关联关系</p>
        </div>
        <div className="flex items-center gap-3">
          {types && (
            <span className="text-xs text-gray-400">{displayTypes.length} 个类型</span>
          )}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索类型..."
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-40"
          />
        </div>
      </div>

      {typesLoading && (
        <div className="text-center py-12 text-sm text-gray-400">加载中...</div>
      )}

      <div className="space-y-2">
        {displayTypes.map(type => (
          <TypeCard
            key={type.id}
            type={type}
            relationships={relationships ?? []}
          />
        ))}
      </div>

      {!typesLoading && displayTypes.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">未找到匹配的对象类型</div>
      )}
    </div>
  );
}
