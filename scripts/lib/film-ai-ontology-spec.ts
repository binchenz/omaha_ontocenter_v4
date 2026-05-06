import type { OntologySpec } from './ontology-bootstrap';
import type { FkSpec } from './fk-to-relationships';

export const FILM_AI_TENANT_SLUG = 'drama_co';
export const FILM_AI_TENANT_NAME = 'Drama Co (短剧公司)';
export const FILM_AI_ADMIN_EMAIL = 'admin@drama-co.local';

export const filmAiOntologySpec: OntologySpec = {
  objectTypes: [
    {
      name: 'Novel',
      label: '小说',
      properties: [
        { name: 'title', label: '标题', type: 'string' },
        { name: 'genre', label: '题材', type: 'string' },
        { name: 'description', label: '简介', type: 'string' },
        { name: 'style_guide', label: '风格指南', type: 'string' },
        { name: 'target_word_count', label: '目标字数', type: 'number' },
        { name: 'target_chapter_count', label: '目标章节数', type: 'number' },
        { name: 'author_user_id', label: '作者用户ID', type: 'string' },
        { name: 'created_at', label: '创建时间', type: 'date' },
        { name: 'updated_at', label: '更新时间', type: 'date' },
      ],
    },
    {
      name: 'Character',
      label: '角色',
      properties: [
        { name: 'name', label: '姓名', type: 'string' },
        { name: 'aliases', label: '别名', type: 'json' },
        { name: 'appearance', label: '外观', type: 'string' },
        { name: 'personality', label: '性格', type: 'string' },
        { name: 'motivation', label: '动机', type: 'string' },
        { name: 'secrets', label: '秘密', type: 'string' },
        { name: 'arc_stage', label: '人物弧线阶段', type: 'string' },
      ],
    },
    {
      name: 'PlotOutline',
      label: '剧情大纲',
      properties: [
        { name: 'seq_order', label: '顺序', type: 'number' },
        { name: 'title', label: '标题', type: 'string' },
        { name: 'goal', label: '目标', type: 'string' },
        { name: 'emotional_beat', label: '情感节点', type: 'string' },
        { name: 'checkpoint', label: '检查点', type: 'boolean' },
        { name: 'content', label: '内容', type: 'string' },
      ],
    },
    {
      name: 'Chapter',
      label: '章节',
      properties: [
        { name: 'seq_order', label: '顺序', type: 'number' },
        { name: 'title', label: '标题', type: 'string' },
        { name: 'status', label: '状态', type: 'string' },
        { name: 'manual_content', label: '手工内容', type: 'string' },
      ],
    },
    {
      name: 'CharacterRelation',
      label: '角色关系',
      properties: [
        { name: 'relation_type', label: '关系类型', type: 'string' },
        { name: 'knowledge_state', label: '知情状态', type: 'string' },
      ],
    },
  ],
  relationships: [
    { sourceType: 'Character', targetType: 'Novel', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'PlotOutline', targetType: 'Novel', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'PlotOutline', targetType: 'PlotOutline', name: 'parent', cardinality: 'one-to-many' },
    { sourceType: 'Chapter', targetType: 'Novel', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'Chapter', targetType: 'PlotOutline', name: 'followsOutline', cardinality: 'one-to-many' },
    { sourceType: 'CharacterRelation', targetType: 'Novel', name: 'belongsTo', cardinality: 'one-to-many' },
    { sourceType: 'CharacterRelation', targetType: 'Character', name: 'from', cardinality: 'one-to-many' },
    { sourceType: 'CharacterRelation', targetType: 'Character', name: 'to', cardinality: 'one-to-many' },
  ],
};

export const filmAiFkSpec: FkSpec = [
  { sourceTable: 'novel_characters', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
  { sourceTable: 'novel_plot_outlines', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
  { sourceTable: 'novel_plot_outlines', sourceColumn: 'parent_id', relationshipName: 'parent', targetTable: 'novel_plot_outlines' },
  { sourceTable: 'novel_chapters', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
  { sourceTable: 'novel_chapters', sourceColumn: 'outline_id', relationshipName: 'followsOutline', targetTable: 'novel_plot_outlines' },
  { sourceTable: 'novel_character_relations', sourceColumn: 'novel_id', relationshipName: 'belongsTo', targetTable: 'novels' },
  { sourceTable: 'novel_character_relations', sourceColumn: 'from_char_id', relationshipName: 'from', targetTable: 'novel_characters' },
  { sourceTable: 'novel_character_relations', sourceColumn: 'to_char_id', relationshipName: 'to', targetTable: 'novel_characters' },
];
