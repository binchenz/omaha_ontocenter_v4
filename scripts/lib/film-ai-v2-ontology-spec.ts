import type { OntologySpec } from './ontology-bootstrap';

export const FILM_AI_TENANT_SLUG = 'drama_co';
export const FILM_AI_TENANT_NAME = 'Drama Co (短剧公司)';
export const FILM_AI_ADMIN_EMAIL = 'admin@drama-co.local';

// v1 ObjectType names that must be cleaned up before v2 ingest.
// They were created by the old import-film-ai.ts (slices #11–#15).
export const V1_OBJECT_TYPES_TO_CLEANUP = [
  'Item',
  'TimelineEvent',
  'Foreshadowing',
  'Episode',
  'CharacterRelation',
  'Chapter',
  'PlotOutline',
  'Character',
  'Novel',
];

export const filmAiV2OntologySpec: OntologySpec = {
  objectTypes: [
    {
      name: 'Book',
      label: '书',
      properties: [
        { name: 'title', label: '标题', type: 'string', filterable: true },
        { name: 'user_id', label: '上传者', type: 'string', filterable: true },
        { name: 'total_chars', label: '总字数', type: 'number', filterable: true, sortable: true },
        { name: 'chapter_count', label: '章节数', type: 'number', filterable: true, sortable: true },
        { name: 'status', label: '状态', type: 'string', filterable: true },
        { name: 'created_at', label: '创建时间', type: 'date', sortable: true },
        { name: 'overall_score', label: '综合评分', type: 'number', filterable: true, sortable: true },
        { name: 'adaptation_score', label: '改编评分', type: 'number', filterable: true, sortable: true },
        { name: 'data_completeness', label: '数据完整度', type: 'number', filterable: true },
        { name: 'analysis_mode', label: '分析模式', type: 'string', filterable: true },
        { name: 'tags', label: '题材标签', type: 'json' },
        { name: 'tone', label: '基调', type: 'string', filterable: true },
        { name: 'pace', label: '节奏描述', type: 'string', filterable: true },
        { name: 'pov', label: '视角', type: 'string', filterable: true },
        { name: 'sentence', label: '语言风格', type: 'string' },
        { name: 'market_overall', label: '市场综合分', type: 'number', filterable: true, sortable: true },
        { name: 'market_comparison', label: '市场对比', type: 'string' },
        { name: 'pace_type', label: '节奏类型', type: 'string', filterable: true },
        { name: 'avg_tension', label: '平均张力', type: 'number', filterable: true, sortable: true },
        { name: 'peak_chapter', label: '高潮章节', type: 'string' },
        { name: 'structure_template', label: '结构模板', type: 'string', filterable: true },
        { name: 'structure_type', label: '结构类型', type: 'string', filterable: true },
      ],
    },
  ],
  relationships: [],
};
