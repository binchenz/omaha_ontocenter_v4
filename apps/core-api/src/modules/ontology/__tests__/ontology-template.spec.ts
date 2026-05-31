import {
  deIdentifyToTemplate,
  instantiateTemplate,
  ONTOLOGY_SNAPSHOT_VERSION,
  type DeIdentifyInput,
  type OntologySnapshot,
} from '@omaha/shared-types';

function snapshot(): OntologySnapshot {
  return {
    version: ONTOLOGY_SNAPSHOT_VERSION,
    objectTypes: [
      {
        name: 'dish',
        label: '菜品',
        description: '餐厅菜品',
        provenance: 'metadata',
        externalIdCandidates: ['dish_code', 'id'],
        externalId: 'dish_code',
        properties: [
          { name: 'dish_code', label: '编号', type: 'string', provenance: 'metadata' },
          {
            name: 'category',
            label: '分类',
            type: 'string',
            allowedValues: ['热菜', '凉菜', '主食', '汤'],
            allowedValuesUnconfirmed: true,
            provenance: 'heuristic',
            filterable: true,
          },
          { name: 'price', label: '价格', type: 'number', unit: '元' },
        ],
        derivedProperties: [
          { name: 'discounted', label: '折后价', type: 'number', expression: 'price*0.9', provenance: 'heuristic' },
        ],
      },
    ],
    relationships: [
      { name: 'dish_orders', sourceType: 'dish', targetType: 'order', cardinality: 'one-to-many', provenance: 'metadata' },
    ],
  };
}

const input: DeIdentifyInput = {
  name: '餐厅模板',
  description: '餐饮行业通用本体',
  snapshot: snapshot(),
  questionBank: [
    { question: '有多少道菜？', baselineTool: 'aggregate_objects', baselineArgs: { objectType: 'dish', metrics: [{ kind: 'count' }] }, planSummary: '统计 菜品 数量' },
  ],
};

describe('deIdentifyToTemplate — retains business knowledge', () => {
  const tpl = deIdentifyToTemplate(input);

  it('keeps schema structure (types, fields, relationships)', () => {
    expect(tpl.snapshot.objectTypes.map((t) => t.name)).toEqual(['dish']);
    expect(tpl.snapshot.objectTypes[0].properties.map((p) => p.name)).toEqual(['dish_code', 'category', 'price']);
    expect(tpl.snapshot.relationships.map((r) => r.name)).toEqual(['dish_orders']);
  });

  it('keeps semantic annotations (description, unit)', () => {
    const dish = tpl.snapshot.objectTypes[0];
    expect(dish.description).toBe('餐厅菜品');
    expect(dish.properties.find((p) => p.name === 'price')!.unit).toBe('元');
  });

  it('keeps allowedValues value sets (industry common knowledge)', () => {
    const cat = tpl.snapshot.objectTypes[0].properties.find((p) => p.name === 'category')!;
    expect(cat.allowedValues).toEqual(['热菜', '凉菜', '主食', '汤']);
  });

  it('keeps externalId column name', () => {
    expect(tpl.snapshot.objectTypes[0].externalId).toBe('dish_code');
  });

  it('keeps the Evals question bank', () => {
    expect(tpl.questionBank).toHaveLength(1);
    expect(tpl.questionBank[0]).toMatchObject({ question: '有多少道菜？', baselineTool: 'aggregate_objects' });
  });
});

describe('deIdentifyToTemplate — strips client-specific / inference metadata', () => {
  const tpl = deIdentifyToTemplate(input);

  it('drops provenance tags from types, properties, and relationships', () => {
    const dish = tpl.snapshot.objectTypes[0];
    expect((dish as unknown as Record<string, unknown>).provenance).toBeUndefined();
    expect((dish.properties[0] as unknown as Record<string, unknown>).provenance).toBeUndefined();
    expect((tpl.snapshot.relationships[0] as unknown as Record<string, unknown>).provenance).toBeUndefined();
  });

  it('drops the allowedValuesUnconfirmed red flag (curated, not an open question)', () => {
    const cat = tpl.snapshot.objectTypes[0].properties.find((p) => p.name === 'category')!;
    expect((cat as unknown as Record<string, unknown>).allowedValuesUnconfirmed).toBeUndefined();
  });

  it('drops externalIdCandidates (the candidate set is an inference artifact, not knowledge)', () => {
    expect((tpl.snapshot.objectTypes[0] as unknown as Record<string, unknown>).externalIdCandidates).toBeUndefined();
  });

  it('carries no tenant_id and no instance data by shape (template type admits neither)', () => {
    const serialized = JSON.stringify(tpl);
    expect(serialized).not.toContain('tenant_id');
    expect(serialized).not.toContain('tenantId');
  });
});

describe('instantiateTemplate', () => {
  it('produces a draft snapshot isomorphic to reverse-inference output', () => {
    const tpl = deIdentifyToTemplate(input);
    const snap = instantiateTemplate(tpl);
    expect(snap.objectTypes.map((t) => t.name)).toEqual(['dish']);
    expect(snap.objectTypes[0].properties.find((p) => p.name === 'category')!.allowedValues).toEqual(['热菜', '凉菜', '主食', '汤']);
    // Returns a fresh object (not the same reference) so edits don't mutate the template.
    expect(snap).not.toBe(tpl.snapshot);
  });
});
