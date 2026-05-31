'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, DraftRecord, OntologySnapshot, SnapshotObjectType, SnapshotProperty, Provenance } from '@/lib/api';

const PROP_TYPES = ['string', 'number', 'boolean', 'date', 'json'] as const;
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'] as const;

function ProvenanceBadge({ provenance }: { provenance?: Provenance }) {
  if (!provenance) return null;
  const styles: Record<Provenance, string> = {
    metadata: 'bg-emerald-50 text-emerald-600',
    heuristic: 'bg-amber-50 text-amber-600',
    candidate: 'bg-sky-50 text-sky-600',
  };
  const labels: Record<Provenance, string> = { metadata: '铁', heuristic: '猜', candidate: '候选' };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${styles[provenance]}`}>{labels[provenance]}</span>;
}

function FieldEditor({ prop, onChange, onRemove }: { prop: SnapshotProperty; onChange: (p: SnapshotProperty) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1 flex-wrap">
      <input
        value={prop.name}
        onChange={(e) => onChange({ ...prop, name: e.target.value })}
        placeholder="字段名"
        className="text-xs font-mono border border-gray-200 rounded px-1.5 py-0.5 w-28"
      />
      <select
        value={prop.type}
        onChange={(e) => onChange({ ...prop, type: e.target.value })}
        className="text-xs border border-gray-200 rounded px-1 py-0.5"
      >
        {PROP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        value={prop.label}
        onChange={(e) => onChange({ ...prop, label: e.target.value })}
        placeholder="标签"
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-20"
      />
      <input
        value={prop.unit ?? ''}
        onChange={(e) => onChange({ ...prop, unit: e.target.value || undefined })}
        placeholder="单位"
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-14"
      />
      <input
        value={prop.description ?? ''}
        onChange={(e) => onChange({ ...prop, description: e.target.value || undefined })}
        placeholder="描述（语义标注）"
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 flex-1 min-w-[120px]"
      />
      <label className="text-xs text-gray-500 flex items-center gap-1">
        <input type="checkbox" checked={!!prop.filterable} onChange={(e) => onChange({ ...prop, filterable: e.target.checked })} />可过滤
      </label>
      <label className="text-xs text-gray-500 flex items-center gap-1">
        <input type="checkbox" checked={!!prop.sortable} onChange={(e) => onChange({ ...prop, sortable: e.target.checked })} />可排序
      </label>
      <ProvenanceBadge provenance={prop.provenance} />
      <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600 ml-auto">删除</button>
    </div>
  );
}

function TypeEditor({ type, onChange, onRemove }: { type: SnapshotObjectType; onChange: (t: SnapshotObjectType) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const setProp = (i: number, p: SnapshotProperty) => {
    const properties = [...type.properties];
    properties[i] = p;
    onChange({ ...type, properties });
  };
  return (
    <div className="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <button onClick={() => setOpen((v) => !v)} className={`text-gray-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</button>
          <input
            value={type.label}
            onChange={(e) => onChange({ ...type, label: e.target.value })}
            className="text-sm font-medium text-gray-900 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-1 py-0.5"
          />
          <span className="text-xs text-gray-400 font-mono">{type.name}</span>
          <ProvenanceBadge provenance={type.provenance} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{type.properties.length} 字段</span>
          <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600">删除类型</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-amber-100 px-4 py-3 space-y-3">
          <input
            value={type.description ?? ''}
            onChange={(e) => onChange({ ...type, description: e.target.value || undefined })}
            placeholder="对象类型描述"
            className="text-xs border border-gray-200 rounded px-2 py-1 w-full"
          />
          <div className="space-y-1">
            {type.properties.map((p, i) => (
              <FieldEditor
                key={i}
                prop={p}
                onChange={(np) => setProp(i, np)}
                onRemove={() => onChange({ ...type, properties: type.properties.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
          <button
            onClick={() => onChange({ ...type, properties: [...type.properties, { name: '', label: '', type: 'string' }] })}
            className="text-xs px-2 py-1 rounded border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
          >+ 添加字段</button>

          {type.externalIdCandidates && type.externalIdCandidates.length > 0 && (
            <div className="pt-2 border-t border-amber-100">
              <label className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                <span>业务主键 (externalId)：</span>
                <select
                  value={type.externalId ?? ''}
                  onChange={(e) => onChange({ ...type, externalId: e.target.value || undefined })}
                  className="text-xs border border-gray-200 rounded px-1.5 py-0.5"
                >
                  <option value="">（未选择）</option>
                  {type.externalIdCandidates.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-gray-400">从唯一索引候选中选择真正的业务键</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DraftEditor({ draft, search }: { draft: DraftRecord; search: string }) {
  const qc = useQueryClient();
  const [snapshot, setSnapshot] = useState<OntologySnapshot>(draft.snapshot);
  const [dirty, setDirty] = useState(false);

  const update = (next: OntologySnapshot) => { setSnapshot(next); setDirty(true); };

  const save = useMutation({
    mutationFn: () => api.replaceDraft(snapshot),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['draft'] }); },
  });

  const matches = (name: string, label: string) =>
    !search || name.toLowerCase().includes(search.toLowerCase()) || label.includes(search);
  const visibleTypes = snapshot.objectTypes.filter((t) => matches(t.name, t.label));

  const setType = (idx: number, t: SnapshotObjectType) => {
    const objectTypes = [...snapshot.objectTypes];
    objectTypes[idx] = t;
    update({ ...snapshot, objectTypes });
  };

  const addType = () => {
    const name = prompt('新对象类型名（英文标识）');
    if (!name) return;
    update({ ...snapshot, objectTypes: [...snapshot.objectTypes, { name, label: name, properties: [], derivedProperties: [] }] });
  };

  const addRelationship = () => {
    const name = prompt('关系名'); if (!name) return;
    const sourceType = prompt('源类型 name'); if (!sourceType) return;
    const targetType = prompt('目标类型 name'); if (!targetType) return;
    const cardinality = (prompt(`基数 (${CARDINALITIES.join(' / ')})`, 'one-to-many') ?? 'one-to-many') as string;
    update({ ...snapshot, relationships: [...snapshot.relationships, { name, sourceType, targetType, cardinality }] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{dirty ? '有未保存的修改' : '已与服务器同步'}</p>
        <div className="flex gap-2">
          <button onClick={addType} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">+ 对象类型</button>
          <button onClick={addRelationship} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">+ 关系</button>
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="text-xs px-3 py-1 rounded bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40"
          >{save.isPending ? '保存中...' : '保存草稿'}</button>
        </div>
      </div>

      {save.isError && <p className="text-xs text-red-500">{(save.error as Error).message}</p>}

      {visibleTypes.map((t) => {
        const realIdx = snapshot.objectTypes.indexOf(t);
        return (
          <TypeEditor
            key={realIdx}
            type={t}
            onChange={(nt) => setType(realIdx, nt)}
            onRemove={() => update({ ...snapshot, objectTypes: snapshot.objectTypes.filter((_, j) => j !== realIdx) })}
          />
        );
      })}

      {snapshot.relationships.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs font-medium text-gray-500 mb-2">关系</p>
          <div className="space-y-1">
            {snapshot.relationships.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1 text-xs">
                <span className="font-mono text-gray-700">{r.name}</span>
                <span className="text-gray-400">{r.sourceType} → {r.targetType}</span>
                <span className="bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">{r.cardinality}</span>
                <ProvenanceBadge provenance={r.provenance} />
                <button
                  onClick={() => update({ ...snapshot, relationships: snapshot.relationships.filter((_, j) => j !== i) })}
                  className="text-red-400 hover:text-red-600 ml-auto"
                >删除</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
