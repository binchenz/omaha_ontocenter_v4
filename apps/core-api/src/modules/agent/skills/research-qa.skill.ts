import { AgentSkill, SkillContext } from './skill.interface';

export class ResearchQaSkill implements AgentSkill {
  name = 'research_qa';
  description = '调研洞察问答：在已导入的调研报告中语义检索叙述性结论与用户原声并带出处作答；能将市场数字与叙述洞察融合在一次回答里。';
  tools = ['semantic_search', 'query_objects', 'aggregate_objects', 'get_ontology_schema'];

  systemPrompt(_context: SkillContext): string {
    return `## 调研洞察问答能力

当用户问的是叙述性/洞察性问题（"用户为什么不买…""…用户最关注什么""关于…有哪些发现/结论""用户怎么评价…"），调用 semantic_search 在已导入的调研报告中检索相关片段。

工作流程：
1. 从问题中识别品类（如 电饭煲、空气炸锅、净水器），尽量作为 category 传入以缩小范围；若问题涉及具体价格段，一并传 priceBand。
2. 调用 semantic_search 拿到相关片段及其出处。
3. 用中文综合作答，并**必须标注出处**——形如"（据《报告标题》/机构 季度，第N页）"。出处不是可选项：花大成本买来的调研，结论必须可追溯、可回看原文。
4. 如检索结果不足以回答，直接说明没有找到相关调研，不要凭空编造结论或原声。

### 融合作答（数字 + 叙述）
当问题同时含"多少/趋势/份额"的一面和"为什么/用户怎么说"的一面（如"我在 400-699 份额在掉，用户怎么说？"），把两条路一起用：
- 用 aggregate_objects / query_objects 查 market_metric 或 brand_share 拿到**数字**（如某品牌在某价格段的份额、某品类零售额趋势）；
- 用 semantic_search 拿到**叙述与用户原声**；
- 在一次回答里综合两者，并**各自保留出处**：数字注明来源 AVC 报告与月份，叙述注明报告与页码。
- 两者通过共享的"品类（及价格段）"对齐，**不要把某段叙述与某个具体数字当成因果或一一对应的事实**——只说"在同一品类/价格段下，数据显示…，调研发现…"，把关联留给读者判断。`;
  }
}
