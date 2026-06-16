# ADR-0060: Pipeline Transform 引擎升级为 DuckDB + 有界多输入对齐(刻意不做调度平台)

**Status:** Accepted
**Date:** 2026-06-16
**Deciders:** binchenz
**Amends:** ADR-0045(Pipeline 架构)、ADR-0053(枚举受限 step)
**Relates:** ADR-0002(object_instances 统一存储)、ADR-0044(Field Path 跨关系)、ADR-0051(IngestRecipe / Agent connector)

## Context

ADR-0045 确立的 Pipeline transform 引擎在 `pipeline-run.worker.ts` 中以**「Node 进程内存里对 `Row[]` 数组顺序操作」**实现,step 词汇表只有三种:`filter` / `rename` / `compute`(且 `compute` 仅 `normalize_brand` / `price_band` 两个预定义函数)。`PipelineRun.inputDatasetId` 是**单数**,`Pipeline` 约束为 `@@unique([tenantId, connectorId, outputObjectTypeId])`——即「一个 Pipeline = 一个输入 Connector → 一个输出 ObjectType」。`MAX_ROWS = 100_000` 是内存执行的硬上限。

这套引擎对 AVC 场景(品类×月的单表 Excel、几万行、各 star 从单 sheet 抽取、收敛到三颗星)是完美契合的。但交付目标之外,纯米后续会接入**形态各异、且持续反复来的企业报告**。一次 grill 把真实需求逼了出来,现有引擎在三个地方撞墙:

1. **半结构化展开缺口**:设备日志这类源,一行 = `{ deviceId, ts, payload: {大JSON埋点} }`,要把 JSON 炸开成可分析的列/行。现有词汇表**无此算子**。
2. **多输入 JOIN 缺口**:存在「事实 × 事实」的合并需求(订单事实 JOIN 退款事实算净额),必须在清洗期把多个 Dataset 合并成一张 clean Dataset。`inputDatasetId` 单数 + 引擎无 `join` 算子,**结构上做不到**。
3. **执行引擎量级缺口**:设备时序日志是千万行级,内存跑 `Row[]`(10 万行天花板)扛不住。

grill 中澄清的几个关键区分(决定了范围,避免过度工程):

- **「需要 JOIN」分三类**,代价天差地别:① 查询期跨关系读字段(Field Path,ADR-0044,**已支持**,1 跳);② 实体解析后建关系(`normalize_brand`/`normalizeCategory` 已做键归一);③ 清洗期多表合并成物理宽表(**真缺口**)。只有 ③ 需要动引擎。
- **「事实 × 小维度/码表」不该进 Pipeline JOIN**。码表(int → 枚举含义)、用户档案这类**小、静态、可复用**的维度,正确归宿是**建成维度 Object Type + 查询期 Field Path 解码**(类型①):维度会变(改一处全局生效 vs JOIN 进宽表后维度一变全部重灌)、省存储(维度只存一份 vs 千万行冗余)、且这正是本体相对宽表的核心优势。Pipeline 多输入 JOIN **只服务「事实 × 事实」**。
- **真正的硬骨头不是 JOIN 算子,是多输入的触发时机**。两个输入 Dataset 几乎不会同时 ready(订单周一到、退款周三到),现有反应式触发链 `onRawDatasetReady` 是单输入假设写死的(任一输入 ready 就用那一个 datasetId 跑)。多输入需要从「一个就绪即跑」变成「凑齐 N 个输入才跑」的 join-barrier 编排。
- **这个「凑齐才跑 + 批次对齐」就是数据开发平台调度系统的基础原语**(依赖 sensor + business-date 对齐)。承认这一点既是安心(方向被几十年实践验证)也是危险(调度平台是无底洞:cron / backfill / DAG / SLA / 跨周期依赖……)。

## Decision

Pipeline transform 引擎从「Node 内存 `Row[]`」升级为 **DuckDB(进程内列式 SQL 引擎)**,并配套**有界的多输入对齐**。六段:

### 1. 引擎:DuckDB,单一实现,不可插拔

transform 执行从 JS 数组操作迁到 DuckDB 进程内 SQL。DuckDB 是 Foundry 之于 Spark 的缩小版——列式 + 向量化,单机扛**千万行级**,且**零新基础设施**(进程内库,符合 OSS 自托管初衷)。

**显式不做可插拔双后端(DuckDB/ClickHouse 运行时切换)**。两个引擎的 SQL 方言、JSON 函数、JOIN/类型语义都不同,可插拔 = 两套编译器后端 + 两套测试矩阵 + 让平台去运维 ClickHouse,为部分甲方才有的能力给所有代码加抽象税。引擎永远只有 DuckDB。

### 2. 新算子:继续走「枚举受限的声明式 step」(延续 ADR-0053)

新增 step / compute 函数:`explode_json`(炸 JSON 埋点)、`dedup`、`aggregate`、以及 `join`(**仅多输入路径**)。**不暴露裸 SQL**——step 仍是 JSON Schema 校验的声明式配置,DuckDB SQL 在引擎内部生成。这是 ADR-0053「step config 枚举受限以防运行时失败」哲学的延续,不是背叛。

### 3. 事实 × 维度:不进 Pipeline,走维度 Object Type + 查询期 Field Path

码表 / 档案建成维度 Object Type,事实对象挂 relationship,查询期 Field Path 解码(类型①,已支持)。可选:给 `compute` 加 `decode_lookup`(`normalize_brand` 的泛化)做轻量码表解码,适用于「码表小且解码后即冻结」的场景。

### 4. 事实 × 事实:DuckDB 多输入 JOIN + 「模型 1′」对齐

- `PipelineRun` 从单 `inputDatasetId` 改为**多输入**(关联表)。
- `Pipeline` 的 `@@unique([tenantId, connectorId, outputObjectTypeId])` 单 Connector 绑定放开,支持声明多个输入源。
- **触发语义 = 模型 1′:全齐门 + 可选 `alignKey`**(见下,这是本 ADR 唯一的真实编排权衡)。

### 5. 多输入触发语义:模型 1′(全齐门 + 可选 alignKey)

任一输入源 ready 时,orchestrator 检查所有声明输入源是否都有 ready version:

- **不声明 `alignKey`(默认)**→ 退化为「**各取最新 ready version**」跑一次。适用于「事实 × 慢变维度」(日志每天来 × 码表当前版本,各取最新**恰好是对的**)及无批次概念的源。
- **声明 `alignKey`(如 `reportMonth`)**→ 改为「**所有输入源都存在同一 alignKey 值的 ready version 才跑,且只 JOIN 同键版本**」。这堵住「事实 × 事实」的跨批错配:6 月订单**绝不会**去配 5 月退款,不齐就静静等。

**为什么必须有 alignKey 这道护栏**:纯模型 1「各取最新」对「事实 × 慢变维度」对、对「事实 × 同批次事实」**错**——而 Pipeline 多输入 JOIN 唯一服务的(事实 × 事实)正是会错的那个,且错配会算出**合理数值、不报错**(invisible wrong answer)。alignKey 用的就是 AVC 已在用的对齐概念(`reportMonth`,`readCoverMonth` 已在抽)。无 alignKey 可抽的源 → 不声明,文档写明风险,自负其责。

`alignKey` 本质是把调度系统的「业务日期依赖(execution_date / business date)」降级成 Pipeline 的一个**可选护栏**,而非独立模型。

### 6. B 逃生口 + ClickHouse 接口位

A(平台内 DuckDB 清洗)是**默认**;B(外部清洗,结果经 `kind='clean'` 直灌)是**永久保留的逃生口**。二者共用 `kind='clean'` 汇入点(SyncJob 只认 clean,不在乎谁产出)。A 与 B **不对立、互补、各管一段**:

| 数据规模 / 复杂度 | 谁来清 | 走哪条 |
|---|---|---|
| ≤ 千万行 | 平台 DuckDB | **A(默认)** |
| 千万~亿,JOIN 不极端 | 平台 DuckDB(调优 / Parquet) | A,接近边界 |
| 亿级+ / 分布式 shuffle / 甲方已有数仓 | 外部 Spark/ClickHouse/客户数仓 | **B(逃生口)** |

**ClickHouse 定位:留在 Connector 接口层,不留在执行引擎层**。有 ClickHouse 的甲方,其 CH 是**他们自己的上游数仓**——通过未来的 ClickHouse Connector **浅接(pull:跑 SQL 把结果集拉成 clean Dataset)**,复用 B 逃生口。**Pushdown 联邦查询**(把 Agent 的聚合下推到甲方 CH、对象层不落地)**显式 out-of-scope**——它要 QueryPlanner DSL 编译成 CH SQL 并碰 ADR-0002 统一存储根基,触发条件是「某甲方亿级数据搬运成本不可接受」时再单开 ADR。这与 Foundry「引擎单一(Spark),外部仓(Snowflake/BigQuery)经 Virtual Tables 接入」同构。

### 刻意不做调度平台(本 ADR 最该记住的拒绝)

模型 1′ 的「全齐门 + alignKey」**是调度系统的依赖对齐原语的最小子集**。平台**只**实现这一个原语,**显式拒绝**长成调度平台:不做 cron 时间调度、不做 backfill 补数据、不做 DAG 编排、不做 SLA 告警、不做跨周期/自依赖。

理由:本平台是**反应式数据架构**(数据 markReady 即触发),不是**时间驱动调度架构**(到点跑)。反应式 + 依赖门已覆盖全部真实场景(AVC 单输入、订单×退款多输入)。需要完整调度的甲方,用**外部 Airflow / DolphinScheduler 调用平台 API**(B 逃生口的编排版)。接现成调度器当内置编排层会直接炸掉「零新基础设施」根基,与「用 DuckDB 而非 Spark」的逻辑自相矛盾;自造调度器是另起一个项目。

## Consequences

### 正面

1. 三道墙(JSON 展开、多输入 JOIN、量级)一次性解决,且引擎选型不为亿级买单(亿级交 B),保住「零新基础设施」。
2. 单输入反应式链(AVC 那条)**完全不动**——`alignKey` 不声明即退化为现有「各取最新」行为,向后兼容。
3. 声明式 step 不变(延续 ADR-0053),Agent / OPC 的 Pipeline 配置心智模型连续,无裸 SQL 风险面。
4. 事实/维度分流让多输入 JOIN 范围收窄到「事实×事实」,维度走查询期 Field Path,避免宽表冗余与维度重灌。

### 负面

1. **引擎替换是大改**:`pipeline-run.worker.ts` 的 `executeStep` / `executeCompute` 要从 JS 数组重写为 DuckDB SQL 生成 + 执行;`PipelineRun` schema 多输入迁移;orchestrator `onRawDatasetReady` 改 join-barrier。非增量,需独立 epic + 红绿测试。
2. **DuckDB 有物理天花板**:亿级 + shuffle-heavy JOIN 会 OOM/不可用。缓解 = 这正是 B 存在的理由,文档给 OPC 明确的「行数阈值 + 算子复杂度」分流判据线。
3. **无 alignKey 的多输入 JOIN 仍可跨批错配**:这是刻意保留的「自负其责」口子,靠文档 + Pipeline 配置时的告警缓解,不靠引擎强制。
4. **ADR-0045 第 5 条(step 内存跑、无中间物化)被本 ADR 推翻**:DuckDB 执行不再是纯内存 `Row[]`。ADR-0045 第 10 条(「DSL TableTarget 参数化……Re-add when a real use case appears」)预留的剧情在此兑现——设备日志就是那个 real use case。

### 中立

- 多输入 JOIN 的 v1 触发用「全齐门」(模型 1),不引入 cron/手动批次配对;`alignKey` 是声明式护栏而非独立调度模型,未来若需「有干净批次键的源自动化」可在此基础扩展,无需重写。

## Alternatives Considered

### 引擎层

- **(A) DuckDB 单一引擎(采纳)**:进程内、零基础设施、千万行级够用。
- **(B) 保持内存 `Row[]`,复杂清洗全外置(B 逃生口扩大化)**:工程量最小,但把「干掉 OPC 重复脚本」的初衷又请回脚本腐烂——对反复来的源不可接受。降级为「亿级/外部」的逃生口而非默认。
- **(C) 引入 Spark/分布式引擎**:炸掉 OSS 自托管「零新基础设施」,运维代价与「拒绝为亿级买单、亿级交 B」矛盾。拒绝。
- **(D) DuckDB/ClickHouse 可插拔双后端**:两套方言/编译器/测试矩阵 + 运维 CH,为部分甲方给所有代码加抽象税。拒绝——ClickHouse 走 Connector 接口层,不进引擎层。

### 多输入触发语义

- **模型 1 纯「各取最新」**:简单,但事实×事实跨批错配(invisible wrong answer)。
- **模型 2 强制批次键对齐**:最准,但要求所有源都能抽干净批次键(设备日志未必有),范围大。
- **模型 3 纯手动触发**:最可控,但牺牲反应式自动化。
- **模型 1′(采纳)= 模型 1 默认 + 可选 alignKey 护栏**:默认零负担保留反应式,危险场景(事实×事实)声明一个键即安全,把模型 2 降级成可选护栏而非独立模型。

### 调度边界

- **档位 1:只取最小依赖对齐原语(采纳)**——全齐门 + alignKey,显式拒绝 cron/backfill/DAG/SLA。
- **档位 2:内置/接入成熟调度器**——炸「零新基础设施」,与 DuckDB-非-Spark 自相矛盾。完整调度交外部调度器调 API。
- **档位 3:自造调度平台**——另起项目,荒谬。

## References

- **ADR-0045** Pipeline 架构(本 ADR amends 其第 5、10 条)
- **ADR-0053** 枚举受限 step config(本 ADR 延续其哲学到新算子)
- **ADR-0044** Field Path 跨关系 1 跳(事实×维度走此路,不进 Pipeline JOIN)
- **ADR-0002** object_instances 统一存储(ClickHouse pushdown out-of-scope 的根基约束)
- **代码现状**:
  - `apps/core-api/src/modules/pipeline/pipeline-run.worker.ts` `executeStep`/`executeCompute`(待重写为 DuckDB)、`MAX_ROWS=100_000`
  - `apps/core-api/src/modules/pipeline/data-pipeline.orchestrator.ts` `onRawDatasetReady`(单输入假设,待改 join-barrier)
  - `packages/db/prisma/schema.prisma` `PipelineRun.inputDatasetId` 单数(待改多输入)、`Pipeline @@unique([tenantId, connectorId, outputObjectTypeId])`(待放开)
  - `apps/core-api/src/modules/research/avc-template-extractor.ts` `readCoverMonth`(alignKey 的现成抽取范例)
- **grill 决策链(本 ADR 的来源)**:ODS≈raw / DWD≈clean / DM=决策优先本体粒度(不建物理层)→ Foundry 四件套对照(Data Connection ✅ / Pipeline Builder ⚠️薄 / Ontology ✅✅ / 按需物化 ✅)→ JOIN 三分类 → 事实/维度分流 → 多输入触发硬骨头 → 模型 1′ → 「这是调度」→ 档位 1 刻意不做调度平台
