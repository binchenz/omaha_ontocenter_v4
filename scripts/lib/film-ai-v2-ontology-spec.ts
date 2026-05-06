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
        { name: 'title', label: '标题', type: 'string' },
        { name: 'user_id', label: '上传者', type: 'string' },
        { name: 'total_chars', label: '总字数', type: 'number' },
        { name: 'chapter_count', label: '章节数', type: 'number' },
        { name: 'status', label: '状态', type: 'string' },
        { name: 'created_at', label: '创建时间', type: 'date' },
        { name: 'overall_score', label: '综合评分', type: 'number' },
        { name: 'adaptation_score', label: '改编评分', type: 'number' },
        { name: 'data_completeness', label: '数据完整度', type: 'number' },
        { name: 'analysis_mode', label: '分析模式', type: 'string' },
        { name: 'tags', label: '题材标签', type: 'json' },
        { name: 'tone', label: '基调', type: 'string' },
        { name: 'pace', label: '节奏描述', type: 'string' },
        { name: 'pov', label: '视角', type: 'string' },
        { name: 'sentence', label: '语言风格', type: 'string' },
        { name: 'market_overall', label: '市场综合分', type: 'number' },
        { name: 'market_comparison', label: '市场对比', type: 'string' },
        { name: 'pace_type', label: '节奏类型', type: 'string' },
        { name: 'avg_tension', label: '平均张力', type: 'number' },
        { name: 'peak_chapter', label: '高潮章节', type: 'string' },
        { name: 'structure_template', label: '结构模板', type: 'string' },
        { name: 'structure_type', label: '结构类型', type: 'string' },
      ],
    },
  ],
  relationships: [],
};
