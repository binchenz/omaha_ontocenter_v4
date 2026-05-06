import type { OntologySpec } from './ontology-bootstrap';

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
  ],
  relationships: [],
};
