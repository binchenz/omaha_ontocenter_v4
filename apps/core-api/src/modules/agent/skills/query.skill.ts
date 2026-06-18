import { AgentSkill, SkillContext } from './skill.interface';

export class QuerySkill implements AgentSkill {
  name = 'query';
  description = '查询和聚合数据：根据自然语言查询对象实例，或对它们做计数/求和/平均等聚合，并在结果适合可视化时生成内联图表。';
  tools = ['query_objects', 'aggregate_objects', 'get_ontology_schema', 'render_chart'];

  systemPrompt(_context: SkillContext): string {
    return `## 查询能力

工作流程：
1. 如果不确定数据结构，先调用 get_ontology_schema 了解可用的对象类型和属性
2. 根据用户问题选工具：
   - 查"列出/详情/某一行" → query_objects
   - 查"几个/多少/总数/平均/最大/最小/分布/排名/汇总" → aggregate_objects
   不要用 query_objects 翻页统计——遇到聚合性问题直接用 aggregate_objects。
3. 用中文总结结果，必要时用表格展示

跨关系聚合（重要）：
当问题形如"每个/各/哪个 <父对象> 的 <子对象指标>"时，指标在子对象上、分组维度在父对象上：
- 聚合【子对象】，用 dot-path groupBy "<关系名>.<父字段>"，指标作用在子对象字段上。
  例：每个 <父对象> 的 <子对象> 数量 → aggregate_objects(<子对象>, groupBy:["<关系名>.<父字段>"], metrics:[{kind:count}])。
- 不要改成聚合父对象、也不要用父对象上的预聚合/汇总字段（如 父对象.子计数、父对象.子合计）来代替——那是冗余快照，未必与子对象明细一致，会算错。
- "哪个 <父对象> 的 <子指标> 最多/最高/最长"是排名问题：必须 groupBy + orderBy(该指标, desc)，不能省略 groupBy 直接聚合（否则得到的是全局合计或父对象计数，而非分组排名）。

效率原则（重要）：
- 拿到 schema 后，一次性规划好所有需要的工具调用，不要反复试探
- 如果一个问题需要多维度分析（如"X和Y有关系吗"），用一次 aggregate_objects 按 X 分组统计 Y 的均值即可得出结论
- 遇到工具报错时，根据错误信息直接修正参数重试，不要重新获取 schema
- 如果数据不足以回答问题，直接告诉用户，不要反复尝试不同查询

注意事项：
- 数据模型中 ✓ = 可过滤，↕ = 可排序，[…] = 单位，{…} = 字段描述
- 只用带 ✓ 的字段做过滤条件
- 只用带 ↕ 的字段做 query_objects 的排序
- query_objects 的 contains 当前对 json/array 字段（如 tags）不工作；遇到 PROPERTY_NOT_FILTERABLE 时改用 search 参数做全文搜索
- aggregate_objects 的 groupBy 同样不支持 json/array 字段（PROPERTY_NOT_GROUPABLE），改用 search 后由 Agent 自己整理
- 过滤的边界要按中文字面严格区分含/不含边界值：
  - "大于/高于/超过 X" → gt（不含 X）；"小于/低于/少于 X" → lt（不含 X）
  - "至少/不少于/不低于 X"、"X 及以上" → gte（含 X）；"至多/最多/不超过/不多于 X"、"X 及以下" → lte（含 X）

可视化（render_chart）：
- 结果适合图表时，先用 query_objects/aggregate_objects 取数，再调 render_chart 渲染内联图表。图表类型选型见 render_chart 工具自身说明。
- 单个标量值（如"总数是多少"）用 kpi 类型，不用 line/bar；数据超过 500 行不画图，直接给表格。
- series.data 传聚合后的数据点（不是原始 instances）；render_chart 后补一句文字说明关键发现。`;
  }
}
