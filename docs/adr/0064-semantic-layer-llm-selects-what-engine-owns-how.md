---
status: proposed
extends: 0061
builds-on: 0057, 0043, 0017, 0063
---

# ADR-0064: 语义/指标层 — LLM 只选 "What"，确定性引擎拥有 "How"；数值不过 LLM 的手，覆盖永远问数据

**Status:** Proposed
**Date:** 2026-06-19
**Deciders:** binchenz

## Context

2026-06-19 对正式端点 `/agent/chat` 做了一轮模拟真实用户的 UAT（纯米租户，18 场景 / 25 轮，单轮取数→多轮战略，每个答案对照独立裸 SQL ground-truth；harness=`apps/core-api/scripts/uat-chat-harness.ts`，报告=`CHAT_UAT_REPORT.md`）。结论：核心三件套（query / aggregate / chart，ADR-0063 定性）方向正确、多轮上下文出色、越界零幻觉，但暴露两个会**击穿信任**的正确性缺陷 + 一条 30–60s 时延长尾：

| 现象 | 表面归类 | 真实根因 |
|---|---|---|
| **BUG-1** 零售额 39,012.84 万元被报成 **3,901.28 万元**（÷10）；非确定性，同一对话内 C1 轮1 对、轮2 错、轮3 又对；tool 返回的原始 value 三轮完全相同 | 准确性 | LLM 在**转写数值**——数据和语义都对，纯粹是把 5 位数抄进散文时丢了一位 |
| **BUG-2** 「画电饭煲零售额趋势」答"25.07–25.11 无数据、集中在每年12月"；实际 `market_metric` 有连续 53 个月覆盖（21.12→26.04）；撞满 `MAX_TOOL_ITERATIONS=12`、0 图表 | 准确性 | LLM 在**靠试探猜数据形态**：把 `brand_share`/`avc_report` 的 5 个稀疏年度报告期，误当成 `market_metric` 的月度覆盖期去反推 |
| **时延** 分析类 p90=46s / max=59s；简单查询也走完整 Agent 循环（A4 一个份额查询用了 5 个 tool） | 体验 | LLM 在**用一次次工具往返做规划**：每次 tool_call ≈ 一次完整推理（3–5s），12 次 = 60s |

**核心洞察：三个现象是同一个病根。** 现架构让 LLM 去干了一堆"确定性的数据管道活"——选哪张表、哪列是时间轴、什么颗粒度、覆盖到哪、取数、把数字抄进句子。这些活 LLM 既容易错（准确性塌），又每干一步要一次推理往返（体验塌）。

**这不是新方向，是已确立轨迹的下一步。** ADR-0057 立了"在本体元数据层声明、在编译层强制"（显式参考 Palantir Function-Backed Context：业务规则在 LLM 之前的代码层执行）。ADR-0061（**Proposed**）把 additivity/universe/collapsed 从散文上提为本体一等事实，并把"聚合层强制加权"和"§3 coverage relationship"两个切片**显式留作后续**。ADR-0063 把 chat 定性为只读分析 Agent。ADR-0043 的星型表里**已经有一列 "Time dimension"**，为三星写了不同时间形态（"months across columns" / "one snapshot per report" / "4 months within one report"），但只活在文档里、从未进本体。

本 ADR 把这条轨迹收口：** 0061 从 Proposed 推到完成，并补上它自己列出的两个待办切片。**

## Decision

确立一条北极星原则，并落成五个部件。

> **在 LLM 与数据之间插一层语义/指标层：LLM 只把自然语言翻译成"分析意图"（What）；一个确定性引擎拥有取数、探覆盖、格式化的全部机械活（How），并把数据带着语义标签、格式化好，再交回 LLM。LLM 选 What，引擎管 How，数值永不过 LLM 的手，覆盖永远问数据。**

统一的**准确性定律**：准确性 ∝ 把 LLM 输出空间约束得多窄。`从指标目录里选` > `在受护栏的 DSL 里拼` > `自由生成 SQL/数字`。本 ADR 尽一切可能把"自由生成"降级成"受限选择"。
统一的**体验定律**：关键路径上的 LLM 推理次数 = 延迟。一切优化都是减往返。

### 部件 1 — 时间轴语义 `timeAxis`（扩展 ADR-0061 §2 的 `ObjectTypeSemantics`，与 `universe` 并排）

把 ADR-0043 文档里那列 "Time dimension" 落进本体。它与 `universe` **完全同构**——`universe` 是星的"抽样框"，`timeAxis` 是星的"时间抽样框"，所以挂同一个座、走同一个渲染缝（`SemanticsRenderer`），缺省时零提示词重量。

```typescript
// packages/shared-types/src/ontology.ts — 扩展 0061 已建的 ObjectTypeSemantics
interface ObjectTypeSemantics {
  universe?: 'whole-market' | 'top-sample' | string;   // 0061 §2，已定
  timeAxis?: TimeAxis;                                  // 0064 新增，与 universe 并排
}

interface TimeAxis {
  field: string;                                  // 哪一列是序列轴：'month' / 'period'
  grain: 'month' | 'quarter' | 'year' | 'snapshot';
  format: string;                                 // 怎么读一个值：'YY.MM（26.04 = 2026年4月）'
  density: 'dense' | 'sparse';                     // 预期形态（设计意图，非实际覆盖！）
}
```

AVC 标注：
- `market_metric` → `{ field: 'month', grain: 'month', format: 'YY.MM（26.04=2026年4月）', density: 'dense' }`
- `brand_share` → `{ field: 'period', grain: 'snapshot', format: 'YY.MM', density: 'sparse' }`
- `model_metric` → `{ field: 'month', grain: 'month', density: 'dense', … }`；其 `launchDate` **自然只是普通属性**，不是序列轴——这反过来证明"命名 field"这个决定是对的（设计天然区分了"序列轴"与"事件日期属性"）。

`SemanticsRenderer` 渲染出的 Tier-1 提示行（ADR-0050 fetch-on-need，Tier-0 存在性不截断）：
> market_metric → "时间轴 `month`（月度连续，YY.MM）。画趋势/算环比前先用 aggregate 探出本星实际有哪些 month，按探到的作图；**不要拿别的星（brand_share/avc_report 的年度报告期）反推本星缺失**。"

`format` 这一段顺手钉死了"26.04 = 2026年4月"的读法——堵住一个 BUG-1 同类（"LLM 解读原始值"）的潜在风险，不靠运气。

### 部件 2 — 自描述结果信封（落 ADR-0061 "聚合强制"后续切片，杀 BUG-1）

`query_objects` / `aggregate_objects` 返回的不再是裸 float，而是带语义标签、**已在确定性代码里格式化好**的信封：

```typescript
interface MeasureCell {
  display: string;      // "3.90 亿元"  ← 服务端格式化，唯一允许引用的字段
  raw: number;          // 39012.84
  unit: string;         // "万元"
  metric: string;       // "零售额"
  additivity: Additivity;   // 复用 0061 §1 的 additivity
  universe?: string;        // 复用 0061 §2
  grain?: string; period?: string;   // 来自部件 1
}
```

提示词唯一铁律：**金额一律原样引用 `display`，不准自行换算或重排数字。** BUG-1 **结构性消失**——LLM 根本拿不到那个会被它抄错的 39012.84。语义（可加性/口径/颗粒度）在数据上随每行返回，而非放在一份它可能漏读的系统提示里（**上下文与数据同地**）。

### 部件 3 — `coverage()` 引擎原语（落 ADR-0061 §3 "coverage relationship" 切片，杀 BUG-2；严守 ADR-0043 §2 边界）

把"实际有哪些期"做成引擎一等原语，**实时问数据库**：

```
coverage(metric, dimensionFilters) -> { field, values: string[], min, max, isDense }
```

边界（**与 ADR-0043 §2 一致，不可越界**）：

| | grain / density（**预期形态**） | coverage（**实际有哪些期**） |
|---|---|---|
| 例 | "market_metric 是按月连续设计的" | "电饭煲零售额实际有 21.12…26.04 这 53 个月" |
| 变吗 | 永不变（设计期定死） | **每次 ingest 都变** |
| 归属 | ✅ 本体（部件 1 `timeAxis`） | ✅ **数据**（本原语 + `avc_report` 实例，ADR-0043 §2 已裁定 coverage 盖在 per-report provenance 行上） |

把"覆盖到 26.04"写进本体，下月 ingest 26.05 它立刻馊掉、对真实数据说"没有"——等于换姿势重造 BUG-2。所以协议铁律：**颗粒度读 schema，覆盖问数据；每颗星的覆盖探它自己，别读兄弟星的覆盖表去顶替。**

### 部件 4 — 指标目录 Metric Catalog（把"拼查询"降级成"选指标"；准确性定律的完全体）

预定义命名指标，每个自带全部语义（物理来源 / timeAxis / additivity / universe / display 格式 / 自然语言同义词）。LLM 的活退化成：自然语言 → `(指标, 维度, 时间, 意图)`，**从受控词表里选，而非自由拼**。同义词（销额/GMV/卖了多少钱 → 零售额）提升召回。

这是 dbt / Cube / Looker / Palantir Metric 层的形状，**建在 ADR-0017 的 aggregate 原语之上**，不绕过它。注意与 ADR-0061/0042 Alternative B 的关系：B 拒绝的是"把维度抽成可 join 的**实体星**（结构范式化）"，理由是"chat 短板是*语义不可见*不是*结构不范式*"——指标目录要的恰是**让语义可见的声明式封装**，不建实体星，**引用 B 的同一条理由**，故不冲突。

### 部件 5 — 意图快慢双路（杀时延长尾；服务 ADR-0063 的三件套定性）

需求高度长尾：A1–A6 月报取数是 ~90% 的量、却是最简单的有限空间（品类×指标×期次）。

- **快路**：简单取数 → LLM 一次分类 → 命中指标目录 → 确定性查询（可缓存，数据月更）→ **亚秒返回**，不进多步 Agent 循环。
- **慢路**：仅真正的战略/开放问题（D1/D3）才进多步 Agent；此时它调用的仍是部件 1–4，依然不碰裸数据、不自己格式化数值。

编排流程（停-确认、四跳顺序）**留在 skill**——ADR-0061 结尾与 ADR-0049 已明确编排属 skill 职责，本 ADR 不上提编排，只确定化**机械规划**（选表/取数/探覆盖/格式化）。

## 缺陷归因表（验收）

| 问题 | 被哪个部件杀死 | 机制 |
|---|---|---|
| BUG-1 数值抄错 | 部件 2 信封 | LLM 拿不到裸数字，只能复制 "3.90亿元" |
| BUG-2 颗粒度猜错 | 部件 1 `timeAxis` | "月度连续"写死，不靠猜 |
| BUG-2 拿错表反推覆盖 | 部件 3 `coverage()` | 现场探本星实际期次；不读兄弟星 |
| 60s 长尾 | 部件 5 + 部件 4 | 12 次 LLM 往返 → 1 次确定性编译 |
| p50 偏高 | 部件 5 快路 | 简单查询绕开 Agent 循环 |

## Consequences

### Positive
- 两个信任击穿缺陷**结构性消失**，不是靠加散文去救（避免 0061 诊断的"散文负向循环"）
- 把 ADR-0061 从 Proposed 推到完成，并补齐它自列的两个待办切片（聚合强制 → 信封；§3 coverage → 原语）
- 语义随本体走、跨 surface 自动继承（0061 已立的收益，本 ADR 扩展到时间维）
- 关键路径 LLM 往返降到最少 → 头部秒回

### Negative / 取舍（"最优"不等于"免费"）
- **指标目录要人写**：语义层上限 = 指标定义质量。这是把"每次查询时 LLM 临时推理语义"的成本**前置成一次性设计期投入**——确实是投入。
- **长尾兜底仍需通用路**：未被定义成指标的新颖问题，仍走"受护栏 DSL 自由查询"（继承 ADR-0026 的 oneOf 约束 + timeAxis/format 元数据）。故最优是**双层**：语义层覆盖已知分析面，通用层兜底真正探索。
- **不冲过头**：时间**不**升格为可 join 的维度实体（除非将来要季度自动 roll-up / 跨财年对齐）——对只读分析 Agent 是过度工程，与 ADR-0061/0042 Alt-B 一致。最优落点是"声明式语义"，不是"建模成实体"。
- **一次 schema 扩展 + 回填**：给现有三星补标 `timeAxis`（一次性，量极小，沿用 0061 的回填模式）。

## 落地顺序（最小风险优先）

1. **部件 2 信封**（杀 BUG-1）——改动最局部、收益最硬、不依赖其他部件。
2. **部件 1 `timeAxis` + 部件 3 `coverage()`**（杀 BUG-2）——一对，timeAxis 声明粒度、coverage 现场探覆盖。
3. **部件 4 指标目录 + 部件 5 快路**——最大工程量，建在 1–3 之上，分阶段铺开。

## Alternatives Considered

### A：继续 prompt-only（给 skill 再加几句"零售额别抄错""market_metric 是月度的"）
❌ 已被 UAT 证伪：BUG-1 非确定性（加句子压不住转写），BUG-2 是 0061 已记录的"散文负向循环"。与 0057/0061 拒绝 prompt-only 守护同因。

### B：把时间建成维度实体 + 时间维表（Palantir time dimension 全量版）
❌ 过度工程：时间值现为事实行上的字符串，升格实体要加 join/ingest/relationship 维护，而只读分析 Agent 不需要可查询的时间层级（DSL 已用派生 year/month 锁步，ADR-0059）。与 0061/0042 Alt-B 同一理由拒绝。**触发重启条件**：要做按季度自动 roll-up 或跨财年对齐时再议。

### C：把覆盖也写进本体（让 timeAxis 带 coveredPeriods 清单）
❌ 直接违反 ADR-0043 §2（coverage 是 per-report 数据，每次 ingest 变）。会换姿势重造 BUG-2。覆盖必须留运行时 probe。
