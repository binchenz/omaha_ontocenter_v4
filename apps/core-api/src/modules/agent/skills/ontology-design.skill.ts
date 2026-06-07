import { AgentSkill, SkillContext } from './skill.interface';

export class OntologyDesignSkill implements AgentSkill {
  name = 'ontology_design';
  description = '本体设计：创建、修改、删除对象类型和关系，定义 Action 和派生属性，优化本体结构。';
  tools = ['get_ontology_schema', 'create_object_type', 'update_object_type', 'delete_object_type', 'create_relationship', 'delete_relationship', 'create_action', 'execute_action'];

  systemPrompt(_context: SkillContext): string {
    return `## 本体设计能力

当用户要求管理本体结构时，按以下规则操作：

### 语义标注（必须）
创建或修改对象类型时，必须为每个字段推断并填写：
- description：字段的业务含义（一句话，如"订单从商家到客户的直线距离"）
- unit：度量单位（仅数字类型需要，如 km、min、元、个、%）
同时为对象类型本身填写 description（如"配送订单，记录从商家到客户的完整配送过程"）。
根据字段名、类型和上下文自动推断，不需要问用户。

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

### 定义 Action
当用户说"给 X 加一个操作/动作"或"定义一个 Action"时：
- 用 create_action 工具定义 Action
- name 用英文 snake_case（如 mark_as_followed_up）
- label 用中文（如"标记为已跟进"）
- effects 是声明式的：
  - set_field：修改字段值，value 可以是字面量或 { fromParam: "paramName" }
  - create_relationship：创建关系，需要 relationship 名和 targetParam
  - delete_relationship：删除关系
  - create_object：创建新对象，指定 objectType 和 fields
- precondition 用 DSL 表达式约束前置条件（如 "status = '待跟进'"）
- 当 Action 需要引用另一个对象时，用 objectRef 类型的参数

### 执行 Action
当用户说"把 X 标记为 Y"或"对 X 执行 Y 操作"时：
- 先用 query_objects 找到目标对象（得到 objectId）
- 再用 execute_action 执行，传 actionName + objectId + params
- 系统会自动预览变更并请求用户确认

### 派生属性（Computed Properties）
当用户说"给 X 加一个计算字段"或"加一个总销量字段"时：
- 用 update_object_type 的 derivedProperties 参数定义
- expression 用 DSL 语法：
  - 算术：price * quantity
  - 聚合：sum orders.amount, count reviews, avg orders.score
  - 跨关系引用：customer.region
- 示例：{ name: "total_sales", label: "总销量", expression: "sum orders.quantity" }

### 智能建议规则
- 如果用户查询时用了非 filterable 字段做过滤，在结果后建议标记 filterable
- 日期类型字段建议同时标记 filterable + sortable
- 低基数 string 字段（如状态、等级、区域）建议标记 filterable
- 数字字段建议标记 filterable`;
  }
}
