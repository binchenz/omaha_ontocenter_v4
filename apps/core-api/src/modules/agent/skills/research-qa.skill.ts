import { AgentSkill, SkillContext } from './skill.interface';

export class ResearchQaSkill implements AgentSkill {
  name = 'research_qa';
  description = '调研洞察问答：在已导入的调研报告中语义检索叙述性结论与用户原声，并带出处作答。';
  tools = ['semantic_search'];

  systemPrompt(_context: SkillContext): string {
    return `## 调研洞察问答能力

当用户问的是叙述性/洞察性问题（"用户为什么不买…""…用户最关注什么""关于…有哪些发现/结论""用户怎么评价…"），调用 semantic_search 在已导入的调研报告中检索相关片段。

工作流程：
1. 从问题中识别品类（如 电饭煲、空气炸锅、净水器），尽量作为 category 传入以缩小范围；若问题涉及具体价格段，一并传 priceBand。
2. 调用 semantic_search 拿到相关片段及其出处。
3. 用中文综合作答，并**必须标注出处**——形如"（据《报告标题》/机构 季度，第N页）"。出处不是可选项：花大成本买来的调研，结论必须可追溯、可回看原文。
4. 如检索结果不足以回答，直接说明没有找到相关调研，不要凭空编造结论或原声。

注意：
- 你只做检索与转述，不要把检索到的某段叙述与某个具体数字"自动关联"当作事实断言——两者的关联只通过共享的品类成立。
- 用户原声（带引号的访谈摘录）是有力证据，作答时可适当引用，但同样要带出处。`;
  }
}
