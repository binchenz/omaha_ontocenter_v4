# ADR-0062: 行业垂直作为可插拔贡献 — Open-Core 化与核心对垂直的零具名依赖

**Status:** Proposed
**Date:** 2026-06-16
**Deciders:** binchenz

## Context

项目即将开源，同时要把当前唯一的真实垂直能力——**AVC 市场情报**（解析奥维云网 Excel 交叉表 → 三颗事实星 `market_metric` / `brand_share` / `model_metric` → 下钻确认门 → research_qa chat）——交付给第一个客户纯米科技。

两个约束叠加，逼出一个架构决策而非一次字符串清理：

1. **客户身份本已是配置，不是代码。** 「纯米 = 小米 + 米家」这个私有合并口径走 `Tenant.settings.selfBrands`（ADR-0061 配套的 `renderSelfIdentity`），生产代码里只有一行注释提到纯米。单看身份，开源时清掉 test/scripts/docs 的字面量即可。
2. **但 AVC 垂直是纯米关系的指纹。** AVC（奥维云网）只为纯米独家出这类报告。因此开源 repo 里只要出现 AVC 连接器/星型/工具，等于公开了"这是为那个 AVC 独家客户做的" = 纯米。**光删「纯米」字样不够，整条 AVC 链必须从开源核心消失。**

而 AVC 现在是**焊死在核心模块里的具名引用**，不是挂在接缝上的插件。审计出 6 个耦合点：

| # | 位置 | 耦合形式 |
|---|------|---------|
| 1 | `agent.module.ts` `AGENT_OWN_TOOLS` | 字面量列出 `ExtractAvcReportTool` |
| 2 | `agent.module.ts` `AGENT_SKILLS` factory | 字面量 `new ResearchQaSkill()` / `new DataIngestionSkill()` |
| 3 | `orchestrator.service.ts:50` | `AVC_DRILL_GATE` 常量（宽层 `brand_share`/`market_metric` → 钻取层 `model_metric` 的确认门） |
| 4 | `research.module.ts` providers | `AvcConnector` / `AvcTemplateExtractor` / `MarketMetricImporter` |
| 5 | `pipeline.module.ts` providers | `AvcPipelineProvisioner`（3 条管道 + 品牌别名表） |
| 6 | `research/avc-stars.ts` | AVC 星型 schema 定义 |

**只要核心里还有一处对具体垂直的具名引用，这个平台对社区就是"伪开放"**——别人想加垂直得改你的核心文件、往你的核心模块提 PR，那是 fork 生态，不是插件生态。开源把"为了藏纯米"这个动机，升级成了"为了让其他 OPC（采用方/部署方）能照模板挂自己的垂直"这个更高的标准。

## Decision

把行业垂直确立为**可插拔的贡献单元（Vertical）**，并对核心立一条不可违反的依赖纪律：

> **核心依赖零个垂直；所有垂直依赖核心。** 核心只定义贡献接缝（seam），垂直是挂在接缝上的适配器（adapter）。核心代码中**不得出现对任何具体垂直的具名引用**。

### 1. Open-Core 布局（架构 A：私有包依赖公开核心）

- **公开仓 = 唯一真相（single source of truth）。** 社区 PR 直接落在真相上，不存在"私有超集仓 + 有损公开镜像"那种持续双向同步的负担。
- **AVC = 私有包**（如 `@omaha/vertical-avc`），依赖公开核心，纯米交付 = 公开核心 + 装上该私有包。
- 否决「私有超集仓 + 公开镜像」（架构 B）:对一个真心要开源的项目，让公开仓沦为二等镜像、每个社区 PR 都要入站合并，不划算。
- 否决「把 AVC 做成纯配置/数据、零代码」（架构 C）:Excel 交叉表解析、星型 schema、下钻门是**真代码不是配置**，做不成纯 seed。

### 2. `Vertical` 接口 = 扇入既有接缝的薄清单

不为垂直新发明注册机制。`Vertical` 是个薄清单，把贡献**扇入核心已有的收集接缝**（`AGENT_TOOLS`/`AGENT_SKILLS` DI token、connector/pipeline 抽象、以及下方泛化后的 drill-gate 机制）:

```typescript
interface Vertical {
  name: string;                          // 'avc' | 'market-metric'
  tools?: AgentTool[];                   // → 喂给既有 AGENT_TOOLS 收集
  skills?: AgentSkill[];                 // → 喂给既有 AGENT_SKILLS（skill-assembly 按名字过滤，零改动）
  connectors?: ConnectorContribution[];  // connector + pipeline provisioner
  drillGates?: DrillGate[];              // → 喂给泛化后的下钻门机制（见 §3）
}
```

深模块视角:`Vertical` 是**小接口、深实现**——社区作者只实现这一个接口就拿到工具/技能/连接器/下钻门的全部触达；而核心收集工具的路径**始终只有一条**，无论贡献来自核心、参考垂直还是 AVC。一个垂直的全部知识集中在它自己的包里（locality）；删掉它，复杂度干净消失（deletion test 通过）。

AVC 的拆分按两类处理:
- **第①类（纯 AVC，整块进私有包，核心不留）**:`extract_avc_report` 工具、`avc-stars` 星型、`AvcConnector` / `AvcTemplateExtractor` / `MarketMetricImporter`、`AvcPipelineProvisioner` 及品牌/品类别名表、`research_qa` 技能里那段 AVC 三星口径 prose。
- **第②类（机制通用、配置外移，见 §3）**:下钻确认门。

### 3. 唯一的核心手术:把下钻门从"AVC 常量"泛化为"平台能力"

`AVC_DRILL_GATE` 的注释自称 "domain-agnostic"，但**它是唯一使用者**——一个只有 AVC 在用的"通用接缝"几乎必然是 AVC 形状、悄悄漏抽象的。本 ADR 把 #195 的"先查宽层、钻贵层前停下确认"升级为**平台能力**:orchestrator 不再写死 `AVC_DRILL_GATE`，改为**消费一组注入进来的 `drillGates`**，自身不认识任何具体类型名。AVC 包把那组 `{broadLayer, drillTarget, confirmMessage}` 配置作为 vertical 贡献的一部分交进来。

**drill-gate 由 vertical 静态贡献，不做 per-tenant。** 分层依据:"哪层是宽层、哪层是钻取层"由**星型 schema 的形状**决定，而 schema 由 vertical 定义，故属 vertical 固有知识。客户身份（`selfBrands`）不同:那是同一 AVC schema 下每个客户各异的"我是谁"，才该 per-tenant。**schema 形状相关 → vertical 静态；客户身份相关 → per-tenant 配置。**

### 4. 公开仓随核心发布一个「参考垂直」(reference vertical)

> **一个适配器 = 假想接缝；两个适配器 = 真接缝。**

接缝可信的唯一证明是**现在就有第二个实现**。因此公开仓发布一个一等的、中性的**参考垂直「通用市场指标」(generic market-metric)**:CSV/表格 → 单星型对象，展示 tool + skill + connector + drill-gate 四件套，但不绑定任何行业、不暴露任何客户。它一举三得:

1. **逼真接缝**——参考垂直与 AVC 走同一套接口，任何"偷偷认识 AVC"的耦合会立刻暴露在公开仓编译期。
2. **给社区模板**——其他 OPC 照着 `verticals/market-metric/` 抄就能写自己的垂直，无需逆向核心。
3. **解决空框架**——开源仓自带一个能 demo、能跑的真实垂直。

AVC 即是这个接缝的**私有第二实现**。"有两个垂直"本身就是接缝可信的证明。

### 5. `Vertical` 及其依赖类型是公共、版稳的扩展 API

`Vertical` / `DrillGate` / `ConnectorContribution` / `AgentTool` / `AgentSkill` 一旦开源即为**公共 API**，社区垂直依赖之，改它即破坏下游。故给这套接口**显式的 semver + 稳定性承诺**，与核心内部接口区分开。这是"即将开源"必须付的税，好处是逼接口收敛干净。

## Consequences

- **核心要做的代码改动收敛为两类**:(a) 把 6 个耦合点中 #1/#2/#4/#5/#6 的 provider 从核心模块搬到垂直包（机械搬迁）；(b) 唯一的深模块手术——泛化 §3 的 drill-gate。其余 skill-assembly 等无需改（已按字符串名过滤）。
- **新增公开仓资产**:参考垂直 `verticals/market-metric/`，并随之承担其测试与文档（社区模板的门面）。
- **客户身份清理（独立于本 ADR 的并行收尾）**:test/scripts/docs 里的 `纯米/小米/米家` 字面量与 `ontology.sdk.ts:230` 注释、`CONTEXT.md` 的 "Market Intelligence (纯米)" 章节需中性化——这是字符串清理，风险低，但断言/夹具（如 `anchors.ts` 的 `absentBrand`）要跟着改。
- **治理负担**:`Vertical` 公共 API 的破坏性变更今后需走版本流程，不能再随手改。
- 关联记忆:[[adr0061-implementation-shipped]]、[[prompt-skill-assembly]]、[[pipeline-architecture-grill]]、[[chunmi-agent-eval-rerun-findings]]（drill-gate / 身份注入的来龙去脉）。

## Considered Options

- **架构 A — 私有 vertical 包依赖公开核心（选中）**:公开仓是真相，依赖方向健康，社区 PR 直接落地，纯米交付 = 核心 + 私有包。
- **架构 B — 私有超集仓 + 公开镜像（否决）**:私有仓是真相、公开仓是有损镜像，导致公开仓二等化 + 持续双向同步。
- **架构 C — AVC 全做成配置/数据零代码（否决）**:交叉表解析/星型/下钻门是真代码，无法降级为纯 seed。
- **drill-gate per-tenant 运行时配置（否决）**:下钻分层是 schema 形状的固有知识，不是租户偏好，放 vertical 静态贡献更合理；per-tenant 留给客户身份（`selfBrands`）。
