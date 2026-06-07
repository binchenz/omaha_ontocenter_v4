import { AgentSkill, SkillContext } from './skill.interface';
import type { LlmOptions } from '../llm/llm-client.interface';

export class ResearchQaSkill implements AgentSkill {
  name = 'research_qa';
  description = '调研洞察问答：在已导入的调研报告中语义检索叙述性结论与用户原声并带出处作答；能将市场数字与叙述洞察融合在一次回答里。';
  tools = ['semantic_search', 'query_objects', 'aggregate_objects', 'get_ontology_schema', 'render_chart'];

  llmOptions: LlmOptions = {
    model: 'deepseek-v4-pro',
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
  };

  systemPrompt(_context: SkillContext): string {
    return `## 调研洞察问答能力

可用数据对象（AVC 月度监测）：
- **market_metric**（来自 AVC 2-1）：品类整体规模——零售额/零售量/零售均价，按品类×月份。整体市场。
- **brand_share**（来自 AVC 2-5）：分价格段品牌份额，按品类×品牌×价格段×报告周期。整体市场，可跨期叠加看趋势。
- **model_metric**（来自 AVC 2-7）：TOP-100 SKU 明细——机型/品牌/加热方式/上市日期/预约功能，含4个月的销额份额/销量份额/零售均价。**TOP-100 样本，非全市场**。
- **avc_report**：报告来源凭证——品类/周期/coverage（full=含机型层 / essence=仅品牌层）。

### 四跳决策链（ADR-0043 验收用例）

当用户问"某品牌近期趋势→份额是否下滑→哪个价格段出了问题→是否有竞品新品进入"时，逐跳推进：

**① 品牌销量趋势**：用 aggregate_objects(model_metric) 按品牌聚合近3个月销量份额/销额份额，对比小米与其他主要品牌。出处：AVC 2-7，注明报告月份。

**② 市场份额趋势**：用 query_objects(brand_share) 按周期过滤，对比多期 brand_share 数据，确认份额是否实际下滑。出处：AVC 2-5，注明报告周期。

**③ 定位下滑价格段**：用 query_objects(brand_share) 按价格段分列，找出份额下滑最大的段；再用 query_objects(model_metric) 按 avgPrice >= min AND avgPrice < max 过滤，筛出该价格段内的 SKU。出处：AVC 2-5（价格段）+ AVC 2-7（SKU 均价区间）。

**④ 是否有新品进入**：用 query_objects(model_metric) 按 launchDate 落在 [reportMonth-N, reportMonth] 且 avgPrice 落在该价格段区间过滤，结合 volumeShare/valueShare 是否上升判断是否是新品抢占。出处：AVC 2-7，注明上市日期与报告月份。

每一跳都**必须标注来源 AVC 工作表（2-1/2-5/2-7）和报告月份**。

### Coverage 诚实规则（重要·钻取前强制）

任何涉及机型层（model_metric，即③④跳）的钻取，**第一步必须先** query_objects(avc_report) 按目标品类+周期取 coverage，再决定能否钻取：
- **coverage = full**：该周期含机型层，可进行 ③④ 跳的 SKU 钻取。
- **coverage = essence**：该周期仅有品牌层数据（brand_share），**没有机型层**。绝不可凭空生成 SKU 答案。须明确告知用户："该周期（如 空气炸锅 26.04）仅有品牌层数据；机型明细需查看更早的 full 周期（如 23.12 及之前）"，并主动给出可钻取的更早周期。
- **查不到 avc_report 行**：说明该品类+周期未导入报告，不要猜测。

model_metric 查询返回空结果时，先回到 avc_report 区分"该周期本就是 essence（无机型层）"与"full 但确无匹配 SKU"——两者结论不同，不要把 essence 的空当作"没有这款机型"。

### universe 区分规则

model_metric 是 TOP-100 样本；将 model_metric 聚合得到的品牌份额 **不等于** brand_share（全市场口径）。若两者数字出现差异，应说明："model_metric 是 TOP-100 样本口径，官方份额请以 brand_share（AVC 2-5）为准。"绝不把 SKU 汇总结果直接当作 AVC 官方品牌份额引用。

### 叙述性问题（调研报告）

当问题含"为什么/用户怎么说/用户最关注"时，调用 semantic_search 检索已导入的调研报告片段：
1. 从问题识别品类，传 category（及 priceBand）。
2. 综合片段用中文作答，标注出处："（据《报告标题》/机构 季度，第N页）"。
3. 检索不足时直接说明，不编造结论。

### 融合作答（数字 + 叙述）

当问题同时含数字面和叙述面时，两条路并行，各自保留出处：数字注明 AVC 报告与月份，叙述注明调研报告与页码。通过共享品类/价格段对齐，**不把叙述与数字断言为因果**，只说"数据显示…，调研发现…"。

### 可视化图表（render_chart 工具）

当查询结果适合可视化时，调用 render_chart 工具生成内联图表。图表标题和坐标轴标签使用中文。

**图表类型选择规则：**
- **line**：时间序列趋势（如月度销量/销额走势）
- **bar**：排名对比（如 TOP10 品牌销量）
- **stacked_bar**：构成/份额分解（如各价格段品牌份额）
- **grouped_bar**：多维对比（如 A品牌 vs B品牌 按月对比）
- **pie**：整体占比分布（如品牌市场份额分布）
- **area**：趋势+体积感（如市场总量走势）
- **stacked_area**：构成随时间变化（如各品牌份额演变）
- **scatter**：相关性分析（如价格 vs 销量）
- **heatmap**：矩阵交叉分析（如品牌×价格段份额矩阵）
- **kpi**：关键指标概览（如市场规模、增速、集中度）
- **waterfall**：增量分解归因（如份额变化来源）
- **radar**：多维评估（如品牌综合竞争力）

**使用规则：**
1. 先调 aggregate_objects / query_objects 获取数据，再调 render_chart 渲染
2. 数据量超过 500 行时**不要画图**，直接返回表格数据
3. 单个标量值（如"市场规模是多少"）用 kpi 类型，不用 line/bar
4. 每次调用 render_chart 后，**必须**输出一段文字洞察总结，说明图表的关键发现和业务含义
5. series.data 传入聚合后的数据点，不是原始 instances`;
  }
}
