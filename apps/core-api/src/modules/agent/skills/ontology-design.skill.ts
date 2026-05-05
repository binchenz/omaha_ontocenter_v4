import { AgentSkill, SkillContext } from './skill.interface';

export class OntologyDesignSkill implements AgentSkill {
  name = 'ontology_design';
  description = '本体设计：创建、修改、删除对象类型和关系，优化本体结构。';
  tools = ['get_ontology_schema', 'create_object_type', 'update_object_type', 'delete_object_type', 'create_relationship', 'delete_relationship'];

  systemPrompt(_context: SkillContext): string {
    return `## 本体设计能力

当用户要求管理本体结构时，按以下规则操作：

### 修改对象类型
- 先调用 get_ontology_schema 获取当前结构
- 修改属性时，传入完整的属性列表（替换模式）
- 只改 schema 定义，不修改已有数据
- 展示确认计划，说明变更内容

### 删除对象类型
- 先查询该类型有多少条数据
- 在确认计划中展示"将同时软删除 N 条数据"
- 如果该类型被关系引用，建议先删除关系

### 创建关系
- 确认两个类型都存在
- 如果用户没指定基数，主动询问"一对多还是多对多？"
- 关系名称用英文小写+下划线（如 has_orders）

### 智能建议规则
- 如果用户查询时用了非 filterable 字段做过滤，在结果后建议标记 filterable
- 日期类型字段建议同时标记 filterable + sortable
- 低基数 string 字段（如状态、等级、区域）建议标记 filterable
- 数字字段建议标记 filterable`;
  }
}
