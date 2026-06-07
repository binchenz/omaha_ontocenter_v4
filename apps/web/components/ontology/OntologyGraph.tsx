'use client';

import ReactFlow, { Node, Edge, Background, Controls, MiniMap, useNodesState, useEdgesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { useState } from 'react';
import { ObjectType, Relationship } from '@/lib/api';

interface DetailPanel {
  type: ObjectType;
  relationships: Relationship[];
}

function layoutNodes(types: ObjectType[]): Node[] {
  const cols = Math.ceil(Math.sqrt(types.length)) || 1;
  return types.map((t, i) => ({
    id: t.id,
    position: { x: (i % cols) * 220, y: Math.floor(i / cols) * 140 },
    data: { label: `${t.label}\n${t.name}`, type: t },
    style: {
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      width: 160,
    },
  }));
}

function buildEdges(relationships: Relationship[]): Edge[] {
  return relationships.map((r) => ({
    id: r.id,
    source: r.sourceType.id,
    target: r.targetType.id,
    label: `${r.name} (${r.cardinality})`,
    style: { stroke: '#94a3b8' },
    labelStyle: { fontSize: 10, fill: '#64748b' },
    type: 'smoothstep',
    animated: false,
  }));
}

export function OntologyGraph({ types, relationships }: { types: ObjectType[]; relationships: Relationship[] }) {
  const [nodes, , onNodesChange] = useNodesState(layoutNodes(types));
  const [edges] = useEdgesState(buildEdges(relationships));
  const [detail, setDetail] = useState<DetailPanel | null>(null);

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    const t = types.find(t => t.id === node.id);
    if (t) setDetail({ type: t, relationships: relationships.filter(r => r.sourceType.id === t.id) });
  };

  if (types.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-12">尚未定义对象类型</p>;
  }

  return (
    <div className="flex gap-4 h-[600px]">
      <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {detail && (
        <div className="w-64 border border-gray-200 rounded-xl p-4 overflow-y-auto text-xs space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-900">{detail.type.label}</span>
            <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <p className="text-gray-400 font-mono">{detail.type.name}</p>
          {(detail.type as any).description && <p className="text-gray-500">{(detail.type as any).description}</p>}

          <div>
            <p className="font-medium text-gray-700 mb-1">属性 ({detail.type.properties.length})</p>
            {detail.type.properties.map(p => (
              <div key={p.name} className="flex items-center gap-1 py-0.5">
                <span className="font-mono text-gray-600 w-24 truncate">{p.name}</span>
                <span className="bg-gray-100 text-gray-500 px-1 rounded">{p.type}</span>
              </div>
            ))}
          </div>

          {detail.type.derivedProperties.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 mb-1">派生属性 ({detail.type.derivedProperties.length})</p>
              {detail.type.derivedProperties.map(dp => (
                <div key={dp.name} className="flex items-center gap-1 py-0.5">
                  <span className="inline-flex items-center px-1 rounded text-[10px] bg-purple-50 text-purple-700 border border-purple-200">派生</span>
                  <span className="font-mono text-gray-600">{dp.name}</span>
                </div>
              ))}
            </div>
          )}

          {detail.relationships.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 mb-1">关联关系</p>
              {detail.relationships.map(r => (
                <div key={r.id} className="py-0.5">
                  <span className="font-mono text-gray-600">{r.name}</span>
                  <span className="text-gray-400"> → {r.targetType.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
