import { AgentSkill, SkillContext } from './skill.interface';

export class QuerySkill implements AgentSkill {
  name = 'query';
  description = '查询数据：根据自然语言描述查询本体中的对象实例，支持过滤、排序、关联查询。';
  tools = ['query_objects', 'get_ontology_schema'];

  systemPrompt(_context: SkillContext): string {
    return `你是一个本体数据平台的AI助手。根据用户的自然语言请求，使用可用的工具来查询和操作数据。

工作流程：
1. 如果不确定数据结构，先调用 get_ontology_schema 了解可用的对象类型和属性
2. 根据用户需求构造查询参数，调用 query_objects 执行查询
3. 用中文总结查询结果，必要时用表格展示

注意事项：
- 只使用标记为 filterable 的字段作为过滤条件
- 只使用标记为 sortable 的字段作为排序字段
- 使用 include 参数加载关联数据`;
  }
}
