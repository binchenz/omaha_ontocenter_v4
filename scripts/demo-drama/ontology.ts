import type { OntologySpec } from '../lib/ontology-bootstrap';

export const dramaOntology: OntologySpec = {
  objectTypes: [
    {
      name: 'episode',
      label: '剧集片段',
      description: '一集短剧片段，包含剧情梗概和镜头统计',
      properties: [
        { name: 'series', type: 'string', label: '剧集', filterable: true, description: '所属剧集名称' },
        { name: 'episodeNo', type: 'string', label: '集号', filterable: true, description: '集号（EP01, EP02…）' },
        { name: 'clipDuration', type: 'number', label: '时长', filterable: true, sortable: true, description: '片段总时长', unit: 's' },
        { name: 'shotCount', type: 'number', label: '镜头数', filterable: true, sortable: true, description: '镜头总数' },
        { name: 'storyline', type: 'string', label: '剧情梗概', description: '剧情梗概' },
      ],
    },
    {
      name: 'shot',
      label: '镜头',
      description: '一个镜头，记录景别、运镜、画面内容和情绪',
      properties: [
        { name: 'shotNum', type: 'number', label: '序号', filterable: true, sortable: true, description: '镜头序号' },
        { name: 'startTime', type: 'number', label: '开始时间', filterable: true, sortable: true, description: '镜头起始时间', unit: 's' },
        { name: 'endTime', type: 'number', label: '结束时间', filterable: true, sortable: true, description: '镜头结束时间', unit: 's' },
        { name: 'duration', type: 'number', label: '时长', filterable: true, sortable: true, description: '镜头时长', unit: 's' },
        { name: 'scene', type: 'string', label: '场景', filterable: true, description: '场景/地点' },
        { name: 'shotSize', type: 'string', label: '景别', filterable: true, description: '景别（大全景/全景/中景/近景/特写）' },
        { name: 'angle', type: 'string', label: '角度', filterable: true, description: '镜头角度' },
        { name: 'movement', type: 'string', label: '运镜', filterable: true, description: '镜头运动方式' },
        { name: 'subject', type: 'string', label: '主体', filterable: true, description: '画面主体' },
        { name: 'action', type: 'string', label: '动作', description: '人物动作' },
        { name: 'dialogue', type: 'string', label: '台词', filterable: true, description: '台词' },
        { name: 'narration', type: 'string', label: '旁白', description: '旁白' },
        { name: 'subtitle', type: 'string', label: '字幕', description: '字幕/文字' },
        { name: 'audio', type: 'string', label: '音效', description: '音效描述' },
        { name: 'mood', type: 'string', label: '情绪', filterable: true, description: '情绪氛围' },
      ],
    },
  ],
  relationships: [
    { sourceType: 'episode', targetType: 'shot', name: 'episode_shots', cardinality: 'one-to-many' },
  ],
};
